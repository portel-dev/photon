/**
 * Photon adapter around the official MCP TypeScript client.
 *
 * Beam used to implement a second JSON-RPC/Streamable HTTP client here. That
 * made every protocol revision, pagination rule, timeout, and multi-round
 * continuation another piece of Photon code to keep in sync. The official
 * `@modelcontextprotocol/client` package now owns that protocol surface.
 *
 * This adapter intentionally contains only Beam/Photon concerns:
 *   - routing headers for Photon’s multiplexed endpoint
 *   - the browser fetch/auth seam
 *   - Beam’s event-emitter compatibility API
 *   - manual input-required continuation support for Beam’s UI
 *   - request-handler adaptation for Photon’s existing callbacks
 */

import {
  Client,
  StreamableHTTPClientTransport,
  fromJsonSchema,
  type CallToolRequestParams,
  type DiscoverResult,
  type Implementation,
  type RequestOptions,
} from '@modelcontextprotocol/client';
import { getMCPRequestRoutingHeaders } from '../../../mcp/protocol/routing-headers.js';

type Listener = (data?: unknown) => void;
type JSONRecord = Record<string, unknown>;

const MCP_2026_PROTOCOL_VERSION = '2026-07-28';
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TIMEOUT_MS = 30 * 60_000;

/** Add Photon’s routing headers to official Streamable HTTP requests. */
export function createMCPClientRoutingFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string') return fetchImpl(input, init);

    let message: unknown;
    try {
      message = JSON.parse(init.body);
    } catch {
      return fetchImpl(input, init);
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return fetchImpl(input, init);
    }

    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(getMCPRequestRoutingHeaders(message))) {
      headers.set(name, value);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export interface CallOptions {
  progressToken?: string | number;
  onProgress?: (params: JSONRecord) => void;
  signal?: AbortSignal;
  requestState?: string;
  inputResponses?: Record<string, unknown>;
  idleTimeoutMs?: number;
  maxTimeoutMs?: number;
}

export interface MCPClientSDKOptions {
  authToken?: string;
  /** Optional explicit legacy selection, retained for compatibility tests. */
  protocolVersion?: string;
  clientInfo?: { name: string; version: string };
  clientCapabilities?: JSONRecord;
  fetch?: typeof fetch;
}

type RequestHandler = (params: JSONRecord) => unknown;

/** The official SDK's custom-method schema boundary. */
const ANY_JSON_SCHEMA = fromJsonSchema<unknown>({});

const DEFAULT_CAPABILITIES: JSONRecord = {
  tools: { listChanged: true },
  resources: { subscribe: true, listChanged: true },
  // MCP SDK v2 models elicitation modes as capability objects. The previous
  // boolean shorthand made the browser client fail schema validation during
  // modern negotiation before it could load the Beam tool list.
  elicitation: { form: {}, url: {} },
  sampling: {},
  roots: { listChanged: true },
  extensions: {
    'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
    'dev.portel.photon': { version: '1.0.0' },
  },
};

function mergeCapabilities(input?: JSONRecord): JSONRecord {
  const value = input ?? {};
  return {
    ...DEFAULT_CAPABILITIES,
    ...value,
    extensions: {
      ...DEFAULT_CAPABILITIES.extensions,
      ...((value.extensions as JSONRecord | undefined) ?? {}),
    },
  };
}

function sdkRequestOptions(options: CallOptions = {}): RequestOptions & JSONRecord {
  const request: RequestOptions & JSONRecord = {
    signal: options.signal,
    progressToken: options.progressToken,
    onprogress: options.onProgress,
    timeout: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
  };
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
}

/**
 * Restore Photon extensions that the official MCP decoder correctly keeps in
 * `_meta` but does not expose as arbitrary top-level fields. Beam's existing
 * view model still reads the `x-photon-*` compatibility names.
 */
function restorePhotonExtensions<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as T & JSONRecord;
  const metadata = record._meta;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return value;

  const restored = { ...record };
  for (const [key, extension] of Object.entries(metadata)) {
    if (key.startsWith('x-') && !Object.prototype.hasOwnProperty.call(restored, key)) {
      restored[key] = extension;
    }
  }
  return restored as T;
}

