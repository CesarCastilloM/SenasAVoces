"""
Script Python para recibir comandos del ESP32 por WiFi UDP y hablar palabras
Requiere: pip install pywin32
"""

import socket
import win32com.client
import sys

# ============================================
# CONFIGURACIÓN
# ============================================
# python c:\Users\Cesar\CascadeProjects\norvi_rs485_soil_sensor\src\bluetooth_glove\pc_voice_receiver_wifi.py
UDP_IP = "0.0.0.0"  # Escuchar en todas las interfaces
UDP_PORT = 5000
# ============================================

def main():
    print("\n" + "="*50)
    print("  SISTEMA DE VOZ INALÁMBRICO WiFi")
    print("  GUANTE DE LENGUAJE DE SEÑAS")
    print("="*50 + "\n")
    
    # Inicializar motor de síntesis de voz con Windows SAPI
    print("🔊 Inicializando motor de voz Windows SAPI...")
    speaker = win32com.client.Dispatch("SAPI.SpVoice")
    
    # Configurar voz en español (Microsoft Sabina)
    voices = speaker.GetVoices()
    for i in range(voices.Count):
        voice = voices.Item(i)
        if 'sabina' in voice.GetDescription().lower() or 'spanish' in voice.GetDescription().lower():
            speaker.Voice = voice
            print(f"✓ Voz en español configurada: {voice.GetDescription()}")
            break
    else:
        print("⚠ Voz en español no encontrada, usando voz por defecto")
    
    # Configurar velocidad (rango: -10 a 10, default: 0)
    speaker.Rate = 0  # Velocidad normal
    
    # Crear socket UDP
    print(f"\n📡 Creando servidor UDP...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((UDP_IP, UDP_PORT))
        print(f"✓ Escuchando en puerto {UDP_PORT}")
        
        # Obtener IP local
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        print(f"✓ IP de esta PC: {local_ip}")
        print(f"\n⚠ IMPORTANTE: Configura esta IP en el ESP32:")
        print(f"   const char* PC_IP = \"{local_ip}\";")
        
    except Exception as e:
        print(f"✗ Error al crear socket: {e}")
        sys.exit(1)
    
    print("\n" + "─" * 50)
    print("✓ Sistema listo! Esperando señales del guante...")
    print("─" * 50 + "\n")
    
    # Recibir y procesar comandos
    try:
        while True:
            data, addr = sock.recvfrom(1024)  # Buffer de 1024 bytes
            mensaje = data.decode('utf-8', errors='ignore').strip()
            
            if mensaje:
                print(f"[WiFi {addr[0]}:{addr[1]}] {mensaje}")
                
                # Procesar comandos SPEAK:
                if mensaje.startswith("SPEAK:"):
                    palabra = mensaje.replace("SPEAK:", "").strip()
                    
                    print(f"\n🗣️  Hablando: '{palabra}'")
                    print("─" * 50)
                    
                    try:
                        # Hablar la palabra usando Windows SAPI
                        speaker.Speak(palabra)
                        
                        print("✓ Mensaje hablado correctamente")
                    except Exception as e:
                        print(f"✗ Error al hablar: {e}")
                        # Reiniciar motor de voz si falla
                        try:
                            speaker = win32com.client.Dispatch("SAPI.SpVoice")
                            speaker.Rate = 0
                        except:
                            pass
                    
                    print()
            
    except KeyboardInterrupt:
        print("\n\n✓ Programa detenido por el usuario")
    except Exception as e:
        print(f"\n✗ Error: {e}")
    finally:
        sock.close()
        print("✓ Socket cerrado")
        print("\n" + "="*50)
        print("  Programa finalizado")
        print("="*50 + "\n")

if __name__ == "__main__":
    main()
