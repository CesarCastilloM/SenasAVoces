"""
reextract_landmarks.py
Re-extrae landmarks de todos los videos en public/videos/signs/
usando MediaPipe HandLandmarker con los parámetros afinados:
  - confianza 0.25, 2 manos, suavizado temporal 0.5, persistencia 10 frames
  - delegate CPU, modo IMAGE
Guarda los JSONs en public/training_data/<categoria>/<SEÑA>_<n>.json
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── Configuración ──
ROOT = Path(__file__).resolve().parent.parent
SIGNS_DIR = ROOT / "public" / "videos" / "signs"
TRAINING_DIR = ROOT / "public" / "training_data"
MANIFEST = TRAINING_DIR / "manifest.json"
HAND_MODEL = str(ROOT / "mediapipe_models" / "hand_landmarker.task")

# Si no existe el modelo local, buscar en el repo hermano o usar URL
if not os.path.exists(HAND_MODEL):
    alt_model = Path(r"C:\Users\Cesar\CascadeProjects\SenasAVoces\mediapipe_models\hand_landmarker.task")
    if alt_model.exists():
        HAND_MODEL = str(alt_model)
    else:
        HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

FRAME_STEP = 1 / 30  # 30fps
SMOOTH = 0.5
MAX_PERSIST = 10
CONFIDENCE = 0.25
TARGET_FPS = 30


def slugify(text):
    text = text.upper().strip()
    text = re.sub(r"[ÁÀÄÂ]", "A", text)
    text = re.sub(r"[ÉÈËÊ]", "E", text)
    text = re.sub(r"[ÍÌÏÎ]", "I", text)
    text = re.sub(r"[ÓÒÖÔ]", "O", text)
    text = re.sub(r"[ÚÙÜÛ]", "U", text)
    text = re.sub(r"Ñ", "N", text)
    text = re.sub(r"[^A-Z0-9_]+", "_", text)
    return text.strip("_")[:40]


def lerp(a, b, t):
    return a + (b - a) * t


def find_video(sign_name):
    """Busca el video de una seña en public/videos/signs/"""
    slug = slugify(sign_name)
    for ext in [".mp4", ".webm", ".mov", ".avi"]:
        # Por slug
        p = SIGNS_DIR / f"{slug}{ext}"
        if p.exists():
            return p
        # Por nombre original
        p = SIGNS_DIR / f"{sign_name}{ext}"
        if p.exists():
            return p
    return None


def lerp_landmarks(a, b, t):
    """Interpola linealmente entre dos listas de 21 landmarks."""
    return [
        {
            "x": round(lerp(a[j]["x"], b[j]["x"], t), 4),
            "y": round(lerp(a[j]["y"], b[j]["y"], t), 4),
            "z": round(lerp(a[j]["z"], b[j]["z"], t), 4),
        }
        for j in range(len(a))
    ]


def fill_gaps(raw_channel):
    """Rellena huecos de un canal de una sola mano (lista de dict|None).

    Huecos internos cortos (<= MAX_PERSIST) se interpolan linealmente para
    preservar el movimiento real. Huecos largos se dejan como None (se pierde
    ese tramo). Los extremos sin detección usan persistencia simple.
    """
    if not any(r is not None for r in raw_channel):
        return [None] * len(raw_channel)

    valid_idx = [i for i, r in enumerate(raw_channel) if r is not None]
    filled = [None] * len(raw_channel)

    for k, i in enumerate(valid_idx):
        filled[i] = raw_channel[i]
        if k == 0:
            continue
        prev_i = valid_idx[k - 1]
        gap = i - prev_i
        if gap <= 1:
            continue
        if gap - 1 <= MAX_PERSIST:
            for g in range(1, gap):
                t = g / gap
                filled[prev_i + g] = lerp_landmarks(raw_channel[prev_i], raw_channel[i], t)

    first_valid, last_valid = valid_idx[0], valid_idx[-1]
    for i in range(0, min(first_valid, MAX_PERSIST)):
        filled[i] = raw_channel[first_valid]
    for i in range(max(last_valid + 1, len(raw_channel) - MAX_PERSIST), len(raw_channel)):
        filled[i] = raw_channel[last_valid]

    return filled


def smooth_channel(filled_channel):
    """Aplica suavizado temporal (EMA) a un canal ya relleno."""
    smoothed_out = [None] * len(filled_channel)
    prev_smoothed = None
    for i, lms_dict in enumerate(filled_channel):
        if lms_dict is None:
            prev_smoothed = None
            continue
        if prev_smoothed:
            smoothed = [
                {
                    "x": round(lerp(prev_smoothed[j]["x"], lms_dict[j]["x"], SMOOTH), 4),
                    "y": round(lerp(prev_smoothed[j]["y"], lms_dict[j]["y"], SMOOTH), 4),
                    "z": round(lerp(prev_smoothed[j]["z"], lms_dict[j]["z"], SMOOTH), 4),
                }
                for j in range(len(lms_dict))
            ]
        else:
            smoothed = lms_dict
        prev_smoothed = smoothed
        smoothed_out[i] = smoothed
    return smoothed_out


def process_video(video_path, hl):
    """Extrae landmarks de AMBAS manos frame por frame de un video.

    Cada mano (Right/Left, según la clasificación de MediaPipe) se procesa
    como un canal independiente: detección cruda -> relleno de huecos
    (interpolación para huecos internos cortos, persistencia en extremos) ->
    suavizado temporal. Un frame de salida se conserva si al menos una mano
    tiene datos en ese instante.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if src_fps > 120 or src_fps < 5:
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        src_fps = max(15.0, min(60.0, total / 4.0)) if total > 30 else 30.0
    skip = max(1, int(round(src_fps / TARGET_FPS)))

    raw_right = []
    raw_left = []
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % skip != 0:
            frame_idx += 1
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        right_lms = None
        left_lms = None
        try:
            res = hl.detect(mp_img)
            if res.hand_landmarks:
                for lms, h in zip(res.hand_landmarks, res.handedness):
                    label = h[0].category_name if h else None
                    if label == "Right" and right_lms is None:
                        right_lms = lms
                    elif label == "Left" and left_lms is None:
                        left_lms = lms
                    elif right_lms is None:
                        right_lms = lms
                    elif left_lms is None:
                        left_lms = lms
        except Exception:
            pass

        raw_right.append(
            [{"x": round(p.x, 4), "y": round(p.y, 4), "z": round(p.z, 4)} for p in right_lms]
            if right_lms else None
        )
        raw_left.append(
            [{"x": round(p.x, 4), "y": round(p.y, 4), "z": round(p.z, 4)} for p in left_lms]
            if left_lms else None
        )

        frame_idx += 1

    cap.release()

    if not any(r is not None for r in raw_right) and not any(r is not None for r in raw_left):
        return None

    filled_right = smooth_channel(fill_gaps(raw_right))
    filled_left = smooth_channel(fill_gaps(raw_left))

    frames = []
    out_frame_idx = 0
    for i in range(len(raw_right)):
        lr, ll = filled_right[i], filled_left[i]
        if lr is None and ll is None:
            continue
        frames.append({
            "videoTime": round(out_frame_idx * FRAME_STEP, 4),
            "landmarksRight": lr,
            "landmarksLeft": ll,
        })
        out_frame_idx += 1

    return frames if len(frames) >= 5 else None


