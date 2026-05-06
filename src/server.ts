/**
 * Photon MCP Server
 *
 * Wraps a .photon.ts file as an MCP server using @modelcontextprotocol/sdk
 * Supports both stdio and SSE transports
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
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
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { readText } from './shared/io.js';
import { detectIsolationMode } from './shared/cross-origin-headers.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import { PhotonLoader } from './loader.js';
import { PhotonClassExtended } from '@portel/photon-core';
import type { ExtractedSchema, PhotonClass } from '@portel/photon-core';
import type { Marketplace, PhotonMetadata } from './marketplace-manager.js';
import { createSDKMCPClientFactory, type SDKMCPClientFactory } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';
import { createLogger, Logger, LoggerOptions, LogLevel } from './shared/logger.js';
import { getErrorMessage, formatToolError } from './shared/error-handler.js';
import {
  validateOrThrow,
  assertString,
  notEmpty,
  inRange,
  oneOf,
  hasExtension,
} from './shared/validation.js';
import { generatePlaygroundHTML } from './auto-ui/playground-html.js';
import { pingDaemon } from './daemon/client.js';
import { ensureDaemon } from './daemon/manager.js';
import {
  ChannelManager,
  type ChannelNotificationSink,
  type ChannelPermissionResponse,
} from './channel-manager.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { isLocalRequest, readBody, setSecurityHeaders, getCorsOrigin } from './shared/security.js';
import { audit } from './shared/audit.js';
import { TaskExecutor } from './task-executor.js';
import { CapabilityNegotiator } from './capability-negotiator.js';
import {
  ResourceServer,
  SubscriptionRegistry,
  type ResourceUpdateSink,
} from './resource-server.js';
import type {
  PhotonClassWithMeta,
  MCPToolDefinition,
  MCPTextContent,
  MCPToolResponse,
} from './types/server-types.js';

export class HotReloadDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotReloadDisabledError';
  }
}

export type TransportType = 'stdio' | 'sse';

/**
 * UI format types for client compatibility
 * - 'sep-1865': SEP-1865 standard (Anthropic + OpenAI unified format)
 * - 'photon': Legacy Photon format
 * - 'none': Text-only, no UI support
 */
export type UIFormat = 'sep-1865' | 'none';

/**
 * MIME for SPA sibling files served under /api/ui/<id>/<rest>. Conservative
 * map covering the file types a typical bundler emits next to index.html;
 * unknown extensions fall back to application/octet-stream so binary blobs
 * still transit cleanly.
 */
function uiSiblingMime(ext: string): string {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

export interface UnresolvedPhoton {
  name: string;
  workingDir: string;
  sources: Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>;
  recommendation?: string;
}

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
  transport?: TransportType;
  port?: number;
  logOptions?: LoggerOptions;
  unresolvedPhoton?: UnresolvedPhoton;
  /** Working directory override (base dir for state/config/cache) */
  workingDir?: string;
  /** Pre-imported module (for compiled binaries — skips file I/O and compilation) */
  preloadedModule?: { default: any; middleware?: any[] };
  /** Embedded source code (for compiled binaries — used for metadata extraction) */
  embeddedSource?: string;
  /** Pre-loaded @photon dependency modules (for compiled binaries) */
  preloadedDependencies?: Map<
    string,
    { module: { default: any; middleware?: any[] }; source: string; filePath: string }
  >;
  /** Embedded frontend assets (for compiled binaries built with --with-app) */
  embeddedAssets?: { indexHtml: string; bundleJs: string };
  /** Embedded @ui HTML templates: photonName → { assetId → html content } */
  embeddedUITemplates?: Record<string, Record<string, string>>;
  /**
   * Embedded asset tree for `<photon>/<name>/assets/**` (v1.29 Track E).
   * Shape: photonName → { relativePath → utf-8 content }. Consumed by the
   * directory-style serving path so SPA chunks (sibling JS/CSS next to a
   * declared @ui index.html) resolve in standalone binaries without a
   * filesystem lookup.
   */
  embeddedAssetTree?: Record<string, Record<string, string>>;
  /** Channel mode — declares channel capabilities for target clients */
  channelMode?: boolean;
  /** Channel name — becomes the MCP server name and <channel source="name"> */
  channelName?: string;
  /** Target channel protocols, e.g. ['claude']. Determines which capabilities to declare. */
  channelTargets?: string[];
  /** Channel instructions — goes into Claude's system prompt */
  channelInstructions?: string;
}

// ChannelPermissionRequest and ChannelPermissionResponse re-exported from channel-manager
export type { ChannelPermissionRequest, ChannelPermissionResponse } from './channel-manager.js';

// SSE session record for managing multiple clients
type SSESession = {
  server: Server;
  transport: SSEServerTransport;
};

/**
 * Context passed to shared handler methods to abstract STDIO vs SSE differences
 */
interface HandlerContext {
  server: Server;
  getInstanceName: () => string | undefined;
  setInstanceName: (name: string) => void;
  sessionId: string;
}

/**
 * Minimal Streamable HTTP transport for compiled binaries with Beam UI.
 * Implements the Transport interface so the SDK Server can connect to it,
 * then handles HTTP requests matching the Beam frontend's protocol:
 *   POST /mcp — JSON-RPC request → JSON response with Mcp-Session-Id
 *   GET /mcp?sessionId=X — SSE stream for server notifications
 */
/** Tool/metadata info for a sub-photon exposed via Beam sidebar. */
interface SubPhotonInfo {
  name: string;
  description: string;
  icon: string;
  stateful: boolean;
  hasSettings: boolean;
  tools: any[]; // MCP tool definitions (name, description, inputSchema)
}

class BeamCompatTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: any, extra?: any) => void;

  sessionId = crypto.randomUUID();
  private sseResponse: ServerResponse | null = null;
  private pendingResponse: ((message: any) => void) | null = null;

  /** Sub-photons whose tools are injected into tools/list alongside the main photon. */
  subPhotons: SubPhotonInfo[] = [];
  /** Callback to execute a tool on a sub-photon by name. */
  subPhotonExecutor?: (photonName: string, method: string, args: any) => Promise<any>;

  constructor(
    private photonName: string,
    private photonMeta: {
      description?: string;
      icon?: string;
      stateful?: boolean;
      hasSettings?: boolean;
    }
  ) {}

  async start(): Promise<void> {
    /* no-op — transport is ready immediately */
  }

  async close(): Promise<void> {
    if (this.sseResponse) {
      this.sseResponse.end();
      this.sseResponse = null;
    }
    this.onclose?.();
  }

  async send(message: any): Promise<void> {
    // Transform outgoing tools/list responses: prefix names + add x-photon-* metadata
    if (message?.result?.tools && Array.isArray(message.result.tools)) {
      // Main photon tools
      message.result.tools = message.result.tools.map((tool: any) => ({
        ...tool,
        name: `${this.photonName}/${tool.name}`,
        'x-photon-id': this.photonName,
        'x-photon-description': this.photonMeta.description || '',
        'x-photon-icon': this.photonMeta.icon || '⚡',
        'x-photon-stateful': this.photonMeta.stateful || false,
        'x-photon-has-settings': this.photonMeta.hasSettings || false,
      }));

      // Append sub-photon tools (each with their own x-photon-* metadata)
      for (const sub of this.subPhotons) {
        const subTools = sub.tools.map((tool: any) => {
          const def: any = {
            ...tool,
            name: `${sub.name}/${tool.name}`,
            'x-photon-id': sub.name,
            'x-photon-description': sub.description,
            'x-photon-icon': sub.icon,
            'x-photon-stateful': sub.stateful,
            'x-photon-has-settings': sub.hasSettings,
          };
          // Add UI linking metadata if this tool has a linked UI
          if (tool.linkedUi) {
            def._meta = { ui: { resourceUri: `ui://${sub.name}/${tool.linkedUi}` } };
          }
          return def;
        });
        message.result.tools.push(...subTools);
      }
    }

    // If there's a pending HTTP request waiting for a response, deliver it
    if (this.pendingResponse) {
      const resolve = this.pendingResponse;
      this.pendingResponse = null;
      resolve(message);
      return;
    }
    // Otherwise push to SSE stream if connected
    if (this.sseResponse && !this.sseResponse.writableEnded) {
      const id = message.id ?? crypto.randomUUID();
      this.sseResponse.write(`event: message\nid: ${id}\ndata: ${JSON.stringify(message)}\n\n`);
    }
  }

  async handleHTTP(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const corsOrigin = getCorsOrigin(req);

    // GET — open SSE stream for server-to-client notifications
    if (req.method === 'GET') {
      this.sseResponse = res;
      const sseHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Mcp-Session-Id': this.sessionId,
      };
      if (corsOrigin) sseHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      res.writeHead(200, sseHeaders);
      // Send initial event so the client knows connection is established
      res.write(':connected\n\n');
      // Send keepalive every 15s
      const keepalive = setInterval(() => {
        if (!res.writableEnded) {
          try {
            res.write(':keepalive\n\n');
          } catch {
            /* stream closed */
          }
        }
      }, 15000);
      req.on('close', () => {
        clearInterval(keepalive);
        this.sseResponse = null;
      });
      res.on('error', () => {
        clearInterval(keepalive);
        this.sseResponse = null;
      });
      return;
    }

    // POST — JSON-RPC request/response
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;

      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // Transform incoming tools/call: strip photonName/ prefix from tool name
      // and route sub-photon calls directly
      if (parsed.method === 'tools/call' && parsed.params?.name) {
        const slashIdx = parsed.params.name.indexOf('/');
        if (slashIdx !== -1) {
          const targetPhoton = parsed.params.name.slice(0, slashIdx);
          const methodName = parsed.params.name.slice(slashIdx + 1);

          // Check if this is a sub-photon call
          if (targetPhoton !== this.photonName && this.subPhotonExecutor) {
            const sub = this.subPhotons.find((s) => s.name === targetPhoton);
            if (sub) {
              try {
                const result = await this.subPhotonExecutor(
                  targetPhoton,
                  methodName,
                  parsed.params.arguments || {}
                );
                const response = { jsonrpc: '2.0', id: parsed.id, result };
                const subHeaders: Record<string, string> = {
                  'Content-Type': 'application/json',
                  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
                  'Mcp-Session-Id': this.sessionId,
                };
                if (corsOrigin) subHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                res.writeHead(200, subHeaders);
                res.end(JSON.stringify(response));
                return;
              } catch (err: any) {
                const response = {
                  jsonrpc: '2.0',
                  id: parsed.id,
                  result: {
                    content: [{ type: 'text', text: err.message || String(err) }],
                    isError: true,
                  },
                };
                const errHeaders: Record<string, string> = {
                  'Content-Type': 'application/json',
                };
                if (corsOrigin) errHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                res.writeHead(200, errHeaders);
                res.end(JSON.stringify(response));
                return;
              }
            }
          }

          // Main photon — strip prefix
          parsed.params.name = methodName;
        }
      }

      // Track C closure: surface CF Access (and equivalent) claims to the
      // request handlers so the per-claim instance pool can route. The
      // claims ride on the SDK's MessageExtraInfo.authInfo.extra, which
      // the protocol layer propagates to setRequestHandler's `extra` arg.
      const { extractClaimsFromHeaders } = await import('./shared/extract-claims.js');
      const claims = extractClaimsFromHeaders(req.headers);
      const messageExtra = claims
        ? {
            sessionId: this.sessionId,
            authInfo: { token: '', clientId: '', scopes: [], extra: claims },
          }
        : { sessionId: this.sessionId };

      // Notifications have no id — fire-and-forget
      if (parsed.id === undefined) {
        this.onmessage?.(parsed, messageExtra);
        const notifHeaders: Record<string, string> = {
          'Mcp-Session-Id': this.sessionId,
        };
        if (corsOrigin) notifHeaders['Access-Control-Allow-Origin'] = corsOrigin;
        res.writeHead(202, notifHeaders);
        res.end();
        return;
      }

      // Request — wait for the Server to call send() with the response
      const response = await new Promise<any>((resolve) => {
        this.pendingResponse = resolve;
        this.onmessage?.(parsed, messageExtra);
      });

      const resHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Mcp-Session-Id': this.sessionId,
      };
      if (corsOrigin) resHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      res.writeHead(200, resHeaders);
      res.end(JSON.stringify(response));
      return;
    }

    // DELETE — session termination (spec compliance)
    if (req.method === 'DELETE') {
      const delHeaders: Record<string, string> = {};
      if (corsOrigin) delHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      res.writeHead(200, delHeaders);
      res.end();
      return;
    }

    const methodHeaders: Record<string, string> = {};
    if (corsOrigin) methodHeaders['Access-Control-Allow-Origin'] = corsOrigin;
    res.writeHead(405, methodHeaders);
    res.end('Method not allowed');
  }
}

