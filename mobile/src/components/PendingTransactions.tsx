import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card, Button, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';

interface PendingTransaction {
  id: string;
  amount: number;
  currency: string;
  merchant: string | null;
  suggested_category: string | null;
  description: string | null;
  transaction_date: string | null;
}

// Estado editable antes de confirmar
interface EditableTransaction {
  amount: string;
  merchant: string;
  description: string;
  transaction_date: string;
  suggested_category: string;
}

interface Props {
  transactions: PendingTransaction[];
  userId: string;
  onConfirmed: () => void;
}

const CATEGORY_MAP: Record<string, string> = {
  comida:         '🍔',
  transporte:     '🚗',
  servicios:      '💡',
  entretenimiento:'🎬',
  salud:          '💊',
  ropa:           '👕',
  hogar:          '🏠',
  educacion:      '📚',
  otros:          '📦',
};

const CATEGORIES = Object.keys(CATEGORY_MAP);

function toEditable(tx: PendingTransaction): EditableTransaction {
  return {
    amount:            String(tx.amount),
    merchant:          tx.merchant ?? '',
    description:       tx.description ?? '',
    transaction_date:  tx.transaction_date ?? new Date().toISOString().split('T')[0],
    suggested_category: tx.suggested_category ?? 'otros',
  };
}

