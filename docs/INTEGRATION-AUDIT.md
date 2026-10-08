# VoltSense — Hardware ⇄ Software Integration Audit

**Date:** 2026-10-05
**Scope:** Does the assembled system show *accurate* readings, store *accurate* history, deliver
alerts, and honour settings — and what exactly must be done to bring hardware + software up as one
working unit?

**Method:** static trace of every value from the firmware write to the React read, cross-checked
against the live built bundle (`dist/`). No hardware was flashed for this audit; the firmware
findings are source-level and flagged as such.

---

## 0. Verdict at a glance

| Subsystem | Reads real hardware? | Status |
|---|---|---|
| Dashboard live values | **Yes** | Accurate, with one honest caveat (VA not W) |
| Analytics / stored history | **Yes** | Accurate; real per-day records, client-composed ranges |
| Alerts — in-app list & badge | **Yes** | Works |
| Alerts — OS push when app closed | Yes | Fixed + **deployed** to Vercel and Hosting; worker verified; real-device delivery test still pending |
| Settings — night mode | Yes | Symmetric and honoured by firmware |
| Settings — inactivity limit | read-only | **No UI control** — firmware honours it but you cannot set it |
| Settings — overcurrent limit | read-only | **No UI control** — same |
| Settings — nominal voltage | not exposed | **No UI control** — power figures stay on the 230 V guess |
| Port names / icons | device ignores | Cosmetic dead write (harmless) |

The FCM background worker defect described below was fixed and **deployed to both targets on
2026-10-05**; the deployed worker was verified to execute the handler. What remains is a
**real-device delivery test** — a build check cannot prove the OS presents a notification.
Everything else is either an accuracy caveat or a missing control. See §3.4.

---

## 1. Dashboard — live data path

**Chain:** firmware 2-second telemetry push → `devices/<MAC>/...` → `useRoomData` (`onValue`) →
`Dashboard.jsx`.

Firmware write site: `esp32/VoltSense/VoltSense.ino:2287-2360`, a single `updateNode(roomPath, json)`
merging:

| RTDB field | Firmware source | UI read |
|---|---|---|
| `ports/port_0N/current_amps` | `readACS712ForDisplay(N)` (.ino:2309) | `Dashboard.jsx:432` |
| `ports/port_0N/power_watts` | `currentAmps * supplyVoltage()` (.ino:2311) | `Dashboard.jsx:429` |
| `ports/port_0N/energy_kwh` | `portEnergyKWh[N]` accumulator (.ino:2314) | not shown live |
| `ports/port_0N/voltage` | `supplyVoltage()` (.ino:2324) | not shown live |
| `ports/port_0N/relay_status` | `digitalRead(RELAY_PINS[N])` (.ino:2327) | toggle state |
| `total_power_watts` | sum of port VA (.ino:2335) | `Dashboard.jsx:84` |
| `is_occupied`, `state`, `countdown_remaining_seconds` | state machine | header/hero |
| `inactivity_limit` | `idleTimeoutMs/60000` (.ino:2336) | `Dashboard.jsx:89` |
| `overcurrent_limit_a` | `overcurrentLimitA` (.ino:2339) | not shown |

### Findings

1. **Readings are genuine sensor values.** `readACS712RMS()` (.ino:753) does a 100 ms
   min/max-capture sweep and converts peak-to-peak to RMS — a real current measurement, not a
   placeholder. The noise floor (`0.06 A`, .ino:751) is applied **only** on the display path
   (`readACS712ForDisplay`, .ino:869), so a de-energised port reads exactly `0` and cannot inflate
   the energy total. Verified: the active current sense and the display noise floor are cleanly
   separated from the *control* threshold (`CURRENT_ACTIVE_THRESHOLD_A`, .ino:852).

2. **Ordering is correct.** `refreshCurrentCache()` (.ino:800) runs once per loop iteration at
   .ino:2196 — *before* the state machine and *before* the telemetry block — so the 2-second push
   reads a fresh cache rather than a stale one. This was worth checking because the telemetry path
   calls `readACS712ForDisplay()` which reads the cache, not the ADC.

