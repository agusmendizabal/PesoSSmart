/**
 * Tests de investmentCategories.ts — `node --test`, sin dependencias nuevas.
 * Módulo 100% puro; el gate de "¿tiene sentido invertir?" se prueba
 * combinado con `determineSavingsDestinations` real de Fase 2 (no un mock),
 * para garantizar que Fase 3 nunca diverge de lo que ya decide Fase 2.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHorizon,
  shouldConsiderInvesting,
  detectConcentration,
  evaluateInvestmentCategories,
  pickTopCategories,
  computeInvestmentConfidence,
  projectSavingsScenario,
  INVESTMENT_CATEGORIES,
  type ExistingInvestment,
} from './investmentCategories';
import { determineSavingsDestinations, type UserFinancialContext, type UserGoal } from './savingsDestination';

function ctx(overrides: Partial<UserFinancialContext> = {}): UserFinancialContext {
  return {
    monthlyPotentialSaving: 25000,
    estimatedIncome: 1000000,
    avgMonthlySpend: 500000,
    savings: { amount: 4000000, source: 'live' }, // colchón muy cómodo por defecto
    debt: { known: true, hasDebt: false, amount: null },
    goals: [],
    riskProfile: 'moderate',
    ...overrides,
  };
}

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return { id: 'g1', title: 'Viaje', targetAmount: 1200000, currentAmount: 0, deadline: null, ...overrides };
}

function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

// ─── 1. Usuario sin fondo de emergencia ─────────────────────────────────────

test('usuario sin fondo de emergencia: no corresponde invertir, y lo dice explícitamente', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: 0, source: 'live' } }));
  const readiness = shouldConsiderInvesting(result);
  assert.equal(readiness.eligible, false);
  assert.match(readiness.reason, /Todavía no es momento/);
});

// ─── 2. Usuario con deuda ────────────────────────────────────────────────────

test('usuario con deuda conocida: no corresponde invertir, el motivo menciona la deuda', () => {
  const result = determineSavingsDestinations(ctx({
    savings: { amount: 0, source: 'live' },
    debt: { known: true, hasDebt: true, amount: 200000 },
  }));
  const readiness = shouldConsiderInvesting(result);
  assert.equal(readiness.eligible, false);
  assert.match(readiness.reason, /deuda/);
});

// ─── 3. Usuario con fondo suficiente ─────────────────────────────────────────

test('usuario con fondo de emergencia suficiente (y sin meta de corto plazo compitiendo): sí corresponde invertir', () => {
  const result = determineSavingsDestinations(ctx());
  const readiness = shouldConsiderInvesting(result);
  assert.equal(readiness.eligible, true);
});

// ─── 4. Usuario conservador ──────────────────────────────────────────────────

test('usuario conservador: solo encajan categorías de riesgo bajo', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: 'conservative', horizon: 'largo', concentration: null });
  const fitting = evals.filter(e => e.fits);
  assert.ok(fitting.length > 0);
  assert.ok(fitting.every(e => e.category.risk === 'bajo'));
  assert.ok(!fitting.some(e => e.category.id === 'acciones'));
  assert.ok(!fitting.some(e => e.category.id === 'cedears'));
});

// ─── 5. Usuario moderado ─────────────────────────────────────────────────────

test('usuario moderado con horizonte largo: encajan categorías de riesgo medio, pero no "acciones" (solo agresivo)', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: 'moderate', horizon: 'largo', concentration: null });
  const fitting = evals.filter(e => e.fits);
  assert.ok(fitting.some(e => e.category.risk === 'medio'));
  assert.ok(!fitting.some(e => e.category.id === 'acciones'));
});

// ─── 6. Usuario agresivo ──────────────────────────────────────────────────────

test('usuario agresivo con horizonte largo: "acciones" puede encajar', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon: 'largo', concentration: null });
  const acciones = evals.find(e => e.category.id === 'acciones');
  assert.ok(acciones?.fits);
});

// ─── 7. Objetivo de corto plazo ───────────────────────────────────────────────

test('meta a 2 meses: horizonte "corto", y categorías de largo plazo quedan excluidas aunque el perfil sea agresivo', () => {
  const horizon = classifyHorizon(monthsFromNow(2));
  assert.equal(horizon, 'corto');
  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon, concentration: null });
  assert.ok(!evals.find(e => e.category.id === 'acciones')?.fits);
  assert.ok(evals.find(e => e.category.id === 'liquidez')?.fits);
});

// ─── 8. Objetivo de largo plazo ───────────────────────────────────────────────

test('meta a 36 meses: horizonte "largo"', () => {
  assert.equal(classifyHorizon(monthsFromNow(36)), 'largo');
});

// ─── 9. Usuario sin objetivo ──────────────────────────────────────────────────

test('sin meta (deadline null): horizonte "sin_definir", se restringe a categorías de corto plazo por seguridad', () => {
  const horizon = classifyHorizon(null);
  assert.equal(horizon, 'sin_definir');
  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon, concentration: null });
  const fitting = evals.filter(e => e.fits);
  assert.ok(fitting.every(e => e.category.suitableHorizons.includes('corto')));
  assert.ok(!fitting.some(e => e.category.id === 'acciones'));
});

// ─── 10. Usuario sin perfil de riesgo ─────────────────────────────────────────

test('sin perfil de riesgo conocido: solo encajan categorías de riesgo bajo, nunca se asume un perfil', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: null, horizon: 'largo', concentration: null });
  const fitting = evals.filter(e => e.fits);
  assert.ok(fitting.every(e => e.category.risk === 'bajo'));
});

test('sin perfil de riesgo: la confianza es "baja" y lo lista como dato faltante', () => {
  const confidence = computeInvestmentConfidence({ riskProfileKnown: false, horizon: 'largo', economicDataFresh: true });
  assert.equal(confidence.level, 'baja');
  assert.ok(confidence.missing.some(m => m.includes('perfil de riesgo')));
});

// ─── 11. Usuario sin ahorro suficiente ────────────────────────────────────────

test('usuario sin ahorro suficiente (colchón de 1 mes): no corresponde invertir', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: 500000, source: 'live' }, avgMonthlySpend: 500000 }));
  const readiness = shouldConsiderInvesting(result);
  assert.equal(readiness.eligible, false);
});

// ─── 12. Usuario con inversiones existentes (diversificadas) ─────────────────

test('inversiones existentes diversificadas (ningún tipo supera el 60%): no se detecta concentración', () => {
  const investments: ExistingInvestment[] = [
    { instrumentType: 'fci', amount: 300000 },
    { instrumentType: 'cedear', amount: 300000 },
    { instrumentType: 'plazo_fijo', amount: 400000 },
  ];
  const result = detectConcentration(investments);
  assert.ok(result);
  assert.equal(result!.concentrated, false);
});

// ─── 13. Usuario concentrado en un activo ─────────────────────────────────────

test('80% de las inversiones en CEDEARs: se detecta concentración y se excluye "cedears" de las alternativas', () => {
  const investments: ExistingInvestment[] = [
    { instrumentType: 'cedear', amount: 800000 },
    { instrumentType: 'fci', amount: 200000 },
  ];
  const concentration = detectConcentration(investments);
  assert.ok(concentration);
  assert.equal(concentration!.concentrated, true);
  assert.equal(concentration!.dominantType, 'cedear');

  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon: 'largo', concentration });
  const cedears = evals.find(e => e.category.id === 'cedears');
  assert.equal(cedears?.fits, false);
  assert.match(cedears!.whyNot!, /concentrad/);
});

// ─── 14. Datos económicos desactualizados ─────────────────────────────────────

test('datos económicos no frescos: la confianza baja a "media" aunque el resto esté completo', () => {
  const confidence = computeInvestmentConfidence({ riskProfileKnown: true, horizon: 'largo', economicDataFresh: false });
  assert.equal(confidence.level, 'media');
});

// ─── 15. Fuente externa inexistente / 17. Proyección sin rendimiento ─────────

test('sin una tasa real disponible: la proyección no inventa un rendimiento, solo el acumulado nominal', () => {
  const scenario = projectSavingsScenario(25000, 12, null, null);
  assert.equal(scenario.nominalSaved, 300000);
  assert.equal(scenario.scenarioValue, null);
  assert.equal(scenario.assumptionLabel, null);
});

// ─── 16. Proyección con rendimiento ───────────────────────────────────────────

test('con una tasa real disponible: la proyección se marca explícitamente como escenario hipotético, no como promesa', () => {
  const scenario = projectSavingsScenario(25000, 12, 2.5, 'la tasa BCRA actual');
  assert.ok(scenario.scenarioValue != null);
  assert.ok(scenario.scenarioValue! > scenario.nominalSaved, 'con rendimiento positivo el escenario debería superar el acumulado nominal');
  assert.match(scenario.assumptionLabel!, /hipotético/);
  assert.match(scenario.assumptionLabel!, /no es una promesa/);
});

// ─── 18. No recomendar inversión cuando no corresponde ────────────────────────

test('no recomendar inversión cuando no corresponde: la razón es una respuesta válida, no un error', () => {
  const result = determineSavingsDestinations(ctx({ savings: { amount: 0, source: 'live' } }));
  const readiness = shouldConsiderInvesting(result);
  assert.equal(readiness.eligible, false);
  assert.ok(readiness.reason.length > 0);
});

// ─── Invariantes explícitas pedidas ───────────────────────────────────────────

test('nunca se recomienda una categoría de largo plazo para un horizonte corto, sea cual sea el perfil', () => {
  for (const riskProfile of ['conservative', 'moderate', 'aggressive'] as const) {
    const evals = evaluateInvestmentCategories({ riskProfile, horizon: 'corto', concentration: null });
    const longOnly = evals.filter(e => e.category.suitableHorizons.length === 1 && e.category.suitableHorizons[0] === 'largo');
    assert.ok(longOnly.every(e => !e.fits));
  }
});

test('el perfil de riesgo nunca se ignora: un conservador jamás recibe "acciones" ni "cedears", con cualquier horizonte', () => {
  for (const horizon of ['corto', 'mediano', 'largo', 'sin_definir'] as const) {
    const evals = evaluateInvestmentCategories({ riskProfile: 'conservative', horizon, concentration: null });
    assert.ok(!evals.find(e => e.category.id === 'acciones')?.fits);
    assert.ok(!evals.find(e => e.category.id === 'cedears')?.fits);
  }
});

test('pickTopCategories nunca devuelve más del máximo pedido', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon: 'largo', concentration: null });
  const top = pickTopCategories(evals, 2);
  assert.ok(top.length <= 2);
});

test('perfil de riesgo conocido + horizonte conocido + datos frescos: confianza "alta"', () => {
  const confidence = computeInvestmentConfidence({ riskProfileKnown: true, horizon: 'mediano', economicDataFresh: true });
  assert.equal(confidence.level, 'alta');
  assert.deepEqual(confidence.missing, []);
});

test('el catálogo de categorías cubre exactamente las 8 conceptuales pedidas', () => {
  const ids = Object.keys(INVESTMENT_CATEGORIES).sort();
  assert.deepEqual(ids, ['acciones', 'bonos', 'cedears', 'cer_inflacion', 'fci', 'liquidez', 'renta_fija', 'dolar'].sort());
});
