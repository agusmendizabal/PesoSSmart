/**
 * streakStore — Gamificación mínima de Nomi
 *
 * Rastrea:
 *  - weekStreak:          semanas consecutivas dentro del presupuesto
 *  - noDisposableStreak:  días consecutivos sin gastos prescindibles
 *  - bestWeekStreak:      récord personal de semanas
 *  - lastExpenseDate:     para detectar inactividad
 *  - monthsUnderBudget:   para badge "BUEN MES"
 *
 * Persiste en AsyncStorage (local) para no requerir backend.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyStreakBroken, notifyStreakMilestone } from '@/lib/notifications';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface StreakState {
  weekStreak:          number;
  noDisposableStreak:  number;
  bestWeekStreak:      number;
  lastExpenseDate:     string | null;   // YYYY-MM-DD
  lastCheckedWeek:     string | null;   // YYYY-Www
  monthsUnderBudget:   number;
  lastCheckedMonth:    string | null;   // YYYY-MM
  isLoaded:            boolean;

  load:                () => Promise<void>;
  save:                () => Promise<void>;

  /** Llamar al agregar cualquier gasto */
  recordExpense:       (date: string, classification: 'necessary' | 'disposable' | 'investable') => Promise<void>;

  /** Llamar al cerrar el mes (cuando el usuario cierra dentro del presupuesto) */
  recordGoodWeek:      () => Promise<void>;
  recordBadWeek:       () => Promise<void>;

  /** Llamar el día 1 de cada mes con el resultado del mes anterior */
  recordMonthResult:   (underBudget: boolean) => Promise<void>;

  reset:               () => Promise<void>;
}

// ─── Claves AsyncStorage ─────────────────────────────────────────────────────

const KEYS = {
  weekStreak:         '@sp/streak/week',
  noDisposable:       '@sp/streak/noDisposable',
  bestWeek:           '@sp/streak/bestWeek',
  lastExpense:        '@sp/streak/lastExpenseDate',
  lastCheckedWeek:    '@sp/streak/lastCheckedWeek',
  monthsUnderBudget:  '@sp/streak/monthsUnderBudget',
  lastCheckedMonth:   '@sp/streak/lastCheckedMonth',
};

function currentWeekStr(): string {
  const d   = new Date();
  const jan = new Date(d.getFullYear(), 0, 1);
  const wk  = Math.ceil(((d.getTime() - jan.getTime()) / 86400000 + jan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStreakStore = create<StreakState>((set, get) => ({
  weekStreak:         0,
  noDisposableStreak: 0,
  bestWeekStreak:     0,
  lastExpenseDate:    null,
  lastCheckedWeek:    null,
  monthsUnderBudget:  0,
  lastCheckedMonth:   null,
  isLoaded:           false,

  load: async () => {
    try {
      const [wk, nd, bw, le, lcw, mub, lcm] = await AsyncStorage.multiGet([
        KEYS.weekStreak, KEYS.noDisposable, KEYS.bestWeek,
        KEYS.lastExpense, KEYS.lastCheckedWeek,
        KEYS.monthsUnderBudget, KEYS.lastCheckedMonth,
      ]);
      set({
        weekStreak:         parseInt(wk[1]  ?? '0',  10),
        noDisposableStreak: parseInt(nd[1]  ?? '0',  10),
        bestWeekStreak:     parseInt(bw[1]  ?? '0',  10),
        lastExpenseDate:    le[1]  ?? null,
        lastCheckedWeek:    lcw[1] ?? null,
        monthsUnderBudget:  parseInt(mub[1] ?? '0',  10),
        lastCheckedMonth:   lcm[1] ?? null,
        isLoaded:           true,
      });
    } catch {
      set({ isLoaded: true });
    }
  },

  save: async () => {
    const s = get();
    try {
      await AsyncStorage.multiSet([
        [KEYS.weekStreak,        String(s.weekStreak)],
        [KEYS.noDisposable,      String(s.noDisposableStreak)],
        [KEYS.bestWeek,          String(s.bestWeekStreak)],
        [KEYS.lastExpense,       s.lastExpenseDate  ?? ''],
        [KEYS.lastCheckedWeek,   s.lastCheckedWeek  ?? ''],
        [KEYS.monthsUnderBudget, String(s.monthsUnderBudget)],
        [KEYS.lastCheckedMonth,  s.lastCheckedMonth ?? ''],
      ]);
    } catch { /* ignore */ }
  },

  recordExpense: async (date, classification) => {
    const s    = get();
    const prev = s.lastExpenseDate;
    const prevDate = prev ? new Date(prev) : null;
    const curr     = new Date(date);

    let newNoDisposable = s.noDisposableStreak;

    if (classification === 'disposable') {
      // Gasté algo prescindible hoy — ¿rompe la racha?
      if (newNoDisposable > 0) {
        const broke = newNoDisposable;
        newNoDisposable = 0;
        await notifyStreakBroken(broke);
      }
    } else {
      // Sin prescindible → posible extensión de racha
      if (prevDate) {
        const diff = Math.round((curr.getTime() - prevDate.getTime()) / 86400000);
        if (diff === 1) {
          // Día consecutivo
          newNoDisposable += 1;
          await notifyStreakMilestone(newNoDisposable);
        } else if (diff > 1) {
          // Hubo un gap — ¿perdió la racha sin prescindibles? Mantiene si no cargó nada
          // (No penalizamos el no-registro, solo el gasto prescindible)
        }
      } else {
        newNoDisposable = 1;
      }
    }

    set({ noDisposableStreak: newNoDisposable, lastExpenseDate: date });
    await get().save();
  },

  recordGoodWeek: async () => {
    const s       = get();
    const thisWeek = currentWeekStr();
    if (s.lastCheckedWeek === thisWeek) return; // ya procesamos esta semana

    const newStreak = s.weekStreak + 1;
    const newBest   = Math.max(newStreak, s.bestWeekStreak);
    set({
      weekStreak:      newStreak,
      bestWeekStreak:  newBest,
      lastCheckedWeek: thisWeek,
    });
    await get().save();
  },

  recordBadWeek: async () => {
    const s        = get();
    const thisWeek = currentWeekStr();
    if (s.lastCheckedWeek === thisWeek) return;

    set({ weekStreak: 0, lastCheckedWeek: thisWeek });
    await get().save();
  },

  recordMonthResult: async (underBudget) => {
    const s         = get();
    const thisMonth = currentMonthStr();
    if (s.lastCheckedMonth === thisMonth) return;

    const newCount = underBudget ? s.monthsUnderBudget + 1 : 0;
    set({ monthsUnderBudget: newCount, lastCheckedMonth: thisMonth });
    await get().save();
  },

  reset: async () => {
    set({
      weekStreak: 0, noDisposableStreak: 0, bestWeekStreak: 0,
      lastExpenseDate: null, lastCheckedWeek: null,
      monthsUnderBudget: 0, lastCheckedMonth: null,
    });
    await get().save();
  },
}));
