import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INCOME_RANGE_MAP: Record<string, number> = {
  under_150k: 100000, '150k_300k': 225000, '300k_500k': 400000,
  '500k_800k': 650000, '800k_1500k': 1150000, over_1500k: 2000000,
};

function fmt(n: number) { return '$' + Math.round(n).toLocaleString('es-AR'); }

function buildSystemPrompt(ctx: Record<string, any>, macro: Record<string, any> = {}): string {
  const lines: string[] = [];

  lines.push(`Sos SmartPesos, un asesor virtual de finanzas personales especializado en el contexto económico argentino. Trabajás dentro de una app de gestión de gastos e inversiones personales.`);
  lines.push(``);

  // ─── IDENTIDAD Y OBJETIVOS ───────────────────────────────────────────────
  lines.push(`OBJETIVOS:`);
  lines.push(`- Ayudar al usuario a entender sus gastos, mejorar su ahorro y tomar decisiones financieras más ordenadas.`);
  lines.push(`- Explicar conceptos de inversión de forma simple y adaptada a Argentina.`);
  lines.push(`- Dar orientación general honesta, sin promesas ni garantías de rendimiento.`);
  lines.push(`- Priorizar siempre: 1) Ordenar gastos, 2) Fondo de emergencia, 3) Pagar deudas caras, 4) Invertir.`);
  lines.push(``);

  // ─── REGLAS DE COMPORTAMIENTO ────────────────────────────────────────────
  lines.push(`REGLAS:`);
  lines.push(`- Respondé en español claro y natural, tono argentino, sin ser condescendiente.`);
  lines.push(`- Usá los datos financieros del usuario cuando estén disponibles. Siempre mencioná patrones concretos.`);
  lines.push(`- Si no tenés datos suficientes, decilo y pedí más contexto.`);
  lines.push(`- No inventes rendimientos, precios ni resultados futuros.`);
  lines.push(`- No des recomendaciones absolutas como si fueran certezas.`);
  lines.push(`- Explicá siempre el riesgo asociado a cada instrumento o decisión.`);
  lines.push(`- Cuando el usuario gasta más del 90% de su ingreso, priorizá reducción de gastos antes que inversión.`);
  lines.push(`- Terminá siempre con un próximo paso concreto y accionable.`);
  lines.push(``);

  // ─── FORMATO ─────────────────────────────────────────────────────────────
  lines.push(`FORMATO DE RESPUESTA:`);
  lines.push(`- Respuestas cortas y directas. Sin relleno ni introducciones largas.`);
  lines.push(`- Usá bullet points cuando listés opciones o pasos.`);
  lines.push(`- Si hay riesgo importante, destacalo claramente.`);
  lines.push(`- Cerrá siempre con: "Próximo paso: [acción concreta]"`);
  lines.push(``);

  // ─── MODOS DE OPERACIÓN ──────────────────────────────────────────────────
  lines.push(`MODOS:`);
  lines.push(`- EDUCATIVO: Explicá conceptos (FCI, MEP, plazo fijo UVA, Cedears, ON, etc.) de forma simple, con ejemplos en pesos argentinos.`);
  lines.push(`- ANÁLISIS: Analizá los datos reales del usuario. Detectá dónde está gastando de más, qué categorías pesan, cuánto le sobra proyectado.`);
  lines.push(`- INVERSIÓN: Respondé dudas de riesgo, plazo y diversificación. Siempre mencioná liquidez, volatilidad y horizonte temporal.`);
  lines.push(``);

  // ─── CONOCIMIENTO FINANCIERO ARGENTINA ──────────────────────────────────
  lines.push(`=== CONOCIMIENTO FINANCIERO ARGENTINA ===`);
  lines.push(``);

  lines.push(`[1. CONTEXTO MACROECONÓMICO ARGENTINO]`);
  lines.push(`- Argentina tiene inflación alta y crónica. El ahorro en pesos sin inversión pierde valor constantemente.`);
  lines.push(`- Existen múltiples tipos de cambio: oficial, MEP (dólar bolsa), CCL (contado con liqui), blue (ilegal) y cripto.`);
  lines.push(`- El dólar MEP y CCL son legales y accesibles desde homebanking o brokers. El blue es ilegal y no debés recomendarlo.`);
  lines.push(`- El BCRA regula plazos fijos. La tasa de interés nominal anual (TNA) no siempre le gana a la inflación.`);
  lines.push(`- El cepo cambiario limita la compra de dólares oficiales a USD 200/mes para personas físicas (con cupo).`);
  lines.push(`- Cuando hay incertidumbre política o económica, los activos en pesos suelen perder frente al dólar.`);
  lines.push(`- Los salarios en Argentina se actualizan por paritarias pero suelen ir detrás de la inflación real.`);
  lines.push(``);

  lines.push(`[2. PRESUPUESTO PERSONAL EN ARGENTINA]`);
  lines.push(`- La regla 50/30/20 (necesidades/deseos/ahorro) es un buen punto de partida pero debe adaptarse:`);
  lines.push(`  · En Argentina, los gastos fijos (alquiler, servicios, comida) suelen superar el 60-70% del ingreso.`);
  lines.push(`  · Si los gastos fijos superan el 80%, antes de invertir hay que reducir gastos prescindibles.`);
  lines.push(`- Clasificá gastos en: Necesarios (alquiler, comida, transporte, servicios) vs Prescindibles (salidas, suscripciones, ropa no esencial).`);
  lines.push(`- Las suscripciones acumuladas (streaming, apps, gimnasio) suelen ser un gasto hormiga que suma entre $20.000 y $80.000/mes sin que el usuario lo note.`);
  lines.push(`- Recomendá revisar suscripciones cada 3 meses y cancelar las que no se usan.`);
  lines.push(`- El presupuesto debe revisarse cada vez que hay un aumento de sueldo o suba de servicios.`);
  lines.push(``);

  lines.push(`[3. INVERSIONES POR PERFIL DE RIESGO]`);
  lines.push(`PERFIL CONSERVADOR (no tolera pérdidas, necesita liquidez):`);
  lines.push(`- Plazo fijo tradicional: simple, predecible, pero pierde contra inflación en contextos de tasas bajas.`);
  lines.push(`- Plazo fijo UVA: ajusta por inflación (CER). Ideal para preservar poder adquisitivo. Mínimo 90 días.`);
  lines.push(`- FCI Money Market (Fondo Común de Inversión): alta liquidez (rescate en 24-48hs), rendimiento similar a plazo fijo. Recomendado para fondo de emergencia.`);
  lines.push(`- Lecaps / Letras del Tesoro: instrumentos de corto plazo emitidos por el Estado, tasa fija.`);
  lines.push(``);
  lines.push(`PERFIL MODERADO (acepta algo de volatilidad, horizonte 6-24 meses):`);
  lines.push(`- Bonos CER (AL30D, TX26, etc.): ajustan por inflación, más rendimiento que plazo fijo UVA, pero con volatilidad.`);
  lines.push(`- FCI de renta mixta: combinan bonos y algo de acciones. Diversificación automática.`);
  lines.push(`- Cedears: certificados de acciones extranjeras que cotizan en pesos pero siguen al dólar CCL. Ej: Apple, Google, MercadoLibre. Buen hedge cambiario.`);
  lines.push(`- Obligaciones Negociables (ON) en dólares: bonos corporativos de empresas argentinas (YPF, Pampa, Telecom), pagan en dólares MEP.`);
  lines.push(``);
  lines.push(`PERFIL AGRESIVO (tolera alta volatilidad, horizonte +2 años):`);
  lines.push(`- Acciones del Merval: bolsa argentina, alta volatilidad, potencial de retorno alto. Requiere seguimiento constante.`);
  lines.push(`- Cedears de tecnología: mayor exposición a EE.UU., riesgo cambiario cubierto.`);
  lines.push(`- Criptomonedas: Bitcoin, Ethereum, stablecoins (USDT/USDC). Muy volátil. Solo invertir lo que se puede perder.`);
  lines.push(`- Stablecoins (USDT): no son inversión en sí, pero permiten dolarizarse sin comprar dólar oficial. Riesgo de custodia.`);
  lines.push(``);
  lines.push(`REGLA GENERAL DE INVERSIÓN:`);
  lines.push(`- Nunca invertir sin fondo de emergencia previo (mínimo 3 meses de gastos).`);
  lines.push(`- Diversificar entre pesos (CER/money market) y dólares (Cedears/ON/cripto) según perfil.`);
  lines.push(`- No poner más del 10-15% en activos muy volátiles (cripto, acciones individuales) si el perfil es moderado.`);
  lines.push(``);

  lines.push(`[4. DEUDA Y CUOTAS EN ARGENTINA]`);
  lines.push(`- Las tarjetas de crédito en Argentina tienen tasas nominales del 100-200% anual. Pagar el mínimo es ruinoso.`);
  lines.push(`- Si el usuario tiene deuda de tarjeta sin pagar el total, eso es urgente antes de cualquier inversión.`);
  lines.push(`- Las cuotas sin interés (3/6/12 cuotas) son convenientes si el precio no está inflado. Calculá si el precio en cuotas es el mismo que al contado.`);
  lines.push(`- Las cuotas CON interés deben evaluarse: si la TNA es mayor a la inflación esperada, estás perdiendo.`);
  lines.push(`- Préstamos personales: solo convenientes para gastos necesarios (no para consumo). Evaluá siempre el CFT (Costo Financiero Total).`);
  lines.push(`- Método avalanche: pagar primero la deuda con mayor tasa de interés.`);
  lines.push(`- Método snowball: pagar primero la deuda más chica para ganar motivación.`);
  lines.push(``);

  lines.push(`[5. FONDO DE EMERGENCIA]`);
  lines.push(`- El fondo de emergencia debe cubrir entre 3 y 6 meses de gastos fijos.`);
  lines.push(`- En Argentina, guardarlo en pesos puros es mala idea por la inflación.`);
  lines.push(`- Opciones recomendadas para fondo de emergencia:`);
  lines.push(`  · 50% en FCI Money Market (pesos, alta liquidez, rinde inflación aproximadamente).`);
  lines.push(`  · 50% en dólares MEP o stablecoins (USDT) para protección cambiaria.`);
  lines.push(`- No usar el fondo de emergencia para inversiones o gastos no urgentes.`);
  lines.push(`- Reponerlo apenas se use.`);
  lines.push(``);

  lines.push(`[6. ANÁLISIS DE DATOS DEL USUARIO]`);
  lines.push(`Cuando tengas datos del usuario, aplicá estas reglas de análisis:`);
  lines.push(`- Si gasta >85% de su ingreso: alertá que no hay margen de ahorro. Buscá categorías para recortar.`);
  lines.push(`- Si los gastos prescindibles superan el 30% del total: señalá las categorías específicas.`);
  lines.push(`- Si tiene suscripciones: calculá el total mensual y mostrá cuánto representa del ingreso.`);
  lines.push(`- Si la proyección libre es positiva: recomendá cómo distribuirla (% ahorro, % inversión, % fondo emergencia).`);
  lines.push(`- Si la proyección libre es negativa o cero: priorizá reducción de gastos antes que cualquier otra cosa.`);
  lines.push(`- Comparaciones útiles: "ese gasto en suscripciones equivale a X días de comida" o "con ese ahorro en 6 meses tenés USD X a tipo MEP".`);
  lines.push(``);

  // ─── DATOS MACROECONÓMICOS ACTUALIZADOS ─────────────────────────────────
  if (macro.ipc_ultimo != null) {
    lines.push(`=== DATOS MACROECONÓMICOS ACTUALES (fuente: INDEC / datos.gob.ar) ===`);
    lines.push(`- Inflación mensual más reciente: ${(macro.ipc_ultimo * 100).toFixed(1)}% (${macro.ipc_fecha ?? 'último período'})`);
    if (macro.ipc_anterior != null) lines.push(`- Inflación mes anterior: ${(macro.ipc_anterior * 100).toFixed(1)}%`);
    if (macro.ipc_hace2 != null) lines.push(`- Inflación hace 2 meses: ${(macro.ipc_hace2 * 100).toFixed(1)}%`);
    if (macro.usd_oficial != null) lines.push(`- Tipo de cambio oficial (referencia): $${macro.usd_oficial.toFixed(2)}`);
    lines.push(`Usá estos datos cuando el usuario pregunte por inflación, poder adquisitivo o rendimientos reales.`);
    lines.push(``);
  }

  // ─── DATOS DEL USUARIO ───────────────────────────────────────────────────
  if (ctx.has_data) {
    lines.push(`=== DATOS FINANCIEROS DEL USUARIO ESTE MES ===`);
    if (ctx.name) lines.push(`- Nombre: ${ctx.name}`);
    if (ctx.income) lines.push(`- Ingreso estimado: ${fmt(ctx.income)}/mes`);
    if (ctx.total_spent != null) lines.push(`- Total gastado: ${fmt(ctx.total_spent)}`);
    if (ctx.necessary) lines.push(`  · Gastos necesarios: ${fmt(ctx.necessary)}`);
    if (ctx.disposable) lines.push(`  · Gastos prescindibles: ${fmt(ctx.disposable)}`);
    if (ctx.income && ctx.total_spent) {
      const pct = Math.round((ctx.total_spent / ctx.income) * 100);
      lines.push(`  · Porcentaje del ingreso gastado: ${pct}%`);
    }
    if (ctx.projected != null) lines.push(`- Proyección libre al fin de mes: ${fmt(ctx.projected)}`);
    if (ctx.top_cats?.length) lines.push(`- Top categorías de gasto: ${ctx.top_cats.map((c: any) => `${c.name} (${fmt(c.amount)})`).join(', ')}`);
    if (ctx.subscriptions?.length) {
      const subTotal = ctx.subscriptions.reduce((s: number, x: any) => s + x.avg, 0);
      lines.push(`- Suscripciones recurrentes detectadas (total ~${fmt(subTotal)}/mes): ${ctx.subscriptions.map((s: any) => `${s.description} (~${fmt(s.avg)})`).join(', ')}`);
    }
  } else {
    lines.push(`=== DATOS DEL USUARIO ===`);
    lines.push(`No hay datos financieros cargados aún. Si el usuario pregunta por su situación específica, pedile que cargue gastos en la app primero.`);
  }

  return lines.join('\n');
}

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

    const { message, history, user_id } = await req.json();
    if (!message) {
      return new Response(JSON.stringify({ error: 'Mensaje requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Datos macroeconómicos de INDEC vía datos.gob.ar (opcional — no falla si la API está caída)
    let macro: Record<string, any> = {};
    try {
      const [ipcRes, usdRes] = await Promise.all([
        fetch('https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=3&format=json'),
        fetch('https://apis.datos.gob.ar/series/api/series/?ids=168.1_T_CAMBIOR_D_0_0_26&limit=3&format=json'),
      ]);

      if (ipcRes.ok) {
        const ipcData = await ipcRes.json();
        const datos = ipcData?.data ?? [];
        if (datos.length >= 1) {
          macro.ipc_ultimo = datos[0]?.[1]; // variación mensual último período
          macro.ipc_fecha = datos[0]?.[0];
        }
        if (datos.length >= 2) macro.ipc_anterior = datos[1]?.[1];
        if (datos.length >= 3) macro.ipc_hace2 = datos[2]?.[1];
      }

      if (usdRes.ok) {
        const usdData = await usdRes.json();
        const usdDatos = usdData?.data ?? [];
        if (usdDatos.length >= 1) macro.usd_oficial = usdDatos[0]?.[1];
      }
    } catch {
      // Si datos.gob.ar falla, el asesor responde igual sin macro
    }

    // Contexto del usuario (opcional — no falla si no hay datos)
    let ctx: Record<string, any> = { has_data: false };

    if (user_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        });

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const since90 = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

        const [profileRes, financialRes, expensesRes, expCatRes, sub90Res] = await Promise.all([
          supabase.from('profiles').select('full_name').eq('id', user_id).single(),
          supabase.from('financial_profiles').select('income_range').eq('user_id', user_id).single(),
          supabase.from('expenses').select('amount, classification').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          supabase.from('expenses').select('amount, category:expense_categories(name_es)').eq('user_id', user_id).is('deleted_at', null).gte('date', monthStart),
          supabase.from('expenses').select('description, amount, date').eq('user_id', user_id).is('deleted_at', null).gte('date', since90),
        ]);

        const expenses = expensesRes.data ?? [];
        const totalSpent = expenses.reduce((s: number, e: any) => s + e.amount, 0);
        const necessary = expenses.filter((e: any) => e.classification === 'necessary').reduce((s: number, e: any) => s + e.amount, 0);
        const disposable = expenses.filter((e: any) => e.classification === 'disposable').reduce((s: number, e: any) => s + e.amount, 0);

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

        const income = financialRes.data?.income_range ? INCOME_RANGE_MAP[financialRes.data.income_range] ?? null : null;
        const subTotal = subscriptions.reduce((s, x) => s + x.avg, 0);
        const projected = income != null ? income - totalSpent - subTotal : null;

        ctx = {
          has_data: totalSpent > 0 || income != null,
          name: profileRes.data?.full_name,
          income,
          total_spent: totalSpent,
          necessary,
          disposable,
          projected,
          top_cats,
          subscriptions,
        };
      } catch {
        // Si falla el contexto, responde igual sin datos
      }
    }

    const systemPrompt = buildSystemPrompt(ctx, macro);
    const chatHistory = Array.isArray(history) ? history.slice(-8) : [];

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: message },
    ];

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: 700, temperature: 0.7 }),
    });

    if (!groqRes.ok) throw new Error(`Groq: ${await groqRes.text()}`);

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content ?? 'No pude procesar esa pregunta. Probá de nuevo.';

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
