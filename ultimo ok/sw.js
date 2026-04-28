/* ============================================================
   SERVICE WORKER — Toque Artesano de Sofi
   Maneja notificaciones en segundo plano
============================================================ */

const SW_VERSION = 'v1.0';

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

// Escuchar mensajes desde la app
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  if (type === 'SCHEDULE_NOTIFICATION') {
    const { id, title, body, fireAt } = payload;
    const msHasta = fireAt - Date.now();

    console.log(`[SW] Notificación "${title}" programada en ${Math.round(msHasta/60000)} min`);

    if (msHasta <= 0) {
      // Mandar ahora si ya pasó el tiempo
      self.registration.showNotification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: id,
        requireInteraction: false,
        vibrate: [200, 100, 200],
      });
      return;
    }

    // Guardar en indexedDB para persistir si se cierra la pestaña
    saveScheduledNotification({ id, title, body, fireAt });

    // También programar con setTimeout como backup
    setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: id,
        requireInteraction: false,
        vibrate: [200, 100, 200],
      });
      deleteScheduledNotification(id);
    }, msHasta);
  }

  if (type === 'CANCEL_NOTIFICATIONS') {
    clearAllScheduled();
  }

  if (type === 'TEST_NOTIFICATION') {
    self.registration.showNotification('🍰 Prueba — Toque Artesano', {
      body: 'Las notificaciones funcionan correctamente!',
      tag: 'test-' + Date.now(),
      vibrate: [200, 100, 200],
    });
  }
});

// ---- IndexedDB helpers ----
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('toque-notifs', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('scheduled', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e);
  });
}

async function saveScheduledNotification(notif) {
  try {
    const db = await openDB();
    const tx = db.transaction('scheduled', 'readwrite');
    tx.objectStore('scheduled').put(notif);
  } catch(e) { console.error('[SW] Error guardando notif', e); }
}

async function deleteScheduledNotification(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('scheduled', 'readwrite');
    tx.objectStore('scheduled').delete(id);
  } catch(e) {}
}

async function clearAllScheduled() {
  try {
    const db = await openDB();
    const tx = db.transaction('scheduled', 'readwrite');
    tx.objectStore('scheduled').clear();
  } catch(e) {}
}

// Al activar el SW, reprogramar notificaciones pendientes de IndexedDB
async function reprogramarPendientes() {
  try {
    const db = await openDB();
    const tx = db.transaction('scheduled', 'readonly');
    const store = tx.objectStore('scheduled');
    const all = await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = e => res(e.target.result);
      req.onerror = rej;
    });

    const ahora = Date.now();
    all.forEach(notif => {
      const msHasta = notif.fireAt - ahora;
      if (msHasta <= 0) {
        // Enviar inmediatamente si ya pasó
        self.registration.showNotification(notif.title, {
          body: notif.body,
          tag: notif.id,
          vibrate: [200, 100, 200],
        });
        deleteScheduledNotification(notif.id);
      } else {
        // Reprogramar
        setTimeout(() => {
          self.registration.showNotification(notif.title, {
            body: notif.body,
            tag: notif.id,
            vibrate: [200, 100, 200],
          });
          deleteScheduledNotification(notif.id);
        }, msHasta);
        console.log(`[SW] Reprogramada "${notif.title}" en ${Math.round(msHasta/60000)} min`);
      }
    });
  } catch(e) { console.error('[SW] Error reprogramando', e); }
}

self.addEventListener('activate', event => {
  event.waitUntil(reprogramarPendientes());
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
