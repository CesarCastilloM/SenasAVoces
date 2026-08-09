#include "glove_sensors.h"

GloveSensorManager::GloveSensorManager() {
    flex_pins_left = {34, 35, 32, 33, 25};
    flex_pins_right = {26, 27, 14, 12, 13};
    
    current_mode = MODE_IDLE;
    left_hand_connected = false;
    right_hand_connected = false;
    last_sample_time = 0;
    
    // Inicializar calibración
    calib_left.calibrated = false;
    calib_right.calibrated = false;
    for (int i = 0; i < 5; i++) {
        calib_left.min_val[i] = FLEX_MIN_VAL;
        calib_left.max_val[i] = FLEX_MAX_VAL;
        calib_right.min_val[i] = FLEX_MIN_VAL;
        calib_right.max_val[i] = FLEX_MAX_VAL;
    }
}

bool GloveSensorManager::init() {
    Serial.begin(115200);
    Serial.println("Iniciando sistema de guantes LSM...");
    
    // Configurar pines de sensores flex como entrada
    for (int pin : flex_pins_left) {
        pinMode(pin, INPUT);
    }
    for (int pin : flex_pins_right) {
        pinMode(pin, INPUT);
    }
    
    // Inicializar BMI160 mano izquierda
    if (bmi160_left.begin(BMI160Gen::BMI160_I2C_ADDR, BMI160_INT_LEFT)) {
        Serial.println("BMI160 izquierdo detectado");
        bmi160_left.setGyroRate(BMI160_GYRO_RATE_100HZ);
        bmi160_left.setAccelerometerRate(BMI160_ACCEL_RATE_100HZ);
        bmi160_left.setGyroRange(BMI160_GYRO_RANGE_500);
        bmi160_left.setAccelerometerRange(BMI160_ACCEL_RANGE_2G);
        left_hand_connected = true;
    } else {
        Serial.println("Error: BMI160 izquierdo no detectado");
    }
    
    // Inicializar BMI160 mano derecha
    if (bmi160_right.begin(BMI160Gen::BMI160_I2C_ADDR, BMI160_INT_RIGHT)) {
        Serial.println("BMI160 derecho detectado");
        bmi160_right.setGyroRate(BMI160_GYRO_RATE_100HZ);
        bmi160_right.setAccelerometerRate(BMI160_ACCEL_RATE_100HZ);
        bmi160_right.setGyroRange(BMI160_GYRO_RANGE_500);
        bmi160_right.setAccelerometerRange(BMI160_ACCEL_RANGE_2G);
        right_hand_connected = true;
    } else {
        Serial.println("Error: BMI160 derecho no detectado");
    }
    
    // Reservar memoria para buffers
    static_buffer_left.reserve(STATIC_SAMPLES);
    static_buffer_right.reserve(STATIC_SAMPLES);
    dynamic_buffer_left.reserve(BUFFER_SIZE);
    dynamic_buffer_right.reserve(BUFFER_SIZE);
    
    return left_hand_connected || right_hand_connected;
}

void GloveSensorManager::update() {
    unsigned long current_time = millis();
    
    // Muestrear a la frecuencia deseada
    if (current_time - last_sample_time >= (1000 / SAMPLE_RATE_HZ)) {
        last_sample_time = current_time;
        
        if (isCapturing()) {
            SensorFrame left_frame = readLeftHand();
            SensorFrame right_frame = readRightHand();
            
            if (current_mode == MODE_STATIC) {
                if (left_frame.timestamp > 0) {
                    static_buffer_left.push_back(left_frame);
                }
                if (right_frame.timestamp > 0) {
                    static_buffer_right.push_back(right_frame);
                }
                
                // Verificar si tenemos suficientes muestras
                if (static_buffer_left.size() >= STATIC_SAMPLES || 
                    static_buffer_right.size() >= STATIC_SAMPLES) {
                    Serial.println("Captura estática completada");
                    stopCapture();
                }
                
            } else if (current_mode == MODE_DYNAMIC) {
                if (left_frame.timestamp > 0) {
                    dynamic_buffer_left.push_back(left_frame);
                }
                if (right_frame.timestamp > 0) {
                    dynamic_buffer_right.push_back(right_frame);
                }
                
                // Verificar si completamos la secuencia
                if (dynamic_buffer_left.size() >= BUFFER_SIZE || 
                    dynamic_buffer_right.size() >= BUFFER_SIZE) {
                    Serial.println("Captura dinámica completada");
                    stopCapture();
                }
            }
        }
    }
}

