/**
 * fetch-market-rates — Cron job semanal que actualiza tasas de mercado
 *
 * Fuentes:
 *   - Inflación (IPC):    BCRA variable 27  (fallback; indec-sync es más autoritativo)
 *   - Tasa Badlar:        BCRA variable 7   (proxy FCI MM y tasas derivadas)
 *   - PF 30d retail:      BCRA variable 6   (depósitos hasta $1M, 30-44 días)
 *
 * Derivaciones (donde no hay API pública gratuita directa):
 *   - fci_mm      = Badlar TEM + 0.5%   (spread histórico fondos vs depósitos grandes)
 *   - caucion_1d  = FCI MM - 0.2%       (garantizada por títulos, tracks FCI de cerca)
 *   - cuenta_rem  = FCI MM - 0.5%       (bancos pagan menos que fondos)
 *   - lecap       = FCI MM + 0.3%       (bonos cortos del Tesoro, spread positivo)
 *   - pf_uva      = IPC + 0.5%          (PF UVA ajusta por inflación real + tasa real mínima)
 *
 * Cron: lunes 10:00 UTC (BCRA publica series semanalmente)
 * Deploy: npx supabase functions deploy fetch-market-rates
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// IDs de variables BCRA (API v4.0/monetarias)
const BCRA_IPC       = 27; // Inflación mensual (IPC)
const BCRA_BADLAR    = 7;  // Tasa Badlar privada (TNA, depósitos > $1M, 30 días)
const BCRA_PF_RETAIL = 6;  // TNA depósitos a plazo, hasta $1M, 30-44 días, bancos privados

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** Convierte TNA (%) a TEM (%) asumiendo 30 días */
function tnaToTem(tna: number): number {
  return (Math.pow(1 + tna / 100 / 365, 30) - 1) * 100;
}

async function fetchBcraVariable(variableId: number): Promise<number | null> {
  const url = `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${variableId}?desde=${monthsAgo(2)}&hasta=${today()}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const detalle: { fecha: string; valor: number }[] = json.results?.[0]?.detalle ?? [];
    if (!detalle.length) return null;
    const latest = detalle.reduce((a, b) => (b.fecha > a.fecha ? b : a));
    return latest.valor;
  } catch {
    return null;
  }
}

serve(async (req) => {
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
  const updates: { instrument: string; rate_monthly: number; source: string }[] = [];
  const log: string[] = [];

  // ── 1. Inflación mensual (IPC) via BCRA ────────────────────────────────────
  // indec-sync es más autoritativo (datos.gob.ar INDEC oficial), pero este
  // cron corre semanalmente y sirve de fallback entre las publicaciones mensuales.
  const ipc = await fetchBcraVariable(BCRA_IPC);
  if (ipc !== null) {
    updates.push({ instrument: 'inflation', rate_monthly: ipc, source: 'bcra' });
    log.push(`inflation (BCRA): ${ipc}%`);
  } else {
    log.push('inflation: no data from BCRA');
  }

  // ── 2. FCI Money Market (proxy: Badlar TEM + 0.5%) ────────────────────────
  const badlar = await fetchBcraVariable(BCRA_BADLAR);
  if (badlar !== null) {
    const badlarTEM = tnaToTem(badlar);
    const fciTEM    = badlarTEM + 0.5;

    updates.push({ instrument: 'fci_mm', rate_monthly: parseFloat(fciTEM.toFixed(4)), source: 'bcra' });
    log.push(`fci_mm (Badlar ${badlar.toFixed(2)}% TNA → TEM ${badlarTEM.toFixed(4)}% + 0.5%): ${fciTEM.toFixed(4)}%`);

    // 2a. PF UVA = IPC + 0.5% real (solo si tenemos IPC)
    if (ipc !== null) {
      const pfUva = parseFloat((ipc + 0.5).toFixed(4));
      updates.push({ instrument: 'pf_uva', rate_monthly: pfUva, source: 'bcra' });
      log.push(`pf_uva (IPC ${ipc}% + 0.5%): ${pfUva}%`);
    }

    // 2b. Tasas derivadas de FCI MM (sin API pública gratuita directa)
    // Las relaciones son empíricas y estables en el mercado argentino:
    //   Caución 1d ~ FCI MM - 0.2%  (repos garantizados, tracks FCI de cerca)
    //   Cta. remunerada ~ FCI MM - 0.5% (bancos pagan menos que fondos de inversión)
    //   Lecap ~ FCI MM + 0.3%  (bonos del Tesoro corto, prima de liquidez positiva)
    const caucTEM  = Math.max(0, fciTEM - 0.2);
    const cremTEM  = Math.max(0, fciTEM - 0.5);
    const lecapTEM = fciTEM + 0.3;

    updates.push({ instrument: 'caucion_1d',        rate_monthly: parseFloat(caucTEM.toFixed(4)),  source: 'bcra_derived' });
    updates.push({ instrument: 'cuenta_remunerada', rate_monthly: parseFloat(cremTEM.toFixed(4)),  source: 'bcra_derived' });
    updates.push({ instrument: 'lecap_monthly',     rate_monthly: parseFloat(lecapTEM.toFixed(4)), source: 'bcra_derived' });
    log.push(`caucion_1d: ${caucTEM.toFixed(4)}% | cuenta_remunerada: ${cremTEM.toFixed(4)}% | lecap_monthly: ${lecapTEM.toFixed(4)}%`);
  } else {
    log.push('badlar: no data from BCRA — skipping fci_mm + derived rates');
  }

  // ── 3. PF 30d retail (BCRA variable 6 — TNA depósitos hasta $1M, 30-44 días) ─
  // Dato real del BCRA, más preciso que la derivación de Badlar para este segmento.
  const pfRetailTNA = await fetchBcraVariable(BCRA_PF_RETAIL);
  if (pfRetailTNA !== null) {
    const pfTEM = tnaToTem(pfRetailTNA);
    updates.push({ instrument: 'pf_30d', rate_monthly: parseFloat(pfTEM.toFixed(4)), source: 'bcra' });
    log.push(`pf_30d (BCRA var6 ${pfRetailTNA.toFixed(2)}% TNA → TEM): ${pfTEM.toFixed(4)}%`);
  } else {
    log.push('pf_30d: no data from BCRA variable 6');
  }

  if (!updates.length) {
    return new Response(JSON.stringify({ ok: false, message: 'Sin datos de BCRA', log }), {
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
    return new Response(JSON.stringify({ ok: false, error: error.message, log }), { status: 500 });
  }

  const summary = updates.map(u => `${u.instrument}=${u.rate_monthly}% (${u.source})`).join(', ');
  console.log('[fetch-market-rates] Actualizadas:', summary);
  return new Response(JSON.stringify({ ok: true, updated: updates, log }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
