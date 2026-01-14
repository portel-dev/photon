/**
 * Photon Design System
 *
 * A design system for AI+Human transaction workflows.
 * Based on Material Design 3 tokens + Apple HIG visual principles.
 *
 * References:
 * - Material Design 3: https://m3.material.io/foundations/design-tokens
 * - Apple HIG: https://developer.apple.com/design/human-interface-guidelines/layout
 */

export * from './tokens.js';
export * from './transaction-ui.js';

import { generateTokensCSS } from './tokens.js';
import { generateTransactionCSS, generateTransactionJS } from './transaction-ui.js';

/**
 * Generate all CSS for the Photon Design System
 */
export function generateDesignSystemCSS(): string {
  return generateTokensCSS() + '\n' + generateTransactionCSS();
}

/**
 * Generate all JavaScript for the Photon Design System
 */
export function generateDesignSystemJS(): string {
  return generateTransactionJS();
}
