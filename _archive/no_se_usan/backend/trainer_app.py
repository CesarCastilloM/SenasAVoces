"""
TRAINER APP — Captura tus propias señas y entrena el sistema
=============================================================

Flujo:
  1. Seleccionas la seña (A-Z, 1-20 o cualquier palabra del glosario)
  2. El sistema te dice si necesita FOTO (estática) o VIDEO (dinámica)
  3. Capturas: S = snapshot (foto) | ESPACIO = grabar secuencia
  4. Guardado automático en data/personal/
  5. TEST inmediato: muestra cuánto se parece tu nueva muestra al embedding
  6. Cuando terminas: R = rebuild embeddings personales

Los datos personales se MEZCLAN con los del Glosario CDMX.
Más muestras tuyas = mayor peso de tus capturas en la clasificación.

Uso:
    python backend/trainer_app.py
    python backend/trainer_app.py --sign A        # empezar en seña A
    python backend/trainer_app.py --category numeros
"""
from __future__ import annotations
import os, sys, time, json, threading
from pathlib import Path
from collections import deque
import numpy as np
import cv2

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))

import mediapipe as mp
from build_embeddings import compute_embedding, normalize_hand_seq

# ─── MediaPipe ─────────────────────────────────────────────────────────────
_HAND_MODEL = str(_ROOT / 'mediapipe_models' / 'hand_landmarker.task')
if not Path(_HAND_MODEL).exists():
    print(f"[ERR] No existe {_HAND_MODEL}")
    sys.exit(1)

_BaseOptions        = mp.tasks.BaseOptions
_HandLandmarker     = mp.tasks.vision.HandLandmarker
_HandLandmarkerOpts = mp.tasks.vision.HandLandmarkerOptions
_RunMode            = mp.tasks.vision.RunningMode

