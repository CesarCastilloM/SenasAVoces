#ifndef GLOVE_SENSORS_H
#define GLOVE_SENSORS_H

#include <Arduino.h>
#include <BMI160Gen.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <vector>

// Configuración de pines ESP32
#define FLEX_PINS_LEFT   {34, 35, 32, 33, 25}  // Pulgar, Indice, Medio, Anular, Menique
#define FLEX_PINS_RIGHT  {26, 27, 14, 12, 13}  // Pulgar, Indice, Medio, Anular, Menique
#define BMI160_INT_LEFT  4
#define BMI160_INT_RIGHT 16

// Configuración de sensores
#define SAMPLE_RATE_HZ    50    // Frecuencia de muestreo
#define BUFFER_SIZE       30    // Buffer para señas dinámicas (30 frames = 0.6 seg)
#define STATIC_SAMPLES    15    // Muestras para promediar señas estáticas

// Umbrales para sensores flex
#define FLEX_MIN_VAL      2000  // Valor mínimo (dedo extendido)
#define FLEX_MAX_VAL      4000  // Valor máximo (dedo flexionado)

// Estructura para datos de un frame
struct SensorFrame {
    // Datos IMU (acelerómetro + giroscopio)
    float accel_x, accel_y, accel_z;
    float gyro_x, gyro_y, gyro_z;
    
    // Datos sensores flex (5 dedos)
    float flex_thumb, flex_index, flex_middle, flex_ring, flex_pinky;
    
    // Timestamp
    unsigned long timestamp;
};

// Estructura para datos de ambos guantes
struct GloveData {
    SensorFrame left_hand;
    SensorFrame right_hand;
    bool left_valid;
    bool right_valid;
};

// Modos de captura
enum CaptureMode {
    MODE_IDLE,
    MODE_STATIC,
    MODE_DYNAMIC,
    MODE_CALIBRATION
};

// Clase principal para manejo de sensores
class GloveSensorManager {
private:
    BMI160Gen bmi160_left;
    BMI160Gen bmi160_right;
    
    std::vector<int> flex_pins_left;
    std::vector<int> flex_pins_right;
    
    // Calibración de sensores flex
    struct FlexCalibration {
        int min_val[5];
        int max_val[5];
        bool calibrated;
    } calib_left, calib_right;
    
    // Buffers de datos
    std::vector<SensorFrame> static_buffer_left;
    std::vector<SensorFrame> static_buffer_right;
    std::vector<SensorFrame> dynamic_buffer_left;
    std::vector<SensorFrame> dynamic_buffer_right;
    
    // Estado
    CaptureMode current_mode;
    bool left_hand_connected;
    bool right_hand_connected;
    unsigned long last_sample_time;
    
public:
    GloveSensorManager();
    bool init();
    void update();
    bool isConnected() { return left_hand_connected || right_hand_connected; }
    
    // Configuración y calibración
    void calibrateFlexSensors();
    bool isCalibrated() { return calib_left.calibrated && calib_right.calibrated; }
    
    // Captura de datos
    void startStaticCapture();
    void startDynamicCapture();
    void stopCapture();
    bool isCapturing() { return current_mode != MODE_IDLE; }
    
    // Obtención de datos
    SensorFrame readLeftHand();
    SensorFrame readRightHand();
    GloveData getCurrentData();
    
    // Procesamiento de datos
    SensorFrame getStaticAverage();
    std::vector<SensorFrame> getDynamicSequence();
    JsonDocument createDataPacket(const String& sign_name, bool is_dynamic);
    
    // Utilidades
    float normalizeFlex(int raw_value, int finger, bool is_left);
    void printSensorStatus();
    void resetBuffers();
};

#endif // GLOVE_SENSORS_H
