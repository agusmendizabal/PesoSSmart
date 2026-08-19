# Relevamiento completo — PesoSSmart

*Informe descriptivo y objetivo del estado actual del código. Sin recomendaciones, sin propuestas de mejora. Todo lo que no pudo confirmarse directamente en el código está marcado explícitamente como "NO CONFIRMADO EN EL CÓDIGO".*

---

## 1. Resumen general

PesoSSmart es una app de finanzas personales para Argentina construida en React Native + Expo (SDK 54), con Expo Router (ruteo por archivos) y backend en Supabase (Postgres + Edge Functions Deno). El procesamiento con IA (Groq, modelos `llama-3.3-70b-versatile`, `llama-3.2-11b-vision-preview`, `whisper-large-v3-turbo`) corre exclusivamente server-side en edge functions; la clave de Groq nunca llega al cliente.

La app tiene tres grupos de rutas: `(auth)`, `(onboarding)` y `(app)` (5 tabs visibles + un número mayor de rutas ocultas accesibles por navegación interna). El estado general del código muestra un patrón recurrente: **varias funcionalidades están completamente implementadas pero no están conectadas a ningún flujo de navegación real** (componentes importados pero nunca montados, pantallas registradas pero sin ningún `router.push` que apunte a ellas, tablas de base de datos sin ningún consumidor en el código). Esto se documenta caso por caso en las secciones siguientes y se resume en la sección 17.

El sistema más recientemente desarrollado es "Plan Inteligente" (motor de ritmo de gasto, destinos de ahorro y alternativas de inversión), que según el código y los tests (134/134 pasando) está terminado y activo. Por fuera de "Plan Inteligente", existe un motor de "widgets inteligentes" (`widgetEngine.ts`) y varios componentes de Home construidos pero no renderizados.

---

## 2. Mapa completo de pantallas

### `(auth)/`
| Pantalla | Ruta | Notas |
|---|---|---|
| Login | `/(auth)/login` | — |
| Registro | `/(auth)/register` | — |
| Recuperar contraseña | `/(auth)/forgot-password` | — |
| Landing | `/(auth)/landing` | **Huérfana**: pantalla "demo" completamente construida pero no referenciada desde `app/index.tsx` ni desde ningún otro punto de navegación encontrado en el código. |

### `(onboarding)/`
| Pantalla | Ruta | Notas |
|---|---|---|
| Welcome | `/(onboarding)/welcome` | Primer paso |
| Financial profile | `/(onboarding)/financial-profile` | 4 sub-pasos internos: ingreso, tipo de trabajo, situación familiar, ahorro |
| Interests | `/(onboarding)/interests` | Selección de intereses temáticos |
| Risk profile | `/(onboarding)/risk-profile` | Cuestionario de perfil de riesgo |
| Gmail connect | `/(onboarding)/gmail-connect` | Conexión opcional de Gmail, distinta de la versión post-onboarding |

### `(app)/` — 23 archivos `.tsx` + `_layout.tsx`
| Pantalla | Ruta | Tab bar | Notas |
|---|---|---|---|
| Home | `/(app)/home` | Visible | — |
| Gastos | `/(app)/expenses` | Visible | — |
| Ahorros | `/(app)/savings` | Visible | — |
| Grupos | `/(app)/family` | Visible | — |
| Perfil | `/(app)/profile` | Visible | — |
| Reportes | `/(app)/reports` | Oculta | Accesible desde Gastos/Home |
| Detalle de categoría | `/(app)/category-detail` | Oculta | — |
| Meta de ahorro | `/(app)/savings-goal` | Oculta | — |
| Oportunidades de ahorro | `/(app)/savings-opportunities` | Oculta | — |
| Plan inteligente | `/(app)/savings-plan` | Oculta | Accesible desde Ahorros |
| Alternativas de inversión | `/(app)/investment-alternatives` | Oculta | Accesible desde Plan Inteligente |
| Simulador | `/(app)/simulator` | Oculta | Múltiples puntos de entrada activos |
| Planes (upgrade) | `/(app)/plans` | Oculta | — |
| Asesor IA genérico | `/(app)/advisor` | Oculta | **Inalcanzable**: `ADVISOR_ENABLED = false` |
| Alertas inteligentes | `/(app)/smart-alerts` | Oculta | **Inalcanzable**: ningún `router.push` apunta aquí |
| Detalle de widget | `/(app)/insight` | Oculta | **Inalcanzable**: su disparador (`SmartWidget`) está importado en Home pero nunca renderizado |
| Centro de ayuda | `/(app)/help` | Oculta | Accesible desde Perfil |
| Gmail connect (app) | `/(app)/gmail-connect` | Oculta | Accesible desde Perfil, distinta de la de onboarding |
| Detalle de grupo | `/(app)/group-detail` | Oculta | Accesible desde Grupos |
| Código de grupo | `/(app)/group-code` | Oculta | Accesible desde detalle de grupo |
| Detalle de miembro | `/(app)/member-detail` | Oculta | Accesible desde detalle de grupo (solo admin, grupos familiares) |
| Grupo familiar (sistema paralelo) | `/(app)/grupo-familia` | Oculta | Accesible **solo** desde Centro de ayuda; sistema no integrado con `family.tsx` |

No se detectaron modales o sheets fuera de este listado que constituyan pantallas propias con ruta — los flujos tipo modal (crear grupo, unirse por código, editar gasto, etc.) están implementados como componentes dentro de las pantallas de arriba, no como rutas separadas.

---

## 3. Navegación

