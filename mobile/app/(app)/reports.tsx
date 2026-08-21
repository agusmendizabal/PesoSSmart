import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import * as Print   from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useSavingsStore } from '@/store/savingsStore';
import { usePlanStore } from '@/store/planStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { InflationThermometer } from '@/components/InflationThermometer';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';

import {
  MONTH_NAMES,
  getCategoryColor,
  type CategoryRow,
  type MonthSummary,
  buildComparacion,
  buildAhorroSugerencias,
  CategoryBreakdown,
  HistoryComparisonCard,
  AdvisorCTA,
} from '@/components/ReportCards';

import {
  computeFinancialDiagnosis,
  type FinancialDiagnosis,
  type DiagnosticInsight,
  type HealthComponent,
} from '@/lib/financialDiagnosis';

// ─── PDF Builder ─────────────────────────────────────────────────────────────

function buildPdfHtml({
  userName, monthLabel, total, necessary, disposable, investable,
  estimatedIncome, inflationRate, fciRate, rows, totalInvested, healthScore, healthLabel,
}: {
  userName: string; monthLabel: string; total: number; necessary: number;
  disposable: number; investable: number; estimatedIncome: number | null;
  inflationRate: number; fciRate: number; rows: CategoryRow[];
  totalInvested: number; healthScore: number; healthLabel: string;
}): string {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
  const incomePct = estimatedIncome && estimatedIncome > 0
    ? `${Math.round((total / estimatedIncome) * 100)}% del ingreso` : '';
  const catRows = rows.slice(0, 6).map(r => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #222;">${r.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #222;text-align:right;">${fmt(r.amount)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #222;text-align:right;">${Math.round(r.pct * 100)}%</td>
    </tr>`).join('');
  const scoreColor = healthScore >= 70 ? '#27AE60' : healthScore >= 50 ? '#FFD740' : colors.red;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; background:#0D0D0D; color:#F0F0F0; padding:32px; }
.header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #C6F135; padding-bottom:16px; margin-bottom:24px; }
.logo { font-size:22px; font-weight:800; color:#C6F135; letter-spacing:-0.5px; }
.meta { text-align:right; font-size:12px; color:#888; }
.meta strong { color:#F0F0F0; display:block; font-size:15px; }
.section { background:#1A1A1A; border-radius:10px; padding:20px; margin-bottom:16px; }
h2 { font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:12px; }
.kpis { display:flex; gap:12px; flex-wrap:wrap; }
.kpi { flex:1; min-width:120px; background:#111; border-radius:8px; padding:14px; border-top:2px solid #333; }
.kpi-label { font-size:9px; color:#666; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
.kpi-val { font-size:20px; font-weight:800; color:#F0F0F0; }
.neon { color:#C6F135; } .red { color:#FF5252; } .yellow { color:#FFD740; }
.score { font-size:48px; font-weight:800; color:${scoreColor}; }
table { border-collapse:collapse; width:100%; font-size:13px; }
th { text-align:left; padding:8px 12px; font-size:10px; color:#888; letter-spacing:1px; border-bottom:1px solid #333; }
tr:last-child td { border-bottom:none; }
.footer { margin-top:24px; text-align:center; font-size:11px; color:#444; }
.footer span { color:#C6F135; }
</style></head><body>
<div class="header"><div class="logo">Nomi</div>
<div class="meta"><strong>${userName}</strong>Informe de ${monthLabel}</div></div>
<div class="section"><h2>Salud Financiera</h2>
<div class="score">${healthScore}</div>
<p style="color:#888;font-size:13px;margin-top:4px;">${healthLabel} — Score calculado sobre control de gasto, prescindibles, clasificación y tendencia histórica.</p></div>
<div class="section"><h2>Resumen del mes</h2>
<div class="kpis">
<div class="kpi"><div class="kpi-label">TOTAL GASTADO</div><div class="kpi-val">${fmt(total)}</div></div>
<div class="kpi"><div class="kpi-label">NECESARIO</div><div class="kpi-val">${fmt(necessary)}</div></div>
<div class="kpi"><div class="kpi-label">PRESCINDIBLE</div><div class="kpi-val red">${fmt(disposable)}</div></div>
<div class="kpi"><div class="kpi-label">INVERTIBLE</div><div class="kpi-val neon">${fmt(investable)}</div></div>
</div>
${incomePct ? `<p style="margin-top:12px;font-size:12px;color:#888;">Representa el <strong style="color:#F0F0F0">${incomePct}</strong> · Inflación del mes: <strong style="color:#FFD740">${inflationRate}%</strong></p>` : ''}
</div>
<div class="section"><h2>Top categorías de gasto</h2>
<table><tr><th>Categoría</th><th style="text-align:right">Monto</th><th style="text-align:right">% del total</th></tr>${catRows}</table></div>
<div class="footer">Generado por la <span>Inteligencia Financiera de Nomi</span> · ${new Date().toLocaleDateString('es-AR')}</div>
</body></html>`;
}

// ─── HealthScoreRing ─────────────────────────────────────────────────────────

function HealthScoreRing({ score, color, label }: { score: number; color: string; label: string }) {
  const SIZE = 120;
  const SW   = 10;
  const R    = (SIZE - SW) / 2;
  const CIRC = 2 * Math.PI * R;
  const animPct = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animPct, { toValue: score / 100, duration: 900, useNativeDriver: false, delay: 200 }).start();
  }, [score]);

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <SvgCircle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={colors.border.subtle} strokeWidth={SW} />
        <SvgCircle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
          stroke={color} strokeWidth={SW}
          strokeDasharray={`${CIRC * (score / 100)} ${CIRC * (1 - score / 100)}`}
          strokeDashoffset={CIRC / 4}
          strokeLinecap="round"
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 28, color, lineHeight: 32 }}>{score}</Text>
        <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: colors.text.tertiary, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      </View>
    </View>
  );
}

