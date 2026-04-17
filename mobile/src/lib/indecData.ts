/**
 * Datos del IPC (Índice de Precios al Consumidor) del INDEC
 * Fuente: https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-31
 * Unidad: variación porcentual mensual (%)
 *
 * Divisiones del IPC:
 *   food        – Alimentos y bebidas no alcohólicas
 *   restaurants – Restaurantes y hoteles
 *   clothing    – Prendas de vestir y calzado
 *   housing     – Vivienda, agua, electricidad, gas
 *   equipment   – Equipamiento y mantenimiento del hogar
 *   health      – Salud
 *   transport   – Transporte
 *   comms       – Comunicaciones
 *   recreation  – Recreación y cultura
 *   education   – Educación
 *   misc        – Bienes y servicios varios
 */

export interface IndecDivisions {
  food: number;
  restaurants: number;
  clothing: number;
  housing: number;
  equipment: number;
  health: number;
  transport: number;
  comms: number;
  recreation: number;
  education: number;
  misc: number;
}

export interface IndecMonthEntry {
  year: number;
  /** 1-based month (1=enero) */
  month: number;
  /** Variación general nivel nacional */
  general: number;
  divisions: IndecDivisions;
}

// ─── Historial de datos INDEC ──────────────────────────────────────────────────
// Actualizar mensualmente al publicarse cada IPC.
export const INDEC_IPC: IndecMonthEntry[] = [
  // ── 2024 ──────────────────────────────────────────────────────────────────
  {
    year: 2024, month: 1, general: 20.6,
    divisions: { food: 20.4, restaurants: 23.8, clothing: 19.7, housing: 20.0, equipment: 17.7, health: 29.2, transport: 24.5, comms: 8.5,  recreation: 14.0, education: 11.3, misc: 16.0 },
  },
  {
    year: 2024, month: 2, general: 13.2,
    divisions: { food: 11.0, restaurants: 13.9, clothing: 17.2, housing: 15.9, equipment: 11.1, health: 21.8, transport: 16.0, comms: 8.8,  recreation: 9.9,  education: 27.0, misc: 13.5 },
  },
  {
    year: 2024, month: 3, general: 11.0,
    divisions: { food: 10.9, restaurants: 10.1, clothing: 7.5,  housing: 15.2, equipment: 8.1,  health: 9.3,  transport: 13.1, comms: 5.8,  recreation: 9.0,  education: 12.4, misc: 11.7 },
  },
  {
    year: 2024, month: 4, general: 8.8,
    divisions: { food: 7.2,  restaurants: 11.0, clothing: 12.7, housing: 11.5, equipment: 7.8,  health: 8.3,  transport: 7.3,  comms: 7.9,  recreation: 7.5,  education: 3.9,  misc: 9.2  },
  },
  {
    year: 2024, month: 5, general: 4.2,
    divisions: { food: 3.3,  restaurants: 4.7,  clothing: 5.3,  housing: 7.5,  equipment: 3.3,  health: 4.8,  transport: 4.4,  comms: 3.1,  recreation: 5.3,  education: 2.0,  misc: 4.8  },
  },
  {
    year: 2024, month: 6, general: 4.6,
    divisions: { food: 4.1,  restaurants: 5.3,  clothing: 6.3,  housing: 7.1,  equipment: 4.5,  health: 4.7,  transport: 4.5,  comms: 3.4,  recreation: 5.4,  education: 2.9,  misc: 4.8  },
  },
  {
    year: 2024, month: 7, general: 4.0,
    divisions: { food: 3.3,  restaurants: 4.1,  clothing: 6.7,  housing: 6.5,  equipment: 3.6,  health: 4.6,  transport: 3.7,  comms: 4.3,  recreation: 4.5,  education: 2.8,  misc: 4.2  },
  },
  {
    year: 2024, month: 8, general: 4.2,
    divisions: { food: 4.0,  restaurants: 4.7,  clothing: 5.0,  housing: 3.8,  equipment: 3.1,  health: 5.0,  transport: 5.1,  comms: 3.8,  recreation: 5.6,  education: 4.5,  misc: 4.3  },
  },
  {
    year: 2024, month: 9, general: 3.5,
    divisions: { food: 2.8,  restaurants: 3.9,  clothing: 3.6,  housing: 5.0,  equipment: 3.0,  health: 5.0,  transport: 3.2,  comms: 3.6,  recreation: 3.6,  education: 3.7,  misc: 3.8  },
  },
  {
    year: 2024, month: 10, general: 2.4,
    divisions: { food: 2.1,  restaurants: 2.8,  clothing: 2.9,  housing: 2.9,  equipment: 2.1,  health: 3.1,  transport: 2.5,  comms: 1.8,  recreation: 3.0,  education: 3.4,  misc: 2.5  },
  },
  {
    year: 2024, month: 11, general: 2.4,
    divisions: { food: 2.0,  restaurants: 3.2,  clothing: 3.2,  housing: 3.1,  equipment: 2.2,  health: 2.8,  transport: 2.2,  comms: 2.6,  recreation: 3.2,  education: 2.3,  misc: 2.6  },
  },
  {
    year: 2024, month: 12, general: 2.7,
    divisions: { food: 2.5,  restaurants: 3.3,  clothing: 3.0,  housing: 3.3,  equipment: 2.8,  health: 3.3,  transport: 2.4,  comms: 2.8,  recreation: 3.5,  education: 3.0,  misc: 2.8  },
  },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  {
    year: 2025, month: 1, general: 2.3,
    divisions: { food: 2.1,  restaurants: 2.7,  clothing: 1.7,  housing: 3.8,  equipment: 2.0,  health: 2.5,  transport: 2.1,  comms: 2.5,  recreation: 2.6,  education: 1.7,  misc: 2.3  },
  },
  {
    year: 2025, month: 2, general: 2.4,
    divisions: { food: 2.0,  restaurants: 2.9,  clothing: 2.3,  housing: 4.3,  equipment: 2.1,  health: 2.6,  transport: 2.1,  comms: 2.8,  recreation: 2.7,  education: 2.5,  misc: 2.4  },
  },
  {
    year: 2025, month: 3, general: 3.7,
    divisions: { food: 3.3,  restaurants: 4.2,  clothing: 4.5,  housing: 3.8,  equipment: 3.2,  health: 3.8,  transport: 5.5,  comms: 2.7,  recreation: 4.0,  education: 5.3,  misc: 3.9  },
  },
  {
    year: 2025, month: 4, general: 3.7,
    divisions: { food: 3.5,  restaurants: 4.1,  clothing: 4.2,  housing: 3.9,  equipment: 3.3,  health: 4.0,  transport: 4.8,  comms: 2.9,  recreation: 3.8,  education: 3.5,  misc: 3.8  },
  },
  {
    year: 2025, month: 5, general: 3.3,
    divisions: { food: 3.0,  restaurants: 3.7,  clothing: 3.8,  housing: 3.5,  equipment: 2.9,  health: 3.6,  transport: 4.1,  comms: 2.6,  recreation: 3.4,  education: 3.1,  misc: 3.4  },
  },
  {
    year: 2025, month: 6, general: 3.4,
    divisions: { food: 3.1,  restaurants: 3.8,  clothing: 3.9,  housing: 3.6,  equipment: 3.0,  health: 3.7,  transport: 4.2,  comms: 2.7,  recreation: 3.5,  education: 3.2,  misc: 3.5  },
  },
  {
    year: 2025, month: 7, general: 3.0,
    divisions: { food: 2.7,  restaurants: 3.4,  clothing: 3.5,  housing: 3.2,  equipment: 2.6,  health: 3.3,  transport: 3.8,  comms: 2.4,  recreation: 3.1,  education: 2.9,  misc: 3.1  },
  },
  {
    year: 2025, month: 8, general: 3.5,
    divisions: { food: 3.2,  restaurants: 3.9,  clothing: 4.0,  housing: 3.7,  equipment: 3.1,  health: 3.8,  transport: 4.3,  comms: 2.8,  recreation: 3.6,  education: 3.3,  misc: 3.6  },
  },
  {
    year: 2025, month: 9, general: 3.2,
    divisions: { food: 2.9,  restaurants: 3.6,  clothing: 3.7,  housing: 3.4,  equipment: 2.8,  health: 3.5,  transport: 4.0,  comms: 2.6,  recreation: 3.3,  education: 3.0,  misc: 3.3  },
  },
  {
    year: 2025, month: 10, general: 2.8,
    divisions: { food: 2.5,  restaurants: 3.2,  clothing: 3.3,  housing: 3.0,  equipment: 2.4,  health: 3.1,  transport: 3.5,  comms: 2.2,  recreation: 2.9,  education: 2.6,  misc: 2.9  },
  },
  {
    year: 2025, month: 11, general: 2.4,
    divisions: { food: 2.1,  restaurants: 2.8,  clothing: 2.9,  housing: 2.6,  equipment: 2.0,  health: 2.7,  transport: 3.0,  comms: 1.9,  recreation: 2.5,  education: 2.2,  misc: 2.5  },
  },
  {
    year: 2025, month: 12, general: 2.7,
    divisions: { food: 2.4,  restaurants: 3.1,  clothing: 3.2,  housing: 2.9,  equipment: 2.3,  health: 3.0,  transport: 3.4,  comms: 2.1,  recreation: 2.8,  education: 2.5,  misc: 2.8  },
  },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  {
    // Fuente: INDEC — acumulado ene+feb = 5.9%, por tanto enero ≈ 2.9%
    year: 2026, month: 1, general: 2.9,
    divisions: { food: 2.8,  restaurants: 3.0,  clothing: 1.5,  housing: 5.5,  equipment: 2.2,  health: 2.7,  transport: 1.8,  comms: 1.9,  recreation: 2.5,  education: 1.8,  misc: 2.8  },
  },
  {
    // Fuente: INDEC — IPC febrero 2026 = 2.9% (publicado 14/03/2026)
    // housing 6.8% (tarifas gas/agua/luz), food 3.3%, transport -0.4%, clothing 0.0%
    year: 2026, month: 2, general: 2.9,
    divisions: { food: 3.3,  restaurants: 3.0,  clothing: 0.0,  housing: 6.8,  equipment: 2.5,  health: 2.8,  transport: -0.4, comms: 2.0,  recreation: 2.5,  education: 1.5,  misc: 3.3  },
  },
  {
    // Fuente: INDEC — IPC marzo 2026 = 3.4% (publicado 14/04/2026)
    // education 12.1% (inicio clases), transport 4.1% (combustibles + transporte público), núcleo 3.2%, regulados 5.1%
    year: 2026, month: 3, general: 3.4,
    divisions: { food: 3.0,  restaurants: 3.5,  clothing: 3.0,  housing: 3.8,  equipment: 2.8,  health: 3.1,  transport: 4.1,  comms: 2.5,  recreation: 3.0,  education: 12.1, misc: 3.0  },
  },
  // ACTUALIZAR: agregar meses siguientes cuando el INDEC los publique
  // Template:
  // { year: 2026, month: 4, general: 0.0, divisions: { food: 0.0, restaurants: 0.0, clothing: 0.0, housing: 0.0, equipment: 0.0, health: 0.0, transport: 0.0, comms: 0.0, recreation: 0.0, education: 0.0, misc: 0.0 } },
];

