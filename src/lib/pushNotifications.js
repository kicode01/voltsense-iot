import { getToken, onMessage } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
// Lazily obtain the guarded messaging instance. Importing firebase.js must not itself trigger an
// FCM support check, because the SDK reports unsupported browsers via an unhandled rejection.
import { getMessagingInstance, db } from './firebase';

// Every device that wants push alerts registers its FCM token here, keyed by auth uid, so the
// serverless sender can address a person without knowing anything about their phone.
export const pushTokenPath = (uid) => `pushTokens/${uid}`;

const isPushSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.Notification !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

/**
 * Ask for permission and, if granted, mint an FCM token.
 *
 * Returns the token string, or null when push is unsupported, denied, or unconfigured. Callers
 * MUST treat null as "no push", never as an error — most of the failure modes here are ordinary
 * (iOS in a normal tab, permission dismissed) and must not surface as an app-level failure.
 */
export const requestNotificationPermission = async () => {
  try {
    if (!isPushSupported()) return null;

    const messaging = await getMessagingInstance();
    if (!messaging) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return null;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn('VITE_FIREBASE_VAPID_KEY is not set; cannot obtain an FCM token.');
      return null;
    }

    // Always bind FCM to the active PWA worker (vite.config.js imports the background handler).
    // getRegistration() can return null on the first page load while Workbox is installing; if
    // omitted, getToken silently registers a SECOND worker and this token targets the wrong one.
    // Bound the wait so a failed/offline worker install cannot leave Settings spinning forever.
    let timeoutId;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => { timeoutId = setTimeout(() => resolve(null), 10000); })
    ]);
    clearTimeout(timeoutId);
    if (!registration) {
      console.warn('The PWA service worker did not become ready; push registration was skipped.');
      return null;
    }

    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    return token || null;
  } catch (error) {
    console.error('An error occurred while requesting permission. ', error);
    return null;
  }
};

/** Persist a token against the signed-in user so the server can reach this device. */
export const storePushToken = async (uid, token) => {
  if (!uid || !token) return false;
  try {
    await set(ref(db, pushTokenPath(uid)), {
      token,
      platform: typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 180) : '',
      updated_at: Date.now()
    });
    return true;
  } catch (error) {
    console.error('Could not store the push token:', error);
    return false;
  }
};

/** Forget this device — called on sign-out so a shared phone stops receiving someone else's alerts. */
export const clearPushToken = async (uid) => {
  if (!uid) return false;
  try {
    await set(ref(db, pushTokenPath(uid)), null);
    return true;
  } catch (error) {
    console.error('Could not clear the push token:', error);
    return false;
  }
};

/**
 * Permission plus storage in one step. This is the call the rest of the app should use: it
 * guarantees a granted permission always ends with a token on the server.
 */
export const enablePushForUser = async (uid) => {
  const token = await requestNotificationPermission();
  if (!token) return null;
  const stored = await storePushToken(uid, token);
  return stored ? token : null;
};

export const onMessageListener = async () => {
  const messaging = await getMessagingInstance();
  if (!messaging) return null;
  return new Promise((resolve) => {
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });
};
