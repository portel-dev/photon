/**
 * Official MCP TypeScript SDK v2 boundary.
 *
 * The v2 serving entries own protocol-era negotiation.  In particular,
 * `createMcpHandler` and `serveStdio` can serve the modern 2026 protocol and
 * the supported legacy protocol family from one factory.  Keep direct v2
 * imports here so Photon runtime code has one upgrade seam.
 */
export {
  McpServer,
  Server,
  createMcpHandler,
  isLegacyRequest,
  legacyStatelessFallback,
  PerRequestHTTPServerTransport,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';
export type {
  AuthInfo,
  CallToolRequest,
  CallToolResult,
  McpHttpHandler,
  McpHandlerRequestOptions,
  McpRequestContext,
  MessageExtraInfo,
  ServerCapabilities,
  ServerContext,
  ServerNotification,
  ServerOptions,
  Transport,
} from '@modelcontextprotocol/server';
export { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
