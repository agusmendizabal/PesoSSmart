/**
 * InflationHistory
 *
 * Muestra la evolución de la inflación personal del usuario
 * en los últimos N meses, comparada mes a mes contra el INDEC.
 *
 * Subcomponentes internos:
 *   EvolutionChart   – mini gráfico de barras por mes
 *   TrendSummary     – texto de tendencia (sube/baja/estable)
 *   InsightsList     – lista de insights comparativos
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import {
  fetchInflationSeries,
  type InflationSeries,
  type MonthlyPoint,
  type TrendDirection,
} from '@/utils/inflationHistory';
import { type InflationLevel } from '@/utils/inflationCalc';

// ─── Constantes visuales ──────────────────────────────────────────────────────

const BAR_MAX_H  = 72;   // px — altura máxima de las barras
const BAR_W      = 14;   // px — ancho de cada barra
const BAR_GAP    = 3;    // px — gap entre barra personal y oficial
const GROUP_GAP  = 16;   // px — gap entre grupos de meses

const LEVEL_COLOR: Record<InflationLevel, string> = {
  low:    colors.primary,
  medium: colors.yellow,
  high:   colors.red,
};

const TREND_META: Record<TrendDirection, { icon: string; label: string; color: string }> = {
  rising:  { icon: 'trending-up-outline',   label: 'Vino subiendo',   color: colors.red     },
  falling: { icon: 'trending-down-outline', label: 'Vino bajando',    color: colors.primary },
  stable:  { icon: 'remove-outline',        label: 'Relativamente estable', color: colors.yellow },
  unknown: { icon: 'help-circle-outline',   label: 'Sin tendencia clara',   color: colors.text.tertiary },
};

// ─── MonthColumn ──────────────────────────────────────────────────────────────

function MonthColumn({
  point,
  scale,
}: {
  point:  MonthlyPoint;
  scale:  number;
}) {
  const persH  = point.personalInflation !== null
    ? Math.max(4, Math.round(point.personalInflation * scale))
    : 0;
  const offH   = point.officialInflation !== null
    ? Math.max(4, Math.round(point.officialInflation  * scale))
    : 0;
  const barColor = point.inflationLevel
    ? LEVEL_COLOR[point.inflationLevel]
    : colors.text.tertiary;

  return (
    <View style={colStyles.group}>
      {/* Área de barras */}
      <View style={[colStyles.barsArea, { height: BAR_MAX_H }]}>
        {/* Barra personal */}
        <View style={[colStyles.barSlot, { height: BAR_MAX_H }]}>
          {point.hasData ? (
            <View style={[colStyles.bar, { height: persH, backgroundColor: barColor }]} />
          ) : (
            <View style={[colStyles.bar, colStyles.emptyBar, { height: 6 }]} />
          )}
        </View>

        {/* Barra oficial */}
        <View style={[colStyles.barSlot, { height: BAR_MAX_H }]}>
          {point.officialInflation !== null ? (
            <View style={[colStyles.bar, { height: offH, backgroundColor: colors.bg.input }]} />
          ) : (
            <View style={[colStyles.bar, colStyles.emptyBar, { height: 6 }]} />
          )}
        </View>
      </View>

      {/* Label del mes */}
      <Text
        variant="caption"
        color={point.hasData ? colors.text.secondary : colors.text.tertiary}
        align="center"
        style={colStyles.label}
        numberOfLines={1}
      >
        {point.shortLabel}
      </Text>
    </View>
  );
}

const colStyles = StyleSheet.create({
  group: {
    alignItems: 'center',
    gap:        spacing[2],
    marginRight: GROUP_GAP,
  },
  barsArea: {
    flexDirection:  'row',
    alignItems:     'flex-end',
    gap:            BAR_GAP,
  },
  barSlot: {
    width:          BAR_W,
    justifyContent: 'flex-end',
  },
  bar: {
    width:        BAR_W,
    borderRadius: 3,
  },
  emptyBar: {
    backgroundColor: colors.border.subtle,
    borderRadius:    3,
    borderWidth:     1,
    borderColor:     colors.border.default,
    borderStyle:     'dashed' as const,
  },
  label: {
    fontSize: 9,
    width:    BAR_W * 2 + BAR_GAP,
  },
});

// ─── EvolutionChart ───────────────────────────────────────────────────────────

