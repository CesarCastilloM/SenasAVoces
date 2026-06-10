"""
LSM Trainer — Entrenamiento de modelos ML para reconocimiento de LSM
======================================================================

Entrena dos modelos:
1. Clasificador ESTÁTICO (MLP/RandomForest) — 32 clases:
   alfabeto sin letras dinámicas (incluye CH, LL) + números 1-9
2. Clasificador DINÁMICO (LSTM/1D-CNN) — 18 clases:
   J, K, Ñ, Q, X, Z, RR + números 10-20

Exporta a TFLite con cuantización para uso en ESP32/mobile.

Uso:
    # Entrenar modelo estático
    python backend/lsm_trainer.py --mode static --epochs 100
    
    # Entrenar modelo dinámico  
    python backend/lsm_trainer.py --mode dynamic --epochs 150
    
    # Entrenar ambos
    python backend/lsm_trainer.py --mode both
    
    # Solo ver estadísticas del dataset
    python backend/lsm_trainer.py --stats
"""

from __future__ import annotations
import os
import sys
import json
import argparse
import pickle
from pathlib import Path
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass

import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.preprocessing import LabelEncoder

# Importar nuestro extractor de features
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lsm_features import extract_single_frame_features, extract_sequence_features, validate_landmarks
from lsm_data_collector import DATA_DIR, METADATA_PATH, DYNAMIC_SIGNS, NUMBERS_DYNAMIC

# =============================================================================
# Configuración
# =============================================================================

_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = _ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# Mapeo de clases
# Alfabeto español de LSM incluyendo dígrafos LL, RR (CH omitido)
SPANISH_ALPHABET = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL',
    'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'RR', 'S', 'T', 'U', 'V', 'W', 'X',
    'Y', 'Z'
]
# Números estáticos 1-9; los 10-20 son dinámicos (NUMBERS_DYNAMIC)
STATIC_NUMBERS = [str(i) for i in range(1, 10)]

# Estáticas: alfabeto sin las letras dinámicas (incluye LL) + números 1-9
STATIC_CLASSES = [c for c in SPANISH_ALPHABET if c not in DYNAMIC_SIGNS] + STATIC_NUMBERS
# Dinámicas: letras con movimiento (J, K, Ñ, Q, X, Z, RR) + números 10-20
DYNAMIC_CLASSES = [c for c in SPANISH_ALPHABET if c in DYNAMIC_SIGNS] + sorted(NUMBERS_DYNAMIC, key=int)

# Hiperparámetros
RANDOM_SEED = 42
TEST_SIZE = 0.15
VAL_SIZE = 0.15


# =============================================================================
# Carga de datos
# =============================================================================

