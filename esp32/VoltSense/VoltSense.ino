/*
 * VoltSense — ESP32 firmware
 *
 * Responsibilities:
 *   1. Occupancy sensing — a dual-sensor module: HC-SR501 PIR (gross motion) fused with an mmWave
 *      radar (stillness, e.g. breathing) — and the idle -> response-window -> shutdown state
 *      machine. The radar pin is configured here (MMWAVE_PIN) and provisioned by the app; the read
 *      is enabled with HAS_MMWAVE when the radar is physically fitted. See the pin block.
 *   2. Per-port current sensing (ACS712) and telemetry push to Firebase RTDB.
 *   3. Energy rollups written to /devices/<MAC>/history/*  (consumed by the Analytics page).
 *   4. Alert delivery. This device does NOT hold any messaging credential. It POSTs a short JSON
 *      payload to the VoltSense serverless endpoint, which owns the push credentials and decides
 *      who to notify. The only secret on the device is a string (`alert_secret` in NVS) that the
 *      endpoint checks. When the device self-provisions, the server mints this value and stores
 *      only a SHA-256 of it, so the plaintext exists on the device and nowhere else.
 *
 *   5. Device identity. Three options:
 *        A. SELF-PROVISIONING (recommended for more than a couple of units). Compile in
 *           VOLTSENSE_PAIRING_KEY and the device pairs itself on first boot: the server mints its
 *           credentials and returns a short code the user types into the app. No USB, no Console.
 *        B. email/password account (Console-created) + a `device_uids` allow-list node, written by
 *           ProvisionToken.ino over USB. Always wins over (A) when present.
 *        C. custom token carrying a `device_mac` claim (minted locally by `npm run mint-token`).
 *      Set one up or the database rules will reject every write. See docs/device-auth.md.
 *
 *   6. Liveness. The task watchdog (WDT_TIMEOUT_SECONDS) bounds the main loop, so a hang inside the
 *      Firebase or HTTP libraries resets the device instead of freezing it in place. Safe because
 *      relay state is NVS-persisted and restored on boot. See the watchdog section.
 *
 *   7. Soft overcurrent cutoff. A per-port sustained-overload trip that opens the relay and alerts.
 *      This is a SECOND line of defence and NOT a fuse — the current sensor saturates at 5 A, so a
 *      fault beyond that is invisible to it, and a relay can weld closed. Real protection needs a
 *      physical fuse or MCB. See the overcurrent section before relying on it.
 *
 * SECURITY NOTE — TLS:
 *   The alert endpoint is served by Vercel, whose certificate chains to Let's Encrypt's
 *   "ISRG Root X1". That root is pinned below rather than calling setInsecure(), so a MITM cannot
 *   capture the shared secret. If the handshake ever fails, re-verify the chain with:
 *     openssl s_client -connect <host>:443 -servername <host> -showcerts
 *   Because a rotation would otherwise be indistinguishable from "no network", the firmware runs a
 *   classified connectivity self-test at boot (runConnectivitySelfTest) that names a TLS failure
 *   explicitly on the serial console.
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <NTPClient.h>
#include <WiFiUdp.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"
#include <Preferences.h>
#include <esp_task_wdt.h>

// Types named in function SIGNATURES live in a header, not in this file. The Arduino build inserts
// generated prototypes near the top of the sketch — above any type this file defines — so a
// signature type declared below fails with "does not name a type". See the header for the details.
#include "VoltSenseTypes.h"

#define API_KEY "AIzaSyBeTz-ZTkrVrq9k92HJ1ttvZb806voxpnM"
#define DATABASE_URL "voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app"

// ---------------------------------------------------------------------------
// Hardware bill of materials (the build this firmware is calibrated for)
// ---------------------------------------------------------------------------
//   * ESP32 dev board
//   * HC-SR501 PIR motion sensor ........... occupancy input  (PIR_PIN)
//   * mmWave radar presence sensor ......... occupancy input  (MMWAVE_PIN) — supported, see below
//   * 3-channel relay module ............... switches the three outlets
//   * 3x ACS712 current sensor ............ one per outlet (5 A variant)
//   * 5 V regulated DC supply
//   * AC voltage sensor (ZMPT101B or similar) — OPTIONAL, see HAS_VOLTAGE_SENSE below. When fitted,
//     the firmware measures real power (W) and power factor instead of estimating apparent power.
//
// The ACS712 measures current only. With no voltage channel fitted, every voltage figure is a
// configured value, not a reading — see the voltage section below.
// The mmWave radar is a first-class part of the design (the thesis specifies a dual PIR + mmWave
// occupancy module) and the firmware reads it when compiled with HAS_MMWAVE; the read ships
// commented out because the written bill of materials lists only the PIR. Read its pin/section
// comment before enabling — a floating ADC/GPIO that is read unconditionally fakes permanent
// occupancy.
// ---------------------------------------------------------------------------

// Define Hardware Pins
const int NUM_PORTS = 3;
const int RELAY_PINS[NUM_PORTS] = {23, 21, 19};

// ---------------------------------------------------------------------------
// Relay polarity — CONFIRMED ACTIVE-LOW on the fitted modules
// ---------------------------------------------------------------------------
// Pulling the pin LOW energises the coil. The level is recorded HERE and nowhere else; everything
// that touches a relay pin goes through relayWritePin() / relayIsOn() below.
//
// This is safety-critical, not a cosmetic setting. Both protection paths REMOVE power by OPENING the
// relay — the 4.5 A overcurrent cutoff and the occupancy shutdown — so an inverted level does not
// merely display the wrong state: it ENERGISES a port on a fault instead of cutting it, and it makes
// relay_status lie to the app in BOTH directions. The firmware previously assumed HIGH = energised
// in ten separate places, which is exactly why the answer is now kept in one.
static const uint8_t RELAY_ON_LEVEL = LOW;
static const uint8_t RELAY_OFF_LEVEL = HIGH;

// The ONLY place a relay pin is written.
static inline void relayWritePin(int port, bool on) {
  digitalWrite(RELAY_PINS[port], on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}

// The ONLY place a relay pin is read. Normalised to "the port is energised", so callers never
// reason about pin levels.
static inline bool relayIsOn(int port) {
  return digitalRead(RELAY_PINS[port]) == RELAY_ON_LEVEL;
}
// ADC1 ONLY. GPIO 32-35 are ADC1; GPIO 0/2/4/12-15/25-27 are ADC2, and ADC2 is unusable while Wi-Fi
// is up (analogRead returns 0). Wi-Fi is always up in this device, so an ADC2 current pin would
// read a permanent 0 A and every port would look unloaded. Do not move these to ADC2 pins.
const int CURRENT_SENSOR_PINS[NUM_PORTS] = {34, 35, 32};

#define PIR_PIN 22

// mmWave radar presence sensor (digital OUT). Declared at file scope so the pin is part of the
// configured build even while the read is compiled out, and so it is checked for collisions with
// the relay / PIR / ADC1 pins like every other pin. GPIO 4 is ADC2, but the radar drives it as a
// plain digital input, so the ADC2/Wi-Fi limitation above does not apply. Enabling the read is the
// only extra step: see HAS_MMWAVE in the mmWave section below.
#define MMWAVE_PIN 4

// Voltage-sense channel (ZMPT101B or equivalent). ANALOG, so it MUST be an ADC1 pin for the same
// reason the current sensors are: ADC2 is dead while Wi-Fi is up, and a dead voltage channel would
// read 0 V — which is worse than no sensor, because 0 V x any current is 0 W and every port would
// silently report no load.
//
// ADC1 is GPIO 32-39. The current sensors already take 34, 35 and 32, leaving 33, 36 and 39.
// GPIO 33 is the default (a normal I/O); 36 and 39 work too but are input-only with no pull-ups.
// Checked against the other pins: 33 collides with nothing (relays 23/21/19, PIR 22, mmWave 4).
#define VOLTAGE_SENSE_PIN 33

// ---------------------------------------------------------------------------
// HC-SR501 PIR — the primary occupancy sensor, and its two traps
// ---------------------------------------------------------------------------
// Wiring: VCC to the 5 V rail (the sensor needs 5 V; it will not run reliably at 3.3 V), GND to
// common ground, OUT to PIR_PIN. The OUT pin swings to ~3.3 V, which the ESP32 reads safely. The
// ESP32 and the PIR MUST share a ground or the digital output is meaningless.
//
// Two on-board potentiometers change how the whole state machine behaves, and neither is visible
// from the software side:
//
//   * Sx (sensitivity / range) — 3 m to 7 m. Too high and it triggers through walls or on warm
//     air currents; too low and it misses someone entering the far side of the room.
//   * Tx (time delay) — how long OUT STAYS HIGH after the last motion, ~0.3 s to ~5 minutes.
//
// THIS MATTERS because the firmware's idle timeout is measured from the last HIGH edge. If Tx is set
// LONGER than the configured inactivity limit, OUT can still be high from the previous detection
// when the countdown expires, so the room never goes quiet and the shutdown is delayed by the whole
// delay window. **Set Tx well below the 15-minute default** (a few seconds to ~1 minute is right for
// occupancy), and leave the unit in "H" (repeat-trigger) mode, not "L" (single-shot), so continued
// movement keeps refreshing the signal.
//
// The `delay()`-style Tx means a single edge can mask several seconds of stillness; the firmware
// treats the raw pin as ground truth, so this is a tuning concern, not a bug.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// mmWave radar — the second half of the occupancy module
//
// VoltSense is specified as a DUAL-sensor occupancy module: the HC-SR501 PIR detects gross motion,
// and an mmWave radar (e.g. LD2410) detects presence including near-stillness — a person sitting
// still, reading, or asleep is invisible to a PIR, so the room can be shut down around them. The
// firmware ORs both sensors into `motionDetected`, so EITHER sensor registering presence keeps the
// room occupied. That fusion is the point of the design and is asserted by the harness.
//
// MMWAVE_PIN is declared with the other pins above. The READ, however, is compile-gated, and the
// gate SHIPS CLOSED (HAS_MMWAVE commented out). Why: reading a pin that is not physically driven
// leaves it FLOATING, and a floating ESP32 input reads induced noise — frequently HIGH. Because
// `motionDetected` is an OR, one noisy radar pin pins the device permanently "occupied"; the idle
// countdown never completes and the smart shutdown never fires. The feature would look alive while
// doing nothing. So only read the pin when the radar is actually wired.
//
// TO ENABLE: wire the radar's digital OUT to MMWAVE_PIN (GPIO 4 by default), share ground with the
// ESP32, then uncomment the line below and reflash. The OR-with-PIR logic needs no other change.
// The app also lets you switch the radar on/off at runtime and change its pin; that preference is
// stored in RTDB — see the occupancy handling in loop().
// ---------------------------------------------------------------------------
// mmwaveEnabled is now a runtime setting synced from Firebase.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC voltage sensing — what it buys, and why the gate ships CLOSED
// ---------------------------------------------------------------------------
// Fitting a voltage channel (ZMPT101B or equivalent) changes the power maths from an ESTIMATE to a
// MEASUREMENT, and the difference is not cosmetic:
//
//   Without it:  power = I_rms x (configured voltage)          -> APPARENT power (VA)
//   With it:     power = mean(v(t) x i(t)) over whole cycles   -> REAL power (W)
//
// The second form is what a true energy meter computes. It captures the phase relationship between
// voltage and current, so a switch-mode load at 0.6 power factor reports ~40 % LESS than the
// apparent figure. That is not a correction to be applied afterwards — it is only obtainable by
// multiplying the two waveforms sample-by-sample. Multiplying two RMS values cannot do it, because
// RMS throws away the sign that carries the phase information.
//
// The gate ships CLOSED for the same reason HAS_MMWAVE does: an unwired ADC pin FLOATS, and a
// floating ESP32 input reads noise. Here the failure is worse than the radar's, because the noise
// is fed straight into a voltage figure and then multiplied by every current reading. The device
// would report confident, plausible, entirely fictional wattages. A wrong number that looks right
// is the most dangerous kind of wrong. Only read the pin when the sensor is actually wired.
//
// TO ENABLE:
//   1. Wire the sensor output to VOLTAGE_SENSE_PIN, share ground with the ESP32, and make sure the
//      output is scaled into 0-3.3 V (see the hardware notes at the sensor section below — the
//      common ZMPT101B module can swing past 3.3 V and will damage the pin).
//   2. CALIBRATE. The module's scaling is set by an on-board potentiometer and is not a calibrated
//      measurement. Measure the real mains voltage with a multimeter, read what the device reports,
//      and set `settings/voltage_cal_mv_per_v` (or the default below) so they agree.
//   3. Uncomment the line below and reflash.
//
// Until step 3, every code path behaves exactly as it did before this section existed.
// ---------------------------------------------------------------------------
// #define HAS_VOLTAGE_SENSE       // uncomment ONLY when the sensor is physically wired AND calibrated
#ifdef HAS_VOLTAGE_SENSE
  // The pin itself is defined at file scope above; nothing to redeclare here.
#endif

// NOTE: there is no FirebaseData / FirebaseAuth / FirebaseConfig here any more. The Realtime
// Database is reached over REST (see that section), so those library objects would be written and
// never read. FirebaseJson is still used, purely to BUILD payloads -- it is a JSON helper with no
// transport in it.

// NTP Time Sync
WiFiUDP ntpUDP;
const long UTC_OFFSET_SECONDS = 28800; // UTC+8
NTPClient timeClient(ntpUDP, "pool.ntp.org", UTC_OFFSET_SECONDS, 60000);

// State Machine Definitions
// `enum SystemState` is declared in VoltSenseTypes.h — `stateToString(SystemState)` takes one, so it
// appears in a signature and must be visible above the prototypes the Arduino build generates.

SystemState currentState = STATE_OCCUPIED;
SystemState previousState = STATE_OCCUPIED;

unsigned long sendDataPrevMillis = 0;
unsigned long lastMotionMillis = 0;
unsigned long responseWindowStartMillis = 0;
unsigned long lastHistoryPublishMillis = 0;
unsigned long lastEnergyPersistMillis = 0;
unsigned long lastHourSeen = 0;

// Timers (idleTimeoutMs is overridable at runtime from settings/inactivity_limit_minutes)
const unsigned long DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000UL; // 15 minutes
unsigned long idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
const unsigned long RESPONSE_WINDOW_MS = 300 * 1000UL; // 5 minutes
const unsigned long HISTORY_PUBLISH_MS = 5 * 60 * 1000UL;
const unsigned long ENERGY_PERSIST_MS = 5 * 60 * 1000UL;
// ---------------------------------------------------------------------------
// Voltage — CONFIGURED, or MEASURED when a sensor is fitted
// ---------------------------------------------------------------------------
// TWO MODES, and the device always says which one it is in (see `voltage_source` in the telemetry).
//
// MODE A — no voltage sensor (HAS_VOLTAGE_SENSE off, the default).
//   THE ACS712 CANNOT MEASURE VOLTAGE. It is a Hall-effect CURRENT sensor with an analogue output
//   proportional to current only. The written bill of materials describes monitoring "current,
//   voltage, and power (V, A, W, kWh)", which an ACS712 alone cannot deliver — so in this mode every
//   voltage figure is the value configured below, never a reading.
//
//   The consequence, stated plainly: `currentA_rms * voltage` is APPARENT power (VA), not real
//   power (W). The two are equal only for a purely resistive load at unity power factor. A laptop
//   brick or switched-mode supply can sit at 0.5-0.7 PF, so the real draw is materially LOWER than
//   the number computed here — typically 30-50 % lower for exactly the electronics this device is
//   built to monitor. The UI labels the figure as apparent power and the kWh totals are not
//   billing-grade. This is a hardware limitation, not a firmware bug.
//
// MODE B — voltage sensor fitted and HAS_VOLTAGE_SENSE enabled.
//   Real power is computed as `mean(v(t) * i(t))` over whole mains cycles — the same method a true
//   energy meter uses. That is NOT the same as `V_rms * I_rms`; the sample-by-sample product is
//   what captures the phase relationship, and therefore what turns VA into W. Power factor then
//   falls out as `W / VA`, measured rather than assumed.
//
// P2-7: even in mode A the nominal is a *fallback*, not a hardcoded pretence. A user who measures
// their supply can set `settings/nominal_voltage`, which takes precedence and is persisted to NVS
// so it survives a reboot. The pushed `voltage` field is then the value the device actually used.
const float VOLTAGE = 230.0;

// Runtime-overridable supply voltage. Written by streamCallback when the app changes
// `settings/nominal_voltage` (or restored from NVS at boot). Kept in RAM because the telemetry
// path reads it every 2 s and NVS reads are slow.
float nominalVoltage = VOLTAGE;

#ifdef HAS_VOLTAGE_SENSE
// ---------------------------------------------------------------------------
// Voltage-sense calibration
// ---------------------------------------------------------------------------
// The sensor's transfer function: how many millivolts (RMS) appear at the ADC for each volt (RMS)
// of mains. This is NOT a datasheet number — the common ZMPT101B module sets its gain with an
// on-board potentiometer, so it varies module to module and moves if the pot is knocked.
//
// CALIBRATION PROCEDURE (do this before trusting any wattage):
//   1. Measure the real mains voltage at the socket with a multimeter.
//   2. Read what the device reports for `voltage`.
//   3. Set `settings/voltage_cal_mv_per_v` so the two agree. It is persisted to NVS and applied
//      immediately — no reflash needed.
//
// The default below is a plausible starting point for a module trimmed to swing ~1.06 V RMS at
// 230 V (which keeps the peak inside the ESP32's 3.3 V range with headroom). It is a GUESS until
// calibrated, and an uncalibrated scale makes every wattage wrong by that same factor.
const float VOLTAGE_CAL_MV_PER_V = 4.60f;

// Runtime-overridable, NVS-backed, same shape as nominalVoltage. Bounded so a typo cannot scale
// every reading into nonsense: a real module lands somewhere in 1-20 mV/V.
float voltageCalMvPerV = VOLTAGE_CAL_MV_PER_V;

// Most recent measured mains RMS. Written by every sampling pass that touches the voltage channel;
// read by supplyVoltage() and by the telemetry. Zero means "no valid reading yet".
float measuredVoltageRms = 0.0f;

// When the voltage channel was last read. Port passes only read it while a port is energised, so
// with every port off the reading would otherwise freeze at its last value — and, worse, a user
// with nothing plugged in could not calibrate at all, because calibration means comparing the
// reported voltage against a multimeter. refreshVoltageOnly() uses this to stay current.
unsigned long lastVoltageSampleMs = 0;

/** Is a measured voltage available and physically plausible? */
bool measuredVoltageIsUsable() {
  return measuredVoltageRms >= 50.0f && measuredVoltageRms <= 300.0f;
}
#endif

/**
 * The single source of truth for "what voltage are we multiplying by?".
 *
 * Every power computation calls this rather than the constant, which is what made adding a
 * voltage-sense channel a change in one place. With a sensor fitted and a plausible reading it
 * returns the MEASUREMENT; otherwise it falls back to the configured nominal. Both bands are
 * range-checked so a typo or a floating pin cannot produce a garbage multiplier.
 */
