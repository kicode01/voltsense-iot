# VoltSense — every bug found, and every fix made

Complete record of the bugs discovered in this project and what was changed for each.
Full technical detail lives in `BUG-AUDIT.md`; this file is the one-row-per-bug reference.

**34 issues found, 32 fixed. 2 deliberately left alone (explained at the end).**

Nothing has been deployed to Firebase.

Legend — **C** critical · **H** high · **M** medium · **L** low/hygiene · **N** found during the fix, not in the original audit

---

## 1. Mobile / PWA rendering (found before the audit)

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 1 | H | **Header invisible on iPhone/Android when installed.** Edge-to-edge viewport (`viewport-fit=cover`) with no safe-area padding, so the header rendered under the status bar / Dynamic Island. | Added `pt-[var(--safe-top)]` + left/right safe padding to the header, and `--safe-*` tokens derived from `env(safe-area-inset-*, 0px)` in `src/index.css`. |
| 2 | H | **Bottom nav floated mid-screen with a dead band beneath it** (regression I introduced). `interactive-widget=resizes-content` permanently shrank the iOS layout viewport, and `100dvh` reports ~59px short in iOS standalone. | Removed the `interactive-widget` hint; replaced the `100dvh` shell with `.app-shell { position: fixed; top/right/bottom/left: 0 }`; nav repositioned to `bottom-[calc(0.5rem_+_var(--safe-bottom))]`. |
| 3 | M | **Header text looked blurred.** `bg-white/80 backdrop-blur-xl` on the scrolled header — `backdrop-filter` promotes the element to its own compositing layer and iOS rasterises text inside it with grayscale antialiasing. | Header is now always opaque `#F0F2F5`, no `backdrop-filter`. Only the shadow changes on scroll. |
| 4 | M | **Logo looked fuzzy.** `feDropShadow` with `stdDeviation="16"` in `logo.svg` — at a 40px render from a 512-unit viewBox that is ~3.75 device px of blur. | Removed the filter and its `<defs>` from the SVG. Verified by 5× NEAREST magnification before/after. |
| 5 | C | **Blank white page in a normal mobile browser** (worked only when installed). `Notification.permission` was read unguarded in a `useEffect`; `Notification` is `undefined` on iOS Safari in a tab, so it threw and React unmounted the whole tree. | `typeof` guards + an outermost `ErrorBoundary` in `App.jsx` + `.catch()` on the dynamic import. Reproduced and re-verified in Chromium with `window.Notification` forced undefined. |
| 6 | L | **Duplicate `<link rel="manifest">`** — a hand-written one in `index.html` plus the plugin's. The browser honours only the first, silently discarding the config. | Removed the hand-written link; `vite-plugin-pwa` is now the sole owner. |
| 7 | L | **App icon was the generic default.** | Generated all three variants (`tile`, `maskable`, `favicon`) from `public/logo-square.svg` via `npm run icons`. iOS ignores SVG for `apple-touch-icon`, hence PNGs. |
| 8 | L | **iOS auto-zoomed on input focus** (font-size < 16px). | Inputs set to `text-[16px]`, plus `touch-action: manipulation` on interactive elements. |

## 2. Security

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 9 | **C** | **Telegram bot token hardcoded in client code** (4 occurrences in `Settings.jsx`), baked into the public bundle. A bot token is a complete credential: read every message the bot ever received, and send as the bot. | Token removed from `src/` entirely. The browser now writes an *intent* node (`settings/telegram_link_requests/{uid}`); the ESP32 — which holds the token in NVS — performs the call and writes the result back. **Verified: the shipped bundle contains no `api.telegram.org` call and no token literal.** |
| 10 | **C** | **Link flow insecure by design.** The browser polled `getUpdates` every 2.5 s, which returns *every* user's updates for that bot; the PIN was 4 digits with no expiry; `offset` was never sent so updates replayed forever. | Polling removed from the client. The device polls `getUpdates` only while a link request is pending, sends `offset` (persisted in NVS) and `allowed_updates`, and clears the request on success. |
| 11 | **C** | **Database rules granted every authenticated user full read/write.** Root-level `".read"/".write": "auth != null"` cascades to the whole tree. Combined with public self-service sign-up, anyone could read any user's data and **switch other people's mains relays**. | `database.rules.json` rewritten deny-by-default: `users/{uid}` scoped to that uid, device *commands* require ownership, plus field-level `.validate`. Verified unauthenticated access was already 401; the hole was authenticated abuse. |
| 12 | N | **Rules can't identify the device** — the ESP32 used anonymous auth, so `relay_status` had to stay open to any authenticated principal. Half of bug 11 was unfixable in rules alone. | Implemented the device-identity design (Option A): a custom token carrying `device_mac`, so rules can assert `auth.token.device_mac === $mac`. See `docs/device-auth.md`. |
| 13 | M | **Firmware disabled TLS validation** — `client.setInsecure()` on the Telegram client, so any MITM could read or alter the bot token. | Pinned the GoDaddy Root CA G2 via `setCACert()`. Chain verified with `openssl s_client`: `Verify return code: 0 (ok)`. |
| 14 | M | **Firmware read the bot token from the database** (`settings/telegram_bot_token`) — which any authenticated user could read *and overwrite*, hijacking alerting. | Removed. The token is read from NVS only. |
| 15 | H | **Developer's personal chat ID hardcoded as a fallback recipient** (client line 398 and firmware line 189). Every test message and every unlinked device's alerts could be delivered to the developer. | Removed from both. With no chat ID configured, nothing is sent. |
| 16 | L | **`simulator.js` seeded the production database with no guard** — one stray `node simulator.js` overwrote a live device node. | Refuses to start without `SIMULATOR_CONFIRM=yes`, and prints the target project ID first. |

