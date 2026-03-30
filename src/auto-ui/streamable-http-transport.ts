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
import { readdir, stat, readFile, writeFile } from 'fs/promises';
import { join, dirname, extname, resolve, normalize } from 'path';
import { homedir } from 'os';
import { PHOTON_VERSION } from '../version.js';
import { formatToolError } from '../shared/error-handler.js';
import { AGUIEventType } from '../ag-ui/types.js';
import { proxyExternalAgent, createAGUIOutputHandler } from '../ag-ui/adapter.js';
import type { RunAgentInput } from '../ag-ui/types.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  ConfigParam,
  MethodInfo,
  PhotonInfo,
  UnconfiguredPhotonInfo,
  AnyPhotonInfo,
  PhotonInstance,
  ExternalMCPInfo,
} from './types.js';
import { buildToolMetadataExtensions } from './types.js';
import { generateServerCard } from '../server-card.js';
import { audit } from '../shared/audit.js';
import { writePhotonEditorDeclaration } from '../photon-editor-declarations.js';
import {
  createTask,
  getTask,
  updateTask,
  listTasks,
  registerController,
  unregisterController,
  getController,
} from '../tasks/store.js';
import { generateAgentCard } from '../a2a/card-generator.js';

// ════════════════════════════════════════════════════════════════════════════════
// JWT HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Decode a JWT payload without verification (validation is done by the auth server).
 * Returns CallerInfo from the standard OIDC claims.
 */
function decodeJWTCaller(authHeader: string | string[] | undefined): CallerInfo | undefined {
  if (Array.isArray(authHeader)) authHeader = authHeader[0];
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return {
      id: payload.sub || payload.client_id || 'unknown',
      name: payload.name || payload.preferred_username,
      anonymous: false,
      scope: payload.scope,
      claims: payload,
    };
  } catch {
    return undefined;
  }
}

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
  /** Tracked instance name for daemon drift recovery */
  instanceName?: string;
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
  timer?: ReturnType<typeof setTimeout>;
}
const pendingElicitations = new Map<string, PendingElicitation>();

// ════════════════════════════════════════════════════════════════════════════════
// PERSISTENT APPROVALS — durable HITL that survives navigation/restart
// ════════════════════════════════════════════════════════════════════════════════

interface PersistentApproval {
  id: string;
  runId?: string;
  photon: string;
  method: string;
  message: string;
  preview?: unknown;
  destructive?: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}

const APPROVALS_DIR = join(homedir(), '.photon', 'state');

function approvalsPath(photonName: string): string {
  return join(APPROVALS_DIR, photonName, 'approvals.json');
}

async function loadApprovals(photonName: string): Promise<PersistentApproval[]> {
  try {
    const data = await readFile(approvalsPath(photonName), 'utf-8');
    return JSON.parse(data) as PersistentApproval[];
  } catch {
    return [];
  }
}

async function saveApprovals(photonName: string, approvals: PersistentApproval[]): Promise<void> {
  const dir = dirname(approvalsPath(photonName));
  const { mkdirSync } = await import('fs');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* exists */
  }
  await writeFile(approvalsPath(photonName), JSON.stringify(approvals, null, 2));
}

async function addApproval(approval: PersistentApproval): Promise<void> {
  const approvals = await loadApprovals(approval.photon);
  approvals.push(approval);
  await saveApprovals(approval.photon, approvals);
}

async function resolveApproval(
  photonName: string,
  approvalId: string,
  status: 'approved' | 'rejected'
): Promise<PersistentApproval | undefined> {
  const approvals = await loadApprovals(photonName);
  const idx = approvals.findIndex((a) => a.id === approvalId);
  if (idx === -1) return undefined;
  approvals[idx].status = status;
  await saveApprovals(photonName, approvals);
  return approvals[idx];
}

async function getAllPendingApprovals(photonNames: string[]): Promise<PersistentApproval[]> {
  const all: PersistentApproval[] = [];
  const now = new Date().toISOString();
  for (const name of photonNames) {
    const approvals = await loadApprovals(name);
    for (const a of approvals) {
      if (a.status === 'pending') {
        // Auto-expire
        if (a.expiresAt && a.expiresAt < now) {
          a.status = 'expired';
        } else {
          all.push(a);
        }
      }
    }
    // Persist any expirations
    if (approvals.some((a) => a.status === 'expired')) {
      await saveApprovals(name, approvals);
    }
  }
  return all;
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 5 * 60 * 1000; // default 5 min
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 5 * 60 * 1000;
  }
}

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
 * Generate configurationSchema for all photons with constructor params
 * Uses JSON Schema format for rich UI generation
 * Includes both unconfigured and configured photons (for reconfiguration)
 */
function generateConfigurationSchema(photons: AnyPhotonInfo[]): Record<string, any> {
  const schema: Record<string, any> = {};

  for (const photon of photons) {
    const params = (photon as any).requiredParams as any[] | undefined;
    const unconfigured = photon as UnconfiguredPhotonInfo;
    const isLoadError = !photon.configured && unconfigured.errorReason === 'load-error';

    // Skip configured photons with no constructor params unless they're a load-error
    if (photon.configured || (!isLoadError && (!params || params.length === 0))) continue;

    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of params ?? []) {
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
      'x-error-reason': unconfigured.errorReason,
      'x-error-message': unconfigured.errorMessage,
      'x-internal': (photon as any).internal,
      'x-configured': photon.configured || undefined,
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

interface CallerInfo {
  id: string;
  name?: string;
  anonymous: boolean;
  scope?: string;
  claims?: Record<string, unknown>;
}

interface HandlerContext {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonInstance>;
  externalMCPs?: ExternalMCPInfo[];
  externalMCPClients?: Map<string, any>;
  externalMCPSDKClients?: Map<string, any>; // SDK clients with full CallToolResult support
  reconnectExternalMCP?: (name: string) => Promise<{ success: boolean; error?: string }>;
  loadUIAsset: (
    photonName: string,
    uiId: string
  ) => Promise<{ content: string; isPhotonTemplate: boolean } | null>;
  /** Working directory override (base dir for state/config/cache) */
  workingDir?: string;
  /** Authenticated caller from MCP OAuth (JWT) */
  caller?: CallerInfo;
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
      lastTimestamp?: number
    ) => void;
    onClientDisconnect: (sessionId: string) => void;
  };
}

/**
 * Format a tool result for MCP content text.
 * Mirrors server.ts formatResult(): strings returned as-is, objects/arrays JSON-stringified,
 * other primitives converted via String().
 */
/**
 * Extract tool arguments from AG-UI messages.
 * Uses the last user message content, attempting JSON parse first.
 */
