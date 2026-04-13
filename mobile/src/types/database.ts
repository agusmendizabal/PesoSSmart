// ============================================================
// TIPOS DE BASE DE DATOS — sincronizados con el esquema Supabase
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---- Enums ----

export type SubscriptionPlan = 'free' | 'pro' | 'premium';
export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled' | 'trial';
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
export type WorkType = 'employee' | 'freelance' | 'self_employed' | 'student' | 'unemployed' | 'retired';
export type FamilyStatus = 'single' | 'couple' | 'family_no_kids' | 'family_with_kids';
export type IncomeRange =
  | 'under_150k'
  | '150k_300k'
  | '300k_500k'
  | '500k_800k'
  | '800k_1500k'
  | 'over_1500k';
export type ExpenseClassification = 'necessary' | 'disposable' | 'investable';
export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'transfer' | 'digital_wallet' | 'other';
export type ReceiptStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ChatRole = 'user' | 'assistant';
export type InstrumentType = 'fci_money_market' | 'fci_cer' | 'lecap' | 'dolar_mep' | 'cedear' | 'bond' | 'other';

// ---- Tablas principales ----

export interface Profile {
  id: string; // uuid, FK a auth.users
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  subscription_plan: SubscriptionPlan;
  subscription_status: SubscriptionStatus;
  plan_expires_at: string | null;
  trial_used: boolean;
  trial_started_at: string | null;
  onboarding_completed: boolean;
  onboarding_step: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FinancialProfile {
  id: string;
  user_id: string;
  income_range: IncomeRange | null;
  fixed_expenses_estimated: number | null; // en ARS
  work_type: WorkType | null;
  family_status: FamilyStatus | null;
  dependents_count: number;
  investable_amount_estimated: number | null; // en ARS
  has_savings: boolean;
  savings_amount: number | null;
  has_debt: boolean;
  debt_amount: number | null;
  financial_goal: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskProfileRecord {
  id: string;
  user_id: string;
  profile: RiskProfile;
  score: number; // 0-100
  answers: Json; // respuestas del cuestionario
  created_at: string;
  updated_at: string;
}

export interface UserInterest {
  id: string;
  user_id: string;
  interest_key: string; // ej: 'fci', 'dolar_mep', 'cedears', 'crypto'
  priority: number; // orden de preferencia
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  name_es: string;
  icon: string;
  color: string;
  is_system: boolean; // categorías base del sistema
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number; // en ARS
  description: string;
  date: string; // ISO date
  payment_method: PaymentMethod;
  notes: string | null;
  classification: ExpenseClassification | null;
  classification_explanation: string | null;
  classification_confidence: number | null; // 0-1
  receipt_id: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null; // 'daily' | 'weekly' | 'monthly'
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // relaciones (cuando se hace join)
  category?: ExpenseCategory;
  receipt?: ExpenseReceipt;
}

export interface ExpenseReceipt {
  id: string;
  user_id: string;
  expense_id: string | null;
  storage_path: string; // path en Supabase Storage
  original_filename: string | null;
  status: ReceiptStatus;
  ocr_raw_text: string | null;
  ocr_extracted_data: Json | null; // { total, date, merchant, items }
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyReport {
  id: string;
  user_id: string;
  year: number;
  month: number; // 1-12
  total_expenses: number;
  total_by_category: Json; // { category_id: amount }
  total_necessary: number;
  total_disposable: number;
  total_investable: number;
  previous_month_total: number | null;
  inflation_rate: number | null; // tasa del mes
  inflation_adjusted_comparison: number | null;
  ai_insights: Json | null; // { findings: string[], tips: string[] }
  generated_at: string;
  pdf_storage_path: string | null;
  created_at: string;
}

export interface MarketInstrument {
  id: string;
  type: InstrumentType;
  name: string;
  name_es: string;
  description_es: string | null;
  ticker: string | null;
  is_active: boolean;
  metadata: Json | null;
  created_at: string;
  updated_at: string;
}

export interface InstrumentPriceHistory {
  id: string;
  instrument_id: string;
  date: string; // ISO date
  open_price: number | null;
  close_price: number;
  currency: string; // 'ARS' | 'USD'
  source: string | null;
  created_at: string;
}

export interface InvestmentSimulation {
  id: string;
  user_id: string;
  instrument_id: string;
  amount: number; // monto inicial en ARS
  start_date: string;
  end_date: string;
  initial_value_ars: number;
  final_value_ars: number;
  return_pct: number;
  inflation_during_period: number | null;
  real_return_pct: number | null;
  simulation_data: Json; // datos del gráfico
  created_at: string;
  // relaciones
  instrument?: MarketInstrument;
}

export interface AIChatThread {
  id: string;
  user_id: string;
  title: string | null;
  is_active: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIChatMessage {
  id: string;
  thread_id: string;
  user_id: string;
  role: ChatRole;
  content: string;
  tokens_used: number | null;
  model: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  payment_provider: string | null;
  payment_reference: string | null;
  metadata: Json | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureUsageLog {
  id: string;
  user_id: string;
  feature: string; // 'ai_chat', 'simulator', 'receipt_scan', etc.
  used_at: string;
  metadata: Json | null;
}

// ---- Grupo Familiar / Pareja ----

export type GroupType = 'family' | 'couple';

export type MemberRole =
  | 'parent'
  | 'child'
  | 'partner'
  | 'guardian'
  | 'other_adult';

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  parent: 'Padre / Madre',
  child: 'Hijo / Hija',
  partner: 'Pareja',
  guardian: 'Tutor/a',
  other_adult: 'Otro adulto',
};

export const MEMBER_ROLE_ICONS: Record<MemberRole, string> = {
  parent: 'person',
  child: 'happy-outline',
  partner: 'heart-outline',
  guardian: 'shield-outline',
  other_adult: 'person-outline',
};

/** Roles considerados "adultos responsables" — pueden ver gastos de hijos */
export const ADULT_ROLES: MemberRole[] = ['parent', 'guardian', 'other_adult'];

/** Roles considerados "menores" — no ven gastos de adultos */
export const MINOR_ROLES: MemberRole[] = ['child'];

export interface FamilyGroup {
  id: string;
  name: string;
  invite_code: string;
  group_type: GroupType;
  owner_id: string | null;
  created_at: string;
}

export interface FamilyMember {
  id: string;
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  // joined
  profile?: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>;
}

export interface GroupTransfer {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  currency: string;
  note: string | null;
  transfer_date: string;
  created_at: string;
  // joined
  from_profile?: Pick<Profile, 'id' | 'full_name'>;
  to_profile?: Pick<Profile, 'id' | 'full_name'>;
}

export interface UserAlert {
  id: string;
  user_id: string;
  type: string; // 'overspending', 'goal_reached', 'high_inflation', etc.
  title: string;
  message: string;
  is_read: boolean;
  action_url: string | null;
  metadata: Json | null;
  created_at: string;
  expires_at: string | null;
}

// ---- Database type completo para Supabase client ----

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at' | 'updated_at'>; Update: Partial<Profile> };
      financial_profiles: { Row: FinancialProfile; Insert: Omit<FinancialProfile, 'id' | 'created_at' | 'updated_at'>; Update: Partial<FinancialProfile> };
      risk_profiles: { Row: RiskProfileRecord; Insert: Omit<RiskProfileRecord, 'id' | 'created_at' | 'updated_at'>; Update: Partial<RiskProfileRecord> };
      user_interests: { Row: UserInterest; Insert: Omit<UserInterest, 'id' | 'created_at'>; Update: Partial<UserInterest> };
      expense_categories: { Row: ExpenseCategory; Insert: Omit<ExpenseCategory, 'id' | 'created_at'>; Update: Partial<ExpenseCategory> };
      expenses: { Row: Expense; Insert: Omit<Expense, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Expense> };
      expense_receipts: { Row: ExpenseReceipt; Insert: Omit<ExpenseReceipt, 'id' | 'created_at' | 'updated_at'>; Update: Partial<ExpenseReceipt> };
      monthly_reports: { Row: MonthlyReport; Insert: Omit<MonthlyReport, 'id' | 'created_at'>; Update: Partial<MonthlyReport> };
      market_instruments: { Row: MarketInstrument; Insert: Omit<MarketInstrument, 'id' | 'created_at' | 'updated_at'>; Update: Partial<MarketInstrument> };
      instrument_price_history: { Row: InstrumentPriceHistory; Insert: Omit<InstrumentPriceHistory, 'id' | 'created_at'>; Update: Partial<InstrumentPriceHistory> };
      investment_simulations: { Row: InvestmentSimulation; Insert: Omit<InvestmentSimulation, 'id' | 'created_at'>; Update: Partial<InvestmentSimulation> };
      ai_chat_threads: { Row: AIChatThread; Insert: Omit<AIChatThread, 'id' | 'created_at' | 'updated_at'>; Update: Partial<AIChatThread> };
      ai_chat_messages: { Row: AIChatMessage; Insert: Omit<AIChatMessage, 'id' | 'created_at'>; Update: Partial<AIChatMessage> };
      subscriptions: { Row: Subscription; Insert: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Subscription> };
      feature_usage_logs: { Row: FeatureUsageLog; Insert: Omit<FeatureUsageLog, 'id' | 'used_at'>; Update: Partial<FeatureUsageLog> };
      user_alerts: { Row: UserAlert; Insert: Omit<UserAlert, 'id' | 'created_at'>; Update: Partial<UserAlert> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      subscription_plan: SubscriptionPlan;
      risk_profile: RiskProfile;
      expense_classification: ExpenseClassification;
    };
  };
}
