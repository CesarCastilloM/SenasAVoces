# 🔌 DIAGRAMAS DE CONEXIÓN - SEÑAS A VOCES

## 📋 Tabla de Componentes

### **Guante Izquierdo (ESP32)**
| Componente | Dirección I2C | Pines |
|------------|---------------|-------|
| ESP32 DevKit | - | - |
| MPU6050 | 0x68 | SDA=GPIO21, SCL=GPIO22 |
| ADS1115 #1 | 0x48 | SDA=GPIO21, SCL=GPIO22 |
| ADS1115 #2 | 0x49 | SDA=GPIO21, SCL=GPIO22 |
| Flex Sensor 1 (Pulgar) | - | ADS1115 #1 → A0 |
| Flex Sensor 2 (Índice) | - | ADS1115 #1 → A1 |
| Flex Sensor 3 (Medio) | - | ADS1115 #1 → A2 |
| Flex Sensor 4 (Anular) | - | ADS1115 #1 → A3 |
| Flex Sensor 5 (Meñique) | - | ADS1115 #2 → A0 |
| PowerBank 5000mAh | - | USB → ESP32 |

### **Guante Derecho (Raspberry Pi Zero 2W)**
| Componente | Dirección I2C | Pines |
|------------|---------------|-------|
| Raspberry Pi Zero 2W | - | - |
| OLED Display 0.96" | 0x3C | SDA=GPIO2, SCL=GPIO3 |
| MPU6050 | 0x68 | SDA=GPIO2, SCL=GPIO3 |
| ADS1115 #1 | 0x48 | SDA=GPIO2, SCL=GPIO3 |
| ADS1115 #2 | 0x49 | SDA=GPIO2, SCL=GPIO3 |
| Flex Sensor 1 (Pulgar) | - | ADS1115 #1 → A0 |
| Flex Sensor 2 (Índice) | - | ADS1115 #1 → A1 |
| Flex Sensor 3 (Medio) | - | ADS1115 #1 → A2 |
| Flex Sensor 4 (Anular) | - | ADS1115 #1 → A3 |
| Flex Sensor 5 (Meñique) | - | ADS1115 #2 → A0 |
| Micrófono INMP441 | - | BCK=GPIO18, WS=GPIO19, SD=GPIO20 |
| Amplificador PAM8403 | - | Left=GPIO12, Right=GPIO13 |
| Bocina 3W 4Ω | - | PAM8403 OUT+ / OUT- |
| PowerBank 5000mAh | - | USB → Raspberry Pi |

---

## 🔌 GUANTE IZQUIERDO (ESP32)

