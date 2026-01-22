/**
 * Photon Design System - Design Tokens
 *
 * Based on:
 * - Material Design 3 token structure (https://m3.material.io/foundations/design-tokens)
 * - Apple HIG 8pt grid system (https://developer.apple.com/design/human-interface-guidelines/layout)
 *
 * This is the foundation for all Photon UI - both BEAM interface and auto-generated UIs.
 */

// =============================================================================
// SPACING - 8pt Grid System (Apple HIG)
// =============================================================================

export const spacing = {
  // Base unit: 4px (for fine adjustments)
  '0': '0',
  '1': '4px', // xs - minimal spacing
  '2': '8px', // sm - tight spacing
  '3': '12px', // md - default spacing
  '4': '16px', // lg - comfortable spacing
  '5': '20px', // xl - generous spacing
  '6': '24px', // 2xl - section spacing
  '8': '32px', // 3xl - large section spacing
  '10': '40px', // 4xl - hero spacing
  '12': '48px', // 5xl - page spacing
} as const;

// Semantic spacing aliases
export const spacingAliases = {
  none: spacing['0'],
  tight: spacing['1'],
  compact: spacing['2'],
  default: spacing['3'],
  comfortable: spacing['4'],
  spacious: spacing['6'],
  section: spacing['8'],
} as const;

// =============================================================================
// TYPOGRAPHY - Material Design 3 Type Scale
// =============================================================================

export const fontFamily = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  mono: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Monaco, Consolas, monospace',
} as const;

export const fontSize = {
  // Display - for hero/large numbers
  'display-lg': '57px',
  'display-md': '45px',
  'display-sm': '36px',

  // Headline - for section headers
  'headline-lg': '32px',
  'headline-md': '28px',
  'headline-sm': '24px',

  // Title - for card titles, list item titles
  'title-lg': '22px',
  'title-md': '16px',
  'title-sm': '14px',

  // Body - for content
  'body-lg': '16px',
  'body-md': '14px',
  'body-sm': '12px',

  // Label - for UI labels, buttons, badges
  'label-lg': '14px',
  'label-md': '12px',
  'label-sm': '11px',
} as const;

