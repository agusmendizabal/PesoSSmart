-- ══════════════════════════════════════════════════════
--  GRUPOS V2 — Amigos, roles admin/member, gastos grupales
-- ══════════════════════════════════════════════════════

-- 1. Agregar tipo 'friends'
ALTER TABLE family_groups
  DROP CONSTRAINT IF EXISTS family_groups_group_type_check;

ALTER TABLE family_groups
  ADD CONSTRAINT family_groups_group_type_check
  CHECK (group_type IN ('family', 'couple', 'friends'));

-- 2. Agregar roles 'admin' y 'member'
ALTER TABLE family_members
  DROP CONSTRAINT IF EXISTS family_members_role_check;

ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner', 'admin', 'member'));

-- 3. Tabla de gastos grupales (solo para grupos de amigos)
CREATE TABLE IF NOT EXISTS group_expenses (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    uuid        NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  paid_by     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text        NOT NULL,
  amount      numeric     NOT NULL CHECK (amount > 0),
  date        date        NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_expenses_group   ON group_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_group_expenses_paid_by ON group_expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_group_expenses_date    ON group_expenses(date DESC);

-- 4. Tabla de divisiones por gasto
CREATE TABLE IF NOT EXISTS group_expense_splits (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_expense_id uuid        NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount           numeric     NOT NULL CHECK (amount > 0),
  settled          boolean     NOT NULL DEFAULT false,
  settled_at       timestamptz,
  UNIQUE(group_expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_splits_expense ON group_expense_splits(group_expense_id);
CREATE INDEX IF NOT EXISTS idx_splits_user    ON group_expense_splits(user_id);

-- 5. RLS para group_expenses
ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_expenses_select" ON group_expenses
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "group_expenses_insert" ON group_expenses
  FOR INSERT WITH CHECK (
    paid_by = auth.uid()
    AND group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

CREATE POLICY "group_expenses_delete" ON group_expenses
  FOR DELETE USING (paid_by = auth.uid());

-- 6. RLS para group_expense_splits
ALTER TABLE group_expense_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "splits_select" ON group_expense_splits
  FOR SELECT USING (
    group_expense_id IN (
      SELECT id FROM group_expenses
      WHERE group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "splits_insert" ON group_expense_splits
  FOR INSERT WITH CHECK (
    group_expense_id IN (
      SELECT id FROM group_expenses WHERE paid_by = auth.uid()
    )
  );

CREATE POLICY "splits_update" ON group_expense_splits
  FOR UPDATE USING (user_id = auth.uid());