def load_dataset(mode: str = "static", min_samples: int = 3) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """
    Carga el dataset de landmarks y extrae features.
    
    Args:
        mode: 'static' o 'dynamic'
        min_samples: excluir clases con menos de este numero de muestras
    
    Returns:
        (X, y, class_names) donde:
        - X: array de features (N, D) para estático, (N, 30, D) para dinámico
        - y: array de etiquetas (N,)
        - class_names: lista de nombres de clases
    """
    if not METADATA_PATH.exists():
        raise FileNotFoundError(f"No existe metadata en {METADATA_PATH}. Ejecuta lsm_data_collector primero.")
    
    metadata = json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    
    # Contar muestras por clase para filtrar las que tienen muy pocas
    from collections import Counter
    class_counts = Counter(
        info["class"] for info in metadata.get("samples", {}).values()
        if info.get("mode", "static") == mode
    )
    excluded = [c for c, n in class_counts.items() if n < min_samples]
    if excluded:
        print(f"  [INFO] Clases excluidas por < {min_samples} muestras: {sorted(excluded)}")
    
    X_list = []
    y_list = []
    
    target_classes = STATIC_CLASSES if mode == "static" else DYNAMIC_CLASSES
    
    print(f"\nCargando dataset {mode}...")
    print(f"Clases objetivo: {len(target_classes)}")
    
    for sample_path, info in metadata.get("samples", {}).items():
        class_name = info["class"]
        sample_mode = info.get("mode", "static")
        
        # Filtrar por modo
        if sample_mode != mode:
            continue
        
        # Filtrar por clase objetivo
        if class_name not in target_classes:
            continue
        
        # Filtrar clases con muy pocas muestras
        if class_name in excluded:
            continue
        
        # Cargar muestra
        filepath = DATA_DIR / sample_path
        if not filepath.exists():
            continue
        
        try:
            landmarks = np.load(filepath)
            
            # Extraer features según modo
            if mode == "static":
                # landmarks shape: (21, 3) o (N, 21, 3) promediado
                if landmarks.ndim == 3 and landmarks.shape[0] > 1:
                    # Promedio temporal si es necesario
                    landmarks = landmarks[0]  # Tomar primer frame
                
                if not validate_landmarks(landmarks):
                    continue
                
                features = extract_single_frame_features(landmarks)
                X_list.append(features)
                y_list.append(class_name)
            
            else:  # dynamic
                # landmarks shape: (30, 21, 3) o similar
                if landmarks.ndim == 3 and landmarks.shape[0] >= 10:
                    # Validar frames
                    valid_frames = sum(1 for f in landmarks if validate_landmarks(f))
                    if valid_frames < landmarks.shape[0] * 0.5:
                        continue
                    
                    # Usar función de features de secuencia.
                    # landmarks es (30, 21, 3); se desempaqueta en lista de frames (21, 3).
                    features = extract_sequence_features(list(landmarks), target_frames=30)
                    X_list.append(features)
                    y_list.append(class_name)
        
        except Exception as e:
            print(f"  [WARN] Error cargando {sample_path}: {e}")
            continue
    
    if not X_list:
        raise ValueError(f"No se encontraron muestras válidas para modo {mode}")
    
    X = np.stack(X_list)
    y = np.array(y_list)
    
    # Determinar clases presentes
    unique_classes = sorted(set(y))
    
    print(f"  Muestras cargadas: {len(X)}")
    print(f"  Features dim: {X.shape[1:]}")
    print(f"  Clases presentes: {len(unique_classes)}")
    
    return X, y, unique_classes


def augment_static_sample(landmarks: np.ndarray, noise_factor: float = 0.02) -> np.ndarray:
    """
    Aumenta una muestra estática con ruido gaussiano.
    
    Args:
        landmarks: array (21, 3)
        noise_factor: desviación estándar del ruido
    
    Returns:
        landmarks aumentados
    """
    noise = np.random.randn(*landmarks.shape) * noise_factor
    return landmarks + noise


def augment_dataset(X: np.ndarray, y: np.ndarray, 
                    augmentation_factor: int = 3) -> Tuple[np.ndarray, np.ndarray]:
    """
    Aumenta el dataset con variaciones sintéticas.
    
    Para estáticas: añade ruido gaussiano
    """
    X_aug = [X]
    y_aug = [y]
    
    for _ in range(augmentation_factor - 1):
        X_noisy = X + np.random.randn(*X.shape) * 0.02
        X_aug.append(X_noisy)
        y_aug.append(y.copy())
    
    return np.concatenate(X_aug), np.concatenate(y_aug)


# =============================================================================
# Modelos
# =============================================================================

