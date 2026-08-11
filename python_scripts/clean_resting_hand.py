#!/usr/bin/env python3
"""
clean_resting_hand.py
Elimina la mano izquierda de los .npy base donde solo esta en reposo.

MediaPipe con num_hands=2 captura la mano que el interprete deja quieta dentro
del encuadre. Si se guarda como parte del patron, el detector la exige en vivo y
la sena deja de reconocerse cuando el usuario la hace con una sola mano.

Se apoya en hand_analysis.json (generado por analyze_hands.py):
  * left_participates = True  -> se conservan ambas manos.
  * left_participates = False -> la izquierda se pone a ceros.
"""

import json
from pathlib import Path

import numpy as np

LM_COUNT = 21
TRAINING_DIR = Path(__file__).parent.parent / "public" / "training_data"


def main():
    analysis_path = TRAINING_DIR / "hand_analysis.json"
    if not analysis_path.exists():
        print("Falta hand_analysis.json; corre primero scripts/analyze_hands.py")
        return 1

    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))

    cleaned = 0
    kept = 0
    for row in analysis["signs"]:
        sign, cat = row["sign"], row["category"]
        base = TRAINING_DIR / cat / f"{sign}_1.npy"
        if not base.exists():
            continue

        if row["left_participates"]:
            kept += 1
            continue

        arr = np.load(base).astype(np.float32)
        arr[:, LM_COUNT:, :] = 0.0
        np.save(base, arr)
        cleaned += 1

    print(f"Bimanuales conservados: {kept}")
    print(f"Mano en reposo eliminada: {cleaned}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