float supplyVoltage() {
#ifdef HAS_VOLTAGE_SENSE
  if (measuredVoltageIsUsable()) return measuredVoltageRms;
#endif
  if (nominalVoltage >= 50.0f && nominalVoltage <= 300.0f) return nominalVoltage;
  return VOLTAGE;
}

/**
 * Is the voltage figure a reading, or a configured assumption?
 *
 * The app needs this to label the power figure honestly — VA vs W is the difference between an
 * estimate and a measurement, and showing the wrong unit is how a prototype ends up claiming a
 * precision it does not have. Reported in telemetry as `voltage_source`.
 */
bool voltageIsMeasured() {
#ifdef HAS_VOLTAGE_SENSE
  return measuredVoltageIsUsable();
#else
  return false;
#endif
}

String roomPath = "";
String macAddress = "";

// Energy tracking (RAM + NVS backed so a reboot does not zero the day's total)
float portEnergyKWh[NUM_PORTS] = {0.0, 0.0, 0.0};
unsigned long lastEnergyCalcMillis = 0;

// ---------------------------------------------------------------------------
// Daily / hourly history
// ---------------------------------------------------------------------------
#define MAX_HISTORY_DAYS 31

struct DailyRecord {
  String date;             // "YYYY-MM-DD"
  float energyKwh;
  uint16_t occupiedMinutes;
  float peakWatts;
};

DailyRecord dailyHistory[MAX_HISTORY_DAYS];
int dailyCount = 0;

float todayHourlyKwh[24];
bool todayHourlyOccupied[24];
String historyDayDate = ""; // which day the hourly buckets belong to

// Database Settings
bool overrideActive = false;
bool nightModeEnabled = true;
bool mmwaveEnabled = false;
String nightModeStart = "22:00";
String nightModeEnd = "06:00";

// Per-port shutdown policy. See `enum PortPolicy` in VoltSenseTypes.h for why intent has to be
// STATED rather than inferred from current draw. Default `occupancy`: cut when the room empties.
PortPolicy portPolicy[NUM_PORTS] = { POLICY_OCCUPANCY, POLICY_OCCUPANCY, POLICY_OCCUPANCY };

const char* policyToString(PortPolicy p) {
  switch (p) {
    case POLICY_ALWAYS_ON: return "always_on";
    case POLICY_KEEP_WHILE_DRAWING: return "keep_while_drawing";
    default: return "occupancy";
  }
}

/** Parse a policy string. Anything unrecognised falls back to the safe default, not to a guess. */
PortPolicy policyFromString(const String& s) {
  if (s == "always_on") return POLICY_ALWAYS_ON;
  if (s == "keep_while_drawing") return POLICY_KEEP_WHILE_DRAWING;
  return POLICY_OCCUPANCY;
}

// Once the room has shut down, ports kept by policy are re-checked on this interval. Without it a
// `keep_while_drawing` port would never notice that charging had finished, because the state
// machine does not otherwise re-evaluate while in STATE_SHUTDOWN — it would stay on until the room
// was next occupied and emptied. Long enough that the extra ADC reads are negligible on a static
// room, short enough that a finished charge is released promptly.
#define SHUTDOWN_RECHECK_MS 60000UL
unsigned long lastShutdownRecheckMillis = 0;

Preferences prefs;

// ---------------------------------------------------------------------------
// Device identity
//
// The device authenticates with a Firebase CUSTOM TOKEN whose `device_mac` claim equals its own
// MAC. That claim is what lets the database rules distinguish "this really is device AA:BB:..."
// from "some anonymous caller", which in turn is what allows `relay_status` (mains relays) to be
// owner-scoped instead of writable by anyone who can sign in.
//
// Generate the values with `npm run mint-token -- <MAC>` and store them in NVS via
// ProvisionToken.ino. They are secrets: they grant write access to this device's node.
//
// Set this to true ONLY for local bench testing. With it enabled the device falls back to
// anonymous auth, which the strict rules reject — so it will connect but be unable to write.
#define ALLOW_ANONYMOUS_FALLBACK false

String getNvsString(const char* key, const char* fallback = "") {
  Preferences p;
  p.begin("voltsense", true);
  String value = p.getString(key, fallback);
  p.end();
  return value;
}

// ---------------------------------------------------------------------------
// Alert endpoint
//
// Deployed separately from the app bundle; set this to your production URL.
// The secret is read from NVS so it can be rotated without a reflash (run
// ProvisionToken.ino and re-enter `alert_secret`).
//
// FAILURE SIGNATURES (all three look identical from the app — no alert arrives):
//   * "Alert -> HTTP 401" .......... the server rejected the secret. The device's `alert_secret`
//     does not match its `alert_secret_hash` (rotated on the device but not the server, or vice
//     versa). Re-run ProvisionToken.ino with the correct value.
//   * "Alert failed: SSL/TLS handshake failed" .. the pinned root no longer matches the chain.
//     Re-verify and reflash API_ROOT_CA_BUNDLE (see runConnectivitySelfTest). NOTE: a wrong pin is
//     usually reported as "connection refused", not as a TLS error — see the bundle's comment.
//   * "Alert failed: connection refused" / timeout .. host unreachable — network, DNS, or a stale
//     Vercel deployment. This is the one that is NOT a credential problem.
// ---------------------------------------------------------------------------
const char* ALERT_URL = "https://voltsense-iot.vercel.app/api/alert";

// ---------------------------------------------------------------------------
// Self-provisioning (pairing)
//
// A factory-fresh unit has no credentials in NVS. Rather than requiring a USB cable and a serial
// monitor, it pairs itself:
//
//   1. POST {pairing_key, mac, fw} to PAIR_URL.
//   2. The server mints a UNIQUE device password + alert secret, creates/updates the Auth account,
//      writes `device_uids/<MAC>` (which no client is allowed to write), and returns an 8-char code.
//   3. We store the credentials in NVS and print the code.
//   4. The user types that code into the app, which claims ownership.
//
// The factory key is NOT a device password — every unit shares it, so treat it as public-ish. It
// only buys the right to ASK for credentials. Once paired, this device's real secrets are unique
// and the factory key is worthless against it.
//
// Provisioning via USB (ProvisionToken.ino) still works and takes priority — see setup().
//
// FAILURE SIGNATURE: if this host is wrong or the TLS chain has rotated, pairing fails and the
// device falls through to "no device identity available". The SERIAL log distinguishes the two via
// runConnectivitySelfTest() at boot — read it before assuming the pairing key is the problem.
// ---------------------------------------------------------------------------
const char* PAIR_URL = "https://voltsense-iot.vercel.app/api/pair";
const char* FIRMWARE_VERSION = "1.0.0";

// DO NOT HARD-CODE THE FACTORY KEY HERE.
//
// A literal key was committed here and pushed to a PUBLIC repository, so it must be treated as
// compromised. It is a real credential, not a placeholder: /api/pair accepts it, and a caller who
// holds it plus a MAC receives that device's `device_password` and `alert_secret`. Those
// authenticate as the device, and the database rules grant a device FULL write to its own node —
// including `ports/<id>/relay_status`, i.e. the physical relays. The per-device rate limit
// (1/min, 10/h) does not stop a targeted attempt.
//
// Supply it at BUILD time instead, so it never enters version control. In the Arduino IDE set
// it as a build property, or on the command line:
//
//   arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=huge_app" \
//     --build-property 'compiler.cpp.extra_flags=-DVOLTSENSE_PAIRING_KEY=\"<your-key>\"' \
//     esp32/VoltSense
//
// The `#ifndef` guard below exists precisely so this works. Left undefined, the device prints
// "No factory pairing key compiled in; USB provisioning required." and falls back to
// ProvisionToken.ino — a clear failure, not a silent one.
//
// Rotating the key in Vercel is mandatory regardless: removing it from this file does NOT remove
// it from git history (it is in the initial commit), so the leaked value stays valid until rotated.
//
// IDE BUILDS (Arduino IDE 2.x) have no convenient way to pass a -D flag, so the key can live in a
// gitignored `secrets.h` next to this sketch:
//
//     // esp32/VoltSense/secrets.h  — NEVER commit this file (it is in .gitignore)
//     #define VOLTSENSE_PAIRING_KEY "<the 64-character key>"
//
// CLI BUILDS can pass -DVOLTSENSE_PAIRING_KEY=... instead — `npm run flash:firmware` reads the value
// from .env for you. The #ifndef below is the fallback for a build that supplies neither.
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif
#ifndef VOLTSENSE_PAIRING_KEY
#define VOLTSENSE_PAIRING_KEY ""
#endif

// ---------------------------------------------------------------------------
// TLS root CAs — a pinned bundle, not setInsecure()
//
// The endpoint is served by Vercel, which now chains to GOOGLE TRUST SERVICES:
//
//     *.vercel.app   <-  WR1 (intermediate)  <-  GTS Root R1
//
// This file previously pinned ISRG Root X1 (Let's Encrypt) alone. That was right while Vercel used
// Let's Encrypt, but Vercel has since moved to Google Trust Services — so the single pin REJECTED
// every handshake. Worse, the ESP32's HTTPClient reports a certificate failure with the SAME code
// and the SAME string as a refused TCP connect ("connection refused"), so a wrong pin looks
// exactly like a dead network. That is what made this so hard to find.
//
// Pin every root that can legitimately terminate Vercel's chain:
//
//   GTS Root R1 (RSA)    - current issuer of *.vercel.app (via the WR1 intermediate)
//   GTS Root R4 (ECDSA)  - Google's other root (WR2 / WE1); some Vercel edges serve it
//   ISRG Root X1         - retained so a move back to Let's Encrypt does not brick the fleet
//
// This is still a pin, not `setInsecure()`: no attacker can obtain a certificate for this host from
// any of these CAs, so a MITM still cannot capture and replay the pairing/alert secret.
//
// mbedTLS parses EVERY certificate in the string (ssl_client.cpp -> mbedtls_x509_crt_parse), so a
// single setCACert() call installs all three. Re-verify the live chain with:
//   openssl s_client -connect <host>:443 -servername <host> -showcerts
//   openssl verify -CAfile <root.pem> -untrusted <intermediate.pem> <leaf.pem>
// ---------------------------------------------------------------------------
const char* API_ROOT_CA_BUNDLE = R"EOF(-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// ---------------------------------------------------------------------------
// Realtime Database over REST
//
// WHY NOT THE CLIENT LIBRARY: the bundled Firebase client library ships its own BearSSL TLS stack
// and, on ESP32 core 3.x, cannot complete a handshake with Google's RTDB frontends. The board says:
//
//     > ERROR.mConnectSSL: Failed to initlalize the SSL layer.
//     > ERROR.mConnectSSL: Incoming protocol or record version is unsupported.
//
// while the SAME board, at the SAME moment, reaches the SAME host with the core's native mbedTLS
// client -- the boot self-test prints "HTTPS /.json -> HTTP 401 (TLS OK)". The fault is in the
// library's TLS stack, not in the network, and swapping it out was tried and reverted: the library's
// connection lifecycle assumes BearSSL's own connected()/available()/stop() semantics.
//
// So this device speaks the Realtime Database REST API directly, over the HTTPClient +
// API_ROOT_CA_BUNDLE path that IS proven here. Same database, same security rules, no client library.
//
//   write :  PATCH|PUT  https://<db-host>/<path>.json?auth=<idToken>
//   read  :  GET        https://<db-host>/<path>.json?auth=<idToken>
//
// The ID token comes from Identity Toolkit (the endpoint the library used) and is good for an hour,
// so it is refreshed well before then.
// ---------------------------------------------------------------------------

String rtdbIdToken = "";
unsigned long rtdbTokenDeadline = 0;  // millis() deadline
const unsigned long RTDB_TOKEN_LIFETIME_MS = 55UL * 60UL * 1000UL;  // tokens last 60 min

// Declared here because this block sits above the Helpers section that defines them.
String jsonEscape(const String& s);
String extractJsonString(const String& json, const String& key);
// Same reason. Every network call below blocks, and with the network DOWN the DNS + connect
// timeouts add up past the 30 s watchdog, which rebooted the board in a loop at boot.
void watchdogFeed();

// Email/password (the pairing path) — the endpoint the client library used.
String rtdbTokenViaPassword() {
  const String email = getNvsString("dev_email");
  const String password = getNvsString("dev_password");
  if (email.length() == 0 || password.length() == 0) return "";

  WiFiClientSecure client;
  client.setCACert(API_ROOT_CA_BUNDLE);
  HTTPClient http;
  String url =
      String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + API_KEY;
  if (!http.begin(client, url)) return "";
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"email\":\"" + jsonEscape(email) + "\",\"password\":\"" + jsonEscape(password) +
                "\",\"returnSecureToken\":true}";
  watchdogFeed();
  const int code = http.POST(body);
  watchdogFeed();
  String response = (code > 0) ? http.getString() : "";
  http.end();
  if (code != 200) {
    Serial.printf("RTDB sign-in (password) failed: HTTP %d\n", code);
    return "";
  }
  return extractJsonString(response, "idToken");
}

// Refresh-token identity (what `npm run mint-token` provisions). This endpoint answers in
// snake_case -- `id_token`, not `idToken`.
String rtdbTokenViaRefreshToken() {
  const String refreshToken = getNvsString("dev_refresh_token");
  if (refreshToken.length() == 0) return "";

  WiFiClientSecure client;
  client.setCACert(API_ROOT_CA_BUNDLE);
  HTTPClient http;
  String url = String("https://securetoken.googleapis.com/v1/token?key=") + API_KEY;
  if (!http.begin(client, url)) return "";
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  watchdogFeed();
  const int code = http.POST(String("grant_type=refresh_token&refresh_token=") + refreshToken);
  watchdogFeed();
  String response = (code > 0) ? http.getString() : "";
  http.end();
  if (code != 200) {
    Serial.printf("RTDB sign-in (refresh token) failed: HTTP %d\n", code);
    return "";
  }
  return extractJsonString(response, "id_token");
}

bool rtdbSignIn() {
  if (WiFi.status() != WL_CONNECTED) return false;

  String token = rtdbTokenViaPassword();
  if (token.length() == 0) token = rtdbTokenViaRefreshToken();
  if (token.length() == 0) {
    Serial.println("RTDB sign-in: no identity could be used (no email/password, no refresh token).");
    return false;
  }

  rtdbIdToken = token;
  rtdbTokenDeadline = millis() + RTDB_TOKEN_LIFETIME_MS;
  return true;
}

bool rtdbEnsureToken() {
  if (rtdbIdToken.length() > 0 && (long)(millis() - rtdbTokenDeadline) < 0) return true;
  return rtdbSignIn();
}

// One REST call. `method` is "GET", "PUT" or "PATCH"; `body` is used for the writes only.
bool rtdbRequest(const char* method, const String& path, const String& body, String* out) {
  if (!rtdbEnsureToken()) return false;

  WiFiClientSecure client;
  client.setCACert(API_ROOT_CA_BUNDLE);
  HTTPClient http;
  String url = String("https://") + DATABASE_URL + path + ".json?auth=" + rtdbIdToken;
  if (!http.begin(client, url)) return false;
  http.setTimeout(15000);

  // A 15 s timeout is half the watchdog budget, and these run back to back.
  watchdogFeed();
  int code;
  if (strcmp(method, "GET") == 0) {
    code = http.GET();
  } else {
    http.addHeader("Content-Type", "application/json");
    code = (strcmp(method, "PATCH") == 0) ? http.PATCH(body) : http.PUT(body);
  }
  if (out && code > 0) *out = http.getString();
  http.end();
  watchdogFeed();

  if (code < 200 || code >= 300) {
    Serial.printf("RTDB %s %s -> HTTP %d\n", method, path.c_str(), code);
    return false;
  }
  return true;
}

// Thin adapters so the call sites read much as they did against the client library.
bool rtdbPatchJson(const String& path, FirebaseJson& json) {
  return rtdbRequest("PATCH", path, json.raw(), nullptr);
}
bool rtdbPutJson(const String& path, FirebaseJson& json) {
  return rtdbRequest("PUT", path, json.raw(), nullptr);
}
bool rtdbPutBool(const String& path, bool value) {
  return rtdbRequest("PUT", path, value ? "true" : "false", nullptr);
}
bool rtdbPutInt(const String& path, int value) {
  return rtdbRequest("PUT", path, String(value), nullptr);
}

