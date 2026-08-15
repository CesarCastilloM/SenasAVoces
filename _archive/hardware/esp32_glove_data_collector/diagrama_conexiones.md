# Diagrama de Conexiones - Guantes LSM ESP32

## 📋 Resumen de Conexiones

### ESP32 a Sensores Flex Mano Izquierda
```
ESP32    →    Sensor Flex
GPIO34   →    Pulgar (resistencia 10kΩ a GND)
GPIO35   →    Índice (resistencia 10kΩ a GND)  
GPIO32   →    Medio (resistencia 10kΩ a GND)
GPIO33   →    Anular (resistencia 10kΩ a GND)
GPIO25   →    Meñique (resistencia 10kΩ a GND)
```

### ESP32 a Sensores Flex Mano Derecha
```
ESP32    →    Sensor Flex
GPIO26   →    Pulgar (resistencia 10kΩ a GND)
GPIO27   →    Índice (resistencia 10kΩ a GND)
GPIO14   →    Medio (resistencia 10kΩ a GND)
GPIO12   →    Anular (resistencia 10kΩ a GND)
GPIO13   →    Meñique (resistencia 10kΩ a GND)
```

### ESP32 a BMI160 (I2C Compartido)
```
ESP32    →    BMI160 Izquierdo    →    BMI160 Derecho
GPIO21   →    SDA                 →    SDA
GPIO22   →    SCL                 →    SCL  
GPIO4    →    INT                 →    (no conectado)
GPIO16   →    (no conectado)      →    INT
3.3V     →    VCC                 →    VCC
GND      →    GND                 →    GND
```

### Alimentación General
```
ESP32    →    Componentes
5V       →    VCC todos los sensores flex (10 en total)
3.3V     →    VCC ambos BMI160
GND      →    GND todos los componentes
```

## 🔌 Diagrama Detallado

```
                    ┌─────────────────┐
                    │     ESP32       │
                    │                 │
                    │    GPIO34 ──────┼───┐
                    │    GPIO35 ──────┼───┤
                    │    GPIO32 ──────┼───┤  Sensores Flex
                    │    GPIO33 ──────┼───┤  Mano Izquierda
                    │    GPIO25 ──────┼───┤
                    │                 │   │
                    │    GPIO26 ──────┼───┼───┐
                    │    GPIO27 ──────┼───┼───┤  Sensores Flex
                    │    GPIO14 ──────┼───┼───┤  Mano Derecha  
                    │    GPIO12 ──────┼───┼───┤
                    │    GPIO13 ──────┼───┼───┘
                    │                 │   │
                    │    GPIO21 ──────┼───┼───┐
                    │    (SDA)        │   │   │
                    │                 │   │   │
                    │    GPIO22 ──────┼───┼───┼───┐
                    │    (SCL)        │   │   │   │
                    │                 │   │   │   │
                    │    GPIO4  ──────┼───┘   │   │
                    │    (INT)        │       │   │
                    │                 │       │   │
                    │    GPIO16 ──────┼───────┘   │
                    │    (INT)        │           │
                    │                 │           │
                    │    5V ──────────┼───────────┼───┐
                    │                 │           │   │
                    │    3.3V ────────┼───────────┼───┼───┐
                    │                 │           │   │   │
                    │    GND ─────────┼───────────┼───┼───┼───┐
                    └─────────────────┘           │   │   │   │
                                                │   │   │   │
                    ┌─────────────────┐           │   │   │   │
                    │ BMI160 Izquierdo│           │   │   │   │
                    │                 │           │   │   │   │
                    │ SDA ────────────┘           │   │   │   │
                    │ SCL ────────────────────────┘   │   │   │
                    │ INT ────────────────────────────┘   │   │
                    │ VCC ─────────────────────────────────┘   │
                    │ GND ─────────────────────────────────────┘
                    └─────────────────┘

                    ┌─────────────────┐
                    │ BMI160 Derecho  │
                    │                 │
                    │ SDA ────────────┘
                    │ SCL ────────────┘
                    │ INT ────────────┘
                    │ VCC ────────────┘
                    │ GND ────────────┘
                    └─────────────────┘

                    ┌─────────────────┐
                    │  Sensor Flex    │
                    │  (x10 unidades) │
                    │                 │
                    │ Señal ──────────┘
                    │ VCC ────────────┘
                    │ GND ────────────┘
                    └─────────────────┘
```

## 🛠️ Materiales y Herramientas

### Componentes Electrónicos
- 1x ESP32 Development Board
- 2x Módulo BMI160 (IMU 6DOF)
- 10x Sensores Flex (resistencia variable)
- 10x Resistencias 10kΩ (pull-down para sensores flex)
- Protoboard de tamaño mediano
- Cables jumper (macho-macho, macho-hembra)

### Herramientas
- Soldador y estaño (opcional, para conexiones permanentes)
- Multímetro (para verificar conexiones)
- Pinzas y cortador de cables
- Cinta aislante o heat shrink

## ⚠️ Notas Importantes

### Sensores Flex
- Los sensores flex requieren una resistencia pull-down de 10kΩ
- Valores típicos: 2000Ω (dedo extendido) a 4000Ω (dedo flexionado)
- Conectar a 5V para mejor resolución del ADC
- El ESP32 tiene ADC de 12 bits (0-4095)

### BMI160
- Usa comunicación I2C compartida entre ambos módulos
- Direcciones I2C por defecto: 0x68 o 0x69
- Requiere 3.3V para alimentación
- Los pines INT son opcionales pero recomendados

### Consideraciones de Potencia
- Los sensores flex consumen poca corriente (~5mA cada uno)
- BMI160 consume ~1.5mA cada uno en modo normal
- El ESP32 puede alimentar todos los componentes directamente

### Montaje Físico
- Montar BMI160 en el dorso de la mano (cerca de la muñeca)
- Sensores flex en los dedos (en la articulación principal)
- Usar cables flexibles y refuerzos en zonas de movimiento
- Considerar usar un conector entre guantes y ESP32

## 🔍 Verificación de Conexiones

### Test de Sensores Flex
```bash
# En monitor serial
status
# Debe mostrar valores entre 0.0 y 1.0 para cada dedo
```

### Test de BMI160
```bash
# Verificar detección inicial
# Debe mostrar "BMI160 izquierdo detectado" y "BMI160 derecho detectado"
```

### Test General
```bash
# Comando completo de diagnóstico
status
# Debe mostrar estado de todos los sensores y conexión WiFi
```

## 📋 Checklist de Instalación

- [ ] Conectar sensores flex mano izquierda (GPIO34,35,32,33,25)
- [ ] Conectar sensores flex mano derecha (GPIO26,27,14,12,13)
- [ ] Añadir resistencias pull-down 10kΩ a todos los sensores flex
- [ ] Conectar BMI160 izquierdo (I2C + INT GPIO4)
- [ ] Conectar BMI160 derecho (I2C + INT GPIO16)
- [ ] Conectar alimentación 5V a sensores flex
- [ ] Conectar alimentación 3.3V a BMI160
- [ ] Conectar todas las tierras (GND)
- [ ] Verificar conexiones con multímetro
- [ ] Subir firmware al ESP32
- [ ] Calibrar sensores flex
- [ ] Probar captura de datos

## 🚨 Precauciones de Seguridad

- Trabajar con el ESP32 desconectado de la alimentación
- Verificar polaridad antes de conectar componentes
- No aplicar más de 3.3V a los pines del ESP32
- Usar cables cortos para reducir ruido en señales analógicas
- Aislar conexiones para evitar cortocircuitos
