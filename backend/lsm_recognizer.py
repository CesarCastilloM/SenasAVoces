"""
LSM Recognizer — Reconocimiento en tiempo real de LSM usando modelos ML
=======================================================================

Reemplaza/extiende la lógica de lsm_teacher.py con modelos entrenados.
Soporta:
- Clasificador estático (frame único): A-Z + Ñ + 1-10
- Clasificador dinámico (secuencia): J, K, Ñ, Q, X, Z + 11-20

Uso:
    from lsm_recognizer import LSMRecognizer
    
    recognizer = LSMRecognizer(
        static_model='models/lsm_static_classifier.tflite',
        dynamic_model='models/lsm_dynamic_classifier_lstm.tflite',
        threshold=0.85
    )
    
    # Cada frame:
    result = recognizer.update(landmarks)
    # result['final_pred'] contiene la seña reconocida
"""

from __future__ import annotations
import json
import time
import threading
from pathlib import Path
from collections import deque
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

import numpy as np

# Definir _ROOT para toda la librería
_ROOT = Path(__file__).resolve().parent.parent

# Importar extractor de features
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lsm_features import (
    extract_single_frame_features, 
    extract_sequence_features,
    validate_landmarks,
    compute_velocity_features,
    WRIST, INDEX_TIP, MIDDLE_TIP, PINKY_TIP
)

# =============================================================================
# Constantes
# =============================================================================

# Ventanas temporales
STATIC_WINDOW = 5      # Frames para promediar predicciones estáticas
DYNAMIC_WINDOW = 30    # Frames para secuencia dinámica
MOTION_THRESHOLD = 0.03  # Umbral para detectar movimiento

# Señas dinámicas (debe coincidir con lsm_data_collector.DYNAMIC_SIGNS)
DYNAMIC_SIGNS = {'J', 'K', 'Ñ', 'Q', 'X', 'Z', 'RR'}
NUMBERS_DYNAMIC = {'10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'}
ALL_DYNAMIC = DYNAMIC_SIGNS | NUMBERS_DYNAMIC


# =============================================================================
# Detector de movimiento
# =============================================================================

class MotionDetector:
    """Detecta si hay movimiento significativo en la mano."""
    
    def __init__(self, window_size: int = 10, threshold: float = MOTION_THRESHOLD):
        self.window_size = window_size
        self.threshold = threshold
        self.buffer: deque = deque(maxlen=window_size)
        self.prev_landmarks: Optional[np.ndarray] = None
    
    def update(self, landmarks: Optional[np.ndarray]) -> bool:
        """
        Actualiza con nuevos landmarks y retorna si hay movimiento.
        
        Args:
            landmarks: array (21, 3) o None
        
        Returns:
            True si se detectó movimiento
        """
        if landmarks is None or not validate_landmarks(landmarks):
            self.prev_landmarks = None
            return False
        
        if self.prev_landmarks is None:
            self.prev_landmarks = landmarks.copy()
            return False
        
        # Calcular desplazamiento del centro de masa (wrist)
        wrist_delta = np.linalg.norm(landmarks[WRIST] - self.prev_landmarks[WRIST])
        
        # Calcular desplazamiento de puntas de dedos
        tips_delta = 0
        for tip in [INDEX_TIP, MIDDLE_TIP, PINKY_TIP]:
            tips_delta += np.linalg.norm(landmarks[tip] - self.prev_landmarks[tip])
        tips_delta /= 3
        
        # Movimiento total
        motion = wrist_delta + tips_delta
        self.buffer.append(motion)
        
        self.prev_landmarks = landmarks.copy()
        
        # Verificar si hay movimiento sostenido
        if len(self.buffer) >= 5:
            recent_motion = sum(list(self.buffer)[-5:]) / 5
            return recent_motion > self.threshold
        
        return False
    
    def reset(self):
        """Resetea el detector."""
        self.buffer.clear()
        self.prev_landmarks = None
    
    @property
    def current_motion_level(self) -> float:
        """Retorna el nivel actual de movimiento."""
        if not self.buffer:
            return 0.0
        return float(np.mean(self.buffer))


# =============================================================================
# Reconocedor LSM
# =============================================================================

