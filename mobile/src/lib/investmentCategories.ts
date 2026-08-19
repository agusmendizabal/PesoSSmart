/**
 * investmentCategories.ts
 *
 * Fase 3 de Plan Inteligente: "si tenés capacidad para invertir, ¿qué
 * alternativas podrían tener sentido y por qué?"
 *
 * Lógica 100% pura y determinística — sin Supabase, sin React Native, sin IA.
 * Ver `savingsDestinationContext.ts`/`investmentReadinessContext.ts` para la
 * capa de datos, y `investment-alternatives.tsx` para la UI.
 *
 * Reutiliza deliberadamente (no reimplementa) la lógica ya auditada de Fase 2:
 * el gate de "¿tiene sentido invertir?" sale de `determineSavingsDestinations`
 * (savingsDestination.ts) — este módulo nunca vuelve a evaluar fondo de
 * emergencia/deuda/liquidez desde cero.
 *
 * Separación exigida por el pedido (punto 12): este archivo es el MOTOR
 * DETERMINÍSTICO — calcula categorías, horizonte, concentración y confianza.
 * No redacta explicaciones "de IA": en esta primera versión, el texto de
 * "por qué te mostramos esto" es una plantilla determinística (mismo patrón
 * que `budgetInsights.ts`/`savingsDestination.ts`), no una llamada a un LLM.
 * Ver el informe final, sección PRÓXIMO PASO, para la propuesta de conectar
 * un LLM real más adelante sin tocar este motor.
 */

import type { SavingsDestinationResult } from './savingsDestination';

// ─── Tipos ──────────────────────────────────────────────────────────────────

// Redeclarado en vez de importar de '@/types': ese alias solo resuelve dentro
// del bundler de Expo/Metro, no en la compilación standalone de `npm test`
// (mismo motivo por el que `savingsDestination.ts` tampoco lo importa).
// Estructuralmente idéntico a `RiskProfile` de '@/types' — intercambiable.
export type RiskProfile   = 'conservative' | 'moderate' | 'aggressive';
export type RiskTier      = 'bajo' | 'medio' | 'alto';
export type LiquidityTier = 'alta' | 'media' | 'baja';
export type HorizonBucket = 'corto' | 'mediano' | 'largo' | 'sin_definir';

export type InvestmentCategoryId =
  | 'liquidez' | 'renta_fija' | 'fci' | 'cer_inflacion' | 'acciones' | 'cedears' | 'bonos' | 'dolar';

export interface InvestmentCategory {
  id:                InvestmentCategoryId;
  name:              string;
  description:       string; // conceptual/educativo — no es un dato de mercado
  risk:              RiskTier;
  liquidity:         LiquidityTier;
  suitableHorizons:  HorizonBucket[]; // 'sin_definir' nunca aparece acá — se resuelve en evaluateInvestmentCategories
  suitableProfiles:  RiskProfile[];
}

// Meses hasta el vencimiento de una meta → cubo de horizonte. Mismo límite de
// "corto plazo" que ya usa savingsDestination.ts (SHORT_TERM_GOAL_MONTHS),
// para no tener dos definiciones distintas de "corto plazo" en la misma app.
export const SHORT_TERM_HORIZON_MONTHS = 6;
export const LONG_TERM_HORIZON_MONTHS  = 24;

// ─── Catálogo de categorías (punto 6 del pedido) ───────────────────────────
// Clasificación educativa y conceptual, no un dato de mercado — por eso no
// lleva fecha/fuente. Los NÚMEROS (tasas, inflación) se resuelven aparte, en
// la capa de datos, y nunca se hardcodean acá.

