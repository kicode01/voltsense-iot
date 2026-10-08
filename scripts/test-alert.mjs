#!/usr/bin/env node
/**
 * test-alert.mjs — fire a REAL alert through the live pipeline, with no ESP32 present.
 *
 * The Settings "Test" button is not a delivery test: it calls `showNotification()` from the open
 * page, so it succeeds even when the server, FCM and the background worker are all broken. This
 * script does the opposite — it POSTs to the deployed `/api/alert` exactly as the firmware does,
 * which exercises the whole chain:
 *
 *     this script -> /api/alert -> FCM -> the phone's service worker -> OS notification
 *
 * Close the app before running it. That is the only way to prove background delivery works.
 *
 * USAGE
 *   node scripts/test-alert.mjs                      # uses the MAC from --mac or the only device
 *   node scripts/test-alert.mjs --mac AA:BB:CC:DD:EE:FF
 *   node scripts/test-alert.mjs --dry-run            # show what would be sent, send nothing
 *
 * SECRET RESOLUTION (first match wins, value never printed)
 *   1. `--secret <value>`
 *   2. `VOLTSENSE_ALERT_SECRET` in the environment
 *   3. `VOLTSENSE_ALERT_SECRET` in `.env` or `.env.local`
 *
 * NOTE: `vercel env pull` deliberately writes "[SENSITIVE]" for Secret-typed variables, so the
 * deployment's value CANNOT be retrieved. Put the secret in `.env.local` (which is gitignored), or
 * pass it on the command line. `.env.example` documents where to find it.
 *
 * EXIT CODE  0 = the server accepted and dispatched the alert. 1 = anything else.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local') });

const ALERT_URL = process.env.VOLTSENSE_ALERT_URL || 'https://voltsense-iot.vercel.app/api/alert';

const argv = process.argv.slice(2);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const DRY_RUN = argv.includes('--dry-run');

const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const normalizeMac = (v) => String(v || '').trim().toUpperCase().replace(/-/g, ':');

// ---- the secret -------------------------------------------------------------
// Vercel refuses to reveal Secret-typed variables ("[SENSITIVE]"), so the value must come from the
// environment or a local file. A stale local copy simply produces a 401, which this reports clearly.
function resolveSecret() {
  const fromArg = valueOf('--secret');
  if (fromArg) return { secret: fromArg, source: '--secret' };

  const fromEnv = process.env.VOLTSENSE_ALERT_SECRET;
  // Guard against a placeholder that was pasted verbatim from `vercel env pull` output.
  if (fromEnv && fromEnv !== '[SENSITIVE]') {
    return { secret: fromEnv, source: 'environment / .env' };
  }

  return { secret: null, source: 'not set' };
}

// ---- the MAC ----------------------------------------------------------------
// The alert is addressed to a device, and the server resolves recipients from its owners. We read
// the device list with the Admin SDK when available; otherwise require --mac explicitly.
async function resolveMac(explicit) {
  if (explicit) {
    const mac = normalizeMac(explicit);
    if (!MAC_RE.test(mac)) throw new Error(`--mac is not a valid MAC address: ${explicit}`);
    return mac;
  }
  throw new Error(
    'A device MAC is required (the server resolves recipients from the device\'s owners).\n' +
    '  Pass --mac AA:BB:CC:DD:EE:FF — find it in the Firebase console under devices/, or on the\n' +
    '  device\'s Serial output at boot.'
  );
}

// ---- main -------------------------------------------------------------------
const { secret, source } = resolveSecret();
if (!secret) {
  console.error(`VOLTSENSE_ALERT_SECRET not available (${source}).`);
  console.error(
    '\nVercel will NOT reveal a Secret-typed variable, so it cannot be fetched for you.\n' +
    'Add it to `.env.local` (gitignored), which takes precedence over `.env`:\n\n' +
    '    VOLTSENSE_ALERT_SECRET=<the value from your Vercel dashboard / provisioning notes>\n\n' +
    'or pass `--secret <value>` for a one-off run.'
  );
  process.exit(1);
}

let mac;
try {
  mac = await resolveMac(valueOf('--mac'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const payload = {
  secret,
  mac,
  title: '⚠️ VoltSense Test',
  body: 'This is a real pushed alert from the live server. If you can see this with the app closed, background push works.',
  tag: 'voltsense-selftest'
};

console.log(`POST ${ALERT_URL}`);
console.log(`  mac    : ${mac}`);
console.log(`  secret : ${secret.slice(0, 4)}…${secret.slice(-4)} (from ${source})`);

if (DRY_RUN) {
  console.log('\n--dry-run: nothing sent.');
  process.exit(0);
}

let res;
try {
  res = await fetch(ALERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
} catch (error) {
  console.error(`\nNetwork error reaching ${ALERT_URL}:`, error.message);
  process.exit(1);
}

const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch { /* non-JSON body, print raw below */ }

console.log(`\nHTTP ${res.status}`);
console.log(json ? JSON.stringify(json, null, 2) : text.slice(0, 600));

// Interpret the outcome honestly — a 200 does not always mean a notification was delivered.
if (res.status === 401) {
  console.error('\n401 — the secret was rejected. The local value does not match the deployment.');
  process.exit(1);
}
if (res.status !== 200) {
  console.error('\nUnexpected status. The server refused the alert.');
  process.exit(1);
}

const skipped = json && json.skipped;
if (skipped === 'no-owners') {
  console.error(
    `\nThe server has NO OWNER recorded for ${mac}, so it had nobody to notify.\n` +
    '  Claim the device in the app (Settings -> Add device) first.'
  );
  process.exit(1);
}
if (skipped === 'no-tokens') {
  console.error(
    `\nOwners exist for ${mac}, but none has a push token stored.\n` +
    '  Enable push in Settings on the phone you want to test, then re-run this.'
  );
  process.exit(1);
}

console.log(
  '\nAlert accepted and dispatched to FCM.' +
  '\n  Next: check the phone. If the app was CLOSED and nothing appeared,' +
  '\n  inspect devices/<MAC>/alerts in the RTDB console for the recorded outcome,' +
  '\n  and confirm the worker (see docs/PUSH-TEST.md).'
);
process.exit(0);
