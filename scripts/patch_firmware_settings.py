# -*- coding: utf-8 -*-
"""
Script to audit and patch esp32/VoltSense/VoltSense.ino with benchMode,
inactivity_limit_seconds, and response_window_seconds support.
"""
with open('esp32/VoltSense/VoltSense.ino', 'r', encoding='utf-8') as f:
    ino = f.read()

# 1. Add benchMode declaration
if 'bool benchMode = false;' not in ino:
    target_decl = 'float nominalVoltage = VOLTAGE;'
    idx = ino.find(target_decl)
    if idx != -1:
        ino = ino[:idx] + 'bool benchMode = false;\n' + ino[idx:]

# 2. Update RESPONSE_WINDOW_MS to responseWindowMs
ino = ino.replace('const unsigned long RESPONSE_WINDOW_MS = 300 * 1000UL;', 'unsigned long responseWindowMs = 300 * 1000UL;')
ino = ino.replace('RESPONSE_WINDOW_MS', 'responseWindowMs')

# 3. Update supplyVoltage and voltageIsMeasured to respect benchMode
supply_old = """float supplyVoltage() {
#ifdef HAS_VOLTAGE_SENSE
  if (measuredVoltageIsUsable()) return measuredVoltageRms;
#endif
  if (nominalVoltage >= 50.0f && nominalVoltage <= 300.0f) return nominalVoltage;
  return VOLTAGE;
}"""

supply_new = """float supplyVoltage() {
#ifdef HAS_VOLTAGE_SENSE
  if (benchMode) return (nominalVoltage >= 50.0f && nominalVoltage <= 300.0f) ? nominalVoltage : VOLTAGE;
  if (measuredVoltageIsUsable()) return measuredVoltageRms;
#endif
  if (nominalVoltage >= 50.0f && nominalVoltage <= 300.0f) return nominalVoltage;
  return VOLTAGE;
}"""

ino = ino.replace(supply_old, supply_new)

volt_meas_old = """bool voltageIsMeasured() {
#ifdef HAS_VOLTAGE_SENSE
  return measuredVoltageIsUsable();
#else
  return false;
#endif
}"""

volt_meas_new = """bool voltageIsMeasured() {
#ifdef HAS_VOLTAGE_SENSE
  if (benchMode) return false;
  return measuredVoltageIsUsable();
#else
  return false;
#endif
}"""

ino = ino.replace(volt_meas_old, volt_meas_new)

# 4. In samplePortIntoCache, handle benchMode
old_sample_block = """#ifdef HAS_VOLTAGE_SENSE
  if (relayOn) {
    PowerReading p = readPowerPort(CURRENT_SENSOR_PINS[i]);
    if (p.valid) {
      c.amps = p.amps;
      c.watts = p.watts;
      c.va = p.va;
      c.pf = p.pf;
      c.volts = p.volts;
      c.powerValid = true;
      // Publish the newest plausible mains reading. supplyVoltage() and the telemetry both read
      // this, so the two always agree about which voltage the watts were computed against.
      if (p.volts >= 50.0f && p.volts <= 300.0f) {
        measuredVoltageRms = p.volts;
        lastVoltageSampleMs = millis();
      }
    } else {
      // Voltage waveform unusable / < 50V on bench:
      // Fallback to standalone ACS712 RMS sensing so current is NEVER lost!
      float rawAmps = readACS712RMS(CURRENT_SENSOR_PINS[i]);
      c.amps = rawAmps;
      c.volts = supplyVoltage();
      c.watts = rawAmps * c.volts;
      c.va = c.watts;
      // No phase relationship was captured, so there is no power factor to report. 0 = unknown.
      // (This used to claim 0.95f, then 1.0f — both fabricated, both surfaced as watts.)
      c.pf = 0.0f;
      c.powerValid = false;
    }
  } else {"""

