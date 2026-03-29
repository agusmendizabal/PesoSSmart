import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { colors, spacing } from '@/theme';
import { Text } from './Text';
import { formatCurrency } from '@/utils/format';

interface MonthlyThermometerProps {
  spent: number;
  budget: number;
}

function getThermometerColor(pct: number): string {
  if (pct < 0.6) return colors.neon;
  if (pct < 0.85) return colors.yellow;
  return colors.red;
}

function getStatusLabel(pct: number): string {
  if (pct < 0.6) return 'Vas bien';
  if (pct < 0.85) return 'Cuidado';
  if (pct < 1) return 'Casi al límite';
  return '¡Te pasaste!';
}

export function MonthlyThermometer({ spent, budget }: MonthlyThermometerProps) {
  const hasIncome = budget > 0;
  const pct = hasIncome ? Math.min(spent / budget, 1) : 0;
  const barColor = hasIncome ? getThermometerColor(pct) : colors.text.tertiary;
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const remaining = budget - spent;

  if (!hasIncome) {
    return (
      <View style={styles.container}>
        <View style={styles.topRow}>
          <View style={styles.statusDot}>
            <View style={[styles.dot, { backgroundColor: colors.text.tertiary }]} />
            <Text variant="label" color={colors.text.tertiary}>TERMÓMETRO DEL MES</Text>
          </View>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: '0%', backgroundColor: colors.text.tertiary }]} />
        </View>
        <Text variant="caption" color={colors.text.tertiary}>
          Configurá tu ingreso en Perfil para activar el termómetro.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.statusDot}>
          <View style={[styles.dot, { backgroundColor: barColor }]} />
          <Text variant="label" color={barColor}>{getStatusLabel(pct).toUpperCase()}</Text>
        </View>
        <Text variant="label" color={colors.text.secondary}>
          {Math.round(pct * 100)}% DEL MES
        </Text>
      </View>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: barColor,
              width: widthAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      <View style={styles.bottomRow}>
        <View>
          <Text variant="caption" color={colors.text.secondary}>GASTADO</Text>
          <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(spent)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" color={colors.text.secondary}>
            {remaining >= 0 ? 'TE QUEDA' : 'TE PASASTE'}
          </Text>
          <Text variant="labelMd" color={remaining >= 0 ? barColor : colors.red}>
            {formatCurrency(Math.abs(remaining))}
          </Text>
        </View>
      </View>

      <Text variant="caption" color={colors.text.tertiary}>
        Basado en tu ingreso estimado de {formatCurrency(budget)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[3],
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusDot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  track: {
    height: 8,
    backgroundColor: colors.bg.elevated,
    borderRadius: 0,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 0,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
});
