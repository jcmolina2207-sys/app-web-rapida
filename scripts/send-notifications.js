/* ============================================================
   send-notifications.js
   Corre en GitHub Actions (cron). NO depende de Cloud Functions
   ni de plan Blaze — solo usa Firestore + FCM, ambos gratis en
   el plan Spark, llamados desde afuera con el Admin SDK.

   Qué hace:
   1. Lee de Firestore los pedidos de HOY que no están "done".
   2. Para cada uno, calcula cuánto falta para la hora de entrega.
   3. Si entra en la ventana de "1 hora antes" o "15 min antes" y
      todavía no se mandó esa alerta, la manda por FCM a todos los
      tokens guardados en la colección "dispositivos".
   4. Marca en el pedido (notif60Enviada / notif15Enviada) para no
      duplicar en la próxima corrida del cron.
============================================================ */

const admin = require('firebase-admin');

// La credencial viene del secret de GitHub Actions como JSON crudo
// (ver .github/workflows/notificaciones.yml)
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}
const serviceAccount = JSON.parse(raw);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const messaging = admin.messaging();

// Zona horaria: Firestore/JS Date usa la hora del runner de GitHub Actions,
// que corre en UTC. Ajustamos a Argentina (UTC-3, sin horario de verano).
const OFFSET_ARG_HORAS = -3;

function ahoraArgentina() {
  const nowUtc = new Date();
  return new Date(nowUtc.getTime() + OFFSET_ARG_HORAS * 60 * 60 * 1000);
}

function pad(n) { return String(n).padStart(2, '0'); }

function fechaStrArgentina(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function main() {
  const ahora = ahoraArgentina(); // Date "corrida" a hora Argentina, pero en campos UTC
  const hoy = fechaStrArgentina(ahora);

  console.log(`[${new Date().toISOString()}] Revisando pedidos de ${hoy} (hora ARG aprox ${pad(ahora.getUTCHours())}:${pad(ahora.getUTCMinutes())})`);

  const dispositivosSnap = await db.collection('dispositivos').get();
  const tokens = dispositivosSnap.docs.map(d => d.data().token).filter(Boolean);

  if (tokens.length === 0) {
    console.log('⚠️ No hay dispositivos (tokens FCM) registrados. Activá notificaciones en la app primero.');
  }

  const pedidosSnap = await db.collection('pedidos')
    .where('fechaEntrega', '==', hoy)
    .get();

  if (pedidosSnap.empty) {
    console.log('No hay pedidos para hoy.');
  } else {
    for (const doc of pedidosSnap.docs) {
      const p = doc.data();
      if (p.estado === 'done') continue;
      if (!p.hora) continue;

      const [hh, mm] = p.hora.split(':').map(Number);
      // Hora de entrega de HOY, en los mismos campos "UTC" que usamos arriba
      // (truco: como ahoraArgentina() ya viene corrida, comparamos todo en
      // ese mismo sistema de referencia, sin mezclar zonas horarias).
      const entrega = new Date(Date.UTC(
        ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), hh, mm, 0, 0
      ));
      const minutosHasta = (entrega.getTime() - ahora.getTime()) / 60000;

      // Ventanas con margen para la granularidad del cron (cada 10 min) y
      // posibles atrasos del runner de GitHub Actions. Cada una se manda
      // UNA sola vez por pedido gracias a los flags notif60Enviada/notif15Enviada.
      const enVentana1h = minutosHasta <= 65 && minutosHasta >= -30;
      const enVentana15m = minutosHasta <= 20 && minutosHasta >= -30;

      if (!p.notif60Enviada && enVentana1h) {
        await enviarYMarcar(doc.ref, tokens,
          `⏰ Pedido en 1 hora — ${p.cliente}`,
          `${p.producto || 'Pedido'} · Entrega a las ${p.hora}`,
          'notif60Enviada');
      }

      if (!p.notif15Enviada && enVentana15m) {
        await enviarYMarcar(doc.ref, tokens,
          `🚨 Pedido en 15 min — ${p.cliente}`,
          `${p.producto || 'Pedido'} · Entrega a las ${p.hora}`,
          'notif15Enviada');
      }
    }
  }

  await revisarStockBajo(tokens);
  await revisarResumen7am(tokens, ahora, hoy, pedidosSnap);
  await revisarRecordatorioNotas23h(tokens, ahora, hoy);

  console.log('Listo.');
}

