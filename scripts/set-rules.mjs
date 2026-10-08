#!/usr/bin/env node
/**
 * Switch which database ruleset `firebase deploy --only database` will push.
 *
 *   npm run rules:scoped      owner-scoped rules. Works with the device's current auth.
 *                             Safe to deploy at any time.
 *   npm run rules:deviceuid   adds device identity via a uid allow-list. Needs NO service
 *                             account and NO paid plan — the device signs in with an
 *                             email/password account you create in the Console.
 *   npm run rules:strict      adds device identity via a `device_mac` custom-token claim.
 *                             Needs a service account to mint the tokens.
 *   npm run rules:status      show which one is active.
 *
 * The two device-identity rulesets will silently break a device that has not been provisioned —
 * telemetry stops and relays stop responding. That should never happen by accident, so switching
 * is an explicit command that prints the pre-flight checklist.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const active = path.join(root, 'database.rules.json');

const VARIANTS = [
  {
    mode: 'scoped',
    file: 'database.rules.scoped.json',
    label: 'scoped (deployable today, no device identity)',
    checklist: null
  },
  {
    mode: 'deviceuid',
    file: 'database.rules.deviceuid.json',
    label: 'device identity via uid allow-list (no service account, no paid plan)',
    checklist: [
      'For EACH device, in Firebase Console:',
      '  a. Authentication > Users > Add user. Email: device-<mac, no colons>@<your auth domain>,',
      '     set a password. Copy the generated UID.',
      '  b. Realtime Database > add  device_uids/<AA:BB:CC:DD:EE:FF> = "<that UID>"',
      '     (that node is not writable through the API — only the Console can set it).',
      '  c. Flash esp32/ProvisionToken and enter the email + password (skip the token fields).',
      '  d. VoltSense.ino should log "Device identity loaded (email/password)."'
    ]
  },
  {
    mode: 'strict',
    file: 'database.rules.strict.json',
    label: 'device identity via device_mac custom-token claim',
    checklist: [
      'Requires a service account (free on Spark, but if the Console refuses, use rules:deviceuid).',
      'For EACH device:',
      '  1. npm run mint-token -- AA:BB:CC:DD:EE:FF',
      '  2. Flash esp32/ProvisionToken and paste the ID token + refresh token.',
      '  3. VoltSense.ino should log "Device identity loaded (custom token".',
      '  4. The device appears in Console > Authentication > Users as device:AA:BB:...'
    ]
  }
];

const read = (p) => fs.readFileSync(p, 'utf8');

const current = () => VARIANTS.find((v) => fs.existsSync(path.join(root, v.file)) && read(active) === read(path.join(root, v.file)));

const mode = (process.argv[2] || 'status').toLowerCase();

if (mode === 'status') {
  const v = current();
  console.log(`Active ruleset: ${v ? v.label : 'UNKNOWN (database.rules.json matches no variant)'}`);
  process.exit(v ? 0 : 1);
}

const variant = VARIANTS.find((v) => v.mode === mode);
if (!variant) {
  console.error(`Unknown mode "${mode}". Use one of: ${VARIANTS.map((v) => v.mode).join(' | ')} | status`);
  process.exit(1);
}

const source = path.join(root, variant.file);
if (!fs.existsSync(source)) {
  console.error(`Cannot switch: ${variant.file} is missing.`);
  process.exit(1);
}

fs.copyFileSync(source, active);
console.log(`Active ruleset: ${variant.label}\n`);

if (variant.checklist) {
  console.log('Before deploying, confirm ALL of these:');
  for (const line of variant.checklist) console.log(`  ${line}`);
  console.log('\nThen:  npm run deploy:rules');
} else {
  console.log('Then:  npm run deploy:rules');
}
