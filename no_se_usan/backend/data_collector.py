"""
DATA COLLECTOR — Captura de landmarks para entrenar reconocimiento LSM
=======================================================================

Captura secuencias de landmarks de cámara (MediaPipe Hands) para cada seña.
Diseñado para ser RIGUROSO: 50 reps por seña, validación de calidad,
y soporte de pausa/reanudación.

Cada repetición se guarda como .npz con:
  - hands:  (T, 2, 21, 3) float32 — secuencia de landmarks ambas manos
  - meta:   dict con label, duration, hand_visible_ratio, timestamp

Estructura de salida:
  data/dataset/numeros/1/000.npz
  data/dataset/numeros/1/001.npz
  ...
  data/dataset/numeros/1/049.npz
  data/dataset/numeros/2/000.npz
  ...

Controles:
  ESPACIO  → grabar repetición (ventana de 1.5 s)
  S        → saltar a la siguiente seña
  B        → repetir la última repetición (la sobreescribe)
  N        → ir a la siguiente seña sin grabar más
  P        → marcar como pausa larga / pausar sesión
  Q / ESC  → salir (puedes reanudar después)
"""

from __future__ import annotations
import os, sys, time, json
from pathlib import Path
import numpy as np
import cv2
import mediapipe as mp

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))

# ---------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------
CATEGORIA = "numeros"
SEÑAS = [str(n) for n in range(1, 31)]   # "1" .. "30"
REPS_OBJETIVO = 50
DURACION_REP_S = 1.5    # segundos por repetición
PRE_CUENTA_S = 1.0      # cuenta regresiva antes de grabar
FPS_OBJETIVO = 30
MIN_FRAMES_VALIDOS = 15  # mínimo de frames CON mano visible para aceptar la rep

DATASET_DIR = _ROOT / "data" / "dataset" / CATEGORIA
DATASET_DIR.mkdir(parents=True, exist_ok=True)

HAND_MODEL = str(_ROOT / "mediapipe_models" / "hand_landmarker.task")
if not Path(HAND_MODEL).exists():
    print(f"[ERR] Falta {HAND_MODEL}. Corre: python backend/download_models.py")
    sys.exit(1)

# ---------------------------------------------------------------------
# MediaPipe
# ---------------------------------------------------------------------
_BaseOptions = mp.tasks.BaseOptions
_HandLandmarker = mp.tasks.vision.HandLandmarker
_HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
_VisionRunningMode = mp.tasks.vision.RunningMode

hand_landmarker = _HandLandmarker.create_from_options(
    _HandLandmarkerOptions(
        base_options=_BaseOptions(model_asset_path=HAND_MODEL),
        running_mode=_VisionRunningMode.IMAGE,
        num_hands=2,
        min_hand_detection_confidence=0.4,
        min_hand_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
)
print("[OK] HandLandmarker cargado")


# ---------------------------------------------------------------------
# Cámara
# ---------------------------------------------------------------------
def open_camera(idx=0):
    backends = []
    if hasattr(cv2, "CAP_DSHOW"):
        backends.append(cv2.CAP_DSHOW)
    backends.append(cv2.CAP_ANY)
    for be in backends:
        cap = cv2.VideoCapture(idx, be)
        if cap.isOpened():
            return cap
    return cv2.VideoCapture(idx)


# ---------------------------------------------------------------------
# Helpers
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


def detect(rgb_image_buffer):
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image_buffer)
    return hand_landmarker.detect(mp_image)


def landmarks_to_array(result) -> np.ndarray:
    """Devuelve (2, 21, 3) — primera mano dominante, segunda mano (o ceros)."""
    out = np.zeros((2, 21, 3), dtype=np.float32)
    if not result.hand_landmarks:
        return out
    for hi, hlms in enumerate(result.hand_landmarks[:2]):
        for j, lm in enumerate(hlms):
            out[hi, j] = (lm.x, lm.y, lm.z)
    return out


def existing_reps(senya: str) -> int:
    """Cuántas reps ya están guardadas para esta seña."""
    d = DATASET_DIR / senya
    if not d.exists():
        return 0
    return len(list(d.glob("*.npz")))


