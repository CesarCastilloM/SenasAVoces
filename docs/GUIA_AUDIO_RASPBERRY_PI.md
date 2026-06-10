# 🔊 Guía Completa: Micrófono y Bocina en Raspberry Pi Zero 2W

## 📋 Componentes Necesarios

### **Micrófono:**
- **INMP441** (Micrófono MEMS I2S digital)
- **Link Amazon MX:** https://www.amazon.com.mx/micrófono-omnidireccional-interfaz-INMP441-precisión/dp/B09X3216DN
- **Precio:** ~$100 MXN

### **Amplificador + Bocina:**
- **PAM8403** (Amplificador Clase D 2×3W)
- **Link Amazon MX:** https://www.amazon.com.mx/Amplificadora-2-5V-5-5V-Alimentación-Prototipos-Amplificador/dp/B0GDSQMX65
- **Precio:** ~$95 MXN

- **Bocina 3W 4Ω** (2 piezas)
- **Link Amazon MX:** https://www.amazon.com.mx/Gikfun-completa-Altavoz-Estéreo-altavoz/dp/B01CHYIU26
- **Precio:** ~$120 MXN

---

## 🎤 PARTE 1: CONECTAR MICRÓFONO INMP441 (I2S)

### **¿Por qué I2S y no USB?**
- Raspberry Pi Zero 2W **no tiene** puerto de audio analógico de entrada
- I2S es protocolo digital de alta calidad
- INMP441 es un micrófono MEMS digital (mejor que analógicos)
- No requiere conversión ADC adicional

### **Conexión Física del INMP441:**

```
┌─────────────────────────────────────────────────────────────┐
│                    INMP441 Micrófono                        │
│                                                             │
│  Pin INMP441    →    Raspberry Pi Zero 2W                  │
│  ──────────────────────────────────────────────────────     │
│  VCC (3.3V)     →    Pin 1  (3.3V Power)                   │
│  GND            →    Pin 6  (Ground)                        │
│  WS (Word Sel)  →    Pin 35 (GPIO19 - PCM_FS)             │
│  SCK (Clock)    →    Pin 12 (GPIO18 - PCM_CLK)            │
│  SD (Data)      →    Pin 38 (GPIO20 - PCM_DIN)            │
│  L/R            →    GND (canal izquierdo)                 │
│                      o 3.3V (canal derecho)                │
└─────────────────────────────────────────────────────────────┘
```

### **Diagrama Visual:**

```
INMP441                    Raspberry Pi Zero 2W
┌──────┐                   ┌─────────────────┐
│ VCC  │───────────────────│ Pin 1  (3.3V)   │
│ GND  │───────────────────│ Pin 6  (GND)    │
│ WS   │───────────────────│ Pin 35 (GPIO19) │
│ SCK  │───────────────────│ Pin 12 (GPIO18) │
│ SD   │───────────────────│ Pin 38 (GPIO20) │
│ L/R  │───────────────────│ Pin 6  (GND)    │
└──────┘                   └─────────────────┘
```

### **Tabla de Pines Raspberry Pi:**

| Pin Físico | GPIO | Función I2S | Conexión INMP441 |
|------------|------|-------------|------------------|
| 1 | - | 3.3V Power | VCC |
| 6 | - | Ground | GND |
| 12 | GPIO18 | PCM_CLK (Clock) | SCK |
| 35 | GPIO19 | PCM_FS (Frame Sync) | WS |
| 38 | GPIO20 | PCM_DIN (Data In) | SD |

---

## 🔧 CONFIGURACIÓN I2S EN RASPBERRY PI

### **1. Habilitar I2S en el Sistema:**

```bash
# Editar archivo de configuración
sudo nano /boot/config.txt
```

**Agregar al final del archivo:**
```
# Habilitar I2S
dtparam=i2s=on

# Overlay para I2S MEMS microphone
dtoverlay=i2s-mmap
dtoverlay=googlevoicehat-soundcard
```

**Guardar:** `Ctrl+O`, `Enter`, `Ctrl+X`

### **2. Reiniciar Raspberry Pi:**

```bash
sudo reboot
```

### **3. Verificar que I2S está habilitado:**

```bash
# Listar dispositivos de audio
arecord -l

# Deberías ver algo como:
# card 0: sndrpigooglevoi [snd_rpi_googlevoicehat_soundcard]
#   device 0: Google voiceHAT SoundCard HiFi voicehat-hifi-0 []
```

