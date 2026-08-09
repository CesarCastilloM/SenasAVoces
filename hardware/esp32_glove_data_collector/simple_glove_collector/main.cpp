#include <Arduino.h>
#include <BMI160Gen.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>

// ===== PINES ESP32 =====
// Botón de grabación
#define BUTTON_PIN 0

// Sensores Flex Mano Izquierda
#define FLEX_THUMB_LEFT   34
#define FLEX_INDEX_LEFT   35
#define FLEX_MIDDLE_LEFT  32
#define FLEX_RING_LEFT    33
#define FLEX_PINKY_LEFT   25

// Sensores Flex Mano Derecha  
#define FLEX_THUMB_RIGHT  26
#define FLEX_INDEX_RIGHT  27
#define FLEX_MIDDLE_RIGHT 14
#define FLEX_RING_RIGHT   12
#define FLEX_PINKY_RIGHT  13

// BMI160
#define BMI160_INT_LEFT   4
#define BMI160_INT_RIGHT  16

// ===== CONFIGURACIÓN =====
#define SAMPLE_RATE_HZ    50
#define STATIC_SAMPLES    15
#define DYNAMIC_SAMPLES   30
#define BUTTON_DEBOUNCE_MS 50

// ===== VARIABLES GLOBALES =====
BMI160Gen bmi160_left;
BMI160Gen bmi160_right;

bool left_connected = false;
bool right_connected = false;
bool capturing = false;
bool is_dynamic = false;
unsigned long last_sample_time = 0;
unsigned long last_button_press = 0;

String current_sign = "A";
int sample_count = 0;

// Buffers para datos
struct SensorData {
    float accel_x, accel_y, accel_z;
    float gyro_x, gyro_y, gyro_z;
    float flex_thumb, flex_index, flex_middle, flex_ring, flex_pinky;
    unsigned long timestamp;
};

std::vector<SensorData> capture_buffer;

// ===== FUNCIONES =====

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("========================================");
    Serial.println("COLECTOR SIMPLE DE GUANTES LSM");
    Serial.println("========================================");
    
    // Configurar botón
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    
    // Configurar pines de sensores flex
    pinMode(FLEX_THUMB_LEFT, INPUT);
    pinMode(FLEX_INDEX_LEFT, INPUT);
    pinMode(FLEX_MIDDLE_LEFT, INPUT);
    pinMode(FLEX_RING_LEFT, INPUT);
    pinMode(FLEX_PINKY_LEFT, INPUT);
    
    pinMode(FLEX_THUMB_RIGHT, INPUT);
    pinMode(FLEX_INDEX_RIGHT, INPUT);
    pinMode(FLEX_MIDDLE_RIGHT, INPUT);
    pinMode(FLEX_RING_RIGHT, INPUT);
    pinMode(FLEX_PINKY_RIGHT, INPUT);
    
    // Inicializar SPIFFS
    if (!SPIFFS.begin(true)) {
        Serial.println("Error: SPIFFS no se pudo iniciar");
    } else {
        Serial.println("SPIFFS iniciado");
    }
    
    // Inicializar BMI160 mano izquierda
    if (bmi160_left.begin(BMI160Gen::BMI160_I2C_ADDR, BMI160_INT_LEFT)) {
        bmi160_left.setGyroRate(BMI160_GYRO_RATE_100HZ);
        bmi160_left.setAccelerometerRate(BMI160_ACCEL_RATE_100HZ);
        bmi160_left.setGyroRange(BMI160_GYRO_RANGE_500);
        bmi160_left.setAccelerometerRange(BMI160_ACCEL_RANGE_2G);
        left_connected = true;
        Serial.println("✅ BMI160 izquierdo conectado");
    } else {
        Serial.println("❌ BMI160 izquierdo no encontrado");
    }
    
    // Inicializar BMI160 mano derecha
    if (bmi160_right.begin(BMI160Gen::BMI160_I2C_ADDR, BMI160_INT_RIGHT)) {
        bmi160_right.setGyroRate(BMI160_GYRO_RATE_100HZ);
        bmi160_right.setAccelerometerRate(BMI160_ACCEL_RATE_100HZ);
        bmi160_right.setGyroRange(BMI160_GYRO_RANGE_500);
        bmi160_right.setAccelerometerRange(BMI160_ACCEL_RANGE_2G);
        right_connected = true;
        Serial.println("✅ BMI160 derecho conectado");
    } else {
        Serial.println("❌ BMI160 derecho no encontrado");
    }
    
    // Reservar memoria para buffer
    capture_buffer.reserve(DYNAMIC_SAMPLES);
    
    Serial.println("\n📋 PINES UTILIZADOS:");
    Serial.println("🔘 Botón: GPIO0 (botón FLASH del ESP32)");
    Serial.println("🤚 Mano Izquierda - Flex: GPIO34,35,32,33,25");
    Serial.println("🤚 Mano Derecha - Flex: GPIO26,27,14,12,13");
    Serial.println("🔄 BMI160 Izquierdo - INT: GPIO4");
    Serial.println("🔄 BMI160 Derecho - INT: GPIO16");
    Serial.println("📡 I2C: SDA=GPIO21, SCL=GPIO22");
    Serial.println("⚡ Alimentación: 5V para flex, 3.3V para BMI160");
    
    Serial.println("\n🎮 CÓMO USAR:");
    Serial.println("1. Escriba el nombre de la seña: sign:<nombre>");
    Serial.println("2. Presione el botón FLASH para grabar");
    Serial.println("3. Suelte el botón cuando termine la seña");
    Serial.println("4. Los datos se guardan automáticamente");
    
    Serial.println("\n✨ Listo para capturar datos!");
    Serial.println("========================================\n");
}

