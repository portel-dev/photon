/**
 * Official MCP TypeScript SDK v2 Node adapter boundary.
 *
 * Beam owns its surrounding HTTP policy (CORS, rate limits, and bearer
 * verification), while the official adapter owns Node/Web conversion,
 * streaming backpressure, cancellation, and response writes.
 */
export { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
export type {
  FetchLikeMcpHandler,
  NodeIncomingMessageLike,
  NodeMcpRequestHandler,
  NodeServerResponseLike,
  ToNodeHandlerOptions,
  ToWebRequestOptions,
} from '@modelcontextprotocol/node';