3. **The displayed power is VA, not W — and the UI says so.** `power_watts = current × voltage`
   assumes unity power factor. The Dashboard labels this `VA` with a tooltip (.ino commentary at
   199-208; `Dashboard.jsx:257,427`). **This is the honest presentation of a hardware limitation,
   not a bug.** Without a voltage-sense channel there is no way to compute real power. Expect the
   kWh totals to over-report for inductive loads (motors, switch-mode supplies).

4. **Voltage is a configurable fallback, not a measurement.** `supplyVoltage()` (.ino:226) returns
   `nominalVoltage` when it is in 50–300 V, else the 230 V constant. `nominalVoltage` is loaded
   from `settings/nominal_voltage` and persisted to NVS. **But no UI writes that key** (see §4), so
   in practice the app always multiplies by 230.0.

5. **Demo mode is clearly fenced.** When no device is paired, `Dashboard.jsx:39-46` shows hardcoded
   demo ports. It is gated on `isDemo = !activeDeviceId` (`Dashboard.jsx:56`) so it can never
   overwrite real data, and the toggles mutate only local `demoData`. Real data path:
   `data = roomData || {}`.

6. **Numeric-string coercion is handled.** Every displayed number goes through `Number(...)` with
   `|| 0` / `?? ` (e.g. `Dashboard.jsx:84,429,432`), so an RTDB `"301.5"` string cannot throw in
   `.toFixed()`.

**Conclusion:** the Dashboard shows accurate, honestly-labelled readings derived from the real
sensor. Units are correct as presented (VA). No fabricated numbers on the real-data path.

---

## 2. Analytics & stored history

**Two publishers, two readers — they agree on key names.**

- Fixed ranges: firmware `publishHistoryRanges()` (.ino:1206) writes `history/today`,
  `history/yesterday`, `history/last_7_days`, `history/this_month`.
- Raw records: firmware `publishDailyRecords()` (.ino:1172) writes
  `history/days/<YYYY-MM-DD> = { e: kWh, m: occupiedMinutes, p: peakWatts }`.
- Reader: `useHistoryData(roomId, timeRange)` (`src/hooks/useHistoryData.js:226`).
  Fixed ranges → `toHistoryKey()`; custom ranges → read `history/days` and compose client-side
  (`composeCustomRange`, :183).

### Findings

1. **Key agreement is exact.** `toHistoryKey` (`useHistoryData.js:113`) produces
   `today | yesterday | last_7_days | this_month`, matching the firmware's literal strings
   one-for-one. There is a cross-language test in the suite guarding this (`useHistoryData` ↔
   firmware key names).

2. **Custom ranges work and are honest about gaps.** The firmware cannot anticipate a custom range,
   so it publishes the raw daily records; the client walks the requested span and emits **zero for
   days with no record** rather than skipping them (`composeCustomRange` :197-213 — a gap would
   compress the x-axis and misalign the occupancy overlay). `maxDays = 31` matches the device's
   `MAX_HISTORY_DAYS` retention (.ino:241), so it never renders a chart of mostly-zeros that
   misrepresents "not kept" as "no usage".

3. **Occupancy is real, from the mmWave sensor.** Today's buckets are set when
   `motionDetected` is true (.ino:2330); each occupied hour contributes 60 minutes
   (.ino:1228,1280,1192). `totals.hours = occupiedMinutes / 60` (.ino:1233).

4. **Energy storage is NVS-backed.** `portEnergyKWh[]` and `dailyHistory[]` persist across reboot
   (`persistEnergyCounters`, `persistHistory`), and `rolloverDayIfNeeded()` (.ino:1111) folds the
   day's hourly buckets into a daily record at the 00:00 boundary. A reboot therefore does **not**
   zero the day's total.

5. **Publish cadence.** History republishes every `HISTORY_PUBLISH_MS = 5 min` (.ino:177, 2371) and
   energy persists on the same cadence. This is why a freshly powered device shows an empty
   Analytics page for up to ~5 minutes — expected, not a fault.

6. **Honest empty states.** `Analytics.jsx:88-118` distinguishes "no device paired (demo)" from
   "paired but no recorded data yet", with custom-range-specific wording. `usage` (per-port split)
   is deliberately left empty for composed ranges rather than invented (`useHistoryData.js:219-221`).

