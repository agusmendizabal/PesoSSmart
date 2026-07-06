-- ══════════════════════════════════════════════════════
--  GRUPO FAMILIAR: admin puede leer gastos de sus miembros
--  Enfoque: política RLS adicional en expenses (sin RPCs, sin GRANTs manuales).
--  Las políticas PERMISSIVE se unen con OR → no rompe acceso propio existente.
-- ══════════════════════════════════════════════════════

-- Limpiar RPCs anteriores si se crearon
DROP FUNCTION IF EXISTS get_family_member_expenses(UUID, TEXT);
DROP FUNCTION IF EXISTS get_member_expenses_for_admin(UUID, UUID, TEXT);

-- Nueva política: admin de grupo familiar puede leer gastos de los miembros
DROP POLICY IF EXISTS "family_admin_read_member_expenses" ON expenses;

CREATE POLICY "family_admin_read_member_expenses"
ON expenses FOR SELECT
USING (
  -- El admin puede leer si:
  --   1. Existe en family_members como admin/parent/partner de un grupo 'family'
  --   2. El dueño del gasto (expenses.user_id) es miembro del mismo grupo
  EXISTS (
    SELECT 1
    FROM family_members fm_admin
    JOIN family_members fm_member
      ON  fm_member.group_id = fm_admin.group_id
      AND fm_member.user_id  = expenses.user_id
      AND fm_member.role    IN ('member', 'child')
    JOIN family_groups fg
      ON  fg.id          = fm_admin.group_id
      AND fg.group_type  = 'family'
    WHERE fm_admin.user_id = auth.uid()
      AND fm_admin.role   IN ('admin', 'parent', 'partner')
  )
);