## 3. Auth

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 17 | H | **Google sign-in broken on mobile/PWA.** `signInWithPopup` is blocked in iOS standalone PWAs and unreliable in mobile Safari/Chrome. | `signInWithRedirect` on mobile/standalone, `signInWithPopup` elsewhere, `getRedirectResult()` completing the handshake on return, and a redirect fallback when a desktop popup is blocked. |

## 4. Data layer

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 18 | H | **Stale closure could delete other users' Telegram links.** The polling effect read `userId` and `telegram_chat_ids_csv` without listing them as dependencies; the CSV was a shared read-modify-write string, so a stale read overwrote it and dropped other users' chat IDs. | The CSV is gone. Chat IDs are individual child keys (`telegram_chat_ids/{uid}`), and the device derives recipients from the object. Removes the race structurally. |
| 19 | M | **`toggleMasterRelay` was fire-and-forget.** `Object.keys().forEach(async …)` ignores the returned promises, so the `await` did nothing, the `try/catch` could never catch a rejection, and N round-trips were issued. | One atomic multi-path `update()`. |
| 20 | N | **`updateNightMode` deleted every sibling setting.** It called `set()` on the whole `settings` node, and RTDB `set` *replaces* a node — so **changing the sleep schedule silently wiped every Telegram link.** | Changed to a multi-path `update()`. This was worse than anything in the original audit. |
| 21 | L | **`roomData` not cleared when the device changed** → device A's telemetry rendered under device B's name. | `setRoomData(null)` + `setLoading(true)` on `roomId` change. |
| 22 | L | **DEV-only mock branches threw** when `roomData` was null. | Optional-chaining guards. |
| 23 | L | **`useHistoryData` never reset `loading` to `true`** on range change, so the previous range's data was shown as current. | Reset on every effect run. |

## 5. Pages

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 24 | H | **Analytics history had no data source at all.** The firmware never wrote a `history` node, so every range was empty and the page silently fell back to demo data. | Firmware now writes hourly + daily rollups to `history/{today,yesterday,last_7_days,this_month}` from a 31-day ring buffer persisted to NVS. |
| 25 | H | **Custom date ranges queried a malformed path.** `timeRange.toLowerCase().replace(/ /g,'_')` turned `10/05/26 - 11/04/26` into `10/05/26_-_11/04/26` — and `/` in an RTDB key creates a **nested path**, so the read went six levels deep and always came back empty. | New `toHistoryKey()` maps labels to Firebase-safe keys (`custom_YYYYMMDD_YYYYMMDD`). The firmware uses the identical mapping. |
| 26 | M | **Night-mode editor reset itself mid-edit.** The seeding effect depended on `roomData`, which changes every 2 s from telemetry, snapping the time pickers back. | Effect now depends on the individual scalar settings fields. |
| 27 | M | **`.toFixed()` on values that may not be numbers.** RTDB can return numeric *strings*, and `.toFixed` then throws and unmounts the page. | `Number(x) \|\| 0` before every `.toFixed()`. |
| 28 | M | **Inactivity limit hardcoded to `15` in the UI** — changing it on the hardware never changed the dashboard. | Reads `data.inactivity_limit`; the firmware publishes it and honours `settings/inactivity_limit_minutes`. |
| 29 | L | **`countdown_remaining_seconds \|\| 60`** rendered `60` when the real value was `0`. | `?? 60`. |
| 30 | L | **Unreachable branch** — `'Device offline.'` sat inside a block guarded by `isDemo === !activeDeviceId`. | Removed (Dashboard + Analytics). |
| 31 | L | **Timers with no cleanup** in `handleMasterOn` / `handleMasterOff` / `handleUnpairDevice` → state updates after unmount. | Stored in refs and cleared on unmount. |
| 32 | L | **Timezone inconsistency.** Analytics compared dates with `new Date(val)` (UTC midnight) while `CustomDatePicker` parsed `T00:00:00` (local) — a latent off-by-one-day trap. | Single `parseLocalDate()` helper used everywhere. |
| 33 | L | **`MarqueeText` only re-measured on `window.resize`**, so it stayed wrong after rotation or a layout change. | `ResizeObserver` on the container (with a `resize` fallback for old browsers). |
| 34 | L | **`TimePicker` hardcoded `40` in three places**, coupled to an `h-10` class elsewhere — changing one silently mis-snapped the picker. | Extracted to a named `ROW_HEIGHT_PX` constant with a comment tying it to the class. |

