#!/usr/bin/env python3
"""Modelos MediaPipe compartidos y utilidades de camara para LSM Teacher."""

import os, json, time, warnings
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import cv2

_ROOT = Path(__file__).resolve().parent.parent

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
warnings.filterwarnings("ignore")

import mediapipe as mp

BaseOptions = mp.tasks.BaseOptions
GestureRecognizer = mp.tasks.vision.GestureRecognizer
GestureRecognizerOptions = mp.tasks.vision.GestureRecognizerOptions
GestureRecognizerResult = mp.tasks.vision.GestureRecognizerResult
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode


# -- Paths -----------------------------------------------------------------
GESTURE_MODEL = str(_ROOT / "mediapipe_models" / "gesture_recognizer.task")
POSE_MODEL    = str(_ROOT / "mediapipe_models" / "pose_landmarker.task")
FACE_MODEL    = str(_ROOT / "mediapipe_models" / "face_landmarker.task")
REC_DIR       = str(_ROOT / "data" / "recordings")

HAND_LM = 21
POSE_LM = 33
FACE_LM = 478

# -- Esqueleto -------------------------------------------------------------
HAND_CONNS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(17,18),(18,19),(19,20),
    (0,17),
]

POSE_CONNS = [
    (11,12),                         # hombros
    (11,13),(13,15),                 # brazo izq
    (12,14),(14,16),                 # brazo der
    (11,23),(12,24),(23,24),         # torso
]
POSE_PTS = sorted({i for c in POSE_CONNS for i in c})

# -- Face landmarks (MediaPipe FaceLandmarker, 468 + 10 iris = 478) ------
# Dibujo por contornos anatomicos (polilineas que siguen la forma real
# de cada feature) -> formas optimas para cada parte de la cara.
FACE_SHAPE_LM = 468
FACE_IRIS_LM_RANGE = (468, 478)

# --- Contornos canonicos de la malla MediaPipe FaceMesh -----------------
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
             397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
             172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

FACE_LEFT_EYE  = [33, 7, 163, 144, 145, 153, 154, 155, 133,
                  173, 157, 158, 159, 160, 161, 246]
FACE_RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362,
                  398, 384, 385, 386, 387, 388, 466]

FACE_LEFT_BROW  = [70, 63, 105, 66, 107]
FACE_RIGHT_BROW = [336, 296, 334, 293, 300]

FACE_LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
                   291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
FACE_LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
                   308, 415, 310, 311, 312, 13, 82, 81, 80, 191]

FACE_NOSE_BRIDGE = [168, 6, 197, 195, 5, 4, 1]
FACE_NOSE_BOTTOM = [98, 97, 2, 326, 327]   # alas y base

# Conjuntos para dibujar (lista, es_cerrado)
FACE_CONTOURS = [
    (FACE_OVAL,        True),
    (FACE_LEFT_EYE,    True),
    (FACE_RIGHT_EYE,   True),
    (FACE_LEFT_BROW,   False),
    (FACE_RIGHT_BROW,  False),
    (FACE_LIPS_OUTER,  True),
    (FACE_LIPS_INNER,  True),
    (FACE_NOSE_BRIDGE, False),
    (FACE_NOSE_BOTTOM, False),
]

# Puntos donde dibujar nodos blancos (extremos / esquinas / hitos clave)
FACE_NODE_PTS = [
    10, 152,                       # frente, menton
    33, 133, 263, 362,             # esquinas externas/internas de ojos
    159, 145, 386, 374,            # arriba/abajo de ojos
    61, 291, 13, 14, 0, 17,        # comisuras y labios
    1, 4, 168,                     # nariz: puente, alas, punta
    98, 327,                       # alas de la nariz
    70, 107, 336, 300,             # extremos de cejas
    172, 397,                      # quijada
]

# Indices clave para metricas adaptativas (ratios -> scale invariant)
F_EYE_L = {"outer": 33,  "inner": 133, "top_a": 159, "top_b": 158,
           "bot_a": 145, "bot_b": 153}
F_EYE_R = {"outer": 263, "inner": 362, "top_a": 386, "top_b": 385,
           "bot_a": 374, "bot_b": 380}
F_MOUTH = {"left_corner": 61,  "right_corner": 291,
           "upper_top":  13,   "lower_bot":   14,
           "upper_out":  0,    "lower_out":   17}
F_BROW_L = {"inner": 107, "mid": 105, "outer": 70}
F_BROW_R = {"inner": 336, "mid": 334, "outer": 300}
F_NOSE_TIP = 1
F_CHIN     = 152
F_FOREHEAD = 10

# -- Color unico (azul) para todo el esqueleto ----------------------------
LINE_COLOR  = (255, 140, 0)   # azul
POINT_COLOR = (255, 255, 255) # blanco (nodos)
FACE_LINE   = (255, 140, 0)   # mismo azul, mas fino


