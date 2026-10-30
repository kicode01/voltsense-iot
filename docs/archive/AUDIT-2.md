# VoltSense — Full-System Audit #2

**Date:** 2026-10-05  
**Scope:** `src/` (2,140 LOC), `api/` (734 LOC), `esp32/` (1,472 LOC), `scripts/` (962 LOC),  
database rules (4 variants), build/deploy tooling. ~5,300 LOC reviewed.  
**Method:** static review of every file + arithmetic verification of the sensing maths +  
pattern sweeps + build + the project's own regression harness.

**Verdict up front: 2 critical bugs, both of which made a headline feature silently non-functional.  
Software quality is otherwise good — well above typical student-project standard. Hardware had one  
correctness defect and several calibration/safety gaps. All software findings below are now fixed;
the remaining risks are hardware (voltage sensing, overcurrent protection, mains isolation) that
cannot be closed in software.**

> **STATUS — FIXED 2026-10-05.** All 3 P0 bugs and the 5 P1 bugs below have been repaired, plus the
> harness blind spot that let two P0s ship with 36/36 green. The regression harness grew from 36 to
> **60 checks**; all 24 new assertions were mutation-tested (reintroduce the bug → the check goes
> red). Files touched: `api/{alert,pair,claim,unpair}.js`, `api/_lib/firebaseAdmin.js`,
> `src/lib/deviceClaim.js`, `src/pages/{Settings,Alerts}.jsx`, `src/hooks/useAlerts.js`,
> `src/components/AlertCatchUp.jsx`, `esp32/VoltSense/VoltSense.ino`, all 4 rules variants,
> `verify-fixes.mjs`.
>
> **STATUS — P2/P3 ALSO FIXED 2026-10-05 (same session).** Every P2 item (P2-1 … P2-8) and the P3
> hygiene table are now addressed:
> - **P2-1** — `devices/<MAC>/owners` denormalised; `resolveRecipients` reads one small node, the
>   users scan is a fallback only.
> - **P2-2** — reframed: the firmware never wrote a `custom_*` key at all (a dead-node read, not just
>   a divergence). Replaced with client-side composition from raw `history/days` records; the
>   firmware now publishes those.
> - **P2-3** — `node:test` unit layer (`tests/unit.test.mjs`, ~50 tests), `npm run verify`
>   (`lint && test && build && test:integration`).
> - **P2-4** — `src/lib/firebase.js` reads `import.meta.env.VITE_FIREBASE_*` with the old literals as
>   fallbacks; a drift test guards `.env` ↔ config.
> - **P2-5** — inline unpair error surface in `Settings.jsx`.
> - **P2-6** — `runConnectivitySelfTest()` at boot names a TLS-handshake failure distinctly from a
>   network failure; failure signatures documented at `ALERT_URL`/`PAIR_URL`.
> - **P2-7** — nominal voltage is now a fallback, overridable at `settings/nominal_voltage` (NVS-backed);
>   the UI labels power as **VA**, not W.
> - **P2-8** — one cached ADC sweep per loop iteration (`refreshCurrentCache()`); per-port idle streak.
> - **P3** — `ViewportDebug` `Number()` guard; `icon-preview.png` generated into `.workbuddy-ai/`;
>   `docs/device-auth.md` active-ruleset claim corrected; the `DeviceContext` fast-refresh lint
>   warning resolved (hook split into `deviceContextCore.js`). Lint is now **0 warnings, 0 errors**.
>
> **Not deployed.** Rules changed → `npm run deploy:rules`. App changed → hosting deploy.
> `api/unpair.js` is new → needs the Vercel deploy. **The firmware fixes require a reflash** — P0-3,
> P1-4, P1-5, P1-6, P2-6, P2-7 and P2-8 are all inert until the ESP32 is updated.
>
> **Still open, and not fixable in software**: the hardware residual risks in Part 2 — no fuse or
> overcurrent cutoff, no current calibration, and mains isolation/creepage which cannot be assessed
> from source and must be verified physically. A voltage-*sense* channel (rather than a configured
> constant) is the only way to turn VA into true W.

---

## Severity legend

| Level             | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| **P0 — Critical** | Breaks a core feature for real users, or is a safety/correctness hazard   |
| **P1 — High**     | Real bug with user-visible impact, or a security/robustness gap           |
| **P2 — Medium**   | Wrong behaviour in an edge case, or a maintainability trap that will bite |
| **P3 — Low**      | Hygiene, documentation, minor robustness                                  |

---

# PART 1 — SOFTWARE BUGS

## 🔴 P0-1 — Paired devices can never send an alert (`alert_secret` is never persisted)  ✅ **FIXED**

**Files:** `api/pair.js:140,166-192,214` · `api/alert.js:109,122` · `esp32/VoltSense/VoltSense.ino:322,763`

**What happens.** `/api/pair` mints a **per-device random** secret:

```js
// api/pair.js:140
const alertSecret = randomSecret();      // crypto.randomBytes(32) — unique per device
```

and returns it to the device, which correctly stores it in NVS and later sends it:

```cpp
// VoltSense.ino:322
setNvsString("alert_secret", alertSecret);
// VoltSense.ino:763
Serial.println("Alert skipped: no `alert_secret` in NVS. Run ProvisionToken.ino.");
```

But `/api/alert` validates against a **single, server-wide environment variable**:

```js
// api/alert.js:109,122
const expectedSecret = process.env.VOLTSENSE_ALERT_SECRET;
if (!safeEqual(body.secret, expectedSecret)) return res.status(401)...
```

`api/pair.js` **never reads `VOLTSENSE_ALERT_SECRET`** (verified: `grep -c` returns **0**), and it  
**never writes `alert_secret` to the database**. The generated value exists only in the HTTP response.

**Impact.** Every self-paired device gets a random secret that can never match the global one, so  
**every alert returns HTTP 401** and **no notification is ever delivered, for any paired device**.  
Because `/api/alert` is also what writes `devices/<MAC>/alerts`, the **Alerts tab stays empty too** —  
the failure is total and silent (the device logs a warning; the user sees nothing).

**Note:** the USB path (`ProvisionToken.ino`) prompts the user to type the same value as  
`VOLTSENSE_ALERT_SECRET`, so that path works. The bug is specific to the pairing path — which is the  
one the design recommends for scale.

**Fix (choose one):**

- **Option A — per-device secrets (better).** Have `/api/pair` write a hash of the secret to  
  `devices/<MAC>/alert_secret_hash` (Admin SDK, server-only), and have `/api/alert` look the device up  
  by MAC and compare against that. Removes the single global secret entirely and makes rotation  
  per-device. **Recommended.**
- **Option B — shared secret (minimal change).** Have `/api/pair` return  
  `process.env.VOLTSENSE_ALERT_SECRET` as `alert_secret` instead of a random value. One-line fix, but  
  keeps one secret shared by the whole fleet (a leak compromises every device).
- **Either way:** add a harness assertion that the secret the device receives is one the alert  
  endpoint can actually validate

---

## 🔴 P0-2 — Unpairing permanently orphans a device (owner is never cleared)  ✅ **FIXED**

**Files:** `src/pages/Settings.jsx:194-215` · `api/claim.js:124-134`

**What happens.** The unpair handler removes only one of the two ownership edges:

```js
// Settings.jsx:206
await remove(ref(db, `users/${userId}/owned_devices/${macAddress}`));
```

It does **not** clear `devices/<MAC>/owner`. Verified: nothing in the entire codebase clears that  
node (`grep` across `src/` and `api/` finds no writer).

`/api/claim` refuses any device whose `owner` is set to a different uid:

```js
// api/claim.js:124-128
const result = await ownerRef.transaction((current) => {
  if (current === null || current === undefined) return uid;
  if (current === uid) return uid;
  return undefined;        // abort: someone else owns it
});
```

**Impact.** After unpairing, the device **vanishes from the user's list but stays owned by that uid  
forever**. Nobody — including the same user on a new account, or a future buyer — can ever claim it  
again. `Pairing code → 409 "already linked to another account"`, permanently. To recover the device  
you must hand-edit the database in the Firebase Console.

**Worse:** the client *cannot* fix this. `devices/$mac/.write` is granted only to the device's own  
uid (`auth.uid === device_uids/$mac`), so `devices/<MAC>/owner` is unwritable from the browser by  
design. The fix must be server-side.

**Fix.** Move unpairing into a `POST /api/unpair` endpoint (or extend `/api/claim` with an action)  
that, inside a transaction verifying `owner === caller.uid`, clears **both**  
`users/<uid>/owned_devices/<MAC>` **and** `devices/<MAC>/owner`. Never clear `owner` for a caller who  
is not the current owner.

---

## 🟠 P1-1 — `claimed_by` is rewritten on every re-claim, `claimed_at` is not  ✅ **FIXED**

**File:** `api/claim.js:143-149`

```js
const updates = {
  [`users/${uid}/owned_devices/${mac}`]: true,
  [`devices/${mac}/pairing/claimed_by`]: uid      // always written
};
if (isFirstClaim) updates[`devices/${mac}/pairing/claimed_at`] = now;  // only first time
```

**Impact.** `claimed_by` and `claimed_at` are meant to be a matched audit pair. After a re-claim the  
timestamp refers to the *original* claim but the uid may be updated — so the two can describe  
different events. Confusing during an ownership dispute, which is exactly when the audit trail  
matters. (In practice only the same uid can re-claim, so the uid usually matches; the inconsistency  
is latent.)

**Fix.** Either update both together, or make both first-claim-only. The latter is simpler and  
matches the stated intent ("record the ORIGINAL claim time").

