/**
 * DecisionHistory — Historial de oportunidades pasadas y su resultado hipotético.
 *
 * Por cada mes anterior con gastos prescindibles significativos, muestra:
 *  - Cuánto había disponible
 *  - Qué hubiera pasado si lo invertía en FCI CER / Plazo Fijo UVA
 *  - Diferencia real vs hipotética
 *
 * Los datos se generan desde el historial de gastos (últimos 3 meses).
 */

import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text, Card } from '@/components/ui';
import { formatCurrency } from '@/utils/format';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface MonthOpportunity {
  monthKey:      string;
  monthLabel:    string;
  disposable:    number;
  halfAmount:    number;
  fciReturn:     number;
  cedearReturn:  number;
  cedearName:    string;
  cedearTicker:  string;
  cedearColor:   string;
  monthsAgo:     number;
  topCategories: { name: string; amount: number }[];
}

// ─── CEDEAR por categoría ────────────────────────────────────────────────────

const CEDEAR_BY_CATEGORY: Record<string, { name: string; ticker: string; color: string; monthlyRate: number }> = {
  'Comida y restaurantes': { name: "McDonald's", ticker: 'MCD',   color: '#FFC300', monthlyRate: 0.050 },
  'Café':                  { name: 'Starbucks',  ticker: 'SBUX',  color: '#00704A', monthlyRate: 0.050 },
  'Entretenimiento':       { name: 'Netflix',    ticker: 'NFLX',  color: '#E50914', monthlyRate: 0.070 },
  'Suscripciones':         { name: 'Netflix',    ticker: 'NFLX',  color: '#E50914', monthlyRate: 0.070 },
  'Ropa':                  { name: 'Nike',       ticker: 'NKE',   color: '#FF6B35', monthlyRate: 0.055 },
  'Deporte':               { name: 'Nike',       ticker: 'NKE',   color: '#FF6B35', monthlyRate: 0.055 },
  'Transporte':            { name: 'Tesla',      ticker: 'TSLA',  color: '#CC0000', monthlyRate: 0.075 },
  'Salud':                 { name: 'J&J',        ticker: 'JNJ',   color: '#D42B2B', monthlyRate: 0.045 },
  'Hogar':                 { name: 'Home Depot', ticker: 'HD',    color: '#F96302', monthlyRate: 0.050 },
  'Hogar y servicios':     { name: 'Home Depot', ticker: 'HD',    color: '#F96302', monthlyRate: 0.050 },
  'Tecnología':            { name: 'Apple',      ticker: 'AAPL',  color: '#555555', monthlyRate: 0.060 },
  'Educación':             { name: 'Alphabet',   ticker: 'GOOGL', color: '#4285F4', monthlyRate: 0.060 },
  'Peluquería':            { name: 'LVMH',       ticker: 'MC',    color: '#C8A96E', monthlyRate: 0.050 },
  'Seguros':               { name: 'Berkshire',  ticker: 'BRKB',  color: '#8B4513', monthlyRate: 0.045 },
};

