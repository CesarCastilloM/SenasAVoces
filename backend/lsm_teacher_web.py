#!/usr/bin/env python3
"""
LSM Teacher Web — Backend Flask para Señas a Voces Academy
============================================================
Adapta el motor de reconocimiento de `lsm_teacher.py` (que originalmente
corre con ventana OpenCV local) a una API REST que la plataforma web
puede consumir desde el navegador del estudiante.

Flujo:
  1. El navegador captura un frame de la cámara web (canvas → base64).
  2. POST /api/recognize  { frame: "data:image/jpeg;base64,..." }
  3. Este backend decodifica el frame, lo pasa por MediaPipe Hands,
     calcula `finger_states()` y `detect_best_letter()` reutilizando la
     misma lógica del LSM Teacher offline.
  4. Devuelve { sign, confidence, hint, landmarks } al frontend.

Endpoints:
  GET  /              → página de prueba HTML mínima (opcional)
  GET  /api/health    → ping
  GET  /api/alphabet  → lista de letras + descripciones
  POST /api/recognize → reconocimiento de seña a partir de un frame
  GET  /api/stats     → métricas básicas del servicio
  POST /api/lesson/complete → registro de lección completada
  GET  /api/progress/<user_id> → progreso del usuario

Uso:
    pip install flask flask-cors mediapipe opencv-python numpy pillow
    python lsm_teacher_web.py
    # Servidor en http://127.0.0.1:5050
"""

import os
import sys
import io
import base64
import time
import json
import types
import threading
from pathlib import Path
from datetime import datetime
from collections import defaultdict, deque

# Aseguramos que la carpeta app/ esté en el path
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

# --------------------------------------------------------------------
# 1. Importamos main.py real para que lsm_teacher.py pueda hacer
#    `from main import GestureState, ...` sin errores.
# --------------------------------------------------------------------
import importlib
try:
    import main as _main_module  # noqa: F401  — side-effect import
except Exception as _e:
    print(f'[WARN] No se pudo importar main.py: {_e}')
    # Crear stub mínimo para que lsm_teacher.py no falle
    import types as _types
    _stub = _types.ModuleType('main')
    for _attr in ('GestureState', 'HAND_CONNS', 'GESTURE_MODEL', 'POSE_MODEL',
                  'BaseOptions', 'GestureRecognizer', 'GestureRecognizerOptions',
                  'VisionRunningMode', '_open_camera'):
        setattr(_stub, _attr, None)
    sys.modules['main'] = _stub

# --------------------------------------------------------------------
# 2. Reutilizamos directamente las funciones del lsm_teacher.py original
# --------------------------------------------------------------------
try:
    from lsm_teacher import (
        finger_states,
        detect_best_letter,
        coaching_hint,
        MotionTracker,
        LSM_ALPHABET,
        MATCH_THRESHOLD,
        MATCH_THRESHOLD_MOV,
    )
    _ENGINE_OK = True
except Exception as _e:
    print(f"[WARN] No se pudo importar lsm_teacher.py: {_e}")
    print("       El servidor arrancará en MODO MOCK.")
    _ENGINE_OK = False
    LSM_ALPHABET = [(chr(c), '?????', '', False) for c in range(ord('A'), ord('Z')+1)]
    MATCH_THRESHOLD = 0.95
    MATCH_THRESHOLD_MOV = 0.79

# --------------------------------------------------------------------
# 3. Dependencias web + visión
# --------------------------------------------------------------------
try:
    import cv2
    import numpy as np
    import mediapipe as mp
except ImportError as e:
    print(f"[ERROR] Falta dependencia: {e}")
    print("       Instala con: pip install opencv-python mediapipe numpy flask flask-cors")
    sys.exit(1)

try:
    from flask import Flask, request, jsonify, send_file
    from flask_cors import CORS
except ImportError:
    print("[ERROR] Instala Flask: pip install flask flask-cors")
    sys.exit(1)


# --------------------------------------------------------------------
# 4. MediaPipe HandLandmarker (Tasks API) — el MISMO motor que usa
#    lsm_teacher.py. Modo IMAGE = síncrono, ideal para servidor web.
#    Cada llamada a detect() es independiente y thread-safe con el lock.
# --------------------------------------------------------------------
_HERE_ROOT = _HERE.parent
_HAND_MODEL = str(_HERE_ROOT / 'mediapipe_models' / 'hand_landmarker.task')

if not Path(_HAND_MODEL).exists():
    # Intentar ruta alternativa dentro de la misma carpeta app/
    _HAND_MODEL = str(_HERE / '..' / 'mediapipe_models' / 'hand_landmarker.task')

print(f'[INFO] HandLandmarker model: {_HAND_MODEL}')
print(f'[INFO] Model exists: {Path(_HAND_MODEL).exists()}')

try:
    _BaseOptions           = mp.tasks.BaseOptions
    _HandLandmarker        = mp.tasks.vision.HandLandmarker
    _HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
    _VisionRunningMode     = mp.tasks.vision.RunningMode

    _hand_landmarker = _HandLandmarker.create_from_options(
        _HandLandmarkerOptions(
            base_options=_BaseOptions(model_asset_path=_HAND_MODEL),
            running_mode=_VisionRunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.65,
            min_hand_presence_confidence=0.65,
            min_tracking_confidence=0.6,
        )
    )
    _TASKS_OK = True
    print('[INFO] HandLandmarker (Tasks API) iniciado correctamente.')
except Exception as _e:
    print(f'[ERROR] No se pudo iniciar HandLandmarker: {_e}')
    print('        Verifica que mediapipe_models/hand_landmarker.task existe.')
    _hand_landmarker = None
    _TASKS_OK = False

# Lock para serializar accesos (Tasks IMAGE mode no es thread-safe)
_hands_lock = threading.Lock()


# --------------------------------------------------------------------
# 5. Estado por sesión (un MotionTracker por user_id para diferenciar
#    J/Z/Ñ que requieren movimiento ondulante)
# --------------------------------------------------------------------
_sessions: dict[str, MotionTracker] = {}
_sessions_lock = threading.Lock()

def _get_tracker(user_id: str) -> MotionTracker:
    if not _ENGINE_OK:
        return None
    with _sessions_lock:
        if user_id not in _sessions:
            _sessions[user_id] = MotionTracker(window_sec=1.2, min_amp=0.025)
            # Limpieza simple: máximo 1000 sesiones en memoria
            if len(_sessions) > 1000:
                # FIFO drop
                oldest = next(iter(_sessions))
                del _sessions[oldest]
        return _sessions[user_id]


