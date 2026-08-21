import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { fetchBudgetPlan, computePotentialSavings } from '@/lib/budgetPlan';
import { fetchRecurringEvaluations, applyRecurringContext } from '@/lib/recurringAdjustment';
import { determineSavingsDestinations, computeGoalCoverage, computeRequiredMonthlySaving, pickFeaturedGoal, describeSavingsOrigin, type SavingsDestinationResult, type GoalCoverage, type UserGoal } from '@/lib/savingsDestination';
import { fetchUserFinancialContext } from '@/lib/savingsDestinationContext';
import { buildCategoryInsight } from '@/lib/budgetInsights';
import {
  shouldConsiderInvesting, classifyHorizon, detectConcentration, evaluateInvestmentCategories,
  pickTopCategories, computeInvestmentConfidence, projectSavingsScenario,
  type InvestmentReadiness, type CategoryEvaluation, type HorizonBucket, type ConfidenceResult, type ConcentrationResult,
} from '@/lib/investmentCategories';
import { fetchEconomicIndicators, fetchExistingInvestments, type EconomicDataPoint } from '@/lib/investmentReadinessContext';
import { buildInvestmentAdvisorContext, computeContextFingerprint, trimConversationHistory, type InvestmentAdvisorContext, type ChatMessage, type AdvisorCategorySummary } from '@/lib/investmentAdvisorContext';
import {
  shouldRegenerateExplanation, CONTEXT_CHANGED_NOTICE, HISTORY_LOAD_ERROR_MESSAGE, ASSISTANT_ERROR_MESSAGE,
  selectSuggestedQuestions, buildQuickActions, type ChatSituationFlags, type QuickAction,
} from '@/lib/investmentChatContinuity';
import { findOrCreateInvestmentThread, loadThreadMessages, saveMessageToThread, updateThreadFingerprint, type StoredChatMessage } from '@/lib/investmentChatPersistence';
import { formatCurrency } from '@/utils/format';

// ─── Design tokens (mismos que savings-plan.tsx) ──────────────────────────────

const C = {
  bg: '#FAFAF7', card: '#FFFFFF', blue: '#1976D2', green: '#27AE60', violet: '#27AE60',
  red: '#EF4444', amber: '#F59E0B', text: '#1C1C1C', sub: '#6D6A63', muted: '#9B9790',
  border: '#E8E2D9', light: '#F5F1E9',
} as const;

const shadow = layout.cardShadow;

const RISK_LABEL: Record<string, string> = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' };
const LIQ_LABEL:  Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const HORIZON_LABEL: Record<HorizonBucket, string> = { corto: 'Corto plazo', mediano: 'Mediano plazo', largo: 'Largo plazo', sin_definir: 'Sin definir' };
const PROFILE_LABEL: Record<string, string> = { conservative: 'Conservador', moderate: 'Moderado', aggressive: 'Agresivo' };
const RISK_COLOR: Record<string, string> = { bajo: C.green, medio: C.amber, alto: C.red };

// ─── Estado consolidado de la pantalla ─────────────────────────────────────────

interface ScreenState {
  monthlySaving: number;
  destinationResult: SavingsDestinationResult;
  readiness: InvestmentReadiness;
  horizon: HorizonBucket;
  featuredGoal: UserGoal | null;
  goalCoverage: GoalCoverage | null;
  riskProfile: string | null;
  savingsAmount: number | null;
  savingsSource: string;
  concentration: ConcentrationResult | null;
  categoryEvaluations: CategoryEvaluation[];
  economicData: EconomicDataPoint[];
  confidence: ConfidenceResult;
  scenario: ReturnType<typeof projectSavingsScenario>;
  advisorContext: InvestmentAdvisorContext;
  situationFlags: ChatSituationFlags;
}

