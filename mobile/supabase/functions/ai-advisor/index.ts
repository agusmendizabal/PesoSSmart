import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valores 2026 — midpoints de cada rango
const INCOME_RANGE_MAP: Record<string, number> = {
  under_150k:  300_000,
  '150k_300k': 750_000,
  '300k_500k': 1_500_000,
  '500k_800k': 2_750_000,
  '800k_1500k':4_750_000,
  over_1500k:  8_000_000,
};

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

// ─── Sistema base del asesor ──────────────────────────────────────────────────

function buildSystemPrompt(
  ctx: Record<string, any>,
  macro: Record<string, any> = {},
): string {
  const lines: string[] = [];

  lines.push(`Sos SmartPesos, un asesor virtual de finanzas personales para Argentina. Respondés dentro de una app de gestión de gastos.`);
  lines.push(``);

  lines.push(`OBJETIVOS:`);
  lines.push(`- Ayudar al usuario a entender sus gastos, mejorar el ahorro y tomar decisiones financieras ordenadas.`);
  lines.push(`- Dar orientación adaptada al contexto económico argentino (inflación, tipos de cambio, instrumentos locales).`);
  lines.push(`- Prioridad de acción: 1) Ordenar gastos, 2) Fondo de emergencia, 3) Pagar deudas caras, 4) Invertir.`);
  lines.push(``);

  lines.push(`REGLAS:`);
  lines.push(`- Respondé en español claro, tono argentino, directo y humano. Sin ser condescendiente.`);
  lines.push(`- Siempre mencioná datos concretos del usuario cuando los tengas. No des respuestas genéricas.`);
  lines.push(`- No inventes rendimientos, precios ni resultados futuros.`);
  lines.push(`- Explicá siempre el riesgo de cada instrumento o decisión.`);
  lines.push(`- Si el usuario gasta más del 90% de su ingreso, priorizá reducción de gastos ANTES que inversión.`);
  lines.push(`- Si tiene deuda de tarjeta sin pagar, eso es urgente antes de cualquier otra cosa.`);
  lines.push(`- Terminá SIEMPRE con un próximo paso concreto y accionable.`);
  lines.push(``);

  lines.push(`FORMATO:`);
  lines.push(`- Respuestas cortas. Sin introducciones largas ni relleno.`);
  lines.push(`- Máximo 4-5 líneas o 3 bullets. Si hace falta más, ofrecé ampliar.`);
  lines.push(`- Bullets para opciones o pasos. Una idea por bullet.`);
  lines.push(`- Cerrá con: "Próximo paso: [acción concreta]"`);
  lines.push(`- Usá montos en pesos con formato: $1.200.000 (nunca USD sin aclarar el tipo de cambio).`);
  lines.push(``);

  lines.push(`INSTRUMENTOS ARGENTINA (2025-2026):`);
  lines.push(`CONSERVADOR (necesita liquidez, no tolera pérdidas):`);
  lines.push(`- FCI Money Market: alta liquidez (rescate 24-48hs), rinde similar a tasa de plazo fijo. Ideal para fondo de emergencia.`);
  lines.push(`- Plazo fijo UVA: ajusta por CER (inflación), mínimo 90 días. Mejor que plazo fijo tradicional para preservar valor.`);
  lines.push(`- Lecaps / Letras del Tesoro: corto plazo, tasa fija en pesos, sin riesgo cambiario.`);
  lines.push(``);
  lines.push(`MODERADO (acepta volatilidad, horizonte 6-24 meses):`);
  lines.push(`- Bonos CER (AL30D, TX26): ajustan por inflación, más rendimiento que UVA pero con más volatilidad.`);
  lines.push(`- Cedears: acciones extranjeras que cotizan en pesos siguiendo el dólar CCL. Apple, Google, MercadoLibre, YPF. Hedge cambiario natural.`);
  lines.push(`- ON dólares: bonos corporativos (YPF, Pampa, Telecom), pagan en dólares MEP. Riesgo crediticio corporativo.`);
  lines.push(``);
  lines.push(`AGRESIVO (tolera alta volatilidad, horizonte +2 años):`);
  lines.push(`- Acciones del Merval: alta volatilidad, potencial de retorno alto, requiere seguimiento constante.`);
  lines.push(`- Criptomonedas / Stablecoins: USDT para dolarizarse sin comprar oficial, Bitcoin/ETH especulativo. Solo con lo que se puede perder.`);
  lines.push(``);
  lines.push(`REGLAS DE INVERSIÓN:`);
  lines.push(`- Sin fondo de emergencia previo (3 meses de gastos), no recomendar inversión.`);
  lines.push(`- Cepo cambiario: límite USD 200/mes a tipo oficial. MEP y CCL son legales y accesibles desde homebanking.`);
  lines.push(`- Tarjetas: TNA 100-200% anual. Pagar el mínimo es destructivo. Prioridad absoluta si hay deuda.`);
  lines.push(`- Cuotas sin interés: convenientes solo si el precio en cuotas = precio contado.`);
  lines.push(``);

  lines.push(`CONTEXTO MACRO ARGENTINO:`);
  lines.push(`- Inflación alta y crónica. Ahorrar en pesos sin inversión destruye el poder adquisitivo.`);
  lines.push(`- Los salarios van detrás de la inflación real. Revisar el presupuesto cada vez que hay suba de sueldo o servicios.`);
  lines.push(`- Las suscripciones acumuladas (streaming, apps, gimnasio) suman entre $30.000 y $100.000/mes sin que el usuario lo note.`);
  lines.push(``);

  // Datos macroeconómicos actualizados
  if (macro.ipc_ultimo != null) {
    lines.push(`=== DATOS MACRO ACTUALIZADOS (INDEC / datos.gob.ar) ===`);
    lines.push(`- Inflación mensual más reciente: ${(macro.ipc_ultimo * 100).toFixed(1)}% (${macro.ipc_fecha ?? 'último período'})`);
    if (macro.ipc_anterior != null) lines.push(`- Inflación mes anterior: ${(macro.ipc_anterior * 100).toFixed(1)}%`);
    if (macro.ipc_hace2    != null) lines.push(`- Inflación hace 2 meses: ${(macro.ipc_hace2 * 100).toFixed(1)}%`);
    if (macro.usd_oficial  != null) lines.push(`- TC oficial referencia: $${macro.usd_oficial.toFixed(2)}`);
    lines.push(`Usá estos datos cuando el usuario pregunte por inflación, rendimiento real o poder adquisitivo.`);
    lines.push(``);
  }

  // Datos del usuario
  if (ctx.has_data) {
    lines.push(`=== DATOS FINANCIEROS DEL USUARIO — ESTE MES ===`);
    if (ctx.name) lines.push(`- Nombre: ${ctx.name}`);

    // Estado del mes
    if (ctx.month_status) {
      const statusLabel = ctx.month_status === 'good' ? '🟢 Buen manejo' : ctx.month_status === 'tight' ? '🟡 Ajustado' : '🔴 Te pasaste';
      lines.push(`- Estado del mes: ${statusLabel}`);
    }

    if (ctx.income)       lines.push(`- Ingreso estimado: ${fmt(ctx.income)}/mes`);
    if (ctx.total_spent != null) lines.push(`- Total gastado: ${fmt(ctx.total_spent)}`);
    if (ctx.income_pct  != null) lines.push(`  · ${ctx.income_pct}% del ingreso estimado`);
    if (ctx.necessary)    lines.push(`  · Necesario: ${fmt(ctx.necessary)}`);
    if (ctx.disposable)   lines.push(`  · Prescindible: ${fmt(ctx.disposable)}${ctx.disposable_pct ? ` (${ctx.disposable_pct}% del total)` : ''}`);
    if (ctx.investable)   lines.push(`  · Invertible: ${fmt(ctx.investable)}`);
    if (ctx.recoverable && ctx.recoverable > 0) {
      lines.push(`- Dinero recuperable estimado (si ajusta prescindibles): ${fmt(ctx.recoverable)}/mes`);
    }
    if (ctx.vs_prev_month != null) {
      const sign = ctx.vs_prev_month > 0 ? '+' : '';
      lines.push(`- Variación vs mes anterior: ${sign}${ctx.vs_prev_month}%`);
    }
    if (ctx.personal_inflation != null) {
      lines.push(`- Inflación personal estimada: ${ctx.personal_inflation.toFixed(1)}%`);
    }
    if (ctx.top_cats?.length) {
      lines.push(`- Top categorías: ${ctx.top_cats.map((c: any) => `${c.name} (${fmt(c.amount)})`).join(', ')}`);
    }
    if (ctx.subscriptions?.length) {
      const subTotal = ctx.subscriptions.reduce((s: number, x: any) => s + x.avg, 0);
      lines.push(`- Suscripciones recurrentes (~${fmt(subTotal)}/mes): ${ctx.subscriptions.map((s: any) => s.description).join(', ')}`);
    }

    // Reglas de análisis activadas por los datos
    lines.push(``);
    lines.push(`ANÁLISIS ACTIVADO POR LOS DATOS:`);
    if (ctx.income && ctx.total_spent && ctx.total_spent > ctx.income) {
      lines.push(`⚠️ Usuario gasta más de lo que gana. Déficit de ${fmt(ctx.total_spent - ctx.income)}. Priorizá reducción de gastos URGENTE.`);
    }
    if (ctx.disposable_pct && ctx.disposable_pct > 25) {
      lines.push(`⚠️ Prescindibles sobre el 25%. Alta exposición. Identificá y sugerí recortes específicos.`);
    }
    if (ctx.income_pct && ctx.income_pct > 85 && ctx.income_pct <= 100) {
      lines.push(`⚠️ Más del 85% del ingreso gastado. Hay poco margen. Antes de invertir, fijá un techo de gasto.`);
    }
    if (ctx.total_spent && ctx.total_spent > 50000 && ctx.investable === 0) {
      lines.push(`ℹ️ Sin gastos invertibles. Pensá si hay algo que podría reclasificarse.`);
    }
    if (ctx.month_status === 'good' && ctx.recoverable > 0) {
      lines.push(`✅ Mes positivo. Recomendá invertir el excedente: ${fmt(ctx.recoverable)} disponibles.`);
    }
  } else {
    lines.push(`=== DATOS DEL USUARIO ===`);
    lines.push(`No hay datos financieros cargados. Si el usuario pregunta por su situación, pedile que cargue gastos en la app primero.`);
  }

  return lines.join('\n');
}

