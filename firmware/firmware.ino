#define TINY_GSM_MODEM_SIM800
#include <EEPROM.h>
#include <PubSubClient.h>
#include <RCSwitch.h>
#include <TinyGPS++.h>
#include <TinyGsmClient.h>

// --- CONFIGURATION ---
// Cellular Settings
const char apn[]      = "internet"; // Standard default APN
const char gprsUser[] = "";
const char gprsPass[] = "";

// MQTT Settings
const char *MQTT_SERVER = "broker.emqx.io";
const int MQTT_PORT = 1883;
const char *DEVICE_ID = "SAFEBOX_001";

// Topics
const char *TOPIC_STATUS = "/device/SAFEBOX_001/status";
const char *TOPIC_COMMAND = "/device/SAFEBOX_001/command";

// --- PINS (ESP32) ---
#define RELAY_PIN 27 // GPIO 27 (Updated from 26)
#define RF_PIN 4     // GPIO 4 (Receiver Data)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define MODEM_TX_PIN 25 // GPIO 25 (SIM800L RXD)
#define MODEM_RX_PIN 26 // GPIO 26 (SIM800L TXD)
#define IGN_SENSE_PIN 34 // GPIO 34 (Ignition Sense)

// Debounce for RF remote (ms)
unsigned long lastRFTime = 0;
const unsigned long RF_DEBOUNCE_MS = 500;

// Config Cache
char authorizedPhone[20] = "+250788123456"; // Synced from User Settings
char safetyPasscode[8] = "1234";           // Backup PIN for SMS LOCK/UNLOCK

// --- OBJECTS ---
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClient client(modem);
PubSubClient mqtt(client);

TinyGPSPlus gps;
HardwareSerial gpsSerial(2); // Use UART2 for GPS
RCSwitch mySwitch = RCSwitch();

// --- VARIABLES ---
unsigned long lastLoopTime = 0;
unsigned long lastSMSCheck = 0;

// State
bool cloudLocked = false;
bool isLocked = true;
float fuelLevel = 100.0;
float batteryLevel = 100.0;

// GPS Data
double currentLat = -1.9357331; // Updated location
double currentLng = 30.1578407;
double currentSpeed = 0.0;

void writeStringToEEPROM(int addr, const char* str, int maxLen) {
  for (int i = 0; i < maxLen; i++) {
    EEPROM.write(addr + i, str[i]);
    if (str[i] == '\0') break;
  }
  EEPROM.commit();
}

void readStringFromEEPROM(int addr, char* buffer, int maxLen) {
  for (int i = 0; i < maxLen - 1; i++) {
    char c = EEPROM.read(addr + i);
    if (c == 0xFF || c == '\0') {
      buffer[i] = '\0';
      break;
    }
    buffer[i] = c;
  }
  buffer[maxLen - 1] = '\0';
}

void setupCellular(); // Forward declaration

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n--- SAFEBOX ESP32 FIRMWARE ---");

  // EEPROM
  EEPROM.begin(512); // ESP32 needs size
  cloudLocked = EEPROM.read(0) == 1;
  if (cloudLocked)
    isLocked = true;

  // Initialize configurations from EEPROM or write defaults if empty
  if (EEPROM.read(10) == 0xFF || EEPROM.read(10) == 0) {
    writeStringToEEPROM(10, "+250788123456", 20);
    writeStringToEEPROM(40, "1234", 8);
  }

  readStringFromEEPROM(10, authorizedPhone, 20);
  readStringFromEEPROM(40, safetyPasscode, 8);

  Serial.print("Authorized Phone: ");
  Serial.println(authorizedPhone);
  Serial.print("SMS Passcode: ");
  Serial.println(safetyPasscode);

  // Pins
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(RF_PIN, INPUT); // Ensure Pin 4 is an input
  pinMode(IGN_SENSE_PIN, INPUT); // Ensure Pin 34 is an input for Ignition Sense
  updateRelay();

  // RF Setup
  mySwitch.enableReceive(digitalPinToInterrupt(RF_PIN));
  Serial.print("RF Receiver enabled on GPIO ");
  Serial.print(RF_PIN);
  Serial.println(" (Interrupt-based)");
  Serial.println("Waiting for RF signals...");

  // GPS Setup
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS Initialized on UART2");

  // Cellular Setup
  setupCellular();

  // MQTT Setup
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);

  Serial.println("=== SETUP COMPLETE ===");
  Serial.println("System Ready!");
}

void checkSMS(); // Forward declaration

