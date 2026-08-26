import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { FinancialDiagnosis } from '@/lib/financialDiagnosis';

interface AINarrativeResult {
  narrative:  string;
  keyFinding: string;
  nextStep:   string;
  isLoading:  boolean;
}

const CACHE_PREFIX = '@nomi/ai_narrative_';

// Deduplica pedidos en vuelo dentro de la misma sesión (ej. Home y Reportes
// montándose casi al mismo tiempo) para no pegarle dos veces al edge function
// — generate_report SÍ consume cupo mensual del asesor, a diferencia de
// generate_welcome.
const inFlight = new Map<string, Promise<{ narrative: string; keyFinding: string; nextStep: string }>>();

async function fetchNarrative(userId: string, reportPayload: Record<string, any>, signal: AbortSignal) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('no-session');

  const res = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-advisor`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        generate_report: true,
        user_id:         userId,
        report_context:  reportPayload,
      }),
    },
  );
  if (!res.ok) throw new Error(`ai-advisor ${res.status}`);
  const data = await res.json();
  return {
    narrative:  data.narrative   ?? '',
    keyFinding: data.key_finding ?? '',
    nextStep:   data.next_step   ?? '',
  };
}

/**
 * Genera (o recupera del caché) la narrativa IA del mes para un usuario.
 * Cacheada por usuario+mes en AsyncStorage: como generate_report consume
 * cupo del plan del usuario, se pide como máximo una vez por mes sin
 * importar cuántas pantallas (Home, Reportes) la consuman.
 */
export function useAINarrative(
  diagnosis: FinancialDiagnosis | null | undefined,
  userId:    string | undefined,
  month:     number,
  year:      number,
): AINarrativeResult {
  const [narrative,  setNarrative]  = useState('');
  const [keyFinding, setKeyFinding] = useState('');
  const [nextStep,   setNextStep]   = useState('');
  const [isLoading,  setIsLoading]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = userId ? `${CACHE_PREFIX}${userId}_${year}-${String(month).padStart(2, '0')}` : null;

  useEffect(() => {
    if (!diagnosis || !userId || !cacheKey) return;

    let cancelled = false;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (!cancelled) {
            setNarrative(cached.narrative ?? '');
            setKeyFinding(cached.keyFinding ?? '');
            setNextStep(cached.nextStep ?? '');
          }
          return;
        }

        setIsLoading(true);

        let pending = inFlight.get(cacheKey);
        if (!pending) {
          pending = fetchNarrative(userId, diagnosis.reportPayload, ctrl.signal);
          inFlight.set(cacheKey, pending);
          pending.finally(() => inFlight.delete(cacheKey));
        }

        const result = await pending;
        if (cancelled || ctrl.signal.aborted) return;

        setNarrative(result.narrative);
        setKeyFinding(result.keyFinding);
        setNextStep(result.nextStep);
        AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => {});
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.warn('[useAINarrative]', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; ctrl.abort(); };
  }, [diagnosis?.healthScore, userId, cacheKey]);

  return { narrative, keyFinding, nextStep, isLoading };
}
