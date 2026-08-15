#!/usr/bin/env python3
"""LSM Words Teacher — practica de palabras/expresiones en LSM.

Usa comparacion DTW de secuencias de landmarks contra las plantillas
NPZ del glosario CDMX (data/templates/).  Identical UI to lsm_teacher.py.

Uso:
    python backend/lsm_words_teacher.py
    python backend/lsm_words_teacher.py --category expresiones-cotidianas
    python backend/lsm_words_teacher.py --word GRACIAS

Controles:
    N / SPACE = siguiente palabra
    B         = palabra anterior
    R         = reiniciar MANTEN
    K         = pausa
    Q / ESC   = salir
"""
from __future__ import annotations

import os
import sys
import time
import json
import math
import argparse
from pathlib import Path
from collections import deque

import cv2
import numpy as np
import mediapipe as mp

sys.path.insert(0, str(Path(__file__).resolve().parent))
from main import (  # noqa: E402
    GestureState,
    HAND_CONNS,
    GESTURE_MODEL,
    BaseOptions, GestureRecognizer, GestureRecognizerOptions,
    VisionRunningMode,
    _open_camera,
)

# ======================================================================
#  Rutas
# ======================================================================
_ROOT        = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = _ROOT / "data" / "templates"
VIDEOS_DIR    = _ROOT / "data" / "training_videos"
GIFS_DIR      = _ROOT / "data" / "gifs" / "words"
PROGRESS_DIR  = str(_ROOT / "data" / "recordings")
PROGRESS_PATH = str(_ROOT / "data" / "recordings" / ".words_progress.json")

GIFS_DIR.mkdir(parents=True, exist_ok=True)

# ======================================================================
#  Colores BGR (tema oscuro, mismo que lsm_teacher.py)
# ======================================================================
BG_DARK    = (22, 22, 26)
PANEL_DARK = (34, 34, 40)
PANEL_MID  = (50, 50, 58)
BORDER_COL = (95, 95, 108)
TXT_MAIN   = (245, 245, 245)
TXT_DIM    = (180, 180, 190)
TXT_FAINT  = (130, 130, 140)
USER_COL   = (240, 200, 80)
NODE_COL   = (255, 255, 255)
OK_COL     = (110, 220, 135)
BAD_COL    = (90, 90, 240)
ACCENT_COL = (0, 180, 240)

# ======================================================================
#  Parametros de reconocimiento
# ======================================================================
DTW_THRESHOLD   = 0.55   # similaridad DTW normalizada [0-1] para avanzar
HOLD_SECONDS    = 1.2    # segundos manteniendo coincidencia para avanzar
SEQ_WINDOW      = 60     # frames maximos en el buffer de captura
MIN_SEQ_FRAMES  = 20     # minimo de frames para evaluar DTW
GIF_FPS         = 10.0   # velocidad de animacion de los GIFs

# ======================================================================
#  Curriculum de palabras
# ======================================================================
# Cada entrada: (slug, display_name, categoria, hint, youtube_id_para_gif)
# slug debe coincidir con el nombre del archivo NPZ en data/templates/<cat>/
WORDS_CURRICULUM = [
    # Expresiones cotidianas (ya descargadas en data/templates/expresiones-cotidianas/)
    ("POR_FAVOR",      "POR FAVOR",        "expresiones-cotidianas",
     "Mano abierta, palma hacia arriba; muevela de tu pecho hacia adelante.",
     "POR_FAVOR"),
    ("DISCULPA",       "DISCULPA",         "expresiones-cotidianas",
     "Mano derecha en forma de D, golpea el dorso de la mano izquierda dos veces.",
     "DISCULPA"),
    ("COMO_ESTAS_2",   "¿COMO ESTAS?",     "expresiones-cotidianas",
     "Mano abierta apuntando hacia la persona; luego dobla los dedos hacia ti preguntando.",
     "COMO_ESTAS_2"),
    ("COMO_TE_LLAMAS", "¿COMO TE LLAMAS?", "expresiones-cotidianas",
     "Combinacion de como + senal apuntando a la persona + nombre.",
     "COMO_TE_LLAMAS"),
    ("SORPRESA",       "¡SORPRESA!",       "expresiones-cotidianas",
     "Manos cerradas frente a los ojos; abrir rapidamente los dedos.",
     "SORPRESA"),
    ("QUE_MILAGRO",    "¡QUE MILAGRO!",    "expresiones-cotidianas",
     "Expresion de sorpresa: manos abiertas frente al pecho, luego separarlas hacia los lados.",
     "QUE_MILAGRO"),
    # Familia
    ("MAMA",           "MAMA",             "familia",
     "Mano en M tocando la mejilla derecha.",
     "MAMA"),
    ("PAPA",           "PAPA",             "familia",
     "Mano en P tocando la frente.",
     "PAPA"),
    ("AMIGO",          "AMIGO",            "familia",
     "Dos indices entrelazados, primero uno arriba y luego el otro.",
     "AMIGO"),
    ("FAMILIA",        "FAMILIA",          "familia",
     "Ambas manos en F formando un circulo.",
     "FAMILIA"),
]

