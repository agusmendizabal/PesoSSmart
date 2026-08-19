/**
 * investmentAdvisorContext.ts
 *
 * Fase 4: serializa los resultados YA CALCULADOS por el motor (Fase 2 y 3) en
 * el contexto mínimo que se le envía al LLM. Este archivo NO decide nada — no
 * recalcula riesgo, horizonte, confianza ni categorías. Solo empaqueta.
 *
 * Principio central de la fase: "EL MOTOR DECIDE, LA IA EXPLICA". Este
 * serializador es la frontera que lo garantiza estructuralmente — el payload
 * que arma no tiene forma de contener un dato que el motor no haya producido:
 * no existe, por ejemplo, un campo "rendimiento esperado" en `AdvisorAlternativa`,
 * así que la IA no puede recibirlo ni por error. Tampoco existe ningún campo
 * de instrumento específico (ticker) — solo categorías conceptuales, el mismo
 * catálogo cerrado de `investmentCategories.ts`.
 *
 * Lógica 100% pura — sin Supabase, sin llamadas de red, sin IA. Ver
 * `supabase/functions/investment-advisor/index.ts` para dónde se arma el
 * prompt real y se llama al LLM.
 */

import type { CategoryEvaluation, HorizonBucket, ConcentrationResult, ConfidenceResult, SavingsScenario, RiskTier, LiquidityTier } from './investmentCategories';

// Redeclarado en vez de importar de investmentReadinessContext.ts: ese archivo
// importa '@/lib/supabase', que solo resuelve dentro del bundler de Expo/Metro,
// no en la compilación standalone de `npm test` (mismo motivo que RiskProfile
// en investmentCategories.ts). Estructuralmente idéntico — intercambiable.
export interface EconomicDataPoint {
  label:     string;
  value:     number;
  unit:      string;
  period:    string;
  source:    string;
  updatedAt: string | null;
  stale:     boolean;
}

// ─── Tipos del contexto mínimo ──────────────────────────────────────────────

export interface AdvisorSituacion {
  /** Fase 6 — ingreso mensual estimado, si se conoce. null = desconocido, nunca inventado. */
  ingresoDisponible:      number | null;
  ahorroDisponible:       number | null;
  ahorroDisponibleFuente: 'live' | 'onboarding_snapshot' | 'unknown';
  ahorroMensual:          number;
  gastoPromedioMensual:   number;
  tieneDeudaConocida:     boolean | null; // null = no lo sabemos, nunca se asume false
  perfilRiesgo:           'conservative' | 'moderate' | 'aggressive' | null;
  horizonte:              HorizonBucket;
  objetivo: {
    titulo: string;
    /** Fase 6 — montos/fecha crudos de la meta, para que la IA no tenga que inferirlos del % de cobertura. */
    montoObjetivo:    number | null;
    montoActual:      number | null;
    fechaLimite:      string | null;
    coveragePct:      number | null;
    mesesProyectados: number | null;
    /** Fase 6 — computeRequiredMonthlySaving (savingsDestination.ts). null si no hay fecha límite o ya se cumplió. */
    montoMensualNecesario: number | null;
  } | null;
}

/**
 * Fase 6 — resumen de UNA categoría de gasto, tal como ya la calculó
 * `budgetPlan.ts`/`recurringAdjustment.ts`/`budgetInsights.ts` (Fase 1). Cada
 * campo es un passthrough directo — nada se recalcula acá. `insight` es el
 * texto humano que ya arma `buildCategoryInsight`, reusado literalmente en
 * vez de que la IA tenga que interpretar los números crudos por su cuenta.
 */
export interface AdvisorCategorySummary {
  nombre:            string;
  gastoActual:       number;
  promedioHistorico: number;
  ritmoEsperado:     number;
  paceRatio:         number;
  nivel:             'normal' | 'atencion' | 'alerta' | 'oportunidad';
  ahorroPotencial:   number | null;
  insight:           string;
  esRecurrente:      boolean;
}

