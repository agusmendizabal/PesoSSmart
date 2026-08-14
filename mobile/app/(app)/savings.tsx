import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { useSavingsStore, type Saving, type SavingCurrency } from '@/store/savingsStore';
import { useGoalsStore, type SavingsGoal } from '@/store/goalsStore';
import { fetchDolarRateNow } from '@/hooks/useDolarRates';
import { formatCurrency } from '@/utils/format';
import { fetchBudgetPlan, type BudgetPlan } from '@/lib/budgetPlan';
import { checkAndNotifyBudgetLimits } from '@/lib/budgetNotifications';
import { ADVISOR_ENABLED } from '@/lib/features';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:      '#F7F9FC',
  card:    '#FFFFFF',
  blue:    '#2563EB',
  green:   '#16A34A',
  violet:  '#8B5CF6',
  red:     '#EF4444',
  text:    '#111827',
  sub:     '#6B7280',
  muted:   '#9CA3AF',
  border:  '#E5E7EB',
  light:   '#F3F4F6',
} as const;

const shadow = {
  shadowColor: '#1F2937',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 3,
} as const;

const GOAL_EMOJIS = ['🎯','🏖️','🚗','🏠','✈️','📱','👶','💍','🎓','💪','🐕','🌱','💻','🎸','🏋️','🍕'];

// ─── Mini Line Chart ──────────────────────────────────────────────────────────

function MiniLineChart() {
  return (
    <Svg width={90} height={34}>
      <Polyline
        points="0,28 14,22 30,18 46,20 62,10 76,6 90,2"
        fill="none"
        stroke={C.green}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={90} cy={2} r={3.5} fill={C.green} />
    </Svg>
  );
}

// ─── Smart Plan Card ──────────────────────────────────────────────────────────

function SmartPlanCard({ amount, onPress }: { amount: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={spc.card} onPress={onPress} activeOpacity={0.88}>
      <View style={spc.badge}>
        <Text style={spc.badgeText}>NUEVO</Text>
      </View>
      <View style={spc.inner}>
        <View style={{ flex: 1, gap: spacing[2] }}>
          <View style={spc.titleRow}>
            <Text style={spc.sparkle}>✨</Text>
            <Text style={spc.title}>Plan Inteligente</Text>
          </View>
          <Text style={spc.desc}>
            Descubrí cuánto podés ahorrar en base a tus hábitos
          </Text>
          <Text style={spc.amount}>{formatCurrency(amount > 0 ? amount : 0)}</Text>
          <Text style={spc.amountLabel}>Podrías ahorrar este mes</Text>
        </View>
        <View style={spc.rightCol}>
          <View style={spc.aiCircle}>
            <Ionicons name="sparkles" size={18} color={C.violet} />
          </View>
          <MiniLineChart />
        </View>
      </View>
      <View style={spc.footer}>
        <View style={spc.ctaBtn}>
          <Text style={spc.footerText}>Ver mi plan completo</Text>
          <Ionicons name="arrow-forward" size={13} color={C.violet} />
        </View>
        <View style={spc.arrowBtn}>
          <Ionicons name="arrow-forward" size={14} color={C.card} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const spc = StyleSheet.create({
  card:        { backgroundColor: C.card, borderRadius: 20, borderWidth: 1.5, borderColor: C.violet + '35', ...shadow },
  badge:       { position: 'absolute', top: 14, right: 14, backgroundColor: C.violet, borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: 3, zIndex: 2 },
  badgeText:   { fontFamily: 'Montserrat_700Bold', fontSize: 9, color: '#FFF', letterSpacing: 0.6 },
  inner:       { flexDirection: 'row', padding: spacing[5], paddingBottom: spacing[3], gap: spacing[3] },
  titleRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  sparkle:     { fontSize: 16 },
  title:       { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: C.text },
  desc:        { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18 },
  amount:      { fontFamily: 'Montserrat_800ExtraBold', fontSize: 28, color: C.green, lineHeight: 34 },
  amountLabel: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.sub },
  rightCol:    { alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: spacing[6], paddingBottom: spacing[1] },
  aiCircle:    { width: 38, height: 38, borderRadius: 19, backgroundColor: C.violet + '14', alignItems: 'center', justifyContent: 'center' },
  footer:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[5], paddingBottom: spacing[5], paddingTop: spacing[1] },
  ctaBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1.5, borderColor: C.violet + '50', borderRadius: 12, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  footerText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.violet },
  arrowBtn:    { width: 30, height: 30, borderRadius: 15, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center' },
});

