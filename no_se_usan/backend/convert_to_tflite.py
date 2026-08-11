"""Convierte modelos Keras a TFLite usando SavedModel como intermediario."""
import tensorflow as tf
import tempfile
from pathlib import Path

MODELS = [
    ('models/lsm_static_classifier.keras',  'models/lsm_static_classifier.tflite'),
    ('models/lsm_dynamic_classifier_lstm.keras', 'models/lsm_dynamic_classifier_lstm.tflite'),
]

for keras_path, tflite_path in MODELS:
    if not Path(keras_path).exists():
        print(f'[SKIP] No existe: {keras_path}')
        continue
    print(f'\nCargando {keras_path}...')
    model = tf.keras.models.load_model(keras_path)
    print(f'  Shape: {model.input_shape} -> {model.output_shape}')

    with tempfile.TemporaryDirectory() as tmp:
        # model.export() genera un SavedModel compatible con TFLite (Keras 3)
        model.export(tmp, format='tf_saved_model')
        converter = tf.lite.TFLiteConverter.from_saved_model(tmp)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        tflite_model = converter.convert()

    Path(tflite_path).write_bytes(tflite_model)
    print(f'[OK] TFLite: {tflite_path} ({len(tflite_model)/1024:.1f} KB)')
