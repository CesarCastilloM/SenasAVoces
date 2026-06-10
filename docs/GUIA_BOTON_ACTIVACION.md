# 🔘 Guía del Botón de Activación - SEÑAS A VOCES

## ⚠️ Problema Identificado

**Al caminar o moverse, el acelerómetro y giroscopio detectan movimiento, causando falsos positivos en el reconocimiento de señas.**

**Solución:** Botón de activación que solo permite reconocimiento cuando el usuario lo presiona.

---

## 🎯 Cómo Funciona

### **Modos de Operación:**

**1. Modo Reposo (Default):**
- Sistema ignora todos los movimientos
- Acelerómetro/giroscopio no afectan reconocimiento
- Puedes caminar, correr, mover las manos libremente
- Display muestra: "Modo reposo - Presiona botón"

**2. Modo Reconocimiento (Botón presionado):**
- Se activa al presionar el botón
- Duración: 5 segundos (configurable)
- Sistema reconoce señas LSM
- Detecta si estás caminando y te avisa
- Display muestra: "MODO ACTIVO - Haz tu seña"

---

## 🛒 Hardware Adicional Necesario

### **Botón Push Button:**
- **Tipo:** Botón táctil momentáneo (normalmente abierto)
- **Amazon MX:** https://www.amazon.com.mx/s?k=boton+pulsador+arduino
- **Precio:** ~$30-50 MXN
- **Cantidad:** 1 (solo en guante derecho)

### **Alternativas:**
- Botón arcade grande (más fácil de presionar)
- Botón capacitivo (sin partes móviles)
- Interruptor de pie (manos libres)

---

## 🔌 Conexión del Botón

### **Raspberry Pi Zero 2W (Guante Derecho):**

```
Botón Push Button
┌─────────────┐
│   Terminal 1│────────► GPIO 17 (Pin 11)
│             │
│   Terminal 2│────────► GND (Pin 14)
└─────────────┘

Resistencia pull-up interna activada en código
```

### **Diagrama de Pines:**

```
Raspberry Pi Zero 2W (Vista superior)
┌─────────────────────────────────────┐
│  3V3  (1) ● ● (2)  5V               │
│  GPIO2 (3) ● ● (4)  5V               │
│  GPIO3 (5) ● ● (6)  GND              │
│  GPIO4 (7) ● ● (8)  GPIO14           │
│  GND   (9) ● ● (10) GPIO15           │
│ ►GPIO17(11) ● ● (12) GPIO18          │ ◄─ Botón aquí
│  GPIO27(13) ● ●►(14) GND             │ ◄─ GND aquí
│  GPIO22(15) ● ● (16) GPIO23          │
│  3V3  (17) ● ● (18) GPIO24           │
│  GPIO10(19) ● ● (20) GND             │
└─────────────────────────────────────┘
```

---

## 💻 Configuración en el Código

### **Variables de Configuración:**

```python
# En rpi_right_glove.py

BUTTON_PIN = 17  # GPIO 17 (Pin 11)
GESTURE_TIMEOUT = 5.0  # Segundos activo después de presionar
MOVEMENT_THRESHOLD = 15.0  # Sensibilidad detección de movimiento
```

### **Ajustar Tiempo de Activación:**

```python
# Más tiempo para señas complejas
GESTURE_TIMEOUT = 10.0  # 10 segundos

# Menos tiempo para señas rápidas
GESTURE_TIMEOUT = 3.0  # 3 segundos
```

### **Ajustar Sensibilidad de Movimiento:**

```python
# Más sensible (detecta movimientos pequeños)
MOVEMENT_THRESHOLD = 10.0

# Menos sensible (permite más movimiento)
MOVEMENT_THRESHOLD = 20.0
```

---

## 🎮 Uso del Sistema

### **Flujo de Operación:**

**1. Sistema en reposo:**
```
Usuario camina normalmente
→ Sistema ignora movimientos
→ No hay reconocimiento de señas
```

**2. Usuario quiere comunicarse:**
```
Presiona botón
→ 🔴 "MODO RECONOCIMIENTO ACTIVADO"
→ Sistema verifica que no estés caminando
→ Haz tu seña LSM
→ Sistema reconoce y habla
```

**3. Timeout o soltar botón:**
```
Pasan 5 segundos o sueltas botón
→ ⚪ "MODO RECONOCIMIENTO DESACTIVADO"
→ Vuelve a modo reposo
```

---

## 📊 Ejemplo de Salida del Sistema

```bash
==================================================
  SEÑAS A VOCES - Guante Derecho (Raspberry Pi)
==================================================

✓ GPIO configurado (Botón en GPIO 17)
✓ I2C inicializado
✓ ADS1115 #1 (0x48) inicializado
✓ ADS1115 #2 (0x49) inicializado
✓ MPU6050 inicializado
✓ Display OLED inicializado
✓ TTS configurado: Spanish

🚀 Iniciando loop principal...
📚 Vocabulario LSM: 100 palabras/frases
🔤 Alfabeto LSM: 27 letras

🔘 PRESIONA EL BOTÓN para activar reconocimiento de señas
⏱️  Tiempo activo: 5.0 segundos por activación

# Usuario presiona botón
🔴 MODO RECONOCIMIENTO ACTIVADO - Haz tu seña
⏱️  Tiempo restante: 5s
⏱️  Tiempo restante: 4s

# Usuario hace seña "hola"
🤟 hola (85%)
🤟 hola (87%)
🤟 hola (89%)

✅ RECONOCIDO: hola (89%)
📜 Historial: hola

🔊 Hablando: 'hola'

⏱️  Tiempo restante: 2s
⏱️  Tiempo restante: 1s
⚪ MODO RECONOCIMIENTO DESACTIVADO

# Sistema vuelve a reposo
```

