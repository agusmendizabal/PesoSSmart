/**
 * investmentData.ts
 *
 * Catálogo de instrumentos de inversión con rendimientos históricos mensuales
 * aproximados para uso educativo / simulaciones hipotéticas.
 *
 * IMPORTANTE: datos estimados con fines educativos. No constituyen
 * asesoramiento financiero. Rentabilidades pasadas no garantizan
 * resultados futuros.
 *
 * Fuentes de referencia:
 *   - FCI Liquidez: TNA del BCRA / 12
 *   - FCI CER: inflación mensual INDEC − comisión ~0.3%
 *   - Cedear SPY: rendimiento S&P500 USD + variación tipo de cambio MEP
 *   - Bitcoin: precio BTC/ARS cierre mensual
 *
 * interest_keys del onboarding → instrumento:
 *   fci_money_market → fci_mm
 *   fci_cer          → fci_cer
 *   lecap            → fci_mm  (proxy conservador)
 *   dolar_mep        → cedear_spy
 *   cedears          → cedear_spy
 *   crypto           → crypto_btc
 *   real_estate      → cedear_spy (proxy USD)
 *   no_idea          → fci_mm + fci_cer (par conservador para principiantes)
 */

import type { RiskProfile } from '@/types';

export type InstrumentId     = 'fci_mm' | 'fci_cer' | 'cedear_spy' | 'crypto_btc';
export type RiskLevel        = 'low' | 'medium' | 'high';
export type InvestmentHorizon = 'short_term' | 'medium_term' | 'long_term';

export interface Instrument {
  id:          InstrumentId;
  name:        string;
  shortName:   string;
  description: string;
  riskLevel:   RiskLevel;
  riskLabel:   string;
  /** interest_key values del onboarding que priorizan este instrumento */
  matchInterestKeys: string[];
  /**
   * Rendimiento mensual aproximado en ARS (%).
   * Key: "YYYY-MM" — actualizar mensualmente.
   */
  monthlyReturns: Record<string, number>;

  // ── Propiedades de scoring ──────────────────────────────────────────
  /** Liquidez: 1=baja (días/semanas), 2=media (48hs), 3=alta (24hs/diaria) */
  liquidityLevel: 1 | 2 | 3;
  /** Cobertura inflacionaria: 1=sin cobertura, 2=parcial, 3=plena (indexado a CER/IPC) */
  inflationProtection: 1 | 2 | 3;
  /** Potencial de crecimiento: 1=preservación, 2=moderado, 3=alto */
  growthPotential: 1 | 2 | 3;
  /** Perfiles de riesgo para los que este instrumento es adecuado */
  recommendedProfiles: RiskProfile[];
  /** Horizontes temporales para los que este instrumento tiene sentido */
  recommendedHorizons: InvestmentHorizon[];
}

