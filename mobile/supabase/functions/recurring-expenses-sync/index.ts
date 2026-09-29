/**
 * recurring-expenses-sync — Cron diario que registra solos los "gastos fijos"
 * (alquiler, cuotas, suscripciones) marcados por el usuario con is_recurring=true.
 *
 * Lógica: por cada grupo (user_id, description, category_id) con is_recurring=true,
 * toma la ocurrencia más reciente como plantilla. Si esa plantilla es de un mes
 * anterior al actual y ya llegamos o pasamos su día del mes, inserta una nueva
 * fila para el mes en curso (mismo monto/categoría/medio de pago), una sola vez
 * por mes — no vuelve a duplicar si ya se generó la ocurrencia de este mes.
 *
 * Cron: diario 09:00 UTC (ver recurring_expenses_sync_cron.sql)
 * Deploy: npx supabase functions deploy recurring-expenses-sync
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface RecurringExpense {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  date: string; // YYYY-MM-DD
  category_id: string | null;
  payment_method: string;
  classification: string | null;
  notes: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

serve(async (req) => {
  const cronSecret = Deno.env.get('RECURRING_EXPENSES_SYNC_SECRET');
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'Secret no configurado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

  const { data: recurring, error } = await supabase
    .from('expenses')
    .select('id, user_id, description, amount, date, category_id, payment_method, classification, notes, is_recurring, recurring_frequency')
    .eq('is_recurring', true)
    .eq('recurring_frequency', 'monthly')
    .is('deleted_at', null)
    .order('date', { ascending: false });

  if (error) {
    console.error('[recurring-expenses-sync] fetch error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const today       = new Date();
  const todayYear   = today.getUTCFullYear();
  const todayMonth  = today.getUTCMonth() + 1;
  const todayDay    = today.getUTCDate();
  const todayKey    = `${todayYear}-${String(todayMonth).padStart(2, '0')}`;

  // Una plantilla por (user_id, description, category_id) — la ocurrencia más reciente,
  // ya que la query viene ordenada por date desc.
  const templates = new Map<string, RecurringExpense>();
  for (const row of (recurring ?? []) as RecurringExpense[]) {
    const key = `${row.user_id}::${row.description}::${row.category_id ?? 'none'}`;
    if (!templates.has(key)) templates.set(key, row);
  }

  const log: string[] = [];
  let inserted = 0;

  for (const tpl of templates.values()) {
    const [ty, tm, td] = tpl.date.split('-').map(Number);
    const tplKey = `${ty}-${String(tm).padStart(2, '0')}`;

    if (tplKey === todayKey) continue; // ya está al día este mes
    if (tplKey > todayKey) continue;   // plantilla en el futuro (no debería pasar)

    const targetDay = Math.min(td, daysInMonth(todayYear, todayMonth));
    if (todayDay < targetDay) continue; // todavía no llega el día del mes

    // Re-chequeo justo antes de insertar (no al principio de la función): achica la
    // ventana de carrera si dos invocaciones corren cerca en el tiempo — evita
    // duplicar la ocurrencia del mes si otra corrida ya la generó mientras procesábamos.
    const { data: alreadyThisMonth } = await supabase
      .from('expenses')
      .select('id')
      .eq('user_id', tpl.user_id)
      .eq('description', tpl.description)
      .eq('is_recurring', true)
      .is('deleted_at', null)
      .gte('date', `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`)
      .maybeSingle();
    if (alreadyThisMonth) continue;

    const newDate = `${todayYear}-${String(todayMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    const { error: insertError } = await supabase.from('expenses').insert({
      user_id:             tpl.user_id,
      description:         tpl.description,
      amount:              tpl.amount,
      date:                newDate,
      category_id:         tpl.category_id,
      payment_method:      tpl.payment_method,
      classification:      tpl.classification,
      notes:               tpl.notes,
      is_recurring:        true,
      recurring_frequency: 'monthly',
    });
    if (insertError) {
      console.error(`[recurring-expenses-sync] insert error para ${tpl.user_id}/"${tpl.description}":`, insertError);
      continue;
    }
    inserted++;
    log.push(`${tpl.user_id}: "${tpl.description}" → ${newDate}`);
  }

  console.log('[recurring-expenses-sync] Insertados:', log.join(' | ') || '(ninguno)');
  return new Response(JSON.stringify({ ok: true, inserted, log }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
