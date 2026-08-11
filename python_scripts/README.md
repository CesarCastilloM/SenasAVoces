# python_scripts — Scripts de Python del proyecto Señas a Voces

Todos los scripts de Python que hacen funcionar el pipeline de reconocimiento
de señas por cámara (MediaPipe). Organizados por etapa del pipeline.

---

## 1. Extracción de landmarks desde videos

### `extract_two_hands.py`
**Qué hace:** Extrae landmarks de ambas manos (derecha + izquierda) desde videos
de señas usando MediaPipe HandLandmarker con `num_hands=2`. Usa seguimiento por
continuidad espacial para evitar que las etiquetas Right/Left se intercambien
entre frames. Guarda cada ejemplo como `.npy` con shape `(N, 42, 3)`.

**Uso:**
```bash
python extract_two_hands.py --input "ruta/a/videos" --output "public/training_data"
```

### `extract_from_videos.py`
**Qué hace:** Versión anterior del extractor. Solo procesa una mano
(`num_hands=1`, `hands[0]`). Mantenido por compatibilidad con datos antiguos.

### `reextract_landmarks.py`
**Qué hace:** Re-extrae landmarks de todos los videos en `public/videos/signs/`
con parámetros afinados (confianza 0.25, 2 manos, suavizado temporal 0.5,
persistencia 10 frames). Guarda JSONs en `public/training_data/`.

### `compress_reference_videos.py`
**Qué hace:** Comprime los videos fuente a clips ligeros (720p, CRF 28) para
usarse como referencia visual en la web. Los nombres coinciden con los de las
señas entrenadas mediante `slugify_label`.

**Uso:**
```bash
python compress_reference_videos.py --input "C:\ruta\a\MP4" --height 360 --crf 32
```

---

## 2. Conversión de formatos

### `json_to_npy.py`
**Qué hace:** Convierte todos los JSON de `training_data/` a formato `.npy`
binario. Shape resultante: `[N, 42, 3]` (21 right + 21 left, zeros si ausente).
Un `.npy` por cada ejemplo.

### `convert_npy_to_json.py`
**Qué hace:** Convierte datos `.npy` de `data/lsm_raw/` al formato JSON del
detector DTW. Útil para importar datasets externos al pipeline.

---

## 3. Análisis y limpieza de datos

### `analyze_hands.py`
**Qué hace:** Analiza la energía de movimiento de cada mano en los archivos
`.npy` para determinar si la mano izquierda participa activamente o está en
reposo. Genera `hand_analysis.json` con la decisión por seña.

### `clean_resting_hand.py`
**Qué hace:** Elimina la mano izquierda de los archivos `.npy` cuando
`hand_analysis.json` indica que está en reposo (ceros en los landmarks de la
mano que no se mueve). Esto evita que el detector interprete ruido como gesto.

---

## 4. Aumento de datos

### `augment_npy.py`
**Qué hace:** Aplica transformaciones de aumento de datos a archivos `.npy`:
rotación 2D, escalado, espejo horizontal, y time-warp. Preserva la relación
espacial entre ambas manos (transforma la secuencia completa con los mismos
parámetros). Genera ejemplos adicionales `_aug1.npy`, `_aug2.npy`, etc.

---

## 5. Clasificador LSTM + Attention (ONNX)

Estos scripts entrenan y exportan un clasificador neuronal que complementa al
detector DTW. El modelo entrenado se usa en el navegador vía ONNX Runtime Web.

### `dataset.py`
**Qué hace:** Carga los `.npy` de `training_data/`, normaliza landmarks
(centro/escala por manos presentes), remuestrea a 24 frames, y construye
tensores `(T, 126)` para entrenamiento. Soporta holdout por índice.

### `augment.py`
**Qué hace:** Aumentación on-the-fly para entrenamiento: rotación, escala,
ruido gaussiano, y time-warp con velocidad variable. Aplica las mismas
transformaciones a toda la secuencia (no por mano separada).

### `model.py`
**Qué hace:** Define la arquitectura del modelo:
- BiLSTM (2 capas, bidireccional) sobre la secuencia de 126 features.
- Temporal Attention pooling (aprende qué frames son más discriminativos).
- Cabeza de clasificación (logits) + cabeza de embedding (para contrastive loss).
- `supervised_contrastive_loss()`: fuerza separación entre clases parecidas.

### `train.py`
**Qué hace:** Entrena el modelo con CrossEntropy + Supervised Contrastive Loss.
Usa holdout honesto (excluye un ejemplo por seña para validación). Early
stopping por top-5. Guarda checkpoint en `ml_classifier/checkpoints/best_model.pt`.

**Uso:**
```bash
python train.py --epochs 60 --holdout 5
```

### `evaluate.py`
**Qué hace:** Evalúa el checkpoint entrenado sobre el holdout. Reporta top-1
y top-5 accuracy, y lista los fallos fuera del top-5 con su ranking completo.

**Uso:**
```bash
python evaluate.py --holdout 5
```

### `export_onnx.py`
**Qué hace:** Exporta el modelo PyTorch a formato ONNX para inferencia en el
navegador. Genera `sign_model.onnx` y `public/sign_labels.json` (mapa
índice → nombre de seña).

**Uso:**
```bash
python export_onnx.py
```

---

## Flujo completo del pipeline

```
Videos fuente (MP4)
  │
  ├── extract_two_hands.py ──────────────► .npy (42 landmarks, 2 manos)
  │                                        public/training_data/<cat>/<SEÑA>_<n>.npy
  │
  ├── analyze_hands.py ───────────────────► hand_analysis.json
  │
  ├── clean_resting_hand.py ──────────────► .npy limpios (sin mano en reposo)
  │
  ├── augment_npy.py ─────────────────────► .npy aumentados (_aug1, _aug2, ...)
  │
  ├── compress_reference_videos.py ───────► public/videos/signs/<SEÑA>.mp4
  │
  │   ┌── Detector DTW (JS en navegador) ──┐
  │   │   Carga .npy vía npy_parser.js      │
  │   │   dynamic_sign_detector.js          │
  │   └─────────────────────────────────────┘
  │
  │   ┌── Clasificador LSTM+Attention ─────┐
  │   │   train.py → best_model.pt          │
  │   │   export_onnx.py → sign_model.onnx  │
  │   │   onnx_classifier.js (navegador)    │
  │   └─────────────────────────────────────┘
  │
  └── evaluate.py → reporte top-1 / top-5
```

## Requisitos

```
torch >= 2.0
numpy
mediapipe
onnx
onnxruntime
```
