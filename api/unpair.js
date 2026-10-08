/**
 * POST /api/unpair — detach a device from the signed-in user's account.
 *
 * WHY THIS EXISTS
 * Ownership is recorded in THREE places, and all are load-bearing:
 *
 *   users/<uid>/owned_devices/<MAC>   — what the app enumerates to build the device list
 *   devices/<MAC>/owner               — what the database rules use to authorise this device
 *   devices/<MAC>/owners/<uid>        — the alert recipient index /api/alert fans out from
 *
 * The app used to clear only the FIRST one, from the browser. The other two were left behind, which
 * made the device permanently unclaimable: /api/claim.js runs its ownership transaction against
 * `devices/<MAC>/owner`, sees a foreign uid still sitting there, and aborts with "already linked to
 * another account". The user did the reasonable thing — removed the device from their list — and
 * bricked it for everyone, including themselves. Re-pairing could not fix it either, because
 * /api/pair deliberately never touches ownership.
 *
 * Clearing all three has to happen server-side, atomically, and only after proving the caller is
 * the current owner:
 *
 *  * `devices/<MAC>/owner` is not writable by the client in any rules variant. Only the Admin SDK
 *    (this endpoint) can clear it.
 *  * A client-side delete cannot be verified. If it could be, anyone could unpair someone else's
 *    device by guessing a MAC.
 *
 * WHAT THE APP SENDS
 *   Authorization: Bearer <Firebase ID token>   (the signed-in user)
 *   { mac: "AA:BB:CC:DD:EE:FF" }
 *
 * WHAT IT GETS BACK
 *   { ok: true, mac: "AA:BB:CC:DD:EE:FF", was_owner: true }
 *
 * SECURITY MODEL
 *
 *  1. THE CALLER MUST BE A REAL SIGNED-IN USER, and the uid comes from the VERIFIED token — never
 *     from the request body.
 *
 *  2. ONLY THE CURRENT OWNER MAY UNPAIR. The check runs inside a transaction against
 *     `devices/<MAC>/owner`, so a caller who is not the owner gets 403 and nothing is written.
 *     This is why the endpoint takes a MAC rather than trusting "remove this from my list".
 *
 *  3. IT IS IDEMPOTENT. Unpairing an already-unpaired device returns ok — the second tap of a
 *     flaky button must not produce an error the user has to reason about.
 *
 *  4. THE DEVICE'S OWN CREDENTIALS AND ALERT-SECRET HASH ARE LEFT ALONE. Unpairing means "this
 *     account no longer owns it", not "factory reset". The hardware keeps working, keeps its
 *     pairing, and can be claimed by the same account or a different one without reflashing. In
 *     particular `alert_secret_hash` must survive, or the device would silently stop being able to
 *     file alerts after a re-claim that never re-paired it.
 *
 *  5. THE PAIRING AUDIT TRAIL IS CLEARED HERE, DELIBERATELY. Unlike /api/pair, this endpoint DOES
 *     remove `claimed_by` / `claimed_at`. A device that has been released should look factory-fresh
 *     so the next claim is a genuine first claim — otherwise the app would show a stale "added on
 *     ..." date from a previous owner.
 *
 * Required environment variables: FIREBASE_SERVICE_ACCOUNT, FIREBASE_DATABASE_URL.
 */

const admin = require('firebase-admin');
const { getApp, readBody, normalizeMac } = require('./_lib/firebaseAdmin');

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/**
 * Pull the bearer token out of the Authorization header. Same convention as /api/claim — this is a
 * browser-called endpoint, so headers are free and the token stays out of request logs.
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

  // ---- verify the caller -------------------------------------------------
  let uid;
  try {
    const decoded = await auth.verifyIdToken(token, /* checkRevoked */ true);
    uid = decoded.uid;
  } catch (error) {
    console.warn('Unpair rejected: token verification failed —', error.code || error.message);
    return res.status(401).json({ error: 'Invalid session' });
  }

  try {
    // ---- claim `devices/<MAC>/owner` for the duration of this call ---------
    // The transaction both AUTHORISES and WRITES. Reading the owner first and then writing would
    // leave a window where a concurrent transfer could hand the device to someone else while this
    // call is still clearing the old owner's reverse index.
    //
    // Return values:
    //   uid       -> we are the owner; the transaction commits with the same value (no change)
    //   null      -> already unowned: idempotent success
    //   undefined -> owned by somebody else: abort, and we return 403
    const ownerRef = db.ref(`devices/${mac}/owner`);
    let refreshedSoon = false;

    const result = await ownerRef.transaction((current) => {
      if (current === null || current === undefined) return null;
      if (current === uid) {
        // Second call for an already-unpaired device. Return the current value so the transaction
        // commits as a no-op rather than aborting — an abort would be indistinguishable from a
        // genuine conflict and would surface to the user as an error.
        refreshedSoon = true;
        return current;
      }
      return undefined; // abort: owned by someone else
    });

    if (!result.committed) {
      console.warn(`Unpair rejected for uid=${uid}: ${mac} is owned by another account`);
      return res.status(403).json({ error: 'This device belongs to another account' });
    }

    const previousOwner = result.snapshot.val();

    // ---- clear all three edges, atomically --------------------------------
    // One multi-path update: either the reverse index, the device-side owner AND the alert
    // recipient index all go, or none do. A partial write here is exactly the bug this endpoint
    // was written to fix — and leaving `owners/<uid>` behind would keep pushing that account's
    // alerts for a device it no longer owns, which is worse than a stale list entry because it is
    // invisible to the user.
    const updates = {
      [`users/${uid}/owned_devices/${mac}`]: null,
      [`devices/${mac}/owner`]: null,
      [`devices/${mac}/owners/${uid}`]: null,

      // Reset the claim audit trail so the next claim is a true first claim. `paired_at` and the
      // alert-secret hash are intentionally NOT touched — the device is still paired to the
      // service, it just has no owner.
      [`devices/${mac}/pairing/claimed_by`]: null,
      [`devices/${mac}/pairing/claimed_at`]: null
    };
    await db.ref().update(updates);

    console.log(`Unpair OK: uid=${uid} released ${mac} (previous owner in db: ${previousOwner || 'none'})`);
    return res.status(200).json({ ok: true, mac, was_owner: previousOwner === uid || refreshedSoon });
  } catch (error) {
    console.error('Unpair failed:', error);
    return res.status(500).json({ error: 'Unpair failed' });
  }
};