# --------------------------------------------------------------------
# 6. Stats en memoria (en producción: Redis / Postgres)
# --------------------------------------------------------------------
_stats = {
    'started_at': datetime.utcnow().isoformat(),
    'total_recognitions': 0,
    'total_correct': 0,
    'completed_lessons': 0,
    'unique_users': set(),
    'letter_counts': defaultdict(int),
    'recent_latency_ms': deque(maxlen=200),
}
_stats_lock = threading.Lock()

# Progreso y actividad en archivos JSON persistentes
_DATA_DIR = _HERE / 'data'
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_PROGRESS_FILE = _DATA_DIR / 'web_progress.json'
_ACTIVITY_FILE  = _DATA_DIR / 'activity_log.json'

# Log de actividad real: lista de eventos ordenados por tiempo
# Cada evento: {ts, user_id, name, state, action, lesson}
_activity_log: list = []
_activity_lock = threading.Lock()
_MAX_ACTIVITY_LOG = 2000  # máximo en memoria

def _load_activity() -> list:
    if _ACTIVITY_FILE.exists():
        try:
            return json.loads(_ACTIVITY_FILE.read_text(encoding='utf-8'))
        except Exception:
            return []
    return []

def _save_activity():
    try:
        _ACTIVITY_FILE.write_text(
            json.dumps(_activity_log[-_MAX_ACTIVITY_LOG:], ensure_ascii=False),
            encoding='utf-8')
    except Exception as e:
        print(f'[WARN] no se pudo guardar actividad: {e}')

_activity_log = _load_activity()

def _log_activity(user_id: str, name: str, state: str, action: str, lesson: str):
    """Registra un evento real de actividad de usuario."""
    entry = {
        'ts': datetime.utcnow().isoformat(),
        'user_id': user_id,
        'name': name or 'Estudiante',
        'state': state or '',
        'action': action,
        'lesson': lesson,
    }
    with _activity_lock:
        _activity_log.append(entry)
        if len(_activity_log) > _MAX_ACTIVITY_LOG:
            _activity_log.pop(0)
        _save_activity()

def _load_progress() -> dict:
    if _PROGRESS_FILE.exists():
        try:
            return json.loads(_PROGRESS_FILE.read_text(encoding='utf-8'))
        except Exception:
            return {}
    return {}

def _save_progress(d: dict):
    try:
        _PROGRESS_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=2),
                                  encoding='utf-8')
    except Exception as e:
        print(f"[WARN] no se pudo guardar progreso: {e}")

_progress_db = _load_progress()
_progress_lock = threading.Lock()


# --------------------------------------------------------------------
# 6b. DTW — Comparación de secuencias de landmarks vs plantillas NPZ
# --------------------------------------------------------------------
import unicodedata as _ucd
import re as _re

_TEMPLATES_DIR = _HERE.parent / "data" / "templates"
_TEMPLATES_INDEX_PATH = _TEMPLATES_DIR / "index.json"

# Cache de plantillas cargadas: { "categoria/SLUG" -> np.ndarray (T, 42*3) }
_templates_cache: dict = {}
_templates_lock = threading.Lock()

# Índice de búsqueda: { "PALABRA_SLUG" -> [list de paths de npz] }
_templates_by_slug: dict = {}   # se llena en _load_templates_index()


def _slugify_dtw(s: str) -> str:
    s = s.strip().upper()
    s = _ucd.normalize('NFD', s)
    s = ''.join(c for c in s if _ucd.category(c) != 'Mn')
    s = _re.sub(r'[^A-Z0-9]+', '_', s).strip('_')
    return s or 'SIGN'


def _load_templates_index():
    """Lee index.json y construye el lookup slug → [npz_paths]."""
    global _templates_by_slug
    if not _TEMPLATES_INDEX_PATH.exists():
        return
    try:
        idx = json.loads(_TEMPLATES_INDEX_PATH.read_text(encoding='utf-8'))
    except Exception as e:
        print(f'[DTW] No se pudo leer templates/index.json: {e}')
        return
    lookup: dict = {}
    for cat, entries in idx.items():
        for entry in entries:
            slug = entry.get('slug') or _slugify_dtw(entry.get('label', ''))
            path = _TEMPLATES_DIR / cat / f"{slug}.npz"
            if path.exists():
                lookup.setdefault(slug, []).append(str(path))
                # también indexar el label original slugificado
                lslug = _slugify_dtw(entry.get('label', ''))
                if lslug != slug:
                    lookup.setdefault(lslug, []).append(str(path))
    with _templates_lock:
        _templates_by_slug.update(lookup)
    total = sum(len(v) for v in lookup.values())
    print(f'[DTW] Índice cargado: {len(lookup)} slugs únicos, {total} plantillas totales.')


def _get_template_hands(target: str) -> 'np.ndarray | None':
    """Devuelve manos de la primera plantilla que coincida con target. Shape: (T, 2, 21, 3)."""
    slug = _slugify_dtw(target)
    with _templates_lock:
        paths = _templates_by_slug.get(slug, [])
    if not paths:
        return None
    path = paths[0]
    with _templates_lock:
        if path in _templates_cache:
            return _templates_cache[path]
    try:
        npz = np.load(path)
        arr = npz['hands'].astype(np.float32)   # (T, 2, 21, 3)
        with _templates_lock:
            _templates_cache[path] = arr
        return arr
    except Exception as e:
        print(f'[DTW] Error cargando {path}: {e}')
        return None


def _hands_to_vec(hands_frame: 'np.ndarray') -> 'np.ndarray':
    """Aplana una mano (2, 21, 3) → vector (126,) usando solo mano0."""
    # Usar la primera mano; si vacía, ceros
    h = hands_frame[0]   # (21, 3)
    return h.flatten()   # (63,)