- **Redirect inicial** (`app/index.tsx`): comprueba sesión Supabase + `profiles.onboarding_completed`. Si hay sesión pero el perfil aún no cargó (`null`), el código cae a `/(app)/home` en vez de esperar explícitamente — **NO CONFIRMADO EN EL CÓDIGO** si existe algún guard adicional en otro punto que evite una carrera de estados en ese instante.
- **Tab bar** (`app/(app)/_layout.tsx`): 5 entradas visibles — `savings`, `expenses`, `home`, `family`, `profile`. El resto de las rutas de `(app)/` están registradas con `options={{ href: null }}` (ocultas del tab bar, pero navegables por `router.push`).
- **Feature flag `ADVISOR_ENABLED`** (`src/lib/features.ts`): `false`. Controla la visibilidad del chat de IA genérico en todos sus puntos de entrada (`home.tsx` ×5, `savings.tsx`, `insight.tsx`, `ReportCards.tsx` ×2). En cada callsite verificado, la navegación a `/(app)/advisor` está condicionada por el flag; cuando está apagado, redirige a `ADVISOR_FALLBACK_CTA` (`/(app)/reports`, label "Ver análisis").
- **`landing.tsx`** (`(auth)`): construida pero sin ningún punto de entrada de navegación encontrado.
- **`grupo-familia.tsx`**: único punto de entrada es el ítem "Familia" del Centro de ayuda (`help.tsx`), que no está conectado al tab real "Grupos".
- **`smart-alerts.tsx`** e **`insight.tsx`**: sin ningún `router.push` en toda la base de código que apunte a ellas (huérfanas — ver sección 17).

---

## 4. Home

Pantalla real (`home.tsx`, ~3300 líneas) renderiza, en orden: header con saludo ("Buen día", **hardcodeado, no varía según la hora del día**) e ícono de chat (oculto por `ADVISOR_ENABLED`); `PremiumBannerCarousel` (banners con reglas de prioridad); tarjeta de resumen de 4 columnas; donut "Dónde más gastaste"; anillo "Tu salud financiera" (usa la función real `computeHealthScore`); "Inflación personal vs. oficial" (comparación contra el dataset estático embebido `indecData.ts`, **no** una API en vivo); "Actividad reciente" (solo los 2 gastos más recientes, sin tap-through a detalle); tarjeta "Oportunidad para vos" (barra de progreso con **ancho hardcodeado `'72%'`**, no ligado a ninguna proporción real, y una estimación de retorno con **3% plano una sola vez**, no interés compuesto); `QuickStartCard`; sheet de primera visita (`FirstVisitSheet`).

**Componentes/motores definidos en el archivo pero nunca renderizados en el JSX actual** (importados o calculados, sin ninguna instancia en pantalla — confirmado por grep exhaustivo): `MonthHeroCard`, `RecoverableCard`, `TopCategoriesCard`, `QuickActions`, `MarketTicker` (traería cotizaciones de Bluelytics en vivo), `DatosClaveCard` junto con su motor `buildKeyInsights` (15 reglas de insight financiero), `HomeHighlightCarousel`, `GmailPendingBanner`, `MonthSpendingMini`, `CompactWidgetsRow`, `OpportunityHeroCard`, `TopLeakCard`, `QuickActionsSection`, `ProjectedBalanceCard`, `GoalsSection`, `StreakCard`, `HealthScoreCard` (componente visual, distinto de la función `computeHealthScore` que sí se usa), `DecisionHistorySection`, `RoundUpSummary`, `MonthInsightCard`, `SmartWidget` (junto con `computeAllWidgets`, calculado en un `useMemo` pero sin ningún `<SmartWidget />` en el JSX).

---

## 5. Gastos

`expenses.tsx` (~3540 líneas): listado con filtro por mes/clasificación/búsqueda, modal de edición/borrado (soft delete), importación por Gmail (`gmail-poll`) e importación por captura de pantalla (`process-screenshot`, OCR en dos etapas con Groq: visión → texto estructurado).

- **Inconsistencia entre flujos de importación**: al guardar un gasto detectado por captura de pantalla, la app **descarta** la `classification`/categoría que la IA sugirió (solo conserva descripción/monto/fecha). El flujo de Gmail, en cambio, sí deja que el usuario confirme/use la clasificación sugerida por la IA vía `PendingTransactions.tsx`.
- Las etiquetas "🤖 Asistente inteligente" / "Mejores coincidencias ✨" del modal de clasificación manual **no son IA real**: son el resultado de una función heurística local, `computeCategoryMatches()` (similitud de texto contra el historial + diccionario fijo de palabras clave en español), sin ninguna llamada de red ni de modelo.
- `classification_explanation` y `classification_confidence` existen como columnas en el esquema pero no se encontró ningún código que las escriba.
- `category_detail.tsx` usa los campos del motor `budgetPlan` (ver sección 9) para el gráfico de progreso por categoría.
- `reports.tsx` — `AINarrativeCard` (llamada a `ai-advisor` con `generate_report:true`) es la **única** llamada generativa de LLM en todo el sistema de Gastos/Reportes fuera de las clasificaciones de `gmail-poll`/`mp-poll`/`process-screenshot`.
- `budgetNotifications.ts`: motor de notificaciones locales ligado al plan de presupuesto (ver sección 12).

---

## 6. Ahorro

`savings.tsx` (tab "Ahorros"): gestiona **bolsillos de efectivo** (`savingsStore`, tabla `savings`) y **metas** (`goalsStore`, tabla `savings_goals`) — CRUD completo para ambos. Pese a que `savingsStore` implementa CRUD completo también para **inversiones** (tabla `investments`), esta pantalla **no muestra ni permite gestionar ningún registro de `investments`**; no se encontró ninguna otra pantalla que lo haga.