export function PendingTransactions({ transactions, userId, onConfirmed }: Props) {
  const [loadingId,   setLoadingId]   = useState<string | null>(null);
  const [editingTx,   setEditingTx]   = useState<PendingTransaction | null>(null);
  const [editValues,  setEditValues]  = useState<EditableTransaction | null>(null);
  const [isSaving,    setIsSaving]    = useState(false);

  if (transactions.length === 0) return null;

  // ── Abre el modal de edición ──────────────────────────────────────────
  const openEdit = (tx: PendingTransaction) => {
    setEditingTx(tx);
    setEditValues(toEditable(tx));
  };

  const closeEdit = () => {
    setEditingTx(null);
    setEditValues(null);
  };

  // ── Confirma con los valores editados ─────────────────────────────────
  const handleConfirm = async () => {
    if (!editingTx || !editValues) return;

    const amount = parseFloat(editValues.amount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Monto inválido', 'Ingresá un monto mayor a 0.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: catData, error: catErr } = await supabase
        .from('expense_categories')
        .select('id')
        .ilike('name_es', `%${editValues.suggested_category}%`)
        .single();

      if (catErr) console.warn('[PendingTx] Categoría no encontrada:', catErr.message);

      const insertPayload = {
        user_id:        userId,
        amount,
        description:    editValues.merchant || editValues.description || 'Gasto detectado',
        category_id:    catData?.id ?? null,
        date:           editValues.transaction_date,
        payment_method: 'digital_wallet' as const,
        classification: 'necessary' as const,
        is_recurring:   false,
      };
      console.log('[PendingTx] INSERT payload:', JSON.stringify(insertPayload));

      const { error: insertErr } = await supabase.from('expenses').insert(insertPayload);

      if (insertErr) {
        console.error('[PendingTx] INSERT expenses falló — code:', insertErr.code, '| message:', insertErr.message, '| details:', insertErr.details);
        throw insertErr;
      }
      console.log('[PendingTx] INSERT expenses OK');

      const { error: updateErr } = await supabase
        .from('pending_transactions')
        .update({ status: 'confirmed' })
        .eq('id', editingTx.id);

      if (updateErr) {
        console.error('[PendingTx] UPDATE pending_transactions falló — code:', updateErr.code, '| message:', updateErr.message);
      } else {
        console.log('[PendingTx] UPDATE pending_transactions OK — id:', editingTx.id);
      }

      closeEdit();
      onConfirmed();
    } catch (err: any) {
      const detail = err?.message ?? err?.code ?? String(err);
      console.error('[PendingTx] handleConfirm error:', detail);
      Alert.alert('Error', `No se pudo registrar el gasto.\n\n${detail}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Ignora sin editar ─────────────────────────────────────────────────
  const handleIgnore = async (id: string) => {
    setLoadingId(id);
    try {
      const { error } = await supabase
        .from('pending_transactions')
        .update({ status: 'ignored' })
        .eq('id', id);
      if (error) console.error('[PendingTx] handleIgnore falló:', error);
      onConfirmed();
    } catch (err) {
      console.error('[PendingTx] handleIgnore error:', err);
    } finally {
      setLoadingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="mail-outline" size={16} color={colors.neon} />
            <Text variant="label" color={colors.neon}>DETECTADOS EN TU EMAIL</Text>
          </View>
          <Text variant="caption" color={colors.text.tertiary}>
            {transactions.length} pendiente{transactions.length > 1 ? 's' : ''}
          </Text>
        </View>

        {transactions.map((tx) => {
          const emoji     = CATEGORY_MAP[tx.suggested_category ?? 'otros'] ?? '📦';
          const isLoading = loadingId === tx.id;

          return (
            <Card key={tx.id} style={styles.card}>
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

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.ignoreBtn}
                  onPress={() => handleIgnore(tx.id)}
                  disabled={isLoading}
                >
                  <Ionicons name="close" size={16} color={colors.text.tertiary} />
                  <Text variant="caption" color={colors.text.tertiary}>Ignorar</Text>
                </TouchableOpacity>

                {/* Editar abre el modal de revisión */}
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => openEdit(tx)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={colors.text.secondary} />
                  ) : (
                    <>
                      <Ionicons name="create-outline" size={16} color={colors.text.secondary} />
                      <Text variant="caption" color={colors.text.secondary}>Revisar</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => openEdit(tx)}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={colors.black} />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color={colors.black} />
                      <Text variant="caption" color={colors.black} style={{ fontFamily: 'DMSans_600SemiBold' }}>
                        Registrar
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </Card>
          );
        })}
      </View>

      {/* ── Modal de edición / confirmación ────────────────────────────── */}
      <Modal
        visible={!!editingTx}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text variant="h4">Revisar gasto</Text>
              <TouchableOpacity onPress={closeEdit}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              {/* Aviso */}
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={colors.info} />
                <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
                  Revisá y corregí los datos detectados antes de registrar el gasto.
                </Text>
              </View>

              {editValues && (
                <>
                  <Input
                    label="COMERCIO / DESTINATARIO"
                    value={editValues.merchant}
                    onChangeText={(v) => setEditValues((p) => p ? { ...p, merchant: v } : p)}
                    placeholder="Ej: Mercado Pago"
                    autoCapitalize="words"
                  />

                  <Input
                    label="MONTO (ARS)"
                    value={editValues.amount}
                    onChangeText={(v) => setEditValues((p) => p ? { ...p, amount: v } : p)}
                    keyboardType="decimal-pad"
                    leftIcon={<Text variant="body" color={colors.text.secondary}>$</Text>}
                  />

                  <Input
                    label="FECHA (YYYY-MM-DD)"
                    value={editValues.transaction_date}
                    onChangeText={(v) => setEditValues((p) => p ? { ...p, transaction_date: v } : p)}
                    placeholder="2026-04-02"
                    keyboardType="numbers-and-punctuation"
                  />

                  {/* Categoría */}
                  <View>
                    <Text variant="label" color={colors.text.secondary} style={styles.catLabel}>
                      CATEGORÍA
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.catList}
                    >
                      {CATEGORIES.map((cat) => {
                        const active = editValues.suggested_category === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[styles.catChip, active && styles.catChipActive]}
                            onPress={() => setEditValues((p) => p ? { ...p, suggested_category: cat } : p)}
                          >
                            <Text style={{ fontSize: 14 }}>{CATEGORY_MAP[cat]}</Text>
                            <Text
                              variant="caption"
                              color={active ? colors.neon : colors.text.secondary}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>

                  <Input
                    label="DESCRIPCIÓN (opcional)"
                    value={editValues.description}
                    onChangeText={(v) => setEditValues((p) => p ? { ...p, description: v } : p)}
                    placeholder="Detalle del gasto"
                    multiline
                    numberOfLines={2}
                    style={{ height: 72 }}
                  />
                </>
              )}

              <Button
                label="CONFIRMAR Y REGISTRAR"
                variant="neon"
                size="lg"
                fullWidth
                isLoading={isSaving}
                onPress={handleConfirm}
              />

              <Button
                label="CANCELAR"
                variant="ghost"
                size="md"
                fullWidth
                onPress={closeEdit}
                style={{ marginTop: -spacing[2] }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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

  card:    { padding: spacing[4], gap: spacing[3] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardIcon: {
    width:           40,
    height:          40,
    backgroundColor: colors.bg.elevated,
    alignItems:      'center',
    justifyContent:  'center',
  },

  cardActions: {
    flexDirection:   'row',
    gap:             spacing[2],
    borderTopWidth:  1,
    borderTopColor:  colors.border.subtle,
    paddingTop:      spacing[3],
  },

  ignoreBtn: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[1],
    paddingVertical: spacing[2],
    borderWidth:    1,
    borderColor:    colors.border.default,
  },
  editBtn: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[1],
    paddingVertical: spacing[2],
    borderWidth:    1,
    borderColor:    colors.border.default,
  },
  confirmBtn: {
    flex:           2,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[1],
    paddingVertical: spacing[2],
    backgroundColor: colors.neon,
  },

  // Modal
  modal: {
    flex:            1,
    backgroundColor: colors.bg.primary,
  },
  modalHeader: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical:  spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  modalBody: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical:   spacing[5],
    paddingBottom:     spacing[12],
    gap:               spacing[4],
  },
  infoRow: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing[2],
    padding:         spacing[3],
    backgroundColor: colors.info + '15',
    borderLeftWidth: 2,
    borderLeftColor: colors.info,
  },
  catLabel:  { marginBottom: spacing[2] },
  catList:   { gap: spacing[2] },
  catChip: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth:    1,
    borderColor:    colors.border.default,
  },
  catChipActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '15',
  },
});
