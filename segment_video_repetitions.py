"""
Segmenta videos del gobierno LSM que contienen múltiples repeticiones de la misma seña.

Detecta pausas entre repeticiones y extrae solo la mejor ejecución.
"""
from pathlib import Path
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import sys

ROOT = Path(__file__).parent
HAND_MODEL = ROOT / "mediapipe_models" / "hand_landmarker.task"
POSE_MODEL = ROOT / "mediapipe_models" / "pose_landmarker.task"

# Parámetros de segmentación
MIN_PAUSE_FRAMES = 5       # Mínimo de frames sin manos para considerar pausa
MIN_SEGMENT_FRAMES = 10    # Mínimo de frames para una repetición válida
MAX_SEGMENT_FRAMES = 120   # Máximo de frames por repetición (limitar solo al guardar)
MOTION_THRESHOLD = 0.02    # Umbral de movimiento para detectar actividad


def detect_hand_motion(hands_seq: np.ndarray) -> np.ndarray:
    """
    Detecta frames con actividad de manos.
    Returns: array booleano (T,) donde True = hay manos activas
    """
    T = hands_seq.shape[0]
    has_hands = np.zeros(T, dtype=bool)
    
    for t in range(T):
        # Verificar si hay al menos una mano detectada (no todo ceros)
        hand_data = hands_seq[t]  # (2, 21, 3)
        if not np.all(hand_data == 0):
            has_hands[t] = True
    
    return has_hands


