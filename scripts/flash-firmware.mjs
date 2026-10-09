#!/usr/bin/env node
/**
 * Build (and optionally upload) the VoltSense firmware with the factory pairing key supplied at
 * build time, so the key never has to be typed into the source or committed.
 *
 *   node scripts/flash-firmware.mjs                # compile only
 *   node scripts/flash-firmware.mjs COM5           # compile + upload to COM5
 *   node scripts/flash-firmware.mjs /dev/ttyUSB0   # ...or a POSIX port
 *
 * WHY THIS EXISTS
 * A firmware built without the key still boots, but prints
 *   "No factory pairing key compiled in; USB provisioning required."
 * and refuses to pair over the air — a mistake that is easy to make with a hand-typed
 * `-DVOLTSENSE_PAIRING_KEY=...` and easy to forget. This reads the key from `.env` (or `.env.local`)
 * and injects it, so the only thing you can get wrong is not having the key at all.
 *
 * The key MUST be identical to `VOLTSENSE_PAIRING_KEY` in the Vercel project, or /api/pair answers
 * 401. Get it from the same source you put in Vercel.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKETCH = path.join(ROOT, 'esp32', 'VoltSense');
const FQBN = 'esp32:esp32:esp32:PartitionScheme=huge_app'; // default partition is too small

function readEnvKey() {
  for (const file of ['.env', '.env.local']) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^VOLTSENSE_PAIRING_KEY=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const key = readEnvKey();
if (!key) {
  console.error('VOLTSENSE_PAIRING_KEY is empty or missing in .env / .env.local.');
  console.error('Building without it produces a device that boots but cannot pair over the air.');
  console.error('Add it (openssl rand -hex 32), matching the value set in Vercel, then re-run.');
  process.exit(1);
}

const port = process.argv[2];
const args = [
  'compile',
  '--fqbn', FQBN,
  '--build-property', `compiler.cpp.extra_flags=-DVOLTSENSE_PAIRING_KEY="${key}"`
];
if (port) args.push('--upload', '-p', port);
args.push(SKETCH);

console.log(`Building ${path.relative(ROOT, SKETCH)} with the factory key from .env ...`);
try {
  execFileSync('arduino-cli', args, { stdio: 'inherit' });
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('\narduino-cli was not found on PATH.');
    console.error('Install it from https://arduino.github.io/arduino-cli/ , or use the Arduino IDE');
    console.error('with the build flag -DVOLTSENSE_PAIRING_KEY="<key>" (see docs/HANDOFF.md §3.4).');
  } else {
    console.error('\narduino-cli failed — see the output above.');
  }
  process.exit(1);
}
console.log(port ? `\nDone — built and uploaded to ${port}.` : '\nDone — compiled. Pass a port to upload, e.g. `npm run flash:firmware -- COM5`.');
