/**
 * recurringAdjustment.ts
 *
 * Capa de integración entre `recurringExpenses.ts` (detección pura) y el motor
 * de ritmo de `budgetPlan.ts` (sin modificarlo). Dos responsabilidades:
 *
 *   1. `fetchRecurringEvaluations` — trae las transacciones crudas de Supabase
 *      y las evalúa contra patrones recurrentes.
 *   2. `applyRecurringContext` — para cada `CategoryBudget` ya calculado por
 *      `fetchBudgetPlan`, si tiene un pago recurrente "esperado" de alta
 *      confianza, resta esa porción antes de reclasificar con `deriveAlertLevel`
 *      (mismos umbrales y misma función que usa el resto de la app — no se
 *      reimplementa la clasificación). Si el pago recurrente llegó "desviado"
 *      este mes, NO se resta — se deja que el monto completo fluya al cálculo
 *      normal de ritmo, que ya lo va a marcar como corresponde.
 */

import { supabase } from '@/lib/supabase';
import {
  deriveAlertLevel,
  alertLevelToStatus,
  type AlertLevel,
  type BudgetPlan,
  type CategoryBudget,
} from './budgetPlan';
import {
  evaluateRecurringExpenses,
  LOOKBACK_MONTHS,
  type RawExpenseRecord,
  type RecurringEvaluation,
  type RecurringConfidence,
  type RecurringStatus,
} from './recurringExpenses';

// Por debajo de este umbral, "lo que queda" de la categoría sin el gasto
// recurrente es tan chico que cualquier paceRatio calculado sobre ese resto es
// ruido, no señal (una sola compra chica ya parecería "el doble de lo normal").
const MIN_REMAINDER_FRACTION = 0.1;

export interface RecurringDisplayInfo {
  description:      string;
  status:            RecurringStatus; // 'esperado' | 'desviado' ('pendiente' no se expone acá)
  historicalAmount:  number;
  currentAmount:     number | null;
  confidence:        RecurringConfidence;
}

export interface CategoryBudgetWithRecurring extends CategoryBudget {
  /** Patrón recurrente más relevante de esta categoría este mes, si existe. */
  recurring: RecurringDisplayInfo | null;
  /** Nivel que tenía la categoría ANTES de ajustar por recurrencia — para saber si el ajuste cambió algo. */
  originalAlertLevel: AlertLevel;
}

/** Trae las transacciones crudas (últimos `LOOKBACK_MONTHS` + el mes actual) y evalúa recurrencia. */
export async function fetchRecurringEvaluations(userId: string): Promise<RecurringEvaluation[]> {
  const now          = new Date();
  const curYear       = now.getFullYear();
  const curMonth      = now.getMonth(); // 0-indexed
  const referenceMonthKey = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
  const currentStart  = `${referenceMonthKey}-01`;
  const historyStart  = new Date(curYear, curMonth - LOOKBACK_MONTHS, 1).toISOString().split('T')[0];

  const { data, error } = await (supabase as any)
    .from('expenses')
    .select('description, amount, date, category_id')
    .eq('user_id', userId)
    .gte('date', historyStart)
    .is('deleted_at', null);

  if (error || !data) return [];

  const records: RawExpenseRecord[] = data.map((r: any) => ({
    description: r.description ?? '',
    amount:      Number(r.amount),
    date:        r.date,
    categoryId:  r.category_id ?? null,
  }));

  const history      = records.filter(r => r.date < currentStart);
  const currentMonth = records.filter(r => r.date >= currentStart);

  return evaluateRecurringExpenses(history, currentMonth, referenceMonthKey);
}

/**
 * Ajusta las categorías del plan ya calculado, restando la porción de gasto
 * recurrente "esperada" (alta confianza) antes de reclasificar con `deriveAlertLevel`.
 * No toca `plan.categories` original — devuelve una copia.
 */
