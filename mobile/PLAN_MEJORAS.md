# Plan de Mejoras — PesoSSmart

> **Estado actual (Sep 2026):** App en beta en TestFlight. Fase de pulido de UI para que los usuarios beta puedan probar correctamente. Una vez cerrado el pulido de UI, se atacan las mejoras de producto en orden de prioridad.

---

## ✅ FASE 1 — COMPLETADA (código + migraciones)

**Fecha:** Sep 2026

Todo el código de Fase 1 está implementado. Las 3 migraciones SQL ya fueron corridas en producción.

### Pasos pendientes de deploy (NO correr el código, ya está — solo deploy):

**Paso 2 — Configurar app en Azure (para Outlook):**
- Entrar a portal.azure.com → Azure Active Directory → App registrations
- Crear nueva app (o usar existente con ID `c44b4083-3bb0-49c1-b47d-974e53cbdf3c`)
- En Authentication → Supported account types → cambiar a **"Accounts in any organizational directory (Multitenant) and personal Microsoft accounts"**
- En Authentication → Redirect URIs → agregar: `https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/outlook-auth`
- En Certificates & secrets → crear nuevo client secret
- Anotar el Application (client) ID y el client secret

**Paso 3 — Setear secrets en Supabase:**
```bash
cd mobile
npx supabase secrets set MICROSOFT_CLIENT_ID=<client-id-de-azure>
npx supabase secrets set MICROSOFT_CLIENT_SECRET=<client-secret-de-azure>
```

**Paso 4 — Deployar edge functions:**
```bash
cd mobile
npx supabase functions deploy gmail-poll
npx supabase functions deploy outlook-auth --no-verify-jwt
npx supabase functions deploy outlook-poll
npx supabase functions deploy outlook-cron-dispatcher --no-verify-jwt
npx supabase functions deploy auto-confirm-transactions --no-verify-jwt
```

**Paso 5 — Verificar Vault (secret para crons):**
- En Supabase Dashboard → Database → Vault → confirmar que existe el secret `internal_fn_secret`
- Si no existe, correr en SQL Editor:
  ```sql
  SELECT vault.create_secret('<valor-de-INTERNAL_FN_SECRET>', 'internal_fn_secret');
  ```

> **Nota Outlook:** La conexión de Outlook solo funciona con cuentas `@outlook.com`, `@hotmail.com` o `@live.com`. No soporta Gmail. Es una feature opcional — si el usuario no conecta Outlook, no rompe nada.

