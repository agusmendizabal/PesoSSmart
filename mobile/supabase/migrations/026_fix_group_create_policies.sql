-- ══════════════════════════════════════════════════════
--  FIX: políticas INSERT para creación de grupos
--  Problema: family_groups no tenía policy INSERT → RLS bloqueaba crear grupos.
--  Idempotente: DROP IF EXISTS antes de cada CREATE.
-- ══════════════════════════════════════════════════════

-- Cualquier usuario autenticado puede crear un grupo
DROP POLICY IF EXISTS "family_groups_insert" ON family_groups;
CREATE POLICY "family_groups_insert" ON family_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- El creador puede insertar su propia membresía (ya existe en fix_family_policies_v2, por seguridad se repite)
DROP POLICY IF EXISTS "family_members_insert" ON family_members;
CREATE POLICY "family_members_insert" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());
