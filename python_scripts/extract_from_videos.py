"""Extrae landmarks de manos desde videos MP4 y genera patrones DTW.

Convierte una carpeta de videos (cada archivo nombrado con la sena que
representa) en los JSON de `training_data/` que consumen la app Flutter y la
web.

Uso basico:

    python extract_from_videos.py --input ../videos_crudos --category palabras

El nombre del archivo es la etiqueta: `Por Favor.mp4` -> `POR_FAVOR`.
Si varios archivos comparten etiqueta (`POR_FAVOR_1.mp4`, `POR_FAVOR_2.mp4`)
se acumulan como ejemplos distintos de la misma sena.
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

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = Path(__file__).parent / "models" / "hand_landmarker.task"

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}

# El detector DTW usa maxBufferSize=30 y ventanas de largo L-2..L+8.
# Si una secuencia tiene L > 32, minW = L-2 supera el buffer y la sena NUNCA
# puede hacer match en vivo. Por eso remuestreamos a TARGET_FRAMES.
MAX_SAFE_FRAMES = 30
DEFAULT_TARGET_FRAMES = 24

# Raiz donde viven los patrones para la web app.
DEFAULT_OUT_ROOTS = [
    Path(__file__).parent.parent / "public" / "training_data",
]


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def slugify_label(stem: str) -> tuple[str, int | None]:
    """`Por Favor_2` -> ('POR_FAVOR', 2). Devuelve (etiqueta, indice o None)."""
    ascii_stem = (
        unicodedata.normalize("NFKD", stem)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    label = re.sub(r"[^A-Za-z0-9]+", "_", ascii_stem).strip("_").upper()
    match = re.match(r"^(.*?)_(\d+)$", label)
    if match:
        return match.group(1), int(match.group(2))
    return label, None


def ensure_model(path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Descargando modelo HandLandmarker -> {path}")
    urllib.request.urlretrieve(MODEL_URL, path)
    return path


def hand_scale(landmarks: list[dict]) -> float:
    """Distancia muneca (0) -> base del dedo medio (9). Igual que el detector."""
    wrist, middle = landmarks[0], landmarks[9]
    return math.hypot(middle["x"] - wrist["x"], middle["y"] - wrist["y"]) or 1e-9


# ---------------------------------------------------------------------------
# Extraccion de landmarks
# ---------------------------------------------------------------------------

def extract_runs(video_path: Path, landmarker, min_frames: int) -> list[list[dict]]:
    """Devuelve tramos contiguos de frames con mano detectada."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  ! No se pudo abrir {video_path.name}")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    runs: list[list[dict]] = []
    current: list[dict] = []
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(frame_idx * 1000 / fps)

        try:
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
        except Exception as exc:  # timestamps no monotonicos, frames corruptos
            print(f"  ! Frame {frame_idx} omitido: {exc}")
            frame_idx += 1
            continue

        hands = result.hand_landmarks or []
        if hands:
            # Landmarks CRUDOS (sin espejar), igual que hace la web y el runtime.
            current.append(
                {
                    "videoTime": round(frame_idx / fps, 3),
                    "landmarks": [
                        {
                            "x": round(float(p.x), 4),
                            "y": round(float(p.y), 4),
                            "z": round(float(p.z), 4),
                        }
                        for p in hands[0]
                    ],
                }
            )
        elif current:
            if len(current) >= min_frames:
                runs.append(current)
            current = []

        frame_idx += 1

    cap.release()
    if len(current) >= min_frames:
        runs.append(current)
    return runs


def segment_by_motion(
    frames: list[dict], threshold: float, min_frames: int, pad: int = 2
) -> list[list[dict]]:
    """Divide un tramo en repeticiones usando la velocidad de la muneca."""
    if len(frames) < min_frames * 2:
        return [frames]

    speeds = [0.0]
    for i in range(1, len(frames)):
        prev = frames[i - 1]["landmarks"][0]
        cur = frames[i]["landmarks"][0]
        scale = hand_scale(frames[i]["landmarks"])
        speeds.append(math.hypot(cur["x"] - prev["x"], cur["y"] - prev["y"]) / scale)

    # Suavizado con media movil de 3 para evitar cortes por ruido.
    smooth = np.convolve(np.array(speeds), np.ones(3) / 3, mode="same")
    active = smooth > threshold

    segments: list[list[dict]] = []
    start: int | None = None
    for i, is_active in enumerate(active):
        if is_active and start is None:
            start = i
        elif not is_active and start is not None:
            lo = max(0, start - pad)
            hi = min(len(frames), i + pad)
            if hi - lo >= min_frames:
                segments.append(frames[lo:hi])
            start = None
    if start is not None:
        lo = max(0, start - pad)
        if len(frames) - lo >= min_frames:
            segments.append(frames[lo:])

    return segments or [frames]


def resample(frames: list[dict], target: int) -> list[dict]:
    """Remuestrea a `target` frames interpolando linealmente los landmarks."""
    n = len(frames)
    if n == target:
        return frames
    if n < 2:
        return frames * target

    out: list[dict] = []
    for t in np.linspace(0, n - 1, target):
        i0 = int(math.floor(t))
        i1 = min(i0 + 1, n - 1)
        alpha = float(t - i0)
        a, b = frames[i0]["landmarks"], frames[i1]["landmarks"]
        out.append(
            {
                "videoTime": round(
                    frames[i0]["videoTime"] * (1 - alpha)
                    + frames[i1]["videoTime"] * alpha,
                    3,
                ),
                "landmarks": [
                    {
                        "x": round(a[k]["x"] * (1 - alpha) + b[k]["x"] * alpha, 4),
                        "y": round(a[k]["y"] * (1 - alpha) + b[k]["y"] * alpha, 4),
                        "z": round(a[k]["z"] * (1 - alpha) + b[k]["z"] * alpha, 4),
                    }
                    for k in range(len(a))
                ],
            }
        )
    return out


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------

