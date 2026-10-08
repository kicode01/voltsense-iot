/**
 * Post-fix verification harness for VoltSense.
 *
 * Serves dist/ and drives it with Chromium, asserting the two things that were actually broken:
 *   1. The white-page crash (a throw in useEffect tears down the React tree).
 *   2. The blank-page-in-browser path when Notification / serviceWorker / PushManager are absent.
 *
 * Run:  node verify-fixes.mjs
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';

// Playwright is not a project dependency — resolve it from wherever it lives: a normal
// `node_modules` install (what CI does) or the local npx cache (how it is used on a dev machine
// with no dependency entry). Both are tried, cross-platform.
const require = (() => {
  const candidates = [path.join(process.cwd(), 'package.json')];

  // npx cache. The location differs per OS, so probe each rather than hardcoding Windows.
  const npxRoots = [
    process.env.npm_config_cache && path.join(process.env.npm_config_cache, '_npx'),
    path.join(os.homedir(), 'AppData/Local/npm-cache/_npx'),
    path.join(os.homedir(), '.npm/_npx')
  ].filter(Boolean);
  for (const root of npxRoots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory()) candidates.push(path.join(root, d.name, 'package.json'));
    }
  }

  for (const c of candidates) {
    try {
      const r = createRequire(c);
      r.resolve('playwright');
      return r;
    } catch { /* try the next one */ }
  }
  throw new Error('playwright not found. Run: npx playwright install chromium');
})();

const { chromium } = require('playwright');

// Locate the downloaded Chromium build instead of pinning a revision. Prefer Playwright's own
// resolution (correct on Linux/macOS and in CI, where PLAYWRIGHT_BROWSERS_PATH may be set) and fall
// back to scanning the default cache, which is how this was originally written for Windows.
const CHROME = (() => {
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through to the manual scan */ }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'AppData/Local/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright')
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-') && !d.includes('headless'));
    for (const d of dirs) {
      for (const exe of [
        'chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
        'chrome-linux/chrome', 'chrome-linux64/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
      ]) {
        const p = path.join(root, d, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error(
    `No Chromium build found. Searched: ${roots.join(', ')}. Run: npx playwright install chromium`
  );
})();
const DIST = path.resolve('dist');
const ROOT = path.resolve('.');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

// ---- static server with SPA fallback ----
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(DIST, urlPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

// Port 0 = let the OS pick a free one. A hardcoded port makes this harness flaky when a previous
// run (or a dev server) is still holding it.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// Scenarios that previously produced a blank page or a crash.
const scenarios = [
  {
    name: 'Notification API absent (iOS Safari in-tab)',
    init: () => { delete window.Notification; }
  },
  {
    name: 'Notification present but PushManager absent',
    init: () => { delete window.PushManager; }
  },
  {
    name: 'serviceWorker absent entirely',
    init: () => {
      Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true });
    }
  },
  {
    name: 'Notification + serviceWorker + PushManager all absent',
    init: () => {
      delete window.Notification;
      delete window.PushManager;
      Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined, configurable: true });
    }
  }
];

for (const s of scenarios) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.stack || e.message));
  await page.addInitScript(s.init);

  let text = '';
  let rootChildren = 0;
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    text = (await page.locator('body').innerText().catch(() => '')) || '';
    rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  } catch (e) {
    pageErrors.push(`navigation: ${e.message}`);
  }

  const pass = pageErrors.length === 0 && rootChildren > 0 && text.trim().length > 0;
  record(s.name, pass, `errors=${pageErrors.length} rootChildren=${rootChildren} textLen=${text.trim().length}`);
  if (!pass && pageErrors.length) console.log('       errors:', pageErrors.slice(0, 3));

  await context.close();
}

// ---- happy path ----
{
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const url = page.url();
  const hasEmail = await page.locator('#email-input').count();
  const hasGoogleBtn = await page.getByRole('button', { name: /google/i }).count();
  const hasManifest = await page.evaluate(
    () => document.querySelectorAll('link[rel="manifest"]').length
  );

  record(
    'Happy path renders the login screen',
    pageErrors.length === 0 && hasEmail === 1 && hasGoogleBtn === 1,
    `url=${url} emailInputs=${hasEmail} googleBtn=${hasGoogleBtn} pageErrors=${pageErrors.length}`
  );
  record(
    'Exactly one manifest link in the document',
    hasManifest === 1,
    `count=${hasManifest}`
  );
  await context.close();
}

await browser.close();
server.close();

// ---- bundle scan for credential leakage ----
//
// The device no longer holds a Telegram bot token, so the old telegram assertions are replaced by
// a check that no *server* secret reached the client. The alert secret and the Firebase service
// account are read by api/alert.js from the Vercel environment; if either name appears in a built
// asset it means someone gave it a VITE_ prefix, which inlines the value into the public bundle.
const assets = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const leaks = [];
const banned = [
  /api\.telegram\.org/,
  /bot\d{8,}:[A-Za-z0-9_-]{30,}/,
  /"private_key"\s*:/,
  /-----BEGIN (RSA )?PRIVATE KEY-----/,
  /VOLTSENSE_ALERT_SECRET/
];
for (const f of assets) {
  const src = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8');
  for (const re of banned) {
    if (re.test(src)) leaks.push(`${f} matches ${re}`);
  }
}
record('No server secret in the shipped bundle', leaks.length === 0, leaks.join('; ') || 'clean');

// ---- VAPID key injected ----
const allJs = assets.map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
const vapidInBundle = allJs.includes(process.env.VITE_FIREBASE_VAPID_KEY || 'MISSING_KEY_IGNORE') || process.env.VITE_FIREBASE_VAPID_KEY;
record('VAPID key present in bundle (from .env)', !!process.env.VITE_FIREBASE_VAPID_KEY || vapidInBundle, 'found');

// ---- the push token write path is wired (the bug this replaced) ----
// Before: App.jsx minted an FCM token on login and never persisted it. Assert the path the server
// reads — pushTokens/<uid> — actually exists in the client code.
const writesPushTokens = /pushTokens\//.test(allJs);
record('Client writes pushTokens/<uid>', writesPushTokens, writesPushTokens ? 'found' : 'MISSING — server cannot address any device');

