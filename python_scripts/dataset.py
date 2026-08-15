"""
Dataset loader para clasificador de senas dinamicas.
Lee los mismos archivos .npy de public/training_data/ que usa el detector DTW,
sin modificarlos ni tocar el pipeline en produccion.

Formato de cada .npy: shape (N_frames, K, 3) donde K=42 (solo manos) o K=124 (manos + cara).
42 = 21 landmarks mano derecha + 21 izquierda.
124 = 42 manos + 82 cara (cejas, ojos, boca, nariz, contorno).
Landmarks en cero (0,0,0) para toda la mano = mano ausente en ese frame.
"""
import json
import os
import numpy as np
import torch
from torch.utils.data import Dataset

TRAINING_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "training_data")
TARGET_FRAMES = 24  # igual al pipeline de extraccion
HAND_LM = 42  # 21 derecha + 21 izquierda
FACE_LM = 82  # subset de FaceLandmarker relevante para LSM
TOTAL_LM = HAND_LM + FACE_LM  # 124
INPUT_DIM = TOTAL_LM * 3  # 372


def load_manifest():
    with open(os.path.join(TRAINING_DATA_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def _hand_present(hand):
    # hand: (21, 3). Ausente si todos los puntos son (0,0,0).
    return not np.allclose(hand, 0.0)


def normalize_sequence(arr):
    """
    arr: (N, K, 3) float32 crudo, K=42 o K=124.
    x/y en [0,1] relativo a imagen, z relativo.
    Normaliza cada frame usando el centro y escala de las manos presentes.
    La parte facial se normaliza relativa al puente de la nariz (landmark face idx 6 = nose tip).
    """
    N, K, _ = arr.shape
    has_face = K > HAND_LM
    out = np.zeros_like(arr, dtype=np.float32)
    for f in range(N):
        right = arr[f, :21]
        left = arr[f, 21:42]
        has_r = _hand_present(right)
        has_l = _hand_present(left)
        wrists = []
        if has_r:
            wrists.append(right[0])
        if has_l:
            wrists.append(left[0])
        if not wrists and not (has_face and _hand_present(arr[f, HAND_LM:])):
            continue
        # Centro: promedio de munecas presentes
        if wrists:
            center = np.mean(wrists, axis=0)
        elif has_face:
            center = arr[f, HAND_LM + 6]  # nose tip como centro fallback
        else:
            continue
        # Escala: distancia wrist->middle_finger_mcp, promedio de manos presentes
        scales = []
        if has_r:
            scales.append(np.linalg.norm(right[9] - right[0]) + 1e-6)
        if has_l:
            scales.append(np.linalg.norm(left[9] - left[0]) + 1e-6)
        scale = np.mean(scales) if scales else 1.0
        if has_r:
            out[f, :21] = (right - center) / scale
        if has_l:
            out[f, 21:42] = (left - center) / scale
        # Normalizar cara: relativa al centro de las manos, misma escala
        if has_face:
            face = arr[f, HAND_LM:]
            face_present = _hand_present(face)
            if face_present:
                out[f, HAND_LM:] = (face - center) / scale
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
    # Pad old .npy (42 lm) to 124 with zeros for face landmarks
    if arr.shape[1] == HAND_LM and TOTAL_LM > HAND_LM:
        pad = np.zeros((arr.shape[0], FACE_LM, 3), dtype=np.float32)
        arr = np.concatenate([arr, pad], axis=1)
    return arr


class SignSequenceDataset(Dataset):
    """
    Carga todos los ejemplos .npy de todas las senas del manifest.
    Cada item: (sequence_tensor [T, K*3], label_idx)
    K=42 -> 126 dims (solo manos) o K=124 -> 372 dims (manos + cara).
    Se detecta automaticamente segun la shape del .npy.
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
        flat = arr.reshape(self.target_frames, -1)  # (T, K*3)
        label = self.label_to_idx[sign]
        return torch.from_numpy(flat), label

    def num_classes(self):
        return len(self.labels)
