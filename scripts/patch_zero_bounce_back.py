# -*- coding: utf-8 -*-
import sys

with open('src/pages/Dashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update the state and effects in Dashboard
old_block_1 = """  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [optimisticRelays, setOptimisticRelays] = useState({});
  // Which ports have a toggle in flight, so the switch can show a spinner instead of looking
  // stuck. A relay command can be suppressed by the firmware's derating rules or fail outright, and
  // without this the control simply appears unresponsive for as long as the write takes.
  const [pendingPorts, setPendingPorts] = useState({});
  const [overridePending, setOverridePending] = useState(false);
  // The last action that failed, shown as a dismissible banner. Every write in useRoomData can
  // fail (offline, permission revoked, rules denial) and previously did so silently"""

target_end_1 = """  // The master on/off spinner clears on a timer. Without this ref + cleanup the timer can fire
  // after the page unmounts (navigating away mid-toggle), which is a state update on a dead tree.
  const masterTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(masterTimerRef.current), []);"""

# Let's find index between old_block_1 and target_end_1
idx_start_1 = content.find(old_block_1)
if idx_start_1 == -1:
    print("Error: old_block_1 not found!")
    sys.exit(1)

idx_end_1 = content.find(target_end_1, idx_start_1) + len(target_end_1)

new_block_1 = """  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [optimisticRelays, setOptimisticRelays] = useState({});
  const [pendingPorts, setPendingPorts] = useState({});
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
    return () => {
      clearTimeout(masterTimerRef.current);
      Object.values(debounceTimersRef.current).forEach(t => t && clearTimeout(t));
    };
  }, []);"""

content = content[:idx_start_1] + new_block_1 + content[idx_end_1:]

# 2. Update handleTogglePort, handleMasterOn, handleMasterOff
old_block_2 = """  const handleTogglePort = async (portId, currentStatus) => {
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

    // Immediate optimistic update: switch moves instantly with 0ms latency and zero bounce
    setOptimisticRelays(prev => ({ ...prev, [portId]: nextStatus }));
    setActionError(null);
    try {
      await togglePortRelay(portId, nextStatus);
    } catch (err) {
      console.error(err);
      setOptimisticRelays(prev => {
        const next = { ...prev };
        delete next[portId];
        return next;
      });
      reportFailure(`Could not turn ${nextStatus ? 'on' : 'off'} this port. Check your connection.`);
    }
  };

  const handleMasterOn = async () => {
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
  };"""

idx_start_2 = content.find(old_block_2)
if idx_start_2 == -1:
    print("Error: old_block_2 not found!")
    sys.exit(1)

new_block_2 = """  const handleTogglePort = (portId, currentStatus) => {
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
  };"""

content = content[:idx_start_2] + new_block_2 + content[idx_start_2 + len(old_block_2):]

with open('src/pages/Dashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Dashboard.jsx successfully patched with zero-bounce-back anti-chatter architecture!")
