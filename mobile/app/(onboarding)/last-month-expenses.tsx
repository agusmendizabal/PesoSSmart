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
import { Text, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import type { ExpenseClassification } from '@/types';

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function getLastMonthInfo() {
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  return {
    label: MONTH_NAMES[lastMonthDate.getMonth()],
    isoDate: lastMonthDate.toISOString().split('T')[0],
  };
}

const classificationOptions: { key: ExpenseClassification; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'necessary',  label: 'Necesario',    icon: 'shield-checkmark-outline', color: colors.expense.necessary },
  { key: 'disposable', label: 'Prescindible', icon: 'cart-outline',             color: colors.expense.disposable },
  { key: 'investable', label: 'Invertible',   icon: 'trending-up-outline',      color: colors.expense.investable },
];

interface LocalEntry {
  id: string;
  amount: number;
  description: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
}

export default function LastMonthExpensesScreen() {
  const { user } = useAuthStore();
  const { categories, fetchCategories, addExpense, updateExpense } = useExpensesStore();
  const { label: lastMonthLabel, isoDate: lastMonthDate } = getLastMonthInfo();

  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [noExpenses, setNoExpenses] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [classification, setClassification] = useState<ExpenseClassification | null>(null);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
  }, []);

  const canAdd = !!amount && parseFloat(amount.replace(',', '.')) > 0 && description.trim().length > 0 && !!categoryId && !!classification;
  const canContinue = entries.length > 0 || noExpenses;

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setCategoryId(null);
    setClassification(null);
  };

  const handleAdd = async () => {
    if (!canAdd || !user?.id) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;

    setIsSaving(true);
    try {
      const newExpense = await addExpense(user.id, {
        description: description.trim(),
        amount: parseFloat(amount.replace(',', '.')),
        date: lastMonthDate,
        category_id: cat.id,
        payment_method: 'other',
      });
      await updateExpense(newExpense.id, { classification });

      setEntries((prev) => [
        ...prev,
        {
          id: newExpense.id,
          amount: parseFloat(amount.replace(',', '.')),
          description: description.trim(),
          categoryName: cat.name_es,
          categoryIcon: cat.icon,
          categoryColor: cat.color,
        },
      ]);
      setNoExpenses(false);
      resetForm();
    } catch {
      // el store ya guarda el error
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinue = () => {
    if (!canContinue) return;
    router.push('/(onboarding)/interests');
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: '50%' }]} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="label" color={colors.text.secondary}>PASO 2 DE 4</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleSection}>
          <Text variant="h3">Cargá tus gastos de {lastMonthLabel}</Text>
          <Text variant="body" color={colors.text.secondary}>
            Con al menos un mes cargado ya podés ver tu ritmo de gasto, comparativas y alertas desde el primer día — sin esperar a que pase el tiempo.
          </Text>
        </View>

        {/* Entradas ya cargadas */}
        {entries.length > 0 && (
          <View style={styles.entriesList}>
            {entries.map((e) => (
              <View key={e.id} style={styles.entryCard}>
                <View style={[styles.entryIcon, { backgroundColor: e.categoryColor + '22' }]}>
                  <Ionicons name={e.categoryIcon as any} size={18} color={e.categoryColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodySmall" numberOfLines={1}>{e.description}</Text>
                  <Text variant="caption" color={colors.text.tertiary}>{e.categoryName}</Text>
                </View>
                <Text variant="bodySmall" color={colors.text.primary}>
                  ${e.amount.toLocaleString('es-AR')}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Formulario rápido */}
        <View style={styles.formCard}>
          <Text variant="label" color={colors.text.secondary}>NUEVO GASTO DE {lastMonthLabel.toUpperCase()}</Text>

          <Input
            label="MONTO"
            placeholder="0"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />

          <Input
            label="¿EN QUÉ FUE?"
            placeholder="Ej: Alquiler, supermercado"
            value={description}
            onChangeText={setDescription}
            hint="Si fue una transferencia, contá a quién se la mandaste o para qué fue — así después sabés de dónde salió ese gasto."
            autoCapitalize="sentences"
          />

          <View>
            <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>CATEGORÍA</Text>
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const isActive = categoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryChip, isActive && { borderColor: cat.color, backgroundColor: cat.color + '1A' }]}
                    onPress={() => setCategoryId(isActive ? null : cat.id)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={cat.icon as any} size={18} color={isActive ? cat.color : colors.text.tertiary} />
                    <Text
                      variant="caption"
                      color={isActive ? colors.text.primary : colors.text.tertiary}
                      style={{ fontSize: 9, textAlign: 'center', lineHeight: 12 }}
                      numberOfLines={2}
                    >
                      {cat.name_es}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View>
            <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>TIPO DE GASTO</Text>
            <View style={styles.classRow}>
              {classificationOptions.map((opt) => {
                const active = classification === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.classChip, active && { borderColor: opt.color, backgroundColor: opt.color + '1A' }]}
                    onPress={() => setClassification(opt.key)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={opt.icon} size={18} color={active ? opt.color : colors.text.tertiary} />
                    <Text variant="caption" color={active ? opt.color : colors.text.tertiary}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Button
            label="+ AGREGAR A LA LISTA"
            variant="secondary"
            size="md"
            fullWidth
            disabled={!canAdd}
            isLoading={isSaving}
            onPress={handleAdd}
          />
        </View>

        {/* Escape hatch */}
        <TouchableOpacity
          style={[styles.noExpensesRow, noExpenses && styles.noExpensesRowActive]}
          onPress={() => setNoExpenses((v) => !v)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={noExpenses ? 'checkbox' : 'square-outline'}
            size={20}
            color={noExpenses ? colors.primary : colors.text.tertiary}
          />
          <Text variant="bodySmall" color={noExpenses ? colors.text.primary : colors.text.secondary} style={{ flex: 1 }}>
            No tuve ningún gasto en {lastMonthLabel}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label={canContinue ? 'CONTINUAR' : `Cargá al menos un gasto de ${lastMonthLabel}`}
          variant={canContinue ? 'neon' : 'ghost'}
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={handleContinue}
        />
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
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[6],
    gap: spacing[5],
  },
  titleSection: { gap: spacing[2] },

  entriesList: { gap: spacing[2] },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.bg.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[3],
  },
  entryIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  formCard: {
    backgroundColor: colors.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing[4],
    gap: spacing[4],
  },
  inputLabel: { marginBottom: spacing[2] },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  categoryChip: {
    width: 72,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  classRow: { flexDirection: 'row', gap: spacing[2] },
  classChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing[3],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border.default,
  },

  noExpensesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  noExpensesRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '0F',
  },

  actions: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});