// Proof that the REST path works on this board, printed at boot next to the endpoint self-test.
void rtdbRestSelfTest() {
  Serial.println("--- Realtime Database REST self-test ---");
  if (!rtdbSignIn()) {
    Serial.println("  [FAIL] sign-in (no idToken)");
    Serial.println("---------------------------------------");
    return;
  }
  Serial.println("  [ OK ] signed in, idToken obtained");

  const String path = roomPath + "/diag";
  if (!rtdbRequest("PATCH", path, String("{\"rest_ok\":") + (unsigned long)millis() + "}", nullptr)) {
    Serial.println("  [FAIL] write");
    Serial.println("---------------------------------------");
    return;
  }
  Serial.println("  [ OK ] wrote " + path);

  String back;
  if (!rtdbRequest("GET", path, "", &back)) {
    Serial.println("  [FAIL] read-back");
    Serial.println("---------------------------------------");
    return;
  }
  Serial.println("  [ OK ] read back: " + back);
  Serial.println("---------------------------------------");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Forward declarations. The Arduino preprocessor normally generates these, but it is fragile with
// String-returning helpers that call each other, and a failure here is a confusing compile error
// rather than a clear one. Stating them removes the ambiguity.
String jsonEscape(const String& s);
String extractJsonString(const String& json, const String& key);
bool pairDevice();
void factoryResetIfRequested();
void runConnectivitySelfTest();
void watchdogInit();
void watchdogFeed();
void waitWithWatchdog(uint32_t totalMs);
void checkOvercurrent();

// Read the alert shared secret from NVS. Never written to, or read from, the database.
String getAlertSecret() {
  return getNvsString("alert_secret");
}

void setNvsString(const char* key, const String& value) {
  Preferences p;
  p.begin("voltsense", false); // read-write
  p.putString(key, value);
  p.end();
}

// ---------------------------------------------------------------------------
// Endpoint connectivity self-test (P2-6)
//
// A pinned root CA is the right call (a MITM must not be able to capture the shared secret), but it
// has an operational cost: when Let's Encrypt rotates the chain the handshake fails and the device
// goes silent with the SAME symptom as "no network". That is the worst possible failure mode for a
// fielded unit — the installer sees "alerts not arriving" and has no way to tell a certificate
// problem from a Wi-Fi problem without a serial cable.
//
// So we probe once at boot, immediately after WiFi comes up, and CLASSIFY the failure:
//
//   * WiFi down ........................ nothing to do with TLS; the network is gone.
//   * TCP connect fails / DNS fails .... the host is unreachable — network or a bad URL.
//   * TCP connects, TLS handshake fails  the certificate chain no longer matches the pinned root.
//     (`http.begin()` still succeeds because it only parses the URL; the failure surfaces at
//      `http.GET()/POST()` as a negative code whose `errorToString()` is "connection refused" or,
//      specifically for a TLS mismatch, "SSL/TLS handshake failed".)
//   * HTTP status >= 400 .............. TLS is fine; the endpoint answered. Reachability proven.
//   * HTTP status 2xx/4xx/405 .......... reachable; we don't care WHICH status, only that TLS
//     completed. A 401 from /api/alert (no secret in the probe) still proves the handshake worked.
//
// This is deliberately a *probe*, not a delivery: it never carries the alert secret, and it never
// touches `relay_status`. It exists only to turn a silent failure into a legible serial log.
// ---------------------------------------------------------------------------

// `struct ProbeResult` is declared in VoltSenseTypes.h — it appears in a function signature, so it
// must be visible above the prototypes the Arduino build generates. See that file for the details.

// A TLS handshake failure and a plain network failure both come back as a negative HTTPClient code,
// so the distinction has to be made from the error STRING, not the number. Keep this in one place.
bool looksLikeTlsFailure(const String& err) {
  String e = err;
  e.toLowerCase();
  return e.indexOf("ssl") >= 0 || e.indexOf("tls") >= 0 ||
         e.indexOf("certificate") >= 0 || e.indexOf("cert") >= 0;
}

// Probe one HTTPS endpoint. `host` is only used for logging.
ProbeResult probeEndpoint(const char* url, const char* host) {
  ProbeResult r = {false, false, 0, ""};

  if (WiFi.status() != WL_CONNECTED) {
    r.detail = "WiFi down";
    return r;
  }

  WiFiClientSecure client;
  client.setCACert(API_ROOT_CA_BUNDLE);

  HTTPClient http;
  if (!http.begin(client, url)) {
    // URL could not even be parsed — a compile-time mistake, not a runtime network condition.
    r.detail = "http.begin failed (malformed URL)";
    return r;
  }
  http.setTimeout(8000);
  // HEAD is the cheapest verb that still forces a full TLS handshake. The endpoint is a serverless
  // function that answers GET/POST; a HEAD returning anything at all proves the chain is trusted.
  watchdogFeed();
  int code = http.GET();
  watchdogFeed();
  if (code > 0) {
    r.reachable = true;
    r.code = code;
    r.detail = "reachable (HTTP " + String(code) + ")";
  } else {
    String err = http.errorToString(code);
    r.code = code;
    r.tlsFailed = looksLikeTlsFailure(err);
    r.detail = err.length() ? err : ("transport error " + String(code));
  }
  http.end();
  return r;
}

// Probe both HTTPS endpoints and print a single verdict. Called once from setup(), after WiFi and
// before Firebase auth, so its output is the FIRST thing an installer sees when something is wrong.
void runConnectivitySelfTest() {
  Serial.println("--- Endpoint reachability self-test ---");

  // Resolve the API host explicitly. The ESP32's HTTPClient reports a DNS failure and a refused TCP
  // connect with the SAME code (-1, "connection refused"), so without this line "this network has no
  // internet" is indistinguishable from "the server is down". Naming it saves a lot of guessing.
  IPAddress apiIp;
  if (WiFi.hostByName("voltsense-iot.vercel.app", apiIp)) {
    Serial.printf("  DNS  : voltsense-iot.vercel.app -> %s\n", apiIp.toString().c_str());
  } else {
    Serial.println("  DNS  : FAILED to resolve voltsense-iot.vercel.app");
    Serial.println("         -> this network has no working DNS / internet. The endpoints are fine;");
    Serial.println("            the ESP32 simply cannot reach them. Try another network (e.g. a");
    Serial.println("            phone hotspot with data) or fix the router's DNS.");
  }

  // Print the network the board actually got, then do TWO raw TCP connects: one to a well-known
  // host, one to the API host itself. Together they are conclusive:
  //   * google fails              -> the whole network has no route to the internet.
  //   * google ok, API host fails -> the network blocks (or cannot route to) Vercel specifically.
  //   * BOTH ok, HTTPS still fails-> the network is fine, so the failure is the CERTIFICATE.
  // That last case is the one that matters here: a wrong pinned root is reported by HTTPClient with
  // the same code and string as a refused connect, so without this line it is indistinguishable.
  Serial.printf("  NET  : ip=%s  gw=%s  mask=%s  dns=%s\n",
                WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
                WiFi.subnetMask().toString().c_str(), WiFi.dnsIP().toString().c_str());
  bool tcpGoogle = false;
  bool tcpApiHost = false;
  {
    WiFiClient tcp;
    tcp.setTimeout(8000);
    watchdogFeed();
    tcpGoogle = tcp.connect("www.google.com", 443);
    watchdogFeed();
    tcp.stop();
  }
  {
    WiFiClient tcp;
    tcp.setTimeout(8000);
    watchdogFeed();
    tcpApiHost = tcp.connect("voltsense-iot.vercel.app", 443);
    watchdogFeed();
    tcp.stop();
  }
  Serial.printf("  TCP  : www.google.com:443        -> %s\n",
                tcpGoogle ? "connected" : "FAILED (no outbound route)");
  Serial.printf("  TCP  : voltsense-iot.vercel.app  -> %s\n",
                tcpApiHost ? "connected (network CAN reach Vercel)"
                           : "FAILED (network cannot reach the API host)");

  // The Firebase Realtime Database is a DIFFERENT host from the API. A network can reach one and not
  // the other (carrier DNS hijack, split routing, a block list) — and the Firebase library then fails
  // deep inside its own TLS stack, where the only visible symptom is the cryptic "Incoming protocol
  // or record version is unsupported" (BearSSL received NON-TLS bytes: a plaintext reply, which is
  // what a captive portal or a blocked-host page sends). Probe the RTDB host explicitly so the log
  // names the host that is actually broken instead of blaming the firmware.
  {
    IPAddress rtdbIp;
    bool dnsOk = WiFi.hostByName(DATABASE_URL, rtdbIp);
    WiFiClient tcp;
    tcp.setTimeout(8000);
    bool tcpOk = tcp.connect(DATABASE_URL, 443);
    tcp.stop();
    Serial.printf("  RTDB : %s\n", DATABASE_URL);
    Serial.printf("         DNS -> %s\n", dnsOk ? rtdbIp.toString().c_str() : "FAILED to resolve");
    Serial.printf("         TCP:443 -> %s\n", tcpOk ? "connected" : "FAILED");

    WiFiClientSecure client;
    client.setCACert(API_ROOT_CA_BUNDLE);
    HTTPClient http;
    String rtdbUrl = String("https://") + DATABASE_URL + "/.json";
    if (http.begin(client, rtdbUrl)) {
      http.setTimeout(8000);
      watchdogFeed();
      int code = http.GET();
      watchdogFeed();
      String detail;
      if (code > 0) {
        // 401 is the EXPECTED answer for an unauthenticated probe, and it proves the handshake worked.
        detail = "HTTP " + String(code) + (code == 401 ? " (TLS OK)" : "");
      } else {
        detail = http.errorToString(code);
      }
      Serial.printf("         HTTPS /.json -> %s\n", detail.c_str());
      http.end();
    } else {
      Serial.println("         HTTPS /.json -> could not build the request");
    }
  }

  ProbeResult alert = probeEndpoint(ALERT_URL, "alert");
  ProbeResult pair = probeEndpoint(PAIR_URL, "pair");

  auto report = [](const char* label, const ProbeResult& r) {
    if (r.reachable) {
      Serial.printf("  [ OK ] %-5s %s\n", label, r.detail.c_str());
    } else if (r.tlsFailed) {
      Serial.printf("  [TLS ] %-5s %s\n", label, r.detail.c_str());
    } else {
      Serial.printf("  [FAIL] %-5s %s\n", label, r.detail.c_str());
    }
  };
  report("alert", alert);
  report("pair", pair);

  // The network reached the API host, but HTTPS still failed -> the certificate chain is not
  // trusted. This is the branch that would have saved hours: HTTPClient calls it "connection
  // refused", which reads like a network fault, so compare the raw TCP result against the HTTPS one.
  if (!alert.reachable && !pair.reachable && tcpApiHost) {
    Serial.println("  >> TCP to the API host SUCCEEDED but HTTPS failed.");
    Serial.println("     That is a CERTIFICATE problem, not a Wi-Fi problem: the pinned root no");
    Serial.println("     longer matches Vercel's chain (HTTPClient reports it as \"connection");
    Serial.println("     refused\", which is why it looks like a network fault). Re-verify and update");
    Serial.println("     API_ROOT_CA_BUNDLE in this file:");
    Serial.println("       openssl s_client -connect voltsense-iot.vercel.app:443 \\");
    Serial.println("         -servername voltsense-iot.vercel.app -showcerts");
    Serial.println("       openssl verify -CAfile <root.pem> -untrusted <intermediate.pem> <leaf.pem>");
  } else if (alert.tlsFailed || pair.tlsFailed) {
    Serial.println("  >> TLS handshake failed against a pinned endpoint — the certificate chain no");
    Serial.println("     longer matches API_ROOT_CA_BUNDLE. Re-verify with the openssl commands in the");
    Serial.println("     comment above that constant, then reflash. This device CANNOT file alerts or");
    Serial.println("     pair until it is fixed — it is not a Wi-Fi problem.");
  } else if (!alert.reachable && !pair.reachable) {
    Serial.println("  >> Both endpoints unreachable and the API host is not reachable by TCP either.");
    Serial.println("     Check the network, DNS, and that ALERT_URL / PAIR_URL point at the deployed");
    Serial.println("     host. This is a network problem, not a certificate problem.");
  }
  Serial.println("---------------------------------------");
}

// ---------------------------------------------------------------------------
// Self-provisioning
//
// Returns true if the device now has usable credentials in NVS.
//
// This runs BEFORE Firebase.begin(), so it uses plain HTTPClient rather than the Firebase library.
// It is intentionally bounded: a handful of attempts with backoff, then it gives up and lets the
// caller decide what to do. Spinning forever here would leave the relays in whatever state they
// booted in with no telemetry, which is worse than a clear failure message.
// ---------------------------------------------------------------------------
bool pairDevice() {
  const String factoryKey = String(VOLTSENSE_PAIRING_KEY);
  if (factoryKey.length() == 0) {
    Serial.println("No factory pairing key compiled in; USB provisioning required.");
    return false;
  }
  if (macAddress.length() == 0) {
    Serial.println("Cannot pair: MAC address unknown.");
    return false;
  }

  const int MAX_ATTEMPTS = 3;

  for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    Serial.printf("Pairing with VoltSense (%d/%d)...\n", attempt, MAX_ATTEMPTS);

    WiFiClientSecure client;
    client.setCACert(API_ROOT_CA_BUNDLE);

    HTTPClient http;
    if (!http.begin(client, PAIR_URL)) {
      Serial.println("  Could not begin the pairing request.");
      delay(2000 * attempt);
      continue;
    }
    http.setTimeout(15000);
    http.addHeader("Content-Type", "application/json");

    // Hand-rolled JSON: the payload is three flat strings, and pulling in ArduinoJson for this
    // would be the tail wagging the dog. The values are escaped anyway in case a key contains a
    // character that would break the document.
    String payload = "{\"pairing_key\":\"" + jsonEscape(factoryKey) +
                     "\",\"mac\":\"" + jsonEscape(macAddress) +
                     "\",\"fw\":\"" + jsonEscape(String(FIRMWARE_VERSION)) + "\"}";

    int code = http.POST(payload);
    String response = http.getString();
    http.end();

    if (code == 429) {
      // Rate-limited. The server tells us how long to wait; honour it rather than hammering.
      // Waited in slices that each feed the watchdog: a bare delay(65000) is far longer than the
      // 30 s timeout and would reset the device mid-backoff, turning a "wait a minute" instruction
      // into a reboot loop against the server that just asked us to slow down.
      Serial.println("  Rate-limited by the server. Waiting before retrying.");
      waitWithWatchdog(65000);
      continue;
    }
    if (code != 200) {
      Serial.printf("  Pairing failed: HTTP %d\n", code);
      if (response.length() > 0 && response.length() < 400) {
        Serial.printf("  Response: %s\n", response.c_str());
      }
      waitWithWatchdog(3000 * attempt);
      continue;
    }

    // ---- parse the response ------------------------------------------------
    // Deliberately minimal extraction. We only accept the exact shapes the server emits; if this
    // ever needs to be more general, add ArduinoJson rather than growing these helpers.
    String email = extractJsonString(response, "device_email");
    String password = extractJsonString(response, "device_password");
    String alertSecret = extractJsonString(response, "alert_secret");
    String pairingCode = extractJsonString(response, "pairing_code");

    if (email.length() == 0 || password.length() == 0 || alertSecret.length() == 0) {
      Serial.println("  Pairing response was missing fields; not storing anything.");
      delay(3000);
      continue;
    }

    setNvsString("dev_email", email);
    setNvsString("dev_password", password);
    setNvsString("alert_secret", alertSecret);

    Serial.println("\n  ============================================================");
    Serial.println("   PAIRED. Enter this code in the VoltSense app to add it:");
    Serial.printf("        >>>   %s   <<<\n", pairingCode.c_str());
    Serial.println("   (The code expires in 30 minutes; reset the device to get a new one.)");
    Serial.println("  ============================================================\n");

    // The factory key is no longer needed on this unit. Clearing it means a dumped flash does not
    // hand over the ability to provision MORE devices.
    setNvsString("pairing_key_used", "1");
    return true;
  }

  Serial.println("Pairing gave up after repeated failures. Reset to try again.");
  return false;
}

// Pull a top-level string field out of a small JSON document.
String extractJsonString(const String& json, const String& key) {
  // Match "key", then a colon, then the opening quote -- tolerating whitespace around the colon.
  // Google's REST APIs return `"idToken": "..."` WITH a space, which the previous exact-match form
  // (`"key":"`) silently failed on, returning an empty string.
  const String needle = "\"" + key + "\"";
  int i = json.indexOf(needle);
  if (i < 0) return "";
  i += needle.length();

  while (i < (int)json.length() && isspace((unsigned char)json[i])) i++;
  if (i >= (int)json.length() || json[i] != ':') return "";
  i++;
  while (i < (int)json.length() && isspace((unsigned char)json[i])) i++;
  if (i >= (int)json.length() || json[i] != '"') return "";
  i++;

  // Walk to the closing quote, honouring backslash escapes.
  String out = "";
  for (; i < (int)json.length(); i++) {
    char c = json[i];
    if (c == '\\' && i + 1 < (int)json.length()) {
      char next = json[i + 1];
      if (next == 'n') out += '\n';
      else if (next == 't') out += '\t';
      else out += next;
      i++;
      continue;
    }
    if (c == '"') break;
    out += c;
  }
  return out;
}

String twoDigit(int v) {
  return (v < 10 ? "0" : "") + String(v);
}

String hourLabel(int h) {
  return twoDigit(h) + ":00";
}

// NTPClient::getEpochTime() already has the UTC offset applied, so gmtime() gives local wall clock.
String getLocalDateString() {
  time_t t = timeClient.getEpochTime();
  struct tm* ti = gmtime(&t);
  if (!ti) return "";
  char buf[11];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d", ti->tm_year + 1900, ti->tm_mon + 1, ti->tm_mday);
  return String(buf);
}

int getLocalHour() {
  time_t t = timeClient.getEpochTime();
  struct tm* ti = gmtime(&t);
  if (!ti) return 0;
  return ti->tm_hour;
}

int getLocalDayOfMonth() {
  time_t t = timeClient.getEpochTime();
  struct tm* ti = gmtime(&t);
  if (!ti) return 1;
  return ti->tm_mday;
}

// ---- Forward declarations (explicit, so ordering below does not matter) ----
String dayOffsetToDate(int daysAgo);
void publishDailyRange(const String& key, int startDaysAgo, int endDaysAgo);
void sendAlert(const String& title, const String& body, const String& tag);
// Defined in the relay derating section further down; every relay write routes through it.
// The enum itself is in VoltSenseTypes.h (it appears in a signature, so it must precede the
// prototypes the Arduino build generates — defining it here as well was a duplicate definition).
RelaySwitchResult runRelaySwitch(int port, bool on, bool force = false);
void runRelaySwitchAndSync(int port, bool on);

void setAllRelays(bool state) {
  for (int i = 0; i < NUM_PORTS; i++) {
    // Forced: this is a deliberate bulk action (override), not a flapping source, and `runRelaySwitch`
    // still skips ports already in the requested state.
    runRelaySwitch(i, state, /*force=*/true);
  }
  Serial.printf("All Relays set to %s\n", state ? "ON" : "OFF");
}

// ---------------------------------------------------------------------------
// Current sensing (ACS712)
// ---------------------------------------------------------------------------
//
// The ACS712 is a BIPOLAR sensor: at 0 A it sits at half its supply (~2.5 V), so a reading of
// 2.5 V means zero current, not 2.5 V of signal. The trick below is to measure peak-to-peak
// (max - min) over a window, which cancels that bias out — we never need to know where the bias
// actually landed.
//
// WHY THE WINDOW IS 100 ms AND NOT 20 ms
//
// This is the bug the original version shipped with. It sampled `while (millis() - start < 20)`.
// Two things are wrong with that:
//
//   1. A single 20 ms window is EXACTLY ONE period of 50 Hz mains. Peak-to-peak measured over
//      almost-but-not-quite a whole period misses the true peaks, and `millis()` has 1 ms
//      granularity, so the real window was 17-20 ms — usually LESS than one period. The reading
//      was therefore systematically low and jittery, by an amount that depended on where in the
//      cycle the sampling happened to start.
//   2. Any DC offset or mains-frequency beating aliases straight into the result.
//
// Sampling over 100 ms covers exactly 5 full 50 Hz periods. Every peak is captured regardless of
// start phase, and the quantisation error of the loop condition becomes negligible. For a 60 Hz
// supply (5 periods = 83.3 ms) 100 ms still covers a whole number of periods, so this is correct
// on both grids.
//
// Reading in MILLIVOLTS, not raw counts
//
// `analogRead()` returns 0-4095 against an assumed 3.3 V reference. On a real ESP32 that reference
// is not 3.3 V, it is the ~1.1 V internal bandgap scaled by the attenuation setting, and it drifts
// per-chip. `analogReadMilliVolts()` applies the factory calibration curve for the actual chip, so
// the voltage maths below is measured rather than assumed. The attenuation is set EXPLICITLY
// (ADC_11db, the 0-3.3 V range) rather than relying on the core default, which has changed
// between ESP32 core versions and would silently halve every reading if it ever moved.
// ---------------------------------------------------------------------------
// ACS712 sensitivity — MUST MATCH THE PHYSICAL PART
// ---------------------------------------------------------------------------
// The ACS712 comes in three current ranges, each with a different mV-per-amp output. They look
// identical and are distinguished only by a marking on the chip. Using the wrong constant scales
// EVERY current reading by a fixed factor, silently — the numbers stay plausible, just wrong.
//
//   ACS712-05B  5 A   185 mV/A   (the default below)
//   ACS712-20A  20 A  100 mV/A
//   ACS712-30A  30 A   66 mV/A
//
// The BOM lists "ACS712 current sensor" with no variant. The 5 A part is the common one and 185 is
// the safe default FOR A 3-OUTLET AC BENCH — it gives the best resolution for typical loads. If you
// are using the 20 A or 30 A part, change the constant (or build with -DACS712_MV_PER_AMP=100.0f).
// Verify by putting a known resistive load (e.g. a 100 W bulb ≈ 0.43 A at 230 V) on a port and
// checking the reported amps against a clamp meter.
#define ACS712_MV_PER_AMP   185.0f  // ACS712-05B (5 A variant). Use 100.0f for the 20 A, 66.0f for 30 A.
#define CURRENT_SAMPLE_MS   100UL   // 5 full cycles at 50 Hz
#define CURRENT_SAMPLE_US   250UL   // ~4.8 kHz; well above Nyquist for both 50 and 60 Hz

