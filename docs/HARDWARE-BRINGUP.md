# Hardware bring-up & acceptance test

Everything to do, **in order**, to take a bench ESP32 from "powered on" to "a fielded unit you trust".
Each stage is self-contained: if it fails, you know which layer broke before you add the next one.

Do **not** skip ahead. The order is deliberate — most of the confusing failures in this system are
caused by testing two unverified layers at once.

---

## Stage 0 — Before powering anything

### 0.1 Know which firmware path you are taking

There are two ways a device gets its credentials. Decide now, because it changes the flashing steps.

| Path | When to use | What you do |
|---|---|---|
| **Self-pairing** (preferred) | Normal fleet units. No USB needed after flashing. | Compile with `VOLTSENSE_PAIRING_KEY` set; the device asks the server for credentials and prints a code. |
| **USB provisioning** | First unit, or when you want to control the secret yourself. | Flash `VoltSense.ino`, then flash `ProvisionToken.ino` to write `alert_secret` / token into NVS. |

USB provisioning **takes priority** over self-pairing if NVS already has values (`VoltSense.ino`
comment at the provisioning section). A device left with stale NVS will not re-pair — it will reuse
what is there.

### 0.2 Confirm the endpoints are live before you blame the board

The device pins the TLS root to `ISRG_ROOT_X1` (`VoltSense.ino:344`). If Vercel's chain changed, the
device fails with a symptom that looks exactly like "no Wi-Fi". Check from a computer first:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://voltsense-iot.vercel.app/api/alert   # expect 405
curl -s -o /dev/null -w "%{http_code}\n" https://voltsense-iot.vercel.app/api/pair    # expect 405
openssl s_client -connect voltsense-iot.vercel.app:443 -servername voltsense-iot.vercel.app -showcerts </dev/null 2>/dev/null | grep -i "issuer\|ISRG"
```

If the issuer is no longer ISRG / Let's Encrypt, **stop** — the firmware needs a new pinned root and a
reflash. Nothing else you do will help.

### 0.3 Bill of materials actually fitted

| Part | Pin(s) | Note |
|---|---|---|
| ESP32 dev board | — | — |
| HC-SR501 PIR | `PIR_PIN` = **22** | Needs **5 V**, and **must share ground** with the ESP32 |
| 3-ch relay module | **23, 21, 19** | ⚠️ Firmware assumes **HIGH = energised**. **Most cheap modules are active-LOW** — verify before connecting mains (see below) |
| ACS712 ×3 (`5 A` variant) | **34, 35, 32** | **ADC1 only.** Never move to ADC2 — ADC2 reads 0 while Wi-Fi is up |
| mmWave radar | `MMWAVE_PIN` = **4** | Supported but **read is compiled out** by default (`HAS_MMWAVE`) |
| AC voltage sensor (ZMPT101B) | `VOLTAGE_SENSE_PIN` = **33** | **ADC1.** Optional; **gated off** by default (`HAS_VOLTAGE_SENSE`). See the next section |

### Two modes — the device tells you which one it is in

**Without a voltage sensor** an ACS712 measures current only, so everything the dashboard calls
"power" is **VA** (current × a *configured* nominal voltage), not true watts. The firmware reports
`voltage_source: "configured"` and the UI labels the figure **VA**. Do not present it as a
measurement — it is an estimate, and it is optimistic by the power factor (typically 30–50 % high
for switch-mode loads).

**With the sensor fitted, enabled and calibrated**, the firmware computes real power as
`mean(v(t)·i(t))` — the sample-by-sample product, which is what captures the phase relationship —
and reports `voltage_source: "measured"` plus a measured `power_factor`. The UI then labels the
figure **W**. See `docs/VOLTAGE-SENSING.md` for the bring-up and calibration procedure.

> **The unit is not cosmetic.** VA can be 30–50 % higher than W for exactly the loads this device
> monitors, so showing "W" without a sensor overstates every reading by an amount the user cannot
> see. The app switches the unit on `voltage_source` for this reason, and the harness asserts it.

### Fitting the sensor later

| Step | Detail |
|---|---|
| 1. Wire | Sensor output → `VOLTAGE_SENSE_PIN` (GPIO 33), **share ground** with the ESP32 |
| 2. **Check the voltage range** | The common ZMPT101B module runs its op-amp at 5 V and can swing **past the ESP32's 3.3 V ADC limit, which damages the pin.** Scale/bias it into 0–3.3 V with the mid-point at ~1.65 V. The signal is bipolar AC, so it needs a mid-rail bias. |
| 3. Calibrate | The module's gain is set by an on-board potentiometer and is **not calibrated**. Compare the reported `voltage` against a multimeter and set `settings/voltage_cal_mv_per_v` (1–20 mV/V, NVS-persisted, no reflash). |
| 4. Enable | Uncomment `HAS_VOLTAGE_SENSE` in `VoltSense.ino` and reflash |

Until step 4 the firmware behaves exactly as before — the gate ships closed so a floating pin
cannot invent a voltage and be multiplied into every wattage.

---

## Stage 0.4 — Build the firmware (do this before anything else)

**The sketch does not fit the default partition.** Verify a clean build before you touch hardware —
a firmware that does not build is the one failure no amount of bench work can work around.

### Required libraries

| Library | Notes |
|---|---|
| **Firebase Arduino Client Library for ESP8266 and ESP32** | mobizt. Provides `Firebase_ESP_Client.h`. **Not** the `FirebaseArduino` / `FireBase32` libraries. |
| **WiFiManager** | tzapu — the captive portal |
| `NTPClient` | Fabrice Weinberg |
| `WiFi`, `HTTPClient`, `Preferences`, `esp_task_wdt`, … | Bundled with the ESP32 core — do not install separately |

### Partition scheme — **change this or the build fails**

The sketch needs **~1.48 MB**, but the ESP32 default partition allocates only **1.2 MB**, so a stock
build stops with:

```
Sketch uses 1482683 bytes (113%) of program storage space. Maximum is 1310720 bytes.
Error during build: text section exceeds available space in board
```

In the Arduino IDE set **Tools → Partition Scheme → "Huge APP (3MB No OTA/1MB SPIFFS)"**. The
firmware uses no OTA and stores its state in NVS (not SPIFFS), so trading the OTA slot for app space
costs nothing.

### Command-line build

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=huge_app" esp32/VoltSense
```

