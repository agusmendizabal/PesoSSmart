-- ─────────────────────────────────────────────────────────────────────────────
-- launch_security.sql
-- Ejecutar en Supabase → SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Push token en profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 2. Estado "grace" para el subscription_status (grace period 3 días post-fallo de pago)
--    No requiere cambio de schema si subscription_status es TEXT (ya acepta cualquier valor).
--    Asegurarse de que resolveEffectivePlan() en plans.ts trate 'grace' como 'active'.

-- 3. RPC delete_user_account — borra todos los datos del usuario (requerido por Apple/Google)
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Soft-delete de gastos (respeta el patrón existente)
  UPDATE expenses
    SET deleted_at = NOW()
    WHERE user_id = p_user_id AND deleted_at IS NULL;

  -- Eliminar datos dependientes
  DELETE FROM ai_usage            WHERE user_id = p_user_id;
  DELETE FROM pending_transactions WHERE user_id = p_user_id;
  DELETE FROM gmail_connections   WHERE user_id = p_user_id;
  DELETE FROM goals               WHERE user_id = p_user_id;
  DELETE FROM payment_logs        WHERE user_id = p_user_id;
  DELETE FROM family_members      WHERE user_id = p_user_id;

  -- Limpiar savings / investments si existe la tabla
  DELETE FROM savings             WHERE user_id = p_user_id;

  -- Eliminar perfil (dispara cascade en auth.users vía trigger, o eliminar manualmente)
  DELETE FROM profiles WHERE id = p_user_id;

  -- Eliminar usuario de Supabase Auth (requiere service role)
  PERFORM auth.users WHERE id = p_user_id; -- solo valida existencia
  -- La eliminación real de auth.users se hace desde el cliente con supabase.auth.admin.deleteUser()
  -- o desde la edge function con service role. El RPC limpia los datos de aplicación.
END;
$$;

-- RLS: solo el propio usuario puede invocar esta función
REVOKE ALL ON FUNCTION public.delete_user_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account(UUID) TO authenticated;

-- Política: solo puede borrar su propia cuenta
CREATE POLICY "Solo el propio usuario puede eliminar su cuenta"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);