void loop() {
  // --- IGNITION STATE CHECK ---
  static int lastIgnState = -1;
  int currentIgnState = digitalRead(IGN_SENSE_PIN);
  if (lastIgnState == -1) {
    lastIgnState = currentIgnState;
  }
  // Detect transition from HIGH to LOW (Ignition turned OFF)
  if (lastIgnState == HIGH && currentIgnState == LOW) {
    Serial.println("IGNITION TRANSITION: ON -> OFF. Auto-locking engine...");
    isLocked = true;
    updateRelay();
    sendState();
  }
  lastIgnState = currentIgnState;

  // --- SERIAL BYPASS ---
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'u') {
      Serial.println("SERIAL BYPASS: Force Unlocking...");
      isLocked = false;
      cloudLocked = false;
      updateRelay();
      sendState();
    }
  }

  // 1. Cellular & MQTT Connection
  if (!modem.isNetworkConnected() || !modem.isGprsConnected()) {
    setupCellular();
  }
  if (!mqtt.connected()) {
    reconnect();
  }
  mqtt.loop();

  // 1b. Check SMS periodically
  if (millis() - lastSMSCheck > 5000) {
    lastSMSCheck = millis();
    checkSMS();
  }

  // 2. RF Handling
  static int pulseCount = 0;
  static int lastState = -1;
  static unsigned long lastPulseWindow = 0;
  static int pulsesInWindow = 0;

  int currentState = digitalRead(RF_PIN);
  if (currentState != lastState) {
    pulseCount++;
    pulsesInWindow++;
    lastState = currentState;
  }

  // Check pulse window every 200ms
  if (millis() - lastPulseWindow > 200) {
    if (pulsesInWindow > 15) { // Burst detected!
      Serial.print("\n>>> SIGNAL BURST DETECTED (");
      Serial.print(pulsesInWindow);
      Serial.println(" pulses) <<<");

      if (!cloudLocked && isLocked) {
        Serial.println("PULSE UNLOCK AUTHORIZED!");
        handleRF(12345);
      } else if (cloudLocked) {
        Serial.println("PULSE BLOCKED: Web Lock is Active");
      }
    }
    pulsesInWindow = 0;
    lastPulseWindow = millis();
  }

  if (mySwitch.available()) {
    long value = mySwitch.getReceivedValue();
    Serial.print("SUCCESS: Protocol Matched! Value: ");
    Serial.println(value);

    if (value != 0) {
      handleRF(value);
    }
    mySwitch.resetAvailable();
  }

  // 3. GPS Reading (Non-blocking)
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 4. Periodic Updates (Every 2 seconds)
  if (millis() - lastLoopTime > 2000) {
    lastLoopTime = millis();

    // GPS Update
    if (millis() > 5000 && gps.charsProcessed() < 10) {
      Serial.println(
          "WARNING: No GPS data received. Check BN-220 TX/RX wiring.");
    } else if (!gps.location.isValid()) {
      Serial.println("BN-220 connected, waiting for satellite fix (needs clear "
                     "view of sky)...");
    } else {
      currentLat = gps.location.lat();
      currentLng = gps.location.lng();
      currentSpeed = gps.speed.kmph();
      Serial.print("BN-220 GPS Fix! Lat: ");
      Serial.print(currentLat, 6);
      Serial.print(" Lng: ");
      Serial.println(currentLng, 6);
    }

    // RF Status Check (for debugging)
    static int rfCheckCounter = 0;
    rfCheckCounter++;
    if (rfCheckCounter % 15 == 0) { // Every 30 seconds
      Serial.println("--- System Status ---");
      Serial.print("isLocked: ");
      Serial.println(isLocked ? "YES (Engine CUT)" : "NO (Engine RUN)");
      Serial.print("cloudLocked: ");
      Serial.println(cloudLocked ? "YES (Web Locked)" : "NO (Web Allowed)");
      Serial.print("RF Pin 4 Pulses: ");
      Serial.println(pulseCount);
      if (!cloudLocked && isLocked) {
        Serial.println(">>> WAITING FOR RF REMOTE SIGNAL TO START ENGINE <<<");
      }
      Serial.println("---------------------");
    }

    simulateVehicle();
    sendState();
  }
}

void setupCellular() {
  delay(10);
  Serial.println("\nInitializing SIM800L modem...");
  SerialAT.begin(9600, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(3000);

  if (!modem.restart()) {
    Serial.println("Failed to restart modem. check connection/power");
    return;
  }
  
  String modemInfo = modem.getModemInfo();
  Serial.print("Modem Info: ");
  Serial.println(modemInfo);

  Serial.print("Waiting for network...");
  if (!modem.waitForNetwork()) {
    Serial.println(" fail");
    delay(5000);
    return;
  }
  Serial.println(" success");

  Serial.print("Connecting to GPRS (APN: ");
  Serial.print(apn);
  Serial.print(")...");
  if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
    Serial.println(" fail");
    delay(5000);
    return;
  }
  Serial.println(" success");
}

