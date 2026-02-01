/**
 * Streamable HTTP Transport for MCP
 *
 * Implements the MCP Streamable HTTP transport specification (2025-03-26).
 * This allows standard MCP clients (like Claude Desktop) to connect to Beam.
 *
 * Endpoint: /mcp
 * - POST: Client sends JSON-RPC requests, server responds with JSON or SSE
 * - GET: Opens SSE stream for server-initiated messages
 *
 * Configuration Schema (SEP-1596 inspired):
 * - Returns configurationSchema in initialize response
 * - Uses JSON Schema for rich UI generation (dropdowns, file pickers, etc.)
 * - beam/configure tool for submitting configuration
 * - beam/browse tool for server filesystem browsing
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { PHOTON_VERSION } from '../version.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  ConfigParam,
  MethodInfo,
  PhotonInfo,
  UnconfiguredPhotonInfo,
  AnyPhotonInfo,
  PhotonMCPInstance,
} from './types.js';
import { buildToolMetadataExtensions } from './types.js';

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL TYPES (specific to this transport)
// ════════════════════════════════════════════════════════════════════════════════

interface MCPSession {
  id: string;
  initialized: boolean;
  createdAt: Date;
  lastActivity: Date;
  sseResponse?: ServerResponse; // For server-to-client notifications
  isBeam?: boolean; // True if client is Beam UI
  clientInfo?: { name: string; version: string };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  'x-photon-id'?: string;
  [key: string]: unknown; // Allow additional x-* properties
}

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

const sessions = new Map<string, MCPSession>();

// Pending elicitations - waiting for user input
interface PendingElicitation {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  sessionId: string;
}
const pendingElicitations = new Map<string, PendingElicitation>();

// Clean up old sessions periodically (30 min timeout)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 1000);

function getOrCreateSession(sessionId?: string): MCPSession {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = new Date();
    return session;
  }

  const newSession: MCPSession = {
    id: randomUUID(),
    initialized: false,
    createdAt: new Date(),
    lastActivity: new Date(),
  };
  sessions.set(newSession.id, newSession);
  return newSession;
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION SCHEMA GENERATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Convert ConfigParam to JSON Schema property
 */
function configParamToJsonSchema(param: ConfigParam): Record<string, any> {
  const schema: Record<string, any> = {
    description: `Environment variable: ${param.envVar}`,
    'x-env-var': param.envVar,
  };

  // Map TypeScript types to JSON Schema types
  switch (param.type.toLowerCase()) {
    case 'number':
      schema.type = 'number';
      break;
    case 'boolean':
      schema.type = 'boolean';
      break;
    case 'string':
    default:
      schema.type = 'string';
      // Check for common sensitive parameter names - use OpenAPI standard
      if (/password|secret|token|key|credential/i.test(param.name)) {
        schema.format = 'password';
        schema.writeOnly = true;
      }
      // Check for path-like parameter names
      else if (/path|file|dir|directory|folder/i.test(param.name)) {
        schema.format = 'path';
      }
      break;
  }

  // Add default value if present
  if (param.hasDefault && param.defaultValue !== undefined) {
    schema.default = param.defaultValue;
  }

  return schema;
}

/**
 * Generate configurationSchema for all unconfigured photons
 * Uses JSON Schema format for rich UI generation
 */
function generateConfigurationSchema(photons: AnyPhotonInfo[]): Record<string, any> {
  const schema: Record<string, any> = {};

  for (const photon of photons) {
    // Only include unconfigured photons with params
    if (photon.configured) continue;
    const unconfigured = photon as UnconfiguredPhotonInfo;
    if (!unconfigured.requiredParams || unconfigured.requiredParams.length === 0) continue;

    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of unconfigured.requiredParams) {
      properties[param.name] = configParamToJsonSchema(param);

      // Mark as required if not optional and no default
      if (!param.isOptional && !param.hasDefault) {
        required.push(param.name);
      }
    }

    schema[photon.name] = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      'x-error-message': unconfigured.errorMessage,
      'x-internal': unconfigured.internal,
    };
  }

  return schema;
}