# ======================================================================
#  SHARED STATE (LIVE_STREAM callback)
# ======================================================================

class GestureState:
    def __init__(self):
        self.hand_landmarks = []
        self.handedness = []
        self.timestamp = 0

    def update(self, result: GestureRecognizerResult, output_image: mp.Image, ts: int):
        self.hand_landmarks = result.hand_landmarks if result.hand_landmarks else []
        self.handedness = result.handedness if result.handedness else []
        self.timestamp = ts


# ======================================================================
#  ANGULOS
# ======================================================================

def _vec(p, q):
    return np.array([q.x - p.x, q.y - p.y, q.z - p.z], dtype=np.float32)

def _angle3(a, b, c):
    """Angulo en el vertice b (grados) entre vectores b->a y b->c."""
    ba = _vec(b, a)
    bc = _vec(b, c)
    n = (np.linalg.norm(ba) * np.linalg.norm(bc)) + 1e-8
    cos = float(np.dot(ba, bc) / n)
    cos = max(-1.0, min(1.0, cos))
    return float(np.degrees(np.arccos(cos)))


# Articulaciones por dedo: (nombre, triple indices (a,b,c)) b es la articulacion
HAND_JOINTS = [
    # Pulgar (CMC, MCP, IP)
    ("thumb_cmc",  (0, 1, 2)),
    ("thumb_mcp",  (1, 2, 3)),
    ("thumb_ip",   (2, 3, 4)),
    # Indice
    ("index_mcp",  (0, 5, 6)),
    ("index_pip",  (5, 6, 7)),
    ("index_dip",  (6, 7, 8)),
    # Medio
    ("middle_mcp", (0, 9, 10)),
    ("middle_pip", (9, 10, 11)),
    ("middle_dip", (10, 11, 12)),
    # Anular
    ("ring_mcp",   (0, 13, 14)),
    ("ring_pip",   (13, 14, 15)),
    ("ring_dip",   (14, 15, 16)),
    # Menique
    ("pinky_mcp",  (0, 17, 18)),
    ("pinky_pip",  (17, 18, 19)),
    ("pinky_dip",  (18, 19, 20)),
]

# Resumen por dedo (para consola) -> una curvatura representativa (PIP o MCP)
FINGER_SUMMARY = [
    ("Thumb",  "thumb_ip"),
    ("Index",  "index_pip"),
    ("Middle", "middle_pip"),
    ("Ring",   "ring_pip"),
    ("Pinky",  "pinky_pip"),
]

POSE_JOINTS = [
    # Brazo izquierdo
    ("L_shoulder", (13, 11, 23)),   # codo-hombro-cadera
    ("L_elbow",    (11, 13, 15)),   # hombro-codo-muneca
    ("L_wrist",    (13, 15, 19)),   # codo-muneca-indice
    # Brazo derecho
    ("R_shoulder", (14, 12, 24)),
    ("R_elbow",    (12, 14, 16)),
    ("R_wrist",    (14, 16, 20)),
    # Torso / piernas (solo devuelven valor util si son visibles)
    ("L_hip",      (11, 23, 25)),
    ("R_hip",      (12, 24, 26)),
    ("L_knee",     (23, 25, 27)),
    ("R_knee",     (24, 26, 28)),
    # Cabeza: angulo en la nariz (0) entre hombros -> head tilt
    ("head_tilt",  (11, 0, 12)),
]


def hand_angles(lms) -> dict:
    out = {}
    for name, (a, b, c) in HAND_JOINTS:
        if a < len(lms) and b < len(lms) and c < len(lms):
            out[name] = _angle3(lms[a], lms[b], lms[c])
    return out


def _mid_lm(a, b):
    """Landmark virtual = punto medio 3D de a y b."""
    return SimpleNamespace(
        x=(a.x + b.x) * 0.5,
        y=(a.y + b.y) * 0.5,
        z=(a.z + b.z) * 0.5,
    )


def pose_angles(lms) -> dict:
    out = {}
    for name, (a, b, c) in POSE_JOINTS:
        if a < len(lms) and b < len(lms) and c < len(lms):
            out[name] = _angle3(lms[a], lms[b], lms[c])

    # -- Cuello (angulos derivados con landmarks virtuales) --------------
    if len(lms) >= 25:
        sm = _mid_lm(lms[11], lms[12])   # shoulder midpoint (base del cuello)
        hm = _mid_lm(lms[23], lms[24])   # hip midpoint (base de la columna)
        # neck_lean: cuanto se inclina la cabeza frente/atras respecto al torso
        # 180 = cabeza alineada con columna, <180 = inclinada adelante
        out["neck_lean"] = _angle3(lms[0], sm, hm)
        # neck_yaw: rotacion usando orejas respecto a la nariz
        if len(lms) >= 9:
            out["neck_yaw"] = _angle3(lms[7], lms[0], lms[8])
    return out


