import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { supabase as _supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import type { Expense, ExpenseCategory } from '@/types';

const supabase     = _supabase as any;
const { height: SCREEN_H } = Dimensions.get('window');

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Budget {
  id: string;
  category_id: string;
  monthly_limit: number;
}

export interface BudgetRow {
  budget:   Budget;
  category: ExpenseCategory;
  spent:    number;
  pct:      number;
}

// ─── Emoji mapping ─────────────────────────────────────────────────────────────

function getCategoryEmoji(nameEs: string): string {
  const n = nameEs.toLowerCase();
  if (n.includes('comida') || n.includes('restaurant') || n.includes('almuerzo') || n.includes('cena')) return '🍔';
  if (n.includes('ocio') || n.includes('salida') || n.includes('entretenimiento'))  return '🎮';
  if (n.includes('transport') || n.includes('uber') || n.includes('taxi'))           return '🚕';
  if (n.includes('compra') || n.includes('supermercado') || n.includes('mercado'))   return '🛒';
  if (n.includes('hogar') || n.includes('casa') || n.includes('alquiler'))           return '🏠';
  if (n.includes('salud') || n.includes('médico') || n.includes('farmacia') || n.includes('medico')) return '🩺';
  if (n.includes('educac') || n.includes('escuela') || n.includes('curso'))          return '🎓';
  if (n.includes('servicio') || n.includes('factura') || n.includes('suscripci'))    return '💳';
  if (n.includes('viaje') || n.includes('vuelo') || n.includes('hotel'))             return '✈️';
  if (n.includes('mascota') || n.includes('perro') || n.includes('gato'))            return '🐾';
  if (n.includes('deport') || n.includes('gym') || n.includes('gimnasio'))           return '🏋️';
  if (n.includes('regalo'))                                                           return '🎁';
  if (n.includes('hijo') || n.includes('niño') || n.includes('beb'))                 return '👶';
  if (n.includes('cuidado') || n.includes('belleza') || n.includes('peluq'))         return '💄';
  if (n.includes('tecnolog') || n.includes('electr'))                                return '📱';
  return '📝';
}

// ─── Color helpers ─────────────────────────────────────────────────────────────

function getBarColor(pct: number): string {
  if (pct > 0.9) return '#EF4444';
  if (pct > 0.7) return '#F59E0B';
  return '#27AE60';
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useSpendingByCategory(expenses: Expense[]): Record<string, number> {
  return useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      if (e.category_id) map[e.category_id] = (map[e.category_id] ?? 0) + e.amount;
    }
    return map;
  }, [expenses]);
}

