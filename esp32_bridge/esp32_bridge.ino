#include <WiFi.h>
#include <PubSubClient.h>

// --- Configuration ---
const char* ssid        = "captain tera";
const char* password    = "captaintera1";

// The backend connects to broker.emqx.io, so the ESP32 must too.
const char* mqtt_server = "broker.emqx.io";
const int   mqtt_port   = 1883;
const char* mqtt_id     = "ESP32_WiFi_Bridge_002";

const char* topic_status  = "/device/SAFEBOX_002/status";
const char* topic_command = "/device/SAFEBOX_002/command";

// --- UART2 pins (ESP32 -> STM32) ---
#define RXp2 16   // ESP32 RX2 <- STM32 TX (PB10)
#define TXp2 17   // ESP32 TX2 -> STM32 RX (PB11)

// --- Non-blocking line accumulator for STM32 telemetry ---
static char   stm_line[256];
static uint16_t stm_idx = 0;

// --- Objects ---
WiFiClient   espClient;
PubSubClient mqtt(espClient);

/* =====================================================================
 * MQTT callback — fires when LOCK/UNLOCK arrives from the dashboard.
 * Just write directly to Serial2; no blocking involved.
 * ===================================================================== */
void mqtt_callback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    Serial.print("MQTT Received: ");
    Serial.println(msg);

    if (msg.indexOf("UNLOCK") >= 0) {
        Serial2.print("UNLOCK\n");
        Serial.println("-> Sent UNLOCK to STM32");
    } else if (msg.indexOf("LOCK") >= 0) {
        Serial2.print("LOCK\n");
        Serial.println("-> Sent LOCK to STM32");
    }
}

/* =====================================================================
 * Non-blocking telemetry reader.
 * Accumulates bytes from Serial2 one at a time; publishes only when
 * a complete '\n'-terminated line of valid JSON arrives.
 * This never blocks, so mqtt.loop() and MQTT callbacks are never delayed.
 * ===================================================================== */
void processSTM32Stream() {
    while (Serial2.available()) {
        char c = (char)Serial2.read();

        if (c == '\n' || stm_idx >= sizeof(stm_line) - 1) {
            stm_line[stm_idx] = '\0';

            // Only forward lines that look like JSON (start with '{')
            if (stm_idx > 0 && stm_line[0] == '{') {
                Serial.print("Received from STM32: ");
                Serial.println(stm_line);
                mqtt.publish(topic_status, stm_line);
            }
            // silently discard garbage / partial lines
            stm_idx = 0;
        } else if (c != '\r') {
            stm_line[stm_idx++] = c;
        }
    }
}

/* =====================================================================
 * WiFi + MQTT helpers
 * ===================================================================== */
void setup_wifi() {
    delay(10);
    Serial.print("Connecting to ");
    Serial.println(ssid);
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi connected — IP: ");
    Serial.println(WiFi.localIP());
}

void reconnect() {
    while (!mqtt.connected()) {
        Serial.print("Attempting MQTT connection...");
        if (mqtt.connect(mqtt_id)) {
            Serial.println("connected");
            mqtt.subscribe(topic_command);
        } else {
            Serial.print("failed, rc=");
            Serial.print(mqtt.state());
            Serial.println(" try again in 5 seconds");
            delay(5000);
        }
    }
}

/* =====================================================================
 * Setup / Loop
 * ===================================================================== */
void setup() {
    Serial.begin(115200);
    Serial2.begin(115200, SERIAL_8N1, RXp2, TXp2);

    setup_wifi();
    mqtt.setServer(mqtt_server, mqtt_port);
    mqtt.setCallback(mqtt_callback);
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) setup_wifi();
    if (!mqtt.connected()) reconnect();
    mqtt.loop();               // handles incoming MQTT messages
    processSTM32Stream();      // non-blocking: drains Serial2 byte by byte
}
