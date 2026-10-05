// ============================================================
// whatsapp-webhook — registro de gastos por WhatsApp (Meta Cloud API)
// Deploy: npx supabase functions deploy whatsapp-webhook --no-verify-jwt
// Auth: firma HMAC X-Hub-Signature-256 con WHATSAPP_APP_SECRET.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CaptureInput, MAX_IMAGE_BYTES, SOURCE_LABEL,
  countRecentCaptures, extractExpense, formatARS, formatDate, loadCategories,
  normalizeMerchant, saveCapturedExpense, sha256Hex, todayAR,
} from '../_shared/expenseCapture.ts';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';
const DAILY_LIMIT = 50;

const APP_SECRET      = Deno.env.get('WHATSAPP_APP_SECRET');
const VERIFY_TOKEN    = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
const ACCESS_TOKEN    = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
const GROQ_API_KEY    = Deno.env.get('GROQ_API_KEY');

const YES = new Set(['si', 'sí', 's', 'ok', 'dale', 'confirmar', 'confirmo']);
const NO  = new Set(['no', 'n', 'cancelar', 'descartar']);

const HELP_TEXT =
  'Mandame una foto del ticket o escribime el gasto, por ejemplo: "gasté $5.000 en la verdulería". ' +
  'Yo lo cargo en PesoSSmart. 🧾';

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

async function registerExpense(db: SupabaseClient, phone: string, userId: string, rawSubject: string, input: CaptureInput) {
  const categories = await loadCategories(db);
  const { data: extracted, error: groqError } = await extractExpense(input, categories, GROQ_API_KEY!);
  if (groqError) outbox.getStore()?.push({ groq_error: groqError });

  const result = await saveCapturedExpense(db, { userId, source: 'whatsapp', rawSubject, extracted, categories });

  switch (result.kind) {
    case 'not_expense':
      outbox.getStore()?.push({ extracted: result.extracted });
      return sendText(phone, `No pude identificar un gasto. ${HELP_TEXT}`);
    case 'error':
      return sendText(phone, 'No pude guardar el gasto. Probá de nuevo en unos minutos.');
    case 'already_exists':
      return sendText(phone, `${'imageBase64' in input ? 'Este ticket' : 'Este gasto'} ya lo tenía registrado. 👍`);
    case 'duplicate': {
      const via = result.via ? ` (llegó por ${SOURCE_LABEL[result.via] ?? result.via})` : '';
      return sendText(phone, `Este gasto ya lo tenía registrado${via}: ${result.merchant} · ${formatARS(result.amount)}. No lo cargo de nuevo.`);
    }
    case 'pending':
      return sendConfirmButtons(
        phone,
        `🧾 ${result.merchant} · ${formatARS(result.amount)}\n📂 ${result.categoryLabel}\n📅 ${formatDate(result.date)}\n\n¿Lo registro?`,
        result.id,
      );
  }
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

  if ((await countRecentCaptures(db, userId, 'whatsapp')) >= DAILY_LIMIT) {
    await sendText(phone, 'Llegaste al límite de gastos por WhatsApp de hoy. Podés seguir cargándolos desde la app.');
    return;
  }

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
    await registerExpense(db, phone, userId, `wa_img_${await sha256Hex(media.bytes)}`, {
      imageBase64: encodeBase64(media.bytes),
      mime: media.mime,
    });
    return;
  }

  await registerExpense(db, phone, userId, `wa_${msg.id}`, { text: text.slice(0, 500) });
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
