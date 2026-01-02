/**
 * CLI Output Formatter
 *
 * Re-exports from @portel/photon-core for consolidation.
 * All formatting utilities are now in the shared core library.
 */

// Re-export everything from photon-core's cli-formatter
export {
  formatOutput,
  detectFormat,
  renderPrimitive,
  renderList,
  renderTable,
  renderTree,
  renderNone,
  formatKey,
  formatValue,
  formatToMimeType,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  printHeader,
  STATUS,
} from '@portel/photon-core';

// Re-export types
export type { OutputFormat } from '@portel/photon-core';
