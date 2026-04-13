import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Button, Card } from '@/components/ui';
import { useOnboardingStore } from '@/store/onboardingStore';
import { useAuthStore } from '@/store/authStore';
import type { RiskProfile } from '@/types';

interface RiskQuestion {
  id: string;
  question: string;
  options: { label: string; value: string; points: number }[];
}

const riskQuestions: RiskQuestion[] = [
  {
    id: 'q1',
    question: '¿Qué harías si tu inversión cae un 20% en un mes?',
    options: [
      { label: 'La retiro todo para no perder más', value: 'a', points: 0 },
      { label: 'Me preocupa pero espero que se recupere', value: 'b', points: 50 },
      { label: 'Invierto más, es una oportunidad', value: 'c', points: 100 },
    ],
  },
  {
    id: 'q2',
    question: '¿En cuánto tiempo necesitás ese dinero?',
    options: [
      { label: 'Lo puedo necesitar en cualquier momento', value: 'a', points: 0 },
      { label: 'En 1 a 3 años', value: 'b', points: 50 },
      { label: 'En más de 3 años', value: 'c', points: 100 },
    ],
  },
  {
    id: 'q3',
    question: '¿Cuál de estas opciones preferís?',
    options: [
      { label: 'Ganar poco pero seguro', value: 'a', points: 0 },
      { label: 'Ganar algo más con riesgo moderado', value: 'b', points: 50 },
      { label: 'Arriesgar más para ganar mucho más', value: 'c', points: 100 },
    ],
  },
];

function calculateRiskProfile(answers: Record<string, string>): { profile: RiskProfile; score: number } {
  const totalPoints = Object.entries(answers).reduce((sum, [qId, ansValue]) => {
    const question = riskQuestions.find(q => q.id === qId);
    const option = question?.options.find(o => o.value === ansValue);
    return sum + (option?.points ?? 0);
  }, 0);

  const maxPoints = riskQuestions.length * 100;
  const score = Math.round((totalPoints / maxPoints) * 100);

  let profile: RiskProfile;
  if (score < 35) profile = 'conservative';
  else if (score < 70) profile = 'moderate';
  else profile = 'aggressive';

  return { profile, score };
}

const profileDescriptions: Record<RiskProfile, { label: string; description: string; color: string; icon: string }> = {
  conservative: {
    label: 'Conservador',
    description: 'Preferís cuidar tu plata antes que arriesgarla. Opciones como FCI money market o bonos CER van bien para vos.',
    color: colors.info ?? '#82b1ff',
    icon: 'shield-checkmark-outline',
  },
  moderate: {
    label: 'Moderado',
    description: 'Podés tolerar algo de volatilidad por mejores rendimientos. Una mezcla de pesos y dólares funciona bien.',
    color: colors.yellow,
    icon: 'trending-up-outline',
  },
  aggressive: {
    label: 'Agresivo',
    description: 'Buscás maximizar tu plata a largo plazo y podés tolerar vaivenes. CEDEARs y acciones son tu terreno.',
    color: colors.neon,
    icon: 'flash-outline',
  },
};

export default function RiskProfileScreen() {
  const { user } = useAuthStore();
  const { setRiskProfile, saveRiskProfile, completeOnboarding, updateProfile, isLoading } = useOnboardingStore();
  const { updateProfile: updateAuthProfile } = useAuthStore();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ profile: RiskProfile; score: number } | null>(null);

  const allAnswered = riskQuestions.every(q => answers[q.id]);

  const handleAnswer = (questionId: string, value: string) => {
    const newAnswers = { ...answers, [questionId]: value };
    setAnswers(newAnswers);

    if (riskQuestions.every(q => newAnswers[q.id])) {
      const r = calculateRiskProfile(newAnswers);
      setResult(r);
    }
  };

  const handleFinish = async () => {
    if (!user?.id || !result) return;
    try {
      setRiskProfile(result.profile, result.score, answers);
      await saveRiskProfile(user.id);
      await completeOnboarding(user.id);
      await updateAuthProfile({ onboarding_completed: true });
      router.replace('/(onboarding)/gmail-connect');
    } catch {
      // error en store
    }
  };

  const desc = result ? profileDescriptions[result.profile] : null;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: '100%' }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="label" color={colors.text.secondary}>PASO 3 DE 3</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleSection}>
          <Text variant="h3">Tu perfil de riesgo</Text>
          <Text variant="body" color={colors.text.secondary}>
            3 preguntas rápidas para entender cómo te sentís con el riesgo.
          </Text>
        </View>

        {/* Preguntas */}
        {riskQuestions.map((question, qIdx) => (
          <View key={question.id} style={styles.questionBlock}>
            <Text variant="bodySmall" color={colors.text.secondary} style={styles.questionNumber}>
              {qIdx + 1} / {riskQuestions.length}
            </Text>
            <Text variant="subtitle" style={styles.questionText}>
              {question.question}
            </Text>
            <View style={styles.questionOptions}>
              {question.options.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleAnswer(question.id, opt.value)}
                >
                  <Card
                    variant={answers[question.id] === opt.value ? 'neon' : 'default'}
                    style={styles.optionCard}
                  >
                    <View style={styles.optionRow}>
                      <Text
                        variant="bodySmall"
                        color={answers[question.id] === opt.value ? colors.neon : colors.text.primary}
                        style={{ flex: 1 }}
                      >
                        {opt.label}
                      </Text>
                      {answers[question.id] === opt.value && (
                        <Ionicons name="checkmark-circle" size={18} color={colors.neon} />
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Resultado */}
        {result && desc && (
          <View style={[styles.resultCard, { borderColor: desc.color }]}>
            <View style={styles.resultHeader}>
              <Ionicons name={desc.icon as any} size={32} color={desc.color} />
              <View>
                <Text variant="label" color={colors.text.secondary}>TU PERFIL</Text>
                <Text variant="h4" color={desc.color}>{desc.label}</Text>
              </View>
            </View>
            <Text variant="body" color={colors.text.secondary}>
              {desc.description}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        {result ? (
          <Button
            label="¡EMPEZAR!"
            variant="neon"
            size="lg"
            fullWidth
            isLoading={isLoading}
            onPress={handleFinish}
          />
        ) : (
          <Button
            label="Respondé las preguntas para continuar"
            variant="ghost"
            size="lg"
            fullWidth
            disabled
          />
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
  titleSection: { marginBottom: spacing[8], gap: spacing[2] },
  questionBlock: { marginBottom: spacing[8] },
  questionNumber: { marginBottom: spacing[1] },
  questionText: { marginBottom: spacing[4] },
  questionOptions: { gap: spacing[3] },
  optionCard: { paddingVertical: spacing[3], paddingHorizontal: spacing[4] },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  resultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing[5],
    marginTop: spacing[4],
    gap: spacing[4],
    backgroundColor: colors.bg.card,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  actions: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
