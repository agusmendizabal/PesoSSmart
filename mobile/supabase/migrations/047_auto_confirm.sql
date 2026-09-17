-- ══════════════════════════════════════════════════════════════════════════════
-- 047_auto_confirm.sql
-- Agrega flag high_confidence a pending_transactions y cron de auto-confirmación.
-- Las transacciones con alta confianza se auto-confirman después de 24h de inacción.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE pending_transactions
  ADD COLUMN IF NOT EXISTS high_confidence boolean DEFAULT false;

-- Cron: auto-confirmar transacciones de alta confianza cada 6 horas
SELECT cron.unschedule('auto-confirm-high-confidence')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-confirm-high-confidence');

SELECT cron.schedule(
  'auto-confirm-high-confidence',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/auto-confirm-transactions',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_fn_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
