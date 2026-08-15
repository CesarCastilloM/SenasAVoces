# Sistema de Guantes LSM para ESP32

Sistema completo para capturar datos de movimiento de manos usando sensores BMI160 y sensores flex, diseñado para entrenar modelos de Lengua de Señas Mexicana (LSM).

## 🎯 Características

- **Doble guante**: Soporte para mano izquierda y derecha con sensores independientes
- **BMI160**: Acelerómetro de 3 ejes + giroscopio de 3 ejes por mano
- **5 sensores flex**: Por cada mano (pulgar, índice, medio, anular, meñique)
- **Captura estática y dinámica**: Modos adaptados para diferentes tipos de señas
- **Interfaz web**: Control completo desde navegador web
- **Almacenamiento local**: SPIFFS para guardar datos sin conexión
- **Sincronización con servidor**: Envío automático a servidor central
- **Calibración automática**: Sistema de calibración para sensores flex
- **Compatible con modelo LSM**: Formato de datos compatible con el sistema existente

## 🛠️ Hardware Requerido

### Componentes Principales
- ESP32 Development Board
- 2x BMI160 (IMU - acelerómetro + giroscopio)
- 10x Sensores Flex (5 por guante)
- Protoboard y cables de conexión
- Fuente de alimentación (5V)

### Pines ESP32 Utilizados

#### Sensores Flex Mano Izquierda
- Pulgar: GPIO34
- Índice: GPIO35  
- Medio: GPIO32
- Anular: GPIO33
- Meñique: GPIO25

#### Sensores Flex Mano Derecha
- Pulgar: GPIO26
- Índice: GPIO27
- Medio: GPIO14
- Anular: GPIO12
- Meñique: GPIO13

#### BMI160
- Mano Izquierda: GPIO4 (interrupción)
- Mano Derecha: GPIO16 (interrupción)
- Ambos usan I2C (SDA=GPIO21, SCL=GPIO22)

## 🔌 Diagrama de Conexión

```
ESP32                    Sensores Flex Mano Izquierda
GPIO34 ----------------- Pulgar
GPIO35 ----------------- Índice  
GPIO32 ----------------- Medio
GPIO33 ----------------- Anular
GPIO25 ----------------- Meñique

ESP32                    Sensores Flex Mano Derecha
GPIO26 ----------------- Pulgar
GPIO27 ----------------- Índice
GPIO14 ----------------- Medio
GPIO12 ----------------- Anular
GPIO13 ----------------- Meñique

ESP32                    BMI160 (I2C)
GPIO21 (SDA) ----------- SDA (ambos BMI160)
GPIO22 (SCL) ----------- SCL (ambos BMI160)
GPIO4 ------------------ INT (BMI160 izquierdo)
GPIO16 ----------------- INT (BMI160 derecho)
3.3V ------------------ VCC (ambos BMI160)
GND ------------------- GND (ambos BMI160)

ESP32                    Sensores Flex (Alimentación)
5V -------------------- VCC (todos los sensores flex)
GND ------------------- GND (todos los sensores flex)
```

## 💾 Formato de Datos

Los datos capturados siguen el formato compatible con el sistema LSM existente:

### Datos Estáticos (promedio de 15 frames)
```json
{
  "sign_name": "A",
  "mode": "static",
  "timestamp": 1234567890,
  "sample_rate": 50,
  "left_hand": [{
    "accel_x": 0.12, "accel_y": -0.98, "accel_z": 0.15,
    "gyro_x": 0.01, "gyro_y": -0.02, "gyro_z": 0.00,
    "flex_thumb": 0.85, "flex_index": 0.12, "flex_middle": 0.10,
    "flex_ring": 0.08, "flex_pinky": 0.95,
    "timestamp": 1234567890
  }],
  "metadata": {
    "left_connected": true,
    "right_connected": false,
    "calibrated": true
  }
}
```

### Datos Dinámicos (secuencia de 30 frames)
```json
{
  "sign_name": "J",
  "mode": "dynamic", 
  "timestamp": 1234567890,
  "sample_rate": 50,
  "left_hand": [
    {"accel_x": 0.1, "accel_y": -0.9, ... "timestamp": 100},
    {"accel_x": 0.2, "accel_y": -0.8, ... "timestamp": 120},
    ... 28 frames más
  ],
  "metadata": {...}
}
```

## 🚀 Instalación y Configuración

### 1. Configurar PlatformIO
```bash
# Instalar PlatformIO si no está instalado
pip install platformio

# Clonar o descargar el proyecto
cd esp32_glove_data_collector

# Instalar dependencias
pio lib install
```

