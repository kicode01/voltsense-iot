# -*- coding: utf-8 -*-
import sys

with open('src/pages/Settings.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace limitsMeta definition with structured meta dictionaries
old_meta = """  const limitsMeta = {
    inactivity: {
      key: 'inactivity_limit_minutes',
      label: 'Idle timeout',
      unit: 'min',
      min: 1,
      max: 240,
      hint: 'How long the room must be still before the shutdown warning.'
    },
    overcurrent: {
      key: 'overcurrent_limit_a',
      label: 'Overcurrent trip',
      unit: 'A',
      min: 0.5,
      max: 5.0,
      hint: 'Bounded by what the 5 A sensor can actually resolve — above 5 A it is blind.'
    },
    nominal: {
      key: 'nominal_voltage',
      label: 'Supply voltage',
      unit: 'V',
      min: 50,
      max: 300,
      hint: 'Used to compute power while no voltage sensor is fitted. Measure it, do not guess.'
    },
    voltageCal: {
      key: 'voltage_cal_mv_per_v',
      label: 'Voltage calibration',
      unit: 'mV/V',
      min: 1.0,
      max: 20.0,
      hint: 'Divides into every voltage reading, so it scales every wattage. Compare against a meter.'
    },
    acsSensitivity: {
      key: 'acs712_mv_per_amp',
      label: 'ACS712 sensitivity',
      unit: 'mV/A',
      min: 10.0,
      max: 400.0,
      hint: 'Default 123.33 mV/A for 5A with 1k/2k divider; 185 mV/A direct; 100 mV/A for 20A.'
    },
    currentNoiseFloor: {
      key: 'current_noise_floor_a',
      label: 'Current noise floor',
      unit: 'A',
      min: 0.005,
      max: 1.0,
      hint: 'Current readings below this threshold clamp to 0.00 A to suppress idle ADC jitter.'
    },
    currentMultiplier: {
      key: 'current_cal_multiplier',
      label: 'Current multiplier',
      unit: 'x',
      min: 0.5,
      max: 2.0,
      hint: 'Fine multiplier to trim current readings against a calibrated multimeter.'
    },
    pirDelay: {
      key: 'pir_delay_seconds',
      label: 'PIR hold delay',
      unit: 's',
      min: 1,
      max: 60,
      hint: 'Motion smoothing bridge time to keep occupancy active across subtle movements.'
    },
    mmwaveDelay: {
      key: 'mmwave_delay_seconds',
      label: 'mmWave hold delay',
      unit: 's',
      min: 0,
      max: 60,
      hint: 'Stillness hold bridge to prevent radar flutter while seated or resting.'
    }
  };"""

new_meta = """  const deviceLimitsMeta = {
    inactivity: {
      key: 'inactivity_limit_minutes',
      label: 'Idle timeout',
      unit: 'min',
      min: 1,
      max: 240,
      hint: 'How long the room must be still before the shutdown warning.'
    },
    overcurrent: {
      key: 'overcurrent_limit_a',
      label: 'Overcurrent trip',
      unit: 'A',
      min: 0.5,
      max: 5.0,
      hint: 'Hardware cutoff limit — safely bounded by 5 A ACS712 sensor capacity.'
    },
    nominal: {
      key: 'nominal_voltage',
      label: 'Supply voltage',
      unit: 'V',
      min: 50,
      max: 300,
      hint: 'Nominal grid baseline used when mains waveform is unmeasured or in bench mode.'
    }
  };

  const electricalCalMeta = {
    voltageCal: {
      key: 'voltage_cal_mv_per_v',
      label: 'Voltage calibration',
      unit: 'mV/V',
      min: 1.0,
      max: 20.0,
      hint: 'ZMPT101B transformer scaling factor. Divides into raw ADC mV to derive mains RMS.'
    },
    acsSensitivity: {
      key: 'acs712_mv_per_amp',
      label: 'ACS712 sensitivity',
      unit: 'mV/A',
      min: 10.0,
      max: 400.0,
      hint: '123.33 mV/A for 5A with 1k/2k divider; 185 mV/A direct without divider.'
    },
    currentNoiseFloor: {
      key: 'current_noise_floor_a',
      label: 'Current noise floor',
      unit: 'A',
      min: 0.005,
      max: 1.0,
      hint: 'Readings below this threshold clamp to 0.00 A to reject idle ADC hiss.'
    },
    currentMultiplier: {
      key: 'current_cal_multiplier',
      label: 'Current multiplier',
      unit: 'x',
      min: 0.5,
      max: 2.0,
      hint: 'Precision multiplier to calibrate current readings against a reference multimeter.'
    }
  };

  const occupancyFilterMeta = {
    pirDelay: {
      key: 'pir_delay_seconds',
      label: 'PIR hold delay',
      unit: 's',
      min: 1,
      max: 60,
      hint: 'Motion smoothing bridge time to keep occupancy active across subtle movements.'
    },
    mmwaveDelay: {
      key: 'mmwave_delay_seconds',
      label: 'mmWave hold delay',
      unit: 's',
      min: 0,
      max: 60,
      hint: 'Stillness hold bridge to prevent radar flutter while seated or resting.'
    }
  };

  const limitsMeta = {
    ...deviceLimitsMeta,
    ...electricalCalMeta,
    ...occupancyFilterMeta
  };"""

if old_meta not in content:
    print("Error: old_meta not found in Settings.jsx!")
    sys.exit(1)

content = content.replace(old_meta, new_meta)

# 2. Update Device Limits JSX to render deviceLimitsMeta instead of limitsMeta
old_device_limits_jsx = """            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(limitsMeta).map(([field, meta]) => (
                <label key={field} className="block">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                    {meta.label} ({meta.unit})
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={meta.min}
                      max={meta.max}
                      step="any"
                      defaultValue={limits[field]}
                      key={`${field}-${limits[field]}`}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== Number(limits[field])) {
                          handleLimitSave(field, e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="w-full text-[16px] md:text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-maroon-300"
                    />
                    {savingLimit === field && <Loader2 className="w-4 h-4 animate-spin text-maroon-800 shrink-0" />}
                  </div>
                  <span className="block text-[10px] text-gray-400 mt-1 leading-snug">{meta.hint}</span>
                </label>
              ))}
            </div>"""

new_device_limits_jsx = """            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(deviceLimitsMeta).map(([field, meta]) => (
                <label key={field} className="block p-3 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                      {meta.label} ({meta.unit})
                    </span>
                    <span className="block text-[10px] text-gray-400 mb-2 leading-snug">{meta.hint}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={meta.min}
                      max={meta.max}
                      step="any"
                      defaultValue={limits[field]}
                      key={`${field}-${limits[field]}`}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== Number(limits[field])) {
                          handleLimitSave(field, e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="w-full text-[16px] md:text-sm font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-maroon-300"
                    />
                    {savingLimit === field && <Loader2 className="w-4 h-4 animate-spin text-maroon-800 shrink-0" />}
                  </div>
                </label>
              ))}
            </div>"""

if old_device_limits_jsx not in content:
    print("Error: old_device_limits_jsx not found in Settings.jsx!")
    sys.exit(1)

content = content.replace(old_device_limits_jsx, new_device_limits_jsx)

# 3. Add electrical calibration grid into Sensor Calibration section, right under quick actions
old_cal_spot = """            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {/* One-Tap Zero Tare */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Gauge className="w-4 h-4 text-maroon-800" />
                    <span className="text-xs font-bold text-gray-800">Current Zero-Tare</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                    Recalibrate 0.00 A zero-offset on all ACS712 sensors while outlets have no loads connected.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleZeroTareCurrent}
                  disabled={savingLimit === 'zero_tare_current'}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-maroon-800 hover:bg-maroon-900 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingLimit === 'zero_tare_current' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>Zero-Tare Current Sensors</span>
                </button>
              </div>

              {/* Voltage Auto-Calibration */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-cyan-600" />
                    <span className="text-xs font-bold text-gray-800">Voltage Auto-Calibration</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                    Samples live 220V grid AC sine wave across 200ms to calculate and store exact sensor factor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoCalibrateVoltage}
                  disabled={savingLimit === 'auto_cal_voltage'}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingLimit === 'auto_cal_voltage' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>Auto-Calibrate (220V Grid)</span>
                </button>
              </div>
            </div>"""

new_cal_spot = old_cal_spot + """

            {/* Electrical Sensor Precision Tuning */}
            <div className="mb-5 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-4 h-4 text-maroon-800" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Electrical Sensor Precision Parameters
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                Fine-tune ACS712 current and ZMPT101B voltage sensor scaling to match calibrated reference meters.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(electricalCalMeta).map(([field, meta]) => (
                  <label key={field} className="block p-3 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                        {meta.label} ({meta.unit})
                      </span>
                      <span className="block text-[10px] text-gray-400 mb-2 leading-snug">{meta.hint}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-auto">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={meta.min}
                        max={meta.max}
                        step="any"
                        defaultValue={limits[field]}
                        key={`${field}-${limits[field]}`}
                        onBlur={(e) => {
                          if (Number(e.target.value) !== Number(limits[field])) {
                            handleLimitSave(field, e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        className="w-full text-[16px] md:text-sm font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-maroon-300"
                      />
                      {savingLimit === field && <Loader2 className="w-4 h-4 animate-spin text-maroon-800 shrink-0" />}
                    </div>
                  </label>
                ))}
              </div>
            </div>"""

if old_cal_spot not in content:
    print("Error: old_cal_spot not found in Settings.jsx!")
    sys.exit(1)

content = content.replace(old_cal_spot, new_cal_spot)

with open('src/pages/Settings.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Settings.jsx refactored successfully! Zero redundancy achieved.")
