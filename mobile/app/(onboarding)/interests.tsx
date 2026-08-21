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
    key: 'sector_autos',
    label: 'Autos',
    description: 'Fierros, marcas, lo último en el mercado automotor.',
    icon: 'car-sport-outline',
    color: '#EF4444',
  },
  {
    key: 'sector_energia',
    label: 'Energía',
    description: 'Petróleo, gas, combustibles.',
    icon: 'flash-outline',
    color: colors.yellow,
  },
  {
    key: 'sector_realestate',
    label: 'Departamentos',
    description: 'Real estate, propiedades, alquileres.',
    icon: 'business-outline',
    color: '#A8D5C2',
  },
  {
    key: 'sector_tech',
    label: 'Tecnología',
    description: 'Celulares, gadgets, todo lo nuevo.',
    icon: 'phone-portrait-outline',
    color: '#27AE60',
  },
  {
    key: 'sector_moda',
    label: 'Moda',
    description: 'Ropa, calzado, marcas que seguís.',
    icon: 'shirt-outline',
    color: '#ff9800',
  },
  {
    key: 'sector_gastronomia',
    label: 'Gastronomía',
    description: 'Comida, delivery, salidas a comer.',
    icon: 'restaurant-outline',
    color: '#f0b429',
  },
  {
    key: 'sector_entretenimiento',
    label: 'Entretenimiento',
    description: 'Streaming, series, cine.',
    icon: 'film-outline',
    color: colors.neon,
  },
  {
    key: 'sector_viajes',
    label: 'Viajes',
    description: 'Turismo, hospedaje, escapadas.',
    icon: 'airplane-outline',
    color: '#4dd0e1',
  },
  {
    key: 'no_idea',
    label: 'No sé, sorprendeme',
    description: 'Está perfecto. Te mostramos algo simple para empezar.',
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
          <Text variant="h3">¿Qué rubros te gustan?</Text>
          <Text variant="body" color={colors.text.secondary}>
            Elegí los que te llamen la atención como consumidor — no hace falta saber nada de inversiones. Los usamos para mostrarte ejemplos concretos y relevantes para vos, no jerga financiera.
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
