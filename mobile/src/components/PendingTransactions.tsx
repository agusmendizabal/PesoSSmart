import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  Modal,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { CategoryIcon } from '@/components/CategoryIcon';
import { supabase as _supabase } from '@/lib/supabase';
const supabase = _supabase as any;
import { matchDebt } from '@/lib/debtMatcher';
import type { ExpenseCategory, ExpenseClassification } from '@/types';

// Design tokens
const G  = '#27AE60';
const CR = 20; // card border radius

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingTransaction {
  id: string;
  amount: number;
  currency: string;
  merchant: string | null;
  suggested_category: string | null;
  suggested_classification: 'necessary' | 'disposable' | 'investable' | null;
  description: string | null;
  transaction_date: string | null;
  source: string | null;
}

interface ConfirmedExpense {
  amount: number;
  date: string;
  description: string | null;
}

interface Props {
  transactions: PendingTransaction[];
  userId: string;
  isPolling?: boolean;
  categories: ExpenseCategory[];
  onConfirmed: () => void;
  confirmedExpenses?: ConfirmedExpense[];
}

const INITIAL_VISIBLE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date  = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function isPossibleDuplicate(tx: PendingTransaction, confirmed: ConfirmedExpense[]): boolean {
  if (!confirmed || confirmed.length === 0) return false;
  return confirmed.some(exp => {
    const amountClose = Math.abs(exp.amount - tx.amount) / Math.max(tx.amount, 1) < 0.05;
    if (!amountClose) return false;
    if (!tx.transaction_date || !exp.date) return amountClose;
    const dayDiff = Math.abs(
      new Date(tx.transaction_date).getTime() - new Date(exp.date).getTime()
    ) / 86400000;
    return dayDiff <= 3;
  });
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function AnimatedEmptyState() {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 14 }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[st.emptyState, { opacity }]}>
      <Animated.View style={[st.emptyIcon, { transform: [{ scale }] }]}>
        <Ionicons name="checkmark-circle" size={32} color={G} />
      </Animated.View>
      <Text style={st.emptyTitle}>¡Todo clasificado!</Text>
      <Text style={st.emptySub}>No tenés gastos pendientes por revisar.</Text>
    </Animated.View>
  );
}

// ─── SourceBadge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const label = source === 'mercadopago' ? 'Mercado Pago'
    : source === 'gmail' ? 'Gmail'
    : source;
  const color = source === 'mercadopago' ? '#009EE3'
    : source === 'gmail' ? '#EA4335'
    : '#9B9790';
  return (
    <View style={[sbS.pill, { backgroundColor: color + '1A' }]}>
      <View style={[sbS.dot, { backgroundColor: color }]} />
      <Text style={[sbS.label, { color }]}>{label}</Text>
    </View>
  );
}

const sbS = StyleSheet.create({
  pill:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  dot:   { width: 5, height: 5, borderRadius: 3 },
  label: { fontSize: 10, fontFamily: 'Montserrat_600SemiBold' },
});

// ─── CategorizarSheet ─────────────────────────────────────────────────────────

