import { useState, useEffect } from 'react';
import { ref, onValue, set, update } from 'firebase/database';
import { db } from '../lib/firebase';

// roomId is now the MAC address of the device

export const useRoomData = (roomId) => {
  const [roomData, setRoomData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) {
      setRoomData(null);
      setLoading(false);
      return;
    }

    // Switching devices must drop the previous device's payload immediately, otherwise the UI
    // renders device A's ports/telemetry under device B's name until the first snapshot arrives.
    setRoomData(null);
    setLoading(true);

    const roomRef = ref(db, `devices/${roomId}`);

    const unsubscribeDb = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        setRoomData(snapshot.val());
      } else {
        setRoomData(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Firebase error:", error);
      setLoading(false);
    });

    return () => unsubscribeDb();
  }, [roomId]);

  // Every action returns whether it SUCCEEDED rather than swallowing failures into console.error.
  // The UI used to have no way to tell a rejected write from a slow one, so a toggle that failed
  // (offline, revoked permission, a rules denial) looked identical to one that was still in flight:
  // the switch snapped back with no explanation, or stayed where the user put it and lied. Callers
  // that ignore the return value keep working; the ones that matter surface it.

  const togglePortRelay = async (portId, newStatus) => {
    if (!roomId) return true;
    try {
      const portRef = ref(db, `devices/${roomId}/ports/${portId}/relay_status`);
      await set(portRef, newStatus);
      return true;
    } catch (error) {
      console.error(`Failed to toggle port ${portId}`, error);
      return false;
    }
  };

  const toggleMasterRelay = async (newStatus, portsObj) => {
    if (!roomId || !portsObj) return true;
    try {
      // A multi-path update commits every port in ONE atomic write. The previous
      // `forEach(async …)` fired N independent writes without awaiting them, so callers saw an
      // instant success while half the ports were still flipping — and a failure was swallowed.
      const updates = {};
      Object.keys(portsObj).forEach((portId) => {
        updates[`devices/${roomId}/ports/${portId}/relay_status`] = newStatus;
      });
      if (Object.keys(updates).length === 0) return true;
      await update(ref(db), updates);
      return true;
    } catch (error) {
      console.error("Failed to toggle master relay", error);
      return false;
    }
  };

  const updateNightMode = async (nightModeConfig) => {
    if (!roomId) return true;
    try {
      // MUST be a multi-path update, not set(): `set` on the whole `settings` node deletes every
      // sibling key — night_mode_*, inactivity_limit_minutes, and any future setting. Changing the
      // sleep schedule used to silently wipe whatever else lived alongside it.
      await update(ref(db, `devices/${roomId}/settings`), {
        night_mode_enabled: nightModeConfig.enabled,
        night_mode_start: nightModeConfig.start_time,
        night_mode_end: nightModeConfig.end_time
      });
      return true;
    } catch (error) {
      console.error("Failed to update night mode", error);
      return false;
    }
  };

  const setOverride = async (overrideValue) => {
    if (!roomId) return true;
    if (import.meta.env.DEV && roomId === '00:1A:2B:3C:4D:5E') {
      setRoomData(prev => (prev ? { ...prev, override: overrideValue } : prev));
      return true;
    }
    try {
      const overrideRef = ref(db, `devices/${roomId}/override`);
      await set(overrideRef, overrideValue);
      return true;
    } catch (error) {
      console.error("Failed to set override", error);
      return false;
    }
  }

  /**
   * Write a single device setting.
   *
   * These keys are all honoured by the firmware but had no UI, so the only way to change them was
   * the RTDB console — and a value set there persisted silently, with no screen to see or undo it.
   *
   * Uses `update`, never `set`: `set` on the whole `settings` node deletes every sibling key.
   */
  const updateDeviceSetting = async (key, value) => {
    if (!roomId) return true;
    try {
      await update(ref(db, `devices/${roomId}/settings`), { [key]: value });
      return true;
    } catch (error) {
      console.error(`Failed to update setting ${key}`, error);
      return false;
    }
  };

  /**
   * Set what a port should do when the room empties: `occupancy` (cut — the default), `always_on`
   * (never cut), or `keep_while_drawing` (keep while the load is drawing, then cut).
   *
   * Policy is STATED, not inferred. The device used to decide from current draw, which for its real
   * loads protected a lamp left burning in an empty room and cut a phone mid-charge.
   * See `docs/LOAD-POLICY.md`.
   */
  const updatePortPolicy = async (portId, policy) => {
    if (!roomId) return true;
    try {
      await set(ref(db, `devices/${roomId}/ports/${portId}/policy`), policy);
      return true;
    } catch (error) {
      console.error(`Failed to update policy for ${portId}`, error);
      return false;
    }
  };

  const updatePortName = async (portId, newName) => {
    if (!roomId) return true;
    if (import.meta.env.DEV && roomId === '00:1A:2B:3C:4D:5E') {
      setRoomData(prev => (prev?.ports?.[portId]
        ? { ...prev, ports: { ...prev.ports, [portId]: { ...prev.ports[portId], name: newName } } }
        : prev));
      return true;
    }
    try {
      const nameRef = ref(db, `devices/${roomId}/ports/${portId}/name`);
      await set(nameRef, newName);
      return true;
    } catch (error) {
      console.error(`Failed to update port name ${portId}`, error);
      return false;
    }
  };

  const updatePortIcon = async (portId, iconName) => {
    if (!roomId) return true;
    if (import.meta.env.DEV && roomId === '00:1A:2B:3C:4D:5E') {
      setRoomData(prev => (prev?.ports?.[portId]
        ? { ...prev, ports: { ...prev.ports, [portId]: { ...prev.ports[portId], icon: iconName } } }
        : prev));
      return true;
    }
    try {
      const iconRef = ref(db, `devices/${roomId}/ports/${portId}/icon`);
      await set(iconRef, iconName);
      return true;
    } catch (error) {
      console.error(`Failed to update port icon ${portId}`, error);
      return false;
    }
  };

  return {
    roomData,
    loading,
    toggleMasterRelay,
    togglePortRelay,
    updateNightMode,
    updateDeviceSetting,
    updatePortPolicy,
    setOverride,
    updatePortName,
    updatePortIcon
  };
};
