#!/usr/bin/env python3
"""
json_to_npy.py
Convierte todos los JSON de training_data a formato .npy binario.
Shape: [N, 42, 3] donde first 21 = right hand, next 21 = left hand (zeros si absent).
Un archivo .npy por cada ejemplo, mismo nombre pero extensión .npy.
"""

import json
import numpy as np
from pathlib import Path
import os

TRAINING_DIR = Path(r"c:\Users\Cesar\CascadeProjects\senas-a-voces\public\training_data")

def frames_to_npy(frames):
    """Convierte frames JSON a array numpy [N, 42, 3]."""
    n = len(frames)
    arr = np.zeros((n, 42, 3), dtype=np.float32)
    for i, frame in enumerate(frames):
        # Right hand
        lr = frame.get("landmarksRight")
        if lr:
            for j, lm in enumerate(lr[:21]):
                arr[i, j, 0] = lm["x"]
                arr[i, j, 1] = lm["y"]
                arr[i, j, 2] = lm.get("z", 0.0)
        # Left hand
        ll = frame.get("landmarksLeft")
        if ll:
            for j, lm in enumerate(ll[:21]):
                arr[i, 21 + j, 0] = lm["x"]
                arr[i, 21 + j, 1] = lm["y"]
                arr[i, 21 + j, 2] = lm.get("z", 0.0)
    return arr

def main():
    total = 0
    skipped = 0
    for cat_dir in sorted(TRAINING_DIR.iterdir()):
        if not cat_dir.is_dir():
            continue
        cat = cat_dir.name
        cat_total = 0
        for json_file in sorted(cat_dir.glob("*.json")):
            if json_file.name in ("manifest.json", "sign_metadata.json"):
                continue
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    frames = json.load(f)
                if not isinstance(frames, list) or len(frames) == 0:
                    skipped += 1
                    continue
                arr = frames_to_npy(frames)
                npy_file = json_file.with_suffix(".npy")
                np.save(npy_file, arr)
                # Borrar el JSON original
                json_file.unlink()
                cat_total += 1
                total += 1
            except Exception as e:
                print(f"  [ERROR] {json_file.name}: {e}")
                skipped += 1
        print(f"  {cat}: {cat_total} archivos convertidos")
    print(f"\nTotal: {total} .npy generados, {skipped} saltados")

if __name__ == "__main__":
    main()
