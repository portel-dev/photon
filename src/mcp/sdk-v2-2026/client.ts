/**
 * Official MCP TypeScript SDK v2 client boundary.
 *
 * Photon-specific behavior belongs in the fetch decorator and lifecycle code,
 * not in a second JSON-RPC client implementation. Keeping these imports behind
 * one seam makes the SDK upgrade explicit and prevents accidental v1 client
 * usage from returning to Beam.
 */
export {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  fromJsonSchema,
} from '@modelcontextprotocol/client';
export { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
export type { Client as ClientType } from '@modelcontextprotocol/client';
