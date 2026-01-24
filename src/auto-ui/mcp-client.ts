/**
 * MCP Client for Beam UI
 *
 * Browser-compatible MCP client that communicates with Beam's MCP WebSocket endpoint.
 * Implements the client-side of the MCP protocol for tool discovery and invocation.
 */

/// <reference lib="dom" />

/**
 * JSON-RPC 2.0 message types
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

/**
 * MCP Tool definition
 */
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  // UI extensions
  'x-icon'?: string;
  'x-autorun'?: boolean;
  'x-output-format'?: string;
  'x-layout-hints'?: Record<string, string>;
  'x-button-label'?: string;
}

/**
 * MCP content types
 */
interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

type MCPContent = TextContent | ImageContent;

/**
 * MCP Resource definition (ui:// scheme for MCP Apps)
 */
interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

/**
 * MCP Resource content
 */
interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

/**
 * Progress notification data
 */
interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

/**
 * MCP Client for Beam UI
 */
export class BeamMCPClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  // Event handlers
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onToolsChanged?: () => void;
  onProgress?: (data: ProgressNotification) => void;
  onElicitation?: (
    requestId: string | number,
    schema: Record<string, unknown>,
    message?: string
  ) => void;

  private url: string;

  constructor(url?: string) {
    // Default to same host with /mcp path
    this.url =
      url ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/mcp`;
  }

  /**
   * Connect to the MCP WebSocket endpoint
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = async () => {
          this.connected = true;
          this.reconnectAttempts = 0;

          try {
            // Initialize MCP session
            await this.initialize();
            this.onConnect?.();
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.onDisconnect?.();

          // Attempt reconnection
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.ws.onerror = (event) => {
          const error = new Error('WebSocket error');
          this.onError?.(error);
          if (!this.connected) {
            reject(error);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the MCP endpoint
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent auto-reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Initialize MCP session
   */
  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
        sampling: {},
      },
      clientInfo: {
        name: 'beam-ui',
        version: '1.0.0',
      },
    });

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});
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
  ): Promise<{ content: MCPContent[]; isError?: boolean }> {
    const params: Record<string, unknown> = { name, arguments: args };

    if (progressToken !== undefined) {
      params._meta = { progressToken };
    }

    const result = (await this.sendRequest('tools/call', params)) as {
      content: MCPContent[];
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
   * Respond to an elicitation (sampling) request
   */
  respondToElicitation(requestId: string | number, value: unknown): void {
    // Send response to pending sampling request
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: requestId,
      result: value,
    };
    this.ws?.send(JSON.stringify(response));
  }

  /**
   * Cancel an elicitation request
   */
  cancelElicitation(requestId: string | number): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32000,
        message: 'User cancelled',
      },
    };
    this.ws?.send(JSON.stringify(response));
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.ws.send(JSON.stringify(request));
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.ws.send(JSON.stringify(notification));
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as JSONRPCMessage;

      // Check if it's a response (has id and result/error)
      if ('id' in message && ('result' in message || 'error' in message)) {
        const response = message as JSONRPCResponse;
        const pending = this.pendingRequests.get(response.id);

        if (pending) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
        return;
      }

      // Check if it's a notification (has method but no id)
      if ('method' in message && !('id' in message)) {
        const notification = message as JSONRPCNotification;
        this.handleNotification(notification);
        return;
      }

      // Check if it's a request (has method and id) - e.g., sampling request
      if ('method' in message && 'id' in message) {
        const request = message as JSONRPCRequest;
        this.handleRequest(request);
        return;
      }
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle incoming notifications from server
   */
  private handleNotification(notification: JSONRPCNotification): void {
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        this.onToolsChanged?.();
        break;

      case 'notifications/progress':
        if (notification.params) {
          this.onProgress?.(notification.params as unknown as ProgressNotification);
        }
        break;

      default:
        // Unknown notification - ignore
        break;
    }
  }

  /**
   * Handle incoming requests from server (e.g., sampling/elicitation)
   */
  private handleRequest(request: JSONRPCRequest): void {
    switch (request.method) {
      case 'sampling/createMessage':
        // Elicitation request - server is asking for user input
        if (request.params) {
          const schema = (request.params.schema as Record<string, unknown>) || {};
          const message = request.params.message as string | undefined;
          this.onElicitation?.(request.id, schema, message);
        }
        break;

      default:
        // Unknown request - send error response
        const response: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        };
        this.ws?.send(JSON.stringify(response));
        break;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Generate browser-compatible MCP client script
 */
export function generateMCPClientJS(): string {
  // Return minified version of the client class for browser embedding
  return `
// MCP Client for Beam UI
class BeamMCPClient {
  constructor(url) {
    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.url = url || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/mcp';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = async () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          try {
            await this.initialize();
            if (this.onConnect) this.onConnect();
            resolve();
          } catch (e) { reject(e); }
        };
        this.ws.onclose = () => {
          this.connected = false;
          if (this.onDisconnect) this.onDisconnect();
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
          }
        };
        this.ws.onerror = () => {
          const e = new Error('WebSocket error');
          if (this.onError) this.onError(e);
          if (!this.connected) reject(e);
        };
        this.ws.onmessage = (e) => this.handleMessage(e.data);
      } catch (e) { reject(e); }
    });
  }

  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
  }

  async initialize() {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false }, sampling: {} },
      clientInfo: { name: 'beam-ui', version: '1.0.0' }
    });
    this.sendNotification('notifications/initialized', {});
  }

  async listTools() {
    const r = await this.sendRequest('tools/list', {});
    return r.tools || [];
  }

  async callTool(name, args, progressToken) {
    const params = { name, arguments: args };
    if (progressToken !== undefined) params._meta = { progressToken };
    return await this.sendRequest('tools/call', params);
  }

  async listResources() {
    const r = await this.sendRequest('resources/list', {});
    return r.resources || [];
  }

  async readResource(uri) {
    const r = await this.sendRequest('resources/read', { uri });
    return r.contents ? r.contents[0] : null;
  }

  respondToElicitation(id, value) {
    if (this.ws) this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: value }));
  }

  cancelElicitation(id) {
    if (this.ws) this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'User cancelled' } }));
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected')); return;
      }
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Timeout: ' + method));
        }
      }, 30000);
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  sendNotification(method, params) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }
  }

  handleMessage(data) {
    try {
      const msg = JSON.parse(data);
      if ('id' in msg && ('result' in msg || 'error' in msg)) {
        const p = this.pendingRequests.get(msg.id);
        if (p) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if ('method' in msg && !('id' in msg)) {
        this.handleNotification(msg);
      } else if ('method' in msg && 'id' in msg) {
        this.handleRequest(msg);
      }
    } catch (e) { if (this.onError) this.onError(e); }
  }

  handleNotification(n) {
    if (n.method === 'notifications/tools/list_changed' && this.onToolsChanged) this.onToolsChanged();
    if (n.method === 'notifications/progress' && this.onProgress && n.params) this.onProgress(n.params);
  }

  handleRequest(r) {
    if (r.method === 'sampling/createMessage' && this.onElicitation && r.params) {
      this.onElicitation(r.id, r.params.schema || {}, r.params.message);
    } else {
      if (this.ws) this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Method not found' } }));
    }
  }

  isConnected() { return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN; }
}

// Global instance
window.beamMCP = new BeamMCPClient();
`;
}
