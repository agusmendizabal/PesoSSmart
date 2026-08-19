# FASE 8A — AUDITORÍA DE SEGURIDAD

*Auditoría read-only. No se modificó ningún archivo, no se ejecutó ninguna migración, no se hizo ningún deploy. Todos los hallazgos citan archivo y línea. Se distingue explícitamente: CONFIRMADO EN CÓDIGO / INFERIDO / NO CONFIRMADO (requiere acceso externo).*

## Resumen ejecutivo

Cantidad de hallazgos:
- 🔴 Críticos: **4**
- 🟠 Altos: **7**
- 🟡 Medios: **5**
- 🟢 Informativos: **3**

El hallazgo más severo es que la RPC `delete_user_account` (`mobile/supabase/migrations/launch_security.sql:15-46`) no valida que quien la invoca sea el dueño de la cuenta que borra — cualquier usuario autenticado puede borrar los datos de otro usuario cuyo UUID conozca, y ese UUID es obtenible en la práctica vía `get_group_members` si comparten un grupo. Además, la misma función probablemente falla por completo en runtime porque borra de una tabla `goals` que no existe (la tabla real es `savings_goals`), lo que podría estar rompiendo el borrado de cuenta requerido por Apple/Google. Se confirmó también que los secrets reales de tres cron jobs están committeados en texto plano en migraciones versionadas en git, y que `send-push` no valida absolutamente nada.

Contradicción relevante con el relevamiento anterior (Fase 8, relevamiento completo): CLAUDE.md documenta que "Verify JWT with legacy secret" debe estar OFF y que "todas las edge functions hacen su propia validación JWT". El estado real de despliegue (`npx supabase functions list`, consultado en la sesión anterior) muestra `verify_jwt=true` a nivel de Gateway de Supabase para 5 funciones: `ai-advisor`, `investment-advisor`, `gmail-poll`, `mp-poll`, `transcribe`. Esto no es una vulnerabilidad — es una protección adicional que contradice la documentación del proyecto, no el código. Se explica en detalle en la sección 1.

---

## 1. ai-advisor

**Estado:** función activa (`ACTIVE`, `verify_jwt=true` a nivel de Gateway de Supabase). Archivo: `mobile/supabase/functions/ai-advisor/index.ts`.

**Validación de JWT — dos capas distintas, hay que separarlas:**
- **Capa de Gateway (plataforma):** `verify_jwt=true` significa que Supabase Edge Runtime **rechaza con 401 cualquier request sin un JWT Supabase válido y firmado, antes de que el código de la función se ejecute**. Esto contradice la premisa "Verify JWT debe estar OFF" del CLAUDE.md — en la práctica está ON para esta función. No es un hallazgo de vulnerabilidad, es una corrección a la documentación del proyecto (ver sección de contradicciones al final).
- **Capa de código (función):** `index.ts:295-300` solo comprueba que el header `Authorization` **exista** (`if (!authHeader)`) — nunca llama a `supabase.auth.getUser()` ni valida el JWT por su cuenta. Si dependiera solo de esto, cualquier string en el header pasaría. Pero como el Gateway ya filtró JWTs inválidos/expirados antes de llegar acá, en la práctica **siempre** hay un JWT válido de *algún* usuario cuando el código corre.

**Cómo obtiene ****`auth.uid()`****:** nunca lo hace explícitamente. El cliente Supabase para las queries de contexto (`index.ts:419-423`) se crea con `SUPABASE_ANON_KEY` + el header `Authorization` reenviado tal cual (`global: { headers: { Authorization: authHeader } }`) — esto hace que **Postgres resuelva `auth.uid()` a partir del JWT real** en cada query, y por lo tanto las políticas RLS (`auth.uid() = user_id`) se aplican con el usuario real, no con lo que diga el body.

**De dónde sale ****`user_id`****:** del body JSON (`index.ts:306`), sin ninguna validación cruzada contra el JWT.

**¿Acepta ****`user_id`**** desde el body? ¿Lo compara contra ****`auth.uid()`****?** Sí lo acepta del body (`index.ts:306`); **no existe ningún punto del código que compare `user_id` contra el usuario real del JWT.**

**Consecuencia práctica de esto — distinguiendo por tipo de operación:**
- **Lecturas de contexto** (`profiles`, `financial_profiles`, `risk_profiles`, `expenses`, `market_rates` — `index.ts:429-437`) y **lectura del plan/límite** (`index.ts:499-500, 515`): usan el cliente ANON+Authorization real. Si un atacante manda `user_id` de otra persona, las queries siguen filtrando por RLS según **su propio** `auth.uid()` real (no el `user_id` del body) en las tablas que tienen policy `auth.uid() = user_id` — así que `.eq('user_id', user_id_ajeno)` simplemente no devuelve filas (0 resultados), no filtra datos de otro usuario. **Esto depende de que esas tablas tengan RLS habilitado y correctamente scoped — para `profiles`, `financial_profiles`, `risk_profiles` esto es NO CONFIRMADO EN EL CÓDIGO** (ver sección 6), así que la protección real de esta ruta específica no puede garantizarse al 100% desde el repo.
- **Incremento de ****`ai_usage`**** (****`index.ts:597-604`****):** acá el cliente se crea con `SUPABASE_SERVICE_ROLE_KEY` (bypasea RLS por completo) y **sin ningún header de Authorization** — es decir, sin ningún contexto de sesión. Se llama a `sb.rpc('increment_ai_usage', { p_user_id: user_id, p_month: month })` con el `user_id` tal cual vino del body. **Esto es un hallazgo real, no un supuesto**: como el cliente service-role no lleva el JWT del llamante, ni siquiera si la RPC intentara verificar `auth.uid() = p_user_id` internamente podría hacerlo de forma útil (el `auth.uid()` de esa conexión sería `NULL`), lo que implica lógicamente que la RPC **no puede** estar haciendo ese chequeo si la función anda como se espera hoy (si lo hiciera, el incremento fallaría siempre). La definición SQL de `increment_ai_usage` no existe en ningún archivo del repo (grep exhaustivo sin resultados) — el cuerpo exacto es NO CONFIRMADO, pero el patrón de invocación ya es, por sí solo, la vulnerabilidad.

**¿El límite freemium puede manipularse cambiando ****`user_id`****? ¿Hay bypass?**
- No hay forma de **evitar** el límite propio enviando otro `user_id` (la lectura de `ai_usage`/`profiles` para chequear el límite queda scoped por RLS al usuario real, como se explicó arriba — así que no se puede leer/pisar el contador de otro para hacerse pasar por alguien con más cuota).
- **Sí hay forma de agotar la cuota de OTRO usuario**: un atacante autenticado (con su propio JWT válido, que ya pasa el Gateway) puede enviar requests a `ai-advisor` con `user_id` de una víctima. La lectura de límite (scoped por RLS a su propio usuario) no bloqueará la request porque está chequeando SU propio uso, no el de la víctima — y el incremento posterior (service role, sin scope) sí va a incrementar el contador de la víctima. Repetido, esto agota el límite mensual de mensajes de IA de la víctima (DoS dirigido contra su acceso al chat). Requiere conocer el UUID de la víctima — obtenible vía `get_group_members` si comparten un grupo familiar/de amigos (ver sección 10).

**¿Caminos alternativos sin autenticación válida?** No — el Gateway (`verify_jwt=true`) bloquea cualquier request sin un JWT Supabase genuino antes de que el código corra. No hay bypass de autenticación en sí; el problema es de autorización cruzada (`user_id` no verificado), no de autenticación.

**Qué pasa si ****`Authorization`**** está ausente, malformado o con JWT inválido:**
- Ausente/malformado/inválido → rechazado por el Gateway con 401 **antes** de ejecutar el código (dado `verify_jwt=true`).
- Si por alguna razón el Gateway no rechazara (ej. si se redeploya con `verify_jwt=false`), el código (`index.ts:295-300`) solo rechaza si el header está **completamente ausente**; un header malformado con cualquier string no vacío pasaría esa comprobación — en ese escenario hipotético, las queries a Supabase fallarían silenciamente (el token no sería válido para Postgres) y `ctx` quedaría en su valor por defecto (`has_data: false`), degradando el contexto pero sin filtrar datos.

