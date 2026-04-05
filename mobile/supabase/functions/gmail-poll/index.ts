import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SENDER_DOMAINS = [
  'mercadopago.com',
  'mercadolibre.com',
  'naranjax.com',
  'galicia.com.ar',
  'bbva.com.ar',
  'brubank.com',
  'uala.com.ar',
  'santander.com.ar',
  'icbc.com.ar',
  'hsbc.com.ar',
  'macro.com.ar',
  'supervielle.com.ar',
  'lemon.me',
  'personal-pay.com.ar',
  'modo.com.ar',
  'bancocredicoop.com.ar',
  'bancogalicia.com.ar',
  'bancociudad.com.ar',
  'bancosantacruz.com.ar',
  'getnet.com.ar',
  'prismamediosdepago.com',
];

const SUBJECT_KEYWORDS = [
  'compraste', 'pagaste', 'transferiste', 'débito', 'consumo',
  'aprobado', 'realizada', 'debitó', 'acreditó', 'operación',
  'pago', 'compra', 'movimiento', 'transaccion', 'transacción',
  'realizaste', 'efectuaste', 'gastaste', 'cargo',
  'transferencia', 'enviada', 'enviado', 'acreditada', 'acreditado',
];

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[gmail-poll] refreshAccessToken failed:', errText);
      return null;
    }
    const data = await res.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error('[gmail-poll] refreshAccessToken exception:', err);
    return null;
  }
}

function decodeBase64Url(data: string): string {
  return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTextFromEmail(payload: any): string {
  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  function traverse(part: any) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plainParts.push(decodeBase64Url(part.body.data));
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlParts.push(stripHtml(decodeBase64Url(part.body.data)));
    }
    if (part.parts) part.parts.forEach(traverse);
  }

  traverse(payload);

  if (plainParts.length > 0) return plainParts.join('\n').slice(0, 2000);
  if (htmlParts.length > 0) return htmlParts.join('\n').slice(0, 2000);
  if (payload?.body?.data) return decodeBase64Url(payload.body.data).slice(0, 2000);
  return '';
}

