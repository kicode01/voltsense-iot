# VoltSense — Full System Bug Audit

Date: 2026-10-05
Scope: `src/` (19 files, ~3,200 LOC), config (`firebase.json`, `database.rules.json`, `vite.config.js`,
`package.json`), ESP32 firmware (`esp32/*.ino`), root tooling (`simulator.js`, `token_encoder.html`).
Method: full read-through, `oxlint`, static pattern sweep, and live verification against production.

Each finding below was verified before being reported. Where a theory was tested and disproved it is
noted so it is not re-investigated.

---

## CRITICAL

### C1. Telegram bot token hardcoded in client-side code
`src/pages/Settings.jsx` embeds the full bot token (4 occurrences) and it is baked into the public
bundle — confirmed present in `dist/assets/Settings-*.js`.

Anyone can download that file and read the token. A Telegram bot token is a **complete credential**:
it grants the ability to read every message the bot has received (`getUpdates`) and to send messages
as the bot. That means exposure of other users' PINs and chat IDs, plus the ability to hijack the bot.

**Verified:** the token currently returns `401 Unauthorized` from `getMe`, so it has already been
revoked/rotated. Consequence: **all Telegram features are currently broken**, not just insecure.

**Fix:** remove the token from client code entirely. Move all Telegram API calls behind a server
function (Cloud Function) that holds the token in server-side config. Rotate the token (already dead).
Never ship a bot token to a browser.

### C2. Telegram linking flow is insecure by design
`Settings.jsx` lines 89–137 poll `getUpdates` directly from the browser every 2.5 s.

- `getUpdates` returns **all** pending updates for the bot. Any client holding the token sees every
  user's link messages, not just its own.
- The PIN is 4 digits (`1000–9999`) with no server-side expiry, so it is guessable/collidable.
- The `offset` parameter is never sent, so updates are replayed on every poll.

**Fix:** do the link handshake server-side with a signed, expiring nonce, and use a Telegram webhook
instead of polling.

### C3. Database rules grant every authenticated user full read/write
`database.rules.json`:
```json
{ "rules": { ".read": "auth != null", ".write": "auth != null" } }
```
This is a root-level grant: any authenticated principal can read and write the **entire** tree.

**Verified:** unauthenticated requests are correctly rejected (HTTP 401 on `/devices.json`,
`/users.json`, `/.json`, and a PUT probe). So the hole is not open to the public internet — but:

- The login screen offers **public self-service sign-up** (`createUserWithEmailAndPassword`).
- The ESP32 authenticates with **anonymous auth** (`config.signer.anonymous = true`).

So anyone can obtain a valid token, then read any user's data and write any device's
`ports/port_0X/relay_status` — i.e. **physically switch other people's mains relays**. Pairing does no
ownership check: `handlePairDevice` writes straight to `users/{uid}/owned_devices/{mac}` and the app
then reads `devices/{mac}`.

**Caveat:** I could not read the *deployed* ruleset without an authenticated account, so I cannot
prove the live rules match this file. The file is what `firebase.json` deploys, so it should be
treated as the source of truth. Worth confirming in the Firebase console.

**Fix:** scope rules per user, e.g. `users/$uid` readable/writable only by `$uid`, and `devices/$mac`
gated on membership in `users/$uid/owned_devices`. Disable anonymous auth or restrict it to a
device-only subtree. Consider App Check.

---

## HIGH

### H1. Push notifications silently never work
`pushNotifications.js` uses `import.meta.env.VITE_FIREBASE_VAPID_KEY`, but **that variable is not
defined in `.env`** (only the 7 Firebase keys are). Vite inlines it as `undefined`, so
`getToken(messaging, { vapidKey: undefined })` throws and is swallowed by the `catch`.

This is masked because `Settings.jsx` line 235 hardcodes a *different*, working VAPID key — so the
manual toggle works while the automatic path on login is dead. Two sources of truth for one key.

**Fix:** add `VITE_FIREBASE_VAPID_KEY` to `.env` and use it in both places.

