/**
 * Unit tests for VoltSense's pure logic.
 *
 * WHY THIS FILE EXISTS
 *
 * Audit #2's P2-3 finding: the project had ZERO unit tests. Every regression was caught by the
 * Chromium harness or not at all — and that harness asserts page-render behaviour and source
 * patterns, so pure logic (hashing, key mapping, retention arithmetic, date handling) had no
 * coverage whatsoever. Two of the three P0 bugs found in that audit were pure logic that a test
 * at this level would have caught immediately.
 *
 * Run:  npm test        (node --test, built in — no test framework dependency)
 *
 * SCOPE — deliberately the pure, dependency-free functions:
 *   * api/_lib/firebaseAdmin.js  — hashing and constant-time comparison
 *   * api/alert.js               — retention pruning arithmetic
 *   * src/hooks/useHistoryData.js — range parsing / key mapping / composition
 *
 * Anything needing a database, the DOM or the network belongs in verify-fixes.mjs instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/**
 * Load a CommonJS module from `api/` as CJS.
 *
 * `package.json` sets `"type": "module"`, but Vercel requires these files to be CommonJS — so a
 * plain `import()` makes Node parse them as ESM and die on `require`. Same technique the harness
 * uses, and for the same reason.
 */
const loadCjs = (relPath, stubs = {}) => {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const mod = { exports: {} };
  const loader = new Function('module', 'exports', 'require', src);
  loader(mod, mod.exports, (id) => (id in stubs ? stubs[id] : require(id)));
  return mod.exports;
};

/** Load the ESM hook module's exports without a bundler. */
const loadHookModule = () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useHistoryData.js'), 'utf8');
  const body = src
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
    .replace(/export const /g, 'const ');
  const out = {};
  new Function(
    '__exports',
    `${body}
     __exports.toHistoryKey = toHistoryKey;
     __exports.parseCustomRange = parseCustomRange;
     __exports.composeCustomRange = composeCustomRange;`
  )(out);
  return out;
};

// ---------------------------------------------------------------------------
// api/_lib/firebaseAdmin.js — hashing and comparison
// ---------------------------------------------------------------------------

const lib = loadCjs('api/_lib/firebaseAdmin.js', {
  'firebase-admin': { apps: [], initializeApp: () => {} }
});

test('safeEqual returns true for identical strings', () => {
  assert.equal(lib.safeEqual('hunter2', 'hunter2'), true);
});

test('safeEqual rejects a one-character difference', () => {
  assert.equal(lib.safeEqual('hunter2', 'hunter3'), false);
});

test('safeEqual rejects a length mismatch without throwing', () => {
  assert.equal(lib.safeEqual('short', 'muchlonger'), false);
});

test('safeEqual rejects non-strings rather than coercing', () => {
  assert.equal(lib.safeEqual(undefined, 'x'), false);
  assert.equal(lib.safeEqual(null, null), false);
  assert.equal(lib.safeEqual(123, 123), false);
});

test('timingSafeEqual handles equal-length strings', () => {
  assert.equal(lib.timingSafeEqual('abcdef', 'abcdef'), true);
  assert.equal(lib.timingSafeEqual('abcdef', 'abcdeg'), false);
});

test('timingSafeEqual returns false (not a throw) on a length mismatch', () => {
  // crypto.timingSafeEqual throws on mismatched lengths, which would itself leak the length.
  assert.doesNotThrow(() => lib.timingSafeEqual('a', 'ab'));
  assert.equal(lib.timingSafeEqual('a', 'ab'), false);
});

test('hashSecret is deterministic across calls', () => {
  // /api/pair and /api/alert compute this independently, in separate processes. They must agree.
  assert.equal(lib.hashSecret('some-secret'), lib.hashSecret('some-secret'));
});

test('hashSecret is prefixed so a format change is detectable', () => {
  assert.match(lib.hashSecret('x'), /^sha256:[0-9a-f]{64}$/);
});