## 6. Firmware (beyond the security items above)

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 35 | M | **Energy counters were RAM-only** — every reboot or power cut zeroed the day's kWh. | Persisted to NVS every 5 minutes. |
| 36 | L | **Telegram messages were pre-URL-encoded literals** (`%E2%9A%A0%EF%B8%8F%20%3Cb%3E…`), unreadable and fragile. | `sendTelegramMessage()` takes plain text and URL-encodes it properly. |
| 37 | L | **Chat IDs exceeded 32-bit int** for some accounts — read as `int`, they would truncate. | Read as doubles and rendered with 64-bit integers. |
| 38 | L | **`Firebase.ready()` polled forever** if auth failed — a revoked refresh token meant a silent hang. | 30 s timeout that names the likely cause and restarts. |

## 7. Dead code and lint

| # | Sev | Bug | Fix |
| --- | --- | --- | --- |
| 39 | L | **Dead code:** `src/App.css` (184 lines, never imported), `out.js` (0 bytes), `MOCK_TUTORIAL_DATA`. | Quarantined to `.workbuddy-ai/removed/` rather than deleted — the project is not a git repo, so there is no undo. |
| 40 | L | **Lint: 18 warnings** — unused imports and state (`Zap`, `useMemo`, `useRef`, `createPortal`, `ShieldAlert`, `Users`, `Power`, `Plus`, `navigate` ×3, `handleUpdateNightMode`, `telegramLinking`). | Cleaned up. **Now 1 warning**, a benign fast-refresh hint on `DeviceContext.jsx`. |

---

## Found while fixing — not in the original audit

These two only surfaced because I re-ran the verification after fixing, not from reading code.

**A. `updateNightMode` wiped every Telegram link.** Covered above as bug 20. The single most
destructive bug in the project, and the audit had rated the surrounding code as merely "M3".

**B. `getMessaging()` cannot be feature-detected with `try/catch`.** The SDK runs its support check
asynchronously and throws *inside* the resulting promise, then returns normally:

```js
isWindowSupported().then(isSupported => {
    if (!isSupported) throw ERROR_FACTORY.create('unsupported-browser');   // inside .then()
}, ...);
return _getProvider(...).getImmediate();   // returns fine!
```

So the call never throws where it can be caught — it produces an **unhandled promise rejection** on
every unsupported browser. `firebase.js` now calls the SDK's own `isSupported()` first and exposes
`getMessagingInstance()`. The harness caught this; reading the code did not.

**C. A draft of the scoped rules would have killed all telemetry.** My first version made
`relay_status` owner-only. RTDB multi-path updates are **atomic** — if one path is denied the whole
write is rejected — and the firmware pushes telemetry in a single update that includes
`relay_status`. Caught while designing, before anything shipped.

---

## Deliberately not changed

| Item | Why |
| --- | --- |
| `ViewportDebug` + the `?debug` overlay ship to production | Harmless: gated behind a query param, `pointer-events-none`, no data exposure. Removing it would lose a genuinely useful on-device diagnostic for real safe-area values. |
| `logo-design-skill/` (~1,579 files) and `GROUP-7_MANUSCRIPT.txt` in the repo root | Not app code — they are your design assets and coursework. They are not bundled or deployed (`vite` only builds from `src/` and `index.html`). I will not delete your files; say the word if you want them moved or ignored. |

## Still outstanding, and outside my control

* **Rotate the Telegram bot token.** The leaked one is dead (`getMe` → 401), which also means all
  Telegram features were broken, not merely exposed.
* **The device must be provisioned before the strict rules go live** — otherwise it is locked out of
  its own node. `npm run rules:strict` prints the pre-flight checklist.
* **`relay_status` is still writable by any authenticated principal until step 5 of the migration.**
  That is the one remaining hole, and device identity is what closes it.

---

## Verification

| Check | Result |
| --- | --- |
| `npm run lint` | 1 warning, 0 errors (was 18 warnings) |
| `npm run build` | clean |
| `npm run verify` (Chromium, 4 unsupported-API scenarios + happy path + bundle scan) | **8/8 pass, zero page errors** |
| `npm run mint-token -- --selftest` (RS256 JWT assembly) | **10/10 pass** |
| Rules JSON validity | all 3 files valid; strict carries 9 `device_mac` guards, scoped carries 0 |
| Unauthenticated DB access | 401 on read and write (correctly denied) |
| No XSS vectors | no `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` |
| Listener balance | every `addEventListener` has a matching `removeEventListener` |
