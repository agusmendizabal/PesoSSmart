// ============================================================
// Utilidades de formateo para Nomi
// Contexto: Argentina, moneda ARS
// ============================================================

/**
 * Formatea un número como moneda argentina
 * Ej: 125000 → "$125.000"
 */
export function formatCurrency(amount: number, decimals = 0): string {
  const formatted = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return formatted;
}

/**
 * Formatea moneda de forma compacta para dashboards
 * Ej: 1250000 → "$1.25M"
 */
export function formatCurrencyCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return formatCurrency(amount);
}

/**
 * Formatea porcentaje
 * Ej: 0.1235 → "+12.35%"
 */
export function formatPercent(value: number, showSign = false): string {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

/**
 * Formatea fecha en formato argentino
 * Ej: "2024-03-15" → "15 mar 2024"
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formatea fecha corta
 * Ej: "2024-03-15" → "15/03"
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
  });
}

/**
 * Nombre del mes
 * Ej: 3 → "marzo"
 */
export function getMonthName(month: number): string {
  const date = new Date(2024, month - 1, 1);
  return date.toLocaleDateString('es-AR', { month: 'long' });
}

/**
 * Tiempo relativo
 * Ej: hace 2 horas
 */
export function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'ahora';
  if (diffMins < 60) return `hace ${diffMins} min`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays === 1) return 'ayer';
  if (diffDays < 7) return `hace ${diffDays} días`;
  return formatDate(dateStr);
}

/**
 * Parsea monto ingresado por el usuario
 * Acepta "125.000" o "125000" o "125,50"
 */
export function parseAmount(input: string): number {
  const cleaned = input.replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Capitaliza primera letra
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Saludo según hora del día
 */
export function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let saludo: string;
  if (hour < 12) saludo = 'Buen día';
  else if (hour < 19) saludo = 'Buenas tardes';
  else saludo = 'Buenas noches';
  return name ? `${saludo}, ${name.split(' ')[0]}` : saludo;
}