### **4. Instalar Herramientas de Audio:**

```bash
sudo apt update
sudo apt install -y alsa-utils

# Probar grabación (5 segundos)
arecord -D plughw:0,0 -f S16_LE -r 16000 -c 1 -d 5 test.wav

# Reproducir (necesitarás bocina conectada)
aplay test.wav
```

---

## 🔊 PARTE 2: CONECTAR BOCINA CON AMPLIFICADOR

### **¿Por qué necesitas amplificador?**
- Raspberry Pi Zero 2W tiene salida de audio por GPIO (PWM) o por adaptador USB
- El audio directo de GPIO es muy bajo volumen
- Un amplificador aumenta la señal a 3-5W (suficiente para bocina pequeña)

### **✅ Opción 1: Adaptador USB Audio + Amplificador AUX (RECOMENDADO - MÁS FÁCIL)**

**⚠️ IMPORTANTE:** Raspberry Pi Zero 2W **NO tiene puerto AUX/3.5mm** (solo RPi 3/4 lo tienen).

**Solución:** Usar adaptador USB a audio 3.5mm

**Ventajas:**
- ✅ **Plug and play** - solo conectar adaptador USB
- ✅ **No requiere configuración** de PWM
- ✅ **Mejor calidad de audio** que PWM
- ✅ **Control de volumen** integrado (potenciómetro en amplificador)
- ✅ **Fácil de reemplazar** si falla

#### **Componentes Necesarios:**

**1. Adaptador USB a Audio 3.5mm:**
- **Link Amazon MX:** https://www.amazon.com.mx/UGREEN-Adaptador-Micr%C3%B3fono-Altavoces-Auriculares/dp/B01N905VOY
- **Precio:** ~$150 MXN
- **Características:**
  - USB 2.0 a 3.5mm audio + micrófono
  - Plug and play (sin drivers)
  - Compatible con Linux/Raspberry Pi

**Alternativa económica:**
- **Link Amazon MX:** https://www.amazon.com.mx/MOSWAG-Adaptador-compatible-micr%C3%B3fono-aud%C3%ADfonos/dp/B09FZFRC54
- **Precio:** ~$100 MXN

**2. Amplificador DROK con entrada AUX:**
- **Link Amazon MX:** https://www.amazon.com.mx/DROK-amplificador-Amplificadores-potenci%C3%B3metro-Auriculares/dp/B077MKQJW2
- **Precio:** ~$200 MXN
- **Características:**
  - Entrada: AUX 3.5mm
  - Salida: 5W por canal (4Ω)
  - Alimentación: 5V DC
  - Control de volumen

**3. Cable AUX 3.5mm macho-macho:**
- Incluido con adaptador USB o comprar aparte (~$30 MXN)

#### **Conexión con USB Audio Adapter:**

```
┌─────────────────────────────────────────────────────────────┐
│         MÉTODO USB AUDIO - RECOMENDADO PARA RPi Zero 2W    │
│                                                             │
│  Raspberry Pi Zero 2W                                       │
│  ┌──────────────┐                                          │
│  │              │                                          │
│  │  Puerto USB  │──► Adaptador USB Audio                   │
│  │  (micro USB) │    │                                     │
│  │              │    └──► Jack 3.5mm ──► Cable AUX ──┐    │
│  └──────────────┘                                     │    │
│                                                       ▼    │
│  PowerBank 5V ────────────────────────────► ┌─────────────┐│
│  (Rojo +5V)                                 │Amplificador ││
│  (Negro GND)                                │DROK AUX     ││
│                                             │             ││
│                                             │VCC  GND  IN ││
│                                             │             ││
│                                             │OUT+ OUT-    ││
│                                             └──────┬──────┘│
│                                                    │       │
│                                                    ▼       │
│                                             Bocina 3W 4Ω  │
└─────────────────────────────────────────────────────────────┘
```

#### **Pasos de Instalación USB Audio:**

**1. Conectar adaptador USB:**

```bash
# Conectar adaptador USB a audio al puerto USB de Raspberry Pi Zero 2W
# (Necesitarás un cable OTG micro USB a USB-A si el adaptador es USB-A)

# Verificar que se detectó
lsusb
# Deberías ver: "C-Media Electronics Inc. Audio Adapter" o similar

# Listar dispositivos de audio
arecord -l
aplay -l
# Deberías ver "card 1" o "card 2" con el adaptador USB
```

**2. Configurar como dispositivo de audio por defecto:**

