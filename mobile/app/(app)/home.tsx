import React, { useEffect, useState, useRef, useCallback } from 'react';
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
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, PressableCard, AmountDisplay, Badge } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useGoalsStore, type SavingsGoal } from '@/store/goalsStore';
import type { Expense } from '@/types';
import type { DetectedSubscription } from '@/store/expensesStore';
import { GoalsSection } from '@/components/GoalsSection';
import { StreakCard } from '@/components/StreakCard';
import { HealthScoreCard, computeHealthScore } from '@/components/HealthScore';
import { DecisionHistorySection, buildOpportunities } from '@/components/DecisionHistory';
import { RoundUpSummary } from '@/components/RoundUpSummary';
import { useStreakStore } from '@/store/streakStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import { scheduleBudgetAlert } from '@/lib/notifications';
import { getGreeting, formatCurrency } from '@/utils/format';

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
    return `Superaste el ingreso por ${formatCurrency(totalThisMonth - estimatedIncome)}. Enfocate en recortar primero.`;
  }
  if (status === 'tight' && estimatedIncome) {
    const pct = Math.round((totalThisMonth / estimatedIncome) * 100);
    return `Usaste el ${pct}% del ingreso. Poco margen — revisá los prescindibles.`;
  }
  if (status === 'good' && recoverable > 0) {
    return `Mes positivo. Podrías destinar ~${formatCurrency(recoverable)} a inversión este mes.`;
  }
  return 'Tu mes viene bien. Seguí así.';
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

function MonthHeroCard({
  totalThisMonth,
  totalNecessary,
  totalDisposable,
  totalInvestable,
  estimatedIncome,
  expenses,
  onEditIncome,
}: {
  totalThisMonth:  number;
  totalNecessary:  number;
  totalDisposable: number;
  totalInvestable: number;
  estimatedIncome: number | null;
  expenses:        Expense[];
  onEditIncome:    () => void;
}) {
  const status  = computeStatus(totalThisMonth, totalDisposable, estimatedIncome);
  const cfg     = STATUS_CONFIG[status];
  const insight = buildInsight(status, totalThisMonth, totalDisposable, estimatedIncome);

  const incomePct  = estimatedIncome && estimatedIncome > 0
    ? Math.min(totalThisMonth / estimatedIncome, 1)
    : null;

  const now        = new Date();
  const monthLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
                        .toUpperCase();

  return (
    <TouchableOpacity
      style={[heroStyles.card, { borderColor: cfg.border, backgroundColor: cfg.bg }]}
      onPress={() => router.push('/(app)/expenses' as any)}
      activeOpacity={0.92}
    >
      {/* Top row: mes + badge + ingreso */}
      <View style={heroStyles.topRow}>
        <View style={heroStyles.topLeft}>
          <Text variant="label" style={{ fontSize: 10, color: colors.text.tertiary }}>
            {monthLabel}
          </Text>
          <View style={[heroStyles.badge, { backgroundColor: cfg.color + '20', borderColor: cfg.color + '50' }]}>
            <Ionicons name={cfg.icon as any} size={10} color={cfg.color} />
            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 10, color: cfg.color }}>
              {cfg.label.toUpperCase()}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={heroStyles.incomeChip} onPress={e => { e.stopPropagation?.(); onEditIncome(); }}>
          <Ionicons
            name={estimatedIncome ? 'pencil-outline' : 'add-outline'}
            size={11}
            color={estimatedIncome ? colors.text.tertiary : colors.neon}
          />
          <Text variant="caption" color={estimatedIncome ? colors.text.tertiary : colors.neon}>
            {estimatedIncome ? formatCurrency(estimatedIncome) : 'Ingreso'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Número + barra */}
      <View style={heroStyles.amountRow}>
        <View style={heroStyles.amountBlock}>
          <Text variant="label" color={colors.text.secondary} style={{ fontSize: 9 }}>GASTASTE ESTE MES</Text>
          <AmountDisplay amount={totalThisMonth} size="lg" />
        </View>
        {incomePct !== null && (
          <View style={heroStyles.pctWrap}>
            <Text style={[heroStyles.pctText, { color: cfg.color }]}>{Math.round(incomePct * 100)}%</Text>
            <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>del ingreso</Text>
          </View>
        )}
      </View>

      {/* Progress bar */}
      {incomePct !== null && (
        <View style={heroStyles.progressTrack}>
          <View style={[heroStyles.progressFill, { width: `${incomePct * 100}%`, backgroundColor: cfg.color }]} />
          {(() => {
            const dayPct = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            return <View style={[heroStyles.dayMarker, { left: `${dayPct * 100}%` }]} />;
          })()}
        </View>
      )}

      {/* KPI row */}
      {totalThisMonth > 0 && (
        <View style={heroStyles.kpiRow}>
          <View style={heroStyles.kpiItem}>
            <View style={[heroStyles.kpiDot, { backgroundColor: colors.accent }]} />
            <View>
              <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>Necesario</Text>
              <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(totalNecessary)}</Text>
            </View>
          </View>
          <View style={heroStyles.kpiDivider} />
          <View style={heroStyles.kpiItem}>
            <View style={[heroStyles.kpiDot, { backgroundColor: colors.red }]} />
            <View>
              <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>Prescindible</Text>
              <Text variant="labelMd" color={colors.red}>{formatCurrency(totalDisposable)}</Text>
            </View>
          </View>
          <View style={heroStyles.kpiDivider} />
          <View style={heroStyles.kpiItem}>
            <View style={[heroStyles.kpiDot, { backgroundColor: colors.neon }]} />
            <View>
              <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>Invertible</Text>
              <Text variant="labelMd" color={colors.neon}>{formatCurrency(totalInvestable)}</Text>
            </View>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    borderWidth: 1, borderRadius: 16,
    padding: spacing[4], gap: spacing[3], overflow: 'hidden',
  },
  topRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  incomeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing[2], paddingVertical: 3,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing[2], paddingVertical: 2,
    borderRadius: 20, borderWidth: 1,
  },
  amountRow:   { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  amountBlock: { gap: 2 },
  pctWrap:     { alignItems: 'flex-end', gap: 1 },
  pctText:     { fontFamily: 'Montserrat_700Bold', fontSize: 22, lineHeight: 26 },
  progressTrack: {
    height: 4, backgroundColor: colors.border.subtle, borderRadius: 2,
    overflow: 'hidden', position: 'relative',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  dayMarker: {
    position: 'absolute', top: -2, bottom: -2,
    width: 2, backgroundColor: colors.text.tertiary + '80', borderRadius: 1,
  },
  kpiRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border.subtle,
  },
  kpiItem:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  kpiDot:     { width: 5, height: 5, borderRadius: 3 },
  kpiDivider: { width: 1, height: 24, backgroundColor: colors.border.subtle, marginHorizontal: spacing[2] },
});

