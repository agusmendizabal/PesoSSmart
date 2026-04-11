/**
 * SavingsSimulator
 *
 * Simulador interactivo de montos de inversión dentro de SavingsCard.
 *
 * Permite al usuario probar distintos montos y ver en tiempo real cómo
 * cambian los escenarios para la recomendación principal y la alternativa.
 *
 * ⚠️ El monto simulado NO modifica los ahorros reales del usuario.
 * Es solo una herramienta de exploración educativa.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import { formatCurrency } from '@/utils/format';
import { getCumulativeReturn, type Instrument } from '@/lib/investmentData';
import type { WhatIfResult } from '@/utils/opportunityCost';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SimulatorResult {
  primary:   WhatIfResult;
  secondary: WhatIfResult | null;
}

interface SavingsSimulatorProps {
  /** Monto real de ahorro del usuario (valor inicial y referencia) */
  realAmount:        number;
  primary:           Instrument;
  secondary:         Instrument | null;
  interestKeys:      string[];
  fromMonthKey:      string;
  toMonthKey:        string;
  /** Callback cuando el resultado simulado cambia */
  onResultChange:    (result: SimulatorResult, simulatedAmount: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Step de incremento según magnitud del monto */
function getStep(amount: number): number {
  if (amount < 50_000)  return 5_000;
  if (amount < 200_000) return 10_000;
  if (amount < 1_000_000) return 25_000;
  return 50_000;
}

/** Rango del simulador relativo al ahorro real */
function getRange(realAmount: number): { min: number; max: number } {
  return {
    min: Math.max(10_000, Math.round(realAmount * 0.1 / 1000) * 1000),
    max: Math.min(5_000_000, realAmount * 5),
  };
}

/** Presets como fracción del monto real */
const PRESETS = [
  { label: '25%',   factor: 0.25 },
  { label: '50%',   factor: 0.50 },
  { label: 'MIS AHORROS', factor: 1.00 },
  { label: '×2',    factor: 2.00 },
  { label: '×3',    factor: 3.00 },
];

function computeWhatIf(
  inst:         Instrument,
  amount:       number,
  from:         string,
  to:           string,
  interestKeys: string[],
): WhatIfResult | null {
  const cum = getCumulativeReturn(inst, from, to);
  if (!cum) return null;

  const { returnPct, monthsCovered } = cum;
  const gain   = Math.round(amount * returnPct / 100);
  const isLoss = returnPct < 0;

  return {
    instrument:      inst,
    initialAmount:   amount,
    finalAmount:     amount + gain,
    returnPct,
    gainArs:         gain,
    isLoss,
    monthsCovered,
    periodLabel:     monthsCovered === 1 ? 'en 1 mes' : `en ${monthsCovered} meses`,
    matchesInterest: inst.matchInterestKeys.some(k => interestKeys.includes(k)),
    interpretation:  isLoss
      ? `Período negativo para ${inst.shortName}.`
      : `${inst.shortName} generó un retorno en este período.`,
  };
}

// ─── Mini resultado por instrumento ──────────────────────────────────────────

function MiniResult({
  result,
  uiLabel,
  uiColor,
  isPrimary,
}: {
  result:    WhatIfResult;
  uiLabel:   string;
  uiColor:   string;
  isPrimary: boolean;
}) {
  const gainColor = result.isLoss ? colors.red : colors.primary;

  return (
    <View style={miniStyles.row}>
      {/* Nombre + badge */}
      <View style={miniStyles.left}>
        {isPrimary && (
          <View style={miniStyles.primTag}>
            <Text style={{ fontSize: 7, color: colors.neon, fontFamily: 'DMSans_600SemiBold' }}>
              PRINCIPAL
            </Text>
          </View>
        )}
        <Text variant="caption" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }} numberOfLines={1}>
          {result.instrument.shortName}
        </Text>
        <View style={[miniStyles.badge, { backgroundColor: uiColor + '20' }]}>
          <Text style={{ fontSize: 8, color: uiColor }}>{uiLabel}</Text>
        </View>
      </View>

      {/* Resultado numérico */}
      <View style={miniStyles.right}>
        <Text variant="caption" color={colors.text.tertiary} style={{ textAlign: 'right' }}>Tendrías</Text>
        <Text variant="labelMd" color={gainColor} style={{ textAlign: 'right' }}>
          {formatCurrency(result.finalAmount)}
        </Text>
        <Text variant="caption" color={gainColor} style={{ textAlign: 'right', fontSize: 10 }}>
          {result.isLoss ? '−' : '+'}{formatCurrency(Math.abs(result.gainArs))}
          {' '}({result.isLoss ? '' : '+'}{result.returnPct.toFixed(1)}%)
        </Text>
      </View>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               spacing[3],
    paddingVertical:   spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor:   colors.bg.elevated,
    borderRadius:      8,
  },
  left: {
    flex: 1,
    gap:  3,
  },
  primTag: {
    alignSelf:         'flex-start',
    backgroundColor:   colors.neon + '20',
    paddingHorizontal: spacing[1],
    paddingVertical:   1,
    borderRadius:      3,
  },
  badge: {
    alignSelf:         'flex-start',
    paddingHorizontal: spacing[1],
    paddingVertical:   2,
    borderRadius:      3,
  },
  right: {
    alignItems: 'flex-end',
    gap:         2,
  },
});

