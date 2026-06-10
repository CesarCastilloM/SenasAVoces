# 📖 GUÍA DE INSTALACIÓN - SEÑAS A VOCES

## 🎯 Resumen del Sistema

Sistema completo de traducción LSM (Lenguaje de Señas Mexicano) bidireccional:
- **LSM → Voz:** Guantes traducen señas a audio
- **Voz → Texto:** Micrófono captura audio y muestra en OLED

---

## 📦 Componentes Necesarios

Ver lista completa con links de Amazon México en el documento principal.

**Total:** ~$3,890 MXN (~$210 USD)

---

## 🔧 INSTALACIÓN - GUANTE IZQUIERDO (ESP32)

### **1. Instalar PlatformIO**

```bash
# Opción 1: VS Code Extension
# Buscar "PlatformIO IDE" en extensiones de VS Code

# Opción 2: CLI
pip install platformio
```

### **2. Configurar Proyecto**

```bash
cd c:\Users\Cesar\CascadeProjects\norvi_rs485_soil_sensor\src\bluetooth_glove

# Crear estructura de proyecto PlatformIO
mkdir -p esp32_left_glove
cd esp32_left_glove
pio init --board esp32dev

# Copiar archivos
cp ../esp32_left_glove.cpp src/main.cpp
cp ../platformio.ini .
```

### **3. Modificar IP de Raspberry Pi**

Editar `src/main.cpp` línea 23:
```cpp
const char* RPI_IP = "192.168.1.100";  // CAMBIAR a IP real de tu Raspberry Pi
```

### **4. Compilar y Subir**

```bash
# Compilar
pio run

# Subir a ESP32 (conectado en COM3 o el puerto correspondiente)
pio run --target upload

# Ver monitor serial
pio device monitor
```

### **5. Verificar Funcionamiento**

Deberías ver en el monitor serial:
```
╔════════════════════════════════════════════╗
║   SEÑAS A VOCES - Guante Izquierdo (ESP32) ║
╚════════════════════════════════════════════╝

✓ I2C inicializado (SDA=21, SCL=22)
✓ ADS1115 #1 (0x48) inicializado
✓ ADS1115 #2 (0x49) inicializado
✓ MPU6050 inicializado

🌐 Conectando a WiFi Enterprise...
✓ WiFi conectado
✓ IP del ESP32: 192.168.1.101
✓ Enviando datos a: 192.168.1.100:5000

✓ Sistema listo - Guante Izquierdo
```

---

## 🔧 INSTALACIÓN - GUANTE DERECHO (Raspberry Pi)

### **1. Instalar Raspberry Pi OS**

```bash
# Descargar Raspberry Pi Imager
# https://www.raspberrypi.com/software/

# Flashear microSD 32GB con:
# - Raspberry Pi OS Lite (64-bit)
# - Configurar WiFi "Tec" con credenciales WPA2 Enterprise
# - Habilitar SSH
```

### **2. Configurar WiFi Enterprise en Raspberry Pi**

Editar `/etc/wpa_supplicant/wpa_supplicant.conf`:
```bash
sudo nano /etc/wpa_supplicant/wpa_supplicant.conf
```

Agregar:
```
network={
    ssid="Tec"
    key_mgmt=WPA-EAP
    eap=PEAP
    identity="A01254425"
    password="Ccm2006066871@"
    phase2="auth=MSCHAPV2"
}
```

Reiniciar WiFi:
```bash
sudo systemctl restart wpa_supplicant
sudo systemctl restart networking
```

### **3. Habilitar I2C, I2S y PWM**

```bash
sudo raspi-config
# Interface Options → I2C → Enable
# Interface Options → SPI → Enable (para I2S)

# Editar /boot/config.txt
sudo nano /boot/config.txt
```

Agregar:
```
dtparam=i2c_arm=on
dtparam=i2s=on
dtoverlay=i2s-mmap
```

Reiniciar:
```bash
sudo reboot
```

### **4. Instalar Dependencias del Sistema**

```bash
sudo apt update
sudo apt upgrade -y

# Librerías I2C
sudo apt install -y python3-pip python3-dev i2c-tools

# Librerías de audio
sudo apt install -y portaudio19-dev python3-pyaudio
sudo apt install -y espeak espeak-data libespeak-dev

# Librerías gráficas para OLED
sudo apt install -y libopenjp2-7 libtiff5 libfreetype6-dev

# Git (si no está instalado)
sudo apt install -y git
```

### **5. Instalar Librerías Python**

```bash
cd /home/pi
mkdir senas_a_voces
cd senas_a_voces

# Copiar archivos
# (transferir rpi_right_glove.py y requirements.txt desde tu PC)

# Instalar dependencias
pip3 install -r requirements.txt

# Si hay error con PyAudio, instalar manualmente:
sudo apt install -y python3-pyaudio
```

### **6. Verificar Direcciones I2C**

```bash
sudo i2cdetect -y 1
```

Deberías ver:
```
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- -- 
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- 
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- 
30: -- -- -- -- -- -- -- -- -- -- -- -- 3c -- -- -- 
40: -- -- -- -- -- -- -- -- 48 49 -- -- -- -- -- -- 
50: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- 
60: -- -- -- -- -- -- -- -- 68 -- -- -- -- -- -- -- 
70: -- -- -- -- -- -- -- --
```

