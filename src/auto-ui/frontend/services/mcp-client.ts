/**
 * MCP Client Service for Beam UI
 *
 * Pure Streamable HTTP transport implementation (2025-03-26 spec).
 * Uses POST for requests and SSE for server notifications.
 * No WebSocket - acts like a standard external MCP client.
 */

type JSONRPCMessage = {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

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
 * Configuration schema for unconfigured photons (SEP-1596 inspired)
 * Uses OpenAPI-compliant format values where possible
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
        format?: string; // 'password', 'path', 'email', 'uri', etc.
        writeOnly?: boolean; // OpenAPI standard for sensitive fields
        'x-env-var'?: string; // Custom: maps to environment variable
      }
    >;
    required?: string[];
    'x-error-message'?: string;
  };
}

type MCPEventType =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'tools-changed'
  | 'progress'
  | 'configuration-available'
  | 'photons' // Photon list changed
  | 'hot-reload' // File changed, photon reloaded
  | 'elicitation' // User input needed
  | 'board-update' // Kanban board update (legacy, triggers refresh)
  | 'channel-event' // Specific event with delta (task-moved, task-updated, etc.)
  | 'refresh-needed' // Server signals stale client, full sync required
  | 'result' // Tool execution result
  | 'configured' // Photon configuration complete
  | 'notification' // Generic notification
  | 'operation-queued' // Operation queued for retry
  | 'queue-processed' // Queued operations processed
  | 'ui-tool-result' // MCP Apps: tool result notification
  | 'ui-tool-input' // MCP Apps: tool input notification
  | 'ui-tool-input-partial' // MCP Apps: partial tool input (streaming)
  | 'state-changed' // Stateful photon state changed (via daemon)
  | 'reconnect'; // SSE reconnected after disconnect

// Pending operation for offline queue
interface PendingOperation {
  id: number;
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

class MCPClientService {
  private sessionId: string | null = null;
  private requestId = 0;
  private connected = false;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity; // Infinite retries by default, can be set to 0 to disable
  private reconnectDelay = 1000;
  private readonly MAX_RECONNECT_DELAY_MS = 30000; // Cap backoff at 30s
  private eventListeners = new Map<MCPEventType, Set<(data?: unknown) => void>>();
  private baseUrl: string;
  private _configurationSchema: ConfigurationSchema | null = null;
  private _serverVersion = '';
  private lastMessageTime = 0;
  private heartbeatInterval: number | null = null;
  private visibilityHandler: (() => void) | null = null;
  private readonly HEARTBEAT_TIMEOUT_MS = 45000; // 45s - server sends keepalive every 15s (3x interval)
  private pendingOperations: PendingOperation[] = [];
  private isProcessingQueue = false;
  private readonly MAX_QUEUE_AGE_MS = 30000; // Discard operations older than 30s

  constructor() {
    this.baseUrl = `${window.location.protocol}//${window.location.host}/mcp`;
  }

  /**
   * Connect to the MCP endpoint via Streamable HTTP
   */
  async connect(): Promise<void> {
    try {
      // Initialize session via POST
      await this.initialize();

      // Open SSE stream for server notifications
      this.openSSEStream();

      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connect');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Disconnect from the MCP endpoint
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0;
    this.stopHeartbeatCheck();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
    this.sessionId = null;
    this.emit('disconnect');
  }

  /**
   * Initialize MCP session
   */
  private async initialize(): Promise<void> {
    const result = (await this.sendRequest('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {
        roots: { listChanged: false },
        sampling: {},
      },
      clientInfo: {
        name: 'beam', // Identifies as Beam client for server-side notifications
        version: '1.0.0',
      },
    })) as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
      configurationSchema?: ConfigurationSchema;
    };

    // Capture server version for runtime tag completions
    if (result.serverInfo?.version) {
      this._serverVersion = result.serverInfo.version;
    }

    // Capture configuration schema for unconfigured photons
    if (result.configurationSchema) {
      this._configurationSchema = result.configurationSchema;
      this.emit('configuration-available', this._configurationSchema);
    }