def next_index(roots: list[Path], category: str, label: str) -> int:
    """Continua la numeracion existente para no pisar ejemplos previos."""
    highest = 0
    pattern = re.compile(rf"^{re.escape(label)}_(\d+)\.json$")
    for root in roots:
        folder = root / category
        if not folder.is_dir():
            continue
        for file in folder.glob(f"{label}_*.json"):
            match = pattern.match(file.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def update_manifest(root: Path, category: str, label: str) -> None:
    manifest_path = root / "manifest.json"
    manifest: dict[str, list[str]] = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"  ! manifest ilegible en {manifest_path}, se recrea")
    manifest.setdefault(category, [])
    if label not in manifest[category]:
        manifest[category].append(label)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def write_example(
    roots: list[Path],
    category: str,
    label: str,
    index: int,
    frames: list[dict],
    source: str,
    dry_run: bool,
) -> None:
    payload = [
        {
            "videoTime": f["videoTime"],
            "sign": label,
            "source": source,
            "landmarks": f["landmarks"],
        }
        for f in frames
    ]
    body = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

    for root in roots:
        out_path = root / category / f"{label}_{index}.json"
        rel = out_path.relative_to(root.parent.parent) if root.is_absolute() else out_path
        if dry_run:
            print(f"    [dry-run] {rel} ({len(frames)} frames)")
            continue
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(body, encoding="utf-8")
        update_manifest(root, category, label)
        print(f"    -> {rel} ({len(frames)} frames)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae landmarks de videos MP4 y genera patrones DTW."
    )
    parser.add_argument("--input", required=True, help="Carpeta con los videos")
    parser.add_argument(
        "--category",
        default="palabras",
        help="Categoria destino en training_data (default: palabras)",
    )
    parser.add_argument(
        "--out",
        action="append",
        help="Raiz de salida (repetible). Default: public/training_data/",
    )
    parser.add_argument(
        "--target-frames",
        type=int,
        default=DEFAULT_TARGET_FRAMES,
        help=f"Frames por ejemplo tras remuestrear (default: {DEFAULT_TARGET_FRAMES})",
    )
    parser.add_argument(
        "--min-frames",
        type=int,
        default=6,
        help="Descarta tramos con menos frames (default: 6)",
    )
    parser.add_argument(
        "--segment",
        action="store_true",
        help="Divide cada video en repeticiones por movimiento",
    )
    parser.add_argument(
        "--motion-threshold",
        type=float,
        default=0.18,
        help="Umbral de velocidad para segmentar (default: 0.18)",
    )
    parser.add_argument(
        "--recursive", action="store_true", help="Busca videos en subcarpetas"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="No escribe archivos, solo reporta"
    )
    args = parser.parse_args()

    if args.target_frames > MAX_SAFE_FRAMES:
        print(
            f"! target-frames={args.target_frames} supera {MAX_SAFE_FRAMES}: "
            "la sena no podra hacer match en vivo (buffer del detector = 30)."
        )

    input_dir = Path(args.input).expanduser().resolve()
    if not input_dir.is_dir():
        print(f"No existe la carpeta: {input_dir}")
        return 1

    roots = (
        [Path(p).expanduser().resolve() for p in args.out]
        if args.out
        else [p.resolve() for p in DEFAULT_OUT_ROOTS]
    )

    globber = input_dir.rglob if args.recursive else input_dir.glob
    videos = sorted(p for p in globber("*") if p.suffix.lower() in VIDEO_EXTS)
    if not videos:
        print(f"No se encontraron videos en {input_dir}")
        return 1

    print(f"{len(videos)} video(s) en {input_dir}")
    print(f"Categoria: {args.category}")
    print(f"Salida:    {', '.join(str(r) for r in roots)}\n")

    model = ensure_model(MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    total_written = 0
    labels_done: set[str] = set()

    for video in videos:
        label, explicit_index = slugify_label(video.stem)
        if not label:
            print(f"{video.name}: nombre invalido, omitido")
            continue

        print(f"{video.name} -> {label}")

        # Un landmarker nuevo por video: los timestamps deben reiniciarse.
        with mp_vision.HandLandmarker.create_from_options(options) as landmarker:
            runs = extract_runs(video, landmarker, args.min_frames)

        if not runs:
            print("    sin manos detectadas, omitido\n")
            continue

        segments: list[list[dict]] = []
        for run in runs:
            if args.segment:
                segments.extend(
                    segment_by_motion(run, args.motion_threshold, args.min_frames)
                )
            else:
                segments.append(run)

        # Sin --segment nos quedamos con el tramo mas largo (la sena principal).
        if not args.segment and len(segments) > 1:
            segments = [max(segments, key=len)]

        index = (
            explicit_index
            if explicit_index is not None and len(segments) == 1
            else next_index(roots, args.category, label)
        )

        for segment in segments:
            frames = resample(segment, args.target_frames)
            write_example(
                roots,
                args.category,
                label,
                index,
                frames,
                video.name,
                args.dry_run,
            )
            labels_done.add(label)
            total_written += 1
            index += 1

        print()

    print(
        f"Listo: {total_written} ejemplo(s) de {len(labels_done)} sena(s): "
        f"{', '.join(sorted(labels_done)) or '-'}"
    )
    if not args.dry_run and total_written:
        print("\nSiguiente paso: recompila la web app para empaquetar los nuevos patrones")
        print("  cd .. && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
