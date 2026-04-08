import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '@/theme';
import { Text } from './Text';
import type { ExpenseClassification } from '@/types';

type BadgeVariant = 'neon' | 'red' | 'yellow' | 'gray' | 'classification';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  classification?: ExpenseClassification;
  small?: boolean;
}

const classificationConfig: Record<ExpenseClassification, { label: string; color: string; bg: string }> = {
  necessary: { label: 'Necesario', color: colors.text.primary, bg: colors.expense.necessary + '22' },
  disposable: { label: 'Prescindible', color: colors.red, bg: colors.red + '22' },
  investable: { label: 'Invertible', color: colors.neon, bg: colors.neon + '22' },
};

export function Badge({ label, variant = 'gray', classification, small = false }: BadgeProps) {
  const classConfig = classification ? classificationConfig[classification] : null;

  const bg = classConfig?.bg ?? (variant === 'neon' ? colors.neon + '22' : variant === 'red' ? colors.red + '22' : variant === 'yellow' ? colors.yellow + '22' : colors.mediumGray);
  const color = classConfig?.color ?? (variant === 'neon' ? colors.neon : variant === 'red' ? colors.red : variant === 'yellow' ? colors.yellow : colors.text.secondary);
  const text = classConfig?.label ?? label;

  return (
    <View style={[styles.base, { backgroundColor: bg }, small && styles.small]}>
      <Text variant="label" style={[styles.text, { color }, small && styles.textSmall]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  small: {
    paddingHorizontal: spacing[1],
    paddingVertical: 1,
  },
  text: {
    fontSize: 9,
    lineHeight: 14,
  },
  textSmall: {
    fontSize: 8,
  },
});
