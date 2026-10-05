// ============================================================
// whatsapp-webhook — registro de gastos por WhatsApp (Meta Cloud API)
// Deploy: npx supabase functions deploy whatsapp-webhook --no-verify-jwt
// Auth: firma HMAC X-Hub-Signature-256 con WHATSAPP_APP_SECRET.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AsyncLocalStorage } from 'node:async_hooks';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'qwen/qwen3.8-27b';
const TEXT_MODEL   = 'qwen/qwen3.8-27b';
const MAX_IMAGE_BYTES = 3_500_000; // Groq rechaza imágenes base64 > 4MB
const DAILY_LIMIT = 50;

const APP_SECRET      = Deno.env.get('WHATSAPP_APP_SECRET');
const VERIFY_TOKEN    = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
const ACCESS_TOKEN    = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
const GROQ_API_KEY    = Deno.env.get('GROQ_API_KEY');

const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer', 'digital_wallet', 'other'];
const CLASSIFICATIONS = ['necessary', 'disposable', 'investable'];
const YES = new Set(['si', 'sí', 's', 'ok', 'dale', 'confirmar', 'confirmo']);
const NO  = new Set(['no', 'n', 'cancelar', 'descartar']);

const HELP_TEXT =
  'Mandame una foto del ticket o escribime el gasto, por ejemplo: "gasté $5.000 en la verdulería". ' +
  'Yo lo cargo en PesoSSmart. 🧾';

type Category = { id: string; name: string; name_es: string };
type Extracted = {
  es_gasto: boolean;
  comercio: string | null;
  monto: number | null;
  fecha: string | null;
  categoria: string | null;
  clasificacion: string | null;
  medio_pago: string | null;
};

// ── Firma ────────────────────────────────────────────────────────────────────