# ======================================================================
#  EXPRESION FACIAL (adaptativa por geometria de cada cara)
#  ----------------------------------------------------------------
#  Todas las metricas se devuelven como ratios -> son scale-invariant
#  (no dependen del tamano del rostro en pantalla ni de la distancia
#  a la camara, asi se "adaptan" a cualquier cara distinta).
# ======================================================================

def _dist(p, q):
    return float(np.hypot(q.x - p.x, q.y - p.y))

def _midp(p, q):
    return ((p.x + q.x) * 0.5, (p.y + q.y) * 0.5)

def _ear(lms, eye_idx) -> float:
    """Eye Aspect Ratio (Soukupova-Cech), normalizado por ancho del ojo."""
    a = lms[eye_idx["top_a"]]; b = lms[eye_idx["top_b"]]
    c = lms[eye_idx["bot_a"]]; d = lms[eye_idx["bot_b"]]
    o = lms[eye_idx["outer"]]; i = lms[eye_idx["inner"]]
    v1 = _dist(a, c)
    v2 = _dist(b, d)
    h  = _dist(o, i)
    if h <= 1e-6:
        return 0.0
    return (v1 + v2) / (2.0 * h)

def face_metrics(lms) -> dict:
    """Diccionario con 10+ metricas faciales adaptativas en [0..N]."""
    out = {}
    if len(lms) < 478:
        return out

    # -- Escala personal de la cara: distancia inter-ocular (estable) ----
    iod = _dist(lms[F_EYE_L["outer"]], lms[F_EYE_R["outer"]])
    if iod <= 1e-6:
        return out
    # Altura de la cara (frente -> menton) como segunda referencia
    face_h = _dist(lms[F_FOREHEAD], lms[F_CHIN])

    # -- Ojos -----------------------------------------------------------
    out["ear_L"] = _ear(lms, F_EYE_L)
    out["ear_R"] = _ear(lms, F_EYE_R)

    # -- Boca: apertura vertical / ancho (MAR) --------------------------
    mw = _dist(lms[F_MOUTH["left_corner"]], lms[F_MOUTH["right_corner"]])
    mh = _dist(lms[F_MOUTH["upper_top"]],   lms[F_MOUTH["lower_bot"]])
    out["mar"]      = (mh / mw) if mw > 1e-6 else 0.0
    # Sonrisa: ancho boca / IOD (mas alto = mas estirada)
    out["smile"]    = mw / iod
    # Apertura externa boca (labios completos) / IOD
    mh_full = _dist(lms[F_MOUTH["upper_out"]], lms[F_MOUTH["lower_out"]])
    out["mouth_open"] = mh_full / iod

    # -- Cejas: altura desde ceja media a ojo (top), normalizada por IOD
    brow_l_y = lms[F_BROW_L["mid"]].y
    eye_l_y  = lms[F_EYE_L["top_a"]].y
    out["brow_L"] = (eye_l_y - brow_l_y) / iod  # >0 ceja arriba del ojo
    brow_r_y = lms[F_BROW_R["mid"]].y
    eye_r_y  = lms[F_EYE_R["top_a"]].y
    out["brow_R"] = (eye_r_y - brow_r_y) / iod

    # Asimetria de cejas (ceja levantada solo un lado)
    out["brow_asym"] = out["brow_L"] - out["brow_R"]

    # -- Mandibula: nariz-menton / nariz-frente -> apertura de mandibula
    n_chin = _dist(lms[F_NOSE_TIP], lms[F_CHIN])
    n_fore = _dist(lms[F_NOSE_TIP], lms[F_FOREHEAD])
    out["jaw"] = (n_chin / n_fore) if n_fore > 1e-6 else 0.0

    # -- Sonrisa direccional: comisuras vs centro vertical de boca ------
    cy = (lms[F_MOUTH["upper_top"]].y + lms[F_MOUTH["lower_bot"]].y) * 0.5
    lc = lms[F_MOUTH["left_corner"]].y
    rc = lms[F_MOUTH["right_corner"]].y
    # Negativo = comisuras subidas (sonrisa). Normalizado por face_h.
    if face_h > 1e-6:
        out["smile_lift"] = ((cy - lc) + (cy - rc)) * 0.5 / face_h
    else:
        out["smile_lift"] = 0.0

    return out


# ======================================================================
#  DRAWING (todo azul, sin labels de traduccion)
# ======================================================================

def draw_hands(frame, state: GestureState):
    h, w = frame.shape[:2]
    for hand_lms in state.hand_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in hand_lms]
        for a, b in HAND_CONNS:
            if a < len(pts) and b < len(pts):
                cv2.line(frame, pts[a], pts[b], LINE_COLOR, 2, cv2.LINE_AA)
        for pt in pts:
            cv2.circle(frame, pt, 3, POINT_COLOR, -1, cv2.LINE_AA)