7. **Date parsing is sound.** `parseCustomRange` (`useHistoryData.js:142`) parses `YYYY-MM-DD` as
   **local** time (`${iso}T00:00:00`), never bare `new Date('2026-10-05')` (UTC midnight → previous
   day west of UTC). `composeCustomRange` and `Analytics.jsx:26` use the same convention
   consistently.

**Conclusion:** Analytics stores and displays accurate, real per-day energy and occupancy, with
client-composed custom ranges and no invented data. Correct.

---

## 3. Alerts — end to end

### 3.1 What works

- **Two firmware events fire an alert:** overcurrent trip (.ino:980-983) and the occupancy
  response-window warning (.ino:2240-2243). `sendAlert()` (.ino:1429) spawns an 8 KB FreeRTOS task
  so it never blocks the loop.
- **The serverless handler is complete and correct.** `api/alert.js` validates method/secret/MAC
  (:179-196), resolves recipients (`owners` → `owner` → `users/*/owned_devices`, :68-96), reads
  `pushTokens/<uid>` (:233), calls `sendEachForMulticast` (:249), and prunes dead tokens
  (:285-293). It reports explicit outcomes (`skipped:no-owners`, `skipped:no-tokens`,
  `outcome:'failed'`) rather than failing silently.
- **Alerts are recorded and bounded.** `devices/<MAC>/alerts/<pushId>` with
  `MAX_ALERT_HISTORY = 200`, pruned on every write (:49, :116-126).
- **The in-app list is accurate.** `useAlerts` (`src/hooks/useAlerts.js`) reads `at` and maps it —
  **the field names match the writer exactly** (no `time`/`timestamp` mismatch). Unread state via
  `alert_reads/<uid>/last_seen_at` is symmetric.
- **`AlertCatchUp`** (`src/components/AlertCatchUp.jsx`) shows a summary notification on next app
  open, guarded by localStorage dedupe + a 60 s cooldown + a `Notification.permission==='granted'`
  check.
- **The FCM token IS stored.** `storePushToken` (`src/lib/pushNotifications.js:61`) writes
  `pushTokens/<uid>` on login (`App.jsx:34-38`) and from the Settings toggle (`Settings.jsx:270`).

### 3.2 Original P0 defect — background push was not displayed (resolved locally; not deployed)

**Before the fix, `src/lib/pushNotifications.js` reused the PWA's workbox worker for FCM:**

```js
const registration = await navigator.serviceWorker.getRegistration();
const token = await getToken(messaging, { vapidKey, ...(registration ? { serviceWorkerRegistration: registration } : {}) });
```

**The old built workbox worker did not load the FCM handler.** Verified against the pre-fix build:

```
$ grep -o "importScripts([^)]*)" dist/sw.js
importScripts(i)                       # <- the workbox AMD loader, argument is a variable

$ grep -o "importScripts([\"'][^\"']*firebase-messaging[^\"']*[\"'])" dist/sw.js
NOT FOUND -> messaging SW is never loaded by the workbox worker

$ grep -o "url:\"firebase-messaging-sw.js\"" dist/sw.js
(none)                                 # firebase-messaging-sw.js appears only as a precache URL
```

The old `dist/sw.js` mentioned `firebase-messaging-sw.js` **only as a precache manifest entry** —
a URL to cache, not a script to import. The file with `onBackgroundMessage`
(`public/firebase-messaging-sw.js:27`) was never executed inside the controlling worker. In that
build, the in-app list worked, but a push with the app closed could not use that FCM handler.

The production artifact is only updated after redeploy; see §3.4.

### 3.3 Secondary alert gaps

- **No retry on the device.** One ~8 s POST, no backoff (.ino:1399-1413). A Vercel cold start or a
  transient TLS failure loses the alert permanently.
- **In-flight alerts are dropped, not queued.** The `alertInFlight` guard (.ino:1435) discards a
  second alert arriving mid-send.
- **Device-offline is never alerted.** No `onDisconnect`/heartbeat anywhere; the user is never told
  the device went dark.
