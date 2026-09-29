-- ══════════════════════════════════════════════════════════════════════════════
-- Corrige un duplicado real: auto-confirm-transactions verificaba "¿ya existe un
-- gasto para este pending_transaction?" con un SELECT separado del INSERT
-- (TOCTOU) — dos invocaciones del cron corriendo cerca en el tiempo podían pasar
-- ambas el chequeo e insertar dos veces el mismo gasto. Un índice único a nivel
-- de base de datos cierra la carrera de forma atómica (la función ahora atrapa
-- la violación de unicidad y la trata como "ya existe", igual que ya hace con
-- pending_transactions.raw_subject).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_source_pending_unique
  ON public.expenses (source_pending_id)
  WHERE source_pending_id IS NOT NULL AND deleted_at IS NULL;
