"""
BUILD EMBEDDINGS — Genera embeddings normalizados desde las 348 plantillas
============================================================================

En vez de entrenar una red neuronal (inviable con 1 muestra/clase), creamos
un "embedding" pre-calculado por seña que captura su pose característica.
En tiempo real comparamos con similitud coseno → clasificación 1-NN
robusta y rápida (<1ms por frame).

Cada embedding combina:
  - Pose normalizada (landmarks centrados en muñeca + escalados)
  - Estadística temporal (mean + std) si es dinámica
  - Indicador de bimanualidad
  - Huella de movimiento

Salida: data/embeddings.npz con:
  - vectors:   (N, D)  float32
  - labels:    (N,)    str
  - categories:(N,)    str
  - is_dynamic:(N,)    bool
  - is_bimanual:(N,)   bool

Uso:
    python backend/build_embeddings.py
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path
import numpy as np

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
TEMPLATES_DIR = _ROOT / "data" / "templates"
INDEX_PATH = TEMPLATES_DIR / "index.json"
OUT_PATH = _ROOT / "data" / "embeddings.npz"


# ---------------------------------------------------------------------
# Normalización (idéntica a la que usará live_recognizer.py)
# ---------------------------------------------------------------------
def normalize_hand_seq(hand_seq: np.ndarray) -> np.ndarray:
    """
    hand_seq: (T, 21, 3) — secuencia de landmarks de UNA mano.
    Normaliza cada frame:
      - Centra en muñeca (landmark 0)
      - Escala por distancia muñeca→middle_mcp (landmark 9)
    Retorna (T, 21, 3) normalizado.
    """
    if hand_seq.size == 0:
        return hand_seq.astype(np.float32)
    out = hand_seq.astype(np.float32).copy()
    valid_mask = np.zeros(out.shape[0], dtype=bool)
    for t in range(out.shape[0]):
        if np.all(out[t] == 0):
            continue
        wrist = out[t, 0].copy()
        out[t] = out[t] - wrist
        scale = float(np.linalg.norm(out[t, 9]))
        if scale > 1e-6:
            out[t] = out[t] / scale
            valid_mask[t] = True
        else:
            out[t] = 0.0
    # Solo conservar frames válidos
    if valid_mask.any():
        out = out[valid_mask]
    return out


def hand_present(hand_seq: np.ndarray, min_valid: int = 3) -> bool:
    """¿Esta mano aparece en suficientes frames?"""
    valid = sum(1 for t in range(hand_seq.shape[0]) if not np.all(hand_seq[t] == 0))
    return valid >= min_valid


# ---------------------------------------------------------------------
# Cálculo del embedding
# ---------------------------------------------------------------------
def compute_embedding(hands: np.ndarray) -> tuple[np.ndarray, dict]:
    """
    hands: (T, 2, 21, 3) — secuencia de landmarks bimanuales.
    Retorna (embedding (D,), metadata)
      D = 63*4 + 8 = 260 dims
        - 63: pose media mano dominante (21 landmarks normalizados, x,y,z)
        - 63: pose std  mano dominante
        - 63: pose media mano secundaria (o ceros)
        - 63: pose std  mano secundaria
        -  8: features de alto nivel (bimanual, motion, frames, etc.)
    """
    h0 = hands[:, 0]  # (T, 21, 3) mano dominante
    h1 = hands[:, 1] if hands.shape[1] > 1 else np.zeros_like(h0)

    h0_norm = normalize_hand_seq(h0)
    h1_norm = normalize_hand_seq(h1)
    has_h1 = hand_present(h1)

    # --- Mano 0 ---
    if h0_norm.shape[0] > 0:
        f0 = h0_norm.reshape(h0_norm.shape[0], -1)  # (T', 63)
        m0 = np.mean(f0, axis=0)                    # (63,)
        s0 = np.std(f0, axis=0)                     # (63,)
        # Motion mano dominante
        if f0.shape[0] > 1:
            motion0 = float(np.mean(np.linalg.norm(np.diff(f0, axis=0), axis=1)))
        else:
            motion0 = 0.0
    else:
        m0 = np.zeros(63, dtype=np.float32)
        s0 = np.zeros(63, dtype=np.float32)
        motion0 = 0.0

    # --- Mano 1 ---
    if has_h1 and h1_norm.shape[0] > 0:
        f1 = h1_norm.reshape(h1_norm.shape[0], -1)
        m1 = np.mean(f1, axis=0)
        s1 = np.std(f1, axis=0)
        if f1.shape[0] > 1:
            motion1 = float(np.mean(np.linalg.norm(np.diff(f1, axis=0), axis=1)))
        else:
            motion1 = 0.0
    else:
        m1 = np.zeros(63, dtype=np.float32)
        s1 = np.zeros(63, dtype=np.float32)
        motion1 = 0.0

    # --- Features de alto nivel (escalados a rango similar) ---
    high_lvl = np.array([
        1.0 if has_h1 else 0.0,        # bimanual flag
        min(motion0, 0.5),             # motion h0 (cap)
        min(motion1, 0.5),             # motion h1 (cap)
        min(hands.shape[0] / 60.0, 1), # duración normalizada (frames/60)
        # Posición media de la mano dominante (centro de masa, antes de normalizar)
        float(np.mean(h0[:, :, 0])) if h0.size else 0.0,
        float(np.mean(h0[:, :, 1])) if h0.size else 0.0,
        # Distancia entre manos (si bimanual)
        float(np.mean(np.linalg.norm(h0[:, 0] - h1[:, 0], axis=-1))) if has_h1 else 0.0,
        # Aspect ratio de la mano dominante (apertura)
        float(np.std(m0[:21*2])) if m0.size else 0.0,
    ], dtype=np.float32)

    embedding = np.concatenate([m0, s0, m1, s1, high_lvl]).astype(np.float32)

    meta = {
        'is_dynamic': bool(motion0 > 0.04 or motion1 > 0.04),
        'is_bimanual': bool(has_h1),
        'motion': float(max(motion0, motion1)),
        'frames': int(hands.shape[0]),
    }
    return embedding, meta


# ---------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------
def build():
    if not INDEX_PATH.exists():
        print(f"[ERR] No existe {INDEX_PATH}")
        sys.exit(1)
    idx = json.loads(INDEX_PATH.read_text(encoding='utf-8'))

    vectors = []
    labels = []
    categories = []
    is_dynamic = []
    is_bimanual = []
    skipped = 0

    print("="*60)
    print("  BUILD EMBEDDINGS — desde plantillas NPZ")
    print("="*60)
    for cat, entries in idx.items():
        n_cat = 0
        for e in entries:
            slug = e.get('slug') or e.get('label', '').upper().replace(' ', '_')
            label = e.get('label', slug)
            path = TEMPLATES_DIR / cat / f"{slug}.npz"
            if not path.exists():
                skipped += 1
                continue
            try:
                hands = np.load(path)['hands'].astype(np.float32)
                if hands.ndim != 4 or hands.shape[1] < 1 or hands.shape[2] != 21:
                    skipped += 1
                    continue
                emb, meta = compute_embedding(hands)
                if not np.all(np.isfinite(emb)):
                    skipped += 1
                    continue
                vectors.append(emb)
                labels.append(label)
                categories.append(cat)
                is_dynamic.append(meta['is_dynamic'])
                is_bimanual.append(meta['is_bimanual'])
                n_cat += 1
            except Exception as ex:
                print(f"  [WARN] {path.name}: {ex}")
                skipped += 1
        print(f"  [{cat}] {n_cat} embeddings")

    if not vectors:
        print("[ERR] No se generaron embeddings")
        sys.exit(1)

    V = np.stack(vectors).astype(np.float32)  # (N, D)
    print(f"\n[OK] {len(V)} embeddings generados ({skipped} omitidos)")
    print(f"     Dimensiones: {V.shape}")
    print(f"     Dinámicas:   {sum(is_dynamic)} / {len(V)}")
    print(f"     Bimanuales:  {sum(is_bimanual)} / {len(V)}")

    # Guardar
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        OUT_PATH,
        vectors=V,
        labels=np.array(labels, dtype=object),
        categories=np.array(categories, dtype=object),
        is_dynamic=np.array(is_dynamic, dtype=bool),
        is_bimanual=np.array(is_bimanual, dtype=bool),
    )
    print(f"\n[OK] Guardado: {OUT_PATH}")
    print(f"     Tamaño:  {OUT_PATH.stat().st_size/1024:.1f} KB")


if __name__ == '__main__':
    build()
