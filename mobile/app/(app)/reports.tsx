import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';

// ── Paleta de colores para categorías ────────────────────────────────────────
const PALETTE = [
  '#00C853', '#1978E5', '#E53935', '#FFB300',
  '#7B61FF', '#FF6D00', '#00BCD4', '#E91E63',
  '#4CAF50', '#795548',
];

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface CategoryRow {
  id: string | null;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  expenses: { id: string; description: string; amount: number; date: string }[];
}

// ── Pie chart SVG ─────────────────────────────────────────────────────────────
const SIZE = 220;
const CX   = SIZE / 2;
const CY   = SIZE / 2;
const R    = 88;
const IR   = 54; // inner radius (donut)

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(
  cx: number, cy: number,
  outerR: number, innerR: number,
  startDeg: number, endDeg: number,
): string {
  const o1 = polarToXY(cx, cy, outerR, startDeg);
  const o2 = polarToXY(cx, cy, outerR, endDeg);
  const i1 = polarToXY(cx, cy, innerR, startDeg);
  const i2 = polarToXY(cx, cy, innerR, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
}

function DonutChart({
  data,
  selectedIndex,
  onSelect,
  total,
}: {
  data: CategoryRow[];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  total: number;
}) {
  if (data.length === 0) return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Circle cx={CX} cy={CY} r={R} fill={colors.border.subtle} />
    </View>
  );

  let currentDeg = 0;
  const GAP = data.length > 1 ? 1.5 : 0;

  const segments = data.map((row, i) => {
    const deg = row.percentage * 360;
    const start = currentDeg + GAP / 2;
    const end   = currentDeg + deg - GAP / 2;
    currentDeg += deg;
    const scale = selectedIndex === i ? 1.06 : 1;
    return { path: slicePath(CX, CY, R, IR, start, end), color: row.color, i, scale };
  });

  const selected = selectedIndex !== null ? data[selectedIndex] : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        {/* Fondo del donut */}
        <Circle cx={CX} cy={CY} r={R}    fill={colors.border.subtle} />
        <Circle cx={CX} cy={CY} r={IR}   fill={colors.bg.primary} />
        {/* Segmentos */}
        {segments.map((s) => (
          <G key={s.i} onPress={() => onSelect(s.i)}>
            <Path
              d={s.path}
              fill={s.color}
              opacity={selectedIndex !== null && selectedIndex !== s.i ? 0.45 : 1}
            />
          </G>
        ))}
        {/* Círculo interior blanco */}
        <Circle cx={CX} cy={CY} r={IR - 2} fill={colors.bg.primary} />
      </Svg>

      {/* Texto central */}
      <View style={styles.chartCenter} pointerEvents="none">
        {selected ? (
          <>
            <Text variant="caption" color={colors.text.tertiary} align="center">
              {selected.name.toUpperCase()}
            </Text>
            <Text variant="number" color={selected.color} align="center">
              {formatCurrency(selected.amount)}
            </Text>
            <Text variant="label" color={colors.text.secondary} align="center">
              {Math.round(selected.percentage * 100)}%
            </Text>
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.text.tertiary} align="center">TOTAL MES</Text>
            <Text variant="number" color={colors.text.primary} align="center">
              {formatCurrency(total)}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

// ── Fila de categoría ──────────────────────────────────────────────────────────
function CategoryItem({
  row,
  rank,
  selected,
  onPress,
}: {
  row: CategoryRow;
  rank: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.catRow, selected && { backgroundColor: row.color + '12' }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.catDot, { backgroundColor: row.color }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.catRowTop}>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold', flex: 1 }}>
            {row.name}
          </Text>
          <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
            {formatCurrency(row.amount)}
          </Text>
        </View>
        {/* Barra de progreso */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(row.percentage * 100)}%`, backgroundColor: row.color },
            ]}
          />
        </View>
        <Text variant="caption" color={colors.text.tertiary}>
          {Math.round(row.percentage * 100)}% del total
        </Text>
      </View>
      <Ionicons
        name={selected ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={colors.text.tertiary}
        style={{ marginLeft: spacing[2] }}
      />
    </TouchableOpacity>
  );
}

// ── Screen principal ───────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const { user } = useAuthStore();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear());
  const [breakdown,     setBreakdown]     = useState<CategoryRow[]>([]);
  const [total,         setTotal]         = useState(0);
  const [isLoading,     setIsLoading]     = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  const MONTH_NAMES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
  ];

  const { startDate, endDate } = useMemo(() => {
    const s = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const em = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const ey = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    const e = `${ey}-${String(em).padStart(2, '0')}-01`;
    return { startDate: s, endDate: e };
  }, [selectedMonth, selectedYear]);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setSelectedIndex(null);
    setExpandedId(null);
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category:expense_categories(id, name_es, color)')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lt('date', endDate);

      if (error) throw error;

      const map: Record<string, CategoryRow> = {};
      let sum = 0;

      for (const exp of data ?? []) {
        const cat    = exp.category as any;
        const catId  = cat?.id   ?? 'none';
        const catName= cat?.name_es ?? 'Sin categoría';
        const catClr = cat?.color  ?? null;

        if (!map[catId]) {
          const colorIndex = Object.keys(map).length % PALETTE.length;
          map[catId] = {
            id:         catId,
            name:       catName,
            color:      catClr ?? PALETTE[colorIndex],
            amount:     0,
            percentage: 0,
            expenses:   [],
          };
        }
        map[catId].amount += exp.amount;
        map[catId].expenses.push({
          id:          exp.id,
          description: exp.description,
          amount:      exp.amount,
          date:        exp.date,
        });
        sum += exp.amount;
      }

      const rows = Object.values(map)
        .map((r) => ({ ...r, percentage: sum > 0 ? r.amount / sum : 0 }))
        .sort((a, b) => b.amount - a.amount);

      setTotal(sum);
      setBreakdown(rows);
    } catch (err) {
      console.error('[Reports] loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const prevMonth = () => {
    if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1); }
    else setSelectedMonth(m => m - 1);
  };
  const nextMonth = () => {
    const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();
    if (isCurrentMonth) return;
    if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1); }
    else setSelectedMonth(m => m + 1);
  };
  const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();

  const handleChartSelect = (i: number) => {
    setSelectedIndex(prev => prev === i ? null : i);
    setExpandedId(breakdown[i]?.id ?? null);
  };

  const handleRowPress = (row: CategoryRow, i: number) => {
    const isExpanded = expandedId === row.id;
    setExpandedId(isExpanded ? null : row.id);
    setSelectedIndex(isExpanded ? null : i);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text variant="h4">Análisis de gastos</Text>
        </View>

        {/* Selector de mes */}
        <View style={styles.monthSelector}>
          <TouchableOpacity style={styles.monthArrow} onPress={prevMonth}>
            <Ionicons name="chevron-back" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <Text variant="subtitle" color={colors.text.primary}>
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </Text>
          <TouchableOpacity
            style={[styles.monthArrow, isCurrentMonth && { opacity: 0.3 }]}
            onPress={nextMonth}
            disabled={isCurrentMonth}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.neon} />
          </View>
        ) : breakdown.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="pie-chart-outline" size={52} color={colors.border.default} />
            <Text variant="body" color={colors.text.tertiary} align="center">
              No hay gastos para{'\n'}{MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </Text>
          </View>
        ) : (
          <>
            {/* Gráfico donut */}
            <View style={styles.chartContainer}>
              <DonutChart
                data={breakdown}
                selectedIndex={selectedIndex}
                onSelect={handleChartSelect}
                total={total}
              />
              {selectedIndex !== null && (
                <TouchableOpacity
                  style={styles.clearSelection}
                  onPress={() => { setSelectedIndex(null); setExpandedId(null); }}
                >
                  <Text variant="caption" color={colors.text.tertiary}>Limpiar selección</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Leyenda compacta */}
            <View style={styles.legendRow}>
              {breakdown.slice(0, 5).map((row) => (
                <View key={row.id} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: row.color }]} />
                  <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                    {row.name}
                  </Text>
                </View>
              ))}
            </View>

            {/* Lista de categorías */}
            <Card style={styles.listCard}>
              <Text variant="label" color={colors.text.secondary} style={{ marginBottom: spacing[3] }}>
                DESGLOSE POR CATEGORÍA
              </Text>

              {breakdown.map((row, i) => (
                <View key={row.id ?? i}>
                  <CategoryItem
                    row={row}
                    rank={i + 1}
                    selected={expandedId === row.id}
                    onPress={() => handleRowPress(row, i)}
                  />

                  {/* Gastos individuales de la categoría */}
                  {expandedId === row.id && (
                    <View style={styles.expensesList}>
                      {row.expenses
                        .sort((a, b) => b.amount - a.amount)
                        .slice(0, 8)
                        .map((exp) => (
                          <View key={exp.id} style={styles.expenseItem}>
                            <View style={{ flex: 1 }}>
                              <Text variant="caption" color={colors.text.primary}>
                                {exp.description}
                              </Text>
                              <Text variant="caption" color={colors.text.tertiary}>
                                {exp.date}
                              </Text>
                            </View>
                            <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
                              {formatCurrency(exp.amount)}
                            </Text>
                          </View>
                        ))}
                      {row.expenses.length > 8 && (
                        <Text variant="caption" color={colors.text.tertiary} align="center" style={{ paddingTop: spacing[2] }}>
                          +{row.expenses.length - 8} gastos más
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop:        spacing[4],
    paddingBottom:     layout.tabBarHeight + spacing[8],
    gap:               spacing[4],
  },
  header: {
    marginBottom: spacing[1],
  },
  monthSelector: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderTopWidth:    1,
    borderBottomWidth: 1,
    borderColor:       colors.border.subtle,
  },
  monthArrow: {
    padding: spacing[2],
  },
  loadingContainer: {
    height:         280,
    alignItems:     'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    height:         280,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[4],
  },
  chartContainer: {
    alignItems: 'center',
    gap:        spacing[2],
  },
  chartCenter: {
    position:       'absolute',
    top:            0,
    left:           0,
    right:          0,
    bottom:         0,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  clearSelection: {
    paddingVertical: spacing[1],
  },
  legendRow: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            spacing[3],
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
    maxWidth:      120,
  },
  legendDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
  listCard: {
    padding: spacing[4],
  },
  catRow: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  catDot: {
    width:        12,
    height:       12,
    borderRadius: 6,
    marginTop:    3,
  },
  catRowTop: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  progressTrack: {
    height:          5,
    backgroundColor: colors.border.subtle,
    borderRadius:    3,
    overflow:        'hidden',
  },
  progressFill: {
    height:       '100%',
    borderRadius: 3,
  },
  expensesList: {
    backgroundColor: colors.bg.secondary,
    marginLeft:      spacing[6],
    marginBottom:    spacing[2],
    padding:         spacing[3],
    gap:             spacing[2],
  },
  expenseItem: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             spacing[2],
    paddingVertical: spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
});