// ─── Catálogo de instrumentos ─────────────────────────────────────────────────

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {

  /**
   * FCI Money Market — Liquidez ARS
   * TNA BCRA / 12 · siempre positivo · T+0 o T+1
   */
  fci_mm: {
    id:          'fci_mm',
    name:        'FCI Money Market',
    shortName:   'FCI Liquidez',
    description: 'Fondo de liquidez en pesos. Riesgo muy bajo, disponible en 24hs.',
    riskLevel:   'low',
    riskLabel:   'Muy bajo riesgo',
    matchInterestKeys: ['fci_money_market', 'fci', 'lecap', 'bonos', 'plazo_fijo', 'no_idea'],
    liquidityLevel:       3,  // disponible T+0/T+1
    inflationProtection:  2,  // genera rendimiento pero no indexado a CPI
    growthPotential:      1,  // preservación de capital, no crecimiento real
    recommendedProfiles:  ['conservative', 'moderate'],
    recommendedHorizons:  ['short_term', 'medium_term'],
    monthlyReturns: {
      '2024-01': 8.3,
      '2024-02': 7.5,
      '2024-03': 6.0,
      '2024-04': 5.0,
      '2024-05': 4.2,
      '2024-06': 3.7,
      '2024-07': 3.5,
      '2024-08': 3.3,
      '2024-09': 3.2,
      '2024-10': 3.0,
      '2024-11': 2.9,
      '2024-12': 2.8,
      '2025-01': 2.7,
      '2025-02': 2.5,
      '2025-03': 2.4,
      '2025-04': 2.4,
      '2025-05': 2.3,
      '2025-06': 2.3,
      '2025-07': 2.2,
      '2025-08': 2.2,
      '2025-09': 2.2,
      '2025-10': 2.1,
      '2025-11': 2.1,
      '2025-12': 2.1,
      '2026-01': 2.0,
      '2026-02': 2.0,
      '2026-03': 2.0,
      // ACTUALIZAR: TNA vigente BCRA / 12
    },
  },

  /**
   * FCI CER — Ajustado por inflación
   * Sigue al índice CER · retorno ≈ inflación INDEC − comisión
   * Ideal para preservar poder adquisitivo en pesos
   */
  fci_cer: {
    id:          'fci_cer',
    name:        'FCI CER (Inflación)',
    shortName:   'FCI CER',
    description: 'Fondo ajustado por inflación. Protege el poder adquisitivo en pesos.',
    riskLevel:   'low',
    riskLabel:   'Muy bajo riesgo',
    matchInterestKeys: ['fci_cer', 'no_idea', 'bonos', 'lecap'],
    liquidityLevel:       2,  // T+2 · requiere algo de planificación
    inflationProtection:  3,  // directamente indexado al CER/IPC
    growthPotential:      2,  // inflación + pequeño spread
    recommendedProfiles:  ['conservative', 'moderate'],
    recommendedHorizons:  ['short_term', 'medium_term', 'long_term'],
    monthlyReturns: {
      // retorno ≈ inflación mensual INDEC − 0.3% de comisión
      '2024-01': 20.3,
      '2024-02': 12.9,
      '2024-03': 10.7,
      '2024-04':  8.5,
      '2024-05':  3.9,
      '2024-06':  4.3,
      '2024-07':  3.7,
      '2024-08':  3.9,
      '2024-09':  3.2,
      '2024-10':  2.1,
      '2024-11':  2.1,
      '2024-12':  2.4,
      '2025-01':  2.0,
      '2025-02':  2.1,
      '2025-03':  3.4,
      '2025-04':  3.4,
      '2025-05':  3.0,
      '2025-06':  3.1,
      '2025-07':  2.7,
      '2025-08':  3.2,
      '2025-09':  2.9,
      '2025-10':  2.5,
      '2025-11':  2.1,
      '2025-12':  2.4,
      '2026-01':  2.0,
      '2026-02':  2.1,
      '2026-03':  2.1,
      // ACTUALIZAR: inflación mensual INDEC − 0.3%
    },
  },

  /**
   * Cedear SPY — S&P 500 en ARS
   * Rendimiento S&P 500 USD + variación tipo de cambio MEP
   * Proxy dolarizado accesible desde Argentina
   */
  cedear_spy: {
    id:          'cedear_spy',
    name:        'Cedear S&P 500 (SPY)',
    shortName:   'Cedear SPY',
    description: 'Exposición al S&P 500 de EE.UU. en pesos. Riesgo medio, dolarizado.',
    riskLevel:   'medium',
    riskLabel:   'Riesgo medio',
    matchInterestKeys: ['cedears', 'dolar_mep', 'acciones_locales', 'etfs', 'real_estate'],
    liquidityLevel:       2,  // horario bursátil
    inflationProtection:  2,  // cobertura vía USD, pero volátil
    growthPotential:      3,  // exposición a mercado global
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    monthlyReturns: {
      '2024-01':  4.0,
      '2024-02':  6.5,
      '2024-03':  4.5,
      '2024-04': -3.0,
      '2024-05':  5.5,
      '2024-06':  4.0,
      '2024-07':  1.5,
      '2024-08': -1.5,
      '2024-09':  3.5,
      '2024-10': -2.0,
      '2024-11':  8.5,
      '2024-12':  3.0,
      '2025-01':  3.0,
      '2025-02': -5.5,
      '2025-03': -6.0,
      '2025-04': -8.5,
      '2025-05':  6.0,
      '2025-06':  3.5,
      '2025-07':  4.5,
      '2025-08': -1.5,
      '2025-09':  3.0,
      '2025-10': -2.5,
      '2025-11':  4.5,
      '2025-12': -3.0,
      '2026-01':  3.5,
      '2026-02': -4.0,
      '2026-03': -8.0,
      // ACTUALIZAR: S&P 500 mensual USD + Δ tipo de cambio MEP
    },
  },

  /**
   * Bitcoin en ARS
   * Alta volatilidad · puede tener meses extremos en ambos sentidos
   */
  crypto_btc: {
    id:          'crypto_btc',
    name:        'Bitcoin (BTC)',
    shortName:   'Bitcoin',
    description: 'Criptomoneda de mayor capitalización. Muy alta volatilidad.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo',
    matchInterestKeys: ['crypto', 'cripto'],
    liquidityLevel:       3,  // mercado 24/7
    inflationProtection:  1,  // volátil, no es un hedge confiable de inflación
    growthPotential:      3,  // máximo potencial, máxima volatilidad
    recommendedProfiles:  ['aggressive'],
    recommendedHorizons:  ['long_term'],
    monthlyReturns: {
      '2024-01':   1.0,
      '2024-02':  44.0,
      '2024-03':  17.0,
      '2024-04': -17.5,
      '2024-05':  12.0,
      '2024-06':  -6.5,
      '2024-07':   3.5,
      '2024-08':  -8.5,
      '2024-09':   7.5,
      '2024-10':  13.5,
      '2024-11':  44.0,
      '2024-12':   5.0,
      '2025-01':  -3.0,
      '2025-02': -18.0,
      '2025-03':  -5.0,
      '2025-04': -14.0,
      '2025-05':  20.0,
      '2025-06':   8.0,
      '2025-07':   5.0,
      '2025-08':  -5.0,
      '2025-09':   6.0,
      '2025-10':  10.0,
      '2025-11':  12.0,
      '2025-12':   4.0,
      '2026-01':   8.0,
      '2026-02': -12.0,
      '2026-03':  -8.0,
      // ACTUALIZAR: precio BTC cierre mensual en ARS
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula el rendimiento acumulado de un instrumento entre dos meses.
 * Devuelve null si no hay datos en el rango.
 */
export function getCumulativeReturn(
  instrument: Instrument,
  fromMonthKey: string,
  toMonthKey: string,
): { returnPct: number; monthsCovered: number } | null {
  const allKeys = Object.keys(instrument.monthlyReturns).sort();
  const inRange = allKeys.filter(k => k >= fromMonthKey && k <= toMonthKey);
  if (inRange.length === 0) return null;

  let compound = 1;
  for (const key of inRange) {
    compound *= 1 + instrument.monthlyReturns[key] / 100;
  }
  return {
    returnPct:     Math.round((compound - 1) * 1000) / 10,
    monthsCovered: inRange.length,
  };
}

/**
 * Devuelve los instrumentos recomendados según los interest_keys del usuario.
 * Siempre incluye FCI MM como base conservadora.
 * Usado para las oportunidades de categoría (WhatIf por gasto).
 */
export function getRecommendedInstruments(interestKeys: string[]): Instrument[] {
  const base = INSTRUMENTS.fci_mm;

  if (
    interestKeys.includes('no_idea') ||
    interestKeys.includes('fci_cer') ||
    interestKeys.length === 0
  ) {
    return [base, INSTRUMENTS.fci_cer];
  }

  const matched = Object.values(INSTRUMENTS).find(
    inst =>
      inst.id !== 'fci_mm' &&
      inst.matchInterestKeys.some(k => interestKeys.includes(k))
  );

  return matched ? [base, matched] : [base, INSTRUMENTS.cedear_spy];
}

/** Etiqueta de período en lenguaje natural. */
export function periodLabel(months: number): string {
  if (months === 1) return 'el último mes';
  return `los últimos ${months} meses`;
}

// ─── Abstracción para futura API ──────────────────────────────────────────────

export interface InvestmentDataProvider {
  getMonthlyReturn(instrumentId: InstrumentId, monthKey: string): Promise<number | null>;
  getCumulativeReturn(instrumentId: InstrumentId, from: string, to: string): Promise<{ returnPct: number; monthsCovered: number } | null>;
}
