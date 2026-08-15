"""
Dataset loader para clasificador de senas dinamicas.
Lee los mismos archivos .npy de public/training_data/ que usa el detector DTW,
sin modificarlos ni tocar el pipeline en produccion.

Formato de cada .npy: shape (N_frames, 42, 3) -> 21 landmarks mano derecha + 21 izquierda.
Landmarks en cero (0,0,0) para toda la mano = mano ausente en ese frame.
"""
import json
import os
import numpy as np
import torch
from torch.utils.data import Dataset

TRAINING_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "training_data")
TARGET_FRAMES = 24  # igual al pipeline de extraccion


def load_manifest():
    with open(os.path.join(TRAINING_DATA_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def _hand_present(hand):
    # hand: (21, 3). Ausente si todos los puntos son (0,0,0).
    return not np.allclose(hand, 0.0)


def normalize_sequence(arr):
    """
    arr: (N, 42, 3) float32 crudo, x/y en [0,1] relativo a imagen, z relativo.
    Normaliza cada frame usando el centro y escala de las manos presentes,
    igual que hace frameInfo() en el detector DTW (para consistencia conceptual),
    pero aqui devolvemos landmarks relativos en vez de features hechas a mano,
    dejando que el modelo aprenda las features.
    """
    N = arr.shape[0]
    out = np.zeros_like(arr, dtype=np.float32)
    for f in range(N):
        right = arr[f, :21]
        left = arr[f, 21:]
        has_r = _hand_present(right)
        has_l = _hand_present(left)
        # Centro: promedio de munecas presentes (landmark 0 = wrist)
        wrists = []
        if has_r:
            wrists.append(right[0])
        if has_l:
            wrists.append(left[0])
        if not wrists:
            continue
        center = np.mean(wrists, axis=0)
        # Escala: distancia wrist->middle_finger_mcp (landmark 9), promedio de manos presentes
        scales = []
        if has_r:
            scales.append(np.linalg.norm(right[9] - right[0]) + 1e-6)
        if has_l:
            scales.append(np.linalg.norm(left[9] - left[0]) + 1e-6)
        scale = np.mean(scales) if scales else 1.0
        if has_r:
            out[f, :21] = (right - center) / scale
        if has_l:
            out[f, 21:] = (left - center) / scale
    return out


def resample_to_length(arr, target_len=TARGET_FRAMES):
    """Interpola linealmente en el eje de tiempo para que todas las secuencias
    tengan el mismo largo (requerido para batching eficiente)."""
    N = arr.shape[0]
    if N == target_len:
        return arr
    if N == 1:
        return np.repeat(arr, target_len, axis=0)
    orig_idx = np.linspace(0, N - 1, num=N)
    target_idx = np.linspace(0, N - 1, num=target_len)
    flat = arr.reshape(N, -1)
    out_flat = np.zeros((target_len, flat.shape[1]), dtype=np.float32)
    for c in range(flat.shape[1]):
        out_flat[:, c] = np.interp(target_idx, orig_idx, flat[:, c])
    return out_flat.reshape(target_len, *arr.shape[1:])


def load_npy_sequence(path):
    arr = np.load(path).astype(np.float32)
    if arr.ndim == 2:  # (21,3) estatico -> 1 frame
        arr = arr[None, :, :]
        if arr.shape[1] == 21:
            arr = np.concatenate([arr, np.zeros_like(arr)], axis=1)
    return arr


class SignSequenceDataset(Dataset):
    """
    Carga todos los ejemplos .npy de todas las senas del manifest.
    Cada item: (sequence_tensor [T, 126], label_idx)
    126 = 42 landmarks * 3 coords, aplanado por frame.
    """

    def __init__(self, manifest=None, holdout_index=None, only_holdout=False,
                 target_frames=TARGET_FRAMES, max_examples_per_sign=20):
        self.manifest = manifest or load_manifest()
        self.target_frames = target_frames
        self.samples = []  # (filepath, label)
        self.labels = []
        for cat, signs in self.manifest.items():
            if not isinstance(signs, list):
                continue
            for sign in signs:
                for n in range(1, max_examples_per_sign + 1):
                    fp = os.path.join(TRAINING_DATA_DIR, cat, f"{sign}_{n}.npy")
                    if not os.path.exists(fp):
                        break
                    is_holdout_example = (n == holdout_index)
                    if only_holdout and not is_holdout_example:
                        continue
                    if (not only_holdout) and is_holdout_example:
                        continue
                    self.samples.append((fp, sign))
                    if sign not in self.labels:
                        self.labels.append(sign)
        self.labels = sorted(set(self.labels))
        self.label_to_idx = {l: i for i, l in enumerate(self.labels)}

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        fp, sign = self.samples[idx]
        arr = load_npy_sequence(fp)
        arr = normalize_sequence(arr)
        arr = resample_to_length(arr, self.target_frames)
        flat = arr.reshape(self.target_frames, -1)  # (T, 126)
        label = self.label_to_idx[sign]
        return torch.from_numpy(flat), label

    def num_classes(self):
        return len(self.labels)
