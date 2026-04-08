import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, layout } from '@/theme';
import { Text, Button } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';

const { height } = Dimensions.get('window');

export default function WelcomeScreen() {
  const { profile } = useAuthStore();
  const firstName = profile?.full_name?.split(' ')[0] ?? 'acá';

  return (
    <SafeAreaView style={styles.safe}>
      <LinearGradient
        colors={[colors.bg.primary, colors.bg.secondary, colors.bg.secondary]}
        style={styles.gradient}
      />

      {/* Top accent */}
      <View style={styles.accentBar} />

      <View style={styles.container}>
        {/* Logo */}
        <View style={styles.logoSection}>
          <Text variant="h1" color={colors.neon}>
            PESOS{'\n'}$MART
          </Text>
        </View>

        {/* Main copy */}
        <View style={styles.copySection}>
          <Text variant="h3" color={colors.text.primary} style={styles.mainTitle}>
            Hola, {firstName}.{'\n'}Empecemos a ordenar tu plata.
          </Text>
          <Text variant="body" color={colors.text.secondary} style={styles.subtitle}>
            Te vamos a hacer unas preguntas rápidas para entender tu situación real y darte sugerencias que tengan sentido para vos.
          </Text>
          <Text variant="bodySmall" color={colors.text.tertiary} style={styles.time}>
            Son solo 3 minutos.
          </Text>
        </View>

        {/* Stats decorativas */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text variant="number" color={colors.neon}>82%</Text>
            <Text variant="caption" color={colors.text.secondary}>
              de usuarios reducen{'\n'}gastos en el primer mes
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text variant="number" color={colors.yellow}>$0</Text>
            <Text variant="caption" color={colors.text.secondary}>
              para empezar{'\n'}a invertir
            </Text>
          </View>
        </View>

        {/* CTA */}
        <View style={styles.actions}>
          <Button
            label="EMPEZAR"
            variant="neon"
            size="lg"
            fullWidth
            onPress={() => router.push('/(onboarding)/financial-profile')}
          />
          <Button
            label="Lo hago después"
            variant="ghost"
            size="md"
            fullWidth
            onPress={() => router.replace('/(app)/home')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  accentBar: {
    height: 3,
    backgroundColor: colors.neon,
  },
  container: {
    flex: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[10],
    paddingBottom: spacing[6],
    justifyContent: 'space-between',
  },
  logoSection: {
    marginBottom: spacing[8],
  },
  copySection: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing[4],
  },
  mainTitle: {
    lineHeight: 36,
  },
  subtitle: {
    lineHeight: 22,
  },
  time: {
    marginTop: spacing[1],
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[6],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border.subtle,
    marginVertical: spacing[6],
    gap: spacing[6],
  },
  statItem: {
    flex: 1,
    gap: spacing[1],
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.border.default,
  },
  actions: {
    gap: spacing[3],
  },
});
