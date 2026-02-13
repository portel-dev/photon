/**
 * Photon Design System - Design Tokens
 *
 * Re-exports from @portel/photon-core's design-system subpath.
 * Uses the subpath import to avoid pulling in Node.js dependencies
 * (SchemaExtractor, fs, etc.) that would break browser bundling.
 */

export {
  // Spacing
  spacing,
  spacingAliases,

  // Typography
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight,

  // Colors
  colorsDark,
  colorsLight,
  colors,

  // Theme utilities
  type ThemeMode,
  type ThemeColors,
  getThemeColors,
  getThemeTokens,

  // OKLCH theme engine
  type ThemeConfig,
  type ThemePreset,
  type GeneratedThemeColors,
  type BeamThemeColors,
  oklchToHex,
  generateThemeColors,
  generateBeamThemeColors,
  beamThemeToCSS,
  themePresets,

  // Elevation
  elevation,
  elevationLight,

  // Border Radius
  radius,

  // Motion
  duration,
  easing,

  // Interaction
  touchTarget,

  // Z-Index
  zIndex,

  // CSS generators
  generateTokensCSS,
} from '@portel/photon-core/design-system/tokens';