```
┌─────────────────────────────────────────────────────────────┐
│                      ESP32 DevKit                           │
│                                                             │
│  GPIO21 (SDA) ────┬────┬────┬──── I2C Bus                  │
│  GPIO22 (SCL) ────┼────┼────┼──── I2C Bus                  │
│                   │    │    │                               │
│  3.3V ────────────┼────┼────┼──── Alimentación I2C         │
│  GND ─────────────┼────┼────┼──── Tierra                   │
│                   │    │    │                               │
│  WiFi UDP ────────┼────┼────┼──── Envía a Raspberry Pi     │
│                   │    │    │                               │
└───────────────────┼────┼────┼─────────────────────────────┘
                    │    │    │
                    ▼    ▼    ▼
        ┌───────────┴─┐  │    │
        │  MPU6050    │  │    │
        │  (0x68)     │  │    │
        │             │  │    │
        │ VCC ← 3.3V  │  │    │
        │ GND ← GND   │  │    │
        │ SDA ← GPIO21│  │    │
        │ SCL ← GPIO22│  │    │
        └─────────────┘  │    │
                         │    │
             ┌───────────┴─┐  │
             │ ADS1115 #1  │  │
             │  (0x48)     │  │
             │             │  │
             │ VCC ← 3.3V  │  │
             │ GND ← GND   │  │
             │ SDA ← GPIO21│  │
             │ SCL ← GPIO22│  │
             │             │  │
             │ A0 ← Flex 1 │◄─┼── Pulgar (con resistencia 10kΩ)
             │ A1 ← Flex 2 │◄─┼── Índice (con resistencia 10kΩ)
             │ A2 ← Flex 3 │◄─┼── Medio (con resistencia 10kΩ)
             │ A3 ← Flex 4 │◄─┼── Anular (con resistencia 10kΩ)
             └─────────────┘  │
                              │
                  ┌───────────┴─┐
                  │ ADS1115 #2  │
                  │  (0x49)     │
                  │             │
                  │ VCC ← 3.3V  │
                  │ GND ← GND   │
                  │ SDA ← GPIO21│
                  │ SCL ← GPIO22│
                  │             │
                  │ A0 ← Flex 5 │◄── Meñique (con resistencia 10kΩ)
                  └─────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Divisor de Voltaje para Flex Sensors          │
│                                                             │
│  3.3V ────┬──────[ Flex Sensor ]──────┬──── GND           │
│           │                            │                    │
│           └──── ADS1115 Ax ────[ 10kΩ ]┘                   │
│                                                             │
│  Repetir para cada uno de los 5 sensores de flexión        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Alimentación                             │
│                                                             │
│  PowerBank 5000mAh (5V USB)                                │
│       │                                                     │
│       └──── Micro USB ──── ESP32 (regulador interno 3.3V)  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔌 GUANTE DERECHO (Raspberry Pi Zero 2W)

```
┌─────────────────────────────────────────────────────────────┐
│                 Raspberry Pi Zero 2W                        │
│                                                             │
│  GPIO2 (SDA) ─────┬────┬────┬────┬──── I2C Bus            │
│  GPIO3 (SCL) ─────┼────┼────┼────┼──── I2C Bus            │
│                   │    │    │    │                         │
│  3.3V ────────────┼────┼────┼────┼──── Alimentación I2C   │
│  GND ─────────────┼────┼────┼────┼──── Tierra             │
│                   │    │    │    │                         │
│  GPIO18 (BCK) ────┼────┼────┼────┼──── I2S Micrófono      │
│  GPIO19 (WS)  ────┼────┼────┼────┼──── I2S Micrófono      │
│  GPIO20 (SD)  ────┼────┼────┼────┼──── I2S Micrófono      │
│                   │    │    │    │                         │
│  GPIO12 (PWM) ────┼────┼────┼────┼──── Amplificador Left  │
│  GPIO13 (PWM) ────┼────┼────┼────┼──── Amplificador Right │
│                   │    │    │    │                         │
│  WiFi UDP ────────┼────┼────┼────┼──── Recibe de ESP32    │
│                   │    │    │    │                         │
└───────────────────┼────┼────┼────┼─────────────────────────┘
                    │    │    │    │
                    ▼    ▼    ▼    ▼
        ┌───────────┴─┐  │    │    │
        │OLED Display │  │    │    │
        │  (0x3C)     │  │    │    │
        │ 128x64 I2C  │  │    │    │
        │             │  │    │    │
        │ VCC ← 3.3V  │  │    │    │
        │ GND ← GND   │  │    │    │
        │ SDA ← GPIO2 │  │    │    │
        │ SCL ← GPIO3 │  │    │    │
        └─────────────┘  │    │    │
                         │    │    │
             ┌───────────┴─┐  │    │
             │  MPU6050    │  │    │
             │  (0x68)     │  │    │
             │             │  │    │
             │ VCC ← 3.3V  │  │    │
             │ GND ← GND   │  │    │
             │ SDA ← GPIO2 │  │    │
             │ SCL ← GPIO3 │  │    │
             └─────────────┘  │    │
                              │    │
                  ┌───────────┴─┐  │
                  │ ADS1115 #1  │  │
                  │  (0x48)     │  │
                  │             │  │
                  │ VCC ← 3.3V  │  │
                  │ GND ← GND   │  │
                  │ SDA ← GPIO2 │  │
                  │ SCL ← GPIO3 │  │
                  │             │  │
                  │ A0 ← Flex 1 │◄─┼── Pulgar (con resistencia 10kΩ)
                  │ A1 ← Flex 2 │◄─┼── Índice (con resistencia 10kΩ)
                  │ A2 ← Flex 3 │◄─┼── Medio (con resistencia 10kΩ)
                  │ A3 ← Flex 4 │◄─┼── Anular (con resistencia 10kΩ)
                  └─────────────┘  │
                                   │
                       ┌───────────┴─┐
                       │ ADS1115 #2  │
                       │  (0x49)     │
                       │             │
                       │ VCC ← 3.3V  │
                       │ GND ← GND   │
                       │ SDA ← GPIO2 │
                       │ SCL ← GPIO3 │
                       │             │
                       │ A0 ← Flex 5 │◄── Meñique (con resistencia 10kΩ)
                       └─────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Micrófono INMP441 (I2S)                  │
│                                                             │
│  INMP441                                                    │
│    VCC ← 3.3V                                              │
│    GND ← GND                                               │
│    WS  ← GPIO19                                            │
│    SCK ← GPIO18                                            │
│    SD  ← GPIO20                                            │
│    L/R ← GND (canal izquierdo)                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Amplificador PAM8403 + Bocina                  │
│                                                             │
│  PAM8403                                                    │
│    VCC ← 5V (del PowerBank)                                │
│    GND ← GND                                               │
│    IN-L ← GPIO12 (PWM)                                     │
│    IN-R ← GPIO13 (PWM)                                     │
│    OUT-L+ ──┐                                              │
│    OUT-L- ──┼──── Bocina 3W 4Ω (Left)                     │
│    OUT-R+ ──┤                                              │
│    OUT-R- ──┴──── Bocina 3W 4Ω (Right, opcional)          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Alimentación                             │
│                                                             │
│  PowerBank 5000mAh (5V USB)                                │
│       │                                                     │
│       ├──── Micro USB ──── Raspberry Pi (regulador 3.3V)   │
│       │                                                     │
│       └──── 5V directo ──── PAM8403 (amplificador)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📡 Comunicación WiFi UDP