function extractArgsFromMessages(
  messages?: Array<{ role: string; content: string }>
): Record<string, unknown> | undefined {
  if (!messages || messages.length === 0) return undefined;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return undefined;
  try {
    const parsed = JSON.parse(lastUser.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — wrap as message arg
  }
  return { message: lastUser.content };
}

function formatResultText(result: any): string {
  if (result === undefined || result === null) return 'Done';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') return JSON.stringify(result, null, 2);
  return String(result);
}

/**
 * Build a text content block, optionally with MCP content annotations (audience, priority)
 */
function buildTextContent(
  text: string,
  methodInfo?: MethodInfo
): { type: 'text'; text: string; annotations?: Record<string, unknown> } {
  const block: { type: 'text'; text: string; annotations?: Record<string, unknown> } = {
    type: 'text',
    text,
  };
  if (methodInfo?.audience || methodInfo?.contentPriority !== undefined) {
    const annotations: Record<string, unknown> = {};
    if (methodInfo.audience) annotations.audience = methodInfo.audience;
    if (methodInfo.contentPriority !== undefined) annotations.priority = methodInfo.contentPriority;
    block.annotations = annotations;
  }
  return block;
}

/**
 * Build a tool call result, optionally with structuredContent when outputSchema is declared
 */
function buildToolResult(
  result: any,
  methodInfo?: MethodInfo
): { content: any[]; isError: false; structuredContent?: any; [key: string]: unknown } {
  // _meta format transformation: pre-formatted text bypasses normal formatting
  if (result && typeof result === 'object' && result._metaFormatted === true) {
    const content: any = { type: 'text', text: result.text };
    if (result.mimeType) {
      content.annotations = { mimeType: result.mimeType };
    }
    return { content: [content], isError: false };
  }

  const text = formatResultText(result);
  const toolResult: {
    content: any[];
    isError: false;
    structuredContent?: any;
    [key: string]: unknown;
  } = {
    content: [buildTextContent(text, methodInfo)],
    isError: false,
  };
  // When outputSchema is declared and result is an object, include structuredContent
  if (methodInfo?.outputSchema && result && typeof result === 'object' && !Array.isArray(result)) {
    toolResult.structuredContent = result;
  }
  return toolResult;
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
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'beam-mcp',
          version: PHOTON_VERSION,
        },
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
          tasks: {},
          experimental: {
            'ag-ui': {
              version: '0.1.0',
              events: Object.values(AGUIEventType),
            },
          },
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

  // ─────────────────────────────────────────────────────────────────────────────
  // AG-UI Protocol
  // ─────────────────────────────────────────────────────────────────────────────

  'ag-ui/run': async (req, session, ctx) => {
    const params = req.params as {
      agentUrl?: string;
      photon?: string;
      method?: string;
      input: RunAgentInput;
    };

    if (!params?.input) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required field: input (RunAgentInput)' },
      } as JSONRPCResponse;
    }

    if (!ctx.broadcast) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32600, message: 'No SSE connection for AG-UI event streaming' },
      } as JSONRPCResponse;
    }

    const broadcast = ctx.broadcast;

    // ── Proxy mode: forward to external AG-UI agent ──
    if (params.agentUrl) {
      try {
        await proxyExternalAgent(params.agentUrl, params.input, broadcast);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({
          jsonrpc: '2.0',
          method: 'ag-ui/event',
          params: {
            type: AGUIEventType.RUN_ERROR,
            message: `Proxy error: ${message}`,
            timestamp: Date.now(),
          },
        });
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { success: true },
      };
    }

    // ── Local mode: execute photon method with AG-UI events ──
    if (!params.photon || !params.method) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32602,
          message: 'Either agentUrl (proxy) or photon+method (local) must be provided',
        },
      } as JSONRPCResponse;
    }

    const photonName = params.photon;
    const methodName = params.method;
    const runId = params.input.runId;

    // Find the photon MCP instance
    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp) {
      broadcast({
        jsonrpc: '2.0',
        method: 'ag-ui/event',
        params: {
          type: AGUIEventType.RUN_ERROR,
          message: `Photon not found: ${photonName}`,
          timestamp: Date.now(),
        },
      });
      return { jsonrpc: '2.0', id: req.id, result: { success: false } };
    }

    const agui = createAGUIOutputHandler(photonName, methodName, runId, broadcast);

    try {
      // Build args from input messages (last user message content) or forwarded props
      const args =
        (params.input.forwardedProps as Record<string, unknown>) ||
        extractArgsFromMessages(params.input.messages) ||
        {};

      let result: any;
      if (ctx.loader) {
        result = await ctx.loader.executeTool(mcp, methodName, args, {
          outputHandler: agui.outputHandler,
          caller: ctx.caller,
        });
      } else {
        const method = mcp.instance[methodName];
        if (typeof method !== 'function') {
          agui.error(`Method not found: ${photonName}/${methodName}`);
          return { jsonrpc: '2.0', id: req.id, result: { success: false } };
        }
        result = await method.call(mcp.instance, args);
      }

      // Handle async generators
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const iterator = result[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) {
            agui.finish(value);
            break;
          }
          agui.outputHandler(value);
        }
      } else {
        agui.finish(result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      agui.error(message);
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true } };
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
    if (pending.timer) clearTimeout(pending.timer);

    if (params?.cancelled) {
      pending.reject(new Error('Elicitation cancelled by user'));
    } else {
      pending.resolve(params?.value);
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true } } as JSONRPCResponse;
  },

  // Handle persistent approval response from approvals panel
  'beam/approval-response': async (req, session, ctx) => {
    const params = req.params as
      | { approvalId?: string; photon?: string; approved?: boolean }
      | undefined;

    if (!params?.approvalId || !params?.photon) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing approvalId or photon' },
      } as JSONRPCResponse;
    }

    const status = params.approved ? 'approved' : 'rejected';
    const approval = await resolveApproval(params.photon, params.approvalId, status);

    if (!approval) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Approval not found or already resolved' },
      } as JSONRPCResponse;
    }

    // If the elicitation is still in-flight (user responded via panel before timeout),
    // resolve it through the normal elicitation path
    const pending = pendingElicitations.get(params.approvalId);
    if (pending) {
      pendingElicitations.delete(params.approvalId);
      if (pending.timer) clearTimeout(pending.timer);
      if (params.approved) {
        pending.resolve(true);
      } else {
        pending.reject(new Error('Approval rejected by user'));
      }
    }

    // Broadcast approval state change for UI updates
    if (ctx.broadcast) {
      ctx.broadcast({
        jsonrpc: '2.0',
        method: 'beam/approval-resolved',
        params: { approvalId: params.approvalId, photon: params.photon, status },
      });
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true, status } } as JSONRPCResponse;
  },

  // List all pending approvals (for sidebar badge)
  'beam/approvals-list': async (req, session, ctx) => {
    const photonNames = ctx.photons.map((p: any) => p.name);
    const approvals = await getAllPendingApprovals(photonNames);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { approvals },
    } as JSONRPCResponse;
  },

  // Client notifies what resource they're viewing (for on-demand subscriptions)
  // photonId: hash of photon path (unique across servers)
  // itemId: whatever the photon uses to identify the item (e.g., board name)
  // lastTimestamp: optional - for delta sync of missed events on reconnect
  'beam/viewing': async (req, session, ctx) => {
    const params = req.params as
      | { photonId?: string; itemId?: string; lastTimestamp?: number }
      | undefined;
    const photonId = params?.photonId;
    const itemId = params?.itemId;
    const lastTimestamp = params?.lastTimestamp;
    if (photonId && itemId && ctx.subscriptionManager) {
      ctx.subscriptionManager.onClientViewingBoard(session.id, photonId, itemId, lastTimestamp);
    }
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // A2A Agent Card (via MCP transport)
  // ─────────────────────────────────────────────────────────────────────────────
  'a2a/card': async (req, session, ctx) => {
    const configuredPhotons = ctx.photons
      .filter((p): p is PhotonInfo => p.configured)
      .filter((p) => !p.internal);
    const card = generateAgentCard(
      configuredPhotons.map((p) => ({
        name: p.name,
        description: p.description,
        stateful: p.stateful,
        icon: p.icon,
        methods: p.methods.map((m) => ({
          name: m.name,
          description: m.description,
          params: m.params,
        })),
      })),
      { version: PHOTON_VERSION }
    );
    return { jsonrpc: '2.0', id: req.id, result: card } as JSONRPCResponse;
  },

  ping: async (req) => {
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Server Card (discovery via MCP)
  // ─────────────────────────────────────────────────────────────────────────────
  'server/card': async (req, _session, ctx) => {
    const card = generateServerCard(ctx.photons);
    return { jsonrpc: '2.0', id: req.id, result: card };
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
          'x-photon-stateful': photon.stateful || false,
          'x-photon-has-settings': photon.hasSettings || false,
          'x-photon-install-source': photon.installSource,
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

    // Add runtime-injected instance tools for stateful photons
    for (const photon of ctx.photons) {
      if (!photon.configured || !photon.stateful) continue;
      tools.push({
        name: `${photon.name}/_use`,
        description: `Switch to a named instance of ${photon.name}. Omit name to select interactively.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Instance name (empty for default). Omit to select interactively.',
            },
          },
        },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: `${photon.name}/_instances`,
        description: `List all available instances of ${photon.name}.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: `${photon.name}/_undo`,
        description: `Undo the last state mutation on ${photon.name}. Reverts the most recent change.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: `${photon.name}/_redo`,
        description: `Redo the last undone mutation on ${photon.name}. Re-applies a previously undone change.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
    }

    // Add external MCP tools (from mcpServers in config.json)
    if (ctx.externalMCPs) {
      for (const mcp of ctx.externalMCPs) {
        if (!mcp.connected || !mcp.methods) continue;

        for (const method of mcp.methods) {
          tools.push({
            name: `${mcp.name}/${method.name}`,
            description: method.description || `Execute ${method.name}`,
            inputSchema: method.params || { type: 'object', properties: {} },
            'x-external-mcp': true, // Marker for frontend to identify external MCPs
            'x-external-mcp-id': mcp.id,
            'x-photon-icon': mcp.icon || '🔌',
            'x-photon-description': mcp.description,
            'x-photon-prompt-count': mcp.promptCount ?? 0,
            'x-photon-resource-count': mcp.resourceCount ?? 0,
            'x-has-mcp-app': mcp.hasApp ?? false, // MCP Apps Extension detected
            'x-mcp-app-uri': mcp.appResourceUri, // MCP App resource URI (default/first)
            'x-mcp-app-uris': mcp.appResourceUris || [], // All MCP App resource URIs
            ...buildToolMetadataExtensions(method),
            // MCP Apps standard: _meta.ui for linked UI resources and visibility
            ...(method.linkedUi || method.visibility
              ? {
                  _meta: {
                    ui: {
                      ...(method.linkedUi ? { resourceUri: method.linkedUi } : {}),
                      ...(method.visibility ? { visibility: method.visibility } : {}),
                    },
                  },
                }
              : {}),
          });
        }
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

    tools.push({
      name: 'beam/reconnect-mcp',
      'x-photon-internal': true,
      description: 'Reconnect a disconnected external MCP server',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the external MCP to reconnect',
          },
        },
        required: ['name'],
      },
    });

    tools.push({
      name: 'beam/studio-read',
      'x-photon-internal': true,
      description: 'Read a photon source file for editing in Studio',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to read',
          },
        },
        required: ['name'],
      },
    });

    tools.push({
      name: 'beam/studio-write',
      'x-photon-internal': true,
      description: 'Write photon source and trigger hot-reload',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to write',
          },
          source: {
            type: 'string',
            description: 'The new source code',
          },
        },
        required: ['name', 'source'],
      },
    });

    tools.push({
      name: 'beam/studio-project',
      'x-photon-internal': true,
      description: 'Resolve local support files for Studio TypeScript context',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to resolve from',
          },
          source: {
            type: 'string',
            description: 'Current unsaved source code to resolve imports from',
          },
        },
        required: ['name', 'source'],
      },
    });

    tools.push({
      name: 'beam/studio-apply-files',
      'x-photon-internal': true,
      description: 'Apply coordinated Studio file updates across the photon project',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon being edited',
          },
          source: {
            type: 'string',
            description: 'Updated source for the photon file',
          },
          files: {
            type: 'array',
            description: 'Updated sources for the photon and related local support files',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                source: { type: 'string' },
              },
              required: ['path', 'source'],
            },
          },
        },
        required: ['name', 'source', 'files'],
      },
    });

    tools.push({
      name: 'beam/studio-parse',
      'x-photon-internal': true,
      description: 'Parse photon source and return extracted schema',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source code to parse',
          },
        },
        required: ['source'],
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

    if (name === 'beam/reconnect-mcp') {
      return handleBeamReconnectMCP(req, ctx, args || {});
    }

    if (name === 'beam/photon-help') {
      return handleBeamPhotonHelp(req, ctx, args || {});
    }

    if (name === 'beam/studio-read') {
      return handleBeamStudioRead(req, ctx, args || {});
    }

    if (name === 'beam/studio-write') {
      return handleBeamStudioWrite(req, ctx, args || {});
    }

    if (name === 'beam/studio-project') {
      return handleBeamStudioProject(req, ctx, args || {});
    }

    if (name === 'beam/studio-apply-files') {
      return handleBeamStudioApplyFiles(req, ctx, args || {});
    }

    if (name === 'beam/studio-parse') {
      return handleBeamStudioParse(req, args || {});
    }

    // Parse tool name: server-name/method-name or namespace:server-name/method-name
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

    const serverName = name.slice(0, slashIndex);
    const methodName = name.slice(slashIndex + 1);

    // Per-photon auth check: if this photon requires auth but caller is anonymous, reject
    const targetPhoton = ctx.photons.find((p) => p.name === serverName);
    if (targetPhoton?.configured && (targetPhoton as any).auth === 'required') {
      if (!ctx.caller || ctx.caller.anonymous) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'text',
                text: `Authentication required for ${serverName}. Provide an OAuth Bearer token.`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    // Native photons take precedence over external MCP clients with the same name
    // Support both short names and namespace:name qualified names
    const isNativePhoton = ctx.photons.some((p) => p.name === serverName);

    // Check if this is an external MCP tool call (only when no native photon matches)
    // Prefer SDK client for full CallToolResult support (structuredContent)
    if (!isNativePhoton && ctx.externalMCPSDKClients?.has(serverName)) {
      const sdkClient = ctx.externalMCPSDKClients.get(serverName);
      try {
        // SDK client.callTool returns full CallToolResult with structuredContent
        const result = await sdkClient.callTool({ name: methodName, arguments: args || {} });

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: result.content,
            structuredContent: result.structuredContent,
            isError: result.isError ?? false,
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
    }

    // Fallback to wrapper client (no structuredContent support)
    if (!isNativePhoton && ctx.externalMCPClients?.has(serverName)) {
      const client = ctx.externalMCPClients.get(serverName);
      try {
        const result = await client.call(methodName, args || {});

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: formatResultText(result) }],
            isError: false,
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
    }

    // Handle as photon tool call
    const photonName = serverName;

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

    // Auto-confirm @destructive operations before execution (any transport path)
    if (methodInfo?.destructiveHint) {
      const elicitResult = await requestBeamElicitation({
        ask: 'confirm',
        message: `"${methodName}" is a destructive operation. Continue?`,
      });
      if (elicitResult.action !== 'accept' || elicitResult.content === false) {
        return {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            content: [{ type: 'text', text: `${methodName} cancelled` }],
            isError: false,
          },
        };
      }
    }

    // Stateful photons: route through daemon for shared instance across all clients
    if (photonInfo?.stateful && photonInfo.path) {
      try {
        const { sendCommand } = await import('../daemon/client.js');
        const { ensureDaemon } = await import('../daemon/manager.js');

        // Ensure daemon is running (idempotent — handles stale binary restart too)
        await ensureDaemon();

        // Each browser tab gets its own daemon session via the MCP session ID.
        // Instance state is tracked per-session on the daemon — no global persistence.
        const beamSessionId = `beam-${session.id}`;
        const sendOpts = {
          photonPath: photonInfo.path,
          sessionId: beamSessionId,
          instanceName: session.instanceName,
          workingDir: ctx.workingDir,
          clientType: 'beam' as const,
        };

        // Elicitation-based instance selection when _use called without name
        if (methodName === '_use' && (!args || !('name' in args))) {
          const instancesResult = (await sendCommand(photonName, '_instances', {}, sendOpts)) as {
            instances?: string[];
            current?: string;
          };
          const instances = instancesResult?.instances || ['default'];

          // Build select options for elicitation modal
          const selectOptions = instances.map((inst: string) => ({
            value: inst,
            label: inst === 'default' ? '(default)' : inst,
            selected: inst === (instancesResult?.current || 'default'),
          }));
          selectOptions.push({ value: '__create_new__', label: 'Create new...', selected: false });

          const elicitResult = await requestBeamElicitation({
            ask: 'select',
            message: 'Select an instance',
            options: selectOptions,
          });

          if (elicitResult.action !== 'accept' || !elicitResult.content) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: 'Cancelled' }],
                isError: false,
              },
            };
          }

          let selectedName = elicitResult.content as string;

          // Handle "Create new..." selection
          if (selectedName === '__create_new__') {
            const nameResult = await requestBeamElicitation({
              ask: 'text',
              message: 'Enter a name for the new instance',
              placeholder: 'e.g. groceries, work, personal',
            });

            if (nameResult.action !== 'accept' || !nameResult.content) {
              return {
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  content: [{ type: 'text', text: 'Cancelled' }],
                  isError: false,
                },
              };
            }
            selectedName = nameResult.content as string;
          }

          const useResult = await sendCommand(photonName, '_use', { name: selectedName }, sendOpts);
          session.instanceName = selectedName;
          // Notify UI to refresh after instance switch
          broadcastToBeam('state-changed', {
            photon: photonName,
            method: '_use',
            data: { instance: selectedName },
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: formatResultText(useResult) }],
              isError: false,
            },
          };
        }

        // For direct _use with name, also broadcast state-changed
        if (methodName === '_use') {
          const result = await sendCommand(
            photonName,
            methodName,
            (args || {}) as Record<string, any>,
            sendOpts
          );
          session.instanceName = typeof args?.name === 'string' ? args.name : '';
          broadcastToBeam('state-changed', {
            photon: photonName,
            method: '_use',
            data: { instance: args?.name || 'default' },
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: formatResultText(result) }],
              isError: false,
            },
          };
        }

        // Extract _targetInstance from args for instance-scoped execution
        const callArgs = { ...(args || {}) } as Record<string, any>;
        const targetInstance = callArgs._targetInstance as string | undefined;
        delete callArgs._targetInstance;

        const callOpts = targetInstance !== undefined ? { ...sendOpts, targetInstance } : sendOpts;

        const startTime = Date.now();
        const result = await sendCommand(photonName, methodName, callArgs, callOpts);
        const durationMs = Date.now() - startTime;

        broadcastNotification(
          'beam/log',
          {
            type: 'info',
            message: `${methodName} completed in ${durationMs}ms`,
            durationMs,
            photon: photonName,
            instance: session.instanceName || 'default',
            client: 'beam',
          },
          true
        );
        audit({
          ts: new Date().toISOString(),
          event: 'tool_call',
          photon: photonName,
          method: methodName,
          instance: session.instanceName || 'default',
          client: 'beam',
          sessionId: session.id,
          durationMs,
        });

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            ...buildToolResult(result, methodInfo),
            ...uiMetadata,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        audit({
          ts: new Date().toISOString(),
          event: 'tool_error',
          photon: photonName,
          method: methodName,
          instance: session?.instanceName || 'default',
          client: 'beam',
          sessionId: session?.id,
          error: message,
        });
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
          },
        };
      }
    }

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp?.instance) {
      // Check if it's a disconnected external MCP
      const externalMCP = ctx.externalMCPs?.find((m) => m.name === photonName);
      if (externalMCP) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'text',
                text: `External MCP "${photonName}" is not connected${externalMCP.errorMessage ? `: ${externalMCP.errorMessage}` : ''}`,
              },
            ],
            isError: true,
          },
        };
      }
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

        // Forward render events — intermediate formatted results
        if (yieldValue?.emit === 'render') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'beam/render',
            params: {
              photon: photonName,
              method: methodName,
              format: yieldValue.format,
              value: yieldValue.value,
            },
          });
          return;
        }

        // Forward render:clear events — clear the render zone
        if (yieldValue?.emit === 'render:clear') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'beam/render',
            params: { photon: photonName, method: methodName, clear: true },
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
      // Supports persistent: true for durable approvals that survive navigation/restart
      const inputProvider = async (ask: any): Promise<any> => {
        if (!ctx.broadcast) {
          throw new Error('No broadcast connection for elicitation');
        }

        // Generate unique elicitation ID
        const elicitationId = randomUUID();
        const isPersistent = ask.persistent === true;

        // Determine timeout: persistent asks use 'expires' field, default 5 min
        const timeoutMs = isPersistent && ask.expires ? parseDurationToMs(ask.expires) : 300000;

        return new Promise((resolve, reject) => {
          // Store pending elicitation
          const pending: PendingElicitation = {
            resolve,
            reject,
            sessionId: session?.id || '',
          };
          pendingElicitations.set(elicitationId, pending);

          // For persistent asks, write to approvals.json for durability
          if (isPersistent) {
            const approval: PersistentApproval = {
              id: elicitationId,
              photon: photonName,
              method: methodName,
              message: ask.message || `Confirm ${methodName}?`,
              preview: ask.preview,
              destructive: ask.destructive,
              status: 'pending',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
            };
            // Write async — don't block the elicitation broadcast
            addApproval(approval).catch(() => {});
          }

          // Broadcast elicitation request to frontend
          ctx.broadcast!({
            jsonrpc: '2.0',
            method: 'beam/elicitation',
            params: {
              elicitationId,
              persistent: isPersistent || undefined,
              destructive: ask.destructive || undefined,
              ...ask,
            },
          });

          // Timeout — for persistent asks, mark as pending (not reject)
          pending.timer = setTimeout(
            () => {
              if (pendingElicitations.has(elicitationId)) {
                pendingElicitations.delete(elicitationId);
                if (isPersistent) {
                  // Don't reject — the approval stays in approvals.json for later
                  // Resolve with undefined to indicate "no immediate response"
                  // The caller should check for this and handle gracefully
                  reject(
                    new Error('Approval pending — user can respond later via approvals panel')
                  );
                } else {
                  reject(new Error('Elicitation timeout - no response received'));
                }
              }
            },
            isPersistent ? Math.min(timeoutMs, 60000) : 300000
          ); // Persistent: shorter in-flight timeout (1 min), actual expiry handled by approvals.json
        });
      };

      // Use loader.executeTool if available (sets up execution context for this.emit())
      // Fall back to direct method call for backward compatibility
      let result: any;
      const startTime = Date.now();
      if (ctx.loader) {
        result = await ctx.loader.executeTool(mcp, methodName, args || {}, {
          outputHandler,
          inputProvider,
          caller: ctx.caller,
        });
      } else {
        // For static methods, don't bind to instance
        result = isStatic ? await method(args || {}) : await method.call(mcp.instance, args || {});
      }

      // Handle async generators (when not using loader)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const chunks: any[] = [];
        let returnValue: any = undefined;

        // Manually iterate to capture both yielded values AND the return value
        // Note: for-await-of doesn't capture return values, only yielded values
        const iterator = result[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) {
            // Generator returned - capture the return value
            returnValue = value;
            break;
          }
          // Process yielded values
          if (value?.emit === 'result') {
            chunks.push(value.data);
          } else if (value?.emit === 'board-update' && ctx.broadcast) {
            // Forward board-update from generator
            ctx.broadcast({
              type: 'board-update',
              photon: photonName,
              board: value.board,
            });
          } else if (value?.emit !== 'progress') {
            chunks.push(value);
          }
        }

        // Use return value if no chunks were yielded, otherwise use chunks
        const finalResult =
          chunks.length > 0 ? (chunks.length === 1 ? chunks[0] : chunks) : returnValue;
        const durationMs = Date.now() - startTime;
        broadcastNotification(
          'beam/log',
          {
            type: 'info',
            message: `${methodName} completed in ${durationMs}ms`,
            durationMs,
            photon: photonName,
            instance: session?.instanceName || 'default',
            client: session?.clientInfo?.name || 'beam',
          },
          true
        );
        audit({
          ts: new Date().toISOString(),
          event: 'tool_call',
          photon: photonName,
          method: methodName,
          instance: session?.instanceName || 'default',
          client: session?.clientInfo?.name || 'beam',
          sessionId: session?.id,
          durationMs,
        });

        const genResponse = {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            ...buildToolResult(finalResult, methodInfo),
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

      const durationMs = Date.now() - startTime;
      broadcastNotification(
        'beam/log',
        {
          type: 'info',
          message: `${methodName} completed in ${durationMs}ms`,
          durationMs,
          photon: photonName,
          instance: session?.instanceName || 'default',
          client: session?.clientInfo?.name || 'beam',
        },
        true
      );
      audit({
        ts: new Date().toISOString(),
        event: 'tool_call',
        photon: photonName,
        method: methodName,
        instance: session?.instanceName || 'default',
        client: session?.clientInfo?.name || 'beam',
        sessionId: session?.id,
        durationMs,
      });

      // For void methods, provide a success acknowledgment so the UI shows feedback
      const toolResponse = {
        jsonrpc: '2.0' as const,
        id: req.id,
        result: {
          ...buildToolResult(result, methodInfo),
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
      const { text } = formatToolError(methodName, error);
      audit({
        ts: new Date().toISOString(),
        event: 'tool_error',
        photon: photonName,
        method: methodName,
        instance: session?.instanceName || 'default',
        client: session?.clientInfo?.name || 'beam',
        sessionId: session?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text }],
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

    // Add pending approval resources (approval:// scheme)
    const photonNames = ctx.photons.map((p: any) => p.name);
    const pendingApprovals = await getAllPendingApprovals(photonNames);
    for (const approval of pendingApprovals) {
      resources.push({
        uri: `approval://${approval.photon}/${approval.id}`,
        name: `Pending: ${approval.message}`,
        mimeType: 'application/json',
        description: `Approval request from ${approval.photon}.${approval.method}`,
      });
    }

    return { jsonrpc: '2.0', id: req.id, result: { resources } };
  },

  'resources/read': async (req, session, ctx) => {
    const { uri } = req.params as { uri: string };

    // Parse approval:// URI
    const approvalMatch = uri.match(/^approval:\/\/([^/]+)\/(.+)$/);
    if (approvalMatch) {
      const [, photonName, approvalId] = approvalMatch;
      const approvals = await loadApprovals(photonName);
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Approval not found: ${uri}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [
            { uri, mimeType: 'application/json', text: JSON.stringify(approval, null, 2) },
          ],
        },
      };
    }

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
    const result = await ctx.loadUIAsset(photonName, uiId);

    if (!result) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Resource not found: ${uri}` },
      };
    }

    // Signal declarative mode (.photon.html) via mimeType parameter
    const mimeType = result.isPhotonTemplate
      ? 'text/html;profile=mcp-app;photon-template=true'
      : 'text/html;profile=mcp-app';

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        contents: [{ uri, mimeType, text: result.content }],
      },
    };
  },

  'prompts/list': async (req, _session, ctx) => {
    const prompts: any[] = [];
    for (const photon of ctx.photons) {
      if (!photon.configured) continue;
      const mcp = ctx.photonMCPs.get(photon.name);
      if (!mcp?.templates) continue;
      for (const template of mcp.templates) {
        prompts.push({
          name: `${photon.name}/${template.name}`,
          description: template.description,
          arguments: Object.entries(template.inputSchema?.properties || {}).map(
            ([name, schema]) => ({
              name,
              description:
                (typeof schema === 'object' && schema && 'description' in schema
                  ? (schema as any).description
                  : '') || '',
              required: template.inputSchema?.required?.includes(name) || false,
            })
          ),
        });
      }
    }
    return { jsonrpc: '2.0', id: req.id, result: { prompts } };
  },

  'prompts/get': async (req, _session, ctx) => {
    const { name } = req.params as { name: string; arguments?: Record<string, string> };
    const args = (req.params as any).arguments || {};

    const slashIndex = name.indexOf('/');
    if (slashIndex === -1) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Invalid prompt name: ${name}` },
      };
    }

    const photonName = name.slice(0, slashIndex);
    const promptName = name.slice(slashIndex + 1);

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Photon not found: ${photonName}` },
      };
    }

    const template = mcp.templates?.find((t: any) => t.name === promptName);
    if (!template) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Prompt not found: ${promptName}` },
      };
    }

    try {
      const result = await ctx.loader!.executeTool(mcp, promptName, args);
      // Format as prompt response
      if (result && typeof result === 'object' && 'messages' in result) {
        return { jsonrpc: '2.0', id: req.id, result: { messages: result.messages } };
      }
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          messages: [{ role: 'user', content: { type: 'text', text } }],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: `Prompt execution failed: ${message}` },
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MCP Tasks (2025-11-25 spec)
  // ─────────────────────────────────────────────────────────────────────────────

  'tasks/create': async (req, session, ctx) => {
    const {
      photon: photonName,
      method: methodName,
      params,
    } = req.params as {
      photon: string;
      method: string;
      params?: Record<string, unknown>;
    };

    if (!photonName || !methodName) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required params: photon, method' },
      };
    }

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Photon not found: ${photonName}` },
      };
    }

    const task = createTask(photonName, methodName, params);
    const controller = new AbortController();
    registerController(task.id, controller);

    // Run execution in background — don't await
    const taskId = task.id;
    void (async () => {
      try {
        let result: any;
        if (ctx.loader) {
          result = await ctx.loader.executeTool(mcp, methodName, params || {}, {
            caller: ctx.caller,
            signal: controller.signal,
          });
        } else {
          const method = mcp.instance?.[methodName];
          if (typeof method === 'function') {
            result = await method.call(mcp.instance, params || {});
          } else {
            throw new Error(`Method ${methodName} not found on ${photonName}`);
          }
        }

        // Handle async generators
        if (result && typeof result[Symbol.asyncIterator] === 'function') {
          const chunks: any[] = [];
          const iterator = result[Symbol.asyncIterator]();
          while (true) {
            if (controller.signal.aborted) {
              updateTask(taskId, { state: 'cancelled' });
              unregisterController(taskId);
              return;
            }
            const { value, done } = await iterator.next();
            if (done) {
              result = value !== undefined ? value : chunks;
              break;
            }
            if (value?.emit === 'progress' && typeof value.percent === 'number') {
              updateTask(taskId, {
                progress: { percent: value.percent, message: value.message },
              });
            } else if (value?.ask) {
              updateTask(taskId, { state: 'input_required' });
            } else {
              chunks.push(value);
            }
          }
        }

        if (!controller.signal.aborted) {
          updateTask(taskId, { state: 'completed', result });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          const message = err instanceof Error ? err.message : String(err);
          updateTask(taskId, { state: 'failed', error: message });
        }
      } finally {
        unregisterController(taskId);
      }
    })();

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { task: { id: task.id, state: task.state, createdAt: task.createdAt } },
    };
  },

  'tasks/get': async (req, _session, _ctx) => {
    const { id } = req.params as { id: string };
    if (!id) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required param: id' },
      };
    }
    const task = getTask(id);
    if (!task) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${id}` },
      };
    }
    return { jsonrpc: '2.0', id: req.id, result: { task } };
  },

  'tasks/list': async (req, _session, _ctx) => {
    const { photon: photonFilter } = (req.params || {}) as { photon?: string };
    const tasks = listTasks(photonFilter);
    return { jsonrpc: '2.0', id: req.id, result: { tasks } };
  },

  'tasks/cancel': async (req, _session, _ctx) => {
    const { id } = req.params as { id: string };
    if (!id) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required param: id' },
      };
    }
    const task = getTask(id);
    if (!task) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${id}` },
      };
    }
    if (task.state !== 'working' && task.state !== 'input_required') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Cannot cancel task in state: ${task.state}` },
      };
    }
    const controller = getController(id);
    if (controller) {
      controller.abort();
    }
    const updated = updateTask(id, { state: 'cancelled' });
    unregisterController(id);
    return { jsonrpc: '2.0', id: req.id, result: { task: updated } };
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

