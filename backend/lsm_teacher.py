#!/usr/bin/env python3
"""LSM Teacher — deteccion del alfabeto LSM por angulos articulares 3-D."""

import os
import sys
import time
import json
import math
from pathlib import Path
from collections import deque

import cv2
import numpy as np
import mediapipe as mp

sys.path.insert(0, str(Path(__file__).resolve().parent))
from main import (  # noqa: E402
    GestureState,
    HAND_CONNS,
    GESTURE_MODEL, POSE_MODEL,
    BaseOptions, GestureRecognizer, GestureRecognizerOptions,
    VisionRunningMode,
    _open_camera,
)


# ======================================================================
#  Constantes globales
# ======================================================================

_ROOT         = Path(__file__).resolve().parent.parent
CHART_PATH    = str(_ROOT / "assets" / "lsm_alphabet.png")
GIFS_DIR      = _ROOT / "data" / "gifs"
PROGRESS_DIR  = str(_ROOT / "data" / "recordings")
PROGRESS_PATH = str(_ROOT / "data" / "recordings" / ".teacher_progress.json")

# Colores BGR (tema oscuro profesional)
BG_DARK     = (22, 22, 26)
PANEL_DARK  = (34, 34, 40)
PANEL_MID   = (50, 50, 58)
BORDER_COL  = (95, 95, 108)
TXT_MAIN    = (245, 245, 245)
TXT_DIM     = (180, 180, 190)
TXT_FAINT   = (130, 130, 140)
USER_COL    = (240, 200, 80)    # amarillo suave para esqueleto del usuario
NODE_COL    = (255, 255, 255)
OK_COL      = (110, 220, 135)   # verde
BAD_COL     = (90, 90, 240)     # rojo
ACCENT_COL  = (0, 180, 240)     # azul-cian (movimiento)

# Deteccion
MATCH_THRESHOLD      = 0.88   # estaticas: ~4.5/5 dedos OK (user-friendly)
MATCH_THRESHOLD_MOV  = 0.72   # con movimiento: ~3.5/5 dedos OK
HOLD_SECONDS         = 1.0    # tiempo manteniendo la sena para avanzar


# LSM_ALPHABET: (letra, molde ECCCC, hint, con_movimiento)
# E=extendido  C=cerrado  ?=wildcard
LSM_ALPHABET = [
    ('A', 'ECCCC',  'Puno cerrado; el pulgar se ve claramente al costado.',     False),
    ('B', 'CEEEE',  'Cuatro dedos juntos hacia arriba; pulgar cruzado sobre la palma.', False),
    ('C', '?????',  'Toda la mano curvada en forma de "C"; dedos juntos.',      False),
    ('D', 'CECCC',  'Indice apuntando arriba; el pulgar toca la yema del medio.', False),
    ('E', 'CCCCC',  'Todos los dedos doblados tocando la palma; pulgar sobre ellos.', False),
    ('F', 'CCEEE',  'Pulgar e indice se tocan formando un circulo; otros 3 arriba.', False),
    ('G', 'EECCC',  'Pulgar e indice extendidos en HORIZONTAL, como apuntando al costado.', False),
    ('H', '?EECC',  'Indice y medio juntos en HORIZONTAL, como apuntando al costado.', False),
    ('I', 'CCCCE',  'Solo el menique extendido hacia arriba; resto en puno.',   False),
    ('J', 'CCCCE',  'Como "I" pero dibujando una "J" en el aire con el menique.', True),
    ('K', 'EEECC',  'Misma forma que la P: indice y medio en "V", pulgar ENTRE ellos; '
                    'la mano orientada HACIA ENFRENTE (hacia quien te ve). Movimiento corto al frente.', True),
    ('L', 'EECCC',  'Mano VERTICAL: pulgar e indice en angulo recto ("L").',    False),
    # M / N / Ñ: el sistema acepta DOS variantes
    #   variante 1 (guia oficial): puño con pulgar metido, similar a ASL
    #   variante 2 (regional): mano hacia abajo con dedos extendidos
    # El template usa wildcards y _extra_M/N premia la mejor coincidencia
    # con cualquiera de las dos variantes.
    ('M', '?????',  'Variante 1: puño con tres dedos doblados sobre el pulgar.  '
                    'Variante 2: mano hacia abajo con indice/medio/anular extendidos.', False),
    ('N', '?????',  'Variante 1: puño con dos dedos doblados sobre el pulgar.  '
                    'Variante 2: mano hacia abajo con indice y medio extendidos.', False),
    ('Ñ', '?????',  'Como "N" pero con un leve movimiento ondulante.',          True),
    ('O', 'CCCCC',  'Todos los dedos juntos al pulgar formando un CIRCULO "O".', False),
    ('P', '?EECC',  'Indice hacia ARRIBA y medio hacia ENFRENTE (como la lamina); '
                    'pulgar ENTRE ellos. Mano bien ARRIBA / orientacion alta.', False),
    ('Q', 'EECCC',  'Como "G" pero bajando la mano (pulgar e indice hacia abajo).', True),
    ('R', 'CEECC',  'Indice y medio CRUZADOS (uno sobre el otro); resto cerrado.', False),
    ('S', 'CCCCC',  'Puno compacto; el pulgar va sobre los dedos, NO al costado.', False),
    ('T', 'CCCCC',  'Puno con el pulgar asomando ENTRE el indice y el medio.',  False),
    ('U', 'CEECC',  'Indice y medio JUNTOS, apuntando hacia arriba.',           False),
    ('V', 'CEECC',  'Indice y medio SEPARADOS (V de victoria).',                False),
    ('W', 'CEEEC',  'Mano HACIA ARRIBA: indice, medio y anular extendidos hacia el cielo (W de tres dedos).', False),
    ('X', 'CECCC',  'Indice doblado como un GANCHO; resto cerrado.',            False),
    ('Y', 'ECCCE',  'Solo pulgar y menique extendidos ("call me").',            False),
    ('Z', 'EECCC',  'Indice EXTENDIDO dibujando una "Z" en el aire (como apuntar y trazar).', True),
]

# ── Numeros LSM evaluados por el modelo ML entrenado ──────────────────
# (numero, None, hint, con_movimiento)  —  tpl None => se evalua con ML
NUMBER_HINTS = {
    '1':  'Indice extendido hacia arriba; resto del puno cerrado. MANTEN LA MANO QUIETA.',
    '2':  'Indice y medio extendidos en V. Mano quieta.',
    '3':  'Pulgar, indice y medio extendidos. Mano quieta.',
    '4':  'Cuatro dedos extendidos, pulgar cerrado. Mano quieta.',
    '5':  'Mano abierta, los cinco dedos extendidos. Mano quieta.',
    '6':  'Menique toca el pulgar; resto extendido. Mano quieta.',
    '7':  'Anular toca el pulgar; resto extendido. Mano quieta.',
    '8':  'Medio toca el pulgar; resto extendido. Mano quieta.',
    '9':  'Indice toca el pulgar; resto extendido. Mano quieta.',
    '10': 'Mueve la mano de lado a lado mientras haces el "10" (pulgar e indice extendidos).',
    '11': 'Indice extendido, mueve la mano arriba y abajo repetidamente.',
    '12': 'Indice y medio extendidos, mueve la mano arriba y abajo.',
    '13': 'Tres dedos extendidos (pulgar, indice, medio), mueve la mano.',
    '14': 'Cuatro dedos extendidos, mueve la mano arriba y abajo.',
    '16': 'Menique toca pulgar, mueve la mano de lado a lado.',
    '17': 'Anular toca pulgar, mueve la mano de lado a lado.',
    '18': 'Medio toca pulgar, mueve la mano de lado a lado.',
    '19': 'Indice toca pulgar, mueve la mano de lado a lado.',
    '20': 'Pulgar e indice formando circulo, mueve la mano en pequenos circulos.',
}
ML_THRESHOLD = 0.65   # umbral para senas ML (numeros, balanceado para evitar confusiones)

_FINGER_ORDER = ('thumb', 'index', 'middle', 'ring', 'pinky')


# ======================================================================
#  ML — modelos entrenados (numeros 1-20). Carga perezosa para no
#  penalizar a los modulos que solo importan las reglas geometricas.
# ======================================================================

_ML = {'ready': False, 'tried': False, 'static': None, 'dynamic': None,
       'static_classes': [], 'dynamic_classes': []}


def _ml_init() -> bool:
    """Carga los modelos Keras una sola vez. True si hay al menos uno."""
    if _ML['tried']:
        return _ML['ready']
    _ML['tried'] = True
    try:
        os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
        import tensorflow as tf
        mdir = _ROOT / 'models'
        sp = mdir / 'lsm_static_classifier.keras'
        dp = mdir / 'lsm_dynamic_classifier_lstm.keras'
        if sp.exists():
            _ML['static'] = tf.keras.models.load_model(sp)
            _ML['static_classes'] = json.loads(
                (mdir / 'lsm_static_classes.json').read_text())['classes']
        if dp.exists():
            _ML['dynamic'] = tf.keras.models.load_model(dp)
            _ML['dynamic_classes'] = json.loads(
                (mdir / 'lsm_dynamic_classes.json').read_text())['classes']
        _ML['ready'] = _ML['static'] is not None or _ML['dynamic'] is not None
        if _ML['ready']:
            print(f"  [ML] modelos cargados: "
                  f"{len(_ML['static_classes'])} estaticas, "
                  f"{len(_ML['dynamic_classes'])} dinamicas")
    except Exception as e:
        print(f"  [WARN] ML no disponible: {e}")
        _ML['ready'] = False
    return _ML['ready']


def _lms_to_np(lms):
    """Convierte landmarks de MediaPipe a np.array (21, 3) o None."""
    if not lms or len(lms) < 21:
        return None
    return np.array([[p.x, p.y, p.z] for p in lms[:21]], dtype=np.float32)


def _ml_static_probs(arr):
    from lsm_features import extract_single_frame_features
    x = extract_single_frame_features(arr).reshape(1, -1).astype(np.float32)
    return _ML['static'](x, training=False).numpy()[0]


def _ml_dynamic_probs(seq):
    from lsm_features import extract_sequence_features
    x = extract_sequence_features(seq, target_frames=30).reshape(1, -1).astype(np.float32)
    return _ML['dynamic'](x, training=False).numpy()[0]


# Numeros estaticos con plantilla geometrica fiable (motor de reglas,
# misma calidad que las letras). 6-9 usan pulgar tocando dedos -> ML.
GEO_NUMBER_TEMPLATES = {
    '1': 'CECCC',   # solo indice
    '2': 'CEECC',   # indice + medio
    '3': 'EEECC',   # pulgar + indice + medio
    '4': 'CEEEE',   # cuatro dedos, pulgar recogido
    '5': 'EEEEE',   # mano abierta
}