```
┌─────────────────────┐              ┌─────────────────────┐
│  Guante Izquierdo   │              │  Guante Derecho     │
│      (ESP32)        │              │  (Raspberry Pi)     │
│                     │              │                     │
│  WiFi: "Tec"        │              │  WiFi: "Tec"        │
│  IP: 192.168.1.101  │              │  IP: 192.168.1.100  │
│                     │              │                     │
│  ┌───────────────┐  │              │  ┌───────────────┐  │
│  │ UDP Sender    │  │   Paquete    │  │ UDP Receiver  │  │
│  │ Puerto: 5000  │──┼─────────────>│  │ Puerto: 5000  │  │
│  └───────────────┘  │   JSON       │  └───────────────┘  │
│                     │              │                     │
│  Envía cada 50ms:   │              │  Recibe y procesa:  │
│  {                  │              │  - Datos mano izq   │
│    "hand": "left",  │              │  - Datos mano der   │
│    "flex": [...],   │              │  - Reconoce LSM     │
│    "accel": [...],  │              │  - Habla resultado  │
│    "gyro": [...]    │              │  - Muestra en OLED  │
│  }                  │              │                     │
└─────────────────────┘              └─────────────────────┘
```

---

## 🔧 Notas Importantes de Conexión

### **Direcciones I2C:**
- **0x3C:** OLED Display (solo en Raspberry Pi)
- **0x48:** ADS1115 #1 (en ambos guantes)
- **0x49:** ADS1115 #2 (en ambos guantes)
- **0x68:** MPU6050 (en ambos guantes)

### **Divisor de Voltaje para Flex Sensors:**
```
3.3V ──┬──[ Flex Sensor (variable) ]──┬── GND
       │                               │
       └──── ADS1115 Ax ────[ 10kΩ ]──┘

Voltaje medido = 3.3V × (10kΩ / (Flex + 10kΩ))
```

### **Alimentación:**
- **ESP32:** 5V USB → Regulador interno 3.3V
- **Raspberry Pi:** 5V USB → Regulador interno 3.3V
- **PAM8403:** 5V directo (no usar 3.3V)
- **Todos los sensores I2C:** 3.3V

### **WiFi:**
- **SSID:** "Tec"
- **Tipo:** WPA2 Enterprise
- **Usuario:** A01254425
- **Contraseña:** Ccm2006066871@
- **Protocolo:** UDP
- **Puerto:** 5000

### **Calibración Inicial:**
1. Mano abierta (dedos extendidos) → Valores bajos (~5000-10000)
2. Mano cerrada (puño) → Valores altos (~20000-30000)
3. Ajustar umbral `FLEX_THRESHOLD` en código según calibración

---

## 📦 Checklist de Conexiones

### **Guante Izquierdo (ESP32):**
- [ ] ESP32 alimentado por PowerBank
- [ ] I2C Bus: SDA=GPIO21, SCL=GPIO22
- [ ] MPU6050 conectado a I2C (0x68)
- [ ] ADS1115 #1 conectado a I2C (0x48)
- [ ] ADS1115 #2 conectado a I2C (0x49)
- [ ] 5 flex sensors con divisores de voltaje 10kΩ
- [ ] WiFi configurado y conectado

### **Guante Derecho (Raspberry Pi):**
- [ ] Raspberry Pi alimentado por PowerBank
- [ ] I2C Bus: SDA=GPIO2, SCL=GPIO3
- [ ] OLED Display conectado a I2C (0x3C)
- [ ] MPU6050 conectado a I2C (0x68)
- [ ] ADS1115 #1 conectado a I2C (0x48)
- [ ] ADS1115 #2 conectado a I2C (0x49)
- [ ] 5 flex sensors con divisores de voltaje 10kΩ
- [ ] Micrófono INMP441 conectado a I2S
- [ ] Amplificador PAM8403 conectado a PWM
- [ ] Bocina conectada a PAM8403
- [ ] WiFi configurado y conectado
- [ ] MicroSD con Raspberry Pi OS instalada

---

## 🚀 Orden de Encendido

1. **Encender PowerBank del Guante Derecho** (Raspberry Pi)
2. **Esperar 30-60 segundos** (boot de Raspberry Pi)
3. **Ejecutar script Python:** `python3 rpi_right_glove.py`
4. **Encender PowerBank del Guante Izquierdo** (ESP32)
5. **Verificar conexión WiFi** en ambos dispositivos
6. **Verificar recepción de datos** en Raspberry Pi
7. **Calibrar sensores** (mano abierta/cerrada)
8. **¡Listo para usar!** 🎉
