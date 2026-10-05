-- ══════════════════════════════════════════════════════════════════════════════
-- 049_cross_channel_dedup.sql
-- Deduplicación entre canales (Gmail, Outlook, Mercado Pago, WhatsApp, ...).
--
-- UNIQUE (user_id, raw_subject) solo evita duplicados dentro de un mismo canal.
-- Cuando el mismo gasto real llega por dos canales, el trigger de abajo marca
-- el segundo como status = 'duplicate' (con dedup_of apuntando al original) en
-- vez de dejarlo como pendiente. Se guarda en lugar de descartarse para que
-- los reintentos del mismo canal sigan chocando contra raw_subject.
--
-- Criterio de "mismo gasto": mismo usuario y dirección, fecha ±1 día, monto
-- ±0,5% (mín. $1) y comercio compatible (ver merchants_match).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_status_check;

ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_status_check
  CHECK (status IN ('pending', 'confirmed', 'ignored', 'rejected', 'duplicate'));

ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS dedup_of UUID
    REFERENCES public.pending_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_tx_user_date
  ON public.pending_transactions (user_id, transaction_date);

-- Misma normalización que normalizeMerchant() en las edge functions.
CREATE OR REPLACE FUNCTION public.normalize_merchant(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(translate(replace(coalesce(p, ''), '.', ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]+', ' ', 'g'),
      '\m(sa|srl|sas|sal|saic|sacif|cicsa)\M', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Los canales nombran distinto al mismo comercio ("COTO C.I.C.S.A. SUC 45" en
-- un ticket vs "Coto" en el mail del banco, "Mercado Libre" vs "MERCADOLIBRE"):
-- alcanza con que uno contenga al otro (ignorando espacios) o que compartan
-- la primera palabra.
CREATE OR REPLACE FUNCTION public.merchants_match(a TEXT, b TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  WITH n AS (
    SELECT public.normalize_merchant(a) AS na, public.normalize_merchant(b) AS nb
  ), c AS (
    SELECT na, nb, replace(na, ' ', '') AS ca, replace(nb, ' ', '') AS cb FROM n
  )
  SELECT CASE
    WHEN length(ca) < 3 OR length(cb) < 3 THEN false
    WHEN position(ca IN cb) > 0 OR position(cb IN ca) > 0 THEN true
    ELSE length(split_part(na, ' ', 1)) >= 3
         AND split_part(na, ' ', 1) = split_part(nb, ' ', 1)
  END
  FROM c;
$$;

CREATE OR REPLACE FUNCTION public.pending_tx_cross_channel_dedup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_count INT;
  v_same_count  INT;
  v_match_id    UUID;
BEGIN
  IF NEW.transaction_date IS NULL OR NEW.amount IS NULL
     OR NEW.status IN ('rejected', 'ignored', 'duplicate') THEN
    RETURN NEW;
  END IF;

  -- Serializa inserts del mismo usuario para que dos canales en paralelo no
  -- pasen ambos el chequeo.
  PERFORM pg_advisory_xact_lock(hashtext('pending_dedup_' || NEW.user_id::text));

  -- Comparar cantidades (no solo existencia) permite dos gastos reales
  -- idénticos el mismo día: si este canal ya registró tantos como los otros,
  -- el nuevo es un gasto distinto y no un duplicado.
  SELECT
    count(*) FILTER (WHERE source <> NEW.source AND status <> 'duplicate'),
    count(*) FILTER (WHERE source = NEW.source),
    (array_agg(id ORDER BY created_at)
       FILTER (WHERE source <> NEW.source AND status <> 'duplicate'))[1]
  INTO v_other_count, v_same_count, v_match_id
  FROM public.pending_transactions
  WHERE user_id = NEW.user_id
    AND coalesce(direction, 'outgoing') = coalesce(NEW.direction, 'outgoing')
    AND status NOT IN ('rejected', 'ignored')
    AND transaction_date BETWEEN NEW.transaction_date - 1 AND NEW.transaction_date + 1
    AND abs(amount - NEW.amount) <= greatest(1, NEW.amount * 0.005)
    AND public.merchants_match(merchant, NEW.merchant);

  IF v_other_count > v_same_count THEN
    NEW.status          := 'duplicate';
    NEW.dedup_of        := v_match_id;
    NEW.high_confidence := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_tx_cross_channel_dedup ON public.pending_transactions;

CREATE TRIGGER trg_pending_tx_cross_channel_dedup
  BEFORE INSERT ON public.pending_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.pending_tx_cross_channel_dedup();
