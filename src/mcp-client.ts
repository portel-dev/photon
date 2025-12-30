/**
 * Standalone MCP Client for Photon Runtime
 *
 * Enables Photon classes to call external MCPs via the MCP protocol.
 * Unlike NCP (which routes through an orchestrator), this spawns and
 * manages MCP processes directly using stdio transport.
 *
 * Configuration is loaded from:
 * 1. Environment variable: PHOTON_MCP_CONFIG (path to JSON config)
 * 2. photon.mcp.json in current directory
 * 3. ~/.config/photon/mcp.json
 *
 * Config format (same as Claude Desktop):
 * {
 *   "mcpServers": {
 *     "github": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-github"],
 *       "env": { "GITHUB_TOKEN": "..." }
 *     }
 *   }
 * }
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import {
  MCPClient,
  MCPTransport,
  MCPClientFactory,
  MCPToolInfo,
  MCPToolResult,
  MCPError,
  MCPNotConnectedError,
  MCPToolError,
  createMCPProxy,
} from '@portel/photon-core';

/**
 * MCP Server configuration (Claude Desktop compatible format)
 */
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Full MCP configuration file format
 */
export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * JSON-RPC message types
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Manages a single MCP server connection via stdio
 */
class MCPConnection {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private initialized = false;
  private tools: MCPToolInfo[] = [];
  private readline: readline.Interface | null = null;

  constructor(
    private name: string,
    private config: MCPServerConfig,
    private verbose: boolean = false
  ) {}

  private log(message: string): void {
    if (this.verbose) {
      console.error(`[MCP:${this.name}] ${message}`);
    }
  }

  /**
   * Start the MCP server process and initialize
   */
  async connect(): Promise<void> {
    if (this.process) {
      return; // Already connected
    }

    this.log(`Starting MCP server: ${this.config.command} ${(this.config.args || []).join(' ')}`);

    // Spawn the MCP server process
    this.process = spawn(this.config.command, this.config.args || [], {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...this.config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.log(`Process error: ${error.message}`);
      this.cleanup();
    });

    this.process.on('exit', (code, signal) => {
      this.log(`Process exited with code ${code}, signal ${signal}`);
      this.cleanup();
    });

    // Set up line-based reading from stdout
    this.readline = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line) => {
      this.handleMessage(line);
    });

    // Log stderr for debugging
    this.process.stderr?.on('data', (data) => {
      this.log(`stderr: ${data.toString().trim()}`);
    });

    // Initialize the MCP protocol
    await this.initialize();
  }

  /**
   * Initialize MCP protocol (handshake)
   */
  private async initialize(): Promise<void> {
    // Send initialize request
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
      },
      clientInfo: {
        name: 'photon-runtime',
        version: '1.0.0',
      },
    });

    this.log(`Initialized: ${JSON.stringify(initResult.serverInfo)}`);

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});

    // List available tools
    const toolsResult = await this.sendRequest('tools/list', {});
    this.tools = (toolsResult.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    this.log(`Loaded ${this.tools.length} tools`);
    this.initialized = true;
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new MCPNotConnectedError(this.name));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification) + '\n';
    this.process.stdin.write(message);
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private handleMessage(line: string): void {
    try {
      const message = JSON.parse(line) as JsonRpcResponse;

      if ('id' in message && message.id !== undefined) {
        // This is a response
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new MCPError(
              this.name,
              `${message.error.message} (code: ${message.error.code})`
            ));
          } else {
            pending.resolve(message.result);
          }
        }
      }
      // Ignore notifications from server for now
    } catch (error) {
      // Ignore malformed messages
      this.log(`Malformed message: ${line}`);
    }
  }

  /**
   * Call a tool on this MCP server
   */
  async callTool(toolName: string, parameters: Record<string, any>): Promise<MCPToolResult> {
    if (!this.initialized) {
      throw new MCPNotConnectedError(this.name);
    }

    try {
      const result = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: parameters,
      });

      // Return in MCPToolResult format expected by photon-core
      // The MCP protocol returns { content: [...], isError?: boolean }
      if (result?.content && Array.isArray(result.content)) {
        return {
          content: result.content.map((c: any) => ({
            type: c.type || 'text',
            text: c.text,
            data: c.data,
            mimeType: c.mimeType,
          })),
          isError: result.isError,
        };
      }

      // Fallback for unexpected response formats
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result),
        }],
        isError: false,
      };
    } catch (error: any) {
      throw new MCPToolError(this.name, toolName, error.message);
    }
  }

  /**
   * List tools available on this MCP server
   */
  listTools(): MCPToolInfo[] {
    return this.tools;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.initialized && this.process !== null;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.initialized = false;
    this.readline?.close();
    this.readline = null;

    // Reject all pending requests
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new MCPNotConnectedError(this.name));
    }
    this.pendingRequests.clear();

    this.process = null;
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.log('Disconnecting...');
      this.process.kill();
      this.cleanup();
    }
  }
}