```bash
# Ver dispositivos disponibles
aplay -l

# Configurar USB como salida por defecto
sudo nano /etc/asound.conf
```

**Agregar (reemplazar X con número de card del USB):**
```
pcm.!default {
    type hw
    card 1
}

ctl.!default {
    type hw
    card 1
}
```

**3. Conectar físicamente:**

```
Raspberry Pi Zero 2W:
  Puerto USB ───────────► Adaptador USB Audio
  
Adaptador USB Audio:
  Jack 3.5mm ────────────► Cable AUX ──► Amplificador IN

PowerBank 5V:
  +5V (Rojo) ────────────► Amplificador VCC
  GND (Negro) ───────────► Amplificador GND

Amplificador:
  OUT+ / OUT- ───────────► Bocina 3W 4Ω
```

**4. Ajustar volumen:**

```bash
# Ver controles de audio
alsamixer
# Presionar F6 para seleccionar tarjeta USB
# Ajustar volumen con flechas

# O por comando (0-100%)
amixer -c 1 set PCM 80%
```

**5. Probar audio:**

```bash
# Tono de prueba
speaker-test -t wav -c 2 -D plughw:1,0

# Reproducir archivo
aplay -D plughw:1,0 /usr/share/sounds/alsa/Front_Center.wav
```

#### **Código Python con USB Audio:**

```python
import pyttsx3

# Inicializar TTS
engine = pyttsx3.init()
engine.setProperty('rate', 150)
engine.setProperty('volume', 1.0)

# Hablar
engine.say("Hola desde el guante inteligente")
engine.runAndWait()
```

**⚡ Ventaja:** pyttsx3 usa automáticamente el dispositivo de audio por defecto.

#### **Cable OTG (si es necesario):**

Si tu adaptador USB es USB-A y Raspberry Pi Zero 2W tiene micro USB:

**Cable OTG Micro USB a USB-A:**
- **Link Amazon MX:** Buscar "cable otg micro usb"
- **Precio:** ~$50 MXN
- O usar hub USB powered

**¡Listo! Mucho más simple que PWM y mejor calidad de audio.**

---

### **Opción 2: Usando PWM (Alternativa sin AUX)**

#### **Conexión Física PAM8403:**

```
┌─────────────────────────────────────────────────────────────┐
│              PAM8403 Amplificador + Bocina                  │
│                                                             │
│  Pin PAM8403    →    Raspberry Pi Zero 2W / Bocina         │
│  ──────────────────────────────────────────────────────     │
│  VCC (5V)       →    Pin 2  (5V Power) o PowerBank 5V      │
│  GND            →    Pin 9  (Ground)                        │
│  IN-L (Left)    →    Pin 32 (GPIO12 - PWM0)                │
│  IN-R (Right)   →    Pin 33 (GPIO13 - PWM1)                │
│  OUT-L+         →    Bocina Terminal +                      │
│  OUT-L-         →    Bocina Terminal -                      │
│  OUT-R+         →    (Opcional: segunda bocina)             │
│  OUT-R-         →    (Opcional: segunda bocina)             │
└─────────────────────────────────────────────────────────────┘
```

#### **Diagrama Visual:**

```
PAM8403                    Raspberry Pi Zero 2W
┌──────────┐               ┌─────────────────┐
│ VCC (5V) │───────────────│ Pin 2  (5V)     │
│ GND      │───────────────│ Pin 9  (GND)    │
│ IN-L     │───────────────│ Pin 32 (GPIO12) │
│ IN-R     │───────────────│ Pin 33 (GPIO13) │
│          │               └─────────────────┘
│ OUT-L+   │───┐
│ OUT-L-   │───┼───► Bocina 3W 4Ω
│ OUT-R+   │───┤     (Terminal + y -)
│ OUT-R-   │───┘
└──────────┘
```

#### **IMPORTANTE - Alimentación del PAM8403:**
```
⚠️ El PAM8403 necesita 5V, NO 3.3V

Opción A: Desde Raspberry Pi Pin 2 (5V)
  - Solo si la bocina no consume mucho
  - Máximo 500mA recomendado

Opción B: Desde PowerBank directamente (RECOMENDADO)
  - Conectar cable USB del PowerBank
  - Cortar y pelar cables rojo (5V) y negro (GND)
  - Conectar a VCC y GND del PAM8403
  - Evita sobrecargar la Raspberry Pi
```

### **Opción 2: Usando USB Audio Adapter (Alternativa más simple)**