// ════════════════════════════════════════════════════════════════════════════════
// REQUEST HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

type RequestHandler = (
  request: JSONRPCRequest,
  session: MCPSession,
  context: HandlerContext
) => Promise<JSONRPCResponse>;

interface HandlerContext {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonMCPInstance>;
  loadUIAsset: (photonName: string, uiId: string) => Promise<string | null>;
  configurePhoton?: (
    photonName: string,
    config: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  reloadPhoton?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  removePhoton?: (photonName: string) => Promise<{ success: boolean; error?: string }>;
  updateMetadata?: (
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  generatePhotonHelp?: (photonName: string) => Promise<string>;
  loader?: { executeTool: (mcp: any, toolName: string, args: any, options?: any) => Promise<any> };
  broadcast?: (message: object) => void;
  subscriptionManager?: {
    onClientViewingBoard: (
      sessionId: string,
      photon: string,
      board: string,
      lastEventId?: number
    ) => void;
    onClientDisconnect: (sessionId: string) => void;
  };
}

const handlers: Record<string, RequestHandler> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  initialize: async (req, session, ctx) => {
    session.initialized = true;

    // Capture client info and detect Beam clients
    const clientInfo = req.params?.clientInfo as { name: string; version: string } | undefined;
    if (clientInfo) {
      session.clientInfo = clientInfo;
      session.isBeam = clientInfo.name === 'beam';
    }

    // Generate configuration schema for unconfigured photons
    const configurationSchema = generateConfigurationSchema(ctx.photons);

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: {
          name: 'beam-mcp',
          version: PHOTON_VERSION,
        },
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
        },
        // SEP-1596 inspired: configuration schema for unconfigured photons
        // Uses JSON Schema for rich UI generation
        configurationSchema:
          Object.keys(configurationSchema).length > 0 ? configurationSchema : undefined,
      },
    };
  },

  'notifications/initialized': async (req, session) => {
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  // Handle elicitation response from frontend
  'beam/elicitation-response': async (req, session) => {
    const params = req.params as
      | { elicitationId?: string; value?: any; cancelled?: boolean }
      | undefined;
    const elicitationId = params?.elicitationId;

    if (!elicitationId) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing elicitationId' },
      } as JSONRPCResponse;
    }

    const pending = pendingElicitations.get(elicitationId);
    if (!pending) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Unknown elicitationId' },
      } as JSONRPCResponse;
    }

    pendingElicitations.delete(elicitationId);

    if (params?.cancelled) {
      pending.reject(new Error('Elicitation cancelled by user'));
    } else {
      pending.resolve(params?.value);
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true } } as JSONRPCResponse;
  },

  // Client notifies what resource they're viewing (for on-demand subscriptions)
  // photonId: hash of photon path (unique across servers)
  // itemId: whatever the photon uses to identify the item (e.g., board name)
  // lastEventId: optional - for replay of missed events on reconnect
  'beam/viewing': async (req, session, ctx) => {
    const params = req.params as
      | { photonId?: string; itemId?: string; lastEventId?: number }
      | undefined;
    const photonId = params?.photonId;
    const itemId = params?.itemId;
    const lastEventId = params?.lastEventId;
    if (photonId && itemId && ctx.subscriptionManager) {
      ctx.subscriptionManager.onClientViewingBoard(session.id, photonId, itemId, lastEventId);
    }
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  ping: async (req) => {
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Tools
  // ─────────────────────────────────────────────────────────────────────────────
  'tools/list': async (req, session, ctx) => {
    const tools: MCPTool[] = [];

    // Add configured photon methods as tools
    for (const photon of ctx.photons) {
      if (!photon.configured || !photon.methods) continue;

      for (const method of photon.methods) {
        tools.push({
          name: `${photon.name}/${method.name}`,
          description: method.description || `Execute ${method.name}`,
          inputSchema: method.params || { type: 'object', properties: {} },
          'x-photon-id': photon.id, // Unique ID (hash of path) for subscriptions
          'x-photon-path': photon.path, // File path for View Source
          'x-photon-description': photon.description,
          'x-photon-icon': photon.icon,
          'x-photon-internal': photon.internal,
          'x-photon-prompt-count': photon.promptCount ?? 0,
          'x-photon-resource-count': photon.resourceCount ?? 0,
          ...buildToolMetadataExtensions(method),
          // MCP Apps standard: _meta.ui for linked UI resources and visibility
          ...(method.linkedUi || method.visibility
            ? {
                _meta: {
                  ui: {
                    ...(method.linkedUi
                      ? { resourceUri: `ui://${photon.name}/${method.linkedUi}` }
                      : {}),
                    ...(method.visibility ? { visibility: method.visibility } : {}),
                  },
                },
              }
            : {}),
        });
      }
    }

    // Add beam system tools (internal — hidden from sidebar)
    tools.push({
      name: 'beam/configure',
      'x-photon-internal': true,
      description:
        'Configure a photon with required parameters. Use initialize response configurationSchema to get required fields.',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to configure',
          },
          config: {
            type: 'object',
            description: 'Configuration values (key-value pairs matching the configurationSchema)',
            additionalProperties: true,
          },
        },
        required: ['photon', 'config'],
      },
    });

    tools.push({
      name: 'beam/browse',
      description: 'Browse server filesystem for file/directory selection',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (defaults to home directory)',
          },
          filter: {
            type: 'string',
            description: 'File extension filter (e.g., ".pem,.crt" or "*.photon.ts")',
          },
        },
      },
    });

    tools.push({
      name: 'beam/reload',
      description: 'Reload a photon to pick up file changes',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to reload',
          },
        },
        required: ['photon'],
      },
    });

    tools.push({
      name: 'beam/remove',
      description: 'Remove a photon from the workspace',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to remove',
          },
        },
        required: ['photon'],
      },
    });

    tools.push({
      name: 'beam/photon-help',
      description: 'Get rich documentation for a photon',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to get help for',
          },
        },
        required: ['photon'],
      },
    });

    tools.push({
      name: 'beam/update-metadata',
      description: 'Update photon or method metadata (icon, description)',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon',
          },
          method: {
            type: 'string',
            description: 'Name of the method (optional, for method metadata)',
          },
          metadata: {
            type: 'object',
            description: 'Metadata to update (icon, description)',
            properties: {
              icon: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        required: ['photon', 'metadata'],
      },
    });

    // Filter out app-only tools for external (non-Beam) MCP clients
    const visibleTools = session.isBeam
      ? tools
      : tools.filter((t) => {
          const vis = (t as any)._meta?.ui?.visibility;
          if (vis && Array.isArray(vis) && vis.includes('app') && !vis.includes('model')) {
            return false;
          }
          return true;
        });

    return { jsonrpc: '2.0', id: req.id, result: { tools: visibleTools } };
  },

  'tools/call': async (req, session, ctx) => {
    const { name, arguments: args } = req.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

    // Handle beam system tools
    if (name === 'beam/configure') {
      return handleBeamConfigure(req, ctx, args || {});
    }

    if (name === 'beam/browse') {
      return handleBeamBrowse(req, args || {});
    }

    if (name === 'beam/reload') {
      return handleBeamReload(req, ctx, args || {});
    }

    if (name === 'beam/remove') {
      return handleBeamRemove(req, ctx, args || {});
    }

    if (name === 'beam/update-metadata') {
      return handleBeamUpdateMetadata(req, ctx, args || {});
    }

    if (name === 'beam/photon-help') {
      return handleBeamPhotonHelp(req, ctx, args || {});
    }

    // Parse tool name: photon-name/method-name
    const slashIndex = name.indexOf('/');
    if (slashIndex === -1) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Invalid tool name: ${name}` }],
          isError: true,
        },
      };
    }

    const photonName = name.slice(0, slashIndex);
    const methodName = name.slice(slashIndex + 1);

    // Find photon info for UI metadata
    const photonInfo = ctx.photons.find((p) => p.name === photonName);
    const methodInfo = photonInfo?.configured
      ? photonInfo.methods?.find((m) => m.name === methodName)
      : undefined;

    // Build UI metadata
    const uiMetadata: Record<string, any> = {};
    if (methodInfo?.outputFormat) {
      uiMetadata['x-output-format'] = methodInfo.outputFormat;
    }

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp?.instance) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Photon not found: ${photonName}` }],
          isError: true,
        },
      };
    }

    // Check instance first, then prototype, then static methods on class
    let method = mcp.instance[methodName];
    let isStatic = false;

    if (typeof method !== 'function') {
      method = Object.getPrototypeOf(mcp.instance)?.[methodName];
    }

    // Check for static method on class constructor
    if (typeof method !== 'function' && mcp.classConstructor) {
      method = mcp.classConstructor[methodName];
      isStatic = true;
    }

    if (typeof method !== 'function') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Method not found: ${methodName}` }],
          isError: true,
        },
      };
    }

    try {
      // Create outputHandler to capture emits for real-time UI updates
      const outputHandler = (yieldValue: any) => {
        if (!ctx.broadcast) return;

        // Forward progress events as MCP notifications
        if (yieldValue?.emit === 'progress') {
          const rawValue = typeof yieldValue.value === 'number' ? yieldValue.value : 0;
          const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken: `progress_${photonName}_${methodName}`,
              progress,
              total: 100,
              message: yieldValue.message || null,
            },
          });
          return;
        }

        // Forward status events as MCP notifications
        if (yieldValue?.emit === 'status') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken: `progress_${photonName}_${methodName}`,
              progress: 0,
              total: 100,
              message: yieldValue.message || '',
            },
          });
          return;
        }

        // Forward toast events as beam notifications
        if (yieldValue?.emit === 'toast') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'beam/toast',
            params: {
              message: yieldValue.message || '',
              type: yieldValue.type || 'info',
              duration: yieldValue.duration,
            },
          });
          return;
        }

        // Forward thinking events as beam notifications
        if (yieldValue?.emit === 'thinking') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'beam/thinking',
            params: {
              active: yieldValue.active ?? true,
            },
          });
          return;
        }

        // Forward log events as beam notifications
        if (yieldValue?.emit === 'log') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'beam/log',
            params: {
              message: yieldValue.message || '',
              level: yieldValue.level || 'info',
              data: yieldValue.data,
            },
          });
          return;
        }

        // Forward channel events (task-moved, task-updated, etc.) with full delta
        // These contain specific event type + data for efficient UI updates
        if (yieldValue?.channel && yieldValue?.event) {
          ctx.broadcast({
            type: 'channel-event',
            photon: photonName,
            channel: yieldValue.channel,
            event: yieldValue.event,
            data: yieldValue.data,
          });
        }
        // Note: board-update emits are intentionally not forwarded here
        // Channel events provide more specific info for real-time updates
      };

      // Create inputProvider to handle ask yields (elicitation)
      const inputProvider = async (ask: any): Promise<any> => {
        if (!ctx.broadcast) {
          throw new Error('No broadcast connection for elicitation');
        }

        // Generate unique elicitation ID
        const elicitationId = randomUUID();

        return new Promise((resolve, reject) => {
          // Store pending elicitation
          pendingElicitations.set(elicitationId, {
            resolve,
            reject,
            sessionId: session?.id || '',
          });

          // Broadcast elicitation request to frontend
          ctx.broadcast!({
            jsonrpc: '2.0',
            method: 'beam/elicitation',
            params: {
              elicitationId,
              ...ask,
            },
          });

          // Timeout after 5 minutes
          setTimeout(() => {
            if (pendingElicitations.has(elicitationId)) {
              pendingElicitations.delete(elicitationId);
              reject(new Error('Elicitation timeout - no response received'));
            }
          }, 300000);
        });
      };

      // Use loader.executeTool if available (sets up execution context for this.emit())
      // Fall back to direct method call for backward compatibility
      let result: any;
      if (ctx.loader) {
        result = await ctx.loader.executeTool(mcp, methodName, args || {}, {
          outputHandler,
          inputProvider,
        });
      } else {
        // For static methods, don't bind to instance
        result = isStatic ? await method(args || {}) : await method.call(mcp.instance, args || {});
      }

      // Handle async generators (when not using loader)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const chunks: any[] = [];
        for await (const chunk of result) {
          if (chunk.emit === 'result') {
            chunks.push(chunk.data);
          } else if (chunk.emit === 'board-update' && ctx.broadcast) {
            // Forward board-update from generator
            ctx.broadcast({
              type: 'board-update',
              photon: photonName,
              board: chunk.board,
            });
          } else if (chunk.emit !== 'progress') {
            chunks.push(chunk);
          }
        }
        const finalResult = chunks.length === 1 ? chunks[0] : chunks;
        const genResponse = {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(finalResult, null, 2) }],
            isError: false,
            ...uiMetadata,
          },
        };

        // Broadcast tool result as MCP Apps notification for linked-UI methods
        if (ctx.broadcast && methodInfo?.linkedUi) {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              toolName: `${photonName}/${methodName}`,
              result: genResponse.result,
              isError: false,
            },
          });
        }

        return genResponse;
      }

      const toolResponse = {
        jsonrpc: '2.0' as const,
        id: req.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
          ...uiMetadata,
        },
      };

      // Broadcast tool result as MCP Apps notification for linked-UI methods
      if (ctx.broadcast && methodInfo?.linkedUi) {
        ctx.broadcast({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            toolName: `${photonName}/${methodName}`,
            result: toolResponse.result,
            isError: false,
          },
        });
      }

      return toolResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        },
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Resources (MCP Apps ui:// scheme)
  // ─────────────────────────────────────────────────────────────────────────────
  'resources/list': async (req, session, ctx) => {
    const resources: MCPResource[] = [];

    for (const photon of ctx.photons) {
      if (!photon.configured || !photon.assets?.ui) continue;

      for (const uiAsset of photon.assets.ui) {
        const uri = (uiAsset as any).uri || `ui://${photon.name}/${uiAsset.id}`;
        resources.push({
          uri,
          name: uiAsset.id,
          mimeType: uiAsset.mimeType || 'text/html;profile=mcp-app',
          description: uiAsset.linkedTool
            ? `UI template for ${photon.name}/${uiAsset.linkedTool}`
            : `UI template: ${uiAsset.id}`,
        });
      }
    }

    return { jsonrpc: '2.0', id: req.id, result: { resources } };
  },

  'resources/read': async (req, session, ctx) => {
    const { uri } = req.params as { uri: string };

    // Parse ui:// URI
    const match = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Invalid URI: ${uri}` },
      };
    }

    const [, photonName, uiId] = match;
    const content = await ctx.loadUIAsset(photonName, uiId);

    if (!content) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Resource not found: ${uri}` },
      };
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: content }],
      },
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// BEAM SYSTEM TOOLS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Handle beam/configure tool - configure a photon with provided values
 */