**Confirmado / No confirmado:**
- CONFIRMADO: `user_id` del body nunca se compara contra el JWT; incremento de `ai_usage` vía service-role con `user_id` no verificado.
- CONFIRMADO: lecturas de contexto están protegidas por RLS real (asumiendo RLS correcto en las tablas subyacentes).
- NO CONFIRMADO: cuerpo real de `increment_ai_usage` (no está en el repo); estado de RLS de `profiles`/`financial_profiles`/`risk_profiles` (ver sección 6).

---

## 2. investment-advisor

**Estado:** función activa (`ACTIVE`, versión 1, `verify_jwt=true`). Archivo: `mobile/supabase/functions/investment-advisor/index.ts`.

**Mismo patrón exacto que ai-advisor** en cuanto a JWT (Gateway ya filtra tokens inválidos; el código solo comprueba presencia del header, `index.ts:230-235`) y en cuanto a `user_id` del body sin cross-check contra `auth.uid()` (`index.ts:240`).

**`ai_usage`****:** mismo patrón que ai-advisor — el incremento (`index.ts:320-325`) solo ocurre en modo `chat` (no en modo `explain`), usa `SUPABASE_SERVICE_ROLE_KEY` sin Authorization, y toma `user_id` del body sin validar. Mismo hallazgo: agotamiento de cuota ajena posible conociendo el UUID de la víctima. El chequeo de límite previo (`index.ts:258-288`) sí usa el cliente ANON+Authorization real, scoped por RLS — mismo razonamiento que en ai-advisor.

**`chat_threads`**** / ****`chat_history`****:** **esta función NO inserta ni lee estas tablas en ningún momento** — no hay ningún `.from('chat_threads')` ni `.from('chat_history')` en todo `investment-advisor/index.ts`. La persistencia de la conversación ocurre enteramente del lado del cliente (`investmentChatPersistence.ts`, fuera del alcance de esta función), vía llamadas directas del cliente a Supabase con su propia sesión. Esto significa que la protección real de "no leer/insertar en threads ajenos" depende **100% de la RLS de esas tablas**, no de este edge function. Se auditó esa RLS de forma independiente (ver sección 6): `chat_threads` y `chat_history` tienen policies `SELECT`/`INSERT`/`UPDATE`/`DELETE` (o `SELECT`/`INSERT`/`DELETE` en el caso de `chat_history`, que no tiene policy `UPDATE`) todas con `user_id = auth.uid()`, incluyendo `WITH CHECK` en el `INSERT` — **esto bloquea correctamente** que un usuario inserte un mensaje en un thread ajeno o lea threads de otro usuario, siempre por RLS real del lado de Postgres, nunca por lógica de esta edge function.

**`context_fingerprint`****:** es solo una columna de texto en `chat_threads` (agregada por `chat_threads_context_fingerprint.sql`) — no tiene ningún rol de seguridad, es un hash usado para decidir si regenerar la explicación. No representa superficie de ataque.

**Modo ****`explain`**** vs ****`chat`****:** `explain` no consume el límite freemium y no incrementa `ai_usage` — solo genera el texto inicial de "por qué te mostramos esto" a partir del `context` recibido. `chat` sí consume el límite. Ambos requieren `context` en el body (`index.ts:246-250`, validado como presente pero **no validado en su contenido** — ver siguiente punto).

**Historial enviado por el cliente / ****`advisorContext`**** enviado por el cliente:**
- El objeto `context` (tipo `InvestmentAdvisorContext`, `index.ts:45-67`) llega **completo desde el cliente**, sin ninguna validación de que los números que contiene (`ingresoDisponible`, `ahorroMensual`, alternativas seleccionadas, escenario, etc.) correspondan realmente a los datos reales del usuario en la base. La función **confía ciegamente** en este objeto — nunca lo cruza contra `financial_profiles`/`expenses`/`market_rates` de la base.
- **Esto es una vulnerabilidad de integridad de datos, no de confidencialidad**: un atacante que modifique el `context` antes de enviarlo (interceptando su propia request, algo que cualquier usuario puede hacer sobre su propio tráfico) podría hacer que el LLM genere una explicación basada en cifras financieras fabricadas — pero **esa respuesta solo la ve el propio atacante** (la función nunca persiste el `context` en ninguna tabla ni la usa para nada más que generar texto de vuelta a quien la invocó). No hay forma de que esto afecte a otro usuario ni de que contamine datos reales en la base. Impacto: bajo, autolimitado al propio atacante manipulando su propia experiencia — el sistema de prompts (`CORE_RULES`, `index.ts:71-114`) está diseñado para que el LLM nunca invente números fuera del `context` recibido, pero no impide que el `context` en sí sea fabricado por el cliente.
- **`history`**** (****`index.ts:243, 295`****):** array de mensajes previos, también enviado tal cual por el cliente y pasado directo al prompt de Groq. Mismo razonamiento: solo afecta la respuesta que recibe el propio llamante.

**¿Podría un usuario...?**
- **Enviar el ****`user_id`**** de otra persona:** sí, técnicamente el body lo acepta sin validar — efecto práctico limitado a lo explicado en `ai_usage` arriba (agotar cuota ajena). No hay lectura de datos financieros de otro usuario a través de esta ruta porque esta función no lee ninguna tabla de datos financieros del usuario — todo el dato ya viene armado en `context` desde el cliente.
- **Consumir el límite de otra persona:** sí (mismo hallazgo que en ai-advisor).
- **Consultar o modificar conversaciones ajenas:** no — protegido por RLS real de `chat_threads`/`chat_history` (esta función ni siquiera las toca).
- **Insertar mensajes en threads ajenos:** no — mismo motivo, y aunque lo intentara desde el cliente directamente (sin pasar por esta función), la policy `INSERT ... WITH CHECK (user_id = auth.uid())` lo bloquea.
- **Manipular el contexto financiero enviado al LLM:** sí, técnicamente (ver arriba), pero el impacto se limita a la propia respuesta que recibe el atacante — no hay persistencia ni efecto sobre otros usuarios ni sobre datos reales.

**Confirmado / No confirmado:**
- CONFIRMADO: `chat_threads`/`chat_history` nunca se tocan desde esta edge function; toda su protección depende de RLS (confirmada correcta, sección 6).
- CONFIRMADO: `user_id` sin cross-check, mismo patrón de agotamiento de cuota que ai-advisor.
- CONFIRMADO: `context`/`history` no se validan contra datos reales, pero el efecto se autolimita al propio llamante.

---

## 3. delete_user_account

**Definición completa** (única migración que la crea/modifica — no hay otras versiones): `mobile/supabase/migrations/launch_security.sql:15-46`.

```sql
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE expenses SET deleted_at = NOW() WHERE user_id = p_user_id AND deleted_at IS NULL;
  DELETE FROM ai_usage            WHERE user_id = p_user_id;
  DELETE FROM pending_transactions WHERE user_id = p_user_id;
  DELETE FROM gmail_connections   WHERE user_id = p_user_id;
  DELETE FROM goals               WHERE user_id = p_user_id;
  DELETE FROM payment_logs        WHERE user_id = p_user_id;
  DELETE FROM family_members      WHERE user_id = p_user_id;
  DELETE FROM savings             WHERE user_id = p_user_id;
  DELETE FROM profiles WHERE id = p_user_id;
  PERFORM auth.users WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account(UUID) TO authenticated;
```

**¿Es SECURITY DEFINER?** Sí (`launch_security.sql:18`) — corre con los privilegios del dueño de la función (bypasea RLS por completo en todas las tablas que toca).

**¿Quién puede invocarla?** `GRANT EXECUTE ... TO authenticated` (`launch_security.sql:50`) — **cualquier usuario autenticado de la app**, sin restricción adicional.

**¿Recibe ****`p_user_id`****?** Sí, como único parámetro, controlado 100% por quien invoca.

**¿Comprueba internamente ****`auth.uid() = p_user_id`****?** **No.** Se leyó el cuerpo completo (líneas 21-45) — no hay ningún `IF`, `RAISE EXCEPTION`, ni referencia a `auth.uid()` en ninguna parte de la función.

