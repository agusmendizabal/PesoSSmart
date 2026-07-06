-- Limpieza automática de pending_transactions procesadas (confirmed/ignored)
-- Elimina registros con más de 30 días de antigüedad para mantener la tabla liviana.
-- Requiere la extensión pg_cron habilitada en Supabase (Dashboard → Extensions).

SELECT cron.schedule(
  'pending-transactions-cleanup',        -- nombre del job
  '0 3 * * *',                           -- todos los días a las 3 AM UTC
  $$
    DELETE FROM pending_transactions
    WHERE status IN ('confirmed', 'ignored')
      AND created_at < NOW() - INTERVAL '30 days';
  $$
);
