import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ref, onValue, update, serverTimestamp } from 'firebase/database';
import { db } from '../lib/firebase';

// Firestore-style push ids (Firebase RTDB `push()` keys) are prefixed with a timestamp and sort
// chronologically as plain strings, so newest-first is a reverse key sort — no need to read `at`
// off every entry. Entries written by api/alert.js always have an `at`, but sorting on the key
// means a malformed entry can still be placed sensibly instead of landing at the top.
const byKeyDesc = (a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Read the alert history for a device and track which entries this user has already seen.
 *
 * Read state lives in the database, not localStorage: an installed PWA gets its storage evicted
 * (or is reinstalled) and would then re-announce every historical alert. Keying it per uid also
 * keeps two people sharing one phone from marking each other's alerts read.
 *
 * `lastSeenId` is a millisecond timestamp, not an alert id, so an alert written a second ago counts
 * as unread even before this client has received the snapshot listing it.
 *
 * @param {string|null} deviceId  MAC address of the active device
 * @param {string|null} userId    auth uid of the signed-in user
 */
export const useAlerts = (deviceId, userId) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  // THREE-STATE, and the distinction is load-bearing:
  //   undefined -> the read marker has not arrived yet (loading)
  //   null      -> it arrived, and there is no marker / no user: everything is unread
  //   number    -> that timestamp is the read watermark
  //
  // The previous version used a plain `null` for both "loading" and "no marker", which meant the
  // very first render of every session reported every alert as unread. A brand-new account with no
  // marker on file would flash a full unread badge, and — worse — an account that HAD read
  // everything still showed `alerts.length` unread until the listener happened to fire, because a
  // null marker was indistinguishable from an absent one. A separate `hasMarker` flag below
  // captures the same distinction without making every consumer handle `undefined`.
  const [lastSeenId, setLastSeenId] = useState(undefined);
  const [error, setError] = useState(null);

  // Identifies the newest alert we have already reported to the catch-up notifier, so opening the
  // app twice does not re-announce the same entries. Kept in a ref rather than state because
  // changing it must not trigger a re-render or re-run any effect.
  const announcedRef = useRef(null);

  useEffect(() => {
    if (!deviceId) {
      setAlerts([]);
      setLoading(true);
      setError(null);
      return;
    }

    // Never render device A's alerts under device B — same reasoning as useRoomData.
    setAlerts([]);
    setLoading(true);
    setError(null);
    announcedRef.current = null;

    const alertsRef = ref(db, `devices/${deviceId}/alerts`);

    const unsubscribe = onValue(
      alertsRef,
      (snapshot) => {
        const value = snapshot.val() || {};
        const list = Object.entries(value)
          .map(([id, entry]) => ({
            id,
            // Spread first so an entry's own fields always win over the defaults below.
            ...entry,
            at: Number(entry?.at) || 0,
            title: entry?.title || 'VoltSense Alert',
            body: entry?.body || '',
            outcome: entry?.outcome || 'unknown'
          }))
          .sort(byKeyDesc);

        setAlerts(list);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to read alert history:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [deviceId]);

  useEffect(() => {
    if (!userId || !deviceId) {
      // No signed-in user, or no device: there is nothing to have read. This is a real answer, not
      // a pending one, so resolve to `null` rather than leaving the badge stuck in its loading
      // state.
      setLastSeenId(null);
      return;
    }

    // Reset to "unknown" whenever the marker's identity changes, so a user or device switch cannot
    // briefly show the previous owner's unread count against the new device's list.
    setLastSeenId(undefined);

    const seenRef = ref(db, `devices/${deviceId}/alert_reads/${userId}`);

    const unsubscribe = onValue(
      seenRef,
      (snapshot) => {
        const value = snapshot.val();
        const at = value && typeof value === 'object' ? Number(value.last_seen_at) : NaN;
        // NaN means "read succeeded, no usable marker" — that is the everything-unread case, and it
        // must resolve to null (not undefined) so the badge stops being suppressed.
        setLastSeenId(Number.isFinite(at) ? at : null);
      },
      (err) => {
        // A missing read marker is not fatal — everything just shows as unread.
        console.warn('Could not read the alert read marker:', err?.message || err);
        setLastSeenId(null);
      }
    );

    return () => unsubscribe();
  }, [deviceId, userId]);

  // While the marker is still loading we report 0 rather than "everything". Showing an unread
  // badge that then collapses to nothing is a worse first impression than showing nothing that
  // then becomes a badge, and the collapsed-catch-up path already announces genuinely new alerts.
  const markerLoading = lastSeenId === undefined;

  const unreadAlerts = useMemo(() => {
    if (markerLoading) return [];
    if (lastSeenId === null) return alerts;
    return alerts.filter((alert) => alert.at > lastSeenId);
  }, [alerts, lastSeenId, markerLoading]);

  const unreadCount = unreadAlerts.length;

  /** Mark everything currently visible as seen. Idempotent and safe to call on every mount. */
  const markAllSeen = useCallback(async () => {
    if (!deviceId || !userId || alerts.length === 0) return false;

    // Do not mark anything while the marker is still loading. `undefined >= newest` is false, so
    // the old guard let this through and the write would stamp the newest timestamp as read before
    // the user had seen the page — permanently hiding alerts they never read. Waiting is correct:
    // the Alerts page re-runs this once the marker resolves.
    if (markerLoading) return false;

    const newest = alerts[0].at;
    // Bail out when the marker is already current: this runs on every Alerts-page mount and a
    // redundant write would bump `updated_at` and wake every listener for no reason.
    if (lastSeenId !== null && lastSeenId >= newest) return false;

    try {
      await update(ref(db, `devices/${deviceId}/alert_reads/${userId}`), {
        last_seen_at: newest,
        updated_at: serverTimestamp()
      });
      return true;
    } catch (err) {
      console.error('Could not update the alert read marker:', err);
      return false;
    }
  }, [deviceId, userId, alerts, lastSeenId, markerLoading]);

  return {
    alerts,
    loading,
    error,
    unreadCount,
    unreadAlerts,
    lastSeenId,
    markerLoading,
    markAllSeen,
    announcedRef
  };
};
