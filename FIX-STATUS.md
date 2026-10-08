# VoltSense — fix status

**Last verified: 2026-10-08** (gate re-run, live endpoints probed). Earlier revisions of this file
went stale and listed work as open that had since been completed — treat any claim here without a
date as suspect and re-verify.

## Gate (fresh run, 2026-10-08)

```
npm run verify  →  exit 0
  lint ........... 0 warnings, 0 errors
  typecheck ...... 0 errors        (tsc --noEmit, checkJs)
  unit tests ..... 50/50
  build .......... ok
  harness ........ 147/147  (behavioural, mutation-tested)
```

## Fixed — software (all closed)

| ID | Finding | Where |
| --- | --- | --- |
| P0-1 | Alert secret never persisted → alerts 100 % broken for paired devices | `api/pair.js`, `api/alert.js`, `api/_lib/firebaseAdmin.js`, rules |
| P0-2 | Unpair orphaned the device permanently | `api/unpair.js` (new), `src/lib/deviceClaim.js` |
| P0-3 | Current sensing sampled exactly one 50 Hz period | `esp32/VoltSense/VoltSense.ino` (100 ms window) |
| P1-1 | `claimed_by`/`claimed_at` written inconsistently | `api/claim.js` |
| P1-2 | Harness could not detect the P0s (asserted code *existed*) | `verify-fixes.mjs` (36 → 123 behavioural checks) |
| P1-3 | New user saw up to 200 alerts marked unread | `src/hooks/useAlerts.js`, `Alerts.jsx`, `AlertCatchUp.jsx` |
| P1-4 | 0.05 A floor switched off real low-power loads | firmware (split display/shutdown thresholds) |
| P1-5 | All relays energised on every boot | firmware (NVS relay-state mask) |
| P1-6 | Wi-Fi failure caused a reboot loop | firmware (bounded retry) |
| P2-1 | Alert fan-out scanned the whole `users` node | `api/alert.js` + `devices/<MAC>/owners` index |
| P2-2 | Custom date ranges read a node nothing ever wrote | `useHistoryData.js` + firmware `history/days` |
| P2-3 | No tests | `tests/unit.test.mjs`, `npm run verify` |
| P2-4 | Firebase web config hardcoded | `src/lib/firebase.js` |
| P2-5 | Unpair had no error surface | `src/pages/Settings.jsx` |
| P2-6 | Pinned TLS could rot silently | firmware `runConnectivitySelfTest()` |
| P2-7 | `VOLTAGE` hardcoded, no sensing | firmware configurable VA (sensing still hardware) |
| P2-8 | Blocking ADC reads inside the loop | firmware `refreshCurrentCache()` |
| P3-1…5 | Hygiene: debug guard, preview artifact, stale docs, lint warning | various |
| BOM | mmWave kept as a supported, gated pin; ADC1 asserted; ACS712 variant documented | firmware + harness |

### Closed after the original status was written

These were listed as OPEN in the first revision of this file and are now done — the staleness that
prompted the 2026-10-08 rewrite:

| Was open | Now | Evidence |
| --- | --- | --- |
| **No watchdog** | **Armed.** `esp_task_wdt`, 30 s, on loopTask; fed *before* every blocking call (4/4 sites); `reconfigure` used, not `init`. | firmware `watchdogInit()`; harness asserts the pre-feed ordering |
| **No type checking** | **On.** `allowJs` + `checkJs` in `tsconfig.json`; `npm run typecheck` is a gate step. | gate output above |
| **No software overcurrent cutoff** | **Added.** `OVERCURRENT_LIMIT_A 4.50f`, debounced, its own per-port streak, opens the relay with `force=true` so derating cannot suppress a safety trip. | firmware `checkOvercurrent()` |
| **Relay derating never designed in** | **Added.** One choke point (`runRelaySwitch`), per-port 2 s dwell + 6-per-60 s rolling cap; suppressed commands are repaired in the DB. | harness asserts both halves |
| **Not deployed** | **Deployed.** Vercel (front + `/api/*`) and Firebase Hosting, both verified live. | `/sw.js` FCM import present on both; `/api/alert` → 405 GET / 401 bad secret |
| Harness 91/91 | **147/147** | gate output above |

### Also fixed (2026-10-05 second audit pass)

- **Alert `outcome: 'pending'` placeholder removed** — the client `OUTCOME` map has no `pending` key,
  so such a row would have rendered the grey "Recorded" badge, presenting a failed delivery as a
  completed one. Unreachable at the time; now impossible to construct.
- **Alert retention self-heals** — an already-oversized node converged one row per alert (a 1000-row
  node stayed ~1000). Now the excess is cleared in one pass.
- **Write failures reach the user** — `useRoomData` actions return success; the Dashboard shows a
  dismissible error banner and port toggles show pending. Previously every failure was swallowed
  into `console.error`, so a rejected write looked like a slow one — worst on "Keep Power On", where
  a silent failure means the room powers down anyway.
