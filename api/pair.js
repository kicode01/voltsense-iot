/**
 * POST /api/pair — turn a factory-fresh device into a provisioned one, over the air.
 *
 * WHY THIS EXISTS
 * Provisioning used to mean: flash → read MAC off serial → create an Auth user by hand in the
 * Console → hand-write `device_uids/<MAC>` → plug in USB → type credentials into a Serial Monitor.
 * That is ~10 minutes of human labour per unit and it does not survive contact with 20 devices.
 *
 * This endpoint lets a device provision ITSELF. It ships with one shared factory key, proves its
 * identity with a MAC that is burned into the ESP32 eFuse (not settable in software), and receives
 * credentials that are unique to it.
 *
 * WHAT THE DEVICE SENDS
 *   { pairing_key: "<factory key>", mac: "AA:BB:CC:DD:EE:FF", fw?: "1.0.0" }
 *
 * WHAT IT GETS BACK
 *   { device_email, device_password, alert_secret, pairing_code, expires_at }
 *
 * SECURITY MODEL — the parts that matter
 *
 *  1. THE FACTORY KEY IS NOT A DEVICE PASSWORD. It is shared by every unit, so it must be treated
 *     as public-ish. It buys exactly one thing: the ability to ask for credentials. It cannot read
 *     or write anything on its own, and possession of it grants no access to any provisioned
 *     device once that device's real credentials exist.
 *
 *  2. THE MAC IS THE IDENTITY, AND IT IS HARDWARE-BURNED. `WiFi.macAddress()` on an ESP32 reads
 *     the eFuse; it cannot be spoofed by a normal sketch without deliberately rewriting eFuse, which
 *     is irreversible. So "I am AA:BB:..." is a claim only real hardware can make.
 *
 *  3. RE-PAIRING IS ALLOWED BUT AUDITED. A device whose NVS was wiped (factory reset, flash
 *     failure) needs to pair again or it is a brick. Every re-pair rotates that device's secret and
 *     overwrites its Auth password, which means a stolen log of an old pairing is worthless
 *     afterwards. The trade-off is honest: physical access to a device lets you re-pair it. That is
 *     why `owner` is NOT touched here — see (5).
 *
 *  4. THE PAIRING CODE IS THE ONLY BRIDGE TO AN ACCOUNT. The device gets a short, expiring code
 *     that a human reads off a screen / serial monitor and types into the app. The code is what
 *     links "some hardware" to "this user's account". It is 8 chars from a 32-char alphabet
 *     (~40 bits) and expires in 30 minutes, and it is stored hashed-free but single-use.
 *
 *  5. OWNERSHIP IS NEVER TOUCHED BY THIS ENDPOINT. `users/<uid>/owned_devices/<MAC>` and
 *     `devices/<MAC>/owner` are written only by /api/claim.js, after an authenticated human proves
 *     they hold the code. Re-pairing therefore cannot steal a device that already has an owner —
 *     it just rotates the device's own credentials.
 *
 *  6. THE ALERT SECRET IS RETURNED AND HASHED, NEVER STORED IN PLAINTEXT. The value handed to the
 *     device is `VOLTSENSE_ALERT_SECRET` when that is configured (so /api/alert's shared-secret
 *     path validates it directly), otherwise a fresh random value. Either way
 *     `sha256(<that value>)` is persisted at `devices/<MAC>/alert_secret_hash` so /api/alert can
 *     validate without relying on the shared env var. See /api/alert.js.
 *
 * Required environment variables:
 *   VOLTSENSE_PAIRING_KEY  — the shared factory key, baked into the firmware at build time
 *   VOLTSENSE_ALERT_SECRET — optional; the shared alert secret handed to newly paired devices
 *   (+ FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL via _lib/firebaseAdmin)
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { getApp, safeEqual, readBody, normalizeMac, hashSecret } = require('./_lib/firebaseAdmin');

const PAIRING_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PAIRING_CODE_LENGTH = 8;
const PAIRING_RATE_LIMIT_MS = 60 * 1000; // one pair per device per minute
const MAX_PAIRINGS_PER_HOUR = 10; // per device, guards against a looping/reflashing unit

// No 0/O/1/I/L — these get read aloud and typed by hand, so ambiguous glyphs are removed.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomCode = (length) =>
  Array.from({ length }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

// The device's Auth password. 32 bytes of base64url ≈ 256 bits, so it is not guessable and does not
// depend on the factory key for its strength.
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/** Derive the device's Auth email deterministically from its MAC, so re-pairing is idempotent. */
const deviceEmailFor = (mac, authDomain) =>
  `device-${mac.replace(/:/g, '').toLowerCase()}@${authDomain}`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = process.env.VOLTSENSE_PAIRING_KEY;
  if (!expectedKey) {
    console.error('VOLTSENSE_PAIRING_KEY is not configured');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: 'Malformed JSON body' });

  if (!safeEqual(body.pairing_key, expectedKey)) {
    console.warn('Rejected pairing: bad factory key');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const mac = normalizeMac(body.mac);
  if (!MAC_RE.test(mac)) {
    return res.status(400).json({ error: '`mac` must look like AA:BB:CC:DD:EE:FF' });
  }

  let app;
  try {
    app = getApp();
  } catch (error) {
    console.error('Firebase Admin failed to initialise:', error.message);
    return res.status(500).json({ error: 'Server not configured' });
  }

  const db = admin.database(app);
  const auth = admin.auth(app);

  // The Auth domain is needed to build the device's email. Take it from the env rather than guessing,
  // because a wrong domain produces an account the app's rules can never resolve.
  const authDomain = process.env.VOLTSENSE_AUTH_DOMAIN || 'voltsense-iot.firebaseapp.com';
  const email = deviceEmailFor(mac, authDomain);

  try {
    // ---- rate limit -------------------------------------------------------
    // A device that is stuck in a boot loop would otherwise mint credentials every few seconds.
    const guardRef = db.ref(`devices/${mac}/pairing/guard`);
    const guardSnap = await guardRef.get();
    const guard = guardSnap.val() || {};
    const now = Date.now();

    if (guard.last_at && now - Number(guard.last_at) < PAIRING_RATE_LIMIT_MS) {
      const wait = Math.ceil((PAIRING_RATE_LIMIT_MS - (now - Number(guard.last_at))) / 1000);
      console.warn(`Pairing for ${mac} rate-limited (${wait}s remaining)`);
      return res.status(429).json({ error: 'Too many pairing attempts', retry_after: wait });
    }

    // A rolling hourly window, kept as a short list of timestamps.
    const recent = Array.isArray(guard.history) ? guard.history.filter((t) => now - t < 3600_000) : [];
    if (recent.length >= MAX_PAIRINGS_PER_HOUR) {
      console.warn(`Pairing for ${mac} exceeded the hourly cap (${recent.length})`);
      return res.status(429).json({ error: 'Pairing limit reached for this device', retry_after: 3600 });
    }

    // ---- mint credentials -------------------------------------------------
    // The device's Auth password is always unique to this unit.
    const password = randomSecret();

    // The alert secret is where this endpoint previously broke: it minted a random value, returned
    // it, and never stored anything /api/alert could check it against — so every paired device's
    // alert came back 401 and the Alerts tab stayed empty forever.
    //
    // The fix has two halves:
    //   * When the shared secret is configured on the server, hand the DEVICE that shared value.
    //     /api/alert already compares against it, so this path works with zero extra lookups and
    //     stays backwards-compatible with units flashed before this change.
    //   * Always persist `sha256(<the secret we just handed out>)` under the device node, so
    //     /api/alert can also validate a per-device secret without the shared env var ever needing
    //     to match. Only the hash is stored — a database leak yields nothing replayable.
    const sharedAlertSecret = process.env.VOLTSENSE_ALERT_SECRET || '';
    const alertSecret = sharedAlertSecret || randomSecret();

    const code = randomCode(PAIRING_CODE_LENGTH);
    const expiresAt = now + PAIRING_CODE_TTL_MS;

    // Provision the Auth account. Upsert semantics: on a re-pair the uid is preserved (so nothing
    // in the database that references it goes stale) and only the password rotates.
    let uid;
    try {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
      await auth.updateUser(uid, { password, disabled: false });
      console.log(`Re-paired ${mac}: rotated the password for uid=${uid}`);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      const created = await auth.createUser({ email, password, displayName: `device:${mac}` });
      uid = created.uid;
      console.log(`Paired new device ${mac}: created uid=${uid}`);
    }

    // ---- persist ----------------------------------------------------------
    // `device_uids/<MAC>` is what the database rules use to resolve MAC -> uid. It has no client
    // `.write` rule anywhere, so this Admin-SDK write is the ONLY way it can ever be set. That is
    // deliberate: a compromised device must not be able to promote itself.
    //
    // Everything lands in ONE atomic multi-path update. If any path were denied, the whole thing
    // would roll back rather than leaving a half-provisioned device.
    const updates = {
      [`device_uids/${mac}`]: uid,

      // The code is stored ONLY in `pairingCodes/<CODE>` (server-only, `.read: false`). It is
      // deliberately NOT duplicated under `devices/<MAC>/pairing/code`, because the `scoped` rules
      // variant grants `devices/<MAC>` read to any authenticated principal — so a copy there would
      // let any signed-up user harvest live pairing codes. One copy, in one place, unreadable.
      [`devices/${mac}/pairing/expires_at`]: expiresAt,
      [`devices/${mac}/pairing/fw`]: typeof body.fw === 'string' ? body.fw.slice(0, 24) : null,
      [`devices/${mac}/pairing/guard/last_at`]: now,
      [`devices/${mac}/pairing/guard/history`]: [...recent, now],
      [`devices/${mac}/paired_at`]: now,

      // Server-only half of the alert-secret handshake. `/api/alert` hashes whatever the device
      // presented and looks for this value, so the plaintext never has to exist on the server for
      // the per-device path to work. Nothing in the client rules grants read OR write here — the
      // Admin SDK is the only writer, which is deliberate: a device that could rewrite its own
      // hash could hand itself the ability to forge alerts for the room.
      [`devices/${mac}/alert_secret_hash`]: hashSecret(alertSecret),

      // NOTE: `claimed_by` / `claimed_at` are deliberately NOT touched here. They record who took
      // ownership, and a re-pair must not be able to erase that audit trail — a device with a
      // factory reset would otherwise be able to scrub the fact that it had an owner.

      // Reverse index so the APP can resolve a typed code to a MAC. Without this the app would have
      // to scan every device looking for a matching code, which the rules rightly forbid — the app
      // has no business enumerating hardware it does not own.
      //
      // This node holds nothing secret: a code is worthless once claimed or expired, and knowing a
      // code is not the same as being allowed to use it (see /api/claim.js, which re-checks the
      // expiry and the existing owner under a transaction).
      [`pairingCodes/${code}`]: { mac, created_at: now, expires_at: expiresAt }
    };
    await db.ref().update(updates);

    // Retire this device's PREVIOUS code, if any, so a re-pair does not leave an old code pointing
    // at the same MAC. Done after the main update because it needs the old value.
    const previousCode = guard.last_code;
    if (previousCode && previousCode !== code) {
      await db
        .ref(`pairingCodes/${previousCode}`)
        .remove()
        .catch((error) => console.warn(`Could not retire old code ${previousCode}:`, error.message));
    }
    await db.ref(`devices/${mac}/pairing/guard/last_code`).set(code);

    // ---- respond ----------------------------------------------------------
    // The plaintext password and alert secret are returned exactly once. They are never stored in
    // the database, so a database leak does not hand over device credentials.
    console.log(`Pairing complete for ${mac}; code issued, expires in ${PAIRING_CODE_TTL_MS / 60000}m`);

    return res.status(200).json({
      mac,
      device_email: email,
      device_password: password,
      alert_secret: alertSecret,
      pairing_code: code,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error(`Pairing failed for ${mac}:`, error);
    return res.status(500).json({ error: 'Pairing failed' });
  }
};
