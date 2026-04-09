/**
 * inflationHistory.ts
 *
 * Lógica de historial de inflación personal:
 *   - Fetch de los últimos N meses en una sola query
 *   - Cálculo de inflación personal para cada mes
 *   - Confianza por punto
 *   - Análisis de tendencia
 *   - Insights comparativos entre meses
 *
 * No depende de ningún componente — lógica pura + supabase.
 */

import { supabase } from '@/lib/supabase';
import { getIndecEntry, getLatestIndecEntry } from '@/lib/indecData';
import {
  calculatePersonalInflation,
  computeConfidence,
  getInflationLevel,
  buildMonthKey,
  type CategoryExpenseInput,
  type ConfidenceInfo,
  type InflationLevel,
  type InflationResult,
} from './inflationCalc';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type TrendDirection = 'rising' | 'falling' | 'stable' | 'unknown';

export interface MonthlyPoint {
  monthKey:          string;   // "2025-03"
  year:              number;
  month:             number;
  /** "Mar '25" */
  shortLabel:        string;
  personalInflation: number | null;
  officialInflation: number | null;
  inflationLevel:    InflationLevel | null;
  confidence:        ConfidenceInfo | null;
  topCategoryName:   string | null;
  topCategoryColor:  string | null;
  hasData:           boolean;
  /** Resultado completo para el mes actual si se necesita en UI */
  result:            InflationResult | null;
}

export interface SeriesTrend {
  direction:                TrendDirection;
  /** Diferencia entre el último mes con datos y el anterior (pp) */
  lastVsPrevDiff:           number | null;
  /** Meses consecutivos subiendo */
  risingStreak:             number;
  /** Meses consecutivos bajando */
  fallingStreak:            number;
  avgPersonalLast3:         number | null;
  avgOfficialLast3:         number | null;
  /** Categoría que más veces fue top en la serie */
  dominantCategory:         string | null;
  /** true si este mes cruzó el umbral del oficial (pasó de abajo a arriba o vice versa) */
  crossedAverageThisMonth:  boolean;
}

