-- ══════════════════════════════════════════════════════
--  GRUPOS V2 — idempotente, corre sin errores aunque ya se haya aplicado parcialmente
-- ══════════════════════════════════════════════════════

-- 1. UNIQUE(user_id) → UNIQUE(user_id, group_id) para poder estar en varios grupos
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_id_key;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_group_unique;
ALTER TABLE family_members
  ADD CONSTRAINT family_members_user_group_unique UNIQUE(user_id, group_id);

-- 2. group_type: agregar 'friends'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'family_groups' AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%group_type%'
  LOOP EXECUTE 'ALTER TABLE family_groups DROP CONSTRAINT ' || r.constraint_name; END LOOP;
END $$;
ALTER TABLE family_groups ADD CONSTRAINT family_groups_group_type_check
  CHECK (group_type IN ('family', 'couple', 'friends'));

-- 3. role: agregar 'admin', 'member'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'family_members' AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%role%'
  LOOP EXECUTE 'ALTER TABLE family_members DROP CONSTRAINT ' || r.constraint_name; END LOOP;
END $$;
ALTER TABLE family_members ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner', 'admin', 'member'));

-- 4. Política insert: cualquier usuario autenticado puede crear un grupo
DROP POLICY IF EXISTS "family_groups_insert" ON family_groups;
CREATE POLICY "family_groups_insert" ON family_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 4b. Política delete: permitir rol 'admin' además de 'parent'
DROP POLICY IF EXISTS "family_groups_delete" ON family_groups;
DROP POLICY IF EXISTS "family_groups_couple_delete" ON family_groups;
CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (
    id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent', 'admin')
    )
  );

-- 5. Columna permissions en family_members
ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{
    "can_view_expenses": true,
    "can_add_expenses": true,
    "can_view_members": true,
    "can_invite": false,
    "can_manage_roles": false
  }'::jsonb;

-- 6. Tablas de gastos compartidos (amigos) — idempotentes
CREATE TABLE IF NOT EXISTS group_expenses (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id    uuid        NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  paid_by     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description text        NOT NULL,
  amount      numeric     NOT NULL CHECK (amount > 0),
  date        date        NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_expense_splits (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_expense_id uuid        NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount           numeric     NOT NULL CHECK (amount > 0),
  settled          boolean     NOT NULL DEFAULT false,
  settled_at       timestamptz,
  UNIQUE(group_expense_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_expenses_group   ON group_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_group_expenses_paid_by ON group_expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_splits_expense         ON group_expense_splits(group_expense_id);
CREATE INDEX IF NOT EXISTS idx_splits_user            ON group_expense_splits(user_id);

-- 7. RLS group_expenses (idempotente: drop antes de crear)
ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "group_expenses_select" ON group_expenses;
DROP POLICY IF EXISTS "group_expenses_insert" ON group_expenses;
DROP POLICY IF EXISTS "group_expenses_delete" ON group_expenses;
CREATE POLICY "group_expenses_select" ON group_expenses FOR SELECT USING (
  group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
);
CREATE POLICY "group_expenses_insert" ON group_expenses FOR INSERT WITH CHECK (
  paid_by = auth.uid()
  AND group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
);
CREATE POLICY "group_expenses_delete" ON group_expenses FOR DELETE USING (paid_by = auth.uid());

-- 8. RLS group_expense_splits (idempotente)
ALTER TABLE group_expense_splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "splits_select" ON group_expense_splits;
DROP POLICY IF EXISTS "splits_insert" ON group_expense_splits;
DROP POLICY IF EXISTS "splits_update" ON group_expense_splits;
CREATE POLICY "splits_select" ON group_expense_splits FOR SELECT USING (
  group_expense_id IN (
    SELECT id FROM group_expenses
    WHERE group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  )
);
CREATE POLICY "splits_insert" ON group_expense_splits FOR INSERT WITH CHECK (
  group_expense_id IN (SELECT id FROM group_expenses WHERE paid_by = auth.uid())
);
CREATE POLICY "splits_update" ON group_expense_splits FOR UPDATE USING (user_id = auth.uid());

-- 9. RPC: buscar grupo por código sin ser miembro
CREATE OR REPLACE FUNCTION find_group_by_invite_code(p_code TEXT)
RETURNS TABLE(id uuid, name text, group_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, group_type FROM family_groups
  WHERE invite_code = upper(trim(p_code));
$$;

-- 10. RPC: obtener miembros con email de auth.users (fix nombres vacíos)
CREATE OR REPLACE FUNCTION get_group_members(p_group_id UUID)
RETURNS TABLE(user_id UUID, role TEXT, permissions JSONB, full_name TEXT, email TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    fm.user_id,
    fm.role,
    COALESCE(fm.permissions, '{
      "can_view_expenses": true,
      "can_add_expenses": true,
      "can_view_members": true,
      "can_invite": false,
      "can_manage_roles": false
    }'::jsonb) AS permissions,
    COALESCE(NULLIF(trim(p.full_name), ''), '')  AS full_name,
    COALESCE(NULLIF(p.email, ''), u.email, '')   AS email
  FROM family_members fm
  LEFT JOIN public.profiles p ON p.id = fm.user_id
  LEFT JOIN auth.users u      ON u.id = fm.user_id
  WHERE fm.group_id = p_group_id
    AND p_group_id IN (
      SELECT group_id FROM family_members WHERE user_id = auth.uid()
    );
$$;

-- 11. RPC: cambiar rol (solo admin, protege último admin)
CREATE OR REPLACE FUNCTION update_member_role(
  p_group_id UUID, p_user_id UUID, p_role TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Solo admin puede cambiar roles
  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Sin permisos para cambiar roles.'; END IF;

  -- No puede cambiar su propio rol
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No podés cambiar tu propio rol.';
  END IF;

  -- Proteger último admin
  IF p_role != 'admin' THEN
    IF (
      SELECT COUNT(*) FROM family_members
      WHERE group_id = p_group_id AND role = 'admin' AND user_id != p_user_id
    ) = 0 THEN
      RAISE EXCEPTION 'El grupo debe tener al menos un Admin.';
    END IF;
  END IF;

  UPDATE family_members SET role = p_role
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

-- 12. RPC: actualizar permisos de un miembro (solo admin)
CREATE OR REPLACE FUNCTION update_member_permissions(
  p_group_id UUID, p_user_id UUID, p_permissions JSONB
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Sin permisos para editar permisos.'; END IF;

  UPDATE family_members SET permissions = p_permissions
  WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;
