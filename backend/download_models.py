"""Download MediaPipe model files required for inference."""
import urllib.request
import os

MODELS = {
    "mediapipe_models/gesture_recognizer.task":
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    "mediapipe_models/hand_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "mediapipe_models/pose_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    "mediapipe_models/face_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}

os.makedirs("mediapipe_models", exist_ok=True)

for path, url in MODELS.items():
    if os.path.exists(path):
        print(f"  [SKIP] {path} already exists")
        continue
    print(f"  Downloading {path}...")
    urllib.request.urlretrieve(url, path)
    size = os.path.getsize(path) / 1024 / 1024
    print(f"  [OK] {path} ({size:.1f} MB)")

print("\nDone. Run: python main.py")
