// ============================================================
// ios-shortcut-ingest — registro de gastos desde Atajos de iOS
// Deploy: npx supabase functions deploy ios-shortcut-ingest --no-verify-jwt
// Auth: token personal (Authorization: Bearer pss_...) generado con
// create_shortcut_token(); se compara su SHA-256 contra shortcut_tokens.
// Body JSON: { "text": "..." } o { "image": "<base64 JPEG/PNG>" }
// Respuesta: { status, message } — `message` es lo que muestra el atajo.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { decode as decodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CaptureInput, MAX_IMAGE_BYTES, SOURCE_LABEL,
  countRecentCaptures, extractExpense, formatARS, loadCategories, saveCapturedExpense, sha256Hex,
} from '../_shared/expenseCapture.ts';

const SOURCE = 'ios_shortcut';
const DAILY_LIMIT = 100;
const MAX_BODY_BYTES = 6_000_000;

function reply(status: number, kind: string, message: string) {
  return new Response(JSON.stringify({ status: kind, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'error', 'Método no permitido.');

  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) return reply(500, 'error', 'Servicio no configurado.');

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!/^pss_[0-9a-f]{64}$/.test(token)) {
    return reply(401, 'unauthorized', 'Token inválido. Generá uno nuevo en la app: Perfil → Atajos de iOS.');
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tokenRow } = await db
    .from('shortcut_tokens')
    .select('user_id')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle();
  if (!tokenRow) {
    return reply(401, 'unauthorized', 'Token inválido. Generá uno nuevo en la app: Perfil → Atajos de iOS.');
  }
  const userId: string = tokenRow.user_id;

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return reply(413, 'error', 'La imagen es muy pesada. Achicala antes de enviarla.');
  }

  let body: { text?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, 'error', 'El atajo envió datos inválidos.');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const imageB64 = typeof body.image === 'string' ? body.image.replace(/\s/g, '') : '';
  if (!text && !imageB64) return reply(400, 'error', 'No llegó ningún texto ni imagen.');

  if ((await countRecentCaptures(db, userId, SOURCE)) >= DAILY_LIMIT) {
    return reply(429, 'limit', 'Llegaste al límite diario de gastos por Atajos. Cargalos desde la app.');
  }

  let input: CaptureInput;
  let rawSubject: string;
  if (imageB64) {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(imageB64);
    } catch {
      return reply(400, 'error', 'La imagen no se pudo leer.');
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) return reply(413, 'error', 'La imagen es muy pesada. Achicala antes de enviarla.');
    const mime = imageMime(bytes);
    if (!mime) return reply(415, 'error', 'Formato de imagen no soportado. Convertila a JPEG en el atajo.');
    input = { imageBase64: imageB64, mime };
    rawSubject = `sc_img_${await sha256Hex(bytes.buffer as ArrayBuffer)}`;
  } else {
    input = { text: text.slice(0, 1000) };
    // Mismo texto dentro de la misma hora = misma notificación reenviada.
    const hourBucket = new Date().toISOString().slice(0, 13);
    rawSubject = `sc_${await sha256Hex(`${userId}|${text}|${hourBucket}`)}`;
  }

  const categories = await loadCategories(db);
  const { data: extracted } = await extractExpense(input, categories, groqKey);
  const result = await saveCapturedExpense(db, { userId, source: SOURCE, rawSubject, extracted, categories });

  await db.from('shortcut_tokens').update({ last_used_at: new Date().toISOString() }).eq('user_id', userId);

  switch (result.kind) {
    case 'not_expense':
      return reply(200, 'ignored', 'No encontré un gasto en ese contenido.');
    case 'error':
      return reply(500, 'error', 'No pude guardar el gasto. Probá de nuevo.');
    case 'already_exists':
      return reply(200, 'already_exists', 'Ese gasto ya estaba registrado.');
    case 'duplicate': {
      const via = result.via ? ` (llegó por ${SOURCE_LABEL[result.via] ?? result.via})` : '';
      return reply(200, 'duplicate', `Ya tenías registrado ${result.merchant} · ${formatARS(result.amount)}${via}.`);
    }
    case 'pending':
      return reply(200, 'registered', `✅ ${result.merchant} · ${formatARS(result.amount)} · ${result.categoryLabel}. Revisalo en PesoSSmart.`);
  }
});
