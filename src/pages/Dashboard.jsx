import { useState, useEffect, useRef } from 'react';
import { useRoomData } from '../hooks/useRoomData';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { Moon, AlertTriangle, Loader2, Timer, Radar, Plug } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Evaluates whether an outlet is in use, energized without a load, or switched off.
 * Uses refined maroon brand-palette states with distinct high-contrast visibility.
 */
const getPortConnectionState = (portData) => {
  const isRelayOn = Boolean(portData?.relay_status);
  if (!isRelayOn) {
    return {
      statusLabel: 'Switched Off',
      loadCategory: 'De-energized',
      pillClass: 'bg-gray-100 text-gray-500 border-gray-200/90',
      dotClass: 'bg-gray-300 ring-1 ring-gray-200',
      iconClass: 'bg-gray-100 text-gray-400 border border-gray-200/60',
      isDrawing: false,
      isEnergized: false
    };
  }

  const watts = Number(portData?.power_watts) || 0;
  const amps = Number(portData?.current_amps) || 0;

  if (watts > 1.5 || amps > 0.02) {
    let category = 'Active Load';
    if (watts <= 30 || amps <= 0.15) {
      category = 'Charging / Low Power';
    } else if (watts <= 120 || amps <= 0.6) {
      category = 'Active Device';
    } else {
      category = 'High Power Draw';
    }

    return {
      statusLabel: 'In Use',
      loadCategory: category,
      pillClass: 'bg-maroon-800 text-white border-maroon-900 shadow-sm shadow-maroon-900/20',
      dotClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse',
      iconClass: 'bg-maroon-800 text-white shadow-md shadow-maroon-900/25 ring-2 ring-maroon-200/40',
      isDrawing: true,
      isEnergized: true
    };
  }

  return {
    statusLabel: 'Standby',
    loadCategory: 'Empty Socket',
    pillClass: 'bg-maroon-100/80 text-maroon-900 border-maroon-300/80 shadow-2xs',
    dotClass: 'bg-maroon-600 ring-2 ring-maroon-200',
    iconClass: 'bg-maroon-50 text-maroon-800 border border-maroon-200/70 shadow-2xs',
    isDrawing: false,
    isEnergized: true
  };
};