def build_curriculum():
    """Alfabeto (reglas) + numeros.

    Numeros 1-5: motor geometrico (fiable, como las letras).
    Numeros 6-9: ML estatico (pulgar toca dedos, dificil por reglas).
    Numeros 10-20: ML dinamico (con movimiento).
    """
    cur = list(LSM_ALPHABET)
    # 1-5 por reglas geometricas (siempre disponibles, no dependen del ML)
    for n, tpl in GEO_NUMBER_TEMPLATES.items():
        cur.append((n, tpl, NUMBER_HINTS.get(n, f'Numero {n} en LSM.'), False))
    if _ml_init():
        # 6-9 estaticos por ML (pulgar tocando dedos)
        for n in ['6', '7', '8', '9']:
            if n in _ML['static_classes']:
                cur.append((n, None, NUMBER_HINTS.get(n, f'Numero {n} en LSM.'), False))
        # 10-20 dinamicos por ML
        for n in [str(i) for i in range(10, 21)]:
            if n in _ML['dynamic_classes']:
                cur.append((n, None,
                            NUMBER_HINTS.get(n, f'Numero {n}: sena CON MOVIMIENTO (mira el GIF).'),
                            True))
    return cur


# ── Motor de deteccion: angulos articulares 3-D (invariantes a rotacion) ──
# Landmarks MediaPipe Hand: 0=WRIST 4=THUMB_TIP 8=INDEX_TIP 12=MIDDLE_TIP
#   16=RING_TIP 20=PINKY_TIP  5,9,13,17=MCPs  6,10,14,18=PIPs

def _d(lms, a, b):
    """Distancia 2-D (compatibilidad con codigo de dibujo legado)."""
    return float(np.hypot(lms[a].x - lms[b].x, lms[a].y - lms[b].y))


def _v3(lms, a, b):
    """Vector 3-D de landmark a → b."""
    return np.array([lms[b].x - lms[a].x,
                     lms[b].y - lms[a].y,
                     lms[b].z - lms[a].z], dtype=np.float64)


def _ang3(lms, a, b, c):
    """Angulo en grados en el vertice b  entre los segmentos a→b y c→b,
    calculado con coordenadas 3-D completas incluyendo profundidad z."""
    u = _v3(lms, b, a)
    v = _v3(lms, b, c)
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-9 or nv < 1e-9:
        return 180.0
    return float(math.degrees(
        math.acos(max(-1.0, min(1.0, np.dot(u, v) / (nu * nv))))))


# Angulo compuesto MCP → PIP ← TIP por dedo.
# Captura tanto el pliegue PIP como DIP en un solo valor:
#   ≥ 160° = dedo practicamente recto  (extendido)
#   130–160° = semidoblado
#   < 115°   = bien cerrado            (puno)
_BEND = {
    'index' : (5,  6,  8),
    'middle': (9,  10, 12),
    'ring'  : (13, 14, 16),
    'pinky' : (17, 18, 20),
}
_THUMB_BEND = (2, 3, 4)   # MCP → IP ← TIP

EXT_THR  = 155   # >= este angulo = extendido
FIST_THR =  110  # <= este angulo = puno compacto (todos los no-pulgares)


def finger_states(lms):
    if not lms or len(lms) < 21:
        return None

    # ── 1. Angulos articulares 3-D (invariantes a rotacion) ─────────────
    ang = {name: _ang3(lms, *joints) for name, joints in _BEND.items()}
    ang['thumb'] = _ang3(lms, *_THUMB_BEND)

    # ── 2. Extension binaria usando los angulos ──────────────────────────
    ext = {name: ang[name] >= EXT_THR for name in _BEND}

    # ── 3. Pulgar: extension, lateralidad y contacto ────────────────────
    # Escala de la palma (2-D, para normalizar distancias de contacto)
    ax2, ay2 = lms[9].x - lms[0].x, lms[9].y - lms[0].y
    palm2d = math.hypot(ax2, ay2) or 1e-9
    lx, ly = -ay2 / palm2d, ax2 / palm2d     # vector lateral perpendicular

    tx, ty = lms[4].x - lms[0].x, lms[4].y - lms[0].y
    thumb_lat = abs(tx * lx + ty * ly) / palm2d
    thumb_out = thumb_lat > 0.42

    # Pulgar extendido si la articulacion IP esta recta O sale lateral
    ext['thumb'] = (ang['thumb'] >= EXT_THR) or thumb_out

    # Contacto pulgar con yema de otro dedo (distancia 3-D normalizada)
    d3_norm = float(np.linalg.norm(_v3(lms, 0, 9))) or palm2d
    thumb_touch_index  = float(np.linalg.norm(_v3(lms, 4,  8))) < d3_norm * 0.30
    thumb_touch_middle = float(np.linalg.norm(_v3(lms, 4, 12))) < d3_norm * 0.30

    # Si el pulgar toca la yema de otro dedo, por definicion no esta extendido
    if thumb_touch_index or thumb_touch_middle:
        ext['thumb'] = False
        thumb_out    = False

    # ── 4. Separacion indice / medio (distancia 3-D) ─────────────────────
    im_gap = float(np.linalg.norm(_v3(lms, 8, 12))) / palm2d
    uv_touching = im_gap < 0.14
    uv_close    = im_gap < 0.38
    uv_spread   = im_gap > 0.45     # V: dedos en "V" abiertos razonablemente

    # ── 5. Orientacion de la mano ────────────────────────────────────────
    # Componente vertical normalizada del eje palma (muneca→MCP medio).
    palm_vec = _v3(lms, 0, 9)
    palm_len = np.linalg.norm(palm_vec) or 1e-9
    palm_ori_y = float(palm_vec[1] / palm_len)   # y+ = hacia abajo (imagen)

    # Para K/P/V/U/H/etc. la direccion de los dedos extendidos domina al MCP:
    # el vector muneca→MCP puede sesgar "mano arriba" en poses horizontales.
    fi = np.array([
        (lms[8].x + lms[12].x) * 0.5 - lms[0].x,
        (lms[8].y + lms[12].y) * 0.5 - lms[0].y,
        (lms[8].z + lms[12].z) * 0.5 - lms[0].z,
    ], dtype=np.float64)
    flen = float(np.linalg.norm(fi)) or 1e-9
    finger_ori_y = float(fi[1] / flen)
    finger_ori_z = float(fi[2] / flen)

    if ext['index'] and ext['middle']:
        orientation_y = finger_ori_y
    else:
        orientation_y = palm_ori_y

    # Umbrales algo mas estrictos para no etiquetar "arriba/abajo" en diagonal suave.
    hand_up   = orientation_y < -0.46
    hand_down = orientation_y >  0.46
    # z mas negativo = hacia la camara (coords normalizadas MediaPipe Hand).
    # Umbral bajo porque el eje Z de MediaPipe Hands es ruidoso; K suele
    # producir finger_ori_z entre -0.15 y -0.45 segun la camara.
    hand_forward = finger_ori_z < -0.18

    # ── 6. Puno compacto vs mano abierta ─────────────────────────────────
    fist_tight = all(ang[k] < FIST_THR for k in _BEND)
    palm_flat  = all(ang[k] > (EXT_THR + 5) for k in _BEND)

    # ── 7. Pulgar entre indice y medio (K, T) ────────────────────────────
    palm_ax = palm_vec / palm_len     # eje axial normalizado
    t_vec_w = np.array([lms[4].x - lms[0].x,
                        lms[4].y - lms[0].y,
                        lms[4].z - lms[0].z])
    t_axial = float(np.dot(t_vec_w, palm_ax)) / palm_len
    thumb_between = (0.35 < t_axial < 0.92) and not thumb_out
    # K/P: ranura axial del pulgar (t_axial puede ser negativo segun orientacion).
    # Pulgar extendido excluye V (pulgar en puno). Sin pellizco en yemas.
    kp_thumb_slot = (
        ext['thumb']
        and ext['index']
        and ext['middle']
        and (-1.28 < t_axial < 0.96)
        and not thumb_touch_index
        and not thumb_touch_middle
    )
    # Pose tipo lamina P: indice claramente mas arriba que la muneca.
    # Se simplifica para ser robusta: solo necesita que el indice este
    # sobre la muneca (hand_up ya cubre el caso general; esta cubre
    # cuando el vector palma no detecta bien la orientacion).
    index_above_wrist = lms[8].y < (lms[0].y - 0.010)
    p_chart_pose = (
        ext['index'] and ext['middle'] and kp_thumb_slot
        and index_above_wrist
    )

    # ── 8. POSICION DEL PULGAR DENTRO DEL PUÑO  (clave para M/N/S/T/E) ──
    # Proyectamos el TIP del pulgar en el sistema de referencia anclado
    # al MCP del medio, con ejes axial (palm_ax) y lateral (palm_lat).
    mcp_mid = np.array([lms[9].x, lms[9].y, lms[9].z])
    tip_rel = np.array([lms[4].x, lms[4].y, lms[4].z]) - mcp_mid
    # Coordenada axial respecto al MCP medio (positiva = mas alla que
    # el MCP medio, apuntando hacia la punta de los dedos extendidos).
    thumb_axial = float(np.dot(tip_rel, palm_ax)) / palm_len

    # Coordenada lateral: pulgar a la izquierda (lado del pulgar) vs
    # derecha (lado del menique), en signo consistente con la mano.
    # palm_lat apunta del MCP del menique (17) al MCP del indice (5):
    palm_lat_raw = np.array([lms[5].x - lms[17].x,
                             lms[5].y - lms[17].y,
                             lms[5].z - lms[17].z])
    lat_len  = np.linalg.norm(palm_lat_raw) or 1e-9
    palm_lat = palm_lat_raw / lat_len
    thumb_lateral_pos = float(np.dot(tip_rel, palm_lat)) / palm_len
    # Valores tipicos (mano derecha, palma hacia camara):
    #   > +0.05  = tip del lado del INDICE  (S, T)
    #   ~  0    = tip en zona del MEDIO    (N)
    #   < -0.05  = tip del lado del ANULAR/MEÑIQUE (M)

    # Variante permisiva para P: el pulgar queda ENTRE indice y medio,
    # no necesariamente totalmente extendido. Se detecta por posicion
    # lateral: el TIP del pulgar debe estar del lado del INDICE (no del
    # menique), lo cual lo separa de V/U donde el pulgar va a la palma.
    # thumb_lateral_pos > 0.0 = tip del lado indice (K/P)
    # thumb_lateral_pos <= 0  = tip del lado menique/palma (V/U/R)
    p_thumb_slot = (
        ext['index']
        and ext['middle']
        and not thumb_out
        and not thumb_touch_index
        and not thumb_touch_middle
        and not fist_tight
        and thumb_lateral_pos > 0.0
    )

    # ── 8b. Orientacion de la palma respecto a la camara ────────────────
    # El normal de la palma se calcula por producto cruz de los vectores
    # wrist->indice_MCP y wrist->menique_MCP. Si la palma o el dorso
    # miran a la camara, el componente Z del normal sera grande (en
    # magnitud). Si la mano esta de costado, |nz| sera pequeno.
    v1 = _v3(lms, 0, 5)
    v2 = _v3(lms, 0, 17)
    normal = np.cross(v1, v2)
    nlen = np.linalg.norm(normal) or 1e-9
    palm_normal_z = float(normal[2] / nlen)
    palm_facing_camera = abs(palm_normal_z) > 0.45

    # Posicion categorica dentro del puño.
    # Aplica SOLO cuando: (a) el puno esta bien cerrado y (b) la palma
    # o el dorso miran a la camara (si la mano esta de costado, la
    # prediccion del pulgar oculto es muy ruidosa y NO la usamos).
    thumb_in_fist = fist_tight and not thumb_out and palm_facing_camera
    # Rangos de thumb_axial (proyeccion del tip del pulgar sobre el eje
    # axial de la palma, normalizada por palm_len). Valores tipicos:
    #   T  : tip pop-up entre indice y medio   -> axial > +0.30
    #   S/E: tip al nivel de los nudillos      -> axial 0.00..+0.30
    #   M/N: tip METIDO por debajo (asomando)  -> axial < -0.05
    thumb_over_top    = thumb_in_fist and thumb_axial > +0.30
    thumb_below_mcps  = thumb_in_fist and thumb_axial < -0.05
    thumb_at_level    = thumb_in_fist and (-0.05 <= thumb_axial <= +0.30)
    thumb_side_index  = thumb_in_fist and thumb_lateral_pos > +0.10
    thumb_side_middle = thumb_in_fist and -0.10 <= thumb_lateral_pos <= +0.10
    thumb_side_pinky  = thumb_in_fist and thumb_lateral_pos < -0.10

    return {
        # Basicos
        'thumb' : ext['thumb'],
        'index' : ext['index'],
        'middle': ext['middle'],
        'ring'  : ext['ring'],
        'pinky' : ext['pinky'],
        # Pulgar general
        'thumb_out'          : thumb_out,
        'thumb_between'      : thumb_between,
        'kp_thumb_slot'      : kp_thumb_slot,
        'p_thumb_slot'       : p_thumb_slot,
        'thumb_touch_index'  : thumb_touch_index,
        'thumb_touch_middle' : thumb_touch_middle,
        # Pulgar DENTRO del puño (M/N/Ñ/S/T/E/A)
        'thumb_in_fist'    : thumb_in_fist,
        'thumb_over_top'   : thumb_over_top,     # T
        'thumb_below_mcps' : thumb_below_mcps,   # M, N
        'thumb_at_level'   : thumb_at_level,     # S, E
        'thumb_side_index' : thumb_side_index,   # S, T
        'thumb_side_middle': thumb_side_middle,  # N
        'thumb_side_pinky' : thumb_side_pinky,   # M
        'thumb_axial'      : thumb_axial,        # valor crudo
        'thumb_lateral_pos': thumb_lateral_pos,  # valor crudo
        'palm_facing_camera': palm_facing_camera,
        'palm_normal_z'    : palm_normal_z,
        # Indice / medio
        'uv_touching': uv_touching,
        'uv_close'   : uv_close,
        'uv_spread'  : uv_spread,
        'im_gap'     : im_gap,
        # Orientacion
        'palm_ori_y'   : palm_ori_y,
        'finger_ori_y' : finger_ori_y,
        'finger_ori_z' : finger_ori_z,
        'orientation_y': orientation_y,
        'hand_up'  : hand_up,
        'hand_down': hand_down,
        'hand_forward': hand_forward,
        'p_chart_pose': p_chart_pose,
        # Forma global
        'fist_tight': fist_tight,
        'palm_flat' : palm_flat,
        'ang'       : ang,
    }


