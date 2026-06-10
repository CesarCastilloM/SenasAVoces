# LSM ML Pipeline — Sistema de Reconocimiento de Lengua de Señas Mexicana

Pipeline completo de Machine Learning para reconocimiento de LSM (abecedario + números 1-20) usando MediaPipe Hands y modelos TFLite optimizados.

## 📁 Estructura del Pipeline

```
backend/
├── lsm_features.py          # Extracción de features (landmarks → vector)
├── lsm_data_collector.py    # GUI de captura de datos
├── lsm_trainer.py           # Entrenamiento de modelos
├── lsm_recognizer.py        # Inferencia en tiempo real
├── requirements_ml.txt      # Dependencias
└── README_ML.md            # Este archivo
```

## 🎯 Objetivos

| Componente | Clases | Modo | Arquitectura |
|------------|--------|------|--------------|
| Estático | A-Z + Ñ + 1-10 | Foto (15 frames) | MLP o RandomForest |
| Dinámico | J, K, Ñ, Q, X, Z + 11-20 | Video (30 frames) | LSTM Bidireccional |

## 🚀 Quick Start

### 1. Instalar dependencias

```bash
cd backend
pip install -r requirements_ml.txt
```

### 2. Capturar datos

Modo interactivo (una clase a la vez):
```bash
python lsm_data_collector.py
```

Captura específica:
```bash
# Letra A (estática)
python lsm_data_collector.py --class A --mode static --samples 20

# Letra J (dinámica con movimiento)
python lsm_data_collector.py --class J --mode dynamic --samples 20

# Número 10 (dinámico)
python lsm_data_collector.py --class 10 --mode dynamic --samples 15
```

Batch (desde archivo):
```bash
echo -e "A\nB\nC\nJ\nK\n10\n15" > clases.txt
python lsm_data_collector.py --batch --list clases.txt --samples 10
```

Ver estadísticas del dataset:
```bash
python lsm_data_collector.py --stats
```

### 3. Entrenar modelos

Entrenar ambos modelos:
```bash
python lsm_trainer.py --mode both --epochs 100
```

Solo estático (más rápido con RandomForest):
```bash
python lsm_trainer.py --mode static --use-rf --epochs 50
```

Solo dinámico (con LSTM):
```bash
python lsm_trainer.py --mode dynamic --architecture lstm --epochs 150
```

Ver estadísticas antes de entrenar:
```bash
python lsm_trainer.py --stats
```

### 4. Probar reconocimiento en vivo

```bash
python lsm_recognizer.py
```

## 🎮 Controles del Data Collector

| Tecla | Acción |
|-------|--------|
| `S` | Capturar foto (15 frames promedio) para estáticas |
| `ESPACIO` | Grabar secuencia (30 frames) para dinámicas |
| `N` | Siguiente clase |
| `Q` | Salir |

**Indicadores visuales:**
- 🟢 Barra verde: progreso de grabación
- 🔴 "REC": grabando
- 🟡 "MANO DETECTADA" / 🔴 "SIN MANO"

## 📊 Formato de Datos

Los datos se guardan en:
```
data/lsm_raw/
├── A/
│   ├── sample_0000.npy    # (21, 3) landmarks promediados
│   └── sample_0001.npy
├── J/
│   ├── sample_0000.npy    # (30, 21, 3) secuencia completa
│   └── sample_0001.npy
└── _metadata.json         # Información de todas las muestras
```

## 🤖 Arquitecturas de Modelos

### Clasificador Estático (MLP)

```
Input: 80 dims (landmarks + ángulos + orientación + distancias)
  ↓
Dense(256) → BN → Dropout(0.3)
  ↓
Dense(128) → BN → Dropout(0.3)
  ↓
Dense(64) → ReLU
  ↓
Softmax(33 clases)
```

### Clasificador Dinámico (LSTM)

```
Input: (30, 80) secuencia temporal
  ↓
Masking → BiLSTM(64, return_seq=True) → Dropout(0.3)
  ↓
BiLSTM(32) → Dropout(0.3)
  ↓
Dense(64) → ReLU
  ↓
Softmax(clases dinámicas)
```

