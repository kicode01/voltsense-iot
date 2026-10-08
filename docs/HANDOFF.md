# VoltSense — hardware handoff & build guide

**Who this is for:** whoever has the physical components. You do not need to have seen the code or
this project before. Follow it top to bottom.

**What you are building:** an ESP32 that senses whether a room is occupied, switches three mains
sockets, measures the current each one draws, and reports all of it to a phone app. It alerts when
the room empties or a port overloads.

**What you need from the code owner** (ask them — do not guess):

| Thing | Why |
|---|---|
| The **pairing key** (64 hex characters) | Baked into the firmware at build time so the device can register itself. **Sent privately — never put it in a repo or a shared doc.** |
| Confirmation the app is deployed | The device talks to `https://voltsense-iot.vercel.app` |
| A phone with the app installed and signed in | To claim the device at the end |

---

## ⚠️ READ THIS BEFORE TOUCHING ANYTHING

**This device switches mains.** 230 V at up to 5 A per port is lethal and will destroy equipment.

- **Never wire or rewire with the mains connected.** Isolate at the breaker, then verify it is dead.
- **Do the whole bring-up with low-voltage loads first** — 12 V lamps, a phone charger. Only move to
  mains once Stages 1–4 below pass.
- If you are not confident with mains wiring, stop and get someone who is. Nothing here is worth a
  shock.
- The software has an overcurrent cutoff, but **it is not a fuse** — the sensor saturates at 5 A and
  a welded relay contact cannot be opened in code. A physical fuse per port is required for any
  real installation.

---

## 1. What's in the box

| Part | Notes |
|---|---|
| ESP32 dev board | 4 MB flash minimum |
| HC-SR501 PIR motion sensor | Occupancy. **Needs 5 V.** |
| 3-channel relay module | Switches the three sockets |
| 3× ACS712 current sensor | One per socket. **5 A variant** (the 20 A and 30 A parts look identical and silently break every reading) |
| 5 V regulated supply | Enough for the ESP32 + relay coils + sensors |

Optional, only if the code owner says so: an AC voltage sensor (ZMPT101B) for real-power metering.
**Do not fit it unless asked** — it needs calibration and can damage the ESP32 if wired wrong. See
`docs/VOLTAGE-SENSING.md`.

---

## 2. Wiring

### Pins — these are fixed by the firmware

| Function | ESP32 pin | Goes to |
|---|---|---|
| Relay 1 / 2 / 3 | **23, 21, 19** | Relay module IN1 / IN2 / IN3 |
| Current sensor 1 / 2 / 3 | **34, 35, 32** | ACS712 OUT, one per port |
| PIR | **22** | HC-SR501 OUT |
| Relay module VCC | 5 V | 5 V rail |
| Relay module GND | GND | **Common ground** |
| mmWave radar *(optional)* | 4 | Only if fitted **and** enabled in firmware |

> **GPIO 34, 35, 32 are input-only and have no pull-ups.** That is correct for analogue inputs and
> required here — the ESP32's other analogue pins (ADC2) stop working when Wi-Fi is on, so the
> current sensors must be on ADC1 (GPIO 32–39).

### ⚠️ The three wiring mistakes that will cost you a day

**1. The ACS712 goes IN SERIES with ONE conductor — never both.**
Cut **one** wire (the live), and pass only that one through the sensor. If live and neutral both go
through, their magnetic fields cancel and the sensor reads **0 A** while the load is running
perfectly. It looks like a dead sensor; it is a wiring error.

```
   mains live ──[ through the ACS712 hole ]── to the load
   mains neutral ──────────── straight through, NOT through the sensor
```

**2. Common ground is mandatory.** The ESP32, the relay module, the PIR and every ACS712 must share
GND. Without it the sensor outputs float and read noise.

**3. The PIR needs 5 V, and its Tx pot must be SHORT.**
The HC-SR501 will not work reliably at 3.3 V. It has two potentiometers:
- **Tx (time delay)** — how long OUT stays HIGH after motion. Set it **short** (a few seconds). If it
  is longer than the firmware's inactivity window (15 min default), the room never registers as
  empty and the automatic shutdown never fires.
- **Sx (sensitivity)** — leave mid-range to start.

Also set the jumper to **"H" (repeat trigger)**, not "L".

### ⚠️ Relay polarity — verify this BEFORE mains

The firmware assumes **HIGH = relay energised** (its source says so explicitly). **Most cheap relay
modules are active-LOW**, which would invert every port: the app says ON and the socket goes dead.

On the bench, no mains connected:
1. Power everything up.
2. Toggle a port from the app (or watch the relay LEDs at boot).
3. If it is inverted, report it — it needs either a driver stage or a one-line firmware change.

---

## 3. Software setup

### 3.1 Arduino IDE

1. Install the Arduino IDE.
2. **File → Preferences → Additional Board Manager URLs**, add:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif**.
4. **Tools → Board → ESP32 Arduino → ESP32 Dev Module**.

### 3.2 Libraries (Tools → Manage Libraries)

| Search for | Notes |
|---|---|
| **Firebase Arduino Client Library for ESP8266 and ESP32** | by mobizt. **Not** `FirebaseArduino` or `FireBase32` |
| **WiFiManager** | by tzapu |
| **NTPClient** | by Fabrice Weinberg |

Everything else (`WiFi`, `HTTPClient`, `Preferences`, …) ships with the ESP32 core — do not install
separately.

### 3.3 ⚠️ Set the partition scheme — the build fails without this

**Tools → Partition Scheme → "Huge APP (3MB No OTA/1MB SPIFFS)"**