const DEFAULT_CEDEAR = { name: 'S&P 500', ticker: 'SPY', color: '#27AE60', monthlyRate: 0.055 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

/** Rendimiento compuesto de n meses a tasa mensual r */
function compound(principal: number, monthlyRate: number, months: number): number {
  return Math.round(principal * (Math.pow(1 + monthlyRate, months) - 1));
}

export function buildOpportunities(
  history: { monthKey: string; disposable: number; categories?: Record<string, number> }[],
): MonthOpportunity[] {
  const now     = new Date();
  const results: MonthOpportunity[] = [];

  for (const entry of history) {
    if (entry.disposable < 10_000) continue;
    const [y, m] = entry.monthKey.split('-').map(Number);
    const monthDate = new Date(y, m - 1, 1);
    const monthsAgo = Math.max(1,
      (now.getFullYear() - monthDate.getFullYear()) * 12 +
      (now.getMonth() - monthDate.getMonth())
    );

    const half   = Math.round(entry.disposable * 0.5);
    const fciRet = compound(half, 0.03, monthsAgo);
    const label  = `${MONTH_NAMES_ES[m - 1]} ${y}`;

    const topCategories = Object.entries(entry.categories ?? {})
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    const topCatName = topCategories[0]?.name ?? '';
    const cedear     = CEDEAR_BY_CATEGORY[topCatName] ?? DEFAULT_CEDEAR;
    const cedearRet  = compound(half, cedear.monthlyRate, monthsAgo);

    results.push({
      monthKey: entry.monthKey, monthLabel: label, disposable: entry.disposable,
      halfAmount: half, fciReturn: fciRet,
      cedearReturn: cedearRet, cedearName: cedear.name,
      cedearTicker: cedear.ticker, cedearColor: cedear.color,
      monthsAgo, topCategories,
    });
  }

  return results.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

// ─── OpportunityCard ─────────────────────────────────────────────────────────

function OpportunityCard({ opp }: { opp: MonthOpportunity }) {
  const bestReturn = Math.max(opp.fciReturn, opp.cedearReturn);
  const bestLabel  = opp.cedearReturn >= opp.fciReturn
    ? `${opp.cedearName} (${opp.cedearTicker})`
    : 'FCI Money Market';
  const top        = opp.topCategories[0];
  const fciTotal   = opp.halfAmount + opp.fciReturn;
  const cedearTotal = opp.halfAmount + opp.cedearReturn;

  return (
    <View style={cardStyles.card}>

      {/* Encabezado del mes */}
      <View style={cardStyles.header}>
        <View style={[cardStyles.monthBadge, { backgroundColor: colors.primary + '15' }]}>
          <Text variant="caption" color={colors.primary} style={{ fontFamily: 'Montserrat_700Bold' }}>
            {opp.monthLabel}
          </Text>
        </View>
        <View style={cardStyles.agoTag}>
          <Ionicons name="time-outline" size={11} color={colors.text.tertiary} />
          <Text style={cardStyles.agoText}>hace {opp.monthsAgo} {opp.monthsAgo === 1 ? 'mes' : 'meses'}</Text>
        </View>
      </View>

      {/* Frase principal conversacional */}
      <View style={cardStyles.headlineBox}>
        {top ? (
          <Text variant="body" color={colors.text.primary} style={{ lineHeight: 22 }}>
            Gastaste{' '}
            <Text variant="body" color={colors.red} style={{ fontFamily: 'Montserrat_700Bold' }}>
              {formatCurrency(top.amount)}
            </Text>{' '}
            en{' '}
            <Text variant="body" color={colors.text.primary} style={{ fontFamily: 'Montserrat_700Bold' }}>
              {top.name.toLowerCase()}
            </Text>
            {opp.topCategories.length > 1
              ? ` y ${formatCurrency(opp.disposable - top.amount)} más en otros prescindibles.`
              : '.'}
          </Text>
        ) : (
          <Text variant="body" color={colors.text.primary}>
            Tuviste {formatCurrency(opp.disposable)} en gastos prescindibles.
          </Text>
        )}
      </View>

      {/* Desglose por categoría */}
      {opp.topCategories.length > 1 && (
        <View style={cardStyles.catList}>
          {opp.topCategories.map(cat => {
            const pct = Math.round((cat.amount / opp.disposable) * 100);
            return (
              <View key={cat.name} style={cardStyles.catRow}>
                <View style={cardStyles.catDot} />
                <Text variant="caption" color={colors.text.secondary} style={{ flex: 1 }}>
                  {cat.name}
                </Text>
                <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                  {formatCurrency(cat.amount)}
                </Text>
                <Text variant="caption" color={colors.text.tertiary} style={{ minWidth: 32, textAlign: 'right' }}>
                  {pct}%
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Qué hubiera pasado */}
      <View style={cardStyles.hypothetical}>
        <Text variant="caption" color={colors.text.tertiary} style={{ fontFamily: 'Montserrat_600SemiBold', letterSpacing: 0.5 }}>
          SI HUBIERAS INVERTIDO LA MITAD ({formatCurrency(opp.halfAmount)})
        </Text>
        <View style={cardStyles.comparison}>
          <View style={cardStyles.compareCol}>
            <View style={[cardStyles.compareIcon, { backgroundColor: colors.neon + '18' }]}>
              <Ionicons name="trending-up-outline" size={14} color={colors.neon} />
            </View>
            <Text variant="caption" color={colors.text.tertiary}>FCI Money Market</Text>
            <Text style={[cardStyles.compareGain, { color: colors.neon }]}>+{formatCurrency(opp.fciReturn)}</Text>
            <Text variant="caption" color={colors.text.secondary}>{formatCurrency(fciTotal)} total</Text>
          </View>
          <View style={cardStyles.compareDivider} />
          <View style={cardStyles.compareCol}>
            <View style={[cardStyles.compareIcon, { backgroundColor: opp.cedearColor + '22' }]}>
              <Ionicons name="bar-chart-outline" size={14} color={opp.cedearColor} />
            </View>
            <View style={cardStyles.bestRow}>
              <View>
                <Text variant="caption" color={colors.text.tertiary}>{opp.cedearName}</Text>
                <Text style={{ fontFamily: 'Montserrat_600SemiBold', fontSize: 9, color: opp.cedearColor }}>
                  CEDEAR {opp.cedearTicker}
                </Text>
              </View>
              {opp.cedearReturn >= opp.fciReturn && (
                <View style={cardStyles.bestBadge}>
                  <Text style={cardStyles.bestText}>MEJOR</Text>
                </View>
              )}
            </View>
            <Text style={[cardStyles.compareGain, { color: opp.cedearColor }]}>+{formatCurrency(opp.cedearReturn)}</Text>
            <Text variant="caption" color={colors.text.secondary}>{formatCurrency(cedearTotal)} total</Text>
          </View>
        </View>
      </View>

      {/* Conclusión */}
      <View style={cardStyles.conclusionRow}>
        <Ionicons name="bulb-outline" size={13} color={colors.yellow} />
        <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 17 }}>
          Con {bestLabel} hoy tendrías{' '}
          <Text variant="caption" color={colors.neon} style={{ fontFamily: 'Montserrat_700Bold' }}>
            +{formatCurrency(bestReturn)}
          </Text>{' '}
          más. Los CEDEARs son de mayor riesgo pero se alinean con lo que consumís.
        </Text>
      </View>
    </View>
  );
}

function CompareRow({
  label, icon, color, gain, total, months, isBest = false,
}: {
  label: string; icon: string; color: string; gain: number;
  total: number; months: number; isBest?: boolean;
}) {
  return (
    <View style={[crStyles.row, isBest && { backgroundColor: color + '08', borderRadius: 8, padding: spacing[2] }]}>
      <View style={[crStyles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={14} color={color} />
      </View>
      <View style={crStyles.textCol}>
        <View style={crStyles.labelRow}>
          <Text variant="caption" color={colors.text.secondary}>{label}</Text>
          {isBest && (
            <View style={[crStyles.bestBadge, { backgroundColor: color + '25' }]}>
              <Text style={[crStyles.bestText, { color }]}>MEJOR</Text>
            </View>
          )}
        </View>
        <Text variant="caption" color={colors.text.tertiary}>
          {months} {months === 1 ? 'mes' : 'meses'} compuesto
        </Text>
      </View>
      <View style={crStyles.right}>
        <Text style={[crStyles.gain, { color }]}>+{formatCurrency(gain)}</Text>
        <Text variant="caption" color={colors.text.tertiary}>{formatCurrency(total)} total</Text>
      </View>
    </View>
  );
}

const crStyles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconWrap:  { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  textCol:   { flex: 1, gap: 2 },
  labelRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  bestBadge: { paddingHorizontal: spacing[2], paddingVertical: 1, borderRadius: 4 },
  bestText:  { fontFamily: 'Montserrat_700Bold', fontSize: 8 },
  right:     { alignItems: 'flex-end', gap: 1 },
  gain:      { fontFamily: 'Montserrat_700Bold', fontSize: 14 },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 14, padding: spacing[4], gap: spacing[3],
  },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthBadge:    { paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: 20 },
  agoTag:        { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  agoText:       { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: colors.text.tertiary },
  comparison:    { gap: spacing[2] },
  divider:       { height: 1, backgroundColor: colors.border.subtle, marginVertical: spacing[1] },
  conclusionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], backgroundColor: colors.yellow + '0C', borderRadius: 8, padding: spacing[3] },
});

// ─── DecisionHistorySection ───────────────────────────────────────────────────

interface Props {
  opportunities: MonthOpportunity[];
}

export function DecisionHistorySection({ opportunities }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (opportunities.length === 0) return null;

  const totalPotential = opportunities.reduce((s, o) => s + Math.max(o.fciReturn, o.pfReturn), 0);

  return (
    <View style={sectionStyles.container}>
      {/* Header tappable */}
      <TouchableOpacity style={sectionStyles.header} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
        <View style={sectionStyles.headerLeft}>
          <View style={sectionStyles.iconWrap}>
            <Ionicons name="hourglass-outline" size={16} color={colors.yellow} />
          </View>
          <View>
            <Text variant="label" color={colors.text.secondary}>OPORTUNIDADES PASADAS</Text>
            <Text variant="caption" color={colors.text.tertiary}>
              Podrías haber tenido +{formatCurrency(totalPotential)} extra
            </Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.text.tertiary}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={sectionStyles.list}>
          {opportunities.map(opp => (
            <OpportunityCard key={opp.monthKey} opp={opp} />
          ))}
          <View style={sectionStyles.disclaimer}>
            <Ionicons name="information-circle-outline" size={13} color={colors.text.tertiary} />
            <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, lineHeight: 17 }}>
              Rendimientos estimados con tasas históricas de FCI MM (3%/mes) y CEDEARs del sector (4.5–8%/mes en ARS). No son garantía de resultados futuros. CEDEARs implican mayor riesgo.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing[4],
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1 },
  iconWrap:   { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.yellow + '15', alignItems: 'center', justifyContent: 'center' },
  list:       { borderTopWidth: 1, borderTopColor: colors.border.subtle, padding: spacing[4], gap: spacing[3] },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingTop: spacing[2] },
});
