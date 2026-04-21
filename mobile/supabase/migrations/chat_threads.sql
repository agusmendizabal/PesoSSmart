-- ══════════════════════════════════════════════════════════════════
--  CHAT THREADS — Conversaciones múltiples por bot
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_type        text        NOT NULL CHECK (bot_type IN ('general', 'inversiones', 'ahorro', 'gastos')),
  title           text,                               -- se genera del primer mensaje
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_bot
  ON public.chat_threads(user_id, bot_type, last_message_at DESC);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads_select" ON public.chat_threads FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "threads_insert" ON public.chat_threads FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "threads_update" ON public.chat_threads FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "threads_delete" ON public.chat_threads FOR DELETE USING (user_id = auth.uid());

-- Agregar thread_id a chat_history (nullable para compatibilidad con filas anteriores)
ALTER TABLE public.chat_history
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chat_history_thread
  ON public.chat_history(thread_id, created_at ASC);
