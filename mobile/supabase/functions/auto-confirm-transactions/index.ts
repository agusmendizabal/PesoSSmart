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

  // Buscar transacciones de alta confianza pendientes hace más de 24 horas
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: eligible, error } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('high_confidence', true)
    .eq('status', 'pending')
    .lt('created_at', cutoff);

  if (error) {
    console.error('[auto-confirm] Error fetching eligible transactions:', error);
    return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
  }

  if (!eligible || eligible.length === 0) {
    console.log('[auto-confirm] No hay transacciones elegibles');
    return new Response(JSON.stringify({ confirmed: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[auto-confirm] Procesando ${eligible.length} transacciones de alta confianza`);

  // Agrupar por usuario para una sola push notification por usuario
  const byUser: Record<string, typeof eligible> = {};
  for (const tx of eligible) {
    if (!byUser[tx.user_id]) byUser[tx.user_id] = [];
    byUser[tx.user_id].push(tx);
  }

  let totalConfirmed = 0;

  for (const [userId, txList] of Object.entries(byUser)) {
    // Obtener categorías para mapear nombres
    const { data: categories } = await supabase.from('categories').select('id, name');
    const catMap: Record<string, string> = {};
    for (const c of categories ?? []) catMap[c.name] = c.id;

    let userConfirmed = 0;

    for (const tx of txList) {
      const categoryId = tx.suggested_category ? catMap[tx.suggested_category] ?? null : null;

      // Verificar que no exista ya un gasto vinculado
      const { data: existing } = await supabase
        .from('expenses')
        .select('id')
        .eq('source_pending_id', tx.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        // Ya existe — solo actualizar estado
        await supabase.from('pending_transactions').update({ status: 'confirmed' }).eq('id', tx.id);
        userConfirmed++;
        continue;
      }

      const { error: expErr } = await supabase.from('expenses').insert({
        user_id:           userId,
        description:       tx.description ?? tx.merchant ?? 'Gasto detectado',
        amount:            tx.amount,
        date:              tx.transaction_date ?? new Date().toISOString().split('T')[0],
        payment_method:    'digital_wallet',
        category_id:       categoryId,
        classification:    tx.suggested_classification ?? 'disposable',
        is_recurring:      false,
        source_pending_id: tx.id,
      });

      if (expErr) {
        console.error(`[auto-confirm] Error insertando expense para ${tx.id}:`, expErr);
        continue;
      }

      await supabase.from('pending_transactions').update({ status: 'confirmed' }).eq('id', tx.id);
      userConfirmed++;
    }

    totalConfirmed += userConfirmed;

    if (userConfirmed > 0) {
      const plural  = userConfirmed > 1 ? `${userConfirmed} gastos` : `1 gasto`;
      const fnSecret = Deno.env.get('INTERNAL_FN_SECRET');
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fnSecret}` },
        body:    JSON.stringify({
          userId,
          title: `✅ Clasificamos ${plural} automáticamente`,
          body:  'Revisalos si querés cambiar algo. Siempre podés editar.',
          data:  { route: '/(app)/expenses' },
        }),
      }).catch(err => console.warn('[auto-confirm] push error:', err));
    }
  }

  console.log(`[auto-confirm] Total confirmados: ${totalConfirmed}`);
  return new Response(JSON.stringify({ confirmed: totalConfirmed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
