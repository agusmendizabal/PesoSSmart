-- Columnas de estado de sincronización para mp_connections
ALTER TABLE mp_connections
  ADD COLUMN IF NOT EXISTS last_sync_count  INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_status TEXT      NOT NULL DEFAULT 'never';

-- Columna redirect_url que faltaba en mp_oauth_states
ALTER TABLE mp_oauth_states
  ADD COLUMN IF NOT EXISTS redirect_url TEXT NOT NULL DEFAULT 'pesossmart://mp-connected';
