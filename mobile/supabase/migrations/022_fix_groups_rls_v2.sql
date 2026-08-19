-- ══════════════════════════════════════════════════════════════════════════════
-- fix_groups_rls_v2.sql
-- Corrige infinite recursion en políticas RLS de grupos.
-- Usa función SECURITY DEFINER para romper la recursión.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Función helper — bypasea RLS para obtener group_ids del usuario ─────────
-- SECURITY DEFINER corre como el owner (postgres), sin aplicar RLS,
-- por eso no cae en recursión cuando las policies la llaman.
CREATE OR REPLACE FUNCTION get_my_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT group_id FROM family_members WHERE user_id = auth.uid();
$$;

-- ── 2. Borrar TODAS las políticas existentes ──────────────────────────────────

DROP POLICY IF EXISTS "family_groups_select"        ON family_groups;
DROP POLICY IF EXISTS "family_groups_insert"        ON family_groups;
DROP POLICY IF EXISTS "family_groups_update"        ON family_groups;
DROP POLICY IF EXISTS "family_groups_delete"        ON family_groups;
DROP POLICY IF EXISTS "family_groups_couple_delete" ON family_groups;

DROP POLICY IF EXISTS "family_members_select"       ON family_members;
DROP POLICY IF EXISTS "family_members_insert"       ON family_members;
DROP POLICY IF EXISTS "family_members_update"       ON family_members;
DROP POLICY IF EXISTS "family_members_delete"       ON family_members;

DROP POLICY IF EXISTS "group_expenses_select"       ON group_expenses;
DROP POLICY IF EXISTS "group_expenses_insert"       ON group_expenses;
DROP POLICY IF EXISTS "group_expenses_delete"       ON group_expenses;

DROP POLICY IF EXISTS "splits_select"               ON group_expense_splits;
DROP POLICY IF EXISTS "splits_insert"               ON group_expense_splits;
DROP POLICY IF EXISTS "splits_update"               ON group_expense_splits;

-- ── 3. Asegurar RLS habilitado ────────────────────────────────────────────────

ALTER TABLE family_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members       ENABLE ROW LEVEL SECURITY;

-- ── 4. Políticas family_groups — usan get_my_group_ids() ─────────────────────

CREATE POLICY "family_groups_insert" ON family_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "family_groups_select" ON family_groups
  FOR SELECT USING (id IN (SELECT get_my_group_ids()));

CREATE POLICY "family_groups_update" ON family_groups
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR id IN (SELECT get_my_group_ids())
  );

CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (
    owner_id = auth.uid()
    OR id IN (SELECT get_my_group_ids())
  );

-- ── 5. Políticas family_members — sin auto-referencia ────────────────────────

-- INSERT: solo tu propia membresía (sin subquery a family_members)
CREATE POLICY "family_members_insert" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- SELECT: usa get_my_group_ids() para evitar recursión
CREATE POLICY "family_members_select" ON family_members
  FOR SELECT USING (group_id IN (SELECT get_my_group_ids()));

-- UPDATE: solo tu propia fila
CREATE POLICY "family_members_update" ON family_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: solo tu propia fila
CREATE POLICY "family_members_delete" ON family_members
  FOR DELETE USING (user_id = auth.uid());

-- ── 6. Políticas group_expenses (si la tabla existe) ─────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_expenses') THEN
    ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE POLICY "group_expenses_select" ON group_expenses
  FOR SELECT USING (group_id IN (SELECT get_my_group_ids()));

CREATE POLICY "group_expenses_insert" ON group_expenses
  FOR INSERT WITH CHECK (
    paid_by = auth.uid()
    AND group_id IN (SELECT get_my_group_ids())
  );

CREATE POLICY "group_expenses_delete" ON group_expenses
  FOR DELETE USING (paid_by = auth.uid());

-- ── 7. Políticas group_expense_splits (si la tabla existe) ───────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'group_expense_splits') THEN
    ALTER TABLE group_expense_splits ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE POLICY "splits_select" ON group_expense_splits
  FOR SELECT USING (
    group_expense_id IN (
      SELECT id FROM group_expenses WHERE group_id IN (SELECT get_my_group_ids())
    )
  );

CREATE POLICY "splits_insert" ON group_expense_splits
  FOR INSERT WITH CHECK (
    group_expense_id IN (SELECT id FROM group_expenses WHERE paid_by = auth.uid())
  );

CREATE POLICY "splits_update" ON group_expense_splits
  FOR UPDATE USING (user_id = auth.uid());

-- ── 8. Constraints ────────────────────────────────────────────────────────────

-- UNIQUE(user_id, group_id): permite estar en varios grupos
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_id_key;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_group_unique;
ALTER TABLE family_members
  ADD CONSTRAINT family_members_user_group_unique UNIQUE(user_id, group_id);

-- Roles: todos los valores usados en la app
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE  table_name = 'family_members' AND constraint_type = 'CHECK'
      AND  constraint_name LIKE '%role%'
  LOOP
    EXECUTE 'ALTER TABLE family_members DROP CONSTRAINT "' || r.constraint_name || '"';
  END LOOP;
END $$;

ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner', 'guardian', 'other_adult', 'admin', 'member'));

-- group_type: incluye 'friends'
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE  table_name = 'family_groups' AND constraint_type = 'CHECK'
      AND  constraint_name LIKE '%group_type%'
  LOOP
    EXECUTE 'ALTER TABLE family_groups DROP CONSTRAINT "' || r.constraint_name || '"';
  END LOOP;
END $$;

ALTER TABLE family_groups
  ADD CONSTRAINT family_groups_group_type_check
  CHECK (group_type IN ('family', 'couple', 'friends'));

-- owner_id (por si group_transfers.sql no se corrió antes)
ALTER TABLE family_groups
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 9. RPC find_group_by_invite_code ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION find_group_by_invite_code(p_code TEXT)
RETURNS TABLE(id uuid, name text, group_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, group_type FROM family_groups
  WHERE  invite_code = upper(trim(p_code));
$$;