/**
 * Handle beam/reconnect-mcp tool - reconnect a disconnected external MCP
 */
async function handleBeamReconnectMCP(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: mcpName } = args as { name: string };

  if (!mcpName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: MCP name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.reconnectExternalMCP) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Reconnection not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.reconnectExternalMCP(mcpName);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully reconnected to external MCP "${mcpName}". Tools list will be updated.`,
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
          content: [{ type: 'text', text: `Failed to reconnect to "${mcpName}": ${result.error}` }],
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
        content: [{ type: 'text', text: `Error reconnecting to "${mcpName}": ${message}` }],
        isError: true,
      },
    };
  }
}

interface StudioSupportFile {
  path: string;
  source: string;
}

function extractRelativeImportSpecifiers(source: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier?.startsWith('.')) matches.add(specifier);
    }
  }

  return Array.from(matches);
}

function resolveImportCandidates(fromPath: string, specifier: string): string[] {
  const basePath = resolve(dirname(fromPath), specifier);
  const hasExtension = extname(basePath).length > 0;
  const candidates = hasExtension
    ? [basePath]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.mts`,
        `${basePath}.cts`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        `${basePath}.cjs`,
        `${basePath}.d.ts`,
        join(basePath, 'index.ts'),
        join(basePath, 'index.tsx'),
        join(basePath, 'index.mts'),
        join(basePath, 'index.cts'),
        join(basePath, 'index.js'),
        join(basePath, 'index.d.ts'),
      ];

  return candidates.map((candidate) => normalize(candidate));
}

