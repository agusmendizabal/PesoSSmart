import React, { useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, PressableCard, AmountDisplay, Badge } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { getGreeting, formatCurrency } from '@/utils/format';

export default function HomeScreen() {
  const { profile, user } = useAuthStore();
  const {
    expenses,
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
    fetchExpenses,
    isLoading,
  } = useExpensesStore();

  useEffect(() => {
    if (user?.id) fetchExpenses(user.id);
  }, [user?.id]);

  const greeting = getGreeting(profile?.full_name ?? undefined);
  const recentExpenses = expenses.slice(0, 3);

  // Cálculo estimado del dinero potencialmente invertible
  const potentialInvestable = totalInvestable > 0 ? totalInvestable * 0.3 : 0;

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
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text variant="label" color={colors.text.secondary}>
              {greeting.toUpperCase().includes(',' )
                ? greeting.toUpperCase().split(',')[0]
                : greeting.toUpperCase()}
            </Text>
            <Text variant="h4" color={colors.text.primary}>
              {profile?.full_name?.split(' ')[0] ?? 'Ahí vamos'} 👋
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(app)/profile')}
            style={styles.avatarBtn}
          >
            <Ionicons name="person-circle-outline" size={36} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* Main KPI Card */}
        <Card variant="default" style={styles.mainCard}>
          <Text variant="label" color={colors.text.secondary}>GASTASTE ESTE MES</Text>
          <AmountDisplay amount={totalThisMonth} size="xl" />
          <View style={styles.mainCardRow}>
            <View style={styles.kpiItem}>
              <Text variant="caption" color={colors.text.secondary}>NECESARIO</Text>
              <Text variant="labelMd" color={colors.info ?? '#82b1ff'}>
                {formatCurrency(totalNecessary)}
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text variant="caption" color={colors.text.secondary}>PRESCINDIBLE</Text>
              <Text variant="labelMd" color={colors.red}>
                {formatCurrency(totalDisposable)}
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text variant="caption" color={colors.text.secondary}>INVERTIBLE</Text>
              <Text variant="labelMd" color={colors.neon}>
                {formatCurrency(totalInvestable)}
              </Text>
            </View>
          </View>
        </Card>

        {/* Alerta / Insight */}
        {totalDisposable > 0 && (
          <Card variant="default" style={styles.insightCard}>
            <View style={styles.insightRow}>
              <Ionicons name="warning-outline" size={20} color={colors.yellow} />
              <View style={{ flex: 1, marginLeft: spacing[3] }}>
                <Text variant="bodySmall" color={colors.text.primary}>
                  Tenés {formatCurrency(totalDisposable)} en gastos prescindibles este mes.
                </Text>
                <Text variant="caption" color={colors.text.secondary} style={{ marginTop: spacing[1] }}>
                  Si evitás la mitad, podés arrancar a invertir.
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Quick Actions */}
        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.text.secondary}>ACCIONES RÁPIDAS</Text>
        </View>
        <View style={styles.quickActions}>
          <PressableCard
            style={styles.actionCard}
            onPress={() => router.push('/(app)/expenses')}
          >
            <Ionicons name="add-circle-outline" size={28} color={colors.neon} />
            <Text variant="bodySmall" color={colors.text.primary} style={styles.actionLabel}>
              Agregar gasto
            </Text>
          </PressableCard>
          <PressableCard
            style={styles.actionCard}
            onPress={() => router.push('/(app)/advisor')}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.yellow} />
            <Text variant="bodySmall" color={colors.text.primary} style={styles.actionLabel}>
              Asesor IA
            </Text>
          </PressableCard>
          <PressableCard
            style={styles.actionCard}
            onPress={() => router.push('/(app)/reports')}
          >
            <Ionicons name="bar-chart-outline" size={28} color={colors.info ?? '#82b1ff'} />
            <Text variant="bodySmall" color={colors.text.primary} style={styles.actionLabel}>
              Mi informe
            </Text>
          </PressableCard>
        </View>

        {/* Últimos gastos */}
        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.text.secondary}>ÚLTIMOS GASTOS</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/expenses')}>
            <Text variant="label" color={colors.neon}>VER TODOS</Text>
          </TouchableOpacity>
        </View>

        {recentExpenses.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text variant="body" color={colors.text.secondary} align="center">
              Todavía no cargaste gastos.{'\n'}Empezá a trackear tu plata.
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/(app)/expenses')}
            >
              <Text variant="bodySmall" color={colors.neon}>
                + Agregar primer gasto
              </Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={styles.expenseList}>
            {recentExpenses.map((expense) => (
              <PressableCard
                key={expense.id}
                style={styles.expenseItem}
                onPress={() => router.push('/(app)/expenses')}
              >
                <View style={styles.expenseRow}>
                  <View style={styles.expenseLeft}>
                    <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>
                      {expense.description}
                    </Text>
                    <View style={styles.expenseMetaRow}>
                      <Text variant="caption" color={colors.text.secondary}>
                        {expense.date}
                      </Text>
                      {expense.classification && (
                        <Badge classification={expense.classification} small />
                      )}
                    </View>
                  </View>
                  <Text variant="labelMd" color={colors.text.primary}>
                    {formatCurrency(expense.amount)}
                  </Text>
                </View>
              </PressableCard>
            ))}
          </View>
        )}

        {/* Simulador promo */}
        <PressableCard
          variant="neon"
          style={styles.simulatorPromo}
          onPress={() => router.push('/(app)/reports')}
        >
          <View style={styles.simulatorContent}>
            <Ionicons name="trending-up" size={32} color={colors.neon} />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle" color={colors.neon}>
                ¿Qué hubiera pasado si invertías?
              </Text>
              <Text variant="bodySmall" color={colors.text.secondary}>
                Simulá con datos reales de Argentina.
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.neon} />
          </View>
        </PressableCard>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[4],
    gap: spacing[4],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  avatarBtn: { padding: spacing[1] },
  mainCard: {
    padding: spacing[5],
    gap: spacing[3],
  },
  mainCardRow: {
    flexDirection: 'row',
    marginTop: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  kpiItem: { flex: 1, gap: spacing[1] },
  kpiDivider: {
    width: 1,
    backgroundColor: colors.border.subtle,
    marginHorizontal: spacing[3],
  },
  insightCard: {
    padding: spacing[4],
    borderLeftWidth: 3,
    borderLeftColor: colors.yellow,
  },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  actionCard: {
    flex: 1,
    padding: spacing[4],
    alignItems: 'center',
    gap: spacing[2],
  },
  actionLabel: {
    textAlign: 'center',
    fontSize: 12,
  },
  expenseList: { gap: spacing[2] },
  expenseItem: { padding: spacing[4] },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expenseLeft: { flex: 1, marginRight: spacing[4], gap: spacing[1] },
  expenseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  emptyCard: {
    padding: spacing[6],
    alignItems: 'center',
    gap: spacing[4],
  },
  emptyBtn: {
    marginTop: spacing[2],
  },
  simulatorPromo: {
    padding: spacing[5],
    marginTop: spacing[2],
  },
  simulatorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
});
