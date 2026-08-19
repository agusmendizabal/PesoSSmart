import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_FN_SECRET = Deno.env.get('INTERNAL_FN_SECRET');
const EXPO_PUSH_URL   = 'https://exp.host/--/api/v2/push/send';

interface PushPayload {
  userId?:  string;
  token?:   string;
  title:    string;
  body:     string;
  data?:    Record<string, string>;
  badge?:   number;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Función server-to-server: solo otras edge functions de este proyecto deben
  // poder invocarla. Fail-closed: si el secret no está configurado, se rechaza.
  if (!INTERNAL_FN_SECRET) {
    return new Response(JSON.stringify({ error: 'Secret no configurado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${INTERNAL_FN_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { userId, token: directToken, title, body, data, badge } = payload;

  if (!title || !body) {
    return new Response('Missing title or body', { status: 400 });
  }

  // Resolve push token: either passed directly or looked up from profiles
  let pushToken = directToken;
  if (!pushToken && userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();
    pushToken = profile?.push_token ?? null;
  }

  if (!pushToken) {
    return new Response(JSON.stringify({ ok: false, reason: 'no_token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use Expo Push API — no FCM/APNs keys needed, Expo handles delivery
  const expoPush = {
    to:    pushToken,
    title,
    body,
    sound: 'default',
    badge: badge ?? 1,
    data:  data ?? {},
    channelId: 'default',
  };

  const res = await fetch(EXPO_PUSH_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(expoPush),
  });

  const result = await res.json();

  if (!res.ok || result?.data?.status === 'error') {
    console.error('[send-push] Expo error:', JSON.stringify(result));
    return new Response(JSON.stringify({ ok: false, expo: result }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, expo: result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
