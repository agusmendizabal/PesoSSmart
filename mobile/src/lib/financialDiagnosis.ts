import { formatCurrency } from '@/utils/format';
import { colors } from '@/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsightType = 'positive' | 'negative' | 'warning' | 'opportunity';

export interface DiagnosticInsight {
  id: string;
  type: InsightType;
  icon: string;
  title: string;
  body: string;
  metric?: string;
}

export interface HealthComponent {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  explanation: string;
  color: string;
}

export interface FinancialDiagnosis {
  healthScore: number;
  healthLabel: string;
  healthColor: string;
  components: HealthComponent[];
  insights: DiagnosticInsight[];
  actions: { text: string; impact: 'high' | 'medium' | 'low' }[];
  reportPayload: Record<string, any>;
}

export interface MonthHistoryEntry {
  monthKey: string;
  label: string;
  total: number;
  disposable: number;
  necessary: number;
  investable: number;
}

export interface CategoryRowInput {
  id: string;
  name: string;
  color: string;
  amount: number;
  pct: number;
}

// Map expense category name → inflation instrument key
const CATEGORY_TO_INFLATION: Record<string, string> = {
  supermercado: 'inflation_food', almacén: 'inflation_food', comida: 'inflation_food',
  alimentos: 'inflation_food', mercado: 'inflation_food',
  transporte: 'inflation_transport', combustible: 'inflation_transport',
  nafta: 'inflation_transport', peajes: 'inflation_transport', taxi: 'inflation_transport',
  uber: 'inflation_transport', colectivo: 'inflation_transport',
  salud: 'inflation_health', médico: 'inflation_health', farmacia: 'inflation_health',
  medicamentos: 'inflation_health', clínica: 'inflation_health',
  servicios: 'inflation_housing', electricidad: 'inflation_housing',
  gas: 'inflation_housing', internet: 'inflation_housing', telefonía: 'inflation_comms',
  educación: 'inflation_education', colegio: 'inflation_education', universidad: 'inflation_education',
  restaurante: 'inflation_restaurants', bar: 'inflation_restaurants', delivery: 'inflation_restaurants',
  ropa: 'inflation_clothing', indumentaria: 'inflation_clothing',
};

function categoryInflationKey(name: string): string | null {
  const lower = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [keyword, key] of Object.entries(CATEGORY_TO_INFLATION)) {
    if (lower.includes(keyword)) return key;
  }
  return null;
}

