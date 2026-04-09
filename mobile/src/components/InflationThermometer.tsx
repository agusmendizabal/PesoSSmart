/**
 * InflationThermometer
 *
 * Muestra la inflación personal del usuario calculada a partir de sus propios
 * gastos, comparada con el IPC oficial del INDEC.
 *
 * Subcomponentes internos:
 *   InflationGauge        – semicírculo SVG con aguja y marca oficial
 *   ComparisonNumbers     – dos tarjetas: tu inflación vs oficial
 *   InsightCard           – headline + narrative + context note
 *   ImpactSection         – "Qué te está empujando" con barras por categoría
 *   RecommendationSection – "Qué podés hacer" con consejos accionables
 *   DataFooter            – fuente y fecha de los datos INDEC
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import Svg, { Path, Circle, Line, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  calculatePersonalInflation,
  getInflationLevel,
  type CategoryExpenseInput,
  type CategoryWeight,
  type ConfidenceInfo,
  type ConfidenceLevel,
  type InflationResult,
  type InflationLevel,
  type Recommendation,
} from '@/utils/inflationCalc';

// ─── Tokens de nivel ──────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<InflationLevel, string> = {
  low:    colors.primary,
  medium: colors.yellow,
  high:   colors.red,
};

const LEVEL_BG: Record<InflationLevel, string> = {
  low:    colors.primary + '14',
  medium: colors.yellow  + '16',
  high:   colors.red     + '12',
};

const LEVEL_LABEL: Record<InflationLevel, string> = {
  low:    'BAJO',
  medium: 'MEDIO',
  high:   'ALTO',
};

// ─── Gauge SVG ────────────────────────────────────────────────────────────────

const GW     = 240;
const GH     = 140;
const CX     = GW / 2;
const CY     = GH - 16;
const R      = 96;
const STROKE = 16;
const GAUGE_MAX  = 12;
const GREEN_END  = 3;
const YELLOW_END = 6;

function polar(deg: number, r = R) {
  const rad = ((deg - 180) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcD(startDeg: number, endDeg: number, r = R): string {
  // Prevenir arco completo que rompe el SVG path
  const end   = endDeg - startDeg >= 180 ? startDeg + 179.9 : endDeg;
  const s     = polar(startDeg, r);
  const e     = polar(end,      r);
  const large = end - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function valueToDeg(value: number): number {
  const clamped = Math.max(0, Math.min(value, GAUGE_MAX));
  return 180 - (clamped / GAUGE_MAX) * 180;
}

interface GaugeProps {
  personal: number;
  official: number;
  level: InflationLevel;
}

function InflationGauge({ personal, official, level }: GaugeProps) {
  const greenEndDeg  = valueToDeg(GREEN_END);
  const yellowEndDeg = valueToDeg(YELLOW_END);
  const personalDeg  = valueToDeg(personal);
  const officialDeg  = valueToDeg(official);
  const needleColor  = LEVEL_COLOR[level];

  const needleEnd   = polar(personalDeg, R - STROKE / 2 - 6);
  const needleBase1 = polar(personalDeg + 90, 9);
  const needleBase2 = polar(personalDeg - 90, 9);
  const offP1       = polar(officialDeg, R + 8);
  const offP2       = polar(officialDeg, R - STROKE - 6);

  return (
    <Svg width={GW} height={GH} viewBox={`0 0 ${GW} ${GH}`}>
      {/* Track base */}
      <Path d={arcD(0, 180)} stroke={colors.bg.input} strokeWidth={STROKE} fill="none" strokeLinecap="butt" />

      {/* Zonas de guía (opacidad baja) */}
      <Path d={arcD(greenEndDeg,  180)}          stroke={colors.primary} strokeWidth={STROKE} fill="none" opacity={0.2} />
      <Path d={arcD(yellowEndDeg, greenEndDeg)}  stroke={colors.yellow}  strokeWidth={STROKE} fill="none" opacity={0.2} />
      <Path d={arcD(0,            yellowEndDeg)} stroke={colors.red}     strokeWidth={STROKE} fill="none" opacity={0.2} />

      {/* Arco activo hasta la posición personal */}
      {personalDeg < 180 && (
        <Path d={arcD(personalDeg, 180)} stroke={needleColor} strokeWidth={STROKE} fill="none" opacity={0.9} />
      )}

      {/* Marca oficial punteada */}
      <Line
        x1={offP1.x} y1={offP1.y}
        x2={offP2.x} y2={offP2.y}
        stroke={colors.text.secondary}
        strokeWidth={2}
        strokeDasharray="4,3"
      />

      {/* Aguja */}
      <G>
        <Path
          d={`M ${needleBase1.x} ${needleBase1.y} L ${needleEnd.x} ${needleEnd.y} L ${needleBase2.x} ${needleBase2.y} Z`}
          fill={needleColor}
        />
        <Circle cx={CX} cy={CY} r={9} fill={needleColor} />
        <Circle cx={CX} cy={CY} r={4} fill={colors.bg.card} />
      </G>
    </Svg>
  );
}