**Qué pasa si un usuario autenticado llama la RPC pasando el UUID de otra persona:**
- **CONFIRMADO EN CÓDIGO:** nada en el código lo impide. La única barrera es que el atacante necesita conocer el UUID de la víctima — que **es obtenible en la práctica**: la RPC `get_group_members` (`mobile/supabase/migrations/group_members_v2.sql:124-146`) devuelve `user_id`, `full_name` y `email` de todos los miembros de cualquier grupo al que pertenezca el llamante. Cualquier miembro de un grupo familiar/de amigos puede obtener así el UUID real de los demás miembros y luego invocar `delete_user_account` directamente contra el endpoint REST de Supabase (`POST /rest/v1/rpc/delete_user_account`) con su propio JWT válido pasando el UUID de la víctima.
- Esto borra en cascada, para la víctima: soft-delete de todos sus `expenses`, y DELETE completo de `ai_usage`, `pending_transactions`, `gmail_connections`, `payment_logs`, `family_members`, `savings` (si existe) y finalmente su fila de `profiles`.

**Qué tablas elimina — ítem por ítem, exactamente como está en el código:**
| Tabla | ¿La elimina? | Nota |
|---|---|---|
| `expenses` | Soft-delete (`deleted_at = NOW()`), no DELETE real | — |
| `ai_usage` | Sí, DELETE | — |
| `pending_transactions` | Sí, DELETE | — |
| `gmail_connections` | Sí, DELETE | — |
| `goals` | Intenta DELETE, **pero esta tabla no existe** (ver hallazgo abajo) | — |
| `payment_logs` | Sí, DELETE | — |
| `family_members` | Sí, DELETE | — |
| `savings` | Sí, DELETE (si la tabla existe — ver sección 6, existencia NO CONFIRMADA) | — |
| `profiles` | Sí, DELETE | — |
| **`savings_goals`** | **NO se borra** — el código borra de `goals`, no de `savings_goals` (que es la tabla real, creada en `goals.sql:2`) | Ver hallazgo crítico abajo |
| **`investments`** | **NO se borra** — nunca se menciona en la función | — |
| **`chat_threads` / `chat_history`** | **NO se borran** | — |
| **`mp_connections`** (conexión OAuth de Mercado Pago) | **NO se borra** | — |
| **`category_budgets`, `expense_receipts`, `debt_match_suggestions`, `expense_edit_requests`, `group_expense_splits`, `group_transfers`** | **NO se borran** | — |
| `auth.users` (la cuenta de autenticación en sí) | **NO se borra.** `PERFORM auth.users WHERE id = p_user_id` (línea 42) solo evalúa la existencia de la fila, no ejecuta ningún `DELETE` — el propio comentario del archivo (línea 43) dice explícitamente que el borrado real de `auth.users` debe hacerse aparte con `supabase.auth.admin.deleteUser()` (requiere service role) | Ver hallazgo abajo |

**🔴 Hallazgo crítico — tabla ****`goals`**** inexistente:** no existe ningún `CREATE TABLE goals` en ninguna de las 43 migraciones (la tabla real de metas de ahorro es `savings_goals`, creada en `goals.sql:2-12`). Una sentencia `DELETE FROM goals WHERE ...` contra una tabla inexistente lanza un error de Postgres (`relation "goals" does not exist`) en tiempo de ejecución. Como toda la función corre como un único bloque `plpgsql` (transacción implícita), una excepción no capturada en esa línea **aborta la función completa y revierte todo lo anterior** (el `UPDATE expenses` y los `DELETE` de `ai_usage`/`pending_transactions`/`gmail_connections` que ya se habían ejecutado antes en el mismo bloque). **Esto es INFERIDO con alta confianza a partir de la semántica estándar de PL/pgSQL** (no hay `EXCEPTION WHEN ... THEN` en la función, así que cualquier error se propaga) — **no puede confirmarse al 100% sin ejecutar la función contra la base real**, porque existe la posibilidad (no verificable desde el repo) de que exista una tabla `goals` creada fuera de las migraciones rastreadas. Si el error ocurre como se infiere, **el borrado de cuenta requerido por Apple/Google App Store podría no estar funcionando en absoluto hoy** — ni siquiera para el flujo legítimo del propio usuario borrando su propia cuenta.

**¿Quedan datos personales después del borrado?** Sí, confirmado por la tabla de arriba: `savings_goals` (metas de ahorro con montos y títulos), `investments`, `chat_threads`/`chat_history` (conversaciones completas con el asesor de IA, que incluyen contexto financiero), `mp_connections` (tokens OAuth de Mercado Pago encriptados) y varias tablas de grupos permanecen intactas después de invocar esta función — asumiendo que la función llegara a completarse (ver punto anterior sobre el aborto probable por la tabla `goals`).

**¿Existe alguna dependencia que pueda hacer fallar parcialmente el borrado?** Sí — la referencia a la tabla `goals` inexistente (arriba). También: `expenses.user_id`, `family_members.user_id`, etc. tienen `REFERENCES auth.users(id) ON DELETE CASCADE` en varias tablas (confirmado en `chat_threads.sql:7`, `chat_history.sql:7`, `savings_goals` en `goals.sql:4`) — esto significa que si `auth.users` SÍ se borrara en algún otro punto del flujo (vía `supabase.auth.admin.deleteUser()`, fuera de esta función), esas tablas se limpiarían automáticamente por cascada a nivel de base de datos — pero como esta función nunca ejecuta ese borrado de `auth.users`, esa cascada nunca se dispara desde acá.

**Confirmado / No confirmado:**
- CONFIRMADO: sin chequeo `auth.uid() = p_user_id`; `GRANT EXECUTE TO authenticated` sin restricción; múltiples tablas con datos personales no cubiertas por el DELETE; `auth.users` nunca se borra desde esta función.
- INFERIDO (alta confianza, no 100% confirmable sin acceso a la DB real): la función aborta completa por la referencia a `goals` inexistente, dejando el borrado de cuenta roto de punta a punta.
- NO CONFIRMADO: si `goals` existe como tabla fuera de las migraciones rastreadas; si `savings`/`investments` existen en producción con el nombre exacto que el código asume; si el paso de borrado de `auth.users` está implementado en algún otro lugar (edge function separada) no encontrado en este repo.

---

## 4. send-push / advisor-sunday

**Estado de despliegue:** ninguna de las dos apareció en `npx supabase functions list` (consultado en la sesión de relevamiento anterior) — **INFERIDO que no están desplegadas actualmente**, no confirmable al 100% sin volver a consultar el dashboard.

### send-push
- **Endpoint:** `POST` únicamente. Body: `{ userId?, token?, title, body, data?, badge? }` (interfaz `PushPayload`, `send-push/index.ts:8-15`).
- **Validación de Authorization:** **ninguna.** No hay una sola lectura de `req.headers.get('Authorization')` en todo el archivo. El único "secret" presente es `SUPABASE_SECRET` (línea 5), usado para crear el cliente hacia la propia base de Supabase con rol de servicio — no se usa para autenticar al llamante.
- **¿Quién puede invocarla?** Tal como está el código, si se desplegara con `verify_jwt=false` (patrón que siguen la mayoría de las funciones sin necesidad de sesión de usuario final en este proyecto — `gmail-auth`, `mp-auth`, `mp-webhook`, `create-payment`, `fetch-market-rates`, `cedear-sync`, `indec-sync` están así), **cualquiera con la URL pública podría invocarla directamente, sin ninguna sesión de Supabase.**
- **¿Puede cualquiera spamear notificaciones a cualquier usuario?** CONFIRMADO EN CÓDIGO, independiente del estado de `verify_jwt`: si se envía `userId` en el body, la función hace `select('push_token').eq('id', userId)` (`send-push/index.ts:38-43`) sin comprobar que ese `userId` sea el del llamante, y arma el payload de Expo Push con `title`/`body`/`data` — todos controlados por quien invoca — enviándolo a `https://exp.host/--/api/v2/push/send`. Esto permite mandar notificaciones con título/cuerpo/deep-link arbitrarios a cualquier usuario real conociendo (o adivinando) su UUID, o directamente pasando un `token` de Expo push arbitrario.
- **Depende de ser llamada solo desde otras Edge Functions:** ese es el diseño **implícito** (la invocan `gmail-poll`, `mp-poll`, `mp-webhook`, `advisor-sunday` con la service role key), pero **no hay ningún mecanismo en el código que lo haga cumplir** — no hay verificación de un secret compartido ni de un header especial que confirme que la llamada viene de otra función y no de un cliente externo.
- **¿Existe autenticación server-to-server real?** No, confirmado — es puramente convención de uso, sin enforcement.

