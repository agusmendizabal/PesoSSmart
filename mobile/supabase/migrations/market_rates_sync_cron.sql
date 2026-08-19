-- ══════════════════════════════════════════════════════════════════════════════
-- Setup: auto-sync semanal de tasas de mercado (BCRA)
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- Hallazgo (Fase 3 de Plan Inteligente): la función `fetch-market-rates` ya
-- existía y trae inflación/tasa Badlar reales del BCRA hacia `market_rates`,
-- pero no tenía ningún cron que la llamara — el `updated_at` de esa tabla podía
-- quedar desactualizado indefinidamente sin que nada lo reflejara. Se agrega acá
-- el mismo patrón ya usado para indec-sync y cedear-sync.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Habilitar extensiones (si no están activas ya)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Crear job semanal (lunes 10:00 UTC — el BCRA publica sus series semanalmente)
--    El secret 'marketrates2026pesossmart' debe coincidir con MARKET_RATES_SYNC_SECRET
--    en Supabase Edge Functions → Secrets
SELECT cron.schedule(
  'market-rates-weekly-sync',
  '0 10 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/fetch-market-rates',
    headers := '{"Authorization":"Bearer marketrates2026pesossmart","Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar que quedó registrado:
-- SELECT * FROM cron.job WHERE jobname = 'market-rates-weekly-sync';

-- Para forzar una corrida manual de prueba:
-- SELECT net.http_post(
--   url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/fetch-market-rates',
--   headers := '{"Authorization":"Bearer marketrates2026pesossmart","Content-Type":"application/json"}'::jsonb,
--   body    := '{}'::jsonb
-- );
