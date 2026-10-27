import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';
import { useUserDevices } from '../hooks/useUserDevices';
import { DeviceContext } from './deviceContextCore';

/**
 * Provider component only. The context object and the `useDeviceContext` consumer hook live in
 * `deviceContextCore.js` — keeping them out of this file is what satisfies
 * `react-refresh/only-export-components` (a module that exports both a component and a hook cannot
 * be fast-refreshed reliably).
 *
 * Import the hook from `./contexts/deviceContextCore`.
 */
export const DeviceProvider = ({ children }) => {
  const { devices, loading: devicesLoading, userId } = useUserDevices();
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [, setTick] = useState(0);

  // Auto-select the first device if none is selected, or if the selected one was removed
  useEffect(() => {
    if (devices.length > 0) {
      if (!activeDeviceId || !devices.includes(activeDeviceId)) {
        setActiveDeviceId(devices[0]);
      }
    } else {
      setActiveDeviceId(null);
    }
  }, [devices, activeDeviceId]);

  // Track online/offline status for all user devices via heartbeat telemetry
  useEffect(() => {
    if (!devices || devices.length === 0) {
      setDeviceStatuses({});
      return;
    }

    const unsubs = devices.map(mac => {
      const deviceRef = ref(db, `devices/${mac}`);
      let packetCount = 0;
      return onValue(deviceRef, (snapshot) => {
        packetCount += 1;
        const val = snapshot.exists() ? snapshot.val() : null;
        let lastSeen = val?.last_seen ? Number(val.last_seen) : null;
        if (lastSeen && lastSeen < 1e11) lastSeen *= 1000;

        setDeviceStatuses(prev => ({
          ...prev,
          [mac]: {
            lastSeen,
            lastPacketAt: Date.now(),
            packetCount,
            exists: snapshot.exists()
          }
        }));
      });
    });

    // Re-evaluate presence freshness every 2.5 seconds
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 2500);

    return () => {
      unsubs.forEach(unsub => unsub());
      clearInterval(interval);
    };
  }, [devices]);

  const isDeviceOnline = (mac) => {
    if (!mac) return false;
    const status = deviceStatuses[mac];
    if (!status || !status.exists) return false;

    const now = Date.now();
    const packetFresh = status.packetCount > 1 && (now - status.lastPacketAt < 8000);

    if (status.lastSeen) {
      let age = now - status.lastSeen;
      // Compensate if firmware pushed UTC+8 offset (28800s = 8 hours ahead)
      if (age < -20000000 && age > -35000000) {
        age += 28800000;
      }
      return (age >= -5000 && age < 15000) || packetFresh;
    }

    return packetFresh;
  };

  const activeIsOnline = isDeviceOnline(activeDeviceId);

  return (
    <DeviceContext.Provider value={{
      devices,
      activeDeviceId,
      setActiveDeviceId,
      devicesLoading,
      userId,
      deviceStatuses,
      isDeviceOnline,
      activeIsOnline
    }}>
      {children}
    </DeviceContext.Provider>
  );
};
