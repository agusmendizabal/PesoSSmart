/**
 * Tests de savingsDestination.ts — corridos con el test runner nativo de Node
 * (sin dependencias nuevas: `node --test`). Módulo 100% puro, no requiere
 * Expo/React Native ni Supabase. Ver `npm test` en package.json.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineSavingsDestinations,
  computeGoalCoverage,
  computeRequiredMonthlySaving,
  projectAnnualSaving,
  describeSavingsOrigin,
  pickFeaturedGoal,
  monthsUntil,
  type UserFinancialContext,
  type UserGoal,
} from './savingsDestination';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return { id: 'g1', title: 'Viaje', targetAmount: 1200000, currentAmount: 0, deadline: null, ...overrides };
}

/** Contexto "todo conocido" por defecto: colchón de exactamente 3 meses, sin deuda, sin metas. */
function ctx(overrides: Partial<UserFinancialContext> = {}): UserFinancialContext {
  return {
    monthlyPotentialSaving: 25000,
    estimatedIncome: 1000000,
    avgMonthlySpend: 500000,
    savings: { amount: 1500000, source: 'live' },
    debt: { known: true, hasDebt: false, amount: null },
    goals: [],
    riskProfile: 'moderate',
    ...overrides,
  };
}

function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// ─── 1. Usuario sin ahorro ──────────────────────────────────────────────────

test('usuario sin ahorro (monto conocido = 0): aparece fondo de emergencia, nunca inversión', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: 0, source: 'live' } }));
  assert.equal(result.hasSufficientData, true);
  assert.ok(result.destinations.some(d => d.type === 'fondo_emergencia'));
  assert.ok(!result.destinations.some(d => d.type === 'inversion'), 'no debe recomendarse invertir automáticamente sin colchón');
});

// ─── 2. Usuario con ahorro suficiente ───────────────────────────────────────

test('usuario con ahorro suficiente (colchón >= 3 meses): no aparece fondo_emergencia', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: 1500000, source: 'live' }, avgMonthlySpend: 500000 }));
  assert.ok(!result.destinations.some(d => d.type === 'fondo_emergencia'));
});

// ─── 3. Usuario con objetivo ────────────────────────────────────────────────

test('usuario con un objetivo activo: aparece la opción "objetivo"', () => {
  const result = determineSavingsDestinations(ctx({ goals: [goal()] }));
  assert.ok(result.destinations.some(d => d.type === 'objetivo'));
});

// ─── 4. Usuario sin objetivo ────────────────────────────────────────────────

test('usuario sin objetivos: no aparece la opción "objetivo"', () => {
  const result = determineSavingsDestinations(ctx({ goals: [] }));
  assert.ok(!result.destinations.some(d => d.type === 'objetivo'));
});

// ─── 5. Usuario con ahorro potencial ────────────────────────────────────────

test('con ahorro potencial detectado, siempre hay al menos un destino disponible (liquidez como piso)', () => {
  const result = determineSavingsDestinations(ctx());
  assert.ok(result.destinations.length > 0);
  assert.ok(result.destinations.some(d => d.type === 'liquidez'));
});

// ─── 6. Usuario sin oportunidad de ahorro ───────────────────────────────────

test('sin ahorro potencial (monto = 0): computeGoalCoverage no proyecta nada', () => {
  assert.equal(computeGoalCoverage(goal({ targetAmount: 500000 }), 0), null);
});

test('sin ahorro potencial: describeSavingsOrigin no encuentra origen entre candidatos en 0', () => {
  const origin = describeSavingsOrigin([
    { categoryName: 'Restaurantes', amount: 0, level: 'normal', base: 100000 },
    { categoryName: 'Super', amount: null, level: 'normal', base: 80000 },
  ]);
  assert.equal(origin, null);
});

// ─── 7. Ahorro pequeño ───────────────────────────────────────────────────────

test('ahorro mensual pequeño frente a una meta grande: cobertura baja, sin errores', () => {
  const coverage = computeGoalCoverage(goal({ targetAmount: 2000000, currentAmount: 0, deadline: null }), 5000);
  assert.ok(coverage);
  assert.ok(coverage!.coveragePct < 5);
});

