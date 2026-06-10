"""
Genera GIFs sinteticos de la mano para las letras del alfabeto LSM que
NO tienen grabacion real (L-Z principalmente).

Construye una mano canonica de 21 landmarks (estilo MediaPipe) y dobla
cada dedo segun la plantilla de la letra (E=extendido, C=cerrado). Para
las senas con movimiento agrega un leve vaiven para que el GIF anime.

Reutiliza el render de esqueleto de make_gifs.py para mantener el mismo
estilo visual que los numeros y las letras grabadas.

Uso:
    python backend/make_letter_gifs.py            # solo las que faltan
    python backend/make_letter_gifs.py --force    # regenerar todas
    python backend/make_letter_gifs.py --only L M N
"""
from __future__ import annotations
import sys, argparse
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / 'backend'))

from make_gifs import landmarks_to_frame, make_gif, GIFS_DIR  # noqa: E402

# Plantillas (letra, molde thumb-index-middle-ring-pinky, con_movimiento)
# E=extendido  C=cerrado  ?=wildcard
LETTER_TEMPLATES = {
    'A': ('ECCCC', False), 'B': ('CEEEE', False), 'C': ('?????', False),
    'D': ('CECCC', False), 'E': ('CCCCC', False), 'F': ('CCEEE', False),
    'G': ('EECCC', False), 'H': ('?EECC', False), 'I': ('CCCCE', False),
    'J': ('CCCCE', True),  'K': ('EEECC', True),  'L': ('EECCC', False),
    'M': ('?????', False), 'N': ('?????', False), 'Ñ': ('?????', True),
    'O': ('CCCCC', False), 'P': ('?EECC', False), 'Q': ('EECCC', True),
    'R': ('CEECC', False), 'S': ('CCCCC', False), 'T': ('CCCCC', False),
    'U': ('CEECC', False), 'V': ('CEECC', False), 'W': ('CEEEC', False),
    'X': ('CECCC', False), 'Y': ('ECCCE', False), 'Z': ('EECCC', True),
}

# Letras que requieren forma curva especial (no solo extendido/cerrado)
ROUND_LETTERS = {'C', 'O'}

CURL = {'E': 0.0, 'C': 1.0, '?': 0.85}

# ── Geometria de la mano canonica (coordenadas normalizadas) ───────────
WRIST      = np.array([0.52, 0.93])
# Nudillos (MCP) de los 4 dedos largos, formando un arco leve
MCP = {
    'index':  np.array([0.42, 0.52]),
    'middle': np.array([0.50, 0.50]),
    'ring':   np.array([0.58, 0.52]),
    'pinky':  np.array([0.65, 0.57]),
}
# Longitud de las falanges (prox, media, distal) por dedo
SEG = {
    'index':  (0.15, 0.10, 0.07),
    'middle': (0.16, 0.11, 0.07),
    'ring':   (0.15, 0.10, 0.07),
    'pinky':  (0.12, 0.08, 0.06),
}
# Base del pulgar (CMC) en el costado de la palma
THUMB_CMC = np.array([0.40, 0.80])

# Indices de landmarks por dedo (MediaPipe)
FINGER_IDX = {
    'index':  (5, 6, 7, 8),
    'middle': (9, 10, 11, 12),
    'ring':   (13, 14, 15, 16),
    'pinky':  (17, 18, 19, 20),
}


def build_finger(mcp: np.ndarray, segs, curl: float):
    """Devuelve [PIP, DIP, TIP] doblando el dedo segun curl (0=recto,1=puno)."""
    prox, mid, dist = segs

    # Pose extendida: recto hacia arriba (-y)
    ext_pip = mcp + np.array([0.0, -prox])
    ext_dip = ext_pip + np.array([0.0, -mid])
    ext_tip = ext_dip + np.array([0.0, -dist])

    # Pose cerrada (puno): la punta se enrolla hacia la palma
    fist_pip = mcp + np.array([0.0, -prox * 0.55])
    fist_dip = fist_pip + np.array([0.015, -mid * 0.10])
    fist_tip = mcp + np.array([0.02, -prox * 0.15])

    pip = ext_pip * (1 - curl) + fist_pip * curl
    dip = ext_dip * (1 - curl) + fist_dip * curl
    tip = ext_tip * (1 - curl) + fist_tip * curl
    return [pip, dip, tip]