def build_static_mlp(input_dim: int, n_classes: int, 
                     dropout: float = 0.3) -> tf.keras.Model:
    """
    Construye MLP para clasificación estática.
    
    Arquitectura:
    - Input: input_dim features
    - Hidden: 256 → 128 → 64 (con dropout)
    - Output: softmax sobre n_classes
    """
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(input_dim,)),
        tf.keras.layers.Dense(256, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(dropout),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(dropout),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(n_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model


def build_dynamic_lstm(input_shape: Tuple[int, ...], n_classes: int,
                       lstm_units: int = 64) -> tf.keras.Model:
    """
    Construye LSTM para clasificación dinámica de secuencias.
    
    Arquitectura:
    - Input: (30, features_dim)
    - LSTM bidireccional
    - Dense layers
    - Output: softmax
    """
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=input_shape),
        tf.keras.layers.Masking(mask_value=0.0),
        tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(lstm_units, return_sequences=True)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Bidirectional(tf.keras.layers.LSTM(lstm_units // 2)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.Dense(n_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model


def build_dynamic_cnn(input_shape: Tuple[int, ...], n_classes: int) -> tf.keras.Model:
    """
    Alternativa: 1D-CNN para secuencias temporales.
    """
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=input_shape),
        tf.keras.layers.Masking(mask_value=0.0),
        tf.keras.layers.Conv1D(64, 5, activation='relu', padding='same'),
        tf.keras.layers.MaxPooling1D(2),
        tf.keras.layers.Conv1D(128, 3, activation='relu', padding='same'),
        tf.keras.layers.MaxPooling1D(2),
        tf.keras.layers.Conv1D(128, 3, activation='relu', padding='same'),
        tf.keras.layers.GlobalAveragePooling1D(),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.4),
        tf.keras.layers.Dense(n_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model


def build_dynamic_dense(input_dim: int, n_classes: int) -> tf.keras.Model:
    """
    Modelo Dense para features dinámicas aplanadas (alternativa al LSTM).
    Usa las features extraídas de secuencia (pose + velocidad) como vector plano.
    """
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(input_dim,)),
        tf.keras.layers.Dense(512, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(256, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(n_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model


# =============================================================================
# Entrenamiento
# =============================================================================

def train_static_model(X: np.ndarray, y: np.ndarray, 
                       class_names: List[str],
                       epochs: int = 100,
                       batch_size: int = 32,
                       use_rf: bool = False) -> Tuple[tf.keras.Model, dict]:
    """
    Entrena modelo para señas estáticas.
    
    Args:
        X: features (N, D)
        y: etiquetas (N,)
        class_names: nombres de clases
        epochs: épocas de entrenamiento
        batch_size: tamaño de batch
        use_rf: si True, usa RandomForest en vez de MLP
    
    Returns:
        (modelo, métricas)
    """
    print("\n" + "="*60)
    print("ENTRENAMIENTO: Modelo Estático")
    print("="*60)
    
    # Codificar etiquetas
    le = LabelEncoder()
    y_encoded = le.fit_transform(y)
    
    # Split train/val/test
    # Desactivar stratify si alguna clase tiene menos de 2 muestras
    from collections import Counter
    min_count = min(Counter(y_encoded).values())
    use_stratify = min_count >= 2
    if not use_stratify:
        print(f"  [WARN] {sum(1 for c in Counter(y_encoded).values() if c < 2)} clase(s) con 1 muestra — stratify desactivado")
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y_encoded, test_size=TEST_SIZE + VAL_SIZE,
        random_state=RANDOM_SEED, stratify=y_encoded if use_stratify else None
    )
    use_stratify2 = min(Counter(y_temp).values()) >= 2
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=TEST_SIZE / (TEST_SIZE + VAL_SIZE),
        random_state=RANDOM_SEED, stratify=y_temp if use_stratify2 else None
    )
    
    print(f"\nDataset split:")
    print(f"  Train: {len(X_train)} ({len(X_train)/len(X)*100:.1f}%)")
    print(f"  Val:   {len(X_val)} ({len(X_val)/len(X)*100:.1f}%)")
    print(f"  Test:  {len(X_test)} ({len(X_test)/len(X)*100:.1f}%)")
    
    if use_rf:
        # Random Forest (más rápido, buena baseline)
        print("\nEntrenando Random Forest...")
        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=20,
            random_state=RANDOM_SEED,
            n_jobs=-1
        )
        model.fit(X_train, y_train)
        
        # Evaluar
        y_pred = model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        print(f"\nTest Accuracy: {accuracy:.4f}")
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=le.classes_))
        
        # Guardar
        model_path = MODELS_DIR / "lsm_static_classifier.pkl"
        with open(model_path, 'wb') as f:
            pickle.dump({'model': model, 'label_encoder': le}, f)
        print(f"\n[OK] Modelo guardado: {model_path}")
        
        metrics = {'accuracy': accuracy, 'n_classes': len(le.classes_)}
        
    else:
        # MLP con Keras
        print("\nEntrenando MLP...")
        model = build_static_mlp(X.shape[1], len(le.classes_))
        
        # Callbacks
        callbacks = [
            tf.keras.callbacks.EarlyStopping(
                monitor='val_loss', patience=15, restore_best_weights=True
            ),
            tf.keras.callbacks.ReduceLROnPlateau(
                monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6
            )
        ]
        
        # Entrenar
        history = model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=batch_size,
            callbacks=callbacks,
            verbose=1
        )
        
        # Evaluar
        test_loss, test_acc = model.evaluate(X_test, y_test, verbose=0)
        print(f"\nTest Accuracy: {test_acc:.4f}")
        
        # Guardar modelo
        model_path = MODELS_DIR / "lsm_static_classifier.keras"
        model.save(model_path)
        print(f"[OK] Modelo Keras guardado: {model_path}")
        
        # Exportar a TFLite (via SavedModel para compatibilidad con Keras 3)
        print("\nExportando a TFLite...")
        try:
            import tempfile, os
            with tempfile.TemporaryDirectory() as tmp:
                model.export(tmp)
                converter = tf.lite.TFLiteConverter.from_saved_model(tmp)
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                tflite_model = converter.convert()
            tflite_path = MODELS_DIR / "lsm_static_classifier.tflite"
            tflite_path.write_bytes(tflite_model)
            print(f"[OK] TFLite guardado: {tflite_path} ({len(tflite_model)/1024:.1f} KB)")
        except Exception as tflite_err:
            print(f"[WARN] TFLite export falló: {tflite_err}")
        
        # Guardar label encoder
        le_path = MODELS_DIR / "lsm_static_classes.json"
        with open(le_path, 'w', encoding='utf-8') as f:
            json.dump({'classes': le.classes_.tolist()}, f, ensure_ascii=False)
        
        metrics = {
            'accuracy': test_acc,
            'final_loss': test_loss,
            'epochs_trained': len(history.history['loss']),
            'n_classes': len(le.classes_)
        }
    
    return model, metrics


