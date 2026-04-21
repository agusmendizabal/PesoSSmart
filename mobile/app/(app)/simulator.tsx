import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, layout } from '@/theme';
import { Text, Card } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/format';

// ─── Tasas base (fallback si la DB no responde) ───────────────────────────────

const DEFAULT_INFLATION = 0.030;

interface InstrumentDef {
  id:            string;
  name:          string;
  shortName:     string;
  emoji:         string;
  color:         string;
  tem:           number;   // Tasa Efectiva Mensual
  riskLevel:     'bajo' | 'medio' | 'alto';
  minMonths:     number;
  note:          string;
}

const BASE_INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'fci_mm',    name: 'FCI Money Market', shortName: 'FCI MM',
    emoji: '💵',    color: colors.neon,
    tem: 0.030,     riskLevel: 'bajo', minMonths: 1,
    note: 'Alta liquidez, rescate en 24-48hs. Ideal para fondo de emergencia.',
  },
  {
    id: 'lecap',     name: 'Lecaps',           shortName: 'Lecaps',
    emoji: '📋',    color: colors.primary,
    tem: 0.038,     riskLevel: 'bajo', minMonths: 1,
    note: 'Letras del Tesoro a tasa fija en pesos. Sin riesgo cambiario.',
  },
  {
    id: 'pf_uva',    name: 'Plazo Fijo UVA',   shortName: 'PF UVA',
    emoji: '📈',    color: colors.accent,
    tem: DEFAULT_INFLATION + 0.005,
    riskLevel: 'bajo', minMonths: 3,
    note: 'Ajusta por inflación (CER) + tasa real. Mínimo 90 días.',
  },
  {
    id: 'dolar_mep',  name: 'Dólar MEP',        shortName: 'MEP',
    emoji: '💰',    color: colors.yellow,
    tem: 0.025,     riskLevel: 'medio', minMonths: 1,
    note: 'Compra dólares legalmente desde homebanking. Protege de devaluación.',
  },
  {
    id: 'cedear',    name: 'Cedears',           shortName: 'Cedears',
    emoji: '🌎',    color: '#A78BFA',
    tem: 0.040,     riskLevel: 'alto', minMonths: 6,
    note: 'Acciones globales en pesos. Alta volatilidad, horizonte +12 meses.',
  },
];

const PERIODS = [
  { label: '3M',    months: 3  },
  { label: '6M',    months: 6  },
  { label: '1 año', months: 12 },
  { label: '2 años',months: 24 },
];

