import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ── Crypto ────────────────────────────────────────────────────────────────────

async function decryptToken(enc: string): Promise<string> {
  if (!enc.startsWith('v1:')) return enc;
  const raw = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (raw.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY < 32 chars');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(raw.slice(0, 32)),
    { name: 'AES-GCM' }, false, ['decrypt'],
  );
  const combined = Uint8Array.from(atob(enc.slice(3)), c => c.charCodeAt(0));
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(dec);
}

async function encryptToken(token: string): Promise<string> {
  const raw = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (raw.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY < 32 chars');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(raw.slice(0, 32)),
    { name: 'AES-GCM' }, false, ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.length);
  return 'v1:' + btoa(String.fromCharCode(...combined));
}

// ── MP token refresh ──────────────────────────────────────────────────────────

async function refreshMpToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     Deno.env.get('MP_CLIENT_ID')!,
        client_secret: Deno.env.get('MP_CLIENT_SECRET')!,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) { console.error('[mp-poll] refresh failed:', await res.text()); return null; }
    const data = await res.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error('[mp-poll] refresh exception:', err);
    return null;
  }
}

// ── MP Payments search (paginada) ─────────────────────────────────────────────

async function fetchPaymentsPage(
  accessToken: string,
  payerId: string | null,
  since: string,
  offset: number,
  limit = 50,
): Promise<{ results: any[]; total: number }> {
  const url = new URL('https://api.mercadopago.com/v1/payments/search');
  if (payerId) url.searchParams.set('payer.id', payerId);
  url.searchParams.set('sort',       'date_created');
  url.searchParams.set('criteria',   'desc');
  url.searchParams.set('begin_date', since);
  url.searchParams.set('limit',      String(limit));
  url.searchParams.set('offset',     String(offset));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    console.error('[mp-poll] MP search HTTP', res.status, '| body:', await res.text());
    return { results: [], total: 0 };
  }

  const data = await res.json();
  return {
    results: data.results ?? [],
    total:   data.paging?.total ?? 0,
  };
}

async function fetchAllPayments(
  accessToken: string,
  payerId: string | null,
  since: string,
): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const page = await fetchPaymentsPage(accessToken, payerId, since, offset, limit);
    all.push(...page.results);
    console.log(`[mp-poll] page offset=${offset} → ${page.results.length} (total declarado: ${page.total})`);
    if (page.results.length < limit) break;
    offset += limit;
    if (offset >= 500) break; // safety cap
  }

  return all;
}

// ── Groq classification ───────────────────────────────────────────────────────

async function classifyPayment(desc: string): Promise<{ clasificacion: string; categoria: string }> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return { clasificacion: 'disposable', categoria: 'otros' };

  const prompt = `Clasificá este gasto argentino.
Descripción: "${desc}"
Respondé ÚNICAMENTE con JSON:
{"clasificacion":"necessary"|"disposable"|"investable","categoria":"comida"|"cafe"|"transporte"|"servicios"|"entretenimiento"|"salud"|"ropa"|"hogar"|"educacion"|"deporte"|"peluqueria"|"seguros"|"otros"}
Reglas clasificacion: necessary=supermercado/farmacia/servicios/salud/educacion/combustible/seguros; disposable=restaurant/bar/cafe/delivery/ropa/streaming/ocio/peluqueria/deporte; investable=broker/crypto/plazo fijo
Reglas categoria: cafe=cafeteria/starbucks/cafe/te/bebida; comida=restaurant/delivery/supermercado; peluqueria=corte/tintura/estetica/spa; deporte=gym/pilates/natacion; seguros=seguro/cobertura`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return { clasificacion: 'disposable', categoria: 'otros' };
    const data   = await res.json();
    const text   = data.choices?.[0]?.message?.content ?? '';
    const match  = text.match(/\{[\s\S]*?\}/);
    if (!match) return { clasificacion: 'disposable', categoria: 'otros' };
    const parsed = JSON.parse(match[0]);
    return {
      clasificacion: ['necessary','disposable','investable'].includes(parsed.clasificacion)
        ? parsed.clasificacion : 'disposable',
      categoria: parsed.categoria ?? 'otros',
    };
  } catch {
    return { clasificacion: 'disposable', categoria: 'otros' };
  }
}

// ── Limpieza de nombre de comercio ───────────────────────────────────────────

