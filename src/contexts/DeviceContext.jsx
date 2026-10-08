import { useState, useEffect } from 'react';
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

  return (
    <DeviceContext.Provider value={{ devices, activeDeviceId, setActiveDeviceId, devicesLoading, userId }}>
      {children}
    </DeviceContext.Provider>
  );
};