# Solo incluir entradas que tengan plantilla NPZ disponible
def _available_words() -> list:
    result = []
    seen = set()
    for entry in WORDS_CURRICULUM:
        slug, display, cat, hint, gif_slug = entry
        if slug in seen:
            continue
        npz_path = TEMPLATES_DIR / cat / f"{slug}.npz"
        if npz_path.exists():
            result.append(entry)
            seen.add(slug)
        else:
            print(f"  [SKIP] {display}: no hay plantilla en {npz_path}")
    if not result:
        print("  [WARN] No se encontraron plantillas NPZ. "
              "Ejecuta download_glosario_videos.py primero.")
    return result


# ======================================================================
#  DTW — comparacion de secuencias de landmarks
# ======================================================================
def _seq_to_feat(seq: list) -> np.ndarray:
    """Convierte lista de arrays (21,3) o (42,3) a features normalizadas."""
    out = []
    for lm in seq:
        flat = np.asarray(lm, dtype=np.float32).flatten()
        norm = np.linalg.norm(flat)
        out.append(flat / (norm + 1e-9))
    return np.array(out, dtype=np.float32)


def _dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
    """DTW entre dos secuencias (Ta,D) y (Tb,D). Retorna distancia media."""
    Ta, Tb = len(a), len(b)
    cost = np.full((Ta, Tb), np.inf, dtype=np.float64)
    cost[0, 0] = np.linalg.norm(a[0] - b[0])
    for i in range(1, Ta):
        cost[i, 0] = cost[i-1, 0] + np.linalg.norm(a[i] - b[0])
    for j in range(1, Tb):
        cost[0, j] = cost[0, j-1] + np.linalg.norm(a[0] - b[j])
    for i in range(1, Ta):
        for j in range(1, Tb):
            d = np.linalg.norm(a[i] - b[j])
            cost[i, j] = d + min(cost[i-1, j], cost[i, j-1], cost[i-1, j-1])
    return float(cost[-1, -1]) / (Ta + Tb)


def _active_segment(hands_raw: np.ndarray, pad: int = 4) -> tuple[int, int]:
    """Detecta el rango de frames con movimiento real usando hands_raw (T,2,21,3).
    Usa la wrist (punto 0) de ambas manos. Retorna (start, end) inclusive."""
    # Combinar movimiento de ambas manos: tomar el maximo entre ellas por frame
    wrist0 = hands_raw[:, 0, 0, :]   # (T, 3)
    wrist1 = hands_raw[:, 1, 0, :]   # (T, 3)
    motion0 = np.linalg.norm(np.diff(wrist0, axis=0), axis=1)  # (T-1,)
    motion1 = np.linalg.norm(np.diff(wrist1, axis=0), axis=1)
    motion = np.maximum(motion0, motion1)
    thr = max(motion.mean() * 0.3, 1e-4)
    active = np.where(motion > thr)[0]
    if len(active) == 0:
        return 0, len(hands_raw) - 1
    start = max(0, int(active.min()) - pad)
    end   = min(len(hands_raw) - 1, int(active.max()) + pad + 1)
    return start, end


