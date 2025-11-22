/**
 * CLI Output Formatter
 *
 * Re-exports from @portel/photon-core for backward compatibility.
 * All formatting logic is now in the core package.
 */

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
  type OutputFormat,
} from '@portel/photon-core';
