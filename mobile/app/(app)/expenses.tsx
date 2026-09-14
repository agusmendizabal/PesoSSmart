import React, { useEffect, useMemo, useState } from 'react';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  View,
  ScrollView,
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { useSavingsStore } from '@/store/savingsStore';
import { InflationThermometer } from '@/components/InflationThermometer';
import { DecisionHistorySection, buildOpportunities } from '@/components/DecisionHistory';
import { fetchBudgetPlan, type BudgetPlan } from '@/lib/budgetPlan';
import { computeFinancialDiagnosis } from '@/lib/financialDiagnosis';
import {
  MONTH_NAMES, PALETTE, getCategoryColor, type CategoryRow, type MonthSummary,
  buildComparacion, buildAhorroSugerencias, buildPlanProximoMes, buildObjetivo,
  ResumenCard, CategoryBreakdown, CategoryDonut, HistoryComparisonCard,
  PlanProximoMesCard, ObjetivoCard, AdvisorCTA,
} from '@/components/ReportCards';

// ─── MonthSelector ────────────────────────────────────────────────────────────

const MONTH_NAMES_SHORT = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MAX_MONTHS_BACK   = 11;

function MonthSelector({
  selected,
  onSelect,
}: {
  selected: { month: number; year: number };
  onSelect: (month: number, year: number) => void;
}) {
  const now   = new Date();
  const isNow = selected.month === now.getMonth() + 1 && selected.year === now.getFullYear();

  // how many months back from today is this selection?
  const monthsBack = (now.getFullYear() - selected.year) * 12 + (now.getMonth() + 1 - selected.month);
  const canGoBack  = monthsBack < MAX_MONTHS_BACK;

  const goBack = () => {
    if (!canGoBack) return;
    if (selected.month === 1) onSelect(12, selected.year - 1);
    else onSelect(selected.month - 1, selected.year);
  };

  const goForward = () => {
    if (isNow) return;
    if (selected.month === 12) onSelect(1, selected.year + 1);
    else onSelect(selected.month + 1, selected.year);
  };

  const label = `${MONTH_NAMES_SHORT[selected.month - 1]} ${selected.year}`;

  return (
    <View style={msStyles.row}>
      <TouchableOpacity
        style={[msStyles.arrow, !canGoBack && msStyles.arrowDisabled]}
        onPress={goBack}
        disabled={!canGoBack}
        hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
      >
        <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.text.primary : colors.text.tertiary} />
      </TouchableOpacity>

      <Text style={msStyles.label}>{label}</Text>

      <TouchableOpacity
        style={[msStyles.arrow, isNow && msStyles.arrowDisabled]}
        onPress={goForward}
        disabled={isNow}
        hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
      >
        <Ionicons name="chevron-forward" size={20} color={isNow ? colors.text.tertiary : colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}

const msStyles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingVertical: spacing[2] },
  label:        { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: colors.text.primary, minWidth: 160, textAlign: 'center' },
  arrow:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, alignItems: 'center', justifyContent: 'center' },
  arrowDisabled:{ opacity: 0.35 },
});

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuthStore();
  const {
    expenses,
    categories,
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
    estimatedIncome,
    fetchExpenses,
    fetchCategories,
    fetchSubscriptionsAndProjection,
    filter,
    setFilter,
  } = useExpensesStore();

  const { fetchAll: loadSavings } = useSavingsStore();

  // ── Análisis ──
  const now = new Date();
  const validTabs = ['resumen', 'categorias', 'salud', 'oportunidades'] as const;
  const [reportTab, setReportTab] = useState<typeof validTabs[number]>(
    validTabs.includes(initialTab as any) ? (initialTab as typeof validTabs[number]) : 'resumen'
  );
  const [reportRows,      setReportRows]      = useState<CategoryRow[]>([]);
  const [reportTotal,     setReportTotal]     = useState(0);
  const [history,         setHistory]         = useState<MonthSummary[]>([]);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [inflationRate,   setInflationRate]   = useState(0);
  const [fciRate,         setFciRate]         = useState(0.03);
  const [pastOppData,     setPastOppData]     = useState<{ monthKey: string; disposable: number; categories: Record<string, number> }[]>([]);
  const [smartPlan,           setSmartPlan]           = useState<BudgetPlan | null>(null);
  const [movimientosVisible,  setMovimientosVisible]  = useState(false);
  const [scoreExpanded,       setScoreExpanded]       = useState(false);

  useEffect(() => {
    if (user?.id) fetchBudgetPlan(user.id).then(setSmartPlan);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchCategories();
      fetchSubscriptionsAndProjection(user.id);
    }
  }, [user?.id, filter]);

  const reportMonth    = filter.month ?? (now.getMonth() + 1);
  const reportYear     = filter.year  ?? now.getFullYear();
  const isCurrentMonth = reportMonth === now.getMonth() + 1 && reportYear === now.getFullYear();

  useEffect(() => {
    if (!user?.id) return;
    const rStart = `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`;
    const nm = reportMonth === 12 ? 1 : reportMonth + 1;
    const ny = reportMonth === 12 ? reportYear + 1 : reportYear;
    const rEnd = `${ny}-${String(nm).padStart(2, '0')}-01`;
    const oppStart = (() => {
      const d = new Date(reportYear, reportMonth - 4, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    setIsReportLoading(true);
    Promise.all([
      supabase.from('expenses').select('amount, category:expense_categories(id, name_es, color), classification').eq('user_id', user.id).is('deleted_at', null).not('category_id', 'is', null).gte('date', rStart).lt('date', rEnd),
      supabase.from('expenses').select('amount, date, classification').eq('user_id', user.id).is('deleted_at', null).gte('date', oppStart).lt('date', rStart),
      supabase.from('expenses').select('amount, date, classification, category:expense_categories(name_es)').eq('user_id', user.id).is('deleted_at', null).eq('classification', 'disposable').gte('date', oppStart).lt('date', rStart),
    ]).then(([mainRes, histRes, oppRes]) => {
      const map: Record<string, CategoryRow> = {};
      let sum = 0;
      for (const exp of mainRes.data ?? []) {
        const cat = (exp as any).category;
        const catId = cat?.id ?? 'none';
        if (!map[catId]) map[catId] = { id: catId, name: cat?.name_es ?? 'Sin categoría', color: getCategoryColor(cat?.name_es ?? 'otros', Object.keys(map).length), amount: 0, pct: 0 };
        map[catId].amount += (exp as any).amount;
        sum += (exp as any).amount;
      }
      setReportTotal(sum);
      setReportRows(Object.values(map).map(r => ({ ...r, pct: sum > 0 ? r.amount / sum : 0 })).sort((a, b) => b.amount - a.amount));

      const histMap: Record<string, MonthSummary> = {};
      for (const exp of (histRes.data ?? []) as any[]) {
        const key = exp.date.slice(0, 7);
        if (!histMap[key]) {
          const [y, m] = key.split('-').map(Number);
          histMap[key] = { monthKey: key, label: MONTH_NAMES[m - 1].slice(0, 3), total: 0, disposable: 0, necessary: 0, investable: 0 };
        }
        histMap[key].total += exp.amount;
        if (exp.classification === 'disposable') histMap[key].disposable += exp.amount;
        if (exp.classification === 'necessary')  histMap[key].necessary  += exp.amount;
        if (exp.classification === 'investable') histMap[key].investable += exp.amount;
      }
      setHistory(Object.values(histMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey)).slice(-3));

      const oppMap: Record<string, { monthKey: string; disposable: number; categories: Record<string, number> }> = {};
      for (const exp of (oppRes.data ?? []) as any[]) {
        const mk = exp.date.slice(0, 7);
        const catName = exp.category?.name_es ?? 'Prescindibles';
        if (!oppMap[mk]) oppMap[mk] = { monthKey: mk, disposable: 0, categories: {} };
        oppMap[mk].disposable += exp.amount;
        oppMap[mk].categories[catName] = (oppMap[mk].categories[catName] ?? 0) + exp.amount;
      }
      setPastOppData(Object.values(oppMap));

      (supabase as any).from('market_rates').select('instrument, rate_monthly').in('instrument', ['inflation', 'fci_mm']).then(({ data }: { data: { instrument: string; rate_monthly: number }[] | null }) => {
        if (!data) return;
        for (const row of data) {
          if (row.instrument === 'inflation') setInflationRate(Number(row.rate_monthly));
          if (row.instrument === 'fci_mm')   setFciRate(Number(row.rate_monthly));
        }
      });
    }).catch(err => console.error('[Gastos/Análisis]', err)).finally(() => setIsReportLoading(false));
  }, [user?.id, reportMonth, reportYear]);

  useEffect(() => { if (user?.id) loadSavings(user.id); }, [user?.id]);

  const displayTotal      = isCurrentMonth ? totalThisMonth : reportTotal;
  const displayNecessary  = 0;
  const displayDisposable = 0;
  const displayInvestable = 0;
  const displayIncome     = isCurrentMonth ? estimatedIncome : null;

  const comparacion      = useMemo(() => buildComparacion(history, displayTotal, displayDisposable), [history, displayTotal, displayDisposable]);
  const planItems        = useMemo(() => buildPlanProximoMes({ rows: reportRows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome, history }), [reportRows, displayDisposable, displayTotal, displayIncome, history]);
  const objetivo         = useMemo(() => buildObjetivo({ disposable: displayDisposable, total: displayTotal }), [displayDisposable, displayTotal]);

  // Category breakdown from already-fetched expenses (no extra DB call)
  const catBreakdown = useMemo<CategoryRow[]>(() => {
    const map: Record<string, CategoryRow> = {};
    let total = 0; let idx = 0;
    for (const e of expenses as any[]) {
      const catId   = e.category_id ?? 'none';
      const catName = e.category?.name_es ?? 'Sin categoría';
      if (!map[catId]) map[catId] = { id: catId, name: catName, color: getCategoryColor(catName, idx++), amount: 0, pct: 0 };
      map[catId].amount += e.amount;
      total += e.amount;
    }
    return Object.values(map).map(r => ({ ...r, pct: total > 0 ? r.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Top bar fijo ── */}
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Text variant="h4">Análisis</Text>
        </View>

        {/* Selector de mes */}
        <MonthSelector
          selected={{ month: filter.month ?? new Date().getMonth() + 1, year: filter.year ?? new Date().getFullYear() }}
          onSelect={(m, y) => setFilter({ month: m, year: y })}
        />
      </View>

        {/* ── Modal: Ver tus movimientos ── */}
        <Modal visible={movimientosVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMovimientosVisible(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg.primary }} edges={['top']}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
              <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 17, color: colors.text.primary }}>
                Movimientos {MONTH_NAMES_SHORT[reportMonth - 1]}
              </Text>
              <TouchableOpacity onPress={() => setMovimientosVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            {expenses.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] }}>
                <Ionicons name="receipt-outline" size={48} color={colors.text.tertiary} />
                <Text variant="body" color={colors.text.secondary} align="center">Sin movimientos este mes</Text>
              </View>
            ) : (
              <FlatList
                data={expenses as any[]}
                keyExtractor={item => item.id}
                contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[10], gap: spacing[2] }}
                renderItem={({ item }) => {
                  const catName = item.category?.name_es ?? 'Sin categoría';
                  const dateStr = new Date(item.date + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: colors.bg.card, paddingVertical: 12, paddingHorizontal: spacing[4], borderRadius: 12, borderWidth: 1, borderColor: colors.border.default }}>
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Text style={{ fontSize: 16 }}>{item.category?.icon ?? '💸'}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: colors.text.primary }} numberOfLines={1}>{item.description}</Text>
                        <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 11, color: colors.text.tertiary }}>{catName} · {dateStr}</Text>
                      </View>
                      <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: colors.text.primary }}>{formatCurrency(item.amount)}</Text>
                    </View>
                  );
                }}
              />
            )}
          </SafeAreaView>
        </Modal>

        <ScrollView
          style={styles.flatList}
          contentContainerStyle={styles.analysisList}
          showsVerticalScrollIndicator={false}
        >
          {/* Sub-tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.reportTabsScroll}
            contentContainerStyle={styles.reportTabsRow}
          >
            {(['resumen', 'categorias', 'salud', 'oportunidades'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.reportTabPill, reportTab === tab && styles.reportTabPillActive]}
                onPress={() => setReportTab(tab)}
                activeOpacity={0.75}
              >
                <Text style={[styles.reportTabText, reportTab === tab && styles.reportTabTextActive]}>
                  {tab === 'resumen' ? 'Resumen' : tab === 'categorias' ? 'Categorías' : tab === 'salud' ? 'Salud' : 'Oportunidades'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Aviso de precisión cuando hay gastos sin clasificar */}
          {(() => {
            const unclasCount = expenses.filter(e => e.category_id === null).length;
            if (unclasCount === 0) return null;
            return (
              <TouchableOpacity
                style={reportS.precisionNotice}
                onPress={() => setMovimientosVisible(true)}
                activeOpacity={0.75}
              >
                <Ionicons name="warning-outline" size={14} color={colors.yellow} />
                <Text style={reportS.precisionText}>
                  {unclasCount} gasto{unclasCount > 1 ? 's' : ''} sin categoría afectan la precisión
                </Text>
                <Text style={reportS.precisionCta}>Agregar categoría →</Text>
              </TouchableOpacity>
            );
          })()}

          {isReportLoading ? (
            <View style={{ height: 200, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : displayTotal === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing[10], gap: spacing[4] }}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.text.tertiary} />
              <Text variant="body" color={colors.text.secondary} align="center">
                Sin datos para analizar este mes.
              </Text>
            </View>
          ) : (
            <>
              {reportTab === 'resumen' && (() => {
                const donutRows  = isCurrentMonth ? catBreakdown : (reportRows.length > 0 ? reportRows : catBreakdown);
                const donutTotal = isCurrentMonth ? totalThisMonth : (reportTotal || totalThisMonth);
                return (
                  <>
                    {/* Ver movimientos chip */}
                    <TouchableOpacity
                      style={reportS.movimientosChip}
                      onPress={() => setMovimientosVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="list-outline" size={14} color={colors.primary} />
                      <Text style={reportS.movimientosChipText}>Ver tus movimientos del mes</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                    </TouchableOpacity>

                    {donutRows.length > 0 && donutTotal > 0 && (
                      <View style={reportS.donutCard}>
                        <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: 16 }}>DISTRIBUCIÓN POR CATEGORÍA</Text>
                        <CategoryDonut rows={donutRows} total={donutTotal} />
                      </View>
                    )}
                    <TouchableOpacity
                      style={reportS.heroCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/(app)/savings-plan' as any)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                        <Ionicons name="sparkles" size={14} color={colors.accent} />
                        <Text variant="label" color={colors.text.tertiary}>PLAN INTELIGENTE</Text>
                      </View>
                      {smartPlan && smartPlan.potentialSavings > 500 ? (
                        <>
                          <Text style={reportS.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
                            {formatCurrency(smartPlan.potentialSavings)}
                          </Text>
                          <Text variant="bodySmall" color={colors.text.secondary}>
                            Es lo que podrías liberar este mes según tu ritmo de gasto
                          </Text>
                        </>
                      ) : (
                        <Text variant="bodySmall" color={colors.text.secondary}>
                          Mirá cómo viene tu ritmo de gasto este mes, categoría por categoría
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[1] }}>
                        <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold', color: colors.primary }}>
                          Ver Plan Inteligente
                        </Text>
                        <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                      </View>
                    </TouchableOpacity>
                    <InflationThermometer userId={user!.id} year={reportYear} month={reportMonth} />
                    <AdvisorCTA context={`Informe de ${MONTH_NAMES[reportMonth - 1]} ${reportYear}. Gasté ${formatCurrency(displayTotal)}.`} />
                  </>
                );
              })()}

              {reportTab === 'categorias' && (() => {
                const catRows  = isCurrentMonth ? catBreakdown : (reportRows.length > 0 ? reportRows : catBreakdown);
                const catTotal = isCurrentMonth ? totalThisMonth : (reportTotal || totalThisMonth);
                return (
                  <>
                    {/* Total del mes — sin clasificación */}
                    <View style={reportS.simpleTotalCard}>
                      <Text variant="label" color={colors.text.tertiary}>TOTAL {MONTH_NAMES[reportMonth - 1].toUpperCase()}</Text>
                      <Text style={reportS.simpleTotalAmount}>{formatCurrency(catTotal)}</Text>
                      {displayIncome && displayIncome > 0 && catTotal > 0 && (
                        <Text variant="bodySmall" color={colors.text.secondary}>
                          {Math.round((catTotal / displayIncome) * 100)}% del ingreso estimado
                        </Text>
                      )}
                    </View>
                    {catRows.length > 0 && catTotal > 0 && (
                      <View style={reportS.donutCard}>
                        <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: 16 }}>DISTRIBUCIÓN POR CATEGORÍA</Text>
                        <CategoryDonut rows={catRows} total={catTotal} />
                      </View>
                    )}
                    <CategoryBreakdown rows={catRows} total={catTotal} />
                  </>
                );
              })()}

              {reportTab === 'salud' && (() => {
                const diagRows = reportRows.map(r => ({
                  id: r.id, name: r.name, color: r.color,
                  amount: r.amount, pct: r.pct,
                }));
                // history solo tiene meses ANTERIORES al reportado; agregamos el
                // mes actual para que el cálculo de tendencia sea idéntico al de home.
                const currentMonthKey = `${reportYear}-${String(reportMonth).padStart(2, '0')}`;
                const diagHistory = [
                  ...history.map(h => ({
                    monthKey: h.monthKey, label: h.label, total: h.total,
                    necessary: h.necessary, disposable: h.disposable, investable: h.investable,
                  })),
                  ...(history.every(h => h.monthKey !== currentMonthKey) ? [{
                    monthKey: currentMonthKey,
                    label: MONTH_NAMES[reportMonth - 1].slice(0, 3),
                    total: displayTotal,
                    necessary: displayNecessary ?? 0,
                    disposable: displayDisposable ?? 0,
                    investable: displayInvestable ?? 0,
                  }] : []),
                ].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
                const diag = displayTotal > 0 ? computeFinancialDiagnosis({
                  totalThisMonth:  displayTotal,
                  totalNecessary:  displayNecessary,
                  totalDisposable: displayDisposable,
                  totalInvestable: displayInvestable,
                  estimatedIncome: displayIncome,
                  history:         diagHistory,
                  rows:            diagRows,
                  inflationRate,
                  fciRate,
                  dayOfMonth:      new Date().getDate(),
                }) : null;
                const score      = diag?.healthScore ?? 0;
                const scoreLabel = diag?.healthLabel  ?? '—';
                const scoreColor = diag?.healthColor  ?? '#9B9790';
                const arc        = (score / 100) * 201;
                // penúltimo de diagHistory = mes anterior al actual
                const prevM   = diagHistory.length >= 2 ? diagHistory[diagHistory.length - 2] : null;
                const prevPct = prevM && prevM.total > 0 && displayTotal > 0
                  ? Math.round(((displayTotal - prevM.total) / prevM.total) * 100)
                  : null;
                return (
                  <View style={{ gap: 12 }}>
                    {/* Score card — tappable para ver desglose */}
                    <TouchableOpacity
                      style={[styles.healthCard]}
                      onPress={() => setScoreExpanded(prev => !prev)}
                      activeOpacity={0.85}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        {/* Circular gauge */}
                        <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
                          <Svg width={88} height={88}>
                            <SvgPath
                              d="M 12 66 A 33 33 0 1 1 76 66"
                              stroke="#E5E7EB" strokeWidth={8} fill="none"
                              strokeLinecap="round"
                            />
                            <SvgPath
                              d="M 12 66 A 33 33 0 1 1 76 66"
                              stroke={scoreColor} strokeWidth={8} fill="none"
                              strokeDasharray={`${arc} 201`}
                              strokeDashoffset={50} strokeLinecap="round"
                            />
                          </Svg>
                          <View style={{ position: 'absolute', alignItems: 'center' }}>
                            <Text style={{ fontFamily: 'Montserrat_800ExtraBold', fontSize: 22, color: scoreColor, lineHeight: 26 }}>{score}</Text>
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary, lineHeight: 13 }}>/100</Text>
                          </View>
                        </View>
                        {/* Info */}
                        <View style={{ flex: 1, gap: 6 }}>
                          <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: colors.text.primary }}>Tu salud financiera</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: scoreColor + '18', alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: scoreColor }} />
                            <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: scoreColor }}>{scoreLabel}</Text>
                          </View>
                          {prevPct !== null && (
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: colors.text.secondary, lineHeight: 16 }}>
                              {prevPct > 0 ? `Gastaste ${prevPct}% más que el mes pasado.` : prevPct < 0 ? `Gastaste ${Math.abs(prevPct)}% menos que el mes pasado.` : 'Igual que el mes pasado.'}
                            </Text>
                          )}
                        </View>
                        {prevPct !== null && (
                          <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: prevPct > 0 ? colors.red : colors.neon }}>
                            {prevPct > 0 ? '+' : ''}{prevPct}%
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: 10, marginTop: 4 }}>
                        <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: colors.text.secondary, flex: 1, lineHeight: 18 }}>
                          {score < 70 ? 'Hay oportunidades de mejora en tu gasto.' : '¡Vas por buen camino! Mantenés el control.'}
                        </Text>
                        <Ionicons name={scoreExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.text.tertiary} style={{ marginLeft: 8 }} />
                      </View>
                    </TouchableOpacity>
                    {/* Componentes del score — expandible */}
                    {diag && diag.components.length > 0 && scoreExpanded && (
                      <View style={styles.healthCard}>
                        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: colors.text.primary, marginBottom: 8 }}>Desglose del puntaje</Text>
                        {diag.components.map(c => (
                          <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.text.primary }}>{c.label}</Text>
                              <View style={{ height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, marginTop: 4 }}>
                                <View style={{ height: 4, width: `${Math.min(c.score, 100)}%` as any, backgroundColor: c.color, borderRadius: 2 }} />
                              </View>
                            </View>
                            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: c.color, minWidth: 28, textAlign: 'right' }}>{c.score}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {/* Acciones sugeridas */}
                    {diag && diag.actions.length > 0 && (
                      <View style={styles.healthCard}>
                        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: colors.text.primary, marginBottom: 8 }}>Qué podés mejorar</Text>
                        {diag.actions.slice(0, 3).map((a, i) => (
                          <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                            <Text style={{ fontSize: 14 }}>{a.icon}</Text>
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: colors.text.primary, flex: 1, lineHeight: 18 }}>{a.text}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}

              {reportTab === 'oportunidades' && (
                <>
                  <DecisionHistorySection opportunities={buildOpportunities(pastOppData)} />
                  <HistoryComparisonCard history={history} comparacion={comparacion} currentTotal={displayTotal} />
                  <PlanProximoMesCard items={planItems} />
                  {objetivo && <ObjetivoCard objetivo={objetivo} />}
                  <AdvisorCTA context={`Informe de ${MONTH_NAMES[reportMonth - 1]} ${reportYear}. Gasté ${formatCurrency(displayTotal)}.`} />
                </>
              )}
            </>
          )}
        </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.bg.primary },
  flatList: { flex: 1 },

  // ── Top bar fijo ──
  topBar: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[3],
    paddingBottom:     spacing[3],
    gap:               spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor:   colors.bg.primary,
  },
  topBarRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  screenshotBtn: {
    width:          36,
    height:         36,
    borderWidth:    1,
    borderColor:    colors.border.default,
    borderRadius:   18,
    alignItems:     'center',
    justifyContent: 'center',
  },

  // ── FAB ──
  fab: {
    position:        'absolute',
    bottom:          90,
    right:           20,
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: '#27AE60',
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     '#27AE60',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.3,
    shadowRadius:    12,
    elevation:       8,
  },

  // ── Summary card ──
  summaryTotal: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   24,
    lineHeight: 30,
    color:      colors.text.primary,
  },
  summaryCard: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[2],
    marginBottom:     spacing[2],
    paddingVertical:  spacing[3],
    paddingHorizontal: spacing[4],
    backgroundColor:  colors.bg.card,
    borderWidth:      1,
    borderColor:      colors.border.default,
    borderRadius:     16,
    gap:              spacing[2],
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.04,
    shadowRadius:     6,
    elevation:        2,
  },
  gmailExpiredBanner: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing[3],
    backgroundColor: colors.yellow + '12',
    borderWidth:     1,
    borderColor:     colors.yellow + '30',
    borderRadius:    10,
    padding:         spacing[3],
  },
  compositionBar: {
    flexDirection: 'row',
    height:        6,
    borderRadius:  3,
    overflow:      'hidden',
    gap:           2,
  },
  barSlice: { height: '100%', borderRadius: 3 },
  summaryMetrics: {
    flexDirection: 'row',
    gap:           spacing[4],
  },
  metricItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  metricDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  summaryBody: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            spacing[3],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  legendDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    flexShrink:   0,
  },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[3],
    gap: spacing[1],
  },
  searchRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[2],
    marginHorizontal:  layout.screenPadding,
    marginBottom:      spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
    borderWidth:       1,
    borderColor:       colors.border.default,
    backgroundColor:   colors.bg.elevated,
    borderRadius:      10,
  },
  searchInput: {
    flex:       1,
    color:      colors.text.primary,
    fontSize:   14,
    fontFamily: 'Montserrat_400Regular',
    paddingVertical: spacing[1],
  },
  filterChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A',
  },
  list: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: layout.tabBarHeight + spacing[6],
    gap: spacing[1],
  },
  empty: {
    paddingVertical: spacing[16],
    alignItems: 'center',
    gap: spacing[4],
  },
  // Day header — actúa como separador entre grupos de días
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[1],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  dayLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: colors.text.tertiary,
    textTransform: 'capitalize',
  },
  dayTotal: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12,
    color: colors.text.tertiary,
  },
  // Expense item — card con bordes redondeados
  expenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.bg.card,
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  expenseIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  expenseLeft:      { flex: 1, gap: 3 },
  expenseMeta:      { flexDirection: 'row', alignItems: 'center' },
  expenseRight:     { alignItems: 'flex-end', gap: 4 },
  expenseName: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 18,
  },
  expenseMetaText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: colors.text.tertiary,
    lineHeight: 16,
  },
  expenseAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 18,
  },
  // Amount block (add modal)
  amountBlock: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    padding: spacing[5],
    gap: spacing[1],
    alignItems: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  amountPrefix: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 32,
    color: colors.text.tertiary,
  },
  amountInput: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 40,
    color: colors.text.primary,
    minWidth: 80,
    textAlign: 'center',
  },
  subsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.yellow + '33',
    backgroundColor: colors.yellow + '0A',
  },
  subsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  subsContainer: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: colors.yellow + '33',
    backgroundColor: colors.bg.card,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  subsTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  // Modal
  modalScroll: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[6],
    gap: spacing[5],
    paddingBottom: spacing[12],
  },
  inputLabel: { marginBottom: spacing[2] },
  categoryList: { gap: spacing[2] },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  categoryGridItem: {
    width: '22%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 10,
  },
  categoryChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  categoryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A',
  },
  paymentList: { gap: spacing[2] },
  paymentChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  paymentChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },

  // Multi-moneda
  currencyRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  currencyChip: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  currencyChipActive: {
    borderColor: colors.neon,
    backgroundColor: colors.neon + '15',
  },
  dolarRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  dolarChip: {
    flex: 1,
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  dolarChipActive: {
    borderColor: colors.neon,
    backgroundColor: colors.neon,
  },
  fxPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
    paddingHorizontal: spacing[1],
  },
  classRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  classChip: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: spacing[2],
    borderWidth:     1,
    borderColor:     colors.border.default,
  },
  classChipActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '15',
  },
  shareBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    paddingVertical: spacing[3],
    borderWidth:     1,
    borderColor:     '#27AE6040',
    borderRadius:    8,
    backgroundColor: '#D1F7E3',
  },
  shareBtnText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 12,
    color: '#27AE60',
    letterSpacing: 0.4,
  },
  deleteBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    paddingVertical: spacing[3],
    borderWidth:     1,
    borderColor:     colors.red,
    borderRadius:    8,
  },
  sharedToggle: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[3],
    padding:         spacing[4],
    borderWidth:     1,
    borderColor:     colors.border.default,
    backgroundColor: colors.bg.elevated,
  },
  sharedToggleActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '11',
  },
  toggleDot: {
    width:           20,
    height:          20,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     colors.border.default,
    backgroundColor: colors.bg.primary,
  },
  toggleDotActive: {
    backgroundColor: colors.neon,
    borderColor:     colors.neon,
  },
  // Segmented control — Gastos / Análisis
  segControl: {
    flexDirection:   'row',
    backgroundColor: '#F5F1E9',
    borderRadius:    16,
    padding:         4,
    marginTop:       spacing[2],
  },
  segBtn: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: 10,
    borderRadius:    12,
  },
  segBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.08,
    shadowRadius:    4,
    elevation:       2,
  },
  segBtnText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   14,
    color:      '#6D6A63',
  },
  segBtnTextActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color:      '#1C1C1C',
  },
  // Analysis scroll container
  analysisList: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[4],
    paddingBottom:     layout.tabBarHeight + spacing[8],
    gap:               spacing[4],
  },
  // Analysis sub-tabs
  reportTabsScroll: {
    marginHorizontal: -layout.screenPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  reportTabsRow: {
    flexDirection:     'row',
    paddingHorizontal: layout.screenPadding,
  },
  reportTabPill: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom:      -1,
  },
  healthCard: {
    backgroundColor: colors.bg.card,
    borderRadius:    16,
    padding:         16,
    borderWidth:     1,
    borderColor:     colors.border.default,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.05,
    shadowRadius:    4,
    elevation:       2,
  },
  reportTabPillActive: {
    borderBottomColor: colors.primary,
  },
  reportTabText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   13,
    color:      colors.text.tertiary,
  },
  reportTabTextActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color:      colors.primary,
  },
});

