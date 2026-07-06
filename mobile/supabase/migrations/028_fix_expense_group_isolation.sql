-- ══════════════════════════════════════════════════════════════════════════════
-- fix_expense_group_isolation.sql
--
-- Fixes:
--   1. Adds source_pending_id to expenses (referenced in code, missing from schema)
--   2. Adds 'rejected' to pending_transactions status constraint
--   3. RLS: users can update own expenses (covers soft-delete via UPDATE)
--   4. RPC: check if an expense is linked to a group (used by the client
--      before allowing deletion from personal view)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. source_pending_id en expenses ─────────────────────────────────────────

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_pending_id UUID
    REFERENCES public.pending_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_source_pending
  ON public.expenses(source_pending_id)
  WHERE source_pending_id IS NOT NULL;

-- ── 2. Fix constraint de status en pending_transactions ───────────────────────

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_status_check;

ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_status_check
  CHECK (status IN ('pending', 'confirmed', 'ignored', 'rejected'));

-- ── 3. RPC: verificar si un gasto está vinculado a un grupo ──────────────────
-- Retorna TRUE si el expense tiene al menos un group_expense que lo referencia.
-- SECURITY DEFINER para que el cliente pueda consultar group_expenses sin
-- necesitar la policy de select en todos los grupos.

CREATE OR REPLACE FUNCTION expense_has_group_link(p_expense_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_expenses
    WHERE source_expense_id = p_expense_id
  );
$$;
