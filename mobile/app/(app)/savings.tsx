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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import {
  useSavingsStore,
  type Saving,
  type Investment,
  type InstrumentType,
  type SavingCurrency,
} from '@/store/savingsStore';
import { fetchDolarRateNow } from '@/hooks/useDolarRates';
import { formatCurrency } from '@/utils/format';

// ─── Config ───────────────────────────────────────────────────────────────────

const INSTRUMENT_CONFIG: Record<InstrumentType, { label: string; icon: string; color: string }> = {
  fci:        { label: 'FCI Money Market', icon: 'trending-up-outline',  color: colors.neon    },
  cedear:     { label: 'Cedears',          icon: 'business-outline',      color: colors.primary },
  plazo_fijo: { label: 'Plazo Fijo UVA',   icon: 'timer-outline',         color: colors.yellow  },
  crypto:     { label: 'Criptomonedas',    icon: 'cube-outline',          color: '#F7931A'      },
  bonds:      { label: 'Bonos / Letras',   icon: 'document-text-outline', color: '#A78BFA'      },
  acciones:   { label: 'Acciones',         icon: 'stats-chart-outline',   color: '#22D3EE'      },
  other:      { label: 'Otro',             icon: 'wallet-outline',        color: colors.text.secondary },
};

const INSTRUMENT_TYPES = Object.keys(INSTRUMENT_CONFIG) as InstrumentType[];

const SAVING_LABELS: Record<SavingCurrency, string> = { ARS: 'Pesos', USD: 'Dólares' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcEstimatedGain(inv: Investment): number | null {
  if (!inv.annual_return || !inv.start_date) return null;
  const start    = new Date(inv.start_date);
  const now      = new Date();
  const months   = Math.max(
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()),
    0,
  );
  if (months === 0) return null;
  const monthly  = Math.pow(1 + inv.annual_return / 100, 1 / 12) - 1;
  return Math.round(inv.amount * (Math.pow(1 + monthly, months) - 1));
}

