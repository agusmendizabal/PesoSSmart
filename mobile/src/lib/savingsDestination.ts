/**
 * savingsDestination.ts
 *
 * Fase 2 de Plan Inteligente: "¿qué podrías hacer con este ahorro?"
 *
 * Capa completamente independiente del motor de ritmo (`budgetPlan.ts`) y de la
 * detección de recurrencia (`recurringExpenses.ts`): no los modifica, no los
 * reemplaza, no importa nada de Supabase/React Native — es lógica pura sobre
 * los datos que ya calculó Plan Inteligente, para que se pueda testear de forma
 * aislada (ver `savingsDestination.test.ts`, corrido con `node --test`).
 *
 * Principio central (pedido explícito): el monto de ahorro potencial NUNCA se
 * recalcula acá — siempre llega como parámetro (`monthlyPotentialSaving`),
 * calculado una sola vez por `computePotentialSavings` en `budgetPlan.ts`. Esta
 * capa solo decide QUÉ HACER con ese número, nunca reinventa CUÁNTO es.
 *
 * La integración con Supabase (traer financial_profiles/risk_profiles/goals/
 * savings) vive en `savingsDestinationContext.ts`, no acá.
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type SavingsSource = 'live' | 'onboarding_snapshot' | 'unknown';

export interface UserGoal {
  id:            string;
  title:         string;
  targetAmount:  number;
  currentAmount: number;
  /** 'YYYY-MM-DD', o null si el usuario no le puso fecha límite. */
  deadline:      string | null;
}

/**
 * Todo lo que sabemos (o no) sobre la situación financiera del usuario, para
 * decidir qué destino recomendar. Cada campo puede ser `null`/desconocido —
 * eso es una señal válida y esperada, no un caso de error.
 */
export interface UserFinancialContext {
  /** Único número de "cuánto podría ahorrar" — viene de computePotentialSavings, nunca se recalcula acá. */
  monthlyPotentialSaving: number;
  /** Ingreso mensual estimado (de financial_profiles.income_range vía INCOME_RANGE_MAP), o null si no se conoce. */
  estimatedIncome: number | null;
  /** Promedio mensual total de gasto (plan.totalAvg) — base para "meses de colchón". */
  avgMonthlySpend: number;
  savings: {
    amount: number | null;
    source: SavingsSource;
  };
  debt: {
    /** true si existe una fila de financial_profiles para este usuario (onboarding completado). */
    known:   boolean;
    hasDebt: boolean | null;
    amount:  number | null;
  };
  goals: UserGoal[];
  riskProfile: 'conservative' | 'moderate' | 'aggressive' | null;
}

export type SavingsDestinationType = 'deuda' | 'fondo_emergencia' | 'objetivo' | 'inversion' | 'liquidez';

export interface DestinationRecommendation {
  type:       SavingsDestinationType;
  /** 1 = más prioritario. */
  priority:   number;
  rationale:  string;
  confidence: 'alta' | 'media' | 'baja';
}

export interface SavingsDestinationResult {
  hasSufficientData: boolean;
  /** Etiquetas legibles de lo que falta, para armar el mensaje "necesito conocer más sobre tu situación". Vacío si hasSufficientData. */
  missingInfo: string[];
  /** Vacío si !hasSufficientData. Ordenado por prioridad ascendente (1 primero). */
  destinations: DestinationRecommendation[];
}

// ─── Umbrales (guías educativas explícitas, no personalizadas) ────────────────

/** Por debajo de esto, se considera que no hay colchón de emergencia razonable. */
const EMERGENCY_FUND_MIN_MONTHS = 3;
/** Por encima de esto (y sin deuda ni fondo insuficiente), invertir empieza a tener sentido considerarlo. */
const COMFORTABLE_BUFFER_MONTHS = 6;
/** Metas con vencimiento dentro de esta ventana se consideran de corto plazo (compiten con el fondo de emergencia). */
const SHORT_TERM_GOAL_MONTHS = 6;
/** Meses default para proyectar un ahorro cuando la meta no tiene fecha límite (pedido explícito del punto 4). */
const DEFAULT_PROJECTION_MONTHS = 12;

// ─── Priorización de destino ────────────────────────────────────────────────

/**
 * Decide a qué destino(s) podría ir el ahorro potencial, en base a la
 * información disponible. Nunca asume datos que no existen: si falta lo
 * mínimo indispensable (ingreso y ahorro disponible), devuelve
 * `hasSufficientData: false` con la lista de qué falta, y ninguna recomendación.
 */