def train_dynamic_model(X: np.ndarray, y: np.ndarray,
                       class_names: List[str],
                       epochs: int = 150,
                       batch_size: int = 16,
                       architecture: str = "lstm") -> Tuple[tf.keras.Model, dict]:
    """
    Entrena modelo para señas dinámicas.
    
    Args:
        X: features (N, 30, D) o (N, D_flat)
        y: etiquetas (N,)
        class_names: nombres de clases
        epochs: épocas de entrenamiento
        batch_size: tamaño de batch
        architecture: 'lstm' o 'cnn'
    """
    print("\n" + "="*60)
    print(f"ENTRENAMIENTO: Modelo Dinámico ({architecture.upper()})")
    print("="*60)
    
    # Codificar etiquetas
    le = LabelEncoder()
    y_encoded = le.fit_transform(y)
    
    # Reshape si es necesario (features planas a secuencia)
    if X.ndim == 2:
        # Features planas: separar en (30, features_per_frame)
        # Asumimos que extract_sequence_features produce vector concatenado
        # Necesitamos reshape a (N, 30, D_per_frame)
        total_dim = X.shape[1]
        # Intentar inferir: 30 frames * D + 29 * 12 velocity
        # Si es formato antiguo, puede ser diferente
        # Por ahora asumimos que ya viene en forma correcta o es 2D
        print(f"  Input shape: {X.shape}")
    
    # Split
    from collections import Counter
    min_count = min(Counter(y_encoded).values())
    use_stratify = min_count >= 2
    if not use_stratify:
        print(f"  [WARN] {sum(1 for c in Counter(y_encoded).values() if c < 2)} clase(s) con 1 muestra — stratify desactivado")
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y_encoded, test_size=TEST_SIZE + VAL_SIZE,
        random_state=RANDOM_SEED, stratify=y_encoded if use_stratify else None
    )
    use_stratify2 = min(Counter(y_temp).values()) >= 2
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=TEST_SIZE / (TEST_SIZE + VAL_SIZE),
        random_state=RANDOM_SEED, stratify=y_temp if use_stratify2 else None
    )
    
    print(f"\nDataset split:")
    print(f"  Train: {len(X_train)} ({len(X_train)/len(X)*100:.1f}%)")
    print(f"  Val:   {len(X_val)} ({len(X_val)/len(X)*100:.1f}%)")
    print(f"  Test:  {len(X_test)} ({len(X_test)/len(X)*100:.1f}%)")
    
    # Construir modelo según forma de entrada
    input_shape = X_train.shape[1:]
    n_classes = len(le.classes_)
    
    # Detectar si features están aplanadas (1D) o en secuencia (2D)
    if len(input_shape) == 1:
        # Features aplanadas - usar Dense
        model = build_dynamic_dense(input_shape[0], n_classes)
        arch_name = "dense"
    elif architecture == "lstm":
        model = build_dynamic_lstm(input_shape, n_classes)
        arch_name = "lstm"
    else:
        model = build_dynamic_cnn(input_shape, n_classes)
        arch_name = "cnn"
    
    print(f"\nArquitectura: {arch_name} (input shape: {input_shape})")
    model.summary()
    
    # Callbacks
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor='val_loss', patience=20, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss', factor=0.5, patience=8, min_lr=1e-6
        )
    ]
    
    # Entrenar
    print("\nEntrenando...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=batch_size,
        callbacks=callbacks,
        verbose=1
    )
    
    # Evaluar
    test_loss, test_acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\nTest Accuracy: {test_acc:.4f}")
    
    # Guardar
    model_path = MODELS_DIR / f"lsm_dynamic_classifier_{architecture}.keras"
    model.save(model_path)
    print(f"[OK] Modelo guardado: {model_path}")
    
    # TFLite (via SavedModel para compatibilidad con Keras 3)
    print("\nExportando a TFLite...")
    try:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            model.export(tmp)
            converter = tf.lite.TFLiteConverter.from_saved_model(tmp)
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            tflite_model = converter.convert()
        tflite_path = MODELS_DIR / f"lsm_dynamic_classifier_{architecture}.tflite"
        tflite_path.write_bytes(tflite_model)
        print(f"[OK] TFLite guardado: {tflite_path} ({len(tflite_model)/1024:.1f} KB)")
    except Exception as tflite_err:
        print(f"[WARN] TFLite export falló: {tflite_err}")
    
    # Label encoder
    le_path = MODELS_DIR / "lsm_dynamic_classes.json"
    with open(le_path, 'w', encoding='utf-8') as f:
        json.dump({'classes': le.classes_.tolist()}, f, ensure_ascii=False)
    
    metrics = {
        'accuracy': test_acc,
        'final_loss': test_loss,
        'epochs_trained': len(history.history['loss']),
        'n_classes': n_classes,
        'architecture': architecture
    }
    
    return model, metrics


