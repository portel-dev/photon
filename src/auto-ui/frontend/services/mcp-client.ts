/**
 * MCP Client Service for Beam UI
 *
 * Delegates all wire-protocol work to MCPClientSDK (built on
 * `@modelcontextprotocol/sdk`'s StreamableHTTPClientTransport). This
 * class owns only app-level glue: auth state, queue-for-retry on
 * connection drop, Beam-specific notification fan-out, and
 * configurationSchema introspection from the initialize response.
 */

import { MCPClientSDK } from './mcp-client-sdk.js';
import { getGlobalSessionManager } from './photon-instance-manager.js';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  'x-photon-id'?: string;
  'x-icon'?: string;
  'x-autorun'?: boolean;
  'x-output-format'?: string;
  'x-layout-hints'?: Record<string, string>;
  'x-button-label'?: string;
  'x-webhook'?: string | boolean;
  'x-scheduled'?: string;
  'x-locked'?: string | boolean;
  'x-is-template'?: boolean;
  _meta?: { ui?: { resourceUri?: string; visibility?: string[] } };
}

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

/**
 * Configuration schema for unconfigured photons (SEP-1596 inspired).
 * Uses OpenAPI-compliant format values where possible.
 */
interface ConfigurationSchema {
  [photonName: string]: {
    title?: string;
    description?: string;
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        default?: any;
        format?: string;
        writeOnly?: boolean;
        'x-env-var'?: string;
      }
    >;
    required?: string[];
    'x-error-message'?: string;
    'x-configured'?: boolean;
  };
}

type MCPEventType =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'tools-changed'
  | 'progress'
  | 'configuration-available'
  | 'photons'
  | 'hot-reload'
  | 'elicitation'
  | 'elicitation-deferred'
  | 'approval-resolved'
  | 'board-update'
  | 'channel-event'
  | 'refresh-needed'
  | 'result'
  | 'configured'
  | 'notification'
  | 'operation-queued'
  | 'queue-processed'
  | 'ui-tool-result'
  | 'ui-tool-input'
  | 'ui-tool-input-partial'
  | 'state-changed'
  | 'reconnect'
  | 'auth-required'
  | 'auth-changed'
  | 'auth-error'
  | 'render'
  | 'canvas'
  | 'toast'
  | 'thinking'
  | 'log'
  | 'photon-notification';

// Pending operation for offline queue.
interface PendingOperation {
  id: number;
  name: string;
  args: Record<string, unknown>;
  progressToken?: string | number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Server-pushed notification methods → outer event names. Any method
 * not in this map falls through to a generic `notification` event.
 */
const NOTIFICATION_EVENT_MAP: Record<string, MCPEventType> = {
  'notifications/tools/list_changed': 'tools-changed',
  'notifications/progress': 'progress',
  'beam/photons': 'photons',
  'beam/hot-reload': 'hot-reload',
  'beam/elicitation': 'elicitation',
  'beam/elicitation-deferred': 'elicitation-deferred',
  'beam/approval-resolved': 'approval-resolved',
  'beam/result': 'result',
  'beam/configured': 'configured',
  'beam/error': 'error',
  'beam/toast': 'toast',
  'beam/thinking': 'thinking',
  'beam/log': 'log',
  'beam/render': 'render',
  'beam/canvas': 'canvas',
  'photon/board-update': 'board-update',
  'photon/channel-event': 'channel-event',
  'photon/refresh-needed': 'refresh-needed',
  'state-changed': 'state-changed',
  'photon/notification': 'photon-notification',
  'ui/notifications/tool-result': 'ui-tool-result',
  'ui/notifications/tool-input': 'ui-tool-input',
  'ui/notifications/tool-input-partial': 'ui-tool-input-partial',
};

class MCPClientService {
  private sdk: MCPClientSDK | null = null;
  private connected = false;
  private eventListeners = new Map<MCPEventType, Set<(data?: unknown) => void>>();
  private baseUrl: string;
  private _configurationSchema: ConfigurationSchema | null = null;
  private _serverVersion = '';

