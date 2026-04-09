import type { ParsedEmailFields, OperationType, ConfidenceLevel } from './types.ts';
import type { BankProfile } from './bankDetector.ts';

// ── Amount parsing ────────────────────────────────────────────────────────────
// Handles: $350.000,00 | $ 350.000 | ARS 350.000,00 | 350000.00
export function parseAmount(text: string): { value: number | null; confidence: ConfidenceLevel } {
  // Pattern 1: $ 350.000,00 or $350.000,00 (Argentine standard with currency symbol)
  const arPattern = /(?:\$|ARS)\s*([\d]{1,3}(?:\.[\d]{3})*(?:,[\d]{1,2})?)/gi;
  // Pattern 2: grouped number like 350.000,00 without currency symbol
  const groupedPattern = /\b([\d]{1,3}(?:\.[\d]{3})+(?:,[\d]{1,2})?)\b/g;

  const candidates: Array<{ value: number; confidence: ConfidenceLevel }> = [];

  let match: RegExpExecArray | null;
  const re1 = /(?:\$|ARS)\s*([\d]{1,3}(?:\.[\d]{3})*(?:,[\d]{1,2})?)/gi;
  while ((match = re1.exec(text)) !== null) {
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0) {
      candidates.push({ value, confidence: 'high' });
    }
  }

  if (candidates.length > 0) {
    // Return the largest amount found (usually the transaction amount)
    candidates.sort((a, b) => b.value - a.value);
    return candidates[0];
  }

  const re2 = /\b([\d]{1,3}(?:\.[\d]{3})+(?:,[\d]{1,2})?)\b/g;
  while ((match = re2.exec(text)) !== null) {
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0) {
      candidates.push({ value, confidence: 'medium' });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.value - a.value);
    return candidates[0];
  }

  return { value: null, confidence: 'low' };
}

// ── Date parsing ──────────────────────────────────────────────────────────────
const MONTHS_ES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05',
  jun: '06', jul: '07', ago: '08', sep: '09', oct: '10',
  nov: '11', dic: '12',
};

export function parseDate(text: string): { value: string | null; confidence: ConfidenceLevel } {
  // "Datos al: 08/04/2026 09:51" — Banco Patagonia and similar
  let m = text.match(/datos\s+al[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, confidence: 'high' };

  // ISO format: 2026-04-08
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { value: `${m[1]}-${m[2]}-${m[3]}`, confidence: 'high' };

  // Argentine dd/mm/yyyy
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, confidence: 'high' };

  // Argentine dd-mm-yyyy
  m = text.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
  if (m) return { value: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, confidence: 'high' };

  // "8 de abril de 2026" or "8 de abril 2026"
  m = text.match(/\b(\d{1,2})\s+de\s+(\w+)\s+(?:de\s+)?(\d{4})\b/i);
  if (m) {
    const month = MONTHS_ES[m[2].toLowerCase()];
    if (month) return { value: `${m[3]}-${month}-${m[1].padStart(2, '0')}`, confidence: 'high' };
  }

  return { value: null, confidence: 'low' };
}

// ── CBU/CVU parsing ───────────────────────────────────────────────────────────
export function parseCBU(text: string): string | null {
  // CBU and CVU are always 22 digits
  const m = text.match(/\b(?:CBU|CVU)[:\s]+(\d{22})\b/i);
  return m ? m[1] : null;
}

