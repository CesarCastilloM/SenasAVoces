"""Test de predicciones con datos reales del dataset."""
import sys
import json
import numpy as np
import tensorflow as tf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lsm_features import extract_single_frame_features, extract_sequence_features, validate_landmarks

_ROOT = Path(__file__).resolve().parent.parent

# Cargar modelos y clases
static_model  = tf.keras.models.load_model(_ROOT / 'models/lsm_static_classifier.keras')
dynamic_model = tf.keras.models.load_model(_ROOT / 'models/lsm_dynamic_classifier_lstm.keras')
static_classes  = json.loads((_ROOT / 'models/lsm_static_classes.json').read_text())['classes']
dynamic_classes = json.loads((_ROOT / 'models/lsm_dynamic_classes.json').read_text())['classes']

DATA_DIR = _ROOT / 'data' / 'lsm_raw'

print(f"Clases estáticas  ({len(static_classes)}): {static_classes}")
print(f"Clases dinámicas  ({len(dynamic_classes)}): {dynamic_classes}")

def predict_static(landmarks):
    feats = extract_single_frame_features(landmarks).reshape(1, -1).astype(np.float32)
    probs = static_model.predict(feats, verbose=0)[0]
    idx = np.argmax(probs)
    return static_classes[idx], float(probs[idx])

def predict_dynamic(seq):
    feats = extract_sequence_features(list(seq), target_frames=30).reshape(1, -1).astype(np.float32)
    probs = dynamic_model.predict(feats, verbose=0)[0]
    idx = np.argmax(probs)
    return dynamic_classes[idx], float(probs[idx])

# ── Estáticas ──────────────────────────────────────────────────────────────
print("\n" + "="*55)
print("MODELO ESTÁTICO — una muestra por clase")
print("="*55)
print(f"  {'CLASE':<6} {'PRED':<6} {'CONF':>7}  {'OK':>4}")
print(f"  {'-'*5:<6} {'-'*5:<6} {'-'*6:>7}  {'-'*4:>4}")

correct = 0
total = 0
for cls in static_classes:
    cls_dir = DATA_DIR / cls
    if not cls_dir.exists():
        print(f"  {cls:<6} {'---':6} {'---':>7}  [sin datos]")
        continue
    npys = sorted(cls_dir.glob("*.npy"))
    if not npys:
        continue
    lm = np.load(npys[0])
    if lm.ndim == 3:
        lm = lm[0]  # tomar primer frame si es secuencia
    if not validate_landmarks(lm):
        print(f"  {cls:<6} {'---':6} {'---':>7}  [landmarks invalidos]")
        continue
    pred, conf = predict_static(lm)
    ok = "OK" if pred == cls else "XX"
    if pred == cls:
        correct += 1
    total += 1
    print(f"  {cls:<6} {pred:<6} {conf:>7.1%}  {ok}")

print(f"\n  Accuracy: {correct}/{total} = {correct/total:.0%}" if total else "")

# ── Dinámicas ──────────────────────────────────────────────────────────────
print("\n" + "="*55)
print("MODELO DINÁMICO — una muestra por clase")
print("="*55)
print(f"  {'CLASE':<6} {'PRED':<6} {'CONF':>7}  {'OK':>4}")
print(f"  {'-'*5:<6} {'-'*5:<6} {'-'*6:>7}  {'-'*4:>4}")

correct_d = 0
total_d = 0
for cls in dynamic_classes:
    cls_dir = DATA_DIR / cls
    if not cls_dir.exists():
        print(f"  {cls:<6} {'---':6} {'---':>7}  [sin datos]")
        continue
    npys = sorted(cls_dir.glob("*.npy"))
    if not npys:
        continue
    seq = np.load(npys[0])
    if seq.ndim != 3 or seq.shape[0] < 5:
        print(f"  {cls:<6} {'---':6} {'---':>7}  [forma incorrecta {seq.shape}]")
        continue
    pred, conf = predict_dynamic(seq)
    ok = "OK" if pred == cls else "XX"
    if pred == cls:
        correct_d += 1
    total_d += 1
    print(f"  {cls:<6} {pred:<6} {conf:>7.1%}  {ok}")

print(f"\n  Accuracy: {correct_d}/{total_d} = {correct_d/total_d:.0%}" if total_d else "")
