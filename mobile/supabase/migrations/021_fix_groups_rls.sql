-- ══════════════════════════════════════════════════════════════════════════════
-- fix_groups_rls.sql
-- Resetea completamente las políticas RLS y constraints de tablas de grupos.
-- Idempotente: se puede correr varias veces sin error.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Borrar TODAS las políticas existentes ──────────────────────────────────

DROP POLICY IF EXISTS "family_groups_select"              ON family_groups;
DROP POLICY IF EXISTS "family_groups_insert"              ON family_groups;
DROP POLICY IF EXISTS "family_groups_update"              ON family_groups;
DROP POLICY IF EXISTS "family_groups_delete"              ON family_groups;
DROP POLICY IF EXISTS "family_groups_couple_delete"       ON family_groups;

DROP POLICY IF EXISTS "family_members_select"             ON family_members;
DROP POLICY IF EXISTS "family_members_insert"             ON family_members;
DROP POLICY IF EXISTS "family_members_update"             ON family_members;
DROP POLICY IF EXISTS "family_members_delete"             ON family_members;

-- ── 2. Asegurar RLS habilitado ────────────────────────────────────────────────

ALTER TABLE family_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

-- ── 3. Políticas para family_groups ──────────────────────────────────────────

-- Cualquier usuario autenticado puede crear un grupo
CREATE POLICY "family_groups_insert" ON family_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Los miembros ven solo los grupos a los que pertenecen
CREATE POLICY "family_groups_select" ON family_groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- El owner o un admin/parent puede actualizar el grupo
CREATE POLICY "family_groups_update" ON family_groups
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent', 'admin')
    )
  );

-- El owner, admin o parent puede eliminar el grupo
CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('parent', 'admin', 'partner')
    )
  );

-- ── 4. Políticas para family_members ─────────────────────────────────────────

-- Cualquier usuario autenticado puede insertar su propia membresía
CREATE POLICY "family_members_insert" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Los miembros ven a todos los miembros de sus grupos
CREATE POLICY "family_members_select" ON family_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- Cada usuario puede actualizar solo su propia fila
CREATE POLICY "family_members_update" ON family_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Cada usuario puede abandonar su grupo (eliminar su propia membresía)
CREATE POLICY "family_members_delete" ON family_members
  FOR DELETE USING (user_id = auth.uid());

-- ── 5. Constraint UNIQUE — un usuario puede estar en VARIOS grupos ────────────

ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_id_key;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_user_group_unique;
ALTER TABLE family_members
  ADD CONSTRAINT family_members_user_group_unique UNIQUE(user_id, group_id);

-- ── 6. Constraint de roles — incluye TODOS los roles usados en la app ─────────

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE  table_name = 'family_members'
      AND  constraint_type = 'CHECK'
      AND  constraint_name LIKE '%role%'
  LOOP
    EXECUTE 'ALTER TABLE family_members DROP CONSTRAINT "' || r.constraint_name || '"';
  END LOOP;
END $$;

ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner', 'guardian', 'other_adult', 'admin', 'member'));

-- ── 7. Constraint de group_type — incluye 'friends' ──────────────────────────

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE  table_name = 'family_groups'
      AND  constraint_type = 'CHECK'
      AND  constraint_name LIKE '%group_type%'
  LOOP
    EXECUTE 'ALTER TABLE family_groups DROP CONSTRAINT "' || r.constraint_name || '"';
  END LOOP;
END $$;

ALTER TABLE family_groups
  ADD CONSTRAINT family_groups_group_type_check
  CHECK (group_type IN ('family', 'couple', 'friends'));

-- ── 8. Asegurar owner_id existe (por si group_transfers.sql no se corrió) ─────

ALTER TABLE family_groups
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 9. RPC find_group_by_invite_code (idempotente) ───────────────────────────

CREATE OR REPLACE FUNCTION find_group_by_invite_code(p_code TEXT)
RETURNS TABLE(id uuid, name text, group_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, group_type
  FROM   family_groups
  WHERE  invite_code = upper(trim(p_code));
$$;
