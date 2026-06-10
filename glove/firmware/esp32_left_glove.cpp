/*
 * SEÑAS A VOCES - Guante Izquierdo (ESP32)
 * 
 * Componentes:
 * - 5 Sensores de Flexión (dedos)
 * - 1 MPU6050 (giroscopio + acelerómetro)
 * - 2 ADS1115 (convertidores ADC I2C)
 * - WiFi UDP para enviar datos a Raspberry Pi
 * 
 * Autor: César
 * Fecha: Abril 2026
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Adafruit_ADS1X15.h>
#include <MPU6050.h>

// ==================== CONFIGURACIÓN WIFI ====================
const char* WIFI_SSID = "Tec";
const char* WIFI_USERNAME = "A01254425";
const char* WIFI_PASSWORD = "Ccm2006066871@";
const char* RPI_IP = "192.168.1.100";  // CAMBIAR a IP de Raspberry Pi
const int UDP_PORT = 5000;

// ==================== OBJETOS ====================
WiFiUDP udp;
Adafruit_ADS1115 ads1;  // Dirección I2C 0x48
Adafruit_ADS1115 ads2;  // Dirección I2C 0x49
MPU6050 mpu;

// ==================== VARIABLES ====================
int16_t flex_values[5];      // Valores de sensores de flexión (0-32767)
int16_t ax, ay, az;          // Acelerómetro
int16_t gx, gy, gz;          // Giroscopio

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 50;  // Enviar cada 50ms (20 Hz)

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n");
  Serial.println("╔════════════════════════════════════════════╗");
  Serial.println("║   SEÑAS A VOCES - Guante Izquierdo (ESP32) ║");
  Serial.println("╚════════════════════════════════════════════╝");
  Serial.println();
  
  // Inicializar I2C
  Wire.begin(21, 22);  // SDA=GPIO21, SCL=GPIO22
  Serial.println("✓ I2C inicializado (SDA=21, SCL=22)");
  
  // Inicializar ADS1115 #1 (0x48)
  if (!ads1.begin(0x48)) {
    Serial.println("✗ Error: ADS1115 #1 (0x48) no encontrado");
    while (1);
  }
  Serial.println("✓ ADS1115 #1 (0x48) inicializado");
  
  // Inicializar ADS1115 #2 (0x49)
  if (!ads2.begin(0x49)) {
    Serial.println("✗ Error: ADS1115 #2 (0x49) no encontrado");
    while (1);
  }
  Serial.println("✓ ADS1115 #2 (0x49) inicializado");
  
  // Inicializar MPU6050
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("✗ Error: MPU6050 no encontrado");
    while (1);
  }
  Serial.println("✓ MPU6050 inicializado");
  
  // Configurar MPU6050
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);
  
  // Conectar WiFi WPA2 Enterprise
  Serial.println("\n🌐 Conectando a WiFi Enterprise...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  
  esp_wifi_sta_wpa2_ent_set_identity((uint8_t *)WIFI_USERNAME, strlen(WIFI_USERNAME));
  esp_wifi_sta_wpa2_ent_set_username((uint8_t *)WIFI_USERNAME, strlen(WIFI_USERNAME));
  esp_wifi_sta_wpa2_ent_set_password((uint8_t *)WIFI_PASSWORD, strlen(WIFI_PASSWORD));
  esp_wifi_sta_wpa2_ent_enable();
  
  WiFi.begin(WIFI_SSID);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi conectado");
    Serial.print("✓ IP del ESP32: ");
    Serial.println(WiFi.localIP());
    Serial.print("✓ Enviando datos a: ");
    Serial.print(RPI_IP);
    Serial.print(":");
    Serial.println(UDP_PORT);
  } else {
    Serial.println("\n✗ Error: No se pudo conectar a WiFi");
    while (1);
  }
  
  Serial.println("\n✓ Sistema listo - Guante Izquierdo");
  Serial.println("══════════════════════════════════════════════\n");
}

// ==================== LOOP ====================
void loop() {
  unsigned long currentTime = millis();
  
  // Enviar datos cada 50ms (20 Hz)
  if (currentTime - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = currentTime;
    
    // Leer sensores de flexión
    flex_values[0] = ads1.readADC_SingleEnded(0);  // Pulgar
    flex_values[1] = ads1.readADC_SingleEnded(1);  // Índice
    flex_values[2] = ads1.readADC_SingleEnded(2);  // Medio
    flex_values[3] = ads1.readADC_SingleEnded(3);  // Anular
    flex_values[4] = ads2.readADC_SingleEnded(0);  // Meñique
    
    // Leer MPU6050
    mpu.getAcceleration(&ax, &ay, &az);
    mpu.getRotation(&gx, &gy, &gz);
    
    // Crear paquete JSON
    String packet = "{";
    packet += "\"hand\":\"left\",";
    
    // Sensores de flexión
    packet += "\"flex\":[";
    for (int i = 0; i < 5; i++) {
      packet += String(flex_values[i]);
      if (i < 4) packet += ",";
    }
    packet += "],";
    
    // Acelerómetro
    packet += "\"accel\":[";
    packet += String(ax) + "," + String(ay) + "," + String(az);
    packet += "],";
    
    // Giroscopio
    packet += "\"gyro\":[";
    packet += String(gx) + "," + String(gy) + "," + String(gz);
    packet += "]";
    
    packet += "}";
    
    // Enviar por UDP
    udp.beginPacket(RPI_IP, UDP_PORT);
    udp.print(packet);
    udp.endPacket();
    
    // Debug en Serial
    Serial.print("📤 Enviado: ");
    Serial.print("Flex=[");
    for (int i = 0; i < 5; i++) {
      Serial.print(flex_values[i]);
      if (i < 4) Serial.print(",");
    }
    Serial.print("] Accel=[");
    Serial.print(ax); Serial.print(",");
    Serial.print(ay); Serial.print(",");
    Serial.print(az);
    Serial.print("] Gyro=[");
    Serial.print(gx); Serial.print(",");
    Serial.print(gy); Serial.print(",");
    Serial.print(gz);
    Serial.println("]");
  }
  
  // Verificar conexión WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi desconectado, reconectando...");
    WiFi.reconnect();
    delay(1000);
  }
}