export default function InvestmentAlternativesScreen() {
  const { user } = useAuthStore();
  const [state, setState] = useState<ScreenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const plan = await fetchBudgetPlan(user.id);
    if (!plan) { setState(null); setLoading(false); return; }

    const evaluations = await fetchRecurringEvaluations(user.id);
    const categories  = applyRecurringContext(plan, evaluations);
    const monthlySaving = computePotentialSavings(categories);

    const { estimatedIncome } = useExpensesStore.getState();
    const ctx = await fetchUserFinancialContext(user.id, {
      monthlyPotentialSaving: monthlySaving,
      estimatedIncome,
      avgMonthlySpend: plan.totalAvg,
    });
    const destinationResult = determineSavingsDestinations(ctx);
    const readiness = shouldConsiderInvesting(destinationResult);

    const activeGoals  = ctx.goals.filter(g => g.currentAmount < g.targetAmount);
    const featuredGoal = pickFeaturedGoal(activeGoals);
    const horizon       = classifyHorizon(featuredGoal?.deadline ?? null);
    const goalCoverage  = featuredGoal ? computeGoalCoverage(featuredGoal, monthlySaving) : null;

    const [existingInvestments, economicData] = await Promise.all([
      fetchExistingInvestments(user.id),
      fetchEconomicIndicators(),
    ]);
    const concentration = detectConcentration(existingInvestments);

    const categoryEvaluations = evaluateInvestmentCategories({
      riskProfile: ctx.riskProfile, horizon, concentration,
    });

    const economicDataFresh = economicData.length > 0 && !economicData.some(p => p.stale);
    const confidence = computeInvestmentConfidence({
      riskProfileKnown: ctx.riskProfile != null,
      horizon,
      economicDataFresh,
    });

    // Único cálculo de escenario — lo consume tanto la UI (AlternativesSection)
    // como el contexto que se le manda al LLM. Nunca se recalcula dos veces.
    const inflationPoint = economicData.find(p => p.source === 'INDEC');
    const scenario = inflationPoint
      ? projectSavingsScenario(monthlySaving, 12, inflationPoint.value, `la inflación de ${inflationPoint.period}`)
      : projectSavingsScenario(monthlySaving, 12);

    // Gastos por categoría para el asistente accionable (Fase 6) — reusa
    // exactamente lo que ya calculó Fase 1 (paceRatio, nivel) vía
    // buildCategoryInsight, en el mismo orden de prioridad que `categories`
    // ya trae (budgetPlan.ts ordena alerta > atención > oportunidad > normal).
    // Nada se recalcula acá.
    const gastos: AdvisorCategorySummary[] = categories.map(cat => {
      const insight = buildCategoryInsight(cat, plan);
      return {
        nombre: cat.name,
        gastoActual: cat.currentSpend,
        promedioHistorico: cat.avgMonthly,
        ritmoEsperado: cat.expectedByNow,
        paceRatio: cat.paceRatio,
        nivel: cat.alertLevel,
        ahorroPotencial: insight.amount,
        insight: insight.body,
        esRecurrente: cat.recurring != null,
      };
    });

    const origin = describeSavingsOrigin(categories.map(c => ({
      categoryName: c.name,
      amount: buildCategoryInsight(c, plan).amount,
      level: c.alertLevel,
      base: c.avgMonthly,
    })));

    const requiredMonthly = featuredGoal ? computeRequiredMonthlySaving(featuredGoal) : null;

    const advisorContext = buildInvestmentAdvisorContext({
      ahorroDisponible: ctx.savings.amount,
      ahorroDisponibleFuente: ctx.savings.source,
      ahorroMensual: monthlySaving,
      gastoPromedioMensual: plan.totalAvg,
      tieneDeudaConocida: ctx.debt.known ? ctx.debt.hasDebt : null,
      perfilRiesgo: ctx.riskProfile,
      horizonte: horizon,
      objetivo: featuredGoal ? {
        titulo: featuredGoal.title,
        coveragePct: goalCoverage?.coveragePct ?? null,
        mesesProyectados: goalCoverage?.monthsProjected ?? null,
        montoObjetivo: featuredGoal.targetAmount,
        montoActual: featuredGoal.currentAmount,
        fechaLimite: featuredGoal.deadline,
        montoMensualNecesario: requiredMonthly,
      } : null,
      categoryEvaluations,
      concentration,
      economicData,
      scenario,
      confidence,
      ingresoDisponible: estimatedIncome,
      readiness: { elegible: readiness.eligible, motivo: readiness.reason },
      categories: gastos,
      origenAhorro: origin ? {
        categoria: origin.categoryName, monto: origin.amount,
        esRealizado: origin.isRealized, porcentajeAprox: origin.approxPct,
      } : null,
    });

    const situationFlags: ChatSituationFlags = {
      hasSavingsOpportunity: monthlySaving > 500,
      hasGoal: featuredGoal != null,
      readyToInvest: readiness.eligible,
    };

    setState({
      monthlySaving, destinationResult, readiness, horizon, featuredGoal, goalCoverage,
      riskProfile: ctx.riskProfile, savingsAmount: ctx.savings.amount, savingsSource: ctx.savings.source,
      concentration, categoryEvaluations, economicData, confidence, scenario, advisorContext, situationFlags,
    });
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => { setIsRefreshing(true); await load(); setIsRefreshing(false); };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity style={st.circleBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Alternativas de inversión</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={st.centered}>
          <ActivityIndicator size="large" color={C.violet} />
          <Text style={st.loadingText}>Analizando tu situación...</Text>
        </View>
      ) : !state ? (
        <View style={st.centered}>
          <Text style={{ fontSize: 48 }}>📊</Text>
          <Text style={st.emptyTitle}>Sin datos suficientes</Text>
          <Text style={st.emptySub}>Registrá gastos durante al menos un mes para ver esto.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.violet} />}
        >
          <Text style={st.legalNote}>
            Contenido educativo, no es una recomendación de inversión ni asesoramiento financiero personalizado. No garantiza resultados futuros.
          </Text>

          {!state.readiness.eligible ? (
            <NotReadyCard reason={state.readiness.reason} />
          ) : (
            <>
              <SituationSection state={state} />
              {state.confidence.level === 'baja' && (
                <LowConfidenceNote missing={state.confidence.missing} />
              )}
              <AlternativesSection evaluations={state.categoryEvaluations} monthlySaving={state.monthlySaving} scenario={state.scenario} />
            </>
          )}

          {/* El asistente conversa igual cuando todavía no corresponde invertir —
              es justo donde puede explicar "qué tendría que cambiar" (Fase 6, punto 8). */}
          <InvestmentAdvisorSection advisorContext={state.advisorContext} userId={user!.id} situationFlags={state.situationFlags} />

          {state.readiness.eligible && <EconomicDataSection points={state.economicData} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── "Todavía no es momento" ────────────────────────────────────────────────

function NotReadyCard({ reason }: { reason: string }) {
  return (
    <View style={notReady.card}>
      <Text style={{ fontSize: 28 }}>🛟</Text>
      <Text style={notReady.title}>Todavía no es momento de priorizar inversión</Text>
      <Text style={notReady.body}>{reason}</Text>
    </View>
  );
}

const notReady = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: spacing[5], gap: spacing[2], alignItems: 'center', ...shadow },
  title: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.text, textAlign: 'center' },
  body: { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub, textAlign: 'center', lineHeight: 19 },
});

