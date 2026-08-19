/**
 * savingsDestinationContext.ts
 *
 * Capa de integración entre `savingsDestination.ts` (lógica pura) y Supabase —
 * mismo espíritu que `recurringAdjustment.ts` para `recurringExpenses.ts`.
 * Junta lo que ya sabemos del usuario (financial_profiles, risk_profiles,
 * savings_goals, savings) en un `UserFinancialContext`, sin inventar ni
 * completar nada que no exista.
 */

import { supabase } from '@/lib/supabase';
import type { UserFinancialContext } from './savingsDestination';

const supa = supabase as any;

export async function fetchUserFinancialContext(userId: string, opts: {
  monthlyPotentialSaving: number;
  estimatedIncome: number | null;
  avgMonthlySpend: number;
}): Promise<UserFinancialContext> {
  const [{ data: fp }, { data: rp }, { data: goals }, { data: liveSavings }] = await Promise.all([
    supa.from('financial_profiles')
      .select('has_savings, savings_amount, has_debt, debt_amount')
      .eq('user_id', userId)
      .single(),
    supa.from('risk_profiles')
      .select('profile')
      .eq('user_id', userId)
      .single(),
    supa.from('savings_goals')
      .select('id, title, target_amount, current_amount, deadline')
      .eq('user_id', userId),
    supa.from('savings')
      .select('amount, currency')
      .eq('user_id', userId),
  ]);

  // Solo se sincroniza el ahorro en ARS del registro "en vivo" — mezclar ARS y
  // USD nominal sería inventar un tipo de cambio. Si el usuario solo tiene
  // ahorros en USD, se cae al snapshot de onboarding en vez de mostrar "$0".
  const arsRecords = (liveSavings ?? []).filter((s: any) => s.currency === 'ARS');
  const hasArsLiveRecords = arsRecords.length > 0;
  const arsLiveTotal = arsRecords.reduce((sum: number, s: any) => sum + Number(s.amount), 0);

  let savingsAmount: number | null = null;
  let savingsSource: UserFinancialContext['savings']['source'] = 'unknown';

  if (hasArsLiveRecords) {
    savingsAmount = arsLiveTotal;
    savingsSource = 'live';
  } else if (fp && fp.has_savings === true && fp.savings_amount != null) {
    savingsAmount = Number(fp.savings_amount);
    savingsSource = 'onboarding_snapshot';
  } else if (fp && fp.has_savings === false) {
    savingsAmount = 0;
    savingsSource = 'onboarding_snapshot';
  }

  return {
    monthlyPotentialSaving: opts.monthlyPotentialSaving,
    estimatedIncome:        opts.estimatedIncome,
    avgMonthlySpend:        opts.avgMonthlySpend,
    savings: { amount: savingsAmount, source: savingsSource },
    debt: fp
      ? { known: true, hasDebt: fp.has_debt ?? null, amount: fp.debt_amount != null ? Number(fp.debt_amount) : null }
      : { known: false, hasDebt: null, amount: null },
    goals: (goals ?? []).map((g: any) => ({
      id:            g.id,
      title:         g.title,
      targetAmount:  Number(g.target_amount),
      currentAmount: Number(g.current_amount),
      deadline:      g.deadline,
    })),
    riskProfile: rp?.profile ?? null,
  };
}