- **Motion itself never alerts** — only the shutdown warning and overcurrent do.
- **The occupancy alert text contradicts the firmware (verified bug).** The device sends
  *"Devices will shut down in 60 seconds"* (`.ino:2240-2243`), but `RESPONSE_WINDOW_MS` is
  **300000 ms = 5 minutes** (`.ino:176`). The message understates the real grace period by 5×. It is
  a copy defect, not a control defect — the shutdown genuinely happens after 5 minutes. The
  in-app countdown reads `countdown_remaining_seconds` from the device (`.ino:2345`), so it shows the
  **correct** 5-minute value while the notification says 60 seconds. One-line fix in the alert body.
- **iOS:** Web Push only arrives to a Home-Screen PWA; `pushNotifications.js:26` returns null in a
  normal tab.

### 3.4 Resolution (2026-10-05 — deployed and verified)

| Layer | Change | Why |
|---|---|---|
| `vite.config.js` | `workbox.importScripts: ['/firebase-messaging-sw.js']` | The PWA's actual `/sw.js` now **executes** the background FCM handler. |
| `src/lib/pushNotifications.js` | Wait for `navigator.serviceWorker.ready` (10 s bound) and always pass its registration to `getToken()` | A first-time login must never mint a token for Firebase's second, wrong worker while Workbox is installing. |
| `api/alert.js` | Send `data` + webpush urgency, without `webpush.notification` | The SDK auto-displays a notification payload, then the custom `onBackgroundMessage` displays another. Data-only gives the handler sole ownership, avoiding duplicates. |
| `public/firebase-messaging-sw.js` | Return `showNotification(...)`'s promise | Keep the push event alive until the OS notification resolves. |
| `verify-fixes.mjs` | Four regression assertions | Check the shipped worker's **direct import**, exercise the handler with a stubbed payload, assert ready registration, and guard against duplicate display. |

**Build verification:** `npm run verify` passed: lint 0 errors, typecheck 0 errors, 50/50 unit tests,
build succeeds, **117/117 integration checks** (later extended to **123**; see §6). Four in-memory
mutations were detected (remove worker import, discard notification promise, restore duplicate
payload, replace `ready` with `getRegistration`). The rebuilt `dist/sw.js` contains
`importScripts("/firebase-messaging-sw.js")` as executable code, not merely a precache entry.

---

## 6. Follow-up audit — alert outcomes and UI feedback (2026-10-05)

A second pass over the API surface and the pages, after the push fix landed. Six new harness
assertions (117 → 123), each mutation-tested.

### 6.1 `outcome: 'pending'` was a latent false-success (fixed)

`api/alert.js` built the history entry with a placeholder `outcome: 'pending'`. The client's
`OUTCOME` map (`Alerts.jsx:19-42`) has **no key for it**, so such a row would fall through to the
grey **"Recorded"** badge — presenting a delivery that never happened as a completed one.

No path could produce it at the time: `no-owners`, `no-tokens` and the success path all overwrite
`outcome`, and the catch block writes nothing. That is exactly why it survived review — the state
was *unreachable*, not *impossible*. Fixed by removing the placeholder, so an unresolved outcome
cannot be constructed. Verified with a runtime probe that the stored row reads `"sent"`.

### 6.2 Alert retention never self-healed (fixed)

The retention prune read `limitToFirst(MAX + 1)`, which caps the delete batch at **one** entry.
Steady state was fine, but a node that was already oversized (predating retention, or after a
burst) shed a single row per alert and stayed bloated almost indefinitely — a 1000-row node stays
~1000 forever. Now the cheap probe still detects overflow in one 201-row read, but on overflow the
node is re-read in full and every excess row is cleared in one pass.

> Probe note: an early version of the reproduction used mixed-width fake keys. RTDB `push()` ids are
> fixed-width, and the inconsistent widths made a brand-new key sort *before* old ones, producing a
> false "the new entry was deleted" result. Key width must be uniform for the ordering to mean
> anything.

### 6.3 Write failures were invisible to the user (fixed)

