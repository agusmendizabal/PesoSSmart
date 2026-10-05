import { Ionicons } from '@expo/vector-icons';
import type { CategoryIconKey } from './categoryIcons';

// Un ícono vectorial + color semántico por categoría — mismo lenguaje de color
// que ya usan los donuts/breakdowns (ver CATEGORY_KEYWORD_COLORS en ReportCards.tsx),
// así el círculo pastel del ícono combina con el resto de la UI.
export const CATEGORY_ICON_STYLE: Record<CategoryIconKey, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  'alimentacion':     { icon: 'nutrition-outline',        color: '#FF6B6B' },
  'restaurantes':     { icon: 'restaurant-outline',       color: '#FF6B6B' },
  'supermercado':     { icon: 'cart-outline',             color: '#FF6B6B' },
  'cafe-bebidas':     { icon: 'cafe-outline',              color: '#FF6B6B' },
  'transporte':       { icon: 'bus-outline',              color: '#FF9F43' },
  'combustible':      { icon: 'speedometer-outline',      color: '#FF9F43' },
  'salud':            { icon: 'medkit-outline',           color: '#1DD1A1' },
  'deportes':         { icon: 'barbell-outline',          color: '#1DD1A1' },
  'educacion':        { icon: 'school-outline',           color: '#A29BFE' },
  'entretenimiento':  { icon: 'film-outline',              color: '#FD79A8' },
  'ocio-salidas':     { icon: 'beer-outline',              color: '#FD79A8' },
  'suscripciones':    { icon: 'play-circle-outline',      color: '#5F27CD' },
  'ropa-moda':        { icon: 'shirt-outline',             color: '#E84393' },
  'hogar':            { icon: 'home-outline',              color: '#00D2D3' },
  'servicios':        { icon: 'flash-outline',             color: '#00D2D3' },
  'bancos-finanzas':  { icon: 'card-outline',              color: '#0ABDE3' },
  'viajes':           { icon: 'airplane-outline',         color: '#54A0FF' },
  'alojamiento':      { icon: 'bed-outline',               color: '#54A0FF' },
  'peajes':           { icon: 'navigate-outline',         color: '#FF9F43' },
  'impuestos':        { icon: 'document-text-outline',    color: '#B2BEC3' },
  'regalos':          { icon: 'gift-outline',              color: '#FD79A8' },
  'cuidado-personal': { icon: 'sparkles-outline',         color: '#FECA57' },
  'seguros':          { icon: 'shield-checkmark-outline', color: '#5B9EF9' },
  'otros':            { icon: 'ellipsis-horizontal-outline', color: '#B2BEC3' },
};
