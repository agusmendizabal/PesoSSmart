import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// ─── Prompt base del asesor ───────────────────────────────────────────────────

const BASE_KNOWLEDGE = `
=== IDENTIDAD ===
Sos Nomi, el asesor virtual de finanzas personales para Argentina dentro de una app de gestión de gastos. Tenés conocimiento experto en economía argentina, instrumentos financieros locales, historia económica del país y finanzas personales. Hablás con tono argentino, directo y humano — nunca genérico ni condescendiente.

=== REGLAS DE RESPUESTA ===
- Siempre usá datos concretos del usuario cuando los tenés. Nunca des consejos genéricos si hay datos disponibles.
- Máximo 4-5 líneas o 3 bullets. Si hace falta más, ofrecé ampliar.
- Cerrá siempre con: "Próximo paso: [acción concreta]"
- Montos en pesos: $1.200.000 (nunca USD sin aclarar el tipo de cambio).
- No inventés rendimientos ni resultados futuros. Decí "aproximadamente" o "históricamente" cuando corresponda.
- Si el usuario gasta más del 90% del ingreso, priorizá reducción de gastos ANTES de cualquier inversión.
- Si hay deuda de tarjeta sin pagar (revolving), es prioridad absoluta número 1.

=== HISTORIA ECONÓMICA ARGENTINA (para dar contexto) ===

HIPERINFLACIÓN 1989-1990:
- Inflación anual llegó al 3.079% (julio 1989). El peso australiano perdió todo valor.
- Resultado: Plan de Convertibilidad 1991 — 1 peso = 1 dólar, ancla cambiaria.

CRISIS 2001-2002 (El Corralito):
- El corralito (diciembre 2001) congeló depósitos bancarios. Los ahorristas no podían retirar dólares.
- El "corralón" confiscó depósitos en dólares y los pesificó a $1,40 por dólar (la devaluación llegó a $3,50).
- Lección histórica: los argentinos desconfían del sistema bancario y prefieren ahorrar en dólares billete.
- La deuda pública cayó en default. Argentina fue excluida de los mercados de crédito por años.

INFLACIÓN CRÓNICA 2007-2023:
- El INDEC fue intervenido políticamente desde 2007. Se publicaron cifras de inflación falsas hasta 2016.
- Brecha cambiaria (dólar blue vs oficial) fue señal de desequilibrio macroeconómico permanente.
- 2018: Crisis cambiaria, el peso se devaluó 50% en meses. FMI prestó U$S 57.000 millones.
- 2019: "PASO shock" — Macri perdió las primarias, el peso cayó 30% en un día.
- 2019-2023: Cepo cambiario severo, múltiples tipos de cambio (oficial, blue, MEP, CCL, tarjeta, Airbnb, Qatar...).
- 2022: Inflación anual: 94,8%. 2023: 211,4%. El peso perdió 99% de su valor en 5 años.

ERA MILEI (2024 en adelante):
- Diciembre 2023: Javier Milei asume la presidencia. Motosierra fiscal: recorte del 30% del gasto público.
- Enero 2024: Devaluación del 118% del tipo de cambio oficial (de $366 a $800). Suba de tarifas de servicios públicos.
- 2024: Superávit fiscal primario por primera vez en décadas. Inflación bajó de 25% mensual (dic 2023) a ~2-3% mensual (fin 2024).
- Eliminación del cepo cambiario parcial: libre acceso al dólar MEP y CCL. Unificación gradual del tipo de cambio.
- Desregulación general: DNU 70/2023 eliminó miles de regulaciones. Ley Bases aprobada en junio 2024.
- 2025-2026: Proceso de desinflación continuando. Inflación mensual rondando 2-4%.
- Riesgo país cayó de 2.800+ puntos básicos (2023) a ~700-900 (2025). Retorno al mercado de deuda internacional.
- Debate abierto sobre dolarización plena vs tipo de cambio flotante administrado.

LECCIÓN CLAVE DE LA HISTORIA:
En Argentina, el ahorro en pesos SIN inversión es siempre una pérdida. Ahorrar en instrumentos que ajustan por inflación (UVA, CER) o en dólares es la estrategia mínima defensiva para cualquier argentino.

=== TIPOS DE CAMBIO EN ARGENTINA ===

DÓLAR OFICIAL (BNA):
- Tipo de cambio regulado por el BCRA. Acceso para importaciones, viajes (cupo de USD 200/mes).
- Desde la unificación parcial de 2024, hay un crawling peg (minidevaluaciones diarias controladas).

DÓLAR MEP (Bolsa):
- Compra de bonos en pesos → venta en dólares dentro del mercado de capitales argentino.
- Legal y accesible desde brokers online (IOL, Balanz, PPI, Cocos, entre otros).
- No tiene el cupo de USD 200/mes. No requiere declarar.
- Precio ligeramente por encima del oficial.

DÓLAR CCL (Cable):
- Similar al MEP pero los dólares quedan en cuenta en el exterior.
- Útil para girar dinero fuera del país. Precio similar al MEP.

DÓLAR BLUE (informal):
- Mercado informal. No recomendado para montos grandes por riesgos legales.
- Precio históricamente por encima del MEP por la prima de liquidez.

DÓLAR TARJETA / TURISTA:
- Tipo de cambio para compras en el exterior con tarjeta. Incluye impuestos (PAIS, percepción ganancias).
- Desde 2024 este recargo bajó con la reducción del impuesto PAIS.

=== FINANZAS PERSONALES — MARCO GENERAL ===

REGLA 50-30-20 ADAPTADA A ARGENTINA:
- 50% gastos necesarios (alquiler, servicios, comida, transporte, salud).
- 20% gastos prescindibles (salidas, entretenimiento, ropa no esencial).
- 30% ahorro e inversión (mínimo para preservar el poder adquisitivo ante la inflación).
- En Argentina, el 30% de ahorro es necesidad, no lujo.

SUELDO Y AJUSTE SALARIAL:
- Los gremios negocian paritarias, generalmente trimestrales o semestrales.
- Si no tenés paritaria, revisar el sueldo cada 3-4 meses respecto a la inflación acumulada.
- Un sueldo que no se actualiza pierde poder adquisitivo mes a mes.

ALQUILER EN ARGENTINA:
- Ley de Alquileres 2020 fue derogada en 2023. Volvieron los contratos libremente pactados.
- Muchos contratos indexan por IPC/ICL mensualmente. Es legal y habitual.
- El alquiler no debería superar el 35-40% del ingreso.

SISTEMA PREVISIONAL:
- SIPA (Sistema Integrado Previsional Argentino): aporte obligatorio del 11% del sueldo bruto.
- Jubilación: 30 años de aportes + 60/65 años (mujeres/hombres). Haberes históricamente bajos.
- Recomendación: No confiar en la jubilación estatal como único ingreso futuro. Construir un patrimonio propio.
- UXI y fondos de inversión a largo plazo son alternativas de ahorro previsional voluntario.

SEGUROS:
- Seguro de vida: necesario si tenés dependientes. Cobertura mínima = 5 años de tu ingreso anual.
- Seguro de auto: obligatorio (RC). Adicional por robo/choque según el valor del auto.
- Seguro de salud: prepaga privada es importante si podés pagarla. El sistema público es complementario.

=== CONCEPTOS CLAVE QUE TODO ARGENTINO DEBE CONOCER ===

INFLACIÓN PERSONAL vs INFLACIÓN INDEC:
- La inflación del INDEC mide un "canasta promedio". Tu inflación personal depende de en qué gastás.
- Si alquilás y usás mucho transporte, tu inflación puede superar la del INDEC.
- El IPC de Alimentos suele ser mayor al IPC general.

EFECTO DE LA INFLACIÓN EN EL AHORRO:
- $1.000.000 en caja de ahorro hoy, con 3% de inflación mensual:
  - En 12 meses vale ≈ $693.000 en términos reales (pérdida del 30%).
  - En 24 meses vale ≈ $480.000 en términos reales (pérdida del 52%).
- Por eso la inversión no es un lujo en Argentina, es supervivencia económica.

BLANQUEO DE CAPITALES 2024:
- El gobierno de Milei lanzó un blanqueo de capitales en 2024. Muchos argentinos regularon activos no declarados.
- Si el usuario menciona bienes no declarados, explicar que hubo una ventana de blanqueo pero hoy el riesgo es mayor.

CRÉDITOS HIPOTECARIOS UVA:
- Los créditos hipotecarios UVA ajustan el capital por inflación. Cuotas suben con la UVA.
- Son accesibles pero tienen riesgo si la inflación supera los aumentos salariales.
- Banco Ciudad, Banco Provincia, Santander, BBVA los ofrecen (verificar disponibilidad).
- Convenientes si los salarios acompañan la inflación. Arriesgados si no.
`;