// ─── SavingsSimulator ─────────────────────────────────────────────────────────

export function SavingsSimulator({
  realAmount,
  primary,
  secondary,
  interestKeys,
  fromMonthKey,
  toMonthKey,
  onResultChange,
}: SavingsSimulatorProps) {
  const { min, max } = getRange(realAmount);
  const [simAmount,  setSimAmount]  = useState(realAmount);
  const [inputText,  setInputText]  = useState('');
  const [isEditing,  setIsEditing]  = useState(false);

  const isModified = simAmount !== realAmount;
  const step       = getStep(realAmount);

  // Guardamos onResultChange en un ref para que el useEffect no necesite
  // incluirlo como dependencia y evitar re-ejecuciones por referencias inestables.
  const onResultChangeRef = useRef(onResultChange);
  useEffect(() => { onResultChangeRef.current = onResultChange; });

  // Cálculo puro: no ejecuta efectos secundarios
  const results = useMemo<SimulatorResult>(() => {
    const primaryResult = computeWhatIf(primary, simAmount, fromMonthKey, toMonthKey, interestKeys);
    const secResult     = secondary
      ? computeWhatIf(secondary, simAmount, fromMonthKey, toMonthKey, interestKeys)
      : null;

    return {
      primary:   primaryResult ?? {
        instrument: primary, initialAmount: simAmount, finalAmount: simAmount,
        returnPct: 0, gainArs: 0, isLoss: false, monthsCovered: 0,
        periodLabel: '-', matchesInterest: false, interpretation: '',
      },
      secondary: secResult,
    };
  }, [simAmount, primary, secondary, fromMonthKey, toMonthKey, interestKeys]);

  // Efecto separado para notificar al padre (no dentro del useMemo)
  useEffect(() => {
    onResultChangeRef.current(results, simAmount);
  }, [results, simAmount]);

  const clamp = useCallback((v: number) =>
    Math.round(Math.max(min, Math.min(max, v)) / 1000) * 1000,
  [min, max]);

  const applyAmount = useCallback((v: number) => setSimAmount(clamp(v)), [clamp]);

  // Input handlers
  const handleInputFocus = () => {
    setInputText(String(simAmount));
    setIsEditing(true);
  };
  const handleInputChange = (text: string) => {
    setInputText(text.replace(/\D/g, ''));
  };
  const handleInputBlur = () => {
    const parsed = parseInt(inputText, 10);
    if (!isNaN(parsed) && parsed > 0) applyAmount(parsed);
    setIsEditing(false);
    setInputText('');
  };

  // Etiquetas UI por instrumento (reutiliza los colores del sistema)
  const primaryLabel   = primary.id === 'fci_mm'     ? 'Más estable'
                       : primary.id === 'fci_cer'     ? 'Cubre inflación'
                       : primary.id === 'cedear_spy'  ? 'Exposición en USD'
                       : 'Alta volatilidad';
  const primaryColor   = primary.id === 'fci_mm'     ? '#82b1ff'
                       : primary.id === 'fci_cer'     ? '#a5d6a7'
                       : primary.id === 'cedear_spy'  ? '#ffb300'
                       : '#f0b429';
  const secondaryLabel = secondary
    ? secondary.id === 'fci_mm'    ? 'Más estable'
    : secondary.id === 'fci_cer'   ? 'Cubre inflación'
    : secondary.id === 'cedear_spy'? 'Exposición en USD'
    : 'Alta volatilidad'
    : '';
  const secondaryColor = secondary
    ? secondary.id === 'fci_mm'    ? '#82b1ff'
    : secondary.id === 'fci_cer'   ? '#a5d6a7'
    : secondary.id === 'cedear_spy'? '#ffb300'
    : '#f0b429'
    : '';

  // Mini lectura automática de la diferencia entre opciones
  const autoInsight = useMemo(() => {
    if (!results.secondary) return null;
    const diffGain = Math.abs(results.primary.gainArs - results.secondary.gainArs);
    const bigger   = results.primary.gainArs >= results.secondary.gainArs
      ? results.primary.instrument.shortName
      : results.secondary.instrument.shortName;
    if (diffGain < 500) return 'Con este monto, la diferencia entre opciones es mínima.';
    if (simAmount < realAmount * 0.5) {
      return `Con montos más chicos, la diferencia entre opciones se achica.`;
    }
    if (simAmount > realAmount * 1.5) {
      return `A mayor monto, se vuelve más visible la diferencia. ${bigger} generaría más en este período.`;
    }
    return `${bigger} rendiría algo más con este monto en el período analizado.`;
  }, [results, simAmount, realAmount]);

  return (
    <View style={simStyles.container}>
      {/* Header */}
      <View style={simStyles.header}>
        <Text variant="label" color={colors.text.tertiary} style={{ fontSize: 10 }}>
          SIMULÁ UN MONTO
        </Text>
        {isModified && (
          <TouchableOpacity onPress={() => applyAmount(realAmount)} style={simStyles.resetBtn}>
            <Ionicons name="refresh-outline" size={11} color={colors.text.tertiary} />
            <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 10 }}>
              Volver a mis ahorros
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Referencia al ahorro real */}
      <Text variant="caption" color={colors.text.tertiary}>
        Tus ahorros reales:{' '}
        <Text variant="caption" color={colors.text.secondary} style={{ fontFamily: 'DMSans_600SemiBold' }}>
          {formatCurrency(realAmount)}
        </Text>
        {isModified && (
          <Text variant="caption" color={colors.yellow}>  ·  Simulando otro monto</Text>
        )}
      </Text>

      {/* Input de monto */}
      <View style={simStyles.amountRow}>
        <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 13 }}>$</Text>
        <TextInput
          style={simStyles.amountInput}
          value={isEditing ? inputText : formatCurrency(simAmount).replace('$', '').trim()}
          onFocus={handleInputFocus}
          onChangeText={handleInputChange}
          onBlur={handleInputBlur}
          onSubmitEditing={() => { handleInputBlur(); Keyboard.dismiss(); }}
          keyboardType="numeric"
          selectTextOnFocus
          returnKeyType="done"
        />
        {/* +/- rápido */}
        <TouchableOpacity
          style={simStyles.stepBtn}
          onPress={() => applyAmount(simAmount - step)}
          disabled={simAmount <= min}
        >
          <Ionicons name="remove" size={16} color={simAmount <= min ? colors.border.default : colors.text.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={simStyles.stepBtn}
          onPress={() => applyAmount(simAmount + step)}
          disabled={simAmount >= max}
        >
          <Ionicons name="add" size={16} color={simAmount >= max ? colors.border.default : colors.text.secondary} />
        </TouchableOpacity>
      </View>

      {/* Presets */}
      <View style={simStyles.presets}>
        {PRESETS.map(p => {
          const presetAmount = clamp(Math.round(realAmount * p.factor / 1000) * 1000);
          const isActive     = simAmount === presetAmount;
          return (
            <TouchableOpacity
              key={p.label}
              style={[simStyles.preset, isActive && simStyles.presetActive]}
              onPress={() => applyAmount(presetAmount)}
              activeOpacity={0.7}
            >
              <Text
                variant="caption"
                color={isActive ? colors.neon : colors.text.secondary}
                style={{ fontSize: 9, fontFamily: isActive ? 'DMSans_600SemiBold' : 'DMSans_400Regular' }}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Resultados en tiempo real */}
      <View style={simStyles.results}>
        <MiniResult
          result={results.primary}
          uiLabel={primaryLabel}
          uiColor={primaryColor}
          isPrimary
        />
        {results.secondary && (
          <MiniResult
            result={results.secondary}
            uiLabel={secondaryLabel}
            uiColor={secondaryColor}
            isPrimary={false}
          />
        )}
      </View>

      {/* Insight automático */}
      {autoInsight && (
        <Text variant="caption" color={colors.text.tertiary} style={{ lineHeight: 15 }}>
          {autoInsight}
        </Text>
      )}

      {/* Aviso */}
      <Text variant="caption" color={colors.text.tertiary} style={simStyles.disclaimer}>
        Esto no cambia tus ahorros guardados — solo simula escenarios.
      </Text>
    </View>
  );
}

const simStyles = StyleSheet.create({
  container: {
    borderWidth:  1,
    borderColor:  colors.border.subtle,
    borderRadius: 10,
    padding:      spacing[4],
    gap:          spacing[3],
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
  },
  amountRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
    paddingBottom:  spacing[2],
  },
  amountInput: {
    flex:        1,
    fontSize:    22,
    fontFamily:  'DMSans_700Bold',
    color:       colors.text.primary,
    paddingVertical: 0,
  },
  stepBtn: {
    width:           32,
    height:          32,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: colors.bg.elevated,
    borderRadius:    6,
  },
  presets: {
    flexDirection: 'row',
    gap:           spacing[2],
    flexWrap:      'wrap',
  },
  preset: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1],
    borderWidth:       1,
    borderColor:       colors.border.subtle,
    borderRadius:      20,
  },
  presetActive: {
    borderColor:     colors.neon,
    backgroundColor: colors.neon + '12',
  },
  results: {
    gap: spacing[2],
  },
  disclaimer: {
    fontStyle: 'italic',
  },
});
