"""
Genera muestras aumentadas para los numeros 1-20 a partir de los NPZ del glosario.

Estrategias de augmentation:
  - Ventanas temporales desplazadas (jitter de inicio/fin)
  - Ruido gaussiano en coordenadas (sigma pequeno)
  - Espejo horizontal (reflejo en X)
  - Velocidad variable (speed perturbation: +-15%)
  - Combinacion de ruido + espejo

Salida: data/lsm_raw/<num>/sample_NNNN.npy
  - Estaticas (1-9):  shape (21, 3) — 1 frame promedio de la pose
  - Dinamicas (10-20): shape (30, 21, 3) — secuencia resampleada a 30 frames

Uso:
    python backend/augment_numbers.py [--n-aug N] [--dry-run]

    N = muestras a generar por numero (default: 30)
"""
from __future__ import annotations
import sys, json, argparse, time
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / 'backend'))

TEMPLATES_DIR = _ROOT / 'data' / 'templates' / 'numeros'
DATA_DIR      = _ROOT / 'data' / 'lsm_raw'
METADATA_PATH = DATA_DIR / '_metadata.json'

STATIC_NUMS  = [str(i) for i in range(1, 10)]   # 1-9
DYNAMIC_NUMS = [str(i) for i in range(10, 21) if i != 15]  # 10-20 (sin 15)

TARGET_FRAMES = 30   # frames para dinamicas
NOISE_SIGMA   = 0.004


def load_metadata():
    if METADATA_PATH.exists():
        return json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    return {"samples": {}, "created": time.time(), "version": "1.0"}


def save_metadata(meta):
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    METADATA_PATH.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')


def load_npz(label: str) -> np.ndarray | None:
    """Carga el NPZ del glosario y devuelve (T, 21, 3) de la mano dominante."""
    p = TEMPLATES_DIR / f'{label}.npz'
    if not p.exists():
        # Intentar variantes (ej. 15_1.npz)
        cands = list(TEMPLATES_DIR.glob(f'{label}_*.npz'))
        if not cands:
            return None
        p = cands[0]
    d = np.load(p)
    hands = d['hands']  # (T, 2, 21, 3)
    # Elegir mano mas activa
    h0_active = np.sum(~np.all(hands[:, 0] == 0, axis=(1, 2)))
    h1_active = np.sum(~np.all(hands[:, 1] == 0, axis=(1, 2)))
    dom = 0 if h0_active >= h1_active else 1
    seq = hands[:, dom]  # (T, 21, 3)

    # Filtrar frames donde la mano no fue detectada (todos ceros)
    valid = ~np.all(seq == 0, axis=(1, 2))
    if valid.sum() < 5:
        return None
    return seq[valid]


def resample(seq: np.ndarray, n: int) -> np.ndarray:
    """Interpola linealmente (T, 21, 3) a (n, 21, 3)."""
    T = len(seq)
    if T == n:
        return seq.copy()
    idx = np.linspace(0, T - 1, n)
    out = np.zeros((n, *seq.shape[1:]), dtype=np.float32)
    for i, x in enumerate(idx):
        lo, hi = int(x), min(int(x) + 1, T - 1)
        a = x - lo
        out[i] = seq[lo] * (1 - a) + seq[hi] * a
    return out


def add_noise(seq: np.ndarray, sigma=NOISE_SIGMA) -> np.ndarray:
    return seq + np.random.randn(*seq.shape).astype(np.float32) * sigma


def mirror_x(seq: np.ndarray) -> np.ndarray:
    """Refleja coordenada X (simula mano izquierda -> derecha)."""
    out = seq.copy()
    out[..., 0] = 1.0 - out[..., 0]
    return out


def speed_perturb(seq: np.ndarray, factor: float) -> np.ndarray:
    """Escala la longitud temporal: factor<1 = mas rapido, >1 = mas lento."""
    T = len(seq)
    new_T = max(5, int(T * factor))
    return resample(seq, new_T)