// ─── ComponentBar ────────────────────────────────────────────────────────────

function ComponentBar({ comp }: { comp: HealthComponent }) {
  const pct = comp.maxScore > 0 ? comp.score / comp.maxScore : 0;
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 700, useNativeDriver: false, delay: 300 }).start();
  }, [pct]);
  return (
    <View style={hsStyles.compRow}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={hsStyles.compLabel}>{comp.label}</Text>
          <Text style={[hsStyles.compScore, { color: comp.color }]}>{comp.score}/{comp.maxScore}</Text>
        </View>
        <View style={hsStyles.compTrack}>
          <Animated.View style={[hsStyles.compFill, { backgroundColor: comp.color, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <Text style={hsStyles.compNote}>{comp.explanation}</Text>
      </View>
    </View>
  );
}

const hsStyles = StyleSheet.create({
  compRow:   { gap: 4 },
  compLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: colors.text.primary },
  compScore: { fontFamily: 'Montserrat_700Bold', fontSize: 11 },
  compTrack: { height: 5, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  compFill:  { height: '100%', borderRadius: 3 },
  compNote:  { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary, lineHeight: 14 },
});

// ─── HealthScoreCard ─────────────────────────────────────────────────────────

function HealthScoreCard({ diagnosis }: { diagnosis: FinancialDiagnosis }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={cardStyles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[4] }}>
        <HealthScoreRing score={diagnosis.healthScore} color={diagnosis.healthColor} label={diagnosis.healthLabel} />
        <View style={{ flex: 1, gap: spacing[1] }}>
          <Text variant="label" color={colors.text.tertiary}>SALUD FINANCIERA</Text>
          <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 22, color: diagnosis.healthColor, lineHeight: 26 }}>
            {diagnosis.healthLabel}
          </Text>
          <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 16 }}>
            Basado en {diagnosis.components.length} factores objetivos de tus finanzas de este mes.
          </Text>
          <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: colors.primary }}>
              {expanded ? 'Ocultar desglose' : 'Ver qué lo compone'}
            </Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
      {expanded && (
        <View style={{ gap: spacing[4], marginTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border.subtle, paddingTop: spacing[3] }}>
          {diagnosis.components.map(c => <ComponentBar key={c.key} comp={c} />)}
        </View>
      )}
    </Card>
  );
}

// ─── InsightCard ─────────────────────────────────────────────────────────────

const INSIGHT_CFG: Record<string, { bg: string; border: string; icon: string }> = {
  positive:    { bg: colors.neon + '10',    border: colors.neon,    icon: colors.neon },
  negative:    { bg: colors.red + '10',     border: colors.red,     icon: colors.red },
  warning:     { bg: '#FFD740' + '14',      border: '#FFD740',      icon: '#FFD740' },
  opportunity: { bg: colors.primary + '10', border: colors.primary, icon: colors.primary },
};

