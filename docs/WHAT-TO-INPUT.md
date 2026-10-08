# What to input, and how to test it

Everything you need to type, in order, for the software + hardware + database to actually talk to
each other — plus a test you can run at each layer.

Run the sections in order. **Section 0 tells you the single most important thing right now.**

---

## 0. Read this first — the device is currently locked out

The active ruleset is **`deviceuid`** (verify: `npm run rules:status`).

That ruleset says:

```
devices/<MAC>/.write  ==  auth.uid === root.child('device_uids').child('<MAC>').val()
```

`device_uids` has **no `.write` rule anywhere**, so it can only be set by hand in the Firebase
Console. **If `device_uids/<MAC>` does not exist, the ESP32 cannot write a single byte of
telemetry** — it will authenticate fine and then silently fail every update with
`PERMISSION_DENIED`.

So you have a genuine fork in the road. Pick one:

| | Path | Effort | Security |
| --- | --- | --- | --- |
| **A** | Keep `deviceuid`, create the Auth account + `device_uids` entry | ~5 Console clicks | Strong |
| **B** | Switch back to `scoped` (device nodes open to any authenticated principal) | 2 commands | Weak — anyone signed up can switch your relays |

**Recommendation: Path A.** It's not much work and it's the whole point of the recent security
work. If you just want the demo working in 60 seconds, Path B is a one-liner — but say so
explicitly, don't do it absent-mindedly.

---

## 1. Software → Database (test this first, no hardware needed)

### Nothing to input — just run it

```bash
npm run diagnose
```

Expected right now: **5 passed, 0 failed**.
It confirms the `.env` keys are loaded, the VAPID key is present, and the database correctly
**denies anonymous access** (HTTP 401 on `/devices`, `/users`, `/device_uids`).

### To test deeper, input an account

If you already have an account in the app:

```bash
npm run diagnose -- you@example.com yourpassword
```

It signs in and probes the reads the dashboard makes, then tells you exactly which rule blocked
anything that fails.

---

## 2. Create the device identity (Path A)

**Before you start:** you need the device's real MAC address. Flash `VoltSense.ino` once and read
`Device MAC Address: …` off the serial monitor (see Section 3). Everything below keys off that exact
string.

### What to input

**Step 1 — Firebase Console.** Go to
`Authentication → Users → Add user`.

| Field | What to enter |
| --- | --- |
| Email | Any address you don't mind inventing. Convention used in this repo: `device-aabbccddeeff@voltsense-iot.firebaseapp.com` (MAC with the colons stripped) |
| Password | A password you can type on a serial monitor — **avoid** `"`, `\`, and leading/trailing spaces |

After saving, **copy the UID** the Console generates. That is the value you need next.

**Step 2 — Firebase Console.** Go to `Realtime Database → Data`, and add this node by hand:

```
device_uids
  └── AA:BB:CC:DD:EE:FF   =   "<the UID you just copied>"
