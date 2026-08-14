/**
 * Feature flags temporales.
 */

/** El asesor IA (chat) todavía no está terminado — oculto en la UI hasta que esté listo. */
export const ADVISOR_ENABLED = false;

/** CTA de reemplazo para los lugares que apuntaban al asesor mientras está oculto. */
export const ADVISOR_FALLBACK_CTA = { label: 'Ver análisis', route: '/(app)/reports' } as const;
