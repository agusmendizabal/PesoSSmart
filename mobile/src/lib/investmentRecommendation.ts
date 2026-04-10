/**
 * investmentRecommendation.ts
 *
 * Motor de sugerencias educativas de instrumentos de inversión.
 *
 * ⚠️  AVISO LEGAL: Las sugerencias generadas por este módulo son
 * ORIENTATIVAS Y EDUCATIVAS. No constituyen asesoramiento financiero,
 * ni recomendación de inversión en los términos de la Ley 26.831 (CNV).
 * El usuario debe consultar a un asesor financiero registrado ante la CNV
 * antes de tomar cualquier decisión de inversión.
 * Rendimientos pasados no garantizan resultados futuros.
 *
 * Señales que combina:
 *   1. Perfil de riesgo del onboarding (conservative / moderate / aggressive)
 *   2. Horizonte temporal (derivado de risk_answers.q2)
 *   3. Intereses declarados (interest_keys)
 *   4. Monto disponible (para calibrar qué tan precisa es la sugerencia)
 *   5. Objetivo de la sugerencia (protect / grow / reflect)
 */

import {
  INSTRUMENTS,
  type Instrument,
  type InvestmentHorizon,
} from './investmentData';
import type { RiskProfile } from '@/types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type { InvestmentHorizon };

/**
 * Intención detrás de la sugerencia.
 *
 * protect_savings  → plata que el usuario tiene hoy; foco en no perder valor
 * grow_savings     → plata parada con horizonte más largo; algo de upside
 * opportunity_cost → reflexión sobre gastos pasados; no implica acción inmediata
 */
export type RecommendationGoal = 'protect_savings' | 'grow_savings' | 'opportunity_cost';

/**
 * Nivel de confianza de la sugerencia.
 * Depende de cuánta información del perfil está disponible.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface RecommendationConfidence {
  level:  ConfidenceLevel;
  /** Explicación corta de por qué ese nivel de confianza. */
  note:   string;
}

export interface UserInvestmentProfile {
  riskProfile:        RiskProfile;
  horizon:            InvestmentHorizon;
  interestKeys:       string[];
  officialInflation:  number;    // % mensual actual
  /** Monto disponible — afecta la confianza y el filtro de instrumentos */
  savingsAmount?:     number;
  /** Si el perfil viene del onboarding real o es un fallback */
  isDefaultProfile?:  boolean;
}

export interface InstrumentSuggestion {
  instrument: Instrument;
  /** Etiqueta corta para la UI: "Más estable", "Mayor potencial", etc. */
  uiLabel:    string;
  /** Color de la etiqueta en UI */
  uiColor:    string;
  /** Puntaje interno (no mostrar al usuario) */
  score:      number;
}

