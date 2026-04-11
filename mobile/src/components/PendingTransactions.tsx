import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
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

// ─── Constantes ───────────────────────────────────────────────────────────────

const INITIAL_VISIBLE = 5;
const CAT_ICON_SIZE   = 20;
const CAT_CHIP_SIZE   = 64;

// ─── Helpers de metadata ──────────────────────────────────────────────────────

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
    const via = extractVia(description, ['enviada a', 'enviado a']);
    return { type: 'enviada', label: 'Enviada', via, color: '#ff8f00', icon: 'arrow-up-outline' };
  }
  if (d.includes('recibida') || d.includes('desde')) {
    const via = extractVia(description, ['recibida de', 'recibida desde', 'desde']);
    return { type: 'recibida', label: 'Recibida', via, color: '#43a047', icon: 'arrow-down-outline' };
  }
  if (d.includes('pago') || d.includes('pagaste')) {
    const via = extractVia(description, ['pago en', 'pago a']);
    return { type: 'pago', label: 'Pago', via, color: '#5c6bc0', icon: 'card-outline' };
  }
  if (d.includes('compra')) {
    const via = extractVia(description, ['compra en', 'compra a']);
    return { type: 'compra', label: 'Compra', via, color: '#8e24aa', icon: 'bag-outline' };
  }
  return { type: 'otro', label: currency === 'USD' ? 'USD' : 'Movimiento', via: null, color: '#78909c', icon: 'swap-horizontal-outline' };
}

function extractVia(description: string | null, prefixes: string[]): string | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const prefix of prefixes) {
    const idx = lower.indexOf(prefix);
    if (idx !== -1) {
      const raw = description.slice(idx + prefix.length).trim();
      // Capitalizar primera letra, máx 20 chars
      const clean = raw.charAt(0).toUpperCase() + raw.slice(1);
      return clean.length > 22 ? clean.slice(0, 20) + '…' : clean;
    }
  }
  return null;
}

function formatDateLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date  = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

// ─── CategoryChip ─────────────────────────────────────────────────────────────

function CategoryChip({
  cat,
  onPress,
  disabled,
}: {
  cat: ExpenseCategory;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.catChip}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.65}
    >
      {/* Contenedor de ícono con tamaño fijo garantiza centrado perfecto */}
      <View style={styles.catIconBox}>
        <Ionicons name={cat.icon as any} size={CAT_ICON_SIZE} color={cat.color ?? colors.text.tertiary} />
      </View>
      <Text style={[styles.catChipLabel, { color: colors.text.secondary }]}>
        {cat.name_es}
      </Text>
    </TouchableOpacity>
  );
}

// ─── CategoryGridItem ─────────────────────────────────────────────────────────

function CategoryGridItem({
  cat,
  onPress,
}: {
  cat: ExpenseCategory;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.catGridItem} onPress={onPress} activeOpacity={0.65}>
      <View style={styles.catIconBox}>
        <Ionicons name={cat.icon as any} size={CAT_ICON_SIZE} color={cat.color ?? colors.text.tertiary} />
      </View>
      <Text style={[styles.catChipLabel, { color: colors.text.secondary }]}>
        {cat.name_es}
      </Text>
    </TouchableOpacity>
  );
}

// ─── PendingTransactions ──────────────────────────────────────────────────────

