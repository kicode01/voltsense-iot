# Deploying VoltSense to Vercel — what to create and what to paste

There are **three separate places** involved, and they are easy to confuse. Getting them straight is
most of the work:

| # | Where | What it holds | Why it exists |
| --- | --- | --- | --- |
| 1 | **Vercel** | The web app + the 4 API functions + the **server secrets** | Runs your backend |
| 2 | **Firebase** | Auth + Realtime Database + the database **rules** | Stores all data |
| 3 | **The ESP32** | Wi-Fi (via captive portal), the pairing key, its own credentials | The physical device |

Vercel does **not** replace Firebase, and Firebase does not host your app. They do different jobs.

```
   Browser  ──►  Vercel (static app in dist/ + /api/* functions)  ──►  Firebase RTDB
                        ▲                                                      ▲
                        └────────────  ESP32 (telemetry, /api/alert, /api/pair) ┘
```

---

## Step 1 — Create the Vercel project

1. Sign in at [vercel.com](https://vercel.com) (the free Hobby plan is enough).
2. **Add New → Project**. You can either connect a Git repo **or** skip Git entirely and deploy with
   the CLI, which is what this project does today.
3. Framework preset: **Vite**. `vercel.json` already sets this, plus the build command, the output
   directory, the function memory/timeout and the SPA rewrites — **do not change those by hand.**
4. Note your project's URL. It will be either:
   - `https://voltsense-iot.vercel.app` (if the project name is `voltsense-iot`), or
   - something like `https://voltsense-iot-abc123.vercel.app`

   ⚠️ **Check this.** The firmware has the URL hardcoded in two places:
   `ALERT_URL` and `PAIR_URL` in `esp32/VoltSense/VoltSense.ino` (around lines 149 and 169). If your
   real URL differs, you **must edit those two lines** and reflash, or the device will silently fail
   to send alerts and will never pair.

### Deploying without git

```bash
npm install -g vercel      # once
vercel login
npm run deploy:vercel      # = vercel --prod
```

The CLI uploads the files directly. No repo needed — this is the option you chose.

---

## Step 2 — Paste the environment variables into Vercel

**Vercel dashboard → your project → Settings → Environment Variables.**

There are exactly **five**, and the code reads them by these exact names. Add each one to
**Production** (and Preview if you want preview deploys to work):

| Name | What to paste | Where to get it |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | The service-account JSON, **flattened to one line** | Firebase Console → ⚙ Project settings → **Service accounts** → *Generate new private key* |
| `FIREBASE_DATABASE_URL` | `https://voltsense-iot-default-rtdb.<region>.firebasedatabase.app` | Firebase Console → Realtime Database → the URL at the top |
| `VOLTSENSE_ALERT_SECRET` | Any long random string | Generate below |
| `VOLTSENSE_PAIRING_KEY` | Any long random string (**different** from the one above) | Generate below |
| `VOLTSENSE_AUTH_DOMAIN` | *(optional)* only if you use a custom auth domain | Leave unset otherwise |

Generate the two secrets:

```bash
openssl rand -hex 32     # VOLTSENSE_ALERT_SECRET
openssl rand -hex 32     # VOLTSENSE_PAIRING_KEY  (run twice — they must differ)
```

Flatten the service account to a single line:

```bash
jq -c . serviceAccountKey.json
# then paste the whole output as the value. Keep the surrounding double quotes.
```

### Three rules that matter

1. **Never prefix any of these with `VITE_`.** Anything `VITE_`-prefixed is compiled into the public
   browser bundle — your service-account private key would be downloadable by anyone.
2. **`VOLTSENSE_PAIRING_KEY` must be identical in two places.** Paste it into Vercel *and* burn the
   same string into the firmware at flash time (`-DVOLTSENSE_PAIRING_KEY='"<hex>"'`). If they differ,
   pairing returns 401 forever.
3. **After adding or changing a variable you must redeploy.** Vercel injects env vars at build/deploy
   time; an already-running deployment will not pick them up.

---

## Step 3 — The `VITE_*` variables are NOT Vercel's job in this setup

This is the part that usually trips people up.

The app's Firebase web config lives in **`.env` in the project folder** (for local `npm run dev`) and
is baked into the bundle **at build time**. Because you're deploying from your own machine with the
CLI, `npm run build` reads your local `.env` and the resulting `dist/` already contains those values.

So:

- **Do not** paste the `VITE_*` values into Vercel. They are not read at runtime by the functions.
- **Do** make sure `.env` is present and correct on the machine you build from.
- The API functions only read the five names in Step 2.

(If you ever switch to building *on* Vercel from a Git repo, then the `VITE_*` values **do** need to be
in Vercel — because Vercel would run the build itself. That's the only case where they're needed.)

---

## Step 4 — Firebase side (one-time)

Deployed separately from Vercel:

```bash
npm run rules:status     # confirm which ruleset is active
npm run deploy:rules     # pushes database.rules.json
```

Also one-time, in the Firebase Console:

1. **Authentication → Sign-in method** — enable **Email/Password** (and Google if you use it).
2. **Realtime Database** — the project `voltsense-iot` must exist.
3. For each device identity, an entry under `device_uids/<MAC>` — **Console-only**. It has no client
   `.write` rule anywhere, which is deliberate.

---

## Step 5 — Verify it actually works

```bash
# 1. Anonymous checks: .env present, VAPID present, unauthenticated reads denied
npm run diagnose

# 2. Regression harness — MUST build first, or it validates a stale dist/
npm run build
npm run verify

# 3. Does the live API answer?
curl -i https://<your-url>.vercel.app/api/alert -X POST -H "Content-Type: application/json" -d '{}'
# Expect a 401/400 JSON error — NOT a 404 and not an HTML page.
# A 404 means the function isn't deployed; HTML means the SPA rewrite caught it instead.
```

Then the real end-to-end test: power on a device, confirm it pairs, and make sure an alert actually
arrives on the phone.

---

## Summary — the short version

- **Yes**, you create a Vercel project and deploy. `npm run deploy:vercel`.
- **But** it is not "give it all the APIs". You paste **5 server secrets**, not your Firebase web
  config.
- The `VITE_*` values stay in your local `.env` because *your machine* does the build.
- Firebase and the device still need their own separate setup.
- **Check the two hardcoded URLs in the firmware** against your real Vercel domain.