def draw_pose(frame, pose_result):
    if not pose_result or not pose_result.pose_landmarks:
        return
    h, w = frame.shape[:2]
    lms = pose_result.pose_landmarks[0]
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in lms]
    for a, b in POSE_CONNS:
        if a < len(pts) and b < len(pts):
            cv2.line(frame, pts[a], pts[b], LINE_COLOR, 2, cv2.LINE_AA)
    for idx in POSE_PTS:
        if idx < len(pts):
            cv2.circle(frame, pts[idx], 4, POINT_COLOR, -1, cv2.LINE_AA)


def draw_face(frame, face_result, pose_result):
    """Dibujo del rostro:
       1) Contornos anatomicos como polilineas (formas optimas para cada
          parte: ovalo facial, ojos, cejas, labios, nariz).
       2) Cuello como geometria propia (silueta trapezoidal + linea central),
          derivada del tamano del rostro. NO se une a los hombros.
       3) Vertices clave en puntos blancos + iris.
    """
    if not face_result or not face_result.face_landmarks:
        return
    h, w = frame.shape[:2]
    lms = face_result.face_landmarks[0]
    n = len(lms)
    if n < FACE_SHAPE_LM:
        return

    # ---- (1) Contornos anatomicos --------------------------------------
    for idxs, closed in FACE_CONTOURS:
        pts = []
        for i in idxs:
            if i < n:
                pts.append([int(lms[i].x * w), int(lms[i].y * h)])
        if len(pts) < 2:
            continue
        arr = np.array(pts, dtype=np.int32).reshape(-1, 1, 2)
        cv2.polylines(frame, [arr], closed, FACE_LINE, 1, cv2.LINE_AA)

    # ---- (2) Cuello "inteligente": se acopla a la anatomia real --------
    # Referencias faciales
    forehead = (int(lms[10].x * w),  int(lms[10].y * h))
    chin     = (int(lms[152].x * w), int(lms[152].y * h))
    jaw_L    = (int(lms[172].x * w), int(lms[172].y * h))   # quijada izq (subj)
    jaw_R    = (int(lms[397].x * w), int(lms[397].y * h))   # quijada der
    face_h = float(np.hypot(chin[0] - forehead[0], chin[1] - forehead[1]))

    have_pose = (pose_result and pose_result.pose_landmarks and
                 len(pose_result.pose_landmarks[0]) > 12)

    if have_pose:
        # Calibrado anatomicamente: el cuello sigue al torso del usuario.
        plm = pose_result.pose_landmarks[0]
        sLx, sLy = plm[11].x * w, plm[11].y * h
        sRx, sRy = plm[12].x * w, plm[12].y * h
        sMx, sMy = (sLx + sRx) * 0.5, (sLy + sRy) * 0.5
        shoulder_w = float(np.hypot(sRx - sLx, sRy - sLy))

        # Vector unitario a lo largo de los hombros -> "horizontal" del torso
        # (asi el cuello se inclina cuando ladeas los hombros)
        if shoulder_w > 1e-3:
            ux, uy = (sRx - sLx) / shoulder_w, (sRy - sLy) / shoulder_w
        else:
            ux, uy = 1.0, 0.0

        # Base del cuello = clavicula: ~75% del trayecto del menton al
        # punto medio de hombros (queda por encima de los hombros).
        T_FRAC = 0.75
        base_cx = chin[0] + (sMx - chin[0]) * T_FRAC
        base_cy = chin[1] + (sMy - chin[1]) * T_FRAC

        # Ancho de la clavicula ~ 32% del ancho de hombros (proporcion real)
        # acotado para que no quede mas estrecho que el menton ni mas ancho
        # que la mandibula, sin importar la distancia a la camara.
        jaw_w = float(np.hypot(jaw_R[0] - jaw_L[0], jaw_R[1] - jaw_L[1]))
        clav_w = max(jaw_w * 0.95, min(shoulder_w * 0.32, jaw_w * 1.35))
        hw = clav_w * 0.5

        collar_L = (int(round(base_cx - ux * hw)), int(round(base_cy - uy * hw)))
        collar_R = (int(round(base_cx + ux * hw)), int(round(base_cy + uy * hw)))
        throat   = (int(round(base_cx)),           int(round(base_cy)))

        # Adam's apple aprox: 50% entre menton y base, ligeramente al frente
        adam = (int(round((chin[0] + base_cx) * 0.5)),
                int(round((chin[1] + base_cy) * 0.5)))
    else:
        # Fallback sin pose: trapecio recto bajo el menton, escalado por
        # la altura facial; mismas proporciones anatomicas.
        neck_len = face_h * 0.60
        clav_w   = float(np.hypot(jaw_R[0] - jaw_L[0],
                                  jaw_R[1] - jaw_L[1])) * 1.05
        hw = clav_w * 0.5
        cx, cy = chin[0], chin[1] + neck_len
        collar_L = (int(round(cx - hw)), int(round(cy)))
        collar_R = (int(round(cx + hw)), int(round(cy)))
        throat   = (int(round(cx)),      int(round(cy)))
        adam     = (int(round(chin[0])), int(round(chin[1] + neck_len * 0.5)))

    # Esternocleidomastoideos (lados del cuello): de jaw a la clavicula,
    # con un punto intermedio para que sigan la curva natural.
    sm_L = (int(round((jaw_L[0] * 0.55 + collar_L[0] * 0.45))),
            int(round((jaw_L[1] * 0.55 + collar_L[1] * 0.45))))
    sm_R = (int(round((jaw_R[0] * 0.55 + collar_R[0] * 0.45))),
            int(round((jaw_R[1] * 0.55 + collar_R[1] * 0.45))))

    neck_verts = [collar_L, collar_R, throat, adam, sm_L, sm_R]
    neck_edges = [
        # Lados del cuello (con punto intermedio -> mas anatomico)
        (jaw_L, sm_L), (sm_L, collar_L),
        (jaw_R, sm_R), (sm_R, collar_R),
        # Clavicula (base)
        (collar_L, throat), (throat, collar_R),
        # Linea central frontal: menton -> nuez de adan -> hueso suprasternal
        (chin, adam), (adam, throat),
    ]
    for a, b in neck_edges:
        if (0 <= a[0] < w and 0 <= a[1] < h and
            0 <= b[0] < w and 0 <= b[1] < h):
            cv2.line(frame, a, b, FACE_LINE, 1, cv2.LINE_AA)

    # ---- (3) Vertices blancos (nodos clave + cuello) -------------------
    for idx in FACE_NODE_PTS:
        if idx < n:
            x = int(lms[idx].x * w); y = int(lms[idx].y * h)
            if 0 <= x < w and 0 <= y < h:
                cv2.circle(frame, (x, y), 2, POINT_COLOR, -1, cv2.LINE_AA)
    for p in neck_verts:
        if 0 <= p[0] < w and 0 <= p[1] < h:
            cv2.circle(frame, p, 3, POINT_COLOR, -1, cv2.LINE_AA)

    # ---- (4) Iris ------------------------------------------------------
    a, b = FACE_IRIS_LM_RANGE
    if n >= b:
        for lm in lms[a:b]:
            x = int(lm.x * w); y = int(lm.y * h)
            if 0 <= x < w and 0 <= y < h:
                cv2.circle(frame, (x, y), 2, POINT_COLOR, -1, cv2.LINE_AA)