export class PhotonServer {
  private loader: PhotonLoader;
  private mcp: PhotonClassWithMeta | null = null;
  private server: Server;
  private taskExecutor: TaskExecutor;
  private options: PhotonServerOptions;
  private mcpClientFactory: SDKMCPClientFactory | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private sseSessions: Map<string, SSESession> = new Map();
  private devMode: boolean;
  private hotReloadDisabled = false;
  private lastReloadError?: {
    message: string;
    stack?: string;
    timestamp: number;
    attempts: number;
  };
  private statusClients: Set<ServerResponse> = new Set();
  private channelManager: ChannelManager;
  private daemonName: string | null = null;
  /** Tracked instance name for daemon drift recovery (STDIO path) */
  private daemonInstanceName?: string;
  /** Tracked instance names per SSE session for daemon drift recovery */
  private sseInstanceNames = new Map<string, string>();
  /**
   * Track C closure: per-claim instance pool. Populated lazily on first
   * request from a new authenticated caller when the photon declares
   * `@stateful` + `@auth`. Without this, every authenticated caller
   * shares `this.mcp.instance` — meaning two users on the standalone
   * HTTP server race on the same `this.tasks` / `this.memory`.
   *
   * Daemon path doesn't need this — it has its own per-instance loader
   * (`session-manager.ts`). Cloudflare doesn't need it either — the
   * outer Worker selects a DO per claim before the request arrives.
   * This pool is the standalone HTTP server's equivalent.
   */
  private instancePool = new Map<string, Promise<PhotonClassExtended>>();
  /**
   * True iff the loaded photon declares both `@stateful` and `@auth` —
   * the only shape that actually wants per-caller state isolation. For
   * everything else, instance routing is a no-op and `this.mcp` is used
   * directly.
   */
  private requiresInstanceRouting = false;
  /** Whether client capabilities have been logged (one-time on first tools/list) */
  private clientCapabilitiesLogged = false;
  /** Client capability detection and negotiation */
  private capabilityNegotiator = new CapabilityNegotiator();
  /** Write queue for serialized STDIO notifications (prevents interleaving from concurrent generators) */
  private _notifyQueue: Promise<void> = Promise.resolve();

  /** Compatibility alias for tests that seed raw capabilities directly on PhotonServer */
  public rawClientCapabilities = this.capabilityNegotiator.rawClientCapabilities;
  /** Resource listing, reading, and asset serving */
  private resourceServer: ResourceServer;
  /**
   * Server-wide registry of `resources/subscribe` state. The STDIO server
   * registers one persistent sink; each SSE session registers a per-session
   * sink at connect and clears its subscriptions at close.
   */
  private subscriptions = new SubscriptionRegistry();
  /** Stable sink for the STDIO server, registered once on first subscribe. */
  private stdioSink?: ResourceUpdateSink;
  /**
   * Per-server roots cache. Populated on `oninitialized` if the client
   * declared the `roots` capability, refreshed on
   * `notifications/roots/list_changed`. Read at tool-call time and threaded
   * into ALS so `this.roots` resolves synchronously inside photon code.
   *
   * WeakMap-keyed so dead session servers stop holding cache entries
   * automatically when SSE sessions disconnect.
   */
  private rootsByServer = new WeakMap<Server, Array<{ uri: string; name?: string }>>();
  private currentStatus: {
    type: 'info' | 'success' | 'error' | 'warn';
    message: string;
    timestamp: number;
  } = {
    type: 'info',
    message: 'Ready',
    timestamp: Date.now(),
  };
  private logger: Logger;

  /** Get the loaded photon (available after start()) */
  getLoadedPhoton(): PhotonClassExtended | null {
    return this.mcp;
  }

  /** Get the loader instance (for scheduler registration in compiled binaries) */
  getLoader(): PhotonLoader {
    return this.loader;
  }

  constructor(options: PhotonServerOptions) {
    // Validate options (filePath validation skipped for unresolved photons)
    if (!options.unresolvedPhoton) {
      assertString(options.filePath, 'filePath');
      validateOrThrow(options.filePath, [
        notEmpty('filePath'),
        hasExtension('filePath', ['ts', 'js']),
      ]);
    }

    if (options.transport) {
      validateOrThrow(options.transport, [oneOf<TransportType>('transport', ['stdio', 'sse'])]);
    }

    if (options.port !== undefined) {
      validateOrThrow(options.port, [inRange('port', 1, 65535)]);
    }

    this.options = options;
    this.devMode = options.devMode || false;

    const baseLoggerOptions: LoggerOptions = {
      component: 'photon-server',
      scope: options.transport ?? 'stdio',
      minimal: true,
      ...options.logOptions,
    };
    if (!baseLoggerOptions.component) {
      baseLoggerOptions.component = 'photon-server';
    }
    if (!baseLoggerOptions.scope) {
      baseLoggerOptions.scope = this.devMode ? 'dev' : 'runtime';
    }
    this.logger = createLogger(baseLoggerOptions);

    const loaderVerbose =
      (baseLoggerOptions.level ?? 'info') !== 'warn' &&
      (baseLoggerOptions.level ?? 'info') !== 'error';
    this.loader = new PhotonLoader(
      loaderVerbose,
      this.logger.child({ component: 'photon-loader', scope: 'loader' }),
      options.workingDir
    );
    // Bridge `this.notifyResourceUpdated(uri)` from photon authors into the
    // server's SubscriptionRegistry so all subscribed clients get fanout.
    this.loader.setResourceUpdateNotifier((uri: string) => this.subscriptions.notify(uri));

    // Initialize ChannelManager — owns all channel/pub-sub logic
    // The sink is wired up lazily because `this.server` doesn't exist yet
    const channelSink: ChannelNotificationSink = {
      sendNotification: async (notification) => {
        await this.server.notification(notification as ServerNotification);
      },
      sendNotificationToAllSessions: async (notification) => {
        for (const session of Array.from(this.sseSessions.values())) {
          await session.server.notification(notification as ServerNotification);
        }
      },
      getPhotonInstance: () => this.mcp as unknown,
    };
    this.channelManager = new ChannelManager({
      channelOptions: {
        channelMode: options.channelMode,
        channelName: options.channelName,
        channelTargets: options.channelTargets,
        channelInstructions: options.channelInstructions,
      },
      workingDir: options.workingDir,
      sink: channelSink,
      log: (level, message, data) => this.log(level as LogLevel, message, data),
    });

    // Create MCP server instance
    this.server = new Server(
      {
        name: this.channelManager.getServerName(),
        version: PHOTON_VERSION,
      },
      {
        capabilities: {
          tools: {
            listChanged: true, // We support hot reload notifications
          },
          prompts: {
            listChanged: true, // We support hot reload notifications
          },
          resources: {
            listChanged: true, // We support hot reload notifications
            subscribe: true, // resources/subscribe + notifications/resources/updated
          },
          logging: {}, // Required for notifications/message (used by render, log, etc.)
          tasks: {
            list: {},
            cancel: {},
            requests: {
              tools: { call: {} },
            },
          },
          // Channel capabilities (experimental) — delegated to ChannelManager
          ...this.channelManager.getExtraCapabilities(),
        },
        // Channel instructions
        ...this.channelManager.getExtraServerOptions(),
      }
    );

    // Task executor — handles MCP Tasks protocol (spec v2025-11-25)
    this.taskExecutor = new TaskExecutor(
      (level, message, meta) => this.log(level, message, meta),
      {
        executeTool: (photon, toolName, args, opts) =>
          this.loader.executeTool(photon as PhotonClass, toolName, args, opts),
      },
      { createMCPInputProvider: (server) => this.createMCPInputProvider(server) }
    );

    // Resource server — handles ListResources, ReadResource, asset serving
    this.resourceServer = new ResourceServer(
      {
        executeTool: (photon, toolName, args) => this.loader.executeTool(photon, toolName, args),
        getLoadedPhotons: () => this.loader.getLoadedPhotons(),
      },
      {
        filePath: options.filePath,
        embeddedAssets: options.embeddedAssets,
        embeddedUITemplates: options.embeddedUITemplates,
        embeddedAssetTree: options.embeddedAssetTree,
      }
    );

    // Set up protocol handlers
    this.setupHandlers();
  }

  public createScopedLogger(scope: string): Logger {
    return this.logger.child({ scope });
  }

  public getLogger(): Logger {
    return this.logger;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, any>) {
    this.logger.log(level, message, meta);
  }

  /**
   * Send a permission response back to the client.
   * Delegates to ChannelManager.
   */
  public respondToPermission(response: ChannelPermissionResponse) {
    this.channelManager.respondToPermission(response);
  }

  /**
   * Log client identity and capabilities for debugging tier detection
   */
  private logClientCapabilities(server: Server): void {
    const clientInfo = server.getClientVersion();
    const capabilities = server.getClientCapabilities();
    const supportsUI = this.capabilityNegotiator.supportsUI(server);
    const supportsElicitation = this.capabilityNegotiator.supportsElicitation(server);

    this.log('debug', 'Client connected', {
      name: clientInfo?.name ?? 'unknown',
      version: clientInfo?.version ?? 'unknown',
      tier: supportsUI ? 'mcp-apps' : 'basic',
      supportsUI,
      supportsElicitation,
      capabilities: JSON.stringify(capabilities),
    });
  }

  /**
   * Send a notification through the STDIO write queue.
   * Serializes writes so concurrent generators don't interleave JSON on stdout.
   */
  private queueNotification(notification: ServerNotification): void {
    this._notifyQueue = this._notifyQueue
      .then(() => this.server?.notification(notification))
      .catch((err) =>
        this.logger.debug('Failed to send notification', { error: getErrorMessage(err) })
      );
  }

  /**
   * Create an MCP-aware input provider for generator ask yields
   *
   * Uses MCP elicitInput() when client supports elicitation,
   * otherwise falls back to readline prompts.
   */
  private createMCPInputProvider(server?: Server): (ask: any) => Promise<any> {
    const targetServer = server || this.server;
    const capabilities = targetServer.getClientCapabilities();
    const supportsElicitation = this.capabilityNegotiator.supportsElicitation(targetServer);

    this.log('debug', 'Creating MCP input provider', {
      supportsElicitation,
      capabilities: JSON.stringify(capabilities),
    });

    return async (ask: any): Promise<any> => {
      // If client doesn't support elicitation, fall back to logging the ask
      // (MCP servers can't use readline - they communicate via protocol)
      if (!supportsElicitation) {
        this.log('warn', `Client doesn't support elicitation, ask will be skipped`, {
          ask: ask.ask,
          message: ask.message,
        });
        // Return default values for non-elicitation clients
        return this.getDefaultForAsk(ask);
      }

      try {
        // Build elicitation request based on ask type
        const elicitParams = this.buildElicitParams(ask);

        // Call server.elicitInput() to request user input from the client
        const result = await targetServer.elicitInput(elicitParams);

        if (result.action === 'accept' && result.content) {
          // Extract the value from the response content
          return this.extractElicitValue(ask, result.content);
        } else if (result.action === 'decline' || result.action === 'cancel') {
          this.log('info', `User ${result.action}ed elicitation`, { ask: ask.ask });
          return this.getDefaultForAsk(ask);
        }

        return this.getDefaultForAsk(ask);
      } catch (error) {
        this.log('error', `Elicitation failed`, { ask: ask.ask, error: getErrorMessage(error) });
        return this.getDefaultForAsk(ask);
      }
    };
  }

  /**
   * Create an MCP-aware sampling provider for `this.sample()`.
   *
   * When the client advertises the `sampling` capability, this returns
   * a provider that forwards to `server.createMessage(...)`. When the
   * client doesn't, the provider throws — matching what the user wired
   * into Photon base's `this.sample()` (explicit failure rather than
   * silent fallback to a canned string).
   */
  private createMCPSamplingProvider(server?: Server): (params: any) => Promise<any> {
    const targetServer = server || this.server;
    const supportsSampling = this.capabilityNegotiator.supportsSampling(targetServer);

    return async (params: any): Promise<any> => {
      if (!supportsSampling) {
        throw new Error(
          'Connected MCP client did not declare the `sampling` capability; ' +
            'this.sample() is unavailable for this invocation.'
        );
      }
      try {
        const result = await targetServer.createMessage({
          messages: params.messages,
          systemPrompt: params.systemPrompt,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          modelPreferences: params.modelPreferences,
          stopSequences: params.stopSequences,
          includeContext: params.includeContext,
        });
        return result;
      } catch (error) {
        this.log('error', 'Sampling request failed', {
          error: getErrorMessage(error),
        });
        throw error;
      }
    };
  }

