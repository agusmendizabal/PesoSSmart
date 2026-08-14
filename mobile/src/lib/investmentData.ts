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

export type SectorInstrumentId =
  | 'sector_autos' | 'sector_autos_tsla'
  | 'sector_energia' | 'sector_energia_pamp'
  | 'sector_realestate' | 'sector_realestate_cres'
  | 'sector_tech' | 'sector_tech_nvda'
  | 'sector_moda' | 'sector_moda_lulu'
  | 'sector_gastronomia' | 'sector_gastronomia_ko'
  | 'sector_entretenimiento' | 'sector_entretenimiento_dis'
  | 'sector_viajes' | 'sector_viajes_bkng';

export type InstrumentId     = 'fci_mm' | 'fci_cer' | 'cedear_spy' | 'crypto_btc' | SectorInstrumentId;
export type RiskLevel        = 'low' | 'medium' | 'high';
export type InvestmentHorizon = 'short_term' | 'medium_term' | 'long_term';

/** Instructivo mostrado al tocar el ícono ⓘ junto al instrumento (solo rubros de consumo). */
export interface InstrumentTutorial {
  /** Qué es el activo, en lenguaje llano. */
  whatIsIt: string;
  /** Por qué se lo mostramos a este usuario en particular. */
  whyShown: string;
}

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
  /** Solo presente en instrumentos de rubro — habilita el ícono ⓘ en la UI. */
  tutorial?: InstrumentTutorial;
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
      '2026-01':  2.6,
      '2026-02':  2.6,
      '2026-03':  3.1,
      '2026-04':  2.5,
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

  /**
   * Instrumentos "rubro" — acciones/CEDEARs elegidos por ser marcas de consumo
   * reconocibles, no por jerga financiera. Se muestran cuando el usuario marcó
   * interés en el rubro correspondiente en el onboarding.
   *
   * Retornos ARS: para los CEDEARs (RACE, AAPL, NKE, MCD, NFLX, ABNB) se combina
   * el retorno real en USD (Yahoo Finance, cierre mensual) con la variación real
   * del dólar MEP del mismo mes (ArgentinaDatos API, cotización "bolsa").
   * YPF e IRSA cotizan directo en pesos en BYMA — no llevan ajuste de MEP.
   */

  sector_autos: {
    id:          'sector_autos',
    name:        'Ferrari (RACE)',
    shortName:   'Ferrari',
    description: 'Acción de Ferrari (Nueva York), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_autos'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Ferrari (RACE) es una acción que cotiza en la bolsa de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado que representa esa acción y cotiza en pesos en la bolsa local, sin sacar el dinero del país.',
      whyShown: 'La elegimos como referencia del rubro Autos porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   8.3,
      '2025-09':  11.4,
      '2025-10': -17.2,
      '2025-11':  -3.8,
      '2025-12':  -4.5,
      '2026-01': -12.1,
      '2026-02':  11.1,
      '2026-03': -10.7,
      '2026-04':   3.9,
      '2026-05':  -3.0,
      '2026-06':  15.9,
      '2026-07':   6.0,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_energia: {
    id:          'sector_energia',
    name:        'YPF (YPFD)',
    shortName:   'YPF',
    description: 'La petrolera más grande de Argentina. Cotiza directo en pesos en BYMA.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_energia'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'YPF es la petrolera más grande de Argentina — la misma marca de las estaciones de servicio. Cotiza directo en pesos en BYMA, sin necesidad de CEDEAR.',
      whyShown: 'La elegimos como referencia del rubro Energía porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':  -9.4,
      '2025-09':  -9.5,
      '2025-10':  46.1,
      '2025-11':   2.7,
      '2025-12':  -2.7,
      '2026-01':   9.3,
      '2026-02': -14.9,
      '2026-03':  32.9,
      '2026-04':   0.2,
      '2026-05':  15.8,
      '2026-06':  -9.2,
      '2026-07':  16.6,
      // ACTUALIZAR: cierre mensual YPFD en BYMA
    },
  },

  sector_realestate: {
    id:          'sector_realestate',
    name:        'IRSA',
    shortName:   'IRSA',
    description: 'Real estate argentino (shoppings, oficinas, edificios). Cotiza en pesos en BYMA.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_realestate'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'IRSA es la mayor empresa de real estate de Argentina — shoppings, oficinas y edificios. Cotiza directo en pesos en BYMA.',
      whyShown: 'La elegimos como referencia del rubro Departamentos / Real Estate porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':  -0.7,
      '2025-09':  -9.5,
      '2025-10':  31.6,
      '2025-11':   7.9,
      '2025-12':   9.9,
      '2026-01':   3.3,
      '2026-02': -13.5,
      '2026-03':   3.9,
      '2026-04': -12.0,
      '2026-05':  10.1,
      '2026-06':   5.4,
      '2026-07':  -0.8,
      // ACTUALIZAR: cierre mensual IRSA en BYMA
    },
  },

  sector_tech: {
    id:          'sector_tech',
    name:        'Apple (AAPL)',
    shortName:   'Apple',
    description: 'Acción de Apple (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_tech'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Apple (AAPL) cotiza en el Nasdaq de Nueva York. Desde Argentina se compra a través de un CEDEAR, igual que Ferrari — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como referencia del rubro Tecnología porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':  12.5,
      '2025-09':  20.2,
      '2025-10':   5.6,
      '2025-11':   2.3,
      '2025-12':  -1.3,
      '2026-01':  -6.9,
      '2026-02':  -0.8,
      '2026-03':  -3.7,
      '2026-04':   8.2,
      '2026-05':  13.9,
      '2026-06':  -1.8,
      '2026-07':   7.0,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_moda: {
    id:          'sector_moda',
    name:        'Nike (NKE)',
    shortName:   'Nike',
    description: 'Acción de Nike (Nueva York), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_moda'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Nike (NKE) cotiza en la bolsa de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como referencia del rubro Moda porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   4.2,
      '2025-09':  -1.2,
      '2025-10':  -7.9,
      '2025-11':  -0.8,
      '2025-12':  -0.2,
      '2026-01':  -5.3,
      '2026-02':  -1.9,
      '2026-03': -14.8,
      '2026-04': -15.0,
      '2026-05':   3.2,
      '2026-06':  -6.0,
      '2026-07':   1.8,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_gastronomia: {
    id:          'sector_gastronomia',
    name:        "McDonald's (MCD)",
    shortName:   "McDonald's",
    description: "Acción de McDonald's (Nueva York), accesible desde Argentina vía CEDEAR.",
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_gastronomia'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: "McDonald's (MCD) cotiza en la bolsa de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.",
      whyShown: 'La elegimos como referencia del rubro Gastronomía porque marcaste interés en ese rubro. Es un buen ejemplo para comparar contra gastos en comida: en vez de un número abstracto, te mostramos qué hubiera pasado si ese excedente fuese a una marca del mismo rubro que consumís.',
    },
    monthlyReturns: {
      '2025-08':   5.1,
      '2025-09':   6.2,
      '2025-10':  -2.3,
      '2025-11':   3.6,
      '2025-12':  -0.8,
      '2026-01':   0.5,
      '2026-02':   5.5,
      '2026-03':  -8.7,
      '2026-04':  -4.4,
      '2026-05':  -5.8,
      '2026-06':   2.5,
      '2026-07':   0.3,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_entretenimiento: {
    id:          'sector_entretenimiento',
    name:        'Netflix (NFLX)',
    shortName:   'Netflix',
    description: 'Acción de Netflix (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_entretenimiento'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Netflix (NFLX) cotiza en el Nasdaq de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como referencia del rubro Entretenimiento porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   4.8,
      '2025-09':   8.8,
      '2025-10':  -7.2,
      '2025-11':  -4.6,
      '2025-12': -11.8,
      '2026-01': -13.1,
      '2026-02':  12.3,
      '2026-03':   0.1,
      '2026-04':  -1.4,
      '2026-05':  -9.0,
      '2026-06': -12.1,
      '2026-07':   0.6,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_viajes: {
    id:          'sector_viajes',
    name:        'Airbnb (ABNB)',
    shortName:   'Airbnb',
    description: 'Acción de Airbnb (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_viajes'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Airbnb (ABNB) cotiza en el Nasdaq de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como referencia del rubro Viajes porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':  -0.8,
      '2025-09':   1.9,
      '2025-10':   3.7,
      '2025-11':  -8.3,
      '2025-12':  17.5,
      '2026-01':  -7.0,
      '2026-02':   1.8,
      '2026-03':  -6.3,
      '2026-04':  12.5,
      '2026-05':  -5.9,
      '2026-06':  13.6,
      '2026-07':   6.1,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  // ── Segundo CEDEAR/acción por rubro — más opciones dentro de cada categoría ──

  sector_autos_tsla: {
    id:          'sector_autos_tsla',
    name:        'Tesla (TSLA)',
    shortName:   'Tesla',
    description: 'Acción de Tesla (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_autos'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Tesla (TSLA) cotiza en el Nasdaq de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como segunda opción del rubro Autos porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   8.9,
      '2025-09':  46.0,
      '2025-10':   2.1,
      '2025-11':  -6.6,
      '2025-12':   5.9,
      '2026-01':  -6.6,
      '2026-02':  -8.9,
      '2026-03':  -7.4,
      '2026-04':   3.9,
      '2026-05':  13.1,
      '2026-06':   2.2,
      '2026-07': -25.9,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_energia_pamp: {
    id:          'sector_energia_pamp',
    name:        'Pampa Energía (PAMP)',
    shortName:   'Pampa Energía',
    description: 'Energética argentina (generación, gas, petróleo). Cotiza directo en pesos en BYMA.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_energia'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Pampa Energía es una de las principales energéticas de Argentina (generación eléctrica, gas y petróleo). Cotiza directo en pesos en BYMA, sin necesidad de CEDEAR.',
      whyShown: 'La elegimos como segunda opción del rubro Energía porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08': -11.4,
      '2025-09':   1.0,
      '2025-10':  40.0,
      '2025-11':   4.9,
      '2025-12':  -2.7,
      '2026-01':  -0.9,
      '2026-02': -13.8,
      '2026-03':  15.7,
      '2026-04':  -4.4,
      '2026-05':   2.2,
      '2026-06':   0.8,
      '2026-07':   8.5,
      // ACTUALIZAR: cierre mensual PAMP en BYMA
    },
  },

  sector_realestate_cres: {
    id:          'sector_realestate_cres',
    name:        'Cresud (CRES)',
    shortName:   'Cresud',
    description: 'Agro y real estate argentino, ligada a IRSA. Cotiza directo en pesos en BYMA.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_realestate'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Cresud es una empresa argentina de agro y real estate, controlante de IRSA. Cotiza directo en pesos en BYMA.',
      whyShown: 'La elegimos como segunda opción del rubro Departamentos / Real Estate porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08': -10.6,
      '2025-09':   4.3,
      '2025-10':  28.8,
      '2025-11':  -0.2,
      '2025-12':   5.7,
      '2026-01':   6.0,
      '2026-02': -19.2,
      '2026-03':  13.9,
      '2026-04':  -9.5,
      '2026-05':   4.5,
      '2026-06':  -0.8,
      '2026-07':   0.6,
      // ACTUALIZAR: cierre mensual CRES en BYMA
    },
  },

  sector_tech_nvda: {
    id:          'sector_tech_nvda',
    name:        'Nvidia (NVDA)',
    shortName:   'Nvidia',
    description: 'Acción de Nvidia (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_tech'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Nvidia (NVDA) cotiza en el Nasdaq de Nueva York — es la empresa detrás de las placas de video que usan gamers y la industria de IA. Desde Argentina se compra a través de un CEDEAR.',
      whyShown: 'La elegimos como segunda opción del rubro Tecnología porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':  -1.5,
      '2025-09':  17.4,
      '2025-10':   7.9,
      '2025-11': -13.3,
      '2025-12':   6.7,
      '2026-01':   0.0,
      '2026-02':  -9.6,
      '2026-03':  -1.3,
      '2026-04':  15.8,
      '2026-05':   4.8,
      '2026-06':   0.3,
      '2026-07':   0.5,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_moda_lulu: {
    id:          'sector_moda_lulu',
    name:        'Lululemon (LULU)',
    shortName:   'Lululemon',
    description: 'Acción de Lululemon (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_moda'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Lululemon (LULU) cotiza en el Nasdaq de Nueva York — ropa deportiva/athleisure. Desde Argentina se compra a través de un CEDEAR.',
      whyShown: 'La elegimos como segunda opción del rubro Moda porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   1.4,
      '2025-09':  -3.6,
      '2025-10':  -4.7,
      '2025-11':   7.1,
      '2025-12':  14.2,
      '2026-01': -18.1,
      '2026-02':   3.4,
      '2026-03': -17.1,
      '2026-04':  -8.9,
      '2026-05':  -5.6,
      '2026-06':  -7.8,
      '2026-07':   4.3,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_gastronomia_ko: {
    id:          'sector_gastronomia_ko',
    name:        'Coca-Cola (KO)',
    shortName:   'Coca-Cola',
    description: 'Acción de Coca-Cola (Nueva York), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_gastronomia'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Coca-Cola (KO) cotiza en la bolsa de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como segunda opción del rubro Gastronomía porque marcaste interés en ese rubro. Es otro ejemplo de marca de consumo directo, para comparar contra tus gastos en comida.',
    },
    monthlyReturns: {
      '2025-08':   2.2,
      '2025-09':   5.4,
      '2025-10':   3.3,
      '2025-11':   5.3,
      '2025-12':  -3.2,
      '2026-01':   4.4,
      '2026-02':   6.3,
      '2026-03':  -6.5,
      '2026-04':   4.8,
      '2026-05':  -0.6,
      '2026-06':   8.9,
      '2026-07':   8.0,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_entretenimiento_dis: {
    id:          'sector_entretenimiento_dis',
    name:        'Disney (DIS)',
    shortName:   'Disney',
    description: 'Acción de Disney (Nueva York), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_entretenimiento'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Disney (DIS) cotiza en la bolsa de Nueva York. Desde Argentina se compra a través de un CEDEAR — un certificado en pesos que representa la acción.',
      whyShown: 'La elegimos como segunda opción del rubro Entretenimiento porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   0.0,
      '2025-09':   6.0,
      '2025-10':  -2.2,
      '2025-11':  -8.0,
      '2025-12':  10.3,
      '2026-01':  -3.3,
      '2026-02':  -8.4,
      '2026-03':  -8.9,
      '2026-04':   9.0,
      '2026-05':  -2.8,
      '2026-06':   0.1,
      '2026-07':   0.1,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
    },
  },

  sector_viajes_bkng: {
    id:          'sector_viajes_bkng',
    name:        'Booking Holdings (BKNG)',
    shortName:   'Booking',
    description: 'Acción de Booking Holdings (Nasdaq), accesible desde Argentina vía CEDEAR.',
    riskLevel:   'high',
    riskLabel:   'Alto riesgo — acción individual',
    matchInterestKeys: ['sector_viajes'],
    liquidityLevel:       2,
    inflationProtection:  2,
    growthPotential:      3,
    recommendedProfiles:  ['moderate', 'aggressive'],
    recommendedHorizons:  ['medium_term', 'long_term'],
    tutorial: {
      whatIsIt: 'Booking Holdings (BKNG) es la empresa detrás de Booking.com. Cotiza en el Nasdaq de Nueva York; desde Argentina se compra a través de un CEDEAR.',
      whyShown: 'La elegimos como segunda opción del rubro Viajes porque marcaste interés en ese rubro. La usamos para mostrarte, a modo de ejemplo, qué hubiera pasado si una parte de tus gastos prescindibles hubiese ido a este tipo de activo en vez de a un consumo puntual.',
    },
    monthlyReturns: {
      '2025-08':   2.3,
      '2025-09':   5.7,
      '2025-10':  -6.5,
      '2025-11':  -4.0,
      '2025-12':  10.3,
      '2026-01':  -8.9,
      '2026-02': -17.4,
      '2026-03':  -0.4,
      '2026-04':   1.2,
      '2026-05':  -1.5,
      '2026-06':  12.7,
      '2026-07':   8.4,
      // ACTUALIZAR: retorno USD (Yahoo Finance) + variación MEP del mes
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

  // Prioridad 1: rubros de consumo marcados en el onboarding (autos, energía, etc.)
  // Puede haber más de un CEDEAR/acción por rubro — se muestran todos, con un tope
  // para no saturar la tarjeta si el usuario marcó muchos rubros a la vez.
  const MAX_SECTOR_MATCHES = 3;
  const sectorMatches = Object.values(INSTRUMENTS)
    .filter(inst => inst.tutorial && inst.matchInterestKeys.some(k => interestKeys.includes(k)))
    .slice(0, MAX_SECTOR_MATCHES);
  if (sectorMatches.length > 0) return [base, ...sectorMatches];

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

/**
 * Aplica al catálogo el retorno real del último mes cerrado, sincronizado por
 * la edge function `cedear-sync` (corre mensualmente vía pg_cron) hacia
 * `market_rates`. Sin esto, el retorno de rubro se queda con el último valor
 * cargado a mano en este archivo y puede quedar desactualizado.
 *
 * Sobrescribe siempre con el valor más fresco — es idempotente, así que se
 * puede llamar en cada carga de pantalla sin acumular estado viejo.
 */
export function applySectorReturns(
  rates: { instrument: string; rate_monthly: number }[],
  monthKey: string,
): void {
  for (const r of rates) {
    const inst = (INSTRUMENTS as Record<string, Instrument>)[r.instrument];
    if (inst?.tutorial) inst.monthlyReturns[monthKey] = Number(r.rate_monthly);
  }
}

// ─── Abstracción para futura API ──────────────────────────────────────────────

export interface InvestmentDataProvider {
  getMonthlyReturn(instrumentId: InstrumentId, monthKey: string): Promise<number | null>;
  getCumulativeReturn(instrumentId: InstrumentId, from: string, to: string): Promise<{ returnPct: number; monthsCovered: number } | null>;
}
