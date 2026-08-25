/* ============================================================
   SERVICE WORKER — Toque Artesano de Sofi
   Maneja notificaciones en segundo plano
============================================================ */

const SW_VERSION = 'v1.2';

/* ------------------------------------------------------------
   FCM (Firebase Cloud Messaging) — recibe pushes reales enviadas
   desde el script de GitHub Actions (via FCM HTTP v1 API).
   Estas SÍ funcionan aunque el navegador esté cerrado, porque
   las entrega el sistema operativo (push service), no un timer
   corriendo dentro del SW.
------------------------------------------------------------ */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Mismo config que en index.html (el SW no puede leer variables de la página)
firebase.initializeApp({
  apiKey: "AIzaSyBjvyLCF7leohdUXQUnv2v2MtW1kb_F4Y8",
  authDomain: "toque-artesano.firebaseapp.com",
  projectId: "toque-artesano",
  storageBucket: "toque-artesano.firebasestorage.app",
  messagingSenderId: "1009533231670",
  appId: "1:1009533231670:web:d604c07152e505b6d7ae97"
});

// Con esto inicializado, cuando llega un mensaje FCM con bloque "notification"
// el propio SDK de Firebase Messaging muestra la notificación automáticamente,
// incluso con la pestaña/navegador cerrado. No hace falta un listener 'push'
// manual, pero lo agregamos igual como respaldo por si algún día se manda
// un mensaje "data-only".
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    // Si viene con "notification", Firebase Messaging ya se encarga (evitamos duplicar).
    if (payload.notification) return;
    // Si es data-only, lo mostramos nosotros.
    const { title, body } = payload.data || {};
    if (title) {
      event.waitUntil(self.registration.showNotification(title, {
        body: body || '',
        icon: './icon.png',
        badge: './icon.png',
        vibrate: [200, 100, 200],
      }));
    }
  } catch (e) {
    console.error('[SW] Error procesando push FCM', e);
  }
});

// Instalación del SW
self.addEventListener('install', event => {
  console.log('[SW] Instalado', SW_VERSION);
  self.skipWaiting();
});

// Activación del SW
self.addEventListener('activate', event => {
  console.log('[SW] Activado', SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Escuchar mensajes desde la app.
// SCHEDULE_NOTIFICATION / CANCEL_NOTIFICATIONS y el respaldo por IndexedDB
// se eliminaron: dependían de que el SW siguiera vivo a la hora del disparo
// (setTimeout local), algo poco confiable si el navegador se cerraba o el
// SO mataba el proceso. El resumen 7am, el recordatorio de notas 23hs, las
// alertas de pedido y las de stock bajo ahora llegan todas como push FCM
// real desde el cron de GitHub Actions (scripts/send-notifications.js),
// entregadas por el sistema operativo aunque el navegador esté cerrado.
// Solo queda TEST_NOTIFICATION para pruebas manuales desde la app.
self.addEventListener('message', event => {
  const { type } = event.data || {};

  if (type === 'TEST_NOTIFICATION') {
    self.registration.showNotification('🍰 Prueba — Toque Artesano', {
      body: 'Las notificaciones funcionan correctamente!',
      icon: './icon.png',
      badge: './icon.png',
      tag: 'test-' + Date.now(),
      vibrate: [200, 100, 200],
    });
  }
});

// Click en notificación — abrir la app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })
  );
});