### advisor-sunday
- **Endpoint:** no filtra por método HTTP (`serve(async (req) => {...`, sin chequeo de `req.method`); el comentario del archivo dice que acepta GET (cron) o POST (manual) pero el código responde igual a cualquier verbo.
- **Validación de Authorization:** ninguna, mismo patrón que `send-push`.
- **Cron real:** se grepeó `advisor-sunday` y `cron.schedule` en las 43 migraciones — **cero coincidencias** de un `cron.schedule` real para esta función. El único indicio es un comentario en el propio código (`advisor-sunday/index.ts:4-5`) diciendo que debe configurarse manualmente en el dashboard. **NO CONFIRMADO** que el cron esté realmente activo.
- **Impacto si fuera invocable públicamente:** no llama a Groq ni gasta en LLM, pero itera sobre **todos** los perfiles con `push_token` seteado (sin límite ni paginación) y le manda una notificación real a cada uno vía `send-push` (usando la service role key real, embebida server-side, no expuesta al llamante). Invocada repetidamente, generaría spam de notificaciones "resumen semanal" a **toda la base de usuarios**, sin límite de rate.

**Clasificación:** ambos hallazgos son **A (vulnerabilidad real confirmada en el código)** condicionados a que se desplieguen sin protección adicional — hoy el riesgo activo es bajo porque **parecen no estar desplegadas** (**C**, no confirmable al 100%).

---

## 5. Cron y secrets

### Patrón común: `fetch-market-rates`, `cedear-sync`, `indec-sync`

Los tres siguen exactamente el mismo patrón (ya verificado línea por línea en las tres):

```ts
const cronSecret = Deno.env.get('<NOMBRE>_SECRET') ?? '';
const authHeader = req.headers.get('Authorization') ?? '';
if (cronSecret && !authHeader.includes(cronSecret)) {
  return new Response(..., { status: 401 });
}
```
- `fetch-market-rates/index.ts:69-71` (`MARKET_RATES_SYNC_SECRET`)
- `cedear-sync/index.ts:95,97` (`CEDEAR_SYNC_SECRET`)
- `indec-sync/index.ts:22,24` (`INDEC_SYNC_SECRET`)

**Hallazgos, iguales en los tres:**
1. **Comparación con `.includes()`**, no `===` ni timing-safe — un header que *contenga* el secret como substring pasa igual (ej. `Bearer xxx<secret>yyy`). Explotabilidad baja, pero no es la comparación correcta.
2. **Fail-open si el secret no está seteado:** si la env var no existe, `cronSecret` es `''` (falsy), la condición completa es `false`, y **el bloque de rechazo se salta enteramente** — cualquier request pasa sin autenticación, sea cual sea el header enviado.
3. **🔴 Hallazgo agravante, no pedido explícitamente pero de la misma naturaleza y máxima severidad:** los valores reales de estos tres secrets están **hardcodeados en texto plano dentro de las migraciones SQL versionadas en git**:
   - `migrations/cedear_sync_cron.sql:18` → `Authorization: Bearer cedear2026pesossmart`
   - `migrations/indec_sync_cron.sql:18` → `Authorization: Bearer indec2026pesossmart`
   - `migrations/market_rates_sync_cron.sql:25` → `Authorization: Bearer marketrates2026pesossmart`
   
   Cualquiera con acceso al repositorio (o a su historial de git, aunque se rotaran después) conoce estos tres secrets. Esto vuelve irrelevante en la práctica el punto 1 y 2: no hace falta explotar el fail-open ni el `.includes()`, el secret ya es público.

**Confirmación de cron real (no solo comentario):**
- `migrations/cedear_sync_cron.sql:12-22`, `migrations/indec_sync_cron.sql:12-22`, `migrations/market_rates_sync_cron.sql:19-29`: **las tres SÍ contienen** un `cron.schedule(...)` real con `net.http_post(url:=..., headers:=...)` — no son solo comentarios. `pending_cleanup_cron.sql:5-13` también tiene un cron real, pero de limpieza directa en DB (no invoca ninguna edge function).
- **NO CONFIRMADO:** si estas migraciones fueron efectivamente ejecutadas contra la base de datos de producción (requiere `SELECT * FROM cron.job` en el dashboard real, no disponible desde el repo).

**Otras funciones con secretos:** `mp-webhook` usa `MP_WEBHOOK_SECRET` con el mismo patrón de fail-open (detallado en sección 8). No se encontraron otras funciones con lógica de secret propio fuera de las ya mencionadas.

---

## 6. RLS

*(Auditoría completa de las 43 migraciones. El esquema base — `profiles`, `financial_profiles`, `risk_profiles`, `user_interests`, `ai_usage`, `savings`, `investments` — no tiene `CREATE TABLE` rastreado en el repo; su RLS, si existe, fue configurado fuera de estas migraciones y es NO CONFIRMADO EN EL CÓDIGO para todas ellas, no solo para el punto puntual donde se menciona.)*

| Tabla | RLS habilitado | SELECT | INSERT | UPDATE | DELETE | Notas |
|---|---|---|---|---|---|---|
| `profiles` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | `auth.uid()=id` (`launch_security.sql:53-55`) | Solo existe la policy DELETE; nada de SELECT/INSERT/UPDATE rastreado |
| `financial_profiles` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Cero coincidencias en las 43 migraciones |
| `risk_profiles` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Cero coincidencias |
| `user_interests` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Cero coincidencias |
| `expenses` | Asumido ON (policies aditivas lo requieren) | Base NO CONFIRMADA + 3 policies aditivas confirmadas (ver abajo) | NO CONFIRMADO (base) | **Prometida en comentario pero ausente en código** (`fix_expense_group_isolation.sql`) | NO CONFIRMADO (usa soft-delete vía UPDATE) | Ver detalle abajo |
| `savings` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Sin `CREATE TABLE` rastreado; el propio autor de `launch_security.sql:35` duda de su existencia ("si existe la tabla") |
| `savings_goals` | `goals.sql:14` | `auth.uid()=user_id` | `auth.uid()=user_id` (WITH CHECK) | `auth.uid()=user_id` (WITH CHECK) | `auth.uid()=user_id` | `FOR ALL`, correcto |
| `investments` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Ningún `CREATE TABLE` ni referencia SQL real en todo el repo |
| `ai_usage` | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | NO CONFIRMADO | Solo aparece en un `DELETE FROM ai_usage` dentro de `delete_user_account`; ni tabla ni RLS rastreadas |
| `chat_threads` | `chat_threads.sql:17` | `auth.uid()=user_id` | `auth.uid()=user_id` (WITH CHECK) | `auth.uid()=user_id` | `auth.uid()=user_id` | Correcto |
| `chat_history` | `chat_history.sql:19` | `auth.uid()=user_id` | `auth.uid()=user_id` (WITH CHECK) | **Sin policy UPDATE** (mensajes inmutables vía API) | `auth.uid()=user_id` | Correcto por diseño |
| `gmail_connections` | `gmail.sql:13` | `auth.uid()=user_id` (FOR ALL) | ídem | ídem | ídem | Correcto |
| `gmail_oauth_states` | `gmail_oauth_states.sql:14` | **Sin ninguna policy** — solo service_role accede | — | — | — | Correcto por diseño (comentario explícito en el archivo) |
| `family_groups` | `fix_groups_rls_v2.sql:43` (estado final) | `id IN get_my_group_ids()` | `auth.uid() IS NOT NULL` | **`owner_id=auth.uid() OR id IN get_my_group_ids()`** — cualquier miembro, no solo admin/owner | Mismo patrón que UPDATE — cualquier miembro puede disolver el grupo | 🟠 Ver hallazgo abajo |
| `family_members` | `fix_groups_rls_v2.sql:44` | `group_id IN get_my_group_ids()` | `user_id=auth.uid()` | `user_id=auth.uid()` (WITH CHECK) | `user_id=auth.uid()` | Correctamente acotado a la fila propia |
| `group_expenses` | `fix_groups_rls_v2.sql:87-91` (final) | `group_id IN get_my_group_ids()` | `paid_by=auth.uid() AND group_id IN get_my_group_ids()` | **Sin policy** (nadie puede editar vía API) | `paid_by=auth.uid()` | Correcto en estado final (una versión intermedia había sido más laxa, ya corregida) |
| `group_expense_splits` | `fix_groups_rls_v2.sql:107-111` (final) | 2 policies redundantes con el mismo alcance (OR, sin ampliar acceso) | **2 policies activas en paralelo, una de ellas más amplia de lo previsto** (ver hallazgo abajo) | `user_id=auth.uid() OR group_expense_id IN (pagador)` — deudor o acreedor, diseño intencional (`fix_splits_settle_rls.sql:7-16`) | **Sin policy** (nadie puede borrar vía API) | 🟠 Ver hallazgo abajo |
| `group_transfers` | Confirmada en `group_transfers.sql` (no auditada en detalle en esta pasada — fuera de foco de los hallazgos nuevos) | Miembros del grupo con rol específico | Remitente propio | — | Remitente propio | Sin cambios respecto al relevamiento anterior |
| `pending_transactions` | Confirmada en `gmail.sql` | `auth.uid()=user_id` | — | — | — | Sin cambios respecto al relevamiento anterior |