async function collectStudioSupportFiles(
  entryPath: string,
  source: string,
  workingDir?: string
): Promise<StudioSupportFile[]> {
  const supportFiles: StudioSupportFile[] = [];
  const visited = new Set<string>([normalize(entryPath)]);
  const queue: Array<{ path: string; source: string }> = [{ path: entryPath, source }];
  const maxFiles = 24;

  while (queue.length > 0 && supportFiles.length < maxFiles) {
    const current = queue.shift()!;
    for (const specifier of extractRelativeImportSpecifiers(current.source)) {
      const candidates = resolveImportCandidates(current.path, specifier);
      let resolvedPath: string | null = null;
      let resolvedSource: string | null = null;

      for (const candidate of candidates) {
        if (visited.has(candidate)) continue;
        try {
          const fileSource = await readFile(candidate, 'utf-8');
          resolvedPath = candidate;
          resolvedSource = fileSource;
          break;
        } catch {
          // Try next candidate extension
        }
      }

      if (!resolvedPath || resolvedSource == null) continue;

      visited.add(resolvedPath);
      supportFiles.push({ path: resolvedPath, source: resolvedSource });
      queue.push({ path: resolvedPath, source: resolvedSource });

      if (resolvedPath.endsWith('.photon.ts') || resolvedPath.endsWith('.photon.tsx')) {
        const declarationPath = await writePhotonEditorDeclaration(
          resolvedPath,
          resolvedSource,
          workingDir
        ).catch(() => null);
        if (declarationPath) {
          try {
            const declarationSource = await readFile(declarationPath, 'utf-8');
            if (!visited.has(normalize(declarationPath))) {
              visited.add(normalize(declarationPath));
              supportFiles.push({ path: declarationPath, source: declarationSource });
            }
          } catch {
            // Ignore missing generated declaration reads.
          }
        }
      }

      if (supportFiles.length >= maxFiles) break;
    }
  }

  return supportFiles;
}

