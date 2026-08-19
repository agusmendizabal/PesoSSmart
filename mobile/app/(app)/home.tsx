import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Dimensions,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, PressableCard, AmountDisplay, Badge, MiniLineChart } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useGoalsStore, type SavingsGoal } from '@/store/goalsStore';
import { useSavingsStore } from '@/store/savingsStore';
import type { Expense } from '@/types';
import { computeFinancialDiagnosis, type MonthHistoryEntry, type CategoryRowInput } from '@/lib/financialDiagnosis';
import { MONTH_NAMES } from '@/components/ReportCards';
import { useStreakStore } from '@/store/streakStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import { scheduleBudgetAlert } from '@/lib/notifications';
import { getGreeting, formatCurrency } from '@/utils/format';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { calculatePersonalInflation } from '@/utils/inflationCalc';
import { HomeSkeletonLoader } from '@/components/ui/SkeletonLoader';
import { ADVISOR_ENABLED, ADVISOR_FALLBACK_CTA } from '@/lib/features';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type MonthStatus = 'good' | 'tight' | 'over';

interface StatusConfig {
  color:  string;
  bg:     string;
  border: string;
  label:  string;
  icon:   string;
}

const STATUS_CONFIG: Record<MonthStatus, StatusConfig> = {
  good:  { color: colors.neon,    bg: colors.neon + '10',    border: colors.neon + '40',    label: 'Buen mes',      icon: 'trending-up'   },
  tight: { color: colors.yellow,  bg: colors.yellow + '10',  border: colors.yellow + '40',  label: 'Mes ajustado',  icon: 'alert-circle'  },
  over:  { color: colors.red,     bg: colors.red + '10',     border: colors.red + '40',     label: 'Te pasaste',    icon: 'trending-down' },
};

function computeStatus(
  totalThisMonth: number,
  totalDisposable: number,
  estimatedIncome: number | null,
): MonthStatus {
  if (!estimatedIncome || estimatedIncome <= 0) {
    const dispPct = totalThisMonth > 0 ? totalDisposable / totalThisMonth : 0;
    return dispPct > 0.25 ? 'tight' : 'good';
  }
  const incomePct = totalThisMonth / estimatedIncome;
  const dispPct   = totalThisMonth > 0 ? totalDisposable / totalThisMonth : 0;
  if (incomePct > 1)    return 'over';
  if (incomePct > 0.85 || dispPct > 0.20) return 'tight';
  return 'good';
}

function buildInsight(
  status: MonthStatus,
  totalThisMonth: number,
  totalDisposable: number,
  estimatedIncome: number | null,
): string {
  const recoverable = Math.round(totalDisposable * 0.5);
  if (status === 'over' && estimatedIncome) {
    return `Este gasto te está frenando — te pasaste ${formatCurrency(totalThisMonth - estimatedIncome)}. Recortá hoy.`;
  }
  if (status === 'tight' && estimatedIncome) {
    const pct = Math.round((totalThisMonth / estimatedIncome) * 100);
    return `Usaste el ${pct}% del ingreso. Tu mayor fuga puede costar caro este mes.`;
  }
  if (status === 'good' && recoverable > 0) {
    return `Mes positivo. Podés convertir ~${formatCurrency(recoverable)} en inversión ahora mismo.`;
  }
  return 'Tu mes viene bien. Mantené tu racha.';
}

// ─── SpendingMiniChart ───────────────────────────────────────────────────────

