"""
Importa plantillas NPZ del Glosario CDMX al formato del dataset lsm_data_collector.

Los NPZ del glosario tienen: hands=(T, 2, 21, 3), pose=(T, 33, 3)
El trainer espera:
  - estático:  (21, 3) — una mano, un frame promedio
  - dinámico:  (30, 21, 3) — una mano, 30 frames

Solo importa clases que el trainer reconoce:
  - Números estáticos 1-9
  - Números dinámicos 10-20

Uso:
    python backend/import_glosario_to_dataset.py --dry-run   # solo ver qué haría
    python backend/import_glosario_to_dataset.py             # importar
"""
from __future__ import annotations
import sys
import json
import argparse
import time
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "backend"))

from lsm_data_collector import DATA_DIR, METADATA_PATH, DYNAMIC_SIGNS, NUMBERS_DYNAMIC

TEMPLATES_DIR = _ROOT / "data" / "templates"

# Clases que podemos importar del glosario
# Solo números: el glosario tiene señas de vocabulario, no el alfabeto manual
STATIC_NUMBERS  = {str(i) for i in range(1, 10)}   # 1-9 estáticos
DYNAMIC_NUMBERS = NUMBERS_DYNAMIC                    # 10-20 dinámicos

DYNAMIC_FRAMES = 30   # frames que espera el trainer para dinámicas
STATIC_FRAMES  = 15   # frames que promedia para estáticas


def extract_dominant_hand(hands_arr: np.ndarray) -> np.ndarray:
    """
    hands_arr: (T, 2, 21, 3)
    Devuelve (T, 21, 3) usando la mano dominante (la más activa).
    """
    T = hands_arr.shape[0]
    h0_active = np.sum(~np.all(hands_arr[:, 0] == 0, axis=(1, 2)))
    h1_active = np.sum(~np.all(hands_arr[:, 1] == 0, axis=(1, 2)))
    dominant = 0 if h0_active >= h1_active else 1
    return hands_arr[:, dominant]  # (T, 21, 3)


def resample_sequence(seq: np.ndarray, target: int) -> np.ndarray:
    """
    Remuestrea una secuencia (T, 21, 3) a target frames con interpolación lineal.
    """
    T = seq.shape[0]
    if T == target:
        return seq
    indices = np.linspace(0, T - 1, target)
    result = np.zeros((target, *seq.shape[1:]), dtype=seq.dtype)
    for i, idx in enumerate(indices):
        lo = int(idx)
        hi = min(lo + 1, T - 1)
        alpha = idx - lo
        result[i] = seq[lo] * (1 - alpha) + seq[hi] * alpha
    return result


def load_or_create_metadata() -> dict:
    if METADATA_PATH.exists():
        return json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    return {"samples": {}, "created": time.time(), "version": "1.0"}