async function classifyWithGroq(subject: string, body: string): Promise<any | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) {
    console.error('[gmail-poll] GROQ_API_KEY no configurada');
    return null;
  }

  // PROMPT CORREGIDO: incluye transferencias explícitamente
  const prompt = `Analizá este email bancario argentino. Puede ser una compra, un pago con tarjeta O una transferencia enviada. Todos son movimientos de dinero saliente válidos.
Respondé ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.

Asunto: ${subject}
Contenido: ${body}

REGLAS:
- Si hay un monto de dinero que SALIÓ de la cuenta (compra, pago, transferencia enviada), es un movimiento válido → es_movimiento: true
- Para transferencias, usá el nombre del destinatario como "comercio"
- Para compras, usá el nombre del comercio
- Si el email es solo una notificación informativa sin monto claro, → es_movimiento: false

Formato exacto de respuesta:
{
  "es_movimiento": true,
  "monto": 52.55,
  "moneda": "ARS",
  "comercio": "Franco Alfredo Ballerini",
  "categoria": "otros",
  "fecha": "2026-04-02",
  "descripcion": "Transferencia enviada a Franco Alfredo Ballerini"
}

Categorías válidas: comida, transporte, servicios, entretenimiento, salud, ropa, hogar, educacion, otros
Si no hay monto saliente claro, respondé: { "es_movimiento": false }`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[gmail-poll] Groq API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    console.log('[gmail-poll] Groq raw response:', content);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[gmail-poll] Groq no devolvió JSON válido:', content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('[gmail-poll] Groq parsed:', JSON.stringify(parsed));
    return parsed;
  } catch (err) {
    console.error('[gmail-poll] classifyWithGroq exception:', err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[gmail-poll] Sin Authorization header');
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validar usuario llamando directamente al endpoint REST de Supabase Auth
    const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
      },
    });

    if (!authRes.ok) {
      const errText = await authRes.text();
      console.error('[gmail-poll] Auth falló — status:', authRes.status, '| body:', errText, '| authHeader prefix:', authHeader?.slice(0, 30));
      return new Response(JSON.stringify({ error: 'No autorizado', detail: errText }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authData = await authRes.json();
    const userId: string = authData.id;
    console.log('[gmail-poll] Usuario:', userId);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: connection, error: connError } = await supabase
      .from('gmail_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      console.log('[gmail-poll] Sin conexión Gmail para usuario:', userId, connError);
      return new Response(JSON.stringify({ pending: [], gmail_connected: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[gmail-poll] Gmail conectado:', connection.gmail_email, '| last_checked_at:', connection.last_checked_at);

    // Intentar con el token guardado; si falla con 401 hacemos refresh
    let googleToken = connection.access_token;
    const testRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );
    console.log('[gmail-poll] Google token probe status:', testRes.status);

    if (testRes.status === 401) {
      console.log('[gmail-poll] Token vencido, refrescando...');
      if (!connection.refresh_token) {
        console.error('[gmail-poll] Sin refresh_token almacenado');
        return new Response(JSON.stringify({ error: 'Token de Gmail expirado. Reconectá tu cuenta.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const newToken = await refreshAccessToken(connection.refresh_token);
      if (!newToken) {
        return new Response(JSON.stringify({ error: 'Token de Gmail expirado. Reconectá tu cuenta.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      googleToken = newToken;
      const { error: tokenUpdateErr } = await supabase.from('gmail_connections')
        .update({ access_token: googleToken })
        .eq('user_id', userId);
      if (tokenUpdateErr) {
        console.error('[gmail-poll] Error guardando token renovado:', tokenUpdateErr);
      } else {
        console.log('[gmail-poll] Token de Google refrescado OK');
      }
    } else if (!testRes.ok) {
      const probeErr = await testRes.text();
      console.error('[gmail-poll] Google token probe inesperado:', testRes.status, probeErr);
    }

    const newAccessToken = googleToken;

    // Usar timestamp exacto en la query: buscar últimas 48h para no perder nada
    const since = new Date(connection.last_checked_at);
    const sinceTs = Math.floor(since.getTime() / 1000); // Unix timestamp en segundos
    const gmailQuery = `(pago OR compra OR transferencia OR debito OR consumo OR pagaste OR compraste) after:${sinceTs}`;

    console.log('[gmail-poll] Gmail query:', gmailQuery);

    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${newAccessToken}` } },
    );

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error('[gmail-poll] Gmail search failed:', searchRes.status, errText);
      throw new Error(`Gmail search failed: ${errText}`);
    }

    const searchData = await searchRes.json();
    const messages = searchData.messages ?? [];
    console.log('[gmail-poll] Mensajes encontrados en Gmail:', messages.length);

    let newPending = 0;
    let hadGroqFailure = false;

    for (const msg of messages) {
      const { data: existing } = await supabase
        .from('pending_transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('raw_subject', msg.id)
        .single();

      if (existing) {
        console.log('[gmail-poll] Ya procesado:', msg.id);
        continue;
      }

      const emailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${newAccessToken}` } },
      );
      if (!emailRes.ok) {
        console.error('[gmail-poll] No se pudo descargar email:', msg.id, emailRes.status);
        continue;
      }

      const emailData = await emailRes.json();
      const headers = emailData.payload?.headers ?? [];
      const subject = headers.find((h: any) => h.name === 'Subject')?.value ?? '';
      const from = headers.find((h: any) => h.name === 'From')?.value ?? '';

      console.log('[gmail-poll] Procesando email | from:', from, '| subject:', subject);

      const fromLower = from.toLowerCase();
      const isKnownSender = SENDER_DOMAINS.some(d => fromLower.includes(d));
      if (!isKnownSender) {
        console.log('[gmail-poll] Remitente ignorado:', from);
        continue;
      }

      const subjectLower = subject.toLowerCase();
      const isRelevant = SUBJECT_KEYWORDS.some(k => subjectLower.includes(k));
      if (!isRelevant) {
        console.log('[gmail-poll] Subject no relevante:', subject);
        continue;
      }

      const body = extractTextFromEmail(emailData.payload);
      if (!body.trim()) {
        console.log('[gmail-poll] Body vacío para:', subject);
        continue;
      }

      console.log('[gmail-poll] Body extraído (primeros 200 chars):', body.slice(0, 200));

      const result = await classifyWithGroq(subject, body);

      // Soportar tanto "es_gasto" (viejo) como "es_movimiento" (nuevo)
      const esValido = result?.es_movimiento === true || result?.es_gasto === true;
      if (!esValido) {
        if (result === null) {
          hadGroqFailure = true;
          console.warn('[gmail-poll] Groq falló (API error) para:', subject, '— se reintentará en el próximo poll');
        } else {
          console.log('[gmail-poll] Groq descartó el email como no-movimiento:', subject);
        }
        continue;
      }

      const { error: insertError } = await supabase.from('pending_transactions').upsert({
        user_id: userId,
        source: 'gmail',
        amount: result.monto,
        currency: result.moneda ?? 'ARS',
        merchant: result.comercio,
        suggested_category: result.categoria,
        description: result.descripcion,
        transaction_date: result.fecha ?? new Date().toISOString().split('T')[0],
        raw_subject: msg.id,
        status: 'pending',
      }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });

      if (insertError) {
        console.error('[gmail-poll] Error al insertar pending_transaction:', insertError);
      } else {
        console.log('[gmail-poll] Guardado OK:', result.comercio, result.monto);
        newPending++;
      }
    }

    // Solo avanzar last_checked_at si Groq no tuvo fallos — así los emails fallidos se reintentan
    if (!hadGroqFailure) {
      await supabase.from('gmail_connections')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('user_id', userId);
      console.log('[gmail-poll] last_checked_at avanzado a now()');
    } else {
      console.warn('[gmail-poll] Groq tuvo fallos — last_checked_at NO avanzado para reintentar en el próximo poll');
    }

    console.log('[gmail-poll] Nuevos pendientes:', newPending);

    const { data: pendingList } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return new Response(JSON.stringify({
      gmail_connected: true,
      gmail_email: connection.gmail_email,
      new_found: newPending,
      pending: pendingList ?? [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[gmail-poll] Error general:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