## 📈 Métricas Esperadas

| Métrica | Objetivo | Referencia CICESE 2024 |
|---------|----------|------------------------|
| Precisión estáticas | ≥ 94% | 95.2% |
| Precisión dinámicas | ≥ 88% | 89.7% |
| Latencia inferencia | ≤ 20ms | 12-18ms (TFLite) |

## 🔄 Integración con lsm_teacher.py

Para usar los modelos ML en lugar del motor de ángulos:

```python
from lsm_recognizer import create_recognizer_from_models

# Crear reconocedor
recognizer = create_recognizer_from_models(threshold=0.85)

# En cada frame de video
result = recognizer.update(landmarks)

# result contiene:
# {
#   'static_pred': 'A',
#   'static_conf': 0.92,
#   'dynamic_pred': '',
#   'dynamic_conf': 0.0,
#   'final_pred': 'A',
#   'final_conf': 0.92,
#   'is_moving': False,
#   'motion_level': 0.02
# }
```

## 🔧 Parámetros de Configuración

### lsm_features.py
- `normalize_landmarks()`: normalización respecto a muñeca
- `compute_finger_angles()`: 10 ángulos articulares
- `extract_single_frame_features()`: 80 dimensiones totales

### lsm_recognizer.py
- `STATIC_WINDOW = 5`: frames para suavizado estático
- `DYNAMIC_WINDOW = 30`: frames para secuencia dinámica
- `MOTION_THRESHOLD = 0.03`: umbral de detección de movimiento
- `threshold = 0.75`: confianza mínima para predicción

## 🧪 Testing

Test unitario de features:
```bash
python lsm_features.py
```

Test de recognizer con datos sintéticos:
```bash
python lsm_recognizer.py
```

## 📦 Exportación a TFLite

Los modelos se exportan automáticamente con:
- Cuantización float16 (reducción 50% tamaño)
- Optimización DEFAULT de TFLite
- Compatible con ESP32-S3 y mobile

Ruta de modelos generados:
```
models/
├── lsm_static_classifier.tflite
├── lsm_static_classifier.keras
├── lsm_dynamic_classifier_lstm.tflite
├── lsm_dynamic_classifier_lstm.keras
├── lsm_static_classes.json
└── lsm_dynamic_classes.json
```

## 📚 Referencias Académicas

1. **Morfín-Chávez et al. (MICAI 2023)** — "Fingerspelling Recognition in LSM Using ML"
   - DOI: 10.1007/978-3-031-47765-2_9
   - 95%+ precisión con MediaPipe + RandomForest

2. **Rios-Figueroa et al. (2022)** — "Spherical and Cartesian Features for LSM"
   - DOI: 10.3390/math10162904
   - Sistema de features articulares 3D

3. **CICESE Dataset (2023/2025)**
   - Static: https://zenodo.org/doi/10.5281/zenodo.10067508
   - Dynamic: https://zenodo.org/records/14689869

## 🐛 Troubleshooting

### "No se encontraron muestras"
- Ejecutar `lsm_data_collector.py` primero
- Verificar con `lsm_data_collector.py --stats`

### "No se pudo cargar modelo"
- Entrenar primero con `lsm_trainer.py`
- Verificar que existen archivos en `models/`

### MediaPipe no detecta mano
- Verificar iluminación (evitar contraluz)
- Acercar mano a cámara
- Fondo neutro ayuda pero no es obligatorio

### TensorFlow GPU
```bash
# Verificar GPU disponible
python -c "import tensorflow as tf; print(tf.config.list_physical_devices('GPU'))"

# Instalar versión GPU (NVIDIA)
pip install tensorflow[and-cuda]
```

## 📝 TODO / Futuras Mejoras

- [ ] Implementar augmentación temporal (time warping)
- [ ] Añadir modelo de atención (Transformer) para dinámicas
- [ ] Soporte para señas bimanuales (dos manos simultáneas)
- [ ] Dataset de números 11-20 propio (grabado con webcam)
- [ ] Integración con sistema de guante LSM existente

## 👨‍💻 Autor

Desarrollado por Windsurf Cascade para proyecto LSM-CDMX.