export interface PersonalizedRecommendation {
  primary:      InstrumentSuggestion;
  secondary:    InstrumentSuggestion | null;
  explanation:  string;
  rationale:    string;
  confidence:   RecommendationConfidence;
  goal:         RecommendationGoal;
  /** Siempre presente — aclaración legal en lenguaje natural. */
  legalNote:    string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const LEGAL_NOTE =
  'Esta es una simulación educativa, no una recomendación de inversión. ' +
  'Consultá a un asesor financiero registrado ante la CNV para tomar decisiones.';

const PROFILE_LABEL: Record<RiskProfile, string>       = { conservative: 'conservador', moderate: 'moderado', aggressive: 'agresivo' };
const HORIZON_LABEL: Record<InvestmentHorizon, string> = { short_term: 'corto plazo', medium_term: 'mediano plazo', long_term: 'largo plazo' };

// ─── Horizonte desde respuestas del onboarding ───────────────────────────────

/**
 * q2: "¿En cuánto tiempo necesitás ese dinero?"
 *   a → cualquier momento  → short_term
 *   b → 1 a 3 años         → medium_term
 *   c → más de 3 años      → long_term
 */
export function deriveHorizon(
  riskAnswers: Record<string, string> | null | undefined,
): InvestmentHorizon {
  const q2 = riskAnswers?.['q2'];
  if (q2 === 'a') return 'short_term';
  if (q2 === 'c') return 'long_term';
  return 'medium_term';
}

// ─── Confianza ────────────────────────────────────────────────────────────────

export function computeRecommendationConfidence(
  profile: UserInvestmentProfile,
): RecommendationConfidence {
  const hasInterests   = profile.interestKeys.length > 0 && !profile.interestKeys.includes('no_idea');
  const hasRealProfile = !profile.isDefaultProfile;
  const hasGoodAmount  = (profile.savingsAmount ?? 0) >= 50_000;

  if (hasRealProfile && hasInterests && hasGoodAmount) {
    return { level: 'high', note: 'Sugerencia basada en tu perfil completo.' };
  }
  if (hasRealProfile && !hasInterests) {
    return { level: 'medium', note: 'Completá tus intereses en Perfil para una sugerencia más ajustada.' };
  }
  if (!hasRealProfile) {
    return { level: 'low', note: 'No encontramos tu perfil de riesgo. Esta es una sugerencia genérica.' };
  }
  if (!hasGoodAmount) {
    return { level: 'medium', note: 'Con este monto, la sugerencia es más orientativa que precisa.' };
  }
  return { level: 'medium', note: 'Sugerencia parcialmente personalizada.' };
}

// ─── Filtro duro de elegibilidad ──────────────────────────────────────────────

/**
 * Excluye instrumentos que no son apropiados para el perfil/horizonte/monto.
 * Este filtro se aplica ANTES del scoring para evitar recomendaciones incoherentes.
 *
 * Reglas:
 *  - conservative + riesgo alto → excluir siempre
 *  - conservative + riesgo medio → excluir si horizonte corto
 *  - no_idea / isDefaultProfile → solo instrumentos de riesgo bajo
 *  - monto < 30k → excluir instrumentos bursátiles (liquidez baja)
 *  - horizonte corto + liquidez < 2 → excluir
 *  - goal = opportunity_cost → no filtrar por monto (es una simulación hipotética)
 */
function isEligible(
  inst:    Instrument,
  profile: UserInvestmentProfile,
  goal:    RecommendationGoal,
): boolean {
  const { riskProfile, horizon, interestKeys, savingsAmount, isDefaultProfile } = profile;
  const amount = savingsAmount ?? 0;
  const isNoIdea = isDefaultProfile || interestKeys.includes('no_idea') || interestKeys.length === 0;

  // Usuario sin perfil o sin idea: solo bajo riesgo
  if (isNoIdea && inst.riskLevel !== 'low') return false;

  // Conservador nunca toca alto riesgo
  if (riskProfile === 'conservative' && inst.riskLevel === 'high') return false;

  // Conservador + corto plazo + riesgo medio = no tiene sentido
  if (riskProfile === 'conservative' && horizon === 'short_term' && inst.riskLevel === 'medium') return false;

  // Horizonte corto + liquidez baja = nunca
  if (horizon === 'short_term' && inst.liquidityLevel < 2) return false;

  // Monto bajo: evitar bursátiles (no es una simulación hipotética)
  if (goal !== 'opportunity_cost' && amount < 30_000 && inst.liquidityLevel === 2) return false;

  return true;
}

// ─── Etiquetas de UI por instrumento + contexto ───────────────────────────────

function buildUiLabel(
  inst:    Instrument,
  profile: UserInvestmentProfile,
  isPrimary: boolean,
): { uiLabel: string; uiColor: string } {
  const { riskProfile, horizon } = profile;

  // Labels por características del instrumento
  if (inst.id === 'fci_mm') {
    if (horizon === 'short_term') return { uiLabel: 'Más líquida', uiColor: '#82b1ff' };
    return { uiLabel: 'Más estable', uiColor: '#82b1ff' };
  }
  if (inst.id === 'fci_cer') {
    return { uiLabel: 'Cubre inflación', uiColor: '#a5d6a7' };
  }
  if (inst.id === 'cedear_spy') {
    if (isPrimary && riskProfile === 'aggressive') return { uiLabel: 'Mayor potencial', uiColor: '#ffb300' };
    return { uiLabel: 'Exposición en USD', uiColor: '#ffb300' };
  }
  if (inst.id === 'crypto_btc') {
    return { uiLabel: 'Alta volatilidad', uiColor: '#f0b429' };
  }
  return { uiLabel: inst.riskLabel, uiColor: '#888' };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreInstrument(
  inst:    Instrument,
  profile: UserInvestmentProfile,
  goal:    RecommendationGoal,
): number {
  let score = 0;

  // Coincidencia de intereses (máx 6)
  const matches = inst.matchInterestKeys.filter(k => profile.interestKeys.includes(k)).length;
  score += Math.min(matches * 3, 6);

  // Perfil de riesgo compatible
  if (inst.recommendedProfiles.includes(profile.riskProfile)) score += 4;

  // Horizonte compatible
  if (inst.recommendedHorizons.includes(profile.horizon)) score += 3;

  // Bonus inflación alta → priorizar cobertura
  if (profile.officialInflation >= 3.0) score += inst.inflationProtection;

  // Bonus liquidez para corto plazo
  if (profile.horizon === 'short_term') score += inst.liquidityLevel;

  // Bonus crecimiento para largo plazo agresivo
  if (profile.horizon === 'long_term' && profile.riskProfile === 'aggressive') {
    score += inst.growthPotential;
  }

  // Ajuste por objetivo
  if (goal === 'protect_savings') {
    // Preservar → subir liquidez y estabilidad
    score += inst.liquidityLevel;
    score += (4 - inst.growthPotential); // inverso del crecimiento
  }
  if (goal === 'grow_savings') {
    // Hacer crecer → subir potencial
    score += inst.growthPotential;
  }

  return score;
}

// ─── Compatibilidad entre instrumentos (secundario no contradice al primario) ─

/**
 * El secundario es válido solo si complementa al primario,
 * no si lo contradice o confunde al usuario.
 *
 * Pares incompatibles:
 *   - conservative/moderate + primario bajo riesgo + secundario alto riesgo
 *   - mismo riskLevel que el primario sin diferenciación útil
 */
function isCompatibleSecondary(
  primary:   Instrument,
  secondary: Instrument,
  profile:   UserInvestmentProfile,
): boolean {
  // No repetir el mismo instrumento
  if (primary.id === secondary.id) return false;

  // Para conservadores: el secundario no puede subir el riesgo del primario
  if (profile.riskProfile === 'conservative' && secondary.riskLevel !== 'low') return false;

  // Para moderados: el secundario puede ser medio, pero no alto si el primario ya es bajo
  if (
    profile.riskProfile === 'moderate' &&
    primary.riskLevel === 'low' &&
    secondary.riskLevel === 'high'
  ) return false;

  // El secundario debe tener una característica diferente para ser útil
  // (distinto riskLevel o distinto inflationProtection relevante)
  const differentRisk    = primary.riskLevel !== secondary.riskLevel;
  const differentCoverage = Math.abs(primary.inflationProtection - secondary.inflationProtection) >= 1;
  return differentRisk || differentCoverage;
}

// ─── Narrativa ────────────────────────────────────────────────────────────────

function buildNarrative(
  primary:   InstrumentSuggestion,
  secondary: InstrumentSuggestion | null,
  profile:   UserInvestmentProfile,
  goal:      RecommendationGoal,
): { explanation: string; rationale: string } {
  const { riskProfile, horizon, interestKeys, officialInflation, isDefaultProfile } = profile;
  const pLabel   = PROFILE_LABEL[riskProfile];
  const hLabel   = HORIZON_LABEL[horizon];
  const inflHigh = officialInflation >= 3.5;
  const isNoIdea = isDefaultProfile || interestKeys.includes('no_idea') || interestKeys.length === 0;
  const secName  = secondary?.instrument.shortName ?? null;
  const priName  = primary.instrument.shortName;

  // Sin perfil real
  if (isNoIdea) {
    return {
      explanation:
        `Si no sabés por dónde empezar, lo más práctico es arrancar por opciones de bajo riesgo. ` +
        `${priName} te permite poner tu plata a trabajar sin bloquearla ni asumir volatilidad.` +
        (secName ? ` ${secName} suma cobertura directa contra la inflación, también sin complicaciones.` : ''),
      rationale: 'Opciones conservadoras para empezar de a poco.',
    };
  }

  const twoInstruments = secName
    ? ` Te mostramos dos opciones para que compares: ${priName} (${primary.uiLabel.toLowerCase()}) y ${secName} (${secondary!.uiLabel.toLowerCase()}).`
    : '';

  // Objetivo: proteger ahorro
  if (goal === 'protect_savings') {
    if (riskProfile === 'conservative') {
      return {
        explanation:
          `Querés mantener disponible esta plata y no asumir volatilidad. ` +
          (inflHigh
            ? `Con inflación de ${officialInflation.toFixed(1)}% mensual, cada mes sin rendimiento tiene un costo real. `
            : '') +
          `${priName} es la opción más directa para que tu dinero no quede parado.` +
          twoInstruments,
        rationale: `Liquidez y estabilidad primero — tu perfil ${pLabel} lo pide.`,
      };
    }
    if (riskProfile === 'moderate') {
      return {
        explanation:
          `Con horizonte de ${hLabel} y tolerancia moderada al riesgo, podés ir un paso más allá de solo liquidez. ` +
          `${priName} te da la base estable que necesitás.` +
          twoInstruments,
        rationale: `Equilibrio entre disponibilidad y rendimiento real.`,
      };
    }
    // aggressive + protect → horizonte corto, priorizamos liquidez aunque perfil sea agresivo
    return {
      explanation:
        `Aunque tolerás volatilidad, para plata que podés necesitar en el corto plazo ` +
        `conviene priorizar que esté disponible. ${priName} cubre eso sin sorpresas.`,
      rationale: `Liquidez antes que rendimiento para capital disponible a corto plazo.`,
    };
  }

  // Objetivo: hacer crecer ahorro
  if (goal === 'grow_savings') {
    if (riskProfile === 'aggressive') {
      return {
        explanation:
          `Tu perfil ${pLabel} con horizonte de ${hLabel} te da margen para buscar rendimiento real. ` +
          `${priName} puede capturar ese potencial.` +
          twoInstruments,
        rationale: `Exposición a mayor volatilidad justificada por el horizonte largo.`,
      };
    }
    return {
      explanation:
        `Con perfil ${pLabel} y horizonte de ${hLabel}, el objetivo es ir más allá de solo preservar. ` +
        `${priName} ofrece ese balance entre seguridad y crecimiento potencial.` +
        twoInstruments,
      rationale: `Más allá de la liquidez: búsqueda de rendimiento real dentro del perfil.`,
    };
  }

  // Objetivo: oportunidad perdida (reflexión)
  return {
    explanation:
      `Si parte de ese dinero hubiera ido a rendimiento, estas son las opciones más relevantes ` +
      `según tu perfil ${pLabel} y horizonte de ${hLabel}.` +
      twoInstruments,
    rationale: `Simulación hipotética basada en tu perfil.`,
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Devuelve una sugerencia educativa personalizada de instrumentos.
 *
 * Flujo:
 *   1. Filtro duro de elegibilidad (excluye incoherentes)
 *   2. Scoring de elegibles
 *   3. Selección del primario (mayor score)
 *   4. Validación del secundario (debe complementar, no contradecir)
 *   5. Narrativa adaptada al objetivo + perfil
 *   6. Nivel de confianza
 */
export function getPersonalizedRecommendation(
  profile: UserInvestmentProfile,
  goal: RecommendationGoal = 'protect_savings',
): PersonalizedRecommendation {
  const allInstruments = Object.values(INSTRUMENTS);

  // 1. Filtro duro
  const eligible = allInstruments.filter(inst => isEligible(inst, profile, goal));

  // Fallback: si el filtro excluye todo, usar solo fci_mm
  const candidates = eligible.length > 0 ? eligible : [INSTRUMENTS.fci_mm];

  // 2. Scoring
  const scored = candidates
    .map(inst => ({ inst, score: scoreInstrument(inst, profile, goal) }))
    .sort((a, b) => b.score - a.score);

  // 3. Primario
  const primaryInst  = scored[0].inst;
  const primaryScore = scored[0].score;
  const primary: InstrumentSuggestion = {
    instrument: primaryInst,
    score:      primaryScore,
    ...buildUiLabel(primaryInst, profile, true),
  };

  // 4. Secundario: siguiente elegible que sea compatible
  let secondary: InstrumentSuggestion | null = null;
  for (let i = 1; i < scored.length; i++) {
    const candidate = scored[i];
    if (
      candidate.score > 0 &&
      isCompatibleSecondary(primaryInst, candidate.inst, profile)
    ) {
      secondary = {
        instrument: candidate.inst,
        score:      candidate.score,
        ...buildUiLabel(candidate.inst, profile, false),
      };
      break;
    }
  }

  // 5. Narrativa
  const { explanation, rationale } = buildNarrative(primary, secondary, profile, goal);

  // 6. Confianza
  const confidence = computeRecommendationConfidence(profile);

  return {
    primary,
    secondary,
    explanation,
    rationale,
    confidence,
    goal,
    legalNote: LEGAL_NOTE,
  };
}

// ─── Fallback seguro ──────────────────────────────────────────────────────────

export const DEFAULT_INVESTMENT_PROFILE: UserInvestmentProfile = {
  riskProfile:       'conservative',
  horizon:           'short_term',
  interestKeys:      [],
  officialInflation: 3.5,
  isDefaultProfile:  true,
};