- `GoalsSection.tsx` está importado en `home.tsx` pero nunca instanciado en su JSX — `home.tsx` implementa su propia lógica de "meta activa" en línea, más simple, en su lugar.
- `DineroRecuperableCard` (componente) y su función constructora `buildAhorroSugerencias` (en `src/components/ReportCards.tsx`) están completamente implementados, pero **la tarjeta en sí nunca se renderiza como lista/card visible** en ningún punto de la app (confirmado por grep exhaustivo). Los números que produce `buildAhorroSugerencias` sí se usan internamente: `expenses.tsx` los usa para calcular `totalRecuperable` (mostrado en un `AnalysisTeaser`), y `reports.tsx` los usa para alimentar un string de contexto enviado al asesor de IA. Dentro de "Plan Inteligente" (`savings-plan.tsx`), este mismo componente/builder sí se reutiliza como sección visible (ver sección 9).
- `savings-goal.tsx`: alta/edición de una meta individual.
- `savings-opportunities.tsx`: listado de categorías con oportunidad de ahorro, derivado del motor de `budgetPlan` (ver sección 9).
- `savings-plan.tsx` ("Plan Inteligente"): pantalla central del motor de presupuesto — hero con presupuesto/gastado/disponible, tarjetas por categoría con nivel de alerta y mensaje específico, lista de insights priorizados, y la sección de "dinero recuperable" reutilizada de `ReportCards.tsx`.

---

## 7. Inversiones

Distinción explícita entre los cuatro niveles que coexisten en el código:

- **Categorías conceptuales** (`src/lib/investmentCategories.ts`): agrupaciones por nivel de riesgo/perfil, usadas para clasificar qué tipo de alternativa mostrarle a cada usuario según su `risk_profile` y su `investment readiness` — no son instrumentos concretos, son "familias" conceptuales.
- **Instrumentos concretos**: los 5 instrumentos hardcodeados en `simulator.tsx` (`BASE_INSTRUMENTS`) — FCI Money Market, Lecaps, Plazo Fijo UVA, Dólar MEP, Cedears — cada uno con tasa efectiva mensual de fallback, nivel de riesgo, plazo mínimo y nota descriptiva.
- **Datos reales**: tabla `market_rates`, poblada por tres cron jobs (`fetch-market-rates` desde BCRA/Bluelytics, `indec-sync` desde datos.gob.ar, `cedear-sync` desde Yahoo Finance + ArgentinaDatos). Tanto `simulator.tsx` como `investment-alternatives.tsx` sobrescriben sus tasas de fallback con estos datos reales cuando están disponibles.
- **Escenarios/proyecciones**: `simulator.tsx` calcula interés compuesto (`compound()`) a distintos plazos (3M/6M/1 año/2 años) y compara contra la inflación; `investment-alternatives.tsx` usa `investmentReadinessContext.ts` para armar un escenario de qué alternativas son apropiadas (y cuáles se descartan y por qué) según el perfil del usuario, sin inventar rendimientos no presentes en `market_rates`.

`investment-alternatives.tsx` (717 líneas): pantalla que presenta las alternativas seleccionadas/descartadas con su justificación, con un chat embebido que llama a la edge function `investment-advisor` en modo `explain` (no consume el límite mensual) o `chat` (sí lo consume). La conversación persiste vía `chat_threads`/`chat_history`, con un `context_fingerprint` que determina si hace falta regenerar la explicación (si el contexto financiero cambió desde la última vez).

---

## 8. IA / Asistente financiero

Arquitectura general: **DATOS → MOTOR → CONTEXTO → IA → RESPUESTA**. El LLM (Groq) nunca calcula cifras financieras — todos los números que aparecen en las respuestas se computan antes, en TypeScript, y se le pasan ya resueltos en el contexto.

### `investment-advisor` (alcanzable, activo)
- **DATOS**: `financial_profiles`, `risk_profiles`, `savings`/`investments`/`savings_goals`, `market_rates`.
- **MOTOR**: `investmentReadinessContext.ts` (calcula el puntaje de "listo para invertir"), `investmentCategories.ts` (categorías conceptuales aplicables), `savingsDestinationContext.ts`/`savingsDestination.ts` (destinos de ahorro sugeridos).
- **CONTEXTO**: `investmentAdvisorContext.ts` arma el objeto final que viaja a la edge function — incluye riesgo, horizonte, alternativas seleccionadas/descartadas, escenario y nivel de confianza, todo ya calculado.
- **IA**: edge function `investment-advisor`, Groq `llama-3.3-70b-versatile`, reglas estrictas para no inventar números fuera del contexto recibido.
- **RESPUESTA**: explicación en lenguaje natural (`explain`) o conversación libre acotada al contexto (`chat`). Persistida en `chat_threads`/`chat_history` con `context_fingerprint`.
- Documentado explícitamente (fuera de este relevamiento, como limitación ya aceptada por el equipo): el chat habla principalmente desde el contexto de inversión/readiness y no inventa destinos de ahorro que no estén presentes en ese contexto.