def _make_landmarker():
    # Intentar GPU primero
    for delegate in [_BaseOptions.Delegate.GPU, None]:
        try:
            bo = _BaseOptions(model_asset_path=_HAND_MODEL,
                              **({"delegate": delegate} if delegate else {}))
            lm = _HandLandmarker.create_from_options(
                _HandLandmarkerOpts(
                    base_options=bo,
                    running_mode=_RunMode.IMAGE,
                    num_hands=2,
                    min_hand_detection_confidence=0.5,
                    min_hand_presence_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
            )
            print(f"[OK] MediaPipe {'GPU' if delegate else 'CPU'}")
            return lm
        except Exception:
            continue
    raise RuntimeError("No se pudo inicializar MediaPipe")

# ─── Rutas ─────────────────────────────────────────────────────────────────
PERSONAL_DIR    = _ROOT / 'data' / 'personal'
EMBEDDINGS_PATH = _ROOT / 'data' / 'embeddings.npz'
GLOSARIO_PATH   = _ROOT / 'data' / 'lsm_lecciones_glosario_cdmx.json'
PERSONAL_DIR.mkdir(parents=True, exist_ok=True)

# ─── Lista completa de señas disponibles ───────────────────────────────────
ALFABETO = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
NUMEROS  = [str(n) for n in range(1, 21)]
# Señas con movimiento conocido (deben grabarse como secuencia)
DYNAMIC_SIGNS = {
    'J', 'Z', 'Q', 'X', 'K', 'LL', 'RR', 'Ñ',
    '10', '11', '12', '13', '14', '15_1', '15_2',
    '16', '17', '18', '19', '20',
}

def _load_all_signs() -> list[dict]:
    """Carga toda la lista de señas del glosario + alfabeto + números."""
    signs = []
    # Alfabeto
    for c in ALFABETO:
        signs.append({'label': c, 'category': 'educacion',
                      'dynamic': c in DYNAMIC_SIGNS})
    # Letras especiales LSM
    for c in ['LL', 'RR', 'Ñ']:
        signs.append({'label': c, 'category': 'educacion',
                      'dynamic': True})
    # Números
    for n in NUMEROS:
        signs.append({'label': n, 'category': 'numeros',
                      'dynamic': n in DYNAMIC_SIGNS})
    # Resto del glosario
    if GLOSARIO_PATH.exists():
        glosario = json.loads(GLOSARIO_PATH.read_text(encoding='utf-8'))
        seen = {s['label'] for s in signs}
        for cat_obj in glosario.get('categorias', []):
            cat_id = cat_obj.get('id', 'otros')
            for item in cat_obj.get('senas', []):
                if isinstance(item, str):
                    lbl = item.upper()
                else:
                    lbl = item.get('palabra', item.get('label', '')).upper()
                if lbl and lbl not in seen:
                    signs.append({'label': lbl, 'category': cat_id, 'dynamic': False})
                    seen.add(lbl)
    return signs


# ─── Extracción de landmarks ───────────────────────────────────────────────
def _extract_frame(frame_bgr, landmarker) -> np.ndarray:
    """Devuelve (2, 21, 3) o zeros si no hay manos."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_img)
    out = np.zeros((2, 21, 3), dtype=np.float32)
    if result.hand_landmarks:
        for hi, h in enumerate(result.hand_landmarks[:2]):
            for j, lm in enumerate(h):
                out[hi, j] = [lm.x, lm.y, lm.z]
    return out


def _has_hand(hands: np.ndarray) -> bool:
    return not np.allclose(hands[0], 0)


# ─── Guardar / cargar muestras personales ─────────────────────────────────
def _personal_path(label: str, idx: int) -> Path:
    safe = label.replace('/', '_').replace('\\', '_')
    return PERSONAL_DIR / f"{safe}_{idx:03d}.npz"


def save_sample(label: str, hands_seq: list[np.ndarray]) -> Path:
    """Guarda una secuencia como NPZ personal. hands_seq: list de (2,21,3)."""
    arr = np.stack(hands_seq).astype(np.float32)  # (T,2,21,3)
    existing = list(PERSONAL_DIR.glob(f"{label.replace('/','_')}_*.npz"))
    idx = len(existing)
    path = _personal_path(label, idx)
    np.savez_compressed(path, hands=arr, label=label)
    return path


def count_personal(label: str) -> int:
    safe = label.replace('/', '_').replace('\\', '_')
    return len(list(PERSONAL_DIR.glob(f"{safe}_*.npz")))


def _validate_capture(buf: list, is_dyn: bool) -> tuple[bool, str]:
    """Valida si la captura tiene suficiente información de mano.
    Devuelve (ok, mensaje)."""
    total = len(buf)
    valid = sum(1 for h in buf if not np.allclose(h[0], 0))
    pct = valid / total if total > 0 else 0

    if is_dyn:
        if total < 10:
            return False, "muy pocos frames"
        if pct < 0.5:
            return False, f"mano perdida ({int(pct*100)}% deteccion)"
        return True, f"{valid}/{total} frames con mano"
    else:
        if valid < 5:
            return False, "mano no detectada"
        if pct < 0.6:
            return False, f"mano inestable ({int(pct*100)}% deteccion)"
        return True, f"{valid}/{total} frames con mano"


# ─── Dibujo ────────────────────────────────────────────────────────────────
HAND_CONN = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (5,9),(9,10),(10,11),(11,12),
    (9,13),(13,14),(14,15),(15,16),
    (13,17),(17,18),(18,19),(19,20),(0,17),
]

def _draw_hand(frame, hands):
    h, w = frame.shape[:2]
    for hi in range(2):
        hand = hands[hi]
        if np.allclose(hand, 0):
            continue
        col = (0, 255, 80) if hi == 0 else (80, 200, 255)
        for a, b in HAND_CONN:
            pa = (int(hand[a,0]*w), int(hand[a,1]*h))
            pb = (int(hand[b,0]*w), int(hand[b,1]*h))
            cv2.line(frame, pa, pb, col, 2)
        for p in hand:
            cv2.circle(frame, (int(p[0]*w), int(p[1]*h)), 4, (255,255,255), -1)


# ─── Estado de la app ──────────────────────────────────────────────────────
class AppState:
    IDLE      = 'idle'       # Esperando acción
    COUNTDOWN = 'countdown'  # Cuenta regresiva antes de capturar
    CAPTURING = 'capturing'  # Grabando secuencia


# ─── App principal ─────────────────────────────────────────────────────────
def run():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--sign',     default=None, help='Empezar en esta seña')
    parser.add_argument('--category', default=None, help='Filtrar por categoría')
    args = parser.parse_args()

    landmarker = _make_landmarker()
    all_signs  = _load_all_signs()

    # Filtrar por categoría si se pidió
    if args.category:
        all_signs = [s for s in all_signs if s['category'] == args.category]
    if not all_signs:
        print("[ERR] No hay señas disponibles")
        return

    # Índice de seña actual
    sign_idx = 0
    if args.sign:
        for i, s in enumerate(all_signs):
            if s['label'].upper() == args.sign.upper():
                sign_idx = i; break

    # Cámara
    for cam_idx in range(3):
        cap = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
        if cap.isOpened():
            break
    if not cap.isOpened():
        print("[ERR] No se pudo abrir la cámara"); return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS,          30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)

    WIN = "TRAINER — LSM Personal"
    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)

    state       = AppState.IDLE
    buf: list[np.ndarray] = []   # frames capturados
    msg         = ""
    msg_ok      = True   # color del mensaje: verde=ok, rojo=mal
    msg_t       = 0.0   # tiempo en que se puso el mensaje
    countdown_t = 0.0
    COUNTDOWN_S = 2.0   # segundos antes de empezar a grabar
    MAX_FRAMES  = 60    # max frames para secuencia dinámica
    STATIC_FRAMES = 15  # frames para foto estática

    def current_sign():
        return all_signs[sign_idx]

    # ── Loop principal ──────────────────────────────────────────────────
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        hands = _extract_frame(frame, landmarker)
        hand_ok = _has_hand(hands)
        _draw_hand(frame, hands)

        sign  = current_sign()
        label = sign['label']
        is_dyn = sign['dynamic']
        n_saved = count_personal(label)

        h, w = frame.shape[:2]

        # ── Panel superior oscuro ───────────────────────────────────────
        cv2.rectangle(frame, (0, 0), (w, 110), (10, 10, 10), -1)

        # Nombre de la seña grande
        tipo = "MOVIMIENTO" if is_dyn else "ESTATICA"
        tipo_col = (0, 220, 255) if is_dyn else (80, 255, 80)
        cv2.putText(frame, label, (20, 60),
                    cv2.FONT_HERSHEY_DUPLEX, 2.0, (255,255,255), 2)
        cv2.putText(frame, f"[{tipo}]  guardadas: {n_saved}",
                    (20, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.65, tipo_col, 1)

        # Indicador de mano
        hand_col = (0,255,80) if hand_ok else (0,80,255)
        cv2.putText(frame, "MANO OK" if hand_ok else "SIN MANO",
                    (w - 200, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, hand_col, 2)

        # ── Máquina de estados ──────────────────────────────────────────
        if state == AppState.IDLE:
            instr = "ESPACIO=grabar  " if is_dyn else ""
            instr += "S=foto    D=anterior    F=siguiente    R=rebuild    Q=salir"
            cv2.putText(frame, instr,
                        (20, h-16), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (160,160,160), 1)
            # Mensaje de confirmación (desaparece a los 3s)
            if msg and time.time() - msg_t < 3.0:
                col_msg = (0, 255, 120) if msg_ok else (0, 80, 255)
                cv2.putText(frame, msg, (20, h-46),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.75, col_msg, 2)

        elif state == AppState.COUNTDOWN:
            remaining = COUNTDOWN_S - (time.time() - countdown_t)
            if remaining <= 0:
                state = AppState.CAPTURING
                buf = []
            else:
                cv2.putText(frame, f"Preparate: {remaining:.1f}s",
                            (w//2 - 160, h//2),
                            cv2.FONT_HERSHEY_DUPLEX, 1.4, (0,220,255), 3)

        elif state == AppState.CAPTURING:
            limit = MAX_FRAMES if is_dyn else STATIC_FRAMES
            if hand_ok:
                buf.append(hands.copy())

            # Barra de progreso
            pct = len(buf) / limit
            bar_w = int(pct * (w - 40))
            cv2.rectangle(frame, (20, h-30), (20+bar_w, h-10), (0,200,100), -1)
            cv2.putText(frame, f"  {len(buf)}/{limit}",
                        (20, h-12), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 1)
            cv2.putText(frame, "REC",
                        (w-80, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0,0,255), 2)

            if len(buf) >= limit:
                ok_cap, detail = _validate_capture(buf, is_dyn)
                if ok_cap:
                    path = save_sample(label, buf)
                    print(f"[OK] {path.name}  ({len(buf)} frames)")
                    msg = f"OK  ✓  ({detail})"
                    msg_ok = True
                else:
                    print(f"[DESCARTADA] {label}: {detail}")
                    msg = f"MAL  ✗  {detail} — intenta de nuevo"
                    msg_ok = False
                msg_t = time.time()
                buf = []
                state = AppState.IDLE

        # ── Panel de navegación de señas (barra lateral derecha) ───────
        nav_x = w - 220
        cv2.rectangle(frame, (nav_x, 110), (w, h-30), (15,15,15), -1)
        # Mostrar 7 señas alrededor de la actual
        n_show = 7
        half = n_show // 2
        for di in range(-half, half+1):
            ii = sign_idx + di
            if 0 <= ii < len(all_signs):
                s = all_signs[ii]
                yn = 110 + (di + half) * 38 + 30
                bg = (40, 60, 40) if di == 0 else (15, 15, 15)
                cv2.rectangle(frame, (nav_x, yn-22), (w-5, yn+10), bg, -1)
                lbl_col = (0,255,80) if di == 0 else (180,180,180)
                cnt = count_personal(s['label'])
                cv2.putText(frame, f"{s['label']}  [{cnt}]",
                            (nav_x+8, yn), cv2.FONT_HERSHEY_SIMPLEX, 0.6, lbl_col, 1)

        cv2.imshow(WIN, frame)

        # ── Teclado ─────────────────────────────────────────────────────
        k = cv2.waitKey(1) & 0xFF
        if k in (ord('q'), 27):
            break

        elif k == ord('d') and state == AppState.IDLE:
            sign_idx = (sign_idx - 1) % len(all_signs)
            msg = ""

        elif k == ord('f') and state == AppState.IDLE:
            sign_idx = (sign_idx + 1) % len(all_signs)
            msg = ""

        elif k == ord('s') and state == AppState.IDLE:
            state = AppState.COUNTDOWN
            countdown_t = time.time()

        elif k == ord(' ') and state == AppState.IDLE and is_dyn:
            state = AppState.COUNTDOWN
            countdown_t = time.time()

        elif k == ord('r') and state == AppState.IDLE:
            msg = "Actualizando embeddings..."
            msg_t = time.time()
            cv2.putText(frame, msg, (20, h//2),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0,220,255), 2)
            cv2.imshow(WIN, frame); cv2.waitKey(1)
            import subprocess
            r = subprocess.run(
                [sys.executable, str(_HERE / 'personal_embeddings.py')],
                capture_output=True, text=True, cwd=str(_ROOT)
            )
            msg = "Embeddings listos!" if r.returncode == 0 else "Error al actualizar"
            msg_t = time.time()
            if r.returncode != 0:
                print(r.stderr)

    cap.release()
    cv2.destroyAllWindows()
    print("[OK] Trainer cerrado")


if __name__ == '__main__':
    run()
