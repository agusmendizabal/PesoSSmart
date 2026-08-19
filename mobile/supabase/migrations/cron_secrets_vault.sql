-- ══════════════════════════════════════════════════════════════════════════════
-- cron_secrets_vault.sql
-- Corrige un hallazgo crítico de la auditoría de seguridad (Fase 8A): los
-- secrets de estos 3 cron jobs (cedear2026pesossmart, indec2026pesossmart,
-- marketrates2026pesossmart) estaban hardcodeados en texto plano en migraciones
-- versionadas en git — públicos para cualquiera con acceso al repo/historial.
--
-- Este archivo NO contiene ningún valor de secret real: los headers ahora se
-- arman leyendo el valor desde Supabase Vault (`vault.decrypted_secrets`) en
-- tiempo de ejecución. Los valores nuevos se insertan en Vault por fuera de
-- este archivo (no versionado) y se rotan también como env var de cada edge
-- function vía `supabase secrets set`.
--
-- Requiere que ya existan en Vault los secrets:
--   cedear_sync_secret, indec_sync_secret, market_rates_sync_secret
-- ══════════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule('cedear-monthly-sync')       WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cedear-monthly-sync');
SELECT cron.unschedule('indec-monthly-sync')        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'indec-monthly-sync');
SELECT cron.unschedule('market-rates-weekly-sync')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-rates-weekly-sync');

SELECT cron.schedule(
  'cedear-monthly-sync',
  '0 12 2 * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/cedear-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cedear_sync_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'indec-monthly-sync',
  '0 12 16 * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/indec-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'indec_sync_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'market-rates-weekly-sync',
  '0 10 * * 1',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/fetch-market-rates',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'market_rates_sync_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar que quedaron registrados:
-- SELECT jobname, schedule FROM cron.job WHERE jobname IN ('cedear-monthly-sync','indec-monthly-sync','market-rates-weekly-sync');
