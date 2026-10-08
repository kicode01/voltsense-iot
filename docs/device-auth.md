# Device authentication — design & migration

## Short answer: you do not need a paid plan, and you do not need a Cloud Function

Cloud Functions **does** require the Blaze (pay-as-you-go) plan. That is why this design never uses
one. Two things follow:

1. **The token minting happens on your laptop, not in the cloud.** Firebase's own documentation
   says the service-account-JSON method "can be used in any environment" and "enables the Admin SDK
   to create and sign custom tokens **locally, without making any remote API calls**". Our script
   doesn't even use the Admin SDK — a custom token is a plain RS256-signed JWT, so it signs with
   Node's built-in `crypto`. Cloud Functions is only ever mentioned in Firebase's docs as *one
   example* of an environment where a service account is auto-discovered. It is not a requirement.
2. **There is a second option that needs no service account at all.** If the Console won't give you
   a service-account key, use **Option A** below — it needs nothing but Console clicks.

| | Option A — uid allow-list | Option B — `device_mac` claim | Option C — claim-code pairing |
| --- | --- | --- | --- |
| Service account | **not needed** | needed (free, but see below) | needed (free) |
| Cloud Function | **not needed** | **not needed** | **not needed** (Vercel function) |
| Paid plan | **not needed** | **not needed** | **not needed** |
| Setup per device | ~4 Console clicks + paste email/password | run one command + paste two tokens | **none** — the device does it |
| User's part | **none** (you provision it) | **none** (you provision it) | types an 8-char code in the app |
| Scales to | a handful | a handful | 100+ without extra work |
| Ruleset | `database.rules.deviceuid.json` | `database.rules.strict.json` | `database.rules.deviceuid.json` |
| Firmware | `config.signer.email` / `.password` | `config.signer.tokens.id_token` / `.refresh_token` | self-provisions via `/api/pair` |

Start with **Option A** if you are on Spark and want the shortest path with one device.
**Option C** if you are shipping more than a few, or the person using the device is not you.

---

## Why this exists at all

The original ruleset was:

```json
{ "rules": { ".read": "auth != null", ".write": "auth != null" } }
```

RTDB rules **cascade**: that single `.read`/`.write` at the root granted every authenticated
principal full read and write access to the **entire** database — all users' `owned_devices`, every
device's telemetry, settings, and history. Anybody could sign up and rewrite another household's
device, including `relay_status`, which drives mains relays.

The hard part is the device. The ESP32 authenticated **anonymously**, so `auth.uid` was a throwaway
ID the rules could not tie to a MAC address. There was no way for a rule to ask "is this caller
really device `AA:BB:...`?"

### Three rulesets, one active

> **As of the last audit, `database.rules.json` is a copy of `database.rules.deviceuid.json`**, i.e.
> **Option A (`deviceuid`) is the active ruleset.** Earlier revisions of this document described
> `scoped` as the default — that was stale. `npm run rules:status` cannot tell you which variant is
> live (it compares bytes, and `database.rules.json` is not byte-identical to any variant), so
> identify it semantically. **Never `cp` between variants to change it** — use the `rules:*` command.

| File | What it does |
| --- | --- |
| `database.rules.scoped.json` | Deny-by-default; `users/{uid}` scoped to that uid; device *commands* require ownership; field-level validation. Device-writable nodes stay open to authenticated principals. |
| `database.rules.deviceuid.json` | The above, plus device identity via a `device_uids` allow-list (Option A). **← currently active** |
| `database.rules.strict.json` | The above, plus device identity via `auth.token.device_mac` (Option B). |
| `database.rules.json` | The file `firebase deploy` actually reads. A **copy** of whichever is active. |

```bash
npm run rules:status      # which one is active
npm run rules:scoped      # safe default; works with the device's current auth
npm run rules:deviceuid   # Option A + pre-flight checklist
npm run rules:strict      # Option B + pre-flight checklist
npm run deploy:rules      # firebase deploy --only database
```

---

## Option A — uid allow-list (no service account, no paid plan)