### `ai-advisor` vía `advisor.tsx` (chat genérico, **inalcanzable** mientras `ADVISOR_ENABLED = false`)
- **Bots activos declarados**: únicamente `general`, `ahorro`, `gastos` — **3 bots, no 4**. El código de `loadBotSummaries` inicializa también una clave `inversiones`, pero esa clave nunca se itera (`BOT_IDS` no la incluye) y nunca se renderiza un bot de "Inversiones" en esta pantalla — es código residual/muerto, distinto del chat de inversión embebido en `investment-alternatives.tsx`.
- **DATOS/MOTOR/CONTEXTO**: `buildClientContext()` arma un `ClientContext` (`month_total`, `income`, `income_pct`, `month_status`, `necessary`, `disposable`, `disposable_pct`, `investable`, `recoverable`) desde `expensesStore`, más un resumen de ahorro/metas/inversiones desde `savingsStore`/`goalsStore`.
- **IA**: edge function `ai-advisor`, mismo modelo Groq. Soporta `generate_welcome` (mensaje de apertura automático, no cuenta contra el límite) y entrada de voz (transcripción vía edge function `transcribe`).
- **RESPUESTA**: persistida en `chat_threads`/`chat_history`, con validación de límite freemium antes y después de llamar al backend (maneja el 429 con Alert de paywall).

### Clasificación por IA (no conversacional)
- `gmail-poll` y `mp-poll`: clasifican cada transacción detectada (`necessary|disposable|investable` + categoría) con Groq antes de insertarla en `pending_transactions`.
- `process-screenshot`: OCR en dos etapas (visión → texto estructurado) con Groq, devuelve el JSON al cliente sin persistir nada server-side.
- `transcribe`: voz a texto con Groq Whisper, usado por la entrada de voz del chat.

---

## 9. Motores y lógica financiera

| Motor | Archivo | Qué calcula |
|---|---|---|
| Ritmo de gasto | `src/lib/budgetPlan.ts` | `paceRatio` (gasto real vs. esperado según el día del mes), `AlertLevel` de 4 niveles (`oportunidad` &lt;0.7, `normal` 0.7–1.15, `atencion` 1.15–1.6, `alerta` &gt;1.6), proyección a fin de mes, `potentialSavings` agregado |
| Narrativa por categoría | `src/lib/budgetInsights.ts` | `buildCategoryInsight` (texto humano por categoría según su `AlertLevel`), `selectRelevantInsights` (prioriza `alerta` &gt; `atencion` &gt; `oportunidad`, máximo 3, filtra `normal`) |
| Gastos recurrentes | `src/lib/recurringExpenses.ts` | Detecta patrones recurrentes: exige presencia en al menos 3 meses (no necesariamente consecutivos), tolerancia de monto del 25%, normalización simple de texto (no fuzzy matching — orden de palabras invertido no se agrupa, confirmado por test) |
| Ajuste de recurrentes | `src/lib/recurringAdjustment.ts` | Ajuste del cálculo de presupuesto en función de gastos recurrentes detectados |
| Destinos de ahorro | `src/lib/savingsDestination.ts` | `determineSavingsDestinations` — prioriza deuda &gt; fondo de emergencia &gt; objetivo activo &gt; inversión &gt; liquidez; fondo de emergencia e inversión son mutuamente excluyentes por diseño; "zona gris" de 3–6 meses de colchón (limitación aceptada, no resuelta) |
| Contexto de ahorro | `src/lib/savingsDestinationContext.ts` | Arma el contexto financiero consumido por `investment-advisor` |
| Categorías de inversión | `src/lib/investmentCategories.ts` | Categorías conceptuales por perfil de riesgo |
| Preparación para invertir | `src/lib/investmentReadinessContext.ts` | Puntaje de "listo para invertir" |
| Continuidad de chat | `src/lib/investmentChatContinuity.ts`, `src/lib/investmentChatPersistence.ts` | Fingerprint de contexto para decidir si regenerar la explicación; persistencia de hilos/mensajes |
| Widgets inteligentes | `src/lib/widgetEngine.ts` | `computeAllWidgets` — **calculado en `home.tsx` pero nunca renderizado** (ver sección 17) |
| Salud financiera | función `computeHealthScore` (dentro de `home.tsx` o lib asociada) | Sí se usa activamente en el anillo de Home; distinta del componente visual `HealthScoreCard`, que no se usa |
| Insights clave | `buildKeyInsights` | Motor de 15 reglas de insight — calculado pero nunca renderizado (`DatosClaveCard`) |
| Matching de deudas | `src/lib/debtMatcher.ts` | Determinístico (no IA), usado en `group-detail.tsx` para emparejar transferencias entrantes detectadas por Gmail con deudas pendientes de gastos grupales |

---

## 10. Datos y base de datos

**Nota metodológica**: `mobile/src/types/database.ts` (tipos TypeScript, 39 tablas declaradas) y las 43 migraciones en `mobile/supabase/migrations/*.sql` **no están sincronizados** entre sí. El esquema base (tablas core: `profiles`, `expenses`, `expense_categories`, `financial_profiles`, `risk_profiles`, `user_interests`, `ai_usage`) no tiene migración de creación rastreada en el repo.

### Tablas confirmadas por uso real en el código, agrupadas por área

**Usuario y perfil**: `profiles` (plan, trial, onboarding, push token), `financial_profiles` (cuestionario de onboarding), `risk_profiles` (perfil de riesgo inversor — posible desalineación de nombre de columna: el código de `ai-advisor` lee `risk_level`, el tipo TS declara `profile` — **NO CONFIRMADO** cuál es el nombre real en la base), `user_interests`.

