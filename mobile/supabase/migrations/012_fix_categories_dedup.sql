-- ============================================================
-- Fix: deduplicate expense_categories + add café + remove old beauty
-- Run in Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  rec        RECORD;
  winner_id  UUID;
  loser_ids  UUID[];
  old_id     UUID;
  new_id     UUID;
BEGIN

  -- ── 1. beauty → beauty_salon ──────────────────────────────────────────────
  SELECT id INTO old_id FROM expense_categories WHERE name = 'beauty' LIMIT 1;
  SELECT id INTO new_id FROM expense_categories WHERE name = 'beauty_salon' LIMIT 1;

  IF old_id IS NOT NULL AND new_id IS NOT NULL THEN
    UPDATE expenses SET category_id = new_id WHERE category_id = old_id;
    DELETE FROM expense_categories WHERE id = old_id;
    RAISE NOTICE 'beauty → beauty_salon: OK';
  ELSIF old_id IS NOT NULL THEN
    UPDATE expense_categories
      SET name = 'beauty_salon', name_es = 'Peluquería y estética',
          icon = 'cut-outline', color = '#ec407a'
      WHERE id = old_id;
    RAISE NOTICE 'beauty renombrado a beauty_salon';
  END IF;

  -- ── 2. Deduplicar: por cada nombre con >1 fila ────────────────────────────
  FOR rec IN
    SELECT name
    FROM expense_categories
    GROUP BY name
    HAVING count(*) > 1
  LOOP
    -- MIN sobre text para evitar "function min(uuid) does not exist"
    SELECT MIN(id::text)::uuid INTO winner_id
    FROM expense_categories WHERE name = rec.name;

    SELECT array_agg(id) INTO loser_ids
    FROM expense_categories
    WHERE name = rec.name AND id != winner_id;

    -- Primero reasignar expenses
    UPDATE expenses SET category_id = winner_id
    WHERE category_id = ANY(loser_ids);

    -- Luego borrar los duplicados
    DELETE FROM expense_categories WHERE id = ANY(loser_ids);

    RAISE NOTICE 'Deduplicado "%": mantenido=%, eliminados=%', rec.name, winner_id, loser_ids;
  END LOOP;

  -- ── 3. Asegurar que café existe ────────────────────────────────────────────
  INSERT INTO expense_categories (name, name_es, icon, color)
  VALUES ('cafe', 'Café y bebidas', 'cafe-outline', '#795548')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Done.';
END $$;

-- Verificar resultado
SELECT name, name_es FROM expense_categories ORDER BY name_es;
