#include "glove_sensors.h"
#include <WiFi.h>
#include <WebServer.h>
#include <SPIFFS.h>
#include <HTTPClient.h>

// Configuración WiFi
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Configuración del servidor web
WebServer server(80);
GloveSensorManager gloveManager;

// Variables globales
String current_sign = "";
bool capture_enabled = false;
int samples_captured = 0;
const int MAX_SAMPLES_PER_SIGN = 20;

// Variables para comunicación con celular
String server_endpoint = "http://YOUR_SERVER_IP:5000/api/glove_data";
bool wifi_connected = false;

// Funciones para manejo de servidor web
void handleRoot();
void handleStatus();
void handleCalibrate();
void handleCapture();
void handleData();
void handleWiFiConfig();
void handleSignList();

// Funciones para captura de datos
void processSerialCommands();
void sendToServer(const String& json_data);
void saveToSPIFFS(const String& sign_name, const String& json_data);
String getSignList();

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("========================================");
    Serial.println("Sistema de Guantes LSM - ESP32");
    Serial.println("========================================");
    
    // Inicializar SPIFFS
    if (!SPIFFS.begin(true)) {
        Serial.println("Error al montar SPIFFS");
    } else {
        Serial.println("SPIFFS montado correctamente");
    }
    
    // Inicializar sensores
    if (!gloveManager.init()) {
        Serial.println("Error: No se detectaron sensores");
        Serial.println("Verifique conexiones de BMI160 y sensores flex");
    } else {
        Serial.println("Sensores inicializados correctamente");
    }
    
    // Configurar servidor web
    setupWebServer();
    
    // Intentar conectar WiFi
    WiFi.begin(ssid, password);
    Serial.print("Conectando a WiFi");
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        wifi_connected = true;
        Serial.println();
        Serial.printf("WiFi conectado. IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("Servidor web disponible en: http://%s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println();
        Serial.println("No se pudo conectar a WiFi. Modo offline activado.");
        WiFi.mode(WIFI_AP);
        WiFi.softAP("LSM-Gloves", "password123");
        Serial.printf("Punto de acceso creado. IP: %s\n", WiFi.softAPIP().toString().c_str());
    }
    
    server.begin();
    
    Serial.println("========================================");
    Serial.println("Sistema listo para capturar datos");
    Serial.println("Comandos disponibles:");
    Serial.println("  calibrate - Calibrar sensores flex");
    Serial.println("  status    - Mostrar estado de sensores");
    Serial.println("  static    - Iniciar captura estática");
    Serial.println("  dynamic   - Iniciar captura dinámica");
    Serial.println("  sign:<nombre> - Establecer nombre de seña");
    Serial.println("  wifi:<ssid>:<pass> - Configurar WiFi");
    Serial.println("========================================");
}

void loop() {
    server.handleClient();
    gloveManager.update();
    processSerialCommands();
    
    delay(10);  // Pequeña pausa para no sobrecargar el CPU
}

void setupWebServer() {
    server.on("/", HTTP_GET, handleRoot);
    server.on("/status", HTTP_GET, handleStatus);
    server.on("/calibrate", HTTP_POST, handleCalibrate);
    server.on("/capture", HTTP_POST, handleCapture);
    server.on("/data", HTTP_GET, handleData);
    server.on("/wifi", HTTP_POST, handleWiFiConfig);
    server.on("/signs", HTTP_GET, handleSignList);
    
    server.enableCORS(true);
}