// Below this the sensor is reading its own noise floor, not load current. THIS IS A DISPLAY
// THRESHOLD ONLY — it is applied by the telemetry/history path, NOT inside the sensor read, so it
// can never influence a control decision. See currentIsFlowing() for the shutdown threshold.
#define CURRENT_NOISE_FLOOR_A 0.06f

float readACS712RMS(int pin) {
  uint32_t start = millis();
  int minMv = INT32_MAX;
  int maxMv = INT32_MIN;

  while ((millis() - start) < CURRENT_SAMPLE_MS) {
    int mv = analogReadMilliVolts(pin);
    if (mv < minMv) minMv = mv;
    if (mv > maxMv) maxMv = mv;
    delayMicroseconds(CURRENT_SAMPLE_US);
  }

  if (maxMv <= minMv) return 0.0f; // flat line = definitively no signal

  // millivolts peak-to-peak -> volts RMS of a sine: Vpp/2 = Vpeak, Vpeak * 0.7071 = Vrms
  float vppVolts = (maxMv - minMv) / 1000.0f;
  float vRms = (vppVolts / 2.0f) * 0.70710678f;
  return vRms / (ACS712_MV_PER_AMP / 1000.0f);
}

#ifdef HAS_VOLTAGE_SENSE
// ---------------------------------------------------------------------------
// True-power sampling — the entire reason the voltage channel exists
// ---------------------------------------------------------------------------
// `readACS712RMS` above derives RMS from the peak-to-peak swing and assumes a SINE. That is fine
// for a rough current figure and it is inherently immune to the sensor's DC bias (a peak-to-peak
// difference cancels any constant offset). But it cannot produce real power, for two reasons:
//
//   1. NO PRODUCT TERM. Real power is `mean(v(t) * i(t))`. Min/max discards every sample except
//      two, including the sign information that carries the phase relationship between voltage and
//      current. Multiplying two RMS values gives APPARENT power — always positive, always too high
//      for anything with a power factor below 1.
//
//   2. THE SINE ASSUMPTION IS WRONG FOR THE LOADS THIS DEVICE TARGETS. A switch-mode supply draws
//      a narrow current pulse train, not a sine. A peak-derived "RMS" of that waveform is not its
//      RMS at all.
//
// So this path accumulates the three sums a true energy meter needs, in one pass over the samples:
//
//   sumV2 = SUM (v - biasV)^2      -> V_rms
//   sumI2 = SUM (i - biasI)^2      -> I_rms
//   sumVI = SUM (v - biasV)(i - biasI) -> real power (the phase-carrying term)
//
// BIAS REMOVAL IS MANDATORY HERE, unlike the peak-to-peak path. Both sensors idle at a DC offset
// (the ACS712 at Vcc/2, the voltage module at its mid-rail bias). That offset must be subtracted
// BEFORE multiplying, or the product carries a spurious DC term that inflates the watts. The bias
// is taken as the mean of the window — valid because the window is a whole number of mains cycles,
// so the AC component averages to zero and what remains is the offset.
//
// ACCUMULATORS ARE int64_t, NOT float. A sample can reach ~3300 mV, so one squared term is ~1.1e7;
// over 512 samples the sum reaches ~5.6e9, which overflows a 32-bit int and would silently wrap.
// Integer accumulation is also exact, so the only rounding is the final square root.
// ---------------------------------------------------------------------------

struct PowerReading {
  float volts;  // measured mains RMS
  float amps;   // true RMS current
  float watts;  // real power, mean(v*i) — the phase-correct figure
  float va;     // apparent power, V_rms * I_rms
  float pf;     // measured power factor, watts/va
  bool valid;   // false = too few samples / flat line, caller must not trust the numbers
};

// ~400 samples at the 250 us cadence over a 100 ms window; 512 leaves headroom for a slower loop.
#define POWER_SAMPLE_MAX 512
static int16_t powerSampV[POWER_SAMPLE_MAX];
static int16_t powerSampI[POWER_SAMPLE_MAX];

/**
 * Sample voltage and current together and compute true RMS, real power and power factor.
 *
 * The two channels are read BACK TO BACK inside one iteration. That matters: a phase error between
 * them maps directly into a power-factor error. At 50 Hz a 250 us skew is ~4.5 degrees, which at
 * PF 0.6 is roughly a 10 % error in the wattage — so the reads stay adjacent and the inter-sample
 * delay comes after both.
 */
PowerReading readPowerPort(int currentPin) {
  PowerReading out = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false};

  int n = 0;
  uint32_t start = millis();
  while ((millis() - start) < CURRENT_SAMPLE_MS && n < POWER_SAMPLE_MAX) {
    // Adjacent reads: minimal skew between the two channels.
    int mvV = analogReadMilliVolts(VOLTAGE_SENSE_PIN);
    int mvI = analogReadMilliVolts(currentPin);
    powerSampV[n] = (int16_t)mvV;
    powerSampI[n] = (int16_t)mvI;
    n++;
    delayMicroseconds(CURRENT_SAMPLE_US);
  }

  // Too few samples to span a mains cycle, or a buffer that filled instantly (a stuck ADC).
  if (n < 16) return out;

  // ---- DC bias, as the mean of the window ---------------------------------
  int64_t sumV = 0;
  int64_t sumI = 0;
  for (int k = 0; k < n; k++) {
    sumV += powerSampV[k];
    sumI += powerSampI[k];
  }
  const int32_t biasV = (int32_t)(sumV / n);
  const int32_t biasI = (int32_t)(sumI / n);

  // ---- the three sums -----------------------------------------------------
  int64_t sumV2 = 0;
  int64_t sumI2 = 0;
  int64_t sumVI = 0;
  for (int k = 0; k < n; k++) {
    const int32_t dv = (int32_t)powerSampV[k] - biasV;
    const int32_t di = (int32_t)powerSampI[k] - biasI;
    sumV2 += (int64_t)dv * dv;
    sumI2 += (int64_t)di * di;
    sumVI += (int64_t)dv * di;
  }

  const double dn = (double)n;
  const float adcVrms_mV = (float)sqrt((double)sumV2 / dn);
  const float adcIrms_mV = (float)sqrt((double)sumI2 / dn);
  const float product_mVmV = (float)((double)sumVI / dn);

  // A flat line means no signal — the sensor is unpowered, unwired, or the port is dead.
  if (adcVrms_mV <= 0.0f || adcIrms_mV <= 0.0f) return out;

  // ---- scale to engineering units -----------------------------------------
  // voltageCalMvPerV is the sensor's mV-per-mains-volt transfer, so it DIVIDES.
  const float volts = adcVrms_mV / voltageCalMvPerV;
  const float amps = adcIrms_mV / ACS712_MV_PER_AMP;
  // v_V * i_A = (v_mV * i_mV) / (1000 * mV_per_A)
  const float watts = product_mVmV / (1000.0f * ACS712_MV_PER_AMP);
  const float va = volts * amps;

  out.volts = volts;
  out.amps = amps;
  // Real power cannot be negative for a load. A small negative here is noise around zero, so clamp
  // rather than reporting a load that generates power.
  out.watts = watts > 0.0f ? watts : 0.0f;
  out.va = va;
  // PF is a ratio of two noisy quantities; bound it to the physical range so a near-zero VA cannot
  // produce a meaningless value (or a divide-by-zero).
  out.pf = (va > 0.01f) ? (out.watts / va) : 0.0f;
  if (out.pf > 1.0f) out.pf = 1.0f;
  out.valid = true;
  return out;
}
#endif

/**
 * Per-port current cache — one ADC sweep per port per cycle.
 *
 * WHY THIS EXISTS (the P2-8 latency fix)
 *
 * A single sweep takes ~100 ms (see CURRENT_SAMPLE_MS). The loop used to call the reader
 * independently in two places — once per port for telemetry, once per port for the shutdown scan —
 * and could therefore spend **up to 600 ms** sampling in one iteration. The occupancy state machine
 * is `millis()`-driven, so that stall shifts the idle/response-window transitions by the same
 * amount, and the shutdown scan is the time-sensitive part.
 *
 * A reading is now taken ONCE per port per loop iteration and reused by both consumers. That halves
 * the worst case rather than eliminating it — see the note on the sampling window below for why the
 * remaining cost is deliberate.
 *
 * Freshness matters: the cache is keyed on the relay state, so flipping a port on or off discards
 * its stale reading instead of reporting the previous state's current for a cycle.
 */
struct CurrentReading {
  float amps;          // raw RMS, noise floor NOT applied (callers choose their own threshold)
  bool valid;          // false = never sampled, or invalidated by a relay change
  bool relayWasOn;     // which relay state the reading was taken under
#ifdef HAS_VOLTAGE_SENSE
  // Populated only when the voltage channel is compiled in AND the port was actually sampled.
  // `powerValid` distinguishes "measured 0 W" from "never measured" — a de-energised port is the
  // former, an unsampled one the latter, and the telemetry must not conflate them.
  float watts;         // real power
  float va;            // apparent power
  float pf;            // measured power factor
  float volts;         // mains RMS measured during this port's pass
  bool powerValid;
#endif
};

CurrentReading currentCache[NUM_PORTS] = {
  {0, false, false},
  {0, false, false},
  {0, false, false}
};

/**
 * Sample one port and store the result in the cache. The single sampling entry point, shared by the
 * bulk refresh and the cold-cache fallback so the two can never drift apart.
 */
void samplePortIntoCache(int i) {
  const bool relayOn = relayIsOn(i);
  CurrentReading& c = currentCache[i];

#ifdef HAS_VOLTAGE_SENSE
  if (relayOn) {
    PowerReading p = readPowerPort(CURRENT_SENSOR_PINS[i]);
    if (p.valid) {
      c.amps = p.amps;
      c.watts = p.watts;
      c.va = p.va;
      c.pf = p.pf;
      c.volts = p.volts;
      c.powerValid = true;
      // Publish the newest plausible mains reading. supplyVoltage() and the telemetry both read
      // this, so the two always agree about which voltage the watts were computed against.
      if (p.volts >= 50.0f && p.volts <= 300.0f) {
        measuredVoltageRms = p.volts;
        lastVoltageSampleMs = millis();
      }
    } else {
      // Sampled but unusable (flat line / too few samples). Report zero and say so, rather than
      // leaving a stale wattage on screen for a port whose sensor has failed.
      c.amps = 0.0f;
      c.watts = 0.0f;
      c.va = 0.0f;
      c.pf = 0.0f;
      c.volts = 0.0f;
      c.powerValid = false;
    }
  } else {
    c.amps = 0.0f;
    c.watts = 0.0f;
    c.va = 0.0f;
    c.pf = 0.0f;
    c.volts = 0.0f;
    c.powerValid = false;
  }
#else
  // A de-energised port draws nothing by definition — do not spend 100 ms proving it, and do not
  // let the sensor's own noise register as a load on a socket that is switched off.
  c.amps = relayOn ? readACS712RMS(CURRENT_SENSOR_PINS[i]) : 0.0f;
#endif

  c.valid = true;
  c.relayWasOn = relayOn;
}

/** Take one fresh reading for every port and refresh the cache. Call once per loop iteration. */
void refreshCurrentCache() {
  for (int i = 0; i < NUM_PORTS; i++) samplePortIntoCache(i);
}

/**
 * Current on a port, from the cache. Falls back to a live read when the cache is cold or stale.
 *
 * `staleAfterMs` guards against the cache being read long after it was filled. In the normal loop
 * it is always fresh; the escape hatch exists so a caller running on a different schedule (or after
 * a long blocking operation) cannot silently act on an old number.
 */
float currentAmpsFor(int port, unsigned long staleAfterMs = 5000) {
  if (port < 0 || port >= NUM_PORTS) return 0.0f;
  bool relayOn = relayIsOn(port);

  CurrentReading& c = currentCache[port];
  bool usable = c.valid && c.relayWasOn == relayOn;
  if (!usable) samplePortIntoCache(port);
  (void)staleAfterMs; // retained for callers that need an explicit freshness policy
  return c.amps;
}

/**
 * Is real current flowing on this port?
 *
 * Deliberately separate from the display threshold above. The sensor is noisy enough that any
 * threshold is a judgement call, but the two uses want different answers:
 *
 *   * For DISPLAY, a low threshold is fine: 0.06 A = ~14 W at 230 V is genuinely "something is
 *     plugged in", and showing 0 is friendlier than showing sensor hiss.
 *   * For the OCCUPANCY SHUTDOWN decision, a false "no current" cuts power to a load the user is
 *     actively using. A false "current present" merely leaves a port on a bit longer — annoying,
 *     not destructive. The asymmetry means the shutdown threshold must be HIGHER, and it is.
 *
 * Requiring the reading to stay low across several consecutive samples also rejects a single
 * transient (a motor's inrush collapsing, a zero-crossing coincidence) triggering a shutdown.
 *
 * The debounce streak is PER PORT. A single shared counter was wrong: one idle port would
 * accumulate the streak on behalf of an active one, so a port with genuine load could be shut down
 * because its neighbours were quiet.
 */
#define CURRENT_ACTIVE_THRESHOLD_A 0.10f // ~23 W at 230 V
#define CURRENT_IDLE_SAMPLES        3    // consecutive low readings before "really idle"
int currentIdleStreak[NUM_PORTS] = {0, 0, 0};

bool currentIsFlowing(int port) {
  if (port < 0 || port >= NUM_PORTS) return false;

  float amps = currentAmpsFor(port);
  if (amps >= CURRENT_ACTIVE_THRESHOLD_A) {
    currentIdleStreak[port] = 0;
    return true;
  }
  if (currentIdleStreak[port] < CURRENT_IDLE_SAMPLES) currentIdleStreak[port]++;
  return currentIdleStreak[port] < CURRENT_IDLE_SAMPLES;
}

/** Same value, with the noise floor applied. Used for telemetry and history only. */
float readACS712ForDisplay(int port) {
  float amps = currentAmpsFor(port);
  return amps < CURRENT_NOISE_FLOOR_A ? 0.0f : amps;
}

/**
 * Should this port survive a shutdown?
 *
 * The answer is the port's STATED POLICY, never a guess from its current draw. The old rule asked
 * "is it drawing current?", which for this device's loads protected exactly the wrong things — see
 * `enum PortPolicy`. A lamp draws current whether or not anyone is in the room, so a lamp left
 * burning in an empty room was kept on; a phone on a small charger draws little, so it was cut.
 *
 * Shared by the shutdown itself and by the periodic re-check, so the two cannot drift apart.
 */
bool shouldKeepPortOnShutdown(int port) {
  if (port < 0 || port >= NUM_PORTS) return false;
  switch (portPolicy[port]) {
    case POLICY_ALWAYS_ON:
      return true;
    case POLICY_KEEP_WHILE_DRAWING:
      // `currentIsFlowing` uses the higher, debounced threshold — see its comment. It reads the
      // per-cycle cache, so no ADC sweep is repeated here.
      return currentIsFlowing(port);
    case POLICY_OCCUPANCY:
    default:
      // The device's whole purpose. A port with this policy is cut when the room empties,
      // regardless of what it is drawing.
      return false;
  }
}

#ifdef HAS_VOLTAGE_SENSE
// ---------------------------------------------------------------------------
// Voltage-only sampling, and the power accessors
// ---------------------------------------------------------------------------
// Port passes read the voltage channel only while a port is energised, because the product needs a
// simultaneous current. That leaves two gaps: with every port off the reported voltage would freeze
// at its last value, and — more practically — a bench unit with nothing plugged in could never be
// CALIBRATED, since calibration means comparing the reported voltage against a multimeter.
//
// So the voltage channel also gets a standalone true-RMS read, rate-limited so it costs nothing in
// the common case. The rate limit matters: a pass is ~100 ms of blocking ADC work, and the loop
// also has an occupancy state machine running on millis().
#define VOLTAGE_ONLY_MIN_INTERVAL_MS 5000UL

/** True-RMS read of the voltage channel alone. Same method as readPowerPort, minus the current. */
float readVoltageOnly() {
  int n = 0;
  uint32_t start = millis();
  while ((millis() - start) < CURRENT_SAMPLE_MS && n < POWER_SAMPLE_MAX) {
    powerSampV[n] = (int16_t)analogReadMilliVolts(VOLTAGE_SENSE_PIN);
    n++;
    delayMicroseconds(CURRENT_SAMPLE_US);
  }
  if (n < 16) return 0.0f;

  int64_t sum = 0;
  for (int k = 0; k < n; k++) sum += powerSampV[k];
  const int32_t bias = (int32_t)(sum / n);

  int64_t sumSq = 0;
  for (int k = 0; k < n; k++) {
    const int32_t d = (int32_t)powerSampV[k] - bias;
    sumSq += (int64_t)d * d;
  }
  const float adcVrms_mV = (float)sqrt((double)sumSq / (double)n);
  if (adcVrms_mV <= 0.0f) return 0.0f;
  return adcVrms_mV / voltageCalMvPerV;
}

/**
 * Keep the measured voltage fresh when no port is energised.
 *
 * Called once per loop. Cheap in the normal case (a timestamp compare); only pays for a real
 * sampling pass when every port is off AND the reading is older than the interval.
 */
void refreshVoltageOnlyIfStale() {
  bool anyPortOn = false;
  for (int i = 0; i < NUM_PORTS; i++) {
    if (relayIsOn(i)) {
      anyPortOn = true;
      break;
    }
  }
  // With a port energised, its pass already refreshed the voltage — nothing to do.
  if (anyPortOn) return;
  if (lastVoltageSampleMs != 0 && (millis() - lastVoltageSampleMs) < VOLTAGE_ONLY_MIN_INTERVAL_MS) return;

  const float v = readVoltageOnly();
  lastVoltageSampleMs = millis();
  if (v >= 50.0f && v <= 300.0f) measuredVoltageRms = v;
}

/** Real power for a port, or its apparent power when no voltage channel was compiled in. */
float wattsFor(int port) {
  if (port < 0 || port >= NUM_PORTS) return 0.0f;
  currentAmpsFor(port); // ensure the cache is populated
  const CurrentReading& c = currentCache[port];
  if (c.powerValid) return c.watts;
  // Sensing compiled in but this port was not sampled (relay off) — no power by definition.
  return 0.0f;
}

/** Apparent power for a port. Equals the real power only at unity power factor. */
float vaFor(int port) {
  if (port < 0 || port >= NUM_PORTS) return 0.0f;
  currentAmpsFor(port);
  const CurrentReading& c = currentCache[port];
  return c.powerValid ? c.va : 0.0f;
}

/** Measured power factor for a port, or 0 when nothing was measured. */
float powerFactorFor(int port) {
  if (port < 0 || port >= NUM_PORTS) return 0.0f;
  currentAmpsFor(port);
  const CurrentReading& c = currentCache[port];
  return c.powerValid ? c.pf : 0.0f;
}
#endif

