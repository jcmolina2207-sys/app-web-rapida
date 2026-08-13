# 🍰 Toque Artesano de Sofi

PWA de gestión integral para una pastelería casera: pedidos, cobros, stock,
recetas con costo real, gastos fijos, notas y clientes — sincronizada en
tiempo real entre el celular de Sofía y el dispositivo del admin (Juan),
con notificaciones push que llegan aunque la app esté cerrada.

> Este documento es la referencia **técnica** del proyecto (arquitectura,
> pantallas, funciones, modelo de datos). Para la guía de uso pensada para
> Sofía, ver el manual en PDF. Para dejar andando las notificaciones push,
> ver `SETUP.md`.

---

## 1. Arquitectura

| Capa | Detalle |
|---|---|
| **Frontend** | Un solo archivo `index.html` (SPA) con CSS y JS embebidos, ~6000 líneas. Sin build step, sin framework: JS vanilla + `innerHTML` para renderizar pantallas. |
| **Service Worker** | `sw.js` real (no blob URL) — necesario para notificaciones programadas y push en background. |
| **Backend** | Firebase Firestore (SDK *compat* v10.12.0). Todo vive bajo un documento raíz `app`, con una colección por tipo de dato. |
| **Sync** | Listeners `onSnapshot` en tiempo real entre los dos dispositivos. Si Firestore no responde en 5s, cae a `localStorage`. Conflictos se resuelven por timestamp (gana el más reciente). |
| **Auth** | Firebase Anonymous Auth (`signInAnonymously()`), silenciosa — no hay pantalla de login. Existe solo para poder cerrar las reglas de Firestore a `request.auth != null`. |
| **Notificaciones locales** | Resumen 7am y recordatorio de notas 23hs, programadas al Service Worker vía `SCHEDULE_NOTIFICATION`. |
| **Notificaciones push reales** | GitHub Actions (cron cada 10 min) + Firebase Admin SDK + FCM — ver `send-notifications.js` y `SETUP.md`. No requiere plan Blaze ni Cloud Functions. |

### Colecciones en Firestore

`pedidos` · `ingredientes` · `papeleria` · `movimientos` · `notas` ·
`recetas` · `catalogo` · `gastosFijos` · `dispositivos` (tokens FCM)

---

## 2. Las 6 pantallas

La navegación inferior (`bottom-nav`) tiene 6 tabs, controladas por
`navigate(screen)` / `renderScreen(screen)` sobre el arreglo:

```js
const screens = ['inicio','pedidos','costos','finanzas','notas','clientes'];
```

### 🏠 Inicio — `renderInicio()`
Dashboard con accesos rápidos y una serie de **banners de estado** que se
autogeneran según la situación del negocio:
- `renderAtrasadosBanner()` — pedidos con fecha de entrega ya vencida y no marcados como entregados.
- `renderGastosFijosBanner()` — gastos fijos próximos a vencer o vencidos.
- `renderBackupBanner()` — recuerda descargar un backup si pasó mucho tiempo desde el último (`diasSinBackup()`).
- `renderNotifBanner()` — invita a activar notificaciones si todavía no están prendidas.

### 📦 Pedidos — `renderPedidos()`
- Vista lista o vista **agenda semanal** (`pedidoVistaAgenda`, `semanaDias()`, `renderPedidosAgenda()`).
- Filtros por estado y por pago mediante `<select>` (`chipEstado`, `chipPago`, `setPedidoFiltroEstado`, `setPedidoFiltroPago`).
- Búsqueda de texto libre (`setPedidoBusqueda`, usa `normalizarTexto()` + `.includes()`), con la posición del cursor preservada entre renders.
- Alta/edición de pedido multi-producto: `openPedidoForm()`, autocompletado de cliente y producto (`crearAutocomplete()`, `initClienteAutocomplete()`, `initProductoAutocomplete()`), ítems por porción con descuento proporcional de stock (`admitePorcion`, `agregarItemPedido`).
- **Importar pedido desde WhatsApp**: pegando el texto tal cual, o subiendo una **captura de pantalla** que se convierte a texto con OCR en el navegador (Tesseract.js, cargado on-demand: `cargarTesseract()`, `onImportImagenSeleccionada()`), y luego se parsea automáticamente en uno o varios pedidos (`analizarTextoImportado()`, `armarPedidoDesdeBuffer()`, `extraerPedidosDeSeccion()`). Nada se guarda solo: siempre hay una revisión manual antes de confirmar.
- Compartir el pedido por WhatsApp con link directo `wa.me` (`compartirPedidoWhatsApp()`).
- Registrar pago parcial/total (`openRegistrarPago`, `registrarPago`, `togglePagoCompletoPedido`) y marcar como entregado (`marcarEntregado`), lo que genera automáticamente un movimiento de ingreso (`generarIngresoAutoSiEntregado()`) y descuenta materia prima del stock según la receta (`descontarMateriaPrimaByPedido()`), con reversión si se deshace (`revertirMateriaPrimaByPedido()`).

