"""
TRAIN FROM TEMPLATES — Entrena clasificador LSM desde plantillas NPZ (videos CDMX)
================================================================================

Usa las 348 plantillas ya procesadas en data/templates/ para entrenar un modelo
que reconozca señas en tiempo real sin depender de DTW (más rápido, más preciso).

Para cada plantilla (secuencia de landmarks de manos):
  - Extrae features estadísticos (media, std, min, max, percentiles) → MLP
  - Opcional: usa la secuencia completa → LSTM (mejor para dinámicas)

Salida:
  - modelo_lsm_mlp.tflite  (para señas estáticas + números)
  - modelo_lsm_lstm.tflite (opcional, para señas dinámicas)
  - label_map.json
  - scaler_params.json

Uso:
    python backend/train_from_templates.py --categorias numeros,colores,saludos
    python backend/train_from_templates.py --todas
"""

from __future__ import annotations
import os, sys, json, time, argparse
from pathlib import Path
from collections import defaultdict
import numpy as np
import cv2

# ML
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
import tensorflow as tf
from tensorflow import keras

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent
sys.path.insert(0, str(_HERE))

TEMPLATES_DIR = _ROOT / "data" / "templates"
MODELS_DIR = _ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------
# Carga de plantillas
# ---------------------------------------------------------------------
def load_templates(categorias: list[str] | None = None, min_frames: int = 8) -> list[dict]:
    """
    Carga plantillas NPZ. Retorna lista de dicts:
      {label, category, hands: (T,2,21,3), is_dynamic, motion_score}
    """
    index_path = TEMPLATES_DIR / "index.json"
    if not index_path.exists():
        print(f"[ERR] No existe {index_path}. Corre train_scan.py o train_from_videos.py primero.")
        sys.exit(1)

    index = json.loads(index_path.read_text(encoding='utf-8'))
    data = []

    for cat_name, cat_entries in index.items():
        if categorias and cat_name not in categorias:
            continue
        print(f"[CARGA] {cat_name}...")
        for entry in cat_entries:
            slug = entry.get('slug') or entry.get('label', '').upper().replace(' ', '_')
            label = entry.get('label', slug)
            path = TEMPLATES_DIR / cat_name / f"{slug}.npz"
            if not path.exists():
                continue
            try:
                npz = np.load(path)
                hands = npz['hands'].astype(np.float32)  # (T, 2, 21, 3)
                if hands.shape[0] < min_frames:
                    continue
                # Detectar si es dinámica por variación
                flat = hands[:, 0].reshape(hands.shape[0], -1)
                scale = float(np.mean(np.linalg.norm(flat, axis=1))) or 1e-6
                diffs = np.linalg.norm(np.diff(flat, axis=0), axis=1) / scale
                motion = float(np.mean(diffs))
                is_dynamic = motion > 0.06
                data.append({
                    'label': label,
                    'category': cat_name,
                    'hands': hands,
                    'is_dynamic': is_dynamic,
                    'motion': motion,
                    'frames': hands.shape[0],
                })
            except Exception as e:
                print(f"  [WARN] {path.name}: {e}")

    print(f"\n[OK] {len(data)} plantillas cargadas")
    return data


# ---------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------
def normalize_hand(hand: np.ndarray) -> np.ndarray:
    """
    Normaliza una secuencia de landmarks de UNA mano para invariancia a
    posición y escala. hand: (T, 21, 3) -> (T, 21, 3) normalizado.
    - Centra cada frame en la muñeca (landmark 0)
    - Escala por la distancia muñeca→middle_mcp (landmark 9)
    - Si la mano está vacía (todo ceros), devuelve ceros
    """
    if hand.size == 0 or np.all(hand == 0):
        return hand
    out = hand.copy().astype(np.float32)
    for t in range(out.shape[0]):
        wrist = out[t, 0].copy()
        # Si frame es cero (no hay mano), saltar
        if np.all(out[t] == 0):
            continue
        out[t] -= wrist  # centrar
        # Escala = distancia wrist (0) a middle finger MCP (9)
        scale = float(np.linalg.norm(out[t, 9]))
        if scale > 1e-6:
            out[t] /= scale
    return out


