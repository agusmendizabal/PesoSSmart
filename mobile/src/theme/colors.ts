export const colors = {
  // Base
  black:        '#1C1C1C',
  blackSoft:    '#2A2A2A',
  darkGray:     '#4A4A4A',
  mediumGray:   '#9B9790',
  textSecondary:'#6D6A63',
  white:        '#FFFFFF',

  // ── Paleta de marca — Verde + Crema ──────────────────────────────────────
  primary:    '#27AE60',
  primaryDim: '#1F8C4F',

  secondary: '#FFFFFF',
  tertiary:  '#27AE60',    // Era violeta — ahora verde primario
  accent:    '#D1F7E3',    // Verde menta suave

  red:    '#EF4444',       // Rojo alerta
  yellow: '#F59E0B',       // Advertencia

  // Alias
  neon:    '#27AE60',
  neonDim: '#1F8C4F',

  // Semantic
  success: '#27AE60',
  error:   '#EF4444',
  warning: '#F9A825',
  info:    '#27AE60',

  // Verde suaves para fondos de card
  greenLight: '#D1F7E3',
  greenSoft:  '#A8D5C2',

  // ── Fondos ────────────────────────────────────────────────────────────────
  bg: {
    primary:      '#FAFAF7',   // Fondo general — crema cálido
    secondary:    '#F5F1E9',   // Superficie / cards
    card:         '#FFFFFF',   // Cards blanco puro
    elevated:     '#F5F1E9',   // Superficie elevada
    input:        '#F5F1E9',
    inputFocused: '#F2E8D5',
  },

  // ── Texto ─────────────────────────────────────────────────────────────────
  text: {
    primary:       '#1C1C1C',
    secondary:     '#6D6A63',
    tertiary:      '#9B9790',
    inverse:       '#FFFFFF',
    accent:        '#27AE60',
    primary_brand: '#27AE60',
    error:         '#EF4444',
    warning:       '#F9A825',
  },

  // ── Bordes ────────────────────────────────────────────────────────────────
  border: {
    default: '#E8E2D9',
    subtle:  '#EEE9E0',
    primary: '#27AE60',
    neon:    '#27AE60',
    accent:  '#27AE60',
    error:   '#EF4444',
  },

  // ── Clasificación de gastos ───────────────────────────────────────────────
  expense: {
    necessary:  '#1976D2',   // Azul — necesarios (color semántico, no de marca)
    disposable: '#EF4444',   // Rojo — prescindibles
    investable: '#27AE60',   // Verde — invertible
  },

  transparent:  'transparent',
  overlay:      'rgba(0,0,0,0.32)',
  overlayLight: 'rgba(0,0,0,0.08)',
} as const;

export type Color = typeof colors;
