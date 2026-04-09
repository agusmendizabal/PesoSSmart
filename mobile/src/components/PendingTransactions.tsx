import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';

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
  onConfirmed: () => void;
}

const CATEGORY_MAP: Record<string, string> = {
  comida:          '🍔',
  transporte:      '🚗',
  servicios:       '💡',
  entretenimiento: '🎬',
  salud:           '💊',
  ropa:            '👕',
  hogar:           '🏠',
  educacion:       '📚',
  otros:           '📦',
};

const CATEGORIES = Object.keys(CATEGORY_MAP);

const INITIAL_VISIBLE = 5;

export function PendingTransactions({ transactions, userId, isPolling, onConfirmed }: Props) {
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [showAll,      setShowAll]      = useState(false);

  // Filtrar items ya clasificados localmente
  const active = transactions.filter(tx => !dismissedIds.has(tx.id));

  if (active.length === 0 && !isPolling) return null;

  const visible     = showAll ? active : active.slice(0, INITIAL_VISIBLE);
  const hiddenCount = active.length - INITIAL_VISIBLE;

  const handleCategoryChange = async (tx: PendingTransaction, newCategory: string) => {
    if (updatingId !== null) return;
    setUpdatingId(tx.id);
    console.log('[AutoDetected] tap categoría:', newCategory, '| tx.id:', tx.id);

    try {
      const txDate = tx.transaction_date ?? new Date().toISOString().split('T')[0];

      // 1. Buscar category_id
      console.log('[AutoDetected] buscando category_id para:', newCategory);
      const { data: catRows, error: catErr } = await supabase
        .from('expense_categories')
        .select('id')
        .ilike('name_es', `%${newCategory}%`)
        .limit(1);

      if (catErr) console.warn('[AutoDetected] category lookup error:', catErr.message);
      const categoryId = catRows?.[0]?.id ?? null;
      console.log('[AutoDetected] category_id:', categoryId);

      // 2. Buscar expense existente
      console.log('[AutoDetected] buscando expense: amount=', tx.amount, '| date=', txDate);
      const { data: expenseRows, error: expErr } = await supabase
        .from('expenses')
        .select('id')
        .eq('user_id', userId)
        .eq('amount', tx.amount)
        .eq('date', txDate)
        .order('created_at', { ascending: false })
        .limit(1);

      if (expErr) console.warn('[AutoDetected] expense lookup error:', expErr.message);
      const expenseId = expenseRows?.[0]?.id ?? null;
      console.log('[AutoDetected] expense_id:', expenseId ?? 'no encontrado — se crea nuevo');

      if (expenseId) {
        // 3a. Existe → actualizar categoría
        const { error: updateErr } = await supabase
          .from('expenses')
          .update({ category_id: categoryId })
          .eq('id', expenseId);

        if (updateErr) {
          console.error('[AutoDetected] update error:', updateErr.message, updateErr.code);
          throw new Error(updateErr.message);
        }
        console.log('[AutoDetected] categoría actualizada OK — expense_id:', expenseId);
      } else {
        // 3b. No existe → insertar el gasto ahora con la categoría elegida
        const insertPayload = {
          user_id:        userId,
          amount:         tx.amount,
          description:    tx.merchant || tx.description || 'Gasto detectado',
          category_id:    categoryId,
          date:           txDate,
          payment_method: 'digital_wallet' as const,
          classification: (tx.suggested_classification ?? 'disposable') as const,
          is_recurring:   false,
        };
        console.log('[AutoDetected] insertando expense:', JSON.stringify(insertPayload));

        const { data: insertedData, error: insertErr } = await supabase
          .from('expenses')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertErr) {
          console.error('[AutoDetected] insert error:', insertErr.message, insertErr.code, insertErr.details);
          throw new Error(insertErr.message);
        }
        console.log('[AutoDetected] expense insertado OK — id:', insertedData?.id);
      }

      // 4. Remover de la vista local inmediatamente
      setDismissedIds(prev => new Set([...prev, tx.id]));

      // 5. Refrescar lista del padre
      onConfirmed();
      console.log('[AutoDetected] listo ✓');

    } catch (err: any) {
      console.error('[AutoDetected] error:', err?.message ?? err);
      Alert.alert('Error', 'No se pudo guardar el gasto. Intentá de nuevo.');
    } finally {
      setUpdatingId(null);
      console.log('[AutoDetected] loading desactivado');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="flash-outline" size={16} color={colors.neon} />
          <Text variant="label" color={colors.neon}>DETECTADOS Y REGISTRADOS</Text>
        </View>
        <View style={styles.headerRight}>
          {isPolling && (
            <ActivityIndicator size="small" color={colors.text.tertiary} style={{ marginRight: spacing[2] }} />
          )}
          {active.length > 0 && (
            <Text variant="caption" color={colors.text.tertiary}>
              {active.length} nuevo{active.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* Cards */}
      {visible.map((tx) => {
        const currentCategory = tx.suggested_category ?? 'otros';
        const emoji           = CATEGORY_MAP[currentCategory] ?? '📦';
        const isUpdating      = updatingId === tx.id;

        return (
          <Card key={tx.id} style={styles.card}>
            {/* Fila principal */}
            <View style={styles.cardTop}>
              <View style={styles.cardIcon}>
                <Text style={{ fontSize: 20 }}>{emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
                  {tx.merchant ?? 'Comercio desconocido'}
                </Text>
                <Text variant="caption" color={colors.text.secondary}>
                  {tx.description ?? tx.suggested_category ?? ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
                <View style={styles.newBadge}>
                  <Text style={{ fontSize: 9, fontFamily: 'DMSans_600SemiBold', color: colors.black }}>
                    NUEVO
                  </Text>
                </View>
                <Text variant="subtitle" color={colors.neon}>
                  ${tx.amount.toLocaleString('es-AR')}
                </Text>
                {tx.transaction_date && (
                  <Text variant="caption" color={colors.text.tertiary}>
                    {tx.transaction_date}
                  </Text>
                )}
              </View>
            </View>

            {/* Selector de categoría inline */}
            <View style={styles.catSection}>
              <View style={styles.catLabelRow}>
                <Text variant="label" color={colors.text.tertiary}>
                  {isUpdating ? 'GUARDANDO...' : 'ELEGÍ UNA CATEGORÍA'}
                </Text>
                {isUpdating && (
                  <ActivityIndicator size="small" color={colors.neon} style={{ marginLeft: spacing[2] }} />
                )}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.catList}
              >
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, isUpdating && styles.catChipDisabled]}
                    onPress={() => handleCategoryChange(tx, cat)}
                    disabled={updatingId !== null}
                  >
                    <Text style={{ fontSize: 12 }}>{CATEGORY_MAP[cat]}</Text>
                    <Text variant="caption" color={isUpdating ? colors.text.tertiary : colors.text.secondary}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
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

const styles = StyleSheet.create({
  container: { gap: spacing[3] },

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
  },

  showMoreBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[1],
    paddingVertical: spacing[3],
    borderTopWidth:  1,
    borderTopColor:  colors.border.subtle,
  },

  card:    { padding: spacing[4], gap: spacing[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardIcon: {
    width:           40,
    height:          40,
    backgroundColor: colors.bg.elevated,
    alignItems:      'center',
    justifyContent:  'center',
  },

  newBadge: {
    backgroundColor:   colors.neon,
    paddingHorizontal: spacing[2],
    paddingVertical:   2,
    alignSelf:         'flex-end',
  },

  catSection: { gap: spacing[2] },
  catLabelRow: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  catList: { gap: spacing[2] },
  catChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
    borderWidth:       1,
    borderColor:       colors.border.default,
  },
  catChipDisabled: {
    opacity: 0.4,
  },
});
