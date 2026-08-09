# Notificaciones confiables sin Cloud Functions ni plan Blaze

## Cómo queda armado

- **Antes:** el Service Worker programaba `setTimeout` para avisar 1h/15min
  antes de cada pedido → se perdía si el navegador quedaba inactivo.
- **Ahora:** un workflow de GitHub Actions corre cada 10 min, revisa
  Firestore, y si hay un pedido por entregarse le manda un **push real**
  a través de FCM. Ese push lo entrega el sistema operativo del celular,
  no depende de que la pestaña esté abierta ni de timers en JS.
- El resumen de las 7am y el recordatorio de notas siguen igual que antes
  (local, vía SW) — no dependen de esto.

## 1. Service account de Firebase — ¿requiere Blaze? **No.**

Los service accounts son gratis en cualquier plan, incluido Spark. Solo dan
permisos de administrador para tu propio proyecto; no habilitan ni cobran
por ningún servicio nuevo.

1. Andá a [console.firebase.google.com](https://console.firebase.google.com/) → tu proyecto `toque-artesano`.
2. ⚙️ **Configuración del proyecto** → pestaña **Cuentas de servicio**.
3. Click en **Generar nueva clave privada** → se descarga un `.json`.
4. **No subas ese archivo al repo.** Vas a pegar su contenido en un GitHub
   Secret (paso 3).

Ese `.json` le da a tu script acceso de administrador a Firestore y a FCM
de tu propio proyecto — ambos incluidos gratis en Spark.

## 2. VAPID key para Web Push — ¿requiere Blaze? **No.**

1. En el mismo proyecto: ⚙️ **Configuración del proyecto** → pestaña
   **Cloud Messaging**.
2. Bajá hasta **"Certificados push web"** → **Generar par de claves**.
3. Copiá la clave y pegala en `index.html`, reemplazando:
   ```js
   const FCM_VAPID_KEY = "PEGA-ACA-TU-VAPID-KEY";
   ```

## 3. GitHub Secret con la credencial

1. En tu repo de GitHub: **Settings → Secrets and variables → Actions →
   New repository secret**.
2. Nombre: `FIREBASE_SERVICE_ACCOUNT_JSON`
3. Valor: pegá el **contenido completo** del `.json` del paso 1 (tal cual,
   sin modificarlo).
4. Guardar. Este secret queda cifrado, nunca aparece en logs ni en el
   código del repo.

## 4. Subir los archivos

Estructura que tenés que tener en el repo:

```
/index.html
/sw.js
/scripts/send-notifications.js
/scripts/package.json
/.github/workflows/notificaciones.yml
```

El workflow ya está configurado para instalar dependencias (`firebase-admin`)
solo, no hace falta subir `node_modules`.

## 5. Minutos gratis de GitHub Actions — **la única letra chica real**

- **Repo público:** minutos de Actions **ilimitados y gratis**. Podés dejar
  el cron cada 10 min sin preocuparte por nada. Recomendado si no te
  molesta que el código (sin credenciales, esas están en Secrets) sea
  visible.
- **Repo privado:** el plan gratis de GitHub da **2.000 minutos/mes**.
  Cada corrida del cron consume mínimo 1 minuto (aunque tarde 10
  segundos, GitHub redondea para arriba). Cada 10 min = ~4.320
  corridas/mes → **se pasa del límite gratis**. Opciones:
  - Poner el repo en público (el `.json` de la credencial NUNCA está en
    el código, solo en Secrets — es seguro).
  - O cambiar el cron a cada 30 min (`*/30 * * * *` en el `.yml`) →
    ~1.440 min/mes, entra cómodo en el free tier. Las ventanas de
    detección en `send-notifications.js` ya tienen margen para eso.

No hace falta tarjeta de crédito en GitHub para el plan gratis; si algún
día te pasás de minutos en un repo privado, GitHub simplemente deja de
correr el workflow ese mes (no te cobra nada sin que lo autorices
explícitamente vos primero).

## 6. Probar

1. Hacé push de todo al repo.
2. Abrí la app, activá notificaciones (esto guarda tu token FCM en
   Firestore, colección `dispositivos`).
3. Creá un pedido con `hora` de entrega dentro de la próxima hora.
4. En GitHub → pestaña **Actions** → el workflow "Notificaciones de
   pedidos" → **Run workflow** (botón manual, no hace falta esperar al
   cron) para probarlo al toque.
5. Deberías recibir el push aunque cierres la pestaña del navegador.

## Resumen de costos — todo gratis, sin tarjeta en ningún lado

| Componente | Plan necesario | Costo |
|---|---|---|
| Firestore (lectura/escritura de pedidos y tokens) | Spark | Gratis (cuotas diarias generosísimas para una pastelería) |
| FCM (envío de push) | Spark | 100% gratis, sin límite práctico |
| Service account | Cualquiera | Gratis |
| VAPID key | Cualquiera | Gratis |
| GitHub Actions (repo público) | Free | Gratis, minutos ilimitados |
| GitHub Actions (repo privado) | Free | Gratis hasta 2.000 min/mes — ajustá el cron para no pasarte |