export const INVESTMENT_CATEGORIES: Record<InvestmentCategoryId, InvestmentCategory> = {
  liquidez: {
    id: 'liquidez', name: 'Liquidez / instrumentos de corto plazo',
    description: 'Dinero disponible en el día o en 24-48hs, con volatilidad prácticamente nula.',
    risk: 'bajo', liquidity: 'alta',
    suitableHorizons: ['corto', 'mediano', 'largo'],
    suitableProfiles: ['conservative', 'moderate', 'aggressive'],
  },
  renta_fija: {
    id: 'renta_fija', name: 'Renta fija de corto plazo',
    description: 'Instrumentos de deuda de corto plazo (ej. letras). Riesgo bajo a medio, previsibilidad alta si se sostienen hasta el vencimiento.',
    risk: 'bajo', liquidity: 'media',
    suitableHorizons: ['corto', 'mediano'],
    suitableProfiles: ['conservative', 'moderate'],
  },
  cer_inflacion: {
    id: 'cer_inflacion', name: 'Instrumentos atados a inflación',
    description: 'Ajustan su valor según un índice de inflación — el objetivo es preservar poder adquisitivo, no necesariamente superarla.',
    risk: 'bajo', liquidity: 'media',
    suitableHorizons: ['corto', 'mediano', 'largo'],
    suitableProfiles: ['conservative', 'moderate', 'aggressive'],
  },
  fci: {
    id: 'fci', name: 'Fondos comunes de inversión diversificados',
    description: 'Un tercero regulado administra una cartera diversificada. Riesgo y liquidez dependen del fondo, pero en general medio de ambos.',
    risk: 'medio', liquidity: 'media',
    suitableHorizons: ['mediano', 'largo'],
    suitableProfiles: ['moderate', 'aggressive'],
  },
  bonos: {
    id: 'bonos', name: 'Bonos de mediano/largo plazo',
    description: 'Deuda a plazos más largos que la renta fija de corto plazo — más sensibles a cambios de precio antes del vencimiento.',
    risk: 'medio', liquidity: 'baja',
    suitableHorizons: ['mediano', 'largo'],
    suitableProfiles: ['moderate', 'aggressive'],
  },
  dolar: {
    id: 'dolar', name: 'Dólar / activos dolarizados',
    description: 'Cobertura frente a la devaluación del peso. No genera rendimiento propio — el "retorno" depende de cuánto se mueva el tipo de cambio, en cualquier dirección.',
    risk: 'medio', liquidity: 'alta',
    suitableHorizons: ['corto', 'mediano', 'largo'],
    suitableProfiles: ['moderate', 'aggressive'],
  },
  cedears: {
    id: 'cedears', name: 'CEDEARs (acciones extranjeras en pesos)',
    description: 'Certificados que representan acciones que cotizan afuera, comprables en pesos. Suman exposición dolarizada y volatilidad de mercado.',
    risk: 'alto', liquidity: 'media',
    suitableHorizons: ['mediano', 'largo'],
    suitableProfiles: ['moderate', 'aggressive'],
  },
  acciones: {
    id: 'acciones', name: 'Acciones (renta variable)',
    description: 'Participación directa en una empresa. Mayor potencial de largo plazo, pero también mayor volatilidad y riesgo de concentración si es en pocas empresas.',
    risk: 'alto', liquidity: 'media',
    suitableHorizons: ['largo'],
    suitableProfiles: ['aggressive'],
  },
};

// ─── Horizonte temporal (punto 3) ──────────────────────────────────────────

/** Meses (redondeados hacia arriba, mínimo 1) desde hoy hasta una fecha 'YYYY-MM-DD'. */
function monthsUntil(deadline: string, referenceDate: Date = new Date()): number {
  const target = new Date(deadline + 'T00:00:00');
  const days = (target.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.ceil(days / 30.44));
}

/**
 * Clasifica el horizonte a partir de la fecha límite de la meta destacada.
 * `null` (sin meta, o meta sin fecha) → 'sin_definir': nunca se inventa un
 * horizonte, se lo trata como información faltante (baja la confianza y
 * restringe las categorías elegibles a las de corto plazo, la opción segura).
 */
export function classifyHorizon(deadline: string | null, referenceDate: Date = new Date()): HorizonBucket {
  if (deadline == null) return 'sin_definir';
  const months = monthsUntil(deadline, referenceDate);
  if (months <= SHORT_TERM_HORIZON_MONTHS) return 'corto';
  if (months <= LONG_TERM_HORIZON_MONTHS) return 'mediano';
  return 'largo';
}

// ─── ¿Tiene sentido invertir? (punto 1 — reutiliza Fase 2, no la reimplementa) ─

export interface InvestmentReadiness {
  eligible: boolean;
  reason:   string;
}

/**
 * Nunca vuelve a evaluar fondo de emergencia/deuda/liquidez: lee el resultado
 * YA calculado por `determineSavingsDestinations` (Fase 2) y solo interpreta
 * si 'inversion' está entre los destinos sugeridos.
 */
