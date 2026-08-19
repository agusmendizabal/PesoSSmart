-- Expand market_rates with investment rates and category inflation
-- Run via: npx supabase db push (or execute in Supabase SQL editor)

-- Add a label column if it doesn't exist
ALTER TABLE market_rates ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE market_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ── Tasas de instrumentos financieros ────────────────────────────────────────
-- Valores iniciales representativos para Argentina 2026
-- (actualizar manualmente en Supabase cuando cambien las tasas de referencia)

INSERT INTO market_rates (instrument, rate_monthly, label) VALUES
  ('pf_30d',           2.8,  'Plazo Fijo 30d'),
  ('caucion_1d',       2.8,  'Caución bursátil 1d'),
  ('cuenta_remunerada',2.5,  'Cuenta remunerada'),
  ('lecap_monthly',    3.1,  'Lecap (TEA mensual)')
ON CONFLICT (instrument) DO NOTHING;

-- ── Inflación por rubro (INDEC IPC divisiones) ────────────────────────────────
-- Fuente: INDEC IPC mensual por división COICOP
-- Actualizar mensualmente con los datos del comunicado de prensa de INDEC

INSERT INTO market_rates (instrument, rate_monthly, label) VALUES
  ('inflation_food',      4.0, 'IPC Alimentos y bebidas'),
  ('inflation_clothing',  2.8, 'IPC Indumentaria'),
  ('inflation_housing',   3.8, 'IPC Vivienda y servicios'),
  ('inflation_health',    4.5, 'IPC Salud'),
  ('inflation_transport', 3.5, 'IPC Transporte'),
  ('inflation_comms',     2.5, 'IPC Comunicación'),
  ('inflation_recreation',3.2,'IPC Recreación y cultura'),
  ('inflation_education', 5.0, 'IPC Educación'),
  ('inflation_restaurants',4.2,'IPC Restaurantes y hoteles')
ON CONFLICT (instrument) DO NOTHING;