// ---------------------------------------------------------------------------
// Soft overcurrent cutoff — a SECOND line of defence, NOT a fuse
// ---------------------------------------------------------------------------
// READ THIS BEFORE TRUSTING IT. The install has NO fuse and NO breaker. This is a software trip on
// a current reading, and it is strictly weaker than a physical protective device for three reasons
// that cannot be fixed in firmware:
//
//   1. THE SENSOR SATURATES. The default ACS712-05B reads 0-5 A and then flattens. A dead short
//      drawing 30 A reads as ~5 A — the fault is INVISIBLE to this code. Anything above the
//      sensor's range cannot be detected, only the band just below it.
//   2. A RELAY IS NOT A PROTECTIVE DEVICE. Contacts can weld closed under fault current. Opening
//      the relay is best-effort; it is not guaranteed to interrupt.
//   3. 1.15 kW per port at 5 A / 230 V. Real protection means a fuse or MCB sized to the wiring.
//
// So this catches a SPECIFIC, USEFUL CLASS of fault — a stalled motor, a failing appliance, an
// overload sustained just under the sensor's ceiling — and it does so by *reducing* the time the
// fault persists rather than by interrupting it. Do not let its presence imply the installation is
// protected. The fuse is still on the hardware list.
//
// WHY A SEPARATE DEBOUNCE STREAK. The idle detector counts CONSECUTIVE LOW readings; this counts
// CONSECUTIVE HIGH ones. They observe opposite conditions, so sharing one counter would have each
// reset the other's progress and neither would ever complete. Separate counters, separate
// thresholds, same per-port shape.
//
// WHY A DELAY. A motor's inrush is several times its running current for a fraction of a second. A
// bare instantaneous compare would trip on every compressor start — switching off a fridge that was
// working perfectly. The trip therefore requires the overload to PERSIST across several samples, so
// only a sustained fault trips. The cost is a short delay before the relay opens, which is the
// correct trade for not disconnecting healthy appliances.
#define OVERCURRENT_LIMIT_A      4.50f  // ACS712-05B saturates at 5 A; trip just below the ceiling
#define OVERCURRENT_TRIP_SAMPLES 5      // ~0.5 s sustained; above inrush, below damage timescales
int overcurrentStreak[NUM_PORTS] = {0, 0, 0};
bool overcurrentTripped[NUM_PORTS] = {false, false, false};

// Runtime-overridable, like nominalVoltage. Valid band is bounded by what the SENSOR can see: a
// limit above ~5 A is unreachable on the 5 A part and would silently never fire, which is worse
// than a wrong-looking number because it reads as protection that is not there.
float overcurrentLimitA = OVERCURRENT_LIMIT_A;

/** Clamp a configured limit into the band the fitted sensor can actually measure. */
bool overcurrentLimitIsSane(float v) {
  return v >= 0.5f && v <= 5.0f;
}

/**
 * Should this port be tripped for overcurrent? Called once per loop from the cached reading.
 * Returns true only on the transition into a tripped state, so the caller alerts exactly once.
 */
bool overcurrentShouldTrip(int port) {
  if (port < 0 || port >= NUM_PORTS) return false;

  // A de-energised port cannot overload. Clearing the streak here also means re-enabling a port
  // starts from a clean count rather than inheriting the fault that tripped it.
  if (!relayIsOn(port)) {
    overcurrentStreak[port] = 0;
    overcurrentTripped[port] = false;
    return false;
  }

  float amps = currentAmpsFor(port);
  if (amps < overcurrentLimitA) {
    overcurrentStreak[port] = 0;
    overcurrentTripped[port] = false;
    return false;
  }

  if (overcurrentStreak[port] < OVERCURRENT_TRIP_SAMPLES) {
    overcurrentStreak[port]++;
    Serial.printf("Port %d overcurrent: %.2f A (limit %.2f) — %d/%d\n",
                  port + 1, amps, overcurrentLimitA, overcurrentStreak[port], OVERCURRENT_TRIP_SAMPLES);
  }
  if (overcurrentStreak[port] < OVERCURRENT_TRIP_SAMPLES) return false;
  if (overcurrentTripped[port]) return false; // already tripped; alert only on the edge

  overcurrentTripped[port] = true;
  return true;
}

/**
 * Run the overcurrent check across every port and act on any trip.
 *
 * Kept out of the state machine on purpose: a fault is not an occupancy event, and routing it
 * through the idle/response-window logic would mean a fault on a port in an OCCUPIED room waited
 * for the room to empty before being noticed.
 */
void checkOvercurrent() {
  bool anyTripped = false;
  FirebaseJson relayUpdateJson;

  for (int i = 0; i < NUM_PORTS; i++) {
    if (!overcurrentShouldTrip(i)) continue;

    float amps = currentAmpsFor(i);

    // Open the relay first. Everything else — NVS, the cloud, the alert — is secondary to
    // interrupting the fault, and each of those can fail or block. `force=true` is load-bearing:
    // the derating rules must never delay cutting a fault. See the relay derating section.
    runRelaySwitch(i, false, /*force=*/true);
    String portPrefix = "ports/port_0" + String(i + 1) + "/";
    relayUpdateJson.set(portPrefix + "relay_status", false);
    anyTripped = true;

    Serial.printf("OVERCURRENT TRIP: port %d cut at %.2f A (limit %.2f A).\n",
                  i + 1, amps, overcurrentLimitA);

    // Fire-and-forget, like every other alert — this must not block the loop.
    sendAlert(
      "\xE2\x9A\xA0\xEF\xB8\x8F VoltSense Overcurrent",
      "Outlet " + String(i + 1) + " was drawing too much current and has been switched off.",
      "volt-sense-overcurrent");
  }

  if (!anyTripped) return;

  // Commit the new port state to NVS BEFORE the cloud write, so a brownout between the two leaves
  // the restored state matching the relays rather than the database. Same ordering as the
  // occupancy shutdown path.
  persistRelayState();
  watchdogFeed();
  rtdbPatchJson(roomPath, relayUpdateJson);
  watchdogFeed();
}

// ---------------------------------------------------------------------------
// History: load / persist / rollup
// ---------------------------------------------------------------------------
int findDailyIndex(const String& date) {
  for (int i = 0; i < dailyCount; i++) {
    if (dailyHistory[i].date == date) return i;
  }
  return -1;
}

void loadHistory() {
  Preferences p;
  p.begin("voltsense", true);
  String blob = p.getString("history", "");
  String dayBlob = p.getString("hist_hourly", "");
  historyDayDate = p.getString("hist_day", "");
  String energyBlob = p.getString("energy", "");
  p.end();

  if (blob.length() > 0) {
    FirebaseJson json;
    json.setJsonData(blob);
    size_t count = json.iteratorBegin();
    dailyCount = 0;
    for (size_t i = 0; i < count && dailyCount < MAX_HISTORY_DAYS; i++) {
      int type; String key, value;
      json.iteratorGet(i, type, key, value);
      FirebaseJson entry;
      entry.setJsonData(value);
      FirebaseJsonData d;
      DailyRecord rec;
      rec.date = key;
      entry.get(d, "e"); rec.energyKwh = d.success ? (float)d.doubleValue : 0.0f;
      entry.get(d, "m"); rec.occupiedMinutes = d.success ? (uint16_t)d.intValue : 0;
      entry.get(d, "p"); rec.peakWatts = d.success ? (float)d.doubleValue : 0.0f;
      dailyHistory[dailyCount++] = rec;
    }
    json.iteratorEnd();
  }

  // Hourly buckets for the in-progress day
  for (int h = 0; h < 24; h++) {
    todayHourlyKwh[h] = 0.0f;
    todayHourlyOccupied[h] = false;
  }
  if (dayBlob.length() > 0) {
    FirebaseJson json;
    json.setJsonData(dayBlob);
    size_t count = json.iteratorBegin();
    for (size_t i = 0; i < count; i++) {
      int type; String key, value;
      json.iteratorGet(i, type, key, value);
      int h = key.toInt();
      if (h >= 0 && h < 24) todayHourlyKwh[h] = value.toFloat();
    }
    json.iteratorEnd();
  }

  // Per-port energy counters (M7: previously RAM-only, so any reboot reset the day to zero)
  if (energyBlob.length() > 0) {
    FirebaseJson json;
    json.setJsonData(energyBlob);
    FirebaseJsonData d;
    for (int i = 0; i < NUM_PORTS; i++) {
      json.get(d, "p" + String(i));
      if (d.success) portEnergyKWh[i] = (float)d.doubleValue;
    }
  }

  Serial.printf("History loaded: %d day(s), today date=%s\n", dailyCount, historyDayDate.c_str());
}

void persistEnergyCounters() {
  FirebaseJson json;
  for (int i = 0; i < NUM_PORTS; i++) {
    json.set("p" + String(i), portEnergyKWh[i]);
  }
  String out;
  json.toString(out);

  Preferences p;
  p.begin("voltsense", false);
  p.putString("energy", out);
  p.end();
}

void persistHistory() {
  FirebaseJson json;
  for (int i = 0; i < dailyCount; i++) {
    FirebaseJson entry;
    entry.set("e", dailyHistory[i].energyKwh);
    entry.set("m", dailyHistory[i].occupiedMinutes);
    entry.set("p", dailyHistory[i].peakWatts);
    json.set(dailyHistory[i].date, entry);
  }
  String blob;
  json.toString(blob);

  FirebaseJson hourly;
  for (int h = 0; h < 24; h++) {
    hourly.set(String(h), todayHourlyKwh[h]);
  }
  String hourlyBlob;
  hourly.toString(hourlyBlob);

  Preferences p;
  p.begin("voltsense", false);
  p.putString("history", blob);
  p.putString("hist_hourly", hourlyBlob);
  p.putString("hist_day", historyDayDate);
  p.end();
}

// Roll the hourly buckets into a daily record and start a fresh day.
void rolloverDayIfNeeded() {
  String today = getLocalDateString();
  if (today.length() == 0) return;

  if (historyDayDate.length() == 0) {
    historyDayDate = today;
    return;
  }
  if (historyDayDate == today) return;

  // Flush the completed day into the ring buffer.
  float dayEnergy = 0;
  int occupiedMin = 0;
  for (int h = 0; h < 24; h++) {
    dayEnergy += todayHourlyKwh[h];
    if (todayHourlyOccupied[h]) occupiedMin += 60;
  }

  int idx = findDailyIndex(historyDayDate);
  if (idx == -1) {
    if (dailyCount >= MAX_HISTORY_DAYS) {
      // Drop the oldest entry (records are appended in chronological order).
      for (int i = 1; i < MAX_HISTORY_DAYS; i++) dailyHistory[i - 1] = dailyHistory[i];
      dailyCount = MAX_HISTORY_DAYS - 1;
    }
    idx = dailyCount++;
    dailyHistory[idx].date = historyDayDate;
    dailyHistory[idx].peakWatts = 0;
  }
  dailyHistory[idx].energyKwh = dayEnergy;
  dailyHistory[idx].occupiedMinutes = occupiedMin;

  Serial.printf("Day rollover: %s -> %s (%.3f kWh, %d min occupied)\n",
                historyDayDate.c_str(), today.c_str(), dayEnergy, occupiedMin);

  historyDayDate = today;
  for (int h = 0; h < 24; h++) {
    todayHourlyKwh[h] = 0.0f;
    todayHourlyOccupied[h] = false;
  }
  persistHistory();
}

/**
 * Publish the raw daily records as they are stored on the device.
 *
 * WHY THIS EXISTS — the custom-date-range fix.
 *
 * The Analytics page lets the user pick an arbitrary range ("10/01 - 10/15"), maps it to a key like
 * `custom_20251001_20251015`, and reads that node. The firmware only ever published the four FIXED
 * ranges (today / yesterday / last_7_days / this_month), so every custom range read a node that no
 * one had ever written and the chart came back empty — permanently, and with no error to explain it.
 *
 * A device cannot anticipate every range a user might pick, so it should not try. Instead it
 * publishes the UNDERLYING daily records once, and the CLIENT composes whatever range it needs from
 * them. That is one extra node instead of an unbounded set of keys, and it makes the custom picker
 * work for any range the 31-day retention can cover.
 *
 * Shape: history/days/<YYYY-MM-DD> = { e: kWh, m: occupiedMinutes, p: peakWatts }
 * The short keys match persistHistory()'s NVS blob, which is deliberate — one vocabulary to learn.
 */
void publishDailyRecords() {
  if (!rtdbEnsureToken()) return;

  FirebaseJson out;
  for (int i = 0; i < dailyCount; i++) {
    FirebaseJson entry;
    entry.set("e", dailyHistory[i].energyKwh);
    entry.set("m", dailyHistory[i].occupiedMinutes);
    entry.set("p", dailyHistory[i].peakWatts);
    out.set(dailyHistory[i].date, entry);
  }

  // Today's partial total is not in dailyHistory yet (it is only written at day rollover), so add it.
  // Without this the latest day would be missing from every composed range until midnight.
  if (historyDayDate.length() > 0) {
    FirebaseJson todayEntry;
    float dayEnergy = 0;
    int dayOccupiedMin = 0;
    for (int h = 0; h < 24; h++) {
      dayEnergy += todayHourlyKwh[h];
      if (todayHourlyOccupied[h]) dayOccupiedMin += 60;
    }
    todayEntry.set("e", dayEnergy);
    todayEntry.set("m", dayOccupiedMin);
    todayEntry.set("p", 0);
    out.set(historyDayDate, todayEntry);
  }

  if (!rtdbPutJson(roomPath + "/history/days", out)) {
    Serial.println("history/days write failed");
  }
}

// Publish the range nodes the Analytics page reads.
void publishHistoryRanges() {
  if (!rtdbEnsureToken()) return;
  rolloverDayIfNeeded();

  // ---------------- today (hourly granularity) ----------------
  FirebaseJson todayJson;
  FirebaseJsonArray todayEnergy;
  FirebaseJsonArray todayOcc;
  float todayTotal = 0;
  int todayOccupiedMin = 0;
  for (int h = 0; h < 24; h++) {
    FirebaseJson e;
    e.set("label", hourLabel(h));
    e.set("kwh", todayHourlyKwh[h]);
    todayEnergy.add(e);

    FirebaseJson o;
    o.set("label", hourLabel(h));
    o.set("occupied", todayHourlyOccupied[h] ? 1 : 0);
    todayOcc.add(o);

    todayTotal += todayHourlyKwh[h];
    if (todayHourlyOccupied[h]) todayOccupiedMin += 60;
  }
  todayJson.set("energy", todayEnergy);
  todayJson.set("occupancy", todayOcc);
  todayJson.set("totals/energy", todayTotal);
  todayJson.set("totals/hours", todayOccupiedMin / 60.0);

  if (!rtdbPutJson(roomPath + "/history/today", todayJson)) {
    Serial.println("history/today write failed");
  }

  // ---------------- daily ranges ----------------
  publishDailyRange("yesterday", 1, 1);
  publishDailyRange("last_7_days", 6, 0);
  publishDailyRange("this_month", getLocalDayOfMonth() - 1, 0);

  // The raw per-day records, so the app can compose ANY custom range itself. Published after the
  // fixed ranges because those are what the default view reads — if this fails, the default view
  // still works.
  publishDailyRecords();
}

// startDaysAgo / endDaysAgo are offsets back from today (0 = today).
void publishDailyRange(const String& key, int startDaysAgo, int endDaysAgo) {
  if (dailyCount == 0 && endDaysAgo > 0) {
    // Nothing recorded yet for past days — publish an empty but well-formed node.
    FirebaseJsonArray emptyEnergy;
    FirebaseJsonArray emptyOcc;
    FirebaseJson empty;
    empty.set("energy", emptyEnergy);
    empty.set("occupancy", emptyOcc);
    empty.set("totals/energy", 0);
    empty.set("totals/hours", 0);
    rtdbPutJson(roomPath + "/history/" + key, empty);
    return;
  }

  FirebaseJson out;
  FirebaseJsonArray energyArr;
  FirebaseJsonArray occArr;
  float totalEnergy = 0;
  int totalOccupiedMin = 0;

  // Walk chronologically so the chart x-axis reads left-to-right.
  for (int offset = startDaysAgo; offset >= endDaysAgo; offset--) {
    float dayEnergy = 0;
    int dayOccupied = 0;

    if (offset == 0) {
      // Today so far
      for (int h = 0; h < 24; h++) {
        dayEnergy += todayHourlyKwh[h];
        if (todayHourlyOccupied[h]) dayOccupied += 60;
      }
    } else {
      int idx = findDailyIndex(dayOffsetToDate(offset));
      if (idx != -1) {
        dayEnergy = dailyHistory[idx].energyKwh;
        dayOccupied = dailyHistory[idx].occupiedMinutes;
      }
    }

    String label = dayOffsetToDate(offset);
    if (label.length() >= 10) label = String(label.substring(8, 10).toInt()); // "12"

    FirebaseJson e;
    e.set("label", label);
    e.set("kwh", dayEnergy);
    energyArr.add(e);

    FirebaseJson o;
    o.set("label", label);
    o.set("occupied", dayOccupied > 0 ? 1 : 0);
    occArr.add(o);

    totalEnergy += dayEnergy;
    totalOccupiedMin += dayOccupied;
  }

  out.set("energy", energyArr);
  out.set("occupancy", occArr);
  out.set("totals/energy", totalEnergy);
  out.set("totals/hours", totalOccupiedMin / 60.0);

  if (!rtdbPutJson(roomPath + "/history/" + key, out)) {
    Serial.printf("history/%s write failed\n", key.c_str());
  }
}

String dayOffsetToDate(int daysAgo) {
  time_t t = timeClient.getEpochTime() - (time_t)daysAgo * 86400L;
  struct tm* ti = gmtime(&t);
  if (!ti) return "";
  char buf[11];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d", ti->tm_year + 1900, ti->tm_mon + 1, ti->tm_mday);
  return String(buf);
}

// ---------------------------------------------------------------------------
// Alerts
//
// The device holds no messaging credential. It sends a small JSON document to the VoltSense
// serverless endpoint, which owns the push keys, resolves who to notify, and reports back.
//
// The call is deliberately fire-and-forget: `sendAlert()` kicks off a one-shot FreeRTOS task and
// returns immediately. A blocking HTTPS request here would stall the occupancy state machine,
// which is driven by `millis()` — and the response window is only 60 seconds wide. A cold start on
// the server can take seconds, so waiting for the response is not acceptable.
// ---------------------------------------------------------------------------

// Escape the few characters that would break the hand-built JSON document. The alert text is
// compiled in, not user input, but titles can carry emoji and quotes; a raw quote would produce
// invalid JSON and the server would reject the alert.
String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 16);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if ((uint8_t)c < 0x20) {
          // Control characters are not legal in a JSON string.
          continue;
        }
        out += c;
    }
  }
  return out;
}

struct AlertPayload {
  String mac;
  String title;
  String body;
  String tag;
};

// Owns the payload while a send is in flight. Guarded by `inFlight` rather than inspected for
// null-ness, because the task frees the payload before the handle is cleared.
AlertPayload* pendingAlert = nullptr;
volatile bool alertInFlight = false;
TaskHandle_t alertTaskHandle = nullptr;