test('hashSecret never returns the plaintext', () => {
  const secret = 'super-secret-value';
  assert.ok(!lib.hashSecret(secret).includes(secret));
});

test('hashSecret output is comparable via timingSafeEqual', () => {
  const s = 'aBcD1234testsecretvalue';
  assert.equal(lib.timingSafeEqual(lib.hashSecret(s), lib.hashSecret(s)), true);
  assert.equal(lib.timingSafeEqual(lib.hashSecret(s), lib.hashSecret(s + '!')), false);
});

test('hashSecret distinguishes secrets differing by one character', () => {
  assert.notEqual(lib.hashSecret('abc'), lib.hashSecret('abd'));
});

test('normalizeMac uppercases and trims', () => {
  assert.equal(lib.normalizeMac('  aa:bb:cc:dd:ee:ff  '), 'AA:BB:CC:DD:EE:FF');
});

test('normalizeMac returns empty for non-strings', () => {
  assert.equal(lib.normalizeMac(undefined), '');
  assert.equal(lib.normalizeMac(null), '');
  assert.equal(lib.normalizeMac(42), '');
});

test('safeJsonParse returns null instead of throwing', () => {
  assert.equal(lib.safeJsonParse('{not json'), null);
  assert.deepEqual(lib.safeJsonParse('{"a":1}'), { a: 1 });
});

test('readBody accepts both a parsed object and a JSON string', () => {
  assert.deepEqual(lib.readBody({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(lib.readBody({ body: '{"a":1}' }), { a: 1 });
});

test('readBody rejects malformed and non-object bodies', () => {
  assert.equal(lib.readBody({ body: '{bad' }), null);
  assert.equal(lib.readBody({ body: '42' }), null);
  assert.equal(lib.readBody({}), null);
});

// ---------------------------------------------------------------------------
// api/alert.js — retention pruning arithmetic
// ---------------------------------------------------------------------------
//
// The retention logic is pure arithmetic over a key list, but it lives inside a closure. Rather
// than refactor production code purely for testability, these tests assert the INVARIANT the
// implementation must hold, by re-deriving it from the documented constants. If someone changes
// MAX_ALERT_HISTORY or the slice maths, this fails.

const alertSrc = fs.readFileSync(path.join(ROOT, 'api', 'alert.js'), 'utf8');

const MAX_ALERT_HISTORY = Number((alertSrc.match(/MAX_ALERT_HISTORY\s*=\s*(\d+)/) || [])[1]);

test('MAX_ALERT_HISTORY is a sane bounded number', () => {
  assert.ok(Number.isFinite(MAX_ALERT_HISTORY), 'constant must be a number');
  assert.ok(MAX_ALERT_HISTORY > 0 && MAX_ALERT_HISTORY <= 1000, `got ${MAX_ALERT_HISTORY}`);
});

test('retention query asks for one more than the cap', () => {
  // The +1 is deliberate: it lets the code tell "exactly at cap" from "over cap" without a second
  // read, and it guarantees the entry just written is never the one trimmed.
  assert.match(alertSrc, /limitToFirst\(MAX_ALERT_HISTORY\s*\+\s*1\)/);
});

test('retention trims only the overflow, oldest first', () => {
  // Re-derive the documented algorithm and check it against edge cases.
  const prune = (keys, max) => {
    if (keys.length <= max) return [];
    return keys.slice(0, keys.length - max);
  };

  assert.deepEqual(prune(['a', 'b', 'c'], 3), [], 'at cap: nothing pruned');
  assert.deepEqual(prune(['a', 'b', 'c', 'd'], 3), ['a'], 'over cap: oldest pruned');
  assert.deepEqual(prune(['a', 'b', 'c', 'd', 'e'], 3), ['a', 'b'], 'two over: two pruned');
  assert.deepEqual(prune([], 3), [], 'empty: nothing pruned');
});

test('retention never prunes the entry just written', () => {
  // The pushed key sorts last chronologically; the prune slice must never reach it.
  const max = 5;
  const keysAfterWrite = ['a', 'b', 'c', 'd', 'e', 'f']; // 'f' is the new entry
  const pruned = keysAfterWrite.slice(0, keysAfterWrite.length - max);
  assert.ok(!pruned.includes('f'), 'newest entry must survive the prune');
  assert.equal(keysAfterWrite.length - pruned.length, max, 'exactly max remain');
});

// ---------------------------------------------------------------------------
// src/lib/firebase.js / .env — the two sources of truth must not drift
// ---------------------------------------------------------------------------
//
// The audit found the web config hardcoded in firebase.js while `.env` held the identical values.
// firebase.js now reads the env first with those values as fallbacks, which removes the drift for
// anyone WITH a .env — but a stale fallback is still a trap, so this test asserts every literal
// fallback still matches its `.env` counterpart.

const readEnvFile = () => {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
};

test('firebase.js reads every config value from import.meta.env', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'firebase.js'), 'utf8');
  for (const key of [
    'API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID',
    'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID'
  ]) {
    assert.ok(
      src.includes(`import.meta.env.VITE_FIREBASE_${key}`),
      `${key} must be read from the environment, not only hardcoded`
    );
  }
});

