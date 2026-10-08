/*
 * ProvisionToken — one-shot utility that stores VoltSense's secrets in the ESP32's NVS.
 *
 * WHAT GETS STORED (namespace "voltsense")
 *   alert_secret       Shared secret for the alert endpoint — must match VOLTSENSE_ALERT_SECRET
 *                      on the server. Generate one with:  openssl rand -hex 32
 *   dev_email          Firebase Auth email         — device identity, option A
 *   dev_password       Firebase Auth password      — device identity, option A
 *   dev_id_token       Firebase ID token           — device identity, option B (device_mac claim)
 *   dev_refresh_token  Firebase refresh token      — lets the library renew the ID token forever
 *
 * NOTE: this device holds no messaging credential. It POSTs to the VoltSense serverless endpoint,
 * which owns the push keys and decides who to notify. The only thing shared with the server is
 * `alert_secret`. Rotating it means re-running this sketch on each device and updating the
 * environment variable on the server.
 *
 * You only need ONE of the two device-identity options (see docs/device-auth.md):
 *   A. email/password  — create the account in the Firebase Console, then add
 *                        device_uids/<MAC> = "<uid>" in the Console. No service account, no
 *                        Cloud Function, no paid plan.
 *   B. ID + refresh    — `npm run mint-token -- <MAC>`. Also no Cloud Function, but needs a
 *                        service-account key.
 * Send a single dash (-) to skip a field.
 *
 * WHY NVS
 *   NVS is per-device flash that is not part of the firmware image. It survives a re-flash but
 *   never leaves the board, so no secret ends up in the web bundle, in the database, or in a
 *   source file you might commit.
 *
 * USAGE
 *   1. Flash this sketch.
 *   2. Open Serial Monitor at 115200 baud.
 *   3. Paste each value when prompted and press Enter.
 *   4. Flash VoltSense.ino. The values are read from NVS at runtime.
 *
 * Re-running overwrites what is already stored. To erase everything: "Erase Flash" in the IDE.
 *
 * NOTE: Serial input is echoed by your terminal, so the values will be visible on screen. That is
 * fine locally; just don't leave the window open on a shared machine.
 */

#include <Preferences.h>

Preferences preferences;

// Set to true to write the values below directly instead of prompting. Leave false and paste them
// over the serial monitor — that keeps them out of your source tree and out of git.
const bool USE_HARDCODED_VALUES = false;
const char* HARDCODED_ALERT_SECRET = "";
const char* HARDCODED_EMAIL = "";
const char* HARDCODED_PASSWORD = "";
const char* HARDCODED_ID_TOKEN = "";
const char* HARDCODED_REFRESH_TOKEN = "";

const char* NVS_NAMESPACE = "voltsense";

struct Field {
  const char* nvsKey;
  const char* label;
  const char* hint;
};

Field FIELDS[] = {
  { "alert_secret",      "Alert endpoint secret",  "openssl rand -hex 32  — must match VOLTSENSE_ALERT_SECRET" },
  { "dev_email",         "Device account email",   "device-aabbccddeeff@<your-auth-domain>  (option A)" },
  { "dev_password",      "Device account password","the password you set in Console > Authentication" },
  { "dev_id_token",      "Firebase ID token",      "eyJhbGciOiJSUzI1...  (option B, npm run mint-token)" },
  { "dev_refresh_token", "Firebase refresh token", "AMf-vBx...  (option B, npm run mint-token)" }
};
const int FIELD_COUNT = sizeof(FIELDS) / sizeof(FIELDS[0]);

int currentField = 0;

// Returns true if the value was stored (false if skipped).
bool storeValue(const char* nvsKey, const String& raw, const char* label) {
  String value = raw;
  value.trim();

  if (value.length() == 0 || value == "-") {
    Serial.printf("  [-] Skipped %s.\n", label);
    return false;
  }

  preferences.begin(NVS_NAMESPACE, false);
  size_t written = preferences.putString(nvsKey, value);
  // Read back so we never report success on a silent NVS failure.
  String check = preferences.getString(nvsKey, "");
  preferences.end();

  if (written == 0 || check != value) {
    Serial.printf("  [X] FAILED to store %s (NVS may be full or the value too large: %u bytes).\n",
                  label, (unsigned)value.length());
    return false;
  }

  Serial.printf("  [OK] %s stored (%u bytes).\n", label, (unsigned)value.length());
  return true;
}

void printSummary() {
  preferences.begin(NVS_NAMESPACE, true);
  Serial.println("\n--- Stored in NVS (namespace \"" NVS_NAMESPACE "\") ---");
  for (int i = 0; i < FIELD_COUNT; i++) {
    String v = preferences.getString(FIELDS[i].nvsKey, "");
    Serial.printf("  %-20s %s\n", FIELDS[i].nvsKey,
                  v.length() == 0 ? "(empty)" : (String(v.length()) + " bytes").c_str());
  }
  preferences.end();

  Serial.println("\nNow flash VoltSense.ino. Re-flashing does NOT erase NVS.");
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20000); // ID tokens are long; the default 1s read timeout truncates them.
  delay(2000);              // Give the serial monitor time to connect

  Serial.println("\n--- VoltSense NVS Provisioning Tool ---");

  if (USE_HARDCODED_VALUES) {
    storeValue("alert_secret", String(HARDCODED_ALERT_SECRET), FIELDS[0].label);
    storeValue("dev_email", String(HARDCODED_EMAIL), FIELDS[1].label);
    storeValue("dev_password", String(HARDCODED_PASSWORD), FIELDS[2].label);
    storeValue("dev_id_token", String(HARDCODED_ID_TOKEN), FIELDS[3].label);
    storeValue("dev_refresh_token", String(HARDCODED_REFRESH_TOKEN), FIELDS[4].label);
    printSummary();
    currentField = FIELD_COUNT;
    return;
  }

  Serial.println("Paste each value and press Enter. Send a single dash (-) to skip one.");
  Serial.println("For device identity use EITHER email+password OR the two tokens, not both.\n");
  Serial.printf("[1/%d] %s\n      %s\n> ", FIELD_COUNT, FIELDS[0].label, FIELDS[0].hint);
}

void loop() {
  if (currentField >= FIELD_COUNT) {
    delay(1000);
    return;
  }

  if (!Serial.available()) {
    delay(50);
    return;
  }

  String value = Serial.readStringUntil('\n');
  storeValue(FIELDS[currentField].nvsKey, value, FIELDS[currentField].label);
  currentField++;

  if (currentField < FIELD_COUNT) {
    Serial.printf("\n[%d/%d] %s\n      %s\n> ",
                  currentField + 1, FIELD_COUNT,
                  FIELDS[currentField].label, FIELDS[currentField].hint);
  } else {
    printSummary();
  }
}
