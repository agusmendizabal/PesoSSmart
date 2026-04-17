import React, { useState } from 'react';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { ExpenseCategory } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PendingTransaction {
  id: string;
  amount: number;
  currency: string;
  merchant: string | null;
  suggested_category: string | null;
  suggested_classification: 'necessary' | 'disposable' | 'investable' | null;
  description: string | null;
  transaction_date: string | null;
}

interface Props {
  transactions: PendingTransaction[];
  userId: string;
  isPolling?: boolean;
  categories: ExpenseCategory[];
  onConfirmed: () => void;
}

const INITIAL_VISIBLE = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MovementType = 'enviada' | 'recibida' | 'pago' | 'compra' | 'otro';

interface TxMeta {
  type:  MovementType;
  label: string;
  via:   string | null;
  color: string;
  icon:  string;
}

function parseTxMeta(description: string | null, currency: string): TxMeta {
  const d = (description ?? '').toLowerCase();
  if (d.includes('enviada')) {
    return { type: 'enviada', label: 'Enviada', via: extractVia(description, ['enviada a', 'enviado a']), color: '#ff8f00', icon: 'arrow-up-outline' };
  }
  if (d.includes('recibida') || d.includes('desde')) {
    return { type: 'recibida', label: 'Recibida', via: extractVia(description, ['recibida de', 'recibida desde', 'desde']), color: '#43a047', icon: 'arrow-down-outline' };
  }
  if (d.includes('pago') || d.includes('pagaste')) {
    return { type: 'pago', label: 'Pago', via: extractVia(description, ['pago en', 'pago a']), color: '#5c6bc0', icon: 'card-outline' };
  }
  if (d.includes('compra')) {
    return { type: 'compra', label: 'Compra', via: extractVia(description, ['compra en', 'compra a']), color: '#8e24aa', icon: 'bag-outline' };
  }
  return { type: 'otro', label: currency === 'USD' ? 'USD' : 'Movimiento', via: null, color: '#78909c', icon: 'swap-horizontal-outline' };
}

function extractVia(description: string | null, prefixes: string[]): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const prefix of prefixes) {
    const idx = lower.indexOf(prefix);
    if (idx !== -1) {
      const raw   = description.slice(idx + prefix.length).trim();
      const clean = raw.charAt(0).toUpperCase() + raw.slice(1);
      return clean.length > 22 ? clean.slice(0, 20) + '…' : clean;
    }
  }
  return null;
}

function formatDateLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date  = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// ─── CategorizarSheet ─────────────────────────────────────────────────────────

