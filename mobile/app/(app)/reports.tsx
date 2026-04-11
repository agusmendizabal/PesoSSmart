/**
 * ReportsScreen — "Informe"
 *
 * Centro de análisis financiero del usuario.
 * Bloques: HealthScore · Resumen · Termómetro · Tendencia ·
 *          Distribución · Aprendizajes · En qué ahorrar ·
 *          Riesgos · CTA Asesor IA
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useExpensesStore } from '@/store/expensesStore';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';
import { InflationThermometer } from '@/components/InflationThermometer';
import { getLatestIndecEntry } from '@/lib/indecData';

// ─── Tipos ────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

const PALETTE = [
  '#00C853','#1978E5','#E53935','#FFB300',
  '#7B61FF','#FF6D00','#00BCD4','#E91E63','#4CAF50','#795548',
];

interface CategoryRow {
  id: string | null;
  name: string;
  color: string;
  amount: number;
  pct: number;
  classification_breakdown?: { necessary: number; disposable: number; investable: number };
}

interface MonthSummary {
  monthKey: string; // "YYYY-MM"
  label: string;
  total: number;
  disposable: number;
  necessary: number;
  investable: number;
}

// ─── Health Score ─────────────────────────────────────────────────────────────

interface HealthData {
  score: number;          // 0-100
  label: 'Excelente' | 'Buena' | 'Media' | 'Baja';
  color: string;
  reasons: string[];
  prevScore: number | null;
}

function computeHealthScore({
  total, necessary, disposable, investable,
  estimatedIncome, personalInflation, officialInflation,
}: {
  total: number; necessary: number; disposable: number; investable: number;
  estimatedIncome: number | null; personalInflation: number | null; officialInflation: number;
}): HealthData {
  let score = 65;
  const reasons: string[] = [];

  // Factor 1: % del ingreso gastado (±30 puntos)
  if (estimatedIncome && estimatedIncome > 0) {
    const pct = total / estimatedIncome;
    if (pct > 1.1)      { score -= 30; reasons.push('Te pasaste bastante del ingreso estimado.'); }
    else if (pct > 1)   { score -= 20; reasons.push('Te pasaste ligeramente del ingreso.'); }
    else if (pct > 0.85){ score -= 10; reasons.push('Gastaste más del 85% del ingreso.'); }
    else if (pct < 0.6) { score += 15; reasons.push('Gastaste menos del 60% del ingreso. Excelente margen.'); }
    else                { score +=  5; }
  }

  // Factor 2: % prescindibles sobre total (±20 puntos)
  if (total > 0) {
    const dispPct = disposable / total;
    if (dispPct > 0.25)      { score -= 20; reasons.push('Alta proporción de gastos prescindibles (+25%).'); }
    else if (dispPct > 0.15) { score -= 10; reasons.push('Gastos prescindibles moderados (15-25%).'); }
    else if (dispPct < 0.05) { score += 10; reasons.push('Muy pocos gastos prescindibles. Bien.'); }
  }

  // Factor 3: inflación personal vs oficial (±15 puntos)
  if (personalInflation !== null) {
    const diff = personalInflation - officialInflation;
    if (diff > 3)       { score -= 15; reasons.push(`Tu inflación personal superó la oficial en ${diff.toFixed(1)} puntos.`); }
    else if (diff > 1)  { score -=  7; reasons.push('Tu inflación personal fue algo mayor a la oficial.'); }
    else if (diff < -1) { score += 10; reasons.push('Tu inflación personal fue menor a la oficial. Positivo.'); }
  }

  // Factor 4: ahorro / invertible (±10 puntos)
  if (investable > 0) {
    score += 10;
    reasons.push(`Tenés ${formatCurrency(investable)} clasificados como invertibles.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const label: HealthData['label'] =
    score >= 80 ? 'Excelente' :
    score >= 60 ? 'Buena' :
    score >= 40 ? 'Media' : 'Baja';

  const color =
    score >= 80 ? colors.primary :
    score >= 60 ? '#66bb6a' :
    score >= 40 ? colors.yellow : colors.red;

  return { score, label, color, reasons, prevScore: null };
}

// ─── Tendencia ────────────────────────────────────────────────────────────────

function buildTendenciaInsights(history: MonthSummary[]): string[] {
  if (history.length < 2) return [];
  const insights: string[] = [];
  const last   = history[history.length - 1];
  const prev   = history[history.length - 2];
  const oldest = history[0];

  // Gasto total tendencia
  const diffPct = prev.total > 0 ? ((last.total - prev.total) / prev.total) * 100 : 0;
  if (diffPct > 15)       insights.push(`Gastaste un ${Math.round(diffPct)}% más que el mes pasado.`);
  else if (diffPct < -10) insights.push(`Bajaste el gasto un ${Math.round(Math.abs(diffPct))}% vs el mes pasado. 👏`);

  // Prescindibles tendencia
  if (prev.disposable > 0 && last.disposable < prev.disposable * 0.85) {
    insights.push(`Bajaste tus gastos prescindibles vs el mes pasado. Bien.`);
  } else if (last.disposable > prev.disposable * 1.2) {
    insights.push(`Tus gastos prescindibles subieron respecto al mes pasado.`);
  }

  // Tendencia 3 meses
  if (history.length >= 3 && last.total > oldest.total * 1.2) {
    insights.push(`Venís con tendencia alcista en gasto hace ${history.length} meses.`);
  }

  return insights;
}

// ─── En qué ahorrar ───────────────────────────────────────────────────────────

interface AhorroSugerencia {
  icon: string;
  text: string;
  saving: number;
}

function buildAhorroSugerencias({
  rows, disposable, total, estimatedIncome,
}: {
  rows: CategoryRow[]; disposable: number; total: number; estimatedIncome: number | null;
}): AhorroSugerencia[] {
  const sugerencias: AhorroSugerencia[] = [];

  // Top categoría prescindible
  const topRow = rows[0];
  if (topRow && topRow.pct > 0.2 && topRow.amount > 5000) {
    const saving = Math.round(topRow.amount * 0.3);
    sugerencias.push({
      icon: 'cut-outline',
      text: `Reduciendo "${topRow.name}" un 30% → ahorrás ${formatCurrency(saving)}/mes.`,
      saving,
    });
  }

  // Prescindibles totales
  if (disposable > 10000) {
    const saving = Math.round(disposable * 0.5);
    sugerencias.push({
      icon: 'wallet-outline',
      text: `La mitad de tus prescindibles son ${formatCurrency(saving)} que podrías invertir.`,
      saving,
    });
  }

  // Exceso vs ingreso
  if (estimatedIncome && total > estimatedIncome) {
    const excess = total - estimatedIncome;
    sugerencias.push({
      icon: 'trending-down-outline',
      text: `Si ajustás ${formatCurrency(excess)} de gastos, cerrarías el mes en equilibrio.`,
      saving: excess,
    });
  }

  // Segunda categoría más alta
  if (rows.length >= 2 && rows[1].amount > 8000) {
    const saving = Math.round(rows[1].amount * 0.2);
    sugerencias.push({
      icon: 'remove-circle-outline',
      text: `Un 20% menos en "${rows[1].name}" → ${formatCurrency(saving)} de diferencia.`,
      saving,
    });
  }

  return sugerencias.slice(0, 3);
}

// ─── Qué aprendimos ───────────────────────────────────────────────────────────

function buildAprendizajes({
  rows, history, disposable, total,
}: {
  rows: CategoryRow[]; history: MonthSummary[]; disposable: number; total: number;
}): string[] {
  const insights: string[] = [];

  // Concentración
  if (rows.length > 0 && rows[0].pct > 0.45) {
    insights.push(`Tu gasto está muy concentrado: "${rows[0].name}" representa casi la mitad del total.`);
  } else if (rows.length >= 2 && rows[0].pct + rows[1].pct > 0.65) {
    insights.push(`Solo 2 categorías explican el ${Math.round((rows[0].pct + rows[1].pct) * 100)}% de tu gasto.`);
  }

  // Patrón prescindibles
  if (total > 0 && disposable / total > 0.2) {
    insights.push(`Sos sensible a gastos de ocio/prescindibles — representan más del 20% de tu total.`);
  }

  // Tendencia consistente
  if (history.length >= 3) {
    const increasing = history.every((m, i) => i === 0 || m.total >= history[i - 1].total);
    const decreasing = history.every((m, i) => i === 0 || m.total <= history[i - 1].total);
    if (increasing) insights.push(`Tus gastos vienen en aumento constante los últimos ${history.length} meses.`);
    if (decreasing) insights.push(`Venís bajando el gasto consistentemente. Muy bien.`);
  }

  // Diversificación
  if (rows.length >= 6) {
    insights.push(`Tu gasto está bien distribuido entre ${rows.length} categorías distintas.`);
  }

  return insights.slice(0, 3);
}

// ─── Componentes UI ───────────────────────────────────────────────────────────

// MonthSelector
function MonthSelector({ month, year, onPrev, onNext, disableNext }: {
  month: number; year: number;
  onPrev: () => void; onNext: () => void; disableNext: boolean;
}) {
  return (
    <View style={msStyles.row}>
      <TouchableOpacity style={msStyles.btn} onPress={onPrev}>
        <Ionicons name="chevron-back" size={20} color={colors.text.primary} />
      </TouchableOpacity>
      <Text variant="subtitle" color={colors.text.primary}>
        {MONTH_NAMES[month - 1]} {year}
      </Text>
      <TouchableOpacity style={[msStyles.btn, disableNext && { opacity: 0.3 }]} onPress={onNext} disabled={disableNext}>
        <Ionicons name="chevron-forward" size={20} color={colors.text.primary} />
      </TouchableOpacity>
    </View>
  );
}
const msStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border.subtle },
  btn: { padding: spacing[2] },
});

// HealthScoreCard
function HealthScoreCard({ data }: { data: HealthData }) {
  const ringSize = 80;
  const radius   = 32;
  const circumference = 2 * Math.PI * radius;
  const progress = (data.score / 100) * circumference;

  return (
    <Card style={hsStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>SALUD FINANCIERA DEL MES</Text>
      <View style={hsStyles.inner}>
        {/* Anillo SVG */}
        <View style={hsStyles.ringWrap}>
          <Svg width={ringSize} height={ringSize}>
            <Circle cx={ringSize/2} cy={ringSize/2} r={radius} stroke={colors.border.subtle} strokeWidth={7} fill="none" />
            <Circle
              cx={ringSize/2} cy={ringSize/2} r={radius}
              stroke={data.color} strokeWidth={7} fill="none"
              strokeDasharray={`${progress} ${circumference}`}
              strokeLinecap="round"
              rotation="-90"
              origin={`${ringSize/2}, ${ringSize/2}`}
            />
          </Svg>
          <View style={hsStyles.ringCenter}>
            <Text style={{ fontSize: 18, fontFamily: 'DMSans_700Bold', color: data.color }}>{data.score}</Text>
          </View>
        </View>

        {/* Label + reasons */}
        <View style={{ flex: 1, gap: spacing[2] }}>
          <View style={[hsStyles.labelPill, { backgroundColor: data.color + '20' }]}>
            <Text style={{ fontSize: 13, fontFamily: 'DMSans_700Bold', color: data.color }}>
              {data.label}
            </Text>
            {data.prevScore !== null && (
              <Text variant="caption" color={data.score >= data.prevScore ? colors.primary : colors.red}>
                {data.score >= data.prevScore ? '▲' : '▼'} vs mes anterior
              </Text>
            )}
          </View>
          {data.reasons.slice(0, 2).map((r, i) => (
            <Text key={i} variant="caption" color={colors.text.secondary} style={{ lineHeight: 16 }}>
              · {r}
            </Text>
          ))}
        </View>
      </View>
    </Card>
  );
}
const hsStyles = StyleSheet.create({
  card:      { padding: spacing[5], gap: spacing[4] },
  inner:     { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  ringWrap:  { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  ringCenter:{ position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  labelPill: { alignSelf: 'flex-start', paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: 20, gap: 2 },
});

// ResumenCard
function ResumenCard({ total, necessary, disposable, investable, estimatedIncome }: {
  total: number; necessary: number; disposable: number; investable: number; estimatedIncome: number | null;
}) {
  const incomePct  = estimatedIncome && estimatedIncome > 0 ? Math.round((total / estimatedIncome) * 100) : null;
  const overBudget = incomePct !== null && incomePct > 100;
  const statusColor = overBudget ? colors.red : incomePct !== null && incomePct > 80 ? colors.yellow : colors.primary;
  const statusLabel = overBudget ? '¡TE PASASTE!' : incomePct !== null && incomePct > 80 ? 'CUIDADO' : 'EN ORDEN';

  return (
    <Card style={resStyles.card}>
      <View style={resStyles.header}>
        <Text variant="label" color={colors.text.tertiary}>RESUMEN DEL MES</Text>
        {incomePct !== null && (
          <View style={[resStyles.statusPill, { backgroundColor: statusColor + '20' }]}>
            <Text style={[resStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        )}
      </View>
      <Text variant="number" color={colors.text.primary}>{formatCurrency(total)}</Text>
      {incomePct !== null && (
        <View style={resStyles.incomeRow}>
          <View style={resStyles.progressTrack}>
            <View style={[resStyles.progressFill, { width: `${Math.min(incomePct, 100)}%`, backgroundColor: statusColor }]} />
          </View>
          <Text variant="caption" color={statusColor} style={{ fontFamily: 'DMSans_600SemiBold' }}>
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
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusPill:    { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: 20 },
  statusText:    { fontSize: 9, fontFamily: 'DMSans_700Bold' },
  incomeRow:     { gap: spacing[1] },
  progressTrack: { height: 5, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  breakdown:     { flexDirection: 'row', gap: spacing[4], flexWrap: 'wrap' },
  breakdownItem: { gap: 2 },
});

// TendenciaCard
function TendenciaCard({ history, insights }: { history: MonthSummary[]; insights: string[] }) {
  if (history.length < 2) return null;
  const maxTotal = Math.max(...history.map(m => m.total), 1);

  return (
    <Card style={tendStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>TENDENCIA</Text>

      {/* Mini barras por mes */}
      <View style={tendStyles.bars}>
        {history.map((m, i) => {
          const isLast = i === history.length - 1;
          const h = Math.max(4, Math.round((m.total / maxTotal) * 60));
          return (
            <View key={m.monthKey} style={tendStyles.barGroup}>
              <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 8 }}>
                {formatCurrency(m.total).replace('$ ', '').replace('.000', 'k')}
              </Text>
              <View style={[tendStyles.bar, { height: h, backgroundColor: isLast ? colors.primary : colors.border.default }]} />
              <Text variant="caption" color={isLast ? colors.text.primary : colors.text.tertiary} style={{ fontSize: 9 }}>
                {m.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Insights de tendencia */}
      {insights.map((ins, i) => (
        <View key={i} style={tendStyles.insightRow}>
          <Ionicons name="trending-up-outline" size={14} color={colors.text.tertiary} />
          <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 16 }}>{ins}</Text>
        </View>
      ))}
    </Card>
  );
}
const tendStyles = StyleSheet.create({
  card:       { padding: spacing[5], gap: spacing[4] },
  bars:       { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  barGroup:   { flex: 1, alignItems: 'center', gap: spacing[1] },
  bar:        { width: '100%', borderRadius: 4 },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
});

// MiniDonut
const DS = 160, DCX = DS/2, DCY = DS/2, DR = 62, DIR = 38;
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(s: number, e: number): string {
  const o1 = polar(DCX,DCY,DR,s), o2 = polar(DCX,DCY,DR,e);
  const i1 = polar(DCX,DCY,DIR,s), i2 = polar(DCX,DCY,DIR,e);
  const large = e-s>180?1:0;
  return [`M ${o1.x} ${o1.y}`,`A ${DR} ${DR} 0 ${large} 1 ${o2.x} ${o2.y}`,`L ${i2.x} ${i2.y}`,`A ${DIR} ${DIR} 0 ${large} 0 ${i1.x} ${i1.y}`,'Z'].join(' ');
}
function MiniDonut({ rows, total }: { rows: CategoryRow[]; total: number }) {
  let deg = 0;
  return (
    <View style={{ width: DS, height: DS }}>
      <Svg width={DS} height={DS}>
        <Circle cx={DCX} cy={DCY} r={DR} fill={colors.border.subtle} />
        <Circle cx={DCX} cy={DCY} r={DIR} fill={colors.bg.primary} />
        {rows.map((row, i) => {
          const sweep = row.pct * 360;
          const start = deg + 1; const end = deg + sweep - 1;
          deg += sweep;
          if (sweep < 2) return null;
          return <G key={i}><Path d={arcPath(start, end)} fill={row.color} /></G>;
        })}
        <Circle cx={DCX} cy={DCY} r={DIR - 1} fill={colors.bg.primary} />
      </Svg>
      <View style={donutStyles.center} pointerEvents="none">
        <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>TOTAL</Text>
        <Text style={{ fontSize: 12, fontFamily: 'DMSans_700Bold', color: colors.text.primary }}>{formatCurrency(total)}</Text>
      </View>
    </View>
  );
}
const donutStyles = StyleSheet.create({
  center: { position: 'absolute', top:0,left:0,right:0,bottom:0, alignItems:'center', justifyContent:'center' },
});

// DistribucionCard
function DistribucionCard({ rows, total }: { rows: CategoryRow[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <Card style={distStyles.card}>
      <Text variant="label" color={colors.text.tertiary}>DISTRIBUCIÓN POR CATEGORÍA</Text>
      <View style={distStyles.inner}>
        <MiniDonut rows={rows} total={total} />
        <View style={distStyles.legend}>
          {rows.slice(0, 5).map(row => (
            <View key={row.id ?? row.name} style={distStyles.row}>
              <View style={[distStyles.dot, { backgroundColor: row.color }]} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }} numberOfLines={1}>{row.name}</Text>
              <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }}>{Math.round(row.pct * 100)}%</Text>
            </View>
          ))}
          {rows.length > 5 && <Text variant="caption" color={colors.text.tertiary}>+{rows.length - 5} más</Text>}
        </View>
      </View>
    </Card>
  );
}
const distStyles = StyleSheet.create({
  card:  { padding: spacing[5], gap: spacing[4] },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  legend:{ flex: 1, gap: spacing[2] },
  row:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot:   { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
});

// AprendizajesCard
function AprendizajesCard({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <Card style={apStyles.card}>
      <View style={apStyles.header}>
        <Ionicons name="bulb-outline" size={14} color={colors.yellow} />
        <Text variant="label" color={colors.text.tertiary}>QUÉ APRENDIMOS DE VOS ESTE MES</Text>
      </View>
      {insights.map((ins, i) => (
        <View key={i} style={apStyles.row}>
          <View style={apStyles.bullet} />
          <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 20 }}>{ins}</Text>
        </View>
      ))}
    </Card>
  );
}
const apStyles = StyleSheet.create({
  card:   { padding: spacing[5], gap: spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.yellow, marginTop: 7, flexShrink: 0 },
});

// AhorroCard
function AhorroCard({ sugerencias, month, year }: { sugerencias: AhorroSugerencia[]; month: number; year: number }) {
  if (sugerencias.length === 0) return null;
  const totalSaving = sugerencias.reduce((s, sg) => s + sg.saving, 0);

  // Rendimiento estimado si invierte el ahorro en FCI (2%/mes) y CEDEARs (3.5%/mes promedio)
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
    <Card style={ahoStyles.card}>
      <View style={ahoStyles.header}>
        <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
        <Text variant="label" color={colors.text.tertiary}>EN QUÉ PODRÍAS AHORRAR YA</Text>
      </View>
      {sugerencias.map((sg, i) => (
        <View key={i} style={ahoStyles.row}>
          <View style={ahoStyles.iconBox}>
            <Ionicons name={sg.icon as any} size={16} color={colors.primary} />
          </View>
          <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 20 }}>{sg.text}</Text>
        </View>
      ))}
      <View style={ahoStyles.totalRow}>
        <Text variant="caption" color={colors.text.tertiary}>Potencial de ahorro total:</Text>
        <Text variant="labelMd" color={colors.primary}>{formatCurrency(totalSaving)}/mes</Text>
      </View>

      {/* Proyección de rendimiento */}
      <View style={ahoStyles.projRow}>
        <View style={ahoStyles.projItem}>
          <Text variant="caption" color={colors.text.tertiary}>FCI (2%/mes)</Text>
          <Text variant="labelMd" color={colors.neon}>+{formatCurrency(fciReturn)}</Text>
        </View>
        <View style={ahoStyles.projDivider} />
        <View style={ahoStyles.projItem}>
          <Text variant="caption" color={colors.text.tertiary}>CEDEARs (≈3.5%)</Text>
          <Text variant="labelMd" color={colors.neon}>+{formatCurrency(cedearReturn)}</Text>
        </View>
      </View>

      {/* CTA específico de inversión */}
      <TouchableOpacity
        style={ahoStyles.investBtn}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/(app)/advisor', params: { initialContext: investContext } } as any)}
      >
        <Ionicons name="trending-up-outline" size={16} color={colors.black} />
        <Text style={{ fontFamily: 'DMSans_600SemiBold', fontSize: 13, color: colors.black }}>
          ¿En qué invierto y cuánto genero?
        </Text>
        <Ionicons name="arrow-forward" size={14} color={colors.black} style={{ marginLeft: 'auto' }} />
      </TouchableOpacity>
    </Card>
  );
}
const ahoStyles = StyleSheet.create({
  card:        { padding: spacing[5], gap: spacing[3] },
  header:      { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  iconBox:     { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border.subtle },
  projRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.elevated, borderRadius: 10, padding: spacing[3] },
  projItem:    { flex: 1, alignItems: 'center', gap: 2 },
  projDivider: { width: 1, height: 32, backgroundColor: colors.border.subtle },
  investBtn:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
});

// RiesgosCard
function RiesgosCard({ items }: { items: { icon: string; color: string; text: string }[] }) {
  if (items.length === 0) return null;
  return (
    <Card style={riesStyles.card}>
      <View style={riesStyles.header}>
        <Ionicons name="warning-outline" size={14} color={colors.red} />
        <Text variant="label" color={colors.text.tertiary}>RIESGOS DETECTADOS</Text>
      </View>
      {items.map((item, i) => (
        <View key={i} style={riesStyles.row}>
          <Ionicons name={item.icon as any} size={16} color={item.color} style={{ flexShrink: 0 }} />
          <Text variant="bodySmall" color={colors.text.primary} style={{ flex: 1, lineHeight: 20 }}>{item.text}</Text>
        </View>
      ))}
    </Card>
  );
}
const riesStyles = StyleSheet.create({
  card:   { padding: spacing[5], gap: spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  row:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
});

// AdvisorCTA
function AdvisorCTA({ context }: { context: string }) {
  return (
    <TouchableOpacity
      style={ctaStyles.card}
      onPress={() => router.push({ pathname: '/(app)/advisor', params: { initialContext: context } } as any)}
      activeOpacity={0.85}
    >
      <View style={ctaStyles.left}>
        <View style={ctaStyles.avatar}>
          <Text style={{ fontSize: 13, fontFamily: 'DMSans_700Bold', color: colors.black }}>SP</Text>
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

// ─── Screen principal ─────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { user }   = useAuthStore();
  const { totalThisMonth, totalNecessary, totalDisposable, totalInvestable, estimatedIncome } = useExpensesStore();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [rows,  setRows]  = useState<CategoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<MonthSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const { startDate, endDate } = useMemo(() => {
    const s  = `${year}-${String(month).padStart(2, '0')}-01`;
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    const e  = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { startDate: s, endDate: e };
  }, [month, year]);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      // Query mes actual + 3 meses históricos en paralelo
      const [mainRes, histRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category:expense_categories(id, name_es, color), classification')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', startDate)
          .lt('date', endDate),

        supabase
          .from('expenses')
          .select('amount, date, classification')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .gte('date', (() => {
            const d = new Date(year, month - 4, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
          })())
          .lt('date', startDate),
      ]);

      // Procesar mes principal
      const map: Record<string, CategoryRow> = {};
      let sum = 0;
      for (const exp of mainRes.data ?? []) {
        const cat   = (exp as any).category;
        const catId = cat?.id ?? 'none';
        if (!map[catId]) {
          map[catId] = {
            id: catId, name: cat?.name_es ?? 'Sin categoría',
            color: cat?.color ?? PALETTE[Object.keys(map).length % PALETTE.length],
            amount: 0, pct: 0,
          };
        }
        map[catId].amount += (exp as any).amount;
        sum += (exp as any).amount;
      }
      const result = Object.values(map)
        .map(r => ({ ...r, pct: sum > 0 ? r.amount / sum : 0 }))
        .sort((a, b) => b.amount - a.amount);
      setTotal(sum);
      setRows(result);

      // Procesar histórico: agrupar por mes
      const histMap: Record<string, MonthSummary> = {};
      for (const exp of histRes.data ?? []) {
        const key = (exp.date as string).slice(0, 7); // "YYYY-MM"
        if (!histMap[key]) {
          const [y, m] = key.split('-').map(Number);
          histMap[key] = { monthKey: key, label: MONTH_NAMES[m - 1].slice(0, 3), total: 0, disposable: 0, necessary: 0, investable: 0 };
        }
        histMap[key].total += exp.amount;
        if (exp.classification === 'disposable')  histMap[key].disposable += exp.amount;
        if (exp.classification === 'necessary')   histMap[key].necessary  += exp.amount;
        if (exp.classification === 'investable')  histMap[key].investable += exp.amount;
      }
      const histList = Object.values(histMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey)).slice(-3);
      setHistory(histList);

    } catch (err) {
      console.error('[Informe] loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (isCurrentMonth) return; if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const displayTotal      = isCurrentMonth ? totalThisMonth  : total;
  const displayNecessary  = isCurrentMonth ? totalNecessary  : 0;
  const displayDisposable = isCurrentMonth ? totalDisposable : 0;
  const displayInvestable = isCurrentMonth ? totalInvestable : 0;
  const displayIncome     = isCurrentMonth ? estimatedIncome : null;

  // Computar bloques derivados
  const officialInflation = getLatestIndecEntry().general;

  const healthData = useMemo(() => computeHealthScore({
    total: displayTotal, necessary: displayNecessary,
    disposable: displayDisposable, investable: displayInvestable,
    estimatedIncome: displayIncome,
    personalInflation: null, // InflationThermometer lo calcula internamente
    officialInflation,
  }), [displayTotal, displayNecessary, displayDisposable, displayInvestable, displayIncome, officialInflation]);

  const tendenciaInsights = useMemo(() => buildTendenciaInsights(history), [history]);

  const ahorroSugerencias = useMemo(() => buildAhorroSugerencias({
    rows, disposable: displayDisposable, total: displayTotal, estimatedIncome: displayIncome,
  }), [rows, displayDisposable, displayTotal, displayIncome]);

  const aprendizajes = useMemo(() => buildAprendizajes({
    rows, history, disposable: displayDisposable, total: displayTotal,
  }), [rows, history, displayDisposable, displayTotal]);

  const riesgos = useMemo(() => {
    const items: { icon: string; color: string; text: string }[] = [];
    if (displayIncome && displayTotal > displayIncome)
      items.push({ icon: 'alert-circle-outline', color: colors.red, text: `Estás gastando más de lo que ganás. Déficit de ${formatCurrency(displayTotal - displayIncome)}.` });
    if (displayTotal > 0 && displayDisposable / displayTotal > 0.25)
      items.push({ icon: 'warning-outline', color: colors.yellow, text: `Más del 25% de tu gasto es prescindible. Alta exposición a gastos evitables.` });
    if (rows.length > 0 && rows[0].pct > 0.5)
      items.push({ icon: 'pie-chart-outline', color: colors.yellow, text: `Alta dependencia de una sola categoría: "${rows[0].name}" (${Math.round(rows[0].pct * 100)}% del total).` });
    if (displayInvestable === 0 && displayTotal > 50000)
      items.push({ icon: 'trending-down-outline', color: colors.text.tertiary, text: `Ningún gasto clasificado como invertible. Revisá si hay plata que podrías redirigir.` });
    return items;
  }, [displayTotal, displayDisposable, displayInvestable, displayIncome, rows]);

  const advisorContext = useMemo(() => {
    const parts = [
      `Informe de ${MONTH_NAMES[month - 1]} ${year}.`,
      `Gasté ${formatCurrency(displayTotal)}.`,
      healthData.score < 60 ? `Mi salud financiera está ${healthData.label}.` : `Mi salud financiera es ${healthData.label}.`,
      displayDisposable > 0 ? `Tengo ${formatCurrency(displayDisposable)} en prescindibles.` : '',
      displayIncome ? `Eso es el ${Math.round((displayTotal / displayIncome) * 100)}% de mi ingreso.` : '',
      rows[0] ? `Mi categoría más alta: "${rows[0].name}" (${Math.round(rows[0].pct * 100)}%).` : '',
      '¿Qué me recomendás?',
    ].filter(Boolean);
    return parts.join(' ');
  }, [month, year, displayTotal, healthData, displayDisposable, displayIncome, rows]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <Text variant="h4">Informe</Text>

        <MonthSelector month={month} year={year} onPrev={prevMonth} onNext={nextMonth} disableNext={isCurrentMonth} />

        {isLoading ? (
          <View style={s.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : displayTotal === 0 ? (
          <View style={s.empty}>
            <Ionicons name="bar-chart-outline" size={48} color={colors.border.default} />
            <Text variant="body" color={colors.text.tertiary} align="center">
              No hay gastos para{'\n'}{MONTH_NAMES[month - 1]} {year}
            </Text>
          </View>
        ) : (
          <>
            <HealthScoreCard data={healthData} />
            <ResumenCard total={displayTotal} necessary={displayNecessary} disposable={displayDisposable} investable={displayInvestable} estimatedIncome={displayIncome} />
            <Card style={s.section}><InflationThermometer userId={user!.id} year={year} month={month} /></Card>
            <TendenciaCard history={history} insights={tendenciaInsights} />
            <DistribucionCard rows={rows} total={total || displayTotal} />
            <AprendizajesCard insights={aprendizajes} />
            <AhorroCard sugerencias={ahorroSugerencias} month={month} year={year} />
            <RiesgosCard items={riesgos} />
            <AdvisorCTA context={advisorContext} />
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.primary },
  scroll:  { paddingHorizontal: layout.screenPadding, paddingTop: spacing[4], paddingBottom: layout.tabBarHeight + spacing[8], gap: spacing[4] },
  loading: { height: 280, alignItems: 'center', justifyContent: 'center' },
  empty:   { height: 280, alignItems: 'center', justifyContent: 'center', gap: spacing[4] },
  section: { padding: spacing[5] },
});