export interface InflationSeries {
  /** Orden cronológico ascendente */
  points:               MonthlyPoint[];
  trend:                SeriesTrend;
  comparativeInsights:  string[];
  /** Interpretación estructural del patrón general del usuario */
  structuralInsight:    string | null;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function shortLabel(year: number, month: number): string {
  return `${SHORT_MONTHS[month - 1]} '${String(year).slice(2)}`;
}

function makeEmptyPoint(year: number, month: number): MonthlyPoint {
  const indecEntry = getIndecEntry(year, month) ?? getLatestIndecEntry();
  return {
    monthKey:          buildMonthKey(year, month),
    year, month,
    shortLabel:        shortLabel(year, month),
    personalInflation: null,
    officialInflation: indecEntry.general,
    inflationLevel:    null,
    confidence:        null,
    topCategoryName:   null,
    topCategoryColor:  null,
    hasData:           false,
    result:            null,
  };
}

function emptyTrend(): SeriesTrend {
  return {
    direction: 'unknown', lastVsPrevDiff: null,
    risingStreak: 0, fallingStreak: 0,
    avgPersonalLast3: null, avgOfficialLast3: null,
    dominantCategory: null, crossedAverageThisMonth: false,
  };
}

// ─── Análisis de tendencia ────────────────────────────────────────────────────

function analyzeTrend(points: MonthlyPoint[]): SeriesTrend {
  const valid = points.filter(p => p.hasData && p.personalInflation !== null);
  if (valid.length < 2) return emptyTrend();

  const last = valid[valid.length - 1];
  const prev = valid[valid.length - 2];
  const diff = last.personalInflation! - prev.personalInflation!;

  const direction: TrendDirection =
    diff >  0.3 ? 'rising'  :
    diff < -0.3 ? 'falling' : 'stable';

  // Rachas
  let risingStreak  = 0;
  let fallingStreak = 0;
  for (let i = valid.length - 1; i >= 1; i--) {
    const d = valid[i].personalInflation! - valid[i - 1].personalInflation!;
    if      (d >  0.1 && fallingStreak === 0) risingStreak++;
    else if (d < -0.1 && risingStreak  === 0) fallingStreak++;
    else break;
  }

  // Promedio últimos 3
  const last3        = valid.slice(-3);
  const avgPersonalLast3 = last3.reduce((s, p) => s + p.personalInflation!, 0) / last3.length;
  const last3WithOff = last3.filter(p => p.officialInflation !== null);
  const avgOfficialLast3 = last3WithOff.length > 0
    ? last3WithOff.reduce((s, p) => s + p.officialInflation!, 0) / last3WithOff.length
    : null;

  // Categoría dominante
  const catCount: Record<string, number> = {};
  for (const p of valid) {
    if (p.topCategoryName) catCount[p.topCategoryName] = (catCount[p.topCategoryName] ?? 0) + 1;
  }
  const dominantCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Cruce del promedio este mes
  let crossedAverageThisMonth = false;
  if (last.officialInflation !== null && prev.officialInflation !== null) {
    const lastAbove = last.personalInflation! > last.officialInflation;
    const prevAbove = prev.personalInflation! > prev.officialInflation;
    crossedAverageThisMonth = lastAbove !== prevAbove;
  }

  return {
    direction, lastVsPrevDiff: diff,
    risingStreak, fallingStreak,
    avgPersonalLast3, avgOfficialLast3,
    dominantCategory, crossedAverageThisMonth,
  };
}

// ─── Insights comparativos ────────────────────────────────────────────────────

function generateComparativeInsights(
  points: MonthlyPoint[],
  trend:  SeriesTrend,
): string[] {
  const valid = points.filter(p => p.hasData && p.personalInflation !== null);
  if (valid.length < 2) return [];

  const last = valid[valid.length - 1];
  const insights: string[] = [];

  // Cambio mes a mes
  const diff = trend.lastVsPrevDiff;
  if (diff !== null && Math.abs(diff) >= 0.3) {
    if (diff > 0)
      insights.push(`Este mes te pegó ${diff.toFixed(1)} punto${Math.abs(diff) >= 2 ? 's' : ''} más que el anterior.`);
    else
      insights.push(`Este mes te impactó ${Math.abs(diff).toFixed(1)} punto${Math.abs(diff) >= 2 ? 's' : ''} menos que el anterior.`);
  }

  // Rachas
  if (trend.fallingStreak >= 2) {
    insights.push(`Tu inflación personal bajó por ${trend.fallingStreak} meses seguidos. Buen momento.`);
  } else if (trend.risingStreak >= 2) {
    insights.push(`Subió por ${trend.risingStreak} meses seguidos — vale revisarlo.`);
  }

  // Cruce del promedio
  if (trend.crossedAverageThisMonth) {
    const nowAbove = last.personalInflation! > (last.officialInflation ?? 0);
    insights.push(nowAbove
      ? 'Este mes cruzaste el promedio: estabas por debajo y ahora quedaste por encima.'
      : 'Este mes bajaste del promedio: venías por encima y ahora estás por debajo.',
    );
  }

  // Categoría dominante persistente
  if (trend.dominantCategory && valid.length >= 3 && last.topCategoryName === trend.dominantCategory) {
    insights.push(`${trend.dominantCategory} viene siendo el rubro que más te empuja la inflación.`);
  }

  return insights.slice(0, 3);
}

// ─── Interpretación estructural ───────────────────────────────────────────────

function generateStructuralInsight(points: MonthlyPoint[]): string | null {
  const valid = points.filter(p => p.hasData && p.personalInflation !== null && p.officialInflation !== null);
  if (valid.length < 3) return null;

  const nAbove = valid.filter(p => p.personalInflation! > p.officialInflation!).length;
  const ratio  = nAbove / valid.length;

  if (ratio >= 0.7)
    return 'Tu estructura de gastos te viene exponiendo más a la inflación que al promedio. Los rubros donde más gastás tienden a subir más fuerte.';
  if (ratio <= 0.3)
    return 'Tus hábitos de consumo te vienen protegiendo bien del promedio inflacionario. Tu composición de gastos está bastante alineada con categorías que suben menos.';

  // Alta volatilidad
  const personalValues = valid.map(p => p.personalInflation!);
  const avg    = personalValues.reduce((s, v) => s + v, 0) / personalValues.length;
  const stdDev = Math.sqrt(personalValues.reduce((s, v) => s + (v - avg) ** 2, 0) / personalValues.length);
  if (stdDev >= 1.5)
    return 'Tu inflación personal tuvo bastante variación entre meses — señal de cambios en tus hábitos o exposición a rubros con precios muy volátiles.';

  return null;
}

// ─── Fetch + ensamblado ───────────────────────────────────────────────────────

/**
 * Obtiene la serie histórica de inflación personal del usuario.
 *
 * - Hace una sola query a Supabase con todos los gastos del período.
 * - Calcula inflación personal para cada mes.
 * - Calcula tendencia e insights comparativos.
 *
 * @param userId     - ID del usuario
 * @param monthsBack - Cuántos meses hacia atrás incluir (default: 6)
 */
export async function fetchInflationSeries(
  userId:     string,
  monthsBack = 6,
): Promise<InflationSeries> {
  // Construir array de meses en orden cronológico
  const months: { year: number; month: number }[] = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const first   = months[0];
  const last    = months[months.length - 1];
  const from    = `${first.year}-${String(first.month).padStart(2, '0')}-01`;
  const lastDay = new Date(last.year, last.month, 0).getDate();
  const to      = `${last.year}-${String(last.month).padStart(2, '0')}-${lastDay}`;

  const { data, error } = await supabase
    .from('expenses')
    .select('amount, date, expense_categories ( name_es, color )')
    .eq('user_id', userId)
    .gte('date', from)
    .lte('date', to)
    .is('deleted_at', null);

  if (error || !data) {
    const emptyPoints = months.map(m => makeEmptyPoint(m.year, m.month));
    return { points: emptyPoints, trend: emptyTrend(), comparativeInsights: [], structuralInsight: null };
  }

  // Índice: monthKey → lista de rows
  const byMonth: Record<string, typeof data[number][]> = {};
  for (const m of months) byMonth[buildMonthKey(m.year, m.month)] = [];
  for (const row of data) {
    const key = (row.date as string).substring(0, 7);
    if (byMonth[key]) byMonth[key].push(row);
  }

  // Calcular cada mes
  const points: MonthlyPoint[] = months.map(({ year, month }) => {
    const key  = buildMonthKey(year, month);
    const rows = byMonth[key] ?? [];

    if (rows.length === 0) return makeEmptyPoint(year, month);

    // Agrupar por categoría
    const grouped: Record<string, CategoryExpenseInput> = {};
    let expenseCount = 0;
    for (const row of rows) {
      const cat = (row as any).expense_categories;
      const k   = cat?.name_es ?? 'Otros';
      if (!grouped[k]) grouped[k] = { categoryNameEs: k, categoryColor: cat?.color ?? '#888888', amount: 0 };
      grouped[k].amount += (row as any).amount ?? 0;
      expenseCount++;
    }

    const inputs = Object.values(grouped).filter(e => e.amount > 0);
    const result = calculatePersonalInflation(inputs, year, month);

    if (!result) return makeEmptyPoint(year, month);

    // Confianza enriquecida con conteo de gastos individuales
    const baseConf  = computeConfidence(result.totalExpenses, inputs.length);
    const confidence: ConfidenceInfo = expenseCount < 4 && baseConf.level !== 'low'
      ? { level: 'medium', note: 'Estimación parcial según los gastos registrados' }
      : baseConf;

    return {
      monthKey:          key,
      year, month,
      shortLabel:        shortLabel(year, month),
      personalInflation: result.personalInflation,
      officialInflation: result.officialInflation,
      inflationLevel:    getInflationLevel(result.personalInflation, result.officialInflation),
      confidence,
      topCategoryName:   result.topCategory?.categoryNameEs  ?? null,
      topCategoryColor:  result.topCategory?.categoryColor   ?? null,
      hasData:           true,
      result,
    };
  });

  const trend               = analyzeTrend(points);
  const comparativeInsights = generateComparativeInsights(points, trend);
  const structuralInsight   = generateStructuralInsight(points);

  return { points, trend, comparativeInsights, structuralInsight };
}