async function isValidSignature(body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const expected = Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
  const received = header.slice('sha256='.length);
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

// ── WhatsApp API ─────────────────────────────────────────────────────────────

// Respuestas enviadas en el request actual; se devuelven en el body del webhook
// (solo lo ve quien firmó el request) para poder auditar el flujo sin logs.
const outbox = new AsyncLocalStorage<unknown[]>();

async function sendWhatsApp(payload: Record<string, unknown>) {
  outbox.getStore()?.push(payload.text ?? payload.interactive);
  const res = await fetch(`${GRAPH_URL}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) console.error('[whatsapp-webhook] Error enviando mensaje:', await res.text());
}

const sendText = (to: string, body: string) => sendWhatsApp({ to, type: 'text', text: { body } });

const sendConfirmButtons = (to: string, body: string, txId: string) => sendWhatsApp({
  to,
  type: 'interactive',
  interactive: {
    type: 'button',
    body: { text: body },
    action: {
      buttons: [
        { type: 'reply', reply: { id: `confirm:${txId}`, title: '✅ Confirmar' } },
        { type: 'reply', reply: { id: `reject:${txId}`,  title: '❌ Descartar' } },
      ],
    },
  },
});

async function downloadMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mime: string } | 'too_big' | null> {
  const metaRes = await fetch(`${GRAPH_URL}/${mediaId}`, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  if (meta.file_size && meta.file_size > MAX_IMAGE_BYTES) return 'too_big';
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!fileRes.ok) return null;
  const bytes = await fileRes.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 'too_big';
  return { bytes, mime: meta.mime_type ?? 'image/jpeg' };
}

// ── Groq ─────────────────────────────────────────────────────────────────────

function todayAR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function extractionPrompt(categories: Category[]): string {
  const today = todayAR();
  return `Sos un asistente que registra gastos de usuarios argentinos. Hoy es ${today}.
Respondé SOLO con un JSON con esta forma:
{"es_gasto":true,"comercio":"Coto","monto":15230.5,"fecha":"${today}","categoria":"groceries","clasificacion":"necessary","medio_pago":"debit"}

Reglas:
- es_gasto: false si no hay un gasto concreto con monto (saludos, preguntas, fotos que no son tickets).
- monto: el TOTAL pagado, número sin separadores de miles ($15.230,50 → 15230.5).
- fecha: YYYY-MM-DD. "hoy" → ${today}. Si no aparece, null.
- comercio: nombre corto del comercio, sin razón social (S.A., S.R.L.) ni sucursal.
- categoria: una de: ${categories.map(c => `${c.name} (${c.name_es})`).join(', ')}.
- clasificacion: "necessary" (super, farmacia, transporte, servicios), "disposable" (salidas, ropa, ocio) o "investable" (ahorro/inversión).
- medio_pago: "cash", "debit", "credit", "transfer", "digital_wallet" u "other" según lo que diga el ticket o el texto; si no se sabe, null.`;
}

async function callGroq(model: string, messages: unknown[]): Promise<Extracted | null> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 400, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[whatsapp-webhook] Groq error:', errText);
    outbox.getStore()?.push({ groq_error: res.status, detail: errText.slice(0, 300) });
    return null;
  }
  const data = await res.json();
  const content: string | undefined = data.choices?.[0]?.message?.content;
  const match = content?.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match![0]);
  } catch {
    console.error('[whatsapp-webhook] Respuesta de Groq no parseable:', content);
    return null;
  }
}

const extractFromImage = (b64: string, mime: string, categories: Category[]) =>
  callGroq(VISION_MODEL, [
    { role: 'system', content: extractionPrompt(categories) },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      { type: 'text', text: 'Extraé el gasto de este ticket.' },
    ] },
  ]);

const extractFromText = (text: string, categories: Category[]) =>
  callGroq(TEXT_MODEL, [
    { role: 'system', content: extractionPrompt(categories) },
    { role: 'user', content: text },
  ]);

// ── Helpers de dominio ───────────────────────────────────────────────────────

function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?l?|s\.?r\.?l\.?|s\.?a\.?s\.?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatARS(n: number): string {
  return '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function sanitizeDate(raw: string | null): string {
  const today = todayAR();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(Date.parse(raw))) return today;
  const ageDays = (Date.parse(today) - Date.parse(raw)) / 86_400_000;
  return ageDays < -1 || ageDays > 120 ? today : raw;
}

const SOURCE_LABEL: Record<string, string> = {
  gmail: 'Gmail', outlook: 'Outlook', mercadopago: 'Mercado Pago', whatsapp: 'WhatsApp',
};

// ── Acciones ─────────────────────────────────────────────────────────────────

async function linkPhone(db: SupabaseClient, phone: string, code: string) {
  const { data: row } = await db
    .from('whatsapp_link_codes')
    .select('user_id, expires_at')
    .eq('code', code)
    .maybeSingle();

  if (!row || new Date(row.expires_at) < new Date()) {
    await sendText(phone, 'Ese código no es válido o ya venció. Generá uno nuevo desde la app: Perfil → WhatsApp.');
    return;
  }

  await db.from('whatsapp_links').delete().or(`phone.eq.${phone},user_id.eq.${row.user_id}`);
  const { error } = await db.from('whatsapp_links').insert({ user_id: row.user_id, phone });
  await db.from('whatsapp_link_codes').delete().eq('code', code);

  if (error) {
    console.error('[whatsapp-webhook] Error vinculando:', error);
    await sendText(phone, 'No pude vincular tu número. Probá de nuevo en unos minutos.');
    return;
  }
  await sendText(phone, `¡Listo! Tu WhatsApp quedó vinculado a PesoSSmart. ✅\n\n${HELP_TEXT}`);
}

async function confirmPending(db: SupabaseClient, userId: string, txId: string): Promise<string> {
  const { data: tx } = await db
    .from('pending_transactions')
    .select('*')
    .eq('id', txId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!tx) return 'No encontré ese gasto.';
  if (tx.status === 'confirmed') return 'Ese gasto ya estaba confirmado. 👍';
  if (tx.status !== 'pending') return 'Ese gasto ya fue descartado.';

  const { data: cat } = tx.suggested_category
    ? await db.from('expense_categories').select('id').eq('name', tx.suggested_category).maybeSingle()
    : { data: null };

  const fields = {
    description:    tx.description ?? tx.merchant ?? 'Gasto por WhatsApp',
    payment_method: tx.payment_method ?? 'cash',
    category_id:    cat?.id ?? null,
    classification: tx.suggested_classification ?? 'disposable',
  };

  // tr_auto_expense_from_pending (trigger de la DB) ya crea un gasto sin
  // categoría al insertar el pendiente: se completa ese en vez de insertar otro.
  const { data: existing } = await db
    .from('expenses')
    .select('id')
    .eq('source_pending_id', tx.id)
    .is('deleted_at', null)
    .maybeSingle();

  const { error: expErr } = existing
    ? await db.from('expenses').update(fields).eq('id', existing.id)
    : await db.from('expenses').insert({
        ...fields,
        user_id:           userId,
        amount:            tx.amount,
        date:              tx.transaction_date ?? todayAR(),
        is_recurring:      false,
        source_pending_id: tx.id,
      });
  // 23505: otra invocación insertó el gasto en paralelo (doble tap / reintento de Meta)
  if (expErr && (expErr as any).code !== '23505') {
    console.error('[whatsapp-webhook] Error guardando gasto:', expErr);
    return 'No pude guardar el gasto. Probá de nuevo o confirmalo desde la app.';
  }

  await db.from('pending_transactions').update({ status: 'confirmed' }).eq('id', tx.id);

  const merchantKey = normalizeMerchant(tx.merchant ?? '');
  if (merchantKey && tx.suggested_category) {
    const { data: hint } = await db
      .from('merchant_category_hints')
      .select('count')
      .eq('user_id', userId)
      .eq('merchant_normalized', merchantKey)
      .maybeSingle();
    await db.from('merchant_category_hints').upsert({
      user_id:             userId,
      merchant_normalized: merchantKey,
      merchant_display:    tx.merchant,
      category:            tx.suggested_category,
      classification:      tx.suggested_classification ?? 'disposable',
      count:               (hint?.count ?? 0) + 1,
      last_seen:           todayAR(),
    }, { onConflict: 'user_id,merchant_normalized' });
  }

  return `✅ Registrado: ${tx.merchant ?? 'Gasto'} · ${formatARS(Number(tx.amount))}`;
}

async function rejectPending(db: SupabaseClient, userId: string, txId: string): Promise<string> {
  const { data } = await db
    .from('pending_transactions')
    .update({ status: 'rejected' })
    .eq('id', txId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id');
  if (!data?.length) return 'Ese gasto ya no está pendiente.';

  // Mismo criterio que rejectTx() en la app: borrar el gasto que creó el
  // trigger, salvo que ya esté vinculado a un gasto grupal.
  const { data: linked } = await db
    .from('expenses')
    .select('id')
    .eq('source_pending_id', txId)
    .is('deleted_at', null)
    .maybeSingle();
  if (linked) {
    const { data: hasGroup } = await db.rpc('expense_has_group_link', { p_expense_id: linked.id });
    if (!hasGroup) await db.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', linked.id);
  }
  return '🗑️ Listo, lo descarté.';
}

async function latestWhatsAppPending(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db
    .from('pending_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'whatsapp')
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function registerExpense(
  db: SupabaseClient,
  phone: string,
  userId: string,
  rawSubject: string,
  extracted: Extracted | null,
  categories: Category[],
) {
  const amount = Number(extracted?.monto);
  if (!extracted?.es_gasto || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    console.warn('[whatsapp-webhook] Sin gasto identificable:', JSON.stringify(extracted));
    outbox.getStore()?.push({ extracted });
    await sendText(phone, `No pude identificar un gasto. ${HELP_TEXT}`);
    return;
  }

  const merchant = (extracted.comercio ?? '').trim().slice(0, 80) || 'Gasto';
  const date = sanitizeDate(extracted.fecha);

  const { data: hint } = await db
    .from('merchant_category_hints')
    .select('category, classification')
    .eq('user_id', userId)
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
      user_id:                  userId,
      source:                   'whatsapp',
      direction:                'outgoing',
      amount,
      currency:                 'ARS',
      merchant,
      description:              merchant,
      transaction_date:         date,
      suggested_category:       category,
      suggested_classification: classification,
      payment_method:           paymentMethod,
      raw_subject:              rawSubject,
      status:                   'pending',
    }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true })
    .select('id, status, dedup_of');

  if (error) {
    console.error('[whatsapp-webhook] Error guardando pendiente:', error);
    await sendText(phone, 'No pude guardar el gasto. Probá de nuevo en unos minutos.');
    return;
  }
  if (!inserted?.length) {
    await sendText(phone, `${rawSubject.startsWith('wa_img_') ? 'Este ticket' : 'Este gasto'} ya lo tenía registrado. 👍`);
    return;
  }

  const tx = inserted[0];
  if (tx.status === 'duplicate') {
    const { data: original } = tx.dedup_of
      ? await db.from('pending_transactions').select('source').eq('id', tx.dedup_of).maybeSingle()
      : { data: null };
    const via = original?.source ? ` (llegó por ${SOURCE_LABEL[original.source] ?? original.source})` : '';
    await sendText(phone, `Este gasto ya lo tenía registrado${via}: ${merchant} · ${formatARS(amount)}. No lo cargo de nuevo.`);
    return;
  }

  const catLabel = categories.find(c => c.name === category)?.name_es ?? category;
  await sendConfirmButtons(
    phone,
    `🧾 ${merchant} · ${formatARS(amount)}\n📂 ${catLabel}\n📅 ${formatDate(date)}\n\n¿Lo registro?`,
    tx.id,
  );
}

// ── Handler de mensaje ───────────────────────────────────────────────────────

async function handleMessage(db: SupabaseClient, msg: any) {
  const phone: string = String(msg.from ?? '');
  if (!/^\d{6,15}$/.test(phone)) return;
  const text: string = msg.type === 'text' ? String(msg.text?.body ?? '').trim() : '';

  const codeMatch = text.toUpperCase().match(/PESOS-[0-9A-F]{6}/);
  if (codeMatch) {
    await linkPhone(db, phone, codeMatch[0]);
    return;
  }

  const { data: link } = await db.from('whatsapp_links').select('user_id').eq('phone', phone).maybeSingle();
  if (!link) {
    await sendText(phone, 'Hola 👋 Para registrar gastos por acá, primero vinculá tu número desde la app de PesoSSmart: Perfil → WhatsApp.');
    return;
  }
  const userId: string = link.user_id;

  if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
    const [action, txId] = String(msg.interactive.button_reply?.id ?? '').split(':');
    if (txId && action === 'confirm') await sendText(phone, await confirmPending(db, userId, txId));
    else if (txId && action === 'reject') await sendText(phone, await rejectPending(db, userId, txId));
    return;
  }

  const word = text.toLowerCase().replace(/[!.?¡¿]/g, '').trim();
  if (YES.has(word) || NO.has(word)) {
    const txId = await latestWhatsAppPending(db, userId);
    if (!txId) {
      await sendText(phone, 'No tengo ningún gasto pendiente para confirmar.');
      return;
    }
    await sendText(phone, YES.has(word) ? await confirmPending(db, userId, txId) : await rejectPending(db, userId, txId));
    return;
  }

  if (msg.type !== 'image' && !text) {
    await sendText(phone, HELP_TEXT);
    return;
  }

  const { count } = await db
    .from('pending_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'whatsapp')
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) {
    await sendText(phone, 'Llegaste al límite de gastos por WhatsApp de hoy. Podés seguir cargándolos desde la app.');
    return;
  }

  const { data: categories } = await db.from('expense_categories').select('id, name, name_es');
  const cats: Category[] = categories ?? [];

  if (msg.type === 'image') {
    const media = await downloadMedia(msg.image.id);
    if (media === 'too_big') {
      await sendText(phone, 'La imagen es muy pesada. Probá mandarla de nuevo con menor calidad.');
      return;
    }
    if (!media) {
      await sendText(phone, 'No pude descargar la imagen. Probá de nuevo.');
      return;
    }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', media.bytes));
    const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    const extracted = await extractFromImage(encodeBase64(media.bytes), media.mime, cats);
    await registerExpense(db, phone, userId, `wa_img_${hashHex}`, extracted, cats);
    return;
  }

  const extracted = await extractFromText(text.slice(0, 500), cats);
  await registerExpense(db, phone, userId, `wa_${msg.id}`, extracted, cats);
}

// ── Entry point ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (!APP_SECRET || !VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID || !GROQ_API_KEY) {
    console.error('[whatsapp-webhook] Faltan secrets de WhatsApp/Groq');
    return new Response('Not configured', { status: 500 });
  }

  // Verificación inicial del webhook (Meta → GET con hub.challenge)
  if (req.method === 'GET') {
    const params = new URL(req.url).searchParams;
    if (params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(params.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  if (!(await isValidSignature(body, req.headers.get('x-hub-signature-256')))) {
    console.warn('[whatsapp-webhook] Firma inválida');
    return new Response('Invalid signature', { status: 401 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const payload = JSON.parse(body);
  const replies: unknown[] = [];

  await outbox.run(replies, async () => {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        if (value.metadata?.phone_number_id !== PHONE_NUMBER_ID) continue;
        for (const msg of value.messages ?? []) {
          try {
            await handleMessage(db, msg);
          } catch (err) {
            console.error('[whatsapp-webhook] Error procesando mensaje:', err);
            replies.push({ error: String(err) });
          }
        }
      }
    }
  });

  // Siempre 200 una vez validada la firma: si no, Meta reintenta y duplica respuestas.
  return new Response(JSON.stringify({ replies }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