def _dtw_distance(seq_a: 'np.ndarray', seq_b: 'np.ndarray') -> float:
    """DTW con ventana de Sakoe-Chiba. seq_a/b: (T, D)."""
    n, m = len(seq_a), len(seq_b)
    if n == 0 or m == 0:
        return float('inf')
    window = max(5, abs(n - m) + int(min(n, m) * 0.2))
    dtw = np.full((n + 1, m + 1), np.inf)
    dtw[0, 0] = 0.0
    for i in range(1, n + 1):
        j0 = max(1, i - window)
        j1 = min(m + 1, i + window + 1)
        for j in range(j0, j1):
            cost = float(np.linalg.norm(seq_a[i-1] - seq_b[j-1]))
            dtw[i, j] = cost + min(dtw[i-1, j], dtw[i, j-1], dtw[i-1, j-1])
    return float(dtw[n, m])


def _dtw_score(user_seq: 'np.ndarray', template_hands: 'np.ndarray') -> float:
    """Devuelve score [0,1] comparando secuencia del usuario contra template.
    user_seq: (T_user, 2, 21, 3) — template_hands: (T_tpl, 2, 21, 3)."""
    if len(user_seq) < 5:
        return 0.0
    # Vectorizar: solo mano dominante (index 0)
    a = np.array([_hands_to_vec(f) for f in user_seq])   # (T_u, 63)
    b = np.array([_hands_to_vec(f) for f in template_hands])  # (T_t, 63)

    # Normalizar por la norma media para que la distancia sea invariante a escala
    scale = max(np.mean(np.linalg.norm(a, axis=1)),
                np.mean(np.linalg.norm(b, axis=1)), 1e-6)
    a = a / scale
    b = b / scale

    dist = _dtw_distance(a, b)
    # Normalizar por la secuencia más corta (no penaliza diferencia de longitud)
    norm_dist = dist / max(min(len(a), len(b)), 1)
    # k=1.5: señas similares (~dist 0.2-0.3) quedan en 65-75%
    score = float(np.exp(-1.5 * norm_dist))
    return min(1.0, max(0.0, score))


# Buffer de landmarks por user_id para DTW: { user_id -> deque[(ts, hands_vec)] }
_DTW_BUFFER_SEC = 4.0   # ventana de tiempo — suficiente para señas dinámicas
_dtw_buffers: dict = {}
_dtw_buffers_lock = threading.Lock()


def _dtw_buffer_add(user_id: str, hands_np: 'np.ndarray'):
    """Agrega un frame de manos (2, 21, 3) al buffer del usuario."""
    now = time.time()
    with _dtw_buffers_lock:
        if user_id not in _dtw_buffers:
            _dtw_buffers[user_id] = deque()
        buf = _dtw_buffers[user_id]
        buf.append((now, hands_np))
        # Limpiar frames viejos
        while buf and now - buf[0][0] > _DTW_BUFFER_SEC:
            buf.popleft()


def _dtw_buffer_get(user_id: str) -> 'np.ndarray':
    """Devuelve el buffer como array (T, 2, 21, 3)."""
    with _dtw_buffers_lock:
        buf = _dtw_buffers.get(user_id, deque())
        if not buf:
            return np.zeros((0, 2, 21, 3), dtype=np.float32)
        return np.array([f for _, f in buf], dtype=np.float32)


def _dtw_buffer_clear(user_id: str):
    """Limpia el buffer del usuario (llamar al cambiar de seña)."""
    with _dtw_buffers_lock:
        if user_id in _dtw_buffers:
            _dtw_buffers[user_id].clear()


# Cargar índice al arrancar
_load_templates_index()


def _user_display_name(user_id: str) -> str:
    """Devuelve el nombre visible del usuario (si tiene perfil) o initiales."""
    u = _progress_db.get(user_id, {})
    return u.get('name') or user_id[:8]

def _user_state(user_id: str) -> str:
    """Devuelve el estado/ciudad del usuario si lo registró."""
    u = _progress_db.get(user_id, {})
    st = u.get('meta', {}).get('state', '')
    country = u.get('meta', {}).get('country', 'MX')
    if st and country == 'MX':
        return st
    return country or ''


# --------------------------------------------------------------------
# 7. Helpers
# --------------------------------------------------------------------
def _landmark_to_obj(lm):
    """Convierte un NormalizedLandmark de Tasks API a un objeto con .x .y .z"""
    class _LM:
        __slots__ = ('x','y','z')
        def __init__(self, x, y, z):
            self.x, self.y, self.z = x, y, z
    return _LM(lm.x, lm.y, lm.z)


def _decode_base64_image(data_url: str):
    """Decodifica una data URL `data:image/jpeg;base64,...` a ndarray BGR."""
    if not data_url:
        return None
    if ',' in data_url:
        data_url = data_url.split(',', 1)[1]
    try:
        raw = base64.b64decode(data_url)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"[ERR] decode b64: {e}")
        return None


def _process_frame(bgr, user_id: str):
    """Pasa el frame por HandLandmarker (Tasks API) + finger_states + detect_best_letter.
    Usa el MISMO motor que lsm_teacher.py. Sin modo mock."""
    _empty = {'ok': True, 'sign': None, 'confidence': 0.0,
              'hint': 'No se detectó tu mano. Acércate y asegúrate de tener luz.',
              'landmarks': []}

    if not _ENGINE_OK or not _TASKS_OK or _hand_landmarker is None:
        return {**_empty, 'hint': 'Motor no disponible. Verifica hand_landmarker.task.'}

    if bgr is None or bgr.size == 0:
        return _empty

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    with _hands_lock:
        result = _hand_landmarker.detect(mp_image)

    if not result.hand_landmarks:
        return _empty

    # Convertir NormalizedLandmark Tasks API → objetos .x .y .z
    # (el mismo tipo que finger_states() espera de mp.solutions.hands)
    lms = [_landmark_to_obj(lm) for lm in result.hand_landmarks[0]]

    # Construir array (2, 21, 3) para buffer DTW
    hands_raw = np.zeros((2, 21, 3), dtype=np.float32)
    for h_idx, h_lms in enumerate(result.hand_landmarks[:2]):
        for j, lm in enumerate(h_lms):
            hands_raw[h_idx, j] = [lm.x, lm.y, lm.z]

    # Estados (ángulos articulares 3-D, orientación, etc.)
    states = finger_states(lms)
    if states is None:
        return {'ok': True, 'sign': None, 'confidence': 0.0,
                'hint': '', 'landmarks': None}

    # Tracker de movimiento (para J, Z, Ñ)
    tracker = _get_tracker(user_id)
    if tracker is not None:
        tracker.feed(lms, time.time())
        has_motion = tracker.has_oscillation()
    else:
        has_motion = False

    # Detección
    best, score = detect_best_letter(states, has_motion=has_motion)
    score = max(0.0, min(1.0, score))  # cap [0,1]
    hint = coaching_hint(best, states) if best else ''

    # Finger states simplificados para el frontend
    fs_simple = {
        'thumb': states.get('thumb', False),
        'index': states.get('index', False),
        'middle': states.get('middle', False),
        'ring': states.get('ring', False),
        'pinky': states.get('pinky', False),
    }
    # Landmarks de TODAS las manos detectadas (para dibujar las dos en frontend)
    all_hands_landmarks = [
        [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in h_lms]
        for h_lms in result.hand_landmarks
    ]
    return {
        'ok': True,
        'sign': best,
        'confidence': round(score, 3),
        'has_motion': has_motion,
        'hint': hint,
        'landmarks': [{'x': p.x, 'y': p.y, 'z': p.z} for p in lms],
        'hands_landmarks': all_hands_landmarks,  # las 2 manos
        'hand_count': len(result.hand_landmarks),
        'finger_states': fs_simple,
        '_hands_raw': hands_raw,  # numpy array — interno, no sale en JSON
    }


