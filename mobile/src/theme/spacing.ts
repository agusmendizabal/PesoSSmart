export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  28: 112,
  32: 128,
} as const;

export const radius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  full: 9999,
} as const;

// Layout constants
export const layout = {
  screenPadding: spacing[4],   // 16px — mockup spec
  cardPadding:   spacing[4],   // 16px
  sectionSpacing: spacing[6],  // 24px
  headerHeight: 56,
  tabBarHeight: 64,
  inputHeight: 48,
  buttonHeight: 48,            // 48px — mockup spec
  buttonHeightSm: 36,

  // Card shadow (usado via StyleSheet en cada pantalla)
  cardShadow: {
    shadowColor:   '#1F2937',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  10,
    elevation:     3,
  },
} as const;
