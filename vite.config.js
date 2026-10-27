import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
const devAuthPlugin = () => ({
  name: 'dev-auth-bypass',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/api/dev-login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { email, password } = JSON.parse(body || '{}');
            if (email === 'admin@voltsense.local' && (password === '123456' || password === 'voltsense123')) {
              const { default: admin } = await import('firebase-admin');
              const { default: dotenv } = await import('dotenv');
              dotenv.config();
              if (!admin.apps.length) {
                const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                admin.initializeApp({ credential: admin.credential.cert(sa) });
              }
              const token = await admin.auth().createCustomToken('gvhHI7seIcQo6amqrftd3bfdOcN2');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ token }));
              return;
            }
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
      next();
    });
  }
});

export default defineConfig({
  server: {
    host: true, // Listen on all local IPs
    allowedHosts: true, // Allow tunnel hostnames like .loca.lt
  },
  plugins: [
    devAuthPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // FCM receives push events in the SAME registration that owns the app. Pre-caching
        // firebase-messaging-sw.js is not enough: the generated worker must EXECUTE it so its
        // onBackgroundMessage handler runs when every app window is closed.
        importScripts: ['/firebase-messaging-sw.js'],
        // The Outfit webfont comes from Google Fonts, so it is not part of the
        // precache manifest. Without these rules an installed app opened offline
        // silently falls back to a system font. Cache the stylesheet revalidating
        // and the font files for a year.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      // Single source of truth for the web app manifest. index.html must NOT also link a
      // hand-written manifest, otherwise the browser only reads the first <link rel="manifest">
      // it finds and the values below are ignored.
      //
      // All icons are generated from public/logo-square.svg by `npm run icons`.
      manifest: {
        id: '/',
        name: 'VoltSense',
        short_name: 'VoltSense',
        description: 'IoT-based occupancy-driven power monitoring and control system',
        // Matches the app header so the Android status bar blends into it and the
        // status bar icons stay dark/readable on the light UI.
        theme_color: '#F0F2F5',
        background_color: '#F0F2F5',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'en',
        start_url: '/',
        scope: '/',
        categories: ['utilities', 'productivity'],
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            // Artwork pre-shrunk to 80% so it survives Android's circular mask.
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  build: {
    sourcemap: false
  }
});
