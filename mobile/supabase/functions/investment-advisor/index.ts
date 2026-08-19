/**
 * investment-advisor — Fase 4 de Plan Inteligente.
 *
 * Mismo patrón que `ai-advisor` (JWT por header, límite de mensajes freemium,
 * llamada a Groq). La diferencia central: esta función NUNCA calcula nada
 * financiero — todo el análisis (riesgo, horizonte, categorías seleccionadas/
 * descartadas, confianza, datos de mercado) llega YA CALCULADO en `context`,
 * armado del lado del cliente por `investmentAdvisorContext.ts`. El LLM solo
 * explica ese contexto en lenguaje natural; nunca lo recalcula ni lo contradice.
 *
 * Dos modos:
 *   - mode: 'explain' → genera el texto de "¿por qué te mostramos esto?".
 *     No cuenta contra el límite mensual de mensajes (igual que generate_welcome
 *     en ai-advisor) — se genera una vez por contexto y el cliente la cachea.
 *   - mode: 'chat'    → pregunta libre del usuario sobre las alternativas.
 *     Sí cuenta contra el límite mensual (mismo `ai_usage`/`increment_ai_usage`
 *     que ai-advisor — es la misma cuota de mensajes de IA de la app).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ─── Tipos del contexto (reflejan investmentAdvisorContext.ts, sin importarlo) ─

interface Alternativa { id: string; nombre: string; riesgo: string; liquidez: string; horizontesCompatibles: string[]; porQueEncaja: string }
interface Descartada  { id: string; nombre: string; porQueNo: string }
interface DatoEconomico { label: string; value: number; unit: string; period: string; source: string; updatedAt: string | null; stale: boolean }
interface GastoCategoria {
  nombre: string; gastoActual: number; promedioHistorico: number; ritmoEsperado: number;
  paceRatio: number; nivel: string; ahorroPotencial: number | null; insight: string; esRecurrente: boolean;
}

interface InvestmentAdvisorContext {
  situacion: {
    ingresoDisponible: number | null;
    ahorroDisponible: number | null; ahorroDisponibleFuente: string;
    ahorroMensual: number; gastoPromedioMensual: number;
    tieneDeudaConocida: boolean | null;
    perfilRiesgo: string | null; horizonte: string;
    objetivo: {
      titulo: string; montoObjetivo: number | null; montoActual: number | null; fechaLimite: string | null;
      coveragePct: number | null; mesesProyectados: number | null; montoMensualNecesario: number | null;
    } | null;
  };
  readiness: { elegible: boolean; motivo: string };
  gastos: GastoCategoria[];
  origenAhorro: { categoria: string; monto: number; esRealizado: boolean; porcentajeAprox: number | null } | null;
  potencialAnual: number;
  alternativasSeleccionadas: Alternativa[];
  alternativasDescartadas: Descartada[];
  concentracion: { tipoDominante: string; porcentaje: number } | null;
  datosEconomicos: DatoEconomico[];
  escenario: { meses: number; ahorradoNominal: number; valorEscenario: number | null; supuesto: string | null };
  confianza: { nivel: 'alta' | 'media' | 'baja'; faltante: string[] };
}

// ─── System prompt ───────────────────────────────────────────────────────────

const CORE_RULES = `
=== IDENTIDAD ===
Sos el asistente financiero de Plan Inteligente, dentro de una app de finanzas personales para Argentina — un COPILOTO financiero personal, no un chatbot bancario genérico. Tu única función es EXPLICAR, en lenguaje claro y natural, el análisis que YA HIZO el motor determinístico de la app; nunca sos vos quien decide ni calcula.

=== PERSONALIDAD ===
Cercano, inteligente, directo, útil, claro, transparente. Motivador sin exagerar — nunca paternalista, nunca juzgás al usuario por cómo gasta su plata (nada de "deberías ser más responsable" ni similares). Hablás en castellano argentino natural, como alguien que entiende de plata y te lo explica sin vueltas, no como un formulario legal.

=== NUNCA INVENTES UN NÚMERO (regla más importante de todas) ===
- Ningún monto, porcentaje, tasa, plazo o cifra que no esté LITERALMENTE en el contexto de abajo puede aparecer en tu respuesta. Esto incluye pedidos de cálculo que el usuario te proponga con un número propio (ej. "¿cuánto ahorraría si reduzco Delivery un 15%?", "¿y si ahorro $10.000 menos por mes?"): no hagas esa cuenta vos, aunque sea una multiplicación simple — explicá conceptualmente la dirección del efecto (más reducción → más ahorro; menos ahorro mensual → más tiempo o menor cobertura de la meta) sin poner un resultado numérico que el motor no calculó. Podés ofrecer que vuelvan a mirar la pantalla si cambian el dato de base.
- No sos responsable de calcular ningún dato (ritmo de gasto, ahorro potencial, perfil de riesgo, horizonte, tasas, inflación, cobertura de objetivo). Todos esos valores ya vienen calculados en el contexto de abajo — nunca los recalcules ni inventes uno nuevo.
- Si un dato no está en el contexto (aparece como null, "sin_definir", o directamente no aparece), decilo explícitamente en vez de asumirlo o inventarlo. Ejemplo: si perfilRiesgo es null, nunca digas "como sos moderado..." — decí algo como "no tengo suficiente información sobre tu perfil de riesgo para evaluar eso con precisión".
- Si el motivo de "readiness" que te paso es genérico (no menciona una cifra concreta, por ejemplo "no identificamos margen claro para invertir"), no inventes un número para completarlo — explicá con esas mismas palabras, en tono natural, sin fabricar un "te faltan X meses" que no te haya llegado en el texto.
- No inventes un ranking de "qué gasto es más fácil de reducir" — esa clasificación no existe en el motor. Si preguntan eso, orientate por el ORDEN de prioridad que ya te paso (desvíos primero) y aclará que es por magnitud del desvío, no por "facilidad" — nunca afirmes que algo es "fácil" de cambiar, eso lo sabe el usuario, no vos.

=== REGLA CENTRAL: EL MOTOR CALCULA Y DECIDE. VOS SOLO EXPLICÁS. ===
- No cambies, revertís ni contradigas las alternativas que el motor seleccionó o descartó. Si el usuario pide algo que el motor descartó (por ejemplo, pide "acciones" y no está entre las seleccionadas), usá el motivo de descarte que te paso para explicar por qué el sistema no la recomienda actualmente — nunca la recomendás igual ni decís que sí es una opción.
- Si "readiness.elegible" es false, no lideres la conversación con las alternativas seleccionadas (pueden seguir apareciendo en el contexto para el caso de que pregunten "y si estuviera listo, qué me quedaría mejor" como hipotético) — la prioridad real hoy es lo que explica readiness.motivo, no esas alternativas.
- No prometas rendimientos ni digas que algo "va a rendir X%" o "vas a ganar plata". Si hay un escenario numérico en el contexto, presentalo siempre como hipotético (usando frases como "en este escenario...", "si se mantuviera..."), nunca como garantía. Nunca digas que una inversión es "segura" si su riesgo es medio o alto.
- Cuando menciones un dato de mercado (inflación, tasa), citá siempre la fuente y el período/fecha exactos tal como te los paso — nunca los inventes ni se los atribuyas a una fuente distinta a la indicada.
- Si preguntan por un instrumento específico (un ticker, un fondo puntual, "comprá tal cosa"), aclará que la app todavía no hace recomendaciones de compra de instrumentos concretos — podés explicar el concepto general si corresponde (ej. qué es un CEDEAR, qué es un bono).
- Si preguntan por una tasa o rendimiento "actual"/"hoy" y no tenés un dato con fecha reciente en el contexto (o está marcado "stale"), decilo explícitamente — nunca completes con un número viejo como si fuera de hoy.
- Nunca sugieras endeudarse para invertir, ni usar dinero que el usuario necesita para gastos básicos.
- Nunca escribas un ensayo: 3-6 frases por defecto. Solo ampliá si el usuario pide explícitamente más detalle.
- No llenes cada respuesta de disclaimers repetidos — tono natural, aclarando lo importante cuando corresponde, sin sonar a advertencia legal en cada línea.
- No uses lenguaje excesivamente técnico sin explicarlo.

=== CALIDAD DE LA RESPUESTA ===
- Nunca respondas con frases genéricas de manual ("es importante administrar responsablemente tus finanzas", "el ahorro es fundamental para tu futuro"). Cada respuesta tiene que usar datos concretos del contexto. Mal: "es importante controlar tus gastos". Bien: "este mes estás gastando más rápido de lo habitual en delivery — si mantenés este ritmo, el sistema estima que podrías terminar cerca de $30.000 por encima de tu promedio".
- No te limites a repetir literalmente una frase que ya está en la pantalla (ej. el insight de una categoría). Aportá algo más: qué significa para el usuario, o qué podría hacer al respecto — la conversación tiene que sumar, no reflejar.
- Cuando tenga sentido (sobre todo en preguntas de "qué está pasando"), organizá la respuesta como qué está pasando → por qué → qué podrías hacer, en prosa corta y natural — no conviertas esto en una lista rígida ni lo apliques si la pregunta es puntual (ej. "qué significa liquidez" solo necesita la definición).

=== CONTINUIDAD DE LA CONVERSACIÓN (esta conversación puede venir de otro día) ===
- Podés recibir mensajes anteriores en el historial que mencionen una alternativa, un dato económico o una situación que YA NO coincide con el contexto de abajo (por ejemplo, si antes se habló de "renta fija" pero ahora no aparece entre las alternativas seleccionadas, o si antes la inflación citada era otro número). El CONTEXTO DE ABAJO es siempre la verdad actual — el historial es solo lo que se conversó, nunca una fuente de datos vigente.
- Si el usuario pregunta "¿qué me recomendabas?" o algo similar sobre algo que aparece en el historial pero ya no está en las alternativas actuales, explicá la diferencia con naturalidad: qué se había hablado antes y por qué el análisis de ahora es distinto (ej. "en esa conversación hablamos de renta fija porque tu horizonte era más corto — tu situación cambió, así que ahora las alternativas que tiene sentido mirar son otras"). Nunca sigas recomendando algo solo porque aparece en el historial.

=== SOS TAMBIÉN ACCIONABLE, NO SOLO EXPLICATIVO (Fase 6) ===
- Además de explicar por qué se muestran alternativas de inversión, ahora podés ayudar con preguntas más amplias: cómo ahorrar más, en qué categoría gastan de más, cuánto podrían liberar reduciendo gastos, cuánto falta para un objetivo, qué cambiaría para poder invertir. Toda esa información ya está calculada en las secciones GASTOS POR CATEGORÍA, OBJETIVO e INVERSIÓN de abajo — nunca la inventes ni la calcules vos.
- Priorizá siempre las categorías en el ORDEN en que te las paso (GASTOS POR CATEGORÍA ya viene ordenado por prioridad real: desvíos importantes primero, después oportunidades, después el resto) — nunca inventes tu propio criterio de qué es "más importante".
- Sé accionable: cuando tenga sentido, cerrá con una propuesta concreta de siguiente paso (ej. "si querés, podemos mirar más de cerca esa categoría" o mencionar el botón de acceso a Plan Inteligente/objetivo que la app ya muestra debajo del chat) — pero vos NUNCA ejecutás nada, solo sugerís a dónde mirar.
- HECHO vs PROYECCIÓN — esto es crítico: un valor ya ocurrido (gasto actual, ahorro acumulado, monto de una meta) se dice tal cual. Un valor futuro (cuánto podría liberar, cuánto tendría en 12 meses) SIEMPRE va con lenguaje de proyección: "podrías", "el sistema estima", "si mantenés este ritmo", "según tu promedio". Nunca digas "vas a ahorrar $X" o "vas a llegar a tu meta" en tiempo futuro afirmativo — siempre condicional/estimado.
- Sobre "¿qué tendría que cambiar para poder invertir?": mirá el campo "readiness" de abajo. Si elegible=false, NO respondas solo "todavía no deberías invertir" — explicá el motivo real que te paso (readiness.motivo, ya redactado por el motor, normalmente menciona fondo de emergencia o deuda) y, si ese motivo ya incluye una cifra concreta (por ejemplo cuántos meses de colchón le faltan), usala tal cual aparece — nunca inventes una cifra que no esté en ese texto.
- NUNCA crees un umbral, porcentaje o regla financiera nueva (ej. "si ahorrás más del 20% ya estás bien", "no deberías gastar más del 30% en comida"). Si una clasificación no viene ya calculada en el contexto (nivel de la categoría, si es recurrente, si hay oportunidad de ahorro), no la inventes — decí que no tenés ese dato.
- Nunca digas que modificaste, modificás o vas a modificar un presupuesto, gasto, objetivo, perfil de riesgo o inversión — vos no tenés esa capacidad, sos de lectura y conversación únicamente.
`;

function formatCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function buildContextSection(ctx: InvestmentAdvisorContext): string {
  const lines: string[] = [];
  const s = ctx.situacion;

  lines.push('=== SITUACIÓN (ya calculada — no recalcular) ===');
  lines.push(`- Ingreso disponible: ${s.ingresoDisponible != null ? formatCurrency(s.ingresoDisponible) + '/mes' : 'DESCONOCIDO — no lo inventes, decilo si preguntan cuánto podrían ahorrar en base a su ingreso'}`);
  lines.push(`- Ahorro disponible: ${s.ahorroDisponible != null ? formatCurrency(s.ahorroDisponible) : 'desconocido'} (fuente: ${s.ahorroDisponibleFuente})`);
  lines.push(`- Ahorro mensual detectado (potencial de ahorro ya calculado por el motor): ${formatCurrency(s.ahorroMensual)}`);
  lines.push(`- Ese ahorro mensual mantenido 12 meses (potencialAnual — misma multiplicación simple, no una tasa nueva): ${formatCurrency(ctx.potencialAnual)}`);
  lines.push(`- Gasto promedio mensual total: ${formatCurrency(s.gastoPromedioMensual)}`);
  lines.push(`- Deuda conocida: ${s.tieneDeudaConocida == null ? 'no lo sabemos' : s.tieneDeudaConocida ? 'sí' : 'no'}`);
  lines.push(`- Perfil de riesgo: ${s.perfilRiesgo ?? 'DESCONOCIDO — no lo asumas, decilo si preguntan'}`);
  lines.push(`- Horizonte: ${s.horizonte === 'sin_definir' ? 'DESCONOCIDO — no hay meta con fecha, no lo asumas' : s.horizonte}`);
  if (s.objetivo) {
    const partes = [`Objetivo: "${s.objetivo.titulo}"`];
    if (s.objetivo.montoObjetivo != null) partes.push(`meta ${formatCurrency(s.objetivo.montoObjetivo)}`);
    if (s.objetivo.montoActual != null) partes.push(`acumulado hoy ${formatCurrency(s.objetivo.montoActual)}`);
    if (s.objetivo.fechaLimite) partes.push(`fecha límite ${s.objetivo.fechaLimite}`);
    if (s.objetivo.coveragePct != null) partes.push(`cobertura proyectada ${s.objetivo.coveragePct}%${s.objetivo.mesesProyectados != null ? ` en ${s.objetivo.mesesProyectados} meses` : ''}`);
    if (s.objetivo.montoMensualNecesario != null) partes.push(`ahorro mensual necesario para llegar a tiempo (ya calculado): ${formatCurrency(s.objetivo.montoMensualNecesario)}/mes`);
    lines.push(`- ${partes.join(' — ')}`);
  } else {
    lines.push('- Objetivo: sin meta definida. Si preguntan cuánto ahorrar para algo puntual, decí que hace falta cargar una meta primero.');
  }
  if (ctx.origenAhorro) {
    lines.push(`- Origen del ahorro potencial: ${ctx.origenAhorro.esRealizado ? 'ya se está gastando' : 'se liberaría'} ~${formatCurrency(ctx.origenAhorro.monto)} en "${ctx.origenAhorro.categoria}"${ctx.origenAhorro.porcentajeAprox != null ? ` (~${ctx.origenAhorro.porcentajeAprox}% de esa categoría)` : ''}.`);
  }

  lines.push(`\n=== ¿CORRESPONDE INVERTIR AHORA MISMO? (ya lo decidió el motor — shouldConsiderInvesting) ===`);
  lines.push(`${ctx.readiness.elegible ? 'SÍ' : 'NO'} — motivo: "${ctx.readiness.motivo}"`);
  if (!ctx.readiness.elegible) {
    lines.push('Si preguntan qué cambiaría esto, usá literalmente este motivo (puede incluir una cifra concreta, como meses de colchón) — nunca inventes una cifra distinta.');
  }

  if (ctx.gastos.length > 0) {
    lines.push('\n=== GASTOS POR CATEGORÍA (ya en orden de prioridad real — no reordenar) ===');
    for (const g of ctx.gastos) {
      lines.push(`- ${g.nombre}: gastó ${formatCurrency(g.gastoActual)} vs. promedio habitual ${formatCurrency(g.promedioHistorico)} (ritmo esperado a esta altura del mes: ${formatCurrency(g.ritmoEsperado)}, paceRatio ${g.paceRatio.toFixed(2)}) — nivel: ${g.nivel}${g.ahorroPotencial != null ? `, ahorro potencial estimado ${formatCurrency(g.ahorroPotencial)}` : ''}${g.esRecurrente ? ' [gasto recurrente detectado]' : ''}. Insight ya redactado: "${g.insight}"`);
    }
  }

  lines.push('\n=== ALTERNATIVAS SELECCIONADAS POR EL MOTOR (las únicas que podés presentar como recomendadas) ===');
  for (const a of ctx.alternativasSeleccionadas) {
    lines.push(`- ${a.nombre} — riesgo: ${a.riesgo}, liquidez: ${a.liquidez}, horizontes compatibles: ${a.horizontesCompatibles.join('/')}. Motivo del motor: "${a.porQueEncaja}"`);
  }
  if (ctx.alternativasSeleccionadas.length === 0) lines.push('(el motor no seleccionó ninguna con la información disponible)');

  if (ctx.alternativasDescartadas.length > 0) {
    lines.push('\n=== ALTERNATIVAS DESCARTADAS POR EL MOTOR (usar el motivo si el usuario pregunta por alguna de estas) ===');
    for (const d of ctx.alternativasDescartadas) {
      lines.push(`- ${d.nombre}: "${d.porQueNo}"`);
    }
  }

  if (ctx.concentracion) {
    lines.push(`\n=== CONCENTRACIÓN DETECTADA ===\nYa tiene ~${ctx.concentracion.porcentaje}% de sus inversiones registradas en "${ctx.concentracion.tipoDominante}".`);
  }

  if (ctx.datosEconomicos.length > 0) {
    lines.push('\n=== DATOS DE MERCADO (citar SIEMPRE fuente y período exactos) ===');
    for (const d of ctx.datosEconomicos) {
      lines.push(`- ${d.label}: ${d.value}${d.unit} — Fuente: ${d.source}, ${d.updatedAt ? `actualizado ${new Date(d.updatedAt).toLocaleDateString('es-AR')}` : d.period}${d.stale ? ' [OJO: este dato puede estar desactualizado, aclaralo si lo usás]' : ''}`);
    }
  } else {
    lines.push('\n=== DATOS DE MERCADO ===\nNo hay datos de mercado disponibles ahora mismo — si preguntan por inflación o tasas, decilo en vez de inventar un número.');
  }

  lines.push(`\n=== ESCENARIO CALCULADO POR EL MOTOR ===`);
  lines.push(`Ahorrando ${formatCurrency(s.ahorroMensual)}/mes durante ${ctx.escenario.meses} meses, el acumulado NOMINAL (sin ningún rendimiento) sería ${formatCurrency(ctx.escenario.ahorradoNominal)}.`);
  if (ctx.escenario.valorEscenario != null) {
    lines.push(`En un escenario hipotético (${ctx.escenario.supuesto}), el valor sería aproximadamente ${formatCurrency(ctx.escenario.valorEscenario)}. Presentalo SIEMPRE como escenario, nunca como promesa.`);
  } else {
    lines.push('No hay una tasa real disponible para proyectar un escenario con rendimiento — si preguntan "cuánto tendría", usá solo el acumulado nominal y aclará que no hay una tasa confiable para proyectar más que eso.');
  }

  lines.push(`\n=== CONFIANZA DE ESTA RECOMENDACIÓN: ${ctx.confianza.nivel.toUpperCase()} ===`);
  if (ctx.confianza.nivel === 'baja') {
    lines.push(`Falta información importante (${ctx.confianza.faltante.join(', ')}). Sé mucho más conservador: no profundices en una alternativa concreta, dejá claro que hace falta más información. Ejemplo de tono: "Todavía me falta información sobre ${ctx.confianza.faltante.join(' y ')}, por lo que no sería responsable recomendarte una alternativa concreta."`);
  } else if (ctx.confianza.nivel === 'media') {
    lines.push(`Falta algo de información (${ctx.confianza.faltante.join(', ')}). Podés explicar las alternativas, pero aclará qué falta para una recomendación más precisa.`);
  } else {
    lines.push('Hay información suficiente — podés explicar las alternativas con más profundidad.');
  }

  return lines.join('\n');
}

function buildSystemPrompt(ctx: InvestmentAdvisorContext): string {
  return CORE_RULES + '\n' + buildContextSection(ctx);
}

const EXPLAIN_INSTRUCTION = `Generá la explicación inicial de por qué se muestran estas alternativas. Usá exactamente esta estructura, sin agregar nada antes:

### ¿Por qué aparece?
(2-4 frases combinando la situación del usuario con el motivo que dio el motor para cada alternativa seleccionada — no repitas los números crudos, interpretalos)

### Qué deberías tener en cuenta
(2-3 puntos cortos, con guiones, sobre riesgos/liquidez/horizonte relevantes)

No agregues secciones extra. No uses la palabra "recomendación" como si fuera una promesa.`;

// ─── Servidor ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    if (!groqApiKey) throw new Error('GROQ_API_KEY no configurada');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      mode = 'chat', // 'explain' | 'chat'
      user_id,
      context,
      message = null,
      history = [],
    } = body as { mode?: string; user_id?: string; context: InvestmentAdvisorContext; message?: string | null; history?: { role: string; content: string }[] };

    if (!context) {
      return new Response(JSON.stringify({ error: 'context es requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (mode === 'chat' && !message) {
      return new Response(JSON.stringify({ error: 'message es requerido en modo chat' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Límite de mensajes freemium (mismo criterio que ai-advisor) — solo en modo chat ──
    if (mode === 'chat' && user_id) {
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: planRow } = await sb
          .from('profiles').select('subscription_plan, subscription_status, plan_expires_at').eq('id', user_id).single();

        if (planRow) {
          const raw = planRow.subscription_plan ?? 'free';
          const status = planRow.subscription_status ?? 'inactive';
          const expires = planRow.plan_expires_at;
          let effective = 'free';
          if (raw !== 'free') {
            if (status === 'active') effective = raw;
            else if (status === 'trial' && expires && new Date(expires) > new Date()) effective = raw;
          }
          const LIMITS: Record<string, number | null> = { free: 15, pro: 100, premium: null };
          const limit = LIMITS[effective] ?? 15;
          if (limit !== null) {
            const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            const { data: usage } = await sb.from('ai_usage').select('msg_count').eq('user_id', user_id).eq('month', month).maybeSingle();
            if ((usage?.msg_count ?? 0) >= limit) {
              return new Response(JSON.stringify({ error: 'limit_reached', plan: effective, limit }), {
                status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          }
        }
      } catch { /* no bloquear si el check falla */ }
    }

    // ── Armar mensajes y llamar a Groq ────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(context);
    // El historial se manda en ambos modos: en 'explain', si ya hubo conversación
    // previa, permite que la explicación regenerada suene a continuación natural
    // ("tu situación cambió, así que ahora...") en vez de un reinicio en frío.
    const chatHistory  = Array.isArray(history) ? history.slice(-8) : [];
    const userContent  = mode === 'explain' ? EXPLAIN_INSTRUCTION : (message as string);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userContent },
    ];

    const groqRes = await fetchWithTimeout(GROQ_API_URL, 25000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: mode === 'explain' ? 400 : 500,
        temperature: 0.5,
      }),
    });

    if (!groqRes.ok) throw new Error(`Groq: ${await groqRes.text()}`);
    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content ?? 'No pude procesar esa pregunta. Probá de nuevo.';

    // ── Incrementar uso — solo en modo chat, igual que ai-advisor con generate_welcome ──
    // Cliente ANON + Authorization real (no service role) para que auth.uid()
    // dentro de increment_ai_usage refleje al usuario real del JWT.
    if (mode === 'chat' && user_id) {
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        });
        const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sb.rpc('increment_ai_usage', { p_user_id: user_id, p_month: month });
      } catch { /* no crítico */ }
    }

    return new Response(JSON.stringify({ message: reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[investment-advisor]', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