void checkSMS() {
  char senderNumber[32];
  char smsBuffer[128];
  
  // SIM800L stores incoming SMS. We poll index slot 1.
  if (modem.getSMS(1, senderNumber, smsBuffer)) {
    Serial.print("INCOMING SMS FROM: ");
    Serial.println(senderNumber);
    Serial.print("BODY: ");
    Serial.println(smsBuffer);

    String msg = String(smsBuffer);
    msg.trim();
    
    String deviceStr = String(DEVICE_ID);
    if (msg.startsWith(deviceStr)) {
      int firstSpace = msg.indexOf(' ');
      int secondSpace = msg.indexOf(' ', firstSpace + 1);
      
      if (firstSpace > 0 && secondSpace > 0) {
        String cmd = msg.substring(firstSpace + 1, secondSpace);
        String code = msg.substring(secondSpace + 1);
        cmd.toUpperCase();
        cmd.trim();
        code.trim();

        // Perform signature/passcode verification
        bool phoneMatched = (String(senderNumber).indexOf(authorizedPhone) >= 0);
        bool codeMatched = (code == String(safetyPasscode));

        if (phoneMatched && codeMatched) {
          Serial.println("SMS Command Verified & Executed!");
          if (cmd == "LOCK") {
            cloudLocked = true;
            isLocked = true;
            EEPROM.write(0, 1);
            EEPROM.commit();
            updateRelay();
            sendState();
            modem.sendSMS(senderNumber, "SafeBox Alert: Engine locked successfully via SMS command.");
          } else if (cmd == "UNLOCK") {
            cloudLocked = false;
            EEPROM.write(0, 0);
            EEPROM.commit();
            // Do NOT change isLocked to false here! The driver must press the remote to unlock it.
            sendState();
            modem.sendSMS(senderNumber, "SafeBox Alert: Cloud lock disabled via SMS command. Use remote to start.");
          }
        } else {
          Serial.println("SMS REJECTED: Authentication Failure");
        }
      }
    }
    // Delete SMS from slot 1 to clear space for the next message
    modem.deleteSMS(1);
  }
}

void handleRF(long value) {
  Serial.print("RAW RF RECEIVED: ");
  Serial.println(value); // DEBUG

  if (cloudLocked) {
    Serial.println("DENIED: Cloud Lock Active");
    return;
  }

  // Remote press should only UNLOCK (turn relay on)
  // Logic: If vehicle is OFF (locked), remote turns it ON (unlocked).
  // If already ON, remote does nothing (or could toggle, but user asked for
  // energize)
  if (isLocked) {
    isLocked = false; // unlock
    Serial.println("RF Action -> New Locked State: false (UNLOCKED)");
    updateRelay();
    sendState();
  } else {
    Serial.println("RF Action ignored: already UNLOCKED");
  }
}

void updateRelay() {
  if (isLocked) {
    digitalWrite(RELAY_PIN, LOW); // Engine Cut
    Serial.println("RELAY (Pin 27): LOW (Engine CUT)");
  } else {
    digitalWrite(RELAY_PIN, HIGH); // Engine Run
    Serial.println("RELAY (Pin 27): HIGH (Engine RUN)");
  }
}

void simulateVehicle() {
  if (!isLocked && currentSpeed > 0)
    fuelLevel -= 0.1;
  if (fuelLevel < 5.0)
    fuelLevel = 100.0;
  batteryLevel -= 0.05;
  if (batteryLevel < 10.0)
    batteryLevel = 100.0;
}

void sendState() {
  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"lat\":" + String(currentLat, 6) + ",";
  payload += "\"lng\":" + String(currentLng, 6) + ",";
  payload += "\"speed\":" + String(currentSpeed) + ",";
  payload += "\"locked\":" + String(isLocked ? "true" : "false") + ",";
  payload += "\"cloudLocked\":" + String(cloudLocked ? "true" : "false") + ",";
  payload += "\"battery\":" + String((int)batteryLevel) + ",";
  payload += "\"fuel\":" + String((int)fuelLevel);
  payload += "}";

  // Serial.println(payload); // Optional debug
  mqtt.publish(TOPIC_STATUS, payload.c_str());
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++)
    message += (char)payload[i];
  Serial.print("MQTT CMD: ");
  Serial.println(message);

  if (message.startsWith("CONFIG_PHONE:")) {
    String newPhone = message.substring(13);
    newPhone.trim();
    writeStringToEEPROM(10, newPhone.c_str(), 20);
    readStringFromEEPROM(10, authorizedPhone, 20);
    Serial.print("Synced Phone: ");
    Serial.println(authorizedPhone);
  } else if (message.startsWith("CONFIG_PASSCODE:")) {
    String newPass = message.substring(16);
    newPass.trim();
    writeStringToEEPROM(40, newPass.c_str(), 8);
    readStringFromEEPROM(40, safetyPasscode, 8);
    Serial.print("Synced Passcode: ");
    Serial.println(safetyPasscode);
  } else if (message.indexOf("LOCK") >= 0 && message.indexOf("UNLOCK") == -1) {
    cloudLocked = true;
    isLocked = true;
    EEPROM.write(0, 1);
    EEPROM.commit();
    updateRelay();
  } else if (message.indexOf("UNLOCK") >= 0) {
    cloudLocked = false;
    EEPROM.write(0, 0);
    EEPROM.commit();
    // Do NOT change isLocked to false here! The driver must press the remote to unlock it.
  }
  sendState();
}

void reconnect() {
  while (!mqtt.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "SafeBoxESP32-";
    clientId += String(random(0xffff), HEX);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected");
      mqtt.subscribe(TOPIC_COMMAND);
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqtt.state());
      Serial.println(" try again in 5s");
      delay(5000);
    }
  }
}
