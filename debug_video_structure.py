"""Debug: visualiza frame a frame si hay manos para entender la estructura del video"""
from pathlib import Path
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import sys

ROOT = Path(__file__).parent
HAND_MODEL = ROOT / "mediapipe_models" / "hand_landmarker.task"

def main():
    if len(sys.argv) < 2:
        video_path = ROOT / "data/training_videos/numeros/10.mp4"
    else:
        video_path = Path(sys.argv[1])
    
    print(f"\n🔍 Estructura de: {video_path.name}\n")
    
    hand_options = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(HAND_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    
    cap = cv2.VideoCapture(str(video_path))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    TARGET_FPS = 15
    skip = max(1, int(round(src_fps / TARGET_FPS)))
    
    print(f"FPS: {src_fps:.1f}  |  Total frames raw: {total_frames}  |  Skip: {skip}")
    print(f"Frames a procesar: ~{total_frames // skip}\n")
    
    has_hands = []
    frame_idx = 0
    
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_idx % skip != 0:
                frame_idx += 1
                continue
            
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            
            try:
                hres = hand_lm.detect(mp_img)
                detected = len(hres.hand_landmarks) > 0
            except:
                detected = False
            
            has_hands.append(detected)
            frame_idx += 1
    
    cap.release()
    
    # Visualizar como línea de manos detectadas
    print("Manos detectadas (H=con manos, .=sin manos, cada char = 1 frame):")
    line = ""
    for i, h in enumerate(has_hands):
        line += "H" if h else "."
        if (i + 1) % 80 == 0:
            print(f"  f{i-79:03d}-{i:03d}: {line}")
            line = ""
    if line:
        print(f"  f{len(has_hands)-len(line):03d}-{len(has_hands)-1:03d}: {line}")
    
    print(f"\nTotal: {len(has_hands)} frames")
    print(f"Con manos: {sum(has_hands)} ({100*sum(has_hands)/len(has_hands):.1f}%)")
    print(f"Sin manos: {len(has_hands)-sum(has_hands)}")
    
    # Detectar pausas
    print("\nPausas (bloques sin manos):")
    in_pause = False
    pause_start = 0
    pauses = []
    for i, h in enumerate(has_hands):
        if not h and not in_pause:
            pause_start = i
            in_pause = True
        elif h and in_pause:
            pauses.append((pause_start, i, i - pause_start))
            in_pause = False
    if in_pause:
        pauses.append((pause_start, len(has_hands), len(has_hands) - pause_start))
    
    for start, end, length in sorted(pauses, key=lambda x: -x[2])[:10]:
        print(f"  frames {start:3d}-{end:3d}: {length} frames sin manos")

if __name__ == "__main__":
    main()
