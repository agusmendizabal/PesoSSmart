/**
 * Sistema de notificaciones push de SmartPesos.
 *
 * Tipos implementados:
 *  - Diarias:    inactividad (> 2 días sin cargar)
 *  - Eventos:    3er delivery, 80% presupuesto, nueva suscripción, racha rota
 *  - Semanales:  resumen lunes 9am
 *  - Mensuales:  informe día 1, 9am
 *  - Fin de mes: proyección día 25
 *  - Mercado:    dólar +2%, dato INDEC
 */

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Handler global ───────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

// ─── Permisos ─────────────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function fmt(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}

async function send(title: string, body: string, data?: Record<string, any>) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, data },
      trigger: null,
    });
  } catch {
    // Silencioso en Expo Go
  }
}

async function schedule(
  title: string,
  body: string,
  date: Date,
  identifier?: string,
  data?: Record<string, any>,
) {
  try {
    const content: Notifications.NotificationContentInput = { title, body, sound: true, data };
    await Notifications.scheduleNotificationAsync({
      identifier,
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
  } catch {
    // Silencioso en Expo Go
  }
}

async function scheduleWeekly(
  title: string,
  body: string,
  weekday: number, // 1=Lunes … 7=Domingo
  hour: number,
  minute: number,
  identifier: string,
) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, sound: true },
      trigger: {
        type:    Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
      },
    });
  } catch {
    // Silencioso en Expo Go
  }
}

async function scheduleMonthly(
  title: string,
  body: string,
  day: number,
  hour: number,
  minute: number,
  identifier: string,
) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, sound: true },
      trigger: {
        type:  Notifications.SchedulableTriggerInputTypes.MONTHLY,
        day,
        hour,
        minute,
      },
    });
  } catch {
    // Silencioso en Expo Go
  }
}

// ─── DIARIAS — Inactividad ────────────────────────────────────────────────────

const LAST_EXPENSE_KEY = '@smartpesos/last_expense_date';

export async function recordExpenseActivity() {
  const today = new Date().toISOString().slice(0, 10);
  await AsyncStorage.setItem(LAST_EXPENSE_KEY, today);
}

export async function scheduleDailyInactivityCheck() {
  // Programa para 8am de mañana; al abrirse la app se re-evalúa
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  const lastStr = await AsyncStorage.getItem(LAST_EXPENSE_KEY);
  if (!lastStr) return; // nunca cargó nada

  const last    = new Date(lastStr);
  const now     = new Date();
  const daysDiff = Math.floor((now.getTime() - last.getTime()) / 86_400_000);

  if (daysDiff >= 2) {
    await send(
      '📋 ¿Cómo vas este mes?',
      `Hace ${daysDiff} día${daysDiff > 1 ? 's' : ''} que no registrás nada. Tardás menos de un minuto.`,
      { route: '/(app)/expenses' },
    );
  } else {
    await schedule(
      '📋 SmartPesos',
      '¿Ya cargaste tus gastos de hoy?',
      tomorrow,
      'daily_inactivity',
      { route: '/(app)/expenses' },
    );
  }
}

// ─── EVENTO — 3er delivery de la semana ──────────────────────────────────────

const DELIVERY_COUNT_KEY = '@smartpesos/weekly_delivery_count';
const DELIVERY_WEEK_KEY  = '@smartpesos/delivery_week';

export async function trackDeliveryExpense(amount: number) {
  const now         = new Date();
  const weekStr     = `${now.getFullYear()}-W${getWeekNumber(now)}`;
  const savedWeek   = await AsyncStorage.getItem(DELIVERY_WEEK_KEY);
  const savedCount  = parseInt((await AsyncStorage.getItem(DELIVERY_COUNT_KEY)) ?? '0', 10);

  let count = savedWeek === weekStr ? savedCount + 1 : 1;
  await AsyncStorage.setItem(DELIVERY_WEEK_KEY,  weekStr);
  await AsyncStorage.setItem(DELIVERY_COUNT_KEY, String(count));

  if (count === 3) {
    await send(
      '🛵 Tercer delivery de la semana',
      `Llevás ${fmt(amount)} esta semana. ¿Lo tenías presupuestado?`,
      { route: '/(app)/expenses' },
    );
  }
}

function getWeekNumber(date: Date): number {
  const d   = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ─── EVENTO — 80% de presupuesto de categoría ────────────────────────────────

export async function notifyCategoryBudget80(
  categoryName: string,
  spent: number,
  budget: number,
  daysLeft: number,
) {
  const remaining = budget - spent;
  await send(
    `🟡 80% del presupuesto de ${categoryName}`,
    `Usaste el 80% de tu presupuesto de ${categoryName}. Te quedan ${fmt(remaining)} para los próximos ${daysLeft} días.`,
    { route: '/(app)/expenses' },
  );
}

// ─── EVENTO — presupuesto global ──────────────────────────────────────────────

export async function scheduleBudgetAlert(
  spentPct: number,
  remainingAmount: number,
  daysLeftInMonth: number,
) {
  try {
    await Notifications.cancelScheduledNotificationAsync('budget_alert').catch(() => {});

    if (spentPct >= 1) {
      await send('⚠️ Te pasaste del presupuesto', `Gastaste más de tu ingreso estimado este mes. Revisá en SmartPesos.`);
      return;
    }
    if (spentPct >= 0.8) {
      await send(
        '🟡 Casi al límite del mes',
        `Usaste el ${Math.round(spentPct * 100)}% de tu presupuesto y quedan ${daysLeftInMonth} días.`,
      );
      return;
    }
    if (spentPct >= 0.6) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await schedule(
        '📊 Revisá tus gastos',
        `Vas en el ${Math.round(spentPct * 100)}% del mes. Te quedan ${fmt(remainingAmount)}.`,
        tomorrow,
        'budget_alert',
      );
    }
  } catch {
    // Silencioso
  }
}

