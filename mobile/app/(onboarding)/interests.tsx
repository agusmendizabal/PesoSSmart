import React from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Button } from '@/components/ui';
import { useOnboardingStore } from '@/store/onboardingStore';
import { useAuthStore } from '@/store/authStore';

interface InterestOption {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

const interestOptions: InterestOption[] = [
  {
    key: 'fci_money_market',
    label: 'Fondos Comunes (Plazo Fijo digital)',
    description: 'Rendís tu plata desde el día 1, sin bloquearla.',
    icon: 'trending-up-outline',
    color: colors.neon,
  },
  {
    key: 'fci_cer',
    label: 'FCI ajustado por inflación',
    description: 'Tu plata crece al ritmo de la inflación o más.',
    icon: 'shield-checkmark-outline',
    color: colors.yellow,
  },
  {
    key: 'dolar_mep',
    label: 'Dólar MEP',
    description: 'Comprar dólares legales desde tu cuenta bancaria.',
    icon: 'cash-outline',
    color: '#82b1ff',
  },
  {
    key: 'lecap',
    label: 'Letras del Tesoro (Lecap)',
    description: 'Bonos de corto plazo con tasa fija en pesos.',
    icon: 'document-text-outline',
    color: colors.white,
  },
  {
    key: 'cedears',
    label: 'CEDEARs (acciones extranjeras)',
    description: 'Invertí en Apple, Google o MercadoLibre desde Argentina.',
    icon: 'globe-outline',
    color: '#ff9800',
  },
  {
    key: 'crypto',
    label: 'Criptomonedas / Stablecoins',
    description: 'USDT, Bitcoin y otras criptos.',
    icon: 'logo-bitcoin',
    color: '#f0b429',
  },
  {
    key: 'real_estate',
    label: 'Propiedades',
    description: 'Ahorro en ladrillos, alquileres o REITs.',
    icon: 'home-outline',
    color: '#a5d6a7',
  },
  {
    key: 'no_idea',
    label: 'No sé por dónde empezar',
    description: 'Está perfecto. Te orientamos desde cero.',
    icon: 'help-circle-outline',
    color: colors.text.secondary,
  },
];

export default function InterestsScreen() {
  const { user } = useAuthStore();
  const { selected_interests, setInterests, saveInterests, isLoading } = useOnboardingStore();

  const toggleInterest = (key: string) => {
    if (selected_interests.includes(key)) {
      setInterests(selected_interests.filter((k) => k !== key));
    } else {
      setInterests([...selected_interests, key]);
    }
  };

  const handleContinue = async () => {
    if (!user?.id) return;
    try {
      await saveInterests(user.id);
      router.push('/(onboarding)/risk-profile');
    } catch {
      // error en store
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: '66%' }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="label" color={colors.text.secondary}>PASO 2 DE 3</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleSection}>
          <Text variant="h3">¿Qué te interesa explorar?</Text>
          <Text variant="body" color={colors.text.secondary}>
            Elegí todo lo que te llame la atención. Sin compromiso, esto solo nos ayuda a mostrarte lo que es relevante para vos.
          </Text>
        </View>

        {selected_interests.length > 0 && (
          <Text variant="label" color={colors.neon} style={styles.selectionCount}>
            {selected_interests.length} SELECCIONADO{selected_interests.length !== 1 ? 'S' : ''}
          </Text>
        )}

        <View style={styles.grid}>
          {interestOptions.map((option) => {
            const isSelected = selected_interests.includes(option.key);
            return (
              <TouchableOpacity
                key={option.key}
                onPress={() => toggleInterest(option.key)}
                style={[
                  styles.interestCard,
                  {
                    borderColor: isSelected ? option.color : colors.border.default,
                    backgroundColor: isSelected ? option.color + '11' : colors.bg.card,
                  },
                ]}
              >
                <View style={styles.cardTop}>
                  <Ionicons
                    name={option.icon as any}
                    size={24}
                    color={isSelected ? option.color : colors.text.secondary}
                  />
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={18} color={option.color} />
                  )}
                </View>
                <Text
                  variant="bodySmall"
                  color={isSelected ? option.color : colors.text.primary}
                  style={styles.cardLabel}
                >
                  {option.label}
                </Text>
                <Text variant="caption" color={colors.text.secondary} style={styles.cardDesc}>
                  {option.description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label="CONTINUAR"
          variant="neon"
          size="lg"
          fullWidth
          isLoading={isLoading}
          onPress={handleContinue}
        />
        {selected_interests.length === 0 && (
          <Text variant="caption" color={colors.text.secondary} align="center">
            Podés saltearte este paso si querés.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  progressContainer: { height: 3, backgroundColor: colors.border.subtle },
  progressBar: { height: 3, backgroundColor: colors.neon },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[4],
  },
  titleSection: {
    marginBottom: spacing[6],
    gap: spacing[2],
  },
  selectionCount: {
    marginBottom: spacing[4],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  interestCard: {
    width: '47%',
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing[4],
    gap: spacing[2],
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  cardLabel: {
    fontFamily: 'Montserrat_600SemiBold',
    lineHeight: 18,
  },
  cardDesc: {
    lineHeight: 14,
  },
  actions: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    gap: spacing[3],
  },
});
