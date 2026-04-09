import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { parseAmount, parseDate, parseCBU, parseTransactionId, detectOperationType, parseEmailFields } from './bankParsers.ts';
import { detectBank, BANK_REGISTRY } from './bankDetector.ts';

// ── parseAmount ───────────────────────────────────────────────────────────────

Deno.test('parseAmount: formato argentino estándar $350.000,00', () => {
  const { value, confidence } = parseAmount('Importe a transferir: $ 350.000,00');
  assertEquals(value, 350000);
  assertEquals(confidence, 'high');
});

Deno.test('parseAmount: sin separador de miles $14000', () => {
  const { value } = parseAmount('Monto: $14000');
  assertEquals(value, 14000);
});

Deno.test('parseAmount: prefijo ARS con millones', () => {
  const { value } = parseAmount('ARS 1.500.000,50');
  assertEquals(value, 1500000.5);
});

Deno.test('parseAmount: monto muy alto $1.250.000,00', () => {
  const { value } = parseAmount('$ 1.250.000,00');
  assertEquals(value, 1250000);
});

Deno.test('parseAmount: sin monto devuelve null', () => {
  const { value } = parseAmount('Este es un aviso sin monto');
  assertEquals(value, null);
});

// ── parseDate ─────────────────────────────────────────────────────────────────

Deno.test('parseDate: formato Patagonia "Datos al: 08/04/2026"', () => {
  const { value, confidence } = parseDate('Datos al: 08/04/2026 09:51');
  assertEquals(value, '2026-04-08');
  assertEquals(confidence, 'high');
});

Deno.test('parseDate: formato dd/mm/yyyy', () => {
  const { value } = parseDate('Fecha: 08/04/2026');
  assertEquals(value, '2026-04-08');
});

Deno.test('parseDate: formato ISO', () => {
  const { value } = parseDate('2026-04-08T09:51:00');
  assertEquals(value, '2026-04-08');
});

Deno.test('parseDate: mes en español "8 de abril de 2026"', () => {
  const { value } = parseDate('8 de abril de 2026');
  assertEquals(value, '2026-04-08');
});

Deno.test('parseDate: formato dd-mm-yyyy', () => {
  const { value } = parseDate('Fecha 12-03-2026');
  assertEquals(value, '2026-03-12');
});

Deno.test('parseDate: sin fecha devuelve null', () => {
  const { value } = parseDate('Mensaje sin fecha');
  assertEquals(value, null);
});

// ── parseCBU ──────────────────────────────────────────────────────────────────

Deno.test('parseCBU: formato estándar 22 dígitos', () => {
  const cbu = parseCBU('CBU: 0170314440000065489226');
  assertEquals(cbu, '0170314440000065489226');
});

Deno.test('parseCBU: CVU también detectado', () => {
  const cvu = parseCBU('CVU: 0000003100079741076012');
  assertEquals(cvu, '0000003100079741076012');
});

Deno.test('parseCBU: sin CBU devuelve null', () => {
  assertEquals(parseCBU('Sin datos bancarios'), null);
});

// ── parseTransactionId ────────────────────────────────────────────────────────

Deno.test('parseTransactionId: formato Patagonia', () => {
  const id = parseTransactionId('Número de transacción: 1663211721');
  assertEquals(id, '1663211721');
});

Deno.test('parseTransactionId: número de operación', () => {
  const id = parseTransactionId('Número de operación: 987654321');
  assertEquals(id, '987654321');
});

Deno.test('parseTransactionId: sin id devuelve null', () => {
  assertEquals(parseTransactionId('Texto sin identificador'), null);
});

// ── detectOperationType ───────────────────────────────────────────────────────

Deno.test('detectOperationType: aviso transferencia enviada (Patagonia)', () => {
  const op = detectOperationType(
    'AVISO DE TRANSFERENCIA DE FONDOS',
    'BALLERINI, FRANCO envía este mensaje desde Patagonia E-Bank.'
  );
  assertEquals(op, 'transferencia_enviada');
});

Deno.test('detectOperationType: transferencia recibida', () => {
  const op = detectOperationType('Recibiste una transferencia', 'Se acreditó $5.000 en tu cuenta');
  assertEquals(op, 'transferencia_recibida');
});

Deno.test('detectOperationType: compra con tarjeta', () => {
  const op = detectOperationType('Compraste en supermercado', 'Consumo con tu tarjeta');
  assertEquals(op, 'compra');
});

