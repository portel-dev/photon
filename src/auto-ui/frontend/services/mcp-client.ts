/**
 * MCP Client Service for Beam UI
 *
 * Provides MCP protocol communication for LitElement components.
 * Supports both MCP and legacy WebSocket protocols with automatic fallback.
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

type MCPEventType = 'connect' | 'disconnect' | 'error' | 'tools-changed' | 'progress';

class MCPClientService {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventListeners = new Map<MCPEventType, Set<Function>>();

  /**
   * Connect to the MCP WebSocket endpoint
   */
  async connect(): Promise<void> {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/mcp`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = async () => {
          this.connected = true;
          this.reconnectAttempts = 0;

          try {
            await this.initialize();
            this.emit('connect');
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        this.ws.onclose = () => {
          this.connected = false;
          this.emit('disconnect');

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.ws.onerror = () => {
          const error = new Error('WebSocket error');
          this.emit('error', error);
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
    this.maxReconnectAttempts = 0;
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
   * Send JSON-RPC request
   */
  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

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
   * Send JSON-RPC notification
   */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const notification: JSONRPCMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.ws.send(JSON.stringify(notification));
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as JSONRPCMessage;

      // Response
      if (message.id !== undefined && (message.result !== undefined || message.error)) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      // Notification
      if (message.method && message.id === undefined) {
        this.handleNotification(message);
        return;
      }
    } catch (error) {
      this.emit('error', error);
    }
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
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const mcpClient = new MCPClientService();