// ─── Build System Prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(
  ctx: Record<string, any>,
  macro: Record<string, any> = {},
  rates: Record<string, { rate: number; label: string }> = {},
): string {
  const lines: string[] = [BASE_KNOWLEDGE];

  // Datos macro en tiempo real
  lines.push(`\n=== DATOS MACRO EN TIEMPO REAL (${new Date().toLocaleDateString('es-AR')}) ===`);
  if (macro.ipc_ultimo != null) {
    lines.push(`- Inflación mensual más reciente: ${(macro.ipc_ultimo * 100).toFixed(1)}% (${macro.ipc_fecha ?? 'período reciente'})`);
    if (macro.ipc_anterior != null) lines.push(`- Mes anterior: ${(macro.ipc_anterior * 100).toFixed(1)}%`);
    if (macro.ipc_hace2    != null) lines.push(`- Hace 2 meses: ${(macro.ipc_hace2 * 100).toFixed(1)}%`);
    const trend = macro.ipc_anterior != null ? (macro.ipc_ultimo < macro.ipc_anterior ? '📉 en baja' : macro.ipc_ultimo > macro.ipc_anterior ? '📈 en alza' : '→ estable') : '';
    if (trend) lines.push(`  → Tendencia inflacionaria: ${trend}`);
  } else {
    lines.push(`- Inflación mensual: dato no disponible en este momento.`);
  }
  if (macro.usd_blue       != null) lines.push(`- Dólar blue: $${Math.round(macro.usd_blue).toLocaleString('es-AR')}`);
  if (macro.usd_mep        != null) lines.push(`- Dólar MEP: $${Math.round(macro.usd_mep).toLocaleString('es-AR')}`);
  if (macro.usd_oficial    != null) lines.push(`- Dólar oficial BNA: $${macro.usd_oficial.toFixed(2)}`);
  if (macro.usd_blue != null && macro.usd_oficial != null) {
    const brecha = ((macro.usd_blue / macro.usd_oficial - 1) * 100).toFixed(1);
    lines.push(`  → Brecha cambiaria: ${brecha}%`);
  }
  lines.push(`Usá estos datos cuando el usuario pregunte por inflación, dólar, o rendimiento real de inversiones.`);

  // Tasas de inversión e inflación por rubro desde DB
  if (Object.keys(rates).length > 0) {
    const ipcMonthly = macro.ipc_ultimo != null ? +(macro.ipc_ultimo * 100).toFixed(2) : null;
    lines.push(`\n=== TASAS E INFLACIÓN POR RUBRO (datos actualizados en app) ===`);

    const investKeys = ['fci_mm', 'pf_30d', 'caucion_1d', 'cuenta_remunerada', 'lecap_monthly'];
    const investLines = investKeys
      .filter(k => rates[k])
      .map(k => {
        const { rate, label } = rates[k];
        const vs = ipcMonthly != null ? (rate >= ipcMonthly ? '✓ supera inflación' : '✗ no cubre inflación') : '';
        return `  · ${label}: ${rate}%/mes${vs ? ' — ' + vs : ''}`;
      });
    if (investLines.length) {
      lines.push(`Instrumentos de inversión (rendimiento mensual):`);
      investLines.forEach(l => lines.push(l));
    }

    const catKeys = Object.keys(rates).filter(k => k.startsWith('inflation_'));
    if (catKeys.length) {
      lines.push(`\nInflación por rubro INDEC (mensual):`);
      catKeys.forEach(k => {
        const { rate, label } = rates[k];
        lines.push(`  · ${label}: ${rate}%`);
      });
    }

    if (ipcMonthly != null && investLines.length) {
      lines.push(`\nCuando el usuario pregunte dónde poner su dinero, usá estas tasas reales. Ej: "El plazo fijo rinde ${rates['pf_30d']?.rate ?? '?'}%/mes vs inflación de ${ipcMonthly}% — ${(rates['pf_30d']?.rate ?? 0) >= ipcMonthly ? 'cubrís la inflación' : 'perdés poder adquisitivo igual'}".`);
    }
  }

  // Datos del usuario
  lines.push(`\n=== PERFIL FINANCIERO DEL USUARIO ===`);
  if (!ctx.has_data) {
    lines.push(`Sin datos financieros cargados. Si el usuario pregunta por su situación, pedile que registre gastos en la app.`);
  } else {
    if (ctx.name) lines.push(`- Nombre: ${ctx.name}`);
    if (ctx.risk_profile) lines.push(`- Perfil de riesgo: ${ctx.risk_profile}`);
    if (ctx.income)       lines.push(`- Ingreso estimado: ${fmt(ctx.income)}/mes`);

    lines.push(`\nMES ACTUAL:`);
    if (ctx.month_status) {
      const statusLabel = ctx.month_status === 'good' ? '🟢 Buen manejo' : ctx.month_status === 'tight' ? '🟡 Ajustado' : '🔴 Te pasaste del presupuesto';
      lines.push(`- Estado: ${statusLabel}`);
    }
    if (ctx.total_spent != null) lines.push(`- Total gastado: ${fmt(ctx.total_spent)}${ctx.income_pct ? ` (${ctx.income_pct}% del ingreso)` : ''}`);
    if (ctx.necessary)           lines.push(`  · Necesarios: ${fmt(ctx.necessary)}`);
    if (ctx.disposable)          lines.push(`  · Prescindibles: ${fmt(ctx.disposable)}${ctx.disposable_pct ? ` (${ctx.disposable_pct}%)` : ''}`);
    if (ctx.investable)          lines.push(`  · Invertibles: ${fmt(ctx.investable)}`);
    if (ctx.recoverable && ctx.recoverable > 0) lines.push(`- Potencial de ahorro mensual: ${fmt(ctx.recoverable)}`);
    if (ctx.vs_prev_month != null) lines.push(`- Variación vs mes anterior: ${ctx.vs_prev_month > 0 ? '+' : ''}${ctx.vs_prev_month}%`);
    if (ctx.personal_inflation != null) lines.push(`- Inflación personal estimada: ${ctx.personal_inflation.toFixed(1)}%`);
    if (ctx.top_cats?.length) lines.push(`- Top categorías: ${ctx.top_cats.map((c: any) => `${c.name} ${fmt(c.amount)}`).join(' · ')}`);
    if (ctx.subscriptions?.length) {
      const subTotal = ctx.subscriptions.reduce((s: number, x: any) => s + x.avg, 0);
      lines.push(`- Suscripciones (~${fmt(subTotal)}/mes): ${ctx.subscriptions.map((s: any) => s.description).join(', ')}`);
    }

    if (ctx.savings_summary) {
      lines.push(`\nCAPITAL E INVERSIONES:`);
      lines.push(ctx.savings_summary);
    }
    if (ctx.goals_summary) {
      lines.push(`\nMETAS DE AHORRO:`);
      lines.push(ctx.goals_summary);
    }

    // Alertas automáticas basadas en datos
    lines.push(`\nALERTAS DETECTADAS:`);
    let hasAlerts = false;
    if (ctx.income && ctx.total_spent && ctx.total_spent > ctx.income) {
      lines.push(`⛔ DÉFICIT: gasta ${fmt(ctx.total_spent - ctx.income)} más de lo que gana. Prioridad urgente.`);
      hasAlerts = true;
    }
    if (ctx.disposable_pct && ctx.disposable_pct > 30) {
      lines.push(`⚠️ PRESCINDIBLES ALTOS: ${ctx.disposable_pct}% del gasto es prescindible. Potencial de optimización.`);
      hasAlerts = true;
    }
    if (ctx.income_pct && ctx.income_pct > 85 && ctx.income_pct <= 100) {
      lines.push(`⚠️ POCO MARGEN: gasta el ${ctx.income_pct}% del ingreso. Sin capacidad de ahorro real.`);
      hasAlerts = true;
    }
    if (ctx.month_status === 'good' && ctx.recoverable > 5000) {
      lines.push(`✅ MES POSITIVO: ${fmt(ctx.recoverable)} disponibles para invertir este mes.`);
      hasAlerts = true;
    }
    if (!hasAlerts) lines.push(`Sin alertas críticas.`);
  }

  return lines.join('\n');
}

