#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
// Red WiFi Regular

const char* WIFI_SSID = "INVITADOS-AMDE";
const char* WIFI_PASSWORD = "34567890";

const char* PC_IP = "10.128.32.23";  // IP de tu PC en la red
const int UDP_PORT = 5000;

// PROTOTIPO SEÑAS A VOCES
const int boton_escuchar = 17;
bool escuchar = false;
const int botones[8] = {4, 5, 18, 19, 21, 22, 23, 25};

String palabras[8] = {
  "tardes",      // 1
  "Negocio A Gobierno",        // 2
  "gracias",     // 3
  "Buenas",        // 4
  "Te quiero",     // 5
  "oyentes no entienden nuestras señas",         // 6
  "Ahora sí",       // 7
  "Compárteme tu sacapuntas"      // 8
};

int estadoAnterior[8];
String last_word = "";
String mensaje = "";
int estadoAnteriorEscuchar = HIGH;

WiFiUDP udp;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=================================");
  Serial.println("ESP32 GUANTE INALÁMBRICO WiFi");
  Serial.println("=================================\n");
  
  Serial.print("Conectando a red WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_STA);
  
  // Conexión WiFi regular (WPA2-PSK)
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi conectado!");
    Serial.print("IP del ESP32: ");
    Serial.println(WiFi.localIP());
    Serial.print("Enviando a PC: ");
    Serial.print(PC_IP);
    Serial.print(":");
    Serial.println(UDP_PORT);
  } else {
    Serial.println("\n✗ Error conectando WiFi");
    Serial.println("Verifica SSID y password");
    return;
  }
  
  pinMode(boton_escuchar, INPUT_PULLUP);
  for (int i = 0; i < 8; i++) {
    pinMode(botones[i], INPUT_PULLUP);
    estadoAnterior[i] = HIGH;
  }
  
  Serial.println("\n✓ Sistema iniciado!");
  Serial.println("\nModo: SEÑAS A VOCES");
  Serial.println("Pin 17: Botón ESCUCHAR (toggle)");
  Serial.println("\nPalabras disponibles:");
  for (int i = 0; i < 8; i++) {
    Serial.printf("  Pin %d → %s\n", botones[i], palabras[i].c_str());
  }
  Serial.println("\n─────────────────────────────────");
  Serial.println("Presiona Pin 17 para empezar a escuchar...\n");
}

void enviarPalabra(String palabra) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("✗ WiFi desconectado!");
    return;
  }
  
  String mensaje = "SPEAK:" + palabra;
  
  udp.beginPacket(PC_IP, UDP_PORT);
  udp.print(mensaje);
  udp.endPacket();
  
  Serial.print(" Enviado por WiFi: ");
  Serial.println(mensaje);
}

void loop() {
  int estadoActualEscuchar = digitalRead(boton_escuchar);

  // Detectar clic en botón escuchar
  if (estadoAnteriorEscuchar == HIGH && estadoActualEscuchar == LOW) {
    escuchar = !escuchar;

    if (escuchar) {
      mensaje = "";
      last_word = "";
      Serial.println("\n>>> MODO ESCUCHAR ACTIVADO <<<");
      Serial.println("Presiona botones para formar mensaje...");
    } else {
      Serial.println("\n>>> MODO ESCUCHAR DESACTIVADO <<<");
      if (mensaje.length() > 0) {
        Serial.print("Mensaje completo: ");
        Serial.println(mensaje);
        enviarPalabra(mensaje);
      }
    }
  }

  // Si está escuchando, capturar palabras
  if (escuchar) {
    for (int i = 0; i < 8; i++) {
      int estadoActual = digitalRead(botones[i]);

      if (estadoAnterior[i] == HIGH && estadoActual == LOW) {
        String new_word = palabras[i];

        if (new_word != last_word) {
          mensaje += new_word + " ";
          last_word = new_word;
          Serial.print("+ ");
          Serial.println(new_word);
        }

        delay(200);
      }

      estadoAnterior[i] = estadoActual;
    }
  }

  estadoAnteriorEscuchar = estadoActualEscuchar;
  delay(10);
}