export function PendingTransactions({ transactions, userId, isPolling, categories, onConfirmed }: Props) {
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [showAll,      setShowAll]      = useState(false);
  const [modalTxId,    setModalTxId]    = useState<string | null>(null);

  const active      = transactions.filter(tx => !dismissedIds.has(tx.id));
  const visible     = showAll ? active : active.slice(0, INITIAL_VISIBLE);
  const hiddenCount = active.length - INITIAL_VISIBLE;

  if (active.length === 0 && !isPolling) return null;

  const handleCategorySelect = async (tx: PendingTransaction, cat: ExpenseCategory) => {
    if (updatingId !== null) return;
    setUpdatingId(tx.id);

    try {
      const txDate = tx.transaction_date ?? new Date().toISOString().split('T')[0];

      const { data: expenseRows, error: expErr } = await supabase
        .from('expenses')
        .select('id')
        .eq('user_id', userId)
        .eq('amount', tx.amount)
        .eq('date', txDate)
        .order('created_at', { ascending: false })
        .limit(1);

      if (expErr) console.warn('[PendingTx] expense lookup error:', expErr.message);
      const expenseId = expenseRows?.[0]?.id ?? null;

      if (expenseId) {
        const { error } = await supabase
          .from('expenses')
          .update({ category_id: cat.id })
          .eq('id', expenseId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('expenses')
          .insert({
            user_id:        userId,
            amount:         tx.amount,
            description:    tx.merchant || tx.description || 'Gasto detectado',
            category_id:    cat.id,
            date:           txDate,
            payment_method: 'digital_wallet' as const,
            classification: (tx.suggested_classification ?? 'disposable') as const,
            is_recurring:   false,
          });
        if (error) throw new Error(error.message);
      }

      setDismissedIds(prev => new Set([...prev, tx.id]));
      onConfirmed();

    } catch (err: any) {
      console.error('[PendingTx] error:', err?.message ?? err);
      Alert.alert('Error', 'No se pudo guardar el gasto. Intentá de nuevo.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <View style={styles.container}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="flash-outline" size={14} color={colors.neon} />
          <Text variant="label" color={colors.neon}>DETECTADOS Y REGISTRADOS</Text>
        </View>
        <View style={styles.headerRight}>
          {isPolling && <ActivityIndicator size="small" color={colors.text.tertiary} />}
          {active.length > 0 && (
            <Text variant="caption" color={colors.text.tertiary}>
              {active.length} nuevo{active.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* ── Cards ── */}
      {visible.map((tx) => {
        const isUpdating = updatingId === tx.id;
        const meta       = parseTxMeta(tx.description, tx.currency);
        const dateLabel  = formatDateLabel(tx.transaction_date);

        // Metadata compacta: "Enviada · Mercado Pago"
        const metaParts  = [meta.via].filter(Boolean);

        return (
          <Card key={tx.id} style={styles.card}>

            {/* Fila principal */}
            <View style={styles.cardTop}>
              <View style={styles.cardInfo}>
                {/* Nombre */}
                <Text variant="bodySmall" color={colors.text.primary} style={styles.merchantName} numberOfLines={1}>
                  {tx.merchant ?? 'Comercio desconocido'}
                </Text>

                {/* Metadata: pill + texto compacto */}
                <View style={styles.metaRow}>
                  <View style={[styles.typePill, { backgroundColor: meta.color + '1A' }]}>
                    <Ionicons name={meta.icon as any} size={10} color={meta.color} />
                    <Text style={[styles.typePillLabel, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {metaParts.length > 0 && (
                    <Text variant="caption" color={colors.text.tertiary} style={styles.metaText} numberOfLines={1}>
                      {metaParts.join(' · ')}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.cardRight}>
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>NUEVO</Text>
                </View>
                <Text variant="subtitle" color={colors.neon} style={styles.amount}>
                  ${tx.amount.toLocaleString('es-AR')}
                </Text>
              </View>
            </View>

            {/* Divisor */}
            <View style={styles.divider} />

            {/* Selector de categoría */}
            <View style={styles.catSection}>
              <View style={styles.catLabelRow}>
                <Text variant="label" color={colors.text.tertiary} style={styles.catLabel}>
                  {isUpdating ? 'GUARDANDO...' : 'ELEGÍ UNA CATEGORÍA'}
                </Text>
                {isUpdating && <ActivityIndicator size="small" color={colors.neon} />}
              </View>

              <View style={[styles.catRow, isUpdating && { opacity: 0.4 }]}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catList}
                  style={{ flex: 1 }}
                >
                  {categories.map((cat) => (
                    <CategoryChip
                      key={cat.id}
                      cat={cat}
                      onPress={() => handleCategorySelect(tx, cat)}
                      disabled={updatingId !== null}
                    />
                  ))}
                </ScrollView>

                {/* Botón Todos */}
                <TouchableOpacity
                  style={styles.allBtn}
                  onPress={() => setModalTxId(tx.id)}
                  disabled={updatingId !== null}
                  activeOpacity={0.7}
                >
                  <Ionicons name="grid-outline" size={16} color={colors.neon} />
                  <Text style={styles.allBtnLabel}>TODOS</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Modal grilla completa */}
            <Modal
              visible={modalTxId === tx.id}
              transparent
              animationType="slide"
              onRequestClose={() => setModalTxId(null)}
            >
              <View style={styles.modalOverlay}>
                <View style={styles.modalSheet}>
                  <View style={styles.modalHeader}>
                    <Text variant="label" color={colors.text.primary}>TODAS LAS CATEGORÍAS</Text>
                    <TouchableOpacity onPress={() => setModalTxId(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close" size={20} color={colors.text.secondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.catGrid}>
                    {categories.map((cat) => (
                      <CategoryGridItem
                        key={cat.id}
                        cat={cat}
                        onPress={() => {
                          setModalTxId(null);
                          handleCategorySelect(tx, cat);
                        }}
                      />
                    ))}
                  </View>
                </View>
              </View>
            </Modal>

          </Card>
        );
      })}

      {/* Ver más / menos */}
      {!showAll && hiddenCount > 0 && (
        <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(true)}>
          <Text variant="caption" color={colors.neon}>Ver {hiddenCount} más</Text>
          <Ionicons name="chevron-down" size={14} color={colors.neon} />
        </TouchableOpacity>
      )}
      {showAll && active.length > INITIAL_VISIBLE && (
        <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(false)}>
          <Text variant="caption" color={colors.text.secondary}>Mostrar menos</Text>
          <Ionicons name="chevron-up" size={14} color={colors.text.secondary} />
        </TouchableOpacity>
      )}

    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  container: { gap: spacing[3] },

  // Header
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },

  // Card
  card: {
    padding: spacing[4],
    gap:     spacing[3],
  },
  cardTop: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
  },
  cardInfo: {
    flex: 1,
    gap:  3,
  },
  merchantName: {
    fontFamily: 'DMSans_600SemiBold',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    flexWrap:      'nowrap',
  },
  typePill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: spacing[2],
    paddingVertical:   2,
    borderRadius:      20,
    flexShrink:        0,
  },
  typePillLabel: {
    fontSize:   9,
    fontFamily: 'DMSans_600SemiBold',
  },
  metaText: {
    fontSize: 11,
    flexShrink: 1,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap:        spacing[1],
    flexShrink: 0,
  },
  newBadge: {
    backgroundColor:   colors.neon,
    paddingHorizontal: spacing[2],
    paddingVertical:   2,
    borderRadius:      3,
  },
  newBadgeText: {
    fontSize:   9,
    fontFamily: 'DMSans_700Bold',
    color:      '#000',
  },
  amount: {
    fontFamily: 'DMSans_700Bold',
  },

  divider: {
    height:          1,
    backgroundColor: colors.border.subtle,
    marginHorizontal: -spacing[4],
  },

  // Categorías
  catSection: { gap: spacing[2] },
  catLabelRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  catLabel: {
    fontSize: 10,
  },
  catRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  catList: {
    gap:        spacing[2],
    alignItems: 'center',
  },

  // Chip en la fila horizontal — tamaño cuadrado fijo
  catChip: {
    width:          CAT_CHIP_SIZE,
    height:         CAT_CHIP_SIZE,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            4,
    borderWidth:    1,
    borderColor:    colors.border.default,
    borderRadius:   12,
    backgroundColor: colors.bg.elevated,
  },

  // Wrapper del ícono — garantiza centrado perfecto independiente del SVG
  catIconBox: {
    width:          CAT_ICON_SIZE + 4,
    height:         CAT_ICON_SIZE + 4,
    alignItems:     'center',
    justifyContent: 'center',
  },

  catChipLabel: {
    fontSize:   8,
    lineHeight: 10,
    textAlign:  'center',
    fontFamily: 'DMSans_400Regular',
  },

  // Botón TODOS
  allBtn: {
    width:          CAT_CHIP_SIZE,
    height:         CAT_CHIP_SIZE,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            4,
    borderWidth:    1,
    borderColor:    colors.neon + '50',
    borderRadius:   12,
    backgroundColor: colors.neon + '0D',
    flexShrink:     0,
  },
  allBtnLabel: {
    fontSize:   8,
    lineHeight: 10,
    color:      colors.neon,
    fontFamily: 'DMSans_600SemiBold',
  },

  // Show more
  showMoreBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[1],
    paddingVertical: spacing[3],
    borderTopWidth:  1,
    borderTopColor:  colors.border.subtle,
  },

  // Modal
  modalOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'flex-end',
  },
  modalSheet: {
    backgroundColor:      colors.bg.primary,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    padding:              spacing[5],
    gap:                  spacing[4],
    paddingBottom:        spacing[10],
  },
  modalHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  catGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing[2],
  },
  catGridItem: {
    width:           '22%',
    aspectRatio:     1,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             4,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    12,
    backgroundColor: colors.bg.elevated,
  },
});