// ─── Tu situación ────────────────────────────────────────────────────────────

function SituationSection({ state }: { state: ScreenState }) {
  const rows = [
    { label: 'Ahorro disponible', value: state.savingsAmount != null ? formatCurrency(state.savingsAmount) : 'No lo sabemos' },
    { label: 'Ahorro mensual detectado', value: formatCurrency(state.monthlySaving) },
    { label: 'Objetivo', value: state.featuredGoal ? state.featuredGoal.title : 'Sin objetivo definido' },
    { label: 'Horizonte', value: HORIZON_LABEL[state.horizon] },
    { label: 'Perfil de riesgo', value: state.riskProfile ? PROFILE_LABEL[state.riskProfile] : 'No definido' },
  ];
  return (
    <View style={sit.card}>
      <Text style={sit.title}>Tu situación</Text>
      {rows.map(r => (
        <View key={r.label} style={sit.row}>
          <Text style={sit.label}>{r.label}</Text>
          <Text style={sit.value}>{r.value}</Text>
        </View>
      ))}
      {state.goalCoverage && (
        <Text style={sit.footnote}>
          Manteniendo este ahorro, cubrirías ~{state.goalCoverage.coveragePct}% de "{state.goalCoverage.title}" en {state.goalCoverage.monthsProjected} meses.
        </Text>
      )}
      {state.concentration?.concentrated && (
        <Text style={sit.warning}>
          ⚠️ Tenés ~{state.concentration.pct}% de tus inversiones registradas concentradas en un solo tipo de activo.
        </Text>
      )}
    </View>
  );
}

