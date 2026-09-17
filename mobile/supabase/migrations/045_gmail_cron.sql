-- ══════════════════════════════════════════════════════════════════════════════
-- 045_gmail_cron.sql
-- Agrega columnas faltantes a gmail_connections y crea el cron job horario
-- que llama a gmail-cron-dispatcher para detectar gastos automáticamente.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Columnas que el código ya usa pero no existían en la migración original
ALTER TABLE gmail_connections
  ADD COLUMN IF NOT EXISTS token_expired boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_backfill_done boolean DEFAULT false;

-- Desregistrar si ya existía (idempotente)
SELECT cron.unschedule('gmail-hourly-poll')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gmail-hourly-poll');

-- Cron job: cada hora llama al dispatcher con INTERNAL_FN_SECRET desde Vault
SELECT cron.schedule(
  'gmail-hourly-poll',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/gmail-cron-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_fn_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar: SELECT jobname, schedule FROM cron.job WHERE jobname = 'gmail-hourly-poll';
