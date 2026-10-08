/**
 * POST /api/claim — attach a paired device to the signed-in user's account.
 *
 * This is the ONLY place ownership is ADDED. `/api/pair` deliberately never touches it, so a
 * device that is factory-reset and re-paired cannot steal itself back from its owner. Removal is
 * the mirror image, in `/api/unpair.js` — both must write the same three edges.
 *
 * WHAT THE APP SENDS
 *   Authorization: Bearer <Firebase ID token>   (the signed-in user)
 *   { code: "K7M2PQX4" }
 *
 * WHAT IT GETS BACK
 *   { ok: true, mac: "AA:BB:CC:DD:EE:FF" }
 *
 * SECURITY MODEL
 *
 *  1. THE CALLER MUST BE A REAL SIGNED-IN USER. The ID token is verified with the Admin SDK, which
 *     checks the signature against Google's public keys and asserts the audience/project. A forged
 *     token cannot pass. The uid comes from the VERIFIED token, never from the request body — that
 *     is the whole point, and trusting a body-supplied uid is the classic way this gets broken.
 *
 *  2. A CODE PROVES PHYSICAL PROXIMITY, NOT AUTHORITY. Holding a code means you could see the
 *     device (its screen or serial log). That is the standard trade for consumer hardware, and it is
 *     why the code is short-lived and single-use.
 *
 *  3. A DEVICE WITH AN EXISTING OWNER CANNOT BE CLAIMED. This is checked inside a transaction, so
 *     two people racing to claim the same freshly-paired device cannot both win. Re-claiming by the
 *     SAME owner is allowed (idempotent, so a reinstall or a second phone works).
 *
 *  4. FAILURES ARE DELIBERATELY VAGUE TO THE CALLER. A wrong code and an expired code return the
 *     same shape, so the endpoint cannot be used to probe which codes exist. The detail goes to the
 *     server log.
 *
 * Required environment variables: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL.
 */

const admin = require('firebase-admin');
const { getApp, readBody } = require('./_lib/firebaseAdmin');

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/**
 * Pull the bearer token out of the Authorization header.
 *
 * Unlike /api/pair (called by an ESP32 that cannot cheaply set headers), this endpoint is called by
 * the browser, where headers are free — so the token goes in the header, not the body. That keeps
 * it out of request logs and error reports.
 */
const bearerToken = (req) => {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: 'Malformed JSON body' });

  // Tolerate the display format. The app groups the code as "XXXX-XXXX" for legibility, and a user
  // may also paste it with spaces, so strip separators before validating rather than rejecting a
  // code the user can plainly see on the device.
  const code = typeof body.code === 'string'
    ? body.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    : '';
  if (!CODE_RE.test(code)) {
    // Same shape as an unknown code — do not reveal that the FORMAT was the problem.
    return res.status(400).json({ error: 'Invalid or expired code' });
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

  // ---- verify the caller -------------------------------------------------
  let uid;
  try {
    const decoded = await auth.verifyIdToken(token, /* checkRevoked */ true);
    uid = decoded.uid;
  } catch (error) {
    console.warn('Claim rejected: token verification failed —', error.code || error.message);
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    // ---- resolve the code ------------------------------------------------
    const codeSnap = await db.ref(`pairingCodes/${code}`).get();
    const entry = codeSnap.val();
    const now = Date.now();

    if (!entry || !entry.mac) {
      console.warn(`Claim rejected for uid=${uid}: unknown code`);
      return res.status(404).json({ error: 'Invalid or expired code' });
    }
    if (!entry.expires_at || now > Number(entry.expires_at)) {
      // Clean up on read — an expired code is dead, and leaving it invites confusion later.
      await db.ref(`pairingCodes/${code}`).remove().catch(() => {});
      console.warn(`Claim rejected for uid=${uid}: expired code`);
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    const mac = String(entry.mac).toUpperCase();

    // ---- claim, atomically ------------------------------------------------
    // The transaction reads the current owner and writes both directions only if it is free (or
    // already ours). Without this, two phones submitting the same code simultaneously could both
    // see "unowned" and both write, leaving two owners and an ambiguous `owner` field.
    const ownerRef = db.ref(`devices/${mac}/owner`);
    const result = await ownerRef.transaction((current) => {
      if (current === null || current === undefined) return uid;
      if (current === uid) return uid; // already ours — idempotent, no change
      return undefined; // abort: someone else owns it
    });

    if (!result.committed) {
      console.warn(`Claim rejected for uid=${uid}: ${mac} already owned by another account`);
      return res.status(409).json({ error: 'This device is already linked to another account' });
    }

    const isFirstClaim = !result.snapshot.val();

    // Ownership is recorded in THREE places, in one atomic update:
    //   users/<uid>/owned_devices/<MAC>  — what the app enumerates to build the device list
    //   devices/<MAC>/owner              — what the rules use to authorise this specific device
    //   devices/<MAC>/owners/<uid>       — the alert recipient index (see below)
    // If any one were missing, either the app could not see the device, the rules could not
    // authorise it, or alerts would not reach anyone. A partial write would be a support call.
    //
    // WHY `owners` EXISTS AS WELL AS `owner`: /api/alert needs the set of accounts to notify, and
    // it used to work that out by downloading the ENTIRE `users` node and scanning it — on every
    // alert, forever, growing linearly with signups. That is the hot path of the whole product, so
    // the recipient list is denormalised onto the device instead. `owner` (singular) remains the
    // authority for authorisation; `owners` (plural) is the fan-out index and they must agree.
    //
    // `claimed_by` and `claimed_at` move together: they describe ONE event (who first attached this
    // device, and when). Writing `claimed_by` unconditionally while only stamping `claimed_at` on
    // the first claim produced a row that could read "claimed by B, first claimed by A in March" —
    // an audit record that contradicts itself. A re-claim by the same user is a no-op for both.
    const updates = {
      [`users/${uid}/owned_devices/${mac}`]: true,
      [`devices/${mac}/owners/${uid}`]: true
    };
    if (isFirstClaim) {
      updates[`devices/${mac}/pairing/claimed_by`] = uid;
      updates[`devices/${mac}/pairing/claimed_at`] = now;
    }

    await db.ref().update(updates);

    // The code is single-use: consume it so a leaked screenshot of the device screen is useless
    // after the first successful claim. Only the server-side index needs clearing — the code is
    // never stored under `devices/<MAC>`, so there is nothing to remove there.
    await db.ref(`pairingCodes/${code}`).remove().catch(() => {});

    console.log(`Claim OK: uid=${uid} -> ${mac}`);
    return res.status(200).json({ ok: true, mac });
  } catch (error) {
    console.error('Claim failed:', error);
    return res.status(500).json({ error: 'Claim failed' });
  }
};
