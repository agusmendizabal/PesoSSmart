ALTER TABLE debt_match_suggestions
  ADD COLUMN IF NOT EXISTS is_ambiguous BOOLEAN DEFAULT false;
