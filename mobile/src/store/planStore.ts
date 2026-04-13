/**
 * planStore — estado del plan de suscripción y uso del asesor IA.
 *
 * Se carga desde Supabase al iniciar la app (authStore → fetchProfile).
 * Los contadores de uso se actualizan localmente y se persisten con upsert.
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import {
  type PlanId,
  PLAN_MSG_LIMITS,
  resolveEffectivePlan,
  trialDaysLeft,
} from '@/lib/plans';

interface PlanState {
  // Plan
  rawPlan:           PlanId;
  subscriptionStatus:string;
  planExpiresAt:     string | null;
  trialUsed:         boolean;
  trialStartedAt:    string | null;

  // Uso mensual
  msgCount:  number;
  isLoading: boolean;

  // Computados (actualizados internamente)
  effectivePlan:    PlanId;
  msgLimit:         number | null;

  // Acciones
  load:              (userId: string) => Promise<void>;
  incrementUsage:    (userId: string) => Promise<void>;
  canSendMessage:    () => boolean;
  remainingMessages: () => number | null;
  isTrialActive:     () => boolean;
  daysLeftInTrial:   () => number | null;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function computeEffective(raw: PlanId, status: string, expiresAt: string | null): PlanId {
  return resolveEffectivePlan(raw, status, expiresAt);
}

export const usePlanStore = create<PlanState>((set, get) => ({
  rawPlan:            'free',
  subscriptionStatus: 'inactive',
  planExpiresAt:      null,
  trialUsed:          false,
  trialStartedAt:     null,
  msgCount:           0,
  isLoading:          false,
  effectivePlan:      'free',
  msgLimit:           PLAN_MSG_LIMITS.free,

  // ── Carga plan + uso del mes actual ──────────────────────────────────────
  load: async (userId) => {
    set({ isLoading: true });
    try {
      const month = currentMonth();

      const [profileRes, usageRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('subscription_plan, subscription_status, plan_expires_at, trial_used, trial_started_at')
          .eq('id', userId)
          .single(),
        supabase
          .from('ai_usage')
          .select('msg_count')
          .eq('user_id', userId)
          .eq('month', month)
          .maybeSingle(),
      ]);

      const p = profileRes.data;
      if (!p) return;

      const rawPlan           = (p.subscription_plan ?? 'free') as PlanId;
      const subscriptionStatus= p.subscription_status  ?? 'inactive';
      const planExpiresAt     = p.plan_expires_at       ?? null;
      const effective         = computeEffective(rawPlan, subscriptionStatus, planExpiresAt);

      set({
        rawPlan,
        subscriptionStatus,
        planExpiresAt,
        trialUsed:      p.trial_used       ?? false,
        trialStartedAt: p.trial_started_at ?? null,
        msgCount:       usageRes.data?.msg_count ?? 0,
        effectivePlan:  effective,
        msgLimit:       PLAN_MSG_LIMITS[effective],
      });
    } catch (err) {
      console.error('[planStore] load error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  // ── Incrementa el contador de mensajes del mes ────────────────────────────
  incrementUsage: async (userId) => {
    const { msgCount } = get();
    const newCount = msgCount + 1;
    // Optimista
    set({ msgCount: newCount });

    try {
      const month = currentMonth();
      // RPC atómica para evitar race conditions si el usuario envía mensajes rápido
      const { data } = await supabase.rpc('increment_ai_usage', {
        p_user_id: userId,
        p_month:   month,
      });
      // Sincronizar con el valor real del servidor
      if (typeof data === 'number') set({ msgCount: data });
    } catch (err) {
      console.error('[planStore] incrementUsage error:', err);
      // Revertir si falla
      set({ msgCount });
    }
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  canSendMessage: () => {
    const { effectivePlan, msgCount, msgLimit } = get();
    if (effectivePlan === 'premium') return true;
    if (msgLimit === null) return true;
    return msgCount < msgLimit;
  },

  remainingMessages: () => {
    const { effectivePlan, msgCount, msgLimit } = get();
    if (effectivePlan === 'premium' || msgLimit === null) return null;
    return Math.max(0, msgLimit - msgCount);
  },

  isTrialActive: () => {
    const { subscriptionStatus, planExpiresAt } = get();
    return (
      subscriptionStatus === 'trial' &&
      planExpiresAt !== null &&
      new Date(planExpiresAt) > new Date()
    );
  },

  daysLeftInTrial: () => {
    const { isTrialActive, planExpiresAt } = get();
    if (!isTrialActive()) return null;
    return trialDaysLeft(planExpiresAt);
  },
}));
