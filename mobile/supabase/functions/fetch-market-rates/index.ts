/**
 * fetch-market-rates — Cron job que actualiza tasas de mercado
 *
 * Fuentes:
 *   - Inflación (IPC): BCRA variable 27
 *   - Tasa Badlar (proxy FCI): BCRA variable 7
 *   - Dólar MEP: Bluelytics
 *
 * Deployar con: npx supabase functions deploy fetch-market-rates
 * Cron sugerido: 0 10 * * 1  (lunes 10am — los datos del BCRA se publican semanalmente)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// IDs de variables BCRA
const BCRA_IPC    = 27; // Inflación mensual (IPC)
const BCRA_BADLAR = 7;  // Tasa Badlar privada (30 días)

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

async function fetchBcraVariable(variableId: number): Promise<number | null> {
  // v2.0/v3.0 fueron discontinuadas por el BCRA (HTTP 410) — confirmado
  // probando directamente contra la API. v4.0 cambia tanto la URL (query
  // params `desde`/`hasta` en vez de path segments) como la forma de la
  // respuesta: ya no es un array plano de {valor}, sino
  // { results: [{ idVariable, detalle: [{fecha, valor}, ...] }] }.
  const url = `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${variableId}?desde=${monthsAgo(2)}&hasta=${today()}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const detalle: { fecha: string; valor: number }[] = json.results?.[0]?.detalle ?? [];
    if (!detalle.length) return null;
    // La API ya lo devuelve más reciente primero, pero no confiamos en el
    // orden — elegimos explícitamente el de fecha más reciente.
    const latest = detalle.reduce((a, b) => (b.fecha > a.fecha ? b : a));
    return latest.valor;
  } catch {
    return null;
  }
}

async function fetchBluelytics(): Promise<{ mep: number | null }> {
  try {
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest');
    if (!res.ok) return { mep: null };
    const json = await res.json();
    return { mep: json.mep?.value_sell ?? null };
  } catch {
    return { mep: null };
  }
}

serve(async (req) => {
  // Secret propio en vez de "Verify JWT" (server-to-server, sin usuario final).
  // Fail-closed: si el secret no está configurado, se rechaza en vez de dejar
  // pasar todo — y la comparación es exacta, no `.includes()` (antes permitía
  // que cualquier header que CONTUVIERA el secret como substring pasara).
  const cronSecret = Deno.env.get('MARKET_RATES_SYNC_SECRET');
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'Secret no configurado' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Permitir llamada manual (GET) o por cron (POST desde Supabase Hooks)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
  const updates: { instrument: string; rate_monthly: number; source: string }[] = [];

  // ── 1. Inflación mensual (IPC) ─────────────────────────────────────────────
  const ipc = await fetchBcraVariable(BCRA_IPC);
  if (ipc !== null) {
    updates.push({ instrument: 'inflation', rate_monthly: ipc, source: 'bcra' });
  }

  // ── 2. Tasa FCI MM (proxy: Badlar + 0.5%) ─────────────────────────────────
  const badlar = await fetchBcraVariable(BCRA_BADLAR);
  if (badlar !== null) {
    // Badlar es TNA → convertir a TEM: (1 + TNA/365)^30 - 1
    const badlarTEM = (Math.pow(1 + badlar / 100 / 365, 30) - 1) * 100;
    const fciTEM    = badlarTEM + 0.5;
    updates.push({ instrument: 'fci_mm', rate_monthly: parseFloat(fciTEM.toFixed(4)), source: 'bcra' });
  }

  // ── 3. Dólar MEP (retorno mensual estimado si persiste devaluación) ─────────
  // No actualizamos MEP aquí — su retorno depende de expectativas, no de precio spot.
  // Se deja como tasa manual.

  // ── 4. PF UVA = inflación + 0.5% real ────────────────────────────────────
  if (ipc !== null) {
    updates.push({ instrument: 'pf_uva', rate_monthly: parseFloat((ipc + 0.5).toFixed(4)), source: 'bcra' });
  }

  if (!updates.length) {
    return new Response(JSON.stringify({ ok: false, message: 'Sin datos de BCRA' }), {
      status: 207,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase
    .from('market_rates')
    .upsert(
      updates.map(u => ({ ...u, updated_at: new Date().toISOString() })),
      { onConflict: 'instrument' },
    );

  if (error) {
    console.error('[fetch-market-rates] DB error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  console.log('[fetch-market-rates] Actualizadas:', updates.map(u => `${u.instrument}=${u.rate_monthly}%`).join(', '));
  return new Response(JSON.stringify({ ok: true, updated: updates }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