The sketch needs ~1.48 MB. The default partition gives only 1.2 MB, so a stock build stops with:

```
Sketch uses 1482683 bytes (113%) of program storage space.
Error during build: text section exceeds available space in board
```

### 3.4 Add the pairing key — do NOT type it into the source file

The key is a **credential**. It must not be saved into `VoltSense.ino`, or it ends up in version
control and has to be rotated again.

**In the Arduino IDE**, the simplest route is a build flag. Create a file next to the sketch, or use
**Sketch → Export compiled binary** with an extra flag:

```
-DVOLTSENSE_PAIRING_KEY="<the 64-character key>"
```

**Command line** (equivalent, and easier to script):

```bash
arduino-cli compile \
  --fqbn "esp32:esp32:esp32:PartitionScheme=huge_app" \
  --build-property 'compiler.cpp.extra_flags=-DVOLTSENSE_PAIRING_KEY=\"<the key>\"' \
  esp32/VoltSense
```

> If you forget the key the device still boots, prints
> `No factory pairing key compiled in; USB provisioning required.` and will not pair over the air.
> That is a clear failure, not a silent one — but you will have to reflash.

---

## 4. Flash and first boot

1. Connect the ESP32 over USB. If the upload hangs at `Connecting....`, **hold the BOOT button**.
2. Open **Serial Monitor at 115200**.
3. Upload `esp32/VoltSense/VoltSense.ino`.

### What a good boot looks like

```
Connected to WiFi!
Device MAC Address: XX:XX:XX:XX:XX:XX
--- Endpoint reachability self-test ---
  [ OK ] alert ...
  [ OK ] pair  ...
---------------------------------------
   PAIRED. Enter this code in the VoltSense app to add it:
        >>>   XXXXXXXX   <<<
```

**Write down the MAC address** — the code owner needs it, and it is what the server keys everything
on. Note it is the **Wi-Fi** MAC (`WiFi.macAddress()`), which may differ from the sticker on the
board.

### If the self-test does not say `[ OK ]`

| Output | Meaning | Do |
|---|---|---|
| `[TLS ]` | The pinned certificate no longer matches | Report it — the firmware needs a certificate update, it is **not** a Wi-Fi problem |
| `[FAIL] WiFi down` | No network | Check Wi-Fi credentials / signal |
| `[FAIL] ... connection refused` | Host unreachable | Check DNS and that the app is deployed |

The probe is a reachability check only — it never carries the alert secret, so a `401` from it is a
**pass**.

---

## 5. Verification — do these in order

Tick them off. Each one rules out a layer before you add the next.

### Stage 1 — bench, no mains
- [ ] Boots without a reset loop
- [ ] Wi-Fi connects
- [ ] Both endpoints report `[ OK ]`
- [ ] MAC address recorded and sent to the code owner

### Stage 2 — sensors
- [ ] Motion in front of the PIR is detected
- [ ] It goes idle again after you stand still (allow the inactivity window)
- [ ] Relay polarity verified (see §2) — **before mains**
- [ ] Each relay clicks when toggled, and the **right** relay clicks

### Stage 3 — current sensing, still no mains
Use a low-voltage load or a lamp on a bench supply.
- [ ] The loaded port reads a non-zero current
- [ ] Unloaded ports read ~0 A
- [ ] The reading roughly matches a clamp meter

### Stage 4 — relays under load
- [ ] App ON → the outlet is genuinely live
- [ ] App OFF → the outlet is genuinely dead
- [ ] Rapid toggling produces `SUPPRESSED (derating)` in the log and the relay does **not** chatter
      (this is the protection working, not a fault)

### Stage 5 — safety cutoffs
- [ ] Overcurrent: exceed the limit (default 4.5 A) → relay opens, log shows `OVERCURRENT TRIP`
- [ ] Occupancy: let the room go idle → an alert arrives, and pressing **Keep Power On** in the app
      cancels the shutdown
- [ ] The device survives a full idle → shutdown cycle without resetting

### Stage 6 — pairing and the app
- [ ] The pairing code from the serial log is accepted by the app
- [ ] The dashboard shows live readings, not "Demo"
- [ ] Unpairing from the app removes it from the account

### Stage 7 — real push notification
- [ ] With the app **fully closed** (swiped away, not just backgrounded), trigger an alert and
      confirm the phone shows a notification. `docs/PUSH-TEST.md`.

> The **Settings → Test** button does **not** test this. It fires a notification from the open page
> and passes even on a broken build. Only a real alert with the app closed proves delivery.

---

## 6. What to report back

Send the code owner:

1. **The MAC address** from the serial log.
2. **The pairing code**, or confirmation the device was claimed.
3. **Whether the relay polarity was normal or inverted.**
4. **The current reading vs a clamp meter**, so the sensor variant can be confirmed.
5. **Any serial log that did not match the expected output** — paste it verbatim, it is the fastest
   way to diagnose.
6. Which stages in §5 passed, and where you stopped.

---

## 7. Troubleshooting quick reference

| Symptom | Most likely cause |
|---|---|
| Upload hangs at `Connecting....` | Hold the BOOT button during upload |
| `text section exceeds available space` | Partition scheme not set to Huge APP |
| Device boots but never pairs | Pairing key not supplied at build time |
| A port reads 0 A under load | ACS712 not in series with a single conductor, or no common ground |
| Occupancy never clears | PIR Tx pot too long, or a floating mmWave pin |
| Ports are inverted (ON = dead) | Active-low relay module — see §2 |
| Nothing arrives on the phone | App must be closed for the real test; check `docs/PUSH-TEST.md` |
| `Alert -> HTTP 401` | The device's alert secret does not match the server — report it |
