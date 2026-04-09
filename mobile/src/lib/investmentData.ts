/**
 * investmentData.ts
 *
 * Catálogo de instrumentos de inversión con rendimientos históricos mensuales
 * aproximados para uso educativo / simulaciones hipotéticas.
 *
 * IMPORTANTE: estos datos son estimaciones basadas en fuentes públicas.
 * No constituyen asesoramiento financiero. Rentabilidades pasadas no
 * garantizan resultados futuros.
 *
 * Fuentes de referencia:
 *   - FCI Liquidez: TNA del BCRA (tasa de política monetaria)
 *   - Cedear SPY: rendimiento S&P500 en USD + variación MEP/USD
 *   - Bitcoin: precio BTC/ARS (Bitso, Lemon u otras referencias)
 *
 * Para reemplazar con datos reales en el futuro, implementar
 * InvestmentDataProvider (ver al final del archivo).
 */

export type InstrumentId = 'fci_mm' | 'cedear_spy' | 'crypto_btc';
export type RiskLevel    = 'low' | 'medium' | 'high';

export interface Instrument {
  id:                 InstrumentId;
  name:               string;
  shortName:          string;
  description:        string;
  riskLevel:          RiskLevel;
  riskLabel:          string;
  /** interest_key values del usuario que priorizan este instrumento */
  matchInterestKeys:  string[];
  /**
   * Rendimiento mensual aproximado en ARS (%).
   * Key: "YYYY-MM"
   * Actualizar mensualmente con datos de mercado.
   */
  monthlyReturns:     Record<string, number>;
}

// ─── Catálogo de instrumentos ─────────────────────────────────────────────────

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {

  /**
   * FCI Money Market (Liquidez ARS)
   * Rendimiento aproximado basado en TNA del BCRA.
   * Siempre positivo, acumula diario.
   * Actualizar: tomar TNA vigente / 12.
   */
  fci_mm: {
    id:               'fci_mm',
    name:             'FCI Money Market',
    shortName:        'FCI Liquidez',
    description:      'Fondo de liquidez en pesos. Riesgo muy bajo, disponible en 24hs.',
    riskLevel:        'low',
    riskLabel:        'Muy bajo riesgo',
    matchInterestKeys: ['fci', 'lecap', 'bonos', 'plazo_fijo'],
    monthlyReturns: {
      // 2024 — tasas BCRA arrancaron ~100% TNA y bajaron a ~29%
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
      // 2025
      '2025-01': 2.7,
      '2025-02': 2.5,
      '2025-03': 2.4,
      // ACTUALIZAR: agregar mes nuevo cuando salga TNA del BCRA
    },
  },

  /**
   * Cedear SPY (S&P 500 en ARS)
   * Combina rendimiento del S&P 500 en USD + variación del tipo de cambio MEP.
   * Riesgo medio-alto, exposición al mercado global.
   */
  cedear_spy: {
    id:               'cedear_spy',
    name:             'Cedear S&P 500 (SPY)',
    shortName:        'Cedear SPY',
    description:      'Exposición al S&P 500 de EE.UU. en pesos. Riesgo medio-alto, dolarizado.',
    riskLevel:        'medium',
    riskLabel:        'Riesgo medio',
    matchInterestKeys: ['cedears', 'dolar_mep', 'acciones_locales', 'etfs'],
    monthlyReturns: {
      // 2024 — S&P USD + movimiento MEP/USD
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
      // 2025 — corrección por aranceles
      '2025-01':  3.0,
      '2025-02': -5.5,
      '2025-03': -6.0,
      // ACTUALIZAR: rendimiento mensual S&P 500 USD + Δ MEP
    },
  },

  /**
   * Bitcoin en ARS
   * Alta volatilidad. Puede tener meses muy positivos o muy negativos.
   */
  crypto_btc: {
    id:               'crypto_btc',
    name:             'Bitcoin (BTC)',
    shortName:        'Bitcoin',
    description:      'Criptomoneda de mayor capitalización. Muy alta volatilidad.',
    riskLevel:        'high',
    riskLabel:        'Alto riesgo',
    matchInterestKeys: ['crypto', 'cripto'],
    monthlyReturns: {
      // 2024
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
      // 2025
      '2025-01':  -3.0,
      '2025-02': -18.0,
      '2025-03':  -5.0,
      // ACTUALIZAR: precio BTC cierre mensual en ARS
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcula el rendimiento acumulado (%) de un instrumento entre dos meses.
 * Usa los meses disponibles en el rango (salta meses sin datos).
 * Devuelve null si no hay datos en el rango.
 */
export function getCumulativeReturn(
  instrument: Instrument,
  fromMonthKey: string,
  toMonthKey: string,
): { returnPct: number; monthsCovered: number } | null {
  const allKeys  = Object.keys(instrument.monthlyReturns).sort();
  const inRange  = allKeys.filter(k => k >= fromMonthKey && k <= toMonthKey);

  if (inRange.length === 0) return null;

  let compound = 1;
  for (const key of inRange) {
    compound *= 1 + instrument.monthlyReturns[key] / 100;
  }

  return {
    returnPct:      Math.round((compound - 1) * 1000) / 10, // redondeado a 1 decimal
    monthsCovered:  inRange.length,
  };
}

/**
 * Dado un array de interest_keys del usuario, devuelve los instrumentos
 * recomendados priorizando los que matchean los intereses.
 *
 * Siempre incluye FCI (base conservadora).
 * Si ningún interés matchea, devuelve FCI + Cedear SPY.
 */
export function getRecommendedInstruments(
  interestKeys: string[],
): Instrument[] {
  const base = INSTRUMENTS.fci_mm;

  // Buscar instrumento que matchea algún interés del usuario
  const matched = Object.values(INSTRUMENTS).find(
    inst => inst.id !== 'fci_mm' &&
      inst.matchInterestKeys.some(k => interestKeys.includes(k))
  );

  return matched
    ? [base, matched]
    : [base, INSTRUMENTS.cedear_spy]; // fallback: FCI + SPY
}

/**
 * Etiqueta de período en lenguaje humano.
 * Ej: 3 → "los últimos 3 meses"
 */
export function periodLabel(months: number): string {
  if (months === 1) return 'el último mes';
  return `los últimos ${months} meses`;
}

// ─── Abstracción para futura API ──────────────────────────────────────────────
//
// Para reemplazar datos hardcodeados con una API real de precios,
// implementar esta interfaz y swapear la instancia activa:

export interface InvestmentDataProvider {
  getMonthlyReturn(instrumentId: InstrumentId, monthKey: string): Promise<number | null>;
  getCumulativeReturn(instrumentId: InstrumentId, from: string, to: string): Promise<{ returnPct: number; monthsCovered: number } | null>;
}

// Ejemplo futuro:
//   export const investmentProvider: InvestmentDataProvider = new IOLApiProvider(apiKey);