def _alphabet_list():
    return [
        {'letter': L, 'template': tpl, 'desc': desc, 'has_motion': bool(mov)}
        for (L, tpl, desc, mov) in LSM_ALPHABET
    ]


# --------------------------------------------------------------------
# 8. Flask app
# --------------------------------------------------------------------
# Eliminar import types que ya no se necesita
import types  # noqa: F811 — necesario para otras partes
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB / video
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.route('/api/practice_reset', methods=['POST'])
def practice_reset():
    """Limpia el buffer DTW del usuario al cambiar de seña."""
    data = request.get_json(silent=True) or {}
    user_id = (data.get('user_id') or request.remote_addr or 'anon').strip()[:64]
    _dtw_buffer_clear(user_id)
    return jsonify({'ok': True})

# --- Directorio donde se guardan los videos de entrenamiento ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
TRAINING_VIDEOS_DIR = _PROJECT_ROOT / "data" / "training_videos"
TRAINING_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)


def _slugify_label(text: str) -> str:
    import re as _re
    text = (text or "").upper().strip()
    repl = {"Á":"A","É":"E","Í":"I","Ó":"O","Ú":"U","Ä":"A","Ë":"E","Ï":"I","Ö":"O","Ü":"U","Ñ":"N"}
    for k, v in repl.items():
        text = text.replace(k, v)
    text = _re.sub(r"[^A-Z0-9_]+", "_", text)
    return text.strip("_")[:40] or "SIN_LABEL"


@app.route('/api/training/upload', methods=['POST'])
def training_upload():
    """Recibe video grabado desde la academia y lo guarda en
    data/training_videos/{categoria}/{slug}.webm"""
    if 'video' not in request.files:
        return jsonify({'ok': False, 'error': 'no video file'}), 400
    f = request.files['video']
    categoria = request.form.get('categoria', 'misc').strip() or 'misc'
    label = request.form.get('label', '').strip()
    if not label:
        return jsonify({'ok': False, 'error': 'falta label'}), 400

    slug = _slugify_label(label)
    cat_safe = _slugify_label(categoria).lower()
    out_dir = TRAINING_VIDEOS_DIR / cat_safe
    out_dir.mkdir(parents=True, exist_ok=True)

    # Detectar extensión por mimetype
    mime = (f.mimetype or '').lower()
    ext = '.webm' if 'webm' in mime else ('.mp4' if 'mp4' in mime else '.webm')
    out_path = out_dir / f"{slug}{ext}"
    f.save(str(out_path))
    size = out_path.stat().st_size

    return jsonify({
        'ok': True,
        'categoria': cat_safe,
        'label': label,
        'slug': slug,
        'path': str(out_path.relative_to(_PROJECT_ROOT)).replace("\\", "/"),
        'size_bytes': size,
        'msg': f'Video guardado. Procesa con: python train_from_videos.py --categoria {cat_safe}'
    })


@app.route('/api/training/list')
def training_list():
    """Lista los videos de entrenamiento disponibles agrupados por categoría."""
    out = {}
    if TRAINING_VIDEOS_DIR.exists():
        for cat_dir in sorted(TRAINING_VIDEOS_DIR.iterdir()):
            if not cat_dir.is_dir():
                continue
            videos = []
            for v in sorted(cat_dir.iterdir()):
                if v.suffix.lower() in ('.mp4', '.webm', '.mov', '.mkv'):
                    videos.append({
                        'slug': v.stem,
                        'file': v.name,
                        'size_kb': round(v.stat().st_size / 1024, 1),
                    })
            if videos:
                out[cat_dir.name] = videos
    return jsonify({'ok': True, 'categorias': out})


@app.route('/api/health')
def health():
    return jsonify({
        'ok': True,
        'engine': 'lsm_teacher.py' if _ENGINE_OK else 'mock',
        'alphabet_size': len(LSM_ALPHABET),
        'uptime_sec': int((datetime.utcnow() -
                           datetime.fromisoformat(_stats['started_at'])).total_seconds()),
    })


@app.route('/api/alphabet')
def alphabet():
    return jsonify({'ok': True, 'alphabet': _alphabet_list()})


@app.route('/api/recognize', methods=['POST'])
def recognize():
    """Endpoint principal: recibe un frame en base64 y devuelve la seña."""
    t0 = time.time()
    data = request.get_json(silent=True) or {}
    frame_b64 = data.get('frame')
    user_id = (data.get('user_id') or request.remote_addr or 'anon').strip()[:64]
    target = (data.get('target') or '').upper().strip()  # opcional: letra objetivo

    bgr = _decode_base64_image(frame_b64)
    result = _process_frame(bgr, user_id)
    result.pop('_hands_raw', None)  # numpy array — no serializable a JSON
    result['target'] = target or None

    # ¿Acertó el usuario? Usamos los MISMOS thresholds que lsm_teacher.py
    # (sin restar 0.10) para que la precisión sea idéntica al desktop.
    if target and result.get('sign') == target:
        thr = MATCH_THRESHOLD_MOV if any(
            L == target and mov for (L, _, _, mov) in LSM_ALPHABET
        ) else MATCH_THRESHOLD
        result['matched']   = result.get('confidence', 0) >= thr
        result['threshold'] = thr
    else:
        result['matched']   = False
        result['threshold'] = MATCH_THRESHOLD

    # Stats
    latency = int((time.time() - t0) * 1000)
    with _stats_lock:
        _stats['total_recognitions'] += 1
        _stats['unique_users'].add(user_id)
        _stats['recent_latency_ms'].append(latency)
        if result.get('sign'):
            _stats['letter_counts'][result['sign']] += 1
        if result.get('matched'):
            _stats['total_correct'] += 1

    result['latency_ms'] = latency
    return jsonify(result)