**Gastos**: `expense_categories` (catálogo; una migración eliminó `sports`/`transport`/`technology`/`kids`/`pets`, pero el clasificador IA de `gmail-poll`/`mp-poll` sigue mapeando la categoría "deporte" → `sports` — posible categoría huérfana, **NO CONFIRMADO** si fue recreada), `expenses` (soft delete vía `deleted_at`; en modo familia/pareja, políticas RLS adicionales permiten que un `SELECT` devuelva gastos de otros usuarios legítimamente), `expense_receipts` (sin ningún consumidor `.from()` encontrado — tabla sin uso activo), `category_budgets` (presupuesto por categoría, no está en `database.ts`), `pending_transactions` (poblada por `gmail-poll`/`mp-poll`, limpieza automática por cron a los 30 días), `debt_match_suggestions` (no está en `database.ts`), `expense_edit_requests` (RPC `approve_expense_edit_request` existe pero no se encontró ningún caller desde el cliente).

**Ahorro/inversión**: `savings_goals` (nota: el RPC `delete_user_account` borra de una tabla llamada `goals`, no `savings_goals` — inconsistencia de nombre entre migraciones; **NO CONFIRMADO** si esto hace que el borrado de cuenta no elimine realmente las metas), `savings` e `investments` (usadas activamente por `savingsStore` pero **sin ningún `CREATE TABLE` rastreado** en migraciones ni declaradas en `database.ts` — **NO CONFIRMADO** si existen en la base real tal como el código las consume), `market_rates` (única tabla escribible solo por `service_role`, lectura abierta a cualquier autenticado), `mp_connections`, `mp_oauth_states`, `payment_logs` (ninguno de estos tres está en `database.ts`).

**Tablas declaradas en `database.ts` sin ningún consumidor encontrado** (schema aparentemente no usado): `monthly_reports`, `market_instruments`, `instrument_price_history`, `investment_simulations`, `ai_chat_threads`, `ai_chat_messages`, `subscriptions`, `feature_usage_logs`, `user_alerts`.

**Chat/IA**: `chat_threads`, `chat_history` (ninguna en `database.ts`; los tipos `AIChatThread`/`AIChatMessage` con tablas `ai_chat_threads`/`ai_chat_messages` parecen ser un diseño anterior no usado en la práctica), `ai_usage` (contador freemium, incrementado vía RPC `increment_ai_usage`, `SECURITY DEFINER`).

**Gmail**: `gmail_connections` (el tipo TS declara `last_synced_at`, la migración real usa `last_checked_at` — desfase tipo/esquema), `gmail_oauth_states` (solo accesible por `service_role`).

**Grupos**: `family_groups` y `family_members` están **declaradas dos veces** en `database.ts` con formas inconsistentes entre sí; la RLS de ambas fue reescrita varias veces (`fix_family_policies_v2.sql`, `fix_group_create_policies.sql`, `fix_groups_rls.sql`, `fix_groups_rls_v2.sql`) por bugs de recursión infinita, resuelto finalmente con la función `get_my_group_ids()`. `group_transfers`, `group_expenses`, `group_expense_splits` — ninguna está en `database.ts`.

---

## 11. Fuentes externas

| Servicio | Qué provee | Dónde se usa | Manejo de error |
|---|---|---|---|
| **Groq API** | LLM (chat, clasificación, OCR) y Whisper (voz) | `ai-advisor`, `investment-advisor`, `gmail-poll`, `mp-poll`, `process-screenshot`, `transcribe` | Variable según función: en los chats/OCR/voz, un fallo se relanza como error 500; en `gmail-poll`/`mp-poll` hay fallback (reintento en el próximo poll o clasificación por defecto `disposable`/`otros`) |
| **BCRA API v4.0** | Inflación (IPC) y tasa Badlar | `fetch-market-rates` | Try/catch por variable, `null` si falla, no bloquea el resto |
| **datos.gob.ar** | Series de tiempo IPC/tipo de cambio oficial | `indec-sync`, `ai-advisor` | Try/catch por serie; en `ai-advisor` usa `Promise.allSettled` con timeout 4s, indica "dato no disponible" en el prompt si falla |
| **Bluelytics** | Cotizaciones dólar oficial/blue/MEP | `fetch-market-rates`, `ai-advisor`, `useDolarRates.ts` (conversión de gastos en USD) | Try/catch con fallback a `null`; en el cliente (`useDolarRates.ts`), sin cache de respaldo — fetch siempre fresco |
| **Yahoo Finance** (no oficial) | Precios históricos de 16 tickers | `cedear-sync` | Try/catch por ticker, continúa aunque alguno falle |
| **ArgentinaDatos API** | Cotización histórica dólar MEP | `cedear-sync` | Reintenta retrocediendo hasta 6 días si el mercado estuvo cerrado |
| **Google OAuth / Gmail API** | Auth + lectura de emails (`gmail.readonly`) | `gmail-auth`, `gmail-poll` | Refresh automático de token; si falla, marca `token_expired=true` y responde 200 con código específico para pedir reconexión |
| **Mercado Pago API** | OAuth + pagos + suscripciones | `mp-auth`, `mp-poll`, `mp-webhook`, `create-payment` | Refresh automático de token; verificación de firma HMAC en el webhook |
| **Expo Push API** | Notificaciones push | `send-push` | Sin token guardado → 200 `{ok:false}` (no error); fallo de Expo → 500 |

---

## 12. Notificaciones