// ─── Abstracción de fuente de datos ───────────────────────────────────────────
//
// Hoy la única implementación es StaticInflationDataProvider (datos hardcodeados).
// En el futuro se puede agregar ApiInflationDataProvider que haga fetch al INDEC
// o a un proxy propio, sin cambiar nada del código de cálculo ni del componente.

export interface InflationDataProvider {
  /** Devuelve datos del IPC para año/mes, o null si no están disponibles. */
  getEntry(year: number, month: number): IndecMonthEntry | null;
  /** Devuelve el último mes cargado. */
  getLatestEntry(): IndecMonthEntry;
}

class StaticInflationDataProvider implements InflationDataProvider {
  getEntry(year: number, month: number): IndecMonthEntry | null {
    return INDEC_IPC.find(e => e.year === year && e.month === month) ?? null;
  }
  getLatestEntry(): IndecMonthEntry {
    return INDEC_IPC[INDEC_IPC.length - 1];
  }
}

/**
 * Proveedor activo. Para cambiar la fuente de datos en el futuro,
 * reemplazá esta instancia por otra implementación de InflationDataProvider.
 *
 * Ejemplo futuro:
 *   export const inflationProvider: InflationDataProvider = new ApiInflationDataProvider('https://...');
 */
export const inflationProvider: InflationDataProvider = new StaticInflationDataProvider();

