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
import { Text, Card, PressableCard, AmountDisplay, Badge } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useGoalsStore, type SavingsGoal } from '@/store/goalsStore';
import { useSavingsStore } from '@/store/savingsStore';
import type { Expense } from '@/types';
import { GoalsSection } from '@/components/GoalsSection';
import { StreakCard } from '@/components/StreakCard';
import { HealthScoreCard, computeHealthScore } from '@/components/HealthScore';
import { DecisionHistorySection, buildOpportunities } from '@/components/DecisionHistory';
import { MoneyBagIcon } from '@/components/MoneyBagIcon';
import { RoundUpSummary } from '@/components/RoundUpSummary';
import { useStreakStore } from '@/store/streakStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import { scheduleBudgetAlert } from '@/lib/notifications';
import { MonthInsightCard } from '@/components/MonthInsightCard';
import { getGreeting, formatCurrency } from '@/utils/format';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { calculatePersonalInflation } from '@/utils/inflationCalc';
import { HomeSkeletonLoader } from '@/components/ui/SkeletonLoader';
import { SmartWidget } from '@/components/SmartWidget';
import { computeAllWidgets } from '@/lib/widgetEngine';

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

  const barAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const targetPct = estimatedIncome && estimatedIncome > 0
      ? Math.min(totalThisMonth / estimatedIncome, 1)
      : 0;
    Animated.timing(barAnim, {
      toValue: targetPct,
      duration: 900,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, [totalThisMonth, estimatedIncome]);

  const handlePressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const handlePressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();

  const incomePct  = estimatedIncome && estimatedIncome > 0
    ? Math.min(totalThisMonth / estimatedIncome, 1)
    : null;

  const now        = new Date();
  const monthLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
                        .toUpperCase();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
    <TouchableOpacity
      style={[heroStyles.card, { borderColor: cfg.border, backgroundColor: cfg.bg }]}
      onPress={() => router.push('/(app)/expenses' as any)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
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
          <Animated.View
            style={[
              heroStyles.progressFill,
              {
                width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: cfg.color,
              },
            ]}
          />
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
    </Animated.View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    borderWidth: 1, borderRadius: 20,
    padding: spacing[5], gap: spacing[3], overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
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
  pctText:     { fontFamily: 'Montserrat_700Bold', fontSize: 24, lineHeight: 28, letterSpacing: -0.5 },
  progressTrack: {
    height: 6, backgroundColor: colors.border.subtle, borderRadius: 3,
    overflow: 'hidden', position: 'relative',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  dayMarker: {
    position: 'absolute', top: -2, bottom: -2,
    width: 2, backgroundColor: colors.text.tertiary + '80', borderRadius: 1,
  },
  kpiRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border.subtle,
    marginTop: spacing[1],
  },
  kpiItem:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  kpiDot:     { width: 6, height: 6, borderRadius: 3 },
  kpiDivider: { width: 1, height: 28, backgroundColor: colors.border.subtle, marginHorizontal: spacing[2] },
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
          POTENCIAL DE INVERSIÓN ESTE MES
        </Text>
      </View>

      {/* Número protagonista */}
      <Text style={recStyles.amount}>{formatCurrency(recoverable)}</Text>
      <Text variant="caption" color={colors.text.secondary}>
        Podés recuperar hasta este monto recortando prescindibles ({formatCurrency(totalDisposable)}/mes)
      </Text>

      {/* FCI hint */}
      <View style={recStyles.hintRow}>
        <Ionicons name="trending-up-outline" size={13} color={colors.neon} />
        <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
          Convertilo en FCI Money Market y generá ~
          <Text variant="caption" color={colors.neon}>+{formatCurrency(fciEstimate)}/mes</Text>
          {' '}sin hacer nada más.
        </Text>
      </View>

      {/* CTA */}
      <View style={recStyles.cta}>
        <Text style={recStyles.ctaText}>Convertí este ahorro en inversión</Text>
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

const CAT_ICONS_TOP: Record<string, string> = {
  'Entretenimiento': 'game-controller-outline', 'Comida y restaurantes': 'restaurant-outline',
  'Transporte': 'car-outline', 'Supermercado': 'cart-outline', 'Salud': 'medical-outline',
  'Ropa y calzado': 'shirt-outline', 'Viajes': 'airplane-outline', 'Educación': 'school-outline',
  'Hogar y servicios': 'home-outline', 'Tecnología': 'phone-portrait-outline',
  'Otros': 'ellipsis-horizontal-circle-outline',
};

function TopCategoriesCard({ expenses }: { expenses: Expense[] }) {
  if (expenses.length === 0) return null;

  const catMap: Record<string, { amount: number; color: string }> = {};
  const totalAmt = expenses.reduce((s, e) => s + e.amount, 0);
  if (totalAmt === 0) return null;

  expenses.forEach(e => {
    const name  = (e as any).category?.name_es ?? 'Otros';
    const color = (e as any).category?.color   ?? '#7C3AED';
    if (!catMap[name]) catMap[name] = { amount: 0, color };
    catMap[name].amount += e.amount;
  });

  const sorted = Object.entries(catMap)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 4);

  return (
    <View style={tcS.wrap}>
      <View style={tcS.header}>
        <Text style={tcS.title}>Top categorías</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/reports' as any)}>
          <Text style={tcS.link}>Ver análisis</Text>
        </TouchableOpacity>
      </View>
      <View style={tcS.card}>
        {sorted.map(([name, { amount, color }], idx) => {
          const pct = Math.round((amount / totalAmt) * 100);
          const iconName = (CAT_ICONS_TOP[name] ?? 'receipt-outline') as any;
          return (
            <React.Fragment key={name}>
              {idx > 0 && <View style={tcS.divider} />}
              <View style={tcS.row}>
                <View style={[tcS.iconWrap, { backgroundColor: color + '22' }]}>
                  <Ionicons name={iconName} size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={tcS.rowTop}>
                    <Text style={tcS.catName} numberOfLines={1}>{name}</Text>
                    <Text style={tcS.pct}>{pct}%</Text>
                    <Text style={tcS.amt}>{formatCurrency(amount)}</Text>
                  </View>
                  <View style={tcS.barTrack}>
                    <View style={[tcS.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                  </View>
                </View>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const tcS = StyleSheet.create({
  wrap:    { gap: 10 },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 16, color: '#212121' },
  link:    { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: '#2E7D32' },
  card: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E0E0',
    borderRadius: 16, padding: 16, gap: 0,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 10 },
  row:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  rowTop:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catName: { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#212121', marginRight: 4 },
  pct:     { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#757575', minWidth: 32, textAlign: 'right', flexShrink: 0 },
  amt:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#212121', minWidth: 80, textAlign: 'right', flexShrink: 0 },
  barTrack: { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  barFill:  { height: '100%', borderRadius: 3 },
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
  market, totalInvestable, totalDisposable, inflationRate, fciRate,
}: {
  market:          MarketData;
  totalInvestable: number;
  totalDisposable: number;
  inflationRate:   number;
  fciRate:         number;
}) {
  const fmt = (n: number) => n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;

  const now = new Date();
  const monthLabel = now.toLocaleDateString('es-AR', { month: 'long' }).toUpperCase();

  const items = [
    { label: 'DÓLAR BLUE',           value: market.blue ? `$${Math.round(market.blue).toLocaleString('es-AR')}` : '--', sub: 'venta hoy',       color: colors.neon },
    { label: 'DÓLAR MEP',            value: market.mep  ? `$${Math.round(market.mep).toLocaleString('es-AR')}`  : '--', sub: 'venta hoy',       color: colors.neon },
    { label: `INFLACIÓN ${monthLabel}`, value: `${inflationRate.toFixed(1)}%`,                                           sub: 'INDEC mensual',   color: colors.yellow },
    { label: 'FCI MM EST./MES',      value: `${fciRate.toFixed(1)}%`,                                                   sub: 'rendimiento',     color: colors.primary },
    { label: 'DISPONIBLE',           value: fmt(totalInvestable),                                                        sub: 'para invertir',   color: '#A78BFA' },
    { label: 'PRESCINDIBLE/MES',     value: fmt(totalDisposable),                                                        sub: 'podrías recortar', color: colors.red },
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
  expenses, totalThisMonth, totalDisposable,
  totalInvestable, estimatedIncome, goals, prevMonthCats, prevMonthTotal, inflationRate,
  threeMonthAvgCats, fciRate, weekStreak,
}: {
  expenses:           Expense[];
  totalThisMonth:     number;
  totalDisposable:    number;
  totalInvestable:    number;
  estimatedIncome:    number | null;
  goals:              SavingsGoal[];
  prevMonthCats:      Record<string, { name: string; amount: number }>;
  prevMonthTotal:     number;
  inflationRate:      number;
  threeMonthAvgCats:  Record<string, number>;
  fciRate:            number;
  weekStreak:         number;
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

  // ── 4. COMERCIO REPETIDO ESTA SEMANA ──────────────────────────────────────
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

  // ── 5a. CATEGORÍA POR ENCIMA DEL PROMEDIO 3 MESES ─────────────────────────
  if (Object.keys(threeMonthAvgCats).length > 0 && dayOfMonth >= 12) {
    const aboveAvg = Object.entries(currCats)
      .map(([name, { amount }]) => ({
        name, current: amount, avg: threeMonthAvgCats[name] ?? 0,
        pct: threeMonthAvgCats[name] ? ((amount - threeMonthAvgCats[name]) / threeMonthAvgCats[name]) * 100 : 0,
      }))
      .filter(x => x.avg > 0 && x.pct > 35)
      .sort((a, b) => b.pct - a.pct);
    if (aboveAvg.length > 0) {
      const top = aboveAvg[0];
      items.push({
        id: 'above_3m_avg',
        icon: 'trending-up-outline',
        iconColor: colors.red,
        title: `${top.name}: +${Math.round(top.pct)}% vs tu promedio`,
        body: `Este mes gastaste ${formatCurrency(Math.round(top.current))} en ${top.name} — un ${Math.round(top.pct)}% más que tu promedio de los últimos 3 meses (${formatCurrency(Math.round(top.avg))}). ¿Fue algo puntual o se está instalando como hábito?`,
        cta: { label: 'Ver análisis', route: '/(app)/expenses?tab=analisis' },
      });
    }
  }

  // ── 5b. DELIVERY Y RESTAURANTES ────────────────────────────────────────────
  {
    const foodTotal = sortedCats
      .filter(c => ['comida', 'restaurante', 'delivery', 'gastronomía'].some(k => c.name.toLowerCase().includes(k)))
      .reduce((s, c) => s + c.amount, 0);
    if (foodTotal > 0 && estimatedIncome && estimatedIncome > 0) {
      const pct = Math.round((foodTotal / estimatedIncome) * 100);
      const streaming = Math.round(foodTotal / 4500);
      if (pct >= 10) {
        items.push({
          id: 'food_delivery',
          icon: 'bicycle-outline',
          iconColor: '#EA580C',
          title: `${pct}% del ingreso en comida y delivery`,
          body: `Gastaste ${formatCurrency(Math.round(foodTotal))} en comida y delivery. Con ese dinero podrías pagar ${streaming} meses de suscripciones de streaming o arrancar un plazo fijo. ¿Cuánto cocinaste en casa este mes?`,
        });
      }
    }
  }

  // ── 5c. SUSCRIPCIONES DETECTADAS ──────────────────────────────────────────
  {
    const subsKW = ['netflix', 'spotify', 'disney', 'hbo', 'amazon', 'apple', 'youtube', 'flow', 'paramount', 'deezer', 'mubi'];
    const subsExps = expenses.filter(e => subsKW.some(k => e.description.toLowerCase().includes(k)));
    if (subsExps.length >= 3 && dayOfMonth >= 10) {
      const subsTotal = subsExps.reduce((s, e) => s + e.amount, 0);
      items.push({
        id: 'subs_check',
        icon: 'play-circle-outline',
        iconColor: '#7C3AED',
        title: `${subsExps.length} suscripciones activas: ${formatCurrency(Math.round(subsTotal))}`,
        body: `¿Usás todas? El 40% de las personas paga suscripciones que no usa. Una que canceles son ~${formatCurrency(Math.round(subsTotal / subsExps.length))}/mes de vuelta en el bolsillo. Revisalas 5 minutos este fin de semana.`,
      });
    }
  }

  // ── 5d. PLAZO FIJO / FCI VS INFLACIÓN ─────────────────────────────────────
  if (totalInvestable >= 20000 && fciRate > 0 && dayOfMonth > 5) {
    const monthly = Math.round(totalInvestable * (fciRate / 100));
    items.push({
      id: 'fci_hint',
      icon: 'cash-outline',
      iconColor: '#10B981',
      title: 'Tus pesos pierden contra la inflación',
      body: `Tenés ${formatCurrency(totalInvestable)} que podrían estar en un FCI Money Market (~${fciRate}% mensual) — generando ${formatCurrency(monthly)}/mes sin hacer nada más. En pesos parados, la inflación te los come semana a semana.`,
      cta: { label: 'Ver simulador', route: '/(app)/simulator' },
    });
  }

  // ── 5e. RACHA MOTIVADORA ─────────────────────────────────────────────────
  if (weekStreak >= 7 && totalDisposable < (estimatedIncome ?? Infinity) * 0.20 && estimatedIncome) {
    items.push({
      id: 'streak_motivator',
      icon: 'flame-outline',
      iconColor: colors.neon,
      title: `${weekStreak} días con hábito activo — y se nota`,
      body: `Llevas ${weekStreak} días seguidos registrando. Tus prescindibles están por debajo del 20% del ingreso este mes. Eso no pasa solo — es el efecto de mirar los números de frente.`,
    });
  }

  // ── 5f. DÍAS SIN REGISTRAR ────────────────────────────────────────────────
  if (expenses.length > 0) {
    const lastDate = expenses[0].date;
    const daysSince = Math.round((Date.now() - new Date(lastDate + 'T12:00:00').getTime()) / 86400000);
    if (daysSince >= 4) {
      items.push({
        id: 'no_register',
        icon: 'calendar-outline',
        iconColor: colors.yellow,
        title: `Hace ${daysSince} días que no registrás gastos`,
        body: `Sin registros se pierde el control — el gasto pasa sin que lo notes. ¿Tuviste compras estos días? Cargarlas tarda 30 segundos y te va a dar un panorama mucho más preciso del mes.`,
        cta: { label: 'Agregar gasto', route: '/(app)/expenses' },
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
    const INDEC_CPI    = inflationRate;
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

  // ── 14. PROYECCIÓN ANUAL ──────────────────────────────────────────────────
  if (estimatedIncome && estimatedIncome > 0 && totalThisMonth > 0 && dayOfMonth >= 18) {
    const saving = estimatedIncome - totalThisMonth;
    if (saving > 5000) {
      const annual     = Math.round(saving * 12);
      const fciAnnual  = Math.round(annual * (1 + fciRate / 100) * 12 * 0.08); // rough FCI gain
      items.push({
        id: 'annual_projection',
        icon: 'calendar-number-outline',
        iconColor: colors.neon,
        title: `A este ritmo ahorrás ${formatCurrency(annual)}/año`,
        body: `Con ${formatCurrency(saving)}/mes de margen, en 12 meses acumulás ${formatCurrency(annual)}. En FCI Money Market (~${fciRate.toFixed(1)}%/mes), sumaría ~${formatCurrency(fciAnnual)} de rendimiento extra.`,
        cta: { label: 'Ver simulador', route: '/(app)/simulator' },
      });
    } else if (saving < 0) {
      const deficit = Math.abs(saving);
      items.push({
        id: 'annual_deficit_warning',
        icon: 'alert-circle-outline',
        iconColor: colors.red,
        title: `A este ritmo, déficit anual de ${formatCurrency(deficit * 12)}`,
        body: `Estás gastando ${formatCurrency(deficit)}/mes por encima del ingreso. En 12 meses eso suma ${formatCurrency(deficit * 12)} de deuda acumulada. Cada mes que no se corrige, el problema crece.`,
        cta: { label: 'Ver análisis', route: '/(app)/reports' },
      });
    }
  }

  // ── 15. SIMULACIÓN: reducir prescindibles ─────────────────────────────────
  if (totalDisposable >= 15000 && dayOfMonth >= 10) {
    const cut20  = Math.round(totalDisposable * 0.2);
    const annual = cut20 * 12;
    items.push({
      id: 'sim_reduce_disposable',
      icon: 'calculator-outline',
      iconColor: colors.primary,
      title: `Recortá prescindibles 20% = ${formatCurrency(annual)}/año`,
      body: `${formatCurrency(cut20)}/mes menos en gastos no esenciales × 12 meses = ${formatCurrency(annual)}. Suficiente para empezar un fondo de emergencia o invertir en FCI.`,
      cta: { label: 'Ver informe', route: '/(app)/reports' },
    });
  }

  return items.slice(0, 9);
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

// ─── UnconfirmedExpensesBanner ────────────────────────────────────────────────

function GmailPendingBanner({ count, onPress }: { count: number; onPress: () => void }) {
  if (count === 0) return null;
  return (
    <TouchableOpacity style={gpStyles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={gpStyles.left}>
        <View style={gpStyles.iconWrap}>
          <Ionicons name="time-outline" size={20} color="#F57F17" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={gpStyles.title}>
            Tenés {count} gasto{count > 1 ? 's' : ''} sin clasificar
          </Text>
          <Text style={gpStyles.sub}>
            Ya están cargados en tus gastos. Solo falta elegir la categoría.
          </Text>
        </View>
      </View>
      <View style={gpStyles.cta}>
        <Text style={gpStyles.ctaText}>Clasificar</Text>
        <Ionicons name="chevron-forward" size={14} color="#F57F17" />
      </View>
    </TouchableOpacity>
  );
}

const gpStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: '#FFFDE7',
    borderWidth: 1, borderColor: '#FFE082',
    borderLeftWidth: 4, borderLeftColor: '#FB8C00',
    borderRadius: 16, padding: spacing[4],
    shadowColor: '#FB8C00', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
  },
  left:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconWrap:{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:   { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#212121', marginBottom: 2 },
  sub:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#8D6E63', lineHeight: 16 },
  cta:     { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  ctaText: { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#E65100' },
});

// ─── MonthSpendingMini ────────────────────────────────────────────────────────

function MonthSpendingMini({
  totalThisMonth,
  estimatedIncome,
  hideAmounts,
}: {
  totalThisMonth:  number;
  estimatedIncome: number | null;
  hideAmounts?:    boolean;
}) {
  const barAnim   = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const pct      = estimatedIncome && estimatedIncome > 0
    ? Math.min(totalThisMonth / estimatedIncome, 1)
    : 0;
  const pctInt   = Math.round(pct * 100);
  const barColor = pct > 1 ? '#C62828' : pct > 0.85 ? '#E65100' : '#2E7D32';

  useEffect(() => {
    if (!estimatedIncome || estimatedIncome <= 0 || totalThisMonth <= 0) return;
    Animated.timing(barAnim, {
      toValue: pct,
      duration: 800,
      delay: 400,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  if (!estimatedIncome || estimatedIncome <= 0 || totalThisMonth <= 0) return null;

  const pressIn  = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 50, bounciness: 4 }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
    <TouchableOpacity
      style={msmStyles.card}
      onPress={() => router.push('/(app)/expenses' as any)}
      onPressIn={pressIn}
      onPressOut={pressOut}
      activeOpacity={1}
    >
      {/* Left: amount spent */}
      <View style={msmStyles.left}>
        <Text style={msmStyles.label}>Gastaste en el mes</Text>
        <Text style={msmStyles.amount}>{hideAmounts ? '••••••' : formatCurrency(totalThisMonth)}</Text>
      </View>

      {/* Right: income ref + bar + pct */}
      <View style={msmStyles.right}>
        <Text style={msmStyles.incomeRef}>{hideAmounts ? 'de ••••••' : `de ${formatCurrency(estimatedIncome)}`}</Text>
        <View style={msmStyles.barTrack}>
          <Animated.View
            style={[
              msmStyles.barFill,
              {
                width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: barColor,
              },
            ]}
          />
        </View>
        <Text style={[msmStyles.pctText, { color: barColor }]}>{pctInt}% del ingreso</Text>
      </View>
    </TouchableOpacity>
    </Animated.View>
  );
}

const msmStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20, borderWidth: 1, borderColor: '#EEEEEE',
    paddingHorizontal: 20, paddingVertical: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  left:      { flex: 1, gap: 5, paddingRight: 20 },
  right:     { flex: 1, gap: 7, alignItems: 'flex-start' },
  label:     { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#9E9E9E', letterSpacing: 0.3 },
  amount:    { fontFamily: 'Montserrat_700Bold', fontSize: 26, color: '#212121', letterSpacing: -0.5 },
  incomeRef: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#BDBDBD' },
  barTrack:  { height: 8, width: '100%', backgroundColor: '#F0F0F0', borderRadius: 4, overflow: 'hidden' },
  barFill:   { height: '100%', borderRadius: 4 },
  pctText:   { fontFamily: 'Montserrat_700Bold', fontSize: 13 },
});

// ─── CompactWidgetsRow ────────────────────────────────────────────────────────

function CompactWidgetsRow({
  totalDisposable,
  healthScore,
  onRecoverablePress,
}: {
  totalDisposable:    number;
  healthScore:        number;
  onRecoverablePress: () => void;
}) {
  const recoverable = Math.round(totalDisposable * 0.5);
  const scoreColor  = healthScore >= 85 ? colors.neon
    : healthScore >= 70 ? colors.primary
    : healthScore >= 50 ? colors.yellow
    : healthScore >= 30 ? '#FF6D00'
    : colors.red;
  const scoreLabel  = healthScore >= 85 ? 'excelente'
    : healthScore >= 70 ? 'en buen camino'
    : healthScore >= 50 ? 'hay margen'
    : 'a mejorar';

  return (
    <View style={{ flexDirection: 'row', gap: spacing[3] }}>
      {totalDisposable > 0 && (
        <TouchableOpacity style={[cwStyles.card, { flex: 1 }]} onPress={onRecoverablePress} activeOpacity={0.85}>
          <View style={cwStyles.labelRow}>
            <View style={[cwStyles.dot, { backgroundColor: colors.red }]} />
            <Text variant="label" color={colors.text.tertiary} style={{ fontSize: 9 }}>RECUPERABLE</Text>
          </View>
          <Text style={[cwStyles.bigNum, { color: colors.neon }]}>{formatCurrency(recoverable)}</Text>
          <Text variant="caption" color={colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>
            recortando prescindibles
          </Text>
          <View style={cwStyles.ctaRow}>
            <Text variant="label" color={colors.neon} style={{ fontSize: 10 }}>¿Cómo? →</Text>
          </View>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[cwStyles.card, { flex: 1 }]}
        onPress={() => router.push('/(app)/reports' as any)}
        activeOpacity={0.85}
      >
        <View style={cwStyles.labelRow}>
          <View style={[cwStyles.dot, { backgroundColor: scoreColor }]} />
          <Text variant="label" color={colors.text.tertiary} style={{ fontSize: 9 }}>SALUD FINANCIERA</Text>
        </View>
        <Text style={[cwStyles.bigNum, { color: scoreColor }]}>{healthScore}%</Text>
        <Text variant="caption" color={colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>
          {scoreLabel}
        </Text>
        <View style={cwStyles.ctaRow}>
          <Text variant="label" color={scoreColor} style={{ fontSize: 10 }}>Ver informe →</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const cwStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 14, padding: spacing[4], gap: spacing[2],
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  dot:      { width: 5, height: 5, borderRadius: 3, flexShrink: 0 },
  bigNum:   { fontFamily: 'Montserrat_700Bold', fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  ctaRow:   { marginTop: spacing[1] },
});

// ─── QuickStartCard ───────────────────────────────────────────────────────────

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

function MiniLineChart({ data, color }: { data: number[]; color: string }) {
  const W = 88; const H = 44;
  const nonZero = data.filter(v => v > 0);
  if (nonZero.length < 2) return <View style={{ width: W, height: H, flexShrink: 0 }} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - (v / max) * (H - 6) - 3,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <View style={{ width: W, height: H, flexShrink: 0 }}>
      <Svg width={W} height={H}>
        <SvgPath d={d} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// ─── OpportunityHeroCard ──────────────────────────────────────────────────────

interface OppInsight {
  label:    string;
  sublabel: string;
  amount:   string;
  sub:      string;
}

function buildOppInsights(
  recoverable:     number,
  totalThisMonth:  number,
  totalDisposable: number,
  estimatedIncome: number | null,
): OppInsight[] {
  const list: OppInsight[] = [];
  const now        = new Date();
  const day        = now.getDate();
  const daysTotal  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  if (recoverable > 0) {
    const spotify = Math.floor(recoverable / 4_500);
    list.push({
      label:    'TU OPORTUNIDAD ESTE MES',
      sublabel: 'Podés recuperar',
      amount:   formatCurrency(recoverable),
      sub:      spotify >= 2 ? `= ${spotify} meses de Spotify si ajustás estos gastos` : 'Si ajustás estos gastos',
    });
  }

  if (totalThisMonth > 0 && day >= 5) {
    const projected = Math.round((totalThisMonth / day) * daysTotal);
    const subText   = estimatedIncome && estimatedIncome > 0
      ? projected > estimatedIncome
        ? '⚠️ Superarías tu ingreso estimado'
        : `${Math.round((projected / estimatedIncome) * 100)}% de tu ingreso estimado`
      : `Quedan ${daysTotal - day} días del mes`;
    list.push({
      label:    'PREDICCIÓN DE FIN DE MES',
      sublabel: 'A este ritmo cerrás en',
      amount:   formatCurrency(projected),
      sub:      subText,
    });
  }

  if (totalThisMonth > 0) {
    list.push({
      label:    'IMPACTO ANUAL',
      sublabel: 'Tus gastos de este mes × 12',
      amount:   formatCurrency(totalThisMonth * 12),
      sub:      'Parece poco mes a mes. Anualizado ya no.',
    });
  }

  if (totalDisposable >= 15_000) {
    const nafta  = Math.floor(totalDisposable / 1_500);
    const cafes  = Math.floor(totalDisposable / 3_500);
    list.push({
      label:    'COSTO DE OPORTUNIDAD',
      sublabel: 'Gastaste en prescindibles',
      amount:   formatCurrency(totalDisposable),
      sub:      `= ${nafta} litros de nafta · ${cafes} cafés`,
    });
  }

  if (estimatedIncome && estimatedIncome > 0 && totalThisMonth > 0) {
    const dias = Math.round((totalThisMonth / estimatedIncome) * daysTotal);
    list.push({
      label:    'DÍAS TRABAJADOS',
      sublabel: 'Trabajaste este mes para pagar tus gastos',
      amount:   `${dias} ${dias === 1 ? 'día' : 'días'}`,
      sub:      `De ${daysTotal} días totales del mes`,
    });
  }

  return list;
}

function OpportunityHeroCard({
  recoverable, hasExpenses, totalThisMonth, totalDisposable, estimatedIncome, onPress, onNoData,
}: {
  recoverable:     number;
  hasExpenses:     boolean;
  totalThisMonth:  number;
  totalDisposable: number;
  estimatedIncome: number | null;
  onPress:         () => void;
  onNoData:        () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const pressIn   = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const pressOut  = () => Animated.spring(scaleAnim, { toValue: 1,    useNativeDriver: true, speed: 50, bounciness: 4 }).start();

  const insights     = useMemo(
    () => buildOppInsights(recoverable, totalThisMonth, totalDisposable, estimatedIncome),
    [recoverable, totalThisMonth, totalDisposable, estimatedIncome],
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [insights.length]);

  useEffect(() => {
    if (insights.length <= 1) return;
    const timer = setInterval(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => {
        setIdx(i => (i + 1) % insights.length);
        Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [insights.length]);

  if (!hasExpenses) {
    return (
      <TouchableOpacity style={oppStyles.noData} onPress={onNoData} activeOpacity={0.85}>
        <View style={oppStyles.noDataIcon}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="labelMd" color={colors.text.primary}>Registrá tu primer gasto</Text>
          <Text variant="caption" color={colors.text.secondary}>Configurá tu ingreso para ver tu oportunidad del mes</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={colors.text.tertiary} />
      </TouchableOpacity>
    );
  }
  if (insights.length === 0) return null;

  const insight = insights[idx];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={oppStyles.card}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={1}
      >
        <View style={oppStyles.content}>
          {/* Label + dots */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.Text style={[oppStyles.label, { opacity: fadeAnim, flex: 1 }]}>
              {insight.label}
            </Animated.Text>
            {insights.length > 1 && (
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {insights.map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: i === idx ? 14 : 5, height: 5, borderRadius: 3,
                      backgroundColor: i === idx ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
                    }}
                  />
                ))}
              </View>
            )}
          </View>

          <Animated.View style={{ opacity: fadeAnim }}>
            <Text style={oppStyles.sublabel}>{insight.sublabel}</Text>
            <Text style={oppStyles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {insight.amount}
            </Text>
            <Text style={oppStyles.sub}>{insight.sub}</Text>
          </Animated.View>

          <View style={oppStyles.btn}>
            <Text style={oppStyles.btnText}>Hablá con la IA</Text>
            <Ionicons name="sparkles-outline" size={13} color={colors.white} />
          </View>
        </View>
        <View style={oppStyles.deco}>
          <MoneyBagIcon size={96} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const oppStyles = StyleSheet.create({
  card: {
    backgroundColor: '#1B5E20',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'visible',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  content: { flex: 1, gap: spacing[1], paddingRight: 12 },
  label: { color: 'rgba(255,255,255,0.65)', fontFamily: 'Montserrat_600SemiBold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  sublabel: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Montserrat_400Regular', fontSize: 14, marginTop: spacing[1] },
  amount: { color: '#FFFFFF', fontFamily: 'Montserrat_700Bold', fontSize: 30, letterSpacing: -0.5, lineHeight: 36 },
  sub: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Montserrat_400Regular', fontSize: 13 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12, paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    alignSelf: 'flex-start', marginTop: spacing[3], height: 44,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  btnText: { color: '#FFFFFF', fontFamily: 'Montserrat_600SemiBold', fontSize: 13 },
  deco: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 96,
    height: 96,
  },
  noData: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  noDataIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary + '15',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
});

// ─── CompactInflationRow ──────────────────────────────────────────────────────

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

function ProjectedBalanceCard({
  expenses, estimatedIncome, onPress,
}: {
  expenses: Expense[];
  estimatedIncome: number | null;
  onPress: () => void;
}) {
  const now        = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const totalSoFar = expenses.reduce((s, e) => s + e.amount, 0);

  if (totalSoFar === 0 && !estimatedIncome) return null;

  const projectedSpend = dayOfMonth > 0 ? Math.round((totalSoFar / dayOfMonth) * daysInMonth) : 0;
  const projectedFree  = estimatedIncome ? estimatedIncome - projectedSpend : 0;

  // Daily cumulative for mini chart (last 14 days)
  const dailyMap: Record<string, number> = {};
  expenses.forEach(e => { dailyMap[e.date] = (dailyMap[e.date] ?? 0) + e.amount; });
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (13 - i));
    return dailyMap[d.toISOString().slice(0, 10)] ?? 0;
  });

  const color = !estimatedIncome ? colors.primary : projectedFree >= 0 ? colors.primary : colors.red;

  return (
    <TouchableOpacity style={pbCard.card} onPress={onPress} activeOpacity={0.85}>
      <View style={pbCard.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={pbCard.titleRow}>
            <Text variant="label" color={colors.text.secondary}>Saldo proyectado a fin de mes</Text>
            <Ionicons name="information-circle-outline" size={13} color={colors.text.tertiary} />
          </View>
          <Text variant="caption" color={colors.text.tertiary}>Si mantenés este ritmo</Text>
        </View>
        <MiniLineChart data={days} color={color} />
      </View>
      <Text style={[pbCard.amount, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {projectedFree < 0 ? '-' : ''}{formatCurrency(Math.abs(estimatedIncome ? projectedFree : totalSoFar))}
      </Text>
    </TouchableOpacity>
  );
}

const pbCard = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  amount: { fontFamily: 'Montserrat_700Bold', fontSize: 28, letterSpacing: -0.5, lineHeight: 34 },
});

// ─── TopLeakCard ──────────────────────────────────────────────────────────────

const CAT_ICONS: Record<string, string> = {
  'Entretenimiento': 'musical-notes', 'Comida y restaurantes': 'restaurant',
  'Transporte': 'car', 'Supermercado': 'cart', 'Salud': 'medical',
  'Ropa y calzado': 'shirt', 'Viajes': 'airplane', 'Educación': 'school',
  'Hogar y servicios': 'home-outline', 'Tecnología': 'phone-portrait',
};

const CAT_EMOJIS: Record<string, string> = {
  'Entretenimiento': '🍿',
};

function TopLeakCard({
  expenses, totalThisMonth, onPress,
}: {
  expenses: Expense[];
  totalThisMonth: number;
  onPress: () => void;
}) {
  if (expenses.length === 0 || totalThisMonth === 0) return null;

  const catMap: Record<string, number> = {};
  expenses.forEach(e => {
    const name = (e as any).category?.name_es ?? 'Sin clasificar';
    catMap[name] = (catMap[name] ?? 0) + e.amount;
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const [topName, topAmt] = sorted[0] ?? ['', 0];
  const pct = Math.round((topAmt / totalThisMonth) * 100);

  if (!topName || pct < 10) return null;

  const iconName = (CAT_ICONS[topName] ?? 'receipt') as any;
  const catEmoji = CAT_EMOJIS[topName];

  return (
    <TouchableOpacity style={leakCard.card} onPress={onPress} activeOpacity={0.85}>
      <View style={leakCard.iconWrap}>
        <Ionicons name={iconName} size={18} color="#7C3AED" />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="labelMd" color={colors.text.primary} numberOfLines={2} ellipsizeMode="tail">
          Tu mayor fuga: {topName}
        </Text>
        <Text variant="caption" color={colors.text.secondary}>
          Representa el {pct}% de tus gastos
        </Text>
        <View style={leakCard.cta}>
          <Text style={leakCard.ctaText}>Ver detalles</Text>
          <Ionicons name="arrow-forward" size={12} color="#2E7D32" />
        </View>
      </View>
      {catEmoji ? (
        <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Text style={{ fontSize: 40 }}>{catEmoji}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const leakCard = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E0E0',
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cta:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ctaText:  { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: '#2E7D32' },
});

// ─── QuickActionsSection ──────────────────────────────────────────────────────

function QuickActionsSection({
  expenses, onEditIncome,
}: {
  expenses: Expense[];
  onEditIncome: () => void;
}) {
  const catMap: Record<string, number> = {};
  expenses.forEach(e => {
    const name = (e as any).category?.name_es ?? 'Sin clasificar';
    catMap[name] = (catMap[name] ?? 0) + e.amount;
  });
  const topCatName = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  const shortName  = topCatName?.split(' ')[0].toLowerCase() ?? 'gastos';

  const actions = [
    { label: `Limitar\n${shortName}`,   icon: 'time-outline' as const,         onPress: () => router.push('/(app)/advisor' as any) },
    { label: 'Crear meta\nde ahorro',   icon: 'flag-outline' as const,         onPress: () => router.push('/(app)/savings' as any) },
    { label: 'Invertir\neste mes',      icon: 'bar-chart-outline' as const,    onPress: () => router.push('/(app)/simulator' as any) },
    { label: 'Ver todos\nlos gastos',   icon: 'receipt-outline' as const,      onPress: () => router.push('/(app)/expenses' as any) },
  ];

  return (
    <View style={qaNewStyles.wrap}>
      <View style={qaNewStyles.header}>
        <Text style={qaNewStyles.title}>Acciones rápidas</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/expenses' as any)}>
          <Text style={qaNewStyles.headerLink}>Ver todas</Text>
        </TouchableOpacity>
      </View>
      <View style={qaNewStyles.grid}>
        {actions.map(a => (
          <TouchableOpacity key={a.label} style={qaNewStyles.item} onPress={a.onPress} activeOpacity={0.75}>
            <View style={qaNewStyles.circle}>
              <Ionicons name={a.icon} size={22} color="#424242" />
            </View>
            <Text style={qaNewStyles.label} numberOfLines={2}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const qaNewStyles = StyleSheet.create({
  wrap:       { gap: spacing[3] },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 16, color: '#212121' },
  headerLink: { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: '#2E7D32' },
  grid:       { flexDirection: 'row', gap: spacing[2] },
  item:       { flex: 1, alignItems: 'center', gap: spacing[2] },
  circle:     { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  label:      { fontSize: 11, fontFamily: 'Montserrat_500Medium', textAlign: 'center', lineHeight: 15, color: '#424242' },
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
  } = useExpensesStore();
  const { goals, fetchGoals }                = useGoalsStore();
  const { investments, fetchAll: loadSavings } = useSavingsStore();
  const streakStore  = useStreakStore();
  const roundUpStore = useRoundUpStore();
  const [inflationRate,  setInflationRate]  = useState(3.4);
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
  const [fciRate,           setFciRate]           = useState(3.2);
  const [homeBudgets,       setHomeBudgets]       = useState<Array<{ id: string; category_id: string; monthly_limit: number }> | null>(null);

  const _now         = new Date();
  const _dayOfMonth  = _now.getDate();
  const _daysInMonth = new Date(_now.getFullYear(), _now.getMonth() + 1, 0).getDate();

  const allWidgets = useMemo(() => computeAllWidgets({
    expenses,
    totalDisposable,
    totalThisMonth,
    estimatedIncome,
    homeBudgets: homeBudgets ?? [],
    dayOfMonth:  _dayOfMonth,
    daysInMonth: _daysInMonth,
  }), [expenses, totalDisposable, totalThisMonth, estimatedIncome, homeBudgets]);

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

    // Inflación del mes desde DB (para insights)
    (supabase as any)
      .from('market_rates')
      .select('rate_monthly')
      .eq('instrument', 'inflation')
      .single()
      .then(({ data }: { data: { rate_monthly: number } | null }) => { if (data) setInflationRate(Number(data.rate_monthly)); });

    // FCI Money Market rate
    (supabase as any)
      .from('market_rates')
      .select('rate_monthly')
      .eq('instrument', 'fci_mm')
      .single()
      .then(({ data }: { data: { rate_monthly: number } | null }) => { if (data) setFciRate(Number(data.rate_monthly)); });

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

      (supabase as any)
        .from('category_budgets')
        .select('id, category_id, monthly_limit')
        .eq('user_id', user.id)
        .then(({ data }: { data: Array<{ id: string; category_id: string; monthly_limit: number }> | null }) =>
          setHomeBudgets(data ?? []),
        );
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

  const keyInsights = buildKeyInsights({
    expenses: expenses.filter(e => e.category_id !== null),
    totalThisMonth, totalDisposable,
    totalInvestable, estimatedIncome, goals, prevMonthCats, prevMonthTotal, inflationRate,
    threeMonthAvgCats, fciRate, weekStreak: streakStore.weekStreak,
  });

  // ── Datos clave del mes ─────────────────────────────────────────────────────
  const [showDatosClaveModal, setShowDatosClaveModal] = useState(false);

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
  const totalInvested   = investments.reduce((sum, inv) => sum + inv.amount, 0);
  const investmentTypes = new Set(investments.map(inv => inv.instrument_type)).size;

  const healthScore = computeHealthScore({
    totalThisMonth,
    totalDisposable,
    totalInvested,
    investmentTypes,
    hasSavings:         totalInvested > 0,
    weekStreak:         streakStore.weekStreak,
    noDisposableStreak: streakStore.noDisposableStreak,
    goals,
  });

  // ── Oportunidades pasadas (historial de decisiones) ──────────────────────
  const pastOpportunities = buildOpportunities(
    expenses
      .filter(e => e.classification === 'disposable')
      .reduce<{ monthKey: string; disposable: number; categories: Record<string, number> }[]>((acc, e) => {
        const mk      = e.date.slice(0, 7);
        const catName = (e as any).category?.name_es ?? 'Prescindibles';
        const existing = acc.find(x => x.monthKey === mk);
        if (existing) {
          existing.disposable += e.amount;
          existing.categories[catName] = (existing.categories[catName] ?? 0) + e.amount;
        } else {
          acc.push({ monthKey: mk, disposable: e.amount, categories: { [catName]: e.amount } });
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

  const healthLabel  = healthScore >= 85 ? 'Excelente' : healthScore >= 70 ? 'Estable' : healthScore >= 50 ? 'Mejorable' : 'Atención';
  const healthColor  = healthScore >= 85 ? '#22C55E' : healthScore >= 70 ? '#22C55E' : healthScore >= 50 ? '#F59E0B' : '#EF4444';
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
              <Text style={nStyles.greetingName}>Buen día, {firstName}</Text>
            </View>
            <Text style={nStyles.greetingSub}>Este es tu resumen del mes</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              style={nStyles.headerIconBtn}
              onPress={() => router.push('/(app)/advisor' as any)}
              activeOpacity={0.75}
            >
              <Ionicons name="notifications-outline" size={20} color="#1A1A1A" />
            </TouchableOpacity>
            <View style={nStyles.robotAvatar}>
              <Text style={{ fontSize: 22 }}>🤖</Text>
            </View>
            <TouchableOpacity
              style={nStyles.headerIconBtn}
              onPress={() => router.push('/(app)/advisor' as any)}
              activeOpacity={0.75}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── SKELETON ────────────────────────────────────────────────────────── */}
        {isLoading && expenses.length === 0 && <HomeSkeletonLoader />}

        {/* ── AI BANNER CAROUSEL ──────────────────────────────────────────────── */}
        <PremiumBannerCarousel highlights={highlights} />

        {/* ── 4-COLUMN FINANCIAL SUMMARY ──────────────────────────────────────── */}
        <View style={nStyles.summaryCard}>
          {/* Ahorro posible */}
          <TouchableOpacity style={nStyles.summaryBlock} onPress={() => router.push('/(app)/advisor' as any)} activeOpacity={0.8}>
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
            <Text style={[nStyles.summaryValue, { color: '#7C3AED' }]}>
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

        {/* ── ACTIVIDAD RECIENTE + OPORTUNIDAD ────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {/* Actividad reciente */}
          <View style={[nStyles.bottomCard, { flex: 1.1 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={nStyles.bottomCardTitle}>Actividad reciente</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/expenses' as any)}>
                <Text style={nStyles.bottomCardLink}>Ver todo</Text>
              </TouchableOpacity>
            </View>
            {expenses.slice(0, 3).map((exp, idx) => {
              const catName  = (exp as any).category?.name_es ?? 'Sin categoría';
              const isDisp   = exp.classification === 'disposable';
              const isNecess = exp.classification === 'necessary';
              const tagColor = isDisp ? '#EF4444' : isNecess ? '#3B82F6' : '#9CA3AF';
              const tagLabel = isDisp ? 'Prescindible' : isNecess ? 'Necesario' : 'Sin clasificar';
              return (
                <View key={exp.id}>
                  {idx > 0 && <View style={nStyles.activityDivider} />}
                  <View style={nStyles.activityRow}>
                    <View style={[nStyles.activityIcon, { backgroundColor: ((exp as any).category?.color ?? '#6B7280') + '18' }]}>
                      <Ionicons name="receipt-outline" size={15} color={(exp as any).category?.color ?? '#6B7280'} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={nStyles.activityMerchant} numberOfLines={1}>{exp.merchant || catName}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={nStyles.activityCat} numberOfLines={1}>{catName}</Text>
                        <Text style={{ fontSize: 8, color: '#D1D5DB' }}>·</Text>
                        <Text style={[nStyles.activityTag, { color: tagColor }]}>{tagLabel}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={nStyles.activityAmount}>-{formatCurrency(exp.amount)}</Text>
                      <Text style={nStyles.activityDate}>{exp.date.slice(5).replace('-', '/')}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
            {expenses.length === 0 && (
              <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 12 }}>
                Aún no hay gastos
              </Text>
            )}
          </View>

          {/* Oportunidad para vos */}
          <TouchableOpacity
            style={[nStyles.bottomCard, { flex: 0.9, backgroundColor: '#FFF7ED' }]}
            onPress={() => router.push('/(app)/simulator' as any)}
            activeOpacity={0.88}
          >
            <View style={nStyles.oppIconWrap}>
              <Text style={{ fontSize: 20 }}>💡</Text>
            </View>
            <Text style={nStyles.oppTitle}>Oportunidad para vos</Text>
            {totalDisposable > 0 ? (
              <Text style={nStyles.oppBody}>
                Si invertías tus gastos prescindibles de este mes ({formatCurrency(totalDisposable)}), en 12 meses podrías tener {formatCurrency(investedIn12m)}.
              </Text>
            ) : (
              <Text style={nStyles.oppBody}>
                Registrá tus gastos para ver tu oportunidad de inversión mensual.
              </Text>
            )}
            <View style={nStyles.oppBtn}>
              <Text style={nStyles.oppBtnText}>Ver simulación →</Text>
            </View>
          </TouchableOpacity>
        </View>

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

  // Bottom cards
  bottomCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  bottomCardTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1A1A1A' },
  bottomCardLink:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#22C55E' },

  // Activity rows
  activityRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  activityDivider:  { height: 1, backgroundColor: '#F3F4F6' },
  activityIcon:     { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  activityMerchant: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: '#1A1A1A' },
  activityCat:      { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#9CA3AF' },
  activityTag:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 10 },
  activityAmount:   { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#1A1A1A' },
  activityDate:     { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#9CA3AF' },

  // Opportunity card
  oppIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  oppTitle:    { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1A1A1A', marginBottom: 4 },
  oppBody:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#6B7280', lineHeight: 16, flex: 1 },
  oppBtn:      { backgroundColor: '#F59E0B', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 8 },
  oppBtnText:  { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#FFFFFF' },

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