function useBudgets(userId: string): [Budget[], boolean, () => Promise<void>] {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBudgets = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('category_budgets')
      .select('id, category_id, monthly_limit')
      .eq('user_id', userId);
    setBudgets(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  return [budgets, loading, fetchBudgets];
}

function buildRows(
  budgets: Budget[],
  categories: ExpenseCategory[],
  spendingByCat: Record<string, number>,
): BudgetRow[] {
  return budgets
    .map(b => {
      const category = categories.find(c => c.id === b.category_id);
      if (!category) return null;
      const spent = spendingByCat[b.category_id] ?? 0;
      const pct   = b.monthly_limit > 0 ? spent / b.monthly_limit : 0;
      return { budget: b, category, spent, pct };
    })
    .filter(Boolean)
    .sort((a, b) => b!.pct - a!.pct) as BudgetRow[];
}

// ─── SetBudgetModal ───────────────────────────────────────────────────────────

function SetBudgetModal({
  visible, categories, existingBudgets, editingRow,
  onClose, onSave, onDelete,
}: {
  visible:         boolean;
  categories:      ExpenseCategory[];
  existingBudgets: Budget[];
  editingRow:      BudgetRow | null;
  onClose:         () => void;
  onSave:          (categoryId: string, limit: number) => Promise<void>;
  onDelete:        (budgetId: string) => Promise<void>;
}) {
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [limitText,     setLimitText]     = useState('');
  const [isSaving,      setIsSaving]      = useState(false);

  useEffect(() => {
    if (visible) {
      setSelectedCatId(editingRow?.category.id ?? null);
      setLimitText(editingRow ? String(editingRow.budget.monthly_limit) : '');
      setIsSaving(false);
    }
  }, [visible, editingRow]);

  const availableCategories = useMemo(() => {
    const usedIds = new Set(existingBudgets.map(b => b.category_id));
    if (editingRow) usedIds.delete(editingRow.category.id);
    return categories.filter(c => !usedIds.has(c.id));
  }, [categories, existingBudgets, editingRow]);

  const handleSave = async () => {
    if (!selectedCatId) { Alert.alert('Elegí una categoría'); return; }
    const limit = parseFloat(limitText.replace(',', '.').replace(/\./g, ''));
    if (isNaN(limit) || limit <= 0) { Alert.alert('Ingresá un monto válido'); return; }
    setIsSaving(true);
    try { await onSave(selectedCatId, limit); onClose(); }
    catch { Alert.alert('Error', 'No se pudo guardar el presupuesto.'); }
    finally { setIsSaving(false); }
  };

  const handleDelete = () => {
    if (!editingRow) return;
    Alert.alert('Eliminar presupuesto', '¿Querés eliminar este presupuesto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try { await onDelete(editingRow.budget.id); onClose(); }
          catch { Alert.alert('Error', 'No se pudo eliminar.'); }
          finally { setIsSaving(false); }
        },
      },
    ]);
  };

  const selectedCat = editingRow?.category ?? categories.find(c => c.id === selectedCatId);
  const selectedEmoji = selectedCat ? getCategoryEmoji(selectedCat.name_es) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
          <View style={ms.sheet}>
            <View style={ms.dragBar} />

            <View style={ms.header}>
              <Text style={ms.title}>{editingRow ? 'Editar presupuesto' : 'Agregar categoría'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={colors.text.tertiary} />
              </TouchableOpacity>
            </View>

            {/* Category picker (new only) */}
            {!editingRow && (
              <View style={{ gap: spacing[2] }}>
                <Text style={ms.sectionLabel}>CATEGORÍA</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing[2], paddingBottom: spacing[1] }}
                >
                  {availableCategories.map(cat => {
                    const active = selectedCatId === cat.id;
                    const emoji  = getCategoryEmoji(cat.name_es);
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[ms.catChip, active && { borderColor: colors.primary, backgroundColor: colors.primary + '18' }]}
                        onPress={() => { setSelectedCatId(cat.id); hapticLight(); }}
                        activeOpacity={0.75}
                      >
                        <Text style={ms.catChipEmoji}>{emoji}</Text>
                        <Text style={[ms.catChipText, active && { color: colors.primary, fontFamily: 'Montserrat_700Bold' }]}>
                          {cat.name_es}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Editing category preview */}
            {editingRow && (
              <View style={ms.editingCat}>
                <View style={ms.editCatEmojiBox}>
                  <Text style={ms.editCatEmoji}>{selectedEmoji}</Text>
                </View>
                <Text style={ms.editCatName}>{editingRow.category.name_es}</Text>
              </View>
            )}

            {/* Amount input */}
            <View style={{ gap: spacing[2] }}>
              <Text style={ms.sectionLabel}>PRESUPUESTO MENSUAL (ARS)</Text>
              <View style={ms.inputRow}>
                <Text style={ms.inputPrefix}>$</Text>
                <TextInput
                  style={ms.input}
                  value={limitText}
                  onChangeText={setLimitText}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.text.tertiary}
                  returnKeyType="done"
                />
                <Text style={ms.inputSuffix}>/ mes</Text>
              </View>
            </View>

            <Text style={ms.microcopy}>Solo cuentan los gastos clasificados.</Text>

            <TouchableOpacity
              style={[ms.saveBtn, (!selectedCatId || !limitText) && { opacity: 0.4 }]}
              onPress={() => { hapticMedium(); handleSave(); }}
              disabled={isSaving || !selectedCatId || !limitText}
              activeOpacity={0.85}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Text style={ms.saveBtnText}>{editingRow ? 'Guardar cambios' : 'Agregar categoría'}</Text>
              }
            </TouchableOpacity>

            {editingRow && (
              <TouchableOpacity style={ms.deleteBtn} onPress={handleDelete} disabled={isSaving} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={15} color={colors.red} />
                <Text style={ms.deleteBtnText}>Eliminar presupuesto</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const ms = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: '#FAFAF7', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing[5], gap: spacing[4], paddingBottom: spacing[10] },
  dragBar:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD', alignSelf: 'center', marginBottom: spacing[1] },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:         { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C', letterSpacing: -0.3 },
  sectionLabel:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: '#9B9790', letterSpacing: 0.5 },
  catChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: 20, borderWidth: 1.5, borderColor: colors.border.default, backgroundColor: colors.bg.card },
  catChipEmoji:  { fontSize: 15 },
  catChipText:   { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: colors.text.secondary },
  editingCat:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: '#F5F1E9', borderRadius: 14, padding: spacing[3] },
  editCatEmojiBox:{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  editCatEmoji:  { fontSize: 24 },
  editCatName:   { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: '#1C1C1C' },
  inputRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: colors.border.default, borderRadius: 14, backgroundColor: '#FFF', paddingHorizontal: spacing[4], gap: spacing[2] },
  inputPrefix:   { fontFamily: 'Montserrat_700Bold', fontSize: 22, color: '#1C1C1C' },
  input:         { flex: 1, fontFamily: 'Montserrat_600SemiBold', fontSize: 22, color: '#1C1C1C', paddingVertical: spacing[4] },
  inputSuffix:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9B9790' },
  saveBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.primary, borderRadius: 14, paddingVertical: spacing[4], shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  saveBtnText:   { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: colors.white },
  deleteBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[3], borderRadius: 12, borderWidth: 1, borderColor: colors.red + '40', backgroundColor: colors.red + '08' },
  deleteBtnText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: colors.red },
  microcopy:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790', textAlign: 'center' },
});

