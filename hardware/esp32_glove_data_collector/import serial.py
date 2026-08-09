import serial
import win32com.client
import ast
import time

# ------------------ Voz ------------------

speaker = win32com.client.Dispatch("SAPI.SpVoice")

def hablar(texto):
    speaker.Speak(texto)

# ------------------ Puerto Serial ------------------

esp32 = serial.Serial("COM3", 115200)

# Esperar a que el ESP32 termine de reiniciarse
time.sleep(2)

# Borrar mensajes de inicio y calibración
esp32.reset_input_buffer()

# ------------------ Variables ------------------

decir = True

# Estado de cada sensor (True o False)
sensores = [False] * 7

# Valores esperados
yo = [3245, 3261, 3107, 3141, 3019, 0.0, 0.0]

#mio= [4095, 4095, 4095, 4095, 3800, 0, 0]
#suyo = [4095, 4095, 4095, 3270, 3200, 0, 0]

# Márgenes permitidos
margenes = [100, 100, 100, 100, 100, 5, 7]


# ------------------ Funciones ------------------

def seña(indice, valor_sensor):
 
    inf = yo[indice] - margenes[indice]
    sup = yo[indice] + margenes[indice]

    return inf <= valor_sensor <= sup


def seña_correcta():

    global decir

    if all(sensores):

        if decir:
            hablar("yo")
            decir = False

    else:
        decir = True

# ------------------ Programa Principal ------------------

while True:

    monitor_ser = esp32.readline().decode(
        "utf-8",
        errors="ignore"
    ).strip()

    if not monitor_ser.startswith("["):
        continue

    try:

        lista = ast.literal_eval(monitor_ser)

        for i in range(7):
            sensores[i] = seña(i, lista[i])

        print(lista)
        print(sensores)

        seña_correcta()

    except Exception as e:
        print("Error:", e)