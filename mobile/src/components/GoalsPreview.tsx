import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text, Card } from '@/components/ui';
import { formatCurrency } from '@/utils/format';
import type { SavingsGoal } from '@/store/goalsStore';

/**
 * Vista de solo lectura de las metas de ahorro para Home — el alta/edición/
 * borrado y el "aportar" siguen viviendo en la pantalla de Ahorros.
 */
export function GoalsPreview({ goals }: { goals: SavingsGoal[] }) {
  if (goals.length === 0) {
    return (
      <TouchableOpacity
        style={styles.emptyCard}
        onPress={() => router.push('/(app)/savings-goal')}
        activeOpacity={0.85}
      >
        <Ionicons name="flag-outline" size={20} color={colors.text.tertiary} />
        <View style={{ flex: 1 }}>
          <Text variant="labelMd">Creá tu primera meta</Text>
          <Text variant="caption" color={colors.text.secondary}>Definí un objetivo y seguí tu progreso acá</Text>
        </View>
        <Ionicons name="add-circle" size={22} color={colors.neon} />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text variant="label" color={colors.text.secondary}>METAS DE AHORRO</Text>
        <TouchableOpacity onPress={() => router.push('/(app)/savings')}>
          <Text variant="caption" color={colors.neon}>Ver todas</Text>
        </TouchableOpacity>
      </View>
      {goals.map((goal) => {
        const pct = goal.target_amount > 0
          ? Math.min(goal.current_amount / goal.target_amount, 1)
          : 0;
        const pctInt = Math.round(pct * 100);
        const accent = pct >= 1 ? colors.neon : colors.primary;

        return (
          <TouchableOpacity
            key={goal.id}
            onPress={() => router.push('/(app)/savings')}
            activeOpacity={0.85}
          >
            <Card style={styles.goalCard}>
              <View style={styles.topRow}>
                <Text style={styles.emoji}>{goal.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="labelMd" numberOfLines={1}>{goal.title}</Text>
                  <Text variant="caption" color={colors.text.secondary}>
                    {formatCurrency(goal.current_amount)} de {formatCurrency(goal.target_amount)}
                  </Text>
                </View>
                <Text variant="labelMd" color={accent}>{pctInt}%</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pctInt}%`, backgroundColor: accent }]} />
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:   { gap: spacing[2] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  goalCard: { gap: spacing[2] },
  topRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  emoji:    { fontSize: 22 },
  track:    { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  fill:     { height: '100%', borderRadius: 3 },

  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
  },
});