  /**
   * Build MCP elicit request params from a Photon ask yield
   */
  private buildElicitParams(ask: any): any {
    const baseMessage = ask.message || 'Please provide input';

    switch (ask.ask) {
      case 'text':
      case 'password':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                title: ask.label || 'Input',
                description: ask.hint || ask.message,
                default: ask.default,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      case 'confirm':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              confirmed: {
                type: 'boolean',
                title: 'Confirm',
                description: ask.message,
                default: ask.default ?? false,
              },
            },
            required: ['confirmed'],
          },
        };

      case 'number':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'number',
                title: ask.label || 'Number',
                description: ask.hint || ask.message,
                default: ask.default,
                minimum: ask.min,
                maximum: ask.max,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      case 'select':
        // For select, we use enum in the schema
        const options = (ask.options || []).map((o: any) => (typeof o === 'string' ? o : o.value));
        const labels = (ask.options || []).map((o: any) => (typeof o === 'string' ? o : o.label));
        return {
          mode: 'form',
          message: baseMessage + (ask.multi ? ' (select multiple)' : ''),
          requestedSchema: {
            type: 'object',
            properties: {
              selection: ask.multi
                ? {
                    type: 'array',
                    items: { type: 'string', enum: options },
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                  }
                : {
                    type: 'string',
                    enum: options,
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                  },
            },
            required: ask.required !== false ? ['selection'] : [],
          },
        };

      case 'date':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                format: 'date',
                title: ask.label || 'Date',
                description: ask.hint || ask.message,
                default: ask.default,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      default:
        // Generic text input for unknown types
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                title: 'Input',
              },
            },
          },
        };
    }
  }

  /**
   * Extract value from elicitation response content
   */
  private extractElicitValue(ask: any, content: Record<string, any>): any {
    switch (ask.ask) {
      case 'confirm':
        return content.confirmed ?? false;
      case 'select':
        return content.selection;
      default:
        return content.value;
    }
  }

  /**
   * Get default value for an ask when elicitation is not available or declined
   */
  private getDefaultForAsk(ask: any): any {
    if ('default' in ask) {
      return ask.default;
    }

    switch (ask.ask) {
      case 'confirm':
        return false;
      case 'number':
        return 0;
      case 'select':
        return ask.multi ? [] : null;
      case 'date':
        return new Date().toISOString().split('T')[0];
      default:
        return '';
    }
  }

  // ─── Shared handler implementations ─────────────────────────────────
  // These methods contain the core logic shared between STDIO and SSE transports.
  // Both setupHandlers() and setupSessionHandlers() delegate to these.

  /** Cache for @choice-from resolved values: key = "toolName.field", value = { values, resolvedAt } */
  private choiceFromCache = new Map<string, { values: string[]; resolvedAt: number }>();
  private static readonly CHOICE_FROM_CACHE_TTL = 30_000; // 30 seconds

  /**
   * Resolve all x-choiceFrom fields in a tool's inputSchema by calling the referenced tool.
   * Mutates the inputSchema in-place (sets enum from tool results).
   */
  private async resolveChoiceFromFields(toolDef: any): Promise<void> {
    const props = toolDef.inputSchema?.properties;
    if (!props || !this.mcp || !this.loader) return;

    for (const [, rawSchema] of Object.entries(props)) {
      const paramSchema = rawSchema as Record<string, any>;
      const choiceFrom = paramSchema['x-choiceFrom'];
      if (!choiceFrom || typeof choiceFrom !== 'string') continue;

      // Parse "toolName" or "toolName.field"
      const dotIdx = choiceFrom.indexOf('.');
      const toolName = dotIdx >= 0 ? choiceFrom.substring(0, dotIdx) : choiceFrom;
      const fieldName = dotIdx >= 0 ? choiceFrom.substring(dotIdx + 1) : null;

      // Check cache
      const cached = this.choiceFromCache.get(choiceFrom);
      if (cached && Date.now() - cached.resolvedAt < PhotonServer.CHOICE_FROM_CACHE_TTL) {
        paramSchema.enum = cached.values;
        continue;
      }

      // Verify the referenced tool exists
      const providerTool = this.mcp.tools.find((t) => t.name === toolName);
      if (!providerTool) continue;

      try {
        const result = await this.loader.executeTool(this.mcp, toolName, {});
        let values: string[] = [];

        if (Array.isArray(result)) {
          values = result.map((item) => {
            if (typeof item === 'string') return item;
            if (fieldName && item && typeof item === 'object' && item[fieldName] != null) {
              return String(item[fieldName]);
            }
            // Auto-detect: try name, label, value, title, then first string field
            if (item && typeof item === 'object') {
              for (const key of ['name', 'label', 'value', 'title']) {
                if (typeof item[key] === 'string') return item[key];
              }
              const firstStr = Object.values(item).find((v) => typeof v === 'string');
              if (firstStr) return String(firstStr);
            }
            return String(item);
          });
        }

        if (values.length > 0) {
          paramSchema.enum = values;
          this.choiceFromCache.set(choiceFrom, { values, resolvedAt: Date.now() });
        }
      } catch (err) {
        this.log('warn', `Failed to resolve @choice-from ${choiceFrom}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async handleListTools(ctx: HandlerContext): Promise<{ tools: any[] }> {
    if (!this.mcp) {
      return { tools: [] };
    }

    const tools = this.mcp.tools.map((tool) => {
      // Append deprecation notice to tool description if tagged
      let description = tool.description;
      const deprecated = (tool as ExtractedSchema).deprecated;
      if (deprecated) {
        const notice = typeof deprecated === 'string' ? deprecated : 'This tool is deprecated.';
        description = `[DEPRECATED: ${notice}] ${description}`;
      }

      const toolDef: MCPToolDefinition = {
        name: tool.name,
        description,
        inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)),
      };

      // MCP standard annotations (2025-11-25 spec)
      const schema = tool as ExtractedSchema;
      const annotations: Record<string, unknown> = {};
      if (schema.title) annotations.title = schema.title;
      if (schema.readOnlyHint) annotations.readOnlyHint = true;
      if (schema.destructiveHint) annotations.destructiveHint = true;
      if (schema.idempotentHint) annotations.idempotentHint = true;
      if (schema.openWorldHint !== undefined) annotations.openWorldHint = schema.openWorldHint;
      if (Object.keys(annotations).length > 0) toolDef.annotations = annotations;

      // MCP structured output schema
      if (schema.outputSchema) toolDef.outputSchema = schema.outputSchema;

      // MCP tool icons (resolve image paths to data URIs)
      if (tool.iconImages && tool.iconImages.length > 0) {
        const icons = this.resourceServer.resolveIconImages(tool.iconImages);
        if (icons.length > 0) toolDef.icons = icons;
      }

      const linkedUI = this.mcp?.assets?.ui.find(
        (u) => u.linkedTool === tool.name || u.linkedTools?.includes(tool.name)
      );
      if (linkedUI && this.capabilityNegotiator.supportsUI(ctx.server)) {
        toolDef._meta = this.resourceServer.buildUIToolMeta(this.mcp!.name, linkedUI.id);
      }

      return toolDef;
    });

    // Add runtime-injected instance tools for stateful photons
    if (this.daemonName) {
      tools.push({
        name: '_use',
        description: `Switch to a named instance. Pass empty name for default. Omit name to select interactively.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Instance name. Pass empty string "" for default. Omit entirely to select interactively.',
            },
          },
        },
      });
      tools.push({
        name: '_instances',
        description: `List all available instances.`,
        inputSchema: { type: 'object', properties: {} },
      });
      tools.push({
        name: '_undo',
        description: `Undo the last state mutation. Reverts the most recent tool call's changes.`,
        inputSchema: { type: 'object', properties: {} },
      });
      tools.push({
        name: '_redo',
        description: `Redo the last undone mutation. Re-applies a previously undone change.`,
        inputSchema: { type: 'object', properties: {} },
      });
    }

    // Resolve @choice-from fields (dynamic enum from tool calls)
    const choiceFromPromises = tools
      .filter((t) => {
        const props = t.inputSchema?.properties;
        return props && Object.values(props).some((p: any) => p['x-choiceFrom']);
      })
      .map((t) => this.resolveChoiceFromFields(t));
    if (choiceFromPromises.length > 0) {
      await Promise.all(choiceFromPromises);
    }

    return { tools };
  }

  /**
   * Resolve which photon instance handles this call. For `@stateful` +
   * `@auth` photons we pull claims from the request's `authInfo.extra`
   * (populated by `BeamCompatTransport` from the HTTP headers), look up
   * the binding rule from the `@auth` directive, and lazy-load a fresh
   * photon instance keyed by that claim value. Subsequent calls from
   * the same caller reuse the cached instance so `this.memory` /
   * `this.tasks` persist across requests within their per-user scope.
   *
   * Returns `this.mcp` (the shared singleton) when the photon doesn't
   * declare per-caller routing, when claims are missing, or when the
   * binding rule yields no instance name. The fallback is intentional:
   * unauthenticated requests still execute, they just share the default
   * instance — same as a v1.28 photon would.
   */
  private async resolveInstanceMcp(
    extra: { authInfo?: { extra?: Record<string, unknown> } } | undefined
  ): Promise<PhotonClassExtended> {
    if (!this.requiresInstanceRouting || !this.mcp) return this.mcp!;
    const claims = extra?.authInfo?.extra;
    if (!claims) return this.mcp;
    const { resolveInstanceFromClaims, parseAuthDirective } =
      await import('./shared/instance-binding.js');
    const photonAuth = (this.mcp as { auth?: string }).auth;
    const { scheme, claim } = parseAuthDirective(photonAuth);
    const bound = resolveInstanceFromClaims(scheme, claims, claim);
    if (!bound) return this.mcp;
    let pending = this.instancePool.get(bound);
    if (!pending) {
      this.log('info', `Lazy-loading instance for ${bound}`);
      pending = this.loader.loadFile(this.options.filePath, { instanceName: bound });
      this.instancePool.set(bound, pending);
    }
    return pending;
  }

  private async handleCallTool(
    ctx: HandlerContext,
    request: any,
    extra?: { authInfo?: { extra?: Record<string, unknown> } }
  ): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }
    const targetMcp = await this.resolveInstanceMcp(extra);

    const { name: toolName, arguments: args } = request.params;
    // Per MCP spec, the server must echo the client-supplied progressToken
    // from request _meta back in notifications/progress so clients can match
    // streamed progress to their original request. Fall back to a synthetic
    // token only when the client didn't supply one.
    const clientProgressToken = (request.params as { _meta?: { progressToken?: string | number } })
      ?._meta?.progressToken;
    const progressToken = clientProgressToken ?? `progress_${toolName}`;

    // Route _use, _instances, _undo, _redo through daemon for stateful photons
    if (
      this.daemonName &&
      (toolName === '_use' ||
        toolName === '_instances' ||
        toolName === '_undo' ||
        toolName === '_redo')
    ) {
      const { sendCommand } = await import('./daemon/client.js');
      const sendOpts = {
        photonPath: this.options.filePath,
        sessionId: ctx.sessionId,
        instanceName: ctx.getInstanceName(),
        workingDir: this.options.workingDir,
      };

      // Elicitation-based instance selection when _use called without name
      if (
        toolName === '_use' &&
        (!args || !('name' in args)) &&
        this.capabilityNegotiator.supportsElicitation(ctx.server)
      ) {
        const instancesResult = (await sendCommand(
          this.daemonName,
          '_instances',
          {},
          sendOpts
        )) as { instances?: string[]; current?: string };
        const instances = instancesResult?.instances || ['default'];

        const options: Array<{ const: string; title: string }> = instances.map((inst: string) => ({
          const: inst,
          title: inst === 'default' ? '(default)' : inst,
        }));
        options.push({ const: '__create_new__', title: 'Create new...' });

        const result = await ctx.server.elicitInput({
          message: 'Select an instance',
          requestedSchema: {
            type: 'object' as const,
            properties: {
              instance: {
                type: 'string',
                title: 'Instance',
                oneOf: options,
                default: instancesResult?.current || 'default',
              },
            },
            required: ['instance'],
          },
        });

        if (result.action !== 'accept' || !result.content) {
          return { content: [{ type: 'text', text: 'Cancelled' }] };
        }

        let selectedName = (result.content as Record<string, string>).instance;

        // Handle "Create new..." selection
        if (selectedName === '__create_new__') {
          const nameResult = await ctx.server.elicitInput({
            message: 'Enter a name for the new instance',
            requestedSchema: {
              type: 'object' as const,
              properties: {
                name: { type: 'string', title: 'Instance name' },
              },
              required: ['name'],
            },
          });

          if (nameResult.action !== 'accept' || !nameResult.content) {
            return { content: [{ type: 'text', text: 'Cancelled' }] };
          }
          selectedName = (nameResult.content as Record<string, string>).name;
        }

        const useResult = await sendCommand(
          this.daemonName,
          '_use',
          { name: selectedName },
          sendOpts
        );
        ctx.setInstanceName(selectedName);
        return {
          content: [{ type: 'text', text: JSON.stringify(useResult, null, 2) }],
        };
      }

      const result = await sendCommand(
        this.daemonName,
        toolName,
        (args || {}) as Record<string, any>,
        sendOpts
      );
      // Track instance name after successful _use
      if (toolName === '_use') {
        const nameVal = (args as Record<string, unknown> | undefined)?.name;
        ctx.setInstanceName(typeof nameVal === 'string' ? nameVal : '');
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    // Create MCP-aware input provider for elicitation support
    const inputProvider = this.createMCPInputProvider(ctx.server);
    // Create MCP-aware sampling provider for this.sample() — delegates
    // to the client's LLM via sampling/createMessage.
    const samplingProvider = this.createMCPSamplingProvider(ctx.server);

    // Handler for channel events - forward to daemon for cross-process pub/sub
    const outputHandler = (emit: any) => {
      // Forward channel events to daemon for cross-process pub/sub
      this.channelManager.publishIfChannel(emit);

      // Forward emit yields as MCP progress notifications to STDIO client
      // All notifications go through queueNotification to prevent interleaving
      // when concurrent generators write to the same stdout pipe
      if (emit?.emit === 'progress') {
        const rawValue = typeof emit.value === 'number' ? emit.value : 0;
        const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
        this.queueNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress,
            total: 100,
            ...(emit.message ? { message: emit.message } : {}),
          },
        } as ServerNotification);
      } else if (emit?.emit === 'status') {
        this.queueNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: 0,
            total: 100,
            message: emit.message || '',
          },
        } as ServerNotification);
      } else if (emit?.emit === 'log') {
        this.queueNotification({
          method: 'notifications/message',
          params: {
            level: emit.level || 'info',
            data: emit.message || '',
          },
        } as ServerNotification);
      } else if (emit?.emit === 'render') {
        this.queueNotification({
          method: 'notifications/message',
          params: {
            level: 'info',
            data: JSON.stringify({
              _render: true,
              format: emit.format,
              value: emit.value,
            }),
          },
        } as ServerNotification);
      } else if (emit?.emit === 'render:clear') {
        this.queueNotification({
          method: 'notifications/message',
          params: {
            level: 'info',
            data: JSON.stringify({ _render: true, clear: true }),
          },
        } as ServerNotification);
      }
    };

    const tool = targetMcp.tools.find((t) => t.name === toolName);
    const outputFormat = tool?.outputFormat;

    const startTime = Date.now();
    const result = await this.loader.executeTool(targetMcp, toolName, args || {}, {
      inputProvider,
      outputHandler,
      samplingProvider,
      roots: this.rootsByServer.get(ctx.server),
    });
    const durationMs = Date.now() - startTime;
    const transport = this.options.transport || 'stdio';
    this.log('info', `${toolName} completed in ${durationMs}ms`, {
      durationMs,
      photon: this.mcp?.name,
      transport,
    });
    audit({
      ts: new Date().toISOString(),
      event: 'tool_call',
      photon: this.mcp?.name,
      method: toolName,
      client: transport,
      durationMs,
    });

    const isStateful = result && typeof result === 'object' && result._stateful === true;
    const actualResult = isStateful ? result.result : result;

    // _meta format transformation: if the result was transformed by _meta.format,
    // return the pre-formatted text with its MIME type directly
    if (actualResult && typeof actualResult === 'object' && actualResult._metaFormatted === true) {
      const content: any = { type: 'text', text: actualResult.text };
      if (actualResult.mimeType) {
        content.annotations = { mimeType: actualResult.mimeType };
      }
      return { content: [content], isError: false };
    }

    // Build content with optional annotations
    const content: MCPTextContent = {
      type: 'text',
      text: this.formatResult(actualResult),
    };

    // Content annotations: audience and priority from schema, mimeType from format
    const contentAnnotations: Record<string, unknown> = {};
    const schema = tool as ExtractedSchema;
    if (schema?.audience) contentAnnotations.audience = schema.audience;
    if (schema?.contentPriority !== undefined) contentAnnotations.priority = schema.contentPriority;
    if (outputFormat) {
      const { formatToMimeType } = await import('./cli-formatter.js');
      const mimeType = formatToMimeType(outputFormat);
      if (mimeType) contentAnnotations.mimeType = mimeType;
    }
    if (Object.keys(contentAnnotations).length > 0) {
      content.annotations = contentAnnotations;
    }

    const response: MCPToolResponse = { content: [content], isError: false };

    // Structured output: include structuredContent when outputSchema is declared
    if (
      schema?.outputSchema &&
      actualResult &&
      typeof actualResult === 'object' &&
      !Array.isArray(actualResult)
    ) {
      response.structuredContent = actualResult;
    }

    // Add x-output-format for format-aware clients
    if (outputFormat) {
      response['x-output-format'] = outputFormat;
    }

    // Add stateful workflow metadata (machine-readable _meta)
    if (isStateful && result.runId) {
      response._meta = { ...response._meta, runId: result.runId, status: result.status };
    }

    // Enrich response with structuredContent + _meta for tools with linked UIs
    const linkedUI = this.mcp?.assets?.ui.find(
      (u) => u.linkedTool === toolName || u.linkedTools?.includes(toolName)
    );
    if (linkedUI && this.capabilityNegotiator.supportsUI(ctx.server)) {
      if (actualResult !== undefined && actualResult !== null) {
        response.structuredContent =
          typeof actualResult === 'string' ? { text: actualResult } : actualResult;
      }
      const uiMeta = this.resourceServer.buildUIToolMeta(this.mcp.name, linkedUI.id);
      response._meta = { ...response._meta, ...uiMeta };
    }

    return response;
  }

  private handleListPrompts(): { prompts: any[] } {
    if (!this.mcp) {
      return { prompts: [] };
    }

    return {
      prompts: this.mcp.templates.map((template) => ({
        name: template.name,
        description: template.description,
        arguments: Object.entries(template.inputSchema.properties || {}).map(([name, schema]) => ({
          name,
          description:
            (typeof schema === 'object' && schema && 'description' in schema
              ? (schema.description as string)
              : '') || '',
          required: template.inputSchema.required?.includes(name) || false,
        })),
      })),
    };
  }

  private async handleGetPrompt(request: any): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }

    const { name: promptName, arguments: args } = request.params;

    const template = this.mcp.templates.find((t) => t.name === promptName);
    if (!template) {
      throw new Error(`Prompt not found: ${promptName}`);
    }

    const result = await this.loader.executeTool(this.mcp, promptName, args || {});
    return this.formatTemplateResult(result);
  }

  // ─── Transport-specific setup ─────────────────────────────────────

  /**
   * Set up MCP protocol handlers (STDIO transport)
   */
  private setupHandlers() {
    const ctx: HandlerContext = {
      server: this.server,
      getInstanceName: () => this.daemonInstanceName,
      setInstanceName: (name) => {
        this.daemonInstanceName = name;
      },
      sessionId: `stdio-${this.daemonName}`,
    };

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.clientCapabilitiesLogged) {
        this.clientCapabilitiesLogged = true;
        this.logClientCapabilities(this.server);
      }

      // STDIO-only: deferred conflict resolution
      if (!this.mcp && this.options.unresolvedPhoton) {
        return { tools: this.buildPlaceholderTools() };
      }

      return this.handleListTools(ctx);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      // STDIO-only: deferred conflict resolution
      if (!this.mcp && this.options.unresolvedPhoton) {
        await this.resolveUnresolvedPhoton();
      }

      // STDIO-only: @async fire-and-forget execution
      if (this.mcp) {
        const { name: toolName, arguments: args } = request.params;
        const tool = this.mcp.tools.find((t) => t.name === toolName);
        if ((tool as ExtractedSchema)?.isAsync) {
          // Generate a W3C-compatible OTel trace ID (32 hex chars = 128-bit)
          const traceId = crypto.randomBytes(16).toString('hex');
          const executionId = traceId;
          const inputProvider = this.createMCPInputProvider();
          const samplingProvider = this.createMCPSamplingProvider();
          const clientProgressToken = (
            request.params as { _meta?: { progressToken?: string | number } }
          )?._meta?.progressToken;
          const progressToken = clientProgressToken ?? `progress_${toolName}`;
          const outputHandler = (emit: any) => {
            this.channelManager.publishIfChannel(emit);
            // Forward emit yields as MCP notifications for async tools
            if (emit?.emit === 'progress' || emit?.emit === 'status') {
              const rawValue =
                emit?.emit === 'progress' && typeof emit.value === 'number' ? emit.value : 0;
              const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
              void this.server?.notification({
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress,
                  total: 100,
                  message: emit.message || '',
                },
              });
            } else if (emit?.emit === 'log') {
              void this.server?.notification({
                method: 'notifications/message',
                params: {
                  level: emit.level || 'info',
                  data: emit.message || '',
                },
              });
            } else if (emit?.emit === 'render') {
              try {
                void this.server?.notification({
                  method: 'notifications/message',
                  params: {
                    level: 'info',
                    data: JSON.stringify({
                      _render: true,
                      format: emit.format,
                      value: emit.value,
                    }),
                  },
                });
              } catch {
                // Client may not support logging capability
              }
            } else if (emit?.emit === 'render:clear') {
              try {
                void this.server?.notification({
                  method: 'notifications/message',
                  params: {
                    level: 'info',
                    data: JSON.stringify({ _render: true, clear: true }),
                  },
                });
              } catch {
                // Client may not support logging capability
              }
            }
          };

          this.loader
            .executeTool(this.mcp, toolName, args || {}, {
              inputProvider,
              outputHandler,
              samplingProvider,
              traceId,
              roots: this.rootsByServer.get(ctx.server),
            })
            .catch((error) => {
              this.log('error', `Async tool ${toolName} failed`, {
                executionId,
                error: getErrorMessage(error),
              });
            });

          // Build W3C traceparent: 00-{traceId}-{spanId}-01
          const spanId = crypto.randomBytes(8).toString('hex');
          const traceparent = `00-${traceId}-${spanId}-01`;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    executionId,
                    _traceId: traceId,
                    _traceparent: traceparent,
                    status: 'running',
                    photon: this.mcp.name,
                    method: toolName,
                    message: `Task started in background. Use execution ID to check status.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      // ── Task mode: when params contain task field, run async ──
      const taskField = (request.params as Record<string, unknown>)?.task;
      if (taskField && this.mcp) {
        const { name: toolName, arguments: args } = request.params;
        return this.taskExecutor.handleTaskModeCall(this.mcp.name, toolName, args || {}, taskField);
      }

      try {
        return await this.handleCallTool(ctx, request, extra);
      } catch (error) {
        // STDIO-only: config elicitation retry
        const { name: toolName, arguments: args } = request.params;
        if (
          this.mcp?.instance?._photonConfigError &&
          this.capabilityNegotiator.supportsElicitation(this.server)
        ) {
          const retryResult = await this.attemptConfigElicitation(toolName, args || {});
          if (retryResult) return retryResult;
        }

        // STDIO-only: verbose error logging
        this.log('error', 'Tool execution failed', {
          tool: toolName,
          error: getErrorMessage(error),
          args: this.options.devMode ? args : undefined,
        });
        return this.formatError(error, toolName, args);
      }
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.handleListPrompts();
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        return await this.handleGetPrompt(request);
      } catch (error) {
        // STDIO-only: verbose error logging for prompts
        const { name: promptName } = request.params;
        this.log('error', 'Prompt execution failed', {
          prompt: promptName,
          error: getErrorMessage(error),
        });
        throw error;
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.resourceServer.handleListResources(this.mcp);
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.resourceServer.handleListResourceTemplates(this.mcp);
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.resourceServer.handleReadResource(request, this.mcp);
    });

    // ── resources/subscribe + resources/unsubscribe (STDIO) ──
    // Sink is created lazily on first subscribe so we never register an idle
    // sink for clients that don't use the capability.
    const ensureStdioSink = (): ResourceUpdateSink => {
      if (!this.stdioSink) {
        this.stdioSink = (uri: string) =>
          this.server.notification({
            method: 'notifications/resources/updated',
            params: { uri },
          });
      }
      return this.stdioSink;
    };
    this.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const uri = request.params.uri;
      this.subscriptions.subscribe(ensureStdioSink(), uri);
      return {};
    });
    this.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const uri = request.params.uri;
      if (this.stdioSink) {
        this.subscriptions.unsubscribe(this.stdioSink, uri);
      }
      return {};
    });

    // ── MCP Tasks handlers (2025-11-25 spec) — delegated to TaskExecutor ──

    this.server.setRequestHandler(GetTaskRequestSchema, async (request) => {
      return this.taskExecutor.handleGetTask(request.params.taskId);
    });

    this.server.setRequestHandler(ListTasksRequestSchema, async (request) => {
      return this.taskExecutor.handleListTasks(
        (request.params as Record<string, unknown>)?.cursor as string | undefined
      );
    });

    this.server.setRequestHandler(CancelTaskRequestSchema, async (request) => {
      return this.taskExecutor.handleCancelTask(request.params.taskId);
    });

    this.server.setRequestHandler(GetTaskPayloadRequestSchema, async (request) => {
      return this.taskExecutor.handleGetTaskPayload(request.params.taskId, this.server);
    });

    this.setupRootsForServer(this.server);
  }

  /**
   * Wire up `roots/list` discovery + `notifications/roots/list_changed`
   * refresh for one Server instance. Called once for the STDIO server and
   * once per SSE session.
   *
   * Eager fetch on initialize keeps `this.roots` synchronous inside photon
   * code — clients that don't declare the capability skip the fetch
   * entirely. The cache is server-scoped (per-session for SSE) so two
   * clients with different working directories don't see each other's
   * roots.
   */
  private setupRootsForServer(server: Server): void {
    server.oninitialized = () => {
      const caps = server.getClientCapabilities();
      if (!caps?.roots) return;
      void this.refreshRootsCache(server);
    };
    server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await this.refreshRootsCache(server);
    });
  }

  private async refreshRootsCache(server: Server): Promise<void> {
    try {
      const result = await server.listRoots();
      const roots = (result?.roots ?? []).map((r) => ({ uri: r.uri, name: r.name }));
      this.rootsByServer.set(server, roots);
    } catch (err) {
      this.log('warn', 'roots/list refresh failed', {
        error: err instanceof Error ? getErrorMessage(err) : String(err),
      });
    }
  }

  /**
   * Format tool result as text
   */
  private formatResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    } else if (result && typeof result === 'object') {
      // Handle {success, content} format
      if ('success' in result && 'content' in result) {
        return result.content || String(result);
      }
      // Handle {success, error} format
      if ('success' in result && 'error' in result) {
        if (!result.success) {
          throw new Error(result.error);
        }
        return result.error || 'Success';
      }
      return JSON.stringify(result, null, 2);
    }
    return String(result);
  }

  /**
   * Format template result to MCP prompt response
   */
  private formatTemplateResult(result: any): any {
    // Check if result is a TemplateResponse object
    if (result && typeof result === 'object' && 'messages' in result) {
      return {
        messages: result.messages,
      };
    }

    // Otherwise, treat as simple string template
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text,
          },
        },
      ],
    };
  }

  /**
   * Compatibility wrappers for tests and older internal call sites after
   * resource helpers moved into ResourceServer.
   */
  public isUriTemplate(uri: string): boolean {
    return this.resourceServer.isUriTemplate(uri);
  }

  public matchUriPattern(pattern: string, uri: string): boolean {
    return this.resourceServer.matchUriPattern(pattern, uri);
  }

  public parseUriParams(pattern: string, uri: string): Record<string, string> {
    return this.resourceServer.parseUriParams(pattern, uri);
  }

  public formatStaticResult(result: any, mimeType?: string): any {
    return this.resourceServer.formatStaticResult(result, mimeType);
  }

  public clientSupportsUI(server: Server): boolean {
    return this.capabilityNegotiator.supportsUI(server);
  }

  public buildUIToolMeta(uiId: string): Record<string, unknown> {
    const photonName =
      this.mcp?.name || path.basename(this.options.filePath, path.extname(this.options.filePath));
    return this.resourceServer.buildUIToolMeta(photonName, uiId);
  }

  /**
   * Format error for AI consumption
   * Provides structured, actionable error messages
   */
  private formatError(error: any, toolName: string, args: any): any {
    const { text, errorType, retryable } = formatToolError(toolName, error);

    // Add dev-mode extras
    let devExtras = '';
    if (this.options.devMode && Object.keys(args || {}).length > 0) {
      devExtras += `\nParameters provided:\n${JSON.stringify(args, null, 2)}\n`;
    }
    if (this.options.devMode && error.stack) {
      devExtras += `\nStack trace:\n${error.stack}\n`;
    }

    // Log to stderr for debugging
    this.log('error', `[Photon Error] ${toolName}: ${getErrorMessage(error)}`);
    if (this.options.devMode && error.stack) {
      this.log('debug', error.stack);
    }

    // Emit structured error metadata in addition to the human-readable text
    // so MCP clients can make typed retry decisions without parsing prose.
    // `_meta.photon` is the non-standard extension namespace; `structuredContent`
    // is the MCP-spec field for machine-readable result data.
    const structured = {
      error: {
        type: errorType,
        retryable,
        message: getErrorMessage(error),
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: text + devExtras,
        },
      ],
      isError: true,
      structuredContent: structured,
      _meta: { photon: structured.error },
    };
  }

  /**
   * Build placeholder tools from unresolved photon manifest metadata
   */
  private buildPlaceholderTools(): any[] {
    const unresolved = this.options.unresolvedPhoton;
    if (!unresolved) return [];

    // Collect tool names from all source metadata
    const toolNames = new Set<string>();
    for (const source of unresolved.sources) {
      if (source.metadata?.tools) {
        for (const tool of source.metadata.tools) {
          toolNames.add(tool);
        }
      }
    }

    // If no tools in metadata, create a single setup tool
    if (toolNames.size === 0) {
      return [
        {
          name: 'setup',
          description: `Set up ${unresolved.name} — call this tool to begin.`,
          inputSchema: { type: 'object', properties: {} },
        },
      ];
    }

    return Array.from(toolNames).map((name) => ({
      name,
      description: `Requires setup — call to begin.`,
      inputSchema: { type: 'object', properties: {} },
    }));
  }

  /**
   * Resolve an unresolved photon (deferred conflict resolution)
   *
   * If the client supports elicitation, presents marketplace choices.
   * Otherwise, auto-picks the recommendation.
   */
  private async resolveUnresolvedPhoton(): Promise<void> {
    const unresolved = this.options.unresolvedPhoton;
    if (!unresolved) return;

    let selectedSource: { marketplace: Marketplace; metadata?: PhotonMetadata };

    if (unresolved.sources.length === 1) {
      selectedSource = unresolved.sources[0];
    } else if (this.capabilityNegotiator.supportsElicitation(this.server)) {
      // Present choices via elicitation
      const sourceLabels: Array<{ const: string; title: string }> = [];
      for (const source of unresolved.sources) {
        const version = source.metadata?.version || 'unknown';
        const label = `${source.marketplace.name} (v${version})`;
        sourceLabels.push({ const: source.marketplace.name, title: label });
      }

      const result = await this.server.elicitInput({
        message: `Multiple sources found for "${unresolved.name}". Which marketplace should be used?`,
        requestedSchema: {
          type: 'object' as const,
          properties: {
            marketplace: {
              type: 'string',
              title: 'Marketplace',
              oneOf: sourceLabels,
              default: unresolved.recommendation || unresolved.sources[0].marketplace.name,
            },
          },
          required: ['marketplace'],
        },
      });

      const chosen =
        result.action === 'accept' && result.content
          ? (result.content as Record<string, string>).marketplace
          : unresolved.recommendation;

      selectedSource =
        unresolved.sources.find((s) => s.marketplace.name === chosen) || unresolved.sources[0];
    } else {
      // No elicitation — auto-pick recommendation
      const rec = unresolved.recommendation;
      selectedSource = rec
        ? unresolved.sources.find((s) => s.marketplace.name === rec) || unresolved.sources[0]
        : unresolved.sources[0];
      this.log('info', `Auto-selected marketplace: ${selectedSource.marketplace.name}`);
    }

    // Download and install photon
    await this.downloadAndLoadPhoton(unresolved.name, unresolved.workingDir, selectedSource);
  }

  /**
   * Download a photon from a marketplace source, save to workingDir, and load it
   */
  private async downloadAndLoadPhoton(
    photonName: string,
    workingDir: string,
    source: { marketplace: Marketplace; metadata?: PhotonMetadata }
  ): Promise<void> {
    const { MarketplaceManager } = await import('./marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const result = await manager.fetchMCP(photonName);
    if (!result) {
      throw new Error(`Failed to download photon: ${photonName}`);
    }

    const { photonPath: filePath } = await manager.installPhoton(result, photonName, workingDir);

    // Update options and load
    this.options.filePath = filePath;
    this.options.unresolvedPhoton = undefined;

    this.log('info', `Downloaded and loading ${photonName}...`);
    this.mcp = await this.loader.loadFile(filePath);

    // Notify clients that tools have changed
    await this.notifyListsChanged();
  }

  /**
   * Attempt config elicitation to resolve missing env vars, then retry tool call
   */
  private async attemptConfigElicitation(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    try {
      // Extract constructor params to build form
      const params = await this.loader.extractConstructorParams(this.options.filePath);
      if (params.length === 0) return null;

      const photonName = this.mcp?.name || 'photon';
      const { toEnvVarName } = await import('./shared/config-docs.js');

      // Build form properties from constructor params
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const param of params) {
        const envVarName = toEnvVarName(photonName, param.name);
        const existing = process.env[envVarName];

        // Skip params that already have values
        if (existing) continue;
        // Skip optional params with defaults
        if (param.hasDefault || param.isOptional) continue;

        properties[envVarName] = {
          type:
            param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string',
          title: param.name,
          description: `Environment variable: ${envVarName}`,
        };
        required.push(envVarName);
      }

      if (Object.keys(properties).length === 0) return null;

      const result = await this.server.elicitInput({
        message: `${photonName} requires configuration. Please provide the following:`,
        requestedSchema: {
          type: 'object' as const,
          properties,
          required,
        },
      });

      if (result.action !== 'accept' || !result.content) return null;

      // Set env vars from elicitation response
      const content = result.content as Record<string, string>;
      for (const [key, value] of Object.entries(content)) {
        if (value !== undefined && value !== '') {
          process.env[key] = String(value);
        }
      }

      // Reload photon with new env vars
      this.log('info', 'Reloading photon with elicited configuration...');
      this.mcp = await this.loader.loadFile(this.options.filePath);
      await this.notifyListsChanged();

      // Retry the original tool call
      const inputProvider = this.createMCPInputProvider();
      const samplingProvider = this.createMCPSamplingProvider();
      const outputHandler = (emit: any) => {
        this.channelManager.publishIfChannel(emit);
      };

      const retryResult = await this.loader.executeTool(this.mcp, toolName, args, {
        inputProvider,
        outputHandler,
        samplingProvider,
      });

      const isStateful =
        retryResult && typeof retryResult === 'object' && retryResult._stateful === true;
      const actualResult = isStateful ? retryResult.result : retryResult;

      return {
        content: [{ type: 'text', text: this.formatResult(actualResult) }],
      };
    } catch (error) {
      this.log('warn', `Config elicitation failed: ${getErrorMessage(error)}`);
      return null; // elicitation unsupported by client
    }
  }

  /**
   * Initialize and start the server
   */
  async start() {
    // Safety net: catch unhandled errors so a bad photon can't crash the server
    process.on('uncaughtException', (err) => {
      this.log('error', 'Uncaught exception in PhotonServer', {
        error: getErrorMessage(err),
        stack: err?.stack,
      });
    });
    process.on('unhandledRejection', (reason) => {
      this.log('error', 'Unhandled rejection in PhotonServer', {
        error: reason instanceof Error ? getErrorMessage(reason) : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });

    try {
      // If unresolvedPhoton is set, skip loading — defer to first tool call
      if (this.options.unresolvedPhoton) {
        this.log(
          'info',
          `Deferred loading for ${this.options.unresolvedPhoton.name} (${this.options.unresolvedPhoton.sources.length} marketplace sources)`
        );
      } else {
        // Initialize MCP client factory for enabling this.mcp() in Photons
        // This allows Photons to call external MCPs via protocol
        try {
          this.mcpClientFactory = await createSDKMCPClientFactory(this.options.devMode);
          const servers = await this.mcpClientFactory.listServers();
          if (servers.length > 0) {
            this.log('info', `MCP access enabled: ${servers.join(', ')}`);
            this.loader.setMCPClientFactory(this.mcpClientFactory);
          }
        } catch (error) {
          this.log('warn', `Failed to load MCP config: ${getErrorMessage(error)}`);
        }

        // Check if photon is stateful (requires daemon)
        const extractor = new PhotonDocExtractor(
          this.options.filePath,
          this.options.embeddedSource
        );
        const metadata = await extractor.extractFullMetadata();
        const isStateful = metadata.stateful;

        // Start daemon for stateful photons (enables cross-client communication)
        // Channel mode also uses the daemon — the singleton instance holds the
        // bot connection, and multiple MCP clients subscribe to its events
        if (isStateful) {
          const photonName = metadata.name;
          this.daemonName = photonName; // Store for subscription
          this.channelManager.setDaemonName(photonName);
          this.log('info', `Stateful photon detected: ${photonName}`);

          this.log('info', `Ensuring daemon for ${photonName}...`);
          await ensureDaemon(true);

          // Wait for daemon to be ready. This also covers stale pid/socket recovery.
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (await pingDaemon(photonName)) {
              this.log('info', `Daemon ready for ${photonName}`);
              break;
            }
          }
        }

        // Load the Photon MCP file
        if (this.options.preloadedModule) {
          // Wire preloaded @photon dependencies before loading
          if (this.options.preloadedDependencies) {
            this.loader.preloadedDependencies = this.options.preloadedDependencies;
          }
          this.log('info', `Loading preloaded module for ${this.options.filePath}...`);
          this.mcp = await this.loader.loadFromModule(
            this.options.preloadedModule,
            this.options.filePath,
            this.options.embeddedSource || ''
          );
        } else {
          this.log('info', `Loading ${this.options.filePath}...`);
          this.mcp = await this.loader.loadFile(this.options.filePath);
        }
      }

      // Track C closure: detect whether the loaded photon needs
      // per-caller state isolation. Only `@stateful` + `@auth` photons
      // do — everything else stays single-instance. The daemon path
      // and the Cloudflare outer-Worker have their own routing; this
      // flag drives the standalone HTTP server's per-claim pool.
      const photonAuth = this.mcp?.auth;
      const photonStateful = !!this.mcp?.stateful;
      this.requiresInstanceRouting = Boolean(photonAuth && photonStateful);
      if (this.requiresInstanceRouting) {
        this.log('info', `Per-claim instance routing enabled (auth=${JSON.stringify(photonAuth)})`);
      }

      // Subscribe to daemon channels for cross-process notifications.
      // In channel mode, ChannelManager intercepts 'channel-push' events
      // and translates them to notifications/claude/channel for the connected client.
      await this.channelManager.subscribeToChannels();

      // Start with the appropriate transport
      const transport = this.options.transport || 'stdio';

      if (transport === 'sse') {
        await this.startSSE();
      } else {
        await this.startStdio();
      }

      // In dev mode, we could set up file watching here
      if (this.options.devMode) {
        this.log('info', 'Dev mode enabled - hot reload active');
      }
    } catch (error) {
      this.log('error', `Failed to start server: ${getErrorMessage(error)}`);
      if (error instanceof Error && error.stack) {
        this.log('debug', error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Start server with stdio transport
   */
  private async startStdio() {
    const transport = new StdioServerTransport();

    // Wrap transport.send with a write mutex to prevent concurrent generators
    // from interleaving JSON-RPC messages on stdout
    const originalSend = transport.send.bind(transport);
    let writeChain = Promise.resolve();
    transport.send = (message: any) => {
      const p = writeChain
        .then(() => originalSend(message))
        .catch((err) => this.logger.debug('STDIO send failed', { error: getErrorMessage(err) }));
      writeChain = p;
      return p;
    };

    this.capabilityNegotiator.interceptTransportForRawCapabilities(
      transport,
      this.server,
      (msg: any) => this.channelManager.interceptPermissionRequest(msg)
    );
    await this.server.connect(transport);
    this.log('info', `Server started: ${this.mcp!.name}`);
  }

  /**
   * Start server with SSE transport (HTTP)
   */
  private async startSSE() {
    const port = this.options.port || 3000;
    const ssePath = '/mcp';
    const messagesPath = '/mcp/messages';

    // Always use Streamable HTTP transport for SSE mode.
    // The legacy SSE transport (endpoint event + /mcp/messages?sessionId=) is deprecated
    // in the MCP spec and not supported by modern clients (e.g. llama.cpp).
    // Streamable HTTP uses the standard protocol:
    //   POST /mcp  — JSON-RPC request → JSON response
    //   GET  /mcp  — SSE stream for server-to-client notifications
    let beamTransport: BeamCompatTransport | null = null;
    {
      const photonName = this.mcp?.name || 'photon';
      beamTransport = new BeamCompatTransport(photonName, {
        description: this.mcp?.description,
        icon: this.mcp?.icon,
        stateful: !!this.mcp?.stateful,
        hasSettings: !!this.mcp?.hasSettings,
      });
      this.capabilityNegotiator.interceptTransportForRawCapabilities(
        beamTransport,
        this.server,
        (msg: any) => this.channelManager.interceptPermissionRequest(msg)
      );
      await this.server.connect(beamTransport);

      // Wire sub-photons: collect all loaded photons except the main one
      const mainName = this.mcp?.name || 'photon';
      const allLoaded = this.loader.getLoadedPhotons();
      for (const [, loaded] of allLoaded) {
        if (loaded.name === mainName) continue;
        const icon = (loaded as PhotonClassWithMeta).icon || '⚡';
        const stateful = !!(loaded as PhotonClassWithMeta).stateful;
        // ^^ getLoadedPhotons() returns the canonical PhotonClassExtended type;
        // these two callsites still need the narrower runtime cast until
        // the loader's return type widens to PhotonClassWithMeta.
        const hasSettings = !!loaded.settingsSchema?.hasSettings;
        // Convert PhotonTool[] to MCP tool format with UI linking
        const uiAssets = loaded.assets?.ui || [];
        const tools = (loaded.tools as Array<ExtractedSchema & { internal?: boolean }>)
          .filter((t) => !t.internal)
          .map((t) => {
            const linkedUI = uiAssets.find(
              (u) => u.linkedTool === t.name || u.linkedTools?.includes(t.name)
            );
            return {
              name: t.name,
              description: t.description || '',
              inputSchema: t.inputSchema,
              ...(linkedUI ? { linkedUi: linkedUI.id } : {}),
            };
          });
        beamTransport.subPhotons.push({
          name: loaded.name,
          description: loaded.description || `${loaded.name} MCP`,
          icon,
          stateful,
          hasSettings,
          tools,
        });
      }

      // Wire sub-photon tool executor — returns MCP-formatted result
      beamTransport.subPhotonExecutor = async (photonName: string, method: string, args: any) => {
        for (const [, loaded] of allLoaded) {
          if (loaded.name === photonName) {
            const result = await this.loader.executeTool(loaded, method, args);
            // Wrap raw result in MCP content format if not already wrapped
            if (result && result.content && Array.isArray(result.content)) {
              return result;
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }
        }
        throw new Error(`Photon not found: ${photonName}`);
      };
    }

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        // Security: set standard security headers on all responses
        setSecurityHeaders(res);
        if (!req.url) {
          res.writeHead(400).end('Missing URL');
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const corsOrigin = getCorsOrigin(req);

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          const preflightHeaders: Record<string, string> = {
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, X-Photon-Request',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
          };
          if (corsOrigin) preflightHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(204, preflightHeaders);
          res.end();
          return;
        }

        // Streamable HTTP transport for Beam frontend (compiled binaries)
        if (beamTransport && url.pathname === ssePath) {
          await beamTransport.handleHTTP(req, res, url);
          return;
        }

        // Legacy SSE transport (when not using Streamable HTTP)
        if (!beamTransport && req.method === 'GET' && url.pathname === ssePath) {
          await this.handleSSEConnection(req, res, messagesPath);
          return;
        }
        if (!beamTransport && req.method === 'POST' && url.pathname === messagesPath) {
          await this.handleSSEMessage(req, res, url);
          return;
        }

        // Serve embedded index.html at root when assets are available
        if (req.method === 'GET' && url.pathname === '/' && this.options.embeddedAssets) {
          const htmlHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
          if (corsOrigin) htmlHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(200, htmlHeaders);
          res.end(this.options.embeddedAssets.indexHtml);
          return;
        }

        // Health check / info endpoint
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const endpoints: Record<string, string> = {
            sse: `http://localhost:${port}${ssePath}`,
            messages: `http://localhost:${port}${messagesPath}`,
          };
          if (this.devMode) {
            endpoints.playground = `http://localhost:${port}/playground`;
          }
          res.end(
            JSON.stringify({
              name: this.mcp?.name || 'photon-mcp',
              transport: 'sse',
              endpoints,
              tools: this.mcp?.tools.length || 0,
              assets: this.mcp?.assets
                ? {
                    ui: this.mcp.assets.ui.length,
                    prompts: this.mcp.assets.prompts.length,
                    resources: this.mcp.assets.resources.length,
                  }
                : null,
            })
          );
          return;
        }

        // Playground and API endpoints - only in dev mode
        if (this.devMode) {
          if (req.method === 'GET' && url.pathname === '/playground') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(await this.getPlaygroundHTML(port));
            return;
          }

          // API: List all photons
          if (req.method === 'GET' && url.pathname === '/api/photons') {
            const photonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (corsOrigin) photonHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, photonHeaders);
            try {
              const photons = await this.listAllPhotons();
              res.end(JSON.stringify({ photons }));
            } catch (error) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: getErrorMessage(error) }));
            }
            return;
          }

          // API: List tools (for compatibility, now returns current photon)
          if (req.method === 'GET' && url.pathname === '/api/tools') {
            const toolHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (corsOrigin) toolHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, toolHeaders);
            const tools =
              this.mcp?.tools.map((tool) => {
                const linkedUI = this.mcp?.assets?.ui.find(
                  (u) => u.linkedTool === tool.name || u.linkedTools?.includes(tool.name)
                );
                return {
                  name: tool.name,
                  description: tool.description,
                  inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)),
                  ui: linkedUI
                    ? { id: linkedUI.id, uri: `ui://${this.mcp!.name}/${linkedUI.id}` }
                    : null,
                };
              }) || [];
            // Resolve @choice-from fields
            for (const tool of tools) {
              await this.resolveChoiceFromFields(tool);
            }
            res.end(JSON.stringify({ tools }));
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/status') {
            const statusHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (corsOrigin) statusHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, statusHeaders);
            res.end(JSON.stringify(this.buildStatusSnapshot()));
            return;
          }

          if (req.method === 'GET' && url.pathname === '/api/status-stream') {
            this.handleStatusStream(req, res);
            return;
          }
        }

        // API: Call tool
        if (req.method === 'POST' && url.pathname === '/api/call') {
          // Security: restrict CORS to localhost and require local request
          if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
          res.setHeader('Content-Type', 'application/json');

          if (!isLocalRequest(req)) {
            res.writeHead(403);
            res.end(JSON.stringify({ success: false, error: 'Forbidden: non-local request' }));
            return;
          }

          if (!this.mcp) {
            res.writeHead(503);
            res.end(JSON.stringify({ success: false, error: 'Photon not loaded' }));
            return;
          }

          try {
            const body = await readBody(req);
            const { tool, args } = JSON.parse(body);
            const result = await this.loader.executeTool(this.mcp, tool, args || {});
            const isStateful = result && typeof result === 'object' && result._stateful === true;
            res.writeHead(200);
            res.end(
              JSON.stringify({
                success: true,
                data: isStateful ? result.result : result,
              })
            );
          } catch (error: any) {
            const status = error.message?.includes('too large') ? 413 : 500;
            res.writeHead(status);
            res.end(JSON.stringify({ success: false, error: getErrorMessage(error) }));
          }
          return;
        }

        // API: Call tool with streaming progress (SSE)
        if (req.method === 'POST' && url.pathname === '/api/call-stream') {
          if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          if (!this.mcp) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Photon not loaded' }));
            return;
          }

          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            void (async () => {
              let requestId = `run_${Date.now()}`;

              const sendMessage = (message: Record<string, any>) => {
                res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
              };

              try {
                const payload = JSON.parse(body || '{}');
                const tool = payload.tool;
                if (!tool) {
                  throw new Error('Tool name is required');
                }
                const args = payload.args || {};
                const progressToken = payload.progressToken ?? `progress_${Date.now()}`;
                requestId = payload.requestId || requestId;

                const sendNotification = (method: string, params: Record<string, any>) => {
                  sendMessage({ jsonrpc: '2.0', method, params });
                };

                const reportProgress = (emit: any) => {
                  const rawValue = typeof emit?.value === 'number' ? emit.value : 0;
                  const percent = rawValue <= 1 ? rawValue * 100 : rawValue;
                  sendNotification('notifications/progress', {
                    progressToken,
                    progress: percent,
                    total: 100,
                    message: emit?.message || null,
                  });
                };

                const outputHandler = (emit: any) => {
                  if (!emit) return;
                  if (emit.emit === 'progress') {
                    reportProgress(emit);
                  } else if (emit.emit === 'status') {
                    sendNotification('notifications/status', {
                      type: emit.type || 'info',
                      message: emit.message || '',
                    });
                  } else if (emit.emit === 'render') {
                    sendNotification('notifications/render', {
                      format: emit.format,
                      value: emit.value,
                    });
                  } else if (emit.emit === 'render:clear') {
                    sendNotification('notifications/render', { clear: true });
                  } else {
                    sendNotification('notifications/emit', { event: emit });
                  }
                  // Forward channel events to daemon for cross-process pub/sub
                  this.channelManager.publishIfChannel(emit);
                };

                sendNotification('notifications/status', {
                  type: 'info',
                  message: `Starting ${tool}`,
                });

                const result = await this.loader.executeTool(this.mcp!, tool, args, {
                  outputHandler,
                });
                const isStateful =
                  result && typeof result === 'object' && result._stateful === true;

                sendMessage({
                  jsonrpc: '2.0',
                  id: requestId,
                  result: {
                    success: true,
                    data: isStateful ? result.result : result,
                  },
                });
                res.end();
              } catch (error) {
                const message = getErrorMessage(error);
                const errorPayload: Record<string, any> = {
                  jsonrpc: '2.0',
                  error: { code: -32000, message },
                };
                if (requestId) {
                  errorPayload.id = requestId;
                }
                sendMessage(errorPayload);
                res.end();
              }
            })();
          });
          return;
        }

        // API: Get UI template (and directory-style siblings for SPA bundles).
        //
        // Two shapes:
        //   GET /api/ui/<id>           → the @ui-declared file itself
        //   GET /api/ui/<id>/<rest>    → sibling under the @ui file's directory
        //
        // Sibling resolution lets a `@ui dashboard ./dashboard/dist/index.html`
        // also serve `dashboard/dist/chunks/main.js` (which the index.html
        // references as `./chunks/main.js`) without per-file @ui declarations.
        // Path-traversal is rejected by resolving the candidate and confirming
        // it stays under the @ui's directory root.
        // `.*` (not `.+`) so a trailing-slash form like `/api/ui/dashboard/`
        // matches with restPath='' and routes to the top-level branch
        // alongside the no-slash form. Without the trailing-slash match,
        // the redirect target below would 404.
        const uiMatch =
          req.method === 'GET' && url.pathname.match(/^\/api\/ui\/([^/]+)(?:\/(.*))?$/);
        if (uiMatch) {
          const uiId = uiMatch[1];
          const restPath = uiMatch[2] ?? '';
          const ui = this.mcp?.assets?.ui.find((u) => u.id === uiId);
          const photonName = this.mcp?.name || '';

          // Top-level fetch (no sub-path): existing single-file behaviour.
          if (!restPath) {
            // Browsers resolve relative asset URLs against the document
            // URL. With `/api/ui/<id>` (no trailing slash) the base is
            // `/api/ui/`, so `./chunks/main.js` becomes `/api/ui/chunks/...`
            // which would 404 on the sibling resolver below. Redirect to
            // the trailing-slash form so the SPA's relative imports work.
            // The regex matches both `/api/ui/<id>` and `/api/ui/<id>/`
            // to the same restPath='', so we branch on the literal path.
            if (ui?.resolvedPath && !url.pathname.endsWith('/')) {
              const redirectHeaders: Record<string, string> = {
                Location: url.pathname + '/' + (url.search || ''),
              };
              if (corsOrigin) redirectHeaders['Access-Control-Allow-Origin'] = corsOrigin;
              res.writeHead(308, redirectHeaders);
              res.end();
              return;
            }
            if (ui?.resolvedPath) {
              try {
                const content = await readText(ui.resolvedPath);
                const uiHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
                if (corsOrigin) uiHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                // Track D2: cross-origin isolation for standalone tabs so
                // SharedArrayBuffer / WebGPU / persistent OPFS / Service
                // Workers light up. Iframe embeds keep working because
                // detectIsolationMode returns 'embedded' on Sec-Fetch-Dest:
                // iframe (and the manual ?embed=1 escape hatch).
                if (detectIsolationMode(req) === 'standalone') {
                  uiHeaders['Cross-Origin-Opener-Policy'] = 'same-origin';
                  uiHeaders['Cross-Origin-Embedder-Policy'] = 'require-corp';
                }
                res.writeHead(200, uiHeaders);
                res.end(content);
                return;
              } catch {
                // Fall through to 404
              }
            }
            res.writeHead(404).end('UI not found');
            return;
          }

          // Sub-path: directory-style sibling resolution. Try the filesystem
          // first (dev mode), then the embedded asset tree (compiled binary).
          if (ui?.resolvedPath) {
            const path = await import('path');
            const fs = await import('fs/promises');
            const baseDir = path.dirname(ui.resolvedPath);
            const candidate = path.resolve(baseDir, restPath);
            const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
            if (!candidate.startsWith(baseWithSep)) {
              res.writeHead(403).end('Forbidden');
              return;
            }
            try {
              const content = await fs.readFile(candidate);
              const ext = path.extname(candidate).toLowerCase();
              const mime = uiSiblingMime(ext);
              const sibHeaders: Record<string, string> = { 'Content-Type': mime };
              if (corsOrigin) sibHeaders['Access-Control-Allow-Origin'] = corsOrigin;
              // Track D2: CORP same-origin so a standalone parent page with
              // COEP `require-corp` can fetch its own SPA chunks.
              sibHeaders['Cross-Origin-Resource-Policy'] = 'same-origin';
              res.writeHead(200, sibHeaders);
              res.end(content);
              return;
            } catch {
              // Fall through to embedded tree / 404
            }
          }

          if (ui && this.options.embeddedAssetTree && photonName) {
            const tree = this.options.embeddedAssetTree[photonName];
            if (tree) {
              // The @ui declaration is relative to <photon>/assets/. Strip the
              // declared filename to get the sibling base, then append rest.
              const declared = ui.path.replace(/^\.\//, '');
              const lastSlash = declared.lastIndexOf('/');
              const baseRel = lastSlash >= 0 ? declared.slice(0, lastSlash + 1) : '';
              const cleanRest = restPath.replace(/^\/+/, '');
              if (cleanRest.includes('..')) {
                res.writeHead(403).end('Forbidden');
                return;
              }
              const siblingKey = baseRel + cleanRest;
              const content = tree[siblingKey];
              if (typeof content === 'string') {
                const path = await import('path');
                const ext = path.extname(siblingKey).toLowerCase();
                const treeHeaders: Record<string, string> = {
                  'Content-Type': uiSiblingMime(ext),
                };
                if (corsOrigin) treeHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                // Track D2: CORP same-origin so embedded-binary servers stay
                // satisfiable for COEP-isolated parent pages.
                treeHeaders['Cross-Origin-Resource-Policy'] = 'same-origin';
                // Binary siblings (.png, .woff2, .wasm) ship as base64 in
                // the embedded tree to survive round-trip through the
                // bundled JS. Decode back to a Buffer so the bytes hit
                // the wire unchanged; text entries keep the UTF-8 path.
                const { decodeEmbeddedAsset } = await import('./shared/asset-encoding.js');
                const decoded = decodeEmbeddedAsset(content);
                res.writeHead(200, treeHeaders);
                res.end(decoded.buffer ?? decoded.text);
                return;
              }
            }
          }

          res.writeHead(404).end('UI sibling not found');
          return;
        }

        // Serve embedded frontend assets (compiled binaries with --with-app)
        if (this.options.embeddedAssets) {
          const assets = this.options.embeddedAssets;

          // Minimal /api/diagnostics for service worker health check
          if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
            const { PHOTON_VERSION } = await import('./version.js');
            const photonName = this.mcp?.name || 'photon';
            const tools = this.mcp ? Object.keys(this.mcp._toolSchemas || {}).length : 0;
            const diagHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (corsOrigin) diagHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, diagHeaders);
            res.end(
              JSON.stringify({
                photonVersion: PHOTON_VERSION,
                workingDir: process.cwd(),
                photons: [
                  {
                    name: photonName,
                    status: 'loaded',
                    methods: tools,
                  },
                ],
              })
            );
            return;
          }

          // Platform Bridge API: generate bridge script for @ui HTML templates
          if (req.method === 'GET' && url.pathname === '/api/platform-bridge') {
            const theme = (url.searchParams.get('theme') || 'dark') as 'light' | 'dark';
            const photonName = url.searchParams.get('photon') || this.mcp?.name || 'photon';
            const methodName = url.searchParams.get('method') || '';
            const { generateBridgeScript } = await import('./auto-ui/bridge/index.js');
            const script = generateBridgeScript({
              theme,
              locale: 'en-US',
              photon: photonName,
              method: methodName,
              hostName: 'beam',
              hostVersion: '1.5.0',
              injectedPhotons: [],
            });
            const bridgeHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
            if (corsOrigin) bridgeHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, bridgeHeaders);
            res.end(script);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/index.html') {
            const indexHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
            if (corsOrigin) indexHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, indexHeaders);
            res.end(assets.indexHtml);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/beam.bundle.js') {
            const jsHeaders: Record<string, string> = { 'Content-Type': 'text/javascript' };
            if (corsOrigin) jsHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, jsHeaders);
            res.end(assets.bundleJs);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/sw.js') {
            const swHeaders: Record<string, string> = { 'Content-Type': 'text/javascript' };
            if (corsOrigin) swHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, swHeaders);
            res.end('self.addEventListener("fetch", () => {});');
            return;
          }

          if (req.method === 'GET' && url.pathname.startsWith('/app/')) {
            const appName = url.pathname.replace('/app/', '').replace(/\/$/, '') || 'photon';
            const appHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${appName}</title>
<link rel="manifest" href="/manifest.json">
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif}</style>
</head><body>
<script>window.PHOTON_APP_NAME="${appName}";window.PHOTON_SSE_URL=window.location.origin;</script>
<script src="/beam.bundle.js"></script>
</body></html>`;
            const appHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
            if (corsOrigin) appHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, appHeaders);
            res.end(appHtml);
            return;
          }
        }

        // SPA fallback: serve index.html for unmatched GET requests (compiled binary with Beam UI)
        if (req.method === 'GET' && this.options.embeddedAssets) {
          const fallbackHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
          if (corsOrigin) fallbackHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(200, fallbackHeaders);
          res.end(this.options.embeddedAssets.indexHtml);
          return;
        }

        // @get / @post HTTP routes — dispatch to photon method, public (no auth).
        // Track C: when none match, fall through to the auto-RPC table built
        // from @expose tags below.
        const httpRoutes = this.mcp?._httpRoutes;
        let matchedRoute: {
          handler: string;
          format?: string;
          expose?: 'private' | 'public';
        } | null = null;
        if (httpRoutes?.length && req.method) {
          const route = httpRoutes.find((r) => r.method === req.method && r.path === url.pathname);
          if (route) matchedRoute = { handler: route.handler, format: route.format };
        }

        // Track C: auto-RPC. POST /api/<kebab-method> dispatches to @expose'd
        // methods. Explicit @get/@post takes precedence (matchedRoute already
        // set above) so a user can override path/verb for any @expose'd
        // method without surrendering the auto-RPC slot for the rest. The
        // visibility check below decides whether to allow the call.
        const exposes = this.mcp?._exposes;
        if (
          !matchedRoute &&
          exposes?.length &&
          req.method === 'POST' &&
          url.pathname.startsWith('/api/')
        ) {
          const { methodToKebab } = await import('./shared/expose-route-extractor.js');
          const segment = url.pathname.slice('/api/'.length);
          // Reject calls that try to reach reserved endpoints ('call', 'ui',
          // 'diagnostics', etc.) by checking against the @expose table only —
          // a user method named `call` would still bind correctly here.
          const exposed = exposes.find((e) => methodToKebab(e.handler) === segment);
          if (exposed) {
            // Visibility gate. `private` requires Sec-Fetch-Site: same-origin
            // (browser-set, can't be forged from a cross-origin caller) so a
            // SameSite-style guard works without per-photon session cookies.
            // `public` skips the check entirely.
            if (exposed.visibility === 'private') {
              const sfs = req.headers['sec-fetch-site'];
              if (typeof sfs === 'string') {
                // Browser-set header — honour it verbatim. Same-origin and
                // same-site count as SameSite-equivalent; anything else
                // ('cross-site', 'none', etc.) is rejected even on
                // localhost so a malicious page from another origin can't
                // exploit a dev tool's loopback access.
                const value = sfs.toLowerCase();
                const ok = value === 'same-origin' || value === 'same-site';
                if (!ok) {
                  res.writeHead(403).end('Forbidden: cross-site @expose call');
                  return;
                }
              } else if (!isLocalRequest(req)) {
                // Non-browser callers (curl, node fetch) often omit the
                // header. Allow them only on the loopback interface so a
                // public deploy still requires browser-asserted same-origin.
                res.writeHead(403).end('Forbidden: missing same-origin signal');
                return;
              }
            }
            matchedRoute = { handler: exposed.handler, expose: exposed.visibility };
          }
        }

        if (matchedRoute) {
          // Track C closure (extended): @get/@post and @expose dispatchers
          // share the same per-claim instance pool that `handleCallTool`
          // uses, so `@stateful` + `@auth` photons isolate state across
          // callers regardless of which HTTP surface invokes the method.
          // Without this, a `@stateful` + `@auth` photon's `@expose private`
          // method (the natural multi-tenant SPA shape) would leak state
          // across users — Alice's POST /api/<kebab> would see Bob's
          // tasks even though their tools/call paths stay isolated.
          const { extractClaimsFromHeaders } = await import('./shared/extract-claims.js');
          const httpClaims = extractClaimsFromHeaders(req.headers);
          const targetMcp = await this.resolveInstanceMcp(
            httpClaims ? { authInfo: { extra: httpClaims } } : undefined
          );
          const photonInstance = targetMcp?.instance;
          const fn = photonInstance?.[matchedRoute.handler];
          if (typeof fn === 'function') {
            try {
              // Collect body for POST routes
              let bodyBuffer = Buffer.alloc(0);
              await new Promise<void>((resolve) => {
                req.on('data', (chunk: Buffer) => {
                  bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
                });
                req.on('end', resolve);
              });
              // Build Web-standard Request
              const webReq = new Request(url.toString(), {
                method: req.method,
                headers: req.headers as Record<string, string>,
                ...(req.method !== 'GET' && bodyBuffer.length > 0 ? { body: bodyBuffer } : {}),
              });
              // @expose dispatches receive the parsed JSON body as the first
              // arg so handlers share the MCP `addTask({title})`-style
              // signature; @get/@post handlers keep the Request directly so
              // they can read headers / streams. Empty body → empty object.
              let result: unknown;
              if (matchedRoute.expose && req.method !== 'GET') {
                let parsed: unknown = {};
                if (bodyBuffer.length > 0) {
                  try {
                    parsed = JSON.parse(bodyBuffer.toString('utf-8'));
                  } catch {
                    res.writeHead(400).end('Invalid JSON body');
                    return;
                  }
                }
                result = await fn.call(photonInstance, parsed);
              } else {
                result = await fn.call(photonInstance, webReq);
              }

              // Pass-through: if the handler already returned a Response, do
              // NOT touch its bytes. This is the v1.28 contract and is
              // locked by tests/v128-byte-compat.test.ts.
              if (result instanceof Response) {
                const responseHeaders: Record<string, string> = {};
                result.headers.forEach((value, key) => {
                  responseHeaders[key] = value;
                });
                if (corsOrigin) responseHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                res.writeHead(result.status, responseHeaders);
                res.end(Buffer.from(await result.arrayBuffer()));
                return;
              }

              // Track A: handler returned a plain value. Negotiate Accept
              // against the registry, taking the @format JSDoc declaration
              // into account, and write the rendered body.
              const { negotiateAccept } = await import('./format/registry.js');
              const { getDefaultRegistry } = await import('./format/seed.js');
              const acceptHeader = req.headers['accept'];
              const rendered = negotiateAccept({
                accept: typeof acceptHeader === 'string' ? acceptHeader : undefined,
                declaredFormat: matchedRoute.format,
                value: result,
                registry: getDefaultRegistry(),
              });
              const negotiatedHeaders: Record<string, string> = {
                'Content-Type': rendered.mime,
              };
              if (corsOrigin) negotiatedHeaders['Access-Control-Allow-Origin'] = corsOrigin;
              res.writeHead(200, negotiatedHeaders);
              res.end(
                typeof rendered.body === 'string' ? rendered.body : Buffer.from(rendered.body)
              );
            } catch (err: any) {
              res.writeHead(500).end(err?.message ?? 'Internal Server Error');
            }
            return;
          }
        }

        res.writeHead(404).end('Not Found');
      })();
    });

    this.httpServer.on('clientError', (err: Error, socket) => {
      this.log('warn', 'HTTP client error', { message: err.message });
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, () => {
        process.stdout.write(`⚡ ${this.mcp!.name} → http://localhost:${port}${ssePath}\n`);
        resolve();
      });
    });
  }

  /**
   * List all photons in the .photon directory
   */
  private async listAllPhotons() {
    const { listPhotonFiles } = await import('./path-resolver.js');
    const { getDefaultContext } = await import('./context.js');
    const photonFiles = await listPhotonFiles();

    const photons = await Promise.all(
      photonFiles.map(async (file) => {
        try {
          const loader = new PhotonLoader(
            this.devMode,
            this.logger.child({ component: 'photon-loader', scope: 'discovery' })
          );
          const mcp = await loader.loadFile(file);
          return {
            name: mcp.name,
            description: mcp.description,
            file: file.replace(getDefaultContext().baseDir + '/', ''),
            tools: mcp.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          };
        } catch (error) {
          this.log('warn', `Failed to load photon: ${file}`, { error: getErrorMessage(error) });
          return null; // skip unloadable photon
        }
      })
    );

    return photons.filter((p) => p !== null);
  }

  /**
   * Generate playground HTML for interactive testing
   */
  private async getPlaygroundHTML(port: number): Promise<string> {
    const name = this.mcp?.name || 'photon-mcp';
    return generatePlaygroundHTML({ name, port });
  }

  /**
   * Handle new SSE connection
   */
  private async handleSSEConnection(
    req: IncomingMessage,
    res: ServerResponse,
    messagesPath: string
  ) {
    const origin = getCorsOrigin(req);
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

    // Create a new MCP server instance for this session
    const sessionServer = new Server(
      {
        name: this.mcp?.name || 'photon-mcp',
        version: PHOTON_VERSION,
      },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
          logging: {},
          experimental: {
            sampling: {}, // Support elicitation via MCP sampling protocol
          },
        },
      }
    );

    // Per-session sink for `notifications/resources/updated`. Identity is
    // stable across this session so SubscriptionRegistry can index by it and
    // the disconnect handler can purge subscriptions in one call.
    const sessionSink: ResourceUpdateSink = (uri: string) =>
      sessionServer.notification({
        method: 'notifications/resources/updated',
        params: { uri },
      });

    // Copy handlers to the session server
    this.setupSessionHandlers(sessionServer, sessionSink);

    // Create SSE transport
    const transport = new SSEServerTransport(messagesPath, res);
    this.capabilityNegotiator.interceptTransportForRawCapabilities(
      transport,
      sessionServer,
      (msg: any) => this.channelManager.interceptPermissionRequest(msg)
    );
    const sessionId = transport.sessionId;

    // Store session
    this.sseSessions.set(sessionId, { server: sessionServer, transport });

    // Clean up on close (guard against recursive close:
    // onclose → sessionServer.close() → transport.close() → onclose)
    let closing = false;
    transport.onclose = () => {
      if (closing) return;
      closing = true;
      this.sseSessions.delete(sessionId);
      this.subscriptions.disconnect(sessionSink);
      this.log('info', 'SSE client disconnected', { sessionId });
      void (async () => {
        try {
          await sessionServer.close();
        } catch {
          // Ignore errors during cleanup (transport already closed)
        }
      })();
    };

    transport.onerror = (error) => {
      this.log('warn', 'SSE transport error', {
        sessionId,
        error: error instanceof Error ? getErrorMessage(error) : String(error),
      });
    };

    try {
      await sessionServer.connect(transport);
      this.log('info', 'SSE client connected', { sessionId });
    } catch (error) {
      this.sseSessions.delete(sessionId);
      this.log('error', 'Failed to establish SSE connection', {
        sessionId,
        error: getErrorMessage(error) ?? String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500).end('Failed to establish SSE connection');
      }
    }
  }

  /**
   * Handle incoming SSE message
   */
  private async handleSSEMessage(req: IncomingMessage, res: ServerResponse, url: URL) {
    const origin = getCorsOrigin(req);
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      res.writeHead(400).end('Missing sessionId query parameter');
      return;
    }

    const session = this.sseSessions.get(sessionId);

    if (!session) {
      res.writeHead(404).end('Unknown session');
      return;
    }

    try {
      await session.transport.handlePostMessage(req, res);
    } catch (error) {
      this.log('error', 'Failed to process SSE message', {
        sessionId,
        error: getErrorMessage(error) ?? String(error),
      });
      if (!res.headersSent) {
        res.writeHead(500).end('Failed to process message');
      }
    }
  }

  /**
   * Set up handlers for a session-specific MCP server
   * This duplicates handlers from the main server to each session
   */
  private setupSessionHandlers(sessionServer: Server, sessionSink?: ResourceUpdateSink) {
    this.logClientCapabilities(sessionServer);

    const sseSessionKey = `sse-${this.daemonName}`;
    const ctx: HandlerContext = {
      server: sessionServer,
      getInstanceName: () => this.sseInstanceNames.get(sseSessionKey),
      setInstanceName: (name) => {
        this.sseInstanceNames.set(sseSessionKey, name);
      },
      sessionId: sseSessionKey,
    };

    sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return this.handleListTools(ctx);
    });

    sessionServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        return await this.handleCallTool(ctx, request, extra);
      } catch (error) {
        const { name: toolName, arguments: args } = request.params;
        return this.formatError(error, toolName, args);
      }
    });

    sessionServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.handleListPrompts();
    });

    sessionServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return this.handleGetPrompt(request);
    });

    sessionServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.resourceServer.handleListResources(this.mcp);
    });

    sessionServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.resourceServer.handleListResourceTemplates(this.mcp);
    });

    sessionServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.resourceServer.handleReadResource(request, this.mcp);
    });

    if (sessionSink) {
      sessionServer.setRequestHandler(SubscribeRequestSchema, async (request) => {
        this.subscriptions.subscribe(sessionSink, request.params.uri);
        return {};
      });
      sessionServer.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
        this.subscriptions.unsubscribe(sessionSink, request.params.uri);
        return {};
      });
    }

    this.setupRootsForServer(sessionServer);
  }

  /**
   * Stop the server
   */
  async stop() {
    try {
      // Call lifecycle hook if present — always pass { reason } so the
      // photon can distinguish full shutdown from hot-reload teardown.
      if (this.mcp?.instance?.onShutdown) {
        await this.mcp.instance.onShutdown({ reason: 'shutdown' });
      }

      // Disconnect MCP clients
      if (this.mcpClientFactory) {
        await this.mcpClientFactory.disconnect();
      }

      // Unsubscribe daemon channels
      this.channelManager.cleanup();

      // Close SSE sessions — snapshot to avoid live-iterator + await issues
      for (const session of Array.from(this.sseSessions.values())) {
        await session.server.close();
      }
      this.sseSessions.clear();

      for (const client of this.statusClients) {
        client.end();
      }
      this.statusClients.clear();

      // Close HTTP server if running — destroy lingering connections so .close() resolves
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          const server = this.httpServer!;
          // Destroy all active connections so close() doesn't wait for keep-alive drain
          server.closeAllConnections?.();
          server.close(() => resolve());
        });
        this.httpServer = null;
      }

      await this.server.close();
      this.log('info', 'Server stopped');
    } catch (error) {
      this.log('error', 'Error stopping server', { error: getErrorMessage(error) });
    }
  }

  private buildStatusSnapshot() {
    const warnings: string[] = [];
    const instance = this.mcp?.instance;
    if (instance && '_photonConfigError' in instance && instance._photonConfigError) {
      warnings.push('Photon configuration incomplete. Check env vars and MCP credentials.');
    }

    const assets = this.mcp?.assets || { ui: [], prompts: [], resources: [] };
    const tools = this.mcp?.tools || [];

    return {
      photon: this.mcp?.name || null,
      devMode: this.devMode,
      hotReloadDisabled: this.hotReloadDisabled,
      lastReloadError: this.lastReloadError || null,
      status: this.currentStatus,
      warnings,
      summary: {
        toolCount: tools.length,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          hasUI: Boolean(assets.ui?.some((ui) => ui.linkedTool === tool.name)),
        })),
        uiAssets: (assets.ui || []).map((ui) => ({ id: ui.id, linkedTool: ui.linkedTool })),
        promptCount: assets.prompts?.length || 0,
        resourceCount: assets.resources?.length || 0,
      },
    };
  }

  private handleStatusStream(_req: IncomingMessage, res: ServerResponse) {
    const ssHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };
    const origin = getCorsOrigin(_req);
    if (origin) ssHeaders['Access-Control-Allow-Origin'] = origin;
    res.writeHead(200, ssHeaders);

    res.write(`data: ${JSON.stringify(this.buildStatusSnapshot())}\n\n`);
    this.statusClients.add(res);

    const cleanup = () => {
      this.statusClients.delete(res);
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  private async broadcastReloadStatus(type: 'info' | 'warn' | 'error', message: string) {
    this.currentStatus = { type, message, timestamp: Date.now() };
    this.pushStatusUpdate();

    const payload = {
      method: 'notifications/status',
      params: { type, message },
    };

    try {
      await this.server.notification(payload);
    } catch (e) {
      this.log('debug', 'Notification send failed', { error: getErrorMessage(e) });
    }

    // Snapshot to avoid live-iterator + await issues
    for (const session of Array.from(this.sseSessions.values())) {
      try {
        await session.server.notification(payload);
      } catch (e) {
        this.log('debug', 'Session notification failed', { error: getErrorMessage(e) });
      }
    }
  }

  private pushStatusUpdate() {
    const frame = `data: ${JSON.stringify(this.currentStatus)}\n\n`;
    for (const client of this.statusClients) {
      client.write(frame);
    }
  }

  /**
   * Reload the MCP file (for dev mode hot reload)
   */
  private reloadFailureCount = 0;
  private readonly MAX_RELOAD_FAILURES = 3;
  private reloadRetryTimeout?: NodeJS.Timeout;

  async reload() {
    // Clear any pending retry
    if (this.reloadRetryTimeout) {
      clearTimeout(this.reloadRetryTimeout);
      this.reloadRetryTimeout = undefined;
    }

    if (this.hotReloadDisabled) {
      throw new HotReloadDisabledError(
        'Hot reload temporarily disabled after repeated failures. Restart Photon or fix the errors to re-enable.'
      );
    }

    try {
      this.log('info', 'Reloading Photon');

      // Store old instance in case we need to rollback
      const oldInstance = this.mcp;

      // Call shutdown hook on old instance with hot-reload context so the
      // photon can skip destructive cleanup of resources the new instance
      // will reuse (sockets, timers, DB connections, etc.).
      if (oldInstance?.instance?.onShutdown) {
        try {
          await oldInstance.instance.onShutdown({ reason: 'hot-reload' });
        } catch (shutdownError: any) {
          this.log('warn', 'Shutdown hook failed during reload', { error: shutdownError.message });
          // Continue with reload anyway
        }
      }

      // Reload the file without running onInitialize — we'll invoke it
      // manually below with hot-reload context and an oldInstance reference
      // so the new instance can transfer non-copyable resources.
      const newMcp = await this.loader.reloadFile(this.options.filePath, {
        skipInitialize: true,
      });

      // Auto-transfer in-memory state (non-function own properties) from
      // old to new. Covers maps, arrays, flags, caches without requiring
      // the photon author to manually copy fields in onInitialize. Photons
      // only need custom handling for non-copyable resources (sockets,
      // timers, DB connections) via the oldInstance context below.
      //
      // Known tradeoff: hot reload preserves runtime state at the cost of
      // not applying field-initializer source changes on the fly. Changes
      // like `count = 0` → `count = 10`, or `items = ['seed']` → `items = []`
      // will not take effect until the next full daemon restart. We pick this
      // side because the mainstream reason to hot reload is to keep
      // accumulated data alive while iterating on method bodies; any
      // heuristic that tries to distinguish "intentional reset" from
      // "unchanged initializer I haven't touched" drops state or drops
      // edits depending on which direction it leans. Developers who change
      // field initializer defaults should restart the daemon.
      if (oldInstance?.instance && newMcp?.instance && typeof oldInstance.instance === 'object') {
        const newRec = newMcp.instance as Record<string, unknown>;
        const oldRec = oldInstance.instance as Record<string, unknown>;
        for (const key of Object.keys(oldRec)) {
          if (key === 'constructor') continue;
          const value = oldRec[key];
          if (typeof value === 'function') continue;
          try {
            newRec[key] = value;
          } catch {
            // Some properties may be read-only (e.g. settings proxy)
          }
        }
      }

      // Invoke onInitialize on the new instance with hot-reload context so
      // the photon can re-subscribe to non-copyable resources using the
      // provided oldInstance reference.
      if (newMcp?.instance && typeof newMcp.instance.onInitialize === 'function') {
        try {
          await newMcp.instance.onInitialize({
            reason: 'hot-reload',
            oldInstance: oldInstance?.instance,
          });
        } catch (initError: any) {
          // Bubble through so the outer catch flags PhotonInitializationError.
          throw initError;
        }
      }

      // Success! Update instance and reset failure count
      this.mcp = newMcp;
      this.reloadFailureCount = 0;
      this.hotReloadDisabled = false;
      this.lastReloadError = undefined;

      // Send list_changed notifications to inform client of updates
      await this.notifyListsChanged();

      await this.broadcastReloadStatus('info', 'Hot reload complete');

      this.log('info', 'Reload complete');
    } catch (error) {
      this.reloadFailureCount++;

      this.log('error', 'Reload failed', {
        attempt: this.reloadFailureCount,
        maxAttempts: this.MAX_RELOAD_FAILURES,
        error: getErrorMessage(error),
      });

      if (error instanceof Error && error.name === 'PhotonInitializationError') {
        this.log('warn', 'onInitialize lifecycle hook failed', {
          hints: [
            'Database connection failure',
            'API authentication error',
            'Missing environment variables',
            'Invalid configuration',
          ],
        });
      }

      this.lastReloadError = {
        message: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        attempts: this.reloadFailureCount,
      };
      await this.broadcastReloadStatus('error', `Hot reload failed: ${getErrorMessage(error)}`);

      if (this.reloadFailureCount >= this.MAX_RELOAD_FAILURES) {
        this.log('error', 'Maximum reload failures reached', {
          maxAttempts: this.MAX_RELOAD_FAILURES,
          action: 'keeping previous version active',
        });
        this.log('info', 'Server still running with previous version');

        this.hotReloadDisabled = true;
        this.reloadFailureCount = 0;
        throw new HotReloadDisabledError(
          'Hot reload disabled after repeated failures. Restart Photon dev server once the errors are resolved.'
        );
      }

      const retryDelay = Math.min(5000 * this.reloadFailureCount, 15000);
      this.log('warn', 'Reload failed - waiting for next change', {
        retrySeconds: retryDelay / 1000,
      });
      this.log('info', 'Server still running with previous version');

      throw error;
    }
  }

  /**
   * Send list_changed notifications to inform client that tools/prompts/resources changed
   * Used after hot reload to tell clients (like Claude Desktop) to refresh
   */
  private async notifyListsChanged() {
    try {
      // Send tools list changed notification
      await this.server.notification({
        method: 'notifications/tools/list_changed',
      });

      // Send prompts list changed notification
      await this.server.notification({
        method: 'notifications/prompts/list_changed',
      });

      // Send resources list changed notification
      await this.server.notification({
        method: 'notifications/resources/list_changed',
      });

      this.log('debug', 'Sent list_changed notifications');
    } catch (error) {
      // Notification sending is best-effort - don't fail reload if it fails
      this.log('warn', 'Failed to send list_changed notifications', {
        error: getErrorMessage(error),
      });
    }
  }
}
