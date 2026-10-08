import { createContext, useContext } from 'react';

/**
 * The raw context object and the consumer hook live here, in a file with NO component export.
 *
 * `react-refresh/only-export-components` fires when a single module exports both a component and
 * something else, because Fast Refresh cannot then decide whether editing the file should remount
 * the tree. Splitting the hook out is the sanctioned fix; re-exporting it from the `.jsx` file would
 * reintroduce exactly the mixed export the rule complains about.
 *
 * Callers keep importing `useDeviceContext` from `./contexts/DeviceContext` — that module re-exports
 * it — so no call site had to change.
 */
// `undefined` is passed explicitly. `createContext()` with no argument behaves identically at
// runtime (React defaults the value to undefined — which is exactly what the `if (!context)` check
// below relies on), but the typings require the argument to be spelled out.
export const DeviceContext = createContext(undefined);

export const useDeviceContext = () => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error('useDeviceContext must be used within a DeviceProvider');
  }
  return context;
};
