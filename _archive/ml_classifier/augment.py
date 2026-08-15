"""
Augmentacion on-the-fly para secuencias normalizadas (T, 126).
126 = 42 landmarks * 3 coords (21 right + 21 left), ya centrados/escalados
por normalize_sequence(). Aplica ruido, rotacion 2D leve, escala y time-warp,
preservando relacion espacial entre ambas manos (se transforma la secuencia
completa con los mismos parametros, no cada mano por separado).
"""
import numpy as np
import torch


def _rotate_2d(coords_xy, angle_rad):
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    rot = np.array([[c, -s], [s, c]], dtype=np.float32)
    return coords_xy @ rot.T


def augment_sequence(seq_np, rng=None):
    """seq_np: (T, 126) numpy float32. Devuelve copia aumentada."""
    rng = rng or np.random.default_rng()
    T = seq_np.shape[0]
    arr = seq_np.reshape(T, 42, 3).copy()

    # Rotacion leve en el plano XY (+/- 8 grados), misma rotacion para toda la secuencia
    angle = rng.uniform(-8, 8) * np.pi / 180
    xy = arr[:, :, :2].reshape(-1, 2)
    xy = _rotate_2d(xy, angle)
    arr[:, :, :2] = xy.reshape(T, 42, 2)

    # Escala global leve
    scale = rng.uniform(0.92, 1.08)
    arr[:, :, :2] *= scale

    # Ruido gaussiano pequeno por landmark
    noise = rng.normal(0, 0.01, size=arr.shape).astype(np.float32)
    arr = arr + noise

    # Time-warp: remuestreo con velocidad variable (+/-15%)
    if rng.uniform() < 0.5:
        warp_factor = rng.uniform(0.85, 1.15)
        orig_idx = np.linspace(0, T - 1, T)
        new_len = max(4, int(round(T * warp_factor)))
        warped_idx = np.linspace(0, T - 1, new_len)
        flat = arr.reshape(T, -1)
        warped = np.zeros((new_len, flat.shape[1]), dtype=np.float32)
        for c in range(flat.shape[1]):
            warped[:, c] = np.interp(warped_idx, orig_idx, flat[:, c])
        # Volver a T frames por interpolacion final (mismo largo para batching)
        final_idx = np.linspace(0, new_len - 1, T)
        warped_idx2 = np.linspace(0, new_len - 1, new_len)
        flat2 = np.zeros((T, flat.shape[1]), dtype=np.float32)
        for c in range(flat.shape[1]):
            flat2[:, c] = np.interp(final_idx, warped_idx2, warped[:, c])
        arr = flat2.reshape(T, 42, 3)

    return arr.reshape(T, -1).astype(np.float32)


class AugmentedDataset(torch.utils.data.Dataset):
    """Envuelve un dataset base y aplica augment_sequence() en __getitem__."""

    def __init__(self, base_dataset, augment_prob=0.8, seed=0):
        self.base = base_dataset
        self.augment_prob = augment_prob
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.base)

    def __getitem__(self, idx):
        seq, label = self.base[idx]
        if self.rng.uniform() < self.augment_prob:
            seq_np = augment_sequence(seq.numpy(), self.rng)
            seq = torch.from_numpy(seq_np)
        return seq, label

    def num_classes(self):
        return self.base.num_classes()
