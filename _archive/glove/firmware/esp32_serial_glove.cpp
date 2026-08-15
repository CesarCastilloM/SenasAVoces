#include <Arduino.h>

// ============================================
// CONFIGURACIÓN
// ============================================
// Pines de los botones
const int botones[5] = {4, 5, 18, 19, 21};

// Palabras correspondientes a cada botón
String palabras[5] = {"Buenas", "tardes", "mesa", "para", "cuatro"};

// Variables de control
bool button_states[5] = {HIGH, HIGH, HIGH, HIGH, HIGH};
unsigned long last_press_time = 0;
const unsigned long DEBOUNCE_DELAY = 300; // 300ms anti-rebote
// ============================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=================================");
  Serial.println("ESP32 GUANTE LENGUAJE DE SEÑAS");
  Serial.println("=================================\n");
  
  // Configurar botones con pull-up interno
  for (int i = 0; i < 5; i++) {
    pinMode(botones[i], INPUT_PULLUP);
  }
  
  Serial.println("✓ Sistema iniciado!");
  Serial.println("\nPresiona los botones para enviar palabras:");
  for (int i = 0; i < 5; i++) {
    Serial.printf("  Pin %d → %s\n", botones[i], palabras[i].c_str());
  }
  Serial.println("\n─────────────────────────────────");
  Serial.println("Esperando señales...\n");
}

void loop() {
  unsigned long current_time = millis();
  
  // Revisar cada botón
  for (int i = 0; i < 5; i++) {
    bool current_state = digitalRead(botones[i]);
    
    // Detectar flanco descendente (botón presionado)
    if (button_states[i] == HIGH && current_state == LOW) {
      // Anti-rebote
      if (current_time - last_press_time > DEBOUNCE_DELAY) {
        last_press_time = current_time;
        
        // Enviar comando al PC en formato simple
        Serial.print("SPEAK:");
        Serial.println(palabras[i]);
        
        // Feedback visual en monitor
        Serial.printf("[Pin %d] → %s\n", botones[i], palabras[i].c_str());
      }
    }
    
    button_states[i] = current_state;
  }
  
  delay(10); // Pequeña pausa para estabilidad
}
