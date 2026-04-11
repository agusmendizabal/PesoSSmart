import { create } from 'zustand';
import type { Expense, ExpenseCategory } from '@/types';
import { supabase, handleSupabaseError } from '@/lib/supabase';
import { notifyNewSubscription } from '@/lib/notifications';

interface ExpensesFilter {
  month: number | null;
  year: number | null;
  category_id: string | null;
  classification: string | null;
  search: string;
}

export interface DetectedSubscription {
  description: string;
  averageAmount: number;
  occurrences: number;
  lastDate: string;
  category: string | null;
}

const INCOME_RANGE_MAP: Record<string, number> = {
  under_150k:   300000,   // < $500k → punto medio ~$300k
  '150k_300k':  750000,   // $500k–$1M → $750k
  '300k_500k':  1500000,  // $1M–$2M → $1.5M
  '500k_800k':  2750000,  // $2M–$3.5M → $2.75M
  '800k_1500k': 4750000,  // $3.5M–$6M → $4.75M
  over_1500k:   8000000,  // > $6M → $8M
};

const PAGE_SIZE = 30;

interface ExpensesState {
  expenses: Expense[];
  categories: ExpenseCategory[];
  selectedExpense: Expense | null;
  filter: ExpensesFilter;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  currentPage: number;
  isLoadingCategories: boolean;
  error: string | null;
  totalThisMonth: number;
  totalNecessary: number;
  totalDisposable: number;
  totalInvestable: number;
  subscriptions: DetectedSubscription[];
  projectedBalance: number | null;
  estimatedIncome: number | null;
  lastMonthTotal: number | null;
  avgLast3Months: number | null;

  // Actions
  fetchExpenses: (userId: string) => Promise<void>;
  fetchMoreExpenses: (userId: string) => Promise<void>;
  fetchCategories: () => Promise<void>;
  addExpense: (userId: string, data: Partial<Expense>) => Promise<Expense>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  setFilter: (filter: Partial<ExpensesFilter>) => void;
  setSelectedExpense: (expense: Expense | null) => void;
  clearError: () => void;
  fetchSubscriptionsAndProjection: (userId: string) => Promise<void>;
}

