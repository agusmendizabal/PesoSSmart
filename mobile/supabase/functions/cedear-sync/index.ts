// cedear-sync — trackea el retorno real del último mes cerrado para cada CEDEAR/acción
// de rubro usado en "¿qué podrías haber hecho con esa plata?" (src/lib/investmentData.ts).
// Se ejecuta mensualmente vía pg_cron, apenas cierra el mes (día 2, 12:00 UTC).
//
// Fuentes:
//   - Precio del activo: Yahoo Finance chart API (CEDEARs en USD, acciones locales en ARS)
//   - Dólar MEP: ArgentinaDatos API (cotizaciones/dolares/bolsa)
//
// Para CEDEARs (USD): retorno ARS ≈ (1 + retorno USD) × (1 + variación MEP del mes) − 1
// Para acciones locales en BYMA (YPF, IRSA, Pampa, Cresud): retorno directo en ARS, sin ajuste.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SectorTicker {
  /** Debe coincidir con el `id` del instrumento en src/lib/investmentData.ts */
  instrument:  string;
  yahooSymbol: string;
  label:       string;
  /** true = acción argentina en BYMA (ARS directo) · false = CEDEAR (necesita ajuste MEP) */
  isLocal:     boolean;
}

const TICKERS: SectorTicker[] = [
  { instrument: 'sector_autos',               yahooSymbol: 'RACE',    label: 'Ferrari',          isLocal: false },
  { instrument: 'sector_autos_tsla',          yahooSymbol: 'TSLA',    label: 'Tesla',            isLocal: false },
  { instrument: 'sector_energia',             yahooSymbol: 'YPFD.BA', label: 'YPF',              isLocal: true  },
  { instrument: 'sector_energia_pamp',        yahooSymbol: 'PAMP.BA', label: 'Pampa Energía',    isLocal: true  },
  { instrument: 'sector_realestate',          yahooSymbol: 'IRSA.BA', label: 'IRSA',             isLocal: true  },
  { instrument: 'sector_realestate_cres',     yahooSymbol: 'CRES.BA', label: 'Cresud',           isLocal: true  },
  { instrument: 'sector_tech',                yahooSymbol: 'AAPL',    label: 'Apple',            isLocal: false },
  { instrument: 'sector_tech_nvda',           yahooSymbol: 'NVDA',    label: 'Nvidia',           isLocal: false },
  { instrument: 'sector_moda',                yahooSymbol: 'NKE',     label: 'Nike',             isLocal: false },
  { instrument: 'sector_moda_lulu',           yahooSymbol: 'LULU',    label: 'Lululemon',        isLocal: false },
  { instrument: 'sector_gastronomia',         yahooSymbol: 'MCD',     label: "McDonald's",       isLocal: false },
  { instrument: 'sector_gastronomia_ko',      yahooSymbol: 'KO',      label: 'Coca-Cola',        isLocal: false },
  { instrument: 'sector_entretenimiento',     yahooSymbol: 'NFLX',    label: 'Netflix',          isLocal: false },
  { instrument: 'sector_entretenimiento_dis', yahooSymbol: 'DIS',     label: 'Disney',           isLocal: false },
  { instrument: 'sector_viajes',              yahooSymbol: 'ABNB',    label: 'Airbnb',           isLocal: false },
  { instrument: 'sector_viajes_bkng',         yahooSymbol: 'BKNG',    label: 'Booking Holdings', isLocal: false },
];

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }).finally(() => clearTimeout(timer));
}

async function fetchYahooMonthlyCloses(symbol: string, period1: number, period2: number) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1mo`;
  const res = await fetchWithTimeout(url, 10000);
  const raw = await res.text();
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const json = JSON.parse(raw);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo sin result: ${JSON.stringify(json?.chart?.error ?? json).slice(0, 200)}`);
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((ts, i) => ({ date: new Date(ts * 1000), close: closes[i] }))
    .filter((p): p is { date: Date; close: number } => p.close != null);
}