function CategorizarSheet({
  tx,
  categories,
  onSelect,
  onClose,
  isSaving,
}: {
  tx:         PendingTransaction;
  categories: ExpenseCategory[];
  onSelect:   (cat: ExpenseCategory) => void;
  onClose:    () => void;
  isSaving:   boolean;
}) {
  const suggestedCat = categories.find(c => c.name === tx.suggested_category);
  const [selected, setSelected] = useState<string | null>(suggestedCat?.id ?? null);

  const handleConfirm = () => {
    const cat = categories.find(c => c.id === selected);
    if (cat) { hapticMedium(); onSelect(cat); }
  };

  return (
    <View style={sheetStyles.backdrop}>
      <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
      <View style={sheetStyles.sheet}>
        {/* Drag indicator */}
        <View style={sheetStyles.dragBar} />

        {/* Header: gasto */}
        <View style={sheetStyles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle" color={colors.text.primary} numberOfLines={1}>
              {tx.merchant ?? 'Gasto detectado'}
            </Text>
            <Text variant="caption" color={colors.text.secondary}>
              {formatDateLabel(tx.transaction_date) ?? 'Sin fecha'}
            </Text>
          </View>
          <Text style={sheetStyles.amount}>
            ${tx.amount.toLocaleString('es-AR')}
          </Text>
        </View>

        {/* Sugerido por IA */}
        {suggestedCat && (
          <View style={sheetStyles.aiRow}>
            <Ionicons name="sparkles-outline" size={13} color={colors.primary} />
            <Text variant="caption" color={colors.primary}>
              IA sugiere: <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>{suggestedCat.name_es}</Text>
            </Text>
          </View>
        )}

        <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: spacing[2] }}>
          ELEGÍ UNA CATEGORÍA
        </Text>

        {/* Grid de categorías */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={sheetStyles.grid}
          style={{ maxHeight: 260 }}
        >
          {categories.map(cat => {
            const isActive = selected === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  sheetStyles.catItem,
                  isActive && { borderColor: cat.color ?? colors.primary, backgroundColor: (cat.color ?? colors.primary) + '15' },
                ]}
                onPress={() => { setSelected(cat.id); hapticLight(); }}
                activeOpacity={0.7}
              >
                <View style={[sheetStyles.catIconBox, { backgroundColor: (cat.color ?? colors.primary) + '20' }]}>
                  <Ionicons name={cat.icon as any} size={20} color={cat.color ?? colors.primary} />
                </View>
                <Text
                  variant="caption"
                  color={isActive ? (cat.color ?? colors.primary) : colors.text.secondary}
                  style={isActive ? { fontFamily: 'Montserrat_600SemiBold' } : undefined}
                  numberOfLines={2}
                >
                  {cat.name_es}
                </Text>
                {isActive && (
                  <View style={[sheetStyles.checkBadge, { backgroundColor: cat.color ?? colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Confirmar */}
        <TouchableOpacity
          style={[sheetStyles.confirmBtn, (!selected || isSaving) && { opacity: 0.5 }]}
          onPress={handleConfirm}
          disabled={!selected || isSaving}
          activeOpacity={0.85}
        >
          {isSaving
            ? <ActivityIndicator size="small" color={colors.white} />
            : <>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                <Text style={sheetStyles.confirmBtnText}>Confirmar categoría</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000070', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: colors.bg.primary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing[5], gap: spacing[4], paddingBottom: spacing[8] },
  dragBar:       { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border.default, alignSelf: 'center', marginBottom: spacing[1] },
  header:        { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  amount:        { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: colors.text.primary, lineHeight: 28 },
  aiRow:         { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.primary + '10', borderRadius: 8, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  catItem:       { width: '30%', alignItems: 'center', gap: spacing[1], padding: spacing[2], borderRadius: 12, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.card, position: 'relative' },
  catIconBox:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  checkBadge:    { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  confirmBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.primary, borderRadius: 12, paddingVertical: spacing[4] },
  confirmBtnText:{ fontFamily: 'Montserrat_700Bold', fontSize: 15, color: colors.white },
});

// ─── PendingTransactions ──────────────────────────────────────────────────────

export function PendingTransactions({ transactions, userId, isPolling, categories, onConfirmed }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);
  const [activeTxId,   setActiveTxId]   = useState<string | null>(null);
  const [showAll,      setShowAll]       = useState(false);
  const [bulkLoading,  setBulkLoading]   = useState(false);

  const filtered     = transactions.filter(tx => !dismissedIds.has(tx.id));
  const visible      = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const hiddenCount  = filtered.length - INITIAL_VISIBLE;
  const activeTx     = filtered.find(tx => tx.id === activeTxId) ?? null;

  const withSuggestion = filtered.filter(
    tx => tx.suggested_category && categories.some(c => c.name === tx.suggested_category)
  );

  if (filtered.length === 0 && !isPolling) return null;

  const saveCategoryForTx = async (tx: PendingTransaction, cat: ExpenseCategory) => {
    if (updatingId !== null) return;
    setUpdatingId(tx.id);
    try {
      const txDate = tx.transaction_date ?? new Date().toISOString().split('T')[0];
      const { data: expenseRows } = await supabase
        .from('expenses')
        .select('id')
        .eq('user_id', userId)
        .eq('amount', tx.amount)
        .eq('date', txDate)
        .order('created_at', { ascending: false })
        .limit(1);

      const expenseId = expenseRows?.[0]?.id ?? null;
      if (expenseId) {
        const { error } = await supabase.from('expenses').update({ category_id: cat.id }).eq('id', expenseId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('expenses').insert({
          user_id: userId, amount: tx.amount,
          description: tx.merchant || tx.description || 'Gasto detectado',
          category_id: cat.id, date: txDate,
          payment_method: 'digital_wallet' as const,
          classification: (tx.suggested_classification ?? 'disposable') as const,
          is_recurring: false,
        });
        if (error) throw new Error(error.message);
      }
      setDismissedIds(prev => new Set([...prev, tx.id]));
      setActiveTxId(null);
      onConfirmed();
    } catch (err: any) {
      Alert.alert('Error', 'No se pudo guardar el gasto. Intentá de nuevo.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleBulkConfirm = async () => {
    if (bulkLoading || withSuggestion.length === 0) return;
    setBulkLoading(true);
    try {
      for (const tx of withSuggestion) {
        const cat = categories.find(c => c.name === tx.suggested_category);
        if (cat) await saveCategoryForTx(tx, cat);
      }
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="flash-outline" size={14} color={colors.neon} />
          <Text variant="label" color={colors.neon}>DETECTADOS Y REGISTRADOS</Text>
        </View>
        <View style={styles.headerRight}>
          {isPolling && <ActivityIndicator size="small" color={colors.text.tertiary} />}
          {filtered.length > 0 && (
            <Text variant="caption" color={colors.text.tertiary}>
              {filtered.length} nuevo{filtered.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* Bulk confirm */}
      {withSuggestion.length >= 2 && (
        <TouchableOpacity
          style={[styles.bulkBtn, bulkLoading && { opacity: 0.6 }]}
          onPress={handleBulkConfirm}
          disabled={bulkLoading}
          activeOpacity={0.8}
        >
          {bulkLoading
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Ionicons name="checkmark-done-outline" size={15} color={colors.white} />
          }
          <Text style={styles.bulkBtnText}>
            {bulkLoading
              ? 'Confirmando...'
              : `Confirmar ${withSuggestion.length} con categoría sugerida`
            }
          </Text>
        </TouchableOpacity>
      )}

      {/* Cards */}
      {visible.map(tx => {
        const meta      = parseTxMeta(tx.description, tx.currency);
        const dateLabel = formatDateLabel(tx.transaction_date);
        const suggestedCat = categories.find(c => c.name === tx.suggested_category);
        const isLoading = updatingId === tx.id;

        return (
          <TouchableOpacity
            key={tx.id}
            activeOpacity={0.8}
            onPress={() => !isLoading && setActiveTxId(tx.id)}
          >
            <Card style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardInfo}>
                  <Text variant="bodySmall" color={colors.text.primary} style={styles.merchantName} numberOfLines={1}>
                    {tx.merchant ?? 'Comercio desconocido'}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.typePill, { backgroundColor: meta.color + '1A' }]}>
                      <Ionicons name={meta.icon as any} size={10} color={meta.color} />
                      <Text style={[styles.typePillLabel, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    {dateLabel && (
                      <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 11 }}>
                        {dateLabel}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.cardRight}>
                  {isLoading
                    ? <ActivityIndicator size="small" color={colors.neon} />
                    : <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>NUEVO</Text>
                      </View>
                  }
                  <Text variant="subtitle" color={colors.neon} style={styles.amount}>
                    ${tx.amount.toLocaleString('es-AR')}
                  </Text>
                </View>
              </View>

              {/* Pie: categoría sugerida o CTA */}
              <View style={styles.cardFoot}>
                {suggestedCat ? (
                  <View style={styles.suggestedRow}>
                    <Ionicons name="sparkles-outline" size={12} color={colors.primary} />
                    <Text variant="caption" color={colors.primary}>
                      Sugerido: <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>{suggestedCat.name_es}</Text>
                    </Text>
                  </View>
                ) : (
                  <View style={styles.ctaRow}>
                    <Ionicons name="pricetag-outline" size={12} color={colors.text.tertiary} />
                    <Text variant="caption" color={colors.text.tertiary}>Tocá para categorizar</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={14} color={colors.text.tertiary} />
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      {/* Ver más / menos */}
      {!showAll && hiddenCount > 0 && (
        <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(true)}>
          <Text variant="caption" color={colors.neon}>Ver {hiddenCount} más</Text>
          <Ionicons name="chevron-down" size={14} color={colors.neon} />
        </TouchableOpacity>
      )}
      {showAll && filtered.length > INITIAL_VISIBLE && (
        <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(false)}>
          <Text variant="caption" color={colors.text.secondary}>Mostrar menos</Text>
          <Ionicons name="chevron-up" size={14} color={colors.text.secondary} />
        </TouchableOpacity>
      )}

      {/* Bottom sheet modal de categorización */}
      <Modal
        visible={!!activeTx}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveTxId(null)}
      >
        {activeTx && (
          <CategorizarSheet
            tx={activeTx}
            categories={categories}
            onSelect={cat => saveCategoryForTx(activeTx, cat)}
            onClose={() => setActiveTxId(null)}
            isSaving={updatingId === activeTx.id}
          />
        )}
      </Modal>

    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { gap: spacing[3] },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },

  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    alignSelf: 'stretch', justifyContent: 'center',
  },
  bulkBtnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: colors.white },

  card: { padding: spacing[4], gap: spacing[3] },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  cardInfo: { flex: 1, gap: 3 },
  merchantName: { fontFamily: 'Montserrat_600SemiBold' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 20 },
  typePillLabel: { fontSize: 9, fontFamily: 'Montserrat_600SemiBold' },
  cardRight: { alignItems: 'flex-end', gap: spacing[1], flexShrink: 0 },
  newBadge: { backgroundColor: colors.neon, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 3 },
  newBadgeText: { fontSize: 9, fontFamily: 'Montserrat_700Bold', color: colors.white },
  amount: { fontFamily: 'Montserrat_700Bold' },

  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing[1], borderTopWidth: 1, borderTopColor: colors.border.subtle },
  suggestedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },

  showMoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingVertical: spacing[2] },
});
