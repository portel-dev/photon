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

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPSession {
  id: string;
  initialized: boolean;
  createdAt: Date;
  lastActivity: Date;
  sseResponse?: ServerResponse; // For server-to-client notifications
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

interface MethodInfo {
  name: string;
  description: string;
  params: any;
  linkedUi?: string;
  outputFormat?: string;
  layoutHints?: Record<string, string>;
}

interface ConfigParam {
  name: string;
  envVar: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

interface PhotonInfo {
  name: string;
  path: string;
  configured: boolean;
  methods?: MethodInfo[];
  assets?: {
    ui: Array<{ id: string; uri?: string; mimeType?: string; linkedTool?: string }>;
  };
}

interface UnconfiguredPhotonInfo {
  name: string;
  path: string;
  configured: false;
  requiredParams: ConfigParam[];
  errorMessage: string;
}

type AnyPhotonInfo = PhotonInfo | UnconfiguredPhotonInfo;

interface PhotonMCPInstance {
  instance: any;
}

// ════════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

const sessions = new Map<string, MCPSession>();

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
  configurePhoton?: (photonName: string, config: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
}

const handlers: Record<string, RequestHandler> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  'initialize': async (req, session, ctx) => {
    session.initialized = true;

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
        configurationSchema: Object.keys(configurationSchema).length > 0 ? configurationSchema : undefined,
      },
    };
  },

  'notifications/initialized': async (req, session) => {
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  'ping': async (req) => {
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
        });
      }
    }

    // Add beam system tools
    tools.push({
      name: 'beam/configure',
      description: 'Configure a photon with required parameters. Use initialize response configurationSchema to get required fields.',
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

    return { jsonrpc: '2.0', id: req.id, result: { tools } };
  },

  'tools/call': async (req, session, ctx) => {
    const { name, arguments: args } = req.params as { name: string; arguments?: Record<string, unknown> };

    // Handle beam system tools
    if (name === 'beam/configure') {
      return handleBeamConfigure(req, ctx, args || {});
    }

    if (name === 'beam/browse') {
      return handleBeamBrowse(req, args || {});
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
    const photonInfo = ctx.photons.find(p => p.name === photonName);
    const methodInfo = photonInfo?.configured ? photonInfo.methods?.find(m => m.name === methodName) : undefined;

    // Build UI metadata
    const uiMetadata: Record<string, any> = {};
    if (methodInfo?.linkedUi) {
      uiMetadata['x-ui-uri'] = `ui://${photonName}/${methodInfo.linkedUi}`;
    }
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

    const method = mcp.instance[methodName];
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
      const result = await method.call(mcp.instance, args || {});

      // Handle async generators
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const chunks: any[] = [];
        for await (const chunk of result) {
          if (chunk.emit === 'result') {
            chunks.push(chunk.data);
          } else if (chunk.emit !== 'progress') {
            chunks.push(chunk);
          }
        }
        const finalResult = chunks.length === 1 ? chunks[0] : chunks;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(finalResult, null, 2) }],
            isError: false,
            ...uiMetadata,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
          ...uiMetadata,
        },
      };
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
          mimeType: uiAsset.mimeType || 'text/html',
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
        contents: [{ uri, mimeType: 'text/html', text: content }],
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
          content: [{ type: 'text', text: `Successfully configured ${photonName}. Tools list will be updated.` }],
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
    const filters = filter ? filter.split(',').map(f => f.trim().toLowerCase()) : [];

    const items = entries
      .filter(entry => {
        // Always show directories
        if (entry.isDirectory()) return true;

        // No filter = show all
        if (filters.length === 0) return true;

        const fileName = entry.name.toLowerCase();
        return filters.some(f => {
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
      .map(entry => ({
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
        content: [{
          type: 'text',
          text: JSON.stringify({
            path: targetPath,
            parent: parent !== targetPath ? parent : null,
            items,
          }, null, 2),
        }],
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

// ════════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════════════════

export interface StreamableHTTPOptions {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonMCPInstance>;
  loadUIAsset: (photonName: string, uiId: string) => Promise<string | null>;
  configurePhoton?: (photonName: string, config: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
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
      'Connection': 'keep-alive',
      'Mcp-Session-Id': session.id,
    });

    // Store SSE response for server-initiated messages
    session.sseResponse = res;

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      session.sseResponse = undefined;
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
 */
export function broadcastNotification(method: string, params?: Record<string, unknown>): void {
  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };

  for (const session of sessions.values()) {
    if (session.sseResponse && !session.sseResponse.writableEnded) {
      session.sseResponse.write(`data: ${JSON.stringify(notification)}\n\n`);
    }
  }
}
