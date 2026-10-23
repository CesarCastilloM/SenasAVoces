"""
Entrena SignClassifier con CrossEntropy + Supervised Contrastive Loss.
Uso:
  python train.py --epochs 60 --holdout-signer ana   # valida con una persona que no entrena
  python train.py --epochs 60 --holdout 5            # sin examples.json (optimista)

Guarda checkpoint en python_scripts/checkpoints/best_model.pt junto con
label map (idx -> nombre de sena) para inferencia posterior.

Con examples.json cada ejemplo se corrige por la proporcion de su video
(--no-aspect lo desactiva); el checkpoint lo anota y export_onnx.py lo pasa
a public/sign_model_meta.json para que el navegador haga lo mismo.
"""
import argparse
import json
import os
import sys

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, os.path.dirname(__file__))
import dataset
from dataset import SignSequenceDataset, load_manifest, load_index, INPUT_DIM
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
    ap.add_argument("--holdout", type=int, default=5, help="sin --holdout-signer: numero de ejemplo excluido del train (optimista)")
    ap.add_argument("--holdout-signer", default=None, help="persona de examples.json que no entrena y valida")
    ap.add_argument("--no-aspect", action="store_true", help="no corregir la proporcion de cada video")
    ap.add_argument("--data", default=None, help="carpeta training_data (por defecto public/training_data)")
    ap.add_argument("--checkpoint", default=os.path.join(CKPT_DIR, "best_model.pt"), help="donde guardar el mejor modelo")
    ap.add_argument("--hidden_dim", type=int, default=128)
    ap.add_argument("--embed_dim", type=int, default=64)
    ap.add_argument("--contrastive_weight", type=float, default=0.5)
    ap.add_argument("--patience", type=int, default=12, help="early stopping en epochs sin mejora de top5 val")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    if args.data:
        dataset.TRAINING_DATA_DIR = os.path.abspath(args.data)
    manifest = load_manifest()
    aspect_correct = load_index() is not None and not args.no_aspect
    split = (
        {"holdout_signer": args.holdout_signer} if args.holdout_signer
        else {"holdout_index": args.holdout}
    )
    if not args.holdout_signer:
        print("! Validando con el ejemplo n de cada sena (copias del mismo video): el resultado es optimista."
              " Usa --holdout-signer <persona> cuando haya varias personas.")
    train_base = SignSequenceDataset(manifest, only_holdout=False, aspect_correct=aspect_correct, **split)
    val_base = SignSequenceDataset(manifest, only_holdout=True, aspect_correct=aspect_correct, **split)

    # Mismo label_to_idx en train/val; val pierde las senas que train no conoce
    val_base.restrict_to_labels(train_base.label_to_idx)
    if len(val_base) == 0:
        raise SystemExit("No hay ejemplos de validacion: revisa --holdout-signer (nombre como en examples.json)")

    num_classes = train_base.num_classes()
    print(f"Clases: {num_classes} | Train examples: {len(train_base)} | Val (holdout) examples: {len(val_base)}"
          f" | proporcion corregida: {'si' if aspect_correct else 'no'}")

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

    os.makedirs(os.path.dirname(os.path.abspath(args.checkpoint)), exist_ok=True)
    # -1: la primera epoca siempre se guarda, aunque valide en 0% (pasa al
    # validar con una persona nueva); con 0.0 podia no guardarse nada.
    best_top5 = -1.0
    best_top1 = -1.0
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
                "aspect_corrected": aspect_correct,
                "holdout_signer": args.holdout_signer,
            }, args.checkpoint)
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                print(f"Early stopping en epoch {epoch} (sin mejora en {args.patience} epochs)")
                break

    print(f"\nMejor val_top5: {best_top5*100:.2f}%")
    print(f"Checkpoint guardado en: {args.checkpoint}")


if __name__ == "__main__":
    main()