Si prefieres algo más plug-and-play:

```bash
# Conectar adaptador USB a audio 3.5mm
# Link Amazon MX: ~$100-150 MXN
# Conectar bocina amplificada o audífonos

# Ventaja: Más fácil de configurar
# Desventaja: Ocupa puerto USB (Raspberry Pi Zero solo tiene 1)
```

---

## 🔧 CONFIGURACIÓN PWM AUDIO EN RASPBERRY PI

### **1. Habilitar PWM Audio:**

```bash
sudo nano /boot/config.txt
```

**Agregar:**
```
# Audio PWM
dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4
```

### **2. Configurar ALSA para PWM:**

```bash
sudo nano /etc/asound.conf
```

**Agregar:**
```
pcm.!default {
    type hw
    card 0
}

ctl.!default {
    type hw
    card 0
}
```

### **3. Reiniciar:**

```bash
sudo reboot
```

### **4. Probar Audio:**

```bash
# Generar tono de prueba
speaker-test -t wav -c 2

# Reproducir archivo
aplay /usr/share/sounds/alsa/Front_Center.wav
```

---

## 🐍 CÓDIGO PYTHON PARA AUDIO

### **Grabar Audio del Micrófono INMP441:**

```python
import pyaudio
import wave

# Configuración
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
RECORD_SECONDS = 5
OUTPUT_FILENAME = "grabacion.wav"

# Inicializar PyAudio
audio = pyaudio.PyAudio()

# Abrir stream de micrófono
stream = audio.open(
    format=FORMAT,
    channels=CHANNELS,
    rate=RATE,
    input=True,
    frames_per_buffer=CHUNK
)

print("🎤 Grabando...")

frames = []
for i in range(0, int(RATE / CHUNK * RECORD_SECONDS)):
    data = stream.read(CHUNK)
    frames.append(data)

print("✓ Grabación completa")

# Cerrar stream
stream.stop_stream()
stream.close()
audio.terminate()

# Guardar archivo WAV
with wave.open(OUTPUT_FILENAME, 'wb') as wf:
    wf.setnchannels(CHANNELS)
    wf.setsampwidth(audio.get_sample_size(FORMAT))
    wf.setframerate(RATE)
    wf.writeframes(b''.join(frames))

print(f"✓ Guardado en {OUTPUT_FILENAME}")
```

### **Reproducir Audio por Bocina:**

```python
import pyaudio
import wave

FILENAME = "grabacion.wav"

# Abrir archivo
wf = wave.open(FILENAME, 'rb')

# Inicializar PyAudio
audio = pyaudio.PyAudio()

# Abrir stream de salida
stream = audio.open(
    format=audio.get_format_from_width(wf.getsampwidth()),
    channels=wf.getnchannels(),
    rate=wf.getframerate(),
    output=True
)

print("🔊 Reproduciendo...")

# Leer y reproducir
data = wf.readframes(1024)
while data:
    stream.write(data)
    data = wf.readframes(1024)

print("✓ Reproducción completa")

# Cerrar
stream.stop_stream()
stream.close()
audio.terminate()
```

### **Text-to-Speech (TTS) con pyttsx3:**

```python
import pyttsx3

# Inicializar motor TTS
engine = pyttsx3.init()

# Configurar voz en español
voices = engine.getProperty('voices')
for voice in voices:
    if 'spanish' in voice.name.lower() or 'español' in voice.name.lower():
        engine.setProperty('voice', voice.id)
        break

# Configurar velocidad y volumen
engine.setProperty('rate', 150)    # Palabras por minuto
engine.setProperty('volume', 1.0)  # 0.0 a 1.0

# Hablar
texto = "Hola, soy el sistema de señas a voces"
print(f"🔊 Hablando: '{texto}'")
engine.say(texto)
engine.runAndWait()
```

### **Speech-to-Text (STT) con Google:**

```python
import speech_recognition as sr

# Inicializar reconocedor
recognizer = sr.Recognizer()

# Usar micrófono
with sr.Microphone() as source:
    print("🎤 Ajustando ruido ambiente...")
    recognizer.adjust_for_ambient_noise(source, duration=1)
    
    print("🎤 Escuchando... (habla ahora)")
    audio = recognizer.listen(source, timeout=5, phrase_time_limit=10)
    
    try:
        print("🔄 Procesando...")
        texto = recognizer.recognize_google(audio, language="es-MX")
        print(f"📝 Texto reconocido: '{texto}'")
        
    except sr.UnknownValueError:
        print("⚠️ No se pudo entender el audio")
    except sr.RequestError as e:
        print(f"❌ Error del servicio: {e}")
```