### H2. Developer's personal chat ID hardcoded as a fallback recipient
- `Settings.jsx` line 398: `const chatIdToUse = telegramLinkedChatId || '1750608936'; // Fallback to developer's ID`
- `VoltSense.ino` line 189: `String chatIdsCsv = "1750608936"; // Fallback to developer ID`

Every user's test message and every unlinked device's alerts can be delivered to the developer.
**Fix:** remove both fallbacks; skip sending when no chat ID is configured.

### H3. Analytics history has no data source at all
The firmware never writes a `history` node — grep for `history` in `VoltSense.ino` returns nothing.
The only nodes it writes are `state`, `is_occupied`, `countdown_remaining_seconds`,
`total_current_amps`, `total_power_watts` and the per-port telemetry.

`useHistoryData` reads `devices/{mac}/history/{rangeKey}`, which will therefore always be empty. The
Analytics page silently falls back to demo data or shows "No data yet" for every range.
**Fix:** either implement history aggregation (a scheduled Cloud Function rolling telemetry into
daily buckets) or remove the page.

### H4. Custom date ranges query a malformed path
`useHistoryData` builds the key with `timeRange.toLowerCase().replace(/ /g, '_')`. A custom range is
stored as `10/05/26 - 11/04/26`, which becomes `10/05/26_-_11/04/26` — the `/` characters are path
separators in Firebase, so the query becomes:
```
devices/<MAC>/history/10/05/26_-_11/04/26
```
Even once H3 is fixed, custom ranges would never match a written key.
**Fix:** sanitise to `[A-Za-z0-9_-]` (e.g. `2026-10-05_2026-11-04`).

### H5. Stale closure can delete other users' Telegram links
The polling `useEffect` (line 89) depends on `[telegramPin, activeDeviceId]` but reads `userId` and
`roomData?.settings?.telegram_chat_ids_csv`. `oxlint` flags this (`react-hooks/exhaustive-deps`).

The CSV is a shared, read-modify-write string. With a stale `currentCsv`, the unlink path
(`idsList.filter(...)` then `set(...)`) can **overwrite the CSV and drop other users' chat IDs**.
There is also a plain race: two users linking concurrently lose one update.
**Fix:** store chat IDs as individual child keys (`telegram_chat_ids/{uid}`) rather than one CSV
string, and read them server-side.

### H6. Google sign-in is broken on mobile/PWA
`Login.jsx` uses `signInWithPopup`, which iOS standalone PWAs block (and it is unreliable in mobile
Safari/Chrome). Users get "Google Sign-In failed. Please try again."
**Fix:** use `signInWithRedirect` with `getRedirectResult` on mobile, or `signInWithPopup` with a
redirect fallback on `auth/popup-blocked` / `auth/operation-not-supported-in-this-environment`.

---

## MEDIUM

### M1. Night-mode editor resets itself while the user is editing
`Settings.jsx` lines 53–61 re-sync local `nightMode` state from `roomData` on **every** change.
Telemetry lands every 2 s, so `roomData` changes constantly and the effect keeps firing — snapping the
time pickers back to the stored value mid-edit.
**Fix:** seed the local state once per device (`[activeDeviceId]`), or only sync when not dirty.

### M2. `.toFixed()` on values that may not be numbers
- `Dashboard.jsx` line 253: `computedTotalWatts.toFixed(0)`
- `Analytics.jsx` lines 213/227: `(dataToRender?.totals?.energy || 0).toFixed(...)`

If a value is stored as a string (hand-edited in the console, or a firmware change), `.toFixed` is not
a function and throws. The new `ErrorBoundary` catches it, but it is still a hard failure.
**Fix:** `Number(value) || 0` before formatting.

