"""
LIVE RECOGNIZER — Reconocimiento de LSM en tiempo real (GPU, alta calidad)
==========================================================================

Detecta de forma CONTINUA y en vivo desde cámara con GPU acceleration:
  - Letras estáticas del abecedario (A-Z, Ñ)   → reglas geométricas
  - Letras dinámicas (J, Z, Ñ)                 → reglas + motion tracker  
  - Números 1-30                              → embeddings + DTW
  - Palabras del Glosario CDMX (350 plantillas)→ embeddings + DTW

Modo ALFABETO + NÚMEROS 1-20: filtra solo esas señas para máxima precisión.

Uso:
    python backend/live_recognizer.py [--alfanum]
    Q = salir, R = reset, T = toggle top-5, A = modo alfabeto+números
"""

from __future__ import annotations
import os, sys, time, json, math, threading
from pathlib import Path
from collections import deque
import numpy as np
import cv2

# ---------------------------------------------------------------------
# Imports del proyecto
# ---------------------------------------------------------------------
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))

import mediapipe as mp
from lsm_teacher import (
    finger_states,
    detect_best_letter,
    coaching_hint,
    MotionTracker,
    LSM_ALPHABET,
)

# ---------------------------------------------------------------------
# MediaPipe HandLandmarker (Tasks API)
# ---------------------------------------------------------------------
_HAND_MODEL = str(_ROOT / 'mediapipe_models' / 'hand_landmarker.task')
if not Path(_HAND_MODEL).exists():
    print(f"[ERR] No existe {_HAND_MODEL}. Ejecuta `python backend/download_models.py`")
    sys.exit(1)

_BaseOptions = mp.tasks.BaseOptions
_HandLandmarker = mp.tasks.vision.HandLandmarker
_HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
_VisionRunningMode = mp.tasks.vision.RunningMode

# ---------------------------------------------------------------------
# MediaPipe HandLandmarker con GPU delegate (mejor calidad)
# Se inicializa en main() para permitir fallback graceful
# ---------------------------------------------------------------------
hand_landmarker = None  # Se inicializa en main()

