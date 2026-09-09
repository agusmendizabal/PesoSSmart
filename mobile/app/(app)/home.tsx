import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useGoalsStore } from '@/store/goalsStore';
import { useStreakStore } from '@/store/streakStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import { ResumenCard, CategoryDonut, SmartPlanCard } from '@/components/ReportCards';
import type { CategoryRowInput } from '@/lib/financialDiagnosis';
import { fetchBudgetPlan, type BudgetPlan } from '@/lib/budgetPlan';
import { BudgetRingIndicator } from '@/components/BudgetCard';
import { GoalsPreview } from '@/components/GoalsPreview';
import { HomeAlertBanners } from '@/components/HomeAlertBanners';
import { scheduleBudgetAlert } from '@/lib/notifications';
import { getGreeting } from '@/utils/format';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';
import { HomeSkeletonLoader } from '@/components/ui/SkeletonLoader';

const INCOME_OPTIONS = [
  { label: 'Menos de $500.000',       value: 'under_150k'  },
  { label: '$500.000 – $1.000.000',   value: '150k_300k'   },
  { label: '$1.000.000 – $2.000.000', value: '300k_500k'   },
  { label: '$2.000.000 – $3.500.000', value: '500k_800k'   },
  { label: '$3.500.000 – $6.000.000', value: '800k_1500k'  },
  { label: 'Más de $6.000.000',       value: 'over_1500k'  },
];

