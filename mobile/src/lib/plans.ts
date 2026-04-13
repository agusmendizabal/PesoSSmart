/**
 * Definición de planes de suscripción
 * Fuente de verdad para límites, features y precios.
 */

export type PlanId = 'free' | 'pro' | 'premium';

// ─── Límites de mensajes IA por mes ──────────────────────────────────────────

export const PLAN_MSG_LIMITS: Record<PlanId, number | null> = {
  free:    15,
  pro:     100,
  premium: null,   // ilimitado
};

// ─── Configuración completa de cada plan ─────────────────────────────────────

export interface PlanConfig {
  id: PlanId;
  name: string;
  tagline: string;
  emoji: string;
  color: string;
  price: number | null;     // ARS/mes, null = gratis
  priceLabel: string;
  msgLimit: number | null;  // null = ilimitado
  highlights: string[];     // bullets en la card
  ctaLabel: string;
}

// Colores separados para no depender del módulo theme aquí
const C = {
  neon:    '#C6F135',
  yellow:  '#FFD60A',
  blue:    '#82b1ff',
  gray:    '#6B7280',
};

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id:         'free',
    name:       'Gratis',
    tagline:    'Para empezar a ordenarte',
    emoji:      '🟢',
    color:      C.gray,
    price:      null,
    priceLabel: 'Sin costo',
    msgLimit:   15,
    highlights: [
      'Informe mensual completo',
      '15 mensajes con el asesor IA',
      'Termómetro de inflación personal',
      'Distribución y comparación histórica',
    ],
    ctaLabel:   'Plan actual',
  },
  pro: {
    id:         'pro',
    name:       'Pro',
    tagline:    'Para usuarios que ya usan la app',
    emoji:      '🟡',
    color:      C.yellow,
    price:      3990,
    priceLabel: '$3.990/mes',
    msgLimit:   100,
    highlights: [
      'Todo lo del plan Gratis',
      '100 mensajes con el asesor IA',
      'Análisis más profundo y detallado',
      'Simulaciones de ahorro e inversión',
      'Respuestas personalizadas extendidas',
    ],
    ctaLabel:   'Elegir Pro',
  },
  premium: {
    id:         'premium',
    name:       'Premium',
    tagline:    'Para sacarle el máximo a tu plata',
    emoji:      '🔴',
    color:      C.neon,
    price:      7990,
    priceLabel: '$7.990/mes',
    msgLimit:   null,
    highlights: [
      'Todo lo del plan Pro',
      'Mensajes ilimitados con el asesor',
      'Generación automática de planes financieros',
      'Seguimiento personalizado mes a mes',
      'Estrategias de inversión avanzadas',
      'Acceso anticipado a nuevas funciones',
    ],
    ctaLabel:   'Elegir Premium',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getPlan(id: PlanId): PlanConfig {
  return PLANS[id];
}

export function isLimited(plan: PlanId): boolean {
  return PLAN_MSG_LIMITS[plan] !== null;
}

export function formatMsgLimit(plan: PlanId): string {
  const limit = PLAN_MSG_LIMITS[plan];
  return limit === null ? 'Ilimitados' : `${limit} mensajes`;
}

/**
 * Calcula el plan efectivo teniendo en cuenta expiración.
 * Si el plan tiene fecha de vencimiento y ya pasó → 'free'.
 */
export function resolveEffectivePlan(
  plan: PlanId,
  status: string,
  expiresAt: string | null,
): PlanId {
  if (plan === 'free') return 'free';
  if (status === 'active') return plan;
  if (status === 'trial' && expiresAt) {
    return new Date(expiresAt) > new Date() ? plan : 'free';
  }
  return 'free';
}

/**
 * Días restantes de trial. null si no hay trial activo.
 */
export function trialDaysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