### 🟠 Hallazgo — `family_groups`: UPDATE/DELETE ampliados a "cualquier miembro"

Estado final (`fix_groups_rls_v2.sql:54-64`):
```sql
CREATE POLICY "family_groups_update" ON family_groups
  FOR UPDATE USING (owner_id = auth.uid() OR id IN (SELECT get_my_group_ids()));
CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (owner_id = auth.uid() OR id IN (SELECT get_my_group_ids()));
```
Sin `WITH CHECK` explícito en el UPDATE (Postgres reutiliza el `USING`). Esto permite que **cualquier miembro del grupo** (rol `member`/`child`/`partner`, no solo `admin`/`parent`/`owner`) actualice cualquier columna de `family_groups` — incluido `owner_id` e `invite_code` — o borre el grupo completo. Versiones previas del mismo día (`fix_groups_rls.sql:38-55`, `group_transfers.sql:68-75`, `family_groups.sql`, `couple_mode.sql`) restringían esto a `owner_id` o roles `parent`/`admin`/`partner`. La reescritura final quitó esa restricción de rol sin comentario que lo justifique. **CONFIRMADO EN CÓDIGO** que el estado final es más amplio que las 3 versiones anteriores; **NO CONFIRMADO** si esto fue intencional o un descuido durante el fix de recursión infinita en RLS.

### 🟠 Hallazgo — `group_expense_splits`: INSERT con policy duplicada más amplia de lo previsto

Dos policies INSERT *permissive* coexisten (Postgres las combina con OR), y ninguna de las dos fue dropeada por las migraciones posteriores:
- `splits_insert` (`fix_groups_rls_v2.sql:120-123`, la que parece la vigente): `WITH CHECK (group_expense_id IN (SELECT id FROM group_expenses WHERE paid_by = auth.uid()))` — solo quien pagó el gasto puede insertar splits.
- `group_splits_insert` (`group_expenses_enhancements.sql:48-54`, **nunca dropeada**): `WITH CHECK (group_expense_id IN (SELECT ge.id FROM group_expenses ge WHERE ge.group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())))` — **cualquier miembro del grupo**, no solo el pagador.

Como se combinan con OR, el efecto neto vigente es: **cualquier miembro del grupo puede insertar una fila de `group_expense_splits`** asignándole una deuda a cualquier otro miembro por cualquier monto, sin ser quien pagó el gasto — y ninguna de las dos policies restringe qué `user_id` se le asigna a la deuda. **CONFIRMADO EN CÓDIGO** (ambas policies existen simultáneamente, verificado por grep exhaustivo de que `group_splits_insert` nunca aparece en un `DROP POLICY`).

### `get_my_group_ids()` — veredicto: correcta

Definida en `fix_family_policies_v2.sql:11-16` y redefinida (misma lógica) en `fix_groups_rls_v2.sql:10-18`:
```sql
CREATE OR REPLACE FUNCTION get_my_group_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT group_id FROM family_members WHERE user_id = auth.uid(); $$;
```
Es `SECURITY DEFINER` (necesario para romper la recursión infinita de evaluar `family_members` dentro de una policy sobre la misma tabla), pero **filtra internamente por `auth.uid()` real de la sesión invocante** — no recibe ningún parámetro manipulable desde el cliente. **Correctamente acotada**, no representa una puerta de acceso cruzado.

---

## 7. Gmail

**Asociación conexión ↔ usuario:** siempre vía JWT validado (`validateJWT()`, `gmail-auth/index.ts:48-58`, llama a `/auth/v1/user`), nunca del body sin verificar. El `userId` final usado en el upsert a `gmail_connections` proviene de `stateRow.user_id` (`gmail-auth/index.ts:155,187-194`) — el valor guardado server-side junto al token CSRF en el paso 1, no de ningún parámetro del callback. **CONFIRMADO correcto.**

**Almacenamiento de tokens:** AES-GCM real (`gmail-auth/index.ts:20-32`), IV aleatorio de 12 bytes por token, clave `GMAIL_ENCRYPTION_KEY` (server-side, nunca expuesta al cliente). No es ofuscación — es cifrado auténtico.

**¿Accesibles desde el cliente?** La policy `gmail.sql:15-17` (`FOR ALL USING (auth.uid()=user_id)`) permite que el usuario dueño lea su propia fila, incluidas las columnas de tokens cifrados — pero sin `GMAIL_ENCRYPTION_KEY` (que nunca sale del servidor) ese ciphertext no es utilizable. **CONFIRMADO, sin riesgo real.**

**Refresh:** `gmail-poll/index.ts:58-80`, `POST oauth2.googleapis.com/token` con `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` server-side.

**`token_expired`****:** si el refresh falla, marca `token_expired=true` y responde **200** (deliberado, comentario explícito en `gmail-poll/index.ts:322-323`) con `code: 'GMAIL_TOKEN_EXPIRED'`, para no disparar un refresh de sesión Supabase innecesario en el cliente.

**¿Un usuario podría acceder a la conexión Gmail de otro?** No — RLS scoped a `auth.uid()=user_id` (arriba).

**¿`oauth_state` manipulable?** El token CSRF es `crypto.randomUUID() + '-' + crypto.randomUUID()` (`gmail-auth/index.ts:90`, ~244 bits de entropía), TTL 10 minutos, de un solo uso (se borra al consumirse), y la tabla `gmail_oauth_states` tiene RLS habilitado sin ninguna policy (solo `service_role` accede — confirmado en sección 6). **No es predecible ni manipulable por un cliente externo.**

**Conclusión: Gmail OAuth está correctamente implementado** — sin hallazgos de severidad relevante.

---

## 8. Mercado Pago

**OAuth state (****`mp_oauth_states`****):** mismo patrón robusto que Gmail (CSRF de 244 bits, TTL 10 min, `stateRow.user_id` usado para el upsert final, `mp-auth/index.ts:73,127-136,163-170`).

**🟠 Hallazgo — ****`mp_oauth_states`**** sin RLS habilitado:** a diferencia de `gmail_oauth_states.sql:14-15` (que explícitamente hace `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` con comentario "solo service role puede acceder"), **`mp_connections.sql` y `mp_connections_v2.sql` no contienen ningún `ALTER TABLE mp_oauth_states ENABLE ROW LEVEL SECURITY`**. Sin RLS habilitado, la tabla queda sujeta a los grants por defecto de Postgres/PostgREST para roles `authenticated`/`anon`, potencialmente permitiendo lectura/escritura directa vía la API REST de Supabase sin pasar por la Edge Function. El impacto práctico sigue acotado por la necesidad de conocer/adivinar un token de 244 bits, pero es una asimetría de diseño no justificada frente a la protección equivalente en Gmail. **CONFIRMADO EN CÓDIGO** la ausencia del `ALTER TABLE`; **NO CONFIRMADO** si se habilitó RLS fuera de las migraciones rastreadas.

**HMAC ****`mp-webhook`****:**
- `MP_WEBHOOK_SECRET` leído con `Deno.env.get('MP_WEBHOOK_SECRET')!` (`mp-webhook/index.ts:6`) — el `!` es solo un assertion de TypeScript, no garantiza nada en runtime.
- `if (MP_WEBHOOK_SECRET) { ... verificación ... }` (`index.ts:27`) — **si la env var no está seteada (`undefined`), todo el bloque de verificación de firma se salta y cualquier request pasa sin validar HMAC.** Mismo patrón fail-open que en la sección 5.
- Comparación `signaturePart !== expectedSig` (línea 34) — no timing-safe (explotabilidad baja).
- **🟠 Sin chequeo de frescura del timestamp** (`ts=` se extrae en línea 28 pero nunca se compara contra la hora actual) → una firma HMAC legítima capturada una vez podría **reenviarse (replay)** indefinidamente.

