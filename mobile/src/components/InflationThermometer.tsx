import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path, Circle, Line, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  calculatePersonalInflation,
  type CategoryExpenseInput,
  type CategoryWeight,
  type ConfidenceInfo,
  type ConfidenceLevel,
  type InflationResult,
  type Recommendation,
} from '@/utils/inflationCalc';

// ─── State tokens ─────────────────────────────────────────────────────────────

const C_GREEN  = '#27AE60';
const C_YELLOW = '#F9AB25';
const C_RED    = '#EF4444';

type GaugeState = 'green' | 'yellow' | 'red';

const STATE_CFG: Record<GaugeState, { bg: string; color: string; msg: string }> = {
  green:  { bg: '#D1F7E3', color: C_GREEN,  msg: 'Le ganaste a la inflación por' },
  yellow: { bg: '#FFF8E1', color: C_YELLOW, msg: 'Estuviste alineado con la inflación' },
  red:    { bg: '#FFEBEE', color: C_RED,    msg: 'Tu inflación está por encima del promedio por' },
};

function getState(diff: number): GaugeState {
  if (diff <= 0)   return 'green';
  if (diff <= 0.5) return 'yellow';
  return 'red';
}

// ─── Gauge SVG ────────────────────────────────────────────────────────────────

const GW       = 240;
const GH       = 140;
const CX       = GW / 2;
const CY       = GH - 16;
const R        = 96;
const STROKE   = 16;
const GAUGE_MAX  = 12;
const GREEN_END  = 72;   // 40% of 180°
const YELLOW_END = 108;  // 60% of 180°

