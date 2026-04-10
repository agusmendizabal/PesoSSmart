/**
 * RecommendationComparison
 *
 * Comparador visual entre la opción principal y la alternativa de inversión.
 *
 * Subcomponentes:
 *   IndicatorBar    – barra de nivel (liquidez / cobertura / crecimiento / riesgo)
 *   OptionCard      – card de una opción con indicadores + "cuándo elegir"
 *   TradeOffLine    – frase comparativa entre ambas opciones
 *
 * ⚠️ AVISO: estas sugerencias son educativas, no asesoramiento financiero.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Text } from '@/components/ui';
import type { Instrument, RiskLevel } from '@/lib/investmentData';
import type { InstrumentSuggestion } from '@/lib/investmentRecommendation';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ComparisonNarrative {
  tradeOff:        string;   // "Esta opción prioriza X; la alternativa ofrece Y"
  primaryWhen:     string;   // "Tiene más sentido si..."
  secondaryWhen:   string;   // "Puede servir si..."
}

// ─── buildComparisonNarrative ─────────────────────────────────────────────────

/**
 * Genera la narrativa comparativa entre el instrumento principal y el secundario.
 * Detecta la diferencia más relevante y la expresa en lenguaje natural.
 *
 * Jerarquía de diferencias que mencionar:
 *   1. Riesgo (si difiere en nivel → es la diferencia más importante)
 *   2. Liquidez (si el primario tiene más acceso)
 *   3. Cobertura inflacionaria (si el secundario cubre mejor)
 *   4. Potencial de crecimiento (si hay diferencia clara)
 */
