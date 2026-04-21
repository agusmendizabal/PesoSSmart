import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const MP_WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET')!; // configurar en MP dashboard
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  if (MP_WEBHOOK_SECRET) {
    const signedTemplate = `id:${dataId};request-id:${xRequestId};ts:${xSignature.split('ts=')[1]?.split(',')[0] ?? ''};`;
    const [, signaturePart] = xSignature.split('v1=');
    const expectedSig = createHmac('sha256', MP_WEBHOOK_SECRET)
      .update(signedTemplate)
      .digest('hex');

    if (signaturePart !== expectedSig) {
      console.warn('[mp-webhook] Firma inválida');
      return new Response('Firma inválida', { status: 401 });
    }
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

  // Solo procesar pagos aprobados
  if (payment.status !== 'approved') {
    return new Response('OK', { status: 200 });
  }

  const userId  = payment.external_reference; // user.id guardado en la preferencia
  const planId  = payment.metadata?.plan_id as string;
  const days    = PLAN_DURATION_DAYS[planId] ?? 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  if (!userId || !planId) {
    console.error('[mp-webhook] Faltan userId o planId en metadata');
    return new Response('Metadata incompleta', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

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
