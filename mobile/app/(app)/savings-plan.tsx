import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { fetchBudgetPlan, computePotentialSavings, type BudgetPlan, type CategoryBudget, type AlertLevel } from '@/lib/budgetPlan';
import { buildCategoryInsight, selectRelevantInsights, buildAllGoodInsight, type CategoryInsight } from '@/lib/budgetInsights';
import { fetchRecurringEvaluations, applyRecurringContext, type CategoryBudgetWithRecurring } from '@/lib/recurringAdjustment';
import {
  determineSavingsDestinations, describeSavingsOrigin, computeGoalCoverage, pickFeaturedGoal, projectAnnualSaving,
  type SavingsDestinationResult, type SavingsOrigin, type GoalCoverage, type SavingsDestinationType,
} from '@/lib/savingsDestination';
import { fetchUserFinancialContext } from '@/lib/savingsDestinationContext';
import { formatCurrency } from '@/utils/format';
import { checkAndNotifyBudgetLimits } from '@/lib/budgetNotifications';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:     '#F6F7F9',
  card:   '#FFFFFF',
  blue:   '#1976D2',
  green:  '#2E7D32',
  violet: '#7B61FF',
  red:    '#EF4444',
  amber:  '#F59E0B',
  text:   '#212121',
  sub:    '#757575',
  muted:  '#9E9E9E',
  border: '#E0E0E0',
  light:  '#F2F2F2',
} as const;

const shadow = layout.cardShadow;

// ─── Category Icon helper ─────────────────────────────────────────────────────

