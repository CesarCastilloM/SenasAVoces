"""Escanea data/training_videos/**/*.{webm,mp4,mkv,mov,avi} y genera plantillas NPZ
en data/templates/{categoria}/{slug}.npz — sin depender del glosario.

Uso: python train_scan.py
"""
from pathlib import Path
import sys, json, time, numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# Reusar funciones del script principal
from train_from_videos import (
    extract_keypoints_from_video, normalize_pose_relative,
    normalize_hands_relative, slugify, HAND_MODEL, POSE_MODEL,
)

VIDEOS_DIR    = ROOT / "data" / "training_videos"
TEMPLATES_DIR = ROOT / "data" / "templates"
EXTS = (".webm", ".mp4", ".mkv", ".mov", ".avi")


def main():
    if not VIDEOS_DIR.exists():
        print(f"ERROR: no existe {VIDEOS_DIR}")
        return 1

    # Recolectar videos
    videos = []
    for cat_dir in sorted(VIDEOS_DIR.iterdir()):
        if not cat_dir.is_dir():
            continue
        for v in sorted(cat_dir.iterdir()):
            if v.suffix.lower() in EXTS:
                videos.append((cat_dir.name, v))

    if not videos:
        print(f"⚠️  No hay videos en {VIDEOS_DIR}")
        return 0

    print(f"📹 Encontrados {len(videos)} video(s):")
    for cat, v in videos:
        print(f"  - {cat}/{v.name}  ({v.stat().st_size//1024} KB)")
    print()

    # Inicializar landmarkers
    print("[INFO] Cargando MediaPipe...")
    hand_options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    pose_options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(POSE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )

    full_index = {}
    n_ok = 0
    n_fail = 0
    # IMAGE mode no tiene restricciones de timestamp; reusamos el mismo Landmarker.
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:

      for cat, video_path in videos:
        label = video_path.stem
        slug = slugify(label)
        cat_dir = TEMPLATES_DIR / cat
        cat_dir.mkdir(parents=True, exist_ok=True)
        out_path = cat_dir / f"{slug}.npz"

        print(f"\n[{cat}] {label}", flush=True)
        t0 = time.time()
        try:
            data = extract_keypoints_from_video(video_path, hand_lm, pose_lm)
        except Exception as ex:
            print(f"  [ERR] {ex}")
            n_fail += 1
            continue

        if data is None:
            print(f"  [SKIP] no se pudo extraer keypoints")
            n_fail += 1
            continue

        # Verificar que se hayan detectado manos
        h_raw = data["hands"]
        valid_frames = sum(1 for t in range(h_raw.shape[0]) if not np.all(h_raw[t, 0] == 0))
        if valid_frames < 3:
            print(f"  [SKIP] {valid_frames} frames con mano (muy pocos)")
            n_fail += 1
            continue

        data["pose"]  = normalize_pose_relative(data["pose"])
        data["hands"] = normalize_hands_relative(data["hands"], data["pose"])

        np.savez_compressed(
            out_path,
            hands=data["hands"].astype(np.float32),
            pose=data["pose"].astype(np.float32),
            fps=np.array([data["fps"]], dtype=np.int32),
            label=np.array([label], dtype="U64"),
        )
        elapsed = time.time() - t0
        print(f"  [OK] {valid_frames}/{data['hands'].shape[0]} frames con mano ({elapsed:.1f}s)")
        n_ok += 1

        full_index.setdefault(cat, []).append({
            "label": label, "slug": slug,
            "frames": int(data["hands"].shape[0]),
            "valid_frames": valid_frames,
            "path": str(out_path.relative_to(ROOT)).replace("\\", "/"),
        })

    print(f"\n[RESUMEN] {n_ok} exitosas, {n_fail} fallidas, total {n_ok + n_fail}")

    # Guardar índice global
    if full_index:
        idx_path = TEMPLATES_DIR / "index.json"
        TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
        idx_path.write_text(json.dumps(full_index, ensure_ascii=False, indent=2),
                            encoding="utf-8")
        print(f"\n✅ Índice global: {idx_path}")
        total = sum(len(v) for v in full_index.values())
        print(f"   {total} plantilla(s) en {len(full_index)} categoría(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
