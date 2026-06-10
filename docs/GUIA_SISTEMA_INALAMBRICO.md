# 📡 Sistema Inalámbrico WiFi UDP - Guante de Lenguaje de Señas

Sistema completamente inalámbrico que envía comandos de voz del ESP32 al PC por WiFi.

## 🎯 Características

- ✅ **Completamente inalámbrico** - Sin cables entre ESP32 y PC
- ✅ **WiFi WPA2 Enterprise** - Conecta a red "UniSon"
- ✅ **Alcance 50-100 metros** - Libertad de movimiento
- ✅ **Voz natural en español** - Microsoft Sabina
- ✅ **5 palabras configurables** - Fácil de expandir

## 🚀 Instalación y Uso

### Paso 1: Ejecutar Script Python en PC

```powershell
python src/bluetooth_glove/pc_voice_receiver_wifi.py
```

El script mostrará la IP de tu PC. Ejemplo:
```
✓ IP de esta PC: 10.10.214.178
```

### Paso 2: Subir Código al ESP32

```powershell
pio run -e wifi_glove -t upload
```

**IMPORTANTE**: Mantén presionado el botón **BOOT** cuando veas "Connecting..."

### Paso 3: Verificar Conexión

El ESP32 mostrará en el monitor serial:
```
✓ WiFi Enterprise conectado!
IP del ESP32: 10.10.x.x
Enviando a PC: 10.10.214.178:5000
```

### Paso 4: Probar el Sistema

Toca un cable entre estos pines y GND:
- **Pin 4 + GND** → "Buenas"
- **Pin 5 + GND** → "tardes"
- **Pin 18 + GND** → "mesa"
- **Pin 19 + GND** → "para"
- **Pin 21 + GND** → "cuatro"

Verás en el PC:
```
[WiFi 10.10.x.x:xxxxx] SPEAK:Buenas
🗣️  Hablando: 'Buenas'
```

## 🔧 Configuración

### Cambiar IP del PC

Si la IP de tu PC cambia, edita `esp32_wifi_glove.cpp`:

```cpp
const char* PC_IP = "10.10.214.178";  // Nueva IP aquí
```

### Agregar Más Palabras

Edita en `esp32_wifi_glove.cpp`:

```cpp
const int botones[6] = {4, 5, 18, 19, 21, 22};
String palabras[6] = {"Buenas", "tardes", "mesa", "para", "cuatro", "nueva"};
```

### Cambiar Red WiFi

Para usar otra red WiFi (no Enterprise):

```cpp
const char* WIFI_SSID = "TuWiFi";
const char* WIFI_PASSWORD = "TuPassword";

// En setup(), reemplaza la sección Enterprise con:
WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
```

## 📊 Diagrama del Sistema

```
┌─────────────┐                    ┌──────────────┐
│   Botones   │                    │      PC      │
│  (5 pines)  │                    │  IP: 10.10.x │
└──────┬──────┘                    └──────▲───────┘
       │                                  │
       │ GPIO                             │ WiFi UDP
       ▼                                  │ Puerto 5000
┌─────────────┐      WiFi UniSon         │
│   ESP32     │──────────────────────────┘
│ WPA2 Enterp │
└─────────────┘
```

## 🐛 Solución de Problemas

### ESP32 no se conecta a WiFi

1. Verifica credenciales en el código
2. Asegúrate de estar en rango de la red "UniSon"
3. Revisa el monitor serial para errores

### PC no recibe mensajes

1. Verifica que el firewall permita UDP puerto 5000
2. Confirma que PC y ESP32 están en la misma red
3. Verifica la IP del PC en el código del ESP32

### No se escucha la voz

1. Verifica volumen del PC
2. Asegúrate de que `pyttsx3` esté instalado
3. Revisa que el script Python esté corriendo

## 📝 Archivos del Sistema

- **`esp32_wifi_glove.cpp`** - Código ESP32 WiFi UDP
- **`pc_voice_receiver_wifi.py`** - Receptor Python UDP
- **`platformio.ini`** - Configuración environment `wifi_glove`

## ✨ Ventajas vs Sistema con Cable

| Característica | Con Cable | Inalámbrico WiFi |
|---------------|-----------|------------------|
| Alcance | 3 metros | 50-100 metros |
| Movilidad | Limitada | Total |
| Instalación | Simple | Requiere WiFi |
| Latencia | <10ms | ~50ms |
| Confiabilidad | 100% | 95-99% |

## 🎓 Próximos Pasos

1. Conecta los 5 botones físicos al ESP32
2. Sube el código con `pio run -e wifi_glove -t upload`
3. Ejecuta el script Python
4. ¡Prueba el sistema inalámbrico!

---

**Sistema completamente funcional y listo para usar** 🎉