function CategoryIcon({ icon, color, size = 20 }: {
  icon: string | null; color: string; size?: number;
}) {
  if (!icon) return <Ionicons name="pricetag-outline" size={size} color={color} />;
  if (icon.includes('-') || /^[a-z]/.test(icon)) {
    return <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
  }
  return <Text style={{ fontSize: size - 2, lineHeight: size + 12 }}>{icon}</Text>;
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function HeroCard({ plan }: { plan: BudgetPlan }) {
  const spendPct  = Math.min(plan.totalCurrentSpend / (plan.totalAvg || 1), 1);
  const dayPct    = plan.dayOfMonth / plan.daysInMonth;
  const available = plan.totalAvg - plan.totalCurrentSpend;
  const isOver    = available < 0;

  return (
    <View style={hc.card}>
      <View style={hc.glow1} />
      <View style={hc.glow2} />

      {/* Clipboard illustration */}
      <Text style={hc.illustration}>📋</Text>

      {/* Title */}
      <View style={hc.topRow}>
        <Ionicons name="sparkles" size={14} color="#E9D5FF" />
        <Text style={hc.eyebrow}>Tus límites sugeridos para este mes</Text>
      </View>
      <Text style={hc.subtitle}>Calculados según tu promedio de los últimos 3 meses</Text>

      {/* Three labeled numbers */}
      <View style={hc.threeCol}>
        <View style={{ gap: 3, alignItems: 'center', flex: 1 }}>
          <Text style={hc.colLabel}>Presupuesto{'\n'}recomendado</Text>
          <Text style={hc.colValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
            {formatCurrency(plan.totalAvg)}
          </Text>
        </View>
        <View style={hc.dividerV} />
        <View style={{ gap: 3, alignItems: 'center', flex: 1 }}>
          <Text style={hc.colLabel}>Gastado{'\n'}hasta hoy</Text>
          <Text style={hc.colValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
            {formatCurrency(plan.totalCurrentSpend)}
          </Text>
        </View>
        <View style={hc.dividerV} />
        <View style={{ gap: 3, alignItems: 'center', flex: 1 }}>
          <Text style={hc.colLabel}>Disponible{'\n'}restante</Text>
          <Text style={[hc.colValue, { color: isOver ? '#FCA5A5' : '#BBF7D0' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
            {isOver ? '-' : ''}{formatCurrency(Math.abs(available))}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={{ gap: spacing[2] }}>
        <View style={hc.track}>
          <View style={[hc.fill, {
            width: `${Math.round(spendPct * 100)}%` as any,
            backgroundColor: isOver ? '#FCA5A5' : '#FFFFFF',
          }]} />
          <View style={[hc.dayMark, { left: `${Math.round(dayPct * 100)}%` as any }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={hc.trackLabel}>{Math.round(spendPct * 100)}% usado</Text>
          <Text style={hc.trackLabel}>Día {plan.dayOfMonth} de {plan.daysInMonth}</Text>
        </View>
      </View>
    </View>
  );
}

const hc = StyleSheet.create({
  card:         { backgroundColor: C.violet, borderRadius: 24, padding: spacing[6], gap: spacing[3], overflow: 'hidden', position: 'relative' },
  glow1:        { position: 'absolute', top: -50, right: -50, width: 180, height: 180, borderRadius: 90, backgroundColor: '#A78BFA30' },
  glow2:        { position: 'absolute', bottom: -40, left: -40, width: 130, height: 130, borderRadius: 65, backgroundColor: '#60A5FA18' },
  illustration: { position: 'absolute', top: -4, right: 12, fontSize: 70, opacity: 0.25 },
  topRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  eyebrow:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#EDE9FE', flex: 1 },
  subtitle:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#A78BFA', marginTop: -spacing[1] },
  threeCol:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF18', borderRadius: 14, padding: spacing[4] },
  dividerV:     { width: 1, height: 36, backgroundColor: '#FFFFFF30', marginHorizontal: spacing[2] },
  colLabel:     { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#C4B5FD', textAlign: 'center', lineHeight: 14 },
  colValue:     { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#FFFFFF', textAlign: 'center' },
  track:        { height: 6, backgroundColor: '#FFFFFF22', borderRadius: 3, overflow: 'visible', position: 'relative' },
  fill:         { height: '100%', borderRadius: 3 },
  dayMark:      { position: 'absolute', top: -3, width: 2, height: 12, backgroundColor: '#FFFFFF80', borderRadius: 1 },
  trackLabel:   { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: '#A78BFA' },
});

// ─── IA Insight card ──────────────────────────────────────────────────────────

function InsightCard({ savings, onPress }: { savings: number; onPress: () => void }) {
  return (
    <View style={ic.card}>
      <View style={ic.iaBadge}>
        <Text style={ic.iaText}>IA</Text>
      </View>
      <Text style={ic.body} numberOfLines={2}>
        Si ajustás las categorías excedidas,{'\n'}podrías ahorrar hasta{' '}
        <Text style={ic.amount}>{formatCurrency(savings)}</Text>
      </Text>
      <TouchableOpacity style={ic.btn} onPress={onPress} activeOpacity={0.8}>
        <Text style={ic.btnText}>Ver oportunidades</Text>
        <Ionicons name="chevron-forward" size={13} color={C.violet} />
      </TouchableOpacity>
    </View>
  );
}

const ic = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.card, borderRadius: 16, padding: spacing[4], ...shadow },
  iaBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iaText:  { fontFamily: 'Montserrat_800ExtraBold', fontSize: 11, color: '#FFF', letterSpacing: 0.5 },
  body:    { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18 },
  amount:  { fontFamily: 'Montserrat_700Bold', color: C.violet },
  btn:     { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1.5, borderColor: C.violet + '40', borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  btnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: C.violet },
});

// ─── Category budget card ─────────────────────────────────────────────────────

const LEVEL_COLOR: Record<AlertLevel, string> = {
  alerta:      C.red,
  atencion:    C.amber,
  oportunidad: C.green,
  normal:      C.blue,
};

function CategoryBudgetCard({ cat, plan, onPress }: { cat: CategoryBudgetWithRecurring; plan: BudgetPlan; onPress: () => void }) {
  const insight     = buildCategoryInsight(cat, plan);
  const accentColor = LEVEL_COLOR[cat.alertLevel];
  const fillPct     = Math.min(cat.pct * 100, 100);
  const dayMarkPct  = Math.min((plan.dayOfMonth / plan.daysInMonth) * 100, 100);

  // Solo mostrar la nota de "pago recurrente" cuando aporta algo que el
  // usuario no pueda deducir solo del nivel/insight de arriba: o bien
  // explica por qué NO hay alerta pese al monto (el ajuste cambió el
  // nivel), o bien el pago llegó por encima de lo habitual (sí es una alerta,
  // pero con contexto). Un "Alquiler esperado" sin ningún cambio de nivel no
  // suma nada — se omite a propósito para no saturar la tarjeta.
  const showRecurringNote = cat.recurring && (
    cat.recurring.status === 'desviado' || cat.originalAlertLevel !== cat.alertLevel
  );

  return (
    <TouchableOpacity style={cb.card} onPress={onPress} activeOpacity={0.82}>
      <View style={cb.topRow}>
        <View style={[cb.iconBox, { backgroundColor: accentColor + '12' }]}>
          <CategoryIcon icon={cat.icon} color={accentColor} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cb.name} numberOfLines={1}>{cat.name}</Text>
          <Text style={cb.spent}>
            Gastaste {formatCurrency(cat.currentSpend)} de {formatCurrency(cat.avgMonthly)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          <Text style={{ fontSize: 16 }}>{insight.emoji}</Text>
          <Text style={[cb.pctLabel, { color: accentColor }]}>{Math.round(cat.pct * 100)}%</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.muted} style={{ marginLeft: spacing[1] }} />
      </View>

      <View style={cb.track}>
        <View style={[cb.fill, { width: `${fillPct}%` as any, backgroundColor: accentColor }]} />
        {cat.hasHistory && (
          <View style={[cb.dayMark, { left: `${dayMarkPct}%` as any }]} />
        )}
      </View>
      {cat.hasHistory && (
        <Text style={cb.dayLabel}>Día {plan.dayOfMonth} de {plan.daysInMonth}</Text>
      )}

      <View style={cb.insightRow}>
        <Text style={[cb.insightHeadline, { color: accentColor }]}>{insight.headline}</Text>
        <Text style={cb.insightBody} numberOfLines={2}>{insight.body}</Text>
      </View>

      {showRecurringNote && cat.recurring && (
        <View style={[cb.recurringNote, { backgroundColor: (cat.recurring.status === 'desviado' ? C.red : C.blue) + '0D' }]}>
          <Text style={{ fontSize: 13 }}>{cat.recurring.status === 'desviado' ? '⚠️' : '🔵'}</Text>
          <Text style={cb.recurringText}>
            {cat.recurring.status === 'desviado'
              ? `"${cat.recurring.description}" es un pago recurrente, pero este mes (${formatCurrency(cat.recurring.currentAmount ?? 0)}) está muy por encima de tu habitual (${formatCurrency(cat.recurring.historicalAmount)}).`
              : `"${cat.recurring.description}" es un pago recurrente habitual (~${formatCurrency(cat.recurring.historicalAmount)}) — por eso no cuenta como desvío de ritmo.`}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const cb = StyleSheet.create({
  card:      { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], gap: spacing[3], ...shadow },
  topRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconBox:   { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 2 },
  spent:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  pctLabel:  { fontFamily: 'Montserrat_700Bold', fontSize: 12 },
  track:     { height: 5, backgroundColor: C.light, borderRadius: 3, overflow: 'visible', position: 'relative' },
  fill:      { height: '100%', borderRadius: 3 },
  dayMark:   { position: 'absolute', top: -2, width: 2, height: 9, backgroundColor: C.text + '50', borderRadius: 1 },
  dayLabel:  { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted, marginTop: -spacing[2] },
  insightRow:      { gap: 2, paddingTop: spacing[1], borderTopWidth: 1, borderTopColor: C.border },
  insightHeadline: { fontFamily: 'Montserrat_700Bold', fontSize: 12 },
  insightBody:     { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17 },
  recurringNote:   { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], borderRadius: 10, padding: spacing[2] },
  recurringText:   { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.sub, lineHeight: 15 },
});

// ─── Insights inteligentes (reemplaza el "Consejo inteligente" genérico) ──────

function InsightsSection({ insights }: { insights: CategoryInsight[] }) {
  return (
    <View style={{ gap: spacing[3] }}>
      {insights.map(ins => (
        <View key={ins.categoryId} style={[ic2.card, { borderColor: LEVEL_COLOR[ins.level] + '30' }]}>
          <Text style={ic2.emoji}>{ins.emoji}</Text>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[ic2.headline, { color: LEVEL_COLOR[ins.level] }]}>{ins.headline}</Text>
            <Text style={ic2.body}>{ins.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const ic2 = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], backgroundColor: C.card, borderWidth: 1, borderRadius: 16, padding: spacing[4], ...shadow },
  emoji:    { fontSize: 20, lineHeight: 24 },
  headline: { fontFamily: 'Montserrat_700Bold', fontSize: 13 },
  body:     { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub, lineHeight: 19 },
});

// ─── ¿Qué podrías hacer con este ahorro? (Fase 2) ─────────────────────────────

const DEST_META: Record<Exclude<SavingsDestinationType, 'deuda'>, { emoji: string; label: string; route: string }> = {
  objetivo:         { emoji: '🎯', label: 'Destinarlo a una meta',           route: '/(app)/savings-goal' },
  fondo_emergencia: { emoji: '🛟', label: 'Construir tu fondo de emergencia', route: '/(app)/savings' },
  liquidez:         { emoji: '💧', label: 'Dejarlo disponible',              route: '/(app)/savings' },
  inversion:        { emoji: '📈', label: 'Ver alternativas de inversión',    route: '/(app)/investment-alternatives' },
};

function SavingsDestinationCard({ monthlySaving, origin, result, goalCoverage }: {
  monthlySaving: number;
  origin: SavingsOrigin | null;
  result: SavingsDestinationResult;
  goalCoverage: GoalCoverage | null;
}) {
  const annual   = projectAnnualSaving(monthlySaving);
  const debtNote = result.destinations.find(d => d.type === 'deuda');
  const buttons  = result.destinations.filter(d => d.type !== 'deuda').slice(0, 3);

  return (
    <View style={sd.card}>
      <View style={sd.header}>
        <Text style={{ fontSize: 18 }}>💰</Text>
        <Text style={sd.title}>¿Qué podrías hacer con este ahorro?</Text>
      </View>

      <Text style={sd.amount}>Podrías liberar {formatCurrency(monthlySaving)}</Text>

      {origin && (
        <Text style={sd.originText}>
          {origin.isRealized
            ? `Ya estás gastando ~${formatCurrency(origin.amount)} menos de lo habitual en ${origin.categoryName.toLowerCase()} este mes.`
            : `Volviendo a tu ritmo habitual en ${origin.categoryName.toLowerCase()}${origin.approxPct != null ? ` (~${origin.approxPct}% menos)` : ''}, podrías liberar ~${formatCurrency(origin.amount)}.`}
        </Text>
      )}

      <Text style={sd.annualText}>
        Manteniéndolo 12 meses, serían aproximadamente {formatCurrency(annual)}.
        {goalCoverage ? ` Eso cubriría ~${goalCoverage.coveragePct}% de tu meta "${goalCoverage.title}".` : ''}
      </Text>

      {!result.hasSufficientData ? (
        <Text style={sd.missingText}>
          Para recomendarte qué hacer con este dinero necesito conocer un poco más sobre tu situación
          {result.missingInfo.length > 0 ? ` (${result.missingInfo.join(', ')})` : ''}.
        </Text>
      ) : (
        <>
          {debtNote && (
            <View style={sd.debtNote}>
              <Text style={{ fontSize: 13 }}>💳</Text>
              <Text style={sd.debtNoteText}>{debtNote.rationale}</Text>
            </View>
          )}
          {buttons.length > 0 && (
            <>
              <Text style={sd.helpText}>Este dinero podría ayudarte a:</Text>
              <View style={{ gap: spacing[2] }}>
                {buttons.map(d => {
                  const meta = DEST_META[d.type as Exclude<SavingsDestinationType, 'deuda'>];
                  return (
                    <TouchableOpacity
                      key={d.type}
                      style={sd.destBtn}
                      activeOpacity={0.8}
                      onPress={() => router.push(meta.route as any)}
                    >
                      <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                      <Text style={sd.destBtnText}>{meta.label}</Text>
                      <Ionicons name="chevron-forward" size={14} color={C.violet} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

const sd = StyleSheet.create({
  card:        { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], gap: spacing[2], ...shadow },
  header:      { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title:       { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text, flex: 1 },
  amount:      { fontFamily: 'Montserrat_800ExtraBold', fontSize: 18, color: C.violet, marginTop: spacing[1] },
  originText:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17 },
  annualText:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted, lineHeight: 17 },
  missingText: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17, fontStyle: 'italic', marginTop: spacing[1] },
  debtNote:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], backgroundColor: C.amber + '12', borderRadius: 10, padding: spacing[2], marginTop: spacing[1] },
  debtNoteText:{ flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.sub, lineHeight: 15 },
  helpText:    { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.text, marginTop: spacing[2] },
  destBtn:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1.5, borderColor: C.violet + '30', backgroundColor: C.violet + '0A', borderRadius: 12, padding: spacing[3] },
  destBtnText: { flex: 1, fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.text },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

/** BudgetPlan cuyas categorías ya pasaron por el ajuste de recurrencia. */
type PlanWithRecurring = Omit<BudgetPlan, 'categories'> & { categories: CategoryBudgetWithRecurring[] };

export default function SavingsPlanScreen() {
  const { user }       = useAuthStore();
  const [plan,         setPlan]        = useState<PlanWithRecurring | null>(null);
  const [loading,      setLoading]     = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAll,      setShowAll]     = useState(false);
  const [savingsResult,   setSavingsResult]   = useState<SavingsDestinationResult | null>(null);
  const [savingsOrigin,   setSavingsOrigin]   = useState<SavingsOrigin | null>(null);
  const [goalCoverage,    setGoalCoverage]    = useState<GoalCoverage | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const data = await fetchBudgetPlan(user.id);
    if (!data) { setPlan(null); setLoading(false); return; }

    // Capa de recurrencia: ajusta el ritmo de las categorías con un pago
    // grande esperado (alquiler, gimnasio, suscripciones...) para que no
    // disparen una alerta falsa solo por llegar temprano en el mes. No
    // reemplaza el motor de ritmo — lo alimenta con el remanente correcto.
    const evaluations = await fetchRecurringEvaluations(user.id);
    const categories  = applyRecurringContext(data, evaluations);
    const potentialSavings = computePotentialSavings(categories);
    const adjusted: PlanWithRecurring = { ...data, categories, potentialSavings };

    setPlan(adjusted);
    setLoading(false);
    checkAndNotifyBudgetLimits(adjusted);

    // Fase 2 — "¿qué podrías hacer con este ahorro?". El monto nunca se
    // recalcula acá: siempre es `potentialSavings`, el mismo número que ya
    // muestra el resto de la pantalla (única fuente de verdad).
    if (potentialSavings > 500) {
      const origin = describeSavingsOrigin(categories.map(c => ({
        categoryName: c.name,
        amount:       buildCategoryInsight(c, adjusted).amount,
        level:        c.alertLevel,
        base:         c.avgMonthly,
      })));
      setSavingsOrigin(origin);

      const { estimatedIncome } = useExpensesStore.getState();
      const ctx = await fetchUserFinancialContext(user.id, {
        monthlyPotentialSaving: potentialSavings,
        estimatedIncome,
        avgMonthlySpend: adjusted.totalAvg,
      });
      const result = determineSavingsDestinations(ctx);
      setSavingsResult(result);

      const hasObjetivo = result.destinations.some(d => d.type === 'objetivo');
      const activeGoals = ctx.goals.filter(g => g.currentAmount < g.targetAmount);
      const featured     = hasObjetivo ? pickFeaturedGoal(activeGoals) : null;
      setGoalCoverage(featured ? computeGoalCoverage(featured, potentialSavings) : null);
    } else {
      setSavingsResult(null);
      setSavingsOrigin(null);
      setGoalCoverage(null);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const handleCategoryPress = (cat: CategoryBudget) => {
    router.push({
      pathname: '/(app)/category-detail' as any,
      params: { categoryJson: JSON.stringify(cat) },
    });
  };

  const visibleCategories = showAll
    ? (plan?.categories ?? [])
    : (plan?.categories ?? []).slice(0, 6);

  const insights = plan
    ? (selectRelevantInsights(plan).length > 0 ? selectRelevantInsights(plan) : [buildAllGoodInsight()])
    : [];

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.circleBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Plan Inteligente</Text>
        <TouchableOpacity style={st.circleBtn} activeOpacity={0.7}>
          <Ionicons name="information-circle-outline" size={20} color={C.sub} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={st.centered}>
          <ActivityIndicator size="large" color={C.violet} />
          <Text style={st.loadingText}>Calculando tu presupuesto...</Text>
        </View>
      ) : !plan || plan.categories.length === 0 ? (
        <View style={st.centered}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={st.emptyTitle}>Sin datos suficientes</Text>
          <Text style={st.emptySub}>Registrá gastos durante al menos un mes para ver tu plan.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.violet} />}
        >
          {/* Hero */}
          <HeroCard plan={plan} />

          {/* IA insight card */}
          {plan.potentialSavings > 500 && (
            <InsightCard
              savings={plan.potentialSavings}
              onPress={() => router.push('/(app)/savings-opportunities' as any)}
            />
          )}

          {/* Por categoría */}
          <View style={st.sectionHeader}>
            <Text style={st.sectionTitle}>Por categoría</Text>
            <Text style={st.sectionSub}>Tocá para ver el detalle</Text>
          </View>

          {visibleCategories.map(cat => (
            <CategoryBudgetCard
              key={cat.categoryId}
              cat={cat}
              plan={plan}
              onPress={() => handleCategoryPress(cat)}
            />
          ))}

          {!showAll && plan.categories.length > 6 && (
            <TouchableOpacity style={st.showAllBtn} onPress={() => setShowAll(true)} activeOpacity={0.8}>
              <Text style={st.showAllText}>Ver todas las categorías ({plan.categories.length})</Text>
              <Ionicons name="chevron-down" size={14} color={C.blue} />
            </TouchableOpacity>
          )}

          {/* Insights inteligentes por categoría */}
          <View style={st.sectionHeader}>
            <Text style={st.sectionTitle}>Lo que está pasando</Text>
          </View>
          <InsightsSection insights={insights} />

          {/* Fase 2 — ¿qué podrías hacer con este ahorro? */}
          {plan.potentialSavings > 500 && savingsResult && (
            <SavingsDestinationCard
              monthlySaving={plan.potentialSavings}
              origin={savingsOrigin}
              result={savingsResult}
              goalCoverage={goalCoverage}
            />
          )}

          <Text style={st.footnote}>
            Límites calculados con tu promedio de los últimos 3 meses. Ritmo calculado según el día {plan.dayOfMonth} de {plan.daysInMonth}.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], paddingBottom: spacing[4] },
  headerTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  circleBtn:    { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], paddingHorizontal: layout.screenPadding },
  loadingText:  { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.sub, marginTop: spacing[3] },
  emptyTitle:   { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text, textAlign: 'center' },
  emptySub:     { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 20 },
  scroll:       { paddingHorizontal: layout.screenPadding, paddingBottom: layout.tabBarHeight + spacing[6], gap: spacing[4] },
  sectionHeader:{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  sectionSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  showAllBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: C.blue + '0D', borderWidth: 1, borderColor: C.blue + '25', borderRadius: 14, padding: spacing[4] },
  showAllText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.blue },
  footnote:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 16 },
});
