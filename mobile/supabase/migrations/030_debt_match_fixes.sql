-- Fix 1: Deduplication — one suggestion per (tx, group, debtor)
ALTER TABLE debt_match_suggestions
  ADD CONSTRAINT IF NOT EXISTS unique_pending_match
  UNIQUE (pending_tx_id, group_id, debtor_user_id);

-- Fix 2: Partial payment tracking on splits
ALTER TABLE group_expense_splits
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0;