def augment_static(seq: np.ndarray, n_aug: int) -> list[np.ndarray]:
    """
    Para estaticas: toma el frame promedio de la pose central y genera
    variaciones con ruido. La idea de 'estatica' es que la postura de
    la mano es la informacion, no el movimiento.
    """
    # Usar el tercio central (la pose mas estable)
    T = len(seq)
    s = T // 3
    e = 2 * T // 3
    center = seq[s:e]
    mean_pose = center.mean(axis=0)  # (21, 3)

    samples = [mean_pose.copy()]  # original
    while len(samples) < n_aug:
        v = mean_pose + np.random.randn(*mean_pose.shape).astype(np.float32) * NOISE_SIGMA
        if np.random.rand() < 0.4:
            v = mirror_x(v[None])[0]
        samples.append(v)
    return samples[:n_aug]


def augment_dynamic(seq: np.ndarray, n_aug: int) -> list[np.ndarray]:
    """
    Para dinamicas: genera variaciones con jitter temporal, ruido,
    espejo y speed perturbation.
    """
    T = len(seq)
    samples = []

    # 1. Original resampleado
    samples.append(resample(seq, TARGET_FRAMES))

    # 2. Ventanas con jitter de inicio (+/- 3 frames)
    for shift in [-3, -2, -1, 1, 2, 3]:
        s = max(0, min(shift, T - TARGET_FRAMES))
        e = min(T, s + max(TARGET_FRAMES, T - abs(shift)))
        chunk = seq[max(0, s): min(T, e)]
        if len(chunk) >= 5:
            samples.append(resample(chunk, TARGET_FRAMES))

    # 3. Speed perturbation +-15%
    for factor in [0.85, 0.90, 0.95, 1.05, 1.10, 1.15]:
        perturbed = speed_perturb(seq, factor)
        samples.append(resample(perturbed, TARGET_FRAMES))

    # 4. Ruido
    for _ in range(6):
        noisy = add_noise(resample(seq, TARGET_FRAMES))
        samples.append(noisy)

    # 5. Espejo
    mirrored = mirror_x(resample(seq, TARGET_FRAMES))
    samples.append(mirrored)
    for _ in range(4):
        samples.append(add_noise(mirror_x(resample(seq, TARGET_FRAMES))))

    # Rellenar con combinaciones hasta llegar a n_aug
    while len(samples) < n_aug:
        base = resample(seq, TARGET_FRAMES)
        if np.random.rand() < 0.5:
            base = mirror_x(base)
        factor = np.random.uniform(0.80, 1.20)
        base = resample(speed_perturb(base, factor), TARGET_FRAMES)
        base = add_noise(base, NOISE_SIGMA * np.random.uniform(0.5, 2.0))
        samples.append(base)

    return samples[:n_aug]


def next_sample_idx(class_dir: Path, prefix='sample_') -> int:
    existing = list(class_dir.glob(f'{prefix}*.npy'))
    if not existing:
        return 0
    nums = []
    for f in existing:
        try:
            nums.append(int(f.stem.replace(prefix, '')))
        except ValueError:
            pass
    return max(nums) + 1 if nums else 0