const Dashboard = () => {
  const { activeDeviceId, devicesLoading } = useDeviceContext();

  const { roomData, loading: roomLoading, toggleMasterRelay, togglePortRelay, setOverride } = useRoomData(activeDeviceId);
  
  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [optimisticRelays, setOptimisticRelays] = useState({});
  const [pendingPorts] = useState({});
  const [overridePending, setOverridePending] = useState(false);
  const [actionError, setActionError] = useState(null);

  const reportFailure = (message) => setActionError(message);

  // Per-port debounce and lockout refs to completely eliminate toggle bounce-back during rapid tapping/spamming
  const debounceTimersRef = useRef({});
  const lastUserActionRef = useRef({});
  const targetStatusRef = useRef({});
  const masterTimerRef = useRef(null);

  // Clear optimistic override once Firebase data confirms the state, respecting debounce lockout
  useEffect(() => {
    if (!roomData || !roomData.ports) return;
    const now = Date.now();
    setOptimisticRelays(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach(key => {
        // If a debounce is still pending or user clicked within the last 1500ms, ignore server snapshots for this port
        const isUserRecent = debounceTimersRef.current[key] || (now - (lastUserActionRef.current[key] || 0) < 1500);
        if (isUserRecent) return;

        // If the server matches what the user wanted, cleanly drop the optimistic override
        if (roomData.ports[key] && roomData.ports[key].relay_status === prev[key]) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [roomData]);

  // Clean up all timers on unmount
  useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => {
      clearTimeout(masterTimerRef.current);
      Object.values(timers).forEach(t => t && clearTimeout(t));
    };
  }, []);



  const [demoData, setDemoData] = useState({
    state: /** @type {string | undefined} */ ('OCCUPIED'),
    countdown_remaining_seconds: /** @type {number | undefined} */ (undefined),
    voltage: 220,
    voltage_source: 'configured',
    is_occupied: true,
    pir_detected: true,
    mmwave_detected: true,
    settings: { night_mode_enabled: true, night_mode_start: '22:00', night_mode_end: '06:00' },
    ports: {
      port_01: { name: 'Port 1', relay_status: true, power_watts: 26.4, current_amps: 0.12, voltage: 220 },
      port_02: { name: 'Port 2', relay_status: true, power_watts: 264.0, current_amps: 1.20, voltage: 220 },
      port_03: { name: 'Port 3', relay_status: false, power_watts: 0, current_amps: 0, voltage: 220 }
    }
  });

  if (devicesLoading || roomLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin" />
      </div>
    );
  }

  const isDemo = !activeDeviceId;
  const data = isDemo ? demoData : (roomData || {});

  const settings = data.settings || { night_mode_enabled: false, night_mode_start: '22:00', night_mode_end: '06:00' };
  const nightMode = { enabled: settings.night_mode_enabled, start_time: settings.night_mode_start, end_time: settings.night_mode_end };
  const defaultPorts = {
    port_01: { name: 'Port 1', relay_status: false, power_watts: 0, current_amps: 0, power_factor: 0 },
    port_02: { name: 'Port 2', relay_status: false, power_watts: 0, current_amps: 0, power_factor: 0 },
    port_03: { name: 'Port 3', relay_status: false, power_watts: 0, current_amps: 0, power_factor: 0 }
  };
  
  // Deep merge Firebase data with default ports so names and default fields aren't wiped out
  const ports = { ...defaultPorts };
  if (data.ports) {
    Object.keys(data.ports).forEach(key => {
      // If it's a valid port_XX that shouldn't exceed 3 ports, we can restrict it if needed,
      // but let's just deep merge any valid default port, and ignore ghost ports like port_04
      if (ports[key]) {
        ports[key] = { ...ports[key], ...data.ports[key] };
        if (optimisticRelays[key] !== undefined) {
          ports[key].relay_status = optimisticRelays[key];
        }
      }
    });
  }
  const anyOn = Object.values(ports).some(p => p.relay_status);
  // REAL occupancy, published by the device from its sensors (motion, or night mode forcing
  // "occupied"). The badge previously showed whether any relay happened to be energised, which is a
  // different question — a room can be occupied with everything off, or idle with a charger running.
  // Fall back to the old signal only when the device does not publish the field.
  const occupied = data.is_occupied !== undefined ? Boolean(data.is_occupied) : (isDemo ? Boolean(demoData.is_occupied) : anyOn);
  const pirActive = data.pir_detected !== undefined ? Boolean(data.pir_detected) : (isDemo ? Boolean(demoData.pir_detected) : false);
  const mmwaveActive = data.mmwave_detected !== undefined ? Boolean(data.mmwave_detected) : (isDemo ? Boolean(demoData.mmwave_detected) : false);
  const allOn = Object.values(ports).every(p => p.relay_status);
  const activeCount = Object.values(ports).filter(p => p.relay_status).length;
  const drawingCount = Object.values(ports).filter(p => p.relay_status && (Number(p.power_watts) > 6 || Number(p.current_amps) > 0.08)).length;
  
  // `|| 0` guards a null node, but RTDB can also hand back a numeric STRING ("301.5") — coerce
  // before any .toFixed() or the whole page throws a TypeError and unmounts.
  const computedTotalWatts = Number(
    data.total_power_watts || Object.values(ports).reduce((acc, curr) => acc + (Number(curr.power_watts) || 0), 0)
  ) || 0;

  // The voltage to assume when a port does not report one. Prefer, in order: a measured port
  // voltage, then the nominal the DEVICE is configured with (settings/nominal_voltage — the same
  // number the firmware multiplies by), and only then the 220 V fallback. The old code jumped
  // straight to 220, so a device configured for 230 V had its VA recomputed here at 220 — two
  // different assumptions in one screen, 4.5 % apart.
  const systemVoltage = Number(
    Object.values(ports).find(p => Number(p.voltage) > 0)?.voltage ||
    data.voltage ||
    data.settings?.nominal_voltage ||
    220
  );

  // System-wide average power factor
  const totalSystemVa = Object.values(ports).reduce((acc, curr) => {
    const isDrawing = curr.relay_status && (Number(curr.power_watts) > 6 || Number(curr.current_amps) > 0.08);
    const pVolts = Number(curr.voltage) > 0 ? Number(curr.voltage) : systemVoltage;
    const pAmps = isDrawing ? (Number(curr.current_amps) || 0) : 0;
    return acc + (pVolts * pAmps);
  }, 0);
  // No fallback value. If VA is unknown or the device reports no watts, the PF is UNKNOWN (0.00),
  // not 0.95 — a fabricated 0.95 here used to feed straight into the per-port wattage below.
  const systemAvgPf = totalSystemVa > 0 && computedTotalWatts > 0
    ? Math.min(1.0, Number((computedTotalWatts / totalSystemVa).toFixed(2)))
    : 0.00;

  // Does this device MEASURE voltage, or assume it?
  //
  // The firmware reports `voltage_source: "measured"` only when a voltage sensor is fitted, enabled
  // and calibrated. That single flag decides what the power figures actually mean:
  //
  //   measured  -> real power in WATTS, computed as mean(v*i) — phase-correct
  //   otherwise -> APPARENT power in VA, computed as I_rms * a configured voltage
  //
  // Showing the wrong unit is not a cosmetic slip: VA can be 30-50% higher than W for exactly the
  // switch-mode loads this device monitors, so labelling VA as "W" would overstate every reading by
  // an amount the user cannot see. Default to VA — the honest default for an unknown device, and
  // the one that matches a device with no sensor at all.
  const powerIsMeasured = data.voltage_source === 'measured';

  // Inactivity limit in seconds or minutes, synced from firmware / RTDB settings
  const inactivityLimitSeconds = Number(
    data.settings?.inactivity_limit_seconds ??
    data.inactivity_limit_seconds ??
    ((data.inactivity_limit || 15) * 60)
  );
  const isSubMinuteInactivity = inactivityLimitSeconds < 60;
  const inactivityDisplayVal = isSubMinuteInactivity
    ? inactivityLimitSeconds
    : Math.round(inactivityLimitSeconds / 60);
  const inactivityDisplayUnit = isSubMinuteInactivity ? 'sec' : 'min';

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const handleTogglePort = (portId, currentStatus) => {
    const nextStatus = !currentStatus;

    if (isDemo) {
      setDemoData(prev => ({
        ...prev,
        ports: {
          ...prev.ports,
          [portId]: {
            ...prev.ports[portId],
            relay_status: nextStatus,
            power_watts: nextStatus ? (portId === 'port_01' ? 15.5 : portId === 'port_02' ? 145.2 : 0) : 0,
            current_amps: nextStatus ? (portId === 'port_01' ? 0.12 : portId === 'port_02' ? 1.2 : 0) : 0,
          }
        }
      }));
      return;
    }

    // 1. Instant 0ms visual feedback: switch flips immediately under the user's finger
    setOptimisticRelays(prev => ({ ...prev, [portId]: nextStatus }));
    targetStatusRef.current[portId] = nextStatus;
    lastUserActionRef.current[portId] = Date.now();
    setActionError(null);

    // 2. Coalesce rapid clicks: cancel any pending dispatch for this port
    if (debounceTimersRef.current[portId]) {
      clearTimeout(debounceTimersRef.current[portId]);
    }

    // 3. Debounce network dispatch by 250ms: rapid spamming only sends the final desired state
    debounceTimersRef.current[portId] = setTimeout(async () => {
      debounceTimersRef.current[portId] = null;
      const targetState = targetStatusRef.current[portId];
      try {
        const ok = await togglePortRelay(portId, targetState);
        if (!ok) throw new Error('Write failed');
      } catch (err) {
        console.error(err);
        setOptimisticRelays(prev => {
          const next = { ...prev };
          delete next[portId];
          return next;
        });
        reportFailure(`Could not turn ${targetState ? 'on' : 'off'} this port. Check your connection.`);
      }
    }, 250);
  };

  const handleMasterOn = async () => {
    const now = Date.now();
    ['port_01', 'port_02', 'port_03'].forEach(p => {
      if (debounceTimersRef.current[p]) clearTimeout(debounceTimersRef.current[p]);
      debounceTimersRef.current[p] = null;
      targetStatusRef.current[p] = true;
      lastUserActionRef.current[p] = now;
    });
    setOptimisticRelays({ port_01: true, port_02: true, port_03: true });
    setTurningOn(true);
    if (isDemo) {
      setDemoData(prev => {
        const newPorts = { ...prev.ports };
        Object.keys(newPorts).forEach(p => {
          newPorts[p] = { 
            ...newPorts[p], 
            relay_status: true,
            power_watts: p === 'port_01' ? 15.5 : p === 'port_02' ? 145.2 : 45.0,
            current_amps: p === 'port_01' ? 0.12 : p === 'port_02' ? 1.2 : 0.4
          };
        });
        return { ...prev, ports: newPorts };
      });
    } else {
      setActionError(null);
      await toggleMasterRelay(true, ports);
    }
    clearTimeout(masterTimerRef.current);
    masterTimerRef.current = setTimeout(() => setTurningOn(false), 300);
  };

  const handleMasterOff = async () => {
    const now = Date.now();
    ['port_01', 'port_02', 'port_03'].forEach(p => {
      if (debounceTimersRef.current[p]) clearTimeout(debounceTimersRef.current[p]);
      debounceTimersRef.current[p] = null;
      targetStatusRef.current[p] = false;
      lastUserActionRef.current[p] = now;
    });
    setOptimisticRelays({ port_01: false, port_02: false, port_03: false });
    setTurningOff(true);
    if (isDemo) {
      setDemoData(prev => {
        const newPorts = { ...prev.ports };
        Object.keys(newPorts).forEach(p => {
          newPorts[p] = { ...newPorts[p], relay_status: false, power_watts: 0, current_amps: 0 };
        });
        return { ...prev, ports: newPorts };
      });
    } else {
      setActionError(null);
      await toggleMasterRelay(false, ports);
    }
    clearTimeout(masterTimerRef.current);
    masterTimerRef.current = setTimeout(() => setTurningOff(false), 300);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-5 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-10">
      


      {actionError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-2xl flex items-start justify-between gap-3 text-sm font-medium animate-in fade-in slide-in-from-top-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-red-400 hover:text-red-700 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {isDemo && (
        <div className="bg-maroon-50 border border-maroon-100 text-maroon-800 px-4 py-3 rounded-2xl flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-maroon-600" />
            <span>No device paired. Showing demo data.</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDemoData(prev => ({
                ...prev,
                state: prev.state === 'RESPONSE_WINDOW' ? 'OCCUPIED' : 'RESPONSE_WINDOW',
                countdown_remaining_seconds: prev.state === 'RESPONSE_WINDOW' ? undefined : 101
              }))}
              className="text-xs font-semibold text-maroon-700 hover:text-maroon-900 underline underline-offset-2 transition-colors"
            >
              {demoData.state === 'RESPONSE_WINDOW' ? 'Hide Alert' : 'Simulate Alert'}
            </button>
            <Link to="/settings" viewTransition className="bg-maroon-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-maroon-900 transition-colors">
              Pair Device
            </Link>
          </div>
        </div>
      )}
      
      {data.state === 'RESPONSE_WINDOW' && (
        <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center text-white relative overflow-hidden mb-2 animate-in fade-in slide-in-from-top-4">
           {/* Side icon placed in the side like Night Mode & Inactivity Limit cards, but blinking */}
           <AlertTriangle
             strokeWidth={1.5}
             className="absolute -right-3 -bottom-3 w-28 h-28 md:w-36 md:h-36 text-white/25 transform rotate-12 pointer-events-none animate-pulse"
           />
           <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-widest text-center relative z-10">Auto Shutdown In</h2>
           {/* Fall back to the FIRMWARE's real response window (5 minutes), not 60 seconds — the
               alert text says "60 seconds" but RESPONSE_WINDOW_MS is 300000. Showing 60 here would
               understate the time the user actually has, and could make them rush a decision. */}
           <div className="text-6xl sm:text-7xl font-black drop-shadow-md my-4 relative z-10">{data.countdown_remaining_seconds ?? (settings.response_window_seconds || 300)}s</div>
           <button
             onClick={async () => {
               setOverridePending(true);
               if (isDemo) {
                 setDemoData(prev => ({ ...prev, state: 'OCCUPIED' }));
               }
               const ok = await setOverride(true);
               setOverridePending(false);
               // This is the highest-stakes control in the app: if the write fails silently the
               // room powers down anyway, so say so plainly rather than letting the button appear
               // to have worked.
               if (!ok) {
                 reportFailure('Could not cancel the shutdown — the room may still power off. Try again now.');
               }
             }}
             disabled={overridePending}
             aria-label="Keep Power On (Override Shutdown)"
             className="relative z-10 bg-white text-red-600 px-8 py-3 rounded-full font-bold text-lg shadow-lg hover:scale-105 active:scale-95 transition-all uppercase tracking-wider focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50 disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-2"
           >
             {overridePending ? <><Loader2 className="w-5 h-5 animate-spin" /> Cancelling…</> : 'Keep Power On'}
           </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-5">
        <div className="joyride-system-load lg:col-span-7 h-full bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 md:p-6 rounded-3xl shadow-2xl shadow-maroon-900/30 text-white relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-maroon-500/20 rounded-full blur-2xl translate-y-1/3 -translate-x-1/4" />
          
          <div>
            <div className="flex items-center justify-between mb-4 relative z-10">
              <h2 className="text-sm font-bold uppercase tracking-widest text-maroon-100/80">System Load</h2>
              <div className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded-full backdrop-blur-sm border ${
                occupied
                  ? 'bg-white/20 border-white/30 text-white' 
                  : 'bg-black/20 border-black/30 text-maroon-200'
              }`}>
                {occupied ? 'Occupied' : 'Idle'}
              </div>
            </div>
            <div className="flex items-baseline gap-2 relative z-10">
              <span className="text-5xl md:text-6xl font-bold tracking-tighter drop-shadow-sm">{computedTotalWatts.toFixed(0)}</span>
              <span className="text-base md:text-lg font-bold text-maroon-200 uppercase tracking-widest">
                {powerIsMeasured ? 'W' : 'VA'}
              </span>
            </div>
            <p className="text-[10px] text-maroon-200/80 mt-2 font-medium uppercase tracking-widest relative z-10">
              {powerIsMeasured ? `Real power • System PF ${systemAvgPf.toFixed(2)}` : 'Apparent power, all active ports'}
            </p>
          </div>
        </div>

        <div className="joyride-master-power lg:col-span-5 h-full bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-6 flex flex-col justify-between animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-900 mb-0.5">Master Power</h2>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                {activeCount} / {Object.keys(ports).length} ON • {drawingCount} In Use
              </p>
              {!activeDeviceId && (
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Turn all ports on or off at once.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleMasterOn}
              disabled={allOn || turningOn}
              className={`flex-1 py-4 px-4 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center transition-all duration-300 ease-out ${
                allOn || turningOn 
                  ? 'bg-gray-100/80 border-2 border-transparent text-gray-400 cursor-not-allowed' 
                  : 'bg-white border-2 border-maroon-800 text-maroon-800 shadow-sm active:scale-[0.98]'
              }`}
            >
              {turningOn ? <Loader2 className="w-5 h-5 animate-spin" /> : 'All On'}
            </button>
            <button 
              onClick={handleMasterOff}
              disabled={!anyOn || turningOff}
              className={`flex-1 py-4 px-4 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center transition-all duration-300 ease-out ${
                !anyOn || turningOff 
                  ? 'bg-gray-100/80 border-2 border-transparent text-gray-400 cursor-not-allowed' 
                  : 'bg-maroon-800 border-2 border-maroon-800 text-white shadow-sm active:scale-[0.98]'
              }`}
            >
              {turningOff ? <Loader2 className="w-5 h-5 animate-spin" /> : 'All Off'}
            </button>
          </div>
        </div>
      </div>

      <div className={`grid gap-3 md:gap-5 mb-2 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both ${
        nightMode.enabled ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2'
      }`}>
        {nightMode.enabled && (
          <div className="joyride-night-mode relative bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-5 flex flex-col justify-between group overflow-hidden">
            <Moon strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12 pointer-events-none" />
            <div className="relative z-10">
              <h3 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Night Mode</h3>
              <p className="text-sm md:text-lg font-bold text-gray-900 leading-tight">
                {formatTime(nightMode.start_time)}<br className="md:hidden" /> - {formatTime(nightMode.end_time)}
              </p>
              {/* Whether the schedule is in effect RIGHT NOW, not just what it is set to. The device
                  publishes `night_mode_active` every cycle; showing it means the user can tell that
                  the room is currently being held occupied rather than guessing from the clock. */}
              {activeDeviceId && (
                <p className={`text-[10px] font-bold uppercase tracking-widest mt-1.5 ${
                  data.night_mode_active ? 'text-maroon-700' : 'text-gray-300'
                }`}>
                  {data.night_mode_active ? 'Active now' : 'Not active'}
                </p>
              )}
              {!activeDeviceId && (
                <p className="hidden md:block text-[10px] text-gray-400 mt-1.5 font-medium">Schedule auto-shutoff while you sleep.</p>
              )}
            </div>
          </div>
        )}

        <div className="joyride-inactivity-limit relative bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-5 flex flex-col justify-between group overflow-hidden col-span-1">
          <Timer strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Inactivity Limit</h3>
            <div className="flex items-baseline gap-1 md:gap-1.5 leading-none mt-0.5">
              <span className="text-2xl md:text-xl font-bold text-gray-900">{inactivityDisplayVal}</span>
              <span className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">{inactivityDisplayUnit}</span>
            </div>
            {!activeDeviceId && (
              <p className="hidden md:block text-[10px] text-gray-400 mt-1 font-medium">Auto-shutdown when room is empty.</p>
            )}
            {activeDeviceId && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1.5">Countdown threshold</p>
            )}
          </div>
        </div>

        {/* Bento Card 3: Dual Presence Sensing Indicator */}
        <div className={`joyride-dual-presence relative bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-5 flex flex-col justify-between overflow-hidden ${
          nightMode.enabled ? 'col-span-2 lg:col-span-1' : 'col-span-1'
        }`}>
          <Radar strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Dual Presence</h3>
            <p className="text-sm md:text-base font-bold text-gray-900 leading-tight">
              {occupied ? 'Occupant Present' : 'Room Vacant'}
            </p>
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs transition-all duration-300 border ${
                pirActive 
                  ? 'bg-maroon-800 text-white border-maroon-800 font-bold shadow-sm shadow-maroon-900/20' 
                  : 'bg-gray-100 text-gray-400 border-transparent font-medium'
              }`}>
                PIR Motion
              </span>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs transition-all duration-300 border ${
                mmwaveActive 
                  ? 'bg-maroon-800 text-white border-maroon-800 font-bold shadow-sm shadow-maroon-900/20' 
                  : 'bg-gray-100 text-gray-400 border-transparent font-medium'
              }`}>
                mmWave Radar
              </span>
            </div>
            {data.radar_uart_connected && (
              <div className="text-[10px] font-mono text-gray-500 mt-2 flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span>
                  {data.radar_distance_cm ? `${data.radar_distance_cm} cm` : 'Gated'} · {data.radar_static_energy ?? 0}% breathing · {data.radar_target_state || 'tracking'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="joyride-ports-list animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap sm:flex-nowrap">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Port Management</h2>
        </div>
        {!activeDeviceId && (
          <p className="text-[10px] text-gray-400 mb-4 font-medium">Toggle and view power draw for each smart port.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {['port_01', 'port_02', 'port_03'].map((portId, index) => {
            const portData = ports[portId] || {};
            const portNumber = portId === 'port_01' ? 1 : portId === 'port_02' ? 2 : 3;
            const displayName = `Port ${portNumber}`;
            const conn = getPortConnectionState(portData);
            const rawAmps = Number(portData.current_amps) || 0;
            const rawWatts = Number(portData.power_watts) || 0;
            const portVolts = Number(portData.voltage) > 0 ? Number(portData.voltage) : systemVoltage;
            const portAmps = portData.relay_status ? (rawAmps > 0.02 ? rawAmps : 0) : 0;
            const isDrawing = portData.relay_status && (portAmps > 0.02 || rawWatts > 2.0 || conn.isDrawing);
            const calculatedWatts = (portVolts * portAmps).toFixed(1);
            const portWatts = portData.relay_status && (isDrawing || portAmps > 0.02)
              ? (rawWatts > 0.5 ? rawWatts.toFixed(1) : calculatedWatts)
              : '0.0';
            const displayWatts = portWatts;
            const portPowerUnit = 'W';

            return (
              <div 
                key={portId} 
                className="bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.03)] p-4 md:p-5 flex flex-col justify-between gap-4 transition-all duration-500 ease-apple-spring animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" 
                style={{ animationDelay: `${400 + (index * 100)}ms` }}
              >
                {/* Header: Icon, Name + Status, Toggle Switch */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div 
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition-all duration-300 ${
                        !portData.relay_status 
                          ? 'bg-gray-100/80 text-gray-400 border-gray-200/80 shadow-inner' 
                          : isDrawing 
                          ? 'bg-maroon-50 text-maroon-800 border-maroon-200 shadow-inner' 
                          : 'bg-maroon-50/50 text-maroon-700 border-maroon-100 shadow-inner'
                      }`}
                    >
                      <Plug strokeWidth={1.5} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-gray-900 leading-tight">
                        {displayName}
                      </h3>
                      <div className="mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border transition-all duration-300 ${
                          !portData.relay_status
                            ? 'bg-gray-100 text-gray-500 border-gray-200/90'
                            : isDrawing
                            ? 'bg-maroon-800 text-white border-maroon-900'
                            : 'bg-maroon-100/80 text-maroon-900 border-maroon-300/80'
                        }`}>
                          {!portData.relay_status ? 'Switched Off' : isDrawing ? 'In Use' : 'Standby'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Apple-style Toggle Switch */}
                  <button
                    onClick={() => handleTogglePort(portId, portData.relay_status)}
                    aria-label={`Toggle ${displayName} ${portData.relay_status ? 'Off' : 'On'}`}
                    className={`relative w-12 h-7 shrink-0 rounded-full flex items-center p-1 transition-colors duration-300 ease-apple-spring focus:outline-none focus-visible:ring-4 focus-visible:ring-maroon-500/30 active:scale-95 ${
                      portData.relay_status ? 'bg-maroon-800' : 'bg-gray-200'
                    }`}
                  >
                    <div className="absolute -inset-2" aria-hidden="true"></div>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-sm flex items-center justify-center transform transition-transform duration-500 ease-apple-spring ${
                      portData.relay_status ? 'translate-x-5' : 'translate-x-0'
                    }`}>
                      {pendingPorts[portId] && (
                        <Loader2 className="w-3 h-3 animate-spin text-maroon-800" />
                      )}
                    </div>
                  </button>
                </div>

                {/* Integrated Metrics Row: Power on Left, Voltage & Current on Right */}
                <div className="flex items-end justify-between gap-3 pt-3 border-t border-gray-100">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">Power</span>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-2xl md:text-3xl font-bold tracking-tight transition-colors duration-500 ${
                        isDrawing ? 'text-gray-900 font-extrabold' : 'text-gray-400'
                      }`}>
                        {portData.relay_status ? displayWatts : '0.0'}
                      </span>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{portPowerUnit}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 text-right">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">Voltage</span>
                      <span className={`text-xs md:text-sm font-semibold whitespace-nowrap transition-colors duration-500 ${
                        portData.relay_status ? 'text-gray-800' : 'text-gray-400'
                      }`}>
                        {portData.relay_status ? `${portVolts.toFixed(0)} V` : '0 V'}
                      </span>
                    </div>
                    <div className="w-px h-6 bg-gray-200/80 self-center" />
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">Current</span>
                      <span className={`text-xs md:text-sm font-semibold whitespace-nowrap transition-colors duration-500 ${
                        isDrawing ? 'text-maroon-800 font-bold' : portData.relay_status ? 'text-gray-600' : 'text-gray-400'
                      }`}>
                        {portAmps.toFixed(2)} A
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
