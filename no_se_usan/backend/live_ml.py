"""
Practica guiada en vivo del modelo ML (A-I estaticas, J-K dinamicas).

- Soporta DOS manos (detecta y dibuja ambas; predice en cada una).
- Inferencia RAPIDA: llamada directa al modelo (model(x)) en vez de .predict().
- Modo PRACTICA GUIADA: te lleva en orden por cada sena. Avanza sola cuando
  reconoce la sena objetivo con suficiente confianza durante varios frames.

Uso:
    python backend/live_ml.py

Controles:
    Q / ESC = salir
    R       = reiniciar practica desde el inicio
    N       = saltar a la siguiente sena
    P       = volver a la sena anterior
"""
from __future__ import annotations
import sys, json
from collections import deque
from pathlib import Path

import cv2
import numpy as np
import mediapipe as mp

# Importar motor geometrico para numeros 1-5 (misma precision que letras)
from lsm_teacher import (
    finger_states, score_letter, GEO_NUMBER_TEMPLATES,
    MATCH_THRESHOLD, MATCH_THRESHOLD_MOV
)

class _LM:
    """Wrapper para convertir fila numpy (x,y,z) en objeto con atributos .x .y .z"""
    __slots__ = ('x', 'y', 'z')
    def __init__(self, row): self.x, self.y, self.z = float(row[0]), float(row[1]), float(row[2])

def _np_to_lms(arr):
    """Convierte array numpy (21,3) a lista de objetos _LM para finger_states."""
    return [_LM(arr[j]) for j in range(len(arr))]

# Silenciar logs de TF antes de importarlo
import os
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
import tensorflow as tf

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))

from lsm_features import (
    extract_single_frame_features,
    extract_sequence_features,
    validate_landmarks,
)

# Rutas
STATIC_MODEL  = _ROOT / 'models' / 'lsm_static_classifier.keras'
DYNAMIC_MODEL = _ROOT / 'models' / 'lsm_dynamic_classifier_lstm.keras'
HAND_MODEL    = str(_ROOT / 'mediapipe_models' / 'hand_landmarker.task')

# Parametros de practica
CONF_THRESHOLD   = 0.60   # confianza minima para aceptar una sena (prob del objetivo)
HOLD_FRAMES      = 8      # frames consecutivos correctos para validar
DYNAMIC_WINDOW   = 30     # frames para secuencia dinamica
MOTION_THRESH    = 0.025  # umbral de movimiento para activar modo dinamico
STILL_THRESH     = 0.015  # por debajo de esto la mano se considera QUIETA

# Conexiones de la mano para dibujar el esqueleto
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),          # pulgar
    (0,5),(5,6),(6,7),(7,8),          # indice
    (5,9),(9,10),(10,11),(11,12),     # medio
    (9,13),(13,14),(14,15),(15,16),   # anular
    (13,17),(17,18),(18,19),(19,20),  # menique
    (0,17),                           # palma
]

_BaseOptions = mp.tasks.BaseOptions
_HandLandmarker = mp.tasks.vision.HandLandmarker
_HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
_VisionRunningMode = mp.tasks.vision.RunningMode


class FastClassifier:
    """Wrapper de inferencia rapida usando model(x) directo (no .predict())."""

    def __init__(self, keras_path: Path, classes: list[str]):
        self.model = tf.keras.models.load_model(keras_path)
        self.classes = classes

    def predict(self, features: np.ndarray) -> tuple[str, float]:
        out = self.probs(features)
        idx = int(np.argmax(out))
        return self.classes[idx], float(out[idx])

    def probs(self, features: np.ndarray) -> np.ndarray:
        x = features.reshape(1, -1).astype(np.float32)
        return self.model(x, training=False).numpy()[0]

    def prob_of(self, probs: np.ndarray, cls: str) -> float:
        if cls in self.classes:
            return float(probs[self.classes.index(cls)])
        return 0.0