```

The MAC key **must match the firmware's `macAddress()` exactly** — same case (uppercase, colons
between pairs). If it doesn't match character-for-character, the rules will never resolve and you
will chase a ghost.

**Step 3 — verify it resolved.** This is the check that saves you the most time:

```bash
npm run diagnose -- --device device-aabbccddeeff@voltsense-iot.firebaseapp.com "thepassword" --mac AA:BB:CC:DD:EE:FF
```

Expected: `read devices/<MAC>` → **allowed**. If it says `PERMISSION_DENIED`, the `device_uids`
entry or the MAC spelling is wrong — do not proceed to flashing until this passes.

**Step 4 — prove the write path** (the firmware's telemetry push):

```bash
npm run diagnose -- --device device-aabbccddeeff@voltsense-iot.firebaseapp.com "thepassword" --mac AA:BB:CC:DD:EE:FF --write-probe
```

Expected: `device telemetry write` → **allowed**, then `cleanup scratch node` → **deleted**.

The probe writes only to `devices/<MAC>/__diag` and deletes it immediately. It never touches
`relay_status`. If this FAILS, the firmware will be mute — fix the rules before flashing.

---

## 3. Hardware → Database (the ESP32)

### What to input — into the serial monitor, not into a file

**Flash `esp32/ProvisionToken/ProvisionToken.ino`.** Open the Serial Monitor at **115200 baud**.
You will be prompted for 5 values. Send a single `-` to skip any field.

| # | Prompt | What to type | For Path A |
| --- | --- | --- | --- |
| 1 | Alert endpoint secret | the same value you put in `VOLTSENSE_ALERT_SECRET` on Vercel | **required** |
| 2 | Device account email | `device-aabbccddeeff@voltsense-iot.firebaseapp.com` | **required** |
| 3 | Device account password | the password from Step 1 | **required** |
| 4 | Firebase ID token | `eyJhbGciOiJSUzI1Ni...` | `-` (skip — Option B only) |
| 5 | Firebase refresh token | `AMf-vBx...` | `-` (skip — Option B only) |

Generate the secret once and use the **same string in both places**:

```bash
openssl rand -hex 32
```

Put it in Vercel as `VOLTSENSE_ALERT_SECRET`, and type it here for field 1. If they differ the
endpoint rejects every alert with **401** and you'll see `Alert -> HTTP 401` on the serial monitor.

The tool reads each value back after writing and prints `[OK] … stored (N bytes)` — trust that, not
the echo.

> **Wi-Fi is separate, and you don't type it anywhere.** There are no `WIFI_SSID` constants in this
> project. `VoltSense.ino` uses **WiFiManager**: on first boot it raises a captive portal called
> **`VoltSense_Setup`**. Join that hotspot from your phone and pick your home Wi-Fi. It's saved to
> NVS and reused forever after.

### Get the MAC address before Step 2 of Section 2

You need the device's **real** MAC to create the `device_uids` entry, and it is not something you
choose. Flash `VoltSense.ino` once and read it off the serial monitor:

```
Device MAC Address: AA:BB:CC:DD:EE:FF
```

Use that exact string (uppercase, colons) as the key in `device_uids`.

**Then flash `esp32/VoltSense/VoltSense.ino`.**

### How to test it

Open the Serial Monitor. You are looking for, in order:

```
Device identity loaded (email/password account).
Authenticating with Firebase...
Authenticated!
Database path set to: /devices/AA:BB:CC:DD:EE:FF
```

- `ERROR: no device identity provisioned in NVS` → re-run step 3 above; the provision didn't stick.
- `Authentication timed out after 30s` → the email/password is wrong, or the account was deleted.
- `Failed to update RTDB: …` → auth worked but rules rejected the write. Go back to
  **Section 2 Step 4**.

### Then verify from the outside

While the device is running, from your laptop:

```bash
npm run diagnose -- --device <device-email> "<password>" --mac AA:BB:CC:DD:EE:FF
```

`read devices/<MAC>` → allowed means the device node now has data in it, i.e. telemetry is flowing.

---

## 4. Alerts (Vercel + FCM)

Alerts are delivered as **web push**. There is no bot to create and no chat ID to link — the device
POSTs to a serverless endpoint, which looks up who owns the device and pushes to their phones.

**One-time server setup:**

1. Deploy to Vercel (`vercel --prod`, or connect the repo).
2. Add these environment variables in **Vercel → Project → Settings → Environment Variables**:
   - `VOLTSENSE_ALERT_SECRET` — `openssl rand -hex 32`
   - `FIREBASE_SERVICE_ACCOUNT` — Firebase Console → Project settings → Service accounts →
     Generate new private key, then flatten it: `jq -c . serviceAccountKey.json`
   - `FIREBASE_DATABASE_URL` — `https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app`
3. Point `ALERT_URL` in `VoltSense.ino` at your deployment.

**Per user:**

1. Open the app and go to **Settings → Push Notifications**, flip the toggle, allow the prompt.
   This stores an FCM token at `pushTokens/<uid>`.
2. Tap **Test** to see a sample notification immediately.

> **iOS:** web push only works once the app is **added to the Home Screen**. In a normal Safari tab
> the permission prompt will not appear and no notification can be delivered — this is an Apple
> restriction, not a bug. Android and desktop browsers work without installing.

### The Alerts tab (and why it exists)

Every alert the endpoint receives is also **written to `devices/<MAC>/alerts`**, and the app shows
them in the **Alerts** tab of the bottom nav. That history is not a duplicate of the push
notifications — it is the durable record that survives the cases where push does not:

| Situation | Push notification | Alerts tab |
| --- | --- | --- |
| Phone offline at the moment of the alert | Usually missed | **Recorded** |
| iOS Safari, app not added to Home Screen | Cannot be delivered at all | **Recorded** |
| Notification permission denied | Cannot be delivered | **Recorded** |
| App closed for hours | Only what FCM queued | **All of it** |

When you next open the app, the Alerts tab raises **one collapsed summary notification** ("3 alerts
— recorded while the app was closed. Tap to review.") rather than replaying each alert. Opening the
tab marks everything read for *your* account only; the read marker lives at
`devices/<MAC>/alert_reads/<uid>`, so two people sharing one phone each keep their own unread badge.

The newest **200** alerts are kept; older ones are pruned automatically by the endpoint on each
write. No maintenance required.

> Note the badge on every alert row (`Delivered` / `Partly delivered` / `Not delivered` / `No
> recipients`). That describes what the *server* managed to do, not what the alert means — so a row
> can honestly say a notification failed to reach anyone.

---

## 5. What you do *not* need to input

| Thing | Why not |
| --- | --- |
| Firebase web config (`apiKey`, `databaseURL`, …) | Already in `src/lib/firebase.js` and `.env`. The `apiKey` is a public identifier, not a secret — that's normal for Firebase web apps. |
| VAPID key | Already in `.env` as `VITE_FIREBASE_VAPID_KEY`. |
| Service-account JSON | Needed on Vercel (the alert, pair and claim functions use it) and only for **Option B** (`npm run mint-token`) locally. |
| Wi-Fi SSID / password | Not in any source file — WiFiManager's captive portal (`VoltSense_Setup`) handles it on first boot. |
| A Telegram bot token | No longer used anywhere. The device holds no messaging credential. |

---

## 6. Housekeeping you should input once

None of this is needed to run the app; it's cleanup from the Telegram era.

- Delete any leftover `settings/telegram_*` nodes in the Realtime Database — they are unreachable
  now that the rules no longer grant access to them.
- If a Telegram bot token was ever committed or shared, revoke it via @BotFather (`/revoke`). It is
  unused by this codebase either way.
- If a Firebase **service-account key** was ever committed, rotate it in the Console. Deleting the
  file is not enough — the key stays valid until revoked.
- Probe the alert history without hardware:
  `npm run diagnose -- <email> <password>` now reports how many entries are under
  `devices/<MAC>/alerts`, so you can confirm the endpoint is recording before wiring up the device.

---

## 7. Pairing a new device without a USB cable

This is **Option C** in `docs/device-auth.md` — read that first for the design and the threat model.
Short version: a factory-fresh unit mints its own credentials and prints a code; the user types the
code into the app.

### Input once, at flash time — the factory key

| Where | What | How |
| --- | --- | --- |
| Vercel dashboard | `VOLTSENSE_PAIRING_KEY` | `openssl rand -hex 32`, paste the hex string |
| Firmware build | the **same** string | `-DVOLTSENSE_PAIRING_KEY='"<hex>"'` |
| Vercel dashboard | `VOLTSENSE_AUTH_DOMAIN` *(optional)* | only if you use a custom auth domain |

Never prefix the pairing key with `VITE_` — that would inline it into the public bundle.

### Input per device — nothing, on your side

1. Flash a unit with the factory key defined. If you leave `VOLTSENSE_PAIRING_KEY` empty the
   firmware skips pairing and behaves exactly as before (USB provisioning only) — a misconfigured
   build fails safe rather than locking a unit out.
2. Power it on. It joins Wi-Fi (or opens the `VoltSense_Setup` captive portal if it has no creds).
3. Watch the serial monitor. You will see a banner like:

   ```
   ========================================
     PAIRING CODE:  A1B2-C3D4
     Enter this in the VoltSense app to link this device.
     Expires in 30 minutes.
   ========================================
   ```

4. In the app: **Settings → Add device**, type `A1B2C3D4` (the dash is optional — the field
   auto-formats). The device appears immediately; the app is listening live, so no refresh.

If the code expired, power-cycle the unit — it re-pairs and prints a fresh code.

### Re-pairing / returning a unit

Hold **GPIO 0 for about 5 seconds** while it boots. The serial monitor confirms the identity keys
were erased (Wi-Fi is kept). On the next boot it pairs fresh and prints a new code. The previous
owner must release the device first — a factory reset cannot take a device away from an account that
already owns it; only the owner (or you, in the Console) can do that.

### What you should *not* do

| Don't | Why |
| --- | --- |
| Write `device_uids/<MAC>` from the browser | It has no client `.write` rule in any variant. Only the Admin SDK (`/api/pair`) can. |
| Store the pairing code under `devices/<MAC>` | The `scoped` ruleset exposes `devices/<MAC>` to any signed-in user, so a copy there is a harvestable list. The code lives only in `pairingCodes/<CODE>`, which is `.read: false` everywhere. |
| Add a client-side "link by MAC" path | That is the hole that was just removed from `Settings.jsx`. A MAC is public; it is not proof of ownership. |

### Verifying without hardware

```bash
npm run verify     # 36 checks, incl. 17 pairing/ownership/firmware assertions + 4 per-variant rules checks
```

The harness asserts the security properties directly against the source: constant-time key compare,
MAC validation, rate limiting, no code copy under `devices/<MAC>`, ownership untouched by `/api/pair`,
`verifyIdToken` on claim, ownership in a transaction, and the firmware behaviours.

---

## Quick reference

```bash
npm run rules:status     # which ruleset is live (currently: deviceuid)
npm run diagnose         # software → database, no credentials
npm run diagnose -- <email> <password>            # + authenticated reads (incl. alert history)
npm run diagnose -- --device <email> <pw> --write-probe   # + firmware write path
npm run verify           # Chromium regression harness (36 checks) — run after npm run build
npm run build            # must finish before npm run verify, or verify validates a stale dist/
npm run lint             # 1 warning expected
npm run deploy:rules     # push database.rules.json
npm run deploy:vercel    # push the app + api/alert.js + api/pair.js + api/claim.js to Vercel
```
