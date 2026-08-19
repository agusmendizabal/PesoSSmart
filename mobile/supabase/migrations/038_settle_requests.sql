-- Two-step settlement: debtor signals payment, creditor confirms or rejects.
-- settle_requested_at = null  → no pending request
-- settle_requested_at = <ts>  → debtor marked as paid, waiting for creditor confirmation

ALTER TABLE group_expense_splits
  ADD COLUMN IF NOT EXISTS settle_requested_at TIMESTAMPTZ;

-- Existing splits_update policy (from fix_splits_settle_rls.sql) already allows:
--   debtor  (user_id = auth.uid()) → can update their own row (set settle_requested_at)
--   creditor (paid_by = auth.uid()) → can update splits of their expenses (confirm/reject)
-- No additional policy change needed.
