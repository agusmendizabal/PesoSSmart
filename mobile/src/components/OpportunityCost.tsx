/**
 * OpportunityCost
 *
 * "¿Qué podrías haber hecho con esa plata?"
 *
 * Muestra escenarios hipotéticos de inversión basados en los gastos reales
 * del usuario, sus intereses y su perfil de riesgo.
 *
 * Subcomponentes internos:
 *   WhatIfRow         – fila por instrumento con resultado hipotético
 *   CategoryCard      – card por categoría de gasto destacada
 *   SavingsCard       – insight personalizado para ahorro parado
 *   Disclaimer        – nota legal discreta al pie
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { getLatestIndecEntry } from '@/lib/indecData';
import { deriveHorizon, DEFAULT_INVESTMENT_PROFILE, type UserInvestmentProfile, type ConfidenceLevel } from '@/lib/investmentRecommendation';
import { buildOpportunityInsights, type OpportunityInsights, type WhatIfResult, type CategoryOpportunity, type SavingsOpportunity } from '@/utils/opportunityCost';
import { RecommendationComparison } from './RecommendationComparison';
import type { RiskProfile } from '@/types';

// ─── Colores por nivel de riesgo ──────────────────────────────────────────────

const RISK_COLOR = { low: colors.primary, medium: colors.yellow, high: colors.red } as const;
const RISK_BG    = { low: colors.primary + '14', medium: colors.yellow + '16', high: colors.red + '12' } as const;

// ─── WhatIfRow ────────────────────────────────────────────────────────────────

// ─── Confidence Badge ─────────────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<ConfidenceLevel, string> = {
  high:   colors.primary,
  medium: colors.yellow,
  low:    colors.text.tertiary,
};

function ConfidenceBadge({ level, note }: { level: ConfidenceLevel; note: string }) {
  const color = CONFIDENCE_COLOR[level];
  const label = level === 'high' ? 'PERSONALIZADA' : level === 'medium' ? 'PARCIAL' : 'GENÉRICA';
  return (
    <View style={confStyles.row}>
      <View style={[confStyles.dot, { backgroundColor: color }]} />
      <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, lineHeight: 15 }}>
        <Text variant="caption" color={color}>{label} · </Text>
        {note}
      </Text>
    </View>
  );
}

const confStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[2],
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    marginTop:    4,
    flexShrink:   0,
  },
});

// ─── WhatIfRow ────────────────────────────────────────────────────────────────

function WhatIfRow({ result, uiLabel, uiColor }: { result: WhatIfResult; uiLabel?: string; uiColor?: string }) {
  const rColor    = RISK_COLOR[result.instrument.riskLevel];
  const rBg       = RISK_BG[result.instrument.riskLevel];
  const gainColor = result.isLoss ? colors.red : colors.primary;

  return (
    <View style={wifStyles.container}>
      {/* Header: instrumento + badges */}
      <View style={wifStyles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }} numberOfLines={1}>
            {result.instrument.name}
          </Text>
          <Text variant="caption" color={colors.text.tertiary}>
            {result.instrument.description}
          </Text>
        </View>
        <View style={wifStyles.badges}>
          {uiLabel && uiColor && (
            <View style={[wifStyles.riskBadge, { backgroundColor: uiColor + '20' }]}>
              <Text variant="caption" color={uiColor} style={{ fontSize: 9 }}>
                {uiLabel.toUpperCase()}
              </Text>
            </View>
          )}
          <View style={[wifStyles.riskBadge, { backgroundColor: rBg }]}>
            <Text variant="caption" color={rColor} style={{ fontSize: 9 }}>
              {result.instrument.riskLabel.toUpperCase()}
            </Text>
          </View>
        </View>
      </View>

      {/* Resultado numérico */}
      <View style={wifStyles.amounts}>
        <View>
          <Text variant="caption" color={colors.text.tertiary}>Invertís</Text>
          <Text variant="labelMd" color={colors.text.secondary}>
            {formatCurrency(result.initialAmount)}
          </Text>
        </View>
        <Ionicons
          name={result.isLoss ? 'arrow-down' : 'arrow-forward'}
          size={14}
          color={gainColor}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" color={colors.text.tertiary}>
            {result.isLoss ? 'Resultado' : 'Tendrías'}
          </Text>
          <Text variant="labelMd" color={gainColor}>
            {formatCurrency(result.finalAmount)}
          </Text>
        </View>
      </View>

      {/* Ganancia/pérdida */}
      <View style={wifStyles.gainRow}>
        <Text variant="caption" color={gainColor} style={{ fontFamily: 'DMSans_600SemiBold' }}>
          {result.isLoss ? '−' : '+'}{formatCurrency(Math.abs(result.gainArs))}
          {'  '}({result.isLoss ? '' : '+'}{result.returnPct.toFixed(1)}%)
          {'  '}en {result.periodLabel}
        </Text>
        {result.matchesInterest && !result.isLoss && (
          <View style={wifStyles.interestTag}>
            <Text variant="caption" color={colors.accent} style={{ fontSize: 9 }}>
              ★ TUS INTERESES
            </Text>
          </View>
        )}
      </View>

      {/* Interpretación */}
      <Text variant="caption" color={colors.text.tertiary} style={{ lineHeight: 16 }}>
        {result.interpretation}
      </Text>
    </View>
  );
}

const wifStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.elevated,
    borderRadius:    10,
    padding:         spacing[4],
    gap:             spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
  },
  badges: {
    flexDirection: 'row',
    gap:           spacing[1],
    flexShrink:    0,
    flexWrap:      'wrap',
    justifyContent: 'flex-end',
  },
  riskBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical:   3,
    borderRadius:      4,
    alignSelf:         'flex-start',
    flexShrink:        0,
  },
  amounts: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: spacing[1],
  },
  gainRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    flexWrap:      'wrap',
  },
  interestTag: {
    backgroundColor:   colors.accent + '14',
    paddingHorizontal: spacing[2],
    paddingVertical:   2,
    borderRadius:      3,
  },
});

// ─── CategoryCard ─────────────────────────────────────────────────────────────

function CategoryCard({ opportunity, monthsBack }: { opportunity: CategoryOpportunity; monthsBack: number }) {
  const [expanded, setExpanded] = useState(true);
  const investPct = Math.round(opportunity.investableFraction * 100);

  return (
    <View style={catStyles.card}>
      <TouchableOpacity style={catStyles.header} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={[catStyles.dot, { backgroundColor: opportunity.categoryColor }]} />
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
            {opportunity.categoryNameEs}
          </Text>
          <Text variant="caption" color={colors.text.tertiary}>
            {formatCurrency(opportunity.totalSpent)} en los últimos {monthsBack} meses
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.text.tertiary} />
      </TouchableOpacity>

      {expanded && (
        <>
          <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
            {opportunity.framing}
          </Text>
          <View style={catStyles.investBox}>
            <Text variant="caption" color={colors.text.tertiary}>
              Si el {investPct}% ({formatCurrency(opportunity.investableAmount)}) fuera a rendimiento...
            </Text>
          </View>
          <View style={{ gap: spacing[3] }}>
            {opportunity.whatIf.map(wif => (
              <WhatIfRow key={wif.instrument.id} result={wif} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const catStyles = StyleSheet.create({
  card: {
    borderWidth:  1,
    borderColor:  colors.border.subtle,
    borderRadius: 12,
    padding:      spacing[4],
    gap:          spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[3],
  },
  dot: {
    width:        10,
    height:       10,
    borderRadius: 5,
    flexShrink:   0,
  },
  investBox: {
    backgroundColor:   colors.bg.input,
    borderRadius:      6,
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
  },
});

// ─── SavingsCard ──────────────────────────────────────────────────────────────

function SavingsCard({ opportunity }: { opportunity: SavingsOpportunity }) {
  const { savingsAmount, whatIf, secondaryWhatIf, inflationLossArs, officialMonthlyInflation, recommendation } = opportunity;
  const [expanded, setExpanded] = useState(true);

  return (
    <View style={savStyles.card}>
      {/* Título */}
      <View style={savStyles.titleRow}>
        <Ionicons name="wallet-outline" size={16} color={colors.yellow} />
        <Text variant="label" color={colors.yellow}>PLATA SIN INVERTIR</Text>
      </View>

      {/* Monto ahorrado */}
      <Text variant="bodySmall" color={colors.text.primary} style={{ lineHeight: 20 }}>
        Tenés{' '}
        <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_700Bold' }}>
          {formatCurrency(savingsAmount)}
        </Text>
        {' '}guardados sin rendir.
      </Text>

      {/* Narrativa personalizada */}
      <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
        {recommendation.explanation}
      </Text>

      {/* Costo de no invertir */}
      <View style={savStyles.lossRow}>
        <Text variant="caption" color={colors.text.secondary}>
          Con inflación de {officialMonthlyInflation.toFixed(1)}% mensual:
        </Text>
        <Text variant="caption" color={colors.red} style={{ fontFamily: 'DMSans_600SemiBold' }}>
          perdés ~{formatCurrency(inflationLossArs)}/mes de poder adquisitivo
        </Text>
      </View>

      {/* Simulaciones */}
      <TouchableOpacity
        style={savStyles.expandRow}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
      >
        <Text variant="label" color={colors.text.tertiary} style={{ fontSize: 10 }}>
          {expanded ? 'OCULTAR SIMULACIONES' : 'VER SIMULACIONES'}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.text.tertiary} />
      </TouchableOpacity>

      {/* Confianza de la sugerencia */}
      <ConfidenceBadge level={recommendation.confidence.level} note={recommendation.confidence.note} />

      {expanded && (
        <View style={{ gap: spacing[3] }}>
          <WhatIfRow
            result={whatIf}
            uiLabel={recommendation.primary.uiLabel}
            uiColor={recommendation.primary.uiColor}
          />
          {secondaryWhatIf && recommendation.secondary && (
            <WhatIfRow
              result={secondaryWhatIf}
              uiLabel={recommendation.secondary.uiLabel}
              uiColor={recommendation.secondary.uiColor}
            />
          )}
        </View>
      )}

      <Text variant="caption" color={colors.text.tertiary}>
        Si cambió tu ahorro, actualizalo en Perfil.
      </Text>
    </View>
  );
}

const savStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.yellow + '10',
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     colors.yellow + '30',
    padding:         spacing[4],
    gap:             spacing[4],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  lossRow: {
    backgroundColor:   colors.bg.elevated,
    borderRadius:      6,
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
    gap:               3,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
});

// ─── Disclaimer ───────────────────────────────────────────────────────────────

function Disclaimer() {
  return (
    <View style={discStyles.container}>
      <Ionicons name="shield-checkmark-outline" size={12} color={colors.text.tertiary} />
      <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, lineHeight: 16 }}>
        Simulaciones educativas con rendimientos históricos aproximados.{' '}
        <Text variant="caption" color={colors.text.tertiary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
          No son asesoramiento financiero ni recomendación de inversión (CNV).
        </Text>
        {' '}Consultá a un asesor registrado antes de invertir.
        Rentabilidades pasadas no garantizan resultados futuros.
      </Text>
    </View>
  );
}

const discStyles = StyleSheet.create({
  container: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            spacing[2],
    paddingTop:     spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});

// ─── Componente principal ─────────────────────────────────────────────────────

interface OpportunityCostProps {
  userId:      string;
  monthsBack?: number;
}

interface FetchedData {
  categoryBreakdown: { categoryNameEs: string; categoryColor: string; amount: number }[];
  interestKeys:      string[];
  savingsAmount:     number | null;
  officialInflation: number;
  userProfile:       UserInvestmentProfile;
}

export function OpportunityCost({ userId, monthsBack = 3 }: OpportunityCostProps) {
  const [loading,  setLoading]  = useState(true);
  const [insights, setInsights] = useState<OpportunityInsights | null>(null);

  useEffect(() => { load(); }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAllData(userId, monthsBack);
      setInsights(buildOpportunityInsights(
        data.categoryBreakdown,
        data.interestKeys,
        data.savingsAmount,
        data.officialInflation,
        monthsBack,
        data.userProfile,
      ));
    } catch {
      setInsights(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="caption" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
          Calculando oportunidades...
        </Text>
      </View>
    );
  }

  const hasContent =
    insights &&
    (insights.categoryOpportunities.length > 0 || insights.savingsOpportunity !== null);

  if (!hasContent) return null;

  return (
    <View style={s.container}>
      <View style={s.titleRow}>
        <Text variant="label" color={colors.text.tertiary}>💡  ¿QUÉ PODRÍAS HABER HECHO CON ESA PLATA?</Text>
      </View>
      <Text variant="bodySmall" color={colors.text.secondary} style={{ lineHeight: 20 }}>
        Simulaciones de qué habría pasado si una parte de lo que gastaste fuera a rendimiento.
        Sin culpas — solo para ver las posibilidades.
      </Text>

      {insights.categoryOpportunities.length > 0 && (
        <View style={{ gap: spacing[4] }}>
          {insights.categoryOpportunities.map(opp => (
            <CategoryCard key={opp.categoryNameEs} opportunity={opp} monthsBack={monthsBack} />
          ))}
        </View>
      )}

      {insights.savingsOpportunity && (
        <SavingsCard opportunity={insights.savingsOpportunity} />
      )}

      <Disclaimer />
    </View>
  );
}

// ─── Fetch de datos ───────────────────────────────────────────────────────────

async function fetchAllData(userId: string, monthsBack: number): Promise<FetchedData> {
  const now      = new Date();
  const toDate   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const fromDate = new Date(toDate.getFullYear(), toDate.getMonth() - (monthsBack - 1), 1);
  const from     = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay  = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0).getDate();
  const to       = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

  const [expensesRes, interestsRes, profileRes, riskRes] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount, expense_categories ( name_es, color )')
      .eq('user_id', userId)
      .gte('date', from)
      .lte('date', to)
      .is('deleted_at', null),

    supabase
      .from('user_interests')
      .select('interest_key')
      .eq('user_id', userId),

    supabase
      .from('financial_profiles')
      .select('savings_amount')
      .eq('user_id', userId)
      .maybeSingle(),

    supabase
      .from('risk_profiles')
      .select('profile, answers')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  // Agrupar gastos por categoría
  const grouped: Record<string, { categoryNameEs: string; categoryColor: string; amount: number }> = {};
  for (const row of expensesRes.data ?? []) {
    const cat = (row as any).expense_categories;
    const key = cat?.name_es ?? 'Otros';
    if (!grouped[key]) {
      grouped[key] = { categoryNameEs: key, categoryColor: cat?.color ?? '#888888', amount: 0 };
    }
    grouped[key].amount += (row as any).amount ?? 0;
  }

  const interestKeys    = (interestsRes.data ?? []).map((r: any) => r.interest_key as string);
  const savingsAmount   = (profileRes.data as any)?.savings_amount ?? null;
  const officialInflation = getLatestIndecEntry().general;

  // Construir perfil de inversión desde risk_profiles
  const riskData = riskRes.data as any;
  const riskProfile: RiskProfile = riskData?.profile ?? 'conservative';
  const riskAnswers: Record<string, string> = riskData?.answers ?? {};

  const userProfile: UserInvestmentProfile = {
    riskProfile,
    horizon:           deriveHorizon(riskAnswers),
    interestKeys,
    officialInflation,
  };

  return {
    categoryBreakdown: Object.values(grouped).filter(c => c.amount > 0),
    interestKeys,
    savingsAmount,
    officialInflation,
    userProfile,
  };
}

const s = StyleSheet.create({
  container: {
    gap: spacing[5],
  },
  centered: {
    alignItems:      'center',
    paddingVertical: spacing[6],
  },
  titleRow: {
    marginBottom: -spacing[2],
  },
});
