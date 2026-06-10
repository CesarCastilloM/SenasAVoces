"""
PERSONAL EMBEDDINGS — Mezcla datos personales + plantillas CDMX
================================================================

Lee tus capturas de data/personal/*.npz y las combina con las
plantillas originales del Glosario CDMX para generar un nuevo
data/embeddings.npz donde TUS muestras tienen mayor peso.

Estrategia:
  - Por cada seña con N muestras personales:
      embedding_final = (1-w) * emb_cdmx + w * promedio(emb_personales)
      donde w = min(N / MAX_PERSONAL, 1.0)  (peso crece con más muestras)
  - Señas sin datos personales: se usa embedding CDMX sin cambios.
  - Señas nuevas (no en CDMX): se agregan solo con datos personales.

Uso:
    python backend/personal_embeddings.py
    python backend/personal_embeddings.py --info    # solo mostrar estadísticas
"""
from __future__ import annotations
import sys, json
from pathlib import Path
import numpy as np

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent

PERSONAL_DIR    = _ROOT / 'data' / 'personal'
CDMX_EMB_PATH   = _ROOT / 'data' / 'embeddings.npz'
OUT_PATH        = _ROOT / 'data' / 'embeddings.npz'   # sobreescribe en su lugar
TEMPLATES_DIR   = _ROOT / 'data' / 'templates'
INDEX_PATH      = TEMPLATES_DIR / 'index.json'

MAX_PERSONAL    = 5    # Con 5 muestras ya tienes peso máximo (w=1.0)
MIN_FRAMES_STATIC  = 5
MIN_FRAMES_DYNAMIC = 8


# ─── Importar compute_embedding de build_embeddings ────────────────────────
sys.path.insert(0, str(_HERE))
from build_embeddings import compute_embedding, normalize_hand_seq, hand_present


# ─── Cargar muestras personales ────────────────────────────────────────────
def load_personal() -> dict[str, list[np.ndarray]]:
    """Devuelve {label: [emb1, emb2, ...]}."""
    if not PERSONAL_DIR.exists():
        return {}
    result: dict[str, list[np.ndarray]] = {}
    for npz_path in sorted(PERSONAL_DIR.glob('*.npz')):
        try:
            z = np.load(npz_path, allow_pickle=True)
            hands = z['hands'].astype(np.float32)   # (T,2,21,3)
            label = str(z['label'])
            if hands.ndim != 4 or hands.shape[0] < 3:
                continue
            emb, meta = compute_embedding(hands)
            if not np.all(np.isfinite(emb)):
                continue
            result.setdefault(label, []).append(emb)
        except Exception as ex:
            print(f"  [WARN] {npz_path.name}: {ex}")
    return result


# ─── Cargar embeddings CDMX base ───────────────────────────────────────────
def load_cdmx() -> tuple[np.ndarray, list, list, np.ndarray, np.ndarray]:
    """Carga embeddings.npz original. Devuelve (V, labels, cats, is_dyn, is_bim)."""
    if not CDMX_EMB_PATH.exists():
        return (np.zeros((0,260), dtype=np.float32),
                [], [], np.array([]), np.array([]))
    z = np.load(CDMX_EMB_PATH, allow_pickle=True)
    return (z['vectors'].astype(np.float32),
            list(z['labels']),
            list(z['categories']),
            z['is_dynamic'].astype(bool),
            z['is_bimanual'].astype(bool))


# ─── Mezclar ───────────────────────────────────────────────────────────────
def build(info_only: bool = False):
    print("=" * 60)
    print("  PERSONAL EMBEDDINGS — mezcla CDMX + personales")
    print("=" * 60)

    personal = load_personal()
    V_cdmx, labels_cdmx, cats_cdmx, dyn_cdmx, bim_cdmx = load_cdmx()

    if not personal:
        print("[INFO] No hay datos personales en data/personal/")
        print("       Usa trainer_app.py para capturar señas.")
        return

    print(f"\nDatos personales: {sum(len(v) for v in personal.values())} muestras "
          f"en {len(personal)} señas")
    for lbl, embs in sorted(personal.items()):
        print(f"  {lbl:<15} {len(embs)} muestra(s)")

    if info_only:
        return

    # ── Construir nuevo arreglo de embeddings ──────────────────────────
    new_V:      list[np.ndarray] = []
    new_labels: list[str]        = []
    new_cats:   list[str]        = []
    new_dyn:    list[bool]       = []
    new_bim:    list[bool]       = []

    cdmx_label_map: dict[str, int] = {lbl: i for i, lbl in enumerate(labels_cdmx)}
    updated = 0
    added   = 0

    for i, lbl in enumerate(labels_cdmx):
        if lbl in personal:
            pers_embs = personal[lbl]
            w = min(len(pers_embs) / MAX_PERSONAL, 1.0)
            pers_mean = np.mean(pers_embs, axis=0).astype(np.float32)
            # Interpolar: más muestras → más peso personal
            merged = (1.0 - w) * V_cdmx[i] + w * pers_mean
            new_V.append(merged.astype(np.float32))
            updated += 1
        else:
            new_V.append(V_cdmx[i])
        new_labels.append(lbl)
        new_cats.append(cats_cdmx[i])
        new_dyn.append(bool(dyn_cdmx[i]))
        new_bim.append(bool(bim_cdmx[i]))

    # Señas totalmente nuevas (no estaban en CDMX)
    for lbl, pers_embs in personal.items():
        if lbl not in cdmx_label_map:
            mean_emb = np.mean(pers_embs, axis=0).astype(np.float32)
            new_V.append(mean_emb)
            new_labels.append(lbl)
            new_cats.append('personal')
            # Detectar si es dinámica por el STD temporal (heurística)
            is_dyn = bool(np.mean([np.std(e[:63]) for e in pers_embs]) > 0.08)
            new_dyn.append(is_dyn)
            new_bim.append(False)
            added += 1

    V_out = np.stack(new_V).astype(np.float32)

    print(f"\nResultado:")
    print(f"  {updated} señas actualizadas con datos personales")
    print(f"  {added} señas nuevas agregadas")
    print(f"  {len(V_out)} embeddings totales  ({V_out.shape[1]} dims)")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        OUT_PATH,
        vectors   = V_out,
        labels    = np.array(new_labels, dtype=object),
        categories= np.array(new_cats,   dtype=object),
        is_dynamic= np.array(new_dyn,    dtype=bool),
        is_bimanual=np.array(new_bim,    dtype=bool),
    )
    print(f"\n[OK] Guardado: {OUT_PATH}")
    print(f"     Tamaño: {OUT_PATH.stat().st_size/1024:.1f} KB")
    print("\nReinicia live_recognizer.py para usar los nuevos embeddings.")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--info', action='store_true',
                        help='Solo mostrar estadísticas, no guardar')
    args = parser.parse_args()
    build(info_only=args.info)