### Qué se implementó en Fase 1:
- `045_gmail_cron.sql` — columnas `token_expired` + `is_backfill_done` en `gmail_connections`, cron horario ✅ corrida
- `046_outlook_connections.sql` — tabla `outlook_connections`, cron horario :30 ✅ corrida
- `047_auto_confirm.sql` — columna `high_confidence` en `pending_transactions`, cron cada 6h ✅ corrida
- `gmail-cron-dispatcher` — dispatcher que llama gmail-poll para cada usuario activo
- `outlook-cron-dispatcher` — idem para Outlook
- `gmail-poll` — reescrito: dual auth (JWT + cron), backfill 6 meses, PDF parsing, high_confidence
- `outlook-auth` — flujo OAuth Microsoft completo (CSRF, token exchange, encrypt)
- `outlook-poll` — misma pipeline que gmail-poll para Microsoft Graph API
- `auto-confirm-transactions` — confirma high_confidence > 24h sin actividad del usuario
- `outlook-connect.tsx` — pantalla nueva con branding azul (#0078D4) y banner de backfill
- `gmail-connect.tsx` — agrega banner de backfill post-conexión
- `profile.tsx` — Gmail "Sincronizar ahora" + sección Outlook completa (conectado/desconectado)
- `home.tsx` — card "Balance del mes" (ingresos confirmados − gastos), visible solo si hay ingresos
- `PendingTransactions.tsx` — sección de ingresos separada, badge "Clasificado automáticamente"

---

## FASE 0 — Pulido de UI (TestFlight beta, PRIORIDAD ACTUAL)

Antes de atacar las mejoras de producto, se necesita que la UI esté pulida para que los usuarios beta tengan una buena experiencia. Esta fase es corta y cubre detalles visuales, flujos rotos, y small bugs de interacción. Se trabaja primero en esta fase y luego se avanza a las fases siguientes.

---

## FASE 1 — Integración con email/bancos

### Problema 1 — Gmail polling solo cuando el usuario abre la app
**Área:** Integración Gmail / Edge Functions  
**Impacto:** Crítico  
**Tiempo estimado:** 1 día

**Descripción del problema:**  
La función `gmail-poll` solo se invoca cuando el usuario abre la pantalla de movimientos. Si el usuario no abre la app en 5 días, llega a 40+ transacciones sin clasificar acumuladas, lo que genera abandono. Mercado Pago detecta cada transacción en segundos de forma completamente automática. Este gap hace que la integración con Gmail se sienta "manual" en comparación.

**Solución:**  
Crear un cron job en Supabase usando `pg_cron` que llame a `gmail-poll` cada 30 minutos para todos los usuarios que tengan una fila activa en `gmail_connections` (donde `token_expired = false`). La función `gmail-poll` ya tiene la lógica de rate-limiting de 60 segundos por usuario, deduplicación por `raw_subject`, y push notification cuando detecta nuevos gastos — todo sigue funcionando igual. El botón manual de "sincronizar" queda como pull opcional. En producción se puede empezar con un intervalo de 1 hora para no quemar API calls de Gmail y bajar a 30 min si la demanda lo justifica.

**Archivos involucrados:**
- `mobile/supabase/migrations/` — nueva migración con el cron job
- `mobile/supabase/functions/gmail-poll/index.ts` — verificar que funcione invocada sin sesión de usuario (service role)

---

### Problema 2 — Solo procesa 20 emails por poll, sin backfill histórico
**Área:** Edge Function gmail-poll  
**Impacto:** Alto  
**Tiempo estimado:** 2 horas

**Descripción del problema:**  
El batch size está hardcodeado en 20. Si el usuario estuvo 10 días sin abrir la app, o si acaba de conectar Gmail, solo ve los últimos 20 emails. Transacciones más antiguas se pierden permanentemente. Un usuario nuevo que conecta Gmail hoy no puede recuperar 3 meses de historial de gastos.

**Solución:**  
Subir el batch a 100 en polls normales. En el primer poll (cuando `last_checked_at IS NULL` en `gmail_connections`), hacer un backfill sin límite de batch que cubra hasta 6 meses hacia atrás. Después del backfill, setear `last_checked_at` normalmente. Esto le da al usuario valor inmediato al conectar — puede ver todos sus gastos históricos clasificados desde el primer momento.

**Archivos involucrados:**
- `mobile/supabase/functions/gmail-poll/index.ts` — constante de batch size, lógica de fecha de inicio

---

### Problema 3 — Solo soporta Gmail, Hotmail/Outlook es ignorado
**Área:** Nueva integración  
**Impacto:** Alto  
**Tiempo estimado:** 3-4 días

**Descripción del problema:**  
Gran parte de los adultos argentinos tiene `@hotmail.com` o `@outlook.com` vinculado a su banco. Si no tienen Gmail conectado a las notificaciones bancarias, la integración automática no existe para ellos. Esto excluye a una porción significativa del mercado objetivo.

**Solución:**  
Agregar OAuth con Microsoft (MSAL — Microsoft Authentication Library). El flujo es casi idéntico al de Google: pantalla de OAuth, tokens encriptados en Supabase, polling periódico. La función de parseo puede ser la misma ya que los emails de bancos argentinos tienen el mismo formato independientemente de si llegan a Gmail o Outlook. Requiere: nueva edge function `outlook-poll`, nueva pantalla de conexión en `(app)/outlook-connect.tsx`, tabla `outlook_connections` (igual que `gmail_connections`), y agregar al cron job.

**Archivos involucrados:**
- `mobile/supabase/functions/outlook-poll/` — nueva función (clonar gmail-poll, cambiar API de Gmail por Microsoft Graph API)
- `mobile/app/(app)/outlook-connect.tsx` — pantalla de conexión
- `mobile/supabase/migrations/` — tabla outlook_connections + políticas RLS

---

### Problema 4 — Los ingresos detectados son completamente ignorados
**Área:** gmail-poll / modelo de datos  
**Impacto:** Alto  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
Las `transferencia_recibida` (acreditaciones de sueldo, cobros freelance, devoluciones) se descartan en `gmail-poll` por diseño. El usuario no puede ver sus ingresos detectados automáticamente. Sin datos de ingresos reales, el balance neto del mes no se puede calcular, y la app solo muestra el lado del gasto. La comparación "ingresos vs gastos" es uno de los features más valorados en apps de finanzas personales.

**Solución:**  
En lugar de descartar las `transferencia_recibida`, guardarlas con `direction = 'incoming'` en `pending_transactions` (o en una tabla dedicada `income_events`). Mostrar en el home card el balance neto del mes: ingresos detectados − gastos totales. El usuario puede confirmar o ignorar cada ingreso detectado, igual que con los gastos. Agregar separación visual clara entre ingresos y gastos en el flujo de pendientes.

**Archivos involucrados:**
- `mobile/supabase/functions/gmail-poll/index.ts` — eliminar el early return para transferencias recibidas
- `mobile/supabase/migrations/` — agregar campo `direction` a `pending_transactions` si no existe
- `mobile/app/(app)/home.tsx` — mostrar balance neto
- `mobile/src/components/PendingTransactions.tsx` — separar vista de ingresos y gastos

---

### Problema 5 — No parsea PDF adjuntos de bancos
**Área:** Edge Function gmail-poll  
**Impacto:** Medio  
**Tiempo estimado:** 3-4 días

**Descripción del problema:**  
Galicia, Santander y BBVA envían el resumen mensual de tarjeta como PDF adjunto. Un solo resumen puede contener 20-50 transacciones. Actualmente `gmail-poll` ignora completamente los adjuntos, perdiendo una fuente masiva de datos de gastos históricos.

**Solución:**  
En `gmail-poll`, antes de procesar el cuerpo del email, detectar si hay adjuntos con `mimeType: 'application/pdf'`. Si hay adjunto PDF: bajar el base64 del adjunto, enviarlo a un modelo de visión (Groq o alternativa) para OCR, y pasar el texto extraído por el mismo pipeline de parseo de emails. El resultado son múltiples `pending_transactions` generadas desde un único email de resumen.

**Archivos involucrados:**
- `mobile/supabase/functions/gmail-poll/index.ts` — lógica de detección y descarga de adjuntos, llamada a OCR

---

### Problema 6 — Sin auto-confirmación para transacciones de alta confianza
**Área:** gmail-poll / PendingTransactions  
**Impacto:** Medio  
**Tiempo estimado:** 1 día

**Descripción del problema:**  
Después de un mes de uso, el usuario puede acumular 60-80 transacciones pendientes porque cada una requiere confirmación manual. El volumen mata el hábito: los usuarios que ven muchas pendientes tienden a ignorar la clasificación y el valor de la app se degrada. El sistema ya aprende de comerciantes vía `merchant_category_hints` pero nunca actúa sobre ese aprendizaje.

**Solución:**  
Si un merchant tiene 2+ ocurrencias en `merchant_category_hints` con la misma categoría y el monto está dentro de ±30% del histórico, marcar la transacción como "alta confianza". Después de 24 horas sin acción del usuario, auto-confirmarla con la categoría aprendida. Enviar una notificación: "Clasificamos 8 gastos automáticamente — revisalos si querés". El usuario puede siempre editar o rechazar una transacción auto-confirmada.

**Archivos involucrados:**
- `mobile/supabase/functions/gmail-poll/index.ts` — agregar flag `high_confidence` al insertar en pending_transactions
- `mobile/supabase/migrations/` — cron job para auto-confirmar transacciones con high_confidence y > 24h
- `mobile/src/components/PendingTransactions.tsx` — indicador visual de "auto-clasificado"

---

## FASE 2 — Captura automática multi-canal

> Objetivo: que el usuario pueda registrar gastos sin abrir la app, desde cualquier plataforma y dispositivo. Cada canal nuevo es independiente del resto — se pueden implementar en paralelo o en cualquier orden.

### Problema 7 — WhatsApp: registro de gastos por foto de ticket
**Área:** Nueva integración / Edge Functions  
**Impacto:** Alto  
**Tiempo estimado:** 4-5 días

**Descripción del problema:**  
Los gastos en efectivo y compras en comercios físicos que no generan email del banco no se pueden capturar automáticamente. El usuario debe abrir la app y cargarlos a mano. Esto cubre la mayoría de los gastos cotidianos: supermercado, verdulería, restaurante, taxi.

**Solución:**  
Integración con WhatsApp Business API (Meta Cloud API). El usuario vincula su número de teléfono una sola vez: desde la app genera un código (ej: `PESOS-4821`) y lo manda al número de WhatsApp de PesoSSmart. A partir de ahí, puede enviarle fotos de tickets al número y el sistema los registra automáticamente.

Flujo técnico:
1. Meta dispara webhook POST a `whatsapp-webhook`
2. La función verifica la firma HMAC de Meta
3. Descarga la imagen de los servidores de Meta
4. La envía a Groq Vision para extraer: merchant, monto, fecha, categoría
5. Guarda en `pending_transactions`
6. Responde al usuario por WhatsApp: "✅ Coto · $15.230 · supermercado — ¿Confirmar? SÍ / NO"
7. Si el usuario responde SÍ, confirma la transacción

La edge function `whatsapp-webhook` se despliega con `--no-verify-jwt` y valida la firma HMAC de Meta (mismo patrón que `mp-webhook`). Los mensajes de texto también pueden procesarse: si el usuario escribe "compré $500 en YPF" sin foto, también se parsea y registra.

**Archivos involucrados:**
- `mobile/supabase/functions/whatsapp-webhook/index.ts` — nueva edge function
- `mobile/supabase/migrations/` — columna `whatsapp_phone` en `profiles`, tabla `whatsapp_link_codes`
- `mobile/app/(app)/profile.tsx` — botón "Vincular WhatsApp" con generación de código
- Secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_SECRET`

---

### Problema 8 — Android Notification Listener: captura automática desde apps bancarias
**Área:** React Native / Android  
**Impacto:** Alto  
**Tiempo estimado:** 3-4 días

**Descripción del problema:**  
Todos los bancos argentinos (Galicia, BBVA, Santander, Macro, Brubank, Ualá) envían push notifications a su propia app para cada transacción con tarjeta. Mensajes como "Compraste $5.200 en YPF" o "Débito $12.500 en Coto · Visa" aparecen en el celular del usuario en tiempo real, pero PesoSSmart no puede leerlos. Los usuarios que tienen las apps bancarias instaladas pero no tienen email de notificaciones configurado quedan sin cobertura.

**Solución:**  
Implementar un servicio en background usando `react-native-notification-listener` (o módulo nativo) que escucha notificaciones de apps bancarias conocidas. El usuario concede el permiso `BIND_NOTIFICATION_LISTENER_SERVICE` una sola vez desde la pantalla de configuración. Cuando llega una notificación de una app bancaria detectada, el servicio parsea el texto con los mismos patrones regex ya en `_shared/bankParsers.ts` y llama a una edge function para guardar el `pending_transaction`. Si no puede parsear la notificación, la ignora silenciosamente.

La lista de package names de apps bancarias argentinas a monitorear se define en el cliente (ej: `ar.com.bna.bancamovil`, `com.galicia.android`, etc.) — solo Android, iOS bloquea esto a nivel sistema.

**Archivos involucrados:**
- `mobile/supabase/functions/android-notif-ingest/index.ts` — nueva edge function (verify_jwt=true, recibe datos del cliente)
- `mobile/src/services/NotificationListenerService.ts` — nuevo servicio nativo Android
- `mobile/app/(app)/profile.tsx` — sección "Conectar notificaciones del banco", flujo de solicitud de permiso
- `mobile/android/` — configuración del servicio en AndroidManifest.xml

---

### Problema 9 — Share Extension: compartir notificación bancaria a la app (iOS + Android)
**Área:** React Native / iOS + Android  
**Impacto:** Medio  
**Tiempo estimado:** 3-4 días

**Descripción del problema:**  
iOS no permite leer notificaciones de otras apps de forma programática. La alternativa más cercana es una Share Extension: el usuario mantiene presionada una notificación del banco o un screenshot de la app bancaria, elige "Compartir" y selecciona PesoSSmart. La app recibe el texto o imagen y lo procesa. Es un paso manual, pero mucho más rápido que abrir la app y cargar el gasto a mano. En Android funciona como complemento del notification listener para usuarios que prefieren no dar el permiso amplio.

**Solución:**  
Implementar una Share Extension en iOS (nuevo target en Xcode) y un intent handler en Android. Cuando el usuario comparte texto (contenido de una notificación), se parsea con `bankParsers.ts`. Cuando comparte una imagen (screenshot de la app bancaria o foto de ticket), se envía a Groq Vision igual que en el flujo de WhatsApp. En ambos casos, se muestra un mini-UI dentro del share sheet para que el usuario confirme o ajuste el gasto antes de guardarlo.

Para iOS, la Share Extension tiene acceso a una URL hardcodeada de la edge function `process-screenshot` (ya existente) para procesar imágenes, y a `android-notif-ingest` para texto.

**Archivos involucrados:**
- iOS: nuevo target ShareExtension en `mobile/ios/`
- Android: intent filter en `mobile/android/app/src/main/AndroidManifest.xml`
- `mobile/supabase/functions/process-screenshot/index.ts` — reutilizar para imágenes compartidas (ya existe)
- Shared parsing reutiliza `_shared/bankParsers.ts`

---

### Problema 10 — iOS Shortcuts: automatización de alertas bancarias (baja prioridad)
**Área:** iOS / Edge Functions  
**Impacto:** Bajo-Medio  
**Tiempo estimado:** 1-2 días

**Descripción del problema:**  
La app de Atajos de iOS permite crear automatizaciones personales disparadas por notificaciones de apps específicas ("Cuando recibo una notificación de Galicia → ejecutar acción"). Esto aproxima el comportamiento del Android Notification Listener en iOS, pero requiere que el usuario configure el atajo una sola vez. Es el método de menor fricción disponible en iOS para captura automática sin abrir la app.

**Solución:**  
Crear una edge function `ios-shortcut-ingest` (`--no-verify-jwt`, valida un token personal por usuario) que recibe el texto de la notificación bancaria y lo procesa como `pending_transaction`. Proveer dentro de la app una guía de configuración paso a paso con capturas y un link descargable al atajo preconfigurado (archivo `.shortcut`). El usuario solo necesita instalar el atajo, ingresar su token personal y seleccionar los bancos a monitorear.

El token personal se genera desde el perfil de la app y se guarda en `profiles.shortcut_token`. La edge function valida este token en lugar del JWT de Supabase.

**Archivos involucrados:**
- `mobile/supabase/functions/ios-shortcut-ingest/index.ts` — nueva edge function
- `mobile/supabase/migrations/` — columna `shortcut_token` en `profiles`
- `mobile/app/(app)/profile.tsx` — sección "Configurar atajo de iOS" (solo visible en iOS)

---

## FASE 3 — Deduplicación cross-canal

> Esta fase es consecuencia directa de la Fase 2. Con un solo canal de entrada (Gmail) la deduplicación actual por `raw_subject` es suficiente. Con múltiples canales, el mismo gasto real puede llegar por dos caminos distintos y crear registros duplicados.

### Problema 11 — Sin deduplicación entre canales distintos
**Área:** pending_transactions / Edge Functions  
**Impacto:** Crítico  
**Tiempo estimado:** 2-3 días

**Descripción del problema:**  
El sistema actual usa `UNIQUE (user_id, raw_subject)` para deduplicar. Esto funciona perfectamente cuando el mismo canal intenta insertar el mismo registro dos veces (el `raw_subject` es el ID del mensaje de Gmail o `mp_${payment_id}`). Pero cuando el mismo gasto real llega por canales distintos, ambos tienen `raw_subject` diferentes y ambos pasan el constraint:

```
Compra $5.200 en YPF
  → Gmail detecta el email        → raw_subject: "gmail_abc123"  → INSERT ✓
  → Android listener lo detecta   → raw_subject: "notif_xyz789"  → INSERT ✓
  → Resultado: dos pending_transactions del mismo gasto
```

Con la Fase 2 activa, este escenario es inevitable para usuarios que tengan múltiples canales habilitados.

**Solución:**  
Agregar columna `fingerprint TEXT` a `pending_transactions`. El fingerprint es un hash de las propiedades intrínsecas del gasto real:

```
fingerprint = SHA256(
  user_id +
  round(amount / 10) * 10 +        ← redondear al 10 más cercano
  date (solo día, sin hora) +
  normalize(merchant)               ← lowercase, sin puntuación, sin S.A./S.R.L.
)
```

Antes de insertar desde cualquier canal, la edge function verifica si ese fingerprint ya existe en `pending_transactions` (últimos 5 días) o en `expenses` (últimos 5 días). Si existe → skip silencioso. El chequeo es server-side en cada edge function, no solo en el cliente.

Para canales sin ID externo (notificaciones, WhatsApp, Shortcuts), el `raw_subject` se construye como un hash con bucket de tiempo para evitar duplicados rápidos dentro del mismo canal:

| Canal | raw_subject |
|---|---|
| Gmail | ID del mensaje (ya existe) |
| MercadoPago | `mp_${payment_id}` (ya existe) |
| Android notification | `notif_${hash(packageName + text + hour)}` |
| WhatsApp foto | `wa_${hash(image_md5 + user_id)}` |
| WhatsApp texto | `wa_${hash(text_content + hour + user_id)}` |
| Share Extension | `share_${hash(content + minute + user_id)}` |
| iOS Shortcuts | `shortcut_${hash(text + hour + user_id)}` |

**Archivos involucrados:**
- `mobile/supabase/migrations/` — columna `fingerprint` + índice en `pending_transactions`
- `mobile/supabase/functions/_shared/fingerprint.ts` — nueva utilidad compartida: `normalizemerchant()`, `computeFingerprint()`
- Todas las edge functions que insertan en `pending_transactions` — agregar chequeo de fingerprint antes del INSERT

---

### Problema 12 — La detección de duplicados solo cubre gastos confirmados, no pendientes entre sí
**Área:** PendingTransactions.tsx / UI  
**Impacto:** Medio  
**Tiempo estimado:** 4 horas

**Descripción del problema:**  
La función `isPossibleDuplicate()` en `PendingTransactions.tsx` compara nuevas transacciones pendientes contra gastos ya confirmados (amount ±5%, date ±3 días). No detecta el caso donde dos `pending_transactions` (ambas sin confirmar) representan el mismo gasto real. El usuario podría confirmar las dos antes de darse cuenta.

**Solución:**  
Extender `isPossibleDuplicate()` para comparar también contra otras transacciones pendientes. Cuando se detecta un posible duplicado entre dos pendientes, mostrar ambas lado a lado con el prompt "¿Son el mismo gasto?" y acciones "Sí, descartar uno" / "No, son distintos". Agregar columna `dedup_of UUID` en `pending_transactions` como audit trail cuando el usuario descarta una como duplicado de otra.

**Archivos involucrados:**
- `mobile/src/components/PendingTransactions.tsx` — extender `isPossibleDuplicate`, agregar UI de comparación lado a lado
- `mobile/supabase/migrations/` — columna `dedup_of UUID` en `pending_transactions`

---

## FASE 4 — Grupos compartidos

### Problema 13 — Los splits siempre son iguales, sin opción personalizada
**Área:** group-detail / grupos  
**Impacto:** Alto  
**Tiempo estimado:** 1.5 días

**Descripción del problema:**  
Al crear un gasto grupal, el monto siempre se divide en partes exactamente iguales entre todos los miembros. En la realidad, pocas veces un gasto se divide igual: alguien comió más, alguien no tomó vino, alguien llegó tarde. La ausencia de splits personalizados hace que los grupos no sean útiles para gastos reales complejos.

**Solución:**  
En el modal de agregar gasto grupal, agregar un toggle "División personalizada" que muestre un input de monto por persona. La suma de los inputs debe igualar el total (validación en tiempo real con indicador visual del residuo). Los splits en `group_expense_splits` ya tienen el campo `amount` individual — solo falta la UI para configurarlo en creación.

**Archivos involucrados:**
- `mobile/app/(app)/group-detail.tsx` — modal AddExpense, agregar modo custom split
- No requiere cambios de schema (campos ya existen)

---

### Problema 14 — No existen gastos grupales recurrentes
**Área:** group-detail / backend  
**Impacto:** Alto  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
El alquiler compartido, la suscripción de Netflix familiar, el internet — se pagan cada mes pero hay que cargarlos manualmente. El usuario que paga el alquiler de 4 personas tiene que cargar el mismo gasto con los mismos splits 12 veces por año. Esto es fricción innecesaria que causa que los usuarios dejen de actualizar los grupos.

**Solución:**  
Al crear un gasto grupal, agregar opción "Se repite — Mensual / Semanal / Anual". Si se activa, guardar en `group_expenses` los campos `is_recurring` y `recurring_frequency` (ya existen en el schema de expenses personales). Un cron job en Supabase crea automáticamente el gasto el mismo día del mes siguiente con los mismos splits y monto. Enviar push notification: "Gasto recurrente creado: Alquiler $X".

**Archivos involucrados:**
- `mobile/app/(app)/group-detail.tsx` — toggle de recurrencia en AddExpenseModal
- `mobile/supabase/migrations/` — cron job, agregar campos a group_expenses si no existen
- `mobile/supabase/functions/` — posiblemente nueva edge function para crear el gasto recurrente

---

### Problema 15 — La liquidación de deudas tiene demasiada fricción
**Área:** group-detail  
**Impacto:** Medio  
**Tiempo estimado:** 4 horas

**Descripción del problema:**  
El flujo de dos pasos (deudor marca como pagado → acreedor confirma) es correcto para montos grandes pero excesivo para pagos cotidianos entre amigos. En la práctica genera conversaciones de "confirmá el pago en la app" que son molestas y hacen que los usuarios abandonen el flujo.

**Solución:**  
Para montos menores a un umbral (configurable por grupo, default $50.000 ARS), permitir que el deudor marque como saldado directamente sin requerir confirmación del acreedor. La transacción queda marcada `settled=true` de inmediato. El acreedor recibe una notificación y tiene 48 horas para disputar si no está de acuerdo. Para montos mayores, mantener el flujo de dos pasos actual. El umbral se puede configurar desde la sección de ajustes del grupo.

**Archivos involucrados:**
- `mobile/app/(app)/group-detail.tsx` — lógica de handleSettleDebt, modal de confirmación
- `mobile/supabase/migrations/` — columna `auto_settle_threshold` en family_groups

---

### Problema 16 — Grupos familiares sin visibilidad entre miembros
**Área:** family / group-detail  
**Impacto:** Bajo-Medio  
**Tiempo estimado:** 1 día

**Descripción del problema:**  
En un grupo familiar, los miembros que no son admin (hijos, pareja sin rol admin) solo ven sus propios gastos. No pueden comparar sus gastos con los de otros miembros, lo que elimina la conciencia financiera compartida que es el valor central de un grupo familiar.

**Solución:**  
Agregar a `family_groups` un campo `allow_peer_visibility boolean` (default false). Si el admin activa esta opción, los miembros pueden ver el total gastado por cada otro miembro del grupo (sin ver el detalle de cada gasto — solo totales por categoría). Un toggle simple en la configuración del grupo. La política RLS debe actualizarse para reflejar esta opción.

**Archivos involucrados:**
- `mobile/app/(app)/family.tsx` y `group-detail.tsx` — UI de configuración + vistas condicionales
- `mobile/supabase/migrations/` — columna en family_groups, actualizar RLS

---

## FASE 5 — UX y retención

### Problema 17 — Sin insights proactivos en el home
**Área:** home / financialDiagnosis  
**Impacto:** Alto  
**Tiempo estimado:** 1.5 días

**Descripción del problema:**  
El home muestra datos pero no actúa. No hay un insight personalizado que enganche al usuario a abrir la app. La app es pasiva: espera que el usuario mire los datos en lugar de decirle algo relevante. Mercado Pago notifica activamente cada gasto. Nosotros esperamos que el usuario venga.

**Solución:**  
Agregar una card "Insight del día" en home que rote entre insights reales derivados de los datos del usuario: "Gastaste 40% más en café que el mes pasado", "Llevas 15 días sin registrar gastos manuales", "Tu meta de ahorro está al 60% — te faltan $X para el deadline", "Este mes vas camino a ahorrar $Y más que el mes pasado". Los insights se calculan del mismo `computeFinancialDiagnosis` que ya existe — solo falta exponerlos en home de forma destacada y rotatoria.

**Archivos involucrados:**
- `mobile/app/(app)/home.tsx` — nueva card InsightDelDia
- `mobile/src/lib/financialDiagnosis.ts` — función que devuelve el insight más relevante del día

---

### Problema 18 — Usuarios nuevos sin datos no tienen ninguna experiencia útil
**Área:** home / savings-plan / onboarding  
**Impacto:** Medio  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
El plan de presupuesto, las tendencias y la mayoría de los análisis requieren 3 meses de historial. Un usuario nuevo que acaba de registrarse ve la app casi vacía: sin gráficos, sin insights, sin plan. Esto mata la retención en las primeras 2 semanas antes de que el usuario haya acumulado suficientes datos.

**Solución:**  
Para usuarios con menos de 60 días de cuenta, mostrar un "modo bootstrap" en el plan de presupuesto: un wizard de un solo paso donde el usuario ingresa sus gastos típicos mensuales por categoría (estimados, no reales). Estos datos inicializan los promedios históricos y habilitan todos los análisis desde el día 1. Se marcan con `source='bootstrap'` para distinguirlos de datos reales y no afectar estadísticas reales.

**Archivos involucrados:**
- `mobile/app/(app)/savings-plan.tsx` — detectar usuario nuevo, mostrar wizard
- `mobile/supabase/migrations/` — campo source en expenses o tabla separada bootstrap_data

---

## FASE 6 — Integridad de datos

### Problema 19 — Tipos TypeScript desincronizados con el schema real de DB
**Área:** tipos / database.ts  
**Impacto:** Medio (riesgo de bugs silenciosos)  
**Tiempo estimado:** 2 horas

**Descripción del problema:**  
`database.ts` define `status: 'pending' | 'confirmed' | 'dismissed'` para `pending_transactions`, pero la DB real tiene `'pending' | 'confirmed' | 'ignored' | 'rejected'`. El código del frontend usa `'rejected'` que no está en el tipo definido. Esto puede causar bugs TypeScript silenciosos en producción.

**Solución:**  
Generar los tipos desde Supabase con `npx supabase gen types typescript --project-id <id> > src/types/database.ts`. Hacer esto parte del proceso estándar cada vez que hay una migración nueva (puede ser un script en package.json). Revisar que todos los usos de status en el código sean compatibles con los tipos regenerados.

**Archivos involucrados:**
- `mobile/src/types/database.ts` — regenerar completo
- `mobile/package.json` — agregar script `gen:types`

---

### Problema 20 — Sin auditoría de cambios en gastos
**Área:** base de datos  
**Impacto:** Bajo-Medio  
**Tiempo estimado:** 4 horas

**Descripción del problema:**  
No hay registro de quién modificó un gasto, cuándo, ni por qué. En grupos compartidos, cuando alguien cambia la descripción o el monto de un gasto, no queda traza. Esto puede generar conflictos entre miembros del grupo sin forma de resolverlos ("yo no cambié ese gasto").

**Solución:**  
Agregar un trigger en PostgreSQL que escriba en una tabla `audit_log` (tabla_nombre, registro_id, campo_modificado, valor_anterior, valor_nuevo, usuario_id, timestamp) cada vez que se modifica una fila en `expenses` o `group_expense_splits`. No requiere cambios en el frontend — es puramente backend. En el futuro, la UI puede leer este log para mostrar el historial de cambios de un gasto.

**Archivos involucrados:**
- `mobile/supabase/migrations/` — tabla audit_log + trigger en expenses y group_expense_splits

---

## FASE 7 — IA y análisis financiero

### Problema 21 — El asesor AI no tiene memoria entre meses
**Área:** ai-advisor / financial_profiles  
**Impacto:** Alto  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
Cada conversación con Nomi empieza de cero. El advisor no puede decir "el mes pasado te sugerí reducir gastos en restaurantes y lo lograste" ni hacer seguimiento de metas a largo plazo. Esto hace que la IA se sienta genérica en lugar de personal, limitando el valor percibido para usuarios recurrentes.

**Solución:**  
Al cerrar cada mes (cron job el día 1 de cada mes), guardar un resumen en `financial_profiles` o nueva tabla `monthly_summaries`: health score, total gastado, mayor categoría, mayor cambio respecto al mes anterior, metas cumplidas/falladas. Incluir los últimos 3 resúmenes en el prompt del advisor. El prompt ya tiene 147 líneas de contexto de Argentina — agregar 20-30 líneas de historial personal no afecta performance pero sí la calidad de las respuestas.

**Archivos involucrados:**
- `mobile/supabase/functions/ai-advisor/index.ts` — agregar historial mensual al prompt
- `mobile/supabase/migrations/` — tabla monthly_summaries + cron job de cierre mensual

---

### Problema 22 — El asesor no conoce deudas ni activos del usuario
**Área:** ai-advisor / onboarding / financial_profiles  
**Impacto:** Alto  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
Si el usuario tiene una deuda de tarjeta al 15% mensual y la IA le recomienda invertir en un plazo fijo al 2.5%, es una recomendación financieramente incorrecta. La app nunca pregunta sobre deudas y por eso el advisor puede dar consejos dañinos. Tampoco conoce activos (ahorros en dólares, propiedades, inversiones existentes).

**Solución:**  
Agregar en el perfil (o paso opcional del onboarding) una sección "Mi situación financiera": deudas activas (tarjeta, préstamo personal, otro) con monto aproximado y tasa, y activos relevantes (dólares ahorrados, inversiones actuales). Guardar en `financial_profiles.liabilities_json` y `assets_json`. El advisor recibe esto en contexto y puede priorizar correctamente: primero pagar deuda cara, después invertir el excedente.

**Archivos involucrados:**
- `mobile/app/(app)/profile.tsx` — nueva sección "Situación financiera"
- `mobile/supabase/functions/ai-advisor/index.ts` — agregar deudas/activos al prompt
- `mobile/supabase/migrations/` — columnas en financial_profiles

---

### Problema 23 — INCOME_RANGE_MAP duplicado en cliente y servidor
**Área:** expensesStore / ai-advisor  
**Impacto:** Medio (riesgo de divergencia silenciosa)  
**Tiempo estimado:** 4 horas

**Descripción del problema:**  
El mapa de rangos de ingreso está hardcodeado tanto en `src/store/expensesStore.ts` como en `supabase/functions/ai-advisor/index.ts`. Si se actualiza uno (necesario frecuentemente en Argentina por inflación) y no el otro, los análisis del cliente y del servidor divergen silenciosamente. Ningún error se lanza — simplemente los números no cuadran.

**Solución:**  
Mover el INCOME_RANGE_MAP a la tabla `market_rates` de Supabase (ya existe para datos dinámicos como FCI, dólar, etc.). Ambos lados lo leen de la DB. Un solo lugar de verdad que se puede actualizar sin deploys.

**Archivos involucrados:**
- `mobile/src/store/expensesStore.ts` — eliminar constante local, leer de store/DB
- `mobile/supabase/functions/ai-advisor/index.ts` — leer de market_rates
- `mobile/supabase/migrations/` — insertar filas en market_rates para los rangos

---

### Problema 24 — Detección de suscripciones falla en casi todos los casos reales
**Área:** expensesStore / subscriptions  
**Impacto:** Medio  
**Tiempo estimado:** 1 día

**Descripción del problema:**  
La detección actual requiere "misma descripción exacta en 2+ meses distintos". Falla con: suscripciones anuales (solo aparecen 1 vez/año), variaciones de nombre ("Netflix" vs "NETFLIX" vs "NETFLIX.COM"), rebranding de servicios, montos variables (AWS, Mercado Pago), y suscripciones canceladas que aún aparecen en el listado de "activas".

**Solución:**  
Usar `merchant_category_hints` como base de detección: si un merchant normalizado tiene 2+ ocurrencias en 2+ meses y el intervalo entre ellas es regular (28-32 días para mensual, 360-370 días para anual), marcarlo como suscripción. La normalización de texto ya existe en el codebase (lowercase, quitar caracteres especiales, quitar S.A./S.R.L.). Agregar campo `last_seen_at` para detectar cancelaciones (si no aparece en 45+ días desde el período esperado, marcar como "posiblemente cancelada" en lugar de activa).

**Archivos involucrados:**
- `mobile/src/store/expensesStore.ts` — reescribir `fetchSubscriptionsAndProjection`
- `mobile/supabase/migrations/` — agregar campos a merchant_category_hints

---

### Problema 25 — Health score con umbrales fijos no personalizados
**Área:** financialDiagnosis / perfil  
**Impacto:** Medio  
**Tiempo estimado:** 1 día

**Descripción del problema:**  
El health score penaliza si gastos prescindibles > 15%, 25%, 35% de forma igual para todos los usuarios. Un estudiante universitario y un profesional con familia tienen realidades financieras completamente distintas. Los umbrales fijos hacen que el score se sienta genérico e injusto para muchos perfiles.

**Solución:**  
En el perfil o al crear la cuenta, preguntar la meta de ahorro del usuario (% del ingreso que quiere ahorrar). Guardar en `financial_profiles.savings_target_pct`. Usar ese valor como referencia dinámica en el health score en lugar de los umbrales fijos. Si el usuario dice "quiero ahorrar el 20%", el score se calibra a eso — 20% de ahorro = score perfecto en esa dimensión.

**Archivos involucrados:**
- `mobile/src/lib/financialDiagnosis.ts` — reemplazar umbrales hardcodeados por valor de perfil
- `mobile/app/(app)/profile.tsx` — agregar input de meta de ahorro
- `mobile/supabase/migrations/` — columna en financial_profiles

---

## FASE 8 — Metas de ahorro

### Problema 26 — Las metas no tienen seguimiento de contribuciones
**Área:** savings-goal / goalsStore  
**Impacto:** Alto  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
El campo `current_amount` existe en `savings_goals` pero no hay UI para agregar contribuciones, ni historial de cuándo se contribuyó. La meta se crea y queda estática para siempre. Sin movimiento visible de progreso, nadie mantiene el hábito de contribuir a sus metas.

**Solución:**  
Crear tabla `goal_contributions` (goal_id, user_id, amount, date, note). Agregar botón "Agregar fondos" en cada meta que abre un sheet simple: monto + nota opcional. Mostrar barra de progreso animada con el historial de contribuciones (timeline visual). Agregar notificación mensual opcional: "¿Contribuiste a tu meta [X] este mes?". El `current_amount` en `savings_goals` se calcula como suma de contribuciones.

**Archivos involucrados:**
- `mobile/app/(app)/savings-goal.tsx` — UI de contribución + barra de progreso
- `mobile/src/store/goalsStore.ts` — agregar contribuciones al store
- `mobile/supabase/migrations/` — tabla goal_contributions

---

### Problema 27 — Metas completamente desconectadas del plan de presupuesto
**Área:** savings-plan / savings-goal  
**Impacto:** Alto  
**Tiempo estimado:** 1.5 días

**Descripción del problema:**  
Cuando el plan de presupuesto detecta una "oportunidad" (por ejemplo, $30.000 sin gastar en entretenimiento este mes), no hay ninguna acción directa para asignar ese dinero a una meta. El usuario tiene que hacer la conexión mentalmente, lo que hace que el dinero "disponible" se gaste en otra cosa.

**Solución:**  
En la pantalla de presupuesto (`savings-plan.tsx`), cuando aparece una "oportunidad de ahorro", mostrar directamente: "¿Querés agregar estos $30.000 a tu meta [Vacaciones]?" con un botón de un tap que crea la contribución en `goal_contributions`. Si el usuario tiene múltiples metas, mostrar selector. Este CTA convierte el insight pasivo en acción concreta.

**Archivos involucrados:**
- `mobile/app/(app)/savings-plan.tsx` — CTA en tarjetas de oportunidad
- `mobile/src/store/goalsStore.ts` — función de contribución rápida

---

### Problema 28 — Tabla category_budgets existe pero no tiene UI
**Área:** category-detail / savings-plan  
**Impacto:** Medio  
**Tiempo estimado:** 2 días

**Descripción del problema:**  
La tabla `category_budgets` existe en la DB desde la migración 018 y permite que el usuario defina límites mensuales por categoría. Sin embargo, el plan de presupuesto ignora completamente esta tabla y en su lugar infiere límites del historial. El usuario nunca puede decir explícitamente "quiero gastar máximo $50.000 en restaurantes".

**Solución:**  
En `category-detail.tsx`, agregar un input "Límite mensual" que persista en `category_budgets`. El `budgetPlan.ts` debe priorizar el límite manual cuando existe, y solo usar el inferido por historial cuando no hay límite configurado. Agregar notificación push cuando el usuario supera el 80% del límite manual de una categoría.

**Archivos involucrados:**
- `mobile/app/(app)/category-detail.tsx` — input de límite + persistencia
- `mobile/src/lib/budgetPlan.ts` — leer category_budgets antes de usar historial
- `mobile/supabase/migrations/` — asegurar que la tabla y RLS estén correctas

---

## Resumen por fase

| Fase | Descripción | Problemas | Tiempo total est. |
|------|-------------|-----------|-------------------|
| 0 | Pulido UI (TestFlight beta) | — | Variable |
| 1 | Integración email/bancos | 6 problemas (1–6) | ~12 días |
| 2 | Captura automática multi-canal | 4 problemas (7–10) | ~11-15 días |
| 3 | Deduplicación cross-canal | 2 problemas (11–12) | ~3 días |
| 4 | Grupos compartidos | 4 problemas (13–16) | ~5 días |
| 5 | UX y retención | 2 problemas (17–18) | ~3.5 días |
| 6 | Integridad de datos | 2 problemas (19–20) | ~6 horas |
| 7 | IA y análisis financiero | 5 problemas (21–25) | ~6 días |
| 8 | Metas de ahorro | 3 problemas (26–28) | ~5.5 días |

**Total estimado (excluyendo UI):** ~46 días de desarrollo

---

*Documento actualizado el 2026-09-13. Actualizar cuando se completen fases o cambien prioridades.*