// ─── RecoverableCard ──────────────────────────────────────────────────────────

function RecoverableCard({
  totalDisposable,
  onPress,
}: {
  totalDisposable:  number;
  onPress:          () => void;
}) {
  if (totalDisposable <= 0) return null;

  const recoverable = Math.round(totalDisposable * 0.5);
  const fciEstimate = Math.round(recoverable * 0.030);

  return (
    <TouchableOpacity style={recStyles.card} onPress={onPress} activeOpacity={0.88}>
      {/* Label */}
      <View style={recStyles.labelRow}>
        <View style={recStyles.labelDot} />
        <Text variant="label" color={colors.text.secondary} style={{ fontSize: 10 }}>
          DINERO QUE PODÉS RECUPERAR
        </Text>
      </View>

      {/* Número protagonista */}
      <Text style={recStyles.amount}>{formatCurrency(recoverable)}</Text>
      <Text variant="caption" color={colors.text.secondary}>
        Ajustando la mitad de tus gastos prescindibles ({formatCurrency(totalDisposable)}/mes)
      </Text>

      {/* FCI hint */}
      <View style={recStyles.hintRow}>
        <Ionicons name="trending-up-outline" size={13} color={colors.neon} />
        <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
          Invertido en FCI Money Market: ~
          <Text variant="caption" color={colors.neon}>+{formatCurrency(fciEstimate)}/mes</Text>
          {' '}sin hacer nada más.
        </Text>
      </View>

      {/* CTA */}
      <View style={recStyles.cta}>
        <Text style={recStyles.ctaText}>¿Cómo lo recorto?</Text>
        <Ionicons name="arrow-forward" size={13} color={colors.white} />
      </View>
    </TouchableOpacity>
  );
}

const recStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.red + '35',
    borderLeftWidth: 3, borderLeftColor: colors.red,
    borderRadius: 14, padding: spacing[5], gap: spacing[3],
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  labelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  amount: {
    fontFamily: 'Montserrat_700Bold', fontSize: 32, color: colors.neon,
    letterSpacing: -0.5, lineHeight: 44,
  },
  hintRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2],
    backgroundColor: colors.neon + '0A', borderRadius: 8, padding: spacing[3],
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    alignSelf: 'flex-start', backgroundColor: colors.neon,
    borderRadius: 8, paddingHorizontal: spacing[4], paddingVertical: spacing[2],
  },
  ctaText: { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: colors.white },
});

// ─── TopCategoriesCard ────────────────────────────────────────────────────────

