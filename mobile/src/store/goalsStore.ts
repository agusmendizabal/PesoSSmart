import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

export interface SavingsGoal {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  emoji: string;
  created_at: string;
}

interface GoalsState {
  goals: SavingsGoal[];
  isLoading: boolean;

  fetchGoals: (userId: string) => Promise<void>;
  addGoal: (userId: string, data: Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  updateGoal: (id: string, data: Partial<SavingsGoal>) => Promise<void>;
  addToGoal: (id: string, amount: number) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  isLoading: false,

  fetchGoals: async (userId) => {
    set({ isLoading: true });
    try {
      const { data } = await supabase
        .from('savings_goals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      set({ goals: data ?? [] });
    } finally {
      set({ isLoading: false });
    }
  },

  addGoal: async (userId, data) => {
    const { error, data: created } = await supabase
      .from('savings_goals')
      .insert({ ...data, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    set((s) => ({ goals: [...s.goals, created] }));
  },

  updateGoal: async (id, data) => {
    const { error, data: updated } = await supabase
      .from('savings_goals')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    set((s) => ({ goals: s.goals.map((g) => (g.id === id ? updated : g)) }));
  },

  addToGoal: async (id, amount) => {
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    const newAmount = Math.min(goal.current_amount + amount, goal.target_amount);
    await get().updateGoal(id, { current_amount: newAmount });
  },

  deleteGoal: async (id) => {
    const { error } = await supabase.from('savings_goals').delete().eq('id', id);
    if (error) throw error;
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
  },
}));