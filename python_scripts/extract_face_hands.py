"""Extrae landmarks de AMBAS manos + cara desde videos y genera .npy para entrenamiento.

Combina HandLandmarker (42 puntos) + FaceLandmarker (subset de 72 puntos relevantes
para LSM: cejas, ojos, parpados, boca, mejillas, nariz, menton).

Salida: .npy con shape [N, 114, 3] (42 manos + 72 cara).
Los frames sin cara quedan en ceros para la parte facial.

Uso:
    python extract_face_hands.py --input ../public/videos/signs --manifest ../public/training_data/manifest.json
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

HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)
MODELS_DIR = Path(__file__).parent / "models"

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}
TARGET_FRAMES = 24
MIN_FRAMES = 6
LM_COUNT = 21
HAND_LM = LM_COUNT * 2  # 42

# MediaPipe Face Landmarker devuelve 478 puntos.
# Seleccionamos los relevantes para lengua de senas:
# - Cejas (0-4 derecha, 5-9 izquierda) = 10
# - Ojos y parpados (130-135, 145-150, 159-163, 173-177, 33-37, 46-50, 53-55, 58-62, 63-65, 70-74) ~ 30
# - Boca (61, 78, 80, 81, 82, 84, 87, 88, 91, 95, 96, 97, 146, 178, 181, 185, 191, 291, 308, 310, 311, 312, 314, 317, 318, 321, 324, 325, 326, 327, 376, 402, 405, 409, 415) ~ 35
# - Nariz (1, 2, 4, 5, 6, 19, 20, 94, 168, 197) ~ 10
# - Mejillas y menton (10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 132, 136, 137, 138, 139, 140, 141, 142, 143, 144, 147, 148, 149, 151, 152, 153, 154, 155, 157, 158, 159, 160, 161, 162, 164, 165, 166, 167, 169, 170, 171, 172, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 309, 313, 315, 316, 319, 320, 322, 323, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 377, 378, 379, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 403, 404, 406, 407, 408, 410, 411, 412, 413, 414, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477)
# Para mantenerlo simple y relevante, usamos un subset curado:

FACE_LM_INDICES = [
    # Cejas (10)
    0, 1, 2, 3, 4,          # ceja derecha
    5, 6, 7, 8, 9,          # ceja izquierda
    # Ojos y parpados (20)
    33, 130, 133, 144, 145, 153, 154, 155, 157, 158,   # ojo derecho
    263, 362, 363, 373, 374, 380, 381, 382, 384, 385,  # ojo izquierdo
    # Boca (30)
    61, 78, 80, 81, 82, 84, 87, 88, 91, 95,
    96, 97, 146, 178, 181, 185, 191,
    291, 308, 310, 311, 312, 314, 317, 318, 321, 324,
    325, 326, 327, 376, 402, 405, 409, 415,
    # Nariz (8) - indices no duplicados con cejas
    19, 20, 168,
    # Mejillas y contorno facial (14)
    10, 13, 14, 17, 18, 21, 23, 28, 32, 116, 117, 152, 172, 234,
]

FACE_LM_COUNT = len(FACE_LM_INDICES)  # 82
TOTAL_LM = HAND_LM + FACE_LM_COUNT    # 42 + 82 = 124

MAX_SLOT_JUMP = 0.25


def slugify_label(stem: str) -> str:
    ascii_stem = (
        unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    )
    return re.sub(r"[^A-Za-z0-9]+", "_", ascii_stem).strip("_").upper()


def ensure_model(url: str, path: Path) -> Path:
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Descargando modelo -> {path}")
    urllib.request.urlretrieve(url, path)
    return path


def hand_to_array(hand) -> np.ndarray:
    out = np.zeros((LM_COUNT, 3), dtype=np.float32)
    for j, p in enumerate(hand[:LM_COUNT]):
        out[j] = (float(p.x), float(p.y), float(p.z))
    return out


def face_to_array(face_landmarks) -> np.ndarray:
    out = np.zeros((FACE_LM_COUNT, 3), dtype=np.float32)
    for i, idx in enumerate(FACE_LM_INDICES):
        if idx < len(face_landmarks):
            p = face_landmarks[idx]
            out[i] = (float(p.x), float(p.y), float(p.z))
    return out


def assign_slots(hands, handedness, prev_wrists) -> np.ndarray:
    arr = np.zeros((HAND_LM, 3), dtype=np.float32)
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
        direct = [d for d in (dist(w0, pr), dist(w1, pl)) if d is not None]
        swapped = [d for d in (dist(w1, pr), dist(w0, pl)) if d is not None]

        if direct and swapped:
            use_swap = sum(swapped) < sum(direct)
        else:
            use_swap = labels[0] == "Left" or labels[1] == "Right"

        right_mat, left_mat = (mats[1], mats[0]) if use_swap else (mats[0], mats[1])
        arr[:LM_COUNT] = right_mat
        arr[LM_COUNT:] = left_mat
        return arr

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


def extract_frames(video_path: Path, hand_landmarker, face_landmarker) -> list[np.ndarray]:
    """Devuelve frames con al menos una mano, como arrays [TOTAL_LM, 3].
    Hace dos pasadas: primero manos, luego cara en los mismos frames."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  ! No se pudo abrir {video_path.name}")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    raw_frames = []
    frame_idx = 0

    # Pasada 1: extraer manos y guardar los frames RGB donde hay manos
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        raw_frames.append(rgb)
        frame_idx += 1
    cap.release()

    # Procesar manos
    hand_frames = []  # (hand_arr, frame_idx)
    prev_wrists: dict[str, tuple[float, float]] = {}
    for i, rgb in enumerate(raw_frames):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(i * 1000 / fps)
        try:
            hand_result = hand_landmarker.detect(mp_image)
        except Exception:
            hand_result = None

        hands = hand_result.hand_landmarks if hand_result else []
        handedness = hand_result.handedness if hand_result else []

        if not hands:
            continue

        hand_arr = assign_slots(hands, handedness, prev_wrists)
        for slot, base in (("right", 0), ("left", LM_COUNT)):
            pt = hand_arr[base, :2]
            if pt[0] != 0 or pt[1] != 0:
                prev_wrists[slot] = (float(pt[0]), float(pt[1]))

        hand_frames.append((hand_arr, i))

    if not hand_frames:
        return []

    # Pasada 2: extraer cara en los mismos frames donde hubo manos
    frames = []
    for hand_arr, i in hand_frames:
        rgb = raw_frames[i]
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int(i * 1000 / fps)

        face_arr = np.zeros((FACE_LM_COUNT, 3), dtype=np.float32)
        try:
            face_result = face_landmarker.detect(mp_image)
            if face_result.face_landmarks:
                face_arr = face_to_array(face_result.face_landmarks[0])
        except Exception:
            pass

        combined = np.concatenate([hand_arr, face_arr], axis=0)
        frames.append(combined)

    return frames