function InsightCard({ insight }: { insight: DiagnosticInsight }) {
  const cfg = INSIGHT_CFG[insight.type];
  return (
    <View style={[insightStyles.card, { backgroundColor: cfg.bg, borderLeftColor: cfg.border }]}>
      <View style={insightStyles.header}>
        <Ionicons name={insight.icon as any} size={18} color={cfg.icon} />
        <Text style={insightStyles.title}>{insight.title}</Text>
        {insight.metric && (
          <Text style={[insightStyles.metric, { color: cfg.icon }]}>{insight.metric}</Text>
        )}
      </View>
      <Text style={insightStyles.body}>{insight.body}</Text>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  card:   { borderLeftWidth: 3, borderRadius: 12, padding: spacing[4], gap: spacing[2] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: colors.text.primary, flex: 1, flexWrap: 'wrap' },
  metric: { fontFamily: 'Montserrat_700Bold', fontSize: 12, flexShrink: 0 },
  body:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: colors.text.secondary, lineHeight: 18 },
});

// ─── AINarrativeCard ─────────────────────────────────────────────────────────

function AINarrativeCard({
  narrative, keyFinding, nextStep, isLoading,
}: { narrative: string; keyFinding: string; nextStep: string; isLoading: boolean }) {
  if (isLoading) {
    return (
      <Card style={[cardStyles.card, { gap: spacing[3] }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <ActivityIndicator size="small" color={colors.neon} />
          <Text variant="label" color={colors.text.tertiary}>ANALIZANDO CON IA...</Text>
        </View>
        {[0.9, 0.75, 0.6].map((w, i) => (
          <View key={i} style={{ height: 10, borderRadius: 5, backgroundColor: colors.border.subtle, width: `${w * 100}%` }} />
        ))}
      </Card>
    );
  }
  if (!narrative) return null;
  return (
    <Card style={[cardStyles.card, { borderLeftWidth: 3, borderLeftColor: colors.neon }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.neon }} />
        <Text variant="label" color={colors.text.tertiary}>ANÁLISIS IA DEL MES</Text>
      </View>
      <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: colors.text.primary, lineHeight: 20 }}>
        {narrative}
      </Text>
      {keyFinding ? (
        <View style={{ backgroundColor: colors.bg.elevated, borderRadius: 8, padding: spacing[3] }}>
          <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: colors.text.tertiary, letterSpacing: 0.5, marginBottom: 4 }}>
            HALLAZGO CLAVE
          </Text>
          <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.text.primary, lineHeight: 18 }}>
            {keyFinding}
          </Text>
        </View>
      ) : null}
      {nextStep ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] }}>
          <Ionicons name="arrow-forward-circle-outline" size={16} color={colors.neon} style={{ marginTop: 1 }} />
          <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.neon, flex: 1, lineHeight: 18 }}>
            {nextStep}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

// ─── ActionsCard ─────────────────────────────────────────────────────────────

function ActionsCard({ actions }: { actions: FinancialDiagnosis['actions'] }) {
  if (actions.length === 0) return null;
  const IMPACT_COLOR = { high: colors.red, medium: '#FFD740', low: colors.primary };
  const IMPACT_LABEL = { high: 'ALTO', medium: 'MEDIO', low: 'BAJO' };
  return (
    <Card style={[cardStyles.card, { gap: spacing[3] }]}>
      <Text variant="label" color={colors.text.tertiary}>ACCIONES CONCRETAS</Text>
      {actions.map((a, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingTop: i > 0 ? spacing[3] : 0, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border.subtle }}>
          <View style={{ backgroundColor: (IMPACT_COLOR[a.impact] ?? colors.primary) + '20', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginTop: 2 }}>
            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 8, color: IMPACT_COLOR[a.impact] ?? colors.primary, letterSpacing: 0.5 }}>
              {IMPACT_LABEL[a.impact]}
            </Text>
          </View>
          <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: colors.text.primary, flex: 1, lineHeight: 19 }}>
            {a.text}
          </Text>
        </View>
      ))}
    </Card>
  );
}

