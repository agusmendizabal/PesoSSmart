import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MS_AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_SCOPES    = 'https://graph.microsoft.com/Mail.Read offline_access';

// ── Encriptación AES-GCM ──────────────────────────────────────────────────────

async function getEncryptionKey(): Promise<CryptoKey> {
  const rawKey = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes = new TextEncoder().encode(rawKey.slice(0, 32));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined  = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return 'v1:' + btoa(String.fromCharCode(...combined));
}

// ── Validar JWT de Supabase ───────────────────────────────────────────────────

async function validateJWT(authHeader: string): Promise<string | null> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey':        Deno.env.get('SUPABASE_ANON_KEY')!,
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url      = new URL(req.url);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── PASO 1: App pide la URL de autorización de Microsoft ──────────────────
  // GET /outlook-auth?action=url
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

    // Generar state CSRF y guardarlo en gmail_oauth_states (reutilizamos la misma tabla)
    const csrfToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const { error: stateErr } = await supabase.from('gmail_oauth_states').insert({
      token:   csrfToken,
      user_id: userId,
    });
    if (stateErr) {
      console.error('[outlook-auth] Error guardando CSRF state:', stateErr);
      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId    = Deno.env.get('MICROSOFT_CLIENT_ID')!;
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outlook-auth`;

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         MS_SCOPES,
      response_mode: 'query',
      state:         csrfToken,
    });

    const authUrl = `${MS_AUTH_BASE}/authorize?${params.toString()}`;
    console.log('[outlook-auth] OAuth URL generada para user:', userId);
    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── PASO 2: Microsoft redirige acá con el code ────────────────────────────
  // GET /outlook-auth?code=xxx&state=<csrf_token>
  if (req.method === 'GET' && url.searchParams.get('code')) {
    const code      = url.searchParams.get('code')!;
    const csrfToken = url.searchParams.get('state') ?? '';

    try {
      const { data: stateRow, error: stateErr } = await supabase
        .from('gmail_oauth_states')
        .select('user_id, expires_at')
        .eq('token', csrfToken)
        .single();

      if (stateErr || !stateRow) {
        return new Response(null, {
          status: 302,
          headers: { Location: `nomi://outlook-connected?error=${encodeURIComponent('Token inválido o expirado')}` },
        });
      }

      if (new Date(stateRow.expires_at) < new Date()) {
        await supabase.from('gmail_oauth_states').delete().eq('token', csrfToken);
        return new Response(null, {
          status: 302,
          headers: { Location: `nomi://outlook-connected?error=${encodeURIComponent('Tiempo de conexión expirado. Intentá de nuevo.')}` },
        });
      }

      await supabase.from('gmail_oauth_states').delete().eq('token', csrfToken);
      const userId = stateRow.user_id;

      const clientId     = Deno.env.get('MICROSOFT_CLIENT_ID')!;
      const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!;
      const redirectUri  = `${Deno.env.get('SUPABASE_URL')}/functions/v1/outlook-auth`;

      // Intercambiar code por tokens
      const tokenRes = await fetch(`${MS_AUTH_BASE}/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
          scope:         MS_SCOPES,
        }),
      });

      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
      const tokens = await tokenRes.json();

      // Obtener email de la cuenta conectada
      const userInfoRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo   = await userInfoRes.json();
      const email      = userInfo.mail ?? userInfo.userPrincipalName ?? '';

      const encryptedAccess  = await encryptToken(tokens.access_token);
      const encryptedRefresh = await encryptToken(tokens.refresh_token);

      const { error: upsertErr } = await supabase.from('outlook_connections').upsert({
        user_id:        userId,
        outlook_email:  email,
        access_token:   encryptedAccess,
        refresh_token:  encryptedRefresh,
        last_checked_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        token_expired:  false,
      }, { onConflict: 'user_id' });

      if (upsertErr) throw new Error(`No se pudo guardar la conexión Outlook: ${upsertErr.message}`);

      console.log('[outlook-auth] Conexión Outlook guardada para user:', userId);
      return new Response(null, {
        status: 302,
        headers: { Location: `nomi://outlook-connected?email=${encodeURIComponent(email)}` },
      });
    } catch (err) {
      console.error('[outlook-auth] Error en callback:', err);
      return new Response(null, {
        status: 302,
        headers: { Location: `nomi://outlook-connected?error=${encodeURIComponent(String(err))}` },
      });
    }
  }

  // ── PASO 3: App desconecta Outlook ────────────────────────────────────────
  if (req.method === 'DELETE') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    const userId = await validateJWT(authHeader);
    if (!userId) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    await supabase.from('outlook_connections').delete().eq('user_id', userId);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Método no soportado' }), { status: 405 });
});
