import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { spacing, layout } from '@/theme';
import { Text } from '@/components/ui/Text';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { type CategoryBudget } from '@/lib/budgetPlan';
import { formatCurrency } from '@/utils/format';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:     '#FAFAF7',
  card:   '#FFFFFF',
  blue:   '#1976D2',
  green:  '#27AE60',
  violet: '#27AE60',
  red:    '#EF4444',
  amber:  '#F59E0B',
  text:   '#1C1C1C',
  sub:    '#6D6A63',
  muted:  '#9B9790',
  border: '#E8E2D9',
  light:  '#F5F1E9',
} as const;

const shadow = layout.cardShadow;

// ─── Category Icon helper ─────────────────────────────────────────────────────

function CategoryIcon({ icon, color, size = 20 }: {
  icon: string | null; color: string; size?: number;
}) {
  if (!icon) return <Ionicons name="pricetag-outline" size={size} color={color} />;
  if (icon.includes('-') || /^[a-z]/.test(icon)) {
    return <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />;
  }
  return <Text style={{ fontSize: size - 2, lineHeight: size + 4 }}>{icon}</Text>;
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart({ history, avgMonthly }: {
  history: CategoryBudget['monthHistory'];
  avgMonthly: number;
}) {
  const all  = [...history.map(h => h.amount), avgMonthly];
  const max  = Math.max(...all, 1);
  const W    = 300;
  const H    = 110;
  const barW = 50;
  const totalBars = history.length + 1;
  const gap  = (W - barW * totalBars) / (totalBars + 1);
  const avgY = H - (avgMonthly / max) * H;

  return (
    <View style={bc.container}>
      <Svg width={W} height={H + 28}>
        {/* Avg dashed line */}
        <Line
          x1={0} y1={avgY}
          x2={W} y2={avgY}
          stroke={C.blue + '70'}
          strokeWidth={1.5}
          strokeDasharray="5,5"
        />
        {/* History bars */}
        {history.map((h, i) => {
          const barH  = (h.amount / max) * H;
          const x     = gap + i * (barW + gap);
          const y     = H - barH;
          const color = h.amount > avgMonthly ? C.red : C.violet;
          return (
            <React.Fragment key={h.month}>
              <Rect x={x} y={y} width={barW} height={Math.max(barH, 4)} rx={10} fill={color + 'CC'} />
              <SvgText
                x={x + barW / 2} y={H + 18}
                textAnchor="middle" fontSize={11}
                fill={C.muted}
                fontFamily="Montserrat_500Medium"
              >
                {h.label}
              </SvgText>
            </React.Fragment>
          );
        })}
        {/* Promedio bar */}
        {(() => {
          const barH = (avgMonthly / max) * H;
          const x    = gap + history.length * (barW + gap);
          const y    = H - barH;
          return (
            <>
              <Rect x={x} y={y} width={barW} height={Math.max(barH, 4)} rx={10} fill={C.blue + 'CC'} />
              <SvgText
                x={x + barW / 2} y={H + 18}
                textAnchor="middle" fontSize={11}
                fill={C.blue}
                fontFamily="Montserrat_600SemiBold"
              >
                Promedio
              </SvgText>
            </>
          );
        })()}
      </Svg>
    </View>
  );
}

const bc = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: spacing[3] },
});

// NOTA (auditoría Plan Inteligente): antes había acá una "SmartRecommendationCard"
// que calculaba su propio monto de ahorro con una regla fija (20% de reducción,
// sin tener en cuenta el día del mes ni el ritmo real). Convivía con el banner de
// arriba (basado en `paceRatio`) y mostraba un número de ahorro DISTINTO para la
// misma categoría — dos "recomendaciones inteligentes" con cifras que no
// coincidían. Se sacó en vez de arreglarse porque el banner de arriba ya cubre
// "qué está pasando / cuánto representa" con el mismo cálculo que el resto de la
// pantalla; no hacía falta una segunda tarjeta con una cuenta distinta.

// ─── Resumen Tab ──────────────────────────────────────────────────────────────

