-- ─────────────────────────────────────────────────────────────────────────────
-- fix_delete_user_account.sql
-- Corrige dos hallazgos críticos de la auditoría de seguridad (Fase 8A):
--   1. delete_user_account no validaba que el llamante fuera el dueño de la
--      cuenta que borra (SECURITY DEFINER + GRANT TO authenticated sin chequeo
--      interno de auth.uid()).
--   2. Borraba de una tabla "goals" que no existe (la real es savings_goals),
--      lo que abortaba toda la función (transacción implícita de plpgsql).
-- De paso, cierra el borrado de investments/chat_threads/mp_connections, que
-- quedaban con datos personales tras invocar la función.
--
-- Segunda pasada: agrega category_budgets/expense_receipts/debt_match_suggestions/
-- expense_edit_requests/group_transfers, que habían quedado explícitamente fuera
-- de alcance de la primera pasada. expense_edit_requests.reviewed_by no tiene
-- ON DELETE CASCADE hacia profiles — si no se limpia antes del DELETE FROM
-- profiles, ese último paso fallaría por violación de FK para cualquier usuario
-- que haya aprobado/rechazado una solicitud alguna vez.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- Soft-delete de gastos (respeta el patrón existente)
  UPDATE expenses
    SET deleted_at = NOW()
    WHERE user_id = p_user_id AND deleted_at IS NULL;

  -- Eliminar datos dependientes
  DELETE FROM ai_usage            WHERE user_id = p_user_id;
  DELETE FROM pending_transactions WHERE user_id = p_user_id;
  DELETE FROM gmail_connections   WHERE user_id = p_user_id;
  DELETE FROM savings_goals       WHERE user_id = p_user_id;
  DELETE FROM payment_logs        WHERE user_id = p_user_id;
  DELETE FROM family_members      WHERE user_id = p_user_id;
  DELETE FROM savings             WHERE user_id = p_user_id;
  DELETE FROM investments         WHERE user_id = p_user_id;
  DELETE FROM chat_threads        WHERE user_id = p_user_id; -- cascada a chat_history vía thread_id
  DELETE FROM mp_connections      WHERE user_id = p_user_id;
  DELETE FROM category_budgets    WHERE user_id = p_user_id;
  DELETE FROM expense_receipts    WHERE user_id = p_user_id;
  DELETE FROM debt_match_suggestions WHERE user_id = p_user_id OR debtor_user_id = p_user_id;
  DELETE FROM expense_edit_requests  WHERE requester_id = p_user_id OR reviewed_by = p_user_id;
  DELETE FROM group_transfers     WHERE from_user_id = p_user_id OR to_user_id = p_user_id;

  -- Eliminar perfil (dispara cascade en auth.users vía trigger, o eliminar manualmente)
  DELETE FROM profiles WHERE id = p_user_id;

  -- Eliminar usuario de Supabase Auth (requiere service role)
  PERFORM auth.users WHERE id = p_user_id; -- solo valida existencia
  -- La eliminación real de auth.users se hace desde el cliente con supabase.auth.admin.deleteUser()
  -- o desde la edge function con service role. El RPC limpia los datos de aplicación.
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account(UUID) TO authenticated;
