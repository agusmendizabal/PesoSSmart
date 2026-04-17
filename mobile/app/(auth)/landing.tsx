/**
 * landing.tsx — Pantalla de bienvenida pre-registro.
 *
 * Flujo:
 *  1. Calculadora de inflación interactiva (slider → pérdida mensual)
 *  2. Una pregunta rápida (rango de ingresos)
 *  3. Recomendación personalizada
 *  4. CTA → register
 *
 * Se accede desde index.tsx si el usuario no tiene sesión y quiere ver el demo.
 * El botón "Iniciar sesión" está disponible en todo momento.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, layout } from '@/theme';
import { Text, Button } from '@/components/ui';

const { width: SCREEN_W } = Dimensions.get('window');
const SLIDER_W = SCREEN_W - layout.screenPadding * 2 - spacing[4] * 2;

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Inflación mensual estimada (%) */
const MONTHLY_INFLATION = 0.035;

const INCOME_OPTIONS = [
  { key: 'under_500',  label: 'Menos de $500k',  midpoint: 350_000  },
  { key: '500_1500',   label: '$500k – $1,5M',    midpoint: 1_000_000 },
  { key: '1500_3000',  label: '$1,5M – $3M',      midpoint: 2_250_000 },
  { key: 'over_3000',  label: 'Más de $3M',       midpoint: 4_500_000 },
];

const RECOMMENDATIONS: Record<string, { headline: string; body: string; icon: string }> = {
  under_500:  { headline: 'Cada peso cuenta', body: 'Con ingresos ajustados, el primer paso es conocer tus gastos al detalle. Te mostramos exactamente dónde sobra y cuánto podés ahorrar.', icon: 'bulb-outline' },
  '500_1500': { headline: 'Podés empezar a invertir', body: 'Con tu nivel de ingresos podés poner el excedente en un FCI Money Market y empezar a proteger tu plata de la inflación desde hoy.', icon: 'trending-up-outline' },
  '1500_3000':{ headline: 'Es momento de diversificar', body: 'Con ingresos medios-altos podés combinar FCI, Plazo Fijo UVA y CEDEARs. SmartPesos te dice cuánto y cuándo.', icon: 'layers-outline' },
  over_3000:  { headline: 'Optimizá tu portafolio', body: 'Con este nivel de ingresos, cada mes sin una estrategia clara te cuesta miles. SmartPesos te ayuda a estructurar y hacer crecer tu capital.', icon: 'stats-chart-outline' },
};

// ─── Slider simple (sin librería externa) ────────────────────────────────────

function SimpleSlider({
  min, max, value, onChange,
}: {
  min: number; max: number; value: number; onChange: (v: number) => void;
}) {
  const pct = (value - min) / (max - min);
  const thumbX = useRef(new Animated.Value(pct * SLIDER_W)).current;
  const currentPct = useRef(pct);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        const raw   = currentPct.current * SLIDER_W + gs.dx;
        const clamped = Math.max(0, Math.min(SLIDER_W, raw));
        thumbX.setValue(clamped);
        const newPct = clamped / SLIDER_W;
        const newVal = Math.round((min + newPct * (max - min)) / 100_000) * 100_000;
        onChange(newVal);
      },
      onPanResponderRelease: (_, gs) => {
        const raw   = currentPct.current * SLIDER_W + gs.dx;
        const clamped = Math.max(0, Math.min(SLIDER_W, raw));
        currentPct.current = clamped / SLIDER_W;
      },
    }),
  ).current;

  // Sync thumb when value changes externally
  const targetPct = (value - min) / (max - min);
  thumbX.setValue(targetPct * SLIDER_W);
  currentPct.current = targetPct;

  return (
    <View style={sliderStyles.wrap}>
      <View style={sliderStyles.track}>
        <Animated.View style={[sliderStyles.fill, { width: thumbX }]} />
      </View>
      <Animated.View
        style={[sliderStyles.thumb, { left: thumbX }]}
        {...panResponder.panHandlers}
      />
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrap:  { height: 36, justifyContent: 'center', position: 'relative' },
  track: {
    height: 6, backgroundColor: colors.border.default, borderRadius: 3,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.neon, borderRadius: 3 },
  thumb: {
    position: 'absolute',
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.bg.primary,
    borderWidth: 2, borderColor: colors.neon,
    top: 6,
    marginLeft: -12,
  },
});

// ─── Pantalla principal ───────────────────────────────────────────────────────

type Step = 'calculator' | 'income' | 'recommendation';

