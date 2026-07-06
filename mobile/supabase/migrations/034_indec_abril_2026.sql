-- Actualización manual: INDEC IPC Abril 2026
-- Fuente: INDEC comunicado de prensa, 14/05/2026
-- Variación general: 2.6% mensual (acumulado 12 meses: 32.4%)
-- Estos valores son reemplazados automáticamente por la función indec-sync cada mes.

INSERT INTO market_rates (instrument, rate_monthly, label, updated_at) VALUES
  ('inflation',             2.6,  'IPC Nivel General',            now()),
  ('inflation_food',        1.5,  'IPC Alimentos y bebidas',      now()),
  ('inflation_clothing',    3.8,  'IPC Indumentaria',             now()),
  ('inflation_housing',     3.2,  'IPC Vivienda y servicios',     now()),
  ('inflation_equipment',   1.3,  'IPC Equipamiento del hogar',   now()),
  ('inflation_health',      3.1,  'IPC Salud',                    now()),
  ('inflation_transport',   4.4,  'IPC Transporte',               now()),
  ('inflation_comms',       4.1,  'IPC Comunicación',             now()),
  ('inflation_recreation',  1.0,  'IPC Recreación y cultura',     now()),
  ('inflation_education',   4.2,  'IPC Educación',                now()),
  ('inflation_restaurants', 2.8,  'IPC Restaurantes y hoteles',   now())
ON CONFLICT (instrument) DO UPDATE SET
  rate_monthly = EXCLUDED.rate_monthly,
  updated_at   = now();
