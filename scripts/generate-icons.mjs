/**
 * Generates every app icon for VoltSense from the master artwork in
 * public/logo-square.svg, and writes them straight into public/.
 *
 * Why rasterise at all? iOS does not support SVG for `apple-touch-icon` — it
 * only reads PNG. Android/Chrome *do* accept SVG in the web app manifest, but
 * PNG is what every launcher, mask and splash screen reliably agrees on, so we
 * ship PNG everywhere and keep the SVG as the single source of truth.
 *
 * Three variants come out of the same artwork:
 *
 *   tile      Full-bleed square. The maroon gradient reaches all four edges.
 *             iOS applies its own squircle mask on top, so baking rounded
 *             corners in here would give rounded corners inside rounded
 *             corners, with visible transparent notches.
 *
 *   maskable  Same background, artwork scaled to ~80%. Android only guarantees
 *             a safe circle of diameter 80% of the icon and then applies a
 *             mask of its choosing (circle, squircle, teardrop...).
 *
 *   squircle  The original rounded artwork with transparent corners. Used only
 *             for browser favicons, where a hard square looks heavy.
 *
 * Everything (rasterising, downsampling, the .ico container) happens inside
 * Chromium + Node — no image libraries required.
 *
 * Usage:  node scripts/generate-icons.mjs
 *         npm run icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
// The preview sheet is a human-inspection artifact, not a build input, and must never land in the
// repo root. `.workbuddy-ai/` is already the project's scratch space and is fully gitignored.
const PREVIEW_DIR = path.join(ROOT, '.workbuddy-ai');

/* Playwright is not a dependency of this project; resolve it from wherever it
   happens to live. NODE_PATH does not work for ESM, hence createRequire. */
function loadPlaywright() {
  const candidates = [
    process.env.PW_ROOT,
    path.join(ROOT, 'node_modules'),
    'C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules',
  ].filter(Boolean);
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, 'noop.js'))('playwright');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('Could not resolve the "playwright" package. Set PW_ROOT to its node_modules dir.');
}

/* Playwright's bundled-browser revision often will not match what is actually
   installed on disk, so locate a Chromium build ourselves before giving up. */