def load_template(slug: str, cat: str) -> dict | None:
    """Carga el template NPZ. Retorna dict con:
      'seq': (T, 42, 3)  — ambas manos concatenadas, segmento activo
      'seg': (start, end) en el video original
    """
    path = TEMPLATES_DIR / cat / f"{slug}.npz"
    if not path.exists():
        return None
    try:
        data = np.load(str(path), allow_pickle=True)
        if 'hands_raw' not in data or 'hands' not in data:
            return None
        hands_raw = data['hands_raw'].astype(np.float32)  # (T, 2, 21, 3)
        hands_norm = data['hands'].astype(np.float32)     # (T, 2, 21, 3)
        start, end = _active_segment(hands_raw)
        seg = hands_norm[start:end]   # (S, 2, 21, 3)
        # Concatenar ambas manos -> (S, 42, 3)
        combined = np.concatenate([seg[:, 0], seg[:, 1]], axis=1)  # (S, 42, 3)
        return {'seq': combined, 'seg': (start, end), 'fps': float(data['fps'][0])}
    except Exception as e:
        print(f"  [WARN] No se pudo cargar {path}: {e}")
        return None


def score_sequence(captured_h0: list, captured_h1: list,
                   template: dict | None) -> float:
    """Retorna similaridad [0,1] usando ambas manos.
    captured_h0/h1: listas de arrays (21,3) por frame para cada mano.
    """
    if template is None:
        return 0.0
    tpl_seq = template['seq']   # (S, 42, 3)
    n = max(len(captured_h0), len(captured_h1))
    if n < MIN_SEQ_FRAMES:
        return 0.0
    # Combinar manos capturadas: si una esta vacia, usar ceros
    T = max(len(captured_h0), len(captured_h1))
    h0 = captured_h0 if len(captured_h0) == T else captured_h0 + [np.zeros((21,3), np.float32)] * (T - len(captured_h0))
    h1 = captured_h1 if len(captured_h1) == T else captured_h1 + [np.zeros((21,3), np.float32)] * (T - len(captured_h1))
    combined = [np.concatenate([h0[i], h1[i]], axis=0) for i in range(T)]  # list of (42,3)
    cap_feat = _seq_to_feat(combined)
    # Resamplear template al mismo N de frames
    idx = np.linspace(0, len(tpl_seq) - 1, T).astype(int)
    tpl_feat = _seq_to_feat([tpl_seq[i] for i in idx])
    dist = _dtw_distance(cap_feat, tpl_feat)
    score = math.exp(-dist * 5.0)
    return float(np.clip(score, 0.0, 1.0))


# ======================================================================
#  GIFs animados  (data/gifs/words/<slug>.gif)
# ======================================================================
_GIF_CACHE: dict = {}


def load_gif_frames(slug: str) -> list:
    if slug in _GIF_CACHE:
        return _GIF_CACHE[slug]
    path = GIFS_DIR / f"{slug}.gif"
    if not path.exists():
        # Intentar generar GIF desde el video de entrenamiento
        _try_make_gif(slug)
    if not path.exists():
        _GIF_CACHE[slug] = []
        return []
    try:
        from PIL import Image
        gif = Image.open(str(path))
        frames = []
        try:
            while True:
                bgr = cv2.cvtColor(np.array(gif.convert('RGB'), dtype=np.uint8),
                                   cv2.COLOR_RGB2BGR)
                frames.append(bgr)
                gif.seek(gif.tell() + 1)
        except EOFError:
            pass
        _GIF_CACHE[slug] = frames
        return frames
    except Exception:
        _GIF_CACHE[slug] = []
        return []


def _find_video(slug: str) -> Path | None:
    """Busca el video MP4 del slug en cualquier categoria."""
    for cat_dir in VIDEOS_DIR.iterdir():
        if not cat_dir.is_dir():
            continue
        candidate = cat_dir / f"{slug}.mp4"
        if candidate.exists():
            return candidate
    return None