def save_metadata(meta: dict):
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    METADATA_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Solo mostrar qué importaría")
    parser.add_argument("--force", action="store_true", help="Reimportar aunque ya existan")
    args = parser.parse_args()

    if not TEMPLATES_DIR.exists():
        print(f"ERROR: {TEMPLATES_DIR} no existe. Ejecuta train_from_videos_segmented.py primero.")
        return 1

    meta = load_or_create_metadata()
    existing_samples = set(meta.get("samples", {}).keys())

    stats = {"imported": 0, "skipped_exists": 0, "skipped_no_match": 0, "failed": 0}
    to_import = []

    # Categoría numeros del glosario
    numeros_dir = TEMPLATES_DIR / "numeros"
    if not numeros_dir.exists():
        print(f"ERROR: {numeros_dir} no existe.")
        return 1

    print(f"\n🔍 Escaneando plantillas en {numeros_dir}...\n")

    for npz_path in sorted(numeros_dir.glob("*.npz")):
        # El slug del archivo es la etiqueta (ej: "10", "1_000" → ignorar 1000+)
        label = npz_path.stem  # ej: "1", "10", "1_000"

        # Limpiar label: "1_000" → no coincide → saltar
        # Solo queremos 1-9 y 10-20
        if label not in STATIC_NUMBERS and label not in DYNAMIC_NUMBERS:
            print(f"  ⏭️  {label} — no es número 1-20, saltando")
            stats["skipped_no_match"] += 1
            continue

        mode = "dynamic" if label in DYNAMIC_NUMBERS else "static"
        class_dir = DATA_DIR / label
        
        # Calcular siguiente índice
        existing_in_class = sorted(class_dir.glob("sample_*.npy")) if class_dir.exists() else []
        # Verificar si ya fue importado del glosario
        glosario_key = f"{label}/glosario_cdmx.npy"
        if glosario_key in existing_samples and not args.force:
            print(f"  ⏭️  {label} ({mode}) — ya importado")
            stats["skipped_exists"] += 1
            continue

        to_import.append((npz_path, label, mode, glosario_key))
        print(f"  ✓ {label:5s} ({mode:7s}) ← {npz_path.name}")

    print(f"\n{'─'*50}")
    print(f"Para importar: {len(to_import)} | "
          f"Ya existían: {stats['skipped_exists']} | "
          f"No coinciden: {stats['skipped_no_match']}")

    if args.dry_run:
        print("\n[DRY-RUN] No se importó nada.")
        return 0

    if not to_import:
        print("\n✅ Nada nuevo para importar.")
        return 0

    print(f"\n📥 Importando {len(to_import)} plantillas...\n")

    for npz_path, label, mode, sample_key in to_import:
        try:
            data = np.load(npz_path)
            hands = data["hands"]  # (T, 2, 21, 3)

            if hands.ndim != 4 or hands.shape[1] != 2 or hands.shape[2] != 21:
                print(f"  ✗ {label} — forma inesperada: {hands.shape}")
                stats["failed"] += 1
                continue

            # Extraer mano dominante
            hand_seq = extract_dominant_hand(hands)  # (T, 21, 3)

            if mode == "static":
                # Promedio de frames con mano activa
                valid = ~np.all(hand_seq == 0, axis=(1, 2))
                if valid.sum() < 3:
                    print(f"  ✗ {label} — muy pocos frames con mano")
                    stats["failed"] += 1
                    continue
                landmark = hand_seq[valid].mean(axis=0)  # (21, 3)
                out_arr = landmark

            else:  # dynamic
                # Remuestrear a DYNAMIC_FRAMES
                valid_mask = ~np.all(hand_seq == 0, axis=(1, 2))
                valid_seq = hand_seq[valid_mask]
                if len(valid_seq) < 10:
                    print(f"  ✗ {label} — muy pocos frames válidos ({len(valid_seq)})")
                    stats["failed"] += 1
                    continue
                out_arr = resample_sequence(valid_seq, DYNAMIC_FRAMES)  # (30, 21, 3)

            # Guardar
            out_dir = DATA_DIR / label
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / "glosario_cdmx.npy"
            np.save(out_path, out_arr)

            # Registrar en metadata
            meta.setdefault("samples", {})[sample_key] = {
                "class": label,
                "mode": mode,
                "source": "glosario_cdmx",
                "timestamp": time.time(),
                "frames": out_arr.shape[0] if out_arr.ndim == 3 else 1
            }

            print(f"  ✓ {label:5s} ({mode:7s}) → {out_path.relative_to(_ROOT)}")
            stats["imported"] += 1

        except Exception as e:
            print(f"  ✗ {label} — error: {e}")
            stats["failed"] += 1

    save_metadata(meta)

    print(f"\n{'='*50}")
    print(f"✅ Importados: {stats['imported']}")
    print(f"   Fallidos:   {stats['failed']}")
    print(f"\nDataset actualizado en {DATA_DIR}")
    print(f"Ahora entrena con:")
    print(f"  python backend/lsm_trainer.py --mode static --epochs 100")
    print(f"  python backend/lsm_trainer.py --mode dynamic --epochs 150")

    return 0


if __name__ == "__main__":
    sys.exit(main())
