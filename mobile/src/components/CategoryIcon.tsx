import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveCategoryIcon } from '@/lib/categoryIcons';
import { CATEGORY_ICON_STYLE } from '@/lib/categoryIconStyle';

interface Props {
  categoryName?: string;
  description?: string;
  size?: number;
}

export function CategoryIcon({ categoryName = '', description = '', size = 48 }: Props) {
  const key = resolveCategoryIcon(categoryName, description);
  const { icon, color } = CATEGORY_ICON_STYLE[key];

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '20' }]}>
      <Ionicons name={icon} size={size * 0.52} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
});
