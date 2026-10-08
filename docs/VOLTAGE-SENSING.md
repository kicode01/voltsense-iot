# Voltage sensing — fitting, calibrating and trusting the real-power path

This is the procedure for adding an AC voltage sensor so the device reports **real power (W)** and a
**measured power factor** instead of estimating **apparent power (VA)**.

The firmware for this is already written and tested. It ships **disabled**, and enabling it is a
one-line change — but only after the hardware is wired and calibrated. Read the whole page before
starting; step 2 is the one that can destroy a pin.

---

## Why this exists — the VA vs W problem

An ACS712 is a **current** sensor. With no voltage channel, power is computed as:

```
I_rms × (a configured nominal voltage)     ->  APPARENT power, in VA
```

That is not the same as real power. The two differ by the power factor:

```
W = VA × PF
```

For a purely resistive load (a heater) PF ≈ 1 and the two agree. For a laptop brick, a charger, or
any switch-mode supply, PF commonly sits at **0.5–0.7** — so the real draw is **30–50 % lower** than
the apparent figure. Those are exactly the loads this device exists to monitor, which is why the UI
labels the number VA and why the kWh totals are not billing-grade.

With a voltage channel the firmware computes:

```
W = mean( v(t) × i(t) )     over a whole number of mains cycles
```

This is what a true energy meter does. It is **not** the same as `V_rms × I_rms` — that would still
be VA. The sample-by-sample product is what captures the phase relationship, because when voltage
and current are out of phase the product goes **negative** for part of each cycle, and averaging
picks that up. Multiplying two RMS values throws the sign away and can never give W.

Power factor then falls out for free: `PF = W / VA`, **measured** rather than assumed.

---

## 1. Hardware

| Item | Notes |
|---|---|
| AC voltage sensor | ZMPT101B module, or any isolated transformer-based AC voltage sensor |
| Pin | `VOLTAGE_SENSE_PIN` = **GPIO 33** (ADC1) |
| Supply | 5 V for the module's op-amp; **share ground with the ESP32** |

**Why GPIO 33.** ADC1 is GPIO 32–39 and the three ACS712s already occupy 34, 35 and 32, leaving 33,
36 and 39. GPIO 33 is a normal I/O; 36 and 39 work but are input-only with no pull-ups. The harness
asserts the pin is on ADC1 and collides with nothing.

**Why ADC1 specifically.** ADC2 is unusable while Wi-Fi is up — `analogRead` returns 0. A voltage
channel on ADC2 would read **0 V**, and since power is a product, every port would report **0 W**
while looking perfectly healthy. Worse than no sensor.

### 1.1 Identify what you actually have — the answer forks here

"AC voltage sensor" covers several different things, and **only some of them can produce real
power.** Work out which one you have before wiring anything.

| What you have | Output | Real power (W)? |
|---|---|---|
| **ZMPT101B module** (transformer + op-amp + gain pot) | AC waveform, biased to mid-rail, ~0–5 V, amplitude adjustable | ✅ **Yes** — the path this document describes |
| **AC-AC adapter** (e.g. a 9 V AC wall wart) | Scaled AC sine | ✅ Yes — needs a divider + bias |
| **Module with a DC output** ("voltage sensor" giving a steady DC level) | DC ∝ V_rms | ❌ **No — VA only.** See below |
| **PZEM-004T or a complete energy-meter module** | UART (serial), gives V, I, W, PF, kWh directly | ✅ Yes — but a **different integration** (see §1.2) |
| **Resistive divider** off the mains | Scaled AC waveform | ⚠️ Technically yes, but **NOT ISOLATED — do not use** |

**The DC-output type is the trap.** It reports a number that looks like voltage and even makes the VA
figure more accurate, but it has already thrown away the waveform — and `mean(v·i)` needs the
waveform. You cannot recover power factor from a DC level. Fitting one of these and expecting watts
is the most likely way this project reports VA while believing it reports W.

**How to tell them apart without a datasheet.** Power the module (its own supply, input not
connected to mains yet) and measure the output:

- Reads **~0 V on AC volts but a steady DC value** → **DC-output type**. VA only.
- Reads a **plausible AC voltage**, with a DC offset of about half the supply → **AC-waveform type**.
  The full path works.

**⚠️ Resistive dividers are not isolated.** Without a transformer there is no galvanic isolation, so
the ESP32's ground becomes mains-referenced — touching the board can kill you. If what you have is a
bare divider, do not connect it. This is not a calibration problem; it is a safety one.

### 1.2 If it's a PZEM-004T or a complete meter module

Different device, different integration. Those modules measure voltage, current, real power and
power factor **internally** and report them over **UART** — so the ESP32 never touches the mains
waveform at all.

That is a legitimate and arguably better approach: it sidesteps the ADC limitations (noise, sample
rate, the 3.3 V scaling problem) and the calibration burden entirely. But **none of the firmware in
this repository supports it** — the voltage-sense path here is ADC-based and reads a raw waveform.
Using a PZEM would be a new integration (a second UART plus a protocol library), not a
configuration change.

If that is what you have, stop and say so rather than wiring it to GPIO 33.

### ⚠️ The 3.3 V trap — read this before wiring

The common ZMPT101B module runs its op-amp from **5 V**, so its output can swing to roughly 5 V
peak-to-peak around a mid-rail bias. **The ESP32's ADC pins are not 5 V tolerant.** Feeding that in
will damage the pin.

You need the signal scaled and biased so it fits:

- **Range:** 0 – 3.3 V, with the mid-point around **1.65 V**
- **Bias:** the output is bipolar AC, but the ADC only reads positive voltages — so it must be
  biased to mid-rail, and the firmware removes that bias in software
- **Headroom:** aim for a peak around 1.5 V so mains transients do not clip

Trim the module's potentiometer (or add a divider) to achieve this, and **verify with a meter
before connecting the ESP32.**

### Isolation

The ZMPT101B is transformer-isolated, which is the right choice — but this is still mains potential
being brought onto your board. It raises the stakes on the **mains isolation / creepage** item that
was already unverified in this project. See `FIX-STATUS.md`. A physical fuse remains mandatory and
is unrelated to anything in this document.

---

## 2. Enable the firmware path

In `esp32/VoltSense/VoltSense.ino`:

```cpp
// #define HAS_VOLTAGE_SENSE       // uncomment ONLY when the sensor is physically wired AND calibrated
```

Uncomment, reflash. That single line switches the sampling method, the telemetry fields and the UI
unit label.

**Why it ships closed.** An unwired ADC pin **floats**, and a floating ESP32 input reads induced
noise. Here that noise would be treated as a voltage and **multiplied into every current reading** —
producing confident, plausible, entirely fictional wattages. A wrong number that looks right is the
most dangerous kind of wrong. Same reasoning as `HAS_MMWAVE`.

---

## 3. Calibrate — do not skip this

The module's transfer function is set by a potentiometer and is **not a calibrated measurement**. An
uncalibrated scale multiplies **every** wattage by the same constant, silently.

1. Measure the real mains voltage at the socket with a **multimeter**.
2. Read what the device reports for `voltage` (Dashboard, or `ports/port_01/voltage` in the RTDB).
3. Correct `settings/voltage_cal_mv_per_v` until they agree:

```
new_cal = current_cal × (reported_voltage / multimeter_voltage)
```

The setting is **range-bounded to 1–20 mV/V** and persisted to NVS, so it survives a reboot. The
bound is load-bearing rather than tidy: the value **divides** into every voltage reading, so a typo
like `460` instead of `4.6` would scale the whole system down by 100× and every wattage with it.

The default is `4.60 mV/V`, which suits a module trimmed to swing ~1.06 V RMS at 230 V. Treat it as
a starting point, not an answer.

**You can calibrate with nothing plugged in.** The firmware takes a standalone voltage reading at
most every 5 s when every port is off, precisely so calibration does not require a load.

---

## 4. Verify on the bench

| Test | Expectation |
|---|---|
| Reported voltage vs multimeter | Within ~1 % after calibration |
| **Resistive load** (incandescent bulb, heater) | W ≈ VA, and **PF ≈ 1.0** |
| **Switch-mode load** (laptop brick, phone charger) | **W is materially below VA** — typically 30–50 % lower — and PF lands in the 0.5–0.7 band |
| Port switched off | 0 W, 0 VA, PF 0 |
| `voltage_source` in the RTDB | `"measured"` |
| Dashboard unit | Shows **W**, and a PF figure per active port |

**The switch-mode test is the real one.** If a laptop charger reports PF ≈ 1.0, the product is not
being computed correctly — a resistive load cannot distinguish the two methods, because at PF 1
apparent and real power are equal by definition.

> **Expect the numbers to DROP.** A port that used to read 100 VA may now read 60 W. That is the
> measurement arriving, not a regression. Do not "fix" it back.

---

## 5. What changes, and what does not

**Changes**

| Area | Before | After |
|---|---|---|
| Power | `I_rms × configured V` | `mean(v·i)` |
| Unit | VA | W |
| Power factor | not available | measured, published, shown |
| `energy_kwh` | apparent | **real** — now checkable against a utility meter |
| `nominal_voltage` | the voltage used | fallback only |

**Does not change**

- **The 5 A ACS712 ceiling.** A saturated sensor is still saturated; better maths cannot fix it.
- **ADC noise** (~±5–10 mV → ±0.03–0.05 A at 185 mV/A).
- **The sampling rate limit.** Reading two channels per sample roughly halves the effective rate.
  It still covers the 50/60 Hz fundamental and low harmonics, but high-order harmonics — which
  contribute most to distortion-driven power factor — are not captured. For true THD-grade
  measurement you would need the ESP32's continuous ADC / I2S DMA instead of sequential reads.
- **Safety.** No fuse, unverified isolation. Unchanged, and the voltage sensor makes the isolation
  question more important, not less.

---

## 6. Why the firmware does not use EmonLib

EmonLib implements the same method and is a fine reference. It was evaluated and deliberately not
adopted (2026-10-08):

- It reads raw `analogRead()` counts and assumes a **linear ADC**. The ESP32's ADC is not linear;
  this firmware uses `analogReadMilliVolts()`, which applies the factory calibration curve. Adopting
  EmonLib would be a **downgrade** unless patched — the ESP32 port needed two commits just for
  12-bit support.
- `calcVI()` **blocks** for a full measurement window, which fights the 30 s watchdog and the
  `millis()`-driven occupancy state machine, and would undo the ADC-cache work.
- One `EnergyMonitor` instance is one voltage + one current, so three ports means three instances
  re-sampling voltage.
- **Licence: AGPL-3.0** — the strictest copyleft, with a network-use clause. Fine for a thesis, a
  real obstacle if this is ever commercialised.
- The method is ~20 lines. Implementing it keeps `analogReadMilliVolts`, keeps the watchdog
  discipline, avoids the licence, and can be *explained* — which is worth more than citing a library.

The numbers can be cross-checked against EmonLib on the bench, which is a stronger validation than
trusting either implementation alone.
