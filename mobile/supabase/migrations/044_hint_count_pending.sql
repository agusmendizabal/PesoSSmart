-- Almacena cuántas veces el usuario clasificó manualmente ese comercio,
-- para mostrar nivel de confianza en la sugerencia de la IA.
ALTER TABLE pending_transactions
  ADD COLUMN IF NOT EXISTS hint_count integer NOT NULL DEFAULT 0;