- **Push**: la utilidad `send-push` (edge function) envía notificaciones vía Expo Push API, invocada internamente por `gmail-poll`, `mp-poll`, `mp-webhook` y `advisor-sunday`. **No valida JWT de usuario** (asume invocación server-to-server).
- **`advisor-sunday`**: cron semanal (comentario en el código indica domingo 10:00 ART) que recorre perfiles con `push_token`, calcula gasto semanal comparado con la semana anterior y arma un mensaje personalizado, disparado vía `send-push`. **NO CONFIRMADO EN EL CÓDIGO** que exista un `cron.schedule` real para esta función en las migraciones (el propio comentario del archivo indica que debe configurarse manualmente en el dashboard de Supabase).
- **Verificación de despliegue**: al consultar `supabase functions list` en este relevamiento, **ni `send-push` ni `advisor-sunday` aparecen entre las funciones activas desplegadas** — solo aparecen `process-screenshot`, `ai-advisor`, `parse-transactions`, `gmail-auth`, `gmail-poll`, `create-payment`, `mp-webhook`, `fetch-market-rates`, `transcribe`, `mp-auth`, `mp-poll`, `indec-sync`, `cedear-sync`, `investment-advisor`. Esto es un hecho verificado directamente contra el proyecto Supabase enlazado en el momento de este relevamiento (no una inferencia del código fuente).
- **Notificaciones locales de presupuesto** (`src/lib/budgetNotifications.ts`): motor de notificaciones ligado al plan de presupuesto; según hallazgos de un agente de investigación sobre el sistema de Gastos, las notificaciones de inactividad/entrega no parecen estar cableadas desde la pantalla de Gastos — **NO CONFIRMADO EN EL CÓDIGO** el detalle exacto de qué dispara o no dispara cada notificación local más allá de lo ya documentado en la sección 9 (umbral de alerta).
- `advisor.tsx` incluye una notificación push que apunta a `/(app)/simulator` (confirmada en `src/lib/notifications.ts`).

---

## 13. Onboarding y perfil

**Orden confirmado del onboarding**: `welcome` → `financial-profile` (4 sub-pasos: ingreso, tipo de trabajo, situación familiar, ahorro) → `interests` → `risk-profile` → `gmail-connect` → `(app)/home`.

- `financial-profile.tsx` solo recolecta: `income_range`, `work_type`, `family_status`, `has_savings`/`savings_amount`, `has_debt`/`debt_amount`. Los campos `fixed_expenses_estimated`, `dependents_count`, `financial_goal`, `investable_amount_estimated` quedan en sus valores por defecto — no se encontró ninguna otra UI (en onboarding ni en perfil) que los complete.
- `profile.tsx`: **no existe ninguna forma funcional de editar `financial_profiles` (ingreso/ahorro/deuda) después del onboarding**. Existe una función `handleReOnboarding()` en el código, pero no está conectada a ningún botón o ítem de menú (código muerto, confirmado por grep).
- El plan freemium se resuelve con `resolveEffectivePlan()` (`src/lib/plans.ts`), consultado desde `profile.tsx` y `plans.tsx`.
- `help.tsx` (Centro de ayuda, accesible desde Perfil): lista estática de 7 guías que reabren el `FirstVisitSheet` de cada pantalla (Home, Gastos, Reportes, Ahorros, Simulador, "Familia" → apunta a `grupo-familia.tsx`, no a `family.tsx`, Tu plan).
- `gmail-connect.tsx` dentro de `(app)/`: pantalla separada de la versión de onboarding, para (re)conectar Gmail post-onboarding desde Perfil. Usa el mismo flujo OAuth (`gmail-auth`) con deep link `pesossmart://gmail-connected`.

---

## 14. Seguridad y límites

- **RPC `delete_user_account(p_user_id UUID)`**: `SECURITY DEFINER`, borra en cascada manual datos dependientes. **No contiene ningún chequeo interno de que `p_user_id = auth.uid()`** — la única protección es una política RLS de `DELETE` sobre `profiles`, que no se aplica dentro del cuerpo de una función `SECURITY DEFINER`. No se encontró ningún chequeo de cross-check a nivel de código.
- **`send-push` y `advisor-sunday`**: cero chequeos de autenticación/autorización de cualquier tipo (server-to-server, asumen invocación confiable).
- **`ai-advisor` e `investment-advisor`**: solo verifican que el header `Authorization` esté **presente**, no que sea válido; el `user_id` usado para el conteo de uso freemium viene del **cuerpo de la request**, no derivado del JWT — no se confirmó ningún chequeo explícito `user_id === auth.uid()`.
- **Funciones protegidas por secret de cron** (`fetch-market-rates`, `cedear-sync`, `indec-sync`): comparación con `.includes()` (no timing-safe), y **si el secret correspondiente no está configurado, la validación se salta silenciosamente**.
- **Patrón RLS general**: `auth.uid() = user_id` para tablas de datos personales; tablas de grupo usan la función `get_my_group_ids()`. Múltiples migraciones `fix_*` indican corrección iterativa de bugs sobre este modelo (recursión infinita en RLS de grupos).
- **Freemium**: `free` 15 msg/mes, `pro` 100 msg/mes, `premium` ilimitado; trial de 30 días premium automático por trigger DB (`trigger_trial_on_signup`). Límite validado server-side en `ai-advisor`/`investment-advisor` (HTTP 429 `limit_reached`), reforzado también client-side antes de enviar (`planStore.canSendMessage()`).
- **`mp-webhook`**: verifica firma HMAC-SHA256 si `MP_WEBHOOK_SECRET` está configurado; aplica un "grace period" de 3 días si un pago recurrente falla antes de degradar el plan.
- Todas las edge functions hacen su propia validación de JWT vía `GET /auth/v1/user`; "Verify JWT with legacy secret" debe estar apagado en el dashboard de Supabase (documentado en `CLAUDE.md`).

---

## 15. Tests y estado técnico