// ─── ComparisonNumbers ────────────────────────────────────────────────────────

function ComparisonNumbers({
  personal,
  official,
  level,
}: {
  personal: number;
  official: number;
  level: InflationLevel;
}) {
  const levelColor = LEVEL_COLOR[level];
  const levelBg    = LEVEL_BG[level];

  return (
    <View style={cmpStyles.row}>
      {/* Tu inflación */}
      <View style={[cmpStyles.card, { backgroundColor: levelBg, borderColor: levelColor + '30' }]}>
        <View style={cmpStyles.levelRow}>
          <View style={[cmpStyles.levelDot, { backgroundColor: levelColor }]} />
          <Text variant="caption" color={levelColor}>TU INFLACIÓN · {LEVEL_LABEL[level]}</Text>
        </View>
        <Text style={[cmpStyles.bigNum, { color: levelColor }]}>
          {personal.toFixed(1)}%
        </Text>
        <Text variant="caption" color={colors.text.secondary}>este mes</Text>
      </View>

      <Text variant="caption" color={colors.text.tertiary} style={cmpStyles.vs}>vs</Text>

      {/* Oficial */}
      <View style={[cmpStyles.card, cmpStyles.officialCard]}>
        <Text variant="caption" color={colors.text.tertiary}>OFICIAL · INDEC</Text>
        <Text style={[cmpStyles.bigNum, { color: colors.text.secondary, fontSize: 28 }]}>
          {official.toFixed(1)}%
        </Text>
        <Text variant="caption" color={colors.text.tertiary}>promedio país</Text>
      </View>
    </View>
  );
}

const cmpStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[2],
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  officialCard: {
    backgroundColor: colors.bg.elevated,
    borderColor:     colors.border.subtle,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  levelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  bigNum: {
    fontSize: 34,
    fontFamily: 'DMSans_700Bold',
    lineHeight: 40,
  },
  vs: {
    paddingHorizontal: spacing[1],
  },
});

// ─── Leyenda del gauge ────────────────────────────────────────────────────────

function GaugeLegend() {
  return (
    <View style={lgStyles.row}>
      {([
        { color: colors.primary, label: 'Bajo' },
        { color: colors.yellow,  label: 'Medio' },
        { color: colors.red,     label: 'Alto' },
      ] as const).map(({ color, label }) => (
        <View key={label} style={lgStyles.item}>
          <View style={[lgStyles.dot, { backgroundColor: color }]} />
          <Text variant="caption" color={colors.text.tertiary}>{label}</Text>
        </View>
      ))}
      <View style={lgStyles.item}>
        <View style={lgStyles.dash} />
        <Text variant="caption" color={colors.text.tertiary}>Oficial</Text>
      </View>
    </View>
  );
}

