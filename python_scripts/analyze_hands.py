#!/usr/bin/env python3
"""
analyze_hands.py
Decide si la mano izquierda de cada .npy base participa en la sena o solo esta
en reposo dentro del encuadre.

MediaPipe con num_hands=2 detecta cualquier mano visible, incluida la que el
interprete deja quieta. Si esa mano se guarda como parte del patron, el detector
exigira dos manos en vivo y la sena dejara de reconocerse cuando el usuario la
haga con una sola.

Criterio: la izquierda participa si se mueve de forma comparable a la derecha
(energia de movimiento normalizada por la escala de la mano).
"""

import json
from pathlib import Path

import numpy as np

LM_COUNT = 21
TRAINING_DIR = Path(__file__).parent.parent / "public" / "training_data"

# Fraccion de la energia de la derecha que la izquierda debe alcanzar para
# considerarse participante.
MOTION_RATIO = 0.25
# Energia absoluta minima (en unidades de escala de mano por frame).
MIN_ABS_MOTION = 0.06


def hand_scale(frame_hand):
    """Distancia muneca(0) -> base del medio(9), igual que el detector."""
    wrist, middle = frame_hand[0], frame_hand[9]
    d = float(np.hypot(middle[0] - wrist[0], middle[1] - wrist[1]))
    return d if d > 1e-9 else 1e-9


def motion_energy(seq):
    """Desplazamiento medio de la muneca por frame, normalizado por escala."""
    present = np.any(seq[:, :, :2] != 0, axis=(1, 2))
    idx = np.where(present)[0]
    if len(idx) < 2:
        return 0.0, 0
    total = 0.0
    steps = 0
    for a, b in zip(idx[:-1], idx[1:]):
        if b - a != 1:
            continue
        w0, w1 = seq[a, 0, :2], seq[b, 0, :2]
        scale = hand_scale(seq[b])
        total += float(np.hypot(w1[0] - w0[0], w1[1] - w0[1])) / scale
        steps += 1
    return (total / steps if steps else 0.0), len(idx)


def main():
    manifest = json.loads((TRAINING_DIR / "manifest.json").read_text(encoding="utf-8"))

    rows = []
    for cat, signs in manifest.items():
        if not isinstance(signs, list):
            continue
        for sign in signs:
            f = TRAINING_DIR / cat / f"{sign}_1.npy"
            if not f.exists():
                continue
            arr = np.load(f).astype(np.float32)
            if arr.ndim != 3 or arr.shape[1] != LM_COUNT * 2:
                continue

            right = arr[:, :LM_COUNT, :]
            left = arr[:, LM_COUNT:, :]

            er, nr = motion_energy(right)
            el, nl = motion_energy(left)

            n = arr.shape[0]
            left_coverage = nl / n if n else 0.0

            participates = (
                left_coverage >= 0.4
                and el >= MIN_ABS_MOTION
                and el >= MOTION_RATIO * max(er, 1e-9)
            )

            rows.append(
                {
                    "sign": sign,
                    "category": cat,
                    "frames": n,
                    "right_motion": round(er, 4),
                    "left_motion": round(el, 4),
                    "left_coverage": round(left_coverage, 3),
                    "left_participates": bool(participates),
                }
            )

    part = [r for r in rows if r["left_participates"]]
    rest = [r for r in rows if not r["left_participates"]]

    print(f"Total senas analizadas: {len(rows)}")
    print(f"Izquierda PARTICIPA (bimanual real): {len(part)}")
    print(f"Izquierda en REPOSO  (una mano):     {len(rest)}")

    print("\n-- Bimanuales reales (top 15 por movimiento izq) --")
    for r in sorted(part, key=lambda x: -x["left_motion"])[:15]:
        print(
            f"  {r['sign']:<18} R:{r['right_motion']:.3f} L:{r['left_motion']:.3f} "
            f"cov:{r['left_coverage']:.2f}"
        )

    print("\n-- Izquierda en reposo (top 15, se descartara) --")
    for r in sorted(rest, key=lambda x: -x["left_coverage"])[:15]:
        print(
            f"  {r['sign']:<18} R:{r['right_motion']:.3f} L:{r['left_motion']:.3f} "
            f"cov:{r['left_coverage']:.2f}"
        )

    out = TRAINING_DIR / "hand_analysis.json"
    out.write_text(
        json.dumps(
            {
                "criteria": {
                    "motion_ratio": MOTION_RATIO,
                    "min_abs_motion": MIN_ABS_MOTION,
                    "min_left_coverage": 0.4,
                },
                "signs": rows,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nReporte: {out}")


if __name__ == "__main__":
    main()