# ======================================================================
#  Bonificadores / penalizadores especificos por letra
#  -----------------------------------------------------
#  Reciben el dict de finger_states() y devuelven un delta que se suma
#  al score base. Positivo = confirma la seña; negativo = la descarta.
#  El score final puede superar 1.0 internamente para que los deltas
#  puedan desempatar letras con el mismo molde base; el display lo capa
#  a 100 %.
# ======================================================================

def _extra_A(s):
    # A = puno con PULGAR LATERAL. Si no sale lateral no es A.
    d  = +0.12 if s['thumb_out']  else -0.10
    d += +0.06 if s['fist_tight'] else -0.08
    return d

def _extra_L(s):
    # L = pulgar lateral + indice apuntando arriba (vertical).
    d  = +0.12 if s['thumb_out'] else -0.25
    d += +0.06 if s['hand_up']   else -0.08
    return d

def _extra_Y(s):
    # Y = pulgar lateral + menique extendido, indice/medio/anular cerrados.
    if not s.get('thumb_out', False):  return -0.22
    if not s['pinky']:                 return -0.20  # menique DEBE estar extendido
    score = +0.18
    if s['index']:   score -= 0.18
    if s['middle']:  score -= 0.18
    if s['ring']:    score -= 0.15
    return score

def _extra_G(s):
    # G = pulgar + indice apuntando al costado (horizontal).
    # Si hay dos dedos juntos y extendidos -> es H, no G.
    if s['uv_close'] and s['middle']:
        return -0.30
    return -0.18 if s['hand_up'] else +0.06

def _extra_Q(s):
    # Q = como G pero la mano apunta hacia abajo.
    if s['uv_close'] and s['middle']:
        return -0.25
    return +0.10 if s['hand_down'] else -0.12

def _extra_C(s):
    # C = mano en "C": todos los dedos semi-doblados (angulo 110-155°).
    # Zona media: ni puno compacto ni mano completamente plana.
    # Si algun dedo esta totalmente recto (ext=True) -> es B/W/L/etc., no C.
    # Si es puno compacto (fist_tight) -> es S/E/M/N/T, no C.
    any_ext = s['index'] or s['middle'] or s['ring'] or s['pinky']
    if any_ext or s['fist_tight']:
        return -0.40
    return +0.50    # todos en zona intermedia -> C ✓


def _extra_B(s):
    # B = 4 dedos completamente rectos hacia arriba; pulgar cruzado.
    return +0.10 if s['palm_flat'] else -0.02

def _extra_O(s):
    # O = circulo formado por pulgar + todos los dedos; pellizco visible.
    score = 0.0
    # Distancia pulgar-indice como gradiente (no binario)
    if s['thumb_touch_index']:
        score += 0.25  # pellizco perfecto
    else:
        # Credito parcial si el pulgar esta curvado/cerca
        if s.get('thumb_between', False) or s.get('thumb_touch_middle', False):
            score += 0.10
        else:
            score -= 0.20  # pulgar completamente afuera
    # Dedos deben estar cerrados (curvados)
    if s['index']:   score -= 0.18  # indice recto -> no es O
    if s['middle']:  score -= 0.10
    if s['ring']:    score -= 0.08
    if s['pinky']:   score -= 0.08
    if s.get('thumb_out', False): score -= 0.30  # pulgar lateral -> no O
    return score

def _extra_F(s):
    # F = circulo pulgar-indice; medio, anular y menique extendidos.
    return +0.18 if s['thumb_touch_index'] else -0.12

def _extra_D(s):
    # D = solo indice arriba; pulgar toca la yema del medio.
    d  = +0.12 if s['thumb_touch_middle'] else -0.06
    d += +0.05 if s['hand_up']             else  0.0
    return d

# ── H / U / V / R  (indice + medio extendidos, resto cerrado) ─────────
def _extra_H(s):
    # H = indice + medio JUNTOS, mano tipicamente horizontal.
    # Ring extendido -> es W. Dedos abiertos -> es V.
    # Hand DOWN -> es N (variante regional), no H.
    if s['ring']:           return -0.28
    if s['uv_spread']:      return -0.22
    if s['hand_down']:      return -0.20      # eso es N variante B
    d  = +0.18 if s['uv_close'] else +0.05
    d += -0.06 if s['hand_up']  else +0.04
    return d

def _extra_U(s):
    # U = indice + medio JUNTOS apuntando HACIA ARRIBA.
    # Si va hacia abajo, eso es N en LSM.
    if s['uv_spread']:       return -0.18
    if s['hand_down']:       return -0.20      # N invertida, no U
    d  = +0.10 if s['uv_close'] and not s['uv_touching'] else -0.08
    d += +0.06 if s['hand_up'] else -0.02
    return d

def _extra_V(s):
    # V = indice + medio bien SEPARADOS, pulgar NO entre los dedos
    # (debe estar cerrado/cruzado sobre la palma, no del lado del indice).
    if s['hand_down']:       return -0.15
    # Si el pulgar esta del lado del indice -> es P/K, no V
    if s.get('p_thumb_slot'):  return -0.30
    return +0.14 if s['uv_spread'] else -0.18

def _extra_R(s):
    # R = indice y medio cruzados (tips casi superpuestos), hacia arriba.
    if s['hand_down']:       return -0.15
    return +0.15 if s['uv_touching'] else -0.15

def _extra_W(s):
    # W = indice, medio y anular extendidos HACIA ARRIBA. Si va hacia
    # abajo, es M en LSM. Pinky cerrado (ya forzado por el template).
    if s['hand_down']:       return -0.25       # M invertida, no W
    d  = +0.12 if s['hand_up'] else -0.10
    return d

def _extra_X(s):
    # X = indice doblado como gancho (CECCC). Si el indice esta extendido -> es Z/G.
    if s['index']:   return -0.50   # indice recto -> definitivamente no es X
    score = +0.22  # mas peso positivo cuando indice bien doblado
    if not s['middle']:  score += 0.06
    if not s['ring']:    score += 0.06
    if not s['pinky']:   score += 0.06
    if not s['thumb']:   score += 0.04
    # Si el puno esta MUY apretado, el indice esta cerrado (no gancho)
    if s.get('fist_tight', False):  score -= 0.15
    return score

def _extra_Z(s):
    # Z = indice EXTENDIDO apuntando, trazando la Z con movimiento.
    # Pulgar cerrado (no lateral). Solo el indice sale.
    # Comparte EECCC con G, L, Q -> discriminar por pulgar y orientacion.
    if not s['index']:      return -0.35  # indice cerrado -> X, no Z
    if s['middle']:         return -0.20  # medio extendido -> G/H/etc.
    if s['thumb_out']:      return -0.28  # pulgar lateral -> G o L
    if s['hand_down']:      return -0.20  # mano abajo -> Q
    return +0.14