def save_training_json(category, sign_name, frames_data, source):
    """Guarda los landmarks en un JSON de entrenamiento."""
    cat_dir = TRAINING_DIR / category
    cat_dir.mkdir(parents=True, exist_ok=True)

    # Numeración acumulativa
    start_n = 0
    for f in os.listdir(cat_dir):
        m = re.match(
            r"^" + re.escape(sign_name) + r"_(\d+)\.json$", f
        )
        if m:
            start_n = max(start_n, int(m.group(1)))

    n = start_n + 1
    out_path = cat_dir / f"{sign_name}_{n}.json"

    data = [
        {
            "videoTime": f["videoTime"],
            "sign": sign_name,
            "source": source,
            "landmarksRight": f["landmarksRight"],
            "landmarksLeft": f["landmarksLeft"],
        }
        for f in frames_data
    ]

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)

    return out_path


def main():
    print("=== Re-extracción de Landmarks (Python) ===\n")

    # Cargar manifest
    with open(MANIFEST, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    total_signs = sum(len(v) for v in manifest.values())
    print(f"Manifest: {total_signs} señas en {len(manifest)} categorías\n")

    # Inicializar MediaPipe HandLandmarker
    print(f"Inicializando MediaPipe (CPU, IMAGE mode, confianza {CONFIDENCE})...")
    base_options = mp_python.BaseOptions(
        model_asset_path=HAND_MODEL,
        delegate=mp_python.BaseOptions.Delegate.CPU,
    )
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=CONFIDENCE,
        min_hand_presence_confidence=CONFIDENCE,
        min_tracking_confidence=0.2,
    )
    hl = mp_vision.HandLandmarker.create_from_options(options)
    print("MediaPipe listo.\n")

    total = 0
    ok = 0
    fail = 0
    skip = 0
    start_time = time.time()

    for category, signs in manifest.items():
        print(f"\n--- {category.upper()} ({len(signs)} señas) ---")

        for sign in signs:
            total += 1
            slug = slugify(sign)

            video_path = find_video(sign)
            if not video_path:
                print(f"  [{total}] {sign} ⏭️  (sin video)")
                skip += 1
                continue

            print(f"  [{total}] {sign} 📁 {video_path.name}... ", end="", flush=True)

            try:
                frames = process_video(video_path, hl)
                if not frames:
                    print("✗ (sin detección)")
                    fail += 1
                    continue

                out_path = save_training_json(
                    category, slug, frames, video_path.name
                )
                print(f"✓ {len(frames)} frames → {out_path.name}")
                ok += 1
            except Exception as e:
                print(f"✗ {e}")
                fail += 1

    hl.close()
    elapsed = time.time() - start_time

    print(f"\n=== Resumen ===")
    print(f"Total: {total} | OK: {ok} | Fallidos: {fail} | Sin video: {skip}")
    print(f"Tiempo: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
