-- ══════════════════════════════════════════════════════════════════════════════
-- 051_ios_shortcut.sql
-- Token personal para registrar gastos desde Atajos de iOS (ios-shortcut-ingest).
-- Se guarda solo el SHA-256 del token: el valor en claro se devuelve una única
-- vez al generarlo. Un token por usuario; generar uno nuevo invalida el anterior.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shortcut_tokens (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

ALTER TABLE public.shortcut_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own shortcut token" ON public.shortcut_tokens;
CREATE POLICY "Users read own shortcut token"
  ON public.shortcut_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own shortcut token" ON public.shortcut_tokens;
CREATE POLICY "Users delete own shortcut token"
  ON public.shortcut_tokens FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.create_shortcut_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_token TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_token := 'pss_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.shortcut_tokens (user_id, token_hash)
  VALUES (v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  ON CONFLICT (user_id) DO UPDATE
    SET token_hash = EXCLUDED.token_hash, created_at = now(), last_used_at = NULL;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_shortcut_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shortcut_token() TO authenticated;