function buildInsights(
  totalARS: number,
  totalUSDInARS: number,
  totalInvested: number,
  investments: Investment[],
): string[] {
  const total   = totalARS + totalUSDInARS + totalInvested;
  if (total === 0) return ['Cargá tus ahorros e inversiones para ver cómo está tu capital.'];

  const insights: string[] = [];
  const cashPct      = total > 0 ? ((totalARS + totalUSDInARS) / total) * 100 : 0;
  const usdPct       = total > 0 ? (totalUSDInARS / total) * 100 : 0;
  const investedPct  = total > 0 ? (totalInvested / total) * 100 : 0;

  if (cashPct > 60) {
    insights.push(
      `El ${Math.round(cashPct)}% de tu capital está sin invertir — esos pesos pierden valor contra la inflación.`,
    );
  }
  if (usdPct < 15 && total > 100000) {
    insights.push('Poca dolarización: tu cartera es vulnerable a la inflación en pesos.');
  }
  if (investments.length === 0) {
    insights.push('No tenés inversiones registradas. Empezar con FCI Money Market es lo más simple.');
  } else {
    const types = new Set(investments.map(i => i.instrument_type));
    if (types.size === 1 && types.has('fci')) {
      insights.push('Tu cartera es conservadora — todo en FCI. Podrías sumar Cedears para más rendimiento.');
    }
    if (investedPct > 80) {
      insights.push(`Buen nivel de inversión (${Math.round(investedPct)}%). Mantené siempre algo líquido para emergencias.`);
    }
  }

  return insights.slice(0, 2);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TotalCapitalCard({
  totalARS,
  totalUSDInARS,
  totalInvested,
  usdRate,
}: {
  totalARS:       number;
  totalUSDInARS:  number;
  totalInvested:  number;
  usdRate:        number | null;
}) {
  const total       = totalARS + totalUSDInARS + totalInvested;
  const arsW        = total > 0 ? (totalARS / total)      * 100 : 0;
  const usdW        = total > 0 ? (totalUSDInARS / total) * 100 : 0;
  const invW        = total > 0 ? (totalInvested / total) * 100 : 0;

  return (
    <View style={cardStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>CAPITAL TOTAL</Text>
      <Text style={cardStyles.total}>{formatCurrency(total)}</Text>

      {/* Barra de distribución stacked */}
      {total > 0 && (
        <View style={cardStyles.stackBar}>
          {arsW > 0 && (
            <View style={[cardStyles.stackSlice, { flex: arsW, backgroundColor: colors.neon }]} />
          )}
          {usdW > 0 && (
            <View style={[cardStyles.stackSlice, { flex: usdW, backgroundColor: colors.primary }]} />
          )}
          {invW > 0 && (
            <View style={[cardStyles.stackSlice, { flex: invW, backgroundColor: '#A78BFA' }]} />
          )}
        </View>
      )}

      {/* Leyenda */}
      <View style={cardStyles.legend}>
        <View style={cardStyles.legendItem}>
          <View style={[cardStyles.legendDot, { backgroundColor: colors.neon }]} />
          <View>
            <Text variant="caption" color={colors.text.tertiary}>Pesos</Text>
            <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(totalARS)}</Text>
          </View>
        </View>
        <View style={cardStyles.legendDivider} />
        <View style={cardStyles.legendItem}>
          <View style={[cardStyles.legendDot, { backgroundColor: colors.primary }]} />
          <View>
            <Text variant="caption" color={colors.text.tertiary}>
              USD{usdRate ? ` · $${usdRate.toLocaleString('es-AR')}` : ''}
            </Text>
            <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(totalUSDInARS)}</Text>
          </View>
        </View>
        <View style={cardStyles.legendDivider} />
        <View style={cardStyles.legendItem}>
          <View style={[cardStyles.legendDot, { backgroundColor: '#A78BFA' }]} />
          <View>
            <Text variant="caption" color={colors.text.tertiary}>Invertido</Text>
            <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(totalInvested)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[5], gap: spacing[4],
  },
  total: {
    fontFamily: 'Montserrat_700Bold', fontSize: 34, color: colors.text.primary,
    letterSpacing: -1,
  },
  stackBar: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden',
    backgroundColor: colors.border.subtle, gap: 2,
  },
  stackSlice: { borderRadius: 4 },
  legend: { flexDirection: 'row', alignItems: 'center' },
  legendItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDivider: { width: 1, height: 32, backgroundColor: colors.border.subtle, marginHorizontal: spacing[2] },
});

