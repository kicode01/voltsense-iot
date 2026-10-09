/**
 * Shared Firebase Admin bootstrap for the VoltSense serverless functions.
 *
 * Extracted so `alert`, `pair` and `claim` cannot drift apart — three copies of an init routine is
 * three places to get the private-key newline handling wrong, and the failure (everything 500s) is
 * indistinguishable from a bad environment variable.
 *
 * Required environment variables (Vercel dashboard, never in the repo):
 *   FIREBASE_SERVICE_ACCOUNT — the service-account JSON, as a single-line string
 *   FIREBASE_DATABASE_URL    — e.g. https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

// ---------------------------------------------------------------------------
// firebase-admin v14 compatibility shim
// ---------------------------------------------------------------------------
// v14 dropped the entire namespaced API that this codebase was written against. Gone:
//   admin.credential.cert()   ->  admin.cert()            (now top-level)
//   admin.apps / admin.app()  ->  admin.getApps() / admin.getApp()
//   admin.database()          ->  require('firebase-admin/database').getDatabase()
//   admin.auth()              ->  require('firebase-admin/auth').getAuth()
//   admin.messaging()         ->  require('firebase-admin/messaging').getMessaging()
//
// Left alone, every one of these reads as `undefined is not a function` at request time and the
// failure is indistinguishable from a bad credential — which is exactly how this shipped broken.
// Re-adding the namespaced surface here keeps all five handlers (and their 9 call sites) unchanged
// and confines the version difference to one file. The modular functions are required lazily so a
// missing subpath fails at the call that needs it, not at module load.
const lazy = (request) => {
  let mod = null;
  return (...args) => {
    if (!mod) mod = request();
    return mod(...args);
  };
};

if (typeof admin.cert === 'function') {
  admin.credential = admin.credential || { cert: (serviceAccount) => admin.cert(serviceAccount) };
}
if (!admin.apps) {
  // An array's `length` is non-configurable, so this cannot be a defineProperty getter — it is a
  // Proxy whose `length` and indices are read straight off the live app list each time. Only the
  // two things the codebase actually touches (`admin.apps.length`, `admin.app()`) need to work.
  admin.apps = new Proxy([], {
    get: (_t, prop) => {
      const apps = admin.getApps();
      if (prop === 'length') return apps.length;
      const v = apps[prop];
      return typeof v === 'function' ? v.bind(apps) : v;
    },
    has: (_t, prop) => prop in admin.getApps()
  });
}
if (typeof admin.app !== 'function') {
  admin.app = (name) => admin.getApp(name);
}

if (typeof admin.messaging !== 'function') {
  admin.messaging = lazy(() => require('firebase-admin/messaging').getMessaging);
}

let initError = null;

const getApp = () => {
  // firebase-admin v14 removed the `admin.apps` / `admin.app` namespaced properties that older
  // tutorials use. Reading `admin.apps.length` here threw `Cannot read properties of undefined`
  // on EVERY invocation — every endpoint 500'd before it could even read its env var. The
  // supported namespaced accessors are `getApps()` / `getApp()`, which exist in v9 through v14.
  if (admin.getApps().length) return admin.getApp();
  if (initError) throw initError;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  try {
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
    if (!databaseURL) throw new Error('FIREBASE_DATABASE_URL is not set');

    // The dashboard stores this as a single-line string, but a pasted pretty-printed JSON blob is
    // the most likely mistake, so accept both. JSON.parse tolerates the newlines.
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key && serviceAccount.private_key.includes('\\n')) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  } catch (error) {
    initError = error;
    throw error;
  }
};

/**
 * Compare two strings without leaking their length or the position of the first mismatch.
 * Returns false on length mismatch, which is an unavoidable timing signal, but the comparison
 * itself stays constant-time so the secret cannot be recovered byte by byte.
 */
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Normalise the request body. Arduino's HTTPClient cannot cheaply set custom headers, so these
 * endpoints read the secret from the body; Vercel parses JSON bodies automatically but a raw string
 * arrives when the caller forgets Content-Type. Accept both.
 */
const readBody = (req) => {
  const body = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
  return body && typeof body === 'object' ? body : null;
};

/** A Firebase-safe key from a MAC: uppercase, colons preserved (the firmware's own convention). */
const normalizeMac = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

/**
 * Hash a device secret for storage.
 *
 * The per-device alert secret is a high-entropy random value (256 bits of base64url), so a single
 * unsalted SHA-256 is the correct primitive here — there is no dictionary to attack and no need for
 * a slow KDF. What it buys is that a database leak (or a console operator browsing the tree) yields
 * nothing that can be replayed against /api/alert.
 *
 * Prefix the result so a future format change can be detected rather than silently mismatched.
 */
const hashSecret = (secret) =>
  `sha256:${crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex')}`;

/**
 * Compare two values in constant time.
 *
 * `crypto.timingSafeEqual` throws on a length mismatch, which would itself leak the length — so
 * lengths are checked first and the comparison only runs on equal-length buffers.
 */
const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

module.exports = {
  getApp,
  safeEqual,
  safeJsonParse,
  readBody,
  normalizeMac,
  hashSecret,
  timingSafeEqual
};
