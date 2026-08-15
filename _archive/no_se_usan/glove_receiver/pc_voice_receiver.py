
"""
Script Python para recibir comandos del ESP32 y hablar palabras
Requiere: pip install pyserial pyttsx3
"""

import serial
import pyttsx3
import time
import sys

# ============================================
# CONFIGURACIÓN
# ============================================
SERIAL_PORT = 'COM3'  # Cambia si tu ESP32 está en otro puerto
BAUD_RATE = 115200
# ============================================

def main():
    print("\n" + "="*50)
    print("  SISTEMA DE VOZ PARA GUANTE DE LENGUAJE DE SEÑAS")
    print("="*50 + "\n")
    
    # Inicializar motor de síntesis de voz
    print("🔊 Inicializando motor de voz...")
    engine = pyttsx3.init()
    
    # Configurar voz en español (si está disponible)
    voices = engine.getProperty('voices')
    for voice in voices:
        if 'spanish' in voice.name.lower() or 'español' in voice.name.lower():
            engine.setProperty('voice', voice.id)
            print(f"✓ Voz en español configurada: {voice.name}")
            break
    else:
        print("⚠ Voz en español no encontrada, usando voz por defecto")
    
    # Configurar velocidad y volumen
    engine.setProperty('rate', 150)    # Velocidad (palabras por minuto)
    engine.setProperty('volume', 1.0)  # Volumen (0.0 a 1.0)
    
    # Conectar al puerto serial
    print(f"\n📡 Conectando a {SERIAL_PORT} @ {BAUD_RATE} baud...")
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)  # Esperar a que se estabilice la conexión
        print("✓ Conexión serial establecida\n")
    except serial.SerialException as e:
        print(f"✗ Error al conectar: {e}")
        print(f"\nVerifica que:")
        print(f"  1. El ESP32 esté conectado al puerto {SERIAL_PORT}")
        print(f"  2. No haya otro programa usando el puerto")
        print(f"  3. El puerto sea el correcto (usa 'pio device list' para verificar)")
        sys.exit(1)
    
    print("─" * 50)
    print("✓ Sistema listo! Esperando señales del guante...")
    print("─" * 50 + "\n")
    
    # Leer y procesar comandos
    try:
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                # Mostrar todas las líneas para debug
                if line:
                    print(f"[Serial] {line}")
                
                # Procesar comandos SPEAK:
                if line.startswith("SPEAK:"):
                    palabra = line.replace("SPEAK:", "").strip()
                    
                    print(f"\n🗣️  Hablando: '{palabra}'")
                    print("─" * 50)
                    
                    # Hablar la palabra
                    engine.say(palabra)
                    engine.runAndWait()
                    
                    print()
            
            time.sleep(0.01)  # Pequeña pausa para no saturar CPU
            
    except KeyboardInterrupt:
        print("\n\n✓ Programa detenido por el usuario")
    except Exception as e:
        print(f"\n✗ Error: {e}")
    finally:
        ser.close()
        print("✓ Puerto serial cerrado")
        print("\n" + "="*50)
        print("  Programa finalizado")
        print("="*50 + "\n")

if __name__ == "__main__":
    main()
