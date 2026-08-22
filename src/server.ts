/**
 * Photon MCP Server
 *
 * Wraps a .photon.ts file as an MCP server using @modelcontextprotocol/sdk
 * Supports both stdio and SSE transports
 */

import {
  Server,
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  StdioServerTransport,
  serveStdio,
  type AuthInfo,
  type McpHttpHandler,
  type Transport,
} from './mcp/sdk-v2-2026/server.js';
import { SSEServerTransport } from './mcp/sdk-v1-2025/server.js';
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
  type ServerNotification,
} from './mcp/sdk-v2-2026/types.js';
import { readText } from './shared/io.js';
import { cleanMcpToolDescription } from './shared/mcp-tool-metadata.js';
import { detectIsolationMode } from './shared/cross-origin-headers.js';
import { resolvePhotonStylesheetAssets } from './auto-ui/stylesheet-assets.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { WebSocket as NodeWebSocket, WebSocketServer } from 'ws';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import { PhotonLoader } from './loader.js';
import { PhotonClassExtended } from '@portel/photon-core';
import type { ExtractedSchema, PhotonClass } from '@portel/photon-core';
import type { Marketplace, PhotonMetadata } from './marketplace-manager.js';
import { createSDKMCPClientFactory, type SDKMCPClientFactory } from '@portel/photon-core';
import { PHOTON_VERSION } from './version.js';
import { createLogger, Logger, LoggerOptions, LogLevel } from './shared/logger.js';
import { getErrorMessage, sanitizePublicErrorMessage } from './shared/error-handler.js';
import {
  validateOrThrow,
  assertString,
  notEmpty,
  inRange,
  oneOf,
  hasExtension,
} from './shared/validation.js';
import { generatePlaygroundHTML } from './auto-ui/playground-html.js';
import { PHOTON_RENDER_META_KEY, buildPhotonRenderMeta } from './auto-ui/types.js';
import { pingDaemon } from './daemon/client.js';
import { ensureDaemon } from './daemon/manager.js';
import {
  ChannelManager,
  type ChannelNotificationSink,
  type ChannelPermissionResponse,
} from './channel-manager.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { isLocalRequest, setSecurityHeaders, getCorsOrigin } from './shared/security.js';
import { TaskExecutor } from './task-executor.js';
import { validateAppContext, type PhotonAppContext } from './app-context.js';
import { extractSkillDeclarations, readSkillWithin } from './skills.js';
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
  MCPImageContent,
  MCPToolResponse,
  ServerCapabilitiesWithWeb,
} from './types/server-types.js';
import { verifyPhotonAuthToken } from './auth/mcp-jwt.js';
import type { PhotonOAuthRuntime } from './auth/runtime-oauth.js';
import { loadPhotonAuth } from './cli/commands/auth.js';
import {
  installLocalWebSocketPair,
  type LocalWebSocketEndpoint,
} from './shared/local-websocket-pair.js';
import { validateStructuredOutput, type FiniteJSONValue } from './mcp/protocol/json-schema.js';
import { buildMCPToolError, PHOTON_TOOL_ERROR_CODES } from './mcp/protocol/tool-errors.js';
import {
  browserInvocableMethodNames,
  extractApplicationManifest,
  type ApplicationManifest,
  type ApplicationManifestMethod,
} from './auto-ui/app-manifest.js';
import { generateStandaloneWebShell } from './auto-ui/standalone-web/app-shell.js';
import { generateRenderersScript } from './auto-ui/bridge/renderers.js';

installLocalWebSocketPair();

let cachedJwtProfile: {
  name: string;
  issuer: string;
  jwks: { keys: JsonWebKey[] };
} | null = null;

async function loadJwtProfile(
  name: string
): Promise<{ issuer: string; jwks: { keys: JsonWebKey[] } } | null> {
  if (cachedJwtProfile && cachedJwtProfile.name === name) {
    return { issuer: cachedJwtProfile.issuer, jwks: cachedJwtProfile.jwks };
  }
  try {
    const loaded = await loadPhotonAuth(name);
    cachedJwtProfile = { name, issuer: loaded.issuer.issuer, jwks: loaded.jwks };
    return { issuer: loaded.issuer.issuer, jwks: loaded.jwks };
  } catch {
    return null;
  }
}

export class HotReloadDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotReloadDisabledError';
  }
}

