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

// Backward compatibility aliases for MCP client
// (New names SDKMCPTransport, SDKMCPClientFactory are exported from photon-core)
export {
  StandaloneMCPTransport,
  StandaloneMCPClientFactory,
  createStandaloneMCPClientFactory,
} from './mcp-client.js';
