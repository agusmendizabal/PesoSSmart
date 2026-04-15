/**
 * ReportCards — Componentes y lógica compartidos entre ReportsScreen y el tab Análisis de Gastos.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing } from '@/theme';
import { Text, Card } from '@/components/ui';
import { formatCurrency } from '@/utils/format';

// ─── Constantes ───────────────────────────────────────────────────────────────

export const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

export const PALETTE = [
  '#00C853','#1978E5','#E53935','#FFB300',
  '#7B61FF','#FF6D00','#00BCD4','#E91E63','#4CAF50','#795548',
];

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CategoryRow {
  id: string | null;
  name: string;
  color: string;
  amount: number;
  pct: number;
}

export interface MonthSummary {
  monthKey: string;
  label: string;
  total: number;
  disposable: number;
  necessary: number;
  investable: number;
}

export interface StatusData {
  status: 'good' | 'tight' | 'over';
  emoji: string;
  label: string;
  subtitle: string;
  color: string;
}

export interface KeyInsight {
  text: string;
  sentiment: 'negative' | 'warning' | 'positive';
  icon: string;
}

export interface ComparacionData {
  vsPrev: { changePct: number; changeAmount: number; better: boolean } | null;
  vsAvg:  { changePct: number; changeAmount: number; better: boolean } | null;
  disposableTrend: 'up' | 'down' | 'same' | null;
}

export interface AhorroSugerencia {
  icon: string;
  text: string;
  saving: number;
}

export interface PlanItem {
  icon: string;
  title: string;
  description: string;
  impact: number | null;
}

export interface ObjetivoData {
  title: string;
  currentPct: number;
  targetPct: number;
  status: 'on_track' | 'off_track' | 'achieved';
  statusLabel: string;
  color: string;
}

// ─── Lógica de análisis ───────────────────────────────────────────────────────

export function computeMonthStatus({ total, disposable, estimatedIncome }: {
  total: number; disposable: number; estimatedIncome: number | null;
}): StatusData {
  const dispPct   = total > 0 ? disposable / total : 0;
  const incomePct = estimatedIncome && estimatedIncome > 0 ? total / estimatedIncome : null;

  if (incomePct !== null && incomePct > 1) {
    return {
      status: 'over', emoji: '🔴', label: 'Te pasaste',
      subtitle: `Gastaste el ${Math.round(incomePct * 100)}% de tu ingreso estimado`,
      color: colors.red,
    };
  }
  if ((incomePct !== null && incomePct > 0.85) || dispPct > 0.2) {
    return {
      status: 'tight', emoji: '🟡', label: 'Ajustado',
      subtitle: incomePct !== null && incomePct > 0.85
        ? `Usaste el ${Math.round(incomePct * 100)}% de tu ingreso`
        : `El ${Math.round(dispPct * 100)}% de tu gasto fue prescindible`,
      color: colors.yellow,
    };
  }
  return {
    status: 'good', emoji: '🟢', label: 'Buen manejo',
    subtitle: incomePct !== null
      ? `Usaste el ${Math.round(incomePct * 100)}% de tu ingreso. Bien.`
      : `Tus gastos prescindibles están bajo control`,
    color: colors.primary,
  };
}

export function buildKeyInsight({ total, disposable, estimatedIncome, rows, history }: {
  total: number; disposable: number; estimatedIncome: number | null;
  rows: CategoryRow[]; history: MonthSummary[];
}): KeyInsight | null {
  if (total === 0) return null;

  if (estimatedIncome && total > estimatedIncome) {
    const pct = Math.round(((total - estimatedIncome) / estimatedIncome) * 100);
    return { text: `Te pasaste un ${pct}% de tu ingreso estimado este mes`, sentiment: 'negative', icon: 'trending-up-outline' };
  }

  const dispPct = total > 0 ? disposable / total : 0;
  if (dispPct > 0.25) {
    return { text: `El ${Math.round(dispPct * 100)}% de tu gasto fue prescindible este mes`, sentiment: 'negative', icon: 'warning-outline' };
  }

  if (rows.length > 0 && rows[0].pct > 0.45) {
    return { text: `"${rows[0].name}" concentró el ${Math.round(rows[0].pct * 100)}% de todo tu gasto`, sentiment: 'warning', icon: 'pie-chart-outline' };
  }

  if (history.length >= 1) {
    const prev = history[history.length - 1];
    if (prev.total > 0) {
      const changePct = Math.round(((total - prev.total) / prev.total) * 100);
      if (changePct > 15) return { text: `Gastaste un ${changePct}% más que el mes pasado`, sentiment: 'warning', icon: 'trending-up-outline' };
      if (changePct < -10) return { text: `Bajaste el gasto un ${Math.abs(changePct)}% respecto al mes pasado`, sentiment: 'positive', icon: 'trending-down-outline' };
    }
  }

  if (dispPct > 0.15) {
    return { text: `El ${Math.round(dispPct * 100)}% de tus gastos fueron prescindibles`, sentiment: 'warning', icon: 'wallet-outline' };
  }

  if (estimatedIncome && total < estimatedIncome * 0.75) {
    const savedPct = Math.round(((estimatedIncome - total) / estimatedIncome) * 100);
    return { text: `Mantuviste el ${savedPct}% de tu ingreso sin gastar. Excelente margen`, sentiment: 'positive', icon: 'checkmark-circle-outline' };
  }

  if (rows.length > 0) {
    return { text: `Tu mayor gasto fue "${rows[0].name}" con el ${Math.round(rows[0].pct * 100)}% del total`, sentiment: 'warning', icon: 'bar-chart-outline' };
  }

  return null;
}

export function buildComparacion(history: MonthSummary[], currentTotal: number, currentDisposable: number): ComparacionData {
  if (history.length === 0) return { vsPrev: null, vsAvg: null, disposableTrend: null };

  const sorted = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  const prev   = sorted[sorted.length - 1];

  const vsPrev = prev ? {
    changePct:    prev.total > 0 ? Math.round(((currentTotal - prev.total) / prev.total) * 100) : 0,
    changeAmount: Math.round(currentTotal - prev.total),
    better:       currentTotal <= prev.total,
  } : null;

  const vsAvg = sorted.length >= 2 ? (() => {
    const avg = sorted.reduce((s, m) => s + m.total, 0) / sorted.length;
    return {
      changePct:    avg > 0 ? Math.round(((currentTotal - avg) / avg) * 100) : 0,
      changeAmount: Math.round(currentTotal - avg),
      better:       currentTotal <= avg,
    };
  })() : null;

  const disposableTrend: ComparacionData['disposableTrend'] = prev
    ? currentDisposable < prev.disposable * 0.9 ? 'down'
      : currentDisposable > prev.disposable * 1.1 ? 'up'
      : 'same'
    : null;

  return { vsPrev, vsAvg, disposableTrend };
}

export function buildAhorroSugerencias({ rows, disposable, total, estimatedIncome }: {
  rows: CategoryRow[]; disposable: number; total: number; estimatedIncome: number | null;
}): AhorroSugerencia[] {
  const sugerencias: AhorroSugerencia[] = [];

  if (disposable > 10000) {
    sugerencias.push({ icon: 'wallet-outline', text: `Ajustando la mitad de tus prescindibles`, saving: Math.round(disposable * 0.5) });
  }
  if (rows[0] && rows[0].pct > 0.2 && rows[0].amount > 5000) {
    sugerencias.push({ icon: 'cut-outline', text: `Reduciendo "${rows[0].name}" un 30%`, saving: Math.round(rows[0].amount * 0.3) });
  }
  if (estimatedIncome && total > estimatedIncome) {
    sugerencias.push({ icon: 'trending-down-outline', text: `Ajustando el exceso sobre tu ingreso`, saving: Math.round(total - estimatedIncome) });
  }
  if (rows.length >= 2 && rows[1].amount > 8000) {
    sugerencias.push({ icon: 'remove-circle-outline', text: `Un 20% menos en "${rows[1].name}"`, saving: Math.round(rows[1].amount * 0.2) });
  }

  return sugerencias.slice(0, 3);
}

export function buildPlanProximoMes({ rows, disposable, total, estimatedIncome, history }: {
  rows: CategoryRow[]; disposable: number; total: number;
  estimatedIncome: number | null; history: MonthSummary[];
}): PlanItem[] {
  const items: PlanItem[] = [];
  const dispPct = total > 0 ? disposable / total : 0;

  if (dispPct > 0.15) {
    const target = Math.round(total * 0.1);
    const saving = Math.round(disposable - target);
    items.push({
      icon: 'cut-outline',
      title: 'Reducí los prescindibles',
      description: `Intentá no superar el 10% en gastos no esenciales (${formatCurrency(target)})`,
      impact: saving > 0 ? saving : null,
    });
  }

  if (rows.length > 0 && rows[0].pct > 0.3) {
    items.push({
      icon: 'pie-chart-outline',
      title: `Controlá "${rows[0].name}"`,
      description: `Apuntá a no pasar de ${formatCurrency(Math.round(rows[0].amount * 0.85))} en esta categoría`,
      impact: Math.round(rows[0].amount * 0.15),
    });
  }

  if (estimatedIncome && total > estimatedIncome * 0.95) {
    const target = Math.round(estimatedIncome * 0.85);
    items.push({
      icon: 'trending-down-outline',
      title: 'Apuntá a gastar menos del 85% del ingreso',
      description: `Objetivo: ${formatCurrency(target)}/mes para tener margen de ahorro`,
      impact: Math.round(total - target),
    });
  }

  if (estimatedIncome && total < estimatedIncome * 0.8 && items.length < 3) {
    items.push({
      icon: 'trending-up-outline',
      title: 'Invertí lo que pudiste ahorrar',
      description: `Tenés margen para invertir hasta ${formatCurrency(Math.round((estimatedIncome - total) * 0.5))} este mes`,
      impact: null,
    });
  }

  if (history.length >= 2 && items.length < 3) {
    const sorted = [...history].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    const prev   = sorted[sorted.length - 1];
    if (prev.total > 0 && total > prev.total * 1.1) {
      items.push({
        icon: 'bar-chart-outline',
        title: 'Cortá la tendencia al alza',
        description: `Venís gastando más cada mes. El próximo, intentá mantenerte o bajar`,
        impact: null,
      });
    }
  }

  return items.slice(0, 3);
}

export function buildObjetivo({ disposable, total }: { disposable: number; total: number }): ObjetivoData | null {
  if (total === 0) return null;
  const currentPct = Math.round((disposable / total) * 100);
  const targetPct  = currentPct > 15 ? 10 : 5;

  const status: ObjetivoData['status'] =
    currentPct <= targetPct ? 'achieved' :
    currentPct <= targetPct + 5 ? 'on_track' : 'off_track';

  const statusMap = {
    achieved: { label: '¡Objetivo cumplido!', color: colors.primary },
    on_track: { label: 'Cerca del objetivo',  color: colors.yellow  },
    off_track:{ label: 'Por encima del objetivo', color: colors.red },
  };

  return {
    title: `Bajar prescindibles al ${targetPct}%`,
    currentPct, targetPct, status,
    statusLabel: statusMap[status].label,
    color:       statusMap[status].color,
  };
}

// ─── Componentes UI ───────────────────────────────────────────────────────────

export function MonthStatusBanner({ data }: { data: StatusData }) {
  return (
    <View style={[banStyles.banner, { borderColor: data.color + '50', backgroundColor: data.color + '12' }]}>
      <Text style={banStyles.emoji}>{data.emoji}</Text>
      <View style={{ gap: 3, flex: 1 }}>
        <Text style={[banStyles.label, { color: data.color }]}>{data.label}</Text>
        <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 16 }}>{data.subtitle}</Text>
      </View>
    </View>
  );
}
const banStyles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 12, padding: spacing[4], flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  emoji:  { fontSize: 28 },
  label:  { fontSize: 17, fontFamily: 'Montserrat_700Bold' },
});

export function KeyInsightCard({ insight }: { insight: KeyInsight }) {
  const color = insight.sentiment === 'negative' ? colors.red : insight.sentiment === 'positive' ? colors.primary : colors.yellow;
  return (
    <Card style={[kiStyles.card, { borderLeftWidth: 3, borderLeftColor: color }]}>
      <View style={kiStyles.header}>
        <View style={[kiStyles.iconWrap, { backgroundColor: color + '18' }]}>
          <Ionicons name={insight.icon as any} size={16} color={color} />
        </View>
        <Text variant="label" color={colors.text.tertiary}>DATO CLAVE DEL MES</Text>
      </View>
      <Text style={kiStyles.text}>{insight.text}</Text>
    </Card>
  );
}
const kiStyles = StyleSheet.create({
  card:    { padding: spacing[5], gap: spacing[3] },
  header:  { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  iconWrap:{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text:    { fontSize: 17, fontFamily: 'Montserrat_600SemiBold', lineHeight: 26, color: colors.text.primary },
});

export function ResumenCard({ total, necessary, disposable, investable, estimatedIncome }: {
  total: number; necessary: number; disposable: number; investable: number; estimatedIncome: number | null;
}) {
  const incomePct   = estimatedIncome && estimatedIncome > 0 ? Math.round((total / estimatedIncome) * 100) : null;
  const statusColor = incomePct !== null && incomePct > 100 ? colors.red : incomePct !== null && incomePct > 80 ? colors.yellow : colors.primary;

  return (
    <Card style={resStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>RESUMEN DEL MES</Text>
      <Text variant="number" color={colors.text.primary}>{formatCurrency(total)}</Text>
      {incomePct !== null && (
        <View style={resStyles.incomeRow}>
          <View style={resStyles.progressTrack}>
            <View style={[resStyles.progressFill, { width: `${Math.min(incomePct, 100)}%`, backgroundColor: statusColor }]} />
          </View>
          <Text variant="caption" color={statusColor} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            {incomePct}% del ingreso estimado ({formatCurrency(estimatedIncome!)})
          </Text>
        </View>
      )}
      <View style={resStyles.breakdown}>
        {[
          { label: 'Necesario',    amount: necessary,  color: colors.primary },
          { label: 'Prescindible', amount: disposable, color: colors.red },
          { label: 'Invertible',   amount: investable, color: '#66bb6a' },
        ].filter(i => i.amount > 0).map(({ label, amount, color }) => (
          <View key={label} style={resStyles.breakdownItem}>
            <Text variant="caption" color={colors.text.tertiary}>{label.toUpperCase()}</Text>
            <Text variant="labelMd" color={color}>{formatCurrency(amount)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
const resStyles = StyleSheet.create({
  card:          { padding: spacing[5], gap: spacing[3] },
  incomeRow:     { gap: spacing[1] },
  progressTrack: { height: 5, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  breakdown:     { flexDirection: 'row', gap: spacing[4], flexWrap: 'wrap' },
  breakdownItem: { gap: 2 },
});

export function CategoryBreakdown({ rows, total }: { rows: CategoryRow[]; total: number }) {
  if (rows.length === 0) return null;
  const maxAmount = rows[0]?.amount ?? 1;
  return (
    <Card style={cbStyles.card}>
      <View style={cbStyles.header}>
        <Text variant="label" color={colors.text.tertiary}>DISTRIBUCIÓN POR CATEGORÍA</Text>
        <Text variant="caption" color={colors.text.tertiary}>{formatCurrency(total)}</Text>
      </View>

      <View style={cbStyles.stackBar}>
        {rows.map((row, i) => (
          <View key={i} style={[cbStyles.stackSlice, { flex: row.amount, backgroundColor: row.color }]} />
        ))}
      </View>

      <View style={cbStyles.barList}>
        {rows.map((row, i) => (
          <View key={i} style={cbStyles.barRow}>
            <View style={cbStyles.barMeta}>
              <View style={[cbStyles.dot, { backgroundColor: row.color }]} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }} numberOfLines={1}>
                {row.name}
              </Text>
              <Text variant="caption" color={row.color} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                {Math.round(row.pct * 100)}%
              </Text>
              <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_500Medium', minWidth: 72, textAlign: 'right' }}>
                {formatCurrency(row.amount)}
              </Text>
            </View>
            <View style={cbStyles.track}>
              <View style={[cbStyles.fill, { width: `${(row.amount / maxAmount) * 100}%`, backgroundColor: row.color }]} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}
const cbStyles = StyleSheet.create({
  card:       { padding: spacing[5], gap: spacing[4] },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stackBar:   { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 },
  stackSlice: { borderRadius: 2 },
  barList:    { gap: spacing[3] },
  barRow:     { gap: spacing[1] },
  barMeta:    { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot:        { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  track:      { height: 4, backgroundColor: colors.border.subtle, borderRadius: 2, overflow: 'hidden' },
  fill:       { height: '100%', borderRadius: 2 },
});

export function HistoryComparisonCard({ history, comparacion, currentTotal }: {
  history: MonthSummary[]; comparacion: ComparacionData; currentTotal: number;
}) {
  if (history.length < 1) return null;
  const maxTotal = Math.max(...history.map(m => m.total), currentTotal, 1);
  const displayBars = [...history.slice(-3), { monthKey: 'current', label: 'Este mes', total: currentTotal }];

  return (
    <Card style={hcStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>COMPARACIÓN HISTÓRICA</Text>

      <View style={hcStyles.bars}>
        {displayBars.map((m) => {
          const isLast = m.monthKey === 'current';
          const h = Math.max(4, Math.round((m.total / maxTotal) * 60));
          return (
            <View key={m.monthKey} style={hcStyles.barGroup}>
              <Text variant="caption" color={isLast ? colors.text.primary : colors.text.tertiary} style={{ fontSize: 8 }}>
                {formatCurrency(m.total).replace('$ ', '').replace('.000', 'k')}
              </Text>
              <View style={[hcStyles.bar, { height: h, backgroundColor: isLast ? colors.primary : colors.border.default }]} />
              <Text variant="caption" color={isLast ? colors.text.primary : colors.text.tertiary} style={{ fontSize: 9 }}>{m.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={hcStyles.comparisons}>
        {comparacion.vsPrev !== null && (
          <View style={hcStyles.compRow}>
            <Ionicons
              name={comparacion.vsPrev.better ? 'trending-down-outline' : 'trending-up-outline'}
              size={14}
              color={comparacion.vsPrev.better ? colors.primary : colors.red}
            />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 16 }}>
              {comparacion.vsPrev.better
                ? `Gastaste ${Math.abs(comparacion.vsPrev.changePct)}% menos que el mes pasado 👏`
                : `Gastaste ${comparacion.vsPrev.changePct}% más que el mes pasado`}
            </Text>
          </View>
        )}
        {comparacion.vsAvg !== null && (
          <View style={hcStyles.compRow}>
            <Ionicons name="stats-chart-outline" size={14} color={comparacion.vsAvg.better ? colors.primary : colors.yellow} />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 16 }}>
              {comparacion.vsAvg.better
                ? `Por debajo de tu promedio de los últimos 3 meses`
                : `${Math.abs(comparacion.vsAvg.changePct)}% por encima de tu promedio histórico`}
            </Text>
          </View>
        )}
        {comparacion.disposableTrend !== null && comparacion.disposableTrend !== 'same' && (
          <View style={hcStyles.compRow}>
            <Ionicons
              name={comparacion.disposableTrend === 'down' ? 'thumbs-up-outline' : 'alert-circle-outline'}
              size={14}
              color={comparacion.disposableTrend === 'down' ? colors.primary : colors.red}
            />
            <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 16 }}>
              {comparacion.disposableTrend === 'down'
                ? 'Reduciste tus prescindibles respecto al mes pasado'
                : 'Tus prescindibles subieron respecto al mes pasado'}
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}
const hcStyles = StyleSheet.create({
  card:        { padding: spacing[5], gap: spacing[4] },
  bars:        { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  barGroup:    { flex: 1, alignItems: 'center', gap: spacing[1] },
  bar:         { width: '100%', borderRadius: 4 },
  comparisons: { gap: spacing[2] },
  compRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
});

export function DineroRecuperableCard({ sugerencias, month, year }: {
  sugerencias: AhorroSugerencia[]; month: number; year: number;
}) {
  if (sugerencias.length === 0) return null;
  const totalSaving  = sugerencias.reduce((s, sg) => s + sg.saving, 0);
  const fciReturn    = Math.round(totalSaving * 0.02);
  const cedearReturn = Math.round(totalSaving * 0.035);

  const investContext = [
    `Informe de ${MONTH_NAMES[month - 1]} ${year}.`,
    `Identifiqué que podría ahorrar ${formatCurrency(totalSaving)} por mes reduciendo gastos prescindibles.`,
    `¿En qué instrumentos me conviene invertir ese dinero?`,
    `¿Cuánto podría generar por mes y por año si lo invierto?`,
    `Contame las opciones más concretas para Argentina hoy.`,
  ].join(' ');

  return (
    <Card style={drStyles.card}>
      <View style={drStyles.header}>
        <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
        <Text variant="label" color={colors.text.tertiary}>DINERO RECUPERABLE</Text>
      </View>

      <View style={drStyles.headline}>
        <Text variant="caption" color={colors.text.secondary}>Podrías haber ahorrado</Text>
        <Text style={drStyles.amount}>{formatCurrency(totalSaving)}</Text>
        <Text variant="caption" color={colors.text.tertiary}>este mes</Text>
      </View>

      {sugerencias.map((sg, i) => (
        <View key={i} style={drStyles.row}>
          <View style={drStyles.iconBox}>
            <Ionicons name={sg.icon as any} size={14} color={colors.primary} />
          </View>
          <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 18 }}>
            {sg.text}:{' '}
            <Text variant="caption" color={colors.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
              {formatCurrency(sg.saving)}
            </Text>
          </Text>
        </View>
      ))}

      <View style={drStyles.projRow}>
        <View style={drStyles.projItem}>
          <Text variant="caption" color={colors.text.tertiary}>FCI (2%/mes)</Text>
          <Text variant="labelMd" color={colors.neon}>+{formatCurrency(fciReturn)}</Text>
        </View>
        <View style={drStyles.projDivider} />
        <View style={drStyles.projItem}>
          <Text variant="caption" color={colors.text.tertiary}>CEDEARs (≈3.5%)</Text>
          <Text variant="labelMd" color={colors.neon}>+{formatCurrency(cedearReturn)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={drStyles.investBtn}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/(app)/advisor', params: { initialContext: investContext } } as any)}
      >
        <Ionicons name="trending-up-outline" size={16} color={colors.black} />
        <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 13, color: colors.black }}>
          ¿En qué invierto y cuánto genero?
        </Text>
        <Ionicons name="arrow-forward" size={14} color={colors.black} style={{ marginLeft: 'auto' }} />
      </TouchableOpacity>
    </Card>
  );
}
const drStyles = StyleSheet.create({
  card:        { padding: spacing[5], gap: spacing[3] },
  header:      { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headline:    { alignItems: 'center', paddingVertical: spacing[3], borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border.subtle, gap: 2 },
  amount:      { fontSize: 30, fontFamily: 'Montserrat_700Bold', color: colors.text.primary, lineHeight: 40 },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  iconBox:     { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  projRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.elevated, borderRadius: 10, padding: spacing[3] },
  projItem:    { flex: 1, alignItems: 'center', gap: 2 },
  projDivider: { width: 1, height: 32, backgroundColor: colors.border.subtle },
  investBtn:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
});

export function PlanProximoMesCard({ items }: { items: PlanItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card style={planStyles.card}>
      <View style={planStyles.header}>
        <Ionicons name="calendar-outline" size={14} color={colors.text.tertiary} />
        <Text variant="label" color={colors.text.tertiary}>PLAN PARA EL PRÓXIMO MES</Text>
      </View>
      {items.map((item, i) => (
        <View key={i} style={[planStyles.item, i < items.length - 1 && planStyles.itemBorder]}>
          <View style={planStyles.iconWrap}>
            <Ionicons name={item.icon as any} size={16} color={colors.neon} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
              {item.title}
            </Text>
            <Text variant="caption" color={colors.text.secondary} style={{ lineHeight: 16 }}>
              {item.description}
            </Text>
            {item.impact !== null && (
              <Text variant="caption" color={colors.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                → Ahorrarías {formatCurrency(item.impact)}
              </Text>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}
const planStyles = StyleSheet.create({
  card:       { padding: spacing[5], gap: spacing[3] },
  header:     { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  item:       { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingVertical: spacing[2] },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
  iconWrap:   { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.neon + '12', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
});

export function ObjetivoCard({ objetivo }: { objetivo: ObjetivoData }) {
  const fillPct = objetivo.currentPct <= objetivo.targetPct ? 1 : objetivo.targetPct / objetivo.currentPct;
  return (
    <Card style={objStyles.card}>
      <View style={objStyles.header}>
        <Ionicons name="flag-outline" size={14} color={colors.text.tertiary} />
        <Text variant="label" color={colors.text.tertiary}>OBJETIVO SUGERIDO</Text>
        <View style={[objStyles.statusPill, { backgroundColor: objetivo.color + '20' }]}>
          <Text style={[objStyles.statusText, { color: objetivo.color }]}>{objetivo.statusLabel}</Text>
        </View>
      </View>
      <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
        {objetivo.title}
      </Text>
      <View style={objStyles.progressSection}>
        <View style={objStyles.progressTrack}>
          <View style={[objStyles.progressFill, { width: `${Math.round(fillPct * 100)}%`, backgroundColor: objetivo.color }]} />
        </View>
        <View style={objStyles.progressLabels}>
          <Text variant="caption" color={colors.text.tertiary}>Estás en {objetivo.currentPct}%</Text>
          <Text variant="caption" color={objetivo.color} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            Objetivo: {objetivo.targetPct}%
          </Text>
        </View>
      </View>
    </Card>
  );
}
const objStyles = StyleSheet.create({
  card:           { padding: spacing[5], gap: spacing[3] },
  header:         { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  statusPill:     { marginLeft: 'auto', paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: 20 },
  statusText:     { fontSize: 9, fontFamily: 'Montserrat_700Bold' },
  progressSection:{ gap: spacing[2] },
  progressTrack:  { height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  progressFill:   { height: '100%', borderRadius: 3 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
});

export function AdvisorCTA({ context }: { context: string }) {
  return (
    <TouchableOpacity
      style={ctaStyles.card}
      onPress={() => router.push({ pathname: '/(app)/advisor', params: { initialContext: context } } as any)}
      activeOpacity={0.85}
    >
      <View style={ctaStyles.left}>
        <View style={ctaStyles.avatar}>
          <Text style={{ fontSize: 13, fontFamily: 'Montserrat_700Bold', color: colors.black }}>SP</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="labelMd" color={colors.black}>Hablá con tu asesor</Text>
          <Text variant="caption" color={colors.black + 'AA'}>Tiene tu contexto real. Preguntale lo que quieras.</Text>
        </View>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.black} />
    </TouchableOpacity>
  );
}
const ctaStyles = StyleSheet.create({
  card:   { backgroundColor: colors.neon, borderRadius: 14, padding: spacing[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3] },
  left:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.black + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