// ─── Prompt de bienvenida ─────────────────────────────────────────────────────

function buildWelcomeUserMessage(ctx: Record<string, any>, initialContext: string | null): string {
  if (initialContext) {
    // El usuario llegó desde una acción específica del Informe
    return `${initialContext}\n\nRespondé con contexto financiero concreto de Argentina. Máximo 3-4 frases, directo y accionable. Sin introducción larga.`;
  }

  // Bienvenida genérica basada en datos del mes
  const parts: string[] = [];

  if (ctx.has_data && ctx.total_spent != null) {
    parts.push('Basándote en mis datos financieros de este mes');
    if (ctx.month_status) parts.push(`(estado: ${ctx.month_status === 'good' ? 'bueno' : ctx.month_status === 'tight' ? 'ajustado' : 'excedido'})`);
    parts.push(', resumí mi situación en 2-3 frases. Destacá el punto más importante que debería atender. Sin introducción larga, directo al dato clave.');
  } else {
    parts.push('Presentate brevemente y decime cómo podés ayudarme con mis finanzas personales en Argentina. Máximo 2 frases.');
  }

  return parts.join(' ');
}

// ─── Servidor ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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
      message,
      history,
      user_id,
      generate_welcome  = false,
      client_context    = null,   // contexto pre-computado en el frontend
      initial_context   = null,   // string contextual desde reports.tsx
    } = body;

    if (!generate_welcome && !message) {
      return new Response(JSON.stringify({ error: 'Mensaje requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Datos macroeconómicos (opcional) ─────────────────────────────────────
    let macro: Record<string, any> = {};
    try {
      const [ipcRes, usdRes] = await Promise.all([
        fetch('https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=3&format=json'),
        fetch('https://apis.datos.gob.ar/series/api/series/?ids=168.1_T_CAMBIOR_D_0_0_26&limit=3&format=json'),
      ]);
      if (ipcRes.ok) {
        const d = (await ipcRes.json())?.data ?? [];
        if (d[0]) { macro.ipc_ultimo = d[0][1]; macro.ipc_fecha = d[0][0]; }
        if (d[1]) macro.ipc_anterior = d[1][1];
        if (d[2]) macro.ipc_hace2    = d[2][1];
      }
      if (usdRes.ok) {
        const d = (await usdRes.json())?.data ?? [];
        if (d[0]) macro.usd_oficial = d[0][1];
      }
    } catch { /* macro no crítico */ }

    // ── Contexto del usuario desde DB ────────────────────────────────────────
    let ctx: Record<string, any> = { has_data: false };

    if (user_id) {
      try {
        const sb = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } },
        );

        const now        = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const since90    = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

        const [profileRes, financialRes, expensesRes, expCatRes, sub90Res] = await Promise.all([
          sb.from('profiles').select('full_name').eq('id', user_id).single(),
          sb.from('financial_profiles').select('income_range').eq('user_id', user_id).single(),
          sb.from('expenses').select('amount, classification').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          sb.from('expenses').select('amount, category:expense_categories(name_es)').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          sb.from('expenses').select('description, amount, date').eq('user_id', user_id).is('deleted_at', null).gte('date', since90),
        ]);

        const expenses   = expensesRes.data ?? [];
        const totalSpent = expenses.reduce((s: number, e: any) => s + e.amount, 0);
        const necessary  = expenses.filter((e: any) => e.classification === 'necessary').reduce((s: number, e: any) => s + e.amount, 0);
        const disposable = expenses.filter((e: any) => e.classification === 'disposable').reduce((s: number, e: any) => s + e.amount, 0);
        const investable = expenses.filter((e: any) => e.classification === 'investable').reduce((s: number, e: any) => s + e.amount, 0);

        const catMap: Record<string, number> = {};
        for (const e of expCatRes.data ?? []) {
          const name = (e.category as any)?.name_es ?? 'Otros';
          catMap[name] = (catMap[name] ?? 0) + e.amount;
        }
        const top_cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amount]) => ({ name, amount }));

        const grouped: Record<string, { amounts: number[]; dates: string[] }> = {};
        for (const e of sub90Res.data ?? []) {
          const key = (e.description as string).toLowerCase().trim();
          if (!grouped[key]) grouped[key] = { amounts: [], dates: [] };
          grouped[key].amounts.push(e.amount);
          grouped[key].dates.push(e.date);
        }
        const subscriptions = Object.entries(grouped)
          .filter(([, v]) => new Set(v.dates.map((d: string) => d.substring(0, 7))).size >= 2)
          .map(([desc, v]) => ({
            description: (sub90Res.data ?? []).find((e: any) => e.description.toLowerCase().trim() === desc)?.description ?? desc,
            avg: Math.round(v.amounts.reduce((a: number, b: number) => a + b, 0) / v.amounts.length),
          }));

        const income    = financialRes.data?.income_range ? (INCOME_RANGE_MAP[financialRes.data.income_range] ?? null) : null;
        const subTotal  = subscriptions.reduce((s, x) => s + x.avg, 0);
        const projected = income != null ? income - totalSpent - subTotal : null;

        ctx = {
          has_data:    totalSpent > 0 || income != null,
          name:        profileRes.data?.full_name,
          income,
          total_spent: totalSpent,
          necessary,
          disposable,
          investable,
          projected,
          top_cats,
          subscriptions,
        };
      } catch { /* contexto DB no crítico */ }
    }

    // ── Fusionar contexto del cliente (más preciso para el mes actual) ────────
    if (client_context) {
      ctx.has_data = true;
      if (client_context.month_total    != null) ctx.total_spent      = client_context.month_total;
      if (client_context.income         != null && !ctx.income) ctx.income = client_context.income;
      if (client_context.income_pct     != null) ctx.income_pct       = client_context.income_pct;
      if (client_context.month_status   != null) ctx.month_status     = client_context.month_status;
      if (client_context.necessary      != null) ctx.necessary        = client_context.necessary;
      if (client_context.disposable     != null) ctx.disposable       = client_context.disposable;
      if (client_context.disposable_pct != null) ctx.disposable_pct   = client_context.disposable_pct;
      if (client_context.investable     != null) ctx.investable       = client_context.investable;
      if (client_context.recoverable    != null) ctx.recoverable      = client_context.recoverable;
      if (client_context.vs_prev_month  != null) ctx.vs_prev_month    = client_context.vs_prev_month;
      if (client_context.personal_inflation != null) ctx.personal_inflation = client_context.personal_inflation;
    }

    // ── Llamar a Groq ─────────────────────────────────────────────────────────
    const systemPrompt  = buildSystemPrompt(ctx, macro);
    const chatHistory   = Array.isArray(history) ? history.slice(-8) : [];

    let userContent: string;
    let maxTokens: number;

    if (generate_welcome) {
      userContent = buildWelcomeUserMessage(ctx, initial_context ?? null);
      maxTokens   = 200; // bienvenida corta
    } else {
      userContent = message;
      maxTokens   = 600;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userContent },
    ];

    const groqRes = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body:    JSON.stringify({
        model:        'llama-3.3-70b-versatile',
        messages,
        max_tokens:   maxTokens,
        temperature:  generate_welcome ? 0.65 : 0.7,
      }),
    });

    if (!groqRes.ok) throw new Error(`Groq: ${await groqRes.text()}`);

    const groqData = await groqRes.json();
    const reply    = groqData.choices?.[0]?.message?.content
      ?? 'No pude procesar esa pregunta. Probá de nuevo.';

    return new Response(JSON.stringify({ message: reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[ai-advisor]', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