export const lineHeight = {
  'display-lg': '64px',
  'display-md': '52px',
  'display-sm': '44px',
  'headline-lg': '40px',
  'headline-md': '36px',
  'headline-sm': '32px',
  'title-lg': '28px',
  'title-md': '24px',
  'title-sm': '20px',
  'body-lg': '24px',
  'body-md': '20px',
  'body-sm': '16px',
  'label-lg': '20px',
  'label-md': '16px',
  'label-sm': '16px',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// =============================================================================
// COLORS - Semantic Color System
// =============================================================================

// Reference colors (raw values)
const colorPalette = {
  // Neutrals (dark theme optimized)
  neutral: {
    0: '#000000',
    5: '#0d0d0d',
    10: '#1a1a1a',
    15: '#262626',
    20: '#333333',
    30: '#4d4d4d',
    40: '#666666',
    50: '#808080',
    60: '#999999',
    70: '#b3b3b3',
    80: '#cccccc',
    90: '#e6e6e6',
    95: '#f2f2f2',
    100: '#ffffff',
  },

  // Primary (blue - trust, action)
  primary: {
    10: '#001d36',
    20: '#003258',
    30: '#00497d',
    40: '#0061a4',
    50: '#2c7bc9',
    60: '#5094e0',
    70: '#79aef0',
    80: '#a4c9ff',
    90: '#d1e4ff',
    95: '#e9f1ff',
  },

  // Success (green)
  success: {
    10: '#002106',
    20: '#003910',
    30: '#00531a',
    40: '#006e25',
    50: '#008a30',
    60: '#1fa940',
    70: '#4cc760',
    80: '#73e380',
    90: '#98ffa0',
    95: '#c8ffc8',
  },

  // Warning (amber)
  warning: {
    10: '#261900',
    20: '#402d00',
    30: '#5c4300',
    40: '#7a5900',
    50: '#996f00',
    60: '#b88600',
    70: '#d89e00',
    80: '#f9b800',
    90: '#ffdf9e',
    95: '#fff0d6',
  },

  // Error (red)
  error: {
    10: '#410002',
    20: '#690005',
    30: '#93000a',
    40: '#ba1a1a',
    50: '#de3730',
    60: '#ff5449',
    70: '#ff897d',
    80: '#ffb4ab',
    90: '#ffdad6',
    95: '#ffedea',
  },
} as const;

// System colors - Dark Theme (default)
export const colorsDark = {
  // Surfaces
  surface: colorPalette.neutral[5],
  surfaceContainer: colorPalette.neutral[10],
  surfaceContainerHigh: colorPalette.neutral[15],
  surfaceContainerHighest: colorPalette.neutral[20],
  surfaceBright: colorPalette.neutral[95],

  // Text on surfaces
  onSurface: colorPalette.neutral[90],
  onSurfaceVariant: colorPalette.neutral[70],
  onSurfaceMuted: colorPalette.neutral[50],

  // Primary
  primary: colorPalette.primary[70],
  primaryContainer: colorPalette.primary[30],
  onPrimary: colorPalette.primary[10],
  onPrimaryContainer: colorPalette.primary[90],

  // Success
  success: colorPalette.success[70],
  successContainer: colorPalette.success[20],
  onSuccess: colorPalette.success[10],
  onSuccessContainer: colorPalette.success[90],

  // Warning
  warning: colorPalette.warning[70],
  warningContainer: colorPalette.warning[20],
  onWarning: colorPalette.warning[10],
  onWarningContainer: colorPalette.warning[90],

  // Error
  error: colorPalette.error[70],
  errorContainer: colorPalette.error[20],
  onError: colorPalette.error[10],
  onErrorContainer: colorPalette.error[90],

  // Outline
  outline: colorPalette.neutral[30],
  outlineVariant: colorPalette.neutral[20],

  // Scrim (overlay)
  scrim: 'rgba(0, 0, 0, 0.5)',
} as const;

// System colors - Light Theme
export const colorsLight = {
  // Surfaces (inverted - light backgrounds)
  surface: colorPalette.neutral[100], // white
  surfaceContainer: colorPalette.neutral[95],
  surfaceContainerHigh: colorPalette.neutral[90],
  surfaceContainerHighest: colorPalette.neutral[80],
  surfaceBright: colorPalette.neutral[100],

  // Text on surfaces (dark text on light)
  onSurface: colorPalette.neutral[10],
  onSurfaceVariant: colorPalette.neutral[30],
  onSurfaceMuted: colorPalette.neutral[50],

  // Primary (darker for light theme)
  primary: colorPalette.primary[40],
  primaryContainer: colorPalette.primary[90],
  onPrimary: colorPalette.neutral[100], // white text on primary
  onPrimaryContainer: colorPalette.primary[10],

  // Success
  success: colorPalette.success[40],
  successContainer: colorPalette.success[90],
  onSuccess: colorPalette.neutral[100], // white text
  onSuccessContainer: colorPalette.success[10],

  // Warning
  warning: colorPalette.warning[40],
  warningContainer: colorPalette.warning[90],
  onWarning: colorPalette.neutral[100], // white text
  onWarningContainer: colorPalette.warning[10],

  // Error
  error: colorPalette.error[40],
  errorContainer: colorPalette.error[90],
  onError: colorPalette.neutral[100], // white text
  onErrorContainer: colorPalette.error[10],

  // Outline (darker for light theme)
  outline: colorPalette.neutral[50],
  outlineVariant: colorPalette.neutral[80],

  // Scrim (overlay)
  scrim: 'rgba(0, 0, 0, 0.3)' as const,
};

// Default export (dark theme for backwards compatibility)
export const colors = colorsDark;

// Theme type
export type ThemeMode = 'light' | 'dark' | 'system';

// Theme colors type (union of both)
export type ThemeColors = typeof colorsDark | typeof colorsLight;

// Get colors for a specific theme
export function getThemeColors(theme: 'light' | 'dark'): ThemeColors {
  return theme === 'light' ? colorsLight : colorsDark;
}

// =============================================================================
// ELEVATION - Material Design 3 Shadows
// =============================================================================

export const elevation = {
  '0': 'none',
  '1': '0px 1px 2px 0px rgba(0, 0, 0, 0.30), 0px 1px 3px 1px rgba(0, 0, 0, 0.15)',
  '2': '0px 1px 2px 0px rgba(0, 0, 0, 0.30), 0px 2px 6px 2px rgba(0, 0, 0, 0.15)',
  '3': '0px 1px 3px 0px rgba(0, 0, 0, 0.30), 0px 4px 8px 3px rgba(0, 0, 0, 0.15)',
  '4': '0px 2px 3px 0px rgba(0, 0, 0, 0.30), 0px 6px 10px 4px rgba(0, 0, 0, 0.15)',
  '5': '0px 4px 4px 0px rgba(0, 0, 0, 0.30), 0px 8px 12px 6px rgba(0, 0, 0, 0.15)',
} as const;

// =============================================================================
// BORDER RADIUS - Apple HIG inspired
// =============================================================================

export const radius = {
  none: '0',
  sm: '6px', // Small elements (chips, badges)
  md: '10px', // Cards, inputs (iOS default)
  lg: '14px', // Large cards
  xl: '20px', // Modal, sheet
  full: '9999px', // Pills, circles
} as const;

// =============================================================================
// MOTION - Transitions
// =============================================================================

export const duration = {
  instant: '0ms',
  fast: '100ms',
  normal: '200ms',
  slow: '300ms',
  slower: '500ms',
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  standardDecelerate: 'cubic-bezier(0, 0, 0, 1)',
  standardAccelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasizedDecelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  emphasizedAccelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
} as const;

// =============================================================================
// INTERACTION - Touch targets (Apple HIG: 44pt minimum)
// =============================================================================

export const touchTarget = {
  min: '44px',
  comfortable: '48px',
  spacious: '56px',
} as const;

// =============================================================================
// Z-INDEX - Layering system
// =============================================================================

export const zIndex = {
  base: '0',
  dropdown: '100',
  sticky: '200',
  modal: '300',
  popover: '400',
  toast: '500',
} as const;

// =============================================================================
// CSS CUSTOM PROPERTIES GENERATOR
// =============================================================================

/**
 * Generate color CSS variables for a specific theme
 */
function generateColorVars(themeColors: ThemeColors): string {
  return `
  /* Colors - Surfaces */
  --color-surface: ${themeColors.surface};
  --color-surface-container: ${themeColors.surfaceContainer};
  --color-surface-container-high: ${themeColors.surfaceContainerHigh};
  --color-surface-container-highest: ${themeColors.surfaceContainerHighest};
  --color-surface-bright: ${themeColors.surfaceBright};

  /* Colors - Text */
  --color-on-surface: ${themeColors.onSurface};
  --color-on-surface-variant: ${themeColors.onSurfaceVariant};
  --color-on-surface-muted: ${themeColors.onSurfaceMuted};

  /* Colors - Primary */
  --color-primary: ${themeColors.primary};
  --color-primary-container: ${themeColors.primaryContainer};
  --color-on-primary: ${themeColors.onPrimary};
  --color-on-primary-container: ${themeColors.onPrimaryContainer};

  /* Colors - Success */
  --color-success: ${themeColors.success};
  --color-success-container: ${themeColors.successContainer};
  --color-on-success: ${themeColors.onSuccess};
  --color-on-success-container: ${themeColors.onSuccessContainer};

  /* Colors - Warning */
  --color-warning: ${themeColors.warning};
  --color-warning-container: ${themeColors.warningContainer};
  --color-on-warning: ${themeColors.onWarning};
  --color-on-warning-container: ${themeColors.onWarningContainer};

  /* Colors - Error */
  --color-error: ${themeColors.error};
  --color-error-container: ${themeColors.errorContainer};
  --color-on-error: ${themeColors.onError};
  --color-on-error-container: ${themeColors.onErrorContainer};

  /* Colors - Outline */
  --color-outline: ${themeColors.outline};
  --color-outline-variant: ${themeColors.outlineVariant};

  /* Colors - Scrim */
  --color-scrim: ${themeColors.scrim};`;
}

export function generateTokensCSS(): string {
  return `
/* ==========================================================================
   Photon Design System - Design Tokens
   Based on Material Design 3 + Apple HIG
   Supports: dark (default), light, system preference
   ========================================================================== */

:root {
  /* Spacing (8pt grid) */
  --space-0: ${spacing['0']};
  --space-1: ${spacing['1']};
  --space-2: ${spacing['2']};
  --space-3: ${spacing['3']};
  --space-4: ${spacing['4']};
  --space-5: ${spacing['5']};
  --space-6: ${spacing['6']};
  --space-8: ${spacing['8']};
  --space-10: ${spacing['10']};
  --space-12: ${spacing['12']};

  /* Typography - Font Family */
  --font-sans: ${fontFamily.sans};
  --font-mono: ${fontFamily.mono};

  /* Typography - Font Size */
  --text-display-lg: ${fontSize['display-lg']};
  --text-display-md: ${fontSize['display-md']};
  --text-display-sm: ${fontSize['display-sm']};
  --text-headline-lg: ${fontSize['headline-lg']};
  --text-headline-md: ${fontSize['headline-md']};
  --text-headline-sm: ${fontSize['headline-sm']};
  --text-title-lg: ${fontSize['title-lg']};
  --text-title-md: ${fontSize['title-md']};
  --text-title-sm: ${fontSize['title-sm']};
  --text-body-lg: ${fontSize['body-lg']};
  --text-body-md: ${fontSize['body-md']};
  --text-body-sm: ${fontSize['body-sm']};
  --text-label-lg: ${fontSize['label-lg']};
  --text-label-md: ${fontSize['label-md']};
  --text-label-sm: ${fontSize['label-sm']};

  /* Typography - Line Height */
  --leading-display-lg: ${lineHeight['display-lg']};
  --leading-display-md: ${lineHeight['display-md']};
  --leading-display-sm: ${lineHeight['display-sm']};
  --leading-headline-lg: ${lineHeight['headline-lg']};
  --leading-headline-md: ${lineHeight['headline-md']};
  --leading-headline-sm: ${lineHeight['headline-sm']};
  --leading-title-lg: ${lineHeight['title-lg']};
  --leading-title-md: ${lineHeight['title-md']};
  --leading-title-sm: ${lineHeight['title-sm']};
  --leading-body-lg: ${lineHeight['body-lg']};
  --leading-body-md: ${lineHeight['body-md']};
  --leading-body-sm: ${lineHeight['body-sm']};
  --leading-label-lg: ${lineHeight['label-lg']};
  --leading-label-md: ${lineHeight['label-md']};
  --leading-label-sm: ${lineHeight['label-sm']};

  /* Typography - Font Weight */
  --weight-regular: ${fontWeight.regular};
  --weight-medium: ${fontWeight.medium};
  --weight-semibold: ${fontWeight.semibold};
  --weight-bold: ${fontWeight.bold};

  /* Default: Dark Theme Colors */
  ${generateColorVars(colorsDark)}

  /* Elevation */
  --elevation-0: ${elevation['0']};
  --elevation-1: ${elevation['1']};
  --elevation-2: ${elevation['2']};
  --elevation-3: ${elevation['3']};
  --elevation-4: ${elevation['4']};
  --elevation-5: ${elevation['5']};

  /* Border Radius */
  --radius-none: ${radius.none};
  --radius-sm: ${radius.sm};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --radius-xl: ${radius.xl};
  --radius-full: ${radius.full};

  /* Motion */
  --duration-instant: ${duration.instant};
  --duration-fast: ${duration.fast};
  --duration-normal: ${duration.normal};
  --duration-slow: ${duration.slow};
  --duration-slower: ${duration.slower};

  --ease-standard: ${easing.standard};
  --ease-decelerate: ${easing.standardDecelerate};
  --ease-accelerate: ${easing.standardAccelerate};
  --ease-emphasized: ${easing.emphasized};

  /* Touch Targets */
  --touch-min: ${touchTarget.min};
  --touch-comfortable: ${touchTarget.comfortable};
  --touch-spacious: ${touchTarget.spacious};

  /* Z-Index */
  --z-base: ${zIndex.base};
  --z-dropdown: ${zIndex.dropdown};
  --z-sticky: ${zIndex.sticky};
  --z-modal: ${zIndex.modal};
  --z-popover: ${zIndex.popover};
  --z-toast: ${zIndex.toast};
}

/* Light Theme Override */
[data-theme="light"],
.light {
  ${generateColorVars(colorsLight)}
}

/* System Preference: Light Mode */
@media (prefers-color-scheme: light) {
  [data-theme="system"] {
    ${generateColorVars(colorsLight)}
  }
}
`;
}

// =============================================================================
// THEME TOKENS FOR MCP APPS / PLATFORM BRIDGES
// =============================================================================

/**
 * Get theme tokens as a flat object for MCP Apps ui/initialize
 * Compatible with OpenAI Apps SDK and MCP Apps Extension (SEP-1865)
 */
export function getThemeTokens(theme: 'light' | 'dark'): Record<string, string> {
  const themeColors = theme === 'light' ? colorsLight : colorsDark;

  return {
    // ═══════════════════════════════════════════════════════════════════════
    // DESIGN SYSTEM TOKENS (Material Design 3 naming)
    // ═══════════════════════════════════════════════════════════════════════

    // Colors
    '--color-surface': themeColors.surface,
    '--color-surface-container': themeColors.surfaceContainer,
    '--color-surface-container-high': themeColors.surfaceContainerHigh,
    '--color-surface-container-highest': themeColors.surfaceContainerHighest,
    '--color-surface-bright': themeColors.surfaceBright,
    '--color-on-surface': themeColors.onSurface,
    '--color-on-surface-variant': themeColors.onSurfaceVariant,
    '--color-on-surface-muted': themeColors.onSurfaceMuted,
    '--color-primary': themeColors.primary,
    '--color-primary-container': themeColors.primaryContainer,
    '--color-on-primary': themeColors.onPrimary,
    '--color-on-primary-container': themeColors.onPrimaryContainer,
    '--color-success': themeColors.success,
    '--color-success-container': themeColors.successContainer,
    '--color-on-success': themeColors.onSuccess,
    '--color-on-success-container': themeColors.onSuccessContainer,
    '--color-warning': themeColors.warning,
    '--color-warning-container': themeColors.warningContainer,
    '--color-on-warning': themeColors.onWarning,
    '--color-on-warning-container': themeColors.onWarningContainer,
    '--color-error': themeColors.error,
    '--color-error-container': themeColors.errorContainer,
    '--color-on-error': themeColors.onError,
    '--color-on-error-container': themeColors.onErrorContainer,
    '--color-outline': themeColors.outline,
    '--color-outline-variant': themeColors.outlineVariant,
    '--color-scrim': themeColors.scrim,

    // Spacing
    '--space-0': spacing['0'],
    '--space-1': spacing['1'],
    '--space-2': spacing['2'],
    '--space-3': spacing['3'],
    '--space-4': spacing['4'],
    '--space-6': spacing['6'],
    '--space-8': spacing['8'],

    // Typography
    '--font-sans': fontFamily.sans,
    '--font-mono': fontFamily.mono,
    '--text-body-md': fontSize['body-md'],
    '--text-body-sm': fontSize['body-sm'],
    '--text-title-md': fontSize['title-md'],
    '--text-label-md': fontSize['label-md'],

    // Border Radius
    '--radius-sm': radius.sm,
    '--radius-md': radius.md,
    '--radius-lg': radius.lg,
    '--radius-full': radius.full,

    // ═══════════════════════════════════════════════════════════════════════
    // COMMON ALIASES - For compatibility with various app conventions
    // Apps use different naming conventions; these aliases ensure apps work
    // regardless of whether they use --bg, --background, --bg-primary, etc.
    // ═══════════════════════════════════════════════════════════════════════

    // Background aliases (apps use: --bg, --background, --bg-primary, --bg-secondary)
    '--bg': themeColors.surface,
    '--background': themeColors.surface,
    '--bg-primary': themeColors.surface,
    '--bg-secondary': themeColors.surfaceContainer,
    '--bg-tertiary': themeColors.surfaceContainerHigh,
    '--bg-card': themeColors.surfaceContainer,
    '--card': themeColors.surfaceContainer,
    '--card-background': themeColors.surfaceContainer,

    // Text/foreground aliases (apps use: --text, --foreground, --text-primary, --text-muted)
    '--text': themeColors.onSurface,
    '--foreground': themeColors.onSurface,
    '--text-primary': themeColors.onSurface,
    '--text-secondary': themeColors.onSurfaceVariant,
    '--text-muted': themeColors.onSurfaceMuted,
    '--muted': themeColors.onSurfaceMuted,
    '--muted-foreground': themeColors.onSurfaceMuted,

    // Border aliases (apps use: --border, --border-color)
    '--border': themeColors.outline,
    '--border-color': themeColors.outline,
    '--border-muted': themeColors.outlineVariant,

    // Accent/primary aliases (apps use: --accent, --primary, --accent-color)
    '--accent': themeColors.primary,
    '--primary': themeColors.primary,
    '--accent-color': themeColors.primary,
    '--accent-foreground': themeColors.onPrimary,
    '--accent-hover': themeColors.primaryContainer,

    // Status colors (common naming)
    '--success': themeColors.success,
    '--warning': themeColors.warning,
    '--error': themeColors.error,
    '--danger': themeColors.error,

    // Input/form aliases
    '--input': themeColors.surfaceContainerHigh,
    '--input-border': themeColors.outline,
    '--ring': themeColors.primary,
  };
}
