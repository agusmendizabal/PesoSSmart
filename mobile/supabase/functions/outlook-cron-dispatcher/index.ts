import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const expectedSecret = Deno.env.get('INTERNAL_FN_SECRET');
  const authHeader     = req.headers.get('Authorization');
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: connections, error } = await supabase
    .from('outlook_connections')
    .select('user_id')
    .eq('token_expired', false);

  if (error) {
    console.error('[outlook-cron-dispatcher] Error fetching connections:', error);
    return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
  }

  const total   = connections?.length ?? 0;
  const secret  = Deno.env.get('INTERNAL_FN_SECRET')!;
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  let success   = 0;
  let failed    = 0;

  console.log(`[outlook-cron-dispatcher] Processing ${total} connections`);

  for (const conn of connections ?? []) {
    try {
      const res = await fetch(`${baseUrl}/functions/v1/outlook-poll`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${secret}`,
        },
        body: JSON.stringify({ userId: conn.user_id }),
      });
      if (res.ok) {
        success++;
      } else {
        console.error(`[outlook-cron-dispatcher] Poll failed for ${conn.user_id}: ${res.status}`);
        failed++;
      }
    } catch (err) {
      console.error(`[outlook-cron-dispatcher] Exception for ${conn.user_id}:`, err);
      failed++;
    }
  }

  console.log(`[outlook-cron-dispatcher] Done — success:${success} failed:${failed}`);
  return new Response(JSON.stringify({ total, success, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