> **Why this section exists.** The firmware in this repository had **never been compiled**. It
> carried three separate build errors (an auth API that does not exist in the current library, a
> duplicated `enum`, and a type-ordering problem with the Arduino auto-generated prototypes). The
> fixes are in `VoltSenseTypes.h` and the device-identity block; the details are in
> `docs/PROJECT-RULES.md`. A clean build is now the cheapest possible regression check — run it
> before blaming the hardware.

---

## Stage 1 — Bench, no mains: power and boot

**Goal:** the board boots, prints a coherent log, and reaches the network. Nothing is plugged into
the relays yet.

1. Flash `esp32/VoltSense/VoltSense.ino`. Open Serial Monitor at **115200**.
2. Expect, in order:
   ```
   Connected to WiFi!
   Device MAC Address: XX:XX:XX:XX:XX:XX
   --- Endpoint reachability self-test ---
     [ OK ] alert ...
     [ OK ] pair  ...
   ---------------------------------------
   ```
3. **Record the MAC now.** `WiFi.macAddress()` (`VoltSense.ino:2031`) is the **Wi-Fi station** MAC —
   it is *not* necessarily the sticker on the board. This string is what the server keys everything
   on, so copy it from the log, not from the label.

### Interpreting the self-test — this is the whole point of Stage 1

The boot probe classifies *why* an endpoint is unreachable, so you never again have to guess:

