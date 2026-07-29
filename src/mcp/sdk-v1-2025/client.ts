/**
 * MCP TypeScript SDK v1 client boundary used for legacy/external transports.
 *
 * Photon-owned protocol types must not be defined in terms of these classes.
 */
export { Client } from '@modelcontextprotocol/sdk/client/index.js';
export { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
export type { Client as ClientType } from '@modelcontextprotocol/sdk/client/index.js';