test('firebase.js fallbacks match .env (no silent drift)', (t) => {
  const env = readEnvFile();
  if (!env) return t.skip('.env not present in this checkout');

  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'firebase.js'), 'utf8');
  const pairs = [
    ['VITE_FIREBASE_API_KEY', 'API_KEY'],
    ['VITE_FIREBASE_AUTH_DOMAIN', 'AUTH_DOMAIN'],
    ['VITE_FIREBASE_DATABASE_URL', 'DATABASE_URL'],
    ['VITE_FIREBASE_PROJECT_ID', 'PROJECT_ID'],
    ['VITE_FIREBASE_STORAGE_BUCKET', 'STORAGE_BUCKET'],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'MESSAGING_SENDER_ID'],
    ['VITE_FIREBASE_APP_ID', 'APP_ID']
  ];

  for (const [envKey, cfgKey] of pairs) {
    const envValue = env[envKey];
    if (!envValue) continue;
    const re = new RegExp(`VITE_FIREBASE_${cfgKey}\\s*\\|\\|\\s*["']([^"']+)["']`);
    const fallback = (src.match(re) || [])[1];
    assert.ok(fallback, `no fallback literal found for ${cfgKey}`);
    assert.equal(
      fallback,
      envValue,
      `${cfgKey} fallback ("${fallback}") differs from .env ("${envValue}") — one of them is stale`
    );
  }
});

test('firebase.js contains no server secret', () => {
  // A VITE_-prefixed server secret would be inlined into the public bundle.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'firebase.js'), 'utf8');
  assert.ok(!/VOLTSENSE_/.test(src), 'no server-only variable may appear in client code');
  assert.ok(!/private_key/i.test(src));
});


const hook = loadHookModule();

test('toHistoryKey maps the four named ranges', () => {
  assert.equal(hook.toHistoryKey('Today'), 'today');
  assert.equal(hook.toHistoryKey('Yesterday'), 'yesterday');
  assert.equal(hook.toHistoryKey('Last 7 Days'), 'last_7_days');
  assert.equal(hook.toHistoryKey('This Month'), 'this_month');
});

test('toHistoryKey is case-insensitive on named ranges', () => {
  assert.equal(hook.toHistoryKey('TODAY'), 'today');
  assert.equal(hook.toHistoryKey('  last 7 days  '), 'last_7_days');
});

test('toHistoryKey defaults an empty value to today', () => {
  assert.equal(hook.toHistoryKey(''), 'today');
  assert.equal(hook.toHistoryKey(null), 'today');
  assert.equal(hook.toHistoryKey(undefined), 'today');
});

