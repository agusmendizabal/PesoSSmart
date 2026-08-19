// indec-sync — sincroniza IPC general INDEC desde datos.gob.ar
// Se ejecuta mensualmente vía pg_cron (día 16 a las 12:00 UTC)
// Las categorías (inflation_food, etc.) se actualizan con el SQL mensual manual.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const cronSecret = Deno.env.get('INDEC_SYNC_SECRET');
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'Secret no configurado' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const updates: { instrument: string; rate_monthly: number; label: string }[] = [];
  const log: string[] = [];

  // ── IPC General desde datos.gob.ar ────────────────────────────────────────
  // Serie: 148.3_INIVELNAL_DICI_M_26 — índice base dic 2016 (nivel, no variación)
  // Variación mensual = (índice actual / índice anterior - 1) × 100
  try {
    const res = await fetchWithTimeout(
      'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&limit=2&sort=desc&format=json',
      10000,
    );
    if (res.ok) {
      const json = await res.json();
      const data: [string, number][] = json?.data ?? [];
      if (data.length >= 2) {
        const monthly = +((data[0][1] / data[1][1] - 1) * 100).toFixed(2);
        updates.push({ instrument: 'inflation', rate_monthly: monthly, label: 'IPC Nivel General' });
        log.push(`IPC general: ${monthly}% (período ${data[0][0]})`);
      } else {
        log.push('datos.gob.ar: menos de 2 puntos, no se pudo calcular variación');
      }
    } else {
      log.push(`datos.gob.ar HTTP ${res.status}`);
    }
  } catch (e) {
    log.push(`Error datos.gob.ar: ${e}`);
  }

  // ── IPC Núcleo (inflación subyacente) ──────────────────────────────────────
  try {
    const res = await fetchWithTimeout(
      'https://apis.datos.gob.ar/series/api/series/?ids=148.3_INUCLEONAL_DICI_M_19&limit=2&sort=desc&format=json',
      10000,
    );
    if (res.ok) {
      const json = await res.json();
      const data: [string, number][] = json?.data ?? [];
      if (data.length >= 2) {
        const monthly = +((data[0][1] / data[1][1] - 1) * 100).toFixed(2);
        updates.push({ instrument: 'inflation_core', rate_monthly: monthly, label: 'IPC Núcleo' });
        log.push(`IPC núcleo: ${monthly}%`);
      }
    }
  } catch (e) {
    log.push(`Error IPC núcleo: ${e}`);
  }

  if (updates.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No se obtuvieron datos del INDEC', log }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  // ── Upsert en market_rates ─────────────────────────────────────────────────
  const now = new Date().toISOString();
  const upserted: string[] = [];

  for (const row of updates) {
    const { error } = await sb.from('market_rates').upsert(
      { ...row, updated_at: now },
      { onConflict: 'instrument' },
    );
    if (!error) upserted.push(`${row.instrument}=${row.rate_monthly}`);
    else log.push(`DB error ${row.instrument}: ${error.message}`);
  }

  return new Response(
    JSON.stringify({ upserted, log }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