# ── K y P  (indice + medio + pulgar extendidos, anular + menique cerrados)
def _extra_K(s):
    # K = indice y medio en "V", pulgar extendido ENTRE ellos (kp_thumb_slot
    # estricto), mano NO apuntando claramente arriba (eso es P).
    if s['thumb_touch_middle'] or s['thumb_touch_index']:
        return -0.38
    if s['uv_close']:   return -0.35
    if not s.get('kp_thumb_slot'):
        return -0.50
    if s['hand_up']:
        d = -0.28   # mano arriba -> P, no K
    elif s['hand_down']:
        d = -0.24
    else:
        d = +0.30   # diagonal / horizontal / enfrente: K
    d += +0.06 if s['uv_spread'] else 0.0
    return d

def _extra_P(s):
    # P = indice ARRIBA, pulgar metido entre indice y medio (p_thumb_slot),
    # mano orientada hacia arriba. El pulgar puede no estar totalmente recto.
    if s['thumb_touch_middle'] or s['thumb_touch_index']:
        return -0.38
    if s['uv_close']:   return -0.30
    if s['thumb_out']:  return -0.28
    if not s.get('p_thumb_slot'):
        return -0.50
    # Orientacion: P requiere mano arriba
    if s['hand_down']:
        return -0.30
    up_like = s['hand_up'] or s.get('p_chart_pose', False)
    if up_like:
        d = +0.34
    elif s['hand_forward'] and not s['hand_up']:
        d = -0.14   # enfrente puro -> K
    else:
        d = +0.10   # diagonal: P acepta
    d += +0.06 if s['uv_spread'] else 0.0
    return d

# ── Puno compacto: M / N / S / T / E / Ñ ─────────────────────────────
# Todas tienen molde CCCCC (puno cerrado). Se diferencian por la posicion
# del tip del pulgar dentro del puno:
#   T  -> pulgar asoma por ARRIBA de los MCPs
#   S  -> pulgar sobre los nudillos, del lado del indice
#   M  -> pulgar metido BAJO 3 dedos, tip cerca del menique
#   N  -> pulgar metido BAJO 2 dedos, tip en zona del medio
#   E  -> pulgar por dentro, yemas en la palma (como S pero mas compacto)
#   Ñ  -> como N pero con movimiento ondulante

def _base_fist_ok(s):
    """Factor comun: descarta si el pulgar sale lateral o el puno no
    esta realmente cerrado."""
    d = 0.0
    d += -0.28 if s['thumb_out']  else +0.04
    d += +0.10 if s['fist_tight'] else -0.22
    return d

def _extra_S(s):
    # S: puno con pulgar SOBRE los nudillos, lado indice/medio.
    # NO debe asomar bajo los dedos (eso seria M/N) ni por arriba (T).
    d = _base_fist_ok(s)
    if not s['fist_tight']:
        return d - 0.30
    # Si la palma no mira a la camara, usar senal alternativa
    if not s.get('palm_facing_camera', True):
        if s.get('thumb_lateral_pos', 0) > 0.08:
            return d + 0.08
        return d + 0.02  # sin info confiable
    if s['thumb_below_mcps']:
        return d - 0.35    # tip por debajo -> M/N, no S
    if s['thumb_over_top']:
        return d - 0.18    # tip arriba -> T, no S
    if s['thumb_side_index']:
        return d + 0.14    # S perfecto
    if s.get('thumb_at_level', False):
        return d + 0.08    # S aceptable
    return d + 0.04

def _extra_T(s):
    # T: tip del pulgar asoma ARRIBA del puno, entre indice y medio.
    d = _base_fist_ok(s)
    if not s['fist_tight']:
        return d - 0.30
    if s['thumb_over_top']:
        return d + 0.18
    return d - 0.30        # T sin tip asomando arriba NO es T

def _score_M_variantA(s):
    """M variante guia oficial: puño con pulgar dentro, asomando bajo
    tres dedos del lado del menique."""
    if s['thumb_out']:           return -0.30
    if not s['fist_tight']:      return -0.30
    if not s.get('palm_facing_camera', True):
        return +0.04             # mano de costado -> no penalizamos pero no premiamos fuerte
    if not s['thumb_below_mcps']:return -0.10
    return +0.18 if s['thumb_side_pinky'] else +0.06

def _score_M_variantB(s):
    """M variante regional: mano HACIA ABAJO con tres dedos extendidos
    (indice + medio + anular). Pinky cerrado."""
    if s['thumb_out']:                                     return -0.25
    if not (s['index'] and s['middle'] and s['ring']):     return -0.20
    if s['pinky']:                                          return -0.10
    if s['hand_up']:                                        return -0.18  # eso es W
    return +0.30 if s['hand_down'] else +0.04

def _extra_M(s):
    # Devuelve el mejor score entre las dos variantes aceptadas.
    return max(_score_M_variantA(s), _score_M_variantB(s))


def _score_N_variantA(s):
    """N variante guia oficial: puño con pulgar dentro, asomando bajo
    dos dedos en zona central."""
    if s['thumb_out']:           return -0.30
    if not s['fist_tight']:      return -0.30
    if not s.get('palm_facing_camera', True):
        return +0.04
    if not s['thumb_below_mcps']:return -0.10
    # Más permisivo: acepta thumb_side_middle O thumb_at_level
    if s['thumb_side_middle']:   return +0.22
    if s.get('thumb_at_level', False):  return +0.12
    return +0.06

def _score_N_variantB(s):
    """N variante regional: mano HACIA ABAJO con indice y medio
    extendidos juntos. Anular y menique cerrados."""
    if s['thumb_out']:                          return -0.25
    if s['uv_spread']:                          return -0.22
    if not (s['index'] and s['middle']):        return -0.20
    if s['ring'] or s['pinky']:                 return -0.12
    if s['hand_up']:                             return -0.22  # eso es U/V, no N
    # Discriminar de H: H va horizontal, N va hacia abajo
    if not s.get('hand_down', False) and not s.get('hand_up', False):
        return +0.00  # diagonal neutral
    return +0.32 if s.get('hand_down', False) else +0.04

def _extra_I(s):
    # I = solo menique extendido, resto cerrado.
    if not s['pinky']:   return -0.40  # menique DEBE estar extendido
    score = +0.30  # bonus fuerte cuando menique bien extendido
    if s['index']:       score -= 0.20
    if s['middle']:      score -= 0.20
    if s['ring']:        score -= 0.20
    if s['thumb']:       score -= 0.12
    if s.get('thumb_out', False):  score -= 0.20  # I no tiene pulgar lateral
    return score


def _extra_N(s):
    return max(_score_N_variantA(s), _score_N_variantB(s))

def _extra_enye(s):
    # Ñ: misma forma que N pero requiere movimiento ondulante.
    # Si no hay movimiento, penalizamos para que se detecte N en su lugar.
    base = _extra_N(s)
    # Sin info de movimiento (se agrega en recognize), aceptamos con penalty
    return base - 0.10

def _extra_E(s):
    # E: puno con yemas tocando la palma; pulgar al frente, NO asomando
    # bajo los dedos ni claramente arriba.
    d = _base_fist_ok(s)
    if not s['fist_tight']:
        return d - 0.30
    if s['thumb_below_mcps']:
        return d - 0.20    # eso es M/N
    if s['thumb_over_top']:
        return d - 0.18    # eso es T
    return d + 0.08        # neutral: E o S

# ── Numeros estaticos por reglas geometricas (1-5) ───────────────────
# Mapean limpiamente a estados de dedos, igual que las letras. Los
# numeros 6-9 (pulgar tocando dedos) y 10-20 (con movimiento) usan ML.

def _extra_n1(s):
    # 1 = solo indice extendido hacia arriba; resto en puno.
    if not s['index']:   return -0.50
    d = +0.20
    if s['middle']:  d -= 0.18
    if s['ring']:    d -= 0.15
    if s['pinky']:   d -= 0.15
    if s.get('thumb_out', False):  d -= 0.10
    return d

def _extra_n2(s):
    # 2 = indice + medio extendidos (V); resto cerrado.
    if not (s['index'] and s['middle']):  return -0.45
    d = +0.18
    if s['ring']:    d -= 0.18
    if s['pinky']:   d -= 0.18
    if s.get('thumb_out', False):  d -= 0.06
    return d

def _extra_n3(s):
    # 3 = pulgar + indice + medio extendidos; anular y menique cerrados.
    if not (s['index'] and s['middle']):  return -0.45
    d = +0.16
    if not s['thumb']:   d -= 0.10   # el 3 incluye el pulgar
    if s['ring']:        d -= 0.18
    if s['pinky']:       d -= 0.18
    return d

def _extra_n4(s):
    # 4 = cuatro dedos extendidos, pulgar recogido.
    if not (s['index'] and s['middle'] and s['ring'] and s['pinky']):
        return -0.45
    d = +0.20
    if s.get('thumb_out', False):  d -= 0.08   # pulgar debe ir recogido
    return d

def _extra_n5(s):
    # 5 = mano abierta, los cinco dedos extendidos.
    cnt = sum(1 for k in ('index', 'middle', 'ring', 'pinky') if s[k])
    d = 0.05 * cnt - 0.15
    if s.get('thumb_out', False):  d += 0.12   # pulgar tambien afuera
    if cnt < 4:  d -= 0.20
    return d


LETTER_EXTRA = {
    '1': _extra_n1,
    '2': _extra_n2,
    '3': _extra_n3,
    '4': _extra_n4,
    '5': _extra_n5,
    'A': _extra_A,
    'B': _extra_B,
    'C': _extra_C,
    'D': _extra_D,
    'E': _extra_E,
    'F': _extra_F,
    'G': _extra_G,
    'H': _extra_H,
    'I': _extra_I,
    'K': _extra_K,
    'L': _extra_L,
    'M': _extra_M,
    'N': _extra_N,
    'Ñ': _extra_enye,
    'O': _extra_O,
    'P': _extra_P,
    'Q': _extra_Q,
    'R': _extra_R,
    'S': _extra_S,
    'T': _extra_T,
    'U': _extra_U,
    'V': _extra_V,
    'W': _extra_W,
    'X': _extra_X,
    'Y': _extra_Y,
    'Z': _extra_Z,
}


