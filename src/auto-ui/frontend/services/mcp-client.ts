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
  'x-icon'?: string;
  'x-autorun'?: boolean;
  'x-output-format'?: string;
  'x-layout-hints'?: Record<string, string>;
  'x-button-label'?: string;
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
    properties: Record<string, {
      type: string;
      description?: string;
      default?: any;
      format?: string;      // 'password', 'path', 'email', 'uri', etc.
      writeOnly?: boolean;  // OpenAPI standard for sensitive fields
      'x-env-var'?: string; // Custom: maps to environment variable
    }>;
    required?: string[];
    'x-error-message'?: string;
  };
}

type MCPEventType = 'connect' | 'disconnect' | 'error' | 'tools-changed' | 'progress' | 'configuration-available';

class MCPClientService {
  private sessionId: string | null = null;
  private requestId = 0;
  private connected = false;
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventListeners = new Map<MCPEventType, Set<Function>>();
  private baseUrl: string;
  private _configurationSchema: ConfigurationSchema | null = null;

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
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {
        roots: { listChanged: false },
        sampling: {},
      },
      clientInfo: {
        name: 'beam-ui',
        version: '1.0.0',
      },
    }) as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
      configurationSchema?: ConfigurationSchema;
    };

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
      // SSE connected
    };

    this.eventSource.onmessage = (event) => {
      this.handleSSEMessage(event.data);
    };

    this.eventSource.onerror = () => {
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.handleSSEDisconnect();
      }
    };
  }

  /**
   * Handle SSE disconnect with reconnection
   */
  private handleSSEDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        if (this.connected) {
          this.openSSEStream();
        }
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      this.connected = false;
      this.emit('disconnect');
    }
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
   * Call a tool
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    progressToken?: string | number
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }> {
    const params: Record<string, unknown> = { name, arguments: args };

    if (progressToken !== undefined) {
      params._meta = { progressToken };
    }

    const result = (await this.sendRequest('tools/call', params)) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    return result;
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
   * Get configuration schema for unconfigured photons
   */
  getConfigurationSchema(): ConfigurationSchema | null {
    return this._configurationSchema;
  }

  /**
   * Check if a photon needs configuration
   */
  needsConfiguration(photonName: string): boolean {
    return !!this._configurationSchema?.[photonName];
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
        const errorText = result.content.find(c => c.type === 'text')?.text || 'Configuration failed';
        return { success: false, error: errorText };
      }

      // Clear configuration schema for this photon on success
      if (this._configurationSchema) {
        delete this._configurationSchema[photonName];
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
  ): Promise<{ path: string; parent: string; items: Array<{ name: string; path: string; isDirectory: boolean }> } | null> {
    try {
      const result = await this.callTool('beam/browse', { path, filter });

      if (result.isError) {
        return null;
      }

      const data = this.parseToolResult(result);
      return data as any;
    } catch {
      return null;
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
   */
  toolsToPhotons(tools: MCPTool[]): Array<{
    name: string;
    configured: boolean;
    methods: Array<{
      name: string;
      description: string;
      params: Record<string, unknown>;
      icon?: string;
      autorun?: boolean;
      outputFormat?: string;
      layoutHints?: Record<string, string>;
      buttonLabel?: string;
    }>;
  }> {
    const photonMap = new Map<string, any>();

    for (const tool of tools) {
      const slashIndex = tool.name.indexOf('/');
      if (slashIndex === -1) continue;

      const photonName = tool.name.slice(0, slashIndex);
      const methodName = tool.name.slice(slashIndex + 1);

      if (!photonMap.has(photonName)) {
        photonMap.set(photonName, {
          name: photonName,
          configured: true,
          methods: [],
        });
      }

      photonMap.get(photonName).methods.push({
        name: methodName,
        description: tool.description || '',
        params: tool.inputSchema || { type: 'object', properties: {} },
        icon: tool['x-icon'],
        autorun: tool['x-autorun'],
        outputFormat: tool['x-output-format'],
        layoutHints: tool['x-layout-hints'],
        buttonLabel: tool['x-button-label'],
      });
    }

    return Array.from(photonMap.values());
  }

  /**
   * Add event listener
   */
  on(event: MCPEventType, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(event: MCPEventType, callback: Function): void {
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
