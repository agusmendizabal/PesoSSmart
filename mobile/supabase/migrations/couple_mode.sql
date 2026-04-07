-- ══════════════════════════════════════════════════════
--  MODO PAREJA — Extensión del grupo familiar
-- ══════════════════════════════════════════════════════

-- 1. Tipo de grupo: family (padre/hijo) o couple (pareja)
ALTER TABLE family_groups
  ADD COLUMN IF NOT EXISTS group_type text DEFAULT 'family'
  CHECK (group_type IN ('family', 'couple'));

-- 2. Rol 'partner' para modo pareja
ALTER TABLE family_members
  DROP CONSTRAINT IF EXISTS family_members_role_check;

ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('parent', 'child', 'partner'));

-- 3. Gastos compartidos (split 50/50 entre pareja)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_shared boolean DEFAULT false;

-- 4. RLS: cada partner puede leer los gastos del otro
CREATE POLICY "partners_read_each_others_expenses" ON expenses
  FOR SELECT USING (
    user_id IN (
      SELECT fm_other.user_id
      FROM   family_members fm_me
      JOIN   family_members fm_other ON fm_me.group_id = fm_other.group_id
      JOIN   family_groups  fg       ON fg.id = fm_me.group_id
      WHERE  fm_me.user_id  = auth.uid()
        AND  fg.group_type  = 'couple'
        AND  fm_other.user_id != auth.uid()
    )
  );

-- 5. Política de delete para couple: cualquier partner puede disolver
CREATE POLICY "family_groups_couple_delete" ON family_groups
  FOR DELETE USING (
    id IN (
      SELECT group_id FROM family_members
      WHERE user_id = auth.uid() AND role = 'partner'
    )
  );