// ─── BudgetCategoryRow ────────────────────────────────────────────────────────

function BudgetCategoryRow({ row, onEdit }: { row: BudgetRow; onEdit: (row: BudgetRow) => void }) {
  const emoji      = getCategoryEmoji(row.category.name_es);
  const barColor   = getBarColor(row.pct);
  const pctInt     = Math.round(Math.min(row.pct, 1) * 100);

  return (
    <TouchableOpacity style={bs.catRow} onPress={() => { hapticLight(); onEdit(row); }} activeOpacity={0.75}>
      <View style={bs.emojiBox}>
        <Text style={bs.emoji}>{emoji}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={bs.catRowHeader}>
          <Text style={bs.catName} numberOfLines={1}>{row.category.name_es}</Text>
          <Text style={[bs.pctLabel, { color: barColor }]}>{pctInt}%</Text>
        </View>
        <View style={bs.barTrack}>
          <View style={[bs.barFill, { width: `${pctInt}%` as any, backgroundColor: barColor }]} />
        </View>
        <Text style={bs.amounts} numberOfLines={1}>
          <Text style={{ color: barColor, fontFamily: 'Montserrat_600SemiBold' }}>{formatCurrency(row.spent)}</Text>
          <Text style={{ color: '#9B9790' }}>{' / '}{formatCurrency(row.budget.monthly_limit)}</Text>
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── BudgetFullSheet ──────────────────────────────────────────────────────────

const MONTH_NAMES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function BudgetFullSheet({
  visible, rows, totalSpent, totalBudget, month, categories, budgets, userId,
  onClose, onSave, onDelete,
}: {
  visible:      boolean;
  rows:         BudgetRow[];
  totalSpent:   number;
  totalBudget:  number;
  month:        number;
  categories:   ExpenseCategory[];
  budgets:      Budget[];
  userId:       string;
  onClose:      () => void;
  onSave:       (catId: string, limit: number) => Promise<void>;
  onDelete:     (budgetId: string) => Promise<void>;
}) {
  const [showEdit,    setShowEdit]    = useState(false);
  const [editingRow,  setEditingRow]  = useState<BudgetRow | null>(null);

  const monthName   = MONTH_NAMES_ES[(month - 1) % 12];
  const totalPct    = totalBudget > 0 ? Math.min(totalSpent / totalBudget, 1) : 0;
  const totalPctInt = Math.round(totalPct * 100);
  const available   = totalBudget - totalSpent;
  const totalBarColor = getBarColor(totalPct);

  const handleEditRow   = (row: BudgetRow) => { setEditingRow(row); setShowEdit(true); };
  const handleNewBudget = () => { setEditingRow(null); setShowEdit(true); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={bs.backdrop}>
        <TouchableOpacity style={bs.backdropTouch} onPress={onClose} activeOpacity={1} />
        <View style={bs.sheet}>
          <View style={bs.dragBar} />

          {/* Header */}
          <View style={bs.header}>
            <Text style={bs.title}>Presupuestos de {monthName}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#9B9790" />
            </TouchableOpacity>
          </View>

          {/* Total card */}
          {totalBudget > 0 && (
            <View style={bs.totalCard}>
              <View style={bs.totalTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={bs.totalLabel}>Total del mes</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
                    <Text style={[bs.totalSpent, { color: totalBarColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatCurrency(totalSpent)}
                    </Text>
                    <Text style={bs.totalSep}>/</Text>
                    <Text style={bs.totalLimit} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatCurrency(totalBudget)}
                    </Text>
                  </View>
                </View>
                <Text style={[bs.totalPct, { color: totalBarColor }]}>{totalPctInt}%</Text>
              </View>
              <View style={bs.totalBarTrack}>
                <View style={[bs.totalBarFill, { width: `${totalPctInt}%` as any, backgroundColor: totalBarColor }]} />
              </View>
              <Text style={[bs.availableText, { color: available >= 0 ? '#27AE60' : '#EF4444' }]}>
                {available >= 0
                  ? `Disponible: ${formatCurrency(available)}`
                  : `Excedido por ${formatCurrency(-available)}`}
              </Text>
            </View>
          )}

          {/* Category list */}
          <ScrollView style={{ maxHeight: SCREEN_H * 0.42 }} showsVerticalScrollIndicator={false}>
            {rows.length === 0 ? (
              <View style={bs.emptyWrap}>
                <Text style={bs.emptyEmoji}>📊</Text>
                <Text style={bs.emptyTitle}>Sin presupuestos aún</Text>
                <Text style={bs.emptyText}>Tocá "Agregar categoría" para definir tus límites.</Text>
              </View>
            ) : (
              rows.map((row, i) => (
                <React.Fragment key={row.budget.id}>
                  {i > 0 && <View style={bs.divider} />}
                  <BudgetCategoryRow row={row} onEdit={handleEditRow} />
                </React.Fragment>
              ))
            )}
          </ScrollView>

          {/* Add button */}
          <TouchableOpacity
            style={[bs.addBtn, budgets.length >= categories.length && categories.length > 0 && { opacity: 0.4 }]}
            onPress={handleNewBudget}
            disabled={budgets.length >= categories.length && categories.length > 0}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={bs.addBtnText}>Agregar categoría</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SetBudgetModal
        visible={showEdit}
        categories={categories}
        existingBudgets={budgets}
        editingRow={editingRow}
        onClose={() => setShowEdit(false)}
        onSave={onSave}
        onDelete={onDelete}
      />
    </Modal>
  );
}

const bs = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet:         { backgroundColor: '#FAFAF7', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 36, gap: 16 },
  dragBar:       { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E8E2D9', alignSelf: 'center', marginBottom: 6 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:         { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C', letterSpacing: -0.3 },
  // Total card
  totalCard:     { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: '#E8E2D9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  totalTopRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  totalLabel:    { fontFamily: 'Montserrat_500Medium', fontSize: 11, color: '#9B9790', marginBottom: 4 },
  totalSpent:    { fontFamily: 'Montserrat_700Bold', fontSize: 22, letterSpacing: -0.5 },
  totalSep:      { fontFamily: 'Montserrat_400Regular', fontSize: 16, color: '#9B9790' },
  totalLimit:    { fontFamily: 'Montserrat_400Regular', fontSize: 16, color: '#9B9790' },
  totalPct:      { fontFamily: 'Montserrat_700Bold', fontSize: 28, letterSpacing: -1, flexShrink: 0 },
  totalBarTrack: { height: 8, backgroundColor: '#E8E2D9', borderRadius: 999, overflow: 'hidden' },
  totalBarFill:  { height: '100%', borderRadius: 999 },
  availableText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13 },
  // Category row
  catRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 2 },
  emojiBox:    { width: 46, height: 46, borderRadius: 14, backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emoji:       { fontSize: 22 },
  catRowHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catName:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#1C1C1C', flex: 1, marginRight: 8 },
  pctLabel:    { fontFamily: 'Montserrat_700Bold', fontSize: 13, flexShrink: 0 },
  barTrack:    { height: 7, backgroundColor: '#E8E2D9', borderRadius: 999, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 999 },
  amounts:     { fontFamily: 'Montserrat_400Regular', fontSize: 12 },
  divider:     { height: 1, backgroundColor: '#E8E2D9', marginHorizontal: 2 },
  // Add button
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary + '40', backgroundColor: colors.primary + '08' },
  addBtnText:  { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: colors.primary },
  // Empty
  emptyWrap:   { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyEmoji:  { fontSize: 36 },
  emptyTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#1C1C1C' },
  emptyText:   { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9B9790', textAlign: 'center' },
});

// ─── BudgetRingIndicator ──────────────────────────────────────────────────────

const RING_R      = 15;
const RING_SIZE   = 44;
const RING_CENTER = RING_SIZE / 2;
const CIRCUMF     = 2 * Math.PI * RING_R;
const STROKE_W    = 3.5;

export function BudgetRingIndicator({
  userId, expenses, categories, month, year,
}: {
  userId:     string;
  expenses:   Expense[];
  categories: ExpenseCategory[];
  month:      number;
  year:       number;
}) {
  const [showSheet, setShowSheet] = useState(false);
  const [budgets, loading, fetchBudgets] = useBudgets(userId);
  const spendingByCat = useSpendingByCategory(expenses);
  const rows = useMemo(() => buildRows(budgets, categories, spendingByCat), [budgets, categories, spendingByCat]);

  const totalSpent  = rows.reduce((s, r) => s + r.spent, 0);
  const totalBudget = rows.reduce((s, r) => s + r.budget.monthly_limit, 0);
  const totalPct    = totalBudget > 0 ? Math.min(totalSpent / totalBudget, 1) : 0;
  const totalPctInt = Math.round(totalPct * 100);
  const ringColor   = getBarColor(totalPct);

  const handleSave = async (categoryId: string, limit: number) => {
    await supabase.from('category_budgets').upsert(
      { user_id: userId, category_id: categoryId, monthly_limit: limit, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,category_id' }
    );
    hapticSuccess();
    await fetchBudgets();
  };

  const handleDelete = async (budgetId: string) => {
    await supabase.from('category_budgets').delete().eq('id', budgetId);
    await fetchBudgets();
  };

  if (loading) return null;

  // No budgets yet → show a faint "+" button to invite setup
  if (budgets.length === 0) {
    return (
      <>
        <TouchableOpacity
          style={rs.emptyRing}
          onPress={() => { hapticLight(); setShowSheet(true); }}
          activeOpacity={0.75}
        >
          <Ionicons name="add" size={16} color="#BDBDBD" />
        </TouchableOpacity>
        <BudgetFullSheet
          visible={showSheet} rows={[]} totalSpent={0} totalBudget={0}
          month={month} categories={categories} budgets={budgets} userId={userId}
          onClose={() => setShowSheet(false)} onSave={handleSave} onDelete={handleDelete}
        />
      </>
    );
  }

  const dashLen = totalPct * CIRCUMF;

  return (
    <>
      <TouchableOpacity
        style={rs.wrapper}
        onPress={() => { hapticLight(); setShowSheet(true); }}
        activeOpacity={0.75}
      >
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          {/* Track */}
          <SvgCircle
            cx={RING_CENTER} cy={RING_CENTER} r={RING_R}
            fill="none" stroke="#E8E8E8" strokeWidth={STROKE_W}
          />
          {/* Progress */}
          {dashLen > 0 && (
            <SvgCircle
              cx={RING_CENTER} cy={RING_CENTER} r={RING_R}
              fill="none" stroke={ringColor} strokeWidth={STROKE_W}
              strokeDasharray={`${dashLen} ${CIRCUMF}`}
              strokeDashoffset={0}
              strokeLinecap="round"
              rotation="-90"
              origin={`${RING_CENTER},${RING_CENTER}`}
            />
          )}
        </Svg>
        {/* Center % label */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[rs.pctText, { color: ringColor }]}>{totalPctInt}%</Text>
          </View>
        </View>
      </TouchableOpacity>

      <BudgetFullSheet
        visible={showSheet}
        rows={rows}
        totalSpent={totalSpent}
        totalBudget={totalBudget}
        month={month}
        categories={categories}
        budgets={budgets}
        userId={userId}
        onClose={() => setShowSheet(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </>
  );
}

const rs = StyleSheet.create({
  wrapper:   { width: RING_SIZE, height: RING_SIZE },
  pctText:   { fontFamily: 'Montserrat_700Bold', fontSize: 9.5, lineHeight: 12 },
  emptyRing: {
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    borderWidth: 2, borderColor: '#E8E2D9', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
});

// ─── BudgetCard (legacy — kept for backwards compat) ─────────────────────────

interface BudgetCardProps {
  userId:     string;
  expenses:   Expense[];
  categories: ExpenseCategory[];
}

export function BudgetCard({ userId, expenses, categories }: BudgetCardProps) {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear  = new Date().getFullYear();
  return (
    <BudgetRingIndicator
      userId={userId} expenses={expenses} categories={categories}
      month={currentMonth} year={currentYear}
    />
  );
}

// ─── BudgetHomeWidget (compact alert — in home.tsx) ───────────────────────────

interface BudgetHomeWidgetProps {
  userId:   string;
  expenses: Expense[];
  budgets:  Budget[];
  onPress:  () => void;
}

export function BudgetHomeWidget({ expenses, budgets, onPress }: BudgetHomeWidgetProps) {
  const spendingByCat = useSpendingByCategory(expenses);

  const rows: BudgetRow[] = useMemo(() => {
    return budgets
      .map(b => {
        const matchingExpense = expenses.find(e => e.category_id === b.category_id);
        const category = matchingExpense?.category as ExpenseCategory | undefined;
        if (!category) return null;
        const spent = spendingByCat[b.category_id] ?? 0;
        const pct   = b.monthly_limit > 0 ? spent / b.monthly_limit : 0;
        return { budget: b, category, spent, pct };
      })
      .filter(Boolean)
      .sort((a, b) => b!.pct - a!.pct) as BudgetRow[];
  }, [budgets, expenses, spendingByCat]);

  if (budgets.length === 0) return null;

  const worstRow = rows[0];
  const isOver   = worstRow?.pct > 1;
  const isNear   = worstRow?.pct > 0.7;

  if (!worstRow || !isNear) return null;

  const isOver2 = worstRow.pct > 1;
  const color   = worstRow.pct > 0.9 ? '#EF4444' : '#F59E0B';
  const emoji   = getCategoryEmoji(worstRow.category.name_es);
  const pctInt  = Math.round(worstRow.pct * 100);

  const title = isOver2
    ? `Te pasaste en ${worstRow.category.name_es}`
    : `Ojo con ${worstRow.category.name_es}`;
  const subtitle = isOver2
    ? `Superaste el límite por ${formatCurrency(Math.round(worstRow.spent - worstRow.budget.monthly_limit))}.`
    : `Ya usaste el ${pctInt}% del presupuesto.`;

  const bg     = isOver2 ? '#FEE2E2' : '#FFFBEB';
  const border = isOver2 ? '#FEE2E2' : '#E8E2D9';

  return (
    <TouchableOpacity style={[hw.card, { backgroundColor: bg, borderColor: border }]} onPress={onPress} activeOpacity={0.85}>
      <View style={[hw.emojiBox, { backgroundColor: color + '20' }]}>
        <Text style={hw.emoji}>{emoji}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={hw.label}>PRESUPUESTOS</Text>
        <Text style={hw.title} numberOfLines={1}>{title}</Text>
        <Text style={hw.subtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      <View style={hw.cta}>
        <Text style={[hw.ctaText, { color }]}>Ver</Text>
        <Ionicons name="chevron-forward" size={13} color={color} />
      </View>
    </TouchableOpacity>
  );
}

const hw = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], borderRadius: 14, padding: 14, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  emojiBox:{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emoji:   { fontSize: 20 },
  label:   { fontFamily: 'Montserrat_700Bold', fontSize: 9, color: '#9B9790', letterSpacing: 0.8 },
  title:   { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C', letterSpacing: -0.2 },
  subtitle:{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 17 },
  cta:     { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  ctaText: { fontFamily: 'Montserrat_700Bold', fontSize: 12 },
});
