"""Extrae landmarks de AMBAS manos desde videos y genera patrones .npy para DTW.

Diferencias clave contra extract_from_videos.py:
  * num_hands=2 (antes 1) -> las senas bimanuales se capturan completas.
  * Asignacion por handedness de MediaPipe, igual que splitHands() en la web.
  * Salida binaria .npy con shape [N, 42, 3] (21 derecha + 21 izquierda).
  * Frames sin una mano quedan en ceros, que es como el detector marca ausencia.

Uso:
    python extract_two_hands.py --input ../public/videos/signs --manifest ../public/training_data/manifest.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = Path(__file__).parent / "models" / "hand_landmarker.task"

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}

# El detector usa maxBufferSize=30; secuencias mas largas no pueden hacer match.
TARGET_FRAMES = 24
MIN_FRAMES = 6

LM_COUNT = 21
TOTAL_LM = LM_COUNT * 2  # 21 derecha + 21 izquierda

# Salto maximo (fraccion del encuadre) que se acepta como la misma mano entre
# frames consecutivos. Por encima de esto se asume que es la otra mano.
MAX_SLOT_JUMP = 0.25


def slugify_label(stem: str) -> str:
    ascii_stem = (
        unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    )
    return re.sub(r"[^A-Za-z0-9]+", "_", ascii_stem).strip("_").upper()


def ensure_model(path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Descargando modelo HandLandmarker -> {path}")
    urllib.request.urlretrieve(MODEL_URL, path)
    return path


def hand_to_array(hand) -> np.ndarray:
    out = np.zeros((LM_COUNT, 3), dtype=np.float32)
    for j, p in enumerate(hand[:LM_COUNT]):
        out[j] = (float(p.x), float(p.y), float(p.z))
    return out


def assign_slots(hands, handedness, prev_wrists) -> np.ndarray:
    """Coloca cada mano detectada en el slot derecha/izquierda correcto.

    MediaPipe reetiqueta las manos entre frames: la misma mano fisica pasa de
    "Right" a "Left" y de vuelta. Si se confia solo en la etiqueta, la muneca
    del slot teleporta de un lado del encuadre al otro y la velocidad resultante
    domina el vector de features, arruinando el DTW.

    Por eso la etiqueta solo decide el primer frame; despues manda la
    continuidad espacial (cada mano va al slot cuya muneca previa esta mas
    cerca).
    """
    arr = np.zeros((TOTAL_LM, 3), dtype=np.float32)
    mats = [hand_to_array(h) for h in hands[:2]]

    labels: list[str | None] = []
    for i in range(len(mats)):
        cat = None
        if i < len(handedness) and handedness[i]:
            cat = handedness[i][0].category_name
        labels.append(cat)

    pr, pl = prev_wrists.get("right"), prev_wrists.get("left")

    def dist(wrist, prev):
        if prev is None:
            return None
        return math.hypot(wrist[0] - prev[0], wrist[1] - prev[1])

    if len(mats) == 2:
        w0, w1 = mats[0][0, :2], mats[1][0, :2]
        # Coste de las dos asignaciones posibles usando el frame anterior.
        direct = [d for d in (dist(w0, pr), dist(w1, pl)) if d is not None]
        swapped = [d for d in (dist(w1, pr), dist(w0, pl)) if d is not None]

        if direct and swapped:
            use_swap = sum(swapped) < sum(direct)
        else:
            # Primer frame con dos manos: decidir por etiqueta.
            use_swap = labels[0] == "Left" or labels[1] == "Right"

        right_mat, left_mat = (mats[1], mats[0]) if use_swap else (mats[0], mats[1])
        arr[:LM_COUNT] = right_mat
        arr[LM_COUNT:] = left_mat
        return arr

    # Una sola mano detectada: al slot mas cercano del frame anterior.
    mat = mats[0]
    w = mat[0, :2]
    dr, dl = dist(w, pr), dist(w, pl)

    if dr is not None and dl is not None:
        to_right = dr <= dl
    elif dr is not None:
        to_right = dr <= MAX_SLOT_JUMP
    elif dl is not None:
        to_right = not (dl <= MAX_SLOT_JUMP)
    else:
        to_right = labels[0] != "Left"

    if to_right:
        arr[:LM_COUNT] = mat
    else:
        arr[LM_COUNT:] = mat
    return arr


def extract_frames(video_path: Path, landmarker) -> list[np.ndarray]:
    """Devuelve los frames con al menos una mano, como arrays [42, 3]."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  ! No se pudo abrir {video_path.name}")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames: list[np.ndarray] = []
    frame_idx = 0
    prev_wrists: dict[str, tuple[float, float]] = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(frame_idx * 1000 / fps)

        try:
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
        except Exception as exc:
            print(f"  ! Frame {frame_idx} omitido: {exc}")
            frame_idx += 1
            continue

        hands = result.hand_landmarks or []
        handedness = result.handedness or []

        if hands:
            arr = assign_slots(hands, handedness, prev_wrists)
            # Memoria para el siguiente frame: solo slots con mano presente.
            for slot, base in (("right", 0), ("left", LM_COUNT)):
                pt = arr[base, :2]
                if pt[0] != 0 or pt[1] != 0:
                    prev_wrists[slot] = (float(pt[0]), float(pt[1]))
            frames.append(arr)

        frame_idx += 1

    cap.release()
    return frames


