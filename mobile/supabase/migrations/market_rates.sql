-- ══════════════════════════════════════════════════════════════════
--  MARKET RATES — Tasas de mercado actualizadas por cron
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_rates (
  instrument   text        PRIMARY KEY,  -- 'fci_mm' | 'lecap' | 'pf_uva' | 'dolar_mep' | 'cedear' | 'inflation'
  rate_monthly numeric(8, 4) NOT NULL,   -- Tasa efectiva mensual (ej: 3.0 = 3%)
  rate_annual  numeric(8, 4),            -- TEA calculada (puede ser null)
  source       text        NOT NULL DEFAULT 'manual', -- 'bcra' | 'bluelytics' | 'manual'
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Seed con valores actuales (Argentina, abril 2026)
INSERT INTO public.market_rates (instrument, rate_monthly, source) VALUES
  ('inflation', 3.4,  'bcra'),
  ('fci_mm',   3.0,  'manual'),
  ('lecap',    3.8,  'manual'),
  ('pf_uva',   3.5,  'manual'),
  ('dolar_mep',2.5,  'manual'),
  ('cedear',   4.0,  'manual')
ON CONFLICT (instrument) DO NOTHING;

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.market_rates ENABLE ROW LEVEL SECURITY;

-- Lectura pública para todos los usuarios autenticados
CREATE POLICY "market_rates_select" ON public.market_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Solo service_role puede escribir (edge functions con secret)
CREATE POLICY "market_rates_upsert" ON public.market_rates
  FOR ALL USING (auth.role() = 'service_role');
