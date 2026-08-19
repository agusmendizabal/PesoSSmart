-- ══════════════════════════════════════════════════════════════════
--  CHAT HISTORY — Persistencia de conversaciones con asesores IA
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.chat_history (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_type   text        NOT NULL CHECK (bot_type IN ('general', 'inversiones', 'ahorro', 'gastos')),
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para queries por usuario+bot (el patrón más frecuente)
CREATE INDEX IF NOT EXISTS idx_chat_history_user_bot_time
  ON public.chat_history(user_id, bot_type, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_history_select" ON public.chat_history
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "chat_history_insert" ON public.chat_history
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_history_delete" ON public.chat_history
  FOR DELETE USING (user_id = auth.uid());

-- ── Función para limpiar historial antiguo (>90 días) ──────────────
-- Llamar como cron job mensual desde pg_cron o Supabase scheduled functions
CREATE OR REPLACE FUNCTION public.purge_old_chat_history()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.chat_history
  WHERE created_at < now() - interval '90 days';
$$;
