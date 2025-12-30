/**
 * MCP Client for Photon Runtime
 *
 * Re-exports from @portel/photon-core for backward compatibility.
 * The SDK-based transport implementation is now in photon-core.
 */

// Re-export everything from photon-core's SDK transport
export {
  SDKMCPTransport,
  SDKMCPClientFactory,
  loadMCPConfig,
  createSDKMCPClientFactory,
  resolveMCPSource,
  type MCPServerConfig,
  type MCPConfig,
} from '@portel/photon-core';

// Backward compatibility aliases
export {
  SDKMCPTransport as StandaloneMCPTransport,
  SDKMCPClientFactory as StandaloneMCPClientFactory,
  createSDKMCPClientFactory as createStandaloneMCPClientFactory,
} from '@portel/photon-core';
