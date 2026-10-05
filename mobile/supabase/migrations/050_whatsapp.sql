-- ══════════════════════════════════════════════════════════════════════════════
-- 050_whatsapp.sql
-- Registro de gastos por WhatsApp (foto de ticket o texto).
--
-- El vínculo número ↔ usuario vive en su propia tabla y no en `profiles`
-- porque el cliente puede editar su propio perfil: si el número fuera una
-- columna ahí, cualquiera podría asignarse el teléfono de otra persona. Solo
-- el webhook (service role) escribe whatsapp_links, después de recibir desde
-- ese número un código generado por el dueño de la cuenta.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.whatsapp_links (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL UNIQUE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own whatsapp link" ON public.whatsapp_links;
CREATE POLICY "Users read own whatsapp link"
  ON public.whatsapp_links FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own whatsapp link" ON public.whatsapp_links;
CREATE POLICY "Users delete own whatsapp link"
  ON public.whatsapp_links FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin policies: solo accesible vía create_whatsapp_link_code() y service role.
ALTER TABLE public.whatsapp_link_codes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_whatsapp_link_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_code TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  DELETE FROM public.whatsapp_link_codes
   WHERE user_id = v_user OR expires_at < now();

  LOOP
    v_code := 'PESOS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 6));
    BEGIN
      INSERT INTO public.whatsapp_link_codes (code, user_id, expires_at)
      VALUES (v_code, v_user, now() + interval '15 minutes');
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- colisión improbable: probar otro código
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.create_whatsapp_link_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_link_code() TO authenticated;

-- Medio de pago leído del ticket, para usarlo al confirmar desde WhatsApp.
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS payment_method TEXT
    CHECK (payment_method IN ('cash', 'debit', 'credit', 'transfer', 'digital_wallet', 'other'));
