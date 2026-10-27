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
  Zap,
  SlidersHorizontal,
  Check,
  Gauge,
  RotateCcw,
  Activity,
  Crosshair,
  Radio
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { enablePushForUser, clearPushToken } from '../lib/pushNotifications';
import { claimDevice, unpairDevice, formatPairingCodeInput } from '../lib/deviceClaim';
import { errorMessage } from '../lib/errors';
import { signOut } from 'firebase/auth';
import { TimePicker } from '../components/TimePicker';
import GodModePanel from '../components/GodModePanel';
import { playEmergencyAlarm } from '../lib/soundAlert';

const Settings = () => {
  const { devices, activeDeviceId, devicesLoading, userId } = useDeviceContext();

  const {
    roomData,
    loading: roomLoading,
    updateNightMode,
    updateDeviceSetting,
    updateDeviceSettings,
    updatePortPolicy
  } = useRoomData(activeDeviceId);
  
  const [godMode, setGodMode] = useState(() => {
    try {
      return localStorage.getItem('voltsense_god_mode') === 'true';
    } catch {
      return false;
    }
  });

  const toggleGodMode = async () => {
    if (godMode) {
      // Exiting God Mode: restore demo overrides to standard defaults while preserving hardware calibration
      try {
        if (activeDeviceId) {
          await updateDeviceSettings({
            inactivity_limit_seconds: 900,
            inactivity_limit_minutes: 15,
            response_window_seconds: 300,
            force_mmwave: -1,
            force_pir: -1
          });
        }
      } catch (err) {
        console.warn('Could not reset settings on god mode exit:', err);
      }
      setGodMode(false);
      try {
        localStorage.setItem('voltsense_god_mode', 'false');
      } catch {}
    } else {
      setGodMode(true);
      try {
        localStorage.setItem('voltsense_god_mode', 'true');
      } catch {}
    }
  };

  const [nightMode, setNightMode] = useState({
    enabled: true,
    start_time: '22:00',
    end_time: '06:00'
  });
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

  useEffect(() => {
    if (!hasSettings) return;
    setNightMode({
      enabled: storedNightModeEnabled ?? true,
      start_time: storedNightModeStart || '22:00',
      end_time: storedNightModeEnd || '06:00'
    });
  }, [
    activeDeviceId,
    hasSettings,
    storedNightModeEnabled,
    storedNightModeStart,
    storedNightModeEnd
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
    try {
      if (typeof Notification === 'undefined') {
        showModal('Not Supported', 'This browser cannot show notifications.', 'alert');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
        setPushPermission(perm);
      }
      if (perm !== 'granted') {
        showModal(
          'Notifications Blocked',
          'Notifications are blocked for this site. Enable them in your browser settings and try again.',
          'alert'
        );
        return;
      }

      // Play synthesized emergency buzzer + haptic vibration
      playEmergencyAlarm();

      const registration = await navigator.serviceWorker?.getRegistration();
      const payload = {
        body: 'VoltSense Alert: Inactivity warning countdown started. Open the app to keep power on.',
        icon: '/logo.svg',
        vibrate: [200, 100, 200]
      };
      if (registration && registration.showNotification) {
        await registration.showNotification('VoltSense Warning', payload);
      } else {
        new Notification('VoltSense Warning', payload);
      }
      showModal('Alert Dispatched', 'Test warning notification and audio alarm were triggered.', 'alert');
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
    voltageCal: 4.545,
    acsSensitivity: 123.33,
    currentNoiseFloor: 0.03,
    currentMultiplier: 1.00,
    pirDelay: 5,
    mmwaveDelay: 3,
    radarMaxGate: 3,
    radarStaticThreshold: 20,
    radarMovingThreshold: 30
  });
  const [savingLimit, setSavingLimit] = useState(null);
  const [limitsError, setLimitsError] = useState(null);
  const [calFeedback, setCalFeedback] = useState(null);

  // Two places to read each of these, and both matter:
  //   `settings/<key>`  — what the APP wrote (absent until someone writes it)
  //   top-level `inactivity_limit` / `overcurrent_limit_a` — what the DEVICE is ACTUALLY enforcing,
  //     which it publishes every cycle. Prefer the written value; fall back to the enforced one, so
  //     the UI never shows a number the device is not using.
  const storedInactivity = roomData?.settings?.inactivity_limit_minutes ?? roomData?.inactivity_limit;
  const storedOvercurrent = roomData?.settings?.overcurrent_limit_a ?? roomData?.overcurrent_limit_a;
  const storedNominal = roomData?.settings?.nominal_voltage;
  const storedVoltageCal = roomData?.settings?.voltage_cal_mv_per_v;
  const storedAcsSensitivity = roomData?.settings?.acs712_mv_per_amp;
  const storedCurrentNoiseFloor = roomData?.settings?.current_noise_floor_a;
  const storedCurrentMultiplier = roomData?.settings?.current_cal_multiplier;
  const storedPirDelay = roomData?.settings?.pir_delay_seconds;
  const storedMmwaveDelay = roomData?.settings?.mmwave_delay_seconds;
  const storedSensorFusion = roomData?.settings?.sensor_fusion_mode || 'OR';
  const storedRadarMaxGate = roomData?.settings?.radar_max_gate ?? 3;
  const storedRadarStaticThreshold = roomData?.settings?.radar_static_threshold ?? 20;
  const storedRadarMovingThreshold = roomData?.settings?.radar_moving_threshold ?? 30;

  const isRadarUart = Boolean(roomData?.radar_uart_connected);
  const liveRadarDistance = roomData?.radar_distance_cm ?? 0;
  const liveRadarStaticEnergy = roomData?.radar_static_energy ?? 0;
  const liveRadarMovingEnergy = roomData?.radar_moving_energy ?? 0;
  const liveRadarTargetState = roomData?.radar_target_state || 'none';
  const isBenchMode = Boolean(roomData?.settings?.bench_mode);

  const handleBenchModeToggle = async () => {
    setSavingLimit('bench_mode');
    setLimitsError(null);
    const nextVal = !isBenchMode;
    const ok = await updateDeviceSetting('bench_mode', nextVal);
    setSavingLimit(null);
    if (!ok) {
      setLimitsError('Could not update Bench Test Mode. Check connection and try again.');
    }
  };

  const handleZeroTareCurrent = async () => {
    setSavingLimit('zero_tare_current');
    setLimitsError(null);
    try {
      const ok = await updateDeviceSetting('calibrate_current_zero', true);
      if (ok) {
        setCalFeedback('Current sensors zero-tared successfully!');
        setTimeout(() => setCalFeedback(null), 3500);
      }
    } catch {
      setLimitsError('Failed to trigger zero-tare.');
    } finally {
      setSavingLimit(null);
    }
  };

  const handleAutoCalibrateVoltage = async () => {
    setSavingLimit('auto_cal_voltage');
    setLimitsError(null);
    try {
      const ok = await updateDeviceSetting('auto_calibrate_voltage', true);
      if (ok) {
        setCalFeedback('Voltage auto-calibration triggered against grid baseline!');
        setTimeout(() => setCalFeedback(null), 3500);
      }
    } catch {
      setLimitsError('Failed to trigger voltage auto-calibration.');
    } finally {
      setSavingLimit(null);
    }
  };

  // Port policies are NOT mirrored into local state. The <select> is controlled straight from
  // roomData, so the device's copy is the single source of truth and a failed write simply snaps
  // back rather than showing a value the device never accepted.

  useEffect(() => {
    if (!hasSettings) return;
    setLimits({
      inactivity: storedInactivity ?? 15,
      overcurrent: storedOvercurrent ?? 4.5,
      nominal: storedNominal ?? 230,
      voltageCal: storedVoltageCal ?? 4.545,
      acsSensitivity: storedAcsSensitivity ?? 123.33,
      currentNoiseFloor: storedCurrentNoiseFloor ?? 0.03,
      currentMultiplier: storedCurrentMultiplier ?? 1.00,
      pirDelay: storedPirDelay ?? 5,
      mmwaveDelay: storedMmwaveDelay ?? 3,
      radarMaxGate: storedRadarMaxGate ?? 3,
      radarStaticThreshold: storedRadarStaticThreshold ?? 20,
      radarMovingThreshold: storedRadarMovingThreshold ?? 30
    });
  }, [
    activeDeviceId,
    hasSettings,
    storedInactivity,
    storedOvercurrent,
    storedNominal,
    storedVoltageCal,
    storedAcsSensitivity,
    storedCurrentNoiseFloor,
    storedCurrentMultiplier,
    storedPirDelay,
    storedMmwaveDelay,
    storedRadarMaxGate,
    storedRadarStaticThreshold,
    storedRadarMovingThreshold
  ]);

  /**
   * Validate, then write. The bounds here deliberately mirror the firmware's, because a value the
   * app accepts and the device rejects produces a silent no-op — the worst possible outcome.
   */
  const deviceLimitsMeta = {
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
      hint: 'Hardware cutoff limit — safely bounded by 5 A ACS712 sensor capacity.'
    },
    nominal: {
      key: 'nominal_voltage',
      label: 'Supply voltage',
      unit: 'V',
      min: 50,
      max: 300,
      hint: 'Nominal grid baseline used when mains waveform is unmeasured or in bench mode.'
    }
  };

  const electricalCalMeta = {
    voltageCal: {
      key: 'voltage_cal_mv_per_v',
      label: 'Voltage calibration',
      unit: 'mV/V',
      min: 0.5,
      max: 20.0,
      hint: 'ZMPT101B transformer scaling factor. Divides into raw ADC mV to derive mains RMS.'
    },
    acsSensitivity: {
      key: 'acs712_mv_per_amp',
      label: 'ACS712 sensitivity',
      unit: 'mV/A',
      min: 10.0,
      max: 400.0,
      hint: '123.33 mV/A for 5A with 1k/2k divider; 185 mV/A direct without divider.'
    },
    currentNoiseFloor: {
      key: 'current_noise_floor_a',
      label: 'Current noise floor',
      unit: 'A',
      min: 0.005,
      max: 1.0,
      hint: 'Readings below this threshold clamp to 0.00 A to reject idle ADC hiss.'
    },
    currentMultiplier: {
      key: 'current_cal_multiplier',
      label: 'Current multiplier',
      unit: 'x',
      min: 0.5,
      max: 2.0,
      hint: 'Precision multiplier to calibrate current readings against a reference multimeter.'
    }
  };

  const occupancyFilterMeta = {
    pirDelay: {
      key: 'pir_delay_seconds',
      label: 'PIR hold delay',
      unit: 's',
      min: 1,
      max: 60,
      hint: 'Motion smoothing bridge time to keep occupancy active across subtle movements.'
    },
    mmwaveDelay: {
      key: 'mmwave_delay_seconds',
      label: 'mmWave hold delay',
      unit: 's',
      min: 0,
      max: 60,
      hint: 'Stillness hold bridge to prevent radar flutter while seated or resting.'
    },
    radarMaxGate: {
      key: 'radar_max_gate',
      label: 'Radar max distance gate',
      unit: 'gates',
      min: 1,
      max: 8,
      hint: 'Distance cutoff (1–8 gates, ~0.75m per gate). Rejects hallway traffic beyond the room.'
    },
    radarStaticThreshold: {
      key: 'radar_static_threshold',
      label: 'Stationary (breathing) threshold',
      unit: '%',
      min: 0,
      max: 100,
      hint: 'Minimum stationary radar energy required to maintain presence while sitting still.'
    },
    radarMovingThreshold: {
      key: 'radar_moving_threshold',
      label: 'Moving target threshold',
      unit: '%',
      min: 0,
      max: 100,
      hint: 'Minimum moving energy required to trigger gross motion detection.'
    }
  };

  const limitsMeta = {
    ...deviceLimitsMeta,
    ...electricalCalMeta,
    ...occupancyFilterMeta
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
    let ok = false;
    if (field === 'inactivity') {
      ok = await updateDeviceSettings({
        inactivity_limit_minutes: parsed,
        inactivity_limit_seconds: parsed * 60
      });
    } else {
      ok = await updateDeviceSetting(meta.key, parsed);
    }
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
    if (typeof Notification === 'undefined') {
      showModal('Not Supported', 'This browser cannot show notifications.', 'alert');
      return;
    }

    if (pushPermission === 'granted') {
      setLoadingPush(true);
      if (userId) await clearPushToken(userId);
      localStorage.setItem('voltsenseNotificationsEnabled', 'false');
      setPushPermission(
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
      );
      setLoadingPush(false);
      return;
    }

    try {
      setLoadingPush(true);
      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
        setPushPermission(perm);
      }

      if (userId) {
        const token = await enablePushForUser(userId);
        if (!token && perm !== 'granted') {
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
      }

      if (perm === 'granted') {
        setPushPermission('granted');
        localStorage.setItem('voltsenseNotificationsEnabled', 'true');
        showModal('Enabled', 'This device will now receive alerts.', 'alert');
      } else {
        showModal('Permission Denied', 'Please allow notifications in your browser settings to receive alerts.', 'alert');
      }
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
        <div className="flex items-center gap-2">
          <button 
            onClick={toggleGodMode}
            title={godMode ? 'God Mode Active (Click to disable)' : 'Enable God Mode / Demo Suite'}
            aria-label={godMode ? 'God Mode Active' : 'Enable God Mode'}
            className={`shrink-0 flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-xl md:rounded-2xl border transition-all duration-300 ease-apple-spring ${
              godMode
                ? 'bg-amber-400 text-amber-950 border-amber-500 shadow-sm shadow-amber-400/30 ring-2 ring-amber-300/60'
                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
            }`}
          >
            <Zap className={`w-4 h-4 md:w-4.5 md:h-4.5 shrink-0 ${godMode ? 'fill-current animate-pulse text-amber-950' : 'text-amber-700'}`} />
          </button>
          <button 
            onClick={handleSignOut}
            className="shrink-0 flex items-center gap-1.5 bg-red-50 text-red-600 px-3 md:px-4 py-2 md:py-2.5 rounded-xl md:rounded-2xl border border-red-100 text-[10px] md:text-sm font-bold uppercase tracking-wider hover:bg-red-100 transition-all duration-300 ease-out"
          >
            <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* God Mode / Demonstration Control Suite Panel */}
      {godMode && (
        <GodModePanel 
          activeDeviceId={activeDeviceId} 
          onDisable={() => {
            setGodMode(false);
            try {
              localStorage.setItem('voltsense_god_mode', 'false');
            } catch {}
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5 items-start">
        {/* Left Column (Desktop: 7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4 md:gap-5">
          {/* Paired Devices Section */}
          <div className="settings-paired-devices bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6">
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

          {/* Device limits — the four settings that had no UI, plus per-port policy */}
          <div className="settings-device-limits bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6">
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(deviceLimitsMeta).map(([field, meta]) => (
                <label key={field} className="block p-3 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                      {meta.label} ({meta.unit})
                    </span>
                    <span className="block text-[10px] text-gray-400 mb-2 leading-snug">{meta.hint}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
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
                      className="w-full text-[16px] md:text-sm font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-maroon-300"
                    />
                    {savingLimit === field && <Loader2 className="w-4 h-4 animate-spin text-maroon-800 shrink-0" />}
                  </div>
                </label>
              ))}
            </div>

            {/* Bench Test Mode Toggle */}
            <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-gray-800">
                    Bench Test Mode (USB Desk Testing)
                  </span>
                  {isBenchMode && (
                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">
                  {isBenchMode
                    ? 'Bypasses 220V mains detection. Uses supply voltage so you can test ACS712 current sensors over USB.'
                    : 'Strict AC mains monitoring. Requires live 220V on ZMPT101B sensor. Clamps to 0 if unplugged.'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleBenchModeToggle}
                disabled={savingLimit === 'bench_mode'}
                aria-label={`Toggle Bench Test Mode ${isBenchMode ? 'Off' : 'On'}`}
                className={`relative w-12 h-7 shrink-0 rounded-full flex items-center p-1 transition-colors duration-300 ease-apple-spring focus:outline-none focus:ring-2 focus:ring-maroon-500/30 ${
                  isBenchMode ? 'bg-amber-600' : 'bg-gray-200'
                }`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow-md flex items-center justify-center transform transition-transform duration-300 ease-apple-spring ${
                    isBenchMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                >
                  {savingLimit === 'bench_mode' && (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-700" />
                  )}
                </div>
              </button>
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

        </div>

        {/* Right Column (Desktop: 5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4 md:gap-5">
          {/* Night Mode Section */}
          <div className="settings-night-mode bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6">
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

          {/* Notifications Section */}
          <div className="settings-push-notifications bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6">
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
      </div>

      {/* Sensor Calibration & Accuracy Section (Full Width) */}
          <div className="settings-calibration bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
                  <SlidersHorizontal className="w-5 h-5 md:w-6 md:h-6 text-maroon-800" />
                </div>
                <div>
                  <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-0.5">
                    Sensor Calibration & Accuracy
                  </h3>
                  <p className="text-[10px] md:text-sm text-gray-500 font-medium leading-tight">
                    Hardware tuning for ACS712, ZMPT101B, and occupancy fusion
                  </p>
                </div>
              </div>
            </div>

            {calFeedback && (
              <div className="mb-4 flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 animate-in fade-in">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{calFeedback}</span>
              </div>
            )}

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {/* One-Tap Zero Tare */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Gauge className="w-4 h-4 text-maroon-800" />
                    <span className="text-xs font-bold text-gray-800">Current Zero-Tare</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                    Recalibrate 0.00 A zero-offset on all ACS712 sensors while outlets have no loads connected.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleZeroTareCurrent}
                  disabled={savingLimit === 'zero_tare_current'}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-maroon-800 hover:bg-maroon-900 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingLimit === 'zero_tare_current' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  <span>Zero-Tare Current Sensors</span>
                </button>
              </div>

              {/* Voltage Auto-Calibration */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-4 h-4 text-cyan-600" />
                    <span className="text-xs font-bold text-gray-800">Voltage Auto-Calibration</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                    Samples live 220V grid AC sine wave across 200ms to calculate and store exact sensor factor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAutoCalibrateVoltage}
                  disabled={savingLimit === 'auto_cal_voltage'}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingLimit === 'auto_cal_voltage' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>Auto-Calibrate (220V Grid)</span>
                </button>
              </div>
            </div>

            {/* Electrical Sensor Precision Tuning */}
            <div className="mb-5 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-4 h-4 text-maroon-800" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Electrical Sensor Precision Parameters
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                Fine-tune ACS712 current and ZMPT101B voltage sensor scaling to match calibrated reference meters.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(electricalCalMeta).map(([field, meta]) => (
                  <label key={field} className="block p-3 rounded-2xl bg-gray-50 border border-gray-100 flex flex-col justify-between">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">
                        {meta.label} ({meta.unit})
                      </span>
                      <span className="block text-[10px] text-gray-400 mb-2 leading-snug">{meta.hint}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-auto">
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
                        className="w-full text-[16px] md:text-sm font-semibold text-gray-900 bg-white border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-maroon-300"
                      />
                      {savingLimit === field && <Loader2 className="w-4 h-4 animate-spin text-maroon-800 shrink-0" />}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Occupancy Sensor Fusion Selector */}
            <div className="pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-maroon-800" />
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Occupancy Sensor Fusion Strategy
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-maroon-800 bg-maroon-50 px-2 py-0.5 rounded-md">
                  {storedSensorFusion}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                Determines how PIR passive infrared and 24GHz mmWave radar signals combine to detect presence.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  {
                    id: 'OR',
                    title: 'OR (Dual-Trigger)',
                    desc: 'Either sensor maintains presence. Fastest & fail-safe.'
                  },
                  {
                    id: 'PIR_WAKE_MMWAVE_HOLD',
                    title: 'PIR Wake + mmWave Hold',
                    desc: 'PIR wakes room on entry; radar holds while seated/still.'
                  },
                  {
                    id: 'AND',
                    title: 'AND (Co-Validation)',
                    desc: 'Both sensors must detect. Highest false-positive rejection.'
                  }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={async () => {
                      setSavingLimit('fusion_mode');
                      await updateDeviceSetting('sensor_fusion_mode', mode.id);
                      setSavingLimit(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      storedSensorFusion === mode.id
                        ? 'bg-maroon-50 border-maroon-300 text-maroon-950 font-bold shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <div className="text-xs font-bold mb-0.5">{mode.title}</div>
                    <div className="text-[10px] text-gray-500 leading-snug font-normal">{mode.desc}</div>
                  </button>
                ))}
              </div>

              {/* Presence Hold-Off Smoothing Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-gray-100">
                <div className="p-3 bg-gray-50/80 rounded-2xl border border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-gray-800">PIR Motion Hold Delay</span>
                    <span className="text-[10px] font-mono font-bold text-maroon-800 bg-white px-2 py-0.5 rounded border border-gray-200">
                      {limits.pirDelay}s
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-2 leading-tight">
                    Motion smoothing bridge (1–60s). Keeps room active across brief pauses.
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={limits.pirDelay}
                      onChange={(e) => setLimits((prev) => ({ ...prev, pirDelay: Number(e.target.value) }))}
                      onBlur={(e) => handleLimitSave('pirDelay', e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-gray-800 focus:outline-none focus:border-maroon-800"
                    />
                    <span className="text-xs font-bold text-gray-500">sec</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 5, 10, 15].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleLimitSave('pirDelay', sec)}
                        className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border transition-all ${
                          Number(limits.pirDelay) === sec
                            ? 'bg-maroon-800 text-white border-maroon-800 font-bold'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-gray-50/80 rounded-2xl border border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-gray-800">mmWave Radar Hold Delay</span>
                    <span className="text-[10px] font-mono font-bold text-maroon-800 bg-white px-2 py-0.5 rounded border border-gray-200">
                      {limits.mmwaveDelay}s
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-2 leading-tight">
                    Stillness bridge (0–60s). Prevents radar flicker when occupants are motionless.
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={limits.mmwaveDelay}
                      onChange={(e) => setLimits((prev) => ({ ...prev, mmwaveDelay: Number(e.target.value) }))}
                      onBlur={(e) => handleLimitSave('mmwaveDelay', e.target.value)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-gray-800 focus:outline-none focus:border-maroon-800"
                    />
                    <span className="text-xs font-bold text-gray-500">sec</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[0, 1, 3, 5, 10].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleLimitSave('mmwaveDelay', sec)}
                        className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border transition-all ${
                          Number(limits.mmwaveDelay) === sec
                            ? 'bg-maroon-800 text-white border-maroon-800 font-bold'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Phase 1: 24GHz mmWave Radar Spatial Gating & Sensitivities (LD2410 UART) */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-maroon-800" />
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                      Phase 1: Radar Spatial Gating & Sensitivities
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                    isRadarUart
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    {isRadarUart ? 'UART Active (256k)' : 'GPIO 14 Fallback'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                  Configures high-frequency 24GHz FMCW distance cutoffs and energy thresholds to reject hallway movement and oscillating fan flutter.
                </p>

                {/* Live Radar Telemetry Ribbon */}
                <div className="bg-white p-3 rounded-2xl border border-gray-200/80 mb-3 shadow-2xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 flex items-center justify-between">
                    <span>Live Radar Telemetry</span>
                    <span className="font-mono text-gray-500">{isRadarUart ? `Target: ${liveRadarTargetState}` : 'Pin mode'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-gray-50 rounded-xl">
                      <div className="text-[9px] font-bold text-gray-400 uppercase">Detection Dist</div>
                      <div className="text-xs sm:text-sm font-extrabold text-gray-900 font-mono">
                        {isRadarUart && liveRadarDistance > 0 ? `${liveRadarDistance} cm` : '---'}
                      </div>
                    </div>
                    <div className="p-2 bg-gray-50 rounded-xl">
                      <div className="text-[9px] font-bold text-gray-400 uppercase">Breathing (Static)</div>
                      <div className="text-xs sm:text-sm font-extrabold text-maroon-800 font-mono">
                        {isRadarUart ? `${liveRadarStaticEnergy}%` : '---'}
                      </div>
                    </div>
                    <div className="p-2 bg-gray-50 rounded-xl">
                      <div className="text-[9px] font-bold text-gray-400 uppercase">Moving Energy</div>
                      <div className="text-xs sm:text-sm font-extrabold text-blue-800 font-mono">
                        {isRadarUart ? `${liveRadarMovingEnergy}%` : '---'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Distance Gate Selector */}
                <div className="p-3 bg-gray-50/80 rounded-2xl border border-gray-100 mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-gray-800">Max Distance Gate (Room Boundary Cutoff)</span>
                    <span className="text-[10px] font-mono font-bold text-maroon-800 bg-white px-2 py-0.5 rounded border border-gray-200">
                      Gate {limits.radarMaxGate} (~{(limits.radarMaxGate * 0.75).toFixed(2)}m)
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-2.5 leading-tight">
                    Any movement beyond this distance is ignored. Eliminates through-doorway hallway false triggers.
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((gate) => (
                      <button
                        key={gate}
                        type="button"
                        onClick={() => handleLimitSave('radarMaxGate', gate)}
                        className={`py-1.5 px-1 rounded-xl border text-center transition-all ${
                          Number(limits.radarMaxGate) === gate
                            ? 'bg-maroon-800 text-white border-maroon-800 font-bold shadow-xs'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <div className="text-[10px] font-bold">G{gate}</div>
                        <div className="text-[8px] opacity-75 font-mono">{(gate * 0.75).toFixed(1)}m</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Energy Threshold Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50/80 rounded-2xl border border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-gray-800">Breathing Sensitivity (Static)</span>
                      <span className="text-[10px] font-mono font-bold text-maroon-800 bg-white px-2 py-0.5 rounded border border-gray-200">
                        {limits.radarStaticThreshold}%
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mb-2 leading-tight">
                      Micromovement threshold (0–100%). Lower = more sensitive to breathing.
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={limits.radarStaticThreshold}
                        onChange={(e) => setLimits((prev) => ({ ...prev, radarStaticThreshold: Number(e.target.value) }))}
                        onBlur={(e) => handleLimitSave('radarStaticThreshold', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-gray-800 focus:outline-none focus:border-maroon-800"
                      />
                      <span className="text-xs font-bold text-gray-500">%</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[10, 20, 30, 40, 50].map((th) => (
                        <button
                          key={th}
                          type="button"
                          onClick={() => handleLimitSave('radarStaticThreshold', th)}
                          className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border transition-all ${
                            Number(limits.radarStaticThreshold) === th
                              ? 'bg-maroon-800 text-white border-maroon-800 font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {th}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50/80 rounded-2xl border border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-gray-800">Gross Motion Threshold (Moving)</span>
                      <span className="text-[10px] font-mono font-bold text-maroon-800 bg-white px-2 py-0.5 rounded border border-gray-200">
                        {limits.radarMovingThreshold}%
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mb-2 leading-tight">
                      Moving target energy threshold (0–100%). Higher rejects fan/curtain oscillation.
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={limits.radarMovingThreshold}
                        onChange={(e) => setLimits((prev) => ({ ...prev, radarMovingThreshold: Number(e.target.value) }))}
                        onBlur={(e) => handleLimitSave('radarMovingThreshold', e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-xl px-2.5 py-1 text-xs font-mono font-bold text-gray-800 focus:outline-none focus:border-maroon-800"
                      />
                      <span className="text-xs font-bold text-gray-500">%</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[15, 25, 30, 50, 70].map((th) => (
                        <button
                          key={th}
                          type="button"
                          onClick={() => handleLimitSave('radarMovingThreshold', th)}
                          className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border transition-all ${
                            Number(limits.radarMovingThreshold) === th
                              ? 'bg-maroon-800 text-white border-maroon-800 font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {th}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
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