# --------------------------------------------------------------------
# 7b. PRÁCTICA CON FEEDBACK VISUAL (para todas las lecciones, no solo abecedario)
# --------------------------------------------------------------------

def _finger_extended_raw(landmarks_raw):
    """Calcula extensión de dedos directamente de landmarks crudos (21 puntos).
    Retorna dict {thumb, index, middle, ring, pinky: bool}.
    Más tolerante que lsm_teacher.finger_states para números."""
    if landmarks_raw is None:
        return None
    # landmarks_raw puede ser list de objetos .x,.y,.z o numpy array (21,3)
    if hasattr(landmarks_raw[0], 'x'):
        pts = np.array([[l.x, l.y, l.z] for l in landmarks_raw])
    else:
        pts = np.array(landmarks_raw)
    if pts.shape[0] < 21:
        return None

    # Tip indices: thumb=4, index=8, middle=12, ring=16, pinky=20
    # PIP indices: thumb=3, index=6, middle=10, ring=14, pinky=18
    # MCP indices: thumb=2, index=5, middle=9, ring=13, pinky=17
    # Wrist = 0

    def _is_ext(tip, pip, mcp):
        # Un dedo está extendido si su tip está más lejos de la muñeca que su PIP
        d_tip = np.linalg.norm(pts[tip] - pts[0])
        d_pip = np.linalg.norm(pts[pip] - pts[0])
        # Alternativo: tip-mcp > pip-mcp (el dedo se aleja del MCP)
        d_tip_mcp = np.linalg.norm(pts[tip] - pts[mcp])
        d_pip_mcp = np.linalg.norm(pts[pip] - pts[mcp])
        return d_tip > d_pip * 0.92 or d_tip_mcp > d_pip_mcp * 1.1

    # Pulgar: distancia lateral del tip respecto a la palma
    # El pulgar está "extendido" si su tip se aleja de la base del índice
    thumb_tip = pts[4]
    index_mcp = pts[5]
    palm_size = np.linalg.norm(pts[9] - pts[0]) or 1e-6
    thumb_spread = np.linalg.norm(thumb_tip - index_mcp) / palm_size
    thumb_ext = thumb_spread > 0.55

    return {
        'thumb': thumb_ext,
        'index': _is_ext(8, 6, 5),
        'middle': _is_ext(12, 10, 9),
        'ring': _is_ext(16, 14, 13),
        'pinky': _is_ext(20, 18, 17),
    }


# Descriptores simples para señas numéricas y comunes — suficientes para feedback visual
_SIGN_DESCRIPTORS = {
    # Números (basado en configuración de dedos LSM)
    '1':  {'digits_ext': ['index'], 'desc': 'Índice extendido, resto cerrados'},
    '2':  {'digits_ext': ['index', 'middle'], 'together': True, 'desc': 'Índice y medio extendidos juntos'},
    '3':  {'digits_ext': ['thumb', 'index', 'middle'], 'desc': 'Pulgar, índice, medio extendidos'},
    '4':  {'digits_ext': ['index', 'middle', 'ring', 'pinky'], 'thumb_closed': True, 'desc': '4 dedos extendidos, pulgar cerrado'},
    '5':  {'digits_ext': ['thumb', 'index', 'middle', 'ring', 'pinky'], 'desc': 'Mano abierta, 5 dedos extendidos'},
    '6':  {'digits_ext': ['thumb', 'pinky'], 'desc': 'Pulgar y meñique extendidos ("teléfono")'},
    '7':  {'digits_ext': ['thumb', 'index', 'middle', 'ring'], 'desc': 'Pulgar + 3 dedos extendidos'},
    '8':  {'digits_ext': ['thumb', 'index', 'middle', 'pinky'], 'desc': 'Pulgar + índice + medio + meñique'},
    '9':  {'digits_ext': ['thumb', 'index', 'middle', 'ring', 'pinky'], 'bent': ['index'], 'desc': '5 extendidos pero índice doblado'},
    '10': {'fist': True, 'thumb_up': True, 'desc': 'Puño con pulgar arriba, agitar'},
    # Palabras comunes (categoría saludos/familia básica — orientación + proximidad)
    'HOLA': {'hand_near_face': True, 'desc': 'Mano cerca de la cara, movimiento saludo'},
    'ADIOS': {'hand_near_face': True, 'waving': True, 'desc': 'Mano cerca de cara agitando'},
}

