/**
 * recurringExpenses.ts
 *
 * Detección de gastos recurrentes (alquiler, gimnasio, suscripciones, seguros...)
 * a partir del historial de transacciones individuales del usuario.
 *
 * Capa completamente independiente del motor de ritmo (`budgetPlan.ts`): no lo
 * modifica, no lo reemplaza, no importa nada de Supabase/React Native — es lógica
 * pura sobre arrays de datos, para que se pueda testear de forma aislada
 * (ver `recurringExpenses.test.ts`, corrido con `node --test`).
 *
 * La integración con `paceRatio` (ajustar el gasto de una categoría restando la
 * porción recurrente esperada) vive en `recurringAdjustment.ts`, no acá.
 *
 * Limitaciones conocidas y aceptadas (decisión deliberada, no pendientes):
 *
 * - Sin fuzzy matching: la agrupación usa `categoryId + normalizeDescription()`
 *   (minúsculas/trim/espacios colapsados) — nada de similitud aproximada. Dos
 *   descripciones genuinamente distintas para el mismo gasto ("Gimnasio SmartFit"
 *   vs "SmartFit Gimnasio") NO se agrupan. Es un falso negativo aceptado a
 *   propósito: se prefiere no detectar un recurrente real antes que fusionar por
 *   error dos comercios distintos que casualmente escriben parecido.
 *
 * - Sin distinción de cuotas: una compra en cuotas (ej. 12 cuotas de un mismo
 *   monto, mismo día) se detecta como "recurrente" mientras dura, porque no hay
 *   señal en los datos (fecha de fin, cantidad total de cuotas) para diferenciarla
 *   de un gasto verdaderamente indefinido como un alquiler. Esto no es
 *   necesariamente incorrecto — mientras la cuota está activa, SÍ es un gasto
 *   esperable y previsible mes a mes, que es justamente lo que esta capa intenta
 *   capturar. Detectar la fecha de fin de la cuota queda fuera de alcance.
 *
 * - Falso positivo aceptado (irreducible con las señales actuales): 3 gastos
 *   puntuales no relacionados, con la misma descripción y montos/fechas
 *   parecidos por coincidencia (ej. 3 reparaciones de auto cargadas siempre como
 *   "Auto"), se detectan como recurrentes. No hay forma de distinguir esto de una
 *   recurrencia real sin una señal adicional que hoy no existe en los datos
 *   (comercio/CUIT, ID de suscripción, etc.). El daño de este falso positivo es
 *   acotado: como mucho, silencia una alerta de ritmo que debería haber sonado
 *   ese mes — no genera una alerta falsa ni oculta el monto real gastado.
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Forma mínima de una transacción, desacoplada del tipo `Expense` de la app. */
export interface RawExpenseRecord {
  description: string;
  amount:      number;
  /** 'YYYY-MM-DD' */
  date:        string;
  categoryId:  string | null;
}

export type RecurringConfidence = 'alta' | 'media';

export interface RecurringPattern {
  /** Clave interna de agrupación: categoría + descripción normalizada. */
  key:          string;
  /** Descripción tal como la escribió el usuario (la más reciente de las ocurrencias). */
  description:  string;
  categoryId:   string | null;
  /** Cantidad de meses distintos en que apareció (siempre ≥ MIN_OCCURRENCES_FOR_RECURRING). */
  occurrences:  number;
  monthsPresent: string[];
  medianAmount: number;
  minAmount:    number;
  maxAmount:    number;
  medianDay:    number;
  dayRange:     [number, number];
  confidence:   RecurringConfidence;
}

export type RecurringStatus = 'esperado' | 'desviado' | 'pendiente';

export interface RecurringEvaluation {
  pattern:        RecurringPattern;
  status:         RecurringStatus;
  /** Monto de este mes que matchea el patrón — null si `status === 'pendiente'`. */
  currentAmount:  number | null;
  currentDay:     number | null;
  /** currentAmount / medianAmount — null si `pendiente`. */
  deviationRatio: number | null;
}

// ─── Constantes de detección ─────────────────────────────────────────────────
// Deliberadamente separadas de los umbrales de paceRatio (0.7/1.15/1.6) —
// no se tocan acá, esto es un sistema de clasificación distinto.

/** Ocurrencias mínimas en meses distintos para considerar algo "recurrente". */
export const MIN_OCCURRENCES_FOR_RECURRING = 3;

/** Ventana hacia atrás (en meses, sin contar el mes de referencia) donde se busca el patrón. */
export const LOOKBACK_MONTHS = 5;

/** (max-min)/mediana del monto — por debajo de esto, confianza "alta". */
const AMOUNT_SPREAD_HIGH_CONF = 0.15;
/** Tolerancia máxima de variación de monto para seguir considerándolo el mismo patrón. */
const AMOUNT_SPREAD_MAX = 0.25;

/** Diferencia máxima (en días) entre el día más temprano y más tardío — confianza "alta". */
const DAY_RANGE_HIGH_CONF = 2;
/** Tolerancia máxima de dispersión de fecha para seguir considerándolo el mismo patrón. */
const DAY_RANGE_MAX = 4;