const reportS = StyleSheet.create({
  precisionNotice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.yellow + '15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.yellow + '35',
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
  },
  precisionText: {
    fontFamily: 'Montserrat_400Regular', fontSize: 11, color: colors.text.secondary, flex: 1,
  },
  precisionCta: {
    fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: colors.yellow, flexShrink: 0,
  },
  heroCard: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[4],
    gap:             spacing[3],
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       3,
  },
  heroAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   34,
    lineHeight: 40,
    color:      colors.text.primary,
  },
  investRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[3],
    paddingTop:     spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  investDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  donutCard: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[5],
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       3,
  },
  movimientosChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[2],
    alignSelf:         'flex-start',
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[2],
    borderWidth:       1,
    borderColor:       colors.primary + '55',
    borderRadius:      20,
    backgroundColor:   colors.primary + '10',
  },
  movimientosChipText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   13,
    color:      colors.primary,
  },
  simpleTotalCard: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[5],
    gap:             spacing[1],
  },
  simpleTotalAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   32,
    lineHeight: 38,
    color:      colors.text.primary,
  },
});

const scModalS = StyleSheet.create({
  // Modal header
  topRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[1] },
  closeBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  titleBlock:     { paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[4], gap: spacing[2] },
  titleLarge:     { fontFamily: 'Montserrat_800ExtraBold', fontSize: 30, color: '#1C1C1C', letterSpacing: -0.8 },
  titleUnderline: { width: 40, height: 3, borderRadius: 2, backgroundColor: '#27AE60', marginTop: -2 },
  countBadge:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#D1F7E3', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#A8D5C2' },
  countDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F59E0B' },
  countText:      { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#1F8C4F', letterSpacing: 0.4 },
  descText:       { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#6D6A63', lineHeight: 22 },

  // Section header (for manual unclassified, if both types exist)
  sectionHeader: { paddingTop: spacing[2] },
  sectionTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },

  // Cards (manually-added unclassified expenses)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#1C1C1C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E8E2D9',
  },
  cardBody:     { padding: 14, gap: 10 },
  cardMain:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle:   { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  cardInfo:     { flex: 1, gap: 3 },
  merchantName: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C', letterSpacing: -0.2 },
  dateLbl:      { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' },
  cardRight:    { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  amount:       { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: '#1C1C1C', letterSpacing: -0.4 },
  clasificarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#D1F7E3', borderWidth: 1.5, borderColor: '#27AE60', borderRadius: 12 },
  clasificarText:{ fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#27AE60' },

  // Progress footer
  progressCard:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, shadowColor: '#27AE60', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2, borderWidth: 1, borderColor: '#D1FAE5', marginTop: spacing[2] },
  progressIconCircle:{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },
  progressSub:       { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 17 },
  progressCircle:    { width: 48, height: 48, borderRadius: 24, backgroundColor: '#D1F7E3', borderWidth: 2, borderColor: '#A8D5C2', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressPct:       { fontFamily: 'Montserrat_800ExtraBold', fontSize: 13, color: '#27AE60' },

  // Empty state
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] },
  emptyIconCircle:{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#27AE60' + '14', alignItems: 'center', justifyContent: 'center' },
  emptyTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C' },
  emptySub:       { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#9B9790', textAlign: 'center' },
});

// ─── Summary card styles ────────────────────────────────────────────────────────
const smS = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[2],
    marginBottom:     spacing[2],
    paddingVertical:  14,
    paddingHorizontal: 16,
    backgroundColor:  '#FFFFFF',
    borderRadius:     20,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.05,
    shadowRadius:     12,
    elevation:        2,
  },
  body: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  left: {
    flex: 65,
    gap:  3,
  },
  right: {
    flex:           35,
    alignItems:     'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   12,
    color:      '#9B9790',
    lineHeight: 16,
  },
  amount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   28,
    lineHeight: 34,
    color:      '#1C1C1C',
  },
  varRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
  },
  varIcon: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   10,
    lineHeight: 14,
  },
  varText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   11,
    lineHeight: 14,
  },
  metricList: {
    gap:       3,
    marginTop: 3,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    flexShrink:   0,
  },
  metricLabel: {
    flex:       1,
    fontFamily: 'Montserrat_400Regular',
    fontSize:   12,
    color:      '#6D6A63',
    lineHeight: 16,
  },
  metricAmount: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   12,
    color:      '#1C1C1C',
    lineHeight: 16,
    minWidth:   60,
    textAlign:  'right',
  },
  metricPct: {
    fontFamily: 'Montserrat_400Regular',
    fontSize:   11,
    color:      '#9B9790',
    lineHeight: 16,
    minWidth:   26,
    textAlign:  'right',
  },
  donutEmpty: {
    width:        96,
    height:       96,
    borderRadius: 48,
    backgroundColor: '#F0F0F0',
  },
});

