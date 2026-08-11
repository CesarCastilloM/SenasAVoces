#!/usr/bin/env python3
"""
augment_npy.py
Genera ejemplos aumentados a partir de los .npy base (<SIGN>_1.npy).

Transformaciones (aplicadas sobre AMBAS manos de forma coherente, para no
romper la relacion espacial entre ellas):
  * velocidad     -> remuestreo temporal (la sena se hace mas rapida/lenta)
  * rotacion      -> giro en el plano XY alrededor del centroide
  * escala        -> acerca/aleja la mano de la camara
  * traslacion    -> desplaza la sena dentro del encuadre
  * ruido         -> jitter por landmark, simula error del tracker
  * recorte       -> quita frames del inicio/fin, simula segmentacion imprecisa

Los frames con mano ausente (todo ceros) se mantienen en ceros: el detector usa
eso para marcar la ausencia y no debe recibir landmarks fantasma.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np

LM_COUNT = 21
TOTAL_LM = LM_COUNT * 2

TRAINING_DIR = Path(__file__).parent.parent / "public" / "training_data"

# Cada entrada es un preset de augmentacion. El indice 1 es el original.
PRESETS = [
    # (speed, rot_deg, scale, tx, ty, noise, trim_start, trim_end)
    (0.85, 0.0, 1.00, 0.000, 0.000, 0.0020, 0, 0),
    (1.15, 0.0, 1.00, 0.000, 0.000, 0.0020, 0, 0),
    (1.00, 6.0, 1.00, 0.000, 0.000, 0.0025, 0, 0),
    (1.00, -6.0, 1.00, 0.000, 0.000, 0.0025, 0, 0),
    (1.00, 0.0, 1.08, 0.000, 0.000, 0.0025, 0, 0),
    (1.00, 0.0, 0.92, 0.000, 0.000, 0.0025, 0, 0),
    (1.00, 0.0, 1.00, 0.030, 0.020, 0.0030, 0, 0),
    (1.00, 0.0, 1.00, -0.030, -0.020, 0.0030, 0, 0),
    (0.92, 4.0, 1.04, 0.015, -0.015, 0.0035, 1, 0),
    (1.08, -4.0, 0.96, -0.015, 0.015, 0.0035, 0, 1),
    (1.00, 9.0, 1.00, 0.000, 0.000, 0.0030, 1, 1),
    (1.00, -9.0, 1.00, 0.000, 0.000, 0.0030, 1, 1),
]


def present_mask(arr):
    """[N, 42] bool: True donde el landmark tiene datos reales."""
    return np.any(arr[:, :, :2] != 0, axis=2)


def resample_time(arr, factor):
    """Cambia la duracion por `factor` y vuelve al numero original de frames."""
    n = arr.shape[0]
    target = max(8, int(round(n / factor)))
    out = np.zeros((target, TOTAL_LM, 3), dtype=np.float32)
    mask = present_mask(arr)
    for idx, t in enumerate(np.linspace(0, n - 1, target)):
        i0 = int(math.floor(t))
        i1 = min(i0 + 1, n - 1)
        alpha = float(t - i0)
        a, b = arr[i0], arr[i1]
        blended = a * (1 - alpha) + b * alpha
        # No interpolar entre presente y ausente
        ma, mb = mask[i0], mask[i1]
        blended[~ma & mb] = b[~ma & mb]
        blended[ma & ~mb] = a[ma & ~mb]
        blended[~ma & ~mb] = 0.0
        out[idx] = blended
    return out


def centroid(arr):
    """Centroide XY de los landmarks presentes, por secuencia completa."""
    mask = present_mask(arr)
    if not mask.any():
        return np.array([0.5, 0.5], dtype=np.float32)
    pts = arr[:, :, :2][mask]
    return pts.mean(axis=0).astype(np.float32)


def apply_spatial(arr, rot_deg, scale, tx, ty):
    """Rota, escala y traslada ambas manos respecto al centroide comun."""
    out = arr.copy()
    mask = present_mask(arr)
    if not mask.any():
        return out

    cx, cy = centroid(arr)
    theta = math.radians(rot_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    xs = out[:, :, 0] - cx
    ys = out[:, :, 1] - cy

    xr = (xs * cos_t - ys * sin_t) * scale
    yr = (xs * sin_t + ys * cos_t) * scale

    out[:, :, 0] = xr + cx + tx
    out[:, :, 1] = yr + cy + ty
    out[:, :, 2] = out[:, :, 2] * scale

    # Restaurar ceros donde no habia mano
    out[~mask] = 0.0
    return out


def apply_noise(arr, sigma, rng):
    out = arr.copy()
    mask = present_mask(arr)
    noise = rng.normal(0, sigma, out.shape).astype(np.float32)
    out += noise
    out[~mask] = 0.0
    return out


def trim(arr, start, end):
    n = arr.shape[0]
    if start + end >= n - 8:
        return arr
    return arr[start : n - end if end else n]


def augment(base, preset, seed):
    speed, rot, scale, tx, ty, noise, ts, te = preset
    rng = np.random.default_rng(seed)
    out = base
    if ts or te:
        out = trim(out, ts, te)
    if abs(speed - 1.0) > 1e-6:
        out = resample_time(out, speed)
    if abs(rot) > 1e-6 or abs(scale - 1.0) > 1e-6 or abs(tx) > 1e-6 or abs(ty) > 1e-6:
        out = apply_spatial(out, rot, scale, tx, ty)
    if noise > 0:
        out = apply_noise(out, noise, rng)
    return np.clip(out, -2.0, 2.0).astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description="Aumenta los .npy base")
    parser.add_argument(
        "--count",
        type=int,
        default=len(PRESETS),
        help=f"Ejemplos aumentados por sena (max {len(PRESETS)})",
    )
    parser.add_argument("--only", default=None, help="Solo esta sena")
    args = parser.parse_args()

    n_aug = min(args.count, len(PRESETS))

    manifest = json.loads((TRAINING_DIR / "manifest.json").read_text(encoding="utf-8"))

    total = 0
    signs_done = 0
    two_handed = 0

    for cat, signs in manifest.items():
        if not isinstance(signs, list):
            continue
        cat_dir = TRAINING_DIR / cat
        for sign in signs:
            if args.only and sign != args.only.upper():
                continue
            base_file = cat_dir / f"{sign}_1.npy"
            if not base_file.exists():
                print(f"  [SKIP] sin base: {cat}/{sign}_1.npy")
                continue

            base = np.load(base_file).astype(np.float32)
            if base.ndim != 3 or base.shape[1] != TOTAL_LM:
                print(f"  [SKIP] shape inesperada {base.shape}: {sign}")
                continue

            # Borrar ejemplos previos (_2 en adelante) para no mezclar versiones
            for old in cat_dir.glob(f"{sign}_*.npy"):
                m = old.stem.rsplit("_", 1)
                if len(m) == 2 and m[1].isdigit() and int(m[1]) > 1:
                    old.unlink()

            left_frames = int(
                np.sum(np.any(base[:, LM_COUNT:, :2] != 0, axis=(1, 2)))
            )
            if left_frames >= 0.4 * base.shape[0]:
                two_handed += 1

            for i in range(n_aug):
                arr = augment(base, PRESETS[i], seed=hash((sign, i)) % (2**32))
                np.save(cat_dir / f"{sign}_{i + 2}.npy", arr)
                total += 1

            signs_done += 1

    print(f"\nSenas procesadas: {signs_done} (bimanuales: {two_handed})")
    print(f"Ejemplos aumentados: {total} ({n_aug} por sena)")
    print(f"Total por sena: {n_aug + 1} (1 original + {n_aug} aumentados)")


if __name__ == "__main__":
    main()