function findChromium() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    'C:/Users/PC/AppData/Local/ms-playwright',
    path.join(process.env.HOME || '', 'Library/Caches/ms-playwright'),
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
  ].filter(Boolean);

  const layouts = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-mac', 'Chromium.app/Contents/MacOS/Chromium'],
    ['chrome-linux', 'chrome'],
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      for (const [dir, exe] of layouts) {
        const p = path.join(root, build, dir, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

/* ---------------------------------------------------------------- artwork */

const DEFS = `
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#9f1239"/>
      <stop offset="100%" stop-color="#4c0519"/>
    </linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
  </defs>`;

/* Bolt + radar waves. `tileScale` maps the artwork's 448-unit squircle onto the
   full 256 canvas: inner (32,32) -> (0,0), inner (480,480) -> (256,256). */
const ART = (tileScale) => `
  <g transform="translate(128 128) scale(${tileScale}) translate(-128 -128)">
    <g transform="translate(-18.2857 -18.2857) scale(0.5714285714)">
      <g fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" filter="url(#shadow)">
        <path d="M 144 368 A 158 158 0 0 1 368 144" stroke-opacity="0.15"/>
        <path d="M 192 320 A 90 90 0 0 1 320 192" stroke-opacity="0.3"/>
      </g>
      <path d="M 286 121 L 166 271 L 246 271 L 226 391 L 346 241 L 266 241 Z"
            fill="#ffffff" stroke="#ffffff" stroke-width="16" stroke-linejoin="round" filter="url(#shadow)"/>
    </g>
  </g>`;

const svg = {
  tile: (scale = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
    ${DEFS}
    <rect x="0" y="0" width="256" height="256" fill="url(#bgGrad)"/>
    ${ART(scale)}
  </svg>`,

  /* Favicons get a rounded tile and a larger bolt: the master artwork carries
     ~8% padding, which at 16px shrinks the lightning to an unreadable blob. */
  favicon: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
    ${DEFS}
    <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#bgGrad)"/>
    ${ART(1.15)}
  </svg>`,

  squircle: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
    ${DEFS}
    <rect x="20.48" y="20.48" width="215.04" height="215.04" rx="48" fill="url(#bgGrad)"/>
    ${ART(1)}
  </svg>`,
};

const MASKABLE_SCALE = 0.8;

/* ---------------------------------------------------------------- targets */

const TARGETS = [
  // iOS home screen. PNG only — iOS silently ignores SVG here.
  // apple-touch-icon.png (180) is what index.html references and what the manifest lists;
  // an identically-named -180x180 duplicate used to be emitted alongside it and was removed.
  ['apple-touch-icon.png', 180, 'tile'],
  ['apple-touch-icon-167x167.png', 167, 'tile'],
  ['apple-touch-icon-152x152.png', 152, 'tile'],
  ['apple-touch-icon-120x120.png', 120, 'tile'],

  // Web app manifest: Android launcher, desktop install, splash screen.
  ['pwa-64x64.png', 64, 'tile'],
  ['pwa-192x192.png', 192, 'tile'],
  ['pwa-512x512.png', 512, 'tile'],
  ['maskable-icon-512x512.png', 512, 'maskable'],

  // Browser tab. Rounded tile + enlarged bolt so 16px stays legible.
  // NOTE: favicon-16.png has no referrer of its own but MUST stay — buildIco() below
  // reads it out of `written[]` to compose the 16px layer of favicon.ico.
  ['favicon-16.png', 16, 'favicon'],
  ['favicon-32.png', 32, 'favicon'],
  ['favicon-48.png', 48, 'favicon'],
];

const SS = 4; // supersample factor before downsampling

/* --------------------------------------------------------------- .ico out */

/** Writes a multi-resolution .ico. Modern Windows and every browser accept
 *  PNG-compressed payloads, so no BMP encoder is needed. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;

  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 0); // width  (0 = 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1); // height (0 = 256)
    dir.writeUInt8(0, o + 2); // palette size
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(img.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

/* ------------------------------------------------------------------ main */

const { chromium } = loadPlaywright();
const executablePath = findChromium();
console.log(`chromium  ${executablePath ?? '(playwright default)'}\n`);

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.setContent('<!doctype html><html><body></body></html>', { waitUntil: 'load' });

/** Rasterise an SVG string at `size`px, supersampled SS times then downsampled
 *  with high-quality smoothing. Returns raw PNG bytes. */
async function rasterize(svgString, size, transparent = false) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
  const base64 = await page.evaluate(
    async ({ dataUrl, size, ss, transparent }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const big = document.createElement('canvas');
      big.width = size * ss;
      big.height = size * ss;
      const b = big.getContext('2d');
      if (!transparent) {
        b.fillStyle = '#4c0519';
        b.fillRect(0, 0, big.width, big.height);
      }
      b.imageSmoothingEnabled = true;
      b.imageSmoothingQuality = 'high';
      b.drawImage(img, 0, 0, big.width, big.height);

      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const o = out.getContext('2d');
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'high';
      o.drawImage(big, 0, 0, size, size);

      return out.toDataURL('image/png').split(',')[1];
    },
    { dataUrl, size, ss: SS, transparent }
  );
  return Buffer.from(base64, 'base64');
}

const written = {};
for (const [file, size, variant] of TARGETS) {
  const scale = variant === 'maskable' ? MASKABLE_SCALE : 1;
  const source =
    variant === 'favicon' ? svg.favicon() : variant === 'squircle' ? svg.squircle() : svg.tile(scale);
  const bytes = await rasterize(source, size, variant === 'squircle');

  fs.writeFileSync(path.join(PUBLIC, file), bytes);
  written[file] = bytes;
  console.log(`  ${file.padEnd(30)} ${String(size).padStart(3)}x${String(size).padEnd(4)} ${variant.padEnd(9)} ${(bytes.length / 1024).toFixed(1)} kB`);
}

/* Multi-resolution favicon.ico (16 / 32 / 48). */
const ico = buildIco([
  { size: 16, data: written['favicon-16.png'] },
  { size: 32, data: written['favicon-32.png'] },
  { size: 48, data: written['favicon-48.png'] },
]);
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico);
console.log(`  ${'favicon.ico'.padEnd(30)}  16/32/48      multi     ${(ico.length / 1024).toFixed(1)} kB`);

/* Vector favicon for browsers that prefer it — same artwork, infinitely sharp. */
fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), svg.favicon().trim());
console.log(`  ${'favicon.svg'.padEnd(30)}   vector        svg       ${(svg.favicon().length / 1024).toFixed(1)} kB`);

/* ------------------------------------------------- verification contact sheet */

const previewArt = {
  tile: svg.tile(1),
  maskable: svg.tile(MASKABLE_SCALE),
  favicon: svg.favicon(),
};
const sheet = await page.evaluate(
  async ({ art }) => {
    const load = async (s) => {
      const i = new Image();
      i.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(s)))}`;
      await i.decode();
      return i;
    };
    const imgs = {
      tile: await load(art.tile),
      maskable: await load(art.maskable),
      favicon: await load(art.favicon),
    };

    const W = 940;
    const H = 390;
    const c = document.createElement('canvas');
    c.width = W * 2;
    c.height = H * 2;
    const x = c.getContext('2d');
    x.scale(2, 2);
    x.fillStyle = '#f4f5f7';
    x.fillRect(0, 0, W, H);

    const label = (t, px, py, color = '#6b7280', size = 12) => {
      x.fillStyle = color;
      x.font = `500 ${size}px system-ui, sans-serif`;
      x.fillText(t, px, py);
    };
    const draw = (img, size, px, py, radius) => {
      x.save();
      if (radius) {
        x.beginPath();
        x.roundRect(px, py, size, size, radius);
        x.clip();
      }
      x.drawImage(img, px, py, size, size);
      x.restore();
    };

    const S = 170;

    label('iOS home screen', 32, 30);
    label('180px, masked by iOS', 32, 46, '#9ca3af', 11);
    draw(imgs.tile, S, 32, 58, 38);

    label('Android maskable', 240, 30);
    label('circle mask + 80% safe area', 240, 46, '#9ca3af', 11);
    x.save();
    x.beginPath();
    x.arc(240 + S / 2, 58 + S / 2, S * 0.4, 0, Math.PI * 2);
    x.clip();
    x.drawImage(imgs.maskable, 240, 58, S, S);
    x.restore();
    x.strokeStyle = '#e24b4a';
    x.lineWidth = 1;
    x.beginPath();
    x.arc(240 + S / 2, 58 + S / 2, S * 0.4, 0, Math.PI * 2);
    x.stroke();

    label('Android squircle', 448, 30);
    label('same file, different mask', 448, 46, '#9ca3af', 11);
    draw(imgs.maskable, S, 448, 58, 42);

    label('Unmasked tile', 656, 30);
    label('what we actually ship', 656, 46, '#9ca3af', 11);
    draw(imgs.tile, S, 656, 58, 0);

    label('Favicons on white', 32, 272);
    [16, 32, 48].forEach((size, i) => {
      const px = 32 + i * 74;
      x.fillStyle = '#ffffff';
      x.fillRect(px - 8, 284, 62, 62);
      x.drawImage(imgs.favicon, px, 292, size, size);
      label(`${size}px`, px, 366, '#9ca3af', 11);
    });

    label('Tile on white vs. dark', 272, 272);
    [['#ffffff', imgs.tile], ['#0f0f10', imgs.tile]].forEach(([bg, img], i) => {
      const px = 272 + i * 90;
      x.fillStyle = bg;
      x.fillRect(px, 284, 78, 78);
      x.drawImage(img, px + 1, 285, 76, 76);
    });

    label('Splash / transparent corners', 470, 272);
    [['#ffffff', imgs.favicon], ['#0f0f10', imgs.favicon]].forEach(([bg, img], i) => {
      const px = 470 + i * 90;
      x.fillStyle = bg;
      x.fillRect(px, 284, 78, 78);
      x.drawImage(img, px + 1, 285, 76, 76);
    });

    return c.toDataURL('image/png').split(',')[1];
  },
  { art: previewArt }
);

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
fs.writeFileSync(path.join(PREVIEW_DIR, 'icon-preview.png'), Buffer.from(sheet, 'base64'));

await browser.close();

// TARGETS PNGs + favicon.ico + favicon.svg.
console.log(`\nWrote ${TARGETS.length + 2} files to public/`);
console.log('Preview sheet: .workbuddy-ai/icon-preview.png');
