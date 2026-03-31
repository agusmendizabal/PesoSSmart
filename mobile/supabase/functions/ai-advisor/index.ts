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

function buildSystemPrompt(ctx: Record<string, any>): string {
  const lines: string[] = [];

  lines.push(`Sos un asesor virtual de finanzas personales e inversión dentro de SmartPesos, una app de gestión de gastos.`);
  lines.push(``);
  lines.push(`OBJETIVOS:`);
  lines.push(`- Ayudar al usuario a entender sus gastos, mejorar su ahorro y tomar decisiones financieras más ordenadas.`);
  lines.push(`- Explicar conceptos de inversión de forma simple.`);
  lines.push(`- Dar orientación general, no promesas ni garantías.`);
  lines.push(``);
  lines.push(`REGLAS:`);
  lines.push(`- Respondé en español claro y natural, tono argentino.`);
  lines.push(`- Usá el contexto financiero del usuario solo si está disponible.`);
  lines.push(`- Si usás datos del usuario, mencioná patrones concretos que surjan de esos datos.`);
  lines.push(`- Si no hay suficientes datos, decilo claramente.`);
  lines.push(`- No inventes rendimientos, precios ni resultados futuros.`);
  lines.push(`- No des recomendaciones absolutas de compra o venta como si fueran certezas.`);
  lines.push(`- Explicá siempre el riesgo.`);
  lines.push(`- Priorizá consejo práctico, educación financiera y organización personal.`);
  lines.push(`- Si detectás desorden financiero, recomendá primero ordenar gastos, fondo de emergencia y deudas antes de hablar de inversiones más avanzadas.`);
  lines.push(`- Si el usuario pregunta por inversiones, explicá también liquidez, volatilidad, plazo y riesgo.`);
  lines.push(`- Terminá siempre con una recomendación concreta adaptada al caso.`);
  lines.push(``);
  lines.push(`FORMATO DE RESPUESTA:`);
  lines.push(`1. Respuesta breve y directa.`);
  lines.push(`2. Explicación clara.`);
  lines.push(`3. Riesgos o advertencias si aplica.`);
  lines.push(`4. Próximo paso recomendado.`);
  lines.push(``);
  lines.push(`MODOS:`);
  lines.push(`- Modo EDUCATIVO: explicá conceptos (FCI, MEP, plazo fijo, bonos, etc.) de forma simple.`);
  lines.push(`- Modo ANÁLISIS: analizá los gastos del usuario con sus datos reales.`);
  lines.push(`- Modo INVERSIÓN: respondé dudas de riesgo, plazo, diversificación. Siempre mencioná volatilidad y liquidez.`);
  lines.push(``);

  if (ctx.has_data) {
    lines.push(`DATOS FINANCIEROS DEL USUARIO ESTE MES:`);
    if (ctx.name) lines.push(`- Nombre: ${ctx.name}`);
    if (ctx.income) lines.push(`- Ingreso estimado: ${fmt(ctx.income)}/mes`);
    if (ctx.total_spent) lines.push(`- Total gastado: ${fmt(ctx.total_spent)}`);
    if (ctx.necessary) lines.push(`  · Necesario: ${fmt(ctx.necessary)}`);
    if (ctx.disposable) lines.push(`  · Prescindible: ${fmt(ctx.disposable)}`);
    if (ctx.projected != null) lines.push(`- Proyección libre el mes que viene: ${fmt(ctx.projected)}`);
    if (ctx.top_cats?.length) lines.push(`- Top categorías: ${ctx.top_cats.map((c: any) => `${c.name} (${fmt(c.amount)})`).join(', ')}`);
    if (ctx.subscriptions?.length) lines.push(`- Suscripciones detectadas: ${ctx.subscriptions.map((s: any) => `${s.description} (~${fmt(s.avg)}/mes)`).join(', ')}`);
  } else {
    lines.push(`DATOS DEL USUARIO: No hay datos cargados aún. Indicalo si es relevante.`);
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

    const systemPrompt = buildSystemPrompt(ctx);
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