# ======================================================================
#  CONSOLA (esquina superior derecha)
# ======================================================================

def _hand_label(state: GestureState, hi: int) -> str:
    if hi < len(state.handedness) and state.handedness[hi]:
        return state.handedness[hi][0].category_name.upper()
    return f"HAND {hi+1}"


def draw_console(frame, lines, *, ui: float):
    """Panel semitransparente con texto blanco en la esquina superior derecha."""
    if not lines:
        return
    H, W = frame.shape[:2]
    font = cv2.FONT_HERSHEY_PLAIN   # delgado, angular (estilo Arial)
    fsz_title = 0.90 * ui           # PLAIN usa escala diferente a SIMPLEX
    fsz_line  = 0.80 * ui
    th = max(1, int(round(ui)))

    # medir ancho
    widths = []
    for kind, text in lines:
        fsz = fsz_title if kind == "title" else fsz_line
        (tw, _), _ = cv2.getTextSize(text, font, fsz, th)
        widths.append(tw)
    pad = int(12 * ui)
    row = int(18 * ui)
    box_w = max(widths) + pad * 2
    box_h = row * len(lines) + pad

    x2 = W - int(10 * ui)
    x1 = x2 - box_w
    y1 = int(10 * ui)
    y2 = y1 + box_h

    ov = frame.copy()
    cv2.rectangle(ov, (x1, y1), (x2, y2), (20, 20, 20), -1)
    cv2.addWeighted(ov, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (x1, y1), (x2, y2), (80, 80, 80), 1, cv2.LINE_AA)

    y = y1 + int(22 * ui)
    for kind, text in lines:
        fsz = fsz_title if kind == "title" else fsz_line
        col = (230, 230, 230) if kind == "title" else (200, 200, 200)
        cv2.putText(frame, text, (x1 + pad, y), font, fsz, col, th, cv2.LINE_AA)
        y += row


