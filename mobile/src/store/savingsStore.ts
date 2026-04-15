import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export type InstrumentType =
  | 'fci' | 'cedear' | 'plazo_fijo' | 'crypto' | 'bonds' | 'acciones' | 'other';

export type SavingCurrency = 'ARS' | 'USD';
export type SavingType     = 'cash' | 'other';

export interface Saving {
  id:         string;
  user_id:    string;
  label:      string;
  amount:     number;
  currency:   SavingCurrency;
  type:       SavingType;
  created_at: string;
  updated_at: string;
}

export interface Investment {
  id:              string;
  user_id:         string;
  name:            string;
  instrument_type: InstrumentType;
  amount:          number;
  currency:        SavingCurrency;
  annual_return:   number | null;
  start_date:      string | null;
  notes:           string | null;
  created_at:      string;
  updated_at:      string;
}

interface SavingsState {
  savings:     Saving[];
  investments: Investment[];
  isLoading:   boolean;

  fetchAll:         (userId: string) => Promise<void>;
  addSaving:        (userId: string, data: Omit<Saving, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateSaving:     (id: string, data: Partial<Saving>) => Promise<void>;
  deleteSaving:     (id: string) => Promise<void>;
  addInvestment:    (userId: string, data: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateInvestment: (id: string, data: Partial<Investment>) => Promise<void>;
  deleteInvestment: (id: string) => Promise<void>;
}

export const useSavingsStore = create<SavingsState>((set, get) => ({
  savings:     [],
  investments: [],
  isLoading:   false,

  fetchAll: async (userId) => {
    set({ isLoading: true });
    try {
      const db = supabase as any;
      const [{ data: sv }, { data: inv }] = await Promise.all([
        db.from('savings').select('*').eq('user_id', userId).order('created_at'),
        db.from('investments').select('*').eq('user_id', userId).order('created_at'),
      ]);
      set({ savings: (sv ?? []) as Saving[], investments: (inv ?? []) as Investment[] });
    } finally {
      set({ isLoading: false });
    }
  },

  addSaving: async (userId, data) => {
    const { data: created, error } = await (supabase as any)
      .from('savings').insert({ ...data, user_id: userId }).select().single();
    if (error) throw error;
    set(s => ({ savings: [...s.savings, created as Saving] }));
  },

  updateSaving: async (id, data) => {
    const { data: updated, error } = await (supabase as any)
      .from('savings').update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    set(s => ({ savings: s.savings.map(x => x.id === id ? updated as Saving : x) }));
  },

  deleteSaving: async (id) => {
    const { error } = await (supabase as any).from('savings').delete().eq('id', id);
    if (error) throw error;
    set(s => ({ savings: s.savings.filter(x => x.id !== id) }));
  },

  addInvestment: async (userId, data) => {
    const { data: created, error } = await (supabase as any)
      .from('investments').insert({ ...data, user_id: userId }).select().single();
    if (error) throw error;
    set(s => ({ investments: [...s.investments, created as Investment] }));
  },

  updateInvestment: async (id, data) => {
    const { data: updated, error } = await (supabase as any)
      .from('investments').update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    set(s => ({ investments: s.investments.map(x => x.id === id ? updated as Investment : x) }));
  },

  deleteInvestment: async (id) => {
    const { error } = await (supabase as any).from('investments').delete().eq('id', id);
    if (error) throw error;
    set(s => ({ investments: s.investments.filter(x => x.id !== id) }));
  },
}));