void loop() {
    // Procesar comandos serial
    processSerialCommands();
    
    // Revisar botón de grabación
    handleButton();
    
    // Muestrear datos si está capturando
    if (capturing) {
        sampleData();
    }
    
    delay(10);
}

void processSerialCommands() {
    if (Serial.available()) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        
        if (command.startsWith("sign:")) {
            current_sign = command.substring(5);
            Serial.printf("✅ Seña establecida: %s\n", current_sign.c_str());
            
        } else if (command == "status") {
            printStatus();
            
        } else if (command == "list") {
            listSavedFiles();
            
        } else if (command == "help") {
            Serial.println("Comandos:");
            Serial.println("  sign:<nombre> - Establecer nombre de seña");
            Serial.println("  status       - Mostrar estado");
            Serial.println("  list         - Listar archivos guardados");
            Serial.println("  help         - Ayuda");
            Serial.println("\nBotón FLASH (GPIO0) para grabar");
            
        } else if (command != "") {
            Serial.println("❌ Comando no reconocido. Escriba 'help'");
        }
    }
}

void handleButton() {
    bool button_pressed = (digitalRead(BUTTON_PIN) == LOW);
    
    if (button_pressed && (millis() - last_button_press > BUTTON_DEBOUNCE_MS)) {
        last_button_press = millis();
        
        if (!capturing) {
            // Iniciar captura
            startCapture();
        } else {
            // Detener captura
            stopCapture();
        }
    }
}

void startCapture() {
    capture_buffer.clear();
    capturing = true;
    is_dynamic = true; // Por defecto dinámico, se puede ajustar
    last_sample_time = millis();
    
    Serial.println("\n🎬 INICIANDO CAPTURA...");
    Serial.printf("📝 Seña: %s\n", current_sign.c_str());
    Serial.println("⏳ Suelte el botón cuando termine la seña");
    Serial.println("📊 Capturando datos...\n");
}

void stopCapture() {
    capturing = false;
    
    if (capture_buffer.size() > 0) {
        saveData();
        Serial.printf("✅ Captura completada: %d muestras guardadas\n", capture_buffer.size());
    } else {
        Serial.println("❌ No se capturaron datos");
    }
    
    Serial.println("\n🎯 Listo para la siguiente captura");
    Serial.printf("📝 Seña actual: %s\n", current_sign.c_str());
    Serial.println("🔘 Presione botón FLASH para grabar\n");
}

void sampleData() {
    if (millis() - last_sample_time >= (1000 / SAMPLE_RATE_HZ)) {
        last_sample_time = millis();
        
        SensorData data;
        data.timestamp = millis();
        
        // Leer mano izquierda si está conectada
        if (left_connected) {
            int ax, ay, az, gx, gy, gz;
            if (bmi160_left.readMotionSensor(ax, ay, az, gx, gy, gz)) {
                data.accel_x = ax * 2.0f / 32768.0f;
                data.accel_y = ay * 2.0f / 32768.0f;
                data.accel_z = az * 2.0f / 32768.0f;
                data.gyro_x = gx * 500.0f / 32768.0f;
                data.gyro_y = gy * 500.0f / 32768.0f;
                data.gyro_z = gz * 500.0f / 32768.0f;
            }
        }
        
        // Leer sensores flex mano izquierda
        data.flex_thumb = normalizeFlex(analogRead(FLEX_THUMB_LEFT));
        data.flex_index = normalizeFlex(analogRead(FLEX_INDEX_LEFT));
        data.flex_middle = normalizeFlex(analogRead(FLEX_MIDDLE_LEFT));
        data.flex_ring = normalizeFlex(analogRead(FLEX_RING_LEFT));
        data.flex_pinky = normalizeFlex(analogRead(FLEX_PINKY_LEFT));
        
        // Si no hay mano izquierda, intentar con la derecha
        if (!left_connected && right_connected) {
            int ax, ay, az, gx, gy, gz;
            if (bmi160_right.readMotionSensor(ax, ay, az, gx, gy, gz)) {
                data.accel_x = ax * 2.0f / 32768.0f;
                data.accel_y = ay * 2.0f / 32768.0f;
                data.accel_z = az * 2.0f / 32768.0f;
                data.gyro_x = gx * 500.0f / 32768.0f;
                data.gyro_y = gy * 500.0f / 32768.0f;
                data.gyro_z = gz * 500.0f / 32768.0f;
            }
            
            // Leer sensores flex mano derecha
            data.flex_thumb = normalizeFlex(analogRead(FLEX_THUMB_RIGHT));
            data.flex_index = normalizeFlex(analogRead(FLEX_INDEX_RIGHT));
            data.flex_middle = normalizeFlex(analogRead(FLEX_MIDDLE_RIGHT));
            data.flex_ring = normalizeFlex(analogRead(FLEX_RING_RIGHT));
            data.flex_pinky = normalizeFlex(analogRead(FLEX_PINKY_RIGHT));
        }
        
        capture_buffer.push_back(data);
        
        // Indicador de progreso
        if (capture_buffer.size() % 10 == 0) {
            Serial.printf(".");
        }
    }
}

