import type { SourceType, ConfidenceLevel } from './types.ts';

export interface BankProfile {
  id: string;
  displayName: string;
  sourceType: SourceType;
  senderDomains: string[];
  subjectKeywords: RegExp[];
  bodyKeywords: RegExp[];
}

export const BANK_REGISTRY: BankProfile[] = [
  // ── Billeteras digitales ──────────────────────────────────────────────────
  {
    id: 'mercadopago',
    displayName: 'Mercado Pago',
    sourceType: 'wallet',
    senderDomains: ['mercadopago.com', 'mercadolibre.com'],
    subjectKeywords: [/compraste/i, /pagaste/i, /transferiste/i],
    bodyKeywords: [/mercado\s*pago/i],
  },
  {
    id: 'naranjax',
    displayName: 'Naranja X',
    sourceType: 'wallet',
    senderDomains: ['naranjax.com'],
    subjectKeywords: [/pago/i, /compra/i, /transferencia/i],
    bodyKeywords: [/naranja\s*x/i],
  },
  {
    id: 'uala',
    displayName: 'Ualá',
    sourceType: 'wallet',
    senderDomains: ['uala.com.ar'],
    subjectKeywords: [/pago/i, /transferencia/i, /movimiento/i],
    bodyKeywords: [/ual[aá]/i],
  },
  {
    id: 'personal_pay',
    displayName: 'Personal Pay',
    sourceType: 'wallet',
    senderDomains: ['personal-pay.com.ar'],
    subjectKeywords: [/pago/i, /transferencia/i],
    bodyKeywords: [/personal\s*pay/i],
  },
  {
    id: 'modo',
    displayName: 'Modo',
    sourceType: 'wallet',
    senderDomains: ['modo.com.ar'],
    subjectKeywords: [/pago/i, /transferencia/i, /operaci[oó]n/i],
    bodyKeywords: [/\bmodo\b/i],
  },
  {
    id: 'lemon',
    displayName: 'Lemon Cash',
    sourceType: 'wallet',
    senderDomains: ['lemon.me'],
    subjectKeywords: [/pago/i, /compra/i, /transferencia/i],
    bodyKeywords: [/lemon\s*cash/i],
  },
  {
    id: 'prex',
    displayName: 'Prex',
    sourceType: 'wallet',
    senderDomains: ['prexcard.com', 'prex.com.uy'],
    subjectKeywords: [/pago/i, /compra/i, /transferencia/i],
    bodyKeywords: [/\bprex\b/i],
  },
  // ── Bancos digitales ──────────────────────────────────────────────────────
  {
    id: 'brubank',
    displayName: 'Brubank',
    sourceType: 'bank',
    senderDomains: ['brubank.com'],
    subjectKeywords: [/pago/i, /transferencia/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/brubank/i],
  },
  {
    id: 'reba',
    displayName: 'Reba',
    sourceType: 'bank',
    senderDomains: ['reba.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /movimiento/i],
    bodyKeywords: [/\breba\b/i],
  },
  // ── Bancos tradicionales ──────────────────────────────────────────────────
  {
    id: 'patagonia',
    displayName: 'Banco Patagonia',
    sourceType: 'bank',
    senderDomains: ['bancopatagonia.com.ar', 'patagonia.com.ar'],
    subjectKeywords: [/transferencia/i, /aviso/i, /fondos/i, /operaci[oó]n/i, /acreditaci[oó]n/i],
    bodyKeywords: [/banco\s*patagonia/i, /patagonia\s*e-?bank/i, /aviso\s*de\s*transferencia\s*de\s*fondos/i],
  },
  {
    id: 'galicia',
    displayName: 'Banco Galicia',
    sourceType: 'bank',
    senderDomains: ['galicia.com.ar', 'bancogalicia.com.ar'],
    subjectKeywords: [/transferencia/i, /consumo/i, /d[eé]bito/i, /pago/i, /acreditaci[oó]n/i],
    bodyKeywords: [/banco\s*galicia/i, /galicia\s*m[aá]s/i],
  },
  {
    id: 'santander',
    displayName: 'Banco Santander',
    sourceType: 'bank',
    senderDomains: ['santander.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i, /operaci[oó]n/i],
    bodyKeywords: [/santander/i],
  },
  {
    id: 'bbva',
    displayName: 'BBVA',
    sourceType: 'bank',
    senderDomains: ['bbva.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i, /operaci[oó]n/i],
    bodyKeywords: [/bbva/i, /franc[eé]s/i],
  },
  {
    id: 'macro',
    displayName: 'Banco Macro',
    sourceType: 'bank',
    senderDomains: ['macro.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i, /operaci[oó]n/i],
    bodyKeywords: [/banco\s*macro/i, /\bmacro\b/i],
  },
  {
    id: 'icbc',
    displayName: 'ICBC',
    sourceType: 'bank',
    senderDomains: ['icbc.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/\bicbc\b/i],
  },
  {
    id: 'supervielle',
    displayName: 'Banco Supervielle',
    sourceType: 'bank',
    senderDomains: ['supervielle.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i, /operaci[oó]n/i],
    bodyKeywords: [/supervielle/i],
  },
  {
    id: 'credicoop',
    displayName: 'Banco Credicoop',
    sourceType: 'bank',
    senderDomains: ['bancocredicoop.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/credicoop/i],
  },
  {
    id: 'hsbc',
    displayName: 'HSBC',
    sourceType: 'bank',
    senderDomains: ['hsbc.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/\bhsbc\b/i],
  },
  {
    id: 'nacion',
    displayName: 'Banco Nación',
    sourceType: 'bank',
    senderDomains: ['bna.com.ar', 'bancona.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i, /acreditaci[oó]n/i],
    bodyKeywords: [/banco\s*naci[oó]n/i, /\bbna\b/i],
  },
  {
    id: 'provincia',
    displayName: 'Banco Provincia',
    sourceType: 'bank',
    senderDomains: ['bapro.com.ar', 'bancoprovincia.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/banco\s*provincia/i, /\bbapro\b/i],
  },
  {
    id: 'ciudad',
    displayName: 'Banco Ciudad',
    sourceType: 'bank',
    senderDomains: ['bancociudad.com.ar'],
    subjectKeywords: [/transferencia/i, /pago/i, /consumo/i, /d[eé]bito/i],
    bodyKeywords: [/banco\s*ciudad/i],
  },
];

// Flat list of all known sender domains — used in gmail-poll for fast whitelist check
export const ALL_SENDER_DOMAINS: string[] = [
  ...new Set(BANK_REGISTRY.flatMap(b => b.senderDomains)),
  'getnet.com.ar',
  'prismamediosdepago.com',
  'bancosantacruz.com.ar',
];

export interface DetectionResult {
  profile: BankProfile | null;
  confidence: ConfidenceLevel;
  matchedBy: 'domain' | 'body' | 'subject' | null;
}

export function detectBank(from: string, subject: string, body: string): DetectionResult {
  const fromLower = from.toLowerCase();

  // 1. Domain match — highest confidence
  for (const profile of BANK_REGISTRY) {
    if (profile.senderDomains.some(d => fromLower.includes(d))) {
      return { profile, confidence: 'high', matchedBy: 'domain' };
    }
  }

  // 2. Body keyword match — medium confidence
  for (const profile of BANK_REGISTRY) {
    if (profile.bodyKeywords.some(r => r.test(body))) {
      return { profile, confidence: 'medium', matchedBy: 'body' };
    }
  }

  // 3. Subject keyword match — low confidence
  for (const profile of BANK_REGISTRY) {
    if (profile.subjectKeywords.some(r => r.test(subject))) {
      return { profile, confidence: 'low', matchedBy: 'subject' };
    }
  }

  return { profile: null, confidence: 'low', matchedBy: null };
}
