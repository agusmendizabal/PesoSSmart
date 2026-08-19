/**
 * Tests de investmentAdvisorContext.ts — `node --test`, sin dependencias nuevas.
 * Cubre los 15 casos pedidos para Fase 4. La llamada real al LLM (edge
 * function `investment-advisor`) no se testea acá — no hay infraestructura de
 * test para Deno en este proyecto, igual que `ai-advisor` tampoco la tiene.
 * Lo que SÍ se testea, exhaustivamente, es la frontera que garantiza
 * "el motor decide, la IA solo explica": el serializador nunca inventa,
 * nunca omite lo que el motor sí calculó, y nunca expone algo que el motor
 * no produjo (rendimientos, tickers específicos).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvestmentAdvisorContext,
  trimConversationHistory,
  computeContextFingerprint,
  VALID_CATEGORY_IDS,
  type ChatMessage,
  type EconomicDataPoint,
} from './investmentAdvisorContext';
import { evaluateInvestmentCategories, detectConcentration, projectSavingsScenario, computeInvestmentConfidence, type CategoryEvaluation } from './investmentCategories';

function baseInput(overrides: Partial<Parameters<typeof buildInvestmentAdvisorContext>[0]> = {}) {
  const categoryEvaluations = evaluateInvestmentCategories({ riskProfile: 'moderate', horizon: 'mediano', concentration: null });
  const economicData: EconomicDataPoint[] = [
    { label: 'Inflación mensual (IPC)', value: 2.6, unit: '%', period: 'julio 2026', source: 'INDEC', updatedAt: null, stale: false },
  ];
  const scenario = projectSavingsScenario(25000, 12, 2.6, 'la inflación de julio 2026');
  const confidence = computeInvestmentConfidence({ riskProfileKnown: true, horizon: 'mediano', economicDataFresh: true });

  return {
    ahorroDisponible: 4000000,
    ahorroDisponibleFuente: 'live' as const,
    ahorroMensual: 25000,
    gastoPromedioMensual: 500000,
    tieneDeudaConocida: false,
    perfilRiesgo: 'moderate' as const,
    horizonte: 'mediano' as const,
    objetivo: { titulo: 'Viaje', coveragePct: 40, mesesProyectados: 12 },
    categoryEvaluations,
    concentration: null,
    economicData,
    scenario,
    confidence,
    ...overrides,
  };
}

// ─── 1. Explicación de una alternativa ──────────────────────────────────────

test('el contexto incluye el motivo estructurado que ya calculó el motor para cada alternativa seleccionada', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  assert.ok(ctx.alternativasSeleccionadas.length > 0);
  for (const alt of ctx.alternativasSeleccionadas) {
    assert.ok(alt.porQueEncaja.length > 0, `${alt.nombre} debería traer su "por qué" ya armado por el motor`);
    assert.ok(VALID_CATEGORY_IDS.includes(alt.id as any));
  }
});

// ─── 2. Perfil desconocido ───────────────────────────────────────────────────

test('perfil de riesgo desconocido: se serializa como null, nunca se inventa un perfil', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ perfilRiesgo: null }));
  assert.equal(ctx.situacion.perfilRiesgo, null);
});

// ─── 3. Horizonte desconocido ─────────────────────────────────────────────────

test('horizonte desconocido: se serializa como "sin_definir", nunca se inventa un plazo', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ horizonte: 'sin_definir' }));
  assert.equal(ctx.situacion.horizonte, 'sin_definir');
});

// ─── 4. Datos económicos faltantes ───────────────────────────────────────────

test('sin datos económicos disponibles: el arreglo queda vacío, no se rellena con un valor de relleno', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ economicData: [] }));
  assert.deepEqual(ctx.datosEconomicos, []);
});

// ─── 5. Pregunta sobre riesgo / 6. Pregunta sobre liquidez ──────────────────

test('cada alternativa trae su riesgo y liquidez ya clasificados — suficiente para responder sin recalcular', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  for (const alt of ctx.alternativasSeleccionadas) {
    assert.ok(['bajo', 'medio', 'alto'].includes(alt.riesgo));
    assert.ok(['alta', 'media', 'baja'].includes(alt.liquidez));
  }
});

// ─── 7. Pregunta sobre diferencias ───────────────────────────────────────────

test('con más de una alternativa seleccionada, el contexto trae todas (no solo la primera) para poder compararlas', () => {
  const evals = evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon: 'largo', concentration: null });
  const ctx = buildInvestmentAdvisorContext(baseInput({ categoryEvaluations: evals, perfilRiesgo: 'aggressive', horizonte: 'largo' }));
  assert.ok(ctx.alternativasSeleccionadas.length >= 2, 'perfil agresivo + horizonte largo debería habilitar varias alternativas para comparar');
});

// ─── 8. Pregunta sobre rendimiento ────────────────────────────────────────────

test('ninguna alternativa lleva un campo de rendimiento esperado — estructuralmente no se le puede inventar uno a la IA', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  for (const alt of ctx.alternativasSeleccionadas) {
    assert.equal((alt as any).rendimiento, undefined);
    assert.equal((alt as any).retornoEsperado, undefined);
    assert.equal((alt as any).tasa, undefined);
  }
});

// ─── 9. Pregunta que intenta forzar una recomendación ───────────────────────

test('las categorías descartadas por el motor viajan con su motivo — la IA puede explicar el descarte sin revertirlo', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ perfilRiesgo: 'conservative', horizonte: 'largo',
    categoryEvaluations: evaluateInvestmentCategories({ riskProfile: 'conservative', horizon: 'largo', concentration: null }) }));
  const acciones = ctx.alternativasDescartadas.find(d => d.id === 'acciones');
  assert.ok(acciones);
  assert.ok(acciones!.porQueNo.length > 0);
  assert.ok(!ctx.alternativasSeleccionadas.some(a => a.id === 'acciones'));
});

// ─── 10. Pregunta sobre instrumento no soportado ─────────────────────────────

test('el vocabulario de alternativas es un catálogo cerrado — nunca aparece un ticker o instrumento puntual', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  const allIds = [...ctx.alternativasSeleccionadas.map(a => a.id), ...ctx.alternativasDescartadas.map(d => d.id)];
  assert.ok(allIds.length > 0);
  assert.ok(allIds.every(id => (VALID_CATEGORY_IDS as readonly string[]).includes(id)));
});

// ─── 11. Contexto de conversación / 12. Pregunta de seguimiento ────────────

test('el historial de chat conserva los últimos turnos para que una pregunta de seguimiento ("¿y cuál...?") tenga con qué resolverse', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: '¿Cuál tiene menos riesgo?' },
    { role: 'assistant', content: 'La de liquidez tiene el riesgo más bajo entre las que te mostramos.' },
  ];
  const trimmed = trimConversationHistory(history);
  assert.deepEqual(trimmed, history);
});

test('el historial de chat se recorta a los últimos N turnos, no crece sin límite', () => {
  const long: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant', content: `mensaje ${i}`,
  }));
  const trimmed = trimConversationHistory(long, 8);
  assert.equal(trimmed.length, 8);
  assert.equal(trimmed[trimmed.length - 1].content, 'mensaje 29');
});

// ─── 13. Escenario hipotético ─────────────────────────────────────────────────

test('el escenario llega con su aclaración de "hipotético" intacta, nunca se le saca la advertencia', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  assert.ok(ctx.escenario.valorEscenario != null);
  assert.match(ctx.escenario.supuesto!, /hipotético/);
});

test('sin una tasa real disponible, el escenario no trae un valor inventado', () => {
  const scenario = projectSavingsScenario(25000, 12, null);
  const ctx = buildInvestmentAdvisorContext(baseInput({ scenario }));
  assert.equal(ctx.escenario.valorEscenario, null);
  assert.equal(ctx.escenario.supuesto, null);
});

// ─── 14. Fuente actualizada ───────────────────────────────────────────────────

test('un dato económico fresco viaja con stale=false y su fecha real de actualización', () => {
  const economicData: EconomicDataPoint[] = [
    { label: 'Tasa BCRA', value: 3.1, unit: '%', period: 'tasa mensual vigente', source: 'BCRA', updatedAt: new Date().toISOString(), stale: false },
  ];
  const ctx = buildInvestmentAdvisorContext(baseInput({ economicData }));
  assert.equal(ctx.datosEconomicos[0].stale, false);
  assert.equal(ctx.datosEconomicos[0].source, 'BCRA');
  assert.ok(ctx.datosEconomicos[0].updatedAt != null);
});

// ─── 15. Fuente desactualizada ────────────────────────────────────────────────

test('un dato económico viejo viaja marcado stale=true — la IA no debe presentarlo como vigente', () => {
  const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const economicData: EconomicDataPoint[] = [
    { label: 'Tasa BCRA', value: 3.1, unit: '%', period: 'tasa mensual vigente', source: 'BCRA', updatedAt: oldDate, stale: true },
  ];
  const ctx = buildInvestmentAdvisorContext(baseInput({ economicData }));
  assert.equal(ctx.datosEconomicos[0].stale, true);
});

// ─── Invariantes explícitas ───────────────────────────────────────────────────

test('la confianza y sus datos faltantes viajan intactos desde computeInvestmentConfidence', () => {
  const confidence = computeInvestmentConfidence({ riskProfileKnown: false, horizon: 'sin_definir', economicDataFresh: false });
  const ctx = buildInvestmentAdvisorContext(baseInput({ confidence, perfilRiesgo: null, horizonte: 'sin_definir' }));
  assert.equal(ctx.confianza.nivel, 'baja');
  assert.ok(ctx.confianza.faltante.length > 0);
});

test('la concentración detectada por el motor viaja al contexto; sin concentración, viaja null (no un objeto vacío engañoso)', () => {
  const concentrated = detectConcentration([{ instrumentType: 'cedear', amount: 900000 }, { instrumentType: 'fci', amount: 100000 }]);
  const ctxConcentrado = buildInvestmentAdvisorContext(baseInput({ concentration: concentrated }));
  assert.ok(ctxConcentrado.concentracion);
  assert.equal(ctxConcentrado.concentracion!.tipoDominante, 'cedear');

  const ctxSinConcentracion = buildInvestmentAdvisorContext(baseInput({ concentration: null }));
  assert.equal(ctxSinConcentracion.concentracion, null);
});

test('dos contextos con el mismo contenido producen la misma huella; uno distinto produce otra (para decidir si cachear)', () => {
  const a = buildInvestmentAdvisorContext(baseInput());
  const b = buildInvestmentAdvisorContext(baseInput());
  const c = buildInvestmentAdvisorContext(baseInput({ perfilRiesgo: 'aggressive' }));
  assert.equal(computeContextFingerprint(a), computeContextFingerprint(b));
  assert.notEqual(computeContextFingerprint(a), computeContextFingerprint(c));
});

test('el ahorro disponible desconocido se serializa como null con fuente "unknown", nunca como $0 encubierto', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ ahorroDisponible: null, ahorroDisponibleFuente: 'unknown' }));
  assert.equal(ctx.situacion.ahorroDisponible, null);
  assert.equal(ctx.situacion.ahorroDisponibleFuente, 'unknown');
});

// ═══════════════════════════════════════════════════════════════════════════
// Fase 6 — contexto extendido para el asistente accionable
// ═══════════════════════════════════════════════════════════════════════════

// ─── Backward-compat: los fixtures de Fase 4/5 (sin los campos nuevos) siguen andando ─

test('omitir todos los campos nuevos de Fase 6 no rompe nada — quedan en su valor "desconocido" por defecto', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput());
  assert.deepEqual(ctx.readiness, { elegible: true, motivo: '' });
  assert.deepEqual(ctx.gastos, []);
  assert.equal(ctx.origenAhorro, null);
  assert.equal(ctx.situacion.ingresoDisponible, null);
  assert.equal(ctx.situacion.objetivo!.montoObjetivo, null);
});

// ─── 1/2. Pregunta sobre ahorro ──────────────────────────────────────────────

test('el contexto incluye el ahorro mensual, el potencial anual (misma cuenta ×12, nunca una tasa nueva) y el origen del ahorro', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({
    ahorroMensual: 40000,
    origenAhorro: { categoria: 'Delivery', monto: 25000, esRealizado: false, porcentajeAprox: 18 },
  }));
  assert.equal(ctx.potencialAnual, 40000 * 12);
  assert.ok(ctx.origenAhorro);
  assert.equal(ctx.origenAhorro!.categoria, 'Delivery');
});

// ─── 2. Pregunta sobre gastos / 3. Priorización de categorías ───────────────

test('los gastos por categoría viajan en el mismo orden en que los recibe (el orden de prioridad ya lo decidió el motor, no se reordena acá)', () => {
  const categories = [
    { nombre: 'Delivery', gastoActual: 60000, promedioHistorico: 40000, ritmoEsperado: 45000, paceRatio: 1.8, nivel: 'alerta' as const, ahorroPotencial: 15000, insight: 'Vas por encima de tu ritmo en Delivery.', esRecurrente: false },
    { nombre: 'Super', gastoActual: 90000, promedioHistorico: 95000, ritmoEsperado: 92000, paceRatio: 0.9, nivel: 'normal' as const, ahorroPotencial: null, insight: 'Super está dentro de tu ritmo habitual.', esRecurrente: false },
    { nombre: 'Gimnasio', gastoActual: 15000, promedioHistorico: 15000, ritmoEsperado: 15000, paceRatio: 1.0, nivel: 'normal' as const, ahorroPotencial: null, insight: 'Gimnasio dentro de lo esperado.', esRecurrente: true },
  ];
  const ctx = buildInvestmentAdvisorContext(baseInput({ categories }));
  assert.deepEqual(ctx.gastos.map(g => g.nombre), ['Delivery', 'Super', 'Gimnasio']);
  assert.equal(ctx.gastos[0].nivel, 'alerta');
  assert.equal(ctx.gastos[2].esRecurrente, true);
});

test('el listado de gastos se topea a MAX_CATEGORIES_IN_CONTEXT — no se manda un payload sin límite', () => {
  const categories = Array.from({ length: 15 }, (_, i) => ({
    nombre: `Categoría ${i}`, gastoActual: 10000, promedioHistorico: 10000, ritmoEsperado: 10000,
    paceRatio: 1, nivel: 'normal' as const, ahorroPotencial: null, insight: '', esRecurrente: false,
  }));
  const ctx = buildInvestmentAdvisorContext(baseInput({ categories }));
  assert.ok(ctx.gastos.length <= 8);
});

// ─── 10. No inventar montos — passthrough exacto del insight ya calculado ───

test('el ahorro potencial y el texto de insight de cada categoría son un passthrough exacto — nunca se recalculan acá', () => {
  const categories = [{
    nombre: 'Restaurantes', gastoActual: 80000, promedioHistorico: 55000, ritmoEsperado: 60000,
    paceRatio: 1.33, nivel: 'atencion' as const, ahorroPotencial: 12345,
    insight: 'Texto exacto que ya armó buildCategoryInsight, sin tocar.', esRecurrente: false,
  }];
  const ctx = buildInvestmentAdvisorContext(baseInput({ categories }));
  assert.equal(ctx.gastos[0].ahorroPotencial, 12345);
  assert.equal(ctx.gastos[0].insight, 'Texto exacto que ya armó buildCategoryInsight, sin tocar.');
});

// ─── 4/7. Pregunta sobre objetivo ────────────────────────────────────────────

test('el objetivo lleva monto objetivo, monto actual, fecha límite y el monto mensual necesario ya calculado', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({
    objetivo: {
      titulo: 'Auto', coveragePct: 35, mesesProyectados: 10,
      montoObjetivo: 3000000, montoActual: 900000, fechaLimite: '2027-06-01', montoMensualNecesario: 175000,
    },
  }));
  assert.equal(ctx.situacion.objetivo!.montoObjetivo, 3000000);
  assert.equal(ctx.situacion.objetivo!.montoActual, 900000);
  assert.equal(ctx.situacion.objetivo!.montoMensualNecesario, 175000);
});

test('usuario sin objetivos: el campo queda null, no se inventa una meta', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ objetivo: null }));
  assert.equal(ctx.situacion.objetivo, null);
});

// ─── 5/6/7. Pregunta sobre inversión — usuario listo / no listo ─────────────

test('usuario NO listo para invertir: readiness.elegible es false y el motivo (ya redactado por el motor) viaja intacto', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({
    readiness: { elegible: false, motivo: 'Todavía no es momento de priorizar inversión. Tu ahorro actual cubre aproximadamente 1.2 meses de tus gastos habituales.' },
  }));
  assert.equal(ctx.readiness.elegible, false);
  assert.match(ctx.readiness.motivo, /1\.2 meses/);
});

test('usuario listo para invertir: readiness.elegible es true', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ readiness: { elegible: true, motivo: 'Tu colchón de emergencia parece cómodo.' } }));
  assert.equal(ctx.readiness.elegible, true);
});

// ─── 8. Información faltante ─────────────────────────────────────────────────

test('sin ingreso conocido, el campo queda null — nunca se completa con un número inventado', () => {
  const ctx = buildInvestmentAdvisorContext(baseInput({ ingresoDisponible: null }));
  assert.equal(ctx.situacion.ingresoDisponible, null);
});

// ─── 12. No crear nuevos umbrales / clasificaciones ─────────────────────────

test('el nivel de cada categoría de gasto es siempre uno de los 4 niveles ya definidos por el motor (AlertLevel) — nunca una clasificación nueva', () => {
  const categories = [
    { nombre: 'A', gastoActual: 1, promedioHistorico: 1, ritmoEsperado: 1, paceRatio: 1, nivel: 'alerta' as const, ahorroPotencial: null, insight: '', esRecurrente: false },
    { nombre: 'B', gastoActual: 1, promedioHistorico: 1, ritmoEsperado: 1, paceRatio: 1, nivel: 'oportunidad' as const, ahorroPotencial: null, insight: '', esRecurrente: false },
  ];
  const ctx = buildInvestmentAdvisorContext(baseInput({ categories }));
  const VALID_LEVELS = ['normal', 'atencion', 'alerta', 'oportunidad'];
  for (const g of ctx.gastos) assert.ok(VALID_LEVELS.includes(g.nivel));
});

// ─── 13/14. Contexto actualizado vs historial ────────────────────────────────

test('cambiar los gastos por categoría cambia la huella del contexto — el historial nunca podría hacerse pasar por un cambio real', () => {
  const a = buildInvestmentAdvisorContext(baseInput({ categories: [] }));
  const b = buildInvestmentAdvisorContext(baseInput({
    categories: [{ nombre: 'Delivery', gastoActual: 60000, promedioHistorico: 40000, ritmoEsperado: 45000, paceRatio: 1.8, nivel: 'alerta', ahorroPotencial: 15000, insight: 'x', esRecurrente: false }],
  }));
  assert.notEqual(computeContextFingerprint(a), computeContextFingerprint(b));
});

// ─── 17. Usuario sin objetivos / 18. Usuario sin historial suficiente ───────

test('categoría sin historial suficiente igual viaja al contexto, con lo que el motor ya haya decidido mostrar (nivel "normal" por defecto de buildCategoryInsight)', () => {
  const categories = [{
    nombre: 'Nueva categoría', gastoActual: 5000, promedioHistorico: 0, ritmoEsperado: 0,
    paceRatio: 0, nivel: 'normal' as const, ahorroPotencial: null,
    insight: 'Es la primera vez que registrás gastos acá. Todavía no tenemos suficiente historial.', esRecurrente: false,
  }];
  const ctx = buildInvestmentAdvisorContext(baseInput({ categories }));
  assert.equal(ctx.gastos[0].insight, categories[0].insight);
  assert.equal(ctx.gastos[0].ahorroPotencial, null);
});