/**
 * Standalone MCP Transport for Photon runtime
 * Spawns and manages MCP server processes directly
 */
export class StandaloneMCPTransport implements MCPTransport {
  private connections: Map<string, MCPConnection> = new Map();

  constructor(
    private config: MCPConfig,
    private verbose: boolean = false
  ) {}

  private log(message: string): void {
    if (this.verbose) {
      console.error(`[MCPTransport] ${message}`);
    }
  }

  /**
   * Get or create connection to an MCP server
   */
  private async getConnection(mcpName: string): Promise<MCPConnection> {
    let connection = this.connections.get(mcpName);

    if (connection?.isConnected()) {
      return connection;
    }

    // Check if server is configured
    const serverConfig = this.config.mcpServers[mcpName];
    if (!serverConfig) {
      throw new MCPNotConnectedError(mcpName);
    }

    // Create and connect
    connection = new MCPConnection(mcpName, serverConfig, this.verbose);
    await connection.connect();
    this.connections.set(mcpName, connection);

    return connection;
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(
    mcpName: string,
    toolName: string,
    parameters: Record<string, any>
  ): Promise<MCPToolResult> {
    const connection = await this.getConnection(mcpName);
    return connection.callTool(toolName, parameters);
  }

  /**
   * List tools available on an MCP server
   */
  async listTools(mcpName: string): Promise<MCPToolInfo[]> {
    const connection = await this.getConnection(mcpName);
    return connection.listTools();
  }

  /**
   * Check if an MCP server is available/configured
   */
  async isConnected(mcpName: string): Promise<boolean> {
    // Check if configured
    if (!this.config.mcpServers[mcpName]) {
      return false;
    }

    // Check if already connected
    const connection = this.connections.get(mcpName);
    return connection?.isConnected() ?? false;
  }

  /**
   * List all configured MCP servers
   */
  listServers(): string[] {
    return Object.keys(this.config.mcpServers);
  }

  /**
   * Disconnect all MCP servers
   */
  async disconnectAll(): Promise<void> {
    for (const connection of this.connections.values()) {
      await connection.disconnect();
    }
    this.connections.clear();
  }
}

/**
 * Standalone MCP Client Factory for Photon runtime
 */
export class StandaloneMCPClientFactory implements MCPClientFactory {
  private transport: StandaloneMCPTransport;

  constructor(config: MCPConfig, verbose: boolean = false) {
    this.transport = new StandaloneMCPTransport(config, verbose);
  }

  /**
   * Create an MCP client for a specific server
   */
  create(mcpName: string): MCPClient {
    return new MCPClient(mcpName, this.transport);
  }

  /**
   * List all configured MCP servers
   */
  async listServers(): Promise<string[]> {
    return this.transport.listServers();
  }

  /**
   * Disconnect all servers
   */
  async disconnect(): Promise<void> {
    await this.transport.disconnectAll();
  }

  /**
   * Get the underlying transport (for advanced use)
   */
  getTransport(): StandaloneMCPTransport {
    return this.transport;
  }
}

/**
 * Load MCP configuration from standard locations
 */
export async function loadMCPConfig(verbose: boolean = false): Promise<MCPConfig> {
  const log = verbose ? (msg: string) => console.error(`[MCPConfig] ${msg}`) : () => {};

  // Priority order for config files
  const configPaths = [
    // 1. Environment variable
    process.env.PHOTON_MCP_CONFIG,
    // 2. Current directory
    path.join(process.cwd(), 'photon.mcp.json'),
    // 3. User config directory
    path.join(os.homedir(), '.config', 'photon', 'mcp.json'),
    // 4. Alternative user config
    path.join(os.homedir(), '.photon', 'mcp.json'),
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as MCPConfig;

      // Validate structure
      if (config.mcpServers && typeof config.mcpServers === 'object') {
        log(`Loaded MCP config from ${configPath}`);
        log(`Found ${Object.keys(config.mcpServers).length} MCP servers`);
        return config;
      }
    } catch (error: any) {
      // File doesn't exist or invalid JSON - continue to next
      if (error.code !== 'ENOENT') {
        log(`Failed to load ${configPath}: ${error.message}`);
      }
    }
  }

  // Return empty config if no config file found
  log('No MCP config found, MCP access will be unavailable');
  return { mcpServers: {} };
}

/**
 * Create a standalone MCP client factory from default config
 */
export async function createStandaloneMCPClientFactory(
  verbose: boolean = false
): Promise<StandaloneMCPClientFactory> {
  const config = await loadMCPConfig(verbose);
  return new StandaloneMCPClientFactory(config, verbose);
}
