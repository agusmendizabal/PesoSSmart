import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useDolarRates, fetchDolarRateNow, DOLAR_LABELS, type DolarType } from '@/hooks/useDolarRates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, PressableCard, Button, Input, Badge } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import type { DetectedSubscription } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/utils/format';
import type { PaymentMethod, Expense, ExpenseClassification } from '@/types';
import { PendingTransactions } from '@/components/PendingTransactions';

const expenseSchema = z.object({
  description: z.string().min(1, 'Describí el gasto.').max(100),
  amount: z.string().min(1, 'Ingresá el monto.').refine(
    (v) => !isNaN(parseFloat(v.replace(',', '.'))) && parseFloat(v.replace(',', '.')) > 0,
    'El monto debe ser mayor a 0.'
  ),
  date: z.string().min(1, 'Seleccioná una fecha.'),
  payment_method: z.string().min(1),
  notes: z.string().optional(),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

const paymentMethods: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'cash', label: 'Efectivo', icon: 'cash-outline' },
  { value: 'debit', label: 'Débito', icon: 'card-outline' },
  { value: 'credit', label: 'Crédito', icon: 'card-outline' },
  { value: 'transfer', label: 'Transferencia', icon: 'swap-horizontal-outline' },
  { value: 'digital_wallet', label: 'Billetera digital', icon: 'phone-portrait-outline' },
  { value: 'other', label: 'Otro', icon: 'ellipsis-horizontal-outline' },
];

// ─── BarChart — reemplaza al donut ────────────────────────────────────────────

