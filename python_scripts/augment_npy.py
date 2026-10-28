#!/usr/bin/env python3
"""
augment_npy.py
Genera ejemplos aumentados a partir de cada grabacion real de una sena,
segun public/training_data/examples.json (ver examples_index.py).

Transformaciones (aplicadas sobre AMBAS manos, y la cara si existe, de forma
coherente, para no romper la relacion espacial entre ellas):
  * velocidad     -> remuestreo temporal (la sena se hace mas rapida/lenta)
  * rotacion      -> giro en el plano XY alrededor del centroide
  * escala        -> acerca/aleja la mano de la camara
  * traslacion    -> desplaza la sena dentro del encuadre
  * ruido         -> jitter por landmark, simula error del tracker
  * recorte       -> quita frames del inicio/fin, simula segmentacion imprecisa

Rotacion y escala se hacen con x corregida por la proporcion del video, para
que un giro sea un giro real y no una deformacion en videos 9:16 o 16:9.

Los landmarks ausentes (todo ceros) se mantienen en ceros: el detector usa
eso para marcar la ausencia y no debe recibir landmarks fantasma.

Cuantas aumentaciones: ~--target-total ejemplos por sena en total. Con una
sola grabacion se generan 12; con 4 grabaciones, 3 por cada una; con 13 o mas,
ninguna (examples_index.augmentations_per_real).

Uso:
  python python_scripts/augment_npy.py              # todas las senas
  python python_scripts/augment_npy.py --only CASA  # una sena
"""

import argparse
import math
import zlib
from pathlib import Path

import numpy as np

from examples_index import (
    TRAINING_DIR, augmentations_per_real, category_of, load_index, load_manifest,
    normalize_sign, npy_path, save_index,
)

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
TARGET_TOTAL = len(PRESETS) + 1  # 13: lo que tenia cada sena con una grabacion


def present_mask(arr):
    """[N, K] bool: True donde el landmark tiene datos reales."""
    return np.any(arr[:, :, :2] != 0, axis=2)


def resample_time(arr, factor):
    """Cambia la duracion por `factor` y vuelve al numero original de frames."""
    n = arr.shape[0]
    target = max(8, int(round(n / factor)))
    out = np.zeros((target, arr.shape[1], 3), dtype=np.float32)
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


def apply_spatial(arr, rot_deg, scale, tx, ty, aspect=1.0):
    """Rota, escala y traslada todo respecto al centroide comun. x se pasa a
    unidades del alto de la imagen (x * aspect) para girar sin deformar."""
    out = arr.copy()
    mask = present_mask(arr)
    if not mask.any():
        return out

    out[:, :, 0] = 0.5 + (out[:, :, 0] - 0.5) * aspect
    cx, cy = centroid(np.where(mask[:, :, None], out, 0.0))
    theta = math.radians(rot_deg)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    xs = out[:, :, 0] - cx
    ys = out[:, :, 1] - cy

    xr = (xs * cos_t - ys * sin_t) * scale
    yr = (xs * sin_t + ys * cos_t) * scale

    out[:, :, 0] = 0.5 + (xr + cx - 0.5) / aspect + tx
    out[:, :, 1] = yr + cy + ty
    out[:, :, 2] = out[:, :, 2] * scale

    # Restaurar ceros donde no habia landmark
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


def augment(base, preset, seed, aspect=1.0):
    speed, rot, scale, tx, ty, noise, ts, te = preset
    rng = np.random.default_rng(seed)
    out = base
    if ts or te:
        out = trim(out, ts, te)
    if abs(speed - 1.0) > 1e-6:
        out = resample_time(out, speed)
    if abs(rot) > 1e-6 or abs(scale - 1.0) > 1e-6 or abs(tx) > 1e-6 or abs(ty) > 1e-6:
        out = apply_spatial(out, rot, scale, tx, ty, aspect)
    if noise > 0:
        out = apply_noise(out, noise, rng)
    return np.clip(out, -2.0, 2.0).astype(np.float32)


def rebuild_augmentations(index, sign, category, data_dir=TRAINING_DIR, target_total=TARGET_TOTAL):
    """Borra las aumentaciones de `sign` y las regenera desde cada grabacion
    real (normalize_sign adopta y renumera las reales; no las borra).
    Devuelve cuantas se escribieron."""
    real_entries = normalize_sign(index, sign, category, data_dir)
    per_real = min(augmentations_per_real(len(real_entries), target_total), len(PRESETS))
    entries = list(real_entries)
    n = len(real_entries) + 1
    for real in real_entries:
        base = np.load(npy_path(data_dir, category, sign, real["n"])).astype(np.float32)
        if base.ndim != 3 or base.shape[1] not in (42, 124):
            print(f"  [SKIP] shape inesperada {base.shape}: {sign}_{real['n']}")
            continue
        for i in range(per_real):
            seed = zlib.crc32(f"{sign}|{real['n']}|{i}".encode())
            arr = augment(base, PRESETS[i], seed, real.get("aspect", 1.0))
            np.save(npy_path(data_dir, category, sign, n), arr)
            entries.append({
                "n": n, "kind": "aug", "from": real["n"], "preset": i,
                "signer": real["signer"], "aspect": real.get("aspect"),
            })
            n += 1
    index["examples"][sign] = entries
    return n - 1 - len(real_entries)


def main():
    parser = argparse.ArgumentParser(description="Regenera las aumentaciones desde las grabaciones reales")
    parser.add_argument("--only", default=None, help="Solo esta sena (nombre del manifest)")
    parser.add_argument("--target-total", type=int, default=TARGET_TOTAL,
                        help="Ejemplos por sena a los que se apunta (reales + aumentados)")
    parser.add_argument("--data", default=str(TRAINING_DIR), help="Carpeta training_data")
    args = parser.parse_args()

    data_dir = Path(args.data).resolve()
    manifest = load_manifest(data_dir)
    index = load_index(data_dir)
    cats = category_of(manifest)

    total = signs_done = 0
    for sign in sorted(index["examples"]):
        if args.only and sign != args.only.upper():
            continue
        if sign not in cats:
            print(f"  [SKIP] {sign} no esta en manifest.json")
            continue
        total += rebuild_augmentations(index, sign, cats[sign], data_dir, args.target_total)
        signs_done += 1

    save_index(index, data_dir)
    print(f"Senas procesadas: {signs_done} | ejemplos aumentados: {total}")


if __name__ == "__main__":
    main()