**¿Cómo determina el ****`user_id`**** del pago?** `mp-webhook/index.ts:47-60` toma `paymentId` del body entrante, pero **inmediatamente hace un `GET` real a `api.mercadopago.com/v1/payments/<id>` con `MP_ACCESS_TOKEN`** — no confía en el payload del webhook para los datos del pago. `external_reference` (→ `userId`) y `metadata.plan_id` se leen de esa respuesta real de MP, no del payload entrante. Ese `external_reference` fue fijado originalmente en `create-payment/index.ts:59` con el `user.id` derivado de un JWT validado (`getUser()`, línea 27-30), nunca del body del cliente. **CONFIRMADO: no se puede inyectar un `external_reference` falso vía el payload del webhook.**

**¿Se puede activar premium sin pagar?** No trivialmente — el `status` que importa (`approved`) se lee de la respuesta real de la API de MP, no del JSON entrante. **Pero sí es posible el replay**: si un atacante consigue una firma HMAC válida ya usada para un pago legítimamente aprobado (por captura de logs/proxy, o si `MP_WEBHOOK_SECRET` no está seteado en producción), puede reenviar ese mismo webhook para **re-extender `plan_expires_at` repetidamente sin pagar de nuevo** — no hay chequeo de timestamp ni idempotencia efectiva a nivel de negocio (el `UNIQUE(payment_id)` de `payment_logs` existe, pero su violación se ignora con un `.catch()` y el `UPDATE` a `profiles` ocurre antes e independientemente de ese insert).

**`create-payment`****:** valida JWT real (`getUser()`, líneas 27-30); usa `user.id` del JWT (no del body) para `external_reference`/`metadata`; el precio se resuelve server-side desde `PLAN_CONFIG` — el cliente no puede alterar el monto. **CONFIRMADO correcto.**

**Confirmado / No confirmado:**
- CONFIRMADO: `mp-webhook` no confía ciegamente en el payload (consulta la API real de MP); `create-payment` deriva todo del JWT.
- CONFIRMADO: fail-open si `MP_WEBHOOK_SECRET` no está seteado; sin protección anti-replay por timestamp; `mp_oauth_states` sin `ENABLE ROW LEVEL SECURITY` en las migraciones rastreadas.
- NO CONFIRMADO: si `MP_WEBHOOK_SECRET` está realmente seteado en producción hoy.

---

## 9. Groq/secrets