// ─── Goal Card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, onEdit, onDelete, onAportar }: {
  goal: SavingsGoal; onEdit: (g: SavingsGoal) => void;
  onDelete: (id: string) => void; onAportar: (g: SavingsGoal) => void;
}) {
  const pct      = goal.target_amount > 0 ? Math.min(goal.current_amount / goal.target_amount, 1) : 0;
  const pctRound = Math.round(pct * 100);
  const accent   = pct >= 1 ? C.green : pct >= 0.6 ? C.blue : C.violet;
  const daysLeft = goal.deadline
    ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <TouchableOpacity style={gc.card} onPress={() => onEdit(goal)} activeOpacity={0.85}>
      <View style={gc.topRow}>
        <Text style={gc.emoji}>{goal.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={gc.title} numberOfLines={1}>{goal.title}</Text>
          {daysLeft !== null && (
            <Text style={gc.deadline}>
              {daysLeft > 0 ? `${daysLeft} días restantes` : daysLeft === 0 ? 'Vence hoy' : 'Vencida'}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[gc.pct, { color: accent }]}>{pctRound}%</Text>
          <TouchableOpacity onPress={() => onDelete(goal.id)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="trash-outline" size={14} color={C.muted} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={gc.track}>
        <View style={[gc.fill, { width: `${pctRound}%` as any, backgroundColor: accent }]} />
      </View>
      <View style={gc.bottomRow}>
        <Text style={gc.current}>{formatCurrency(goal.current_amount)}</Text>
        <Text style={gc.target}>de {formatCurrency(goal.target_amount)}</Text>
        {pct < 1 ? (
          <TouchableOpacity style={[gc.aportarBtn, { backgroundColor: accent }]} onPress={() => onAportar(goal)}>
            <Ionicons name="add" size={13} color="#FFF" />
            <Text style={gc.aportarText}>Aportar</Text>
          </TouchableOpacity>
        ) : (
          <View style={gc.doneBadge}>
            <Ionicons name="checkmark-circle" size={13} color={C.green} />
            <Text style={[gc.aportarText, { color: C.green }]}>Cumplida</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const gc = StyleSheet.create({
  card:       { backgroundColor: C.card, borderRadius: 18, padding: spacing[4], gap: spacing[3], ...shadow },
  topRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  emoji:      { fontSize: 26, lineHeight: 32 },
  title:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 1 },
  deadline:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  pct:        { fontFamily: 'Montserrat_800ExtraBold', fontSize: 20, lineHeight: 26 },
  track:      { height: 8, backgroundColor: C.light, borderRadius: 4, overflow: 'hidden' },
  fill:       { height: '100%', borderRadius: 4 },
  bottomRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  current:    { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: C.text },
  target:     { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  aportarBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  aportarText:{ fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#FFF' },
  doneBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.green + '12', borderRadius: 20, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
});

// ─── Saving Item (Bolsillos) ──────────────────────────────────────────────────

function SavingItem({ saving, usdRate, onEdit, onDelete }: {
  saving: Saving; usdRate: number | null;
  onEdit: (s: Saving) => void; onDelete: (id: string) => void;
}) {
  const arsValue = saving.currency === 'USD' && usdRate ? saving.amount * usdRate : saving.amount;
  const color    = saving.currency === 'USD' ? C.blue : C.green;

  return (
    <TouchableOpacity style={si.row} onPress={() => onEdit(saving)} activeOpacity={0.78}>
      <View style={[si.iconBox, { backgroundColor: color + '14' }]}>
        <Ionicons name={saving.currency === 'USD' ? 'card-outline' : 'cash-outline'} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={si.label} numberOfLines={1}>{saving.label}</Text>
        <Text style={si.currency}>{saving.currency === 'USD' ? `${saving.amount.toLocaleString('es-AR', { maximumFractionDigits: 0 })} USD` : 'Pesos ARS'}</Text>
      </View>
      <Text style={si.amount}>{formatCurrency(arsValue)}</Text>
      <Ionicons name="chevron-forward" size={14} color={C.muted} />
    </TouchableOpacity>
  );
}

const si = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.card, borderRadius: 16, padding: spacing[4], ...shadow },
  iconBox: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  label:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 1 },
  currency:{ fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  amount:  { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
});

// ─── Add Goal Modal ───────────────────────────────────────────────────────────

function AddGoalModal({ visible, initial, onClose, onSave }: {
  visible: boolean; initial: Partial<SavingsGoal> | null;
  onClose: () => void; onSave: (data: Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
}) {
  const [title, setTitle]               = useState('');
  const [emoji, setEmoji]               = useState('🎯');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline]         = useState('');
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(initial?.title ?? '');
      setEmoji(initial?.emoji ?? '🎯');
      setTargetAmount(initial?.target_amount?.toString() ?? '');
      setDeadline(initial?.deadline ?? '');
    }
  }, [visible, initial]);

  const handleSave = async () => {
    const amt = parseFloat(targetAmount.replace(',', '.'));
    if (!title.trim()) { Alert.alert('', 'Ingresá un nombre para la meta.'); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Ingresá un monto objetivo.'); return; }
    setSaving(true);
    try {
      await onSave({ title: title.trim(), emoji, target_amount: amt, current_amount: initial?.current_amount ?? 0, deadline: deadline || null });
      onClose();
    } catch { Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={m.sheet}>
          <View style={m.handle} />
          <View style={m.header}>
            <Text style={m.headerTitle}>{initial?.id ? 'Editar meta' : 'Nueva meta'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={C.sub} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={m.body} keyboardShouldPersistTaps="handled">
            <Text style={m.label}>EMOJI</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
              {GOAL_EMOJIS.map(e => (
                <TouchableOpacity key={e} style={[m.emojiBtn, emoji === e && m.emojiBtnActive]} onPress={() => setEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={m.label}>NOMBRE</Text>
            <TextInput style={m.input} value={title} onChangeText={setTitle} placeholder="Vacaciones, Auto, Emergencias..." placeholderTextColor={C.muted} autoCapitalize="sentences" maxLength={60} />
            <Text style={m.label}>MONTO OBJETIVO (ARS)</Text>
            <TextInput style={m.input} value={targetAmount} onChangeText={setTargetAmount} placeholder="1000000" placeholderTextColor={C.muted} keyboardType="decimal-pad" />
            <Text style={m.label}>FECHA LÍMITE (YYYY-MM-DD, opcional)</Text>
            <TextInput style={m.input} value={deadline} onChangeText={setDeadline} placeholder="2025-12-31" placeholderTextColor={C.muted} />
            <TouchableOpacity style={[m.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={m.saveBtnText}>Guardar meta</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Aportar Modal ────────────────────────────────────────────────────────────

function AportarModal({ goal, onClose, onSave }: {
  goal: SavingsGoal | null; onClose: () => void; onSave: (amount: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (goal) setAmount(''); }, [goal]);

  const handleSave = async () => {
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Ingresá un monto válido.'); return; }
    setSaving(true);
    try { await onSave(amt); onClose(); }
    catch { Alert.alert('Error', 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };

  if (!goal) return null;
  const remaining = goal.target_amount - goal.current_amount;

  return (
    <Modal visible={!!goal} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={m.sheet}>
          <View style={m.handle} />
          <View style={m.header}>
            <View style={{ gap: 2 }}>
              <Text style={m.headerTitle}>Aportar a meta</Text>
              <Text style={[m.label, { marginBottom: 0, fontSize: 12, textTransform: 'none', letterSpacing: 0 }]}>
                {goal.emoji} {goal.title} · faltan {formatCurrency(remaining)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.sub} /></TouchableOpacity>
          </View>
          <View style={{ padding: spacing[5], gap: spacing[4] }}>
            <View style={m.amountBox}>
              <Text style={m.prefix}>$</Text>
              <TextInput style={m.amountInput} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={C.muted} keyboardType="decimal-pad" autoFocus />
            </View>
            <TouchableOpacity style={[m.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={m.saveBtnText}>Aportar</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Saving Modal ─────────────────────────────────────────────────────────

function AddSavingModal({ visible, initial, onClose, onSave }: {
  visible: boolean; initial: Partial<Saving> | null; onClose: () => void;
  onSave: (data: Omit<Saving, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
}) {
  const [label,    setLabel]    = useState('');
  const [amount,   setAmount]   = useState('');
  const [currency, setCurrency] = useState<SavingCurrency>('ARS');
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (visible) {
      setLabel(initial?.label ?? '');
      setAmount(initial?.amount?.toString() ?? '');
      setCurrency(initial?.currency ?? 'ARS');
    }
  }, [visible, initial]);

  const handleSave = async () => {
    const amt = parseFloat(amount.replace(',', '.'));
    if (!label.trim()) { Alert.alert('', 'Ingresá una descripción.'); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Ingresá un monto válido.'); return; }
    setSaving(true);
    try { await onSave({ label: label.trim(), amount: amt, currency, type: 'cash' }); onClose(); }
    catch { Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={m.sheet}>
          <View style={m.handle} />
          <View style={m.header}>
            <Text style={m.headerTitle}>{initial?.id ? 'Editar ahorro' : 'Agregar bolsillo'}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.sub} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={m.body} keyboardShouldPersistTaps="handled">
            <Text style={m.label}>MONEDA</Text>
            <View style={m.segRow}>
              {(['ARS', 'USD'] as SavingCurrency[]).map(c => (
                <TouchableOpacity key={c} style={[m.seg, currency === c && m.segActive]} onPress={() => setCurrency(c)}>
                  <Text style={[m.segText, currency === c && m.segTextActive]}>
                    {c === 'ARS' ? '🇦🇷 Pesos' : '💵 Dólares'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={m.label}>DESCRIPCIÓN</Text>
            <TextInput style={m.input} value={label} onChangeText={setLabel} placeholder={currency === 'USD' ? 'Dólares billete...' : 'Cuenta bancaria, Efectivo...'} placeholderTextColor={C.muted} maxLength={60} />
            <Text style={m.label}>MONTO ({currency})</Text>
            <TextInput style={m.input} value={amount} onChangeText={setAmount} placeholder={currency === 'USD' ? '500' : '200000'} placeholderTextColor={C.muted} keyboardType="decimal-pad" />
            <TouchableOpacity style={[m.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={m.saveBtnText}>Guardar</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const m = StyleSheet.create({
  sheet:         { flex: 1, backgroundColor: C.card },
  handle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginTop: spacing[3] },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[5], paddingTop: spacing[3] },
  headerTitle:   { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  body:          { padding: spacing[5], gap: spacing[3], paddingBottom: spacing[10] },
  label:         { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: -spacing[1] },
  input:         { backgroundColor: C.light, borderRadius: 12, paddingHorizontal: spacing[4], paddingVertical: spacing[4], color: C.text, fontFamily: 'Montserrat_400Regular', fontSize: 15, borderWidth: 1, borderColor: C.border },
  segRow:        { flexDirection: 'row', gap: spacing[2] },
  seg:           { flex: 1, paddingVertical: spacing[3], borderRadius: 12, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', backgroundColor: C.light },
  segActive:     { backgroundColor: C.blue, borderColor: C.blue },
  segText:       { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.sub },
  segTextActive: { color: '#FFF' },
  saveBtn:       { marginTop: spacing[2], backgroundColor: C.blue, borderRadius: 14, height: 54, alignItems: 'center', justifyContent: 'center' },
  saveBtnText:   { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#FFF' },
  amountBox:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: C.light, borderRadius: 16, padding: spacing[5], borderWidth: 1.5, borderColor: C.border },
  prefix:        { fontFamily: 'Montserrat_700Bold', fontSize: 32, color: C.muted },
  amountInput:   { fontFamily: 'Montserrat_700Bold', fontSize: 40, color: C.text, minWidth: 80, textAlign: 'center' },
  emojiBtn:      { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: C.light },
  emojiBtnActive:{ borderColor: C.blue, backgroundColor: C.blue + '12' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavingsScreen() {
  const { user } = useAuthStore();
  const { savings, isLoading: isSavingsLoading, fetchAll, addSaving, updateSaving, deleteSaving } = useSavingsStore();
  const { goals, fetchGoals, addGoal, updateGoal, deleteGoal, addToGoal } = useGoalsStore();

  const [usdRate,         setUsdRate]        = useState<number | null>(null);
  const [budgetPlan,      setBudgetPlan]      = useState<BudgetPlan | null>(null);
  const [showGoalModal,   setShowGoalModal]   = useState(false);
  const [showSavingModal, setShowSavingModal] = useState(false);
  const [editingGoal,     setEditingGoal]     = useState<Partial<SavingsGoal> | null>(null);
  const [editingSaving,   setEditingSaving]   = useState<Partial<Saving> | null>(null);
  const [aportarGoal,     setAportarGoal]     = useState<SavingsGoal | null>(null);
  const [isRefreshing,    setIsRefreshing]    = useState(false);
  const { isFirstVisit, markVisited } = useFirstVisit('savings');

  const load = useCallback(async () => {
    if (!user?.id) return;
    fetchAll(user.id);
    fetchGoals(user.id);
    const [rate, plan] = await Promise.allSettled([
      fetchDolarRateNow('blue'),
      fetchBudgetPlan(user.id),
    ]);
    if (rate.status === 'fulfilled') setUsdRate(rate.value);
    if (plan.status === 'fulfilled') {
      setBudgetPlan(plan.value);
      if (plan.value) checkAndNotifyBudgetLimits(plan.value); // fire & forget
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const openAddGoal    = () => { setEditingGoal(null);   setShowGoalModal(true); };
  const openEditGoal   = (g: SavingsGoal) => { setEditingGoal(g); setShowGoalModal(true); };
  const openAddSaving  = () => { setEditingSaving(null); setShowSavingModal(true); };
  const openEditSaving = (s: Saving) => { setEditingSaving(s); setShowSavingModal(true); };

  const handleSaveGoal = async (data: Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'>) => {
    if (!user?.id) return;
    if (editingGoal?.id) await updateGoal(editingGoal.id, data);
    else await addGoal(user.id, data);
  };

  const handleSaveSaving = async (data: Omit<Saving, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    if (!user?.id) return;
    if (editingSaving?.id) await updateSaving(editingSaving.id, data);
    else await addSaving(user.id, data);
  };

  const confirmDeleteGoal   = (id: string) => Alert.alert('Eliminar meta', '¿Seguro?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => deleteGoal(id) }]);
  const confirmDeleteSaving = (id: string) => Alert.alert('Eliminar ahorro', '¿Seguro?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => deleteSaving(id) }]);

  const totalARS      = savings.filter(s => s.currency === 'ARS').reduce((s, v) => s + v.amount, 0);
  const totalUSDInARS = savings.filter(s => s.currency === 'USD').reduce((s, v) => s + (usdRate ? v.amount * usdRate : 0), 0);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.blue} />}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View>
            <Text style={s.screenTitle}>Ahorros</Text>
            {(totalARS + totalUSDInARS) > 0 && (
              <Text style={s.screenSub}>Capital: {formatCurrency(totalARS + totalUSDInARS)}</Text>
            )}
          </View>
          <TouchableOpacity style={s.iconBtn} onPress={openAddSaving} activeOpacity={0.7}>
            <Ionicons name="add" size={22} color={C.blue} />
          </TouchableOpacity>
        </View>

        {/* ── Tus metas ──────────────────────────────────────────────────── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Tus metas</Text>
          <TouchableOpacity onPress={openAddGoal}>
            <Text style={s.seeAll}>Ver todas</Text>
          </TouchableOpacity>
        </View>

        {goals.length === 0 ? (
          <TouchableOpacity style={s.emptyCard} onPress={openAddGoal} activeOpacity={0.8}>
            <View style={[s.emptyIcon, { backgroundColor: C.violet + '14' }]}>
              <Text style={{ fontSize: 22 }}>🎯</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.emptyTitle}>Creá tu primera meta</Text>
              <Text style={s.emptySub}>Vacaciones, auto, fondo de emergencia...</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.muted} />
          </TouchableOpacity>
        ) : (
          goals.slice(0, 3).map(g => (
            <GoalCard
              key={g.id} goal={g}
              onEdit={openEditGoal}
              onDelete={confirmDeleteGoal}
              onAportar={(goal) => setAportarGoal(goal)}
            />
          ))
        )}

        {/* ── Plan Inteligente ───────────────────────────────────────────── */}
        {budgetPlan && (
          <SmartPlanCard
            amount={budgetPlan.potentialSavings}
            onPress={() => router.push('/(app)/savings-plan' as any)}
          />
        )}

        {/* ── Bolsillos ──────────────────────────────────────────────────── */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Bolsillos</Text>
          <TouchableOpacity onPress={openAddSaving}>
            <Text style={s.seeAll}>Ver todos</Text>
          </TouchableOpacity>
        </View>

        {savings.length === 0 ? (
          <TouchableOpacity style={s.emptyCard} onPress={openAddSaving} activeOpacity={0.8}>
            <View style={[s.emptyIcon, { backgroundColor: C.green + '14' }]}>
              <Ionicons name="cash-outline" size={20} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.emptyTitle}>Agregar efectivo</Text>
              <Text style={s.emptySub}>Pesos, dólares, cuenta bancaria...</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.muted} />
          </TouchableOpacity>
        ) : (
          savings.map(sv => (
            <SavingItem
              key={sv.id} saving={sv} usdRate={usdRate}
              onEdit={openEditSaving}
              onDelete={confirmDeleteSaving}
            />
          ))
        )}

        {/* ── Advisor CTA ────────────────────────────────────────────────── */}
        {ADVISOR_ENABLED && (
          <TouchableOpacity
            style={s.advisorBtn}
            onPress={() => router.push({ pathname: '/(app)/advisor', params: { initialContext: 'Quiero mejorar mis ahorros y capital.' } } as any)}
            activeOpacity={0.85}
          >
            <View style={s.advisorIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={C.blue} />
            </View>
            <Text style={s.advisorText}>Hablar con el asesor sobre mi capital</Text>
            <Ionicons name="arrow-forward" size={14} color={C.blue} />
          </TouchableOpacity>
        )}
      </ScrollView>

      <AddGoalModal
        visible={showGoalModal}
        initial={editingGoal}
        onClose={() => setShowGoalModal(false)}
        onSave={handleSaveGoal}
      />
      <AddSavingModal
        visible={showSavingModal}
        initial={editingSaving}
        onClose={() => setShowSavingModal(false)}
        onSave={handleSaveSaving}
      />
      <AportarModal
        goal={aportarGoal}
        onClose={() => setAportarGoal(null)}
        onSave={(amount) => addToGoal(aportarGoal!.id, amount)}
      />

      <FirstVisitSheet
        visible={isFirstVisit}
        screenTitle="Tus ahorros"
        screenIcon="wallet-outline"
        iconColor={C.blue}
        features={[
          { icon: 'flag-outline', color: C.green, title: 'Metas de ahorro', body: 'Creá metas con objetivo y plazo, y sumá aportes cuando quieras. Vas viendo el progreso en tiempo real.' },
          { icon: 'card-outline', color: C.blue, title: 'Bolsillos separados', body: 'Guardá tu ahorro en pesos o dólares, separado de tu cuenta principal, para no gastarlo por error.' },
          { icon: 'sparkles-outline', color: C.violet, title: 'Plan Inteligente', body: 'Si activás el Plan Inteligente, te sugerimos cuánto y dónde conviene destinar tu ahorro según tu situación.' },
        ]}
        onDismiss={markVisited}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  scroll:      { paddingHorizontal: layout.screenPadding, paddingTop: spacing[4], paddingBottom: layout.tabBarHeight + spacing[6], gap: spacing[4] },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  screenTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 26, color: C.text },
  screenSub:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub, marginTop: 2 },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: C.blue + '12', alignItems: 'center', justifyContent: 'center' },
  sectionRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:{ fontFamily: 'Montserrat_700Bold', fontSize: 17, color: C.text },
  seeAll:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.blue },
  emptyCard:   { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.card, borderRadius: 16, padding: spacing[4], ...shadow },
  emptyIcon:   { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emptyTitle:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 2 },
  emptySub:    { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.muted },
  advisorBtn:  { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.blue + '0D', borderWidth: 1, borderColor: C.blue + '30', borderRadius: 16, padding: spacing[4] },
  advisorIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.blue + '14', alignItems: 'center', justifyContent: 'center' },
  advisorText: { flex: 1, fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.blue },
});
