-- ══════════════════════════════════════════════════════
--  FIX: políticas de familia sin recursión
--  El problema anterior: family_members_select se referenciaba
--  a sí misma dentro de la evaluación de otras políticas RLS,
--  causando que todas las queries de expenses fallaran.
--  Solución: función SECURITY DEFINER que rompe la recursión.
-- ══════════════════════════════════════════════════════

-- Función auxiliar: retorna los group_ids del usuario actual
-- SECURITY DEFINER = corre sin RLS → no hay recursión
CREATE OR REPLACE FUNCTION get_my_group_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT group_id FROM family_members WHERE user_id = auth.uid();
$$;

-- family_groups: miembro puede ver los grupos a los que pertenece
DROP POLICY IF EXISTS "family_groups_select" ON family_groups;
CREATE POLICY "family_groups_select" ON family_groups
  FOR SELECT USING (
    id IN (SELECT get_my_group_ids())
  );

-- family_members: miembro puede ver a todos los integrantes de sus grupos
DROP POLICY IF EXISTS "family_members_select" ON family_members;
CREATE POLICY "family_members_select" ON family_members
  FOR SELECT USING (
    group_id IN (SELECT get_my_group_ids())
  );

-- family_members: insert propio (para unirse a un grupo)
DROP POLICY IF EXISTS "family_members_insert" ON family_members;
CREATE POLICY "family_members_insert" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());
