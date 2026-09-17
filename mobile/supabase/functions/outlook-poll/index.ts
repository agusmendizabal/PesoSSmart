import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ALL_SENDER_DOMAINS, detectBank } from '../_shared/bankDetector.ts';
import { parseEmailFields, buildPreParsedContext } from '../_shared/bankParsers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROQ_API_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const MS_AUTH_BASE  = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE    = 'https://graph.microsoft.com/v1.0/me';
const GRAPH_SCOPES  = 'https://graph.microsoft.com/Mail.Read offline_access';

const SUBJECT_KEYWORDS = [
  'compraste', 'pagaste', 'transferiste', 'realizaste', 'efectuaste', 'gastaste',
  'débito', 'debito', 'consumo', 'cargo', 'debitó', 'acreditó',
  'acreditada', 'acreditado', 'acreditacion', 'acreditación',
  'aprobado', 'realizada', 'operación', 'operacion', 'movimiento',
  'pago', 'compra', 'transaccion', 'transacción', 'transferencia',
  'enviada', 'enviado', 'recibida', 'recibido',
  'aviso', 'fondos', 'notificacion', 'notificación',
];

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function decryptToken(encryptedToken: string): Promise<string> {
  if (!encryptedToken.startsWith('v1:')) return encryptedToken;
  const rawKey = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes  = new TextEncoder().encode(rawKey.slice(0, 32));
  const key       = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined  = Uint8Array.from(atob(encryptedToken.slice(3)), c => c.charCodeAt(0));
  const iv        = combined.slice(0, 12);
  const data      = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function encryptToken(token: string): Promise<string> {
  const rawKey    = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes  = new TextEncoder().encode(rawKey.slice(0, 32));
  const key       = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined  = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return 'v1:' + btoa(String.fromCharCode(...combined));
}

// ── Microsoft token refresh ───────────────────────────────────────────────────

async function refreshMsToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${MS_AUTH_BASE}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     Deno.env.get('MICROSOFT_CLIENT_ID')!,
        client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
        scope:         GRAPH_SCOPES,
      }),
    });
    if (!res.ok) { console.error('[outlook-poll] refreshMsToken failed:', await res.text()); return null; }
    const data = await res.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error('[outlook-poll] refreshMsToken exception:', err);
    return null;
  }
}

// ── Merchant helpers ──────────────────────────────────────────────────────────

function cleanMerchant(raw: string): string {
  return raw.replace(/@\S*/g, '').replace(/#\S*/g, '').replace(/[*|_\\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function normalizeMerchant(name: string): string {
  return name
    .toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?l?|s\.?r\.?l\.?|s\.?a\.?s\.?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Groq classification ───────────────────────────────────────────────────────

async function classifyWithGroq(subject: string, body: string, preParsedContext: string): Promise<any | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) return null;

  const contextSection = preParsedContext ? `\n${preParsedContext}\n` : '';
  const prompt = `Analizá este email financiero argentino. Puede ser una compra, pago con tarjeta, transferencia enviada o recibida.
Respondé ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.
${contextSection}
Asunto: ${subject}
Contenido: ${body}

REGLAS:
- Si hay un monto de dinero que SALIÓ de la cuenta → es_movimiento: true
- Si la transferencia es entre cuentas PROPIAS del mismo usuario → es_movimiento: false
- Si el email es solo informativo sin monto claro → es_movimiento: false
clasificacion: "necessary" | "disposable" | "investable"
Formato exacto: { "es_movimiento": true, "monto": 350000, "moneda": "ARS", "comercio": "nombre", "categoria": "comida", "clasificacion": "disposable", "fecha": "2026-04-08", "descripcion": "McDonald's" }
CATEGORÍAS: comida, cafe, transporte, servicios, entretenimiento, salud, ropa, hogar, educacion, deporte, peluqueria, seguros, otros
Si no hay monto saliente claro, respondé: { "es_movimiento": false }`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body:    JSON.stringify({
        model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.1,
      }),
    });
    if (!res.ok) { console.error('[outlook-poll] Groq API error:', res.status); return null; }
    const data     = await res.json();
    const content  = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[outlook-poll] classifyWithGroq exception:', err);
    return null;
  }
}

// ── Category map ──────────────────────────────────────────────────────────────

const CATEGORY_NAME_MAP: Record<string, string> = {
  cafe: 'cafe', peluqueria: 'beauty_salon', deporte: 'sports', seguros: 'insurance',
  comida: 'food_dining', transporte: 'transport', salud: 'health', ropa: 'clothing',
  hogar: 'home', educacion: 'education', entretenimiento: 'entertainment', otros: 'other',
};

