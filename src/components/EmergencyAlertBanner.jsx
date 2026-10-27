import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldCheck, Volume2, X, Loader2, Bell } from 'lucide-react';
import { useRoomData } from '../hooks/useRoomData';
import { playEmergencyAlarm } from '../lib/soundAlert';
import { showSystemNotification, requestNotificationPermission } from '../lib/pushNotifications';
import { formatDurationPhrase } from '../lib/formatDuration';
import { auth } from '../lib/firebase';

export const EmergencyAlertBanner = ({ activeDeviceId }) => {
  const { roomData, setOverride, updateDeviceSetting } = useRoomData(activeDeviceId);
  const [simulatedAlert, setSimulatedAlert] = useState(false);
  const [simulatedCountdown, setSimulatedCountdown] = useState(60);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hasPermission, setHasPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );
  const lastAlarmTimeRef = useRef(0);
  const lastRemoteAlertUntilRef = useRef(0);
  const lastRemoteSirenAtRef = useRef(0);
  const lastRealResponseStartRef = useRef(0);
  const simTimerRef = useRef(null);

  // Listen to custom demo alert events fired locally from God Mode or Demo triggers
  useEffect(() => {
    const handleTriggerAlert = (event) => {
      const countdownSec = event.detail?.seconds || 15;
      const alertUntil = event.detail?.alertUntil || Date.now() + countdownSec * 1000;
      const uniqueTag = event.detail?.tag || `volt-sense-shutdown-${alertUntil}`;

      lastRemoteAlertUntilRef.current = alertUntil;
      setSimulatedCountdown(countdownSec);
      setSimulatedAlert(true);
      setDismissed(false);
      playEmergencyAlarm();
      lastAlarmTimeRef.current = Date.now();

      showSystemNotification('Auto-Shutdown Warning', {
        body: `The room has been empty. Devices will shut down in ${formatDurationPhrase(countdownSec)} unless you keep them on.`,
        tag: uniqueTag,
        data: { url: '/dashboard' }
      });
    };

    const handleCancelAlert = () => {
      setSimulatedAlert(false);
    };

    window.addEventListener('voltsense-trigger-alert', handleTriggerAlert);
    window.addEventListener('voltsense-cancel-alert', handleCancelAlert);

    return () => {
      window.removeEventListener('voltsense-trigger-alert', handleTriggerAlert);
      window.removeEventListener('voltsense-cancel-alert', handleCancelAlert);
    };
  }, []);

  // Listen for cross-device simulated emergency alert broadcasts via Firebase RTDB
  const remoteAlertUntil = Number(roomData?.settings?.simulated_alert_until) || 0;
  useEffect(() => {
    if (!remoteAlertUntil) {
      if (lastRemoteAlertUntilRef.current !== 0) {
        lastRemoteAlertUntilRef.current = 0;
        setSimulatedAlert(false);
      }
      return;
    }

    if (remoteAlertUntil !== lastRemoteAlertUntilRef.current) {
      lastRemoteAlertUntilRef.current = remoteAlertUntil;
      const remainingSec = Math.ceil((remoteAlertUntil - Date.now()) / 1000);
      if (remainingSec > 0 && remainingSec <= 600) {
        setSimulatedCountdown(remainingSec);
        setSimulatedAlert(true);
        setDismissed(false);
        playEmergencyAlarm();
        lastAlarmTimeRef.current = Date.now();

        showSystemNotification('Auto-Shutdown Warning', {
          body: `The room has been empty. Devices will shut down in ${formatDurationPhrase(remainingSec)} unless you keep them on.`,
          tag: `volt-sense-shutdown-${remoteAlertUntil}`,
          data: { url: '/dashboard' }
        });
      }
    }
  }, [remoteAlertUntil]);

  // Listen for cross-device siren & haptics broadcasts via Firebase RTDB
  const remoteSirenAt = Number(roomData?.settings?.simulated_siren_at) || 0;
  useEffect(() => {
    if (!remoteSirenAt || remoteSirenAt === lastRemoteSirenAtRef.current) return;
    lastRemoteSirenAtRef.current = remoteSirenAt;
    if (Math.abs(Date.now() - remoteSirenAt) < 10000) {
      playEmergencyAlarm();
    }
  }, [remoteSirenAt]);

  // Simulated countdown interval
  useEffect(() => {
    if (!simulatedAlert) return;
    simTimerRef.current = setInterval(() => {
      setSimulatedCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(simTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(simTimerRef.current);
  }, [simulatedAlert]);

  const isRealResponseWindow = roomData?.state === 'RESPONSE_WINDOW';
  const isActive = (isRealResponseWindow || simulatedAlert) && !dismissed;

  const remainingSeconds = simulatedAlert
    ? simulatedCountdown
    : (roomData?.countdown_remaining_seconds ?? (roomData?.settings?.response_window_seconds || 300));

  // Trigger push notification, cross-device alert, and sound on REAL hardware RESPONSE_WINDOW transition
  useEffect(() => {
    if (!isRealResponseWindow) {
      lastRealResponseStartRef.current = 0;
      return;
    }

    const now = Date.now();
    // Only fire initial push and cross-device notification once per response window cycle (minimum 60s re-arm)
    if (now - lastRealResponseStartRef.current > 60000) {
      lastRealResponseStartRef.current = now;
      const uniqueTag = `volt-sense-shutdown-real-${now}`;

      // 1. Fire local system / OS notification
      showSystemNotification('Auto-Shutdown Warning', {
        body: `The room has been empty. Devices will shut down in ${formatDurationPhrase(remainingSeconds)} unless you keep them on.`,
        tag: uniqueTag,
        data: { url: '/dashboard' }
      });

      // 2. Play local siren
      playEmergencyAlarm();
      lastAlarmTimeRef.current = now;

      // 3. Dispatch to /api/alert to push to background mobile devices
      if (activeDeviceId) {
        auth.currentUser?.getIdToken().then((idToken) => {
          if (!idToken) return;
          fetch('/api/alert', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
              mac: activeDeviceId,
              title: 'Auto-Shutdown Warning',
              body: `The room has been empty. Devices will shut down in ${formatDurationPhrase(remainingSeconds)} unless you keep them on.`,
              tag: uniqueTag
            })
          }).catch((err) => console.warn('Could not dispatch real response window push:', err));
        }).catch(() => {});
      }
    }
  }, [isRealResponseWindow, remainingSeconds, activeDeviceId]);

  // Sound alarm when entering response window (throttled to once every 12 seconds)
  useEffect(() => {
    if (isActive) {
      const now = Date.now();
      if (now - lastAlarmTimeRef.current > 12000) {
        lastAlarmTimeRef.current = now;
        playEmergencyAlarm();
      }
    }
  }, [isActive, remainingSeconds]);

  if (!isActive) return null;

  const handleKeepPowerOn = async () => {
    setCancelling(true);
    try {
      if (simulatedAlert) {
        setSimulatedAlert(false);
        if (activeDeviceId) {
          updateDeviceSetting('simulated_alert_until', 0).catch(() => {});
        }
      }
      await setOverride(true);
      setDismissed(true);
    } catch (err) {
      console.error('Failed to cancel shutdown:', err);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[120] bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white shadow-2xl border-b-2 border-red-400/50 animate-in slide-in-from-top duration-300 transform-gpu"
    >
      <div className="max-w-5xl lg:max-w-7xl mx-auto px-4 py-3 md:py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 md:gap-6">
        {/* Left Side: Pulsing Siren & Emergency Context */}
        <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
          <div className="relative shrink-0">
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 animate-pulse">
              <AlertTriangle className="w-6 h-6 text-white drop-shadow" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-300 rounded-full animate-ping" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/20">
                Auto-Cutoff Imminent
              </span>
              <button
                onClick={() => playEmergencyAlarm()}
                title="Re-play alarm sound"
                aria-label="Replay Alarm Sound"
                className="text-white/80 hover:text-white transition-opacity p-0.5"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs md:text-sm font-bold text-white/95 truncate mt-0.5">
              Room idle · Outlets turning off in{' '}
              <span className="font-mono text-base md:text-lg font-black text-yellow-200">
                {remainingSeconds}s
              </span>
            </p>
          </div>
        </div>

        {/* Right Side: Big Override Action Button + Dismiss */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end shrink-0">
          {!hasPermission && typeof window !== 'undefined' && 'Notification' in window && (
            <button
              onClick={async () => {
                const token = await requestNotificationPermission();
                if (token || Notification.permission === 'granted') {
                  setHasPermission(true);
                  showSystemNotification('Notifications Enabled', {
                    body: 'You will now receive instant shutdown warnings and emergency alerts.'
                  });
                }
              }}
              className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-black uppercase tracking-wider px-3 py-2 rounded-xl shadow-md transition-all active:scale-95 shrink-0"
              title="Allow browser notifications for auto-shutdown alerts"
            >
              <Bell className="w-3.5 h-3.5 fill-current" />
              <span>Allow Alerts</span>
            </button>
          )}

          <button
            onClick={handleKeepPowerOn}
            disabled={cancelling}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-white text-red-600 active:scale-95 font-black text-xs md:text-sm uppercase tracking-wider px-5 py-2.5 rounded-xl md:rounded-2xl shadow-lg transition-all duration-300 ease-apple-spring border border-white/80 disabled:opacity-70"
          >
            {cancelling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                <span>Cancelling…</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Keep Power On</span>
              </>
            )}
          </button>

          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss Banner"
            className="text-white/70 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmergencyAlertBanner;