async function buildStudioProjectPayload(
  photonPath: string,
  source: string,
  workingDir?: string
): Promise<{ declarationPath: string | null; supportFiles: StudioSupportFile[] }> {
  const declarationPath = await writePhotonEditorDeclaration(photonPath, source, workingDir).catch(
    () => null
  );
  const supportFiles = await collectStudioSupportFiles(photonPath, source, workingDir).catch(
    () => []
  );
  return { declarationPath, supportFiles };
}

/**
 * Handle beam/studio-read — read a photon source file for editing
 */
async function handleBeamStudioRead(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName } = args as { name: string };

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

  // Find the photon by name to get its file path
  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const source = await readFile(photon.path, 'utf-8');
    const { declarationPath, supportFiles } = await buildStudioProjectPayload(
      photon.path,
      source,
      ctx.workingDir
    );
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ source, path: photon.path, declarationPath, supportFiles }),
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
        content: [{ type: 'text', text: `Error reading source: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/studio-write — write photon source and trigger hot-reload
 */
async function handleBeamStudioWrite(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName, source } = args as { name: string; source: string };

  if (!photonName || typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name and source are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    // Write source to disk
    await writeFile(photon.path, source, 'utf-8');
    const { declarationPath, supportFiles } = await buildStudioProjectPayload(
      photon.path,
      source,
      ctx.workingDir
    );

    // Parse the new source for preview
    let parseResult = null;
    try {
      const { SchemaExtractor } = await import('@portel/photon-core');
      const extractor = new SchemaExtractor();
      const { tools: schemas } = extractor.extractAllFromSource(source);
      const classMatch = source.match(/export\s+default\s+class\s+(\w+)/);
      const descMatch = source.match(/\/\*\*\s*\n\s*\*\s*(.+)/);
      const versionMatch = source.match(/@version\s+(\S+)/);
      const runtimeMatch = source.match(/@runtime\s+(\S+)/);
      const iconMatch = source.match(/@icon\s+(\S+)/);
      const statefulMatch = source.match(/@stateful\b/);
      const depsMatch = source.match(/@dependencies\s+(.+)/);
      const tagsMatch = source.match(/@tags\s+(.+)/);

      parseResult = {
        className: classMatch?.[1] || 'Unknown',
        description: descMatch?.[1]?.replace(/\s*\*\/$/, '').trim(),
        icon: iconMatch?.[1],
        version: versionMatch?.[1],
        runtime: runtimeMatch?.[1],
        stateful: !!statefulMatch,
        dependencies: depsMatch?.[1]
          ?.split(',')
          .map((d: string) => d.trim())
          .filter(Boolean),
        tags: tagsMatch?.[1]
          ?.split(',')
          .map((t: string) => t.trim())
          .filter(Boolean),
        methods: schemas
          .filter((s: any) => !['onInitialize', 'onShutdown', 'constructor'].includes(s.name))
          .map((s: any) => ({
            name: s.name,
            description: s.description,
            icon: s.icon,
            params: s.inputSchema,
            autorun: s.autorun,
            outputFormat: s.outputFormat,
            buttonLabel: s.buttonLabel,
            webhook: s.webhook,
            scheduled: s.scheduled || s.cron,
            locked: s.locked,
          })),
      };
    } catch {
      // Parse is best-effort — don't fail the write
    }

    // Trigger hot-reload if available
    if (ctx.reloadPhoton) {
      try {
        const reloadResult = await ctx.reloadPhoton(photonName);
        if (reloadResult.success) {
          broadcastToBeam('beam/hot-reload', { photon: reloadResult.photon });
        }
      } catch {
        // Reload failure doesn't fail the write
      }
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, parseResult, declarationPath, supportFiles }),
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
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      },
    };
  }
}

async function handleBeamStudioProject(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName, source } = args as { name: string; source: string };

  if (!photonName || typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name and source are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const payload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error resolving project context: ${message}` }],
        isError: true,
      },
    };
  }
}