def _try_make_gif(slug: str, cat: str | None = None):
    """Genera GIF animado desde el segmento activo del video MP4.
    Si hay NPZ disponible, recorta al segmento con movimiento real."""
    video_path = _find_video(slug)
    if video_path is None:
        return
    # Intentar cargar el segmento activo del NPZ
    seg_start, seg_end = 0, None
    video_fps = 15.0
    if cat:
        npz_path = TEMPLATES_DIR / cat / f"{slug}.npz"
        if npz_path.exists():
            try:
                data = np.load(str(npz_path), allow_pickle=True)
                if 'hands_raw' in data:
                    start, end = _active_segment(data['hands_raw'].astype(np.float32))
                    seg_start, seg_end = start, end
                if 'fps' in data:
                    video_fps = float(data['fps'][0])
            except Exception:
                pass
    try:
        from PIL import Image
        cap = cv2.VideoCapture(str(video_path))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if seg_end is None:
            seg_end = total
        seg_len = seg_end - seg_start
        target_frames = 20
        step = max(1, seg_len // target_frames)
        frames_pil = []
        cap.set(cv2.CAP_PROP_POS_FRAMES, seg_start)
        i = 0
        while cap.isOpened():
            ok, frm = cap.read()
            if not ok:
                break
            frame_pos = seg_start + i
            if frame_pos >= seg_end:
                break
            if i % step == 0:
                small = cv2.resize(frm, (200, 150))
                rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
                frames_pil.append(Image.fromarray(rgb))
                if len(frames_pil) >= target_frames:
                    break
            i += 1
        cap.release()
        if frames_pil:
            out_path = GIFS_DIR / f"{slug}.gif"
            frames_pil[0].save(
                str(out_path), save_all=True,
                append_images=frames_pil[1:],
                loop=0, duration=int(1000 / GIF_FPS), optimize=False,
            )
            print(f"  [GIF] Generado ({len(frames_pil)} frames, seg {seg_start}-{seg_end}): {out_path.name}")
    except Exception as e:
        print(f"  [WARN] No se pudo generar GIF para {slug}: {e}")


def get_gif_frame(slug: str, t: float) -> np.ndarray | None:
    frames = load_gif_frames(slug)
    if not frames:
        return None
    idx = int(t * GIF_FPS) % len(frames)
    return frames[idx]


def place_image(dst, src, x1, y1, x2, y2, bg_pad=6):
    if src is None or src.size == 0:
        return
    H, W = src.shape[:2]
    area_w = (x2 - x1) - bg_pad * 2
    area_h = (y2 - y1) - bg_pad * 2
    if area_w <= 0 or area_h <= 0:
        return
    sc = min(area_w / W, area_h / H)
    nw, nh = max(1, int(W * sc)), max(1, int(H * sc))
    resized = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_AREA)
    cx = x1 + bg_pad + (area_w - nw) // 2
    cy = y1 + bg_pad + (area_h - nh) // 2
    dst[cy:cy+nh, cx:cx+nw] = resized
    cv2.rectangle(dst, (cx - 2, cy - 2), (cx + nw + 1, cy + nh + 1),
                  BORDER_COL, 1, cv2.LINE_AA)


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
#  Dibujo de manos
# ======================================================================
def draw_user_hands(frame, state: GestureState):
    h, w = frame.shape[:2]
    for lms in state.hand_landmarks:
        pts = [(int(lm.x * w), int(lm.y * h)) for lm in lms]
        for a, b in HAND_CONNS:
            if a < len(pts) and b < len(pts):
                cv2.line(frame, pts[a], pts[b], USER_COL, 2, cv2.LINE_AA)
        for p in pts:
            cv2.circle(frame, p, 3, NODE_COL, -1, cv2.LINE_AA)


def _lms_to_np(lms) -> np.ndarray | None:
    if not lms or len(lms) < 21:
        return None
    return np.array([[p.x, p.y, p.z] for p in lms[:21]], dtype=np.float32)


def _wrap_text(text, max_w_px, font, font_scale, thickness):
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


