#include <SoftwareSerial.h>
#include <TinyGPS++.h>
#include <PubSubClient.h>
#include <RCSwitch.h>

// --- CONFIGURATION ---
const char* APN = "internet"; // CHANGE THIS to your SIM card's APN
const char* MQTT_SERVER = "192.168.1.100"; // CHANGE THIS to your Laptop's IP Address
const int MQTT_PORT = 1883;
const char* DEVICE_ID = "SAFEBOX_001"; // Unique ID for this device

// --- PINS ---
#define GSM_RX_PIN 2
#define GSM_TX_PIN 3
#define GPS_RX_PIN 4
#define GPS_TX_PIN 5
#define RF_PIN 6
#define RELAY_PIN 7

// --- OBJECTS ---
SoftwareSerial gsmSerial(GSM_RX_PIN, GSM_TX_PIN);
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;
RCSwitch mySwitch = RCSwitch();

// --- MQTT ---
// We need a client that can talk over Serial (AT commands). 
// For simplicity in this prototype, we will implement a basic AT command handler 
// or use a library like TinyGSM. 
// HOWEVER, standard PubSubClient requires a Client object (Ethernet/WiFi).
// Since we are using raw AT commands with SIM800, we'll use TinyGSM if possible, 
// or write a simple AT wrapper. 
// For this specific user request, let's use the TinyGSM library which is standard for this.

#define TINY_GSM_MODEM_SIM800 // Define modem type
#include <TinyGsmClient.h>

TinyGsm modem(gsmSerial);
TinyGsmClient client(modem);
PubSubClient mqtt(client);

#include <EEPROM.h>

// ... (Keep existing includes and config)

// --- VARIABLES ---
long lastMsg = 0;
bool cloudLocked = false; // Theft Mode (High Priority)
bool isLocked = true;     // Physical State (Engine Cut)
unsigned long lastGpsUpdate = 0;

void setup() {
  // ... (Keep existing setup code) ...
  
  // Load Cloud Lock state from EEPROM
  EEPROM.begin(512); // For ESP32/8266, usually ignored on AVR but good practice
  cloudLocked = EEPROM.read(0) == 1;
  isLocked = cloudLocked; // If cloud locked, force physical lock
  
  updateRelay();

  // ... (Keep existing setup code) ...
}

void loop() {
  // ... (Keep existing loop code) ...

  // 4. Check RF Remote
  if (mySwitch.available()) {
    long value = mySwitch.getReceivedValue();
    if (value != 0) {
      Serial.print("RF Received: "); Serial.println(value);
      
      // CLOUD PRIORITY LOGIC
      if (cloudLocked) {
        Serial.println("ACTION BLOCKED: Vehicle is Cloud Locked!");
        // Optional: Flash LED or beep to indicate denial
      } else {
        // Normal Operation
        isLocked = !isLocked;
        updateRelay();
        sendState(); 
      }
    }
    mySwitch.resetAvailable();
  }
}

void updateRelay() {
  if (isLocked) {
    digitalWrite(RELAY_PIN, LOW); 
    Serial.println("Vehicle LOCKED (Engine Cut)");
  } else {
    digitalWrite(RELAY_PIN, HIGH); 
    Serial.println("Vehicle UNLOCKED (Engine Active)");
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("Message arrived ["); Serial.print(topic); Serial.print("]: "); Serial.println(message);

  if (String(topic).endsWith("/command")) {
    if (message == "LOCK") {
      cloudLocked = true;
      isLocked = true;
      EEPROM.write(0, 1); // Persist Cloud Lock
    } else if (message == "UNLOCK") {
      cloudLocked = false;
      isLocked = false; // Unlock immediately? Or just allow remote? Usually unlock.
      EEPROM.write(0, 0); // Clear Cloud Lock
    }
    // EEPROM.commit(); // Needed for ESP32, not Arduino Nano
    updateRelay();
    sendState();
  }
}

// ... (Keep existing reconnect/sendTelemetry functions) ...

void sendState() {
  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"is_locked\":" + String(isLocked ? 1 : 0) + ",";
  payload += "\"cloud_lock\":" + String(cloudLocked ? 1 : 0); // Report both states
  payload += "}";
  mqtt.publish("vehicle/status", payload.c_str());
}
