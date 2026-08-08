/* ============================================================
   MIGRACIÓN: de "un doc con array" a "una colección con un doc
   por item" en Firestore.

   CÓMO CORRERLO (una sola vez):
   1. Subí primero el index.html nuevo (el que ya guarda por
      documento) y abrilo en el navegador, con Sofi conectada
      a internet, para que Firebase esté inicializado.
   2. Abrí la consola de DevTools (F12 → pestaña "Console").
   3. Pegá TODO el contenido de este archivo y presioná Enter.
   4. Escribí:  migrarASubcolecciones()   y Enter.
   5. Esperá el mensaje "🎉 Migración completa" (mira el log,
      te dice cuántos documentos migró de cada colección).
   6. Andá a la consola de Firebase (console.firebase.google.com)
      → Firestore Database → y confirmá a ojo que aparecen
      pedidos/{id}, ingredientes/{id}, etc. como documentos
      sueltos, con los datos correctos.
   7. Recién ENTONCES, opcionalmente, borrá los documentos viejos
      app/pedidos, app/ingredientes, app/movimientos, app/notas,
      app/recetas, app/catalogo, app/gastosFijos (los que tenían
      el array completo adentro). NO borres app/meta ni
      app/config, esos se siguen usando igual que antes.

   Es seguro correrlo más de una vez: sobreescribe (set) los
   mismos IDs, no duplica nada.
============================================================ */

async function migrarASubcolecciones() {
  if (typeof db === 'undefined') {
    console.error('❌ No encuentro la variable `db` de Firestore. Corré esto con la app abierta en el navegador.');
    return;
  }

  const cols = ['pedidos', 'ingredientes', 'movimientos', 'notas', 'recetas', 'catalogo', 'gastosFijos'];
  const resumen = {};

  for (const col of cols) {
    const oldDoc = await db.collection('app').doc(col).get();
    if (!oldDoc.exists) {
      console.log(`(sin datos viejos en app/${col}, se omite)`);
      resumen[col] = 0;
      continue;
    }
    const items = oldDoc.data().items || [];
    console.log(`Migrando ${items.length} items de "${col}"...`);

    let migrados = 0;
    for (let i = 0; i < items.length; i += 400) {
      const batch = db.batch();
      items.slice(i, i + 400).forEach(item => {
        // El catálogo no tiene id numérico: se identifica por 'nombre'.
        const docId = col === 'catalogo'
          ? encodeURIComponent(String(item.nombre || '').trim().toLowerCase())
          : String(item.id);

        if (!docId || docId === 'undefined' || docId === 'null' || docId === '') {
          console.warn(`⚠️ Item sin id/nombre válido en "${col}", se omite:`, item);
          return;
        }
        batch.set(db.collection(col).doc(docId), item);
        migrados++;
      });
      await batch.commit();
    }
    resumen[col] = migrados;
    console.log(`✅ "${col}" migrado: ${migrados} documentos`);
  }

  console.log('🎉 Migración completa. Resumen:', resumen);
  console.log('👉 Ahora andá a la consola de Firebase y verificá los datos ANTES de borrar los docs viejos (app/pedidos, app/ingredientes, etc).');
}

// Para correr: migrarASubcolecciones()
window.migrarASubcolecciones = migrarASubcolecciones;