function CategoryBarChart({ rows, total }: {
  rows: { name: string; color: string; amount: number; pct: number }[];
  total: number;
}) {
  const maxAmount = rows[0]?.amount ?? 1;
  return (
    <View style={detStyles.barChart}>
      {/* Resumen total */}
      <View style={detStyles.totalRow}>
        <Text variant="label" color={colors.text.tertiary}>TOTAL DEL MES</Text>
        <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(total)}</Text>
      </View>

      {/* Barra stacked de composición */}
      <View style={detStyles.stackBar}>
        {rows.map((row, i) => (
          <View
            key={i}
            style={[
              detStyles.stackSlice,
              { flex: row.amount, backgroundColor: row.color },
              i === 0 && { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
              i === rows.length - 1 && { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
            ]}
          />
        ))}
      </View>

      {/* Filas de barras horizontales */}
      <View style={detStyles.barList}>
        {rows.map((row, i) => (
          <View key={i} style={detStyles.barRow}>
            {/* Label row */}
            <View style={detStyles.barLabelRow}>
              <View style={[detStyles.barDot, { backgroundColor: row.color }]} />
              <Text style={detStyles.barName} numberOfLines={1}>{row.name}</Text>
              <Text style={[detStyles.barPct, { color: row.color }]}>
                {Math.round(row.pct * 100)}%
              </Text>
              <Text style={detStyles.barAmount}>{formatCurrency(row.amount)}</Text>
            </View>
            {/* Barra proporcional al máximo */}
            <View style={detStyles.barTrack}>
              <View style={[
                detStyles.barFill,
                { width: `${(row.amount / maxAmount) * 100}%`, backgroundColor: row.color },
              ]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Estilos del card de detalles ─────────────────────────────────────────────

const detStyles = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[1],
    marginBottom:     spacing[2],
    paddingVertical:  spacing[5],
    paddingHorizontal: spacing[5],
    backgroundColor:  colors.bg.card,
    borderWidth:      1,
    borderColor:      colors.border.default,
    borderRadius:     12,
    gap:              spacing[5],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  barChart:   { gap: spacing[4] },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // Stacked bar
  stackBar:   { height: 8, flexDirection: 'row', borderRadius: 4, overflow: 'hidden', backgroundColor: colors.border.subtle },
  stackSlice: { height: '100%' },

  // Bar list
  barList:   { gap: spacing[4] },
  barRow:    { gap: spacing[1] },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: 4 },
  barDot:    { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  barName:   { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 13, color: colors.text.primary },
  barPct:    { fontFamily: 'Montserrat_700Bold', fontSize: 12, minWidth: 32, textAlign: 'right' },
  barAmount: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: colors.text.secondary, minWidth: 72, textAlign: 'right' },
  barTrack:  { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  barFill:   { height: '100%', borderRadius: 3 },
});

// ─── MonthSelector ────────────────────────────────────────────────────────────

function buildMonthList(): { month: number; year: number; label: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      month: d.getMonth() + 1,
      year:  d.getFullYear(),
      label: d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
               .replace('.', '').replace(' ', " '"),
    });
  }
  return result;
}

const MONTH_LIST = buildMonthList();

function MonthSelector({
  selected,
  onSelect,
}: {
  selected: { month: number; year: number };
  onSelect: (month: number, year: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={msStyles.row}
      style={msStyles.container}
    >
      {MONTH_LIST.map((m) => {
        const isActive = m.month === selected.month && m.year === selected.year;
        return (
          <TouchableOpacity
            key={`${m.year}-${m.month}`}
            style={[msStyles.chip, isActive && msStyles.chipActive]}
            onPress={() => onSelect(m.month, m.year)}
          >
            <Text
              variant="label"
              style={{ fontSize: 10, color: isActive ? colors.black : colors.text.secondary }}
            >
              {m.label.toUpperCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const msStyles = StyleSheet.create({
  container: { marginHorizontal: -layout.screenPadding },
  row:       { paddingHorizontal: layout.screenPadding, gap: spacing[2], paddingVertical: spacing[2] },
  chip:      {
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderRadius: 20, borderWidth: 1, borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
  },
  chipActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
  },
});

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { user } = useAuthStore();
  const {
    expenses,
    categories,
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
    fetchExpenses,
    fetchMoreExpenses,
    fetchCategories,
    fetchSubscriptionsAndProjection,
    addExpense,
    updateExpense,
    deleteExpense,
    isLoading,
    isLoadingMore,
    hasMore,
    filter,
    setFilter,
    subscriptions,
  } = useExpensesStore();

  const { rates, labels: dolarLabels } = useDolarRates();
  // dolarLabels viene del hook pero también exportamos DOLAR_LABELS directamente

  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [activeTab, setActiveTab] = useState<'gastos' | 'stats'>('gastos');

  // Agrupar gastos del mes actual por categoría para el resumen de detalles
  const categoryRows = useMemo(() => {
    const now   = new Date();
    const ymKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const map: Record<string, { name: string; color: string; icon: string; amount: number }> = {};
    for (const e of expenses) {
      if (!e.date.startsWith(ymKey)) continue;
      const key   = e.category_id ?? '__none__';
      const name  = e.category?.name_es ?? 'Sin categoría';
      const color = e.category?.color ?? '#78909c';
      const icon  = e.category?.icon ?? 'help-circle-outline';
      if (!map[key]) map[key] = { name, color, icon, amount: 0 };
      map[key].amount += e.amount;
    }
    const total = Object.values(map).reduce((s, r) => s + r.amount, 0);
    return Object.values(map)
      .map(r => ({ ...r, pct: total > 0 ? r.amount / total : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('cash');

  // Multi-moneda
  const [currency,      setCurrency]      = useState<'ARS' | 'USD'>('ARS');
  const [dolarType,     setDolarType]     = useState<DolarType>('blue');

  const [isProcessing, setIsProcessing] = useState(false);

  // Estado para editar un gasto confirmado
  const [editingExpense,     setEditingExpense]     = useState<Expense | null>(null);
  const [editExpenseValues,  setEditExpenseValues]  = useState<{
    description: string;
    amount: string;
    date: string;
    classification: ExpenseClassification;
    category_id: string | null;
  } | null>(null);
  const [isSavingEdit,       setIsSavingEdit]       = useState(false);

  const pickAndProcessScreenshot = async () => {
    if (!user?.id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para importar el screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: false,
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    setIsProcessing(true);
    try {
      // Redimensionar a 900px de ancho para que el modelo pueda leer el texto
      const resized = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 900 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!resized.base64) throw new Error('No se pudo procesar la imagen');

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/process-screenshot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            image_base64: resized.base64,
            image_type: 'image/jpeg',
          }),
        }
      );
      const data = await response.json();
      if (data.expenses && data.expenses.length > 0) {
        // Auto-guardar todos los gastos detectados sin pedir confirmación
        for (const e of data.expenses) {
          await addExpense(user.id, {
            description: e.description,
            amount: e.amount,
            date: e.date,
            payment_method: 'digital_wallet',
            notes: null,
            is_recurring: false,
          });
        }
        fetchExpenses(user.id);
        Alert.alert(
          'Gastos registrados',
          `${data.expenses.length} gasto${data.expenses.length > 1 ? 's' : ''} guardado${data.expenses.length > 1 ? 's' : ''} automáticamente.`
        );
      } else {
        Alert.alert('Sin resultados', data.debug ?? data.error ?? 'El modelo no detectó gastos. Probá con una captura más clara.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo procesar la imagen. Intentá de nuevo.');
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setEditExpenseValues({
      description:    expense.description,
      amount:         String(expense.amount),
      date:           expense.date,
      classification: expense.classification ?? 'necessary',
      category_id:    expense.category_id,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingExpense || !editExpenseValues) return;
    const amount = parseFloat(editExpenseValues.amount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Monto inválido', 'Ingresá un monto mayor a 0.');
      return;
    }
    setIsSavingEdit(true);
    try {
      await updateExpense(editingExpense.id, {
        description:    editExpenseValues.description,
        amount,
        date:           editExpenseValues.date,
        classification: editExpenseValues.classification,
        category_id:    editExpenseValues.category_id,
      });
      setEditingExpense(null);
      setEditExpenseValues(null);
    } catch {
      Alert.alert('Error', 'No se pudo guardar el cambio.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteExpense = (id: string) => {
    Alert.alert('Eliminar gasto', '¿Estás seguro? Esta acción no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExpense(id);
            setEditingExpense(null);
            setEditExpenseValues(null);
          } catch {
            Alert.alert('Error', 'No se pudo eliminar el gasto.');
          }
        },
      },
    ]);
  };

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      payment_method: 'cash',
      notes: '',
    },
  });

  const [pendingTxs,        setPendingTxs]        = useState<any[]>([]);
  const [isPolling,         setIsPolling]         = useState(false);
  const [gmailTokenExpired, setGmailTokenExpired] = useState(false);
  const [inCoupleMode,  setInCoupleMode]  = useState(false);
  const [isShared,      setIsShared]      = useState(false);

  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchCategories();
      fetchSubscriptionsAndProjection(user.id);
      pollGmail();
      checkCoupleMode(user.id);
    }
  }, [user?.id, filter]);

  const checkCoupleMode = async (userId: string) => {
    const { data } = await supabase
      .from('family_members')
      .select('role, family_groups!inner(group_type)')
      .eq('user_id', userId)
      .single();
    setInCoupleMode((data as any)?.family_groups?.group_type === 'couple');
  };

  const pollGmail = async () => {
    setIsPolling(true);
    const { data: { session: cachedSession } } = await supabase.auth.getSession();
    const token = cachedSession?.access_token;
    console.log('[pollGmail] token:', token ? 'ok' : 'null', '| expires_at:', cachedSession?.expires_at);
    if (!token) { setIsPolling(false); return; }

    const status = await pollGmailWithToken(token);

    // Si el JWT venció, forzar refresh y reintentar una sola vez
    if (status === 401) {
      console.log('[pollGmail] JWT rechazado, forzando refreshSession...');
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) {
        console.log('[pollGmail] Sesión inválida, no se puede refrescar:', refreshError?.message);
        setIsPolling(false);
        return;
      }
      console.log('[pollGmail] Sesión refrescada OK, reintentando...');
      await pollGmailWithToken(refreshed.session.access_token);
    }
    setIsPolling(false);
  };

  const pollGmailWithToken = async (token: string): Promise<number | undefined> => {
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/gmail-poll`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('[pollGmail] status:', res.status);
      if (!res.ok) {
        const errBody = await res.text();
        console.log('[pollGmail] error body:', errBody);
        return res.status;
      }
      const data = await res.json();
      // Token de Gmail vencido — la función devuelve 200 con code GMAIL_TOKEN_EXPIRED
      if (data?.code === 'GMAIL_TOKEN_EXPIRED') {
        console.log('[pollGmail] Token Gmail expirado, mostrando aviso.');
        setGmailTokenExpired(true);
        return;
      }
      setGmailTokenExpired(false);
      console.log('[pollGmail] gmail_connected:', data?.gmail_connected, '| new_found:', data?.new_found, '| pending:', data?.pending?.length ?? 0);
      setPendingTxs(data?.pending ?? []);
    } catch (e) {
      console.log('[pollGmail] fetch error:', e);
    }
  };

  const onSubmit = async (data: ExpenseFormData) => {
    if (!user?.id) return;
    try {
      const rawAmount = parseFloat(data.amount.replace(',', '.'));

      let finalAmount = rawAmount;
      let notesWithFx = data.notes || null;

      if (currency === 'USD') {
        let rate: number;
        try {
          // Fetch fresco en el momento exacto de guardar
          rate = await fetchDolarRateNow(dolarType);
        } catch {
          Alert.alert(
            'Sin cotización',
            'No se pudo obtener la cotización del dólar en este momento. Verificá tu conexión e intentá de nuevo.',
          );
          return;
        }
        finalAmount = Math.round(rawAmount * rate);
        const fxNote = `USD ${rawAmount.toLocaleString('es-AR')} × $${rate.toLocaleString('es-AR')} (${DOLAR_LABELS[dolarType]})`;
        notesWithFx = data.notes ? `${data.notes} | ${fxNote}` : fxNote;
      }

      await addExpense(user.id, {
        description:    data.description,
        amount:         finalAmount,
        date:           data.date,
        payment_method: selectedPayment,
        category_id:    selectedCategory ?? undefined,
        notes:          notesWithFx,
        is_recurring:   false,
      });
      reset();
      setShowAddModal(false);
      setSelectedCategory(null);
      setCurrency('ARS');
      setIsShared(false);
      // Si el filtro activo no coincide con el mes del nuevo gasto, sincronizarlo
      // para que el gasto recién agregado sea visible inmediatamente.
      const [ey, em] = data.date.split('-').map(Number);
      if (filter.month !== em || filter.year !== ey) {
        setFilter({ month: em, year: ey });
      }
    } catch {
      Alert.alert('Error', 'No se pudo guardar el gasto. Intentá de nuevo.');
    }
  };

  const classificationFilter = filter.classification;

  const listHeader = (
    <>
      {/* Filtros de clasificación */}
      <View style={styles.filters}>
        {[
          { key: null, label: 'Todos' },
          { key: 'necessary', label: 'Necesario' },
          { key: 'disposable', label: 'Prescind.' },
          { key: 'investable', label: 'Invertible' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key ?? 'all'}
            style={[
              styles.filterChip,
              classificationFilter === f.key && styles.filterChipActive,
            ]}
            onPress={() => setFilter({ classification: f.key })}
          >
            <Text
              variant="label"
              style={{ fontSize: 9 }}
              color={classificationFilter === f.key ? colors.neon : colors.text.secondary}
              numberOfLines={1}
            >
              {f.label.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Resumen del mes */}
      <View style={styles.summaryCard}>
        <Text variant="caption" color={colors.text.tertiary}>TOTAL ESTE MES</Text>
        <Text variant="numberLg" color={colors.text.primary}>{formatCurrency(totalThisMonth)}</Text>

        {totalThisMonth > 0 && (
          <>
            {/* Barra de composición */}
            <View style={styles.compositionBar}>
              {totalNecessary  > 0 && <View style={[styles.barSlice, { flex: totalNecessary,  backgroundColor: colors.accent }]} />}
              {totalDisposable > 0 && <View style={[styles.barSlice, { flex: totalDisposable, backgroundColor: colors.red   }]} />}
              {totalInvestable > 0 && <View style={[styles.barSlice, { flex: totalInvestable, backgroundColor: colors.neon  }]} />}
            </View>

            {/* Métricas en fila */}
            <View style={styles.summaryMetrics}>
              {[
                { label: 'Necesario',    amount: totalNecessary,  color: colors.accent },
                { label: 'Prescindible', amount: totalDisposable, color: colors.red    },
                { label: 'Invertible',   amount: totalInvestable, color: colors.neon   },
              ].map((m) => (
                <View key={m.label} style={styles.metricItem}>
                  <View style={[styles.metricDot, { backgroundColor: m.color }]} />
                  <View style={{ gap: 1 }}>
                    <Text variant="caption" color={colors.text.tertiary}>{m.label}</Text>
                    <Text variant="labelMd" color={colors.text.primary}>{formatCurrency(m.amount)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* Aviso: token de Gmail vencido */}
      {gmailTokenExpired && (
        <View style={{ paddingHorizontal: layout.screenPadding, marginBottom: spacing[3] }}>
          <View style={styles.gmailExpiredBanner}>
            <Ionicons name="mail-unread-outline" size={16} color={colors.yellow} />
            <View style={{ flex: 1 }}>
              <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                Gmail desconectado
              </Text>
              <Text variant="caption" color={colors.text.secondary}>
                Tu conexión con Gmail venció. Reconectá tu cuenta para seguir importando gastos automáticamente.
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Transacciones detectadas en Gmail */}
      {(pendingTxs.length > 0 || isPolling) && (
        <View style={{ paddingHorizontal: layout.screenPadding, marginBottom: spacing[4] }}>
          <PendingTransactions
            transactions={pendingTxs}
            userId={user!.id}
            isPolling={isPolling}
            categories={categories}
            onConfirmed={() => {
              pollGmail();
              fetchExpenses(user!.id);
            }}
          />
        </View>
      )}

      {/* Búsqueda por texto */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar gastos..."
          placeholderTextColor={colors.text.tertiary}
          value={filter.search}
          onChangeText={(v) => setFilter({ search: v })}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!filter.search && (
          <TouchableOpacity onPress={() => setFilter({ search: '' })}>
            <Ionicons name="close-circle" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Suscripciones detectadas */}
      {subscriptions.length > 0 && (
        <TouchableOpacity
          style={styles.subsHeader}
          onPress={() => setShowSubscriptions(!showSubscriptions)}
          activeOpacity={0.7}
        >
          <View style={styles.subsHeaderLeft}>
            <Ionicons name="repeat-outline" size={16} color={colors.yellow} />
            <Text variant="label" color={colors.yellow}>
              {subscriptions.length} SUSCRIPCIÓN{subscriptions.length > 1 ? 'ES' : ''} DETECTADA{subscriptions.length > 1 ? 'S' : ''}
            </Text>
          </View>
          <Ionicons
            name={showSubscriptions ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.text.secondary}
          />
        </TouchableOpacity>
      )}

      {showSubscriptions && subscriptions.length > 0 && (
        <View style={styles.subsContainer}>
          {subscriptions.map((sub) => (
            <View key={sub.description} style={styles.subRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" color={colors.text.primary}>{sub.description}</Text>
                <Text variant="caption" color={colors.text.secondary}>
                  {sub.occurrences} veces en 90 días
                </Text>
              </View>
              <Text variant="labelMd" color={colors.yellow}>
                {formatCurrency(sub.averageAmount)}/mes
              </Text>
            </View>
          ))}
          <View style={styles.subsTotalRow}>
            <Text variant="label" color={colors.text.secondary}>TOTAL MENSUAL</Text>
            <Text variant="labelMd" color={colors.red}>
              {formatCurrency(subscriptions.reduce((s, sub) => s + sub.averageAmount, 0))}/mes
            </Text>
          </View>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Top bar fijo ── */}
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Text variant="h4">Mis Gastos</Text>
          <TouchableOpacity
            style={styles.screenshotBtn}
            onPress={pickAndProcessScreenshot}
            disabled={isProcessing}
          >
            {isProcessing
              ? <ActivityIndicator size="small" color={colors.neon} />
              : <Ionicons name="image-outline" size={20} color={colors.neon} />
            }
          </TouchableOpacity>
        </View>

        {/* Selector de mes */}
        <MonthSelector
          selected={{ month: filter.month ?? new Date().getMonth() + 1, year: filter.year ?? new Date().getFullYear() }}
          onSelect={(m, y) => setFilter({ month: m, year: y })}
        />

        {/* Segmented control */}
        <View style={styles.segTrack}>
          {([
            { key: 'gastos', label: 'Gastos',       icon: 'list-outline' },
            { key: 'stats',  label: 'Distribución', icon: 'pie-chart-outline' },
          ] as const).map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.segPill, activeTab === tab.key && styles.segPillActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons
                name={tab.icon}
                size={13}
                color={activeTab === tab.key ? colors.text.primary : colors.text.tertiary}
              />
              <Text
                variant="label"
                style={{ fontSize: 11 }}
                color={activeTab === tab.key ? colors.text.primary : colors.text.tertiary}
              >
                {tab.label.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Vista Estadísticas ── */}
      {activeTab === 'stats' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: layout.tabBarHeight + spacing[8], paddingTop: spacing[3] }}
          showsVerticalScrollIndicator={false}
        >
          {categoryRows.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: spacing[10], gap: spacing[4] }}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.border.default} />
              <Text variant="body" color={colors.text.tertiary} align="center">
                Sin gastos este mes para mostrar.
              </Text>
            </View>
          ) : (
            <View style={detStyles.card}>
              <View style={detStyles.cardHeader}>
                <Ionicons name="bar-chart-outline" size={14} color={colors.text.secondary} />
                <Text variant="label" color={colors.text.secondary}>DISTRIBUCIÓN POR CATEGORÍA</Text>
              </View>
              <CategoryBarChart rows={categoryRows} total={totalThisMonth} />
            </View>
          )}
        </ScrollView>
      ) : (

      <FlatList
        style={styles.flatList}
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} onPress={() => openEditExpense(item)} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={listHeader}
        onEndReached={() => { if (user?.id && hasMore) fetchMoreExpenses(user.id); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={isLoadingMore ? <ActivityIndicator size="small" color={colors.neon} style={{ paddingVertical: spacing[4] }} /> : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="wallet-outline" size={48} color={colors.text.tertiary} />
            <Text variant="body" color={colors.text.secondary} align="center">
              {isLoading ? 'Cargando...' : 'No hay gastos este mes.'}
            </Text>
          </View>
        }
      />
      )}

      {/* ── FAB agregar gasto ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
        <Ionicons name="add" size={26} color={colors.white} />
      </TouchableOpacity>

      {/* Modal agregar gasto */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modal}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">Nuevo gasto</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Controller
                control={control}
                name="description"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="¿EN QUÉ GASTASTE?"
                    placeholder="Ej: Almuerzo en el trabajo"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.description?.message}
                    autoCapitalize="sentences"
                  />
                )}
              />

              {/* Selector de moneda */}
              <View>
                <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>
                  MONEDA
                </Text>
                <View style={styles.currencyRow}>
                  {(['ARS', 'USD'] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.currencyChip, currency === c && styles.currencyChipActive]}
                      onPress={() => setCurrency(c)}
                    >
                      <Text
                        variant="label"
                        color={currency === c ? colors.neon : colors.text.secondary}
                      >
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Selector de tipo de dólar */}
                {currency === 'USD' && (
                  <View style={styles.dolarRow}>
                    {(['oficial', 'blue', 'mep'] as DolarType[]).map((t) => {
                      const rate = rates[t];
                      return (
                        <TouchableOpacity
                          key={t}
                          style={[styles.dolarChip, dolarType === t && styles.dolarChipActive]}
                          onPress={() => setDolarType(t)}
                        >
                          <Text
                            variant="caption"
                            color={dolarType === t ? colors.black : colors.text.secondary}
                          >
                            {dolarLabels[t]}
                          </Text>
                          <Text
                            variant="caption"
                            color={dolarType === t ? colors.black : colors.text.tertiary}
                          >
                            {rate ? `$${rate.toLocaleString('es-AR')}` : '...'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              <Controller
                control={control}
                name="amount"
                render={({ field: { onChange, onBlur, value } }) => {
                  const raw  = parseFloat(value.replace(',', '.'));
                  const rate = rates[dolarType];
                  const ars  = currency === 'USD' && rate && !isNaN(raw)
                    ? Math.round(raw * rate)
                    : null;

                  return (
                    <View>
                      <Input
                        label={currency === 'USD' ? 'MONTO (USD)' : 'MONTO (ARS)'}
                        placeholder="0"
                        value={value}
                        onChangeText={onChange}
                        onBlur={onBlur}
                        error={errors.amount?.message}
                        keyboardType="decimal-pad"
                        leftIcon={
                          <Text variant="body" color={colors.text.secondary}>
                            {currency === 'USD' ? 'U$D' : '$'}
                          </Text>
                        }
                      />
                      {ars !== null && (
                        <View style={styles.fxPreview}>
                          <Ionicons name="swap-horizontal" size={12} color={colors.text.tertiary} />
                          <Text variant="caption" color={colors.text.tertiary}>
                            = ${ars.toLocaleString('es-AR')} ARS al {dolarLabels[dolarType]}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                }}
              />

              {/* Categorías */}
              <View>
                <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>
                  CATEGORÍA
                </Text>
                <View style={styles.categoryGrid}>
                  {categories.map((cat) => {
                    const isActive = selectedCategory === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.categoryGridItem, isActive && { borderColor: cat.color, backgroundColor: cat.color + '1A' }]}
                        onPress={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={cat.icon as any}
                          size={20}
                          color={isActive ? cat.color : colors.text.tertiary}
                        />
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

              {/* Medio de pago */}
              <View>
                <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>
                  MEDIO DE PAGO
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.paymentList}
                >
                  {paymentMethods.map((pm) => (
                    <TouchableOpacity
                      key={pm.value}
                      style={[
                        styles.paymentChip,
                        selectedPayment === pm.value && styles.paymentChipActive,
                      ]}
                      onPress={() => setSelectedPayment(pm.value)}
                    >
                      <Text
                        variant="caption"
                        color={selectedPayment === pm.value ? colors.black : colors.text.secondary}
                      >
                        {pm.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <Controller
                control={control}
                name="notes"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="NOTA (opcional)"
                    placeholder="Cualquier detalle que quieras recordar"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    multiline
                    numberOfLines={2}
                    style={{ height: 80 }}
                  />
                )}
              />

              {/* Toggle gasto compartido — solo si está en modo pareja */}
              {inCoupleMode && (
                <TouchableOpacity
                  style={[styles.sharedToggle, isShared && styles.sharedToggleActive]}
                  onPress={() => setIsShared(!isShared)}
                >
                  <Ionicons
                    name={isShared ? 'heart' : 'heart-outline'}
                    size={18}
                    color={isShared ? colors.neon : colors.text.secondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="label" color={isShared ? colors.neon : colors.text.primary}>
                      GASTO COMPARTIDO
                    </Text>
                    <Text variant="caption" color={colors.text.secondary}>
                      Visible para tu pareja en el resumen conjunto
                    </Text>
                  </View>
                  <View style={[styles.toggleDot, isShared && styles.toggleDotActive]} />
                </TouchableOpacity>
              )}

              <Button
                label="GUARDAR GASTO"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isLoading}
                onPress={handleSubmit(onSubmit)}
                style={{ marginTop: spacing[4] }}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal editar gasto confirmado */}
      <Modal
        visible={!!editingExpense}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => { setEditingExpense(null); setEditExpenseValues(null); }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <SafeAreaView style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text variant="h4">Editar gasto</Text>
              <TouchableOpacity onPress={() => { setEditingExpense(null); setEditExpenseValues(null); }}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            {editExpenseValues && (
              <ScrollView
                contentContainerStyle={styles.modalScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Input
                  label="DESCRIPCIÓN"
                  value={editExpenseValues.description}
                  onChangeText={(v) => setEditExpenseValues((p) => p ? { ...p, description: v } : p)}
                  autoCapitalize="sentences"
                />

                <Input
                  label="MONTO (ARS)"
                  value={editExpenseValues.amount}
                  onChangeText={(v) => setEditExpenseValues((p) => p ? { ...p, amount: v } : p)}
                  keyboardType="decimal-pad"
                  leftIcon={<Text variant="body" color={colors.text.secondary}>$</Text>}
                />

                <Input
                  label="FECHA (YYYY-MM-DD)"
                  value={editExpenseValues.date}
                  onChangeText={(v) => setEditExpenseValues((p) => p ? { ...p, date: v } : p)}
                  keyboardType="numbers-and-punctuation"
                />

                {/* Clasificación */}
                <View>
                  <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>
                    CLASIFICACIÓN
                  </Text>
                  <View style={styles.classRow}>
                    {(['necessary', 'disposable', 'investable'] as ExpenseClassification[]).map((cls) => {
                      const active = editExpenseValues.classification === cls;
                      const label = cls === 'necessary' ? 'Necesario' : cls === 'disposable' ? 'Prescindible' : 'Invertible';
                      return (
                        <TouchableOpacity
                          key={cls}
                          style={[styles.classChip, active && styles.classChipActive]}
                          onPress={() => setEditExpenseValues((p) => p ? { ...p, classification: cls } : p)}
                        >
                          <Text variant="caption" color={active ? colors.neon : colors.text.secondary}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Categoría */}
                <View>
                  <Text variant="label" color={colors.text.secondary} style={styles.inputLabel}>
                    CATEGORÍA
                  </Text>
                  <View style={styles.categoryGrid}>
                    {categories.map((cat) => {
                      const isActive = editExpenseValues.category_id === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          style={[styles.categoryGridItem, isActive && { borderColor: cat.color, backgroundColor: cat.color + '1A' }]}
                          onPress={() => setEditExpenseValues((p) => p ? {
                            ...p,
                            category_id: p.category_id === cat.id ? null : cat.id,
                          } : p)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={cat.icon as any}
                            size={20}
                            color={isActive ? cat.color : colors.text.tertiary}
                          />
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

                <Button
                  label="GUARDAR CAMBIOS"
                  variant="neon"
                  size="lg"
                  fullWidth
                  isLoading={isSavingEdit}
                  onPress={handleSaveEdit}
                  style={{ marginTop: spacing[4] }}
                />

                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDeleteExpense(editingExpense!.id)}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.red} />
                  <Text variant="label" color={colors.red}>ELIMINAR GASTO</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const CLASSIFICATION_COLOR: Record<string, string> = {
  necessary:  colors.accent,
  disposable: colors.red,
  investable: colors.neon,
};

function ExpenseItem({ expense, onPress }: { expense: Expense; onPress: () => void }) {
  const accentColor =
    (expense.category as any)?.color ??
    (expense.classification ? CLASSIFICATION_COLOR[expense.classification] : colors.border.default);

  return (
    <PressableCard style={styles.expenseItem} onPress={onPress}>
      <View style={[styles.expenseAccent, { backgroundColor: accentColor }]} />
      <View style={styles.expenseRow}>
        <View style={styles.expenseLeft}>
          <Text variant="bodySmall" color={colors.text.primary} numberOfLines={1}>
            {expense.description}
          </Text>
          <View style={styles.expenseMeta}>
            <Text variant="caption" color={colors.text.tertiary}>{formatDate(expense.date)}</Text>
            {expense.category && (
              <>
                <Text variant="caption" color={colors.text.tertiary}> · </Text>
                <Text variant="caption" color={colors.text.tertiary}>{expense.category.name_es}</Text>
              </>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="labelMd" color={colors.text.primary}>
            {formatCurrency(expense.amount)}
          </Text>
          {expense.classification && (
            <Badge classification={expense.classification} label={expense.classification} small />
          )}
        </View>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.bg.primary },
  flatList: { flex: 1 },

  // ── Top bar fijo ──
  topBar: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[3],
    paddingBottom:     spacing[3],
    gap:               spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    backgroundColor:   colors.bg.primary,
  },
  topBarRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  screenshotBtn: {
    width:          36,
    height:         36,
    borderWidth:    1,
    borderColor:    colors.border.default,
    borderRadius:   18,
    alignItems:     'center',
    justifyContent: 'center',
  },

  // ── Segmented control ──
  segTrack: {
    flexDirection:   'row',
    backgroundColor: colors.bg.secondary,
    borderRadius:    12,
    padding:         3,
    gap:             3,
  },
  segPill: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[1],
    paddingVertical: spacing[2],
    borderRadius:   10,
  },
  segPillActive: {
    backgroundColor: colors.bg.primary,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.08,
    shadowRadius:    2,
    elevation:       2,
  },

  // ── FAB ──
  fab: {
    position:        'absolute',
    bottom:          layout.tabBarHeight + spacing[4],
    right:           layout.screenPadding,
    width:           52,
    height:          52,
    borderRadius:    26,
    backgroundColor: colors.neon,
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     colors.neon,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.35,
    shadowRadius:    8,
    elevation:       6,
  },

  // ── Summary card ──
  summaryCard: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[3],
    marginBottom:     spacing[2],
    padding:          spacing[5],
    backgroundColor:  colors.bg.card,
    borderWidth:      1,
    borderColor:      colors.border.default,
    borderRadius:     12,
    gap:              spacing[3],
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.05,
    shadowRadius:     3,
    elevation:        1,
  },
  gmailExpiredBanner: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing[3],
    backgroundColor: colors.yellow + '12',
    borderWidth:     1,
    borderColor:     colors.yellow + '30',
    borderRadius:    10,
    padding:         spacing[3],
  },
  compositionBar: {
    flexDirection: 'row',
    height:        6,
    borderRadius:  3,
    overflow:      'hidden',
    gap:           2,
  },
  barSlice: { height: '100%', borderRadius: 3 },
  summaryMetrics: {
    flexDirection: 'row',
    gap:           spacing[4],
  },
  metricItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  metricDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing[3],
    gap: spacing[1],
  },
  searchRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[2],
    marginHorizontal:  layout.screenPadding,
    marginBottom:      spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
    borderWidth:       1,
    borderColor:       colors.border.default,
    backgroundColor:   colors.bg.elevated,
  },
  searchInput: {
    flex:       1,
    color:      colors.text.primary,
    fontSize:   14,
    fontFamily: 'DMSans_400Regular',
    paddingVertical: spacing[1],
  },
  filterChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A',
  },
  list: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: layout.tabBarHeight + spacing[4],
    gap: spacing[2],
  },
  empty: {
    paddingVertical: spacing[16],
    alignItems: 'center',
    gap: spacing[4],
  },
  expenseItem: { padding: 0, overflow: 'hidden', flexDirection: 'row' },
  expenseAccent: { width: 3, alignSelf: 'stretch' },
  expenseRow: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'space-between',
    padding:       spacing[4],
    gap:           spacing[3],
  },
  expenseLeft: { flex: 1, gap: spacing[1] },
  expenseMeta: { flexDirection: 'row', alignItems: 'center' },
  subsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.yellow + '33',
    backgroundColor: colors.yellow + '0A',
  },
  subsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  subsContainer: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: colors.yellow + '33',
    backgroundColor: colors.bg.card,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  subsTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  // Modal
  modal: { flex: 1, backgroundColor: colors.bg.primary },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  modalScroll: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing[6],
    gap: spacing[5],
    paddingBottom: spacing[12],
  },
  inputLabel: { marginBottom: spacing[2] },
  categoryList: { gap: spacing[2] },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  categoryGridItem: {
    width: '22%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 10,
  },
  categoryChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  categoryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A',
  },
  paymentList: { gap: spacing[2] },
  paymentChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 20,
  },
  paymentChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },

  // Multi-moneda
  currencyRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  currencyChip: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  currencyChipActive: {
    borderColor: colors.neon,
    backgroundColor: colors.neon + '15',
  },
  dolarRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  dolarChip: {
    flex: 1,
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  dolarChipActive: {
    borderColor: colors.neon,
    backgroundColor: colors.neon,
  },
  fxPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
    paddingHorizontal: spacing[1],
  },
  classRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  classChip: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: spacing[2],
    borderWidth:     1,
    borderColor:     colors.border.default,
  },
  classChipActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '15',
  },
  deleteBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    paddingVertical: spacing[3],
    borderWidth:     1,
    borderColor:     colors.red,
  },
  sharedToggle: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[3],
    padding:         spacing[4],
    borderWidth:     1,
    borderColor:     colors.border.default,
    backgroundColor: colors.bg.elevated,
  },
  sharedToggleActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '11',
  },
  toggleDot: {
    width:           20,
    height:          20,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     colors.border.default,
    backgroundColor: colors.bg.primary,
  },
  toggleDotActive: {
    backgroundColor: colors.neon,
    borderColor:     colors.neon,
  },
});
