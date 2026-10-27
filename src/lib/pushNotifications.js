import { getToken, onMessage } from 'firebase/messaging';
import { ref, set, update } from 'firebase/database';
// Lazily obtain the guarded messaging instance. Importing firebase.js must not itself trigger an
// FCM support check, because the SDK reports unsupported browsers via an unhandled rejection.
import { getMessagingInstance, db } from './firebase';

// Every device that wants push alerts registers its FCM token here, keyed by auth uid, so the
// serverless sender can address a person without knowing anything about their phone.
export const pushTokenPath = (uid) => `pushTokens/${uid}`;

// Public Web Push VAPID key (applicationServerKey). Like firebaseConfig in firebase.js, read from
// import.meta.env first with the project's public key as fallback so builds without .env still
// mint real FCM tokens instead of dead-code-eliminating getToken().
const DEFAULT_VAPID_KEY =
  'BFCqqmsei0txBJ6cgq53niGL6_fhsVopo76Cgs19EJwvvTiNYe-4PE3YC0it5kddFucbxIDVeyTqE0FUrZmjhBY';

const isPushSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.Notification !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

const tokenSlotKey = (token) => {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `dev_${(h >>> 0).toString(16)}`;
};

/**
 * Display a system notification via the active Service Worker registration (required on Android
 * Chrome, where `new Notification()` throws Illegal constructor), with a fallback to the window
 * Notification constructor on desktop browsers without an active worker.
 */
export const showSystemNotification = async (title, options = {}) => {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return false;
  if (window.Notification.permission !== 'granted') return false;

  const payload = {
    icon: '/pwa-192x192.png',
    badge: '/favicon-48.png',
    vibrate: [200, 100, 200],
    renotify: true,
    tag: 'voltsense-alert',
    ...options
  };

  if ('serviceWorker' in navigator) {
    try {
      let timeoutId;
      const registration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(null), 4000);
          })
        ]));
      clearTimeout(timeoutId);
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, payload);
        return true;
      }
    } catch (err) {
      console.warn('ServiceWorker showNotification failed, falling back:', err);
    }
  }

  try {
    new window.Notification(title, payload);
    return true;
  } catch (err) {
    console.warn('Fallback Notification constructor failed:', err);
    return false;
  }
};

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

    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return null;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || DEFAULT_VAPID_KEY;
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

/** Persist a token against the signed-in user so the server can reach this device (and keep multi-device tokens). */
export const storePushToken = async (uid, token) => {
  if (!uid || !token) return false;
  try {
    const now = Date.now();
    const platform = typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 180) : '';
    const slot = tokenSlotKey(token);
    await update(ref(db, pushTokenPath(uid)), {
      token,
      platform,
      userAgent,
      updated_at: now,
      [`devices/${slot}`]: {
        token,
        platform,
        userAgent,
        updated_at: now
      }
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

let foregroundUnsubscribe = null;

/**
 * Subscribe to foreground FCM messages (`onMessage`). When the PWA is open in the foreground on
 * mobile, FCM suppresses `onBackgroundMessage` in the Service Worker and delivers the payload here
 * instead. Forwarding it to `showSystemNotification` ensures the OS banner still drops down.
 */
export const subscribeForegroundPush = async () => {
  if (foregroundUnsubscribe) return foregroundUnsubscribe;
  const messaging = await getMessagingInstance();
  if (!messaging) return null;

  foregroundUnsubscribe = onMessage(messaging, (payload) => {
    const data = payload?.data || {};
    const notification = payload?.notification || {};
    const title = data.title || notification.title || 'VoltSense Alert';
    const body = data.body || notification.body || 'The room has been empty.';
    showSystemNotification(title, {
      body,
      tag: data.tag || 'voltsense-alert',
      data: { url: data.url || '/alerts' }
    });
  });

  return foregroundUnsubscribe;
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
