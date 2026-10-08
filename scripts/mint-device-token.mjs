#!/usr/bin/env node
/**
 * Mint a Firebase custom token carrying a `device_mac` claim, exchange it for a long-lived
 * ID-token / refresh-token pair, and print them ready to paste into the ESP32's NVS.
 *
 * WHY
 *   The ESP32 used to authenticate anonymously, which gave it an identity the database rules
 *   could not tie to a MAC address — so `relay_status` (which drives mains relays) had to stay
 *   writable by any authenticated principal. A custom token with a `device_mac` claim fixes
 *   that: rules can then assert `auth.token.device_mac === $mac`.
 *
 *   Custom tokens must be minted by a trusted environment. That is the whole point — a device
 *   must not be able to mint its own identity.
 *
 * USAGE
 *   1. Download a service-account key:
 *        Firebase Console > Project settings > Service accounts > Generate new private key
 *      Save it OUTSIDE the repo, e.g.  ~/.voltsense/service-account.json
 *      (It is a full-admin credential. Never commit it.)
 *
 *   2. Run:
 *        FIREBASE_SERVICE_ACCOUNT=~/.voltsense/service-account.json \
 *          node scripts/mint-device-token.mjs AA:BB:CC:DD:EE:FF
 *
 *      or:  npm run mint-token -- AA:BB:CC:DD:EE:FF
 *
 *   3. Flash esp32/ProvisionToken/ProvisionToken.ino and paste the two printed values.
 *
 * FLAGS
 *   --uid <uid>      override the generated uid (default `device:<MAC>`)
 *   --json           machine-readable output
 *   --selftest       verify the JWT assembly/signing with a throwaway key (no credentials needed)
 *
 * NO DEPENDENCIES: the custom token is a plain RS256-signed JWT, so node:crypto is sufficient —
 * this is exactly what firebase-admin does internally, without pulling in ~40 MB.
 */

import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// The audience every Firebase custom token must declare.
const IDENTITY_TOOLKIT_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

// Claims firebase-admin refuses to let you override.
const RESERVED_CLAIMS = new Set([
  'iss', 'sub', 'aud', 'exp', 'iat', 'nbf', 'jti', 'nonce', 'auth_time', 'provider_id', 'firebase'
]);

// Characters firebase-admin rejects in a uid.
const FORBIDDEN_UID_CHARS = ['.', '#', '$', '[', ']', '/'];

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const normalizeMac = (raw) => {
  const hex = String(raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) {
    throw new Error(`"${raw}" is not a MAC address (expected 12 hex digits, got ${hex.length}).`);
  }
  return hex.match(/.{2}/g).join(':');
};

/**
 * Build a Firebase custom token.
 * Format per https://firebase.google.com/docs/auth/admin/create-custom-tokens
 */
