"""
LSM Data Collector — Módulo de captura de datos para entrenamiento ML
======================================================================

GUI OpenCV para grabar muestras de señas LSM:
- Modo foto (15 frames promedio) para señas estáticas
- Modo secuencia (30 frames) para señas dinámicas con movimiento

Guarda landmarks directamente (no imágenes) en formato .npy
Estructura: data/lsm_raw/{clase}/sample_{n:04d}.npy

Uso:
    python backend/lsm_data_collector.py --class A --mode static
    python backend/lsm_data_collector.py --class J --mode dynamic
    python backend/lsm_data_collector.py --batch --list classes.txt
"""

from __future__ import annotations
import os
import sys
import time
import json
import argparse
from pathlib import Path
from collections import deque
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict

import cv2
import numpy as np
import mediapipe as mp

# =============================================================================
# Configuración
# =============================================================================

_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = _ROOT / "data" / "lsm_raw"
METADATA_PATH = DATA_DIR / "_metadata.json"

# Parámetros de captura
STATIC_FRAMES = 15      # Frames para promediar en estáticas
DYNAMIC_FRAMES = 45     # Frames para secuencias dinámicas (aumentado para J, Z, etc.)
COUNTDOWN_SECS = 2.0    # Segundos de cuenta regresiva
MIN_DETECTION_CONF = 0.5

# Señas dinámicas (requieren movimiento)
# CH, LL son ESTÁTICAS (configuración de mano específica)
# RR es DINÁMICA (vibración del dedo)
DYNAMIC_SIGNS = {'J', 'K', 'Ñ', 'Q', 'X', 'Z', 'RR'}
NUMBERS_DYNAMIC = {'10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'}


# =============================================================================
# Clases de estado
# =============================================================================

@dataclass
class Sample:
    """Representa una muestra capturada."""
    class_name: str
    mode: str  # 'static' o 'dynamic'
    landmarks: np.ndarray  # (N, 21, 3) para estático promediado, (30, 21, 3) para dinámico
    timestamp: float
    valid: bool
    notes: str = ""


class CaptureState:
    IDLE = "idle"
    COUNTDOWN = "countdown"
    CAPTURING = "capturing"
    SAVED = "saved"
    ERROR = "error"


# =============================================================================
# MediaPipe Hands setup
# =============================================================================

class HandTracker:
    """Wrapper para MediaPipe Hands con configuración optimizada (API moderna)."""
    
    def __init__(self, max_hands: int = 2, detection_conf: float = 0.5):
        self.max_hands = max_hands
        self.detection_conf = detection_conf
        self._init_landmarker()
        
    def _init_landmarker(self):
        """Inicializa el HandLandmarker de MediaPipe Tasks."""
        _HAND_MODEL = str(_ROOT / 'mediapipe_models' / 'hand_landmarker.task')
        
        if not Path(_HAND_MODEL).exists():
            raise FileNotFoundError(f"No existe {_HAND_MODEL}")
        
        # Usar API moderna de MediaPipe (tasks)
        _BaseOptions = mp.tasks.BaseOptions
        _HandLandmarker = mp.tasks.vision.HandLandmarker
        _HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
        _RunningMode = mp.tasks.vision.RunningMode
        
        base_opts = _BaseOptions(model_asset_path=_HAND_MODEL)
        options = _HandLandmarkerOptions(
            base_options=base_opts,
            running_mode=_RunningMode.IMAGE,
            num_hands=self.max_hands,
            min_hand_detection_confidence=self.detection_conf,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = _HandLandmarker.create_from_options(options)
        self.mp_draw = mp.solutions.drawing_utils if hasattr(mp, 'solutions') else None
        
    def process(self, frame: np.ndarray):
        """
        Procesa un frame y retorna landmarks detectados.
        
        Returns:
            (landmarks, result_obj) donde landmarks es (n_hands, 21, 3) o None
        """
        from mediapipe import Image, ImageFormat
        
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = Image(image_format=ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(mp_image)
        
        if not result.hand_landmarks:
            return None, result
        
        # Extraer landmarks de todas las manos detectadas
        all_landmarks = []
        for hand_landmarks in result.hand_landmarks:
            pts = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks], dtype=np.float32)
            all_landmarks.append(pts)
        
        return np.stack(all_landmarks), result
    
    def draw(self, frame: np.ndarray, result):
        """Dibuja los landmarks en el frame."""
        if result.hand_landmarks:
            for hand_landmarks in result.hand_landmarks:
                # Dibujo manual si mp.solutions no disponible
                self._draw_landmarks_manual(frame, hand_landmarks)
    
    def _draw_landmarks_manual(self, frame, hand_landmarks):
        """Dibuja landmarks manualmente sin depender de mp.solutions."""
        h, w = frame.shape[:2]
        
        # Conexiones de la mano
        HAND_CONNECTIONS = [
            (0,1),(1,2),(2,3),(3,4),
            (0,5),(5,6),(6,7),(7,8),
            (5,9),(9,10),(10,11),(11,12),
            (9,13),(13,14),(14,15),(15,16),
            (13,17),(17,18),(18,19),(19,20),(0,17)
        ]
        
        # Convertir landmarks a coordenadas de píxeles
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand_landmarks]
        
        # Dibujar conexiones
        for a, b in HAND_CONNECTIONS:
            cv2.line(frame, pts[a], pts[b], (0, 200, 100), 2)
        
        # Dibujar puntos
        for x, y in pts:
            cv2.circle(frame, (x, y), 4, (255, 255, 255), -1)
    
    def close(self):
        if hasattr(self, 'landmarker') and self.landmarker:
            pass  # El landmarker se cierra automáticamente


