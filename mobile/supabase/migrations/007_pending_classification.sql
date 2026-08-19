-- Agrega clasificación sugerida por IA a los gastos pendientes de confirmación
ALTER TABLE pending_transactions
  ADD COLUMN IF NOT EXISTS suggested_classification text CHECK (suggested_classification IN ('necessary', 'disposable', 'investable'));