def draw_hand(frame, landmarks, color):
    """Dibuja esqueleto de una mano."""
    h, w = frame.shape[:2]
    pts = [(int(p[0]*w), int(p[1]*h)) for p in landmarks]
    for a, b in HAND_CONNECTIONS:
        cv2.line(frame, pts[a], pts[b], color, 2)
    for cx, cy in pts:
        cv2.circle(frame, (cx, cy), 3, color, -1)


def hand_motion(prev, curr):
    """Movimiento medio entre dos frames de landmarks (21,3)."""
    if prev is None or curr is None:
        return 0.0
    return float(np.mean(np.linalg.norm(curr - prev, axis=1)))


def main():
    print("Cargando modelos ML...")
    static_classes  = json.loads((_ROOT / 'models/lsm_static_classes.json').read_text())['classes']
    dynamic_classes = json.loads((_ROOT / 'models/lsm_dynamic_classes.json').read_text())['classes']
    static_clf  = FastClassifier(STATIC_MODEL, static_classes)
    dynamic_clf = FastClassifier(DYNAMIC_MODEL, dynamic_classes)

    # Orden de practica: primero alfabeto (A-Z + CH/LL), luego numeros 1-20
    ALPHABET_ORDER = [c for c in static_classes if not c.isdigit()]
    STATIC_NUMS    = [c for c in static_classes if c.isdigit()]
    DYNAMIC_LETTERS = [c for c in dynamic_classes if not c.isdigit()]
    DYNAMIC_NUMS   = [c for c in dynamic_classes if c.isdigit()]
    TARGETS = (
        [(c, 'static')  for c in ALPHABET_ORDER] +
        [(c, 'dynamic') for c in DYNAMIC_LETTERS] +
        [(c, 'static')  for c in STATIC_NUMS] +
        [(c, 'dynamic') for c in DYNAMIC_NUMS]
    )
    print(f"Practica: {len(TARGETS)} senas -> {[t[0] for t in TARGETS]}")

    # Estado de la practica
    target_idx = 0
    completed: set[str] = set()
    hold_count = 0

    # Buffers por mano para deteccion dinamica
    seq_buffers = [deque(maxlen=DYNAMIC_WINDOW), deque(maxlen=DYNAMIC_WINDOW)]
    prev_lms = [None, None]

    print("Iniciando camara...")
    hand_opts = _HandLandmarkerOptions(
        base_options=_BaseOptions(model_asset_path=HAND_MODEL),
        running_mode=_VisionRunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)  # DSHOW = arranque rapido en Windows
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: no se puede abrir camara")
        return 1
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # menos lag

    win = 'LSM - Practica guiada (ML)'
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    with _HandLandmarker.create_from_options(hand_opts) as hand_lm:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # Detectar manos
            hands = []
            try:
                res = hand_lm.detect(mp_img)
                if res.hand_landmarks:
                    for lm in res.hand_landmarks[:2]:
                        arr = np.array([[p.x, p.y, p.z] for p in lm], dtype=np.float32)
                        hands.append(arr)
            except Exception:
                pass

            # Objetivo actual
            done = target_idx >= len(TARGETS)
            target_sign, target_mode = (None, None) if done else TARGETS[target_idx]

            # Predecir en cada mano y quedarnos con la mejor coincidencia al objetivo
            best_conf_for_target = 0.0
            best_pred = ""
            best_pred_conf = 0.0

            # Motor geometrico para numeros 1-5 (misma precision que letras)
            geo_score = 0.0
            if target_sign and target_sign in GEO_NUMBER_TEMPLATES:
                for i, lm in enumerate(hands):
                    if validate_landmarks(lm):
                        states = finger_states(_np_to_lms(lm))
                        tpl = GEO_NUMBER_TEMPLATES[target_sign]
                        score = score_letter(states, tpl, letter=target_sign)
                        if score > geo_score:
                            geo_score = score
                        if score >= MATCH_THRESHOLD:
                            best_pred = target_sign
                            best_pred_conf = min(1.0, score)
                            best_conf_for_target = min(1.0, score)
                            hand_color = (0, 255, 120)  # verde si coincide
                            draw_hand(frame, lm, hand_color)

            for i, lm in enumerate(hands):
                # actualizar buffer dinamico y movimiento
                seq_buffers[i].append(lm)
                motion = hand_motion(prev_lms[i], lm)
                prev_lms[i] = lm.copy()

                # color de la mano: verde si valida el objetivo
                hand_color = (0, 220, 0)

                if not validate_landmarks(lm):
                    draw_hand(frame, lm, (0, 0, 200))
                    continue

                # ESTATICA: solo cuenta si la mano esta QUIETA
                s_probs = None
                s_pred, s_conf = "", 0.0
                if motion < STILL_THRESH or prev_lms[i] is None:
                    s_probs = static_clf.probs(extract_single_frame_features(lm))
                    k = int(np.argmax(s_probs))
                    s_pred, s_conf = static_clf.classes[k], float(s_probs[k])

                # DINAMICA: solo cuenta si hay MOVIMIENTO real + buffer
                d_probs = None
                d_pred, d_conf = "", 0.0
                if len(seq_buffers[i]) >= 10 and motion > MOTION_THRESH:
                    feats = extract_sequence_features(list(seq_buffers[i]), target_frames=DYNAMIC_WINDOW)
                    d_probs = dynamic_clf.probs(feats)
                    k = int(np.argmax(d_probs))
                    d_pred, d_conf = dynamic_clf.classes[k], float(d_probs[k])

                # Prediccion a mostrar (la del modo del objetivo)
                # Para numeros 1-5 geometricos, ya se establecio arriba
                if target_sign and target_sign in GEO_NUMBER_TEMPLATES:
                    continue  # saltar ML para numeros geometricos
                if target_mode == 'dynamic':
                    pred, conf = d_pred, d_conf
                else:
                    pred, conf = s_pred, s_conf

                if conf > best_pred_conf:
                    best_pred, best_pred_conf = pred, conf

                # Coincidencia con el objetivo: usar motor geometrico para 1-5,
                # sino PROBABILIDAD DE LA CLASE OBJETIVO (ML)
                if not done:
                    if target_sign and target_sign in GEO_NUMBER_TEMPLATES:
                        # Ya calculado en el bloque geometrico arriba
                        tconf = best_conf_for_target
                    elif target_mode == 'dynamic' and d_probs is not None:
                        tconf = dynamic_clf.prob_of(d_probs, target_sign)
                    elif target_mode == 'static' and s_probs is not None:
                        tconf = static_clf.prob_of(s_probs, target_sign)
                    else:
                        tconf = 0.0
                    if tconf > best_conf_for_target:
                        best_conf_for_target = tconf
                    if tconf >= CONF_THRESHOLD:
                        hand_color = (0, 255, 120)

                draw_hand(frame, lm, hand_color)

            # Limpiar buffers/movimiento de manos no detectadas
            for i in range(len(hands), 2):
                prev_lms[i] = None
                seq_buffers[i].clear()

            # Logica de avance de la practica
            if not done:
                if best_conf_for_target >= CONF_THRESHOLD:
                    hold_count += 1
                    if hold_count >= HOLD_FRAMES:
                        completed.add(target_sign)
                        if target_idx + 1 < len(TARGETS):
                            target_idx += 1
                        hold_count = 0
                        print(f"  [OK] {target_sign} completada")
                else:
                    hold_count = max(0, hold_count - 1)

            # ---------- UI ----------
            done = target_idx >= len(TARGETS)  # recalcular tras posible avance
            _draw_ui(frame, TARGETS, target_idx, completed, hold_count,
                     best_pred, best_pred_conf, len(hands), done)

            cv2.imshow(win, frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord('q'), 27):
                break
            elif key == ord('r'):
                target_idx = 0; completed.clear(); hold_count = 0
                print("Practica reiniciada.")
            elif key == ord('n'):
                if target_idx < len(TARGETS):
                    target_idx += 1; hold_count = 0
            elif key == ord('p'):
                if target_idx > 0:
                    target_idx -= 1; hold_count = 0
                    completed.discard(TARGETS[target_idx][0])

    cap.release()
    cv2.destroyAllWindows()
    return 0


