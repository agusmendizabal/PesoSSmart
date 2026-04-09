/**
 * opportunityCost.ts
 *
 * Lógica para calcular "qué habría pasado si una parte de lo
 * que gastaste lo hubieras invertido".
 *
 * No es asesoramiento financiero — es educativo y motivacional.
 */

import {
  INSTRUMENTS,
  getCumulativeReturn,
  getRecommendedInstruments,
  periodLabel,
  type Instrument,
} from '@/lib/investmentData';
import { buildMonthKey } from './inflationCalc';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface WhatIfResult {
  instrument:     Instrument;
  initialAmount:  number;
  finalAmount:    number;
  returnPct:      number;
  gainArs:        number;
  /** true si el rendimiento fue negativo */
  isLoss:         boolean;
  monthsCovered:  number;
  periodLabel:    string;
  /** true si el instrumento matchea algún interés del usuario */
  matchesInterest: boolean;
  /** Frase interpretativa breve */
  interpretation: string;
}

export interface CategoryOpportunity {
  categoryNameEs:         string;
  categoryColor:          string;
  totalSpent:             number;
  /** fracción sugerida para invertir (0-1) */
  investableFraction:     number;
  /** monto concreto sugerido a invertir */
  investableAmount:       number;
  whatIf:                 WhatIfResult[];
  /** Frase introductoria para la categoría */
  framing:                string;
}

export interface SavingsOpportunity {
  savingsAmount:    number;
  whatIf:           WhatIfResult;
  /** Pérdida mensual estimada por inflación */
  inflationLossArs: number;
  officialMonthlyInflation: number;
}

export interface OpportunityInsights {
  categoryOpportunities:  CategoryOpportunity[];
  savingsOpportunity:     SavingsOpportunity | null;
  /** Meses del rango analizado */
  fromMonthKey:           string;
  toMonthKey:             string;
  monthsAnalyzed:         number;
}

// ─── Mapa de categorías "invertibles" ─────────────────────────────────────────
//
// Fracción del gasto que podría haber sido ahorro / inversión.
// Basado en qué tan discrecional es la categoría.
// 0 = todo necesario | 1 = todo discrecional

const INVESTABLE_FRACTION: Record<string, number> = {
  'comida y restaurantes': 0.30,
  'supermercado':          0.15,
  'entretenimiento':       0.50,
  'ropa y calzado':        0.40,
  'tecnología':            0.35,
  'suscripciones':         0.50,
  'viajes':                0.55,
  'mascotas':              0.30,
  'cuidado personal':      0.35,
  'deporte y gym':         0.40,
  'transporte':            0.20,
  'salud y farmacia':      0.05,
  'educación':             0.10,
  'hogar y servicios':     0.15,
  'otros':                 0.25,
};

const MIN_INVESTABLE_ARS  = 20_000;  // monto mínimo para mostrar el insight
const MIN_FRACTION        = 0.20;    // solo categorías con ≥ 20% discrecional

/** Devuelve la fracción invertible de una categoría por name_es. */
function getInvestableFraction(nameEs: string): number {
  const lower = nameEs.toLowerCase().trim();
  return INVESTABLE_FRACTION[lower] ?? 0.25; // fallback para categorías no mapeadas
}

// ─── Framing copy por categoría ───────────────────────────────────────────────

const CATEGORY_FRAMING: { keywords: string[]; text: string }[] = [
  { keywords: ['comida', 'restaurant'], text: 'Comer rico es válido. Pero parte de ese gasto podría haberse transformado en rendimiento.' },
  { keywords: ['supermercado'],         text: 'El súper es necesario. Pero hay un margen en cómo y dónde comprás que podría ahorrarse.' },
  { keywords: ['entretenimiento'],      text: 'El ocio tiene valor. Y también tiene costo. Mirá qué habría pasado con una parte.' },
  { keywords: ['ropa', 'calzado'],      text: 'Invertir en tu look es válido. Pero parte de eso pudo haber ido al otro tipo de inversión.' },
  { keywords: ['suscripci'],            text: 'Las suscripciones se acumulan mes a mes. Parte de ese gasto fijo pudo estar rindiendo.' },
  { keywords: ['viaje'],                text: 'Los viajes son experiencias. Y son de los gastos más "voluntarios" del presupuesto.' },
  { keywords: ['tecnología', 'tecno'],  text: 'Tecnología también es inversión... aunque no siempre en el sentido financiero.' },
];

function getFramingCopy(nameEs: string): string {
  const lower = nameEs.toLowerCase();
  return CATEGORY_FRAMING.find(f => f.keywords.some(k => lower.includes(k)))?.text
    ?? `En los últimos meses, una parte de lo que gastaste en ${nameEs} podría haber generado rendimiento.`;
}

// ─── Generación de WhatIf ─────────────────────────────────────────────────────