def augment_from_existing(class_dir: Path, mode: str, n_target: int) -> int:
    """
    Genera muestras adicionales para clases que ya tienen datos pero
    menos de n_target muestras. Usa los .npy existentes como base.
    Devuelve cuantas se agregaron.
    """
    existing = sorted(class_dir.glob('sample_*.npy'))
    have = len(existing)
    if have >= n_target:
        return 0

    need = n_target - have
    start_idx = next_sample_idx(class_dir)
    meta = load_metadata()
    label = class_dir.name
    added = 0

    for i in range(need):
        base_path = existing[i % have]
        arr = np.load(base_path).astype(np.float32)

        if mode == 'static':
            # arr shape (21, 3)
            v = arr + np.random.randn(*arr.shape).astype(np.float32) * NOISE_SIGMA
            if np.random.rand() < 0.4:
                v = mirror_x(v[None])[0]
        else:
            # arr shape (T, 21, 3)
            if arr.ndim == 2:
                arr = arr[None]
            factor = np.random.uniform(0.85, 1.15)
            v = resample(speed_perturb(arr, factor), TARGET_FRAMES)
            v = add_noise(v, NOISE_SIGMA * np.random.uniform(0.5, 1.5))
            if np.random.rand() < 0.4:
                v = mirror_x(v)

        path = class_dir / f'sample_{start_idx + added:04d}.npy'
        np.save(path, v.astype(np.float32))
        key = f'{label}/sample_{start_idx + added:04d}'
        meta.setdefault('samples', {})[key] = {
            'class': label,
            'mode': mode,
            'source': 'augmented_existing',
            'timestamp': time.time(),
            'frames': v.shape[0] if v.ndim == 3 else 1,
        }
        added += 1

    save_metadata(meta)
    return added


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--n-aug', type=int, default=40,
                        help='Muestras objetivo por clase (default: 40)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Solo mostrar cuantas muestras se generarian')
    args = parser.parse_args()

    meta = load_metadata()
    total_new = 0

    print(f"Augmentation de numeros ({args.n_aug} muestras/numero)")
    print(f"Templates: {TEMPLATES_DIR}")
    print(f"Salida:    {DATA_DIR}\n")

    all_nums = [(n, 'static') for n in STATIC_NUMS] + \
               [(n, 'dynamic') for n in DYNAMIC_NUMS]

    for label, mode in all_nums:
        seq = load_npz(label)
        if seq is None:
            print(f"  [{label}] SKIP — no se encontro template")
            continue

        class_dir = DATA_DIR / label
        start_idx = next_sample_idx(class_dir)

        if mode == 'static':
            samples = augment_static(seq, args.n_aug)
        else:
            samples = augment_dynamic(seq, args.n_aug)

        print(f"  [{label:>3s}] {mode:7s} | template {seq.shape} "
              f"-> {len(samples)} muestras (desde idx {start_idx})")

        if args.dry_run:
            continue

        class_dir.mkdir(parents=True, exist_ok=True)
        for i, smp in enumerate(samples):
            path = class_dir / f'sample_{start_idx + i:04d}.npy'
            np.save(path, smp.astype(np.float32))
            key = f'{label}/sample_{start_idx + i:04d}'
            meta.setdefault('samples', {})[key] = {
                'class': label,
                'mode': mode,
                'source': 'augmented_glosario',
                'timestamp': time.time(),
                'frames': smp.shape[0] if smp.ndim == 3 else 1,
            }
        total_new += len(samples)

    # Equilibrar letras A-I (estaticas) y J-K (dinamicas)
    print("\nEquilibrando letras con datos existentes...")
    STATIC_LETTERS  = list('ABCDEFGHI')
    DYNAMIC_LETTERS = ['J', 'K']

    for label in STATIC_LETTERS:
        class_dir = DATA_DIR / label
        if not class_dir.exists():
            continue
        have = len(list(class_dir.glob('sample_*.npy')))
        need = max(0, args.n_aug - have)
        if args.dry_run:
            print(f"  [{label}] static  | {have} -> {args.n_aug} (+{need})")
        else:
            added = augment_from_existing(class_dir, 'static', args.n_aug)
            total_new += added
            print(f"  [{label}] static  | {have} -> {have + added} (+{added})")

    for label in DYNAMIC_LETTERS:
        class_dir = DATA_DIR / label
        if not class_dir.exists():
            continue
        have = len(list(class_dir.glob('sample_*.npy')))
        need = max(0, args.n_aug - have)
        if args.dry_run:
            print(f"  [{label}] dynamic | {have} -> {args.n_aug} (+{need})")
        else:
            added = augment_from_existing(class_dir, 'dynamic', args.n_aug)
            total_new += added
            print(f"  [{label}] dynamic | {have} -> {have + added} (+{added})")

    if not args.dry_run:
        print(f"\nTotal muestras nuevas: {total_new}")
        print("Listo. Ahora corre:")
        print("  python backend/lsm_trainer.py --mode both --epochs 150 --min-samples 1")
    else:
        est = args.n_aug * len(all_nums)
        est += sum(max(0, args.n_aug - len(list((DATA_DIR/l).glob('sample_*.npy'))))
                   for l in STATIC_LETTERS + DYNAMIC_LETTERS
                   if (DATA_DIR/l).exists())
        print(f"\nDry-run: se generarian ~{est} muestras adicionales")


if __name__ == '__main__':
    sys.exit(main())
