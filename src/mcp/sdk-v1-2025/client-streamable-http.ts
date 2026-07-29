/**
 * Browser-safe MCP SDK v1 transport boundary.
 *
 * Kept separate from the Node stdio exports so Beam's browser bundle never
 * traverses Node-only SDK modules.
 */
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
