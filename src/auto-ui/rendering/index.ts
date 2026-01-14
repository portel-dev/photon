/**
 * Smart Rendering Module
 *
 * iOS-inspired, React Admin-influenced rendering system that:
 * - Convention over configuration - works beautifully with zero annotations
 * - Smart field detection - guesses meaning from field names and types
 * - Progressive customization - JSDoc annotations for fine-tuning
 * - List-centric paradigm - everything renders as configurable list items
 *
 * Design System based on:
 * - Material Design 3 tokens: https://m3.material.io/foundations/design-tokens
 * - Apple HIG (8pt grid): https://developer.apple.com/design/human-interface-guidelines/layout
 */

export * from './field-analyzer.js';
export * from './layout-selector.js';
export * from './components.js';
export * from './field-renderers.js';
export * from './template-engine.js';
export * from '../design-system/index.js';

import { generateFieldAnalyzerJS } from './field-analyzer.js';
import { generateLayoutSelectorJS } from './layout-selector.js';
import { generateComponentsJS, generateComponentCSS } from './components.js';
import { generateFieldRenderersJS, generateFieldRendererCSS } from './field-renderers.js';
import { generateTemplateEngineJS, generateTemplateEngineCSS } from './template-engine.js';
import { generateDesignSystemCSS, generateDesignSystemJS } from '../design-system/index.js';

/**
 * Generate all JavaScript code for embedding in HTML
 */
export function generateSmartRenderingJS(): string {
  return [
    '// ==========================================================================',
    '// Photon Design System + Smart Rendering',
    '// Based on Material Design 3 + Apple HIG',
    '// ==========================================================================',
    '',
    generateDesignSystemJS(),
    '',
    generateFieldAnalyzerJS(),
    '',
    generateLayoutSelectorJS(),
    '',
    generateFieldRenderersJS(),
    '',
    generateComponentsJS(),
    '',
    generateTemplateEngineJS(),
  ].join('\n');
}

/**
 * Generate all CSS for embedding in HTML
 */
export function generateSmartRenderingCSS(): string {
  return [
    generateDesignSystemCSS(),
    generateComponentCSS(),
    generateFieldRendererCSS(),
    generateTemplateEngineCSS(),
  ].join('\n');
}