def _draw_ui(frame, TARGETS, target_idx, completed, hold_count,
             best_pred, best_pred_conf, n_hands, done):
    """Dibuja el panel de practica guiada."""
    h, w = frame.shape[:2]

    # Panel lateral derecho con la lista de senas
    panel_w = 150
    overlay = frame.copy()
    cv2.rectangle(overlay, (w - panel_w, 0), (w, h), (20, 20, 20), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

    cv2.putText(frame, "PROGRESO", (w - panel_w + 12, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

    # Lista compacta (mostrar ventana alrededor del objetivo)
    start = max(0, target_idx - 4)
    end = min(len(TARGETS), start + 14)
    y = 55
    for idx in range(start, end):
        sign, mode = TARGETS[idx]
        if sign in completed:
            color, mark = (0, 220, 0), "[x]"
        elif idx == target_idx:
            color, mark = (0, 220, 255), "->"
        else:
            color, mark = (160, 160, 160), "   "
        tag = "d" if mode == 'dynamic' else "s"
        cv2.putText(frame, f"{mark} {sign} ({tag})", (w - panel_w + 10, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        y += 24

    # Barra de progreso total
    prog = len(completed) / len(TARGETS)
    cv2.rectangle(frame, (w - panel_w + 10, h - 30), (w - 12, h - 14), (80, 80, 80), 1)
    cv2.rectangle(frame, (w - panel_w + 10, h - 30),
                  (w - panel_w + 10 + int((panel_w - 22) * prog), h - 14),
                  (0, 220, 0), -1)
    cv2.putText(frame, f"{len(completed)}/{len(TARGETS)}", (w - panel_w + 12, h - 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

    # Zona inferior izquierda: objetivo actual + prediccion
    overlay2 = frame.copy()
    cv2.rectangle(overlay2, (0, h - 130), (w - panel_w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay2, 0.55, frame, 0.45, 0, frame)

    if done:
        cv2.putText(frame, "COMPLETADO!", (30, h - 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 255, 120), 4)
        cv2.putText(frame, "R = repetir   Q = salir", (30, h - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
    else:
        sign, mode = TARGETS[target_idx]
        cv2.putText(frame, "HAZ:", (20, h - 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)
        cv2.putText(frame, sign, (120, h - 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0, 220, 255), 4)
        modo_txt = "dinamica (con movimiento)" if mode == 'dynamic' else "estatica"
        cv2.putText(frame, modo_txt, (230, h - 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1)

        # Prediccion actual
        if best_pred:
            pc = (0, 255, 120) if best_pred == sign else (0, 150, 255)
            cv2.putText(frame, f"Detecto: {best_pred} {best_pred_conf:.0%}",
                        (230, h - 55), cv2.FONT_HERSHEY_SIMPLEX, 0.6, pc, 2)

        # Barra de "hold"
        bar_w = 200
        cv2.rectangle(frame, (20, h - 35), (20 + bar_w, h - 20), (80, 80, 80), 1)
        fill = int(bar_w * min(1.0, hold_count / HOLD_FRAMES))
        cv2.rectangle(frame, (20, h - 35), (20 + fill, h - 20), (0, 220, 0), -1)

    # Indicadores arriba a la izquierda
    cv2.putText(frame, f"Manos: {n_hands}", (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0) if n_hands else (0, 0, 200), 1)
    cv2.putText(frame, "Q=salir N=siguiente P=anterior R=reiniciar", (10, 48),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1)


if __name__ == "__main__":
    sys.exit(main())
