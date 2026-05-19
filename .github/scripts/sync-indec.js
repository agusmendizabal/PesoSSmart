// sync-indec.js — descarga XLS de INDEC y actualiza market_rates en Supabase
// Corre mensualmente vía GitHub Actions (día 16, INDEC publica el 14-15)

import XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Ponderaciones regionales INDEC para calcular promedio nacional
// Claves = fragmentos que aparecen en la celda "Región XXX" del XLS
const REGIONAL_WEIGHTS = {
  'GBA':       0.422,
  'Pampeana':  0.253,
  'Noroeste':  0.110,
  'Noreste':   0.071,
  'Cuyo':      0.091,
  'Patagónica':0.053,
};

// Mapeo de categorías INDEC → instrument en market_rates
const CATEGORY_MAP = {
  'Nivel general':                      'inflation_general',
  'Alimentos y bebidas no alcohólicas': 'inflation_food',
  'Bebidas alcohólicas y tabaco':       null, // no mapeado
  'Prendas de vestir y calzado':        'inflation_clothing',
  'Vivienda, agua, electricidad, gas y otros combustibles': 'inflation_housing',
  'Equipamiento y mantenimiento del hogar': 'inflation_equipment',
  'Salud':                              'inflation_health',
  'Transporte':                         'inflation_transport',
  'Comunicación':                       'inflation_comms',
  'Recreación y cultura':               'inflation_recreation',
  'Educación':                          'inflation_education',
  'Restaurantes y hoteles':             'inflation_restaurants',
};

// Labels legibles para la UI
const LABELS = {
  inflation_general:     'IPC Nivel general',
  inflation_food:        'IPC Alimentos y bebidas',
  inflation_clothing:    'IPC Indumentaria',
  inflation_housing:     'IPC Vivienda y servicios',
  inflation_equipment:   'IPC Equipamiento del hogar',
  inflation_health:      'IPC Salud',
  inflation_transport:   'IPC Transporte',
  inflation_comms:       'IPC Comunicación',
  inflation_recreation:  'IPC Recreación y cultura',
  inflation_education:   'IPC Educación',
  inflation_restaurants: 'IPC Restaurantes y hoteles',
};

async function downloadXls() {
  const url = 'https://www.indec.gob.ar/ftp/cuadros/economia/sh_ipc_aperturas.xls';
  console.log('Descargando XLS INDEC...');
  const res = await fetch(url, { timeout: 30000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar XLS`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

function parseXls(buffer) {
  // cellDates:false para recibir serial numérico de Excel en vez de Date objects
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  // La hoja que necesitamos se llama "Variación mensual aperturas"
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('variaci'));
  if (!sheetName) throw new Error(`Hoja no encontrada. Disponibles: ${wb.SheetNames.join(', ')}`);

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  console.log(`Hoja: "${sheetName}" — ${rows.length} filas`);

  // Buscar la fila de fechas: es la primera fila que tiene >= 5 números consecutivos > 40500
  // (son los seriales Excel de cada mes desde ene-2017 en adelante)
  let lastDateCol = -1;
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const row = rows[r];
    let count = 0;
    let lastCol = -1;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'number' && v > 40500 && v < 60000) {
        count++;
        lastCol = c;
      }
    }
    if (count >= 5) {
      lastDateCol = lastCol;
      headerRowIdx = r;
      break;
    }
  }

  if (lastDateCol === -1) throw new Error('No se encontró fila de fechas en el XLS');

  const rawDate = rows[headerRowIdx][lastDateCol];
  const d = XLSX.SSF.parse_date_code(rawDate);
  console.log(`Período detectado: ${d.m}/${d.y} (fila ${headerRowIdx}, columna ${lastDateCol})`);

  // Acumular variaciones por categoría y región
  // Estructura: categoryData[instrument][region] = variación mensual %
  const categoryData = {};
  // Nivel general nacional (fila sin región, aparece una sola vez antes de las regiones)
  const nationalDirect = {};

  let currentRegion = null;
  for (const row of rows.slice(headerRowIdx + 1)) {
    const firstCell = row[0];
    if (typeof firstCell !== 'string') continue;
    const trimmed = firstCell.trim();

    // Detectar si es fila de región (ej: "Región GBA", "Región Pampeana", etc.)
    const matchedRegion = Object.keys(REGIONAL_WEIGHTS).find(r =>
      trimmed.toLowerCase().includes(r.toLowerCase())
    );
    if (matchedRegion) { currentRegion = matchedRegion; continue; }

    // Antes de la primera región: capturar "Nivel general" directo
    if (!currentRegion) {
      if (trimmed.toLowerCase().includes('nivel general')) {
        const val = row[lastDateCol];
        if (typeof val === 'number') nationalDirect['inflation_general'] = val;
      }
      continue;
    }

    // Detectar si es fila de categoría
    const instrument = Object.entries(CATEGORY_MAP).find(([cat]) =>
      cat !== 'Nivel general' &&
      trimmed.toLowerCase().includes(cat.toLowerCase().split(' ')[0])
    );
    if (!instrument || !instrument[1]) continue;

    const instr = instrument[1];
    const val = row[lastDateCol];
    if (typeof val !== 'number') continue;

    if (!categoryData[instr]) categoryData[instr] = {};
    categoryData[instr][currentRegion] = val;
  }

  // Calcular promedios ponderados nacionales por categoría
  const result = { ...nationalDirect };
  for (const [instr, byRegion] of Object.entries(categoryData)) {
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [region, weight] of Object.entries(REGIONAL_WEIGHTS)) {
      if (byRegion[region] !== undefined) {
        weightedSum += byRegion[region] * weight;
        totalWeight += weight;
      }
    }
    if (totalWeight > 0) {
      result[instr] = +(weightedSum / totalWeight).toFixed(2);
    }
  }

  return result;
}

async function upsertToSupabase(rates) {
  const now = new Date().toISOString();
  const rows = Object.entries(rates).map(([instrument, rate_monthly]) => ({
    instrument,
    rate_monthly,
    label: LABELS[instrument] ?? instrument,
    updated_at: now,
  }));

  console.log(`Enviando ${rows.length} categorías a Supabase...`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_rates`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return rows;
}

async function main() {
  try {
    const buffer = await downloadXls();
    const rates = parseXls(buffer);

    if (Object.keys(rates).length === 0) {
      console.error('No se extrajeron categorías del XLS');
      process.exit(1);
    }

    console.log('Categorías extraídas:');
    for (const [k, v] of Object.entries(rates)) {
      console.log(`  ${k}: ${v}%`);
    }

    const upserted = await upsertToSupabase(rates);
    console.log(`\nSync completado: ${upserted.length} categorías actualizadas.`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
