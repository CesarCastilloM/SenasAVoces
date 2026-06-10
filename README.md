# Señas a Voces

**Sistema de traducción de Lengua de Señas Mexicana (LSM) a voz** con academia web interactiva basada en visión por computadora y un guante traductor hardware.

---

## Tabla de contenidos

1. [Arquitectura general](#arquitectura-general)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Backend — Motor de reconocimiento LSM](#backend--motor-de-reconocimiento-lsm)
4. [Frontend — Academy Web](#frontend--academy-web)
5. [Guante traductor (Hardware)](#guante-traductor-hardware)
6. [Modelos MediaPipe](#modelos-mediapipe)
7. [Instalación y ejecución](#instalación-y-ejecución)
8. [API Reference](#api-reference)
9. [Configuración y umbrales](#configuración-y-umbrales)
10. [Equipo](#equipo)

---

## Arquitectura general

```
┌──────────────────────┐         HTTP POST (base64 frame)         ┌────────────────────────┐
│   Academy Frontend   │ ──────────────────────────────────────▶  │   Backend Flask API    │
│   (HTML/JS/CSS)      │ ◀──────────────────────────────────────  │   lsm_teacher_web.py   │
│   Puerto 8080        │         JSON {matched, letter, conf}     │   Puerto 5050          │
└──────────────────────┘                                          └────────────────────────┘
         │                                                                   │
         │ WebRTC getUserMedia                                               │ MediaPipe HandLandmarker
         ▼                                                                   ▼
┌──────────────────────┐                                          ┌────────────────────────┐
│   Cámara del usuario │                                          │ hand_landmarker.task   │
│   (navegador)        │                                          │ 7.5 MB · 21 landmarks  │
└──────────────────────┘                                          └────────────────────────┘

┌──────────────────────┐         UDP / Serial                     ┌────────────────────────┐
│   Guante ESP32       │ ──────────────────────────────────────▶  │   PC Voice Receiver    │
│   (WiFi/BT)         │         Datos de sensores + botones      │   Windows SAPI TTS     │
└──────────────────────┘                                          └────────────────────────┘
```

---

## Estructura del proyecto

```
SenasAVoces/
├── README.md                          # Este archivo
│
├── academy/                           # Frontend web de la academia
│   ├── index.html                     # SPA principal (23 KB)
│   ├── app.js                         # Lógica completa: lecciones, cámara, reconocimiento (67 KB, 1353 líneas)
│   ├── styles.css                     # Diseño dark theme con gradientes (29 KB)
│   └── README.md                      # Documentación específica del frontend
│
├── backend/                           # Servidor de reconocimiento LSM
│   ├── lsm_teacher_web.py            # API Flask — recibe frames, devuelve letra detectada (675 líneas)
│   ├── lsm_teacher.py                # Motor de reconocimiento — finger states, scoring, 27 letras (1555 líneas)
│   ├── main.py                        # App desktop con MediaPipe completo (pose + face + hands)
│   ├── download_models.py            # Script para descargar modelos desde Google Storage
│   ├── __init__.py                    # Package marker
│   ├── requirements.txt              # Deps: opencv, mediapipe, numpy, torch, scikit-learn
│   └── requirements_web.txt          # Deps mínimas para el servidor web: flask, mediapipe, opencv
│
├── mediapipe_models/                  # Modelos pre-entrenados MediaPipe Tasks API
│   ├── hand_landmarker.task           # Detección de manos — 21 landmarks (7.5 MB)
│   ├── gesture_recognizer.task        # Reconocimiento de gestos genéricos (8.0 MB)
│   ├── face_landmarker.task           # Detección facial — 468 landmarks (3.6 MB)
│   └── pose_landmarker.task           # Detección de pose corporal — 33 landmarks (29.2 MB)
│
├── glove/                             # Hardware del guante traductor
│   ├── firmware/                      # Código ESP32 (PlatformIO / Arduino framework)
│   │   ├── esp32_wifi_glove.cpp       # Guante WiFi — UDP, 8 botones, modo acumulativo
│   │   ├── esp32_left_glove.cpp       # Guante izquierdo — Raspberry Pi Zero 2W + OLED
│   │   ├── esp32_serial_glove.cpp     # Versión serial (USB directo)
│   │   └── platformio.ini            # Configuración PlatformIO (ESP32 DevKit, 115200 baud)
│   └── receiver/                      # Receptores de voz en PC/RPi
│       ├── pc_voice_receiver_wifi.py  # Receptor WiFi — Windows SAPI (Microsoft Sabina)
│       ├── pc_voice_receiver.py       # Receptor serial/Bluetooth
│       ├── lsm_vocabulary.py          # Vocabulario LSM expandido (300+ señas con variantes)
│       └── requirements.txt          # Deps RPi: adafruit-ads1x15, mpu6050, luma.oled
│
└── docs/                              # Documentación técnica y comercial
    ├── ESTRATEGIA_COMERCIAL_GOBIERNO.md
    ├── PRESUPUESTO_DIF_SONORA_10_GUANTES.md
    ├── PRESUPUESTO_PROFESIONAL.md
    ├── HOJA_COSTOS_PROTOTIPO.md
    ├── DIAGRAMAS_CONEXION.md
    ├── GUIA_AUDIO_RASPBERRY_PI.md
    ├── GUIA_BOTON_ACTIVACION.md
    ├── GUIA_SISTEMA_INALAMBRICO.md
    ├── ANALISIS_OPCION4_CONCESION.md
    ├── README_INSTALACION.md
    ├── README_LSM_FINAL.md
    ├── README_SENAS_A_VOCES_ENACTUS.md
    ├── RESUMEN_NUMEROS_TODOS_MODELOS.md
    └── presupuestoSAV.md
```

---

## Backend — Motor de reconocimiento LSM

### Tecnología
- **Framework:** Flask 2.3+ con CORS habilitado
- **Visión:** MediaPipe Tasks API — `HandLandmarker` en modo `IMAGE` (sincrónico)
- **Modelo:** `hand_landmarker.task` (7.5 MB) — detecta hasta **2 manos** simultáneamente con 21 landmarks 3D cada una

### Pipeline de reconocimiento

```
Frame Base64 → Decodificar JPEG → BGR NumPy array
    → MediaPipe HandLandmarker (21 landmarks × N manos)
        → finger_states() — calcula estado de cada dedo:
            • Extendido (E) / Cerrado (C) / Semi (S)
            • Distancias tip-to-tip (thumb_touch_index, etc.)
            • Ángulos interfalángicos
        → score_all_letters() — evalúa 27 patrones (A-Z + Ñ):
            • Coincidencia de huella dactilar binaria (EECCC, EEECC, etc.)
            • Funciones _extra_X() — 26 funciones especializadas para
              desambiguar letras similares (ej: I vs J, N vs Ñ, X vs Z)
            • Score final = base_match + extra_score
        → Selección: letra con score ≥ MATCH_THRESHOLD
    → JSON response: {matched, letter, confidence, landmarks[]}
```

### Funciones de scoring especializadas (`_extra_*`)

| Función | Propósito |
|---------|-----------|
| `_extra_I` | Verificar solo meñique extendido, penalizar otros dedos |
| `_extra_N` | N estática: índice y medio cruzados sobre pulgar |
| `_extra_enye` | Ñ = N + movimiento ondulante (penalizada sin movimiento) |
| `_extra_O` | Círculo pulgar-índice + dedos cerrados |
| `_extra_X` | Índice doblado como gancho, penalizar si está recto (≠Z) |
| `_extra_B` | Cuatro dedos juntos, pulgar cruzado |
| `_extra_H` | Índice y medio horizontales extendidos |
| `_extra_Q` | Pulgar e índice apuntando abajo |
| ... | 26 funciones en total |

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/recognize` | Recibe frame base64, devuelve letra detectada |
| GET | `/api/alphabet` | Retorna las 27 letras con descripciones |
| GET | `/api/health` | Health check |
| GET | `/api/stats` | Estadísticas de uso (frames procesados, latencia) |
| POST | `/api/lesson/complete` | Registra lección completada por usuario |
| GET | `/api/progress/<user_id>` | Progreso del estudiante |
| GET | `/api/feed` | Feed de actividad reciente |
| GET | `/api/dashboard` | Métricas generales |
| POST | `/api/register` | Registro de usuario |
| GET | `/` | Landing page del servidor |

---

## Frontend — Academy Web

### Tecnología
- **SPA** pura (sin frameworks) — HTML5 + ES6+ JavaScript + CSS3
- **Cámara:** WebRTC `getUserMedia()` — captura a 30+ FPS
- **Rendering:** Canvas 2D — dibuja landmarks en tiempo real
- **Diseño:** Dark theme con gradientes, responsive, 0 dependencias externas

### Currículo: 4 niveles, 20 lecciones

| Nivel | Lecciones | Contenido |
|-------|-----------|-----------|
| **1 — Fundamentos** | L1.1–L1.5 | Alfabeto (27 letras), Números (1–20), Saludos, Familia, Colores |
| **2 — Comunicación diaria** | L2.1–L2.5 | Emociones, Necesidades, Escuela/Trabajo, Salud, Conversación básica |
| **3 — Comunicación fluida** | L3.1–L3.5 | Vocabulario del guante, Frases completas, Gramática LSM, Expresiones faciales, Práctica conversacional |
| **4 — Certificación** | L4.1–L4.5 | Conversaciones completas, Simulacros oficiales, Práctica con intérpretes, Certificado QR, Bolsa de empleo |

### Flujo de reconocimiento en frontend

```javascript
// Cada 40ms (_MIN_INTERVAL):
canvas.toDataURL('image/jpeg', 0.7)  // Captura frame
  → fetch('/api/recognize', {body: base64})  // Envía al backend
  → Respuesta: {matched: true, letter: 'A', confidence: 0.97, landmarks: [...]}
  → Si matched && target == letter:
      holdTimer += elapsed
      Si holdTimer ≥ 1.4s (HOLD_SECONDS):
        ✅ Avanzar al siguiente target
  → Dibujar landmarks: líneas azules (#3B82F6) + vértices blancos (#FFFFFF)
```

### Lógica de matching

- **Letras (A-Z, Ñ):** Matching estricto del backend (`j.matched === true`)
- **Palabras/frases (L2-L4):** Mano visible + confianza ≥ 0.50 + hold 1.4s

### Progresión de lecciones

Al completar una lección, el sistema automáticamente inicia la siguiente del mismo nivel. Si el nivel está completo, avanza al primer item del siguiente nivel.

---

## Guante traductor (Hardware)

### Especificaciones

| Componente | Detalle |
|------------|---------|
| **MCU** | ESP32 DevKit V1 (WiFi 802.11 b/g/n + BT 4.2) |
| **Sensores** | ADS1115 (ADC 16-bit I2C) + MPU6050 (acelerómetro/giroscopio) |
| **Comunicación** | UDP unicast (WiFi) / Serial 115200 / Bluetooth SPP |
| **Botones** | 8 GPIO con pull-up interno |
| **Display** | OLED SSD1306 128×64 (guante izquierdo) |
| **Alimentación** | LiPo 3.7V 1200mAh vía regulador 3.3V |
| **Framework** | Arduino sobre PlatformIO |

### Red actual
- **SSID:** INVITADOS-AMDE (WPA2-PSK)
- **Password:** 34567890
- **IP PC:** 10.128.32.23
- **Puerto UDP:** 5000

### Vocabulario del guante (8 botones)

| Pin | Frase |
|-----|-------|
| 4 | "tardes" |
| 5 | "Negocio A Gobierno" |
| 18 | "gracias" |
| 19 | "Buenas" |
| 21 | "Te quiero" |
| 22 | "oyentes no entienden nuestras señas" |
| 23 | "Ahora sí" |
| 25 | "Compárteme tu sacapuntas" |

### Modo de operación
1. **Pin 17** activa/desactiva modo escucha
2. Presionar botones acumula palabras en buffer
3. Al desactivar modo escucha → envía frase completa por UDP
4. El receptor (`pc_voice_receiver_wifi.py`) recibe y sintetiza voz con **Microsoft Sabina** (SAPI5, español MX)

---

## Modelos MediaPipe

| Modelo | Archivo | Tamaño | Uso |
|--------|---------|--------|-----|
| Hand Landmarker | `hand_landmarker.task` | 7.5 MB | Detección de 21 landmarks por mano (principal) |
| Gesture Recognizer | `gesture_recognizer.task` | 8.0 MB | Reconocimiento de gestos genéricos |
| Face Landmarker | `face_landmarker.task` | 3.6 MB | 468 landmarks faciales (expresiones) |
| Pose Landmarker | `pose_landmarker.task` | 29.2 MB | 33 landmarks corporales (postura) |

Descarga automática: `python backend/download_models.py`

---

## Instalación y ejecución

### Requisitos previos
- Python 3.10+
- Node.js (solo para verificación de sintaxis)
- Navegador con soporte WebRTC (Chrome/Edge recomendado)
- Cámara web

### 1. Backend (reconocimiento)

```bash
cd SenasAVoces/backend
pip install -r requirements_web.txt
python lsm_teacher_web.py
```

Servidor disponible en `http://127.0.0.1:5050`

### 2. Frontend (academia)

```bash
cd SenasAVoces/academy
python -m http.server 8080
```

Abrir `http://127.0.0.1:8080` en Chrome/Edge.

### 3. Guante (opcional)

```bash
# Firmware
cd SenasAVoces/glove/firmware
# Abrir con PlatformIO, compilar y subir a ESP32

# Receptor
cd SenasAVoces/glove/receiver
pip install pyttsx3
python pc_voice_receiver_wifi.py
```

---

## API Reference

### POST `/api/recognize`

**Request:**
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ...",
  "target": "A"
}
```

**Response:**
```json
{
  "matched": true,
  "letter": "A",
  "confidence": 0.97,
  "landmarks": [[0.52, 0.83, -0.01], ...],
  "hand_count": 1,
  "finger_states": {"thumb": true, "index": false, "middle": false, "ring": false, "pinky": false}
}
```

### GET `/api/alphabet`

**Response:**
```json
[
  {"letter": "A", "description": "Puño cerrado, pulgar al costado.", "pattern": "CCCCC"},
  {"letter": "B", "description": "Cuatro dedos juntos extendidos, pulgar cruzado.", "pattern": "CEEEE"},
  ...
]
```

---

## Configuración y umbrales

| Parámetro | Valor | Ubicación | Descripción |
|-----------|-------|-----------|-------------|
| `MATCH_THRESHOLD` | 0.95 | backend | Score mínimo para considerar match de letra |
| `MATCH_THRESHOLD_MOV` | 0.79 | backend | Threshold para letras con movimiento |
| `HOLD_SECONDS` | 1.4 | backend/frontend | Tiempo que debe mantenerse la seña correcta |
| `_MIN_INTERVAL` | 40 ms | frontend | Intervalo entre envíos de frame (~25 FPS) |
| `min_hand_detection_confidence` | 0.65 | backend | Confianza mínima para detectar mano |
| `min_hand_presence_confidence` | 0.65 | backend | Confianza mínima para presencia de mano |
| `min_tracking_confidence` | 0.60 | backend | Confianza mínima para tracking entre frames |
| `num_hands` | 2 | backend | Máximo de manos a detectar simultáneamente |

---

## Equipo

| Nombre | Rol |
|--------|-----|
| **César** | Fundador · Hardware |
| **César** | Co-fundador · Estrategia |
| **Emiliano** | IA / Visión por computadora |
| **Mario** | Pedagogía LSM · Comunidad |

---

## Licencia

Proyecto académico — Señas a Voces © 2024-2026
