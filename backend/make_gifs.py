"""
Genera GIFs animados de las senas a partir de los NPZ del glosario.

El GIF muestra el esqueleto de la mano animado cuadro a cuadro sobre
fondo negro, igual que se ve en el live_ml pero sin camara.

Salida: data/gifs/<label>.gif

Uso:
    python backend/make_gifs.py               # todos los numeros
    python backend/make_gifs.py --label 1 5 10
    python backend/make_gifs.py --all         # numeros + letras personales
"""
from __future__ import annotations
import sys, argparse
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / 'backend'))

TEMPLATES_DIR = _ROOT / 'data' / 'templates' / 'numeros'
PERSONAL_DIR  = _ROOT / 'data' / 'lsm_raw'
GIFS_DIR      = _ROOT / 'data' / 'gifs'

# Conexiones del esqueleto de la mano (MediaPipe)
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

# Colores BGR -> RGB para PIL
JOINT_COLOR = (80, 220, 120)
BONE_COLOR  = (40, 140, 255)
BG_COLOR    = (18, 18, 22)
TEXT_COLOR  = (240, 240, 240)

GIF_SIZE    = 256   # px cuadrado
GIF_FPS     = 12
GIF_LOOPS   = 0     # 0 = infinito


def load_sequence(label: str) -> np.ndarray | None:
    """
    Carga secuencia (T, 21, 3) desde template NPZ del glosario
    o desde data/lsm_raw si es una letra personal.
    """
    # Primero busca en glosario
    p = TEMPLATES_DIR / f'{label}.npz'
    if p.exists():
        d = np.load(p)
        hands = d['hands']  # (T, 2, 21, 3)
        h0 = np.sum(~np.all(hands[:, 0] == 0, axis=(1, 2)))
        h1 = np.sum(~np.all(hands[:, 1] == 0, axis=(1, 2)))
        dom = 0 if h0 >= h1 else 1
        seq = hands[:, dom]
        valid = ~np.all(seq == 0, axis=(1, 2))
        return seq[valid] if valid.sum() >= 3 else None

    # Busca en data/lsm_raw (npy personales)
    raw_dir = PERSONAL_DIR / label
    if raw_dir.exists():
        files = sorted(raw_dir.glob('*.npy'))
        if files:
            arr = np.load(files[0])
            if arr.ndim == 2:  # (21, 3) estatico
                return arr[None]  # -> (1, 21, 3)
            return arr  # (T, 21, 3)
    return None


def landmarks_to_frame(lm21: np.ndarray, size: int) -> 'np.ndarray':
    """Renderiza (21, 3) como imagen BGR numpy (size x size x 3)."""
    import cv2
    frame = np.full((size, size, 3), BG_COLOR, dtype=np.uint8)

    # Normalizar a [margin, size-margin]
    margin = 20
    xs = lm21[:, 0]
    ys = lm21[:, 1]
    xmin, xmax = xs.min(), xs.max()
    ymin, ymax = ys.min(), ys.max()
    span = max(xmax - xmin, ymax - ymin, 0.001)
    scale = (size - 2 * margin) / span
    cx = (xmin + xmax) / 2
    cy = (ymin + ymax) / 2

    pts = []
    for x, y, _ in lm21:
        px = int((x - cx) * scale + size / 2)
        py = int((y - cy) * scale + size / 2)
        pts.append((px, py))

    for a, b in HAND_CONNECTIONS:
        cv2.line(frame, pts[a], pts[b], BONE_COLOR, 2, cv2.LINE_AA)
    for px, py in pts:
        cv2.circle(frame, (px, py), 4, JOINT_COLOR, -1, cv2.LINE_AA)

    return frame


def make_gif(label: str, seq: np.ndarray, out_path: Path, fps=GIF_FPS):
    """Genera un GIF animado desde la secuencia (T, 21, 3)."""
    try:
        from PIL import Image
    except ImportError:
        print("  [WARN] Pillow no disponible: pip install Pillow")
        return False

    import cv2

    frames_pil = []
    T = len(seq)

    # Para estaticas (1 frame) duplicar para hacer GIF de 10 frames
    if T == 1:
        seq = np.repeat(seq, 20, axis=0)
        T = 20

    # Titulo en el primer frame
    for t in range(T):
        bgr = landmarks_to_frame(seq[t], GIF_SIZE)

        # Etiqueta
        cv2.putText(bgr, f'LSM  {label}',
                    (10, GIF_SIZE - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65,
                    TEXT_COLOR, 1, cv2.LINE_AA)
        # Frame N/T discreto
        cv2.putText(bgr, f'{t+1}/{T}',
                    (GIF_SIZE - 50, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (130, 130, 130), 1, cv2.LINE_AA)

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        frames_pil.append(Image.fromarray(rgb))

    duration_ms = int(1000 / fps)
    frames_pil[0].save(
        out_path,
        save_all=True,
        append_images=frames_pil[1:],
        loop=GIF_LOOPS,
        duration=duration_ms,
        optimize=False,
    )
    return True


def resample(seq: np.ndarray, n: int) -> np.ndarray:
    T = len(seq)
    if T <= 1:
        return seq
    idx = np.linspace(0, T - 1, n)
    out = np.zeros((n, *seq.shape[1:]), dtype=np.float32)
    for i, x in enumerate(idx):
        lo, hi = int(x), min(int(x) + 1, T - 1)
        a = x - lo
        out[i] = seq[lo] * (1 - a) + seq[hi] * a
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', nargs='+', default=None,
                        help='Etiquetas a procesar (ej: 1 2 10 A). '
                             'Por defecto procesa todos los numeros del glosario.')
    parser.add_argument('--all', action='store_true',
                        help='Incluir tambien letras personales (A-K)')
    parser.add_argument('--fps', type=int, default=GIF_FPS,
                        help=f'FPS del GIF (default: {GIF_FPS})')
    parser.add_argument('--size', type=int, default=GIF_SIZE,
                        help=f'Tamano px del GIF (default: {GIF_SIZE})')
    args = parser.parse_args()

    try:
        from PIL import Image  # noqa
    except ImportError:
        print("ERROR: Pillow no esta instalado.")
        print("  pip install Pillow")
        return 1

    import cv2  # noqa — verificar disponibilidad

    GIFS_DIR.mkdir(parents=True, exist_ok=True)

    # Determinar labels a procesar
    if args.label:
        labels = args.label
    else:
        # Todos los numeros que tienen NPZ
        labels = [str(i) for i in range(1, 21) if i != 15]
        if args.all:
            labels += list('ABCDEFGHIJK')

    ok = 0
    skip = 0
    for label in labels:
        seq = load_sequence(label)
        if seq is None:
            print(f"  [{label}] SKIP — sin datos")
            skip += 1
            continue

        # Resamplear a max 40 frames para GIF fluido pero no muy grande
        n_frames = min(40, max(10, len(seq)))
        seq_r = resample(seq, n_frames)

        out_path = GIFS_DIR / f'{label}.gif'
        success = make_gif(label, seq_r, out_path, fps=args.fps)
        if success:
            kb = out_path.stat().st_size // 1024
            print(f"  [{label:>3s}] {n_frames} frames -> {out_path.name} ({kb} KB)")
            ok += 1
        else:
            skip += 1

    print(f"\nGenerados: {ok}  /  Saltados: {skip}")
    print(f"GIFs en: {GIFS_DIR}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