The device signs in as an ordinary Firebase Auth user. The rules resolve its MAC to that user's uid
through a `device_uids` node, and **that node has no `.write` rule anywhere**, so it inherits
`false` from the root and no API client can touch it. Only the Firebase Console, which bypasses
rules entirely, can set it.

### Steps

**1. Confirm the app works on the current rules, then switch to `deviceuid`.**

`scoped` is the weaker intermediate used only to prove the app still works before device identity is
enforced. If you are provisioning your first device, the rules are already `deviceuid`, so just
confirm:

```bash
npm run rules:status     # informational; identify the variant semantically if it says UNKNOWN
```

If you need to step back to `scoped` for a moment, do it with the command (never `cp`):

```bash
npm run rules:scoped
npm run deploy:rules
```

**2. Create the device account.** Firebase Console → **Authentication** → **Users** → *Add user*.

* Email: `device-aabbccddeeff@voltsense-iot.firebaseapp.com`
  (colons are not valid in an email local part, so use the MAC without them; the auth domain is a
  real domain your project already owns)
* Password: anything long and random
* **Copy the generated UID** — you need it next

**3. Register the MAC → uid mapping.** Console → **Realtime Database** → add a node by hand:

```
device_uids
  └── "AA:BB:CC:DD:EE:FF": "<the UID you copied>"
```

Colons are fine in a database key (only `. # $ [ ] /` are forbidden).

**4. Provision the device.** Flash `esp32/ProvisionToken/ProvisionToken.ino`, open Serial Monitor at
115200, and paste the **email** and **password** when prompted. Skip the two token fields with `-`.

**5. Flash `VoltSense.ino`.** It should print:

```
Device identity loaded (email/password account).
```

**6. Switch rules and deploy.**

```bash
npm run rules:deviceuid
npm run deploy:rules
```

**7. Verify** telemetry still flows and a relay toggle still round-trips. Then sign in as a second,
unrelated account and confirm you can no longer see or control the first account's device.

### Notes

* Adding a device later = repeat steps 2–5. There is no per-device code change.
* The password lives in NVS. Rotating it means changing it in the Console and re-flashing.
* Deleting the account in the Console revokes the device — re-create it and update `device_uids`.

---

## Option B — `device_mac` custom-token claim

Firebase signs the custom token into an ID token that carries the claim, so rules can assert
`auth.token.device_mac === $mac`. Custom tokens must be minted by a trusted environment — a device
must not be able to mint its own identity — which is why minting happens on your machine.

### Does this need a service account, and is that free?

Yes to a service account, and yes it is free: Firebase Console → ⚙️ **Project settings** →
**Service accounts** → *Generate new private key*. Service-account keys are a Google Cloud IAM
feature and are not gated behind billing; the Blaze gate applies to Cloud Functions, Cloud Run,
BigQuery and friends.

**If that button is unavailable or greyed out on your project, use Option A instead** — it needs no
service account and reaches the same security end state. Both rulesets close the same hole.

### Steps

**1.** Console → Project settings → Service accounts → *Generate new private key*. Save it
**outside the repo**, e.g. `~/.voltsense/service-account.json`. It is a full-admin credential.

**2.** Mint:

```bash
FIREBASE_SERVICE_ACCOUNT=~/.voltsense/service-account.json \
  npm run mint-token -- AA:BB:CC:DD:EE:FF
```

Verify the JWT assembly at any time without credentials:

```bash
npm run mint-token -- --selftest     # 10 assertions, including signature verification
```

**3.** Flash `ProvisionToken.ino` and paste the **ID token** and **refresh token** (skip the email
and password fields with `-`).

**4.** Flash `VoltSense.ino` — it should print `Device identity loaded (custom token with
device_mac claim).` The device appears in Console → Authentication → Users as
`device:AA:BB:CC:DD:EE:FF`.

**5.** `npm run rules:strict && npm run deploy:rules`

**6.** Verify as in Option A step 7.

---

## How it works on each side