def coaching_hint(target, states):
    """Devuelve un texto corto indicando al usuario que corregir.
    Usa los features del nuevo motor 3-D (angulos articulares)."""
    if states is None or not target:
        return ""
    ang = states.get('ang', {})

    # ── Puno: S T E A (M/N/Ñ ya no son puños en LSM) ────────────────
    if target in {'S', 'T', 'E', 'A'}:
        if not states['fist_tight']:
            return "CIERRA BIEN EL PUNO"
    if target in {'A', 'L', 'Y'} and not states['thumb_out']:
        return "SACA EL PULGAR AL COSTADO"
    if target in {'S', 'T', 'E'} and states['thumb_out']:
        return "METE EL PULGAR DENTRO"

    # ── M / N / Ñ: dos variantes aceptadas ──────────────────────────────
    # variante A (guia): puño con dedos doblados sobre el pulgar
    # variante B (regional): mano hacia abajo con dedos extendidos
    # Detectamos cual esta intentando el usuario y le damos el hint
    # adecuado para esa variante.
    if target in {'M', 'N', 'Ñ'}:
        is_doing_A = states['fist_tight']
        is_doing_B = states['hand_down'] and (
            states['index'] or states['middle'])
        if is_doing_A and not is_doing_B:
            # variante puño
            if states['thumb_out']:
                return "METE EL PULGAR DENTRO DEL PUNO"
            if not states.get('palm_facing_camera', True):
                return "GIRA LA MANO DE FRENTE A LA CAMARA"
            if not states['thumb_below_mcps']:
                return "DOBLA LOS DEDOS SOBRE EL PULGAR"
            if target == 'M' and not states['thumb_side_pinky']:
                return "PULGAR HACIA EL MENIQUE (3 dedos sobre el)"
            if target in {'N', 'Ñ'} and not states['thumb_side_middle']:
                return "PULGAR AL CENTRO (2 dedos sobre el)"
        elif is_doing_B:
            # variante mano hacia abajo
            if target == 'M':
                if not (states['index'] and states['middle'] and states['ring']):
                    return "EXTIENDE INDICE, MEDIO Y ANULAR HACIA ABAJO"
                if states['pinky']:
                    return "DOBLA EL MENIQUE"
            else:
                if not (states['index'] and states['middle']):
                    return "EXTIENDE INDICE Y MEDIO HACIA ABAJO"
                if states['ring'] or states['pinky']:
                    return "DOBLA ANULAR Y MENIQUE"
                if states['uv_spread']:
                    return "JUNTA INDICE Y MEDIO"
        else:
            # ninguna variante reconocida
            return "PUNO con pulgar dentro, O mano hacia abajo con dedos"

    # ── Posicion del pulgar dentro del puño (S / T / E) ─────────────────
    # Las heuristicas axial/lateral del pulgar requieren palma/dorso de
    # frente a la camara; si la mano esta de costado, recordarselo.
    if target in {'S', 'T', 'E'} and states['fist_tight']:
        if not states.get('palm_facing_camera', True):
            return "GIRA LA MANO DE FRENTE A LA CAMARA"
    if target == 'T' and states['fist_tight'] and not states['thumb_over_top']:
        return "ASOMA EL PULGAR ARRIBA, ENTRE INDICE Y MEDIO"
    if target == 'S' and states['fist_tight'] and states['thumb_below_mcps']:
        return "PULGAR SOBRE LOS NUDILLOS, NO ABAJO"
    if target == 'E' and states['fist_tight'] and states['thumb_below_mcps']:
        return "PULGAR AL FRENTE, NO METIDO ABAJO"

    # ── Pellizcos ────────────────────────────────────────────────────
    if target in {'O', 'F'} and not states['thumb_touch_index']:
        return "UNE PULGAR E INDICE"
    if target == 'D' and not states['thumb_touch_middle']:
        return "PULGAR A LA YEMA DEL MEDIO"

    # ── Separacion indice/medio ──────────────────────────────────────
    if target in {'H', 'U'} and states['uv_spread']:
        return "JUNTA INDICE Y MEDIO"
    if target in {'V'} and not states['uv_spread']:
        return "SEPARA INDICE Y MEDIO EN V"
    if target in {'K', 'P'} and states['uv_close']:
        return "SEPARA INDICE Y MEDIO"
    if target == 'R' and not states['uv_touching']:
        return "CRUZA INDICE SOBRE MEDIO"

    # ── Pulgar entre dedos ───────────────────────────────────────────
    if target == 'K' and not states.get('kp_thumb_slot'):
        return "PULGAR ENTRE INDICE Y MEDIO"
    if target == 'P' and not states.get('p_thumb_slot'):
        return "PULGAR ENTRE INDICE Y MEDIO (SIN SACAR AL COSTADO)"

    # ── Orientacion ──────────────────────────────────────────────────
    if target in {'L', 'U', 'V', 'W'} and not states['hand_up']:
        return "MANO HACIA ARRIBA"
    if target == 'P':
        if not (states['hand_up'] or states.get('p_chart_pose')):
            return "INDICE ARRIBA Y MEDIO HACIA ENFRENTE (MANO ARRIBA)"
    if target == 'K':
        if states['hand_up']:
            return "BAJA LA MANO: LA K NO VA HACIA ARRIBA (ESA ES LA P)"
    if target in {'G', 'H'} and states['hand_up']:
        return "MANO HORIZONTAL"

    # ── Z / X ────────────────────────────────────────────────────────
    if target == 'Z' and not states['index']:
        return "EXTIENDE EL INDICE (Z se traza con el indice apuntando)"
    if target == 'Z' and states['thumb_out']:
        return "CIERRA EL PULGAR (solo el indice apunta)"
    if target == 'X' and states['index']:
        return "DOBLA EL INDICE EN GANCHO"

    # ── Dedos especificos (usando angulo 3-D crudo) ──────────────────
    if target == 'B' and not states['palm_flat']:
        return "DEDOS COMPLETAMENTE RECTOS"
    if target in {'B', 'C', 'W'}:
        bent = [f for f in ('index','middle','ring','pinky')
                if ang.get(f, 180) < (EXT_THR - 10)]
        if bent:
            return f"EXTIENDE: {', '.join(bent[:2]).upper()}"

    return ""


def score_letter(states, template, letter=None):
    """Score comparando estados detectados contra el molde, con
    bonificadores/descalificadores especificos por letra.

    El valor puede superar 1.0 internamente (para que los bonificadores
    puedan desempatar dos letras que comparten el mismo molde base);
    quien muestre la letra debe capar el display con `min(1.0, s)`.
    """
    if states is None or template is None or len(template) != 5:
        return 0.0
    ok = 0.0
    n_wild = 0
    for k, t in zip(_FINGER_ORDER, template):
        if t == '?':
            ok += 1.0           # wildcard: cuenta como acierto, la
            n_wild += 1         # diferenciacion la hace LETTER_EXTRA
            continue
        want = (t == 'E')
        if states[k] == want:
            ok += 1.0
    base = ok / 5.0
    # Castigo SUAVE por templates con muchos wildcards (sin LETTER_EXTRA
    # serian indistinguibles). Si la letra tiene LETTER_EXTRA, el bonus
    # diferenciador deberia compensar este castigo.
    if n_wild >= 4:
        base -= 0.25
    extra = LETTER_EXTRA.get(letter)
    if extra is not None:
        base = base + extra(states)
    return max(0.0, base)


def detect_best_letter(states, has_motion=False):
    """Busca la letra del alfabeto que mejor coincide con lo que
    muestran los dedos del usuario ahora.
    Si `has_motion` es True, las letras con movimiento reciben un
    pequeno bono sobre su version estatica (ej. Ñ vs N)."""
    if states is None:
        return None, 0.0
    best_s = 0.0
    best = None
    for letter, tpl, _, is_mov in LSM_ALPHABET:
        s = score_letter(states, tpl, letter=letter)
        if is_mov and has_motion:
            s += 0.05     # desempate a favor de la variante con movimiento
        elif is_mov and not has_motion:
            s -= 0.03     # leve castigo cuando no hay movimiento observado
        if s > best_s:
            best_s = s
            best = letter
    return best, best_s


# ── Detector de movimiento ondulante (para Ñ, J, Z) ───────────────────
class MotionTracker:
    """Observa la posicion de la muneca a lo largo del tiempo y detecta
    oscilaciones significativas. Usado para diferenciar N de Ñ, I de J,
    D de Z, X estatica de X con movimiento, etc."""
    def __init__(self, window_sec=1.2, min_amp=0.025):
        self._buf = deque(maxlen=64)
        self._window = window_sec
        self._min_amp = min_amp    # amplitud minima normalizada por palma

    def feed(self, lms, t):
        if not lms or len(lms) < 10:
            self._buf.append((t, None, None, None))
            return
        # Usamos la muneca (0) y escalamos por el tamano de la palma
        wx, wy = lms[0].x, lms[0].y
        palm = math.hypot(lms[9].x - lms[0].x, lms[9].y - lms[0].y) or 1e-6
        self._buf.append((t, wx, wy, palm))
        # Purgar entradas mas viejas que la ventana
        while self._buf and (t - self._buf[0][0]) > self._window:
            self._buf.popleft()

    def has_oscillation(self):
        pts = [b for b in self._buf if b[1] is not None]
        if len(pts) < 8:
            return False
        xs = [b[1] for b in pts]
        ys = [b[2] for b in pts]
        palm = pts[-1][3]
        amp = (max(xs) - min(xs) + max(ys) - min(ys)) / (palm * 2.0)
        if amp < self._min_amp:
            return False
        # Cuenta cambios de direccion en y para distinguir movimiento
        # ondulante (varios picos) de un simple empujon.
        dirs = 0
        prev = 0
        for i in range(1, len(ys)):
            d = ys[i] - ys[i-1]
            s = 1 if d > 0 else (-1 if d < 0 else 0)
            if s and s != prev and prev != 0:
                dirs += 1
            if s:
                prev = s
        return dirs >= 2


