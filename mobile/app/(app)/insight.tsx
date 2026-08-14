import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
import { Text, Button } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import type { WidgetType } from '@/lib/widgetEngine';
import { ADVISOR_ENABLED, ADVISOR_FALLBACK_CTA } from '@/lib/features';

const db = supabase as any;

// ── Precios de referencia ARS 2025 ────────────────────────────────────────────
const REF = {
  spotify:       4_500,
  netflix:       9_000,
  nafta_litro:   1_500,
  cafe:          3_500,
  uber_viaje:    5_000,
  ypf_accion:    75_000,
  meli_accion:   450_000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function daysAgoStr(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function ProgressBar({ pct, accent }: { pct: number; accent: string }) {
  const clamped = Math.min(pct, 100);
  const barColor = pct >= 100 ? '#EF4444' : pct >= 80 ? '#FBBF24' : '#4ADE80';
  return (
    <View style={{ height: 8, backgroundColor: colors.border.subtle, borderRadius: 4, overflow: 'hidden' }}>
      <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: barColor, borderRadius: 4 }} />
    </View>
  );
}

function SectionRow({ emoji, label, amount, sub, accent }: {
  emoji: string; label: string; amount: string; sub?: string; accent?: string;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.iconWrap}>
        <Text style={{ fontSize: 22 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="subtitle">{label}</Text>
        {sub ? <Text variant="caption" color={colors.text.tertiary}>{sub}</Text> : null}
      </View>
      <Text variant="subtitle" color={accent ?? colors.neon}>{amount}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  iconWrap: {
    width:           46,
    height:          46,
    borderRadius:    23,
    backgroundColor: colors.bg.elevated,
    alignItems:      'center',
    justifyContent:  'center',
  },
});

// ── Content por tipo ──────────────────────────────────────────────────────────

function RecoverableContent({ expenses }: { expenses: any[] }) {
  const ms = monthStart();

  const byCategory = useMemo(() => {
    const map: Record<string, { name: string; emoji: string; total: number; note: string }> = {};
    for (const e of expenses) {
      if (e.deleted_at || e.classification !== 'disposable' || e.date < ms) continue;
      const key   = e.category?.name_es ?? 'Otros';
      const emoji = e.category?.color ? '🏷️' : '💸';
      if (!map[key]) map[key] = { name: key, emoji, total: 0, note: 'Gastos prescindibles' };
      map[key].total += e.amount;
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [expenses]);

  const total = byCategory.reduce((s, c) => s + c.total, 0);
  const recoverable = Math.round(total * 0.5);

  const EMOJI_MAP: Record<string, string> = {
    'Delivery':         '🍔',
    'Restaurantes':     '🍽️',
    'Entretenimiento':  '🎮',
    'Salidas':          '🎉',
    'Transporte':       '🚕',
    'Ropa':             '👗',
    'Tecnología':       '📱',
    'Viajes':           '✈️',
    'Otros':            '💸',
  };

  return (
    <>
      <View style={s.heroBox}>
        <Text style={s.heroLabel}>Podés recuperar hasta</Text>
        <Text style={s.heroAmount}>{formatCurrency(recoverable)}</Text>
        <Text style={s.heroSub}>ajustando tus gastos prescindibles sin cambiar tu estilo de vida.</Text>
      </View>

      <Text variant="subtitle" style={s.sectionTitle}>¿De dónde sale este monto?</Text>

      {byCategory.map(c => (
        <SectionRow
          key={c.name}
          emoji={EMOJI_MAP[c.name] ?? '💸'}
          label={c.name}
          amount={formatCurrency(c.total)}
          sub={c.note}
          accent="#4ADE80"
        />
      ))}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Reducir un 50% de estos gastos te libera {formatCurrency(recoverable)} para ahorro o inversión.
        </Text>
      </View>
    </>
  );
}

function OpportunityContent({ totalDisposable }: { totalDisposable: number }) {
  const projected6m  = Math.round(totalDisposable * 1.25);
  const projected12m = Math.round(totalDisposable * 1.55);

  const comparisons = [
    { emoji: '📈', label: 'Acciones de YPF',          value: `${(totalDisposable / REF.ypf_accion).toFixed(1)} acciones` },
    { emoji: '🛒', label: 'Acciones de Mercado Libre', value: `${(totalDisposable / REF.meli_accion).toFixed(2)} acciones` },
    { emoji: '🎵', label: 'Meses de Spotify',          value: `${Math.floor(totalDisposable / REF.spotify)} meses` },
    { emoji: '⛽', label: 'Litros de nafta',           value: `${Math.floor(totalDisposable / REF.nafta_litro)} litros` },
    { emoji: '☕', label: 'Cafés',                     value: `${Math.floor(totalDisposable / REF.cafe)} cafés` },
    { emoji: '🚕', label: 'Viajes en Uber',            value: `${Math.floor(totalDisposable / REF.uber_viaje)} viajes` },
  ];

  return (
    <>
      <View style={s.heroBox}>
        <Text style={s.heroLabel}>Si invertías {formatCurrency(totalDisposable)} hace 6 meses…</Text>
        <Text style={s.heroAmount}>{formatCurrency(projected6m)}</Text>
        <Text style={s.heroSub}>
          Hoy tendrías {formatCurrency(projected6m)} (+25% en FCI + inflación ajustada).{'\n'}
          En 12 meses: {formatCurrency(projected12m)}.
        </Text>
      </View>

      <Text variant="subtitle" style={s.sectionTitle}>Esto equivale a:</Text>

      {comparisons.map(c => (
        <SectionRow key={c.label} emoji={c.emoji} label={c.label} amount={c.value} accent="#A78BFA" />
      ))}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Con FCI Money Market o CEDEARs podés empezar con $5.000. Sin riesgo mínimo.
        </Text>
      </View>
    </>
  );
}

function ImpulseContent({ expenses }: { expenses: any[] }) {
  const cutoff = daysAgoStr(7);
  const ms     = monthStart();

  const impulseExpenses = useMemo(() =>
    expenses.filter(e => !e.deleted_at && e.classification === 'disposable' && e.date >= cutoff),
    [expenses],
  );

  const byCategory = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    for (const e of impulseExpenses) {
      const key = e.category?.name_es ?? 'Otros';
      if (!map[key]) map[key] = { total: 0, count: 0 };
      map[key].total += e.amount;
      map[key].count++;
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  }, [impulseExpenses]);

  const totalImpulse = impulseExpenses.reduce((s, e) => s + e.amount, 0);

  const PATTERNS = [
    { emoji: '🌙', text: 'Comprás más cuando estás cansado o de noche.' },
    { emoji: '🍔', text: 'El delivery es tu principal gasto impulsivo.' },
    { emoji: '📱', text: 'Las apps de compras te hacen gastar sin darte cuenta.' },
  ];

  const EMOJI_MAP: Record<string, string> = {
    'Delivery':        '🍔',
    'Restaurantes':    '🍽️',
    'Entretenimiento': '🎮',
    'Salidas':         '🎉',
    'Ropa':            '👗',
    'Tecnología':      '📱',
  };

  return (
    <>
      <View style={[s.heroBox, { backgroundColor: '#3B0A1A' }]}>
        <Text style={s.heroLabel}>En los últimos 7 días</Text>
        <Text style={[s.heroAmount, { color: '#F43F5E' }]}>{formatCurrency(totalImpulse)}</Text>
        <Text style={s.heroSub}>
          {impulseExpenses.length} compras prescindibles.{'\n'}
          "Tu cocina empieza a sospechar de vos." 😅
        </Text>
      </View>

      <Text variant="subtitle" style={s.sectionTitle}>Por categoría</Text>

      {byCategory.map(c => (
        <SectionRow
          key={c.name}
          emoji={EMOJI_MAP[c.name] ?? '💸'}
          label={c.name}
          amount={formatCurrency(c.total)}
          sub={`${c.count} compra${c.count !== 1 ? 's' : ''}`}
          accent="#F43F5E"
        />
      ))}

      <Text variant="subtitle" style={s.sectionTitle}>Tus patrones</Text>

      {PATTERNS.map(p => (
        <View key={p.emoji} style={[rowStyles.row]}>
          <Text style={{ fontSize: 22 }}>{p.emoji}</Text>
          <Text variant="body" style={{ flex: 1 }}>{p.text}</Text>
        </View>
      ))}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Esperá 24hs antes de confirmar compras no planificadas. El 80% terminás no haciéndolas.
        </Text>
      </View>
    </>
  );
}

function BudgetContent({ expenses, budgets }: { expenses: any[]; budgets: any[] }) {
  const ms = monthStart();

  const budgetRows = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of expenses) {
      if (!e.deleted_at && e.category_id && e.date >= ms) {
        totals[e.category_id] = (totals[e.category_id] ?? 0) + e.amount;
      }
    }
    return budgets.map(b => {
      const used = totals[b.category_id] ?? 0;
      const pct  = b.monthly_limit > 0 ? (used / b.monthly_limit) * 100 : 0;
      const catName = expenses.find(e => e.category_id === b.category_id)?.category?.name_es ?? 'Categoría';
      return { ...b, used, pct, catName };
    }).sort((a, b) => b.pct - a.pct);
  }, [expenses, budgets]);

  const EMOJIS: Record<string, string> = {
    'Comida': '🍔', 'Delivery': '🍔', 'Restaurantes': '🍽️',
    'Ocio': '🎮', 'Salidas': '🎉', 'Transporte': '🚕',
    'Ropa': '👗', 'Tecnología': '📱', 'Otros': '🏷️',
  };

  return (
    <>
      <Text variant="subtitle" style={s.sectionTitle}>Tus presupuestos este mes</Text>
      {budgetRows.map(b => (
        <View key={b.id} style={budgetRowStyles.row}>
          <View style={budgetRowStyles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 }}>
              <Text style={{ fontSize: 20 }}>{EMOJIS[b.catName] ?? '🏷️'}</Text>
              <Text variant="subtitle">{b.catName}</Text>
            </View>
            <Text variant="caption" color={b.pct >= 100 ? '#EF4444' : b.pct >= 80 ? '#FBBF24' : '#4ADE80'}>
              {Math.round(b.pct)}%
            </Text>
          </View>
          <ProgressBar pct={b.pct} accent="#4ADE80" />
          <View style={budgetRowStyles.amounts}>
            <Text variant="caption" color={colors.text.secondary}>{formatCurrency(b.used)} usado</Text>
            <Text variant="caption" color={colors.text.tertiary}>límite {formatCurrency(b.monthly_limit)}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

const budgetRowStyles = StyleSheet.create({
  row: {
    gap:             spacing[2],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amounts: { flexDirection: 'row', justifyContent: 'space-between' },
});

function UnclassifiedContent({ expenses }: { expenses: any[] }) {
  const unclassified = useMemo(() =>
    expenses.filter(e => !e.deleted_at && !e.classification).slice(0, 15),
    [expenses],
  );

  return (
    <>
      <View style={s.heroBox}>
        <Text style={s.heroLabel}>Sin categoría</Text>
        <Text style={[s.heroAmount, { color: '#60A5FA' }]}>{unclassified.length} gastos</Text>
        <Text style={s.heroSub}>
          Clasificarlos mejora tus reportes y las recomendaciones de la IA.
        </Text>
      </View>

      <Text variant="subtitle" style={s.sectionTitle}>Gastos recientes sin clasificar</Text>

      {unclassified.map(e => (
        <SectionRow
          key={e.id}
          emoji="❓"
          label={e.description || 'Sin descripción'}
          amount={formatCurrency(e.amount)}
          sub={e.date}
          accent="#60A5FA"
        />
      ))}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Ir a Gastos y filtrar por "Sin clasificar" para clasificarlos rápidamente.
        </Text>
      </View>
    </>
  );
}

function PredictionContent({ expenses, totalThisMonth, estimatedIncome }: {
  expenses: any[]; totalThisMonth: number; estimatedIncome: number | null;
}) {
  const now        = new Date();
  const day        = now.getDate();
  const daysTotal  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected  = day > 0 ? Math.round((totalThisMonth / day) * daysTotal) : totalThisMonth;
  const remaining  = daysTotal - day;
  const dailyRate  = day > 0 ? Math.round(totalThisMonth / day) : 0;
  const excess     = estimatedIncome ? Math.max(0, projected - estimatedIncome) : 0;

  return (
    <>
      <View style={[s.heroBox, { backgroundColor: '#3B0A00' }]}>
        <Text style={s.heroLabel}>Proyección al {daysTotal}/{now.getMonth() + 1}</Text>
        <Text style={[s.heroAmount, { color: '#EF4444' }]}>{formatCurrency(projected)}</Text>
        <Text style={s.heroSub}>
          {excess > 0
            ? `Te vas a pasar ${formatCurrency(excess)} de tu ingreso estimado.`
            : 'Estás dentro de tu ingreso estimado.'}
        </Text>
      </View>

      <SectionRow emoji="📊" label="Gastado hasta hoy"     amount={formatCurrency(totalThisMonth)} />
      <SectionRow emoji="📅" label="Días restantes"        amount={`${remaining} días`} />
      <SectionRow emoji="📈" label="Ritmo diario actual"   amount={formatCurrency(dailyRate) + '/día'} />
      {estimatedIncome ? <SectionRow emoji="💰" label="Ingreso estimado" amount={formatCurrency(estimatedIncome)} /> : null}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Reducí {formatCurrency(dailyRate * 0.2 | 0)} por día y llegás justo a fin de mes.
        </Text>
      </View>
    </>
  );
}

function PositiveContent({ totalThisMonth, estimatedIncome, expenses }: {
  totalThisMonth: number; estimatedIncome: number | null; expenses: any[];
}) {
  const incomePct = estimatedIncome && estimatedIncome > 0
    ? Math.round((totalThisMonth / estimatedIncome) * 100) : null;

  return (
    <>
      <View style={[s.heroBox, { backgroundColor: '#0F2D1A' }]}>
        <Text style={s.heroLabel}>Este mes</Text>
        <Text style={[s.heroAmount, { color: '#4ADE80' }]}>Vas muy bien 🎯</Text>
        {incomePct !== null && (
          <Text style={s.heroSub}>
            Usaste el {incomePct}% de tu ingreso estimado.
          </Text>
        )}
      </View>

      <SectionRow emoji="✅" label="Gastos del mes"     amount={formatCurrency(totalThisMonth)} accent="#4ADE80" />
      {estimatedIncome ? <SectionRow emoji="💰" label="Ingreso estimado" amount={formatCurrency(estimatedIncome)} accent="#4ADE80" /> : null}
      {incomePct !== null ? <SectionRow emoji="📊" label="% del ingreso usado" amount={`${incomePct}%`} accent="#4ADE80" /> : null}

      <View style={s.tip}>
        <Text variant="caption" color={colors.text.secondary}>
          💡 Si seguís así, podés destinar el sobrante a metas de ahorro o inversión.
        </Text>
      </View>
    </>
  );
}

// ── Config por tipo ───────────────────────────────────────────────────────────

const CONFIG: Record<WidgetType, { title: string; accent: string; ctaLabel?: string; ctaPath?: string }> = {
  recoverable:  { title: 'Dinero recuperable',     accent: '#4ADE80' },
  opportunity:  { title: 'Costo de oportunidad',   accent: '#A78BFA' },
  impulse:      { title: 'Detector de impulsos',   accent: '#F43F5E' },
  budget_risk:  { title: 'Presupuesto en riesgo',  accent: '#FBBF24' },
  budget_over:  { title: 'Presupuesto superado',   accent: '#F97316' },
  unclassified: { title: 'Gastos sin clasificar',  accent: '#60A5FA',
                  ctaLabel: 'Ir a clasificar', ctaPath: '/(app)/expenses' },
  prediction:   { title: 'Predicción fin de mes',  accent: '#EF4444' },
  positive:     { title: 'Análisis del mes',        accent: '#4ADE80',
                  ctaLabel: 'Ver reportes', ctaPath: '/(app)/reports' },
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function InsightScreen() {
  const { type } = useLocalSearchParams<{ type: WidgetType }>();
  const { user } = useAuthStore();
  const { expenses, totalThisMonth, totalDisposable, estimatedIncome } = useExpensesStore();

  const [budgets,  setBudgets]  = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);

  const cfg = CONFIG[type ?? 'positive'] ?? CONFIG.positive;

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    db.from('category_budgets')
      .select('id, category_id, monthly_limit')
      .eq('user_id', user.id)
      .then(({ data }: { data: any[] | null }) => {
        setBudgets(data ?? []);
        setLoading(false);
      });
  }, [user?.id]);

  function renderContent() {
    switch (type) {
      case 'recoverable':
        return <RecoverableContent expenses={expenses} />;
      case 'opportunity':
        return <OpportunityContent totalDisposable={totalDisposable} />;
      case 'impulse':
        return <ImpulseContent expenses={expenses} />;
      case 'budget_risk':
      case 'budget_over':
        return <BudgetContent expenses={expenses} budgets={budgets} />;
      case 'unclassified':
        return <UnclassifiedContent expenses={expenses} />;
      case 'prediction':
        return <PredictionContent expenses={expenses} totalThisMonth={totalThisMonth} estimatedIncome={estimatedIncome} />;
      case 'positive':
      default:
        return <PositiveContent totalThisMonth={totalThisMonth} estimatedIncome={estimatedIncome} expenses={expenses} />;
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="h4" style={{ flex: 1, marginLeft: spacing[3] }}>
          {cfg.title}
        </Text>
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator color={colors.neon} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {renderContent()}

          {/* Bottom CTA */}
          <View style={s.bottomCta}>
            <TouchableOpacity
              style={[s.ctaBtn, { backgroundColor: cfg.accent }]}
              onPress={() => {
                if (cfg.ctaPath) {
                  router.push(cfg.ctaPath as any);
                } else if (ADVISOR_ENABLED) {
                  router.push({
                    pathname: '/(app)/advisor',
                    params:   { initialContext: `Analizá mi situación de ${cfg.title.toLowerCase()}` },
                  } as any);
                } else {
                  router.push(ADVISOR_FALLBACK_CTA.route as any);
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={s.ctaBtnText}>
                {cfg.ctaLabel ?? (ADVISOR_ENABLED ? 'Hablá con la IA' : ADVISOR_FALLBACK_CTA.label)}
              </Text>
              {!cfg.ctaLabel && ADVISOR_ENABLED && <Ionicons name="sparkles-outline" size={16} color="#000" />}
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor:   colors.bg.card,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[5],
    paddingBottom:     100,
    gap:               0,
  },
  heroBox: {
    backgroundColor: colors.bg.elevated,
    borderRadius:    16,
    padding:         spacing[5],
    gap:             spacing[2],
    marginBottom:    spacing[5],
  },
  heroLabel:  {
    color:      'rgba(255,255,255,0.65)',
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroAmount: {
    color:      '#FFFFFF',
    fontFamily: 'Montserrat_700Bold',
    fontSize:   36,
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroSub: {
    color:      'rgba(255,255,255,0.7)',
    fontFamily: 'Montserrat_400Regular',
    fontSize:   13,
    lineHeight: 18,
  },
  sectionTitle: {
    marginTop:    spacing[5],
    marginBottom: spacing[2],
  },
  tip: {
    backgroundColor: colors.bg.elevated,
    borderRadius:    12,
    padding:         spacing[4],
    marginTop:       spacing[5],
  },
  bottomCta: {
    marginTop: spacing[6],
  },
  ctaBtn: {
    borderRadius:  14,
    paddingVertical: spacing[4],
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap:           spacing[2],
  },
  ctaBtnText: {
    color:      '#000000',
    fontFamily: 'Montserrat_700Bold',
    fontSize:   15,
  },
});