---

## 🔍 TROUBLESHOOTING

### **Problema: No se detecta el micrófono**

```bash
# Verificar dispositivos
arecord -l

# Si no aparece, revisar:
# 1. Conexiones físicas (especialmente VCC y GND)
# 2. Que I2S esté habilitado en /boot/config.txt
# 3. Reiniciar después de cambios

# Ver logs del sistema
dmesg | grep i2s
```

### **Problema: Micrófono graba pero con ruido**

```bash
# Ajustar ganancia
alsamixer

# Presionar F4 para captura
# Ajustar nivel con flechas arriba/abajo
# Guardar: sudo alsactl store
```

### **Problema: Bocina no suena**

```bash
# Verificar que PAM8403 tiene 5V (NO 3.3V)
# Medir con multímetro

# Probar con tono simple
speaker-test -t sine -f 440 -c 2

# Verificar volumen
alsamixer
# Presionar F5 para todos los controles
# Subir volumen con flechas
```

### **Problema: Audio distorsionado en bocina**

```bash
# Reducir volumen del sistema
alsamixer
# Bajar PCM a 70-80%

# Verificar que bocina sea 4Ω (no 8Ω)
# PAM8403 funciona mejor con 4Ω
```

### **Problema: PyAudio no instala**

```bash
# Instalar dependencias primero
sudo apt install -y portaudio19-dev python3-pyaudio

# Si sigue fallando, instalar desde apt
sudo apt install -y python3-pyaudio

# NO usar pip para PyAudio en Raspberry Pi
```

---

## 📊 RESUMEN DE CONEXIONES

### **Pines Usados en Raspberry Pi Zero 2W:**

| Pin Físico | GPIO | Función | Dispositivo |
|------------|------|---------|-------------|
| 1 | - | 3.3V | INMP441 VCC |
| 2 | - | 5V | PAM8403 VCC (opcional) |
| 6 | - | GND | INMP441 GND, PAM8403 GND |
| 9 | - | GND | Tierra común |
| 12 | GPIO18 | PCM_CLK | INMP441 SCK |
| 32 | GPIO12 | PWM0 | PAM8403 IN-L |
| 33 | GPIO13 | PWM1 | PAM8403 IN-R |
| 35 | GPIO19 | PCM_FS | INMP441 WS |
| 38 | GPIO20 | PCM_DIN | INMP441 SD |

### **Pines Libres para I2C (sensores):**

| Pin Físico | GPIO | Función |
|------------|------|---------|
| 3 | GPIO2 | I2C SDA |
| 5 | GPIO3 | I2C SCL |

---

## ✅ CHECKLIST DE INSTALACIÓN

### **Hardware:**
- [ ] INMP441 conectado a pines I2S (18, 19, 20)
- [ ] INMP441 L/R conectado a GND (canal izquierdo)
- [ ] PAM8403 conectado a pines PWM (12, 13)
- [ ] PAM8403 alimentado con 5V (no 3.3V)
- [ ] Bocina 3W 4Ω conectada a PAM8403 OUT-L
- [ ] Todas las tierras (GND) conectadas en común

### **Software:**
- [ ] I2S habilitado en `/boot/config.txt`
- [ ] PWM habilitado en `/boot/config.txt`
- [ ] Reiniciado después de cambios
- [ ] `arecord -l` muestra dispositivo de audio
- [ ] PyAudio instalado: `python3 -c "import pyaudio"`
- [ ] pyttsx3 instalado: `pip3 install pyttsx3`
- [ ] SpeechRecognition instalado: `pip3 install SpeechRecognition`

### **Pruebas:**
- [ ] Grabación de audio funciona: `arecord -d 5 test.wav`
- [ ] Reproducción funciona: `aplay test.wav`
- [ ] TTS funciona: `espeak "Hola mundo"`
- [ ] Volumen adecuado en `alsamixer`

---

## 🎯 INTEGRACIÓN CON SEÑAS A VOCES

El código en `rpi_right_glove.py` ya incluye:
- ✅ Recepción de audio del micrófono INMP441
- ✅ Conversión de voz a texto (Google Speech API)
- ✅ Síntesis de voz por bocina (pyttsx3)
- ✅ Display OLED para mostrar texto

**¡Todo listo para usar!** 🎉
