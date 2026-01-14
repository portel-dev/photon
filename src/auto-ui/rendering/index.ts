/**
 * Smart Rendering Module
 *
 * iOS-inspired, React Admin-influenced rendering system that:
 * - Convention over configuration - works beautifully with zero annotations
 * - Smart field detection - guesses meaning from field names and types
 * - Progressive customization - JSDoc annotations for fine-tuning
 * - List-centric paradigm - everything renders as configurable list items
 */

export * from './field-analyzer.js';
export * from './layout-selector.js';
export * from './components.js';
export * from './field-renderers.js';
export * from './template-engine.js';

import { generateFieldAnalyzerJS } from './field-analyzer.js';
import { generateLayoutSelectorJS } from './layout-selector.js';
import { generateComponentsJS, generateComponentCSS } from './components.js';
import { generateFieldRenderersJS, generateFieldRendererCSS } from './field-renderers.js';
import { generateTemplateEngineJS, generateTemplateEngineCSS } from './template-engine.js';

/**
 * Generate all JavaScript code for embedding in HTML
 */
export function generateSmartRenderingJS(): string {
  return [
    '// ==========================================================================',
    '// Smart Rendering System',
    '// ==========================================================================',
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
    generateComponentCSS(),
    generateFieldRendererCSS(),
    generateTemplateEngineCSS(),
  ].join('\n');
}