export function applyRecurringContext(
  plan: BudgetPlan,
  evaluations: RecurringEvaluation[],
): CategoryBudgetWithRecurring[] {
  const dayPct = Math.max(plan.dayOfMonth / plan.daysInMonth, 0.05); // misma fórmula que budgetPlan.ts

  return plan.categories.map((cat): CategoryBudgetWithRecurring => {
    const catEvals = evaluations.filter(e => e.pattern.categoryId === cat.categoryId);
    if (catEvals.length === 0) {
      return { ...cat, recurring: null, originalAlertLevel: cat.alertLevel };
    }

    // Elegir qué mostrar: un pago "desviado" es más relevante que uno "esperado"
    // (hay algo que explicar); entre varios "esperados", el de mayor monto.
    const desviado = catEvals.find(e => e.status === 'desviado');
    const primary  = desviado ?? [...catEvals]
      .filter(e => e.status !== 'pendiente')
      .sort((a, b) => b.pattern.medianAmount - a.pattern.medianAmount)[0];

    const recurring: RecurringDisplayInfo | null = primary ? {
      description:     primary.pattern.description,
      status:           primary.status as 'esperado' | 'desviado',
      historicalAmount: primary.pattern.medianAmount,
      currentAmount:    primary.currentAmount,
      confidence:       primary.pattern.confidence,
    } : null;

    // Solo se resta lo "esperado" de confianza alta — un "desviado" se deja
    // fluir sin ajustar (así el motor de ritmo lo detecta por su cuenta), y un
    // "pendiente" no tiene monto este mes que restar.
    let recurringCurrentSum = 0;
    let recurringAvgSum     = 0;
    for (const ev of catEvals) {
      if (ev.status === 'esperado' && ev.pattern.confidence === 'alta') {
        recurringCurrentSum += ev.currentAmount ?? 0;
        recurringAvgSum     += ev.pattern.medianAmount;
      }
    }

    if (recurringCurrentSum <= 0 || recurringAvgSum <= 0) {
      return { ...cat, recurring, originalAlertLevel: cat.alertLevel };
    }

    const adjustedAvgMonthly = Math.max(0, cat.avgMonthly - recurringAvgSum);

    // Si el remanente no-recurrente es una porción insignificante del promedio
    // de la categoría (p. ej. "Vivienda" es 99% alquiler), el paceRatio de ese
    // remanente es ruido de punto flotante, no una señal real — y mostrar
    // "Gastaste $0 de $0,003" es más confuso que informativo. Se preserva la
    // clasificación 'normal' (el recurrente llegó a su monto habitual, nada que
    // alertar) pero se muestran los montos REALES de la categoría, no el
    // remanente casi-cero — a diferencia del bail-out de abajo (que deja todo
    // sin tocar), acá SÍ afirmamos 'normal' porque ya sabemos que el pago
    // recurrente que domina la categoría llegó dentro de lo esperado.
    if (adjustedAvgMonthly < cat.avgMonthly * MIN_REMAINDER_FRACTION) {
      return {
        ...cat,
        alertLevel: 'normal',
        status: alertLevelToStatus('normal'),
        recurring,
        originalAlertLevel: cat.alertLevel,
      };
    }

    const adjustedCurrentSpend  = Math.max(0, cat.currentSpend - recurringCurrentSum);
    const adjustedPct           = adjustedCurrentSpend / adjustedAvgMonthly;
    const adjustedExpectedByNow = adjustedAvgMonthly * dayPct;
    const adjustedPaceRatio     = adjustedPct / dayPct;
    const adjustedProjected     = adjustedCurrentSpend / dayPct;
    const adjustedAlertLevel    = deriveAlertLevel(
      adjustedPaceRatio, cat.historyMonths, plan.dayOfMonth, adjustedPct, dayPct,
    );

    return {
      ...cat,
      currentSpend:  adjustedCurrentSpend,
      avgMonthly:    adjustedAvgMonthly,
      pct:           adjustedPct,
      expectedByNow: adjustedExpectedByNow,
      paceRatio:     adjustedPaceRatio,
      projected:     adjustedProjected,
      alertLevel:    adjustedAlertLevel,
      status:        alertLevelToStatus(adjustedAlertLevel),
      recurring,
      originalAlertLevel: cat.alertLevel,
    };
  });
}