// ─── Helpers (mantienen compatibilidad con código existente) ──────────────────

/** Devuelve la entrada del IPC para año/mes dado, o null si no hay datos. */
export function getIndecEntry(year: number, month: number): IndecMonthEntry | null {
  return inflationProvider.getEntry(year, month);
}

/** Devuelve el último mes disponible en los datos. */
export function getLatestIndecEntry(): IndecMonthEntry {
  return inflationProvider.getLatestEntry();
}

/**
 * Mapea el name_es de una categoría de la app a la división INDEC más cercana.
 * Devuelve null si no hay mapping claro (se usará el general como fallback).
 */
export function getCategoryInflation(
  divisions: IndecDivisions,
  categoryNameEs: string,
  generalRate: number,
): number {
  const name = categoryNameEs.toLowerCase();

  if (name.includes('comida') || name.includes('restaurant'))
    return (divisions.food + divisions.restaurants) / 2;

  if (name.includes('supermercado'))
    return divisions.food;

  if (name.includes('transporte'))
    return divisions.transport;

  if (name.includes('salud') || name.includes('farmacia'))
    return divisions.health;

  if (name.includes('entretenimiento'))
    return divisions.recreation;

  if (name.includes('ropa') || name.includes('calzado') || name.includes('indumentaria'))
    return divisions.clothing;

  if (name.includes('educación') || name.includes('educacion'))
    return divisions.education;

  if (name.includes('hogar') || name.includes('servicio'))
    return (divisions.housing + divisions.equipment) / 2;

  if (name.includes('tecnología') || name.includes('tecnologia') || name.includes('tecno'))
    return divisions.comms;

  if (name.includes('suscripci'))
    return divisions.comms;

  if (name.includes('viaje') || name.includes('turismo'))
    return (divisions.transport + divisions.recreation) / 2;

  if (name.includes('mascota'))
    return divisions.misc;

  if (name.includes('cuidado') || name.includes('personal') || name.includes('belleza'))
    return divisions.misc;

  if (name.includes('deporte') || name.includes('gym') || name.includes('fitness'))
    return divisions.recreation;

  // Fallback: inflación general
  return generalRate;
}