### FUNCIONANDO
- Suite de tests: **134/134 pasando** (`npm test`), cubre `recurringExpenses.ts`, `savingsDestination.ts`, `investmentCategories.ts` y sus respectivas lógicas de borde (zona gris de fondo de emergencia, metas cumplidas, prioridad de destinos, etc.).
- Todas las edge functions consultadas están `ACTIVE` en el proyecto Supabase enlazado, incluyendo `investment-advisor` (versión 1, recién desplegada) y `fetch-market-rates` (versión 14, con el fix de API v4.0 del BCRA ya en producción).

### LIMITACIONES CONOCIDAS
- `npx tsc --noEmit` reporta **17 errores preexistentes**, ninguno introducido en este relevamiento (es de solo lectura):
  - `src/store/familyGroupStore.ts` (11 errores): tipos `never` en casi todas las queries — indica que las tablas `family_groups`/`family_members`/`group_transfers` no están correctamente tipadas para el sistema paralelo `grupo-familia.tsx`.
  - `src/components/DecisionHistory.tsx` (4 errores): propiedades de estilo (`compareIcon`, `bestRow`, `bestBadge`, `bestText`, `compareGain`) referenciadas mediante un objeto de estilos incompleto.
  - `src/lib/budgetNotifications.ts` (1 error): el objeto de comportamiento de notificaciones no cumple con el tipo `NotificationBehavior` actual de `expo-notifications` (faltan `shouldShowBanner`/`shouldShowList`).
  - `src/types/database.ts` (1 error): declaración duplicada de `family_groups`/`family_members` con tipos de `role` incompatibles entre sí (`MemberRole` vs `FamilyRole`).
- No hay scripts de lint ni de build configurados (confirmado en `CLAUDE.md` — Expo maneja el bundling).
- `parse-transactions`: carpeta de edge function existe y aparece `ACTIVE` en el listado de Supabase, pero el directorio local **no contiene ningún `index.ts`** — **NO CONFIRMADO** qué código corre efectivamente en el despliegue activo versus el estado del repo.

### PENDIENTES / NO CONFIRMADO
- No hay evidencia de CI configurado en el repo explorado.
- `send-push` y `advisor-sunday` tienen código pero no aparecen desplegadas como funciones activas (ver sección 12).
- La función `purge_old_chat_history()` existe en migraciones pero no se confirmó que esté agendada por ningún cron.

---

## 16. Funcionalidades actuales

- **Gastos**: carga manual, importación automática por Gmail y por Mercado Pago (con clasificación IA), importación por captura de pantalla (OCR en dos etapas), edición/borrado con soft delete, presupuesto por categoría, reportes mensuales con narrativa generada por IA, gasto compartido en grupos con reparto y matching automático de deudas.
- **Ahorro**: bolsillos de efectivo, metas de ahorro con progreso y fecha límite, "Plan Inteligente" con ritmo de gasto ajustado por día del mes, alertas de 4 niveles con mensajes específicos por categoría, oportunidades de ahorro.
- **Inversión**: alternativas sugeridas según perfil de riesgo y preparación financiera, simulador de 5 instrumentos con proyección de interés compuesto vs. inflación, datos de mercado actualizados automáticamente por 3 cron jobs.
- **IA**: asesor de inversión con explicación y chat conversacional acotado a un contexto verificable (activo); clasificación automática de transacciones detectadas por Gmail/Mercado Pago; generación de reportes narrativos; transcripción de voz a texto.
- **Grupos**: creación/unión por código, gasto compartido con reparto, transferencias internas (solo en el sistema paralelo `grupo-familia.tsx`), roles y permisos granulares, matching automático de deudas contra transferencias detectadas por Gmail.
- **Perfil/cuenta**: gestión de suscripción (Mercado Pago), trial de 30 días, conexión/desconexión de Gmail, borrado de cuenta.
- **Notificaciones**: push por gasto detectado (Gmail/MP), notificaciones locales de presupuesto.

---

## 17. Funcionalidades incompletas o limitadas

- **`advisor.tsx`** (chat IA genérico): completamente inalcanzable desde la navegación real mientras `ADVISOR_ENABLED = false`; todas las entradas del código están condicionadas por el flag.
- **`smart-alerts.tsx`**: sin ningún punto de entrada de navegación en toda la app.
- **`insight.tsx`**: su único disparador previsto (`SmartWidget.onPress` en Home) está importado pero nunca renderizado.
- **`grupo-familia.tsx`**: sistema paralelo de grupos familiares, no integrado con el tab real "Grupos" (`family.tsx`/`group-detail.tsx`); solo alcanzable desde el Centro de ayuda; opera sobre las mismas tablas que el sistema activo pero con RPCs/lógica de creación distintas.
- **`landing.tsx`**: pantalla demo construida sin ningún punto de entrada.
- **~20 componentes/motores de Home** construidos pero no renderizados (ver sección 4), incluyendo un motor de 15 reglas de insight (`buildKeyInsights`) y un ticker de mercado en vivo (`MarketTicker`).
- **`GoalsSection`**: importada en Home, nunca instanciada.
- **`DineroRecuperableCard`/`buildAhorroSugerencias`**: nunca se muestra como tarjeta visible fuera de "Plan Inteligente"; en el resto de la app solo se usan sus números agregados.
- **Inversiones manuales** (tabla `investments`, CRUD completo en `savingsStore`): sin ninguna pantalla que las muestre o gestione.
- **`expense_receipts`**: tabla sin ningún consumidor; `process-screenshot` no persiste en ella.
- **Schema aparentemente muerto**: `market_instruments`, `instrument_price_history`, `investment_simulations`, `monthly_reports`, `ai_chat_threads`, `ai_chat_messages`, `subscriptions`, `feature_usage_logs`, `user_alerts` — sin consumidores encontrados.
- **`savings` e `investments`**: usadas activamente por el código pero sin migración de creación rastreada — no confirmado si existen en la base real con esa forma exacta.
- **Posibles desalineaciones de nombre** (no confirmadas contra la base real, solo contra el código): `goals` vs. `savings_goals` (RPC `delete_user_account` vs. resto del código), `risk_level` vs. `profile` (columna de `risk_profiles`), `last_synced_at` vs. `last_checked_at` (`gmail_connections`).
- **`expense_edit_requests`**: RPC de aprobación existe, sin caller encontrado desde el cliente.
- **QR de invitación a grupo** (`group-code.tsx`): explícitamente decorativo en el código (comentario propio: "QR placeholder"), no es un código escaneable real.
- **Inconsistencia de clasificación IA**: captura de pantalla descarta la clasificación sugerida al guardar; Gmail la conserva.
- **Zona gris del fondo de emergencia** (3–6 meses de colchón): limitación de diseño ya aceptada, no resuelta.
- **Alcance del chat de inversión**: habla principalmente desde el contexto de inversión/readiness, no propone destinos de ahorro fuera de ese contexto — comportamiento documentado, no un bug.
- **Seguridad**: `delete_user_account` sin chequeo interno de titularidad; `send-push`/`advisor-sunday` sin autenticación; `user_id` de conteo freemium tomado del cuerpo de la request, no derivado del JWT (ver sección 14 para el detalle completo).
- **`send-push` y `advisor-sunday`**: código presente pero no aparecen entre las funciones activas desplegadas al momento de este relevamiento.
- **17 errores de TypeScript preexistentes**, concentrados en el sistema paralelo `grupo-familia`/`familyGroupStore` y en componentes/tipos puntuales (ver sección 15).
- **`parse-transactions`**: función desplegada como `ACTIVE` pero la carpeta local no contiene `index.ts` — estado real del código desplegado no confirmado.