const GENERIC_NAMES = new Set([
  'varios', 'varios comercios', 'desconocido', 'compra', 'pago', 'transferencia', 'movimiento',
]);

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let userId: string;

    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    const isCronCall     = internalSecret && authHeader === `Bearer ${internalSecret}`;

    if (isCronCall) {
      let body: any = {};
      try { body = await req.json(); } catch { /* body vacío OK */ }
      if (!body?.userId) {
        return new Response(JSON.stringify({ error: 'userId requerido para llamadas internas' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = body.userId;
    } else {
      const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! },
      });
      if (!authRes.ok) {
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = (await authRes.json()).id;
    }

    console.log('[outlook-poll] Usuario:', userId);

    const { data: connection } = await supabase
      .from('outlook_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ outlook_connected: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Descifrar y validar token
    let msToken: string;
    let refreshTokenDecrypted: string;
    try {
      msToken               = await decryptToken(connection.access_token);
      refreshTokenDecrypted = await decryptToken(connection.refresh_token);
    } catch (err) {
      console.error('[outlook-poll] Error desencriptando tokens:', err);
      return new Response(JSON.stringify({ error: 'Error de configuración. Reconectá Outlook.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Probar token con /me/mailFolders
    const testRes = await fetch(`${GRAPH_BASE}/mailFolders?$top=1`, {
      headers: { Authorization: `Bearer ${msToken}` },
    });

    if (testRes.status === 401) {
      const newToken = await refreshMsToken(refreshTokenDecrypted);
      if (!newToken) {
        await supabase.from('outlook_connections').update({ token_expired: true }).eq('user_id', userId);
        return new Response(JSON.stringify({ error: 'Token de Outlook expirado. Reconectá tu cuenta.', code: 'OUTLOOK_TOKEN_EXPIRED' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      msToken = newToken;
      await supabase.from('outlook_connections')
        .update({ access_token: await encryptToken(msToken) })
        .eq('user_id', userId);
    }

    // ── Determinar rango de búsqueda ─────────────────────────────────────
    const isBackfill = !connection.is_backfill_done;
    let filter: string;
    let top: number;

    if (isBackfill) {
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      filter = `receivedDateTime ge ${sixMonthsAgo}`;
      top    = 500;
      console.log('[outlook-poll] BACKFILL: últimos 6 meses');
    } else {
      filter = `receivedDateTime ge ${new Date(connection.last_checked_at).toISOString()}`;
      top    = 100;
    }

    // ── Buscar mensajes en Graph API ──────────────────────────────────────
    const searchKeywords = 'compra pago transferencia debito consumo acreditacion';
    const searchRes = await fetch(
      `${GRAPH_BASE}/messages?$search="${encodeURIComponent(searchKeywords)}"&$top=${top}&$select=id,subject,from,receivedDateTime,body&$filter=${encodeURIComponent(filter)}`,
      { headers: { Authorization: `Bearer ${msToken}`, ConsistencyLevel: 'eventual' } },
    );

    if (!searchRes.ok) {
      // Graph requiere ConsistencyLevel para $search + $filter — intentar sin $filter
      const searchRes2 = await fetch(
        `${GRAPH_BASE}/messages?$search="${encodeURIComponent(searchKeywords)}"&$top=${top}&$select=id,subject,from,receivedDateTime,body`,
        { headers: { Authorization: `Bearer ${msToken}`, ConsistencyLevel: 'eventual' } },
      );
      if (!searchRes2.ok) {
        console.error('[outlook-poll] Graph search failed:', searchRes2.status, await searchRes2.text());
        return new Response(JSON.stringify({ error: 'Error buscando emails en Outlook' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const d = await searchRes2.json();
      var messages = d.value ?? [];
    } else {
      const d = await searchRes.json();
      var messages = d.value ?? [];
    }

    console.log('[outlook-poll] Mensajes encontrados:', messages.length);

    let newPending     = 0;
    let hadGroqFailure = false;

    for (const msg of messages) {
      const rawSubject = `outlook_${msg.id}`;

      const { data: existing } = await supabase
        .from('pending_transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('raw_subject', rawSubject)
        .single();

      if (existing) continue;

      const subject   = msg.subject ?? '';
      const from      = msg.from?.emailAddress?.address ?? '';
      const bodyText  = msg.body?.content
        ? (msg.body.contentType === 'html'
            ? msg.body.content.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
            : msg.body.content)
        : '';

      const fromLower     = from.toLowerCase();
      const isKnownSender = ALL_SENDER_DOMAINS.some(d => fromLower.includes(d));
      if (!isKnownSender) continue;

      const subjectLower = subject.toLowerCase();
      const isRelevant   = SUBJECT_KEYWORDS.some(k => subjectLower.includes(k));
      if (!isRelevant) continue;
      if (!bodyText.trim()) continue;

      const detection        = detectBank(from, subject, bodyText.slice(0, 3000));
      const preParsed        = parseEmailFields(detection.profile, subject, bodyText.slice(0, 3000));
      const preParsedContext = buildPreParsedContext(preParsed);

      // ── Incoming transfer ─────────────────────────────────────────────
      if (preParsed.operationType === 'transferencia_recibida' && preParsed.amount && preParsed.amount > 0) {
        const senderName = preParsed.senderName ?? null;
        await supabase.from('pending_transactions').upsert({
          user_id:          userId,
          source:           'outlook',
          direction:        'incoming',
          amount:           preParsed.amount,
          currency:         'ARS',
          merchant:         senderName ?? 'Transferencia recibida',
          sender_name:      senderName,
          transaction_date: preParsed.occurredAt ?? msg.receivedDateTime?.split('T')[0] ?? new Date().toISOString().split('T')[0],
          raw_subject:      rawSubject,
          status:           'pending',
        }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });
        newPending++;
        continue;
      }

      const result   = await classifyWithGroq(subject, bodyText.slice(0, 3000), preParsedContext);
      const esValido = result?.es_movimiento === true;
      if (!esValido) {
        if (result === null) { hadGroqFailure = true; }
        continue;
      }

      const finalAmount  = result.monto ?? preParsed.amount;
      const finalDate    = result.fecha ?? preParsed.occurredAt ?? msg.receivedDateTime?.split('T')[0] ?? new Date().toISOString().split('T')[0];
      const rawMerchant  = cleanMerchant(result.comercio ?? preParsed.recipientName ?? 'Desconocido');
      const finalMerchant = GENERIC_NAMES.has(rawMerchant.toLowerCase().trim())
        ? cleanMerchant(preParsed.recipientName ?? rawMerchant)
        : rawMerchant;
      const merchantNorm  = normalizeMerchant(finalMerchant);

      const txDate  = new Date(finalDate + 'T12:00:00');
      const nowDate = new Date();
      const isPastMonth =
        txDate.getFullYear() < nowDate.getFullYear() ||
        (txDate.getFullYear() === nowDate.getFullYear() && txDate.getMonth() < nowDate.getMonth());

      if (isPastMonth) {
        await supabase.from('pending_transactions').upsert({
          user_id: userId, source: 'outlook', amount: finalAmount,
          currency: result.moneda ?? 'ARS', merchant: finalMerchant,
          transaction_date: finalDate, raw_subject: rawSubject, status: 'confirmed',
        }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });

        await supabase.from('expenses').insert({
          user_id: userId, description: result.descripcion ?? finalMerchant,
          amount: finalAmount, date: finalDate, payment_method: 'other',
          category_id: null, is_recurring: false,
        });
        newPending++;
        continue;
      }

      const { data: hint } = await supabase
        .from('merchant_category_hints')
        .select('category, classification, count')
        .eq('user_id', userId)
        .eq('merchant_normalized', merchantNorm)
        .maybeSingle();

      const hintCount   = hint?.count ?? 0;
      const isHighConf  = hintCount >= 3;
      const validCls    = ['necessary', 'disposable', 'investable'];
      const groqCls     = validCls.includes(result.clasificacion) ? result.clasificacion : 'disposable';

      await supabase.from('pending_transactions').upsert({
        user_id:                  userId,
        source:                   'outlook',
        amount:                   finalAmount,
        currency:                 result.moneda ?? 'ARS',
        merchant:                 finalMerchant,
        suggested_category:       hintCount >= 1 ? hint!.category : null,
        suggested_classification: hintCount >= 1 ? hint!.classification : null,
        description:              result.descripcion,
        transaction_date:         finalDate,
        raw_subject:              rawSubject,
        status:                   'pending',
        hint_count:               hintCount,
        high_confidence:          isHighConf,
      }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });
      newPending++;
    }

    if (!hadGroqFailure) {
      const updates: any = { last_checked_at: new Date().toISOString() };
      if (isBackfill) updates.is_backfill_done = true;
      await supabase.from('outlook_connections').update(updates).eq('user_id', userId);
    }

    if (newPending > 0) {
      const fnSecret = Deno.env.get('INTERNAL_FN_SECRET');
      const plural   = newPending > 1 ? `${newPending} gastos nuevos` : `1 gasto nuevo`;
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fnSecret}` },
        body:    JSON.stringify({
          userId,
          title: `🔍 Detectamos ${plural} de tu Outlook`,
          body:  'Tu presupuesto se actualizó automáticamente. Tocá para revisar.',
          data:  { route: '/(app)/expenses' },
        }),
      }).catch(err => console.warn('[outlook-poll] push error:', err));
    }

    return new Response(JSON.stringify({
      outlook_connected: true,
      outlook_email:     connection.outlook_email,
      new_found:         newPending,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[outlook-poll] Error general:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