// ── Transaction ID parsing ────────────────────────────────────────────────────
export function parseTransactionId(text: string): string | null {
  const patterns = [
    /n[uú]mero\s+de\s+transacci[oó]n[:\s]+(\d+)/i,
    /n[uú]mero\s+de\s+operaci[oó]n[:\s]+(\d+)/i,
    /n[°º\.]\s*(?:de\s+)?operaci[oó]n[:\s]+(\d+)/i,
    /id\s+(?:de\s+)?operaci[oó]n[:\s]+(\d+)/i,
    /c[oó]digo\s+(?:de\s+)?operaci[oó]n[:\s]+(\d+)/i,
    /comprobante\s+n[°º]?[:\s]+(\d+)/i,
    /referencia[:\s]+(\d+)/i,
    /\btransacci[oó]n[:\s]+(\d+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── Account number parsing ────────────────────────────────────────────────────
export function parseAccountNumber(text: string): string | null {
  // "CA $ 043439867223000" or "CC $ 043..." or "Cuenta de origen: CA ..."
  const m = text.match(/\b(?:CA|CC|CTA)\s*\$?\s*([0-9]{6,})\b/i);
  return m ? m[1] : null;
}

// ── Operation type detection ──────────────────────────────────────────────────
export function detectOperationType(subject: string, body: string): OperationType {
  const text = `${subject} ${body}`;

  if (/recibi(?:ste|[oó])?\s+(?:una\s+)?transferencia|acreditaci[oó]n|se\s+acredit[oó]|ingres[oó]\s+(?:un\s+)?pago/i.test(text)) {
    return 'transferencia_recibida';
  }
  if (/env[íi]a\s+este\s+mensaje|aviso\s+de\s+transferencia|transferencia\s+enviada|transferiste|envi[oó]\s+(?:una\s+)?transferencia/i.test(text)) {
    return 'transferencia_enviada';
  }
  if (/d[eé]bito\s+autom[aá]tico|d[eé]bito\s+directo|d[eé]bit[oó]\s+de\s+tu\s+cuenta/i.test(text)) {
    return 'debito';
  }
  if (/compraste|consumo\s+con|compra\s+con|pagaste\s+en|pago\s+en\s+comercio/i.test(text)) {
    return 'compra';
  }
  if (/pagaste|realiz(?:aste|[oó])\s+un\s+pago/i.test(text)) {
    return 'pago';
  }
  if (/se\s+acredit[oó]|acreditaci[oó]n/i.test(text)) {
    return 'acreditacion';
  }
  if (/aviso|movimiento|notificaci[oó]n/i.test(text)) {
    return 'aviso_movimiento';
  }
  return 'desconocido';
}

// ── Name extraction ───────────────────────────────────────────────────────────
export function parsePersonName(body: string): { sender: string | null; recipient: string | null } {
  let sender: string | null = null;
  let recipient: string | null = null;

  // "BALLERINI, FRANCO envía este mensaje desde ..." — Banco Patagonia pattern
  let m = body.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,\.]{2,})\s+env[íi]a\s+este\s+mensaje/);
  if (m) sender = m[1].replace(/,\s*$/, '').trim();

  // "para: NOMBRE" or "destinatario: NOMBRE"
  m = body.match(/(?:para|destinatario)[:\s]+([A-ZÁÉÍÓÚÑA-Za-záéíóúñ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s\.]{2,})/i);
  if (m) recipient = m[1].trim().split('\n')[0].trim();

  // "Transferencia a: NOMBRE" or "Enviada a: NOMBRE"
  if (!recipient) {
    m = body.match(/(?:transferencia\s+a|enviada?\s+a|acreditada?\s+a)[:\s]+([A-ZÁÉÍÓÚÑA-Za-záéíóúñ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s\.]{2,})/i);
    if (m) recipient = m[1].trim().split('\n')[0].trim();
  }

  return { sender, recipient };
}

// ── Main parser ───────────────────────────────────────────────────────────────
export function parseEmailFields(
  profile: BankProfile | null,
  subject: string,
  body: string,
): ParsedEmailFields {
  const warnings: string[] = [];

  const operationType = detectOperationType(subject, body);
  const { value: amount, confidence: parsedAmountConfidence } = parseAmount(body);
  const { value: occurredAt, confidence: parsedDateConfidence } = parseDate(body);
  const cbuOrCvu = parseCBU(body);
  const transactionId = parseTransactionId(body);
  const originAccount = parseAccountNumber(body);
  const { sender: senderName, recipient: recipientName } = parsePersonName(body);

  if (!amount) warnings.push('No se pudo extraer monto del cuerpo del email');
  if (!occurredAt) warnings.push('No se pudo extraer fecha del cuerpo del email');
  if (operationType === 'desconocido') warnings.push('Tipo de operación no determinado');

  return {
    providerId: profile?.id ?? null,
    providerName: profile?.displayName ?? null,
    sourceType: profile?.sourceType ?? null,
    operationType,
    amount,
    currency: 'ARS',
    originAccount,
    destinationAccount: null,
    cbuOrCvu,
    senderName,
    recipientName,
    transactionId,
    occurredAt,
    description: null,
    detectedProviderConfidence: profile ? 'high' : 'low',
    parsedAmountConfidence,
    parsedDateConfidence,
    requiresManualReview: !amount || !occurredAt || operationType === 'desconocido',
    warnings,
    matchedPattern: operationType !== 'desconocido' ? operationType : null,
  };
}

// ── Groq prompt context builder ───────────────────────────────────────────────
// Builds a pre-context string to include in the Groq prompt when we have pre-parsed data.
// This significantly improves Groq accuracy for Argentine bank emails.
export function buildPreParsedContext(fields: ParsedEmailFields): string {
  if (!fields.providerName && !fields.amount && !fields.occurredAt) return '';

  const parts: string[] = ['PRE-ANÁLISIS AUTOMÁTICO (verificar con el contenido):'];

  if (fields.providerName) {
    parts.push(`- Entidad detectada: ${fields.providerName} (${fields.sourceType === 'bank' ? 'banco' : 'billetera virtual'})`);
  }
  if (fields.amount) {
    parts.push(`- Monto detectado: $${fields.amount.toLocaleString('es-AR')}`);
  }
  if (fields.occurredAt) {
    parts.push(`- Fecha detectada: ${fields.occurredAt}`);
  }
  if (fields.operationType !== 'desconocido') {
    parts.push(`- Tipo de operación detectado: ${fields.operationType.replace(/_/g, ' ')}`);
  }
  if (fields.transactionId) {
    parts.push(`- N° de transacción: ${fields.transactionId}`);
  }
  if (fields.senderName) {
    parts.push(`- Ordenante: ${fields.senderName}`);
  }
  if (fields.recipientName) {
    parts.push(`- Destinatario: ${fields.recipientName}`);
  }
  if (fields.warnings.length > 0) {
    parts.push(`- Advertencias: ${fields.warnings.join(', ')}`);
  }

  return parts.join('\n');
}