- **Countdown fallback** `?? 60` → `?? 300` (the firmware's real 5-minute window, not the alert text).
- **Alerts page restyled** to match Analytics/Settings (header card), spinner instead of empty-looking
  skeletons, and a mock notification on the no-device state.

## Still open — honest gaps

None of these is broken code, but they are real and unclosed:

| # | Item | Why it is open | Severity |
| --- | --- | --- | --- |
| 1 | **Firmware is not flashed** — and until 2026-10-08 **could not be**: it did not compile | Every firmware fix above (watchdog, overcurrent cutoff, derating, 100 ms window, NVS relay restore, TLS self-test) exists only in source. Until a reflash, the fielded device runs the OLD behaviour. **Now fixed: it builds.** Three separate errors were shipped, each masking the next — an auth API that does not exist in the current library (`config.signer.email`), `enum RelaySwitchResult` defined twice, and a type-ordering problem with the Arduino auto-generated prototypes (fixed with `esp32/VoltSense/VoltSenseTypes.h`). `ProvisionToken.ino` also had a literal-concatenation bug. Build: `arduino-cli compile --fqbn "esp32:esp32:esp32:PartitionScheme=huge_app" esp32/VoltSense` → **47 % of a 3 MB partition, 16 % RAM, no warnings**. | **High** — flash it |
| 2 | ~~Database rules deploy unverified~~ → **VERIFIED 2026-10-08** | Read the LIVE ruleset via `GET <db>/.settings/rules.json` with the Firebase CLI's cached access token. It is a semantic **exact match for `database.rules.json`** (the `deviceuid` variant); it differs from `scoped` and `strict`. **The dangerous `scoped` ruleset is NOT live.** Nothing to do. | ✅ Closed |
| 3 | **Push delivery unproven** | The service-worker fix is deployed and structurally verified, but only a real push arriving with the app swiped closed confirms OS delivery. Needs the phone. See `docs/PUSH-TEST.md`. | Medium |
| 4 | **Occupancy alert says "60 seconds"** | The firmware's real response window is 5 minutes (`RESPONSE_WINDOW_MS = 300000`). Copy defect only — the shutdown timing is correct. Needs a reflash. | Low (cosmetic, but misleading) |
| 5 | **Three settings have no UI** | `inactivity_limit_minutes`, `overcurrent_limit_a`, `nominal_voltage` are honoured by the firmware but writable only from the RTDB console. Anything set for testing persists silently. | Medium |
| 6 | ~~No git repository~~ → **DONE 2026-10-08** | Repo `kicode01/voltsense-iot` (public), `main`, and **CI is live and green**. Pushing `.github/workflows/*` needs the `workflow` OAuth scope. CI needs the 8 `VITE_FIREBASE_*` repo secrets, with a guard step so a missing one fails at the cause. | ✅ Closed |
| 7 | **`vercel.json` `memory: 256`** | Vercel warns it is ignored on Active CPU billing. Harmless; remove the key to silence it. | Trivial |
| 8 | **No voltage sensing — FIRMWARE READY, hardware not fitted** | The ACS712 is a *current* sensor, so on the shipped build power is VA, not W, and off by 1/PF for SMPS/motor loads. The **voltage-sense path is now implemented and tested**, gated behind `HAS_VOLTAGE_SENSE` (ships off). Fitting a ZMPT101B + calibrating is all that remains: `docs/VOLTAGE-SENSING.md`. | Medium (until the sensor is fitted) |
| 9 | **Physical fuse — group HAS them; not yet fitted/verified** | The software cutoff is explicitly **not a fuse**: the ACS712 saturates at 5 A, and a welded relay contact cannot be opened in software. A 5 A sensor on 230 V is ~1.15 kW per port. The group has fuses; **confirm they are 5 A max, 250 VAC, ceramic (not glass), time-lag, one per port, in the live conductor upstream of the relay** — see `docs/HANDOFF.md` §1.1. A different rating/type is not equivalent. | **High — safety** (until verified) |
| 10 | **Mains isolation / creepage unverified** | Cannot be assessed from source; needs the schematic and the physical board. | **High — safety** |
| 11 | **Battery / thermal design** | Never designed in; out of scope for a prototype. | Low |
| 12 | **Shutdown rule is inverted for this device's loads** | Intended loads are phone/laptop chargers, fans, lamps. `currentIsFlowing` (0.10 A ≈ 23 W) infers *intent* from *current*, so **an incandescent lamp or large fan is kept ON in an empty room** (the waste the product exists to remove) while **a phone on a 5 W charger is CUT** mid-charge. No threshold fixes this — a 40 W lamp and a 40 W charger are electrically identical. Full analysis: `docs/LOAD-POLICY.md`. | **Medium–High** (core behaviour) |
| 13 | **No per-port policy** | Proposed: `Occupancy` (cut — **default**), `Always on` (never cut), `Keep while drawing` (present behaviour, opt-in). Also note `Keep while drawing` as built does **not** re-check after shutdown, so it never notices charging finishing. | Medium |
| 14 | **`override` ("Keep Power On") is one-shot** | Deliberate: it resets the idle timer and clears its own flag, so it buys one more window rather than being a persistent mode. There is no way to say "leave this room alone". | Low–Medium |

## Before you rely on it

1. **Confirm the live database rules** (console → Realtime Database → Rules). This is the one gap
   that could be silently wrong right now.
2. **Reflash the ESP32** — no firmware fix is live until you do.
3. **Run the real push test** with the app closed (`docs/PUSH-TEST.md`).
4. **Fit a fuse per port** and treat the software cutoff as a convenience, not protection.
5. **Verify isolation/creepage physically** with the schematic in hand.
6. Confirm the **ACS712 variant** (5 A / 185 mV·A⁻¹ default) against your parts.
7. `git init` + a remote, if you want the CI gate to actually run.

## See also

- `docs/INTEGRATION-AUDIT.md` — full integration audit + §6 (second pass)
- `docs/HARDWARE-BRINGUP.md` — ordered bring-up and acceptance test
- `docs/PUSH-TEST.md` — the only test no computer can do for you
- `docs/PROJECT-RULES.md` — the rules index
