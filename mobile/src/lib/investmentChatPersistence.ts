/**
 * investmentChatPersistence.ts
 *
 * Fase 5 — CRUD real de la conversación de inversión contra Supabase.
 * Reutiliza `chat_threads`/`chat_history` tal cual existen (mismo patrón que
 * `advisor.tsx`, `bot_type = 'inversiones'` — ya es un valor válido del CHECK
 * constraint, no hace falta tocar el esquema para esto). No se crea ninguna
 * tabla ni arquitectura nueva — la única migración de esta fase es la columna
 * `context_fingerprint` (ver `chat_threads_context_fingerprint.sql`).
 *
 * A diferencia del asesor general (que permite múltiples threads por bot),
 * acá se mantiene UN solo thread continuo por usuario: siempre se reutiliza
 * el más reciente en vez de crear uno nuevo en cada visita.
 *
 * Sin tests unitarios — igual que `recurringAdjustment.ts`,
 * `savingsDestinationContext.ts` e `investmentReadinessContext.ts`, este
 * archivo solo hace I/O; la lógica de decisión que rodea estas llamadas está
 * en `investmentChatContinuity.ts` (pura, testeada).
 */

import { supabase } from '@/lib/supabase';
import type { ChatMessage } from './investmentAdvisorContext';

const supa = supabase as any;
const BOT_TYPE = 'inversiones';

export interface InvestmentChatThread {
  id: string;
  context_fingerprint: string | null;
}

export interface StoredChatMessage extends ChatMessage {
  id: string;
  created_at: string;
}

/** Busca el thread de inversión más reciente del usuario; si no existe, crea uno. Nunca crea uno nuevo si ya hay uno. */
export async function findOrCreateInvestmentThread(userId: string): Promise<InvestmentChatThread> {
  const { data: existing } = await supa
    .from('chat_threads')
    .select('id, context_fingerprint')
    .eq('user_id', userId)
    .eq('bot_type', BOT_TYPE)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing as InvestmentChatThread;

  const { data: created, error } = await supa
    .from('chat_threads')
    .insert({ user_id: userId, bot_type: BOT_TYPE, title: 'Alternativas de inversión' })
    .select('id, context_fingerprint')
    .single();

  if (error || !created) throw new Error(error?.message ?? 'No se pudo crear la conversación');
  return created as InvestmentChatThread;
}

/** Historial COMPLETO del thread, para mostrarlo — el recorte a los últimos 8 para el LLM pasa aparte (trimConversationHistory). */
export async function loadThreadMessages(threadId: string): Promise<StoredChatMessage[]> {
  const { data, error } = await supa
    .from('chat_history')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as StoredChatMessage[];
}

export async function saveMessageToThread(
  threadId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  const { error } = await supa.from('chat_history').insert({
    user_id: userId, bot_type: BOT_TYPE, thread_id: threadId, role, content,
  });
  if (error) throw new Error(error.message);

  await supa.from('chat_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
}

/** Actualiza la huella del contexto financiero que se usó por última vez en este thread — nunca el contenido de la conversación. */
export async function updateThreadFingerprint(threadId: string, fingerprint: string): Promise<void> {
  await supa.from('chat_threads').update({ context_fingerprint: fingerprint }).eq('id', threadId);
}
