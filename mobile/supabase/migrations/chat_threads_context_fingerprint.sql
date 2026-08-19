-- ══════════════════════════════════════════════════════════════════
--  CONTEXT FINGERPRINT — para detectar cuándo el contexto financiero
--  de un thread de inversión cambió desde la última conversación.
--
--  No es un dato financiero: es solo la huella (hash/JSON) del contexto
--  usado la última vez, para decidir si hay que regenerar la explicación
--  o si el análisis previo sigue vigente. Nullable — compatible con
--  threads existentes (general/ahorro/gastos) que nunca la van a usar.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS context_fingerprint text;