function ResumenTab({ cat }: { cat: CategoryBudget }) {
  const isOver        = cat.status === 'over';
  const isWarning     = cat.status === 'warning';
  const isOportunidad = cat.alertLevel === 'oportunidad';
  const diff      = cat.projected - cat.avgMonthly;
  const diffSign  = diff >= 0 ? '+' : '';
  const barColor  = isOver ? C.red : isWarning ? C.amber : C.green;
  const saved     = Math.max(0, cat.expectedByNow - cat.currentSpend);

  return (
    <View style={rt.container}>
      {/* Alert banner */}
      {(isOver || isWarning) && (
        <View style={[rt.alert, {
          backgroundColor: isOver ? C.red + '0F' : C.amber + '0F',
          borderColor:     isOver ? C.red + '40' : C.amber + '40',
        }]}>
          <Ionicons
            name={isOver ? 'warning' : 'alert-circle'}
            size={18}
            color={isOver ? C.red : C.amber}
          />
          <View style={{ flex: 1 }}>
            <Text style={[rt.alertTitle, { color: isOver ? C.red : C.amber }]}>
              {isOver ? 'Ya superaste tu promedio' : 'Estás llegando al límite'}
            </Text>
            <Text style={rt.alertSub}>
              Gastaste {formatCurrency(cat.currentSpend)} y tu promedio mensual es {formatCurrency(cat.avgMonthly)}
            </Text>
          </View>
        </View>
      )}

      {/* Oportunidad banner */}
      {isOportunidad && saved > 0 && (
        <View style={[rt.alert, { backgroundColor: C.green + '0F', borderColor: C.green + '40' }]}>
          <Text style={{ fontSize: 18 }}>✨</Text>
          <View style={{ flex: 1 }}>
            <Text style={[rt.alertTitle, { color: C.green }]}>Oportunidad de ahorro</Text>
            <Text style={rt.alertSub}>
              Vas más lento que tu ritmo habitual — ahorraste {formatCurrency(saved)} respecto a tu promedio hasta ahora
            </Text>
          </View>
        </View>
      )}

      {/* Action buttons */}
      {(isOver || isWarning) && (
        <View style={rt.actionRow}>
          <TouchableOpacity
            style={rt.actionBtn}
            onPress={() => Alert.alert('Alerta creada', `Te avisaremos cuando te acerques al límite en ${cat.name}.`)}
            activeOpacity={0.8}
          >
            <Ionicons name="notifications-outline" size={15} color={C.blue} />
            <Text style={rt.actionBtnText}>Crear alerta</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rt.actionBtn, { borderColor: C.violet + '40', backgroundColor: C.violet + '08' }]}
            onPress={() => router.push('/(app)/savings-opportunities' as any)}
            activeOpacity={0.8}
          >
            <Ionicons name="analytics-outline" size={15} color={C.violet} />
            <Text style={[rt.actionBtnText, { color: C.violet }]}>Ver oportunidades</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main stats card */}
      <View style={rt.statsCard}>
        <View style={rt.progressHeader}>
          <Text style={rt.progressLabel}>Gasto actual</Text>
          <Text style={[rt.progressPct, { color: barColor }]}>
            {Math.round(cat.pct * 100)}% del promedio
          </Text>
        </View>
        <Text style={[rt.mainAmount, { color: isOver ? C.red : C.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {formatCurrency(cat.currentSpend)}
        </Text>
        <View style={rt.track}>
          <View style={[rt.fill, { width: `${Math.min(cat.pct * 100, 100)}%` as any, backgroundColor: barColor }]} />
        </View>
        <View style={rt.rangeRow}>
          <Text style={rt.rangeLabel}>$0</Text>
          <Text style={rt.rangeLabel}>{formatCurrency(cat.avgMonthly)}</Text>
        </View>

        <View style={rt.divider} />

        <View style={rt.grid}>
          <View style={rt.gridItem}>
            <Text style={rt.gridLabel}>Promedio últimos 3 meses</Text>
            <Text style={rt.gridValue}>{formatCurrency(cat.avgMonthly)}</Text>
          </View>
          <View style={rt.gridItem}>
            <Text style={rt.gridLabel}>Proyección a fin de mes</Text>
            <Text style={[rt.gridValue, { color: isOver ? C.red : C.text }]}>
              {formatCurrency(cat.projected)}
            </Text>
          </View>
          <View style={rt.gridItem}>
            <Text style={rt.gridLabel}>Diferencia vs. promedio</Text>
            <Text style={[rt.gridValue, { color: diff > 0 ? C.red : C.green }]}>
              {diffSign}{formatCurrency(Math.abs(diff))}
            </Text>
          </View>
        </View>
      </View>

      {/* Bar chart */}
      <View style={rt.chartCard}>
        <Text style={rt.chartTitle}>Últimos 3 meses</Text>
        <BarChart history={cat.monthHistory} avgMonthly={cat.avgMonthly} />
        <View style={rt.legend}>
          <View style={rt.legendItem}>
            <View style={[rt.legendDot, { backgroundColor: C.violet + 'CC' }]} />
            <Text style={rt.legendText}>Meses anteriores</Text>
          </View>
          <View style={rt.legendItem}>
            <View style={[rt.legendDot, { backgroundColor: C.blue + 'CC' }]} />
            <Text style={rt.legendText}>Promedio</Text>
          </View>
        </View>
      </View>

      {/* CTA */}
      <TouchableOpacity style={rt.txBtn} activeOpacity={0.85} onPress={() => {}}>
        <Text style={rt.txBtnText}>Ver transacciones</Text>
        <Ionicons name="arrow-forward" size={16} color="#FFF" />
      </TouchableOpacity>
    </View>
  );
}

const rt = StyleSheet.create({
  container:      { gap: spacing[4] },
  alert:          { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], borderWidth: 1, borderRadius: 16, padding: spacing[4] },
  alertTitle:     { fontFamily: 'Montserrat_700Bold', fontSize: 13, marginBottom: 2 },
  alertSub:       { fontFamily: 'Montserrat_400Regular', fontSize: 12, color: C.sub, lineHeight: 18 },
  actionRow:      { flexDirection: 'row', gap: spacing[3] },
  actionBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], borderWidth: 1, borderColor: C.blue + '40', backgroundColor: C.blue + '08', borderRadius: 12, paddingVertical: spacing[3] },
  actionBtnText:  { fontFamily: 'Montserrat_600SemiBold', fontSize: 12, color: C.blue },
  statsCard:      { backgroundColor: C.card, borderRadius: 20, padding: spacing[5], gap: spacing[3], ...shadow },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel:  { fontFamily: 'Montserrat_500Medium', fontSize: 12, color: C.muted },
  progressPct:    { fontFamily: 'Montserrat_700Bold', fontSize: 13 },
  mainAmount:     { fontFamily: 'Montserrat_800ExtraBold', fontSize: 36, color: C.text, lineHeight: 44 },
  track:          { height: 8, backgroundColor: C.light, borderRadius: 4, overflow: 'hidden' },
  fill:           { height: '100%', borderRadius: 4 },
  rangeRow:       { flexDirection: 'row', justifyContent: 'space-between' },
  rangeLabel:     { fontFamily: 'Montserrat_400Regular', fontSize: 10, color: C.muted },
  divider:        { height: 1, backgroundColor: C.border },
  grid:           { gap: spacing[3] },
  gridItem:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridLabel:      { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub },
  gridValue:      { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
  chartCard:      { backgroundColor: C.card, borderRadius: 20, padding: spacing[5], gap: spacing[2], ...shadow },
  chartTitle:     { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text },
  legend:         { flexDirection: 'row', gap: spacing[4], justifyContent: 'center' },
  legendItem:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  legendDot:      { width: 10, height: 10, borderRadius: 5 },
  legendText:     { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.sub },
  txBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: C.blue, borderRadius: 16, padding: spacing[4] },
  txBtnText:      { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: '#FFF' },
});

