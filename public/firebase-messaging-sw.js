// Firebase Cloud Messaging background handler.
//
// This file is served as-is from `public/` — it is NOT bundled, so it cannot read
// import.meta.env and must hardcode the Firebase web config. Keep the SDK version below in step
// with the `firebase` dependency in package.json; the compat build is used here because a plain
// service worker has no module loader.
//
// Workbox imports this file from its generated /sw.js via workbox.importScripts in vite.config.js.
// The app waits for that ONE PWA registration and hands it to FCM in getToken(). Do not register
// this file as a separate worker: it needs to run *inside* the worker that receives the push.
// The server sends DATA-ONLY messages so Firebase won't display an automatic duplicate.
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBeTz-ZTkrVrq9k92HJ1ttvZb806voxpnM",
  authDomain: "voltsense-iot.firebaseapp.com",
  databaseURL: "https://voltsense-iot-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "voltsense-iot",
  storageBucket: "voltsense-iot.firebasestorage.app",
  messagingSenderId: "713519734511",
  appId: "1:713519734511:web:371723a8784e6ae525851a"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // The sender puts everything in `data` so the same payload renders identically on Android and
  // iOS; `notification` is only read as a fallback for messages sent with a notification block.
  const data = payload.data || {};
  const notification = payload.notification || {};

  const title = data.title || notification.title || 'VoltSense Alert';
  const body = data.body || notification.body || 'The room has been empty.';

  // Return the promise so FCM's push event stays alive until the OS notification is shown.
  return self.registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/favicon-48.png',
    tag: data.tag || 'voltsense-alert',
    renotify: true,
    data: { url: data.url || '/dashboard' }
  });
});

// Focus an open tab when the user taps the notification, rather than opening a second one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (client.navigate) client.navigate(target);
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