export function shouldConsiderInvesting(destinationResult: SavingsDestinationResult): InvestmentReadiness {
  if (!destinationResult.hasSufficientData) {
    return {
      eligible: false,
      reason: 'Todavía no tenemos suficiente información sobre tu situación financiera para evaluar si conviene invertir.',
    };
  }

  const inversion = destinationResult.destinations.find(d => d.type === 'inversion');
  if (inversion) return { eligible: true, reason: inversion.rationale };

  const blocker = destinationResult.destinations.find(d => d.type === 'deuda' || d.type === 'fondo_emergencia');
  if (blocker) {
    return {
      eligible: false,
      reason: `Todavía no es momento de priorizar inversión. ${blocker.rationale}`,
    };
  }

  return {
    eligible: false,
    reason: 'Por ahora no identificamos margen claro para invertir además de tus otras prioridades.',
  };
}

// ─── Concentración en inversiones existentes (punto 11) ────────────────────

export interface ExistingInvestment {
  instrumentType: string;
  amount:         number;
}

export interface ConcentrationResult {
  concentrated: boolean;
  dominantType: string;
  /** 0-100 */
  pct:          number;
}

const CONCENTRATION_THRESHOLD = 0.6; // 60%+ del total en un solo tipo de instrumento

/** `null` si no hay inversiones registradas — no hay nada que analizar todavía, no es un "no concentrado". */
export function detectConcentration(investments: ExistingInvestment[]): ConcentrationResult | null {
  if (investments.length === 0) return null;
  const total = investments.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) return null;

  const byType: Record<string, number> = {};
  for (const inv of investments) byType[inv.instrumentType] = (byType[inv.instrumentType] ?? 0) + inv.amount;

  const [dominantType, dominantAmount] = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  const pct = dominantAmount / total;

  return { concentrated: pct >= CONCENTRATION_THRESHOLD, dominantType, pct: Math.round(pct * 100) };
}

/** Mapea el `instrument_type` de la tabla `investments` a la categoría equivalente del catálogo, si existe. */
const INSTRUMENT_TYPE_TO_CATEGORY: Record<string, InvestmentCategoryId | undefined> = {
  fci:        'fci',
  cedear:     'cedears',
  plazo_fijo: 'renta_fija',
  bonds:      'bonos',
  acciones:   'acciones',
  // crypto y other no tienen categoría equivalente en este catálogo — se ignoran en la concentración.
};

// ─── Filtro + explicación por categoría (puntos 1, 6, 10) ──────────────────

export interface CategoryEvaluation {
  category: InvestmentCategory;
  fits:     boolean;
  /** Presente solo si fits=true. */
  whyFits:  string | null;
  /** Presente solo si fits=false — la lógica siempre puede explicar el descarte, aunque la UI no lo muestre. */
  whyNot:   string | null;
}

export function evaluateInvestmentCategories(input: {
  riskProfile:  RiskProfile | null;
  horizon:      HorizonBucket;
  concentration: ConcentrationResult | null;
}): CategoryEvaluation[] {
  const { riskProfile, horizon, concentration } = input;

  return Object.values(INVESTMENT_CATEGORIES).map((category): CategoryEvaluation => {
    // 1. Concentración: si el usuario ya está fuertemente concentrado en el
    //    tipo de instrumento equivalente a esta categoría, no se la vuelve a
    //    recomendar — sea cual sea su riesgo/horizonte.
    if (concentration?.concentrated && INSTRUMENT_TYPE_TO_CATEGORY[concentration.dominantType] === category.id) {
      return {
        category, fits: false, whyFits: null,
        whyNot: `Ya tenés aproximadamente el ${concentration.pct}% de tus inversiones registradas concentradas en este tipo de activo — sumar más profundizaría esa concentración en vez de diversificar.`,
      };
    }

    // 2. Perfil de riesgo desconocido: nunca se asume — solo se ofrecen las
    //    categorías de riesgo bajo, las únicas razonables sin saber cuánto
    //    riesgo tolera el usuario.
    if (riskProfile == null) {
      if (category.risk !== 'bajo') {
        return {
          category, fits: false, whyFits: null,
          whyNot: 'Todavía no conocemos tu perfil de riesgo, así que no mostramos alternativas de mayor riesgo hasta tenerlo.',
        };
      }
    } else if (!category.suitableProfiles.includes(riskProfile)) {
      return {
        category, fits: false, whyFits: null,
        whyNot: `Esta categoría suele ser de ${category.risk === 'alto' ? 'mayor' : 'distinto'} riesgo del que corresponde a tu perfil declarado.`,
      };
    }

    // 3. Horizonte desconocido: se restringe a categorías de corto plazo —
    //    la opción segura cuando no sabemos cuándo se podría necesitar el dinero.
    if (horizon === 'sin_definir') {
      if (!category.suitableHorizons.includes('corto')) {
        return {
          category, fits: false, whyFits: null,
          whyNot: 'No tenemos un horizonte definido (no hay una meta con fecha) — hasta saberlo, evitamos alternativas pensadas para plazos más largos.',
        };
      }
    } else if (!category.suitableHorizons.includes(horizon)) {
      return {
        category, fits: false, whyFits: null,
        whyNot: `Está pensada para un horizonte distinto al tuyo (${horizon === 'largo' ? 'la tuya es de más largo plazo' : 'la tuya es de plazo más corto'}).`,
      };
    }

    // Encaja — arma el "por qué" combinando horizonte + perfil.
    const horizonPhrase = horizon === 'sin_definir'
      ? 'mientras no tengas un horizonte definido'
      : `tu horizonte de ${horizon} plazo`;
    const profilePhrase = riskProfile == null ? 'mientras no conozcamos tu perfil de riesgo' : `tu perfil ${PROFILE_LABEL[riskProfile]}`;

    return {
      category, fits: true, whyNot: null,
      whyFits: `Podría ser compatible con ${horizonPhrase} y con ${profilePhrase}.`,
    };
  });
}

