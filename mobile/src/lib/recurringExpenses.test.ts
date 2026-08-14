/**
 * Tests de recurringExpenses.ts — corridos con el test runner nativo de Node
 * (sin dependencias nuevas: `node --test`). No requiere Expo/React Native ni
 * Supabase porque el módulo bajo test es 100% puro.
 *
 * Correr con:
 *   npx tsc src/lib/recurringExpenses.ts src/lib/recurringExpenses.test.ts \
 *     --outDir .test-out --module commonjs --target es2020 --esModuleInterop
 *   node --test .test-out/recurringExpenses.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRecurringPatterns,
  evaluateRecurringExpenses,
  type RawExpenseRecord,
} from './recurringExpenses';

const REF = '2026-08'; // mes actual de referencia en todos los tests

function exp(description: string, amount: number, date: string, categoryId: string | null = 'cat_1'): RawExpenseRecord {
  return { description, amount, date, categoryId };
}

// ─── 1. Tres pagos mensuales iguales → recurrente ─────────────────────────────

test('3 pagos mensuales idénticos se detectan como recurrentes con confianza alta', () => {
  const history = [
    exp('Alquiler depto', 400000, '2026-05-02'),
    exp('Alquiler depto', 400000, '2026-06-02'),
    exp('Alquiler depto', 400000, '2026-07-02'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrences, 3);
  assert.equal(patterns[0].confidence, 'alta');
  assert.equal(patterns[0].medianAmount, 400000);
});

// ─── 2. Tres pagos mensuales similares (variación chica) → recurrente ─────────

test('3 pagos con variación chica de monto se detectan como recurrentes', () => {
  const history = [
    exp('Gimnasio SmartFit', 50000, '2026-05-04'),
    exp('Gimnasio SmartFit', 50000, '2026-06-04'),
    exp('Gimnasio SmartFit', 52000, '2026-07-05'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrences, 3);
  // spread = (52000-50000)/50000 = 4% → confianza alta (umbral 15%)
  assert.equal(patterns[0].confidence, 'alta');
});

// ─── 3. Solo 2 pagos → evidencia insuficiente, no recurrente ──────────────────

test('2 ocurrencias no alcanzan para clasificar como recurrente', () => {
  const history = [
    exp('Seguro auto', 51000, '2026-06-05'),
    exp('Seguro auto', 51000, '2026-07-05'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0);
});

// ─── 4. Misma categoría, comercios distintos → NO agrupar como un solo patrón ─

test('misma categoría con descripciones distintas no se confunde con un solo patrón recurrente', () => {
  const history = [
    exp('Restaurante A', 20000, '2026-05-14', 'cat_comida'),
    exp('Restaurante B', 25000, '2026-06-11', 'cat_comida'),
    exp('Restaurante C', 22000, '2026-07-20', 'cat_comida'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0, 'cada descripción distinta debe quedar con <3 ocurrencias propias');
});

// ─── 5. Mismo comercio, fechas muy dispersas → no recurrente ──────────────────

test('mismo comercio con fechas muy dispersas dentro del mes no se considera recurrente', () => {
  const history = [
    exp('Super XYZ', 30000, '2026-05-02'),
    exp('Super XYZ', 31000, '2026-06-15'),
    exp('Super XYZ', 29500, '2026-07-27'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0, 'rango de días (2 a 27) supera la tolerancia de 4 días');
});

// ─── 6. Recurrente con aumento pequeño → status "esperado" ────────────────────

test('un aumento chico este mes se evalúa como esperado, no como desviación', () => {
  const history = [
    exp('Servicio internet', 30000, '2026-05-10'),
    exp('Servicio internet', 32000, '2026-06-10'),
    exp('Servicio internet', 31500, '2026-07-10'),
  ];
  const current = [exp('Servicio internet', 33000, '2026-08-10')];
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].status, 'esperado');
});

// ─── 7. Recurrente con aumento grande → recurrente + "desviado" ───────────────

test('un aumento grande este mes se marca como recurrente pero desviado, no se ignora', () => {
  const history = [
    exp('Seguro hogar', 50000, '2026-05-06'),
    exp('Seguro hogar', 52000, '2026-06-06'),
    exp('Seguro hogar', 51000, '2026-07-06'),
  ];
  const current = [exp('Seguro hogar', 150000, '2026-08-06')]; // ~3x la mediana
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].status, 'desviado');
  assert.ok(evals[0].deviationRatio! >= 1.3);
});

// ─── 8. Pago único → no recurrente ─────────────────────────────────────────────

test('un pago grande único no se clasifica como recurrente', () => {
  const history = [exp('Reparación auto', 500000, '2026-07-03')];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0);
});

// ─── 9. Gasto recurrente que desaparece un mes → "pendiente" ──────────────────

test('un patrón recurrente sin transacción este mes se marca como pendiente, no como alerta', () => {
  const history = [
    exp('Netflix', 9000, '2026-05-10'),
    exp('Netflix', 9000, '2026-06-10'),
    exp('Netflix', 9000, '2026-07-10'),
  ];
  const current: RawExpenseRecord[] = []; // no se pagó (o todavía no) este mes
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].status, 'pendiente');
  assert.equal(evals[0].currentAmount, null);
});

// ─── 10. Meses de distinta duración — pago a fin de mes ───────────────────────

test('un pago recurrente a fin de mes se detecta igual en meses de distinta duración', () => {
  const history = [
    exp('Cuota colegio', 60000, '2026-04-30'), // abril: 30 días
    exp('Cuota colegio', 60000, '2026-05-31'), // mayo: 31 días
    exp('Cuota colegio', 61000, '2026-06-28'), // junio: 30 días, pagado unos días antes
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  // día 28 a 31 → rango de 3 días, dentro de la tolerancia de 4
  assert.equal(patterns[0].dayRange[1] - patterns[0].dayRange[0], 3);
});

// ─── 11. Pagos al principio del mes ────────────────────────────────────────────

test('pagos al principio del mes (día 1 a 3) se detectan como recurrentes', () => {
  const history = [
    exp('Alquiler', 400000, '2026-05-01'),
    exp('Alquiler', 400000, '2026-06-02'),
    exp('Alquiler', 405000, '2026-07-03'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].medianDay <= 3);
});

// ─── 12. Pagos a mitad / fin de mes ────────────────────────────────────────────

test('pagos a mitad de mes se detectan como recurrentes', () => {
  const history = [
    exp('Prepaga médica', 80000, '2026-05-15'),
    exp('Prepaga médica', 80000, '2026-06-16'),
    exp('Prepaga médica', 81000, '2026-07-15'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].medianDay >= 14 && patterns[0].medianDay <= 16);
});

// ─── Casos extra de la sección 11 del pedido (falsos positivos) ───────────────

test('varias compras en el mismo comercio dentro de UN solo mes no cuentan como recurrente', () => {
  const history = [
    exp('Super XYZ', 10000, '2026-07-02'),
    exp('Super XYZ', 12000, '2026-07-09'),
    exp('Super XYZ', 11000, '2026-07-16'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0, 'las 3 compras caen en el mismo mes calendario — solo 1 mes de presencia, no 3');
});

test('gasto trimestral no se confunde con recurrente mensual', () => {
  const history = [
    exp('Patente auto', 45000, '2026-02-10'), // fuera de la ventana de 5 meses igual, pero lo dejamos para el escenario
    exp('Patente auto', 45000, '2026-05-10'),
    exp('Patente auto', 45000, '2026-08-10'), // este es el mes de referencia — no debería contar como "histórico"
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0, 'solo aparece en 1 mes histórico dentro de la ventana (mayo) — el de agosto es el mes actual');
});

test('gasto anual no se confunde con recurrente mensual', () => {
  const history = [exp('Seguro de vida anual', 200000, '2025-09-01')];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0);
});

test('categoría null se maneja sin romper (no se agrupa con otras categorías null distintas)', () => {
  const history = [
    exp('Transferencia', 10000, '2026-05-01', null),
    exp('Transferencia', 10000, '2026-06-01', null),
    exp('Transferencia', 10000, '2026-07-01', null),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].categoryId, null);
});

test('sin historial no rompe nada — devuelve lista vacía', () => {
  assert.deepEqual(detectRecurringPatterns([], REF), []);
  assert.deepEqual(evaluateRecurringExpenses([], [], REF), []);
});

test('la ventana de lookback ignora meses más viejos que LOOKBACK_MONTHS', () => {
  const history = [
    exp('Muy viejo', 10000, '2025-10-01'), // 10 meses antes de REF — fuera de la ventana de 5
    exp('Muy viejo', 10000, '2025-11-01'),
    exp('Muy viejo', 10000, '2025-12-01'),
  ];
  const patterns = detectRecurringPatterns(history, REF, 5);
  assert.equal(patterns.length, 0, 'las 3 ocurrencias caen fuera de los últimos 5 meses antes de REF');
});

// ─── Ronda de endurecimiento (sección 8 del pedido) ────────────────────────────
// Cada test acá corresponde a uno de los 12 casos pedidos. Los que documentan una
// limitación aceptada (no un bug) lo dicen explícitamente en el nombre del test.

// 1. Falso positivo aceptado: 3 gastos puntuales con la misma descripción
test('LIMITACIÓN CONOCIDA (aceptada): 3 reparaciones puntuales con la misma descripción y montos/fechas parecidos se detectan como recurrentes', () => {
  const history = [
    exp('Auto', 100000, '2026-05-03', 'cat_auto'),
    exp('Auto', 105000, '2026-06-04', 'cat_auto'),
    exp('Auto', 98000,  '2026-07-03', 'cat_auto'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].confidence, 'alta');
  // Este test fija el comportamiento actual a propósito: con las señales disponibles
  // (categoría + descripción + monto + fecha) no hay forma de distinguir esto de una
  // recurrencia real sin fuzzy matching ni datos adicionales (comercio, etc.) — ver
  // informe, sección LIMITACIONES.
});

// 2. Caso limpio de referencia: gasto realmente recurrente
test('gasto realmente recurrente (mismo monto, mismo día todos los meses) se detecta con confianza alta', () => {
  const history = [
    exp('Spotify', 4500, '2026-05-08'),
    exp('Spotify', 4500, '2026-06-08'),
    exp('Spotify', 4500, '2026-07-08'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].confidence, 'alta');
  assert.equal(patterns[0].medianAmount, 4500);
});

// 3. Incremento gradual y natural — no debe convertirse en anomalía
test('un incremento gradual y natural a lo largo de 4 meses se sigue detectando como recurrente, y la continuación de la tendencia no se marca como desvío', () => {
  const history = [
    exp('Prepaga médica', 100000, '2026-04-10'),
    exp('Prepaga médica', 102000, '2026-05-10'),
    exp('Prepaga médica', 105000, '2026-06-10'),
    exp('Prepaga médica', 108000, '2026-07-10'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].confidence, 'alta'); // spread ~7.7%, dentro del umbral de 15%
  const current = [exp('Prepaga médica', 111000, '2026-08-10')]; // +3% más, sigue la tendencia
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals[0].status, 'esperado');
});

// 4. Incremento brusco — sí debe marcarse como desviado
test('un incremento brusco sobre un patrón estable se marca como desviado', () => {
  const history = [
    exp('Gimnasio SmartFit', 50000, '2026-05-04'),
    exp('Gimnasio SmartFit', 50000, '2026-06-04'),
    exp('Gimnasio SmartFit', 50000, '2026-07-04'),
  ];
  const current = [exp('Gimnasio SmartFit', 90000, '2026-08-04')]; // 1.8x
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals[0].status, 'desviado');
});

// 5. Desviación exactamente en el límite de 1.3x (inclusive)
test('una desviación de exactamente 1.3x se clasifica como desviada (límite inclusive)', () => {
  const history = [
    exp('Seguro auto', 100000, '2026-05-05'),
    exp('Seguro auto', 100000, '2026-06-05'),
    exp('Seguro auto', 100000, '2026-07-05'),
  ];
  const current = [exp('Seguro auto', 130000, '2026-08-05')]; // exactamente 1.3x
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals[0].status, 'desviado');
  assert.ok(Math.abs(evals[0].deviationRatio! - 1.3) < 1e-9);
});

// 6. Variación pequeña, justo debajo del límite de desviación
test('una variación de 1.29x (justo debajo del límite de 1.3x) se mantiene como esperada', () => {
  const history = [
    exp('Seguro auto', 100000, '2026-05-05'),
    exp('Seguro auto', 100000, '2026-06-05'),
    exp('Seguro auto', 100000, '2026-07-05'),
  ];
  const current = [exp('Seguro auto', 129000, '2026-08-05')]; // 1.29x
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals[0].status, 'esperado');
});

// 7. Categoría casi enteramente dominada por el recurrente (capa de detección)
test('un patrón recurrente que representa casi toda la categoría se detecta sin errores ni NaN', () => {
  const history = [
    exp('Alquiler', 400000, '2026-05-02', 'cat_vivienda'),
    exp('Alquiler', 400000, '2026-06-02', 'cat_vivienda'),
    exp('Alquiler', 410000, '2026-07-02', 'cat_vivienda'),
  ];
  const current = [exp('Alquiler', 405000, '2026-08-02', 'cat_vivienda')];
  const evals = evaluateRecurringExpenses(history, current, REF);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].status, 'esperado');
  assert.ok(Number.isFinite(evals[0].deviationRatio), 'no debe dar NaN/Infinity');
  // El comportamiento de la capa de integración (applyRecurringContext, en
  // recurringAdjustment.ts) para este mismo caso — incluyendo el remanente
  // casi-cero de la categoría — se verificó por script manual, no acá, porque
  // ese módulo importa budgetPlan.ts → @/lib/supabase y no corre fuera de
  // Expo/Metro. Ver informe, sección SEGURIDAD.
});

// 8. Límites exactos de detección (monto y fecha)
test('spread de monto exactamente 25% (límite superior) todavía se detecta, con confianza media', () => {
  const history = [
    exp('Cuota gimnasio', 87500, '2026-05-05', 'cat_x'),
    exp('Cuota gimnasio', 100000, '2026-06-05', 'cat_x'),
    exp('Cuota gimnasio', 112500, '2026-07-05', 'cat_x'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].confidence, 'media');
});

test('spread de monto de 25.1% (apenas fuera del límite) ya no se detecta', () => {
  const history = [
    exp('Cuota gimnasio', 87450, '2026-05-05', 'cat_x'),
    exp('Cuota gimnasio', 100000, '2026-06-05', 'cat_x'),
    exp('Cuota gimnasio', 112550, '2026-07-05', 'cat_x'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0);
});

test('rango de fecha exactamente 4 días (límite superior) todavía se detecta, con confianza media', () => {
  const history = [
    exp('Servicio cable', 40000, '2026-05-03', 'cat_y'),
    exp('Servicio cable', 40000, '2026-06-04', 'cat_y'),
    exp('Servicio cable', 40000, '2026-07-07', 'cat_y'), // rango día 3 a 7 = 4
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].confidence, 'media');
});

test('rango de fecha de 5 días (apenas fuera del límite) ya no se detecta', () => {
  const history = [
    exp('Servicio cable', 40000, '2026-05-03', 'cat_y'),
    exp('Servicio cable', 40000, '2026-06-04', 'cat_y'),
    exp('Servicio cable', 40000, '2026-07-08', 'cat_y'), // rango día 3 a 8 = 5
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0);
});

// 9. Un mes salteado dentro de la ventana (no el mes actual)
test('un patrón con un mes salteado en el medio de la ventana igual se detecta (solo importa la cantidad de meses con presencia, no que sean consecutivos)', () => {
  const history = [
    exp('Suscripción diario', 8000, '2026-04-12'), // hace 4 meses
    // mayo: sin pago (salteado)
    exp('Suscripción diario', 8000, '2026-06-12'), // hace 2 meses
    exp('Suscripción diario', 8000, '2026-07-12'), // hace 1 mes
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrences, 3);
});

// 10. Dos patrones recurrentes distintos en la misma categoría
test('dos gastos recurrentes distintos en la misma categoría se detectan como dos patrones separados', () => {
  const history = [
    exp('Netflix', 9000, '2026-05-10', 'cat_susc'),
    exp('Netflix', 9000, '2026-06-10', 'cat_susc'),
    exp('Netflix', 9000, '2026-07-10', 'cat_susc'),
    exp('Spotify', 4500, '2026-05-08', 'cat_susc'),
    exp('Spotify', 4500, '2026-06-08', 'cat_susc'),
    exp('Spotify', 4500, '2026-07-08', 'cat_susc'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 2);
  assert.deepEqual(patterns.map(p => p.description).sort(), ['Netflix', 'Spotify']);
});

// 11. Misma descripción exacta, montos muy distintos → NO recurrente
test('misma descripción exacta pero montos muy distintos (fuera del 25%) no se detecta como recurrente', () => {
  const history = [
    exp('Farmacia', 15000, '2026-05-06', 'cat_salud'),
    exp('Farmacia', 60000, '2026-06-14', 'cat_salud'),
    exp('Farmacia', 22000, '2026-07-02', 'cat_salud'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 0, 'comprar en el mismo lugar no implica gasto recurrente si los montos varían mucho');
});

// 12. Descripciones con diferencias triviales vs. genuinamente distintas
test('diferencias triviales de mayúsculas y espacios se agrupan igual (normalización simple, no fuzzy matching)', () => {
  const history = [
    exp('  Netflix  ', 9000, '2026-05-10'),
    exp('NETFLIX', 9000, '2026-06-10'),
    exp('netflix', 9000, '2026-07-10'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  assert.equal(patterns.length, 1, 'normalizeDescription baja a minúsculas y recorta espacios — no es fuzzy matching');
});

test('LIMITACIÓN CONOCIDA (aceptada): descripciones con el orden de palabras invertido ("Gimnasio SmartFit" vs "SmartFit Gimnasio") NO se agrupan', () => {
  const history = [
    exp('Gimnasio SmartFit', 50000, '2026-05-04', 'cat_x2'),
    exp('SmartFit Gimnasio', 50000, '2026-06-04', 'cat_x2'),
    exp('Gimnasio SmartFit', 50000, '2026-07-04', 'cat_x2'),
  ];
  const patterns = detectRecurringPatterns(history, REF);
  // "Gimnasio SmartFit" aparece en 2 meses, "SmartFit Gimnasio" en 1 — ninguno llega a 3.
  // Es preferible este falso negativo a agregar fuzzy matching (ver informe, LIMITACIONES).
  assert.equal(patterns.length, 0);
});
