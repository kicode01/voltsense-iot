import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

async function generate() {
  const payload = 'WIFI:S:VoltSense_Setup;T:nopass;;';
  const outDir = path.resolve('public/assets');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Generate standalone PNG
  const pngPath = path.join(outDir, 'voltsense_wifi_qr.png');
  await QRCode.toFile(pngPath, payload, {
    width: 600,
    margin: 2,
    color: {
      dark: '#612F2F', // VoltSense Maroon
      light: '#FFFFFF'
    }
  });
  console.log('Saved:', pngPath);

  // 2. Generate raw QR SVG string
  const rawQrSvg = await QRCode.toString(payload, {
    type: 'svg',
    margin: 1,
    color: {
      dark: '#612F2F',
      light: '#FFFFFF'
    }
  });

  // Extract inner svg content or embed directly
  const svgContentMatch = rawQrSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  const innerSvg = svgContentMatch ? svgContentMatch[1] : '';
  const viewBoxMatch = rawQrSvg.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 29 29';

  // 3. Create high-resolution printable label sticker (400x500 px vector)
  const stickerSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520" width="400" height="520">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F9FAFB" />
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#612F2F" />
      <stop offset="100%" stop-color="#803B3B" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.1" />
    </filter>
  </defs>

  <!-- Outer Cutline / Border (3mm bleed safe) -->
  <rect x="5" y="5" width="390" height="510" rx="24" fill="url(#bgGrad)" stroke="#E5E7EB" stroke-width="2" filter="url(#cardShadow)" />
  
  <!-- Maroon Brand Header -->
  <rect x="5" y="5" width="390" height="85" rx="24" fill="url(#headerGrad)" />
  <!-- Straighten bottom corners of header -->
  <rect x="5" y="55" width="390" height="35" fill="url(#headerGrad)" />

  <!-- Logo and Brand Title -->
  <g transform="translate(30, 24)">
    <!-- Thunder bolt icon -->
    <circle cx="22" cy="22" r="20" fill="#FFFFFF" fill-opacity="0.2" />
    <path d="M22 8 L14 24 L21 24 L20 36 L30 19 L23 19 Z" fill="#FDE047" />
    <!-- Text -->
    <text x="56" y="22" font-family="'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="22" fill="#FFFFFF" letter-spacing="1">VoltSense</text>
    <text x="56" y="38" font-family="'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="10" fill="#FCA5A5" letter-spacing="2">SMART WI-FI SETUP</text>
  </g>

  <!-- Instruction Subheader -->
  <text x="200" y="118" text-anchor="middle" font-family="'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="14" fill="#1F2937">Scan to Connect Device Hotspot</text>
  <text x="200" y="136" text-anchor="middle" font-family="'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="11" fill="#6B7280">Point your smartphone camera at this code</text>

  <!-- QR Code Frame -->
  <rect x="65" y="152" width="270" height="270" rx="20" fill="#FFFFFF" stroke="#612F2F" stroke-width="2.5" />
  
  <!-- Embedded QR Code -->
  <g transform="translate(80, 167)">
    <svg width="240" height="240" viewBox="${viewBox}">
      ${innerSvg}
    </svg>
  </g>

  <!-- Hotspot Credential Details -->
  <rect x="40" y="435" width="320" height="42" rx="12" fill="#F3F4F6" stroke="#E5E7EB" stroke-width="1" />
  <text x="55" y="456" font-family="'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="10" fill="#4B5563">SSID:</text>
  <text x="88" y="456" font-family="monospace" font-weight="800" font-size="12" fill="#612F2F">VoltSense_Setup</text>
  <text x="240" y="456" font-family="'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="10" fill="#4B5563">Security:</text>
  <text x="288" y="456" font-family="'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="11" fill="#059669">Open / No PW</text>
  <text x="200" y="470" text-anchor="middle" font-family="'Segoe UI', Roboto, sans-serif" font-weight="500" font-size="9" fill="#9CA3AF">Captive Portal Gateway: http://192.168.4.1</text>

  <!-- Bottom micro-copy -->
  <text x="200" y="500" text-anchor="middle" font-family="'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="9" fill="#9CA3AF">PUP Computer Engineering · IoT Energy Monitor</text>
</svg>
`;

  const stickerPath = path.join(outDir, 'voltsense_setup_qr_sticker.svg');
  fs.writeFileSync(stickerPath, stickerSvg, 'utf-8');
  console.log('Saved:', stickerPath);
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