def find_segments(has_hands: np.ndarray, min_pause: int, min_segment: int) -> list[tuple[int, int]]:
    """
    Encuentra segmentos de actividad separados por pausas sostenidas.
    Usa suavizado para tolerar frames individuales sin manos dentro de una seña.
    Returns: lista de (start_frame, end_frame) para cada segmento
    """
    T = len(has_hands)
    
    # Suavizar: un frame sin manos no interrumpe el segmento si sus vecinos sí tienen
    # Usar ventana deslizante de tamaño (min_pause//2) para evitar falsos cortes
    smoothed = has_hands.copy().astype(bool)
    gap_tolerance = max(2, min_pause // 2)
    for t in range(gap_tolerance, T - gap_tolerance):
        # Si hay manos antes y después de este gap corto, rellenar
        if not smoothed[t] and smoothed[t - 1] and smoothed[t + 1]:
            smoothed[t] = True
    
    # Ahora detectar segmentos en la señal suavizada
    segments = []
    in_segment = False
    segment_start = 0
    no_hand_count = 0
    
    for t in range(T):
        if smoothed[t]:
            if not in_segment:
                segment_start = t
                in_segment = True
            no_hand_count = 0
        else:
            if in_segment:
                no_hand_count += 1
                if no_hand_count >= min_pause:
                    # Pausa sostenida: cerrar segmento
                    segment_end = t - no_hand_count
                    if segment_end - segment_start >= min_segment:
                        segments.append((segment_start, segment_end))
                    in_segment = False
                    no_hand_count = 0
    
    # Cerrar último segmento
    if in_segment:
        segment_end = T - 1
        if segment_end - segment_start >= min_segment:
            segments.append((segment_start, segment_end))
    
    return segments


def score_segment(hands_seq: np.ndarray, pose_seq: np.ndarray, start: int, end: int) -> float:
    """
    Calcula un score de calidad para un segmento.
    Mayor score = mejor calidad (más frames con manos, más movimiento, pose centrada)
    """
    segment_hands = hands_seq[start:end]
    segment_pose = pose_seq[start:end]
    
    # 1. Porcentaje de frames con manos detectadas
    frames_with_hands = np.sum(~np.all(segment_hands == 0, axis=(1, 2, 3)))
    hand_coverage = frames_with_hands / len(segment_hands)
    
    # 2. Cantidad de movimiento (varianza de posiciones)
    motion = 0.0
    if frames_with_hands > 1:
        # Calcular movimiento promedio de las manos
        for h in range(2):  # ambas manos
            hand_positions = segment_hands[:, h, :, :2]  # solo x,y
            valid_frames = ~np.all(hand_positions == 0, axis=(1, 2))
            if np.sum(valid_frames) > 1:
                motion += np.var(hand_positions[valid_frames])
    
    # 3. Estabilidad de pose (pose centrada y visible)
    frames_with_pose = np.sum(~np.all(segment_pose == 0, axis=(1, 2)))
    pose_coverage = frames_with_pose / len(segment_pose)
    
    # Score combinado (ponderado)
    score = (
        hand_coverage * 0.5 +      # 50% - cobertura de manos
        min(motion, 0.5) * 0.3 +   # 30% - movimiento (limitado a 0.5)
        pose_coverage * 0.2        # 20% - cobertura de pose
    )
    
    return score


def extract_and_segment_video(video_path: Path, hand_lm, pose_lm) -> dict:
    """
    Extrae keypoints y segmenta el video en repeticiones individuales.
    Returns: dict con 'segments' = lista de {hands, pose, score, start, end}
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if src_fps > 120 or src_fps < 5:
        src_fps = 30.0
    
    TARGET_FPS = 15
    skip = max(1, int(round(src_fps / TARGET_FPS)))
    
    hands_seq = []
    pose_seq = []
    frame_idx = 0
    
    print(f"  Extrayendo frames...", end=" ", flush=True)
    
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        
        if frame_idx % skip != 0:
            frame_idx += 1
            continue
        
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        
        # Detectar manos
        hands_arr = np.zeros((2, 21, 3), dtype=np.float32)
        try:
            hres = hand_lm.detect(mp_img)
            if hres.hand_landmarks:
                for h_idx, hand in enumerate(hres.hand_landmarks[:2]):
                    for j, lm in enumerate(hand[:21]):
                        hands_arr[h_idx, j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass
        
        # Detectar pose
        pose_arr = np.zeros((33, 3), dtype=np.float32)
        try:
            pres = pose_lm.detect(mp_img)
            if pres.pose_landmarks:
                for j, lm in enumerate(pres.pose_landmarks[0][:33]):
                    pose_arr[j] = (lm.x, lm.y, lm.z)
        except Exception:
            pass
        
        hands_seq.append(hands_arr)
        pose_seq.append(pose_arr)
        frame_idx += 1
        
        if len(hands_seq) >= 500:  # Límite de seguridad (33s a 15fps)
            break
    
    cap.release()
    
    if len(hands_seq) < MIN_SEGMENT_FRAMES:
        return None
    
    hands_seq = np.stack(hands_seq, axis=0)
    pose_seq = np.stack(pose_seq, axis=0)
    
    print(f"{len(hands_seq)} frames", end=" → ", flush=True)
    
    # Detectar actividad de manos
    has_hands = detect_hand_motion(hands_seq)
    
    # Encontrar segmentos
    segments = find_segments(has_hands, MIN_PAUSE_FRAMES, MIN_SEGMENT_FRAMES)
    
    if not segments:
        # Si no se detectaron pausas, usar todo el video como un segmento
        segments = [(0, len(hands_seq) - 1)]
    
    print(f"{len(segments)} repeticiones", flush=True)
    
    # Evaluar cada segmento
    segment_data = []
    for i, (start, end) in enumerate(segments):
        # Limitar longitud del segmento (recortar exceso del final)
        seg_len = end - start
        if seg_len > MAX_SEGMENT_FRAMES:
            # Centrar el recorte para no perder el inicio de la seña
            trim = (seg_len - MAX_SEGMENT_FRAMES) // 2
            end = end - trim
            start = start + trim
        
        score = score_segment(hands_seq, pose_seq, start, end)
        segment_data.append({
            'hands': hands_seq[start:end],
            'pose': pose_seq[start:end],
            'score': score,
            'start': start,
            'end': end,
            'duration': end - start
        })
        print(f"    Seg {i+1}: frames {start}-{end} ({end-start}f), score={score:.3f}")
    
    return {
        'segments': segment_data,
        'fps': TARGET_FPS,
        'total_frames': len(hands_seq)
    }


def main():
    if len(sys.argv) < 2:
        print("Uso: python segment_video_repetitions.py <video.mp4>")
        print("\nEjemplo:")
        print("  python segment_video_repetitions.py data/training_videos/salud/VIRUS.mp4")
        return 1
    
    video_path = Path(sys.argv[1])
    if not video_path.exists():
        print(f"ERROR: {video_path} no existe")
        return 1
    
    print(f"\n🎬 Analizando: {video_path}")
    print(f"   Categoría: {video_path.parent.name}")
    print(f"   Palabra: {video_path.stem}\n")
    
    # Inicializar MediaPipe
    print("Cargando MediaPipe...")
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
    
    with mp_vision.HandLandmarker.create_from_options(hand_options) as hand_lm, \
         mp_vision.PoseLandmarker.create_from_options(pose_options) as pose_lm:
        
        result = extract_and_segment_video(video_path, hand_lm, pose_lm)
        
        if result is None:
            print("✗ No se pudo procesar el video")
            return 1
        
        segments = result['segments']
        
        print(f"\n📊 RESUMEN:")
        print(f"   Total frames: {result['total_frames']}")
        print(f"   Repeticiones detectadas: {len(segments)}")
        
        if segments:
            best = max(segments, key=lambda s: s['score'])
            print(f"\n🏆 MEJOR REPETICIÓN:")
            print(f"   Frames: {best['start']}-{best['end']} ({best['duration']} frames)")
            print(f"   Score: {best['score']:.3f}")
            print(f"\n💡 Recomendación: Usar solo esta repetición para entrenamiento")
        
    return 0


if __name__ == "__main__":
    sys.exit(main())
