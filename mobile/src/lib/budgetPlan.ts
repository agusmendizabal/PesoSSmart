import { supabase } from '@/lib/supabase';

/**
 * Nivel de alerta ajustado por ritmo — no es solo "% del promedio gastado",
 * es "% del promedio gastado, comparado contra lo que correspondería haber
 * gastado a esta altura del mes". Ver `paceRatio` más abajo.
 */
export type AlertLevel = 'normal' | 'atencion' | 'alerta' | 'oportunidad';

/** Mantenido por compatibilidad con pantallas que todavía no migraron. */
export type BudgetStatus = 'ok' | 'warning' | 'over';

// Umbrales de paceRatio (gasto real / ritmo esperado a esta altura del mes).
const PACE_OPORTUNIDAD_MAX = 0.7;  // < 70% del ritmo esperado → vas bastante más lento, oportunidad de ahorro
const PACE_ATENCION_MIN    = 1.15; // 15% más rápido que el ritmo esperado
const PACE_ALERTA_MIN      = 1.6;  // 60% más rápido — desvío grande

// Con 1 solo mes de historial, "el promedio" es en realidad un único dato — no
// alcanza para confiar en una comparación de ritmo (un mes atípico define todo).
const MIN_HISTORY_MONTHS_FOR_PACE = 2;

// Primeros días del mes: dayPct es tan chico que una sola compra normal ya
// parece "el doble de rápido de lo normal". Durante esta ventana, solo se
// evalúa el ritmo si el gasto acumulado ya es una fracción grande y objetiva
// del promedio mensual completo — no según la proyección lineal por día.
const EARLY_MONTH_GRACE_DAYS      = 3;
const EARLY_MONTH_ABS_PCT_TRIGGER = 0.5; // 50% del promedio mensual ya gastado

// "Gastar menos" recién significa algo confiable cuando ya pasó una porción
// razonable del mes — a los pocos días, un paceRatio bajo es tan probable que
// sea "todavía no compré" como "genuinamente gasto menos". Sin este freno,
// una categoría en $0 el día 4 ya se mostraba como "oportunidad de ahorro".
// Nota: esto NO toca los umbrales de paceRatio (0.7/1.15/1.6) — solo agrega
// una condición extra específica para el lado de "oportunidad".
const OPORTUNIDAD_MIN_MONTH_ELAPSED = 0.3; // al menos ~30% del mes ya transcurrido

/**
 * Exportada (sin cambiar su lógica) para que `recurringAdjustment.ts` pueda
 * reclasificar una categoría usando el remanente no-recurrente del gasto,
 * con exactamente los mismos umbrales y reglas que el resto de la app.
 */
export function deriveAlertLevel(
  paceRatio: number,
  historyMonths: number,
  dayOfMonth: number,
  pct: number,
  dayPct: number,
): AlertLevel {
  // Sin al menos 2 meses de historial real no hay ritmo confiable contra el
  // cual comparar — evita marcar como alerta/oportunidad una categoría nueva
  // o con un solo dato histórico (podría ser un mes atípico).
  if (historyMonths < MIN_HISTORY_MONTHS_FOR_PACE) return 'normal';

  const inGracePeriod = dayOfMonth <= EARLY_MONTH_GRACE_DAYS;
  if (inGracePeriod && pct < EARLY_MONTH_ABS_PCT_TRIGGER) return 'normal';

  if (paceRatio < PACE_OPORTUNIDAD_MAX) {
    if (inGracePeriod || dayPct < OPORTUNIDAD_MIN_MONTH_ELAPSED) return 'normal';
    return 'oportunidad';
  }
  if (paceRatio >= PACE_ALERTA_MIN)     return 'alerta';
  if (paceRatio >= PACE_ATENCION_MIN)   return 'atencion';
  return 'normal';
}

/** `AlertLevel` de 4 niveles → `BudgetStatus` de 3, para lo que todavía no migró. */
export function alertLevelToStatus(level: AlertLevel): BudgetStatus {
  if (level === 'alerta') return 'over';
  if (level === 'atencion') return 'warning';
  return 'ok';
}

/**
 * Mismo par de fórmulas que usa `budgetInsights.ts` para el texto de cada
 * categoría (`excess` / `projectedSaving`) — extraída como función exportada
 * (en vez de quedar inline en `fetchBudgetPlan`) para que `recurringAdjustment.ts`
 * pueda recalcular este total sobre categorías ya ajustadas por recurrencia,
 * usando exactamente la misma fórmula — nunca dos números distintos para lo mismo.
 */
export function computePotentialSavings(categories: CategoryBudget[]): number {
  return categories.reduce((s, c) => {
    if (c.alertLevel === 'atencion' || c.alertLevel === 'alerta') {
      return s + Math.max(0, c.projected - c.avgMonthly);
    }
    if (c.alertLevel === 'oportunidad') {
      return s + Math.max(0, c.avgMonthly - c.projected);
    }
    return s;
  }, 0);
}