def build_thumb(curl: float, across: float = 0.0):
    """Devuelve [MCP, IP, TIP] del pulgar. curl=0 extendido al costado,
    curl=1 recogido. `across` cruza el pulgar sobre la palma (B, etc.)."""
    cmc = THUMB_CMC
    # Extendido: sale hacia arriba-izquierda
    ext_mcp = cmc + np.array([-0.06, -0.05])
    ext_ip  = ext_mcp + np.array([-0.05, -0.05])
    ext_tip = ext_ip + np.array([-0.04, -0.04])

    # Recogido / cruzado sobre la palma (hacia la derecha)
    cl_mcp = cmc + np.array([0.03, -0.05])
    cl_ip  = cl_mcp + np.array([0.07, -0.02])
    cl_tip = cl_ip + np.array([0.07, 0.01])

    mcp = ext_mcp * (1 - curl) + cl_mcp * curl
    ip  = ext_ip * (1 - curl) + cl_ip * curl
    tip = ext_tip * (1 - curl) + cl_tip * curl
    return [mcp, ip, tip]


def build_hand(template: str, letter: str = '') -> np.ndarray:
    """Construye landmarks (21, 3) a partir de la plantilla de 5 dedos."""
    lm = np.zeros((21, 3), dtype=np.float32)
    lm[0, :2] = WRIST

    t_curl = CURL.get(template[0], 0.85)
    finger_curls = {
        'index':  CURL.get(template[1], 0.85),
        'middle': CURL.get(template[2], 0.85),
        'ring':   CURL.get(template[3], 0.85),
        'pinky':  CURL.get(template[4], 0.85),
    }

    # Forma redonda (C, O): dedos semicerrados formando arco
    if letter in ROUND_LETTERS:
        c = 0.45 if letter == 'C' else 0.55
        for f in finger_curls:
            finger_curls[f] = c
        t_curl = 0.35

    # Pulgar cruzado para B (pulgar sobre la palma)
    thumb = build_thumb(t_curl, across=1.0 if letter == 'B' else 0.0)
    lm[1, :2] = THUMB_CMC
    lm[2, :2] = thumb[0]
    lm[3, :2] = thumb[1]
    lm[4, :2] = thumb[2]

    for fname, (i_mcp, i_pip, i_dip, i_tip) in FINGER_IDX.items():
        mcp = MCP[fname]
        lm[i_mcp, :2] = mcp
        joints = build_finger(mcp, SEG[fname], finger_curls[fname])
        lm[i_pip, :2] = joints[0]
        lm[i_dip, :2] = joints[1]
        lm[i_tip, :2] = joints[2]

    return lm


def animate(lm: np.ndarray, is_motion: bool, n_frames: int = 20):
    """Devuelve secuencia (T, 21, 3). Si is_motion, agrega vaiven lateral."""
    if not is_motion:
        # Pequeno 'respiro' para que no parezca imagen congelada
        seq = []
        for t in range(n_frames):
            phase = np.sin(t / n_frames * 2 * np.pi) * 0.004
            f = lm.copy()
            f[:, 0] += phase
            seq.append(f)
        return np.array(seq, dtype=np.float32)

    # Movimiento: oscilacion lateral + leve rotacion de muneca
    seq = []
    for t in range(n_frames):
        phase = np.sin(t / n_frames * 2 * np.pi)
        f = lm.copy()
        f[:, 0] += phase * 0.05            # vaiven lateral
        f[:, 1] += np.cos(t / n_frames * 2 * np.pi) * 0.02
        seq.append(f)
    return np.array(seq, dtype=np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true',
                        help='Regenerar incluso si ya existe el GIF')
    parser.add_argument('--only', nargs='+', default=None,
                        help='Solo estas letras (ej: L M N)')
    parser.add_argument('--fps', type=int, default=12)
    parser.add_argument('--size', type=int, default=256)
    args = parser.parse_args()

    GIFS_DIR.mkdir(parents=True, exist_ok=True)

    letters = args.only if args.only else list(LETTER_TEMPLATES.keys())
    ok = skip = 0

    for letter in letters:
        if letter not in LETTER_TEMPLATES:
            print(f"  [{letter}] SKIP — sin plantilla")
            skip += 1
            continue

        # El teacher carga los GIFs por la letra exacta (incluida la Ñ),
        # asi que guardamos con el mismo nombre.
        out_path = GIFS_DIR / f'{letter}.gif'

        if out_path.exists() and not args.force:
            print(f"  [{letter}] ya existe (usa --force para regenerar)")
            skip += 1
            continue

        tpl, is_motion = LETTER_TEMPLATES[letter]
        lm = build_hand(tpl, letter)
        seq = animate(lm, is_motion, n_frames=24 if is_motion else 16)

        success = make_gif(letter, seq, out_path, fps=args.fps)
        if success:
            kb = out_path.stat().st_size // 1024
            mark = 'MOV' if is_motion else '   '
            print(f"  [{letter:>2s}] {mark} {tpl} -> {out_path.name} ({kb} KB)")
            ok += 1
        else:
            skip += 1

    print(f"\nGenerados: {ok}  /  Saltados: {skip}")
    print(f"GIFs en: {GIFS_DIR}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