function restorePhotonDiscoveryMetadata(
  result: DiscoverResult | undefined
): DiscoverResult | undefined {
  if (!result || !result._meta || typeof result._meta !== 'object') return result;
  const metadata = result._meta as JSONRecord;
  const restored = { ...result } as DiscoverResult & JSONRecord;
  const extensionPrefix = 'dev.portel.photon/';
  for (const [field, key] of [
    ['configurationSchema', `${extensionPrefix}configurationSchema`],
    ['requestMetadata', `${extensionPrefix}requestMetadata`],
    ['photonVersion', `${extensionPrefix}photonVersion`],
    ['taskMode', `${extensionPrefix}taskMode`],
    ['protocolVersion', `${extensionPrefix}protocolVersion`],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) restored[field] = metadata[key];
  }
  return restored;
}

export class MCPClientSDK {
  private readonly baseUrl: URL;
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private connected = false;
  private hadDisconnect = false;

  constructor(baseUrl: string, opts: MCPClientSDKOptions = {}) {
    this.baseUrl = new URL(baseUrl);
    const fetchImpl = createMCPClientRoutingFetch(opts.fetch ?? fetch);
    const protocolVersion = opts.protocolVersion ?? MCP_2026_PROTOCOL_VERSION;
    const modern = protocolVersion === MCP_2026_PROTOCOL_VERSION;

    this.client = new Client(opts.clientInfo ?? { name: 'beam', version: '1.0.0' }, {
      capabilities: mergeCapabilities(opts.clientCapabilities),
      // Negotiate the current era automatically and fall back to the 2025
      // initialize sequence for older MCP servers.
      versionNegotiation: modern ? { mode: 'auto' } : { mode: 'legacy' },
      // Beam renders input_required UI itself. The official SDK validates
      // and normalizes the result, but does not own the dialog.
      inputRequired: { autoFulfill: false },
      // Let the official client open the modern `subscriptions/listen`
      // stream and refresh its derived list caches. Photon only translates
      // the SDK callback into Beam's existing event API below.
      listChanged: {
        tools: {
          onChanged: (error, tools) =>
            this.emitListChanged('notifications/tools/list_changed', error, tools),
        },
        prompts: {
          onChanged: (error, prompts) =>
            this.emitListChanged('notifications/prompts/list_changed', error, prompts),
        },
        resources: {
          onChanged: (error, resources) =>
            this.emitListChanged('notifications/resources/list_changed', error, resources),
        },
      },
    });

    this.transport = new StreamableHTTPClientTransport(this.baseUrl, {
      requestInit: opts.authToken
        ? { headers: { Authorization: `Bearer ${opts.authToken}` } }
        : undefined,
      fetch: fetchImpl,
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: Number.MAX_SAFE_INTEGER,
      },
    });

    this.transport.onclose = () => {
      this.connected = false;
      this.hadDisconnect = true;
      this.emit('disconnected');
    };
    this.transport.onerror = (error) => this.emit('error', error);

    this.installNotificationBridge();
    for (const [method, handler] of this.requestHandlers) {
      this.installRequestHandler(method, handler);
    }
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    const wasDisconnected = this.hadDisconnect;
    this.connected = true;
    this.hadDisconnect = false;
    this.emit(wasDisconnected ? 'reconnected' : 'connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.client.close();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  getServerVersion(): Implementation | undefined {
    return this.client.getServerVersion();
  }

  getDiscoverResult(): DiscoverResult | undefined {
    return restorePhotonDiscoveryMetadata(this.client.getDiscoverResult());
  }

  get negotiatedProtocolVersion(): string | undefined {
    return this.client.getNegotiatedProtocolVersion();
  }

  /** Call a standard or Photon extension request through the official client. */
  async request<T = unknown>(
    method: string,
    params: JSONRecord = {},
    options: CallOptions = {}
  ): Promise<T> {
    this.markActive();
    const request = { method, params } as any;
    const result = await (this.isCustomMethod(method)
      ? this.client.request(request, ANY_JSON_SCHEMA, sdkRequestOptions(options))
      : this.client.request(request, sdkRequestOptions(options)));
    return restorePhotonExtensions(result as T);
  }

  async notify(method: string, params: JSONRecord = {}): Promise<void> {
    await (this.isCustomMethod(method)
      ? (this.client.notification as any)({ method, params }, ANY_JSON_SCHEMA)
      : this.client.notification({ method, params } as any));
  }

  setRequestHandler(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
    if (this.connected) this.installRequestHandler(method, handler);
  }