---

## 18. Resumen final

| Área | Funcionalidades | Estado | Dependencias | Limitaciones |
|---|---|---|---|---|
| **Home** | Resumen del mes, donut de categorías, salud financiera, inflación personal vs. oficial, actividad reciente, tarjeta de oportunidad | Parcial — la pantalla real funciona, pero ~20 componentes/motores construidos (incluyendo un motor de 15 reglas de insight y un ticker de mercado) nunca se renderizan | `expensesStore`, `computeHealthScore`, `indecData.ts` (estático) | Barra de "oportunidad" con ancho hardcodeado; saludo no varía según hora; `GoalsSection` y `SmartWidget` importados pero no montados |
| **Gastos** | Carga manual/Gmail/MP/OCR, edición, presupuesto por categoría, reportes con narrativa IA, gasto grupal con matching de deudas | Funcionando | `gmail-poll`, `mp-poll`, `process-screenshot`, `ai-advisor`, `budgetPlan` | OCR descarta clasificación IA al guardar (Gmail no); "asistente inteligente" de categorización es heurística local, no IA; campos de explicación/confianza de clasificación nunca escritos |
| **Ahorro** | Bolsillos, metas, Plan Inteligente (ritmo ajustado, 4 niveles de alerta, insights priorizados), oportunidades de ahorro | Funcionando (Plan Inteligente con 134/134 tests) | `budgetPlan.ts`, `budgetInsights.ts`, `recurringExpenses.ts`, `savingsDestination.ts` | Inversiones manuales (CRUD completo en el store) sin ninguna pantalla que las muestre; "dinero recuperable" nunca visible como tarjeta fuera de Plan Inteligente; zona gris del fondo de emergencia (3–6 meses) |
| **Inversiones** | Alternativas según perfil, simulador de 5 instrumentos, datos de mercado automatizados (3 crons) | Funcionando | `market_rates`, `investmentReadinessContext`, `investmentCategories`, `investment-advisor` | Simulador usa instrumentos hardcodeados con fallback (no un catálogo dinámico); tablas `market_instruments`/`instrument_price_history`/`investment_simulations` declaradas sin uso |
| **IA / Asistente** | Chat de inversión (explicación + conversación), clasificación automática de transacciones, reportes narrativos, voz a texto | Parcial — asesor de inversión activo; chat genérico multi-bot inalcanzable por feature flag | Groq, `ai-advisor`, `investment-advisor`, `transcribe` | `ADVISOR_ENABLED=false` oculta todo el chat genérico; solo 3 bots reales (clave `inversiones` es código muerto); `user_id` de límites freemium no derivado del JWT |
| **Grupos** | Creación/unión por código, gasto compartido con reparto, matching automático de deudas, roles/permisos | Funcionando (sistema activo `family.tsx`/`group-detail.tsx`) | RLS vía `get_my_group_ids()`, `debtMatcher` | Sistema paralelo `grupo-familia.tsx` no integrado, solo alcanzable desde ayuda; QR de invitación decorativo, no escaneable; 11 errores TS en `familyGroupStore.ts` |
| **Perfil** | Plan/suscripción, trial, conexión Gmail, borrado de cuenta | Funcionando, con brechas de seguridad | Mercado Pago, `gmail-auth`, RPC `delete_user_account` | Sin forma de editar el perfil financiero post-onboarding (`handleReOnboarding` es código muerto); `delete_user_account` sin chequeo interno de titularidad |
| **Notificaciones** | Push por gasto detectado, notificaciones locales de presupuesto | Parcial | `send-push`, `gmail-poll`/`mp-poll` | `send-push` y `advisor-sunday` no aparecen desplegadas activamente; cron de `advisor-sunday` no confirmado en el dashboard; `send-push`/`advisor-sunday` sin autenticación |