def _score_sign(fst: dict, target: str, landmarks_raw=None) -> tuple[float, str]:
    """Score 0.0-1.0 de qué tan cerca está la mano detectada del target.
    Para letras: delega a lsm_teacher. Para otras: reglas geométricas simples.
    Si landmarks_raw está disponible, usa _finger_extended_raw (más tolerante)."""
    target = target.upper().strip()

    # Si es letra del alfabeto conocida → usar motor real
    if target in [L for (L, _, _, _) in LSM_ALPHABET]:
        return (0.5, 'Usa /api/recognize para letras')

    # Buscar descriptor
    desc = _SIGN_DESCRIPTORS.get(target)
    if desc is None:
        return (0.3 if fst else 0.0, 'Mano detectada (sin criterios específicos para esta seña)')

    # Usar el mejor entre finger_states (lsm_teacher) y raw landmarks
    raw_fst = None
    if landmarks_raw is not None:
        raw_fst = _finger_extended_raw(landmarks_raw)

    hints = []
    all_digits = ['thumb', 'index', 'middle', 'ring', 'pinky']
    ext_expected = desc.get('digits_ext', [])
    should_close = [d for d in all_digits if d not in ext_expected]                                   

    # Conteo de aciertos — tomar el MEJOR entre motor original y raw
    def _check_ext(d):
        """True si al menos un método dice que está extendido."""
        if fst.get(d, False):
            return True
        if raw_fst and raw_fst.get(d, False):
            return True
        return False

    def _check_closed(d):
        """True si al menos un método dice que está cerrado."""
        if not fst.get(d, True):
            return True
        if raw_fst and not raw_fst.get(d, True):
            return True
        return False

    ext_ok = sum(1 for d in ext_expected if _check_ext(d))
    closed_ok = sum(1 for d in should_close if _check_closed(d))
    for d in ext_expected:
        if not fst.get(d, False):
            hints.append(f'Extiende el dedo: {d}')

    # Score balanceado: 90% por configuración correcta, 10% reservado para modificadores
    # Distribuir según haya o no dedos que cerrar
    if ext_expected and should_close:
        ext_w, close_w = 0.55, 0.35
        score = ext_w * (ext_ok / len(ext_expected)) + close_w * (closed_ok / len(should_close))
    elif ext_expected:
        # Todos los dedos extendidos (ej: "5") — 90% va aquí
        score = 0.90 * (ext_ok / len(ext_expected))
    elif should_close:
        # Puño total (ej: parte de "10")
        score = 0.90 * (closed_ok / len(should_close))
    else:
        score = 0.5

    # Modificadores (suman hasta 0.10)
    if desc.get('fist'):
        if fst.get('fist_tight'):
            score += 0.05
        else:
            hints.append('Cierra el puño más compacto')

    if desc.get('thumb_up'):
        if fst.get('thumb_out') and fst.get('thumb'):
            score += 0.05
        else:
            hints.append('Pulgar hacia arriba y visible')

    hint = desc.get('desc', '')
    if hints:
        hint += ' · Ajusta: ' + ', '.join(hints[:2])
    return (min(score, 1.0), hint)


@app.route('/api/practice_frame', methods=['POST'])
def practice_frame():
    """Endpoint para práctica guiada de cualquier seña (letras, números, palabras).
    Devuelve un score 0.0-1.0 + feedback visual sobre qué ajustar."""
    t0 = time.time()
    data = request.get_json(silent=True) or {}
    frame_b64 = data.get('frame')
    user_id = (data.get('user_id') or request.remote_addr or 'anon').strip()[:64]
    target = (data.get('target') or '').strip().upper()

    if not target:
        return jsonify({'ok': False, 'error': 'Falta target (seña esperada)'}), 400

    if not frame_b64:
        return jsonify({'ok': False, 'error': 'Falta frame'}), 400

    try:
        bgr = _decode_base64_image(frame_b64)
    except Exception as ex:
        return jsonify({'ok': False, 'error': f'Imagen inválida: {ex}'}), 400
    if bgr is None:
        return jsonify({'ok': False, 'error': 'Imagen inválida'}), 400

    try:
        proc = _process_frame(bgr, user_id)
    except Exception as ex:
        app.logger.error(f'[practice_frame] _process_frame error: {ex}')
        return jsonify({'ok': False, 'error': 'Error procesando frame'}), 500

    # ¿Se detectó mano?
    if not proc.get('landmarks'):
        return jsonify({
            'ok': True,
            'hand_visible': False,
            'score': 0.0,
            'hint': 'No se ve tu mano. Acércate a la cámara y asegúrate de tener buena luz.',
            'target': target,
            'latency_ms': int((time.time() - t0) * 1000),
        })

    fst = proc.get('finger_states') or {}
    detected_sign = proc.get('sign')
    detected_conf = proc.get('confidence', 0.0)
    hands_raw = proc.pop('_hands_raw', None)  # numpy array interno — extraer antes de jsonify
    hands_lm = proc.get('hands_landmarks') or []  # para dibujar

    # Acumular frame en buffer DTW
    if hands_raw is not None:
        _dtw_buffer_add(user_id, hands_raw)

    # --- Prioridad 1: Letras del alfabeto → motor de reglas geométricas ---
    is_letter = target in [L for (L, _, _, _) in LSM_ALPHABET]
    # Letras con componente de movimiento: combinar reglas + DTW
    DYNAMIC_LETTERS = {'J', 'Z', 'Ñ', 'X', 'K'}
    if is_letter:
        method = 'rules'
        if detected_sign == target:
            score = float(detected_conf)
            hint = f'¡{detected_sign}! ({int(detected_conf*100)}%)'
        elif detected_sign:
            # Otra letra detectada — score parcial basado en su confianza
            score = max(0.15, min(0.45, float(detected_conf) * 0.5))
            hint = f'Detecté "{detected_sign}". Ajusta para hacer "{target}".'
        else:
            score = 0.1
            hint = proc.get('hint') or f'Forma la letra {target}'

        # Fallback DTW para letras dinámicas o cuando reglas dan bajo score
        if (target in DYNAMIC_LETTERS or score < 0.5):
            tpl = _get_template_hands(target)
            if tpl is not None:
                user_seq = _dtw_buffer_get(user_id)
                if len(user_seq) >= 5:
                    dtw_val = _dtw_score(user_seq, tpl)
                    if dtw_val > score:
                        score = dtw_val
                        hint = f'¡Bien! "{target}" ({int(dtw_val*100)}%)' if dtw_val >= 0.6 else hint
                        method = 'rules+dtw'

        return jsonify({
            'ok': True,
            'hand_visible': True,
            'score': round(score, 3),
            'hint': hint,
            'target': target,
            'detected': detected_sign,
            'finger_states': fst,
            'hands_landmarks': hands_lm,
            'method': method,
            'latency_ms': int((time.time() - t0) * 1000),
        })

    # --- Prioridad 2: DTW contra plantilla NPZ ---
    template_hands = _get_template_hands(target)
    if template_hands is not None:
        user_seq = _dtw_buffer_get(user_id)
        n_frames = len(user_seq)
        # Score geométrico inicial (forma de los dedos) — feedback inmediato
        lm_raw = hands_raw[0] if hands_raw is not None else None
        geom_score, _ = _score_sign(fst, target, landmarks_raw=lm_raw)
        if n_frames < 5:
            # Aún acumulando — score basado solo en forma actual
            dtw_score_val = max(0.2, geom_score * 0.8)
            hint = f'Mantén la seña de "{target}" para evaluar...'
        else:
            dtw_score_val = _dtw_score(user_seq, template_hands)
            # Mezclar con geom para no penalizar señas estáticas
            dtw_score_val = max(dtw_score_val, geom_score * 0.85)
            if dtw_score_val >= 0.65:
                hint = f'¡Muy bien! "{target}" ({int(dtw_score_val*100)}%)'
            elif dtw_score_val >= 0.4:
                hint = f'Casi, sigue con "{target}" ({int(dtw_score_val*100)}%)'
            else:
                hint = f'Imita el movimiento del video de "{target}"'
        return jsonify({
            'ok': True,
            'hand_visible': True,
            'score': round(dtw_score_val, 3),
            'hint': hint,
            'target': target,
            'finger_states': fst,
            'hands_landmarks': hands_lm,
            'method': 'dtw',
            'frames_buffered': n_frames,
            'latency_ms': int((time.time() - t0) * 1000),
        })

    # --- Prioridad 3: Fallback — sin plantilla ni descriptor ---
    lm_raw = hands_raw[0] if hands_raw is not None else None
    score, hint = _score_sign(fst, target, landmarks_raw=lm_raw)
    # Bonus si la mano es estable y se ve movimiento intencional
    user_seq = _dtw_buffer_get(user_id)
    if len(user_seq) >= 8:
        # Medir variabilidad: si hay movimiento, sumar bonus
        try:
            diffs = np.linalg.norm(np.diff(user_seq[:, 0].reshape(len(user_seq), -1), axis=0), axis=1)
            motion = float(np.mean(diffs))
            # Movimiento moderado (~0.05-0.15) suma hasta 0.3
            motion_bonus = min(0.30, max(0.0, (motion - 0.02) * 3.0))
            score = min(1.0, score + motion_bonus)
            if motion_bonus > 0.15:
                hint = f'Detecté movimiento — mantén el gesto de "{target}"'
        except Exception:
            pass
    return jsonify({
        'ok': True,
        'hand_visible': True,
        'score': round(score, 3),
        'hint': hint,
        'target': target,
        'finger_states': fst,
        'hands_landmarks': hands_lm,
        'method': 'geometric',
        'latency_ms': int((time.time() - t0) * 1000),
    })


