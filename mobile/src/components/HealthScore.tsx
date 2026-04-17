/**
 * HealthScore — Score de salud financiera del 1 al 100.
 *
 * Algoritmo:
 *  - Porcentaje prescindibles  (max 30 pts): 0% = 30, 50%+ = 0
 *  - Tiene inversiones         (15 pts)
 *  - Ahorro mensual > 0        (10 pts)
 *  - Diversificación           (max 10 pts): 2+ tipos = 10, 1 = 5
 *  - Racha buena semana        (max 15 pts): 4sem = 15, 2sem = 8, 1sem = 4
 *  - Días sin prescindibles    (max 10 pts): 7d = 10, 3d = 5
 *  - Metas activas             (max 10 pts): tiene meta = 10
 *
 * Máximo teórico: 100 pts
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';

// ─── Hook: count-up suave ─────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    const steps    = 40;
    const stepTime = Math.max(16, duration / steps);
    let   current  = 0;
    const id = setInterval(() => {
      current += 1;
      setDisplay(Math.round((current / steps) * target));
      if (current >= steps) clearInterval(id);
    }, stepTime);
    return () => clearInterval(id);
  }, [target]);
  return display;
}
import { Text } from '@/components/ui/Text';
import type { SavingsGoal } from '@/store/goalsStore';

// ─── Cálculo ──────────────────────────────────────────────────────────────────

export interface ScoreInput {
  totalThisMonth:  number;
  totalDisposable: number;
  totalInvested:   number;
  investmentTypes: number;   // cuántos tipos distintos de inversión
  hasSavings:      boolean;  // tiene ahorros > 0
  weekStreak:      number;
  noDisposableStreak: number;
  goals:           SavingsGoal[];
  prevScore?:      number;   // score del mes anterior para delta
}

export function computeHealthScore(input: ScoreInput): number {
  let score = 0;

  // 1. Prescindibles (max 30)
  if (input.totalThisMonth > 0) {
    const pct = input.totalDisposable / input.totalThisMonth;
    score += Math.round(30 * Math.max(0, 1 - pct / 0.5));
  } else {
    score += 15; // sin datos → neutro
  }

  // 2. Inversiones (15)
  if (input.totalInvested > 0) score += 15;

  // 3. Ahorro en efectivo (10)
  if (input.hasSavings) score += 10;

  // 4. Diversificación (max 10)
  if (input.investmentTypes >= 2) score += 10;
  else if (input.investmentTypes === 1) score += 5;

  // 5. Racha semanas (max 15)
  if (input.weekStreak >= 4)     score += 15;
  else if (input.weekStreak >= 2) score += 8;
  else if (input.weekStreak >= 1) score += 4;

  // 6. Días sin prescindibles (max 10)
  if (input.noDisposableStreak >= 7)     score += 10;
  else if (input.noDisposableStreak >= 3) score += 5;

  // 7. Metas activas (10)
  if (input.goals.some(g => g.current_amount < g.target_amount)) score += 10;

  return Math.min(100, score);
}

function scoreLabel(s: number): { text: string; color: string } {
  if (s >= 85) return { text: 'Excelente',  color: colors.neon };
  if (s >= 70) return { text: 'Muy bueno',  color: colors.primary };
  if (s >= 50) return { text: 'En camino',  color: colors.yellow };
  if (s >= 30) return { text: 'A mejorar',  color: '#FF6D00' };
  return              { text: 'Crítico',    color: colors.red };
}

// ─── Gauge circular simple ────────────────────────────────────────────────────

const RADIUS     = 44;
const STROKE     = 8;
const CIRCUMF    = 2 * Math.PI * RADIUS;

function ScoreGauge({ score, color }: { score: number; color: string }) {
  // Count-up para el número (JS puro, sin worklets)
  const displayScore = useCountUp(score, 1000);
  const progress     = (displayScore / 100) * CIRCUMF;

  // Scale + fade-in con RN Animated (no requiere worklets)
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.75)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1,  duration: 500, useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1,  damping: 14, stiffness: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[gaugeStyles.wrap, { opacity, transform: [{ scale }] }]}>
      <Svg width={112} height={112} viewBox="0 0 112 112">
        {/* Track */}
        <Circle
          cx="56" cy="56" r={RADIUS}
          stroke={colors.border.default}
          strokeWidth={STROKE}
          fill="none"
        />
        {/* Progress */}
        <Circle
          cx="56" cy="56" r={RADIUS}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${progress} ${CIRCUMF}`}
          strokeLinecap="round"
          rotation="-90"
          origin="56,56"
        />
      </Svg>
      <View style={gaugeStyles.center}>
        <Text style={[gaugeStyles.number, { color }]}>{displayScore}</Text>
        <Text style={gaugeStyles.max}>/100</Text>
      </View>
    </Animated.View>
  );
}

const gaugeStyles = StyleSheet.create({
  wrap:   { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center' },
  number: { fontFamily: 'Montserrat_700Bold', fontSize: 26, lineHeight: 30 },
  max:    { fontFamily: 'Montserrat_400Regular', fontSize: 11, color: colors.text.tertiary },
});

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  score:      number;
  prevScore?: number;
  input:      ScoreInput;
}

export function HealthScoreCard({ score, prevScore, input }: Props) {
  const label  = scoreLabel(score);
  const delta  = prevScore !== undefined ? score - prevScore : null;

  // Factores para tips
  const tips: string[] = [];
  if (input.totalThisMonth > 0 && input.totalDisposable / input.totalThisMonth > 0.25) {
    tips.push('Reducir prescindibles sube tu score hasta +10 pts.');
  }
  if (input.totalInvested === 0) {
    tips.push('Empezar a invertir (FCI MM) suma 15 pts inmediato.');
  }
  if (input.weekStreak === 0) {
    tips.push('Cerrar una semana bajo presupuesto suma 4 pts.');
  }

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.left}>
          <Text variant="label" color={colors.text.tertiary}>SALUD FINANCIERA</Text>
          <Text variant="h4" color={label.color}>{label.text}</Text>
          {delta !== null && (
            <View style={styles.deltaRow}>
              <Ionicons
                name={delta >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
                size={13}
                color={delta >= 0 ? colors.neon : colors.red}
              />
              <Text
                style={[styles.deltaText, { color: delta >= 0 ? colors.neon : colors.red }]}
              >
                {delta >= 0 ? '+' : ''}{delta} pts este mes
              </Text>
            </View>
          )}
        </View>
        <ScoreGauge score={score} color={label.color} />
      </View>

      {/* Barra de factores */}
      <View style={styles.factors}>
        <FactorBar label="Prescindibles"   max={30} value={Math.round(30 * Math.max(0, 1 - (input.totalThisMonth > 0 ? (input.totalDisposable / input.totalThisMonth) / 0.5 : 0)))} color={colors.neon} />
        <FactorBar label="Inversiones"     max={25} value={(input.totalInvested > 0 ? 15 : 0) + (input.investmentTypes >= 2 ? 10 : input.investmentTypes === 1 ? 5 : 0)} color={colors.primary} />
        <FactorBar label="Racha"           max={15} value={input.weekStreak >= 4 ? 15 : input.weekStreak >= 2 ? 8 : input.weekStreak >= 1 ? 4 : 0} color={colors.yellow} />
        <FactorBar label="Ahorro y metas"  max={20} value={(input.hasSavings ? 10 : 0) + (input.goals.some(g => g.current_amount < g.target_amount) ? 10 : 0)} color="#A78BFA" />
      </View>

      {/* Tips */}
      {tips.length > 0 && (
        <View style={styles.tipsBox}>
          <Text variant="caption" color={colors.text.tertiary} style={{ fontFamily: 'Montserrat_600SemiBold' }}>
            PARA SUBIR TU SCORE
          </Text>
          {tips.slice(0, 2).map((t, i) => (
            <View key={i} style={styles.tipRow}>
              <Ionicons name="arrow-up-circle-outline" size={13} color={colors.primary} />
              <Text variant="caption" color={colors.text.secondary} style={{ flex: 1, lineHeight: 17 }}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FactorBar({ label, max, value, color }: { label: string; max: number; value: number; color: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={fbStyles.row}>
      <Text variant="caption" color={colors.text.secondary} style={fbStyles.label}>{label}</Text>
      <View style={fbStyles.track}>
        <View style={[fbStyles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[fbStyles.pts, { color }]}>{value}</Text>
    </View>
  );
}

const fbStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  label: { width: 100, fontSize: 11 },
  track: { flex: 1, height: 6, backgroundColor: colors.border.subtle, borderRadius: 3, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3 },
  pts:   { fontFamily: 'Montserrat_600SemiBold', fontSize: 11, minWidth: 20, textAlign: 'right' },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    borderRadius: 16, padding: spacing[5], gap: spacing[4],
  },
  top:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  left:      { flex: 1, gap: spacing[1] },
  deltaRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  deltaText: { fontFamily: 'Montserrat_600SemiBold', fontSize: 12 },
  factors:   { gap: spacing[2] },
  tipsBox:   { gap: spacing[2], backgroundColor: colors.bg.elevated, borderRadius: 10, padding: spacing[3] },
  tipRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
});