def extract_features_static(hands: np.ndarray) -> np.ndarray:
    """
    Extrae features estadísticos de la secuencia para MLP.
    hands: (T, 2, 21, 3)
    Retorna: vector de features normalizados.
    """
    # Normalizar cada mano por separado
    h0 = normalize_hand(hands[:, 0])  # (T, 21, 3)
    h1 = normalize_hand(hands[:, 1]) if hands.shape[1] > 1 else np.zeros_like(h0)

    def _stats(arr: np.ndarray) -> np.ndarray:
        """arr: (T, N) -> stats vector"""
        mean = np.mean(arr, axis=0)
        std = np.std(arr, axis=0)
        min_ = np.min(arr, axis=0)
        max_ = np.max(arr, axis=0)
        p25 = np.percentile(arr, 25, axis=0)
        p75 = np.percentile(arr, 75, axis=0)
        # Diferencias entre frames (velocidad)
        if arr.shape[0] > 1:
            vel = np.diff(arr, axis=0)
            vmean = np.mean(vel, axis=0)
            vstd = np.std(vel, axis=0)
            vmax = np.max(np.abs(vel), axis=0)
        else:
            vmean = vstd = vmax = np.zeros(arr.shape[1])
        return np.concatenate([mean, std, min_, max_, p25, p75, vmean, vstd, vmax])

    # Aplanar cada frame: (T, 21*3=63)
    f0 = h0.reshape(h0.shape[0], -1)
    f1 = h1.reshape(h1.shape[0], -1)
    stats0 = _stats(f0)
    stats1 = _stats(f1)
    return np.concatenate([stats0, stats1])  # ~504 dims


def extract_features_sequence(hands: np.ndarray, target_len: int = 30) -> np.ndarray:
    """
    Para LSTM: retorna secuencia fija de landmarks.
    hands: (T, 2, 21, 3) -> (target_len, 126)  [63 por mano]
    """
    T = hands.shape[0]
    # Solo mano 0 y 1 aplanadas
    seq = np.zeros((T, 126), dtype=np.float32)
    for t in range(T):
        seq[t, :63] = hands[t, 0].flatten()
        seq[t, 63:] = hands[t, 1].flatten()
    # Interpolar/resample a target_len
    if T == target_len:
        return seq
    elif T < target_len:
        # Padding al final
        pad = np.zeros((target_len - T, 126), dtype=np.float32)
        return np.concatenate([seq, pad], axis=0)
    else:
        # Sub-sample uniforme
        idx = np.linspace(0, T-1, target_len).astype(int)
        return seq[idx]


# ---------------------------------------------------------------------
# Augmentación de datos (genera variaciones sintéticas)
# ---------------------------------------------------------------------
def augment_sequence(hands: np.ndarray, n_augment: int = 20, noise_std: float = 0.015,
                     scale_range: float = 0.15, shift_range: float = 0.10,
                     rot_range: float = 0.20) -> list[np.ndarray]:
    """
    Genera n_augment variaciones de la secuencia de landmarks.
    Cada variación: ruido gaussiano + escalado + traslación + rotación 2D + sub-sampling temporal.
    Retorna lista de arrays (T, 2, 21, 3)
    """
    originals = [hands]
    T = hands.shape[0]
    for _ in range(n_augment):
        h = hands.copy()
        # 1. Ruido gaussiano por landmark
        noise = np.random.normal(0, noise_std, h.shape).astype(np.float32)
        h = h + noise
        # 2. Escalado uniforme (zoom in/out)
        scale = 1.0 + np.random.uniform(-scale_range, scale_range)
        h[:, :, :, :2] *= scale
        # 3. Traslación
        shift = np.random.uniform(-shift_range, shift_range, size=(2,))
        h[:, :, :, 0] += shift[0]
        h[:, :, :, 1] += shift[1]
        # 4. Rotación 2D pequeña (radianes)
        angle = np.random.uniform(-rot_range, rot_range)
        cos_a, sin_a = np.cos(angle), np.sin(angle)
        x = h[..., 0].copy()
        y = h[..., 1].copy()
        h[..., 0] = cos_a * x - sin_a * y
        h[..., 1] = sin_a * x + cos_a * y
        # 5. Drop ocasional de algún frame (simula pérdida de detección)
        if T > 4 and np.random.random() < 0.3:
            drop_idx = np.random.randint(T)
            h[drop_idx] = 0.0
        originals.append(h.astype(np.float32))
    return originals


