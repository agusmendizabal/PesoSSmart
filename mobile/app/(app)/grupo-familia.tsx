import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui';

export default function GrupoFamiliaScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text variant="h4">Grupo en familia</Text>
      </View>
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={64} color={colors.border.default} />
        <Text variant="subtitle" color={colors.text.primary} align="center">
          Próximamente
        </Text>
        <Text variant="body" color={colors.text.secondary} align="center">
          Vas a poder compartir y gestionar las finanzas con tu familia o pareja.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: spacing[4],
  },
});