export function determineSavingsDestinations(ctx: UserFinancialContext): SavingsDestinationResult {
  const missingInfo: string[] = [];
  if (ctx.estimatedIncome == null) missingInfo.push('tus ingresos');
  if (ctx.savings.source === 'unknown') missingInfo.push('tu ahorro disponible');

  if (missingInfo.length > 0) {
    return { hasSufficientData: false, missingInfo, destinations: [] };
  }

  const destinations: DestinationRecommendation[] = [];
  let nextPriority = 1;

  const monthsOfBuffer = ctx.avgMonthlySpend > 0 && ctx.savings.amount != null
    ? ctx.savings.amount / ctx.avgMonthlySpend
    : null;

  // 1. Deuda conocida — suele tener un costo mayor a lo que rendiría el ahorro,
  //    pero no lo afirmamos con una tasa concreta (eso sería inventar un dato).
  if (ctx.debt.known && ctx.debt.hasDebt && (ctx.debt.amount ?? 0) > 0) {
    destinations.push({
      type: 'deuda',
      priority: nextPriority++,
      rationale: 'Contás con una deuda registrada. Achicarla suele convenir antes que ahorrar o invertir, porque su costo financiero normalmente supera lo que rendiría ese dinero guardado.',
      confidence: 'media', // dato de onboarding, no necesariamente actualizado — nunca 'alta'
    });
  }

  // 2. Sin colchón de emergencia suficiente (o no lo sabemos con precisión) → prioridad alta.
  const hasEnoughBuffer = monthsOfBuffer != null && monthsOfBuffer >= EMERGENCY_FUND_MIN_MONTHS;
  if (!hasEnoughBuffer) {
    destinations.push({
      type: 'fondo_emergencia',
      priority: nextPriority++,
      rationale: monthsOfBuffer == null
        ? 'Todavía no tenemos un registro claro de tu ahorro disponible. Como guía general, contar con unos meses de gastos cubiertos como colchón suele ser un buen primer paso antes de comprometer el dinero en otra cosa.'
        : `Tu ahorro actual cubre aproximadamente ${monthsOfBuffer.toFixed(1)} meses de tus gastos habituales. Como guía general (no una recomendación personalizada), tener un colchón de ${EMERGENCY_FUND_MIN_MONTHS} meses o más da más margen antes de invertir o comprometer el dinero en una meta.`,
      confidence: ctx.savings.source === 'live' ? 'alta' : 'media',
    });
  }

  // 3. Metas activas (no cumplidas) — compiten por el mismo dinero, con más
  //    prioridad si el fondo de emergencia ya está cubierto o la meta es de corto plazo.
  const activeGoals = ctx.goals.filter(g => g.currentAmount < g.targetAmount);
  if (activeGoals.length > 0) {
    const featured = pickFeaturedGoal(activeGoals);
    const monthsToDeadline = featured?.deadline ? monthsUntil(featured.deadline) : null;
    const isShortTerm = monthsToDeadline != null && monthsToDeadline <= SHORT_TERM_GOAL_MONTHS;
    destinations.push({
      type: 'objetivo',
      priority: nextPriority++,
      rationale: isShortTerm
        ? `Tenés una meta ("${featured!.title}") con fecha cercana — destinarle este ahorro te ayuda a llegar a tiempo.`
        : `Tenés ${activeGoals.length === 1 ? 'una meta activa' : `${activeGoals.length} metas activas`}. Este ahorro podría acercarte a cumplirla${activeGoals.length === 1 ? '' : 's'} más rápido.`,
      confidence: 'alta', // las metas son datos que el usuario cargó y mantiene activamente
    });
  }

  // 4. Invertir — solo si el colchón ya es cómodo y no hay una meta de corto
  //    plazo compitiendo por el mismo dinero. Deliberadamente sin instrumentos,
  //    tasas ni rendimientos: solo "¿tiene sentido considerarlo?".
  const comfortableBuffer = monthsOfBuffer != null && monthsOfBuffer >= COMFORTABLE_BUFFER_MONTHS;
  const hasShortTermGoal = activeGoals.some(g => g.deadline != null && monthsUntil(g.deadline) <= SHORT_TERM_GOAL_MONTHS);
  if (comfortableBuffer && !hasShortTermGoal) {
    destinations.push({
      type: 'inversion',
      priority: nextPriority++,
      rationale: 'Tu colchón de emergencia parece cómodo y no tenés una meta cercana compitiendo por este dinero — podría ser un buen momento para considerar invertir el excedente. Esto es educativo, no una recomendación de instrumento puntual.',
      confidence: ctx.savings.source === 'live' ? 'media' : 'baja',
    });
  }

  // 5. Liquidez / mantenerlo disponible — destino por defecto, siempre razonable,
  //    baja prioridad salvo que no haya surgido ningún otro destino.
  destinations.push({
    type: 'liquidez',
    priority: destinations.length === 0 ? 1 : nextPriority++,
    rationale: 'También podés simplemente dejarlo como disponible, sin comprometerlo todavía a nada puntual.',
    confidence: 'alta',
  });

  return { hasSufficientData: true, missingInfo: [], destinations };
}

/**
 * Meta con vencimiento más próximo entre las activas; si ninguna tiene fecha,
 * la primera de la lista (orden de creación). Exportada para que la UI pueda
 * mostrar la cobertura de la MISMA meta que ya menciona el rationale de
 * `determineSavingsDestinations` — nunca una selección distinta.
 */
