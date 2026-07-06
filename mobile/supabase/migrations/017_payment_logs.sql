-- ══════════════════════════════════════════════════════════════════
--  PAYMENT LOGS — Auditoría de pagos procesados vía MercadoPago
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payment_logs (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_id  text        NOT NULL UNIQUE,   -- ID de MercadoPago
  plan_id     text        NOT NULL,
  amount      numeric(12, 2),
  currency    text        DEFAULT 'ARS',
  status      text        NOT NULL,          -- 'approved' | 'rejected' | 'pending'
  mp_data     jsonb,                         -- payload completo de MP (para debugging)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_user ON public.payment_logs(user_id, created_at DESC);

ALTER TABLE public.payment_logs ENABLE ROW LEVEL SECURITY;

-- El usuario puede ver sus propios pagos
CREATE POLICY "payment_logs_select" ON public.payment_logs
  FOR SELECT USING (user_id = auth.uid());

-- Solo service_role puede insertar (desde el webhook)
CREATE POLICY "payment_logs_insert" ON public.payment_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
