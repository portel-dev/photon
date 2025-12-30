/**
 * @portel/photon
 *
 * Build MCP servers and CLI tools from single .photon.ts files
 *
 * Re-exports @portel/photon-core for backward compatibility
 * and adds Photon-specific runtime functionality
 */

// Re-export everything from @portel/photon-core
export * from '@portel/photon-core';

// Export Photon-specific runtime components
export { PhotonLoader } from './loader.js';
export { PhotonServer } from './server.js';
export { PhotonDocExtractor } from './photon-doc-extractor.js';

// Export MCP client for calling external MCPs from Photons
export {
  StandaloneMCPTransport,
  StandaloneMCPClientFactory,
  loadMCPConfig,
  createStandaloneMCPClientFactory,
  resolveMCPSource,
  type MCPServerConfig,
  type MCPConfig,
} from './mcp-client.js';