async function handleBeamConfigure(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName, config } = args as { photon: string; config: Record<string, any> };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!config || typeof config !== 'object') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: config object is required' }],
        isError: true,
      },
    };
  }

  // Check if configurePhoton callback is available
  if (!ctx.configurePhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Configuration not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.configurePhoton(photonName, config);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully configured ${photonName}. Tools list will be updated.`,
            },
          ],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to configure ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error configuring ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/browse tool - browse server filesystem
 */
async function handleBeamBrowse(
  req: JSONRPCRequest,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { path: requestedPath, filter } = args as { path?: string; filter?: string };

  // Default to home directory
  let targetPath = requestedPath || homedir();

  // Handle relative navigation (.. for parent)
  if (targetPath.endsWith('/..') || targetPath === '..') {
    targetPath = dirname(targetPath.replace(/\/?\.\.$/, ''));
  }

  try {
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      targetPath = dirname(targetPath);
    }

    const entries = await readdir(targetPath, { withFileTypes: true });

    // Parse filter
    const filters = filter ? filter.split(',').map((f) => f.trim().toLowerCase()) : [];

    const items = entries
      .filter((entry) => {
        // Always show directories
        if (entry.isDirectory()) return true;

        // No filter = show all
        if (filters.length === 0) return true;

        const fileName = entry.name.toLowerCase();
        return filters.some((f) => {
          // Handle glob patterns like "*.photon.ts"
          if (f.startsWith('*.')) {
            const suffix = f.slice(1);
            return fileName.endsWith(suffix);
          }
          // Handle extension patterns like ".ts" or "ts"
          const ext = f.startsWith('.') ? f : `.${f}`;
          return fileName.endsWith(ext);
        });
      })
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        isDirectory: entry.isDirectory(),
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    // Calculate parent path
    const parent = dirname(targetPath);

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                path: targetPath,
                parent: parent !== targetPath ? parent : null,
                items,
              },
              null,
              2
            ),
          },
        ],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error browsing ${targetPath}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/reload tool - reload a photon
 */
async function handleBeamReload(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.reloadPhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Reload not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.reloadPhoton(photonName);

    if (result.success) {
      // Notify Beam clients about the reload
      broadcastToBeam('beam/hot-reload', { photon: result.photon });
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Successfully reloaded ${photonName}` }],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to reload ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error reloading ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/remove tool - remove a photon from the workspace
 */
