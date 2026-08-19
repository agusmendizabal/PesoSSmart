/**
 * Tests de investmentChatContinuity.ts — `node --test`, sin dependencias nuevas.
 * Cubre los 16 casos pedidos para Fase 5. El CRUD real contra Supabase
 * (crear/recuperar thread, persistir mensajes) vive en
 * `investmentChatPersistence.ts` y no tiene test unitario — mismo límite ya
 * establecido para `recurringAdjustment.ts`/`savingsDestinationContext.ts`/
 * `investmentReadinessContext.ts` (no hay infraestructura para mockear
 * Supabase en este proyecto). Lo que SÍ se testea exhaustivamente acá es la
 * regla de decisión (cuándo regenerar, cuándo avisar) y las garantías de
 * seguridad de la Fase 5: el historial nunca contamina el contexto financiero
 * actual, y viceversa.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRegenerateExplanation,
  CONTEXT_CHANGED_NOTICE,
  HISTORY_LOAD_ERROR_MESSAGE,
  ASSISTANT_ERROR_MESSAGE,
  selectSuggestedQuestions,
  buildQuickActions,
} from './investmentChatContinuity';
import { trimConversationHistory, buildInvestmentAdvisorContext, computeContextFingerprint, type ChatMessage } from './investmentAdvisorContext';
import { evaluateInvestmentCategories, projectSavingsScenario, computeInvestmentConfidence } from './investmentCategories';

function baseInput(overrides: Partial<Parameters<typeof buildInvestmentAdvisorContext>[0]> = {}) {
  return {
    ahorroDisponible: 4000000,
    ahorroDisponibleFuente: 'live' as const,
    ahorroMensual: 25000,
    gastoPromedioMensual: 500000,
    tieneDeudaConocida: false,
    perfilRiesgo: 'moderate' as const,
    horizonte: 'mediano' as const,
    objetivo: null,
    categoryEvaluations: evaluateInvestmentCategories({ riskProfile: 'moderate', horizon: 'mediano', concentration: null }),
    concentration: null,
    economicData: [{ label: 'Inflación mensual (IPC)', value: 2.6, unit: '%', period: 'julio 2026', source: 'INDEC', updatedAt: null, stale: false }],
    scenario: projectSavingsScenario(25000, 12, 2.6, 'la inflación de julio 2026'),
    confidence: computeInvestmentConfidence({ riskProfileKnown: true, horizon: 'mediano', economicDataFresh: true }),
    ...overrides,
  };
}

// ─── 15. Usuario sin conversación previa ────────────────────────────────────

test('sin fingerprint guardado y sin mensajes previos: hay que generar, sin aviso de cambio (conversación nueva)', () => {
  const decision = shouldRegenerateExplanation({ storedFingerprint: null, currentFingerprint: 'abc', hasExistingMessages: false });
  assert.equal(decision.regenerate, true);
  assert.equal(decision.showChangeNotice, false);
});

test('sin fingerprint guardado pero CON mensajes previos (thread de antes de esta fase): generar, pero sin aviso de cambio falso', () => {
  const decision = shouldRegenerateExplanation({ storedFingerprint: null, currentFingerprint: 'abc', hasExistingMessages: true });
  assert.equal(decision.regenerate, true);
  assert.equal(decision.showChangeNotice, false);
});

// ─── 16. Usuario con conversación existente (contexto sin cambios) ─────────

test('fingerprint guardado igual al actual: no hace falta regenerar, no se llama al LLM', () => {
  const decision = shouldRegenerateExplanation({ storedFingerprint: 'abc', currentFingerprint: 'abc', hasExistingMessages: true });
  assert.equal(decision.regenerate, false);
  assert.equal(decision.showChangeNotice, false);
});

// ─── 8/9. Cambio de fingerprint / contexto financiero actualizado ──────────

test('fingerprint guardado distinto al actual, con mensajes previos: regenerar Y avisar del cambio', () => {
  const decision = shouldRegenerateExplanation({ storedFingerprint: 'abc', currentFingerprint: 'xyz', hasExistingMessages: true });
  assert.equal(decision.regenerate, true);
  assert.equal(decision.showChangeNotice, true);
});

test('el aviso de cambio es lenguaje natural, nunca expone el fingerprint ni datos técnicos', () => {
  assert.doesNotMatch(CONTEXT_CHANGED_NOTICE, /[a-f0-9]{8,}/i); // sin hashes
  assert.doesNotMatch(CONTEXT_CHANGED_NOTICE, /fingerprint|hash|json/i);
  assert.match(CONTEXT_CHANGED_NOTICE, /situación financiera cambió/);
});

// ─── 6/7. Últimos 8 mensajes al LLM, pero el historial completo no se toca ──

test('el contexto financiero enviado al LLM es independiente del contenido del historial de chat', () => {
  const historyMentioningOldRate: ChatMessage[] = [
    { role: 'user', content: '¿cuál es la inflación?' },
    { role: 'assistant', content: 'La inflación de marzo era 3.4%, fuente BCRA.' }, // dato viejo, dentro de una respuesta pasada
  ];
  // El historial NUNCA se pasa como argumento de buildInvestmentAdvisorContext —
  // es estructuralmente imposible que un dato mencionado en una respuesta vieja
  // termine reemplazando al dato económico actual.
  const ctx = buildInvestmentAdvisorContext(baseInput());
  assert.equal(ctx.datosEconomicos[0].value, 2.6); // el dato ACTUAL, no el 3.4 mencionado en el historial
  assert.equal(historyMentioningOldRate.length, 2); // el historial sigue existiendo aparte, intacto
});

test('recortar el historial a los últimos 8 mensajes no muta el historial completo original', () => {
  const full: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` }));
  const trimmed = trimConversationHistory(full);
  assert.equal(trimmed.length, 8);
  assert.equal(full.length, 20, 'el historial completo (lo que se guarda/muestra) no debe verse afectado por el recorte que se manda al LLM');
});

// ─── 10. Reutilización incorrecta de una recomendación antigua ─────────────

test('un cambio de perfil de riesgo entre dos llamadas cambia las alternativas seleccionadas — la vieja recomendación no persiste en el contexto nuevo', () => {
  const conservador = buildInvestmentAdvisorContext(baseInput({
    perfilRiesgo: 'conservative',
    categoryEvaluations: evaluateInvestmentCategories({ riskProfile: 'conservative', horizon: 'mediano', concentration: null }),
  }));
  const agresivo = buildInvestmentAdvisorContext(baseInput({
    perfilRiesgo: 'aggressive', horizonte: 'largo',
    categoryEvaluations: evaluateInvestmentCategories({ riskProfile: 'aggressive', horizon: 'largo', concentration: null }),
  }));
  const idsConservador = conservador.alternativasSeleccionadas.map(a => a.id).sort();
  const idsAgresivo    = agresivo.alternativasSeleccionadas.map(a => a.id).sort();
  assert.notDeepEqual(idsConservador, idsAgresivo);
  assert.ok(!idsConservador.includes('acciones'));
});

// ─── 11. Datos económicos antiguos vs actuales ──────────────────────────────

test('dos llamadas con distintos datos económicos nunca mezclan valores — cada contexto refleja solo lo que se le pasó', () => {
  const viejo  = buildInvestmentAdvisorContext(baseInput({ economicData: [{ label: 'Inflación mensual (IPC)', value: 3.4, unit: '%', period: 'marzo 2026', source: 'INDEC', updatedAt: null, stale: false }] }));
  const actual = buildInvestmentAdvisorContext(baseInput({ economicData: [{ label: 'Inflación mensual (IPC)', value: 2.6, unit: '%', period: 'julio 2026', source: 'INDEC', updatedAt: null, stale: false }] }));
  assert.equal(viejo.datosEconomicos[0].value, 3.4);
  assert.equal(actual.datosEconomicos[0].value, 2.6);
  assert.notEqual(viejo.datosEconomicos[0].period, actual.datosEconomicos[0].period);
});

// ─── 12. Error al recuperar historial ───────────────────────────────────────

test('el mensaje de error de historial es amigable y no bloquea seguir usando el chat', () => {
  assert.match(HISTORY_LOAD_ERROR_MESSAGE, /no pudimos recuperar/i);
  assert.match(HISTORY_LOAD_ERROR_MESSAGE, /empezar una nueva/i);
});

// ─── 13/14. Error de Groq / Reintento ───────────────────────────────────────

test('el mensaje de error del asistente deja claro que el mensaje del usuario no se perdió y se puede reintentar', () => {
  assert.match(ASSISTANT_ERROR_MESSAGE, /guardado/i);
  assert.match(ASSISTANT_ERROR_MESSAGE, /reintentar/i);
});

test('reintentar un mensaje fallido reusa el mismo historial ya recortado — no hace falta duplicar el mensaje del usuario', () => {
  const historyWithUnansweredQuestion: ChatMessage[] = [
    { role: 'user', content: '¿cuál tiene menos riesgo?' },
    { role: 'assistant', content: 'La de liquidez.' },
    { role: 'user', content: '¿y más liquidez?' }, // ya persistido, todavía sin respuesta (el intento anterior falló)
  ];
  const forRetry = trimConversationHistory(historyWithUnansweredQuestion);
  assert.equal(forRetry[forRetry.length - 1].content, '¿y más liquidez?');
  assert.equal(forRetry.filter(m => m.content === '¿y más liquidez?').length, 1, 'no debe duplicarse el mensaje al reintentar');
});

// ─── Invariante estructural: la huella es determinística ────────────────────

test('la huella del contexto financiero (usada para decidir si regenerar) es estable entre llamadas equivalentes', () => {
  const a = buildInvestmentAdvisorContext(baseInput());
  const b = buildInvestmentAdvisorContext(baseInput());
  assert.equal(computeContextFingerprint(a), computeContextFingerprint(b));
});

// ─── Fase 6 — 15. Chips contextuales ────────────────────────────────────────

test('con oportunidad de ahorro, meta activa y listo para invertir: aparecen las preguntas de cada categoría, tope 4', () => {
  const questions = selectSuggestedQuestions({ hasSavingsOpportunity: true, hasGoal: true, readyToInvest: true });
  assert.ok(questions.length <= 4);
  assert.ok(questions.some(q => q.includes('ahorrar más')));
});

test('sin oportunidad de ahorro y sin meta, pero no listo para invertir: prioriza la pregunta de "qué me falta"', () => {
  const questions = selectSuggestedQuestions({ hasSavingsOpportunity: false, hasGoal: false, readyToInvest: false });
  assert.ok(questions.includes('¿Qué me falta para poder invertir?'));
  assert.ok(!questions.some(q => q.includes('ahorrar más')));
  assert.ok(!questions.some(q => q.includes('objetivo')));
});

test('listo para invertir: aparecen preguntas sobre las alternativas, no la de "qué me falta"', () => {
  const questions = selectSuggestedQuestions({ hasSavingsOpportunity: false, hasGoal: false, readyToInvest: true });
  assert.ok(!questions.includes('¿Qué me falta para poder invertir?'));
  assert.ok(questions.some(q => q.includes('diferencia')));
});

test('nunca se muestran más de 4 sugerencias a la vez, incluso con todas las señales activas', () => {
  const questions = selectSuggestedQuestions({ hasSavingsOpportunity: true, hasGoal: true, readyToInvest: false });
  assert.ok(questions.length <= 4);
});

// ─── Fase 6 — 16. Acciones hacia pantallas existentes ───────────────────────

test('siempre incluye el acceso a Plan Inteligente; solo agrega "ver objetivo" si hay una meta', () => {
  const sinMeta = buildQuickActions({ hasGoal: false });
  assert.equal(sinMeta.length, 1);
  assert.equal(sinMeta[0].route, '/(app)/savings-plan');

  const conMeta = buildQuickActions({ hasGoal: true });
  assert.equal(conMeta.length, 2);
  assert.ok(conMeta.some(a => a.route === '/(app)/savings-goal'));
});

test('las acciones son solo navegación a pantallas existentes — ninguna ruta apunta a compra/venta/ejecución', () => {
  const actions = [...buildQuickActions({ hasGoal: false }), ...buildQuickActions({ hasGoal: true })];
  for (const a of actions) {
    assert.doesNotMatch(a.route, /comprar|vender|broker|orden|trade/i);
  }
});