function SpendingMiniChart({
  expenses,
  statusColor,
}: {
  expenses:    Expense[];
  statusColor: string;
}) {
  const now          = new Date();
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today        = now.getDate();

  const dailyTotals  = Array<number>(daysInMonth).fill(0);
  expenses.forEach(e => {
    const day = parseInt(e.date.split('-')[2], 10) - 1;
    if (day >= 0 && day < daysInMonth) dailyTotals[day] += e.amount;
  });

  const maxAmt  = Math.max(...dailyTotals, 1);
  const CHART_H = 38;

  return (
    <View style={{ height: CHART_H, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {dailyTotals.map((amt, idx) => {
        const day      = idx + 1;
        const isToday  = day === today;
        const isFuture = day > today;
        const barH     = amt > 0 ? Math.max((amt / maxAmt) * CHART_H, 4) : 3;
        return (
          <View
            key={idx}
            style={{
              flex: 1, height: barH, borderRadius: 2,
              backgroundColor: isFuture
                ? colors.border.subtle
                : isToday
                  ? statusColor
                  : statusColor + '55',
            }}
          />
        );
      })}
    </View>
  );
}

// ─── MonthHeroCard ────────────────────────────────────────────────────────────

interface HomeHighlight {
  id:        string;
  tag:       string;
  tagColor:  string;
  title:     string;
  subtitle:  string;
  icon:      string;
  iconColor: string;
  bg?:       string;
  cta?:      { label: string; route: string };
}

function buildHomeHighlights({
  totalThisMonth,
  totalDisposable,
  totalInvestable,
  estimatedIncome,
  expenses,
  goals,
  threeMonthAvgCats,
  pendingCount = 0,
}: {
  totalThisMonth:    number;
  totalDisposable:   number;
  totalInvestable:   number;
  estimatedIncome:   number | null;
  expenses:          Expense[];
  goals:             SavingsGoal[];
  threeMonthAvgCats: Record<string, number>;
  pendingCount?:     number;
}): HomeHighlight[] {
  const items: HomeHighlight[] = [];

  // 0. Gastos sin clasificar (siempre primero si existen)
  if (pendingCount > 0) {
    items.push({
      id: 'pending_classify',
      tag: 'ACCIÓN REQUERIDA',
      tagColor: '#FCD34D',
      title: `${pendingCount} gasto${pendingCount > 1 ? 's' : ''} sin clasificar`,
      subtitle: 'Ya están cargados. Solo falta elegir la categoría para que contabilicen bien.',
      icon: 'time-outline',
      iconColor: '#FCD34D',
      bg: '#92400E',
      cta: { label: 'Clasificar ahora', route: '/(app)/expenses' },
    });
  }

  // 1. Income status
  if (estimatedIncome && estimatedIncome > 0 && totalThisMonth > 0) {
    const pct = Math.round((totalThisMonth / estimatedIncome) * 100);
    if (pct > 100) {
      items.push({
        id: 'over_income', tag: 'ATENCIÓN', tagColor: colors.red,
        title: `Te pasaste un ${pct - 100}%`,
        subtitle: `Gastaste ${formatCurrency(totalThisMonth - estimatedIncome)} más de tu ingreso mensual.`,
        icon: 'trending-down-outline', iconColor: colors.red,
        cta: { label: 'Ver análisis', route: '/(app)/expenses?tab=analisis' },
      });
    } else if (pct >= 80) {
      items.push({
        id: 'tight_income', tag: 'AJUSTADO', tagColor: colors.yellow,
        title: `Usaste el ${pct}% del ingreso`,
        subtitle: 'Poco margen. Revisá los prescindibles antes de que sea tarde.',
        icon: 'alert-circle-outline', iconColor: colors.yellow,
        cta: { label: 'Ver gastos', route: '/(app)/expenses' },
      });
    } else {
      items.push({
        id: 'good_income', tag: 'EN CONTROL', tagColor: colors.neon,
        title: `Usaste el ${pct}% del ingreso`,
        subtitle: `Te quedan ${formatCurrency(estimatedIncome - totalThisMonth)} libres este mes. Buen ritmo.`,
        icon: 'shield-checkmark-outline', iconColor: colors.neon,
        cta: { label: 'Ver análisis', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // 2. Recoverable from disposable
  if (totalDisposable >= 5000) {
    const recoverable = Math.round(totalDisposable * 0.5);
    items.push({
      id: 'recoverable', tag: 'OPORTUNIDAD', tagColor: colors.neon,
      title: `Podrías recuperar ${formatCurrency(recoverable)}`,
      subtitle: `Ajustando la mitad de tus gastos prescindibles de este mes.`,
      icon: 'cash-outline', iconColor: colors.neon,
      cta: ADVISOR_ENABLED ? { label: 'Hablar con asesor', route: '/(app)/advisor' } : ADVISOR_FALLBACK_CTA,
    });
  }

  // 3. Top expense category
  if (expenses.length > 0) {
    const catTotals: Record<string, number> = {};
    expenses.forEach(e => {
      const name = e.category?.name_es
        ?? (e.classification === 'disposable' ? 'Prescindibles'
          : e.classification === 'necessary' ? 'Necesarios' : 'Sin clasificar');
      catTotals[name] = (catTotals[name] ?? 0) + e.amount;
    });
    const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const [topName, topAmt] = sorted[0] ?? ['', 0];
    if (topAmt > 0) {
      items.push({
        id: 'top_category', tag: 'MAYOR GASTO', tagColor: colors.primary,
        title: topName,
        subtitle: `Gastaste ${formatCurrency(topAmt)} en ${topName.toLowerCase()} este mes.`,
        icon: 'pie-chart-outline', iconColor: colors.primary,
        cta: { label: 'Ver desglose', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // 4. Investment hint
  if (totalInvestable >= 10000) {
    const fciMonthly = Math.round(totalInvestable * 0.030);
    items.push({
      id: 'invest_hint', tag: 'INVERSIÓN', tagColor: '#A78BFA',
      title: `${formatCurrency(totalInvestable)} disponibles`,
      subtitle: `Invertido en FCI Money Market podrías ganar ~${formatCurrency(fciMonthly)}/mes sin hacer nada más.`,
      icon: 'trending-up-outline', iconColor: '#A78BFA',
      cta: { label: 'Ver simulador', route: '/(app)/simulator' },
    });
  }

  // 5. Goal progress
  const activeGoal = goals.find(g => g.current_amount < g.target_amount);
  if (activeGoal) {
    const pct = Math.round((activeGoal.current_amount / activeGoal.target_amount) * 100);
    items.push({
      id: 'goal_progress', tag: 'META DE AHORRO', tagColor: colors.neon,
      title: `${activeGoal.emoji ?? '🎯'} ${pct}% completado`,
      subtitle: `"${activeGoal.title}" — te faltan ${formatCurrency(activeGoal.target_amount - activeGoal.current_amount)}.`,
      icon: 'flag-outline', iconColor: colors.neon,
    });
  }

  // 6. Above-average category (3-month comparison)
  if (expenses.length > 0 && Object.keys(threeMonthAvgCats).length > 0) {
    const catMap: Record<string, number> = {};
    expenses.forEach(e => {
      const name = (e as any).category?.name_es ?? 'Sin clasificar';
      catMap[name] = (catMap[name] ?? 0) + e.amount;
    });
    const spikes = Object.entries(catMap)
      .filter(([name, amt]) => threeMonthAvgCats[name] && amt > threeMonthAvgCats[name] * 1.35)
      .sort((a, b) => (b[1] / threeMonthAvgCats[b[0]]) - (a[1] / threeMonthAvgCats[a[0]]));
    if (spikes.length > 0) {
      const [name, amt] = spikes[0];
      const avg    = threeMonthAvgCats[name];
      const pctAbv = Math.round(((amt - avg) / avg) * 100);
      items.push({
        id: 'above_avg_banner', tag: 'GASTO INUSUAL', tagColor: colors.red,
        title: `+${pctAbv}% en ${name}`,
        subtitle: `Gastaste ${formatCurrency(Math.round(amt))} — un ${pctAbv}% más que tu promedio de 3 meses (${formatCurrency(Math.round(avg))}).`,
        icon: 'alert-circle-outline', iconColor: colors.red,
        cta: { label: 'Ver desglose', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // Fallback (no data yet)
  if (items.length === 0) {
    items.push({
      id: 'welcome', tag: 'EMPEZÁ', tagColor: colors.primary,
      title: 'Registrá tu primer gasto',
      subtitle: 'Cuando tengas datos reales, acá vas a ver tus insights financieros personalizados.',
      icon: 'sparkles-outline', iconColor: colors.primary,
      cta: { label: 'Agregar gasto', route: '/(app)/expenses' },
    });
  }

  return items.slice(0, 5);
}

const QS_KEY = '@smartpesos/quickstart_dismissed';

function QuickStartCard({
  hasExpenses,
  hasGmail,
  hasInvestments,
  onConnectGmail,
  onAddExpense,
  onSetIncome,
  onDismiss,
}: {
  hasExpenses:    boolean;
  hasGmail:       boolean;
  hasInvestments: boolean;
  onConnectGmail: () => void;
  onAddExpense:   () => void;
  onSetIncome:    () => void;
  onDismiss:      () => void;
}) {
  const steps = [
    { label: 'Conectar Gmail',         done: hasGmail,       action: onConnectGmail, cta: 'Conectar' },
    { label: 'Cargar tu primer gasto', done: hasExpenses,    action: onAddExpense,   cta: 'Agregar'  },
    { label: 'Configurar tu ingreso',  done: hasInvestments, action: onSetIncome,    cta: 'Configurar' },
  ];
  const completedCount = steps.filter(s => s.done).length;
  const pct            = Math.round((completedCount / steps.length) * 100);

  return (
    <View style={qsStyles.card}>
      <View style={qsStyles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="label" color={colors.neon}>PRIMEROS PASOS</Text>
          <Text variant="subtitle" color={colors.text.primary}>Activá tu diagnóstico financiero</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      {/* Barra de progreso */}
      <View style={qsStyles.progressTrack}>
        <View style={[qsStyles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text variant="caption" color={colors.text.tertiary}>{completedCount} de {steps.length} completados</Text>

      {/* Steps */}
      <View style={qsStyles.steps}>
        {steps.map((step, i) => (
          <View key={i} style={qsStyles.step}>
            <View style={[qsStyles.checkbox, step.done && qsStyles.checkboxDone]}>
              {step.done && <Ionicons name="checkmark" size={12} color={colors.bg.primary} />}
            </View>
            <Text
              variant="bodySmall"
              color={step.done ? colors.text.tertiary : colors.text.primary}
              style={[{ flex: 1 }, step.done && { textDecorationLine: 'line-through' }]}
            >
              {step.label}
            </Text>
            {!step.done && (
              <TouchableOpacity style={qsStyles.ctaBtn} onPress={step.action} activeOpacity={0.8}>
                <Text variant="label" color={colors.neon}>{step.cta}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const qsStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.neon + '30',
    borderLeftWidth: 3, borderLeftColor: colors.neon,
    borderRadius: 16, padding: spacing[5], gap: spacing[4],
  },
  header:        { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  progressTrack: { height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: colors.neon, borderRadius: 2 },
  steps:         { gap: spacing[3] },
  step:          { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  checkbox: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.border.default,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkboxDone:  { backgroundColor: colors.neon, borderColor: colors.neon },
  ctaBtn: {
    paddingHorizontal: spacing[3], paddingVertical: spacing[1],
    borderRadius: 8, borderWidth: 1, borderColor: colors.neon + '50',
    backgroundColor: colors.neon + '0A',
  },
});

// ─── MiniLineChart ────────────────────────────────────────────────────────────

function CompactInflationRow({
  personalRate, officialRate, onPress,
}: {
  personalRate: number;
  officialRate: number;
  onPress: () => void;
}) {
  const diff = personalRate - officialRate;
  const won  = diff <= 0;
  const stateColor = won ? '#2E7D32' : '#EF4444';
  const ratio = officialRate > 0 ? Math.min(personalRate / officialRate, 1.2) : 0;

  return (
    <TouchableOpacity style={inflS.card} onPress={onPress} activeOpacity={0.85}>
      <View style={inflS.titleRow}>
        <Text style={inflS.cardTitle}>Inflación personal vs. oficial</Text>
        <Ionicons name="information-circle-outline" size={16} color="#9E9E9E" />
      </View>
      <View style={inflS.valuesRow}>
        <View style={inflS.valBlock}>
          <Text style={inflS.valLabel}>Tu inflación</Text>
          <Text style={inflS.valNum}>{personalRate.toFixed(1).replace('.', ',')}%</Text>
        </View>
        <View style={inflS.valCenter}>
          <Text style={[inflS.valLabel, { color: stateColor, textAlign: 'center' }]} numberOfLines={2}>
            {won ? 'Le ganaste por' : 'Superaste por'}
          </Text>
          <Text style={[inflS.valNumBig, { color: stateColor }]}>
            {Math.abs(diff).toFixed(1).replace('.', ',')}%
          </Text>
        </View>
        <View style={[inflS.valBlock, inflS.valRight]}>
          <Text style={[inflS.valLabel, { textAlign: 'right' }]}>INDEC</Text>
          <Text style={[inflS.valNum, { textAlign: 'right' }]}>{officialRate.toFixed(1).replace('.', ',')}%</Text>
        </View>
      </View>
      <View style={inflS.barTrack}>
        <View style={[inflS.barFill, { width: `${Math.min(ratio * 100, 100)}%` as any, backgroundColor: stateColor }]} />
      </View>
    </TouchableOpacity>
  );
}

const inflS = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E0E0',
    borderRadius: 16, padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  titleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#212121' },
  valuesRow:  { flexDirection: 'row', alignItems: 'center' },
  valBlock:   { flex: 1, gap: 2 },
  valLabel:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#757575' },
  valNum:     { fontFamily: 'Montserrat_700Bold', fontSize: 20, color: '#212121', lineHeight: 28 },
  valNumBig:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 22, lineHeight: 38, textAlign: 'center' },
  valCenter:  { flex: 1, gap: 2, alignItems: 'stretch' },
  valRight:   { alignItems: 'flex-end' },
  barTrack:   { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden' },
  barFill:    { height: '100%', borderRadius: 3 },
});

// ─── ProjectedBalanceCard ─────────────────────────────────────────────────────

export default function HomeScreen() {
  const { profile, user } = useAuthStore();
  const {
    expenses,
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
    fetchExpenses,
    fetchSubscriptionsAndProjection,
    projectedBalance,
    estimatedIncome,
    isLoading,
  } = useExpensesStore();
  const { goals, fetchGoals }                = useGoalsStore();
  const { investments, fetchAll: loadSavings } = useSavingsStore();
  const streakStore  = useStreakStore();
  const roundUpStore = useRoundUpStore();
  const [inflationRate,  setInflationRate]  = useState(0);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [pendingCount,   setPendingCount]   = useState(0);
  const [mpConnected,    setMpConnected]    = useState(false);
  const [mpSyncing,      setMpSyncing]      = useState(false);
  const [mpSyncMsg,      setMpSyncMsg]      = useState<string | null>(null);
  const [inflationData,  setInflationData]  = useState<{ personal: number; official: number } | null>(null);
  const [hideAmounts,    setHideAmounts]    = useState(false);

  const { isFirstVisit, markVisited } = useFirstVisit('home');

  const [prevMonthCats,     setPrevMonthCats]     = useState<Record<string, { name: string; amount: number }>>({});
  const [prevMonthTotal,    setPrevMonthTotal]    = useState(0);
  const [threeMonthAvgCats, setThreeMonthAvgCats] = useState<Record<string, number>>({});
  const [fciRate,           setFciRate]           = useState(0);
  const [allRates,          setAllRates]          = useState<Record<string, number>>({});
  const [monthHistory,      setMonthHistory]      = useState<MonthHistoryEntry[]>([]);

  const _now         = new Date();
  const _dayOfMonth  = _now.getDate();

  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchSubscriptionsAndProjection(user.id);
      fetchGoals(user.id);
      loadSavings(user.id);
    }
    streakStore.load();
    roundUpStore.load();
    roundUpStore.checkReset();

    // Tasas de mercado (inflación general, FCI, e inflación por rubro) —
    // una sola query a toda la tabla, igual que reports.tsx, para que el
    // diagnóstico de salud financiera use exactamente los mismos datos.
    (supabase as any)
      .from('market_rates')
      .select('instrument, rate_monthly')
      .then(({ data }: { data: { instrument: string; rate_monthly: number }[] | null }) => {
        if (!data) return;
        const ratesMap: Record<string, number> = {};
        for (const row of data) {
          ratesMap[row.instrument] = Number(row.rate_monthly);
        }
        setAllRates(ratesMap);
        if (ratesMap.inflation != null) setInflationRate(ratesMap.inflation);
        if (ratesMap.fci_mm    != null) setFciRate(ratesMap.fci_mm);
      });

    // Gmail connection check + pending transaction count
    if (user?.id) {
      (supabase as any)
        .from('gmail_connections')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }: { data: { id: string } | null }) => setGmailConnected(!!data));

      (supabase as any)
        .from('mp_connections')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }: { data: { id: string } | null }) => setMpConnected(!!data));

      (supabase as any)
        .from('pending_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .then(({ count }: { count: number | null }) => setPendingCount(count ?? 0));
    }

    // QuickStart: show unless dismissed
    AsyncStorage.getItem(QS_KEY).then(val => {
      if (val !== 'true') setShowQuickStart(true);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const now  = new Date();
    const pm   = now.getMonth() === 0 ? 12 : now.getMonth();
    const py   = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const start = `${py}-${String(pm).padStart(2, '0')}-01`;
    const nm    = pm === 12 ? 1 : pm + 1;
    const ny    = pm === 12 ? py + 1 : py;
    const end   = `${ny}-${String(nm).padStart(2, '0')}-01`;
    supabase
      .from('expenses')
      .select('amount, category:expense_categories(name_es)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .gte('date', start)
      .lt('date', end)
      .then(({ data }) => {
        const map: Record<string, { name: string; amount: number }> = {};
        let sum = 0;
        for (const exp of data ?? []) {
          const name = (exp as any).category?.name_es ?? 'Sin categoría';
          if (!map[name]) map[name] = { name, amount: 0 };
          map[name].amount += (exp as any).amount;
          sum += (exp as any).amount;
        }
        setPrevMonthCats(map);
        setPrevMonthTotal(sum);
      });
  }, [user?.id]);

  // 3-month category averages (for above-average detection)
  useEffect(() => {
    if (!user?.id) return;
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10);
    const end   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    supabase
      .from('expenses')
      .select('amount, category:expense_categories(name_es)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .gte('date', start)
      .lt('date', end)
      .then(({ data }) => {
        const sums: Record<string, number> = {};
        for (const exp of data ?? []) {
          const name = (exp as any).category?.name_es ?? 'Sin categoría';
          sums[name] = (sums[name] ?? 0) + (exp as any).amount;
        }
        const avgs: Record<string, number> = {};
        for (const [name, total] of Object.entries(sums)) {
          avgs[name] = total / 3;
        }
        setThreeMonthAvgCats(avgs);
      });
  }, [user?.id]);

  // Historial mensual (últimos 3 meses) — mismo shape que reports.tsx, para
  // que el diagnóstico de salud financiera (tendencia histórica) coincida
  // con el que se muestra en Análisis.
  useEffect(() => {
    if (!user?.id) return;
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    supabase
      .from('expenses')
      .select('amount, date, classification')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .gte('date', start)
      .then(({ data }) => {
        const histMap: Record<string, MonthHistoryEntry> = {};
        for (const exp of (data ?? []) as { amount: number; date: string; classification: string | null }[]) {
          const key = exp.date.slice(0, 7);
          if (!histMap[key]) {
            const [, m] = key.split('-').map(Number);
            histMap[key] = { monthKey: key, label: MONTH_NAMES[m - 1].slice(0, 3), total: 0, disposable: 0, necessary: 0, investable: 0 };
          }
          histMap[key].total += exp.amount;
          if (exp.classification === 'disposable') histMap[key].disposable += exp.amount;
          if (exp.classification === 'necessary')  histMap[key].necessary  += exp.amount;
          if (exp.classification === 'investable') histMap[key].investable += exp.amount;
        }
        setMonthHistory(Object.values(histMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey)));
      });
  }, [user?.id]);

  // Notificaciones
  useEffect(() => {
    if (!estimatedIncome || estimatedIncome <= 0) return;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();
    scheduleBudgetAlert(totalThisMonth / estimatedIncome, estimatedIncome - totalThisMonth, daysLeft).catch(() => {});
  }, [totalThisMonth, estimatedIncome]);

  // Inflación personal
  useEffect(() => {
    if (expenses.length === 0) return;
    const now = new Date();
    const grouped: Record<string, { categoryNameEs: string; categoryColor: string; amount: number }> = {};
    for (const e of expenses) {
      if (!e.category_id) continue; // excluir sin clasificar
      const cat  = (e as any).category;
      const name = cat?.name_es ?? 'Otros';
      if (!grouped[name]) grouped[name] = { categoryNameEs: name, categoryColor: cat?.color ?? '#888888', amount: 0 };
      grouped[name].amount += e.amount;
    }
    const inputs = Object.values(grouped).filter(x => x.amount > 0);
    if (inputs.length > 0) {
      try {
        const result = calculatePersonalInflation(inputs, now.getFullYear(), now.getMonth() + 1);
        if (result) setInflationData({ personal: result.personalInflation, official: result.officialInflation });
      } catch {}
    }
  }, [expenses]);

  const recentExpenses = expenses.slice(0, 4);

  const highlights = buildHomeHighlights({
    totalThisMonth,
    totalDisposable,
    totalInvestable,
    estimatedIncome,
    expenses,
    goals,
    threeMonthAvgCats,
    pendingCount,
  });

  // ── Editar ingreso ──────────────────────────────────────────────────────────
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [selectedRange,   setSelectedRange]   = useState<string | null>(null);
  const [savingIncome,    setSavingIncome]     = useState(false);

  const INCOME_OPTIONS = [
    { label: 'Menos de $500.000',       value: 'under_150k'  },
    { label: '$500.000 – $1.000.000',   value: '150k_300k'   },
    { label: '$1.000.000 – $2.000.000', value: '300k_500k'   },
    { label: '$2.000.000 – $3.500.000', value: '500k_800k'   },
    { label: '$3.500.000 – $6.000.000', value: '800k_1500k'  },
    { label: 'Más de $6.000.000',       value: 'over_1500k'  },
  ];

  const openIncomeModal = async () => {
    if (user?.id) {
      const { data } = await supabase
        .from('financial_profiles')
        .select('income_range')
        .eq('user_id', user.id)
        .single();
      const range: string | null = (data as any)?.income_range ?? null;
      setSelectedRange(range);
    }
    setShowIncomeModal(true);
  };

  const saveIncome = async () => {
    if (!selectedRange || !user?.id) return;
    setSavingIncome(true);
    try {
      await (supabase.from('financial_profiles') as any)
        .update({ income_range: selectedRange })
        .eq('user_id', user.id);
      setShowIncomeModal(false);
      fetchSubscriptionsAndProjection(user.id);
    } finally {
      setSavingIncome(false);
    }
  };

  // ── QuickStart: auto-dismiss cuando todo está completo ──────────────────────
  const qsHasExpenses = expenses.length > 0;
  const qsHasIncome   = !!estimatedIncome && estimatedIncome > 0;

  useEffect(() => {
    if (qsHasExpenses && gmailConnected && qsHasIncome) {
      AsyncStorage.setItem(QS_KEY, 'true');
      setShowQuickStart(false);
    }
  }, [qsHasExpenses, gmailConnected, qsHasIncome]);

  const dismissQuickStart = useCallback(() => {
    AsyncStorage.setItem(QS_KEY, 'true');
    setShowQuickStart(false);
  }, []);

  const syncMpQuick = useCallback(async () => {
    if (!user?.id || mpSyncing) return;
    setMpSyncing(true);
    setMpSyncMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/mp-poll`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ force_sync: true }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const found = (json.new_found ?? 0) as number;
        setMpSyncMsg(found > 0 ? `+${found}` : '✓');
        if (found > 0) {
          // Refresh pending count (gastos van a pendientes, no a expenses directamente)
          (supabase as any)
            .from('pending_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .then(({ count }: { count: number | null }) => setPendingCount(count ?? 0));
        }
      } else {
        setMpSyncMsg('!');
      }
    } catch {
      setMpSyncMsg('!');
    } finally {
      setMpSyncing(false);
      setTimeout(() => setMpSyncMsg(null), 3000);
    }
  }, [user?.id, mpSyncing, fetchExpenses]);

  // ── Health Score ────────────────────────────────────────────────────────────
  // Mismo motor que Análisis (computeFinancialDiagnosis) — antes esta pantalla
  // usaba un cálculo completamente distinto (computeHealthScore, orientado a
  // rachas/inversión) que podía mostrar un puntaje muy distinto al de Análisis
  // para el mismo mes. Se unifica para que ambas pantallas siempre coincidan.
  const diagnosisRows = useMemo<CategoryRowInput[]>(() => {
    if (expenses.length === 0 || totalThisMonth === 0) return [];
    const catMap: Record<string, { name: string; amount: number; color: string }> = {};
    expenses.forEach(e => {
      const name  = (e as any).category?.name_es ?? 'Sin clasificar';
      const color = (e as any).category?.color   ?? '#7C3AED';
      if (!catMap[name]) catMap[name] = { name, amount: 0, color };
      catMap[name].amount += e.amount;
    });
    return Object.values(catMap)
      .map(c => ({ id: c.name, name: c.name, color: c.color, amount: c.amount, pct: c.amount / totalThisMonth }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, totalThisMonth]);

  const diagnosisCategoryInflation = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(allRates)) {
      if (k.startsWith('inflation_') && k !== 'inflation') out[k] = v;
    }
    return out;
  }, [allRates]);

  const diagnosis = useMemo(() => {
    if (totalThisMonth === 0) return null;
    return computeFinancialDiagnosis({
      totalThisMonth,
      totalNecessary,
      totalDisposable,
      totalInvestable,
      estimatedIncome,
      history:  monthHistory,
      rows:     diagnosisRows,
      inflationRate,
      fciRate,
      dayOfMonth: _dayOfMonth,
      allRates,
      categoryInflationRates: diagnosisCategoryInflation,
    });
  }, [totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome, monthHistory, diagnosisRows, inflationRate, fciRate, allRates, diagnosisCategoryInflation]);

  const healthScore = diagnosis?.healthScore ?? 0;

  const firstName  = profile?.full_name?.split(' ')[0] ?? 'Ahí vamos';
  const mainScroll = useRef<import('react-native').ScrollView>(null);

  // ── Top category computation ─────────────────────────────────────────────────
  const topCatData = useMemo(() => {
    if (expenses.length === 0 || totalThisMonth === 0) return null;
    const catMap: Record<string, { name: string; amount: number; color: string }> = {};
    expenses.forEach(e => {
      const name  = (e as any).category?.name_es ?? 'Sin clasificar';
      const color = (e as any).category?.color   ?? '#7C3AED';
      if (!catMap[name]) catMap[name] = { name, amount: 0, color };
      catMap[name].amount += e.amount;
    });
    const sorted = Object.values(catMap).sort((a, b) => b.amount - a.amount);
    if (!sorted[0]) return null;
    const top = sorted[0];
    const pct = Math.round((top.amount / totalThisMonth) * 100);
    return { name: top.name, pct, color: top.color };
  }, [expenses, totalThisMonth]);

  // ── Active goal ──────────────────────────────────────────────────────────────
  const activeGoal = goals.find(g => g.current_amount < g.target_amount);
  const goalPct    = activeGoal ? Math.round((activeGoal.current_amount / activeGoal.target_amount) * 100) : null;

  // ── Savings potential (recoverable) ─────────────────────────────────────────
  const savingsPotential = Math.round(totalDisposable * 0.5);
  const investedIn12m    = totalDisposable > 0
    ? Math.round(totalDisposable * 12 * 1.03)
    : 0;

  const healthLabel  = diagnosis?.healthLabel ?? 'Sin datos';
  const healthColor  = diagnosis?.healthColor ?? colors.text.tertiary;
  const prevPct      = prevMonthTotal > 0 && totalThisMonth > 0
    ? Math.round(((totalThisMonth - prevMonthTotal) / prevMonthTotal) * 100)
    : null;

  return (
    <SafeAreaView style={nStyles.safe} edges={['top']}>
      <ScrollView
        ref={mainScroll}
        contentContainerStyle={nStyles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => user?.id && fetchExpenses(user.id)}
            tintColor="#22C55E"
          />
        }
      >

        {/* ── HEADER ──────────────────────────────────────────────────────────── */}
        <View style={nStyles.header}>
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 22 }}>👋</Text>
              <Text style={nStyles.greetingName}>{getGreeting(firstName)}</Text>
            </View>
            <Text style={nStyles.greetingSub}>Este es tu resumen del mes</Text>
          </View>
          {ADVISOR_ENABLED && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                style={nStyles.headerIconBtn}
                onPress={() => router.push('/(app)/advisor' as any)}
                activeOpacity={0.75}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#1A1A1A" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── SKELETON ────────────────────────────────────────────────────────── */}
        {isLoading && expenses.length === 0 && <HomeSkeletonLoader />}

        {/* ── AI BANNER CAROUSEL ──────────────────────────────────────────────── */}
        <PremiumBannerCarousel highlights={highlights} />

        {/* ── 4-COLUMN FINANCIAL SUMMARY ──────────────────────────────────────── */}
        <View style={nStyles.summaryCard}>
          {/* Ahorro posible */}
          <TouchableOpacity style={nStyles.summaryBlock} onPress={() => router.push((ADVISOR_ENABLED ? '/(app)/advisor' : ADVISOR_FALLBACK_CTA.route) as any)} activeOpacity={0.8}>
            <View style={[nStyles.summaryIcon, { backgroundColor: '#DCFCE7' }]}>
              <Ionicons name="wallet-outline" size={16} color="#22C55E" />
            </View>
            <Text style={nStyles.summaryLabel}>Ahorro posible</Text>
            <Text style={[nStyles.summaryValue, { color: '#22C55E' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatCurrency(savingsPotential)}
            </Text>
            <Text style={[nStyles.summaryCta, { color: '#22C55E' }]}>Ver cómo lograrlo →</Text>
          </TouchableOpacity>

          <View style={nStyles.summaryDivider} />

          {/* Gastado */}
          <TouchableOpacity style={nStyles.summaryBlock} onPress={() => router.push('/(app)/expenses' as any)} activeOpacity={0.8}>
            <View style={[nStyles.summaryIcon, { backgroundColor: '#F3F4F6' }]}>
              <Ionicons name="trending-up-outline" size={16} color="#374151" />
            </View>
            <Text style={nStyles.summaryLabel}>Gastado</Text>
            <Text style={[nStyles.summaryValue, { color: '#1A1A1A' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatCurrency(totalThisMonth)}
            </Text>
            <Text style={[nStyles.summaryCta, { color: '#6B7280' }]}>Ver análisis →</Text>
          </TouchableOpacity>

          <View style={nStyles.summaryDivider} />

          {/* Prescindible */}
          <TouchableOpacity style={nStyles.summaryBlock} onPress={() => router.push('/(app)/reports' as any)} activeOpacity={0.8}>
            <View style={[nStyles.summaryIcon, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="bag-outline" size={16} color="#EF4444" />
            </View>
            <Text style={nStyles.summaryLabel}>Prescindible</Text>
            <Text style={[nStyles.summaryValue, { color: '#EF4444' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatCurrency(totalDisposable)}
            </Text>
            <Text style={[nStyles.summaryCta, { color: '#EF4444' }]}>Ver para reducir →</Text>
          </TouchableOpacity>

          <View style={nStyles.summaryDivider} />

          {/* Meta principal */}
          <TouchableOpacity style={nStyles.summaryBlock} onPress={() => router.push('/(app)/savings' as any)} activeOpacity={0.8}>
            <View style={[nStyles.summaryIcon, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="flag-outline" size={16} color="#7C3AED" />
            </View>
            <Text style={nStyles.summaryLabel}>Meta principal</Text>
            <Text style={[nStyles.summaryValue, { color: '#7C3AED' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {goalPct !== null ? `${goalPct}%` : '--'}
            </Text>
            <Text style={[nStyles.summaryCta, { color: '#7C3AED' }]} numberOfLines={1}>
              {activeGoal ? `${activeGoal.title} →` : 'Crear meta →'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── DÓNDE MÁS GASTASTE ──────────────────────────────────────────────── */}
        {topCatData && (
          <TouchableOpacity
            style={nStyles.topCatCard}
            onPress={() => router.push('/(app)/reports' as any)}
            activeOpacity={0.88}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={nStyles.topCatMeta}>Dónde más gastaste</Text>
              <Text style={nStyles.topCatName} numberOfLines={2}>{topCatData.name}</Text>
              <Text style={nStyles.topCatSub}>Concentra el {topCatData.pct}% de tus gastos</Text>
              <Text style={nStyles.topCatCta}>Ver gastos por categoría →</Text>
            </View>
            {/* Donut chart */}
            <View style={nStyles.donutWrap}>
              <Svg width={80} height={80}>
                {/* Background circle */}
                <SvgPath
                  d={`M 40 40 m -32 0 a 32 32 0 1 1 64 0 a 32 32 0 1 1 -64 0`}
                  stroke="#E9D5FF"
                  strokeWidth={9}
                  fill="none"
                />
                {/* Progress arc */}
                <SvgPath
                  d={`M 40 40 m -32 0 a 32 32 0 1 1 64 0 a 32 32 0 1 1 -64 0`}
                  stroke="#7C3AED"
                  strokeWidth={9}
                  fill="none"
                  strokeDasharray={`${(topCatData.pct / 100) * 201} 201`}
                  strokeDashoffset={50}
                  strokeLinecap="round"
                />
              </Svg>
              <View style={nStyles.donutLabel}>
                <Text style={nStyles.donutPct}>{topCatData.pct}%</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* ── SALUD FINANCIERA ─────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={nStyles.healthCard}
          onPress={() => router.push('/(app)/reports' as any)}
          activeOpacity={0.88}
        >
          {/* Score circular */}
          <View style={nStyles.healthScoreWrap}>
            <Svg width={80} height={80}>
              <SvgPath
                d={`M 40 40 m -32 0 a 32 32 0 1 1 64 0 a 32 32 0 1 1 -64 0`}
                stroke="#E5E7EB"
                strokeWidth={8}
                fill="none"
              />
              <SvgPath
                d={`M 40 40 m -32 0 a 32 32 0 1 1 64 0 a 32 32 0 1 1 -64 0`}
                stroke={healthColor}
                strokeWidth={8}
                fill="none"
                strokeDasharray={`${(healthScore / 100) * 201} 201`}
                strokeDashoffset={50}
                strokeLinecap="round"
              />
            </Svg>
            <View style={nStyles.healthScoreLabel}>
              <Text style={[nStyles.healthScoreNum, { color: healthColor }]}>{healthScore}</Text>
              <Text style={nStyles.healthScoreTotal}>/100</Text>
            </View>
          </View>

          {/* Text */}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={nStyles.healthTitle}>Tu salud financiera</Text>
            <View style={[nStyles.healthBadge, { backgroundColor: healthColor + '18' }]}>
              <View style={[nStyles.healthDot, { backgroundColor: healthColor }]} />
              <Text style={[nStyles.healthBadgeText, { color: healthColor }]}>{healthLabel}</Text>
            </View>
            {prevPct !== null && (
              <Text style={nStyles.healthBody}>
                {prevPct > 0
                  ? `Gastaste ${prevPct}% más que el mes pasado.`
                  : prevPct < 0
                    ? `Mejoró ${Math.abs(prevPct)}% respecto al mes pasado.`
                    : 'Igual que el mes pasado.'}
              </Text>
            )}
            <Text style={nStyles.healthSub}>
              {healthScore >= 70
                ? '¡Vas por buen camino! Seguí manteniendo tus gastos bajo control.'
                : 'Hay oportunidades de mejora. Revisá tus prescindibles.'}
            </Text>
          </View>

          {/* Mini trend chart */}
          {prevMonthTotal > 0 && totalThisMonth > 0 && (
            <View style={{ alignItems: 'flex-end', justifyContent: 'flex-end', gap: 4 }}>
              <MiniLineChart
                data={[prevMonthTotal, totalThisMonth]}
                color={totalThisMonth <= prevMonthTotal ? '#22C55E' : '#EF4444'}
              />
              <Text style={[nStyles.healthTrendText, { color: totalThisMonth <= prevMonthTotal ? '#22C55E' : '#EF4444' }]}>
                {prevPct !== null ? `${prevPct > 0 ? '+' : ''}${prevPct}%` : ''}
              </Text>
              <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 9, color: '#9CA3AF' }}>vs. mes pasado</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── INFLACIÓN PERSONAL VS OFICIAL ───────────────────────────────────── */}
        {inflationData !== null && (
          <CompactInflationRow
            personalRate={inflationData.personal}
            officialRate={inflationData.official}
            onPress={() => router.push('/(app)/reports' as any)}
          />
        )}

        {/* ── ACTIVIDAD RECIENTE ───────────────────────────────────────────────── */}
        <View style={nStyles.recentCard}>
          <View style={nStyles.recentHeader}>
            <Text style={nStyles.recentTitle}>Actividad reciente</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/expenses' as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={nStyles.recentLink}>Ver todo →</Text>
            </TouchableOpacity>
          </View>
          {expenses.length === 0 ? (
            <Text style={nStyles.recentEmpty}>Aún no hay gastos registrados</Text>
          ) : (
            expenses.slice(0, 2).map((exp, idx) => {
              const catName  = (exp as any).category?.name_es ?? 'Sin categoría';
              const catColor = (exp as any).category?.color ?? '#9CA3AF';
              const isDisp   = exp.classification === 'disposable';
              const isNecess = exp.classification === 'necessary';
              const tagColor = isDisp ? '#EF4444' : isNecess ? '#3B82F6' : '#9CA3AF';
              const tagLabel = isDisp ? 'Prescindible' : isNecess ? 'Necesario' : 'Sin clasificar';
              const merchant = exp.merchant || catName;
              return (
                <View key={exp.id}>
                  {idx > 0 && <View style={nStyles.recentDivider} />}
                  <View style={nStyles.recentRow}>
                    <View style={[nStyles.recentIcon, { backgroundColor: catColor + '15' }]}>
                      <Ionicons name="receipt-outline" size={16} color={catColor} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={nStyles.recentMerchant} numberOfLines={1}>{merchant}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[nStyles.recentTagDot, { backgroundColor: tagColor }]} />
                        <Text style={[nStyles.recentTag, { color: tagColor }]}>{tagLabel}</Text>
                        <Text style={nStyles.recentCat} numberOfLines={1}>· {catName}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <Text style={nStyles.recentAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>-{formatCurrency(exp.amount)}</Text>
                      <Text style={nStyles.recentDate}>{exp.date.slice(5).replace('-', '/')}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── OPORTUNIDAD PARA VOS ─────────────────────────────────────────────── */}
        {totalDisposable > 0 && (
          <TouchableOpacity
            style={nStyles.oppCard}
            onPress={() => router.push('/(app)/simulator' as any)}
            activeOpacity={0.88}
          >
            {/* Header */}
            <View style={nStyles.oppHeader}>
              <View style={nStyles.oppIconCircle}>
                <Text style={{ fontSize: 22 }}>💡</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={nStyles.oppLabel}>OPORTUNIDAD</Text>
                <Text style={nStyles.oppTitle2}>Oportunidad para vos</Text>
              </View>
            </View>

            {/* Body */}
            <Text style={nStyles.oppBody2}>
              Si invertís tus gastos prescindibles de este mes, podrías generar{' '}
              <Text style={nStyles.oppHighlight}>{formatCurrency(investedIn12m)}</Text>
              {' '}en 12 meses.
            </Text>

            {/* Mini growth bar */}
            <View style={nStyles.oppGrowthWrap}>
              <View style={nStyles.oppGrowthTrack}>
                <View style={[nStyles.oppGrowthFill, { width: '72%' }]} />
              </View>
              <View style={nStyles.oppGrowthLabels}>
                <Text style={nStyles.oppGrowthStart}>{formatCurrency(totalDisposable)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="trending-up" size={12} color="#16A34A" />
                  <Text style={nStyles.oppGrowthEnd}>{formatCurrency(investedIn12m)}</Text>
                </View>
              </View>
            </View>

            {/* CTA */}
            <View style={nStyles.oppCta}>
              <Text style={nStyles.oppCtaText}>Ver simulación</Text>
              <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        )}

        {/* ── QUICKSTART ──────────────────────────────────────────────────────── */}
        {showQuickStart && expenses.length === 0 && (
          <QuickStartCard
            hasExpenses={qsHasExpenses}
            hasGmail={gmailConnected}
            hasInvestments={qsHasIncome}
            onConnectGmail={() => router.push('/(app)/profile')}
            onAddExpense={() => router.push('/(app)/expenses')}
            onSetIncome={openIncomeModal}
            onDismiss={dismissQuickStart}
          />
        )}

      </ScrollView>

      {/* ── Tour primera visita ─────────────────────────────────────────────── */}
      <FirstVisitSheet
        visible={isFirstVisit}
        screenTitle="Tu dashboard financiero"
        screenIcon="home-outline"
        iconColor="#22C55E"
        features={[
          { icon: 'cash-outline', color: '#22C55E', title: 'Tu oportunidad del mes', body: 'Ves cuánto podrías recuperar ajustando tus gastos prescindibles y cómo invertirlo hoy.' },
          { icon: 'thermometer-outline', color: '#F59E0B', title: 'Tu inflación real', body: 'Comparamos tu inflación personal contra el INDEC para que sepas si estás ganando o perdiendo poder adquisitivo.' },
          { icon: 'mail-outline', color: '#3B82F6', title: 'Gmail detecta tus gastos', body: 'Si conectás Gmail, detectamos automáticamente las compras de tus resúmenes bancarios y billeteras.' },
        ]}
        onDismiss={markVisited}
      />

      {/* ── Modal editar ingreso ────────────────────────────────────────────── */}
      <Modal
        visible={showIncomeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncomeModal(false)}
      >
        <View style={nStyles.incomeOverlay}>
          <View style={nStyles.incomeSheet}>
            <View style={nStyles.incomeSheetHandle} />
            <View style={nStyles.incomeSheetHeader}>
              <Text variant="subtitle">¿Cuánto ganás por mes?</Text>
              <TouchableOpacity onPress={() => setShowIncomeModal(false)}>
                <Ionicons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>
              Ingreso neto mensual aproximado. Se usa para calcular tu salud financiera.
            </Text>
            <View style={{ gap: 8 }}>
              {INCOME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[nStyles.incomeOption, selectedRange === opt.value && nStyles.incomeOptionActive]}
                  onPress={() => setSelectedRange(opt.value)}
                >
                  <Text style={[nStyles.incomeOptionText, selectedRange === opt.value && { color: '#3B82F6', fontFamily: 'Montserrat_700Bold' }]}>
                    {opt.label}
                  </Text>
                  {selectedRange === opt.value && (
                    <Ionicons name="checkmark-circle" size={18} color="#3B82F6" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[nStyles.incomeSaveBtn, (!selectedRange || savingIncome) && { opacity: 0.5 }]}
              onPress={saveIncome}
              disabled={!selectedRange || savingIncome}
            >
              {savingIncome
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#FFF' }}>Guardar</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── PremiumBannerCarousel ─────────────────────────────────────────────────────

function PremiumBannerCarousel({ highlights }: { highlights: HomeHighlight[] }) {
  const scrollRef   = useRef<ScrollView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused,    setPaused]    = useState(false);
  const W = Dimensions.get('window').width - 40;

  const scrollTo = useCallback((i: number) => {
    scrollRef.current?.scrollTo({ x: i * W, animated: true });
  }, [W]);

  useEffect(() => {
    if (highlights.length <= 1 || paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setActiveIdx(prev => {
        const next = (prev + 1) % highlights.length;
        scrollTo(next);
        return next;
      });
    }, 4500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused, highlights.length, scrollTo]);

  if (highlights.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        bounces={false}
        onScrollBeginDrag={() => { setPaused(true); if (intervalRef.current) clearInterval(intervalRef.current); }}
        onMomentumScrollEnd={e => { setActiveIdx(Math.round(e.nativeEvent.contentOffset.x / W)); setPaused(false); }}
      >
        {highlights.map((h, i) => (
          <TouchableOpacity
            key={h.id}
            style={[bannerS.slide, { width: W }, h.bg ? { backgroundColor: h.bg, shadowColor: h.bg } : null]}
            onPress={h.cta ? () => router.push(h.cta!.route as any) : undefined}
            activeOpacity={0.92}
          >
            {/* Left content */}
            <View style={{ flex: 1, gap: 10 }}>
              <View style={[bannerS.tag, { backgroundColor: h.tagColor + '30' }]}>
                <Ionicons name={h.icon as any} size={11} color={h.tagColor} />
                <Text style={[bannerS.tagText, { color: h.tagColor }]}>{h.tag}</Text>
              </View>
              <Text style={bannerS.title} numberOfLines={3}>{h.title}</Text>
              <Text style={bannerS.subtitle} numberOfLines={2}>{h.subtitle}</Text>
              {h.cta && (
                <View style={bannerS.cta}>
                  <Text style={bannerS.ctaText}>{h.cta.label} →</Text>
                </View>
              )}
            </View>
            {/* Right robot */}
            <View style={bannerS.robotWrap}>
              <Text style={{ fontSize: 56 }}>🤖</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {highlights.length > 1 && (
        <View style={bannerS.dots}>
          {highlights.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => { setActiveIdx(i); scrollTo(i); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <View style={[bannerS.dot, i === activeIdx && bannerS.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const bannerS = StyleSheet.create({
  slide: {
    backgroundColor: '#0F172A',
    borderRadius: 24, padding: 24,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 180,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  tag:     { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontFamily: 'Montserrat_700Bold', fontSize: 10, letterSpacing: 0.5 },
  title:   { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: '#FFFFFF', lineHeight: 28, letterSpacing: -0.3 },
  subtitle:{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 18 },
  cta:     { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  ctaText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#FFFFFF' },
  robotWrap: { width: 64, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dots:    { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  dotActive:{ width: 20, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
});

// ─── Estilos nuevos (light theme) ─────────────────────────────────────────────

const nStyles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#F6F6F8' },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 100,
    gap: 14,
    backgroundColor: '#F6F6F8',
  },

  // Header
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 4 },
  greetingName: { fontFamily: 'Montserrat_700Bold', fontSize: 24, color: '#1A1A1A', letterSpacing: -0.4 },
  greetingSub:  { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9CA3AF', marginLeft: 30 },
  headerIconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  robotAvatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },

  // 4-column summary
  summaryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16,
    flexDirection: 'row', alignItems: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  summaryBlock:   { flex: 1, alignItems: 'center', gap: 6 },
  summaryDivider: { width: 1, height: 60, backgroundColor: '#F3F4F6', alignSelf: 'center' },
  summaryIcon:    { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  summaryLabel:   { fontFamily: 'Montserrat_500Medium', fontSize: 10, color: '#6B7280', textAlign: 'center' },
  summaryValue:   { fontFamily: 'Montserrat_700Bold', fontSize: 13, textAlign: 'center', letterSpacing: -0.3 },
  summaryCta:     { fontFamily: 'Montserrat_500Medium', fontSize: 9, textAlign: 'center', lineHeight: 12 },

  // Top category card
  topCatCard: {
    backgroundColor: '#F5F3FF', borderRadius: 20, padding: 20,
    flexDirection: 'row', alignItems: 'center', gap: 16,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  topCatMeta:  { fontFamily: 'Montserrat_500Medium', fontSize: 11, color: '#8B5CF6', letterSpacing: 0.3 },
  topCatName:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1A1A1A', lineHeight: 22, letterSpacing: -0.3 },
  topCatSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6B7280' },
  topCatCta:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#7C3AED' },
  donutWrap:   { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  donutLabel:  { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutPct:    { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#7C3AED' },

  // Health card
  healthCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20,
    flexDirection: 'row', alignItems: 'center', gap: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  healthScoreWrap:  { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  healthScoreLabel: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  healthScoreNum:   { fontFamily: 'Montserrat_700Bold', fontSize: 18, lineHeight: 22, letterSpacing: -0.5 },
  healthScoreTotal: { fontFamily: 'Montserrat_400Regular', fontSize: 9, color: '#9CA3AF', lineHeight: 12 },
  healthTitle:      { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#1A1A1A', letterSpacing: -0.2 },
  healthBadge:      { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  healthDot:        { width: 7, height: 7, borderRadius: 4 },
  healthBadgeText:  { fontFamily: 'Montserrat_700Bold', fontSize: 11 },
  healthBody:       { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6B7280', lineHeight: 17 },
  healthSub:        { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9CA3AF', lineHeight: 16 },
  healthTrendText:  { fontFamily: 'Montserrat_700Bold', fontSize: 14 },

  // Actividad reciente (full-width)
  recentCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  recentHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  recentTitle:    { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#1A1A1A' },
  recentLink:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#22C55E' },
  recentEmpty:    { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
  recentDivider:  { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  recentRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recentIcon:     { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  recentMerchant: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#1A1A1A' },
  recentTagDot:   { width: 6, height: 6, borderRadius: 3 },
  recentTag:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 11 },
  recentCat:      { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9CA3AF', flex: 1 },
  recentAmount:   { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#1A1A1A' },
  recentDate:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9CA3AF' },

  // Oportunidad para vos (full-width premium)
  oppCard: {
    backgroundColor: '#FFFBEB', borderRadius: 24, padding: 24,
    shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  oppHeader:      { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  oppIconCircle:  { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  oppLabel:       { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: '#D97706', letterSpacing: 0.8, marginBottom: 2 },
  oppTitle2:      { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: '#1A1A1A', letterSpacing: -0.3 },
  oppBody2:       { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#374151', lineHeight: 21, marginBottom: 20 },
  oppHighlight:   { fontFamily: 'Montserrat_700Bold', color: '#16A34A' },
  oppGrowthWrap:  { marginBottom: 20, gap: 8 },
  oppGrowthTrack: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' },
  oppGrowthFill:  { height: 8, backgroundColor: '#22C55E', borderRadius: 4 },
  oppGrowthLabels:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oppGrowthStart: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9CA3AF' },
  oppGrowthEnd:   { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#16A34A' },
  oppCta: {
    backgroundColor: '#1A1A1A', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  oppCtaText:     { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#FFFFFF' },

  // legacy (keep for any remaining refs)
  bottomCard:      { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16 },
  bottomCardTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1A1A1A' },
  bottomCardLink:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#22C55E' },
  activityRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  activityDivider: { height: 1, backgroundColor: '#F3F4F6' },
  activityIcon:    { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  activityMerchant:{ fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#1A1A1A' },
  activityCat:     { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#9CA3AF' },
  activityTag:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 10 },
  activityAmount:  { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#1A1A1A' },
  activityDate:    { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#9CA3AF' },
  oppIconWrap:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  oppTitle:        { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1A1A1A' },
  oppBody:         { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#6B7280', lineHeight: 16 },
  oppBtn:          { backgroundColor: '#F59E0B', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  oppBtnText:      { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#FFFFFF' },

  // Income modal
  incomeOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  incomeSheet:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 12 },
  incomeSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 8 },
  incomeSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  incomeOption:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  incomeOptionActive:{ borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  incomeOptionText:  { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#1A1A1A' },
  incomeSaveBtn:     { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },

  // legacy kept
  styles_safe:   { flex: 1, backgroundColor: '#F6F6F8' },
});

// keep old styles ref alive for income modal (unused keys are fine)
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F6F8' },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 100, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greetingName: { fontFamily: 'Montserrat_700Bold', fontSize: 24, color: '#1A1A1A' },
  eyeLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#7C3AED' },
  eyeSub: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9E9E9E' },
  bellBtn: { padding: 8 },
  syncBtn: { padding: 8 },
  syncMsg: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#22C55E' },
  insightBtn: { padding: 4 },
  insightBadge: { position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center' },
  insightBadgeText: { fontFamily: 'Montserrat_700Bold', fontSize: 8, color: '#FFF' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expenseList: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden' },
  expenseItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  expenseLeft: { flex: 1, marginRight: 16, gap: 4 },
  expenseMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seeAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  emptyCard: { padding: 24, alignItems: 'center', gap: 16 },
  incomeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  incomeSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 12 },
  incomeSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 8 },
  incomeSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  incomeOptions: { gap: 8 },
  incomeOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  incomeOptionActive: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  incomeSaveBtn: { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
});