// ─── RatesCard ────────────────────────────────────────────────────────────────

const RATE_META: Record<string, { label: string; icon: string }> = {
  fci_mm:           { label: 'FCI Money Market',    icon: 'trending-up-outline' },
  pf_30d:           { label: 'Plazo Fijo 30d',       icon: 'time-outline' },
  caucion_1d:       { label: 'Caución bursátil 1d',  icon: 'swap-horizontal-outline' },
  cuenta_remunerada:{ label: 'Cuenta remunerada',    icon: 'wallet-outline' },
  lecap_monthly:    { label: 'Lecap (mensual)',       icon: 'document-text-outline' },
};

function RatesCard({ rates, inflationRate }: { rates: Record<string, number>; inflationRate: number }) {
  const entries = Object.entries(RATE_META)
    .map(([key, meta]) => ({ key, ...meta, rate: rates[key] }))
    .filter(e => e.rate != null)
    .sort((a, b) => b.rate - a.rate);
  if (entries.length === 0) return null;
  return (
    <Card style={[cardStyles.card, { gap: spacing[3] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" color={colors.text.tertiary}>TASAS DEL MOMENTO</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red }} />
          <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 10, color: colors.text.tertiary }}>
            Inflación {inflationRate.toFixed(1)}%
          </Text>
        </View>
      </View>
      {entries.map(e => {
        const beatsInflation = e.rate >= inflationRate;
        const rateColor = beatsInflation ? colors.neon : e.rate >= inflationRate * 0.9 ? '#FFD740' : colors.red;
        return (
          <View key={e.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border.subtle }}>
            <Ionicons name={e.icon as any} size={16} color={rateColor} />
            <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.text.primary, flex: 1 }}>{e.label}</Text>
            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 14, color: rateColor }}>{e.rate.toFixed(1)}%</Text>
            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary }}>/mes</Text>
            {beatsInflation
              ? <Ionicons name="checkmark-circle" size={14} color={colors.neon} />
              : <Ionicons name="close-circle" size={14} color={colors.red} />
            }
          </View>
        );
      })}
      <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary, marginTop: 2 }}>
        ✓ = supera la inflación mensual · × = por debajo
      </Text>
    </Card>
  );
}

// ─── CategoryInflationCard ────────────────────────────────────────────────────

const CAT_INFLATION_META: Record<string, { label: string; icon: string }> = {
  inflation_food:        { label: 'Alimentos y bebidas', icon: 'fast-food-outline' },
  inflation_health:      { label: 'Salud',               icon: 'medkit-outline' },
  inflation_transport:   { label: 'Transporte',          icon: 'car-outline' },
  inflation_housing:     { label: 'Vivienda y servicios',icon: 'home-outline' },
  inflation_education:   { label: 'Educación',           icon: 'school-outline' },
  inflation_restaurants: { label: 'Restaurantes',        icon: 'restaurant-outline' },
};

function CategoryInflationCard({ rates, generalInflation }: { rates: Record<string, number>; generalInflation: number }) {
  const entries = Object.entries(CAT_INFLATION_META)
    .map(([key, meta]) => ({ key, ...meta, rate: rates[key] }))
    .filter(e => e.rate != null)
    .sort((a, b) => b.rate - a.rate);
  if (entries.length === 0) return null;
  return (
    <Card style={[cardStyles.card, { gap: spacing[3] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" color={colors.text.tertiary}>INFLACIÓN POR RUBRO (INDEC)</Text>
        <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 10, color: colors.text.tertiary }}>General: {generalInflation.toFixed(1)}%</Text>
      </View>
      {entries.map(e => {
        const diff = e.rate - generalInflation;
        const color = diff > 0.5 ? colors.red : diff < -0.5 ? colors.neon : '#FFD740';
        return (
          <View key={e.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Ionicons name={e.icon as any} size={14} color={color} />
            <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.text.primary, flex: 1 }}>{e.label}</Text>
            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color }}>{e.rate.toFixed(1)}%</Text>
            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary, minWidth: 40, textAlign: 'right' }}>
              {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
            </Text>
          </View>
        );
      })}
      <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 10, color: colors.text.tertiary, marginTop: 2 }}>
        Diferencia vs inflación general mensual
      </Text>
    </Card>
  );
}