async function writeFetchResponseToNode(
  response: Response,
  res: ServerResponse,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  Object.assign(responseHeaders, extraHeaders);
  res.writeHead(response.status, responseHeaders);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let closed = false;
  const cancelReader = () => {
    closed = true;
    reader.cancel().catch(() => undefined);
  };
  res.on('close', cancelReader);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      if (value) res.write(Buffer.from(value));
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (err) {
    if (!closed && !res.destroyed) {
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    res.off('close', cancelReader);
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

type ServerHttpRouteDef = {
  method: string;
  path: string;
  handler: string;
  format?: string;
};

type ServerUiAssetDef = {
  id: string;
  path?: string;
  resolvedPath?: string;
};

function splitServerRoutePath(pathname: string): string[] {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  if (normalized === '/') return [];
  return normalized.split('/').filter(Boolean);
}

function serverWebRouteMatches(routePath: string, requestPath: string): boolean {
  if (routePath === requestPath) return true;
  const routeParts = splitServerRoutePath(routePath);
  const requestParts = splitServerRoutePath(requestPath);
  if (routeParts.length !== requestParts.length) return false;
  for (let i = 0; i < routeParts.length; i++) {
    const routePart = routeParts[i];
    const requestPart = requestParts[i];
    if (routePart.startsWith(':')) {
      if (!requestPart) return false;
      continue;
    }
    if (routePart !== requestPart) return false;
  }
  return true;
}

function serverWebRouteScore(routePath: string): number {
  return splitServerRoutePath(routePath).reduce(
    (score, part) => score + (part.startsWith(':') ? 1 : 10),
    routePath === '/' ? 100 : 0
  );
}

function findServerWebRoute(
  routes: ServerHttpRouteDef[] | undefined,
  method: string | undefined,
  requestPath: string
): ServerHttpRouteDef | undefined {
  if (!routes?.length || !method) return undefined;
  const wantedMethod = method.toUpperCase();
  return routes
    .filter(
      (route) =>
        route.method.toUpperCase() === wantedMethod &&
        serverWebRouteMatches(route.path, requestPath)
    )
    .sort((a, b) => serverWebRouteScore(b.path) - serverWebRouteScore(a.path))[0];
}

function uiAssetPath(asset: ServerUiAssetDef): string {
  return asset.resolvedPath || asset.path || '';
}

function isTsxUiAsset(asset: ServerUiAssetDef): boolean {
  return uiAssetPath(asset).endsWith('.tsx');
}

function selectServerClientAppUi(
  photon:
    | {
        configured?: boolean;
        appEntry?: { linkedUi?: string };
        assets?: { ui?: ServerUiAssetDef[] };
      }
    | null
    | undefined
): string | undefined {
  const uiAssets = photon?.assets?.ui || [];
  const linkedUi = photon?.appEntry?.linkedUi;
  if (linkedUi) {
    const linkedAsset = uiAssets.find((ui) => ui.id === linkedUi);
    if (!linkedAsset || isTsxUiAsset(linkedAsset)) return linkedUi;
  }

  const namedApp = uiAssets.find((ui) => ui.id === 'app' && isTsxUiAsset(ui));
  if (namedApp) return namedApp.id;

  const tsxAssets = uiAssets.filter(isTsxUiAsset);
  if (tsxAssets.length === 1) return tsxAssets[0].id;

  return undefined;
}

function selectServerWebAppUrl(
  photon:
    | ({
        name?: string;
        _httpRoutes?: ServerHttpRouteDef[];
        appManifest?: ApplicationManifest;
      } & Parameters<typeof selectServerClientAppUi>[0])
    | null
    | undefined
): string | undefined {
  if (!photon?.name) return undefined;
  const hasWebRoot = photon._httpRoutes?.some(
    (route) => route.method === 'GET' && route.path === '/'
  );
  const hasExplicitUi = (photon.assets?.ui?.length || 0) > 0;
  if (!hasWebRoot && !selectServerClientAppUi(photon) && !(photon.appManifest && !hasExplicitUi)) {
    return undefined;
  }
  return `/web/${photon.name}/`;
}

function shouldFallbackToServerClientApp(
  pathname: string,
  searchParams: URLSearchParams,
  route: unknown
): boolean {
  if (route) return false;
  if (searchParams.get('legacy') === '1') return false;
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return false;
  return true;
}

function findFreePort(preferred: number = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(preferred, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferred;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
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

function localMcpAuthMode(): string {
  return process.env.PHOTON_MCP_AUTH_MODE || (process.env.PHOTON_MCP_BEARER ? 'bearer' : 'legacy');
}

/**
 * Expose named object parameters as the object's fields on the MCP wire.
 * Schema extraction can leave a single named object parameter as
 * `{ params: {...} }`; that is an implementation detail, not a useful MCP
 * contract, and it must match the Cloudflare code-generation path.
 */
function normalizeMcpInputSchema(inputSchema: Record<string, any>): Record<string, any> {
  const properties = inputSchema?.properties;
  if (
    !properties ||
    typeof properties !== 'object' ||
    Object.keys(properties).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(properties, 'params')
  ) {
    return inputSchema;
  }
  const nested = properties.params;
  if (
    !nested ||
    nested.type !== 'object' ||
    !nested.properties ||
    typeof nested.properties !== 'object'
  ) {
    return inputSchema;
  }
  return {
    type: 'object',
    properties: nested.properties,
    ...(Array.isArray(nested.required) ? { required: nested.required } : {}),
    ...(nested.additionalProperties !== undefined
      ? { additionalProperties: nested.additionalProperties }
      : {}),
    ...(nested.description ? { description: nested.description } : {}),
  };
}

/**
 * Return claims from either the legacy SDK callback metadata or the official
 * v2 ServerContext. v2 deliberately moves HTTP authentication under
 * `context.http.authInfo`; this seam keeps Photon authorization independent of
 * the protocol-era callback shape.
 */
type HandlerAuthContext = {
  authInfo?: { extra?: Record<string, unknown> };
  http?: { authInfo?: { extra?: Record<string, unknown> } };
};

function authClaimsFromHandlerContext(
  context: HandlerAuthContext | undefined
): Record<string, unknown> | undefined {
  return context?.authInfo?.extra ?? context?.http?.authInfo?.extra;
}

function authHeaderToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  const match = Array.isArray(header)
    ? header.length === 1
      ? header[0]?.match(/^Bearer[ \t]+([^\s,]+)$/i)
      : null
    : header.match(/^Bearer[ \t]+([^\s,]+)$/i);
  return match ? match[1] : null;
}

function callerFromVerifiedClaims(claims?: Record<string, unknown>) {
  if (!claims || typeof claims.sub !== 'string') return undefined;
  const scope = typeof claims.scope === 'string' ? claims.scope : undefined;
  return {
    id: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    anonymous: false,
    role: typeof claims.role === 'string' ? claims.role : undefined,
    scope,
    scopes: scope ? scope.split(/\s+/).filter(Boolean) : [],
    claims,
  };
}

function localMcpWwwAuthenticate(
  req: IncomingMessage,
  error: 'invalid_token' | 'insufficient_scope',
  scopes: string[] = [],
  audience = process.env.PHOTON_MCP_JWT_AUDIENCE
): string {
  let resourceMetadata = process.env.PHOTON_MCP_RESOURCE_METADATA_URL;
  if (!resourceMetadata) {
    const publicResource =
      audience ??
      (process.env.PHOTON_PUBLIC_URL
        ? `${process.env.PHOTON_PUBLIC_URL.replace(/\/+$/, '')}/mcp`
        : undefined);
    if (publicResource) {
      try {
        resourceMetadata = new URL(
          '/.well-known/oauth-protected-resource',
          publicResource
        ).toString();
      } catch {
        resourceMetadata = undefined;
      }
    }
  }
  if (!resourceMetadata) {
    const port = req.socket.localPort ? `:${req.socket.localPort}` : '';
    resourceMetadata = `http://127.0.0.1${port}/.well-known/oauth-protected-resource`;
  }
  return [
    'Bearer realm="photon"',
    `resource_metadata="${resourceMetadata.replace(/["\\]/g, '')}"`,
    `error="${error}"`,
    ...(scopes.length ? [`scope="${scopes.join(' ')}"`] : []),
  ].join(', ');
}

function mcpTokenMatches(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

/**
 * A transport decorator used only to observe the raw stdio initialize
 * message. The v2 `serveStdio` entry intentionally owns `onmessage`, so the
 * old mutation-based interceptor cannot see the message anymore. This proxy
 * preserves the official transport lifecycle while retaining Photon's
 * capability metadata compatibility for clients that put MCP Apps under the
 * untyped `extensions` field.
 */
class CapabilityCaptureTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private messageHandler?: (message: any, extra?: any) => void;

  constructor(
    private readonly inner: Transport,
    private readonly onMessage: (message: any) => void
  ) {
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => this.onerror?.(error);
  }

  get onmessage(): ((message: any, extra?: any) => void) | undefined {
    return this.messageHandler;
  }

  set onmessage(handler: ((message: any, extra?: any) => void) | undefined) {
    this.messageHandler = handler;
    this.inner.onmessage = (message: any, extra?: any) => {
      this.onMessage(message);
      handler?.(message, extra);
    };
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  send(message: any): Promise<void> {
    return this.inner.send(message);
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
  private oauthRuntime: PhotonOAuthRuntime | null = null;
  /** Official v2 web-standard handler. It owns HTTP negotiation and transports. */
  private mcpHttpHandler: McpHttpHandler | null = null;
  /** Official SDK v2 stateful transports for legacy HTTP clients. */
  private legacyHttpSessions = new Map<
    string,
    {
      server: Server;
      transport: WebStandardStreamableHTTPServerTransport;
    }
  >();
  /** Official v2 stdio serving handle. */
  private stdioHandle: ReturnType<typeof serveStdio> | null = null;
  private webSocketServer = new WebSocketServer({ noServer: true });
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

    // Progressive skill disclosure: descriptors are safe to include in the
    // initial server instructions; full bodies remain available through the
    // explicit photon_skill_read tool.
    if (!options.unresolvedPhoton && options.filePath) {
      try {
        const declarations = extractSkillDeclarations(readFileSync(options.filePath, 'utf8'));
        const descriptors = declarations.map((declaration) => {
          try {
            const skill = readSkillWithin(path.dirname(options.filePath), declaration.path);
            return `${skill.name}: ${skill.description || 'additional task guidance'}`;
          } catch {
            return `${declaration.name}: additional task guidance`;
          }
        });
        if (descriptors.length) {
          const skillInstructions = `Available Photon skills (read with photon_skill_read): ${descriptors.join('; ')}`;
          options.channelInstructions = options.channelInstructions
            ? `${options.channelInstructions}\n\n${skillInstructions}`
            : skillInstructions;
        }
      } catch {
        // Skill discovery is advisory; loading must remain unaffected.
      }
    }

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

    // Create the initial MCP server instance. The official v2 stdio/HTTP
    // serving entries may create additional per-era/per-request instances
    // through createMcpProtocolServer().
    this.server = this.createMcpProtocolServer();

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

  /**
   * Construct a protocol server with Photon's declared capabilities.
   *
   * This is deliberately limited to protocol metadata. The official SDK v2
   * serving entries own the transport, framing, and protocol-era negotiation;
   * Photon only registers its application handlers onto the server instance.
   */
  private createMcpProtocolServer(): Server {
    return new Server(
      {
        name: this.channelManager.getServerName(),
        version: PHOTON_VERSION,
      },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
          logging: {},
          // Tasks are retained as a Photon extension for legacy clients. The
          // SDK v2 negotiation layer simply omits methods unsupported by the
          // selected protocol era.
          tasks: {
            list: {},
            cancel: {},
            requests: { tools: { call: {} } },
          },
          ...this.channelManager.getExtraCapabilities(),
        },
        ...this.channelManager.getExtraServerOptions(),
      }
    );
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
  private queueNotification(notification: ServerNotification, server = this.server): void {
    this._notifyQueue = this._notifyQueue
      .then(() => server?.notification(notification))
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
        const selectOptions = ask.options || [];
        const options = selectOptions.map((o: any) => (typeof o === 'string' ? o : o.value));
        const labels = selectOptions.map((o: any) => (typeof o === 'string' ? o : o.label));
        const photonOptions = selectOptions
          .filter((o: any) => typeof o === 'object' && o !== null)
          .map((o: any) => ({
            value: o.value,
            ...(o.label ? { label: o.label } : {}),
            ...(o.description ? { description: o.description } : {}),
            ...(o.image ? { image: o.image } : {}),
            ...(o.price != null ? { price: o.price } : {}),
            ...(o.badge ? { badge: o.badge } : {}),
            ...(o.badgeType ? { badgeType: o.badgeType } : {}),
            ...(o.category ? { category: o.category } : {}),
          }));
        const photonOptionMetadata =
          photonOptions.length > 0 ? { 'x-photon-options': photonOptions } : {};
        return {
          mode: 'form',
          message: baseMessage + (ask.multi ? ' (select multiple)' : ''),
          requestedSchema: {
            type: 'object',
            properties: {
              selection: ask.multi
                ? {
                    type: 'array',
                    items: { type: 'string', enum: options, ...photonOptionMetadata },
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                  }
                : {
                    type: 'string',
                    enum: options,
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                    ...photonOptionMetadata,
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
  private appContexts = new Map<string, PhotonAppContext>();
  private skillCatalog?: string;

  private async getSkillCatalog(): Promise<string> {
    if (this.skillCatalog !== undefined) return this.skillCatalog;
    try {
      const source = await readText(this.options.filePath);
      const declarations = extractSkillDeclarations(source);
      const entries = declarations.map((declaration) => {
        try {
          const skill = readSkillWithin(path.dirname(this.options.filePath), declaration.path);
          return `${skill.name}: ${skill.description || 'additional task guidance'}`;
        } catch {
          return `${declaration.name}: additional task guidance`;
        }
      });
      this.skillCatalog = entries.length ? entries.join('; ') : '';
    } catch {
      this.skillCatalog = '';
    }
    return this.skillCatalog;
  }

  private readAppContextResource(request: any, ctx: HandlerContext): any {
    const uri = request.params?.uri;
    if (typeof uri !== 'string' || !/^photon:\/\/[^/]+\/context\/current$/.test(uri)) return null;
    const context = this.appContexts.get(ctx.sessionId || 'anonymous') || {};
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(context) }] };
  }
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

  private async handleListTools(
    ctx: HandlerContext,
    extra?: HandlerAuthContext
  ): Promise<{ tools: any[] }> {
    if (!this.mcp) {
      return { tools: [] };
    }
    const mcpName = this.mcp.name;
    const standaloneManifest = this.standaloneApplicationManifest();
    const photonWebUrl = selectServerWebAppUrl({
      ...this.mcp,
      appManifest: standaloneManifest,
    });
    const claims = authClaimsFromHandlerContext(extra);
    const caller = callerFromVerifiedClaims(claims);
    const tools = this.mcp.tools
      .filter((tool) => {
        const surfaces = (tool as ExtractedSchema & { surfaces?: string[] }).surfaces;
        return !surfaces || surfaces.includes('mcp');
      })
      .filter((tool) => this.loader.isToolAccessible(this.mcp!, tool.name, caller))
      .map((tool) => {
        // Append deprecation notice to tool description if tagged
        let description = cleanMcpToolDescription(tool.description);
        const deprecated = (tool as ExtractedSchema).deprecated;
        if (deprecated) {
          const notice = typeof deprecated === 'string' ? deprecated : 'This tool is deprecated.';
          description = `[DEPRECATED: ${notice}] ${description}`;
        }

        const slashlessName = tool.name.includes('/') ? tool.name.split('/').pop()! : tool.name;
        const toolName = slashlessName.includes('.')
          ? slashlessName.split('.').pop()!
          : slashlessName;

        const toolDef: MCPToolDefinition = {
          name: toolName,
          description,
          inputSchema: normalizeMcpInputSchema(JSON.parse(JSON.stringify(tool.inputSchema))),
        };
        // Photon catalog metadata is part of the public MCP surface. Keep it
        // on the official SDK path as well as the legacy Beam-compatible path
        // so hosts can label each tool with the Photon that owns it.
        toolDef['x-photon-id'] = mcpName;
        toolDef['x-photon-description'] = this.mcp?.description || '';
        toolDef['x-photon-icon'] = this.mcp?.icon || '⚡';
        toolDef['x-photon-stateful'] = !!this.mcp?.stateful;
        toolDef['x-photon-has-settings'] = !!this.mcp?.hasSettings;
        if (photonWebUrl) {
          toolDef['x-web-url'] = photonWebUrl;
          toolDef['x-web-description'] = this.mcp?.description || `${mcpName} MCP`;
        }

        // MCP standard annotations (2025-11-25 spec)
        const schema = tool as ExtractedSchema;
        const annotations: Record<string, unknown> = {};
        if (schema.title) annotations.title = schema.title;
        // Emit explicit boolean safety classifications. Some MCP clients
        // treat an omitted destructiveHint as destructive by default, which
        // makes a read-only tool appear unsafe in their approval UI.
        annotations.readOnlyHint = schema.readOnlyHint === true;
        annotations.destructiveHint = schema.destructiveHint === true;
        annotations.idempotentHint = schema.idempotentHint === true;
        if (schema.openWorldHint !== undefined) annotations.openWorldHint = schema.openWorldHint;
        if (Object.keys(annotations).length > 0) toolDef.annotations = annotations;

        // MCP structured output schema
        if (schema.outputSchema !== undefined) {
          toolDef.outputSchema = schema.outputSchema;
        }

        // MCP tool icons (resolve image paths to data URIs)
        if (tool.iconImages && tool.iconImages.length > 0) {
          const icons = this.resourceServer.resolveIconImages(tool.iconImages);
          if (icons.length > 0) toolDef.icons = icons;
        }

        const linkedUI = this.mcp?.assets?.ui.find(
          (u) => u.linkedTool === tool.name || u.linkedTools?.includes(tool.name)
        );
        if (schema.outputFormat) toolDef['x-output-format'] = schema.outputFormat;
        const formatMeta = schema as ExtractedSchema & {
          formatKind?: string;
          formatAlias?: string;
          mimeType?: string;
        };
        if (formatMeta.formatKind) toolDef['x-format-kind'] = formatMeta.formatKind;
        if (formatMeta.formatAlias) toolDef['x-format-alias'] = formatMeta.formatAlias;
        if (formatMeta.mimeType) toolDef['x-mime-type'] = formatMeta.mimeType;
        if (schema.layoutHints) toolDef['x-layout-hints'] = schema.layoutHints;
        const toolScopes = (schema as ExtractedSchema & { scopes?: string[] }).scopes;
        if (toolScopes) toolDef.scopes = toolScopes;
        const surfaces = (schema as ExtractedSchema & { surfaces?: string[] }).surfaces;
        if (surfaces?.length) toolDef['x-photon-surfaces'] = surfaces;
        if (schema.buttonLabel) toolDef['x-button-label'] = schema.buttonLabel;
        if (schema.icon) toolDef['x-icon'] = schema.icon;
        if (schema.autorun) toolDef['x-autorun'] = true;

        const renderMeta = buildPhotonRenderMeta(schema, {
          uiResourceUri: linkedUI ? `ui://${mcpName}/${linkedUI.id}` : undefined,
        });
        if (renderMeta) {
          toolDef._meta = { ...toolDef._meta, [PHOTON_RENDER_META_KEY]: renderMeta };
        }
        if (linkedUI && this.capabilityNegotiator.supportsUI(ctx.server)) {
          toolDef._meta = {
            ...toolDef._meta,
            ...this.resourceServer.buildUIToolMeta(this.mcp!.name, linkedUI.id),
          };
        }

        return toolDef;
      });

    const skillCatalog = await this.getSkillCatalog();
    tools.push(
      {
        name: 'photon_context_get',
        description: 'Read the current semantic Beam/application context for this session.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'photon_navigate',
        description: 'Request navigation to a registered Photon view in the current application.',
        inputSchema: {
          type: 'object',
          properties: {
            photon: { type: 'string' },
            method: { type: 'string' },
            instance: { type: 'string' },
            view: { type: 'string' },
          },
          required: ['photon'],
        },
      },
      {
        name: 'photon_skill_read',
        description: `Read a declared Photon SKILL.md by name when more guidance is needed.${skillCatalog ? ` Available skills: ${skillCatalog}` : ''}`,
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        annotations: { readOnlyHint: true },
      }
    );

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
   * (populated by the official SDK handler's auth context), look up
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
    extra: HandlerAuthContext | undefined
  ): Promise<PhotonClassExtended> {
    if (!this.requiresInstanceRouting || !this.mcp) return this.mcp!;
    const claims = authClaimsFromHandlerContext(extra);
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
    extra?: HandlerAuthContext
  ): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }
    const targetMcp = await this.resolveInstanceMcp(extra);

    const { name: toolName, arguments: args } = request.params;
    const claims = authClaimsFromHandlerContext(extra);
    const caller = callerFromVerifiedClaims(claims);
    if (!this.loader.isToolAccessible(targetMcp, toolName, caller)) {
      throw new Error(`Tool '${toolName}' is not available for this caller`);
    }
    const declaredTool = targetMcp.tools.find((tool) => tool.name === toolName);
    const declaredSurfaces = (
      declaredTool as (ExtractedSchema & { surfaces?: string[] }) | undefined
    )?.surfaces;
    if (declaredSurfaces && !declaredSurfaces.includes('mcp')) {
      throw new Error(`Tool '${toolName}' is not exposed on the MCP surface`);
    }
    // Per MCP spec, the server must echo the client-supplied progressToken
    // from request _meta back in notifications/progress so clients can match
    // streamed progress to their original request. Fall back to a synthetic
    // token only when the client didn't supply one.
    const clientProgressToken = (request.params as { _meta?: { progressToken?: string | number } })
      ?._meta?.progressToken;
    const progressToken = clientProgressToken ?? `progress_${toolName}`;

    const sessionKey = ctx.sessionId || 'anonymous';
    if (toolName === 'photon_context_get') {
      return {
        content: [{ type: 'text', text: JSON.stringify(this.appContexts.get(sessionKey) || {}) }],
      };
    }
    if (toolName === 'photon_navigate') {
      const context = validateAppContext({ navigation: args || {}, source: 'agent' });
      this.appContexts.set(sessionKey, context);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, context }) }] };
    }
    if (toolName === 'photon_skill_read') {
      const name = typeof args?.name === 'string' ? args.name : '';
      const source = await readText(this.options.filePath);
      const declaration = extractSkillDeclarations(source).find((skill) => skill.name === name);
      if (!declaration) throw new Error(`Unknown Photon skill: ${name}`);
      const skill = readSkillWithin(path.dirname(this.options.filePath), declaration.path);
      return { content: [{ type: 'text', text: skill.body }] };
    }

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
        const payload = emit.value ?? emit.data;
        this.queueNotification(
          {
            method: 'notifications/progress',
            params: {
              progressToken,
              progress,
              total: 100,
              ...(emit.message ? { message: emit.message } : {}),
              ...(payload !== undefined && typeof payload !== 'number' ? { data: payload } : {}),
            },
          } as ServerNotification,
          ctx.server
        );
      } else if (emit?.emit === 'status') {
        const payload = emit.value ?? emit.data;
        this.queueNotification(
          {
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: 0,
              total: 100,
              message: emit.message || '',
              ...(payload !== undefined ? { data: payload } : {}),
            },
          } as ServerNotification,
          ctx.server
        );
      } else if (emit?.emit === 'log') {
        this.queueNotification(
          {
            method: 'notifications/message',
            params: {
              level: emit.level || 'info',
              data: emit.message || '',
            },
          } as ServerNotification,
          ctx.server
        );
      } else if (emit?.emit === 'render') {
        this.queueNotification(
          {
            method: 'notifications/message',
            params: {
              level: 'info',
              data: JSON.stringify({
                _render: true,
                format: emit.format,
                value: emit.value,
              }),
            },
          } as ServerNotification,
          ctx.server
        );
      } else if (emit?.emit === 'render:clear') {
        this.queueNotification(
          {
            method: 'notifications/message',
            params: {
              level: 'info',
              data: JSON.stringify({ _render: true, clear: true }),
            },
          } as ServerNotification,
          ctx.server
        );
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
      caller,
      appContext: this.appContexts.get(ctx.sessionId || 'anonymous'),
    });
    const durationMs = Date.now() - startTime;
    const transport = this.options.transport || 'stdio';
    this.log('info', `${toolName} completed in ${durationMs}ms`, {
      durationMs,
      photon: this.mcp?.name,
      transport,
    });
    const isStateful = result && typeof result === 'object' && result._stateful === true;
    const actualResult = isStateful ? result.result : result;
    const schema = tool as ExtractedSchema;
    let validatedStructuredResult: FiniteJSONValue | undefined;
    if (schema?.outputSchema !== undefined) {
      const validation = await validateStructuredOutput(schema.outputSchema, actualResult);
      if (!validation.ok) {
        const failure = buildMCPToolError(toolName, validation.message, {
          code: PHOTON_TOOL_ERROR_CODES.OUTPUT_INVALID,
          category: 'tool_output',
          errorType: 'output_validation',
          retryable: false,
          publicMessage: 'Tool output validation failed',
          details: {
            validationKind: validation.kind,
            issueCount: validation.issues?.length ?? 0,
          },
        });
        failure._meta['photon/outputValidation'] = {
          kind: validation.kind,
          message: sanitizePublicErrorMessage(validation.message),
          ...(validation.issues
            ? {
                issues: validation.issues.map((issue) => ({
                  ...issue,
                  message: sanitizePublicErrorMessage(issue.message),
                })),
              }
            : {}),
        };
        return failure;
      }
      validatedStructuredResult = validation.value;
    }

    // _meta format transformation: if the result was transformed by _meta.format,
    // return the pre-formatted text with its MIME type directly
    if (actualResult && typeof actualResult === 'object' && actualResult._metaFormatted === true) {
      const content: any = { type: 'text', text: actualResult.text };
      if (actualResult.mimeType) {
        content.annotations = { mimeType: actualResult.mimeType };
      }
      return { content: [content], isError: false };
    }

    // MCP has a native image content type. Photons commonly return a data URI
    // because it is also directly consumable by browser UIs; promote image
    // data URIs at the protocol boundary so MCP clients do not have to parse
    // an image as ordinary text.
    // Build content with optional annotations
    const declaredMimeType = (schema as ExtractedSchema & { mimeType?: string }).mimeType;
    const formattedResult = this.formatResult(actualResult);
    const imageContent =
      this.imageContentFromResult(actualResult, declaredMimeType) ||
      this.imageContentFromResult(formattedResult, declaredMimeType);
    const content: MCPTextContent | MCPImageContent = imageContent || {
      type: 'text',
      text: formattedResult,
    };

    // Content annotations: audience and priority from schema, mimeType from format
    const contentAnnotations: Record<string, unknown> = {};
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
      schema?.outputSchema !== undefined &&
      validatedStructuredResult &&
      typeof validatedStructuredResult === 'object' &&
      !Array.isArray(validatedStructuredResult)
    ) {
      response.structuredContent = validatedStructuredResult;
    }

    const linkedUI = this.mcp?.assets?.ui.find(
      (u) => u.linkedTool === toolName || u.linkedTools?.includes(toolName)
    );
    const supportsLinkedUI = !!linkedUI && this.capabilityNegotiator.supportsUI(ctx.server);

    // Add x-output-format for legacy format-aware clients
    if (outputFormat) {
      response['x-output-format'] = outputFormat;
    }
    if (schema?.layoutHints) {
      response['x-layout-hints'] = schema.layoutHints;
    }

    const renderMeta = buildPhotonRenderMeta(schema, {
      uiResourceUri: supportsLinkedUI ? `ui://${this.mcp.name}/${linkedUI.id}` : undefined,
    });
    if (renderMeta) {
      response._meta = { ...response._meta, [PHOTON_RENDER_META_KEY]: renderMeta };
    }

    // Add stateful workflow metadata (machine-readable _meta)
    if (isStateful && result.runId) {
      response._meta = { ...response._meta, runId: result.runId, status: result.status };
    }

    // Enrich response with structuredContent + _meta for tools with linked UIs
    if (supportsLinkedUI) {
      if (
        schema?.outputSchema === undefined &&
        actualResult !== undefined &&
        actualResult !== null
      ) {
        response.structuredContent =
          typeof actualResult === 'string' ? { text: actualResult } : actualResult;
      }
      const uiMeta = this.resourceServer.buildUIToolMeta(this.mcp.name, linkedUI.id);
      response._meta = { ...response._meta, ...uiMeta };
    }

    // For SSE/Streamable-HTTP transports: flush the notification queue before
    // returning so that progress/status notifications are delivered via the GET
    // SSE stream BEFORE the HTTP POST response body is written. Without this, the
    // client receives the tool result, deletes its _progressHandlers entry, and then
    // silently drops any notifications that arrive later on the SSE stream.
    await this._notifyQueue;

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
   * Unified tools/call handling for every MCP transport.
   *
   * Both setupHandlers (STDIO) and setupSessionHandlers (SSE) delegate here
   * so @async fire-and-forget, task-mode dispatch, config elicitation retry,
   * and error formatting behave identically regardless of how the request
   * arrived. Session-specific routing (which server gets notifications,
   * which instance name applies) comes exclusively from ctx.
   */
  private async handleCallToolRequest(ctx: HandlerContext, request: any, extra: any): Promise<any> {
    // Deferred conflict resolution (set only by STDIO startup options)
    if (!this.mcp && this.options.unresolvedPhoton) {
      await this.resolveUnresolvedPhoton();
    }

    // @async fire-and-forget execution
    if (this.mcp) {
      const { name: toolName, arguments: args } = request.params;
      const tool = this.mcp.tools.find((t) => t.name === toolName);
      if ((tool as ExtractedSchema)?.isAsync) {
        // Generate a W3C-compatible OTel trace ID (32 hex chars = 128-bit)
        const traceId = crypto.randomBytes(16).toString('hex');
        const executionId = traceId;
        const inputProvider = this.createMCPInputProvider(ctx.server);
        const samplingProvider = this.createMCPSamplingProvider(ctx.server);
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
            const payload = emit.value ?? emit.data;
            void ctx.server.notification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress,
                total: 100,
                message: emit.message || '',
                ...(payload !== undefined &&
                (emit?.emit === 'status' || typeof payload !== 'number')
                  ? { data: payload }
                  : {}),
              },
            });
          } else if (emit?.emit === 'log') {
            void ctx.server.notification({
              method: 'notifications/message',
              params: {
                level: emit.level || 'info',
                data: emit.message || '',
              },
            });
          } else if (emit?.emit === 'render') {
            try {
              void ctx.server.notification({
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
              void ctx.server.notification({
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
      const response = await this.handleCallTool(ctx, request, extra);
      // Some Photon execution paths cross a JSON boundary before reaching the
      // MCP handler, turning Uint8Array into a numeric-key object or JSON text.
      // Recover that representation here so Beam still emits native MCP image
      // content instead of exposing implementation details to the client.
      const firstContent = response?.content?.[0];
      if (firstContent?.type === 'text' && typeof firstContent.text === 'string') {
        try {
          const parsed = JSON.parse(firstContent.text) as Record<string, unknown>;
          const entries = Object.entries(parsed);
          if (
            entries.length > 2 &&
            entries.every(([key, value]) => /^\d+$/.test(key) && Number.isInteger(value)) &&
            Number(parsed['0']) === 0x42 &&
            Number(parsed['1']) === 0x4d
          ) {
            const ordered = entries.sort(([a], [b]) => Number(a) - Number(b));
            const bytes = Uint8Array.from(ordered.map(([, value]) => Number(value)));
            return {
              ...response,
              content: [
                {
                  type: 'image',
                  data: Buffer.from(bytes).toString('base64'),
                  mimeType: 'image/bmp',
                },
              ],
            };
          }
        } catch {
          // Ordinary text results remain unchanged.
        }
      }
      return response;
    } catch (error) {
      const { name: toolName, arguments: args } = request.params;
      if (
        this.mcp?.instance?._photonConfigError &&
        this.capabilityNegotiator.supportsElicitation(ctx.server)
      ) {
        const retryResult = await this.attemptConfigElicitation(toolName, args || {}, ctx.server);
        if (retryResult) return retryResult;
      }

      this.log('error', 'Tool execution failed', {
        tool: toolName,
        error: sanitizePublicErrorMessage(error),
      });
      return this.formatError(error, toolName, args);
    }
  }

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

    this.setupHandlersForServer(this.server, ctx);
  }

  /**
   * Register Photon application handlers on an official SDK v2 Server.
   *
   * The same registration function is used by stdio, modern HTTP, and the
   * legacy HTTP fallback. Keeping this at the handler layer means Photon does
   * not need to know which transport or protocol era selected by the SDK is
   * carrying the request.
   */
  private setupHandlersForServer(
    server: Server,
    ctx: HandlerContext,
    resourceSink?: ResourceUpdateSink
  ) {
    server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
      if (!this.clientCapabilitiesLogged) {
        this.clientCapabilitiesLogged = true;
        this.logClientCapabilities(server);
      }

      // STDIO-only: deferred conflict resolution
      if (!this.mcp && this.options.unresolvedPhoton) {
        return { tools: this.buildPlaceholderTools() };
      }

      return this.handleListTools(ctx, extra);
    });

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      return this.handleCallToolRequest(ctx, request, extra);
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.handleListPrompts();
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
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

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const result = this.resourceServer.handleListResources(this.mcp);
      result.resources.push({
        uri: `photon://${this.mcp?.name || 'photon'}/context/current`,
        name: 'Current application context',
        description: 'Semantic navigation and selection context for this session',
        mimeType: 'application/json',
      });
      return result;
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.resourceServer.handleListResourceTemplates(this.mcp);
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const contextResource = this.readAppContextResource(request, ctx);
      if (contextResource) return contextResource;
      return this.resourceServer.handleReadResource(request, this.mcp);
    });

    // ── resources/subscribe + resources/unsubscribe (STDIO) ──
    // Sink is created lazily on first subscribe so we never register an idle
    // sink for clients that don't use the capability.
    const ensureStdioSink = (): ResourceUpdateSink => {
      if (!this.stdioSink) {
        this.stdioSink = (uri: string) =>
          server.notification({
            method: 'notifications/resources/updated',
            params: { uri },
          });
      }
      return this.stdioSink;
    };
    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const uri = request.params.uri;
      this.subscriptions.subscribe(resourceSink || ensureStdioSink(), uri);
      return {};
    });
    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const uri = request.params.uri;
      const sink = resourceSink || this.stdioSink;
      if (sink) {
        this.subscriptions.unsubscribe(sink, uri);
      }
      return {};
    });

    // ── MCP Tasks handlers (2025-11-25 spec) — delegated to TaskExecutor ──

    // Tasks are a legacy extension removed from the modern protocol era. Keep
    // Photon's existing task surface available to legacy clients while using
    // the v2 SDK's runtime negotiation for all other methods.
    const taskServer = server as any;
    taskServer.setRequestHandler(GetTaskRequestSchema, async (request: any) => {
      return this.taskExecutor.handleGetTask(request?.params?.taskId);
    });

    taskServer.setRequestHandler(ListTasksRequestSchema, async (request: any) => {
      return this.taskExecutor.handleListTasks(request?.params?.cursor as string | undefined);
    });

    taskServer.setRequestHandler(CancelTaskRequestSchema, async (request: any) => {
      return this.taskExecutor.handleCancelTask(request?.params?.taskId);
    });

    taskServer.setRequestHandler(GetTaskPayloadRequestSchema, async (request: any) => {
      return this.taskExecutor.handleGetTaskPayload(request?.params?.taskId, server);
    });

    this.setupRootsForServer(server);
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

  private imageContentFromResult(
    value: unknown,
    declaredMimeType?: string
  ): {
    type: 'image';
    data: string;
    mimeType: string;
  } | null {
    if (typeof value === 'string') {
      const match = value.match(/^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (match) return { type: 'image', mimeType: match[1], data: match[2].replace(/\s/g, '') };
      if (value.trimStart().startsWith('{')) {
        try {
          return this.imageContentFromResult(JSON.parse(value), declaredMimeType);
        } catch {
          return null;
        }
      }
      return null;
    }
    let bytes: Uint8Array | null = null;
    if (value instanceof Uint8Array) bytes = value;
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (
        entries.length > 0 &&
        entries.every(([key, item]) => /^\d+$/.test(key) && Number.isInteger(item))
      ) {
        const ordered = entries.sort(([a], [b]) => Number(a) - Number(b));
        bytes = Uint8Array.from(ordered.map(([, item]) => Number(item)));
      }
    }
    if (!bytes) return null;
    const detectedMimeType =
      declaredMimeType ||
      (bytes[0] === 0x42 && bytes[1] === 0x4d
        ? 'image/bmp'
        : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
          ? 'image/png'
          : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            ? 'image/jpeg'
            : undefined);
    if (!detectedMimeType?.startsWith('image/')) return null;
    return {
      type: 'image',
      mimeType: detectedMimeType,
      data: Buffer.from(bytes).toString('base64'),
    };
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
  private formatError(error: any, toolName: string, _args: any): any {
    // The wire response is identical in development and production: arguments
    // and stack traces are private diagnostics and must never reach a client.
    this.log('error', `[Photon Error] ${toolName}: ${sanitizePublicErrorMessage(error)}`);
    return buildMCPToolError(toolName, error);
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
    args: Record<string, unknown>,
    server: Server = this.server
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

      const result = await server.elicitInput({
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
      const inputProvider = this.createMCPInputProvider(server);
      const samplingProvider = this.createMCPSamplingProvider(server);
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

      // Announce web capability when the photon has @get / defined.
      // HTTP mode: the existing HTTP server already handles web routes at their
      // declared paths, so we expose the server's own base URL.
      // STDIO stateful: we spin up a companion HTTP server to host those routes
      // and expose its URL. Stateless photons cannot have a companion server.
      const transport = this.options.transport || 'stdio';

      const photonWithMeta = this.mcp as PhotonClassWithMeta | undefined;
      const webRootRoute = photonWithMeta?._httpRoutes?.find(
        (r) => r.method === 'GET' && r.path === '/'
      );

      if (transport === 'sse') {
        if (webRootRoute) {
          const httpPort = Number(this.options.port) || 3000;
          const webDescription =
            photonWithMeta?.description || `${photonWithMeta?.name} web interface`;
          this.server.registerCapabilities({
            web: { url: `http://localhost:${httpPort}`, description: webDescription },
          } as ServerCapabilitiesWithWeb);
        }
        await this.startSSE();
      } else {
        if (webRootRoute && photonStateful) {
          const webPort = await findFreePort(Number(this.options.port) || 0);
          const webDescription =
            photonWithMeta?.description || `${photonWithMeta?.name} web interface`;
          this.server.registerCapabilities({
            web: { url: `http://localhost:${webPort}`, description: webDescription },
          } as ServerCapabilitiesWithWeb);
          await this.startStdio(webPort);
        } else {
          await this.startStdio();
        }
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
   * Start server with stdio transport.
   * @param webPort - when set, start a companion HTTP server on this port
   *                  to serve HTTP route tags for stateful photons.
   */
  private async startStdio(webPort?: number) {
    const transport = new CapabilityCaptureTransport(new StdioServerTransport(), (message) => {
      if (message?.method === 'initialize' && message.params?.capabilities) {
        this.capabilityNegotiator.setRawCapabilities(this.server, message.params.capabilities);
        void this.channelManager.interceptPermissionRequest(message);
      }
    });

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

    let firstServer = true;
    this.stdioHandle = serveStdio(
      () => {
        // The constructor-installed server is reused for the first opening;
        // SDK v2 may request a fresh instance for a modern discovery probe or
        // for a legacy fallback. Every fresh instance receives the same
        // Photon handler registration and no transport code is duplicated.
        const reusedInitialServer = firstServer;
        const server = reusedInitialServer ? this.server : this.createMcpProtocolServer();
        firstServer = false;
        this.server = server;
        if (!reusedInitialServer) {
          const sessionId = `stdio-${this.daemonName}-${crypto.randomUUID()}`;
          this.setupHandlersForServer(server, {
            server,
            getInstanceName: () => this.daemonInstanceName,
            setInstanceName: (name) => {
              this.daemonInstanceName = name;
            },
            sessionId,
          });
        }
        return server;
      },
      {
        transport,
        legacy: 'serve',
        onerror: (error) => {
          this.log('warn', 'Official MCP v2 stdio handler error', {
            error: getErrorMessage(error),
          });
        },
      }
    );
    this.log('info', `Server started: ${this.mcp!.name}`);

    if (webPort) {
      const webServer = createServer((req, res) => {
        void this.handleWebRoute(req, res);
      });
      await new Promise<void>((resolve, reject) => {
        webServer.listen(webPort, () => resolve());
        webServer.on('error', reject);
      });
      this.log('info', `Web UI: http://localhost:${webPort}`);
    }
  }

  /**
   * Dispatch an incoming HTTP request to the photon's tagged HTTP routes.
   * Used by the companion HTTP server that runs alongside STDIO stateful photons.
   */
  private async handleWebRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setSecurityHeaders(res);
    if (!req.url) {
      res.writeHead(400).end('Missing URL');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const corsOrigin = getCorsOrigin(req);

    if (req.method === 'OPTIONS') {
      const preflightHeaders: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      };
      if (corsOrigin) preflightHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      res.writeHead(204, preflightHeaders).end();
      return;
    }

    const httpRoutes = this.mcp?._httpRoutes;
    if (httpRoutes?.length && req.method) {
      const route = httpRoutes.find((r) => r.method === req.method && r.path === url.pathname);
      if (route) {
        const targetMcp = await this.resolveInstanceMcp(undefined);
        const photonInstance = targetMcp?.instance;
        const fn = photonInstance?.[route.handler];
        if (typeof fn === 'function') {
          try {
            let bodyBuffer = Buffer.alloc(0);
            await new Promise<void>((resolve) => {
              req.on('data', (chunk: Buffer) => {
                bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
              });
              req.on('end', resolve);
            });
            const webReq = new Request(url.toString(), {
              method: req.method,
              headers: req.headers as Record<string, string>,
              ...(req.method !== 'GET' && bodyBuffer.length > 0 ? { body: bodyBuffer } : {}),
            });
            const result: unknown = await fn.call(photonInstance, webReq);

            if (result instanceof Response) {
              await writeFetchResponseToNode(
                result,
                res,
                corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}
              );
              return;
            }

            const { negotiateAccept } = await import('./format/registry.js');
            const { getDefaultRegistry } = await import('./format/seed.js');
            const acceptHeader = req.headers['accept'];
            const rendered = negotiateAccept({
              accept: typeof acceptHeader === 'string' ? acceptHeader : undefined,
              declaredFormat: route.format,
              value: result,
              registry: getDefaultRegistry(),
            });
            const negotiatedHeaders: Record<string, string> = { 'Content-Type': rendered.mime };
            if (corsOrigin) negotiatedHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, negotiatedHeaders);
            res.end(typeof rendered.body === 'string' ? rendered.body : Buffer.from(rendered.body));
            return;
          } catch (err: any) {
            res.writeHead(500).end(err?.message ?? 'Internal Server Error');
            return;
          }
        }
      }
    }

    res.writeHead(404).end('Not Found');
  }

  private async serveTopLevelUiAsset(
    req: IncomingMessage,
    res: ServerResponse,
    uiId: string,
    corsOrigin?: string
  ): Promise<boolean> {
    const ui = this.mcp?.assets?.ui.find((asset) => asset.id === uiId);
    if (!ui?.resolvedPath) return false;

    try {
      // Non-.tsx assets: serve the file as-is (unchanged behaviour).
      if (!ui.resolvedPath.endsWith('.tsx')) {
        const content = await readText(ui.resolvedPath);
        const uiHeaders: Record<string, string> = { 'Content-Type': 'text/html' };
        if (corsOrigin) uiHeaders['Access-Control-Allow-Origin'] = corsOrigin;
        if (detectIsolationMode(req) === 'standalone') {
          uiHeaders['Cross-Origin-Opener-Policy'] = 'same-origin';
          uiHeaders['Cross-Origin-Embedder-Policy'] = 'require-corp';
        }
        res.writeHead(200, uiHeaders);
        res.end(content);
        return true;
      }

      const { compileTsxCached, tsxHttpResponse } = await import('./tsx-compiler.js');
      const compiled = await compileTsxCached(ui.resolvedPath);

      // This mount doubles as the SPA fallback (any unmatched GET), so the
      // browser's relative `./<hash>.js` request may arrive at an arbitrary
      // depth. The hashed filename is unique, so match it by basename to
      // serve the immutable bundle; everything else gets the shell.
      const reqPath = (req.url ?? '').split('?')[0];
      const lastSeg = decodeURIComponent(reqPath.slice(reqPath.lastIndexOf('/') + 1));
      const restPath = compiled.jsFileName && lastSeg === compiled.jsFileName ? lastSeg : '';

      const r = tsxHttpResponse(compiled, restPath);
      // Cheap revalidation: 304 when the shell hash is unchanged.
      const inm = req.headers['if-none-match'];
      if (r.headers['ETag'] && inm && inm === r.headers['ETag']) {
        const notMod: Record<string, string> = { ETag: r.headers['ETag'] };
        if (corsOrigin) notMod['Access-Control-Allow-Origin'] = corsOrigin;
        res.writeHead(304, notMod);
        res.end();
        return true;
      }
      const uiHeaders: Record<string, string> = { ...r.headers };
      if (corsOrigin) uiHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      if (!restPath && detectIsolationMode(req) === 'standalone') {
        uiHeaders['Cross-Origin-Opener-Policy'] = 'same-origin';
        uiHeaders['Cross-Origin-Embedder-Policy'] = 'require-corp';
      }
      if (restPath) uiHeaders['Cross-Origin-Resource-Policy'] = 'same-origin';
      res.writeHead(r.status, uiHeaders);
      res.end(r.body);
      return true;
    } catch {
      return false;
    }
  }

  private standaloneApplicationManifest(): ApplicationManifest | undefined {
    if (!this.mcp) return undefined;
    const uiAssets = this.mcp.assets?.ui || [];
    const methods: ApplicationManifestMethod[] = (this.mcp.tools || []).map((tool: any) => {
      const linkedUi = uiAssets.find(
        (asset) => asset.linkedTool === tool.name || asset.linkedTools?.includes(tool.name)
      );
      return {
        name: tool.name,
        description: tool.description,
        title: tool.title,
        buttonLabel: tool.buttonLabel,
        icon: tool.icon,
        internal: tool.internal,
        scheduled: tool.scheduled,
        webhook: tool.webhook,
        visibility: tool.visibility,
        ...(linkedUi ? { linkedUi: linkedUi.id } : {}),
      };
    });
    const contracts = this.loader.getCapabilityContracts(this.mcp);
    return extractApplicationManifest(methods, {
      entry: methods.find((method) => method.name === 'main')?.name,
      settings: Boolean(this.mcp.settingsSchema?.hasSettings),
      autoScreens: true,
      browserInvocableMethods: browserInvocableMethodNames(contracts),
    });
  }

  private hasExplicitStandaloneUi(): boolean {
    return Boolean(this.mcp?.assets?.ui?.length);
  }

  private standaloneShell(): string | undefined {
    if (!this.mcp || this.hasExplicitStandaloneUi()) return undefined;
    const manifest = this.standaloneApplicationManifest();
    if (!manifest) return undefined;
    const photon = this.mcp as PhotonClassWithMeta & { label?: string };
    const title = photon.label || photon.name || 'Photon App';
    return generateStandaloneWebShell({
      photonName: photon.name || 'photon',
      title,
      description: photon.description || `${title} - Photon App`,
      icon: photon.icon || '📦',
      manifest,
    });
  }

  private async serveStandaloneAsset(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname === '/api/photon-renderers.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(req.method === 'HEAD' ? undefined : generateRenderersScript());
      return true;
    }

    const bundleNames =
      pathname === '/photon-form.bundle.js'
        ? ['photon-form.bundle.js', 'beam-form.bundle.js']
        : pathname === '/beam-form.bundle.js'
          ? ['beam-form.bundle.js', 'photon-form.bundle.js']
          : [];
    if (bundleNames.length === 0) return false;

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    for (const bundleName of bundleNames) {
      for (const bundlePath of [
        path.join(moduleDir, bundleName),
        path.resolve(moduleDir, '../dist', bundleName),
      ]) {
        try {
          const content = readFileSync(bundlePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'no-cache',
          });
          res.end(req.method === 'HEAD' ? undefined : content);
          return true;
        } catch {
          // Try the compatibility filename and then the source-tree fallback.
        }
      }
    }
    res.writeHead(404).end('Form bundle not found. Run the Beam asset build first.');
    return true;
  }

  /**
   * Start server with SSE transport (HTTP)
   */
  private async handleWebSocketUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    const reject = (status: number, statusText: string, body = statusText): void => {
      if (socket.destroyed) return;
      const payload = Buffer.from(body);
      socket.write(
        `HTTP/1.1 ${status} ${statusText}\r\n` +
          'Connection: close\r\n' +
          'Content-Type: text/plain; charset=utf-8\r\n' +
          `Content-Length: ${payload.length}\r\n\r\n`
      );
      socket.write(payload);
      socket.destroy();
    };

    try {
      if (!req.url || req.method !== 'GET') {
        reject(400, 'Bad Request');
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const route = findServerWebRoute(this.mcp?._httpRoutes, req.method, url.pathname);
      if (!route) {
        reject(404, 'Not Found');
        return;
      }

      const { extractClaimsFromHeaders } = await import('./shared/extract-claims.js');
      const httpClaims = extractClaimsFromHeaders(req.headers);
      const targetMcp = await this.resolveInstanceMcp(
        httpClaims ? { authInfo: { extra: httpClaims } } : undefined
      );
      const photonInstance = targetMcp?.instance;
      const fn = photonInstance?.[route.handler];
      if (typeof fn !== 'function') {
        reject(404, 'Not Found');
        return;
      }

      const webReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers as Record<string, string>,
      });
      const result: unknown = await fn.call(photonInstance, webReq);
      if (!(result instanceof Response)) {
        reject(500, 'Internal Server Error', 'WebSocket route did not return a Response');
        return;
      }
      if (result.status !== 101) {
        reject(
          result.status,
          result.statusText || 'WebSocket upgrade rejected',
          await result.text()
        );
        return;
      }
      const endpoint = (result as Response & { webSocket?: LocalWebSocketEndpoint }).webSocket;
      if (!endpoint) {
        reject(500, 'Internal Server Error', 'WebSocket route did not attach an endpoint');
        return;
      }

      this.webSocketServer.handleUpgrade(req, socket, head, (browser) => {
        endpoint.accept();
        browser.on('message', (data, isBinary) => {
          if (endpoint.readyState !== 1) return;
          const payload = Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          endpoint.send(isBinary ? new Uint8Array(payload) : payload.toString('utf8'));
        });
        const forward = (event: Event) => {
          if (browser.readyState !== NodeWebSocket.OPEN) return;
          const data = (
            event as Event & {
              data: string | ArrayBuffer | ArrayBufferView;
            }
          ).data;
          if (typeof data === 'string') browser.send(data);
          else if (ArrayBuffer.isView(data)) {
            browser.send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
          } else {
            browser.send(Buffer.from(data));
          }
        };
        const closeBrowser = (event: Event) => {
          const close = event as Event & { code?: number; reason?: string };
          if (browser.readyState < NodeWebSocket.CLOSING) {
            browser.close(close.code || 1000, close.reason || '');
          }
        };
        endpoint.addEventListener('message', forward);
        endpoint.addEventListener('close', closeBrowser);
        browser.on('close', (code, reason) => {
          endpoint.removeEventListener('message', forward);
          endpoint.removeEventListener('close', closeBrowser);
          endpoint.close(code || 1000, reason.toString());
        });
        browser.on('error', () => endpoint.close(1011, 'browser websocket error'));
      });
    } catch (error) {
      this.log('warn', 'WebSocket upgrade failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      reject(500, 'Internal Server Error');
    }
  }

  /**
   * Build the official SDK v2 web-standard handler for this Photon.
   *
   * `createMcpHandler` performs the protocol-era decision and creates the
   * correct transport for every request. The factory only creates a Server
   * and installs Photon handlers; it must not inspect JSON-RPC framing or
   * implement session/SSE lifecycle itself.
   */
  private createMcpHttpHandler(): McpHttpHandler {
    return createMcpHandler(
      (requestContext) => {
        const server = this.createMcpProtocolServer();
        const sessionId =
          requestContext.requestInfo?.headers.get('mcp-session-id') ||
          `http-${crypto.randomUUID()}`;
        const ctx: HandlerContext = {
          server,
          getInstanceName: () => this.sseInstanceNames.get(sessionId),
          setInstanceName: (name) => {
            this.sseInstanceNames.set(sessionId, name);
          },
          sessionId,
        };
        this.setupHandlersForServer(server, ctx);
        return server;
      },
      {
        // Route legacy HTTP through the official stateful transport below.
        // The v2 handler owns modern 2026 negotiation; the legacy transport
        // is kept stateful so Photon can preserve per-client capabilities
        // between initialize and tools/list/tools/call.
        legacy: 'reject',
        responseMode: 'auto',
        onerror: (error) => {
          this.log('warn', 'Official MCP v2 handler error', {
            error: getErrorMessage(error),
          });
        },
      }
    );
  }

  /**
   * Serve a legacy HTTP exchange with the official v2 transport.
   *
   * `createMcpHandler({ legacy: 'stateless' })` is intentionally stateless,
   * which is excellent for simple servers but cannot retain the client's
   * initialize capabilities for Photon's progressive UI responses. This
   * wrapper only owns the session map; framing, validation, protocol version
   * handling, and session mechanics remain entirely in the SDK transport.
   */
  private async handleMcpLegacyHttpRequest(
    request: Request,
    options: { authInfo?: AuthInfo; parsedBody?: unknown } = {}
  ): Promise<Response> {
    const requestedSessionId = request.headers.get('mcp-session-id');
    let entry = requestedSessionId ? this.legacyHttpSessions.get(requestedSessionId) : undefined;

    if (!entry) {
      if (request.method !== 'POST') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32000, message: 'Legacy MCP session not found' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const server = this.createMcpProtocolServer();
      const sessionEntry = {
        server,
        transport: undefined as unknown as WebStandardStreamableHTTPServerTransport,
      };
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => `legacy-${crypto.randomUUID()}`,
        onsessionclosed: (sessionId) => {
          if (sessionId) this.legacyHttpSessions.delete(sessionId);
        },
      });
      sessionEntry.transport = transport;
      entry = sessionEntry;
      let contextSessionId = `legacy-pending-${crypto.randomUUID()}`;
      this.setupHandlersForServer(server, {
        server,
        getInstanceName: () => contextSessionId,
        setInstanceName: () => undefined,
        sessionId: contextSessionId,
      });
      const wire = new CapabilityCaptureTransport(transport, (message) => {
        if (message?.method === 'initialize' && message.params?.capabilities) {
          this.capabilityNegotiator.setRawCapabilities(server, message.params.capabilities);
          void this.channelManager.interceptPermissionRequest(message);
        }
      });
      await server.connect(wire);
      const originalHandleRequest = transport.handleRequest.bind(transport);
      // The transport assigns its session id during initialize. Keep the
      // request context aligned without replacing any SDK protocol logic.
      transport.handleRequest = async (incomingRequest, requestOptions) => {
        const response = await originalHandleRequest(incomingRequest, requestOptions);
        if (transport.sessionId) contextSessionId = transport.sessionId;
        return response;
      };
    }

    const response = await entry.transport.handleRequest(request, {
      ...(options.authInfo ? { authInfo: options.authInfo } : {}),
      ...(options.parsedBody !== undefined ? { parsedBody: options.parsedBody } : {}),
    });
    const sessionId = entry.transport.sessionId;
    if (sessionId) this.legacyHttpSessions.set(sessionId, entry);

    if (request.method === 'DELETE' && sessionId) {
      this.legacyHttpSessions.delete(sessionId);
    }
    return response;
  }

  private requiredScopesForMcpTool(toolName: unknown): string[] {
    if (typeof toolName !== 'string' || !this.mcp) return [];
    const separator = Math.max(toolName.indexOf('.'), toolName.indexOf('/'));
    const targetPhoton = separator >= 0 ? toolName.slice(0, separator) : this.mcp.name;
    const localName = separator >= 0 ? toolName.slice(separator + 1) : toolName;
    const target =
      targetPhoton === this.mcp.name ? this.mcp : this.loader.getLoadedPhotons().get(targetPhoton);
    const tool = target?.tools.find((candidate) => candidate.name === localName);
    const scopes = (tool as (ExtractedSchema & { scopes?: unknown[] }) | undefined)?.scopes;
    return Array.isArray(scopes)
      ? scopes.filter((scope): scope is string => typeof scope === 'string')
      : [];
  }

  /**
   * Verify the request before it reaches the official handler. The SDK owns
   * protocol negotiation, but deliberately does not verify bearer tokens;
   * Photon remains the application resource server and supplies AuthInfo to
   * the SDK as a pass-through value.
   */
  private async authorizeMcpHttpRequest(
    req: IncomingMessage,
    parsed: any,
    corsOrigin?: string
  ): Promise<{ authInfo?: AuthInfo; response?: Response }> {
    const photon = this.mcp;
    const authDirective = photon?.authDirective;
    const authMode = authDirective?.scheme === 'oauth' ? 'oauth' : localMcpAuthMode();
    const suppliedBearer = authHeaderToken(req);
    const method = parsed?.method;
    const optionalPhotonAuth = authDirective?.mode === 'optional' || photon?.auth === 'optional';
    const requiresAuthentication =
      authDirective?.mode === 'required' ||
      photon?.auth === 'required' ||
      (method === 'tools/call' && !optionalPhotonAuth) ||
      suppliedBearer !== null;
    const requiredScopes =
      method === 'tools/call' ? this.requiredScopesForMcpTool(parsed?.params?.name) : [];

    const reject = (
      status: number,
      code: number,
      message: string,
      reason: string,
      challenge: string
    ) => {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'WWW-Authenticate': challenge,
      });
      if (corsOrigin) headers.set('Access-Control-Allow-Origin', corsOrigin);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed?.id ?? null,
          error: { code, message, data: { reason } },
        }),
        { status, headers }
      );
    };

    let claims: Record<string, unknown> | undefined;
    if (requiresAuthentication && authMode === 'oauth') {
      const result = this.oauthRuntime?.verifyBearer(suppliedBearer, requiredScopes);
      if (!result?.ok) {
        const reason = result?.reason ?? (suppliedBearer ? 'invalid_token' : 'missing_token');
        const insufficientScope = reason === 'insufficient_scope';
        return {
          response: reject(
            insufficientScope ? 403 : 401,
            insufficientScope ? -32003 : -32001,
            insufficientScope ? 'Forbidden' : 'Unauthorized',
            reason,
            this.oauthRuntime?.wwwAuthenticate(
              requiredScopes,
              insufficientScope ? 'insufficient_scope' : 'invalid_token'
            ) || 'Bearer realm="photon"'
          ),
        };
      }
      claims = result.caller;
    } else if (requiresAuthentication && authMode === 'jwt') {
      let jwks: { keys: JsonWebKey[] } | null = null;
      let issuer: string | undefined;
      const profileName = process.env.PHOTON_MCP_JWT_PROFILE;
      if (profileName) {
        const profile = await loadJwtProfile(profileName);
        if (profile) {
          issuer = profile.issuer;
          jwks = profile.jwks;
        }
      } else {
        try {
          jwks = process.env.PHOTON_MCP_JWT_JWKS
            ? (JSON.parse(process.env.PHOTON_MCP_JWT_JWKS) as { keys: JsonWebKey[] })
            : null;
        } catch {
          jwks = null;
        }
        issuer = process.env.PHOTON_MCP_JWT_ISSUER;
      }
      const audience = process.env.PHOTON_MCP_JWT_AUDIENCE;
      if (!issuer || !audience || !jwks) {
        return {
          response: reject(
            401,
            -32001,
            'Unauthorized',
            'missing_token',
            localMcpWwwAuthenticate(req, 'invalid_token', requiredScopes, audience)
          ),
        };
      }
      const result = verifyPhotonAuthToken(suppliedBearer, {
        issuer,
        audience,
        jwks,
        requiredScopes,
      });
      if (!result.ok) {
        const insufficientScope = result.reason === 'insufficient_scope';
        return {
          response: reject(
            insufficientScope ? 403 : 401,
            insufficientScope ? -32003 : -32001,
            insufficientScope ? 'Forbidden' : 'Unauthorized',
            result.reason,
            localMcpWwwAuthenticate(
              req,
              insufficientScope ? 'insufficient_scope' : 'invalid_token',
              requiredScopes,
              audience
            )
          ),
        };
      }
      claims = result.claims;
    } else if (requiresAuthentication && authMode === 'bearer') {
      const expected = process.env.PHOTON_MCP_BEARER;
      if (!mcpTokenMatches(suppliedBearer, expected)) {
        return {
          response: reject(
            401,
            -32001,
            'Unauthorized',
            expected ? 'invalid_token' : 'missing_token',
            localMcpWwwAuthenticate(req, 'invalid_token', requiredScopes)
          ),
        };
      }
      claims = { sub: 'bearer', name: 'bearer', auth: 'bearer', role: 'host' };
    }

    const headerClaims = (await import('./shared/extract-claims.js')).extractClaimsFromHeaders(
      req.headers
    );
    claims = claims ?? headerClaims;
    const caller = callerFromVerifiedClaims(claims);

    // Optional-auth photons intentionally advertise the anonymous catalog.
    // If an anonymous caller directly targets a hidden tool, return the OAuth
    // challenge expected by MCP clients instead of leaking a generic tool error.
    if (method === 'tools/call' && optionalPhotonAuth && !suppliedBearer && this.mcp) {
      const toolName = parsed?.params?.name;
      const separator =
        typeof toolName === 'string' ? Math.max(toolName.indexOf('.'), toolName.indexOf('/')) : -1;
      const targetPhoton = separator >= 0 ? toolName.slice(0, separator) : this.mcp.name;
      const localName = separator >= 0 ? toolName.slice(separator + 1) : toolName;
      const target =
        targetPhoton === this.mcp.name
          ? this.mcp
          : this.loader.getLoadedPhotons().get(targetPhoton);
      if (!target || !this.loader.isToolAccessible(target, localName, caller)) {
        return {
          response: reject(
            401,
            -32001,
            'Unauthorized',
            'missing_token',
            this.oauthRuntime?.wwwAuthenticate(requiredScopes, 'invalid_token') ||
              localMcpWwwAuthenticate(req, 'invalid_token', requiredScopes)
          ),
        };
      }
    }

    if (!claims) return {};
    const scope = typeof claims.scope === 'string' ? claims.scope : '';
    return {
      authInfo: {
        token: suppliedBearer || '',
        clientId: typeof claims.client_id === 'string' ? claims.client_id : '',
        scopes: scope.split(/\s+/).filter(Boolean),
        extra: claims,
      },
    };
  }

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
    const photonName = this.mcp?.name || 'photon';
    if (this.mcp?.authDirective?.scheme === 'oauth') {
      const { PhotonOAuthRuntime } = await import('./auth/runtime-oauth.js');
      const photonDisplayMeta = this.mcp as PhotonClassWithMeta & { label?: string };
      const photonSource = await readText(this.options.filePath);
      const oauthStylesheets = await resolvePhotonStylesheetAssets(
        this.options.filePath,
        photonSource
      );
      const oauthCustomCss = oauthStylesheets.oauth
        ? await readText(oauthStylesheets.oauth.resolvedPath)
        : undefined;
      const publicBase =
        process.env.PHOTON_PUBLIC_URL?.replace(/\/+$/, '') || `http://127.0.0.1:${port}`;
      this.oauthRuntime = new PhotonOAuthRuntime({
        baseUrl: publicBase,
        photonName,
        photonDisplayName: photonDisplayMeta.label,
        photonIcon: this.mcp?.icon,
        photonDescription: this.mcp?.description,
        devMode: this.devMode,
        oauthCustomCss,
        authMethods: this.mcp?.authDirective?.methods,
        scopesSupported: Array.from(
          new Set(
            (this.mcp?.tools || []).flatMap((tool: any) =>
              Array.isArray(tool.scopes)
                ? tool.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
                : []
            )
          )
        ),
      });
    }

    // The official SDK v2 handler is the only MCP HTTP transport. Photon adds
    // authorization, role filtering, UI metadata, and application handlers
    // through the factory; it does not implement JSON-RPC or session framing.
    this.mcpHttpHandler = this.createMcpHttpHandler();

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
        let matchedRoute: {
          handler: string;
          format?: string;
          expose?: 'private' | 'public';
        } | null = null;

        if (this.oauthRuntime && (await this.oauthRuntime.handle(req, res))) {
          return;
        }
        const route = findServerWebRoute(this.mcp?._httpRoutes, req.method, url.pathname);
        if (route) matchedRoute = { handler: route.handler, format: route.format };
        const clientAppUi = selectServerClientAppUi(
          this.mcp as Parameters<typeof selectServerClientAppUi>[0]
        );

        const generatedShell = this.standaloneShell();
        const webRoot = this.mcp?._httpRoutes?.some(
          (candidate) => candidate.method === 'GET' && candidate.path === '/'
        );
        const standalonePath =
          url.pathname === '/' ||
          url.pathname === `/web/${encodeURIComponent(this.mcp?.name || '')}` ||
          url.pathname === `/web/${encodeURIComponent(this.mcp?.name || '')}/`;

        if (
          req.method === 'GET' &&
          generatedShell &&
          !matchedRoute &&
          !clientAppUi &&
          !webRoot &&
          standalonePath
        ) {
          const shellHeaders: Record<string, string> = {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          };
          if (corsOrigin) shellHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(200, shellHeaders);
          res.end(generatedShell);
          return;
        }

        if (await this.serveStandaloneAsset(req, res, url.pathname)) return;

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          const preflightHeaders: Record<string, string> = {
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, X-Photon-Request',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
          };
          if (corsOrigin) preflightHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(204, preflightHeaders);
          res.end();
          return;
        }

        // Official MCP SDK v2 web-standard handler. It owns protocol-era
        // negotiation, request envelopes, sessions, SSE, and legacy fallback.
        if (this.mcpHttpHandler && url.pathname === ssePath) {
          let body: Buffer | undefined;
          let parsedBody: unknown;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            body = Buffer.concat(chunks);
            if (body.length > 0) {
              try {
                parsedBody = JSON.parse(body.toString('utf8'));
              } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
              }
            }
          }

          const auth = await this.authorizeMcpHttpRequest(req, parsedBody, corsOrigin);
          if (auth.response) {
            await writeFetchResponseToNode(auth.response, res);
            return;
          }

          const request = new Request(url.toString(), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(body && body.length > 0 ? { body } : {}),
          });
          const requestSessionId = req.headers['mcp-session-id'];
          const hasLegacySession =
            typeof requestSessionId === 'string' && this.legacyHttpSessions.has(requestSessionId);
          const legacyRequest =
            hasLegacySession ||
            (req.method === 'POST' && (await isLegacyRequest(request, parsedBody)));
          const handlerOptions = {
            ...(auth.authInfo ? { authInfo: auth.authInfo } : {}),
            ...(parsedBody !== undefined ? { parsedBody } : {}),
          };
          const response = legacyRequest
            ? await this.handleMcpLegacyHttpRequest(request, handlerOptions)
            : await this.mcpHttpHandler.fetch(request, handlerOptions);
          const responseHeaders: Record<string, string> = {};
          if (corsOrigin) responseHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          responseHeaders['Access-Control-Expose-Headers'] = 'Mcp-Session-Id';
          await writeFetchResponseToNode(response, res, responseHeaders);
          return;
        }

        // Legacy SSE transport (when not using Streamable HTTP)
        if (req.method === 'GET' && url.pathname === ssePath) {
          await this.handleSSEConnection(req, res, messagesPath);
          return;
        }
        if (req.method === 'POST' && url.pathname === messagesPath) {
          await this.handleSSEMessage(req, res, url);
          return;
        }

        // Serve embedded index.html at root when assets are available
        if (req.method === 'GET' && url.pathname === '/' && this.options.embeddedAssets) {
          const htmlHeaders: Record<string, string> = {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          };
          if (corsOrigin) htmlHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(200, htmlHeaders);
          res.end(this.options.embeddedAssets.indexHtml);
          return;
        }

        // Health check / info endpoint
        if (req.method === 'GET' && url.pathname === '/' && !matchedRoute && !clientAppUi) {
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
        const isUiReadRequest = req.method === 'GET' || req.method === 'HEAD';
        const uiMatch = isUiReadRequest && url.pathname.match(/^\/api\/ui\/([^/]+)(?:\/(.*))?$/);
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
                if (ui.resolvedPath.endsWith('.tsx')) {
                  const { compileTsxCached, tsxHttpResponse } = await import('./tsx-compiler.js');
                  const compiled = await compileTsxCached(ui.resolvedPath);
                  const r = tsxHttpResponse(compiled, '');
                  const inm = req.headers['if-none-match'];
                  if (r.headers['ETag'] && inm && inm === r.headers['ETag']) {
                    const notMod: Record<string, string> = { ETag: r.headers['ETag'] };
                    if (corsOrigin) notMod['Access-Control-Allow-Origin'] = corsOrigin;
                    res.writeHead(304, notMod);
                    res.end();
                    return;
                  }
                  const tsxHeaders: Record<string, string> = { ...r.headers };
                  if (corsOrigin) tsxHeaders['Access-Control-Allow-Origin'] = corsOrigin;
                  if (detectIsolationMode(req) === 'standalone') {
                    tsxHeaders['Cross-Origin-Opener-Policy'] = 'same-origin';
                    tsxHeaders['Cross-Origin-Embedder-Policy'] = 'require-corp';
                  }
                  res.writeHead(r.status, tsxHeaders);
                  res.end(req.method === 'HEAD' ? undefined : r.body);
                  return;
                }
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
                res.end(req.method === 'HEAD' ? undefined : content);
                return;
              } catch {
                // Fall through to 404
              }
            }
            res.writeHead(404).end('UI not found');
            return;
          }

          // Compiled .tsx bundle: the shell references `./<base>.<hash>.js`,
          // which lands here as a sub-path. Serve it from the compile cache
          // with an immutable cache policy (the hash is the cache key).
          if (ui?.resolvedPath?.endsWith('.tsx')) {
            const { compileTsxCached, tsxHttpResponse } = await import('./tsx-compiler.js');
            const compiled = await compileTsxCached(ui.resolvedPath);
            const r = tsxHttpResponse(compiled, restPath);
            if (r.status === 200) {
              const jsHeaders: Record<string, string> = { ...r.headers };
              if (corsOrigin) jsHeaders['Access-Control-Allow-Origin'] = corsOrigin;
              jsHeaders['Cross-Origin-Resource-Policy'] = 'same-origin';
              res.writeHead(200, jsHeaders);
              res.end(req.method === 'HEAD' ? undefined : r.body);
              return;
            }
            // Not the bundle (e.g. a static sibling shipped beside the .tsx) —
            // fall through to filesystem resolution below.
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
            // Resolve symlinks to block symlink escapes that pass the lexical check.
            let realCandidate: string;
            try {
              realCandidate = await fs.realpath(candidate);
            } catch {
              res.writeHead(404).end('Not Found');
              return;
            }
            if (!realCandidate.startsWith(baseWithSep)) {
              res.writeHead(403).end('Forbidden');
              return;
            }
            try {
              const content = await fs.readFile(realCandidate);
              const ext = path.extname(realCandidate).toLowerCase();
              const mime = uiSiblingMime(ext);
              const sibHeaders: Record<string, string> = { 'Content-Type': mime };
              if (corsOrigin) sibHeaders['Access-Control-Allow-Origin'] = corsOrigin;
              // Track D2: CORP same-origin so a standalone parent page with
              // COEP `require-corp` can fetch its own SPA chunks.
              sibHeaders['Cross-Origin-Resource-Policy'] = 'same-origin';
              res.writeHead(200, sibHeaders);
              res.end(req.method === 'HEAD' ? undefined : content);
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
                res.end(req.method === 'HEAD' ? undefined : (decoded.buffer ?? decoded.text));
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
            const indexHeaders: Record<string, string> = {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            };
            if (corsOrigin) indexHeaders['Access-Control-Allow-Origin'] = corsOrigin;
            res.writeHead(200, indexHeaders);
            res.end(assets.indexHtml);
            return;
          }

          if (req.method === 'GET' && url.pathname === '/beam.bundle.js') {
            const jsHeaders: Record<string, string> = {
              'Content-Type': 'text/javascript',
              'Cache-Control': 'no-store, no-cache, must-revalidate',
            };
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
          const fallbackHeaders: Record<string, string> = {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          };
          if (corsOrigin) fallbackHeaders['Access-Control-Allow-Origin'] = corsOrigin;
          res.writeHead(200, fallbackHeaders);
          res.end(this.options.embeddedAssets.indexHtml);
          return;
        }

        // @get / @post HTTP routes — dispatch to photon method, public (no auth).
        // Track C: when none match, fall through to the auto-RPC table built
        // from @expose tags below.
        // Track C: auto-RPC. POST /api/<kebab-method> dispatches to @expose'd
        // methods. Explicit HTTP routes take precedence (matchedRoute already
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
          // Track C closure (extended): HTTP route and @expose dispatchers
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
              // signature; HTTP route handlers keep the Request directly so
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
                await writeFetchResponseToNode(
                  result,
                  res,
                  corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}
                );
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

        if (
          req.method === 'GET' &&
          clientAppUi &&
          shouldFallbackToServerClientApp(url.pathname, url.searchParams, matchedRoute ?? undefined)
        ) {
          const served = await this.serveTopLevelUiAsset(req, res, clientAppUi, corsOrigin);
          if (served) return;
        }

        res.writeHead(404).end('Not Found');
      })();
    });

    this.httpServer.on('clientError', (err: Error, socket) => {
      this.log('warn', 'HTTP client error', { message: err.message });
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    this.httpServer.on('upgrade', (req, socket, head) => {
      void this.handleWebSocketUpgrade(req, socket, head);
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

    // Mirror web capability onto the per-session server when the photon has web routes.
    const sessionWebMeta = (this.mcp as PhotonClassWithMeta | undefined)?._httpRoutes?.find(
      (r) => r.method === 'GET' && r.path === '/'
    );
    if (sessionWebMeta) {
      const httpPort = Number(this.options.port) || 3000;
      const webDescription = this.mcp?.description || `${this.mcp?.name} web interface`;
      sessionServer.registerCapabilities({
        web: { url: `http://localhost:${httpPort}`, description: webDescription },
      } as ServerCapabilitiesWithWeb);
    }

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
    this.setupHandlersForServer(sessionServer, ctx, sessionSink);
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

      // Upgraded sockets are not normal HTTP connections, so Node's
      // closeAllConnections() does not include them.
      for (const browser of this.webSocketServer.clients) browser.terminate();

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

      if (this.stdioHandle) {
        await this.stdioHandle.close();
        this.stdioHandle = null;
      } else {
        await this.server.close();
      }
      if (this.mcpHttpHandler) {
        await this.mcpHttpHandler.close();
        this.mcpHttpHandler = null;
      }
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
