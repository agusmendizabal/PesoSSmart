-- ─────────────────────────────────────────────────────────────────────────────
-- drop_unused_schema.sql
-- Auditoría de producto (Fase 8, balde D): estas 9 tablas no tienen ningún
-- consumidor en el código (`app/`, `src/`, `supabase/functions/`) — confirmado
-- por grep exhaustivo. 8 de las 9 estaban completamente vacías; market_instruments
-- tenía 4 filas de catálogo estático (sin datos de usuarios reales), reemplazado
-- hace tiempo por el array hardcodeado BASE_INSTRUMENTS en simulator.tsx.
-- ─────────────────────────────────────────────────────────────────────────────

-- Orden: hijos antes que padres (instrument_price_history/investment_simulations
-- referencian market_instruments; ai_chat_messages referencia ai_chat_threads).
DROP TABLE IF EXISTS instrument_price_history;
DROP TABLE IF EXISTS investment_simulations;
DROP TABLE IF EXISTS market_instruments;
DROP TABLE IF EXISTS ai_chat_messages;
DROP TABLE IF EXISTS ai_chat_threads;
DROP TABLE IF EXISTS monthly_reports;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS feature_usage_logs;
DROP TABLE IF EXISTS user_alerts;
