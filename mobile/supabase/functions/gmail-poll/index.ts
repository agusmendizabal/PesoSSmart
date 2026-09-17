import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ALL_SENDER_DOMAINS, detectBank } from '../_shared/bankDetector.ts';
import { parseEmailFields, buildPreParsedContext } from '../_shared/bankParsers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SUBJECT_KEYWORDS = [
  'compraste', 'pagaste', 'transferiste', 'realizaste', 'efectuaste', 'gastaste',
  'débito', 'debito', 'consumo', 'cargo', 'debitó', 'acreditó',
  'acreditada', 'acreditado', 'acreditacion', 'acreditación',
  'aprobado', 'realizada', 'operación', 'operacion', 'movimiento',
  'pago', 'compra', 'transaccion', 'transacción', 'transferencia',
  'enviada', 'enviado', 'recibida', 'recibido',
  'aviso', 'fondos', 'notificacion', 'notificación',
];

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function decryptToken(encryptedToken: string): Promise<string> {
  if (!encryptedToken.startsWith('v1:')) return encryptedToken;
  const rawKey = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes = new TextEncoder().encode(rawKey.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = Uint8Array.from(atob(encryptedToken.slice(3)), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

async function encryptToken(token: string): Promise<string> {
  const rawKey = Deno.env.get('GMAIL_ENCRYPTION_KEY') ?? '';
  if (rawKey.length < 32) throw new Error('GMAIL_ENCRYPTION_KEY debe tener al menos 32 caracteres');
  const keyBytes = new TextEncoder().encode(rawKey.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return 'v1:' + btoa(String.fromCharCode(...combined));
}

// ── Gmail token refresh ───────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    if (!res.ok) {
      console.error('[gmail-poll] refreshAccessToken failed:', await res.text());
      return null;
    }
    const data = await res.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error('[gmail-poll] refreshAccessToken exception:', err);
    return null;
  }
}

// ── Limpieza de nombre de comercio ───────────────────────────────────────────

function cleanMerchant(raw: string): string {
  return raw
    .replace(/@\S*/g, '')
    .replace(/#\S*/g, '')
    .replace(/[*|_\\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

// ── Email body extraction ─────────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTextFromEmail(payload: any): string {
  const plainParts: string[] = [];
  const htmlParts: string[]  = [];

  function traverse(part: any) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      plainParts.push(decodeBase64Url(part.body.data));
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      htmlParts.push(stripHtml(decodeBase64Url(part.body.data)));
    }
    if (part.parts) part.parts.forEach(traverse);
  }

  traverse(payload);

  if (plainParts.length > 0) return plainParts.join('\n').slice(0, 3000);
  if (htmlParts.length > 0)  return htmlParts.join('\n').slice(0, 3000);
  if (payload?.body?.data)   return decodeBase64Url(payload.body.data).slice(0, 3000);
  return '';
}

// ── PDF attachment detection ──────────────────────────────────────────────────

interface PdfAttachment {
  attachmentId: string;
  filename:     string;
}

function findPdfAttachments(payload: any): PdfAttachment[] {
  const found: PdfAttachment[] = [];

  function traverse(part: any) {
    if (!part) return;
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      found.push({ attachmentId: part.body.attachmentId, filename: part.filename ?? 'attachment.pdf' });
    }
    if (part.parts) part.parts.forEach(traverse);
  }

  traverse(payload);
  return found;
}

// ── Parse PDF via Groq Vision ─────────────────────────────────────────────────

async function parsePdfWithGroq(base64Data: string): Promise<Array<{ fecha: string; comercio: string; monto: number; moneda: string }>> {
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) return [];

  try {
    const res = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.2-11b-vision-preview',
        messages: [{
          role:    'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:application/pdf;base64,${base64Data}` },
            },
            {
              type: 'text',
              text: `Este es un resumen de tarjeta o extracto bancario argentino. Extraé TODAS las transacciones que aparecen.
Respondé ÚNICAMENTE con un array JSON válido, sin texto adicional ni markdown.
Formato exacto: [{ "fecha": "YYYY-MM-DD", "comercio": "nombre del comercio", "monto": 12345, "moneda": "ARS" }]
- monto: número entero sin decimales ni puntos
- fecha: formato ISO YYYY-MM-DD
- comercio: nombre limpio sin caracteres especiales
- Incluí TODAS las filas de transacciones que encuentres
Si no podés extraer nada, respondé: []`,
            },
          ],
        }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.error('[gmail-poll] parsePdfWithGroq failed:', res.status);
      return [];
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    return JSON.parse(arrMatch[0]);
  } catch (err) {
    console.error('[gmail-poll] parsePdfWithGroq exception:', err);
    return [];
  }
}

