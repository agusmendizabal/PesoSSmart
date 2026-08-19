-- ============================================================
-- Remove categories: transporte, tecnología, niños y bebés,
--                    mascotas, deporte y gym
-- Expenses assigned to these are reassigned to 'Otros'
-- Run in Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  other_id UUID;
  cat_id   UUID;
  cat_names TEXT[] := ARRAY['transport', 'technology', 'kids', 'pets', 'sports'];
  cat_name  TEXT;
BEGIN
  SELECT id INTO other_id FROM expense_categories WHERE name = 'other' LIMIT 1;

  FOREACH cat_name IN ARRAY cat_names LOOP
    SELECT id INTO cat_id FROM expense_categories WHERE name = cat_name LIMIT 1;
    IF cat_id IS NOT NULL THEN
      UPDATE expenses SET category_id = other_id WHERE category_id = cat_id;
      DELETE FROM expense_categories WHERE id = cat_id;
      RAISE NOTICE 'Eliminada categoría: %', cat_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Done.';
END $$;

SELECT name, name_es FROM expense_categories ORDER BY name_es;