# ---------------------------------------------------------------------
# Entrenamiento MLP (para estáticas)
# ---------------------------------------------------------------------
def train_mlp(X: np.ndarray, y: np.ndarray, labels: list[str],
              epochs: int = 100, batch_size: int = 32) -> tuple:
    """
    X: (N, features)
    y: (N,) int encoded
    Retorna: (model, scaler, label_encoder, history)
    """
    # Verificar que tenemos suficientes muestras por clase
    unique, counts = np.unique(y, return_counts=True)
    min_count = counts.min()
    print(f"  Muestras por clase: min={min_count}, max={counts.max()}, total clases={len(unique)}")

    if min_count < 2:
        # Fallback: split simple sin estratificar
        print("  [WARN] Algunas clases tienen solo 1 muestra; split sin estratificar")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=None
        )
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

    # Escalar
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # Modelo
    n_features = X.shape[1]
    n_classes = len(labels)

    # Modelo compacto con regularización L2 (mejor para datasets pequeños)
    reg = keras.regularizers.l2(1e-4)
    model = keras.Sequential([
        keras.layers.Input(shape=(n_features,)),
        keras.layers.Dense(128, activation='relu', kernel_regularizer=reg),
        keras.layers.Dropout(0.5),
        keras.layers.Dense(64, activation='relu', kernel_regularizer=reg),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(n_classes, activation='softmax')
    ])

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )

    callbacks = [
        keras.callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=8, min_lr=1e-6),
    ]

    print(f"\n[MLP] Entrenando con {len(X_train)} muestras, {n_features} features, {n_classes} clases...")
    history = model.fit(
        X_train_s, y_train,
        validation_split=0.15,
        epochs=epochs,
        batch_size=batch_size,
        callbacks=callbacks,
        verbose=1
    )

    # Evaluar
    loss, acc = model.evaluate(X_test_s, y_test, verbose=0)
    print(f"\n[MLP] Test accuracy: {acc:.1%}")

    # Reporte por clase
    y_pred = model.predict(X_test_s, verbose=0).argmax(axis=1)
    print("\nReporte por clase (top 10 confusions):")
    print(classification_report(y_test, y_pred, target_names=labels, zero_division=0))

    return model, scaler, (X_test_s, y_test, y_pred)


# ---------------------------------------------------------------------
# Entrenamiento LSTM (para dinámicas)
# ---------------------------------------------------------------------
def train_lstm(X: np.ndarray, y: np.ndarray, labels: list[str],
               seq_len: int = 30, epochs: int = 80, batch_size: int = 32) -> tuple:
    """
    X: (N, seq_len, features)
    y: (N,) int encoded
    """
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    n_classes = len(labels)

    model = keras.Sequential([
        keras.layers.Input(shape=(seq_len, X.shape[2])),
        keras.layers.Masking(mask_value=0.0),
        keras.layers.LSTM(64, return_sequences=True, dropout=0.3, recurrent_dropout=0.2),
        keras.layers.LSTM(32, dropout=0.3, recurrent_dropout=0.2),
        keras.layers.Dense(32, activation='relu'),
        keras.layers.Dense(n_classes, activation='softmax')
    ])

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )

    callbacks = [
        keras.callbacks.EarlyStopping(monitor='val_loss', patience=12, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=6, min_lr=1e-6),
    ]

    print(f"\n[LSTM] Entrenando con {len(X_train)} secuencias, {seq_len} frames, {n_classes} clases...")
    history = model.fit(
        X_train, y_train,
        validation_split=0.15,
        epochs=epochs,
        batch_size=batch_size,
        callbacks=callbacks,
        verbose=1
    )

    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\n[LSTM] Test accuracy: {acc:.1%}")

    y_pred = model.predict(X_test, verbose=0).argmax(axis=1)
    print(classification_report(y_test, y_pred, target_names=labels, zero_division=0))

    return model, (X_test, y_test, y_pred)


