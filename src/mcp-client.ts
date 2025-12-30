/**
 * MCP Client for Photon Runtime
 *
 * Uses the official @modelcontextprotocol/sdk for connecting to MCP servers.
 * Supports multiple transports:
 * - stdio: Local processes (command + args)
 * - sse: Server-Sent Events over HTTP
 * - streamable-http: HTTP streaming
 * - websocket: WebSocket connections
 *
 * Configuration formats:
 * 1. stdio (local process):
 *    { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
 *
 * 2. sse (HTTP SSE):
 *    { "url": "http://localhost:3000/mcp", "transport": "sse" }
 *
 * 3. streamable-http:
 *    { "url": "http://localhost:3000/mcp", "transport": "streamable-http" }
 *
 * 4. websocket:
 *    { "url": "ws://localhost:3000/mcp", "transport": "websocket" }
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
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
 * MCP Server configuration
 * Supports multiple transport types
 */
export interface MCPServerConfig {
  // For stdio transport (local process)
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;

  // For HTTP/WS transports
  url?: string;
  transport?: 'stdio' | 'sse' | 'streamable-http' | 'websocket';

  // Authentication (for HTTP transports)
  headers?: Record<string, string>;
}

/**
 * Full MCP configuration file format
 */
export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Manages a single MCP server connection using official SDK
 */
class SDKMCPConnection {
  private client: Client | null = null;
  private transport: any = null;
  private tools: MCPToolInfo[] = [];
  private initialized = false;

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
   * Create appropriate transport based on config
   */
  private createTransport(): any {
    const transportType = this.config.transport || (this.config.command ? 'stdio' : 'sse');

    switch (transportType) {
      case 'stdio': {
        if (!this.config.command) {
          throw new Error(`stdio transport requires 'command' in config for ${this.name}`);
        }
        this.log(`Creating stdio transport: ${this.config.command} ${(this.config.args || []).join(' ')}`);
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          cwd: this.config.cwd,
          env: this.config.env,
        });
      }

      case 'sse': {
        if (!this.config.url) {
          throw new Error(`sse transport requires 'url' in config for ${this.name}`);
        }
        this.log(`Creating SSE transport: ${this.config.url}`);
        return new SSEClientTransport(new URL(this.config.url), {
          requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
        });
      }

      case 'streamable-http': {
        if (!this.config.url) {
          throw new Error(`streamable-http transport requires 'url' in config for ${this.name}`);
        }
        this.log(`Creating streamable HTTP transport: ${this.config.url}`);
        return new StreamableHTTPClientTransport(new URL(this.config.url), {
          requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
        });
      }

      case 'websocket': {
        if (!this.config.url) {
          throw new Error(`websocket transport requires 'url' in config for ${this.name}`);
        }
        this.log(`Creating WebSocket transport: ${this.config.url}`);
        return new WebSocketClientTransport(new URL(this.config.url));
      }

      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.client) {
      return; // Already connected
    }

    this.transport = this.createTransport();
    this.client = new Client(
      {
        name: 'photon-runtime',
        version: '1.0.0',
      },
      {
        capabilities: {
          roots: { listChanged: false },
        },
      }
    );

    this.log('Connecting...');
    await this.client.connect(this.transport);
    this.log('Connected');

    // List available tools
    const toolsResult = await this.client.listTools();
    this.tools = (toolsResult.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    this.log(`Loaded ${this.tools.length} tools`);
    this.initialized = true;
  }

  /**
   * Call a tool
   */
  async callTool(toolName: string, parameters: Record<string, any>): Promise<MCPToolResult> {
    if (!this.client || !this.initialized) {
      throw new MCPNotConnectedError(this.name);
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: parameters,
      });

      // Convert to MCPToolResult format
      if (result?.content && Array.isArray(result.content)) {
        return {
          content: result.content.map((c: any) => ({
            type: c.type || 'text',
            text: c.text,
            data: c.data,
            mimeType: c.mimeType,
          })),
          isError: result.isError as boolean | undefined,
        };
      }

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
   * List available tools
   */
  listTools(): MCPToolInfo[] {
    return this.tools;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.initialized && this.client !== null;
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.log('Disconnecting...');
      await this.client.close();
      this.client = null;
      this.transport = null;
      this.initialized = false;
    }
  }
}

/**
 * Standalone MCP Transport using official SDK
 */
