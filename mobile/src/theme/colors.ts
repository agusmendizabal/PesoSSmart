export const colors = {
  // Base
  black: '#1A1A1A',
  blackSoft: '#2A2A2A',
  darkGray: '#4A4A4A',
  mediumGray: '#9E9E9E',
  textSecondary: '#666666',
  white: '#FFFFFF',

  // Brand
  primary: '#00C853',    // Verde vibrante
  primaryDim: '#00A844',
  secondary: '#FFFFFF',  // Blanco
  tertiary: '#7B61FF',   // Violeta
  accent: '#1978E5',     // Azul seed
  red: '#E53935',
  yellow: '#FFB300',

  // Aliases para compatibilidad con screens existentes
  neon: '#00C853',
  neonDim: '#00A844',

  // Semantic
  success: '#00C853',
  error: '#E53935',
  warning: '#FFB300',
  info: '#1978E5',

  // Backgrounds (Light mode)
  bg: {
    primary: '#FFFFFF',
    secondary: '#F5F5F5',
    card: '#FFFFFF',
    elevated: '#FAFAFA',
    input: '#F0F0F0',
    inputFocused: '#E8E8E8',
  },

  // Text
  text: {
    primary: '#1A1A1A',
    secondary: '#666666',
    tertiary: '#9E9E9E',
    inverse: '#FFFFFF',
    accent: '#1978E5',
    primary_brand: '#00C853',
    error: '#E53935',
    warning: '#FFB300',
  },

  // Borders
  border: {
    default: '#E0E0E0',
    subtle: '#F0F0F0',
    primary: '#00C853',
    neon: '#00C853',
    accent: '#1978E5',
    error: '#E53935',
  },

  // Expense classification
  expense: {
    necessary: '#1978E5',
    disposable: '#E53935',
    investable: '#00C853',
  },

  // Transparent
  transparent: 'transparent',

  // Overlays
  overlay: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0,0,0,0.2)',
} as const;

export type Color = typeof colors;
