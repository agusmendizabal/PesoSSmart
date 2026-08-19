-- ══════════════════════════════════════════════════════
--  GRUPO FAMILIAR — Tablas, RLS y política de gastos
-- ══════════════════════════════════════════════════════

-- Grupos familiares
CREATE TABLE IF NOT EXISTS family_groups (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text        NOT NULL,
  invite_code  text        NOT NULL UNIQUE,
  created_at   timestamptz DEFAULT now()
);

-- Membresías (un usuario solo puede pertenecer a UN grupo)
CREATE TABLE IF NOT EXISTS family_members (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id   uuid        NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('parent', 'child')),
  joined_at  timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_family_members_group ON family_members(group_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user  ON family_members(user_id);

-- ── RLS ────────────────────────────────────────────────
ALTER TABLE family_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

-- family_groups: solo miembros del grupo lo ven
CREATE POLICY "family_groups_select" ON family_groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- family_groups: cualquier usuario autenticado puede crear un grupo
CREATE POLICY "family_groups_insert" ON family_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- family_groups: solo el padre/madre puede eliminar (disolver) el grupo
CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (
    id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role = 'parent'
    )
  );

-- family_members: los miembros ven todos los miembros de su grupo
CREATE POLICY "family_members_select" ON family_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM family_members WHERE user_id = auth.uid())
  );

-- family_members: cada usuario inserta su propia membresía
CREATE POLICY "family_members_insert" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- family_members: cada usuario puede eliminar su propia membresía
CREATE POLICY "family_members_delete" ON family_members
  FOR DELETE USING (user_id = auth.uid());

-- ── Política en expenses: padre puede leer gastos de hijos ──────────────
-- (se agrega a la política existente — Supabase combina SELECT con OR)
CREATE POLICY "parents_read_children_expenses" ON expenses
  FOR SELECT USING (
    user_id IN (
      SELECT fm_child.user_id
      FROM   family_members fm_parent
      JOIN   family_members fm_child
             ON fm_parent.group_id = fm_child.group_id
      WHERE  fm_parent.user_id = auth.uid()
        AND  fm_parent.role    = 'parent'
        AND  fm_child.role     = 'child'
        AND  fm_child.user_id != auth.uid()
    )
  );