float normalizeFlex(int raw_value) {
    // Normalización simple: 2000 = extendido (0.0), 4000 = flexionado (1.0)
    float normalized = (raw_value - 2000.0f) / 2000.0f;
    return constrain(normalized, 0.0f, 1.0f);
}

void saveData() {
    JsonDocument doc;
    
    doc["sign_name"] = current_sign;
    doc["mode"] = is_dynamic ? "dynamic" : "static";
    doc["timestamp"] = millis();
    doc["sample_count"] = capture_buffer.size();
    doc["sample_rate"] = SAMPLE_RATE_HZ;
    
    JsonArray data_array = doc["data"].to<JsonArray>();
    
    for (const auto& sample : capture_buffer) {
        JsonObject sample_obj = data_array.add<JsonObject>();
        sample_obj["timestamp"] = sample.timestamp;
        sample_obj["accel_x"] = sample.accel_x;
        sample_obj["accel_y"] = sample.accel_y;
        sample_obj["accel_z"] = sample.accel_z;
        sample_obj["gyro_x"] = sample.gyro_x;
        sample_obj["gyro_y"] = sample.gyro_y;
        sample_obj["gyro_z"] = sample.gyro_z;
        sample_obj["flex_thumb"] = sample.flex_thumb;
        sample_obj["flex_index"] = sample.flex_index;
        sample_obj["flex_middle"] = sample.flex_middle;
        sample_obj["flex_ring"] = sample.flex_ring;
        sample_obj["flex_pinky"] = sample.flex_pinky;
    }
    
    // Metadata
    doc["metadata"]["left_connected"] = left_connected;
    doc["metadata"]["right_connected"] = right_connected;
    doc["metadata"]["device_id"] = "esp32_glove_v1";
    
    // Generar nombre de archivo
    String filename = "/sign_" + current_sign + "_" + String(millis()) + ".json";
    
    // Guardar en SPIFFS
    File file = SPIFFS.open(filename, "w");
    if (file) {
        String json_string;
        serializeJson(doc, json_string);
        file.print(json_string);
        file.close();
        
        Serial.printf("\n💾 Guardado: %s (%d bytes)\n", filename.c_str(), json_string.length());
        sample_count++;
    } else {
        Serial.println("\n❌ Error guardando archivo");
    }
}

void printStatus() {
    Serial.println("\n=== ESTADO DEL SISTEMA ===");
    Serial.printf("Seña actual: %s\n", current_sign.c_str());
    Serial.printf("Muestras capturadas: %d\n", sample_count);
    Serial.printf("BMI160 izquierdo: %s\n", left_connected ? "✅ Conectado" : "❌ Desconectado");
    Serial.printf("BMI160 derecho: %s\n", right_connected ? "✅ Conectado" : "❌ Desconectado");
    Serial.printf("Estado captura: %s\n", capturing ? "🎬 Grabando" : "⏸️ En espera");
    Serial.printf("Buffer size: %d\n", capture_buffer.size());
    Serial.printf("SPIFFS libre: %d bytes\n", SPIFFS.totalBytes() - SPIFFS.usedBytes());
    Serial.println("========================\n");
}

void listSavedFiles() {
    Serial.println("\n=== ARCHIVOS GUARDADOS ===");
    
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    
    int count = 0;
    while (file) {
        if (!file.isDirectory() && String(file.name()).endsWith(".json")) {
            Serial.printf("%s (%d bytes)\n", file.name(), file.size());
            count++;
        }
        file = root.openNextFile();
    }
    
    if (count == 0) {
        Serial.println("No hay archivos guardados");
    } else {
        Serial.printf("Total: %d archivos\n", count);
    }
    Serial.println("========================\n");
}
