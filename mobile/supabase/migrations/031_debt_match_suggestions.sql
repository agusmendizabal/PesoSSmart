-- Stores auto-detected payment-to-debt matches for user confirmation
CREATE TABLE IF NOT EXISTS debt_match_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  debtor_user_id  UUID NOT NULL,
  split_ids       UUID[] NOT NULL,
  debt_amount     NUMERIC NOT NULL,
  matched_amount  NUMERIC NOT NULL,
  match_type      TEXT NOT NULL CHECK (match_type IN ('exact', 'partial', 'excess')),
  pending_tx_id   UUID REFERENCES pending_transactions(id) ON DELETE CASCADE,
  status          TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE debt_match_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own debt suggestions"
  ON debt_match_suggestions FOR ALL
  USING (auth.uid() = user_id);