function TopCategoriesCard({ expenses }: { expenses: Expense[] }) {
  if (expenses.length === 0) return null;

  const catMap: Record<string, { amount: number; color: string }> = {};
  expenses.forEach(e => {
    const name  = e.category?.name_es
      ?? (e.classification === 'necessary'  ? 'Necesarios'
        : e.classification === 'disposable' ? 'Prescindibles'
        : e.classification === 'investable' ? 'Invertibles'
        : 'Sin clasificar');
    const color = e.category?.color
      ?? (e.classification === 'necessary'  ? colors.primary
        : e.classification === 'disposable' ? colors.red
        : e.classification === 'investable' ? colors.neon
        : colors.text.tertiary);
    if (!catMap[name]) catMap[name] = { amount: 0, color };
    catMap[name].amount += e.amount;
  });

  const sorted = Object.entries(catMap)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 4);

  const maxAmt = sorted[0]?.[1].amount ?? 1;

  return (
    <View style={topCatStyles.card}>
      <View style={topCatStyles.header}>
        <Text variant="label" color={colors.text.secondary}>TOP CATEGORÍAS</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/expenses?tab=analisis' as any)}>
          <Text variant="label" color={colors.neon}>Ver análisis →</Text>
        </TouchableOpacity>
      </View>

      {sorted.map(([name, { amount, color }]) => (
        <View key={name} style={topCatStyles.row}>
          <View style={[topCatStyles.dot, { backgroundColor: color }]} />
          <Text variant="caption" color={colors.text.primary} style={topCatStyles.catName} numberOfLines={1}>
            {name}
          </Text>
          <View style={topCatStyles.barTrack}>
            <View style={[topCatStyles.barFill, {
              width: `${Math.round((amount / maxAmt) * 100)}%`,
              backgroundColor: color + '70',
            }]} />
          </View>
          <Text variant="caption" color={colors.text.secondary} style={topCatStyles.amount}>
            {formatCurrency(amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const topCatStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[5], gap: spacing[4],
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  dot:  { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catName: { width: 90, flexShrink: 0 },
  barTrack: {
    flex: 1, height: 6, backgroundColor: colors.border.subtle,
    borderRadius: 3, overflow: 'hidden',
  },
  barFill:  { height: '100%', borderRadius: 3 },
  amount: { width: 80, textAlign: 'right', flexShrink: 0 },
});

// ─── QuickActions ─────────────────────────────────────────────────────────────

function QuickActions({ healthScore }: { healthScore: number }) {
  const scoreColor = healthScore >= 85 ? colors.neon
    : healthScore >= 70 ? colors.primary
    : healthScore >= 50 ? colors.yellow
    : healthScore >= 30 ? '#FF6D00'
    : colors.red;

  const items = [
    { label: 'Ingresar\ngasto', icon: 'add-circle-outline',          color: colors.neon,    onPress: () => router.push('/(app)/expenses' as any),  scoreValue: undefined },
    { label: 'Simulador',       icon: 'trending-up-outline',         color: colors.primary, onPress: () => router.push('/(app)/simulator' as any), scoreValue: undefined },
    { label: 'Asesor\nIA',      icon: 'chatbubble-ellipses-outline', color: colors.yellow,  onPress: () => router.push('/(app)/advisor' as any),   scoreValue: undefined },
    { label: 'Salud\nfinanc.',  icon: 'heart-outline',               color: scoreColor,     onPress: () => router.push('/(app)/expenses' as any),  scoreValue: healthScore },
  ];

  return (
    <View style={qaStyles.grid}>
      {items.map((a) => (
        <TouchableOpacity
          key={a.label}
          style={qaStyles.item}
          onPress={a.onPress}
          activeOpacity={0.75}
        >
          <View style={[qaStyles.circle, { backgroundColor: a.color + '18', borderColor: a.color + '30', borderWidth: 1 }]}>
            {a.scoreValue !== undefined
              ? <Text style={[qaStyles.scoreText, { color: a.color }]}>{a.scoreValue}%</Text>
              : <Ionicons name={a.icon as any} size={22} color={a.color} />
            }
          </View>
          <Text style={[qaStyles.label, { color: colors.text.secondary }]} numberOfLines={2}>
            {a.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const qaStyles = StyleSheet.create({
  grid:      { flexDirection: 'row', gap: spacing[2] },
  item:      { flex: 1, alignItems: 'center', gap: spacing[2] },
  circle:    { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  label:     { fontSize: 10, fontFamily: 'Montserrat_500Medium', textAlign: 'center', lineHeight: 13 },
  scoreText: { fontFamily: 'Montserrat_700Bold', fontSize: 14, lineHeight: 17 },
});

// ─── MarketTicker ─────────────────────────────────────────────────────────────

interface MarketData { blue: number | null; mep: number | null }

async function fetchMarketData(): Promise<MarketData> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r    = await fetch('https://api.bluelytics.com.ar/v2/latest', { signal: ctrl.signal });
    clearTimeout(tid);
    const j    = await r.json();
    return { blue: j.blue?.value_sell ?? null, mep: j.mep?.value_sell ?? null };
  } catch {
    return { blue: null, mep: null };
  }
}

const SCREEN_W = require('react-native').Dimensions.get('window').width;

function MarketTicker({
  market, totalInvestable, totalDisposable,
}: {
  market:          MarketData;
  totalInvestable: number;
  totalDisposable: number;
}) {
  const fmt = (n: number) => n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;

  const items = [
    { label: 'DÓLAR BLUE',        value: market.blue ? `$${Math.round(market.blue).toLocaleString('es-AR')}` : '--',  sub: 'venta hoy', color: colors.neon },
    { label: 'DÓLAR MEP',         value: market.mep  ? `$${Math.round(market.mep).toLocaleString('es-AR')}`  : '--',  sub: 'venta hoy', color: colors.neon },
    { label: 'INFLACIÓN MARZO',    value: '3.4%',                                                                       sub: 'INDEC mar-26', color: colors.yellow },
    { label: 'FCI CER EST./MES',  value: '3.2%',                                                                       sub: 'rendimiento', color: colors.primary },
    { label: 'DISPONIBLE',        value: fmt(totalInvestable),                                                          sub: 'para invertir', color: '#A78BFA' },
    { label: 'PRESCINDIBLE/MES',  value: fmt(totalDisposable),                                                          sub: 'podrías recortar', color: colors.red },
  ];

  const scrollRef  = useRef<ScrollView>(null);
  const itemW      = SCREEN_W - layout.screenPadding * 2;
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive(prev => {
        const next = (prev + 1) % items.length;
        scrollRef.current?.scrollTo({ x: next * itemW, animated: true });
        return next;
      });
    }, 2800);
    return () => clearInterval(id);
  }, [items.length, itemW]);

  return (
    <View style={tickerStyles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        decelerationRate="fast"
        bounces={false}
        snapToInterval={itemW}
        onMomentumScrollEnd={e => {
          setActive(Math.round(e.nativeEvent.contentOffset.x / itemW) % items.length);
        }}
      >
        {items.map((item, i) => (
          <View key={i} style={[tickerStyles.slide, { width: itemW }]}>
            <Text style={tickerStyles.tickLabel}>{item.label}</Text>
            <Text style={[tickerStyles.tickValue, { color: item.color }]}>{item.value}</Text>
            <Text style={tickerStyles.tickSub}>{item.sub}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={tickerStyles.dots}>
        {items.map((_, i) => (
          <View key={i} style={[tickerStyles.dot, i === active && tickerStyles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const tickerStyles = StyleSheet.create({
  wrap:      { backgroundColor: colors.bg.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border.default, overflow: 'hidden' },
  slide:     { paddingHorizontal: spacing[5], paddingTop: spacing[4], paddingBottom: spacing[2], gap: spacing[1] },
  tickLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 9, color: colors.text.tertiary, letterSpacing: 1.2 },
  tickValue: { fontFamily: 'Montserrat_700Bold', fontSize: 36, lineHeight: 42, letterSpacing: -0.5 },
  tickSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: colors.text.tertiary },
  dots:      { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingBottom: spacing[3] },
  dot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border.default },
  dotActive: { width: 18, height: 5, borderRadius: 3, backgroundColor: colors.neon },
});

// ─── Datos clave del mes ──────────────────────────────────────────────────────

interface DataInsight {
  id:        string;
  icon:      string;
  iconColor: string;
  title:     string;
  body:      string;
  cta?:      { label: string; route: string };
}

function buildKeyInsights({
  expenses, subscriptions, totalThisMonth, totalDisposable,
  totalInvestable, estimatedIncome, goals, prevMonthCats, prevMonthTotal,
}: {
  expenses:        Expense[];
  subscriptions:   DetectedSubscription[];
  totalThisMonth:  number;
  totalDisposable: number;
  totalInvestable: number;
  estimatedIncome: number | null;
  goals:           SavingsGoal[];
  prevMonthCats:   Record<string, { name: string; amount: number }>;
  prevMonthTotal:  number;
}): DataInsight[] {
  const items: DataInsight[] = [];
  const now         = new Date();
  const dayOfMonth  = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // ── Compute current month by category ────────────────────────────────────────
  const currCats: Record<string, { name: string; amount: number; count: number }> = {};
  expenses.forEach(e => {
    const name = (e as any).category?.name_es ?? 'Sin categoría';
    if (!currCats[name]) currCats[name] = { name, amount: 0, count: 0 };
    currCats[name].amount += e.amount;
    currCats[name].count  += 1;
  });
  const sortedCats = Object.values(currCats).sort((a, b) => b.amount - a.amount);
  const topCat     = sortedCats[0];

  // ── Week expenses (últimos 7 días) ────────────────────────────────────────────
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekExps     = expenses.filter(e => e.date >= weekStartStr);

  // ── 1. PRIMERA SEMANA — proyección ─────────────────────────────────────────
  if (totalThisMonth > 0 && dayOfMonth >= 2) {
    const projected    = Math.round((totalThisMonth / dayOfMonth) * daysInMonth);
    const overIncome   = !!(estimatedIncome && projected > estimatedIncome);
    items.push({
      id: 'projection',
      icon: overIncome ? 'trending-up-outline' : 'analytics-outline',
      iconColor: overIncome ? colors.red : colors.primary,
      title: 'Proyección del mes',
      body: `Arrancaste el mes con ${formatCurrency(totalThisMonth)} en gastos. Si seguís así, en ${daysInMonth} días vas a gastar ${formatCurrency(projected)}.${overIncome ? ' Eso supera tu ingreso estimado.' : ' ¿Está dentro de lo que esperabas?'}`,
      cta: { label: 'Ver análisis', route: '/(app)/expenses?tab=analisis' },
    });
  }

  // ── 2. PRIMERA SEMANA — categoría vs mes pasado ────────────────────────────
  if (topCat && dayOfMonth <= 12 && dayOfMonth >= 3 && prevMonthCats[topCat.name]) {
    const prevAmt     = prevMonthCats[topCat.name].amount;
    const weeklyPace  = topCat.amount; // amount in first ~week
    const projectedM  = Math.round((weeklyPace / dayOfMonth) * daysInMonth);
    if (projectedM > prevAmt * 0.9) {
      items.push({
        id: 'week1_vs_prev',
        icon: 'trending-up-outline',
        iconColor: colors.red,
        title: `${topCat.name}: camino a superar el mes pasado`,
        body: `El mes pasado gastaste ${formatCurrency(Math.round(prevAmt))} en ${topCat.name}. Este mes ya llevas ${formatCurrency(Math.round(topCat.amount))} en la primera semana. Vas camino a superarlo.`,
        cta: { label: 'Ver desglose', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // ── 3. GASTOS CHICOS QUE SUMAN ─────────────────────────────────────────────
  if (dayOfMonth > 3) {
    const smallCats: Record<string, { name: string; total: number; count: number }> = {};
    expenses.filter(e => e.amount < 6000).forEach(e => {
      const name = (e as any).category?.name_es ?? 'Varios';
      if (!smallCats[name]) smallCats[name] = { name, total: 0, count: 0 };
      smallCats[name].total += e.amount;
      smallCats[name].count++;
    });
    const topSmall = Object.values(smallCats).sort((a, b) => b.count - a.count)[0];
    if (topSmall && topSmall.count >= 5) {
      const dailyAvg = topSmall.total / topSmall.count;
      const monthly  = Math.round(dailyAvg * 30);
      const yearly   = Math.round(dailyAvg * 365);
      items.push({
        id: 'small_expenses',
        icon: 'cafe-outline',
        iconColor: colors.yellow,
        title: 'Los gastos chicos suman más de lo que creés',
        body: `Tu ${topSmall.name.toLowerCase()} de ${formatCurrency(Math.round(dailyAvg))} parece poco. En un mes son ${formatCurrency(monthly)}. En un año son ${formatCurrency(yearly)} — casi un sueldo.`,
      });
    }
  }

  // ── 4. SUSCRIPCIONES ───────────────────────────────────────────────────────
  if (subscriptions.length > 0) {
    const totalSubs = subscriptions.reduce((s, sub) => s + sub.averageAmount, 0);
    items.push({
      id: 'subscriptions',
      icon: 'repeat-outline',
      iconColor: colors.yellow,
      title: `${subscriptions.length} suscripciones: ${formatCurrency(Math.round(totalSubs))}/mes`,
      body: `Tenés ${subscriptions.length} suscripciones activas por ${formatCurrency(Math.round(totalSubs))}/mes. ¿Usaste todas este mes? Te mostramos cuáles no tocaste.`,
      cta: { label: 'Ver suscripciones', route: '/(app)/expenses' },
    });
  }

  // ── 5. COMERCIO REPETIDO ESTA SEMANA ──────────────────────────────────────
  if (weekExps.length > 0) {
    const descCount: Record<string, { count: number; total: number }> = {};
    weekExps.forEach(e => {
      const key = e.description.toLowerCase().trim();
      if (!descCount[key]) descCount[key] = { count: 0, total: 0 };
      descCount[key].count += 1;
      descCount[key].total += e.amount;
    });
    const repeated = Object.entries(descCount).filter(([, v]) => v.count >= 3);
    if (repeated.length > 0) {
      const [desc, { count, total }] = repeated.sort((a, b) => b[1].count - a[1].count)[0];
      const display = desc.charAt(0).toUpperCase() + desc.slice(1);
      const fciGain = Math.round(total * 0.03);
      items.push({
        id: 'repeated_merchant',
        icon: 'location-outline',
        iconColor: colors.primary,
        title: `${count} veces en "${display}" esta semana`,
        body: `Sin juzgarte, pero esos ${formatCurrency(Math.round(total))} en FCI este mes te darían ${formatCurrency(Math.round(total + fciGain))}. Vos decidís.`,
      });
    }
  }

  // ── 6. TOP CATEGORÍA VS INGRESO ────────────────────────────────────────────
  if (topCat && estimatedIncome && estimatedIncome > 0) {
    const pct = Math.round((topCat.amount / estimatedIncome) * 100);
    if (pct >= 10) {
      items.push({
        id: 'top_category',
        icon: 'pie-chart-outline',
        iconColor: colors.primary,
        title: `${topCat.name}: ${pct}% del ingreso`,
        body: `Tu categoría más cara este mes fue ${topCat.name}: ${formatCurrency(Math.round(topCat.amount))}. Representa el ${pct}% de tus ingresos. El promedio de tu perfil es 12%.`,
        cta: { label: 'Ver desglose', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // ── 7. CATEGORÍA SPIKE VS MES PASADO ──────────────────────────────────────
  if (topCat && dayOfMonth >= 20 && prevMonthCats[topCat.name]) {
    const prevAmt = prevMonthCats[topCat.name].amount;
    if (topCat.amount > prevAmt * 1.4) {
      items.push({
        id: 'category_spike',
        icon: 'alert-circle-outline',
        iconColor: colors.red,
        title: `Pico de gasto en ${topCat.name}`,
        body: `Este mes gastaste más en ${topCat.name} que el mes pasado (${formatCurrency(Math.round(prevAmt))} vs ${formatCurrency(Math.round(topCat.amount))}). ¿Fue algo especial o se fue de las manos?`,
        cta: { label: 'Ver análisis', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // ── 8. PESOS PARADOS ───────────────────────────────────────────────────────
  if (totalInvestable > 5000 && dayOfMonth > 7) {
    const weeklyInflLoss = Math.round(totalInvestable * 0.03 / 4);
    items.push({
      id: 'idle_money',
      icon: 'cash-outline',
      iconColor: '#A78BFA',
      title: `Perdés ${formatCurrency(weeklyInflLoss)} esta semana`,
      body: `Tus pesos parados perdieron ${formatCurrency(weeklyInflLoss)} de poder adquisitivo esta semana. Con ese monto en FCI Money Market ya estarías cubierto.`,
      cta: { label: 'Ver simulador', route: '/(app)/simulator' },
    });
  }

  // ── 9. FIN DE MES — sobrante ───────────────────────────────────────────────
  if (dayOfMonth >= 25 && estimatedIncome && estimatedIncome > totalThisMonth) {
    const surplus  = Math.round(estimatedIncome - totalThisMonth);
    const inflLoss = Math.round(surplus * 0.028);
    const fciGain  = Math.round(surplus * 0.03);
    items.push({
      id: 'eom_surplus',
      icon: 'wallet-outline',
      iconColor: colors.neon,
      title: `Fin de mes: te sobraron ${formatCurrency(surplus)}`,
      body: `Si los dejás en la cuenta pierden ${formatCurrency(inflLoss)} el mes que viene. Invertidos en FCI generarían ~${formatCurrency(fciGain)} en cambio. ¿Los movemos?`,
      cta: { label: 'Ver simulador', route: '/(app)/simulator' },
    });
  }

  // ── 10. COSTO DE OPORTUNIDAD — prescindibles ───────────────────────────────
  if (totalDisposable > 10000 && dayOfMonth >= 20) {
    const half    = Math.round(totalDisposable * 0.5);
    const fciGain = Math.round(half * 0.03);
    items.push({
      id: 'opportunity_cost',
      icon: 'trending-up-outline',
      iconColor: colors.primary,
      title: 'Costo de oportunidad de tus prescindibles',
      body: `Si hubieras invertido la mitad de lo que gastaste en prescindibles este mes (${formatCurrency(half)}), hoy tendrías ${formatCurrency(half + fciGain)} más. Dato para reflexionar, no para culparte.`,
      cta: { label: 'Hablar con asesor', route: '/(app)/advisor' },
    });
  }

  // ── 11. INFLACIÓN PERSONAL (gasto vs mes pasado) ───────────────────────────
  if (prevMonthTotal > 0 && totalThisMonth > 0 && dayOfMonth >= 25) {
    const growth       = ((totalThisMonth - prevMonthTotal) / prevMonthTotal) * 100;
    const INDEC_CPI    = 3.4; // % mensual — INDEC marzo 2026
    if (growth > INDEC_CPI) {
      const growthStr = growth.toFixed(1);
      items.push({
        id: 'personal_inflation',
        icon: 'speedometer-outline',
        iconColor: colors.red,
        title: `Tu inflación personal: ${growthStr}%`,
        body: `Tu inflación personal este mes fue ${growthStr}% — más que el ${INDEC_CPI}% del INDEC. Tus gastos suben más rápido que el promedio. Te mostramos por qué.`,
        cta: { label: 'Ver informe', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // ── 12. META DE AHORRO ────────────────────────────────────────────────────
  const activeGoal = goals.find(g => g.current_amount < g.target_amount);
  if (activeGoal) {
    const pct       = Math.round((activeGoal.current_amount / activeGoal.target_amount) * 100);
    const remaining = Math.round(activeGoal.target_amount - activeGoal.current_amount);
    items.push({
      id: 'goal',
      icon: 'flag-outline',
      iconColor: colors.neon,
      title: `Meta "${activeGoal.title}": ${pct}% alcanzado`,
      body: `Llevas el ${pct}% de tu meta. Te faltan ${formatCurrency(remaining)} para llegar a ${formatCurrency(activeGoal.target_amount)}.`,
      cta: { label: 'Ver ahorros', route: '/(app)/savings' },
    });
  }

  // ── 13. PRIMER DÍA DEL MES ────────────────────────────────────────────────
  if (dayOfMonth === 1) {
    items.push({
      id: 'month_start',
      icon: 'calendar-outline',
      iconColor: colors.primary,
      title: 'Primer día del mes',
      body: 'Es el primer día del mes. El mes pasado dijiste que ibas a gastar menos en salidas. ¿Arrancamos con el mismo objetivo o lo ajustamos?',
      cta: { label: 'Hablar con asesor', route: '/(app)/advisor' },
    });
  }

  return items.slice(0, 6);
}

function DatosClaveCard({ insights, open, onOpen, onClose }: { insights: DataInsight[]; open: boolean; onOpen: () => void; onClose: () => void }) {
  if (insights.length === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={dkStyles.card}
        onPress={onOpen}
        activeOpacity={0.85}
      >
        <View style={dkStyles.left}>
          <View style={dkStyles.iconWrap}>
            <Ionicons name="bulb-outline" size={18} color={colors.neon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="label" color={colors.text.secondary}>DATOS CLAVE DEL MES</Text>
            <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
              {insights[0].title}
            </Text>
          </View>
        </View>
        <View style={dkStyles.badge}>
          <Text style={dkStyles.badgeText}>{insights.length}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.text.tertiary} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
        <View style={dkStyles.overlay}>
          <View style={dkStyles.sheet}>
            <View style={dkStyles.sheetHeader}>
              <Text variant="h4" color={colors.text.primary}>Datos clave del mes</Text>
              <TouchableOpacity onPress={onClose} style={dkStyles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing[3], paddingBottom: spacing[8] }}>
              {insights.map((ins) => (
                <View key={ins.id} style={dkStyles.insightCard}>
                  <View style={dkStyles.insightHeader}>
                    <View style={[dkStyles.insightIcon, { backgroundColor: ins.iconColor + '18' }]}>
                      <Ionicons name={ins.icon as any} size={16} color={ins.iconColor} />
                    </View>
                    <Text variant="labelMd" color={colors.text.primary} style={{ flex: 1 }}>
                      {ins.title}
                    </Text>
                  </View>
                  <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 18 }}>
                    {ins.body}
                  </Text>
                  {ins.cta && (
                    <TouchableOpacity
                      style={[dkStyles.ctaBtn, { borderColor: ins.iconColor + '40', backgroundColor: ins.iconColor + '0A' }]}
                      onPress={() => { onClose(); router.push(ins.cta!.route as any); }}
                      activeOpacity={0.8}
                    >
                      <Text variant="label" color={ins.iconColor}>{ins.cta.label}</Text>
                      <Ionicons name="arrow-forward" size={12} color={ins.iconColor} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const dkStyles = StyleSheet.create({
  card:          { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, borderRadius: 16, padding: spacing[4] },
  left:          { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconWrap:      { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neon + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  badge:         { backgroundColor: colors.neon + '20', borderRadius: 10, paddingHorizontal: spacing[2], paddingVertical: 2 },
  badgeText:     { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: colors.neon },
  overlay:       { flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: colors.bg.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing[5], maxHeight: '88%' },
  sheetHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[4] },
  closeBtn:      { padding: spacing[2] },
  insightCard:   { backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, borderRadius: 16, padding: spacing[4], gap: spacing[3] },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  insightIcon:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ctaBtn:        { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1, borderRadius: 10, paddingVertical: spacing[2], paddingHorizontal: spacing[3], alignSelf: 'flex-start' },
});

// ─── HomeHighlightCarousel ────────────────────────────────────────────────────

const CARD_W = Dimensions.get('window').width - layout.screenPadding * 2;

interface HomeHighlight {
  id:        string;
  tag:       string;
  tagColor:  string;
  title:     string;
  subtitle:  string;
  icon:      string;
  iconColor: string;
  cta?:      { label: string; route: string };
}

function buildHomeHighlights({
  totalThisMonth,
  totalDisposable,
  totalInvestable,
  estimatedIncome,
  expenses,
  goals,
}: {
  totalThisMonth:  number;
  totalDisposable: number;
  totalInvestable: number;
  estimatedIncome: number | null;
  expenses:        Expense[];
  goals:           SavingsGoal[];
}): HomeHighlight[] {
  const items: HomeHighlight[] = [];

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
      cta: { label: 'Hablar con asesor', route: '/(app)/advisor' },
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

  return items.slice(0, 4);
}

function HighlightSlide({ highlight, width }: { highlight: HomeHighlight; width: number }) {
  return (
    <TouchableOpacity
      activeOpacity={highlight.cta ? 0.85 : 1}
      onPress={highlight.cta ? () => router.push(highlight.cta!.route as any) : undefined}
      style={[slideStyles.card, { width }]}
    >
      <View style={[slideStyles.tagRow, { backgroundColor: highlight.tagColor + '15' }]}>
        <Ionicons name={highlight.icon as any} size={12} color={highlight.iconColor} />
        <Text style={[slideStyles.tag, { color: highlight.tagColor }]}>{highlight.tag}</Text>
      </View>

      <Text style={slideStyles.title} numberOfLines={2}>{highlight.title}</Text>

      <Text variant="caption" color={colors.text.secondary} style={slideStyles.subtitle} numberOfLines={3}>
        {highlight.subtitle}
      </Text>

      {highlight.cta && (
        <View style={[slideStyles.cta, { backgroundColor: highlight.iconColor + '12', borderColor: highlight.iconColor + '35' }]}>
          <Text style={[slideStyles.ctaText, { color: highlight.iconColor }]}>{highlight.cta.label}</Text>
          <Ionicons name="arrow-forward" size={11} color={highlight.iconColor} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const slideStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[5], gap: spacing[3],
  },
  tagRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    alignSelf: 'flex-start', borderRadius: 20,
    paddingHorizontal: spacing[3], paddingVertical: 4,
  },
  tag:      { fontFamily: 'Montserrat_700Bold', fontSize: 10, letterSpacing: 0.6 },
  title:    { fontFamily: 'Montserrat_700Bold', fontSize: 24, color: colors.text.primary, lineHeight: 30 },
  subtitle: { lineHeight: 18 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    marginTop: spacing[1],
  },
  ctaText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 11 },
});

function HomeHighlightCarousel({ highlights }: { highlights: HomeHighlight[] }) {
  const scrollRef  = useRef<ScrollView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused,      setPaused]      = useState(false);

  const scrollTo = useCallback((index: number) => {
    scrollRef.current?.scrollTo({ x: index * CARD_W, animated: true });
  }, []);

  useEffect(() => {
    if (highlights.length <= 1 || paused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setActiveIndex(prev => {
        const next = (prev + 1) % highlights.length;
        scrollTo(next);
        return next;
      });
    }, 4500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [paused, highlights.length, scrollTo]);

  if (highlights.length === 0) return null;

  return (
    <View style={carouselStyles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        decelerationRate="fast"
        bounces={false}
        onScrollBeginDrag={() => {
          setPaused(true);
          if (intervalRef.current) clearInterval(intervalRef.current);
        }}
        onMomentumScrollEnd={e => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_W);
          setActiveIndex(idx);
          setPaused(false);
        }}
      >
        {highlights.map(h => <HighlightSlide key={h.id} highlight={h} width={CARD_W} />)}
      </ScrollView>

      {highlights.length > 1 && (
        <View style={carouselStyles.dots}>
          {highlights.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => { setActiveIndex(i); scrollTo(i); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[carouselStyles.dot, i === activeIndex && carouselStyles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const carouselStyles = StyleSheet.create({
  container: { gap: spacing[3] },
  dots:      { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border.default },
  dotActive: { width: 20, height: 6, borderRadius: 3, backgroundColor: colors.primary },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

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
    subscriptions,
  } = useExpensesStore();
  const { goals, fetchGoals } = useGoalsStore();
  const streakStore  = useStreakStore();
  const roundUpStore = useRoundUpStore();
  const [showRoundUpConfig,   setShowRoundUpConfig]   = useState(false);
  const [showDatosClaveModal, setShowDatosClaveModal] = useState(false);
  const [market, setMarket] = useState<MarketData>({ blue: null, mep: null });

  const [prevMonthCats,  setPrevMonthCats]  = useState<Record<string, { name: string; amount: number }>>({});
  const [prevMonthTotal, setPrevMonthTotal] = useState(0);

  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchSubscriptionsAndProjection(user.id);
      fetchGoals(user.id);
    }
    streakStore.load();
    roundUpStore.load();
    roundUpStore.checkReset();
    fetchMarketData().then(setMarket);
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

  // Notificaciones
  useEffect(() => {
    if (!estimatedIncome || estimatedIncome <= 0) return;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();
    scheduleBudgetAlert(totalThisMonth / estimatedIncome, estimatedIncome - totalThisMonth, daysLeft).catch(() => {});
  }, [totalThisMonth, estimatedIncome]);

  const recentExpenses = expenses.slice(0, 4);

  const highlights = buildHomeHighlights({
    totalThisMonth,
    totalDisposable,
    totalInvestable,
    estimatedIncome,
    expenses,
    goals,
  });

  const keyInsights = buildKeyInsights({
    expenses, subscriptions, totalThisMonth, totalDisposable,
    totalInvestable, estimatedIncome, goals, prevMonthCats, prevMonthTotal,
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

  // ── Health Score ────────────────────────────────────────────────────────────
  const healthScore = computeHealthScore({
    totalThisMonth,
    totalDisposable,
    totalInvested:      0,  // se podría conectar a savingsStore cuando esté disponible
    investmentTypes:    0,
    hasSavings:         false,
    weekStreak:         streakStore.weekStreak,
    noDisposableStreak: streakStore.noDisposableStreak,
    goals,
  });

  // ── Oportunidades pasadas (historial de decisiones) ──────────────────────
  const pastOpportunities = buildOpportunities(
    expenses
      .filter(e => e.classification === 'disposable')
      .reduce<{ monthKey: string; disposable: number }[]>((acc, e) => {
        const mk = e.date.slice(0, 7); // YYYY-MM
        const existing = acc.find(x => x.monthKey === mk);
        if (existing) {
          existing.disposable += e.amount;
        } else {
          acc.push({ monthKey: mk, disposable: e.amount });
        }
        return acc;
      }, [])
  );

  // Contexto para el asesor desde RecoverableCard
  const recoverableCtx = totalDisposable > 0
    ? [
        `Tengo ${formatCurrency(totalDisposable)} en gastos prescindibles este mes.`,
        `Si redujera la mitad (${formatCurrency(Math.round(totalDisposable * 0.5))}), ¿cuál sería mi mejor movimiento en Argentina hoy?`,
        `¿En qué instrumento lo meto y cuánto podría ganar por mes?`,
      ].join(' ')
    : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => user?.id && fetchExpenses(user.id)}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View>
              <Text variant="caption" color={colors.text.tertiary}>
                {getGreeting(profile?.full_name ?? undefined).split(',')[0].toUpperCase()}
              </Text>
              <Text variant="h4" color={colors.text.primary}>
                {profile?.full_name?.split(' ')[0] ?? 'Ahí vamos'} 👋
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(app)/profile')}
            style={styles.avatarBtn}
          >
            <Ionicons name="person-circle-outline" size={36} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* ── Hero: estado del mes ────────────────────────────────────────────── */}
        <MonthHeroCard
          totalThisMonth={totalThisMonth}
          totalNecessary={totalNecessary}
          totalDisposable={totalDisposable}
          totalInvestable={totalInvestable}
          estimatedIncome={estimatedIncome}
          expenses={expenses}
          onEditIncome={openIncomeModal}
        />

        {/* ── Acciones rápidas ────────────────────────────────────────────────── */}
        <QuickActions healthScore={healthScore} />

        {/* ── Radar financiero ───────────────────────────────────────────────── */}
        <HomeHighlightCarousel highlights={highlights} />

        {/* ── Datos clave del mes (modal desde header) ────────────────────────── */}
        <DatosClaveCard
          insights={keyInsights}
          open={showDatosClaveModal}
          onOpen={() => setShowDatosClaveModal(true)}
          onClose={() => setShowDatosClaveModal(false)}
        />

        {/* ── Top categorías ─────────────────────────────────────────────────── */}
        <TopCategoriesCard expenses={expenses} />

        {/* ── Dinero recuperable ──────────────────────────────────────────────── */}
        <RecoverableCard
          totalDisposable={totalDisposable}
          onPress={() => router.push({
            pathname: '/(app)/advisor',
            params: recoverableCtx ? { initialContext: recoverableCtx } : {},
          } as any)}
        />

        {/* ── Score de salud financiera ───────────────────────────────────────── */}
        <HealthScoreCard
          score={healthScore}
          input={{
            totalThisMonth,
            totalDisposable,
            totalInvested:      0,
            investmentTypes:    0,
            hasSavings:         false,
            weekStreak:         streakStore.weekStreak,
            noDisposableStreak: streakStore.noDisposableStreak,
            goals,
          }}
        />

        {/* ── Rachas activas ──────────────────────────────────────────────────── */}
        <StreakCard
          weekStreak={streakStore.weekStreak}
          noDisposableStreak={streakStore.noDisposableStreak}
          bestWeekStreak={streakStore.bestWeekStreak}
          monthsUnderBudget={streakStore.monthsUnderBudget}
        />

        {/* ── Redondeo automático ─────────────────────────────────────────────── */}
        <RoundUpSummary
          enabled={roundUpStore.enabled}
          roundTo={roundUpStore.roundTo}
          destination={roundUpStore.destination}
          totalThisWeek={roundUpStore.totalThisWeek}
          totalThisMonth={roundUpStore.totalThisMonth}
          totalAllTime={roundUpStore.totalAllTime}
          onConfigure={() => router.push('/(app)/profile')}
        />

        {/* ── Historial de decisiones ─────────────────────────────────────────── */}
        <DecisionHistorySection opportunities={pastOpportunities} />

        {/* ── Metas de ahorro ────────────────────────────────────────────────── */}
        {user?.id && (
          <GoalsSection userId={user.id} projectedMonthlyFree={projectedBalance} />
        )}

        {/* ── Últimos gastos ──────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.text.secondary}>ÚLTIMOS GASTOS</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/expenses')}>
            <Text variant="label" color={colors.neon}>VER TODOS</Text>
          </TouchableOpacity>
        </View>

        {recentExpenses.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="wallet-outline" size={36} color={colors.text.tertiary} />
            <Text variant="body" color={colors.text.secondary} align="center">
              Todavía no cargaste gastos este mes.
            </Text>
            <TouchableOpacity onPress={() => router.push('/(app)/expenses')}>
              <Text variant="bodySmall" color={colors.neon}>+ Agregar primer gasto</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={styles.expenseList}>
            {recentExpenses.map((expense) => (
              <TouchableOpacity
                key={expense.id}
                style={styles.expenseItem}
                onPress={() => router.push('/(app)/expenses')}
                activeOpacity={0.7}
              >
                <View style={styles.expenseLeft}>
                  <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>
                    {expense.description}
                  </Text>
                  <View style={styles.expenseMeta}>
                    <Text variant="caption" color={colors.text.tertiary}>{expense.date}</Text>
                    {expense.classification && <Badge classification={expense.classification} label={expense.classification} small />}
                  </View>
                </View>
                <Text variant="labelMd" color={colors.text.primary}>
                  {formatCurrency(expense.amount)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.seeAllRow} onPress={() => router.push('/(app)/expenses')}>
              <Text variant="label" color={colors.text.secondary}>Ver todos los gastos</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* ── Modal editar ingreso ────────────────────────────────────────────── */}
      <Modal
        visible={showIncomeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIncomeModal(false)}
      >
        <View style={styles.incomeOverlay}>
          <View style={styles.incomeSheet}>
            <View style={styles.incomeSheetHandle} />
            <View style={styles.incomeSheetHeader}>
              <Text variant="subtitle">¿Cuánto ganás por mes?</Text>
              <TouchableOpacity onPress={() => setShowIncomeModal(false)}>
                <Ionicons name="close" size={22} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <Text variant="caption" color={colors.text.tertiary} style={{ marginBottom: spacing[4] }}>
              Ingreso neto mensual aproximado. Se usa para calcular tu salud financiera.
            </Text>
            <View style={styles.incomeOptions}>
              {INCOME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.incomeOption, selectedRange === opt.value && styles.incomeOptionActive]}
                  onPress={() => setSelectedRange(opt.value)}
                >
                  <Text
                    variant="bodySmall"
                    color={selectedRange === opt.value ? colors.primary : colors.text.primary}
                    style={{ fontFamily: selectedRange === opt.value ? 'Montserrat_700Bold' : 'Montserrat_400Regular' }}
                  >
                    {opt.label}
                  </Text>
                  {selectedRange === opt.value && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.incomeSaveBtn, (!selectedRange || savingIncome) && { opacity: 0.5 }]}
              onPress={saveIncome}
              disabled={!selectedRange || savingIncome}
            >
              {savingIncome
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 14, color: colors.white }}>Guardar</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[6],
    gap: spacing[4],
  },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: spacing[2],
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  logo:        { width: 36, height: 36, borderRadius: 8 },
  avatarBtn:   { padding: spacing[1] },
  insightBtn:  { padding: spacing[1], position: 'relative' },
  insightBadge: {
    position: 'absolute', top: 0, right: 0,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.neon,
    alignItems: 'center', justifyContent: 'center',
  },
  insightBadgeText: { fontFamily: 'Montserrat_700Bold', fontSize: 8, color: colors.bg.primary },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing[2],
  },

  // Expenses
  expenseList: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 14, overflow: 'hidden',
  },
  expenseItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[5], paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  expenseLeft: { flex: 1, marginRight: spacing[4], gap: spacing[1] },
  expenseMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  seeAllRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    paddingVertical: spacing[4],
  },
  emptyCard: { padding: spacing[6], alignItems: 'center', gap: spacing[4] },

  // Income modal
  incomeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  incomeSheet: {
    backgroundColor: colors.bg.primary, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing[5], paddingBottom: spacing[10], gap: spacing[3],
  },
  incomeSheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.default,
    alignSelf: 'center', marginBottom: spacing[2],
  },
  incomeSheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1],
  },
  incomeOptions: { gap: spacing[2] },
  incomeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[4], paddingHorizontal: spacing[4],
    borderRadius: 10, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.secondary,
  },
  incomeOptionActive: { borderColor: colors.primary, backgroundColor: colors.primary + '0D' },
  incomeSaveBtn: {
    marginTop: spacing[3], backgroundColor: colors.primary,
    borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center',
  },
});
