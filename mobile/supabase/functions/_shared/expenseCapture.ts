// Captura de gastos desde texto libre o imagen (WhatsApp, Atajos de iOS):
// extracción con Groq + guardado como pending_transaction con sugerencia.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const CAPTURE_MODEL = 'qwen/qwen3.8-27b'; // texto + visión
export const MAX_IMAGE_BYTES = 3_500_000;      // Groq rechaza imágenes base64 > 4MB

const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer', 'digital_wallet', 'other'];
const CLASSIFICATIONS = ['necessary', 'disposable', 'investable'];

export const SOURCE_LABEL: Record<string, string> = {
  gmail: 'Gmail', outlook: 'Outlook', mercadopago: 'Mercado Pago', whatsapp: 'WhatsApp', ios_shortcut: 'Atajos de iOS',
};

export type Category = { id: string; name: string; name_es: string };
export type Extracted = {
  es_gasto: boolean;
  comercio: string | null;
  monto: number | null;
  monto_texto?: string | null;
  fecha: string | null;
  categoria: string | null;
  clasificacion: string | null;
  medio_pago: string | null;
};
export type CaptureInput = { text: string } | { imageBase64: string; mime: string };

export type SaveResult =
  | { kind: 'not_expense'; extracted: Extracted | null }
  | { kind: 'error' }
  | { kind: 'already_exists' }
  | { kind: 'duplicate'; merchant: string; amount: number; via: string | null }
  | { kind: 'pending'; id: string; merchant: string; amount: number; date: string; categoryLabel: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

export function todayAR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function sanitizeDate(raw: string | null): string {
  const today = todayAR();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(Date.parse(raw))) return today;
  const ageDays = (Date.parse(today) - Date.parse(raw)) / 86_400_000;
  return ageDays < -1 || ageDays > 120 ? today : raw;
}

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?l?|s\.?r\.?l\.?|s\.?a\.?s\.?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "$5.200,00" → 5200, "15.230" → 15230, "1,5" → 1.5, "3500" → 3500.
// El modelo confunde a menudo el punto de miles argentino con un decimal, por
// eso se le pide el monto tal como está escrito y se interpreta acá.
export function parseARAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  let normalized: string;
  if (s.includes(',') && s.includes('.')) {
    normalized = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')   // 5.200,50
      : s.replace(/,/g, '');                     // 5,200.50
  } else if (s.includes(',')) {
    normalized = /,\d{1,2}$/.test(s) ? s.replace(/\.(?=.*,)/g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes('.')) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatARS(n: number): string {
  const decimals = Number.isInteger(n) ? 0 : 2;
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function loadCategories(db: SupabaseClient): Promise<Category[]> {
  const { data } = await db.from('expense_categories').select('id, name, name_es');
  return data ?? [];
}

export async function countRecentCaptures(db: SupabaseClient, userId: string, source: string): Promise<number> {
  const { count } = await db
    .from('pending_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', source)
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return count ?? 0;
}

// ── Extracción con Groq ──────────────────────────────────────────────────────

function extractionPrompt(categories: Category[]): string {
  const today = todayAR();
  return `Sos un asistente que registra gastos de usuarios argentinos. Hoy es ${today}.
El contenido puede ser un ticket, una captura de una app bancaria, un SMS/notificación del banco o un texto escrito por el usuario.
Respondé SOLO con un JSON con esta forma:
{"es_gasto":true,"comercio":"Coto","monto_texto":"$15.230,50","monto":15230.5,"fecha":"${today}","categoria":"groceries","clasificacion":"necessary","medio_pago":"debit"}

Reglas:
- es_gasto: false si no hay un gasto concreto con monto: saludos, preguntas, códigos de seguridad, promociones, avisos de vencimiento, ingresos o transferencias RECIBIDAS.
- monto_texto: el TOTAL pagado copiado EXACTAMENTE como aparece escrito, con sus puntos y comas ("$5.200,00", "15.230"). Si el monto está en palabras ("tres mil"), escribilo en números ("3000").
- monto: el mismo TOTAL como número. En Argentina el punto separa miles y la coma decimales: $5.200,00 → 5200; $15.230 → 15230; $15.230,50 → 15230.5.
- fecha: YYYY-MM-DD. "hoy" → ${today}. Si no aparece, null.
- comercio: nombre corto del comercio o destinatario, sin razón social (S.A., S.R.L.), sucursal ni números de tarjeta.
- categoria: una de: ${categories.map(c => `${c.name} (${c.name_es})`).join(', ')}.
- clasificacion: "necessary" (super, farmacia, transporte, servicios), "disposable" (salidas, ropa, ocio) o "investable" (ahorro/inversión).
- medio_pago: "cash", "debit", "credit", "transfer", "digital_wallet" u "other" según el contenido; si no se sabe, null.`;
}

export async function extractExpense(
  input: CaptureInput,
  categories: Category[],
  groqKey: string,
): Promise<{ data: Extracted | null; error?: string }> {
  const userContent = 'text' in input
    ? input.text.slice(0, 1000)
    : [
        { type: 'image_url', image_url: { url: `data:${input.mime};base64,${input.imageBase64}` } },
        { type: 'text', text: 'Extraé el gasto de esta imagen.' },
      ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CAPTURE_MODEL,
      messages: [
        { role: 'system', content: extractionPrompt(categories) },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('[expenseCapture] Groq error:', res.status, detail);
    return { data: null, error: `groq_${res.status}: ${detail.slice(0, 300)}` };
  }

  const data = await res.json();
  const content: string | undefined = data.choices?.[0]?.message?.content;
  try {
    return { data: JSON.parse(content!.match(/\{[\s\S]*\}/)![0]) };
  } catch {
    console.error('[expenseCapture] Respuesta de Groq no parseable:', content);
    return { data: null, error: 'unparseable' };
  }
}

// ── Guardado ─────────────────────────────────────────────────────────────────

export async function saveCapturedExpense(
  db: SupabaseClient,
  p: { userId: string; source: string; rawSubject: string; extracted: Extracted | null; categories: Category[] },
): Promise<SaveResult> {
  const { extracted, categories } = p;
  const amount = parseARAmount(extracted?.monto_texto) ?? Number(extracted?.monto);
  if (!extracted?.es_gasto || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return { kind: 'not_expense', extracted };
  }

  const merchant = (extracted.comercio ?? '').trim().slice(0, 80) || 'Gasto';
  const date = sanitizeDate(extracted.fecha);

  const { data: hint } = await db
    .from('merchant_category_hints')
    .select('category, classification')
    .eq('user_id', p.userId)
    .eq('merchant_normalized', normalizeMerchant(merchant))
    .maybeSingle();

  const validNames = new Set(categories.map(c => c.name));
  const category = hint?.category
    ?? (extracted.categoria && validNames.has(extracted.categoria) ? extracted.categoria : 'other');
  const classification = hint?.classification
    ?? (CLASSIFICATIONS.includes(extracted.clasificacion ?? '') ? extracted.clasificacion : 'disposable');
  const paymentMethod = PAYMENT_METHODS.includes(extracted.medio_pago ?? '') ? extracted.medio_pago : null;

  const { data: inserted, error } = await db
    .from('pending_transactions')
    .upsert({
      user_id:                  p.userId,
      source:                   p.source,
      direction:                'outgoing',
      amount,
      currency:                 'ARS',
      merchant,
      description:              merchant,
      transaction_date:         date,
      suggested_category:       category,
      suggested_classification: classification,
      payment_method:           paymentMethod,
      raw_subject:              p.rawSubject,
      status:                   'pending',
    }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true })
    .select('id, status, dedup_of');

  if (error) {
    console.error('[expenseCapture] Error guardando pendiente:', error);
    return { kind: 'error' };
  }
  if (!inserted?.length) return { kind: 'already_exists' };

  const tx = inserted[0];
  if (tx.status === 'duplicate') {
    const { data: original } = tx.dedup_of
      ? await db.from('pending_transactions').select('source').eq('id', tx.dedup_of).maybeSingle()
      : { data: null };
    return { kind: 'duplicate', merchant, amount, via: original?.source ?? null };
  }

  return {
    kind: 'pending',
    id: tx.id,
    merchant,
    amount,
    date,
    categoryLabel: categories.find(c => c.name === category)?.name_es ?? category,
  };
}
