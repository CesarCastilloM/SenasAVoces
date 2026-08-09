// ============================================================
//  GUANTE MANO DERECHA - Solo 5 Sensores Flex
//  ESP32  |  LSM Data Collector
//
//  PINES UTILIZADOS:
//  GPIO34 -> Flex Pulgar
//  GPIO35 -> Flex Indice
//  GPIO32 -> Flex Medio
//  GPIO33 -> Flex Anular
//  GPIO25 -> Flex Menique
//  GPIO0  -> Boton FLASH (grabar / detener)
//
//  CONEXION SENSOR FLEX (por cada dedo):
//  3.3V ---[Flex sensor]---+---[10k ohm a GND]
//                          |
//                        GPIO (entrada ADC)
//
//  USO:
//  1. Abrir monitor serial a 115200
//  2. Escribir:  sign:A   (la seña que quieres grabar)
//  3. Presionar botón FLASH -> empieza grabación
//  4. Presionar botón FLASH -> detiene y guarda
// ============================================================

#include <Arduino.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>

// ============================================================
//  PINES
// ============================================================
#define FLEX_THUMB   34   // Pulgar
#define FLEX_INDEX   35   // Indice
#define FLEX_MIDDLE  32   // Medio
#define FLEX_RING    33   // Anular
#define FLEX_PINKY   25   // Menique

#define BUTTON_PIN    0   // Boton FLASH integrado del ESP32

// ============================================================
//  CONFIGURACIÓN
// ============================================================
#define SAMPLE_RATE_HZ    50    // Muestras por segundo
#define MAX_SAMPLES       300   // Maximo de frames (6 segundos)
#define DEBOUNCE_MS       150   // Antirrebote del botón

// Umbrales ADC para normalización (ajustar después de calibrar)
#define FLEX_EXTENDIDO   1500   // Valor ADC dedo extendido  (0.0)
#define FLEX_FLEXIONADO  3000   // Valor ADC dedo flexionado (1.0)

// ============================================================
//  ESTADO
// ============================================================
bool     grabando          = false;
String   seña_actual       = "A";
int      muestras_guardadas = 0;

unsigned long ultimo_boton  = 0;
unsigned long ultimo_sample = 0;

// Buffer en RAM para la grabación
struct Frame {
    float pulgar, indice, medio, anular, menique;
    unsigned long ms;
};

Frame buffer[MAX_SAMPLES];
int   buffer_size = 0;

// ============================================================
//  PROTOTIPOS
// ============================================================
float   leerFlex(int pin);
void    leerFrame(Frame &f);
void    iniciarGrabacion();
void    detenerGrabacion();
void    guardarDatos();
void    mostrarEstado();
void    procesarSerial();

// ============================================================
//  SETUP
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(500);

    // Configurar pines
    pinMode(FLEX_THUMB,  INPUT);
    pinMode(FLEX_INDEX,  INPUT);
    pinMode(FLEX_MIDDLE, INPUT);
    pinMode(FLEX_RING,   INPUT);
    pinMode(FLEX_PINKY,  INPUT);
    pinMode(BUTTON_PIN,  INPUT_PULLUP);

    // Inicializar SPIFFS para guardar archivos
    if (!SPIFFS.begin(true)) {
        Serial.println("[ERROR] SPIFFS no se pudo iniciar");
    }

    Serial.println();
    Serial.println("============================================");
    Serial.println("   GUANTE LSM - MANO DERECHA");
    Serial.println("============================================");
    Serial.println("PINES:");
    Serial.println("  GPIO34 -> Flex Pulgar");
    Serial.println("  GPIO35 -> Flex Indice");
    Serial.println("  GPIO32 -> Flex Medio");
    Serial.println("  GPIO33 -> Flex Anular");
    Serial.println("  GPIO25 -> Flex Menique");
    Serial.println("  GPIO0  -> Boton FLASH (grabar)");
    Serial.println();
    Serial.println("COMANDOS:");
    Serial.println("  sign:<nombre>  -> Nombre de la seña a grabar");
    Serial.println("  status         -> Ver valores actuales en vivo");
    Serial.println("  list           -> Ver archivos guardados");
    Serial.println();
    Serial.printf("Seña actual: %s\n", seña_actual.c_str());
    Serial.println("Presione boton FLASH para grabar");
    Serial.println("============================================");
}

// ============================================================
//  LOOP
// ============================================================
void loop() {
    // Procesar comandos del monitor serial
    procesarSerial();

    // Manejar botón con antirrebote
    bool boton_presionado = (digitalRead(BUTTON_PIN) == LOW);
    if (boton_presionado && (millis() - ultimo_boton > DEBOUNCE_MS)) {
        ultimo_boton = millis();
        if (!grabando) {
            iniciarGrabacion();
        } else {
            detenerGrabacion();
        }
    }

    // Muestrear datos durante grabación
    if (grabando && (millis() - ultimo_sample >= (1000 / SAMPLE_RATE_HZ))) {
        ultimo_sample = millis();

        if (buffer_size < MAX_SAMPLES) {
            leerFrame(buffer[buffer_size]);
            buffer_size++;

            // Indicador de progreso cada 25 muestras (0.5 seg)
            if (buffer_size % 25 == 0) {
                Serial.printf("  [%d frames | %.1f seg]\n",
                              buffer_size, buffer_size / (float)SAMPLE_RATE_HZ);
            }
        } else {
            // Buffer lleno -> detener automáticamente
            Serial.println("[!] Buffer lleno, deteniendo grabacion...");
            detenerGrabacion();
        }
    }
}