| Log line | Meaning | Action |
|---|---|---|
| `[ OK ]` | TCP + TLS + HTTP all completed | Nothing. Reachable. (A 401/405 is a pass here.) |
| `[TLS ]` | TCP connected, handshake failed | Pinned root no longer matches. Reflash with a fresh `ISRG_ROOT_X1`. |
| `[FAIL] WiFi down` | No network | Wi-Fi credentials / signal. Not a server problem. |
| `[FAIL] ... connection refused` | Host unreachable | DNS, or `ALERT_URL`/`PAIR_URL` wrong. |

> **This probe never carries the alert secret** and never touches `relay_status`. It is a reachability
> check only — it proves TLS works, not that alerts will authenticate.

### Stage 1 pass criteria

- [ ] Boots without a brownout/reset loop
- [ ] Wi-Fi connects
- [ ] Both endpoints report `[ OK ]`
- [ ] MAC recorded

---

## Stage 2 — Sensor sanity (still no mains)

**Goal:** prove the sensors read reality before they are trusted to switch anything.

### 2.1 PIR

Watch Serial while you move in front of the sensor, then stand still.

- [ ] Motion is detected when you move (occupancy goes true)
- [ ] It goes idle after you stop — allow the **15 min** default inactivity window, or temporarily
      lower `settings/inactivity_limit_minutes` in the RTDB console to make this fast

> **Gotcha:** if the PIR is left floating, or the grounds are not common, it can latch "occupied
> forever". If occupancy never clears, suspect wiring before firmware.

### 2.2 ACS712 current reading

With a known load on a port (a lamp, a fan), compare Serial/Settings against a clamp meter.

- [ ] Reading is non-zero only on the loaded port
- [ ] Magnitude is in the right ballpark
- [ ] Idle port reads ~0 A (an idle port reading a large constant means an ADC2 pin or a floating input)

> **The 5 A ceiling:** the `5 A` ACS712 variant **saturates at 5 A**. Above that the reading is no
> longer linear. Treat readings near 5 A as "≥5 A", not a measurement.

### 2.3 Relay clicks

- [ ] Each port's relay audibly clicks when toggled
- [ ] The click matches the intended port (swap two and you will chase a phantom bug later)

**Do not put mains on the relays yet.** Stage 3 is where loads go on, and only after the logic is
proven.

---

## Stage 3 — Relay switching under load (mains, supervised)

**Goal:** verify the relays actually control the outlets and the derating logic behaves.

Firmware imposes **relay dwell (2 s) and a 6-per-60 s rolling cap** per port to protect the hardware
(`runRelaySwitch`). Expect commands to be *suppressed* if you toggle faster than that — this is not a
bug:

```
Relay port N: SUPPRESSED (derating) — X suppressed so far
```

### ⚠️ First: verify the relay polarity — with NO mains connected

The firmware drives `digitalWrite(pin, on ? HIGH : LOW)`, i.e. it assumes **HIGH = energised**. Its
own source says so and flags the assumption as board-dependent:

> *"whether HIGH means energised depends on the relay board. The original code used HIGH = ON, and
> that convention is preserved here."*

**Most cheap 3-channel relay modules are active-LOW** — LOW energises the coil. Wire one of those to
this firmware and every port is inverted: the app says ON and the socket goes dead, the app says OFF
and it goes live. On mains that is not a cosmetic bug.

Check it **before any mains wiring**, on the bench:

1. Power the ESP32 and the relay board. **No mains on the relay contacts.**
2. Listen/watch for the relay state at boot, then toggle a port from the app.
3. If the logic is inverted, you need an inverting transistor/driver stage per channel, or a
   firmware change to `on ? LOW : HIGH` in `runRelaySwitch()`.

Do not skip this to save time. It is the difference between a working device and one that energises
a socket the user believes is off.

### Checks

- [ ] Relay polarity verified on the bench **before** mains
- [ ] Turning a port ON in the app physically powers the outlet
- [ ] Turning it OFF removes power
- [ ] Rapid toggling produces `SUPPRESSED (derating)` rather than relay chatter
- [ ] The DB's `relay_status` reflects the **actual** state after a suppressed command is repaired
- [ ] No relay is left in a state that contradicts the app