export class StandaloneMCPTransport implements MCPTransport {
  private connections: Map<string, SDKMCPConnection> = new Map();

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
  private async getConnection(mcpName: string): Promise<SDKMCPConnection> {
    let connection = this.connections.get(mcpName);

    if (connection?.isConnected()) {
      return connection;
    }

    const serverConfig = this.config.mcpServers[mcpName];
    if (!serverConfig) {
      throw new MCPNotConnectedError(mcpName);
    }

    connection = new SDKMCPConnection(mcpName, serverConfig, this.verbose);
    await connection.connect();
    this.connections.set(mcpName, connection);

    return connection;
  }

  async callTool(mcpName: string, toolName: string, parameters: Record<string, any>): Promise<MCPToolResult> {
    const connection = await this.getConnection(mcpName);
    return connection.callTool(toolName, parameters);
  }

  async listTools(mcpName: string): Promise<MCPToolInfo[]> {
    const connection = await this.getConnection(mcpName);
    return connection.listTools();
  }

  async isConnected(mcpName: string): Promise<boolean> {
    if (!this.config.mcpServers[mcpName]) {
      return false;
    }
    const connection = this.connections.get(mcpName);
    return connection?.isConnected() ?? false;
  }

  listServers(): string[] {
    return Object.keys(this.config.mcpServers);
  }

  async disconnectAll(): Promise<void> {
    for (const connection of this.connections.values()) {
      await connection.disconnect();
    }
    this.connections.clear();
  }
}

/**
 * Standalone MCP Client Factory
 */
export class StandaloneMCPClientFactory implements MCPClientFactory {
  private transport: StandaloneMCPTransport;

  constructor(config: MCPConfig, verbose: boolean = false) {
    this.transport = new StandaloneMCPTransport(config, verbose);
  }

  create(mcpName: string): MCPClient {
    return new MCPClient(mcpName, this.transport);
  }

  async listServers(): Promise<string[]> {
    return this.transport.listServers();
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnectAll();
  }

  getTransport(): StandaloneMCPTransport {
    return this.transport;
  }
}

/**
 * Resolve an MCP source to a runnable configuration
 * Handles: GitHub shorthand, npm packages, URLs, local paths
 */
export function resolveMCPSource(
  name: string,
  source: string,
  sourceType: 'github' | 'npm' | 'url' | 'local'
): MCPServerConfig {
  switch (sourceType) {
    case 'npm': {
      // npm:@scope/package or npm:package
      const packageName = source.replace(/^npm:/, '');
      return {
        command: 'npx',
        args: ['-y', packageName],
        transport: 'stdio',
      };
    }

    case 'github': {
      // GitHub shorthand: owner/repo
      // Try to run via npx assuming it's published to npm
      return {
        command: 'npx',
        args: ['-y', `@${source}`],
        transport: 'stdio',
      };
    }

    case 'url': {
      // Full URL - determine transport from protocol
      if (source.startsWith('ws://') || source.startsWith('wss://')) {
        return {
          url: source,
          transport: 'websocket',
        };
      }
      // Default to SSE for HTTP URLs
      return {
        url: source,
        transport: 'sse',
      };
    }

    case 'local': {
      // Local path - run directly with node
      const resolvedPath = source.replace(/^~/, process.env.HOME || '');
      return {
        command: 'node',
        args: [resolvedPath],
        transport: 'stdio',
      };
    }

    default:
      throw new Error(`Unknown MCP source type: ${sourceType}`);
  }
}

/**
 * Load MCP configuration from standard locations
 */
export async function loadMCPConfig(verbose: boolean = false): Promise<MCPConfig> {
  const log = verbose ? (msg: string) => console.error(`[MCPConfig] ${msg}`) : () => {};

  const configPaths = [
    process.env.PHOTON_MCP_CONFIG,
    path.join(process.cwd(), 'photon.mcp.json'),
    path.join(os.homedir(), '.config', 'photon', 'mcp.json'),
    path.join(os.homedir(), '.photon', 'mcp.json'),
  ].filter(Boolean) as string[];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as MCPConfig;

      if (config.mcpServers && typeof config.mcpServers === 'object') {
        log(`Loaded MCP config from ${configPath}`);
        log(`Found ${Object.keys(config.mcpServers).length} MCP servers`);
        return config;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log(`Failed to load ${configPath}: ${error.message}`);
      }
    }
  }

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