/** Cotización venta del dólar MEP en una fecha (YYYY-MM-DD). Si el mercado estuvo cerrado, retrocede hasta 6 días. */
async function fetchMepVenta(dateStr: string): Promise<number | null> {
  const d = new Date(dateStr + 'T00:00:00Z');
  for (let i = 0; i < 6; i++) {
    const y   = d.getUTCFullYear();
    const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    try {
      const res = await fetchWithTimeout(`https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa/${y}/${m}/${day}`, 8000);
      if (res.ok) {
        const json = await res.json();
        if (json?.venta) return Number(json.venta);
      }
    } catch { /* probar el día anterior */ }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const cronSecret = Deno.env.get('CEDEAR_SYNC_SECRET');
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

  const now = new Date();
  // Mes recién cerrado = mes anterior al actual.
  const prevMonthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const prevMonthStart = new Date(Date.UTC(prevMonthEnd.getUTCFullYear(), prevMonthEnd.getUTCMonth(), 1));
  const baseMonthEnd   = new Date(Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth(), 0));
  const baseMonthStart = new Date(Date.UTC(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth() - 1, 1));

  // Yahoo arma los "baldes" mensuales a partir de la fecha exacta de period1 — tiene
  // que ser el día 1 de un mes para que devuelva un cierre limpio por cada mes calendario.
  const period1 = Math.floor(baseMonthStart.getTime() / 1000);
  const period2 = Math.floor(prevMonthEnd.getTime() / 1000) + 5 * 86400;

  const log: string[] = [];

  // Variación real del dólar MEP en el mes recién cerrado — se calcula una sola vez
  // y se reutiliza para todos los CEDEARs (los activos locales no la necesitan).
  const mepBase = await fetchMepVenta(baseMonthEnd.toISOString().slice(0, 10));
  const mepPrev = await fetchMepVenta(prevMonthEnd.toISOString().slice(0, 10));
  const mepDeltaPct = (mepBase && mepPrev) ? (mepPrev / mepBase - 1) * 100 : null;
  if (mepDeltaPct === null) log.push('No se pudo obtener el dólar MEP — los CEDEARs se guardan solo en USD');

  const updates: { instrument: string; rate_monthly: number; label: string }[] = [];

  for (const t of TICKERS) {
    try {
      const points = await fetchYahooMonthlyCloses(t.yahooSymbol, period1, period2);
      if (points.length < 2) { log.push(`${t.instrument}: solo ${points.length} punto(s) de Yahoo Finance`); continue; }

      const monthsFound = points.map(p => monthKey(p.date));
      const prevPoint = points.find(p => monthKey(p.date) === monthKey(prevMonthStart));
      const baseCandidates = points.filter(p => monthKey(p.date) < monthKey(prevMonthStart));
      const basePoint = baseCandidates[baseCandidates.length - 1];
      if (!prevPoint || !basePoint) {
        log.push(`${t.instrument}: buscaba ${monthKey(prevMonthStart)} y el mes anterior — Yahoo devolvió [${monthsFound.join(', ')}]`);
        continue;
      }

      const assetReturnPct = (prevPoint.close / basePoint.close - 1) * 100;

      let arsReturnPct: number;
      if (t.isLocal) {
        arsReturnPct = assetReturnPct;
      } else if (mepDeltaPct !== null) {
        arsReturnPct = ((1 + assetReturnPct / 100) * (1 + mepDeltaPct / 100) - 1) * 100;
      } else {
        log.push(`${t.instrument}: usando retorno en USD (sin ajuste MEP)`);
        arsReturnPct = assetReturnPct;
      }

      updates.push({
        instrument:   t.instrument,
        rate_monthly: Math.round(arsReturnPct * 10) / 10,
        label:        t.label,
      });
    } catch (e) {
      log.push(`${t.instrument}: error ${e}`);
    }
  }

  if (updates.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No se obtuvo ningún retorno', mepDeltaPct, log }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }

  const nowIso = new Date().toISOString();
  const upserted: string[] = [];

  for (const row of updates) {
    const { error } = await sb.from('market_rates').upsert(
      { ...row, updated_at: nowIso },
      { onConflict: 'instrument' },
    );
    if (!error) upserted.push(`${row.instrument}=${row.rate_monthly}%`);
    else log.push(`DB error ${row.instrument}: ${error.message}`);
  }

  return new Response(
    JSON.stringify({ month: monthKey(prevMonthStart), mepDeltaPct, upserted, log }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