// ── Groq classification ───────────────────────────────────────────────────────

async function classifyWithGroq(subject: string, body: string, preParsedContext: string): Promise<any | null> {
  const groqKey = Deno.env.get('GROQ_API_KEY');
  if (!groqKey) {
    console.error('[gmail-poll] GROQ_API_KEY no configurada');
    return null;
  }

  const contextSection = preParsedContext ? `\n${preParsedContext}\n` : '';

  const prompt = `Analizá este email financiero argentino. Puede ser una compra, pago con tarjeta, transferencia enviada o recibida.
Respondé ÚNICAMENTE con JSON válido, sin texto adicional ni markdown.
${contextSection}
Asunto: ${subject}
Contenido: ${body}

REGLAS:
- Si hay un monto de dinero que SALIÓ de la cuenta (compra, pago, transferencia enviada a TERCEROS), es un movimiento válido → es_movimiento: true
- Avisos de transferencias bancarias (aunque digan "no válido como comprobante") SÍ son movimientos válidos si van a un tercero
- Para transferencias, usá el nombre real del destinatario como "comercio". Si el PRE-ANÁLISIS incluye "Destinatario:", usá ese nombre exacto. Si no, buscalo en el cuerpo del email (alias, nombre completo, "a:", "para:")
- Para compras, usá el nombre del comercio
- PROHIBIDO: nunca uses "Varios", "Varios comercios", "Desconocido", "Pago", "Compra", "Transferencia" o palabras genéricas como valor de "comercio". Si no podés identificar el nombre, usá el campo "Destinatario" del PRE-ANÁLISIS
- IMPORTANTE: Si la transferencia es entre cuentas PROPIAS del mismo usuario (ej: de banco a billetera virtual, de cuenta a cuenta propia, recarga de MercadoPago desde cuenta bancaria, traspaso a cuenta de ahorro propia, envío de fondos a sí mismo), NO es un gasto → es_movimiento: false
- Señales de transferencia propia: el destinatario tiene el mismo nombre/CUIT, el asunto dice "recarga", "traspaso a tu cuenta", "fondos enviados a tu cuenta", el email confirma un ingreso no un egreso
- Si el email es solo informativo sin monto claro → es_movimiento: false

clasificacion:
- "necessary": supermercado, farmacia, servicios (luz/gas/agua/internet), alquiler, transporte público, combustible, salud, educación
- "disposable": restaurant, bar, café, delivery, entretenimiento, ropa, electrónica, viajes, streaming, suscripciones no esenciales
- "investable": transferencias a brokers/inversiones (Balanz, IOL, PPI, Lemoine), compra de dólares/crypto/cedears, plazo fijo, recarga de billeteras de inversión

Formato exacto:
{
  "es_movimiento": true,
  "monto": 350000,
  "moneda": "ARS",
  "comercio": "Nombre limpio del comercio o destinatario (sin @, #, ni caracteres especiales)",
  "categoria": "comida",
  "clasificacion": "disposable",
  "fecha": "2026-04-08",
  "descripcion": "McDonald's"
}

REGLAS PARA descripcion:
- Máximo 30 caracteres
- Solo el nombre del comercio o una acción muy corta: "McDonald's", "Uber", "Netflix", "Transferencia a Juan", "YPF Combustible"
- Sin frases largas como "Compraste en..." o "Pago realizado en..."
- Sin palabras como "Producto de", "Compra en", "Pago a"

CATEGORÍAS — elegí siempre la más específica. Usá "otros" SOLO si ninguna encaja:
- comida: supermercado, almacén, Carrefour, Día, Coto, Jumbo, Disco, Rappi (supermercado), PedidosYa, Glovo, McDonald's, Burger King, Mostaza, pizzería, rotisería, delivery de comida, cualquier restaurant o comida para llevar
- cafe: Starbucks, cafetería, café, té, bar de café, panadería con consumición
- transporte: Uber, Cabify, taxi, colectivo, SUBE, Trenes Argentinos, subte, combustible, YPF, Shell, Axion, estacionamiento, peaje, Autopistas, garaje
- servicios: luz (Edesur/Edenor), gas (Metrogas/Naturgy), agua (AySA), internet (Fibertel/Telecentro/Claro/Personal), telefonía, Movistar, ARBA, AFIP, expensas, ABL, alquiler, seguro de hogar, tarjeta de crédito (resumen/pago)
- entretenimiento: Netflix, Disney+, HBO Max, Spotify, Amazon Prime, Apple TV, cine, teatro, Ticketek, videojuegos, Steam, PlayStation, Xbox, bares, boliches, salidas nocturnas
- salud: farmacia (Farmacity, Rappi Farma), OSDE, Swiss Medical, Galeno, obra social, médico, clínica, laboratorio, dentista, óptica, hospital
- ropa: Zara, H&M, Nike, Adidas, Falabella, Garbarino (ropa), indumentaria, calzado, zapatillas, accesorios de moda
- hogar: Fravega, Garbarino (electrodomésticos), Easy, Sodimac, mueblería, pinturería, ferretería, limpieza del hogar, artículos para el hogar
- educacion: universidad, colegio, curso online, Udemy, Coursera, guardería, jardín de infantes, libros educativos, idiomas
- deporte: gym, Megatlon, Smart Fit, pilates, crossfit, natación, yoga, equipamiento deportivo, Nike Run, Decathlon
- peluqueria: peluquería, barbería, salón de belleza, spa, manicuría, tintura, corte de pelo, estética
- seguros: seguro de auto (Sancor, La Caja, Zurich, Mapfre), ART, seguro de vida, seguro de moto
- otros: SOLO si no encaja en ninguna categoría anterior
Si no hay monto saliente claro, respondé: { "es_movimiento": false }`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  300,
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.error('[gmail-poll] Groq API error:', res.status, await res.text());
      return null;
    }

    const data     = await res.json();
    const content  = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[gmail-poll] Groq no devolvió JSON válido:', content);
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[gmail-poll] classifyWithGroq exception:', err);
    return null;
  }
}

