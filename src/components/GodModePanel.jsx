import React, { useState } from 'react';
import {
  Zap,
  Clock,
  Radio,
  Bell,
  Volume2,
  RotateCcw,
  Check,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
  Gauge,
  Crosshair,
  Activity
} from 'lucide-react';
import { useRoomData } from '../hooks/useRoomData';
import { playEmergencyAlarm, playSuccessChime } from '../lib/soundAlert';

export const GodModePanel = ({ activeDeviceId, onDisable }) => {
  const { roomData, updateDeviceSetting, updateDeviceSettings } = useRoomData(activeDeviceId);

  const [savingKey, setSavingKey] = useState(null);
  const [successKey, setSuccessKey] = useState(null);
  const [testNotificationStatus, setTestNotificationStatus] = useState('');

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
  const acs712MvPerAmp = Number(settings.acs712_mv_per_amp ?? 123.33);
  const currentNoiseFloorA = Number(settings.current_noise_floor_a ?? 0.03);
  const currentCalMultiplier = Number(settings.current_cal_multiplier ?? 1.0);
  const voltageCalMvPerV = Number(settings.voltage_cal_mv_per_v ?? 4.545);
  const sensorFusionMode = settings.sensor_fusion_mode || 'OR';

  // Live sensor readings & telemetry
  const pirDetected = Boolean(roomData?.pir_detected);
  const mmwaveDetected = Boolean(roomData?.mmwave_detected);
  const isOccupied = Boolean(roomData?.is_occupied);

  const liveVoltage = roomData?.voltage ?? roomData?.ports?.port1?.voltage ?? 220;
  const livePort1A = Number(roomData?.ports?.port1?.current || 0);
  const livePort2A = Number(roomData?.ports?.port2?.current || 0);
  const livePort3A = Number(roomData?.ports?.port3?.current || 0);
  const liveTotalA = Number((livePort1A + livePort2A + livePort3A).toFixed(3));

  // Notification permission check
  const [permission, setPermission] = useState(() =>
    typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
      ? window.Notification.permission
      : 'unsupported'
  );

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

  const handleAutoCalibrateVoltage = async () => {
    setSavingKey('auto_cal_voltage');
    try {
      if (activeDeviceId) {
        await updateDeviceSetting('auto_calibrate_voltage', true);
      }
      showSuccess('auto_cal_voltage');
    } catch (err) {
      console.error('Voltage auto-cal error:', err);
    } finally {
      setSavingKey(null);
    }
  };

  const handleZeroTareCurrent = async () => {
    setSavingKey('zero_tare_current');
    try {
      if (activeDeviceId) {
        await updateDeviceSetting('calibrate_current_zero', true);
      }
      showSuccess('zero_tare_current');
    } catch (err) {
      console.error('Current zero-tare error:', err);
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
        sensor_fusion_mode: 'OR'
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
      force_pir: -1
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

  // Push notification tester
  const handleTestPushNotification = async () => {
    try {
      if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
        setTestNotificationStatus('Notifications unsupported in this browser');
        return;
      }

      let perm = window.Notification.permission;
      if (perm === 'default') {
        perm = await window.Notification.requestPermission();
        setPermission(perm);
      }

      if (perm !== 'granted') {
        setTestNotificationStatus('Permission not granted');
        return;
      }

      setTestNotificationStatus('Dispatching notification…');
      playEmergencyAlarm();

      const reg = await navigator.serviceWorker?.getRegistration();
      const payload = {
        body: '🚨 VoltSense Demonstration: Inactivity shutdown countdown started! Open app to override.',
        icon: '/logo.svg',
        vibrate: [200, 100, 200],
        tag: 'voltsense-demo-alert',
        renotify: true
      };

      if (reg && reg.showNotification) {
        await reg.showNotification('VoltSense Emergency Warning', payload);
      } else {
        new Notification('VoltSense Emergency Warning', payload);
      }
      setTestNotificationStatus('Notification fired successfully!');
      setTimeout(() => setTestNotificationStatus(''), 4000);
    } catch (err) {
      console.error('Push test error:', err);
      setTestNotificationStatus('Failed to display notification');
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

      {/* SECTION 4: Sensor Precision Calibration & Accuracy Suite */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
              Sensor Precision Calibration & Accuracy Suite
            </h4>
          </div>
          <span className="text-[10px] font-mono text-gray-400">
            Total Load: <span className="font-bold text-amber-300">{liveTotalA} A</span> | Grid:{' '}
            <span className="font-bold text-cyan-300">{Math.round(liveVoltage)} V</span>
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Card A: ACS712 Current Sensitivity & Tare */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    ACS712 Current Tuning
                  </span>
                </div>
                {successKey === 'acs712_mv_per_amp' && (
                  <span className="flex items-center text-xs font-bold text-emerald-400 gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              <p className="text-[11px] text-gray-400 mb-3 leading-snug">
                Set transfer sensitivity ($mV/A$) to match your board divider or fitted hall-effect IC.
              </p>

              {/* Sensitivity input */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  <span>Sensitivity (mV/A)</span>
                  <span className="text-amber-400 font-mono font-bold">{acs712MvPerAmp.toFixed(2)} mV/A</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="10"
                    max="400"
                    step="0.01"
                    defaultValue={acs712MvPerAmp}
                    key={`acs-${acs712MvPerAmp}`}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 10 && val <= 400 && val !== acs712MvPerAmp) {
                        handleSaveSetting('acs712_mv_per_amp', val);
                      }
                    }}
                    className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                  />
                  <span className="text-xs font-bold text-amber-400 shrink-0">mV/A</span>
                </div>
              </div>

              {/* Presets */}
              <div className="mb-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                  Hardware Presets:
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: '5A (1k/2k Divider)', val: 123.33, desc: 'VoltSense PCB' },
                    { label: '5A (Direct 5V)', val: 185.00, desc: 'No divider' },
                    { label: '20A (Direct 5V)', val: 100.00, desc: '20A module' },
                    { label: '20A (Divider)', val: 66.67, desc: '20A with divider' }
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      onClick={() => handleSaveSetting('acs712_mv_per_amp', preset.val)}
                      className={`px-2 py-1.5 rounded-xl border text-left transition-all ${
                        Math.abs(acs712MvPerAmp - preset.val) < 0.5
                          ? 'bg-amber-400 text-black border-amber-400 font-black shadow-md'
                          : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-[11px] font-bold">{preset.label}</div>
                      <div className={`text-[9px] ${Math.abs(acs712MvPerAmp - preset.val) < 0.5 ? 'text-black/70 font-semibold' : 'text-gray-400'}`}>
                        {preset.val} mV/A
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Noise floor & Multiplier */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Noise Floor (A)
                  </span>
                  <input
                    type="number"
                    min="0.005"
                    max="0.5"
                    step="0.005"
                    defaultValue={currentNoiseFloorA}
                    key={`nf-${currentNoiseFloorA}`}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0.005 && val <= 1.0 && val !== currentNoiseFloorA) {
                        handleSaveSetting('current_noise_floor_a', val);
                      }
                    }}
                    className="w-full bg-black/40 border border-white/20 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[0.02, 0.03, 0.05, 0.10].map((nf) => (
                      <button
                        key={nf}
                        type="button"
                        onClick={() => handleSaveSetting('current_noise_floor_a', nf)}
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded-lg border transition-colors ${
                          Math.abs(currentNoiseFloorA - nf) < 0.003
                            ? 'bg-amber-400 text-black border-amber-400 font-bold'
                            : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {nf.toFixed(2)}A
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Multiplier Gain
                  </span>
                  <input
                    type="number"
                    min="0.5"
                    max="2.0"
                    step="0.01"
                    defaultValue={currentCalMultiplier}
                    key={`cm-${currentCalMultiplier}`}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0.5 && val <= 2.0 && val !== currentCalMultiplier) {
                        handleSaveSetting('current_cal_multiplier', val);
                      }
                    }}
                    className="w-full bg-black/40 border border-white/20 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            </div>

            {/* Zero-Tare Button */}
            <button
              onClick={handleZeroTareCurrent}
              disabled={savingKey === 'zero_tare_current'}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs transition-all active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>{successKey === 'zero_tare_current' ? 'Zero-Tare Calibrated!' : 'Zero-Tare Current Sensors'}</span>
            </button>
          </div>

          {/* Card B: ZMPT101B AC Voltage Calibration */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    ZMPT101B Voltage Auto-Cal
                  </span>
                </div>
                {successKey === 'voltage_cal_mv_per_v' && (
                  <span className="flex items-center text-xs font-bold text-emerald-400 gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              <p className="text-[11px] text-gray-400 mb-3 leading-snug">
                One-tap auto-sampling computes exact $mV/V$ factor from live AC waveform on GPIO 33.
              </p>

              {/* Current Factor & Live Voltage */}
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider">Live AC RMS</span>
                  <span className="font-mono text-base font-black text-cyan-200">{Math.round(liveVoltage)} V</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span>Calibration Factor:</span>
                  <span className="font-mono text-cyan-300 font-bold">{voltageCalMvPerV.toFixed(3)} mV/V</span>
                </div>
              </div>

              {/* Manual Factor Fine Tuning */}
              <div className="mb-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                  Manual Factor Fine-Tuning (mV/V)
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1.0"
                    max="20.0"
                    step="0.005"
                    defaultValue={voltageCalMvPerV}
                    key={`voltcal-${voltageCalMvPerV}`}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1.0 && val <= 20.0 && val !== voltageCalMvPerV) {
                        handleSaveSetting('voltage_cal_mv_per_v', val);
                      }
                    }}
                    className="w-full bg-black/40 border border-white/20 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-cyan-400"
                  />
                  <span className="text-xs font-bold text-cyan-400 shrink-0">mV/V</span>
                </div>
              </div>

              {/* Multimeter Reference Helper */}
              <p className="text-[10px] text-gray-400 leading-snug mb-3">
                Plug unit into grid, measure outlet voltage with multimeter, then tap auto-calibrate to store precise curve into ESP32 NVS flash.
              </p>
            </div>

            {/* Auto-Calibrate Button */}
            <button
              onClick={handleAutoCalibrateVoltage}
              disabled={savingKey === 'auto_cal_voltage'}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs transition-all active:scale-95 shadow-md shadow-cyan-600/20"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>{successKey === 'auto_cal_voltage' ? 'Calibration Triggered!' : 'Auto-Calibrate against 220V Grid'}</span>
            </button>
          </div>

          {/* Card C: Sensor Fusion & Occupancy Intelligence */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Sensor Fusion Logic
                  </span>
                </div>
                {successKey === 'sensor_fusion_mode' && (
                  <span className="flex items-center text-xs font-bold text-emerald-400 gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
              </div>

              <p className="text-[11px] text-gray-400 mb-3 leading-snug">
                Configure how PIR motion and 24GHz mmWave radar signals combine to determine room occupancy.
              </p>

              {/* Mode Options */}
              <div className="space-y-2 mb-3">
                {[
                  {
                    id: 'OR',
                    title: 'OR (Dual-Trigger)',
                    desc: 'Either PIR or mmWave triggers and maintains presence. Fastest & fail-safe.'
                  },
                  {
                    id: 'PIR_WAKE_MMWAVE_HOLD',
                    title: 'PIR Wake + mmWave Hold',
                    desc: 'PIR wakes room upon entry; mmWave micro-radar holds room while seated/sleeping.'
                  },
                  {
                    id: 'AND',
                    title: 'AND (Co-Validation)',
                    desc: 'Both sensors must detect simultaneously. Highest rejection of false positives.'
                  }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => handleSaveSetting('sensor_fusion_mode', mode.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all ${
                      sensorFusionMode === mode.id
                        ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-bold">{mode.title}</span>
                      {sensorFusionMode === mode.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                    <p className="text-[10px] text-gray-400 leading-snug">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Fusion Status Badge */}
            <div className="mt-2 py-2 px-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between text-xs">
              <span className="text-gray-400 text-[11px]">Active Policy:</span>
              <span className="font-mono font-bold text-emerald-400">{sensorFusionMode}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5: Push Alerts & Audio Alarm Suite (Solves "push alert di nagana") */}
      <div className="mt-8 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">
              Push Alert & Siren Demonstration (Item 5)
            </h4>
          </div>
          <span className="text-[10px] font-mono text-gray-400">
            Permission: <span className={`font-bold uppercase ${permission === 'granted' ? 'text-emerald-400' : 'text-amber-400'}`}>{permission}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Button A: Trigger Instant Simulated Response Window Countdown */}
          <button
            onClick={() => handleTriggerSimulatedAlert(15)}
            className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-gradient-to-tr from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-center shadow-lg shadow-red-600/30 active:scale-95 transition-all"
          >
            <ShieldAlert className="w-5 h-5 mb-1 animate-bounce" />
            <span className="text-xs font-black uppercase tracking-wider">Trigger Emergency Alert</span>
            <span className="text-[10px] text-white/80 font-medium mt-0.5">Countdown + Siren Banner</span>
          </button>

          {/* Button B: Test Native OS Push Notification */}
          <button
            onClick={handleTestPushNotification}
            className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-center active:scale-95 transition-all"
          >
            <Bell className="w-5 h-5 mb-1 text-amber-400" />
            <span className="text-xs font-black uppercase tracking-wider">Fire OS Push Notification</span>
            <span className="text-[10px] text-gray-300 font-medium mt-0.5">Desktop & Mobile Banner</span>
          </button>

          {/* Button C: Test Emergency Audio Alarm & Haptic Vibration */}
          <button
            onClick={() => playEmergencyAlarm()}
            className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-center active:scale-95 transition-all"
          >
            <Volume2 className="w-5 h-5 mb-1 text-emerald-400" />
            <span className="text-xs font-black uppercase tracking-wider">Play Alarm Sound & Haptics</span>
            <span className="text-[10px] text-gray-300 font-medium mt-0.5">Dual-Tone Piezo Synthesizer</span>
          </button>
        </div>

        {testNotificationStatus && (
          <p className="mt-3 text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl animate-in fade-in">
            {testNotificationStatus}
          </p>
        )}
      </div>
    </div>
  );
};

export default GodModePanel;