Búsqueda exhaustiva de `GROQ_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MP_ACCESS_TOKEN`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `GMAIL_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y patrones tipo `sk-`/`gsk_` hardcodeados en todo `mobile/`.

- **Todas las apariciones de estas variables están exclusivamente dentro de `mobile/supabase/functions/*/index.ts`, siempre vía `Deno.env.get(...)`.** Ninguna en `mobile/src/` ni `mobile/app/` (código cliente). **CONFIRMADO correcto.**
- `mobile/src/lib/env.ts:4-9` solo expone `SUPABASE_URL`/`SUPABASE_ANON_KEY` al cliente, con comentario explícito de que `GROQ_API_KEY` nunca debe ir ahí.
- Ningún patrón `sk-`/`gsk_` con valor real en código — la única mención de `gsk_...` está en `mobile/SETUP.md:57` como placeholder de documentación (`supabase secrets set GROQ_API_KEY=gsk_...`), no un valor real.
- `.env` real (con valores locales) **no está trackeado por git** (confirmado vía `git ls-files` y `.gitignore:34`); `.env.example` (sí versionado) solo contiene placeholders.
- **Único hallazgo real de secretos expuestos en el repo, ya cubierto en la sección 5:** los tres secrets de cron (`CEDEAR_SYNC_SECRET`, `INDEC_SYNC_SECRET`, `MARKET_RATES_SYNC_SECRET`) están hardcodeados en texto plano dentro de migraciones SQL versionadas — no son API keys de terceros, pero son secretos de la propia aplicación igualmente comprometidos.

**Conclusión: el manejo de `GROQ_API_KEY`/`GOOGLE_CLIENT_*`/`MP_*` está correctamente segregado server-side. El único problema de exposición de secretos es el de la sección 5 (cron secrets propios, no de terceros).**

---

## 10. Supabase client/RPC

Grep de `.rpc(` y `.functions.invoke(` en `mobile/src/` y `mobile/app/`.

**`.functions.invoke(...)`** (6 llamadas, todas en `app/(app)/`): `ai-advisor` (`advisor.tsx:376,544`), `transcribe` (`advisor.tsx:612`), `investment-advisor` (`investment-alternatives.tsx:435`), `create-payment` (`plans.tsx:225`), `gmail-auth` DELETE (`profile.tsx:207`) — todas pasan por edge functions ya auditadas.

**`.rpc(...)`** (9 funciones distintas invocadas desde el cliente):

| RPC | Parámetros | ¿Toca ID ajeno? | Validación server-side |
|---|---|---|---|
| `create_family_group` | `p_name, p_invite_code, p_group_type, p_owner_role` | No | Definición SQL NO CONFIRMADA (no está en las migraciones); posible código legado — solo se usa desde `grupo-familia.tsx` (ruta oculta/no integrada, ver relevamiento anterior) |
| `increment_ai_usage` | `p_user_id: userId, p_month` — llamado también desde `planStore.ts:120` con el propio id | Sí, pero en este call site es el propio usuario | Ya cubierto en secciones 1-2: el problema real es la invocación desde las Edge Functions con service role, no este call site del cliente |
| `expense_has_group_link` | `p_expense_id` | No (ID de gasto) | — |
| `get_group_members` | `p_group_id` | Sí — expone `user_id`/`full_name`/`email` de miembros del grupo | `group_members_v2.sql:124-146`, `SECURITY DEFINER`, valida `p_group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())` — **correcto**, pero es el vector de obtención de UUIDs ajenos que habilita explotar `delete_user_account` e `increment_ai_usage` en la práctica |
| `find_group_by_invite_code` | `p_code` | No (código público por diseño) | Correcto — solo expone id/nombre/tipo del grupo |
| `create_group_with_admin` | `p_name, p_group_type, p_invite_code` | No | `create_group_rpc.sql:8-48`, usa `auth.uid()` internamente para el admin (comentario explícito: "nunca acepta user_id del frontend") — **correcto** |
| `update_member_role` | `p_group_id, p_user_id` (de OTRO usuario), `p_role` | Sí | `group_members_v2.sql:149-178`, valida que el caller sea `role='admin'` del grupo, bloquea auto-cambio de rol, protege que quede al menos un admin — **correcto** |
| `update_member_permissions` | `p_group_id, p_user_id` (de OTRO usuario), `p_permissions` | Sí | `group_members_v2.sql:181-194`, valida admin del grupo; no valida que `p_user_id` pertenezca al grupo antes del UPDATE, pero el `WHERE` de la query hace que no tenga efecto si no pertenece — riesgo bajo |
| `delete_user_account` | `p_user_id: user?.id` | No en este call site (propio id) | Ver sección 3 — el problema es que el endpoint acepta cualquier `p_user_id`, no cómo lo usa la UI |

**Conclusión:** las RPCs de grupos (`get_group_members`, `create_group_with_admin`, `update_member_role`, `update_member_permissions`, `find_group_by_invite_code`) están **correctamente protegidas server-side** con chequeos explícitos de rol/membresía dentro del propio SQL. El problema no es la protección de estas RPCs en sí, sino que `get_group_members` es, por diseño legítimo, la vía por la que un usuario obtiene UUIDs reales de otros — lo cual se vuelve peligroso combinado con `delete_user_account` e `increment_ai_usage`, que sí carecen de esa protección.

---

## 11. Logs

**Edge Functions** (visibles solo desde el dashboard de Supabase — severidad moderada por ese motivo, no exposición pública):

| Archivo:línea | Qué imprime | Riesgo |
|---|---|---|
| `gmail-poll/index.ts:424` | Primeros 200 caracteres del cuerpo crudo de emails bancarios reales | **Alto** — contenido financiero real del email |
| `gmail-poll/index.ts:400` | Remitente y asunto real del email procesado | **Medio-Alto** — el asunto de notificaciones bancarias suele incluir montos/comercios |
| `gmail-poll/index.ts:209,218` | Respuesta cruda y parseada de Groq (monto, comercio, fecha de la transacción) | **Medio** |
| `gmail-poll/index.ts:279` | Email real del usuario conectado | **Medio** |
| `gmail-poll/index.ts:454,518` | Nombre de remitente + monto de transferencia; comercio + monto de gasto confirmado | **Medio** |
| `mp-auth/index.ts:174` | Solo IDs internos (UUID Supabase + ID de usuario MP) | **Bajo** |

**No se encontraron** logs que impriman `access_token`/`refresh_token` en texto plano, el header `Authorization` completo, ni el JWT, en ninguna Edge Function — se confirmó por grep dirigido que solo se loguean estados (`"ok"`, `"vencido"`) nunca el valor. **Buena práctica ya implementada.**

**Código cliente:** ~30 `console.*` revisados, ninguno imprime tokens/JWT/contraseñas. El más cercano (`expenses.tsx:1406`) imprime `'ok'/'null'`, no el valor real del token.

**Conclusión:** el hallazgo real es que `gmail-poll` loguea contenido de emails bancarios y transacciones reales en los logs de la función — mala práctica para datos financieros/PII, severidad media dado que el acceso está limitado al equipo con acceso al dashboard.

---

## 12. CORS

11 de las 17 funciones (las que reciben tráfico de cliente) usan `Access-Control-Allow-Origin: '*'` de forma idéntica: `ai-advisor`, `investment-advisor`, `cedear-sync`, `create-payment`, `gmail-auth`, `gmail-poll`, `indec-sync`, `mp-auth`, `mp-poll`, `process-screenshot`, `transcribe`. Las funciones puramente server-to-server (`fetch-market-rates`, `mp-webhook`, `send-push`, `advisor-sunday`) no emiten headers CORS en absoluto (no los necesitan).

**Impacto real (no automático):** CORS es una protección que aplican los **navegadores**, no las apps nativas — el consumidor primario de estos endpoints es una app React Native/Expo, que no está sujeta a same-origin policy y nunca depende de estos headers. El escenario donde `'*'` importa es: una página web arbitraria, en el navegador de una víctima, haciendo `fetch()` hacia estos endpoints. Para que eso filtre datos, la víctima necesitaría tener su JWT de Supabase accesible a ese script — pero Supabase usa **Bearer tokens en el header `Authorization`**, no cookies de sesión, así que un `fetch()` cross-site no adjunta automáticamente ninguna credencial (a diferencia del CSRF clásico basado en cookies). Si un atacante ya tiene el JWT de la víctima por otra vía, podría llamar a la API directamente desde su propio backend sin necesitar que la víctima abra nada en su navegador — CORS no agrega ni quita nada en ese escenario.

**Conclusión: `'*'` en estas 11 funciones es una configuración de bajo riesgo dado el modelo de autenticación por Bearer token de una app nativa.** No es la prioridad de esta auditoría — los hallazgos de autorización (secciones 3, 1-2, 6) son órdenes de magnitud más relevantes.

---

# MATRIZ FINAL

| Hallazgo | Severidad | Confirmado | Archivo/migración | Impacto | ¿Requiere código? |
|---|---|---|---|---|---|
| `delete_user_account` sin chequeo `auth.uid()=p_user_id` | 🔴 Crítico | Confirmado | `launch_security.sql:15-46` | Cualquier usuario autenticado puede borrar la cuenta/datos de otro usuario conociendo su UUID (obtenible vía `get_group_members`) | Sí |
| `delete_user_account` referencia tabla `goals` inexistente | 🔴 Crítico | Inferido (alta confianza) | `launch_security.sql:31` | Probable aborto completo de la función en runtime — borrado de cuenta (compliance Apple/Google) posiblemente no funciona en absoluto hoy | Sí |
| Secrets de cron hardcodeados en migraciones versionadas | 🔴 Crítico | Confirmado | `cedear_sync_cron.sql:18`, `indec_sync_cron.sql:18`, `market_rates_sync_cron.sql:25` | Los 3 secrets reales son públicos para cualquiera con acceso al repo/historial de git | No (rotar secrets + no versionar) |
| `send-push` sin ninguna validación de Authorization | 🔴 Crítico | Confirmado (código); despliegue actual NO CONFIRMADO | `send-push/index.ts` (todo el archivo) | Cualquiera con la URL puede enviar push arbitrarias (título/cuerpo/deep-link) a cualquier usuario | Sí |
| `increment_ai_usage` invocada con `user_id` no verificado (service role) | 🟠 Alto | Confirmado (patrón de invocación); cuerpo de la RPC NO CONFIRMADO | `ai-advisor/index.ts:597-604`, `investment-advisor/index.ts:320-325` | Agotamiento dirigido de la cuota freemium de otro usuario | Sí |
| `mp_oauth_states` sin `ENABLE ROW LEVEL SECURITY` | 🟠 Alto | Confirmado (ausencia en migraciones); RLS fuera de repo NO CONFIRMADO | `mp_connections.sql`, `mp_connections_v2.sql` | Posible lectura/escritura directa vía PostgREST sin pasar por la Edge Function | No (agregar migración) |
| `group_expense_splits` INSERT — policy duplicada amplía acceso | 🟠 Alto | Confirmado | `group_expenses_enhancements.sql:48-54` (nunca dropeada) + `fix_groups_rls_v2.sql:120-123` | Cualquier miembro del grupo puede asignar deuda a otro miembro sin ser el pagador | No (DROP POLICY) |
| `mp-webhook` vulnerable a replay (sin chequeo de timestamp) | 🟠 Alto | Confirmado (código); si el secret está seteado en prod es NO CONFIRMADO | `mp-webhook/index.ts:27-38` | Re-extensión indefinida de un plan pago con una firma capturada una vez | Sí |
| `family_groups` UPDATE/DELETE ampliado a "cualquier miembro" | 🟠 Alto | Confirmado | `fix_groups_rls_v2.sql:54-64` | Cualquier miembro (no solo admin/owner) puede editar `owner_id`/`invite_code` o disolver el grupo | No (ajustar policy) |
| Cron secrets: `.includes()` + fail-open si falta la env var | 🟠 Alto | Confirmado | `fetch-market-rates/index.ts:69-71`, `cedear-sync/index.ts:95-97`, `indec-sync/index.ts:22-24` | Sin el secret seteado, cualquiera puede disparar re-sync a voluntad | Sí |
| `mp-webhook` fail-open si `MP_WEBHOOK_SECRET` no está seteado | 🟠 Alto | Confirmado (código); si está seteado en prod es NO CONFIRMADO | `mp-webhook/index.ts:27` | Sin el secret, cualquiera puede enviar webhooks falsos (aunque el status igual se verifica contra la API real de MP) | Sí |
| `advisor-sunday` sin autenticación, itera toda la base de usuarios | 🟠 Alto | Confirmado (código); despliegue actual NO CONFIRMADO | `advisor-sunday/index.ts` | Spam de notificaciones a todos los usuarios con `push_token`, invocable repetidamente sin límite | Sí |
| `gmail-poll` loguea contenido real de emails bancarios | 🟡 Medio | Confirmado | `gmail-poll/index.ts:400,424` | Asunto/remitente/cuerpo de emails financieros visibles en logs del dashboard | Sí |
| RLS de `profiles`/`financial_profiles`/`risk_profiles`/`user_interests`/`savings`/`investments`/`ai_usage` no confirmable | 🟡 Medio | No confirmado (brecha de auditoría, no vulnerabilidad probada) | Sin migración de creación rastreada | No se puede garantizar desde el repo que estas tablas —las más sensibles— tengan RLS correcto | No (requiere confirmar en dashboard) |
| `fix_expense_group_isolation.sql` promete policy UPDATE que no existe en el código | 🟡 Medio | Confirmado (discrepancia comentario/código) | `fix_expense_group_isolation.sql` | Documentación interna del proyecto no coincide con el SQL real | No (aclarar/agregar) |
| Cuerpo real de `increment_ai_usage` ausente del repo | 🟡 Medio | No confirmado | — | No se puede verificar si valida `auth.uid()` internamente | No (requiere localizar/documentar) |
| CLAUDE.md dice "Verify JWT debe estar OFF" pero está ON en 5 funciones | 🟡 Medio (discrepancia documental, no vulnerabilidad) | Confirmado | `functions list`: `ai-advisor`, `investment-advisor`, `gmail-poll`, `mp-poll`, `transcribe` | Documentación del proyecto desactualizada respecto al estado real desplegado | No (actualizar CLAUDE.md) |
| CORS `'*'` en 11 funciones | 🟢 Informativo | Confirmado | Todas las funciones orientadas a cliente | Riesgo real bajo dado el modelo Bearer-token de una app nativa | No |
| Policies RLS redundantes en `group_expense_splits` SELECT | 🟢 Informativo | Confirmado | `fix_groups_rls_v2.sql:113-118` + `group_expenses_enhancements.sql:38-44` | Duplicación sin ampliar acceso (ambas tienen el mismo alcance funcional) | No (limpieza, no seguridad) |
| `parse-transactions` desplegada como `ACTIVE` sin `index.ts` local | 🟢 Informativo | Confirmado (ya señalado en el relevamiento anterior, reconfirmado) | `mobile/supabase/functions/parse-transactions/` | Estado del código realmente desplegado no verificable desde el repo | No |

---

# COSAS QUE YA ESTÁN BIEN

- **`chat_threads`/`chat_history`**: RLS completo y correcto (`SELECT`/`INSERT`/`UPDATE`/`DELETE` — o `SELECT`/`INSERT`/`DELETE` en `chat_history` — todas con `user_id = auth.uid()`, `INSERT` con `WITH CHECK`). Ningún usuario puede leer ni escribir en threads/mensajes ajenos, ni siquiera si `investment-advisor` no valida el `user_id` del body — la protección real está en la base de datos, no en la edge function.
- **Gmail OAuth**: cifrado AES-GCM real de tokens (no ofuscación), CSRF tokens con ~244 bits de entropía y de un solo uso, `gmail_oauth_states` con RLS habilitado sin policies (solo `service_role`), asociación usuario↔conexión resuelta siempre server-side vía JWT validado, nunca desde parámetros del cliente.
- **`create-payment`**: deriva el `user_id` de un JWT validado con `getUser()`, no del body; el monto se resuelve server-side desde una tabla de configuración fija — el cliente no puede alterar el precio.
- **`mp-webhook`**: no confía ciegamente en el payload entrante — siempre re-consulta el estado real del pago contra la API de Mercado Pago con `MP_ACCESS_TOKEN` antes de activar cualquier plan, lo que bloquea la fabricación de pagos falsos desde cero.
- **`get_my_group_ids()`**: aunque es `SECURITY DEFINER`, filtra internamente por `auth.uid()` real y no recibe ningún parámetro manipulable — es la forma correcta de romper recursión infinita en RLS sin abrir una puerta de acceso cruzado.
- **RPCs de grupos** (`get_group_members`, `create_group_with_admin`, `update_member_role`, `update_member_permissions`): todas validan explícitamente membresía/rol de admin dentro del propio SQL, no confían en el cliente.
- **`family_members`** (a diferencia de `family_groups`): sus policies UPDATE/DELETE quedaron correctamente acotadas a `user_id = auth.uid()` en la reescritura final.
- **`group_expenses`**: aunque una versión intermedia había debilitado el chequeo de `paid_by`, el estado final restauró correctamente `paid_by = auth.uid()` en el INSERT.
- **Manejo de secrets de terceros** (`GROQ_API_KEY`, `GOOGLE_CLIENT_*`, `MP_*`, `GMAIL_ENCRYPTION_KEY`): sin excepciones, todos viven exclusivamente server-side vía `Deno.env.get(...)`, nunca en código cliente.
- **`.env`**: correctamente excluido de git (`.gitignore`); `.env.example` solo tiene placeholders.
- **Logs**: ninguna función ni código cliente imprime tokens, JWT o el header `Authorization` completo en texto plano (con la única excepción de contenido de emails en `gmail-poll`, que no son credenciales sino datos financieros).
- **CORS**: el uso de `'*'` es una decisión de bajo riesgo dado el modelo de autenticación por Bearer token de una app nativa, no una vulnerabilidad.
- **`ai-advisor`/`investment-advisor`**: a nivel de Gateway (`verify_jwt=true`), rechazan cualquier request sin un JWT Supabase genuino antes de ejecutar código — esto es una protección real, aunque no documentada como tal en CLAUDE.md.

---

# COSAS NO CONFIRMABLES

Requieren acceso al dashboard de Supabase, a la base de datos de producción, o a las variables de entorno reales — no se pueden determinar desde este repositorio:

- Estado de RLS de `profiles`, `financial_profiles`, `risk_profiles`, `user_interests`, `savings`, `investments`, `ai_usage` (esquema base sin migración de creación rastreada).
- Código fuente real de la función `increment_ai_usage` (no existe en ningún `.sql` del repo).
- Si `MP_WEBHOOK_SECRET`, `CEDEAR_SYNC_SECRET`, `INDEC_SYNC_SECRET`, `MARKET_RATES_SYNC_SECRET` están efectivamente seteados como variable de entorno en producción hoy (aunque los tres últimos ya son públicos vía git de todas formas).
- Si las migraciones con `cron.schedule` (`cedear_sync_cron.sql`, `indec_sync_cron.sql`, `market_rates_sync_cron.sql`, `pending_cleanup_cron.sql`) fueron efectivamente ejecutadas contra la base de producción (`SELECT * FROM cron.job` no accesible desde acá).
- Si `send-push` y `advisor-sunday` están realmente sin desplegar hoy, o si simplemente no aparecieron en el listado por otro motivo.
- Si las tablas `goals`, `savings`, `investments` existen en producción con el nombre/forma exacta que el código asume (afecta directamente si `delete_user_account` falla parcial o totalmente).
- Comportamiento transaccional real de `delete_user_account` al ejecutarse contra la base real (el análisis de aborto-por-tabla-inexistente es una inferencia de la semántica estándar de PL/pgSQL, no una ejecución verificada).
- Si el paso de borrado de `auth.users` (mencionado en el comentario de `launch_security.sql:43`) está implementado en algún lugar fuera de este repo.

---

# RECOMENDACIÓN DE ORDEN

*(Solo orden de prioridad para la próxima fase — no se implementó nada.)*

1. `delete_user_account` — agregar el chequeo `p_user_id = auth.uid()` y corregir la referencia a la tabla `goals` inexistente (probable rotura total de la función hoy).
2. Rotar los tres secrets de cron ya expuestos en git (`CEDEAR_SYNC_SECRET`, `INDEC_SYNC_SECRET`, `MARKET_RATES_SYNC_SECRET`) y evitar volver a hardcodear valores reales en migraciones versionadas.
3. `send-push` — agregar validación de origen (secret compartido o restricción a invocación interna) antes de un eventual despliegue.
4. `increment_ai_usage` — localizar/crear su definición con un chequeo real de identidad, o cambiar el patrón de invocación en `ai-advisor`/`investment-advisor` para que no dependa de un `user_id` de body no verificado.
5. `mp_oauth_states` — habilitar RLS explícitamente (mismo patrón que `gmail_oauth_states`).
6. `group_expense_splits` — eliminar la policy `group_splits_insert` redundante/más amplia.
7. `mp-webhook` — agregar validación de frescura de timestamp para prevenir replay.
8. `family_groups` — revisar si el UPDATE/DELETE realmente debe estar abierto a cualquier miembro o solo a admin/owner.
9. Cron secrets (`fetch-market-rates`/`cedear-sync`/`indec-sync`) — cambiar `.includes()` por comparación exacta/timing-safe y decidir si deben fallar cerrado cuando falta el secret.
10. `advisor-sunday` — agregar autenticación antes de cualquier despliegue futuro.
11. Confirmar en el dashboard el estado real de RLS de las tablas core (`profiles`, `financial_profiles`, `risk_profiles`, `user_interests`, `savings`, `investments`, `ai_usage`) — es la brecha de visibilidad más grande de toda esta auditoría.
12. `gmail-poll` — reducir el nivel de detalle logueado de emails bancarios reales.
13. Actualizar CLAUDE.md para reflejar que `verify_jwt` está ON en 5 funciones (dato positivo, pero la documentación actual dice lo contrario).

---

## Verificación final

`npm test` ejecutado al finalizar la auditoría: **134/134 tests pasando**, sin cambios respecto al estado previo. No se modificó, creó, movió ni ejecutó ningún archivo de código, migración o configuración durante esta auditoría.