### M3. `toggleMasterRelay` is fire-and-forget
`useRoomData.js` lines 61–72:
```js
Object.keys(portsObj).forEach(async (portId) => { await togglePortRelay(portId, newStatus); });
```
`forEach` ignores the returned promises, so the `await` does nothing, the enclosing `try/catch` can
never catch a rejection, and it issues N sequential round-trips. The "All On" spinner clears after a
fixed 500 ms rather than when the writes actually complete.
**Fix:** `await Promise.all(...)`, or better, one `update()` with multiple paths.

### M4. Firmware disables TLS certificate validation
`VoltSense.ino` line 215: `client.setInsecure();` on the Telegram `WiFiClientSecure`. Any
man-in-the-middle can read or alter the bot token and messages.
**Fix:** pin the Telegram root CA via `setCACert()`.

### M5. Firmware reads the bot token from the database
`VoltSense.ino` lines 200–206 pull `settings/telegram_bot_token` from the RTDB, which (per C3) any
authenticated user can read — and **overwrite**, which would break or hijack alerting.
**Fix:** keep the token only in NVS; never in a client-readable database.

### M6. Inactivity limit is hardcoded in the UI
`Dashboard.jsx` lines 324–327 render a literal `15`. The device value is never read, so changing the
limit on the hardware never changes the dashboard.
**Fix:** read `inactivity_limit` from `roomData`.

### M7. Energy counters are RAM-only in the firmware
`portEnergyKWh[]` lives in RAM and resets to zero on every reboot or power cut, so `energy_kwh`
silently resets. There is no persistence (NVS) or daily rollover.
**Fix:** persist periodically to NVS, or compute energy server-side from telemetry.

---

## LOW / HYGIENE

| # | Finding |
|---|---|
| L1 | Dead code: `src/App.css` (184 lines, **never imported**), `out.js` (0 bytes), `MOCK_TUTORIAL_DATA` in `useRoomData.js` |
| L2 | `oxlint` reports **23 warnings** — unused imports/state: `Zap`, `useMemo`, `useRef`, `createPortal`, `ShieldAlert`, `Users`, `Power`, `Plus`, `navigate` (×3 files), `handleUpdateNightMode`, `telegramLinking` |
| L3 | Unreachable branch: Dashboard line 211 `'Device offline.'` can never render, because `isDemo === !activeDeviceId` guards the block |
| L4 | `useHistoryData` never resets `loading` to `true` when device/range changes → previous data is briefly shown as current |
| L5 | `useRoomData` does not clear `roomData` when `roomId` changes → brief cross-device data bleed; the DEV-only mock branches (lines 90/104/118) throw if `roomData` is `null` |
| L6 | `setTimeout` with no cleanup in `handleMasterOn`/`handleMasterOff` and `handleUnpairDevice` → setState after unmount |
| L7 | `data.countdown_remaining_seconds \|\| 60` renders **60** when the real value is `0` |
| L8 | Timezone inconsistency: Analytics validates with `new Date(val)` (UTC midnight) while `CustomDatePicker` uses `new Date(\`${d}T00:00:00\`)` (local) — can be off by a day |
| L9 | `simulator.js` seeds the **production** database with no environment guard — running it by accident writes `devices/AA:BB:CC:DD:EE:FF` into prod |
| L10 | `ViewportDebug` and the `?debug` overlay ship to production (harmless, gated, `pointer-events-none`) |
| L11 | Repo bloat: `logo-design-skill/` (~1,579 files) and `GROUP-7_MANUSCRIPT.txt` are not part of the app |
| L12 | `TimePicker` hardcodes `40px` row height to match `h-10`; `MarqueeText` re-measures only on `window.resize` (a `ResizeObserver` would be correct) |

---

## Verified clean

