# python_scripts — Scripts de Python del proyecto Señas a Voces

Todos los scripts de Python que hacen funcionar el pipeline de reconocimiento
de señas por cámara (MediaPipe). Organizados por etapa del pipeline.

> **Para agregar videos de entrenamiento (varios por seña) sigue
> [`videos_entrenamiento/README.md`](../videos_entrenamiento/README.md).**
> Requisitos: `pip install -r python_scripts/requirements.txt` con Python 3.11.

---

## 0. Varios videos por seña (flujo actual)

### `add_training_videos.py`
**Qué hace:** Lee `videos_entrenamiento/<SEÑA>/<persona>_<toma>.mp4`, extrae
manos + cara de cada video nuevo (igual que `extract_face_hands.py`), lo guarda
como la siguiente grabación real `<SEÑA>_<n>.npy` y regenera las aumentaciones
de esa seña. Salta los videos ya agregados; `--remove SEÑA/archivo` quita uno.

### `examples_index.py`
**Qué hace:** Mantiene `public/training_data/examples.json`: por cada `.npy`, si
es real o aumentado, quién lo grabó y la proporción de su video. Lo usan la
extracción, la aumentación, `dataset.py` (validación por persona) y el cargador
de patrones de la app. `python examples_index.py` muestra un resumen y revisa
que el índice coincida con los archivos.

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
**Qué hace:** Regenera las aumentaciones de cada seña desde **cada** grabación
real de `examples.json` (velocidad, rotación, escala, traslación, ruido y
recorte; manos y cara juntas, rotando en la proporción real del video).
Genera menos por grabación cuantas más grabaciones tenga la seña (~13 ejemplos
en total) y nunca borra grabaciones reales. Las guarda después de las reales:
`<SEÑA>_<R+1>.npy`, `<SEÑA>_<R+2>.npy`...

**Uso:**
```bash
python augment_npy.py --only CASA
```

---

## 5. Clasificador LSTM + Attention (ONNX)

Estos scripts entrenan y exportan un clasificador neuronal que complementa al
detector DTW. El modelo entrenado se usa en el navegador vía ONNX Runtime Web.

### `dataset.py`
**Qué hace:** Carga los `.npy` de `training_data/`, normaliza landmarks
(centro/escala por manos presentes), remuestrea a 24 frames, y construye
tensores `(T, 372)` para entrenamiento. Con `examples.json` corrige la
proporción de cada video y separa por persona (`holdout_signer`); sin él,
holdout por número de ejemplo.

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
Con `--holdout-signer` deja fuera a una persona completa y valida con sus
grabaciones (la medida honesta); con `--holdout n` valida con el ejemplo n de
cada seña, que son copias del mismo video (optimista). Early stopping por
top-5. Guarda checkpoint en `python_scripts/checkpoints/best_model.pt`.

**Uso:**
```bash
python train.py --epochs 60 --holdout-signer ana
```

### `evaluate.py`
**Qué hace:** Evalúa el checkpoint entrenado sobre la persona (o el ejemplo)
de validación. Reporta top-1 y top-5 accuracy, y lista los fallos fuera del
top-5 con su ranking completo.

**Uso:**
```bash
python evaluate.py
```

### `export_onnx.py`
**Qué hace:** Exporta el modelo PyTorch a formato ONNX para inferencia en el
navegador. Copia a `public/` el modelo (`sign_model.onnx`), las etiquetas
(`sign_labels.json`) y `sign_model_meta.json`, que le dice al navegador si el
modelo espera la proporción corregida.

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

Python 3.11 y `pip install -r python_scripts/requirements.txt`.