export interface DiagnosisInput {
  totalThisMonth: number;
  totalNecessary: number;
  totalDisposable: number;
  totalInvestable: number;
  estimatedIncome: number | null;
  history: MonthHistoryEntry[];
  rows: CategoryRowInput[];
  inflationRate: number;
  fciRate: number;
  dayOfMonth: number;
  // Extended rates and category inflation
  allRates?: Record<string, number>;        // instrument → rate_monthly
  categoryInflationRates?: Record<string, number>; // instrument → rate_monthly
  // Previous month by category (for real-change computation)
  prevMonthCategoryAmounts?: Record<string, number>; // category name → amount
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthMeta(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Excelente',  color: colors.neon };
  if (score >= 70) return { label: 'Bueno',      color: colors.primary };
  if (score >= 55) return { label: 'Moderado',   color: '#FFD740' };
  if (score >= 35) return { label: 'En riesgo',  color: '#FF9800' };
  return               { label: 'Crítico',     color: colors.red };
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function computeFinancialDiagnosis(input: DiagnosisInput): FinancialDiagnosis {
  const {
    totalThisMonth, totalNecessary, totalDisposable, totalInvestable,
    estimatedIncome, history, rows, inflationRate, fciRate, dayOfMonth,
    allRates = {}, categoryInflationRates = {}, prevMonthCategoryAmounts = {},
  } = input;

  const classified = totalNecessary + totalDisposable + totalInvestable;
  const components: HealthComponent[] = [];

  // ── 1. Control de gasto vs ingreso (35 pts) ───────────────────────────────
  if (estimatedIncome && estimatedIncome > 0 && totalThisMonth > 0) {
    // Project to end of month to avoid false positives on day 3
    const daysInMonth = 30;
    const adj = dayOfMonth < 8 ? totalThisMonth * (daysInMonth / dayOfMonth) : totalThisMonth;
    const pct = adj / estimatedIncome;
    let score: number;
    let explanation: string;
    if (pct < 0.7) {
      score = 35;
      explanation = `Gastás el ${Math.round(pct * 100)}% del ingreso. Excelente margen.`;
    } else if (pct < 0.8) {
      score = 28;
      explanation = `Gastás el ${Math.round(pct * 100)}% del ingreso. Buen nivel.`;
    } else if (pct < 0.9) {
      score = 18;
      explanation = `Gastás el ${Math.round(pct * 100)}% del ingreso. Poco margen de ahorro.`;
    } else if (pct < 1.0) {
      score = 8;
      explanation = `Gastás el ${Math.round(pct * 100)}% del ingreso. Margen mínimo.`;
    } else {
      score = 0;
      explanation = `Gastás más de lo que ganás (${Math.round(pct * 100)}%).`;
    }
    components.push({
      key: 'spending', label: 'Control de gasto', score, maxScore: 35, explanation,
      color: score >= 28 ? colors.neon : score >= 18 ? '#FFD740' : colors.red,
    });
  }

  // ── 2. Ratio prescindibles (25 pts) ───────────────────────────────────────
  if (classified > 0) {
    const dispPct = totalDisposable / classified;
    let score: number;
    let explanation: string;
    if (dispPct < 0.15) {
      score = 25;
      explanation = `Solo el ${Math.round(dispPct * 100)}% de lo clasificado es prescindible. Muy eficiente.`;
    } else if (dispPct < 0.25) {
      score = 18;
      explanation = `El ${Math.round(dispPct * 100)}% es prescindible. Dentro del rango recomendado.`;
    } else if (dispPct < 0.35) {
      score = 10;
      explanation = `El ${Math.round(dispPct * 100)}% es prescindible. Por encima del ideal (20%).`;
    } else {
      score = 3;
      explanation = `El ${Math.round(dispPct * 100)}% es prescindible. Alto potencial de optimización.`;
    }
    components.push({
      key: 'disposable', label: 'Gastos prescindibles', score, maxScore: 25, explanation,
      color: score >= 18 ? colors.neon : score >= 10 ? '#FFD740' : colors.red,
    });
  }

  // ── 3. Cobertura de clasificación (15 pts) ────────────────────────────────
  if (totalThisMonth > 0) {
    const coverage = classified / totalThisMonth;
    let score: number;
    let explanation: string;
    if (coverage >= 0.9) {
      score = 15;
      explanation = `${Math.round(coverage * 100)}% de tus gastos están clasificados. Excelente orden.`;
    } else if (coverage >= 0.7) {
      score = 10;
      explanation = `${Math.round(coverage * 100)}% clasificado. Podés mejorar la cobertura.`;
    } else if (coverage >= 0.4) {
      score = 5;
      explanation = `Solo el ${Math.round(coverage * 100)}% clasificado. Clasificar más mejora el análisis.`;
    } else {
      score = 0;
      explanation = `Menos del 40% clasificado. Sin datos suficientes para un análisis completo.`;
    }
    components.push({
      key: 'classification', label: 'Gastos clasificados', score, maxScore: 15, explanation,
      color: score >= 10 ? colors.primary : score >= 5 ? '#FFD740' : colors.red,
    });
  }

  // ── 4. Tendencia histórica (15 pts) ───────────────────────────────────────
  if (history.length >= 2) {
    const sorted     = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const recentAmt  = sorted[sorted.length - 1].total;
    const avgOld     = sorted.slice(0, -1).reduce((s, h) => s + h.total, 0) / (sorted.length - 1);
    const changePct  = avgOld > 0 ? ((recentAmt - avgOld) / avgOld) * 100 : 0;
    const realChange = changePct - inflationRate;
    let score: number;
    let explanation: string;
    if (realChange < -5) {
      score = 15;
      explanation = `Bajaste el gasto real ${Math.round(-realChange)}% vs tu promedio (descontando inflación).`;
    } else if (realChange < 5) {
      score = 10;
      explanation = `Tu gasto real es estable respecto a tu promedio histórico.`;
    } else if (realChange < 15) {
      score = 5;
      explanation = `Tu gasto real creció ${Math.round(realChange)}% por encima de la inflación.`;
    } else {
      score = 0;
      explanation = `Tu gasto real creció ${Math.round(realChange)}% sobre la inflación. Tendencia preocupante.`;
    }
    components.push({
      key: 'trend', label: 'Tendencia histórica', score, maxScore: 15, explanation,
      color: score >= 10 ? colors.neon : score >= 5 ? '#FFD740' : colors.red,
    });
  }

  // ── 5. Margen de ahorro (10 pts) ──────────────────────────────────────────
  if (estimatedIncome && estimatedIncome > 0) {
    const savingsPct = (estimatedIncome - totalThisMonth) / estimatedIncome;
    let score: number;
    let explanation: string;
    if (savingsPct > 0.2) {
      score = 10;
      explanation = `Guardás el ${Math.round(savingsPct * 100)}% del ingreso. Superás el mínimo recomendado.`;
    } else if (savingsPct > 0.1) {
      score = 7;
      explanation = `Guardás el ${Math.round(savingsPct * 100)}% del ingreso. Apuntá al 20%.`;
    } else if (savingsPct > 0) {
      score = 3;
      explanation = `Solo el ${Math.round(savingsPct * 100)}% queda disponible para ahorrar.`;
    } else {
      score = 0;
      explanation = `Sin margen de ahorro este mes.`;
    }
    components.push({
      key: 'savings', label: 'Margen de ahorro', score, maxScore: 10, explanation,
      color: score >= 7 ? colors.neon : score >= 3 ? '#FFD740' : colors.red,
    });
  }

  // ── Score final normalizado ────────────────────────────────────────────────
  const maxTotal   = components.reduce((s, c) => s + c.maxScore, 0);
  const scoreTotal = components.reduce((s, c) => s + c.score, 0);
  const finalScore = maxTotal > 0 ? Math.round((scoreTotal / maxTotal) * 100) : 0;
  const { label, color } = healthMeta(finalScore);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights: DiagnosticInsight[] = [];

  // Ahorro vs ingreso
  if (estimatedIncome && estimatedIncome > 0 && totalThisMonth > 0) {
    const saving    = estimatedIncome - totalThisMonth;
    const incomePct = Math.round((totalThisMonth / estimatedIncome) * 100);
    if (saving > 0) {
      const savingPct = Math.round((saving / estimatedIncome) * 100);
      if (savingPct >= 20) {
        insights.push({
          id: 'savings_good', type: 'positive',
          icon: 'shield-checkmark-outline',
          title: `Ahorrás el ${savingPct}% del ingreso`,
          body: `Te sobran ${formatCurrency(saving)} este mes. En Argentina, el umbral mínimo para preservar poder adquisitivo frente a la inflación es el 20%. Lo estás superando.`,
          metric: formatCurrency(saving),
        });
      } else {
        insights.push({
          id: 'savings_low', type: 'warning',
          icon: 'remove-outline',
          title: `Ahorrás el ${savingPct}% — objetivo: 20%`,
          body: `Quedaron ${formatCurrency(saving)} sin gastar. Para preservar poder adquisitivo en Argentina, necesitás al menos el 20% en instrumentos que ajusten (FCI, UVA, MEP). Hoy estás debajo de ese umbral.`,
          metric: formatCurrency(saving),
        });
      }
    } else {
      insights.push({
        id: 'deficit', type: 'negative',
        icon: 'alert-circle-outline',
        title: `Déficit de ${formatCurrency(Math.abs(saving))}`,
        body: `Gastaste el ${incomePct}% de tu ingreso estimado. Sin corrección, el déficit se acumula mes a mes. Identificá los ${formatCurrency(Math.abs(saving))} que podés recortar.`,
        metric: `${incomePct}% del ingreso`,
      });
    }
  }

  // Prescindibles
  if (classified > 0 && totalDisposable >= 0) {
    const dispPct = Math.round((totalDisposable / classified) * 100);
    if (totalDisposable > 0 && dispPct > 30) {
      insights.push({
        id: 'disposable_high', type: 'warning',
        icon: 'wallet-outline',
        title: `${dispPct}% de lo clasificado es prescindible`,
        body: `Tus gastos no esenciales suman ${formatCurrency(totalDisposable)}. Reducirlos un tercio liberaría ${formatCurrency(Math.round(totalDisposable / 3))} mensuales — suficiente para arrancar un fondo de inversión.`,
        metric: formatCurrency(totalDisposable),
      });
    } else if (totalDisposable > 0 && dispPct <= 15) {
      insights.push({
        id: 'disposable_controlled', type: 'positive',
        icon: 'checkmark-circle-outline',
        title: `Prescindibles bajo control: ${dispPct}%`,
        body: `Solo el ${dispPct}% de tus gastos clasificados son prescindibles (${formatCurrency(totalDisposable)}). Es un nivel muy eficiente. Mantenerlo es un hábito que se traduce en ahorro real.`,
        metric: `${dispPct}%`,
      });
    }
  }

  // Categoría dominante
  if (rows.length > 0) {
    const top    = rows[0];
    const topPct = Math.round(top.pct * 100);
    if (topPct > 40) {
      insights.push({
        id: 'top_cat_high', type: 'warning',
        icon: 'pie-chart-outline',
        title: `"${top.name}" concentra el ${topPct}% del gasto`,
        body: `Un solo rubro consumiendo más del 40% del total merece atención. Si es alquiler o comida, está dentro de lo esperado. Si no, puede ser una oportunidad de optimización.`,
        metric: formatCurrency(top.amount),
      });
    } else if (rows.length >= 3 && rows[0].pct - rows[2].pct < 0.15) {
      insights.push({
        id: 'spending_balanced', type: 'positive',
        icon: 'grid-outline',
        title: `Gasto equilibrado entre categorías`,
        body: `Tus tres primeras categorías representan porcentajes similares. Un gasto distribuido reduce el riesgo de que un solo rubro desborde el presupuesto.`,
      });
    }
  }

  // Tendencia mes a mes
  if (history.length >= 2) {
    const sorted   = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const recent   = sorted[sorted.length - 1];
    const prev     = sorted[sorted.length - 2];
    if (prev.total > 0) {
      const changePct  = Math.round(((recent.total - prev.total) / prev.total) * 100);
      const realChange = changePct - Math.round(inflationRate);
      if (realChange > 10) {
        insights.push({
          id: 'trend_up_real', type: 'negative',
          icon: 'trending-up-outline',
          title: `Gasto real subió ${realChange}% vs mes anterior`,
          body: `El aumento nominal fue ${changePct}%, pero la inflación del mes fue ${inflationRate.toFixed(1)}%. El incremento real supera el ajuste por precios: tus gastos crecieron genuinamente.`,
          metric: `+${changePct}%`,
        });
      } else if (realChange < -5) {
        insights.push({
          id: 'trend_down_real', type: 'positive',
          icon: 'trending-down-outline',
          title: `Gastos reales bajaron ${Math.abs(realChange)}%`,
          body: `Ajustando por inflación (${inflationRate.toFixed(1)}%), tus gastos cayeron ${Math.abs(realChange)}% en términos reales. Eso significa que ganaste poder adquisitivo este mes.`,
          metric: `${realChange}%`,
        });
      }

      // Prescindibles mes a mes
      if (prev.disposable > 0 && recent.disposable > 0) {
        const dispChange = Math.round(((recent.disposable - prev.disposable) / prev.disposable) * 100);
        if (dispChange < -10) {
          insights.push({
            id: 'disposable_trend_down', type: 'positive',
            icon: 'arrow-down-circle-outline',
            title: `Prescindibles bajaron ${Math.abs(dispChange)}% vs mes pasado`,
            body: `Redujiste gastos no esenciales de ${formatCurrency(prev.disposable)} a ${formatCurrency(recent.disposable)}. Diferencia mensual: ${formatCurrency(prev.disposable - recent.disposable)}.`,
            metric: `-${Math.abs(dispChange)}%`,
          });
        } else if (dispChange > 20) {
          insights.push({
            id: 'disposable_trend_up', type: 'warning',
            icon: 'arrow-up-circle-outline',
            title: `Prescindibles subieron ${dispChange}% vs mes pasado`,
            body: `Tus gastos no esenciales pasaron de ${formatCurrency(prev.disposable)} a ${formatCurrency(recent.disposable)}. Un incremento de ${formatCurrency(recent.disposable - prev.disposable)} en un mes.`,
            metric: `+${dispChange}%`,
          });
        }
      }
    }
  }

  // Oportunidad FCI
  if (estimatedIncome && estimatedIncome > 0 && fciRate > 0) {
    const savingsCapacity = estimatedIncome - totalThisMonth;
    if (savingsCapacity >= 20000) {
      const monthlyReturn = Math.round(savingsCapacity * (fciRate / 100));
      insights.push({
        id: 'fci_opportunity', type: 'opportunity',
        icon: 'trending-up-outline',
        title: `Podrías ganar ~${formatCurrency(monthlyReturn)} en FCI`,
        body: `Con ${formatCurrency(savingsCapacity)} disponibles al ${fciRate.toFixed(1)}%/mes en un FCI Money Market, generarías ${formatCurrency(monthlyReturn)} sin riesgo. Sin invertirlos, pierden contra la inflación.`,
        metric: formatCurrency(monthlyReturn),
      });
    }
  }

  // Gastos invertibles
  if (totalInvestable > 0) {
    insights.push({
      id: 'investable_found', type: 'positive',
      icon: 'cash-outline',
      title: `${formatCurrency(totalInvestable)} clasificados como invertibles`,
      body: `Tenés ${formatCurrency(totalInvestable)} en gastos que clasificaste como inversión. Ese capital está trabajando para vos en lugar de ser consumo.`,
      metric: formatCurrency(totalInvestable),
    });
  }

  // ── Proyecciones anuales ──────────────────────────────────────────────────
  if (estimatedIncome && estimatedIncome > 0) {
    const monthlySaving = estimatedIncome - totalThisMonth;
    if (monthlySaving > 5000) {
      const annualSavings = Math.round(monthlySaving * 12);
      // Rough FCI compound: monthly reinvestment
      const fciAnnual = Math.round(
        Array.from({ length: 12 }, (_, i) => i + 1)
          .reduce((acc) => acc * (1 + fciRate / 100), monthlySaving) * 12 * 0.8
      );
      insights.push({
        id: 'annual_projection', type: 'opportunity',
        icon: 'calendar-outline',
        title: `Proyección 12 meses: ${formatCurrency(annualSavings)}`,
        body: `Con ${formatCurrency(monthlySaving)}/mes de margen, en un año acumulás ${formatCurrency(annualSavings)}. Invertidos en FCI Money Market (~${fciRate.toFixed(1)}%/mes), el resultado sería mayor gracias al interés compuesto.`,
        metric: formatCurrency(annualSavings),
      });
    }
  }

  // Simulación: reducir prescindibles
  if (totalDisposable >= 10000) {
    const cut20    = Math.round(totalDisposable * 0.2);
    const annual20 = cut20 * 12;
    insights.push({
      id: 'sim_reduce_disposable', type: 'opportunity',
      icon: 'calculator-outline',
      title: `Recortá prescindibles 20% = ${formatCurrency(annual20)}/año`,
      body: `${formatCurrency(cut20)}/mes menos en gastos no esenciales × 12 = ${formatCurrency(annual20)} anuales. Alcanza para un fondo de emergencia en ${Math.round(annual20 / (estimatedIncome ?? annual20) * 12)} meses.`,
      metric: formatCurrency(annual20),
    });
  }

  // Simulación: top categoría (si representa mucho)
  if (rows.length > 0 && rows[0].pct > 0.25) {
    const top = rows[0];
    const cut30    = Math.round(top.amount * 0.3);
    const annual30 = cut30 * 12;
    insights.push({
      id: 'sim_top_category', type: 'opportunity',
      icon: 'cut-outline',
      title: `Reducir "${top.name}" 30% = ${formatCurrency(annual30)}/año`,
      body: `"${top.name}" es tu rubro más alto (${formatCurrency(top.amount)}). Un ajuste del 30% son ${formatCurrency(cut30)}/mes — ${formatCurrency(annual30)} en 12 meses.`,
      metric: formatCurrency(annual30),
    });
  }

  // ── Contexto inflación por categoría ─────────────────────────────────────
  if (Object.keys(categoryInflationRates).length > 0 && Object.keys(prevMonthCategoryAmounts).length > 0) {
    for (const row of rows.slice(0, 3)) {
      const inflKey = categoryInflationKey(row.name);
      if (!inflKey) continue;
      const catInflation = categoryInflationRates[inflKey];
      if (!catInflation) continue;
      const prevAmt = prevMonthCategoryAmounts[row.name];
      if (!prevAmt || prevAmt <= 0) continue;
      const nominalChangePct = ((row.amount - prevAmt) / prevAmt) * 100;
      const realChangePct    = nominalChangePct - catInflation;
      if (Math.abs(realChangePct) < 3) continue; // skip if within 3% band
      if (realChangePct > 5) {
        insights.push({
          id: `cat_real_up_${row.id}`, type: 'warning',
          icon: 'trending-up-outline',
          title: `"${row.name}" creció ${Math.round(realChangePct)}% por encima de su inflación`,
          body: `Subió ${Math.round(nominalChangePct)}% nominal, pero la inflación de ese rubro (INDEC) fue ${catInflation.toFixed(1)}%. El incremento real es ${Math.round(realChangePct)}% — genuinamente más gasto.`,
          metric: `+${Math.round(nominalChangePct)}%`,
        });
      } else if (realChangePct < -5) {
        insights.push({
          id: `cat_real_down_${row.id}`, type: 'positive',
          icon: 'trending-down-outline',
          title: `"${row.name}" bajó ${Math.round(-realChangePct)}% en términos reales`,
          body: `Aunque nominalmente varió ${Math.round(nominalChangePct)}%, la inflación de ese rubro fue ${catInflation.toFixed(1)}%. Tu gasto real cayó ${Math.round(-realChangePct)}%.`,
          metric: `${Math.round(realChangePct)}%`,
        });
      }
    }
  }

  // ── Comparación de tasas ──────────────────────────────────────────────────
  if (Object.keys(allRates).length >= 2 && estimatedIncome && estimatedIncome > 0) {
    const saving = estimatedIncome - totalThisMonth;
    if (saving > 0) {
      const bestInstrument = Object.entries(allRates)
        .filter(([k]) => ['pf_30d', 'caucion_1d', 'fci_mm', 'lecap_monthly'].includes(k))
        .sort(([, a], [, b]) => b - a)[0];
      if (bestInstrument) {
        const [key, rate] = bestInstrument;
        const LABEL: Record<string, string> = { pf_30d: 'Plazo Fijo 30d', caucion_1d: 'Caución', fci_mm: 'FCI Money Market', lecap_monthly: 'Lecap' };
        const monthlyReturn = Math.round(saving * (rate / 100));
        if (monthlyReturn > 500) {
          insights.push({
            id: 'best_rate_opportunity', type: 'opportunity',
            icon: 'podium-outline',
            title: `Mejor tasa hoy: ${LABEL[key] ?? key} (${rate.toFixed(1)}%/mes)`,
            body: `Con ${formatCurrency(saving)} de margen mensual, el instrumento con mejor tasa hoy generaría ~${formatCurrency(monthlyReturn)}/mes sin riesgo. La inflación general es ${inflationRate.toFixed(1)}% — ${rate > inflationRate ? 'cubrís la inflación' : 'no alcanza a cubrir la inflación'}.`,
            metric: `${rate.toFixed(1)}%/mes`,
          });
        }
      }
    }
  }

  // Gastos sin clasificar
  if (totalThisMonth > 0) {
    const unclassified = totalThisMonth - classified;
    const unclPct      = unclassified / totalThisMonth;
    if (unclPct > 0.4 && unclassified > 10000) {
      insights.push({
        id: 'unclassified_high', type: 'warning',
        icon: 'help-circle-outline',
        title: `${Math.round(unclPct * 100)}% de gastos sin clasificar`,
        body: `Hay ${formatCurrency(unclassified)} en gastos sin clasificación. Sin esos datos, el análisis es incompleto y el puntaje de salud es menos preciso.`,
        metric: formatCurrency(unclassified),
      });
    }
  }

  // ── Acciones concretas ────────────────────────────────────────────────────
  const actions: { text: string; impact: 'high' | 'medium' | 'low' }[] = [];

  if (estimatedIncome && totalThisMonth > estimatedIncome) {
    actions.push({
      text: `Reducí ${formatCurrency(totalThisMonth - estimatedIncome)} para cerrar el mes sin déficit`,
      impact: 'high',
    });
  }
  if (classified > 0 && totalDisposable / classified > 0.25) {
    actions.push({
      text: `Recortá un 20% de prescindibles (${formatCurrency(Math.round(totalDisposable * 0.2))}) para liberar ahorro`,
      impact: 'high',
    });
  }
  if (estimatedIncome && (estimatedIncome - totalThisMonth) >= 20000 && fciRate > 0) {
    actions.push({
      text: `Invertí el sobrante (${formatCurrency(Math.max(0, estimatedIncome - totalThisMonth))}) en un FCI Money Market`,
      impact: 'medium',
    });
  }
  if (totalThisMonth > 0 && classified / totalThisMonth < 0.7) {
    actions.push({
      text: `Clasificá los gastos sin categoría para mejorar la precisión del análisis`,
      impact: 'medium',
    });
  }
  if (history.length < 2) {
    actions.push({
      text: `Registrá gastos al menos 2 meses para habilitar comparaciones históricas`,
      impact: 'low',
    });
  }

  // ── Payload para reporte IA ───────────────────────────────────────────────
  const sorted    = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const histTrend = sorted.length >= 2
    ? (() => {
        const r = sorted[sorted.length - 1].total;
        const p = sorted[sorted.length - 2].total;
        return p > 0 ? Math.round(((r - p) / p) * 100) : null;
      })()
    : null;

  const monthlySaving     = estimatedIncome ? estimatedIncome - totalThisMonth : null;
  const annualProjection  = monthlySaving != null && monthlySaving > 0 ? Math.round(monthlySaving * 12) : null;

  const reportPayload: Record<string, any> = {
    health_score:      finalScore,
    health_label:      label,
    total:             totalThisMonth,
    income:            estimatedIncome,
    income_pct:        estimatedIncome && estimatedIncome > 0 ? Math.round((totalThisMonth / estimatedIncome) * 100) : null,
    necessary:         totalNecessary,
    disposable:        totalDisposable,
    investable:        totalInvestable,
    classified_total:  classified,
    disposable_pct:    classified > 0 ? Math.round((totalDisposable / classified) * 100) : null,
    savings_capacity:  monthlySaving,
    annual_projection: annualProjection,
    inflation_rate:    inflationRate,
    fci_rate:          fciRate,
    rates:             allRates,
    category_inflation:categoryInflationRates,
    top_category:      rows[0] ? { name: rows[0].name, amount: rows[0].amount, pct: Math.round(rows[0].pct * 100) } : null,
    history_trend_pct: histTrend,
    real_trend_pct:    histTrend != null ? histTrend - Math.round(inflationRate) : null,
    components:        components.map(c => ({ label: c.label, score: c.score, max: c.maxScore, note: c.explanation })),
  };

  return { healthScore: finalScore, healthLabel: label, healthColor: color, components, insights, actions, reportPayload };
}
