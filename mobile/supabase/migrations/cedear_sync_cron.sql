-- ══════════════════════════════════════════════════════════════════════════════
-- Setup: auto-sync mensual de retornos de CEDEARs/acciones de rubro
-- Ejecutar en Supabase → SQL Editor (una sola vez)
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Habilitar extensiones (si no están activas ya)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Crear job mensual (día 2 a las 12:00 UTC — los mercados ya cerraron el mes anterior)
--    El secret 'cedear2026pesossmart' debe coincidir con CEDEAR_SYNC_SECRET en Supabase Edge Functions → Secrets
SELECT cron.schedule(
  'cedear-monthly-sync',
  '0 12 2 * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/cedear-sync',
    headers := '{"Authorization":"Bearer cedear2026pesossmart","Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar que quedó registrado:
-- SELECT * FROM cron.job WHERE jobname = 'cedear-monthly-sync';

-- Para forzar una corrida manual de prueba:
-- SELECT net.http_post(
--   url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/cedear-sync',
--   headers := '{"Authorization":"Bearer cedear2026pesossmart","Content-Type":"application/json"}'::jsonb,
--   body    := '{}'::jsonb
-- );