function polar(deg: number, r = R) {
  const rad = ((deg - 180) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcD(startDeg: number, endDeg: number, r = R): string {
  const end   = endDeg - startDeg >= 180 ? startDeg + 179.9 : endDeg;
  const s     = polar(startDeg, r);
  const e     = polar(end,      r);
  const large = end - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// 0 = left (green/low), 180 = right (red/high)
function valueToDeg(value: number): number {
  const clamped = Math.max(0, Math.min(value, GAUGE_MAX));
  return (clamped / GAUGE_MAX) * 180;
}

function InflationGauge({ personal, official }: { personal: number; official: number }) {
  const personalDeg = valueToDeg(personal);
  const officialDeg = valueToDeg(official);

  const needleTip   = polar(personalDeg, R - STROKE / 2 - 2);
  const needleBase1 = polar(personalDeg + 90, 5);
  const needleBase2 = polar(personalDeg - 90, 5);

  const guideOuter = polar(officialDeg, R + 10);
  const guideInner = polar(officialDeg, R - STROKE - 6);

  return (
    <Svg width={GW} height={GH} viewBox={`0 0 ${GW} ${GH}`}>
      {/* Background track */}
      <Path d={arcD(0, 180)} stroke="#E8E2D9" strokeWidth={STROKE} fill="none" strokeLinecap="round" />

      {/* Green zone — left 40% */}
      <Path d={arcD(0, GREEN_END)} stroke={C_GREEN} strokeWidth={STROKE} fill="none" strokeLinecap="round" />

      {/* Yellow zone — center 20% */}
      <Path d={arcD(GREEN_END, YELLOW_END)} stroke={C_YELLOW} strokeWidth={STROKE} fill="none" strokeLinecap="butt" />

      {/* Red zone — right 40% */}
      <Path d={arcD(YELLOW_END, 180)} stroke={C_RED} strokeWidth={STROKE} fill="none" strokeLinecap="round" />

      {/* Official INDEC dashed marker */}
      <Line
        x1={guideOuter.x} y1={guideOuter.y}
        x2={guideInner.x} y2={guideInner.y}
        stroke="#BDBDBD"
        strokeWidth={1}
        strokeDasharray="3,3"
      />

      {/* Needle */}
      <G>
        <Path
          d={`M ${needleBase1.x} ${needleBase1.y} L ${needleTip.x} ${needleTip.y} L ${needleBase2.x} ${needleBase2.y} Z`}
          fill="#1C1C1C"
        />
        <Circle cx={CX} cy={CY} r={8} fill="#1C1C1C" />
        <Circle cx={CX} cy={CY} r={4} fill="white" />
      </G>
    </Svg>
  );
}

// ─── ImpactRow ────────────────────────────────────────────────────────────────

function ImpactRow({ cw, isTop }: { cw: CategoryWeight; isTop: boolean }) {
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
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[{ flex: 1 }, isTop && { fontFamily: 'Montserrat_600SemiBold' }]}
          >
            {cw.categoryNameEs}
          </Text>
          <Text variant="caption" color={colors.text.secondary}>
            +{cw.inflation.toFixed(1)}%
          </Text>
        </View>
        <View style={irStyles.track}>
          <View style={[irStyles.fill, { width: `${weightPct}%`, backgroundColor: cw.categoryColor }]} />
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
        <Text variant="label" color={colors.text.secondary}>¿QUÉ IMPULSÓ TU INFLACIÓN?</Text>
      </View>
      <View style={secStyles.list}>
        {visible.map((cw, i) => (
          <ImpactRow key={cw.categoryNameEs} cw={cw} isTop={i === 0} />
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

// ─── RecommendationSection ────────────────────────────────────────────────────

function RecommendationSection({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <View style={recStyles.consejo}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="bulb-outline" size={16} color="#F59E0B" />
        <Text variant="label" color="#F59E0B">CONSEJO</Text>
      </View>
      {recommendations.slice(0, 1).map((rec, i) => (
        <Text key={i} variant="bodySmall" color={colors.text.primary} style={{ lineHeight: 20 }}>
          {rec.text}
        </Text>
      ))}
    </View>
  );
}

const recStyles = StyleSheet.create({
  consejo: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: '#F59E0B40',
  },
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
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border.subtle,
  },
});

// ─── Main component ───────────────────────────────────────────────────────────

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

      const { data, error } = await (supabase as any)
        .from('expenses')
        .select('amount, expense_categories ( name_es, color )')
        .eq('user_id', userId)
        .gte('date', from)
        .lte('date', to)
        .is('deleted_at', null)
        .not('category_id', 'is', null);

      if (error || !data) { setResult(null); return; }

      const grouped: Record<string, CategoryExpenseInput> = {};
      for (const row of data) {
        const cat = (row as any).expense_categories;
        const key = cat?.name_es ?? 'Otros';
        if (!grouped[key]) {
          grouped[key] = { categoryNameEs: key, categoryColor: cat?.color ?? '#888888', amount: 0 };
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

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="small" color={C_GREEN} />
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

  const diff  = result.personalInflation - result.officialInflation;
  const state = getState(diff);
  const cfg   = STATE_CFG[state];

  return (
    <View style={s.wrap}>
      {/* Gauge card */}
      <View style={[gcS.card, { backgroundColor: cfg.bg }]}>
        <Text style={gcS.title}>Inflación personal vs. oficial</Text>

        <View style={gcS.gaugeWrap}>
          <InflationGauge
            personal={result.personalInflation}
            official={result.officialInflation}
          />
        </View>

        <Text style={[gcS.message, { color: cfg.color }]}>{cfg.msg}</Text>
        <Text style={[gcS.mainValue, { color: cfg.color }]}>
          {Math.abs(diff).toFixed(1).replace('.', ',')}%
        </Text>

        <View style={gcS.compRow}>
          <Text variant="caption" color="#6D6A63">{'Tu inflación: '}</Text>
          <Text variant="caption" color="#1C1C1C" style={{ fontFamily: 'Montserrat_700Bold' }}>
            {result.personalInflation.toFixed(1).replace('.', ',')}%
          </Text>
          <Text variant="caption" color="#6D6A63">{'   |   INDEC: '}</Text>
          <Text variant="caption" color="#1C1C1C" style={{ fontFamily: 'Montserrat_700Bold' }}>
            {result.officialInflation.toFixed(1).replace('.', ',')}%
          </Text>
        </View>
      </View>

      <ImpactSection categoryWeights={result.categoryWeights} />
      <RecommendationSection recommendations={result.recommendations} />
      <ConfidenceBadge confidence={result.confidence} />
      <DataFooter indecEntry={result.indecEntry} usedFallback={result.usedFallbackMonth} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const gcS = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    color: '#1C1C1C',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  gaugeWrap: {
    alignItems: 'center',
  },
  message: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    alignSelf: 'stretch',
  },
  mainValue: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 28,
    lineHeight: 38,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
  },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 12,
  },
});

const s = StyleSheet.create({
  wrap:     { gap: spacing[4] },
  centered: { alignItems: 'center', paddingVertical: spacing[8] },
  noData:   { alignItems: 'center', paddingVertical: spacing[8], paddingHorizontal: spacing[4] },
});