// ─── 8. Ahorro significativo ─────────────────────────────────────────────────

test('ahorro mensual grande frente a una meta chica: la cobertura se topea en 100%, no supera', () => {
  const coverage = computeGoalCoverage(goal({ targetAmount: 100000, currentAmount: 0, deadline: null }), 50000);
  assert.ok(coverage);
  assert.equal(coverage!.coveragePct, 100);
  assert.ok(coverage!.projectedAmount > coverage!.remainingNeeded);
});

// ─── 9. Objetivo de corto plazo ──────────────────────────────────────────────

test('objetivo de corto plazo (2 meses): el rationale lo marca como urgente y bloquea la sugerencia de invertir', () => {
  const result = determineSavingsDestinations(ctx({
    savings: { amount: 4000000, source: 'live' }, avgMonthlySpend: 500000, // colchón muy cómodo (8 meses)
    goals: [goal({ deadline: monthsFromNow(2) })],
  }));
  const objetivo = result.destinations.find(d => d.type === 'objetivo');
  assert.ok(objetivo);
  assert.match(objetivo!.rationale, /cercana/);
  assert.ok(!result.destinations.some(d => d.type === 'inversion'), 'una meta de corto plazo no debe convivir con una sugerencia de invertir');
});

// ─── 10. Objetivo de largo plazo ─────────────────────────────────────────────

test('objetivo de largo plazo (24 meses) con colchón cómodo: sí puede convivir con la sugerencia de invertir', () => {
  const result = determineSavingsDestinations(ctx({
    savings: { amount: 4000000, source: 'live' }, avgMonthlySpend: 500000,
    goals: [goal({ deadline: monthsFromNow(24) })],
  }));
  assert.ok(result.destinations.some(d => d.type === 'objetivo'));
  assert.ok(result.destinations.some(d => d.type === 'inversion'));
});

// ─── 11. Información insuficiente ────────────────────────────────────────────

test('sin ingreso estimado conocido: no hay destinos, se listan los datos faltantes', () => {
  const result = determineSavingsDestinations(ctx({ estimatedIncome: null }));
  assert.equal(result.hasSufficientData, false);
  assert.equal(result.destinations.length, 0);
  assert.ok(result.missingInfo.includes('tus ingresos'));
});

test('sin ahorro disponible conocido (source "unknown"): no hay destinos', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: null, source: 'unknown' } }));
  assert.equal(result.hasSufficientData, false);
  assert.ok(result.missingInfo.includes('tu ahorro disponible'));
});

// ─── 12. Múltiples oportunidades de ahorro ───────────────────────────────────

test('con varias categorías candidatas, el origen elegido es el de mayor monto, no el primero de la lista', () => {
  const origin = describeSavingsOrigin([
    { categoryName: 'Restaurantes', amount: 12000, level: 'atencion', base: 80000 },
    { categoryName: 'Delivery',     amount: 25000, level: 'alerta',   base: 60000 },
    { categoryName: 'Super',        amount: 5000,  level: 'oportunidad', base: 150000 },
  ]);
  assert.ok(origin);
  assert.equal(origin!.categoryName, 'Delivery');
  assert.equal(origin!.amount, 25000);
});

// ─── Invariantes explícitas pedidas ──────────────────────────────────────────

test('fondo_emergencia e inversión nunca aparecen juntas (mutuamente excluyentes por diseño de los umbrales)', () => {
  const scenarios = [
    ctx({ savings: { amount: 0, source: 'live' } }),
    ctx({ savings: { amount: 4000000, source: 'live' }, avgMonthlySpend: 500000 }),
    ctx({ savings: { amount: 1000000, source: 'onboarding_snapshot' }, avgMonthlySpend: 500000 }),
  ];
  for (const c of scenarios) {
    const result = determineSavingsDestinations(c);
    const hasBoth = result.destinations.some(d => d.type === 'fondo_emergencia')
                 && result.destinations.some(d => d.type === 'inversion');
    assert.ok(!hasBoth, 'no deberían coexistir fondo_emergencia e inversión en la misma recomendación');
  }
});

