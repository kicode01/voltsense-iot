import { useState, useEffect, useRef } from 'react';
import { useRoomData } from '../hooks/useRoomData';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { Zap, Moon, AlertTriangle, Pencil, Fan, Lamp, Smartphone, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import MarqueeText from '../components/MarqueeText';

const iconMap = {
  lamp: Lamp,
  fan: Fan,
  smartphone: Smartphone,
  zap: Zap
};

const defaultIcons = {
  port_01: 'lamp',
  port_02: 'fan',
  port_03: 'smartphone'
};

const Dashboard = () => {
  const { activeDeviceId, devicesLoading } = useDeviceContext();

  const { roomData, loading: roomLoading, toggleMasterRelay, togglePortRelay, updatePortName, setOverride, updatePortIcon } = useRoomData(activeDeviceId);
  
  const [editingPort, setEditingPort] = useState(null);
  const [editName, setEditName] = useState('');
  const [isRenameMode, setIsRenameMode] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  // Which ports have a toggle in flight, so the switch can show a spinner instead of looking
  // stuck. A relay command can be suppressed by the firmware's derating rules or fail outright, and
  // without this the control simply appears unresponsive for as long as the write takes.
  const [pendingPorts, setPendingPorts] = useState({});
  const [overridePending, setOverridePending] = useState(false);
  // The last action that failed, shown as a dismissible banner. Every write in useRoomData can
  // fail (offline, permission revoked, rules denial) and previously did so silently — the worst
  // case being "Keep Power On", where a silent failure means the room goes dark anyway.
  const [actionError, setActionError] = useState(null);

  const reportFailure = (message) => setActionError(message);

  // The master on/off spinner clears on a timer. Without this ref + cleanup the timer can fire
  // after the page unmounts (navigating away mid-toggle), which is a state update on a dead tree.
  const masterTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(masterTimerRef.current), []);



  const [demoData, setDemoData] = useState({
    settings: { night_mode_enabled: true, night_mode_start: '22:00', night_mode_end: '06:00' },
    ports: {
      port_01: { name: 'Demo Light', relay_status: true, power_watts: 15.5, current_amps: 0.12 },
      port_02: { name: 'Demo Workstation', relay_status: true, power_watts: 145.2, current_amps: 1.2 },
      port_03: { name: 'Demo Appliance', relay_status: false, power_watts: 0, current_amps: 0 }
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
    port_01: { name: 'Light', relay_status: false, power_watts: 0, current_amps: 0 },
    port_02: { name: 'Workstation', relay_status: false, power_watts: 0, current_amps: 0 },
    port_03: { name: 'Appliance', relay_status: false, power_watts: 0, current_amps: 0 }
  };
  
  // Deep merge Firebase data with default ports so names and default fields aren't wiped out
  const ports = { ...defaultPorts };
  if (data.ports) {
    Object.keys(data.ports).forEach(key => {
      // If it's a valid port_XX that shouldn't exceed 3 ports, we can restrict it if needed,
      // but let's just deep merge any valid default port, and ignore ghost ports like port_04
      if (ports[key]) {
        ports[key] = { ...ports[key], ...data.ports[key] };
      }
    });
  }
  const anyOn = Object.values(ports).some(p => p.relay_status);
  // REAL occupancy, published by the device from its sensors (motion, or night mode forcing
  // "occupied"). The badge previously showed whether any relay happened to be energised, which is a
  // different question — a room can be occupied with everything off, or idle with a charger running.
  // Fall back to the old signal only when the device does not publish the field.
  const occupied = data.is_occupied !== undefined ? Boolean(data.is_occupied) : anyOn;
  const allOn = Object.values(ports).every(p => p.relay_status);
  const activeCount = Object.values(ports).filter(p => p.relay_status).length;
  
  // `|| 0` guards a null node, but RTDB can also hand back a numeric STRING ("301.5") — coerce
  // before any .toFixed() or the whole page throws a TypeError and unmounts.
  const computedTotalWatts = Number(
    data.total_power_watts || Object.values(ports).reduce((acc, curr) => acc + (Number(curr.power_watts) || 0), 0)
  ) || 0;

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

  // Inactivity limit comes from the device; fall back to the firmware default only when absent.
  const inactivityLimitMinutes = Number(data.inactivity_limit ?? 15);

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const handleTogglePort = async (portId, newStatus) => {
    if (isDemo) {
      setDemoData(prev => ({
        ...prev,
        ports: {
          ...prev.ports,
          [portId]: {
            ...prev.ports[portId],
            relay_status: newStatus,
            power_watts: newStatus ? (portId === 'port_01' ? 15.5 : portId === 'port_02' ? 145.2 : 45.0) : 0,
            current_amps: newStatus ? (portId === 'port_01' ? 0.12 : portId === 'port_02' ? 1.2 : 0.4) : 0,
          }
        }
      }));
      return;
    }

    setPendingPorts(prev => ({ ...prev, [portId]: true }));
    setActionError(null);
    const ok = await togglePortRelay(portId, newStatus);
    setPendingPorts(prev => ({ ...prev, [portId]: false }));
    if (!ok) {
      // Say what did NOT happen. The switch will snap back on the next snapshot, but without this
      // the user only sees a control that refuses to move.
      reportFailure(
        `Could not turn ${newStatus ? 'on' : 'off'} this port. Check your connection — the device may also be limiting how fast the relay can switch.`
      );
    }
  };

  const handleMasterOn = async () => {
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
      const ok = await toggleMasterRelay(true, ports);
      if (!ok) reportFailure('Could not turn all ports on. Check your connection and try again.');
    }
    clearTimeout(masterTimerRef.current);
    masterTimerRef.current = setTimeout(() => setTurningOn(false), 500);
  };

  const handleMasterOff = async () => {
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
      const ok = await toggleMasterRelay(false, ports);
      if (!ok) reportFailure('Could not turn all ports off. Check your connection and try again.');
    }
    clearTimeout(masterTimerRef.current);
    masterTimerRef.current = setTimeout(() => setTurningOff(false), 500);
  };

  const handleNameEdit = (portId, currentName) => {
    setEditingPort(portId);
    setEditName(currentName);
  };

  const handleNameSave = (portId) => {
    if (editName.trim()) {
      if (isDemo) {
        setDemoData(prev => ({
          ...prev,
          ports: {
            ...prev.ports,
            [portId]: {
              ...prev.ports[portId],
              name: editName.trim()
            }
          }
        }));
      } else {
        updatePortName(portId, editName.trim());
      }
    }
    setEditingPort(null);
  };

  const handleIconCycle = async (portId, currentIconName) => {
    if (!isRenameMode) return;
    const icons = ['lamp', 'fan', 'smartphone'];
    let currentIndex = icons.indexOf(currentIconName);
    if (currentIndex === -1) currentIndex = 0;
    const nextIconName = icons[(currentIndex + 1) % icons.length];
    
    if (isDemo) {
      setDemoData(prev => ({
        ...prev,
        ports: {
          ...prev.ports,
          [portId]: {
            ...prev.ports[portId],
            icon: nextIconName
          }
        }
      }));
    } else {
      await updatePortIcon(portId, nextIconName);
    }
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
          <Link to="/settings" viewTransition className="bg-maroon-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-maroon-900 transition-colors">
            Pair Device
          </Link>
        </div>
      )}
      
      {data.state === 'RESPONSE_WINDOW' && (
        <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-3xl p-6 shadow-2xl flex flex-col items-center justify-center text-white relative overflow-hidden mb-2 animate-in fade-in slide-in-from-top-4">
           <AlertTriangle className="w-12 h-12 mb-2 animate-pulse" />
           <h2 className="text-2xl font-bold uppercase tracking-widest text-center">Auto Shutdown In</h2>
           {/* Fall back to the FIRMWARE's real response window (5 minutes), not 60 seconds — the
               alert text says "60 seconds" but RESPONSE_WINDOW_MS is 300000. Showing 60 here would
               understate the time the user actually has, and could make them rush a decision. */}
           <div className="text-7xl font-black drop-shadow-md my-4">{data.countdown_remaining_seconds ?? 300}s</div>
           <button
             onClick={async () => {
               setOverridePending(true);
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
             className="relative bg-white text-red-600 px-8 py-3 rounded-full font-bold text-lg shadow-lg hover:scale-105 active:scale-95 transition-all uppercase tracking-wider focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50 disabled:opacity-70 disabled:hover:scale-100 flex items-center justify-center gap-2"
           >
             {overridePending ? <><Loader2 className="w-5 h-5 animate-spin" /> Cancelling…</> : 'Keep Power On'}
           </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="joyride-system-load h-full bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 md:p-6 rounded-3xl shadow-2xl shadow-maroon-900/30 text-white relative overflow-hidden transition-transform duration-500 hover:-translate-y-1 flex flex-col justify-between">
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
              {/* Unit follows the device's actual capability — W only when a voltage sensor is
                  fitted, enabled and calibrated; VA otherwise. */}
              <span
                className="text-base md:text-lg font-bold text-maroon-200 uppercase tracking-widest"
                title={
                  powerIsMeasured
                    ? 'Real power (W) — measured from the voltage and current waveforms, so power factor is accounted for.'
                    : 'Apparent power (VA) — no voltage sensing on this device, so power factor cannot be measured and the real draw is typically lower.'
                }
              >
                {powerIsMeasured ? 'W' : 'VA'}
              </span>
            </div>
          </div>

          {!activeDeviceId ? (
            <p className="text-[10px] text-maroon-200/60 mt-3 font-medium uppercase tracking-widest">
              {powerIsMeasured ? 'Real power, all active ports' : 'Apparent power, all active ports'}
            </p>
          ) : (
             <div className="mt-3"></div>
          )}
        </div>

        <div className="joyride-master-power h-full bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-6 flex flex-col justify-between animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-gray-900 mb-0.5">Master Power</h2>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{activeCount} / {Object.keys(ports).length} Active</p>
              {!activeDeviceId && (
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Turn all ports on or off at once.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleMasterOn}
              disabled={allOn || turningOn}
              className={`flex-1 py-4 px-4 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center transition-all duration-500 ease-apple-spring transform-gpu hover:scale-[1.02] active:scale-[0.98] ${
                allOn 
                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed hover:scale-100 active:scale-100' 
                  : 'bg-white border-2 border-maroon-800 text-maroon-800 hover:bg-maroon-50 shadow-sm'
              }`}
            >
              {turningOn ? <Loader2 className="w-5 h-5 animate-spin" /> : 'All On'}
            </button>
            <button 
              onClick={handleMasterOff}
              disabled={!anyOn || turningOff}
              className={`flex-1 py-4 px-4 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center transition-all duration-500 ease-apple-spring transform-gpu hover:scale-[1.02] active:scale-[0.98] ${
                !anyOn 
                  ? 'bg-gray-50 text-gray-400 cursor-not-allowed hover:scale-100 active:scale-100' 
                  : 'bg-maroon-800 text-white hover:bg-maroon-900 hover:shadow-lg hover:shadow-maroon-900/20'
              }`}
            >
              {turningOff ? <Loader2 className="w-5 h-5 animate-spin" /> : 'All Off'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-5 mb-2 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both">
        {nightMode.enabled && (
          <div className="joyride-night-mode relative bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-5 flex flex-col group overflow-hidden">
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

        <div className={`joyride-inactivity-limit relative bg-white/70 backdrop-blur-2xl border border-white/40 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-500 ease-apple-spring p-4 md:p-5 flex flex-col group overflow-hidden ${!nightMode.enabled ? 'col-span-2' : ''}`}>
          <AlertTriangle strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Inactivity Limit</h3>
            <div className="flex items-baseline gap-1 md:gap-1.5 leading-none mt-0.5">
              <span className="text-2xl md:text-xl font-bold text-gray-900">{inactivityLimitMinutes}</span>
              <span className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wider">min</span>
            </div>
            {!activeDeviceId && (
              <p className="hidden md:block text-[10px] text-gray-400 mt-1 font-medium">Auto-shutdown when room is empty.</p>
            )}
          </div>
        </div>
      </div>

      <div className="joyride-ports-list animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Port / Device Management</h2>
          <button 
            onClick={() => {
              if (isRenameMode && editingPort) {
                handleNameSave(editingPort);
              }
              setIsRenameMode(!isRenameMode);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${isRenameMode ? 'bg-maroon-800 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          >
            {isRenameMode ? 'Done' : <><Pencil strokeWidth={1.5} className="w-3 h-3" /> Edit</>}
          </button>
        </div>
        {!activeDeviceId && (
          <p className="text-[10px] text-gray-400 mb-4 font-medium">Toggle, rename, and view power draw for each smart port.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {Object.entries(ports).map(([portId, portData], index) => {
            const portIconName = portData.icon || defaultIcons[portId] || 'zap';
            const Icon = iconMap[portIconName] || Zap;
            const displayName = portData.name || 'Unknown Device';

            return (
            <div key={portId} className={`bg-white/70 backdrop-blur-2xl border ${isRenameMode ? 'border-maroon-300 ring-2 ring-maroon-100' : 'border-white/40'} rounded-[20px] shadow-[0_4px_20px_rgb(0,0,0,0.03)] transition-all duration-500 ease-apple-spring p-3 md:p-4 flex items-center gap-3 md:gap-4 group animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both`} style={{ animationDelay: `${400 + (index * 100)}ms` }}>
              <button 
                onClick={() => handleIconCycle(portId, portIconName)}
                disabled={!isRenameMode}
                className={`w-10 h-10 md:w-12 md:h-12 shrink-0 rounded-2xl flex items-center justify-center transition-all duration-500 relative ${
                  portData.relay_status ? 'bg-maroon-50 text-maroon-800 shadow-inner' : 'bg-gray-50 text-gray-400'
                } ${isRenameMode ? 'cursor-pointer hover:scale-105 hover:bg-maroon-100 hover:text-maroon-900 ring-2 ring-maroon-300 ring-offset-2' : 'cursor-default'}`}
              >
                <Icon strokeWidth={1.5} className="w-5 h-5 transition-transform duration-500 ease-apple-spring group-hover:scale-110" />
                {isRenameMode && (
                  <div className="absolute -bottom-1 -right-1 bg-maroon-500 text-white rounded-full p-0.5 shadow-sm border-2 border-white">
                    <Pencil className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
              
              <div className="flex flex-col flex-1 min-w-0 pr-2">
                {editingPort === portId ? (
                  <div className="relative flex items-center w-full max-w-full p-1 -m-1">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleNameSave(portId)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNameSave(portId)}
                      className="text-[16px] md:text-[15px] font-bold text-maroon-900 bg-maroon-50 rounded px-1 -mx-1 w-full outline-none ring-1 ring-maroon-200 focus:ring-2 focus:ring-maroon-500 transition-all leading-tight border-0 py-0"
                      autoFocus
                    />
                  </div>
                ) : isRenameMode ? (
                  <button 
                    onClick={() => handleNameEdit(portId, displayName)}
                    className="relative flex items-center gap-1.5 w-full max-w-full p-1 -m-1 group/edit rounded hover:bg-black/5 transition-colors text-left outline-none focus-visible:ring-2 focus-visible:ring-maroon-500"
                  >
                    <span className="text-[14px] md:text-[15px] font-bold text-gray-900 leading-tight flex-1 min-w-0 truncate group-hover/edit:text-maroon-700 transition-colors">
                      {displayName}
                    </span>
                    <Pencil className="w-3.5 h-3.5 text-maroon-300 opacity-50 group-hover/edit:opacity-100 shrink-0 transition-opacity" />
                  </button>
                ) : (
                  <div className="relative flex items-center w-full max-w-full p-1 -m-1">
                    <MarqueeText 
                      text={displayName} 
                      className="text-[14px] md:text-[15px] font-bold text-gray-900 leading-tight flex-1 min-w-0 transition-colors"
                    />
                  </div>
                )}
                
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-0.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${portData.relay_status ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-gray-400 transition-colors duration-500">
                      {portData.relay_status ? 'Active' : 'Offline'}
                    </span>
                  </div>
                  <span className="text-gray-300 text-[10px] hidden sm:inline">•</span>
                  <div className="flex items-center gap-2">
                    {/* W with a voltage sensor, VA without. The difference is not cosmetic: the
                        ACS712 measures current only, so without voltage sensing this is V x A with
                        no power-factor correction, and a switch-mode load at PF 0.6 draws ~40% less
                        real power than it shows. The unit must follow the hardware. */}
                    <span
                      className="text-[10px] md:text-[11px] font-bold text-gray-600 tracking-tight"
                      title={
                        powerIsMeasured
                          ? 'Real power (W), measured from the voltage and current waveforms.'
                          : 'Apparent power (VA). No voltage sensing, so this is not real power in watts.'
                      }
                    >
                      {(Number(portData.power_watts) || 0).toFixed(1)} {powerIsMeasured ? 'W' : 'VA'}
                    </span>
                    <span className="text-[10px] md:text-[11px] font-bold text-gray-400 tracking-tight">
                      {(Number(portData.current_amps) || 0).toFixed(2)} A
                    </span>
                    {/* Measured mains voltage at the socket. Only shown when a voltage sensor is
                        actually fitted (powerIsMeasured), because otherwise it is just the configured
                        assumption. This was one of the firmware's published-but-ignored fields. */}
                    {powerIsMeasured && Number(portData.voltage) > 0 && (
                      <span
                        className="text-[10px] md:text-[11px] font-bold text-gray-400 tracking-tight"
                        title="Measured mains voltage at this socket."
                      >
                        {Number(portData.voltage).toFixed(0)} V
                      </span>
                    )}
                    {/* Power factor, shown only when it was actually measured. A hard-coded or
                        assumed PF would be worse than showing nothing — it is a property of the
                        load, not of the device. */}
                    {powerIsMeasured && Number(portData.power_factor) > 0 && (
                      <span
                        className="text-[10px] md:text-[11px] font-bold text-gray-400 tracking-tight"
                        title="Measured power factor (real power / apparent power)."
                      >
                        PF {Number(portData.power_factor).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleTogglePort(portId, !portData.relay_status)}
                  disabled={pendingPorts[portId]}
                  aria-label={`Toggle ${displayName} ${portData.relay_status ? 'Off' : 'On'}`}
                  aria-busy={pendingPorts[portId] ? 'true' : 'false'}
                  className={`relative w-12 h-7 shrink-0 rounded-full flex items-center p-1 transition-colors duration-500 ease-apple-spring focus:outline-none focus-visible:ring-4 focus-visible:ring-maroon-500/30 disabled:cursor-progress ${portData.relay_status ? 'bg-maroon-800' : 'bg-gray-200'}`}
                >
                  <div className="absolute -inset-3" aria-hidden="true"></div>
                  <div className={`w-5 h-5 bg-white rounded-full shadow-sm flex items-center justify-center transform transition-transform duration-500 ease-apple-spring ${portData.relay_status ? 'translate-x-5' : 'translate-x-0'}`}>
                    {pendingPorts[portId] && (
                      <Loader2 className="w-3 h-3 animate-spin text-maroon-800" />
                    )}
                  </div>
                </button>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
