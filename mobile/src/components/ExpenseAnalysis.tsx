import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { InflationThermometer } from './InflationThermometer';
import { InflationHistory } from './InflationHistory';
import { OpportunityCost } from './OpportunityCost';

const PALETTE = [
  '#00C853', '#1978E5', '#E53935', '#FFB300',
  '#7B61FF', '#FF6D00', '#00BCD4', '#E91E63',
  '#4CAF50', '#795548',
];

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

interface CategoryRow {
  id: string | null;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  expenses: { id: string; description: string; amount: number; date: string }[];
}

// ── Donut chart ────────────────────────────────────────────────────────────────
const SIZE = 210;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R  = 84;
const IR = 52;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number): string {
  const o1 = polar(CX, CY, R,  startDeg);
  const o2 = polar(CX, CY, R,  endDeg);
  const i1 = polar(CX, CY, IR, startDeg);
  const i2 = polar(CX, CY, IR, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${R}  ${R}  0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${IR} ${IR} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ');
}

function DonutChart({
  data, selectedIdx, total, onSelect,
}: {
  data: CategoryRow[];
  selectedIdx: number | null;
  total: number;
  onSelect: (i: number) => void;
}) {
  const segments = useMemo(() => {
    let cur = 0;
    const GAP = data.length > 1 ? 1.5 : 0;
    return data.map((row, i) => {
      const deg = row.percentage * 360;
      const start = cur + GAP / 2;
      const end   = cur + deg - GAP / 2;
      cur += deg;
      return { path: arcPath(start, end), color: row.color, i };
    });
  }, [data]);

  const selected = selectedIdx !== null ? data[selectedIdx] : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={CX} cy={CY} r={R}    fill={colors.bg.secondary} />
        <Circle cx={CX} cy={CY} r={IR}   fill={colors.bg.primary}   />
        {data.length === 0 && (
          <Circle cx={CX} cy={CY} r={R} fill={colors.border.subtle} />
        )}
        {segments.map((s) => (
          <G key={s.i} onPress={() => onSelect(s.i)}>
            <Path
              d={s.path}
              fill={s.color}
              opacity={selectedIdx !== null && selectedIdx !== s.i ? 0.35 : 1}
            />
          </G>
        ))}
        <Circle cx={CX} cy={CY} r={IR - 2} fill={colors.bg.primary} />
      </Svg>

      {/* Texto central superpuesto */}
      <View style={styles.chartCenter} pointerEvents="none">
        {selected ? (
          <>
            <Text variant="caption" color={colors.text.tertiary} align="center" numberOfLines={1}>
              {selected.name.toUpperCase()}
            </Text>
            <Text variant="number" color={selected.color} align="center">
              {formatCurrency(selected.amount)}
            </Text>
            <View style={[styles.pctBadge, { backgroundColor: selected.color + '20' }]}>
              <Text style={{ fontSize: 11, fontFamily: 'DMSans_600SemiBold', color: selected.color }}>
                {Math.round(selected.percentage * 100)}%
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.text.tertiary} align="center">TOTAL</Text>
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
function CategoryRow_({
  row, index, expanded, onPress,
}: {
  row: CategoryRow;
  index: number;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <View>
      <TouchableOpacity
        style={[styles.catRow, expanded && { backgroundColor: row.color + '0D' }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* Color accent */}
        <View style={[styles.catAccent, { backgroundColor: row.color }]} />

        <View style={{ flex: 1, gap: 5 }}>
          <View style={styles.catTop}>
            <Text variant="bodySmall" color={colors.text.primary}
              style={{ fontFamily: 'DMSans_600SemiBold', flex: 1 }}>
              {row.name}
            </Text>
            <Text variant="bodySmall" color={colors.text.primary}
              style={{ fontFamily: 'DMSans_600SemiBold' }}>
              {formatCurrency(row.amount)}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[
              styles.progressFill,
              { width: `${Math.min(Math.round(row.percentage * 100), 100)}%`, backgroundColor: row.color },
            ]} />
          </View>
          <Text variant="caption" color={colors.text.tertiary}>
            {Math.round(row.percentage * 100)}% · {row.expenses.length} gasto{row.expenses.length !== 1 ? 's' : ''}
          </Text>
        </View>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.text.tertiary}
          style={{ marginLeft: spacing[2], alignSelf: 'center' }}
        />
      </TouchableOpacity>

      {/* Gastos individuales */}
      {expanded && (
        <View style={styles.expensesList}>
          {row.expenses
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 8)
            .map((exp) => (
              <View key={exp.id} style={styles.expenseItem}>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" color={colors.text.primary}>{exp.description}</Text>
                  <Text variant="caption" color={colors.text.tertiary}>{exp.date}</Text>
                </View>
                <Text variant="caption" color={colors.text.primary}
                  style={{ fontFamily: 'DMSans_600SemiBold' }}>
                  {formatCurrency(exp.amount)}
                </Text>
              </View>
            ))}
          {row.expenses.length > 8 && (
            <Text variant="caption" color={colors.text.tertiary} align="center"
              style={{ paddingTop: spacing[2] }}>
              +{row.expenses.length - 8} más
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────
export function ExpenseAnalysis({ userId }: { userId: string }) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear,  setSelectedYear]  = useState(now.getFullYear());
  const [breakdown,     setBreakdown]     = useState<CategoryRow[]>([]);
  const [total,         setTotal]         = useState(0);
  const [isLoading,     setIsLoading]     = useState(false);
  const [selectedIdx,   setSelectedIdx]   = useState<number | null>(null);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  const { startDate, endDate } = useMemo(() => {
    const s = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const em = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const ey = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    return {
      startDate: s,
      endDate: `${ey}-${String(em).padStart(2, '0')}-01`,
    };
  }, [selectedMonth, selectedYear]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setSelectedIdx(null);
    setExpandedId(null);
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category:expense_categories(id, name_es, color)')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lt('date', endDate);

      if (error) throw error;

      const map: Record<string, CategoryRow> = {};
      let sum = 0;

      for (const exp of data ?? []) {
        const cat    = exp.category as any;
        const catId  = cat?.id    ?? 'none';
        const catName= cat?.name_es ?? 'Sin categoría';
        const catClr = cat?.color  ?? null;

        if (!map[catId]) {
          const idx = Object.keys(map).length % PALETTE.length;
          map[catId] = {
            id: catId, name: catName,
            color: catClr ?? PALETTE[idx],
            amount: 0, percentage: 0, expenses: [],
          };
        }
        map[catId].amount += exp.amount;
        map[catId].expenses.push({ id: exp.id, description: exp.description, amount: exp.amount, date: exp.date });
        sum += exp.amount;
      }

      const rows = Object.values(map)
        .map(r => ({ ...r, percentage: sum > 0 ? r.amount / sum : 0 }))
        .sort((a, b) => b.amount - a.amount);

      setTotal(sum);
      setBreakdown(rows);
    } catch (err) {
      console.error('[ExpenseAnalysis] error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();

  const prevMonth = () => {
    if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1); }
    else setSelectedMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (isCurrentMonth) return;
    if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1); }
    else setSelectedMonth(m => m + 1);
  };

  const handleSelect = (i: number) => {
    const row = breakdown[i];
    const isSame = selectedIdx === i;
    setSelectedIdx(isSame ? null : i);
    setExpandedId(isSame ? null : (row?.id ?? null));
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Selector de mes */}
      <View style={styles.monthSelector}>
        <TouchableOpacity style={styles.monthArrow} onPress={prevMonth}>
          <Ionicons name="chevron-back" size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text variant="subtitle" color={colors.text.primary}>
          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
        </Text>
        <TouchableOpacity
          style={[styles.monthArrow, isCurrentMonth && { opacity: 0.25 }]}
          onPress={nextMonth}
          disabled={isCurrentMonth}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.text.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.neon} />
        </View>
      ) : breakdown.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="pie-chart-outline" size={52} color={colors.border.default} />
          <Text variant="body" color={colors.text.tertiary} align="center">
            No hay gastos para{'\n'}{MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </Text>
        </View>
      ) : (
        <>
          {/* Gráfico */}
          <View style={styles.chartWrapper}>
            <DonutChart
              data={breakdown}
              selectedIdx={selectedIdx}
              total={total}
              onSelect={handleSelect}
            />
            {selectedIdx !== null && (
              <TouchableOpacity
                onPress={() => { setSelectedIdx(null); setExpandedId(null); }}
                style={styles.clearBtn}
              >
                <Text variant="caption" color={colors.text.tertiary}>Limpiar selección</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Leyenda chips */}
          <View style={styles.legendWrap}>
            {breakdown.map((row) => (
              <View key={row.id} style={styles.legendChip}>
                <View style={[styles.legendDot, { backgroundColor: row.color }]} />
                <Text variant="caption" color={colors.text.secondary} numberOfLines={1}>
                  {row.name}
                </Text>
              </View>
            ))}
          </View>

          {/* Lista de categorías */}
          <Card style={styles.listCard}>
            <Text variant="label" color={colors.text.tertiary} style={{ marginBottom: spacing[3] }}>
              DESGLOSE POR CATEGORÍA
            </Text>
            {breakdown.map((row, i) => (
              <CategoryRow_
                key={row.id ?? i}
                row={row}
                index={i}
                expanded={expandedId === row.id}
                onPress={() => handleSelect(i)}
              />
            ))}
          </Card>

          {/* Termómetro de inflación personal */}
          <Card style={styles.listCard}>
            <InflationThermometer
              userId={userId}
              year={selectedYear}
              month={selectedMonth}
            />
          </Card>
        </>
      )}

      {/* Historial — siempre visible, no depende del mes seleccionado */}
      <Card style={styles.listCard}>
        <InflationHistory userId={userId} monthsBack={6} />
      </Card>

      {/* Oportunidades de inversión */}
      <Card style={styles.listCard}>
        <OpportunityCost userId={userId} monthsBack={3} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom:     layout.tabBarHeight + 80,
    gap:               spacing[4],
  },
  monthSelector: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingVertical: spacing[3],
    borderTopWidth:    1,
    borderBottomWidth: 1,
    borderColor:       colors.border.subtle,
    marginTop:         spacing[2],
  },
  monthArrow: { padding: spacing[2] },
  centered: {
    height:         260,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            spacing[4],
  },
  chartWrapper: {
    alignItems: 'center',
    gap:        spacing[2],
  },
  chartCenter: {
    position:       'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            4,
  },
  pctBadge: {
    paddingHorizontal: spacing[3],
    paddingVertical:   3,
    borderRadius:      20,
    marginTop:         2,
  },
  clearBtn: {
    paddingVertical: spacing[1],
  },
  legendWrap: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            spacing[2],
    justifyContent: 'center',
  },
  legendChip: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius:  20,
  },
  legendDot: {
    width: 7, height: 7, borderRadius: 4,
  },
  listCard: {
    padding:  spacing[4],
    overflow: 'hidden',
  },
  catRow: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    gap:             spacing[3],
  },
  catAccent: {
    width:        3,
    borderRadius: 2,
    alignSelf:    'stretch',
    minHeight:    40,
  },
  catTop: {
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
    height: '100%', borderRadius: 3,
  },
  expensesList: {
    marginLeft:      spacing[4],
    marginBottom:    spacing[2],
    backgroundColor: colors.bg.secondary,
    padding:         spacing[3],
    gap:             spacing[2],
  },
  expenseItem: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               spacing[2],
    paddingVertical:   spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
});
