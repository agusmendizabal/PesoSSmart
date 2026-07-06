-- Tokens CSRF para el flujo OAuth de Gmail
-- Cada token es válido 10 minutos y se destruye tras su uso
CREATE TABLE IF NOT EXISTS gmail_oauth_states (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Limpieza automática de tokens expirados (pg_cron si está disponible)
-- Si no tenés pg_cron, los tokens expirados son ignorados por la check en el código
CREATE INDEX IF NOT EXISTS gmail_oauth_states_expires_at_idx ON gmail_oauth_states(expires_at);

-- Solo el service role puede leer/escribir esta tabla
ALTER TABLE gmail_oauth_states ENABLE ROW LEVEL SECURITY;
-- Sin políticas RLS = solo service role puede acceder
