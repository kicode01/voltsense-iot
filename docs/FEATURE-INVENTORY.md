# Feature ↔ hardware inventory, and every known gap

Built from the source, 2026-10-08. Two directions matter: **does each software feature have the
hardware it needs**, and **does each piece of hardware have software that uses it**. Gaps hide in the
space between.

---

## 1. Software features → what hardware they need

| # | Feature | Where | Hardware it needs | Works without? |
|---|---|---|---|---|
| 1 | Occupancy detection | firmware | **PIR** (GPIO 22); mmWave optional | ✅ PIR alone |
| 2 | Occupancy state machine | firmware | the above | ✅ |
| 3 | Relay switching, 3 ports | firmware + app | **relay module** (23/21/19) | ❌ |
| 4 | Relay derating (dwell + rate) | firmware | — (software only) | ✅ |
| 5 | Per-port current sensing | firmware + app | **3× ACS712** (34/35/32) | ❌ reads 0 A |
| 6 | Soft overcurrent cutoff | firmware | the above | ❌ |
| 7 | **Voltage sensing / real power** | firmware + app | **ZMPT101B** (33), gated off | ✅ falls back to VA |
| 8 | Energy accounting (kWh, daily) | firmware + app | current sensors | ⚠️ computes VA-hours without voltage |
| 9 | Night mode (schedule) | firmware + app | — | ✅ |
| 10 | Override ("Keep Power On") | firmware + app | relays | ✅ |
| 11 | Alerts → push | firmware + API + app | network only | ✅ |
| 12 | Self-pairing | firmware + API | network only | ✅ |
| 13 | USB provisioning | ProvisionToken | USB | ✅ |
| 14 | Watchdog | firmware | — | ✅ |
| 15 | TLS self-test at boot | firmware | network | ✅ |
| 16 | Factory reset (BOOT hold) | firmware | the button | ✅ |
| 17 | Relay state persistence | firmware | NVS (on-chip) | ✅ |
| 18 | Time sync (NTP) | firmware | network | ✅ |
| 19 | Login / claim / unpair | app + API | network | ✅ |
| 20 | Dashboard / Analytics / Alerts | app | a paired device to be useful | ✅ (demo mode) |
| 21 | PWA + background push | app | a phone, installed | ✅ |

## 2. Hardware → software that uses it

| Part | Software support | Gap |
|---|---|---|
| **ESP32** | everything | — |
| **HC-SR501 PIR** | GPIO 22, primary occupancy | — |
| **mmWave radar** | pin declared (GPIO 4), read **gated off** | ⚠️ **only the presence bit is used.** The LD2410's UART gives distance + stationary/moving energy — the data that actually separates a person from a fan. All of it is discarded. |
| **3× ACS712** | current, overcurrent, energy | — |
| **3-ch relay** | switching, derating, state restore | ⚠️ polarity assumption unverified (firmware assumes HIGH = energised; most modules are active-LOW) |
| **ZMPT101B** | full true-power path, gated off | ⚠️ measured `voltage` is published but **never displayed** (see 3.3) |
| **Fuses** | — (passive) | none needed; spec in `HANDOFF.md` §1.1 |
| **5 V supply** | — | — |

---

## 3. Every known gap

### 3.1 Firmware honours the setting, but there is no UI to change it

Four settings are read by the firmware and can only be set from the RTDB console. Anything changed
there **persists silently** — there is no screen to see it or put it back.

| Setting | Firmware effect | Consequence of having no UI |
|---|---|---|
| `settings/inactivity_limit_minutes` | idle window before the alert | User cannot tune how quickly the room is considered empty |
| `settings/overcurrent_limit_a` | trip threshold | User cannot tune protection for their loads |
| `settings/nominal_voltage` | the voltage used when no sensor is fitted | Every power figure is wrong by the ratio to the real supply |
| `settings/voltage_cal_mv_per_v` | voltage-sensor calibration divisor | **Calibration requires a console.** The app cannot do it |

### 3.2 The app writes it, the firmware ignores it

| Key | Written by | Firmware reads it? | Effect |
|---|---|---|---|
| `ports/<id>/name` | Dashboard rename | ❌ never | Cosmetic only — the label lives in the app |
| `ports/<id>/icon` | Dashboard icon cycle | ❌ never | Cosmetic only |

These are **not bugs** — the names and icons are presentation. But they are writes that look like
configuration and change nothing on the device, which is worth knowing before debugging them.

### 3.3 The firmware publishes it, the app ignores it

| Key | Published by | Used by app? | Why it matters |
|---|---|---|---|
| `ports/<id>/voltage` | firmware | ❌ **never** | **The measured mains voltage is invisible.** This is the number calibration compares against — so calibration needs the console even though the device is measuring it |
| `overcurrent_limit_a` | firmware | ❌ never | The app cannot show the trip threshold it is actually enforcing |
| `night_mode_active` | firmware | ❌ never | The app shows the *schedule*; it cannot show whether night mode is in effect **right now** |
| `is_occupied` | firmware | ❌ never | The Dashboard infers occupancy from relay state instead |
| `total_current_amps` | firmware | ❌ never | Dashboard uses `total_power_watts` only |
| `power_va` | firmware | ❌ never | Published for comparison; the UI shows `power_watts` + `power_factor` |

### 3.4 Behavioural defects

