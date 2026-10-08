#!/usr/bin/env node
/**
 * diagnose.mjs — end-to-end connection check for VoltSense.
 *
 * Answers: "is the software connected to the database, and will the hardware be able to talk
 * to it?" WITHOUT needing the ESP32, by replaying the exact reads and writes that the web app
 * and the firmware perform, using the Firebase REST API directly.
 *
 * USAGE
 *   npm run diagnose                       # checks the public/unauth + rules posture only
 *   npm run diagnose -- <email> <password> # signs in as a user and tests app reads/writes
 *   npm run diagnose -- --device <email> <password>   # signs in as a DEVICE account, tests
 *                                                     # the firmware's telemetry write path
 *   npm run diagnose -- --mac AA:BB:CC:DD:EE:FF       # which device node to probe (optional)
 *
 * Exit code 0 = all checks that ran passed. 1 = at least one FAIL.
 *
 * READ-ONLY BY DEFAULT. Writes are sent to a scratch branch (devices/<MAC>/__diag) unless you
 * pass --write-probe, and are deleted afterwards. It never touches ports/relay_status.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const MAC = (valueOf('--mac') || '00:1A:2B:3C:4D:5E').toUpperCase();
const AS_DEVICE = flag('--device');
const WRITE_PROBE = flag('--write-probe');
const EMAIL = positional[0] || null;
const PASSWORD = positional[1] || null;

// ---- results ----------------------------------------------------------------
const results = [];
const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });
const info = (name, detail = '') => results.push({ pass: null, name, detail });

const apiKey = process.env.VITE_FIREBASE_API_KEY;
const dbUrl = (process.env.VITE_FIREBASE_DATABASE_URL || '').replace(/\/$/, '');

// ---- helpers ----------------------------------------------------------------
async function rest(method, urlPath, { token, body } = {}) {
  const url = `${dbUrl}${urlPath}${token ? `?auth=${encodeURIComponent(token)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  const text = await res.text();
  if (text) { try { json = JSON.parse(text); } catch { json = text; } }
  return { status: res.status, json };
}

async function signIn(email, password) {
  const res = await fetch(`${IDENTITY_TOOLKIT}/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return { idToken: json.idToken, uid: json.localId };
}

// ---- checks -----------------------------------------------------------------
async function checkConfig() {
  const required = [
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID'
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) bad('.env keys present', `missing: ${missing.join(', ')}`);
  else ok('.env keys present', `${required.length}/7 + VAPID`);

  if (!process.env.VITE_FIREBASE_VAPID_KEY) bad('VAPID key present (push)', 'VITE_FIREBASE_VAPID_KEY unset');
  else ok('VAPID key present (push)');

  try { return new URL(dbUrl).host; } catch { bad('Database URL parses', dbUrl); return null; }
}

async function checkRules() {
  // Unauthenticated probes: these MUST be denied on every ruleset we ship.
  const probes = ['/devices/.json?shallow=true', '/users/.json?shallow=true', '/device_uids/.json?shallow=true'];
  for (const p of probes) {
    const { status } = await rest('GET', p);
    if (status === 401) ok(`unauth read ${p.split('.json')[0]} denied`, 'HTTP 401');
    else if (status === 200) bad(`unauth read ${p.split('.json')[0]} denied`, 'HTTP 200 — DATABASE IS PUBLIC');
    else info(`unauth read ${p.split('.json')[0]}`, `HTTP ${status}`);
  }
}

async function checkUserSession(email, password) {
  let session;
  try {
    session = await signIn(email, password);
    ok('auth: sign-in succeeds', `uid=${session.uid.slice(0, 8)}…`);
  } catch (e) {
    bad('auth: sign-in succeeds', e.message);
    if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(e.message)) {
      info('hint', 'For a device account the user must exist in Console > Authentication > Users.');
    }
    return null;
  }

  // Client reads its own device list.
  const owned = await rest('GET', `/users/${session.uid}/owned_devices.json`, { token: session.idToken });
  if (owned.status === 200) {
    const list = owned.json && typeof owned.json === 'object' ? Object.keys(owned.json) : [];
    ok('read users/<uid>/owned_devices', list.length ? `${list.length} paired: ${list.join(', ')}` : 'empty (no devices paired yet)');
  } else bad('read users/<uid>/owned_devices', `HTTP ${owned.status} ${JSON.stringify(owned.json || '')}`);

  // Client reads the device node (needs .read: owner OR device uid).
  const dev = await rest('GET', `/devices/${MAC}.json?shallow=true`, { token: session.idToken });
  if (dev.status === 200) ok(`read devices/${MAC}`, 'allowed');
  else if (dev.status === 401) {
    bad(`read devices/${MAC}`, 'PERMISSION_DENIED — this account neither owns the device nor is its device-uid');
    info('hint', AS_DEVICE
      ? `Add device_uids/${MAC} = "${session.uid}" in Console > Realtime Database.`
      : `Pair this device in the app (Settings > Pair Device) as MAC ${MAC}.`);
  } else info(`read devices/${MAC}`, `HTTP ${dev.status}`);

  // Client reads history (the Analytics page).
  const hist = await rest('GET', `/devices/${MAC}/history/today.json?shallow=true`, { token: session.idToken });
  if (hist.status === 200) ok('read devices/<MAC>/history/today', 'allowed');
  else if (hist.status === 401) bad('read devices/<MAC>/history/today', 'PERMISSION_DENIED (inherits devices/.read)');
  else info('read devices/<MAC>/history/today', `HTTP ${hist.status}`);

  return session;
}

async function checkDeviceWritePath(session) {
  // This mirrors the firmware telemetry update: one multi-path write under devices/<MAC>.
  const path_ = `/devices/${MAC}/__diag.json`;
  const body = { at: Date.now(), note: 'diagnose.mjs probe' };

  if (!WRITE_PROBE) {
    info('device telemetry write', 'skipped — re-run with --write-probe to test an actual write');
    info('hint', 'The probe writes only to devices/<MAC>/__diag and deletes it immediately. It never touches relay_status.');
    return;
  }

  const w = await rest('PUT', path_, { token: session.idToken, body });
  if (w.status === 200) {
    ok('device telemetry write', 'allowed (rules accept the write)');
    const del = await rest('DELETE', path_, { token: session.idToken });
    if (del.status === 200) ok('cleanup scratch node', 'deleted devices/<MAC>/__diag');
    else bad('cleanup scratch node', `HTTP ${del.status} — delete devices/${MAC}/__diag manually`);
  } else if (w.status === 401) {
    bad('device telemetry write', 'PERMISSION_DENIED — the device CANNOT report telemetry on this ruleset');
    info('hint', `Needs devices/${MAC}/.write to allow the device: auth.uid === device_uids/${MAC}. Set that node in the Console.`);
  } else bad('device telemetry write', `HTTP ${w.status} ${JSON.stringify(w.json || '')}`);
}

async function checkDeviceUidsVisible(session) {
  // A device node must resolve MAC -> uid for the rules to work. We can only *read* it if rules allow.
  const r = await rest('GET', `/device_uids.json?shallow=true`, { token: session.idToken });
  if (r.status === 200) {
    const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json) : [];
    if (keys.length === 0) bad('device_uids allow-list populated', 'node exists but is EMPTY — device is locked out');
    else if (keys.includes(MAC)) ok('device_uids allow-list populated', `${MAC} present, ${keys.length} entr(ies)`);
    else bad('device_uids allow-list populated', `node has ${keys.length} entr(ies) but ${MAC} is MISSING — device is locked out`);
  } else if (r.status === 401) {
    info('device_uids allow-list', 'not readable by an authenticated client (expected: Console-only node)');
    info('hint', `Verify in Console > Realtime Database that device_uids/${MAC} exists and equals the device account's UID.`);
  } else info('device_uids allow-list', `HTTP ${r.status}`);
}

// ---- run --------------------------------------------------------------------
console.log('\n=== VoltSense connection diagnostic ===\n');

const host = await checkConfig();
if (host) console.log(`  project host : ${host}`);
console.log(`  probing MAC  : ${MAC}`);
console.log(`  mode         : ${AS_DEVICE ? 'device account' : EMAIL ? 'user account' : 'anonymous only'}\n`);

await checkRules();

if (EMAIL && PASSWORD) {
  const session = await checkUserSession(EMAIL, PASSWORD);
  if (session) {
    await checkDeviceUidsVisible(session);
    await checkDeviceWritePath(session);
  }
} else {
  info('authenticated checks', 'skipped — pass an email + password to test reads/writes');
  info('hint', 'npm run diagnose -- user@example.com theirpassword');
  info('hint', 'npm run diagnose -- --device device-aabbccddeeff@<domain> thepassword');
}

console.log('');
for (const r of results) {
  const tag = r.pass === true ? 'PASS' : r.pass === false ? 'FAIL' : 'INFO';
  const line = `  ${tag}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`;
  console.log(line);
}

const failed = results.filter((r) => r.pass === false).length;
const passed = results.filter((r) => r.pass === true).length;
console.log(`\n  ${passed} passed, ${failed} failed\n`);

process.exit(failed > 0 ? 1 : 0);
