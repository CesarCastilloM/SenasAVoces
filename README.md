# Señas a Voces

**Academia web interactiva para aprender Lengua de Señas Mexicana (LSM)** con
reconocimiento de señas por cámara directamente en el navegador (MediaPipe +
ONNX Runtime Web), progreso de usuario y práctica inmersiva.

> El reconocimiento corre 100% en el navegador: no hay backend Flask ni
> guante hardware en el flujo activo. El pipeline de Python solo se usa
> offline para generar el modelo ONNX y los datos de entrenamiento.

---

## Estructura del proyecto

```
SAVb/                           # Raíz del proyecto (git repo + workspace)
├── index.html                  # Entry HTML (Vite)
├── package.json                # Deps: React 19, Vite 7, MediaPipe, ONNX Web, Supabase
├── vite.config.js              # Config Vite + middleware /api/train-sign (dev)
├── vercel.json                 # Deploy config
├── tailwind.config.js
├── postcss.config.js
├── PRODUCT.md                  # Definición de producto
├── brand-spec.md               # Especificación de marca
│
├── src/                        # App React (frontend activo)
│   ├── main.jsx                # App principal + páginas (Dashboard, Learn, Lesson, Practice, Debug)
│   ├── model_test_page.jsx     # Página: probar modelo ONNX
│   ├── train_page.jsx          # Página: entrenar nuevas señas (cámara → /api/train-sign)
│   ├── retrain_page.jsx        # Página: re-extraer landmarks desde videos
│   ├── training_viewer_page.jsx# Página: visualizar datos de entrenamiento
│   ├── lessons_glosario.js     # Definición de lecciones y glosario LSM
│   ├── lsm_detector.js         # Detector de letras estáticas (finger states + scoring)
│   ├── dynamic_sign_detector.js# Detector de señas dinámicas (DTW sobre secuencias)
│   ├── onnx_classifier.js      # Wrapper de ONNX Runtime Web (clasificador LSTM)
│   ├── npy_parser.js           # Parser de archivos .npy en el navegador
│   ├── components/             # AuthPage, EmailConfirmationPage
│   ├── contexts/AuthContext.jsx# Contexto de autenticación (Supabase)
│   ├── lib/supabaseClient.ts   # Cliente Supabase
│   ├── services/progressService.js # Servicio de progreso (Supabase)
│   └── styles/styles.css       # Estilos globales
│
├── public/                     # Assets estáticos servidos al navegador
│   ├── sign_model.onnx         # Modelo LSTM exportado (inferencia en navegador)
│   ├── sign_labels.json        # Mapa idx → nombre de seña
│   ├── favicon.png
│   ├── logo-senas-a-voces*.png
│   ├── ort-wasm-simd-threaded*.wasm  # WASM de ONNX Runtime Web
│   ├── videos/signs/           # Videos de referencia por seña (228 .mp4)
│   └── training_data/          # Datos de entrenamiento (.npy) por categoría
│       ├── abecedario/ colores/ familia/ numeros/ palabras/
│       ├── manifest.json
│       ├── sign_metadata.json
│       ├── hand_analysis.json
│       └── extraction_report.json
│
├── python_scripts/             # Pipeline offline (Python) para generar el modelo
│   ├── extract_two_hands.py    # Extraer landmarks (2 manos) desde videos → .npy
│   ├── extract_from_videos.py  # Extractor legacy (1 mano)
│   ├── extract_face_hands.py   # Extractor cara + manos
│   ├── reextract_landmarks.py  # Re-extraer con parámetros afinados
│   ├── compress_reference_videos.py  # Comprimir videos fuente → public/videos/signs/
│   ├── json_to_npy.py / convert_npy_to_json.py  # Conversión de formatos
│   ├── analyze_hands.py        # Analizar mano en reposo
│   ├── clean_resting_hand.py   # Limpiar mano inactiva de los .npy
│   ├── augment_npy.py          # Aumentación de datos (.npy)
│   ├── dataset.py              # Carga + normalización para entrenamiento
│   ├── augment.py              # Aumentación on-the-fly (entrenamiento)
│   ├── model.py                # Arquitectura BiLSTM + Attention + Contrastive Loss
│   ├── train.py                # Entrenamiento → checkpoints/best_model.pt
│   ├── evaluate.py             # Evaluación top-1 / top-5
│   ├── export_onnx.py          # Exportar a ONNX → checkpoints/sign_model.onnx
│   ├── checkpoints/            # best_model.pt + sign_model.onnx
│   ├── models/                 # Modelos MediaPipe .task (descargados bajo demanda)
│   └── README.md               # Documentación detallada del pipeline
│
├── mediapipe_models/           # Copia local de modelos MediaPipe .task (referencia)
│
└── _archive/                   # Código legacy/hardware (NO usado por la web app)
    ├── academy/                # Frontend vanilla JS anterior (reemplazado por src/)
    ├── backend/                # Servidor Flask LSM (reemplazado por inferencia en navegador)
    ├── ml_classifier/          # Pipeline ML anterior (reemplazado por python_scripts/)
    ├── models/                 # Modelos antiguos
    ├── data/                   # Datos antiguos (.npz, embeddings)
    ├── python_pipeline/        # Pipeline de procesamiento anterior
    ├── no_se_usan/             # Scripts descartados
    ├── glove/                  # Firmware ESP32 del guante traductor
    ├── hardware/               # Colector de datos ESP32 (guante)
    ├── firmware/               # Firmware PlatformIO legacy
    ├── flutter_app/            # App Flutter abandonada
    └── imu_test/               # Pruebas IMU
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Navegador (React + Vite)                                   │
│                                                             │
│  getUserMedia ──► MediaPipe Tasks Vision (WASM)             │
│   (cámara)         ├─ HandLandmarker  (21 landmarks × 2)    │
│                    ├─ PoseLandmarker  (33 landmarks)        │
│                    └─ FaceLandmarker  (468 landmarks)       │
│                                                             │
│  Detección:                                                 │
│   ├─ Letras estáticas  → lsm_detector.js (finger states)    │
│   ├─ Señas dinámicas   → dynamic_sign_detector.js (DTW)     │
│   └─ Clasificador LSTM → onnx_classifier.js (ONNX Web)      │
│                                                             │
│  Progreso/Auth: Supabase (progressService.js, AuthContext)  │
│                                                             │
│  Dev only: POST /api/train-sign → guarda .npy en public/    │
└─────────────────────────────────────────────────────────────┘

Pipeline offline (Python, python_scripts/):
  Videos MP4 → extract_two_hands.py → .npy → train.py → .pt
                                                       → export_onnx.py → .onnx → public/
```