def save_rep(senya: str, rep_idx: int, frames: list[np.ndarray], duration: float, hand_ratio: float):
    """Guarda la repetición como .npz."""
    d = DATASET_DIR / senya
    d.mkdir(parents=True, exist_ok=True)
    arr = np.stack(frames, axis=0).astype(np.float32)  # (T, 2, 21, 3)
    # Calcular si la seña fue dinámica o estática
    if len(arr) > 1:
        flat = arr[:, 0].reshape(len(arr), -1)
        scale = float(np.mean(np.linalg.norm(flat, axis=1))) or 1e-6
        diffs = np.linalg.norm(np.diff(flat, axis=0), axis=1) / scale
        motion = float(np.mean(diffs))
    else:
        motion = 0.0
    is_dynamic = motion > 0.06

    meta = {
        "label": senya,
        "category": CATEGORIA,
        "frames": int(len(arr)),
        "duration_s": round(duration, 3),
        "hand_visible_ratio": round(hand_ratio, 3),
        "motion": round(motion, 4),
        "is_dynamic": bool(is_dynamic),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    path = d / f"{rep_idx:03d}.npz"
    np.savez_compressed(path, hands=arr, meta=json.dumps(meta, ensure_ascii=False))
    return path, meta


def draw_hud(frame, *, senya: str, rep_done: int, rep_total: int,
             status: str, color=(255,255,255), countdown: float | None = None,
             recording: bool = False, hand_visible: bool = False, fps: float = 0.0):
    h, w = frame.shape[:2]
    # Banner superior
    cv2.rectangle(frame, (0, 0), (w, 110), (0, 0, 0), -1)
    cv2.putText(frame, f"SEÑA: {senya}", (16, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 200), 3)
    cv2.putText(frame, f"reps  {rep_done}/{rep_total}", (16, 95),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
    # Barra progreso reps
    pct = rep_done / max(1, rep_total)
    cv2.rectangle(frame, (260, 78), (260+400, 96), (60,60,60), -1)
    cv2.rectangle(frame, (260, 78), (260+int(400*pct), 96), (0,200,255), -1)

    # Estado en zona inferior
    cv2.rectangle(frame, (0, h-90), (w, h), (0, 0, 0), -1)
    cv2.putText(frame, status, (16, h-50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2)
    cv2.putText(frame, "[ESPACIO] grabar   [B] repetir   [S] saltar   [N] siguiente   [Q] salir",
                (16, h-18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (160,160,160), 1)

    # Indicador grabando
    if recording:
        cv2.circle(frame, (w-50, 50), 18, (0, 0, 255), -1)
        cv2.putText(frame, "REC", (w-100, 58),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    elif countdown is not None:
        cv2.putText(frame, f"{countdown:.1f}", (w//2-30, h//2),
                    cv2.FONT_HERSHEY_SIMPLEX, 3.0, (0, 255, 255), 6)

    # Indicador mano
    hand_color = (0, 255, 0) if hand_visible else (0, 0, 255)
    cv2.circle(frame, (w-50, 95), 10, hand_color, -1)
    cv2.putText(frame, "mano", (w-110, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.5, hand_color, 1)
    cv2.putText(frame, f"FPS {fps:.0f}", (w-110, 115),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (160,160,160), 1)


# ---------------------------------------------------------------------
# Loop principal
# ---------------------------------------------------------------------
def main():
    print("="*64)
    print(f"  DATA COLLECTOR — {CATEGORIA.upper()}")
    print(f"  Señas: {len(SEÑAS)}   Reps por seña: {REPS_OBJETIVO}")
    print(f"  Salida: {DATASET_DIR}")
    print("="*64)

    # Estado: encuentra la primera seña incompleta
    progreso = {s: existing_reps(s) for s in SEÑAS}
    senya_idx = 0
    while senya_idx < len(SEÑAS) and progreso[SEÑAS[senya_idx]] >= REPS_OBJETIVO:
        senya_idx += 1
    if senya_idx >= len(SEÑAS):
        print("\n¡Todas las señas ya tienen 50 reps! Nada que hacer.")
        print("Borra archivos en data/dataset/ si quieres re-grabar.")
        return

    print("\nProgreso actual:")
    for s in SEÑAS:
        flag = "✓" if progreso[s] >= REPS_OBJETIVO else " "
        print(f"  [{flag}] {s:>3}  {progreso[s]}/{REPS_OBJETIVO}")
    print(f"\nEmpezando con: {SEÑAS[senya_idx]}\n")

    cap = open_camera(0)
    if not cap.isOpened():
        print("[ERR] No se pudo abrir la cámara"); return
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, FPS_OBJETIVO)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    win = "Data Collector"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    # Estados de grabación
    MODE_IDLE = 0          # esperando ESPACIO
    MODE_COUNTDOWN = 1     # cuenta regresiva
    MODE_RECORDING = 2     # grabando
    mode = MODE_IDLE
    t_mode_start = 0.0
    rec_frames: list[np.ndarray] = []
    rec_hand_visible = 0
    last_rep_idx_saved = -1   # para repetir con [B]
    status_msg = "Posición lista. Pulsa ESPACIO para grabar la primera repetición."
    status_color = (255, 255, 255)
    fps_smoothed = 0.0
    prev_t = time.perf_counter()

    try:
        while senya_idx < len(SEÑAS):
            senya = SEÑAS[senya_idx]
            done = progreso[senya]

            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = detect(rgb)
            hands_np = landmarks_to_array(result)
            hand_visible = bool(result.hand_landmarks)

            now = time.perf_counter()
            dt = now - prev_t; prev_t = now
            if dt > 0:
                fps_smoothed = 0.9*fps_smoothed + 0.1*(1.0/dt)

            countdown_val = None
            recording = False

            # Máquina de estados
            if mode == MODE_COUNTDOWN:
                elapsed = time.time() - t_mode_start
                remaining = PRE_CUENTA_S - elapsed
                if remaining <= 0:
                    mode = MODE_RECORDING
                    t_mode_start = time.time()
                    rec_frames = []
                    rec_hand_visible = 0
                    status_msg = "GRABANDO... haz la seña"
                    status_color = (0, 0, 255)
                else:
                    countdown_val = remaining
                    status_msg = "Prepárate..."
                    status_color = (0, 255, 255)

            elif mode == MODE_RECORDING:
                rec_frames.append(hands_np.copy())
                if hand_visible:
                    rec_hand_visible += 1
                elapsed = time.time() - t_mode_start
                recording = True
                status_msg = f"GRABANDO... {elapsed:.2f}s / {DURACION_REP_S}s"
                status_color = (0, 0, 255)

                if elapsed >= DURACION_REP_S:
                    # Validar y guardar
                    n = len(rec_frames)
                    ratio = rec_hand_visible / max(1, n)
                    if rec_hand_visible < MIN_FRAMES_VALIDOS:
                        status_msg = f"DESCARTADA: solo {rec_hand_visible} frames con mano (mín {MIN_FRAMES_VALIDOS})"
                        status_color = (0, 100, 255)
                    else:
                        rep_idx = progreso[senya]
                        path, meta = save_rep(senya, rep_idx, rec_frames, elapsed, ratio)
                        progreso[senya] += 1
                        last_rep_idx_saved = rep_idx
                        kind = "din" if meta["is_dynamic"] else "est"
                        status_msg = (f"OK rep {rep_idx+1}/{REPS_OBJETIVO}  "
                                      f"({kind}, {n} frames, {int(ratio*100)}% mano)")
                        status_color = (0, 255, 0)

                        if progreso[senya] >= REPS_OBJETIVO:
                            print(f"[✓] {senya}: {REPS_OBJETIVO} reps completadas")
                            senya_idx += 1
                            if senya_idx < len(SEÑAS):
                                status_msg = f"¡{senya} completo! Siguiente: {SEÑAS[senya_idx]}"
                                status_color = (0, 255, 200)

                    mode = MODE_IDLE
                    rec_frames = []
                    rec_hand_visible = 0

            # Render
            if hand_visible:
                draw_hand(frame, hands_np)
            draw_hud(frame, senya=senya, rep_done=progreso[senya],
                     rep_total=REPS_OBJETIVO, status=status_msg,
                     color=status_color, countdown=countdown_val,
                     recording=recording, hand_visible=hand_visible,
                     fps=fps_smoothed)
            cv2.imshow(win, frame)

            k = cv2.waitKey(1) & 0xFF
            if k in (ord('q'), 27):
                print("\nSaliendo. Tu progreso quedó guardado.")
                break
            elif k == ord(' ') and mode == MODE_IDLE:
                mode = MODE_COUNTDOWN
                t_mode_start = time.time()
            elif k == ord('s') and mode == MODE_IDLE:
                # Saltar a la siguiente seña
                print(f"[skip] {senya} en {progreso[senya]}/{REPS_OBJETIVO}")
                senya_idx += 1
            elif k == ord('n') and mode == MODE_IDLE:
                # Forzar siguiente sin grabar más reps de esta
                senya_idx += 1
            elif k == ord('b') and mode == MODE_IDLE and last_rep_idx_saved >= 0:
                # Borrar última rep guardada de esta seña, lista para regrabar
                if progreso[senya] > 0:
                    last_path = DATASET_DIR / senya / f"{progreso[senya]-1:03d}.npz"
                    if last_path.exists():
                        last_path.unlink()
                        progreso[senya] -= 1
                        status_msg = f"Última rep ({last_path.name}) borrada. Regrábala."
                        status_color = (0, 200, 255)

    finally:
        cap.release()
        cv2.destroyAllWindows()

    # Resumen final
    print("\n" + "="*64)
    print("Resumen:")
    completas = 0
    for s in SEÑAS:
        n = existing_reps(s)
        flag = "✓" if n >= REPS_OBJETIVO else " "
        print(f"  [{flag}] {s:>3}  {n}/{REPS_OBJETIVO}")
        if n >= REPS_OBJETIVO:
            completas += 1
    print(f"\n{completas}/{len(SEÑAS)} señas completas.")
    print(f"Dataset en: {DATASET_DIR}")


if __name__ == "__main__":
    main()