### 2. Compilar y Subir
```bash
# Compilar el firmware
pio run

# Subir al ESP32
pio run --target upload

# Monitor serial (opcional)
pio device monitor
```

### 3. Configurar WiFi
Método 1 - Interfaz Web:
1. Conéctese al punto de acceso "LSM-Gloves" (contraseña: password123)
2. Abra http://192.168.4.1 en su navegador
3. Configure su red WiFi en la sección "Configuración WiFi"

Método 2 - Serial:
```
wifi:MI_RED:MI_CONTRASEÑA
```

### 4. Calibrar Sensores
Antes de capturar datos, calibre los sensores flex:

Método 1 - Interfaz Web:
1. Abra la interfaz web
2. Haga clic en "🔧 Calibrar"
3. Siga las instrucciones (extender dedos, luego flexionar)

Método 2 - Serial:
```
calibrate
```

## 📱 Uso del Sistema

### Interfaz Web
1. Abra http://IP_DEL_ESP32 en su navegador
2. Establezca el nombre de la seña (ej: "A", "B", "J", "1", "2")
3. Seleccione tipo de captura:
   - 📸 **Captura Estática**: Para señas sin movimiento (A, B, C, 1-5)
   - 🎬 **Captura Dinámica**: Para señas con movimiento (J, Z, 10-20)
4. Haga clic en el botón correspondiente
5. Realice la seña cuando aparezca la cuenta regresiva
6. Los datos se guardan automáticamente

### Comandos Serial
```
status          - Mostrar estado de sensores
calibrate       - Calibrar sensores flex  
sign:A          - Establecer nombre de seña
static          - Iniciar captura estática
dynamic         - Iniciar captura dinámica
wifi:SSID:PASS  - Configurar WiFi
help            - Mostrar ayuda
```

## 📊 Almacenamiento y Sincronización

### Almacenamiento Local
- Los datos se guardan en SPIFFS en formato JSON
- Nombres de archivo: `data_NOMBRE_SEÑA_TIMESTAMP.json`
- Capacidad aproximada: 1000+ muestras

### Sincronización con Servidor
- Los datos se envían automáticamente al servidor configurado
- Endpoint: `http://SERVIDOR:5000/api/glove_data`
- Si no hay conexión, los datos se guardan localmente
- Reintentos automáticos cuando se restaura la conexión

## 🔧 Configuración Avanzada

### Frecuencia de Muestreo
```cpp
// En glove_sensors.h
#define SAMPLE_RATE_HZ    50    // Cambiar según necesidad
```

### Tamaños de Buffer
```cpp
#define BUFFER_SIZE       30    // Frames para señas dinámicas
#define STATIC_SAMPLES    15    // Frames para promedio estático
```

### Endpoint del Servidor
```cpp
// En main.cpp
String server_endpoint = "http://YOUR_SERVER_IP:5000/api/glove_data";
```

## 🐛 Solución de Problemas

### Sensores No Detectados
- Verifique conexiones I2C (SDA=GPIO21, SCL=GPIO22)
- Confirme alimentación 3.3V para BMI160
- Revise pines de interrupción (GPIO4, GPIO16)

### Datos de Flex Incorrectos
- Ejecute calibración antes de capturar
- Verifique conexiones de sensores flex
- Confirme alimentación 5V para sensores flex

### Problemas WiFi
- Verifique credenciales en la configuración
- Confirme que el servidor está accesible
- Revise firewall del servidor

### Memoria Insuficiente
- Reduzca BUFFER_SIZE si es necesario
- Limpie archivos antiguos de SPIFFS
- Use modo release en PlatformIO

## 📈 Integración con Sistema LSM

Los datos capturados son compatibles con el sistema LSM existente:

1. **Formato de landmarks**: Los datos de sensores se pueden convertir al formato (21, 3) esperado
2. **Clases estáticas/dinámicas**: El sistema detecta automáticamente el modo apropiado
3. **Metadata**: Incluye información necesaria para el entrenamiento

Para convertir datos de sensores a formato MediaPipe:
```python
def sensor_to_landmarks(sensor_data):
    # Implementar conversión de datos IMU + flex a landmarks (21, 3)
    # Usar transformaciones geométricas basadas en anatomía de la mano
    pass
```

## 📄 Licencia

Este proyecto es parte del sistema SenasAVoces y está disponible bajo los mismos términos.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:
1. Reporte bugs usando issues
2. Sugerencias de mejoras mediante pull requests
3. Documente cambios importantes

---

**Nota**: Este sistema está diseñado para complementar el sistema existente de captura por visión artificial, proporcionando datos de sensores físicos para mejorar la precisión del reconocimiento de señas LSM.
