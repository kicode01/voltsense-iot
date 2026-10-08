# Load policy — what the device powers, and what the shutdown logic does with it

**Intended loads (stated by the owner, 2026-10-08):** small appliances — phone chargers, laptop
chargers, fans, lamps.

That is a narrower and *lighter* set than the logic was tuned for, and it exposes a real problem.

---

## 1. How the current logic treats each intended load

The selective shutdown keeps a port ON when `currentIsFlowing(i)` is true, where the threshold is
`CURRENT_ACTIVE_THRESHOLD_A = 0.10 A` — **≈ 23 W at 230 V**.

| Load | Typical draw | Current | vs 0.10 A | Kept on when the room is empty? |
|---|---|---|---|---|
| Phone charger, charging | 5–25 W | 0.022–0.109 A | **straddles** | **depends — may cut mid-charge** |
| Phone charger, finished | 0.3–0.5 W | 0.001–0.002 A | below | no (correct — it's done) |
| Laptop charger, charging | 45–90 W | 0.196–0.391 A | above | **yes** |
| Laptop charger, finished | 1–5 W | 0.004–0.022 A | below | no |
| AC fan, small | 20–30 W | 0.087–0.130 A | **straddles** | depends |
| AC fan, large | 45–60 W | 0.196–0.261 A | above | **yes — left running in an empty room** |
| USB fan | 2–5 W | 0.009–0.022 A | below | no |
| LED lamp | 5–15 W | 0.022–0.065 A | below | no |
| **Incandescent lamp** | 40–100 W | 0.174–0.435 A | **above** | **yes — left burning in an empty room** |

## 2. The problem: the rule is inverted for the loads that matter

`currentIsFlowing` infers **intent** from **current**. But drawing current does not mean anyone needs
it. A lamp draws the same current whether or not someone is in the room.

The consequence, for exactly the loads this device is meant to serve:

- **A lamp left on in an empty room is PROTECTED.** It draws above the threshold, so the shutdown
  skips it — and after `STATE_SHUTDOWN` the port stays on indefinitely, because the state machine
  only re-evaluates on motion. This is the single most wasteful case the product exists to prevent,
  and the current logic actively preserves it.
- **A large fan left running is protected**, same reason.
- **A phone charging on a 5 W brick is CUT**, because it sits below the threshold. The legitimate
  unattended load is the one that gets switched off.

So the rule protects the wasteful loads and cuts the useful ones — backwards, for this use case.

### Why this was not obvious before

The rule was written for the general "unattended but legitimate load" case — the comment cites *"a
charging laptop"*. That example is genuinely protected (45–90 W clears the threshold comfortably), so
the logic looks correct on the case it was reasoned about. It only breaks on the loads the device is
actually for.

### Why a threshold cannot fix it

Lowering the threshold would keep phone chargers alive, but it would also keep the LED lamp and the
USB fan alive — and raising it loses the laptop. **There is no single current threshold that separates
"charging" from "forgotten"**, because the difference is *intent*, and intent is not an electrical
quantity. A lamp and a charger at 40 W are electrically identical.

---

## 3. Proposed change: an explicit per-port policy

Stop inferring, and let the user say what each socket is for.

| Policy | Behaviour when the room empties | For |
|---|---|---|
| **Occupancy** (default) | Cut | Lamps, fans — anything that only matters while someone is there |
| **Always on** | Never cut | Router, fridge, anything that must run unattended |
| **Keep while drawing** | Keep while current flows, then cut when it stops | Chargers — the current behaviour, now opt-in |

**Default to `Occupancy`.** The device's purpose is to cut power when the room is empty, so the
default should do that; "always on" is the exception the user grants deliberately. This inverts the
present default, where any drawing load is protected.

**`Keep while drawing` needs a re-check to work properly.** Today the shutdown runs once, at the end
of the response window, and the state machine does not re-evaluate while in `STATE_SHUTDOWN`. So a
port kept on stays on until the room is next occupied and emptied again. For a charger that is
roughly right (it stays until you next use the room), but it is not what the label implies — it does
not notice when charging finishes. A periodic re-check would make it honest.

---

## 4. Other changes noted at the same time

| # | Change | Effort | Status |
|---|---|---|---|
| 1 | **Fix the alert text** — it says *"shut down in 60 seconds"*; the window is **5 minutes** (`RESPONSE_WINDOW_MS = 300000`) | 1 line | Not applied — needs a reflash |
| 2 | **Per-port policy** (§3 above) | Firmware + app | Proposed |
| 3 | **Persistent room-level "keep on"** — `override` is deliberately one-shot: it resets the idle timer and clears its own flag, so it buys one more window, not a mode | Small | Proposed |
| 4 | **Occupancy confidence in telemetry** — publish whether occupancy came from both sensors, radar only, or PIR only | Small–moderate | Proposed |

## 5. What this means for the bring-up

The groupmate's verification should include a **load-behaviour check**, not just a wiring check:

- Put a **lamp** on a port. Let the room go empty. Confirm the port is **cut** (it currently will not
  be, if the lamp is above ~23 W — that is the bug in §2).
- Put a **phone charger** on a port. Let the room go empty. Confirm it is **not** cut mid-charge.

Until §3 is implemented, both of those behave the wrong way round, and the handoff should say so
rather than let someone discover it during a demo.
