-- RPC para que el admin apruebe una solicitud de edición de gasto.
-- SECURITY DEFINER bypasea RLS, pero valida internamente que el caller sea admin.

CREATE OR REPLACE FUNCTION approve_expense_edit_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request  expense_edit_requests%ROWTYPE;
  v_is_admin BOOLEAN;
  v_updates  JSONB := '{}';
BEGIN
  -- Traer la solicitud
  SELECT * INTO v_request
  FROM expense_edit_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'request_not_found');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'already_reviewed');
  END IF;

  -- Verificar que quien llama es admin del grupo
  SELECT EXISTS (
    SELECT 1 FROM family_members
    WHERE group_id = v_request.group_id
      AND user_id  = auth.uid()
      AND role IN ('admin', 'parent', 'partner')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'not_admin');
  END IF;

  -- Aplicar cambios al gasto
  IF v_request.proposed_amount IS NOT NULL AND v_request.proposed_description IS NOT NULL THEN
    UPDATE expenses
    SET amount      = v_request.proposed_amount,
        description = v_request.proposed_description
    WHERE id = v_request.expense_id;
  ELSIF v_request.proposed_amount IS NOT NULL THEN
    UPDATE expenses
    SET amount = v_request.proposed_amount
    WHERE id   = v_request.expense_id;
  ELSIF v_request.proposed_description IS NOT NULL THEN
    UPDATE expenses
    SET description = v_request.proposed_description
    WHERE id        = v_request.expense_id;
  ELSE
    RETURN jsonb_build_object('error', 'no_changes');
  END IF;

  -- Marcar solicitud como aprobada
  UPDATE expense_edit_requests
  SET status      = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