function buildWhatIf(
  instrument: Instrument,
  amount:     number,
  from:       string,
  to:         string,
  interestKeys: string[],
): WhatIfResult | null {
  const cumulative = getCumulativeReturn(instrument, from, to);
  if (!cumulative) return null;

  const { returnPct, monthsCovered } = cumulative;
  const gain       = Math.round(amount * returnPct / 100);
  const finalAmt   = amount + gain;
  const isLoss     = returnPct < 0;
  const matchesInterest = instrument.matchInterestKeys.some(k => interestKeys.includes(k));

  let interpretation: string;
  if (isLoss) {
    interpretation = `Este período fue negativo para ${instrument.shortName}. En activos de mayor riesgo, hay meses así.`;
  } else if (returnPct >= 10) {
    interpretation = `Buen período para ${instrument.shortName}. Habría generado un retorno por encima de la inflación.`;
  } else {
    interpretation = `${instrument.shortName} generó un retorno moderado que ayuda a preservar el poder adquisitivo.`;
  }

  if (matchesInterest && !isLoss) {
    interpretation += ' Alineado con tus intereses.';
  }

  return {
    instrument,
    initialAmount:  amount,
    finalAmount:    finalAmt,
    returnPct,
    gainArs:        gain,
    isLoss,
    monthsCovered,
    periodLabel:    periodLabel(monthsCovered),
    matchesInterest,
    interpretation,
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Construye todos los insights de oportunidad de costo para el usuario.
 *
 * @param categoryBreakdown - Categorías con su gasto total (resultado de query)
 * @param interestKeys      - interest_key[] del usuario (user_interests table)
 * @param savingsAmount     - Ahorro actual del usuario (financial_profiles.savings_amount)
 * @param officialInflation - Inflación mensual oficial (%) para calcular pérdida en ahorros
 * @param monthsBack        - Cuántos meses analizar (default: 3)
 */
export function buildOpportunityInsights(
  categoryBreakdown: { categoryNameEs: string; categoryColor: string; amount: number }[],
  interestKeys:      string[],
  savingsAmount:     number | null,
  officialInflation: number,
  monthsBack = 3,
): OpportunityInsights {
  // Rango de meses
  const now         = new Date();
  const toDate      = new Date(now.getFullYear(), now.getMonth() - 1, 1); // mes anterior
  const fromDate    = new Date(toDate.getFullYear(), toDate.getMonth() - (monthsBack - 1), 1);
  const fromMonthKey = buildMonthKey(fromDate.getFullYear(), fromDate.getMonth() + 1);
  const toMonthKey   = buildMonthKey(toDate.getFullYear(),   toDate.getMonth()   + 1);

  // Instrumentos recomendados según intereses
  const instruments = getRecommendedInstruments(interestKeys);

  // ── Oportunidades de categoría ─────────────────────────────────────────────

  const qualifying = categoryBreakdown
    .map(cat => ({
      ...cat,
      fraction:       getInvestableFraction(cat.categoryNameEs),
      investableAmt:  cat.amount * getInvestableFraction(cat.categoryNameEs),
    }))
    .filter(cat =>
      cat.fraction >= MIN_FRACTION &&
      cat.investableAmt >= MIN_INVESTABLE_ARS
    )
    .sort((a, b) => b.investableAmt - a.investableAmt)
    .slice(0, 2);

  const categoryOpportunities: CategoryOpportunity[] = qualifying.map(cat => {
    const whatIf = instruments
      .map(inst => buildWhatIf(inst, cat.investableAmt, fromMonthKey, toMonthKey, interestKeys))
      .filter((w): w is WhatIfResult => w !== null);

    return {
      categoryNameEs:     cat.categoryNameEs,
      categoryColor:      cat.categoryColor,
      totalSpent:         cat.amount,
      investableFraction: cat.fraction,
      investableAmount:   cat.investableAmt,
      whatIf,
      framing:            getFramingCopy(cat.categoryNameEs),
    };
  });

  // ── Oportunidad de ahorro parado ───────────────────────────────────────────

  let savingsOpportunity: SavingsOpportunity | null = null;

  if (savingsAmount && savingsAmount >= 20_000) {
    const fciResult = buildWhatIf(INSTRUMENTS.fci_mm, savingsAmount, toMonthKey, toMonthKey, interestKeys);
    // Para el ahorro: mostrar cuánto generaría en UN MES con FCI
    const oneMonthReturn = INSTRUMENTS.fci_mm.monthlyReturns[toMonthKey];
    if (oneMonthReturn !== undefined) {
      const gain    = Math.round(savingsAmount * oneMonthReturn / 100);
      const fciWhatIf: WhatIfResult = {
        instrument:      INSTRUMENTS.fci_mm,
        initialAmount:   savingsAmount,
        finalAmount:     savingsAmount + gain,
        returnPct:       oneMonthReturn,
        gainArs:         gain,
        isLoss:          false,
        monthsCovered:   1,
        periodLabel:     'en 1 mes',
        matchesInterest: interestKeys.includes('fci'),
        interpretation:  'El FCI de liquidez es la forma más simple de que tu plata no quede quieta.',
      };

      // Pérdida estimada por inflación
      const inflationLossArs = Math.round(savingsAmount * officialInflation / 100);

      savingsOpportunity = {
        savingsAmount,
        whatIf:                  fciWhatIf,
        inflationLossArs,
        officialMonthlyInflation: officialInflation,
      };
    }
  }

  return {
    categoryOpportunities,
    savingsOpportunity,
    fromMonthKey,
    toMonthKey,
    monthsAnalyzed: monthsBack,
  };
}
