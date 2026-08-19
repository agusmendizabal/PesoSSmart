import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { FormSheetModal, FormSheetButton } from '@/components/ui/FormSheetModal';
import { useAuthStore } from '@/store/authStore';
import { useGoalsStore } from '@/store/goalsStore';
import { fetchBudgetPlan, type BudgetPlan } from '@/lib/budgetPlan';
import { formatCurrency } from '@/utils/format';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:     '#F6F7F9',
  card:   '#FFFFFF',
  blue:   '#1976D2',
  green:  '#2E7D32',
  violet: '#7B61FF',
  red:    '#EF4444',
  amber:  '#F59E0B',
  text:   '#212121',
  sub:    '#757575',
  muted:  '#9E9E9E',
  border: '#E0E0E0',
  light:  '#F2F2F2',
} as const;

const shadow = layout.cardShadow;

// ─── Hero Card ────────────────────────────────────────────────────────────────

function HeroCard({ amount }: { amount: number }) {
  return (
    <View style={hc.card}>
      <View style={hc.iconRow}>
        <View style={hc.iconBox}>
          <Text style={{ fontSize: 28 }}>🎯</Text>
        </View>
      </View>
      <Text style={hc.eyebrow}>Te recomendamos ahorrar</Text>
      <Text style={hc.amount}>{formatCurrency(amount)}</Text>
      <Text style={hc.sub}>Es un objetivo alcanzable según tus hábitos y oportunidades de ahorro.</Text>
    </View>
  );
}

const hc = StyleSheet.create({
  card:    { backgroundColor: C.violet, borderRadius: 24, padding: spacing[6], alignItems: 'flex-start', gap: spacing[2] },
  iconRow: { marginBottom: spacing[2] },
  iconBox: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF20', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Montserrat_500Medium', fontSize: 13, color: '#DDD6FE' },
  amount:  { fontFamily: 'Montserrat_800ExtraBold', fontSize: 38, color: '#FFFFFF', lineHeight: 46 },
  sub:     { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#C4B5FD', lineHeight: 20 },
});

// ─── Breakdown Card ───────────────────────────────────────────────────────────

function BreakdownCard({ baseSavings, opportunities, total }: {
  baseSavings: number; opportunities: number; total: number;
}) {
  return (
    <View style={bk.card}>
      <Text style={bk.title}>¿Por qué este monto?</Text>

      <View style={bk.rows}>
        <View style={bk.row}>
          <View style={bk.rowLeft}>
            <View style={[bk.dot, { backgroundColor: C.blue }]} />
            <Text style={bk.rowLabel}>Promedio de ahorro últimos 3 meses</Text>
          </View>
          <Text style={bk.rowValue}>{formatCurrency(baseSavings)}</Text>
        </View>

        <View style={bk.row}>
          <View style={bk.rowLeft}>
            <View style={[bk.dot, { backgroundColor: C.green }]} />
            <Text style={bk.rowLabel}>Oportunidades detectadas</Text>
          </View>
          <Text style={[bk.rowValue, { color: C.green }]}>+{formatCurrency(opportunities)}</Text>
        </View>

        <View style={bk.divider} />

        <View style={bk.row}>
          <Text style={bk.totalLabel}>Total recomendado</Text>
          <Text style={bk.totalValue}>{formatCurrency(total)}</Text>
        </View>
      </View>
    </View>
  );
}

const bk = StyleSheet.create({
  card:       { backgroundColor: C.card, borderRadius: 20, padding: spacing[5], gap: spacing[4], ...shadow },
  title:      { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.text },
  rows:       { gap: spacing[3] },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  rowLeft:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1 },
  dot:        { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  rowLabel:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub, flex: 1 },
  rowValue:   { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  divider:    { height: 1, backgroundColor: C.border, marginVertical: spacing[1] },
  totalLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  totalValue: { fontFamily: 'Montserrat_800ExtraBold', fontSize: 18, color: C.violet },
});

// ─── Custom Amount Modal ──────────────────────────────────────────────────────