### 🧾 Costos (pestaña consolidada, 3 sub-tabs con chips)
Navegación interna vía `setCostosSubtab()` / `navigateCostos(tab)`.

- **Ingredientes** — `renderIngredientes()`, `ingredienteItem()`. Alta/edición con costo unitario (`openIngredienteForm`, `saveIngrediente`), reposición rápida de stock (`openSumarStock`, `sumarStock`), semáforo visual de stock (`stockPct`, `stockColor`).
- **Recetas** — `renderRecetasList()`, `openRecetaForm()`. Cada receta liga ingredientes + cantidades + rendimiento (`agregarIngReceta`, `unidadesCompatibles`, `convertirCantidad`). Al lado del nombre de cada receta se muestra un **badge de margen** en vivo (`renderMargenBadgeReceta()`, color según `margenColor()`) que abre un modal con el detalle costo real vs. precio (`openMargenRecetaModal()`).
- **Gastos fijos** — `renderGastosFijosList()`, alta/edición/pago (`openGastoFijoForm`, `saveGastoFijo`, `marcarGastoFijoPagado`), y el botón de configuración de horas productivas/valor hora (`openConfigCostosForm`, `saveConfigCostos`) usado para prorratear costo fijo por hora (`costoFijoPorHoraProductiva()`) y costo de gas por minuto de horno (`costoGasPorMinuto()`).

**Motor de costos real** (`calcularCostoReceta`, `calcularGananciaPedido`,
`calcularMargenProducto`, `calcularTodosLosMargenes`): hoy calcula materia
prima + ajuste por merma (`mermaPct`) por unidad vendida; mano de obra y
gastos fijos quedan listos para sumarse cuando se cargue el tiempo real por
receta (`datosFaltantesReceta()` señala qué le falta a cada receta para un
costo confiable).

### 💰 Finanzas — `renderFinanzas()`
- Vista lista o **agrupada por día** (`finanzasVista`, `renderMovsPorDia()`, `toggleDiaFinanza()`), con calendario semanal navegable (`renderFinanzasCalendario`, `cambiarSemanaFinanzas`).
- Ganancia/pérdida mostrada entre paréntesis por movimiento y por día (`gananciaPctMovimiento()`).
- Alta manual de ingreso/egreso (`openMovimientoForm`, `saveMovimiento`, con autocompletado de descripción `initMovDescAutocomplete()`); edición y borrado (`openEditMovimiento`, `confirmEliminarMovimiento`).
- Reportes: comparativa por semana (`calcularIngresosEgresosPorSemana`), top productos por cantidad e ingresos (`calcularTopProductosPorCantidad/Ingresos`), gráfico de barras (`renderBarChartFinanzas`) — todo en `renderReportes()`.

### 📝 Notas — `renderNotas()`
Notas libres con fecha (`openNotaForm`, `saveNota`, `confirmEliminarNota`);
la última nota del día se usa en el resumen de las 7am (`lastNota()`).

### 👥 Clientes — `renderClientes()`
Se derivan de los pedidos, no es una colección propia: `getClientes()`
agrupa por nombre normalizado (`normalizarTexto()`), ordena por monto total
gastado, y expone historial y teléfono del pedido más reciente
(`openClienteDetalle()`, `buscarTelefonoCliente()`). Búsqueda de texto libre
igual que en Pedidos (`setClienteBusqueda`). `marcarTodosPagados()` salda
todos los pedidos pendientes de un cliente de una sola vez.

> ⚠️ **Deuda técnica pendiente**: `openClienteDetalle` está definida dos
> veces en el archivo (línea ~5481 y ~5538); la segunda pisa a la primera en
> tiempo de ejecución (JS no tira error, simplemente la última definición
> gana). No afecta el funcionamiento actual, pero conviene limpiar la
> definición muerta en una futura sesión.

