-- ══════════════════════════════════════════════════════
--  RPC: create_group_with_admin
--  Crea el grupo y agrega al creador como admin en una sola transacción.
--  SECURITY DEFINER: evita depender de RLS para los inserts de creación.
--  Seguridad: usa auth.uid() internamente, nunca acepta user_id del frontend.
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_group_with_admin(
  p_name        TEXT,
  p_group_type  TEXT,
  p_invite_code TEXT
)
RETURNS TABLE(id UUID, invite_code TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id  UUID;
  v_group_id UUID;
BEGIN
  -- El creador debe estar autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Validar group_type
  IF p_group_type NOT IN ('family', 'friends', 'couple') THEN
    RAISE EXCEPTION 'Tipo de grupo inválido: %', p_group_type;
  END IF;

  -- Validar nombre
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'El nombre del grupo no puede estar vacío';
  END IF;

  -- Insertar el grupo
  INSERT INTO family_groups (name, group_type, invite_code)
  VALUES (trim(p_name), p_group_type, upper(trim(p_invite_code)))
  RETURNING family_groups.id INTO v_group_id;

  -- Insertar el creador como admin
  INSERT INTO family_members (group_id, user_id, role)
  VALUES (v_group_id, v_user_id, 'admin');

  -- Devolver datos del grupo creado
  RETURN QUERY
    SELECT v_group_id, upper(trim(p_invite_code));
END;
$$;

-- Permitir que usuarios autenticados ejecuten la función
GRANT EXECUTE ON FUNCTION create_group_with_admin(TEXT, TEXT, TEXT) TO authenticated;