  // ═══ MCP OAuth Auth State ═══
  private _authToken: string | null = null;
  private _authRequired = false;
  private _resourceMetadataUrl: string | null = null;

  // ═══ Queue for Retry ═══
  private pendingOperations: PendingOperation[] = [];
  private nextOpId = 0;
  private retryTimer: number | null = null;
  private readonly MAX_QUEUE_AGE_MS = 30000;
  private readonly QUEUE_RETRY_INTERVAL_MS = 2000;

  // Registered server→client request handlers. Held here, not on the
  // SDK, so callers can register before the first connect() (the SDK
  // instance doesn't exist until then) and so handlers survive
  // reconnects (connect() throws away the old SDK and builds a fresh
  // one). The map is the source of truth; each new SDK gets a copy.
  private requestHandlers = new Map<string, (params: Record<string, unknown>) => unknown>();

  constructor() {
    this.baseUrl = `${window.location.protocol}//${window.location.host}/mcp`;
    this._authToken = localStorage.getItem('photon_auth_token');

    // Listen for token from OAuth popup callback.
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'photon-auth-token' && event.data.token) {
        this.setAuthToken(event.data.token);
        this.connect().catch(() => {});
      }
    });
  }

  // ═══ MCP OAuth Auth ═══

  get authRequired(): boolean {
    return this._authRequired;
  }

  get authToken(): string | null {
    return this._authToken;
  }

  setAuthToken(token: string): void {
    this._authToken = token;
    localStorage.setItem('photon_auth_token', token);
    this.emit('auth-changed', { authenticated: true });
  }

  clearAuthToken(): void {
    this._authToken = null;
    localStorage.removeItem('photon_auth_token');
    this.emit('auth-changed', { authenticated: false });
  }

  get isAuthenticated(): boolean {
    return !!this._authToken;
  }

  /**
   * Discover the OAuth authorization server from PRM metadata.
   * Returns authorization_servers URL(s) from
   * /.well-known/oauth-protected-resource.
   */
  async discoverAuthServer(): Promise<{
    authorizationServers?: string[];
    scopes?: string[];
  } | null> {
    if (!this._resourceMetadataUrl) return null;
    try {
      const res = await fetch(this._resourceMetadataUrl);
      if (!res.ok) return null;
      const prm = await res.json();
      return {
        authorizationServers: prm.authorization_servers,
        scopes: prm.scopes_supported,
      };
    } catch {
      return null;
    }
  }

  async startOAuthFlow(): Promise<void> {
    const discovery = await this.discoverAuthServer();
    if (!discovery?.authorizationServers?.length) {
      this.emit('auth-error', { message: 'No authorization server configured' });
      return;
    }
    this.emit('auth-required', {
      authorizationServers: discovery.authorizationServers,
      scopes: discovery.scopes,
      resourceMetadataUrl: this._resourceMetadataUrl,
    });
  }

  /**
   * fetch wrapper injected into the SDK transport. Captures
   * WWW-Authenticate → resource_metadata_url on 401 so startOAuthFlow()
   * has discovery info when we catch the subsequent 401 error.
   */
  private wrappedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return fetch(input, init).then((response) => {
      if (response.status === 401) {
        const wwwAuth = response.headers.get('WWW-Authenticate') || '';
        const metaMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
        if (metaMatch) {
          this._resourceMetadataUrl = metaMatch[1];
        }
        this._authRequired = true;
      }
      return response;
    });
  };

  /**
   * Connect to the MCP endpoint via Streamable HTTP. Initializes a new
   * SDK transport on each call; old one is torn down first.
   */
  async connect(): Promise<void> {
    // Tear down any previous SDK instance first — reconnect after login.
    if (this.sdk) {
      try {
        await this.sdk.disconnect();
      } catch {
        // best-effort
      }
      this.sdk = null;
    }

    this.sdk = new MCPClientSDK(this.baseUrl, {
      authToken: this._authToken ?? undefined,
      fetch: this.wrappedFetch,
    });

    this.wireSdkEvents(this.sdk);

    // Replay any handlers registered before this connect (or surviving
    // from a prior connection). Must happen before sdk.connect() so
    // the very first server→client request has somewhere to land.
    for (const [method, handler] of this.requestHandlers) {
      this.sdk.setRequestHandler(method, handler);
    }

    try {
      await this.sdk.connect();
      await this.initialize();
      this.connected = true;
      this.emit('connect');
      // Flush anything queued while disconnected.
      this.scheduleQueueRetry();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this._authRequired || message.includes('401')) {
        this._authRequired = true;
        await this.startOAuthFlow();
        this.emit('auth-required', { message: 'Authentication required' });
        return;
      }
      this.emit('error', error);
      throw error;
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.sdk) {
      void this.sdk.disconnect().catch(() => {});
      this.sdk = null;
    }
    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ═══ Session bootstrap ═══

  private async initialize(): Promise<void> {
    const sdk = this.sdk!;
    const result = await sdk.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {
        roots: { listChanged: false },
        // Beam answers `sampling/createMessage` by asking the human
        // at the browser — the person watching what AI is doing IS
        // the LLM. beam-app registers a handler via
        // `mcpClient.setRequestHandler('sampling/createMessage', ...)`
        // that opens a modal showing the prompt and returns the
        // user's typed response as the sampling result. Photons that
        // call `this.sample(...)` from a Beam-driven invocation
        // therefore route to the human, not a model API.
        sampling: {},
      },
      clientInfo: {
        name: 'beam',
        version: '1.0.0',
      },
    });

    if (result.serverInfo?.version) {
      this._serverVersion = result.serverInfo.version;
    }
    if (result.configurationSchema) {
      this._configurationSchema = result.configurationSchema;
      this.emit('configuration-available', this._configurationSchema);
    }

    await sdk.notify('notifications/initialized', {});
  }

  // ═══ Tool / Resource API ═══

  async listTools(): Promise<MCPTool[]> {
    const sdk = this.requireSdk();
    const result = await sdk.request('tools/list', {});
    return result.tools || [];
  }

  /**
   * Register a handler for a server→client request (e.g.
   * `sampling/createMessage`). Returns the handler's result as the
   * JSON-RPC response. Throwing surfaces as an error response.
   *
   * This is how Beam plays "human-in-the-loop LLM": when a photon
   * calls `this.sample(...)`, the server forwards the request here
   * and the handler (typically a modal) asks the person at the
   * browser for a response.
   */
  setRequestHandler(method: string, handler: (params: Record<string, unknown>) => unknown): void {
    this.requestHandlers.set(method, handler);
    // If we're already connected, wire it onto the live SDK too.
    // Otherwise connect() will replay it when it builds the SDK.
    this.sdk?.setRequestHandler(method, handler);
  }

  removeRequestHandler(method: string): void {
    this.requestHandlers.delete(method);
    this.sdk?.removeRequestHandler(method);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    progressToken?: string | number
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const sdk = this.requireSdk();
    try {
      return (await sdk.callTool(name, args, {
        progressToken,
      })) as {
        content: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
        isError?: boolean;
      };
    } catch (error) {
      if (this.isConnectionError(error)) {
        return this.queueOperation(name, args, progressToken);
      }
      throw error;
    }
  }

  async listResources(): Promise<MCPResource[]> {
    const sdk = this.requireSdk();
    const result = await sdk.request('resources/list', {});
    return result.resources || [];
  }

  async readResource(uri: string): Promise<MCPResourceContent | null> {
    const sdk = this.requireSdk();
    const result = await sdk.request('resources/read', { uri });
    return result.contents?.[0] || null;
  }

  async notifyViewing(photonId: string, itemId: string): Promise<void> {
    if (!this.connected || !this.sdk) return;
    await this.sdk.notify('beam/viewing', { photonId, itemId });
  }

  // ═══ Config / server metadata ═══

  getServerVersion(): string {
    return this._serverVersion;
  }

  getConfigurationSchema(): ConfigurationSchema | null {
    return this._configurationSchema;
  }

  needsConfiguration(photonName: string): boolean {
    const entry = this._configurationSchema?.[photonName];
    return !!entry && !entry['x-configured'];
  }

  // ═══ Beam helpers (thin wrappers over callTool) ═══

  async configurePhoton(
    photonName: string,
    config: Record<string, string>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/configure', {
        photon: photonName,
        config,
      });
      if (result.isError) {
        const errorText =
          result.content.find((c) => c.type === 'text')?.text || 'Configuration failed';
        return { success: false, error: errorText };
      }
      if (this._configurationSchema?.[photonName]) {
        this._configurationSchema[photonName]['x-configured'] = true;
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async browseFilesystem(
    path?: string,
    filter?: string
  ): Promise<{
    path: string;
    parent: string;
    items: Array<{ name: string; path: string; isDirectory: boolean }>;
  } | null> {
    try {
      const result = await this.callTool('beam/browse', { path, filter });
      if (result.isError) return null;
      return this.parseToolResult(result) as any;
    } catch {
      return null;
    }
  }

  async reloadPhoton(photonName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/reload', { photon: photonName });
      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Reload failed';
        return { success: false, error: errorText };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async removePhoton(photonName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/remove', { photon: photonName });
      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Remove failed';
        return { success: false, error: errorText };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async sendElicitationResponse(
    elicitationId: string,
    value: any,
    cancelled = false
  ): Promise<{ success: boolean }> {
    try {
      const sdk = this.requireSdk();
      await sdk.request('beam/elicitation-response', {
        elicitationId,
        value,
        cancelled,
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async sendApprovalResponse(
    approvalId: string,
    photon: string,
    approved: boolean
  ): Promise<{ success: boolean }> {
    try {
      const sdk = this.requireSdk();
      await sdk.request('beam/approval-response', {
        approvalId,
        photon,
        approved,
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async fetchPendingApprovals(): Promise<any[]> {
    try {
      const sdk = this.requireSdk();
      const result = await sdk.request('beam/approvals-list', {});
      return (result as any)?.approvals || [];
    } catch {
      return [];
    }
  }

  async getPhotonHelp(photonName: string): Promise<string | null> {
    try {
      const result = await this.callTool('beam/photon-help', { photon: photonName });
      if (result.isError) return null;
      return result.content.find((c) => c.type === 'text')?.text || null;
    } catch {
      return null;
    }
  }

  async updateMetadata(
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { photon: photonName, metadata };
      if (methodName) args.method = methodName;
      const result = await this.callTool('beam/update-metadata', args);
      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Update failed';
        return { success: false, error: errorText };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async reconnectMCP(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/reconnect-mcp', { name });
      const text = result.content?.[0]?.text || '';
      return {
        success: !result.isError,
        error: result.isError ? text : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
    if (result.content && result.content.length > 0) {
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent?.text) {
        try {
          return JSON.parse(textContent.text);
        } catch {
          return textContent.text;
        }
      }
    }
    return null;
  }

  toolsToPhotons(tools: MCPTool[]): {
    photons: Array<{
      id: string;
      name: string;
      configured: boolean;
      isApp?: boolean;
      appEntry?: any;
      path?: string;
      description?: string;
      icon?: string;
      internal?: boolean;
      promptCount?: number;
      resourceCount?: number;
      methods: Array<{
        name: string;
        description: string;
        params: Record<string, unknown>;
        icon?: string;
        autorun?: boolean;
        outputFormat?: string;
        layoutHints?: Record<string, string>;
        buttonLabel?: string;
        linkedUi?: string;
        webhook?: string | boolean;
        scheduled?: string;
        locked?: string | boolean;
      }>;
    }>;
    externalMCPs: Array<{
      id: string;
      name: string;
      description?: string;
      icon?: string;
      promptCount?: number;
      resourceCount?: number;
      connected: boolean;
      isExternalMCP: true;
      methods: Array<{
        name: string;
        description: string;
        params: Record<string, unknown>;
        icon?: string;
      }>;
    }>;
  } {
    const photonMap = new Map<string, any>();
    const externalMCPMap = new Map<string, any>();

    for (const tool of tools) {
      const slashIndex = tool.name.indexOf('/');
      if (slashIndex === -1) continue;

      const serverName = tool.name.slice(0, slashIndex);
      const methodName = tool.name.slice(slashIndex + 1);
      const isExternalMCP = !!(tool as any)['x-external-mcp'];

      if (isExternalMCP) {
        if (!externalMCPMap.has(serverName)) {
          externalMCPMap.set(serverName, {
            id: (tool as any)['x-external-mcp-id'] || serverName,
            name: serverName,
            description: (tool as any)['x-photon-description'],
            icon: (tool as any)['x-photon-icon'] || '🔌',
            promptCount: (tool as any)['x-photon-prompt-count'] || 0,
            resourceCount: (tool as any)['x-photon-resource-count'] || 0,
            connected: true,
            isExternalMCP: true,
            hasMcpApp: (tool as any)['x-has-mcp-app'] || false,
            mcpAppUri: (tool as any)['x-mcp-app-uri'],
            mcpAppUris: (tool as any)['x-mcp-app-uris'] || [],
            methods: [],
          });
        }
        externalMCPMap.get(serverName).methods.push({
          name: methodName,
          description: tool.description || '',
          params: tool.inputSchema || { type: 'object', properties: {} },
          icon: tool['x-icon'],
          linkedUi: tool._meta?.ui?.resourceUri?.match(/^ui:\/\/[^/]+\/(.+)$/)?.[1],
          visibility: tool._meta?.ui?.visibility,
        });
      } else {
        if (!photonMap.has(serverName)) {
          photonMap.set(serverName, {
            id: tool['x-photon-id'] || serverName,
            name: serverName,
            shortName: (tool as any)['x-photon-short-name'],
            namespace: (tool as any)['x-photon-namespace'],
            qualifiedName: (tool as any)['x-photon-qualified-name'],
            path: (tool as any)['x-photon-path'],
            editable: (tool as any)['x-photon-editable'] ?? false,
            description: (tool as any)['x-photon-description'],
            icon: (tool as any)['x-photon-icon'],
            internal: (tool as any)['x-photon-internal'],
            stateful: (tool as any)['x-photon-stateful'] || false,
            hasSettings: (tool as any)['x-photon-has-settings'] || false,
            requiredParams: (tool as any)['x-photon-required-params'] || [],
            installSource: (tool as any)['x-photon-install-source'],
            promptCount: (tool as any)['x-photon-prompt-count'] || 0,
            resourceCount: (tool as any)['x-photon-resource-count'] || 0,
            configured: true,
            methods: [],
          });
        }
        // Skip internal runtime tools (_use, _instances, _undo, _redo).
        if (!methodName.startsWith('_')) {
          photonMap.get(serverName).methods.push({
            name: methodName,
            description: tool.description || '',
            params: tool.inputSchema || { type: 'object', properties: {} },
            icon: tool['x-icon'],
            autorun: tool['x-autorun'],
            outputFormat: tool['x-output-format'],
            layoutHints: tool['x-layout-hints'],
            buttonLabel: tool['x-button-label'],
            linkedUi: tool._meta?.ui?.resourceUri?.match(/^ui:\/\/[^/]+\/(.+)$/)?.[1],
            visibility: tool._meta?.ui?.visibility,
            webhook: tool['x-webhook'],
            scheduled: tool['x-scheduled'],
            locked: tool['x-locked'],
            ...(tool['x-is-template'] ? { isTemplate: true } : {}),
          });
        }
      }
    }

    for (const photon of photonMap.values()) {
      const mainMethod = photon.methods.find((m: any) => m.name === 'main');
      if (mainMethod) {
        photon.isApp = true;
        photon.appEntry = mainMethod;
      }
    }

    return {
      photons: Array.from(photonMap.values()),
      externalMCPs: Array.from(externalMCPMap.values()),
    };
  }

  // ═══ Event API ═══

  on(event: MCPEventType, callback: (data?: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: MCPEventType, callback: (data?: unknown) => void): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: MCPEventType, data?: unknown): void {
    this.eventListeners.get(event)?.forEach((callback) => callback(data));
  }

  // ═══ SDK event wiring ═══

  private wireSdkEvents(sdk: MCPClientSDK): void {
    // Protocol connect/disconnect/error from transport.
    sdk.on('disconnected', () => {
      if (!this.connected) return;
      this.connected = false;
      this.emit('disconnect');
    });
    sdk.on('reconnected', () => {
      // SDK recovered after a dropped SSE stream (daemon restart,
      // network blip). Flip our own `connected` flag back on and
      // surface as `reconnect` — beam-app listens on this to re-pick
      // the active stateful instance and refresh tools. Without this
      // forward, the UI would stay visually fine (SDK transparently
      // reconnects) but with stale state frozen from before the drop.
      if (this.connected) return;
      this.connected = true;
      this.emit('reconnect');
    });
    sdk.on('error', (err) => {
      this.emit('error', err);
    });

    // Map known server notifications → outer events. The SDK emits an
    // event for every incoming notification method; forward listed ones
    // under their existing MCPEventType names, plus special-case
    // `state-changed` to apply patches to the global session manager.
    for (const [method, outerEvent] of Object.entries(NOTIFICATION_EVENT_MAP)) {
      if (method === 'state-changed') continue;
      sdk.on(method, (params) => {
        this.emit(outerEvent, params);
      });
    }

    sdk.on('state-changed', (params) => {
      const p = params as { instance?: string; patches?: any[] } | undefined;
      if (p?.instance && p?.patches) {
        try {
          const manager = getGlobalSessionManager();
          manager.applyPatches(p.instance, p.patches);
        } catch (error) {
          console.error('Failed to apply patches to session', error);
        }
      }
      this.emit('state-changed', params);
    });
  }

  // ═══ Queue-for-retry ═══

  private isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('connection') ||
        msg.includes('timeout') ||
        msg.includes('failed to fetch') ||
        msg.includes('streamable http error')
      );
    }
    return false;
  }

  private queueOperation(
    name: string,
    args: Record<string, unknown>,
    progressToken?: string | number
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const op: PendingOperation = {
        id: ++this.nextOpId,
        name,
        args,
        progressToken,
        resolve,
        reject,
        timestamp: Date.now(),
      };
      this.pendingOperations.push(op);
      this.emit('operation-queued', {
        count: this.pendingOperations.length,
        name,
        args,
      });
      this.scheduleQueueRetry();
    });
  }

  private scheduleQueueRetry(): void {
    if (this.retryTimer !== null) return;
    if (this.pendingOperations.length === 0) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.processQueue();
    }, this.QUEUE_RETRY_INTERVAL_MS);
  }

  private async processQueue(): Promise<void> {
    if (!this.sdk) {
      this.scheduleQueueRetry();
      return;
    }
    const now = Date.now();

    // Expire stale operations up-front.
    this.pendingOperations = this.pendingOperations.filter((op) => {
      if (now - op.timestamp > this.MAX_QUEUE_AGE_MS) {
        op.reject(new Error('Operation expired'));
        return false;
      }
      return true;
    });

    while (this.pendingOperations.length > 0) {
      const op = this.pendingOperations[0];
      try {
        const result = await this.sdk.callTool(op.name, op.args, {
          progressToken: op.progressToken,
        });
        this.pendingOperations.shift();
        op.resolve(result);
      } catch (error) {
        if (this.isConnectionError(error) && Date.now() - op.timestamp < this.MAX_QUEUE_AGE_MS) {
          // Still offline; come back later.
          this.scheduleQueueRetry();
          return;
        }
        this.pendingOperations.shift();
        op.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.emit('queue-processed', { remaining: 0 });
  }

  // ═══ Internal ═══

  private requireSdk(): MCPClientSDK {
    if (!this.sdk) throw new Error('MCP client not connected');
    return this.sdk;
  }
}

// Singleton instance
export const mcpClient = new MCPClientService();