> ⚠️ **Mains.** Work with the supply isolated, and do not touch the relay board while energised. If you
> are not confident with mains wiring, use low-voltage loads (12 V lamps) for Stages 3–4 and only
> move to mains once the logic is proven.

---

## Stage 4 — Safety cutoffs (this is the part that matters most)

These are the behaviours that protect the hardware and the room. Test them deliberately, not by
accident.

### 4.1 Soft overcurrent cutoff

**What it does:** if a port exceeds the limit (**default 4.5 A**) for a debounced window, the firmware
opens that port's relay and files an alert.

1. Put a load on one port that exceeds the limit.
2. Expect within a few seconds:
   - Serial: `OVERCURRENT TRIP: port N cut at X.XX A (limit Y.YY A).`
   - The relay opens (audible click)
   - An alert appears in the app

> **This is not a fuse.** Two hard limits to understand:
> 1. The ACS712 **saturates at 5 A**, so a genuine short can exceed what the sensor can even report.
> 2. If a relay contact **welds shut**, no software can open it.
>
> The cutoff is a *convenience and damage-limiter*, not a substitute for a real breaker or fuse.
>
> **The fuse and the software cover different failures, by design:**
>
> ```
> 4.5 A  software cutoff (debounced)  -> soft overloads; opens the relay
> 5.0 A  fuse                         -> hard faults, and anything the saturated sensor cannot see
> ```
>
> The software threshold sits just below the fuse so it acts first on the recoverable case.
> **Spec: 5 A max, 250 VAC, ceramic (not glass), time-lag, one per port, live conductor, upstream of
> the relay.** Full reasoning in `docs/HANDOFF.md` §1.1.

### 4.2 Response window (occupancy shutdown)

1. Let the room go idle past the inactivity window.
2. Expect an alert. Then — before the window elapses — press **"Keep On"** in the app.
3. Confirm the shutdown **does not** happen.

> **Known copy bug:** the alert text says *"shut down in 60 seconds"*, but the actual window is
> **5 minutes** (`RESPONSE_WINDOW_MS = 300 * 1000UL`). Trust the behaviour (5 min), not the text. This
> is documented in `INTEGRATION-AUDIT.md` §3.3 and **deliberately left unfixed** so far — fixing it
> requires a reflash.

### 4.3 Watchdog

- [ ] Left alone through a full idle → shutdown cycle, the device does **not** reset (watchdog is
      `esp_task_wdt`, 30 s, and is fed before blocking calls)
- [ ] If you do induce a hang, the device recovers rather than locking up permanently

---

## Stage 5 — Pairing and ownership

**Goal:** the device appears in your account and only your account.

Using the self-pairing path, the device prints:

```
   PAIRED. Enter this code in the VoltSense app to add it:
        >>>   XXXXXXXX   <<<
```

- [ ] The code is accepted by the app (Dashboard shows real readings, not "Demo")
- [ ] The device node appears at `devices/<MAC>` in the RTDB console
- [ ] `device_uids/<MAC>` now exists (server-written only)
- [ ] Unpairing from the app clears ownership (`/api/unpair`) and the device stops being visible to
      that account

> The code lives **only** in `pairingCodes/<CODE>` and expires in ~30 minutes. That is deliberate — a
> copy under `devices/<MAC>` would be harvestable by any signed-in user.

---

## Stage 6 — End-to-end alert delivery

**Goal:** the full chain, device → Vercel → FCM → **closed app**.

This is the last link and the only one that cannot be proven from a computer. Follow
**`docs/PUSH-TEST.md`** — it has the procedure, the timing diagram, and a per-`outcome` diagnosis
table.

Summary of the chain, and where each link can be checked:

| Link | How to verify |
|---|---|
| Device → server | Serial: `Alert -> HTTP 200`. `401` = secret mismatch. |
| Server accepted | RTDB `devices/<MAC>/alerts/<newest>` → `outcome` = `sent` |
| FCM → phone | **Only the phone can confirm this.** App must be fully closed. |
| Phone → app history | Alerts tab shows the same event; badge increments |

> **`sent` is not proof of delivery.** FCM accepting a message means "queued", not "displayed". Only a
> real notification on a real phone, with the app swiped away, closes this link.

> **Remember:** the Settings **Test** button does **not** test this path. It calls
> `showNotification()` from the open page and passes even on a broken build. See `PUSH-TEST.md`.

---

## Stage 7 — Settings reachability (known gaps)

The firmware honours several settings that **no UI writes**. Check them by hand in the RTDB console,
and be aware they persist:

| Setting | Firmware honours | UI to set it | Effect |
|---|---|---|---|
| `night_mode_*` | yes | ✅ Settings page | Symmetric schedule — works |
| `inactivity_limit_minutes` | yes | ❌ **none** | Occupancy window. Console-only. |
| `overcurrent_limit_a` | yes | ❌ **none** | Trip threshold. Console-only. |
| `nominal_voltage` | yes | ❌ **none** | Used for the VA→"power" display. Console-only. |
| `relay_status` | yes | ✅ Dashboard | Real switching |
| Port name / icon | n/a | ✅ Settings | **Cosmetic only** — does not affect hardware |

Firmware validates the numeric values and **ignores out-of-range input**:

```
Ignoring nominal_voltage X (outside 50-300 V)
Ignoring overcurrent_limit_a X (outside 0.5-5.0 A)
```

### ⚠️ After any manual test value, revert it

If you changed `inactivity_limit_minutes` or `overcurrent_limit_a` to provoke a test, **set them back**.
There is no UI to do it for you, and a value you forget here silently persists into field behaviour.
See `INTEGRATION-AUDIT.md` §4.

---

## Stage 8 — Soak

Only after Stages 1–7 pass:

- [ ] Run for 24–48 h with normal loads
- [ ] Confirm the day rollover happens (`Day rollover: <date> -> <date> (...)`)
- [ ] Confirm history accumulates without `history/* write failed` in Serial
- [ ] Confirm no unexpected resets (uptime keeps climbing)
- [ ] Confirm an alert raised in this period landed in the app's history

---

## Quick failure-signature index (Serial, 115200)

| Log | Cause | Fix |
|---|---|---|
| `Alert -> HTTP 401` | Device's `alert_secret` ≠ server's hash | Re-provision the secret |
| `Alert failed: SSL/TLS handshake failed` | Pinned root no longer matches | Reflash `ISRG_ROOT_X1` |
| `Alert failed: connection refused` | Host unreachable — **not** a credential problem | Network / DNS / stale deploy |
| `Alert skipped: no alert_secret in NVS` | Never provisioned | Run `ProvisionToken.ino` or self-pair |
| `Alert already in flight; dropping this one` | Expected de-duplication | Not a bug |
| `Relay port N: SUPPRESSED (derating)` | Dwell / rolling cap engaged | Expected — not a bug |
| `Ignoring nominal_voltage / overcurrent_limit_a` | Out-of-range value pushed | Use a value in range |
| `Watchdog could not watch loopTask` | WDT misconfiguration | Investigate before field use |

---

## The short version

1. **Endpoints live + TLS issuer still ISRG** → then power the board.
2. **Boot log clean, MAC recorded, self-test `[ OK ]`.**
3. **Sensors read reality** — PIR toggles, ACS712 tracks a known load.
4. **Relays switch under load**, derating suppresses rapid toggles.
5. **Safety cutoffs fire** — overcurrent trip, and "Keep On" beats the shutdown window.
6. **Pair and claim**, then unpair to prove ownership is reversible.
7. **Real push with the app closed** (`PUSH-TEST.md`) — the only step no computer can do for you.
8. **Revert any test settings**, then soak.