void GloveSensorManager::calibrateFlexSensors() {
    Serial.println("Iniciando calibración de sensores flex...");
    Serial.println("Extienda todos los dedos completamente");
    delay(3000);
    
    // Leer valores mínimos (dedos extendidos)
    for (int i = 0; i < 5; i++) {
        calib_left.min_val[i] = analogRead(flex_pins_left[i]);
        calib_right.min_val[i] = analogRead(flex_pins_right[i]);
    }
    
    Serial.println("Ahora flexione todos los dedos completamente");
    delay(3000);
    
    // Leer valores máximos (dedos flexionados)
    for (int i = 0; i < 5; i++) {
        calib_left.max_val[i] = analogRead(flex_pins_left[i]);
        calib_right.max_val[i] = analogRead(flex_pins_right[i]);
    }
    
    calib_left.calibrated = true;
    calib_right.calibrated = true;
    
    Serial.println("Calibración completada");
    
    // Imprimir valores de calibración
    Serial.println("Valores de calibración mano izquierda:");
    for (int i = 0; i < 5; i++) {
        Serial.printf("Dedo %d: min=%d, max=%d\n", i, calib_left.min_val[i], calib_left.max_val[i]);
    }
}

SensorFrame GloveSensorManager::readLeftHand() {
    SensorFrame frame;
    frame.timestamp = millis();
    
    if (!left_hand_connected) {
        frame.timestamp = 0;
        return frame;
    }
    
    // Leer datos del BMI160
    int ax, ay, az;
    int gx, gy, gz;
    
    if (bmi160_left.readMotionSensor(ax, ay, az, gx, gy, gz)) {
        // Convertir a unidades físicas
        frame.accel_x = ax * 2.0f / 32768.0f;  // ±2g range
        frame.accel_y = ay * 2.0f / 32768.0f;
        frame.accel_z = az * 2.0f / 32768.0f;
        
        frame.gyro_x = gx * 500.0f / 32768.0f;  // ±500°/s range
        frame.gyro_y = gy * 500.0f / 32768.0f;
        frame.gyro_z = gz * 500.0f / 32768.0f;
    } else {
        frame.timestamp = 0;
        return frame;
    }
    
    // Leer sensores flex
    frame.flex_thumb = normalizeFlex(analogRead(flex_pins_left[0]), 0, true);
    frame.flex_index = normalizeFlex(analogRead(flex_pins_left[1]), 1, true);
    frame.flex_middle = normalizeFlex(analogRead(flex_pins_left[2]), 2, true);
    frame.flex_ring = normalizeFlex(analogRead(flex_pins_left[3]), 3, true);
    frame.flex_pinky = normalizeFlex(analogRead(flex_pins_left[4]), 4, true);
    
    return frame;
}

SensorFrame GloveSensorManager::readRightHand() {
    SensorFrame frame;
    frame.timestamp = millis();
    
    if (!right_hand_connected) {
        frame.timestamp = 0;
        return frame;
    }
    
    // Leer datos del BMI160
    int ax, ay, az;
    int gx, gy, gz;
    
    if (bmi160_right.readMotionSensor(ax, ay, az, gx, gy, gz)) {
        // Convertir a unidades físicas
        frame.accel_x = ax * 2.0f / 32768.0f;  // ±2g range
        frame.accel_y = ay * 2.0f / 32768.0f;
        frame.accel_z = az * 2.0f / 32768.0f;
        
        frame.gyro_x = gx * 500.0f / 32768.0f;  // ±500°/s range
        frame.gyro_y = gy * 500.0f / 32768.0f;
        frame.gyro_z = gz * 500.0f / 32768.0f;
    } else {
        frame.timestamp = 0;
        return frame;
    }
    
    // Leer sensores flex
    frame.flex_thumb = normalizeFlex(analogRead(flex_pins_right[0]), 0, false);
    frame.flex_index = normalizeFlex(analogRead(flex_pins_right[1]), 1, false);
    frame.flex_middle = normalizeFlex(analogRead(flex_pins_right[2]), 2, false);
    frame.flex_ring = normalizeFlex(analogRead(flex_pins_right[3]), 3, false);
    frame.flex_pinky = normalizeFlex(analogRead(flex_pins_right[4]), 4, false);
    
    return frame;
}

GloveData GloveSensorManager::getCurrentData() {
    GloveData data;
    data.left_hand = readLeftHand();
    data.right_hand = readRightHand();
    data.left_valid = (data.left_hand.timestamp > 0);
    data.right_valid = (data.right_hand.timestamp > 0);
    return data;
}