async function handleBeamStudioApplyFiles(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const {
    name: photonName,
    source,
    files,
  } = args as {
    name: string;
    source: string;
    files: Array<{ path: string; source: string }>;
  };

  if (!photonName || typeof source !== 'string' || !Array.isArray(files)) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name, source, and files are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const payload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    const allowedPaths = new Set<string>([
      normalize(photon.path),
      ...payload.supportFiles.map((file) => normalize(file.path)),
    ]);

    for (const file of files) {
      if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
        throw new Error('Each file update must include path and source');
      }
      const normalizedPath = normalize(file.path);
      if (!allowedPaths.has(normalizedPath)) {
        throw new Error(`Refusing to write unexpected file: ${file.path}`);
      }
    }

    for (const file of files) {
      await writeFile(file.path, file.source, 'utf-8');
      if (file.path.endsWith('.photon.ts') || file.path.endsWith('.photon.tsx')) {
        await writePhotonEditorDeclaration(file.path, file.source, ctx.workingDir).catch(
          () => null
        );
      }
    }

    if (ctx.reloadPhoton) {
      try {
        const reloadResult = await ctx.reloadPhoton(photonName);
        if (reloadResult.success) {
          broadcastToBeam('beam/hot-reload', { photon: reloadResult.photon });
        }
      } catch {
        // Best effort: don't fail the apply if hot-reload misses.
      }
    }

    const refreshedPayload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              declarationPath: refreshedPayload.declarationPath,
              supportFiles: refreshedPayload.supportFiles,
            }),
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
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/studio-parse — parse photon source and return schema
 */
