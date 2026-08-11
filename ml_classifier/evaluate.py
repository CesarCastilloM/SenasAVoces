"""
Evalua el checkpoint entrenado sobre el holdout, mostrando:
- top1/top5 accuracy global
- lista de fallos con su ranking completo (para comparar con el detector DTW)
Uso:
  python evaluate.py --holdout 5
"""
import argparse
import os
import sys

import torch
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(__file__))
from dataset import SignSequenceDataset, load_manifest
from model import SignClassifier

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--holdout", type=int, default=5)
    ap.add_argument("--checkpoint", type=str, default=os.path.join(CKPT_DIR, "best_model.pt"))
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)

    manifest = load_manifest()
    val_base = SignSequenceDataset(manifest, holdout_index=args.holdout, only_holdout=True)
    val_base.label_to_idx = ckpt["label_to_idx"]
    val_base.labels = ckpt["labels"]

    model = SignClassifier(
        input_dim=126,
        hidden_dim=ckpt["hidden_dim"],
        num_classes=ckpt["num_classes"],
        embed_dim=ckpt["embed_dim"],
    ).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    idx_to_label = {v: k for k, v in ckpt["label_to_idx"].items()}
    loader = DataLoader(val_base, batch_size=32, shuffle=False)

    top1_ok, top5_ok, total = 0, 0, 0
    failures = []

    with torch.no_grad():
        for seq, labels in loader:
            seq, labels = seq.to(device), labels.to(device)
            logits, _ = model(seq)
            probs = torch.softmax(logits, dim=1)
            top5_vals, top5_idx = probs.topk(5, dim=1)
            for i in range(seq.size(0)):
                true_label = idx_to_label[labels[i].item()]
                pred_names = [idx_to_label[idx.item()] for idx in top5_idx[i]]
                pred_scores = top5_vals[i].tolist()
                total += 1
                if pred_names[0] == true_label:
                    top1_ok += 1
                if true_label in pred_names:
                    top5_ok += 1
                else:
                    failures.append((true_label, list(zip(pred_names, pred_scores))))

    print(f"Total: {total}")
    print(f"Top-1: {top1_ok}/{total} ({100*top1_ok/total:.1f}%)")
    print(f"Top-5: {top5_ok}/{total} ({100*top5_ok/total:.1f}%)")

    if failures:
        print(f"\nFallos fuera de top-5 ({len(failures)}):")
        for true_label, preds in failures:
            pred_str = ", ".join(f"{n}:{s:.3f}" for n, s in preds)
            print(f"  {true_label:<20} top5=[{pred_str}]")


if __name__ == "__main__":
    main()
