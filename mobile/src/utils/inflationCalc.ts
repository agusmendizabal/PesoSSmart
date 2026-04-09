import {
  getIndecEntry,
  getLatestIndecEntry,
  getCategoryInflation,
  type IndecMonthEntry,
} from '@/lib/indecData';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface CategoryExpenseInput {
  categoryNameEs: string;
  categoryColor:  string;
  amount:         number;
}

export interface CategoryWeight {
  categoryNameEs: string;
  categoryColor:  string;
  amount:         number;
  /** fracción del gasto total, 0-1, siempre finita */
  weight:    number;
  /** variación mensual INDEC asignada, %, nunca NaN */
  inflation: number;
  /** aporte a la inflación personal = weight × inflation */
  impact:    number;
}

export interface InflationInsights {
  headline:    string;
  narrative:   string;
  /** Nota extra sobre concentración o categoría dominante. Null si no aplica. */
  contextNote: string | null;
}

export interface Recommendation {
  text: string;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceInfo {
  level: ConfidenceLevel;
  note:  string;
}

export interface InflationResult {
  personalInflation:          number;
  officialInflation:          number;
  /** Ordenado por impacto descendente */
  categoryWeights:            CategoryWeight[];
  topCategory:                CategoryWeight | null;
  /** 0-100: qué % del total personal explica la categoría top */
  topCategoryExplainsPercent: number;
  hasEnoughData:              true;
  indecEntry:                 IndecMonthEntry;
  /** true si el mes pedido no tenía datos y se usó el más reciente */
  usedFallbackMonth:          boolean;
  insights:                   InflationInsights;
  recommendations:            Recommendation[];
  confidence:                 ConfidenceInfo;
  /** "YYYY-MM" — clave lista para historial futuro */
  monthKey:                   string;
  /** total ARS usado para el cálculo */
  totalExpenses:              number;
}

export type InflationLevel = 'low' | 'medium' | 'high';

// ─── Constantes ───────────────────────────────────────────────────────────────

const MIN_TOTAL_ARS = 1000;

/** Convierte año + mes (1-based) a clave "YYYY-MM" */
export function buildMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ─── Sanitización numérica ────────────────────────────────────────────────────

/** Devuelve `fallback` si el valor es NaN, Infinity o negativo. */
function safeRate(value: number, fallback: number): number {
  if (!isFinite(value) || isNaN(value)) return fallback;
  return Math.max(0, value);
}

// ─── Confianza ────────────────────────────────────────────────────────────────

/**
 * Calcula el nivel de confianza del resultado en función del total de gastos
 * y la diversidad de categorías registradas.
 *
 * Nota: los umbrales en ARS pueden revisarse anualmente.
 */
export function computeConfidence(
  totalExpenses: number,
  categoryCount: number,
): ConfidenceInfo {
  let score = 0;

  // Monto total (0-2 pts)
  if      (totalExpenses >= 200_000) score += 2;
  else if (totalExpenses >=  30_000) score += 1;

  // Diversidad de categorías (0-2 pts)
  if      (categoryCount >= 4) score += 2;
  else if (categoryCount >= 2) score += 1;

  if (score >= 4) return { level: 'high',   note: 'Lectura bastante representativa de tus gastos reales' };
  if (score >= 2) return { level: 'medium', note: 'Estimación parcial según los gastos registrados' };
  return           { level: 'low',    note: 'Todavía faltan datos para una lectura firme' };
}

// ─── Nivel ────────────────────────────────────────────────────────────────────

export function getInflationLevel(personal: number, official: number): InflationLevel {
  if (!isFinite(personal) || !isFinite(official) || official === 0) return 'medium';
  if (personal <= official * 0.9)  return 'low';
  if (personal <= official * 1.2)  return 'medium';
  return 'high';
}

// ─── Cálculo principal ────────────────────────────────────────────────────────

export function calculatePersonalInflation(
  expenses: CategoryExpenseInput[],
  year:     number,
  month:    number,
): InflationResult | null {
  const valid = expenses.filter(e => e.amount > 0 && isFinite(e.amount));
  const total = valid.reduce((s, e) => s + e.amount, 0);

  if (total < MIN_TOTAL_ARS || valid.length === 0) return null;

  let entry = getIndecEntry(year, month);
  const usedFallbackMonth = entry === null;
  if (!entry) entry = getLatestIndecEntry();

  const categoryWeights: CategoryWeight[] = valid.map((exp) => {
    const weight       = safeRate(exp.amount / total, 0);
    const rawInflation = getCategoryInflation(entry!.divisions, exp.categoryNameEs, entry!.general);
    const inflation    = safeRate(rawInflation, entry!.general);
    return {
      categoryNameEs: exp.categoryNameEs,
      categoryColor:  exp.categoryColor,
      amount:         exp.amount,
      weight,
      inflation,
      impact: safeRate(weight * inflation, 0),
    };
  });

  const rawPersonal       = categoryWeights.reduce((s, c) => s + c.impact, 0);
  const personalInflation = safeRate(rawPersonal, entry.general);
  const sorted            = [...categoryWeights].sort((a, b) => b.impact - a.impact);
  const topCategory       = sorted[0] ?? null;
  const topCategoryExplainsPercent =
    personalInflation > 0 && topCategory
      ? safeRate((topCategory.impact / personalInflation) * 100, 0)
      : 0;

  return {
    personalInflation,
    officialInflation:          entry.general,
    categoryWeights:            sorted,
    topCategory,
    topCategoryExplainsPercent,
    hasEnoughData:              true,
    indecEntry:                 entry,
    usedFallbackMonth,
    insights:                   generateInsights({ personalInflation, officialInflation: entry.general, categoryWeights: sorted, topCategory, topCategoryExplainsPercent }),
    recommendations:            generateRecommendations({ personalInflation, officialInflation: entry.general, topCategory, topCategoryExplainsPercent, categoryWeights: sorted }),
    confidence:                 computeConfidence(total, valid.length),
    monthKey:                   buildMonthKey(year, month),
    totalExpenses:              total,
  };
}

// ─── Insights humanos ─────────────────────────────────────────────────────────

function generateInsights({
  personalInflation, officialInflation, categoryWeights, topCategory, topCategoryExplainsPercent,
}: {
  personalInflation:          number;
  officialInflation:          number;
  categoryWeights:            CategoryWeight[];
  topCategory:                CategoryWeight | null;
  topCategoryExplainsPercent: number;
}): InflationInsights {
  const level   = getInflationLevel(personalInflation, officialInflation);
  const diffAbs = Math.abs(personalInflation - officialInflation).toFixed(1);
  const topName = topCategory?.categoryNameEs ?? '';
  const topWPct = topCategory ? Math.round(topCategory.weight * 100) : 0;
  const topIPct = Math.round(topCategoryExplainsPercent);

  const headline =
    level === 'low'    ? 'No te pegó igual que al promedio' :
    level === 'medium' ? 'Estuviste alineado con el promedio' :
                         'Lo sentiste más fuerte que el promedio';

  let narrative: string;
  if (level === 'low') {
    narrative =
      `El índice oficial fue ${officialInflation.toFixed(1)}%, pero en tu caso el impacto ` +
      `fue de solo ${personalInflation.toFixed(1)}%. Tus hábitos de consumo te protegieron del alza general este mes.`;
  } else if (level === 'medium') {
    narrative =
      `Tu inflación personal (${personalInflation.toFixed(1)}%) estuvo muy cerca de la oficial ` +
      `(${officialInflation.toFixed(1)}%). Gastaste en rubros que subieron al ritmo general del mercado.`;
  } else {
    narrative =
      `Aunque el índice oficial fue ${officialInflation.toFixed(1)}%, en tu caso se sintió ` +
      `${personalInflation.toFixed(1)}% — ${diffAbs}% más. Tus gastos estuvieron más cargados ` +
      `en rubros que aumentaron por encima del promedio.`;
  }

  let contextNote: string | null = null;
  if (topCategory && topIPct >= 55) {
    contextNote = `La mayor parte del impacto vino por ${topName} — explicó el ${topIPct}% de tu inflación personal.`;
  } else if (topCategory && topWPct >= 35 && level === 'high') {
    contextNote = `Como destinaste el ${topWPct}% de tus gastos a ${topName}, esa suba te afectó más que al promedio.`;
  } else if (categoryWeights.length >= 2) {
    const second = categoryWeights[1]?.categoryNameEs;
    contextNote = second
      ? `Lo que más te impulsó la inflación fue ${topName} y ${second}.`
      : `${topName} fue el rubro que más impulsó tu inflación este mes.`;
  }

  return { headline, narrative, contextNote };
}

// ─── Recomendaciones accionables ──────────────────────────────────────────────

const CATEGORY_TIPS: { keywords: string[]; tip: string }[] = [
  { keywords: ['transporte'],               tip: 'Comparar apps de transporte o reorganizar recorridos puede reducir el impacto el mes que viene.' },
  { keywords: ['comida', 'restaurant'],     tip: 'Las salidas a comer acumulan más de lo que parece. Unos pocos menos al mes pueden hacer diferencia.' },
  { keywords: ['supermercado'],             tip: 'Comparar precios entre cadenas o aprovechar descuentos por método de pago puede ayudar bastante.' },
  { keywords: ['salud', 'farmacia'],        tip: 'Si tenés cobertura médica, vale revisar si el plan que tenés es el más conveniente para lo que realmente usás.' },
  { keywords: ['hogar', 'servicio'],        tip: 'Los servicios del hogar están subiendo fuerte. Si podés renegociar alguno o buscar alternativas, es un buen momento.' },
  { keywords: ['tecnología', 'tecnologia'], tip: 'Revisá si tenés planes de datos o servicios tecnológicos que no estás aprovechando al máximo.' },
  { keywords: ['suscripci'],                tip: 'Las suscripciones se acumulan sin que te des cuenta. Vale listar cuáles usás realmente.' },
  { keywords: ['educación', 'educacion'],   tip: 'Los gastos de educación suelen ser estacionales. Planificarlos con tiempo puede ayudarte a distribuir el impacto.' },
];

function findTipForCategory(nameEs: string): string | null {
  const lower = nameEs.toLowerCase();
  return CATEGORY_TIPS.find(t => t.keywords.some(k => lower.includes(k)))?.tip ?? null;
}

function generateRecommendations({
  personalInflation, officialInflation, topCategory, topCategoryExplainsPercent, categoryWeights,
}: {
  personalInflation:          number;
  officialInflation:          number;
  topCategory:                CategoryWeight | null;
  topCategoryExplainsPercent: number;
  categoryWeights:            CategoryWeight[];
}): Recommendation[] {
  const level = getInflationLevel(personalInflation, officialInflation);
  const recs: Recommendation[] = [];

  if (level === 'low') {
    recs.push({ text: 'Tu estructura de gastos estuvo bien distribuida. Seguir así te va a proteger de futuras subas concentradas en un rubro.' });
    return recs;
  }

  if (topCategory) {
    const tip = findTipForCategory(topCategory.categoryNameEs);
    recs.push({ text: tip ?? `${topCategory.categoryNameEs} fue tu principal impacto. Vale la pena revisarlo para el próximo mes.` });
  }

  if (topCategoryExplainsPercent >= 55 && categoryWeights.length >= 3) {
    recs.push({ text: 'Tenés bastante dependencia de un solo rubro. Distribuir un poco más los gastos te da más estabilidad frente a subas futuras.' });
  } else if (level === 'high' && recs.length < 2) {
    recs.push({ text: 'Revisá cuáles de estos gastos podés anticipar o renegociar. A veces la planificación previa amortigua el impacto.' });
  }

  return recs.slice(0, 2);
}