export function buildComparisonNarrative(
  primary:   InstrumentSuggestion,
  secondary: InstrumentSuggestion,
): ComparisonNarrative {
  const p = primary.instrument;
  const s = secondary.instrument;

  const diffRisk       = p.riskLevel !== s.riskLevel;
  const diffLiquidity  = p.liquidityLevel  !== s.liquidityLevel;
  const diffInflation  = Math.abs(p.inflationProtection - s.inflationProtection) >= 1;
  const diffGrowth     = Math.abs(p.growthPotential     - s.growthPotential)     >= 1;

  // Riesgo: diferencia más importante
  if (diffRisk) {
    const pRisk = riskLabel(p.riskLevel);
    const sRisk = riskLabel(s.riskLevel);
    if (p.riskLevel === 'low' && s.riskLevel === 'medium') {
      return {
        tradeOff:      `${p.shortName} es más estable y predecible. ${s.shortName} asume más variación a cambio de mayor potencial.`,
        primaryWhen:   'Tiene más sentido si querés estabilidad y no tolerar sorpresas.',
        secondaryWhen: 'Puede servir si estás dispuesto a tolerar algo de variación para buscar mejor rendimiento.',
      };
    }
    if (p.riskLevel === 'low' && s.riskLevel === 'high') {
      return {
        tradeOff:      `${p.shortName} ofrece seguridad y bajo ${pRisk}. ${s.shortName} tiene alto potencial, pero también alta volatilidad.`,
        primaryWhen:   'Tiene más sentido si el objetivo es proteger lo que tenés.',
        secondaryWhen: 'Solo conviene si tenés horizonte largo y tolerás que el valor suba y baje.',
      };
    }
    if (p.riskLevel === 'medium' && s.riskLevel === 'low') {
      return {
        tradeOff:      `${p.shortName} busca mayor rendimiento con algo de variación. ${s.shortName} es más conservador y predecible.`,
        primaryWhen:   'Tiene más sentido si podés tolerar algo de movimiento y buscás más rendimiento.',
        secondaryWhen: 'Puede servir si preferís simplicidad y estabilidad sobre todo.',
      };
    }
    return {
      tradeOff:      `${p.shortName} tiene ${pRisk}; ${s.shortName} opera con ${sRisk}.`,
      primaryWhen:   'Tiene más sentido según tu perfil de riesgo actual.',
      secondaryWhen: 'Puede servir si en el futuro cambia tu tolerancia al riesgo.',
    };
  }

  // Liquidez: segunda diferencia más relevante
  if (diffLiquidity) {
    const moreL = p.liquidityLevel > s.liquidityLevel ? p : s;
    const lessL = p.liquidityLevel > s.liquidityLevel ? s : p;
    return {
      tradeOff: `${moreL.shortName} tiene disponibilidad inmediata. ${lessL.shortName} requiere más planificación para retirar el dinero.`,
      primaryWhen:   p.liquidityLevel >= s.liquidityLevel
        ? 'Tiene más sentido si querés mantener disponible esta plata.'
        : 'Tiene más sentido si no necesitás tocar este dinero pronto.',
      secondaryWhen: s.liquidityLevel >= p.liquidityLevel
        ? 'Puede servir si querés acceso rápido y lo anterior no alcanza.'
        : 'Puede servir si planificás no necesitar el dinero en el corto plazo.',
    };
  }

  // Cobertura inflacionaria
  if (diffInflation) {
    const moreCov = p.inflationProtection > s.inflationProtection ? p : s;
    const lessCov = p.inflationProtection > s.inflationProtection ? s : p;
    return {
      tradeOff: `${moreCov.shortName} está directamente indexado a la inflación. ${lessCov.shortName} genera rendimiento, pero sin cobertura directa contra el IPC.`,
      primaryWhen:   p.inflationProtection >= s.inflationProtection
        ? 'Tiene más sentido si el objetivo principal es no perder contra la inflación.'
        : 'Tiene más sentido si priorizás liquidez sobre cobertura inflacionaria.',
      secondaryWhen: s.inflationProtection >= p.inflationProtection
        ? 'Puede servir si querés cobertura más directa contra la suba de precios.'
        : 'Puede servir si querés acceso rápido y la cobertura inflacionaria es secundaria.',
    };
  }

  // Crecimiento
  if (diffGrowth) {
    const moreG = p.growthPotential > s.growthPotential ? p : s;
    const lessG = p.growthPotential > s.growthPotential ? s : p;
    return {
      tradeOff: `${moreG.shortName} tiene mayor potencial de crecimiento. ${lessG.shortName} apunta a preservar valor, no a multiplicarlo.`,
      primaryWhen:   p.growthPotential >= s.growthPotential
        ? 'Tiene más sentido si buscás rendimiento real, no solo preservar.'
        : 'Tiene más sentido si el objetivo es cuidar lo que tenés.',
      secondaryWhen: s.growthPotential >= p.growthPotential
        ? 'Puede servir si buscás un upside mayor y tolerás más variación.'
        : 'Puede servir como complemento más estable si usás la principal para crecer.',
    };
  }

  // Fallback: sin diferencia detectada (mismo perfil)
  return {
    tradeOff:      `Ambas opciones son similares en riesgo y perfil. La diferencia está en los instrumentos específicos que usan.`,
    primaryWhen:   'Es la selección más alineada con tus intereses declarados.',
    secondaryWhen: 'Es una alternativa válida si querés diversificar entre instrumentos distintos.',
  };
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function riskLabel(level: RiskLevel): string {
  return { low: 'riesgo bajo', medium: 'riesgo medio', high: 'riesgo alto' }[level];
}

// ─── IndicatorBar ─────────────────────────────────────────────────────────────

interface IndicatorBarProps {
  icon:   string;
  label:  string;
  value:  1 | 2 | 3;
  max?:   number;
  color?: string;
}

const LEVEL_LABEL = ['', 'Bajo', 'Medio', 'Alto'] as const;

function IndicatorBar({ icon, label, value, max = 3, color = colors.primary }: IndicatorBarProps) {
  return (
    <View style={indStyles.row}>
      <Text style={indStyles.icon}>{icon}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={indStyles.labelRow}>
          <Text variant="caption" color={colors.text.tertiary} style={{ fontSize: 9 }}>{label}</Text>
          <Text variant="caption" color={color} style={{ fontSize: 9, fontFamily: 'DMSans_600SemiBold' }}>
            {LEVEL_LABEL[value]}
          </Text>
        </View>
        <View style={indStyles.track}>
          {Array.from({ length: max }).map((_, i) => (
            <View
              key={i}
              style={[
                indStyles.segment,
                { backgroundColor: i < value ? color : colors.border.subtle },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const indStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  icon: {
    fontSize:   12,
    lineHeight: 16,
    width:      16,
    textAlign:  'center',
  },
  labelRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   2,
  },
  track: {
    flexDirection: 'row',
    gap:           2,
  },
  segment: {
    flex:         1,
    height:       4,
    borderRadius: 2,
  },
});

// ─── OptionCard ───────────────────────────────────────────────────────────────

interface OptionCardProps {
  suggestion: InstrumentSuggestion;
  isPrimary:  boolean;
  whenText:   string;
}

function OptionCard({ suggestion, isPrimary, whenText }: OptionCardProps) {
  const { instrument, uiLabel, uiColor } = suggestion;
  const rColor = { low: colors.primary, medium: colors.yellow, high: colors.red }[instrument.riskLevel];
  const rBg    = { low: colors.primary + '14', medium: colors.yellow + '16', high: colors.red + '12' }[instrument.riskLevel];

  return (
    <View style={[optStyles.card, isPrimary && optStyles.primaryCard]}>
      {/* Header */}
      <View style={optStyles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={optStyles.titleRow}>
            {isPrimary && (
              <View style={optStyles.mainTag}>
                <Text variant="caption" color={colors.neon} style={{ fontSize: 8 }}>PRINCIPAL</Text>
              </View>
            )}
            <Text variant="bodySmall" color={colors.text.primary} style={{ fontFamily: 'DMSans_600SemiBold' }} numberOfLines={1}>
              {instrument.shortName}
            </Text>
          </View>
          <Text variant="caption" color={colors.text.tertiary} numberOfLines={2} style={{ lineHeight: 15 }}>
            {instrument.description}
          </Text>
        </View>
        <View style={optStyles.badges}>
          <View style={[optStyles.badge, { backgroundColor: uiColor + '20' }]}>
            <Text variant="caption" color={uiColor} style={{ fontSize: 8 }}>{uiLabel.toUpperCase()}</Text>
          </View>
          <View style={[optStyles.badge, { backgroundColor: rBg }]}>
            <Text variant="caption" color={rColor} style={{ fontSize: 8 }}>{instrument.riskLabel.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Indicadores */}
      <View style={optStyles.indicators}>
        <IndicatorBar icon="💧" label="Liquidez"   value={instrument.liquidityLevel}       color="#82b1ff" />
        <IndicatorBar icon="🛡️" label="Vs. inflac."  value={instrument.inflationProtection}  color="#a5d6a7" />
        <IndicatorBar icon="📈" label="Crecimiento" value={instrument.growthPotential}       color={colors.neon} />
      </View>

      {/* Cuándo elegirla */}
      <View style={optStyles.whenBox}>
        <Ionicons name="information-circle-outline" size={12} color={colors.text.tertiary} style={{ marginTop: 1 }} />
        <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 15 }}>
          {whenText}
        </Text>
      </View>
    </View>
  );
}

const optStyles = StyleSheet.create({
  card: {
    flex:            1,
    borderWidth:     1,
    borderColor:     colors.border.subtle,
    borderRadius:    10,
    padding:         spacing[3],
    gap:             spacing[3],
    backgroundColor: colors.bg.elevated,
  },
  primaryCard: {
    borderColor: colors.border.default,
  },
  header: {
    flexDirection: 'row',
    gap:           spacing[2],
    alignItems:    'flex-start',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[1],
    flexWrap:      'wrap',
  },
  mainTag: {
    backgroundColor:   colors.neon + '20',
    paddingHorizontal: spacing[1],
    paddingVertical:   1,
    borderRadius:      3,
  },
  badges: {
    gap:       spacing[1],
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: spacing[1],
    paddingVertical:   2,
    borderRadius:      3,
  },
  indicators: {
    gap: spacing[2],
  },
  whenBox: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               spacing[2],
    backgroundColor:   colors.bg.input,
    borderRadius:      6,
    paddingHorizontal: spacing[2],
    paddingVertical:   spacing[2],
  },
});

// ─── RecommendationComparison ─────────────────────────────────────────────────

interface RecommendationComparisonProps {
  primary:   InstrumentSuggestion;
  secondary: InstrumentSuggestion;
}

export function RecommendationComparison({ primary, secondary }: RecommendationComparisonProps) {
  const narrative = buildComparisonNarrative(primary, secondary);

  return (
    <View style={compStyles.container}>
      {/* Título de sección */}
      <Text variant="label" color={colors.text.tertiary} style={{ fontSize: 10 }}>
        DOS CAMINOS POSIBLES
      </Text>

      {/* Trade-off */}
      <View style={compStyles.tradeOffBox}>
        <Ionicons name="git-compare-outline" size={13} color={colors.text.tertiary} />
        <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 16 }}>
          {narrative.tradeOff}
        </Text>
      </View>

      {/* Cards lado a lado */}
      <View style={compStyles.cardsRow}>
        <OptionCard
          suggestion={primary}
          isPrimary
          whenText={narrative.primaryWhen}
        />
        <OptionCard
          suggestion={secondary}
          isPrimary={false}
          whenText={narrative.secondaryWhen}
        />
      </View>
    </View>
  );
}

const compStyles = StyleSheet.create({
  container: {
    gap: spacing[3],
  },
  tradeOffBox: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               spacing[2],
    backgroundColor:   colors.bg.input,
    borderRadius:      8,
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[3],
  },
  cardsRow: {
    flexDirection: 'row',
    gap:           spacing[3],
  },
});
