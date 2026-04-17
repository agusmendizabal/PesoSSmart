/**
 * StreakCard — muestra las rachas activas del usuario.
 * Se muestra en home.tsx si hay alguna racha activa (> 0).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui/Text';

interface Props {
  weekStreak:         number;
  noDisposableStreak: number;
  bestWeekStreak:     number;
  monthsUnderBudget:  number;
}

export function StreakCard({ weekStreak, noDisposableStreak, bestWeekStreak, monthsUnderBudget }: Props) {
  const hasAny = weekStreak > 0 || noDisposableStreak > 0 || monthsUnderBudget > 0;
  if (!hasAny) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text variant="label" color={colors.text.tertiary}>TUS RACHAS</Text>
        {bestWeekStreak > 0 && (
          <View style={styles.record}>
            <Ionicons name="trophy-outline" size={11} color={colors.yellow} />
            <Text style={styles.recordText}>Récord: {bestWeekStreak} sem.</Text>
          </View>
        )}
      </View>

      <View style={styles.items}>
        {weekStreak > 0 && (
          <StreakItem
            icon="calendar-outline"
            color={colors.primary}
            value={weekStreak}
            unit="sem."
            label="dentro del presupuesto"
          />
        )}
        {noDisposableStreak > 0 && (
          <StreakItem
            icon="flame-outline"
            color={colors.yellow}
            value={noDisposableStreak}
            unit="días"
            label="sin prescindibles"
          />
        )}
        {monthsUnderBudget >= 2 && (
          <StreakItem
            icon="star-outline"
            color={colors.neon}
            value={monthsUnderBudget}
            unit="meses"
            label="bajo el presupuesto"
          />
        )}
      </View>

      {monthsUnderBudget >= 4 && (
        <View style={styles.achievementBanner}>
          <Ionicons name="ribbon-outline" size={14} color={colors.neon} />
          <Text variant="caption" color={colors.neon} style={{ flex: 1 }}>
            {monthsUnderBudget} meses seguidos bajo el presupuesto. ¡Excelente racha!
          </Text>
        </View>
      )}
    </View>
  );
}

function StreakItem({
  icon, color, value, unit, label,
}: {
  icon: string; color: string; value: number; unit: string; label: string;
}) {
  return (
    <View style={[itemStyles.container, { borderColor: color + '30', backgroundColor: color + '08' }]}>
      <View style={[itemStyles.iconWrap, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as any} size={16} color={color} />
      </View>
      <View style={itemStyles.textCol}>
        <View style={itemStyles.valueRow}>
          <Text style={[itemStyles.value, { color }]}>{value}</Text>
          <Text style={itemStyles.unit}>{unit}</Text>
        </View>
        <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[4],
    gap:             spacing[3],
  },
  header: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
  },
  record: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
  },
  recordText: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   11,
    color:      colors.yellow,
  },
  items: {
    flexDirection: 'row',
    gap:           spacing[2],
  },
  achievementBanner: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    backgroundColor: colors.neon + '0F',
    borderRadius:  8,
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
  },
});

const itemStyles = StyleSheet.create({
  container: {
    flex:          1,
    borderWidth:   1,
    borderRadius:  12,
    padding:       spacing[3],
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  } as any,
  iconWrap:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  textCol:   { flex: 1, gap: 1 },
  valueRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value:     { fontFamily: 'Montserrat_700Bold', fontSize: 20, lineHeight: 24 },
  unit:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: colors.text.secondary },
});