function SavingRow({
  saving,
  usdRate,
  onEdit,
  onDelete,
}: {
  saving:  Saving;
  usdRate: number | null;
  onEdit:  (s: Saving) => void;
  onDelete:(id: string) => void;
}) {
  const arsValue = saving.currency === 'USD' && usdRate
    ? saving.amount * usdRate
    : saving.amount;

  return (
    <TouchableOpacity style={rowStyles.row} onPress={() => onEdit(saving)} activeOpacity={0.75}>
      <View style={[rowStyles.iconBox, { backgroundColor: (saving.currency === 'USD' ? colors.primary : colors.neon) + '18' }]}>
        <Ionicons
          name={saving.currency === 'USD' ? 'card-outline' : 'cash-outline'}
          size={18}
          color={saving.currency === 'USD' ? colors.primary : colors.neon}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>{saving.label}</Text>
        <Text variant="caption" color={colors.text.tertiary}>
          {SAVING_LABELS[saving.currency]}
          {saving.currency === 'USD' ? ` · ${saving.amount.toLocaleString('es-AR', { maximumFractionDigits: 0 })} USD` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(arsValue)}</Text>
        {saving.currency === 'USD' && !usdRate && (
          <Text variant="caption" color={colors.text.tertiary}>sin cotiz.</Text>
        )}
      </View>
      <TouchableOpacity onPress={() => onDelete(saving.id)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Ionicons name="trash-outline" size={16} color={colors.text.tertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function InvestmentCard({
  inv,
  usdRate,
  onEdit,
  onDelete,
}: {
  inv:      Investment;
  usdRate:  number | null;
  onEdit:   (i: Investment) => void;
  onDelete: (id: string) => void;
}) {
  const cfg      = INSTRUMENT_CONFIG[inv.instrument_type];
  const arsValue = inv.currency === 'USD' && usdRate ? inv.amount * usdRate : inv.amount;
  const gain     = calcEstimatedGain(inv);

  return (
    <TouchableOpacity style={invStyles.card} onPress={() => onEdit(inv)} activeOpacity={0.8}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
        {/* Icon */}
        <View style={[invStyles.iconBox, { backgroundColor: cfg.color + '18' }]}>
          <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
        </View>

        {/* Info */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>{inv.name}</Text>
          <View style={invStyles.tagRow}>
            <View style={[invStyles.tag, { backgroundColor: cfg.color + '15', borderColor: cfg.color + '30' }]}>
              <Text style={[invStyles.tagText, { color: cfg.color }]}>{cfg.label.toUpperCase()}</Text>
            </View>
            {inv.annual_return != null && (
              <Text variant="caption" color={colors.text.tertiary}>
                {inv.annual_return}% anual
              </Text>
            )}
          </View>
        </View>

        {/* Amounts */}
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(arsValue)}</Text>
          {gain != null && gain > 0 && (
            <Text variant="caption" color={colors.neon}>+{formatCurrency(gain)}</Text>
          )}
        </View>

        <TouchableOpacity onPress={() => onDelete(inv.id)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="trash-outline" size={16} color={colors.text.tertiary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingVertical: spacing[4], paddingHorizontal: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  iconBox: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
});

const invStyles = StyleSheet.create({
  card: {
    paddingVertical: spacing[4], paddingHorizontal: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  iconBox: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  tag: {
    borderRadius: 4, borderWidth: 1,
    paddingHorizontal: spacing[2], paddingVertical: 2,
  },
  tagText: { fontFamily: 'Montserrat_700Bold', fontSize: 8, letterSpacing: 0.4 },
});

// ─── Add Saving Modal ─────────────────────────────────────────────────────────

function AddSavingModal({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible:  boolean;
  initial:  Partial<Saving> | null;
  onClose:  () => void;
  onSave:   (data: Omit<Saving, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
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
    try {
      await onSave({ label: label.trim(), amount: amt, currency, type: 'cash' });
      onClose();
    } catch {
      Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text variant="subtitle">{initial?.id ? 'Editar ahorro' : 'Agregar ahorro'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={modalStyles.body}>
            {/* Moneda */}
            <Text variant="label" color={colors.text.secondary}>MONEDA</Text>
            <View style={modalStyles.segRow}>
              {(['ARS', 'USD'] as SavingCurrency[]).map(c => (
                <TouchableOpacity
                  key={c}
                  style={[modalStyles.seg, currency === c && modalStyles.segActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text variant="label" style={{ color: currency === c ? colors.black : colors.text.secondary }}>
                    {c === 'ARS' ? '🇦🇷 Pesos' : '💵 Dólares'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Descripción */}
            <Text variant="label" color={colors.text.secondary}>DESCRIPCIÓN</Text>
            <TextInput
              style={modalStyles.input}
              value={label}
              onChangeText={setLabel}
              placeholder={currency === 'USD' ? 'Ej: Dólares billete, Cripto...' : 'Ej: Cuenta bancaria, Efectivo...'}
              placeholderTextColor={colors.text.tertiary}
              maxLength={60}
            />

            {/* Monto */}
            <Text variant="label" color={colors.text.secondary}>
              MONTO ({currency})
            </Text>
            <TextInput
              style={modalStyles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder={currency === 'USD' ? '500' : '200000'}
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
            />

            <TouchableOpacity
              style={[modalStyles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.black} />
                : <Text style={modalStyles.saveBtnText}>Guardar</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Investment Modal ─────────────────────────────────────────────────────

function AddInvestmentModal({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible:  boolean;
  initial:  Partial<Investment> | null;
  onClose:  () => void;
  onSave:   (data: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
}) {
  const [name,       setName]       = useState('');
  const [instrType,  setInstrType]  = useState<InstrumentType>('fci');
  const [amount,     setAmount]     = useState('');
  const [currency,   setCurrency]   = useState<SavingCurrency>('ARS');
  const [annReturn,  setAnnReturn]  = useState('');
  const [startDate,  setStartDate]  = useState('');
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? '');
      setInstrType(initial?.instrument_type ?? 'fci');
      setAmount(initial?.amount?.toString() ?? '');
      setCurrency(initial?.currency ?? 'ARS');
      setAnnReturn(initial?.annual_return?.toString() ?? '');
      setStartDate(initial?.start_date ?? '');
    }
  }, [visible, initial]);

  const handleSave = async () => {
    const amt = parseFloat(amount.replace(',', '.'));
    if (!name.trim()) { Alert.alert('', 'Ingresá un nombre.'); return; }
    if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Ingresá un monto válido.'); return; }
    setSaving(true);
    try {
      await onSave({
        name:            name.trim(),
        instrument_type: instrType,
        amount:          amt,
        currency,
        annual_return:   annReturn ? parseFloat(annReturn) : null,
        start_date:      startDate || null,
        notes:           null,
      });
      onClose();
    } catch {
      Alert.alert('Error', 'No se pudo guardar. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <SafeAreaView style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.header}>
            <Text variant="subtitle">{initial?.id ? 'Editar inversión' : 'Agregar inversión'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={modalStyles.body}>
            {/* Tipo de instrumento */}
            <Text variant="label" color={colors.text.secondary}>TIPO DE INSTRUMENTO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -spacing[5] }}>
              <View style={{ flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[5], paddingVertical: spacing[2] }}>
                {INSTRUMENT_TYPES.map(t => {
                  const cfg = INSTRUMENT_CONFIG[t];
                  const active = instrType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => setInstrType(t)}
                      style={[
                        modalStyles.instrChip,
                        active && { backgroundColor: cfg.color, borderColor: cfg.color },
                      ]}
                    >
                      <Ionicons name={cfg.icon as any} size={14} color={active ? colors.black : cfg.color} />
                      <Text style={[modalStyles.instrChipText, { color: active ? colors.black : colors.text.secondary }]}>
                        {cfg.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Moneda */}
            <Text variant="label" color={colors.text.secondary}>MONEDA</Text>
            <View style={modalStyles.segRow}>
              {(['ARS', 'USD'] as SavingCurrency[]).map(c => (
                <TouchableOpacity
                  key={c}
                  style={[modalStyles.seg, currency === c && modalStyles.segActive]}
                  onPress={() => setCurrency(c)}
                >
                  <Text variant="label" style={{ color: currency === c ? colors.black : colors.text.secondary }}>
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nombre */}
            <Text variant="label" color={colors.text.secondary}>NOMBRE / DESCRIPCIÓN</Text>
            <TextInput
              style={modalStyles.input}
              value={name}
              onChangeText={setName}
              placeholder={INSTRUMENT_CONFIG[instrType].label}
              placeholderTextColor={colors.text.tertiary}
              maxLength={80}
            />

            {/* Monto */}
            <Text variant="label" color={colors.text.secondary}>MONTO ({currency})</Text>
            <TextInput
              style={modalStyles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder={currency === 'USD' ? '1000' : '500000'}
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
            />

            {/* Rendimiento anual (opcional) */}
            <Text variant="label" color={colors.text.secondary}>
              RENDIMIENTO ANUAL % <Text variant="caption" color={colors.text.tertiary}>(opcional)</Text>
            </Text>
            <TextInput
              style={modalStyles.input}
              value={annReturn}
              onChangeText={setAnnReturn}
              placeholder="Ej: 36 (para 36% anual)"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="decimal-pad"
            />

            {/* Fecha inicio (opcional) */}
            <Text variant="label" color={colors.text.secondary}>
              FECHA DE INICIO <Text variant="caption" color={colors.text.tertiary}>(YYYY-MM-DD, opcional)</Text>
            </Text>
            <TextInput
              style={modalStyles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder={new Date().toISOString().split('T')[0]}
              placeholderTextColor={colors.text.tertiary}
            />

            <TouchableOpacity
              style={[modalStyles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={colors.black} />
                : <Text style={modalStyles.saveBtnText}>Guardar</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  sheet:       { flex: 1, backgroundColor: colors.bg.primary },
  handle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.default, alignSelf: 'center', marginTop: spacing[3] },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[5], paddingTop: spacing[3] },
  body:        { padding: spacing[5], gap: spacing[3], paddingBottom: spacing[10] },
  segRow:      { flexDirection: 'row', gap: spacing[2] },
  seg:         { flex: 1, paddingVertical: spacing[3], borderRadius: 10, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.bg.card, alignItems: 'center' },
  segActive:   { backgroundColor: colors.primary, borderColor: colors.primary },
  input:       {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 10, paddingHorizontal: spacing[4], paddingVertical: spacing[4],
    color: colors.text.primary, fontFamily: 'Montserrat_400Regular', fontSize: 14,
  },
  instrChip:   {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderRadius: 20, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
  },
  instrChipText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 11 },
  saveBtn:     { marginTop: spacing[4], backgroundColor: colors.primary, borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: colors.black },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SavingsScreen() {
  const { user }       = useAuthStore();
  const {
    savings, investments, isLoading,
    fetchAll, addSaving, updateSaving, deleteSaving,
    addInvestment, updateInvestment, deleteInvestment,
  } = useSavingsStore();

  const [usdRate,         setUsdRate]         = useState<number | null>(null);
  const [showSavingModal, setShowSavingModal]  = useState(false);
  const [showInvModal,    setShowInvModal]     = useState(false);
  const [editingSaving,   setEditingSaving]    = useState<Partial<Saving> | null>(null);
  const [editingInv,      setEditingInv]       = useState<Partial<Investment> | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    fetchAll(user.id);
    try {
      const rate = await fetchDolarRateNow('blue');
      setUsdRate(rate);
    } catch { /* sin cotización */ }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalARS = savings
    .filter(s => s.currency === 'ARS')
    .reduce((sum, s) => sum + s.amount, 0);

  const totalUSDInARS = savings
    .filter(s => s.currency === 'USD')
    .reduce((sum, s) => sum + (usdRate ? s.amount * usdRate : 0), 0);

  const totalInvested = investments
    .reduce((sum, i) => sum + (i.currency === 'USD' && usdRate ? i.amount * usdRate : i.amount), 0);

  const insights = buildInsights(totalARS, totalUSDInARS, totalInvested, investments);

  // ── Advisor context ───────────────────────────────────────────────────────
  const advisorCtx = [
    `Tengo un capital total de ${formatCurrency(totalARS + totalUSDInARS + totalInvested)}.`,
    `Distribución: ${formatCurrency(totalARS)} en pesos, ${formatCurrency(totalUSDInARS)} en dólares (en pesos), ${formatCurrency(totalInvested)} invertidos.`,
    investments.length > 0
      ? `Mis inversiones: ${investments.map(i => `${i.name} (${INSTRUMENT_CONFIG[i.instrument_type].label}) por ${formatCurrency(i.amount)}`).join(', ')}.`
      : 'No tengo inversiones registradas.',
    '¿Cómo podría mejorar mi distribución de capital y rendimiento en Argentina hoy?',
  ].join(' ');

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openAddSaving = () => { setEditingSaving(null); setShowSavingModal(true); };
  const openEditSaving = (s: Saving) => { setEditingSaving(s); setShowSavingModal(true); };
  const openAddInv  = () => { setEditingInv(null); setShowInvModal(true); };
  const openEditInv = (i: Investment) => { setEditingInv(i); setShowInvModal(true); };

  const handleSaveSaving = async (data: Omit<Saving, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    if (!user?.id) return;
    if (editingSaving?.id) await updateSaving(editingSaving.id, data);
    else await addSaving(user.id, data);
  };

  const handleSaveInv = async (data: Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    if (!user?.id) return;
    if (editingInv?.id) await updateInvestment(editingInv.id, data);
    else await addInvestment(user.id, data);
  };

  const confirmDeleteSaving = (id: string) => {
    Alert.alert('Eliminar ahorro', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => deleteSaving(id) },
    ]);
  };

  const confirmDeleteInv = (id: string) => {
    Alert.alert('Eliminar inversión', '¿Seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => deleteInvestment(id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />
        }
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text variant="h4">Ahorros</Text>
            <Text variant="caption" color={colors.text.tertiary}>Tu capital total</Text>
          </View>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="close" size={22} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>

        {/* ── Total ──────────────────────────────────────────────────────── */}
        <TotalCapitalCard
          totalARS={totalARS}
          totalUSDInARS={totalUSDInARS}
          totalInvested={totalInvested}
          usdRate={usdRate}
        />

        {/* ── Efectivo & Reservas ─────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionDot, { backgroundColor: colors.neon }]} />
            <Text variant="label" color={colors.text.secondary}>EFECTIVO Y RESERVAS</Text>
          </View>
          <TouchableOpacity onPress={openAddSaving} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={colors.neon} />
            <Text variant="label" color={colors.neon}>Agregar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listCard}>
          {savings.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cash-outline" size={32} color={colors.text.tertiary} />
              <Text variant="caption" color={colors.text.tertiary} align="center">
                Cargá tu efectivo y reservas en pesos o dólares.
              </Text>
            </View>
          ) : (
            savings.map(s => (
              <SavingRow
                key={s.id}
                saving={s}
                usdRate={usdRate}
                onEdit={openEditSaving}
                onDelete={confirmDeleteSaving}
              />
            ))
          )}
        </View>

        {/* ── Inversiones ─────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionDot, { backgroundColor: '#A78BFA' }]} />
            <Text variant="label" color={colors.text.secondary}>INVERSIONES</Text>
          </View>
          <TouchableOpacity onPress={openAddInv} style={styles.addBtn}>
            <Ionicons name="add" size={16} color={colors.neon} />
            <Text variant="label" color={colors.neon}>Agregar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listCard}>
          {investments.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="trending-up-outline" size={32} color={colors.text.tertiary} />
              <Text variant="caption" color={colors.text.tertiary} align="center">
                Registrá tus FCI, Cedears, Plazo Fijo y más.
              </Text>
            </View>
          ) : (
            investments.map(i => (
              <InvestmentCard
                key={i.id}
                inv={i}
                usdRate={usdRate}
                onEdit={openEditInv}
                onDelete={confirmDeleteInv}
              />
            ))
          )}
        </View>

        {/* ── Insights ────────────────────────────────────────────────────── */}
        {insights.map((insight, idx) => (
          <View key={idx} style={styles.insightCard}>
            <Ionicons name="bulb-outline" size={16} color={colors.yellow} />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 18 }}>
              {insight}
            </Text>
          </View>
        ))}

        {/* ── CTA Asesor ──────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.advisorBtn}
          onPress={() => router.push({
            pathname: '/(app)/advisor',
            params: { initialContext: advisorCtx },
          } as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.black} />
          <Text style={styles.advisorBtnText}>Hablar con el asesor sobre mi capital</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.black} />
        </TouchableOpacity>

        {/* ── Ver simulador ───────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.simBtn}
          onPress={() => router.push('/(app)/simulator' as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="trending-up-outline" size={16} color={colors.primary} />
          <Text variant="label" color={colors.primary}>Simular rendimientos</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.primary} />
        </TouchableOpacity>
      </ScrollView>

      <AddSavingModal
        visible={showSavingModal}
        initial={editingSaving}
        onClose={() => setShowSavingModal(false)}
        onSave={handleSaveSaving}
      />
      <AddInvestmentModal
        visible={showInvModal}
        initial={editingInv}
        onClose={() => setShowInvModal(false)}
        onSave={handleSaveInv}
      />
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: layout.tabBarHeight + spacing[6],
    gap: spacing[4],
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    borderColor: colors.border.default, alignItems: 'center', justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing[2],
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sectionDot:      { width: 8, height: 8, borderRadius: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderRadius: 8, borderWidth: 1, borderColor: colors.neon + '40',
    backgroundColor: colors.neon + '0A',
  },
  listCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 14, overflow: 'hidden',
  },
  empty: { padding: spacing[6], alignItems: 'center', gap: spacing[3] },
  insightCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3],
    backgroundColor: colors.yellow + '0A',
    borderWidth: 1, borderColor: colors.yellow + '25',
    borderRadius: 12, padding: spacing[4],
  },
  advisorBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    backgroundColor: colors.neon, borderRadius: 14,
    paddingHorizontal: spacing[5], paddingVertical: spacing[4],
  },
  advisorBtnText: { flex: 1, fontFamily: 'Montserrat_700Bold', fontSize: 13, color: colors.black },
  simBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    borderWidth: 1, borderColor: colors.primary + '40',
    borderRadius: 12, paddingVertical: spacing[4],
  },
});
