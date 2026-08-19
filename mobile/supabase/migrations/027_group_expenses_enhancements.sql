-- ══════════════════════════════════════════════════════
--  Mejoras a group_expenses para el flujo de amigos
--  Agrega: source_expense_id, split_type, created_by
--  Idempotente: ADD COLUMN IF NOT EXISTS
-- ══════════════════════════════════════════════════════

ALTER TABLE group_expenses
  ADD COLUMN IF NOT EXISTS source_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_type         TEXT NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS created_by         UUID REFERENCES auth.users(id);

-- Índice para buscar si un gasto personal ya fue compartido en un grupo
CREATE INDEX IF NOT EXISTS idx_group_expenses_source ON group_expenses(source_expense_id) WHERE source_expense_id IS NOT NULL;

-- ── RLS para group_expenses ───────────────────────────────────────────────────
ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;

-- Miembro del grupo puede ver gastos del grupo
DROP POLICY IF EXISTS "group_expenses_select" ON group_expenses;
CREATE POLICY "group_expenses_select" ON group_expenses
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- Miembro puede insertar gastos en su grupo
DROP POLICY IF EXISTS "group_expenses_insert" ON group_expenses;
CREATE POLICY "group_expenses_insert" ON group_expenses
  FOR INSERT WITH CHECK (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    AND auth.uid() IS NOT NULL
  );

-- ── RLS para group_expense_splits ─────────────────────────────────────────────
ALTER TABLE group_expense_splits ENABLE ROW LEVEL SECURITY;

-- Miembro del grupo puede ver todos los splits del grupo
DROP POLICY IF EXISTS "group_splits_select" ON group_expense_splits;
CREATE POLICY "group_splits_select" ON group_expense_splits
  FOR SELECT USING (
    group_expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE ge.group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    )
  );

-- Miembro puede insertar splits en gastos de su grupo
DROP POLICY IF EXISTS "group_splits_insert" ON group_expense_splits;
CREATE POLICY "group_splits_insert" ON group_expense_splits
  FOR INSERT WITH CHECK (
    group_expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE ge.group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    )
  );