def longest_run(frames: list[np.ndarray]) -> list[np.ndarray]:
    """Los frames ya vienen filtrados por presencia, se devuelven tal cual."""
    return frames


def resample(frames: list[np.ndarray], target: int) -> np.ndarray:
    """Remuestrea a `target` frames interpolando linealmente."""
    n = len(frames)
    stacked = np.stack(frames)  # [n, 42, 3]
    if n == target:
        return stacked
    if n < 2:
        return np.repeat(stacked, target, axis=0)

    out = np.zeros((target, TOTAL_LM, 3), dtype=np.float32)
    for idx, t in enumerate(np.linspace(0, n - 1, target)):
        i0 = int(math.floor(t))
        i1 = min(i0 + 1, n - 1)
        alpha = float(t - i0)
        a, b = stacked[i0], stacked[i1]
        # Si una mano solo existe en un extremo, no interpolamos hacia ceros:
        # eso crearia landmarks fantasma a mitad de camino.
        blended = a * (1 - alpha) + b * alpha
        a_missing = np.all(a == 0, axis=1)
        b_missing = np.all(b == 0, axis=1)
        blended[a_missing & ~b_missing] = b[a_missing & ~b_missing]
        blended[~a_missing & b_missing] = a[~a_missing & b_missing]
        blended[a_missing & b_missing] = 0.0
        out[idx] = blended
    return out


def hand_stats(arr: np.ndarray) -> tuple[int, int]:
    """Cuenta frames con mano derecha y con mano izquierda."""
    right = int(np.sum(np.any(arr[:, :LM_COUNT, :2] != 0, axis=(1, 2))))
    left = int(np.sum(np.any(arr[:, LM_COUNT:, :2] != 0, axis=(1, 2))))
    return right, left


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae AMBAS manos de videos y genera patrones .npy"
    )
    parser.add_argument("--input", required=True, help="Carpeta con los videos")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).parent.parent / "public" / "training_data"),
        help="Raiz de training_data",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="manifest.json para resolver la categoria de cada sena",
    )
    parser.add_argument("--target-frames", type=int, default=TARGET_FRAMES)
    parser.add_argument("--min-frames", type=int, default=MIN_FRAMES)
    parser.add_argument(
        "--only", default=None, help="Procesa solo esta sena (para pruebas)"
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    input_dir = Path(args.input).expanduser().resolve()
    if not input_dir.is_dir():
        print(f"No existe la carpeta: {input_dir}")
        return 1

    out_root = Path(args.out).expanduser().resolve()
    manifest_path = (
        Path(args.manifest).expanduser().resolve()
        if args.manifest
        else out_root / "manifest.json"
    )

    # sena -> categoria, desde el manifest existente
    sign_to_cat: dict[str, str] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for cat, signs in manifest.items():
            if isinstance(signs, list):
                for s in signs:
                    sign_to_cat[s] = cat
    else:
        print(f"! No hay manifest en {manifest_path}, todo ira a 'palabras'")

    videos = sorted(p for p in input_dir.glob("*") if p.suffix.lower() in VIDEO_EXTS)
    if not videos:
        print(f"No se encontraron videos en {input_dir}")
        return 1

    if args.only:
        videos = [v for v in videos if slugify_label(v.stem) == args.only.upper()]
        if not videos:
            print(f"No hay video para {args.only}")
            return 1

    print(f"{len(videos)} video(s) en {input_dir}")
    print(f"Salida: {out_root}")
    print(f"num_hands=2, target_frames={args.target_frames}\n")

    model = ensure_model(MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    written = 0
    two_handed: list[str] = []
    one_handed: list[str] = []
    skipped: list[str] = []

    for video in videos:
        label = slugify_label(video.stem)
        if not label:
            continue

        with mp_vision.HandLandmarker.create_from_options(options) as landmarker:
            frames = extract_frames(video, landmarker)

        if len(frames) < args.min_frames:
            print(f"{label}: solo {len(frames)} frames con mano, omitido")
            skipped.append(label)
            continue

        arr = resample(longest_run(frames), args.target_frames)
        n_right, n_left = hand_stats(arr)

        # Bimanual si la izquierda aparece en al menos 40% de los frames.
        is_two = n_left >= 0.4 * args.target_frames
        (two_handed if is_two else one_handed).append(label)

        category = sign_to_cat.get(label, "palabras")
        out_dir = out_root / category
        out_file = out_dir / f"{label}_1.npy"

        flag = "2 manos" if is_two else "1 mano"
        print(
            f"{label} [{category}] {flag} R:{n_right}/{args.target_frames} "
            f"L:{n_left}/{args.target_frames} <- {video.name}"
        )

        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            np.save(out_file, arr)
            written += 1

    print(f"\nListo: {written} archivo(s) base escritos")
    print(f"Bimanuales: {len(two_handed)}")
    print(f"Una mano:   {len(one_handed)}")
    if skipped:
        print(f"Omitidos:   {len(skipped)} -> {', '.join(skipped)}")

    report = out_root / "extraction_report.json"
    if not args.dry_run:
        report.write_text(
            json.dumps(
                {
                    "two_handed": sorted(two_handed),
                    "one_handed": sorted(one_handed),
                    "skipped": sorted(skipped),
                    "target_frames": args.target_frames,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"Reporte: {report}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