void handleRoot() {
    String html = R"(
<!DOCTYPE html>
<html>
<head>
    <title>Sistema de Guantes LSM</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        button { padding: 10px 20px; margin: 5px; border: none; border-radius: 5px; cursor: pointer; }
        .btn-primary { background: #007bff; color: white; }
        .btn-success { background: #28a745; color: white; }
        .btn-warning { background: #ffc107; color: black; }
        .btn-danger { background: #dc3545; color: white; }
        input, select { padding: 8px; margin: 5px; border: 1px solid #ddd; border-radius: 3px; }
        .sign-list { max-height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧤 Sistema de Guantes LSM</h1>
        
        <div id="status" class="status">Cargando estado...</div>
        
        <h2>Control de Captura</h2>
        <div>
            <label>Nombre de la seña: </label>
            <input type="text" id="signName" placeholder="Ej: A, B, J, 1, 2...">
            <button class="btn-primary" onclick="setSign()">Establecer</button>
        </div>
        
        <div>
            <button class="btn-success" onclick="startCapture('static')">📸 Captura Estática</button>
            <button class="btn-warning" onclick="startCapture('dynamic')">🎬 Captura Dinámica</button>
            <button class="btn-danger" onclick="calibrate()">🔧 Calibrar</button>
        </div>
        
        <h2>Señas Capturadas</h2>
        <div id="signList" class="sign-list">Cargando lista...</div>
        
        <h2>Configuración WiFi</h2>
        <div>
            <input type="text" id="wifiSSID" placeholder="SSID">
            <input type="password" id="wifiPass" placeholder="Contraseña">
            <button class="btn-primary" onclick="configureWiFi()">Configurar</button>
        </div>
        
        <h2>Logs del Sistema</h2>
        <div id="logs" style="background: #f8f9fa; padding: 10px; height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px;">
        </div>
    </div>

    <script>
        let currentSign = '';
        
        function updateStatus() {
            fetch('/status')
                .then(response => response.json())
                .then(data => {
                    const statusDiv = document.getElementById('status');
                    if (data.connected) {
                        statusDiv.className = 'status connected';
                        statusDiv.innerHTML = '✅ Sensores conectados | Calibración: ' + 
                                            (data.calibrated ? '✅' : '❌') + 
                                            ' | Modo: ' + data.mode;
                    } else {
                        statusDiv.className = 'status disconnected';
                        statusDiv.innerHTML = '❌ Sensores desconectados';
                    }
                    
                    document.getElementById('signName').value = data.current_sign;
                    currentSign = data.current_sign;
                });
        }
        
        function updateSignList() {
            fetch('/signs')
                .then(response => response.json())
                .then(data => {
                    const listDiv = document.getElementById('signList');
                    if (data.signs && data.signs.length > 0) {
                        listDiv.innerHTML = data.signs.map(sign => 
                            `<div>${sign.name}: ${sign.samples} muestras (${sign.mode})</div>`
                        ).join('');
                    } else {
                        listDiv.innerHTML = 'No hay señas capturadas aún';
                    }
                });
        }
        
        function addLog(message) {
            const logs = document.getElementById('logs');
            const time = new Date().toLocaleTimeString();
            logs.innerHTML += `[${time}] ${message}\n`;
            logs.scrollTop = logs.scrollHeight;
        }
        
        function setSign() {
            const signName = document.getElementById('signName').value;
            if (!signName) {
                addLog('Error: Ingrese un nombre de seña');
                return;
            }
            
            fetch('/capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_sign', sign_name: signName })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    addLog(`Seña establecida: ${signName}`);
                    currentSign = signName;
                } else {
                    addLog(`Error: ${data.message}`);
                }
            });
        }
        
        function startCapture(mode) {
            if (!currentSign) {
                addLog('Error: Establezca primero el nombre de la seña');
                return;
            }
            
            addLog(`Iniciando captura ${mode} para: ${currentSign}`);
            
            fetch('/capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start', mode: mode })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    addLog(`Captura ${mode} iniciada`);
                    monitorCapture();
                } else {
                    addLog(`Error: ${data.message}`);
                }
            });
        }
        
        function monitorCapture() {
            const checkStatus = () => {
                fetch('/status')
                    .then(response => response.json())
                    .then(data => {
                        if (data.mode === 'idle' && data.last_capture_success) {
                            addLog(`✅ Captura completada: ${data.last_capture_samples} muestras`);
                            updateSignList();
                        } else if (data.mode !== 'idle') {
                            setTimeout(checkStatus, 500);
                        }
                    });
            };
            setTimeout(checkStatus, 500);
        }
        
        function calibrate() {
            addLog('Iniciando calibración...');
            fetch('/calibrate', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        addLog('✅ Calibración completada');
                    } else {
                        addLog(`❌ Error en calibración: ${data.message}`);
                    }
                });
        }
        
        function configureWiFi() {
            const ssid = document.getElementById('wifiSSID').value;
            const pass = document.getElementById('wifiPass').value;
            
            if (!ssid) {
                addLog('Error: Ingrese el SSID');
                return;
            }
            
            addLog('Configurando WiFi...');
            fetch('/wifi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ssid: ssid, password: pass })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    addLog('✅ WiFi configurado. Reiniciando...');
                    setTimeout(() => location.reload(), 2000);
                } else {
                    addLog(`❌ Error: ${data.message}`);
                }
            });
        }
        
        // Actualizar estado cada 2 segundos
        setInterval(updateStatus, 2000);
        setInterval(updateSignList, 5000);
        
        // Inicializar
        updateStatus();
        updateSignList();
        addLog('Sistema de guantes LSM listo');
    </script>
