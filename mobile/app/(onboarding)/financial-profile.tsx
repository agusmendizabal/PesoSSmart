import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Button, Card } from '@/components/ui';
import { useOnboardingStore } from '@/store/onboardingStore';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import type { IncomeRange, WorkType, FamilyStatus, SelectOption } from '@/types';

// ---- Opciones ----

const incomeOptions: SelectOption<IncomeRange>[] = [
  { label: 'Menos de $500.000', value: 'under_150k', description: 'Ingresos bajos' },
  { label: '$500.000 – $1.000.000', value: '150k_300k', description: 'Ingresos medios bajos' },
  { label: '$1.000.000 – $2.000.000', value: '300k_500k', description: 'Ingresos medios' },
  { label: '$2.000.000 – $3.500.000', value: '500k_800k', description: 'Ingresos medios altos' },
  { label: '$3.500.000 – $6.000.000', value: '800k_1500k', description: 'Ingresos altos' },
  { label: 'Más de $6.000.000', value: 'over_1500k', description: 'Ingresos muy altos' },
];

const workOptions: SelectOption<WorkType>[] = [
  { label: 'Empleado en relación de dependencia', value: 'employee', icon: 'briefcase-outline' },
  { label: 'Freelancer / Independiente', value: 'freelance', icon: 'laptop-outline' },
  { label: 'Dueño de negocio / Monotributista', value: 'self_employed', icon: 'storefront-outline' },
  { label: 'Estudiante', value: 'student', icon: 'school-outline' },
  { label: 'Desocupado', value: 'unemployed', icon: 'time-outline' },
  { label: 'Jubilado', value: 'retired', icon: 'person-outline' },
];

const familyOptions: SelectOption<FamilyStatus>[] = [
  { label: 'Solo/a', value: 'single', icon: 'person-outline' },
  { label: 'En pareja', value: 'couple', icon: 'people-outline' },
  { label: 'Con familia, sin hijos', value: 'family_no_kids', icon: 'home-outline' },
  { label: 'Con hijos a cargo', value: 'family_with_kids', icon: 'people-circle-outline' },
];

type Step = 'income' | 'work' | 'family' | 'savings';