export default function HomeScreen() {
  const { user, profile } = useAuthStore();
  const {
    expenses, categories, totalThisMonth, totalNecessary, totalDisposable, totalInvestable,
    fetchExpenses, fetchCategories, fetchSubscriptionsAndProjection,
    estimatedIncome, isLoading,
  } = useExpensesStore();
  const { goals, fetchGoals } = useGoalsStore();
  const streakStore  = useStreakStore();
  const roundUpStore = useRoundUpStore();

  const [gmailConnected, setGmailConnected] = useState(false);
  const [mpConnected,    setMpConnected]    = useState(false);
  const [pendingCount,   setPendingCount]   = useState(0);
  const [budgetPlan,     setBudgetPlan]     = useState<BudgetPlan | null>(null);

  const { isFirstVisit, markVisited } = useFirstVisit('home');

  const now       = new Date();
  const month     = now.getMonth() + 1;
  const year      = now.getFullYear();

  // ── Carga inicial ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchCategories();
      fetchSubscriptionsAndProjection(user.id);
      fetchGoals(user.id);
      fetchBudgetPlan(user.id).then(setBudgetPlan);
    }
    streakStore.load();
    roundUpStore.load();
    roundUpStore.checkReset();

    if (user?.id) {
      (supabase as any)
        .from('pending_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .then(({ count }: { count: number | null }) => setPendingCount(count ?? 0));
    }
  }, [user?.id]);

  // Re-chequea conexiones cada vez que la pantalla vuelve al foco (ej: al volver de gmail-connect)
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
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
    }, [user?.id])
  );

  // Muestra aviso si no hay gastos cargados en los últimos 3 días
  const showExpensesWarning = useMemo(() => {
    if (isLoading) return false;
    const lastDate = expenses[0]?.date;
    if (!lastDate) return true;
    const cut = new Date();
    cut.setDate(cut.getDate() - 3);
    return lastDate < cut.toISOString().split('T')[0];
  }, [expenses, isLoading]);

  // Notificaciones de presupuesto
  useEffect(() => {
    if (!estimatedIncome || estimatedIncome <= 0) return;
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysLeft = daysInMonth - now.getDate();
    scheduleBudgetAlert(totalThisMonth / estimatedIncome, estimatedIncome - totalThisMonth, daysLeft).catch(() => {});
  }, [totalThisMonth, estimatedIncome]);

  // ── Resumen por categoría del mes ───────────────────────────────────────────
  const categoryRows = useMemo<CategoryRowInput[]>(() => {
    if (expenses.length === 0 || totalThisMonth === 0) return [];
    const catMap: Record<string, CategoryRowInput> = {};
    for (const e of expenses) {
      const cat = (e as any).category;
      const id  = cat?.id ?? 'none';
      if (!catMap[id]) catMap[id] = { id, name: cat?.name_es ?? 'Sin categoría', color: cat?.color ?? '#9B9790', amount: 0, pct: 0 };
      catMap[id].amount += e.amount;
    }
    return Object.values(catMap)
      .map(r => ({ ...r, pct: totalThisMonth > 0 ? r.amount / totalThisMonth : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, totalThisMonth]);

  // ── Editar ingreso ──────────────────────────────────────────────────────────
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [selectedRange,   setSelectedRange]   = useState<string | null>(null);
  const [savingIncome,    setSavingIncome]    = useState(false);

  const openIncomeModal = async () => {
    if (user?.id) {
      const { data } = await supabase
        .from('financial_profiles')
        .select('income_range')
        .eq('user_id', user.id)
        .single();
      setSelectedRange((data as any)?.income_range ?? null);
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => user?.id && fetchExpenses(user.id)}
            tintColor={colors.neon}
          />
        }
      >
        <View style={styles.greetingRow}>
          <Image source={require('../../assets/nomi-logo.jpeg')} style={styles.greetingLogo} />
          <Text variant="labelMd">{getGreeting(profile?.full_name ?? undefined)}</Text>
        </View>

        {/* ── AVISOS ──────────────────────────────────────────────────────────── */}
        <HomeAlertBanners
          userId={user?.id}
          showExpensesWarning={showExpensesWarning}
          gmailConnected={gmailConnected}
          mpConnected={mpConnected}
          onMpConnected={() => setMpConnected(true)}
        />

        {isLoading && expenses.length === 0 && <HomeSkeletonLoader />}

        {/* ── 1. RESUMEN POR CATEGORÍA DEL MES ────────────────────────────────── */}
        {categoryRows.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push('/(app)/movimientos' as any)}
          >
            <View style={{ gap: spacing[4] }}>
              <ResumenCard
                total={totalThisMonth}
                necessary={totalNecessary}
                disposable={totalDisposable}
                investable={totalInvestable}
                estimatedIncome={estimatedIncome}
              />
              <View style={styles.donutCard}>
                <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: spacing[4] }}>
                  DISTRIBUCIÓN POR CATEGORÍA
                </Text>
                <CategoryDonut rows={categoryRows} total={totalThisMonth} />
              </View>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.emptyCategoryCard}
            activeOpacity={0.85}
            onPress={() => router.push('/(app)/movimientos' as any)}
          >
            <Ionicons name="pie-chart-outline" size={22} color={colors.text.tertiary} />
            <View style={{ flex: 1 }}>
              <Text variant="labelMd">Todavía no cargaste gastos este mes</Text>
              <Text variant="caption" color={colors.text.secondary}>Tocá para cargar tu primer gasto</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={openIncomeModal} style={styles.editIncomeLink}>
          <Ionicons name="create-outline" size={13} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.tertiary}>Editar ingreso mensual</Text>
        </TouchableOpacity>

        {/* ── 2. PLAN INTELIGENTE ─────────────────────────────────────────────── */}
        {budgetPlan && (
          <SmartPlanCard
            amount={budgetPlan.potentialSavings}
            onPress={() => router.push('/(app)/savings-plan' as any)}
          />
        )}

        {/* ── 3. RECARGAR + PRESUPUESTOS ──────────────────────────────────────── */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => user?.id && fetchExpenses(user.id)}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {isLoading
              ? <ActivityIndicator size="small" color={colors.text.primary} />
              : <Ionicons name="refresh-outline" size={18} color={colors.text.primary} />
            }
            <Text variant="label">Recargar gastos</Text>
          </TouchableOpacity>

          {user?.id && (
            <View style={styles.actionBtn}>
              <BudgetRingIndicator
                userId={user.id}
                expenses={expenses}
                categories={categories}
                month={month}
                year={year}
              />
              <Text variant="label">Presupuestos</Text>
            </View>
          )}
        </View>

        {/* ── 4. METAS DE AHORRO ──────────────────────────────────────────────── */}
        <GoalsPreview goals={goals} />

        {/* ── 5. GASTOS SIN CLASIFICAR ─────────────────────────────────────────── */}
        {pendingCount > 0 && (
          <TouchableOpacity
            style={styles.pendingBanner}
            onPress={() => router.push('/(app)/movimientos' as any)}
            activeOpacity={0.85}
          >
            <Ionicons name="alert-circle-outline" size={20} color={colors.yellow} />
            <View style={{ flex: 1 }}>
              <Text variant="labelMd">
                Tenés {pendingCount} gasto{pendingCount === 1 ? '' : 's'} sin clasificar
              </Text>
              <Text variant="caption" color={colors.text.secondary}>Tocá para revisarlos</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* ── Tour primera visita ─────────────────────────────────────────────── */}
      <FirstVisitSheet
        visible={isFirstVisit}
        screenTitle="Tu dashboard financiero"
        screenIcon="home-outline"
        iconColor="#27AE60"
        features={[
          { icon: 'pie-chart-outline', color: '#27AE60', title: 'Tu resumen por categoría', body: 'Ves de un vistazo en qué se te va la plata este mes. Tocá para ver el detalle.' },
          { icon: 'sparkles-outline', color: '#27AE60', title: 'Plan inteligente', body: 'Un análisis generado por IA con tu situación real del mes y el próximo paso a seguir.' },
          { icon: 'mail-outline', color: '#27AE60', title: 'Gmail o Mercado Pago', body: 'Conectá alguno y dejamos de pedirte que cargues todo a mano.' },
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
        <View style={styles.incomeOverlay}>
          <View style={styles.incomeSheet}>
            <View style={styles.incomeSheetHandle} />
            <View style={styles.incomeSheetHeader}>
              <Text variant="subtitle">¿Cuánto ganás por mes?</Text>
              <TouchableOpacity onPress={() => setShowIncomeModal(false)}>
                <Ionicons name="close" size={22} color="#6D6A63" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#6D6A63', marginBottom: 16 }}>
              Ingreso neto mensual aproximado. Se usa para calcular tu salud financiera.
            </Text>
            <View style={{ gap: 8 }}>
              {INCOME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.incomeOption, selectedRange === opt.value && styles.incomeOptionActive]}
                  onPress={() => setSelectedRange(opt.value)}
                >
                  <Text style={[styles.incomeOptionText, selectedRange === opt.value && { color: '#27AE60', fontFamily: 'Montserrat_700Bold' }]}>
                    {opt.label}
                  </Text>
                  {selectedRange === opt.value && (
                    <Ionicons name="checkmark-circle" size={18} color="#27AE60" />
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

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { padding: layout.screenPadding, gap: spacing[4], paddingBottom: spacing[10] },

  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: -spacing[2],
  },
  greetingLogo: {
    width: 22,
    height: 22,
    borderRadius: 6,
    resizeMode: 'contain',
  },
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
  emptyCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.bg.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
  },
  editIncomeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: -spacing[2],
  },

  actionsRow: { flexDirection: 'row', gap: spacing[3] },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.bg.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingVertical: spacing[4],
  },

  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.yellow + '14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.yellow + '40',
    padding: spacing[4],
  },

  incomeOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  incomeSheet:         { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34 },
  incomeSheetHandle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 16 },
  incomeSheetHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  incomeOption:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0' },
  incomeOptionActive:  { borderColor: '#27AE60', backgroundColor: '#27AE6010' },
  incomeOptionText:    { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#212121' },
  incomeSaveBtn:       { backgroundColor: '#27AE60', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
});
