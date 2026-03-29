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

// Inflación INDEC por categoría (% mensual estimado — se puede actualizar con API)
// Fuente: IPC Nacional, promedio 2024-2025
const INDEC_CATEGORY_INFLATION: Record<string, { label: string; rate: number }> = {
  groceries:       { label: 'Alimentos',        rate: 0.029 },
  food_dining:     { label: 'Restaurantes',      rate: 0.028 },
  transport:       { label: 'Transporte',        rate: 0.035 },
  health:          { label: 'Salud',             rate: 0.032 },
  entertainment:   { label: 'Recreación',        rate: 0.025 },
  clothing:        { label: 'Indumentaria',      rate: 0.022 },
  education:       { label: 'Educación',         rate: 0.034 },
  home:            { label: 'Vivienda',          rate: 0.031 },
  technology:      { label: 'Tecnología',        rate: 0.024 },
  subscriptions:   { label: 'Servicios digitales', rate: 0.020 },
  travel:          { label: 'Viajes',            rate: 0.030 },
  other:           { label: 'Otros',             rate: 0.027 },
};

const INDEC_GENERAL = 0.029; // 2.9% promedio mensual

export default function ReportsScreen() {
  const { user } = useAuthStore();
  const {
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
  } = useExpensesStore();
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [categoryData, setCategoryData] = useState<{
    category: string;
    currentAmount: number;
    prevAmount: number;
    growthRate: number;
    indecRate: number;
    label: string;
  }[]>([]);

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  useEffect(() => {
    if (user?.id) {
      loadReport();
      loadCategoryComparison();
    }
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

  const loadCategoryComparison = async () => {
    if (!user?.id) return;
    try {
      const currentStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      const currentEnd = `${currentMonth === 12 ? currentYear + 1 : currentYear}-${String(currentMonth === 12 ? 1 : currentMonth + 1).padStart(2, '0')}-01`;
      const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const prevEnd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

      const [{ data: currentExpenses }, { data: prevExpenses }] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category:expense_categories(key)')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', currentStart)
          .lt('date', currentEnd),
        supabase
          .from('expenses')
          .select('amount, category:expense_categories(key)')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', prevStart)
          .lt('date', prevEnd),
      ]);

      const sumByCategory = (items: any[]) => {
        const map: Record<string, number> = {};
        for (const e of items ?? []) {
          const key = (e.category as any)?.key ?? 'other';
          map[key] = (map[key] ?? 0) + e.amount;
        }
        return map;
      };

      const current = sumByCategory(currentExpenses ?? []);
      const prev = sumByCategory(prevExpenses ?? []);

      const allKeys = new Set([...Object.keys(current), ...Object.keys(prev)]);
      const rows = [];
      for (const key of allKeys) {
        const cur = current[key] ?? 0;
        const pre = prev[key] ?? 0;
        if (pre === 0 || cur === 0) continue;
        const growthRate = (cur - pre) / pre;
        const indecInfo = INDEC_CATEGORY_INFLATION[key] ?? INDEC_CATEGORY_INFLATION.other;
        rows.push({
          category: key,
          currentAmount: cur,
          prevAmount: pre,
          growthRate,
          indecRate: indecInfo.rate,
          label: indecInfo.label,
        });
      }
      rows.sort((a, b) => b.growthRate - a.growthRate);
      setCategoryData(rows.slice(0, 5));
    } catch {
      // silencioso
    }
  };

  const necessaryPct = totalThisMonth > 0 ? totalNecessary / totalThisMonth : 0;
  const disposablePct = totalThisMonth > 0 ? totalDisposable / totalThisMonth : 0;
  const investablePct = totalThisMonth > 0 ? totalInvestable / totalThisMonth : 0;

  // Inflación personal ponderada
  const personalInflation = categoryData.length > 0
    ? categoryData.reduce((sum, c) => sum + c.growthRate * (c.currentAmount / totalThisMonth), 0)
    : null;

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
          <View style={styles.legend}>
            <LegendItem color="#82b1ff" label="Necesario" amount={totalNecessary} pct={necessaryPct} />
            <LegendItem color={colors.red} label="Prescindible" amount={totalDisposable} pct={disposablePct} />
            <LegendItem color={colors.neon} label="Invertible" amount={totalInvestable} pct={investablePct} />
          </View>
        </Card>

        {/* Radar de inflación personal */}
        <Card style={styles.inflationRadarCard}>
          <View style={styles.inflationRadarHeader}>
            <Ionicons name="pulse-outline" size={18} color={colors.yellow} />
            <Text variant="label" color={colors.text.secondary}>RADAR DE INFLACIÓN PERSONAL</Text>
          </View>

          {categoryData.length > 0 ? (
            <>
              {personalInflation != null && (
                <View style={styles.inflationSummary}>
                  <View style={styles.inflationSummaryItem}>
                    <Text variant="caption" color={colors.text.secondary}>TU INFLACIÓN</Text>
                    <Text
                      variant="number"
                      color={personalInflation > INDEC_GENERAL ? colors.red : colors.neon}
                    >
                      {formatPercent(personalInflation)}
                    </Text>
                  </View>
                  <View style={styles.inflationSummaryDivider} />
                  <View style={styles.inflationSummaryItem}>
                    <Text variant="caption" color={colors.text.secondary}>INDEC GENERAL</Text>
                    <Text variant="number" color={colors.text.primary}>
                      {formatPercent(INDEC_GENERAL)}
                    </Text>
                  </View>
                  <View style={styles.inflationSummaryDivider} />
                  <View style={styles.inflationSummaryItem}>
                    <Text variant="caption" color={colors.text.secondary}>DIFERENCIA</Text>
                    <Text
                      variant="number"
                      color={personalInflation > INDEC_GENERAL ? colors.red : colors.neon}
                    >
                      {personalInflation > INDEC_GENERAL ? '+' : ''}
                      {formatPercent(personalInflation - INDEC_GENERAL)}
                    </Text>
                  </View>
                </View>
              )}
              <Text variant="caption" color={colors.text.secondary} style={styles.inflationSubtitle}>
                TUS CATEGORÍAS VS INDEC
              </Text>
              {categoryData.map((row) => (
                <View key={row.category} style={styles.inflationRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySmall" color={colors.text.primary}>{row.label}</Text>
                    <Text variant="caption" color={colors.text.secondary}>
                      {formatCurrency(row.prevAmount)} → {formatCurrency(row.currentAmount)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text
                      variant="labelMd"
                      color={row.growthRate > row.indecRate ? colors.red : colors.neon}
                    >
                      {row.growthRate > 0 ? '+' : ''}{formatPercent(row.growthRate)}
                    </Text>
                    <Text variant="caption" color={colors.text.tertiary}>
                      INDEC {formatPercent(row.indecRate)}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={styles.inflationSummary}>
                <View style={styles.inflationSummaryItem}>
                  <Text variant="caption" color={colors.text.secondary}>TU INFLACIÓN</Text>
                  <Text variant="number" color={colors.text.tertiary}>—</Text>
                </View>
                <View style={styles.inflationSummaryDivider} />
                <View style={styles.inflationSummaryItem}>
                  <Text variant="caption" color={colors.text.secondary}>INDEC GENERAL</Text>
                  <Text variant="number" color={colors.text.primary}>
                    {formatPercent(INDEC_GENERAL)}
                  </Text>
                </View>
                <View style={styles.inflationSummaryDivider} />
                <View style={styles.inflationSummaryItem}>
                  <Text variant="caption" color={colors.text.secondary}>DIFERENCIA</Text>
                  <Text variant="number" color={colors.text.tertiary}>—</Text>
                </View>
              </View>
              <Text variant="caption" color={colors.text.secondary} style={styles.inflationSubtitle}>
                INFLACIÓN INDEC POR CATEGORÍA
              </Text>
              {Object.entries(INDEC_CATEGORY_INFLATION).slice(0, 5).map(([key, val]) => (
                <View key={key} style={styles.inflationRow}>
                  <Text variant="bodySmall" color={colors.text.secondary} style={{ flex: 1 }}>
                    {val.label}
                  </Text>
                  <Text variant="labelMd" color={colors.text.primary}>
                    {formatPercent(val.rate)}
                  </Text>
                </View>
              ))}
              <View style={styles.emptySection}>
                <Text variant="caption" color={colors.text.tertiary} align="center">
                  Cargá gastos en 2 meses para ver tu inflación personal vs el INDEC.
                </Text>
              </View>
            </>
          )}

          <Text variant="caption" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
            Tasas INDEC estimadas por categoría. Datos actualizados mensualmente.
          </Text>
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
    overflow: 'hidden',
    gap: 2,
  },
  bar: { height: '100%' },
  legend: { gap: spacing[3] },
  // Inflation radar
  inflationRadarCard: { padding: spacing[5], gap: spacing[3] },
  inflationRadarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  inflationSummary: {
    flexDirection: 'row',
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border.subtle,
  },
  inflationSummaryItem: { flex: 1, gap: spacing[1] },
  inflationSummaryDivider: {
    width: 1,
    backgroundColor: colors.border.subtle,
    marginHorizontal: spacing[2],
  },
  inflationSubtitle: { marginTop: spacing[1] },
  inflationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
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
  emptySection: {
    alignItems: 'center',
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  simulatorCard: { padding: spacing[5] },
  simulatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
});