# ======================================================================
#  Main loop
# ======================================================================
def run(category: str | None = None, word: str | None = None):
    if not os.path.exists(GESTURE_MODEL):
        print(f"[ERR] No se encontro {GESTURE_MODEL}. "
              f"Ejecuta:  python download_models.py")
        return

    # Cargar curriculum disponible
    curriculum = _available_words()
    if category:
        curriculum = [e for e in curriculum if e[2] == category]
    if word:
        curriculum = [e for e in curriculum if e[0].upper() == word.upper()
                      or e[1].upper() == word.upper()]
    if not curriculum:
        print(f"[ERR] No hay palabras disponibles con los filtros dados.")
        print(f"  Palabras disponibles:")
        for e in _available_words():
            print(f"    {e[1]}  ({e[2]})")
        return

    print(f"  Curriculum: {len(curriculum)} palabras")
    for e in curriculum:
        print(f"    - {e[1]}")

    # Cargar templates NPZ
    templates: dict[str, np.ndarray | None] = {}
    for slug, display, cat, hint, gif_slug in curriculum:
        templates[slug] = load_template(slug, cat)
        if templates[slug] is None:
            print(f"  [WARN] Sin plantilla para {display}")

    # Pre-generar GIFs (con segmento activo del NPZ)
    _gif_start = time.time()
    # Borrar GIFs viejos para regenerarlos con segmento correcto
    for slug, display, cat, hint, gif_slug in curriculum:
        old_gif = GIFS_DIR / f"{gif_slug}.gif"
        if old_gif.exists():
            old_gif.unlink()
        _try_make_gif(gif_slug, cat)
        load_gif_frames(gif_slug)

    progress = load_progress()

    # MediaPipe
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

    idx         = 0
    paused      = False
    hold_start  = None
    last_flash  = 0.0
    last_ts_ms  = 0
    fps_val     = 0.0
    prev_t      = time.perf_counter()
    need_release = False

    # Buffers separados por mano para DTW (ambas manos)
    seq_buf_h0: deque = deque(maxlen=SEQ_WINDOW)   # mano 0
    seq_buf_h1: deque = deque(maxlen=SEQ_WINDOW)   # mano 1

    WIN_TITLE = "LSM Teacher - Palabras"
    WIN_W, WIN_H = 1280, 720
    cv2.namedWindow(WIN_TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN_TITLE, WIN_W, WIN_H)

    print("\n  --- CONTROLES ---")
    print("  N / SPACE = siguiente palabra")
    print("  B         = palabra anterior")
    print("  R         = reiniciar MANTEN")
    print("  K         = pausa")
    print("  Q / ESC   = salir\n")

    while True:
        ok, raw = cap.read()
        if not ok:
            break
        cam = cv2.flip(raw, 1)
        cam_h, cam_w = cam.shape[:2]

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

        slug, display, cat, hint, gif_slug = curriculum[idx]
        lms_h0 = gstate.hand_landmarks[0] if len(gstate.hand_landmarks) > 0 else None
        lms_h1 = gstate.hand_landmarks[1] if len(gstate.hand_landmarks) > 1 else None
        arr0 = _lms_to_np(lms_h0)
        arr1 = _lms_to_np(lms_h1)
        arr  = arr0  # para UI: mano principal

        # Alimentar buffers por mano
        _zeros21 = np.zeros((21, 3), dtype=np.float32)
        if arr0 is not None:
            seq_buf_h0.append(arr0)
        else:
            seq_buf_h0.append(_zeros21)  # frame sin mano -> ceros
        if arr1 is not None:
            seq_buf_h1.append(arr1)
        else:
            seq_buf_h1.append(_zeros21)
        # Limpiar si no hay ninguna mano visible varios frames seguidos
        if arr0 is None and arr1 is None:
            seq_buf_h0.clear()
            seq_buf_h1.clear()

        # Puntaje DTW usando ambas manos
        tpl = templates.get(slug)
        my_score = score_sequence(list(seq_buf_h0), list(seq_buf_h1), tpl)
        is_match = (not paused) and (my_score >= DTW_THRESHOLD)

        # Hold-to-advance
        now = time.time()
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
            progress['best'][slug] = 100
            if slug not in progress.get('completed', []):
                progress.setdefault('completed', []).append(slug)
            save_progress(progress)
            idx = (idx + 1) % len(curriculum)
            hold_start = None
            last_flash = now
            need_release = True
            seq_buf_h0.clear()
            seq_buf_h1.clear()
            nxt = curriculum[idx][1]
            print(f"  [OK] {display} aprendida  ->  ahora: {nxt}")

        # ===== UI ============================================================
        frame = np.full((WIN_H, WIN_W, 3), BG_DARK, dtype=np.uint8)

        PAD    = 18
        TOP_H  = 58
        BOT_H  = 92
        LEFT_W = int(WIN_W * 0.34)

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

        # Barra superior
        cv2.rectangle(frame, (PAD, TOP_Y1), (WIN_W - PAD, TOP_Y2), PANEL_DARK, -1)
        cv2.rectangle(frame, (PAD, TOP_Y1), (WIN_W - PAD, TOP_Y2), BORDER_COL, 1, cv2.LINE_AA)
        cv2.putText(frame, "APRENDE PALABRAS EN LSM",
                    (PAD + 20, TOP_Y1 + 36),
                    cv2.FONT_HERSHEY_DUPLEX, 0.95, TXT_MAIN, 1, cv2.LINE_AA)

        done_count = sum(1 for e in curriculum if e[0] in progress.get('completed', []))
        prog_txt = (f"Palabra  {idx+1} / {len(curriculum)}     "
                    f"Aprendidas  {done_count} / {len(curriculum)}")
        (pw, _), _ = cv2.getTextSize(prog_txt, cv2.FONT_HERSHEY_PLAIN, 1.3, 1)
        cv2.putText(frame, prog_txt,
                    (WIN_W - PAD - 20 - pw, TOP_Y1 + 36),
                    cv2.FONT_HERSHEY_PLAIN, 1.3, TXT_DIM, 1, cv2.LINE_AA)

        # Panel izquierdo
        cv2.rectangle(frame, (LEFT_X1, LEFT_Y1), (LEFT_X2, LEFT_Y2), PANEL_DARK, -1)
        cv2.rectangle(frame, (LEFT_X1, LEFT_Y1), (LEFT_X2, LEFT_Y2), BORDER_COL, 1, cv2.LINE_AA)

        panel_pad = 16
        header_h  = 78
        desc_h    = 100
        header_y1 = LEFT_Y1 + panel_pad
        header_y2 = header_y1 + header_h
        tile_y1   = header_y2 + 10
        tile_y2   = LEFT_Y2 - panel_pad - desc_h - 10
        desc_y1   = tile_y2 + 10
        desc_y2   = LEFT_Y2 - panel_pad

        # Cabecera: nombre de la palabra grande
        word_scale = 1.2
        word_thick = 2
        # Ajustar escala si el nombre es muy largo
        (tw, th), _ = cv2.getTextSize(display, cv2.FONT_HERSHEY_DUPLEX,
                                       word_scale, word_thick)
        max_word_w = LEFT_X2 - LEFT_X1 - panel_pad * 2
        if tw > max_word_w:
            word_scale = word_scale * max_word_w / tw
            (tw, th), _ = cv2.getTextSize(display, cv2.FONT_HERSHEY_DUPLEX,
                                           word_scale, word_thick)
        word_color = OK_COL if is_match else TXT_MAIN
        word_x = LEFT_X1 + panel_pad + 6
        word_y = header_y1 + (header_h + th) // 2 - 4
        cv2.putText(frame, display, (word_x, word_y),
                    cv2.FONT_HERSHEY_DUPLEX, word_scale, word_color, word_thick,
                    cv2.LINE_AA)

        sub = f"Palabra  {idx+1:2d} / {len(curriculum)}"
        cv2.putText(frame, sub,
                    (word_x, header_y1 + 14),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, TXT_DIM, 1, cv2.LINE_AA)

        badge = "CON MOVIMIENTO"
        (mw, mh), _ = cv2.getTextSize(badge, cv2.FONT_HERSHEY_PLAIN, 1.1, 1)
        mx = LEFT_X1 + panel_pad + 6
        my = header_y2 - 6
        cv2.rectangle(frame, (mx - 7, my - mh - 5), (mx + mw + 7, my + 6),
                      ACCENT_COL, 1, cv2.LINE_AA)
        cv2.putText(frame, badge, (mx, my),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, ACCENT_COL, 1, cv2.LINE_AA)

        # Tarjeta GIF
        gif_frame = get_gif_frame(gif_slug, now - _gif_start)
        tile_x1 = LEFT_X1 + panel_pad
        tile_x2 = LEFT_X2 - panel_pad
        tile_bg = (18, 18, 22) if gif_frame is not None else PANEL_MID
        cv2.rectangle(frame, (tile_x1, tile_y1), (tile_x2, tile_y2), tile_bg, -1)
        cv2.rectangle(frame, (tile_x1, tile_y1), (tile_x2, tile_y2), BORDER_COL, 1, cv2.LINE_AA)
        if gif_frame is not None:
            place_image(frame, gif_frame,
                        tile_x1 + 6, tile_y1 + 6,
                        tile_x2 - 6, tile_y2 - 6, bg_pad=4)
        else:
            msg = "(video de referencia no disponible)"
            (mw2, mh2), _ = cv2.getTextSize(msg, cv2.FONT_HERSHEY_PLAIN, 1.0, 1)
            cv2.putText(frame, msg,
                        (tile_x1 + ((tile_x2 - tile_x1) - mw2) // 2,
                         tile_y1 + ((tile_y2 - tile_y1) + mh2) // 2),
                        cv2.FONT_HERSHEY_PLAIN, 1.0, TXT_FAINT, 1, cv2.LINE_AA)

        # Descripcion al pie
        max_txt_w = (LEFT_X2 - LEFT_X1) - panel_pad * 2 - 12
        desc_y = desc_y1 + 22
        cv2.putText(frame, "COMO HACERLA",
                    (LEFT_X1 + panel_pad + 2, desc_y1 + 14),
                    cv2.FONT_HERSHEY_PLAIN, 0.95, TXT_FAINT, 1, cv2.LINE_AA)
        for line in _wrap_text(hint, max_txt_w, cv2.FONT_HERSHEY_PLAIN, 1.15, 1):
            cv2.putText(frame, line,
                        (LEFT_X1 + panel_pad + 2, desc_y),
                        cv2.FONT_HERSHEY_PLAIN, 1.15, TXT_MAIN, 1, cv2.LINE_AA)
            desc_y += 22
            if desc_y > desc_y2 - 4:
                break

        # Panel derecho: camara
        cv2.rectangle(frame, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2), (0, 0, 0), -1)
        draw_user_hands(cam, gstate)
        area_w = CAM_X2 - CAM_X1
        area_h = CAM_Y2 - CAM_Y1
        sc = min(area_w / cam_w, area_h / cam_h)
        new_w, new_h = int(cam_w * sc), int(cam_h * sc)
        cam_r = cv2.resize(cam, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        cx = CAM_X1 + (area_w - new_w) // 2
        cy = CAM_Y1 + (area_h - new_h) // 2
        frame[cy:cy+new_h, cx:cx+new_w] = cam_r

        # Borde camara segun estado
        border_col = OK_COL if is_match else (BAD_COL if arr is not None else BORDER_COL)
        cv2.rectangle(frame, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2),
                      border_col, 2, cv2.LINE_AA)

        # Destello verde
        if (now - last_flash) < 0.35:
            k = 1.0 - ((now - last_flash) / 0.35)
            ov = frame.copy()
            cv2.rectangle(ov, (CAM_X1, CAM_Y1), (CAM_X2, CAM_Y2), OK_COL, -1)
            cv2.addWeighted(ov, 0.22 * k, frame, 1 - 0.22 * k, 0, frame)

        # Score en tiempo real dentro de la camara
        if arr is not None:
            score_pct = int(my_score * 100)
            score_col = OK_COL if is_match else TXT_MAIN
            score_txt = f"SIMILITUD  {score_pct}%"
            (sw, sh), _ = cv2.getTextSize(score_txt, cv2.FONT_HERSHEY_DUPLEX, 0.7, 1)
            sx, sy = CAM_X1 + 16, CAM_Y1 + 16 + sh
            ov2 = frame.copy()
            cv2.rectangle(ov2, (sx - 10, sy - sh - 10), (sx + sw + 10, sy + 8),
                          (15, 15, 20), -1)
            cv2.addWeighted(ov2, 0.70, frame, 0.30, 0, frame)
            cv2.rectangle(frame, (sx - 10, sy - sh - 10), (sx + sw + 10, sy + 8),
                          BORDER_COL, 1, cv2.LINE_AA)
            cv2.putText(frame, score_txt, (sx, sy),
                        cv2.FONT_HERSHEY_DUPLEX, 0.7, score_col, 1, cv2.LINE_AA)

            # Indicador de frames capturados
            buf_txt = f"Buffer: {max(len(seq_buf_h0), len(seq_buf_h1))}/{MIN_SEQ_FRAMES} frames"
            cv2.putText(frame, buf_txt, (sx, sy + sh + 12),
                        cv2.FONT_HERSHEY_PLAIN, 1.0, TXT_FAINT, 1, cv2.LINE_AA)

        # Barra inferior: estado + HOLD + controles
        cv2.rectangle(frame, (PAD, BOT_Y1), (WIN_W - PAD, BOT_Y2), PANEL_DARK, -1)
        cv2.rectangle(frame, (PAD, BOT_Y1), (WIN_W - PAD, BOT_Y2), BORDER_COL, 1, cv2.LINE_AA)

        if paused:
            status, scol = "PAUSADO", TXT_DIM
        elif is_match:
            status, scol = "COINCIDE - MANTEN LA POSE", OK_COL
        elif arr0 is None and arr1 is None:
            status, scol = "MUESTRA TU MANO A LA CAMARA", TXT_FAINT
        elif max(len(seq_buf_h0), len(seq_buf_h1)) < MIN_SEQ_FRAMES:
            status = f"CAPTURANDO MOVIMIENTO... {max(len(seq_buf_h0), len(seq_buf_h1))}/{MIN_SEQ_FRAMES}"
            scol = ACCENT_COL
        else:
            status, scol = "IMITA LA SEÑA DE LA IZQUIERDA", BAD_COL

        cv2.putText(frame, status, (PAD + 20, BOT_Y1 + 30),
                    cv2.FONT_HERSHEY_DUPLEX, 0.75, scol, 1, cv2.LINE_AA)

        # Barra HOLD
        hb_x1 = PAD + 20
        hb_x2 = PAD + 20 + int((WIN_W - 2*PAD - 40) * 0.52)
        hb_y1 = BOT_Y1 + 46
        hb_y2 = BOT_Y1 + 62
        cv2.rectangle(frame, (hb_x1, hb_y1), (hb_x2, hb_y2), PANEL_MID, -1)
        cv2.rectangle(frame, (hb_x1, hb_y1),
                      (hb_x1 + int((hb_x2 - hb_x1) * hold_pct), hb_y2),
                      OK_COL, -1)
        cv2.rectangle(frame, (hb_x1, hb_y1), (hb_x2, hb_y2), BORDER_COL, 1, cv2.LINE_AA)
        cv2.putText(frame, f"MANTEN  {int(hold_pct*100):3d}%",
                    (hb_x1, hb_y2 + 20),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, TXT_DIM, 1, cv2.LINE_AA)

        # Controles
        ctrls = "N siguiente   B anterior   R reiniciar   K pausa   Q salir"
        (cw2, _), _ = cv2.getTextSize(ctrls, cv2.FONT_HERSHEY_PLAIN, 1.1, 1)
        cv2.putText(frame, ctrls,
                    (WIN_W - PAD - 20 - cw2, BOT_Y1 + 58),
                    cv2.FONT_HERSHEY_PLAIN, 1.1, TXT_FAINT, 1, cv2.LINE_AA)

        # FPS
        now_t = time.perf_counter()
        fps_val = 0.85 * fps_val + 0.15 / max(now_t - prev_t, 0.001)
        prev_t = now_t
        fps_txt = f"FPS  {fps_val:4.0f}"
        (fw2, _), _ = cv2.getTextSize(fps_txt, cv2.FONT_HERSHEY_PLAIN, 1.0, 1)
        cv2.putText(frame, fps_txt,
                    (WIN_W - PAD - 20 - fw2, BOT_Y1 + 30),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, TXT_FAINT, 1, cv2.LINE_AA)

        cv2.imshow(WIN_TITLE, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):
            break
        elif key in (ord('n'), ord(' ')):
            idx = (idx + 1) % len(curriculum)
            hold_start = None
            need_release = True
            seq_buf_h0.clear(); seq_buf_h1.clear()
            print(f"  >> {curriculum[idx][1]}")
        elif key == ord('b'):
            idx = (idx - 1) % len(curriculum)
            hold_start = None
            need_release = True
            seq_buf_h0.clear(); seq_buf_h1.clear()
            print(f"  >> {curriculum[idx][1]}")
        elif key == ord('r'):
            hold_start = None
            seq_buf_h0.clear(); seq_buf_h1.clear()
        elif key == ord('k'):
            paused = not paused
            hold_start = None

    cap.release()
    cv2.destroyAllWindows()
    recognizer.close()


def main():
    parser = argparse.ArgumentParser(description="LSM Words Teacher")
    parser.add_argument('--category', '-c', default=None,
                        help='Filtrar por categoria (ej: expresiones-cotidianas)')
    parser.add_argument('--word', '-w', default=None,
                        help='Practicar una sola palabra (ej: GRACIAS)')
    args = parser.parse_args()

    print("=" * 62)
    print("  LSM TEACHER  -  Palabras")
    print("=" * 62)
    print("  Aprende palabras y expresiones en Lengua de Senas")
    print("  Mexicana. Observa el video de referencia, imita el")
    print("  movimiento y manten la pose para avanzar.")
    print("=" * 62)
    run(category=args.category, word=args.word)


if __name__ == "__main__":
    main()