  removeRequestHandler(method: string): void {
    this.requestHandlers.delete(method);
    // The official client intentionally has no remove method. Replacing the
    // handler with an explicit protocol error avoids leaving stale UI state.
    this.installRequestHandler(method, async () => {
      throw new Error(`No handler registered for ${method}`);
    });
  }

  async callTool(name: string, args: JSONRecord, options: CallOptions = {}): Promise<unknown> {
    this.markActive();
    const onProgress =
      options.onProgress ??
      (options.progressToken != null
        ? (params: JSONRecord) =>
            this.emit('progress', { progressToken: options.progressToken, ...params })
        : undefined);
    const params: CallToolRequestParams & JSONRecord = {
      name,
      arguments: args,
      ...(options.requestState ? { requestState: options.requestState } : {}),
      ...(options.inputResponses ? { inputResponses: options.inputResponses } : {}),
    } as CallToolRequestParams & JSONRecord;
    const result = await this.client.callTool(
      params as any,
      {
        ...sdkRequestOptions({ ...options, onProgress }),
        // Required for Beam’s manual input_required dialog path.
        allowInputRequired: true,
      } as any
    );
    return restorePhotonExtensions(result);
  }

  async listTools(): Promise<unknown[]> {
    this.markActive();
    const result = await this.client.listTools();
    return result.tools.map((tool) => restorePhotonExtensions(tool));
  }

  async listResources(): Promise<unknown[]> {
    this.markActive();
    const result = await this.client.listResources();
    return result.resources as unknown[];
  }

  async readResource(uri: string): Promise<unknown> {
    this.markActive();
    return this.client.readResource({ uri });
  }

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  private markActive(): void {
    if (!this.connected) {
      this.connected = true;
      this.emit(this.hadDisconnect ? 'reconnected' : 'connected');
      this.hadDisconnect = false;
    }
  }

  private isCustomMethod(method: string): boolean {
    return (
      !method.startsWith('notifications/') &&
      ![
        'initialize',
        'ping',
        'server/discover',
        'tools/list',
        'tools/call',
        'resources/list',
        'resources/read',
        'resources/templates/list',
        'resources/subscribe',
        'resources/unsubscribe',
        'prompts/list',
        'prompts/get',
        'completion/complete',
        'logging/setLevel',
        'sampling/createMessage',
        'elicitation/create',
        'roots/list',
      ].includes(method)
    );
  }

  private installRequestHandler(method: string, handler: RequestHandler): void {
    const callback = async (request: { params?: JSONRecord }) => handler(request?.params ?? {});
    if (this.isCustomMethod(method)) {
      (this.client.setRequestHandler as any)(method, ANY_JSON_SCHEMA, callback);
    } else {
      (this.client.setRequestHandler as any)(method, callback);
    }
  }

  private installNotificationBridge(): void {
    // Standard notifications have a typed request object. Photon’s existing
    // event API exposes only params, so keep that surface stable.
    for (const method of ['notifications/progress', 'notifications/tools/list_changed']) {
      (this.client.setNotificationHandler as any)(method, (notification: { params?: unknown }) => {
        this.emit(method, notification?.params);
      });
    }

    // Photon/Beam notifications are extension methods and require the
    // official SDK’s explicit custom-schema overload.
    for (const method of [
      'beam/photons',
      'beam/hot-reload',
      'beam/elicitation',
      'beam/elicitation-deferred',
      'beam/approval-resolved',
      'beam/result',
      'beam/configured',
      'beam/error',
      'beam/toast',
      'beam/thinking',
      'beam/log',
      'beam/render',
      'beam/canvas',
      'photon/board-update',
      'photon/channel-event',
      'photon/refresh-needed',
      'state-changed',
      'photon/notification',
      'ui/notifications/tool-result',
      'ui/notifications/tool-input',
      'ui/notifications/tool-input-partial',
    ]) {
      (this.client.setNotificationHandler as any)(method, ANY_JSON_SCHEMA, (params: unknown) => {
        this.emit(method, params);
      });
    }
  }

  private emitListChanged(method: string, error: Error | null, items: unknown[] | null): void {
    if (error) {
      this.emit('error', error);
      return;
    }
    this.emit(method, items);
  }

  private emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(data);
      } catch {
        // Event listeners are isolated from the protocol engine.
      }
    });
  }
}