# ======================================================================
#  Chart de referencia del alfabeto (imagen oficial recortada por celdas)
# ======================================================================
def load_chart_tiles(path: str):
    """Devuelve (chart_completo, dict[letra]->tile) recortando la
    lamina del alfabeto. Las coordenadas estan calibradas para la
    imagen `assets/lsm_alphabet.png` (1024x662)."""
    if not os.path.exists(path):
        return None, {}
    chart = cv2.imread(path)
    if chart is None:
        return None, {}
    H, W = chart.shape[:2]

    # Parametros calibrados midiendo la lamina oficial 1024x662:
    # columnas empiezan en x=50 con ancho 94 px; altura de celda
    # conservadora (~152 px) con 22 px de separacion entre filas para
    # garantizar que no se asome la siguiente fila en el recorte.
    left_f    = 0.0488   # 50 / 1024
    right_f   = 0.0332   # 34 / 1024
    top_f     = 0.1284   # 85 / 662
    row_h_f   = 0.2372   # 157 / 662
    row_gap_f = 0.0272   # 18 / 662

    left    = int(W * left_f)
    right   = int(W * right_f)
    top     = int(H * top_f)
    col_w   = (W - left - right) / 10.0
    row_h   = int(H * row_h_f)
    row_gap = int(H * row_gap_f)

    # letra -> (col_inicio, fila, span_columnas)
    layout = {
        'A':(0,0,1),'B':(1,0,1),'C':(2,0,1),'D':(3,0,1),'E':(4,0,1),
        'F':(5,0,1),'G':(6,0,1),'H':(7,0,1),'I':(8,0,1),'J':(9,0,1),
        'K':(0,1,2),'L':(2,1,1),'M':(3,1,1),'N':(4,1,1),'Ñ':(5,1,1),
        'O':(6,1,1),'P':(7,1,1),'Q':(8,1,2),
        'R':(0,2,1),'S':(1,2,1),'T':(2,2,1),'U':(3,2,1),'V':(4,2,1),
        'W':(5,2,1),'X':(6,2,2),'Y':(8,2,1),'Z':(9,2,1),
    }
    # Pequeno inset interno: evita el borde exterior de la tarjeta y
    # recorta un poco la "bandita" con la letra para enfocar la mano.
    inset_x = int(col_w * 0.03)
    inset_y = int(row_h * 0.02)

    tiles = {}
    for letter, (c, r, span) in layout.items():
        x1 = int(left + c * col_w) + inset_x
        x2 = int(left + (c + span) * col_w) - inset_x
        y1 = top + r * (row_h + row_gap) + inset_y
        y2 = y1 + row_h - inset_y * 2
        x1 = max(0, x1); x2 = min(W, x2)
        y1 = max(0, y1); y2 = min(H, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        tiles[letter] = chart[y1:y2, x1:x2].copy()
    return chart, tiles


# ======================================================================
#  Progreso
# ======================================================================
def load_progress() -> dict:
    try:
        with open(PROGRESS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'completed': [], 'best': {}}


def save_progress(p: dict):
    os.makedirs(PROGRESS_DIR, exist_ok=True)
    try:
        with open(PROGRESS_PATH, 'w', encoding='utf-8') as f:
            json.dump(p, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"  [WARN] no se guardo progreso: {e}")


# ======================================================================
#  Dibujo
# ======================================================================
def draw_user_hands(frame, state: GestureState):
    """Esqueleto de las manos del usuario (solo manos)."""
    h, w = frame.shape[:2]
    for lms in state.hand_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in lms]
        for a, b in HAND_CONNS:
            if a < len(pts) and b < len(pts):
                cv2.line(frame, pts[a], pts[b], USER_COL, 2, cv2.LINE_AA)
        for p in pts:
            cv2.circle(frame, p, 3, NODE_COL, -1, cv2.LINE_AA)


def _wrap_text(text, max_w_px, font, font_scale, thickness):
    """Parte `text` en lineas que quepan dentro de `max_w_px` pixeles."""
    words = text.split()
    lines, cur = [], ""
    for word in words:
        test = (cur + " " + word).strip()
        (tw, _), _ = cv2.getTextSize(test, font, font_scale, thickness)
        if tw > max_w_px and cur:
            lines.append(cur)
            cur = word
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines


def put_letter_enye(dst, org, scale, color, thick, is_enye=False):
    """Dibuja "N" en Hershey; si is_enye, agrega una virgulilla encima
    (las fuentes Hershey no pueden dibujar la letra Ñ)."""
    (w, h), _ = cv2.getTextSize("N", cv2.FONT_HERSHEY_DUPLEX, scale, thick)
    cv2.putText(dst, "N", org, cv2.FONT_HERSHEY_DUPLEX, scale,
                color, thick, cv2.LINE_AA)
    if is_enye:
        tx1 = org[0] + int(w * 0.18)
        tx2 = org[0] + int(w * 0.82)
        ty  = org[1] - h - int(scale * 3)
        amp = max(3, int(scale * 2.0))
        n   = 24
        pts = []
        for i in range(n + 1):
            t = i / n
            x = int(tx1 + (tx2 - tx1) * t)
            # seno con una onda completa -> tilde "~"
            y = int(ty - amp * math.sin(t * math.pi * 2))
            pts.append((x, y))
        pts = np.array(pts, dtype=np.int32).reshape(-1, 1, 2)
        cv2.polylines(dst, [pts], False, color,
                      max(2, thick - 1), cv2.LINE_AA)


# ======================================================================
#  GIFs animados de las senas (data/gifs/<label>.gif)
# ======================================================================
_GIF_CACHE: dict = {}   # label -> list[np.ndarray BGR]


def load_gif_frames(label: str) -> list:
    """Carga un GIF y devuelve lista de frames BGR. [] si no existe."""
    if label in _GIF_CACHE:
        return _GIF_CACHE[label]
    path = GIFS_DIR / f'{label}.gif'
    if not path.exists():
        _GIF_CACHE[label] = []
        return []
    try:
        from PIL import Image
        gif = Image.open(str(path))
        frames = []
        try:
            while True:
                rgb = gif.convert('RGB')
                bgr = cv2.cvtColor(np.array(rgb, dtype=np.uint8),
                                   cv2.COLOR_RGB2BGR)
                frames.append(bgr)
                gif.seek(gif.tell() + 1)
        except EOFError:
            pass
        _GIF_CACHE[label] = frames
        return frames
    except Exception:
        _GIF_CACHE[label] = []
        return []


def load_all_gifs(labels):
    """Pre-carga GIFs para las etiquetas dadas."""
    for lbl in labels:
        load_gif_frames(lbl)


def get_gif_frame(label: str, t: float, fps: float = 12.0):
    """Devuelve el frame BGR correspondiente al instante t (segundos)."""
    frames = load_gif_frames(label)
    if not frames:
        return None
    idx = int(t * fps) % len(frames)
    return frames[idx]


def place_image(dst, src, x1, y1, x2, y2, bg_pad=6):
    """Pega `src` centrada dentro del rectangulo (x1,y1)-(x2,y2)
    conservando proporcion. Pinta un marco blanco alrededor."""
    if src is None or src.size == 0:
        return
    H, W = src.shape[:2]
    area_w = (x2 - x1) - bg_pad * 2
    area_h = (y2 - y1) - bg_pad * 2
    if area_w <= 0 or area_h <= 0:
        return
    sc = min(area_w / W, area_h / H)
    nw = max(1, int(W * sc))
    nh = max(1, int(H * sc))
    resized = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
    cx = x1 + bg_pad + (area_w - nw) // 2
    cy = y1 + bg_pad + (area_h - nh) // 2
    dst[cy:cy+nh, cx:cx+nw] = resized
    cv2.rectangle(dst, (cx - 2, cy - 2), (cx + nw + 1, cy + nh + 1),
                  BORDER_COL, 1, cv2.LINE_AA)