export default function FinancialProfileScreen() {
  const { user } = useAuthStore();
  const {
    income_range,
    work_type,
    family_status,
    has_savings,
    has_debt,
    setFinancialProfile,
    saveFinancialProfile,
    isLoading,
  } = useOnboardingStore();

  const [currentStep, setCurrentStep] = useState<Step>('income');

  // Pre-cargar valores existentes del perfil financiero
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('financial_profiles')
      .select('income_range, work_type, family_status, has_savings, has_debt')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setFinancialProfile({
            income_range: data.income_range ?? null,
            work_type: data.work_type ?? null,
            family_status: data.family_status ?? null,
            has_savings: data.has_savings ?? false,
            has_debt: data.has_debt ?? false,
          });
        }
      });
  }, [user?.id]);

  const steps: Step[] = ['income', 'work', 'family', 'savings'];
  const stepIndex = steps.indexOf(currentStep);
  const progress = ((stepIndex + 1) / steps.length);

  const goNext = () => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    } else {
      handleSave();
    }
  };

  const goBack = () => {
    if (stepIndex > 0) {
      setCurrentStep(steps[stepIndex - 1]);
    } else {
      router.back();
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      await saveFinancialProfile(user.id);
      router.back();
    } catch {
      // error en store
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="label" color={colors.text.secondary}>
          PASO 1 DE 3
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Income step */}
        {currentStep === 'income' && (
          <View style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text variant="h3">¿Cuánto ganás por mes?</Text>
              <Text variant="body" color={colors.text.secondary}>
                Ingreso neto mensual aproximado. No lo compartimos con nadie.
              </Text>
            </View>
            <View style={styles.options}>
              {incomeOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setFinancialProfile({ income_range: opt.value })}
                >
                  <Card
                    variant={income_range === opt.value ? 'neon' : 'default'}
                    style={styles.optionCard}
                  >
                    <View style={styles.optionRow}>
                      <View style={styles.optionText}>
                        <Text
                          variant="bodySmall"
                          color={income_range === opt.value ? colors.neon : colors.text.primary}
                          style={{ fontFamily: 'DMSans_600SemiBold' }}
                        >
                          {opt.label}
                        </Text>
                        {opt.description && (
                          <Text variant="caption" color={colors.text.secondary}>
                            {opt.description}
                          </Text>
                        )}
                      </View>
                      {income_range === opt.value && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Work step */}
        {currentStep === 'work' && (
          <View style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text variant="h3">¿En qué trabajás?</Text>
              <Text variant="body" color={colors.text.secondary}>
                Esto nos ayuda a entender la estabilidad de tus ingresos.
              </Text>
            </View>
            <View style={styles.options}>
              {workOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setFinancialProfile({ work_type: opt.value })}
                >
                  <Card
                    variant={work_type === opt.value ? 'neon' : 'default'}
                    style={styles.optionCard}
                  >
                    <View style={styles.optionRow}>
                      {opt.icon && (
                        <Ionicons
                          name={opt.icon as any}
                          size={20}
                          color={work_type === opt.value ? colors.neon : colors.text.secondary}
                          style={styles.optionIcon}
                        />
                      )}
                      <Text
                        variant="bodySmall"
                        color={work_type === opt.value ? colors.neon : colors.text.primary}
                        style={{ flex: 1, fontFamily: 'DMSans_500Medium' }}
                      >
                        {opt.label}
                      </Text>
                      {work_type === opt.value && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Family step */}
        {currentStep === 'family' && (
          <View style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text variant="h3">¿Cuál es tu situación familiar?</Text>
              <Text variant="body" color={colors.text.secondary}>
                Para entender mejor tus gastos fijos y responsabilidades.
              </Text>
            </View>
            <View style={styles.options}>
              {familyOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setFinancialProfile({ family_status: opt.value })}
                >
                  <Card
                    variant={family_status === opt.value ? 'neon' : 'default'}
                    style={styles.optionCard}
                  >
                    <View style={styles.optionRow}>
                      {opt.icon && (
                        <Ionicons
                          name={opt.icon as any}
                          size={20}
                          color={family_status === opt.value ? colors.neon : colors.text.secondary}
                          style={styles.optionIcon}
                        />
                      )}
                      <Text
                        variant="bodySmall"
                        color={family_status === opt.value ? colors.neon : colors.text.primary}
                        style={{ flex: 1, fontFamily: 'DMSans_500Medium' }}
                      >
                        {opt.label}
                      </Text>
                      {family_status === opt.value && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.neon} />
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Savings/debt step */}
        {currentStep === 'savings' && (
          <View style={styles.stepContent}>
            <View style={styles.stepHeader}>
              <Text variant="h3">Un poco más sobre tu situación</Text>
              <Text variant="body" color={colors.text.secondary}>
                Esto es confidencial y solo lo usamos para darte mejores sugerencias.
              </Text>
            </View>

            <View style={styles.options}>
              <Text variant="label" color={colors.text.secondary} style={styles.groupLabel}>
                ¿TENÉS AHORROS?
              </Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggle, has_savings && styles.toggleActive]}
                  onPress={() => setFinancialProfile({ has_savings: true })}
                >
                  <Text variant="bodySmall" color={has_savings ? colors.neon : colors.text.secondary}>
                    Sí, tengo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, !has_savings && styles.toggleActive]}
                  onPress={() => setFinancialProfile({ has_savings: false, savings_amount: null })}
                >
                  <Text variant="bodySmall" color={!has_savings ? colors.text.primary : colors.text.secondary}>
                    No tengo
                  </Text>
                </TouchableOpacity>
              </View>

              <Text variant="label" color={colors.text.secondary} style={[styles.groupLabel, { marginTop: spacing[6] }]}>
                ¿TENÉS DEUDAS O CUOTAS?
              </Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggle, has_debt && styles.toggleActive]}
                  onPress={() => setFinancialProfile({ has_debt: true })}
                >
                  <Text variant="bodySmall" color={has_debt ? colors.red : colors.text.secondary}>
                    Sí, tengo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, !has_debt && styles.toggleActive]}
                  onPress={() => setFinancialProfile({ has_debt: false, debt_amount: null })}
                >
                  <Text variant="bodySmall" color={!has_debt ? colors.text.primary : colors.text.secondary}>
                    No tengo
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.actions}>
        <Button
          label={currentStep === 'savings' ? 'GUARDAR Y CONTINUAR' : 'CONTINUAR'}
          variant="neon"
          size="lg"
          fullWidth
          isLoading={isLoading}
          disabled={
            (currentStep === 'income' && !income_range) ||
            (currentStep === 'work' && !work_type) ||
            (currentStep === 'family' && !family_status)
          }
          onPress={goNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  progressContainer: {
    height: 3,
    backgroundColor: colors.border.subtle,
  },
  progressBar: {
    height: 3,
    backgroundColor: colors.neon,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
  },
  backBtn: {
    padding: spacing[1],
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[4],
  },
  stepContent: {
    flex: 1,
  },
  stepHeader: {
    marginBottom: spacing[6],
    gap: spacing[2],
  },
  options: {
    gap: spacing[3],
  },
  optionCard: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionIcon: {
    marginRight: spacing[3],
  },
  optionText: {
    flex: 1,
    gap: spacing[1],
  },
  groupLabel: {
    marginBottom: spacing[2],
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  toggle: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.card,
  },
  toggleActive: {
    borderColor: colors.neon,
    backgroundColor: colors.neon + '11',
  },
  actions: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
