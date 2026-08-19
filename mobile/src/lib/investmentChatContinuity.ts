/**
 * investmentChatContinuity.ts
 *
 * Fase 5: reglas puras que gobiernan la CONTINUIDAD del chat de inversión —
 * cuándo regenerar la explicación, cuándo avisar que el contexto cambió, y
 * los mensajes de error/reintento. Ninguna de estas funciones toca Supabase
 * ni recalcula nada financiero: reciben el fingerprint que ya calculó
 * `computeContextFingerprint` (Fase 4, sin tocar) y solo deciden QUÉ HACER
 * con la conversación ya persistida.
 *
 * Ver `investmentChatPersistence.ts` para el CRUD real de threads/mensajes
 * (Supabase — sin tests unitarios, mismo patrón que
 * `savingsDestinationContext.ts`/`investmentReadinessContext.ts`).
 *
 * Regla central de esta fase: EL HISTORIAL SE RECUERDA, LAS DECISIONES NO.
 * Estas funciones nunca leen el CONTENIDO de mensajes viejos para decidir
 * nada — solo comparan la huella del contexto actual contra la guardada.
 */

export interface RegenerationDecision {
  /** true si hay que volver a llamar al LLM para generar una explicación nueva. */
  regenerate: boolean;
  /** true si, además, hay que mostrarle al usuario que su situación cambió (nunca si es la primera conversación). */
  showChangeNotice: boolean;
}

/**
 * Decide si hace falta una explicación nueva, sin tocar el historial de chat.
 *
 * - Sin fingerprint guardado y sin mensajes previos → conversación nueva: generar, sin aviso de cambio.
 * - Sin fingerprint guardado pero CON mensajes previos → thread de antes de esta fase (columna
 *   recién agregada): generar para tener una huella de ahora en más, pero sin aviso de cambio
 *   (no hay una huella vieja real contra la cual comparar, sería un falso "cambió tu situación").
 * - Fingerprint guardado igual al actual → el análisis previo sigue vigente: no llamar al LLM.
 * - Fingerprint guardado distinto al actual → el contexto cambió de verdad: generar de nuevo y avisar.
 */
export function shouldRegenerateExplanation(input: {
  storedFingerprint: string | null;
  currentFingerprint: string;
  hasExistingMessages: boolean;
}): RegenerationDecision {
  const { storedFingerprint, currentFingerprint, hasExistingMessages } = input;

  if (storedFingerprint == null) {
    return { regenerate: true, showChangeNotice: false };
  }
  if (storedFingerprint === currentFingerprint) {
    return { regenerate: false, showChangeNotice: false };
  }
  return { regenerate: true, showChangeNotice: hasExistingMessages };
}

// ─── Textos fijos (lenguaje natural, nunca detalles técnicos) ──────────────

/** Punto 6 del pedido — texto literal, nunca se muestra un fingerprint ni un dato técnico. */
export const CONTEXT_CHANGED_NOTICE =
  'Tu situación financiera cambió desde la última vez que hablamos. Actualicé el análisis.';

/** Punto 10 — si no se puede recuperar el historial, no rompe la pantalla. */
export const HISTORY_LOAD_ERROR_MESSAGE =
  'No pudimos recuperar la conversación anterior. Podemos empezar una nueva.';

/** Punto 10 — si falla Groq, error amigable; el mensaje del usuario ya está guardado y se puede reintentar. */
export const ASSISTANT_ERROR_MESSAGE =
  'Tuvimos un problema para responder. Tu mensaje quedó guardado — podés reintentar.';

// ─── Fase 6: sugerencias y accesos contextuales ────────────────────────────
//
// Puramente de UX del chat — no deciden nada financiero, solo eligen qué
// preguntas/atajos mostrar según señales que YA calculó el motor. Nunca más
// de 3-4 chips a la vez (punto 10 del pedido).

export interface ChatSituationFlags {
  /** true si `plan.potentialSavings` supera el umbral que ya usa la pantalla (no se reevalúa acá). */
  hasSavingsOpportunity: boolean;
  hasGoal: boolean;
  readyToInvest: boolean;
}

const MAX_SUGGESTED_QUESTIONS = 4;

export function selectSuggestedQuestions(flags: ChatSituationFlags): string[] {
  const questions: string[] = [];

  if (flags.hasSavingsOpportunity) {
    questions.push('¿Dónde puedo ahorrar más?', '¿Qué gasto reduciría primero?');
  }
  if (flags.hasGoal) {
    questions.push('¿Cómo llego a mi objetivo?', '¿Cuánto debería ahorrar por mes?');
  }
  if (!flags.readyToInvest) {
    questions.push('¿Qué me falta para poder invertir?');
  } else {
    questions.push('¿Por qué estas alternativas?', '¿Qué diferencia hay entre ellas?');
  }

  return questions.slice(0, MAX_SUGGESTED_QUESTIONS);
}

// ─── Fase 6: accesos a pantallas existentes (punto 11) ─────────────────────
//
// Solo navegación a pantallas que YA existen — nunca una acción que modifique
// datos. La decisión de MOSTRAR estos botones es de la UI, no del LLM: el
// modelo nunca controla la interfaz, solo conversa (punto 18).

export interface QuickAction {
  label: string;
  route: string;
}

export function buildQuickActions(flags: { hasGoal: boolean }): QuickAction[] {
  const actions: QuickAction[] = [
    { label: 'Ver Plan Inteligente', route: '/(app)/savings-plan' },
  ];
  if (flags.hasGoal) {
    actions.push({ label: 'Ver mi objetivo', route: '/(app)/savings-goal' });
  }
  return actions;
}