// ── Process a single transaction result and upsert into DB ───────────────────

const GENERIC_MERCHANT_NAMES = new Set([
  'varios', 'varios comercios', 'desconocido', 'compra', 'pago', 'transferencia', 'movimiento', 'operacion', 'operación',
]);

const CATEGORY_NAME_MAP: Record<string, string> = {
  cafe:            'cafe',
  peluqueria:      'beauty_salon',
  deporte:         'sports',
  seguros:         'insurance',
  comida:          'food_dining',
  transporte:      'transport',
  salud:           'health',
  ropa:            'clothing',
  hogar:           'home',
  educacion:       'education',
  entretenimiento: 'entertainment',
  otros:           'other',
};

async function processTransaction(
  supabase: any,
  userId: string,
  rawSubject: string,
  result: any,
  preParsed: any,
): Promise<boolean> {
  const finalAmount = result.monto ?? preParsed.amount;
  const finalDate   = result.fecha ?? preParsed.occurredAt ?? new Date().toISOString().split('T')[0];

  const rawMerchant  = cleanMerchant(result.comercio ?? preParsed.recipientName ?? preParsed.senderName ?? 'Desconocido');
  const finalMerchant = GENERIC_MERCHANT_NAMES.has(rawMerchant.toLowerCase().trim())
    ? cleanMerchant(preParsed.recipientName ?? preParsed.senderName ?? rawMerchant)
    : rawMerchant;

  const merchantNorm = normalizeMerchant(finalMerchant);

  const validClassifications = ['necessary', 'disposable', 'investable'];
  const groqClassification   = validClassifications.includes(result.clasificacion)
    ? result.clasificacion
    : 'disposable';
  const groqCategory = CATEGORY_NAME_MAP[result.categoria] ?? 'other';

  // ── Mes anterior: insertar directamente en expenses sin categoría ──────────
  const txDate    = new Date(finalDate + 'T12:00:00');
  const nowDate   = new Date();
  const isPastMonth =
    txDate.getFullYear() < nowDate.getFullYear() ||
    (txDate.getFullYear() === nowDate.getFullYear() && txDate.getMonth() < nowDate.getMonth());

  if (isPastMonth) {
    await supabase.from('pending_transactions').upsert({
      user_id:          userId,
      source:           'gmail',
      amount:           finalAmount,
      currency:         result.moneda ?? 'ARS',
      merchant:         finalMerchant,
      description:      result.descripcion ?? null,
      transaction_date: finalDate,
      raw_subject:      rawSubject,
      status:           'confirmed',
    }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });

    const { error: pastExpErr } = await supabase.from('expenses').insert({
      user_id:        userId,
      description:    result.descripcion ?? finalMerchant,
      amount:         finalAmount,
      date:           finalDate,
      payment_method: 'other',
      category_id:    null,
      is_recurring:   false,
    });

    if (pastExpErr) {
      console.error('[gmail-poll] Error insertando gasto mes anterior:', pastExpErr);
      return false;
    }
    console.log('[gmail-poll] Mes anterior guardado sin categoría:', finalMerchant, finalDate);
    return true;
  }

  // ── Leer hint para sugerencia y calcular high_confidence ─────────────────
  const { data: hint } = await supabase
    .from('merchant_category_hints')
    .select('category, classification, count')
    .eq('user_id', userId)
    .eq('merchant_normalized', merchantNorm)
    .maybeSingle();

  const hintCount  = hint?.count ?? 0;
  const isHighConf = hintCount >= 3;

  let suggestedCategory:       string | null = null;
  let suggestedClassification: string | null = null;

  if (hintCount >= 1) {
    suggestedCategory       = hint!.category;
    suggestedClassification = hint!.classification;
    const level = hintCount >= 3 ? 'alta' : hintCount === 2 ? 'media' : 'baja';
    console.log(`[gmail-poll] Hint "${finalMerchant}": ${suggestedCategory} (${hintCount}x, confianza ${level})`);
  } else {
    console.log(`[gmail-poll] Sin historial para "${finalMerchant}" — se guarda sin sugerencia`);
  }

  const { error: insertError } = await supabase.from('pending_transactions').upsert({
    user_id:                  userId,
    source:                   'gmail',
    amount:                   finalAmount,
    currency:                 result.moneda ?? 'ARS',
    merchant:                 finalMerchant,
    suggested_category:       suggestedCategory,
    suggested_classification: suggestedClassification,
    description:              result.descripcion,
    transaction_date:         finalDate,
    raw_subject:              rawSubject,
    status:                   'pending',
    hint_count:               hintCount,
    high_confidence:          isHighConf,
  }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });

  if (insertError) {
    console.error('[gmail-poll] Error al insertar pending_transaction:', insertError);
    return false;
  }
  console.log('[gmail-poll] pending_transaction OK:', finalMerchant, finalAmount, isHighConf ? '[ALTA CONFIANZA]' : '');
  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let userId: string;

    // ── Dual auth: cron (INTERNAL_FN_SECRET + userId en body) o JWT normal ──
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    const isCronCall     = internalSecret && authHeader === `Bearer ${internalSecret}`;

    if (isCronCall) {
      let body: any = {};
      try { body = await req.json(); } catch { /* body vacío OK */ }
      if (!body?.userId) {
        return new Response(JSON.stringify({ error: 'userId requerido para llamadas internas' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = body.userId;
      console.log('[gmail-poll] Modo cron para usuario:', userId);
    } else {
      const authRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
        headers: {
          'Authorization': authHeader,
          'apikey':        Deno.env.get('SUPABASE_ANON_KEY')!,
        },
      });

      if (!authRes.ok) {
        const errText = await authRes.text();
        console.error('[gmail-poll] Auth falló:', authRes.status, errText);
        return new Response(JSON.stringify({ error: 'No autorizado', detail: errText }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const authData = await authRes.json();
      userId = authData.id;
    }

    console.log('[gmail-poll] Usuario:', userId);

    const { data: connection, error: connError } = await supabase
      .from('gmail_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      console.log('[gmail-poll] Sin conexión Gmail para usuario:', userId, connError);
      return new Response(JSON.stringify({ pending: [], gmail_connected: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[gmail-poll] Gmail conectado:', connection.gmail_email, '| last_checked_at:', connection.last_checked_at);

    // Rate limit solo para llamadas del usuario (no del cron)
    if (!isCronCall) {
      const secondsSinceLastCheck = (Date.now() - new Date(connection.last_checked_at).getTime()) / 1000;
      if (secondsSinceLastCheck < 60) {
        console.log('[gmail-poll] Rate limit: último poll hace', Math.round(secondsSinceLastCheck), 's');
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentList } = await supabase
          .from('pending_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'confirmed')
          .gte('created_at', since24h)
          .order('created_at', { ascending: false });
        return new Response(JSON.stringify({
          gmail_connected: true,
          gmail_email:     connection.gmail_email,
          new_found:       0,
          pending:         recentList ?? [],
          rate_limited:    true,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    let googleToken: string;
    let refreshTokenDecrypted: string;
    try {
      googleToken            = await decryptToken(connection.access_token);
      refreshTokenDecrypted  = await decryptToken(connection.refresh_token);
    } catch (decryptErr) {
      console.error('[gmail-poll] Error desencriptando tokens:', decryptErr);
      return new Response(JSON.stringify({ error: 'Error de configuración. Reconectá Gmail.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const testRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );
    console.log('[gmail-poll] Google token probe status:', testRes.status);

    if (testRes.status === 401) {
      console.log('[gmail-poll] Token vencido, refrescando...');
      if (!refreshTokenDecrypted) {
        await supabase.from('gmail_connections').update({ token_expired: true }).eq('user_id', userId);
        return new Response(JSON.stringify({ error: 'Token de Gmail expirado. Reconectá tu cuenta.', code: 'GMAIL_TOKEN_EXPIRED' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const newToken = await refreshAccessToken(refreshTokenDecrypted);
      if (!newToken) {
        await supabase.from('gmail_connections').update({ token_expired: true }).eq('user_id', userId);
        return new Response(JSON.stringify({ error: 'Token de Gmail expirado. Reconectá tu cuenta.', code: 'GMAIL_TOKEN_EXPIRED' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      googleToken = newToken;
      const encryptedNew = await encryptToken(googleToken);
      const { error: tokenUpdateErr } = await supabase.from('gmail_connections')
        .update({ access_token: encryptedNew })
        .eq('user_id', userId);
      if (tokenUpdateErr) console.error('[gmail-poll] Error guardando token renovado:', tokenUpdateErr);
      else console.log('[gmail-poll] Token de Google refrescado OK');
    } else if (!testRes.ok) {
      console.error('[gmail-poll] Google token probe inesperado:', testRes.status, await testRes.text());
    }

    const newAccessToken = googleToken;

    // ── Determinar rango de búsqueda y tamaño del batch ───────────────────
    const isBackfill = !connection.is_backfill_done;
    let sinceTs: number;
    let maxResults: number;

    if (isBackfill) {
      // Primer poll real: cubrir últimos 6 meses
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      sinceTs    = Math.floor(sixMonthsAgo.getTime() / 1000);
      maxResults = 500;
      console.log('[gmail-poll] BACKFILL: buscando últimos 6 meses, hasta 500 emails');
    } else {
      const since = new Date(connection.last_checked_at);
      sinceTs    = Math.floor(since.getTime() / 1000);
      maxResults = 100;
    }

    const gmailQuery = `(pago OR compra OR transferencia OR debito OR consumo OR pagaste OR compraste OR aviso OR acreditacion OR fondos) after:${sinceTs}`;
    console.log('[gmail-poll] Gmail query:', gmailQuery, '| maxResults:', maxResults);

    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${newAccessToken}` } },
    );

    if (!searchRes.ok) {
      const errText = await searchRes.text();
      console.error('[gmail-poll] Gmail search failed:', searchRes.status, errText);
      throw new Error(`Gmail search failed: ${errText}`);
    }

    const searchData = await searchRes.json();
    const messages   = searchData.messages ?? [];
    console.log('[gmail-poll] Mensajes encontrados en Gmail:', messages.length);

    let newPending    = 0;
    let hadGroqFailure = false;

    for (const msg of messages) {
      const { data: existing } = await supabase
        .from('pending_transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('raw_subject', msg.id)
        .single();

      if (existing) {
        console.log('[gmail-poll] Ya procesado:', msg.id);
        continue;
      }

      const emailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${newAccessToken}` } },
      );
      if (!emailRes.ok) {
        console.error('[gmail-poll] No se pudo descargar email:', msg.id, emailRes.status);
        continue;
      }

      const emailData = await emailRes.json();
      const headers   = emailData.payload?.headers ?? [];
      const subject   = headers.find((h: any) => h.name === 'Subject')?.value ?? '';
      const from      = headers.find((h: any) => h.name === 'From')?.value ?? '';

      console.log('[gmail-poll] Procesando email, id:', msg.id);

      // ── Sender domain whitelist ───────────────────────────────────────────
      const fromLower   = from.toLowerCase();
      const isKnownSender = ALL_SENDER_DOMAINS.some(d => fromLower.includes(d));
      if (!isKnownSender) {
        console.log('[gmail-poll] Remitente ignorado (no está en whitelist)');
        continue;
      }

      // ── PDF adjuntos: procesar antes que el cuerpo del email ──────────────
      const pdfAttachments = findPdfAttachments(emailData.payload);
      if (pdfAttachments.length > 0) {
        console.log(`[gmail-poll] PDF encontrado en email ${msg.id}: ${pdfAttachments[0].filename}`);
        try {
          const attRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${pdfAttachments[0].attachmentId}`,
            { headers: { Authorization: `Bearer ${newAccessToken}` } },
          );
          if (attRes.ok) {
            const attData   = await attRes.json();
            const b64Data   = attData.data?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
            const txList    = await parsePdfWithGroq(b64Data);
            console.log(`[gmail-poll] PDF parseó ${txList.length} transacciones`);

            for (const tx of txList) {
              if (!tx.monto || !tx.comercio) continue;
              const pdfRawSubject = `pdf_${msg.id}_${normalizeMerchant(tx.comercio)}_${tx.fecha}`;
              const { data: pdfExisting } = await supabase
                .from('pending_transactions')
                .select('id')
                .eq('user_id', userId)
                .eq('raw_subject', pdfRawSubject)
                .maybeSingle();
              if (pdfExisting) continue;

              const ok = await processTransaction(supabase, userId, pdfRawSubject, {
                es_movimiento: true,
                monto:         tx.monto,
                moneda:        tx.moneda ?? 'ARS',
                comercio:      tx.comercio,
                categoria:     'otros',
                clasificacion: 'disposable',
                fecha:         tx.fecha,
                descripcion:   tx.comercio,
              }, {});
              if (ok) newPending++;
            }
            // Marcar email como procesado (vía PDF) para no procesar el body también
            await supabase.from('pending_transactions').upsert({
              user_id:  userId, source: 'gmail',
              amount:   0, raw_subject: msg.id, status: 'confirmed',
            }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });
            continue;
          }
        } catch (pdfErr) {
          console.warn('[gmail-poll] Error procesando PDF, continuando con body del email:', pdfErr);
        }
      }

      // ── Subject keyword filter ────────────────────────────────────────────
      const subjectLower = subject.toLowerCase();
      const isRelevant   = SUBJECT_KEYWORDS.some(k => subjectLower.includes(k));
      if (!isRelevant) {
        console.log('[gmail-poll] Subject no relevante');
        continue;
      }

      const body = extractTextFromEmail(emailData.payload);
      if (!body.trim()) {
        console.log('[gmail-poll] Body vacío');
        continue;
      }

      console.log('[gmail-poll] Body extraído, longitud:', body.length);

      // ── Pre-parse with bank detectors ─────────────────────────────────────
      const detection        = detectBank(from, subject, body);
      const preParsed        = parseEmailFields(detection.profile, subject, body);
      const preParsedContext = buildPreParsedContext(preParsed);

      console.log('[gmail-poll] Banco detectado:', detection.profile?.displayName ?? 'desconocido',
        '| confianza:', detection.confidence,
        '| monto pre-parseado:', preParsed.amount,
        '| warnings:', preParsed.warnings);

      // ── Incoming transfer: store without Groq ─────────────────────────────
      if (preParsed.operationType === 'transferencia_recibida' && preParsed.amount && preParsed.amount > 0) {
        const senderName = preParsed.senderName ?? null;
        const { error: incomingErr } = await supabase.from('pending_transactions').upsert({
          user_id:          userId,
          source:           'gmail',
          direction:        'incoming',
          amount:           preParsed.amount,
          currency:         'ARS',
          merchant:         senderName ?? 'Transferencia recibida',
          sender_name:      senderName,
          transaction_date: preParsed.occurredAt ?? new Date().toISOString().split('T')[0],
          raw_subject:      msg.id,
          status:           'pending',
        }, { onConflict: 'user_id,raw_subject', ignoreDuplicates: true });
        if (incomingErr) {
          console.error('[gmail-poll] Error al insertar incoming transfer:', incomingErr);
        } else {
          console.log('[gmail-poll] Incoming transfer stored:', senderName, preParsed.amount);
          newPending++;
        }
        continue;
      }

      // ── Groq classification ───────────────────────────────────────────────
      const result   = await classifyWithGroq(subject, body, preParsedContext);
      const esValido = result?.es_movimiento === true || result?.es_gasto === true;
      if (!esValido) {
        if (result === null) {
          hadGroqFailure = true;
          console.warn('[gmail-poll] Groq falló para:', subject, '— se reintentará');
        } else {
          console.log('[gmail-poll] Groq descartó el email:', subject);
        }
        continue;
      }

      const ok = await processTransaction(supabase, userId, msg.id, result, preParsed);
      if (ok) newPending++;
    }

    if (!hadGroqFailure) {
      const updates: any = { last_checked_at: new Date().toISOString() };
      if (isBackfill) updates.is_backfill_done = true;
      await supabase.from('gmail_connections').update(updates).eq('user_id', userId);
      console.log('[gmail-poll] last_checked_at avanzado a now()', isBackfill ? '(backfill completado)' : '');
    } else {
      console.warn('[gmail-poll] Groq tuvo fallos — last_checked_at NO avanzado');
    }

    console.log('[gmail-poll] Nuevos auto-registrados:', newPending);

    // ── Push notification si hay nuevos gastos ────────────────────────────
    if (newPending > 0) {
      const supabaseServiceUrl = Deno.env.get('SUPABASE_URL')!;
      const fnSecret           = Deno.env.get('INTERNAL_FN_SECRET');
      const plural = newPending > 1 ? `${newPending} gastos nuevos` : `1 gasto nuevo`;
      await fetch(`${supabaseServiceUrl}/functions/v1/send-push`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${fnSecret}`,
        },
        body: JSON.stringify({
          userId,
          title: `🔍 Detectamos ${plural} de tu Gmail`,
          body:  'Tu presupuesto se actualizó automáticamente. Tocá para revisar.',
          data:  { route: '/(app)/expenses' },
        }),
      }).catch(err => console.warn('[gmail-poll] push error:', err));
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentList } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false });

    return new Response(JSON.stringify({
      gmail_connected: true,
      gmail_email:     connection.gmail_email,
      new_found:       newPending,
      pending:         recentList ?? [],
      backfill_done:   isBackfill,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[gmail-poll] Error general:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