function CustomAmountModal({ visible, suggested, onClose, onSave }: {
  visible: boolean; suggested: number;
  onClose: () => void; onSave: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(suggested.toString());

  return (
    <FormSheetModal visible={visible} title="Elegir otro monto" onClose={onClose} presentationStyle="formSheet" scrollable={false}>
      <Text style={cam.label}>MONTO DE LA META (ARS)</Text>
      <View style={cam.amountBox}>
        <Text style={cam.prefix}>$</Text>
        <TextInput
          style={cam.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={C.muted}
          autoFocus
        />
      </View>
      <FormSheetButton
        label="Crear meta con este monto"
        color={C.blue}
        onPress={() => {
          const amt = parseFloat(amount.replace(',', '.'));
          if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Ingresá un monto válido.'); return; }
          onSave(amt);
        }}
      />
    </FormSheetModal>
  );
}

const cam = StyleSheet.create({
  label:    { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: C.muted, letterSpacing: 0.6 },
  amountBox:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: C.light, borderRadius: 16, padding: spacing[5], borderWidth: 1.5, borderColor: C.border },
  prefix:   { fontFamily: 'Montserrat_700Bold', fontSize: 32, color: C.muted },
  input:    { fontFamily: 'Montserrat_700Bold', fontSize: 40, color: C.text, minWidth: 100, textAlign: 'center' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavingsGoalScreen() {
  const { user } = useAuthStore();
  const { addGoal } = useGoalsStore();
  const [plan,       setPlan]       = useState<BudgetPlan | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const data = await fetchBudgetPlan(user.id);
    setPlan(data);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // baseSavings = potentialSavings (categories on track to spend below avg)
  // opportunities = excess spending in over-budget categories that could be cut
  const baseSavings   = plan?.potentialSavings ?? 0;
  const opportunities = (plan?.categories ?? [])
    .filter(c => c.status === 'over')
    .reduce((s, c) => s + Math.max(0, c.projected - c.avgMonthly), 0);
  const suggested = Math.round(baseSavings + opportunities);

  const handleCreateGoal = async (amount: number) => {
    if (!user?.id) return;
    setCreating(true);
    try {
      await addGoal(user.id, {
        title: 'Ahorro mensual inteligente',
        emoji: '🤖',
        target_amount: amount,
        current_amount: 0,
        deadline: null,
      });
      Alert.alert('¡Meta creada!', `Tu meta de ${formatCurrency(amount)} fue guardada en Ahorros.`, [
        { text: 'Ir a Ahorros', onPress: () => router.push('/(app)/savings' as any) },
        { text: 'Seguir aquí', style: 'cancel' },
      ]);
    } catch {
      Alert.alert('Error', 'No se pudo crear la meta. Intentá de nuevo.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Meta sugerida</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={st.centered}>
          <ActivityIndicator size="large" color={C.violet} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <HeroCard amount={suggested} />

          <BreakdownCard
            baseSavings={baseSavings}
            opportunities={opportunities}
            total={suggested}
          />

          {/* What to do */}
          <View style={st.actionsCard}>
            <Text style={st.actionsTitle}>¿Qué podés hacer?</Text>

            <TouchableOpacity
              style={[st.primaryBtn, creating && { opacity: 0.6 }]}
              onPress={() => handleCreateGoal(suggested)}
              disabled={creating}
              activeOpacity={0.85}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="flag-outline" size={18} color="#FFF" />
                  <Text style={st.primaryBtnText}>Crear meta automática</Text>
                  <Ionicons name="chevron-forward" size={14} color="#FFF" />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={st.secondaryBtn}
              onPress={() => setShowCustom(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={18} color={C.blue} />
              <Text style={st.secondaryBtnText}>Elegir otro monto</Text>
              <Ionicons name="chevron-forward" size={14} color={C.blue} />
            </TouchableOpacity>
          </View>

          {/* Info note */}
          <View style={st.note}>
            <Ionicons name="information-circle-outline" size={16} color={C.muted} />
            <Text style={st.noteText}>
              Esta sugerencia se basa en tus últimos 3 meses de gastos y las categorías donde tenés margen para reducir.
            </Text>
          </View>
        </ScrollView>
      )}

      <CustomAmountModal
        visible={showCustom}
        suggested={suggested}
        onClose={() => setShowCustom(false)}
        onSave={(amt) => {
          setShowCustom(false);
          handleCreateGoal(amt);
        }}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: C.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], paddingBottom: spacing[4] },
  headerTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  backBtn:         { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  centered:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:          { paddingHorizontal: layout.screenPadding, paddingBottom: layout.tabBarHeight + spacing[6], gap: spacing[4] },
  actionsCard:     { backgroundColor: C.card, borderRadius: 20, padding: spacing[5], gap: spacing[3], ...shadow },
  actionsTitle:    { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: C.text, marginBottom: spacing[1] },
  primaryBtn:      { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.blue, borderRadius: 14, padding: spacing[4] },
  primaryBtnText:  { flex: 1, fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#FFF' },
  secondaryBtn:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], borderWidth: 1.5, borderColor: C.blue + '40', borderRadius: 14, padding: spacing[4] },
  secondaryBtnText:{ flex: 1, fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.blue },
  note:            { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  noteText:        { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted, lineHeight: 18 },
});