test('con deuda conocida y sin colchón: la deuda tiene prioridad 1, antes que el fondo de emergencia', () => {
  const result = determineSavingsDestinations(ctx({
    savings: { amount: 0, source: 'live' },
    debt: { known: true, hasDebt: true, amount: 300000 },
  }));
  const deuda = result.destinations.find(d => d.type === 'deuda');
  const fondo = result.destinations.find(d => d.type === 'fondo_emergencia');
  assert.ok(deuda && fondo);
  assert.ok(deuda!.priority < fondo!.priority);
});

test('el monto de ahorro nunca se recalcula: la cobertura de meta usa exactamente el monthlySaving recibido', () => {
  const coverage = computeGoalCoverage(goal({ targetAmount: 1000000, currentAmount: 0 }), 37421);
  assert.ok(coverage);
  assert.equal(coverage!.monthlySaving, 37421);
});

test('projectAnnualSaving es una simple multiplicación por 12, sin inventar rendimientos', () => {
  assert.equal(projectAnnualSaving(25000), 300000);
});

test('meta sin fecha límite se proyecta a 12 meses por defecto (no se inventa una fecha)', () => {
  const coverage = computeGoalCoverage(goal({ targetAmount: 300000, currentAmount: 0, deadline: null }), 25000);
  assert.ok(coverage);
  assert.equal(coverage!.monthsProjected, 12);
  assert.equal(coverage!.projectedAmount, 300000);
  assert.equal(coverage!.coveragePct, 100);
});

test('riskProfile desconocido no rompe la priorización ni bloquea otros destinos', () => {
  const result = determineSavingsDestinations(ctx({
    riskProfile: null, savings: { amount: 4000000, source: 'live' }, avgMonthlySpend: 500000,
  }));
  assert.ok(result.hasSufficientData);
  assert.ok(result.destinations.length > 0);
});

test('pickFeaturedGoal prioriza la meta con fecha más próxima entre las activas', () => {
  const g1 = goal({ id: 'g1', deadline: monthsFromNow(20) });
  const g2 = goal({ id: 'g2', deadline: monthsFromNow(2) });
  const featured = pickFeaturedGoal([g1, g2]);
  assert.equal(featured?.id, 'g2');
});

test('metas ya cumplidas no cuentan como "objetivo activo"', () => {
  const result = determineSavingsDestinations(ctx({
    goals: [goal({ currentAmount: 1200000, targetAmount: 1200000 })],
  }));
  assert.ok(!result.destinations.some(d => d.type === 'objetivo'));
});

// ─── Fase 6: computeRequiredMonthlySaving (monto mensual necesario) ────────

test('con fecha límite, calcula el ahorro mensual necesario como lo que falta dividido los meses restantes', () => {
  const required = computeRequiredMonthlySaving(
    goal({ targetAmount: 1200000, currentAmount: 400000, deadline: monthsFromNow(8) }),
  );
  assert.ok(required != null);
  assert.equal(required, Math.round(800000 / 8));
});

test('sin fecha límite: no se inventa un horizonte, devuelve null (a diferencia de computeGoalCoverage, que sí usa 12 meses por defecto)', () => {
  const required = computeRequiredMonthlySaving(goal({ targetAmount: 1200000, currentAmount: 400000, deadline: null }));
  assert.equal(required, null);
});

test('meta ya cumplida: no hace falta ahorrar nada, devuelve null en vez de un número negativo o cero engañoso', () => {
  const required = computeRequiredMonthlySaving(goal({ targetAmount: 500000, currentAmount: 500000, deadline: monthsFromNow(6) }));
  assert.equal(required, null);
});

test('computeRequiredMonthlySaving usa exactamente la misma cuenta de meses que computeGoalCoverage (monthsUntil compartido)', () => {
  const g = goal({ targetAmount: 1000000, currentAmount: 0, deadline: monthsFromNow(10) });
  const required = computeRequiredMonthlySaving(g)!;
  const coverage = computeGoalCoverage(g, required)!;
  // Ahorrando exactamente el monto "necesario" calculado, la cobertura proyectada debe rozar el 100%.
  assert.ok(coverage.coveragePct >= 99);
  assert.equal(monthsUntil(g.deadline!), coverage.monthsProjected);
});