const lgStyles = StyleSheet.create({
  row:  { flexDirection: 'row', gap: spacing[4], justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:  { width: 8, height: 8, borderRadius: 4 },
  dash: { width: 14, height: 2, backgroundColor: colors.text.secondary, borderRadius: 1 },
});

// ─── InsightCard ──────────────────────────────────────────────────────────────

function InsightCard({
  headline,
  narrative,
  contextNote,
  level,
}: {
  headline: string;
  narrative: string;
  contextNote: string | null;
  level: InflationLevel;
}) {
  const levelColor = LEVEL_COLOR[level];
  const levelBg    = LEVEL_BG[level];

  return (
    <View style={[insStyles.box, { backgroundColor: levelBg, borderLeftColor: levelColor }]}>
      <Text
        variant="bodySmall"
        color={levelColor}
        style={{ fontFamily: 'DMSans_600SemiBold', marginBottom: spacing[1] }}
      >
        {headline}
      </Text>
      <Text variant="bodySmall" color={colors.text.primary} style={{ lineHeight: 20 }}>
        {narrative}
      </Text>
      {contextNote ? (
        <Text
          variant="caption"
          color={colors.text.secondary}
          style={{ marginTop: spacing[2], lineHeight: 18 }}
        >
          {contextNote}
        </Text>
      ) : null}
    </View>
  );
}

const insStyles = StyleSheet.create({
  box: {
    borderLeftWidth: 3,
    borderRadius:    10,
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[4],
  },
});

// ─── ImpactRow ────────────────────────────────────────────────────────────────

function ImpactRow({
  cw,
  isTop,
}: {
  cw: CategoryWeight;
  isTop: boolean;
}) {
  const weightPct = Math.round(Math.max(0, Math.min(cw.weight * 100, 100)));

  return (
    <View style={irStyles.row}>
      <View style={[irStyles.dot, { backgroundColor: cw.categoryColor }]} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={irStyles.nameRow}>
          <Text
            variant="bodySmall"
            color={colors.text.primary}
            numberOfLines={1}
            style={[{ flex: 1 }, isTop && { fontFamily: 'DMSans_600SemiBold' }]}
          >
            {cw.categoryNameEs}
          </Text>
          <Text variant="caption" color={colors.text.secondary}>
            +{cw.inflation.toFixed(1)}%
          </Text>
        </View>
        <View style={irStyles.track}>
          <View
            style={[
              irStyles.fill,
              {
                width:           `${weightPct}%`,
                backgroundColor: cw.categoryColor,
              },
            ]}
          />
        </View>
        <Text variant="caption" color={colors.text.tertiary}>
          {weightPct}% de tus gastos este mes
        </Text>
      </View>
    </View>
  );
}

const irStyles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  dot:     { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track:   { height: 4, backgroundColor: colors.bg.input, borderRadius: 2, overflow: 'hidden' },
  fill:    { height: '100%', borderRadius: 2 },
});

// ─── ImpactSection ────────────────────────────────────────────────────────────

function ImpactSection({ categoryWeights }: { categoryWeights: CategoryWeight[] }) {
  const visible = categoryWeights.slice(0, 5);
  if (visible.length === 0) return null;

  return (
    <View style={secStyles.section}>
      <View style={secStyles.header}>
        <Ionicons name="flame-outline" size={14} color={colors.text.secondary} />
        <Text variant="label" color={colors.text.secondary}>QUÉ TE ESTÁ EMPUJANDO</Text>
      </View>
      <View style={secStyles.list}>
        {visible.map((cw, i) => (
          <ImpactRow key={cw.categoryNameEs} cw={cw} isTop={i === 0} />
        ))}
      </View>
    </View>
  );
}

// ─── RecommendationSection ───────────────────────────────────────────────────

function RecommendationSection({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;

  return (
    <View style={secStyles.section}>
      <View style={secStyles.header}>
        <Ionicons name="bulb-outline" size={14} color={colors.text.secondary} />
        <Text variant="label" color={colors.text.secondary}>QUÉ PODÉS HACER</Text>
      </View>
      <View style={secStyles.list}>
        {recommendations.map((rec, i) => (
          <View key={i} style={recStyles.item}>
            <View style={recStyles.bullet} />
            <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 20 }}>
              {rec.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const secStyles = StyleSheet.create({
  section: { gap: spacing[4] },
  header:  { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  list:    { gap: spacing[4] },
});

const recStyles = StyleSheet.create({
  item:   { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text.tertiary, marginTop: 7, flexShrink: 0 },
});

// ─── ConfidenceBadge ──────────────────────────────────────────────────────────

const CONF_COLOR: Record<ConfidenceLevel, string> = {
  high:   colors.primary,
  medium: colors.yellow,
  low:    colors.text.tertiary,
};

function ConfidenceBadge({ confidence }: { confidence: ConfidenceInfo }) {
  const c = CONF_COLOR[confidence.level];
  return (
    <View style={confStyles.row}>
      <View style={[confStyles.dot, { backgroundColor: c }]} />
      <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, lineHeight: 16 }}>
        {confidence.note}
      </Text>
    </View>
  );
}

const confStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 4, flexShrink: 0 },
});

// ─── DataFooter ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function DataFooter({ indecEntry, usedFallback }: { indecEntry: InflationResult['indecEntry']; usedFallback: boolean }) {
  const label = `${MONTH_NAMES[indecEntry.month - 1]} ${indecEntry.year}`;
  return (
    <View style={ftStyles.row}>
      <Ionicons name="information-circle-outline" size={12} color={colors.text.tertiary} />
      <Text variant="caption" color={colors.text.tertiary}>
        {usedFallback
          ? `Usando datos INDEC de ${label} (último disponible)`
          : `Datos INDEC: ${label}`}
      </Text>
    </View>
  );
}

const ftStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
    paddingTop:    spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
});

// ─── Componente principal ─────────────────────────────────────────────────────

interface InflationThermometerProps {
  userId: string;
  year: number;
  month: number;
}

export function InflationThermometer({ userId, year, month }: InflationThermometerProps) {
  const [loading, setLoading] = useState(true);
  const [result,  setResult]  = useState<InflationResult | null>(null);

  useEffect(() => { load(); }, [userId, year, month]);

  const load = async () => {
    setLoading(true);
    setResult(null);
    try {
      const from    = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to      = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

      const { data, error } = await supabase
        .from('expenses')
        .select('amount, expense_categories ( name_es, color )')
        .eq('user_id', userId)
        .gte('date', from)
        .lte('date', to)
        .is('deleted_at', null);

      if (error || !data) { setResult(null); return; }

      // Agrupar por categoría sumando montos
      const grouped: Record<string, CategoryExpenseInput> = {};
      for (const row of data) {
        const cat = (row as any).expense_categories;
        const key = cat?.name_es ?? 'Otros';
        if (!grouped[key]) {
          grouped[key] = {
            categoryNameEs: key,
            categoryColor:  cat?.color ?? '#888888',
            amount:         0,
          };
        }
        grouped[key].amount += row.amount ?? 0;
      }

      const inputs = Object.values(grouped).filter(e => e.amount > 0);
      setResult(calculatePersonalInflation(inputs, year, month));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // ── Estados vacíos ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text variant="caption" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
          Calculando tu inflación personal...
        </Text>
      </View>
    );
  }

  if (!result) {
    return (
      <View style={s.noData}>
        <Ionicons name="thermometer-outline" size={36} color={colors.text.tertiary} />
        <Text variant="labelMd" color={colors.text.secondary} style={{ marginTop: spacing[3] }}>
          No hay suficientes datos
        </Text>
        <Text variant="caption" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[1], lineHeight: 18 }}>
          Necesitás al menos $1.000 en gastos con categoría asignada para poder calcular tu inflación personal.
        </Text>
      </View>
    );
  }

  const level = getInflationLevel(result.personalInflation, result.officialInflation);

  return (
    <View style={s.container}>
      <Text variant="label" color={colors.text.tertiary}>🌡️  TERMÓMETRO DEL MES</Text>

      <ComparisonNumbers
        personal={result.personalInflation}
        official={result.officialInflation}
        level={level}
      />

      <View style={s.gaugeBlock}>
        <InflationGauge
          personal={result.personalInflation}
          official={result.officialInflation}
          level={level}
        />
        <GaugeLegend />
      </View>

      <InsightCard
        headline={result.insights.headline}
        narrative={result.insights.narrative}
        contextNote={result.insights.contextNote}
        level={level}
      />

      <ImpactSection categoryWeights={result.categoryWeights} />

      <RecommendationSection recommendations={result.recommendations} />

      <ConfidenceBadge confidence={result.confidence} />

      <DataFooter
        indecEntry={result.indecEntry}
        usedFallback={result.usedFallbackMonth}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: spacing[5],
  },
  centered: {
    alignItems:     'center',
    paddingVertical: spacing[8],
  },
  noData: {
    alignItems:     'center',
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[4],
  },
  gaugeBlock: {
    alignItems:   'center',
    marginVertical: -spacing[2],
  },
});