Every action in `useRoomData` caught its error and logged it, returning nothing — so a rejected
write looked identical to a slow one. Worst case was **"Keep Power On"** on the shutdown countdown:
the write could fail and the room would power down anyway, with the button looking like it worked.

Actions now return whether they succeeded, and the Dashboard surfaces failures in a dismissible
banner. Port toggles gained a pending spinner. Also fixed: the countdown fell back to `?? 60`
(seconds) before the device reported a value, understating the real 5-minute window.

### 6.4 New assertions (all mutation-tested)

| Assertion | Caught by mutation |
|---|---|
| Entry is built without an `outcome` placeholder | re-adding `outcome: 'pending'` |
| Every recorded alert carries a resolved outcome | a `recordAlert` call missing an outcome |
| Client can render every server outcome | renaming a key in the client `OUTCOME` map |
| Failed writes report failure to the caller | a catch that logs but does not return false |
| Dashboard surfaces a failed write | removing the banner / ignoring the toggle result |
| Retention converges an oversized node | dropping the full sweep |

**Assertion pitfall worth recording:** counting `catch` blocks with `\{([\s\S]*?)\}` silently
truncates at the `}` of a `${...}` interpolation inside a template literal — three correct catches
read as failures. Slice by balanced braces. (Sources are also CRLF, which breaks multi-line
mutation patterns written with bare `\n`.)

**Deployment (done 2026-10-05):**
- Vercel production → aliased `https://voltsense-iot.vercel.app` (serves the front **and** `/api/*`).
- Firebase Hosting → `https://voltsense-iot.web.app` (`--only hosting`; database rules untouched).
- Live verification: both `/sw.js` endpoints return a worker containing
  `importScripts("/firebase-messaging-sw.js")`; the handler is served `200` from both origins;
  `/api/alert` answers `405` to GET and `401` to a wrong secret, confirming the function loads.

#### The Settings "Test" button does NOT test this path

`Settings.jsx:114-146` calls `registration.showNotification(...)` **directly from the open page**. Its
own comment says it is "a rendering check, not a delivery check". It never touches FCM, `/api/alert`,
or a background worker — so it also succeeds on the **broken** build. A green Test button proves
permission + OS display only; it is **not** evidence that the §3.2 defect is fixed. (It also uses
`icon: '/logo.svg'` while the real handler uses `/pwa-192x192.png`, so its appearance differs from a
genuine alert.)

The only real test is a **device-originated alert with the app closed** — the full procedure, with a
failure-diagnosis table, is in **`docs/PUSH-TEST.md`**.

**Remaining release check — real-device delivery (cannot be verified by a build):**
1. On the phone, open `https://voltsense-iot.web.app`, let the PWA update, sign in and enable push
   again in Settings; inspect `navigator.serviceWorker.ready` and confirm `active.scriptURL` ends in
   `/sw.js`. If a cached worker will not activate, close/reopen the PWA and revisit Settings.
2. On an **owned and paired device**, trigger one real alert while the app is backgrounded or
   closed. Expect **one** OS notification and one matching entry in Alerts, not two. Compare the
   server's recorded `outcome` and the presence of `pushTokens/<uid>`. On iOS, install the PWA to
   the Home Screen first; ordinary Safari tabs do not support this Web Push path.
3. If it still fails: confirm the worker imported the handler (`/sw.js`), the handler's CDN SDK
   scripts loaded, notification permission is granted, the token exists, and Vercel is using the
   intended Firebase project. FCM `successCount` means accepted for delivery, not proof that the
   OS presented a notification.

---

## 4. Settings — write/read symmetry

Per-control trace (web writer → firmware reader):

