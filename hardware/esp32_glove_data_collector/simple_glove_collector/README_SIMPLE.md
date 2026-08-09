# Colector Simple de Guantes LSM

Versión simplificada con botón físico para captura de datos de guantes LSM.

## 🎯 Características

- **Botón físico**: Botón FLASH (GPIO0) para iniciar/detener grabación
- **Control por serial**: Comandos simples para configurar seña
- **Doble guante**: Soporte para mano izquierda y derecha
- **BMI160**: Acelerómetro + giroscopio por mano
- **5 sensores flex**: Por cada mano
- **Guardado automático**: Datos guardados en SPIFFS como JSON

## 🔌 PINES UTILIZADOS

### Botón de Grabación
```
GPIO0 - Botón FLASH (integrado en ESP32)
```

### Sensores Flex Mano Izquierda
```
GPIO34 - Pulgar
GPIO35 - Índice
GPIO32 - Medio
GPIO33 - Anular
GPIO25 - Meñique
```

### Sensores Flex Mano Derecha
```
GPIO26 - Pulgar
GPIO27 - Índice
GPIO14 - Medio
GPIO12 - Anular
GPIO13 - Meñique
```

### BMI160 (Compartido)
```
GPIO21 - SDA (I2C)
GPIO22 - SCL (I2C)
GPIO4  - INT (BMI160 izquierdo)
GPIO16 - INT (BMI160 derecho)
```

### Alimentación
```
5V   - Todos los sensores flex
3.3V - Ambos BMI160
GND  - Todos los componentes
```

## 🚀 Instalación Rápida

### 1. Conexiones
1. Conectar sensores según la lista de pines
2. Añadir resistencias 10kΩ pull-down a todos los sensores flex
3. Conectar alimentación 5V y 3.3V
4. Verificar todas las conexiones a tierra

### 2. Subir Código
```bash
cd simple_glove_collector
pio run --target upload
pio device monitor
```

### 3. Uso
1. Abrir monitor serial a 115200 baud
2. Establecer nombre de seña: `sign:A`
3. Presionar botón FLASH para grabar
4. Soltar botón cuando termine la seña
5. Los datos se guardan automáticamente

## 📱 Comandos Serial

```
sign:<nombre>    - Establecer nombre de seña (ej: sign:A, sign:J, sign:1)
status           - Mostrar estado del sistema
list             - Listar archivos guardados
help             - Mostrar ayuda
```

## 🎮 Cómo Usar

1. **Preparar**: Conecte todos los sensores y alimente el ESP32
2. **Configurar**: Abra monitor serial y escriba `sign:NOMBRE_SEÑA`
3. **Grabar**: Presione y mantenga presionado el botón FLASH
4. **Realizar**: Ejecute la seña mientras mantiene el botón presionado
5. **Soltar**: Suelte el botón cuando termine la seña
6. **Repetir**: Los datos se guardan, puede grabar otra muestra

## 📊 Formato de Datos

Los datos se guardan en formato JSON compatible con el sistema LSM:

```json
{
  "sign_name": "A",
  "mode": "dynamic",
  "timestamp": 1234567890,
  "sample_count": 45,
  "sample_rate": 50,
  "data": [
    {
      "timestamp": 1234567890,
      "accel_x": 0.12, "accel_y": -0.98, "accel_z": 0.15,
      "gyro_x": 0.01, "gyro_y": -0.02, "gyro_z": 0.00,
      "flex_thumb": 0.85, "flex_index": 0.12, "flex_middle": 0.10,
      "flex_ring": 0.08, "flex_pinky": 0.95
    }
  ],
  "metadata": {
    "left_connected": true,
    "right_connected": false,
    "device_id": "esp32_glove_v1"
  }
}
```

## 🔧 Diagrama Simplificado

```
ESP32
│
├── GPIO0 ── Botón FLASH (grabar)
│
├── GPIO34,35,32,33,25 ── Flex mano izquierda
├── GPIO26,27,14,12,13 ── Flex mano derecha
│
├── GPIO21 (SDA) ──┐
├── GPIO22 (SCL) ──┼── BMI160 izquierdo + derecho
├── GPIO4  ────────┤── INT izquierdo
├── GPIO16 ────────┘── INT derecho
│
├── 5V ── Todos los sensores flex
├── 3.3V ── Ambos BMI160
└── GND ── Todos los componentes
```

## ⚡ Características Técnicas

- **Frecuencia de muestreo**: 50Hz
- **Resolución ADC**: 12 bits (0-4095)
- **Memoria**: SPIFFS para almacenamiento
- **Formato**: JSON con timestamps
- **Compatibilidad**: Sistema LSM existente

## 🐛 Problemas Comunes

**Botón no responde**: Verifique que está usando el botón FLASH (GPIO0)

**Sensores flex no leen**: Confirme resistencias pull-down de 10kΩ

**BMI160 no detectado**: Verifique conexiones I2C y alimentación 3.3V

**No guarda archivos**: Verifique que SPIFFS está formateado correctamente

## 📋 Checklist Rápido

- [ ] Botón FLASH (GPIO0) funcionando
- [ ] 10 sensores flex conectados con resistencias 10kΩ
- [ ] 2 BMI160 conectados via I2C
- [ ] Alimentación 5V y 3.3V conectada
- [ ] Todas las tierras conectadas
- [ ] Código subido exitosamente
- [ ] Monitor serial funcionando a 115200
- [ ] Primer test de grabación completado

---

**Listo para capturar datos de señas LSM con solo presionar un botón** 🎯