function EvolutionChart({ points }: { points: MonthlyPoint[] }) {
  const allValues = points.flatMap(p => [
    p.personalInflation ?? 0,
    p.officialInflation ?? 0,
  ]).filter(v => v > 0);

  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 5;
  const scale  = BAR_MAX_H / Math.max(maxVal, 1);

  return (
    <View style={chartStyles.wrapper}>
      {/* Línea de grid superior */}
      <View style={chartStyles.gridTop}>
        <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>
          {maxVal.toFixed(1)}%
        </Text>
        <View style={chartStyles.gridLine} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={chartStyles.scroll}
      >
        {points.map(p => (
          <MonthColumn key={p.monthKey} point={p} scale={scale} />
        ))}
      </ScrollView>

      {/* Leyenda */}
      <View style={chartStyles.legend}>
        <View style={chartStyles.legendItem}>
          <View style={[chartStyles.legendSwatch, { backgroundColor: colors.primary }]} />
          <Text variant="caption" color={colors.text.tertiary}>Tu inflación</Text>
        </View>
        <View style={chartStyles.legendItem}>
          <View style={[chartStyles.legendSwatch, { backgroundColor: colors.bg.input, borderWidth: 1, borderColor: colors.border.default }]} />
          <Text variant="caption" color={colors.text.tertiary}>Oficial INDEC</Text>
        </View>
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  wrapper: {
    gap: spacing[2],
  },
  gridTop: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  gridLine: {
    flex:        1,
    height:      1,
    backgroundColor: colors.border.subtle,
  },
  scroll: {
    paddingLeft: 2,
    paddingRight: spacing[2],
  },
  legend: {
    flexDirection: 'row',
    gap:           spacing[4],
    marginTop:     spacing[1],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  legendSwatch: {
    width:        10,
    height:       10,
    borderRadius: 2,
  },
});

// ─── TrendSummary ─────────────────────────────────────────────────────────────

function TrendSummary({
  direction,
  risingStreak,
  fallingStreak,
  avgPersonalLast3,
  avgOfficialLast3,
}: {
  direction:        TrendDirection;
  risingStreak:     number;
  fallingStreak:    number;
  avgPersonalLast3: number | null;
  avgOfficialLast3: number | null;
}) {
  const meta    = TREND_META[direction];
  const streakN = direction === 'rising' ? risingStreak : direction === 'falling' ? fallingStreak : 0;

  let trendLabel = meta.label;
  if (streakN >= 2) {
    trendLabel += ` por ${streakN} meses seguidos`;
  }

  return (
    <View style={trendStyles.row}>
      <View style={[trendStyles.iconBox, { backgroundColor: meta.color + '18' }]}>
        <Ionicons name={meta.icon as any} size={16} color={meta.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
          {trendLabel}
        </Text>
        {avgPersonalLast3 !== null && avgOfficialLast3 !== null && (
          <Text variant="caption" color={colors.text.secondary}>
            Promedio personal (3m): {avgPersonalLast3.toFixed(1)}% ·{' '}
            Oficial: {avgOfficialLast3.toFixed(1)}%
          </Text>
        )}
      </View>
    </View>
  );
}

const trendStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
  },
  iconBox: {
    width:        32,
    height:       32,
    borderRadius: 8,
    alignItems:   'center',
    justifyContent: 'center',
  },
});

// ─── InsightsList ─────────────────────────────────────────────────────────────

function InsightsList({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <View style={inStyles.container}>
      {insights.map((text, i) => (
        <View key={i} style={inStyles.item}>
          <Ionicons name="chevron-forward" size={12} color={colors.text.tertiary} style={{ marginTop: 3 }} />
          <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 20 }}>
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const inStyles = StyleSheet.create({
  container: { gap: spacing[2] },
  item:      { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
});

// ─── Componente principal ─────────────────────────────────────────────────────

interface InflationHistoryProps {
  userId:      string;
  monthsBack?: number;
}

export function InflationHistory({ userId, monthsBack = 6 }: InflationHistoryProps) {
  const [loading, setLoading] = useState(true);
  const [series,  setSeries]  = useState<InflationSeries | null>(null);

  useEffect(() => { load(); }, [userId, monthsBack]);

  const load = async () => {
    setLoading(true);
    try {
      setSeries(await fetchInflationSeries(userId, monthsBack));
    } catch {
      setSeries(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="caption" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
          Cargando evolución...
        </Text>
      </View>
    );
  }

  if (!series) return null;

  const hasAnyData = series.points.some(p => p.hasData);

  if (!hasAnyData) {
    return (
      <View style={s.noData}>
        <Ionicons name="stats-chart-outline" size={32} color={colors.text.tertiary} />
        <Text variant="caption" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3], lineHeight: 18 }}>
          Todavía no hay suficiente historial para mostrar la evolución.
        </Text>
      </View>
    );
  }

  const showTrend = series.points.filter(p => p.hasData).length >= 2;

  return (
    <View style={s.container}>
      <View style={s.titleRow}>
        <Text variant="label" color={colors.text.tertiary}>📈  TU EVOLUCIÓN</Text>
        <Text variant="caption" color={colors.text.tertiary}>Últimos {monthsBack} meses</Text>
      </View>

      {/* Insights comparativos (si hay) */}
      {series.comparativeInsights.length > 0 && (
        <InsightsList insights={series.comparativeInsights} />
      )}

      {/* Gráfico de barras */}
      <EvolutionChart points={series.points} />

      {/* Tendencia */}
      {showTrend && (
        <TrendSummary
          direction={series.trend.direction}
          risingStreak={series.trend.risingStreak}
          fallingStreak={series.trend.fallingStreak}
          avgPersonalLast3={series.trend.avgPersonalLast3}
          avgOfficialLast3={series.trend.avgOfficialLast3}
        />
      )}

      {/* Interpretación estructural */}
      {series.structuralInsight && (
        <View style={s.structuralBox}>
          <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 18 }}>
            {series.structuralInsight}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: spacing[5],
  },
  centered: {
    alignItems:      'center',
    paddingVertical: spacing[6],
  },
  noData: {
    alignItems:        'center',
    paddingVertical:   spacing[6],
    paddingHorizontal: spacing[4],
  },
  titleRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  structuralBox: {
    backgroundColor:  colors.bg.elevated,
    borderRadius:     8,
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[3],
    borderLeftWidth:   3,
    borderLeftColor:   colors.border.default,
  },
});
