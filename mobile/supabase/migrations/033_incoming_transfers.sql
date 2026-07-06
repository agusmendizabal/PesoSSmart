-- Add direction + sender_name to pending_transactions for incoming transfer detection
ALTER TABLE pending_transactions
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'outgoing'
    CHECK (direction IN ('outgoing', 'incoming'));

ALTER TABLE pending_transactions
  ADD COLUMN IF NOT EXISTS sender_name TEXT;
