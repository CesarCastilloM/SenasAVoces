#!/usr/bin/env python3
"""
convert_npy_to_json.py
Convierte datos .npy de data/lsm_raw/ al formato JSON del detector DTW.

Estructura de entrada:
  data/lsm_raw/
    _metadata.json
    A/sample_0000.npy  ... sample_0039.npy
    B/sample_0000.npy  ...
    1/sample_0000.npy  ...
    ...

Estructura de salida:
  public/training_data/
    abecedario/
      A_1.json ... A_10.json
      B_1.json ...
    numeros/
      1_1.json ...
"""

import json
import os
import numpy as np
from pathlib import Path
from collections import defaultdict

RAW_DIR = Path(r"c:\Users\Cesar\CascadeProjects\SenasAVoces\data\lsm_raw")
OUT_DIR = Path(r"c:\Users\Cesar\CascadeProjects\senas-a-voces\public\training_data")
METADATA_FILE = RAW_DIR / "_metadata.json"

# Mapeo de clases a categorías del manifest
def get_category(cls):
    # Letras A-Z -> abecedario
    if cls.isalpha() and len(cls) == 1:
        return "abecedario"
    # Números -> numeros
    if cls.isdigit():
        return "numeros"
    return "palabras"

def npy_to_frames(arr):
    """Convierte array numpy a lista de frames del detector.
    Si es estático (1 frame), replica a 20 frames con ruido leve."""
    if arr.ndim == 2:
        # [21, 3] -> estático, expandir a 20 frames con ruido leve
        base = arr.copy()
        np.random.seed(42)
        expanded = []
        for _ in range(20):
            noise = np.random.normal(0, 0.002, base.shape).astype(base.dtype)
            expanded.append(base + noise)
        arr = np.array(expanded)  # [20, 21, 3]
    elif arr.ndim == 3 and arr.shape[0] == 1:
        # [1, 21, 3] -> también estático, expandir
        base = arr[0]
        np.random.seed(42)
        expanded = []
        for _ in range(20):
            noise = np.random.normal(0, 0.002, base.shape).astype(base.dtype)
            expanded.append(base + noise)
        arr = np.array(expanded)
    
    frames = []
    for f in range(arr.shape[0]):
        landmarks = []
        for l in range(arr.shape[1]):
            landmarks.append({
                "x": float(arr[f, l, 0]),
                "y": float(arr[f, l, 1]),
                "z": float(arr[f, l, 2]) if arr.shape[2] > 2 else 0.0,
            })
        frames.append({
            "landmarksRight": landmarks,
            "landmarksLeft": None,
        })
    return frames

def main():
    with open(METADATA_FILE, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    
    samples = metadata.get("samples", {})
    
    # Agrupar muestras por clase
    by_class = defaultdict(list)
    for key, info in samples.items():
        if not info.get("valid", True):
            continue
        cls = info["class"]
        by_class[cls].append((key, info))
    
    # Convertir cada clase
    total_files = 0
    new_signs = set()
    
    for cls, items in sorted(by_class.items()):
        category = get_category(cls)
        cat_dir = OUT_DIR / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        
        # Tomar hasta 10 muestras (las primeras originales, luego augmented)
        # Priorizar muestras originales sobre augmented
        original = [(k, i) for k, i in items if i.get("source") != "augmented_glosario" and i.get("source") != "augmented_existing"]
        augmented = [(k, i) for k, i in items if i.get("source") == "augmented_glosario" or i.get("source") == "augmented_existing"]
        
        selected = (original + augmented)[:10]
        
        for idx, (key, info) in enumerate(selected):
            # Construir ruta al .npy
            # key puede ser "A\\sample_0000.npy" o "1/sample_0000"
            clean_key = key.replace("\\", "/")
            if not clean_key.endswith(".npy"):
                clean_key += ".npy"
            
            npy_path = RAW_DIR / clean_key
            if not npy_path.exists():
                print(f"  [SKIP] No existe: {npy_path}")
                continue
            
            arr = np.load(npy_path)
            frames = npy_to_frames(arr)
            
            out_file = cat_dir / f"{cls}_{idx + 1}.json"
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(frames, f, separators=(",", ":"))
            
            total_files += 1
            new_signs.add(cls)
        
        print(f"  {cls}: {len(selected)} archivos -> {category}/")
    
    # Actualizar manifest
    manifest_path = OUT_DIR / "manifest.json"
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    else:
        manifest = {}
    
    # Asegurar que "abecedario" existe
    if "abecedario" not in manifest:
        manifest["abecedario"] = []
    
    for cls in sorted(new_signs):
        cat = get_category(cls)
        if cat not in manifest:
            manifest[cat] = []
        if cls not in manifest[cat]:
            manifest[cat].append(cls)
            manifest[cat].sort()
    
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"\nTotal: {total_files} archivos JSON generados")
    print(f"Clases: {len(new_signs)}")
    print(f"Manifest actualizado: {manifest_path}")

if __name__ == "__main__":
    main()
