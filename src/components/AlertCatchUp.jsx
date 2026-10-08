import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../lib/errors';

// Minimum gap between catch-up notifications. Without this, tabbing back and forth would re-fire
// the summary on every mount and feel like a bug rather than a feature.
const COOLDOWN_MS = 60 * 1000;

const announcedKey = (deviceId) => `voltsense_catchup_announced_${deviceId}`;

/**
 * Announce, once per app open, that alerts happened while the app was closed.
 *
 * Why this exists: FCM delivery is best-effort by design. The phone can be offline, iOS only
 * delivers Web Push to a home-screen PWA, permission can be denied, and a Vercel cold start can
 * fail. None of those stop the alert from being recorded, so the history is the source of truth
 * and this is the reliable "you missed something" path.
 *
 * Colours of the summary:
 *   1 alert  → name it, so the message is directly useful
 *   2–5      → count them
 *   6+       → count + time span, and point at the tab rather than listing them
 *
 * Takes its data as props on purpose. The shell already subscribes to the alert history to drive
 * the nav badge, and a second `useAlerts()` here would open a duplicate listener on the same node
 * for no benefit.
 */
const AlertCatchUp = ({ alerts, loading, lastSeenId, deviceId }) => {
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    if (loading || !alerts.length || !deviceId) return;

    // `undefined` means the read marker has not resolved yet. Announcing on that basis would treat
    // the entire history as missed on every app open, so wait for a real answer.
    if (lastSeenId === undefined) return;

    // Nothing unread since the user last looked — there is nothing to catch up on.
    const missed = lastSeenId === null
      ? alerts
      : alerts.filter((alert) => alert.at > lastSeenId);
    if (missed.length === 0) return;

    // Guards against re-announcing the same batch. localStorage is right here specifically
    // because the value is throwaway: if it is evicted the worst case is one duplicate summary,
    // whereas the READ MARKER deliberately lives in the database for exactly the opposite reason.
    const newest = missed[0].id;
    let previous = null;
    try {
      previous = localStorage.getItem(announcedKey(deviceId));
    } catch {
      // Private-mode Safari can throw on localStorage access; treat it as "never announced".
      previous = null;
    }
    if (previous === newest) return;

    // Cooldown is applied even on a new batch, so a device flapping in and out of alerts cannot
    // turn the notification tray into a stream.
    let lastFired = 0;
    try {
      lastFired = Number(localStorage.getItem(`${announcedKey(deviceId)}_at`)) || 0;
    } catch {
      lastFired = 0;
    }
    if (Date.now() - lastFired < COOLDOWN_MS) return;

    // ALWAYS guard the Notification API. It is undefined on iOS Safari in a normal tab, on
    // iOS < 16.4, in Android WebViews and on non-secure origins — and an unguarded access here
    // would throw inside an effect, which tears down the whole React tree as a white page.
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
    if (window.Notification.permission !== 'granted') return;

    // Delay so the notification does not race the first paint; a summary appearing over a
    // still-blank screen reads as an error.
    timerRef.current = setTimeout(() => {
      let title;
      let body;

      if (missed.length === 1) {
        title = missed[0].title;
        body = missed[0].body || '1 alert while the app was closed.';
      } else if (missed.length <= 5) {
        title = `${missed.length} alerts`;
        body = `Recorded while the app was closed. Tap to review.`;
      } else {
        const oldest = missed[missed.length - 1];
        const since = oldest.at
          ? new Date(oldest.at).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'earlier';
        title = `${missed.length} alerts`;
        body = `${missed.length} alerts since ${since}. Tap to review.`;
      }

      try {
        const notification = new window.Notification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/favicon-48.png',
          // A tag of its own, so the catch-up never collapses a real live alert out of the tray.
          tag: 'voltsense-catchup',
          data: { url: '/alerts' }
        });

        notification.onclick = () => {
          try {
            window.focus();
          } catch {
            // window.focus() is a no-op in some contexts; the navigation below still works.
          }
          navigate('/alerts');
          notification.close();
        };
      } catch (error) {
        console.warn('Could not show the catch-up notification:', errorMessage(error));
        return;
      }

      try {
        localStorage.setItem(announcedKey(deviceId), newest);
        localStorage.setItem(`${announcedKey(deviceId)}_at`, String(Date.now()));
      } catch {
        // Non-fatal: worst case is a duplicate summary next open.
      }
    }, 800);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [alerts, loading, lastSeenId, deviceId, navigate]);

  return null;
};

export default AlertCatchUp;
