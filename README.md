# VoltSense

IoT-based occupancy-driven power monitoring and control. An ESP32 measures a room's load and
occupancy, publishes telemetry to Firebase Realtime Database, and exposes per-port relay control plus
occupancy alerts. A React PWA is the operator surface.

## How it fits together

```
  ESP32 ──telemetry/history/override──► Firebase RTDB ◄──live subscriptions── React PWA
    │                                                                             │
    └──POST /api/alert {secret, mac}──► Vercel ──admin.messaging()──► FCM ──► phone │
                                             ▲                                    │
                                             └── /api/pair, /api/claim (pairing) ─┘
```

Three layers, deliberately separate:

| Layer | Lives in | Talks to |
| --- | --- | --- |
| Device | `esp32/VoltSense/` | RTDB (telemetry), `/api/alert`, `/api/pair` |
| Server | `api/` (Vercel Node functions) | RTDB via Admin SDK, FCM |
| App | `src/` (React 19 + Vite PWA) | RTDB (live reads/writes), `/api/claim` |

**Alerting is device → Vercel → FCM.** The device holds no messaging credential — only an
`alert_secret` in NVS (the server stores only its SHA-256). Recipients resolve from
`devices/<MAC>/owners` (denormalised for O(1) fan-out), with `users/<uid>/owned_devices` as a
fallback; FCM tokens live in `pushTokens/<uid>`, written client-side on login. Every alert is also
recorded to `devices/<MAC>/alerts` (newest 200) with an honest delivery `outcome`, which the Alerts
tab reads.

## Quick start

```bash
npm install
cp .env.example .env      # fill in the Firebase web config + VAPID key
npm run dev
```

Server-side values (`FIREBASE_SERVICE_ACCOUNT`, `VOLTSENSE_ALERT_SECRET`, `VOLTSENSE_PAIRING_KEY`,
`FIREBASE_DATABASE_URL`) belong in the **Vercel dashboard**, never in `.env` — and never
`VITE_`-prefixed, which would inline them into the public browser bundle.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run lint` | oxlint (clean) |
| `npm run typecheck` | `tsc --noEmit` — type-checks the `.js`/`.jsx` sources via `checkJs` (no renaming to `.ts`) |
| `npm run test` | Unit tests (`node --test`) — pure logic + config drift |
| `npm run verify` | E2E gate: `lint && typecheck && test && build && test:integration` |
| `npm run test:integration` | Behavioural regression harness — 123 checks against `dist/` (build first!) |
| `npm run diagnose` | Tests software → database over REST, no ESP32 needed |
| `npm run icons` | Regenerates every app icon from `public/logo-square.svg` |
| `npm run rules:status\|scoped\|deviceuid\|strict` | Switch which ruleset `database.rules.json` copies |
| `npm run deploy:rules` | Push database rules to Firebase |
| `npm run deploy:vercel` | Deploy the app + serverless functions |
| `npm run mint-token` | Mint a `device_mac` custom token (identity Option B) |

## Documentation

- **`docs/PROJECT-RULES.md`** — the hard rules (each learned the hard way): deploy topology, the
  alert/pairing contract, firmware runtime safety, RTDB conventions, and the verification harness.
- **`docs/WHAT-TO-INPUT.md`** — every value to enter, in order, and how to test each step.
- **`docs/device-auth.md`** — device identity design: Option A (uid allow-list), B (`device_mac`
  claim), and C (claim-code pairing, recommended past ~10 units).
- **`BUG-AUDIT.md`**, **`FIXES.md`** — historical audit + fix ledger.

## Continuous integration

`.github/workflows/verify.yml` runs the same gate as `npm run verify` on every push and pull request
(lint → typecheck → unit tests → build → integration harness), installing Chromium for the harness.

> **Prerequisite:** this project is not currently a git repository and has no GitHub remote, so the
> workflow does nothing until the code is pushed. It is committed so the gate is in place from the
> first commit rather than bolted on after a regression.

The gate is **not fully strict** by design — see the notes in `tsconfig.json` and
`docs/PROJECT-RULES.md` → Verification for why two `strict`-family options are off while the rest stay
on to catch real defects.

## Device provisioning

A factory-fresh unit holds only its MAC and a shared factory key. The key buys exactly one thing:
the right to call `POST /api/pair` and be issued unique credentials. The device then prints a short
pairing code that the user types into the app, which claims ownership. Full design and threat model
in `docs/device-auth.md` (§ Option C).

## Project conventions worth knowing

- **Not a git repo.** Dead files are moved to `.workbuddy-ai/removed/`, never deleted.
- **Hosting serves `dist/`** — always `npm run build` before deploying.
- Icons are **generated**, never hand-edited; change `public/logo-square.svg` and re-run `npm run icons`.
- The manifest is owned solely by `vite-plugin-pwa`; never hand-write a second `<link rel="manifest">`.
- Firmware has **no Wi-Fi constants** — WiFiManager's captive portal (`VoltSense_Setup`) handles it,
  with credentials persisting in NVS.
