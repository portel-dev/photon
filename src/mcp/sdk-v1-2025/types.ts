/**
 * Re-exports required by the MCP 2025 SDK adapter.
 *
 * Do not add MCP 2026 canonical result types here. New protocol shapes live in
 * src/mcp/protocol and are encoded by Photon's versioned wire adapters.
 */
export {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  RootsListChangedNotificationSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ElicitRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
export type { ServerCapabilities, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