export interface AdvisorAlternativa {
  id:        string;
  nombre:    string;
  riesgo:    RiskTier;
  liquidez:  LiquidityTier;
  horizontesCompatibles: HorizonBucket[];
  porQueEncaja: string;
}

export interface AdvisorDescartada {
  id:      string;
  nombre:  string;
  porQueNo: string;
}

export interface AdvisorConcentracion {
  tipoDominante: string;
  porcentaje:    number;
}

export interface AdvisorDato {
  label:     string;
  value:     number;
  unit:      string;
  period:    string;
  source:    string;
  updatedAt: string | null;
  stale:     boolean;
}

export interface AdvisorEscenario {
  meses:          number;
  ahorradoNominal: number;
  valorEscenario:  number | null;
  supuesto:        string | null;
}

export interface AdvisorConfianza {
  nivel:   'alta' | 'media' | 'baja';
  faltante: string[];
}

export interface InvestmentAdvisorContext {
  situacion:                AdvisorSituacion;
  /** Fase 6 — por qué sí/no corresponde invertir, en las palabras que ya calculó shouldConsiderInvesting (Fase 3). */
  readiness:                { elegible: boolean; motivo: string };
  /** Fase 6 — gastos por categoría, en el mismo orden de prioridad que ya usa el resto de la app (plan.categories). */
  gastos:                   AdvisorCategorySummary[];
  /** Fase 6 — de dónde sale el ahorro potencial (describeSavingsOrigin, Fase 2). null si no hay una categoría que lo explique con claridad. */
  origenAhorro:             { categoria: string; monto: number; esRealizado: boolean; porcentajeAprox: number | null } | null;
  /** Fase 6 — projectAnnualSaving(ahorroMensual), Fase 2 — nunca una tasa nueva, es la misma multiplicación por 12. */
  potencialAnual:           number;
  alternativasSeleccionadas: AdvisorAlternativa[];
  alternativasDescartadas:  AdvisorDescartada[];
  concentracion:            AdvisorConcentracion | null;
  datosEconomicos:          AdvisorDato[];
  escenario:                AdvisorEscenario;
  confianza:                AdvisorConfianza;
}

// ─── Serializador ────────────────────────────────────────────────────────────

/** Tope de categorías enviadas — ya vienen en orden de prioridad (plan.categories), esto solo evita un payload enorme. */
export const MAX_CATEGORIES_IN_CONTEXT = 8;