/** current / mediana histórica ≥ esto ⇒ el pago recurrente llegó "desviado" este mes. */
export const DEVIATION_THRESHOLD_RATIO = 1.3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDescription(desc: string): string {
  return desc.toLowerCase().trim().replace(/\s+/g, ' ');
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthKeyToIndex(mk: string): number {
  const [y, m] = mk.split('-').map(Number);
  return y * 12 + (m - 1);
}

/** true si `mk` cae estrictamente antes de `referenceMonthKey`, dentro de la ventana de lookback. */
function isWithinLookback(mk: string, referenceMonthKey: string, lookbackMonths: number): boolean {
  const diff = monthKeyToIndex(referenceMonthKey) - monthKeyToIndex(mk);
  return diff >= 1 && diff <= lookbackMonths;
}

function groupKey(categoryId: string | null, description: string): string {
  return `${categoryId ?? 'none'}::${normalizeDescription(description)}`;
}

// ─── Detección ────────────────────────────────────────────────────────────────

/**
 * Busca patrones recurrentes en el historial (meses ANTERIORES a `referenceMonthKey`).
 *
 * Agrupa por categoría + descripción normalizada — deliberadamente estricto:
 * misma categoría con comercios distintos NO se agrupan entre sí (evita que
 * "restaurante A" y "restaurante B" en la misma categoría se confundan con un
 * único gasto recurrente).
 *
 * Un grupo se considera recurrente solo si, ADEMÁS de aparecer en ≥3 meses
 * distintos, los montos y las fechas son razonablemente consistentes. No exige
 * montos idénticos (`AMOUNT_SPREAD_MAX`) ni el mismo día exacto (`DAY_RANGE_MAX`).
 */
export function detectRecurringPatterns(
  history: RawExpenseRecord[],
  referenceMonthKey: string,
  lookbackMonths: number = LOOKBACK_MONTHS,
): RecurringPattern[] {
  const groups: Record<string, RawExpenseRecord[]> = {};

  for (const exp of history) {
    const mk = monthKey(exp.date);
    if (!isWithinLookback(mk, referenceMonthKey, lookbackMonths)) continue;
    const key = groupKey(exp.categoryId, exp.description);
    (groups[key] ??= []).push(exp);
  }

  const patterns: RecurringPattern[] = [];

  for (const [key, records] of Object.entries(groups)) {
    const monthsPresent = Array.from(new Set(records.map(r => monthKey(r.date)))).sort();
    if (monthsPresent.length < MIN_OCCURRENCES_FOR_RECURRING) continue;

    // Si hubo más de una transacción con la misma clave en un mismo mes, se
    // suman (asumimos que es el mismo pago, ej. facturado en dos líneas).
    const amountsByMonth = monthsPresent.map(mk =>
      records.filter(r => monthKey(r.date) === mk).reduce((s, r) => s + r.amount, 0),
    );
    const daysByMonth = monthsPresent.map(mk =>
      dayOfMonth(records.find(r => monthKey(r.date) === mk)!.date),
    );

    const medAmount = median(amountsByMonth);
    const minAmount = Math.min(...amountsByMonth);
    const maxAmount = Math.max(...amountsByMonth);
    const amountSpread = medAmount > 0 ? (maxAmount - minAmount) / medAmount : 0;
    if (amountSpread > AMOUNT_SPREAD_MAX) continue; // montos demasiado distintos — no es un patrón confiable

    const minDay = Math.min(...daysByMonth);
    const maxDay = Math.max(...daysByMonth);
    const dayRange = maxDay - minDay;
    if (dayRange > DAY_RANGE_MAX) continue; // fechas demasiado dispersas — no parece un pago programado

    const confidence: RecurringConfidence =
      amountSpread <= AMOUNT_SPREAD_HIGH_CONF && dayRange <= DAY_RANGE_HIGH_CONF ? 'alta' : 'media';

    patterns.push({
      key,
      description:  records[records.length - 1].description,
      categoryId:   records[0].categoryId,
      occurrences:  monthsPresent.length,
      monthsPresent,
      medianAmount: medAmount,
      minAmount,
      maxAmount,
      medianDay:    median(daysByMonth),
      dayRange:     [minDay, maxDay],
      confidence,
    });
  }

  return patterns;
}

/**
 * Detecta patrones recurrentes en `history` y evalúa, para cada uno, si este
 * mes (`currentMonthExpenses`) el pago llegó como se esperaba, llegó desviado,
 * o todavía no ocurrió.
 */
export function evaluateRecurringExpenses(
  history: RawExpenseRecord[],
  currentMonthExpenses: RawExpenseRecord[],
  referenceMonthKey: string,
  lookbackMonths: number = LOOKBACK_MONTHS,
): RecurringEvaluation[] {
  const patterns = detectRecurringPatterns(history, referenceMonthKey, lookbackMonths);

  const currentByKey: Record<string, RawExpenseRecord[]> = {};
  for (const exp of currentMonthExpenses) {
    const key = groupKey(exp.categoryId, exp.description);
    (currentByKey[key] ??= []).push(exp);
  }

  return patterns.map((pattern): RecurringEvaluation => {
    const matches = currentByKey[pattern.key];
    if (!matches || matches.length === 0) {
      return { pattern, status: 'pendiente', currentAmount: null, currentDay: null, deviationRatio: null };
    }
    const currentAmount = matches.reduce((s, r) => s + r.amount, 0);
    const currentDay    = dayOfMonth(matches[0].date);
    const deviationRatio = pattern.medianAmount > 0 ? currentAmount / pattern.medianAmount : 1;
    const status: RecurringStatus = deviationRatio >= DEVIATION_THRESHOLD_RATIO ? 'desviado' : 'esperado';
    return { pattern, status, currentAmount, currentDay, deviationRatio };
  });
}