---

## Instalación y ejecución

### Web app (frontend)

```bash
npm install
npm run dev      # servidor de desarrollo (http://localhost:5173)
npm run build    # build de producción → dist/
npm run preview  # previsualizar el build
```

> No necesitas hacer `cd` a ningún subdirectorio. El proyecto corre
> directamente desde la raíz del workspace.

Variables de entorno (`.env` en la raíz del proyecto):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Pipeline de ML (offline, opcional)

Solo se necesita para regenerar el modelo ONNX o los datos de entrenamiento.
Ver `python_scripts/README.md` para el flujo completo.

```bash
pip install torch numpy mediapipe onnx onnxruntime

# Extraer landmarks desde videos fuente
python python_scripts/extract_two_hands.py --input "ruta/a/videos" --output "public/training_data"

# Entrenar
python python_scripts/train.py --epochs 60 --holdout 5

# Exportar a ONNX (genera public/sign_model.onnx y public/sign_labels.json)
python python_scripts/export_onnx.py
```

---

## Notas

- `_archive/` contiene código legacy y de hardware (guante ESP32, app Flutter,
  backend Flask). No es necesario para la web app y se conserva solo como
  referencia histórica. Se puede ignorar durante el desarrollo activo.
- El middleware `/api/train-sign` en `vite.config.js` solo funciona en
  desarrollo (`npm run dev`). En producción los datos de entrenamiento son
  estáticos (ya generados en `public/training_data/`).
- Los modelos MediaPipe se cargan desde CDN de Google Storage en tiempo de
  ejecución; `mediapipe_models/` es solo una copia local de referencia.