    // Send initialized notification
    await this.sendNotification('notifications/initialized', {});
  }

  /**
   * Open SSE stream for server-to-client notifications
   */
  private openSSEStream(): void {
    // Build URL with session ID if available
    let sseUrl = this.baseUrl;
    if (this.sessionId) {
      sseUrl += `?sessionId=${encodeURIComponent(this.sessionId)}`;
    }

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onopen = () => {
      // SSE connected - check if this is a reconnection
      const wasDisconnected = this.reconnectAttempts > 0;
      this.reconnectAttempts = 0;
      this.connected = true;
      this.lastMessageTime = Date.now();
      this.startHeartbeatCheck();
      // Process any queued operations
      this.processQueue();
      // Notify listeners if we recovered from a disconnect
      if (wasDisconnected) {
        this.emit('reconnect');
      }
    };

    this.eventSource.onmessage = (event) => {
      this.lastMessageTime = Date.now();
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'keepalive') {
          return; // Don't process keepalives further
        }
      } catch {
        // Not JSON or not a keepalive, continue normal processing
      }
      this.handleSSEMessage(event.data);
    };

    this.eventSource.onerror = () => {
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.handleSSEDisconnect();
      }
    };
  }

  /**
   * Start heartbeat check to detect stale connections
   * Only polls when tab is visible - stops when hidden to save resources
   */
  private startHeartbeatCheck(): void {
    this.stopHeartbeatCheck();

    // Check for stale connection
    const checkStale = () => {
      const elapsed = Date.now() - this.lastMessageTime;
      if (elapsed > this.HEARTBEAT_TIMEOUT_MS && this.connected) {
        console.warn('[MCP] Connection stale, reconnecting...');
        this.handleSSEDisconnect();
      }
    };

    // Start/stop polling based on visibility
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible - check immediately and start polling
        checkStale();
        if (!this.heartbeatInterval) {
          this.heartbeatInterval = window.setInterval(checkStale, 15000);
        }
      } else {
        // Tab hidden - stop polling to save resources
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
      }
    };

    this.visibilityHandler = handleVisibility;
    document.addEventListener('visibilitychange', handleVisibility);

    // Start polling if currently visible
    if (document.visibilityState === 'visible') {
      this.heartbeatInterval = window.setInterval(checkStale, 15000);
    }
  }

  /**
   * Stop heartbeat check
   */
  private stopHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /**
   * Handle SSE disconnect with reconnection
   */
  private handleSSEDisconnect(): void {
    this.stopHeartbeatCheck();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.reconnectAttempts++;

    // Check if we should stop reconnecting
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.connected = false;
      this.emit('disconnect');
      console.warn('[MCP] Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.MAX_RECONNECT_DELAY_MS
    );

    // Emit disconnect after first failure so UI can show status
    if (this.reconnectAttempts === 1) {
      this.emit('disconnect');
    }

    setTimeout(() => {
      this.openSSEStream();
    }, delay);
  }

  /**
   * Handle incoming SSE message
   */
  private handleSSEMessage(data: string): void {
    try {
      const message = JSON.parse(data) as JSONRPCMessage;

      // Server notifications come through SSE
      if (message.method && message.id === undefined) {
        this.handleNotification(message);
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPTool[]> {
    const result = (await this.sendRequest('tools/list', {})) as { tools: MCPTool[] };
    return result.tools || [];
  }

  /**
   * Call a tool - queues operation if connection fails
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    progressToken?: string | number
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const params: Record<string, unknown> = { name, arguments: args };

    if (progressToken !== undefined) {
      params._meta = { progressToken };
    }

    try {
      const result = (await this.sendRequest('tools/call', params)) as {
        content: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
        isError?: boolean;
      };
      return result;
    } catch (error) {
      // Queue the operation for retry if it's a connection error
      if (this.isConnectionError(error)) {
        return this.queueOperation('tools/call', params);
      }
      throw error;
    }
  }

  /**
   * Check if error is a connection-related error
   */
  private isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('connection') ||
        msg.includes('timeout') ||
        msg.includes('http error: 0') ||
        msg.includes('failed to fetch')
      );
    }
    return false;
  }

  /**
   * Queue an operation for retry when connection is restored
   */
  private queueOperation(
    method: string,
    params: Record<string, unknown>
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const operation: PendingOperation = {
        id: ++this.requestId,
        method,
        params,
        resolve,
        reject,
        timestamp: Date.now(),
      };
      this.pendingOperations.push(operation);
      console.log(`[MCP] Operation queued (${this.pendingOperations.length} pending)`);
      this.emit('operation-queued', { count: this.pendingOperations.length, method, params });
    });
  }

  /**
   * Process queued operations after reconnection
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.pendingOperations.length === 0) return;

    this.isProcessingQueue = true;
    const now = Date.now();

    // Filter out stale operations
    this.pendingOperations = this.pendingOperations.filter((op) => {
      if (now - op.timestamp > this.MAX_QUEUE_AGE_MS) {
        op.reject(new Error('Operation expired'));
        return false;
      }
      return true;
    });

    console.log(`[MCP] Processing ${this.pendingOperations.length} queued operations`);

    while (this.pendingOperations.length > 0) {
      const operation = this.pendingOperations.shift()!;
      try {
        const result = await this.sendRequest(operation.method, operation.params);
        operation.resolve(result);
      } catch (error) {
        // If still failing, re-queue if not too old
        if (this.isConnectionError(error) && now - operation.timestamp < this.MAX_QUEUE_AGE_MS) {
          this.pendingOperations.unshift(operation);
          break; // Stop processing, wait for next reconnect
        }
        operation.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isProcessingQueue = false;
    this.emit('queue-processed', { remaining: this.pendingOperations.length });
  }

  /**
   * List available resources (MCP Apps Extension - ui:// scheme)
   */
  async listResources(): Promise<MCPResource[]> {
    const result = (await this.sendRequest('resources/list', {})) as { resources: MCPResource[] };
    return result.resources || [];
  }

  /**
   * Read a resource by URI (MCP Apps Extension - ui:// scheme)
   */
  async readResource(uri: string): Promise<MCPResourceContent | null> {
    const result = (await this.sendRequest('resources/read', { uri })) as {
      contents: MCPResourceContent[];
    };
    return result.contents?.[0] || null;
  }

  /**
   * Get the photon runtime version reported by the server
   */
  getServerVersion(): string {
    return this._serverVersion;
  }

  /**
   * Get configuration schema for unconfigured photons
   */
  getConfigurationSchema(): ConfigurationSchema | null {
    return this._configurationSchema;
  }

  /**
   * Check if a photon needs configuration
   */
  needsConfiguration(photonName: string): boolean {
    const entry = this._configurationSchema?.[photonName];
    return !!entry && !entry['x-configured'];
  }

  /**
   * Configure a photon via beam/configure tool
   */
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

      // Mark as configured (keep schema for reconfiguration)
      if (this._configurationSchema?.[photonName]) {
        this._configurationSchema[photonName]['x-configured'] = true;
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Browse server filesystem via beam/browse tool
   */
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

      if (result.isError) {
        return null;
      }

      const data = this.parseToolResult(result);
      return data as any;
    } catch {
      return null; // tool call failed
    }
  }

  /**
   * Reload a photon via beam/reload tool
   */
  async reloadPhoton(photonName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/reload', { photon: photonName });

      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Reload failed';
        return { success: false, error: errorText };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Remove a photon via beam/remove tool
   */
  async removePhoton(photonName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.callTool('beam/remove', { photon: photonName });

      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Remove failed';
        return { success: false, error: errorText };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Send elicitation response back to server
   */
  async sendElicitationResponse(
    elicitationId: string,
    value: any,
    cancelled = false
  ): Promise<{ success: boolean }> {
    try {
      await this.sendRequest('beam/elicitation-response', {
        elicitationId,
        value,
        cancelled,
      });
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  /**
   * Get rich help documentation for a photon via beam/photon-help tool
   */
  async getPhotonHelp(photonName: string): Promise<string | null> {
    try {
      const result = await this.callTool('beam/photon-help', { photon: photonName });

      if (result.isError) {
        return null;
      }

      const textContent = result.content.find((c) => c.type === 'text');
      return textContent?.text || null;
    } catch {
      return null; // tool call failed
    }
  }

  /**
   * Update photon or method metadata via beam/update-metadata tool
   */
  async updateMetadata(
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { photon: photonName, metadata };
      if (methodName) {
        args.method = methodName;
      }

      const result = await this.callTool('beam/update-metadata', args);

      if (result.isError) {
        const errorText = result.content.find((c) => c.type === 'text')?.text || 'Update failed';
        return { success: false, error: errorText };
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Parse tool result content to data
   */
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

  /**
   * Convert MCP tools to photons format
   * Returns { photons, externalMCPs } with external MCPs separated
   */
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

      // Check if this is an external MCP tool
      const isExternalMCP = !!(tool as any)['x-external-mcp'];

      if (isExternalMCP) {
        // Handle external MCP
        if (!externalMCPMap.has(serverName)) {
          externalMCPMap.set(serverName, {
            id: (tool as any)['x-external-mcp-id'] || serverName,
            name: serverName,
            description: tool['x-photon-description'],
            icon: tool['x-photon-icon'] || '🔌',
            promptCount: tool['x-photon-prompt-count'] || 0,
            resourceCount: tool['x-photon-resource-count'] || 0,
            connected: true,
            isExternalMCP: true,
            hasMcpApp: tool['x-has-mcp-app'] || false,
            mcpAppUri: tool['x-mcp-app-uri'],
            mcpAppUris: tool['x-mcp-app-uris'] || [],
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
        // Handle regular photon
        if (!photonMap.has(serverName)) {
          photonMap.set(serverName, {
            id: tool['x-photon-id'] || serverName, // Use hash ID, fallback to name
            name: serverName,
            path: tool['x-photon-path'], // File path for View Source
            description: tool['x-photon-description'],
            icon: tool['x-photon-icon'],
            internal: tool['x-photon-internal'],
            stateful: tool['x-photon-stateful'] || false,
            promptCount: tool['x-photon-prompt-count'] || 0,
            resourceCount: tool['x-photon-resource-count'] || 0,
            configured: true,
            methods: [],
          });
        }

        // Skip internal runtime tools (_use, _instances) — they are not user-facing methods
        if (!tool['x-photon-internal']) {
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

    // Post-process: set isApp and appEntry for photons with main() + linkedUi
    for (const photon of photonMap.values()) {
      const mainMethod = photon.methods.find((m: any) => m.name === 'main' && m.linkedUi);
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

  /**
   * Reconnect a disconnected external MCP
   */
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

  /**
   * Add event listener
   */
  on(event: MCPEventType, callback: (data?: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(event: MCPEventType, callback: (data?: unknown) => void): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Emit event
   */
  private emit(event: MCPEventType, data?: unknown): void {
    this.eventListeners.get(event)?.forEach((callback) => callback(data));
  }

  /**
   * Send JSON-RPC request via HTTP POST
   */
  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const request: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Include session ID if we have one
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60000), // 60s for MCP method calls
    });

    // Capture session ID from response
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as JSONRPCMessage;

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result;
  }

  /**
   * Notify server that client is viewing a resource (for on-demand subscriptions)
   * @param photonId - Hash of photon path (unique across servers)
   * @param itemId - Whatever the photon uses to identify the item (e.g., board name)
   */
  async notifyViewing(photonId: string, itemId: string): Promise<void> {
    if (!this.connected) return;
    await this.sendNotification('beam/viewing', { photonId, itemId });
  }

  /**
   * Send JSON-RPC notification via HTTP POST
   */
  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const notification: JSONRPCMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(10000), // 10s for notifications
    });
  }

  /**
   * Handle notification
   */
  private handleNotification(notification: JSONRPCMessage): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        this.emit('tools-changed');
        break;

      case 'notifications/progress':
        if (notification.params) {
          this.emit('progress', notification.params as ProgressNotification);
        }
        break;

      // Beam-specific notifications
      case 'beam/photons':
        this.emit('photons', notification.params);
        break;

      case 'beam/hot-reload':
        this.emit('hot-reload', notification.params);
        break;

      case 'beam/elicitation':
        this.emit('elicitation', notification.params);
        break;

      case 'beam/result':
        this.emit('result', notification.params);
        break;

      case 'beam/configured':
        this.emit('configured', notification.params);
        break;

      case 'beam/error':
        this.emit('error', notification.params);
        break;

      case 'beam/toast':
        this.emit('toast', notification.params);
        break;

      case 'beam/thinking':
        this.emit('thinking', notification.params);
        break;

      case 'beam/log':
        this.emit('log', notification.params);
        break;

      case 'photon/board-update':
        this.emit('board-update', notification.params);
        break;

      case 'photon/channel-event':
        this.emit('channel-event', notification.params);
        break;

      case 'photon/refresh-needed':
        this.emit('refresh-needed', notification.params);
        break;

      case 'photon/state-changed':
        this.emit('state-changed', notification.params);
        break;

      // MCP Apps standard notifications
      case 'ui/notifications/tool-result':
        this.emit('ui-tool-result', notification.params);
        break;

      case 'ui/notifications/tool-input':
        this.emit('ui-tool-input', notification.params);
        break;

      case 'ui/notifications/tool-input-partial':
        this.emit('ui-tool-input-partial', notification.params);
        break;

      default:
        // Emit generic notification for unknown methods
        this.emit('notification', notification);
        break;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

// Singleton instance
export const mcpClient = new MCPClientService();
