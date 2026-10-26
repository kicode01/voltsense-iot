import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldCheck, Volume2, X, Loader2 } from 'lucide-react';
import { useRoomData } from '../hooks/useRoomData';
import { playEmergencyAlarm } from '../lib/soundAlert';

export const EmergencyAlertBanner = ({ activeDeviceId }) => {
  const { roomData, setOverride } = useRoomData(activeDeviceId);
  const [simulatedAlert, setSimulatedAlert] = useState(false);
  const [simulatedCountdown, setSimulatedCountdown] = useState(60);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastAlarmTimeRef = useRef(0);
  const simTimerRef = useRef(null);

  // Listen to custom demo alert events fired from God Mode or Demo triggers
  useEffect(() => {
    const handleTriggerAlert = (event) => {
      const countdownSec = event.detail?.seconds || 30;
      setSimulatedCountdown(countdownSec);
      setSimulatedAlert(true);
      setDismissed(false);
      playEmergencyAlarm();
      lastAlarmTimeRef.current = Date.now();
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
          <button
            onClick={handleKeepPowerOn}
            disabled={cancelling}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-white text-red-600 hover:bg-yellow-50 active:scale-95 font-black text-xs md:text-sm uppercase tracking-wider px-5 py-2.5 rounded-xl md:rounded-2xl shadow-lg transition-all duration-300 ease-apple-spring border border-white/80 disabled:opacity-70"
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
