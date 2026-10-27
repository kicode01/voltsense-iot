import React, { useState } from 'react';
import {
  Zap,
  Clock,
  Radio,
  Bell,
  Volume2,
  Check,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
  RotateCcw
} from 'lucide-react';
import { useRoomData } from '../hooks/useRoomData';
import { playEmergencyAlarm, playSuccessChime } from '../lib/soundAlert';

export const GodModePanel = ({ activeDeviceId, onDisable }) => {
  const { roomData, updateDeviceSetting, updateDeviceSettings } = useRoomData(activeDeviceId);

  const [savingKey, setSavingKey] = useState(null);
  const [successKey, setSuccessKey] = useState(null);

  // Local editable values initialized from roomData.settings
  const settings = roomData?.settings || {};

  const inactivitySec = Number(
    settings.inactivity_limit_seconds ??
    ((settings.inactivity_limit_minutes || roomData?.inactivity_limit || 15) * 60)
  );
  const responseWindowSec = Number(settings.response_window_seconds ?? 300);
  const pirDelaySec = Number(settings.pir_delay_seconds ?? 5);
  const mmwaveDelaySec = Number(settings.mmwave_delay_seconds ?? 3);

  const mmwaveEnabled = settings.mmwave_enabled !== undefined ? Boolean(settings.mmwave_enabled) : true;
  const mmwaveInverted = settings.mmwave_inverted !== undefined ? Boolean(settings.mmwave_inverted) : false;
  const forceMmwave = settings.force_mmwave !== undefined ? Number(settings.force_mmwave) : -1;
  const forcePir = settings.force_pir !== undefined ? Number(settings.force_pir) : -1;

  // Calibration and Accuracy Settings

  // Live sensor readings & telemetry
  const pirDetected = Boolean(roomData?.pir_detected);
  const mmwaveDetected = Boolean(roomData?.mmwave_detected);
  const isOccupied = Boolean(roomData?.is_occupied);



  const showSuccess = (key) => {
    setSuccessKey(key);
    playSuccessChime();
    setTimeout(() => setSuccessKey(null), 2500);
  };

  const handleSaveSetting = async (key, value) => {
    setSavingKey(key);
    try {
      if (activeDeviceId) {
        await updateDeviceSetting(key, value);
      }
      showSuccess(key);
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
    } finally {
      setSavingKey(null);
    }
  };



  // One-Tap Presets
  const applyPreset = async (presetType) => {
    setSavingKey(presetType);
    let patch = {};
    if (presetType === 'lightning') {
      patch = {
        inactivity_limit_seconds: 5,
        inactivity_limit_minutes: 1,
        response_window_seconds: 10,
        pir_delay_seconds: 2,
        mmwave_delay_seconds: 2,
        mmwave_enabled: true
      };
    } else if (presetType === 'standard') {
      patch = {
        inactivity_limit_seconds: 30,
        inactivity_limit_minutes: 1,
        response_window_seconds: 30,
        pir_delay_seconds: 3,
        mmwave_delay_seconds: 3,
        mmwave_enabled: true
      };
    } else if (presetType === 'production') {
      patch = {
        inactivity_limit_seconds: 900,
        inactivity_limit_minutes: 15,
        response_window_seconds: 300,
        pir_delay_seconds: 5,
        mmwave_delay_seconds: 3,
        mmwave_enabled: true,
        mmwave_inverted: false,
        force_mmwave: -1,
        force_pir: -1,
        acs712_mv_per_amp: 123.33,
        current_noise_floor_a: 0.03,
        current_cal_multiplier: 1.00,
        sensor_fusion_mode: 'OR',
        radar_max_gate: 3,
        radar_static_threshold: 20,
        radar_moving_threshold: 30
      };
    }

    try {
      if (activeDeviceId) {
        await updateDeviceSettings(patch);
      }
      showSuccess(presetType);
    } catch (err) {
      console.error('Failed to apply preset:', err);
    } finally {
      setSavingKey(null);
    }
  };

  // Reset all simulation settings to factory production defaults and turn off God Mode
  const handleDisableAndRestore = async () => {
    setSavingKey('restore_defaults');
    const productionDefaults = {
      inactivity_limit_seconds: 900,
      inactivity_limit_minutes: 15,
      response_window_seconds: 300,
      pir_delay_seconds: 5,
      mmwave_delay_seconds: 3,
      mmwave_enabled: true,
      mmwave_inverted: false,
      force_mmwave: -1,
      force_pir: -1,
      radar_max_gate: 3,
      radar_static_threshold: 20,
      radar_moving_threshold: 30
    };

    try {
      if (activeDeviceId) {
        await updateDeviceSettings(productionDefaults);
      }
      playSuccessChime();
      if (onDisable) {
        onDisable();
      } else {
        try {
          localStorage.setItem('voltsense_god_mode', 'false');
        } catch {}
      }
    } catch (err) {
      console.error('Failed to restore defaults:', err);
    } finally {
      setSavingKey(null);
    }
  };

  // Trigger Response Window Banner & Audio
  const handleTriggerSimulatedAlert = (seconds = 30) => {
    window.dispatchEvent(
      new CustomEvent('voltsense-trigger-alert', {
        detail: { seconds }
      })
    );
    playEmergencyAlarm();
  };

  return (
    <div className="bg-gradient-to-b from-maroon-950 via-slate-900 to-black text-white rounded-3xl p-5 md:p-7 border-2 border-amber-500/40 shadow-2xl shadow-amber-500/10 mb-6 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10 relative z-10">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/20 text-white shrink-0">
            <Zap className="w-6 h-6 fill-current animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg md:text-xl font-black tracking-tight text-white">
                God Mode / Demonstration Suite
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-black shadow-sm">
                Active
              </span>
            </div>
            <p className="text-xs text-amber-200/80 font-medium mt-0.5">
              Live hardware overrides, fast timing presets, and push alert triggers for defense presentation
            </p>
          </div>
        </div>

        {/* Exit & Reset to Defaults Button */}
        <button
          onClick={handleDisableAndRestore}
          disabled={savingKey === 'restore_defaults'}
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-gray-200 hover:text-white transition-all duration-300 active:scale-95 shadow-sm"
          title="Reset device timers & overrides to production and close God Mode"
        >
          <RotateCcw className="w-4 h-4 text-emerald-400" />
          <span>Exit & Restore Defaults</span>
        </button>
      </div>

      {/* SECTION 1: One-Tap Speed-Run Demonstration Presets */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
            One-Tap Demonstration Presets
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Lightning Preset */}
          <button
            onClick={() => applyPreset('lightning')}
            disabled={savingKey === 'lightning'}
            className="flex flex-col text-left p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-amber-500/30 hover:border-amber-400 transition-all duration-300 group relative overflow-hidden"
          >
            <div className="flex items-center justify-between w-full mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-amber-400 text-black">
                <Zap className="w-3.5 h-3.5 fill-current" />
                Lightning Demo
              </span>
              {successKey === 'lightning' && (
                <span className="flex items-center text-xs font-bold text-emerald-400 gap-1 animate-in fade-in">
                  <Check className="w-3.5 h-3.5" /> Applied
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-white mb-1">
              Inactivity: 5s · Response: 10s · Delays: 2s
            </p>
            <p className="text-[11px] text-gray-400 leading-snug">
              ⚡ Ultra-fast 15s total cycle. Demonstrates immediate sensor clearing and auto-cutoff live for panelists without waiting.
            </p>
          </button>

          {/* Standard Demo Preset */}
          <button
            onClick={() => applyPreset('standard')}
            disabled={savingKey === 'standard'}
            className="flex flex-col text-left p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-blue-500/30 hover:border-blue-400 transition-all duration-300 group relative overflow-hidden"
          >
            <div className="flex items-center justify-between w-full mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-blue-500 text-white">
                <Clock className="w-3.5 h-3.5" />
                Standard Demo
              </span>
              {successKey === 'standard' && (
                <span className="flex items-center text-xs font-bold text-emerald-400 gap-1 animate-in fade-in">
                  <Check className="w-3.5 h-3.5" /> Applied
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-white mb-1">
              Inactivity: 30s · Response: 30s · Delays: 3s
            </p>
            <p className="text-[11px] text-gray-400 leading-snug">
              ⏱️ 60s total cycle. Gives ample speaking time to explain the countdown before the relays safely cut power.
            </p>
          </button>

          {/* Production Default Preset */}
          <button
            onClick={() => applyPreset('production')}
            disabled={savingKey === 'production'}
            className="flex flex-col text-left p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-emerald-500/30 hover:border-emerald-400 transition-all duration-300 group relative overflow-hidden"
          >
            <div className="flex items-center justify-between w-full mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-500 text-white">
                <RotateCcw className="w-3.5 h-3.5" />
                Production Default
              </span>
              {successKey === 'production' && (
                <span className="flex items-center text-xs font-bold text-emerald-400 gap-1 animate-in fade-in">
                  <Check className="w-3.5 h-3.5" /> Applied
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-white mb-1">
              Inactivity: 15m · Response: 5m · Delays: 5s
            </p>
            <p className="text-[11px] text-gray-400 leading-snug">
              🛡️ Restores full real-world dormitory parameters and resets any active sensor overrides to Auto.
            </p>
          </button>
        </div>
      </div>

      {/* SECTION 2: Timing & Countdown Thresholds (Requests 1, 2, 3) */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-amber-400" />
          <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
            Timing & Duration Configuration (Item 1, 2, 3)
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Inactivity Timer */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  Inactivity Timer
                </span>
                {successKey === 'inactivity' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Empty room still time before warning
              </p>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min="3"
                  max="14400"
                  defaultValue={inactivitySec}
                  key={`inact-${inactivitySec}`}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    if (val > 0 && val !== inactivitySec) {
                      handleSaveSetting('inactivity_limit_seconds', val);
                      handleSaveSetting('inactivity_limit_minutes', Math.max(1, Math.round(val / 60)));
                    }
                  }}
                  className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                />
                <span className="text-xs font-bold text-amber-400 shrink-0">sec</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[5, 10, 30, 60, 900].map((sec) => (
                <button
                  key={sec}
                  onClick={() => {
                    handleSaveSetting('inactivity_limit_seconds', sec);
                    handleSaveSetting('inactivity_limit_minutes', Math.max(1, Math.round(sec / 60)));
                  }}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition-colors ${
                    inactivitySec === sec
                      ? 'bg-amber-400 text-black border-amber-400 font-black'
                      : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Response Window */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  Response Window
                </span>
                {successKey === 'response' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Warning countdown before power cut
              </p>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min="5"
                  max="1800"
                  defaultValue={responseWindowSec}
                  key={`resp-${responseWindowSec}`}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    if (val > 0 && val !== responseWindowSec) {
                      handleSaveSetting('response_window_seconds', val);
                    }
                  }}
                  className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                />
                <span className="text-xs font-bold text-amber-400 shrink-0">sec</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[10, 15, 30, 60, 300].map((sec) => (
                <button
                  key={sec}
                  onClick={() => handleSaveSetting('response_window_seconds', sec)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition-colors ${
                    responseWindowSec === sec
                      ? 'bg-amber-400 text-black border-amber-400 font-black'
                      : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                </button>
              ))}
            </div>
          </div>

          {/* 3. PIR Hold-Off Delay */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  PIR Hold Delay
                </span>
                {successKey === 'pir_delay_seconds' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Motion smoothing bridge time
              </p>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min="1"
                  max="60"
                  defaultValue={pirDelaySec}
                  key={`pir-delay-${pirDelaySec}`}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 0 && val !== pirDelaySec) {
                      handleSaveSetting('pir_delay_seconds', val);
                    }
                  }}
                  className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                />
                <span className="text-xs font-bold text-amber-400 shrink-0">sec</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[1, 2, 5, 10, 15].map((sec) => (
                <button
                  key={sec}
                  onClick={() => handleSaveSetting('pir_delay_seconds', sec)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition-colors ${
                    pirDelaySec === sec
                      ? 'bg-amber-400 text-black border-amber-400 font-black'
                      : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* 4. mmWave Hold-Off Delay */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                  mmWave Hold Delay
                </span>
                {successKey === 'mmwave_delay_seconds' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <p className="text-[10px] text-gray-400 mb-2">
                Micro-radar stillness bridge time
              </p>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  min="0"
                  max="60"
                  defaultValue={mmwaveDelaySec}
                  key={`mmw-delay-${mmwaveDelaySec}`}
                  onBlur={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 0 && val !== mmwaveDelaySec) {
                      handleSaveSetting('mmwave_delay_seconds', val);
                    }
                  }}
                  className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                />
                <span className="text-xs font-bold text-amber-400 shrink-0">sec</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[1, 2, 3, 6, 10].map((sec) => (
                <button
                  key={sec}
                  onClick={() => handleSaveSetting('mmwave_delay_seconds', sec)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border transition-colors ${
                    mmwaveDelaySec === sec
                      ? 'bg-amber-400 text-black border-amber-400 font-black'
                      : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Sensor Diagnostics & Overrides (Solves "mmwave di nagffalse") */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
              Sensor Diagnostics & Hardware Overrides (Item 5)
            </h4>
          </div>
          <span className="text-[10px] font-mono text-gray-400">
            Fused State: <span className={`font-black ${isOccupied ? 'text-emerald-400' : 'text-rose-400'}`}>{isOccupied ? 'OCCUPIED' : 'VACANT'}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* mmWave Radar Control Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${mmwaveDetected ? 'bg-amber-400 animate-ping' : 'bg-gray-600'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  24GHz mmWave Radar
                </span>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                mmwaveDetected ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40' : 'bg-gray-800 text-gray-400'
              }`}>
                {mmwaveDetected ? 'DETECTING TARGET' : 'CLEAR / FALSE'}
              </span>
            </div>

            <p className="text-[11px] text-gray-400 mb-3 leading-snug">
              If mmWave remains active due to internal reflections or active-low wiring, toggle Polarity or force False during demonstrations.
            </p>

            {/* Sub-toggles: Enable & Polarity */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => handleSaveSetting('mmwave_enabled', !mmwaveEnabled)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  mmwaveEnabled ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-red-500/20 border-red-500/50 text-red-300'
                }`}
              >
                <span>Radar Power</span>
                <span>{mmwaveEnabled ? 'ENABLED' : 'DISABLED'}</span>
              </button>

              <button
                onClick={() => handleSaveSetting('mmwave_inverted', !mmwaveInverted)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                  mmwaveInverted ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'bg-white/5 border-white/10 text-gray-300'
                }`}
              >
                <span>Polarity</span>
                <span>{mmwaveInverted ? 'INVERTED (Low)' : 'NORMAL (High)'}</span>
              </button>
            </div>

            {/* 3-way Force Segmented Control */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Manual Signal Override:
              </span>
              <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                <button
                  onClick={() => handleSaveSetting('force_mmwave', -1)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forceMmwave === -1 ? 'bg-amber-400 text-black shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Auto (Live Pin)
                </button>
                <button
                  onClick={() => handleSaveSetting('force_mmwave', 1)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forceMmwave === 1 ? 'bg-amber-500 text-black shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Force True
                </button>
                <button
                  onClick={() => handleSaveSetting('force_mmwave', 0)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forceMmwave === 0 ? 'bg-rose-600 text-white shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Force False
                </button>
              </div>
            </div>
          </div>

          {/* PIR Sensor Control Card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${pirDetected ? 'bg-emerald-400 animate-ping' : 'bg-gray-600'}`} />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  HC-SR501 PIR Motion
                </span>
              </div>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                pirDetected ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40' : 'bg-gray-800 text-gray-400'
              }`}>
                {pirDetected ? 'MOTION DETECTED' : 'CLEAR / FALSE'}
              </span>
            </div>

            <p className="text-[11px] text-gray-400 mb-3 leading-snug">
              Infrared pyroelectric sensor. Detects gross human motion across the doorway or room perimeter.
            </p>

            <div className="mb-3 py-2 px-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs font-bold text-gray-300">
              <span>Hardware Pin</span>
              <span className="font-mono text-amber-400">GPIO 22 (Pull-Down)</span>
            </div>

            {/* 3-way Force Segmented Control */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Manual Signal Override:
              </span>
              <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                <button
                  onClick={() => handleSaveSetting('force_pir', -1)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forcePir === -1 ? 'bg-emerald-400 text-black shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Auto (Live Pin)
                </button>
                <button
                  onClick={() => handleSaveSetting('force_pir', 1)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forcePir === 1 ? 'bg-emerald-500 text-black shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Force True
                </button>
                <button
                  onClick={() => handleSaveSetting('force_pir', 0)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    forcePir === 0 ? 'bg-rose-600 text-white shadow-md font-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Force False
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

            {/* SECTION 4: Emergency Alert & Siren Demonstration */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
              Demonstration Siren & Emergency Simulation
            </h4>
          </div>
          <span className="text-[10px] font-mono text-gray-400">
            Simulate audible buzzer and inactivity warning for presentations
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Button A: Trigger Instant Simulated Response Window Countdown */}
          <button
            onClick={() => handleTriggerSimulatedAlert(15)}
            className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl bg-gradient-to-tr from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-center shadow-lg shadow-red-600/30 active:scale-95 transition-all"
          >
            <ShieldAlert className="w-5 h-5 shrink-0 animate-bounce" />
            <div className="text-left">
              <div className="text-xs font-black uppercase tracking-wider">Trigger Emergency Alert</div>
              <div className="text-[10px] text-white/80 font-medium">15s Countdown + Siren Banner</div>
            </div>
          </button>

          {/* Button B: Test Emergency Audio Alarm & Haptic Vibration */}
          <button
            onClick={() => playEmergencyAlarm()}
            className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-center active:scale-95 transition-all"
          >
            <Volume2 className="w-5 h-5 shrink-0 text-emerald-400" />
            <div className="text-left">
              <div className="text-xs font-black uppercase tracking-wider">Play Siren & Haptics</div>
              <div className="text-[10px] text-gray-300 font-medium">Synthesized Piezo Alarm Tone</div>
            </div>
          </button>
        </div>


        <div className="mt-4 pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 gap-2">
          <span>Looking to tune permanent hardware calibration factors?</span>
          <span className="text-amber-300 font-bold flex items-center gap-1">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Configurable in Sensor Calibration & Accuracy below
          </span>
        </div>
      </div>
    </div>
  );
};

export default GodModePanel;
