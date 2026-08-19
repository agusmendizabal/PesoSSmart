-- ─────────────────────────────────────────────────────────────────────────────
-- fix_increment_ai_usage.sql
-- Corrige un hallazgo alto de la auditoría de seguridad (Fase 8A): esta RPC
-- (SECURITY DEFINER) no validaba que p_user_id fuera el del usuario que
-- realmente invoca la función, permitiendo agotar la cuota freemium de otro
-- usuario. El chequeo solo es efectivo si el llamante manda su JWT real (las
-- edge functions ai-advisor/investment-advisor se actualizan en el mismo pase
-- para dejar de invocarla con la service role key sin contexto de sesión).
-- Cuerpo original confirmado vía pg_get_functiondef antes de este cambio.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_ai_usage(p_user_id uuid, p_month text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE new_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO ai_usage (user_id, month, msg_count, updated_at)
  VALUES (p_user_id, p_month, 1, NOW())
  ON CONFLICT (user_id, month) DO UPDATE
    SET msg_count  = ai_usage.msg_count + 1,
        updated_at = NOW()
  RETURNING msg_count INTO new_count;
  RETURN new_count;
END;
$function$;
