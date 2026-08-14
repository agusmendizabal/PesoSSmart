import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type BudgetPlan } from './budgetPlan';
import { buildCategoryInsight } from './budgetInsights';

// Show notifications even when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

const STORAGE_KEY  = 'budget_notif_timestamps';
const COOLDOWN_MS  = 24 * 60 * 60 * 1000; // once per category per day

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function checkAndNotifyBudgetLimits(plan: BudgetPlan): Promise<void> {
  const permitted = await requestNotificationPermissions();
  if (!permitted) return;

  const raw  = await AsyncStorage.getItem(STORAGE_KEY);
  const sent: Record<string, number> = raw ? JSON.parse(raw) : {};
  const now  = Date.now();

  // Solo se notifica en el nivel más severo — evita saturar de avisos
  // (atención/oportunidad se ven dentro de la app, no ameritan una push).
  // Y como mucho UNA notificación por corrida, la más relevante — un usuario
  // con 4-5 categorías en alerta a la vez no debería recibir 4-5 pushes juntas.
  const candidates = plan.categories
    .filter(c => c.alertLevel === 'alerta')
    .sort((a, b) => (b.projected - b.avgMonthly) - (a.projected - a.avgMonthly));

  const toNotify = candidates.find(c => now - (sent[c.categoryId] ?? 0) >= COOLDOWN_MS);
  if (!toNotify) return;

  const insight = buildCategoryInsight(toNotify, plan);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${insight.emoji} ${insight.headline} en ${toNotify.name}`,
      body:  insight.body,
      data: {
        screen:     'category-detail',
        categoryId: toNotify.categoryId,
      },
      sound: true,
    },
    trigger: null, // immediate
  });

  sent[toNotify.categoryId] = now;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sent));
}

// Call once at app startup to handle taps on notifications
export function setupNotificationTapHandler(
  onCategoryNotification: (categoryId: string) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as any;
    if (data?.screen === 'category-detail' && data?.categoryId) {
      onCategoryNotification(data.categoryId);
    }
  });
  return () => sub.remove();
}