// ─── Clasificar gasto modal styles (light theme) ─────────────────────────────

const clsModal = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 22 },

  // AI banner
  aiBanner: { gap: 8 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EEF2FF', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start',
  },
  aiBadgeText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#4F46E5' },
  aiSubtitle: {
    fontFamily: 'Montserrat_400Regular', fontSize: 13,
    color: '#6D6A63', lineHeight: 19,
  },

  // Expense card
  expenseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22,
    paddingVertical: 18, paddingHorizontal: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 14, elevation: 4,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  expenseIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FAFAF7',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    flexShrink: 0,
  },
  expenseName: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#27AE60' },
  expenseMeta: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9B9790', lineHeight: 17 },
  expenseAmount: { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C', flexShrink: 0 },

  sectionTitle: { fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: '#1C1C1C' },
  descInput: {
    backgroundColor: '#FAFAF7',
    borderWidth: 1,
    borderColor: '#E8E2D9',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#1C1C1C',
  },

  // Type buttons
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5,
  },
  typeBtnInactive: { backgroundColor: '#FFFFFF', borderColor: '#E8E2D9' },
  typeBtnLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12 },

  // Best match card
  matchCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  matchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  matchRowBorder: { borderBottomWidth: 1, borderBottomColor: '#FAFAF7' },
  matchRowActive: { backgroundColor: '#D1F7E3' },
  matchRank: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#9B9790', width: 16 },
  matchName: { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },
  matchPct: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#27AE60' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F1E9', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: {
    flex: 1, fontFamily: 'Montserrat_400Regular',
    fontSize: 14, color: '#1C1C1C', paddingVertical: 0,
  },

  // Category list
  catList: {
    backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 13, paddingHorizontal: 16,
  },
  catRowBorder: { borderBottomWidth: 1, borderBottomColor: '#FAFAF7' },
  catRowActive: { backgroundColor: '#D1F7E3' },
  catIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
  },
  catName: { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 12,
    gap: 8, backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#F5F1E9',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 4,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#27AE60', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#27AE60', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 12, elevation: 5,
  },
  ctaBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#FFFFFF', letterSpacing: 0.2 },
  deleteBtnRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 8,
  },
  deleteBtnText: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#EF4444' },
});