- **No XSS vectors** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` anywhere.
- **No leaked listeners** — every `addEventListener` has a matching `removeEventListener`; the one
  `setInterval` has a matching `clearInterval`.
- **Unauthenticated database access is denied** (401 on read and write).
- **The header blur was not** caused by the ambient-glow layer (pixel-diff max delta 3/255, zero
  changed pixels in the header) — disproved by measurement.
- The white-page crash and the fuzzy logo reported earlier are already fixed and verified.

---

## Suggested order of work

1. **C1 + C2** — pull the Telegram token out of the client, rotate it, move the flow server-side.
2. **C3** — write and deploy scoped database rules; decide on anonymous auth.
3. **H1, H2, H6** — VAPID key, remove the developer chat-ID fallbacks, fix mobile sign-in.
4. **H3, H4, H5** — either build the history pipeline or drop the page; fix the CSV race.
5. **M1–M7**, then the hygiene list.

---

# Resolution log

All findings above have been addressed. Nothing was deployed.

## Client

| ID | Fix |
| --- | --- |
| C1 / C2 | The bot token and the developer chat-ID fallback are gone from `src/`. `Settings.jsx` no longer performs any Telegram I/O: it writes an *intent* node (`settings/telegram_link_requests/{uid}`) and the ESP32 — which holds the token in NVS — completes the handshake and writes the result back. Verified: the shipped bundle contains no `api.telegram.org` call and no token/chat-id literal. |
| H1 | VAPID key moved to `VITE_FIREBASE_VAPID_KEY` in `.env` / `.env.example`. |
| H6 | `Login.jsx` uses `signInWithRedirect` on mobile/standalone, `signInWithPopup` elsewhere, with `getRedirectResult()` completing the handshake on return and a redirect fallback if a desktop popup is blocked. |
| H2 | Hardcoded chat-ID fallbacks removed from both client and firmware. |
| H4 | New `toHistoryKey()` in `useHistoryData.js` maps range labels to Firebase-safe keys. The old `toLowerCase().replace(/ /g,'_')` turned a custom range into `custom:_10/01/25_-_10/15/25` — and a `/` in an RTDB key silently creates a **nested path**, so custom ranges could never have worked. |
| L4 | `loading` is reset to `true` when the range changes. |
| M2 | `Number()` guards before every `.toFixed()` — RTDB can return numeric *strings*. |
| M6 | Inactivity limit is read from `data.inactivity_limit` instead of a hardcoded `15`. |
| L3 | Unreachable `'Device offline.'` branch removed (it was inside a block that only renders when there is no device). |
| L7 | `\|\| 60` → `?? 60` so a genuine `0` renders as `0`, not `60`. |
| L1 | `src/App.css`, `out.js` and `MOCK_TUTORIAL_DATA` removed. Quarantined to `.workbuddy-ai/removed/` rather than deleted, since the project is not a git repo. |

## Data layer

| ID | Fix |
| --- | --- |
| M3 | `toggleMasterRelay` now commits one **atomic** multi-path update. The old `Object.keys().forEach(async …)` fired un-awaited writes, so callers saw instant success while ports were still flipping, and failures were swallowed. |
| — | **New finding, worse than M3:** `updateNightMode` called `set()` on the whole `settings` node. RTDB `set` **replaces** the node, so changing the sleep schedule silently deleted `telegram_chat_ids`, `telegram_link_requests` and any other sibling key. Changed to a multi-path `update()`. |
| L5 | Null guards in the DEV-only mock branches. |
| — | `roomData` is cleared when the active device changes, so device A's telemetry no longer renders under device B's name. |

## Firmware

| ID | Fix |
| --- | --- |
| H3 | Daily + hourly energy rollups now written to `history/{today,yesterday,last_7_days,this_month}` — a 31-day ring buffer, persisted to NVS. |
| M4 | `setInsecure()` replaced with a pinned GoDaddy Root CA G2. Chain verified with `openssl s_client`: `Verify return code: 0 (ok)`. |
| M5 | The token is read from NVS only; the `settings/telegram_bot_token` read is gone. |
| M7 | `portEnergyKWh[]` is persisted to NVS every 5 minutes (was RAM-only, so a reboot zeroed the day). |
| — | Implements the other half of C1/C2: polls `getUpdates` only while a link request is pending, matches the PIN, writes the chat id back, and handles test requests plus unlink goodbyes. |
| — | Publishes `inactivity_limit`; `IDLE_TIMEOUT_MS` is now runtime-configurable via `settings/inactivity_limit_minutes`. |
| — | `sendTelegramMessage` takes plain text and URL-encodes it properly, instead of pre-encoded `%E2%9A%A0…` literals. |

## Security

| ID | Fix |
| --- | --- |
| C3 | `database.rules.json` rewritten: deny-by-default, `users/{uid}` scoped to that uid, device *commands* (port name/icon, night mode) require ownership, plus field-level `.validate`. `database.rules.strict.json` holds the full device-auth design. See `docs/device-auth.md`. |
| L9 | `simulator.js` refuses to run without `SIMULATOR_CONFIRM=yes` and prints the target project, since it overwrites a node in the **live** database. |

## Found while verifying (not in the original audit)

`getMessaging()` cannot be feature-detected with `try/catch`. The SDK runs its support check
asynchronously and throws from inside the promise:

```js
isWindowSupported().then(isSupported => {
    if (!isSupported) throw ERROR_FACTORY.create('unsupported-browser');
}, ...);
return _getProvider(...).getImmediate();   // returns normally
```

The call therefore never throws where it can be caught — it produces an **unhandled promise
rejection** on every unsupported browser. `firebase.js` now calls the SDK's exported
`isSupported()` first and exposes `getMessagingInstance()`. This was caught by the verification
harness, not by reading the code.

## Verification

`node verify-fixes.mjs` builds a static server over `dist/` and drives Chromium:

```
PASS  Notification API absent (iOS Safari in-tab)        errors=0 rootChildren=1
PASS  Notification present but PushManager absent        errors=0 rootChildren=1
PASS  serviceWorker absent entirely                      errors=0 rootChildren=1
PASS  Notification + serviceWorker + PushManager absent  errors=0 rootChildren=1
PASS  Happy path renders the login screen
PASS  Exactly one manifest link in the document
PASS  No Telegram token / chat id in the shipped bundle
PASS  VAPID key present in bundle (from .env)

