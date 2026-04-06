// ============================================================
// SmartPesos — Edge Function: process-screenshot
// Paso 1: Vision extrae texto crudo
// Paso 2: Texto clasifica y parsea los gastos
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function callGroq(body: object, groqApiKey: string) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
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
    // Validar JWT contra Supabase Auth (no solo verificar que el header existe)
    const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
    });
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'JWT inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { image_base64, image_type } = await req.json();
    if (!image_base64) {
      return new Response(JSON.stringify({ error: 'Imagen requerida' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mimeType = image_type ?? 'image/jpeg';
    const imageUrl = `data:${mimeType};base64,${image_base64}`;

    // ── PASO 1: Extraer texto crudo con visión ──────────────────
    const ocrData = await callGroq({
      model: 'llama-3.2-11b-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: 'Transcribe all the text you see in this image exactly as it appears. Include all names, amounts, and dates. Output only the raw text, nothing else.' },
        ],
      }],
      max_tokens: 1000,
      temperature: 0,
    }, groqApiKey);

    const rawText = ocrData.choices?.[0]?.message?.content;

    if (!rawText || rawText.trim().length < 5) {
      return new Response(JSON.stringify({
        expenses: [],
        debug: `OCR sin texto. Respuesta del modelo: ${JSON.stringify(ocrData.error ?? ocrData.choices)}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── PASO 2: Parsear y clasificar con modelo de texto ────────
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();

    const parseData = await callGroq({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Este es texto extraído de una app de pagos argentina (Mercado Pago, Ualá, etc):

---
${rawText}
---

Extraé todos los gastos (montos negativos, "Transferencia enviada", "Pago en tienda"). Ignorá ingresos.

Respondé SOLO con este JSON:
{"expenses":[{"description":"Campus","amount":14000,"date":"${today}","classification":"disposable","category":"food_dining"}]}

Reglas:
- amount: número positivo sin puntos ni comas ($14.000 → 14000, $32.097 → 32097, $10.215,64 → 10215)
- date: formato YYYY-MM-DD ("28 de marzo" → ${currentYear}-03-28, "28/mar" → ${currentYear}-03-28, "hoy" → ${today}, "ayer" → ${yesterday})
- classification: "necessary" (super, farmacia, transporte, servicios) o "disposable" (restaurant, ropa, entretenimiento) o "investable" (ahorro)
- category: groceries, food_dining, transport, health, entertainment, clothing, home, technology, subscriptions, o other

Solo JSON, sin texto extra. Si no hay gastos: {"expenses":[]}`,
      }],
      max_tokens: 2000,
      temperature: 0.1,
    }, groqApiKey);

    const content = parseData.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({
        expenses: [],
        debug: `Texto extraído: "${rawText.substring(0, 200)}" — Error en clasificación: ${JSON.stringify(parseData.error)}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return new Response(JSON.stringify({ expenses: [], debug: `Texto OCR: "${rawText.substring(0, 100)}" | Respuesta parser: ${content}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[process-screenshot] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), expenses: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
