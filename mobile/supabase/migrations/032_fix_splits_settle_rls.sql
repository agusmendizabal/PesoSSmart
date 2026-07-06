-- Fix: allow the payer of a group_expense to settle any split within it.
-- The previous policy only allowed user_id = auth.uid() (the debtor),
-- which blocked the creditor from marking a split as settled.

DROP POLICY IF EXISTS "splits_update" ON group_expense_splits;

CREATE POLICY "splits_update" ON group_expense_splits
  FOR UPDATE USING (
    -- The debtor can mark their own split as settled
    user_id = auth.uid()
    OR
    -- The payer (acreedor) of the parent expense can settle any split in it
    group_expense_id IN (
      SELECT id FROM group_expenses WHERE paid_by = auth.uid()
    )
  );