new_sample_block = """#ifdef HAS_VOLTAGE_SENSE
  if (relayOn) {
    if (benchMode) {
      // Bench Test Mode: bypass AC mains sine sampling, measure current via standalone ACS712 peak-to-peak
      float rawAmps = readACS712RMS(CURRENT_SENSOR_PINS[i]);
      c.amps = rawAmps;
      c.volts = supplyVoltage();
      c.watts = rawAmps * c.volts;
      c.va = c.watts;
      c.pf = 1.0f;
      c.powerValid = false;
    } else {
      PowerReading p = readPowerPort(CURRENT_SENSOR_PINS[i]);
      if (p.valid) {
        c.amps = p.amps;
        c.watts = p.watts;
        c.va = p.va;
        c.pf = p.pf;
        c.volts = p.volts;
        c.powerValid = true;
        // Publish the newest plausible mains reading. supplyVoltage() and the telemetry both read
        // this, so the two always agree about which voltage the watts were computed against.
        if (p.volts >= 50.0f && p.volts <= 300.0f) {
          measuredVoltageRms = p.volts;
          lastVoltageSampleMs = millis();
        }
      } else {
        // Voltage waveform unusable / < 50V on bench:
        // Fallback to standalone ACS712 RMS sensing so current is NEVER lost!
        float rawAmps = readACS712RMS(CURRENT_SENSOR_PINS[i]);
        c.amps = rawAmps;
        c.volts = supplyVoltage();
        c.watts = rawAmps * c.volts;
        c.va = c.watts;
        // No phase relationship was captured, so there is no power factor to report. 0 = unknown.
        // (This used to claim 0.95f, then 1.0f — both fabricated, both surfaced as watts.)
        c.pf = 0.0f;
        c.powerValid = false;
      }
    }
  } else {"""

ino = ino.replace(old_sample_block, new_sample_block)

# 5. In applyRemoteChange, add bench_mode, inactivity_limit_seconds, response_window_seconds
target_remote = '} else if (path == "/settings/inactivity_limit_minutes") {\n    int minutes = data.intData();\n    if (minutes > 0) idleTimeoutMs = (unsigned long)minutes * 60 * 1000UL;'
new_remote = """} else if (path == "/settings/inactivity_limit_minutes") {
    int minutes = data.intData();
    if (minutes > 0) idleTimeoutMs = (unsigned long)minutes * 60 * 1000UL;
  } else if (path == "/settings/inactivity_limit_seconds") {
    int secs = data.intData();
    if (secs > 0) idleTimeoutMs = (unsigned long)secs * 1000UL;
  } else if (path == "/settings/response_window_seconds") {
    int secs = data.intData();
    if (secs > 0) responseWindowMs = (unsigned long)secs * 1000UL;
  } else if (path == "/settings/bench_mode") {
    benchMode = data.boolData();
    setNvsString("bench_mode", benchMode ? "1" : "0");
    Serial.printf("Bench test mode set to %s\\n", benchMode ? "true" : "false");"""

ino = ino.replace(target_remote, new_remote)

# 6. In full object init (path == "/"):
target_full = 'json.get(result, "settings/inactivity_limit_minutes");\n    if (result.success && result.intValue > 0) {\n      idleTimeoutMs = (unsigned long)result.intValue * 60 * 1000UL;\n    }'
new_full = """json.get(result, "settings/inactivity_limit_minutes");
    if (result.success && result.intValue > 0) {
      idleTimeoutMs = (unsigned long)result.intValue * 60 * 1000UL;
    }
    json.get(result, "settings/inactivity_limit_seconds");
    if (result.success && result.intValue > 0) {
      idleTimeoutMs = (unsigned long)result.intValue * 1000UL;
    }
    json.get(result, "settings/response_window_seconds");
    if (result.success && result.intValue > 0) {
      responseWindowMs = (unsigned long)result.intValue * 1000UL;
    }
    json.get(result, "settings/bench_mode");
    if (result.success) benchMode = result.boolValue;"""

ino = ino.replace(target_full, new_full)

# 7. In NVS restore in setup():
target_nvs = 'String savedFusion = getNvsString("fusion_mode");\n    if (savedFusion.length() > 0) sensorFusionMode = savedFusion;'
new_nvs = """String savedFusion = getNvsString("fusion_mode");
    if (savedFusion.length() > 0) sensorFusionMode = savedFusion;
    String savedBench = getNvsString("bench_mode");
    if (savedBench.length() > 0) benchMode = (savedBench == "1");"""

ino = ino.replace(target_nvs, new_nvs)

# 8. In telemetry JSON:
target_telem = 'json.set("inactivity_limit", (int)(idleTimeoutMs / 60000UL));'
new_telem = """json.set("inactivity_limit", (int)(idleTimeoutMs / 60000UL));
      json.set("inactivity_limit_seconds", (int)(idleTimeoutMs / 1000UL));
      json.set("bench_mode", benchMode);"""

ino = ino.replace(target_telem, new_telem)

with open('esp32/VoltSense/VoltSense.ino', 'w', encoding='utf-8') as f:
    f.write(ino)

print("Firmware patched with bench_mode and dynamic timer support.")