const sit = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], gap: spacing[2], ...shadow },
  title: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text, marginBottom: spacing[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub },
  value: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.text },
  footnote: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, lineHeight: 16, marginTop: spacing[1] },
  warning: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.amber, lineHeight: 16, marginTop: spacing[1] },
});

function LowConfidenceNote({ missing }: { missing: string[] }) {
  return (
    <View style={low.card}>
      <Text style={low.text}>
        Para darte una recomendación más precisa, nos ayudaría conocer {missing.join(' y ')}. Mientras tanto, te mostramos solo las alternativas más conservadoras.
      </Text>
    </View>
  );
}

const low = StyleSheet.create({
  card: { backgroundColor: C.amber + '12', borderWidth: 1, borderColor: C.amber + '30', borderRadius: 14, padding: spacing[3] },
  text: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18, fontStyle: 'italic' },
});

// ─── Alternativas que podrían encajar ───────────────────────────────────────

function AlternativesSection({ evaluations, monthlySaving, scenario }: {
  evaluations: CategoryEvaluation[]; monthlySaving: number; scenario: ReturnType<typeof projectSavingsScenario>;
}) {
  const top = pickTopCategories(evaluations, 3);

  if (top.length === 0) {
    return (
      <View style={alt.emptyCard}>
        <Text style={alt.emptyText}>
          Con la información disponible hoy, no encontramos una alternativa que encaje con claridad. Preferimos no sugerir nada antes que sugerir algo que no tenga sentido para vos.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[3] }}>
      <View>
        <Text style={alt.sectionTitle}>Alternativas que podrían encajar</Text>
        <Text style={alt.sectionSub}>
          Manteniendo {formatCurrency(monthlySaving)}/mes durante 12 meses, acumularías {formatCurrency(scenario.nominalSaved)} en total (sin contar ningún rendimiento).
          {scenario.scenarioValue != null && ` En un escenario hipotético con ${scenario.assumptionLabel!.split(' — ')[0].replace('Escenario hipotético si ', '')}, serían aproximadamente ${formatCurrency(scenario.scenarioValue)}.`}
        </Text>
        {scenario.assumptionLabel && (
          <Text style={alt.assumption}>{scenario.assumptionLabel}</Text>
        )}
      </View>

      {top.map(ev => (
        <View key={ev.category.id} style={alt.card}>
          <View style={alt.cardHeader}>
            <Text style={alt.cardName}>{ev.category.name}</Text>
          </View>
          <Text style={alt.cardDesc}>{ev.category.description}</Text>
          <View style={alt.tagsRow}>
            <Tag label={`Riesgo: ${RISK_LABEL[ev.category.risk]}`} color={RISK_COLOR[ev.category.risk]} />
            <Tag label={`Liquidez: ${LIQ_LABEL[ev.category.liquidity]}`} color={C.blue} />
          </View>
          <View style={alt.whyBox}>
            <Text style={alt.whyLabel}>¿Por qué podría encajar?</Text>
            <Text style={alt.whyText}>{ev.whyFits}</Text>
          </View>
          <View style={alt.considerBox}>
            <Text style={alt.considerLabel}>Qué deberías tener en cuenta</Text>
            <Text style={alt.considerText}>
              Rentabilidades pasadas no garantizan resultados futuros. Antes de operar, verificá el instrumento y al intermediario en los registros públicos de la CNV.
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[tag.box, { backgroundColor: color + '14', borderColor: color + '40' }]}>
      <Text style={[tag.text, { color }]}>{label}</Text>
    </View>
  );
}

const tag = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  text: { fontFamily: 'Montserrat_600SemiBold', fontSize: 11 },
});