**Minting** (`scripts/mint-device-token.mjs`) — builds the JWT (`iss`/`sub` = service-account email,
`aud` = Identity Toolkit, `uid` = `device:<MAC>`, `claims.device_mac` = MAC), signs it RS256 with
the service-account private key, then POSTs it to `accounts:signInWithCustomToken` to get a real ID
token and refresh token. **No dependencies** — `node:crypto` only, rather than ~40 MB of
`firebase-admin`.

**Firmware** (`esp32/VoltSense/VoltSense.ino`) — loads whichever credentials are in NVS and hands
them to the Firebase library, which keeps the session fresh automatically. If authentication doesn't
complete within 30 s it says so, lists the likely causes, and restarts instead of hanging.

**Rules** — either `auth.uid === root.child('device_uids').child($mac).val()` (Option A) or
`auth.token.device_mac === $mac` (Option B) for the device-writable nodes; ownership
(`users/{uid}/owned_devices/{mac}`) for the user-writable ones.

## Caveats

* **Credentials can be revoked.** Deleting the account (A) or revoking the refresh token (B) means
  re-provisioning. The device reports this clearly on boot.
* **The service account is the crown jewel** (Option B only). Never commit it, never ship it to the
  browser.
* **ID tokens are ~1.2 KB**, which is why `ProvisionToken.ino` raises `Serial.setTimeout(20000)` —
  the default 1 s read timeout truncates them.
* **The MAC is the device's identity.** Changing it means minting/registering a new identity and
  re-pairing.

## Option C — claim-code pairing (recommended above ~10 units)

Options A and B both assume **you are holding the device** — either clicking through the Console or
running a mint command while a USB cable is attached. That does not scale: at 100 units it is 100
Console sessions. Option C removes the per-unit human step from *your* side and moves it to the
*end user*, who only has to type eight characters.

### The idea

The device is born knowing two things, and only two:

1. **Its MAC** — read from eFuse, so "I am `AA:BB:CC:DD:EE:FF`" is a claim only real hardware can
   make. It cannot be forged by a script.
2. **A factory pairing key** — the *same* string in every unit, burned in at flash time. It is not
   secret per device; it is a filter that says "this is our hardware".

That key buys exactly one thing: the right to `POST /api/pair`. It buys **no** access to any device's
data. In exchange the server issues the device its own unique `device_email`, `device_password` and
`alert_secret`, and returns a short **pairing code**.

The user opens the app, taps *Add device*, and types the code. That is the whole flow.

```
   factory            device (first boot, Wi-Fi up)              your server            app
      │                          │                                   │                  │
      │  flash: MAC (eFuse)      │                                   │                  │
      │  + pairing key (NVS)     │                                   │                  │
      ├─────────────────────────►│                                   │                  │
      │                          │  POST /api/pair                   │                  │
      │                          │  {pairing_key, mac, fw}           │                  │
      │                          ├──────────────────────────────────►│                  │
      │                          │                                   │ verify key (ct)  │
      │                          │                                   │ rate-limit/MAC   │
      │                          │                                   │ upsert Auth user │
      │                          │  {device_email, device_password,  │                  │
      │                          │   alert_secret, pairing_code}     │                  │
      │                          │◄──────────────────────────────────┤                  │
      │                          │  save to NVS, print "A1B2-C3D4"   │                  │
      │                          │                                   │                  │
      │                     user reads code off the device ──────────┼─────────────────►│
      │                          │                                   │  POST /api/claim │
      │                          │                                   │  Bearer <ID tok> │
      │                          │                                   │◄─────────────────┤
      │                          │                                   │ transaction on   │
      │                          │                                   │ devices/MAC/owner│
      │                          │                                   │─────────────────►│
```

### Why it is safe

