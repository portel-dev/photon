/**
 * MCP TypeScript SDK v1 boundary.
 *
 * The v1 SDK implements Photon's sessionful MCP 2025 server transports. Keep
 * every direct v1 import in this directory so the canonical runtime and the
 * MCP 2026 wire adapter cannot accidentally acquire v1-only result types.
 */
export { Server } from '@modelcontextprotocol/sdk/server/index.js';
export { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
export { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
export type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