# =============================================================================
# Coleccionista de datos
# =============================================================================

class LSMCDataCollector:
    """Sistema de captura de datos para LSM."""
    
    def __init__(self, output_dir: Path = DATA_DIR):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        self.tracker = HandTracker()
        self.metadata: Dict = self._load_metadata()
        
        # Estado
        self.state = CaptureState.IDLE
        self.buffer: List[np.ndarray] = []
        self.countdown_start: float = 0.0
        
    def _load_metadata(self) -> Dict:
        """Carga o crea archivo de metadata."""
        if METADATA_PATH.exists():
            return json.loads(METADATA_PATH.read_text(encoding='utf-8'))
        return {"samples": {}, "total": 0, "by_class": {}}
    
    def _save_metadata(self):
        """Guarda metadata actualizada."""
        METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        METADATA_PATH.write_text(json.dumps(self.metadata, indent=2, ensure_ascii=False), encoding='utf-8')
    
    def _get_next_sample_id(self, class_name: str) -> int:
        """Obtiene el siguiente ID de muestra para una clase."""
        class_dir = self.output_dir / class_name
        if not class_dir.exists():
            return 0
        
        existing = list(class_dir.glob("sample_*.npy"))
        if not existing:
            return 0
        
        # Extraer números de los nombres de archivo
        max_id = -1
        for f in existing:
            try:
                num = int(f.stem.split('_')[1])
                max_id = max(max_id, num)
            except (IndexError, ValueError):
                continue
        
        return max_id + 1
    
    def _save_sample(self, sample: Sample) -> Path:
        """Guarda una muestra en disco."""
        class_dir = self.output_dir / sample.class_name
        class_dir.mkdir(parents=True, exist_ok=True)
        
        sample_id = self._get_next_sample_id(sample.class_name)
        filename = f"sample_{sample_id:04d}.npy"
        filepath = class_dir / filename
        
        np.save(filepath, sample.landmarks)
        
        # Actualizar metadata
        self.metadata["total"] += 1
        if sample.class_name not in self.metadata["by_class"]:
            self.metadata["by_class"][sample.class_name] = {"count": 0, "mode": sample.mode}
        self.metadata["by_class"][sample.class_name]["count"] += 1
        self.metadata["samples"][str(filepath.relative_to(self.output_dir))] = {
            "class": sample.class_name,
            "mode": sample.mode,
            "timestamp": sample.timestamp,
            "valid": sample.valid,
            "notes": sample.notes,
            "shape": list(sample.landmarks.shape)
        }
        self._save_metadata()
        
        return filepath
    
    def validate_capture(self, buffer: List[np.ndarray], mode: str) -> Tuple[bool, str]:
        """
        Valida que la captura tiene suficiente información.
        
        Returns:
            (valido, mensaje)
        """
        if not buffer:
            return False, "No se capturaron frames"
        
        n_frames = len(buffer)
        
        # Contar frames con mano detectada
        valid_frames = sum(1 for lm in buffer if not np.allclose(lm, 0))
        pct_valid = valid_frames / n_frames if n_frames > 0 else 0
        
        if mode == "static":
            if valid_frames < 5:
                return False, f"Mano no detectada ({valid_frames}/{n_frames})"
            if pct_valid < 0.6:
                return False, f"Detección inestable ({int(pct_valid*100)}%)"
            return True, f"OK ({valid_frames}/{n_frames} frames válidos)"
        
        else:  # dynamic
            if n_frames < 10:
                return False, f"Secuencia muy corta ({n_frames} frames)"
            if pct_valid < 0.5:
                return False, f"Mano perdida en {int((1-pct_valid)*100)}% de frames"
            return True, f"OK ({valid_frames}/{n_frames} frames válidos)"
    
    def capture_batch(self, 
                      class_list: List[str],
                      samples_per_class: int = 20,
                      mode: str = "auto") -> None:
        """
        Captura múltiples muestras para una lista de clases.
        
        Args:
            class_list: lista de nombres de clases (e.g., ['A', 'B', 'J'])
            samples_per_class: muestras a capturar por clase
            mode: 'static', 'dynamic', o 'auto' (detectar según clase)
        """
        for class_name in class_list:
            # Determinar modo
            actual_mode = mode
            if mode == "auto":
                actual_mode = "dynamic" if class_name in DYNAMIC_SIGNS else "static"
            
            print(f"\n{'='*50}")
            print(f"Clase: {class_name} | Modo: {actual_mode}")
            print(f"{'='*50}")
            
            for i in range(samples_per_class):
                result = self.capture_single(class_name, actual_mode, auto_advance=False)
                if result is None:
                    print("  [SKIP] Captura cancelada")
                    continue
                
                valid, msg = result
                status = "OK" if valid else "FAIL"
                print(f"  [{status}] Muestra {i+1}/{samples_per_class}: {msg}")
    
    def capture_single(self, 
                       class_name: str, 
                       mode: str = "static",
                       auto_advance: bool = True) -> Optional[Tuple[bool, str]]:
        """
        Captura una única muestra con interfaz interactiva.
        
        Args:
            class_name: nombre de la clase a capturar
            mode: 'static' o 'dynamic'
            auto_advance: si True, avanza automáticamente después de guardar
        
        Returns:
            (valido, mensaje) o None si se canceló
        """
        target_frames = STATIC_FRAMES if mode == "static" else DYNAMIC_FRAMES
        
        # Abrir cámara
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("[ERROR] No se pudo abrir la cámara")
            return None
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
        win_name = f"LSM Data Collector — {class_name} ({mode})"
        cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
        
        self.state = CaptureState.IDLE
        self.buffer = []
        
        sample_result = None
        message = ""
        message_color = (200, 200, 200)
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                
                frame = cv2.flip(frame, 1)
                h, w = frame.shape[:2]
                
                # Procesar con MediaPipe
                landmarks, results = self.tracker.process(frame)
                
                # Dibujar esqueleto
                self.tracker.draw(frame, results)
                
                # Panel superior con info
                cv2.rectangle(frame, (0, 0), (w, 100), (20, 20, 30), -1)
                
                # Nombre de clase grande
                cv2.putText(frame, class_name, (20, 60), 
                           cv2.FONT_HERSHEY_DUPLEX, 2.0, (255, 255, 255), 2)
                
                # Info de modo y muestras
                count = self.metadata["by_class"].get(class_name, {}).get("count", 0)
                mode_text = "ESTÁTICA (S para foto)" if mode == "static" else "DINÁMICA (ESPACIO para grabar)"
                cv2.putText(frame, f"{mode_text} | Guardadas: {count}", 
                           (20, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 1)
                
                # Estado de detección
                hand_detected = landmarks is not None and len(landmarks) > 0
                hand_color = (0, 255, 100) if hand_detected else (0, 100, 255)
                hand_text = "MANO DETECTADA" if hand_detected else "SIN MANO"
                cv2.putText(frame, hand_text, (w - 220, 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, hand_color, 2)
                
                # Máquina de estados
                if self.state == CaptureState.IDLE:
                    # Instrucciones
                    if message:
                        cv2.putText(frame, message, (20, h - 40),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, message_color, 2)
                    
                    cv2.putText(frame, "S=Foto  ESPACIO=Video  N=Siguiente  Q=Salir",
                               (20, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
                
                elif self.state == CaptureState.COUNTDOWN:
                    elapsed = time.time() - self.countdown_start
                    remaining = max(0, COUNTDOWN_SECS - elapsed)
                    
                    if remaining > 0:
                        # Mostrar cuenta regresiva grande
                        cv2.putText(frame, f"{remaining:.1f}", (w//2 - 50, h//2),
                                   cv2.FONT_HERSHEY_DUPLEX, 3.0, (0, 220, 255), 4)
                    else:
                        self.state = CaptureState.CAPTURING
                        self.buffer = []
                
                elif self.state == CaptureState.CAPTURING:
                    # Capturar frames
                    if hand_detected and landmarks is not None:
                        # Tomar primera mano detectada
                        self.buffer.append(landmarks[0].copy())
                    
                    # Barra de progreso
                    progress = len(self.buffer) / target_frames
                    bar_width = int(progress * (w - 40))
                    cv2.rectangle(frame, (20, h - 30), (20 + bar_width, h - 10), 
                                 (0, 200, 100), -1)
                    cv2.rectangle(frame, (20, h - 30), (w - 20, h - 10), (50, 50, 50), 2)
                    
                    cv2.putText(frame, f"{len(self.buffer)}/{target_frames}", 
                               (w//2 - 30, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
                    
                    cv2.putText(frame, "GRABANDO...", (w - 180, 40),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                    
                    # Verificar si completamos
                    if len(self.buffer) >= target_frames:
                        # Validar y guardar
                        valid, msg = self.validate_capture(self.buffer, mode)
                        
                        if valid:
                            # Procesar según modo
                            if mode == "static":
                                # Promediar frames
                                processed = np.mean(self.buffer, axis=0)  # (21, 3)
                            else:
                                # Mantener secuencia completa (samplear a DYNAMIC_FRAMES)
                                if len(self.buffer) > DYNAMIC_FRAMES:
                                    indices = np.linspace(0, len(self.buffer) - 1, 
                                                        DYNAMIC_FRAMES, dtype=int)
                                    processed = np.array([self.buffer[i] for i in indices])
                                else:
                                    # Pad con ceros
                                    processed = np.zeros((DYNAMIC_FRAMES, 21, 3), dtype=np.float32)
                                    processed[:len(self.buffer)] = np.array(self.buffer)
                            
                            sample = Sample(
                                class_name=class_name,
                                mode=mode,
                                landmarks=processed,
                                timestamp=time.time(),
                                valid=True,
                                notes=msg
                            )
                            
                            filepath = self._save_sample(sample)
                            message = f"Guardado: {filepath.name}"
                            message_color = (0, 255, 100)
                            sample_result = (True, msg)
                        else:
                            message = f"Descartado: {msg}"
                            message_color = (0, 100, 255)
                            sample_result = (False, msg)
                        
                        self.state = CaptureState.IDLE
                        self.buffer = []
                        
                        if auto_advance and sample_result and sample_result[0]:
                            time.sleep(0.5)  # Pausa breve para ver el mensaje
                
                cv2.imshow(win_name, frame)
                
                # Manejo de teclado
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    sample_result = None
                    break
                
                elif key == ord('n'):
                    # Siguiente clase (salir)
                    break
                
                elif self.state == CaptureState.IDLE:
                    if key == ord('s'):
                        # Captura estática (foto)
                        mode = "static"
                        target_frames = STATIC_FRAMES
                        self.state = CaptureState.COUNTDOWN
                        self.countdown_start = time.time()
                    
                    elif key == ord(' '):
                        # Captura dinámica (video)
                        mode = "dynamic"
                        target_frames = DYNAMIC_FRAMES
                        self.state = CaptureState.COUNTDOWN
                        self.countdown_start = time.time()
        
        finally:
            cap.release()
            cv2.destroyAllWindows()
        
        return sample_result
    
    def capture_single_lesson(self, class_name: str, mode: str = "static",
                               progress: str = "", lesson_progress: str = ""):
        """
        Versión de capture_single para modo lección con controles especiales.
        
        Returns:
            - None: usuario presionó Q (salir de lección)
            - "SKIP": usuario presionó S (saltar seña)
            - "PREV": usuario presionó P (retroceder)
            - "AGAIN": usuario presionó R (reintentar fallida)
            - (valid, msg): resultado normal de captura
        """
        target_frames = STATIC_FRAMES if mode == "static" else DYNAMIC_FRAMES
        
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("[ERROR] No se pudo abrir la cámara")
            return None
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
        # Título de ventana con info de lección
        win_info = f"{lesson_progress} | {class_name} ({progress})" if lesson_progress else class_name
        win_name = f"LECCIÓN — {win_info}"
        cv2.namedWindow(win_name, cv2.WINDOW_NORMAL)
        
        self.state = CaptureState.IDLE
        self.buffer = []
        
        result = None
        message = ""
        message_color = (200, 200, 200)
        countdown_start = 0.0
        auto_capture = False  # Para captura automática cuando mano está OK
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                
                frame = cv2.flip(frame, 1)
                h, w = frame.shape[:2]
                
                # Procesar con MediaPipe
                landmarks, result_obj = self.tracker.process(frame)
                self.tracker.draw(frame, result_obj)
                
                hand_ok = landmarks is not None and len(landmarks) > 0
                
                # Panel superior
                cv2.rectangle(frame, (0, 0), (w, 120), (10, 10, 10), -1)
                
                # Progreso de lección (esquina superior izquierda)
                if lesson_progress:
                    cv2.putText(frame, f"Lección {lesson_progress}", (20, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 150, 150), 1)
                
                # Nombre de clase MUY grande y centrado arriba
                (tw, th), _ = cv2.getTextSize(class_name, cv2.FONT_HERSHEY_DUPLEX, 4.0, 4)
                x_center = (w - tw) // 2
                cv2.putText(frame, class_name, (x_center, 95),
                           cv2.FONT_HERSHEY_DUPLEX, 4.0, (0, 220, 255), 4)
                
                # Indicador de progreso de muestra
                if progress:
                    cv2.putText(frame, f"Muestra {progress}", (w - 180, 35),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
                
                # Indicador de modo
                mode_color = (0, 200, 255) if mode == "dynamic" else (100, 255, 100)
                mode_text = "🎬 DINÁMICO" if mode == "dynamic" else "📸 ESTÁTICO"
                cv2.putText(frame, mode_text, (20, h//2 - 50),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, mode_color, 2)
                
                # Estado mano (grande y visible)
                hand_col = (0, 255, 100) if hand_ok else (0, 80, 255)
                hand_text = "✓ MANO DETECTADA" if hand_ok else "✗ SIN MANO"
                cv2.putText(frame, hand_text, (w - 280, 80),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.9, hand_col, 2)
                
                # Mensaje de estado
                if message:
                    msg_w, _ = cv2.getTextSize(message, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2)
                    cv2.putText(frame, message, ((w - msg_w[0]) // 2, h - 50),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.9, message_color, 2)
                
                # Instrucciones en panel inferior
                cv2.rectangle(frame, (0, h - 40), (w, h), (20, 20, 20), -1)
                instr_text = "ESPACIO=Capturar  S=Saltar  P=Anterior  R=Reintentar  Q=Salir"
                cv2.putText(frame, instr_text, ((w - 550) // 2, h - 12),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1)
                
                # Máquina de estados
                if self.state == CaptureState.COUNTDOWN:
                    elapsed = time.time() - countdown_start
                    remaining = max(0, COUNTDOWN_SECS - elapsed)
                    
                    if remaining > 0:
                        # Cuenta regresiva muy grande y centrada
                        cd_text = f"{remaining:.1f}"
                        (cd_w, cd_h), _ = cv2.getTextSize(cd_text, cv2.FONT_HERSHEY_DUPLEX, 6.0, 6)
                        cx, cy = (w - cd_w) // 2, (h + cd_h) // 2 - 50
                        
                        # Sombra
                        cv2.putText(frame, cd_text, (cx+4, cy+4),
                                   cv2.FONT_HERSHEY_DUPLEX, 6.0, (0, 0, 0), 6)
                        # Texto
                        cv2.putText(frame, cd_text, (cx, cy),
                                   cv2.FONT_HERSHEY_DUPLEX, 6.0, (0, 220, 255), 6)
                        
                        cv2.putText(frame, "¡Preparate!", (w//2 - 80, cy + 80),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2)
                    else:
                        self.state = CaptureState.CAPTURING
                        self.buffer = []
                
                elif self.state == CaptureState.CAPTURING:
                    limit = target_frames
                    if hand_ok and landmarks is not None:
                        self.buffer.append(landmarks[0].copy())
                    
                    # Barra de progreso de grabación (ancho completo)
                    pct = min(1.0, len(self.buffer) / limit)
                    bar_w = int(pct * (w - 100))
                    cv2.rectangle(frame, (50, h - 70), (50 + bar_w, h - 50), (0, 200, 100), -1)
                    cv2.rectangle(frame, (50, h - 70), (w - 50, h - 50), (50, 50, 50), 2)
                    
                    # Texto de progreso
                    prog_text = f"{len(self.buffer)}/{limit}"
                    cv2.putText(frame, prog_text, (w//2 - 40, h - 55),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                    
                    # Indicador REC parpadeante
                    rec_color = (0, 0, 255) if int(time.time() * 4) % 2 == 0 else (100, 0, 0)
                    cv2.circle(frame, (w - 60, 100), 15, rec_color, -1)
                    cv2.putText(frame, "REC", (w - 80, 105),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                    
                    # Completado
                    if len(self.buffer) >= limit:
                        ok_cap, detail = self.validate_capture(self.buffer, mode)
                        
                        if ok_cap:
                            # Guardar
                            if mode == "static":
                                processed = np.mean(self.buffer, axis=0)
                            else:
                                processed = np.zeros((DYNAMIC_FRAMES, 21, 3), dtype=np.float32)
                                n = min(len(self.buffer), DYNAMIC_FRAMES)
                                processed[:n] = np.array(self.buffer[:n])
                            
                            sample = Sample(
                                class_name=class_name,
                                mode=mode,
                                landmarks=processed,
                                timestamp=time.time(),
                                valid=True,
                                notes=detail
                            )
                            filepath = self._save_sample(sample)
                            result = (True, f"Guardado {filepath.name}")
                            message = "✓ ¡GUARDADO!"
                            message_color = (0, 255, 100)
                        else:
                            result = (False, detail)
                            message = f"✗ Falló: {detail}"
                            message_color = (0, 80, 255)
                        
                        self.state = CaptureState.IDLE
                        self.buffer = []
                        
                        # Mostrar mensaje un momento antes de retornar
                        for _ in range(15):  # ~0.5 segundos a 30fps
                            cv2.imshow(win_name, frame)
                            cv2.waitKey(33)
                        
                        break  # Retornar resultado
                
                cv2.imshow(win_name, frame)
                
                # Teclado
                key = cv2.waitKey(1) & 0xFF
                
                if key == ord('q'):
                    return None  # Salir de lección
                
                elif key == ord('s'):
                    return "SKIP"  # Saltar esta seña
                
                elif key == ord('p'):
                    return "PREV"  # Retroceder
                
                elif key == ord('r'):
                    return "AGAIN"  # Reintentar (solo si falló)
                
                elif self.state == CaptureState.IDLE:
                    if key == ord(' '):
                        # Iniciar captura
                        self.state = CaptureState.COUNTDOWN
                        countdown_start = time.time()
        
        finally:
            cap.release()
            cv2.destroyAllWindows()
        
        return result
    
    def close(self):
        self.tracker.close()


# =============================================================================
# Funciones utilitarias
# =============================================================================

def load_sample(filepath: Path) -> Optional[np.ndarray]:
    """Carga una muestra guardada."""
    try:
        return np.load(filepath)
    except Exception as e:
        print(f"[ERROR] No se pudo cargar {filepath}: {e}")
        return None


def get_class_counts() -> Dict[str, int]:
    """Retorna conteo de muestras por clase."""
    if not METADATA_PATH.exists():
        return {}
    
    metadata = json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    return {cls: info["count"] for cls, info in metadata.get("by_class", {}).items()}


def print_statistics():
    """Imprime estadísticas del dataset recolectado."""
    print("\n" + "="*60)
    print("ESTADÍSTICAS DEL DATASET LSM")
    print("="*60)
    
    if not METADATA_PATH.exists():
        print("No hay datos recolectados aún.")
        return
    
    metadata = json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    
    print(f"\nTotal de muestras: {metadata['total']}")
    print(f"\nPor clase:")
    
    by_class = metadata.get("by_class", {})
    static_count = sum(1 for c in by_class.values() if c.get("mode") == "static")
    dynamic_count = sum(1 for c in by_class.values() if c.get("mode") == "dynamic")
    
    for cls in sorted(by_class.keys()):
        info = by_class[cls]
        mode = info.get("mode", "unknown")
        count = info.get("count", 0)
        print(f"  {cls:8s} | {mode:8s} | {count:4d} muestras")
    
    print(f"\nResumen:")
    print(f"  Clases estáticas: {static_count}")
    print(f"  Clases dinámicas: {dynamic_count}")


# =============================================================================
# Modo Lección Guiada
# =============================================================================

def run_lesson_mode(collector: LSMCDataCollector, start_sign: str, samples_per_sign: int):
    """
    Modo lección: recorre señas en orden, captura automáticamente cuando
    detecta mano válida, y avanza a la siguiente.
    
    Orden: A-Z, Ñ, 1-20
    """
    # Definir orden de lecciones (todas las letras del español + números)
    # Orden: A-Z, letras compuestas (LL, RR), Ñ, números 1-20
    LESSON_ORDER = (
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL',
         'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'RR', 'S', 'T', 'U', 'V', 'W', 'X',
         'Y', 'Z'] +
        [str(i) for i in range(1, 21)]      # 1-20
    )
    
    # Encontrar índice de inicio
    start_idx = 0
    start_upper = start_sign.upper()
    for i, sign in enumerate(LESSON_ORDER):
        if sign == start_upper:
            start_idx = i
            break
    
    # Recorrer desde el inicio
    lesson_sequence = LESSON_ORDER[start_idx:]
    
    print("\n" + "="*60)
    print("MODO LECCIÓN GUIADA")
    print("="*60)
    print(f"Total de señas: {len(lesson_sequence)}")
    print(f"Muestras por seña: {samples_per_sign}")
    print("\nControles:")
    print("  S = Saltar seña (sin capturar)")
    print("  P = Retroceder a seña anterior")
    print("  Q = Salir del modo lección")
    print("="*60)
    
    idx = 0
    total_lessons = len(lesson_sequence)
    
    while idx < total_lessons:
        sign = lesson_sequence[idx]
        mode = "dynamic" if sign in DYNAMIC_SIGNS or sign in NUMBERS_DYNAMIC else "static"
        
        # Contar cuántas ya tenemos
        existing = collector.metadata["by_class"].get(sign, {}).get("count", 0)
        remaining = samples_per_sign - existing
        
        if remaining <= 0:
            print(f"\n✓ {sign}: Ya completo ({existing}/{samples_per_sign}) — avanzando...")
            idx += 1
            continue
        
        print(f"\n{'='*55}")
        print(f"  LECCIÓN {idx+1}/{total_lessons}: {sign}")
        print(f"  Modo: {'🎬 DINÁMICO' if mode == 'dynamic' else '📸 ESTÁTICO'}")
        print(f"  Muestras: {existing}/{samples_per_sign} guardadas, {remaining} pendientes")
        print(f"{'='*55}")
        
        # Capturar las muestras restantes para esta seña
        captured_this_session = 0
        skip_this_sign = False
        
        while captured_this_session < remaining:
            sample_num = captured_this_session + 1
            print(f"\n  → Captura {sample_num}/{remaining}:")
            
            result = collector.capture_single_lesson(sign, mode, 
                                                     progress=f"{sample_num}/{remaining}",
                                                     lesson_progress=f"{idx+1}/{total_lessons}")
            
            if result is None:
                # Usuario presionó Q (salir)
                print("\n[Saliendo del modo lección...]")
                return
            
            elif result == "SKIP":
                # Saltar esta seña completamente
                print(f"  → Saltando {sign}")
                skip_this_sign = True
                break
            
            elif result == "PREV":
                # Retroceder a seña anterior
                if idx > 0:
                    idx -= 1
                    print(f"  → Retrocediendo a {lesson_sequence[idx]}")
                else:
                    print("  → Ya estás en la primera seña")
                break
            
            elif result == "AGAIN":
                # Reintentar esta misma muestra
                print(f"  → Reintentando captura {sample_num}...")
                continue
            
            else:
                # Resultado normal (True/False, msg)
                valid, msg = result
                if valid:
                    print(f"  ✓ Guardado: {msg}")
                    captured_this_session += 1
                    existing += 1
                    
                    # Mostrar progreso
                    pct = (existing / samples_per_sign) * 100
                    bar = '█' * int(pct/5) + '░' * (20 - int(pct/5))
                    print(f"    Progreso: [{bar}] {existing}/{samples_per_sign} ({pct:.0f}%)")
                    
                    # Si completamos todas las muestras de esta seña, avanzar automáticamente
                    if existing >= samples_per_sign:
                        print(f"\n  ✅ {sign} COMPLETADO — avanzando a siguiente...")
                        time.sleep(0.3)
                        break
                else:
                    print(f"  ✗ Falló: {msg}")
                    print(f"    Presiona ESPACIO para reintentar, S para saltar, P para anterior")
        
        # Avanzar a siguiente seña (si no retrocedimos)
        if not skip_this_sign:
            idx += 1
    
    print("\n" + "="*60)
    print("¡LECCIÓN COMPLETADA!")
    print("="*60)
    print_statistics()


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="LSM Data Collector")
    parser.add_argument("--class", dest="class_name", help="Nombre de la clase a capturar (ej: A, J, 5)")
    parser.add_argument("--mode", choices=["static", "dynamic", "auto"], default="auto",
                       help="Modo de captura")
    parser.add_argument("--samples", type=int, default=10, help="Muestras a capturar")
    parser.add_argument("--batch", action="store_true", help="Modo batch desde archivo")
    parser.add_argument("--list", dest="list_file", help="Archivo con lista de clases (una por línea)")
    parser.add_argument("--stats", action="store_true", help="Mostrar estadísticas y salir")
    parser.add_argument("--lesson", action="store_true", help="Modo lección guiada (recorre señas en orden)")
    parser.add_argument("--start", default="A", help="Seña inicial para modo lección (default: A)")
    
    args = parser.parse_args()
    
    if args.stats:
        print_statistics()
        return
    
    collector = LSMCDataCollector()
    
    try:
        if args.lesson:
            # Modo lección: recorrer señas en orden
            run_lesson_mode(collector, args.start, args.samples)
        
        elif args.batch and args.list_file:
            # Modo batch
            with open(args.list_file, 'r', encoding='utf-8') as f:
                classes = [line.strip() for line in f if line.strip()]
            
            collector.capture_batch(classes, args.samples, args.mode)
        
        elif args.class_name:
            # Modo single
            mode = args.mode
            if mode == "auto":
                mode = "dynamic" if args.class_name in DYNAMIC_SIGNS else "static"
            
            for i in range(args.samples):
                print(f"\nMuestra {i+1}/{args.samples}:")
                result = collector.capture_single(args.class_name, mode, auto_advance=False)
                if result is None:
                    print("Captura cancelada.")
                    break
                valid, msg = result
                print(f"  {'OK' if valid else 'FAIL'}: {msg}")
        
        else:
            # Modo interactivo básico
            print("LSM Data Collector — Modo Interactivo")
            print("="*50)
            print("\nIngresa el nombre de la clase (ej: A, J, 5, 10)")
            print("o 'stats' para ver estadísticas, 'quit' para salir")
            
            while True:
                user_input = input("\nClase> ").strip().upper()
                
                if user_input == 'QUIT' or user_input == 'Q':
                    break
                
                if user_input == 'STATS':
                    print_statistics()
                    continue
                
                if not user_input:
                    continue
                
                mode = "dynamic" if user_input in DYNAMIC_SIGNS else "static"
                result = collector.capture_single(user_input, mode, auto_advance=False)
                
                if result:
                    valid, msg = result
                    print(f"Resultado: {'OK' if valid else 'FAIL'} — {msg}")
    
    finally:
        collector.close()
        print("\n[OK] Data collector cerrado")
        print_statistics()


if __name__ == "__main__":
    main()