async function handleBeamStudioParse(
  req: JSONRPCRequest,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { source } = args as { source: string };

  if (typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: source is required' }],
        isError: true,
      },
    };
  }

  try {
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();
    const { tools: schemas } = extractor.extractAllFromSource(source);

    const classMatch = source.match(/export\s+default\s+class\s+(\w+)/);
    const descMatch = source.match(/\/\*\*\s*\n\s*\*\s*(.+)/);
    const versionMatch = source.match(/@version\s+(\S+)/);
    const runtimeMatch = source.match(/@runtime\s+(\S+)/);
    const iconMatch = source.match(/@icon\s+(\S+)/);
    const statefulMatch = source.match(/@stateful\b/);
    const depsMatch = source.match(/@dependencies\s+(.+)/);
    const tagsMatch = source.match(/@tags\s+(.+)/);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!classMatch) errors.push('No default export class found');
    if (!descMatch) warnings.push('Missing class description (first line in JSDoc)');

    const result = {
      className: classMatch?.[1] || 'Unknown',
      description: descMatch?.[1]?.replace(/\s*\*\/$/, '').trim(),
      icon: iconMatch?.[1],
      version: versionMatch?.[1],
      runtime: runtimeMatch?.[1],
      stateful: !!statefulMatch,
      dependencies: depsMatch?.[1]
        ?.split(',')
        .map((d: string) => d.trim())
        .filter(Boolean),
      tags: tagsMatch?.[1]
        ?.split(',')
        .map((t: string) => t.trim())
        .filter(Boolean),
      methods: schemas
        .filter((s: any) => !['onInitialize', 'onShutdown', 'constructor'].includes(s.name))
        .map((s: any) => ({
          name: s.name,
          description: s.description,
          icon: s.icon,
          params: s.inputSchema,
          autorun: s.autorun,
          outputFormat: s.outputFormat,
          buttonLabel: s.buttonLabel,
          webhook: s.webhook,
          scheduled: s.scheduled || s.cron,
          locked: s.locked,
        })),
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              className: 'Unknown',
              methods: [],
              errors: [`Parse error: ${message}`],
            }),
          },
        ],
        isError: false,
      },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════════════════