export function pickFeaturedGoal(activeGoals: UserGoal[]): UserGoal | null {
  if (activeGoals.length === 0) return null;
  const withDeadline = activeGoals.filter(g => g.deadline != null);
  if (withDeadline.length === 0) return activeGoals[0];
  return [...withDeadline].sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
}

/**
 * Meses (redondeados hacia arriba, mínimo 1) desde hoy hasta una fecha 'YYYY-MM-DD'.
 * Exportada (Fase 6) para que `computeRequiredMonthlySaving` y el contexto del
 * asistente reutilicen exactamente esta misma cuenta — nunca una segunda versión.
 */
export function monthsUntil(deadline: string, referenceDate: Date = new Date()): number {
  const target = new Date(deadline + 'T00:00:00');
  const days = (target.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.ceil(days / 30.44));
}

// ─── Ahorro mensual → anual → cobertura de meta ────────────────────────────

export interface GoalCoverage {
  goalId:          string;
  title:           string;
  monthlySaving:   number;
  monthsProjected: number;
  projectedAmount: number;
  remainingNeeded: number;
  /** 0-100, tope en 100 aunque el ahorro proyectado supere lo que falta. */
  coveragePct:     number;
}

/**
 * Proyecta cuánto cubriría el ahorro mensual detectado de una meta puntual.
 * Si la meta no tiene fecha límite, proyecta a DEFAULT_PROJECTION_MONTHS (12,
 * pedido explícito del punto 4) — nunca inventa una fecha, solo usa un
 * horizonte por defecto explícito para poder mostrar algo concreto.
 */
export function computeGoalCoverage(
  goal: UserGoal,
  monthlySaving: number,
  referenceDate: Date = new Date(),
): GoalCoverage | null {
  const remainingNeeded = Math.max(0, goal.targetAmount - goal.currentAmount);
  if (remainingNeeded <= 0 || monthlySaving <= 0) return null;

  const monthsProjected = goal.deadline != null
    ? monthsUntil(goal.deadline, referenceDate)
    : DEFAULT_PROJECTION_MONTHS;

  const projectedAmount = monthlySaving * monthsProjected;
  const coveragePct     = Math.min(100, Math.round((projectedAmount / remainingNeeded) * 100));

  return {
    goalId: goal.id,
    title:  goal.title,
    monthlySaving,
    monthsProjected,
    projectedAmount,
    remainingNeeded,
    coveragePct,
  };
}

/**
 * Fase 6 — "¿cuánto debería ahorrar por mes para llegar a mi meta?": el
 * inverso de `computeGoalCoverage` (esa proyecta cuánto cubre un ahorro dado;
 * esta calcula cuánto ahorro haría falta). Mismo `monthsUntil`, misma noción
 * de `remainingNeeded` — ninguna fórmula nueva, solo la cuenta inversa.
 * `null` si no hay fecha límite (nunca se inventa una) o si la meta ya está
 * cumplida — son las mismas dos condiciones que `computeGoalCoverage` trata
 * como "no aplica".
 */
export function computeRequiredMonthlySaving(
  goal: UserGoal,
  referenceDate: Date = new Date(),
): number | null {
  const remainingNeeded = Math.max(0, goal.targetAmount - goal.currentAmount);
  if (remainingNeeded <= 0 || goal.deadline == null) return null;

  const months = monthsUntil(goal.deadline, referenceDate);
  return Math.round(remainingNeeded / months);
}

/** AHORRO MENSUAL → AHORRO ANUAL, simple y explícito (punto 4 del pedido). */
export function projectAnnualSaving(monthlySaving: number): number {
  return monthlySaving * 12;
}

// ─── Origen del ahorro (punto 6 del pedido) ────────────────────────────────

export interface SavingsOrigin {
  categoryName: string;
  amount:       number;
  /** true si el monto ya está liberado hoy (oportunidad); false si es una proyección condicionada a corregir el ritmo. */
  isRealized:   boolean;
  /** % derivado del mismo monto ya canónico — nunca una heurística nueva. */
  approxPct:    number | null;
}

/**
 * Explica de dónde sale el ahorro potencial: la categoría con mayor
 * contribución al monto total, usando exactamente el mismo `amount` que ya
 * calculó `buildCategoryInsight` (ninguna fórmula nueva). No inventa un
 * "podrías reducir esto" genérico — señala el comportamiento real detectado.
 */
export function describeSavingsOrigin(candidates: Array<{
  categoryName: string; amount: number | null; level: 'alerta' | 'atencion' | 'oportunidad' | 'normal';
  /** Base para expresar el monto como % — el promedio mensual habitual de la categoría (avgMonthly). */
  base: number;
}>): SavingsOrigin | null {
  const withAmount = candidates.filter(c => c.amount != null && c.amount > 0);
  if (withAmount.length === 0) return null;

  const top = withAmount.reduce((best, c) => (c.amount! > best.amount! ? c : best));
  return {
    categoryName: top.categoryName,
    amount:       top.amount!,
    isRealized:   top.level === 'oportunidad',
    approxPct:    top.base > 0 ? Math.round((top.amount! / top.base) * 100) : null,
  };
}