- `3c` = OLED Display
- `48` = ADS1115 #1
- `49` = ADS1115 #2
- `68` = MPU6050

### **7. Ejecutar Script**

```bash
python3 rpi_right_glove.py
```

Deberías ver:
```
==================================================
  SEÑAS A VOCES - Guante Derecho (Raspberry Pi)
==================================================

✓ I2C inicializado
✓ ADS1115 #1 (0x48) inicializado
✓ ADS1115 #2 (0x49) inicializado
✓ MPU6050 inicializado
✓ Display OLED inicializado
✓ TTS configurado: Spanish
✓ Speech Recognition inicializado

==================================================

📡 Escuchando en puerto 5000 para datos del guante izquierdo...
🎤 Iniciando escucha de micrófono...
🚀 Iniciando loop principal...
```

---

## 🔌 CONEXIONES FÍSICAS

Ver archivo `DIAGRAMAS_CONEXION.md` para diagramas detallados.

### **Resumen Guante Izquierdo (ESP32):**
```
ESP32:
  GPIO21 (SDA) ──┬── MPU6050
                 ├── ADS1115 #1 (0x48)
                 └── ADS1115 #2 (0x49)
  GPIO22 (SCL) ──┘

ADS1115 #1:
  A0 ← Flex Sensor Pulgar (con 10kΩ a GND)
  A1 ← Flex Sensor Índice (con 10kΩ a GND)
  A2 ← Flex Sensor Medio (con 10kΩ a GND)
  A3 ← Flex Sensor Anular (con 10kΩ a GND)

ADS1115 #2:
  A0 ← Flex Sensor Meñique (con 10kΩ a GND)
```

### **Resumen Guante Derecho (Raspberry Pi):**
```
Raspberry Pi:
  GPIO2 (SDA) ───┬── OLED Display (0x3C)
                 ├── MPU6050 (0x68)
                 ├── ADS1115 #1 (0x48)
                 └── ADS1115 #2 (0x49)
  GPIO3 (SCL) ───┘
  
  GPIO18 (BCK) ──┬── INMP441 Micrófono
  GPIO19 (WS)  ──┤
  GPIO20 (SD)  ──┘
  
  GPIO12 (PWM) ──┬── PAM8403 Amplificador
  GPIO13 (PWM) ──┘
```

---

## 🎮 USO DEL SISTEMA

### **Encendido:**
1. Encender Raspberry Pi (guante derecho)
2. Esperar 60 segundos (boot)
3. SSH o conectar monitor: `python3 rpi_right_glove.py`
4. Encender ESP32 (guante izquierdo)
5. Verificar conexión WiFi en ambos

### **Calibración:**
1. Mano completamente abierta → Anotar valores flex
2. Mano completamente cerrada → Anotar valores flex
3. Ajustar `FLEX_THRESHOLD` en código Python

### **Traducción LSM → Voz:**
1. Hacer señas con ambas manos
2. Sistema reconoce gesto
3. Bocina reproduce palabra/frase

### **Traducción Voz → Texto:**
1. Persona habla cerca del micrófono
2. Sistema convierte a texto
3. OLED muestra el texto

---

## 🐛 Troubleshooting

### **ESP32 no conecta a WiFi:**
```bash
# Verificar credenciales en código
# Verificar que estás en rango de red "Tec"
# Probar con WiFi personal primero
```

### **Raspberry Pi no detecta I2C:**
```bash
sudo i2cdetect -y 1
# Si no aparecen dispositivos, verificar conexiones físicas
# Verificar que I2C está habilitado en raspi-config
```

### **No se reciben datos UDP:**
```bash
# En Raspberry Pi, verificar IP:
hostname -I

# Actualizar RPI_IP en código ESP32
# Verificar firewall: sudo ufw status
```

### **Micrófono no funciona:**
```bash
# Verificar dispositivos de audio
arecord -l

# Probar grabación
arecord -d 5 test.wav
aplay test.wav
```

### **TTS no habla:**
```bash
# Verificar espeak
espeak "Hola mundo"

# Verificar bocina conectada
speaker-test -t wav -c 2
```

---

## 📝 Archivos del Proyecto

```
bluetooth_glove/
├── esp32_left_glove.cpp       # Código ESP32 (guante izquierdo)
├── rpi_right_glove.py         # Código Raspberry Pi (guante derecho)
├── platformio.ini             # Configuración PlatformIO
├── requirements.txt           # Dependencias Python
├── DIAGRAMAS_CONEXION.md      # Diagramas detallados
└── README_INSTALACION.md      # Este archivo
```

---

## 🚀 Próximos Pasos

1. **Entrenar Modelo ML:** Usar TensorFlow Lite para reconocimiento LSM completo
2. **Expandir Vocabulario:** Agregar más gestos y palabras
3. **Optimizar Batería:** Implementar sleep modes
4. **Mejorar UX:** Agregar feedback háptico (vibración)
5. **App Móvil:** Crear app complementaria para configuración

---

## 📞 Soporte

Para dudas o problemas, revisar:
- Diagramas de conexión
- Monitor serial del ESP32
- Logs de Raspberry Pi
- Verificar voltajes (3.3V para I2C, 5V para amplificador)

**¡Éxito con tu proyecto SEÑAS A VOCES!** 🤟🎉
