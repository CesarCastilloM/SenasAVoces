"""Diagnostico: extrae keypoints de un solo video para verificar pipeline."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from train_from_videos import (
    extract_keypoints_from_video,
    normalize_pose_relative,
    normalize_hands_relative,
    HAND_MODEL, POSE_MODEL,
)

videos_dir = Path('data/training_videos/numeros')
videos = sorted(list(videos_dir.glob('*.*')))
if not videos:
    print('No hay videos en numeros/')
    sys.exit(1)

video = videos[0]
print(f'Video de prueba: {video.name}  ({video.stat().st_size//1024} KB)')

hand_options = mp_vision.HandLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL)),
    running_mode=mp_vision.RunningMode.VIDEO,
    num_hands=2,
    min_hand_detection_confidence=0.3,
    min_hand_presence_confidence=0.3,
    min_tracking_confidence=0.3,
)
pose_options = mp_vision.PoseLandmarkerOptions(
    base_options=mp_python.BaseOptions(model_asset_path=str(POSE_MODEL)),
    running_mode=mp_vision.RunningMode.VIDEO,
    min_pose_detection_confidence=0.3,
    min_pose_presence_confidence=0.3,
    min_tracking_confidence=0.3,
)

with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
     mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:
    data = extract_keypoints_from_video(video, hand_lm, pose_lm)
    if data is None:
        print('[ERR] extract_keypoints_from_video devolvio None')
        sys.exit(1)
    h = data['hands']
    valid_raw = sum(1 for t in range(h.shape[0]) if not np.all(h[t, 0] == 0))
    print(f'[OK] Hands shape: {h.shape}')
    print(f'[OK] Pose shape: {data["pose"].shape}')
    print(f'[OK] Frames con mano detectada (raw): {valid_raw}/{h.shape[0]}')

    data['pose'] = normalize_pose_relative(data['pose'])
    data['hands'] = normalize_hands_relative(data['hands'], data['pose'])
    h2 = data['hands']
    valid_norm = sum(1 for t in range(h2.shape[0]) if not np.all(h2[t, 0] == 0))
    print(f'[OK] Frames despues de normalizar: {valid_norm}/{h2.shape[0]}')
    if valid_norm > 0:
        print(f'[OK] Range mano0: min={h2[:,0].min():.3f}, max={h2[:,0].max():.3f}, mean={h2[:,0].mean():.3f}')
        print('[SUCCESS] Pipeline funciona — listo para procesar todos los videos')
    else:
        print('[FAIL] Despues de normalizar todo es cero — bug en normalize_hands_relative')
