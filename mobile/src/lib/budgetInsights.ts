/**
 * budgetInsights.ts
 *
 * Narrativa en lenguaje humano para cada categoría de Plan Inteligente,
 * a partir de los números que ya calcula `budgetPlan.ts`. Mismo espíritu que
 * `generateInsights` en `utils/inflationCalc.ts`: texto generado desde datos
 * reales del usuario, no plantillas genéricas.
 */

import type { AlertLevel, BudgetPlan, CategoryBudget } from './budgetPlan';
import { formatCurrency } from '@/utils/format';

export interface CategoryInsight {
  categoryId: string;
  level:      AlertLevel;
  emoji:      string;
  headline:   string;
  body:       string;
  /** Monto de la oportunidad (ahorro logrado) o del exceso proyectado, cuando aplica. */
  amount:     number | null;
}

const EMOJI: Record<AlertLevel, string> = {
  normal:      '🟢',
  atencion:    '🟡',
  alerta:      '🔴',
  oportunidad: '✨',
};

const HEADLINE: Record<AlertLevel, string> = {
  normal:      'Vas bien',
  atencion:    'Ojo con esta categoría',
  alerta:      'Vas por encima de tu ritmo',
  oportunidad: 'Oportunidad de ahorro',
};

/** "los últimos 3 meses" / "los últimos 2 meses" — de dónde sale el promedio, siempre explícito. */
function historyLabel(historyMonths: number): string {
  return `los últimos ${historyMonths} meses`;
}

/** Insight de una categoría puntual, con montos reales del usuario. */
export function buildCategoryInsight(cat: CategoryBudget, plan: Pick<BudgetPlan, 'dayOfMonth' | 'daysInMonth'>): CategoryInsight {
  const pctOfAvg = Math.round(cat.pct * 100);
  // "excess" — cuánto te pasarías del promedio si el mes terminara al ritmo actual (alerta/atención).
  const excess          = Math.max(0, cat.projected - cat.avgMonthly);
  // "aheadToday" — cuánto llevás gastado de menos, medido HOY contra el ritmo esperado a esta altura.
  const aheadToday      = Math.max(0, cat.expectedByNow - cat.currentSpend);
  // "projectedSaving" — proyección al cierre de mes: si el ritmo actual se mantiene, cuánto quedarías
  // por debajo del promedio histórico total. Es la cifra que corresponde a "si mantenés este ritmo,
  // podrías ahorrar X" — deliberadamente distinta de `aheadToday`, que es solo la foto de hoy.
  const projectedSaving = Math.max(0, cat.avgMonthly - cat.projected);

  // Con menos de 2 meses de historial no hay ritmo confiable — decirlo
  // explícitamente en vez de mostrar un "vas bien" que no está respaldado.
  // Encuadrado como algo positivo y transitorio ("todavía estamos aprendiendo"),
  // no como un error o una funcionalidad rota.
  if (cat.historyMonths < 2) {
    return {
      categoryId: cat.categoryId,
      level:      'normal',
      emoji:      '🌱', // distinto del ✨ de "oportunidad" — mismo alertLevel visualmente ('normal'), pero no deben confundirse en una lista
      headline:   'Estamos conociendo tus hábitos',
      body:       cat.historyMonths === 0
        ? `Es la primera vez que registrás gastos en ${cat.name.toLowerCase()}. Todavía no tenemos suficiente historial para darte una recomendación precisa — en un par de meses vamos a poder mostrarte tu ritmo habitual acá.`
        : `Ya tenemos 1 mes de referencia en ${cat.name.toLowerCase()}, pero todavía no alcanza para una comparación confiable (un solo mes puede no ser representativo). Con 1 mes más vamos a poder calcular tu ritmo habitual.`,
      amount: null,
    };
  }

  let body: string;
  let amount: number | null = null;

  switch (cat.alertLevel) {
    case 'alerta':
      amount = excess;
      body =
        `Ya gastaste ${formatCurrency(cat.currentSpend)} en ${cat.name.toLowerCase()} — es el ${pctOfAvg}% de lo que normalmente gastás en todo el mes, ` +
        `comparado con tu promedio de ${historyLabel(cat.historyMonths)} (${formatCurrency(cat.avgMonthly)}), y todavía estás en el día ${plan.dayOfMonth} de ${plan.daysInMonth}. ` +
        `Si mantenés este ritmo, podrías terminar el mes ${formatCurrency(excess)} por encima de tu promedio.`;
      break;
    case 'atencion':
      amount = excess > 0 ? excess : null;
      body =
        `Ya consumiste el ${pctOfAvg}% de lo que normalmente gastás en ${cat.name.toLowerCase()} durante todo el mes, ` +
        `comparado con tu promedio de ${historyLabel(cat.historyMonths)}, y vas apenas por el día ${plan.dayOfMonth} de ${plan.daysInMonth}. Vas un poco más rápido que tu ritmo habitual` +
        (amount ? ` — si sigue así, podrías terminar ${formatCurrency(amount)} por encima de tu promedio.` : '.');
      break;
    case 'oportunidad':
      amount = projectedSaving > 0 ? projectedSaving : aheadToday;
      body =
        `Vas gastando menos que tu ritmo habitual en ${cat.name.toLowerCase()}: llevás ${formatCurrency(cat.currentSpend)}, ` +
        `cuando a esta altura del mes (día ${plan.dayOfMonth} de ${plan.daysInMonth}) tu promedio de ${historyLabel(cat.historyMonths)} marca ${formatCurrency(cat.expectedByNow)}. ` +
        (projectedSaving > 0
          ? `Si se mantiene este ritmo, podrías terminar el mes con aproximadamente ${formatCurrency(projectedSaving)} menos que tu promedio habitual.`
          : `Todavía es pronto para saber cuánto vas a ahorrar en total este mes.`);
      break;
    default:
      body = `Tu gasto en ${cat.name.toLowerCase()} está dentro de tu ritmo habitual (comparado con tu promedio de ${historyLabel(cat.historyMonths)}) para el día ${plan.dayOfMonth} de ${plan.daysInMonth}.`;
  }

  return {
    categoryId: cat.categoryId,
    level:      cat.alertLevel,
    emoji:      EMOJI[cat.alertLevel],
    headline:   HEADLINE[cat.alertLevel],
    body,
    amount,
  };
}

/**
 * Selecciona los insights más relevantes de todo el plan, para no saturar la
 * pantalla de alertas (spec: priorizar desviación grande, prescindibles,
 * cambios bruscos y oportunidades claras — acá aproximado por severidad y
 * magnitud del monto involucrado).
 */
export function selectRelevantInsights(plan: BudgetPlan, max = 3): CategoryInsight[] {
  const priority: Record<AlertLevel, number> = { alerta: 0, atencion: 1, oportunidad: 2, normal: 3 };

  const candidates = plan.categories
    .filter(c => c.alertLevel !== 'normal')
    .map(c => buildCategoryInsight(c, plan))
    .sort((a, b) => {
      if (priority[a.level] !== priority[b.level]) return priority[a.level] - priority[b.level];
      return (b.amount ?? 0) - (a.amount ?? 0);
    });

  return candidates.slice(0, max);
}

/** Un mensaje-resumen para cuando no hay ninguna categoría fuera de lo normal. */
export function buildAllGoodInsight(): CategoryInsight {
  return {
    categoryId: '__all_good__',
    level:      'normal',
    emoji:      '🟢',
    headline:   'Vas bien',
    body:       'Todas tus categorías están dentro de tu ritmo habitual este mes.',
    amount:     null,
  };
}
