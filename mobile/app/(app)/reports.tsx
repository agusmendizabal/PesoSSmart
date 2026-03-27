import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, PressableCard } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthName, formatPercent } from '@/utils/format';
import type { MonthlyReport } from '@/types';

export default function ReportsScreen() {
  const { user } = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable } = useExpensesStore();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  useEffect(() => {
    if (user?.id) loadReport();
  }, [user?.id]);

  const loadReport = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('monthly_reports')
        .select('*')
        .eq('user_id', user.id)
        .eq('year', currentYear)
        .eq('month', currentMonth)
        .single();
      setReport(data);
    } finally {
      setIsLoading(false);
    }
  };

  const necessaryPct = totalThisMonth > 0 ? totalNecessary / totalThisMonth : 0;
  const disposablePct = totalThisMonth > 0 ? totalDisposable / totalThisMonth : 0;
  const investablePct = totalThisMonth > 0 ? totalInvestable / totalThisMonth : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="h4">Informe mensual</Text>
          <Text variant="label" color={colors.text.secondary}>
            {getMonthName(currentMonth).toUpperCase()} {currentYear}
          </Text>
        </View>

        {/* Total del mes */}
        <Card style={styles.totalCard}>
          <Text variant="label" color={colors.text.secondary}>GASTASTE EN TOTAL</Text>
          <Text variant="numberLg" color={colors.text.primary}>{formatCurrency(totalThisMonth)}</Text>
          {report?.previous_month_total && (
            <View style={styles.comparisonRow}>
              <Ionicons
                name={totalThisMonth > report.previous_month_total ? 'trending-up' : 'trending-down'}
                size={16}
                color={totalThisMonth > report.previous_month_total ? colors.red : colors.neon}
              />
              <Text
                variant="caption"
                color={totalThisMonth > report.previous_month_total ? colors.red : colors.neon}
              >
                {totalThisMonth > report.previous_month_total ? '+' : ''}
                {formatCurrency(totalThisMonth - report.previous_month_total)} vs mes anterior
              </Text>
            </View>
          )}
        </Card>

        {/* Breakdown */}
        <Card style={styles.breakdownCard}>
          <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[4] }}>
            COMPOSICIÓN DE GASTOS
          </Text>

          {/* Barra visual */}
          <View style={styles.barContainer}>
            {totalNecessary > 0 && (
              <View style={[styles.bar, { flex: necessaryPct, backgroundColor: '#82b1ff' }]} />
            )}
            {totalDisposable > 0 && (
              <View style={[styles.bar, { flex: disposablePct, backgroundColor: colors.red }]} />
            )}
            {totalInvestable > 0 && (
              <View style={[styles.bar, { flex: investablePct, backgroundColor: colors.neon }]} />
            )}
          </View>

          {/* Leyenda */}
          <View style={styles.legend}>
            <LegendItem
              color="#82b1ff"
              label="Necesario"
              amount={totalNecessary}
              pct={necessaryPct}
            />
            <LegendItem
              color={colors.red}
              label="Prescindible"
              amount={totalDisposable}
              pct={disposablePct}
            />
            <LegendItem
              color={colors.neon}
              label="Invertible"
              amount={totalInvestable}
              pct={investablePct}
            />
          </View>
        </Card>

        {/* Insights de IA */}
        {report?.ai_insights && (
          <Card style={styles.insightsCard}>
            <View style={styles.insightsHeader}>
              <Ionicons name="bulb-outline" size={20} color={colors.yellow} />
              <Text variant="label" color={colors.text.secondary}>HALLAZGOS DEL MES</Text>
            </View>
            {(report.ai_insights as any).findings?.map((finding: string, i: number) => (
              <View key={i} style={styles.insightItem}>
                <Text variant="caption" color={colors.neon}>→</Text>
                <Text variant="bodySmall" color={colors.text.secondary} style={{ flex: 1 }}>
                  {finding}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Simulador promo */}
        <PressableCard variant="neon" style={styles.simulatorCard}>
          <View style={styles.simulatorRow}>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle" color={colors.neon}>Simulador de inversión</Text>
              <Text variant="bodySmall" color={colors.text.secondary}>
                ¿Qué hubiera pasado si esos {formatCurrency(totalInvestable)} los invertías?
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.neon} />
          </View>
        </PressableCard>

        {/* VS Inflación */}
        {report?.inflation_rate && (
          <Card style={styles.inflationCard}>
            <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[2] }}>
              TU PLATA VS LA INFLACIÓN
            </Text>
            <View style={styles.inflationRow}>
              <View>
                <Text variant="caption" color={colors.text.secondary}>INFLACIÓN DEL MES</Text>
                <Text variant="number" color={colors.red}>
                  +{formatPercent(report.inflation_rate / 100)}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={colors.text.tertiary} />
              <View>
                <Text variant="caption" color={colors.text.secondary}>TUS GASTOS AJUSTADOS</Text>
                <Text variant="number" color={colors.text.primary}>
                  {report.inflation_adjusted_comparison
                    ? formatCurrency(report.inflation_adjusted_comparison)
                    : '—'}
                </Text>
              </View>
            </View>
            <Text variant="caption" color={colors.text.tertiary} style={{ marginTop: spacing[3] }}>
              Con {formatPercent(report.inflation_rate / 100)} de inflación, tu plata parada pierde poder.
              Invertir es la única forma de no perder.
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LegendItem({
  color,
  label,
  amount,
  pct,
}: {
  color: string;
  label: string;
  amount: number;
  pct: number;
}) {
  return (
    <View style={legendStyles.item}>
      <View style={[legendStyles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" color={colors.text.primary}>{label}</Text>
        <Text variant="caption" color={colors.text.secondary}>{formatCurrency(amount)}</Text>
      </View>
      <Text variant="labelMd" color={color}>{formatPercent(pct)}</Text>
    </View>
  );
}

const legendStyles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  dot: {
    width: 10,
    height: 10,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[4],
    gap: spacing[4],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  totalCard: { padding: spacing[5], gap: spacing[2] },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  breakdownCard: { padding: spacing[5], gap: spacing[4] },
  barContainer: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 0,
    overflow: 'hidden',
    gap: 2,
  },
  bar: { height: '100%' },
  legend: { gap: spacing[3] },
  insightsCard: { padding: spacing[5], gap: spacing[3] },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  insightItem: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
  },
  simulatorCard: { padding: spacing[5] },
  simulatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  inflationCard: { padding: spacing[5], gap: spacing[3] },
  inflationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
});
