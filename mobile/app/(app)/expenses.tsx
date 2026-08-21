import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import { ExpensesSkeletonLoader, SmartLoadingState } from '@/components/ui/SkeletonLoader';
import { useRouter } from 'expo-router';
import {
  View,
  ScrollView,
  FlatList,
  SectionList,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
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
import { Text, Button, Input, Badge, FormSheetModal } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { useRoundUpStore } from '@/store/roundUpStore';
import { useStreakStore } from '@/store/streakStore';
import { hapticMedium, hapticWarning, hapticSuccess } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/utils/format';
import type { PaymentMethod, Expense, ExpenseClassification } from '@/types';
import { PendingTransactions } from '@/components/PendingTransactions';
import { CategoryIcon } from '@/components/CategoryIcon';
import { BudgetRingIndicator } from '@/components/BudgetCard';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { FirstVisitSheet } from '@/components/FirstVisitSheet';
import { useSavingsStore } from '@/store/savingsStore';
import { InflationThermometer } from '@/components/InflationThermometer';
import { DecisionHistorySection, buildOpportunities } from '@/components/DecisionHistory';
import { fetchBudgetPlan, type BudgetPlan } from '@/lib/budgetPlan';
import { computeFinancialDiagnosis } from '@/lib/financialDiagnosis';
import {
  MONTH_NAMES, PALETTE, getCategoryColor, type CategoryRow, type MonthSummary,
  buildComparacion, buildAhorroSugerencias, buildPlanProximoMes, buildObjetivo,
  ResumenCard, CategoryBreakdown, HistoryComparisonCard,
  PlanProximoMesCard, ObjetivoCard, AdvisorCTA,
} from '@/components/ReportCards';

// ─── Category Donut Chart ─────────────────────────────────────────────────────

function buildSegments(rows: CategoryRow[], total: number, maxCats = 8) {
  const top  = rows.slice(0, maxCats);
  const rest = rows.slice(maxCats).reduce((s, r) => s + r.amount, 0);
  return [
    ...top,
    ...(rest > 0 ? [{ id: 'otros', name: 'Otros', color: '#9B9790', amount: rest, pct: rest / total }] : []),
  ] as CategoryRow[];
}

function CategoryDonut({ rows, total, compact = false }: {
  rows: CategoryRow[]; total: number; compact?: boolean;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (rows.length === 0 || total === 0) return null;

  const SIZE = compact ? 96  : 176;
  const R    = compact ? 34  : 68;
  const SW   = compact ? 10  : 18;
  const CX   = SIZE / 2;
  const CIRC = 2 * Math.PI * R;
  const segments = buildSegments(rows, total, compact ? 6 : 8);
  const GAP_LEN  = ((compact ? 3 : 2.5) / 360) * CIRC;

  const sel = selectedIdx !== null ? segments[selectedIdx] : null;

  // Detecta qué segmento corresponde al punto tocado en el donut
  const hitTest = (locationX: number, locationY: number) => {
    const dx = locationX - CX;
    const dy = locationY - CX;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const innerR = R - SW / 2 - 4;
    const outerR = R + SW / 2 + 4;
    if (dist < innerR || dist > outerR) return null; // fuera del anillo

    // Ángulo desde la parte superior (12 o'clock), en sentido horario
    let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    let cumulative = 0;
    for (let i = 0; i < segments.length; i++) {
      const segDeg = (segments[i].amount / total) * 360;
      if (angle >= cumulative && angle < cumulative + segDeg) return i;
      cumulative += segDeg;
    }
    return null;
  };

  const touchHandlers = compact ? {} : {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder:  () => true,
    onResponderGrant: (e: any) => {
      const idx = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY);
      setSelectedIdx(idx);
    },
    onResponderMove: (e: any) => {
      const idx = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY);
      if (idx !== null) setSelectedIdx(idx);
    },
    onResponderRelease: () => {
      // mantiene la selección visible para leer; se limpia con tap en leyenda
    },
  };

  let offset = 0;

  return (
    <View style={compact ? cdS.wrapCompact : cdS.wrap}>
      {/* Donut ring + overlay táctil */}
      <View
        style={{ position: 'relative', width: SIZE, height: SIZE, alignSelf: compact ? undefined : 'center' }}
        {...touchHandlers}
      >
        <Svg width={SIZE} height={SIZE}>
          <SvgCircle cx={CX} cy={CX} r={R} fill="none" stroke={colors.border.subtle} strokeWidth={SW} />
          {segments.map((seg, i) => {
            const len    = Math.max(0, (seg.amount / total) * CIRC - GAP_LEN);
            const off    = -offset;
            offset += (seg.amount / total) * CIRC;
            const dimmed = selectedIdx !== null && selectedIdx !== i;
            return (
              <SvgCircle
                key={i} cx={CX} cy={CX} r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth={selectedIdx === i ? SW + 4 : SW}
                strokeDasharray={`${len} ${CIRC - len}`}
                strokeDashoffset={off}
                strokeLinecap="butt"
                rotation="-90" origin={`${CX},${CX}`}
                opacity={dimmed ? 0.25 : 1}
              />
            );
          })}
        </Svg>

        {/* Centro: info del segmento seleccionado o total */}
        <View style={[StyleSheet.absoluteFill, cdS.center]} pointerEvents="none">
          {compact ? (
            <Text style={cdS.centerAmountSm} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {formatCurrency(total).replace('$ ', '$')}
            </Text>
          ) : sel ? (
            <>
              <Text style={[cdS.centerLabel, { color: sel.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {sel.name.toUpperCase()}
              </Text>
              <Text style={[cdS.centerPct, { color: sel.color }]}>
                {Math.round(sel.pct * 100)}%
              </Text>
              <Text style={cdS.centerSub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatCurrency(sel.amount).replace('$ ', '$')}
              </Text>
            </>
          ) : (
            <>
              <Text style={cdS.centerLabel}>TOTAL</Text>
              <Text style={cdS.centerAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {formatCurrency(total).replace('$ ', '$')}
              </Text>
              {!compact && (
                <Text style={cdS.centerHint}>toca el gráfico</Text>
              )}
            </>
          )}
        </View>
      </View>

      {/* Leyenda — solo en modo full; tap para seleccionar / deseleccionar */}
      {!compact && (
        <View style={cdS.legend}>
          {segments.map((seg, i) => {
            const isSelected = selectedIdx === i;
            const isDimmed   = selectedIdx !== null && !isSelected;
            return (
              <TouchableOpacity
                key={i}
                style={[cdS.legendItem, isSelected && { backgroundColor: seg.color + '18', borderRadius: 8 }]}
                onPress={() => setSelectedIdx(isSelected ? null : i)}
                activeOpacity={0.7}
              >
                <View style={[cdS.legendDot, { backgroundColor: seg.color, opacity: isDimmed ? 0.3 : 1 }]} />
                <Text style={[cdS.legendName, isDimmed && { opacity: 0.35 }]} numberOfLines={1}>{seg.name}</Text>
                <Text style={[cdS.legendPct, { color: isSelected ? seg.color : (isDimmed ? colors.text.tertiary : seg.color) }]}>
                  {Math.round(seg.pct * 100)}%
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const cdS = StyleSheet.create({
  wrap:          { gap: 20 },
  wrapCompact:   {},
  center:        { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  centerLabel:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 10, color: colors.text.tertiary, letterSpacing: 0.6, textAlign: 'center' },
  centerPct:     { fontFamily: 'Montserrat_800ExtraBold', fontSize: 26, lineHeight: 32, marginTop: 1 },
  centerAmount:  { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: colors.text.primary, marginTop: 2 },
  centerSub:     { fontFamily: 'Montserrat_500Medium', fontSize: 10, color: colors.text.secondary, marginTop: 2, textAlign: 'center' },
  centerHint:    { fontFamily: 'Montserrat_400Regular', fontSize: 9, color: colors.text.tertiary, marginTop: 3, letterSpacing: 0.3 },
  centerAmountSm:{ fontFamily: 'Montserrat_700Bold', fontSize: 9, color: colors.text.primary, textAlign: 'center', paddingHorizontal: 4 },
  legend:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 5, width: '47%', paddingVertical: 3, paddingHorizontal: 4 },
  legendDot:     { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendName:    { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 11, color: colors.text.secondary },
  legendPct:     { fontFamily: 'Montserrat_700Bold', fontSize: 11, flexShrink: 0 },
});

// ─────────────────────────────────────────────────────────────────────────────

const PM_LABELS: Record<string, string> = {
  cash: 'Efectivo', debit: 'Débito', credit: 'Crédito',
  transfer: 'Transferencia', digital_wallet: 'Billetera', other: 'Otro',
};

function getCategoryEmoji(name: string, description?: string): string {
  const n = (name + ' ' + (description ?? '')).toLowerCase();
  if (n.includes('comida') || n.includes('restaur') || n.includes('almuerzo') || n.includes('cena') || n.includes('pizza') || n.includes('sushi') || n.includes('burger') || n.includes('hambur') || n.includes('delivery')) return '🍔';
  if (n.includes('supermercado') || n.includes('mercado') || n.includes('verduleria') || n.includes('compra')) return '🛒';
  if (n.includes('transporte') || n.includes('uber') || n.includes('taxi') || n.includes('remis') || n.includes('nafta') || n.includes('subte') || n.includes('colect') || n.includes('tren') || n.includes('auto')) return '🚕';
  if (n.includes('salud') || n.includes('farmacia') || n.includes('medico') || n.includes('médico') || n.includes('doctor') || n.includes('clinica') || n.includes('hospital')) return '🩺';
  if (n.includes('entretenimiento') || n.includes('cine') || n.includes('teatro') || n.includes('juego') || n.includes('netflix') || n.includes('spotify') || n.includes('streaming')) return '🎮';
  if (n.includes('ropa') || n.includes('calzado') || n.includes('zapato') || n.includes('zapatilla') || n.includes('indumentaria')) return '👗';
  if (n.includes('viaje') || n.includes('hotel') || n.includes('vuelo') || n.includes('airbnb') || n.includes('turismo')) return '✈️';
  if (n.includes('educacion') || n.includes('educación') || n.includes('curso') || n.includes('libro') || n.includes('universidad') || n.includes('colegio')) return '📚';
  if (n.includes('mascota') || n.includes('veterinar') || n.includes('perro') || n.includes('gato')) return '🐾';
  if (n.includes('gym') || n.includes('deporte') || n.includes('fitness') || n.includes('cancha')) return '🏋️';
  if (n.includes('bar') || n.includes('cerveza') || n.includes('trago') || n.includes('boliche') || n.includes('disco')) return '🍻';
  if (n.includes('café') || n.includes('cafe') || n.includes('starbucks') || n.includes('cafeteria')) return '☕';
  if (n.includes('luz') || n.includes('gas') || n.includes('agua') || n.includes('internet') || n.includes('servicio') || n.includes('telefono') || n.includes('teléfono')) return '💡';
  if (n.includes('alquiler') || n.includes('expensa') || n.includes('inmobiliaria')) return '🏠';
  if (n.includes('tecnolog') || n.includes('celular') || n.includes('computador') || n.includes('electronica')) return '📱';
  if (n.includes('regalo') || n.includes('cumple') || n.includes('fiesta')) return '🎁';
  if (n.includes('banco') || n.includes('tarjeta') || n.includes('prestamo') || n.includes('cuota')) return '💳';
  if (n.includes('seguro')) return '🛡️';
  return '🧾';
}

// ─── Category match scoring: historial primero, luego keywords ────────────────

function normalizeDesc(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function descSimilarity(a: string, b: string): number {
  const na = normalizeDesc(a);
  const nb = normalizeDesc(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 88;
  // palabras significativas en común (4+ chars)
  const wordsA = na.split(/\s+/).filter(w => w.length >= 4);
  const wordsB = new Set(nb.split(/\s+/).filter(w => w.length >= 4));
  const shared = wordsA.filter(w => wordsB.has(w)).length;
  if (shared >= 2) return 75;
  if (shared === 1) return 55;
  return 0;
}

function computeCategoryMatches(
  description: string,
  categories: any[],
  pastExpenses: any[] = [],
): Array<{ category: any; score: number; fromHistory: boolean }> {
  // ── 1. Buscar en historial clasificado ────────────────────────────────────
  const histScores: Record<string, number> = {}; // categoryId → max score
  for (const exp of pastExpenses) {
    if (!exp.category_id || !exp.description) continue;
    const sim = descSimilarity(description, exp.description);
    if (sim > 0) {
      histScores[exp.category_id] = Math.max(histScores[exp.category_id] ?? 0, sim);
    }
  }

  // ── 2. Keywords como fallback ─────────────────────────────────────────────
  const desc = normalizeDesc(description);
  const kws: Record<string, string[]> = {
    'comida y restaurantes': ['restaurante', 'comida', 'almuerzo', 'cena', 'pizza', 'sushi', 'burger', 'hambur', 'delivery', 'pedidosya', 'rappi', 'mcdonalds', 'kfc'],
    'supermercado': ['supermercado', 'mercado', 'verduleria', 'carrefour', 'jumbo', 'coto', 'changomas', 'disco '],
    'café y bebidas': ['cafe', 'cafe', 'starbucks', 'cafeteria', 'coffee', 'tostado'],
    'transporte': ['uber', 'taxi', 'remis', 'subte', 'colect', 'tren', 'nafta', 'combustible', 'peaje', 'cabify', 'didi'],
    'salud': ['farmacia', 'medico', 'doctor', 'clinica', 'hospital', 'turno', 'consulta', 'dentista', 'odontologo'],
    'entretenimiento': ['cine', 'teatro', 'netflix', 'spotify', 'disney', 'streaming', 'juego', 'steam', 'playstation', 'prime'],
    'ropa y moda': ['ropa', 'calzado', 'zapato', 'zapatilla', 'indumentaria', 'zara', 'moda', 'prenda'],
    'hogar y servicios': ['alquiler', 'expensa', 'inmobiliaria', 'luz ', 'gas ', 'agua ', 'internet', 'telefono', 'plomero', 'electricista', 'servicio'],
    'educacion': ['curso', 'libro', 'universidad', 'colegio', 'escuela', 'ingles', 'idioma', 'udemy', 'capacitacion'],
    'deporte y gym': ['gym', 'deporte', 'fitness', 'cancha', 'natacion', 'pileta', 'yoga', 'running', 'atletismo'],
    'viajes y alojamiento': ['hotel', 'vuelo', 'airbnb', 'turismo', 'viaje', 'agencia', 'aerolinea', 'alojamiento'],
    'seguros': ['seguro', 'poliza', 'cobertura'],
    'suscripciones': ['suscripcion', 'membresia', 'renovacion'],
    'bancos y finanzas': ['banco', 'tarjeta', 'prestamo', 'cuota', 'credito', 'debito', 'comision'],
    'impuestos': ['impuesto', 'afip', 'arba', 'iva', 'monotributo', 'tributo'],
    'regalos': ['regalo', 'cumple', 'fiesta', 'sorpresa'],
    'cuidado personal': ['peluqueria', 'barberia', 'estetica', 'cosmetica', 'spa', 'masaje', 'peluquer'],
    'ocio y salidas': ['bar', 'boliche', 'disco', 'salida', 'cerveza', 'trago', 'pub'],
  };

  const result: Array<{ category: any; score: number; fromHistory: boolean }> = [];

  for (const cat of categories) {
    const histScore = histScores[cat.id] ?? 0;
    if (histScore > 0) {
      result.push({ category: cat, score: histScore, fromHistory: true });
      continue;
    }
    const catName = normalizeDesc(cat.name_es ?? '');
    let kwScore = 0;
    const catKws = kws[catName] ?? catName.split(/[\s&\/]+/).filter((w: string) => w.length > 3);
    for (const kw of catKws) { if (desc.includes(kw)) { kwScore = 85; break; } }
    if (kwScore === 0) {
      for (const w of catName.split(/[\s&\/]+/)) {
        if (w.length > 3 && desc.includes(w)) { kwScore = 60; break; }
      }
    }
    if (kwScore > 0) result.push({ category: cat, score: kwScore, fromHistory: false });
  }

  return result
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, score: Math.max(30, r.score - i * 3) }));
}

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
              <Text style={detStyles.barName} numberOfLines={2} ellipsizeMode="tail">{row.name}</Text>
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
  barAmount: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: colors.text.secondary, textAlign: 'right', flexShrink: 0 },
  barTrack:  { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  barFill:   { height: '100%', borderRadius: 3 },

  // Reports CTA
  reportCta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    justifyContent: 'center',
    borderWidth: 1, borderColor: colors.primary + '40',
    borderRadius: 12, paddingVertical: spacing[4],
    backgroundColor: colors.primary + '0A',
  },
});

// ─── MonthSelector ────────────────────────────────────────────────────────────

const MONTH_NAMES_SHORT = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MAX_MONTHS_BACK   = 11;

function MonthSelector({
  selected,
  onSelect,
}: {
  selected: { month: number; year: number };
  onSelect: (month: number, year: number) => void;
}) {
  const now   = new Date();
  const isNow = selected.month === now.getMonth() + 1 && selected.year === now.getFullYear();

  // how many months back from today is this selection?
  const monthsBack = (now.getFullYear() - selected.year) * 12 + (now.getMonth() + 1 - selected.month);
  const canGoBack  = monthsBack < MAX_MONTHS_BACK;

  const goBack = () => {
    if (!canGoBack) return;
    if (selected.month === 1) onSelect(12, selected.year - 1);
    else onSelect(selected.month - 1, selected.year);
  };

  const goForward = () => {
    if (isNow) return;
    if (selected.month === 12) onSelect(1, selected.year + 1);
    else onSelect(selected.month + 1, selected.year);
  };

  const label = `${MONTH_NAMES_SHORT[selected.month - 1]} ${selected.year}`;

  return (
    <View style={msStyles.row}>
      <TouchableOpacity
        style={[msStyles.arrow, !canGoBack && msStyles.arrowDisabled]}
        onPress={goBack}
        disabled={!canGoBack}
        hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
      >
        <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.text.primary : colors.text.tertiary} />
      </TouchableOpacity>

      <Text style={msStyles.label}>{label}</Text>

      <TouchableOpacity
        style={[msStyles.arrow, isNow && msStyles.arrowDisabled]}
        onPress={goForward}
        disabled={isNow}
        hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
      >
        <Ionicons name="chevron-forward" size={20} color={isNow ? colors.text.tertiary : colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}

const msStyles = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingVertical: spacing[2] },
  label:        { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: colors.text.primary, minWidth: 160, textAlign: 'center' },
  arrow:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, alignItems: 'center', justifyContent: 'center' },
  arrowDisabled:{ opacity: 0.35 },
});

// ─── AnalysisTeaser ────────────────────────────────────────────────────────────

function AnalysisTeaser({ recuperable, onPress }: { recuperable: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={teaserS.card} onPress={onPress} activeOpacity={0.85}>
      <View style={teaserS.iconWrap}>
        <Ionicons name="analytics-outline" size={22} color="#27AE60" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={teaserS.title}>Tu análisis ya está listo</Text>
        {recuperable > 0 && (
          <Text style={teaserS.amount}>Encontramos {formatCurrency(recuperable)} para recuperar</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#6D6A63" />
    </TouchableOpacity>
  );
}

const teaserS = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#D1F7E3', borderRadius: 16, padding: 14, marginTop: 8, marginBottom: 8 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#A8D5C2', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:    { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#1C1C1C' },
  amount:   { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#27AE60' },
});

// ─── ShareInGroupModal ────────────────────────────────────────────────────────

const SHARE_PURPLE    = '#27AE60';
const SHARE_PURPLE_LT = '#D1F7E3';

function ShareInGroupModal({ visible, expense, userId, onClose }: {
  visible:  boolean;
  expense:  Expense | null;
  userId:   string;
  onClose:  () => void;
}) {
  type ShareStep = 'group' | 'details' | 'confirm';
  interface FriendGroup { id: string; name: string; memberCount: number; members: { userId: string; name: string; color: string; initial: string; isMe: boolean }[] }

  const AVATAR_COLORS = ['#27AE60', '#e63946', '#2d6a4f', '#f4a261', '#F59E0B', '#10B981'];
  function hashIdx(str: string, len: number) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return Math.abs(h) % len;
  }

  const [step,        setStep]        = useState<ShareStep>('group');
  const [groups,      setGroups]      = useState<FriendGroup[]>([]);
  const [loadingGrp,  setLoadingGrp]  = useState(false);
  const [selectedGrp, setSelectedGrp] = useState<FriendGroup | null>(null);
  const [paidById,    setPaidById]    = useState(userId);
  const [included,    setIncluded]    = useState<Set<string>>(new Set());
  const [splitMode,   setSplitMode]   = useState<'equal' | 'custom'>('equal');
  const [saving,      setSaving]      = useState(false);
  const [confirmed,   setConfirmed]   = useState(false);

  const reset = useCallback(() => {
    setStep('group'); setGroups([]); setSelectedGrp(null);
    setPaidById(userId); setIncluded(new Set());
    setSplitMode('equal'); setSaving(false); setConfirmed(false);
  }, [userId]);

  useEffect(() => {
    if (!visible) { reset(); return; }
    setLoadingGrp(true);
    (async () => {
      try {
        const { data: memberships } = await (supabase as any)
          .from('family_members')
          .select('group_id, family_groups(id, name, group_type)')
          .eq('user_id', userId);
        const friendGroups = (memberships ?? [])
          .filter((m: any) => m.family_groups?.group_type === 'friends')
          .map((m: any) => m.family_groups);

        const result: FriendGroup[] = [];
        for (const fg of friendGroups) {
          const { data: members } = await (supabase as any)
            .rpc('get_group_members', { p_group_id: fg.id });
          const memberList = (members ?? []).map((m: any) => {
            const name = m.full_name?.trim() || m.email?.split('@')[0] || 'Usuario';
            return {
              userId: m.user_id, name,
              color: AVATAR_COLORS[hashIdx(m.user_id, AVATAR_COLORS.length)],
              initial: name.charAt(0).toUpperCase(),
              isMe: m.user_id === userId,
            };
          });
          result.push({ id: fg.id, name: fg.name, memberCount: memberList.length, members: memberList });
        }
        setGroups(result);
      } finally {
        setLoadingGrp(false);
      }
    })();
  }, [visible, userId, reset]);

  const handleSelectGroup = (grp: FriendGroup) => {
    setSelectedGrp(grp);
    setPaidById(userId);
    setIncluded(new Set(grp.members.map(m => m.userId)));
  };

  const handleContinueToDetails = async () => {
    if (!selectedGrp || !expense) return;
    // Check for duplicate
    const { data: existing } = await (supabase as any)
      .from('group_expenses')
      .select('id')
      .eq('group_id', selectedGrp.id)
      .eq('source_expense_id', expense.id)
      .maybeSingle();
    if (existing) {
      Alert.alert('Ya compartido', 'Este gasto ya fue compartido en este grupo.');
      return;
    }
    setStep('details');
  };

  const handleSave = async () => {
    if (!selectedGrp || !expense) return;
    const participantes = selectedGrp.members.filter(m => included.has(m.userId));
    if (participantes.length === 0) { Alert.alert('Seleccioná al menos un participante.'); return; }
    setSaving(true);
    try {
      const { data: ge, error: e1 } = await (supabase as any)
        .from('group_expenses')
        .insert({
          group_id:          selectedGrp.id,
          source_expense_id: expense.id,
          paid_by:           paidById,
          description:       expense.description,
          amount:            expense.amount,
          date:              expense.date,
          split_type:        splitMode,
          created_by:        userId,
        })
        .select().single();
      if (e1) throw e1;

      const splitAmt = expense.amount / participantes.length;
      const splits = participantes.map(m => ({
        group_expense_id: ge.id, user_id: m.userId,
        amount: parseFloat(splitAmt.toFixed(2)), settled: m.userId === paidById,
      }));
      const { error: e2 } = await (supabase as any).from('group_expense_splits').insert(splits);
      if (e2) throw e2;

      setConfirmed(true);
      setStep('confirm');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo compartir el gasto.');
    } finally {
      setSaving(false);
    }
  };

  if (!expense) return null;
  const members = selectedGrp?.members ?? [];
  const splitAmt = members.filter(m => included.has(m.userId)).length > 0
    ? expense.amount / members.filter(m => included.has(m.userId)).length
    : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={shareStyles.modal}>

          <View style={shareStyles.header}>
            {step === 'confirm' ? (
              <View style={{ width: 22 }} />
            ) : (
              <TouchableOpacity
                onPress={step === 'group' ? onClose : () => setStep(step === 'details' ? 'group' : 'group')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name={step === 'group' ? 'close' : 'arrow-back'} size={22} color="#444" />
              </TouchableOpacity>
            )}
            <Text style={shareStyles.headerTitle}>
              {step === 'group' ? 'Compartir en grupo' : step === 'details' ? 'Detalles del gasto' : 'Gasto compartido'}
            </Text>
            <View style={{ width: 22 }} />
          </View>

          {/* Step: choose group */}
          {step === 'group' && (
            <ScrollView contentContainerStyle={shareStyles.body}>
              {/* Expense preview */}
              <View style={shareStyles.expPreview}>
                <View style={{ flex: 1 }}>
                  <Text style={shareStyles.expPreviewName} numberOfLines={1}>{expense.description}</Text>
                  <Text style={shareStyles.expPreviewMeta}>{expense.date}</Text>
                </View>
                <Text style={shareStyles.expPreviewAmt}>{formatCurrency(expense.amount)}</Text>
              </View>

              <Text style={shareStyles.sectionLabel}>ELEGIR GRUPO DE AMIGOS</Text>

              {loadingGrp ? (
                <ActivityIndicator color={SHARE_PURPLE} style={{ marginTop: 32 }} />
              ) : groups.length === 0 ? (
                <View style={shareStyles.emptyBox}>
                  <Ionicons name="people-outline" size={36} color="#E5E7EB" />
                  <Text style={shareStyles.emptyTitle}>Sin grupos de amigos</Text>
                  <Text style={shareStyles.emptySub}>Creá un grupo de amigos primero desde la sección Grupos.</Text>
                </View>
              ) : (
                <View style={shareStyles.card}>
                  {groups.map((grp, i) => (
                    <View key={grp.id}>
                      {i > 0 && <View style={shareStyles.divider} />}
                      <TouchableOpacity
                        style={shareStyles.groupRow}
                        onPress={() => handleSelectGroup(grp)}
                        activeOpacity={0.8}
                      >
                        <View style={shareStyles.groupIcon}>
                          <Ionicons name="people" size={20} color={SHARE_PURPLE} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={shareStyles.groupName}>{grp.name}</Text>
                          <Text style={shareStyles.groupMeta}>{grp.memberCount} miembro{grp.memberCount !== 1 ? 's' : ''}</Text>
                        </View>
                        {selectedGrp?.id === grp.id
                          ? <Ionicons name="checkmark-circle" size={22} color={SHARE_PURPLE} />
                          : <Ionicons name="chevron-forward" size={18} color="#9B9790" />
                        }
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[shareStyles.btn, !selectedGrp && { opacity: 0.4 }]}
                onPress={handleContinueToDetails} disabled={!selectedGrp} activeOpacity={0.85}
              >
                <Text style={shareStyles.btnText}>Continuar</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Step: details */}
          {step === 'details' && selectedGrp && (
            <ScrollView contentContainerStyle={shareStyles.body} keyboardShouldPersistTaps="handled">
              <View style={shareStyles.expPreview}>
                <View style={{ flex: 1 }}>
                  <Text style={shareStyles.expPreviewName} numberOfLines={1}>{expense.description}</Text>
                  <Text style={shareStyles.expPreviewMeta}>{selectedGrp.name} · {expense.date}</Text>
                </View>
                <Text style={shareStyles.expPreviewAmt}>{formatCurrency(expense.amount)}</Text>
              </View>

              {/* Quién pagó */}
              <Text style={shareStyles.sectionLabel}>¿QUIÉN PAGÓ?</Text>
              <View style={shareStyles.card}>
                {members.map((m, i) => (
                  <View key={m.userId}>
                    {i > 0 && <View style={shareStyles.divider} />}
                    <TouchableOpacity style={shareStyles.memberRow} onPress={() => setPaidById(m.userId)} activeOpacity={0.8}>
                      <View style={[shareStyles.avatar, { backgroundColor: m.color + '22' }]}>
                        <Text style={[shareStyles.avatarText, { color: m.color }]}>{m.initial}</Text>
                      </View>
                      <Text style={shareStyles.memberName}>{m.isMe ? `${m.name} (vos)` : m.name}</Text>
                      {paidById === m.userId && <Ionicons name="checkmark-circle" size={20} color={SHARE_PURPLE} />}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              {/* Entre quiénes */}
              <Text style={shareStyles.sectionLabel}>¿ENTRE QUIÉNES SE DIVIDE?</Text>
              <View style={shareStyles.avatarRow}>
                {members.map(m => {
                  const isIn = included.has(m.userId);
                  return (
                    <TouchableOpacity
                      key={m.userId}
                      onPress={() => setIncluded(prev => {
                        const next = new Set(prev);
                        if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId);
                        return next;
                      })}
                      activeOpacity={0.8}
                      style={{ alignItems: 'center', gap: 4 }}
                    >
                      <View style={[
                        shareStyles.avatar, { width: 50, height: 50, borderRadius: 25, backgroundColor: m.color + '22' },
                        isIn && { borderWidth: 2.5, borderColor: SHARE_PURPLE },
                        !isIn && { opacity: 0.35 },
                      ]}>
                        <Text style={[shareStyles.avatarText, { color: m.color, fontSize: 18 }]}>{m.initial}</Text>
                      </View>
                      <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 10, color: isIn ? '#111' : '#9B9790' }}>
                        {m.isMe ? 'Vos' : m.name.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Split mode */}
              <Text style={shareStyles.sectionLabel}>¿CÓMO SE DIVIDE?</Text>
              {([
                { val: 'equal'  as const, label: 'Partes iguales', desc: `${formatCurrency(splitAmt)} c/u` },
                { val: 'custom' as const, label: 'Personalizado',  desc: 'Definir montos diferentes' },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.val}
                  style={[shareStyles.radioRow, splitMode === opt.val && { borderColor: SHARE_PURPLE + '80', backgroundColor: SHARE_PURPLE + '06' }]}
                  onPress={() => setSplitMode(opt.val)} activeOpacity={0.8}
                >
                  <View style={[shareStyles.radioCircle, splitMode === opt.val && { borderColor: SHARE_PURPLE }]}>
                    {splitMode === opt.val && <View style={[shareStyles.radioDot, { backgroundColor: SHARE_PURPLE }]} />}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[shareStyles.radioTitle, splitMode === opt.val && { color: SHARE_PURPLE }]}>{opt.label}</Text>
                    <Text style={shareStyles.radioDesc}>{opt.desc}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={[shareStyles.btn, saving && { opacity: 0.5 }]}
                onPress={handleSave} disabled={saving || included.size === 0} activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={shareStyles.btnText}>Guardar gasto</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Step: confirm */}
          {step === 'confirm' && (
            <ScrollView contentContainerStyle={[shareStyles.body, { alignItems: 'center', paddingTop: 40 }]}>
              <Ionicons name="checkmark-circle" size={80} color={SHARE_PURPLE} />
              <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 22, color: '#111', textAlign: 'center', marginTop: 12 }}>
                ¡Gasto compartido!
              </Text>
              <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#9B9790', textAlign: 'center' }}>
                El gasto se agregó correctamente al grupo {selectedGrp?.name}.
              </Text>
              <TouchableOpacity
                style={[shareStyles.btn, { width: '100%', marginTop: 32 }]}
                onPress={() => { reset(); onClose(); }} activeOpacity={0.85}
              >
                <Text style={shareStyles.btnText}>Listo</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const shareStyles = StyleSheet.create({
  modal:        { flex: 1, backgroundColor: '#FFFFFF' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#E8E2D9' },
  headerTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 17, color: '#111' },
  body:         { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60, gap: 16 },
  sectionLabel: { fontFamily: 'Montserrat_700Bold', fontSize: 10, color: '#9B9790', letterSpacing: 0.8 },
  card:         { backgroundColor: '#FAFAF7', borderWidth: 1, borderColor: '#E8E2D9', borderRadius: 16 },
  divider:      { height: 1, backgroundColor: '#E8E2D9' },
  emptyBox:     { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle:   { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#111' },
  emptySub:     { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: '#9B9790', textAlign: 'center' },
  expPreview:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#D1F7E3', borderWidth: 1, borderColor: SHARE_PURPLE + '30', borderRadius: 14, padding: 14 },
  expPreviewName: { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#111' },
  expPreviewMeta: { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' },
  expPreviewAmt:  { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: SHARE_PURPLE, flexShrink: 0 },
  groupRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  groupIcon:    { width: 40, height: 40, borderRadius: 12, backgroundColor: SHARE_PURPLE + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  groupName:    { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#111' },
  groupMeta:    { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' },
  memberRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  memberName:   { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#111', flex: 1 },
  avatar:       { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:   { fontFamily: 'Montserrat_700Bold', fontSize: 15 },
  avatarRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  radioRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#E8E2D9', padding: 14, backgroundColor: '#fff' },
  radioCircle:  { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#E8E2D9', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  radioDot:     { width: 10, height: 10, borderRadius: 5 },
  radioTitle:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: '#111' },
  radioDesc:    { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9B9790' },
  btn:          { backgroundColor: SHARE_PURPLE, borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: SHARE_PURPLE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  btnText:      { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#fff' },
});

// ─── SinClasifInbox ───────────────────────────────────────────────────────────

function SinClasifInbox({ expenses, pendingTxs, categories, userId, onClassify, onConfirmedPending }: {
  expenses: Expense[];
  pendingTxs: any[];
  categories: any[];
  userId: string;
  onClassify: (e: Expense) => void;
  onConfirmedPending: () => void;
}) {
  const unclassified = expenses.filter(e => e.category_id === null);
  const totalItems   = unclassified.length + pendingTxs.length;

  if (unclassified.length === 0 && pendingTxs.length === 0) {
    return (
      <View style={scModalS.empty}>
        <View style={scModalS.emptyIconCircle}>
          <Ionicons name="checkmark-circle" size={36} color="#27AE60" />
        </View>
        <Text style={scModalS.emptyTitle}>¡Todo clasificado!</Text>
        <Text style={scModalS.emptySub}>Tus gastos están todos organizados.</Text>
      </View>
    );
  }

  const progressPct = totalItems > 0 ? 0 : 100;

  return (
    <FlatList
      style={{ flex: 1 }}
      data={unclassified}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], gap: spacing[4] }}>
          {pendingTxs.length > 0 && userId && (
            <PendingTransactions
              transactions={pendingTxs}
              userId={userId}
              isPolling={false}
              categories={categories}
              confirmedExpenses={expenses.filter(e => e.category_id !== null).map(e => ({ amount: e.amount, date: e.date, description: e.description }))}
              onConfirmed={onConfirmedPending}
            />
          )}
          {unclassified.length > 0 && pendingTxs.length > 0 && (
            <View style={scModalS.sectionHeader}>
              <Text style={scModalS.sectionTitle}>Gastos manuales sin clasificar ({unclassified.length})</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={scModalS.card}
          onPress={() => onClassify(item)}
          activeOpacity={0.92}
        >
          <View style={scModalS.cardBody}>
            <View style={scModalS.cardMain}>
              <View style={scModalS.iconCircle}>
                <CategoryIcon description={item.description} size={28} />
              </View>
              <View style={scModalS.cardInfo}>
                <Text style={scModalS.merchantName} numberOfLines={1}>{item.description || 'Sin descripción'}</Text>
                <Text style={scModalS.dateLbl}>
                  {item.payment_method ? (PM_LABELS[item.payment_method] ?? item.payment_method) : formatDate(item.date)}
                </Text>
              </View>
              <View style={scModalS.cardRight}>
                <Text style={scModalS.amount}>-{formatCurrency(item.amount)}</Text>
                <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
              </View>
            </View>
            <View style={scModalS.clasificarRow}>
              <Ionicons name="pricetag-outline" size={14} color="#27AE60" />
              <Text style={scModalS.clasificarText}>Clasificar</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontSize: 11, color: '#27AE60', opacity: 0.55 }}>✦</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
      contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingBottom: spacing[8], gap: spacing[3] }}
      ListFooterComponent={
        <View style={scModalS.progressCard}>
          <View style={scModalS.progressIconCircle}>
            <Ionicons name="bar-chart-outline" size={20} color="#27AE60" />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={scModalS.progressTitle}>Progreso de clasificación</Text>
            <Text style={scModalS.progressSub}>
              0 de {totalItems} gastos · {totalItems > 0 ? '¡Casi listo!' : '¡Listo!'}
            </Text>
          </View>
          <View style={scModalS.progressCircle}>
            <Text style={scModalS.progressPct}>{progressPct}%</Text>
          </View>
        </View>
      }
    />
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const router = useRouter();
  const { isFirstVisit, markVisited } = useFirstVisit('expenses');
  const { user } = useAuthStore();
  const {
    expenses,
    categories,
    totalThisMonth,
    totalNecessary,
    totalDisposable,
    totalInvestable,
    estimatedIncome,
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
  } = useExpensesStore();

  const { rates, labels: dolarLabels } = useDolarRates();
  // dolarLabels viene del hook pero también exportamos DOLAR_LABELS directamente

  const roundUpStore  = useRoundUpStore();
  const streakStore   = useStreakStore();
  const { fetchAll: loadSavings } = useSavingsStore();

  useEffect(() => {
    roundUpStore.load();
    roundUpStore.checkReset();
    streakStore.load();
  }, []);

  const expenseSections = useMemo(() => {
    const grouped: Record<string, { date: string; items: Expense[]; total: number }> = {};
    for (const e of expenses) {
      if (!grouped[e.date]) grouped[e.date] = { date: e.date, items: [], total: 0 };
      grouped[e.date].items.push(e);
      grouped[e.date].total += e.amount;
    }
    return Object.values(grouped)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(g => ({ title: g.date, data: g.items, total: g.total }));
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

  // Compartir en grupo
  const [showShareModal,     setShowShareModal]      = useState(false);
  const [shareExpense,       setShareExpense]        = useState<Expense | null>(null);

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
        // Auto-guardar todos los gastos detectados sin pedir confirmación.
        // process-screenshot ya devuelve classification/category (mismo criterio
        // que gmail-poll) — antes se descartaban acá, a diferencia del flujo de
        // Gmail (PendingTransactions.tsx), que sí los conserva.
        for (const e of data.expenses) {
          const matchedCategory = categories.find((c: any) => c.name === e.category);
          await addExpense(user.id, {
            description: e.description,
            amount: e.amount,
            date: e.date,
            payment_method: 'digital_wallet',
            notes: null,
            is_recurring: false,
            classification: e.classification ?? null,
            category_id: matchedCategory?.id ?? null,
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
          } catch (err: any) {
            if (err?.code === 'GROUP_LINKED') {
              Alert.alert(
                'Gasto grupal',
                'Este gasto está compartido con un grupo. No podés eliminarlo desde tu vista personal para preservar el historial del grupo.',
                [{ text: 'Entendido' }],
              );
            } else {
              Alert.alert('Error', 'No se pudo eliminar el gasto.');
            }
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

  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPolling) {
      spinAnim.setValue(0);
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinAnim.setValue(0);
    }
  }, [isPolling]);
  const [inCoupleMode,  setInCoupleMode]  = useState(false);
  const [showSinClasifModal, setShowSinClasifModal] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  const loadPendingTxs = async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from('pending_transactions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('transaction_date', { ascending: false });
    setPendingTxs(data ?? []);
  };
  const [isShared,      setIsShared]      = useState(false);

  // ── Análisis integrado ──
  const now = new Date();
  const [activeView,      setActiveView]      = useState<'gastos' | 'analisis'>('gastos');
  const [reportTab,       setReportTab]       = useState<'resumen' | 'categorias' | 'oportunidades' | 'salud'>('resumen');
  const [reportRows,      setReportRows]      = useState<CategoryRow[]>([]);
  const [reportTotal,     setReportTotal]     = useState(0);
  const [history,         setHistory]         = useState<MonthSummary[]>([]);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [inflationRate,   setInflationRate]   = useState(0);
  const [fciRate,         setFciRate]         = useState(0.03);
  const [pastOppData,     setPastOppData]     = useState<{ monthKey: string; disposable: number; categories: Record<string, number> }[]>([]);
  const [smartPlan,       setSmartPlan]       = useState<BudgetPlan | null>(null);

  useEffect(() => {
    if (user?.id) fetchBudgetPlan(user.id).then(setSmartPlan);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchExpenses(user.id);
      fetchCategories();
      fetchSubscriptionsAndProjection(user.id);
      loadPendingTxs();
      pollGmail();
      checkCoupleMode(user.id);
    }
  }, [user?.id, filter]);

  const reportMonth    = filter.month ?? (now.getMonth() + 1);
  const reportYear     = filter.year  ?? now.getFullYear();
  const isCurrentMonth = reportMonth === now.getMonth() + 1 && reportYear === now.getFullYear();

  useEffect(() => {
    if (!user?.id) return;
    const rStart = `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`;
    const nm = reportMonth === 12 ? 1 : reportMonth + 1;
    const ny = reportMonth === 12 ? reportYear + 1 : reportYear;
    const rEnd = `${ny}-${String(nm).padStart(2, '0')}-01`;
    const oppStart = (() => {
      const d = new Date(reportYear, reportMonth - 4, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    setIsReportLoading(true);
    Promise.all([
      supabase.from('expenses').select('amount, category:expense_categories(id, name_es, color), classification').eq('user_id', user.id).is('deleted_at', null).not('category_id', 'is', null).gte('date', rStart).lt('date', rEnd),
      supabase.from('expenses').select('amount, date, classification').eq('user_id', user.id).is('deleted_at', null).gte('date', oppStart).lt('date', rStart),
      supabase.from('expenses').select('amount, date, classification, category:expense_categories(name_es)').eq('user_id', user.id).is('deleted_at', null).eq('classification', 'disposable').gte('date', oppStart).lt('date', rStart),
    ]).then(([mainRes, histRes, oppRes]) => {
      const map: Record<string, CategoryRow> = {};
      let sum = 0;
      for (const exp of mainRes.data ?? []) {
        const cat = (exp as any).category;
        const catId = cat?.id ?? 'none';
        if (!map[catId]) map[catId] = { id: catId, name: cat?.name_es ?? 'Sin categoría', color: getCategoryColor(cat?.name_es ?? 'otros', Object.keys(map).length), amount: 0, pct: 0 };
        map[catId].amount += (exp as any).amount;
        sum += (exp as any).amount;
      }
      setReportTotal(sum);
      setReportRows(Object.values(map).map(r => ({ ...r, pct: sum > 0 ? r.amount / sum : 0 })).sort((a, b) => b.amount - a.amount));

      const histMap: Record<string, MonthSummary> = {};
      for (const exp of (histRes.data ?? []) as any[]) {
        const key = exp.date.slice(0, 7);
        if (!histMap[key]) {
          const [y, m] = key.split('-').map(Number);
          histMap[key] = { monthKey: key, label: MONTH_NAMES[m - 1].slice(0, 3), total: 0, disposable: 0, necessary: 0, investable: 0 };
        }
        histMap[key].total += exp.amount;
        if (exp.classification === 'disposable') histMap[key].disposable += exp.amount;
        if (exp.classification === 'necessary')  histMap[key].necessary  += exp.amount;
        if (exp.classification === 'investable') histMap[key].investable += exp.amount;
      }
      setHistory(Object.values(histMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey)).slice(-3));

      const oppMap: Record<string, { monthKey: string; disposable: number; categories: Record<string, number> }> = {};
      for (const exp of (oppRes.data ?? []) as any[]) {
        const mk = exp.date.slice(0, 7);
        const catName = exp.category?.name_es ?? 'Prescindibles';
        if (!oppMap[mk]) oppMap[mk] = { monthKey: mk, disposable: 0, categories: {} };
        oppMap[mk].disposable += exp.amount;
        oppMap[mk].categories[catName] = (oppMap[mk].categories[catName] ?? 0) + exp.amount;
      }
      setPastOppData(Object.values(oppMap));

      (supabase as any).from('market_rates').select('instrument, rate_monthly').in('instrument', ['inflation', 'fci_mm']).then(({ data }: { data: { instrument: string; rate_monthly: number }[] | null }) => {
        if (!data) return;
        for (const row of data) {
          if (row.instrument === 'inflation') setInflationRate(Number(row.rate_monthly));
          if (row.instrument === 'fci_mm')   setFciRate(Number(row.rate_monthly));
        }
      });
    }).catch(err => console.error('[Gastos/Análisis]', err)).finally(() => setIsReportLoading(false));
  }, [user?.id, reportMonth, reportYear]);

  useEffect(() => { if (user?.id) loadSavings(user.id); }, [user?.id]);

  const checkCoupleMode = async (userId: string) => {
    const { data } = await (supabase as any)
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
    // Correr mp-poll en paralelo (silencioso, sin bloquear el spinner de Gmail)
    pollMp().catch(err => console.warn('[pollMp] background error:', err));

    setIsPolling(false);
  };

  const pollMp = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/mp-poll`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.new_found > 0) {
        console.log('[pollMp] Nuevos pendientes MP:', data.new_found);
        loadPendingTxs();
      }
    } catch (err) {
      console.warn('[pollMp] error:', err);
    }
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
      console.log('[pollGmail] gmail_connected:', data?.gmail_connected, '| new_found:', data?.new_found);
      loadPendingTxs();
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

      const savedExpense = await addExpense(user.id, {
        description:    data.description,
        amount:         finalAmount,
        date:           data.date,
        payment_method: selectedPayment,
        category_id:    selectedCategory ?? undefined,
        notes:          notesWithFx,
        is_recurring:   false,
      });

      // Gamificación — racha
      const classification = (savedExpense as any).classification ?? 'necessary';
      streakStore.recordExpense(data.date, classification as any);

      // Haptic según clasificación
      if (classification === 'disposable') {
        hapticWarning();   // vibración de alerta — es prescindible
      } else {
        hapticMedium();    // confirmación estándar
      }

      // Redondeo automático
      const roundedUp = await roundUpStore.recordExpense(finalAmount);
      if (roundedUp > 0) {
        hapticSuccess();   // logro — acumulaste más ahorro
        const dest = roundUpStore.destination === 'fci' ? 'FCI Money Market' : 'Ahorro en efectivo';
        Alert.alert(
          '🪙 Redondeo automático',
          `+$${roundedUp.toLocaleString('es-AR')} acumulados en ${dest}.`,
          [{ text: 'OK' }],
          { cancelable: true },
        );
      }

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

  const displayTotal      = isCurrentMonth ? totalThisMonth  : reportTotal;
  const displayNecessary  = isCurrentMonth ? totalNecessary  : 0;
  const displayDisposable = isCurrentMonth ? totalDisposable : 0;
  const displayInvestable = isCurrentMonth ? totalInvestable : 0;
  const displayIncome     = isCurrentMonth ? estimatedIncome : null;

  const ahorroSugerencias = useMemo(() => buildAhorroSugerencias({
    rows: reportRows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome,
  }), [reportRows, displayDisposable, displayTotal, displayIncome]);
  const totalRecuperable = ahorroSugerencias.reduce((s, sg) => s + sg.saving, 0);
  const comparacion      = useMemo(() => buildComparacion(history, displayTotal, displayDisposable), [history, displayTotal, displayDisposable]);
  const planItems        = useMemo(() => buildPlanProximoMes({ rows: reportRows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome, history }), [reportRows, displayDisposable, displayTotal, displayIncome, history]);
  const objetivo         = useMemo(() => buildObjetivo({ disposable: displayDisposable, total: displayTotal }), [displayDisposable, displayTotal]);

  // Category breakdown from already-fetched expenses (no extra DB call)
  const catBreakdown = useMemo<CategoryRow[]>(() => {
    const map: Record<string, CategoryRow> = {};
    let total = 0; let idx = 0;
    for (const e of expenses as any[]) {
      const catId   = e.category_id ?? 'none';
      const catName = e.category?.name_es ?? 'Sin categoría';
      if (!map[catId]) map[catId] = { id: catId, name: catName, color: getCategoryColor(catName, idx++), amount: 0, pct: 0 };
      map[catId].amount += e.amount;
      total += e.amount;
    }
    return Object.values(map).map(r => ({ ...r, pct: total > 0 ? r.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  // Category breakdown for active classification filter
  const catBreakdownFiltered = useMemo<CategoryRow[]>(() => {
    if (!classificationFilter) return catBreakdown;
    const map: Record<string, CategoryRow> = {};
    let total = 0; let idx = 0;
    for (const e of expenses as any[]) {
      if (e.classification !== classificationFilter) continue;
      const catId   = e.category_id ?? 'none';
      const catName = e.category?.name_es ?? 'Sin categoría';
      if (!map[catId]) map[catId] = { id: catId, name: catName, color: getCategoryColor(catName, idx++), amount: 0, pct: 0 };
      map[catId].amount += e.amount;
      total += e.amount;
    }
    return Object.values(map).map(r => ({ ...r, pct: total > 0 ? r.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
  }, [expenses, classificationFilter, catBreakdown]);

  const listHeader = (
    <>
      {/* Filtros de clasificación */}
      <View style={styles.filters}>
        {[
          { key: null, label: 'Todos' },
          { key: 'necessary', label: 'Necesarios' },
          { key: 'disposable', label: 'Prescindibles' },
          { key: 'investable', label: 'Invertibles' },
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
              style={{ fontSize: 9, letterSpacing: 0 }}
              color={classificationFilter === f.key ? colors.primary : colors.text.secondary}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Resumen del mes — diseño premium */}
      {(() => {
        const selectedMonth = filter.month ?? new Date().getMonth() + 1;
        const monthName     = MONTH_NAMES[selectedMonth - 1].toLowerCase();
        const prevMonthName = MONTH_NAMES[selectedMonth - 2 < 0 ? 11 : selectedMonth - 2].toLowerCase();
        const vsPrev        = comparacion?.vsPrev;
        const varPct        = vsPrev?.changePct ?? null;

        // ── Filtro activo: resumen de la clasificación con categorías ──────────
        if (classificationFilter) {
          const clsLabel = classificationFilter === 'necessary' ? 'necesarios'
            : classificationFilter === 'disposable' ? 'prescindibles'
            : 'invertibles';
          const clsTotal = classificationFilter === 'necessary' ? totalNecessary
            : classificationFilter === 'disposable' ? totalDisposable
            : totalInvestable;
          const topCatRows = catBreakdownFiltered.slice(0, 3);

          return (
            <View style={smS.card}>
              <View style={smS.body}>
                <View style={smS.left}>
                  <Text style={smS.title}>Resumen de {clsLabel}</Text>
                  <Text style={smS.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {formatCurrency(clsTotal)}
                  </Text>
                  {varPct !== null && (
                    <View style={smS.varRow}>
                      <Text style={[smS.varIcon, { color: varPct >= 0 ? '#FF7B7B' : '#4DC889' }]}>
                        {varPct >= 0 ? '▲' : '▼'}
                      </Text>
                      <Text style={[smS.varText, { color: varPct >= 0 ? '#FF7B7B' : '#4DC889' }]}>
                        {Math.abs(varPct)}% vs {prevMonthName}
                      </Text>
                    </View>
                  )}
                  <View style={smS.metricList}>
                    {topCatRows.map((cat) => (
                      <View key={cat.id} style={smS.metricRow}>
                        <View style={[smS.dot, { backgroundColor: cat.color }]} />
                        <Text style={smS.metricLabel} numberOfLines={1}>{cat.name}</Text>
                        <Text style={smS.metricAmount}>{formatCurrency(cat.amount)}</Text>
                        <Text style={[smS.metricPct, { color: cat.color }]}>{Math.round(cat.pct * 100)}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View style={smS.right}>
                  {clsTotal > 0
                    ? <CategoryDonut rows={catBreakdownFiltered} total={clsTotal} compact />
                    : <View style={smS.donutEmpty} />
                  }
                </View>
              </View>
            </View>
          );
        }

        // ── Sin filtro: donut de clasificaciones (Necesario/Prescindible/Invertible)
        const classifiedTotal = totalNecessary + totalDisposable + totalInvestable;
        const clsRows: CategoryRow[] = [
          { id: 'necessary',  name: 'Necesario',    color: '#5B9EF9', amount: totalNecessary,  pct: classifiedTotal > 0 ? totalNecessary  / classifiedTotal : 0 },
          { id: 'disposable', name: 'Prescindible', color: '#FF7B7B', amount: totalDisposable, pct: classifiedTotal > 0 ? totalDisposable / classifiedTotal : 0 },
          { id: 'investable', name: 'Invertible',   color: '#4DC889', amount: totalInvestable, pct: classifiedTotal > 0 ? totalInvestable / classifiedTotal : 0 },
        ].filter(r => r.amount > 0);
        return (
          <View style={smS.card}>
            <View style={smS.body}>
              {/* Izquierda — 60% */}
              <View style={smS.left}>
                <Text style={smS.title}>Resumen de {monthName}</Text>
                <Text style={smS.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {formatCurrency(totalThisMonth)}
                </Text>
                {varPct !== null && (
                  <View style={smS.varRow}>
                    <Text style={[smS.varIcon, { color: varPct >= 0 ? '#FF7B7B' : '#4DC889' }]}>
                      {varPct >= 0 ? '▲' : '▼'}
                    </Text>
                    <Text style={[smS.varText, { color: varPct >= 0 ? '#FF7B7B' : '#4DC889' }]}>
                      {Math.abs(varPct)}% vs {prevMonthName}
                    </Text>
                  </View>
                )}
                <View style={smS.metricList}>
                  {clsRows.map((r) => (
                    <View key={r.id} style={smS.metricRow}>
                      <View style={[smS.dot, { backgroundColor: r.color }]} />
                      <Text style={smS.metricLabel} numberOfLines={1}>{r.name}</Text>
                      <Text style={smS.metricAmount}>{formatCurrency(r.amount)}</Text>
                      <Text style={[smS.metricPct, { color: r.color }]}>{Math.round(r.pct * 100)}%</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* Derecha — donut de clasificaciones */}
              <View style={smS.right}>
                {classifiedTotal > 0
                  ? <CategoryDonut rows={clsRows} total={classifiedTotal} compact />
                  : <View style={smS.donutEmpty} />
                }
              </View>
            </View>
          </View>
        );
      })()}


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

      {/* Spinner de polling Gmail */}
      {isPolling && (
        <View style={{ paddingHorizontal: layout.screenPadding, marginBottom: spacing[2] }}>
          <SmartLoadingState text="Buscando gastos en Gmail..." />
        </View>
      )}

      {/* Card compacto: gastos por clasificar (unclassified + pending Gmail) */}
      {(() => {
        const sinClasifExpenses = expenses.filter(e => e.category_id === null);
        const totalPending = sinClasifExpenses.length + pendingTxs.length;
        if (totalPending === 0) return null;
        const totalSinClasif = sinClasifExpenses.reduce((s, e) => s + e.amount, 0)
          + pendingTxs.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
        const previewExpenses = sinClasifExpenses.slice(0, 3);
        return (
          <View style={{ paddingHorizontal: layout.screenPadding, marginBottom: spacing[3] }}>
            <TouchableOpacity
              style={sinClasifBannerS.card}
              onPress={() => setShowSinClasifModal(true)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={sinClasifBannerS.title}>Por clasificar</Text>
                  <View style={sinClasifBannerS.countBadge}>
                    <Text style={sinClasifBannerS.countText}>{totalPending}</Text>
                  </View>
                </View>
                <Text style={sinClasifBannerS.sub}>Tenés gastos sin categoría</Text>
                <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center', marginTop: 1 }}>
                  {previewExpenses.map((e) => (
                    <CategoryIcon key={e.id} description={e.description} size={24} />
                  ))}
                  {totalPending > 3 && (
                    <View style={sinClasifBannerS.moreDot}>
                      <Text style={sinClasifBannerS.moreText}>···</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={sinClasifBannerS.total}>{formatCurrency(totalSinClasif)}</Text>
                <Ionicons name="chevron-forward" size={16} color="#F59E0B" />
              </View>
            </TouchableOpacity>
          </View>
        );
      })()}


    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Top bar fijo ── */}
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Text variant="h4">Gastos</Text>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            <TouchableOpacity
              style={styles.screenshotBtn}
              onPress={() => {
                if (user?.id) {
                  fetchExpenses(user.id);
                  loadPendingTxs();
                  pollGmail();
                }
              }}
              disabled={isPolling}
            >
              <Animated.View style={{
                transform: [{
                  rotate: spinAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  }),
                }],
              }}>
                <Ionicons
                  name="sync-outline"
                  size={20}
                  color={isPolling ? colors.primary : colors.text.secondary}
                />
              </Animated.View>
            </TouchableOpacity>
            {user?.id && (
              <BudgetRingIndicator
                userId={user.id}
                expenses={expenses}
                categories={categories}
                month={filter.month ?? new Date().getMonth() + 1}
                year={filter.year ?? new Date().getFullYear()}
              />
            )}
          </View>
        </View>

        {/* Selector de mes */}
        <MonthSelector
          selected={{ month: filter.month ?? new Date().getMonth() + 1, year: filter.year ?? new Date().getFullYear() }}
          onSelect={(m, y) => setFilter({ month: m, year: y })}
        />

        {/* Segmented control — Gastos / Análisis */}
        <View style={styles.segControl}>
          {(['gastos', 'analisis'] as const).map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.segBtn, activeView === v && styles.segBtnActive]}
              onPress={() => setActiveView(v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segBtnText, activeView === v && styles.segBtnTextActive]}>
                {v === 'gastos' ? 'Gastos' : 'Análisis'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {activeView === 'gastos' ? (
      <SectionList
        style={styles.flatList}
        sections={expenseSections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ExpenseItem expense={item} onPress={() => openEditExpense(item)} />}
        renderSectionHeader={({ section }) => <DayHeader date={section.title} total={section.total} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={listHeader}
        stickySectionHeadersEnabled={false}
        onEndReached={() => { if (user?.id && hasMore) fetchMoreExpenses(user.id); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          <View>
            {isLoadingMore && <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: spacing[4] }} />}
            {totalThisMonth > 0 && (
              <AnalysisTeaser recuperable={totalRecuperable} onPress={() => setActiveView('analisis')} />
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: spacing[2] }}>
              <ExpensesSkeletonLoader />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={48} color={colors.text.tertiary} />
              <Text variant="body" color={colors.text.secondary} align="center">
                No hay gastos este mes.
              </Text>
            </View>
          )
        }
      />
      ) : (
        <ScrollView
          style={styles.flatList}
          contentContainerStyle={styles.analysisList}
          showsVerticalScrollIndicator={false}
        >
          {/* Sub-tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.reportTabsScroll}
            contentContainerStyle={styles.reportTabsRow}
          >
            {(['resumen', 'categorias', 'salud', 'oportunidades'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.reportTabPill, reportTab === tab && styles.reportTabPillActive]}
                onPress={() => setReportTab(tab)}
                activeOpacity={0.75}
              >
                <Text style={[styles.reportTabText, reportTab === tab && styles.reportTabTextActive]}>
                  {tab === 'resumen' ? 'Resumen' : tab === 'categorias' ? 'Categorías' : tab === 'salud' ? 'Salud' : 'Oportunidades'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Aviso de precisión cuando hay gastos sin clasificar */}
          {(() => {
            const unclasCount = expenses.filter(e => e.category_id === null).length;
            if (unclasCount === 0) return null;
            return (
              <View style={reportS.precisionNotice}>
                <Ionicons name="information-circle-outline" size={14} color="#607D8B" />
                <Text style={reportS.precisionText}>
                  {unclasCount} gasto{unclasCount > 1 ? 's' : ''} sin clasificar no {unclasCount > 1 ? 'están incluidos' : 'está incluido'} en este análisis.
                </Text>
              </View>
            );
          })()}

          {isReportLoading ? (
            <View style={{ height: 200, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : displayTotal === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing[10], gap: spacing[4] }}>
              <Ionicons name="bar-chart-outline" size={48} color={colors.text.tertiary} />
              <Text variant="body" color={colors.text.secondary} align="center">
                Sin datos para analizar este mes.
              </Text>
            </View>
          ) : (
            <>
              {reportTab === 'resumen' && (() => {
                const donutRows  = reportRows.length > 0 ? reportRows : catBreakdown;
                const donutTotal = reportRows.length > 0 ? (reportTotal || displayTotal) : totalThisMonth;
                return (
                  <>
                    {donutRows.length > 0 && donutTotal > 0 && (
                      <View style={reportS.donutCard}>
                        <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: 16 }}>DISTRIBUCIÓN POR CATEGORÍA</Text>
                        <CategoryDonut rows={donutRows} total={donutTotal} />
                      </View>
                    )}
                    <TouchableOpacity
                      style={reportS.heroCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/(app)/savings-plan' as any)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                        <Ionicons name="sparkles" size={14} color={colors.accent} />
                        <Text variant="label" color={colors.text.tertiary}>PLAN INTELIGENTE</Text>
                      </View>
                      {smartPlan && smartPlan.potentialSavings > 500 ? (
                        <>
                          <Text style={reportS.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
                            {formatCurrency(smartPlan.potentialSavings)}
                          </Text>
                          <Text variant="bodySmall" color={colors.text.secondary}>
                            Es lo que podrías liberar este mes según tu ritmo de gasto
                          </Text>
                        </>
                      ) : (
                        <Text variant="bodySmall" color={colors.text.secondary}>
                          Mirá cómo viene tu ritmo de gasto este mes, categoría por categoría
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[1] }}>
                        <Text variant="bodySmall" style={{ fontFamily: 'Montserrat_600SemiBold', color: colors.primary }}>
                          Ver Plan Inteligente
                        </Text>
                        <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                      </View>
                    </TouchableOpacity>
                    <InflationThermometer userId={user!.id} year={reportYear} month={reportMonth} />
                    <AdvisorCTA context={`Informe de ${MONTH_NAMES[reportMonth - 1]} ${reportYear}. Gasté ${formatCurrency(displayTotal)}.`} />
                  </>
                );
              })()}

              {reportTab === 'categorias' && (
                <>
                  <ResumenCard
                    total={displayTotal} necessary={displayNecessary}
                    disposable={displayDisposable} investable={displayInvestable}
                    estimatedIncome={displayIncome}
                  />
                  {reportRows.length > 0 && (
                    <View style={reportS.donutCard}>
                      <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: 16 }}>DISTRIBUCIÓN POR CATEGORÍA</Text>
                      <CategoryDonut rows={reportRows} total={reportTotal || displayTotal} />
                    </View>
                  )}
                  <CategoryBreakdown rows={reportRows} total={reportTotal || displayTotal} />
                </>
              )}

              {reportTab === 'salud' && (() => {
                const diagRows = reportRows.map(r => ({
                  id: r.id, name: r.name, color: r.color,
                  amount: r.amount, pct: r.pct,
                }));
                // history solo tiene meses ANTERIORES al reportado; agregamos el
                // mes actual para que el cálculo de tendencia sea idéntico al de home.
                const currentMonthKey = `${reportYear}-${String(reportMonth).padStart(2, '0')}`;
                const diagHistory = [
                  ...history.map(h => ({
                    monthKey: h.monthKey, label: h.label, total: h.total,
                    necessary: h.necessary, disposable: h.disposable, investable: h.investable,
                  })),
                  ...(history.every(h => h.monthKey !== currentMonthKey) ? [{
                    monthKey: currentMonthKey,
                    label: MONTH_NAMES[reportMonth - 1].slice(0, 3),
                    total: displayTotal,
                    necessary: displayNecessary ?? 0,
                    disposable: displayDisposable ?? 0,
                    investable: displayInvestable ?? 0,
                  }] : []),
                ].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
                const diag = displayTotal > 0 ? computeFinancialDiagnosis({
                  totalThisMonth:  displayTotal,
                  totalNecessary:  displayNecessary,
                  totalDisposable: displayDisposable,
                  totalInvestable: displayInvestable,
                  estimatedIncome: displayIncome,
                  history:         diagHistory,
                  rows:            diagRows,
                  inflationRate,
                  fciRate,
                  dayOfMonth:      new Date().getDate(),
                }) : null;
                const score      = diag?.healthScore ?? 0;
                const scoreLabel = diag?.healthLabel  ?? '—';
                const scoreColor = diag?.healthColor  ?? '#9B9790';
                const arc        = (score / 100) * 201;
                // penúltimo de diagHistory = mes anterior al actual
                const prevM   = diagHistory.length >= 2 ? diagHistory[diagHistory.length - 2] : null;
                const prevPct = prevM && prevM.total > 0 && displayTotal > 0
                  ? Math.round(((displayTotal - prevM.total) / prevM.total) * 100)
                  : null;
                return (
                  <View style={{ gap: 12 }}>
                    {/* Score card */}
                    <View style={[styles.healthCard]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        {/* Circular gauge */}
                        <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
                          <Svg width={80} height={80}>
                            <SvgPath
                              d="M 10 60 A 30 30 0 1 1 70 60"
                              stroke="#E5E7EB" strokeWidth={8} fill="none"
                              strokeLinecap="round"
                            />
                            <SvgPath
                              d="M 10 60 A 30 30 0 1 1 70 60"
                              stroke={scoreColor} strokeWidth={8} fill="none"
                              strokeDasharray={`${arc} 201`}
                              strokeDashoffset={50} strokeLinecap="round"
                            />
                          </Svg>
                          <View style={{ position: 'absolute', alignItems: 'center' }}>
                            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 18, color: scoreColor, lineHeight: 22 }}>{score}</Text>
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 9, color: '#9B9790', lineHeight: 12 }}>/100</Text>
                          </View>
                        </View>
                        {/* Info */}
                        <View style={{ flex: 1, gap: 6 }}>
                          <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#1C1C1C' }}>Tu salud financiera</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: scoreColor + '18', alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: scoreColor }} />
                            <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 11, color: scoreColor }}>{scoreLabel}</Text>
                          </View>
                          {prevPct !== null && (
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 16 }}>
                              {prevPct > 0 ? `Gastaste ${prevPct}% más que el mes pasado.` : prevPct < 0 ? `Gastaste ${Math.abs(prevPct)}% menos que el mes pasado.` : 'Igual que el mes pasado.'}
                            </Text>
                          )}
                        </View>
                        {prevPct !== null && (
                          <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: prevPct > 0 ? '#EF4444' : '#27AE60' }}>
                            {prevPct > 0 ? '+' : ''}{prevPct}%
                          </Text>
                        )}
                      </View>
                      {score < 70 && (
                        <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 18, borderTopWidth: 1, borderTopColor: '#F5F1E9', paddingTop: 10, marginTop: 4 }}>
                          Hay oportunidades de mejora. Revisá tus prescindibles.
                        </Text>
                      )}
                      {score >= 70 && (
                        <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 18, borderTopWidth: 1, borderTopColor: '#F5F1E9', paddingTop: 10, marginTop: 4 }}>
                          ¡Vas por buen camino! Seguí manteniendo tus gastos bajo control.
                        </Text>
                      )}
                    </View>
                    {/* Componentes del score */}
                    {diag && diag.components.length > 0 && (
                      <View style={styles.healthCard}>
                        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1C1C1C', marginBottom: 8 }}>Desglose del puntaje</Text>
                        {diag.components.map(c => (
                          <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: 'Montserrat_500Medium', fontSize: 12, color: '#1C1C1C' }}>{c.label}</Text>
                              <View style={{ height: 4, backgroundColor: '#F5F1E9', borderRadius: 2, marginTop: 4 }}>
                                <View style={{ height: 4, width: `${Math.min(c.score, 100)}%` as any, backgroundColor: c.color, borderRadius: 2 }} />
                              </View>
                            </View>
                            <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: c.color, minWidth: 28, textAlign: 'right' }}>{c.score}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {/* Acciones sugeridas */}
                    {diag && diag.actions.length > 0 && (
                      <View style={styles.healthCard}>
                        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 13, color: '#1C1C1C', marginBottom: 8 }}>Qué podés mejorar</Text>
                        {diag.actions.slice(0, 3).map((a, i) => (
                          <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                            <Text style={{ fontSize: 14 }}>{a.icon}</Text>
                            <Text style={{ fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#1C1C1C', flex: 1, lineHeight: 18 }}>{a.text}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}

              {reportTab === 'oportunidades' && (
                <>
                  <DecisionHistorySection opportunities={buildOpportunities(pastOppData)} />
                  <HistoryComparisonCard history={history} comparacion={comparacion} currentTotal={displayTotal} />
                  <PlanProximoMesCard items={planItems} />
                  {objetivo && <ObjetivoCard objetivo={objetivo} />}
                  <AdvisorCTA context={`Informe de ${MONTH_NAMES[reportMonth - 1]} ${reportYear}. Gasté ${formatCurrency(displayTotal)}.`} />
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── FAB agregar gasto ── */}
      {activeView === 'gastos' && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={26} color={colors.white} />
        </TouchableOpacity>
      )}

      {/* Modal agregar gasto */}
      <FormSheetModal
        visible={showAddModal}
        title="Nuevo gasto"
        onClose={() => setShowAddModal(false)}
        contentContainerStyle={styles.modalScroll}
      >
              {/* ── Monto prominente ── */}
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
                    <View style={styles.amountBlock}>
                      <View style={styles.amountRow}>
                        <Text style={styles.amountPrefix}>{currency === 'USD' ? 'U$D' : '$'}</Text>
                        <TextInput
                          style={styles.amountInput}
                          placeholder="0"
                          placeholderTextColor={colors.text.tertiary}
                          value={value}
                          onChangeText={onChange}
                          onBlur={onBlur}
                          keyboardType="decimal-pad"
                          autoFocus
                        />
                      </View>
                      {errors.amount?.message && (
                        <Text variant="caption" color={colors.red}>{errors.amount.message}</Text>
                      )}
                      {ars !== null && (
                        <View style={styles.fxPreview}>
                          <Ionicons name="swap-horizontal" size={12} color={colors.text.tertiary} />
                          <Text variant="caption" color={colors.text.tertiary}>
                            = ${ars.toLocaleString('es-AR')} ARS al {dolarLabels[dolarType]}
                          </Text>
                        </View>
                      )}
                      {/* Moneda inline */}
                      <View style={[styles.currencyRow, { marginTop: spacing[2] }]}>
                        {(['ARS', 'USD'] as const).map((c) => (
                          <TouchableOpacity
                            key={c}
                            style={[styles.currencyChip, currency === c && styles.currencyChipActive]}
                            onPress={() => setCurrency(c)}
                          >
                            <Text variant="label" color={currency === c ? colors.neon : colors.text.secondary}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {currency === 'USD' && (
                        <View style={styles.dolarRow}>
                          {(['oficial', 'blue', 'mep'] as DolarType[]).map((t) => {
                            const r = rates[t];
                            return (
                              <TouchableOpacity
                                key={t}
                                style={[styles.dolarChip, dolarType === t && styles.dolarChipActive]}
                                onPress={() => setDolarType(t)}
                              >
                                <Text variant="caption" color={dolarType === t ? colors.white : colors.text.secondary}>{dolarLabels[t]}</Text>
                                <Text variant="caption" color={dolarType === t ? colors.white : colors.text.tertiary}>{r ? `$${r.toLocaleString('es-AR')}` : '...'}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                }}
              />

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
                        color={selectedPayment === pm.value ? colors.white : colors.text.secondary}
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
      </FormSheetModal>

      {/* Modal clasificar gasto — diseño premium */}
      <FormSheetModal
        visible={!!editingExpense}
        title="Clasificar gasto"
        onClose={() => { setEditingExpense(null); setEditExpenseValues(null); setCategorySearch(''); }}
        presentationStyle="formSheet"
        backgroundColor="#FFFFFF"
        scrollable={false}
        contentContainerStyle={{ flex: 1, padding: 0, gap: 0 }}
      >
          {editExpenseValues && (() => {
            const pastExpenses = expenses.filter(e => e.category_id && e.id !== editingExpense?.id);
            const bestMatches = computeCategoryMatches(editingExpense?.description ?? '', categories, pastExpenses);
            const searchLow = categorySearch.toLowerCase();
            const filteredCats = categorySearch.trim()
              ? categories.filter((c: any) => c.name_es?.toLowerCase().includes(searchLow))
              : categories;
            return (
              <>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={clsModal.scroll}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {/* AI Banner */}
                    <View style={clsModal.aiBanner}>
                      <View style={clsModal.aiBadge}>
                        <Text style={clsModal.aiBadgeText}>🤖  Asistente inteligente</Text>
                      </View>
                      <Text style={clsModal.aiSubtitle}>
                        {bestMatches.length > 0
                          ? `Encontramos ${Math.min(bestMatches.length, 3)} categorías que podrían aplicar a este gasto.`
                          : 'Seleccioná la categoría y tipo de gasto.'}
                      </Text>
                    </View>

                    {/* Expense Card */}
                    <View style={clsModal.expenseCard}>
                      <View style={clsModal.expenseIconWrap}>
                        <CategoryIcon
                          categoryName={(editingExpense?.category as any)?.name_es ?? ''}
                          description={editingExpense?.description ?? ''}
                          size={44}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={clsModal.expenseName} numberOfLines={1}>{editingExpense?.description}</Text>
                        <Text style={clsModal.expenseMeta}>
                          {editingExpense?.date ? formatDate(editingExpense.date) : ''}
                          {editingExpense?.payment_method ? ' · ' + (PM_LABELS[editingExpense.payment_method] ?? editingExpense.payment_method) : ''}
                        </Text>
                      </View>
                      <Text style={clsModal.expenseAmount}>{formatCurrency(editingExpense?.amount ?? 0)}</Text>
                    </View>

                    {/* Descripción editable */}
                    <View style={{ gap: 8 }}>
                      <Text style={clsModal.sectionTitle}>Descripción</Text>
                      <TextInput
                        style={clsModal.descInput}
                        value={editExpenseValues.description}
                        onChangeText={(t) => setEditExpenseValues(p => p ? { ...p, description: t } : p)}
                        placeholder="Ej: Pelota de fútbol, Spotify, Alquiler..."
                        placeholderTextColor="#9CA3AF"
                        maxLength={80}
                        returnKeyType="done"
                      />
                    </View>

                    {/* Tipo de gasto */}
                    <View style={{ gap: 12 }}>
                      <Text style={clsModal.sectionTitle}>Tipo de gasto</Text>
                      <View style={clsModal.typeRow}>
                        {([
                          { key: 'necessary',  label: 'Necesario',   icon: 'shield-checkmark-outline', color: '#27AE60', bg: '#D1F7E3', border: '#27AE60' },
                          { key: 'disposable', label: 'Prescindible', icon: 'cart-outline',             color: '#DC2626', bg: '#FEF2F2', border: '#EF4444' },
                          { key: 'investable', label: 'Invertible',  icon: 'trending-up-outline',      color: '#27AE60', bg: '#D1F7E3', border: '#27AE60' },
                        ] as const).map(opt => {
                          const active = editExpenseValues.classification === opt.key;
                          return (
                            <TouchableOpacity
                              key={opt.key}
                              style={[clsModal.typeBtn, active ? { backgroundColor: opt.bg, borderColor: opt.border } : clsModal.typeBtnInactive]}
                              onPress={() => setEditExpenseValues(p => p ? { ...p, classification: opt.key as ExpenseClassification } : p)}
                              activeOpacity={0.8}
                            >
                              <Ionicons name={opt.icon} size={20} color={active ? opt.color : '#9B9790'} />
                              <Text style={[clsModal.typeBtnLabel, { color: active ? opt.color : '#9B9790' }]}>{opt.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    {/* Mejores coincidencias */}
                    {bestMatches.length > 0 && (
                      <View style={{ gap: 12 }}>
                        <Text style={clsModal.sectionTitle}>
                          {bestMatches[0]?.fromHistory ? 'Clasificado antes 🧠' : 'Mejores coincidencias ✨'}
                        </Text>
                        <View style={clsModal.matchCard}>
                          {bestMatches.slice(0, 3).map((m, i) => {
                            const isActive = editExpenseValues.category_id === m.category.id;
                            return (
                              <TouchableOpacity
                                key={m.category.id}
                                style={[clsModal.matchRow, i < 2 && clsModal.matchRowBorder, isActive && clsModal.matchRowActive]}
                                onPress={() => setEditExpenseValues(p => p ? { ...p, category_id: p.category_id === m.category.id ? null : m.category.id } : p)}
                                activeOpacity={0.75}
                              >
                                <Text style={clsModal.matchRank}>{i + 1}</Text>
                                <CategoryIcon categoryName={m.category.name_es} size={30} />
                                <View style={{ flex: 1 }}>
                                  <Text style={clsModal.matchName} numberOfLines={1}>{m.category.name_es}</Text>
                                  {m.fromHistory && (
                                    <Text style={clsModal.matchHistoryTag}>Ya usaste esta categoría</Text>
                                  )}
                                </View>
                                <Text style={[clsModal.matchPct, m.fromHistory && { color: '#27AE60' }]}>
                                  {m.fromHistory ? '🧠 ' : ''}{m.score}%
                                </Text>
                                {isActive
                                  ? <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                                  : <View style={{ width: 18 }} />
                                }
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    )}

                    {/* Todas las categorías */}
                    <View style={{ gap: 12 }}>
                      <Text style={clsModal.sectionTitle}>Todas las categorías</Text>
                      <View style={clsModal.searchRow}>
                        <Ionicons name="search-outline" size={16} color="#9CA3AF" />
                        <TextInput
                          style={clsModal.searchInput}
                          placeholder="Buscar categoría"
                          placeholderTextColor="#9CA3AF"
                          value={categorySearch}
                          onChangeText={setCategorySearch}
                        />
                      </View>
                      <View style={clsModal.catList}>
                        {filteredCats.map((cat: any, i: number) => {
                          const isActive = editExpenseValues.category_id === cat.id;
                          return (
                            <TouchableOpacity
                              key={cat.id}
                              style={[clsModal.catRow, i < filteredCats.length - 1 && clsModal.catRowBorder, isActive && clsModal.catRowActive]}
                              onPress={() => setEditExpenseValues(p => p ? { ...p, category_id: p.category_id === cat.id ? null : cat.id } : p)}
                              activeOpacity={0.75}
                            >
                              <View style={[clsModal.catIconWrap, { backgroundColor: (cat.color ?? '#27AE60') + '20' }]}>
                                <CategoryIcon categoryName={cat.name_es} size={26} />
                              </View>
                              <Text
                                style={[clsModal.catName, isActive && { color: '#1C1C1C', fontFamily: 'Montserrat_600SemiBold' }]}
                                numberOfLines={1}
                              >
                                {cat.name_es}
                              </Text>
                              {isActive
                                ? <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                                : <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                              }
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={{ height: 20 }} />
                  </ScrollView>

                {/* Bottom fixed */}
                <View style={clsModal.bottomBar}>
                  <TouchableOpacity style={clsModal.ctaBtn} onPress={handleSaveEdit} activeOpacity={0.87}>
                    {isSavingEdit
                      ? <ActivityIndicator color="#fff" size="small" />
                      : (
                        <>
                          <Ionicons name="checkmark" size={18} color="#fff" />
                          <Text style={clsModal.ctaBtnText}>Clasificar gasto</Text>
                        </>
                      )
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={clsModal.deleteBtnRow}
                    onPress={() => handleDeleteExpense(editingExpense!.id)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="trash-outline" size={15} color="#EF4444" />
                    <Text style={clsModal.deleteBtnText}>Eliminar este gasto</Text>
                  </TouchableOpacity>
                </View>
              </>
            );
          })()}
      </FormSheetModal>

      <ShareInGroupModal
        visible={showShareModal}
        expense={shareExpense}
        userId={user?.id ?? ''}
        onClose={() => { setShowShareModal(false); setShareExpense(null); }}
      />

      {/* Modal: inbox de gastos sin clasificar */}
      <Modal
        visible={showSinClasifModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSinClasifModal(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FAFAF7' }} edges={['top']}>
          {/* Header */}
          <View style={scModalS.topRow}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setShowSinClasifModal(false)} style={scModalS.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
          <View style={scModalS.titleBlock}>
            <Text style={scModalS.titleLarge}>Por clasificar</Text>
            <View style={scModalS.titleUnderline} />
            <View style={scModalS.countBadge}>
              <View style={scModalS.countDot} />
              <Text style={scModalS.countText}>
                {expenses.filter(e => e.category_id === null).length + pendingTxs.length} SIN CLASIFICAR
              </Text>
            </View>
            <Text style={scModalS.descText}>
              Tus gastos aún no tienen categoría.{'\n'}Clasificalos para tener todo bajo control.
            </Text>
          </View>

          <SinClasifInbox
            expenses={expenses}
            pendingTxs={pendingTxs}
            categories={categories}
            userId={user?.id ?? ''}
            onClassify={(expense) => {
              setShowSinClasifModal(false);
              setTimeout(() => openEditExpense(expense), 350);
            }}
            onConfirmedPending={() => {
              loadPendingTxs();
              if (user?.id) fetchExpenses(user.id);
            }}
          />
        </SafeAreaView>
      </Modal>

      <FirstVisitSheet
        visible={isFirstVisit}
        screenTitle="Tus gastos"
        screenIcon="wallet-outline"
        iconColor={colors.yellow}
        features={[
          { icon: 'add-circle-outline', color: colors.neon, title: 'Cargá gastos fácil y rápido', body: 'Tocá el botón "+" para registrar un gasto manual, o usá la cámara para procesar tickets y resúmenes.' },
          { icon: 'mail-outline', color: colors.primary, title: 'Gmail detecta automático', body: 'Conectando tu Gmail, escaneamos tus resúmenes y billeteras para detectar gastos sin que tengas que cargarlos.' },
          { icon: 'pricetag-outline', color: colors.yellow, title: 'Categorizá y clasificá', body: 'Cada gasto puede ser Necesario, Prescindible o Invertible — eso alimenta tu salud financiera y tus reportes.' },
        ]}
        onDismiss={markVisited}
      />
    </SafeAreaView>
  );
}

const CLASSIFICATION_COLOR: Record<string, string> = {
  necessary:  colors.accent,
  disposable: colors.red,
  investable: colors.neon,
};

function DayHeader({ date, total }: { date: string; total: number }) {
  const d = new Date(date + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isToday = d.toDateString() === today.toDateString();
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const label = isToday ? 'Hoy'
    : isYesterday ? 'Ayer'
    : d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <View style={styles.dayHeader}>
      <Text style={styles.dayLabel}>{label}</Text>
      <Text style={styles.dayTotal}>{formatCurrency(total)}</Text>
    </View>
  );
}

function ExpenseItem({ expense, onPress }: { expense: Expense; onPress: () => void }) {
  const isUnclassified = expense.category_id === null;
  const catName = (expense.category as any)?.name_es ?? '';
  const catColor = isUnclassified ? '#9B9790' : getCategoryColor(catName, 0);

  return (
    <TouchableOpacity style={styles.expenseItem} onPress={onPress} activeOpacity={0.75}>
      <CategoryIcon
        categoryName={catName}
        description={isUnclassified ? '' : expense.description}
        size={40}
      />
      <View style={styles.expenseLeft}>
        <Text style={styles.expenseName} numberOfLines={1}>
          {isUnclassified ? 'Sin clasificar' : (expense.category?.name_es ?? expense.description)}
        </Text>
        <Text style={styles.expenseMetaText} numberOfLines={1}>
          {expense.description}
        </Text>
      </View>
      <View style={styles.expenseRight}>
        <Text style={styles.expenseAmount}>
          -{formatCurrency(expense.amount)}
        </Text>
        {isUnclassified ? (
          <View style={sinClasifS.badge}>
            <Text style={sinClasifS.label}>SIN CLASIFICAR</Text>
          </View>
        ) : expense.classification ? (
          <Badge classification={expense.classification} label={expense.classification} small animated />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const sinClasifS = StyleSheet.create({
  badge: {
    backgroundColor: '#D1F7E3', borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  label: { fontFamily: 'Montserrat_700Bold', fontSize: 9, color: '#F59E0B', letterSpacing: 0.3 },
});

const sinClasifBannerS = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FAFAF7', borderWidth: 1, borderColor: '#A8D5C2',
    borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14,
    shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  title:      { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },
  sub:        { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#6D6A63' },
  countBadge: {
    backgroundColor: '#F59E0B', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center',
  },
  countText:  { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: '#fff' },
  moreDot:    {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#F5F1E9', alignItems: 'center', justifyContent: 'center',
  },
  moreText:   { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#6D6A63' },
  total:      { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: '#1C1C1C' },
});

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

  // ── FAB ──
  fab: {
    position:        'absolute',
    bottom:          90,
    right:           20,
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: '#27AE60',
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     '#27AE60',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.3,
    shadowRadius:    12,
    elevation:       8,
  },

  // ── Summary card ──
  summaryTotal: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   24,
    lineHeight: 30,
    color:      colors.text.primary,
  },
  summaryCard: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[2],
    marginBottom:     spacing[2],
    paddingVertical:  spacing[3],
    paddingHorizontal: spacing[4],
    backgroundColor:  colors.bg.card,
    borderWidth:      1,
    borderColor:      colors.border.default,
    borderRadius:     16,
    gap:              spacing[2],
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 1 },
    shadowOpacity:    0.04,
    shadowRadius:     6,
    elevation:        2,
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
  summaryBody: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            spacing[3],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  legendDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    flexShrink:   0,
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
    borderRadius:      10,
  },
  searchInput: {
    flex:       1,
    color:      colors.text.primary,
    fontSize:   14,
    fontFamily: 'Montserrat_400Regular',
    paddingVertical: spacing[1],
  },
  filterChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: 7,
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
    paddingBottom: layout.tabBarHeight + spacing[6],
    gap: spacing[1],
  },
  empty: {
    paddingVertical: spacing[16],
    alignItems: 'center',
    gap: spacing[4],
  },
  // Day header — actúa como separador entre grupos de días
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[1],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  dayLabel: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: colors.text.tertiary,
    textTransform: 'capitalize',
  },
  dayTotal: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12,
    color: colors.text.tertiary,
  },
  // Expense item — card con bordes redondeados
  expenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.bg.card,
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  expenseIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  expenseLeft:      { flex: 1, gap: 3 },
  expenseMeta:      { flexDirection: 'row', alignItems: 'center' },
  expenseRight:     { alignItems: 'flex-end', gap: 4 },
  expenseName: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 18,
  },
  expenseMetaText: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 12,
    color: colors.text.tertiary,
    lineHeight: 16,
  },
  expenseAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 18,
  },
  // Amount block (add modal)
  amountBlock: {
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 16,
    padding: spacing[5],
    gap: spacing[1],
    alignItems: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  amountPrefix: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 32,
    color: colors.text.tertiary,
  },
  amountInput: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 40,
    color: colors.text.primary,
    minWidth: 80,
    textAlign: 'center',
  },
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
  shareBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    paddingVertical: spacing[3],
    borderWidth:     1,
    borderColor:     '#27AE6040',
    borderRadius:    8,
    backgroundColor: '#D1F7E3',
  },
  shareBtnText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 12,
    color: '#27AE60',
    letterSpacing: 0.4,
  },
  deleteBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             spacing[2],
    paddingVertical: spacing[3],
    borderWidth:     1,
    borderColor:     colors.red,
    borderRadius:    8,
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
  // Segmented control — Gastos / Análisis
  segControl: {
    flexDirection:   'row',
    backgroundColor: '#F5F1E9',
    borderRadius:    16,
    padding:         4,
    marginTop:       spacing[2],
  },
  segBtn: {
    flex:            1,
    alignItems:      'center',
    paddingVertical: 10,
    borderRadius:    12,
  },
  segBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.08,
    shadowRadius:    4,
    elevation:       2,
  },
  segBtnText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   14,
    color:      '#6D6A63',
  },
  segBtnTextActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color:      '#1C1C1C',
  },
  // Analysis scroll container
  analysisList: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[4],
    paddingBottom:     layout.tabBarHeight + spacing[8],
    gap:               spacing[4],
  },
  // Analysis sub-tabs
  reportTabsScroll: {
    marginHorizontal: -layout.screenPadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  reportTabsRow: {
    flexDirection:     'row',
    paddingHorizontal: layout.screenPadding,
  },
  reportTabPill: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom:      -1,
  },
  healthCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         16,
    borderWidth:     1,
    borderColor:     '#F5F1E9',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.05,
    shadowRadius:    4,
    elevation:       2,
  },
  reportTabPillActive: {
    borderBottomColor: colors.primary,
  },
  reportTabText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   13,
    color:      colors.text.tertiary,
  },
  reportTabTextActive: {
    fontFamily: 'Montserrat_600SemiBold',
    color:      colors.primary,
  },
});

const reportS = StyleSheet.create({
  precisionNotice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: '#F5F1E9', borderRadius: 8,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    marginHorizontal: layout.screenPadding, marginBottom: spacing[2],
  },
  precisionText: {
    fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#6D6A63', flex: 1,
  },
  heroCard: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[4],
    gap:             spacing[3],
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       3,
  },
  heroAmount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   34,
    lineHeight: 40,
    color:      colors.text.primary,
  },
  investRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[3],
    paddingTop:     spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  investDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  donutCard: {
    backgroundColor: colors.bg.card,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderRadius:    16,
    padding:         spacing[5],
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.06,
    shadowRadius:    8,
    elevation:       3,
  },
});

const scModalS = StyleSheet.create({
  // Modal header
  topRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[1] },
  closeBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  titleBlock:     { paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: spacing[4], gap: spacing[2] },
  titleLarge:     { fontFamily: 'Montserrat_800ExtraBold', fontSize: 30, color: '#1C1C1C', letterSpacing: -0.8 },
  titleUnderline: { width: 40, height: 3, borderRadius: 2, backgroundColor: '#27AE60', marginTop: -2 },
  countBadge:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#D1F7E3', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#A8D5C2' },
  countDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F59E0B' },
  countText:      { fontFamily: 'Montserrat_700Bold', fontSize: 12, color: '#1F8C4F', letterSpacing: 0.4 },
  descText:       { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#6D6A63', lineHeight: 22 },

  // Section header (for manual unclassified, if both types exist)
  sectionHeader: { paddingTop: spacing[2] },
  sectionTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },

  // Cards (manually-added unclassified expenses)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
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
  dateLbl:      { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: '#9B9790' },
  cardRight:    { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  amount:       { fontFamily: 'Montserrat_800ExtraBold', fontSize: 16, color: '#1C1C1C', letterSpacing: -0.4 },
  clasificarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#D1F7E3', borderWidth: 1.5, borderColor: '#27AE60', borderRadius: 12 },
  clasificarText:{ fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#27AE60' },

  // Progress footer
  progressCard:      { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, shadowColor: '#27AE60', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2, borderWidth: 1, borderColor: '#D1FAE5', marginTop: spacing[2] },
  progressIconCircle:{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#D1F7E3', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#1C1C1C' },
  progressSub:       { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#6D6A63', lineHeight: 17 },
  progressCircle:    { width: 48, height: 48, borderRadius: 24, backgroundColor: '#D1F7E3', borderWidth: 2, borderColor: '#A8D5C2', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progressPct:       { fontFamily: 'Montserrat_800ExtraBold', fontSize: 13, color: '#27AE60' },

  // Empty state
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] },
  emptyIconCircle:{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#27AE60' + '14', alignItems: 'center', justifyContent: 'center' },
  emptyTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C' },
  emptySub:       { fontFamily: 'Montserrat_400Regular', fontSize: 14, color: '#9B9790', textAlign: 'center' },
});

// ─── Summary card styles ────────────────────────────────────────────────────────
const smS = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginTop:        spacing[2],
    marginBottom:     spacing[2],
    paddingVertical:  14,
    paddingHorizontal: 16,
    backgroundColor:  '#FFFFFF',
    borderRadius:     20,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 2 },
    shadowOpacity:    0.05,
    shadowRadius:     12,
    elevation:        2,
  },
  body: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  left: {
    flex: 65,
    gap:  3,
  },
  right: {
    flex:           35,
    alignItems:     'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   12,
    color:      '#9B9790',
    lineHeight: 16,
  },
  amount: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   28,
    lineHeight: 34,
    color:      '#1C1C1C',
  },
  varRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
  },
  varIcon: {
    fontFamily: 'Montserrat_700Bold',
    fontSize:   10,
    lineHeight: 14,
  },
  varText: {
    fontFamily: 'Montserrat_500Medium',
    fontSize:   11,
    lineHeight: 14,
  },
  metricList: {
    gap:       3,
    marginTop: 3,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    flexShrink:   0,
  },
  metricLabel: {
    flex:       1,
    fontFamily: 'Montserrat_400Regular',
    fontSize:   12,
    color:      '#6D6A63',
    lineHeight: 16,
  },
  metricAmount: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize:   12,
    color:      '#1C1C1C',
    lineHeight: 16,
    minWidth:   60,
    textAlign:  'right',
  },
  metricPct: {
    fontFamily: 'Montserrat_400Regular',
    fontSize:   11,
    color:      '#9B9790',
    lineHeight: 16,
    minWidth:   26,
    textAlign:  'right',
  },
  donutEmpty: {
    width:        96,
    height:       96,
    borderRadius: 48,
    backgroundColor: '#F0F0F0',
  },
});

// ─── Clasificar gasto modal styles (light theme) ─────────────────────────────

const clsModal = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 22 },

  // AI banner
  aiBanner: { gap: 8 },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EEF2FF', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-start',
  },
  aiBadgeText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#4F46E5' },
  aiSubtitle: {
    fontFamily: 'Montserrat_400Regular', fontSize: 13,
    color: '#6D6A63', lineHeight: 19,
  },

  // Expense card
  expenseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderRadius: 22,
    paddingVertical: 18, paddingHorizontal: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 14, elevation: 4,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  expenseIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FAFAF7',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    flexShrink: 0,
  },
  expenseName: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#27AE60' },
  expenseMeta: { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: '#9B9790', lineHeight: 17 },
  expenseAmount: { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: '#1C1C1C', flexShrink: 0 },

  sectionTitle: { fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: '#1C1C1C' },
  descInput: {
    backgroundColor: '#FAFAF7',
    borderWidth: 1,
    borderColor: '#E8E2D9',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#1C1C1C',
  },

  // Type buttons
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5,
  },
  typeBtnInactive: { backgroundColor: '#FFFFFF', borderColor: '#E8E2D9' },
  typeBtnLabel: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12 },

  // Best match card
  matchCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  matchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  matchRowBorder: { borderBottomWidth: 1, borderBottomColor: '#FAFAF7' },
  matchRowActive: { backgroundColor: '#D1F7E3' },
  matchRank: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#9B9790', width: 16 },
  matchName: { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },
  matchPct: { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: '#27AE60' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F1E9', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: {
    flex: 1, fontFamily: 'Montserrat_400Regular',
    fontSize: 14, color: '#1C1C1C', paddingVertical: 0,
  },

  // Category list
  catList: {
    backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#F5F1E9',
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 13, paddingHorizontal: 16,
  },
  catRowBorder: { borderBottomWidth: 1, borderBottomColor: '#FAFAF7' },
  catRowActive: { backgroundColor: '#D1F7E3' },
  catIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
  },
  catName: { flex: 1, fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#1C1C1C' },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 12,
    gap: 8, backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#F5F1E9',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 4,
  },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#27AE60', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#27AE60', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 12, elevation: 5,
  },
  ctaBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 16, color: '#FFFFFF', letterSpacing: 0.2 },
  deleteBtnRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 8,
  },
  deleteBtnText: { fontFamily: 'Montserrat_500Medium', fontSize: 14, color: '#EF4444' },
});