@app.route('/api/stats')
def stats():
    with _stats_lock:
        avg_lat = (sum(_stats['recent_latency_ms']) /
                   max(1, len(_stats['recent_latency_ms'])))
        top = sorted(_stats['letter_counts'].items(),
                     key=lambda x: -x[1])[:10]
        return jsonify({
            'ok': True,
            'started_at': _stats['started_at'],
            'total_recognitions': _stats['total_recognitions'],
            'total_correct': _stats['total_correct'],
            'accuracy_pct': round(_stats['total_correct'] /
                                  max(1, _stats['total_recognitions']) * 100, 1),
            'completed_lessons': _stats['completed_lessons'],
            'unique_users': len(_stats['unique_users']),
            'top_letters': [{'letter': L, 'count': c} for L, c in top],
            'avg_latency_ms': round(avg_lat, 1),
        })


@app.route('/api/lesson/complete', methods=['POST'])
def lesson_complete():
    """Registra una lección completada (POST desde la Academy)."""
    data = request.get_json(silent=True) or {}
    user_id  = (data.get('user_id') or 'anon').strip()[:64]
    lesson_id = (data.get('lesson_id') or '').strip()
    duration = float(data.get('duration_sec') or 0)
    precision = float(data.get('precision') or 0)

    if not lesson_id:
        return jsonify({'ok': False, 'error': 'lesson_id requerido'}), 400

    with _progress_lock:
        u = _progress_db.setdefault(user_id, {'lessons': {}, 'total_min': 0})
        u['lessons'][lesson_id] = {
            'completed_at': datetime.utcnow().isoformat(),
            'duration_sec': duration,
            'precision': precision,
        }
        u['total_min'] = u.get('total_min', 0) + duration / 60.0
        _save_progress(_progress_db)

    with _stats_lock:
        _stats['completed_lessons'] += 1

    # Registrar en el log de actividad real
    name  = _user_display_name(user_id)
    place = _user_state(user_id)
    _log_activity(user_id, name, place, 'completó', lesson_id)

    return jsonify({'ok': True, 'lessons_completed': len(u['lessons'])})


@app.route('/api/progress/<user_id>')
def progress(user_id):
    with _progress_lock:
        u = _progress_db.get(user_id, {'lessons': {}, 'total_min': 0})
    return jsonify({
        'ok': True,
        'user_id': user_id,
        'lessons': u.get('lessons', {}),
        'lessons_completed': len(u.get('lessons', {})),
        'total_min': round(u.get('total_min', 0), 1),
    })


@app.route('/api/feed')
def feed():
    """Feed de actividad real: últimos N eventos registrados.
    Solo muestra datos reales. Si no hay actividad, devuelve lista vacía.
    """
    limit = min(int(request.args.get('limit', 20)), 100)
    with _activity_lock:
        recent = list(reversed(_activity_log[-limit:]))

    # Convertir timestamps ISO a segundos-hace (para el frontend)
    now = datetime.utcnow()
    result = []
    for e in recent:
        try:
            dt = datetime.fromisoformat(e['ts'])
            ago_sec = int((now - dt).total_seconds())
        except Exception:
            ago_sec = 0
        result.append({
            'user_id':  e['user_id'],
            'name':     e['name'],
            'state':    e['state'],
            'action':   e['action'],
            'lesson':   e['lesson'],
            'ago_sec':  ago_sec,
            'ts':       e['ts'],
        })
    return jsonify({'ok': True, 'count': len(result), 'events': result})


