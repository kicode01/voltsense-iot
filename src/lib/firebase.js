import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";

// ---------------------------------------------------------------------------
// Firebase web configuration
//
// Read from `.env` (VITE_FIREBASE_*) with the project's own values as FALLBACKS.
//
// Why the fallbacks exist: `.env` is not committed, so a fresh clone must still build and run —
// hardcoding the values was doing that job. But hardcoding them alongside a populated `.env` gave
// TWO sources of truth that could silently drift: rotating the API key in `.env` would appear to do
// nothing, because the literal here would win. Reading the env FIRST means `.env` is authoritative,
// and the literals only cover the "no .env yet" case.
//
// These values are PUBLIC BY DESIGN — a Firebase web API key identifies a project, it does not
// authorise anything. Access is controlled by the database rules and App Check. Do NOT put a real
// secret in this file; server secrets live in the Vercel dashboard and are never `VITE_`-prefixed.
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBeTz-ZTkrVrq9k92HJ1ttvZb806voxpnM",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "voltsense-iot.firebaseapp.com",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    "https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "voltsense-iot",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "voltsense-iot.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "713519734511",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:713519734511:web:371723a8784e6ae525851a",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-WL37Y1Y3T9"
};

// A silent misconfiguration is the worst outcome here: the app boots, auth fails with an opaque
// error, and the cause is a missing `.env`. Say so loudly, once, in development.
if (import.meta.env.DEV) {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(
      `Firebase config incomplete (${missing.join(', ')}). Copy .env.example to .env and fill it in.`
    );
  }
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) {
    console.warn('VITE_FIREBASE_VAPID_KEY is not set — Web Push cannot be enabled.');
  }
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getDatabase(app);

// ---------------------------------------------------------------------------
// Messaging (FCM)
//
// Do NOT feature-detect with `try { getMessaging(app) } catch {}`. The SDK's
// getMessagingInWindow() runs its support check ASYNCHRONOUSLY and throws from inside the
// resulting promise:
//
//     isWindowSupported().then(isSupported => {
//         if (!isSupported) throw ERROR_FACTORY.create('unsupported-browser');
//     }, ...);
//     return _getProvider(...).getImmediate();   // <- returns normally
//
// So the call never throws where you can catch it; instead it produces an unhandled promise
// rejection on every unsupported browser (iOS Safari in a normal tab, older Android WebViews).
// The SDK exports `isSupported()` exactly so callers can check first — use that.
// ---------------------------------------------------------------------------
let messagingInstance = null;
let messagingChecked = false;

export const getMessagingInstance = async () => {
  if (messagingChecked) return messagingInstance;
  messagingChecked = true;

  try {
    if (typeof window === 'undefined') return null;

    const supported = await isMessagingSupported();
    if (!supported) {
      console.warn('Firebase Messaging is not supported in this environment; push is disabled.');
      return null;
    }
    messagingInstance = getMessaging(app);
  } catch (error) {
    console.warn('Firebase Messaging could not be initialised.', error);
    messagingInstance = null;
  }
  return messagingInstance;
};

export default app;