// ─── Mensaje de bienvenida ────────────────────────────────────────────────────

function buildWelcomeUserMessage(ctx: Record<string, any>, initialContext: string | null): string {
  if (initialContext) {
    return `${initialContext}\n\nRespondé en 3-4 frases, directo, con datos concretos de Argentina. Sin introducción.`;
  }
  if (ctx.has_data && ctx.total_spent != null) {
    const estado = ctx.month_status === 'good' ? 'positivo' : ctx.month_status === 'tight' ? 'ajustado' : 'en déficit';
    return `Mis finanzas este mes están ${estado}. Total gastado: ${fmt(ctx.total_spent)}${ctx.income ? `, ingreso estimado ${fmt(ctx.income)}` : ''}. Resumí mi situación en 2-3 frases y decime el punto más importante que debería atender hoy. Sin introducción.`;
  }
  return `Presentate brevemente como Nomi y decime 2 maneras concretas en que podés ayudarme con mis finanzas en Argentina hoy. Máximo 2 frases.`;
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
      generate_welcome = false,
      generate_report  = false,
      report_context   = null,
      client_context   = null,
      initial_context  = null,
      savings_context  = null,
      bot_focus        = 'general', // 'general' | 'inversiones' | 'ahorro' | 'gastos'
    } = body;

    if (!generate_welcome && !generate_report && !message) {
      return new Response(JSON.stringify({ error: 'Mensaje requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Modo: Reporte de salud financiera (sin límite de mensajes) ───────────
    if (generate_report && report_context) {
      const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
      const rc  = report_context;

      const reportSystemPrompt = `${BASE_KNOWLEDGE}

=== MODO: GENERACIÓN DE REPORTE FINANCIERO ===
Sos Nomi. Tu tarea es generar un análisis narrativo conciso del estado financiero del usuario basado en los datos calculados que te envían. Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "narrative": "2-3 oraciones que resumen el estado financiero del mes de forma honesta, con datos concretos, en tono humano e inteligente. Sin moralizar.",
  "key_finding": "Una oración que identifica el hallazgo más relevante del mes, con dato concreto.",
  "next_step": "Una acción concreta y específica que el usuario puede hacer YA para mejorar su situación."
}
Reglas:
- Usá montos en formato argentino ($1.200.000).
- No uses frases como "vas excelente" sin respaldarlo con datos.
- Nunca culpes al usuario.
- Si el puntaje es alto, celebrá con datos. Si es bajo, explicá qué lo genera.
- Solo respondé el JSON, sin texto adicional antes ni después.`;

      const reportUserMsg = `Datos del mes del usuario:
- Puntaje de salud financiera: ${rc.health_score}/100 (${rc.health_label})
- Total gastado: ${fmt(rc.total)}${rc.income ? ` de ${fmt(rc.income)} de ingreso (${rc.income_pct}%)` : ''}
- Necesarios: ${fmt(rc.necessary)} · Prescindibles: ${fmt(rc.disposable)} · Invertibles: ${fmt(rc.investable)}
- Prescindibles sobre lo clasificado: ${rc.disposable_pct ?? 'N/A'}%
- Capacidad de ahorro: ${rc.savings_capacity != null ? fmt(rc.savings_capacity) : 'N/A'}
- Categoría principal: ${rc.top_category ? `${rc.top_category.name} (${fmt(rc.top_category.amount)}, ${rc.top_category.pct}% del gasto)` : 'N/A'}
- Variación vs mes anterior: ${rc.history_trend_pct != null ? `${rc.history_trend_pct > 0 ? '+' : ''}${rc.history_trend_pct}% nominal, ${rc.real_trend_pct > 0 ? '+' : ''}${rc.real_trend_pct}% real` : 'sin historial suficiente'}
- Inflación del mes: ${rc.inflation_rate}%
- Tasa FCI MM: ${rc.fci_rate}%/mes
Componentes del puntaje: ${(rc.components ?? []).map((c: any) => `${c.label} ${c.score}/${c.max} — ${c.note}`).join('; ')}
Generá el reporte en JSON.`;

      const groqResReport = await fetchWithTimeout(GROQ_API_URL, 20000, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages:    [{ role: 'system', content: reportSystemPrompt }, { role: 'user', content: reportUserMsg }],
          max_tokens:  400,
          temperature: 0.5,
          response_format: { type: 'json_object' },
        }),
      });

      if (!groqResReport.ok) throw new Error(`Groq report: ${await groqResReport.text()}`);
      const reportGroqData = await groqResReport.json();
      const rawText        = reportGroqData.choices?.[0]?.message?.content ?? '{}';
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(rawText); } catch { parsed = { narrative: rawText }; }

      return new Response(JSON.stringify({
        narrative:    parsed.narrative    ?? '',
        key_finding:  parsed.key_finding  ?? '',
        next_step:    parsed.next_step    ?? '',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Datos macroeconómicos en paralelo (con timeout de 4s cada uno) ──────────
    function fetchWithTimeout(url: string, ms = 4000, init?: RequestInit): Promise<Response> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    }

    let macro: Record<string, any> = {};
    const [ipcResult, usdOficialResult, bluelyticsResult] = await Promise.allSettled([
      fetchWithTimeout('https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=3&format=json'),
      fetchWithTimeout('https://apis.datos.gob.ar/series/api/series/?ids=168.1_T_CAMBIOR_D_0_0_26&limit=1&format=json'),
      fetchWithTimeout('https://api.bluelytics.com.ar/v2/latest'),
    ]);

    try {
      if (ipcResult.status === 'fulfilled' && ipcResult.value.ok) {
        const d = (await ipcResult.value.json())?.data ?? [];
        if (d[0]) { macro.ipc_ultimo = d[0][1]; macro.ipc_fecha = d[0][0]; }
        if (d[1]) macro.ipc_anterior = d[1][1];
        if (d[2]) macro.ipc_hace2    = d[2][1];
      }
      if (usdOficialResult.status === 'fulfilled' && usdOficialResult.value.ok) {
        const d = (await usdOficialResult.value.json())?.data ?? [];
        if (d[0]) macro.usd_oficial = d[0][1];
      }
      if (bluelyticsResult.status === 'fulfilled' && bluelyticsResult.value.ok) {
        const bl = await bluelyticsResult.value.json();
        if (bl?.blue?.value_sell)    macro.usd_blue   = bl.blue.value_sell;
        if (bl?.oficial?.value_sell) macro.usd_oficial = macro.usd_oficial ?? bl.oficial.value_sell;
        if (bl?.ev?.value_sell)      macro.usd_mep    = bl.ev.value_sell;
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

        const [profileRes, financialRes, riskRes, expensesRes, expCatRes, sub90Res, ratesRes] = await Promise.all([
          sb.from('profiles').select('full_name').eq('id', user_id).single(),
          sb.from('financial_profiles').select('income_range').eq('user_id', user_id).single(),
          sb.from('risk_profiles').select('profile').eq('user_id', user_id).maybeSingle(),
          sb.from('expenses').select('amount, classification').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          sb.from('expenses').select('amount, category:expense_categories(name_es)').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          sb.from('expenses').select('description, amount, date').eq('user_id', user_id).is('deleted_at', null).gte('date', since90),
          (sb as any).from('market_rates').select('instrument, rate_monthly, label'),
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

        const income   = financialRes.data?.income_range ? (INCOME_RANGE_MAP[financialRes.data.income_range] ?? null) : null;
        const subTotal = subscriptions.reduce((s, x) => s + x.avg, 0);

        const ratesMap: Record<string, { rate: number; label: string }> = {};
        for (const r of (ratesRes.data ?? []) as Array<{ instrument: string; rate_monthly: number; label: string }>) {
          ratesMap[r.instrument] = { rate: r.rate_monthly, label: r.label ?? r.instrument };
        }

        ctx = {
          has_data:     totalSpent > 0 || income != null,
          name:         profileRes.data?.full_name,
          risk_profile: riskRes.data?.profile ?? null,
          income,
          total_spent:  totalSpent,
          necessary,
          disposable,
          investable,
          top_cats,
          subscriptions,
          subTotal,
          rates:        ratesMap,
        };
      } catch { /* contexto DB no crítico */ }
    }

    // ── Validar límite de mensajes ────────────────────────────────────────────
    if (!generate_welcome && user_id) {
      try {
        const sb = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: planRow } = await sb
          .from('profiles').select('subscription_plan, subscription_status, plan_expires_at').eq('id', user_id).single();

        if (planRow) {
          const raw    = planRow.subscription_plan ?? 'free';
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
              return new Response(
                JSON.stringify({ error: 'limit_reached', plan: effective, limit }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
              );
            }
          }
        }
      } catch { /* no bloquear si el check falla */ }
    }

    // ── Fusionar contexto del cliente (más preciso para el mes actual) ────────
    if (client_context) {
      ctx.has_data = true;
      if (client_context.month_total       != null) ctx.total_spent       = client_context.month_total;
      if (client_context.income            != null && !ctx.income) ctx.income = client_context.income;
      if (client_context.income_pct        != null) ctx.income_pct        = client_context.income_pct;
      if (client_context.month_status      != null) ctx.month_status      = client_context.month_status;
      if (client_context.necessary         != null) ctx.necessary         = client_context.necessary;
      if (client_context.disposable        != null) ctx.disposable        = client_context.disposable;
      if (client_context.disposable_pct    != null) ctx.disposable_pct    = client_context.disposable_pct;
      if (client_context.investable        != null) ctx.investable        = client_context.investable;
      if (client_context.recoverable       != null) ctx.recoverable       = client_context.recoverable;
      if (client_context.vs_prev_month     != null) ctx.vs_prev_month     = client_context.vs_prev_month;
      if (client_context.personal_inflation!= null) ctx.personal_inflation = client_context.personal_inflation;
    }

    // ── Contexto de ahorros/metas (enviado desde savings.tsx si disponible) ──
    if (savings_context) {
      if (savings_context.savings_summary) ctx.savings_summary = savings_context.savings_summary;
      if (savings_context.goals_summary)   ctx.goals_summary   = savings_context.goals_summary;
      ctx.has_data = true;
    }

    // ── Foco del bot ─────────────────────────────────────────────────────────
    const BOT_FOCUS_PROMPTS: Record<string, string> = {
      inversiones: `\n=== FOCO DE ESTE CHAT: INVERSIONES ===\nEste bot es especialista en inversiones. Cuando el usuario pregunte algo general, enfocate en el ángulo inversor. Priorizá: Cedears, FCI, bonos CER, ON en dólares, Lecaps, acciones del Merval, dólar MEP/CCL. Siempre mencioná el riesgo y el horizonte temporal recomendado para cada instrumento. Si el usuario tiene prescindibles altos, sugerí usarlos para invertir.`,
      ahorro: `\n=== FOCO DE ESTE CHAT: AHORRO Y PRESUPUESTO ===\nEste bot es especialista en ahorro y metas financieras. Cuando el usuario pregunte algo general, enfocate en: cómo ahorrar más, cómo estructurar un presupuesto, fondo de emergencia, metas de ahorro concretas, reducción de gastos no esenciales. Usá los datos de metas del usuario si están disponibles. Dá sugerencias de cuánto ahorrar por mes y en cuánto tiempo se logra una meta.`,
      gastos: `\n=== FOCO DE ESTE CHAT: ANÁLISIS DE GASTOS ===\nEste bot es especialista en análisis y optimización de gastos. Cuando el usuario pregunte algo general, enfocate en: qué gastos puede reducir, cómo clasificar mejor sus gastos (necesario/prescindible/invertible), suscripciones que no usa, análisis de patrones de gasto, comparación con meses anteriores. Usá los datos concretos de gastos del usuario. Sé específico: mencioná categorías y montos reales.`,
      general: '',
    };
    const focusAddition = BOT_FOCUS_PROMPTS[bot_focus] ?? '';

    // ── Llamar a Groq ─────────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(ctx, macro, ctx.rates ?? {}) + focusAddition;
    const chatHistory  = Array.isArray(history) ? history.slice(-10) : [];

    let userContent: string;
    let maxTokens: number;

    if (generate_welcome) {
      userContent = buildWelcomeUserMessage(ctx, initial_context ?? null);
      maxTokens   = 250;
    } else {
      userContent = message;
      maxTokens   = 700;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userContent },
    ];

    const groqRes = await fetchWithTimeout(GROQ_API_URL, 25000, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages,
        max_tokens:  maxTokens,
        temperature: generate_welcome ? 0.6 : 0.65,
      }),
    });

    if (!groqRes.ok) throw new Error(`Groq: ${await groqRes.text()}`);

    const groqData = await groqRes.json();
    const reply    = groqData.choices?.[0]?.message?.content ?? 'No pude procesar esa pregunta. Probá de nuevo.';

    // ── Incrementar uso ───────────────────────────────────────────────────────
    // Se usa el cliente ANON + el Authorization real del caller (no service role)
    // para que auth.uid() dentro de increment_ai_usage refleje al usuario real
    // del JWT — la RPC valida auth.uid() = p_user_id y rechaza si no coinciden.
    if (!generate_welcome && user_id) {
      try {
        const sb = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sb.rpc('increment_ai_usage', { p_user_id: user_id, p_month: month });
      } catch { /* no crítico */ }
    }

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
