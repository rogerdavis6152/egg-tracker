#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_system.h>

#include "SparkFun_Qwiic_Scale_NAU7802_Arduino_Library.h"
#include "secrets.h"

namespace {

constexpr float CALIBRATION_FACTOR = 3018.23f;
constexpr float EGG_PRESENT_GRAMS = 5.0f;
constexpr float SCALE_EMPTY_GRAMS = 2.5f;
constexpr float STABLE_SPREAD_GRAMS = 0.7f;
constexpr uint8_t STABLE_SAMPLE_COUNT = 8;
constexpr unsigned long EMPTY_STABLE_MS = 1000;
constexpr unsigned long POST_RETRY_MS = 4000;

NAU7802 scale;
float readings[STABLE_SAMPLE_COUNT] = {};
uint8_t readingCount = 0;
uint8_t nextReading = 0;
bool armed = false;
bool pendingReading = false;
float pendingWeightGrams = 0.0f;
String pendingEventId;
unsigned long emptySince = 0;
unsigned long lastPostAttempt = 0;
unsigned long lastReconnectAttempt = 0;

String makeEventId() {
  char eventId[40];
  const uint32_t deviceId = static_cast<uint32_t>(ESP.getEfuseMac());
  const uint32_t randomId = esp_random();
  snprintf(eventId, sizeof(eventId), "scale-%08lx-%08lx",
           static_cast<unsigned long>(deviceId),
           static_cast<unsigned long>(randomId));
  return String(eventId);
}

bool connectToWifi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("Wi-Fi is not connected yet; the scale will keep trying.");
  return false;
}

bool postPendingReading() {
  if (!pendingReading || WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure secureClient;
  secureClient.useBuiltinCACertBundle();

  HTTPClient http;
  if (!http.begin(secureClient, SCALE_API_URL)) {
    Serial.println("Could not start the HTTPS request.");
    return false;
  }

  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + SCALE_DEVICE_TOKEN);

  String payload = "{\"event_id\":\"" + pendingEventId +
                   "\",\"weight_grams\":" + String(pendingWeightGrams, 2) + "}";
  const int responseCode = http.POST(payload);
  const String responseBody = http.getString();
  http.end();

  if (responseCode >= 200 && responseCode < 300) {
    Serial.print("Sent ");
    Serial.print(pendingWeightGrams, 2);
    Serial.println(" g to the egg tracker.");
    pendingReading = false;
    pendingEventId = "";
    emptySince = 0;
    return true;
  }

  Serial.print("Scale upload failed (HTTP ");
  Serial.print(responseCode);
  Serial.print("): ");
  Serial.println(responseBody);
  return false;
}

void observeWeight(float weightGrams) {
  if (!armed) {
    if (!pendingReading && weightGrams <= SCALE_EMPTY_GRAMS) {
      if (emptySince == 0) emptySince = millis();
      if (millis() - emptySince >= EMPTY_STABLE_MS) {
        armed = true;
        readingCount = 0;
        nextReading = 0;
        Serial.println("Scale ready. Place one egg on the platform.");
      }
    } else {
      emptySince = 0;
    }
    return;
  }

  if (weightGrams < EGG_PRESENT_GRAMS) {
    readingCount = 0;
    nextReading = 0;
    return;
  }

  readings[nextReading] = weightGrams;
  nextReading = (nextReading + 1) % STABLE_SAMPLE_COUNT;
  if (readingCount < STABLE_SAMPLE_COUNT) readingCount++;
  if (readingCount < STABLE_SAMPLE_COUNT) return;

  float minimum = readings[0];
  float maximum = readings[0];
  float total = 0.0f;
  for (float reading : readings) {
    if (reading < minimum) minimum = reading;
    if (reading > maximum) maximum = reading;
    total += reading;
  }

  if (maximum - minimum > STABLE_SPREAD_GRAMS) return;

  pendingWeightGrams = total / STABLE_SAMPLE_COUNT;
  pendingEventId = makeEventId();
  pendingReading = true;
  armed = false;
  readingCount = 0;
  emptySince = 0;

  Serial.print("Stable egg weight: ");
  Serial.print(pendingWeightGrams, 2);
  Serial.println(" g. Sending…");
}

} // namespace

void setup() {
  Serial.begin(115200);
  delay(500);

  Wire.begin();
  if (!scale.begin()) {
    Serial.println("Scale not detected. Check the Qwiic connection, then reset.");
    while (true) delay(1000);
  }

  scale.setSampleRate(NAU7802_SPS_40);
  scale.calibrateAFE();
  scale.setCalibrationFactor(CALIBRATION_FACTOR);

  Serial.println("Remove everything from the scale; taring now.");
  scale.calculateZeroOffset(64, 3000);
  Serial.print("Calibration factor: ");
  Serial.println(scale.getCalibrationFactor(), 2);
  Serial.print("Zero offset: ");
  Serial.println(scale.getZeroOffset());

  connectToWifi(15000);
  Serial.println("Leave the platform empty until the scale says it is ready.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED && millis() - lastReconnectAttempt > 10000) {
    lastReconnectAttempt = millis();
    connectToWifi(1000);
  }

  if (scale.available()) {
    const float weightGrams = scale.getWeight(true, 8, 1500);
    Serial.print("Weight: ");
    Serial.print(weightGrams, 2);
    Serial.println(" g");
    observeWeight(weightGrams);
  }

  if (pendingReading && millis() - lastPostAttempt >= POST_RETRY_MS) {
    lastPostAttempt = millis();
    postPendingReading();
  }
}