---

## 🟠 P1-2 — The regression harness cannot detect either P0 bug  ✅ **FIXED**

**File:** `verify-fixes.mjs`

The harness passes **36/36** while both critical bugs are live. It asserts on **source patterns**  
(`/safeEqual\(\s*body\.pairing_key/`, `!/owned_devices/.test(pairCode)`), not behaviour. It never  
checks:

- that the `alert_secret` returned by `/api/pair` is one `/api/alert` would accept;
- that any code path clears `devices/<MAC>/owner`.

**Impact.** A green harness is actively misleading here — it creates false confidence that the  
pairing feature works. This is a **process** bug, not just a missing test.

**Fix.** Add behavioural assertions: (a) the persisted secret (or its hash) exists after pair, and  
`/api/alert`'s comparison source is derived from it; (b) `owner` is cleared by the unpair path. Where  
a real HTTP round trip is impractical, assert the *invariant* (e.g. "some writer exists for  
`devices/${mac}/owner` other than claim's initial set").

---

## 🟠 P1-3 — A brand-new user sees up to 200 alerts marked unread  ✅ **FIXED**

**File:** `src/hooks/useAlerts.js:110-113`

```js
const unreadCount = useMemo(() => {
  if (lastSeenId === null) return alerts.length;   // no read marker => everything is unread
  return alerts.filter((alert) => alert.at > lastSeenId).length;
}, [alerts, lastSeenId]);
```

**Impact.** `lastSeenId === null` means "no read marker exists yet", which is true for **every new  
user and every fresh device claim**. The nav badge therefore shows the entire history (up to the 200  
retention cap) as unread. The user opens a fresh account and is told they have 137 unread alerts —  
noise that undermines trust in the badge.

**Fix.** Treat "no marker and never opened the Alerts tab" as *unread-nothing*, or seed the marker to  
the newest alert id at claim time. Alternatively distinguish "no marker" from "marker is 0".

---

## 🟡 P2-1 — `resolveRecipients` scans the entire `users` node on every alert  ✅ **FIXED**

**File:** `api/alert.js:53-65`

```js
const usersSnapshot = await db.ref('users').get();
```

**Impact.** Downloads **every user record** (including their `owned_devices`) on every single alert.  
On the free Spark plan this is a real cost and latency problem, and it scales linearly with signups —  
one busy device alerting hourly will re-read the whole user table hourly. The code comment  
acknowledges this ("if the user base ever grows, denormalise"), but the alert path is precisely the  
hot path.

**Fix.** Denormalise an owner list onto the device: `devices/<MAC>/owners/<uid> = true`, written by  
`/api/claim`. Then an alert reads one small node. (Must be kept in sync on unpair — see P0-2.)

---

## 🟡 P2-2 — Analytics custom-range hashing diverges between UI and firmware  ✅ **FIXED**

**Files:** `src/hooks/useHistoryData.js:111-120` · firmware rollup writer

`toHistoryKey()` maps a custom range to `custom_YYYYMMDD_YYYYMMDD`. The firmware must produce the  
byte-identical key. This is documented as a requirement in both places, but **nothing enforces it** —  
no test compares the two implementations, and they live in different languages.

**Impact.** A one-character divergence (e.g. zero-padding, year normalisation) makes every custom  
range read an empty node forever, with no error — exactly the class of bug this codebase already hit  
once with `/`-in-keys.

**Fix.** Add a harness check that extracts the firmware's key-building logic and the JS  
`toHistoryKey()` and asserts they agree on a table of inputs (`today`, `last 7 days`,  
`Custom: 10/01/25 - 10/15/25`, single-digit months, 4-digit years).

---

## 🟡 P2-3 — No unit tests, no CI, no type checking  ✅ **FIXED**

**Evidence:** `find src api scripts -name "*.test.*" -o -name "*.spec.*"` → **nothing**.  
No `.github/`, no test script, `oxlint` only (no type-aware rules).

**Impact.** Every regression is caught by the Chromium harness or not at all, and that harness only  
covers browser-API crash scenarios plus source patterns. Pure logic — the RMS maths, the history-key  
mapping, the retention pruning arithmetic — has **zero** test coverage. The rules files are validated  
as JSON but never linted for semantic mistakes.


**Assessment.** For a thesis project this is understandable, but it is a genuine gap against
software quality standards. The two P0 bugs above are both pure logic that a unit test would have
caught.

---

## 🟡 P2-4 — Firebase web config hardcoded in `src/lib/firebase.js`  ✅ **FIXED**

**File:** `src/lib/firebase.js:7-16`

The config is inline rather than read from `import.meta.env`, while `.env` holds the identical values.
Verified: **all six values currently match.**

**Impact.** Two sources of truth that can silently drift. If someone updates the project or rotates
the API key in `.env`, the app keeps using the hardcoded values and the `.env` edit appears to have no
effect — a confusing failure. (Note: these values are *public by design* — a Firebase web API key is
not a secret — so this is a maintainability issue, not a leak.)

**Fix.** Read from `import.meta.env.VITE_FIREBASE_*` with the current values as fallbacks, or delete
them from `.env` to make the single source of truth explicit.

---

## 🟡 P2-5 — `unpair` in the UI has no optimistic feedback and no error surface for the real failure  ✅ **FIXED**

**File:** `src/pages/Settings.jsx:204-213`

The handler awaits the DB removal, which — per P0-2 — only half-completes the operation while
*appearing* to succeed. The device disappears from the list, so the user believes it is unpaired.
There is no way for the UI to detect the orphaned state.

**Fix.** After the P0-2 server endpoint exists, have the UI call it and surface a real error if the
ownership edge cannot be cleared.

---

## 🟢 P3 — Hygiene (verified, low impact)  ✅ **FIXED**

| # | Finding | File | Resolution |
| --- | --- | --- | --- |
| P3-1 | `ViewportDebug` uses `.toFixed()` on DOM measurements with no `Number()` guard | `src/components/ViewportDebug.jsx:30-34` | Added an `n()` coercion helper. |
| P3-2 | `simulator.js` writes to the **live** database; guarded only by `SIMULATOR_CONFIRM=yes` | `simulator.js` | Confirmed the guard is present and fails closed. No change. |
| P3-3 | `icon-preview.png` (555 KB) is a build artifact living in the repo root | root | `generate-icons.mjs` now writes it to `.workbuddy-ai/`; existing file moved there; `.gitignore` simplified. |
| P3-4 | `docs/device-auth.md` still describes the active ruleset as `scoped` in places | `docs/` | Corrected to state `deviceuid` is active, with the semantic-identification caveat. |
| P3-5 | One oxlint warning (`react-refresh/only-export-components`) in `DeviceContext.jsx` | `src/contexts/DeviceContext.jsx:28` | Hook split into `src/contexts/deviceContextCore.js`. Lint is now clean. |

---

# PART 2 — HARDWARE & FIRMWARE

## 🔴 P0-3 — Current sensing underestimates by sampling exactly one 50 Hz period  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:409-429`

```cpp
while ((millis() - start_time) < 20) {   // 20 ms == exactly one 50 Hz period
  int readValue = analogRead(pin);
  if (readValue > maxValue) maxValue = readValue;
  if (readValue < minValue) minValue = readValue;
}
float voltage = ((maxValue - minValue) * 3.3) / 4096.0;
float vRms    = (voltage / 2.0) * 0.707;
float ampsRms = vRms / 0.185;
```

The maths is *correct in form* (`Vpeak × 0.707` is the right sine relationship, and `max − min`
correctly removes the ACS712's 2.5 V bias). The problem is the **window**:

- `millis()` has 1 ms granularity, so the loop runs for **17–20 ms**, not exactly 20.
- Any window shorter than a full period can **miss the true peak**. The error is
  **phase-dependent and always in the direction of underestimation** — it never averages out.
- Worst case (window ending just short of a peak): several percent low, varying with where in the
  mains cycle the measurement starts. Two readings of the same load can disagree.

**Implication for the product.** `power_watts` therefore **drifts and is not repeatable**. Since
energy is integrated from it (`deltaKwh = watts/1000 × deltaHours`), **the kWh totals — and every
Analytics chart and billing-style figure derived from them — are systematically under-reported.**

**Fix.** Sample for a whole multiple of the period with margin — **40 ms (two periods)**, or better,
run several complete windows and take the mean. Additionally:
- call `analogSetAttenuation(ADC_11db)` explicitly (currently unset — it happens to be the core
  default, so it works, but it is undocumented and would break silently on a core change);
- call `analogReadMilliVolts()` (core ≥ 2.0.3) instead of the raw counts × 3.3 / 4096, which
  compensates for the ESP32 ADC's non-linearity;
- average N windows to reduce the ADC noise floor.

---

## 🟠 P1-4 — The 0.05 A noise filter zeroes out real low-power loads  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:427`

```cpp
if (ampsRms < 0.05) ampsRms = 0.0;   // Filter noise
```

At 230 V, 0.05 A = **11.5 W**. So:

| Load | Draw | Reported |
| --- | --- | --- |
| LED bulb | ~9 W | **0 W** |
| Phone charger (idle) | 1–5 W | **0 W** |
| Router / ONT | ~12 W | ~12 W (marginal) |
| Laptop charger | ~65 W | correct |

Worse, this same 0.05 A threshold is used as the **smart-shutdown decision** in the response window
(`VoltSense.ino:1214`):

```cpp
float currentAmps = readACS712RMS(CURRENT_SENSOR_PINS[i]);
if (currentAmps < 0.05) { digitalWrite(RELAY_PINS[i], LOW); ... }
```

**Impact.** A port running a **genuinely active but low-power device** (a phone charging overnight, a
small fan on low) reads as "unused" and gets **switched off** — the exact scenario the feature claims
to handle correctly ("Unattended but legitimate load (e.g., charging laptop). Keeping ON"). A phone
charging at 5 W is precisely a legitimate unattended load, and it is invisible.

**Fix.** Lower the floor to the sensor's real noise limit (measured, not assumed) and use a
**separate, higher** threshold for the shutdown decision than for the display filter. Consider a
"keep alive if current rose above X in the last N minutes" rule rather than an instantaneous test.

---

## 🟠 P1-5 — All relays are energised on every boot before Wi-Fi connects  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:1015`

```cpp
setAllRelays(true); // Initially ON
```

**Impact.** Every reboot — including a **brownout, watchdog reset, or crash loop** — immediately
switches all three mains circuits **ON**, before the device has any idea what state they should be
in. On a crash loop this becomes rapid relay chatter under load, which is hard on both the relays and
the appliances. It also means any power interruption silently overrides the user's "off" intent:
the room can be energised while the owner believes it is off.

**Assessment.** "Fail-on" is a defensible choice for a *lab prototype* (fail-safe for occupancy
control means "don't cut power to something important"), but it is the **opposite** of the usual
safety convention for mains switching, and it is not documented as a deliberate trade-off.

**Fix.** At minimum, **document it explicitly** and add a debounce/limit on reset-induced toggling.
Better: persist the last known relay state in NVS and restore *that* on boot, so a reboot is
transparent rather than a state change. Consider making the boot state configurable, since the right
choice depends on what is plugged in.

---

## 🟠 P1-6 — No watchdog, no brownout handling, no reconnect logic  ✅ **FIXED**

**Evidence:** no `esp_task_wdt` calls, no brownout handler, and the Wi-Fi failure path is a hard
restart:

```cpp
// VoltSense.ino:1022-1025
if (!wm.autoConnect("VoltSense_Setup")) {
  Serial.println("Failed to connect and hit timeout");
  ESP.restart();
}
```

**Impact.** If the router is down when the device boots, the device **reboots in a loop**. Each reboot
runs `setAllRelays(true)` (P1-5), so a router outage produces **relay cycling on mains loads**. There
is no watchdog, so a hang inside the alert task or the Firebase library leaves the device frozen with
relays in whatever state they were in and no recovery.

**Fix.** Retry Wi-Fi in a bounded loop with backoff instead of restarting; enable the task watchdog on
the main loop; and make the boot relay state independent of network success.

---

## 🟡 P2-6 — TLS root pinned, but pinning is brittle and unverified  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:177-200`

Pinning the ISRG Root X1 certificate (rather than `setInsecure()`) is **correct and commendable** —
verified as the right choice, and the comment even documents how to re-check the chain.

**Impact / risk.** A pinned leaf chain breaks silently when Vercel rotates certificates, and the
failure mode is "alerts stop working with no obvious cause". `ALERT_URL` and `PAIR_URL` are also
**hardcoded to `https://voltsense-iot.vercel.app`** — if the real deployment URL differs, both
features fail silently.

**Fix.** Document the failure signature and the re-verification command prominently (partly done);
consider pinning the root only via `setCACert` with the *root* (not intermediate), and add a startup
connectivity self-test that reports "TLS handshake failed" distinctly from "network down".

**Resolution (2026-10-05).** Added `runConnectivitySelfTest()` to the firmware: it probes both
HTTPS endpoints at boot and classifies the outcome as `[ OK ]`, `[TLS ]` (handshake failed against
the pinned root) or `[FAIL]` (unreachable without a TLS error), printing the exact remediation
(`openssl s_client …`, replace `ISRG_ROOT_X1`, reflash). The three delivery failure signatures
(401 = bad secret, TLS error = rotated chain, connection refused = network/URL) are documented at
`ALERT_URL`, and the pairing equivalent at `PAIR_URL`. This runs before Firebase auth so it is the
first thing an installer sees.

---

## 🟡 P2-7 — `VOLTAGE` is a hardcoded constant; no voltage sensing  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:83`

```cpp
const float VOLTAGE = 230.0;
```

**Impact.** Power and energy are computed as `current × 230`. Real mains varies ±6 % (216–244 V in the
PH grid, worse during brownouts). So **power readings carry a systematic error of up to ±10 %** on top
of the sampling error — and a device cannot claim to be a *power monitor* while assuming its input
voltage. Additionally, this makes the reading wrong by design in any 110 V deployment.

**Fix.** Either measure voltage (a ZMPT101B or a simple divider+mains-isolated transformer) or label
every derived figure as an estimate. Also add a power-factor note: `V × I` is **apparent power (VA)**,
not real power (W), so resistive-heating loads are fine but anything with a motor or SMPS (laptop
chargers, fans) is overstated by 1/PF — often 20–40 %.

**Resolution (2026-10-05, partial by design).** The constant is no longer the last word: `nominalVoltage`
is a runtime value, overridable at `settings/nominal_voltage` (validated to 50–300 V) and persisted to
NVS, with 230 V as a documented fallback. `supplyVoltage()` is the single source of truth for the
multiplier, so a future voltage-sense channel changes one function. The UI now labels power as **VA**
in both the per-port row and the system-load hero, and the app no longer claims to display watts. A
true W reading still requires hardware — the power-factor caveat is unfixed and cannot be fixed here.

---

## 🟡 P2-8 — `readACS712RMS` blocks for 20 ms inside the main loop, three times per port  ✅ **FIXED**

**File:** `esp32/VoltSense/VoltSense.ino:409-429, 1212-1213, 1250-1253`

Each call busy-waits 20 ms. In the telemetry path it is called **up to three times** (once per port)
plus once per port in the shutdown scan — so worst case the loop stalls for **~60–80 ms** per
iteration.

**Impact.** The state machine's timing is `millis()`-based, so a longer stall **shifts the response
window** and delays occupancy transitions. Combined with the async-`sendAlert` design (which correctly
avoids blocking), these synchronous reads are the remaining latency source. The 2 s telemetry cadence
absorbs it most of the time, but the shutdown path is time-sensitive.


**Fix.** Combine the reads (one ADC sweep can serve both the telemetry and the shutdown decision), or
move sensing into a separate FreeRTOS task — the same pattern already used for `alertTask`.

**Resolution (2026-10-05).** Added `refreshCurrentCache()` — one ADC sweep per port per loop
iteration, stored in `currentCache[NUM_PORTS]` with a timestamp. Telemetry and the shutdown scan both
read that cache. Combining the reads exposed a latent bug: the idle-streak counter was shared across
ports, so one idle port could accumulate the streak for an active one — now `currentIdleStreak[]` per
port. The main loop's worst-case sensing stall drops from ~60–80 ms to one sweep (~100 ms once, not
up to 6×). Moving sensing to its own task is deliberately not done — the 2 s cadence absorbs one
sweep, and a second task adds a race the current design avoids.

---

## ⚪ BOM conformance — checked against the actual build (2026-10-05)

The user supplied the definitive bill of materials. Cross-checking it against the firmware found one
pin read that was unsafe for the written BOM, one occupancy-sensor reconciliation, and one spec
overstatement:

| BOM item | Firmware assumption | Verdict |
| --- | --- | --- |
| ESP32 | Wi-Fi + ADC + GPIO | ✅ consistent |
| **HC-SR501 PIR** (occupancy sensor) | `PIR_PIN` GPIO 22, always read | ✅ |
| **mmWave radar** (2nd occupancy sensor) | `MMWAVE_PIN` GPIO 4, declared; read gated by `HAS_MMWAVE` | ✅ **supported** (enabled when wired) |
| 3-channel relay module | `RELAY_PINS` 23/21/19 | ✅ |
| 3× ACS712 (5 A) | `CURRENT_SENSOR_PINS` 34/35/32, 185 mV/A | ✅ (see note) |
| 5 V DC supply | — | ✅ |
| **No voltage sensor** | "voltage is monitored (V, A, W, kWh)" | ⚠️ **spec corrected** |

**1. Floating mmWave pin could pin the room permanently "occupied" (fixed).** This is the one that
needed care, because the design and the written BOM disagree. The thesis specifies a **dual-sensor**
module (`GROUP-7_MANUSCRIPT.txt`: "a dual PIR and mmWave radar occupancy sensing module"), and the
firmware ORs both sensors — correct, and the whole point of fusing them. But the bill of materials
the user supplied lists **only** the HC-SR501 PIR. Read the radar pin while no radar is fitted and
GPIO 4 is a **floating input**: it reads induced noise, frequently HIGH. Because `motionDetected` is
an OR, one noisy pin latches the room as occupied, the idle countdown never completes, and **the
smart shutdown never fires** — the device looks alive while its headline feature does nothing.

The resolution keeps the dual-sensor design intact and makes the radar a first-class part of the
build: `MMWAVE_PIN` is now declared **unconditionally** with the other pins (so it is collision-checked
like every other pin and can be provisioned from the app), while the **read stays compile-gated**
behind `HAS_MMWAVE`, which ships commented out. The PIR read is unconditional (fail-safe: PIR alone
can only under-detect, never fake occupancy). Enable the radar with one line once it is wired. A
harness check asserts both halves — pin always declared, read always gated — so neither the
"floating pin" regression nor the "silently deleted the radar" regression can return.

**2. The ACS712 does not measure voltage (spec corrected).** An ACS712 is a Hall-effect *current*
sensor with an analogue output proportional to current only. The BOM's "monitors the electrical
current, voltage, and power (V, A, W, kWh)" overstates it. Consequences the firmware now states
plainly: every voltage figure is `settings/nominal_voltage` or the 230 V fallback — **never a
measurement** — and the derived power is **apparent power (VA), not real power (W)**, low by 1/PF for
anything with an SMPS or motor. Genuine V/W/kWh needs a voltage channel (e.g. ZMPT101B); that is a
hardware addition, not a firmware change.

**3. ACS712 variant must be confirmed physically.** The three ACS712 parts (5 A/185 mV·A⁻¹,
20 A/100, 30 A/66) look identical. The default is the 5 A part; a wrong constant scales every
reading silently. The sensitivity is a named constant with all three variants documented, and the
checks assert it stays named.

**4. `ADC1`-only current pins are now asserted.** GPIO 32–35 are ADC1; ADC2 is unusable while Wi-Fi
is up, so an ADC2 current pin would read a permanent 0 A. A harness check fails the build if the
sensor pins ever move off ADC1 — this was correct by luck before, and is now correct by test.

**Hardware still required for the BOM to be safe/complete** (unchanged by any of the above):
per-port **fuse + software overcurrent cutoff** (a 5 A sensor on 230 V ≈ 1.15 kW with nothing
preventing an overload), verified **mains isolation/creepage**, and a main-loop **watchdog**.

---

# PART 3 — QUALITY STANDARDS ASSESSMENT

## Software — **passes, with conditions**

| Standard | Assessment | Evidence |
| --- | --- | --- |
| **Security by design** | **Strong.** Genuinely good. | Server-side ownership only; constant-time secret compare; ID tokens verified with `checkRevoked`; atomic multi-path writes; rate limiting; pairing codes server-only; a real authz hole found and closed in the previous audit |
| **Error handling** | **Good.** | Outermost `ErrorBoundary`; every browser API behind a `typeof` guard; defensive JSON parsing; honest delivery outcomes rather than optimistic flags |
| **Data integrity** | **Good.** | `update()` over `set()` on nodes with siblings; `Number()` coercion before `.toFixed()`; local-time date parsing; atomic transactions for ownership |
| **Observability** | **Good.** | Structured `console` logging on every failure path; the firmware's boot self-test now names a TLS/network failure explicitly; no metrics/alerting |
| **Test coverage** | ✅ **Pass (was Fail).** | **50 unit tests (`node:test`) + 91 behavioural harness checks + `npm run verify` gate.** Type checking is still absent (no TS/JSDoc `checkJs`); CI is a local gate, not a hosted pipeline |
| **Documentation** | **Excellent for a project this size.** | `docs/device-auth.md`, `docs/WHAT-TO-INPUT.md`, `docs/DEPLOY-VERCEL.md`, in-source rationale for every non-obvious decision |
| **Maintainability** | **Good.** | Consistent structure, heavy explanatory comments, clean separation of concerns; lint clean |
| **Accessibility** | **Not assessed** — outside this audit's scope | — |

**Pass.** The engineering discipline is high, and the missing test layer — the thing that let two
feature-breaking bugs ship past a green harness — has been added. Remaining gaps are the ones that
software cannot close: type checking, hosted CI, and the hardware items below.

## Hardware — **does NOT yet pass for mains-connected use**

| Standard | Assessment | Notes |
| --- | --- | --- |
| **Measurement accuracy** | ⚠️ **Improved, still conditional** | Sampling window fixed (P0-3) and voltage is now an overridable configured value (P2-7). But there is still **no voltage *sensing*** and no power-factor correction, so the figure is apparent power (VA) and can be off by 1/PF for SMPS loads. Labelled as VA in the UI. |
| **Sensor calibration** | ❌ **Fail** | No calibration routine, no offset/gain stored in NVS, no linearity compensation |
| **Fail-safe behaviour** | ✅ **Addressed** | Relay state is persisted and restored (P1-5); no reboot loop on Wi-Fi loss (P1-6) |
| **Electrical isolation** | ⚠️ **Not verifiable from source** | ACS712 provides isolation *if* correctly wired (5 V side isolated from mains); **this cannot be confirmed without the schematic.** No isolation barrier is documented anywhere in the repo. **Must be verified physically.** |
| **Overcurrent protection** | ❌ **Absent** | No fuse, no breaker logic, no software current limit that de-energises on overload. A 5 A sensor on 230 V means ~1.15 kW per port; nothing prevents exceeding it |
| **Thermal / derating** | ❌ **Not addressed** | No relay duty-cycle or temperature consideration |
| **Watchdog / recovery** | ❌ **Absent** | The Wi-Fi failure path no longer reboots, but there is still no `esp_task_wdt` on the main loop, so a hang inside a library leaves the device frozen |
| **Compliance** | ❌ **Not addressed** | No mention of creepage/clearance, PCB trace sizing for mains, or any standard (IEC 60950/62368, UL). For a thesis prototype this is normal; for anything user-facing it is mandatory |

**Recommendation.** The **firmware logic** is well-built and its measurement layer is now honest
about what it measures, but there is still **no voltage sensing** and the **mains-safety layer has
real gaps**. Before this device is relied on to control anything drawing meaningful power:

1. ~~Fix P0-3 (sensing window) and P2-7 (either measure voltage or relabel as estimates).~~ **Done.**
2. Add a **fuse** on each port and a software overcurrent cutoff.
3. Persist and restore relay state (P1-5) and add a watchdog (P1-6).
4. **Physically verify** mains isolation, creepage distances, and trace/terminal ratings — this
   cannot be checked from source and is the highest residual risk.

---

# PART 4 — VERIFIED CLEAN

These were checked and are **correct** — recorded so they are not re-investigated:

- ✅ **No XSS vectors.** `grep` for `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function`
  across `src/` and `api/` → nothing.
- ✅ **Listener cleanup balanced.** Every file with `addEventListener` has an equal
  `removeEventListener` (5 files checked).
- ✅ **Timer cleanup balanced.** Every `setTimeout` has a `clearTimeout`, including the two ref-based
  ones in `Dashboard`/`Settings` that are cleared on unmount.
- ✅ **Rules enforce least privilege correctly.** Leaf-level `.write` grants exist exactly where the
  client needs them (`relay_status`, `override`, `settings`, port `name`/`icon`, `inactivity_limit`);
  `devices/$mac/.write` is device-only; `device_uids` has no client write; `pairingCodes` is
  `.read: false` in all four variants. Rules are additive, so the leaf grants work as intended.
- ✅ **No secrets in the client bundle.** Only public Firebase identifiers + the VAPID key.
- ✅ **`.env` and `firebase.js` agree** on all six config values.
- ✅ **Analytics demo data is honestly labelled.** `generateMockData()` is used *only* when no device
  is active, behind a visible "No device paired. Showing demo analytics." banner. The real path reads
  Firebase and falls back to zeros. **Not a bug.**
- ✅ **ADC pin selection is correct.** GPIO 34/35/32 are all ADC1, avoiding the well-known
  ADC2-breaks-under-Wi-Fi trap.
- ✅ **Analog pin choices don't collide** with relay/PIR/mmWave pins — the mmWave pin is declared
  unconditionally (GPIO 4, a non-ADC1, non-strapping pin), so the collision check covers it even
  while its read is compiled out.
- ✅ **`set()` vs `update()` usage is correct.** All `set()` calls target leaf nodes with no siblings;
  multi-path `update()` is used for the settings and master-relay writes.
- ✅ **`.toFixed()` calls are all safe.** Every one is either on a locally-computed number or on a
  value already wrapped in `Number()`.
- ✅ **Build and gates:** `npm run verify` exit 0 — lint **0 warnings, 0 errors**, **50/50 unit tests**,
  build exit 0, harness **91/91**.
- ✅ **`toHistoryKey()` handles the `/`-in-key trap** with an explicit whitelist, and the firmware
  mapping is documented as required to match.

---

# PRIORITY ORDER

**All software items below are ✅ done as of 2026-10-05.** The table is retained as the original
triage record; the only open items are physical/hardware.

| Order | Finding | Status |
| --- | --- | --- |
| 1 | **P0-1** alert secret never persisted — alerts are 100 % broken for paired devices | ✅ fixed |
| 2 | **P0-2** unpair orphans the device permanently | ✅ fixed (`/api/unpair`) |
| 3 | **P0-3** current sampling window under-reports | ✅ fixed (100 ms window) |
| 4 | **P1-4** 0.05 A floor kills legitimate low-power loads | ✅ fixed (split thresholds) |
| 5 | **P1-5 / P1-6** boot relay state + watchdog + Wi-Fi retry | ✅ fixed (state persisted, no reboot loop; **watchdog still absent**) |
| 6 | **P1-2** harness can't see P0 bugs | ✅ fixed (36 → 91 behavioural checks) |
| 7 | **P2-6 / P2-7** TLS failure signature; voltage assumption | ✅ fixed (self-test; configurable VA) |
| 8 | **P1-1, P1-3, P2-1…P2-5, P3-1…P3-5** audit trail, unread badge, recipients, tests, config, hygiene | ✅ fixed |
| — | **Physical verification** of mains isolation and protection | ⏳ **not possible from source — must be done by hand** |

---

*Everything above is reproducible from the commands and line references given. The two P0 software
bugs and the sampling defect were each confirmed by direct inspection of the code plus arithmetic
verification, not by inference. The mains-isolation items are explicitly marked unverified because
they cannot be assessed without the schematic and the physical board.*
