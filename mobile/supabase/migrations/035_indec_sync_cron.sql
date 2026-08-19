-- ══════════════════════════════════════════════════════════════════════════════
-- Setup: auto-sync mensual de inflación INDEC
-- Ejecutar en Supabase → SQL Editor (una sola vez)
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Habilitar extensiones (si no están activas ya)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Crear job mensual (día 16 a las 12:00 UTC — INDEC publica alrededor del 14-15)
--    El secret 'indec2026pesossmart' debe coincidir con INDEC_SYNC_SECRET en Supabase Edge Functions → Secrets
SELECT cron.schedule(
  'indec-monthly-sync',
  '0 12 16 * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/indec-sync',
    headers := '{"Authorization":"Bearer indec2026pesossmart","Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar que quedó registrado:
-- SELECT * FROM cron.job WHERE jobname = 'indec-monthly-sync';

-- Para forzar una corrida manual de prueba:
-- SELECT net.http_post(
--   url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/indec-sync',
--   headers := '{"Authorization":"Bearer indec2026pesossmart","Content-Type":"application/json"}'::jsonb,
--   body    := '{}'::jsonb
-- );