export const createCustomToken = ({ clientEmail, privateKey, uid, claims = {}, expiresInSec = 3600 }) => {
  if (!clientEmail || !privateKey) throw new Error('clientEmail and privateKey are required.');
  if (!uid || uid.length > 128) throw new Error('uid must be 1-128 characters.');

  for (const key of Object.keys(claims)) {
    if (RESERVED_CLAIMS.has(key)) throw new Error(`"${key}" is a reserved claim name.`);
  }
  // firebase-admin rejects these characters in a uid.
  const bad = FORBIDDEN_UID_CHARS.find((c) => uid.includes(c));
  if (bad) throw new Error(`uid must not contain ${bad}`);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: IDENTITY_TOOLKIT_AUD,
    iat: now,
    exp: now + expiresInSec,
    uid,
    claims
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${b64url(signer.sign(privateKey))}`;
};

/** Exchange a custom token for an ID token + refresh token via the Identity Toolkit REST API. */
const exchangeCustomToken = async (customToken, apiKey) => {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.message || res.statusText;
    throw new Error(`Identity Toolkit rejected the token (${res.status}): ${reason}`);
  }
  return body; // { idToken, refreshToken, expiresIn, localId, ... }
};

const loadServiceAccount = () => {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    '';

  if (!raw) {
    throw new Error(
      'No service account. Set FIREBASE_SERVICE_ACCOUNT to the path of your service-account JSON\n' +
      '  (or to the JSON itself). See the header of this file.'
    );
  }

  const text = raw.trim().startsWith('{')
    ? raw
    : fs.readFileSync(raw.replace(/^~(?=\/)/, os.homedir()), 'utf8');

  const sa = JSON.parse(text);
  for (const field of ['client_email', 'private_key', 'project_id']) {
    if (!sa[field]) throw new Error(`Service account JSON is missing "${field}".`);
  }
  return sa;
};

/** Proves the JWT assembly + RS256 signing are correct, with no credentials involved. */
const selftest = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const token = createCustomToken({
    clientEmail: 'selftest@example.iam.gserviceaccount.com',
    privateKey: pem,
    uid: 'device:AA:BB:CC:DD:EE:FF',
    claims: { device_mac: 'AA:BB:CC:DD:EE:FF' }
  });

  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  verifier.end();
  const signatureValid = verifier.verify(publicKey, Buffer.from(s, 'base64url'));

  const checks = [
    ['three segments', token.split('.').length === 3],
    ['header alg=RS256', header.alg === 'RS256' && header.typ === 'JWT'],
    ['aud is Identity Toolkit', payload.aud === IDENTITY_TOOLKIT_AUD],
    ['iss === sub === client_email', payload.iss === payload.sub],
    ['exp is iat + 3600', payload.exp - payload.iat === 3600],
    ['uid preserved', payload.uid === 'device:AA:BB:CC:DD:EE:FF'],
    ['device_mac claim present', payload.claims?.device_mac === 'AA:BB:CC:DD:EE:FF'],
    ['signature verifies', signatureValid],
    ['reserved claim rejected', (() => {
      try { createCustomToken({ clientEmail: 'a@b.c', privateKey: pem, uid: 'x', claims: { iss: 'nope' } }); return false; }
      catch { return true; }
    })()],
    ['bad MAC rejected', (() => { try { normalizeMac('ZZ:11'); return false; } catch { return true; } })()]
  ];

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nJWT assembly OK.' : '\nJWT assembly BROKEN.');
  process.exit(ok ? 0 : 1);
};

const main = async () => {
  const argv = process.argv.slice(2);

  if (argv.includes('--selftest')) return selftest();

  const asJson = argv.includes('--json');
  const uidIdx = argv.indexOf('--uid');
  const explicitUid = uidIdx !== -1 ? argv[uidIdx + 1] : null;
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== uidIdx + 1);

  if (positional.length !== 1) {
    console.error(
      'Usage: npm run mint-token -- <MAC address>\n' +
      '   e.g. npm run mint-token -- AA:BB:CC:DD:EE:FF\n' +
      '        npm run mint-token -- --selftest'
    );
    process.exit(1);
  }

  const mac = normalizeMac(positional[0]);
  const uid = explicitUid || `device:${mac}`;

  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is missing from .env (needed for the REST exchange).');

  const sa = loadServiceAccount();

  const customToken = createCustomToken({
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
    uid,
    claims: { device_mac: mac }
  });

  console.log(`Project : ${sa.project_id}`);
  console.log(`Device  : ${mac}`);
  console.log(`UID     : ${uid}`);
  console.log('Exchanging custom token for an ID token + refresh token...');

  const result = await exchangeCustomToken(customToken, apiKey);

  if (asJson) {
    console.log(JSON.stringify({ mac, uid, idToken: result.idToken, refreshToken: result.refreshToken, expiresIn: result.expiresIn }, null, 2));
    return;
  }

  console.log(`
==============================================================================
 Provisioning values — paste these into esp32/ProvisionToken/ProvisionToken.ino
 (or over its serial prompt). Treat them as secrets.
==============================================================================

DEVICE_ID_TOKEN
${result.idToken}

DEVICE_REFRESH_TOKEN
${result.refreshToken}

------------------------------------------------------------------------------
 ID token expires in ${result.expiresIn}s; the device refreshes it automatically
 using the refresh token, so you only need to provision once.
 If the device is offline for a long stretch, or the refresh token is revoked
 (Console > Authentication > Users), re-run this script and re-provision.
==============================================================================`);
};

// Only run main when executed directly, so the exported helpers stay importable/testable.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`\nFailed: ${err.message}\n`);
    process.exit(1);
  });
}
