CREATE TABLE IF NOT EXISTS category_budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id   UUID NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit > 0),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, category_id)
);

ALTER TABLE category_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_budgets" ON category_budgets
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
