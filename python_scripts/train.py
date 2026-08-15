"""
Entrena SignClassifier con CrossEntropy + Supervised Contrastive Loss.
Uso:
  python train.py --epochs 60 --holdout 5

Guarda checkpoint en ml_classifier/checkpoints/best_model.pt junto con
label map (idx -> nombre de sena) para inferencia posterior.
"""
import argparse
import json
import os
import sys

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(__file__))
from dataset import SignSequenceDataset, load_manifest, INPUT_DIM
from augment import AugmentedDataset
from model import SignClassifier, supervised_contrastive_loss

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")


def evaluate(model, loader, device, topk=(1, 5)):
    model.eval()
    correct = {k: 0 for k in topk}
    total = 0
    with torch.no_grad():
        for seq, labels in loader:
            seq, labels = seq.to(device), labels.to(device)
            logits, _ = model(seq)
            maxk = max(topk)
            _, pred_topk = logits.topk(maxk, dim=1)
            for k in topk:
                match = (pred_topk[:, :k] == labels.unsqueeze(1)).any(dim=1)
                correct[k] += match.sum().item()
            total += labels.size(0)
    return {k: correct[k] / total for k in topk}, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch_size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--holdout", type=int, default=5, help="indice de ejemplo excluido del train, usado para validacion honesta")
    ap.add_argument("--hidden_dim", type=int, default=128)
    ap.add_argument("--embed_dim", type=int, default=64)
    ap.add_argument("--contrastive_weight", type=float, default=0.5)
    ap.add_argument("--patience", type=int, default=12, help="early stopping en epochs sin mejora de top5 val")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    manifest = load_manifest()
    train_base = SignSequenceDataset(manifest, holdout_index=args.holdout, only_holdout=False)
    val_base = SignSequenceDataset(manifest, holdout_index=args.holdout, only_holdout=True)

    # Asegurar mismo label_to_idx en train/val (val puede tener menos clases visibles pero usa el mapa de train)
    val_base.label_to_idx = train_base.label_to_idx
    val_base.labels = train_base.labels

    num_classes = train_base.num_classes()
    print(f"Clases: {num_classes} | Train examples: {len(train_base)} | Val (holdout) examples: {len(val_base)}")

    train_ds = AugmentedDataset(train_base, augment_prob=0.8)
    val_ds = val_base  # sin augment en validacion

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    model = SignClassifier(
        input_dim=INPUT_DIM,
        hidden_dim=args.hidden_dim,
        num_classes=num_classes,
        embed_dim=args.embed_dim,
    ).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    ce_loss_fn = torch.nn.CrossEntropyLoss()

    os.makedirs(CKPT_DIR, exist_ok=True)
    best_top5 = 0.0
    best_top1 = 0.0
    epochs_no_improve = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss, total_ce, total_con = 0.0, 0.0, 0.0
        n_batches = 0
        for seq, labels in train_loader:
            seq, labels = seq.to(device), labels.to(device)
            logits, embed = model(seq)
            ce = ce_loss_fn(logits, labels)
            con = supervised_contrastive_loss(embed, labels)
            loss = ce + args.contrastive_weight * con

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()

            total_loss += loss.item()
            total_ce += ce.item()
            total_con += con.item()
            n_batches += 1
        scheduler.step()

        val_acc, val_total = evaluate(model, val_loader, device, topk=(1, 5))
        print(
            f"Epoch {epoch:3d}/{args.epochs} | loss={total_loss/n_batches:.4f} "
            f"(ce={total_ce/n_batches:.4f} con={total_con/n_batches:.4f}) | "
            f"val_top1={val_acc[1]*100:.1f}% val_top5={val_acc[5]*100:.1f}% (n={val_total})"
        )

        improved = (val_acc[5] > best_top5) or (val_acc[5] == best_top5 and val_acc[1] > best_top1)
        if improved:
            best_top5 = val_acc[5]
            best_top1 = val_acc[1]
            epochs_no_improve = 0
            torch.save({
                "model_state": model.state_dict(),
                "num_classes": num_classes,
                "hidden_dim": args.hidden_dim,
                "embed_dim": args.embed_dim,
                "input_dim": INPUT_DIM,
                "label_to_idx": train_base.label_to_idx,
                "labels": train_base.labels,
                "val_top1": val_acc[1],
                "val_top5": val_acc[5],
            }, os.path.join(CKPT_DIR, "best_model.pt"))
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                print(f"Early stopping en epoch {epoch} (sin mejora en {args.patience} epochs)")
                break

    print(f"\nMejor val_top5: {best_top5*100:.2f}%")
    print(f"Checkpoint guardado en: {os.path.join(CKPT_DIR, 'best_model.pt')}")


if __name__ == "__main__":
    main()
