import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Cómo se muestran las notificaciones cuando la app está abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Cancela todas las notificaciones programadas (para reprogramar)
export async function cancelAllScheduled() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// Notificación inmediata (para eventos en tiempo real)
export async function sendLocalNotification(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: null, // inmediata
  });
}

// Alerta de presupuesto: se programa cuando el usuario abre la app
export async function scheduleBudgetAlert(
  spentPct: number,
  remainingAmount: number,
  daysLeftInMonth: number
) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (spentPct >= 1) {
    await sendLocalNotification(
      '⚠️ Te pasaste del presupuesto',
      `Gastaste más de tu ingreso estimado este mes. Revisá tus gastos en SmartPesos.`
    );
    return;
  }

  if (spentPct >= 0.8) {
    await sendLocalNotification(
      '🟡 Casi al límite del mes',
      `Usaste el ${Math.round(spentPct * 100)}% de tu presupuesto y quedan ${daysLeftInMonth} días.`
    );
    return;
  }

  if (spentPct >= 0.6) {
    // Programar recordatorio para mañana a las 9am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📊 Revisá tus gastos',
        body: `Vas en el ${Math.round(spentPct * 100)}% del mes. Te quedan ${formatCurrencySimple(remainingAmount)}.`,
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: tomorrow },
    });
  }
}

// Notificación de suscripción nueva detectada
export async function notifyNewSubscription(name: string, amount: number) {
  await sendLocalNotification(
    '🔄 Suscripción detectada',
    `Detectamos "${name}" como gasto fijo mensual (~${formatCurrencySimple(amount)}/mes). Revisalo en Gastos.`
  );
}

// Notificación de meta alcanzada
export async function notifyGoalReached(goalTitle: string) {
  await sendLocalNotification(
    '🎉 ¡Meta alcanzada!',
    `Llegaste a tu meta "${goalTitle}". ¡Buen trabajo!`
  );
}

// Notificación de progreso de meta (al 50%)
export async function notifyGoalHalfway(goalTitle: string, remaining: number) {
  await sendLocalNotification(
    '💪 Vas por la mitad',
    `Ya llegaste al 50% de "${goalTitle}". Te faltan ${formatCurrencySimple(remaining)}.`
  );
}

// Resumen mensual — se programa el último día del mes a las 20:00
export async function scheduleMonthlyRecap(totalSpent: number, topCategory: string) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  lastDay.setHours(20, 0, 0, 0);

  if (lastDay > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📅 Resumen del mes',
        body: `Gastaste ${formatCurrencySimple(totalSpent)} este mes. Tu categoría más cara: ${topCategory}.`,
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: lastDay },
    });
  }
}

function formatCurrencySimple(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}
