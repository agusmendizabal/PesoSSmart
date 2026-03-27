// ============================================================
// SmartPesos — Edge Function: process-screenshot
// Usa Groq Vision para extraer gastos de un screenshot
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { image_base64, image_type, user_id } = await req.json();
    if (!image_base64 || !user_id) {
      return new Response(JSON.stringify({ error: 'Parámetros incompletos' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Subir imagen a Supabase Storage para obtener URL pública
    const ext = image_type?.includes('png') ? 'png' : 'jpg';
    const filename = `${user_id}/${Date.now()}.${ext}`;
    const imageBytes = Uint8Array.from(atob(image_base64), c => c.charCodeAt(0));

    const { error: uploadError } = await supabaseAdmin.storage
      .from('expense-receipts')
      .upload(filename, imageBytes, { contentType: image_type ?? 'image/jpeg', upsert: true });

    if (uploadError) throw new Error(`Upload error: ${uploadError.message}`);

    // Obtener URL firmada (válida por 5 minutos)
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from('expense-receipts')
      .createSignedUrl(filename, 300);

    if (signedError || !signedData?.signedUrl) throw new Error('No se pudo obtener URL firmada');

    const imageUrl = signedData.signedUrl;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const prompt = `Analizá este screenshot de una billetera virtual o banco argentino (Mercado Pago, Ualá, Brubank, etc).

Extraé TODOS los movimientos de dinero visibles. Cada fila con un monto es un movimiento.

Para CADA movimiento encontrado devolvé:
- description: nombre del comercio o persona (ej: "Campus", "Ignacio Sojo", "Netflix")
- amount: monto positivo sin símbolos ni puntos de miles (ej: $14.000 → 14000, $1.000 → 1000)
- date: en formato YYYY-MM-DD. "hoy" = ${today}, "ayer" = ${yesterday}. Si dice "26 de marzo" = ${new Date().getFullYear()}-03-26
- classification: "necessary" (super, farmacia, transporte, servicios), "disposable" (restaurante, ropa, entretenimiento), "investable" (transferencia a ahorro, inversión)
- category: groceries, food_dining, transport, health, entertainment, clothing, education, home, technology, subscriptions, travel, other

Respondé SOLO con JSON, sin texto adicional:
{"expenses":[{"description":"Campus","amount":14000,"date":"${today}","classification":"disposable","category":"other"}]}

Si no hay movimientos: {"expenses":[]}`;

    const groqResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.2-90b-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    const groqData = await groqResponse.json();
    const content = groqData.choices?.[0]?.message?.content;

    console.log('[process-screenshot] Response:', JSON.stringify(groqData));

    if (!content) {
      return new Response(JSON.stringify({
        expenses: [],
        debug: `Sin contenido del modelo. finish_reason: ${groqData.choices?.[0]?.finish_reason}, error: ${JSON.stringify(groqData.error)}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return new Response(JSON.stringify({ expenses: [], debug: content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Limpiar imagen temporal
    await supabaseAdmin.storage.from('expense-receipts').remove([filename]);

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
