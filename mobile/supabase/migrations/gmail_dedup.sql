-- Agregar constraint único para evitar duplicados en pending_transactions
-- Previene race condition entre polls concurrentes del mismo usuario
ALTER TABLE pending_transactions
  ADD CONSTRAINT pending_transactions_user_subject_unique
  UNIQUE (user_id, raw_subject);
