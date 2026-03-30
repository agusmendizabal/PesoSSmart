import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Input, Button } from '@/components/ui';
import { useGoalsStore, type SavingsGoal } from '@/store/goalsStore';
import { notifyGoalReached, notifyGoalHalfway } from '@/lib/notifications';
import { formatCurrency } from '@/utils/format';

const EMOJIS = ['🎯', '✈️', '🏠', '🚗', '💻', '📱', '🎓', '💍', '🏖️', '💪', '🎸', '🐾'];

const goalSchema = z.object({
  title: z.string().min(1, 'Poné un nombre a la meta.'),
  target_amount: z.string().min(1, 'Ingresá el monto objetivo.').refine(
    (v) => !isNaN(parseFloat(v.replace(',', '.'))) && parseFloat(v.replace(',', '.')) > 0,
    'El monto debe ser mayor a 0.'
  ),
  deadline: z.string().optional(),
});

type GoalFormData = z.infer<typeof goalSchema>;

interface GoalsSectionProps {
  userId: string;
  projectedMonthlyFree: number | null;
}

export function GoalsSection({ userId, projectedMonthlyFree }: GoalsSectionProps) {
  const { goals, addGoal, addToGoal, deleteGoal } = useGoalsStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddFundsModal, setShowAddFundsModal] = useState<SavingsGoal | null>(null);
  const [addFundsAmount, setAddFundsAmount] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🎯');
  const [isSaving, setIsSaving] = useState(false);

  const { control, handleSubmit, reset, formState: { errors } } = useForm<GoalFormData>({
    resolver: zodResolver(goalSchema),
    defaultValues: { title: '', target_amount: '', deadline: '' },
  });

  const onSubmit = async (data: GoalFormData) => {
    setIsSaving(true);
    try {
      await addGoal(userId, {
        title: data.title,
        target_amount: parseFloat(data.target_amount.replace(',', '.')),
        current_amount: 0,
        deadline: data.deadline || null,
        emoji: selectedEmoji,
      });
      reset();
      setSelectedEmoji('🎯');
      setShowAddModal(false);
    } catch {
      Alert.alert('Error', 'No se pudo guardar la meta.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFunds = async () => {
    if (!showAddFundsModal) return;
    const amount = parseFloat(addFundsAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) return;
    try {
      const goal = showAddFundsModal;
      const newAmount = Math.min(goal.current_amount + amount, goal.target_amount);
      const prevPct = goal.current_amount / goal.target_amount;
      const newPct = newAmount / goal.target_amount;
      await addToGoal(goal.id, amount);
      if (newPct >= 1) {
        notifyGoalReached(goal.title).catch(() => {});
      } else if (prevPct < 0.5 && newPct >= 0.5) {
        notifyGoalHalfway(goal.title, goal.target_amount - newAmount).catch(() => {});
      }
      setShowAddFundsModal(null);
      setAddFundsAmount('');
    } catch {
      Alert.alert('Error', 'No se pudo actualizar la meta.');
    }
  };

  const handleDelete = (goal: SavingsGoal) => {
    Alert.alert(
      'Eliminar meta',
      `¿Seguro que querés eliminar "${goal.title}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteGoal(goal.id) },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text variant="label" color={colors.text.secondary}>METAS DE AHORRO</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={18} color={colors.black} />
        </TouchableOpacity>
      </View>

      {goals.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="flag-outline" size={32} color={colors.text.tertiary} />
          <Text variant="bodySmall" color={colors.text.secondary} align="center">
            Todavía no tenés metas de ahorro.
          </Text>
          <TouchableOpacity onPress={() => setShowAddModal(true)}>
            <Text variant="caption" color={colors.neon}>+ Crear primera meta</Text>
          </TouchableOpacity>
        </Card>
      ) : (
        goals.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            projectedMonthlyFree={projectedMonthlyFree}
            onAddFunds={() => setShowAddFundsModal(goal)}
            onDelete={() => handleDelete(goal)}
          />
        ))
      )}

      {/* Modal nueva meta */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">Nueva meta</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <View>
                <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>ÍCONO</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiList}>
                  {EMOJIS.map((e) => (
                    <TouchableOpacity
                      key={e}
                      style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnActive]}
                      onPress={() => setSelectedEmoji(e)}
                    >
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <Controller
                control={control}
                name="title"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="¿PARA QUÉ ESTÁS AHORRANDO?"
                    placeholder="Ej: Viaje a Europa, Auto nuevo..."
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.title?.message}
                    autoCapitalize="sentences"
                  />
                )}
              />
              <Controller
                control={control}
                name="target_amount"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="¿CUÁNTO NECESITÁS?"
                    placeholder="0"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.target_amount?.message}
                    keyboardType="decimal-pad"
                    leftIcon={<Text variant="body" color={colors.text.secondary}>$</Text>}
                  />
                )}
              />
              <Controller
                control={control}
                name="deadline"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="FECHA LÍMITE (opcional)"
                    placeholder="AAAA-MM-DD"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                  />
                )}
              />
              <Button
                label="CREAR META"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isSaving}
                onPress={handleSubmit(onSubmit)}
                style={{ marginTop: spacing[4] }}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal agregar fondos */}
      <Modal visible={!!showAddFundsModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowAddFundsModal(null)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text variant="h4">Agregar a meta</Text>
            <TouchableOpacity onPress={() => setShowAddFundsModal(null)}>
              <Ionicons name="close" size={24} color={colors.text.primary} />
            </TouchableOpacity>
          </View>
          <View style={styles.addFundsContent}>
            {showAddFundsModal && (
              <Text variant="body" color={colors.text.secondary} align="center">
                {showAddFundsModal.emoji} {showAddFundsModal.title}{'\n'}
                <Text variant="caption" color={colors.text.tertiary}>
                  {formatCurrency(showAddFundsModal.current_amount)} de {formatCurrency(showAddFundsModal.target_amount)}
                </Text>
              </Text>
            )}
            <Input
              label="¿CUÁNTO QUERÉS AGREGAR?"
              placeholder="0"
              value={addFundsAmount}
              onChangeText={setAddFundsAmount}
              keyboardType="decimal-pad"
              leftIcon={<Text variant="body" color={colors.text.secondary}>$</Text>}
              autoFocus
            />
            <Button label="AGREGAR" variant="neon" size="lg" fullWidth onPress={handleAddFunds} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function GoalCard({
  goal,
  projectedMonthlyFree,
  onAddFunds,
  onDelete,
}: {
  goal: SavingsGoal;
  projectedMonthlyFree: number | null;
  onAddFunds: () => void;
  onDelete: () => void;
}) {
  const pct = goal.target_amount > 0 ? Math.min(goal.current_amount / goal.target_amount, 1) : 0;
  const remaining = goal.target_amount - goal.current_amount;
  const monthsToGoal = projectedMonthlyFree != null && projectedMonthlyFree > 0
    ? Math.ceil(remaining / projectedMonthlyFree)
    : null;
  const isComplete = pct >= 1;

  return (
    <Card style={styles.goalCard}>
      <View style={styles.goalHeader}>
        <Text style={{ fontSize: 28 }}>{goal.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" color={colors.text.primary}>{goal.title}</Text>
          {goal.deadline && (
            <Text variant="caption" color={colors.text.tertiary}>Meta: {goal.deadline}</Text>
          )}
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.text.tertiary} />
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: isComplete ? colors.neon : colors.yellow }]} />
      </View>

      <View style={styles.goalAmounts}>
        <Text variant="caption" color={colors.text.secondary}>{formatCurrency(goal.current_amount)} ahorrado</Text>
        <Text variant="label" color={isComplete ? colors.neon : colors.text.secondary}>{Math.round(pct * 100)}%</Text>
        <Text variant="caption" color={colors.text.secondary}>{formatCurrency(goal.target_amount)} total</Text>
      </View>

      {!isComplete && (
        <View style={styles.goalFooter}>
          {monthsToGoal != null ? (
            <Text variant="caption" color={colors.text.tertiary}>
              A tu ritmo: {monthsToGoal} {monthsToGoal === 1 ? 'mes' : 'meses'} para lograrlo
            </Text>
          ) : (
            <Text variant="caption" color={colors.text.tertiary}>Te faltan {formatCurrency(remaining)}</Text>
          )}
          <TouchableOpacity style={styles.addFundsBtn} onPress={onAddFunds}>
            <Ionicons name="add" size={14} color={colors.black} />
            <Text variant="caption" color={colors.black}>Agregar</Text>
          </TouchableOpacity>
        </View>
      )}

      {isComplete && (
        <View style={styles.completeBadge}>
          <Ionicons name="checkmark-circle" size={16} color={colors.neon} />
          <Text variant="caption" color={colors.neon}>¡Meta alcanzada!</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[3] },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addBtn: { width: 32, height: 32, backgroundColor: colors.neon, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { padding: spacing[6], alignItems: 'center', gap: spacing[3] },
  goalCard: { padding: spacing[4], gap: spacing[3] },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  deleteBtn: { padding: spacing[1] },
  progressTrack: { height: 6, backgroundColor: colors.bg.elevated, overflow: 'hidden' },
  progressFill: { height: '100%' },
  goalAmounts: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addFundsBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.neon, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  completeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  modal: { flex: 1, backgroundColor: colors.bg.primary },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  modalScroll: { paddingHorizontal: layout.screenPadding, paddingVertical: spacing[6], gap: spacing[5], paddingBottom: spacing[12] },
  inputLabel: { marginBottom: spacing[2] },
  emojiList: { gap: spacing[2] },
  emojiBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.default },
  emojiBtnActive: { borderColor: colors.neon, backgroundColor: colors.neon + '11' },
  addFundsContent: { padding: layout.screenPadding, gap: spacing[5], flex: 1 },
});