| # | Defect | Impact |
|---|---|---|
| 1 | **Shutdown rule is inverted for the intended loads.** `currentIsFlowing` (0.10 A ≈ 23 W) keeps a port on when it draws current — so an **incandescent lamp or large fan stays ON in an empty room**, while a **phone on a 5 W charger is CUT**. After `STATE_SHUTDOWN` nothing re-checks, so a kept port stays on indefinitely. | **High** — defeats the product's purpose. `docs/LOAD-POLICY.md` |
| 2 | **No per-port policy.** No way to say "always keep this socket on" (router, fridge) or "always cut this one" (lamp). | Medium |
| 3 | **`override` is one-shot.** Deliberately resets the idle timer and clears its own flag, so it buys one more window, not a persistent mode. | Low–Medium |
| 4 | **Occupancy alert says "60 seconds"**; the window is 5 minutes. | Low (misleading copy) |
| 5 | **`Keep while drawing` never notices charging finishing** — nothing re-checks after shutdown. | Low |

### 3.5 Cannot be verified without the hardware

| # | Item | Why |
|---|---|---|
| 1 | **The firmware has never run.** It compiles now (fixed 2026-10-08) but has never executed on a device. | No board |
| 2 | **Push delivery unproven** — needs a real alert with the app closed. | Needs a phone |
| 3 | **Voltage calibration unproven** — the default `4.60 mV/V` is a guess. | Needs a multimeter and mains |
| 4 | **Relay polarity unverified** — the firmware assumes HIGH = energised. | Needs the board |

### 3.6 Security

| # | Item | Status |
|---|---|---|
| 1 | **The production pairing key was committed to a public repo.** Removed from source, but it is in git history and **remains valid until rotated in Vercel**. | ⚠️ **Outstanding — owner action** |
| 2 | Live database rules | ✅ Verified == `deviceuid` (2026-10-08) |
| 3 | Firebase web API key | Public by design, but unrestricted — add referrer + API restrictions in Google Cloud Console |

---

## 4. The interface contract (RTDB key map)

For reference — what crosses the boundary in each direction.

| Direction | Keys |
|---|---|
| **App → device** | `settings/night_mode_enabled`, `night_mode_start`, `night_mode_end`; `override`; `ports/<id>/relay_status` |
| **App → device (inert)** | `ports/<id>/name`, `ports/<id>/icon` |
| **Device → app** | `state`, `countdown_remaining_seconds`, `inactivity_limit`, `total_power_watts`, `voltage_source`; `ports/<id>/{current_amps, power_watts, power_va, power_factor, energy_kwh, voltage, relay_status}` |
| **Device → app (inert)** | `is_occupied`, `night_mode_active`, `overcurrent_limit_a`, `total_current_amps` |
| **Console-only → device** | `settings/inactivity_limit_minutes`, `overcurrent_limit_a`, `nominal_voltage`, `voltage_cal_mv_per_v` |
| **API → device** | `devices/<MAC>/alert_secret_hash`, `device_uids/<MAC>`, `pairingCodes/<code>` (all server-written) |

---

## 5. Summary

- **Software features needing hardware: 7.** All are supported; two are gated off until the part is
  fitted (voltage sensing, mmWave).
- **Hardware with no software support: none** — but the **mmWave is still under-used** (presence bit only; its distance/energy data is discarded). The **ZMPT101B is now fully used**: real power *and* its measured voltage are surfaced in the app.
- **Gaps, as originally listed: 4 console-only settings, 2 inert writes, 6 ignored outputs, 5 behavioural defects, 4 hardware-unverifiable items, 1 outstanding security action.**

**Closure status (2026-10-08):** the software-side gaps are now closed in code — see §6. What remains open is by-design (the 2 inert writes), hardware-unverifiable (4 items), or an owner action (the 1 security item: rotate the committed pairing key in Vercel).

## 6. Closure log (2026-10-08)

These were open in §3 and are now fixed in firmware + app, each gated by a mutation-tested harness assertion.

| Gap | Fix | Where |
|---|---|---|
| §3.1 — 4 console-only settings | Settings → "Device limits" writes them via `update()` (never `set`, so siblings survive) | `src/pages/Settings.jsx`, `useRoomData.updateDeviceSetting` |
| §3.3 — `ports/<id>/voltage` ignored | Per-port measured voltage shown when a sensor is fitted (`powerIsMeasured`) | `src/pages/Dashboard.jsx` |
| §3.3 — `overcurrent_limit_a` ignored | Shown as the editable "Overcurrent trip" field | `src/pages/Settings.jsx` |
| §3.3 — `night_mode_active` ignored | Dashboard shows "Active now" / "Not active" | `src/pages/Dashboard.jsx` |
| §3.3 — `is_occupied` ignored | Occupancy badge uses the device's real occupancy, not relay state | `src/pages/Dashboard.jsx` |
| §3.4 #1 — inverted shutdown rule | Per-port **policy**: `occupancy` (cut, default) / `always_on` / `keep_while_drawing` | firmware `shouldKeepPortOnShutdown`, Settings policy `<select>` |
| §3.4 #2 — no per-port policy | same as above | firmware stream handler + snapshot + telemetry |
| §3.4 #4 — alert said "60 seconds" | Countdown text derived from `RESPONSE_WINDOW_MS` (5 min) | firmware alert body, Dashboard fallback `?? 300` |
| §3.4 #5 — `keep_while_drawing` never re-checks | `SHUTDOWN_RECHECK_MS` releases the port once charging finishes | firmware `STATE_SHUTDOWN` re-check |

**Not changed (by design):** §3.2 name/icon writes are cosmetic and intentionally device-ignored. **Still open:** §3.5 (needs the hardware to flash/verify) and §3.6 #1 (rotate the pairing key in Vercel — see `FIX-STATUS.md`).