export interface CategoryBudget {
  categoryId:   string;
  name:         string;
  icon:         string | null;
  color:        string | null;
  avgMonthly:   number;
  currentSpend: number;
  /** currentSpend / avgMonthly — % del promedio mensual ya consumido. */
  pct:          number;
  /** avgMonthly * dayPct del plan — lo que "correspondería" haber gastado a esta altura del mes. */
  expectedByNow: number;
  /** pct / dayPct — 1.0 = exactamente al ritmo esperado, >1 = más rápido, <1 = más lento. */
  paceRatio:    number;
  projected:    number;
  monthHistory: { month: string; label: string; amount: number }[];
  /** Cuántos de los últimos 3 meses tienen gasto real registrado (0-3). */
  historyMonths: number;
  /** true si `historyMonths` alcanza para una comparación de ritmo confiable (≥2). */
  hasHistory:   boolean;
  alertLevel:   AlertLevel;
  /** @deprecated usar `alertLevel` — se mantiene para pantallas no migradas. */
  status:       BudgetStatus;
}

export interface BudgetPlan {
  categories:        CategoryBudget[];
  totalAvg:          number;
  totalCurrentSpend: number;
  totalProjected:    number;
  potentialSavings:  number;
  dayOfMonth:        number;
  daysInMonth:       number;
  monthLabel:        string;
}

const MONTH_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const MONTH_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                     'Septiembre','Octubre','Noviembre','Diciembre'];

export async function fetchBudgetPlan(userId: string): Promise<BudgetPlan | null> {
  const now           = new Date();
  const curYear       = now.getFullYear();
  const curMonth      = now.getMonth(); // 0-indexed
  const currentStart  = `${curYear}-${String(curMonth + 1).padStart(2, '0')}-01`;
  const historyStart  = new Date(curYear, curMonth - 3, 1).toISOString().split('T')[0];

  const { data: expenses, error } = await (supabase as any)
    .from('expenses')
    .select('amount, date, category_id, category:expense_categories(name_es, icon, color)')
    .eq('user_id', userId)
    .gte('date', historyStart)
    .is('deleted_at', null);

  if (error || !expenses) return null;

  const dayOfMonth  = now.getDate();
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const dayPct      = Math.max(dayOfMonth / daysInMonth, 0.05);

  const catMap: Record<string, {
    name: string; icon: string | null; color: string | null;
    months: Record<string, number>; current: number;
  }> = {};

  for (const exp of expenses) {
    if (!exp.category_id) continue;
    const id     = exp.category_id;
    const cat    = exp.category;
    const amount = Number(exp.amount);
    const month  = (exp.date as string).substring(0, 7);

    if (!catMap[id]) {
      catMap[id] = {
        name:    cat?.name_es ?? 'Sin categoría',
        icon:    cat?.icon ?? null,
        color:   cat?.color ?? null,
        months:  {},
        current: 0,
      };
    }

    if (exp.date >= currentStart) {
      catMap[id].current += amount;
    } else {
      catMap[id].months[month] = (catMap[id].months[month] ?? 0) + amount;
    }
  }

  const categories: CategoryBudget[] = [];

  for (const [catId, cat] of Object.entries(catMap)) {
    const histAmounts   = Object.values(cat.months);
    const historyMonths = histAmounts.length;
    const hasAnyHistory = historyMonths > 0;
    if (!hasAnyHistory && cat.current === 0) continue;

    const avgMonthly = hasAnyHistory
      ? histAmounts.reduce((s, v) => s + v, 0) / Math.min(historyMonths, 3)
      : cat.current;

    const currentSpend  = cat.current;
    const projected     = currentSpend / dayPct;
    const pct           = avgMonthly > 0 ? currentSpend / avgMonthly : 0;
    const expectedByNow = avgMonthly * dayPct;
    const paceRatio     = dayPct > 0 ? pct / dayPct : 0;

    const alertLevel = deriveAlertLevel(paceRatio, historyMonths, dayOfMonth, pct, dayPct);
    const status      = alertLevelToStatus(alertLevel);
    const hasHistory  = historyMonths >= MIN_HISTORY_MONTHS_FOR_PACE;

    const monthHistory = [];
    for (let i = 3; i >= 1; i--) {
      const d   = new Date(curYear, curMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthHistory.push({ month: key, label: MONTH_SHORT[d.getMonth()], amount: cat.months[key] ?? 0 });
    }

    categories.push({ categoryId: catId, name: cat.name, icon: cat.icon, color: cat.color,
      avgMonthly, currentSpend, pct, expectedByNow, paceRatio, projected, monthHistory,
      historyMonths, hasHistory, alertLevel, status });
  }

  categories.sort((a, b) => {
    const o: Record<AlertLevel, number> = { alerta: 0, atencion: 1, oportunidad: 2, normal: 3 };
    if (o[a.alertLevel] !== o[b.alertLevel]) return o[a.alertLevel] - o[b.alertLevel];
    return b.avgMonthly - a.avgMonthly;
  });

  const totalAvg          = categories.reduce((s, c) => s + c.avgMonthly,   0);
  const totalCurrentSpend = categories.reduce((s, c) => s + c.currentSpend, 0);
  const totalProjected    = categories.reduce((s, c) => s + c.projected,    0);
  const potentialSavings  = computePotentialSavings(categories);

  return {
    categories,
    totalAvg,
    totalCurrentSpend,
    totalProjected,
    potentialSavings,
    dayOfMonth,
    daysInMonth,
    monthLabel: `${MONTH_FULL[curMonth]} ${curYear}`,
  };
}
