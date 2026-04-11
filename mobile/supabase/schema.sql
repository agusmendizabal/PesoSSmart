-- ============================================================
-- Pesos$mart — Esquema completo de base de datos
-- Ejecutar en Supabase SQL Editor en el orden indicado
-- ============================================================

-- ---- Extensiones ----
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE subscription_plan AS ENUM ('free', 'pro');
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'cancelled', 'trial');
CREATE TYPE risk_profile_type AS ENUM ('conservative', 'moderate', 'aggressive');
CREATE TYPE work_type AS ENUM ('employee', 'freelance', 'self_employed', 'student', 'unemployed', 'retired');
CREATE TYPE family_status AS ENUM ('single', 'couple', 'family_no_kids', 'family_with_kids');
CREATE TYPE income_range AS ENUM ('under_150k', '150k_300k', '300k_500k', '500k_800k', '800k_1500k', 'over_1500k');
CREATE TYPE expense_classification AS ENUM ('necessary', 'disposable', 'investable');
CREATE TYPE payment_method AS ENUM ('cash', 'debit', 'credit', 'transfer', 'digital_wallet', 'other');
CREATE TYPE receipt_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE chat_role AS ENUM ('user', 'assistant');
CREATE TYPE instrument_type AS ENUM ('fci_money_market', 'fci_cer', 'lecap', 'dolar_mep', 'cedear', 'bond', 'other');

-- ============================================================
-- TABLA: profiles
-- Extiende auth.users de Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  subscription_plan subscription_plan NOT NULL DEFAULT 'free',
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_step INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Trigger para crear profile automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TABLA: financial_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS public.financial_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  income_range income_range,
  fixed_expenses_estimated NUMERIC(12, 2),
  work_type work_type,
  family_status family_status,
  dependents_count INTEGER NOT NULL DEFAULT 0,
  investable_amount_estimated NUMERIC(12, 2),
  has_savings BOOLEAN NOT NULL DEFAULT false,
  savings_amount NUMERIC(12, 2),
  has_debt BOOLEAN NOT NULL DEFAULT false,
  debt_amount NUMERIC(12, 2),
  financial_goal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_financial_profiles_user_id ON public.financial_profiles(user_id);

-- ============================================================
-- TABLA: risk_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS public.risk_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile risk_profile_type NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  answers JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_risk_profiles_user_id ON public.risk_profiles(user_id);

-- ============================================================
-- TABLA: user_interests
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_interests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  interest_key TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_interests_user_id ON public.user_interests(user_id);
CREATE UNIQUE INDEX idx_user_interests_user_key ON public.user_interests(user_id, interest_key);

-- ============================================================
-- TABLA: expense_categories
-- Catálogo compartido (no pertenece a un usuario específico)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_es TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'tag-outline',
  color TEXT NOT NULL DEFAULT '#888888',
  is_system BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed de categorías base
INSERT INTO public.expense_categories (name, name_es, icon, color) VALUES
  ('food_dining', 'Comida y restaurantes', 'restaurant-outline', '#ff7043'),
  ('groceries', 'Supermercado', 'cart-outline', '#66bb6a'),
  ('transport', 'Transporte', 'car-outline', '#42a5f5'),
  ('health', 'Salud y farmacia', 'medkit-outline', '#ef5350'),
  ('entertainment', 'Entretenimiento', 'musical-notes-outline', '#ab47bc'),
  ('clothing', 'Ropa y calzado', 'shirt-outline', '#ff8f00'),
  ('education', 'Educación', 'school-outline', '#5c6bc0'),
  ('home', 'Hogar y servicios', 'home-outline', '#26a69a'),
  ('technology', 'Tecnología', 'phone-portrait-outline', '#78909c'),
  ('subscriptions', 'Suscripciones', 'repeat-outline', '#7e57c2'),
  ('travel', 'Viajes', 'airplane-outline', '#29b6f6'),
  ('pets', 'Mascotas', 'paw-outline', '#8d6e63'),
  ('beauty', 'Cuidado personal', 'sparkles-outline', '#f48fb1'),
  ('sports', 'Deporte y gym', 'barbell-outline', '#9ccc65'),
  ('leisure', 'Ocio y salidas', 'beer-outline', '#ffa726'),
  ('beauty_salon', 'Peluquería y estética', 'cut-outline', '#ec407a'),
  ('gifts', 'Regalos', 'gift-outline', '#ef9a9a'),
  ('insurance', 'Seguros', 'shield-outline', '#b0bec5'),
  ('kids', 'Niños y bebés', 'happy-outline', '#80deea'),
  ('other', 'Otros', 'ellipsis-horizontal-outline', '#888888')
ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLA: expenses
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.expense_categories(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method payment_method NOT NULL DEFAULT 'cash',
  notes TEXT,
  classification expense_classification,
  classification_explanation TEXT,
  classification_confidence NUMERIC(4, 3) CHECK (classification_confidence BETWEEN 0 AND 1),
  receipt_id UUID, -- FK agregada después para evitar circularidad
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurring_frequency TEXT CHECK (recurring_frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_expenses_user_id ON public.expenses(user_id);
CREATE INDEX idx_expenses_date ON public.expenses(user_id, date DESC);
CREATE INDEX idx_expenses_classification ON public.expenses(user_id, classification);
CREATE INDEX idx_expenses_category ON public.expenses(category_id);
-- Soft delete: solo mostramos los no borrados
CREATE INDEX idx_expenses_not_deleted ON public.expenses(user_id) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLA: expense_receipts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expense_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  original_filename TEXT,
  status receipt_status NOT NULL DEFAULT 'pending',
  ocr_raw_text TEXT,
  ocr_extracted_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_receipts_user_id ON public.expense_receipts(user_id);
CREATE INDEX idx_expense_receipts_expense_id ON public.expense_receipts(expense_id);
CREATE INDEX idx_expense_receipts_status ON public.expense_receipts(status);

-- Agregar FK de expenses a receipts (ahora que existe la tabla)
ALTER TABLE public.expenses
  ADD CONSTRAINT fk_expenses_receipt
  FOREIGN KEY (receipt_id) REFERENCES public.expense_receipts(id) ON DELETE SET NULL;

-- ============================================================
-- TABLA: monthly_reports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.monthly_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  total_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_by_category JSONB NOT NULL DEFAULT '{}',
  total_necessary NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_disposable NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_investable NUMERIC(14, 2) NOT NULL DEFAULT 0,
  previous_month_total NUMERIC(14, 2),
  inflation_rate NUMERIC(6, 4),
  inflation_adjusted_comparison NUMERIC(14, 2),
  ai_insights JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pdf_storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, year, month)
);