// Runs on its own core so a slow or unreachable endpoint cannot stall the occupancy machine.
// Single exit point at the bottom: every early return would otherwise have to remember to release
// the in-flight flag, and missing one locks alerting out permanently.
void alertTask(void* parameter) {
  AlertPayload* alert = (AlertPayload*)parameter;

  if (alert) {
    String secret = getAlertSecret();
    if (secret.length() == 0) {
      Serial.println("Alert skipped: no `alert_secret` in NVS. Run ProvisionToken.ino.");
    } else {
      String payload = "{";
      payload += "\"secret\":\"" + jsonEscape(secret) + "\",";
      payload += "\"mac\":\"" + jsonEscape(alert->mac) + "\",";
      payload += "\"title\":\"" + jsonEscape(alert->title) + "\",";
      payload += "\"body\":\"" + jsonEscape(alert->body) + "\",";
      payload += "\"tag\":\"" + jsonEscape(alert->tag) + "\"";
      payload += "}";

      WiFiClientSecure client;
      client.setCACert(API_ROOT_CA_BUNDLE);

      HTTPClient http;
      http.setTimeout(8000);
      http.setReuse(false);

      if (!http.begin(client, ALERT_URL)) {
        Serial.println("Alert: http.begin failed");
      } else {
        http.addHeader("Content-Type", "application/json");
        int code = http.POST(payload);
        if (code > 0) {
          Serial.printf("Alert -> HTTP %d: %s\n", code, http.getString().c_str());
        } else {
          Serial.printf("Alert failed: %s\n", http.errorToString(code).c_str());
        }
        http.end();
      }
    }
  }

  delete alert;
  pendingAlert = nullptr;
  alertTaskHandle = nullptr;
  alertInFlight = false;
  vTaskDelete(NULL);
}

// Queue an alert for delivery. Safe to call from the state machine: it only allocates and returns.
//
// If a previous alert is still in flight it is dropped rather than queued — occupancy alerts are
// time-critical and stale ones are actively misleading ("shutting down in 60 seconds" delivered
// two minutes late is worse than no alert at all).
void sendAlert(const String& title, const String& body, const String& tag = "voltsense-alert") {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Cannot send alert.");
    return;
  }

  if (alertInFlight) {
    Serial.println("Alert already in flight; dropping this one.");
    return;
  }

  if (macAddress.length() == 0) {
    Serial.println("Alert skipped: MAC not known yet.");
    return;
  }

  AlertPayload* alert = new AlertPayload();
  alert->mac = macAddress;
  alert->title = title;
  alert->body = body;
  alert->tag = tag;

  // 8 KB of stack: a TLS handshake plus JSON building needs considerably more than the default
  // 2 KB budget. Priority 1 keeps it below the main loop so telemetry keeps flowing.
  //
  // The payload is handed straight to the task as its parameter — never read from the shared
  // `pendingAlert` pointer inside the task, or a second sendAlert() could swap it mid-flight.
  //
  // The flag is set BEFORE the task is created so a task that starts and finishes instantly cannot
  // clear it to false and then be overwritten by a late assignment here.
  alertInFlight = true;
  pendingAlert = alert;

  BaseType_t created = xTaskCreatePinnedToCore(
    alertTask,
    "alertTask",
    8192,
    (void*)alert,
    1,
    &alertTaskHandle,
    1
  );

  if (created != pdPASS) {
    Serial.println("Alert task could not be created.");
    pendingAlert = nullptr;
    alertInFlight = false;
    delete alert;
  }
}

// ---------------------------------------------------------------------------
// Remote changes — what the app asked for (replaces the RTDB stream)
// ---------------------------------------------------------------------------
// The Realtime Database stream is gone: its transport is the part of the client library that cannot
// handshake on ESP32 core 3.x. pollRemoteChanges() fetches the room node over REST and dispatches
// each changed field through the handler below, which is the same body the stream used.
// `struct RemoteChange` is declared in VoltSenseTypes.h — it appears in a function signature, so it
// must be visible above the prototypes the Arduino build generates. See that file for the details.

void applyRemoteChange(const RemoteChange& data) {
  String path = data.dataPath();
  Serial.printf("Remote change: %s\n", path.c_str());

  if (path == "/override") {
    overrideActive = data.boolData();
    Serial.printf("Override set to: %s\n", overrideActive ? "true" : "false");

    // If override is enabled, force relays ON and reset state
    if (overrideActive) {
      setAllRelays(true);
      persistRelayState();
      currentState = STATE_OCCUPIED;
      lastMotionMillis = millis(); // Reset timer
      // Reset override flag in database to avoid getting stuck
      rtdbPutBool(roomPath + "/override", false);
    }
  } else if (path == "/ports/port_01/relay_status") {
    // Derated, and the outcome is written back: a rapid tap sequence must not actuate the relay more
    // than the dwell/rate rules allow, and when a tap is rejected the app's toggle is snapped back
    // to the state the relay is actually in. See the relay derating section.
    runRelaySwitchAndSync(0, data.boolData());
  } else if (path == "/ports/port_02/relay_status") {
    runRelaySwitchAndSync(1, data.boolData());
  } else if (path == "/ports/port_03/relay_status") {
    runRelaySwitchAndSync(2, data.boolData());
  } else if (path.startsWith("/ports/port_0") && path.endsWith("/policy")) {
    // Parsed generically rather than as three branches, so adding a port does not add branches.
    // "/ports/port_0X/policy" — the port digit is at index 13.
    const int port = path.charAt(13) - '1';
    if (port >= 0 && port < NUM_PORTS) {
      portPolicy[port] = policyFromString(data.stringData());
      Serial.printf("Port %d policy -> %s\n", port + 1, policyToString(portPolicy[port]));
    }
  } else if (path == "/settings/night_mode_enabled") {
    nightModeEnabled = data.boolData();
  } else if (path == "/settings/mmwave_enabled") {
    mmwaveEnabled = data.boolData();
  } else if (path == "/settings/night_mode_start") {
    nightModeStart = data.stringData();
  } else if (path == "/settings/night_mode_end") {
    nightModeEnd = data.stringData();
  } else if (path == "/settings/inactivity_limit_minutes") {
    int minutes = data.intData();
    if (minutes > 0) idleTimeoutMs = (unsigned long)minutes * 60 * 1000UL;
  } else if (path == "/settings/nominal_voltage") {
    // Optional. Only meaningful if the user has actually measured their supply; the value is
    // clamped by supplyVoltage() so a typo cannot produce absurd power numbers.
    float v = data.floatData();
    if (v >= 50.0f && v <= 300.0f) {
      nominalVoltage = v;
      setNvsString("nominal_voltage", String(v, 1));
      Serial.printf("Nominal voltage set to %.1f V\n", v);
    } else {
      Serial.printf("Ignoring nominal_voltage %.1f (outside 50-300 V)\n", v);
    }
  } else if (path == "/settings/overcurrent_limit_a") {
    // Optional. Clamped to what the fitted sensor can actually resolve — a limit above ~5 A on the
    // 5 A part would never fire and would read as protection that is not present.
    float a = data.floatData();
    if (overcurrentLimitIsSane(a)) {
      overcurrentLimitA = a;
      setNvsString("overcurrent_a", String(a, 2));
      Serial.printf("Overcurrent limit set to %.2f A\n", a);
    } else {
      Serial.printf("Ignoring overcurrent_limit_a %.2f (outside 0.5-5.0 A)\n", a);
    }
#ifdef HAS_VOLTAGE_SENSE
  } else if (path == "/settings/voltage_cal_mv_per_v") {
    // The voltage sensor's transfer function. Adjustable at runtime so a unit can be CALIBRATED
    // without a reflash: measure the socket with a multimeter, compare against the reported
    // voltage, and correct this until they agree. Persisted to NVS.
    //
    // Bounded to 1-20 mV/V, which brackets every realistic divider/op-amp combination. The bound is
    // load-bearing rather than tidy: this value DIVIDES into every voltage reading, so a typo like
    // 460 instead of 4.6 would scale the whole system down by 100x and every wattage with it —
    // producing confident, plausible, completely wrong numbers.
    float cal = data.floatData();
    if (cal >= 1.0f && cal <= 20.0f) {
      voltageCalMvPerV = cal;
      setNvsString("voltage_cal", String(cal, 3));
      Serial.printf("Voltage calibration set to %.3f mV/V\n", cal);
    } else {
      Serial.printf("Ignoring voltage_cal_mv_per_v %.3f (outside 1-20 mV/V)\n", cal);
    }
#endif
  } else if (path == "/") {
    // Handle full object initialization
    FirebaseJson json;
    json.setJsonData(data.jsonString());
    FirebaseJsonData result;

    json.get(result, "override");
    if (result.success) overrideActive = result.boolValue;

    json.get(result, "settings/night_mode_enabled");
    if (result.success) nightModeEnabled = result.boolValue;

    json.get(result, "settings/mmwave_enabled");
    if (result.success) mmwaveEnabled = result.boolValue;

    json.get(result, "settings/night_mode_start");
    if (result.success) nightModeStart = result.stringValue;

    json.get(result, "settings/night_mode_end");
    if (result.success) nightModeEnd = result.stringValue;

    json.get(result, "settings/inactivity_limit_minutes");
    if (result.success && result.intValue > 0) {
      idleTimeoutMs = (unsigned long)result.intValue * 60 * 1000UL;
    }

    json.get(result, "settings/nominal_voltage");
    if (result.success && result.floatValue >= 50.0f && result.floatValue <= 300.0f) {
      nominalVoltage = result.floatValue;
    }

    json.get(result, "settings/overcurrent_limit_a");
    if (result.success && overcurrentLimitIsSane(result.floatValue)) {
      overcurrentLimitA = result.floatValue;
    }

    json.get(result, "ports/port_01/relay_status");
    if (result.success) runRelaySwitch(0, result.boolValue, /*force=*/true);

    json.get(result, "ports/port_02/relay_status");
    if (result.success) runRelaySwitch(1, result.boolValue, /*force=*/true);

    json.get(result, "ports/port_03/relay_status");
    if (result.success) runRelaySwitch(2, result.boolValue, /*force=*/true);

    // Per-port shutdown policy. Absent means `occupancy`, which is what the initialiser already
    // holds — so a device whose database predates this setting behaves as before rather than
    // silently gaining a new one.
    json.get(result, "ports/port_01/policy");
    if (result.success) portPolicy[0] = policyFromString(result.stringValue);

    json.get(result, "ports/port_02/policy");
    if (result.success) portPolicy[1] = policyFromString(result.stringValue);

    json.get(result, "ports/port_03/policy");
    if (result.success) portPolicy[2] = policyFromString(result.stringValue);

    persistRelayState();
  }
}

// Poll the room node for app-driven changes. This replaces the RTDB stream, whose transport is the
// part of the client library that cannot handshake on ESP32 core 3.x. One small GET every few
// seconds, and nothing is dispatched unless the payload actually changed.
unsigned long lastRemotePollMillis = 0;
String lastRemoteJson = "";
const unsigned long RTDB_POLL_INTERVAL_MS = 3000UL;

void pollRemoteChanges() {
  if (roomPath.length() == 0) return;
  if (millis() - lastRemotePollMillis < RTDB_POLL_INTERVAL_MS) return;
  lastRemotePollMillis = millis();

  String body;
  if (!rtdbRequest("GET", roomPath, "", &body)) return;
  if (body.length() == 0 || body == "null") return;

  // Report what the database actually holds once telemetry is there. This is the honest end-to-end
  // check: it proves the values this device writes really land in the RTDB, rather than only that a
  // request returned 2xx. Gives up after a few polls so a silent failure still says so.
  static int pollCount = 0;
  static bool reportedFirstPoll = false;
  pollCount++;
  const bool hasTelemetry = body.indexOf("total_power_watts") >= 0;
  if (!reportedFirstPoll && (hasTelemetry || pollCount > 20)) {
    reportedFirstPoll = true;
    Serial.printf("RTDB read-back: %u bytes, telemetry=%s, diag=%s (poll #%d)\n",
                  (unsigned)body.length(), hasTelemetry ? "yes" : "NO",
                  body.indexOf("rest_ok") >= 0 ? "yes" : "no", pollCount);
  }

  if (body == lastRemoteJson) return;  // nothing changed since the last poll
  lastRemoteJson = body;

  FirebaseJson json;
  json.setJsonData(body);
  FirebaseJsonData field;

  // The whole object first, so the defaults in the "/" branch land -- this mirrors the stream's
  // initial full-object event.
  RemoteChange whole;
  whole._path = "/";
  whole._json = body;
  applyRemoteChange(whole);

  // Then every control the app can touch.
  for (int i = 0; i < NUM_PORTS; i++) {
    const String suffix = "ports/port_0" + String(i + 1);

    RemoteChange relay;
    relay._path = "/" + suffix + "/relay_status";
    json.get(field, suffix + "/relay_status");
    if (field.success) {
      relay._bool = field.boolValue;
      applyRemoteChange(relay);
    }

    RemoteChange policy;
    policy._path = "/" + suffix + "/policy";
    json.get(field, suffix + "/policy");
    if (field.success) {
      policy._str = field.stringValue;
      applyRemoteChange(policy);
    }
  }
}

int timeToMinutes(String t) {
  int colonIndex = t.indexOf(':');
  if (colonIndex == -1) return 0;
  int h = t.substring(0, colonIndex).toInt();
  int m = t.substring(colonIndex + 1).toInt();
  return (h * 60) + m;
}

bool isNightModeActive() {
  if (!nightModeEnabled) return false;

  int currentMinutes = (timeClient.getHours() * 60) + timeClient.getMinutes();
  int startMinutes = timeToMinutes(nightModeStart);
  int endMinutes = timeToMinutes(nightModeEnd);

  if (startMinutes > endMinutes) {
    // Wraps over midnight (e.g. 22:00 to 06:00)
    return (currentMinutes >= startMinutes || currentMinutes < endMinutes);
  } else {
    // Same day (e.g. 01:00 to 05:00)
    return (currentMinutes >= startMinutes && currentMinutes < endMinutes);
  }
}

// ---------------------------------------------------------------------------
// Factory reset
//
// Held-button reset so a unit can be re-paired without a USB cable — needed when a device is
// returned, moved to a new owner, or its NVS is in a bad state.
//
// This ERASES the credentials. It does NOT erase the owner: `devices/<MAC>/owner` and
// `users/<uid>/owned_devices/<MAC>` live in the database, and re-pairing deliberately cannot touch
// them (see api/pair.js). So a stolen device cannot be re-paired to steal itself back — the
// original owner must release it. That is the correct default for anything wired to mains.
//
// Trigger: hold GPIO 0 (the BOOT button on most devkits) for 5 seconds at power-on.
// ---------------------------------------------------------------------------
void factoryResetIfRequested() {
  const int RESET_PIN = 0;
  const unsigned long HOLD_MS = 5000;

  pinMode(RESET_PIN, INPUT_PULLUP);
  if (digitalRead(RESET_PIN) != LOW) return;

  Serial.println("BOOT held — keep holding for 5s to factory reset...");
  unsigned long start = millis();
  while (digitalRead(RESET_PIN) == LOW) {
    if (millis() - start > HOLD_MS) {
      Serial.println("\nFactory reset: erasing device credentials from NVS.");

      Preferences p;
      p.begin("voltsense", false);
      p.remove("dev_email");
      p.remove("dev_password");
      p.remove("dev_id_token");
      p.remove("dev_refresh_token");
      p.remove("alert_secret");
      // The factory key is deliberately NOT erased from the build, but the "used" marker is, so
      // the next boot pairs again and mints a fresh code.
      p.remove("pairing_key_used");
      // Wi-Fi is kept: the unit is usually on the same network, and making the user re-enter Wi-Fi
      // as well turns a 30-second job into a 5-minute one.
      p.end();

      Serial.println("Credentials erased. Wi-Fi kept. Rebooting to re-pair...");
      delay(1000);
      ESP.restart();
    }
    delay(50);
  }
  Serial.println("Released early — continuing normal boot.");
}

// ---------------------------------------------------------------------------
// Relay boot state
// ---------------------------------------------------------------------------
//
// Relays default to ON for a reason that is easy to lose: a household appliance that is
// involuntarily off is a support call, and a port with nothing plugged in draws nothing anyway.
// But "always ON at boot" means a REBOOT UNDOES A SHUTDOWN. If the room emptied and the device cut
// the ports, a brownout or a watchdog reset 10 seconds later brings every socket back live in an
// empty room — the exact opposite of what the product exists to do.
//
// So the state is persisted and restored. The default stays ON for the first-ever boot (nothing in
// NVS yet), and each transition writes the new state, so a reboot resumes where it left off.
//
// Note this is the LOGICAL state, not the pin level. The pin level lives in RELAY_ON_LEVEL /
// RELAY_OFF_LEVEL at the top of the file — the fitted modules are ACTIVE-LOW, so HIGH means OFF.
#define NVS_KEY_RELAY_STATE "relay_state"

uint8_t readRelayBootMask() {
  Preferences p;
  p.begin("voltsense", true);
  // Bit i = port i was ON. Reading a missing key returns 0, which would mean "all off" — not what
  // we want for a factory-fresh unit, so the sentinel is a separate key that must exist.
  bool initialised = p.isKey(NVS_KEY_RELAY_STATE);
  uint8_t mask = initialised ? (uint8_t)p.getUChar(NVS_KEY_RELAY_STATE, 0) : 0;
  p.end();
  if (!initialised) return 0xFF; // never booted: all ports ON
  return mask;
}

void persistRelayState() {
  uint8_t mask = 0;
  for (int i = 0; i < NUM_PORTS; i++) {
    if (relayIsOn(i)) mask |= (1 << i);
  }
  Preferences p;
  p.begin("voltsense", false);
  p.putUChar(NVS_KEY_RELAY_STATE, mask);
  p.end();
}

// ---------------------------------------------------------------------------
// Relay derating — dwell time + switch-rate limit (protects a MECHANICAL part)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. The relay is the only moving part in the build, and it is rated for a finite,
// QUITE SMALL number of operations (a typical 5 V blue 3-channel module: ~10,000-100,000 mechanical
// cycles). Every transition is one real actuation of a metal arm. Nothing used to count them.
//
// The exposing scenario is the app's toggle: each tap writes `ports/port_0N/relay_status` to RTDB,
// the device's stream callback fires on that write, and the handler does a `digitalWrite` — one
// actuation per tap, at network-event speed. Holding down a toggle, or a client bug that re-asserts
// a value in a loop, therefore hammers the contacts. It is also the WORST kind of switching: cutting
// and immediately re-closing a live load (a workstation, a compressor appliance) causes contact
// ARCING, which destroys a relay far faster than the raw operation count implies — the same
// welded-contact failure the overcurrent section warns about, reached from the opposite direction.
//
// The guard is two rules, both PER PORT (toggling port 1 must never block port 2):
//   1. DWELL — after a port switches, it may not switch again for RELAY_MIN_DWELL_MS. This rejects
//      double-taps and sensor/message chatter while being invisible to deliberate use (a person
//      flipping a switch and changing their mind takes about a second).
//   2. RATE — at most RELAY_MAX_SWITCHES transitions per RELAY_RATE_WINDOW_MS, as a rolling window.
//      Dwell alone still permits one flip every 2 s forever; this bounds sustained flapping.
//
// THE ONE EXCEPTION IS SAFETY. A derated path must NEVER be able to block the overcurrent trip: a
// dwell lock that refused to cut a fault because the port had "just switched" would be worse than no
// protection at all. `runRelaySwitch()` therefore takes a `force` flag, and the overcurrent cutoff
// passes `true`. Nothing that exists to protect the user is ever rate-limited.
//
// The app is NOT the security boundary here — anyone can write this node directly (console, script,
// another client). Enforcement lives on the device because the device is what owns the relay.

