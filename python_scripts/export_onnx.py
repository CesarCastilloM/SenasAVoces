"""
Exporta el modelo entrenado a ONNX para inferencia en el navegador
con onnxruntime-web. Genera:
  - python_scripts/checkpoints/sign_model.onnx
  - public/sign_model.onnx       (copia que carga el navegador)
  - public/sign_labels.json      (mapa idx -> nombre de sena)
  - public/sign_model_meta.json  (como preparar la entrada, p. ej. si el
                                  modelo espera la proporcion corregida)

Uso:
  python export_onnx.py
"""
import argparse
import json
import os
import shutil
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from model import SignClassifier
from dataset import INPUT_DIM

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=os.path.join(CKPT_DIR, "best_model.pt"))
    ap.add_argument("--public-dir", default=PUBLIC_DIR, help="carpeta public/ de la app")
    args = ap.parse_args()

    device = torch.device("cpu")
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)

    model = SignClassifier(
        input_dim=ckpt.get("input_dim", INPUT_DIM),
        hidden_dim=ckpt["hidden_dim"],
        num_classes=ckpt["num_classes"],
        embed_dim=ckpt["embed_dim"],
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    # Dummy input: (batch=1, seq_len=24, features=INPUT_DIM)
    dummy = torch.randn(1, 24, ckpt.get("input_dim", INPUT_DIM))

    onnx_path = os.path.join(os.path.dirname(os.path.abspath(args.checkpoint)), "sign_model.onnx")
    torch.onnx.export(
        model,
        dummy,
        onnx_path,
        input_names=["input"],
        output_names=["logits", "embed"],
        dynamic_axes={
            "input": {0: "batch"},
            "logits": {0: "batch"},
            "embed": {0: "batch"},
        },
        opset_version=14,
        dynamo=False,
    )
    print(f"ONNX exportado: {onnx_path}")

    # Modelo, labels y metadatos juntos en public/: el navegador los carga a la vez
    os.makedirs(args.public_dir, exist_ok=True)
    shutil.copyfile(onnx_path, os.path.join(args.public_dir, "sign_model.onnx"))

    labels = ckpt["labels"]
    label_map = {str(i): labels[i] for i in range(len(labels))}
    labels_path = os.path.join(args.public_dir, "sign_labels.json")
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(label_map, f, ensure_ascii=False, indent=2)
    print(f"Labels guardados: {labels_path} ({len(labels)} clases)")

    meta = {
        "aspectCorrected": bool(ckpt.get("aspect_corrected", False)),
        "inputDim": ckpt.get("input_dim", INPUT_DIM),
        "holdoutSigner": ckpt.get("holdout_signer"),
        "valTop1": ckpt.get("val_top1"),
        "valTop5": ckpt.get("val_top5"),
    }
    meta_path = os.path.join(args.public_dir, "sign_model_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"Metadatos: {meta_path} {meta}")


if __name__ == "__main__":
    main()