/* ------------------------------------------------------------
   Resumen de las 7am y recordatorio de notas a las 23hs.
   Antes se programaban client-side vía Service Worker + setTimeout
   (scheduleNotifViaSW en index.html/sw.js), lo cual dependía de que
   el navegador/SW siguiera vivo a esa hora — poco confiable si no se
   abre la app ese día. Ahora, igual que las alertas de pedido y de
   stock bajo, las manda este cron por FCM real, así llegan aunque
   la app nunca se haya abierto.

   Anti-duplicado: como no son "por documento" sino "una vez al día",
   guardamos la fecha del último envío en un doc de config
   (sistema/notificacionesDiarias) y comparamos contra `hoy`.
------------------------------------------------------------ */
const REF_NOTIF_DIARIAS = () => db.collection('sistema').doc('notificacionesDiarias');

async function revisarResumen7am(tokens, ahora, hoy, pedidosSnap) {
  const objetivo = new Date(Date.UTC(
    ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 7, 0, 0, 0
  ));
  const minutosDesde = (ahora.getTime() - objetivo.getTime()) / 60000;
  const enVentana = minutosDesde >= 0 && minutosDesde <= 20;
  if (!enVentana) return;

  const configSnap = await REF_NOTIF_DIARIAS().get();
  const yaEnviado = configSnap.exists && configSnap.data().resumen7amFecha === hoy;
  if (yaEnviado) return;

  const pedidosHoy = pedidosSnap.docs
    .map(d => d.data())
    .filter(p => p.estado !== 'done');
  const notasSnap = await db.collection('notas').where('fecha', '==', hoy).get();
  const notasHoy = notasSnap.docs.map(d => d.data());

  let body = '';
  if (pedidosHoy.length > 0) {
    body += `📦 ${pedidosHoy.length} pedido${pedidosHoy.length > 1 ? 's' : ''} para hoy: ${pedidosHoy.map(p => p.cliente).join(', ')}`;
  }
  if (notasHoy.length > 0) {
    body += `${body ? '\n' : ''}📝 ${notasHoy.length} nota${notasHoy.length > 1 ? 's' : ''} de hoy`;
  }
  if (!body) body = 'No tenés pedidos ni notas para hoy 🎉';

  await enviarYMarcarDiaria(tokens,
    '☀️ Buenos días, Toque Artesano de Sofi!',
    body,
    'resumen7amFecha', hoy);
}

async function revisarRecordatorioNotas23h(tokens, ahora, hoy) {
  const objetivo = new Date(Date.UTC(
    ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 23, 0, 0, 0
  ));
  const minutosDesde = (ahora.getTime() - objetivo.getTime()) / 60000;
  const enVentana = minutosDesde >= 0 && minutosDesde <= 20;
  if (!enVentana) return;

  const configSnap = await REF_NOTIF_DIARIAS().get();
  const yaEnviado = configSnap.exists && configSnap.data().recordatorioNotas23hFecha === hoy;
  if (yaEnviado) return;

  const notasSnap = await db.collection('notas').where('fecha', '==', hoy).get();
  const notasHoy = notasSnap.docs.map(d => d.data());
  // Solo molesta si hay algo que recordar, igual que hacía la versión client-side.
  if (notasHoy.length === 0) return;

  await enviarYMarcarDiaria(tokens,
    '📝 Recordatorio de notas',
    `Tenés ${notasHoy.length} nota${notasHoy.length > 1 ? 's' : ''} para hoy`,
    'recordatorioNotas23hFecha', hoy);
}