CREATE INDEX idx_monthly_reports_user_id ON public.monthly_reports(user_id, year DESC, month DESC);

-- ============================================================
-- TABLA: market_instruments (catálogo público)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.market_instruments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type instrument_type NOT NULL,
  name TEXT NOT NULL,
  name_es TEXT NOT NULL,
  description_es TEXT,
  ticker TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed inicial de instrumentos
INSERT INTO public.market_instruments (type, name, name_es, description_es, ticker) VALUES
  ('fci_money_market', 'Money Market Fund', 'FCI Money Market', 'Fondos de liquidez inmediata. Rendís desde el día 1 y podés retirar cuando quieras.', 'FCI_MM'),
  ('fci_cer', 'CER-Adjusted Fund', 'FCI ajustado CER', 'Rendimiento atado a la inflación oficial. Bueno para protegerse del aumento de precios.', 'FCI_CER'),
  ('lecap', 'Treasury Letters', 'Letras del Tesoro (Lecap)', 'Letras de corto plazo emitidas por el Tesoro con tasa fija en pesos.', 'LECAP'),
  ('dolar_mep', 'MEP Dollar', 'Dólar MEP', 'Compra de dólares legales desde cuenta bancaria argentina, sin límite de CEPO.', 'MEP')
ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLA: instrument_price_history
-- ============================================================

CREATE TABLE IF NOT EXISTS public.instrument_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instrument_id UUID NOT NULL REFERENCES public.market_instruments(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  open_price NUMERIC(16, 6),
  close_price NUMERIC(16, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ARS',
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instrument_id, date)
);

CREATE INDEX idx_price_history_instrument_date ON public.instrument_price_history(instrument_id, date DESC);

-- ============================================================
-- TABLA: investment_simulations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_simulations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES public.market_instruments(id),
  amount NUMERIC(14, 2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  initial_value_ars NUMERIC(14, 2) NOT NULL,
  final_value_ars NUMERIC(14, 2) NOT NULL,
  return_pct NUMERIC(8, 4) NOT NULL,
  inflation_during_period NUMERIC(6, 4),
  real_return_pct NUMERIC(8, 4),
  simulation_data JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_simulations_user_id ON public.investment_simulations(user_id, created_at DESC);

-- ============================================================
-- TABLA: ai_chat_threads
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_chat_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_threads_user_id ON public.ai_chat_threads(user_id, updated_at DESC);

-- ============================================================
-- TABLA: ai_chat_messages
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES public.ai_chat_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role chat_role NOT NULL,
  content TEXT NOT NULL,
  tokens_used INTEGER,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_thread_id ON public.ai_chat_messages(thread_id, created_at ASC);
CREATE INDEX idx_chat_messages_user_id ON public.ai_chat_messages(user_id, created_at DESC);

-- ============================================================
-- TABLA: subscriptions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan subscription_plan NOT NULL DEFAULT 'free',
  status subscription_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  payment_provider TEXT,
  payment_reference TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id, created_at DESC);

-- ============================================================
-- TABLA: feature_usage_logs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX idx_feature_usage_user_feature ON public.feature_usage_logs(user_id, feature, used_at DESC);

-- ============================================================
-- TABLA: user_alerts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  action_url TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_user_alerts_user_id ON public.user_alerts(user_id, is_read, created_at DESC);

-- ============================================================
-- FUNCIÓN: updated_at automático
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Triggers de updated_at para cada tabla que lo tenga
CREATE OR REPLACE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_financial_profiles
  BEFORE UPDATE ON public.financial_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_risk_profiles
  BEFORE UPDATE ON public.risk_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_expenses
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_expense_receipts
  BEFORE UPDATE ON public.expense_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_chat_threads
  BEFORE UPDATE ON public.ai_chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_subscriptions
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