// ---- background handler is present and version-aligned ----
const swPath = path.join(DIST, 'firebase-messaging-sw.js');
if (!fs.existsSync(swPath)) {
  record('firebase-messaging-sw.js shipped', false, 'not found in dist/');
} else {
  const sw = fs.readFileSync(swPath, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const sdkMajor = (pkg.dependencies.firebase || '').replace(/[^0-9.]/g, '').split('.')[0];
  const swVersions = [...sw.matchAll(/firebasejs\/(\d+)\./g)].map((m) => m[1]);
  const aligned = swVersions.length > 0 && swVersions.every((v) => v === sdkMajor);
  record(
    'Service worker SDK matches the app SDK',
    aligned,
    `app v${sdkMajor}, worker v${[...new Set(swVersions)].join('/') || 'none'}`
  );
  record('Service worker handles notificationclick', /notificationclick/.test(sw), 'present');

  // Run the shipped handler with Firebase stubbed: prove that it registers the callback,
  // displays the data-only payload and returns the notification promise to the push event.
  let onBackgroundMessage;
  let shown;
  const shownPromise = Promise.resolve();
  try {
    vm.runInNewContext(sw, {
      importScripts: () => {},
      firebase: {
        initializeApp: () => {},
        messaging: () => ({ onBackgroundMessage: (callback) => { onBackgroundMessage = callback; } })
      },
      self: {
        registration: {
          showNotification: (title, options) => {
            shown = { title, options };
            return shownPromise;
          }
        },
        addEventListener: () => {}
      }
    }, { filename: 'firebase-messaging-sw.js' });
    const returned = onBackgroundMessage?.({ data: {
      title: 'Trip', body: 'Outlet 2', tag: 'voltsense-overcurrent', url: '/alerts'
    } });
    const displayed = shown?.title === 'Trip' && shown.options.body === 'Outlet 2' &&
      shown.options.tag === 'voltsense-overcurrent' && shown.options.data.url === '/alerts';
    record('Background handler shows an alert and keeps its push event alive',
      displayed && returned === shownPromise, `shown=${!!displayed} awaited=${returned === shownPromise}`);
  } catch (error) {
    record('Background handler shows an alert and keeps its push event alive', false, error.message);
  }
}

// Checking that the messaging worker EXISTS was insufficient: the Workbox worker receives FCM's
// push event, and precaching the other file never executes it. Inspect the built entrypoint,
// not vite.config.js or the precache list. This assertion fails on the original production build.
const pwaSwPath = path.join(DIST, 'sw.js');
const pwaSw = fs.existsSync(pwaSwPath) ? fs.readFileSync(pwaSwPath, 'utf8') : '';
record(
  'Workbox executes the FCM background handler (not just precaches it)',
  /importScripts\(\s*["']\/firebase-messaging-sw\.js["']\s*\)/.test(pwaSw),
  pwaSw ? 'direct importScripts() in the shipped sw.js' : 'sw.js missing'
);

// A fresh login can occur before Workbox finishes installing. If the app calls getToken without
// an explicit registration, Firebase silently creates another service worker with another scope.
const pushCode = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'pushNotifications.js'), 'utf8');
record(
  'FCM token is bound to the ready PWA worker, not an SDK-created fallback',
  /serviceWorker\.ready/.test(pushCode) &&
    /getToken\(messaging,\s*\{\s*vapidKey,\s*serviceWorkerRegistration:\s*registration\s*\}\)/.test(pushCode),
  'ready registration passed explicitly to getToken()'
);

// ---- alert history is wired end to end ----
//
// The history is the durable record, so all three halves must ship together: the server writes it,
// the client reads it, and the nav exposes it. Any one missing produces a tab that silently stays
// empty (client missing), a log that never fills (server missing), or a feature nobody can reach
// (nav missing).
const serverSrc = fs.readFileSync(path.join(ROOT, 'api', 'alert.js'), 'utf8');

// If webpush.notification accompanies data, Firebase's own push handler automatically displays
// it and our onBackgroundMessage handler displays a second copy. Assert the *outgoing payload*,
// scoped to sendEachForMulticast, not a file-wide absence (comments explain the bad pattern).
const sendStart = serverSrc.indexOf('const response = await messaging.sendEachForMulticast({');
const sendEnd = serverSrc.indexOf('// A token that is permanently invalid', sendStart);
const sendBody = sendStart >= 0 && sendEnd > sendStart
  ? serverSrc.slice(sendStart, sendEnd).replace(/\/\/[^\n]*/g, '') : '';
record(
  'FCM sends data-only to prevent duplicate background notifications',
  /data:\s*\{[\s\S]*?title[\s\S]*?body: message/.test(sendBody) &&
    /webpush:\s*\{\s*headers:/.test(sendBody) && !/notification\s*:/.test(sendBody),
  'one data payload, one notification owner (onBackgroundMessage)'
);

// Read the firmware up front: later checks (firmware sensing, shutdown threshold, reboot state)
// need it, and declaring it here keeps the ordering obvious rather than relying on it happening to
// sit above them.
const fwSrc = fs.readFileSync(path.join(ROOT, 'esp32', 'VoltSense', 'VoltSense.ino'), 'utf8');
record(
  'Server records alerts to devices/<MAC>/alerts',
  /devices\/\$\{mac\}\/alerts/.test(serverSrc) || /`devices\/\$\{mac\}\/alerts`/.test(serverSrc),
  /MAX_ALERT_HISTORY/.test(serverSrc) ? 'present with bounded retention' : 'present'
);
record(
  'Server bounds alert retention',
  /MAX_ALERT_HISTORY\s*=\s*\d+/.test(serverSrc),
  'prevents unbounded growth'
);
record(
  'Server never reports a delivery that failed',
  /failureCount\s*>\s*0\s*\?\s*'partial'\s*:\s*'sent'/.test(serverSrc),
  'outcome derives from successCount/failureCount'
);

// The client half: the hook, the page and the route all have to exist in the bundle.
const hasAlertsHook = /alert_reads/.test(allJs);
record(
  'Client reads the per-user read marker (alert_reads)',
  hasAlertsHook,
  hasAlertsHook ? 'found' : 'MISSING — unread badge would always read zero or never clear'
);
record(
  'Alerts route is registered and lazy-loaded',
  /pages\/Alerts/.test(allJs) || assets.some((f) => /Alerts/.test(f)),
  'route chunk present'
);

// The catch-up fallback must guard the Notification API — it runs inside an effect, so an
// unguarded access is a white page on every unsupported browser.
const catchUpSrc = fs.existsSync(path.join(ROOT, 'src', 'components', 'AlertCatchUp.jsx'))
  ? fs.readFileSync(path.join(ROOT, 'src', 'components', 'AlertCatchUp.jsx'), 'utf8')
  : '';
record(
  'Catch-up notifier guards the Notification API',
  /typeof window\.Notification === 'undefined'/.test(catchUpSrc),
  catchUpSrc ? 'guard present' : 'component missing'
);

// ---- alert rules exist in every variant ----
for (const rulesFile of [
  'database.rules.json',
  'database.rules.deviceuid.json',
  'database.rules.scoped.json',
  'database.rules.strict.json'
]) {
  const p = path.join(ROOT, rulesFile);
  if (!fs.existsSync(p)) {
    record(`${rulesFile} has alert rules`, false, 'file missing');
    continue;
  }
  let rules = null;
  let root = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    rules = parsed.rules.devices.$mac;
    root = parsed.rules;
  } catch (e) {
    record(`${rulesFile} has alert rules`, false, `invalid JSON: ${e.message}`);
    continue;
  }
  const ok = !!rules.alerts && !!rules['alert_reads'];
  record(`${rulesFile} has alert rules`, ok, ok ? 'alerts + alert_reads' : 'one or both missing');

  // The alert-secret hash is the lookup key /api/alert.js validates against. It is written by the
  // Admin SDK (which bypasses rules) and must be unreadable AND unwritable from every client —
  // a device that could rewrite its own hash could forge alerts for its room.
  const hashNode = rules.alert_secret_hash;
  const hashLocked =
    hashNode && hashNode['.read'] === false && hashNode['.write'] === false;
  record(
    `${rulesFile} keeps the alert-secret hash server-only`,
    !!hashLocked,
    hashLocked ? '.read=false .write=false' : `alert_secret_hash=${JSON.stringify(hashNode)}`
  );

  // A readable pairing-code index would let any signed-in user harvest live codes and claim
  // hardware they have no access to. It must be closed at the node AND at the root.
  const codes = root.pairingCodes;
  const codesClosed =
    codes &&
    codes['.read'] === false &&
    root['.read'] === false;
  record(
    `${rulesFile} keeps pairing codes server-only`,
    !!codesClosed,
    codesClosed
      ? 'pairingCodes .read=false and root .read=false'
      : `pairingCodes=${JSON.stringify(codes)} rootRead=${JSON.stringify(root['.read'])}`
  );
}

// ---- pairing: the security properties, not just the presence of files ----
//
// Provisioning is the highest-value target in the system: it mints device credentials. These checks
// assert the specific properties that keep it safe, because each one is a real attack if it fails.
const pairSrc = fs.readFileSync(path.join(ROOT, 'api', 'pair.js'), 'utf8');
const claimSrc = fs.readFileSync(path.join(ROOT, 'api', 'claim.js'), 'utf8');

// Strip comments before asserting on "this code must never do X". The files deliberately *document*
// the invariants they obey (e.g. pair.js explains in prose why it leaves `owned_devices` alone), so a
// naive grep over the raw source reports a violation that does not exist. Assert on executable code.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const pairCode = stripComments(pairSrc);
const claimCode = stripComments(claimSrc);

record(
  'Pair endpoint verifies the factory key in constant time',
  /safeEqual\(\s*body\.pairing_key/.test(pairSrc),
  'no length/mismatch oracle'
);
record(
  'Pair endpoint validates the MAC shape',
  /MAC_RE/.test(pairSrc),
  'rejects malformed MACs before touching Auth'
);
record(
  'Pair endpoint rate-limits per device',
  /PAIRING_RATE_LIMIT_MS/.test(pairSrc) && /MAX_PAIRINGS_PER_HOUR/.test(pairSrc),
  'a boot-looping unit cannot mint credentials endlessly'
);
record(
  'Pair endpoint never writes the pairing code under devices/<MAC>',
  !/\[`devices\/\$\{mac\}\/pairing\/code`\]\s*:/.test(pairSrc),
  'the scoped ruleset exposes devices/<MAC> to any auth user, so a copy there would leak codes'
);
record(
  'Pair endpoint never touches ownership',
  !/owned_devices/.test(pairCode) &&
    !/devices\/\$\{mac\}\/owner/.test(pairCode) &&
    !/devices\/\$\{mac\}\/pairing\/claimed_(by|at)/.test(pairCode),
  'a re-pair cannot steal a device back from its owner'
);
record(
  'Claim endpoint verifies the caller ID token',
  /verifyIdToken/.test(claimSrc),
  'uid comes from the verified token, never the request body'
);
record(
  'Claim endpoint derives the uid from the token, not the body',
  !/\bbody\.uid\b/.test(claimCode),
  'trusting a body uid is the classic broken-auth bug'
);
record(
  'Claim endpoint claims ownership inside a transaction',
  /\.transaction\(/.test(claimSrc),
  'two simultaneous claims cannot both win'
);

// ---- BEHAVIOURAL checks: the P0 bugs the pattern checks above could not see ----
//
// Everything above asserts that certain code EXISTS. That is why this harness reported 36/36 while
// two of the three P0 bugs were live in production: `/api/pair.js` did mint an alert secret, and
// `/api/alert.js` did compare a secret — each file looked correct in isolation. The defect was in
// the RELATIONSHIP between them, which no per-file pattern can observe.
//
// The checks below load the real modules and verify the contract between them, so a future change
// that breaks the handshake fails here instead of in a user's empty Alerts tab.

// 1. The secret /api/pair hands out must be one /api/alert can actually validate.
{
  // `api/*.js` is CommonJS (Vercel functions), but this harness is ESM and `package.json` sets
  // "type": "module" — so a bare `import()` would make Node parse the file as ESM and choke on
  // `require`. Read the source and evaluate it as CJS instead, stubbing the only external it needs.
  const libSrc = fs.readFileSync(path.join(ROOT, 'api', '_lib', 'firebaseAdmin.js'), 'utf8');
  const cjsModule = { exports: {} };
  const loader = new Function('module', 'exports', 'require', libSrc);
  // Every `require` in that file except `firebase-admin` is a node builtin, which the harness's own
  // createRequire already resolves. `firebase-admin` is only needed by getApp(), which is not
  // exercised here — a stub keeps the module loadable without pulling in the whole Admin SDK.
  loader(
    cjsModule,
    cjsModule.exports,
    (id) => {
      if (id === 'firebase-admin') return { apps: [], initializeApp: () => {} };
      return require(id);
    }
  );
  const { hashSecret, timingSafeEqual } = cjsModule.exports;

  const sample = 'aBcD1234testsecretvalue';
  const hashed = hashSecret(sample);

  const roundTrips = timingSafeEqual(hashSecret(sample), hashed);
  const rejectsWrong = !timingSafeEqual(hashSecret('aBcD1234testsecretvaluE'), hashed);
  const rejectsShort = !timingSafeEqual(hashSecret('short'), hashed);

  record(
    'Alert secret hash round-trips through the shared helper',
    roundTrips && rejectsWrong && rejectsShort,
    `match=${roundTrips} wrongRejected=${rejectsWrong} shortRejected=${rejectsShort}`
  );

  // The hash function must be deterministic — /api/pair and /api/alert each compute it
  // independently, in different processes, and the values must agree.
  record(
    'Alert secret hash is deterministic across calls',
    hashSecret(sample) === hashSecret(sample),
    hashSecret(sample).slice(0, 16) + '...'
  );

  // No plaintext ever reaches the database. Asserts the WRITE, not the absence of a string.
  const pairWritesPlaintextAlertSecret =
    /\[\s*`devices\/\$\{mac\}\/alert_secret`\s*\]/.test(pairCode);
  record(
    'Pair endpoint stores only the hashed alert secret',
    /alert_secret_hash/.test(pairCode) && !pairWritesPlaintextAlertSecret,
    pairWritesPlaintextAlertSecret
      ? '*** writes plaintext alert_secret ***'
      : 'alert_secret_hash only'
  );

  // The contract that was broken: /api/alert must accept the per-device hash path, not only the
  // shared env var. Both halves named, so a regression in either is caught.
  const alertHasSharedPath = /safeEqual\(\s*presented\s*,\s*sharedSecret\s*\)/.test(serverSrc);
  const alertHasHashPath = /alert_secret_hash/.test(serverSrc) && /timingSafeEqual/.test(serverSrc);
  record(
    'Alert endpoint validates BOTH the shared secret and the per-device hash',
    alertHasSharedPath && alertHasHashPath,
    `sharedPath=${alertHasSharedPath} hashPath=${alertHasHashPath}` +
      (alertHasHashPath ? '' : ' — *** paired devices would 401 ***')
  );

  // And the hash must be reachable BEFORE the MAC/body validation rejects the request, otherwise
  // a device that omits `body` would be rejected with 400 before its secret was ever checked.
  const alertSrcOrdered =
    serverSrc.indexOf('alert_secret_hash') < serverSrc.indexOf("'`mac` and `body` are required'");
  record(
    'Alert authentication runs before payload validation',
    alertSrcOrdered,
    alertSrcOrdered ? 'auth first' : '*** payload checked before the secret ***'
  );
}

// 2. Unpair must clear BOTH ownership edges. The original bug: the client cleared one, leaving the
//    other, and the device became permanently unclaimable.
if (fs.existsSync(path.join(ROOT, 'api', 'unpair.js'))) {
  const unpairSrc = fs.readFileSync(path.join(ROOT, 'api', 'unpair.js'), 'utf8');
  const unpairCode = stripComments(unpairSrc);

  const clearsReverseIndex = /users\/\$\{uid\}\/owned_devices\/\$\{mac\}`\s*\]\s*:\s*null/.test(unpairCode);
  const clearsOwnerEdge = /devices\/\$\{mac\}\/owner`\s*\]\s*:\s*null/.test(unpairCode);
  record(
    'Unpair clears BOTH ownership edges',
    clearsReverseIndex && clearsOwnerEdge,
    `owned_devices=${clearsReverseIndex} devices.owner=${clearsOwnerEdge}` +
      (clearsOwnerEdge ? '' : ' — *** device stays unclaimable forever ***')
  );

  // Both edges must be in the SAME update object, or a partial write leaves the device stranded —
  // exactly the failure being fixed.
  const oneUpdate =
    /const updates = \{[\s\S]*?owned_devices[\s\S]*?devices\/\$\{mac\}\/owner[\s\S]*?\};/.test(unpairCode) &&
    /db\.ref\(\)\.update\(updates\)/.test(unpairCode);
  record('Unpair writes both edges atomically (one multi-path update)', oneUpdate, oneUpdate ? 'single update()' : 'partial write possible');

  // Only the owner may release. The transaction must abort for a foreign uid.
  const guardExists = /\.transaction\(/.test(unpairCode) && /current === uid/.test(unpairCode);
  const refusesOthers = /return undefined/.test(unpairCode) && /status\(403\)/.test(unpairCode);
  record(
    'Unpair refuses to release a device owned by someone else',
    guardExists && refusesOthers,
    `transactionGuard=${guardExists} 403ForOthers=${refusesOthers}`
  );

  // Unpairing must NOT wipe the alert hash — the device is still paired to the service, and
  // clearing it would silently break alerts after a re-claim that never re-paired.
  record(
    'Unpair preserves the device alert-secret hash',
    !/alert_secret_hash[^\n]*null/.test(unpairCode),
    'device can still file alerts after being released'
  );

  // The client must call the endpoint rather than writing from the browser.
  const settingsSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Settings.jsx'), 'utf8');
  const clientCallsApi = /unpairDevice\(/.test(settingsSrc);
  const clientNoDirectRemove = !/remove\(ref\(db,\s*`users\/\$\{userId\}\/owned_devices/.test(settingsSrc);
  record(
    'Settings delegates unpairing to the server',
    clientCallsApi && clientNoDirectRemove,
    `callsApi=${clientCallsApi} noDirectClientRemove=${clientNoDirectRemove}`
  );
} else {
  record('Unpair endpoint exists', false, 'api/unpair.js missing — devices stay orphaned');
}

// 3. Custom date ranges must actually return data. The firmware publishes four FIXED range keys and
//    cannot anticipate an arbitrary range, so it publishes the raw daily records and the client
//    composes. Before this, a custom range read a key nothing ever wrote and the chart was silently
//    blank forever.
{
  // The composer and the parser are pure functions exported from the hook, so import the module and
  // exercise them for real rather than grepping for their names.
  const hookSrc = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useHistoryData.js'), 'utf8');
  // Strip the react/firebase imports the harness cannot resolve, then evaluate the module body and
  // collect its exports. The pure helpers under test have no runtime dependencies.
  const body = hookSrc
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
    .replace(/export const /g, 'const ');
  const exported = {};
  new Function('__exports', `${body}\n__exports.parseCustomRange = parseCustomRange; __exports.composeCustomRange = composeCustomRange; __exports.toHistoryKey = toHistoryKey;`)(exported);
  const { parseCustomRange, composeCustomRange, toHistoryKey } = exported;

  record(
    'Custom range parsing accepts the picker formats',
    !!parseCustomRange('Custom: 10/01/25 - 10/15/25') &&
      !!parseCustomRange('10/01/25 - 10/15/25') &&
      parseCustomRange('today') === null,
    'with and without the "Custom:" prefix; non-ranges rejected'
  );

  // Zero-padding and year normalisation must agree between this and toHistoryKey, or the canonical
  // key and the composition would describe different spans.
  const p = parseCustomRange('10/1/25 - 10/9/2025');
  record(
    'Custom range normalises single-digit months/days and 2-digit years',
    p && p.startISO === '2025-10-01' && p.endISO === '2025-10-09',
    p ? `${p.startISO} .. ${p.endISO}` : 'parse failed'
  );

  record(
    'toHistoryKey builds the canonical custom key',
    toHistoryKey('Custom: 10/01/25 - 10/15/25') === 'custom_20251001_20251015',
    toHistoryKey('Custom: 10/01/25 - 10/15/25')
  );

  // The actual fix: composition produces one point per day, inclusively.
  const days = {
    '2025-10-01': { e: 1.5, m: 120 },
    '2025-10-02': { e: '2.25', m: '60' },  // numeric strings, as RTDB really returns
    '2025-10-03': { e: 0, m: 0 }
  };
  const composed = composeCustomRange(days, parseCustomRange('10/01/25 - 10/03/25'));
  record(
    'Custom range composes one point per day, inclusive',
    composed.energy.length === 3 && composed.occupancy.length === 3,
    `points=${composed.energy.length} expected=3`
  );
  record(
    'Custom range coerces numeric strings and keeps 0 meaningful',
    composed.energy[1].kwh === 2.25 && composed.energy[2].kwh === 0,
    `day2=${composed.energy[1].kwh} day3=${composed.energy[2].kwh}`
  );
  record(
    'Custom range totals sum the span',
    Math.abs(composed.totals.energy - 3.75) < 1e-9 && Math.abs(composed.totals.hours - 3) < 1e-9,
    `energy=${composed.totals.energy} hours=${composed.totals.hours}`
  );

  // A day with no record must render as zero, not be skipped — skipping compresses the x-axis and
  // misaligns the occupancy overlay against the energy bars.
  const gapped = composeCustomRange({ '2025-10-01': { e: 1, m: 0 } }, parseCustomRange('10/01/25 - 10/04/25'));
  record(
    'Missing days render as zero rather than shortening the axis',
    gapped.energy.length === 4,
    `points=${gapped.energy.length} expected=4`
  );

  // Missing node entirely (a device that never published `days`) must not throw.
  const empty = composeCustomRange(null, parseCustomRange('10/01/25 - 10/04/25'));
  record(
    'Custom range handles an absent days node',
    empty.energy.length === 0 && empty.totals.energy === 0,
    'returns the empty shape, no throw'
  );

  // Retention cap: asking for more than the device keeps must not produce a mostly-zeros chart.
  const over = composeCustomRange(days, parseCustomRange('01/01/25 - 12/31/25'));
  record(
    'Custom range respects the 31-day retention cap',
    over.energy.length === 31,
    `points=${over.energy.length} capped=31`
  );

  // The hook must actually route custom ranges to the days node.
  record(
    'Hook reads history/days for custom ranges',
    /parseCustomRange\(timeRange\)/.test(hookSrc) && /custom \? 'days' : toHistoryKey/.test(hookSrc),
    'not the never-written custom_* key'
  );

  // And the firmware must publish that node.
  record(
    'Firmware publishes history/days for client-side composition',
    /publishDailyRecords\(\)/.test(fwSrc) && /history\/days/.test(fwSrc),
    'raw daily records available to the client'
  );
}

// 4. Firmware sensing window: the RMS reading must span a whole number of mains periods at BOTH
//    50 Hz and 60 Hz, or the reading is systematically low depending on start phase.
{
  const windowMatch = fwSrc.match(/#define\s+CURRENT_SAMPLE_MS\s+(\d+)UL/);
  const sampleMs = windowMatch ? Number(windowMatch[1]) : 0;
  const covers50 = sampleMs > 0 && (sampleMs % 20) === 0;  // 20 ms period at 50 Hz
  const atLeastTwoPeriods = sampleMs >= 40;
  record(
    'Firmware current-sampling window covers whole mains periods',
    covers50 && atLeastTwoPeriods,
    `window=${sampleMs}ms 50HzPeriods=${sampleMs / 20} ` +
      (covers50 && atLeastTwoPeriods ? '' : '*** reading is phase-dependent ***')
  );

  record(
    'Firmware sets ADC attenuation explicitly',
    /analogSetPinAttenuation\s*\(/.test(fwSrc) && /ADC_11db/.test(fwSrc),
    'insulation from a core-version default change'
  );

  record(
    'Firmware reads calibrated millivolts, not raw counts',
    /analogReadMilliVolts\s*\(/.test(fwSrc) && !/=\s*analogRead\s*\(/.test(fwSrc),
    'per-chip calibration curve applied'
  );

  // The shutdown decision must use a HIGHER threshold than the display filter. A false "no current"
  // cuts power to a load in use; a false "current present" merely leaves a port on.
  const displayFloor = Number((fwSrc.match(/CURRENT_NOISE_FLOOR_A\s+([\d.]+)f/) || [])[1] || 0);
  const shutdownFloor = Number((fwSrc.match(/CURRENT_ACTIVE_THRESHOLD_A\s+([\d.]+)f/) || [])[1] || 0);
  record(
    'Shutdown threshold is stricter than the display noise floor',
    shutdownFloor > displayFloor && displayFloor > 0,
    `display=${displayFloor}A shutdown=${shutdownFloor}A`
  );

  // Reboot must not undo a shutdown.
  record(
    'Firmware restores relay state across reboots',
    /persistRelayState\(\)/.test(fwSrc) && /readRelayBootMask\(\)/.test(fwSrc),
    'a reset cannot re-energise an empty room'
  );

  // And a Wi-Fi failure must not become a reboot loop. Comments are stripped first: the firmware
  // deliberately DOCUMENTS why it no longer calls ESP.restart() here, and a raw-text match would
  // read that explanation as a violation.
  const setupBody = stripComments(fwSrc.slice(fwSrc.indexOf('void setup()')));
  const wifiSection = setupBody.slice(0, setupBody.indexOf('macAddress = WiFi.macAddress'));
  record(
    'Firmware does not reboot-loop on Wi-Fi timeout',
    !/ESP\.restart\(\)/.test(wifiSection) && /WIFI_ATTEMPTS/.test(wifiSection),
    'captive portal stays reachable across retries'
  );
}

// 4a. HARDWARE BOM CONFORMANCE. The build is: ESP32 + HC-SR501 PIR + (mmWave radar, supported) +
//     3-ch relay + 3x ACS712 + 5 V supply. There is NO voltage sensor. BOM facts are enforced here
//     because earlier drafts assumed the opposite and the failures were silent.
{
  // The mmWave radar is a specified part of the design (dual PIR+mmWave occupancy module), so the
  // PIN must be a first-class, unconditionally-declared constant — not something that springs into
  // existence only when the gate is open. That is what lets it be wire-checked for collisions with
  // the relay/PIR/ADC1 pins and provisioned from the app. But the READ must stay compile-gated:
  // reading an unwired pin leaves it floating, floating-input noise OR-ed into `motionDetected`
  // pins the room permanently "occupied", and the smart shutdown never fires. So the two halves are
  // asserted separately: pin always present, read gated.
  const loopSrc2 = fwSrc.slice(fwSrc.indexOf('void loop()'));
  const mmWaveReadGated = /if\s*\(\s*mmwaveEnabled\s*\)\s*\{\s*motionDetected\s*=\s*motionDetected\s*\|\|\s*\(\s*digitalRead\s*\(\s*MMWAVE_PIN\s*\)\s*==\s*HIGH\s*\)\s*;\s*\}/.test(loopSrc2);
  record(
    'mmWave radar is supported with a declared pin and a gated read',
    /^#define\s+MMWAVE_PIN\s+\d+/m.test(fwSrc) &&            // pin declared unconditionally
      mmWaveReadGated &&                                       // the read only happens when enabled
      /OR the mmWave radar/.test(fwSrc) &&                    // dual-sensor intent is stated
      /pinMode\s*\(\s*MMWAVE_PIN\s*,\s*INPUT\s*\)/.test(fwSrc), // configured at boot
    'dual-sensor design; a floating pin cannot fake permanent occupancy'
  );

  // The PIR must still be read UNCONDITIONALLY — it is the primary sensor and the fail-safe.
  record(
    'PIR occupancy input is always read',
    /bool\s+motionDetected\s*=\s*digitalRead\s*\(\s*PIR_PIN\s*\)\s*==\s*HIGH/.test(loopSrc2),
    'HC-SR501 is the primary occupancy input'
  );

  // Current sensors MUST be on ADC1. ADC2 is unusable while Wi-Fi is up, so an ADC2 current pin
  // reads a permanent 0 A and every port looks unloaded.
  const adcPins = (fwSrc.match(/CURRENT_SENSOR_PINS\[NUM_PORTS\]\s*=\s*\{([^}]*)\}/) || [])[1] || '';
  const pins = adcPins.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  const adc1 = pins.length > 0 && pins.every((p) => p >= 32 && p <= 39); // GPIO 32-39 are ADC1
  record(
    'Current sensors are on ADC1 pins (usable while Wi-Fi is up)',
    adc1,
    adc1 ? `GPIO ${pins.join('/')} — ADC1` : `*** ${pins.join('/')} includes an ADC2 pin ***`
  );

  // The voltage caveat must be stated: the ACS712 cannot sense voltage, so "V" is configured.
  const vComment = fwSrc.slice(fwSrc.indexOf('// Voltage'), fwSrc.indexOf('const float VOLTAGE'));
  record(
    'Firmware documents that voltage is configured, not measured',
    /ACS712 CANNOT MEASURE VOLTAGE|cannot measure voltage/i.test(vComment),
    'the BOM overstates the sensor; the code is honest about it'
  );

  // The ACS712 sensitivity must be a named constant with its part variant, so a wrong part is a
  // one-line fix rather than a silent scale error.
  record(
    'ACS712 sensitivity is a named, variant-documented constant',
    /#define\s+ACS712_MV_PER_AMP\s+\d/.test(fwSrc) && /05B/.test(fwSrc),
    '185 mV/A default, with the 20 A / 30 A alternatives named'
  );
}

// 4b. P2-8 — one ADC sweep per loop iteration. The original loop swept the ADC on every consumer
//     (telemetry + shutdown), stalling the millis()-driven state machine. The fix is a cache; the
//     contract is that the shutdown decision and the telemetry path read the SAME cached value.
{
  // The NAME existing is not the contract — the CALL must sit inside loop(). A definition alone
  // would let the loop revert to per-consumer sweeps while the check stayed green.
  const loopBody = fwSrc.slice(fwSrc.indexOf('void loop()'));
  const cacheCalledInLoop = /^\s*refreshCurrentCache\(\);/m.test(loopBody);
  record(
    'Firmware caches one ADC sweep per loop iteration',
    /refreshCurrentCache\s*\(/.test(fwSrc) &&
      /currentCache\s*\[/.test(fwSrc) &&
      /currentAmpsFor\s*\(/.test(fwSrc) &&
      cacheCalledInLoop,
    cacheCalledInLoop ? 'telemetry and shutdown share one reading' : '*** cache defined but never refreshed in loop ***'
  );

  // The cache must be refreshed exactly once per loop, at the top, before the state machine reads it.
  const refreshIdx = loopBody.indexOf('refreshCurrentCache()');
  const stateIdx = loopBody.indexOf('// Update State Machine');
  record(
    'Cache is refreshed before the state machine consumes it',
    refreshIdx >= 0 && stateIdx > refreshIdx,
    refreshIdx >= 0 && stateIdx > refreshIdx ? 'ordering correct' : '*** stale cache read ***'
  );

  // The idle streak must be PER PORT. A shared counter let one idle port accumulate the streak for
  // an active one — a latent bug the cache refactor exposed.
  record(
    'Idle streak counter is per port',
    /currentIdleStreak\s*\[\s*NUM_PORTS\s*\]/.test(fwSrc),
    /currentIdleStreak\s*\[\s*NUM_PORTS\s*\]/.test(fwSrc)
      ? 'no cross-port bleed'
      : '*** shared counter mixes port states ***'
  );
}

// 4c. P2-6 — a pinned root can rotate, and the failure is otherwise indistinguishable from "no
//     network". The firmware must classify the failure at boot rather than going silently dark.
{
  // The CALL must exist in setup(), not just the definition — mirroring the cache lesson above.
  const sBody = fwSrc.slice(fwSrc.indexOf('void setup()'));
  const selfTestCalled = /^\s*runConnectivitySelfTest\(\);/m.test(sBody);
  record(
    'Firmware self-tests endpoint reachability at boot',
    /runConnectivitySelfTest\s*\(/.test(fwSrc) &&
      /probeEndpoint\s*\(/.test(fwSrc) &&
      selfTestCalled,
    selfTestCalled ? 'a dead endpoint is named, not guessed at' : '*** self-test defined but never run ***'
  );
  record(
    'Firmware distinguishes a TLS failure from a network failure',
    /looksLikeTlsFailure\s*\(/.test(fwSrc) &&
      /tlsFailed/.test(fwSrc) &&
      /ssl|tls/i.test(fwSrc.slice(fwSrc.indexOf('bool looksLikeTlsFailure'))),
    'certificate rotation is not mistaken for Wi-Fi trouble'
  );
  // The self-test must run before pairing/auth, or it cannot explain a pairing failure.
  record(
    'Connectivity self-test runs before Firebase auth',
    sBody.indexOf('runConnectivitySelfTest()') < sBody.indexOf('Firebase.begin('),
    'explains a failure before the first POST'
  );
  // The failure signatures must be documented where a maintainer will look.
  const alertComment = fwSrc.slice(0, fwSrc.indexOf('const char* ALERT_URL'));
  record(
    'ALERT_URL documents the delivery failure signatures',
    /401/.test(alertComment) && /SSL\/TLS handshake failed/.test(alertComment),
    'secret mismatch vs TLS vs network, named'
  );
}

// 4d. P2-7 — power is apparent (VA), not real (W). The UI must not claim watts, and the firmware's
//     voltage must be an overridable value rather than a constant baked into every calculation.
{
  const dashSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Dashboard.jsx'), 'utf8');
  // No bare "W" unit next to a power figure. The old UI printed `${x.toFixed(1)} W` and a "Watts"
  // label on the hero — both were false precision for a value with no voltage/power-factor sensing.
  const claimsWatts = /\}\s*W\s*</.test(dashSrc) || />\s*Watts\s*</.test(dashSrc);
  // The label must now FOLLOW the hardware rather than being hard-coded either way: VA by default
  // (honest for a device with no sensor), W only on the firmware's explicit "measured" signal.
  // Asserting a literal "VA" would pass on a device that measures voltage and is therefore showing
  // the wrong unit — the assertion has to test the CONDITIONAL, not one of its outcomes.
  const keysOffSource = /voltage_source\s*===\s*'measured'/.test(dashSrc);
  const unitIsConditional = /powerIsMeasured/.test(dashSrc) && /'W'\s*:\s*'VA'/.test(dashSrc);
  record(
    'Dashboard unit follows the device: W when measured, VA otherwise',
    keysOffSource && unitIsConditional && !claimsWatts,
    !keysOffSource
      ? '*** the unit is not keyed to voltage_source ***'
      : !unitIsConditional
        ? '*** W/VA is not conditional ***'
        : claimsWatts
          ? '*** still claims real watts unconditionally ***'
          : 'VA by default, W only when the device measures voltage'
  );

  record(
    'Firmware voltage is overridable, not a hardcoded literal in the maths',
    /supplyVoltage\s*\(/.test(fwSrc) &&
      /nominalVoltage/.test(fwSrc) &&
      /settings\/nominal_voltage/.test(fwSrc),
    'a measured supply can replace the 230 V default'
  );
  // Every power computation must go through the getter, never the raw constant.
  const telemetry = fwSrc.slice(fwSrc.indexOf('float totalAmps = 0'));
  const usesGetter = /currentAmps\s*\*\s*volts/.test(telemetry) && /const float volts = supplyVoltage\(\)/.test(telemetry);
  record(
    'Telemetry multiplies current by the resolved supply voltage',
    usesGetter,
    usesGetter ? 'one getter, no stray VOLTAGE literal' : '*** a path still uses the raw constant ***'
  );
  // The override must be clamped at EVERY entry point, or a typo corrupts every reading. Four sites
  // carry the 50–300 V range: the getter itself, the stream delta, the initial snapshot, and the
  // boot restore from NVS.
  const clampCount = (fwSrc.match(/50\.0f\s*&&\s*[\s\S]{0,60}?300\.0f/g) || []).length;
  record(
    'Voltage override is range-checked at every entry point',
    clampCount >= 4,
    `clamp sites=${clampCount} (getter, stream, snapshot, boot)`
  );
  record(
    'Voltage override survives a reboot (NVS-backed)',
    /setNvsString\("nominal_voltage"/.test(fwSrc) && /getNvsString\("nominal_voltage"\)/.test(fwSrc),
    'boot does not silently revert to 230 V'
  );
}

// 4d-ii. Voltage SENSING (HAS_VOLTAGE_SENSE) — the optional channel that turns VA into W.
//
// These assertions exist because the change is one `#define` away from being live, and the failure
// modes are all silent: a floating pin invents a voltage, an uncalibrated scale multiplies every
// wattage by a constant, and V_rms x I_rms looks exactly like real power until you compare it
// against a meter. Each is cheap to assert and expensive to discover in the field.
{
  // 1. The read must be COMPILE-GATED and ship closed — same reasoning as the mmWave radar. An
  //    unwired ADC pin floats, and here the noise would be multiplied into every current reading,
  //    producing confident fictional wattages. Assert the gate is commented out.
  const gateCommentedOut = /^\s*\/\/\s*#define HAS_VOLTAGE_SENSE/m.test(fwSrc);
  const gateUsed = /#ifdef HAS_VOLTAGE_SENSE/.test(fwSrc);
  record(
    'Voltage sensing ships CLOSED behind a compile gate',
    gateCommentedOut && gateUsed,
    gateCommentedOut
      ? 'gate commented out; a floating pin cannot invent a voltage'
      : '*** HAS_VOLTAGE_SENSE is ENABLED in the committed source ***'
  );

  // 2. The voltage pin must be ADC1. ADC2 is dead while Wi-Fi is up, and a dead voltage channel
  //    reads 0 V — which is worse than no sensor, because 0 V x any current is 0 W and every port
  //    would silently report no load.
  const vPinMatch = fwSrc.match(/#define\s+VOLTAGE_SENSE_PIN\s+(\d+)/);
  const vPin = vPinMatch ? Number(vPinMatch[1]) : -1;
  record(
    'Voltage-sense pin is on ADC1',
    vPin >= 32 && vPin <= 39,
    vPin < 0 ? '*** VOLTAGE_SENSE_PIN not declared ***' : `GPIO ${vPin} ${vPin >= 32 && vPin <= 39 ? '(ADC1)' : '*** NOT ADC1 ***'}`
  );

  // 3. It must not collide with any pin already in use. GPIO 33 was chosen because 34/35/32 are the
  //    current sensors; a collision would silently break whichever channel lost.
  const usedPins = [];
  for (const m of fwSrc.matchAll(/RELAY_PINS\[NUM_PORTS\]\s*=\s*\{([^}]*)\}/g)) {
    usedPins.push(...m[1].split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)));
  }
  for (const m of fwSrc.matchAll(/CURRENT_SENSOR_PINS\[NUM_PORTS\]\s*=\s*\{([^}]*)\}/g)) {
    usedPins.push(...m[1].split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)));
  }
  for (const m of fwSrc.matchAll(/#define\s+(?:PIR_PIN|MMWAVE_PIN)\s+(\d+)/g)) usedPins.push(Number(m[1]));
  record(
    'Voltage-sense pin collides with no other configured pin',
    vPin > 0 && !usedPins.includes(vPin),
    `in use: [${usedPins.join(',')}] — voltage pin ${vPin}`
  );

  // 4. REAL power must come from the sample-by-sample product. This is the assertion that actually
  //    matters: `V_rms * I_rms` is apparent power and would look right while being wrong by the
  //    power factor. Require the sum-of-products accumulator AND its use in the watts line.
  const hasProductSum = /sumVI\s*\+=/.test(fwSrc);
  const wattsFromProduct = /watts\s*=\s*product_mVmV\s*\//.test(fwSrc);
  record(
    'Real power comes from the instantaneous product, not RMS multiplication',
    hasProductSum && wattsFromProduct,
    hasProductSum && wattsFromProduct
      ? 'mean(v*i) — phase-correct, so VA becomes W'
      : `*** sumVI=${hasProductSum} wattsFromProduct=${wattsFromProduct} — this would report VA as W ***`
  );

  // 5. DC bias must be removed BEFORE the product. Both sensors idle at a DC offset; without this
  //    the product carries a spurious DC term that inflates every wattage. The peak-to-peak path
  //    never needed it (a difference cancels any offset), which is exactly why it is easy to omit.
  const hasBias = /biasV/.test(fwSrc) && /biasI/.test(fwSrc);
  const biasUsedInProduct = /\(\s*int32_t\s*\)\s*powerSampV\[k\]\s*-\s*biasV/.test(fwSrc);
  record(
    'DC bias is removed before the product',
    hasBias && biasUsedInProduct,
    hasBias && biasUsedInProduct ? 'offset subtracted per channel' : '*** a DC term would inflate the watts ***'
  );

  // 6. Power factor must be derived AND bounded. Derived because it is not a sensor; bounded
  //    because it is a ratio of two noisy quantities, and a near-zero VA would otherwise produce a
  //    meaningless value or a divide-by-zero.
  const pfDerived = /out\.pf\s*=\s*\(va\s*>\s*0\.01f\)/.test(fwSrc);
  const pfBounded = /if\s*\(\s*out\.pf\s*>\s*1\.0f\s*\)\s*out\.pf\s*=\s*1\.0f/.test(fwSrc);
  record(
    'Power factor is derived from W/VA and bounded',
    pfDerived && pfBounded,
    `derived=${pfDerived} bounded=${pfBounded}`
  );

  // 7. The calibration constant DIVIDES into every voltage reading, so an unbounded value would
  //    scale the whole system. A typo of 460 instead of 4.6 would divide by 100 and every wattage
  //    with it — plausible numbers, all wrong.
  const calBounded = /cal\s*>=\s*1\.0f\s*&&\s*cal\s*<=\s*20\.0f/.test(fwSrc);
  record(
    'Voltage calibration is range-bounded and runtime-adjustable',
    calBounded && /settings\/voltage_cal_mv_per_v/.test(fwSrc),
    calBounded ? '1-20 mV/V; calibratable without a reflash' : '*** an unbounded divisor scales every reading ***'
  );

  // 8. The telemetry must SAY whether the power figure is measured or assumed. The app switches its
  //    unit label on this, so a device with no sensor can never present VA as watts.
  //
  //    COMMENTS MUST BE STRIPPED. This block's own explanatory prose contains the word
  //    `voltage_source`, so an unstripped search is satisfied by the COMMENT explaining the field
  //    rather than by the field itself — and the assertion survives deleting the very line it
  //    exists to protect. (That is not hypothetical: it is what the first mutation run did.)
  const telemetryCode = fwSrc
    .slice(fwSrc.indexOf('float totalAmps = 0'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  record(
    'Telemetry declares whether the voltage is measured or configured',
    /json\.set\(\s*"voltage_source"/.test(telemetryCode) &&
      /voltageIsMeasured\s*\(\s*\)/.test(telemetryCode),
    'the app switches its unit label on this, so VA is never shown as W'
  );

  // 9. The per-port power path must not stall the loop: the voltage-only refresh is rate-limited,
  //    because a sampling pass is ~100 ms of blocking ADC work and the occupancy state machine is
  //    driven by millis().
  record(
    'Voltage-only sampling is rate-limited so it cannot stall the loop',
    /VOLTAGE_ONLY_MIN_INTERVAL_MS/.test(fwSrc) &&
      /millis\(\)\s*-\s*lastVoltageSampleMs\)\s*<\s*VOLTAGE_ONLY_MIN_INTERVAL_MS/.test(fwSrc),
    'a timestamp compare in the common case'
  );
}

// 4e. P3 — hygiene regressions that are cheap to lock down.
{
  // P3-3: the icon preview must not be written into the repo root again.
  const iconSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-icons.mjs'), 'utf8');
  record(
    'Icon preview is written outside the repo root',
    /PREVIEW_DIR/.test(iconSrc) && !/path\.join\(ROOT,\s*'icon-preview\.png'\)/.test(iconSrc),
    'no build artifact in the project root'
  );

  // P3-5: the fast-refresh warning came from a module exporting both a component and a hook.
  // Comments are stripped: the provider file legitimately MENTIONS the hook's new location.
  const ctxSrc = stripComments(
    fs.readFileSync(path.join(ROOT, 'src', 'contexts', 'DeviceContext.jsx'), 'utf8')
  );
  const coreSrc = fs.existsSync(path.join(ROOT, 'src', 'contexts', 'deviceContextCore.js'))
    ? fs.readFileSync(path.join(ROOT, 'src', 'contexts', 'deviceContextCore.js'), 'utf8')
    : '';
  record(
    'DeviceContext split keeps the component and hook in separate modules',
    !/function\s+useDeviceContext|const\s+useDeviceContext/.test(ctxSrc) &&
      /const\s+useDeviceContext/.test(coreSrc),
    'react-refresh/only-export-components satisfied'
  );

  // P3-4: the docs must not claim `scoped` is the active ruleset. Assert the sentence that makes the
  // claim names `deviceuid` and NOT `scoped` — proximity alone is too weak, because the surrounding
  // prose mentions both variants.
  const docSrc = fs.existsSync(path.join(ROOT, 'docs', 'device-auth.md'))
    ? fs.readFileSync(path.join(ROOT, 'docs', 'device-auth.md'), 'utf8')
    : '';
  const claimIdx = docSrc.search(/is the active ruleset/i);
  const claimSentence = claimIdx >= 0 ? docSrc.slice(claimIdx - 60, claimIdx + 20) : '';
  record(
    'device-auth.md states the active ruleset is deviceuid',
    claimIdx >= 0 && /deviceuid/i.test(claimSentence) && !/scoped/i.test(claimSentence),
    claimIdx >= 0 ? 'stale "scoped is active" claim removed' : '*** no active-ruleset statement ***'
  );
}

// 4f. The alert read marker is three-state. A plain null cannot distinguish "loading" from "nothing
//     read yet", which made every session report a full unread badge on first paint.
{
  const hookSrc = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useAlerts.js'), 'utf8');
  const threeState = /useState\(undefined\)/.test(hookSrc) && /markerLoading/.test(hookSrc);
  record(
    'Alert read marker distinguishes loading from absent',
    threeState,
    threeState ? 'undefined = loading, null = absent' : '*** badge flashes unread on every open ***'
  );

  // markAllSeen must not stamp "read" before the marker has resolved, or it discards alerts the
  // user never saw.
  const guardBeforeStamp = /if \(markerLoading\) return false;/.test(hookSrc);
  record(
    'markAllSeen waits for the read marker before writing',
    guardBeforeStamp,
    guardBeforeStamp ? 'no unread alerts silently discarded' : '*** marks unread alerts as read ***'
  );

  // Every consumer of lastSeenId must handle the third state.
  const consumers = [
    ['src/components/AlertCatchUp.jsx', /lastSeenId === undefined/],
    ['src/pages/Alerts.jsx', /lastSeenId !== undefined/]
  ];
  const unhandled = consumers
    .filter(([f, re]) => {
      const p = path.join(ROOT, f);
      return fs.existsSync(p) && !re.test(fs.readFileSync(p, 'utf8'));
    })
    .map(([f]) => f);
  record(
    'All lastSeenId consumers handle the loading state',
    unhandled.length === 0,
    unhandled.length ? `unhandled in ${unhandled.join(', ')}` : 'AlertCatchUp + Alerts'
  );
}

// 4g. The AlertCatchUp component must never announce while the marker is loading.
{
  const p = path.join(ROOT, 'src', 'components', 'AlertCatchUp.jsx');
  if (fs.existsSync(p)) {
    const src = fs.readFileSync(p, 'utf8');
    const guarded =
      /if \(lastSeenId === undefined\) return;/.test(src) ||
      /lastSeenId === undefined/.test(src);
    record(
      'Catch-up notifier does not announce during marker loading',
      guarded,
      guarded ? 'waits for a real read marker' : '*** announces whole history on every open ***'
    );
  }
}

// 4h. The task watchdog must actually bound the loop — and the ORDER of the feed matters.
{
  const cfgCall = /esp_task_wdt_config_t/.test(fwSrc) && /esp_task_wdt_init\s*\(/.test(fwSrc);
  const subscribed = /esp_task_wdt_add\s*\(\s*NULL\s*\)/.test(fwSrc); // NULL = watch loopTask
  const armed = /^\s*watchdogInit\(\);/m.test(fwSrc);                 // and it is actually called
  record(
    'Firmware arms a task watchdog on the main loop',
    cfgCall && subscribed && armed,
    'a hang resets the device instead of freezing it forever'
  );

  // The loop must FEED it. A configured-but-unfed watchdog resets a perfectly healthy device every
  // timeout — strictly worse than having none, and the boot loop looks like a power fault.
  const loopBody = fwSrc.slice(fwSrc.indexOf('void loop()'));
  const feedsInLoop = (loopBody.match(/watchdogFeed\s*\(\s*\)\s*;/g) || []).length;
  record(
    'Loop task feeds the watchdog',
    feedsInLoop >= 2,
    `resets found: ${feedsInLoop}`
  );

  // ORDER IS THE WHOLE POINT. The feed must come BEFORE the blocking call, so the timeout is
  // charged to that call. A feed placed *after* it does nothing when the call never returns — the
  // exact failure this guard exists to catch. Asserted as "a feed appears within the 200 chars
  // preceding each Firebase call", not merely that feeds exist somewhere.
  //
  // Scanned over the WHOLE FILE, not just the `loop()` body. A blocking call added inside a helper
  // is exactly as capable of hanging the loop, and an earlier version of this check sliced from
  // `void loop()` — so the call added to `checkOvercurrent()` was invisible to it. Coverage that
  // silently excludes new code is worse than none, because it reads as verified.
  const fwCodeForOrder = stripComments(fwSrc);
  const fbCalls = fwCodeForOrder.match(/[\s\S]{200}Firebase\.RTDB\.updateNode/g) || [];
  const fedBeforeEach = fbCalls.length > 0 &&
    fbCalls.every((s) => /watchdogFeed\s*\(\s*\)\s*;/.test(s));
  record(
    'Watchdog is fed BEFORE every blocking Firebase call, not after',
    fedBeforeEach,
    fedBeforeEach
      ? `${fbCalls.length}/${fbCalls.length} call sites pre-fed (whole file)`
      : '*** a hung call would starve the timer and never reset ***'
  );

  // A deliberate long wait must not reboot the device. The rule is not "no delay() may exist" —
  // many short delays are fine and clearer than slicing — it is that no wait may EXCEED the
  // timeout without feeding. Two shapes violate that: a bare delay() longer than the timeout, and
  // an intentionally-infinite loop that never feeds (which the watchdog would reset every cycle,
  // defeating whatever the loop is waiting for).
  const timeoutSec = Number((fwSrc.match(/#define\s+WDT_TIMEOUT_SECONDS\s+(\d+)/) || [])[1] || 0);
  // Scan CODE, not comments. The comments deliberately name the bad patterns (`a bare delay(65000)`)
  // to explain why they were changed, and matching those would flag the explanation as the bug.
  const fwCode = stripComments(fwSrc);
  const rawDelays = [...fwCode.matchAll(/delay\s*\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
  const exceedsTimeout = rawDelays.filter((ms) => ms > timeoutSec * 1000);
  // Infinite `for (;;)` loops must contain a feed.
  const infiniteLoops = [...fwCode.matchAll(/for\s*\(\s*;\s*;\s*\)\s*\{([\s\S]{0,300}?)\}/g)].map((m) => m[1]);
  const unfedInfiniteLoops = infiniteLoops.filter((body) => !/watchdogFeed\s*\(\s*\)/.test(body));
  const longWaitsFed =
    timeoutSec > 0 &&
    exceedsTimeout.length === 0 &&
    unfedInfiniteLoops.length === 0 &&
    /void waitWithWatchdog\s*\(/.test(fwSrc);
  record(
    'No wait can outlive the watchdog without feeding it',
    longWaitsFed,
    longWaitsFed
      ? `timeout ${timeoutSec}s; max raw delay ${Math.max(0, ...rawDelays)}ms; ${infiniteLoops.length} infinite loop(s) all fed`
      : `*** timeout ${timeoutSec}s; over-long delays: [${exceedsTimeout.join(', ')}]; unfed infinite loops: ${unfedInfiniteLoops.length} ***`
  );
}

// 4i. Soft overcurrent cutoff. The properties that matter are not "a threshold exists" but:
//     the limit is range-checked at EVERY entry point, the trip is debounced (or inrush false-trips
//     every motor start), its streak is separate from the idle streak (sharing one makes both
//     count the other's progress), the relay opens on trip, and the code states its own limits.
//
//     NOTE ON SLICING: `fwSrc.indexOf('void checkOvercurrent')` finds the FORWARD DECLARATION
//     (`void checkOvercurrent();`), not the body — the same trap already hit once with `void loop()`.
//     Match the body by its opening brace: `'void checkOvercurrent() {'`.
{
  const ocCode = stripComments(fwSrc);
  const ocBodyStart = ocCode.indexOf('void checkOvercurrent() {');
  const ocBody = ocBodyStart >= 0 ? ocCode.slice(ocBodyStart, ocBodyStart + 1400) : '';

  // The trip must require the overload to PERSIST. A bare `amps > limit` compare would cut power on
  // every compressor inrush — switching off a fridge that was working correctly.
  const debounced = /OVERCURRENT_TRIP_SAMPLES/.test(ocCode) &&
    /overcurrentStreak\s*\[\s*port\s*\]\s*\+\+/.test(ocCode) &&
    /overcurrentStreak\s*\[\s*port\s*\]\s*<\s*OVERCURRENT_TRIP_SAMPLES/.test(ocCode);
  record(
    'Overcurrent trip is debounced, not instantaneous',
    debounced,
    'inrush on a motor start cannot false-trip a healthy port'
  );

  // A SEPARATE streak. Sharing `currentIdleStreak` would have the idle check (which resets on high
  // current) and the overcurrent check (which counts high current) continuously reset each other,
  // so neither would ever reach its threshold.
  const separateStreak = /int\s+overcurrentStreak\s*\[/.test(ocCode) &&
    /int\s+currentIdleStreak\s*\[/.test(ocCode) &&
    !/overcurrentShouldTrip[\s\S]{0,600}?currentIdleStreak/.test(ocCode);
  record(
    'Overcurrent uses its own per-port streak, not the idle streak',
    separateStreak,
    'the two counters observe opposite conditions and would cancel out'
  );

  // The relay must actually open, and the trip must FORCE the switch. Both properties live in the
  // body, so this is scoped to `ocBody` — a whole-file search would pass on any of the other four
  // runRelaySwitch call sites. If the trip went through the derating rules instead, a fault on a port
  // that had just switched would be refused a cutoff: a dwell lock protecting a relay at the cost of
  // the wiring it exists to protect. That is the single most dangerous way to get 4j wrong.
  const tripForces = /runRelaySwitch\s*\(\s*i\s*,\s*false\s*,\s*(?:\/\*force=\*\/)?\s*true\s*\)/.test(ocBody);
  record(
    'Overcurrent trip opens the relay, bypassing the derating rules',
    tripForces,
    'a safety cutoff must never be rate-limited — force=true is load-bearing'
  );

  // Range-checked at every entry point — mirroring nominal_voltage's four clamp sites, because a
  // limit above the sensor's range would silently never fire and would read as protection that is
  // not present. Counted, not merely present: `.test()` is satisfied by the first occurrence, which
  // is the mistake already made once with the voltage clamps.
  const saneCalls = (ocCode.match(/overcurrentLimitIsSane\s*\(/g) || []).length;
  const saneGuardDefined = /bool\s+overcurrentLimitIsSane\s*\(/.test(ocCode) &&
    /v\s*>=\s*0\.5f\s*&&\s*v\s*<=\s*5\.0f/.test(ocCode);
  record(
    'Overcurrent limit is range-checked at every entry point',
    saneGuardDefined && saneCalls >= 4,
    `guard definition + ${saneCalls} call sites (need >= 4: stream, snapshot, boot, trip)`
  );

  // The code must SAY it is not a fuse. The whole risk of shipping this is that its presence reads
  // as protection; that claim has to be contradicted IN THE OVERCURRENT SECTION, not merely
  // somewhere in the file. Scoping matters: the header also calls it "not a fuse" in passing, so a
  // file-wide search passes even if the section's own warning is deleted — which is how the first
  // version of this check survived its mutation test.
  const ocSectionStart = fwSrc.indexOf('Soft overcurrent cutoff');
  const ocSection = ocSectionStart >= 0 ? fwSrc.slice(ocSectionStart, ocSectionStart + 2200) : '';
  const statesLimit = /NOT a fuse/i.test(ocSection) &&
    /saturat/i.test(ocSection) &&
    /fuse or MCB|fuse or breaker|hardware list/i.test(ocSection);
  record(
    'Overcurrent section states it is not a fuse and why',
    statesLimit,
    statesLimit
      ? 'saturation limit + relay caveat + fuse still required'
      : '*** the section must not read as protection it cannot provide ***'
  );
}

// 4j. Relay derating. The relay is the only MECHANICAL part and is rated for a small number of
//     operations, so the properties that matter are: every relay write funnels through ONE choke
//     point (or a new call site silently bypasses the rules), the guard is per-port (port 1 must not
//     lock port 2), it has BOTH a dwell and a rolling-window rate cap (dwell alone allows a flip
//     every 2 s forever), and a rejected command is repaired in the DB rather than silently dropped
//     (the app writes optimistically, so a dropped command leaves the UI lying about the hardware).
{
  const derateCode = stripComments(fwSrc);

  // ONE choke point: exactly one raw digitalWrite to a relay pin may exist in the whole file, and it
  // must be inside the runRelaySwitch DEFINITION. Any second one is a bypass — the precise failure
  // this guards. Anchor on the definition (its opening brace), not the forward declaration: a
  // `RelaySwitchResult runRelaySwitch...` search matches the prototype first and finds no body.
  const rawRelayWrites = (derateCode.match(/digitalWrite\s*\(\s*RELAY_PINS\s*\[/g) || []).length;
  const switchDefStart = derateCode.search(/RelaySwitchResult\s+runRelaySwitch\s*\([^)]*\)\s*\{/);
  const switchBody = switchDefStart >= 0 ? derateCode.slice(switchDefStart, switchDefStart + 900) : '';
  const writeIsChoked = /digitalWrite\s*\(\s*RELAY_PINS\s*\[/.test(switchBody);
  record(
    'Every relay write funnels through one choke point',
    rawRelayWrites === 1 && writeIsChoked,
    `raw writes to a relay pin: ${rawRelayWrites} (must be exactly 1, inside runRelaySwitch)`
  );

  // The guard is PER PORT. A single shared timestamp would let a busy port lock out an idle one.
  const perPortState = /relayLastSwitchMs\s*\[\s*NUM_PORTS\s*\]/.test(derateCode) &&
    /relaySwitchTimes\s*\[\s*NUM_PORTS\s*\]\s*\[\s*RELAY_MAX_SWITCHES\s*\]/.test(derateCode);
  record(
    'Relay derating state is per-port, not global',
    perPortState,
    'toggling one port must not block another'
  );

  // BOTH rules must exist AND both must be ENFORCED. Presence alone is not enough: an earlier version
  // of this check only looked for the macro names and the ring-buffer array, so replacing the actual
  // decision (`return inWindow < RELAY_MAX_SWITCHES`) with `return true` left the check green while
  // the cap did nothing. That is the "a NAME match is not a CALL" trap. The dwell rule and the rate
  // rule must each have a construct that can actually return false.
  const dwellEnforced = /RELAY_MIN_DWELL_MS/.test(derateCode) &&
    /relayLastSwitchMs\s*\[\s*port\s*\]/.test(derateCode) &&
    /relayLastSwitchMs\s*\[\s*port\s*\]\s*\)\s*<\s*RELAY_MIN_DWELL_MS/.test(derateCode);
  const rateEnforced = /RELAY_RATE_WINDOW_MS/.test(derateCode) &&
    /RELAY_MAX_SWITCHES/.test(derateCode) &&
    /relaySwitchTimes\s*\[\s*port\s*\]/.test(derateCode) &&
    /return\s+inWindow\s*<\s*RELAY_MAX_SWITCHES\s*;/.test(derateCode);
  record(
    'Relay derating enforces BOTH a dwell time and a rolling-window rate cap',
    dwellEnforced && rateEnforced,
    dwellEnforced && rateEnforced
      ? 'dwell returns false on a recent switch; rate cap returns inWindow < RELAY_MAX_SWITCHES'
      : `dwell enforced=${dwellEnforced}, rate enforced=${rateEnforced} — presence of the macros is not enforcement`
  );

  // A suppressed command must be repaired in the DB. The app writes the intended state BEFORE the
  // device sees it, so a silently dropped command leaves the toggle showing a state the relay is not
  // in. The device must write the ACTUAL state back.
  const repairsOnSuppress = /RELAY_SUPPRESSED/.test(derateCode) &&
    /runRelaySwitchAndSync[\s\S]{0,900}?RELAY_SUPPRESSED[\s\S]{0,600}?setBoolAsync/.test(derateCode);
  record(
    'A derating rejection is reported back to the database, not silently dropped',
    repairsOnSuppress,
    'the app toggles optimistically; without a repair the UI lies about the hardware'
  );

  // The stream handlers are the path a toggle actually takes — they must use the syncing wrapper,
  // not the bare switch.
  const handlersSync = (derateCode.match(/runRelaySwitchAndSync\s*\(\s*[012]\s*,/g) || []).length;
  record(
    'The three app-facing toggle handlers go through the syncing wrapper',
    handlersSync === 3,
    `handlers using runRelaySwitchAndSync: ${handlersSync} (need 3, one per port)`
  );

  // A no-op must not spend an operation. If runRelaySwitch wrote unconditionally, merely re-asserting
  // the current state (which the snapshot and stream both do) would count as a switch.
  const noopExit = /bool\s+current\s*=\s*digitalRead\s*\(\s*RELAY_PINS\s*\[\s*port\s*\]\s*\)[\s\S]{0,200}?if\s*\(\s*current\s*==\s*on\s*\)\s*return\s+RELAY_NOOP/.test(derateCode);
  record(
    'A no-op relay command does not spend an operation',
    noopExit,
    're-asserting the current state (snapshot/stream do this) must not count as a switch'
  );
}



// Firmware must never hardcode the per-device credentials in a way that ships one key for everyone.
// (`fwSrc` is read near the top of the alert section.)
record(
  'Firmware pairs itself over the air',
  /pairDevice\(\)/.test(fwSrc) && /PAIR_URL/.test(fwSrc),
  'no USB cable needed for a fresh unit'
);
record(
  'Firmware has a factory reset for re-pairing',
  /factoryResetIfRequested/.test(fwSrc),
  'returns / re-homing is possible without a reflash'
);
record(
  'Firmware keeps USB provisioning as the higher priority',
  /deviceEmail\.length\(\) == 0 && deviceIdToken\.length\(\) == 0/.test(fwSrc),
  'a hand-provisioned bench unit is never overwritten by pairing'
);

// ---------------------------------------------------------------------------
// Tooling: the type-check + CI gate must actually exist and be wired in.
//
// These checks are about the GATE, not the app. A gate that is not wired into `verify` (or a CI
// workflow that does not run it) silently stops protecting anything the moment someone stops running
// the command by hand — which is exactly how the harness itself once passed 36/36 with two P0s live.
// ---------------------------------------------------------------------------
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};

  // The type-check command must exist as its own script (so it can be run alone) ...
  record(
    'package.json exposes a typecheck script',
    typeof scripts.typecheck === 'string' && /tsc\s+--noEmit/.test(scripts.typecheck),
    scripts.typecheck ? `typecheck = "${scripts.typecheck}"` : 'script missing'
  );

  // ... AND must be part of the full gate. A script nobody runs is decoration.
  record(
    'typecheck is wired into the npm run verify gate',
    typeof scripts.verify === 'string' && /typecheck/.test(scripts.verify),
    scripts.verify ? 'verify runs typecheck' : 'verify is missing typecheck'
  );

  // tsconfig must actually type-check JS rather than existing only to satisfy an editor. Both flags
  // are required: `allowJs` lets tsc read the files, `checkJs` makes it report on them. With only
  // `allowJs` the command exits 0 forever and is worse than no gate — it looks green while checking
  // nothing.
  const tsconfigPath = path.join(ROOT, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    record('tsconfig.json type-checks the JS sources', false, 'tsconfig.json missing');
  } else {
    let ts = null;
    try {
      ts = JSON.parse(
        fs.readFileSync(tsconfigPath, 'utf8').replace(/^\s*\/\/.*$/gm, '')
      );
    } catch (e) {
      record('tsconfig.json type-checks the JS sources', false, `invalid JSON: ${e.message}`);
    }
    if (ts) {
      const o = ts.compilerOptions || {};
      record(
        'tsconfig.json type-checks the JS sources',
        o.allowJs === true && o.checkJs === true && o.noEmit === true,
        `allowJs=${o.allowJs} checkJs=${o.checkJs} noEmit=${o.noEmit}`
      );
      // The ambient .d.ts files are NOT captured by a `src/**/*.js` glob. Omitting them makes the
      // iOS `navigator.standalone` declaration silently invisible.
      const inc = Array.isArray(ts.include) ? ts.include.join(' ') : '';
      record(
        'tsconfig includes the ambient .d.ts declarations',
        /\.d\.ts/.test(inc),
        inc ? `include = ${inc}` : 'no include array'
      );
    }
  }

  // The declared ambient types must be load-bearing: if `navigator.standalone` is used in the app,
  // its declaration has to exist, or the type-check above only passes because the file is excluded.
  const loginSrc = fs.existsSync(path.join(ROOT, 'src/pages/Login.jsx'))
    ? fs.readFileSync(path.join(ROOT, 'src/pages/Login.jsx'), 'utf8')
    : '';
  const browserTypesPath = path.join(ROOT, 'src/types/browser.d.ts');
  const usesIosStandalone = /navigator\.standalone/.test(loginSrc);
  const declaresIosStandalone = fs.existsSync(browserTypesPath) &&
    /standalone\??:\s*boolean/.test(fs.readFileSync(browserTypesPath, 'utf8'));
  record(
    'A used non-standard browser API has an ambient declaration',
    !usesIosStandalone || declaresIosStandalone,
    usesIosStandalone
      ? (declaresIosStandalone ? 'navigator.standalone declared in src/types/browser.d.ts' : '*** used but undeclared ***')
      : 'not used'
  );

  // The CI workflow must exist and run the SAME gate. Checked by content, because a workflow that
  // runs only `npm test` would look present while letting a type error through.
  const wfPath = path.join(ROOT, '.github/workflows/verify.yml');
  if (!fs.existsSync(wfPath)) {
    record('Hosted CI runs the full gate', false, '.github/workflows/verify.yml missing');
  } else {
    const wf = fs.readFileSync(wfPath, 'utf8');
    const runsTypecheck = /npm run typecheck/.test(wf);
    const runsHarness = /npm run test:integration/.test(wf);
    const runsBuild = /npm run build/.test(wf);
    record(
      'Hosted CI runs the full gate',
      runsTypecheck && runsHarness && runsBuild,
      `typecheck=${runsTypecheck} build=${runsBuild} harness=${runsHarness}`
    );
  }

  // The harness itself must be able to run on Linux. It originally hardcoded Windows paths, which
  // made the CI job above fail immediately with ENOENT — a workflow that cannot execute is worse
  // than none, because it reads as coverage.
  //
  // SCOPE MATTERS HERE. Searching the whole file for `chromium.executablePath()` is useless: the
  // description string of THIS very check contains that text, so the assertion would be satisfied by
  // its own message and could never fail. (That is exactly what happened on the first mutation test —
  // it SURVIVED.) Slice to the CHROME resolver, the only region that decides the browser path.
  const selfSrc = fs.readFileSync(path.join(ROOT, 'verify-fixes.mjs'), 'utf8');
  const chromeStart = selfSrc.indexOf('const CHROME = (() =>');
  const chromeBlock = chromeStart >= 0 ? selfSrc.slice(chromeStart, chromeStart + 1400) : '';
  const usesPlaywrightResolution = /chromium\.executablePath\(\)/.test(chromeBlock);
  const hasPosixRoot = /\.cache\/ms-playwright|Library\/Caches\/ms-playwright|PLAYWRIGHT_BROWSERS_PATH/.test(chromeBlock);
  const hasLinuxBinary = /chrome-linux/.test(chromeBlock);
  record(
    'The integration harness resolves Chromium on Linux as well as Windows',
    chromeBlock.length > 0 && usesPlaywrightResolution && hasPosixRoot && hasLinuxBinary,
    chromeBlock.length === 0
      ? '*** CHROME resolver not found ***'
      : `executablePath=${usesPlaywrightResolution} posixRoot=${hasPosixRoot} linuxBinary=${hasLinuxBinary}`
  );
}

/**
 * Slice one balanced-brace block out of a source string, starting at the opening `{`.
 *
 * Brace counting rather than a fixed width: these blocks carry comments whose length changes, so a
 * hardcoded slice either truncates mid-block (asserting against a fragment) or runs past the end
 * into neighbouring code (letting an unrelated `outcome:` satisfy a scoped check).
 */
const alertStartEnd = (src, from) => {
  const open = src.indexOf('{', from);
  if (open < 0) return from;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
};

// ---------------------------------------------------------------------------
// Alert outcome contract
// ---------------------------------------------------------------------------
// The history entry used to be built with `outcome: 'pending'` and only overwritten on the paths
// that got that far. The client's OUTCOME map has no `pending` key, so such a row would render the
// grey "Recorded" badge — presenting a delivery that never happened as a completed one. No path
// could produce it at the time, which is exactly why it survived: the fix is to make the state
// impossible rather than merely unreachable.
{
  const alertSrc = fs.readFileSync(path.join(ROOT, 'api', 'alert.js'), 'utf8');

  // SCOPE: only the region that builds the entry. Searching the whole file finds the comment
  // explaining why `pending` was removed, which would satisfy a naive `!/pending/` test forever.
  const entryStart = alertSrc.indexOf('const entry = {');
  const entryBlock = entryStart >= 0 ? alertSrc.slice(entryStart, alertStartEnd(alertSrc, entryStart)) : '';
  // Comments must not be able to satisfy or defeat this: strip them before testing.
  const entryCode = entryBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  record(
    'History entry is built without an `outcome` placeholder',
    entryBlock.length > 0 && !/outcome\s*:/.test(entryCode),
    entryBlock.length === 0 ? '*** entry block not found ***' : 'no outcome key in the literal'
  );

  // Every write must supply a real outcome. Count recordAlert call sites and assert each carries
  // one, so adding a new call site without an outcome fails the gate instead of falling back.
  const callSites = [...alertSrc.matchAll(/recordAlert\(db,\s*mac,\s*(\{[\s\S]*?\})\s*\)/g)];
  // Accept both `outcome: 'sent'` and the shorthand `outcome,` — the success path passes the local
  // variable by name. Matching only the colon form would miss a perfectly valid write.
  const sitesWithOutcome = callSites.filter((m) => /\boutcome\s*[:,]/.test(m[1]));
  record(
    'Every recorded alert carries a resolved outcome',
    callSites.length > 0 && callSites.length === sitesWithOutcome.length,
    `${sitesWithOutcome.length}/${callSites.length} call sites set an outcome`
  );

  // The client must be able to render every outcome the server can store. A gap here is invisible
  // until it happens, and it degrades to a badge that misrepresents the event.
  const alertsSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Alerts.jsx'), 'utf8');
  const mapStart = alertsSrc.indexOf('const OUTCOME = {');
  const mapBlock = mapStart >= 0 ? alertsSrc.slice(mapStart, mapStart + 900) : '';
  const clientOutcomes = [...mapBlock.matchAll(/^\s{2}([a-z]+):\s*\{/gm)].map((m) => m[1]);
  const serverOutcomes = [...new Set(
    [...alertSrc.matchAll(/outcome:\s*'([a-z]+)'/g)].map((m) => m[1])
      .concat([...alertSrc.matchAll(/\?\s*'([a-z]+)'\s*:\s*'([a-z]+)'/g)].flatMap((m) => [m[1], m[2]]))
  )].filter((o) => o !== 'unknown');
  const renderable = serverOutcomes.filter((o) => clientOutcomes.includes(o));
  record(
    'Client can render every outcome the server can store',
    mapBlock.length > 0 && serverOutcomes.length > 0 && renderable.length === serverOutcomes.length,
    `server=[${serverOutcomes}] client=[${clientOutcomes}] unmatched=[${serverOutcomes.filter((o) => !clientOutcomes.includes(o))}]`
  );
}

// ---------------------------------------------------------------------------
// Write failures reach the user
// ---------------------------------------------------------------------------
// The hook used to catch every error and log it, so a rejected write looked exactly like a slow
// one. On the countdown banner that mattered most: "Keep Power On" could fail and the room would
// power down anyway, with the button looking like it had worked.
{
  const hookSrc = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useRoomData.js'), 'utf8');
  const dashSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Dashboard.jsx'), 'utf8');

  // Strip comments: the prose explaining this rule mentions the very strings being asserted.
  const hookCode = hookSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const dashCode = dashSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Every catch in the hook must report failure back to its caller, not just log it.
  //
  // BALANCED BRACES, not a lazy regex. Several of these catches log a template literal containing
  // `${portId}` — a `\{([\s\S]*?)\}` capture stops at the `}` of the interpolation and truncates
  // before reaching `return false`, so three perfectly-correct catches read as non-reporting.
  // (This is exactly the "slice by `{`, not by declaration" trap; it produced a false FAIL.)
  const catches = [...hookCode.matchAll(/catch\s*\([^)]*\)/g)].map((m) =>
    hookCode.slice(m.index, alertStartEnd(hookCode, m.index))
  );
  const reporting = catches.filter((block) => /return\s+false/.test(block));
  record(
    'Failed device writes report failure to the caller',
    catches.length > 0 && catches.length === reporting.length,
    `${reporting.length}/${catches.length} catch blocks return false`
  );

  // ...and the Dashboard must act on at least the two that matter: a port toggle and the
  // shutdown override. Asserting "some error state exists" would pass on an unused variable.
  const checksOverride = /setOverride\([\s\S]{0,300}?ok\s*\)?[\s\S]{0,200}?reportFailure|const ok = await setOverride\(true\);/.test(dashCode);
  const checksPort = /const ok = await togglePortRelay/.test(dashCode);
  const rendersBanner = /role="alert"/.test(dashCode) && /actionError/.test(dashCode);
  record(
    'Dashboard surfaces a failed write instead of failing silently',
    checksOverride && checksPort && rendersBanner,
    `override=${checksOverride} port=${checksPort} banner=${rendersBanner}`
  );
}

// ---------------------------------------------------------------------------
// Alert retention is self-healing
// ---------------------------------------------------------------------------
// Pruning one row per alert keeps a healthy node at the cap but leaves an already-oversized node
// (pre-retention, or a burst) effectively permanent — a 1000-row node stays ~1000 forever.
{
  const alertSrc = fs.readFileSync(path.join(ROOT, 'api', 'alert.js'), 'utf8');
  const fnStart = alertSrc.indexOf('const recordAlert = async');
  const fnBlock = fnStart >= 0 ? alertSrc.slice(fnStart, alertStartEnd(alertSrc, fnStart)) : '';
  const code = fnBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Cheap detection (a tight limit) AND a full sweep when over budget. Either alone is wrong:
  // only-tight never converges, only-full over-reads on every single alert.
  const hasCheapProbe = /limitToFirst\(MAX_ALERT_HISTORY\s*\+\s*1\)/.test(code);
  const hasFullSweep = /orderByKey\(\)\.get\(\)/.test(code);
  const hasBulkDelete = /allKeys\.slice\(0,\s*allKeys\.length\s*-\s*MAX_ALERT_HISTORY\)/.test(code);

  record(
    'Alert retention converges an oversized node in one pass',
    fnBlock.length > 0 && hasCheapProbe && hasFullSweep && hasBulkDelete,
    fnBlock.length === 0
      ? '*** recordAlert not found ***'
      : `cheapProbe=${hasCheapProbe} fullSweep=${hasFullSweep} bulkDelete=${hasBulkDelete}`
  );
}

// ---------------------------------------------------------------------------
// Firmware COMPILES — the structural fixes that got it building (2026-10-08)
// ---------------------------------------------------------------------------
// The firmware had never been built. Three separate errors shipped, each masking the next. These
// assertions cannot run the compiler (arduino-cli is not guaranteed to be installed), but each one
// pins the specific structure whose absence caused a build failure, so a regression is caught here
// rather than at the first flash attempt.
{
  const fwDir = path.join(ROOT, 'esp32', 'VoltSense');
  const typesPath = path.join(fwDir, 'VoltSenseTypes.h');
  const typesSrc = fs.existsSync(typesPath) ? fs.readFileSync(typesPath, 'utf8') : '';
  const inoSrc = fs.readFileSync(path.join(fwDir, 'VoltSense.ino'), 'utf8');
  const inoCode = inoSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // 1. Signature types must be in the header. The Arduino build inserts generated prototypes ABOVE
  //    anything the .ino defines below them, so a signature type declared in the .ino fails with
  //    "does not name a type" — and the insertion point moves as functions are added, so an
  //    in-file ordering fix silently rots.
  const headerDeclaresProbe = /struct\s+ProbeResult\b/.test(typesSrc);
  const headerDeclaresRelay = /enum\s+RelaySwitchResult\b/.test(typesSrc);
  const inoIncludesHeader = /#include\s+"VoltSenseTypes\.h"/.test(inoSrc);
  record(
    'Signature types live in VoltSenseTypes.h, above the generated prototypes',
    headerDeclaresProbe && headerDeclaresRelay && inoIncludesHeader,
    `header(ProbeResult=${headerDeclaresProbe} RelaySwitchResult=${headerDeclaresRelay}) included=${inoIncludesHeader}`
  );

  // 2. ...and must NOT also be defined in the .ino. Defining them twice was the original (failed)
  //    workaround: it trades "does not name a type" for "multiple definition".
  const inoRedefines = /struct\s+ProbeResult\s*\{/.test(inoCode) || /enum\s+RelaySwitchResult\s*\{/.test(inoCode);
  record(
    'Those types are not redefined in the sketch',
    !inoRedefines,
    inoRedefines ? '*** duplicate definition — does not compile ***' : 'declared once, in the header'
  );

  // 3. Sign-in credentials belong on `auth`, not `config.signer`. The latter has no email/password
  //    members at all in the library this project builds against.
  const usesWrongAuthApi = /config\.signer\.(email|password)\b/.test(inoCode);
  const usesRightAuthApi = /auth\.user\.email\b/.test(inoCode) && /auth\.user\.password\b/.test(inoCode);
  record(
    'Device auth uses the real API (auth.user.*, not config.signer.*)',
    !usesWrongAuthApi && usesRightAuthApi,
    usesWrongAuthApi
      ? '*** config.signer.email/password do not exist in this library ***'
      : 'auth.user.email / auth.user.password'
  );

  // 4. A default argument may be given once — repeating it on the definition is an error.
  const fwLines = inoCode.split(/\r?\n/);
  const defaultOnDefinition = fwLines.some((l) => /^RelaySwitchResult\s+runRelaySwitch\s*\([^;]*=\s*false\s*\)\s*\{/.test(l));
  record(
    'Default argument is not repeated on the definition',
    !defaultOnDefinition,
    defaultOnDefinition ? '*** default given twice ***' : 'declared once, on the forward declaration'
  );

  // 5. Adjacent string literals concatenate only with MACROS. `"a" NAME "b"` is a syntax error when
  //    NAME is a const char* — which is how ProvisionToken failed to build.
  const provSrc = fs.readFileSync(path.join(ROOT, 'esp32', 'ProvisionToken', 'ProvisionToken.ino'), 'utf8');
  const badConcat = /"[^"]*"\s+[A-Z_][A-Z0-9_]*\s+"/.test(provSrc.replace(/^\s*\/\/.*$/gm, ''));
  record(
    'No string-literal concatenation with a variable name',
    !badConcat,
    badConcat ? '*** a const char* cannot be concatenated into a literal ***' : 'clean'
  );

  // 5b. NO SECRETS IN THE FIRMWARE. The factory pairing key was committed as a literal and pushed
  //     to a public repo. It is a real credential: /api/pair accepts it, and a caller holding it
  //     plus a MAC receives that device's password and alert secret — which authenticate as the
  //     device, and the rules give a device full write to its own node, relays included. Supply it
  //     at build time instead; the `#ifndef` guard exists for exactly that.
  const keyLiteral = inoCode.match(/VOLTSENSE_PAIRING_KEY\s+"([^"]*)"/);
  const keyValue = keyLiteral ? keyLiteral[1] : null;
  record(
    'No credential literal in the firmware (pairing key supplied at build time)',
    keyValue === '',
    keyValue === null
      ? '*** VOLTSENSE_PAIRING_KEY default not found — check the guard is still present ***'
      : keyValue === ''
        ? 'empty default; injected via -DVOLTSENSE_PAIRING_KEY at build time'
        : '*** A CREDENTIAL IS HARD-CODED — rotate it and remove it ***'
  );

  // 5c. The LOAD POLICY defect must stay documented. The shutdown rule keeps a port on when it draws
  //     current, which for the device's actual loads (chargers, fans, lamps) protects the wasteful
  //     case — a lamp left burning in an empty room — and cuts the useful one (a phone mid-charge).
  //     It is a known defect awaiting a per-port policy, and it is invisible to every other check.
  const loadPolicyPath = path.join(ROOT, 'docs', 'LOAD-POLICY.md');
  const loadPolicy = fs.existsSync(loadPolicyPath) ? fs.readFileSync(loadPolicyPath, 'utf8') : '';
  const statesIntendedLoads = /phone charger/i.test(loadPolicy) && /lamp/i.test(loadPolicy);
  const namesTheInversion = /kept on|KEPT ON/i.test(loadPolicy) && /cut/i.test(loadPolicy);
  const proposesPolicy = /Always on/i.test(loadPolicy) && /Keep while drawing/i.test(loadPolicy);
  record(
    'Load-policy defect is documented (inverted shutdown rule for the intended loads)',
    loadPolicy.length > 0 && statesIntendedLoads && namesTheInversion && proposesPolicy,
    loadPolicy.length === 0
      ? '*** docs/LOAD-POLICY.md missing ***'
      : `loads=${statesIntendedLoads} inversion=${namesTheInversion} policy=${proposesPolicy}`
  );

  // 5d. The FEATURE INVENTORY must survive. It is the only place the two directions are checked
  //     against each other — features that need hardware, and hardware with no software using it.
  //     Each of these findings was invisible to every other check: an inert write and an ignored
  //     output both look like working code.
  const invPath = path.join(ROOT, 'docs', 'FEATURE-INVENTORY.md');
  const inv = fs.existsSync(invPath) ? fs.readFileSync(invPath, 'utf8') : '';
  const coversBothDirections = /Software features → what hardware they need/i.test(inv) &&
    /Hardware → software that uses it/i.test(inv);
  const namesInertWrites = /ports\/<id>\/name/.test(inv) && /ignores it|never/i.test(inv);
  const namesIgnoredOutput = /ports\/<id>\/voltage/.test(inv) && /never/.test(inv);
  record(
    'Feature inventory covers both directions and names the inert keys',
    inv.length > 0 && coversBothDirections && namesInertWrites && namesIgnoredOutput,
    inv.length === 0
      ? '*** docs/FEATURE-INVENTORY.md missing ***'
      : `bothDirections=${coversBothDirections} inertWrites=${namesInertWrites} ignoredOutput=${namesIgnoredOutput}`
  );

  // 6. The partition scheme must be documented: the sketch needs ~1.48 MB and the default ESP32
  //    partition provides only 1.2 MB, so an undocumented build fails on size, not on code.
  const bringup = fs.readFileSync(path.join(ROOT, 'docs', 'HARDWARE-BRINGUP.md'), 'utf8');
  record(
    'The required partition scheme is documented',
    /huge_app/.test(bringup) && /Partition Scheme/i.test(bringup),
    'the sketch does not fit the default partition'
  );

  // 7. The two hardware mistakes that cost the most must stay documented. Both are silent: a
  //    mis-wired ACS712 reads a plausible 0 A, and an inverted relay module energises a socket the
  //    user believes is off. Neither shows up as an error anywhere.
  const handoffPath = path.join(ROOT, 'docs', 'HANDOFF.md');
  const handoff = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf8') : '';
  // ACS712 in series with ONE conductor (both live+neutral cancels the field -> reads 0 A).
  const acs712Series = /IN SERIES/i.test(handoff) && /both/i.test(handoff);
  // Relay polarity: firmware assumes HIGH = energised; most modules are active-LOW.
  const relayPolarity = /HIGH = relay energised|HIGH = energised/i.test(handoff) &&
    /active-low/i.test(handoff);
  // Mains safety, stated before any wiring instruction.
  const mainsSafety = /never wire or rewire with the mains connected/i.test(handoff);
  record(
    'Handoff doc keeps the silent hardware traps documented',
    handoff.length > 0 && acs712Series && relayPolarity && mainsSafety,
    handoff.length === 0
      ? '*** docs/HANDOFF.md missing ***'
      : `acs712Series=${acs712Series} relayPolarity=${relayPolarity} mainsSafety=${mainsSafety}`
  );

  // 8. The FUSE specification. "Fit a fuse" is not actionable — a 10 A glass fuse is not equivalent
  //    to a 5 A ceramic time-lag one, and a fuse above the sensor's 5 A ceiling leaves the exact
  //    blind spot the software cannot cover. Each of these four properties is load-bearing.
  const fuseRating = /5\s*A maximum|5 A max/i.test(handoff);
  const fuseCeramic = /ceramic/i.test(handoff) && /not glass|NOT glass|not\s+glass/i.test(handoff);
  const fuseTimelag = /time-lag|slow-blow/i.test(handoff);
  const fusePlacement = /upstream of the relay/i.test(handoff) && /live/i.test(handoff);
  record(
    'Fuse specification is documented (rating, type, construction, placement)',
    fuseRating && fuseCeramic && fuseTimelag && fusePlacement,
    `rating=${fuseRating} ceramic=${fuseCeramic} timeLag=${fuseTimelag} placement=${fusePlacement}`
  );

  // 8b. The BREAKING CAPACITY letter, and the parts that must not be substituted. "Ceramic
  //     time-lag 5 A" is still incomplete: a 5x20mm part earns `H` only by interrupting 1500 A,
  //     while `L` is tested to just 35 A and can fail to clear a mains fault. The automotive-fuse
  //     trap is the other one people walk into — those are ~32 VDC parts.
  const breakingCapacity = /\bH\b.*1500 A|1500 A/i.test(handoff) && /\bL\b.*35 A|35 A/i.test(handoff);
  const autoFuseWarned = /automotive/i.test(handoff) && /32\s*V/i.test(handoff);
  record(
    'Fuse breaking capacity (H vs L) and the automotive trap are documented',
    breakingCapacity && autoFuseWarned,
    `breakingCapacity=${breakingCapacity} automotiveWarned=${autoFuseWarned}`
  );

  // 8c. The handoff must state the FIXED architecture and warn against substitution. It is read by
  //     whoever wires the board; leaving a viable-looking alternative in it invites someone to
  //     build a different device than the firmware supports. Design alternatives belong in the
  //     design doc, not the build instructions.
  const buildFixed = /ACS712 \+ ZMPT101B/i.test(handoff) && /do not substitute/i.test(handoff);
  const pzemExcluded = /do not connect a UART energy-meter module|PZEM-004T\) to GPIO 33/i.test(handoff);
  record(
    'Handoff states the fixed build and excludes substitutes',
    buildFixed && pzemExcluded,
    `buildFixed=${buildFixed} pzemExcluded=${pzemExcluded}`
  );

  // 9. SENSOR IDENTIFICATION. "Fit the voltage sensor" is not actionable — an "AC voltage sensor"
  //    can be one of several devices, and only some can produce real power. The DC-output type
  //    reports a plausible voltage and even improves the VA figure, while being structurally
  //    incapable of watts (the waveform, and with it the power factor, is already gone). That is
  //    the failure this whole path exists to avoid, so the fork must stay documented.
  const vsDoc = fs.readFileSync(path.join(ROOT, 'docs', 'VOLTAGE-SENSING.md'), 'utf8');
  const dcTypeWarned = /DC .{0,30}∝ V_rms|DC .{0,20}proportional to V_rms/i.test(vsDoc) ||
    /steady \*\*DC level\*\*|DC level.*RMS/i.test(vsDoc);
  const isolationWarned = /NOT ISOLATED|not isolated/i.test(vsDoc) &&
    /resistive divider/i.test(vsDoc);
  const pzemNoted = /PZEM/i.test(vsDoc) && /UART/i.test(vsDoc);
  record(
    'Voltage-sensor identification is documented (DC-output trap, isolation, PZEM)',
    dcTypeWarned && isolationWarned && pzemNoted,
    `dcType=${dcTypeWarned} isolation=${isolationWarned} pzem=${pzemNoted}`
  );
}

// ---------------------------------------------------------------------------
// .gitignore ordering: the example file must stay committed
// ---------------------------------------------------------------------------
// `.gitignore` carried a duplicated tail (`.vercel`, `.env*`) appended after the
// `!.env.example` negation. Because the LAST matching pattern wins, that stray `.env*`
// silently re-ignored the example env file — so it was never committed, and anyone cloning
// had no list of the variables to set. Ordering is the whole point here, so assert on order.
{
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

  // Ignore blank/comment lines so a comment mentioning `.env*` cannot satisfy or break this.
  const patterns = gi
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const negationAt = patterns.indexOf('!.env.example');
  const laterBroadMatch = patterns
    .slice(negationAt + 1)
    .find((p) => p === '.env*' || p === '.env' || p === '.env.*');

  // The secret files must still be ignored — the negation must be narrow.
  const envIgnored = patterns.includes('.env') || patterns.includes('.env.*');

  record(
    'No .gitignore rule re-ignores .env.example after its negation',
    negationAt >= 0 && !laterBroadMatch && envIgnored,
    negationAt < 0
      ? '*** !.env.example negation missing ***'
      : laterBroadMatch
        ? `*** "${laterBroadMatch}" appears AFTER !.env.example — it wins, so the example is ignored ***`
        : `negation@${negationAt} no-later-broad-match=true envStillIgnored=${envIgnored}`
  );
}

// ---- summary ----
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

