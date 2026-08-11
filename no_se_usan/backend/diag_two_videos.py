"""Diagnostico: simula EXACTAMENTE lo que hace train_scan.py para 2 videos seguidos."""
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

# Probar con AMARILLO (que sabemos funciona) seguido de un numero (que falla)
videos = [
    Path('data/training_videos/colores/AMARILLO.mp4'),
    Path('data/training_videos/numeros/1.mp4'),
    Path('data/training_videos/numeros/2.mp4'),
]
videos = [v for v in videos if v.exists()]
print(f'Videos: {[v.name for v in videos]}')

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

# IMAGE mode: reusamos landmarker para todos los videos (sin restricciones de timestamp)
import time
with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
     mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:
    for video in videos:
        t0 = time.time()
        print(f'\n=== {video} ===')
        data = extract_keypoints_from_video(video, hand_lm, pose_lm)
        if data is None:
            print(' [ERR] None')
            continue
        h = data['hands']
        valid_raw = sum(1 for t in range(h.shape[0]) if not np.all(h[t, 0] == 0))
        print(f' Raw hands: {valid_raw}/{h.shape[0]} frames con mano  ({time.time()-t0:.1f}s)')
        data['pose'] = normalize_pose_relative(data['pose'])
        data['hands'] = normalize_hands_relative(data['hands'], data['pose'])
        h2 = data['hands']
        valid = sum(1 for t in range(h2.shape[0]) if not np.all(h2[t, 0] == 0))
        print(f' Despues normalizar: {valid}/{h2.shape[0]} frames con mano')