def create_hand_landmarker_gpu(prefer_gpu=True):
    """Crear HandLandmarker intentando usar GPU, fallback a CPU."""
    # Opciones base para CPU
    base_opts_cpu = _BaseOptions(model_asset_path=_HAND_MODEL)
    
    if prefer_gpu:
        try:
            base_opts_gpu = _BaseOptions(
                model_asset_path=_HAND_MODEL,
                delegate=_BaseOptions.Delegate.GPU
            )
            # Intentar crear con GPU
            lm = _HandLandmarker.create_from_options(
                _HandLandmarkerOptions(
                    base_options=base_opts_gpu,
                    running_mode=_VisionRunningMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.5,
                    min_hand_presence_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
            )
            print("[OK] GPU acceleration activada")
            return lm
        except Exception as e:
            print(f"[INFO] GPU no disponible: {type(e).__name__}")
    
    # Fallback a CPU
    print("[INFO] Usando CPU (alta calidad)")
    return _HandLandmarker.create_from_options(
        _HandLandmarkerOptions(
            base_options=base_opts_cpu,
            running_mode=_VisionRunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )


# ---------------------------------------------------------------------
# Plantillas DTW (Glosario CDMX)
# ---------------------------------------------------------------------
_TEMPLATES_DIR = _ROOT / 'data' / 'templates'
_TEMPLATES_INDEX = _TEMPLATES_DIR / 'index.json'

class _Tpl:
    """Plantilla DTW pre-cargada con huella geométrica."""
    __slots__ = ('label', 'category', 'hands', 'vec_seq', 'static', 'finger_print')

    def __init__(self, label, category, hands):
        self.label = label
        self.category = category
        self.hands = hands  # (T, 2, 21, 3)
        # Pre-vectorizar: solo mano dominante, normalizada
        a = np.array([f[0].flatten() for f in hands], dtype=np.float32)  # (T, 63)
        scale = float(np.mean(np.linalg.norm(a, axis=1))) or 1e-6
        self.vec_seq = a / scale
        # ¿Es estática? variación pequeña entre frames
        diffs = np.linalg.norm(np.diff(a, axis=0), axis=1) if len(a) > 1 else np.array([0.0])
        motion = float(np.mean(diffs) / scale)
        self.static = motion < 0.06
        # Huella de finger_states en el frame central — para pre-filtro
        mid = hands[len(hands)//2]
        self.finger_print = _quick_finger_print(mid[0])


def _quick_finger_print(lm21: np.ndarray) -> tuple[bool, bool, bool, bool, bool]:
    """Detección rápida de dedos extendidos desde landmarks crudos (21,3)."""
    if lm21 is None or lm21.shape[0] < 21 or np.allclose(lm21, 0):
        return (False, False, False, False, False)
    pts = lm21
    def _ext(tip, pip, mcp):
        d_tip = np.linalg.norm(pts[tip] - pts[mcp])
        d_pip = np.linalg.norm(pts[pip] - pts[mcp])
        return d_tip > d_pip * 1.10
    palm = np.linalg.norm(pts[9] - pts[0]) or 1e-6
    thumb_spread = np.linalg.norm(pts[4] - pts[5]) / palm
    return (
        thumb_spread > 0.55,
        _ext(8, 6, 5),
        _ext(12, 10, 9),
        _ext(16, 14, 13),
        _ext(20, 18, 17),
    )


def _slugify(text: str) -> str:
    import unicodedata as _u
    s = (text or "").upper().strip()
    s = _u.normalize('NFD', s)
    s = ''.join(c for c in s if _u.category(c) != 'Mn')
    import re as _re
    s = _re.sub(r'[^A-Z0-9]', '_', s)
    return s or 'SIGN'


def load_all_templates() -> list[_Tpl]:
    if not _TEMPLATES_INDEX.exists():
        print(f"[WARN] No existe {_TEMPLATES_INDEX} — sin plantillas DTW")
        return []
    idx = json.loads(_TEMPLATES_INDEX.read_text(encoding='utf-8'))
    tpls: list[_Tpl] = []
    for cat, entries in idx.items():
        for e in entries:
            slug = e.get('slug') or _slugify(e.get('label', ''))
            path = _TEMPLATES_DIR / cat / f"{slug}.npz"
            if not path.exists():
                continue
            try:
                arr = np.load(path)['hands'].astype(np.float32)
                tpls.append(_Tpl(e.get('label', slug), cat, arr))
            except Exception as ex:
                print(f"[WARN] {path}: {ex}")
    print(f"[OK] {len(tpls)} plantillas DTW cargadas")
    return tpls


# ---------------------------------------------------------------------
# DTW
# ---------------------------------------------------------------------
def dtw_distance(a: np.ndarray, b: np.ndarray, window_ratio: float = 0.25) -> float:
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return float('inf')
    w = max(5, abs(n - m) + int(min(n, m) * window_ratio))
    dtw = np.full((n + 1, m + 1), np.inf, dtype=np.float32)
    dtw[0, 0] = 0.0
    for i in range(1, n + 1):
        j0 = max(1, i - w); j1 = min(m + 1, i + w + 1)
        for j in range(j0, j1):
            cost = float(np.linalg.norm(a[i-1] - b[j-1]))
            dtw[i, j] = cost + min(dtw[i-1, j], dtw[i, j-1], dtw[i-1, j-1])
    return float(dtw[n, m])


def dtw_score(user_vec_seq: np.ndarray, tpl: _Tpl) -> float:
    if len(user_vec_seq) < 5:
        return 0.0
    d = dtw_distance(user_vec_seq, tpl.vec_seq)
    norm = d / max(min(len(user_vec_seq), len(tpl.vec_seq)), 1)
    return float(np.exp(-1.5 * norm))


# ---------------------------------------------------------------------
# Embedding matcher (kNN por similitud coseno) — más robusto que DTW
# ---------------------------------------------------------------------
_EMBEDDINGS_PATH = _ROOT / 'data' / 'embeddings.npz'

# Labels del alfabeto + números 1-20 para modo filtrado (orden: alfabeto primero, luego números)
ALFABETO_NUMEROS_1_20 = frozenset([
    # Alfabeto A-Z
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    # Números 1-20
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15_1', '15_2', '16', '17', '18', '19', '20',
])
# Para ordenar resultados: alfabeto primero, luego números
_ALFA_ORDER = {c: i for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}
_NUM_ORDER  = {str(n): 100 + n for n in range(1, 21)}
_NUM_ORDER.update({'15_1': 115, '15_2': 115})
ALFANUM_SORT_KEY = {**_ALFA_ORDER, **_NUM_ORDER}

def _normalize_hand_seq(hand_seq: np.ndarray) -> np.ndarray:
    """Normaliza (T,21,3): centra en muñeca + escala por dist wrist→middle_mcp."""
    if hand_seq.size == 0:
        return hand_seq.astype(np.float32)
    out = hand_seq.astype(np.float32).copy()
    valid_idx = []
    for t in range(out.shape[0]):
        if np.all(out[t] == 0):
            continue
        wrist = out[t, 0].copy()
        out[t] = out[t] - wrist
        scale = float(np.linalg.norm(out[t, 9]))
        if scale > 1e-6:
            out[t] = out[t] / scale
            valid_idx.append(t)
        else:
            out[t] = 0.0
    return out[valid_idx] if valid_idx else out[:0]


def _compute_user_embedding(hands_buffer: list[np.ndarray]) -> np.ndarray | None:
    """Calcula embedding del usuario igual que build_embeddings.py.
    hands_buffer: lista de np.array (2,21,3). Retorna (260,) o None.
    """
    if not hands_buffer:
        return None
    hands = np.stack(hands_buffer)  # (T, 2, 21, 3)
    h0 = hands[:, 0]
    h1 = hands[:, 1] if hands.shape[1] > 1 else np.zeros_like(h0)
    h0n = _normalize_hand_seq(h0)
    h1n = _normalize_hand_seq(h1)
    has_h1 = sum(1 for t in range(h1.shape[0]) if not np.all(h1[t] == 0)) >= 3

    if h0n.shape[0] > 0:
        f0 = h0n.reshape(h0n.shape[0], -1)
        m0 = np.mean(f0, axis=0); s0 = np.std(f0, axis=0)
        motion0 = float(np.mean(np.linalg.norm(np.diff(f0, axis=0), axis=1))) if f0.shape[0] > 1 else 0.0
    else:
        m0 = np.zeros(63, np.float32); s0 = np.zeros(63, np.float32); motion0 = 0.0

    if has_h1 and h1n.shape[0] > 0:
        f1 = h1n.reshape(h1n.shape[0], -1)
        m1 = np.mean(f1, axis=0); s1 = np.std(f1, axis=0)
        motion1 = float(np.mean(np.linalg.norm(np.diff(f1, axis=0), axis=1))) if f1.shape[0] > 1 else 0.0
    else:
        m1 = np.zeros(63, np.float32); s1 = np.zeros(63, np.float32); motion1 = 0.0

    high = np.array([
        1.0 if has_h1 else 0.0,
        min(motion0, 0.5), min(motion1, 0.5),
        min(hands.shape[0] / 60.0, 1),
        float(np.mean(h0[:, :, 0])) if h0.size else 0.0,
        float(np.mean(h0[:, :, 1])) if h0.size else 0.0,
        float(np.mean(np.linalg.norm(h0[:, 0] - h1[:, 0], axis=-1))) if has_h1 else 0.0,
        float(np.std(m0[:21*2])) if m0.size else 0.0,
    ], dtype=np.float32)

    emb = np.concatenate([m0, s0, m1, s1, high]).astype(np.float32)
    if not np.all(np.isfinite(emb)):
        return None
    return emb


class EmbeddingMatcher:
    """Matcher kNN basado en similitud coseno contra embeddings pre-calculados."""
    def __init__(self, path: Path = _EMBEDDINGS_PATH, allowed_labels: set | frozenset | None = None):
        self.ok = False
        self.allowed_labels = allowed_labels  # Filtro para modo alfabeto+números
        if not path.exists():
            print(f"[WARN] No existe {path}; corre `python backend/build_embeddings.py`")
            return
        z = np.load(path, allow_pickle=True)
        all_vectors = z['vectors'].astype(np.float32)
        all_labels = list(z['labels'])
        all_categories = list(z['categories'])
        all_is_dynamic = z['is_dynamic']
        
        # Filtrar si está en modo alfabeto+números
        if allowed_labels:
            indices = [i for i, lbl in enumerate(all_labels) if lbl in allowed_labels]
            self.V = all_vectors[indices]
            self.labels = [all_labels[i] for i in indices]
            self.categories = [all_categories[i] for i in indices]
            self.is_dynamic = all_is_dynamic[indices]
            print(f"[INFO] Modo ALFABETO+NÚMEROS: {len(self.labels)} señas filtradas")
        else:
            self.V = all_vectors
            self.labels = all_labels
            self.categories = all_categories
            self.is_dynamic = all_is_dynamic
            
        # Pre-normalizar para coseno
        norms = np.linalg.norm(self.V, axis=1, keepdims=True)
        norms[norms < 1e-6] = 1.0
        self.Vn = self.V / norms
        self.ok = True
        print(f"[OK] {len(self.V)} embeddings cargados ({self.V.shape[1]} dims)")

    def topk(self, user_emb: np.ndarray, k: int = 5,
             prefer_dynamic: bool | None = None) -> list[tuple[str, float, str]]:
        """Retorna [(label, score 0..1, category)]. prefer_dynamic: filtra/penaliza."""
        if not self.ok or user_emb is None:
            return []
        u = user_emb / (np.linalg.norm(user_emb) + 1e-6)
        sims = self.Vn @ u                                   # (N,) ∈ [-1,1]
        scores = (sims + 1.0) / 2.0                          # → [0,1]

        # Penalizar mismatch dinámica/estática
        if prefer_dynamic is not None:
            mismatch = (self.is_dynamic != prefer_dynamic)
            scores = scores * np.where(mismatch, 0.85, 1.0)

        idx = np.argsort(-scores)[:k]
        return [(self.labels[i], float(scores[i]), self.categories[i]) for i in idx]


# ---------------------------------------------------------------------
# Buffer rodante de frames (manos) — lock-free snapshot para hilos
# ---------------------------------------------------------------------
BUFFER_SECONDS = 2.5
BUFFER_MAX = 75  # max frames absolutos (~2.5s a 30fps)

class FrameBuffer:
    def __init__(self):
        self.frames: deque = deque(maxlen=BUFFER_MAX)
        self.lock = threading.Lock()

    def add(self, hands_np: np.ndarray):
        now = time.time()
        with self.lock:
            self.frames.append((now, hands_np))
            # limpiar frames muy viejos
            while self.frames and now - self.frames[0][0] > BUFFER_SECONDS:
                self.frames.popleft()

    def clear(self):
        with self.lock:
            self.frames.clear()

    def snapshot(self, max_frames: int = 45) -> np.ndarray:
        """Devuelve array (T, 2, 21, 3) — copia para uso seguro en hilo."""
        with self.lock:
            if not self.frames:
                return np.zeros((0, 2, 21, 3), dtype=np.float32)
            arrs = [f for _, f in self.frames]
        if len(arrs) > max_frames:
            idx = np.linspace(0, len(arrs)-1, max_frames, dtype=int)
            arrs = [arrs[i] for i in idx]
        return np.stack(arrs).astype(np.float32)  # (T,2,21,3)

    def __len__(self):
        return len(self.frames)


# ---------------------------------------------------------------------
# Núcleo: procesamiento en hilos background para no bloquear el loop
# ---------------------------------------------------------------------
class LiveRecognizer:
    def __init__(self, templates: list[_Tpl], matcher: 'EmbeddingMatcher | None' = None):
        self.tpls = templates
        self.matcher = matcher
        self.buf = FrameBuffer()
        self.motion_tracker = MotionTracker()
        self.history: deque = deque(maxlen=10)

        # Resultados cacheados (escritos por hilos bg, leídos por main)
        self._emb_results: list = []
        self._dtw_results: list = []
        self._emb_lock = threading.Lock()
        self._dtw_lock = threading.Lock()

        # Control de hilos
        self._emb_running = False
        self._dtw_running = False
        self._emb_period = 0.12   # lanzar embedding cada ~120ms
        self._dtw_period = 0.35   # lanzar DTW cada ~350ms
        self._last_emb_t = 0.0
        self._last_dtw_t = 0.0

        # DTW: filtro de plantillas si hay modo alfanum
        self._allowed: set | None = None
        self._tpls_filtered: list[_Tpl] = templates

    def set_allowed(self, labels: set | frozenset | None):
        """Filtrar plantillas DTW al mismo subconjunto que el matcher."""
        self._allowed = labels
        if labels:
            self._tpls_filtered = [t for t in self.tpls if t.label in labels]
        else:
            self._tpls_filtered = self.tpls

    # ---- API pública: llamada en cada frame (hilo principal) -----------
    def feed(self, lms_obj, hands_raw: np.ndarray) -> dict:
        ts = time.time()
        self.buf.add(hands_raw)
        self.motion_tracker.feed(lms_obj, ts)
        has_motion = self.motion_tracker.has_oscillation()

        # --- Reglas estáticas (baratas, en hilo principal) ---
        states = finger_states(lms_obj)
        letter, letter_score = None, 0.0
        if states is not None:
            letter, letter_score = detect_best_letter(states, has_motion=has_motion)
            letter_score = max(0.0, min(1.0, letter_score))

        fp_now = _quick_finger_print(hands_raw[0])

        # --- Lanzar hilos background (solo si no hay uno corriendo) ---
        n = len(self.buf)
        if (not self._emb_running and self.matcher and self.matcher.ok
                and ts - self._last_emb_t >= self._emb_period and n >= 6):
            self._emb_running = True
            self._last_emb_t = ts
            snap = self.buf.snapshot(max_frames=30)
            threading.Thread(target=self._bg_emb, args=(snap,), daemon=True).start()

        if (not self._dtw_running
                and ts - self._last_dtw_t >= self._dtw_period and n >= 8):
            self._dtw_running = True
            self._last_dtw_t = ts
            snap = self.buf.snapshot(max_frames=25)
            threading.Thread(target=self._bg_dtw, args=(snap, fp_now), daemon=True).start()

        # --- Leer resultados cacheados ---
        with self._emb_lock:
            emb_res = list(self._emb_results)
        with self._dtw_lock:
            dtw_res = list(self._dtw_results)

        # --- Fusión ---
        candidates: list[tuple[str, float, str]] = []
        if letter and letter_score > 0.42:
            candidates.append((letter, letter_score, 'letra'))

        emb_map = {l: (s, c) for l, s, c in emb_res}
        dtw_map = {l: (s, c) for l, s, c in dtw_res}
        for lbl in set(emb_map) | set(dtw_map):
            es, ec = emb_map.get(lbl, (0.0, ''))
            ds, dc = dtw_map.get(lbl, (0.0, ''))
            cat = ec or dc
            if es > 0 and ds > 0:
                score = 0.55 * es + 0.35 * ds + 0.10
            elif es > 0:
                score = 0.88 * es
            else:
                score = 0.78 * ds
            candidates.append((lbl, min(score, 1.0), cat))

        candidates.sort(key=lambda x: -x[1])
        best = candidates[0] if candidates else (None, 0.0, '-')
        self.history.append((best[0], best[1]))

        if best[0] is not None:
            consistency = sum(1 for h in self.history if h[0] == best[0]) / len(self.history)
            stable_score = best[1] * (0.45 + 0.55 * consistency)
        else:
            stable_score = 0.0

        return {
            'label': best[0],
            'score': stable_score,
            'raw_score': best[1],
            'source': best[2],
            'has_motion': has_motion,
            'topk': candidates[:5],
            'letter': letter,
            'letter_score': letter_score,
            'buffer_frames': n,
        }

    # ---- Hilos background -------------------------------------------
    def _bg_emb(self, snap: np.ndarray):
        """Calcula embedding kNN en hilo separado."""
        try:
            hands_list = [snap[i] for i in range(snap.shape[0])]
            user_emb = _compute_user_embedding(hands_list)
            h0 = snap[:, 0]  # mano dominante
            if h0.size > 0:
                flat = h0.reshape(h0.shape[0], -1)
                scale = float(np.mean(np.linalg.norm(flat, axis=1))) or 1e-6
                diffs = np.linalg.norm(np.diff(flat, axis=0), axis=1) / scale if flat.shape[0] > 1 else np.array([0.0])
                motion = float(np.mean(diffs))
            else:
                motion = 0.0
            prefer_dyn = motion > 0.05
            res = self.matcher.topk(user_emb, k=5, prefer_dynamic=prefer_dyn)
            with self._emb_lock:
                self._emb_results = res
        finally:
            self._emb_running = False

    def _bg_dtw(self, snap: np.ndarray, fp_now: tuple):
        """Calcula DTW en hilo separado."""
        try:
            h0 = snap[:, 0]  # mano dominante (T,21,3)
            if h0.shape[0] < 8:
                return
            flat = h0.reshape(h0.shape[0], -1)  # (T,63)
            scale = float(np.mean(np.linalg.norm(flat, axis=1))) or 1e-6
            user_seq = flat / scale  # normalizado
            if len(user_seq) > 25:
                idx = np.linspace(0, len(user_seq)-1, 25, dtype=int)
                user_seq = user_seq[idx]

            flat2 = h0.reshape(h0.shape[0], -1)
            if flat2.shape[0] > 1:
                diffs = np.linalg.norm(np.diff(flat2, axis=0), axis=1)
                motion = float(np.mean(diffs)) / (scale or 1e-6)
            else:
                motion = 0.0
            is_static = motion < 0.04

            results = []
            for tpl in self._tpls_filtered:
                match = sum(1 for a, b in zip(fp_now, tpl.finger_print) if a == b) / 5.0
                if match < 0.4:
                    continue
                motion_match = 1.0 if (tpl.static == is_static) else 0.65
                tpl_seq = tpl.vec_seq
                if len(tpl_seq) > 25:
                    idx = np.linspace(0, len(tpl_seq)-1, 25, dtype=int)
                    tpl_seq = tpl_seq[idx]
                d = dtw_distance(user_seq, tpl_seq)
                norm = d / max(min(len(user_seq), len(tpl_seq)), 1)
                score = float(np.exp(-1.5 * norm)) * motion_match * (0.7 + 0.3 * match)
                results.append((tpl.label, score, tpl.category))

            results.sort(key=lambda x: -x[1])
            with self._dtw_lock:
                self._dtw_results = results[:5]
        finally:
            self._dtw_running = False


# ---------------------------------------------------------------------
# Dibujo
# ---------------------------------------------------------------------
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(17,18),(18,19),(19,20),
    (0,17),
]

def draw_hand(frame, hands_np, color=(0, 255, 0)):
    h, w = frame.shape[:2]
    for hi in range(hands_np.shape[0]):
        hand = hands_np[hi]
        if np.allclose(hand, 0):
            continue
        for a, b in HAND_CONNECTIONS:
            pa = (int(hand[a,0]*w), int(hand[a,1]*h))
            pb = (int(hand[b,0]*w), int(hand[b,1]*h))
            cv2.line(frame, pa, pb, color, 2)
        for p in hand:
            cv2.circle(frame, (int(p[0]*w), int(p[1]*h)), 3, (255,255,255), -1)


def draw_hud(frame, pred: dict, fps: float, alfanum_mode: bool = False):
    h, w = frame.shape[:2]
    # Caja superior
    cv2.rectangle(frame, (0,0), (w, 92), (0,0,0), -1)
    label = pred.get('label') or '---'
    score = pred.get('score', 0.0)
    src   = pred.get('source', '-')
    # Label grande
    txt = f"{label}"
    pct = f"{int(score*100)}%  [{src}]"
    color = (0,255,80) if score > 0.65 else (0,220,255) if score > 0.45 else (80,140,255)
    cv2.putText(frame, txt, (16, 55), cv2.FONT_HERSHEY_DUPLEX, 1.6, color, 2)
    cv2.putText(frame, pct, (16, 82), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
    cv2.putText(frame, f"FPS {fps:.0f}   buf {pred.get('buffer_frames',0)}",
                (w-170, 82), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160,160,160), 1)
    if pred.get('has_motion'):
        cv2.putText(frame, "MOV", (w-60, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,200,255), 2)
    # Modo alfanum
    if alfanum_mode:
        cv2.putText(frame, "A-Z  1-20", (w-155, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0,255,255), 2)
    # Top-K — ordenar: en modo alfanum, letras primero luego números
    topk = list(pred.get('topk', []))
    if alfanum_mode and topk:
        topk_sorted = sorted(topk, key=lambda x: (ALFANUM_SORT_KEY.get(x[0], 999), -x[1]))
        # Pero mantener el mejor score como primero en la lista visual
        topk = sorted(topk, key=lambda x: -x[1])
    for i, (lbl, sc, cat) in enumerate(topk[:5]):
        y = 115 + i * 27
        bar_w = int(sc * 160)
        cv2.rectangle(frame, (16, y-14), (16+bar_w, y+4), (40,80,40), -1)
        cv2.putText(frame, f"{lbl:<10}  {int(sc*100):>3}%",
                    (22, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (240,240,240), 1)
    # Ayuda
    ayuda = "Q=salir  R=reset  T=topK  A=modo-todos" if alfanum_mode else "Q=salir  R=reset  T=topK  A=alfabeto+nums"
    cv2.putText(frame, ayuda, (16, h-14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (130,130,130), 1)


# ---------------------------------------------------------------------
# Compat helper (objetos .x .y .z para finger_states)
# ---------------------------------------------------------------------
class _LM:
    __slots__ = ('x','y','z')
    def __init__(self, lm):
        self.x, self.y, self.z = lm.x, lm.y, lm.z


def _open_camera(idx=0):
    backends = []
    if hasattr(cv2, 'CAP_DSHOW'):
        backends.append(cv2.CAP_DSHOW)
    backends.append(cv2.CAP_ANY)
    for be in backends:
        cap = cv2.VideoCapture(idx, be)
        if cap.isOpened():
            return cap
    return cv2.VideoCapture(idx)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
def main():
    global hand_landmarker
    
    import argparse
    parser = argparse.ArgumentParser(description='Reconocimiento de LSM en tiempo real')
    parser.add_argument('--alfanum', action='store_true', help='Modo alfabeto+números 1-20 solo')
    parser.add_argument('--cpu', action='store_true', help='Forzar CPU (sin intentar GPU)')
    args = parser.parse_args()
    
    print("="*60)
    print("  LIVE RECOGNIZER — LSM en vivo (GPU, alta calidad)")
    print("="*60)
    
    # Inicializar MediaPipe HandLandmarker (con GPU si disponible)
    hand_landmarker = create_hand_landmarker_gpu(prefer_gpu=not args.cpu)

    # Modo alfabeto+números
    alfanum_mode = args.alfanum
    allowed = ALFABETO_NUMEROS_1_20 if alfanum_mode else None
    
    templates = load_all_templates()
    matcher = EmbeddingMatcher(allowed_labels=allowed)
    recognizer = LiveRecognizer(templates, matcher=matcher)
    recognizer.set_allowed(allowed)
    
    if alfanum_mode:
        print(f"[MODO] Alfabeto A-Z + Números 1-20 ({len(ALFABETO_NUMEROS_1_20)} señas)")
    else:
        print(f"[MODO] Completo (350 señas del Glosario CDMX)")

    cap = _open_camera(0)
    if not cap.isOpened():
        print("[ERR] No se pudo abrir la cámara"); return
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    win = "Live LSM - GPU High Quality"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    show_topk = True
    prev_t = time.perf_counter()
    fps = 0.0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = hand_landmarker.detect(mp_image)

        pred = {'label': None, 'score': 0.0, 'topk': [], 'buffer_frames': len(recognizer.buf.frames)}

        if result.hand_landmarks:
            # Construir array (2,21,3) y lista objetos para finger_states
            hands_np = np.zeros((2, 21, 3), dtype=np.float32)
            for hi, h in enumerate(result.hand_landmarks[:2]):
                for j, lm in enumerate(h):
                    hands_np[hi, j] = [lm.x, lm.y, lm.z]
            lms_obj = [_LM(lm) for lm in result.hand_landmarks[0]]
            pred = recognizer.feed(lms_obj, hands_np)
            draw_hand(frame, hands_np)

        # FPS
        now = time.perf_counter()
        dt = now - prev_t; prev_t = now
        if dt > 0:
            fps = 0.9 * fps + 0.1 * (1.0/dt)

        if not show_topk:
            pred = {**pred, 'topk': []}

        draw_hud(frame, pred, fps, alfanum_mode)
        cv2.imshow(win, frame)
        k = cv2.waitKey(1) & 0xFF
        if k in (ord('q'), 27):
            break
        elif k == ord('r'):
            recognizer.buf.clear()
            recognizer.history.clear()
            with recognizer._emb_lock:
                recognizer._emb_results = []
            with recognizer._dtw_lock:
                recognizer._dtw_results = []
            print("[reset]")
        elif k == ord('t'):
            show_topk = not show_topk
        elif k == ord('a'):
            # Toggle modo alfabeto
            alfanum_mode = not alfanum_mode
            allowed = ALFABETO_NUMEROS_1_20 if alfanum_mode else None
            new_matcher = EmbeddingMatcher(allowed_labels=allowed)
            recognizer.matcher = new_matcher
            recognizer.set_allowed(allowed)
            with recognizer._emb_lock:
                recognizer._emb_results = []
            with recognizer._dtw_lock:
                recognizer._dtw_results = []
            print(f"[MODO] {'Alfabeto+Números (A-Z, 1-20)' if alfanum_mode else 'Completo (350 señas)'}")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