const alt = StyleSheet.create({
  sectionTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.text },
  sectionSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18, marginTop: spacing[1] },
  assumption:   { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted, fontStyle: 'italic', marginTop: spacing[1] },
  emptyCard:    { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], ...shadow },
  emptyText:    { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub, lineHeight: 19, textAlign: 'center' },
  card:         { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], gap: spacing[2], ...shadow },
  cardHeader:   { flexDirection: 'row', alignItems: 'center' },
  cardName:     { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text, flex: 1 },
  cardDesc:     { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17 },
  tagsRow:      { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  whyBox:       { backgroundColor: C.violet + '0A', borderRadius: 10, padding: spacing[2], gap: 2 },
  whyLabel:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: C.violet },
  whyText:      { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.text, lineHeight: 17 },
  considerBox:  { gap: 2 },
  considerLabel:{ fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: C.muted },
  considerText: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted, lineHeight: 16 },
});

// ─── Tu asistente financiero: explicación + chat, con continuidad real ──────
//
// El LLM nunca calcula nada acá: recibe `advisorContext`, ya armado por
// `buildInvestmentAdvisorContext` a partir de lo que decidió el motor. Este
// componente decide CUÁNDO llamarlo (solo si `shouldRegenerateExplanation`
// dice que hace falta) y persiste toda la conversación en `chat_threads`/
// `chat_history` — la explicación inicial es, ahora, simplemente el primer
// mensaje del asistente en esa conversación, no un texto aparte cacheado
// localmente (así se evita tener dos mecanismos de cache distintos).

async function callInvestmentAdvisor(params: {
  mode: 'explain' | 'chat';
  userId: string;
  context: InvestmentAdvisorContext;
  message?: string;
  history?: ChatMessage[];
}): Promise<{ message: string } | { limitReached: true }> {
  const { data, error } = await supabase.functions.invoke('investment-advisor', {
    body: {
      mode: params.mode,
      user_id: params.userId,
      context: params.context,
      message: params.message ?? null,
      history: params.history ?? [],
    },
  });
  if (error) {
    const status = ((error as any)?.context as Response | undefined)?.status;
    if (status === 429) return { limitReached: true };
    throw new Error(error.message);
  }
  return { message: data?.message ?? 'No pude procesar esa pregunta. Probá de nuevo.' };
}

let localIdSeq = 0;
function localMessage(role: 'user' | 'assistant', content: string): StoredChatMessage {
  return { id: `local-${Date.now()}-${localIdSeq++}`, role, content, created_at: new Date().toISOString() };
}