async function enviarYMarcarDiaria(tokens, title, body, campoFlag, hoy) {
  if (tokens.length > 0) {
    try {
      const resp = await messaging.sendEachForMulticast({
        notification: { title, body },
        tokens,
      });
      console.log(`📨 "${title}" → ${resp.successCount} ok, ${resp.failureCount} fallidos`);

      resp.responses.forEach((r, i) => {
        if (!r.success && (
          r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token'
        )) {
          db.collection('dispositivos').doc(tokens[i]).delete().catch(() => {});
        }
      });
    } catch (e) {
      console.error('Error enviando FCM:', e);
    }
  }
  // Guardamos la fecha aunque no haya tokens, para no reintentar todo el día.
  await REF_NOTIF_DIARIAS().set({ [campoFlag]: hoy }, { merge: true });
}

/* ------------------------------------------------------------
   Alertas de stock bajo (umbral "rojo" = stock/ideal < 0.3,
   mismo criterio que stockColor() en el frontend).
   No depende de la fecha de hoy: corre siempre en cada tick del
   cron. Anti-duplicado vía `ultimaAlertaStockBajo` (timestamp en
   ms) guardado en el propio documento del ingrediente — si pasaron
   menos de 24hs desde la última alerta, no vuelve a mandar. Si el
   ingrediente se repone y vuelve a bajar del umbral, como ya pasaron
   24hs+ desde la última alerta, puede volver a alertar sin límite.
------------------------------------------------------------ */
const UMBRAL_STOCK_BAJO = 0.3;
const VEINTICUATRO_HS_MS = 24 * 60 * 60 * 1000;

async function revisarStockBajo(tokens) {
  const ingredientesSnap = await db.collection('ingredientes').get();
  const ahoraMs = Date.now();

  for (const doc of ingredientesSnap.docs) {
    const ing = doc.data();
    if (!ing.ideal || ing.ideal <= 0) continue;

    const pct = ing.stock / ing.ideal;
    if (pct >= UMBRAL_STOCK_BAJO) continue;

    const ultimaAlerta = ing.ultimaAlertaStockBajo;
    if (ultimaAlerta && (ahoraMs - ultimaAlerta) < VEINTICUATRO_HS_MS) continue;

    const pctRedondeado = Math.round(pct * 100);
    await enviarYMarcarStock(doc.ref, tokens,
      `🧂 Stock bajo: ${ing.nombre}`,
      `${ing.nombre} al ${pctRedondeado}% (${ing.stock} de ${ing.ideal} ${ing.unidad || ''})`);
  }
}

async function enviarYMarcar(ref, tokens, title, body, campoFlag) {
  if (tokens.length > 0) {
    try {
      const resp = await messaging.sendEachForMulticast({
        notification: { title, body },
        tokens,
      });
      console.log(`📨 "${title}" → ${resp.successCount} ok, ${resp.failureCount} fallidos`);

      // Limpiar tokens inválidos/vencidos para no acumular basura
      resp.responses.forEach((r, i) => {
        if (!r.success && (
          r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token'
        )) {
          db.collection('dispositivos').doc(tokens[i]).delete().catch(() => {});
        }
      });
    } catch (e) {
      console.error('Error enviando FCM:', e);
    }
  }
  await ref.update({ [campoFlag]: true });
}

async function enviarYMarcarStock(ref, tokens, title, body) {
  if (tokens.length > 0) {
    try {
      const resp = await messaging.sendEachForMulticast({
        notification: { title, body },
        tokens,
      });
      console.log(`📨 "${title}" → ${resp.successCount} ok, ${resp.failureCount} fallidos`);

      // Limpiar tokens inválidos/vencidos para no acumular basura
      resp.responses.forEach((r, i) => {
        if (!r.success && (
          r.error?.code === 'messaging/registration-token-not-registered' ||
          r.error?.code === 'messaging/invalid-registration-token'
        )) {
          db.collection('dispositivos').doc(tokens[i]).delete().catch(() => {});
        }
      });
    } catch (e) {
      console.error('Error enviando FCM:', e);
    }
  }
  await ref.update({ ultimaAlertaStockBajo: Date.now() });
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error fatal:', e); process.exit(1); });