function cleanMerchant(raw: string): string {
  return raw
    .replace(/@\S*/g, '')        // sushi@ → sushi, @alias → ''
    .replace(/#\S*/g, '')        // #hashtag → ''
    .replace(/[*|_\\]/g, ' ')   // separadores de descriptores de pago
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Filtros de movimientos a ignorar ─────────────────────────────────────────

const IGNORE_PATTERNS = [
  'recarga',
  'traspaso a tu cuenta',
  'fondos enviados a tu cuenta',
  'transferencia entre cuentas',
  'devolución',
  'reintegro',
  'cashback',
];

function shouldIgnore(description: string): boolean {
  const lower = description.toLowerCase();
  return IGNORE_PATTERNS.some(p => lower.includes(p));
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: Deno.env.get('SUPABASE_ANON_KEY')! },
    });
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { id: userId } = await authRes.json();
    console.log('[mp-poll] user:', userId);

    const body = (req.method === 'POST')
      ? await req.json().catch(() => ({}))
      : {};
    const forceSync: boolean = body.force_sync === true;

    // ── Supabase (service role) ───────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Obtener conexión ──────────────────────────────────────────────────────
    const { data: conn } = await supabase
      .from('mp_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!conn) {
      return new Response(JSON.stringify({ mp_connected: false, pending: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    const secsSince = (Date.now() - new Date(conn.last_checked_at).getTime()) / 1000;
    if (!forceSync && secsSince < 60) {
      console.log('[mp-poll] rate-limited, secs since last check:', Math.round(secsSince));
      const { data: recent } = await supabase
        .from('pending_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('source', 'mercadopago')
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .order('created_at', { ascending: false });
      return new Response(JSON.stringify({
        mp_connected: true,
        rate_limited: true,
        new_found: 0,
        pending: recent ?? [],
        last_sync_count: conn.last_sync_count ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Desencriptar y validar token ──────────────────────────────────────────
    let accessToken = await decryptToken(conn.access_token);
    const refreshTokenDec = conn.refresh_token ? await decryptToken(conn.refresh_token) : '';

    const probeRes = await fetch('https://api.mercadopago.com/v1/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('[mp-poll] token probe:', probeRes.status);

    if (probeRes.status === 401) {
      if (!refreshTokenDec) {
        await supabase.from('mp_connections').update({ last_sync_status: 'token_expired' }).eq('user_id', userId);
        return new Response(JSON.stringify({ error: 'Token expirado. Reconectá tu cuenta.', code: 'MP_TOKEN_EXPIRED', mp_connected: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const newTok = await refreshMpToken(refreshTokenDec);
      if (!newTok) {
        await supabase.from('mp_connections').update({ last_sync_status: 'token_expired' }).eq('user_id', userId);
        return new Response(JSON.stringify({ error: 'Token expirado. Reconectá tu cuenta.', code: 'MP_TOKEN_EXPIRED', mp_connected: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      accessToken = newTok;
      await supabase.from('mp_connections')
        .update({ access_token: await encryptToken(newTok), last_sync_status: 'ok' })
        .eq('user_id', userId);
      console.log('[mp-poll] token refreshed OK');
    }

    // ── Buscar pagos: estrategia dual ─────────────────────────────────────────
    // 1. Con payer.id (filtra por pagador en la API — más preciso)
    // 2. Sin payer.id (retorna todo del token, filtramos client-side)
    // Usamos el que retorne más resultados.

    // Nunca traer datos de meses anteriores
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const since = new Date(conn.last_checked_at) < new Date(monthStart)
      ? monthStart
      : new Date(conn.last_checked_at).toISOString();
    console.log('[mp-poll] buscando desde:', since);

    let payments = await fetchAllPayments(accessToken, conn.mp_user_id, since);
    console.log(`[mp-poll] con payer.id → ${payments.length} pagos`);

    if (payments.length === 0) {
      console.log('[mp-poll] sin resultados con payer.id, reintentando sin filtro...');
      const allPayments = await fetchAllPayments(accessToken, null, since);
      console.log(`[mp-poll] sin filtro → ${allPayments.length} pagos totales`);
      // Filtrar solo donde el usuario es pagador
      payments = allPayments.filter(p => String(p.payer?.id) === String(conn.mp_user_id));
      console.log(`[mp-poll] filtrados como pagador → ${payments.length} pagos`);
    }

    // ── Paso 1: filtro rápido sin DB ─────────────────────────────────────────
    const BATCH_SIZE = 25; // máximo por ejecución para no hacer timeout
    let skippedFilter = 0;

    const candidates = payments
      .filter(p => {
        if (p.status !== 'approved') { skippedFilter++; return false; }
        if ((p.transaction_amount ?? 0) <= 0) { skippedFilter++; return false; }
        const desc = p.description ?? p.statement_descriptor ?? p.reason ?? '';
        if (shouldIgnore(desc)) { skippedFilter++; return false; }
        return true;
      })
      .slice(0, BATCH_SIZE); // cap para evitar timeout

    console.log(`[mp-poll] candidatos a procesar: ${candidates.length} (filtrados: ${skippedFilter})`);

    // ── Paso 2: deduplicación en batch (1 query) ──────────────────────────────
    const rawSubjects = candidates.map(p => `mp_${p.id}`);
    const { data: existingRows } = rawSubjects.length > 0
      ? await supabase
          .from('pending_transactions')
          .select('raw_subject')
          .eq('user_id', userId)
          .in('raw_subject', rawSubjects)
      : { data: [] };

    const existingSet = new Set((existingRows ?? []).map((r: any) => r.raw_subject));
    const toProcess = candidates.filter(p => !existingSet.has(`mp_${p.id}`));
    const skippedDup = candidates.length - toProcess.length;
    console.log(`[mp-poll] nuevos a insertar: ${toProcess.length} (dups: ${skippedDup})`);

    // ── Paso 3: clasificar con Groq en paralelo (max 5 concurrent) ────────────
    const GROQ_CONCURRENCY = 5;
    const classified: Array<{ payment: any; classification: { clasificacion: string; categoria: string } }> = [];

    for (let i = 0; i < toProcess.length; i += GROQ_CONCURRENCY) {
      const batch = toProcess.slice(i, i + GROQ_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async p => ({
          payment:        p,
          classification: await classifyPayment(
            cleanMerchant(p.description ?? p.statement_descriptor ?? p.reason ?? 'Pago Mercado Pago'),
          ),
        })),
      );
      classified.push(...results);
    }

    // ── Paso 4: mapear categorías al name de DB ───────────────────────────────
    const CATEGORY_NAME_MAP: Record<string, string> = {
      cafe:            'cafe',
      peluqueria:      'beauty_salon',
      deporte:         'sports',
      seguros:         'insurance',
      comida:          'food_dining',
      transporte:      'transport',
      salud:           'health',
      ropa:            'clothing',
      hogar:           'home',
      educacion:       'education',
      entretenimiento: 'entertainment',
      otros:           'other',
    };

    // ── Paso 5: insertar como pendiente (el usuario confirma en la app) ────────
    let newFound = 0;

    const pendingToInsert = classified.map(({ payment, classification }) => {
      const merchant = cleanMerchant(payment.description ?? payment.statement_descriptor ?? payment.reason ?? 'Pago Mercado Pago');
      return {
        user_id:                  userId,
        source:                   'mercadopago',
        amount:                   payment.transaction_amount,
        currency:                 payment.currency_id ?? 'ARS',
        merchant,
        suggested_category:       CATEGORY_NAME_MAP[classification.categoria] ?? 'other',
        suggested_classification: classification.clasificacion,
        description:              merchant,
        transaction_date:         (payment.date_approved ?? payment.date_created ?? new Date().toISOString()).slice(0, 10),
        raw_subject:              `mp_${payment.id}`,
        status:                   'pending',
      };
    });

    if (pendingToInsert.length > 0) {
      const { error: pendErr } = await supabase.from('pending_transactions')
        .upsert(pendingToInsert, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });
      if (pendErr) console.error('[mp-poll] error bulk upsert pending:', pendErr.message);
      else newFound = pendingToInsert.length;
    }

    console.log(`[mp-poll] resumen → nuevos: ${newFound}, dups: ${skippedDup}, filtrados: ${skippedFilter}`);

    // ── Actualizar estado de conexión ─────────────────────────────────────────
    await supabase.from('mp_connections').update({
      last_checked_at:  new Date().toISOString(),
      last_sync_count:  newFound,
      last_sync_status: 'ok',
    }).eq('user_id', userId);

    // ── Push notification ─────────────────────────────────────────────────────
    if (newFound > 0) {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${Deno.env.get('INTERNAL_FN_SECRET')}`,
        },
        body: JSON.stringify({
          userId,
          title: `📲 ${newFound > 1 ? `${newFound} gastos nuevos` : '1 gasto nuevo'} de Mercado Pago`,
          body:  'Tu presupuesto se actualizó automáticamente.',
          data:  { route: '/(app)/expenses' },
        }),
      }).catch(e => console.warn('[mp-poll] push error:', e));
    }

    // ── Retornar últimas 24h ──────────────────────────────────────────────────
    const { data: recent } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'mercadopago')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false });

    return new Response(JSON.stringify({
      mp_connected:    true,
      new_found:       newFound,
      total_api:       payments.length,
      skipped_dup:     skippedDup,
      skipped_filter:  skippedFilter,
      pending:         recent ?? [],
      last_sync_count: newFound,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[mp-poll] error inesperado:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