@app.route('/api/dashboard')
def dashboard():
    """Datos reales del dashboard. Sin inventar nada.
    Todos los números vienen de los archivos de persistencia.
    """
    with _progress_lock:
        total_users    = len(_progress_db)
        total_lessons  = sum(
            len(u.get('lessons', {}))
            for u in _progress_db.values()
        )
        total_min = sum(
            float(u.get('total_min', 0))
            for u in _progress_db.values()
        )
        # Conteo por estado (solo los que tienen perfil con estado MX)
        state_counts: dict[str, int] = defaultdict(int)
        for u in _progress_db.values():
            st = u.get('meta', {}).get('state', '')
            if st:
                state_counts[st] += 1

    with _stats_lock:
        recognitions   = _stats['total_recognitions']
        correct        = _stats['total_correct']
        top_letters    = sorted(_stats['letter_counts'].items(), key=lambda x: -x[1])[:10]
        avg_lat        = (sum(_stats['recent_latency_ms']) /
                          max(1, len(_stats['recent_latency_ms'])))

    return jsonify({
        'ok': True,
        'real_data': True,             # flag explícito: nada de esto está inventado
        'total_users':    total_users,
        'total_lessons':  total_lessons,
        'total_hours':    round(total_min / 60, 1),
        'total_recognitions': recognitions,
        'accuracy_pct':  round(correct / max(1, recognitions) * 100, 1),
        'top_letters':   [{'letter': L, 'count': c} for L, c in top_letters],
        'state_counts':  dict(state_counts),
        'avg_latency_ms': round(avg_lat, 1),
        'generated_at':  datetime.utcnow().isoformat(),
        'note': 'Todos los datos son reales. Generados desde actividad de usuarios registrados.',
    })


@app.route('/api/register', methods=['POST'])
def register():
    """Registro mínimo, datos no sensibles. Devuelve un user_id."""
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or 'Anónimo').strip()[:48]
    user_id = 'sav_' + base64.urlsafe_b64encode(
        os.urandom(6)).decode().rstrip('=')
    with _progress_lock:
        _progress_db[user_id] = {
            'name': name,
            'meta': {
                'deaf': data.get('deaf'),
                'reason': data.get('reason'),
                'age_range': data.get('age_range'),
                'country': data.get('country'),
                'state': data.get('state'),
            },
            'created_at': datetime.utcnow().isoformat(),
            'lessons': {}, 'total_min': 0,
        }
        _save_progress(_progress_db)
    _log_activity(user_id, name, data.get('state', ''), 'se unió a', 'Academy')
    return jsonify({'ok': True, 'user_id': user_id, 'name': name})


# --------------------------------------------------------------------
# 9. Página de prueba (HTML mínimo embebido)
# --------------------------------------------------------------------
_DEMO_HTML = """<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>LSM Teacher Web — Demo</title>
<style>
body{font-family:system-ui;max-width:720px;margin:24px auto;padding:0 16px;color:#0F172A}
h1{color:#1B4F9B}.row{display:flex;gap:16px;flex-wrap:wrap}
video,canvas{max-width:320px;border:2px solid #CBD5E1;border-radius:12px}
.box{background:#F1F5F9;padding:16px;border-radius:12px;flex:1;min-width:240px}
.glyph{font-size:5rem;font-weight:900;color:#1B4F9B;text-align:center;line-height:1}
.bar{height:10px;background:#E2E8F0;border-radius:999px;overflow:hidden;margin-top:8px}
.bar>span{display:block;height:100%;background:linear-gradient(90deg,#DC2626,#EAB308,#16A34A);transition:width .3s}
button{background:#F97316;color:white;border:0;padding:12px 20px;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:700}
.hint{color:#475569;font-size:.9rem;margin-top:8px}
</style></head><body>
<h1>🤟 LSM Teacher Web — Demo</h1>
<p>Backend de reconocimiento LSM corriendo en este servidor.
Permite a la <a href="https://senasavoces.mx" target="_blank">Academy</a> reconocer señas en tiempo real.</p>
<div class="row">
  <div class="box">
    <video id="v" autoplay playsinline muted></video>
    <canvas id="c" width="320" height="240" style="display:none"></canvas>
    <div><button id="b">🎥 Iniciar cámara</button></div>
  </div>
  <div class="box">
    <div>Objetivo:</div>
    <div class="glyph" id="target">A</div>
    <div>Detectado:</div>
    <div class="glyph" id="detected" style="color:#16A34A">—</div>
    <div>Confianza: <strong id="conf">0%</strong></div>
    <div class="bar"><span id="bar" style="width:0%"></span></div>
    <div class="hint" id="hint">—</div>
    <div style="margin-top:12px;font-size:.85rem;color:#64748B">
      Latencia: <span id="lat">—</span> ms · <a href="/api/stats">📊 stats</a>
    </div>
  </div>
</div>
<script>
const v=document.getElementById('v'),c=document.getElementById('c'),btn=document.getElementById('b');
let stream=null,target='A';
btn.onclick=async()=>{
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;btn.textContent='🎥 Iniciar cámara';return;}
  stream=await navigator.mediaDevices.getUserMedia({video:{width:320,height:240}});
  v.srcObject=stream;btn.textContent='⏹ Detener';
  setInterval(sendFrame,500);
};
async function sendFrame(){
  if(!stream)return;
  c.getContext('2d').drawImage(v,0,0,320,240);
  const frame=c.toDataURL('image/jpeg',0.6);
  const r=await fetch('/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({frame,target,user_id:'demo'})});
  const j=await r.json();
  const pct=Math.round((j.confidence||0)*100);
  document.getElementById('detected').textContent=j.sign||'—';
  document.getElementById('conf').textContent=pct+'%';
  document.getElementById('bar').style.width=pct+'%';
  document.getElementById('hint').textContent=j.hint||'';
  document.getElementById('lat').textContent=j.latency_ms;
}
</script></body></html>"""


@app.route('/')
def index():
    from flask import Response
    return Response(_DEMO_HTML, mimetype='text/html')


# --------------------------------------------------------------------
# 10. Entrypoint
# --------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("  LSM TEACHER WEB — Señas a Voces Academy backend")
    print("=" * 60)
    tasks_status = 'HandLandmarker Tasks API' if _TASKS_OK else 'ERROR - revisa hand_landmarker.task'
    print(f"  Motor:      {'lsm_teacher.py REAL + ' + tasks_status if _ENGINE_OK else 'ERROR'}")
    print(f"  Modelo:     {_HAND_MODEL}")
    print(f"  Alfabeto:   {len(LSM_ALPHABET)} letras")
    print(f"  Demo:       http://127.0.0.1:5050/")
    print(f"  API:        http://127.0.0.1:5050/api/recognize")
    print(f"  Stats:      http://127.0.0.1:5050/api/stats")
    print("=" * 60)
    # threaded=True: Flask servidor de desarrollo permite múltiples
    # conexiones simultáneas; el lock global serializa los accesos a
    # MediaPipe que no es thread-safe.
    app.run(host='0.0.0.0', port=5050, threaded=True, debug=False)