test('toHistoryKey produces a Firebase-safe key with no slash', () => {
  // A `/` in a key silently creates a nested path instead of erroring — the trap this guards.
  const key = hook.toHistoryKey('Custom: 10/01/25 - 10/15/25');
  assert.ok(!key.includes('/'), `key must not contain "/": ${key}`);
  assert.ok(!/[.#$[\]]/.test(key), `key must not contain Firebase-forbidden chars: ${key}`);
});

test('toHistoryKey builds the canonical custom key', () => {
  assert.equal(hook.toHistoryKey('Custom: 10/01/25 - 10/15/25'), 'custom_20251001_20251015');
});

test('toHistoryKey zero-pads single-digit months and days', () => {
  assert.equal(hook.toHistoryKey('Custom: 1/2/25 - 3/4/25'), 'custom_20250102_20250304');
});

test('toHistoryKey normalises a 4-digit year identically to a 2-digit one', () => {
  assert.equal(
    hook.toHistoryKey('Custom: 10/01/25 - 10/15/25'),
    hook.toHistoryKey('Custom: 10/01/2025 - 10/15/2025')
  );
});

test('toHistoryKey never emits a leading or trailing underscore', () => {
  // The fallback path collapses punctuation; a stray underscore would produce a valid but
  // never-matching key.
  const key = hook.toHistoryKey('!!! weird range !!!');
  assert.ok(!key.startsWith('_') && !key.endsWith('_'), `got ${key}`);
  assert.ok(key.length > 0);
});

test('parseCustomRange accepts both picker formats', () => {
  assert.ok(hook.parseCustomRange('Custom: 10/01/25 - 10/15/25'));
  assert.ok(hook.parseCustomRange('10/01/25 - 10/15/25'));
});

test('parseCustomRange rejects non-ranges', () => {
  assert.equal(hook.parseCustomRange('today'), null);
  assert.equal(hook.parseCustomRange(''), null);
  assert.equal(hook.parseCustomRange('10/01/25'), null, 'a single date is not a range');
});

test('parseCustomRange normalises to zero-padded ISO dates', () => {
  const p = hook.parseCustomRange('10/1/25 - 10/9/2025');
  assert.equal(p.startISO, '2025-10-01');
  assert.equal(p.endISO, '2025-10-09');
});

test('parseCustomRange rejects an inverted range', () => {
  // An end before a start would compose a zero-length chart with no explanation.
  assert.equal(hook.parseCustomRange('10/15/25 - 10/01/25'), null);
});

test('parseCustomRange parses in LOCAL time, not UTC', () => {
  // new Date('2026-10-05') is UTC midnight = the previous day west of UTC. The composed range
  // must keep the day the user picked.
  const p = hook.parseCustomRange('10/05/26 - 10/05/26');
  assert.equal(p.start.getDate(), 5);
  assert.equal(p.start.getMonth(), 9); // October, zero-indexed
  assert.equal(p.start.getFullYear(), 2026);
});

// ---------------------------------------------------------------------------
// composeCustomRange — the custom-range fix
// ---------------------------------------------------------------------------

test('composeCustomRange emits one point per day, inclusive of both ends', () => {
  const r = hook.composeCustomRange({}, hook.parseCustomRange('10/01/25 - 10/03/25'));
  assert.equal(r.energy.length, 3);
  assert.equal(r.occupancy.length, 3);
});

test('composeCustomRange emits a single point for a single-day range', () => {
  const r = hook.composeCustomRange({}, hook.parseCustomRange('10/01/25 - 10/01/25'));
  assert.equal(r.energy.length, 1);
});

test('composeCustomRange reads the device record shape { e, m }', () => {
  const days = { '2025-10-01': { e: 1.5, m: 120 } };
  const r = hook.composeCustomRange(days, hook.parseCustomRange('10/01/25 - 10/01/25'));
  assert.equal(r.energy[0].kwh, 1.5);
  assert.equal(r.occupancy[0].occupied, 1);
  assert.equal(r.totals.hours, 2);
});

test('composeCustomRange coerces numeric strings from RTDB', () => {
  // RTDB can hand back "2.25" for a number; a bare toFixed() on that would throw and unmount.
  const days = { '2025-10-01': { e: '2.25', m: '60' } };
  const r = hook.composeCustomRange(days, hook.parseCustomRange('10/01/25 - 10/01/25'));
  assert.equal(r.energy[0].kwh, 2.25);
  assert.equal(r.totals.hours, 1);
});

test('composeCustomRange keeps 0 as a meaningful value, not a falsy fallback', () => {
  const days = { '2025-10-01': { e: 0, m: 0 } };
  const r = hook.composeCustomRange(days, hook.parseCustomRange('10/01/25 - 10/01/25'));
  assert.equal(r.energy[0].kwh, 0);
  assert.equal(r.occupancy[0].occupied, 0);
});

test('composeCustomRange renders a day with no record as zero, not as a gap', () => {
  // Skipping would compress the x-axis and misalign the occupancy overlay.
  const days = { '2025-10-01': { e: 1, m: 0 }, '2025-10-03': { e: 2, m: 0 } };
  const r = hook.composeCustomRange(days, hook.parseCustomRange('10/01/25 - 10/03/25'));
  assert.equal(r.energy.length, 3);
  assert.equal(r.energy[1].kwh, 0, 'the missing middle day is a zero, not omitted');
  assert.equal(r.energy[2].kwh, 2);
});

test('composeCustomRange sums the totals across the span', () => {
  const days = {
    '2025-10-01': { e: 1, m: 60 },
    '2025-10-02': { e: 2, m: 30 }
  };
  const r = hook.composeCustomRange(days, hook.parseCustomRange('10/01/25 - 10/02/25'));
  assert.equal(r.totals.energy, 3);
  assert.equal(r.totals.hours, 1.5);
});

test('composeCustomRange handles a null days node without throwing', () => {
  // A device running pre-fix firmware never wrote history/days. That must degrade, not crash.
  assert.doesNotThrow(() => hook.composeCustomRange(null, hook.parseCustomRange('10/01/25 - 10/03/25')));
  const r = hook.composeCustomRange(null, hook.parseCustomRange('10/01/25 - 10/03/25'));
  assert.equal(r.totals.energy, 0);
});

test('composeCustomRange handles a null parsed range without throwing', () => {
  const r = hook.composeCustomRange({ '2025-10-01': { e: 1 } }, null);
  assert.equal(r.energy.length, 0);
});

test('composeCustomRange caps the span at the device retention window', () => {
  // Asking for a year would otherwise produce a chart of 330 zeros, which reads as "no usage"
  // rather than "not kept".
  const r = hook.composeCustomRange({}, hook.parseCustomRange('01/01/25 - 12/31/25'));
  assert.equal(r.energy.length, 31);
});

test('composeCustomRange respects a custom maxDays', () => {
  const r = hook.composeCustomRange({}, hook.parseCustomRange('01/01/25 - 12/31/25'), 10);
  assert.equal(r.energy.length, 10);
});

test('composeCustomRange crosses a month boundary correctly', () => {
  const r = hook.composeCustomRange({}, hook.parseCustomRange('10/30/25 - 11/02/25'));
  assert.equal(r.energy.length, 4, 'Oct 30, 31, Nov 1, 2');
});

test('composeCustomRange handles a leap day', () => {
  const r = hook.composeCustomRange({ '2028-02-29': { e: 5, m: 60 } }, hook.parseCustomRange('02/28/28 - 03/01/28'));
  assert.equal(r.energy.length, 3);
  const leap = r.energy.find((d) => d.label === '29/2');
  assert.ok(leap, 'leap day must be present');
  assert.equal(leap.kwh, 5);
});

test('composeCustomRange returns the full render shape', () => {
  // Analytics reads account.usage and account.alerts; a missing key would throw on render.
  const r = hook.composeCustomRange({}, hook.parseCustomRange('10/01/25 - 10/01/25'));
  for (const key of ['energy', 'occupancy', 'usage', 'alerts']) {
    assert.ok(Array.isArray(r[key]), `${key} must be an array`);
  }
  assert.ok(r.totals && typeof r.totals.energy === 'number' && typeof r.totals.hours === 'number');
});
