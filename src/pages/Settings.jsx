import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRoomData } from '../hooks/useRoomData';
import { useDeviceContext } from '../contexts/deviceContextCore';
import {
  Moon,
  Bell,
  LogOut,
  Wifi,
  Plus,
  Trash2,
  Loader2,
  KeyRound,
  AlertCircle,
  Sliders,
  TriangleAlert,
  Radar
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { enablePushForUser, clearPushToken } from '../lib/pushNotifications';
import { claimDevice, unpairDevice, formatPairingCodeInput } from '../lib/deviceClaim';
import { errorMessage } from '../lib/errors';
import { signOut } from 'firebase/auth';
import { TimePicker } from '../components/TimePicker';

const Settings = () => {
  const { devices, activeDeviceId, devicesLoading, userId } = useDeviceContext();

  const {
    roomData,
    loading: roomLoading,
    updateNightMode,
    updateDeviceSetting,
    updatePortPolicy
  } = useRoomData(activeDeviceId);
  
  const [nightMode, setNightMode] = useState({
    enabled: true,
    start_time: '22:00',
    end_time: '06:00'
  });
  const [mmwaveEnabled, setMmwaveEnabled] = useState(false);
  const [loadingPush, setLoadingPush] = useState(false);
  // The pairing code the device prints after it provisions itself. Eight characters from an
  // unambiguous alphabet (no 0/O/1/I/L), optionally grouped as XXXX-XXXX by the formatter.
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [claimError, setClaimError] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [unpairingId, setUnpairingId] = useState(null);
  const [confirmUnpairId, setConfirmUnpairId] = useState(null);
  // { mac, message } for a failed unpair, or null. Kept separate from `claimError` so a pairing
  // error and a removal error never overwrite each other.
  const [unpairError, setUnpairError] = useState(null);
  // Auto-cancels the "Confirm?" state on the unpair button after 3s. Cleared on unmount so the
  // timer can't fire against a torn-down tree.
  const unpairConfirmTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(unpairConfirmTimerRef.current), []);

  // Push state is derived from what the browser actually reports, not from localStorage alone:
  // a permission can be revoked in iOS Settings or Chrome's site controls without the app
  // noticing, and a stale "true" would show the toggle on while nothing is delivered.
  const [pushPermission, setPushPermission] = useState(() =>
    typeof window !== 'undefined' && typeof window.Notification !== 'undefined'
      ? window.Notification.permission
      : 'unsupported'
  );

  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isSignOutRendered, setIsSignOutRendered] = useState(false);
  const [isSignOutVisible, setIsSignOutVisible] = useState(false);

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: null
  });
  const [isModalRendered, setIsModalRendered] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);



  // Seed the editor from the device, but ONLY when the stored schedule actually changes.
  // Depending on `roomData` itself would re-run this on every telemetry tick (the device pushes
  // every 2s) and would snap the time pickers back to the stored value mid-edit. Reading the
  // scalars into locals first keeps the dependency list honest without that side effect.
  const hasSettings = Boolean(roomData?.settings);
  const storedNightModeEnabled = roomData?.settings?.night_mode_enabled;
  const storedNightModeStart = roomData?.settings?.night_mode_start;
  const storedNightModeEnd = roomData?.settings?.night_mode_end;
  const storedMmwaveEnabled = roomData?.settings?.mmwave_enabled;

  useEffect(() => {
    if (!hasSettings) return;
    setNightMode({
      enabled: storedNightModeEnabled ?? true,
      start_time: storedNightModeStart || '22:00',
      end_time: storedNightModeEnd || '06:00'
    });
    setMmwaveEnabled(storedMmwaveEnabled ?? false);
  }, [
    activeDeviceId,
    hasSettings,
    storedNightModeEnabled,
    storedNightModeStart,
    storedNightModeEnd,
    storedMmwaveEnabled
  ]);

  useEffect(() => {
    if (showSignOutModal) {
      setIsSignOutRendered(true);
      const timer = setTimeout(() => setIsSignOutVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsSignOutVisible(false);
      const timer = setTimeout(() => setIsSignOutRendered(false), 300);
      return () => clearTimeout(timer);
    }
  }, [showSignOutModal]);

  useEffect(() => {
    let timer;
    if (modalConfig.isOpen) {
      setIsModalRendered(true);
      timer = setTimeout(() => setIsModalVisible(true), 50);
    } else {
      setIsModalVisible(false);
      timer = setTimeout(() => {
        setIsModalRendered(false);
      }, 300);
    }
    return () => clearTimeout(timer);
  }, [modalConfig.isOpen]);

  const handleTestNotification = async () => {
    // A local notification, so the user can see what an alert will look like without waiting for
    // the room to actually go quiet. This is a rendering check, not a delivery check — the
    // end-to-end path is exercised by the device.
    try {
      if (typeof Notification === 'undefined') {
        showModal('Not Supported', 'This browser cannot show notifications.', 'alert');
        return;
      }
      if (Notification.permission !== 'granted') {
        showModal(
          'Notifications Blocked',
          'Notifications are blocked for this site, so alerts cannot be delivered. Enable them in your browser settings and try again.',
          'alert'
        );
        return;
      }

      const registration = await navigator.serviceWorker?.getRegistration();
      const payload = {
        body: 'PC will shut down in 60 seconds due to inactivity. Open the app to keep power on.',
        icon: '/logo.svg'
      };
      if (registration) {
        await registration.showNotification('VoltSense Warning', payload);
      } else {
        new Notification('VoltSense Warning', payload);
      }
    } catch (error) {
      console.error('Browser notification test failed:', error);
      showModal('Test Failed', 'Could not display the test notification.', 'alert');
    }
  };

  const showModal = (title, message, type = 'alert', onConfirm = null) => {
    setModalConfig({ isOpen: true, title, message, type, onConfirm });
  };

  const closeModal = () => {
    setModalConfig(prev => ({ ...prev, isOpen: false }));
  };

  const handleNightModeChange = (key, value) => {
    const newConfig = { ...nightMode, [key]: value };
    setNightMode(newConfig);
    updateNightMode(newConfig);
  };

  const handleMmwaveChange = (value) => {
    setMmwaveEnabled(value);
    updateDeviceSetting('mmwave_enabled', value);
  };

  // -------------------------------------------------------------------------
  // Device limits — four settings the firmware honours that had NO UI.
  //
  // They could only be changed from the RTDB console, and a value set there
  // persisted silently: no screen showed it, and none could undo it. All four are
  // live device behaviour, not presentation.
  // -------------------------------------------------------------------------
  const [limits, setLimits] = useState({
    inactivity: 15,
    overcurrent: 4.5,
    nominal: 230,
    voltageCal: 4.6
  });
  const [savingLimit, setSavingLimit] = useState(null);
  const [limitsError, setLimitsError] = useState(null);

  // Two places to read each of these, and both matter:
  //   `settings/<key>`  — what the APP wrote (absent until someone writes it)
  //   top-level `inactivity_limit` / `overcurrent_limit_a` — what the DEVICE is ACTUALLY enforcing,
  //     which it publishes every cycle. Prefer the written value; fall back to the enforced one, so
  //     the UI never shows a number the device is not using.
  const storedInactivity = roomData?.settings?.inactivity_limit_minutes ?? roomData?.inactivity_limit;
  const storedOvercurrent = roomData?.settings?.overcurrent_limit_a ?? roomData?.overcurrent_limit_a;
  const storedNominal = roomData?.settings?.nominal_voltage;
  const storedVoltageCal = roomData?.settings?.voltage_cal_mv_per_v;
  // Port policies are NOT mirrored into local state. The <select> is controlled straight from
  // roomData, so the device's copy is the single source of truth and a failed write simply snaps
  // back rather than showing a value the device never accepted.

  useEffect(() => {
    if (!hasSettings) return;
    setLimits({
      inactivity: storedInactivity ?? 15,
      overcurrent: storedOvercurrent ?? 4.5,
      nominal: storedNominal ?? 230,
      voltageCal: storedVoltageCal ?? 4.6
    });
  }, [activeDeviceId, hasSettings, storedInactivity, storedOvercurrent, storedNominal, storedVoltageCal]);

  /**
   * Validate, then write. The bounds here deliberately mirror the firmware's, because a value the
   * app accepts and the device rejects produces a silent no-op — the worst possible outcome.
   */
  const limitsMeta = {
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
    }
  };

  const handleLimitSave = async (field, rawValue) => {
    const meta = limitsMeta[field];
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < meta.min || parsed > meta.max) {
      setLimitsError(`${meta.label} must be between ${meta.min} and ${meta.max} ${meta.unit}.`);
      return false;
    }
    setSavingLimit(field);
    setLimitsError(null);
    const ok = await updateDeviceSetting(meta.key, parsed);
    setSavingLimit(null);
    if (!ok) {
      setLimitsError(`Could not save ${meta.label}. Check your connection and try again.`);
      return false;
    }
    setLimits((prev) => ({ ...prev, [field]: parsed }));
    return true;
  };

  const handlePolicyChange = async (portId, policy) => {
    setSavingLimit(portId);
    setLimitsError(null);
    const ok = await updatePortPolicy(portId, policy);
    setSavingLimit(null);
    if (!ok) {
      setLimitsError('Could not change this port’s shutdown policy. Try again.');
      return false;
    }
    return true;
  };

  // Replaces the old raw-MAC pairing form.
  //
  // The previous version wrote `users/<uid>/owned_devices/<MAC> = true` straight from the browser
  // after a regex check. A regex proves the MAC is WELL-FORMED, not that the user has ever been near
  // the device — so anyone who knew a MAC could attach it to their own account and then receive that
  // room's alerts (occupancy, power) via the alert endpoint, which resolves recipients from exactly
  // this node. Ownership now has to be earned: the user proves physical proximity by reading a short
  // expiring code off the device, and the SERVER writes the ownership edges.
  const handleClaimDevice = async (e) => {
    e.preventDefault();
    const code = pairingCodeInput.trim();
    if (!code) return;

    setPairing(true);
    setClaimError(null);
    try {
      const { mac } = await claimDevice(code);

      // `useUserDevices` holds a live subscription on owned_devices, so the new device appears in
      // the switcher on its own — no local state to sync, and no chance of the UI disagreeing with
      // the database about what this account owns.
      setPairingCodeInput('');
      showModal('Device added', `${mac} is now linked to your account.`, 'alert');
    } catch (error) {
      console.error('Claim failed:', error);
      setClaimError(errorMessage(error, 'Could not add the device.'));
    } finally {
      setPairing(false);
    }
  };

  // Two-tap confirmation (the second tap within 3s commits). The commit goes through the SERVER,
  // not a browser-side `remove()`: ownership lives in three places and none of them is writable
  // from the client. Clearing just `users/<uid>/owned_devices/<MAC>` used to leave
  // `devices/<MAC>/owner` behind, which made the device permanently unclaimable — /api/claim.js
  // sees a foreign uid on that node and aborts. /api/unpair.js clears all three, atomically, after
  // verifying this account is the owner.
  //
  // Errors surface INLINE against the device row, not only in a modal. A modal is dismissed with
  // one tap and leaves no trace, so a user whose unpair genuinely failed (offline, 403) would see
  // the device still listed, the modal gone, and no reason for it. The inline message persists
  // until the next attempt and sits next to the button that failed.
  const handleUnpairDevice = async (macAddress) => {
    if (!userId) return;

    if (confirmUnpairId !== macAddress) {
      setConfirmUnpairId(macAddress);
      setUnpairError(null);
      clearTimeout(unpairConfirmTimerRef.current);
      unpairConfirmTimerRef.current = setTimeout(() => setConfirmUnpairId(null), 3000); // Reset after 3s
      return;
    }

    setUnpairingId(macAddress);
    setUnpairError(null);
    try {
      await unpairDevice(macAddress);
      setConfirmUnpairId(null);
    } catch (error) {
      console.error('Error unpairing device:', error);
      setUnpairError({
        mac: macAddress,
        message: errorMessage(error, 'Failed to remove the device. Please try again.')
      });
      setConfirmUnpairId(null);
    } finally {
      setUnpairingId(null);
    }
  };

  const handleSignOut = () => {
    setShowSignOutModal(true);
  };

  const confirmSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleToggleNotifications = async () => {
    if (!userId) return;

    // Turning off removes the token from the database, which is what actually stops delivery.
    // Clearing localStorage alone would hide the toggle while the server kept sending.
    if (pushPermission === 'granted') {
      setLoadingPush(true);
      await clearPushToken(userId);
      localStorage.setItem('voltsenseNotificationsEnabled', 'false');
      setPushPermission(
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
      );
      setLoadingPush(false);
      return;
    }

    if (typeof Notification === 'undefined') {
      showModal('Not Supported', 'This browser cannot show notifications.', 'alert');
      return;
    }

    try {
      setLoadingPush(true);

      // Requests permission and persists the resulting FCM token in one step, so a granted
      // permission can never end up with no token on the server (the bug this replaces).
      const token = await enablePushForUser(userId);

      if (!token) {
        setPushPermission(Notification.permission);
        showModal(
          'Could Not Enable',
          Notification.permission === 'denied'
            ? 'Notifications are blocked for this site. Enable them in your browser settings and try again.'
            : 'This device cannot receive push notifications. On iPhone, add VoltSense to your Home Screen first.',
          'alert'
        );
        return;
      }

      setPushPermission('granted');
      localStorage.setItem('voltsenseNotificationsEnabled', 'true');
      showModal('Enabled', 'This device will now receive alerts.', 'alert');
    } catch (error) {
      console.error('Error enabling notifications:', error);
      showModal('Notification Error', 'Could not enable notifications. Please try again.', 'alert');
    } finally {
      setLoadingPush(false);
    }
  };

  if (devicesLoading || (activeDeviceId && roomLoading)) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-5 animate-in fade-in duration-500 pb-10">
      <div className="flex items-center justify-between bg-white p-5 md:p-6 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-2">
        <div className="min-w-0 pr-2">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-tight truncate">Settings</h2>
          <p className="text-gray-500 text-[10px] md:text-sm font-medium mt-0.5 leading-tight truncate">Preferences & system config</p>
        </div>
        <button 
          onClick={handleSignOut}
          className="shrink-0 flex items-center gap-1.5 bg-red-50 text-red-600 px-3 md:px-4 py-2 md:py-2.5 rounded-xl md:rounded-2xl border border-red-100 text-[10px] md:text-sm font-bold uppercase tracking-wider hover:bg-red-100 transition-all duration-300 ease-out"
        >
          <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        
        {/* Paired Devices Section */}
        <div className="settings-paired-devices p-4 md:p-6 border-b border-gray-100">
          <div className="flex items-center gap-3 md:gap-4 mb-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
              <Wifi className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
            </div>
            <div>
              <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-0.5">Paired Devices</h3>
              <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight">Manage your VoltSense hardware</p>
            </div>
          </div>
          
          <div className="space-y-3 mb-5">
            {devices.map(mac => (
              <div key={mac} className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                    <span className="font-mono text-sm font-bold text-gray-700">{mac}</span>
                  </div>
                  <button 
                    onClick={() => handleUnpairDevice(mac)}
                    disabled={unpairingId === mac}
                    className={`px-3 py-2 rounded-lg transition-all duration-300 ease-apple-spring disabled:opacity-50 flex items-center text-xs font-bold overflow-hidden ${
                      confirmUnpairId === mac 
                        ? 'bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-500/20' 
                        : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {unpairingId === mac ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className={`w-4 h-4 shrink-0 transition-transform duration-300 ease-apple-spring ${confirmUnpairId === mac ? 'scale-110' : 'scale-100'}`} />
                        <span 
                          className={`transition-all duration-300 ease-apple-spring whitespace-nowrap overflow-hidden ${
                            confirmUnpairId === mac ? 'max-w-[100px] opacity-100 ml-1.5' : 'max-w-0 opacity-0 ml-0'
                          }`}
                        >
                          Confirm
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* A removal that genuinely failed (offline, not the owner, server error) must not
                    vanish with a dismissed modal. It stays here, next to the button, until retried. */}
                {unpairError?.mac === mac && (
                  <div className="px-3 pb-3 -mt-1 flex items-start gap-2 text-xs font-medium text-red-600">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{unpairError.message}</span>
                  </div>
                )}
              </div>
            ))}
            {devices.length === 0 && (
              <p className="text-sm text-gray-500 italic text-center py-2">No devices paired.</p>
            )}
          </div>

          {/* Add a device by pairing code.
              A MAC address is deliberately NOT accepted here: a MAC is public (it is broadcast in
              every Wi-Fi frame) so typing one proves nothing about possession, and the old form let
              anyone attach someone else's device — and therefore their alerts — to this account.
              The code is printed by the device itself and expires in 30 minutes. */}
          <form onSubmit={handleClaimDevice} className="relative">
            <label htmlFor="pairing-code-input" className="sr-only">Pairing code</label>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  id="pairing-code-input"
                  name="pairingCode"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck="false"
                  maxLength={9}
                  placeholder="Pairing code (e.g. K7M2-PQX4)"
                  value={pairingCodeInput}
                  onChange={(e) => {
                    // Format as you type so the code stays readable and a stray paste with spaces
                    // does not get rejected by a length check.
                    setPairingCodeInput(formatPairingCodeInput(e.target.value));
                    if (claimError) setClaimError(null);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-base md:text-sm font-mono font-bold tracking-wider uppercase focus:outline-none focus:border-maroon-300 focus:ring-4 focus:ring-maroon-50 transition-all placeholder:normal-case placeholder:font-sans placeholder:tracking-normal placeholder:font-medium"
                />
              </div>

              <button
                type="submit"
                disabled={pairing || pairingCodeInput.replace(/[^A-Z0-9]/g, '').length !== 8}
                className="bg-maroon-800 text-white px-4 rounded-xl font-bold flex items-center justify-center disabled:opacity-50 hover:bg-maroon-900 transition-colors"
              >
                {pairing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              </button>
            </div>

            {claimError && (
              <p className="text-xs font-semibold text-red-600 mt-2 px-1" role="alert">
                {claimError}
              </p>
            )}

            <p className="text-[11px] text-gray-500 mt-2 px-1 leading-relaxed">
              The code is shown on the device after it powers on and joins Wi-Fi.
            </p>
          </form>
        </div>
        {/* Night Mode Section */}
        <div className="settings-night-mode p-4 md:p-6 border-b border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
                <Moon className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
              </div>
              <div>
                <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-0.5">Night Mode</h3>
                <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight pr-2">Ignore occupancy during sleep hours</p>
              </div>
            </div>
            
            <button 
              onClick={() => handleNightModeChange('enabled', !nightMode.enabled)}
              className={`w-14 h-8 shrink-0 rounded-full flex items-center p-1 transition-colors duration-300 focus:outline-none ${nightMode.enabled ? 'bg-maroon-800' : 'bg-gray-200'}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full shadow-sm transform transition-transform duration-300 ${nightMode.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          {nightMode.enabled && (
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 md:mt-6 md:pt-6 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300 relative">
              <TimePicker 
                label="Start Time (NTP)"
                value={nightMode.start_time}
                onChange={(val) => handleNightModeChange('start_time', val)}
              />
              <TimePicker 
                label="End Time (NTP)"
                value={nightMode.end_time}
                onChange={(val) => handleNightModeChange('end_time', val)}
              />
            </div>
          )}
        </div>

        {/* mmWave Radar Toggle */}
        <div className="p-4 md:p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
                <Radar className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
              </div>
              <div>
                <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-0.5">mmWave Radar</h3>
                <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight pr-2">Enable secondary motion sensing for stillness detection</p>
              </div>
            </div>
            
            <button 
              onClick={() => handleMmwaveChange(!mmwaveEnabled)}
              className={`w-14 h-8 shrink-0 rounded-full flex items-center p-1 transition-colors duration-300 focus:outline-none ${mmwaveEnabled ? 'bg-maroon-800' : 'bg-gray-200'}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full shadow-sm transform transition-transform duration-300 ${mmwaveEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {/* Device limits — the four settings that had no UI, plus per-port policy */}
        <div className="settings-device-limits p-4 md:p-6 border-b border-gray-100">
          <div className="flex items-center gap-3 md:gap-4 mb-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
              <Sliders className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
            </div>
            <div>
              <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-0.5">Device limits</h3>
              <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight pr-2">
                Live device behaviour — previously only changeable from the database console
              </p>
            </div>
          </div>

          {limitsError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] font-medium text-red-800">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{limitsError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          </div>

          {/* Per-port shutdown policy */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
              When the room empties
            </p>
            <p className="text-[10px] text-gray-400 mb-3 leading-snug">
              The device cannot tell a lamp from a charger by current alone, so say what each port is
              for. Default is to cut — that is what the device is for.
            </p>

            <div className="space-y-2">
              {(roomData?.ports ? Object.keys(roomData.ports) : []).map((portId) => {
                const label = roomData.ports[portId]?.name || portId;
                const value = roomData.ports[portId]?.policy || 'occupancy';
                return (
                  <div key={portId} className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-gray-700 truncate flex-1 min-w-0">
                      {label}
                    </span>
                    {savingLimit === portId && <Loader2 className="w-3.5 h-3.5 animate-spin text-maroon-800 shrink-0" />}
                    <select
                      value={value}
                      onChange={(e) => handlePolicyChange(portId, e.target.value)}
                      aria-label={`Shutdown policy for ${label}`}
                      className="text-[11px] font-semibold text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-maroon-300 shrink-0"
                    >
                      <option value="occupancy">Cut when empty</option>
                      <option value="always_on">Never cut</option>
                      <option value="keep_while_drawing">Keep while drawing</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Notifications Section */}
        <div className="settings-push-notifications p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight">Push Notifications</h3>
                  {pushPermission === 'granted' && (
                    <button
                      onClick={handleTestNotification}
                      className="bg-maroon-50 text-maroon-700 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-maroon-100 transition-colors"
                    >
                      Test
                    </button>
                  )}
                </div>
                <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight pr-2">
                  {pushPermission === 'unsupported'
                    ? 'Not available on this device'
                    : pushPermission === 'denied'
                      ? 'Blocked in browser settings'
                      : pushPermission === 'granted'
                        ? 'Alerts for inactivity shutdown'
                        : 'Enable alerts for inactivity shutdown'}
                </p>
              </div>
            </div>

            <button
              onClick={handleToggleNotifications}
              disabled={loadingPush || pushPermission === 'unsupported'}
              className={`w-14 h-8 shrink-0 rounded-full flex items-center p-1 transition-colors duration-300 focus:outline-none ${pushPermission === 'granted' ? 'bg-maroon-800' : 'bg-gray-200'} ${loadingPush ? 'opacity-70 cursor-wait' : ''} ${pushPermission === 'unsupported' ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <div className={`w-6 h-6 bg-white rounded-full shadow-sm transform transition-transform duration-300 flex items-center justify-center ${pushPermission === 'granted' ? 'translate-x-6' : 'translate-x-0'}`}>
                {loadingPush && <Loader2 className={`w-3.5 h-3.5 animate-spin ${pushPermission === 'granted' ? 'text-maroon-800' : 'text-gray-400'}`} />}
              </div>
            </button>
          </div>

          {pushPermission === 'denied' && (
            <p className="mt-3 pt-3 border-t border-gray-100 text-[10px] md:text-xs text-gray-500 font-medium leading-relaxed">
              Notifications are blocked for this site. Re-enable them in your browser's site
              settings, then toggle this back on. On iPhone, VoltSense must be added to the Home
              Screen before push notifications work at all.
            </p>
          )}
        </div>

      </div>

      {/* Sign Out Modal */}
      {isSignOutRendered && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto">
          <div 
            className={`fixed inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isSignOutVisible ? 'opacity-100' : 'opacity-0'}`} 
            onClick={() => setShowSignOutModal(false)}
          />
          <div className={`bg-white rounded-3xl p-6 shadow-2xl w-full max-w-sm my-auto transition-all duration-300 ease-apple-spring transform ${isSignOutVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Sign Out</h3>
            <p className="text-gray-500 font-medium mb-6 leading-relaxed">Are you sure you want to sign out of your VoltSense account?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowSignOutModal(false)}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmSignOut}
                className="flex-1 py-3 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-md shadow-red-600/20"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Generic Modal */}
      {isModalRendered && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto">
          <div 
            className={`fixed inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isModalVisible ? 'opacity-100' : 'opacity-0'}`} 
            onClick={closeModal}
          />
          <div className={`bg-white rounded-3xl p-6 shadow-2xl w-full max-w-sm my-auto transition-all duration-300 ease-apple-spring transform flex flex-col items-center text-center ${isModalVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{modalConfig.title}</h3>
            <p className="text-gray-500 font-medium mb-6 leading-relaxed">{modalConfig.message}</p>
            {modalConfig.type === 'alert' ? (
              <button 
                onClick={closeModal}
                className="w-full py-3 px-4 bg-maroon-800 text-white rounded-xl font-bold hover:bg-maroon-900 transition-colors shadow-md shadow-maroon-900/20"
              >
                Got it
              </button>
            ) : (
              <div className="flex w-full gap-3">
                <button 
                  onClick={closeModal}
                  className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    closeModal();
                    if (modalConfig.onConfirm) modalConfig.onConfirm();
                  }}
                  className="flex-1 py-3 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-md shadow-red-600/20"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}


    </div>
  );
};

export default Settings;