def resample(frames: list[np.ndarray], target: int) -> np.ndarray:
    n = len(frames)
    stacked = np.stack(frames)  # [n, TOTAL_LM, 3]
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
        blended = a * (1 - alpha) + b * alpha
        a_missing = np.all(a == 0, axis=1)
        b_missing = np.all(b == 0, axis=1)
        blended[a_missing & ~b_missing] = b[a_missing & ~b_missing]
        blended[~a_missing & b_missing] = a[~a_missing & b_missing]
        blended[a_missing & b_missing] = 0.0
        out[idx] = blended
    return out


def hand_stats(arr: np.ndarray) -> tuple[int, int]:
    right = int(np.sum(np.any(arr[:, :LM_COUNT, :2] != 0, axis=(1, 2))))
    left = int(np.sum(np.any(arr[:, LM_COUNT:HAND_LM, :2] != 0, axis=(1, 2))))
    return right, left


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae manos + cara de videos y genera patrones .npy"
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
    parser.add_argument("--only", default=None, help="Procesa solo esta sena")
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
    print(f"hand+face, target_frames={args.target_frames}, total_lm={TOTAL_LM}")
    print(f"  hand_lm={HAND_LM}, face_lm={FACE_LM_COUNT}\n")

    hand_model = ensure_model(HAND_MODEL_URL, MODELS_DIR / "hand_landmarker.task")
    face_model = ensure_model(FACE_MODEL_URL, MODELS_DIR / "face_landmarker.task")

    hand_options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(hand_model)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    face_options = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(face_model)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.3,
        min_face_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )

    written = 0
    skipped: list[str] = []

    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.FaceLandmarker.create_from_options(face_options) as face_lm:

        for video in videos:
            label = slugify_label(video.stem)
            if not label:
                continue

            frames = extract_frames(video, hand_lm, face_lm)

            if len(frames) < args.min_frames:
                print(f"{label}: solo {len(frames)} frames con mano, omitido")
                skipped.append(label)
                continue

            arr = resample(frames, args.target_frames)
            n_right, n_left = hand_stats(arr)

            category = sign_to_cat.get(label, "palabras")
            out_dir = out_root / category
            out_file = out_dir / f"{label}_1.npy"

            face_present = int(np.sum(np.any(arr[:, HAND_LM:, :2] != 0, axis=(1, 2))))
            print(
                f"{label} [{category}] R:{n_right}/{args.target_frames} "
                f"L:{n_left}/{args.target_frames} "
                f"Face:{face_present}/{args.target_frames} <- {video.name}"
            )

            if not args.dry_run:
                out_dir.mkdir(parents=True, exist_ok=True)
                np.save(out_file, arr)
                written += 1

    print(f"\nListo: {written} archivo(s) base escritos")
    if skipped:
        print(f"Omitidos: {len(skipped)} -> {', '.join(skipped)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
