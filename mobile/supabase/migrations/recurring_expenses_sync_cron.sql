-- ══════════════════════════════════════════════════════════════════════════════
-- Setup: cron diario de "gastos fijos" (recurring-expenses-sync)
-- Ejecutar en Supabase → SQL Editor (una sola vez)
--
-- Registra solo, cada mes, los gastos que el usuario marcó como "GASTO FIJO"
-- (is_recurring=true, recurring_frequency='monthly') — alquiler, cuotas,
-- suscripciones. Sigue el mismo patrón de secret-en-Vault que cedear/indec/
-- market-rates (ver cron_secrets_vault.sql): el valor real nunca se versiona
-- en este archivo.
--
-- Requiere, antes de correr esto:
--   1. Insertar en Vault el secret 'recurring_expenses_sync_secret'
--      (Supabase Dashboard → Database → Vault → New secret)
--   2. Setear ese mismo valor como env var RECURRING_EXPENSES_SYNC_SECRET
--      de la edge function (supabase secrets set RECURRING_EXPENSES_SYNC_SECRET=...)
--   3. Deployar la función: npx supabase functions deploy recurring-expenses-sync
-- ══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('recurring-expenses-daily-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recurring-expenses-daily-sync');

-- Diario 09:00 UTC — corre todos los días porque cada gasto fijo puede tener
-- un día del mes distinto (alquiler el 5, Netflix el 12, etc.); la función
-- se encarga de no duplicar si ya generó la ocurrencia de este mes.
SELECT cron.schedule(
  'recurring-expenses-daily-sync',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/recurring-expenses-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'recurring_expenses_sync_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar que quedó registrado:
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'recurring-expenses-daily-sync';
