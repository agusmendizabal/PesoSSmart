-- ── Mercado Pago connections ──────────────────────────────────────────────────
-- Stores OAuth tokens for each user's connected MP account.
-- Encrypted with AES-GCM using GMAIL_ENCRYPTION_KEY (same key reused).

CREATE TABLE IF NOT EXISTS mp_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  mp_user_id      TEXT NOT NULL,
  mp_email        TEXT,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT (now() - INTERVAL '30 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own mp_connection"
  ON mp_connections FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── MP OAuth CSRF states ───────────────────────────────────────────────────────
-- Temporary table for OAuth state tokens (10-minute TTL, consumed on use).

CREATE TABLE IF NOT EXISTS mp_oauth_states (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