#define RELAY_MIN_DWELL_MS     2000UL          // 2 s between transitions on the same port
#define RELAY_RATE_WINDOW_MS   60000UL         // rolling window for the rate cap
#define RELAY_MAX_SWITCHES     6               // max transitions per port per window

unsigned long relayLastSwitchMs[NUM_PORTS] = {0, 0, 0};
unsigned long relaySwitchTimes[NUM_PORTS][RELAY_MAX_SWITCHES] = {{0}};
int relaySwitchCursor[NUM_PORTS] = {0, 0, 0};
unsigned long relaySuppressedCount[NUM_PORTS] = {0, 0, 0};

// True if this port is allowed to switch right now. `nowMs` is passed in so the caller uses one
// consistent timestamp and so the logic stays testable without a clock.
bool relayMaySwitch(int port, unsigned long nowMs) {
  if (port < 0 || port >= NUM_PORTS) return false;

  // Rule 1: minimum dwell since the last accepted transition.
  if (relayLastSwitchMs[port] != 0 &&
      (nowMs - relayLastSwitchMs[port]) < RELAY_MIN_DWELL_MS) {
    return false;
  }

  // Rule 2: rolling-window rate cap. Count the accepted transitions still inside the window.
  int inWindow = 0;
  for (int i = 0; i < RELAY_MAX_SWITCHES; i++) {
    unsigned long t = relaySwitchTimes[port][i];
    if (t != 0 && (nowMs - t) < RELAY_RATE_WINDOW_MS) inWindow++;
  }
  return inWindow < RELAY_MAX_SWITCHES;
}

// Record an accepted transition in the ring buffer and stamp the dwell clock.
void relayRecordSwitch(int port, unsigned long nowMs) {
  if (port < 0 || port >= NUM_PORTS) return;
  relaySwitchTimes[port][relaySwitchCursor[port]] = nowMs;
  relaySwitchCursor[port] = (relaySwitchCursor[port] + 1) % RELAY_MAX_SWITCHES;
  relayLastSwitchMs[port] = nowMs;
}

/**
 * The ONE choke point for energising/de-energising a port.
 *
 * Every relay write in this firmware goes through here so the derating rules cannot be bypassed by a
 * new call site that forgets them.
 *
 * Returns which of three things happened, because the caller's duty differs in each case:
 *   RELAY_SWITCHED  — the relay moved. The caller should persist and (if it owns the write) publish
 *                     the new state.
 *   RELAY_NOOP      — the port was already in the requested state; no actuation, no cost.
 *   RELAY_SUPPRESSED— derating refused the transition. The relay is UNCHANGED, so any caller that
 *                     told the cloud otherwise MUST repair the record — see
 *                     runRelaySwitchAndSync() for the standard repair.
 *
 * `force` = true skips BOTH rules and is reserved for safety paths (overcurrent cutoff, boot
 * restore). If you are adding an ordinary control path, leave it false — that is the whole point.
 */
// NOTE: `RelaySwitchResult` is declared once, with the other forward declarations near the top of
// this file. Defining it a second time here is a duplicate definition and does not compile.

// The default for `force` lives on the forward declaration above, NOT here — repeating it in the
// definition is a redefinition of the default argument, which the compiler warns about.
RelaySwitchResult runRelaySwitch(int port, bool on, bool force) {
  if (port < 0 || port >= NUM_PORTS) return RELAY_NOOP;

  bool current = relayIsOn(port);
  if (current == on) return RELAY_NOOP; // no transition: do not spend a relay operation on a no-op

  unsigned long nowMs = millis();
  if (!force && !relayMaySwitch(port, nowMs)) {
    relaySuppressedCount[port]++;
    Serial.printf("Relay port %d: %s SUPPRESSED (derating) — %lu suppressed so far\n",
                  port + 1, on ? "ON" : "OFF", (unsigned long)relaySuppressedCount[port]);
    return RELAY_SUPPRESSED;
  }

  relayWritePin(port, on);
  relayRecordSwitch(port, nowMs);
  Serial.printf("Relay port %d -> %s%s\n", port + 1, on ? "ON" : "OFF",
                force ? " (forced)" : "");
  return RELAY_SWITCHED;
}

/**
 * Drive a port from an app command and keep RTDB honest about the outcome.
 *
 * WHY THE REPAIR IS NECESSARY. The app writes the *intended* state optimistically, so when derating
 * suppresses the change the database now says "on" while the relay is physically off. Left alone,
 * the app's switch would sit in a position the hardware is not in. This writes the ACTUAL state back
 * for that one port, so the toggle snaps to reality.
 *
 * Only suppressed transitions write back — a successful switch already matches what the app wrote,
 * and an echo from our own write must not bounce back into another write (the `current == on` no-op
 * exit in runRelaySwitch is what stops that loop).
 */
void runRelaySwitchAndSync(int port, bool on) {
  if (port < 0 || port >= NUM_PORTS) return;

  RelaySwitchResult r = runRelaySwitch(port, on);
  if (r == RELAY_SWITCHED) {
    persistRelayState();
    return;
  }
  if (r == RELAY_SUPPRESSED) {
    bool actual = relayIsOn(port);
    String portPath = roomPath + "/ports/port_0" + String(port + 1) + "/relay_status";
    Serial.printf("Relay port %d: command rejected, reporting actual state %s\n",
                  port + 1, actual ? "ON" : "OFF");
    rtdbPutBool(portPath, actual);
  }
}


// ---------------------------------------------------------------------------
// Task watchdog — turns "frozen until you power-cycle it" into "reboots itself"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. Nothing in this firmware used to bound the main loop. If any call inside it
// never returned — the classic case is the Firebase library blocking on a TLS handshake against an
// unreachable or half-open host, where the socket sits in SYN_SENT — the loop simply stops.
// Telemetry stops, occupancy stops, alerts stop, and the relays stay exactly as they were. The
// device looks dead on the app while still holding whatever state it had. The only recovery was a
// human pulling power.
//
// The task watchdog resets the device instead. That is SAFE here specifically because relay state
// is persisted to NVS and restored on boot (see the section above): the device comes back into the
// state it was in, rather than re-energising every socket into an empty room.
//
// TIMEOUT = 30 s. Chosen against the longest LEGITIMATE blocking path, measured rather than
// guessed: NTP ~1 s, one ADC sweep across 3 ports ~300 ms (100 ms each), a Firebase telemetry push
// up to ~5 s on a poor link, and the library's own TLS retry on a dead host at ~10-15 s. 30 s sits
// comfortably above that worst case, so a slow-but-working network never trips it, while a genuine
// hang is caught in half a minute.
//
// The alert POST does NOT count against this: sendAlert() runs on its own FreeRTOS task pinned to
// core 1 (see alertTask), so a slow alert server cannot stall the loop. That task deliberately does
// NOT subscribe to the watchdog — its 8 s HTTP timeout already bounds it, and adding a second
// subscriber that can trip from a slow server would reboot a device that is working correctly.
//
// The `delay()` calls in setup() are deliberately outside the loop's budget. One of them is a 65 s
// pairing rate-limit backoff, which is intentional waiting, not a hang; feeding the timer once
// before it (see watchdogFeed around the pairing wait) keeps that path alive without disabling the
// watchdog for the rest of boot.
#define WDT_TIMEOUT_SECONDS 30

// WiFiManager's captive portal can hold the loop for minutes (up to three portal sessions of 180 s
// each) and cannot feed the task watchdog from inside that blocking call. The 30 s window is
// therefore widened to this across provisioning — see setup() — and restored once the network is up.
// A genuine hang during provisioning still resets, just after the longer window.
#define WIFI_PROVISION_WDT_MS 900000UL

void watchdogInit() {
  // The Arduino ESP32 core initialises the TWDT at boot and keeps the timer owned by the system.
  // Two consequences the first cut of this got wrong:
  //   * `esp_task_wdt_init` on an already-initialised timer returns ESP_ERR_INVALID_STATE and does
  //     NOT change the timeout, so we RECONFIGURE first and only init when the timer does not exist.
  //     (This also avoids the noisy "TWDT already initialized" error log on every boot.)
  //   * `esp_task_wdt_add(NULL)` returns a non-OK code ("task is already subscribed") when the core
  //     has already enrolled loopTask — ESP_ERR_INVALID_ARG (0x102 / 258) on ESP-IDF 5.x, and
  //     ESP_ERR_INVALID_STATE elsewhere. That is SUCCESS, not failure: the task IS being watched.
  //     Checking only one code printed a scary "could not watch" line on a working watchdog.
  esp_task_wdt_config_t cfg = {
    .timeout_ms = WDT_TIMEOUT_SECONDS * 1000,
    .idle_core_mask = 0,   // do not watch the idle tasks; we only care about loopTask
    .trigger_panic = true  // panic -> reset, so the device recovers instead of spinning
  };
  esp_err_t err = esp_task_wdt_reconfigure(&cfg);
  if (err != ESP_OK) {
    // Not initialised yet — create it. Testing a specific code here is fragile: this family has
    // returned both ESP_ERR_INVALID_STATE and ESP_ERR_INVALID_ARG across ESP-IDF versions.
    err = esp_task_wdt_init(&cfg);
  }
  if (err != ESP_OK) {
    Serial.printf("Watchdog init/reconfigure failed: %d\n", (int)err);
    return;
  }

  err = esp_task_wdt_add(NULL); // NULL = the currently running task (loopTask)
  // "Already subscribed" is a success for us — the task IS watched. It arrives as
  // ESP_ERR_INVALID_ARG (258) on ESP-IDF 5.x and ESP_ERR_INVALID_STATE (259) on others.
  if (err == ESP_OK || err == ESP_ERR_INVALID_ARG || err == ESP_ERR_INVALID_STATE) {
    Serial.printf("Watchdog armed: %ds timeout on loopTask.\n", WDT_TIMEOUT_SECONDS);
  } else {
    Serial.printf("Watchdog could not watch loopTask: %d\n", (int)err);
  }
}