# ======================================================================
#  Main loop
# ======================================================================
def run():
    if not os.path.exists(GESTURE_MODEL):
        print(f"[ERR] No se encontro {GESTURE_MODEL}. "
              f"Ejecuta:  python download_models.py")
        return

    chart_img, chart_tiles = load_chart_tiles(CHART_PATH)
    if chart_img is None:
        print(f"[WARN] No se encontro {CHART_PATH}. Se mostrara "
              f"solo la letra y el texto de cada seña.")

    # Pre-cargar GIFs de todos los signos del curriculum
    # Incluye alfabeto completo + numeros 1-20
    _gif_labels = [e[0] for e in LSM_ALPHABET]  # A-Z incluye dinamicas J,K,Ñ,Q,Z,X
    _gif_labels += [str(i) for i in range(1, 21)]  # numeros 1-20
    load_all_gifs(_gif_labels)
    _gif_start = time.time()   # base de tiempo para la animacion

    progress = load_progress()

    # --- MediaPipe
    gstate = GestureState()
    recognizer = GestureRecognizer.create_from_options(
        GestureRecognizerOptions(
            base_options=BaseOptions(model_asset_path=GESTURE_MODEL),
            running_mode=VisionRunningMode.LIVE_STREAM,
            num_hands=2,
            min_hand_detection_confidence=0.4,
            min_hand_presence_confidence=0.4,
            min_tracking_confidence=0.4,
            result_callback=gstate.update,
        ))

    # --- Camera
    CAM_W, CAM_H = 1280, 720
    cap = _open_camera(0)
    if not cap.isOpened():
        print("[ERR] No se pudo abrir la camara"); return
    try:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
    except Exception:
        pass
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAM_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAM_H)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    # --- Estado
    idx = 0
    paused = False
    hold_start = None
    last_flash = 0.0
    last_ts_ms = 0
    fps = 0.0
    prev_t = time.perf_counter()
    # Tras avanzar de letra, exigimos que la mano salga de la pose al
    # menos un frame antes de poder empezar a "mantener" la nueva letra.
    # Evita que una O seguida de E/S/M/N/T (todas son puno) avance
    # varios niveles mientras el usuario aun tiene la mano formando O.
    need_release = False
    # Observador de movimiento de la muneca (Ñ, J, Z, X con movimiento).
    motion = MotionTracker()
    # Debug overlay (toggle con D) — muestra thumb_axial / thumb_lateral_pos
    # y las flags de posicion del pulgar en el puno. Util para calibrar M/N/T/S/E.
    debug_thumb = False

    # Curriculum: alfabeto (reglas) + numeros (ML)
    curriculum = build_curriculum()
    print(f"  Curriculum: {len(curriculum)} senas")

    # Buffers ML: secuencia de landmarks (dinamicas) y suavizado (estaticas)
    ml_seq_buf  = deque(maxlen=30)
    ml_prob_buf = deque(maxlen=5)

    WIN_TITLE = "LSM Teacher - Alfabeto"
    WIN_W, WIN_H = 1280, 720
    cv2.namedWindow(WIN_TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN_TITLE, WIN_W, WIN_H)

    print("\n  --- CONTROLES ---")
    print("  N / SPACE = siguiente letra")
    print("  B         = letra anterior")
    print("  R         = reiniciar MANTEN")
    print("  K         = pausa")
    print("  D         = debug del pulgar (axial / lateral / flags)")
    print("  Q / ESC   = salir\n")

    while True:
        ok, raw = cap.read()
        if not ok:
            break
        cam = cv2.flip(raw, 1)
        cam_h, cam_w = cam.shape[:2]

        # --- MediaPipe async
        rgb = cv2.cvtColor(cam, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int(time.time() * 1000)
        if ts_ms <= last_ts_ms:
            ts_ms = last_ts_ms + 1
        last_ts_ms = ts_ms
        try:
            recognizer.recognize_async(mp_img, ts_ms)
        except Exception:
            pass

        # --- Letra objetivo + deteccion
        letter, tpl, hint, is_mov = curriculum[idx]
        lms_hand = gstate.hand_landmarks[0] if gstate.hand_landmarks else None
        states   = finger_states(lms_hand) if lms_hand else None

        # Actualizar el tracker de movimiento con la muneca observada.
        motion.feed(lms_hand, time.time())
        has_motion = motion.has_oscillation()

        # Alimentar buffer ML (para dinamicas) con cada frame de mano
        arr_ml = _lms_to_np(lms_hand)
        if arr_ml is not None:
            ml_seq_buf.append(arr_ml)
        else:
            ml_seq_buf.clear()
            ml_prob_buf.clear()

        if tpl is None:
            # ===== Sena evaluada por ML (numeros) ========================
            detected, det_score = "", 0.0
            my_score = 0.0
            if arr_ml is not None and _ML['ready']:
                if is_mov:
                    # DINAMICA: requiere movimiento REAL + buffer suficiente
                    if has_motion and len(ml_seq_buf) >= 10 and _ML['dynamic'] is not None:
                        probs = _ml_dynamic_probs(list(ml_seq_buf))
                        k = int(np.argmax(probs))
                        detected, det_score = _ML['dynamic_classes'][k], float(probs[k])
                        if letter in _ML['dynamic_classes']:
                            my_score = float(probs[_ML['dynamic_classes'].index(letter)])
                else:
                    # ESTATICA: requiere mano QUIETA; usa promedio de
                    # probabilidades de los ultimos frames (suavizado)
                    if not has_motion and _ML['static'] is not None:
                        ml_prob_buf.append(_ml_static_probs(arr_ml))
                        avg = np.mean(ml_prob_buf, axis=0)
                        k = int(np.argmax(avg))
                        detected, det_score = _ML['static_classes'][k], float(avg[k])
                        if letter in _ML['static_classes']:
                            my_score = float(avg[_ML['static_classes'].index(letter)])
            thr = ML_THRESHOLD
            is_match = (not paused) and (my_score >= thr)
        else:
            # ===== Sena evaluada por reglas geometricas ==================
            my_score = score_letter(states, tpl, letter=letter)
            # Las senas con movimiento requieren DE VERDAD que la mano se
            # mueva (Ñ, J, Z, X, K, Q). Si el usuario tiene la pose correcta
            # pero la mano quieta, no avanzamos.
            if is_mov:
                if has_motion:
                    my_score += 0.05
                else:
                    my_score -= 0.08
            elif has_motion:
                # Las senas ESTATICAS deben hacerse con la mano quieta.
                my_score -= 0.10
            thr = MATCH_THRESHOLD_MOV if is_mov else MATCH_THRESHOLD

            if letter.isdigit():
                # Numero estatico por reglas: el "detectado" es el propio
                # numero cuando su score supera el umbral (evita mostrar
                # una letra como L/V/B del detector de alfabeto).
                detected = letter if (states is not None and my_score >= thr) else ""
                det_score = min(1.0, my_score)
            else:
                detected, det_score = detect_best_letter(states, has_motion)
            is_match = (not paused) and (states is not None) and (my_score >= thr)

        # --- Hold-to-advance
        now = time.time()
        # Si acabamos de avanzar, bloqueamos el conteo hasta que la
        # mano salga de la pose (is_match=False) al menos un frame.
        if need_release:
            if not is_match:
                need_release = False
            hold_start = None
            hold_elapsed = 0.0
        elif is_match:
            if hold_start is None:
                hold_start = now
            hold_elapsed = now - hold_start
        else:
            hold_start = None
            hold_elapsed = 0.0
        hold_pct = min(1.0, hold_elapsed / HOLD_SECONDS)

        if hold_pct >= 1.0:
            progress['best'][letter] = 100
            if letter not in progress.get('completed', []):
                progress.setdefault('completed', []).append(letter)
            save_progress(progress)
            idx = (idx + 1) % len(curriculum)
            hold_start = None
            last_flash = now
            need_release = True
            ml_prob_buf.clear()
            nxt = curriculum[idx][0]
            print(f"  [OK] {letter} aprendida  ->  ahora: {nxt}")

        # ===== UI ========================================================
        frame = np.full((WIN_H, WIN_W, 3), BG_DARK, dtype=np.uint8)

        PAD     = 18
        TOP_H   = 58
        BOT_H   = 92
        LEFT_W  = int(WIN_W * 0.34)

        TOP_Y1 = PAD
        TOP_Y2 = PAD + TOP_H
        BOT_Y1 = WIN_H - PAD - BOT_H
        BOT_Y2 = WIN_H - PAD

        LEFT_X1 = PAD
        LEFT_X2 = PAD + LEFT_W
        LEFT_Y1 = TOP_Y2 + PAD
        LEFT_Y2 = BOT_Y1 - PAD

        CAM_X1 = LEFT_X2 + PAD
        CAM_X2 = WIN_W - PAD
        CAM_Y1 = LEFT_Y1
        CAM_Y2 = LEFT_Y2

        # --- Barra superior -----------------------------------------------
        cv2.rectangle(frame, (PAD, TOP_Y1), (WIN_W - PAD, TOP_Y2),
                      PANEL_DARK, -1)
        cv2.rectangle(frame, (PAD, TOP_Y1), (WIN_W - PAD, TOP_Y2),
                      BORDER_COL, 1, cv2.LINE_AA)

        cv2.putText(frame, "APRENDE EL ALFABETO LSM",
                    (PAD + 20, TOP_Y1 + 36),
                    cv2.FONT_HERSHEY_DUPLEX, 0.95, TXT_MAIN, 1, cv2.LINE_AA)

        done = sum(1 for L, *_ in curriculum
                   if L in progress.get('completed', []))
        prog_txt = (f"Sena  {idx+1} / {len(curriculum)}     "
                    f"Aprendidas  {done} / {len(curriculum)}")
        (pw, _), _ = cv2.getTextSize(prog_txt, cv2.FONT_HERSHEY_PLAIN, 1.3, 1)
        cv2.putText(frame, prog_txt,
                    (WIN_W - PAD - 20 - pw, TOP_Y1 + 36),
                    cv2.FONT_HERSHEY_PLAIN, 1.3, TXT_DIM, 1, cv2.LINE_AA)

        # --- Panel izquierdo: tarjeta + letra + hint ----------------------
        cv2.rectangle(frame, (LEFT_X1, LEFT_Y1), (LEFT_X2, LEFT_Y2),
                      PANEL_DARK, -1)
        cv2.rectangle(frame, (LEFT_X1, LEFT_Y1), (LEFT_X2, LEFT_Y2),
                      BORDER_COL, 1, cv2.LINE_AA)

        # El panel se divide en tres bloques:
        #   - Cabecera con la letra grande + badge
        #   - Tarjeta de referencia centrada (ocupa ~55% del alto)
        #   - Descripcion textual al pie
        panel_pad   = 16
        header_h    = 78
        desc_h      = 84
        header_y1   = LEFT_Y1 + panel_pad
        header_y2   = header_y1 + header_h
        tile_y1     = header_y2 + 10
        tile_y2     = LEFT_Y2 - panel_pad - desc_h - 10
        desc_y1     = tile_y2 + 10
        desc_y2     = LEFT_Y2 - panel_pad

        # --- Cabecera: letra grande alineada a la izquierda + badge ------
        bsz = 3.4
        bth = 5
        is_enye = (letter == 'Ñ')
        letter_for_size = 'N' if is_enye else letter
        (bw_, bh_), _ = cv2.getTextSize(letter_for_size,
                                         cv2.FONT_HERSHEY_DUPLEX, bsz, bth)
        letter_color = OK_COL if is_match else TXT_MAIN
        letter_x = LEFT_X1 + panel_pad + 6
        letter_y = header_y1 + (header_h + bh_) // 2 - 4
        if is_enye:
            put_letter_enye(frame, (letter_x, letter_y), bsz,
                            letter_color, bth, is_enye=True)
        else:
            cv2.putText(frame, letter, (letter_x, letter_y),
                        cv2.FONT_HERSHEY_DUPLEX, bsz, letter_color, bth,
                        cv2.LINE_AA)

        # Sub-etiqueta: "Sena N / total"
        sub = f"Sena  {idx+1:2d} / {len(curriculum)}"
        cv2.putText(frame, sub,
                    (letter_x + bw_ + 22, header_y1 + 28),
                    cv2.FONT_HERSHEY_PLAIN, 1.15, TXT_DIM, 1, cv2.LINE_AA)

        if is_mov:
            badge = "CON MOVIMIENTO"
            (mw, mh), _ = cv2.getTextSize(badge,
                                           cv2.FONT_HERSHEY_PLAIN, 1.1, 1)
            mx = letter_x + bw_ + 22
            my = header_y1 + 54
            cv2.rectangle(frame, (mx - 7, my - mh - 5),
                          (mx + mw + 7, my + 6),
                          ACCENT_COL, 1, cv2.LINE_AA)
            cv2.putText(frame, badge, (mx, my),
                        cv2.FONT_HERSHEY_PLAIN, 1.1,
                        ACCENT_COL, 1, cv2.LINE_AA)
        else:
            lbl = "SENA ESTATICA"
            cv2.putText(frame, lbl,
                        (letter_x + bw_ + 22, header_y1 + 54),
                        cv2.FONT_HERSHEY_PLAIN, 1.05, TXT_FAINT, 1,
                        cv2.LINE_AA)

        # --- Tarjeta de referencia centrada ------------------------------
        tile = chart_tiles.get(letter)
        gif_frame = get_gif_frame(letter, now - _gif_start)
        # Fondo claro de la tarjeta ocupando casi todo el ancho
        tile_x1 = LEFT_X1 + panel_pad
        tile_x2 = LEFT_X2 - panel_pad
        # Fondo: oscuro para GIF (esqueleto negro), claro para lamina
        tile_bg = (18, 18, 22) if (tile is None and gif_frame is not None) \
                  else (248, 248, 250)
        cv2.rectangle(frame, (tile_x1, tile_y1), (tile_x2, tile_y2),
                      tile_bg, -1)
        cv2.rectangle(frame, (tile_x1, tile_y1), (tile_x2, tile_y2),
                      BORDER_COL, 1, cv2.LINE_AA)
        if tile is not None:
            # Lamina oficial del alfabeto
            place_image(frame, tile,
                        tile_x1 + 6, tile_y1 + 6,
                        tile_x2 - 6, tile_y2 - 6, bg_pad=6)
            # GIF superpuesto en esquina inferior derecha (miniaturas)
            if gif_frame is not None:
                gx1 = tile_x2 - 88
                gy1 = tile_y2 - 88
                place_image(frame, gif_frame,
                            gx1, gy1, tile_x2 - 4, tile_y2 - 4, bg_pad=2)
        elif gif_frame is not None:
            # Solo GIF (numeros y letras sin lamina)
            place_image(frame, gif_frame,
                        tile_x1 + 6, tile_y1 + 6,
                        tile_x2 - 6, tile_y2 - 6, bg_pad=4)
        else:
            msg = "(imagen no disponible)"
            (mw, mh), _ = cv2.getTextSize(msg, cv2.FONT_HERSHEY_PLAIN, 1.2, 1)
            cv2.putText(frame, msg,
                        (tile_x1 + ((tile_x2-tile_x1) - mw)//2,
                         tile_y1 + ((tile_y2-tile_y1) + mh)//2),
                        cv2.FONT_HERSHEY_PLAIN, 1.2, TXT_FAINT, 1, cv2.LINE_AA)

        # --- Descripcion al pie ------------------------------------------
        max_txt_w = (LEFT_X2 - LEFT_X1) - panel_pad * 2 - 12
        desc_y = desc_y1 + 22
        cv2.putText(frame, "COMO HACERLA",
                    (LEFT_X1 + panel_pad + 2, desc_y1 + 14),
                    cv2.FONT_HERSHEY_PLAIN, 0.95, TXT_FAINT, 1, cv2.LINE_AA)
        for line in _wrap_text(hint, max_txt_w,
                               cv2.FONT_HERSHEY_PLAIN, 1.2, 1):
            cv2.putText(frame, line,
                        (LEFT_X1 + panel_pad + 2, desc_y),
                        cv2.FONT_HERSHEY_PLAIN, 1.2, TXT_MAIN, 1, cv2.LINE_AA)
            desc_y += 22
            if desc_y > desc_y2 - 4:
                break

        # --- Panel derecho: camara en vivo --------------------------------
        cv2.rectangle(frame, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2),
                      (0, 0, 0), -1)
        # Dibujar esqueleto sobre la imagen original (antes de resize)
        draw_user_hands(cam, gstate)

        area_w = CAM_X2 - CAM_X1
        area_h = CAM_Y2 - CAM_Y1
        sc = min(area_w / cam_w, area_h / cam_h)
        new_w = int(cam_w * sc)
        new_h = int(cam_h * sc)
        cam_r = cv2.resize(cam, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        cx = CAM_X1 + (area_w - new_w) // 2
        cy = CAM_Y1 + (area_h - new_h) // 2
        frame[cy:cy+new_h, cx:cx+new_w] = cam_r

        # Borde con color segun estado
        border_col = OK_COL if is_match else (BAD_COL if states is not None else BORDER_COL)
        cv2.rectangle(frame, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2),
                      border_col, 2, cv2.LINE_AA)

        # Destello verde al pasar de letra
        if (now - last_flash) < 0.35:
            k = 1.0 - ((now - last_flash) / 0.35)
            ov = frame.copy()
            cv2.rectangle(ov, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2),
                          OK_COL, -1)
            cv2.addWeighted(ov, 0.22 * k, frame, 1 - 0.22 * k, 0, frame)

        # Sello "HACIENDO: X" dentro del area de camara (esq. sup. izq.)
        if states is not None and detected:
            det_col = OK_COL if (detected == letter) else TXT_MAIN
            det_enye = (detected == 'Ñ')
            det_shown = 'N' if det_enye else detected
            det_pct = int(min(1.0, det_score) * 100)
            det_txt = f"HACIENDO  {det_shown}   {det_pct}%"
            (dw_, dh_), _ = cv2.getTextSize(det_txt,
                                             cv2.FONT_HERSHEY_DUPLEX, 0.7, 1)
            dx = CAM_X1 + 16
            dy = CAM_Y1 + 16 + dh_
            ov2 = frame.copy()
            cv2.rectangle(ov2, (dx - 10, dy - dh_ - 10),
                          (dx + dw_ + 10, dy + 8),
                          (15, 15, 20), -1)
            cv2.addWeighted(ov2, 0.70, frame, 0.30, 0, frame)
            cv2.rectangle(frame, (dx - 10, dy - dh_ - 10),
                          (dx + dw_ + 10, dy + 8),
                          BORDER_COL, 1, cv2.LINE_AA)
            cv2.putText(frame, det_txt, (dx, dy),
                        cv2.FONT_HERSHEY_DUPLEX, 0.7, det_col, 1, cv2.LINE_AA)
            if det_enye:
                # virgulilla pequena sobre la "N" del texto
                n_off_x = dx + int(cv2.getTextSize("HACIENDO  ",
                    cv2.FONT_HERSHEY_DUPLEX, 0.7, 1)[0][0])
                (nw, nh), _ = cv2.getTextSize("N",
                    cv2.FONT_HERSHEY_DUPLEX, 0.7, 1)
                tx1 = n_off_x + 2; tx2 = n_off_x + nw - 2
                ty  = dy - nh - 4
                mid = (tx1 + tx2) // 2
                cv2.line(frame, (tx1, ty + 2), (mid, ty - 2),
                         det_col, 1, cv2.LINE_AA)
                cv2.line(frame, (mid, ty - 2), (tx2, ty + 2),
                         det_col, 1, cv2.LINE_AA)

            # Coaching: hint corto sobre que ajustar para el target.
            if detected != letter and not is_match:
                hint_line = coaching_hint(letter, states)
                if hint_line:
                    (hw_, hh_), _ = cv2.getTextSize(hint_line,
                        cv2.FONT_HERSHEY_DUPLEX, 0.55, 1)
                    hx = dx
                    hy = dy + hh_ + 18
                    ov3 = frame.copy()
                    cv2.rectangle(ov3, (hx - 10, hy - hh_ - 8),
                                  (hx + hw_ + 10, hy + 6),
                                  (15, 15, 20), -1)
                    cv2.addWeighted(ov3, 0.70, frame, 0.30, 0, frame)
                    cv2.rectangle(frame, (hx - 10, hy - hh_ - 8),
                                  (hx + hw_ + 10, hy + 6),
                                  BORDER_COL, 1, cv2.LINE_AA)
                    cv2.putText(frame, hint_line, (hx, hy),
                                cv2.FONT_HERSHEY_DUPLEX, 0.55,
                                (100, 180, 255), 1, cv2.LINE_AA)

        # --- Barra inferior: estado + HOLD + controles --------------------
        cv2.rectangle(frame, (PAD, BOT_Y1), (WIN_W - PAD, BOT_Y2),
                      PANEL_DARK, -1)
        cv2.rectangle(frame, (PAD, BOT_Y1), (WIN_W - PAD, BOT_Y2),
                      BORDER_COL, 1, cv2.LINE_AA)

        if paused:
            status, scol = "PAUSADO", TXT_DIM
        elif is_match:
            status, scol = "COINCIDE - MANTEN LA POSE", OK_COL
        elif states is None:
            status, scol = "MUESTRA TU MANO A LA CAMARA", TXT_FAINT
        else:
            status, scol = "IMITA LA SENA DE LA IZQUIERDA", BAD_COL

        cv2.putText(frame, status,
                    (PAD + 20, BOT_Y1 + 30),
                    cv2.FONT_HERSHEY_DUPLEX, 0.75, scol, 1, cv2.LINE_AA)

        # Barra de HOLD
        hb_x1 = PAD + 20
        hb_x2 = PAD + 20 + int((WIN_W - 2*PAD - 40) * 0.52)
        hb_y1 = BOT_Y1 + 46
        hb_y2 = BOT_Y1 + 62
        cv2.rectangle(frame, (hb_x1, hb_y1), (hb_x2, hb_y2),
                      PANEL_MID, -1)
        cv2.rectangle(frame, (hb_x1, hb_y1),
                      (hb_x1 + int((hb_x2 - hb_x1) * hold_pct), hb_y2),
                      OK_COL, -1)
        cv2.rectangle(frame, (hb_x1, hb_y1), (hb_x2, hb_y2),
                      BORDER_COL, 1, cv2.LINE_AA)
        cv2.putText(frame, f"MANTEN  {int(hold_pct*100):3d}%",
                    (hb_x1, hb_y2 + 20),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, TXT_DIM, 1, cv2.LINE_AA)

        # Controles a la derecha
        ctrls_main = "N siguiente   B anterior   R reiniciar   K pausa   D debug   Q salir"
        (cw, _), _ = cv2.getTextSize(ctrls_main,
                                      cv2.FONT_HERSHEY_PLAIN, 1.1, 1)
        cv2.putText(frame, ctrls_main,
                    (WIN_W - PAD - 20 - cw, BOT_Y1 + 58),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, TXT_FAINT, 1, cv2.LINE_AA)

        # FPS discreto
        now_t = time.perf_counter()
        fps = 0.85 * fps + 0.15 / max(now_t - prev_t, 0.001)
        prev_t = now_t
        fps_txt = f"FPS  {fps:4.0f}"
        (fw_, _), _ = cv2.getTextSize(fps_txt, cv2.FONT_HERSHEY_PLAIN, 1.0, 1)
        cv2.putText(frame, fps_txt,
                    (WIN_W - PAD - 20 - fw_, BOT_Y1 + 30),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, TXT_FAINT, 1, cv2.LINE_AA)

        # --- Debug overlay del pulgar (toggle con D) ────────────────────
        if debug_thumb and states is not None:
            ax_v = states.get('thumb_axial', 0.0)
            la_v = states.get('thumb_lateral_pos', 0.0)
            nz_v = states.get('palm_normal_z', 0.0)
            facing = states.get('palm_facing_camera', False)
            tags = []
            if states.get('fist_tight'):       tags.append('FIST')
            if facing:                          tags.append('FACING')
            if states.get('thumb_over_top'):   tags.append('TOP')
            if states.get('thumb_below_mcps'): tags.append('BELOW')
            if states.get('thumb_at_level'):   tags.append('LEVEL')
            if states.get('thumb_side_index'): tags.append('SIDE_IDX')
            if states.get('thumb_side_middle'):tags.append('SIDE_MID')
            if states.get('thumb_side_pinky'): tags.append('SIDE_PNK')
            dbg_lines = [
                f"axial = {ax_v:+.3f}   lateral = {la_v:+.3f}   nz = {nz_v:+.3f}",
                f"flags : {'  '.join(tags) if tags else '(no fist)'}",
            ]
            dx, dy = PAD + 12, BOT_Y1 + 12
            for ln in dbg_lines:
                cv2.putText(frame, ln, (dx, dy),
                            cv2.FONT_HERSHEY_PLAIN, 1.1,
                            (200, 230, 255), 1, cv2.LINE_AA)
                dy += 18

        # --- Mostrar
        cv2.imshow(WIN_TITLE, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):
            break
        elif key in (ord('n'), ord(' ')):
            idx = (idx + 1) % len(curriculum)
            hold_start = None
            need_release = True
            ml_prob_buf.clear()
            print(f"  >> {curriculum[idx][0]}")
        elif key == ord('b'):
            idx = (idx - 1) % len(curriculum)
            hold_start = None
            need_release = True
            ml_prob_buf.clear()
            print(f"  >> {curriculum[idx][0]}")
        elif key == ord('r'):
            hold_start = None
        elif key == ord('k'):
            paused = not paused
            hold_start = None
        elif key == ord('d'):
            debug_thumb = not debug_thumb

    cap.release()
    cv2.destroyAllWindows()
    recognizer.close()


def main():
    print("=" * 62)
    print("  LSM TEACHER  -  Alfabeto")
    print("=" * 62)
    print("  Aprende las 27 letras del alfabeto en Lengua de Senas")
    print("  Mexicana. Observa la tarjeta de referencia, imita la")
    print("  sena y manten la pose para avanzar.")
    print("=" * 62)
    run()


if __name__ == "__main__":
    main()