function currentMonthFilter() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export const useExpensesStore = create<ExpensesState>((set, get) => ({
  expenses: [],
  categories: [],
  selectedExpense: null,
  filter: {
    ...currentMonthFilter(),
    category_id: null,
    classification: null,
    search: '',
  },
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  currentPage: 0,
  isLoadingCategories: false,
  error: null,
  totalThisMonth: 0,
  totalNecessary: 0,
  totalDisposable: 0,
  totalInvestable: 0,
  subscriptions: [],
  projectedBalance: null,
  estimatedIncome: null,
  lastMonthTotal: null,
  avgLast3Months: null,

  fetchExpenses: async (userId) => {
    // Sincronizar el filtro al mes actual si no hay filtro manual activo
    const { filter } = get();
    const now = currentMonthFilter();
    const isDefaultFilter = filter.month === null || filter.year === null;
    const isStaleMonth = filter.month !== now.month || filter.year !== now.year;
    if (isStaleMonth && isDefaultFilter) {
      set((s) => ({ filter: { ...s.filter, ...now } }));
    }
    set({ isLoading: true, error: null, currentPage: 0 });
    try {
      let query = supabase
        .from('expenses')
        .select('*, category:expense_categories(*)')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (filter.year && filter.month) {
        const startDate = `${filter.year}-${String(filter.month).padStart(2, '0')}-01`;
        const endMonth = filter.month === 12 ? 1 : filter.month + 1;
        const endYear = filter.month === 12 ? filter.year + 1 : filter.year;
        const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
        query = query.gte('date', startDate).lt('date', endDate);
      }
      if (filter.category_id) query = query.eq('category_id', filter.category_id);
      if (filter.classification) query = query.eq('classification', filter.classification);
      if (filter.search) query = query.ilike('description', `%${filter.search}%`);

      const { data, error } = await query;
      if (error) throw error;

      const expenses = (data ?? []) as Expense[];
      const totalThisMonth = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalNecessary = expenses.filter(e => e.classification === 'necessary').reduce((sum, e) => sum + e.amount, 0);
      const totalDisposable = expenses.filter(e => e.classification === 'disposable').reduce((sum, e) => sum + e.amount, 0);
      const totalInvestable = expenses.filter(e => e.classification === 'investable').reduce((sum, e) => sum + e.amount, 0);

      set({ expenses, totalThisMonth, totalNecessary, totalDisposable, totalInvestable, hasMore: expenses.length === PAGE_SIZE, currentPage: 0 });
    } catch (err) {
      set({ error: handleSupabaseError(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMoreExpenses: async (userId) => {
    const { filter, currentPage, isLoadingMore, hasMore } = get();
    if (isLoadingMore || !hasMore) return;
    set({ isLoadingMore: true });
    try {
      const nextPage = currentPage + 1;
      const from = nextPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('expenses')
        .select('*, category:expense_categories(*)')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .range(from, to);

      if (filter.year && filter.month) {
        const startDate = `${filter.year}-${String(filter.month).padStart(2, '0')}-01`;
        const endMonth = filter.month === 12 ? 1 : filter.month + 1;
        const endYear = filter.month === 12 ? filter.year + 1 : filter.year;
        const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
        query = query.gte('date', startDate).lt('date', endDate);
      }
      if (filter.category_id) query = query.eq('category_id', filter.category_id);
      if (filter.classification) query = query.eq('classification', filter.classification);
      if (filter.search) query = query.ilike('description', `%${filter.search}%`);

      const { data, error } = await query;
      if (error) throw error;

      const newExpenses = (data ?? []) as Expense[];
      set((s) => ({
        expenses: [...s.expenses, ...newExpenses],
        hasMore: newExpenses.length === PAGE_SIZE,
        currentPage: nextPage,
      }));
    } catch (err) {
      set({ error: handleSupabaseError(err) });
    } finally {
      set({ isLoadingMore: false });
    }
  },

  fetchCategories: async () => {
    set({ isLoadingCategories: true });
    try {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('*')
        .order('name_es');
      if (error) throw error;
      set({ categories: data ?? [] });
    } catch (err) {
      set({ error: handleSupabaseError(err) });
    } finally {
      set({ isLoadingCategories: false });
    }
  },

  addExpense: async (userId, data) => {
    set({ isLoading: true, error: null });
    try {
      const { data: newExpense, error } = await supabase
        .from('expenses')
        .insert({
          user_id: userId,
          description: data.description ?? '',
          amount: data.amount ?? 0,
          date: data.date ?? new Date().toISOString().split('T')[0],
          payment_method: data.payment_method ?? 'cash',
          category_id: data.category_id ?? null,
          notes: data.notes ?? null,
          is_recurring: data.is_recurring ?? false,
        })
        .select('*, category:expense_categories(*)')
        .single();

      if (error) throw error;

      set((s) => ({ expenses: [newExpense as Expense, ...s.expenses] }));
      return newExpense as Expense;
    } catch (err) {
      set({ error: handleSupabaseError(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  updateExpense: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const { data: updated, error } = await supabase
        .from('expenses')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*, category:expense_categories(*)')
        .single();

      if (error) throw error;

      set((s) => ({
        expenses: s.expenses.map((e) => (e.id === id ? (updated as Expense) : e)),
      }));
    } catch (err) {
      set({ error: handleSupabaseError(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteExpense: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase
        .from('expenses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }));
    } catch (err) {
      set({ error: handleSupabaseError(err) });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  setFilter: (filter) => set((s) => ({ filter: { ...s.filter, ...filter } })),
  setSelectedExpense: (expense) => set({ selectedExpense: expense }),
  clearError: () => set({ error: null }),

  fetchSubscriptionsAndProjection: async (userId) => {
    try {
      // Traer últimos 90 días de gastos
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().split('T')[0];

      const { data: recentExpenses } = await supabase
        .from('expenses')
        .select('description, amount, date, category_id')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('date', sinceStr)
        .order('date', { ascending: false });

      if (!recentExpenses) return;

      // Detectar suscripciones: descripción que aparece en 2+ meses distintos
      const grouped: Record<string, { amounts: number[]; dates: string[]; category: string | null }> = {};
      for (const e of recentExpenses) {
        const key = e.description.toLowerCase().trim();
        if (!grouped[key]) grouped[key] = { amounts: [], dates: [], category: e.category_id };
        grouped[key].amounts.push(e.amount);
        grouped[key].dates.push(e.date);
      }

      const detected: DetectedSubscription[] = [];
      for (const [desc, data] of Object.entries(grouped)) {
        const months = new Set(data.dates.map(d => d.substring(0, 7)));
        if (months.size >= 2) {
          const avg = data.amounts.reduce((a, b) => a + b, 0) / data.amounts.length;
          detected.push({
            description: recentExpenses.find(e => e.description.toLowerCase().trim() === desc)?.description ?? desc,
            averageAmount: Math.round(avg),
            occurrences: data.amounts.length,
            lastDate: data.dates[0],
            category: data.category,
          });
        }
      }

      // Proyección del mes siguiente
      const { data: financialProfile } = await supabase
        .from('financial_profiles')
        .select('income_range, fixed_expenses_estimated')
        .eq('user_id', userId)
        .single();

      const estimatedIncome = financialProfile?.income_range
        ? INCOME_RANGE_MAP[financialProfile.income_range] ?? null
        : null;

      // Promedio mensual de gastos últimos 3 meses
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const monthlyTotals: Record<string, number> = {};
      for (const e of recentExpenses) {
        const month = e.date.substring(0, 7);
        if (month >= threeMonthsAgo.toISOString().substring(0, 7)) {
          monthlyTotals[month] = (monthlyTotals[month] ?? 0) + e.amount;
        }
      }
      const months = Object.values(monthlyTotals);
      const avgMonthlySpend = months.length > 0
        ? months.reduce((a, b) => a + b, 0) / months.length
        : 0;

      const subscriptionTotal = detected.reduce((sum, s) => sum + s.averageAmount, 0);
      const projectedExpenses = Math.max(avgMonthlySpend, subscriptionTotal);
      const projectedBalance = estimatedIncome !== null
        ? estimatedIncome - projectedExpenses
        : null;

      // Mes anterior y promedio 3 meses para contexto comparativo
      const now = new Date();
      const thisMonthKey = now.toISOString().substring(0, 7);
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthKey  = lastMonthDate.toISOString().substring(0, 7);

      const lastMonthTotal = monthlyTotals[lastMonthKey] ?? null;
      const avgLast3Months = months.length > 0
        ? Math.round(months.reduce((a, b) => a + b, 0) / months.length)
        : null;

      // Notificar suscripciones nuevas (que no estaban antes)
      const prev = get().subscriptions;
      const prevDescriptions = new Set(prev.map(s => s.description.toLowerCase()));
      for (const sub of detected) {
        if (!prevDescriptions.has(sub.description.toLowerCase())) {
          notifyNewSubscription(sub.description, sub.averageAmount).catch(() => {});
        }
      }

      set({ subscriptions: detected, projectedBalance, estimatedIncome, lastMonthTotal, avgLast3Months });
    } catch {
      // Silencioso — no es crítico
    }
  },
}));
