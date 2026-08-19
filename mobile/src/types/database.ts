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
export type SavingCurrency = 'ARS' | 'USD';

// ---- Tipos de fila (Row types) ----

export interface Profile {
  id: string;
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
  fixed_expenses_estimated: number | null;
  work_type: WorkType | null;
  family_status: FamilyStatus | null;
  dependents_count: number;
  investable_amount_estimated: number | null;
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
  score: number;
  answers: Json;
  created_at: string;
  updated_at: string;
}

export interface UserInterest {
  id: string;
  user_id: string;
  interest_key: string;
  priority: number;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  name_es: string;
  icon: string;
  color: string;
  is_system: boolean;
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;
  description: string;
  date: string;
  payment_method: PaymentMethod;
  notes: string | null;
  classification: ExpenseClassification | null;
  classification_explanation: string | null;
  classification_confidence: number | null;
  receipt_id: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // relaciones opcionales (join)
  category?: ExpenseCategory;
  receipt?: ExpenseReceipt;
}

export interface ExpenseReceipt {
  id: string;
  user_id: string;
  expense_id: string | null;
  storage_path: string;
  original_filename: string | null;
  status: ReceiptStatus;
  ocr_raw_text: string | null;
  ocr_extracted_data: Json | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Grupo Familiar / Pareja ----

export type GroupType = 'family' | 'couple' | 'friends';

export type MemberRole =
  | 'parent'
  | 'child'
  | 'partner'
  | 'guardian'
  | 'other_adult'
  | 'admin'
  | 'member';

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  parent: 'Padre / Madre',
  child: 'Hijo / Hija',
  partner: 'Pareja',
  guardian: 'Tutor/a',
  other_adult: 'Otro adulto',
  admin: 'Administrador/a',
  member: 'Miembro',
};

export const MEMBER_ROLE_ICONS: Record<MemberRole, string> = {
  parent: 'person',
  child: 'happy-outline',
  partner: 'heart-outline',
  guardian: 'shield-outline',
  other_adult: 'person-outline',
  admin: 'shield-checkmark-outline',
  member: 'person-outline',
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
  permissions: Json | null;
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

export interface MarketRate {
  instrument: string;
  rate_monthly: number;
  rate_annual: number | null;
  source: string;
  label: string | null;
  updated_at: string;
}

export interface GmailConnection {
  id: string;
  user_id: string;
  gmail_email: string;
  refresh_token: string;
  access_token: string | null;
  token_expired: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export interface MpConnection {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  mp_user_id: string | null;
  mp_email: string | null;
  last_checked_at: string | null;
  created_at: string;
  last_sync_count: number | null;
  last_sync_status: string | null;
}

export interface PendingTransaction {
  id: string;
  user_id: string;
  raw_subject: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  currency: string;
  date: string | null;
  suggested_classification: ExpenseClassification | null;
  status: 'pending' | 'confirmed' | 'dismissed';
  source: string | null;
  created_at: string;
}


export interface SavingsGoalRow {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  emoji: string;
  created_at: string;
}

export interface AiUsageRow {
  user_id: string;
  month: string;
  msg_count: number;
}

// ---- Database type completo para Supabase client ----
// Formato exacto requerido por @supabase/postgrest-js v2 (PostgrestVersion "12")

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Profile>;
        Relationships: [];
      };
      financial_profiles: {
        Row: FinancialProfile;
        Insert: Omit<FinancialProfile, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<FinancialProfile>;
        Relationships: [];
      };
      risk_profiles: {
        Row: RiskProfileRecord;
        Insert: Omit<RiskProfileRecord, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<RiskProfileRecord>;
        Relationships: [];
      };
      user_interests: {
        Row: UserInterest;
        Insert: Omit<UserInterest, 'id' | 'created_at'>;
        Update: Partial<UserInterest>;
        Relationships: [];
      };
      expense_categories: {
        Row: ExpenseCategory;
        Insert: Omit<ExpenseCategory, 'id' | 'created_at'>;
        Update: Partial<ExpenseCategory>;
        Relationships: [];
      };
      expenses: {
        Row: Expense;
        Insert: Omit<Expense, 'id' | 'created_at' | 'updated_at' | 'category' | 'receipt'>;
        Update: Partial<Omit<Expense, 'category' | 'receipt'>>;
        Relationships: [
          {
            foreignKeyName: 'expenses_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'expense_categories';
            referencedColumns: ['id'];
          }
        ];
      };
      expense_receipts: {
        Row: ExpenseReceipt;
        Insert: Omit<ExpenseReceipt, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<ExpenseReceipt>;
        Relationships: [];
      };
      gmail_connections: {
        Row: GmailConnection;
        Insert: Omit<GmailConnection, 'id' | 'created_at'>;
        Update: Partial<GmailConnection>;
        Relationships: [];
      };
      mp_connections: {
        Row: MpConnection;
        Insert: Omit<MpConnection, 'id' | 'created_at'>;
        Update: Partial<MpConnection>;
        Relationships: [];
      };
      market_rates: {
        Row: MarketRate;
        Insert: MarketRate;
        Update: Partial<MarketRate>;
        Relationships: [];
      };
      pending_transactions: {
        Row: PendingTransaction;
        Insert: Omit<PendingTransaction, 'id' | 'created_at'>;
        Update: Partial<PendingTransaction>;
        Relationships: [];
      };
      family_groups: {
        Row: FamilyGroup;
        Insert: Omit<FamilyGroup, 'id' | 'created_at'>;
        Update: Partial<FamilyGroup>;
        Relationships: [];
      };
      family_members: {
        Row: FamilyMember;
        Insert: Omit<FamilyMember, 'id' | 'joined_at'>;
        Update: Partial<FamilyMember>;
        Relationships: [];
      };
      savings_goals: {
        Row: SavingsGoalRow;
        Insert: Omit<SavingsGoalRow, 'id' | 'created_at'>;
        Update: Partial<SavingsGoalRow>;
        Relationships: [];
      };
      ai_usage: {
        Row: AiUsageRow;
        Insert: AiUsageRow;
        Update: Partial<AiUsageRow>;
        Relationships: [];
      };
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
