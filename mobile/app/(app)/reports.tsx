/**
 * ReportsScreen — "Informe"
 *
 * Bloques: Estado del mes · Dato clave · Resumen ·
 *          Termómetro · Distribución · Comparación histórica ·
 *          Dinero recuperable · Plan próximo mes ·
 *          Objetivo automático · CTA Asesor IA
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { InflationThermometer } from '@/components/InflationThermometer';

import {
  MONTH_NAMES,
  PALETTE,
  type CategoryRow,
  type MonthSummary,
  computeMonthStatus,
  buildKeyInsight,
  buildComparacion,
  buildAhorroSugerencias,
  buildPlanProximoMes,
  buildObjetivo,
  MonthStatusBanner,
  KeyInsightCard,
  ResumenCard,
  CategoryBreakdown,
  HistoryComparisonCard,
  DineroRecuperableCard,
  PlanProximoMesCard,
  ObjetivoCard,
  AdvisorCTA,
} from '@/components/ReportCards';

// ─── MonthSelector ────────────────────────────────────────────────────────────

function MonthSelector({ month, year, onPrev, onNext, disableNext }: {
  month: number; year: number; onPrev: () => void; onNext: () => void; disableNext: boolean;
}) {
  return (
    <View style={msStyles.row}>
      <TouchableOpacity style={msStyles.btn} onPress={onPrev}>
        <Ionicons name="chevron-back" size={20} color={colors.text.primary} />
      </TouchableOpacity>
      <Text variant="subtitle" color={colors.text.primary}>{MONTH_NAMES[month - 1]} {year}</Text>
      <TouchableOpacity style={[msStyles.btn, disableNext && { opacity: 0.3 }]} onPress={onNext} disabled={disableNext}>
        <Ionicons name="chevron-forward" size={20} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
const msStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border.subtle },
  btn: { padding: spacing[2] },
});

// ─── Screen principal ─────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { user } = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome } = useExpensesStore();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [rows,  setRows]  = useState<CategoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<MonthSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const { startDate, endDate } = useMemo(() => {
    const s  = `${year}-${String(month).padStart(2, '0')}-01`;
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    const e  = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { startDate: s, endDate: e };
  }, [month, year]);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const [mainRes, histRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category:expense_categories(id, name_es, color), classification')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', startDate)
          .lt('date', endDate),
        supabase
          .from('expenses')
          .select('amount, date, classification')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', (() => {
            const d = new Date(year, month - 4, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
          })())
          .lt('date', startDate),
      ]);

      const map: Record<string, CategoryRow> = {};
      let sum = 0;
      for (const exp of mainRes.data ?? []) {
        const cat   = (exp as any).category;
        const catId = cat?.id ?? 'none';
        if (!map[catId]) {
          map[catId] = { id: catId, name: cat?.name_es ?? 'Sin categoría', color: cat?.color ?? PALETTE[Object.keys(map).length % PALETTE.length], amount: 0, pct: 0 };
        }
        map[catId].amount += (exp as any).amount;
        sum += (exp as any).amount;
      }
      const result = Object.values(map).map(r => ({ ...r, pct: sum > 0 ? r.amount / sum : 0 })).sort((a, b) => b.amount - a.amount);
      setTotal(sum);
      setRows(result);

      const histMap: Record<string, MonthSummary> = {};
      for (const exp of histRes.data ?? []) {
        const key = (exp.date as string).slice(0, 7);
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
    } catch (err) {
      console.error('[Informe] loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (isCurrentMonth) return; if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const displayTotal      = isCurrentMonth ? totalThisMonth  : total;
  const displayNecessary  = isCurrentMonth ? totalNecessary  : 0;
  const displayDisposable = isCurrentMonth ? totalDisposable : 0;
  const displayInvestable = isCurrentMonth ? totalInvestable : 0;
  const displayIncome     = isCurrentMonth ? estimatedIncome : null;

  const statusData = useMemo(() => computeMonthStatus({
    total: displayTotal, disposable: displayDisposable, estimatedIncome: displayIncome,
  }), [displayTotal, displayDisposable, displayIncome]);

  const keyInsight = useMemo(() => buildKeyInsight({
    total: displayTotal, disposable: displayDisposable, estimatedIncome: displayIncome, rows, history,
  }), [displayTotal, displayDisposable, displayIncome, rows, history]);

  const comparacion = useMemo(() => buildComparacion(history, displayTotal, displayDisposable),
    [history, displayTotal, displayDisposable]);

  const ahorroSugerencias = useMemo(() => buildAhorroSugerencias({
    rows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome,
  }), [rows, displayDisposable, displayTotal, displayIncome]);

  const planItems = useMemo(() => buildPlanProximoMes({
    rows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome, history,
  }), [rows, displayDisposable, displayTotal, displayIncome, history]);

  const objetivo = useMemo(() => buildObjetivo({ disposable: displayDisposable, total: displayTotal }),
    [displayDisposable, displayTotal]);

  const advisorContext = useMemo(() => {
    const totalSaving = ahorroSugerencias.reduce((s, sg) => s + sg.saving, 0);
    return [
      `Informe de ${MONTH_NAMES[month - 1]} ${year}.`,
      `Gasté ${formatCurrency(displayTotal)}.`,
      `Estado del mes: ${statusData.label}.`,
      displayDisposable > 0 ? `Tengo ${formatCurrency(displayDisposable)} en prescindibles.` : '',
      displayIncome ? `Eso es el ${Math.round((displayTotal / displayIncome) * 100)}% de mi ingreso.` : '',
      rows[0] ? `Mi categoría más alta: "${rows[0].name}" (${Math.round(rows[0].pct * 100)}%).` : '',
      comparacion.vsPrev ? `Cambio vs mes pasado: ${comparacion.vsPrev.changePct > 0 ? '+' : ''}${comparacion.vsPrev.changePct}%.` : '',
      totalSaving > 0 ? `Podría ahorrar ${formatCurrency(totalSaving)}/mes.` : '',
      '¿Qué me recomendás hacer el próximo mes?',
    ].filter(Boolean).join(' ');
  }, [month, year, displayTotal, statusData, displayDisposable, displayIncome, rows, comparacion, ahorroSugerencias]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text variant="h4">Informe</Text>

        <MonthSelector month={month} year={year} onPrev={prevMonth} onNext={nextMonth} disableNext={isCurrentMonth} />

        {isLoading ? (
          <View style={s.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : displayTotal === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="bar-chart-outline" size={40} color={colors.text.tertiary} />
            </View>
            <Text variant="subtitle" color={colors.text.primary} align="center">
              Sin datos para {MONTH_NAMES[month - 1]} {year}
            </Text>
            <Text variant="body" color={colors.text.secondary} align="center" style={{ lineHeight: 22 }}>
              Cargá gastos para ver tu informe, estado del mes y oportunidades de ahorro.
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(app)/expenses')} activeOpacity={0.8}>
              <Ionicons name="add" size={16} color={colors.black} />
              <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: colors.black }}>
                Ir a cargar gastos
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <MonthStatusBanner data={statusData} />
            {keyInsight && <KeyInsightCard insight={keyInsight} />}
            <ResumenCard
              total={displayTotal} necessary={displayNecessary}
              disposable={displayDisposable} investable={displayInvestable}
              estimatedIncome={displayIncome}
            />
            <Card style={s.section}>
              <InflationThermometer userId={user!.id} year={year} month={month} />
            </Card>
            <CategoryBreakdown rows={rows} total={total || displayTotal} />
            <HistoryComparisonCard history={history} comparacion={comparacion} currentTotal={displayTotal} />
            <DineroRecuperableCard sugerencias={ahorroSugerencias} month={month} year={year} />
            <PlanProximoMesCard items={planItems} />
            {objetivo && <ObjetivoCard objetivo={objetivo} />}
            <AdvisorCTA context={advisorContext} />
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg.primary },
  scroll:       { paddingHorizontal: layout.screenPadding, paddingTop: spacing[4], paddingBottom: layout.tabBarHeight + spacing[8], gap: spacing[4] },
  loading:      { height: 280, alignItems: 'center', justifyContent: 'center' },
  empty:        { alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingVertical: spacing[10] },
  emptyIconWrap:{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  emptyBtn:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
  section:      { padding: spacing[5] },
});
