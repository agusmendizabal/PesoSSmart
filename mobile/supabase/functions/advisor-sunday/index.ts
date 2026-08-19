/**
 * advisor-sunday — Resumen del domingo (cron job).
 *
 * Cron: 0 13 * * 0  (domingos 10:00 ART = 13:00 UTC)
 * Configurar en Supabase Dashboard → Edge Functions → Cron Jobs.
 *
 * Para cada usuario activo:
 *  1. Calcula gasto de la semana actual vs semana anterior.
 *  2. Encuentra la meta de mayor progreso.
 *  3. Envía push personalizada via send-push.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_FN_SECRET = Deno.env.get('INTERNAL_FN_SECRET');

function weekRange(weeksAgo = 0): { start: string; end: string } {
  const now  = new Date();
  const dow  = now.getUTCDay(); // 0=Sun
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setUTCDate(now.getUTCDate() - dow - weeksAgo * 7);
  startOfThisWeek.setUTCHours(0, 0, 0, 0);

  const endOfThisWeek = new Date(startOfThisWeek);
  endOfThisWeek.setUTCDate(startOfThisWeek.getUTCDate() + 6);
  endOfThisWeek.setUTCHours(23, 59, 59, 999);

  return {
    start: startOfThisWeek.toISOString().split('T')[0],
    end:   endOfThisWeek.toISOString().split('T')[0],
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

serve(async (req) => {
  // Función server-to-server: cron/invocación manual con secret propio.
  // Fail-closed: si el secret no está configurado, se rechaza.
  if (!INTERNAL_FN_SECRET) {
    return new Response(JSON.stringify({ error: 'Secret no configurado' }), { status: 500 });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${INTERNAL_FN_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Accepts GET (from Supabase cron) or POST (manual trigger)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

  // Fetch all users with a push token
  const { data: users, error } = await supabase
    .from('profiles')
    .select('id, full_name, push_token')
    .not('push_token', 'is', null);

  if (error || !users?.length) {
    console.log('[advisor-sunday] No users with push tokens:', error?.message);
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const thisWeek = weekRange(0);
  const lastWeek = weekRange(1);
  let sent = 0;

  for (const user of users) {
    if (!user.push_token) continue;

    try {
      // Weekly spend this week and last week (parallel)
      const [thisRes, lastRes, goalsRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', thisWeek.start)
          .lte('date', thisWeek.end),
        supabase
          .from('expenses')
          .select('amount')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', lastWeek.start)
          .lte('date', lastWeek.end),
        supabase
          .from('savings_goals')
          .select('title, current_amount, target_amount')
          .eq('user_id', user.id)
          .order('current_amount', { ascending: false })
          .limit(1),
      ]);

      const thisTotal = (thisRes.data ?? []).reduce((s: number, e: any) => s + e.amount, 0);
      const lastTotal = (lastRes.data ?? []).reduce((s: number, e: any) => s + e.amount, 0);
      const topGoal   = goalsRes.data?.[0];

      // Build personalized message
      let body: string;
      if (lastTotal === 0) {
        body = `Esta semana gastaste ${fmt(thisTotal)}. ¡Seguí registrando para ver tu progreso!`;
      } else {
        const diff    = thisTotal - lastTotal;
        const diffPct = Math.abs(Math.round((diff / lastTotal) * 100));
        if (diff < 0) {
          body = `Esta semana ahorraste un ${diffPct}% más que la anterior. ¡Vas por buen camino! 🎯`;
        } else if (diff === 0) {
          body = `Tu gasto semanal se mantuvo igual que la semana pasada: ${fmt(thisTotal)}.`;
        } else {
          body = `Gastaste un ${diffPct}% más que la semana pasada (${fmt(thisTotal)}). Revisá tus disposables.`;
        }
      }

      if (topGoal) {
        const pct = Math.round((topGoal.current_amount / topGoal.target_amount) * 100);
        body += ` Tu meta "${topGoal.title}" va al ${pct}%.`;
      }

      // Send push via send-push function
      await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${INTERNAL_FN_SECRET}`,
        },
        body: JSON.stringify({
          token: user.push_token,
          title: '📅 Tu resumen semanal',
          body,
          data: { route: '/(app)/reports' },
        }),
      });

      sent++;
    } catch (err) {
      console.error(`[advisor-sunday] Error para user ${user.id}:`, err);
    }
  }

  console.log(`[advisor-sunday] Enviadas ${sent}/${users.length} notificaciones`);
  return new Response(JSON.stringify({ sent, total: users.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
