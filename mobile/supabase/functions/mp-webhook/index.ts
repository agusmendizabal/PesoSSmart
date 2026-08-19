import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const MP_WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET')!; // configurar en MP dashboard
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_FN_SECRET = Deno.env.get('INTERNAL_FN_SECRET');

// Días de suscripción por plan
const PLAN_DURATION_DAYS: Record<string, number> = {
  pro:     30,
  premium: 30,
};

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();

  // ── Verificar firma HMAC de MercadoPago ───────────────────────────────────
  const xSignature  = req.headers.get('x-signature') ?? '';
  const xRequestId  = req.headers.get('x-request-id') ?? '';
  const urlParams   = new URL(req.url).searchParams;
  const dataId      = urlParams.get('data.id') ?? JSON.parse(body)?.data?.id ?? '';

  // Fail-closed: sin secret configurado, se rechaza en vez de saltear la verificación.
  if (!MP_WEBHOOK_SECRET) {
    console.error('[mp-webhook] MP_WEBHOOK_SECRET no configurado');
    return new Response('Secret no configurado', { status: 500 });
  }

  const ts = xSignature.split('ts=')[1]?.split(',')[0] ?? '';
  const signedTemplate = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const [, signaturePart] = xSignature.split('v1=');
  const expectedSig = createHmac('sha256', MP_WEBHOOK_SECRET)
    .update(signedTemplate)
    .digest('hex');

  if (signaturePart !== expectedSig) {
    console.warn('[mp-webhook] Firma inválida');
    return new Response('Firma inválida', { status: 401 });
  }

  // Protección anti-replay: una firma válida capturada una vez no debe poder
  // reenviarse indefinidamente. MP envía `ts` como epoch — normaliza a ms
  // sin asumir la unidad exacta (10 dígitos ≈ segundos, 13 ≈ milisegundos).
  const tsNum = Number(ts);
  const tsMs = ts.length <= 10 ? tsNum * 1000 : tsNum;
  const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutos
  if (!ts || !Number.isFinite(tsNum) || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    console.warn('[mp-webhook] Timestamp de firma fuera de rango (posible replay)');
    return new Response('Firma expirada', { status: 401 });
  }

  const payload = JSON.parse(body);

  // Solo procesar eventos de pago aprobado
  if (payload.type !== 'payment') {
    return new Response('OK', { status: 200 });
  }

  const paymentId = payload.data?.id;
  if (!paymentId) return new Response('Sin payment id', { status: 400 });

  // ── Obtener detalle del pago de MP ────────────────────────────────────────
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (!mpRes.ok) {
    console.error('[mp-webhook] Error fetching payment:', await mpRes.text());
    return new Response('Error MP', { status: 500 });
  }

  const payment = await mpRes.json();

  const userId = payment.external_reference;
  const planId = payment.metadata?.plan_id as string;

  if (!userId || !planId) {
    console.error('[mp-webhook] Faltan userId o planId en metadata');
    return new Response('Metadata incompleta', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

  // ── Pago rechazado / fallido → grace period de 3 días ─────────────────────
  if (payment.status !== 'approved') {
    const GRACE_DAYS = 3;
    const failedStatuses = ['rejected', 'cancelled', 'refunded', 'charged_back'];
    if (!failedStatuses.includes(payment.status)) {
      return new Response('OK', { status: 200 }); // pendiente, ignorar
    }

    // Solo aplicar grace period si el usuario tenía suscripción activa
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, plan_expires_at')
      .eq('id', userId)
      .single();

    if (profile?.subscription_status === 'active') {
      const currentExpiry = profile.plan_expires_at
        ? new Date(profile.plan_expires_at)
        : new Date();
      const graceExpiry = new Date(
        Math.max(currentExpiry.getTime(), Date.now()) + GRACE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      await supabase
        .from('profiles')
        .update({ subscription_status: 'grace', plan_expires_at: graceExpiry })
        .eq('id', userId);

      // Notificar al usuario por push
      await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${INTERNAL_FN_SECRET}` },
        body: JSON.stringify({
          userId,
          title: '⚠️ Problema con tu pago',
          body:  `No pudimos procesar tu renovación. Tenés ${GRACE_DAYS} días para actualizar tu método de pago.`,
          data:  { route: '/(app)/plans' },
        }),
      }).catch(() => {});

      console.log(`[mp-webhook] Grace period aplicado para user ${userId}: ${graceExpiry}`);
    }

    await supabase.from('payment_logs').insert({
      user_id:    userId,
      payment_id: String(paymentId),
      plan_id:    planId,
      amount:     payment.transaction_amount,
      currency:   payment.currency_id,
      status:     payment.status,
      mp_data:    payment,
    }).catch(() => {});

    return new Response('OK', { status: 200 });
  }

  const days      = PLAN_DURATION_DAYS[planId] ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  // ── Actualizar perfil del usuario ─────────────────────────────────────────
  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_plan:   planId,
      subscription_status: 'active',
      plan_expires_at:     expiresAt,
      trial_used:          true,         // el trial ya no aplica
      updated_at:          new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    console.error('[mp-webhook] DB update error:', error);
    return new Response('DB error', { status: 500 });
  }

  // ── Registrar el pago (auditoría) ─────────────────────────────────────────
  await supabase.from('payment_logs').insert({
    user_id:    userId,
    payment_id: String(paymentId),
    plan_id:    planId,
    amount:     payment.transaction_amount,
    currency:   payment.currency_id,
    status:     'approved',
    mp_data:    payment,
  }).select().single().catch(() => {/* tabla opcional, no bloquear */});

  console.log(`[mp-webhook] Plan ${planId} activado para user ${userId}`);
  return new Response('OK', { status: 200 });
});