float GloveSensorManager::normalizeFlex(int raw_value, int finger, bool is_left) {
    FlexCalibration& calib = is_left ? calib_left : calib_right;
    
    if (!calib.calibrated) {
        // Normalización simple sin calibración
        return map(raw_value, FLEX_MIN_VAL, FLEX_MAX_VAL, 0.0f, 1.0f);
    }
    
    // Normalización con calibración
    int min_val = calib.min_val[finger];
    int max_val = calib.max_val[finger];
    
    if (max_val <= min_val) {
        return 0.0f;
    }
    
    float normalized = (float)(raw_value - min_val) / (float)(max_val - min_val);
    return constrain(normalized, 0.0f, 1.0f);
}

void GloveSensorManager::startStaticCapture() {
    resetBuffers();
    current_mode = MODE_STATIC;
    Serial.println("Iniciando captura estática...");
}

void GloveSensorManager::startDynamicCapture() {
    resetBuffers();
    current_mode = MODE_DYNAMIC;
    Serial.println("Iniciando captura dinámica...");
}

void GloveSensorManager::stopCapture() {
    current_mode = MODE_IDLE;
    Serial.println("Captura detenida");
}

SensorFrame GloveSensorManager::getStaticAverage() {
    SensorFrame avg = {0};
    int count = 0;
    
    // Promediar datos de la mano izquierda
    if (!static_buffer_left.empty()) {
        for (const auto& frame : static_buffer_left) {
            avg.accel_x += frame.accel_x;
            avg.accel_y += frame.accel_y;
            avg.accel_z += frame.accel_z;
            avg.gyro_x += frame.gyro_x;
            avg.gyro_y += frame.gyro_y;
            avg.gyro_z += frame.gyro_z;
            avg.flex_thumb += frame.flex_thumb;
            avg.flex_index += frame.flex_index;
            avg.flex_middle += frame.flex_middle;
            avg.flex_ring += frame.flex_ring;
            avg.flex_pinky += frame.flex_pinky;
        }
        count = static_buffer_left.size();
    }
    // Si no hay datos de la izquierda, usar la derecha
    else if (!static_buffer_right.empty()) {
        for (const auto& frame : static_buffer_right) {
            avg.accel_x += frame.accel_x;
            avg.accel_y += frame.accel_y;
            avg.accel_z += frame.accel_z;
            avg.gyro_x += frame.gyro_x;
            avg.gyro_y += frame.gyro_y;
            avg.gyro_z += frame.gyro_z;
            avg.flex_thumb += frame.flex_thumb;
            avg.flex_index += frame.flex_index;
            avg.flex_middle += frame.flex_middle;
            avg.flex_ring += frame.flex_ring;
            avg.flex_pinky += frame.flex_pinky;
        }
        count = static_buffer_right.size();
    }
    
    if (count > 0) {
        float inv_count = 1.0f / count;
        avg.accel_x *= inv_count;
        avg.accel_y *= inv_count;
        avg.accel_z *= inv_count;
        avg.gyro_x *= inv_count;
        avg.gyro_y *= inv_count;
        avg.gyro_z *= inv_count;
        avg.flex_thumb *= inv_count;
        avg.flex_index *= inv_count;
        avg.flex_middle *= inv_count;
        avg.flex_ring *= inv_count;
        avg.flex_pinky *= inv_count;
        avg.timestamp = millis();
    }
    
    return avg;
}

std::vector<SensorFrame> GloveSensorManager::getDynamicSequence() {
    // Preferir datos de la mano izquierda, si no hay usar la derecha
    if (!dynamic_buffer_left.empty()) {
        return dynamic_buffer_left;
    } else if (!dynamic_buffer_right.empty()) {
        return dynamic_buffer_right;
    }
    return std::vector<SensorFrame>();
}