// ─── Historico Tab ────────────────────────────────────────────────────────────

function HistoricoTab({ cat }: { cat: CategoryBudget }) {
  return (
    <View style={{ gap: spacing[4] }}>
      {cat.monthHistory.map(h => (
        <View key={h.month} style={ht.row}>
          <Text style={ht.month}>{h.label.toUpperCase()}</Text>
          <View style={{ flex: 1, paddingHorizontal: spacing[4] }}>
            <View style={ht.track}>
              <View style={[ht.fill, {
                width: `${Math.min((h.amount / (cat.avgMonthly || 1)) * 100, 120)}%` as any,
                backgroundColor: h.amount > cat.avgMonthly ? C.red : C.violet,
              }]} />
            </View>
          </View>
          <Text style={ht.amount}>{formatCurrency(h.amount)}</Text>
        </View>
      ))}
      <View style={ht.avgRow}>
        <Text style={ht.avgLabel}>Promedio 3 meses</Text>
        <Text style={ht.avgValue}>{formatCurrency(cat.avgMonthly)}</Text>
      </View>
    </View>
  );
}

const ht = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: spacing[4], ...shadow },
  month:    { fontFamily: 'Montserrat_700Bold', fontSize: 11, color: C.muted, width: 36 },
  track:    { height: 8, backgroundColor: C.light, borderRadius: 4, overflow: 'hidden' },
  fill:     { height: '100%', borderRadius: 4 },
  amount:   { fontFamily: 'Montserrat_700Bold', fontSize: 13, color: C.text, minWidth: 90, textAlign: 'right' },
  avgRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[2] },
  avgLabel: { fontFamily: 'Montserrat_400Regular', fontSize: 13, color: C.sub },
  avgValue: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.blue },
});