</body>
</html>
)";
    
    server.send(200, "text/html", html);
}

void handleStatus() {
    JsonDocument doc;
    
    doc["connected"] = gloveManager.isConnected();
    doc["calibrated"] = gloveManager.isCalibrated();
    doc["current_sign"] = current_sign;
    doc["samples_captured"] = samples_captured;
    doc["wifi_connected"] = wifi_connected;
    doc["ip_address"] = WiFi.localIP().toString();
    
    // Determinar modo actual
    if (gloveManager.isCapturing()) {
        doc["mode"] = "capturing";
    } else {
        doc["mode"] = "idle";
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void handleCalibrate() {
    JsonDocument doc;
    
    try {
        gloveManager.calibrateFlexSensors();
        doc["success"] = true;
        doc["message"] = "Calibración completada";
    } catch (...) {
        doc["success"] = false;
        doc["message"] = "Error durante la calibración";
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void handleCapture() {
    JsonDocument doc;
    String body = server.arg("plain");
    
    try {
        JsonDocument request;
        deserializeJson(request, body);
        
        String action = request["action"];
        
        if (action == "set_sign") {
            current_sign = request["sign_name"].as<String>();
            samples_captured = 0;
            doc["success"] = true;
            doc["message"] = "Seña establecida: " + current_sign;
            
        } else if (action == "start") {
            if (current_sign.isEmpty()) {
                doc["success"] = false;
                doc["message"] = "No hay seña seleccionada";
            } else {
                String mode = request["mode"];
                if (mode == "static") {
                    gloveManager.startStaticCapture();
                    doc["success"] = true;
                    doc["message"] = "Captura estática iniciada";
                } else if (mode == "dynamic") {
                    gloveManager.startDynamicCapture();
                    doc["success"] = true;
                    doc["message"] = "Captura dinámica iniciada";
                } else {
                    doc["success"] = false;
                    doc["message"] = "Modo no válido";
                }
            }
        } else {
            doc["success"] = false;
            doc["message"] = "Acción no reconocida";
        }
        
    } catch (...) {
        doc["success"] = false;
        doc["message"] = "Error procesando solicitud";
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void handleData() {
    // Enviar datos crudos de sensores para depuración
    GloveData current = gloveManager.getCurrentData();
    JsonDocument doc;
    
    if (current.left_valid) {
        JsonObject left = doc["left_hand"];
        left["accel_x"] = current.left_hand.accel_x;
        left["accel_y"] = current.left_hand.accel_y;
        left["accel_z"] = current.left_hand.accel_z;
        left["gyro_x"] = current.left_hand.gyro_x;
        left["gyro_y"] = current.left_hand.gyro_y;
        left["gyro_z"] = current.left_hand.gyro_z;
        left["flex_thumb"] = current.left_hand.flex_thumb;
        left["flex_index"] = current.left_hand.flex_index;
        left["flex_middle"] = current.left_hand.flex_middle;
        left["flex_ring"] = current.left_hand.flex_ring;
        left["flex_pinky"] = current.left_hand.flex_pinky;
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void handleWiFiConfig() {
    JsonDocument doc;
    String body = server.arg("plain");
    
    try {
        JsonDocument request;
        deserializeJson(request, body);
        
        String new_ssid = request["ssid"];
        String new_password = request["password"];
        
        // Guardar configuración (en una implementación real, guardar en SPIFFS)
        doc["success"] = true;
        doc["message"] = "WiFi configurado. Reinicie el dispositivo.";
        
    } catch (...) {
        doc["success"] = false;
        doc["message"] = "Error configurando WiFi";
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void handleSignList() {
    JsonDocument doc;
    JsonArray signs = doc["signs"].to<JsonArray>();
    
    // Listar archivos guardados en SPIFFS
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    
    while (file) {
        if (String(file.name()).endsWith(".json")) {
            String sign_name = String(file.name());
            sign_name.replace("/data_", "");
            sign_name.replace(".json", "");
            
            JsonObject sign = signs.add<JsonObject>();
            sign["name"] = sign_name;
            sign["size"] = file.size();
            
            // Contar muestras (implementación simplificada)
            sign["samples"] = 1;
            sign["mode"] = sign_name.indexOf("_dyn") >= 0 ? "dynamic" : "static";
        }
        file = root.openNextFile();
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
}

void processSerialCommands() {
    if (Serial.available()) {
        String command = Serial.readStringUntil('\n');
        command.trim();
        
        if (command == "status") {
            gloveManager.printSensorStatus();
            
        } else if (command == "calibrate") {
            gloveManager.calibrateFlexSensors();
            
        } else if (command == "static") {
            if (current_sign.isEmpty()) {
                Serial.println("Error: Establezca primero el nombre de la seña con 'sign:<nombre>'");
            } else {
                gloveManager.startStaticCapture();
                Serial.println("Captura estática iniciada para: " + current_sign);
            }
            
        } else if (command == "dynamic") {
            if (current_sign.isEmpty()) {
                Serial.println("Error: Establezca primero el nombre de la seña con 'sign:<nombre>'");
            } else {
                gloveManager.startDynamicCapture();
                Serial.println("Captura dinámica iniciada para: " + current_sign);
            }
            
        } else if (command.startsWith("sign:")) {
            current_sign = command.substring(5);
            samples_captured = 0;
            Serial.println("Seña establecida: " + current_sign);
            
        } else if (command.startsWith("wifi:")) {
            // Formato: wifi:SSID:PASSWORD
            int first_colon = command.indexOf(':', 5);
            int second_colon = command.indexOf(':', first_colon + 1);
            
            if (first_colon > 0 && second_colon > first_colon) {
                String new_ssid = command.substring(5, first_colon);
                String new_password = command.substring(first_colon + 1, second_colon);
                Serial.println("WiFi configurado. Reinicie el dispositivo.");
            } else {
                Serial.println("Formato incorrecto. Use: wifi:SSID:PASSWORD");
            }
            
        } else if (command == "help") {
            Serial.println("Comandos disponibles:");
            Serial.println("  calibrate - Calibrar sensores flex");
            Serial.println("  status    - Mostrar estado de sensores");
            Serial.println("  static    - Iniciar captura estática");
            Serial.println("  dynamic   - Iniciar captura dinámica");
            Serial.println("  sign:<nombre> - Establecer nombre de seña");
            Serial.println("  wifi:<ssid>:<pass> - Configurar WiFi");
        }
    }
    
    // Verificar si la captura ha terminado
    static bool was_capturing = false;
    bool is_capturing = gloveManager.isCapturing();
    
    if (was_capturing && !is_capturing && !current_sign.isEmpty()) {
        // La captura acaba de terminar
        bool is_dynamic = true; // Determinar según el modo que estaba activo
        
        JsonDocument dataPacket = gloveManager.createDataPacket(current_sign, is_dynamic);
        String json_data;
        serializeJson(dataPacket, json_data);
        
        // Guardar localmente
        saveToSPIFFS(current_sign, json_data);
        
        // Enviar al servidor si hay WiFi
        if (wifi_connected) {
            sendToServer(json_data);
        }
        
        samples_captured++;
        Serial.printf("Captura completada: %s (muestra %d/%d)\n", 
                     current_sign.c_str(), samples_captured, MAX_SAMPLES_PER_SIGN);
        
        // Si alcanzamos el máximo, reiniciar contador
        if (samples_captured >= MAX_SAMPLES_PER_SIGN) {
            Serial.printf("Se completaron %d muestras para %s\n", MAX_SAMPLES_PER_SIGN, current_sign.c_str());
            samples_captured = 0;
        }
    }
    
    was_capturing = is_capturing;
}

void sendToServer(const String& json_data) {
    HTTPClient http;
    
    http.begin(server_endpoint);
    http.addHeader("Content-Type", "application/json");
    
    int httpResponseCode = http.POST(json_data);
    
    if (httpResponseCode > 0) {
        Serial.printf("Datos enviados al servidor. Código: %d\n", httpResponseCode);
    } else {
        Serial.printf("Error enviando datos: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    
    http.end();
}

void saveToSPIFFS(const String& sign_name, const String& json_data) {
    String filename = "/data_" + sign_name + "_" + String(millis()) + ".json";
    
    File file = SPIFFS.open(filename, "w");
    if (!file) {
        Serial.println("Error creando archivo en SPIFFS");
        return;
    }
    
    file.print(json_data);
    file.close();
    
    Serial.printf("Datos guardados en: %s\n", filename.c_str());+-
}