export default function LandingScreen() {
  const [step, setStep]               = useState<Step>('calculator');
  const [savings, setSavings]         = useState(500_000);
  const [incomeKey, setIncomeKey]     = useState<string | null>(null);

  const monthlyLoss   = Math.round(savings * MONTHLY_INFLATION);
  const yearlyLoss    = Math.round(savings * (Math.pow(1 + MONTHLY_INFLATION, 12) - 1));
  const rec           = incomeKey ? RECOMMENDATIONS[incomeKey] : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* Header minimal */}
      <View style={styles.topBar}>
        <Text variant="label" color={colors.neon} style={{ fontFamily: 'Montserrat_700Bold', letterSpacing: 1.5 }}>
          PESO$MART
        </Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
          <Text variant="caption" color={colors.text.secondary}>Iniciar sesión</Text>
        </TouchableOpacity>
      </View>

      {/* Indicador de paso */}
      <View style={styles.progressRow}>
        {(['calculator', 'income', 'recommendation'] as Step[]).map((s, i) => (
          <View
            key={s}
            style={[styles.progressDot, step === s && styles.progressDotActive,
              (['calculator', 'income', 'recommendation'] as Step[]).indexOf(step) > i && styles.progressDotDone]}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── PASO 1: Calculadora ──────────────────────────────────────────────── */}
        {step === 'calculator' && (
          <View style={styles.stepContainer}>
            <View style={styles.headlineBlock}>
              <Text variant="h3" color={colors.text.primary} style={{ lineHeight: 34 }}>
                ¿Cuánto pierde{'\n'}
                <Text variant="h3" color={colors.neon}>tu plata parada?</Text>
              </Text>
              <Text variant="body" color={colors.text.secondary} style={{ lineHeight: 22 }}>
                En Argentina la inflación erosiona el efectivo todos los meses. Mové el slider y mirá cuánto perdés.
              </Text>
            </View>

            {/* Slider */}
            <View style={styles.calcCard}>
              <View style={styles.calcRow}>
                <Text variant="caption" color={colors.text.secondary}>Tengo en efectivo</Text>
                <Text style={styles.savingsValue}>${savings.toLocaleString('es-AR')}</Text>
              </View>
              <SimpleSlider
                min={50_000}
                max={5_000_000}
                value={savings}
                onChange={setSavings}
              />
              <View style={styles.sliderLabels}>
                <Text variant="caption" color={colors.text.tertiary}>$50k</Text>
                <Text variant="caption" color={colors.text.tertiary}>$5M</Text>
              </View>

              <View style={styles.lossRow}>
                <LossBox label="Perdés por mes" amount={monthlyLoss} color={colors.red} />
                <LossBox label="Perdés por año" amount={yearlyLoss} color="#FF6D00" />
              </View>
            </View>

            {/* CTA */}
            <View style={styles.ctaBlock}>
              <Button
                label="QUIERO PROTEGER MIS PESOS"
                variant="neon"
                size="lg"
                fullWidth
                onPress={() => setStep('income')}
              />
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text variant="caption" color={colors.text.tertiary} align="center">
                  ¿Ya tenés cuenta?{' '}
                  <Text variant="caption" color={colors.primary}>Iniciá sesión</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── PASO 2: Pregunta de ingresos ────────────────────────────────────── */}
        {step === 'income' && (
          <View style={styles.stepContainer}>
            <View style={styles.headlineBlock}>
              <Text variant="h3" color={colors.text.primary} style={{ lineHeight: 34 }}>
                Una sola pregunta{'\n'}
                <Text variant="h3" color={colors.primary}>para personalizar</Text>
              </Text>
              <Text variant="body" color={colors.text.secondary} style={{ lineHeight: 22 }}>
                ¿Cuál es tu rango de ingresos mensuales? Usamos esto para darte sugerencias que tengan sentido para tu situación real.
              </Text>
            </View>

            <View style={styles.optionsCol}>
              {INCOME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.incomeOpt, incomeKey === opt.key && styles.incomeOptActive]}
                  onPress={() => setIncomeKey(opt.key)}
                  activeOpacity={0.85}
                >
                  <Text
                    variant="bodySmall"
                    color={incomeKey === opt.key ? colors.primary : colors.text.primary}
                    style={{ fontFamily: incomeKey === opt.key ? 'Montserrat_600SemiBold' : 'Montserrat_400Regular' }}
                  >
                    {opt.label}
                  </Text>
                  {incomeKey === opt.key && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.ctaBlock}>
              <Button
                label="VER MI RECOMENDACIÓN"
                variant="neon"
                size="lg"
                fullWidth
                onPress={() => incomeKey && setStep('recommendation')}
              />
              <TouchableOpacity onPress={() => setStep('calculator')}>
                <Text variant="caption" color={colors.text.tertiary} align="center">
                  Volver
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── PASO 3: Recomendación ────────────────────────────────────────────── */}
        {step === 'recommendation' && rec && (
          <View style={styles.stepContainer}>
            <View style={styles.headlineBlock}>
              <Text variant="h3" color={colors.text.primary} style={{ lineHeight: 34 }}>
                Tu plan{'\n'}
                <Text variant="h3" color={colors.neon}>personalizado</Text>
              </Text>
            </View>

            {/* Resumen de pérdida */}
            <View style={styles.lossReminder}>
              <Ionicons name="warning-outline" size={16} color={colors.red} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 17 }}>
                Con ${savings.toLocaleString('es-AR')} en efectivo, perdés aproximadamente{' '}
                <Text variant="caption" color={colors.red} style={{ fontFamily: 'Montserrat_700Bold' }}>
                  ${monthlyLoss.toLocaleString('es-AR')} por mes
                </Text>{' '}
                por inflación.
              </Text>
            </View>

            {/* Recomendación */}
            <View style={styles.recCard}>
              <View style={styles.recIconWrap}>
                <Ionicons name={rec.icon as any} size={22} color={colors.neon} />
              </View>
              <Text variant="subtitle" color={colors.neon} style={{ fontFamily: 'Montserrat_700Bold' }}>
                {rec.headline}
              </Text>
              <Text variant="body" color={colors.text.secondary} style={{ lineHeight: 22 }}>
                {rec.body}
              </Text>
            </View>

            {/* Features */}
            <View style={styles.featuresList}>
              {[
                { icon: 'shield-checkmark-outline', text: 'Registrá y clasificá gastos en segundos' },
                { icon: 'trending-up-outline',       text: 'Compará instrumentos de inversión' },
                { icon: 'notifications-outline',     text: 'Alertas cuando te pasás del presupuesto' },
                { icon: 'star-outline',              text: '30 días premium gratis, sin tarjeta' },
              ].map(({ icon, text }) => (
                <View key={text} style={styles.featureRow}>
                  <Ionicons name={icon as any} size={16} color={colors.neon} />
                  <Text variant="bodySmall" color={colors.text.secondary}>{text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.ctaBlock}>
              <Button
                label="EMPEZAR GRATIS — 30 DÍAS PREMIUM"
                variant="neon"
                size="lg"
                fullWidth
                onPress={() => router.push('/(auth)/register')}
              />
              <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
                <Text variant="caption" color={colors.text.tertiary} align="center">
                  ¿Ya tenés cuenta?{' '}
                  <Text variant="caption" color={colors.primary}>Iniciá sesión</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── LossBox ─────────────────────────────────────────────────────────────────

function LossBox({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <View style={[lbStyles.box, { borderColor: color + '30', backgroundColor: color + '08' }]}>
      <Text variant="caption" color={colors.text.tertiary}>{label}</Text>
      <Text style={[lbStyles.amount, { color }]}>-${amount.toLocaleString('es-AR')}</Text>
    </View>
  );
}

const lbStyles = StyleSheet.create({
  box:    { flex: 1, borderWidth: 1, borderRadius: 10, padding: spacing[3], gap: spacing[1], alignItems: 'center' },
  amount: { fontFamily: 'Montserrat_700Bold', fontSize: 18 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: layout.screenPadding, paddingVertical: spacing[3],
  },
  progressDot: {
    flex: 1, height: 3, borderRadius: 2,
    backgroundColor: colors.border.default,
  },
  progressDotActive: { backgroundColor: colors.neon },
  progressDotDone:   { backgroundColor: colors.primary },
  scroll: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
  },
  stepContainer: { gap: spacing[6] },
  headlineBlock: { gap: spacing[3] },
  calcCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[5], gap: spacing[4],
  },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  savingsValue: { fontFamily: 'Montserrat_700Bold', fontSize: 20, color: colors.text.primary },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  lossRow: { flexDirection: 'row', gap: spacing[3] },
  ctaBlock: { gap: spacing[3] },
  optionsCol: { gap: spacing[2] },
  incomeOpt: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 12, padding: spacing[4],
  },
  incomeOptActive: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  lossReminder: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2],
    backgroundColor: colors.red + '0C', borderRadius: 10, padding: spacing[3],
  },
  recCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.neon + '40',
    borderRadius: 16, padding: spacing[5], gap: spacing[3],
  },
  recIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.neon + '15', alignItems: 'center', justifyContent: 'center',
  },
  featuresList: { gap: spacing[3] },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
});