// Retune the running watchdog's timeout WITHOUT re-subscribing the task. Used to widen the window
// across the blocking captive portal and to restore it afterwards.
void watchdogSetTimeoutMs(uint32_t ms) {
  esp_task_wdt_config_t cfg = {
    .timeout_ms = ms,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_err_t err = esp_task_wdt_reconfigure(&cfg);
  if (err != ESP_OK) {
    Serial.printf("Watchdog retune to %lu ms failed: %d\n", (unsigned long)ms, (int)err);
  }
}

// Feed the watchdog. Called at the top of every loop() and immediately BEFORE each call that is
// allowed to block, so the timer is always measuring the blocking call itself rather than the
// unrelated work that preceded it. If a blocking call never returns, the timer expires from that
// point and the device resets — which is the whole point.
inline void watchdogFeed() {
  esp_task_wdt_reset();
}

// Wait, but keep the watchdog fed. Used for the deliberate long waits (the pairing rate-limit
// backoff especially) which are intentional rather than a hang. Slicing the wait means the timeout
// still protects us from a genuine hang elsewhere in boot, instead of being disabled to allow one
// long sleep.
void waitWithWatchdog(uint32_t totalMs) {
  const uint32_t SLICE_MS = 1000;
  uint32_t remaining = totalMs;
  while (remaining > 0) {
    uint32_t slice = remaining > SLICE_MS ? SLICE_MS : remaining;
    delay(slice);
    watchdogFeed();
    remaining -= slice;
  }
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // Armed early so a hang anywhere in boot is caught too. Nothing in setup() blocks for longer
  // than the timeout except the deliberate pairing backoff, which feeds the timer explicitly.
  watchdogInit();

  // Checked before anything touches the network, so a reset is fast and predictable.
  factoryResetIfRequested();

  pinMode(PIR_PIN, INPUT);
pinMode(MMWAVE_PIN, INPUT);
  for (int i = 0; i < NUM_PORTS; i++) {
    // Drive the OFF level BEFORE switching the pin to OUTPUT. pinMode() leaves the output latch low,
    // and on an active-LOW board LOW means ENERGISE — so every port would close for the few
    // milliseconds before the persisted state is restored, including on a reboot that followed a
    // shutdown.
    digitalWrite(RELAY_PINS[i], RELAY_OFF_LEVEL);
    pinMode(RELAY_PINS[i], OUTPUT);
  }

  // ADC configuration for the ACS712 channels. Set EXPLICITLY rather than relying on the core
  // default, which has moved between ESP32 core versions (and which the docs never guaranteed).
  // ADC_11db is the ~0-3.3 V range the sensor's 2.5 V idle bias needs; a smaller range would clip
  // the bias itself and every reading would be garbage. `analogReadMilliVolts()` returns the value
  // already scaled for the active attenuation, so this and the read function must agree.
  for (int i = 0; i < NUM_PORTS; i++) {
    analogSetPinAttenuation(CURRENT_SENSOR_PINS[i], ADC_11db);
  }

  // Restore the last known port state rather than unconditionally energising everything. A reboot
  // must not silently reverse a shutdown decision the device already made. Forced: this is the
  // initial state application, there is no prior state to dwell against, and `runRelaySwitch` skips
  // the no-op ports anyway.
  uint8_t bootMask = readRelayBootMask();
  for (int i = 0; i < NUM_PORTS; i++) {
    runRelaySwitch(i, (bootMask & (1 << i)) != 0, /*force=*/true);
  }
  Serial.printf("Relay state restored: 0x%02X (bit i = port i+1 on)\n", bootMask);

  loadHistory();

  // Restore a user-measured nominal voltage if one was ever saved. The database value wins when the
  // stream delivers it (settings/nominal_voltage), but the stream is only authoritative after the
  // first snapshot — so boot must not fall back to 230 V for a device whose real supply is 240 V.
  {
    String savedVolts = getNvsString("nominal_voltage");
    if (savedVolts.length() > 0) {
      float v = savedVolts.toFloat();
      if (v >= 50.0f && v <= 300.0f) {
        nominalVoltage = v;
        Serial.printf("Nominal voltage restored from NVS: %.1f V\n", v);
      }
    }
    if (nominalVoltage == VOLTAGE) {
      Serial.println("Nominal voltage: default 230.0 V (no measured value configured).");
    }

    String savedOvercurrent = getNvsString("overcurrent_a");
    if (savedOvercurrent.length() > 0) {
      float a = savedOvercurrent.toFloat();
      if (overcurrentLimitIsSane(a)) {
        overcurrentLimitA = a;
        Serial.printf("Overcurrent limit restored from NVS: %.2f A\n", a);
      }
    }

#ifdef HAS_VOLTAGE_SENSE
    // Voltage-sensor calibration. Restored for the same reason as the nominal: losing it on every
    // reboot would mean every wattage was wrong until someone re-entered the value, and the error
    // is a silent scale factor — the numbers stay plausible.
    String savedCal = getNvsString("voltage_cal");
    if (savedCal.length() > 0) {
      float cal = savedCal.toFloat();
      if (cal >= 1.0f && cal <= 20.0f) {
        voltageCalMvPerV = cal;
        Serial.printf("Voltage calibration restored from NVS: %.3f mV/V\n", cal);
      }
    } else {
      Serial.printf("Voltage calibration: default %.3f mV/V — NOT CALIBRATED. Measure the supply\n",
                    voltageCalMvPerV);
      Serial.println("  with a multimeter and set settings/voltage_cal_mv_per_v to match.");
    }
#endif
  }

  // WiFiManager handles WiFi connection and Captive Portal
  //
  // The original code called ESP.restart() on timeout. That is a trap: `autoConnect` times out
  // after a few minutes in the portal WAITING FOR THE USER, and restarting re-enters the same
  // portal from scratch — so a user who walks away for five minutes comes back to a device that has
  // been silently rebooting and whose captive portal never stays up long enough to complete. If the
  // AP is briefly missing at boot, the same thing happens with no user involved at all.
  //
  // A bounded retry loop is the correct shape: keep the portal available, and only restart after
  // genuinely exhausting several attempts, because a full restart is the only way to re-scan for a
  // network that came up late.
  // The captive portal blocks the loop for minutes and cannot feed the task watchdog, so widen the
  // window across provisioning. watchdogInit() restores the 30 s timeout once the network is up.
  // Scan and print what the board can actually SEE, before WiFiManager tries the saved network.
  // When a previously-working SSID stops connecting, the question is always "is it in range, and is
  // it on 2.4 GHz?" — the ESP32 has no 5 GHz radio, so a 5 GHz-only AP never appears in this list.
  // Naming it beats leaving "AutoConnect: FAILED" as the only clue.
  {
    WiFi.mode(WIFI_STA);
    delay(100);
    Serial.println("--- Wi-Fi scan (2.4 GHz only) ---");
    int n = WiFi.scanNetworks();
    if (n <= 0) {
      Serial.println("  no networks found — router off, or out of range");
    } else {
      for (int i = 0; i < n; i++) {
        Serial.printf("  %2d  %-32s  %4d dBm  %s\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
      }
    }
    WiFi.scanDelete();
    Serial.println("----------------------------------");
  }

  watchdogSetTimeoutMs(WIFI_PROVISION_WDT_MS);

  WiFiManager wm;
  wm.setConfigPortalTimeout(180); // 3 minutes per attempt in the captive portal
  Serial.println("Starting WiFiManager...");

  bool connected = false;
  const int WIFI_ATTEMPTS = 3;
  for (int attempt = 1; attempt <= WIFI_ATTEMPTS && !connected; attempt++) {
    Serial.printf("WiFi connect attempt %d/%d\n", attempt, WIFI_ATTEMPTS);
    connected = wm.autoConnect("VoltSense_Setup");
    if (!connected) {
      Serial.printf("Attempt %d failed — retrying in 5s\n", attempt);
      delay(5000);
    }
  }

  if (!connected) {
    // Deliberately NOT ESP.restart(). The device stays awake in a safe state so the portal can
    // still be reached and the serial log can be read; a reboot loop would make both impossible.
    // Ports are left in their restored state, which means a unit that was shut down stays shut
    // down rather than failing ON in an empty room.
    //
    // This loop is INTENTIONALLY infinite, so it must feed the watchdog explicitly. Without the
    // feed the 30 s timeout would reset the device every 30 s — turning "stays awake so you can
    // reach the captive portal" into the reboot loop this branch exists to avoid.
    Serial.println("ERROR: no WiFi after 3 attempts. Staying in a safe state (ports unchanged).");
    Serial.println("Connect to the 'VoltSense_Setup' AP to configure, then press EN to reboot.");
    for (;;) {
      watchdogFeed();
      delay(10000);
      Serial.println("Waiting for configuration...");
    }
  }
  Serial.println("Connected to WiFi!");

  // Network is up: restore the tight 30 s watchdog for the rest of the run (the provisioning window
  // above was only widened to survive the blocking portal).
  watchdogInit();

  macAddress = WiFi.macAddress();
  Serial.printf("Device MAC Address: %s\n", macAddress.c_str());

  // Runs BEFORE Firebase auth and before pairing, so a fielded device that never comes online
  // produces a legible reason on the serial console instead of failing silently at the first POST.
  runConnectivitySelfTest();

  timeClient.begin();
  timeClient.update();

  // No client-library configuration here any more. The REST path takes its endpoint from
  // API_KEY / DATABASE_URL and its trust anchor from API_ROOT_CA_BUNDLE directly, so a
  // FirebaseConfig / FirebaseAuth would only ever be written and never read.

  // ---- Device identity ----
  //
  // Two ways to prove "this is device <MAC>", both needing only the free Spark plan:
  //
  //   A) dev_email + dev_password — a plain Firebase Auth account you create in the Console.
  //      The rules resolve MAC -> uid through a `device_uids` node that only the Console can write.
  //      No service account, no Cloud Function, no billing. Simplest.
  //
  //   B) dev_id_token + dev_refresh_token — a custom token carrying a `device_mac` claim, minted
  //      with `npm run mint-token`. Also no Cloud Function (signing happens on your machine), but
  //      it does need a service-account key.
  //
  // Either way rtdbSignIn() reads whichever of these is present straight out of NVS and signs in
  // over REST; nothing is handed to the client library.
  String deviceEmail = getNvsString("dev_email");
  String devicePassword = getNvsString("dev_password");
  String deviceIdToken = getNvsString("dev_id_token");
  String deviceRefreshToken = getNvsString("dev_refresh_token");

  // No USB-provisioned identity? Try to pair ourselves over the air. This replaces the ~10 minutes
  // of Console + USB work per unit with a one-time POST, and is what makes a fleet practical.
  //
  // Ordering matters: an identity written by ProvisionToken.ino always wins, so a bench unit you
  // provisioned by hand is never overwritten by a pairing attempt.
  if (deviceEmail.length() == 0 && deviceIdToken.length() == 0) {
    Serial.println("No identity in NVS — attempting self-provisioning.");
    if (pairDevice()) {
      deviceEmail = getNvsString("dev_email");
      devicePassword = getNvsString("dev_password");
    }
  }

  // Which identity is present decides how rtdbSignIn() authenticates — see the REST section.
  if (deviceEmail.length() > 0 && devicePassword.length() > 0) {
    Serial.println("Device identity loaded (email/password account).");
  } else if (deviceIdToken.length() > 0 && deviceRefreshToken.length() > 0) {
    // The refresh token — not the hour-long ID token — is what rtdbTokenViaRefreshToken() uses,
    // so a fielded unit does not expire after an hour.
    Serial.println("Device identity loaded (custom token with device_mac claim).");
  } else if (ALLOW_ANONYMOUS_FALLBACK) {
    Serial.println("WARNING: no device identity in NVS — anonymous access is not supported over");
    Serial.println("         the REST path (the rules reject anonymous callers anyway).");
    Serial.println("         Pair the device, or provision it with esp32/ProvisionToken.");
  } else {
    Serial.println("ERROR: no device identity available (pairing failed and nothing is in NVS).");
    Serial.println("       Option 1 - over the air:  compile in VOLTSENSE_PAIRING_KEY, then reset.");
    Serial.println("       Option 2 - by hand (free plan, no service account):");
    Serial.println("         1. Console > Authentication > Users > Add user, e.g.");
    Serial.println("            device-aabbccddeeff@<your-auth-domain> with a password.");
    Serial.println("         2. Console > Realtime Database > add");
    Serial.println("            device_uids/" + macAddress + " = \"<that user's UID>\"");
    Serial.println("         3. Flash esp32/ProvisionToken and enter the email + password.");
    Serial.println("       Option 3 - with a service account:  npm run mint-token -- " + macAddress);
    // Don't spin forever: report clearly and keep the relays in their safe default state.
    for (int i = 0; i < 10; i++) {
      delay(1000);
      Serial.println("Waiting for device credentials... reset after provisioning.");
    }
    ESP.restart();
  }

  // Sign in over REST -- the client library's own transport is not used (see the REST section).
  Serial.print("Authenticating with the Realtime Database");
  unsigned long authStart = millis();
  while (!rtdbSignIn()) {
    Serial.print(".");
    delay(500);
    if (millis() - authStart > 30000UL) {
      Serial.println("\nAuthentication timed out after 30s.");
      Serial.println("  Likely causes:");
      Serial.println("   - the account was deleted / the password changed / the refresh token was revoked");
      Serial.println("   - Console > Authentication > Users does not list this device");
      Serial.println("  Re-provision with esp32/ProvisionToken and restart.");
      Serial.println("  Restarting in 10s...");
      delay(10000);
      ESP.restart();
    }
  }
  Serial.println("\nAuthenticated!");

  roomPath = "/devices/" + macAddress;
  Serial.printf("Database path set to: %s\n", roomPath.c_str());

  // Prove the Realtime Database is reachable over REST before the client library's own transport
  // is relied on (it currently cannot handshake -- see the REST section above).
  rtdbRestSelfTest();

  // Publish the configured inactivity limit so the dashboard shows the real value.
  rtdbPutInt(roomPath + "/inactivity_limit", (int)(idleTimeoutMs / 60000UL));

  // App-driven commands (override, relay toggles, policy, settings) are POLLED rather than
  // streamed: the client library's streaming transport is the part that cannot handshake on this
  // core. pollRemoteChanges() runs from loop() and dispatches through the same handler.
  lastRemotePollMillis = 0;

  lastMotionMillis = millis();
  lastEnergyCalcMillis = millis();
  lastHourSeen = getLocalHour();
}

String stateToString(SystemState s) {
  switch (s) {
    case STATE_OCCUPIED: return "OCCUPIED";
    case STATE_IDLE_COUNTDOWN: return "IDLE_COUNTDOWN";
    case STATE_RESPONSE_WINDOW: return "RESPONSE_WINDOW";
    case STATE_SHUTDOWN: return "SHUTDOWN";
    default: return "UNKNOWN";
  }
}

void loop() {
  // Feed FIRST, so the timer measures this iteration from its start. Every path out of this loop
  // must reach the next iteration within WDT_TIMEOUT_SECONDS or the device resets — see the
  // watchdog section for why that is safe (relay state is NVS-persisted and restored on boot).
  watchdogFeed();

  // NTP can block for ~1 s on a slow network. Fed immediately before, so if it hangs the timeout
  // is charged to NTP rather than to work that already completed.
  watchdogFeed();
  timeClient.update();

  // Pick up anything the app changed (override, relay toggles, policy, settings). Rate-limited
  // internally, so calling it every iteration is free.
  pollRemoteChanges();

  // Occupancy = PIR OR the mmWave radar — the dual-sensor module. The radar term is compiled in with
  // HAS_MMWAVE (see its section): reading MMWAVE_PIN while no radar is wired would leave the pin
  // floating, and floating-input noise OR-ed into `motionDetected` would pin the room permanently
  // "occupied" and stop the smart shutdown from ever firing. PIR alone is fail-safe, so it ships
  // first; enable the radar when it is physically fitted.
  bool motionDetected = digitalRead(PIR_PIN) == HIGH;
if (mmwaveEnabled) { motionDetected = motionDetected || (digitalRead(MMWAVE_PIN) == HIGH); }
  bool nightMode = isNightModeActive();

  // One ADC sweep per port for the WHOLE iteration. Both the shutdown scan below and the telemetry
  // block at the end of this loop read from this cache, instead of each taking their own ~100 ms
  // sample. Previously the loop could stall for up to 6x100 ms on sensing alone, which walked the
  // millis()-driven state machine's transitions out of position — see the cache's own comment.
  //
  // Done here, before the state machine, because the shutdown decision inside it needs the values.
  refreshCurrentCache();
#ifdef HAS_VOLTAGE_SENSE
  // Keep the measured mains voltage current when nothing is drawing power. Rate-limited, so this is
  // a timestamp compare in the normal case — see the function's own comment for why it exists.
  refreshVoltageOnlyIfStale();
#endif
  watchdogFeed();

  // Overcurrent check runs on the SAME cached reading, right after it is taken — so the trip sees
  // fresh numbers and costs no extra ADC sweep. It runs BEFORE the state machine deliberately: a
  // fault should cut power regardless of what the occupancy logic is about to decide, and it must
  // not be gated behind a state that happens to be idle. See the overcurrent section for what this
  // can and cannot detect.
  checkOvercurrent();

  // Update State Machine
  if (motionDetected || nightMode) {
    if (currentState == STATE_SHUTDOWN || currentState == STATE_RESPONSE_WINDOW) {
      setAllRelays(true);
      persistRelayState();

      // Update Firebase to reflect relays are ON
      FirebaseJson relayUpdateJson;
      for (int i = 0; i < NUM_PORTS; i++) {
        String portPrefix = "ports/port_0" + String(i + 1) + "/";
        relayUpdateJson.set(portPrefix + "relay_status", true);
      }
      // This is the call most likely to hang — a TLS handshake against an unreachable host sits in
      // SYN_SENT until the library's own retry gives up. Fed before it so the timeout is charged
      // here; if it never returns, the watchdog resets the device instead of freezing it.
      watchdogFeed();
      rtdbPatchJson(roomPath, relayUpdateJson);
      watchdogFeed();
    }
    currentState = STATE_OCCUPIED;
    lastMotionMillis = millis();
  } else {
    unsigned long timeSinceLastMotion = millis() - lastMotionMillis;

    if (currentState == STATE_OCCUPIED) {
      currentState = STATE_IDLE_COUNTDOWN;
    }
    else if (currentState == STATE_IDLE_COUNTDOWN) {
      if (timeSinceLastMotion >= idleTimeoutMs) {
        currentState = STATE_RESPONSE_WINDOW;
        responseWindowStartMillis = millis();
        Serial.println("Entering Response Window. Sending alert.");

        // The window is DERIVED from RESPONSE_WINDOW_MS, never written as a literal. The old text
        // said "60 seconds" while the window was five minutes — a copy bug that survived precisely
        // because nothing tied the two numbers together. Now the text cannot drift from the timing.
        char alertBody[112];
        snprintf(alertBody, sizeof(alertBody),
                 "The room has been empty. Devices will shut down in %lu minutes unless you "
                 "keep them on.",
                 (unsigned long)(RESPONSE_WINDOW_MS / 60000UL));

        // Fire-and-forget: this must not block, or the response window below drifts.
        sendAlert("\xE2\x9A\xA0\xEF\xB8\x8F VoltSense Alert", String(alertBody), "volt-sense-shutdown");
      }
    }
    else if (currentState == STATE_RESPONSE_WINDOW) {
      unsigned long timeInWindow = millis() - responseWindowStartMillis;
      if (timeInWindow >= RESPONSE_WINDOW_MS) {
        currentState = STATE_SHUTDOWN;

        Serial.println("Response window expired. Performing Smart Selective Shutdown.");
        bool anyShutDown = false;
        FirebaseJson relayUpdateJson;

        for (int i = 0; i < NUM_PORTS; i++) {
          // The decision is the port's STATED POLICY, not a guess from its current draw — see
          // `shouldKeepPortOnShutdown` and `enum PortPolicy`. The old rule kept whatever was drawing
          // current, which protected a lamp left burning in an empty room and cut a phone charger.
          if (shouldKeepPortOnShutdown(i)) {
            Serial.printf("Port %d kept ON (policy=%s%s).\n", i + 1, policyToString(portPolicy[i]),
                          portPolicy[i] == POLICY_KEEP_WHILE_DRAWING ? " drawing" : "");
          } else {
            // Forced: a safety shutdown must not be blocked by the derating rules (a room cannot
            // flap, so this normally trips neither rule anyway).
            runRelaySwitch(i, false, /*force=*/true);
            String portPrefix = "ports/port_0" + String(i + 1) + "/";
            relayUpdateJson.set(portPrefix + "relay_status", false);
            anyShutDown = true;
          }
        }

        if (anyShutDown) {
          // Commit the new port state to NVS BEFORE telling the cloud about it. If the device
          // browns out between the two, the restored state must match the relays, not the database.
          persistRelayState();
          watchdogFeed();
          rtdbPatchJson(roomPath, relayUpdateJson);
          watchdogFeed();
        }
      }
    }
    else if (currentState == STATE_SHUTDOWN) {
      // Re-check the ports we deliberately kept. `keep_while_drawing` exists so a charger can
      // finish an unattended charge — but nothing re-evaluated while in this state, so a port would
      // have stayed on until the room was next occupied and emptied again. It never noticed the
      // charge completing. Rate-limited: see SHUTDOWN_RECHECK_MS.
      if (millis() - lastShutdownRecheckMillis >= SHUTDOWN_RECHECK_MS) {
        lastShutdownRecheckMillis = millis();

        FirebaseJson relayUpdateJson;
        bool anyCut = false;

        for (int i = 0; i < NUM_PORTS; i++) {
          // Already off — nothing to do.
          if (!relayIsOn(i)) continue;
          // Still justified by its policy (always on, or still drawing) — leave it.
          if (shouldKeepPortOnShutdown(i)) continue;

          runRelaySwitch(i, false, /*force=*/true);
          relayUpdateJson.set("ports/port_0" + String(i + 1) + "/relay_status", false);
          anyCut = true;
          Serial.printf("Port %d: no longer justified by policy (%s) — cutting.\n",
                        i + 1, policyToString(portPolicy[i]));
        }

        if (anyCut) {
          persistRelayState();
          watchdogFeed();
          rtdbPatchJson(roomPath, relayUpdateJson);
          watchdogFeed();
        }
      }
    }
  }

  // Push telemetry to Firebase every 2 seconds
  if (rtdbEnsureToken() && (millis() - sendDataPrevMillis > 2000 || sendDataPrevMillis == 0)) {
    unsigned long currentMillis = millis();
    float deltaHours = (currentMillis - (sendDataPrevMillis == 0 ? currentMillis : sendDataPrevMillis)) / 3600000.0;
    sendDataPrevMillis = currentMillis;

    // Detect an hour boundary so the hourly history buckets stay aligned.
    int localHour = getLocalHour();
    if (localHour != (int)lastHourSeen) {
      lastHourSeen = localHour;
      if (localHour == 0) rolloverDayIfNeeded();
    }

    float totalAmps = 0;
    float totalWatts = 0;
    const float volts = supplyVoltage(); // one read for the whole sweep, so every port agrees
    FirebaseJson json;

    for (int i = 0; i < NUM_PORTS; i++) {
      float currentAmps = 0.0;
      float currentWatts = 0.0;
      float currentVa = 0.0;
      float currentPf = 0.0;
      float portVolts = volts;

      if (relayIsOn(i)) {
        // Display/history path: the noise floor is applied here, and only here, so a de-energised
        // port reads as exactly 0 A rather than as sensor hiss that creeps into the energy total.
        currentAmps = readACS712ForDisplay(i);
#ifdef HAS_VOLTAGE_SENSE
        // REAL power and MEASURED power factor. The apparent figure is published alongside rather
        // than instead, so the app can show both and the difference is visible rather than hidden.
        // `power_watts` therefore means watts here, and apparent power when no sensor is fitted —
        // `voltage_source` is what tells the consumer which, so the unit on screen is never a guess.
        currentWatts = wattsFor(i);
        currentVa = vaFor(i);
        currentPf = powerFactorFor(i);
        // Each port's pass measured its own voltage; prefer it, since the watts were computed
        // against it and reporting a different number would make the two disagree.
        const CurrentReading& c = currentCache[i];
        if (c.powerValid && c.volts >= 50.0f && c.volts <= 300.0f) portVolts = c.volts;
#else
        // No voltage channel: `I_rms * configured_voltage` is APPARENT power (VA), not watts. The
        // UI labels it as such. See the voltage section for why this cannot be fixed in software.
        currentWatts = currentAmps * volts;
        currentVa = currentWatts;
#endif
      }

      // Energy integrates whatever `currentWatts` holds, so with a voltage channel this becomes
      // real energy (Wh) rather than apparent — which is the difference between a figure that can
      // be checked against a utility meter and one that cannot.
      float deltaKwh = (currentWatts / 1000.0) * deltaHours;
      portEnergyKWh[i] += deltaKwh;
      todayHourlyKwh[localHour] += deltaKwh;

      totalAmps += currentAmps;
      totalWatts += currentWatts;

      String portPrefix = "ports/port_0" + String(i + 1) + "/";
      json.set(portPrefix + "current_amps", currentAmps);
      json.set(portPrefix + "power_watts", currentWatts);
      json.set(portPrefix + "power_va", currentVa);
      json.set(portPrefix + "power_factor", currentPf);
      json.set(portPrefix + "energy_kwh", portEnergyKWh[i]);
      json.set(portPrefix + "voltage", portVolts);

      // Also continuously push relay_status to ensure Web App is synced with physical reality
      json.set(portPrefix + "relay_status", relayIsOn(i));
      // Published so the app can SHOW the policy and let the user change it. A policy the interface
      // cannot display is one the user cannot reason about — which is how the inverted shutdown
      // rule went unnoticed for so long.
      json.set(portPrefix + "policy", policyToString(portPolicy[i]));
    }

    // Which kind of number the power fields hold. The app switches its unit label on this, so a
    // device with no voltage sensor can never present an apparent-power figure as watts.
    json.set("voltage_source", voltageIsMeasured() ? "measured" : "configured");

    if (motionDetected) todayHourlyOccupied[localHour] = true;

    json.set("is_occupied", motionDetected);
    json.set("state", stateToString(currentState));
    json.set("total_current_amps", totalAmps);
    json.set("total_power_watts", totalWatts);
    json.set("inactivity_limit", (int)(idleTimeoutMs / 60000UL));
    // Reported so the app can show what the device is actually enforcing, rather than assuming the
    // compiled-in default. Apparent power only — see the ACS712 note: this is VA, not W.
    json.set("overcurrent_limit_a", overcurrentLimitA);

    int remaining_seconds = 0;
    if (currentState == STATE_IDLE_COUNTDOWN) {
      remaining_seconds = (idleTimeoutMs - (millis() - lastMotionMillis)) / 1000;
    } else if (currentState == STATE_RESPONSE_WINDOW) {
      remaining_seconds = (RESPONSE_WINDOW_MS - (millis() - responseWindowStartMillis)) / 1000;
    }
    json.set("countdown_remaining_seconds", remaining_seconds);
    json.set("night_mode_active", nightMode);

    // The telemetry push is the other call that can sit on a TLS handshake. Fed before it so a
    // hang here is charged to the push, and the device resets rather than going silent.
    watchdogFeed();
    if (!rtdbPatchJson(roomPath, json)) {
      Serial.println("Failed to update RTDB");
    } else {
      if (currentState != previousState) {
        Serial.printf("State changed: %s -> %s\n", stateToString(previousState).c_str(), stateToString(currentState).c_str());
        previousState = currentState;
      }
    }
  }

  // ---- Periodic work (kept off the 2s hot path) ----
  if (rtdbEnsureToken()) {
    if (millis() - lastEnergyPersistMillis > ENERGY_PERSIST_MS) {
      lastEnergyPersistMillis = millis();
      persistEnergyCounters();
      persistHistory();
    }

    if (millis() - lastHistoryPublishMillis > HISTORY_PUBLISH_MS) {
      lastHistoryPublishMillis = millis();
      publishHistoryRanges();
    }
  }
}

