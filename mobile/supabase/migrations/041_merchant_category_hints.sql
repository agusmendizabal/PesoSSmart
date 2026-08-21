-- Tabla de aprendizaje: mapea comercios a su categoría aprendida.
-- Se rellena automáticamente desde gmail-poll y se refuerza con correcciones manuales.

CREATE TABLE IF NOT EXISTS merchant_category_hints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  merchant_normalized TEXT NOT NULL,
  merchant_display    TEXT NOT NULL,
  category            TEXT NOT NULL,
  classification      TEXT NOT NULL,
  count               INTEGER NOT NULL DEFAULT 1,
  last_seen           DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, merchant_normalized)
);

ALTER TABLE merchant_category_hints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "merchant_hints_own"
  ON merchant_category_hints FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_merchant_hints_lookup
  ON merchant_category_hints(user_id, merchant_normalized);
