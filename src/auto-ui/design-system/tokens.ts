/**
 * Photon Design System - Design Tokens
 *
 * Re-exports from @portel/photon-core for use by BEAM and frontend components.
 * The canonical token definitions (including MCP Apps standard CSS variables,
 * light/dark themes, and getThemeTokens) live in photon-core so sibling
 * projects (NCP, Lumina) get them automatically.
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

  // Elevation
  elevation,

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
} from '@portel/photon-core';