Deno.test('detectOperationType: subject ambiguo no crashea', () => {
  const op = detectOperationType('Notificación importante', 'Movimiento detectado en tu cuenta');
  assertNotEquals(op, undefined);
});

// ── detectBank ────────────────────────────────────────────────────────────────

Deno.test('detectBank: Banco Patagonia por dominio', () => {
  const result = detectBank('no-reply@bancopatagonia.com.ar', 'AVISO', 'Banco Patagonia');
  assertEquals(result.profile?.id, 'patagonia');
  assertEquals(result.confidence, 'high');
  assertEquals(result.matchedBy, 'domain');
});

Deno.test('detectBank: Mercado Pago por dominio', () => {
  const result = detectBank('noreply@mercadopago.com', 'Compraste en un comercio', '');
  assertEquals(result.profile?.id, 'mercadopago');
  assertEquals(result.confidence, 'high');
});

Deno.test('detectBank: Galicia por dominio', () => {
  const result = detectBank('info@galicia.com.ar', 'Transferencia realizada', '');
  assertEquals(result.profile?.id, 'galicia');
});

Deno.test('detectBank: Brubank por dominio', () => {
  const result = detectBank('noreply@brubank.com', 'Transferencia realizada', '');
  assertEquals(result.profile?.id, 'brubank');
});

Deno.test('detectBank: remitente desconocido devuelve null profile', () => {
  const result = detectBank('no-reply@unknown.com', 'mensaje random', 'texto sin banco');
  assertEquals(result.profile, null);
});

Deno.test('detectBank: detección por body cuando no hay dominio conocido', () => {
  const result = detectBank('info@otrodominio.com', 'aviso', 'Banco Patagonia le informa...');
  assertEquals(result.profile?.id, 'patagonia');
  assertEquals(result.matchedBy, 'body');
});

// ── parseEmailFields: integración completa ────────────────────────────────────

Deno.test('parseEmailFields: ejemplo real Banco Patagonia', () => {
  const subject = 'AVISO DE TRANSFERENCIA DE FONDOS';
  const body = `
    Banco Patagonia
    AVISO DE TRANSFERENCIA DE FONDOS
    BALLERINI, FRANCO envía este mensaje desde Patagonia E-Bank.
    Datos al: 08/04/2026 09:51
    Detalle de la Operación:
    Cuenta de origen: CA $ 043439867223000
    CBU: 0170314440000065489226
    Importe a transferir: $ 350.000,00
    Número de transacción: 1663211721
    IMPORTANTE: Este mail no es válido como comprobante de la operación realizada.
  `;

  const patagonia = BANK_REGISTRY.find(b => b.id === 'patagonia')!;
  const result = parseEmailFields(patagonia, subject, body);

  assertEquals(result.amount, 350000);
  assertEquals(result.occurredAt, '2026-04-08');
  assertEquals(result.cbuOrCvu, '0170314440000065489226');
  assertEquals(result.transactionId, '1663211721');
  assertEquals(result.operationType, 'transferencia_enviada');
  assertEquals(result.providerName, 'Banco Patagonia');
  assertEquals(result.sourceType, 'bank');
  assertEquals(result.requiresManualReview, false);
  assertEquals(result.warnings.length, 0);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

Deno.test('edge case: disclaimer no rompe el parsing', () => {
  const body = `
    Importe: $ 5.000,00
    Fecha: 12/03/2026
    IMPORTANTE: Este mail no es válido como comprobante.
    No compartir con terceros.
  `;
  const { value: amount } = parseAmount(body);
  const { value: date } = parseDate(body);
  assertEquals(amount, 5000);
  assertEquals(date, '2026-03-12');
});

Deno.test('edge case: monto sin separador de miles', () => {
  const { value } = parseAmount('Transferencia de $5000 realizada');
  assertEquals(value, 5000);
});

Deno.test('edge case: proveedor null no crashea parseEmailFields', () => {
  const result = parseEmailFields(null, 'Aviso de movimiento', 'Monto: $1.000,00');
  assertEquals(result.providerId, null);
  assertEquals(result.detectedProviderConfidence, 'low');
  assertEquals(result.requiresManualReview, true);
});

Deno.test('edge case: mail HTML limpio (entidades ya resueltas por stripHtml)', () => {
  // stripHtml en gmail-poll ya resuelve &amp; &nbsp; antes de llegar acá
  const body = 'Monto: $ 14.000,00 Fecha: 08/04/2026';
  const { value } = parseAmount(body);
  assertEquals(value, 14000);
});