# ---------------------------------------------------------------------
# Exportar a TFLite
# ---------------------------------------------------------------------
def export_tflite(model, path: Path, quantize: bool = False):
    """Exporta modelo a TFLite usando la API actual de Keras 3 (model.export())."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        saved_model_path = os.path.join(tmpdir, "saved_model")
        # Keras 3: model.export() crea SavedModel compatible con TFLite
        try:
            model.export(saved_model_path)
        except Exception as e:
            # Fallback: guardar .keras y reconvertir
            print(f"  [WARN] model.export() falló ({e}); usando fallback .keras")
            keras_path = os.path.join(tmpdir, "model.keras")
            model.save(keras_path)
            # Recargar y exportar
            reloaded = keras.models.load_model(keras_path)
            reloaded.export(saved_model_path)

        converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_path)
        if quantize:
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
        tflite_model = converter.convert()

    path.write_bytes(tflite_model)
    print(f"[OK] Modelo TFLite: {path} ({len(tflite_model)/1024:.1f} KB)")

    # También guardar en formato Keras nativo (.keras) como respaldo
    keras_backup = path.with_suffix('.keras')
    model.save(str(keras_backup))
    print(f"[OK] Modelo Keras: {keras_backup}")


def export_scaler(scaler: StandardScaler, path: Path):
    data = {
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "var": scaler.var_.tolist(),
        "n_features": int(scaler.n_features_in_)
    }
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(f"[OK] Scaler: {path}")


def export_labels(le: LabelEncoder, path: Path):
    mapping = {int(i): str(label) for i, label in enumerate(le.classes_)}
    path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"[OK] Labels: {path}")


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--categorias", default="numeros",
                        help="Categorías separadas por coma (ej: numeros,colores,saludos)")
    parser.add_argument("--todas", action="store_true",
                        help="Usar todas las categorías disponibles")
    parser.add_argument("--min-frames", type=int, default=8,
                        help="Mínimo de frames para considerar una plantilla")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--lstm", action="store_true",
                        help="También entrenar modelo LSTM para señas dinámicas")
    parser.add_argument("--seq-len", type=int, default=30,
                        help="Longitud de secuencia para LSTM")
    args = parser.parse_args()

    cats = None if args.todas else args.categorias.split(",")

    # 1. Cargar
    print("="*60)
    print("  TRAIN FROM TEMPLATES — Entrenamiento desde videos CDMX")
    print("="*60)
    data = load_templates(categorias=cats, min_frames=args.min_frames)

    if not data:
        print("[ERR] No se cargaron plantillas.")
        return

    # 2. Separar estáticas vs dinámicas
    statics = [d for d in data if not d['is_dynamic']]
    dynamics = [d for d in data if d['is_dynamic']]
    print(f"\nClasificación automática:")
    print(f"  Estáticas:  {len(statics)} ({len(statics)/len(data)*100:.1f}%)")
    print(f"  Dinámicas:  {len(dynamics)} ({len(dynamics)/len(data)*100:.1f}%)")

    # 3. Entrenar MLP (todas, pero funciona mejor en estáticas)
    print("\n" + "="*60)
    print("  EXTRACTING FEATURES FOR MLP (con augmentación)")
    print("="*60)
    # Generar múltiples muestras por clase via augmentación
    N_AUGMENT = 25  # 25 variaciones por plantilla = 26 total (original + 25)
    X_mlp_list = []
    labels_aug = []
    for d in data:
        label = d['label']
        hands = d['hands']
        # Generar variaciones
        variations = augment_sequence(hands, n_augment=N_AUGMENT)
        for var in variations:
            feat = extract_features_static(var)
            X_mlp_list.append(feat)
            labels_aug.append(label)
    X_mlp = np.array(X_mlp_list)
    print(f"  Plantillas originales: {len(data)}")
    print(f"  Muestras con augmentación: {len(X_mlp_list)} ({N_AUGMENT+1}x)")

    le = LabelEncoder()
    y = le.fit_transform(labels_aug)
    print(f"Features shape: {X_mlp.shape}")

    model_mlp, scaler, _ = train_mlp(X_mlp, y, le.classes_, epochs=args.epochs)

    # Exportar MLP
    export_tflite(model_mlp, MODELS_DIR / "modelo_lsm_mlp.tflite")
    export_scaler(scaler, MODELS_DIR / "scaler_mlp.json")
    export_labels(le, MODELS_DIR / "label_map.json")

    # 4. Entrenar LSTM opcional (solo dinámicas, o todas)
    if args.lstm and len(dynamics) > 10:
        print("\n" + "="*60)
        print("  EXTRACTING SEQUENCES FOR LSTM (dinámicas)")
        print("="*60)
        X_lstm = np.array([extract_features_sequence(d['hands'], args.seq_len) for d in dynamics])
        labels_dyn = [d['label'] for d in dynamics]
        le_dyn = LabelEncoder()
        y_dyn = le_dyn.fit_transform(labels_dyn)

        model_lstm, _ = train_lstm(X_lstm, y_dyn, le_dyn.classes_,
                                   seq_len=args.seq_len, epochs=args.epochs)
        export_tflite(model_lstm, MODELS_DIR / "modelo_lsm_lstm.tflite", quantize=True)
        export_labels(le_dyn, MODELS_DIR / "label_map_lstm.json")

    print("\n" + "="*60)
    print("  ENTRENAMIENTO COMPLETADO")
    print("="*60)
    print(f"Modelos en: {MODELS_DIR}")
    print("\nArchivos generados:")
    for f in MODELS_DIR.glob("*.tflite"):
        size = f.stat().st_size / 1024
        print(f"  • {f.name} ({size:.1f} KB)")
    for f in MODELS_DIR.glob("*.json"):
        print(f"  • {f.name}")


if __name__ == "__main__":
    main()
