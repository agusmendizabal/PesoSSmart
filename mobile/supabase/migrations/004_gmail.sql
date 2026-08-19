-- Conexiones Gmail de cada usuario
CREATE TABLE IF NOT EXISTS gmail_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  gmail_email text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  last_checked_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own gmail connections"
  ON gmail_connections FOR ALL
  USING (auth.uid() = user_id);

-- Gastos detectados esperando confirmación del usuario
CREATE TABLE IF NOT EXISTS pending_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL DEFAULT 'gmail',
  amount numeric NOT NULL,
  currency text DEFAULT 'ARS',
  merchant text,
  suggested_category text,
  description text,
  transaction_date date,
  raw_subject text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pending_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pending transactions"
  ON pending_transactions FOR ALL
  USING (auth.uid() = user_id);