---

## 3. Notificaciones

| Notificación | Disparador | Mecanismo |
|---|---|---|
| Resumen diario 7am | Todos los días | Local, vía Service Worker (`scheduleNotifViaSW`, se reprograma solo) |
| Recordatorio de notas 23hs | Todos los días | Local, vía Service Worker |
| 1h / 15min antes de un pedido | Por cada pedido con `hora` cargada | **Push real vía FCM**, disparado por GitHub Actions cada 10 min (`send-notifications.js`) — funciona con la app cerrada |
| Stock bajo | Ingrediente por debajo del 30% de su stock ideal | Push real vía FCM, con anti-duplicado de 24hs (`ultimaAlertaStockBajo`) |

El botón de campana (`toggleNotificaciones`, `activarNotificaciones`,
`updateBellIcon`) pide permiso del navegador, registra el token FCM del
dispositivo en la colección `dispositivos` (`registrarTokenFCM`) y programa
las notificaciones locales. El detalle de puesta en marcha (service
account, VAPID key, secret de GitHub) está en `SETUP.md`.

---

## 4. Backup y datos

- `exportarDatos()` — descarga un `.json` con todas las colecciones + config.
- `importarDatos()` / `handleImportFile()` — carga un `.json` de vuelta.
- `restaurarBackupEnFirestore()` — sube ese backup a Firestore.
- `renderBackupBanner()` recuerda hacer backup si pasaron muchos días
  (`diasSinBackup()`), guardando la fecha del último en `localStorage`.

---

## 5. Ejemplo práctico de uso — de mensaje de WhatsApp a plata en la cuenta

1. Sofía recibe por WhatsApp: *"Hola! Te hago un pedido de una docena de
   churros DDL y un lemon pie para el sábado a las 17hs, soy Marisa"*.
2. En **Pedidos → botón importar (📥)**, pega ese texto (o sube la captura
   de pantalla y deja que el OCR lo convierta a texto).
3. Toca **Analizar** → la app arma automáticamente un borrador de pedido:
   cliente *Marisa*, dos productos con sus precios de catálogo, fecha
   `sábado` resuelta a la fecha real, hora `17:00`.
4. Sofía revisa el borrador, ajusta si hace falta, y guarda (`savePedido`).
   El pedido aparece en la agenda semanal de Pedidos.
5. El día del pedido, GitHub Actions detecta que faltan 60 y 15 minutos
   para la entrega y le manda un push a los dos celulares.
6. Marisa paga por transferencia al retirar. Sofía abre el pedido →
   **Registrar pago** → marca pago completo (`registrarPago` /
   `togglePagoCompletoPedido`).
7. Sofía toca **Marcar entregado** (`marcarEntregado`): esto genera
   automáticamente un ingreso en Finanzas por el monto del pedido
   (`generarIngresoAutoSiEntregado`) y descuenta del stock la harina,
   manteca, dulce de leche, etc. que usan esas recetas
   (`descontarMateriaPrimaByPedido`).
8. En **Costos → Recetas**, el badge de margen de "Docena churros DDL" y
   "Lemon pie" ya refleja el costo real de esos ingredientes descontados.
9. En **Clientes**, Marisa aparece con el total gastado actualizado y ese
   pedido en su historial.

---

## 6. Estructura de archivos del repo

```
/index.html                          → toda la app (frontend)
/sw.js                                → Service Worker (notificaciones)
/scripts/send-notifications.js        → cron de push real (GitHub Actions)
/scripts/package.json                 → dependencias del script (firebase-admin)
/.github/workflows/notificaciones.yml → workflow de GitHub Actions
/SETUP.md                             → guía paso a paso de notificaciones push
```

## 7. Principios de trabajo en este proyecto

- **Ediciones quirúrgicas, no reescrituras**: los cambios son diffs
  find-and-replace acotados a funciones puntuales; la lógica de cálculo
  existente no se toca salvo que esté explícitamente en el alcance del
  pedido.
- **Normalización solo en lectura**: `normalizarTexto()` se aplica al
  agrupar/buscar, nunca sobre los datos crudos guardados.
- **Fuente de verdad**: Firestore primero, `localStorage` como respaldo;
  gana el dato con timestamp más reciente.
- **Todo en el plan gratuito**: Firebase Spark, FCM y GitHub Actions se
  usan siempre dentro de sus límites free.