// ─── EVENTO — Nueva suscripción detectada ────────────────────────────────────

export async function notifyNewSubscription(name: string, amount: number) {
  await send(
    '🔄 Nuevo débito recurrente',
    `Detectamos un nuevo débito de ${fmt(amount)} de "${name}". ¿Lo sumamos a tus gastos fijos?`,
    { route: '/(app)/expenses' },
  );
}

// ─── EVENTO — Metas ───────────────────────────────────────────────────────────

export async function notifyGoalReached(goalTitle: string) {
  await send('🎉 ¡Meta alcanzada!', `Llegaste a tu meta "${goalTitle}". ¡Muy bien!`);
}

export async function notifyGoalHalfway(goalTitle: string, remaining: number) {
  await send('💪 Vas por la mitad', `Ya llegaste al 50% de "${goalTitle}". Te faltan ${fmt(remaining)}.`);
}

// ─── EVENTO — Racha rota ──────────────────────────────────────────────────────

export async function notifyStreakBroken(streakDays: number) {
  await send(
    '🔥 Racha de disposable cortada',
    `Se cortó tu racha de ${streakDays} día${streakDays > 1 ? 's' : ''} sin prescindibles. Arrancás de nuevo mañana.`,
  );
}

export async function notifyStreakMilestone(days: number) {
  const messages: Record<number, string> = {
    3:  '3 días sin prescindibles. ¡Buen arranque!',
    7:  '¡Una semana sin prescindibles! Te estás conociendo.',
    14: '2 semanas. Esto ya es un hábito.',
    30: '¡UN MES! Eso es más de $X recuperados en este período.',
  };
  const body = messages[days];
  if (body) await send('🔥 Racha de ahorro', body);
}

// ─── SEMANALES — Lunes 9am ────────────────────────────────────────────────────

export async function scheduleWeeklySummary() {
  await scheduleWeekly(
    '📅 Tu semana en SmartPesos',
    'Conocé cuánto gastaste esta semana y cómo vas respecto a la anterior.',
    2, // Lunes (1=Dom en algunas librerías — Expo usa 1=Dom, 2=Lun)
    9,
    0,
    'weekly_summary',
  );
}

// ─── MENSUALES — Día 1 ────────────────────────────────────────────────────────

export async function scheduleMonthlyReport() {
  await scheduleMonthly(
    '📊 Informe del mes cerrado',
    'Tu informe de [mes] ya está listo: cuánto gastaste, ahorraste y podés invertir.',
    1,
    9,
    0,
    'monthly_report',
  );
}

// ─── FIN DE MES — Proyección día 25 ──────────────────────────────────────────

export async function scheduleEndOfMonthProjection(
  projected: number,
  budget: number,
) {
  const now = new Date();
  if (now.getDate() > 25 || projected <= budget) return;

  const notifDate = new Date(now.getFullYear(), now.getMonth(), 25, 18, 0, 0);
  if (notifDate < now) return;

  const over = projected - budget;
  await schedule(
    '⚠️ Proyección del mes',
    `A este ritmo cerrarías el mes con ${fmt(projected)} gastados — ${fmt(over)} más de lo planeado.`,
    notifDate,
    'eom_projection',
    { route: '/(app)/expenses?tab=analisis' },
  );
}

// ─── ALERTAS DE MERCADO ───────────────────────────────────────────────────────

const LAST_DOLAR_KEY = '@smartpesos/last_dolar_rate';

export async function checkDolarAlert(currentRate: number) {
  const lastStr = await AsyncStorage.getItem(LAST_DOLAR_KEY);
  await AsyncStorage.setItem(LAST_DOLAR_KEY, String(currentRate));

  if (!lastStr) return;
  const lastRate = parseFloat(lastStr);
  const changePct = ((currentRate - lastRate) / lastRate) * 100;

  if (changePct >= 2) {
    await send(
      '📈 El dólar subió',
      `El dólar subió ${changePct.toFixed(1)}% hoy (${fmt(currentRate)}). ¿Querés ver cómo proteger tus pesos?`,
      { route: '/(app)/simulator' },
    );
  }
}

export async function notifyIndecInflation(month: string, pct: number, capitalLoss: number) {
  await send(
    `📊 Inflación de ${month}`,
    `Inflación del mes: ${pct.toFixed(1)}%. Tu plata perdió ~${fmt(capitalLoss)} de poder adquisitivo.`,
    { route: '/(app)/savings' },
  );
}

// ─── SETUP INICIAL — registrar todo de una ───────────────────────────────────

export async function setupAllScheduledNotifications(opts?: {
  totalThisMonth?: number;
  budget?: number;
  daysLeftInMonth?: number;
}) {
  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return;

  await scheduleWeeklySummary();
  await scheduleMonthlyReport();

  if (opts?.totalThisMonth && opts?.budget && opts?.daysLeftInMonth !== undefined) {
    const spentPct   = opts.totalThisMonth / opts.budget;
    const remaining  = opts.budget - opts.totalThisMonth;
    await scheduleBudgetAlert(spentPct, remaining, opts.daysLeftInMonth);

    const projected = opts.budget > 0
      ? (opts.totalThisMonth / (30 - opts.daysLeftInMonth)) * 30
      : 0;
    await scheduleEndOfMonthProjection(projected, opts.budget);
  }
}
