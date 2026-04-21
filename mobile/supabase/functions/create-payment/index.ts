import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PLAN_CONFIG: Record<string, { title: string; price: number }> = {
  pro:     { title: 'PesoSSmart Pro',     price: 3990 },
  premium: { title: 'PesoSSmart Premium', price: 7990 },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verificar JWT del usuario
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authErr || !user) return new Response('Unauthorized', { status: 401 });

    const { plan_id } = await req.json() as { plan_id: string };
    const plan = PLAN_CONFIG[plan_id];
    if (!plan) return new Response('Plan inválido', { status: 400 });

    // Obtener email del usuario para prefill en MP
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    // Crear preferencia en MercadoPago
    const prefBody = {
      items: [{
        id:          plan_id,
        title:       plan.title,
        quantity:    1,
        currency_id: 'ARS',
        unit_price:  plan.price,
      }],
      payer: { email: profile?.email ?? user.email },
      back_urls: {
        success: 'pesossmart://payment-success',
        failure: 'pesossmart://payment-failure',
        pending: 'pesossmart://payment-pending',
      },
      auto_return:        'approved',
      external_reference: user.id,           // para lookup en el webhook
      statement_descriptor: 'PESOSSMART',
      metadata: { plan_id, user_id: user.id },
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prefBody),
    });

    if (!mpRes.ok) {
      const err = await mpRes.text();
      console.error('[create-payment] MP error:', err);
      return new Response('Error al crear preferencia de pago', { status: 500, headers: corsHeaders });
    }

    const { id: preference_id, init_point, sandbox_init_point } = await mpRes.json();

    return new Response(
      JSON.stringify({
        preference_id,
        // En producción usar init_point; sandbox_init_point para testing
        init_point: Deno.env.get('MP_SANDBOX') === 'true' ? sandbox_init_point : init_point,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[create-payment]', err);
    return new Response('Internal error', { status: 500, headers: corsHeaders });
  }
});
