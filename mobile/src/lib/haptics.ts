/**
 * haptics.ts — Wrapper fino sobre expo-haptics.
 *
 * Centraliza los patrones de feedback táctil de la app.
 * Todas las funciones son no-bloqueantes y silenciosas en caso de error
 * (dispositivos sin motor háptico, simuladores, etc.).
 */

import * as Haptics from 'expo-haptics';

/** Toque suave — selección, navegación */
export function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Toque medio — confirmación, clasificación */
export function hapticMedium() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Toque fuerte — logro, meta completada */
export function hapticHeavy() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

/** Notificación de éxito — meta alcanzada, gasto guardado */
export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Notificación de advertencia — presupuesto excedido */
export function hapticWarning() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