export function buildInvestmentAdvisorContext(input: {
  ahorroDisponible:       number | null;
  ahorroDisponibleFuente: 'live' | 'onboarding_snapshot' | 'unknown';
  ahorroMensual:          number;
  gastoPromedioMensual:   number;
  tieneDeudaConocida:     boolean | null;
  perfilRiesgo:           'conservative' | 'moderate' | 'aggressive' | null;
  horizonte:              HorizonBucket;
  objetivo: {
    titulo: string;
    coveragePct: number | null;
    mesesProyectados: number | null;
    montoObjetivo?: number | null;
    montoActual?: number | null;
    fechaLimite?: string | null;
    montoMensualNecesario?: number | null;
  } | null;
  categoryEvaluations:    CategoryEvaluation[];
  concentration:          ConcentrationResult | null;
  economicData:           EconomicDataPoint[];
  scenario:               SavingsScenario;
  confidence:             ConfidenceResult;
  /** Fase 6 — todos opcionales: omitirlos preserva el comportamiento exacto de Fase 4/5. */
  ingresoDisponible?:      number | null;
  readiness?:              { elegible: boolean; motivo: string };
  categories?:             AdvisorCategorySummary[];
  origenAhorro?:           { categoria: string; monto: number; esRealizado: boolean; porcentajeAprox: number | null } | null;
}): InvestmentAdvisorContext {
  const seleccionadas: AdvisorAlternativa[] = input.categoryEvaluations
    .filter(e => e.fits)
    .map(e => ({
      id: e.category.id,
      nombre: e.category.name,
      riesgo: e.category.risk,
      liquidez: e.category.liquidity,
      horizontesCompatibles: e.category.suitableHorizons,
      porQueEncaja: e.whyFits ?? '',
    }));

  const descartadas: AdvisorDescartada[] = input.categoryEvaluations
    .filter(e => !e.fits)
    .map(e => ({ id: e.category.id, nombre: e.category.name, porQueNo: e.whyNot ?? '' }));

  return {
    situacion: {
      ingresoDisponible:      input.ingresoDisponible ?? null,
      ahorroDisponible:       input.ahorroDisponible,
      ahorroDisponibleFuente: input.ahorroDisponibleFuente,
      ahorroMensual:          input.ahorroMensual,
      gastoPromedioMensual:   input.gastoPromedioMensual,
      tieneDeudaConocida:     input.tieneDeudaConocida,
      perfilRiesgo:           input.perfilRiesgo,
      horizonte:              input.horizonte,
      objetivo: input.objetivo ? {
        titulo:                 input.objetivo.titulo,
        montoObjetivo:          input.objetivo.montoObjetivo ?? null,
        montoActual:            input.objetivo.montoActual ?? null,
        fechaLimite:            input.objetivo.fechaLimite ?? null,
        coveragePct:            input.objetivo.coveragePct,
        mesesProyectados:       input.objetivo.mesesProyectados,
        montoMensualNecesario:  input.objetivo.montoMensualNecesario ?? null,
      } : null,
    },
    readiness: input.readiness ?? { elegible: true, motivo: '' },
    gastos: (input.categories ?? []).slice(0, MAX_CATEGORIES_IN_CONTEXT),
    origenAhorro: input.origenAhorro ?? null,
    potencialAnual: input.ahorroMensual * 12, // misma cuenta que projectAnnualSaving (savingsDestination.ts) — nunca una tasa nueva
    alternativasSeleccionadas: seleccionadas,
    alternativasDescartadas:   descartadas,
    concentracion: input.concentration?.concentrated
      ? { tipoDominante: input.concentration.dominantType, porcentaje: input.concentration.pct }
      : null,
    datosEconomicos: input.economicData.map(p => ({
      label: p.label, value: p.value, unit: p.unit, period: p.period,
      source: p.source, updatedAt: p.updatedAt, stale: p.stale,
    })),
    escenario: {
      meses: input.scenario.months,
      ahorradoNominal: input.scenario.nominalSaved,
      valorEscenario:  input.scenario.scenarioValue,
      supuesto:        input.scenario.assumptionLabel,
    },
    confianza: { nivel: input.confidence.level, faltante: input.confidence.missing },
  };
}

/**
 * Huella determinística del contexto — para decidir si hay que volver a
 * generar la explicación inicial o si se puede reusar la cacheada (punto 20:
 * "puede generarse una vez y cachearse si el contexto no cambió"). Dos
 * contextos con el mismo contenido relevante producen la misma huella.
 */
export function computeContextFingerprint(ctx: InvestmentAdvisorContext): string {
  return JSON.stringify(ctx);
}

// ─── Conversación ────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Solo recorta el HISTORIAL DE CHAT (mensajes ya cortos) — nunca el contexto
 * financiero estructurado, que siempre se manda completo y compacto en cada
 * llamada (punto 16: "no enviar todo el historial financiero completo en
 * cada mensaje", no "no enviar el contexto financiero").
 */
export const MAX_CHAT_HISTORY_MESSAGES = 8;

export function trimConversationHistory(
  history: ChatMessage[],
  max: number = MAX_CHAT_HISTORY_MESSAGES,
): ChatMessage[] {
  return history.slice(-max);
}

// ─── Verificación estructural de seguridad ──────────────────────────────────

/**
 * IDs de categoría válidos — el único vocabulario de "alternativas" que el
 * contexto puede contener. Sirve para verificar (en tests) que el payload
 * nunca incluye un instrumento específico (ticker, nombre de fondo puntual):
 * solo puede referirse a estas 8 categorías conceptuales.
 */
export const VALID_CATEGORY_IDS = [
  'liquidez', 'renta_fija', 'fci', 'cer_inflacion', 'bonos', 'dolar', 'cedears', 'acciones',
] as const;