def build_console_lines(state: GestureState,
                        pose_result,
                        h_angles_per_hand,
                        p_angles,
                        f_metrics) -> list:
    """Devuelve una lista de (kind, text) para draw_console."""
    lines = [("title", "JOINTS (deg)")]

    for hi, lms in enumerate(state.hand_landmarks):
        label = _hand_label(state, hi)
        lines.append(("title", label))
        ang = h_angles_per_hand[hi] if hi < len(h_angles_per_hand) else {}
        for nice, key in FINGER_SUMMARY:
            v = ang.get(key)
            vtxt = f"{v:5.1f}" if v is not None else "  -- "
            lines.append(("line", f"  {nice:<6}: {vtxt}"))

    if p_angles:
        lines.append(("title", "POSE"))
        order = ["L_shoulder", "L_elbow", "L_wrist",
                 "R_shoulder", "R_elbow", "R_wrist",
                 "L_hip", "R_hip", "L_knee", "R_knee",
                 "head_tilt", "neck_lean", "neck_yaw"]
        pretty = {"L_shoulder": "L Shldr", "L_elbow": "L Elbow", "L_wrist": "L Wrist",
                  "R_shoulder": "R Shldr", "R_elbow": "R Elbow", "R_wrist": "R Wrist",
                  "L_hip":      "L Hip",   "R_hip":   "R Hip",
                  "L_knee":     "L Knee",  "R_knee":  "R Knee",
                  "head_tilt":  "HeadTlt", "neck_lean": "NeckLean",
                  "neck_yaw":   "NeckYaw"}
        for k in order:
            v = p_angles.get(k)
            vtxt = f"{v:5.1f}" if v is not None else "  -- "
            lines.append(("line", f"  {pretty[k]:<8}: {vtxt}"))

    if f_metrics:
        lines.append(("title", "FACE (ratios)"))
        rows = [
            ("EAR L",    "ear_L"),
            ("EAR R",    "ear_R"),
            ("Mouth",    "mouth_open"),
            ("MAR",      "mar"),
            ("Smile",    "smile"),
            ("SmileLft", "smile_lift"),
            ("Brow L",   "brow_L"),
            ("Brow R",   "brow_R"),
            ("BrowAsym", "brow_asym"),
            ("Jaw",      "jaw"),
        ]
        for nice, key in rows:
            v = f_metrics.get(key)
            vtxt = f"{v:+.3f}" if v is not None else "  -- "
            lines.append(("line", f"  {nice:<8}: {vtxt}"))

    return lines


# ======================================================================
#  GRABACION
# ======================================================================

def _lm_to_list(lms):
    return [[float(lm.x), float(lm.y), float(lm.z)] for lm in lms]


def make_frame_record(t_rel: float,
                      state: GestureState,
                      pose_result,
                      face_result,
                      h_angles_per_hand,
                      p_angles,
                      f_metrics) -> dict:
    hands_rec = []
    for hi, lms in enumerate(state.hand_landmarks):
        label = None
        if hi < len(state.handedness) and state.handedness[hi]:
            label = state.handedness[hi][0].category_name
        hands_rec.append({
            "handedness": label,
            "landmarks":  _lm_to_list(lms),
            "angles":     h_angles_per_hand[hi] if hi < len(h_angles_per_hand) else {},
        })
    pose_rec = None
    if pose_result and pose_result.pose_landmarks:
        pose_rec = {
            "landmarks": _lm_to_list(pose_result.pose_landmarks[0]),
            "angles":    p_angles,
        }
    face_rec = None
    if face_result and face_result.face_landmarks:
        face_rec = {
            "landmarks": _lm_to_list(face_result.face_landmarks[0]),
            "metrics":   f_metrics,
        }
    return {"t": round(t_rel, 4),
            "hands": hands_rec,
            "pose":  pose_rec,
            "face":  face_rec}


