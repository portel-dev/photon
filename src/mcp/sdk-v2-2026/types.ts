/**
 * Public MCP method constants used by Photon's low-level registration layer.
 *
 * MCP SDK v2 intentionally no longer exports the v1 Zod schema constants from
 * its root API.  The official v2 `Server.setRequestHandler` accepts these
 * protocol method names directly and performs the version-aware validation.
 */
export const CallToolRequestSchema = 'tools/call' as const;
export const ListToolsRequestSchema = 'tools/list' as const;
export const ListPromptsRequestSchema = 'prompts/list' as const;
export const GetPromptRequestSchema = 'prompts/get' as const;
export const ListResourcesRequestSchema = 'resources/list' as const;
export const ListResourceTemplatesRequestSchema = 'resources/templates/list' as const;
export const ReadResourceRequestSchema = 'resources/read' as const;
export const SubscribeRequestSchema = 'resources/subscribe' as const;
export const UnsubscribeRequestSchema = 'resources/unsubscribe' as const;
export const RootsListChangedNotificationSchema = 'notifications/roots/list_changed' as const;
export const GetTaskRequestSchema = 'tasks/get' as const;
export const ListTasksRequestSchema = 'tasks/list' as const;
export const CancelTaskRequestSchema = 'tasks/cancel' as const;
export const GetTaskPayloadRequestSchema = 'tasks/result' as const;
export const ElicitRequestSchema = 'elicitation/create' as const;

export type {
  CallToolRequest,
  CallToolResult,
  ServerCapabilities,
  ServerNotification,
} from '@modelcontextprotocol/server';