const RISK_COLOR: Record<string, string> = {
  bajo:  colors.neon,
  medio: colors.yellow,
  alto:  colors.red,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compound(principal: number, tem: number, months: number): number {
  return principal * Math.pow(1 + tem, months);
}

function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SimulatorScreen() {
  const [amountText,     setAmountText]     = useState('');
  const [selectedInstr,  setSelectedInstr]  = useState('fci_mm');
  const [selectedPeriod, setSelectedPeriod] = useState(12);
  const [showResult,     setShowResult]     = useState(false);
  const [instruments,    setInstruments]    = useState<InstrumentDef[]>(BASE_INSTRUMENTS);
  const [inflation,      setInflation]      = useState(DEFAULT_INFLATION);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);

  // Cargar tasas reales desde market_rates
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('market_rates')
        .select('instrument, rate_monthly, updated_at');
      if (!data?.length) return;

      const rateMap: Record<string, number> = {};
      let latestUpdate = '';
      for (const row of data) {
        rateMap[row.instrument] = row.rate_monthly / 100; // % → decimal
        if (!latestUpdate || row.updated_at > latestUpdate) latestUpdate = row.updated_at;
      }

      setRatesUpdatedAt(latestUpdate ? new Date(latestUpdate).toLocaleDateString('es-AR') : null);
      if (rateMap['inflation']) setInflation(rateMap['inflation']);

      setInstruments(BASE_INSTRUMENTS.map(i => ({
        ...i,
        tem: rateMap[i.id] ?? i.tem,
        // PF UVA siempre = inflación + 0.5% real
        ...(i.id === 'pf_uva' && rateMap['inflation']
          ? { tem: rateMap['inflation'] + 0.005 }
          : {}),
      })));
    })();
  }, []);

  const amount = useMemo(() => {
    const n = parseFloat(amountText.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) || n <= 0 ? 0 : n;
  }, [amountText]);

  const instr = instruments.find(i => i.id === selectedInstr) ?? instruments[0];

  const result = useMemo(() => {
    if (amount <= 0) return null;
    const finalValue    = compound(amount, instr.tem, selectedPeriod);
    const inflationEnd  = compound(amount, inflation, selectedPeriod);
    const nominalReturn = finalValue - amount;
    const nominalPct    = (finalValue / amount - 1) * 100;
    const realPct       = ((finalValue / inflationEnd) - 1) * 100;
    return { finalValue, inflationEnd, nominalReturn, nominalPct, realPct };
  }, [amount, instr, selectedPeriod, inflation]);

  const comparison = useMemo(() => {
    if (amount <= 0) return [];
    return instruments
      .filter(i => i.minMonths <= selectedPeriod)
      .map(i => {
        const final  = compound(amount, i.tem, selectedPeriod);
        const nomPct = (final / amount - 1) * 100;
        return { ...i, final, nomPct };
      })
      .sort((a, b) => b.final - a.final);
  }, [amount, instruments, selectedPeriod]);

  const maxFinal    = comparison[0]?.final ?? 1;
  const inflFinal   = compound(amount > 0 ? amount : 1, inflation, selectedPeriod);
  const inflPct     = (Math.pow(1 + inflation, selectedPeriod) - 1) * 100;
  const instrBlocked = instr.minMonths > selectedPeriod;

  const handleAmountChange = (text: string) => {
    setAmountText(text.replace(/[^0-9.,]/g, ''));
    setShowResult(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <View>
          <Text variant="subtitle">Simulador</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Monto ─────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text variant="label" color={colors.text.secondary}>¿CUÁNTO QUERÉS INVERTIR?</Text>
            <View style={styles.amountRow}>
              <Text style={styles.currencySign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={amountText}
                onChangeText={handleAmountChange}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.text.tertiary}
                selectionColor={colors.neon}
              />
              {amount > 0 && (
                <Text variant="caption" color={colors.text.tertiary}>
                  {formatCurrency(amount)}
                </Text>
              )}
            </View>
          </View>

          {/* ── Instrumento ───────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="label" color={colors.text.secondary}>INSTRUMENTO</Text>
              {ratesUpdatedAt && (
                <Text variant="caption" color={colors.text.tertiary}>
                  Tasas al {ratesUpdatedAt}
                </Text>
              )}
            </View>
            <View style={styles.instrGrid}>
              {instruments.map(i => (
                <TouchableOpacity
                  key={i.id}
                  style={[
                    styles.instrCard,
                    selectedInstr === i.id && { borderColor: i.color, borderWidth: 2 },
                  ]}
                  onPress={() => { setSelectedInstr(i.id); setShowResult(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 22 }}>{i.emoji}</Text>
                  <Text
                    variant="caption"
                    color={selectedInstr === i.id ? colors.text.primary : colors.text.secondary}
                    style={{ fontFamily: 'Montserrat_700Bold', textAlign: 'center', fontSize: 10 }}
                    numberOfLines={1}
                  >
                    {i.shortName}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: 'Montserrat_600SemiBold', color: RISK_COLOR[i.riskLevel] }}>
                    riesgo {i.riskLevel}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Montserrat_700Bold', color: i.color }}>
                    ~{Math.round(i.tem * 100)}% TEM
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.noteRow}>
              <Ionicons name="information-circle-outline" size={14} color={colors.text.tertiary} />
              <Text variant="caption" color={colors.text.tertiary} style={{ flex: 1, lineHeight: 18 }}>
                {instr.note}
              </Text>
            </View>
          </View>

          {/* ── Plazo ─────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text variant="label" color={colors.text.secondary}>PLAZO</Text>
            <View style={styles.periodRow}>
              {PERIODS.map(p => (
                <TouchableOpacity
                  key={p.months}
                  style={[styles.periodChip, selectedPeriod === p.months && styles.periodChipActive]}
                  onPress={() => { setSelectedPeriod(p.months); setShowResult(false); }}
                >
                  <Text
                    variant="label"
                    color={selectedPeriod === p.months ? colors.white : colors.text.secondary}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {instrBlocked && (
              <View style={styles.warningRow}>
                <Ionicons name="warning-outline" size={14} color={colors.yellow} />
                <Text variant="caption" color={colors.yellow}>
                  {instr.name} requiere mínimo {instr.minMonths} meses.
                </Text>
              </View>
            )}
          </View>

          {/* ── CTA ───────────────────────────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.calcBtn, (amount <= 0 || instrBlocked) && styles.calcBtnDisabled]}
            onPress={() => setShowResult(true)}
            disabled={amount <= 0 || instrBlocked}
            activeOpacity={0.85}
          >
            <Text style={styles.calcBtnText}>CALCULAR</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.white} />
          </TouchableOpacity>

          {/* ── Resultado ─────────────────────────────────────────────────── */}
          {showResult && result && (
            <>
              <Card style={styles.resultCard}>
                <Text variant="label" color={colors.text.secondary}>
                  {instr.name.toUpperCase()} · {selectedPeriod} {selectedPeriod === 1 ? 'MES' : 'MESES'}
                </Text>

                {/* Monto final */}
                <View style={styles.resultMain}>
                  <View>
                    <Text variant="caption" color={colors.text.tertiary}>Valor final estimado</Text>
                    <Text variant="numberLg" color={colors.neon}>
                      {formatCurrency(Math.round(result.finalValue))}
                    </Text>
                  </View>
                  <View style={[styles.returnBadge, { backgroundColor: colors.neon + '18', borderColor: colors.neon + '50' }]}>
                    <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 16, color: colors.neon }}>
                      {formatPct(result.nominalPct)}
                    </Text>
                  </View>
                </View>

                {/* Desglose */}
                <View style={styles.resultDetails}>
                  <View style={styles.detailRow}>
                    <Text variant="caption" color={colors.text.secondary}>Capital inicial</Text>
                    <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      {formatCurrency(amount)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text variant="caption" color={colors.text.secondary}>Ganancia nominal</Text>
                    <Text variant="caption" color={colors.neon} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
                      +{formatCurrency(Math.round(result.nominalReturn))}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text variant="caption" color={colors.text.secondary}>
                      Inflación estimada ({inflation.toFixed(1)}%/mes)
                    </Text>
                    <Text variant="caption" color={colors.text.tertiary}>
                      {formatCurrency(Math.round(result.inflationEnd))}
                    </Text>
                  </View>
                  <View style={[styles.detailRow, styles.detailRowFinal]}>
                    <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'Montserrat_700Bold' }}>
                      Retorno real vs inflación
                    </Text>
                    <Text
                      style={{
                        fontFamily: 'Montserrat_700Bold', fontSize: 13,
                        color: result.realPct >= 0 ? colors.neon : colors.red,
                      }}
                    >
                      {formatPct(result.realPct)}
                    </Text>
                  </View>
                </View>
              </Card>

              {/* ── Comparación entre instrumentos ─────────────────────────── */}
              {comparison.length > 0 && (
                <Card style={styles.compCard}>
                  <Text variant="label" color={colors.text.secondary}>
                    COMPARACIÓN EN {selectedPeriod} {selectedPeriod === 1 ? 'MES' : 'MESES'}
                  </Text>
                  <View style={styles.compList}>
                    {comparison.map(c => (
                      <View key={c.id} style={styles.compRow}>
                        <View style={styles.compLeft}>
                          <Text style={{ fontSize: 14 }}>{c.emoji}</Text>
                          <Text
                            variant="caption"
                            color={c.id === selectedInstr ? colors.text.primary : colors.text.secondary}
                            style={c.id === selectedInstr ? { fontFamily: 'Montserrat_700Bold' } : {}}
                            numberOfLines={1}
                          >
                            {c.shortName}
                          </Text>
                        </View>
                        <View style={styles.compRight}>
                          <View style={styles.compTrack}>
                            <View style={[
                              styles.compFill,
                              {
                                width: `${(c.final / maxFinal) * 100}%`,
                                backgroundColor: c.id === selectedInstr ? c.color : c.color + '55',
                              },
                            ]} />
                          </View>
                          <Text
                            style={{
                              fontFamily: 'Montserrat_700Bold', fontSize: 11,
                              color: c.id === selectedInstr ? c.color : colors.text.secondary,
                              minWidth: 44, textAlign: 'right',
                            }}
                          >
                            {formatPct(c.nomPct)}
                          </Text>
                        </View>
                      </View>
                    ))}

                    {/* Línea de inflación como baseline */}
                    <View style={[styles.compRow, styles.compRowInfl]}>
                      <View style={styles.compLeft}>
                        <Text style={{ fontSize: 14 }}>📉</Text>
                        <Text variant="caption" color={colors.text.tertiary} numberOfLines={1}>
                          Inflación
                        </Text>
                      </View>
                      <View style={styles.compRight}>
                        <View style={styles.compTrack}>
                          <View style={[styles.compFill, {
                            width: `${(inflFinal / maxFinal) * 100}%`,
                            backgroundColor: colors.red + '44',
                          }]} />
                        </View>
                        <Text style={{ fontFamily: 'Montserrat_700Bold', fontSize: 11, color: colors.red, minWidth: 44, textAlign: 'right' }}>
                          {formatPct(inflPct)}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Card>
              )}

              {/* Disclaimer */}
              <Text variant="caption" color={colors.text.tertiary} align="center" style={styles.disclaimer}>
                Proyecciones estimadas para Argentina 2026 basadas en tasas históricas. No constituyen asesoramiento financiero. Los rendimientos reales pueden variar significativamente.
              </Text>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  backBtn: { padding: spacing[1] },
  scroll:  {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[5], paddingBottom: spacing[12],
    gap: spacing[6],
  },
  section: { gap: spacing[3] },

  // Monto
  amountRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderBottomWidth: 2, borderBottomColor: colors.neon, paddingBottom: spacing[2] },
  currencySign: { fontFamily: 'Montserrat_700Bold', fontSize: 28, color: colors.text.tertiary },
  amountInput:  { flex: 1, fontFamily: 'Montserrat_700Bold', fontSize: 36, color: colors.text.primary, padding: 0 },

  // Instrumento
  instrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  instrCard: {
    width: '18%', flexGrow: 1,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 10, padding: spacing[3], alignItems: 'center', gap: 4,
  },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },

  // Plazo
  periodRow: { flexDirection: 'row', gap: spacing[2] },
  periodChip: {
    flex: 1, paddingVertical: spacing[3], alignItems: 'center',
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 8, backgroundColor: colors.bg.card,
  },
  periodChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },

  // CTA
  calcBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    backgroundColor: colors.neon, borderRadius: 12, paddingVertical: spacing[4],
  },
  calcBtnDisabled: { backgroundColor: colors.mediumGray },
  calcBtnText: { fontFamily: 'Montserrat_700Bold', fontSize: 15, color: colors.white },

  // Resultado
  resultCard: { padding: spacing[5], gap: spacing[4] },
  resultMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  returnBadge: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: 8, borderWidth: 1 },
  resultDetails: { gap: spacing[3] },
  detailRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailRowFinal: { paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border.subtle },

  // Comparación
  compCard: { padding: spacing[5], gap: spacing[4] },
  compList: { gap: spacing[3] },
  compRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  compRowInfl: { paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border.subtle },
  compLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], width: 82 },
  compRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  compTrack: { flex: 1, height: 8, backgroundColor: colors.border.subtle, borderRadius: 4, overflow: 'hidden' },
  compFill:  { height: '100%', borderRadius: 4 },

  disclaimer: { lineHeight: 18, paddingHorizontal: spacing[2] },
});