def save_recording(frames: list, fps_est: float) -> str:
    os.makedirs(REC_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(REC_DIR, f"gesture_{stamp}.json")
    data = {
        "meta": {
            "created": datetime.now().isoformat(timespec="seconds"),
            "frames":  len(frames),
            "fps_est": round(fps_est, 2),
            "label":   None,  # <- rellenar despues para entrenamiento
            "schema":  {
                "hand_angles":  [n for n, _ in HAND_JOINTS],
                "pose_angles":  [n for n, _ in POSE_JOINTS],
                "face_metrics": ["ear_L", "ear_R", "mar", "smile",
                                 "smile_lift", "mouth_open",
                                 "brow_L", "brow_R", "brow_asym", "jaw"],
            },
        },
        "frames": frames,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return path


# ======================================================================
#  PREFLIGHT
# ======================================================================

def _check_required_files() -> bool:
    required = [
        (GESTURE_MODEL, "python download_models.py"),
        (POSE_MODEL,    "python download_models.py"),
    ]
    missing = [(p, hint) for p, hint in required if not os.path.exists(p)]
    if missing:
        print("  [ERR] Faltan archivos requeridos:")
        for p, hint in missing:
            print(f"     - {p}   ->  {hint}")
        return False
    if not os.path.exists(FACE_MODEL):
        print(f"  [WARN] {FACE_MODEL} no encontrado -> sin expresion facial")
        print( "         (ejecuta:  python download_models.py)")
    return True


def _open_camera(index: int = 0):
    if os.name == "nt":
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if cap.isOpened():
            return cap
        cap.release()
    return cv2.VideoCapture(index)


# ======================================================================
#  REAL-TIME
# ======================================================================

def run_camera():
    if not _check_required_files():
        return

    gesture_state = GestureState()

    recognizer = GestureRecognizer.create_from_options(
        GestureRecognizerOptions(
            base_options=BaseOptions(model_asset_path=GESTURE_MODEL),
            running_mode=VisionRunningMode.LIVE_STREAM,
            num_hands=2,
            min_hand_detection_confidence=0.4,
            min_hand_presence_confidence=0.4,
            min_tracking_confidence=0.4,
            result_callback=gesture_state.update,
        ))
    print("  [OK] GestureRecognizer (LIVE_STREAM)")

    # VIDEO mode -> mantiene tracking temporal entre frames, mucho mas
    # tolerante a rotaciones/inclinaciones de cabeza y ladeos del torso.
    pose_lm = PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=POSE_MODEL),
            running_mode=VisionRunningMode.VIDEO,
            min_pose_detection_confidence=0.2,
            min_pose_presence_confidence=0.2,
            min_tracking_confidence=0.2,
        ))
    print("  [OK] PoseLandmarker (VIDEO)")

    face_lm = None
    if os.path.exists(FACE_MODEL):
        try:
            face_lm = FaceLandmarker.create_from_options(
                FaceLandmarkerOptions(
                    base_options=BaseOptions(model_asset_path=FACE_MODEL),
                    running_mode=VisionRunningMode.VIDEO,
                    num_faces=1,
                    # Umbrales bajos + VIDEO mode -> gran tolerancia a giros
                    # y ladeos de la cabeza.
                    min_face_detection_confidence=0.2,
                    min_face_presence_confidence=0.2,
                    min_tracking_confidence=0.2,
                ))
            print("  [OK] FaceLandmarker (VIDEO, 478 puntos)")
        except Exception as e:
            print(f"  [WARN] FaceLandmarker no se pudo crear: {e}")
            face_lm = None

    CAM_WIDTH, CAM_HEIGHT = 1920, 1080
    INFER_WIDTH, INFER_HEIGHT = 960, 540

    cap = _open_camera(0)
    if not cap.isOpened():
        print("  [ERR] No se pudo abrir la camara"); return
    try:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    except Exception:
        pass
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    act_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or CAM_WIDTH)
    act_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or CAM_HEIGHT)
    act_fps = cap.get(cv2.CAP_PROP_FPS) or 0
    print(f"  [OK] Camara {act_w}x{act_h} @ {act_fps:.0f} fps  (inferencia: {INFER_WIDTH}x{INFER_HEIGHT})")

    print("\n  --- CONTROLES ---")
    print("  r       = iniciar/detener grabacion (guarda JSON al detener)")
    print("  q       = salir\n")

    fps = 0.0
    prev_t = time.perf_counter()
    last_ts_ms = 0

    POSE_EVERY_N = 2
    FACE_EVERY_N = 2
    frame_i = 0
    pose_result = None
    face_result = None

    recording = False
    rec_frames = []
    rec_start_t = 0.0
    rec_last_t = 0.0

    while True:
        ret, raw = cap.read()
        if not ret:
            break

        disp = cv2.flip(raw, 1)
        if disp.shape[1] != INFER_WIDTH or disp.shape[0] != INFER_HEIGHT:
            small_bgr = cv2.resize(disp, (INFER_WIDTH, INFER_HEIGHT),
                                   interpolation=cv2.INTER_LINEAR)
        else:
            small_bgr = disp
        rgb = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        ts_ms = int(time.time() * 1000)
        if ts_ms <= last_ts_ms:
            ts_ms = last_ts_ms + 1
        last_ts_ms = ts_ms
        try:
            recognizer.recognize_async(mp_img, ts_ms)
        except Exception:
            pass

        frame_i += 1
        if frame_i % POSE_EVERY_N == 0:
            try:
                pose_result = pose_lm.detect_for_video(mp_img, ts_ms)
            except Exception:
                pass
        if face_lm is not None and frame_i % FACE_EVERY_N == 0:
            try:
                face_result = face_lm.detect_for_video(mp_img, ts_ms)
            except Exception:
                pass

        # -- Angulos / metricas --------------------------------------
        h_angles_per_hand = [hand_angles(lms) for lms in gesture_state.hand_landmarks]
        p_angles = {}
        if pose_result and pose_result.pose_landmarks:
            p_angles = pose_angles(pose_result.pose_landmarks[0])
        f_metrics = {}
        if face_result and face_result.face_landmarks:
            f_metrics = face_metrics(face_result.face_landmarks[0])

        # -- Grabacion ------------------------------------------------
        if recording:
            tnow = time.time()
            rec_frames.append(make_frame_record(
                tnow - rec_start_t, gesture_state, pose_result, face_result,
                h_angles_per_hand, p_angles, f_metrics))
            rec_last_t = tnow

        # -- Render ---------------------------------------------------
        H, W = disp.shape[:2]
        UI = max(0.75, H / 480.0)
        T = max(1, int(round(UI)))

        draw_hands(disp, gesture_state)
        draw_pose(disp, pose_result)
        draw_face(disp, face_result, pose_result)

        # Consola de articulaciones + expresion
        console_lines = build_console_lines(
            gesture_state, pose_result, h_angles_per_hand, p_angles, f_metrics)
        draw_console(disp, console_lines, ui=UI)

        # FPS
        now_t = time.perf_counter()
        fps = 0.85 * fps + 0.15 / max(now_t - prev_t, 0.001)
        prev_t = now_t

        # Barra inferior minimalista (texto blanco/gris, sin colores)
        bar_h = int(26 * UI)
        ov = disp.copy()
        cv2.rectangle(ov, (0, H - bar_h), (W, H), (20, 20, 20), -1)
        cv2.addWeighted(ov, 0.7, disp, 0.3, 0, disp)

        n_hands = len(gesture_state.hand_landmarks)
        has_pose = pose_result is not None and bool(pose_result.pose_landmarks)
        has_face = face_result is not None and bool(face_result.face_landmarks)
        status = (f"Hands:{n_hands}  Pose:{'Y' if has_pose else 'N'}  "
                  f"Face:{'Y' if has_face else 'N'}  FPS:{fps:4.0f}")
        cv2.putText(disp, status, (int(10 * UI), H - int(8 * UI)),
                    cv2.FONT_HERSHEY_PLAIN, 0.85 * UI,
                    (220, 220, 220), T, cv2.LINE_AA)

        hint = "r=grabar  q=salir"
        (tw, _), _ = cv2.getTextSize(hint, cv2.FONT_HERSHEY_PLAIN, 0.85 * UI, T)
        cv2.putText(disp, hint, (W - tw - int(10 * UI), H - int(8 * UI)),
                    cv2.FONT_HERSHEY_PLAIN, 0.85 * UI,
                    (160, 160, 160), T, cv2.LINE_AA)

        # Indicador de REC (blanco, sin color)
        if recording:
            dur = time.time() - rec_start_t
            rec_txt = f"REC  {dur:5.1f}s   {len(rec_frames)}f"
            (tw, th), _ = cv2.getTextSize(rec_txt, cv2.FONT_HERSHEY_PLAIN, 1.0 * UI, T)
            pad = int(8 * UI)
            x1, y1 = int(10 * UI), int(10 * UI)
            x2, y2 = x1 + tw + pad * 2, y1 + th + pad * 2
            ov2 = disp.copy()
            cv2.rectangle(ov2, (x1, y1), (x2, y2), (20, 20, 20), -1)
            cv2.addWeighted(ov2, 0.72, disp, 0.28, 0, disp)
            cv2.rectangle(disp, (x1, y1), (x2, y2), (220, 220, 220), 1, cv2.LINE_AA)
            # punto pulsante (blanco)
            blink = 0.5 + 0.5 * np.sin(time.time() * 6)
            r = int((3 + 2 * blink) * UI)
            cv2.circle(disp, (x1 + pad + r, y1 + pad + r + int(2 * UI)),
                       r, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.putText(disp, rec_txt,
                        (x1 + pad + int(18 * UI), y1 + pad + th),
                        cv2.FONT_HERSHEY_PLAIN, 1.0 * UI,
                        (240, 240, 240), T, cv2.LINE_AA)

        cv2.imshow("LSM - Captura de movimiento", disp)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            if recording:
                fps_est = len(rec_frames) / max(rec_last_t - rec_start_t, 1e-3)
                path = save_recording(rec_frames, fps_est)
                print(f"  >> guardado: {path}  ({len(rec_frames)} frames, {fps_est:.1f} fps)")
            break
        elif key == ord('r'):
            if not recording:
                recording = True
                rec_frames = []
                rec_start_t = time.time()
                rec_last_t = rec_start_t
                print("  >> REC inicio")
            else:
                recording = False
                fps_est = len(rec_frames) / max(rec_last_t - rec_start_t, 1e-3)
                if rec_frames:
                    path = save_recording(rec_frames, fps_est)
                    print(f"  >> guardado: {path}  ({len(rec_frames)} frames, {fps_est:.1f} fps)")
                else:
                    print("  >> REC sin frames, no se guardo nada")

    cap.release()
    cv2.destroyAllWindows()
    recognizer.close()
    pose_lm.close()
    if face_lm is not None:
        try:
            face_lm.close()
        except Exception:
            pass


# ======================================================================
#  MAIN
# ======================================================================

def main():
    print("=" * 70)
    print("  CAPTURA DE MOVIMIENTO LSM (manos + pose + cara + angulos)")
    print("  MediaPipe GestureRecognizer + PoseLandmarker + FaceLandmarker")
    print("=" * 70)
    print("\nInicializando...")
    run_camera()


if __name__ == "__main__":
    main()
