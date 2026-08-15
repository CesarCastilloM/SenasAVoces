"""
Exporta el modelo entrenado a ONNX para inferencia en el navegador
con onnxruntime-web. Genera:
  - python_scripts/checkpoints/sign_model.onnx
  - public/sign_labels.json  (mapa idx -> nombre de sena)
"""
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from model import SignClassifier
from dataset import INPUT_DIM

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "public")


def main():
    device = torch.device("cpu")
    ckpt = torch.load(os.path.join(CKPT_DIR, "best_model.pt"), map_location=device, weights_only=False)

    model = SignClassifier(
        input_dim=ckpt.get("input_dim", INPUT_DIM),
        hidden_dim=ckpt["hidden_dim"],
        num_classes=ckpt["num_classes"],
        embed_dim=ckpt["embed_dim"],
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    # Dummy input: (batch=1, seq_len=24, features=INPUT_DIM)
    dummy = torch.randn(1, 24, INPUT_DIM)

    onnx_path = os.path.join(CKPT_DIR, "sign_model.onnx")
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

    # Guardar labels en public/ para que el navegador los cargue
    labels = ckpt["labels"]
    label_map = {str(i): labels[i] for i in range(len(labels))}
    labels_path = os.path.join(PUBLIC_DIR, "sign_labels.json")
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(label_map, f, ensure_ascii=False, indent=2)
    print(f"Labels guardados: {labels_path} ({len(labels)} clases)")


if __name__ == "__main__":
    main()