# =============================================================================
# CLI
# =============================================================================

def print_stats():
    """Imprime estadísticas del dataset."""
    if not METADATA_PATH.exists():
        print("No hay datos recolectados.")
        return
    
    metadata = json.loads(METADATA_PATH.read_text(encoding='utf-8'))
    
    print("\n" + "="*60)
    print("ESTADÍSTICAS DEL DATASET")
    print("="*60)
    print(f"Total de muestras: {metadata['total']}")
    
    static_count = 0
    dynamic_count = 0
    
    by_class = metadata.get('by_class', {})
    
    print("\nPor modo:")
    for cls, info in by_class.items():
        mode = info.get('mode', 'unknown')
        count = info.get('count', 0)
        if mode == 'static':
            static_count += count
        else:
            dynamic_count += count
    
    print(f"  Estáticas:  {static_count}")
    print(f"  Dinámicas:  {dynamic_count}")
    
    print("\nPor clase:")
    for cls in sorted(by_class.keys()):
        info = by_class[cls]
        print(f"  {cls:8s} | {info.get('mode', '?'):8s} | {info.get('count', 0):4d} muestras")
    
    # Verificar cobertura
    print("\nCobertura objetivo:")
    static_present = set(c for c in by_class if by_class[c].get('mode') == 'static')
    dynamic_present = set(c for c in by_class if by_class[c].get('mode') == 'dynamic')
    
    static_missing = set(STATIC_CLASSES) - static_present
    dynamic_missing = set(DYNAMIC_CLASSES) - dynamic_present
    
    if static_missing:
        print(f"  Estáticas faltantes: {sorted(static_missing)}")
    else:
        print("  ✓ Todas las clases estáticas tienen muestras")
    
    if dynamic_missing:
        print(f"  Dinámicas faltantes: {sorted(dynamic_missing)}")
    else:
        print("  ✓ Todas las clases dinámicas tienen muestras")


