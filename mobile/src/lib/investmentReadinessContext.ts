/**
 * investmentReadinessContext.ts
 *
 * Capa de integración de Fase 3 — mismo patrón que
 * `savingsDestinationContext.ts`/`recurringAdjustment.ts`: junta datos reales
 * (market_rates, INDEC, inversiones existentes) sin inventar nada. La lógica
 * de qué hacer con esos datos vive en `investmentCategories.ts`, no acá.
 */

import { supabase } from '@/lib/supabase';
import { INDEC_IPC } from './indecData';
import type { ExistingInvestment } from './investmentCategories';

const supa = supabase as any;

export interface EconomicDataPoint {
  label:     string;
  value:     number;
  unit:      '%';
  /** Período al que corresponde el dato (mes/año para INDEC, "mensual" para tasas vigentes). */
  period:    string;
  source:    string;
  /** ISO. `null` cuando la fuente es un período fijo (INDEC) y no una sincronización con timestamp. */
  updatedAt: string | null;
  stale:     boolean;
}

// El cron de market_rates corre semanalmente (ver market_rates_sync_cron.sql) —
// más de 45 días sin actualizarse es señal de que la sincronización dejó de correr.
const MAX_FRESH_DAYS = 45;

function isStale(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const days = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return days > MAX_FRESH_DAYS;
}

const MONTH_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const MARKET_RATE_LABELS: Record<string, string> = {
  fci_mm:  'Tasa de referencia para liquidez (proxy Badlar + spread)',
  pf_uva:  'Plazo fijo UVA (inflación + spread fijo)',
};

/**
 * Trae los datos económicos reales disponibles, cada uno con fuente y fecha.
 * Nunca inventa un valor: si una fuente no está disponible, simplemente no
 * aparece en el resultado (ver punto 16 — "confianza" baja si faltan datos
 * críticos, no un valor de relleno).
 *
 * Deliberadamente excluye filas de `market_rates` con `source = 'manual'`:
 * esta fase exige fuentes oficiales verificables, y un valor cargado a mano
 * no lo es, aunque tengamos "de dónde viene" en un sentido interno.
 */
export async function fetchEconomicIndicators(): Promise<EconomicDataPoint[]> {
  const points: EconomicDataPoint[] = [];

  // INDEC — inflación real, curada a mano en indecData.ts (ver ese archivo:
  // cada entrada se investiga antes de cargarse, nunca se inventa).
  const latestIndec = INDEC_IPC[INDEC_IPC.length - 1];
  if (latestIndec) {
    points.push({
      label:     'Inflación mensual (IPC nivel general)',
      value:     latestIndec.general,
      unit:      '%',
      period:    `${MONTH_FULL[latestIndec.month - 1]} ${latestIndec.year}`,
      source:    'INDEC',
      updatedAt: null,
      stale:     false,
    });
  }

  // BCRA, vía market_rates — con updated_at real de la última sincronización.
  const { data } = await supa
    .from('market_rates')
    .select('instrument, rate_monthly, source, updated_at')
    .in('instrument', ['fci_mm', 'pf_uva']);

  for (const row of data ?? []) {
    if (row.source !== 'bcra') continue;
    points.push({
      label:     MARKET_RATE_LABELS[row.instrument] ?? row.instrument,
      value:     Number(row.rate_monthly),
      unit:      '%',
      period:    'tasa mensual vigente',
      source:    'BCRA',
      updatedAt: row.updated_at,
      stale:     isStale(row.updated_at),
    });
  }

  return points;
}

/** Inversiones ya registradas por el usuario (tabla `investments`), para el chequeo de concentración. */
export async function fetchExistingInvestments(userId: string): Promise<ExistingInvestment[]> {
  const { data } = await supa
    .from('investments')
    .select('instrument_type, amount')
    .eq('user_id', userId);

  return (data ?? []).map((r: any) => ({
    instrumentType: r.instrument_type,
    amount:         Number(r.amount),
  }));
}