function InvestmentAdvisorSection({ advisorContext, userId, situationFlags }: {
  advisorContext: InvestmentAdvisorContext; userId: string; situationFlags: ChatSituationFlags;
}) {
  const suggestedQuestions = selectSuggestedQuestions(situationFlags);
  const quickActions = buildQuickActions({ hasGoal: situationFlags.hasGoal });
  const [threadId, setThreadId]         = useState<string | null>(null);
  const [messages, setMessages]         = useState<StoredChatMessage[]>([]);
  const [loading, setLoading]           = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [errorNotice, setErrorNotice]   = useState(false);
  const [retryText, setRetryText]       = useState<string | null>(null);

  const fingerprint = computeContextFingerprint(advisorContext);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setHistoryError(false);
      try {
        const thread = await findOrCreateInvestmentThread(userId);
        if (cancelled) return;
        setThreadId(thread.id);

        let fullHistory: StoredChatMessage[] = [];
        let loadFailed = false;
        try {
          fullHistory = await loadThreadMessages(thread.id);
        } catch {
          loadFailed = true;
        }
        if (cancelled) return;
        setHistoryError(loadFailed);
        setMessages(fullHistory);

        // DB → historial completo (recién cargado arriba) → recorte a los
        // últimos 8 → LLM. El recorte nunca se guarda, solo se manda.
        const decision = shouldRegenerateExplanation({
          storedFingerprint: thread.context_fingerprint,
          currentFingerprint: fingerprint,
          hasExistingMessages: loadFailed ? thread.context_fingerprint != null : fullHistory.length > 0,
        });
        if (!decision.regenerate) { setLoading(false); return; }

        const historyForLLM = trimConversationHistory(fullHistory.map(m => ({ role: m.role, content: m.content })));
        const appended: StoredChatMessage[] = [];

        if (decision.showChangeNotice) {
          const notice = localMessage('assistant', CONTEXT_CHANGED_NOTICE);
          try { await saveMessageToThread(thread.id, userId, 'assistant', CONTEXT_CHANGED_NOTICE); } catch { /* se muestra igual aunque no se persista */ }
          appended.push(notice);
        }

        const result = await callInvestmentAdvisor({ mode: 'explain', userId, context: advisorContext, history: historyForLLM });
        if (!('limitReached' in result)) {
          appended.push(localMessage('assistant', result.message));
          try {
            await saveMessageToThread(thread.id, userId, 'assistant', result.message);
            await updateThreadFingerprint(thread.id, fingerprint);
          } catch { /* si no se pudo persistir, la próxima carga simplemente vuelve a intentar */ }
        }

        if (!cancelled && appended.length > 0) setMessages(prev => [...prev, ...appended]);
      } catch {
        if (!cancelled) setHistoryError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Solo se re-ejecuta si cambió el contexto real (fingerprint) o el usuario — nunca en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, userId]);

  const requestReply = async (priorMessages: StoredChatMessage[], userText: string) => {
    setSending(true);
    setErrorNotice(false);
    try {
      const historyForLLM = trimConversationHistory(priorMessages.map(m => ({ role: m.role, content: m.content })));
      const result = await callInvestmentAdvisor({ mode: 'chat', userId, context: advisorContext, message: userText, history: historyForLLM });
      if ('limitReached' in result) {
        Alert.alert('Límite de mensajes alcanzado', 'Agotaste los mensajes de tu plan este mes.', [
          { text: 'Ahora no', style: 'cancel' },
          { text: 'Ver planes', onPress: () => router.push('/(app)/plans') },
        ]);
        return;
      }
      if (threadId) { try { await saveMessageToThread(threadId, userId, 'assistant', result.message); } catch { /* el mensaje igual se muestra */ } }
      setMessages(prev => [...prev, localMessage('assistant', result.message)]);
      setRetryText(null);
    } catch {
      setErrorNotice(true);
      setRetryText(userText);
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !threadId) return;
    const priorMessages = messages;
    setMessages(prev => [...prev, localMessage('user', trimmed)]);
    setInput('');
    try { await saveMessageToThread(threadId, userId, 'user', trimmed); } catch { /* el mensaje del usuario igual se muestra y se puede reintentar la respuesta */ }
    await requestReply(priorMessages, trimmed);
  };

  const retry = () => {
    if (!retryText || messages.length === 0) return;
    requestReply(messages.slice(0, -1), retryText);
  };

  return (
    <View style={{ gap: spacing[3] }}>
      {historyError && (
        <View style={chat.noticeCard}>
          <Text style={chat.noticeText}>{HISTORY_LOAD_ERROR_MESSAGE}</Text>
        </View>
      )}

      <View style={chat.card}>
        <Text style={chat.title}>Tu asistente financiero</Text>
        <Text style={chat.subtitle}>Estoy viendo tu situación actual para ayudarte a entender tus opciones.</Text>

        {loading ? (
          <ActivityIndicator size="small" color={C.violet} style={{ marginVertical: spacing[4] }} />
        ) : (
          <>
            {messages.length === 0 ? (
              <>
                <Text style={chat.fallbackText}>
                  Reduciendo tu gasto a tu ritmo habitual podrías liberar {formatCurrency(advisorContext.situacion.ahorroMensual)}/mes. Preguntame lo que quieras sobre las alternativas de arriba.
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing[2] }} contentContainerStyle={{ gap: spacing[2] }}>
                  {suggestedQuestions.map(q => (
                    <TouchableOpacity key={q} style={chat.chip} onPress={() => sendMessage(q)} disabled={sending} activeOpacity={0.8}>
                      <Text style={chat.chipText}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <View style={{ gap: spacing[2], marginVertical: spacing[2] }}>
                {messages.map(m => (
                  <View key={m.id} style={[chat.bubble, m.role === 'user' ? chat.bubbleUser : chat.bubbleAssistant]}>
                    <Text style={[chat.bubbleText, m.role === 'user' && { color: '#FFF' }]}>{m.content}</Text>
                  </View>
                ))}
              </View>
            )}

            {sending && <ActivityIndicator size="small" color={C.violet} style={{ alignSelf: 'flex-start', marginBottom: spacing[2] }} />}

            {errorNotice && (
              <View style={chat.errorRow}>
                <Text style={chat.errorText}>{ASSISTANT_ERROR_MESSAGE}</Text>
                <TouchableOpacity onPress={retry} activeOpacity={0.8}>
                  <Text style={chat.retryText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={chat.inputRow}>
              <TextInput
                style={chat.input}
                placeholder="Escribí tu pregunta..."
                placeholderTextColor={C.muted}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => sendMessage(input)}
                editable={!sending}
              />
              <TouchableOpacity style={chat.sendBtn} onPress={() => sendMessage(input)} disabled={sending || !input.trim()} activeOpacity={0.8}>
                <Ionicons name="send" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>

            <View style={chat.actionsRow}>
              {quickActions.map(a => (
                <TouchableOpacity key={a.route} style={chat.actionBtn} onPress={() => router.push(a.route as any)} activeOpacity={0.8}>
                  <Text style={chat.actionText}>{a.label}</Text>
                  <Ionicons name="chevron-forward" size={12} color={C.violet} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const chat = StyleSheet.create({
  card:        { backgroundColor: C.card, borderRadius: 16, padding: spacing[4], gap: spacing[1], ...shadow },
  title:       { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  subtitle:    { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17 },
  fallbackText:{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18, marginTop: spacing[2] },
  chip:        { borderWidth: 1, borderColor: C.violet + '30', backgroundColor: C.violet + '0A', borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  chipText:    { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.violet },
  bubble:      { borderRadius: 14, padding: spacing[3], maxWidth: '90%' },
  bubbleUser:      { backgroundColor: C.violet, alignSelf: 'flex-end' },
  bubbleAssistant: { backgroundColor: C.light, alignSelf: 'flex-start' },
  bubbleText:  { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.text, lineHeight: 18 },
  inputRow:    { flexDirection: 'row', gap: spacing[2], alignItems: 'center', marginTop: spacing[1] },
  input:       { flex: 1, backgroundColor: C.light, borderRadius: 20, paddingHorizontal: spacing[4], paddingVertical: spacing[2], fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.text },
  sendBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center' },
  noticeCard:  { backgroundColor: C.amber + '12', borderWidth: 1, borderColor: C.amber + '30', borderRadius: 14, padding: spacing[3] },
  noticeText:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 17 },
  errorRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.red + '0D', borderRadius: 10, padding: spacing[2], marginBottom: spacing[2] },
  errorText:   { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.sub, lineHeight: 15 },
  retryText:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.violet, marginLeft: spacing[2] },
  actionsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: C.border },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.violet + '30', borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  actionText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.violet },
});

// ─── Datos utilizados (fuente + fecha, separado de la interpretación) ───────

function EconomicDataSection({ points }: { points: EconomicDataPoint[] }) {
  if (points.length === 0) return null;
  return (
    <View style={{ gap: spacing[2] }}>
      <Text style={eco.title}>Datos utilizados</Text>
      {points.map(p => (
        <View key={p.label} style={eco.row}>
          <Text style={eco.label}>{p.label}: {p.value}{p.unit}</Text>
          <Text style={[eco.source, p.stale && { color: C.amber }]}>
            Fuente: {p.source} — {p.updatedAt ? `actualizado ${new Date(p.updatedAt).toLocaleDateString('es-AR')}` : p.period}
            {p.stale ? ' (puede no estar al día)' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const eco = StyleSheet.create({
  title:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.muted },
  row:    { gap: 1 },
  label:  { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.text },
  source: { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted },
});

// ─── Screen chrome ───────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], paddingBottom: spacing[4] },
  headerTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  circleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], paddingHorizontal: layout.screenPadding },
  loadingText: { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.sub, marginTop: spacing[3] },
  emptyTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text, textAlign: 'center' },
  emptySub: { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 20 },
  scroll: { paddingHorizontal: layout.screenPadding, paddingBottom: layout.tabBarHeight + spacing[6], gap: spacing[4] },
  legalNote: { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted, lineHeight: 14, textAlign: 'center' },
});