const PROFILE_LABEL: Record<RiskProfile, string> = { conservative: 'conservador', moderate: 'moderado', aggressive: 'agresivo' };

/** Máximo 2-3 alternativas (punto 13) — nunca "todas" (punto 6: "la IA debe filtrar"). */
export function pickTopCategories(evaluations: CategoryEvaluation[], max = 3): CategoryEvaluation[] {
  const RISK_RANK: Record<RiskTier, number> = { bajo: 0, medio: 1, alto: 2 };
  return evaluations
    .filter(e => e.fits)
    .sort((a, b) => RISK_RANK[a.category.risk] - RISK_RANK[b.category.risk])
    .slice(0, max);
}

// ─── Confianza de la recomendación (punto 16) ──────────────────────────────

export type RecommendationConfidence = 'alta' | 'media' | 'baja';

export interface ConfidenceResult {
  level:   RecommendationConfidence;
  missing: string[];
}

export function computeInvestmentConfidence(input: {
  riskProfileKnown: boolean;
  horizon:          HorizonBucket;
  economicDataFresh: boolean;
}): ConfidenceResult {
  const missing: string[] = [];
  if (!input.riskProfileKnown) missing.push('tu perfil de riesgo');
  if (input.horizon === 'sin_definir') missing.push('tu horizonte (una meta con fecha estimada)');

  if (missing.length > 0) return { level: 'baja', missing };
  if (!input.economicDataFresh) return { level: 'media', missing: ['datos económicos actualizados'] };
  return { level: 'alta', missing: [] };
}

// ─── Escenarios (nunca promesas) — punto 9 ─────────────────────────────────

export interface SavingsScenario {
  months:        number;
  nominalSaved:  number; // ahorro mensual × meses, sin ningún supuesto de rendimiento
  /** Solo presente si se pasó una tasa real — nunca inventada. */
  scenarioValue: number | null;
  assumptionLabel: string | null;
}

/**
 * `monthlyRatePct` debe venir de un dato real con fuente (ver
 * `investmentReadinessContext.ts`) — nunca un número inventado acá. Si no se
 * pasa, solo se devuelve el acumulado nominal (sin supuesto de rendimiento).
 */
export function projectSavingsScenario(
  monthlySaving: number,
  months: number,
  monthlyRatePct: number | null = null,
  rateLabel: string | null = null,
): SavingsScenario {
  const nominalSaved = monthlySaving * months;
  if (monthlyRatePct == null) {
    return { months, nominalSaved, scenarioValue: null, assumptionLabel: null };
  }

  let value = 0;
  for (let i = 0; i < months; i++) {
    value = (value + monthlySaving) * (1 + monthlyRatePct / 100);
  }

  return {
    months,
    nominalSaved,
    scenarioValue: Math.round(value),
    assumptionLabel: `Escenario hipotético si ${rateLabel ?? 'la tasa'} se mantuviera constante — no es una promesa de resultado.`,
  };
}
