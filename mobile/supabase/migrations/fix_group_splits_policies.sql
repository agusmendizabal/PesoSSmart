-- ─────────────────────────────────────────────────────────────────────────────
-- fix_group_splits_policies.sql
-- Corrige dos hallazgos altos de la auditoría de seguridad (Fase 8A):
--
-- 1. group_expense_splits tenía dos policies INSERT/SELECT *permissive*
--    activas en paralelo (se combinan con OR): "splits_insert" (correcta,
--    solo el pagador puede insertar) y "group_splits_insert" (remanente de
--    group_expenses_enhancements.sql, nunca dropeada, permitía a CUALQUIER
--    miembro del grupo insertar un split asignándole deuda a otro miembro sin
--    ser el pagador). Se dropean las dos policies redundantes/más amplias,
--    dejando vigentes solo "splits_select"/"splits_insert".
--
-- 2. family_groups UPDATE/DELETE quedaron abiertas a "cualquier miembro" del
--    grupo (id IN get_my_group_ids()) en fix_groups_rls_v2.sql, más amplio
--    que las versiones previas (que restringían a owner_id o roles
--    admin/parent/partner). Se restaura esa restricción.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "group_splits_select" ON group_expense_splits;
DROP POLICY IF EXISTS "group_splits_insert" ON group_expense_splits;

DROP POLICY IF EXISTS "family_groups_update" ON family_groups;
DROP POLICY IF EXISTS "family_groups_delete" ON family_groups;

CREATE POLICY "family_groups_update" ON family_groups
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members
      WHERE group_id = family_groups.id
        AND user_id = auth.uid()
        AND role IN ('admin', 'parent', 'partner')
    )
  );

CREATE POLICY "family_groups_delete" ON family_groups
  FOR DELETE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM family_members
      WHERE group_id = family_groups.id
        AND user_id = auth.uid()
        AND role IN ('admin', 'parent', 'partner')
    )
  );