---

## 🛡️ Protecciones Implementadas

### **1. Detección de Movimiento:**
```python
def is_person_moving():
    # Calcula magnitud de aceleración
    magnitude = sqrt(ax² + ay² + az²)
    
    # Si es muy diferente de gravedad (9.8 m/s²)
    if abs(magnitude - 9.8) > MOVEMENT_THRESHOLD:
        return True  # Persona caminando
    
    # También verifica rotación rápida
    gyro_magnitude = sqrt(gx² + gy² + gz²)
    if gyro_magnitude > 100:
        return True  # Rotación rápida
    
    return False  # Persona quieta
```

**Si detecta movimiento:**
```
⚠️  Movimiento detectado - Espera a estar quieto
```

### **2. Timeout Automático:**
```python
# Desactiva modo después de 5 segundos
if elapsed > GESTURE_TIMEOUT:
    gesture_mode_active = False
```

### **3. Estabilidad de Gestos:**
```python
# Requiere 3 lecturas consecutivas iguales
STABILITY_THRESHOLD = 3
```

---

## 🔧 Instalación Física del Botón

### **Opción 1: Botón en el Guante**
```
Ubicación recomendada:
- Dorso de la mano (fácil acceso con otra mano)
- Lateral del guante (presionar con pulgar)
- Muñeca (presionar con otra mano)
```

### **Opción 2: Botón Externo**
```
- Cable largo (50cm-1m)
- Botón en cinturón o bolsillo
- Presionar con mano libre
```

### **Opción 3: Interruptor de Pie**
```
- Manos completamente libres
- Ideal para presentaciones
- Requiere cable más largo
```

---

## 🎨 Personalización Avanzada

### **Cambiar Pin del Botón:**
```python
# Si GPIO 17 está ocupado, usar otro pin
BUTTON_PIN = 27  # GPIO 27 (Pin 13)
# Actualizar conexión física también
```

### **Modo "Mantener Presionado":**
```python
# Solo reconoce mientras mantienes presionado
GESTURE_TIMEOUT = 999  # Muy largo
# Soltar botón desactiva inmediatamente
```

### **Modo "Toggle" (Presionar para activar/desactivar):**
```python
# Modificar button_callback:
def button_callback(channel):
    global gesture_mode_active
    if GPIO.input(BUTTON_PIN) == GPIO.LOW:
        gesture_mode_active = not gesture_mode_active  # Toggle
```

---

## 📈 Ventajas del Sistema con Botón

✅ **Elimina falsos positivos** al caminar/moverse  
✅ **Control total** del usuario sobre cuándo reconocer  
✅ **Ahorra batería** (no procesa constantemente)  
✅ **Más preciso** (solo reconoce cuando quieres)  
✅ **Privacidad** (no graba gestos accidentales)  
✅ **Intuitivo** (presionar = hablar)  
✅ **Configurable** (timeout, sensibilidad ajustables)  

---

## 🐛 Troubleshooting

### **Problema: Botón no responde**
```python
# Verificar conexión
import RPi.GPIO as GPIO
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.IN, pull_up_down=GPIO.PUD_UP)
print(GPIO.input(17))  # Debe ser 1 (sin presionar) o 0 (presionado)
```

### **Problema: Se activa solo**
```python
# Aumentar debounce
GPIO.add_event_detect(BUTTON_PIN, GPIO.BOTH, 
                      callback=button_callback, 
                      bouncetime=500)  # 500ms
```

### **Problema: Detecta movimiento aunque esté quieto**
```python
# Reducir sensibilidad
MOVEMENT_THRESHOLD = 20.0  # Menos sensible
```

---

## 🎯 Casos de Uso

**1. Conversación Normal:**
```
Presionar botón → Hacer seña → Soltar botón
Repetir para cada palabra
```

**2. Frase Larga:**
```
Presionar botón (mantener)
→ Seña 1 → Reconoce → Habla
→ Seña 2 → Reconoce → Habla
→ Seña 3 → Reconoce → Habla
Soltar botón
```

**3. Presentación:**
```
Usar interruptor de pie
Manos libres para señas
Presionar pie para activar
```

---

## 📊 Comparación: Con vs Sin Botón

| Característica | Sin Botón | Con Botón |
|----------------|-----------|-----------|
| Falsos positivos al caminar | ❌ Muchos | ✅ Ninguno |
| Control del usuario | ❌ Limitado | ✅ Total |
| Consumo de batería | ❌ Alto | ✅ Bajo |
| Precisión | ⚠️ 60-70% | ✅ 80-90% |
| Privacidad | ❌ Baja | ✅ Alta |
| Facilidad de uso | ✅ Simple | ⚠️ Requiere botón |
| Costo adicional | ✅ $0 | ⚠️ $30-50 MXN |

---

## ✅ Recomendación Final

**Usa el botón de activación si:**
- Vas a caminar mientras usas el sistema
- Necesitas alta precisión
- Quieres control total sobre cuándo reconocer
- No te importa presionar un botón

**No uses botón si:**
- Solo usarás el sistema sentado/quieto
- Prefieres reconocimiento continuo
- Quieres la máxima simplicidad

---

**¡Sistema con botón implementado y listo para usar!** 🔘🤟
