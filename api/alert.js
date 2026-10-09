/**
 * POST /api/alert — VoltSense notification sender.
 *
 * The ESP32 calls this instead of talking to a messaging provider directly, which keeps every
 * credential on the server: the device only needs one shared secret.
 *
 * Flow:
 *   1. Verify the device's secret — either the shared `VOLTSENSE_ALERT_SECRET` (constant-time
 *      compare) or the per-device hash at `devices/<MAC>/alert_secret_hash` written by /api/pair.
 *   2. Work out which auth users belong to the room the alert came from.
 *   3. Resolve their FCM tokens from /pushTokens/<uid> in Realtime Database.
 *   4. Send one multicast message and prune tokens FCM reports as dead.
 *
 * Request body:
 *   { mac: "AA:BB:CC:DD:EE:FF", title?: string, body: string, tag?: string, url?: string,
 *     secret: "<alert secret>" }
 *
 * Responses:
 *   200 { sent: n, pruned: n, total: n, recorded: bool, skipped?: reason }
 *   400 malformed body
 *   401 bad or missing secret
 *   405 wrong method
 *   500 server misconfiguration or a database/FCM failure
 *
 * Every call also appends an entry to /devices/<MAC>/alerts so the app can show an in-app history.
 * Push is best-effort (a phone can be offline, permission can be denied, iOS only delivers Web Push
 * to a home-screen PWA) — the history is the durable record that says an alert happened even when
 * no notification reached anyone. Entries therefore carry the delivery outcome rather than a
 * blanket "delivered" flag.
 *
 * Required environment variables (set in the Vercel dashboard, never in the repo):
 *   FIREBASE_SERVICE_ACCOUNT — the service-account JSON, as a single-line string
 *   FIREBASE_DATABASE_URL   — e.g. https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app
 *   VOLTSENSE_ALERT_SECRET  — OPTIONAL. When set it is the shared secret /api/pair hands to new
 *                             devices and the value a USB-provisioned unit carries in NVS. When it
 *                             is absent, only the per-device hash path is used and devices must have
 *                             been paired through /api/pair to have a hash on file.
 */

const admin = require('firebase-admin');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { getApp, safeEqual, safeJsonParse, normalizeMac, hashSecret, timingSafeEqual } = require('./_lib/firebaseAdmin');

const MAX_BODY_LENGTH = 400;
const MAX_TITLE_LENGTH = 80;

// Keep the newest N entries per device. Unbounded growth is the failure mode that kills a history
// feature months later, so retention is enforced from the first write. Pruning happens on the same
// pass that adds the new entry, so the node rests at exactly MAX_ALERT_HISTORY and an oversized
// node converges back to it on the next alert rather than shedding one row at a time.
const MAX_ALERT_HISTORY = 200;

/**
 * Find the auth uids that should receive alerts for a given device MAC.
 *
 * Three sources, cheapest first, unioned. Missing a recipient is worse than sending one extra
 * notification, so this is deliberately additive rather than "pick one":
 *
 *   1. `devices/<MAC>/owners` — the denormalised index written by /api/claim and cleared by
 *      /api/unpair. One small read, and the only source a current device needs.
 *   2. `devices/<MAC>/owner` — the single authoritative uid. Checked because the index could be
 *      missing on a device claimed before it existed, and because the two disagreeing would
 *      otherwise silently drop the real owner.
 *   3. `users/*\/owned_devices` — the original scan. Now a FALLBACK that is only reached when
 *      neither device-side source produced anyone, so the common path never downloads the user
 *      table. This used to run on every alert, which is the hot path of the whole product.
 *
 * The result is deduplicated, so a uid present in all three contributes one notification.
 */
const resolveRecipients = async (db, mac) => {
  const uidSet = new Set();
  const wanted = mac.toUpperCase();

  // 1 + 2 — the device-side sources, both in one round trip.
  const deviceSnap = await db.ref(`devices/${wanted}`).get();
  const device = deviceSnap.val() || {};

  if (device.owners && typeof device.owners === 'object') {
    Object.keys(device.owners).forEach((uid) => uidSet.add(uid));
  }
  if (typeof device.owner === 'string' && device.owner) {
    uidSet.add(device.owner);
  }

  if (uidSet.size > 0) return [...uidSet];

  // 3 — legacy fallback, only when the device-side nodes are empty.
  const usersSnapshot = await db.ref('users').get();
  const users = usersSnapshot.val() || {};

  Object.entries(users).forEach(([uid, value]) => {
    const owned = value && value.owned_devices;
    if (!owned) return;
    if (Object.keys(owned).some((key) => key.toUpperCase() === wanted)) uidSet.add(uid);
  });

  return [...uidSet];
};