8/8 checks passed
```

Every earlier blank-page scenario now renders with zero page errors. Lint went from 18 warnings to
1 (a benign fast-refresh hint on `DeviceContext.jsx`).

---

# Follow-up: device identity (Option A) implemented

C3 was only half-closed by the scoped rules — `relay_status`, `override`, the telemetry fields,
`history/**` and the Telegram nodes still had to accept any authenticated principal, because the
ESP32 authenticated **anonymously** and no rule could tie the caller to a MAC address.

Option A from `docs/device-auth.md` is now built:

| Piece | File |
| --- | --- |
| Mint a `device_mac` custom token, exchange it for an ID + refresh token | `scripts/mint-device-token.mjs` |
| Provision both tokens (+ the bot token) into NVS | `esp32/ProvisionToken/ProvisionToken.ino` |
| Sign in with the device identity instead of `signUp(anonymous)` | `esp32/VoltSense/VoltSense.ino` |
| Switch rulesets safely | `scripts/set-rules.mjs` |
| Full walkthrough | `docs/device-auth.md` |

**No `firebase-admin` dependency.** A custom token is a plain RS256-signed JWT, so the script uses
`node:crypto` directly rather than adding ~40 MB for a script that runs once per device.
`npm run mint-token -- --selftest` proves the assembly with a throwaway key and no credentials:
10/10 checks, including signature verification.

The firmware now reads `dev_id_token` / `dev_refresh_token` from NVS and hands them to
`config.signer.tokens.*`; the Firebase library renews the ID token from the refresh token
automatically. If auth doesn't complete in 30 s it reports a likely revoked refresh token and
restarts, rather than hanging silently. `ALLOW_ANONYMOUS_FALLBACK` exists for bench testing and
defaults to `false`.

**Not deployed.** `database.rules.json` still holds the scoped ruleset. Switching to strict before
the device is provisioned would lock the device out of its own node, so the switch is a deliberate
command (`npm run rules:strict`) that prints a pre-flight checklist, and `npm run rules:scoped`
switches back.