function CategorizarSheet({
  tx,
  categories,
  onSelect,
  onClose,
  onReject,
  isSaving,
}: {
  tx:         PendingTransaction;
  categories: ExpenseCategory[];
  onSelect:   (cat: ExpenseCategory, classification: string, description: string) => void;
  onClose:    () => void;
  onReject:   () => void;
  isSaving:   boolean;
}) {
  const suggestedCat   = categories.find(c => c.name === tx.suggested_category);
  const [selectedCat,   setSelectedCat]   = useState<string | null>(suggestedCat?.id ?? null);
  const [selectedClass, setSelectedClass] = useState<string | null>(tx.suggested_classification ?? null);
  const [catSearch,     setCatSearch]     = useState('');
  const [description,   setDescription]  = useState(tx.merchant ?? tx.description ?? '');
  const looksLikeTransfer = /transfer/i.test((tx.merchant ?? '') + ' ' + (tx.description ?? ''));

  const canConfirm = !!selectedCat && !!selectedClass && !isSaving;
  const searchLow  = catSearch.toLowerCase();
  const filteredCats = catSearch.trim()
    ? categories.filter(c => c.name_es?.toLowerCase().includes(searchLow))
    : categories;

  const handleConfirm = () => {
    const cat = categories.find(c => c.id === selectedCat);
    if (cat && selectedClass) {
      hapticMedium();
      onSelect(cat, selectedClass, description.trim() || tx.merchant || tx.description || 'Gasto detectado');
    }
  };

  return (
    <View style={sh.outerWrap}>
      <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
      <SafeAreaView style={sh.sheet} edges={['bottom']}>
        <View style={sh.dragBar} />
        <View style={sh.header}>
          <Text style={sh.headerTitle}>Clasificar gasto</Text>
          <TouchableOpacity onPress={onClose} style={sh.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color="#1A1A1A" />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={sh.scroll}>

          <View style={sh.aiBanner}>
            <View style={sh.aiBadge}>
              <Text style={sh.aiBadgeText}>🤖  Asistente inteligente</Text>
            </View>
            <Text style={sh.aiSubtitle}>
              {suggestedCat
                ? `Sugerimos "${suggestedCat.name_es}" para este gasto.`
                : 'Seleccioná la categoría y tipo de gasto.'}
            </Text>
          </View>

          <View style={sh.expenseCard}>
            <View style={sh.expenseIconWrap}>
              <CategoryIcon description={tx.merchant ?? tx.description ?? ''} size={44} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={sh.expenseName} numberOfLines={1}>{tx.merchant ?? 'Gasto detectado'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {tx.transaction_date && <Text style={sh.expenseMeta}>{formatDateLabel(tx.transaction_date)}</Text>}
                <SourceBadge source={tx.source} />
              </View>
            </View>
            <Text style={sh.expenseAmount}>${tx.amount.toLocaleString('es-AR')}</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={sh.sectionTitle}>Descripción</Text>
            <TextInput
              style={sh.descInput}
              value={description}
              onChangeText={setDescription}
              placeholder="Ej: Pelota de fútbol, Spotify, Alquiler..."
              placeholderTextColor="#9CA3AF"
              maxLength={80}
              returnKeyType="done"
            />
            {looksLikeTransfer && (
              <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' }}>
                Contá a quién se lo transferiste o para qué fue, así después sabés de dónde salió este gasto.
              </Text>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <Text style={sh.sectionTitle}>Tipo de gasto</Text>
            <View style={sh.typeRow}>
              {([
                { key: 'necessary',  label: 'Necesario',    icon: 'shield-checkmark-outline', color: '#27AE60', bg: '#D1F7E3', border: '#27AE60' },
                { key: 'disposable', label: 'Prescindible', icon: 'cart-outline',              color: '#DC2626', bg: '#FEF2F2', border: '#EF4444' },
                { key: 'investable', label: 'Invertible',   icon: 'trending-up-outline',       color: '#27AE60', bg: '#D1F7E3', border: '#27AE60' },
              ] as const).map(opt => {
                const active = selectedClass === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[sh.typeBtn, active ? { backgroundColor: opt.bg, borderColor: opt.border } : sh.typeBtnOff]}
                    onPress={() => { setSelectedClass(opt.key); hapticLight(); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={opt.icon} size={20} color={active ? opt.color : '#9B9790'} />
                    <Text style={[sh.typeBtnLabel, { color: active ? opt.color : '#9B9790' }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {suggestedCat && (
            <View style={{ gap: 12 }}>
              <Text style={sh.sectionTitle}>Sugerencia ✨</Text>
              <View style={sh.matchCard}>
                <TouchableOpacity
                  style={[sh.matchRow, selectedCat === suggestedCat.id && sh.matchRowActive]}
                  onPress={() => { setSelectedCat(prev => prev === suggestedCat.id ? null : suggestedCat.id); hapticLight(); }}
                  activeOpacity={0.75}
                >
                  <Text style={sh.matchRank}>1</Text>
                  <CategoryIcon categoryName={suggestedCat.name_es} size={30} />
                  <Text style={sh.matchName} numberOfLines={1}>{suggestedCat.name_es}</Text>
                  <Text style={sh.matchPct}>IA match</Text>
                  {selectedCat === suggestedCat.id
                    ? <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                    : <View style={{ width: 18 }} />
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ gap: 12 }}>
            <Text style={sh.sectionTitle}>Todas las categorías</Text>
            <View style={sh.searchRow}>
              <Ionicons name="search-outline" size={16} color="#9CA3AF" />
              <TextInput
                style={sh.searchInput}
                placeholder="Buscar categoría"
                placeholderTextColor="#9CA3AF"
                value={catSearch}
                onChangeText={setCatSearch}
              />
            </View>
            <View style={sh.catList}>
              {filteredCats.map((cat, i) => {
                const isActive = selectedCat === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[sh.catRow, i < filteredCats.length - 1 && sh.catRowBorder, isActive && sh.catRowActive]}
                    onPress={() => { setSelectedCat(prev => prev === cat.id ? null : cat.id); hapticLight(); }}
                    activeOpacity={0.75}
                  >
                    <View style={[sh.catIconWrap, { backgroundColor: (cat.color ?? '#27AE60') + '20' }]}>
                      <CategoryIcon categoryName={cat.name_es} size={26} />
                    </View>
                    <Text style={[sh.catName, isActive && { color: '#1C1C1C', fontFamily: 'Montserrat_600SemiBold' }]} numberOfLines={1}>
                      {cat.name_es}
                    </Text>
                    {isActive
                      ? <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      : <Ionicons name="chevron-forward"  size={16} color="#D1D5DB" />
                    }
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={{ height: 16 }} />
        </ScrollView>

        <View style={sh.bottomBar}>
          <TouchableOpacity
            style={[sh.ctaBtn, !canConfirm && { opacity: 0.45 }]}
            onPress={handleConfirm}
            disabled={!canConfirm}
            activeOpacity={0.87}
          >
            {isSaving
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={sh.ctaBtnText}>
                    {!selectedClass ? 'Elegí el tipo de gasto' : !selectedCat ? 'Elegí una categoría' : 'Clasificar gasto'}
                  </Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const sh = StyleSheet.create({
  outerWrap:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '92%' },
  dragBar:      { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E8E2D9', alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 20, color: '#1C1C1C' },
  closeBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center' },
  scroll:       { paddingHorizontal: 20, paddingBottom: 12, gap: 20 },
  aiBanner:     { gap: 8 },
  aiBadge:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#D1F7E3', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start' },
  aiBadgeText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#27AE60' },
  aiSubtitle:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#6D6A63', lineHeight: 19 },
  expenseCard:     { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 4, borderWidth: 1, borderColor: '#F5F1E9' },
  expenseIconWrap: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FAFAF7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  expenseName:     { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#27AE60' },
  expenseMeta:     { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9B9790' },
  expenseAmount:   { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C', flexShrink: 0 },
  descInput:    { backgroundColor: '#FAFAF7', borderWidth: 1, borderColor: '#E8E2D9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#1C1C1C' },
  sectionTitle: { fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: '#1C1C1C' },
  typeRow:      { flexDirection: 'row', gap: 8 },
  typeBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5 },
  typeBtnOff:   { backgroundColor: '#FFFFFF', borderColor: '#E8E2D9' },
  typeBtnLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12 },
  matchCard:      { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: '#F5F1E9' },
  matchRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  matchRowActive: { backgroundColor: '#D1F7E3' },
  matchRank:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#9B9790', width: 16 },
  matchName:      { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },
  matchPct:       { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#27AE60' },
  searchRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F5F1E9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  searchInput:  { flex: 1, fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#1C1C1C', paddingVertical: 0 },
  catList:      { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: '#F5F1E9' },
  catRow:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 16 },
  catRowBorder: { borderBottomWidth: 1, borderBottomColor: '#FAFAF7' },
  catRowActive: { backgroundColor: '#D1F7E3' },
  catIconWrap:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  catName:      { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },
  bottomBar:    { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F5F1E9' },
  ctaBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#27AE60', borderRadius: 16, paddingVertical: 17, shadowColor: '#27AE60', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5 },
  ctaBtnText:   { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#FFFFFF', letterSpacing: 0.2 },
});

// ─── AnimatedTxCard ───────────────────────────────────────────────────────────

interface AnimatedTxCardProps {
  tx: PendingTransaction;
  index: number;
  children: React.ReactNode;
}

export interface AnimatedTxCardHandle {
  animateOut: (direction: 'left' | 'right', callback: () => void) => void;
}

const AnimatedTxCard = forwardRef<AnimatedTxCardHandle, AnimatedTxCardProps>(
  ({ index, children }, ref) => {
    const mountOpacity    = useRef(new Animated.Value(0)).current;
    const mountTranslateY = useRef(new Animated.Value(14)).current;
    const exitOpacity     = useRef(new Animated.Value(1)).current;
    const translateX      = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(mountOpacity,    { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.spring(mountTranslateY, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 4 }),
        ]).start();
      }, index * 70);
      return () => clearTimeout(timer);
    }, []);

    const animateOut = useCallback((direction: 'left' | 'right', callback: () => void) => {
      Animated.parallel([
        Animated.timing(exitOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateX,  { toValue: direction === 'right' ? 300 : -300, duration: 220, useNativeDriver: true }),
      ]).start(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        callback();
      });
    }, []);

    useImperativeHandle(ref, () => ({ animateOut }), [animateOut]);

    return (
      <Animated.View style={{ opacity: mountOpacity, transform: [{ translateY: mountTranslateY }] }}>
        <Animated.View style={{ opacity: exitOpacity, transform: [{ translateX }] }}>
          {children}
        </Animated.View>
      </Animated.View>
    );
  }
);

// ─── PendingTransactions ──────────────────────────────────────────────────────

export function PendingTransactions({
  transactions,
  userId,
  isPolling,
  categories,
  onConfirmed,
  confirmedExpenses = [],
}: Props) {
  const [dismissedIds,     setDismissedIds]     = useState<Set<string>>(new Set());
  const [dismissedDupeIds, setDismissedDupeIds] = useState<Set<string>>(new Set());
  const [updatingId,       setUpdatingId]        = useState<string | null>(null);
  const [activeTxId,       setActiveTxId]        = useState<string | null>(null);
  const [showAll,          setShowAll]           = useState(false);
  const [bulkLoading,      setBulkLoading]       = useState(false);

  const [displayedToast, setDisplayedToast] = useState<string | null>(null);
  const toastAnim       = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs        = useRef<Record<string, AnimatedTxCardHandle | null>>({});

  const filtered    = transactions.filter(tx => !dismissedIds.has(tx.id));
  const visible     = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const hiddenCount = filtered.length - INITIAL_VISIBLE;
  const activeTx    = filtered.find(tx => tx.id === activeTxId) ?? null;

  const withSuggestion = filtered.filter(
    tx => tx.suggested_category && categories.some(c => c.name === tx.suggested_category)
  );

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setDisplayedToast(msg);
    toastAnim.setValue(0);
    Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setDisplayedToast(null));
    }, 1800);
  };

  if (filtered.length === 0 && !isPolling) return <AnimatedEmptyState />;

  // ── Clasificar ────────────────────────────────────────────────────────────

  const confirmTx = async (tx: PendingTransaction, cat: ExpenseCategory, classification: string, description: string) => {
    if (updatingId !== null) return;
    setUpdatingId(tx.id);
    setActiveTxId(null);
    try {
      const txDate = tx.transaction_date ?? new Date().toISOString().split('T')[0];

      const { data: existing } = await supabase
        .from('expenses')
        .select('id')
        .eq('source_pending_id', tx.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase.from('expenses').update({
          description,
          category_id:    cat.id,
          classification: classification as ExpenseClassification,
        }).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('expenses').insert({
          user_id:        userId,
          amount:         tx.amount,
          description,
          category_id:    cat.id,
          date:           txDate,
          payment_method: 'digital_wallet',
          classification: classification as ExpenseClassification,
          is_recurring:   false,
        });
        if (error) throw new Error(error.message);
      }

      await supabase.from('pending_transactions').update({ status: 'confirmed' }).eq('id', tx.id);

      showToast('✓ Gasto clasificado');
      const cardRef = cardRefs.current[tx.id];
      if (cardRef) {
        cardRef.animateOut('right', () => {
          setDismissedIds(prev => new Set([...prev, tx.id]));
          onConfirmed();
          checkOutgoingDebtMatch(tx.amount);
        });
      } else {
        setDismissedIds(prev => new Set([...prev, tx.id]));
        onConfirmed();
        checkOutgoingDebtMatch(tx.amount);
      }
    } catch {
      Alert.alert('Error', 'No se pudo clasificar el gasto. Intentá de nuevo.');
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Chequear si el gasto era un pago de deuda ─────────────────────────────

  const checkOutgoingDebtMatch = async (amount: number) => {
    const { data: groupMemberships } = await supabase
      .from('family_members')
      .select('group_id, family_groups(group_type)')
      .eq('user_id', userId);

    const friendsGroups = (groupMemberships ?? []).filter(
      (m: any) => m.family_groups?.group_type === 'friends',
    );
    if (!friendsGroups.length) return;

    for (const membership of friendsGroups) {
      const groupId = membership.group_id;

      const { data: groupMembers } = await supabase
        .from('family_members')
        .select('user_id, profiles(full_name)')
        .eq('group_id', groupId)
        .neq('user_id', userId);

      const { data: groupExpenses } = await supabase
        .from('group_expenses')
        .select('id, paid_by')
        .eq('group_id', groupId);

      if (!groupExpenses?.length) continue;

      const othersExpenseIds = (groupExpenses as any[])
        .filter((e: any) => e.paid_by !== userId)
        .map((e: any) => e.id);
      if (!othersExpenseIds.length) continue;

      const { data: splits } = await supabase
        .from('group_expense_splits')
        .select('id, user_id, amount')
        .in('group_expense_id', othersExpenseIds)
        .eq('user_id', userId)
        .eq('settled', false);

      if (!splits?.length) continue;

      const members     = (groupMembers ?? []).map((m: any) => ({ userId: m.user_id, fullName: m.profiles?.full_name ?? m.user_id }));
      const splitsMapped = (splits as any[]).map((s: any) => ({ id: s.id, amount: Number(s.amount), debtorUserId: s.user_id }));
      const matches = matchDebt(amount, null, members, splitsMapped);
      const match   = matches[0];
      if (!match) continue;

      const { data: groupData } = await supabase.from('family_groups').select('name').eq('id', groupId).single();
      const groupName = groupData?.name ?? 'el grupo';
      const debtAmt   = match.debtAmount.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });

      Alert.alert(
        '¿Pagaste una deuda?',
        `Este monto coincide con tu deuda de ${debtAmt} en ${groupName}.`,
        [
          { text: 'Sí, saldar', onPress: async () => { await supabase.from('group_expense_splits').update({ settled: true }).in('id', match.splitIds); } },
          { text: 'No', style: 'cancel' },
        ],
      );
      break;
    }
  };

  // ── Rechazar (silencioso, sin UI) ─────────────────────────────────────────

  const rejectTx = async (txId: string) => {
    if (updatingId !== null) return;
    setUpdatingId(txId);
    try {
      const { data: linkedExpense } = await supabase.from('expenses').select('id').eq('source_pending_id', txId).is('deleted_at', null).maybeSingle();
      if (linkedExpense) {
        const { data: hasGroup } = await supabase.rpc('expense_has_group_link', { p_expense_id: linkedExpense.id });
        if (!hasGroup) await supabase.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', linkedExpense.id);
      }
      await supabase.from('pending_transactions').update({ status: 'rejected' }).eq('id', txId);
      setDismissedIds(prev => new Set([...prev, txId]));
      onConfirmed();
    } catch {
      Alert.alert('Error', 'No se pudo rechazar el gasto.');
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Bulk confirm ──────────────────────────────────────────────────────────

  const handleBulkConfirm = async () => {
    if (bulkLoading || withSuggestion.length === 0) return;
    hapticMedium();
    setBulkLoading(true);
    try {
      for (const tx of withSuggestion) {
        const cat = categories.find(c => c.name === tx.suggested_category);
        const cls = tx.suggested_classification ?? 'disposable';
        if (cat) await confirmTx(tx, cat, cls, tx.merchant || tx.description || 'Gasto detectado');
      }
    } finally {
      setBulkLoading(false);
      onConfirmed();
    }
  };

  return (
    <View style={st.container}>

      {/* Bulk action card — premium AI module */}
      {withSuggestion.length >= 2 && (
        <TouchableOpacity
          style={[st.bulkCard, bulkLoading && { opacity: 0.6 }]}
          onPress={handleBulkConfirm}
          disabled={bulkLoading}
          activeOpacity={0.88}
        >
          {/* Decorative sparkles (absolute, non-interactive) */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Text style={st.sparkleA}>✦</Text>
            <Text style={st.sparkleB}>✦</Text>
            <Text style={st.sparkleC}>✦</Text>
          </View>
          <View style={st.bulkCardInner}>
            <View style={st.bulkIconCircle}>
              {bulkLoading
                ? <ActivityIndicator size="small" color={G} />
                : <Ionicons name="sparkles" size={24} color={G} />
              }
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <View style={st.bulkAiBadge}>
                <Text style={st.bulkAiBadgeText}>✨  IA sugiere</Text>
              </View>
              <Text style={st.bulkTitle}>
                {bulkLoading ? 'Clasificando...' : `Clasificá ${withSuggestion.length} con categoría sugerida`}
              </Text>
              <Text style={st.bulkSub}>Te ahorra tiempo y te mantiene organizado.</Text>
            </View>
            <View style={st.bulkArrow}>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* Section header */}
      <View style={st.sectionHeader}>
        <Text style={st.sectionTitle}>Gastos sin clasificar ({filtered.length})</Text>
        <TouchableOpacity style={st.ordenarBtn} activeOpacity={0.7}>
          <Text style={st.ordenarText}>Ordenar</Text>
          <Ionicons name="options-outline" size={14} color={G} />
        </TouchableOpacity>
      </View>

      {/* Cards */}
      {visible.map((tx, index) => {
        const dateLabel    = formatDateLabel(tx.transaction_date);
        const suggestedCat = categories.find(c => c.name === tx.suggested_category);
        const isLoading    = updatingId === tx.id;
        const isDuplicate  = isPossibleDuplicate(tx, confirmedExpenses);

        return (
          <AnimatedTxCard key={tx.id} tx={tx} index={index} ref={(ref) => { cardRefs.current[tx.id] = ref; }}>
            <TouchableOpacity
              style={st.card}
              onPress={() => !isLoading && setActiveTxId(tx.id)}
              disabled={isLoading}
              activeOpacity={0.92}
            >
              <View style={st.cardBody}>
                {isDuplicate && !dismissedDupeIds.has(tx.id) && (
                  <View style={st.dupeBanner}>
                    <Ionicons name="warning-outline" size={12} color="#E65100" />
                    <Text style={st.dupeText} numberOfLines={1}>Puede estar repetido — monto y fecha similares</Text>
                    <TouchableOpacity onPress={() => setDismissedDupeIds(prev => new Set([...prev, tx.id]))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={13} color="#E65100" />
                    </TouchableOpacity>
                  </View>
                )}

                <View style={st.cardMain}>
                  <View style={[st.iconCircle, suggestedCat?.color ? { backgroundColor: suggestedCat.color + '1A' } : null]}>
                    <CategoryIcon description={tx.merchant ?? tx.description ?? ''} size={28} />
                  </View>
                  <View style={st.cardInfo}>
                    <Text style={st.merchantName} numberOfLines={1}>
                      {tx.merchant ?? 'Comercio desconocido'}
                    </Text>
                    <View style={st.metaRow}>
                      <SourceBadge source={tx.source} />
                      {dateLabel && <Text style={st.dateLabel}>{dateLabel}</Text>}
                    </View>
                    {suggestedCat && (
                      <View style={st.suggestPill}>
                        <Ionicons name="sparkles-outline" size={10} color={G} />
                        <Text style={st.suggestText}>
                          Sugerido: <Text style={st.suggestBold}>{suggestedCat.name_es}</Text>
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={st.cardRight}>
                    {isLoading
                      ? <ActivityIndicator size="small" color={G} />
                      : <Text style={st.amount}>${tx.amount.toLocaleString('es-AR')}</Text>
                    }
                    <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                  </View>
                </View>

                <View style={st.clasificarRow}>
                  <Ionicons name="pricetag-outline" size={14} color={G} />
                  <Text style={st.clasificarText}>Clasificar</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={st.clasificarSparkle}>✦</Text>
                </View>
              </View>
            </TouchableOpacity>
          </AnimatedTxCard>
        );
      })}

      {!showAll && hiddenCount > 0 && (
        <TouchableOpacity style={st.showMoreBtn} onPress={() => setShowAll(true)}>
          <Text style={st.showMoreText}>Ver {hiddenCount} más</Text>
          <Ionicons name="chevron-down" size={14} color={G} />
        </TouchableOpacity>
      )}
      {showAll && filtered.length > INITIAL_VISIBLE && (
        <TouchableOpacity style={st.showMoreBtn} onPress={() => setShowAll(false)}>
          <Text style={st.showMoreText}>Mostrar menos</Text>
          <Ionicons name="chevron-up" size={14} color="#9CA3AF" />
        </TouchableOpacity>
      )}

      {/* Modal categorización */}
      <Modal visible={!!activeTx} transparent animationType="slide" onRequestClose={() => setActiveTxId(null)}>
        {activeTx && (
          <CategorizarSheet
            tx={activeTx}
            categories={categories}
            onSelect={(cat, classification, description) => confirmTx(activeTx, cat, classification, description)}
            onClose={() => setActiveTxId(null)}
            onReject={() => { setActiveTxId(null); rejectTx(activeTx.id); }}
            isSaving={updatingId === activeTx.id}
          />
        )}
      </Modal>

      {displayedToast && (
        <Animated.View
          style={[st.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
          pointerEvents="none"
        >
          <Ionicons
            name={displayedToast.includes('clasificado') ? 'checkmark-circle' : 'close-circle'}
            size={15}
            color={displayedToast.includes('clasificado') ? G : colors.red}
          />
          <Text style={[st.toastText, { color: displayedToast.includes('clasificado') ? G : colors.red }]}>
            {displayedToast}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { gap: spacing[3] },

  emptyState: { alignItems: 'center', gap: spacing[3], paddingVertical: spacing[10] },
  emptyIcon:  { width: 72, height: 72, borderRadius: 36, backgroundColor: G + '14', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C' },
  emptySub:   { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#9B9790', textAlign: 'center' },

  // Bulk action card — premium AI module
  bulkCard:       { borderRadius: CR, overflow: 'hidden', backgroundColor: G + '0A', borderWidth: 1, borderColor: G + '28', shadowColor: G, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  bulkCardInner:  { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  bulkIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', flexShrink: 0, shadowColor: G, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 },
  bulkAiBadge:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', borderWidth: 1, borderColor: G + '28' },
  bulkAiBadgeText:{ fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: G, letterSpacing: 0.2 },
  bulkTitle:      { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C', lineHeight: 20 },
  bulkSub:        { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 17 },
  bulkArrow:      { width: 38, height: 38, borderRadius: 19, backgroundColor: G, alignItems: 'center', justifyContent: 'center', flexShrink: 0, shadowColor: G, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  sparkleA:       { position: 'absolute', top: 10, right: 52, fontSize: 12, color: G, opacity: 0.45 },
  sparkleB:       { position: 'absolute', top: 4,  right: 26, fontSize: 8,  color: G, opacity: 0.28 },
  sparkleC:       { position: 'absolute', bottom: 12, right: 40, fontSize: 7, color: G, opacity: 0.22 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#1C1C1C' },
  ordenarBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ordenarText:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: G },

  // Transaction card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: CR,
    overflow: 'hidden',
    shadowColor: '#1C1C1C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E8E2D9',
  },
  cardBody:     { padding: 14, gap: 10 },
  cardMain:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle:   { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  cardInfo:     { flex: 1, gap: 3 },
  merchantName: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C', letterSpacing: -0.2 },
  metaRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dateLabel:    { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' },
  suggestPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: G + '14', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
  suggestText:  { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#1C1C1C' },
  suggestBold:  { fontFamily: 'Montserrat_700Bold', color: '#1F8C4F' },
  cardRight:    { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  amount:       { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: '#1C1C1C', letterSpacing: -0.4 },

  clasificarRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#D1F7E3', borderWidth: 1.5, borderColor: '#27AE60', borderRadius: 12 },
  clasificarText:    { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: G },
  clasificarSparkle: { fontSize: 11, color: G, opacity: 0.55 },

  dupeBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFBEB', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#E8E2D9' },
  dupeText:   { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 11, color: '#F59E0B' },

  showMoreBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12 },
  showMoreText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: G },

  toast:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2], alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: spacing[4], paddingVertical: spacing[2], shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12, elevation: 6, marginTop: spacing[2] },
  toastText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13 },
});
