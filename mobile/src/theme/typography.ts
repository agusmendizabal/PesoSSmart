import { Platform } from 'react-native';

// Font families - se cargan via expo-font en _layout.tsx
export const fontFamilies = {
  // Montserrat - Títulos
  heading: 'Montserrat_800ExtraBold',
  headingBold: 'Montserrat_700Bold',
  headingSemiBold: 'Montserrat_600SemiBold',
  // Montserrat - Cuerpo
  body: 'Montserrat_400Regular',
  bodyMedium: 'Montserrat_500Medium',
  bodySemiBold: 'Montserrat_600SemiBold',
  bodyBold: 'Montserrat_700Bold',
} as const;

// Fallbacks mientras cargan las fuentes
export const fontFamiliesFallback = {
  heading: Platform.OS === 'ios' ? 'System' : 'sans-serif-condensed',
  headingBold: Platform.OS === 'ios' ? 'System' : 'sans-serif-condensed',
  headingSemiBold: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  body: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  bodyMedium: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  bodySemiBold: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  bodyBold: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
} as const;

export const fontSizes = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 40,
  '6xl': 48,
  '7xl': 56,
  '8xl': 72,
} as const;

export const lineHeights = {
  tight: 1.1,
  snug: 1.2,
  normal: 1.4,
  relaxed: 1.6,
  loose: 1.8,
} as const;

export const letterSpacings = {
  tighter: -0.5,
  tight: -0.25,
  normal: 0,
  wide: 0.5,
  wider: 1,
  widest: 2,
} as const;

// Text variants predefinidas
export const textVariants = {
  // Hero / pantallas de bienvenida
  hero: {
    fontFamily: fontFamilies.heading,
    fontSize: fontSizes['8xl'],
    lineHeight: fontSizes['8xl'] * lineHeights.tight,
    letterSpacing: letterSpacings.tight,
  },
  // Títulos de sección grandes
  h1: {
    fontFamily: fontFamilies.heading,
    fontSize: fontSizes['6xl'],
    lineHeight: fontSizes['6xl'] * lineHeights.tight,
    letterSpacing: letterSpacings.tight,
  },
  h2: {
    fontFamily: fontFamilies.heading,
    fontSize: fontSizes['5xl'],
    lineHeight: fontSizes['5xl'] * lineHeights.tight,
    letterSpacing: letterSpacings.tight,
  },
  h3: {
    fontFamily: fontFamilies.headingBold,
    fontSize: fontSizes['4xl'],
    lineHeight: fontSizes['4xl'] * lineHeights.snug,
  },
  h4: {
    fontFamily: fontFamilies.headingBold,
    fontSize: fontSizes['3xl'],
    lineHeight: fontSizes['3xl'] * lineHeights.snug,
  },
  // Subtítulos
  subtitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * lineHeights.normal,
  },
  // Cuerpo principal
  body: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * lineHeights.relaxed,
  },
  bodySmall: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.base,
    lineHeight: fontSizes.base * lineHeights.relaxed,
  },
  // Labels y badges
  label: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.normal,
    letterSpacing: letterSpacings.wider,
    textTransform: 'uppercase' as const,
  },
  labelMd: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: fontSizes.base,
    lineHeight: fontSizes.base * lineHeights.normal,
    letterSpacing: letterSpacings.wide,
  },
  // Números/valores financieros
  number: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: fontSizes['2xl'],
    lineHeight: fontSizes['2xl'] * lineHeights.tight,
    letterSpacing: letterSpacings.tight,
  },
  numberLg: {
    fontFamily: fontFamilies.heading,
    fontSize: fontSizes['4xl'],
    lineHeight: fontSizes['4xl'] * lineHeights.tight,
    letterSpacing: letterSpacings.tighter,
  },
  // Caption
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.xs,
    lineHeight: fontSizes.xs * lineHeights.relaxed,
  },
  // Botones
  button: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * lineHeights.tight,
    letterSpacing: letterSpacings.wide,
  },
  buttonSm: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * lineHeights.tight,
    letterSpacing: letterSpacings.wide,
  },
} as const;
