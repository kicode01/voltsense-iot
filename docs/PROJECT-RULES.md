# VoltSense — hard rules (full reference)

> **This is the expanded home of `.workbuddy-ai/memory/MEMORY.md`.** That file is now a short pointer
> index (it is injected into every session, so it must stay small); the full rule text lives here.
> When a rule changes, edit **this** file, then update the matching one-liner in the index if the
> summary moved. Derivation of each rule lives in `.workbuddy-ai/memory/YYYY-MM-DD.md`.
>
> Why this split: MEMORY.md is auto-injected at session start and had grown to ~18 KB, past the
> session injection budget, so its tail was being silently truncated. Index + reference keeps the
> injected part small without losing any rule.

Every rule below was learned the hard way.

## Firmware BUILD — read before touching the .ino (2026-10-08)

**The firmware had never been compiled.** Three separate errors were shipped, each masking the next.
Compile before reasoning about behaviour:

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=huge_app" esp32/VoltSense
```

- **The partition scheme is not optional.** The sketch needs ~1.48 MB; the ESP32 default gives
  1.2 MB, so a stock build dies with *"text section exceeds available space in board"*. Use
  **Huge APP (3MB No OTA/1MB SPIFFS)**. No OTA code, and state lives in NVS rather than SPIFFS, so
  the OTA slot is free to spend.
- **Types named in a FUNCTION SIGNATURE live in `VoltSenseTypes.h`**, not in the .ino. The Arduino
  build inserts generated prototypes near the top of the sketch — *above* anything the .ino defines
  below them — so `ProbeResult probeEndpoint(...)` fails with *"does not name a type"*. The
  insertion point moves as functions are added, so "define it high enough in the .ino" silently
  rots. (The original workaround — defining `enum RelaySwitchResult` twice — trades that error for
  "multiple definition" and compiles neither way.)
- **Sign-in credentials live on `auth`, not `config.signer`.** `auth.user.email` /
  `auth.user.password`; a pre-existing token goes through `Firebase.setCustomToken(&config, token)`
  before `begin()`. `firebase_token_signer_resources_t` has no `email`/`password`/`tokens.id_token`
  members at all.
- **Do not repeat a default argument** on both the declaration and the definition.
- **Adjacent string literals concatenate only with macros.** `"a" NVS_NAMESPACE "b"` is a syntax
  error when the name is a `const char*` — use `printf("%s")`.
- Required libraries: **Firebase Arduino Client Library for ESP8266 and ESP32** (mobizt), WiFiManager,
  NTPClient. Not `FirebaseArduino` or `FireBase32`.

## Hardware BOM — the authoritative build (user-supplied)
- **ESP32** dev board. **HC-SR501 PIR** = the ONLY occupancy sensor → `PIR_PIN` (GPIO 22).
- **3-ch relay** → `RELAY_PINS` {23,21,19}, HIGH = energised. **5 V regulated supply**, enclosure, phone.
- **3× ACS712** → `CURRENT_SENSOR_PINS` {34,35,32}. **ADC1 only** — ADC2 dies while Wi-Fi is up (reads
  a permanent 0 A). Default part is the **5 A -05B, 185 mV/A**; the 20 A (100) / 30 A (66) parts silently
  rescale every reading if substituted. **ACS712 is a Hall CURRENT sensor — it cannot measure voltage.**
- **Voltage sensing is OPTIONAL and gated off** (`HAS_VOLTAGE_SENSE`, `VOLTAGE_SENSE_PIN` = GPIO 33,
  ADC1). **Two modes, and the device reports which** via `voltage_source`:
  - *Off (default)* — voltage is `settings/nominal_voltage` or the 230 V fallback, never a measurement,
    so power is **apparent VA, not W**. Never claim voltage sensing; never present kWh as billing-grade.
  - *On* — real power is `mean(v(t)·i(t))`, i.e. **W**, with a measured `power_factor`. **`V_rms × I_rms`
    is still VA** — the sample-by-sample product is the only thing that captures phase. DC bias must be
    removed *before* multiplying (peak-to-peak never needed this; the product does).
  - The UI unit is switched on `voltage_source` (harness-asserted). **VA can be 30–50 % above W** for
    SMPS loads, so showing "W" without a sensor overstates every reading invisibly.
  - Gate ships **closed**: an unwired ADC pin floats, and here the noise would be *multiplied* into
    every current reading — confident fictional wattages. Full procedure: `docs/VOLTAGE-SENSING.md`.
  - Calibration (`settings/voltage_cal_mv_per_v`, 1–20 mV/V, NVS-backed) **divides** into every voltage
    reading — unbounded, a typo scales the whole system silently.

**mmWave radar is SUPPORTED, not present.** The thesis (`GROUP-7_MANUSCRIPT.txt`) specifies a dual
PIR+mmWave module; the written BOM lists only the PIR. `MMWAVE_PIN` is
declared **unconditionally** (GPIO 4) so it is collision-checked + app-provisionable, but the **read is
compile-gated** behind `HAS_MMWAVE`, which **ships commented out** (user decision 2026-10-05:
"supported, enable later"). Must not default on: an unwired pin floats (noise, often HIGH) and since
occupancy is an OR, one noisy pin pins the room "occupied" forever — smart shutdown never fires. PIR
alone is fail-safe (can under-detect, never fake occupancy).

## Stack & deploy — TWO targets, different jobs
React 19 + Vite 8 + Tailwind 3.4 (CJS `tailwind.config.cjs`) + React Router 7, Firebase (auth + RTDB),
`vite-plugin-pwa`.
- **Firebase Hosting** (`firebase deploy --only hosting`) = static React app, `voltsense-iot.web.app`.
  Canonical front.
- **Vercel** (`vercel --prod`) = the same static app **plus the four `/api/*` serverless functions**,
  `voltsense-iot.vercel.app`. The firmware's `ALERT_URL`/`PAIR_URL` point HERE → load-bearing: if it 404s,
  notifications, pairing and app-side claim/unpair all die together. It **did** 404 until 2026-10-05.
- `firebase.json` also wires Database — use `--only database`/`--only hosting` deliberately.
- 5 server env vars live in Vercel (`docs/DEPLOY-VERCEL.md`), **never `VITE_`-prefixed**. `VITE_*` stay
  in local `.env` (the local machine builds). After changing a Vercel env var you must **redeploy**.

### `api/` — two traps that made every endpoint 500 (fixed 2026-10-05)
1. **`api/` MUST be CommonJS.** Root `package.json` is `"type":"module"` → `.js` is ESM, where
   `module.exports = {...}` is a **silent no-op** (imports fine, exports nothing). `api/package.json`
   (`{"type":"commonjs"}`) scopes CJS to `api/`. **Do not delete it.**
2. **`firebase-admin` is v14.5.0 — the whole namespaced API is gone** (`admin.apps`, `admin.app()`,
   `admin.credential.cert()`, `admin.database()`, `admin.auth()`, `admin.messaging()`). Use
   `getApps()/getApp()`, top-level `cert()`, subpaths `firebase-admin/database|auth|messaging`. A compat
   shim atop `api/_lib/firebaseAdmin.js` restores the old surface for the 9 existing call sites — **new
   code should use the modular API directly.** `admin.apps` is a **Proxy** (an array's `length` is
   non-configurable, so `defineProperty` throws).

**oxlint scans `scripts/`** — new Node scripts must be lint-clean.
**Deliberately NOT a git repo** — deletions are irreversible; dead files move to `.workbuddy-ai/removed/`.
`.gitignore` is kept future-correct (excludes `logo-design-skill/` [own nested `.git` → broken gitlink],
`GROUP-7_MANUSCRIPT.txt`, `.workbuddy-ai/`).
**Sandbox bulk-delete guard.** Vite empties `dist/` each build; with 50+ files present this trips
`SAFE_DELETE_BULK_CONFIRM_REQUIRED`. **Clear it separately first**: `rm -rf dist`, then build next turn.

## Alert / pairing contract — fixed 2026-10-05, do not re-break
`AUDIT-2.md` found 3 P0 + 6 P1; all fixed. Each P0 was a **contract between two files**, invisible to
per-file grep:
- **Alert secret**: `api/pair.js` gives the device `VOLTSENSE_ALERT_SECRET` when set else a random value,
  and ALWAYS persists `sha256(value)` at `devices/<MAC>/alert_secret_hash`. `api/alert.js` accepts EITHER
  the shared secret (constant-time) OR the per-device hash. **Never store plaintext.** Auth BEFORE payload
  validation (secret-less → 401, not 400).
- **Three ownership edges move together**: authoritative `devices/<MAC>/owner` (string), reverse index
  `users/<uid>/owned_devices/<MAC>`, fan-out `devices/<MAC>/owners/<uid>=true`. `/api/claim` writes all
  three; `/api/unpair` clears all three — clearing one leaves the device unclaimable forever. **Never
  write ownership from the browser.** Unpair clears `claimed_by`/`claimed_at` but **preserves
  `alert_secret_hash`** (no owner ≠ factory reset).
- **Sensing window ≥ 100 ms** (whole mains periods at 50 and 60 Hz). 20 ms = one period, `millis()`
  granularity makes it 17–20 ms → phase-dependent, systematically low. Use `analogReadMilliVolts()` +
  explicit `analogSetPinAttenuation(ADC_11db)`.
- **Two current thresholds, deliberately different**: `CURRENT_NOISE_FLOOR_A` (display) vs
  `CURRENT_ACTIVE_THRESHOLD_A` (shutdown + debounce). Never merge.
- **ADC reads cached once per loop** (`refreshCurrentCache()`), shared by telemetry + shutdown. Idle
  streak is **per-port** (`currentIdleStreak[]`) — a shared counter let one idle port accumulate the
  streak for an active one.
- **Relay state persisted** (`NVS_KEY_RELAY_STATE` bitmask) so a reboot cannot re-energise an empty room;
  write NVS *before* the cloud update.

## Alerting — device → Vercel → FCM. Telegram is gone.
- Device POSTs `{secret, mac, title, body, tag}` to `/api/alert`; holds no messaging credential, only
  `alert_secret` in NVS.
- Recipients: `devices/<MAC>/owners/*` + `owner` (**union**, O(1)); the `users/*/owned_devices` scan is a
  fallback only. Missing a recipient beats one extra notification.
- FCM tokens at `pushTokens/<uid>`, **client-written** by `enablePushForUser(uid)` on login.
  **FCM shares the PWA's ONE worker:** `vite.config.js` must set
  `workbox.importScripts: ['/firebase-messaging-sw.js']`, and the client must await
  `navigator.serviceWorker.ready` and pass that exact registration to `getToken()`. A precache
  entry is *not* an executed handler; an omitted registration mints a token for Firebase's
  separate worker on first load. Assert the direct import in the built `dist/sw.js`.
  Send **data-only** from `api/alert.js`: Firebase automatically displays
  `webpush.notification`, so mixing that with `onBackgroundMessage` produces two notices.
  Return the `showNotification()` promise from the handler. After changes, deploy **both**
  Vercel (`vercel --prod`) and Firebase Hosting (`firebase deploy --only hosting`), then confirm the
  LIVE `/sw.js` contains the direct `importScripts` (a build check on `dist/` is not the deployed
  artifact) before testing on a physical device.
- **History**: `recordAlert()` appends `devices/<MAC>/alerts/<pushId>`, newest 200, prunes on write. Each
  entry carries an **honest `outcome`** (`sent`/`partial`/`failed`/`skipped`+`reason`). **Never hardcode
  `'sent'`.**
- **Read state**: `devices/<MAC>/alert_reads/<uid>={last_seen_at}` in the DB, not localStorage (PWA
  storage is evicted → re-announces). **`lastSeenId` is THREE-state**: `undefined`=loading, `null`=absent,
  number=watermark — every consumer handles all three. **`AlertCatchUp`** takes data as **props from
  `Layout.jsx`**; never give it its own `useAlerts()`.
- **`sendAlert()` must stay async** (one-shot task, core 1, 8 KB stack) — a blocking HTTPS call would
  overrun the 60 s occupancy window.
- **iOS web push only works in an installed (Home Screen) PWA.** Apple restriction, not a bug.
- **Firmware hardcodes the Vercel domain** in `ALERT_URL` + `PAIR_URL` — edit both if it changes.
- Server secrets: `FIREBASE_SERVICE_ACCOUNT`, `VOLTSENSE_ALERT_SECRET`, `VOLTSENSE_PAIRING_KEY`,
  `VOLTSENSE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`.

## Firmware runtime safety
- **Task watchdog (`esp_task_wdt`)**: `WDT_TIMEOUT_SECONDS 30` (above the worst legit path: NTP ~1 s, ADC
  ~300 ms, telemetry ~5 s, TLS retry ~10–15 s). `esp_task_wdt_init` returns `ESP_ERR_INVALID_STATE` if the
  Arduino core already initialised the TWDT and **silently does NOT change the timeout** — call
  `esp_task_wdt_reconfigure()` instead. `esp_task_wdt_add(NULL)` subscribes `loopTask`. The alert task
  deliberately does NOT subscribe. **Feeds must PRECEDE blocking calls** (a feed after a call that never
  returns does nothing). Long waits use `waitWithWatchdog()` (1 s slices); the Wi-Fi-failure `for(;;)`
  must keep feeding or arming the WDT resets the device every 30 s, defeating that branch.
- **Soft overcurrent cutoff — a second line of defence, NOT a fuse.** `OVERCURRENT_LIMIT_A 4.50f` (below
  the ACS712 5 A ceiling, above the 3-port load), debounced `OVERCURRENT_TRIP_SAMPLES 5` so motor inrush
  cannot false-trip. Uses **its own per-port streak** (`overcurrentStreak[]`) — the idle streak counts
  consecutive LOW, overcurrent counts consecutive HIGH; sharing one counter makes them cancel out. On
  trip: `digitalWrite(LOW)`, NVS-persist off, one-shot edge-triggered alert (`overcurrentTripped` latch).
  Limit is app-settable (`/settings/overcurrent_limit_a`) and range-checked (`overcurrentLimitIsSane`,
  0.5–5.0 A) at **4 sites**: stream callback, snapshot handler, boot NVS restore, trip test. **Why it can
  never be a fuse**: ACS712-05B saturates at 5 A (a 30 A short reads ~5 A), and a welded relay contact
  cannot be opened by `digitalWrite(LOW)`. Only a fuse breaks the path — keep one in the build.
- **Relay derating (dwell + switch-rate cap) — the relay is the only MECHANICAL part.** Rated for only
  ~10,000–100,000 operations; every app toggle = one RTDB write = one stream event = one actuation, at
  network speed. Spamming the toggle is a hardware-destruction vector, and cutting/re-closing a live
  load **arcs the contacts**, which kills a relay far faster than the raw count. Guard:
  `RELAY_MIN_DWELL_MS 2000` (per port) + `RELAY_MAX_SWITCHES 6` per `RELAY_RATE_WINDOW_MS 60000`
  rolling window — **per port**, so toggling port 1 never blocks port 2. Enforced on the device because
  the device owns the relay (the app is not the security boundary — a console/script write bypasses it).
  - **ONE choke point**: `runRelaySwitch(port, on, force)` is the only function that calls
    `digitalWrite(RELAY_PINS[...])`. Exactly one raw relay write may exist in the file — a harness check
    counts them. A no-op (`current == on`) returns `RELAY_NOOP` without spending an operation.
  - **`force=true` is load-bearing for SAFETY.** The overcurrent trip, the occupancy shutdown, the
    override path and boot restore all pass it. A dwell lock that refused to cut a fault because the
    port "just switched" would be worse than no protection. Nothing that protects the user is
    rate-limited.
  - **A rejected command MUST be repaired, not dropped.** The app writes the intended state
    optimistically, so a suppressed switch leaves the DB claiming "on" while the relay is off.
    `runRelaySwitchAndSync()` (used by the three stream handlers) writes the ACTUAL state back so the
    toggle snaps to reality. The repair cannot loop: the echo re-enters as a no-op.
  - Constants and rule text live in the "Relay derating" section of `VoltSense.ino`.
- Firmware pins **ISRG Root X1** (Vercel → Let's Encrypt). MAC only known after a first flash. No Wi-Fi
  constants — WiFiManager captive portal `VoltSense_Setup`. `simulator.js` hits the **live** DB; needs
  `SIMULATOR_CONFIRM=yes`.

## Custom ranges — client-composed
Firmware publishes raw daily records `history/days/<YYYY-MM-DD>={e,m,p}`; the client composes arbitrary
ranges (`parseCustomRange`/`composeCustomRange` in `useHistoryData.js`) because the firmware cannot
enumerate them. The firmware never writes a `custom_*` key. `toHistoryKey` keeps the shorthand map.

## Mobile / PWA
- `viewport-fit=cover` + `black-translucent`; new top-level containers **must** add
  `pt-[var(--safe-top)]` / `pb-[var(--safe-bottom)]`. Safe-area tokens in `src/index.css`; use
  `var(--safe-*)` inside `calc()` (underscores for spaces).
- `.min-h-app`/`.h-app`, never `min-h-screen` (`100dvh` under-reports on iOS standalone; shell is
  `.app-shell` = `position:fixed; inset:0`). Colour scheme locked light.
- **Never `backdrop-blur` a bar whose text must stay crisp** (iOS grayscale-AA rasterises it). Header is
  opaque `bg-[#F0F2F5]`, a `shrink-0` sibling of the scroll container; bottom nav may keep frosted glass.
  Nav: `bottom-[calc(0.5rem_+_var(--safe-bottom))]`, 1rem sides, bottom gap < side margins.
- `navItems` in `Layout.jsx` feeds BOTH navs. **Badges anchor to the ICON, not the label.**

## Browser API safety
- **Never touch a browser API without a `typeof` guard** in render *or* effect — a throw in `useEffect`
  tears down the tree like a render error → blank white page. `Notification` is undefined on iOS Safari in
  a tab, iOS < 16.4, Android WebViews, non-secure origins. Keep the `ErrorBoundary` in `App.jsx` outermost.
- Use **`getMessagingInstance()`** from `lib/firebase.js`. **`try { getMessaging(app) } catch {}` does NOT
  work** — the SDK throws *inside* an async check and returns normally, so the throw is uncatchable. It
  calls the exported `isSupported()`.

## RTDB — read before touching writes
- **`set()` replaces a node; `update()` merges.** `set` on `devices/X/settings` deletes every sibling.
- **Multi-path `update(ref(db),{'a/b':1})` is atomic** — one denied path rejects all. Never
  `.forEach(async … await write())`; it returns early and swallows failures.
- **`/` in a key silently creates a nested path.** Valid keys exclude `. # $ [ ] /`.
- **Numeric strings happen** — coerce `Number(x)` and use `??` (`x.toFixed()` on `"301.5"` throws).
- **Parse `YYYY-MM-DD` as LOCAL**: `` new Date(`${v}T00:00:00`) ``. Never mix forms.
- **Rules are additive**; no "deny" cancels a shallower grant. **Rules files must be pure JSON** (no `//`).

## Security
- **FOUR rules files, one active — verify, don't trust docs.** `scoped`/`deviceuid`/`strict`, plus
  `database.rules.json` (what deploys; a *copy* of one of the three). Switch via
  `npm run rules:status|scoped|deviceuid|strict`; **never `cp`**. **As of the last audit the active file is
  `deviceuid`.** All four carry `pushTokens/$uid`, `devices/$mac/alerts` (validate only, no `.write` —
  Admin SDK bypasses rules), `devices/$mac/alert_reads/$uid`, `devices/$mac/owners`,
  `devices/$mac/alert_secret_hash` (read+write false), `pairingCodes` (both false). `rules:status` reports
  UNKNOWN because it compares bytes — identify semantically. **`device_uids/<MAC>` has no `.write` rule
  anywhere** (Admin-SDK-only → Console-managed); until an entry exists a deviceuid-ruled device cannot
  write any telemetry.
- Device identity: **A** `deviceuid` = email/password Auth + `device_uids` mapping; **B** `strict` =
  `device_mac` custom-token claim (`npm run mint-token -- <MAC>`, node:crypto RS256, `--selftest`);
  **C** claim-code pairing (below).
- **`firebase-admin` is for `api/*.js` only** — never import under `src/`.

## Pairing (Option C)
- The device is born holding only a MAC (eFuse) + a **factory `VOLTSENSE_PAIRING_KEY`** shared by every
  unit. That key buys exactly one thing: `POST /api/pair`. No data access.
- **The pairing code lives ONLY in `pairingCodes/<CODE>`.** Never mirror it under `devices/<MAC>` (the
  `scoped` variant exposes `devices/<MAC>` to any authenticated principal).
- **`/api/pair` must never write `owner`, `owned_devices`, or `pairing/claimed_*`.** Ownership changes only
  in `/api/claim`, inside a `.transaction()`. A factory reset cannot steal a device.
- **Never add a client-side "link by MAC" path** — a MAC is public, not proof of ownership.
- `/api/claim` takes the uid from the **verified ID token**, never the body; a malformed code returns the
  same shape as an unknown one (no enumeration). **Ownership written ONLY by `/api/claim`, cleared ONLY by
  `/api/unpair`**; both compute uid from the verified token; `claimed_by`/`claimed_at` move together.
  `POST /api/unpair` is idempotent, 403 for non-owner, preserves the alert-secret hash.
- Firmware: USB-provisioned identity (`dev_email`/`dev_password` in NVS) **takes priority over pairing**;
  empty `VOLTSENSE_PAIRING_KEY` skips pairing (fails safe). Factory reset = GPIO 0 held 5 s → erases
  identity keys, **keeps Wi-Fi**. Env: `VOLTSENSE_PAIRING_KEY`, `VOLTSENSE_AUTH_DOMAIN` (server-side).

## Icons & assets
- All app icons come from **`public/logo-square.svg`** via **`npm run icons`**. Never hand-edit the PNGs;
  never delete `logo-square.svg` (referenced only from a comment — a naive grep says "unused").
  **`public/favicon-16.png` looks unused but is not** — `buildIco()` consumes it in memory as the 16px
  layer of `favicon.ico`. `public/firebase-messaging-sw.js` also has zero filename references (FCM SW).
- Live icon set: `apple-touch-icon{,-167,-152,-120}.png`, `favicon-{16,32,48}.png`, `favicon.ico`,
  `favicon.svg`, `pwa-{64,192,512}.png`, `maskable-icon-512x512.png`, `logo.svg`, `logo-square.svg`.
- **A filename grep is not proof of disuse** — confirm against `dist/` after a build. Grep also gives false
  positives (`maskable-512.png` matches inside `maskable-icon-512x512.png`).
- **No SVG filters on artwork that renders small** (an `feDropShadow` becomes a smudge at 40px).

## Verification
- **`npm run verify`** = `lint && typecheck && test && build && test:integration`. Unit: `npm run test`
  (`node --test tests/*.test.mjs`, 50 tests — pure logic + `.env`/config drift).
- **`npm run typecheck`** = `tsc --noEmit`, driven by `tsconfig.json` with **`allowJs` + `checkJs`** — it
  validates the existing `.js`/`.jsx` sources **without** renaming any of them to `.ts`.
  - **This gate is deliberately NOT fully strict.** Full `strict` produced 205 errors here and ~190 were
    ONE root cause: `useState()`/`useRef()` with no type argument infers `null`/`never`, so every later
    read/write on that value is flagged. Those are typing gaps, not bugs. `noImplicitAny` and
    `strictNullChecks` are therefore OFF; **everything else stays ON**, and the residual set is high-signal
    — it found untyped `catch` values read as `Error`, a genuinely missing prop, and an `EventTarget` vs
    `currentTarget` mistake.
  - **`include` must list `src/**/*.d.ts`** — a `src/**/*.js` glob does NOT pull in ambient declaration
    files, so `src/types/browser.d.ts` (iOS `navigator.standalone`) would be silently absent.
  - **`allowJs` without `checkJs` is worse than no gate** — tsc reads the files, reports nothing, exits 0
    forever. Both flags are required, and a harness check asserts both.
  - `//`-prefixed keys are legal at the **top level** of tsconfig.json but rejected **inside
    `compilerOptions`** (TS5023 "Unknown compiler option") — put explanatory comments at the top level.
  - `tsc` auto-reads `tsconfig.json`, **not** `jsconfig.json`. Naming it `jsconfig.json` makes a bare
    `tsc --noEmit` print its help text and exit 1 (which reads as "no errors" if you only grep output).
- **Hosted CI** — `.github/workflows/verify.yml` runs the same gate on push/PR.
  **PREREQUISITE: this project is not a git repo and has no GitHub remote — the workflow does nothing
  until the code is pushed.** It is committed now so the gate exists from the first commit.
  The harness must stay runnable on Linux: it once hardcoded `AppData/Local/ms-playwright` and
  `chrome-win64/chrome.exe`, which makes the CI job fail instantly with ENOENT. Use
  `chromium.executablePath()` with multi-platform cache roots as fallbacks. `playwright` is a
  devDependency so CI's `npm ci` installs it (CI has no npx cache).
- **`node verify-fixes.mjs`** (`npm run test:integration`) — **139 checks** against `dist/`, run after
  `npm run build`. **Clear `dist/` first** (`rm -rf dist`, own turn — sandbox bulk-delete guard). **Beware
  a stale `dist/`** — the harness validating the OLD artifact returns a falsely green result.
- Harness rules learned the hard way:
  - **Strip comments before any negative assertion** (`stripComments()`) — files legitimately document the
    invariants they obey. **Scope a "this file says X" assertion to the region owning the claim** (a
    "not a fuse" grep also matched the header).
  - **Slice a function by its `{`, never by its name.** `indexOf('void foo()')` and
    `match(/Type foo\(/)` both match the **forward declaration** first, so the body is never searched and
    the check is vacuous. This has bitten three separate times (loop, checkOvercurrent, runRelaySwitch).
  - **A NAME match is not a CALL, and presence is not enforcement** — assert the call site
    (`/^\s*foo\(\);/m` in the sliced body). For "a guard at every entry point" prefer a **count**
    (`match().length`) over `.test()`. "Check the macros exist" once let a disabled rate cap pass; assert
    the actual decision (`return inWindow < RELAY_MAX_SWITCHES`).
  - **`api/*.js` is CJS while `package.json` is `"type":"module"`** — `import()` parses ESM and dies on
    `require`; load via `new Function('module','exports','require', src)` with `firebase-admin` stubbed.
  - **Every new assertion must be mutation-tested** — apply the reversal, confirm that specific check goes
    red, restore. A `SIGTERM` mid-mutation leaves the file mutated; register
    `process.on('exit'|'SIGINT'|'SIGTERM'|'uncaughtException')` restore guards — a bare `finally` does
    **not** run on a signal, and the file is left mutated on disk.
  - **A mutation runner must merge stderr** (`2>&1` / explicit stdio). The harness writes its report to
    stderr, so a default `execSync` captures 0 bytes and **every mutation falsely reports SURVIVED**.
  - **Never let a check search for a token that also appears in its own `record()` description.** The
    Linux/Chromium check searched the file for `chromium.executablePath()` and matched **its own message
    text**, so it could never fail. Scope every assertion to the code region it is about.
  - **A mutation that CRASHES the harness cannot be asserted by a check inside it.** Reverting the
    Chromium path to Windows-only made `verify-fixes.mjs` throw during import, so no check ever ran and
    the mutation "survived". Choose a mutation that leaves the harness runnable (drop the Linux binary
    from the fallback list, not the whole resolver), or the mutation result is meaningless.
  - **Normalise CRLF before matching mutation anchors** — the firmware is CRLF; multi-line anchors written
    with `\n` silently never match and report SETUP-FAIL.
- **`npm run diagnose`** — software→DB over REST, no ESP32. Anonymous asserts `.env`+VAPID+401s;
  `-- <email> <pw>` replays app reads; `-- --device <email> <pw> --mac <MAC> --write-probe` replays the
  firmware write path (only `devices/<MAC>/__diag`, deleted after). Guide: `docs/WHAT-TO-INPUT.md`.
- **Mobile layout without a device**: `env(safe-area-inset-*)` is 0 in desktop Chrome — override the tokens
  (`--safe-top:59px;--safe-bottom:34px` for iPhone 14 Pro 393x852 @3x) and render against the real
  compiled CSS. Playwright resolves from `node_modules` (CI) or the npx cache via `createRequire`;
  Chromium via `chromium.executablePath()` or the per-OS cache roots. Scratch: `…/Temp/vs_check`. Skill
  **`react-page-render-check`** has the stub-and-mount technique for asserting every page state without auth.