export interface StreamableHTTPOptions {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonInstance>;
  externalMCPs?: ExternalMCPInfo[];
  externalMCPClients?: Map<string, any>;
  externalMCPSDKClients?: Map<string, any>; // SDK clients for full CallToolResult support
  reconnectExternalMCP?: (name: string) => Promise<{ success: boolean; error?: string }>;
  loadUIAsset: (
    photonName: string,
    uiId: string
  ) => Promise<{ content: string; isPhotonTemplate: boolean } | null>;
  /** Working directory override (base dir for state/config/cache) */
  workingDir?: string;
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
      lastTimestamp?: number
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
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Mcp-Session-Id, Authorization'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // MCP OAuth: extract token if present (used for per-photon auth checks at tool call time)
  // Accept token from Authorization header (POST) or query param (SSE GET — EventSource can't set headers)
  const queryToken = url.searchParams.get('token');
  const authHeader = queryToken ? `Bearer ${queryToken}` : req.headers.authorization;
  // Note: No global auth gate here. Individual photons that require @auth are enforced
  // at tool call time (see per-photon auth check in tools/call handler). This allows
  // non-auth photons to work normally even when auth-required photons are loaded.

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

    // Enable TCP keepalive to prevent connection drops from intermediaries
    res.socket?.setKeepAlive(true, 60000);

    // Store SSE response for server-initiated messages
    session.sseResponse = res;

    // Keep connection alive with SSE data events (every 15s for better reliability)
    const keepAlive = setInterval(() => {
      // Check if response is still writable before sending keepalive
      if (!res.writableEnded && !res.destroyed) {
        try {
          // Send as data event so client onmessage handler fires and updates lastMessageTime
          res.write('data: {"type":"keepalive"}\n\n');
        } catch (err) {
          // If write fails, connection is dead - clean up
          clearInterval(keepAlive);
          session.sseResponse = undefined;
        }
      } else {
        clearInterval(keepAlive);
      }
    }, 15000); // Reduced from 30s to 15s for better responsiveness

    // Handle client disconnect
    const cleanup = () => {
      clearInterval(keepAlive);
      session.sseResponse = undefined;
      // Clean up subscriptions when client disconnects
      if (options.subscriptionManager) {
        options.subscriptionManager.onClientDisconnect(session.id);
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);

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

    // Extract caller identity from Authorization header or query token (MCP OAuth)
    const caller = decodeJWTCaller(authHeader);

    const context: HandlerContext = {
      photons: options.photons,
      photonMCPs: options.photonMCPs,
      externalMCPs: options.externalMCPs,
      externalMCPClients: options.externalMCPClients,
      externalMCPSDKClients: options.externalMCPSDKClients,
      reconnectExternalMCP: options.reconnectExternalMCP,
      loadUIAsset: options.loadUIAsset,
      configurePhoton: options.configurePhoton,
      reloadPhoton: options.reloadPhoton,
      removePhoton: options.removePhoton,
      updateMetadata: options.updateMetadata,
      generatePhotonHelp: options.generatePhotonHelp,
      loader: options.loader,
      broadcast: options.broadcast,
      subscriptionManager: options.subscriptionManager,
      workingDir: options.workingDir,
      caller,
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

  const data = `data: ${JSON.stringify(notification)}\n\n`;
  const deadSessions: string[] = [];

  for (const [sessionId, session] of sessions) {
    if (
      session.sseResponse &&
      !session.sseResponse.writableEnded &&
      !session.sseResponse.destroyed
    ) {
      // Skip non-Beam clients if beamOnly is true
      if (beamOnly && !session.isBeam) continue;
      try {
        session.sseResponse.write(data);
      } catch (err) {
        // Mark session for cleanup if write fails
        deadSessions.push(sessionId);
      }
    } else if (session.sseResponse) {
      // Response is ended/destroyed - mark for cleanup
      deadSessions.push(sessionId);
    }
  }

  // Clean up dead sessions
  for (const sessionId of deadSessions) {
    const session = sessions.get(sessionId);
    if (session) {
      session.sseResponse = undefined;
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
  if (!session?.sseResponse || session.sseResponse.writableEnded || session.sseResponse.destroyed) {
    return false;
  }
  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };
  try {
    session.sseResponse.write(`data: ${JSON.stringify(notification)}\n\n`);
    return true;
  } catch (err) {
    // Write failed - connection is dead
    session.sseResponse = undefined;
    return false;
  }
}

/**
 * Request elicitation from the frontend for an external MCP.
 * This is used when external MCP servers send elicitation/create requests.
 *
 * @param mcpName - Name of the external MCP requesting elicitation
 * @param request - The elicitation request params from the MCP server
 * @returns Promise resolving to the user's response
 */
export function requestExternalElicitation(
  mcpName: string,
  request: {
    mode: 'form' | 'url';
    message: string;
    requestedSchema?: any;
    url?: string;
  }
): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: any }> {
  const elicitationId = randomUUID();

  return new Promise((resolve, reject) => {
    // Store pending elicitation
    const pending: PendingElicitation = {
      resolve: (value: any) => {
        resolve({ action: 'accept', content: value });
      },
      reject: (error: Error) => {
        if (error.message.includes('cancelled')) {
          resolve({ action: 'cancel' });
        } else {
          resolve({ action: 'decline' });
        }
      },
      sessionId: '', // External MCP elicitations aren't tied to a specific session
    };
    pendingElicitations.set(elicitationId, pending);

    // Broadcast elicitation request to all Beam clients
    broadcastToBeam('beam/elicitation', {
      elicitationId,
      mcpName,
      message: request.message,
      mode: request.mode,
      schema: request.requestedSchema,
      url: request.url,
    });

    // Timeout after 5 minutes (timer cleared on normal resolve)
    pending.timer = setTimeout(() => {
      if (pendingElicitations.has(elicitationId)) {
        pendingElicitations.delete(elicitationId);
        resolve({ action: 'cancel' });
      }
    }, 300000);
  });
}

/**
 * Request elicitation from Beam using Photon-native ask types (select, text, etc.)
 * Unlike requestExternalElicitation which uses MCP form/url mode, this sends
 * the ask type directly so the elicitation modal renders the appropriate UI.
 */
function requestBeamElicitation(data: {
  ask: 'select' | 'text' | 'confirm' | 'number';
  message: string;
  options?: Array<{ value: string; label: string; selected?: boolean; description?: string }>;
  placeholder?: string;
  default?: any;
}): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: any }> {
  const elicitationId = randomUUID();

  return new Promise((resolve) => {
    const pending: PendingElicitation = {
      resolve: (value: any) => {
        resolve({ action: 'accept', content: value });
      },
      reject: (error: Error) => {
        if (error.message.includes('cancelled')) {
          resolve({ action: 'cancel' });
        } else {
          resolve({ action: 'decline' });
        }
      },
      sessionId: '',
    };
    pendingElicitations.set(elicitationId, pending);

    // Broadcast with Photon-native ask format (not MCP form mode)
    broadcastToBeam('beam/elicitation', {
      elicitationId,
      ...data,
    });

    // Timeout after 5 minutes (timer cleared on normal resolve)
    pending.timer = setTimeout(() => {
      if (pendingElicitations.has(elicitationId)) {
        pendingElicitations.delete(elicitationId);
        resolve({ action: 'cancel' });
      }
    }, 300000);
  });
}