// ─── Transacciones Tab ────────────────────────────────────────────────────────

interface Tx { id: string; description: string | null; amount: number; date: string; merchant: string | null; }

function TransaccionesTab({ categoryId }: { categoryId: string }) {
  const { user } = useAuthStore();
  const [txs,     setTxs]     = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const now   = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { data } = await (supabase as any)
      .from('expenses')
      .select('id, description, amount, date, merchant')
      .eq('user_id', user.id)
      .eq('category_id', categoryId)
      .gte('date', start)
      .is('deleted_at', null)
      .order('date', { ascending: false });
    setTxs(data ?? []);
    setLoading(false);
  }, [user?.id, categoryId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator size="large" color={C.violet} style={{ marginTop: spacing[8] }} />;

  if (txs.length === 0) return (
    <View style={{ alignItems: 'center', paddingVertical: spacing[8], gap: spacing[3] }}>
      <Text style={{ fontSize: 36 }}>🧾</Text>
      <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 15, color: C.text }}>
        Sin transacciones este mes
      </Text>
    </View>
  );

  return (
    <View style={{ gap: spacing[3] }}>
      {txs.map(tx => (
        <View key={tx.id} style={tt.row}>
          <View style={tt.iconBox}>
            <Ionicons name="receipt-outline" size={18} color={C.sub} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={tt.name} numberOfLines={1}>
              {tx.merchant ?? tx.description ?? 'Sin descripción'}
            </Text>
            <Text style={tt.date}>
              {new Date(tx.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
            </Text>
          </View>
          <Text style={tt.amount}>- {formatCurrency(tx.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

const tt = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: C.card, borderRadius: 14, padding: spacing[4], ...shadow },
  iconBox:{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 14, color: C.text, marginBottom: 2 },
  date:   { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: C.muted },
  amount: { fontFamily: 'Montserrat_700Bold', fontSize: 14, color: C.text },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

type TabKey = 'resumen' | 'historico' | 'transacciones';

export default function CategoryDetailScreen() {
  const params = useLocalSearchParams<{ categoryJson: string }>();
  const cat: CategoryBudget = JSON.parse(params.categoryJson ?? '{}');
  const [activeTab, setActiveTab] = useState<TabKey>('resumen');

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'resumen',       label: 'Resumen'       },
    { key: 'historico',     label: 'Histórico'     },
    { key: 'transacciones', label: 'Transacciones' },
  ];

  const accentColor =
    cat.status === 'over'    ? C.red   :
    cat.status === 'warning' ? C.amber :
    C.green;

  return (
    <SafeAreaView style={cd.safe} edges={['top']}>
      {/* Header — only shows category name, no icon text */}
      <View style={cd.header}>
        <TouchableOpacity style={cd.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={cd.titleRow}>
          <View style={[cd.titleIcon, { backgroundColor: accentColor + '14' }]}>
            <CategoryIcon icon={cat.icon} color={accentColor} size={18} />
          </View>
          <Text style={cd.headerTitle} numberOfLines={1}>{cat.name}</Text>
        </View>
        <TouchableOpacity style={cd.backBtn}>
          <Ionicons name="information-circle-outline" size={20} color={C.sub} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={cd.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[cd.tab, activeTab === tab.key && cd.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.7}
          >
            <Text style={[cd.tabText, activeTab === tab.key && cd.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={cd.scroll}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'resumen'       && <ResumenTab cat={cat} />}
        {activeTab === 'historico'     && <HistoricoTab cat={cat} />}
        {activeTab === 'transacciones' && <TransaccionesTab categoryId={cat.categoryId} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const cd = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.screenPadding, paddingTop: spacing[2], paddingBottom: spacing[3] },
  titleRow:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  titleIcon:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { fontFamily: 'Montserrat_700Bold', fontSize: 18, color: C.text },
  backBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  tabBar:       { flexDirection: 'row', paddingHorizontal: layout.screenPadding, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:          { flex: 1, paddingVertical: spacing[3], alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:    { borderBottomColor: C.blue },
  tabText:      { fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: C.muted },
  tabTextActive:{ color: C.blue },
  scroll:       { paddingHorizontal: layout.screenPadding, paddingTop: spacing[5], paddingBottom: layout.tabBarHeight + spacing[6] },
});