| Setting | Web write | Firmware read | Honoured? | Read-back |
|---|---|---|---|---|
| Night mode enabled | `settings/night_mode_enabled` (`useRoomData.js:74`) | .ino:1510,1550 | Yes | Yes |
| Night mode start/end | `settings/night_mode_start/end` (:75-76) | .ino:1512,1553 → `timeToMinutes` | Yes | Yes |
| Port relay | `ports/pN/relay_status` (:43) | .ino:1500-1508 | Yes | Yes (DB repair at :1835) |
| Master relay | multi-path `update` (:50-61) | same handlers | Yes | Yes |
| Override ("keep on") | `devices/<mac>/override` (:90) | .ino:1487-1499 | Yes (self-clears) | n/a (ephemeral) |
| **Inactivity limit** | **none** | .ino:1515,1558 | Yes (default 15 min) | Yes (.ino:2336) |
| **Overcurrent limit** | **none** | .ino:1529,1568 | Yes (default 4.5 A) | Yes (.ino:2339) |
| **Nominal voltage** | **none** | .ino:1518,1563 | Yes (default 230 V) | pushed as `voltage` |
| Port name | `ports/pN/name` (:106) | **never read** | No (cosmetic) | UI reads DB directly |
| Port icon | `ports/pN/icon` (:122) | **never read** | No (cosmetic) | UI reads DB directly |

### Findings

1. **Night mode is fully symmetric** — the only setting that is written by the UI, read by the
   firmware, and read back for display. The wrap-over-midnight comparison is correct
   (`isNightModeActive`, .ino:1598-1605, handles 22:00 → 06:00), and it drives the relay ON
   (.ino:2207-2209).

2. **`inactivity_limit_minutes` and `overcurrent_limit_a` are firmware-honoured but have no UI
   control.** The firmware reads both and even pushes them back so the Dashboard can display them
   (`Dashboard.jsx:89` shows the inactivity limit read-only), but **no `src/` file writes either
   key**. The device's auto-off timeout and trip point are therefore frozen at their compiled
   defaults (15 min, 4.5 A) unless someone edits RTDB by hand. **This is the most consequential
   settings defect:** a "smart shutdown" product whose trip point cannot be set.
   - **Practical consequence for testing:** `docs/PUSH-TEST.md` suggests temporarily lowering
     `settings/inactivity_limit_minutes` or `settings/overcurrent_limit_a` to provoke an alert
     quickly — because there is no UI, **revert those values by hand** or they persist silently.

3. **`nominal_voltage` has no UI at all,** so power is always computed against the 230 V constant —
   the "configurable fallback" is unreachable.