def main():
    parser = argparse.ArgumentParser(description="LSM Trainer")
    parser.add_argument("--mode", choices=["static", "dynamic", "both"], 
                       default="both",
                       help="Qué modelo entrenar")
    parser.add_argument("--epochs", type=int, default=100,
                       help="Épocas de entrenamiento")
    parser.add_argument("--batch-size", type=int, default=32,
                       help="Tamaño de batch")
    parser.add_argument("--stats", action="store_true",
                       help="Mostrar estadísticas y salir")
    parser.add_argument("--use-rf", action="store_true",
                       help="Usar RandomForest para estático (más rápido)")
    parser.add_argument("--architecture", choices=["lstm", "cnn"], default="lstm",
                       help="Arquitectura para modelo dinámico")
    parser.add_argument("--min-samples", type=int, default=3,
                       help="Mínimo de muestras por clase para incluirla (1 = usar todo)")
    
    args = parser.parse_args()
    
    if args.stats:
        print_stats()
        return
    
    # Verificar que hay datos
    if not METADATA_PATH.exists():
        print("[ERROR] No hay datos. Ejecuta lsm_data_collector primero.")
        return
    
    results = {}
    
    try:
        if args.mode in ["static", "both"]:
            # Entrenar estático
            try:
                X, y, class_names = load_dataset("static", min_samples=args.min_samples)
                
                if len(set(y)) < 2:
                    print("[WARN] Se necesitan al menos 2 clases para entrenar")
                else:
                    model, metrics = train_static_model(
                        X, y, class_names,
                        epochs=args.epochs,
                        batch_size=args.batch_size,
                        use_rf=args.use_rf
                    )
                    results['static'] = metrics
            except Exception as e:
                print(f"[ERROR] Entrenamiento estático falló: {e}")
        
        if args.mode in ["dynamic", "both"]:
            # Entrenar dinámico
            try:
                X, y, class_names = load_dataset("dynamic", min_samples=args.min_samples)
                
                if len(set(y)) < 2:
                    print("[WARN] Se necesitan al menos 2 clases para entrenar")
                else:
                    model, metrics = train_dynamic_model(
                        X, y, class_names,
                        epochs=args.epochs,
                        batch_size=args.batch_size // 2,  # Menor batch para secuencias
                        architecture=args.architecture
                    )
                    results['dynamic'] = metrics
            except Exception as e:
                print(f"[ERROR] Entrenamiento dinámico falló: {e}")
    
    except KeyboardInterrupt:
        print("\n\nEntrenamiento interrumpido.")
    
    # Resumen final
    print("\n" + "="*60)
    print("RESUMEN DE ENTRENAMIENTO")
    print("="*60)
    for mode, metrics in results.items():
        print(f"\n{mode.upper()}:")
        for k, v in metrics.items():
            if isinstance(v, float):
                print(f"  {k}: {v:.4f}")
            else:
                print(f"  {k}: {v}")
    
    print(f"\n[OK] Modelos guardados en: {MODELS_DIR}")


if __name__ == "__main__":
    main()
