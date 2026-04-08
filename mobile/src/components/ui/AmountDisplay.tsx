import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '@/theme';
import { Text } from './Text';
import { formatCurrency } from '@/utils/format';

interface AmountDisplayProps {
  amount: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  showSign?: boolean;
  label?: string;
}

const sizeMap = {
  sm: 'labelMd',
  md: 'number',
  lg: 'numberLg',
  xl: 'numberLg',
} as const;

export function AmountDisplay({
  amount,
  size = 'md',
  color = colors.text.primary,
  showSign = false,
  label,
}: AmountDisplayProps) {
  const prefix = showSign ? (amount >= 0 ? '+' : '') : '';
  const displayColor = showSign
    ? amount >= 0 ? colors.primary : colors.red
    : color;

  return (
    <View>
      {label && (
        <Text variant="label" color={colors.text.secondary} style={styles.label}>
          {label}
        </Text>
      )}
      <Text variant={sizeMap[size]} color={displayColor}>
        {prefix}{formatCurrency(amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing[1],
  },
});
