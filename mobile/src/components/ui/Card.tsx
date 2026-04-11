import React from 'react';
import { View, ViewProps, StyleSheet, TouchableOpacity, TouchableOpacityProps } from 'react-native';
import { colors, spacing, layout } from '@/theme';

type CardVariant = 'default' | 'elevated' | 'neon' | 'danger';

interface CardProps extends ViewProps {
  variant?: CardVariant;
  padding?: number;
}

interface PressableCardProps extends TouchableOpacityProps {
  variant?: CardVariant;
  padding?: number;
}

const variantBorders: Record<CardVariant, string> = {
  default: colors.border.default,
  elevated: colors.border.default,
  neon: colors.border.primary,
  danger: colors.border.error,
};

const variantBgs: Record<CardVariant, string> = {
  default: colors.bg.card,
  elevated: colors.bg.elevated,
  neon: colors.primary + '0D',
  danger: colors.red + '0D',
};

export function Card({ variant = 'default', padding = layout.cardPadding, style, children, ...props }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variantBgs[variant],
          borderColor: variantBorders[variant],
          padding,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

export function PressableCard({ variant = 'default', padding = layout.cardPadding, style, children, ...props }: PressableCardProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[
        styles.base,
        {
          backgroundColor: variantBgs[variant],
          borderColor: variantBorders[variant],
          padding,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    // Sombra sutil y consistente
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
});
