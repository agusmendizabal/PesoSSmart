import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // ── PASO 1: App pide la URL de autorización de Google ─────────────────────
  // GET /gmail-auth?action=url&user_id=xxx
  if (req.method === 'GET' && url.searchParams.get('action') === 'url') {
    const userId = url.searchParams.get('user_id');
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-auth`;

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state: userId, // usamos el user_id como state para saber a quién pertenece el token
    });

    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── PASO 2: Google redirige acá con el code ───────────────────────────────
  // GET /gmail-auth?code=xxx&state=user_id
  if (req.method === 'GET' && url.searchParams.get('code')) {
    const code = url.searchParams.get('code')!;
    const userId = url.searchParams.get('state')!;

    try {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!;
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
      const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-auth`;

      // Intercambiar code por tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
      const tokens = await tokenRes.json();

      // Obtener email de la cuenta conectada
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = await userInfoRes.json();

      // Guardar en Supabase con service role (sin RLS)
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const { error: upsertErr } = await supabase.from('gmail_connections').upsert({
        user_id: userId,
        gmail_email: userInfo.email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        last_checked_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // revisar últimos 7 días
      }, { onConflict: 'user_id' });

      if (upsertErr) {
        console.error('[gmail-auth] Error guardando conexión:', upsertErr);
        throw new Error(`No se pudo guardar la conexión Gmail: ${upsertErr.message}`);
      }

      // Redirigir a la app
      return new Response(null, {
        status: 302,
        headers: { Location: `pesossmart://gmail-connected?email=${encodeURIComponent(userInfo.email)}` },
      });
    } catch (err) {
      return new Response(null, {
        status: 302,
        headers: { Location: `pesossmart://gmail-connected?error=${encodeURIComponent(String(err))}` },
      });
    }
  }

  // ── PASO 3: App desconecta Gmail ─────────────────────────────────────────
  // DELETE /gmail-auth con Authorization header
  if (req.method === 'DELETE') {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user } } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();

    if (!user) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });

    await supabase.from('gmail_connections').delete().eq('user_id', user.id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Método no soportado' }), { status: 405 });
});