/**
 * Append one alert to /devices/<MAC>/alerts and trim the log to MAX_ALERT_HISTORY entries.
 *
 * Retention is bounded on every write so the node cannot grow without limit — this is simply a
 * normal database node, not flash, so pruning costs a few deletes rather than a sector erase.
 *
 * Never throws: the caller reports delivery to the device, and a logging hiccup must not turn a
 * successfully-sent alert into a 500 (the device would then retry something that already worked).
 */
const recordAlert = async (db, mac, entry) => {
  try {
    const listRef = db.ref(`devices/${mac}/alerts`);
    const pushRef = listRef.push();
    await pushRef.set(entry);

    // Push ids sort chronologically, so the oldest entries are simply the first keys and the entry
    // we just wrote sorts last. Reading MAX+1 is enough to DETECT overflow without downloading the
    // whole node on every alert — and because the new entry is never among the oldest MAX+1, a
    // single-entry prune can never truncate it.
    const snapshot = await listRef.orderByKey().limitToFirst(MAX_ALERT_HISTORY + 1).get();
    const keys = Object.keys(snapshot.val() || {});
    if (keys.length <= MAX_ALERT_HISTORY) return true;

    // Overflow. In steady state this is exactly one entry over, but the tight limit above caps the
    // delete batch at one too — so a node that predates retention, or that absorbed a burst, would
    // shed a single row per alert and stay bloated almost indefinitely (a 1000-row node stays
    // ~1000 forever). Detect cheaply, then clear the whole excess in one pass. The unbounded read
    // only runs while the node is genuinely over budget, so steady-state writes still cost one
    // 201-row fetch.
    const fullSnapshot = await listRef.orderByKey().get();
    const allKeys = Object.keys(fullSnapshot.val() || {});
    const doomed = allKeys.slice(0, allKeys.length - MAX_ALERT_HISTORY);
    if (doomed.length === 0) return true;

    const updates = {};
    doomed.forEach((key) => {
      updates[`devices/${mac}/alerts/${key}`] = null;
    });
    await db.ref().update(updates);
    return true;
  } catch (error) {
    console.warn(`Could not record alert for ${mac}:`, error.message);
    return false;
  }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Arduino boards cannot set custom headers cheaply, so the secret rides in the body. Over HTTPS
  // that is fine; it is not a substitute for TLS.
  const body = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  const sharedSecret = process.env.VOLTSENSE_ALERT_SECRET;
  const presented = typeof body.secret === 'string' ? body.secret : '';
  if (!presented) {
    console.warn('Rejected alert: no secret presented');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const mac = normalizeMac(body.mac);

  let app;
  try {
    app = getApp();
  } catch (error) {
    console.error('Firebase Admin failed to initialise:', error.message);
    return res.status(500).json({ error: 'Server not configured' });
  }

  const db = getDatabase(app);
  const messaging = admin.messaging(app);

  // ---- authenticate the device -------------------------------------------
  // Two accepted proofs, checked in this order so the common case (a device paired in this
  // deployment) needs no extra read:
  //
  //   1. The shared `VOLTSENSE_ALERT_SECRET`, constant-time compared. This is what /api/pair hands
  //      out when the env var is set, and what a USB-provisioned unit has in NVS.
  //   2. The per-device hash at `devices/<MAC>/alert_secret_hash`, written by /api/pair. The
  //      presented secret is hashed and compared against the stored hash, so a server that never
  //      had the shared secret configured still authenticates its own devices.
  //
  // A device presenting neither is rejected. Note that a MAC is NOT a credential — an attacker who
  // guesses a MAC (trivial: it is on the device) still has to produce the secret.
  let authenticated = sharedSecret ? safeEqual(presented, sharedSecret) : false;

  if (!authenticated && mac) {
    try {
      const hashSnap = await db.ref(`devices/${mac}/alert_secret_hash`).get();
      const storedHash = hashSnap.val();
      if (typeof storedHash === 'string' && storedHash) {
        authenticated = timingSafeEqual(hashSecret(presented), storedHash);
      }
    } catch (error) {
      console.warn(`Could not look up alert secret hash for ${mac}:`, error.message);
    }
  }

  if (!authenticated) {
    console.warn('Rejected alert: bad secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!mac || !text) {
    return res.status(400).json({ error: '`mac` and `body` are required' });
  }

  // Truncate once, up front, so the notification payload and the stored history entry are always
  // the same string. If they diverged the tab would show something the notification never said.
  const title = (typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : 'VoltSense Alert'
  ).slice(0, MAX_TITLE_LENGTH);
  const message = text.slice(0, MAX_BODY_LENGTH);
  const tag = typeof body.tag === 'string' && body.tag ? body.tag : 'voltsense-alert';

  // History is keyed by the alert's own identity, not the tag. `tag` is shared across every
  // occurrence of the same alert type (it is what collapses duplicates in the OS tray), so using
  // it as a history key would make each new alert overwrite the previous one.
  //
  // NOTE: this deliberately carries NO `outcome`. Every stored entry is written by a `recordAlert`
  // call that supplies the real value, so an unresolved outcome cannot be persisted. It used to
  // default to `'pending'`, which the client's OUTCOME map has no key for — a row that reached the
  // UI in that state rendered as the grey "Recorded" badge, i.e. a delivery that never happened
  // would have been presented as a success. Since every path below sets an outcome, that state was
  // unreachable, but a placeholder that means "not yet decided" in a field the reader treats as
  // "what happened" is a trap for the next edit. Absence is the honest representation of "not
  // decided yet", and it fails loudly (an undefined badge) rather than quietly (a green one).
  const entry = {
    title,
    body: message,
    tag,
    at: Date.now()
  };

  try {
    const uids = await resolveRecipients(db, mac);
    if (uids.length === 0) {
      console.log(`Alert for ${mac}: no owners found`);
      const recorded = await recordAlert(db, mac, { ...entry, outcome: 'skipped', reason: 'no-owners' });
      return res.status(200).json({ sent: 0, pruned: 0, total: 0, recorded, skipped: 'no-owners' });
    }

    const tokenEntries = await Promise.all(
      uids.map(async (uid) => {
        const snapshot = await db.ref(`pushTokens/${uid}`).get();
        const value = snapshot.val();
        if (value && typeof value.token === 'string' && value.token) {
          return { uid, token: value.token };
        }
        return null;
      })
    );

    const recipients = tokenEntries.filter(Boolean);
    if (recipients.length === 0) {
      console.log(`Alert for ${mac}: ${uids.length} owner(s), none with a push token`);
      const recorded = await recordAlert(db, mac, { ...entry, outcome: 'skipped', reason: 'no-tokens' });
      return res.status(200).json({ sent: 0, pruned: 0, total: 0, recorded, skipped: 'no-tokens' });
    }

    const response = await messaging.sendEachForMulticast({
      tokens: recipients.map((r) => r.token),
      data: {
        title,
        body: message,
        tag,
        url: body.url || '/alerts'
      },
      // Keep this DATA-ONLY. If webpush.notification is also present, the Firebase worker
      // automatically displays it AND our onBackgroundMessage handler displays a second copy.
      // The handler owns the title, body, icon, badge and click target in one place.
      webpush: { headers: { Urgency: 'high' } }
    });

    // A token that is permanently invalid means the user uninstalled or cleared site data.
    // Leaving it in the database makes every future alert pay for it, so drop it now.
    const deadTokens = [];
    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error && result.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        deadTokens.push(recipients[index]);
      } else {
        console.warn(`Send failed for uid=${recipients[index].uid}:`, code);
      }
    });

    await Promise.all(
      deadTokens.map(({ uid, token }) =>
        db
          .ref(`pushTokens/${uid}`)
          // Only clear the node if the token has not been replaced since we read it.
          .transaction((current) => (current && current.token === token ? null : current))
          .catch((error) => console.warn(`Could not prune token for uid=${uid}:`, error.message))
      )
    );

    console.log(
      `Alert for ${mac}: sent=${response.successCount} failed=${response.failureCount} pruned=${deadTokens.length}`
    );

    // `outcome` must reflect what actually happened, never what we hoped happened. If every send
    // failed transiently (FCM outage, network) the history must say so, otherwise the tab would
    // claim a notification arrived when nothing reached the phone.
    const outcome =
      response.successCount > 0
        ? response.failureCount > 0 ? 'partial' : 'sent'
        : 'failed';

    const recorded = await recordAlert(db, mac, {
      ...entry,
      outcome,
      sent: response.successCount,
      failed: response.failureCount,
      total: recipients.length
    });

    return res.status(200).json({
      sent: response.successCount,
      pruned: deadTokens.length,
      total: recipients.length,
      recorded
    });
  } catch (error) {
    console.error('Alert delivery failed:', error);
    return res.status(500).json({ error: 'Delivery failed' });
  }
};