async function handleBeamRemove(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.removePhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Remove not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.removePhoton(photonName);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Successfully removed ${photonName}` }],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to remove ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error removing ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/update-metadata tool - update photon or method metadata
 */
async function handleBeamUpdateMetadata(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const {
    photon: photonName,
    method: methodName,
    metadata,
  } = args as {
    photon: string;
    method?: string;
    metadata: Record<string, any>;
  };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!metadata || typeof metadata !== 'object') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: metadata object is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.updateMetadata) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Update metadata not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.updateMetadata(photonName, methodName || null, metadata);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully updated metadata for ${methodName ? `${photonName}/${methodName}` : photonName}`,
            },
          ],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to update metadata: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error updating metadata: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/photon-help tool - get rich documentation for a photon
 */
async function handleBeamPhotonHelp(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.generatePhotonHelp) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Help generation not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const markdown = await ctx.generatePhotonHelp(photonName);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: markdown }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error generating help: ${message}` }],
        isError: true,
      },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════════════════

export interface StreamableHTTPOptions {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonMCPInstance>;
  loadUIAsset: (photonName: string, uiId: string) => Promise<string | null>;
  configurePhoton?: (
    photonName: string,
    config: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  reloadPhoton?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  removePhoton?: (photonName: string) => Promise<{ success: boolean; error?: string }>;
  updateMetadata?: (
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  generatePhotonHelp?: (photonName: string) => Promise<string>;
  loader?: { executeTool: (mcp: any, toolName: string, args: any, options?: any) => Promise<any> };
  broadcast?: (message: object) => void;
  subscriptionManager?: {
    onClientViewingBoard: (
      sessionId: string,
      photon: string,
      board: string,
      lastEventId?: number
    ) => void;
    onClientDisconnect: (sessionId: string) => void;
  };
}

/**
 * Handle MCP Streamable HTTP requests
 */
export async function handleStreamableHTTP(
  req: IncomingMessage,
  res: ServerResponse,
  options: StreamableHTTPOptions
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Only handle /mcp endpoint
  if (url.pathname !== '/mcp') {
    return false;
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Get or create session
  // Check header first, then query parameter (for SSE which can't set headers)
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId) {
    sessionId = url.searchParams.get('sessionId') || undefined;
  }
  const session = getOrCreateSession(sessionId);

  // GET - Open SSE stream for server notifications
  if (req.method === 'GET') {
    const accept = req.headers.accept || '';
    if (!accept.includes('text/event-stream')) {
      res.writeHead(406);
      res.end('Accept header must include text/event-stream');
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'Mcp-Session-Id': session.id,
    });

    // Disable Nagle's algorithm for immediate writes
    res.socket?.setNoDelay(true);

    // Store SSE response for server-initiated messages
    session.sseResponse = res;

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      session.sseResponse = undefined;
      // Clean up subscriptions when client disconnects
      if (options.subscriptionManager) {
        options.subscriptionManager.onClientDisconnect(session.id);
      }
    });

    return true;
  }

  // POST - Handle JSON-RPC requests
  if (req.method === 'POST') {
    const accept = req.headers.accept || '';
    const wantsSSE = accept.includes('text/event-stream');

    // Read body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let requests: JSONRPCRequest[];
    try {
      const parsed = JSON.parse(body);
      requests = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return true;
    }

    const context: HandlerContext = {
      photons: options.photons,
      photonMCPs: options.photonMCPs,
      loadUIAsset: options.loadUIAsset,
      configurePhoton: options.configurePhoton,
      reloadPhoton: options.reloadPhoton,
      removePhoton: options.removePhoton,
      updateMetadata: options.updateMetadata,
      generatePhotonHelp: options.generatePhotonHelp,
      loader: options.loader,
      broadcast: options.broadcast,
      subscriptionManager: options.subscriptionManager,
    };

    // Process requests
    const responses: JSONRPCResponse[] = [];

    for (const request of requests) {
      const handler = handlers[request.method];

      if (!handler) {
        if (request.id !== undefined) {
          responses.push({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          });
        }
        continue;
      }

      const response = await handler(request, session, context);

      // Only include responses for requests (not notifications)
      if (request.id !== undefined && response.id !== undefined) {
        responses.push(response);
      }
    }

    // Send response
    if (responses.length === 0) {
      // All were notifications
      res.writeHead(202);
      res.end();
    } else if (wantsSSE) {
      // SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Mcp-Session-Id': session.id,
      });

      for (const response of responses) {
        res.write(`data: ${JSON.stringify(response)}\n\n`);
      }
      res.end();
    } else {
      // JSON response
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': session.id,
      });

      const result = responses.length === 1 ? responses[0] : responses;
      res.end(JSON.stringify(result));
    }

    return true;
  }

  // Method not allowed
  res.writeHead(405);
  res.end('Method not allowed');
  return true;
}

/**
 * Send a notification to all connected SSE clients
 * @param method - The notification method name
 * @param params - Optional parameters for the notification
 * @param beamOnly - If true, only send to Beam clients (clientInfo.name === "beam")
 */
export function broadcastNotification(
  method: string,
  params?: Record<string, unknown>,
  beamOnly = false
): void {
  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };

  for (const session of sessions.values()) {
    if (session.sseResponse && !session.sseResponse.writableEnded) {
      // Skip non-Beam clients if beamOnly is true
      if (beamOnly && !session.isBeam) continue;
      session.sseResponse.write(`data: ${JSON.stringify(notification)}\n\n`);
    }
  }
}

/**
 * Send a notification to Beam clients only
 */
export function broadcastToBeam(method: string, params?: Record<string, unknown>): void {
  broadcastNotification(method, params, true);
}

/**
 * Get count of active sessions (for debugging)
 */
export function getActiveSessionCount(): { total: number; beam: number } {
  let total = 0;
  let beam = 0;
  for (const session of sessions.values()) {
    if (session.sseResponse && !session.sseResponse.writableEnded) {
      total++;
      if (session.isBeam) beam++;
    }
  }
  return { total, beam };
}

/**
 * Send a notification to a specific session by ID
 * Used for replaying missed events on reconnect
 */
export function sendToSession(
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): boolean {
  const session = sessions.get(sessionId);
  if (!session?.sseResponse || session.sseResponse.writableEnded) {
    return false;
  }
  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };
  session.sseResponse.write(`data: ${JSON.stringify(notification)}\n\n`);
  return true;
}
