-- ══════════════════════════════════════════════════════════════════════════════
-- 046_outlook_connections.sql
-- Tabla para conexiones Outlook/Hotmail (equivalente a gmail_connections).
-- Requiere registrar una app en portal.azure.com — ver acciones manuales.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS outlook_connections (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  outlook_email    text        NOT NULL,
  access_token     text        NOT NULL,
  refresh_token    text        NOT NULL,
  token_expired    boolean     DEFAULT false,
  last_checked_at  timestamptz DEFAULT (now() - interval '90 days'),
  is_backfill_done boolean     DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE outlook_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own outlook connection"
  ON outlook_connections FOR ALL
  USING (auth.uid() = user_id);

-- Agregar outlook-poll al cron job horario
-- El dispatcher ya llama a outlook-cron-dispatcher (mismo patrón que gmail)
SELECT cron.unschedule('outlook-hourly-poll')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outlook-hourly-poll');

SELECT cron.schedule(
  'outlook-hourly-poll',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://gqflukmlaonkgxfdbedq.supabase.co/functions/v1/outlook-cron-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_fn_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