class LSMRecognizer:
    """
    Sistema de reconocimiento de LSM en tiempo real.
    
    Combina:
    - Clasificador estático para señas sin movimiento
    - Clasificador dinámico para señas con movimiento
    - Detector de movimiento para elegir qué modelo usar
    """
    
    def __init__(self, 
                 static_model_path: Optional[str] = None,
                 dynamic_model_path: Optional[str] = None,
                 threshold: float = 0.75,
                 use_threading: bool = False):
        """
        Inicializa el reconocedor.
        
        Args:
            static_model_path: ruta a modelo TFLite estático
            dynamic_model_path: ruta a modelo TFLite dinámico  
            threshold: umbral de confianza mínima
            use_threading: si True, corre inferencia en hilo separado
        """
        self.threshold = threshold
        self.use_threading = use_threading
        
        # Cargar modelos
        self.static_interpreter = None
        self.dynamic_interpreter = None
        self.static_model = None
        self.dynamic_model = None
        self.static_classes: List[str] = []
        self.dynamic_classes: List[str] = []
        
        if static_model_path and Path(static_model_path).exists():
            self._load_static_model(static_model_path)
        
        if dynamic_model_path and Path(dynamic_model_path).exists():
            self._load_dynamic_model(dynamic_model_path)
        
        # Estado
        self.motion_detector = MotionDetector()
        self.frame_buffer: deque = deque(maxlen=DYNAMIC_WINDOW)
        self.static_buffer: deque = deque(maxlen=STATIC_WINDOW)
        
        self.last_prediction: Optional[str] = None
        self.last_confidence: float = 0.0
        self.prediction_count: Dict[str, int] = {}
        
        # Para threading
        self._inference_thread: Optional[threading.Thread] = None
        self._latest_result: Optional[Dict] = None
        self._running = False
    
    def _load_static_model(self, path: str):
        """Carga modelo estático (TFLite o Keras)."""
        try:
            import tensorflow as tf
            
            if path.endswith('.tflite'):
                self.static_interpreter = tf.lite.Interpreter(model_path=path)
                self.static_interpreter.allocate_tensors()
                self.static_model_type = 'tflite'
            else:
                # Cargar modelo Keras
                self.static_model = tf.keras.models.load_model(path)
                self.static_interpreter = None
                self.static_model_type = 'keras'
            
            # Cargar clases
            classes_path = Path(path).parent / "lsm_static_classes.json"
            if classes_path.exists():
                with open(classes_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.static_classes = data.get('classes', [])
            
            print(f"[OK] Modelo estático cargado: {path}")
            print(f"     Clases: {len(self.static_classes)}")
            print(f"     Tipo: {self.static_model_type}")
        
        except Exception as e:
            print(f"[ERROR] No se pudo cargar modelo estático: {e}")
            self.static_interpreter = None
            self.static_model = None
    
    def _load_dynamic_model(self, path: str):
        """Carga modelo dinámico (TFLite o Keras)."""
        try:
            import tensorflow as tf
            
            if path.endswith('.tflite'):
                self.dynamic_interpreter = tf.lite.Interpreter(model_path=path)
                self.dynamic_interpreter.allocate_tensors()
                self.dynamic_model_type = 'tflite'
            else:
                # Cargar modelo Keras
                self.dynamic_model = tf.keras.models.load_model(path)
                self.dynamic_interpreter = None
                self.dynamic_model_type = 'keras'
            
            # Cargar clases
            classes_path = Path(path).parent / "lsm_dynamic_classes.json"
            if classes_path.exists():
                with open(classes_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.dynamic_classes = data.get('classes', [])
            
            print(f"[OK] Modelo dinámico cargado: {path}")
            print(f"     Clases: {len(self.dynamic_classes)}")
            print(f"     Tipo: {self.dynamic_model_type}")
        
        except Exception as e:
            print(f"[ERROR] No se pudo cargar modelo dinámico: {e}")
            self.dynamic_interpreter = None
            self.dynamic_model = None
    
    def _predict_static(self, landmarks: np.ndarray) -> Tuple[str, float]:
        """
        Predice clase estática a partir de landmarks.
        
        Returns:
            (clase, confianza)
        """
        if self.static_interpreter is None and not hasattr(self, 'static_model'):
            return "", 0.0
        
        try:
            # Extraer features
            features = extract_single_frame_features(landmarks)
            features = features.reshape(1, -1).astype(np.float32)
            
            # Inferencia según tipo de modelo
            if hasattr(self, 'static_model_type') and self.static_model_type == 'keras':
                output = self.static_model.predict(features, verbose=0)[0]
            else:
                # TFLite
                input_details = self.static_interpreter.get_input_details()
                output_details = self.static_interpreter.get_output_details()
                
                self.static_interpreter.set_tensor(input_details[0]['index'], features)
                self.static_interpreter.invoke()
                output = self.static_interpreter.get_tensor(output_details[0]['index'])[0]
            
            # Obtener clase con mayor probabilidad
            pred_idx = np.argmax(output)
            confidence = float(output[pred_idx])
            
            if pred_idx < len(self.static_classes):
                return self.static_classes[pred_idx], confidence
            
            return "", 0.0
        
        except Exception as e:
            print(f"[WARN] Error en predicción estática: {e}")
            return "", 0.0
    
    def _predict_dynamic(self, sequence: List[np.ndarray]) -> Tuple[str, float]:
        """
        Predice clase dinámica a partir de secuencia de landmarks.
        
        Returns:
            (clase, confianza)
        """
        if (self.dynamic_interpreter is None and not hasattr(self, 'dynamic_model')) or len(sequence) < 10:
            return "", 0.0
        
        try:
            # Extraer features de secuencia
            features = extract_sequence_features(sequence, target_frames=DYNAMIC_WINDOW)
            features = features.reshape(1, -1).astype(np.float32)
            
            # Inferencia según tipo de modelo
            if hasattr(self, 'dynamic_model_type') and self.dynamic_model_type == 'keras':
                output = self.dynamic_model.predict(features, verbose=0)[0]
            else:
                # TFLite
                input_details = self.dynamic_interpreter.get_input_details()
                output_details = self.dynamic_interpreter.get_output_details()
                
                self.dynamic_interpreter.set_tensor(input_details[0]['index'], features)
                self.dynamic_interpreter.invoke()
                output = self.dynamic_interpreter.get_tensor(output_details[0]['index'])[0]
            
            # Obtener clase con mayor probabilidad
            pred_idx = np.argmax(output)
            confidence = float(output[pred_idx])
            
            if pred_idx < len(self.dynamic_classes):
                return self.dynamic_classes[pred_idx], confidence
            
            return "", 0.0
        
        except Exception as e:
            print(f"[WARN] Error en predicción dinámica: {e}")
            return "", 0.0
    
    def predict_frame(self, landmarks: np.ndarray) -> Tuple[str, float]:
        """
        Predice usando solo el modelo estático (un frame).
        
        Args:
            landmarks: array (21, 3)
        
        Returns:
            (clase, confianza)
        """
        return self._predict_static(landmarks)
    
    def predict_sequence(self, landmark_buffer: deque) -> Tuple[str, float]:
        """
        Predice usando el modelo dinámico (secuencia).
        
        Args:
            landmark_buffer: buffer de landmarks (deque)
        
        Returns:
            (clase, confianza)
        """
        sequence = list(landmark_buffer)
        return self._predict_dynamic(sequence)
    
    def update(self, landmarks: Optional[np.ndarray]) -> Dict:
        """
        Actualiza con nuevos landmarks y retorna estado completo.
        
        Este es el método principal a llamar cada frame.
        
        Args:
            landmarks: array (21, 3) o None si no hay mano
        
        Returns:
            {
                'static_pred': str,      # Predicción estática
                'static_conf': float,    # Confianza estática
                'dynamic_pred': str,     # Predicción dinámica
                'dynamic_conf': float,   # Confianza dinámica
                'final_pred': str,       # Predicción final combinada
                'final_conf': float,     # Confianza final
                'is_moving': bool,       # Hay movimiento detectado
                'motion_level': float,   # Nivel de movimiento (0-1)
                'buffer_size': int,      # Frames en buffer
            }
        """
        result = {
            'static_pred': "",
            'static_conf': 0.0,
            'dynamic_pred': "",
            'dynamic_conf': 0.0,
            'final_pred': "",
            'final_conf': 0.0,
            'is_moving': False,
            'motion_level': 0.0,
            'buffer_size': len(self.frame_buffer),
        }
        
        if landmarks is None or not validate_landmarks(landmarks):
            # No hay mano detectada
            self.motion_detector.reset()
            return result
        
        # Detectar movimiento
        is_moving = self.motion_detector.update(landmarks)
        motion_level = self.motion_detector.current_motion_level
        
        result['is_moving'] = is_moving
        result['motion_level'] = motion_level
        
        # Agregar al buffer
        self.frame_buffer.append(landmarks.copy())
        
        # Predicción estática
        static_pred, static_conf = self._predict_static(landmarks)
        result['static_pred'] = static_pred
        result['static_conf'] = static_conf
        
        # Acumular predicciones estáticas para suavizado
        if static_conf > self.threshold:
            self.static_buffer.append((static_pred, static_conf))
        
        # Calcular predicción estática suavizada
        if len(self.static_buffer) >= 3:
            # Votación ponderada por confianza
            votes: Dict[str, float] = {}
            for pred, conf in self.static_buffer:
                votes[pred] = votes.get(pred, 0) + conf
            
            best_static = max(votes.items(), key=lambda x: x[1])
            static_pred_smooth = best_static[0]
            static_conf_smooth = best_static[1] / len(self.static_buffer)
        else:
            static_pred_smooth = static_pred
            static_conf_smooth = static_conf
        
        # Predicción dinámica (si hay suficientes frames y movimiento)
        dynamic_pred, dynamic_conf = "", 0.0
        
        if len(self.frame_buffer) >= 15:  # Mínimo para dinámica
            # Solo si hay movimiento o la estática es débil
            if is_moving or static_conf_smooth < 0.6:
                sequence = list(self.frame_buffer)
                dynamic_pred, dynamic_conf = self._predict_dynamic(sequence)
        
        result['dynamic_pred'] = dynamic_pred
        result['dynamic_conf'] = dynamic_conf
        
        # Decisión final: combinar ambos modelos
        final_pred = ""
        final_conf = 0.0
        
        if dynamic_conf > self.threshold and is_moving:
            # Priorizar dinámico si hay movimiento y confianza alta
            final_pred = dynamic_pred
            final_conf = dynamic_conf
        elif static_conf_smooth > self.threshold:
            # Usar estático si confianza es suficiente
            final_pred = static_pred_smooth
            final_conf = static_conf_smooth
        else:
            # Sin predicción clara
            final_pred = ""
            final_conf = max(static_conf_smooth, dynamic_conf)
        
        # Verificar coherencia temporal
        if final_pred:
            self.prediction_count[final_pred] = self.prediction_count.get(final_pred, 0) + 1
            
            # Requerir consistencia temporal
            if self.prediction_count[final_pred] < 3:
                # No suficientemente consistente aún
                final_pred = ""
                final_conf *= 0.5
        
        # Resetear contadores de otras predicciones
        for k in list(self.prediction_count.keys()):
            if k != final_pred:
                self.prediction_count[k] = 0
        
        result['final_pred'] = final_pred
        result['final_conf'] = final_conf
        
        self.last_prediction = final_pred
        self.last_confidence = final_conf
        
        return result
    
    def reset(self):
        """Resetea el estado del reconocedor."""
        self.motion_detector.reset()
        self.frame_buffer.clear()
        self.static_buffer.clear()
        self.prediction_count.clear()
        self.last_prediction = None
        self.last_confidence = 0.0
    
    @property
    def is_ready(self) -> bool:
        """Retorna True si al menos un modelo está cargado."""
        return (self.static_interpreter is not None or self.static_model is not None or 
                self.dynamic_interpreter is not None or self.dynamic_model is not None)
    
    @property
    def has_static(self) -> bool:
        """Retorna True si el modelo estático está cargado."""
        return self.static_interpreter is not None or self.static_model is not None
    
    @property
    def has_dynamic(self) -> bool:
        """Retorna True si el modelo dinámico está cargado."""
        return self.dynamic_interpreter is not None or self.dynamic_model is not None


# =============================================================================
# Integración con lsm_teacher
# =============================================================================

def create_recognizer_from_models(models_dir: Optional[str] = None,
                                   threshold: float = 0.75) -> LSMRecognizer:
    """
    Crea un recognizer buscando modelos en el directorio.
    
    Args:
        models_dir: directorio con modelos (default: models/)
        threshold: umbral de confianza
    
    Returns:
        LSMRecognizer configurado
    """
    global _ROOT
    if models_dir is None:
        models_dir = _ROOT / "models"
    else:
        models_dir = Path(models_dir)
    
    # Buscar modelos
    static_path = None
    dynamic_path = None
    
    # Buscar TFLite primero, luego Keras
    for pattern in ["lsm_static_classifier.tflite", "lsm_static_classifier_*.tflite"]:
        matches = list(models_dir.glob(pattern))
        if matches:
            static_path = str(matches[0])
            break
    else:
        # Fallback a Keras
        keras_static = models_dir / "lsm_static_classifier.keras"
        if keras_static.exists():
            static_path = str(keras_static)
    
    for pattern in ["lsm_dynamic_classifier_*.tflite", "lsm_dynamic_classifier.tflite"]:
        matches = list(models_dir.glob(pattern))
        if matches:
            dynamic_path = str(matches[0])
            break
    else:
        # Fallback a Keras
        for pattern in ["lsm_dynamic_classifier_*.keras", "lsm_dynamic_classifier.keras"]:
            matches = list(models_dir.glob(pattern))
            if matches:
                dynamic_path = str(matches[0])
                break
    
    recognizer = LSMRecognizer(
        static_model_path=static_path,
        dynamic_model_path=dynamic_path,
        threshold=threshold
    )
    
    if not recognizer.is_ready:
        print("[WARN] No se encontraron modelos. Entrena primero con lsm_trainer.py")
    
    return recognizer


# =============================================================================
# Test / Cámara
# =============================================================================

def run_camera_mode(recognizer: LSMRecognizer, threshold: float = 0.75):
    """Ejecuta reconocimiento en tiempo real con cámara."""
    import cv2
    from lsm_data_collector import HandTracker
    
    print("\n" + "=" * 60)
    print("LSM RECOGNIZER — MODO CÁMARA")
    print("=" * 60)
    print("Controles:")
    print("  Q = Salir")
    print("  Espacio = Forzar predicción")
    print("=" * 60)
    
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] No se pudo abrir la cámara")
        return
    
    # HandTracker (API moderna de MediaPipe)
    try:
        tracker = HandTracker(max_hands=1, detection_conf=0.5)
    except FileNotFoundError as e:
        print(f"[ERROR] {e}")
        print("Asegúrate de tener el modelo hand_landmarker.task en mediapipe_models/")
        cap.release()
        return
    
    current_prediction = ""
    confidence = 0.0
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape
            
            # Procesar con MediaPipe
            landmarks, result = tracker.process(frame)
            
            if landmarks is not None:
                # Dibujar esqueleto
                tracker.draw(frame, result)
                
                # Usar primera mano detectada
                hand_landmarks = landmarks[0]  # (21, 3)
                
                # Predicción directa (sin smoothing temporal)
                pred, conf = recognizer.predict_frame(hand_landmarks)
                
                if pred and conf >= threshold:
                    current_prediction = pred
                    confidence = conf
                    
                    # Debug en terminal
                    print(f"  Detectado: {pred} ({conf:.1%})", end="\r")
            
            # Dibujar predicción
            if current_prediction:
                text = f"{current_prediction} ({confidence:.0%})"
                cv2.putText(frame, text, (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 255, 0), 4)
            else:
                cv2.putText(frame, "Esperando...", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 100, 255), 2)
            
            # Info
            cv2.putText(frame, f"Umbral: {threshold:.0%} | Presiona Q para salir", (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
            
            cv2.imshow("LSM Recognizer", frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord(' '):
                # Forzar predicción con frame actual
                if landmarks is not None:
                    print(f"Predicción forzada: {current_prediction} ({confidence:.1%})")
    
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[OK] Cámara cerrada")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="LSM Recognizer")
    parser.add_argument("--camera", action="store_true", help="Modo cámara en tiempo real")
    parser.add_argument("--threshold", type=float, default=0.75, help="Umbral de confianza")
    args = parser.parse_args()
    
    print("=" * 60)
    print("LSM Recognizer — Test")
    print("=" * 60)
    
    # Crear recognizer
    recognizer = create_recognizer_from_models()
    
    if not recognizer.is_ready:
        print("\nNo hay modelos entrenados.")
        print("Ejecuta primero:")
        print("  1. python backend/lsm_data_collector.py")
        print("  2. python backend/lsm_trainer.py")
    else:
        print(f"\nEstático: {'OK' if recognizer.has_static else 'No disponible'}")
        print(f"Dinámico: {'OK' if recognizer.has_dynamic else 'No disponible'}")
        print(f"Clases: {recognizer.static_classes}")
        
        if args.camera:
            run_camera_mode(recognizer, args.threshold)
        else:
            # Test con landmarks sintéticos
            print("\nTest con landmarks sintéticos:")
            test_landmarks = np.random.randn(21, 3).astype(np.float32) * 0.1
            test_landmarks[0] = [0, 0, 0]  # wrist
            
            for i in range(10):
                result = recognizer.update(test_landmarks + np.random.randn(21, 3) * 0.02)
                if result['final_pred']:
                    print(f"  Frame {i+1}: {result['final_pred']} ({result['final_conf']:.2%})")
            
            print("\n[OK] Test completado")
            print("\nPara probar con cámara: python backend/lsm_recognizer.py --camera")