4. **Port name/icon are cosmetic dead writes.** `updatePortName`/`updatePortIcon` write
   `ports/pN/name|icon`, but the firmware's `streamCallback` has no branch for them. Harmless
   (they only affect the app's own display, which reads them directly), but the user may believe
   they configured the hardware.

5. **No sibling-wipe regression.** `updateNightMode` uses `update()` with an explicit 3-key object
   (`useRoomData.js:73-77`), and the comment documents the old `set()` hazard. I found no remaining
   `set()` on a parent settings node in `src/`. `setOverride` (leaf) and `togglePortRelay` (leaf
   `relay_status`) are correctly leaf-scoped.

6. **Pre-pairing writes are gated in the UI.** `useRoomData` subscribes and writes only when
   `roomId` is truthy (`:12,68`), so a user with no device cannot fire a settings write. If one ever
   did, the active rules (`database.rules.json`, `settings` requires ownership) would reject it and
   the app would swallow it into `console.error` with no user feedback.

7. **Rules validation gap.** The active rules validate `night_mode_*` and `inactivity_limit_minutes`
   but have **no `.validate` for `overcurrent_limit_a` or `nominal_voltage`**, even though the
   firmware gates them to 0.5–5.0 A / 50–300 V. A hand-written out-of-range value would be accepted
   by the DB and then clamped/ignored by firmware.

**Conclusion:** night mode and relay control connect to hardware correctly. The timeout, trip point,
and voltage fallback are honoured by the firmware but unreachable from the UI. Names/icons are
cosmetic.

---

## 5. Bring-up runbook — hardware + software as one system

Follow in order. Steps 1–4 are one-time; 5–9 verify integration.

### Prerequisites
- ESP32 flashed once so its MAC is known (WiFiManager has no Wi-Fi constants; creds live in NVS).
- Firebase CLI authenticated; project `voltsense-iot`.
- The active rules file is `database.rules.json` (a copy of `deviceuid` — see `npm run rules:status`).

### Step 1 — Flash the firmware and read the MAC
1. Open `esp32/VoltSense/VoltSense.ino` in Arduino IDE, select the ESP32 board, upload.
2. Open Serial Monitor @ 115200. The device prints its MAC (`WiFi.macAddress()`).
3. **Write the MAC down** — every later step keys off it.

### Step 2 — Create the device identity in Firebase
1. Firebase Console → Authentication → add a **user** for the device (email + password). Use these
   as `dev_email` / `dev_password` in NVS (Step 3).
2. Realtime Database → create `device_uids/<MAC> = <that user's uid>`.
   **This node has no `.write` rule, so it is Console-only** — a device cannot create it. Until it
   exists, the device cannot write any telemetry under `deviceuid` rules.

### Step 3 — Provision the device (captive portal)
1. On first boot the device raises AP **`VoltSense_Setup`**.
2. Join it; the captive portal opens. Enter:
   - Wi-Fi SSID + password
   - `dev_email` / `dev_password` (Step 2)
   - The pairing key (must match `VOLTSENSE_PAIRING_KEY` in Vercel — see Step 6)
3. Save → the device reboots, connects, and begins writing `devices/<MAC>/...`.

### Step 4 — Pair the device to your account (app side)
1. Sign in to the web app (`https://voltsense-iot.web.app`).
2. Settings → **Add device** → enter the MAC.
3. This calls `/api/pair` + `/api/claim`, writing `owners` / `owned_devices` so your account can read
   the device and the device appears in the device switcher.

### Step 5 — Confirm the live data path
1. Dashboard should show three ports. Flip a port ON.
2. Within ~2 s the toggle snaps to the **actual** relay state (DB repair if the derating rules
   suppressed the switch), and `current_amps` / `power_watts` update.
3. Plug a known resistive load (e.g. 100 W bulb ≈ 0.43 A @ 230 V) into an ON port and compare
   `current_amps` against a clamp meter. If it is off by ~a constant factor, check
   `ACS712_MV_PER_AMP` (.ino:744) matches your ACS712 variant (185 = 5 A, 100 = 20 A, 66 = 30 A).
   **This is the single most important accuracy check.**

### Step 6 — Deploy the alert backend
1. `cd` the Vercel project; set env vars:
   - `VOLTSENSE_ALERT_SECRET` (must equal the device's `alert_secret` / pairing key)
   - Firebase service-account credentials for FCM (Admin SDK)
2. Deploy. The `/api/alert` endpoint is what the device POSTs to
   (`ALERT_URL`, .ino:304).

### Step 7 — Enable push on the phone (and accept the caveat)
1. Settings → **Push Notifications** → allow. This mints an FCM token and stores it at
   `pushTokens/<uid>`.
2. **Deployed:** both Vercel and Firebase Hosting now serve a worker that imports the handler, and
   the endpoints respond correctly (§3.4). What is left is the phone test with the app closed —
   the build checks cannot prove OS delivery.

### Step 8 — Exercise the hardware trigger
1. **Occupancy shutdown:** keep the room still until the inactivity timer expires (default 15 min,
   or lower `settings/inactivity_limit_minutes` by hand). Watch for the response-window alert, then
   the 60 s countdown, then the shutdown.
2. **Overcurrent:** drive a port above the trip point (default 4.5 A). Confirm the relay opens and
   `sendAlert` fires.
3. In both cases confirm the in-app Alerts list gains an entry.

### Step 9 — Confirm history storage
1. Leave the device running ≥ 5 minutes (history publishes every 5 min, .ino:177).
2. Analytics → **Today** should show real hourly energy + occupancy.
3. Pick a custom range that includes today; it should compose from `history/days` and show a flat
   zero for days the device was not running (expected, not missing data).

### Post-bring-up backlog (not blockers)
- **Real-device push test** — the §3.4 fix is deployed to both targets and the worker is verified; only an actual phone test with the app closed remains.
- **Add UI controls** for `inactivity_limit_minutes`, `overcurrent_limit_a`, `nominal_voltage`
  (§4.2–4.3) so the safety thresholds are user-settable.
- Add a `.validate` for the two unvalidated settings keys (§4.7).
- Consider an `onDisconnect`/heartbeat so a dead device is surfaced (§3.3).
- `git init` + remote to activate the CI workflow.