const cardStyles = StyleSheet.create({
  card: { padding: spacing[4], gap: spacing[3] },
});

// ─── Screen principal ─────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { user, profile } = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome } = useExpensesStore();
  const { investments, fetchAll: loadSavings } = useSavingsStore();
  const { effectivePlan, isTrialActive } = usePlanStore();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [rows,     setRows]     = useState<CategoryRow[]>([]);
  const [total,    setTotal]    = useState(0);
  const [history,  setHistory]  = useState<MonthSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inflationRate, setInflationRate] = useState(0);
  const [fciRate,       setFciRate]       = useState(0);
  const [allRates,      setAllRates]      = useState<Record<string, number>>({});
  const [pastOppData,   setPastOppData]   = useState<{ monthKey: string; disposable: number; categories: Record<string, number> }[]>([]);

  // AI narrative state
  const [aiNarrative,   setAiNarrative]   = useState('');
  const [aiKeyFinding,  setAiKeyFinding]  = useState('');
  const [aiNextStep,    setAiNextStep]    = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const { isFirstVisit, markVisited } = useFirstVisit('reports');

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
    // Clear AI narrative when month changes
    setAiNarrative('');
    setAiKeyFinding('');
    setAiNextStep('');
    try {
      const oppStart = (() => {
        const d = new Date(year, month - 4, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      })();

      const [mainRes, histRes, oppRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category:expense_categories(id, name_es, color), classification')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .not('category_id', 'is', null)
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
        supabase
          .from('expenses')
          .select('amount, date, classification, category:expense_categories(name_es)')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .eq('classification', 'disposable')
          .gte('date', oppStart)
          .lt('date', startDate),
      ]);

      const map: Record<string, CategoryRow> = {};
      let sum = 0;
      for (const exp of mainRes.data ?? []) {
        const cat   = (exp as any).category;
        const catId = cat?.id ?? 'none';
        if (!map[catId]) {
          map[catId] = { id: catId, name: cat?.name_es ?? 'Sin categoría', color: getCategoryColor(cat?.name_es ?? 'otros', Object.keys(map).length), amount: 0, pct: 0 };
        }
        map[catId].amount += (exp as any).amount;
        sum += (exp as any).amount;
      }
      const result = Object.values(map).map(r => ({ ...r, pct: sum > 0 ? r.amount / sum : 0 })).sort((a, b) => b.amount - a.amount);
      setTotal(sum);
      setRows(result);

      const histMap: Record<string, MonthSummary> = {};
      type HistRow = { amount: number; date: string; classification: string | null };
      for (const exp of (histRes.data ?? []) as HistRow[]) {
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
        const mk      = exp.date.slice(0, 7);
        const catName = exp.category?.name_es ?? 'Prescindibles';
        if (!oppMap[mk]) oppMap[mk] = { monthKey: mk, disposable: 0, categories: {} };
        oppMap[mk].disposable += exp.amount;
        oppMap[mk].categories[catName] = (oppMap[mk].categories[catName] ?? 0) + exp.amount;
      }
      setPastOppData(Object.values(oppMap));
    } catch (err) {
      console.error('[Informe] loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (user?.id) loadSavings(user.id);
    (supabase as any)
      .from('market_rates')
      .select('instrument, rate_monthly')
      .then(({ data }: { data: { instrument: string; rate_monthly: number }[] | null }) => {
        if (!data) return;
        const ratesMap: Record<string, number> = {};
        for (const row of data) {
          ratesMap[row.instrument] = Number(row.rate_monthly);
          if (row.instrument === 'inflation') setInflationRate(Number(row.rate_monthly));
          if (row.instrument === 'fci_mm')    setFciRate(Number(row.rate_monthly));
        }
        setAllRates(ratesMap);
      });
  }, [user?.id]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (isCurrentMonth) return; if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const displayTotal      = isCurrentMonth ? totalThisMonth  : total;
  const displayNecessary  = isCurrentMonth ? totalNecessary  : 0;
  const displayDisposable = isCurrentMonth ? totalDisposable : 0;
  const displayInvestable = isCurrentMonth ? totalInvestable : 0;
  const displayIncome     = isCurrentMonth ? estimatedIncome : null;

  // ── Diagnóstico financiero (cálculo puro, instantáneo) ─────────────────────
  const diagnosis = useMemo<FinancialDiagnosis | null>(() => {
    if (displayTotal === 0) return null;
    const catInflationRates: Record<string, number> = {};
    for (const [k, v] of Object.entries(allRates)) {
      if (k.startsWith('inflation_') && k !== 'inflation') catInflationRates[k] = v;
    }
    return computeFinancialDiagnosis({
      totalThisMonth:  displayTotal,
      totalNecessary:  displayNecessary,
      totalDisposable: displayDisposable,
      totalInvestable: displayInvestable,
      estimatedIncome: displayIncome,
      history,
      rows,
      inflationRate,
      fciRate,
      dayOfMonth:            isCurrentMonth ? now.getDate() : 28,
      allRates,
      categoryInflationRates: catInflationRates,
    });
  }, [displayTotal, displayNecessary, displayDisposable, displayInvestable, displayIncome, history, rows, inflationRate, fciRate, isCurrentMonth]);

  // ── Llamada AI para narrativa (async, solo cuando hay datos) ────────────────
  useEffect(() => {
    if (!diagnosis || !user?.id) return;
    if (aiNarrative) return; // ya generado para este mes/datos

    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    setAiLoading(true);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || ctrl.signal.aborted) return;

        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-advisor`,
          {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              generate_report: true,
              user_id:         user.id,
              report_context:  diagnosis.reportPayload,
            }),
          },
        );
        if (!res.ok || ctrl.signal.aborted) return;
        const data = await res.json();
        if (!ctrl.signal.aborted) {
          setAiNarrative(data.narrative   ?? '');
          setAiKeyFinding(data.key_finding ?? '');
          setAiNextStep(data.next_step     ?? '');
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.warn('[Report AI]', e);
      } finally {
        if (!ctrl.signal.aborted) setAiLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [diagnosis?.healthScore, month, year]);

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const handleExportPdf = useCallback(async () => {
    const isPro = effectivePlan === 'pro' || effectivePlan === 'premium';
    if (!isPro || isTrialActive()) {
      Alert.alert(
        '⚡ Función Pro',
        'El reporte en PDF es exclusivo de Nomi Pro.',
        [{ text: 'Ahora no', style: 'cancel' }, { text: '⚡ Ver planes', onPress: () => router.push('/(app)/plans' as any) }],
      );
      return;
    }
    setExporting(true);
    try {
      const totalInvested = investments.reduce((s, inv) => s + inv.amount, 0);
      const html = buildPdfHtml({
        userName: profile?.full_name ?? 'Usuario',
        monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        total: displayTotal, necessary: displayNecessary,
        disposable: displayDisposable, investable: displayInvestable,
        estimatedIncome: displayIncome, inflationRate, fciRate, rows,
        totalInvested,
        healthScore: diagnosis?.healthScore ?? 0,
        healthLabel: diagnosis?.healthLabel ?? '',
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Informe ${MONTH_NAMES[month - 1]} ${year} — Nomi`, UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('PDF generado', 'Archivo creado pero tu dispositivo no soporta compartir.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo generar el PDF.');
    } finally {
      setExporting(false);
    }
  }, [effectivePlan, isTrialActive, investments, month, year, profile, displayTotal, displayNecessary, displayDisposable, displayInvestable, displayIncome, inflationRate, fciRate, rows, diagnosis]);

  // Advisor CTA context
  const ahorroSugerencias = useMemo(() => buildAhorroSugerencias({
    rows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome,
  }), [rows, displayDisposable, displayTotal, displayIncome]);

  const comparacion = useMemo(() => buildComparacion(history, displayTotal, displayDisposable),
    [history, displayTotal, displayDisposable]);

  const advisorContext = useMemo(() => {
    const totalSaving = ahorroSugerencias.reduce((s, sg) => s + sg.saving, 0);
    return [
      `Informe de ${MONTH_NAMES[month - 1]} ${year}.`,
      `Salud financiera: ${diagnosis?.healthLabel ?? ''} (${diagnosis?.healthScore ?? 0}/100).`,
      `Gasté ${formatCurrency(displayTotal)}.`,
      displayDisposable > 0 ? `Prescindibles: ${formatCurrency(displayDisposable)}.` : '',
      displayIncome ? `Eso es el ${Math.round((displayTotal / displayIncome) * 100)}% de mi ingreso.` : '',
      rows[0] ? `Categoría más alta: "${rows[0].name}" (${Math.round(rows[0].pct * 100)}%).` : '',
      comparacion.vsPrev ? `Cambio vs mes pasado: ${comparacion.vsPrev.changePct > 0 ? '+' : ''}${comparacion.vsPrev.changePct}%.` : '',
      totalSaving > 0 ? `Podría ahorrar ${formatCurrency(totalSaving)}/mes.` : '',
      '¿Qué me recomendás hacer el próximo mes?',
    ].filter(Boolean).join(' ');
  }, [month, year, displayTotal, displayDisposable, displayIncome, rows, comparacion, ahorroSugerencias, diagnosis]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text variant="h4">Análisis</Text>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={prevMonth} style={s.monthBtn}>
                <Ionicons name="chevron-back" size={18} color={colors.text.primary} />
              </TouchableOpacity>
              <Text variant="bodySmall" color={colors.text.secondary} style={{ minWidth: 110, textAlign: 'center' }}>
                {MONTH_NAMES[month - 1]} {year}
              </Text>
              <TouchableOpacity onPress={nextMonth} disabled={isCurrentMonth} style={[s.monthBtn, isCurrentMonth && { opacity: 0.3 }]}>
                <Ionicons name="chevron-forward" size={18} color={colors.text.primary} />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExportPdf} disabled={exporting} activeOpacity={0.8}>
            {exporting
              ? <ActivityIndicator size="small" color={colors.white} />
              : <Ionicons name="download-outline" size={15} color={colors.white} />
            }
            <Text style={s.exportBtnText}>PDF</Text>
          </TouchableOpacity>
        </View>

        {/* ── Loading ── */}
        {isLoading && (
          <View style={s.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
        )}

        {/* ── Empty ── */}
        {!isLoading && displayTotal === 0 && (
          <View style={s.empty}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="bar-chart-outline" size={40} color={colors.text.tertiary} />
            </View>
            <Text variant="subtitle" color={colors.text.primary} align="center">
              Sin datos para {MONTH_NAMES[month - 1]} {year}
            </Text>
            <Text variant="body" color={colors.text.secondary} align="center" style={{ lineHeight: 22 }}>
              Cargá gastos para ver tu análisis, salud financiera y oportunidades de ahorro.
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(app)/expenses')} activeOpacity={0.8}>
              <Ionicons name="add" size={16} color={colors.white} />
              <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: colors.white }}>
                Ir a cargar gastos
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Contenido ── */}
        {!isLoading && displayTotal > 0 && diagnosis && (
          <>
            {/* Narrativa IA */}
            <AINarrativeCard
              narrative={aiNarrative}
              keyFinding={aiKeyFinding}
              nextStep={aiNextStep}
              isLoading={aiLoading && !aiNarrative}
            />

            {/* Score de salud */}
            <HealthScoreCard diagnosis={diagnosis} />

            {/* Insights */}
            {diagnosis.insights.length > 0 && (
              <View style={{ gap: spacing[2] }}>
                <Text variant="label" color={colors.text.tertiary} style={{ paddingHorizontal: 2 }}>
                  {diagnosis.insights.length} INSIGHTS DETECTADOS
                </Text>
                {diagnosis.insights.map(ins => <InsightCard key={ins.id} insight={ins} />)}
              </View>
            )}

            {/* Acciones */}
            <ActionsCard actions={diagnosis.actions} />

            {/* Tasas del momento */}
            {Object.keys(allRates).some(k => RATE_META[k]) && (
              <RatesCard rates={allRates} inflationRate={inflationRate} />
            )}

            {/* Inflación por rubro */}
            {Object.keys(allRates).some(k => k.startsWith('inflation_') && k !== 'inflation') && (
              <CategoryInflationCard rates={allRates} generalInflation={inflationRate} />
            )}

            {/* Categorías */}
            <CategoryBreakdown rows={rows} total={total || displayTotal} />

            {/* Comparación histórica */}
            {history.length > 0 && (
              <HistoryComparisonCard history={history} comparacion={comparacion} currentTotal={displayTotal} />
            )}

            {/* Termómetro de inflación */}
            <InflationThermometer userId={user!.id} year={year} month={month} />

            {/* Patrimonio vs inflación (si hay inversiones) */}
            {investments.length > 0 && (() => {
              const totalInvested = investments.reduce((s, inv) => s + inv.amount, 0);
              const ganancia      = totalInvested * (fciRate / 100);
              const perdidaInfl   = totalInvested * (inflationRate / 100);
              const netoPct       = fciRate - inflationRate;
              const ganó          = netoPct >= 0;
              return (
                <Card style={s.patrimonioCard}>
                  <View style={s.patrimonioHeader}>
                    <Ionicons name={ganó ? 'trending-up-outline' : 'trending-down-outline'} size={20} color={ganó ? colors.neon : colors.red} />
                    <Text variant="label" color={colors.text.secondary}>PATRIMONIO VS INFLACIÓN</Text>
                  </View>
                  <Text variant="h4" color={ganó ? colors.neon : colors.red}>{ganó ? '+' : ''}{netoPct.toFixed(1)}% real este mes</Text>
                  <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 18 }}>
                    Tu inversión de {formatCurrency(totalInvested)} rindió ~{formatCurrency(Math.round(ganancia))} ({fciRate.toFixed(1)}%), pero la inflación consumió ~{formatCurrency(Math.round(perdidaInfl))} ({inflationRate.toFixed(1)}%).
                  </Text>
                  <View style={s.patrimonioRow}>
                    <View style={s.patrimonioItem}>
                      <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>RENDIMIENTO</Text>
                      <Text variant="labelMd" color={colors.neon}>+{formatCurrency(Math.round(ganancia))}</Text>
                    </View>
                    <View style={s.patrimonioDivider} />
                    <View style={s.patrimonioItem}>
                      <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>INFLACIÓN</Text>
                      <Text variant="labelMd" color={colors.red}>-{formatCurrency(Math.round(perdidaInfl))}</Text>
                    </View>
                    <View style={s.patrimonioDivider} />
                    <View style={s.patrimonioItem}>
                      <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>NETO</Text>
                      <Text variant="labelMd" color={ganó ? colors.neon : colors.red}>{ganó ? '+' : ''}{formatCurrency(Math.round(ganancia - perdidaInfl))}</Text>
                    </View>
                  </View>
                </Card>
              );
            })()}

            {/* CTA Asesor */}
            <AdvisorCTA context={advisorContext} />
          </>
        )}

      </ScrollView>

      <FirstVisitSheet
        visible={isFirstVisit}
        screenTitle="Tu análisis financiero"
        screenIcon="bar-chart-outline"
        iconColor={colors.primary}
        features={[
          { icon: 'pulse-outline', color: colors.neon, title: 'Salud financiera real', body: 'Tu puntaje se construye con 5 factores objetivos: control de gasto, prescindibles, clasificación, tendencia y margen de ahorro. No es un número arbitrario.' },
          { icon: 'sparkles-outline', color: colors.primary, title: 'Análisis con IA', body: 'Nomi analiza tus datos y genera un resumen narrativo en lenguaje natural, adaptado a tu situación concreta y al contexto económico argentino.' },
          { icon: 'trending-up-outline', color: colors.yellow, title: 'Insights con datos', body: 'Cada insight muestra qué detectó, por qué y con qué datos. Sin frases vagas ni juicios morales.' },
        ]}
        onDismiss={markVisited}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: spacing[4], paddingBottom: layout.tabBarHeight + spacing[8], gap: spacing[4] },

  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { gap: spacing[2] },
  monthNav:   { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  monthBtn:   { padding: spacing[1] },
  exportBtn:  { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  exportBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: colors.white },

  loading:      { height: 280, alignItems: 'center', justifyContent: 'center' },
  empty:        { alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingVertical: spacing[10] },
  emptyIconWrap:{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  emptyBtn:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: spacing[5], paddingVertical: spacing[3] },

  patrimonioCard:    { padding: spacing[5], gap: spacing[4] },
  patrimonioHeader:  { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  patrimonioRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border.subtle },
  patrimonioItem:    { flex: 1, gap: spacing[1] },
  patrimonioDivider: { width: 1, height: 28, backgroundColor: colors.border.subtle, marginHorizontal: spacing[2] },
  patrimonioBtn:     { alignSelf: 'flex-start' },
});