// ============================================================
//  LECTURA DE SENSORES
// ============================================================
float leerFlex(int pin) {
    int raw = analogRead(pin);
    float norm = (float)(raw - FLEX_EXTENDIDO) / (float)(FLEX_FLEXIONADO - FLEX_EXTENDIDO);
    return constrain(norm, 0.0f, 1.0f);
}

void leerFrame(Frame &f) {
    f.pulgar  = leerFlex(FLEX_THUMB);
    f.indice  = leerFlex(FLEX_INDEX);
    f.medio   = leerFlex(FLEX_MIDDLE);
    f.anular  = leerFlex(FLEX_RING);
    f.menique = leerFlex(FLEX_PINKY);
    f.ms      = millis();
}

// ============================================================
//  CONTROL DE GRABACIÓN
// ============================================================
void iniciarGrabacion() {
    buffer_size = 0;
    grabando    = true;
    ultimo_sample = millis();

    Serial.println();
    Serial.println(">>> GRABANDO...");
    Serial.printf("    Seña: \"%s\"\n", seña_actual.c_str());
    Serial.println("    Presione boton para detener");
}

void detenerGrabacion() {
    grabando = false;

    Serial.println();
    if (buffer_size == 0) {
        Serial.println("[!] Sin datos, intente de nuevo");
        return;
    }

    Serial.printf(">>> Grabacion terminada: %d frames (%.2f seg)\n",
                  buffer_size, buffer_size / (float)SAMPLE_RATE_HZ);

    guardarDatos();
}

// ============================================================
//  GUARDAR EN SPIFFS
// ============================================================
void guardarDatos() {
    // Nombre de archivo: /sena_A_001.json
    muestras_guardadas++;
    String filename = "/sena_" + seña_actual + "_" +
                      String(muestras_guardadas, DEC) + ".json";

    File file = SPIFFS.open(filename, "w");
    if (!file) {
        Serial.printf("[ERROR] No se pudo abrir %s\n", filename.c_str());
        return;
    }

    // Construir JSON
    JsonDocument doc;
    doc["sign_name"]   = seña_actual;
    doc["num_frames"]  = buffer_size;
    doc["sample_rate"] = SAMPLE_RATE_HZ;
    doc["timestamp"]   = millis();

    JsonArray data = doc["data"].to<JsonArray>();
    for (int i = 0; i < buffer_size; i++) {
        JsonObject frame = data.add<JsonObject>();
        frame["ms"]      = buffer[i].ms;
        frame["pulgar"]  = serialized(String(buffer[i].pulgar,  4));
        frame["indice"]  = serialized(String(buffer[i].indice,  4));
        frame["medio"]   = serialized(String(buffer[i].medio,   4));
        frame["anular"]  = serialized(String(buffer[i].anular,  4));
        frame["menique"] = serialized(String(buffer[i].menique, 4));
    }

    String json_str;
    serializeJson(doc, json_str);
    file.print(json_str);
    file.close();

    Serial.printf(">>> Guardado: %s (%d bytes)\n", filename.c_str(), json_str.length());
    Serial.printf(">>> Total muestras de \"%s\": %d\n", seña_actual.c_str(), muestras_guardadas);
    Serial.println();
    Serial.println("Listo para la siguiente grabacion.");
    Serial.println("Presione boton FLASH para grabar.");
}

// ============================================================
//  COMANDOS SERIAL
// ============================================================
void procesarSerial() {
    if (!Serial.available()) return;

    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toLowerCase();

    // sign:<nombre>
    if (cmd.startsWith("sign:")) {
        seña_actual       = cmd.substring(5);
        muestras_guardadas = 0;
        Serial.printf(">>> Seña establecida: \"%s\"\n", seña_actual.c_str());
        Serial.println("    Presione boton FLASH para grabar");

    // status -> muestra valores en vivo cada 200ms por 5 segundos
    } else if (cmd == "status") {
        Serial.println(">>> Valores en vivo (5 seg):");
        Serial.println("    Dedo     | Raw ADC | Normalizado");
        Serial.println("    ---------|---------|------------");
        unsigned long t_ini = millis();
        while (millis() - t_ini < 5000) {
            int r_thumb  = analogRead(FLEX_THUMB);
            int r_index  = analogRead(FLEX_INDEX);
            int r_middle = analogRead(FLEX_MIDDLE);
            int r_ring   = analogRead(FLEX_RING);
            int r_pinky  = analogRead(FLEX_PINKY);

            Serial.printf(
                "    Pulgar   | %4d    | %.2f\n"
                "    Indice   | %4d    | %.2f\n"
                "    Medio    | %4d    | %.2f\n"
                "    Anular   | %4d    | %.2f\n"
                "    Menique  | %4d    | %.2f\n"
                "    ----\n",
                r_thumb,  leerFlex(FLEX_THUMB),
                r_index,  leerFlex(FLEX_INDEX),
                r_middle, leerFlex(FLEX_MIDDLE),
                r_ring,   leerFlex(FLEX_RING),
                r_pinky,  leerFlex(FLEX_PINKY)
            );
            delay(500);
        }

    // list -> archivos guardados
    } else if (cmd == "list") {
        Serial.println(">>> Archivos en SPIFFS:");
        File root = SPIFFS.open("/");
        File f = root.openNextFile();
        int n = 0;
        while (f) {
            Serial.printf("    %s  (%d bytes)\n", f.name(), f.size());
            f = root.openNextFile();
            n++;
        }
        if (n == 0) Serial.println("    (sin archivos)");

    } else if (cmd != "") {
        Serial.println("[?] Comandos disponibles: sign:<nombre>  status  list");
    }
}
