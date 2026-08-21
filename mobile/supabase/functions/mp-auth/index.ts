import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Crypto helpers (reusan GMAIL_ENCRYPTION_KEY) ──────────────────────────────

async function getEncryptionKey(): Promise<CryptoKey> {
  const rawKey = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes = new TextEncoder().encode(rawKey.slice(0, 32));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return 'v1:' + btoa(String.fromCharCode(...combined));
}

// ── JWT validation ────────────────────────────────────────────────────────────

async function validateJWT(authHeader: string): Promise<string | null> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': Deno.env.get('SUPABASE_ANON_KEY')!,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id ?? null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const MP_CLIENT_ID     = Deno.env.get('MP_CLIENT_ID')!;
  const MP_CLIENT_SECRET = Deno.env.get('MP_CLIENT_SECRET')!;
  const REDIRECT_URI     = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-auth`;

  // ── PASO 1: Generar URL de autorización ──────────────────────────────────────
  // GET /mp-auth?action=url  (requiere Authorization JWT)
  if (req.method === 'GET' && url.searchParams.get('action') === 'url') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = await validateJWT(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'JWT inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const csrfToken   = crypto.randomUUID() + '-' + crypto.randomUUID();
    const redirectUrl = url.searchParams.get('redirect_url') ?? 'nomi://mp-connected';
    const { error: stateErr } = await supabase.from('mp_oauth_states').insert({
      token: csrfToken,
      user_id: userId,
      redirect_url: redirectUrl,
    });
    if (stateErr) {
      console.error('[mp-auth] Error guardando CSRF state:', stateErr);
      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params = new URLSearchParams({
      client_id:     MP_CLIENT_ID,
      response_type: 'code',
      platform_id:   'mp',
      redirect_uri:  REDIRECT_URI,
      state:         csrfToken,
      scope:         'read offline_access',
    });

    const authUrl = `https://auth.mercadopago.com.ar/authorization?${params.toString()}`;
    console.log('[mp-auth] OAuth URL generada para user:', userId);
    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── PASO 2: MP redirige con el code ───────────────────────────────────────────
  // GET /mp-auth?code=xxx&state=<csrf_token>
  if (req.method === 'GET' && url.searchParams.get('code')) {
    const code      = url.searchParams.get('code')!;
    const csrfToken = url.searchParams.get('state') ?? '';

    try {
      // Validar y consumir token CSRF
      const { data: stateRow, error: stateErr } = await supabase
        .from('mp_oauth_states')
        .select('user_id, expires_at, redirect_url')
        .eq('token', csrfToken)
        .single();

      const appRedirect = stateRow?.redirect_url ?? 'nomi://mp-connected';

      if (stateErr || !stateRow) {
        console.error('[mp-auth] Token CSRF no encontrado:', csrfToken);
        return new Response(null, {
          status: 302,
          headers: { Location: `${appRedirect}?error=${encodeURIComponent('Token inválido o expirado')}` },
        });
      }

      if (new Date(stateRow.expires_at) < new Date()) {
        await supabase.from('mp_oauth_states').delete().eq('token', csrfToken);
        return new Response(null, {
          status: 302,
          headers: { Location: `${appRedirect}?error=${encodeURIComponent('Tiempo de conexión expirado. Intentá de nuevo.')}` },
        });
      }

      await supabase.from('mp_oauth_states').delete().eq('token', csrfToken);
      const userId = stateRow.user_id;

      // Intercambiar code por tokens
      const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     MP_CLIENT_ID,
          client_secret: MP_CLIENT_SECRET,
          code,
          redirect_uri:  REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
      const tokens = await tokenRes.json();

      // Obtener info del usuario de MP
      const userRes = await fetch('https://api.mercadopago.com/v1/users/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const mpUser = await userRes.json();

      const encryptedAccess  = await encryptToken(tokens.access_token);
      const encryptedRefresh = await encryptToken(tokens.refresh_token ?? '');

      const { error: upsertErr } = await supabase.from('mp_connections').upsert({
        user_id:         userId,
        access_token:    encryptedAccess,
        refresh_token:   encryptedRefresh,
        mp_user_id:      String(mpUser.id),
        mp_email:        mpUser.email ?? null,
        last_checked_at: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      }, { onConflict: 'user_id' });

      if (upsertErr) throw new Error(`No se pudo guardar la conexión MP: ${upsertErr.message}`);

      console.log('[mp-auth] Conexión MP guardada para user:', userId, '| mp_user_id:', mpUser.id);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appRedirect}?email=${encodeURIComponent(mpUser.email ?? String(mpUser.id))}` },
      });
    } catch (err) {
      console.error('[mp-auth] Error en callback:', err);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appRedirect}?error=${encodeURIComponent(String(err))}` },
      });
    }
  }

  // ── PASO 3: Desconectar MP ────────────────────────────────────────────────────
  // DELETE /mp-auth  (requiere Authorization JWT)
  if (req.method === 'DELETE') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    const userId = await validateJWT(authHeader);
    if (!userId) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    await supabase.from('mp_connections').delete().eq('user_id', userId);
    console.log('[mp-auth] Desconectado MP para user:', userId);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Método no soportado' }), { status: 405 });
});