JsonDocument GloveSensorManager::createDataPacket(const String& sign_name, bool is_dynamic) {
    JsonDocument doc;
    
    doc["sign_name"] = sign_name;
    doc["mode"] = is_dynamic ? "dynamic" : "static";
    doc["timestamp"] = millis();
    doc["sample_rate"] = SAMPLE_RATE_HZ;
    
    JsonArray left_hand_data = doc["left_hand"].to<JsonArray>();
    JsonArray right_hand_data = doc["right_hand"].to<JsonArray>();
    
    if (is_dynamic) {
        // Datos dinámicos - secuencia completa
        auto sequence = getDynamicSequence();
        for (const auto& frame : sequence) {
            JsonObject frame_obj = left_hand_data.add<JsonObject>();
            frame_obj["accel_x"] = frame.accel_x;
            frame_obj["accel_y"] = frame.accel_y;
            frame_obj["accel_z"] = frame.accel_z;
            frame_obj["gyro_x"] = frame.gyro_x;
            frame_obj["gyro_y"] = frame.gyro_y;
            frame_obj["gyro_z"] = frame.gyro_z;
            frame_obj["flex_thumb"] = frame.flex_thumb;
            frame_obj["flex_index"] = frame.flex_index;
            frame_obj["flex_middle"] = frame.flex_middle;
            frame_obj["flex_ring"] = frame.flex_ring;
            frame_obj["flex_pinky"] = frame.flex_pinky;
            frame_obj["timestamp"] = frame.timestamp;
        }
    } else {
        // Datos estáticos - promedio
        SensorFrame avg = getStaticAverage();
        if (avg.timestamp > 0) {
            JsonObject frame_obj = left_hand_data.add<JsonObject>();
            frame_obj["accel_x"] = avg.accel_x;
            frame_obj["accel_y"] = avg.accel_y;
            frame_obj["accel_z"] = avg.accel_z;
            frame_obj["gyro_x"] = avg.gyro_x;
            frame_obj["gyro_y"] = avg.gyro_y;
            frame_obj["gyro_z"] = avg.gyro_z;
            frame_obj["flex_thumb"] = avg.flex_thumb;
            frame_obj["flex_index"] = avg.flex_index;
            frame_obj["flex_middle"] = avg.flex_middle;
            frame_obj["flex_ring"] = avg.flex_ring;
            frame_obj["flex_pinky"] = avg.flex_pinky;
            frame_obj["timestamp"] = avg.timestamp;
        }
    }
    
    // Metadata
    doc["metadata"]["left_connected"] = left_hand_connected;
    doc["metadata"]["right_connected"] = right_hand_connected;
    doc["metadata"]["calibrated"] = isCalibrated();
    
    return doc;
}

void GloveSensorManager::printSensorStatus() {
    Serial.println("=== Estado de Sensores ===");
    Serial.printf("Mano izquierda: %s\n", left_hand_connected ? "Conectada" : "Desconectada");
    Serial.printf("Mano derecha: %s\n", right_hand_connected ? "Conectada" : "Desconectada");
    Serial.printf("Calibración: %s\n", isCalibrated() ? "Completa" : "Pendiente");
    Serial.printf("Modo actual: %d\n", current_mode);
    
    // Leer y mostrar valores actuales
    GloveData current = getCurrentData();
    if (current.left_valid) {
        Serial.println("Datos mano izquierda:");
        Serial.printf("  Accel: %.2f, %.2f, %.2f\n", 
                     current.left_hand.accel_x, current.left_hand.accel_y, current.left_hand.accel_z);
        Serial.printf("  Gyro: %.2f, %.2f, %.2f\n", 
                     current.left_hand.gyro_x, current.left_hand.gyro_y, current.left_hand.gyro_z);
        Serial.printf("  Flex: %.2f, %.2f, %.2f, %.2f, %.2f\n",
                     current.left_hand.flex_thumb, current.left_hand.flex_index, 
                     current.left_hand.flex_middle, current.left_hand.flex_ring, 
                     current.left_hand.flex_pinky);
    }
    
    if (current.right_valid) {
        Serial.println("Datos mano derecha:");
        Serial.printf("  Accel: %.2f, %.2f, %.2f\n", 
                     current.right_hand.accel_x, current.right_hand.accel_y, current.right_hand.accel_z);
        Serial.printf("  Gyro: %.2f, %.2f, %.2f\n", 
                     current.right_hand.gyro_x, current.right_hand.gyro_y, current.right_hand.gyro_z);
        Serial.printf("  Flex: %.2f, %.2f, %.2f, %.2f, %.2f\n",
                     current.right_hand.flex_thumb, current.right_hand.flex_index, 
                     current.right_hand.flex_middle, current.right_hand.flex_ring, 
                     current.right_hand.flex_pinky);
    }
    Serial.println("========================");
}

void GloveSensorManager::resetBuffers() {
    static_buffer_left.clear();
    static_buffer_right.clear();
    dynamic_buffer_left.clear();
    dynamic_buffer_right.clear();
}