| Attack | Why it fails |
| --- | --- |
| Someone guesses a MAC and self-attaches | `/api/claim` requires a **live pairing code**, which only the device printed. There is no path that accepts a bare MAC. |
| Someone brute-forces pairing codes | 8 chars from a 31-symbol alphabet (~40 bits), **30-minute expiry**, and the code is deleted on first successful claim. |
| A unit boot-loops to farm credentials | `/api/pair` rate-limits per MAC: one attempt per 60 s, max 10/hour. |
| Any signed-in user reads live codes from the DB | Codes live **only** in `pairingCodes/<CODE>`, a node with `.read: false` in every rules variant. There is deliberately *no* copy under `devices/<MAC>` — the `scoped` ruleset exposes `devices/<MAC>` to any authenticated principal, so a copy there would be a harvestable list. |
| Re-pairing steals a device from its owner | `/api/pair` **never** writes `owner`, `owned_devices`, or `pairing/claimed_*`. Ownership is changed only by `/api/claim`, after a verified human presents a code, and then inside a transaction. A factory reset re-homes a device only if nobody owns it. |
| Two people claim at once | `/api/claim` resolves ownership in a single RTDB `.transaction()`; the loser aborts and gets HTTP 409. |
| The factory key leaks from the firmware | It is the lowest-value secret in the system: it grants no data access, only the ability to *ask* for credentials. Worst case is a flood of junk device accounts, which rate limiting bounds. |

### What the user experiences

1. Power the unit. It joins Wi-Fi (captive portal `VoltSense_Setup` if it has no creds) and, if it has
   no identity, provisions itself.
2. Its serial monitor prints a banner with the code, e.g. `PAIRING CODE: A1B2-C3D4`.
3. In the app: **Add device** → type the code → done. The device appears via the live
   `useUserDevices` subscription; no refresh needed.

For a device to display the code on an OLED/LCD or a QR sticker is a pure firmware addition — the
server contract does not change.

### Re-pairing / returns

Holding **GPIO 0 for 5 s** erases the identity keys in NVS (`dev_email`, `dev_password`, tokens,
`alert_secret`, `pairing_key_used`) while **keeping the Wi-Fi credentials**, then reboots. The unit
provisions itself fresh. Cardboard-box returns work because the new owner simply claims the new code.
Ownership is preserved: the old owner must release it (or you delete it in the Console) before
someone else can claim it.

### Migrating an existing device

Options A and B are unchanged and still valid. A unit with `dev_email`/`dev_password` already in NVS
**skips pairing entirely** — USB provisioning takes priority over pairing, so a hand-provisioned
bench unit is never overwritten. Option C is additive.

### Enabling it

```bash
# 1. Generate a factory key and put it in the Vercel dashboard (never VITE_-prefix it)
openssl rand -hex 32        # -> VOLTSENSE_PAIRING_KEY

# 2. Burn the SAME key into every unit at flash time
#    (platformio.ini / arduino-cli extra flags, or a #define before upload)
-DVOLTENSE_PAIRING_KEY='"<the hex string>"'

# 3. Deploy the endpoints
vercel --prod

# 4. Confirm the rules are the deviceuid variant and deployed
npm run rules:status && npm run deploy:rules
```

If `VOLTSENSE_PAIRING_KEY` is empty on the device, `pairDevice()` is skipped and the firmware falls
back to the existing "no identity" error message — so a misconfigured build cannot silently lock out
a unit that was provisioned over USB.

---

## Recommended extras (all free)* **Delete any leftover `settings/telegram_*` nodes.** They are unreachable now that the rules no
  longer grant access, and the bot token they reference is unused.
* **Turn on Firebase App Check** (reCAPTCHA v3 for web, DeviceCheck/Play Integrity for mobile).
  App Check itself is free and blocks scripted abuse regardless of rules.
* **Keep `VOLTSENSE_ALERT_SECRET` server-side only.** It is a bearer credential for
  `/api/alert` — anyone holding it can send arbitrary notifications to every user of a device.
  Never prefix it with `VITE_`, which would inline it into the public bundle.
* **Restrict the browser API key** in Google Cloud Console to your Vercel and Firebase Hosting
  domains and the Firebase APIs you actually use. The key in `.env` is public by design, but it
  should not be usable from arbitrary origins.
