/**
 * Photon MCP Server
 *
 * Wraps a .photon.ts file as an MCP server using @modelcontextprotocol/sdk
 * Supports both stdio and SSE transports
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { PhotonLoader } from './loader.js';
import { PhotonMCPClassExtended, Template, Static, TemplateResponse, TemplateMessage } from '@portel/photon-core';
import { createStandaloneMCPClientFactory, StandaloneMCPClientFactory } from './mcp-client.js';
import { PHOTON_VERSION } from './version.js';
import { createLogger, Logger, LoggerOptions, LogLevel, type LogRecord } from './shared/logger.js';
import { getErrorMessage } from './shared/error-handler.js';
import { validateOrThrow, assertString, notEmpty, inRange, oneOf, hasExtension } from './shared/validation.js';

export class HotReloadDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotReloadDisabledError';
  }
}

export type TransportType = 'stdio' | 'sse';

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
  transport?: TransportType;
  port?: number;
  logOptions?: LoggerOptions;
}

// SSE session record for managing multiple clients
type SSESession = {
  server: Server;
  transport: SSEServerTransport;
};

export class PhotonServer {
  private loader: PhotonLoader;
  private mcp: PhotonMCPClassExtended | null = null;
  private server: Server;
  private options: PhotonServerOptions;
  private mcpClientFactory: StandaloneMCPClientFactory | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private sseSessions: Map<string, SSESession> = new Map();
  private devMode: boolean;
  private hotReloadDisabled = false;
  private lastReloadError?: { message: string; stack?: string; timestamp: number; attempts: number };
  private statusClients: Set<ServerResponse> = new Set();
  private currentStatus: { type: 'info' | 'success' | 'error' | 'warn'; message: string; timestamp: number } = {
    type: 'info',
    message: 'Ready',
    timestamp: Date.now(),
  };
  private logger: Logger;

  constructor(options: PhotonServerOptions) {
    // Validate options
    assertString(options.filePath, 'filePath');
    validateOrThrow(options.filePath, [
      notEmpty('filePath'),
      hasExtension('filePath', ['ts', 'js'])
    ]);
    
    if (options.transport) {
      validateOrThrow(options.transport, [
        oneOf<TransportType>('transport', ['stdio', 'sse'])
      ]);
    }
    
    if (options.port !== undefined) {
      validateOrThrow(options.port, [
        inRange('port', 1, 65535)
      ]);
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

    this.loader = new PhotonLoader(true, this.logger.child({ component: 'photon-loader', scope: 'loader' }));

    // Create MCP server instance
    this.server = new Server(
      {
        name: 'photon-mcp',
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
          },
          experimental: {
            sampling: {}, // Support elicitation via MCP sampling protocol
          },
        },
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
   * Set up MCP protocol handlers
   */
  private setupHandlers() {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.mcp) {
        return { tools: [] };
      }

      return {
        tools: this.mcp.tools.map(tool => {
          const toolDef: any = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };

          // Add _meta with outputTemplate if tool has linked UI
          const linkedUI = this.mcp?.assets?.ui.find(u => u.linkedTool === tool.name);
          if (linkedUI) {
            toolDef._meta = {
              outputTemplate: `photon://${this.mcp!.name}/ui/${linkedUI.id}`,
            };
          }

          return toolDef;
        }),
      };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.mcp) {
        throw new Error('MCP not loaded');
      }

      const { name: toolName, arguments: args } = request.params;

      try {
        const result = await this.loader.executeTool(this.mcp, toolName, args || {});

        // Find the tool to get its outputFormat
        const tool = this.mcp.tools.find(t => t.name === toolName);
        const outputFormat = tool?.outputFormat;

        // Check if this was a stateful workflow execution
        const isStateful = result && typeof result === 'object' && result._stateful === true;
        const actualResult = isStateful ? result.result : result;

        // Build content with optional mimeType annotation
        const content: any = {
          type: 'text',
          text: this.formatResult(actualResult),
        };

        // Add mimeType annotation if outputFormat is a content type
        if (outputFormat) {
          const { formatToMimeType } = await import('./cli-formatter.js');
          const mimeType = formatToMimeType(outputFormat);
          if (mimeType) {
            content.annotations = { mimeType };
          }
        }

        // For stateful workflows, add run ID as a separate content block
        // This allows the AI to inform the user about the workflow run
        if (isStateful && result.runId) {
          const workflowInfo = {
            type: 'text',
            text: `\n\n---\n📋 **Workflow Run**: ${result.runId}\n` +
                  `Status: ${result.status}${result.resumed ? ' (resumed)' : ''}\n` +
                  `This is a stateful workflow. To resume if interrupted, use run ID: ${result.runId}`,
          };
          return { content: [content, workflowInfo] };
        }

        return { content: [content] };
      } catch (error) {
        // Log error with context for debugging
        this.log('error', 'Tool execution failed', {
          tool: toolName,
          error: getErrorMessage(error),
          args: this.options.devMode ? args : undefined,
        });
        // Format error for AI consumption
        return this.formatError(error, toolName, args);
      }
    });

    // Handle prompts/list
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      if (!this.mcp) {
        return { prompts: [] };
      }

      return {
        prompts: this.mcp.templates.map(template => ({
          name: template.name,
          description: template.description,
          arguments: Object.entries(template.inputSchema.properties || {}).map(([name, schema]) => ({
            name,
            description: (typeof schema === 'object' && schema && 'description' in schema ? schema.description as string : '') || '',
            required: template.inputSchema.required?.includes(name) || false,
          })),
        })),
      };
    });

    // Handle prompts/get
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (!this.mcp) {
        throw new Error('MCP not loaded');
      }

      const { name: promptName, arguments: args } = request.params;

      // Find the template
      const template = this.mcp.templates.find(t => t.name === promptName);
      if (!template) {
        throw new Error(`Prompt not found: ${promptName}`);
      }

      try {
        // Execute the template method
        const result = await this.loader.executeTool(this.mcp, promptName, args || {});

        // Handle Template/TemplateResponse return types
        return this.formatTemplateResult(result);
      } catch (error) {
        this.log('error', 'Prompt execution failed', {
          prompt: promptName,
          error: getErrorMessage(error),
        });
        throw new Error(`Failed to get prompt: ${getErrorMessage(error)}`);
      }
    });

    // Handle resources/list (static URIs only, no parameters)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (!this.mcp) {
        return { resources: [] };
      }

      // Only return resources with static URIs (no {parameters})
      const staticResources = this.mcp.statics.filter(s => !this.isUriTemplate(s.uri));

      const resources = staticResources.map(static_ => ({
        uri: static_.uri,
        name: static_.name,
        description: static_.description,
        mimeType: static_.mimeType || 'text/plain',
      }));

      // Add assets from asset folder (UI, prompts, resources)
      if (this.mcp.assets) {
        const photonName = this.mcp.name;

        // Add UI assets
        for (const ui of this.mcp.assets.ui) {
          resources.push({
            uri: `photon://${photonName}/ui/${ui.id}`,
            name: `ui:${ui.id}`,
            description: ui.linkedTool
              ? `UI template for ${ui.linkedTool} tool`
              : `UI template: ${ui.id}`,
            mimeType: ui.mimeType || 'text/html',
          });
        }

        // Add prompt assets
        for (const prompt of this.mcp.assets.prompts) {
          resources.push({
            uri: `photon://${photonName}/prompts/${prompt.id}`,
            name: `prompt:${prompt.id}`,
            description: prompt.description || `Prompt template: ${prompt.id}`,
            mimeType: 'text/markdown',
          });
        }

        // Add resource assets
        for (const resource of this.mcp.assets.resources) {
          resources.push({
            uri: `photon://${photonName}/resources/${resource.id}`,
            name: `resource:${resource.id}`,
            description: resource.description || `Static resource: ${resource.id}`,
            mimeType: resource.mimeType || 'application/octet-stream',
          });
        }
      }

      return { resources };
    });

    // Handle resources/templates/list (parameterized URIs)
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      if (!this.mcp) {
        return { resourceTemplates: [] };
      }

      // Only return resources with URI templates (has {parameters})
      const templateResources = this.mcp.statics.filter(s => this.isUriTemplate(s.uri));

      return {
        resourceTemplates: templateResources.map(static_ => ({
          uriTemplate: static_.uri,
          name: static_.name,
          description: static_.description,
          mimeType: static_.mimeType || 'text/plain',
        })),
      };
    });

    // Handle resources/read
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (!this.mcp) {
        throw new Error('MCP not loaded');
      }

      const { uri } = request.params;

      // Check if this is an asset URI (photon://{name}/{type}/{id})
      const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/);
      if (assetMatch && this.mcp.assets) {
        const [, photonName, assetType, assetId] = assetMatch;

        // Find the asset by type and id
        let resolvedPath: string | undefined;
        let mimeType: string = 'text/plain';

        if (assetType === 'ui') {
          const ui = this.mcp.assets.ui.find(u => u.id === assetId);
          if (ui) {
            resolvedPath = ui.resolvedPath;
            mimeType = ui.mimeType || 'text/html';
          }
        } else if (assetType === 'prompts') {
          const prompt = this.mcp.assets.prompts.find(p => p.id === assetId);
          if (prompt) {
            resolvedPath = prompt.resolvedPath;
            mimeType = 'text/markdown';
          }
        } else if (assetType === 'resources') {
          const resource = this.mcp.assets.resources.find(r => r.id === assetId);
          if (resource) {
            resolvedPath = resource.resolvedPath;
            mimeType = resource.mimeType || 'application/octet-stream';
          }
        }

        if (resolvedPath) {
          try {
            const content = await fs.readFile(resolvedPath, 'utf-8');
            return {
              contents: [
                {
                  uri,
                  mimeType,
                  text: content,
                },
              ],
            };
          } catch (error) {
            this.log('error', 'Asset read failed', {
              uri,
              path: resolvedPath,
              error: getErrorMessage(error),
            });
            throw new Error(`Failed to read asset: ${getErrorMessage(error)}`);
          }
        }

        throw new Error(`Asset not found: ${uri}`);
      }

      // Find the static resource by URI
      const static_ = this.mcp.statics.find(s => s.uri === uri || this.matchUriPattern(s.uri, uri));
      if (!static_) {
        throw new Error(`Resource not found: ${uri}`);
      }

      try {
        // Parse URI parameters if URI is a pattern
        const params = this.parseUriParams(static_.uri, uri);

        // Execute the static method
        const result = await this.loader.executeTool(this.mcp, static_.name, params);

        // Handle Static return type
        return this.formatStaticResult(result, static_.mimeType);
      } catch (error) {
        this.log('error', 'Resource read failed', {
          uri,
          resource: static_.name,
          error: getErrorMessage(error),
        });
        throw new Error(`Failed to read resource: ${getErrorMessage(error)}`);
      }
    });
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
   * Format static result to MCP resource response
   */
  private formatStaticResult(result: any, mimeType?: string): any {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return {
      contents: [
        {
          uri: '',
          mimeType: mimeType || 'text/plain',
          text,
        },
      ],
    };
  }

  /**
   * Check if a URI is a template (contains {parameters})
   */
  private isUriTemplate(uri: string): boolean {
    return /\{[^}]+\}/.test(uri);
  }

  /**
   * Match URI pattern with actual URI
   * Example: github://repos/{owner}/{repo} matches github://repos/foo/bar
   */
  private matchUriPattern(pattern: string, uri: string): boolean {
    // Convert URI pattern to regex
    // Replace {param} with capturing groups
    const regexPattern = pattern.replace(/\{[^}]+\}/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(uri);
  }

  /**
   * Parse parameters from URI based on pattern
   * Example: pattern="github://repos/{owner}/{repo}", uri="github://repos/foo/bar"
   * Returns: { owner: "foo", repo: "bar" }
   */
  private parseUriParams(pattern: string, uri: string): Record<string, string> {
    const params: Record<string, string> = {};

    // Extract parameter names from pattern
    const paramNames: string[] = [];
    const paramRegex = /\{([^}]+)\}/g;
    let match;
    while ((match = paramRegex.exec(pattern)) !== null) {
      paramNames.push(match[1]);
    }

    // Convert pattern to regex with capturing groups
    const regexPattern = pattern.replace(/\{[^}]+\}/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);

    // Extract values from URI
    const values = uri.match(regex);
    if (values) {
      // Skip first element (full match)
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = values[i + 1];
      }
    }

    return params;
  }

  /**
   * Format error for AI consumption
   * Provides structured, actionable error messages
   */
  private formatError(error: any, toolName: string, args: any): any {
    // Determine error type
    let errorType = 'runtime_error';
    let errorMessage = getErrorMessage(error) || String(error);
    let suggestion = '';

    // Categorize common errors and provide suggestions
    if (errorMessage.includes('not a function') || errorMessage.includes('undefined')) {
      errorType = 'implementation_error';
      suggestion = 'The tool implementation may have an issue. Check that all methods are properly defined.';
    } else if (errorMessage.includes('required') || errorMessage.includes('validation')) {
      errorType = 'validation_error';
      suggestion = 'Check the parameters provided match the tool schema requirements.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      errorType = 'timeout_error';
      suggestion = 'The operation took too long. Try again or check external service availability.';
    } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('network')) {
      errorType = 'network_error';
      suggestion = 'Cannot connect to external service. Check network connection and service availability.';
    } else if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
      errorType = 'permission_error';
      suggestion = 'Permission denied. Check file/resource access permissions.';
    } else if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
      errorType = 'not_found_error';
      suggestion = 'Resource not found. Check that the file or resource exists.';
    }

    // Build structured error message for AI
    let structuredMessage = `❌ Tool Error: ${toolName}\n\n`;
    structuredMessage += `Error Type: ${errorType}\n`;
    structuredMessage += `Message: ${errorMessage}\n`;

    if (suggestion) {
      structuredMessage += `\nSuggestion: ${suggestion}\n`;
    }

    // Include parameters for debugging (in dev mode)
    if (this.options.devMode && Object.keys(args || {}).length > 0) {
      structuredMessage += `\nParameters provided:\n${JSON.stringify(args, null, 2)}\n`;
    }

    // Include stack trace in dev mode
    if (this.options.devMode && error.stack) {
      structuredMessage += `\nStack trace:\n${error.stack}\n`;
    }

    // Log to stderr for debugging
    this.log('error', `[Photon Error] ${toolName}: ${errorMessage}`);
    if (this.options.devMode && error.stack) {
      this.log('debug', error.stack);
    }

    return {
      content: [
        {
          type: 'text',
          text: structuredMessage,
        },
      ],
      isError: true,
    };
  }

  /**
   * Initialize and start the server
   */
  async start() {
    try {
      // Initialize MCP client factory for enabling this.mcp() in Photons
      // This allows Photons to call external MCPs via protocol
      try {
        this.mcpClientFactory = await createStandaloneMCPClientFactory(this.options.devMode);
        const servers = await this.mcpClientFactory.listServers();
        if (servers.length > 0) {
          this.log('info', `MCP access enabled: ${servers.join(', ')}`);
          this.loader.setMCPClientFactory(this.mcpClientFactory);
        }
      } catch (error) {
        this.log('warn', `Failed to load MCP config: ${getErrorMessage(error)}`);
      }

      // Load the Photon MCP file
      this.log('info', `Loading ${this.options.filePath}...`);
      this.mcp = await this.loader.loadFile(this.options.filePath);

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

    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400).end('Missing URL');
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      // SSE connection endpoint
      if (req.method === 'GET' && url.pathname === ssePath) {
        await this.handleSSEConnection(res, messagesPath);
        return;
      }

      // Message posting endpoint
      if (req.method === 'POST' && url.pathname === messagesPath) {
        await this.handleSSEMessage(req, res, url);
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
        res.end(JSON.stringify({
          name: this.mcp?.name || 'photon-mcp',
          transport: 'sse',
          endpoints,
          tools: this.mcp?.tools.length || 0,
          assets: this.mcp?.assets ? {
            ui: this.mcp.assets.ui.length,
            prompts: this.mcp.assets.prompts.length,
            resources: this.mcp.assets.resources.length,
          } : null,
        }));
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
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
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
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          const tools = this.mcp?.tools.map(tool => {
            const linkedUI = this.mcp?.assets?.ui.find(u => u.linkedTool === tool.name);
            return {
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              ui: linkedUI ? { id: linkedUI.id, uri: `photon://${this.mcp!.name}/ui/${linkedUI.id}` } : null,
            };
          }) || [];
          res.end(JSON.stringify({ tools }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/status') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
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
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const { tool, args } = JSON.parse(body);
            const result = await this.loader.executeTool(this.mcp!, tool, args || {});
            const isStateful = result && typeof result === 'object' && result._stateful === true;
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              data: isStateful ? result.result : result,
            }));
          } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: getErrorMessage(error) }));
          }
        });
        return;
      }

      // API: Call tool with streaming progress (SSE)
      if (req.method === 'POST' && url.pathname === '/api/call-stream') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
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
              } else {
                sendNotification('notifications/emit', { event: emit });
              }
            };

            sendNotification('notifications/status', {
              type: 'info',
              message: `Starting ${tool}`,
            });

            const result = await this.loader.executeTool(this.mcp!, tool, args, { outputHandler });
            const isStateful = result && typeof result === 'object' && result._stateful === true;

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
        });
        return;
      }

      // API: Get UI template
      if (req.method === 'GET' && url.pathname.startsWith('/api/ui/')) {
        const uiId = url.pathname.replace('/api/ui/', '');
        const ui = this.mcp?.assets?.ui.find(u => u.id === uiId);

        if (ui?.resolvedPath) {
          try {
            const content = await fs.readFile(ui.resolvedPath, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(content);
            return;
          } catch (e) {
            // Fall through to 404
          }
        }
        res.writeHead(404).end('UI not found');
        return;
      }

      res.writeHead(404).end('Not Found');
    });

    this.httpServer.on('clientError', (err: Error, socket) => {
      this.log('warn', 'HTTP client error', { message: err.message });
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, () => {
        this.log('info', `${this.mcp!.name} MCP server listening`, {
          transport: 'sse',
          port,
          devMode: this.devMode,
        });
        this.log('debug', 'SSE endpoints ready', {
          baseUrl: `http://localhost:${port}`,
          ssePath,
          messagesPath,
          playground: this.devMode ? `http://localhost:${port}/playground` : undefined,
        });
        resolve();
      });
    });
  }

  /**
   * List all photons in the .photon directory
   */
  private async listAllPhotons() {
    const { listPhotonFiles, DEFAULT_PHOTON_DIR } = await import('./path-resolver.js');
    const photonFiles = await listPhotonFiles();
    
    const photons = await Promise.all(
      photonFiles.map(async (file) => {
        try {
          const loader = new PhotonLoader(this.devMode, this.logger.child({ component: 'photon-loader', scope: 'discovery' }));
          const mcp = await loader.loadFile(file);
          return {
            name: mcp.name,
            description: mcp.description,
            file: file.replace(DEFAULT_PHOTON_DIR + '/', ''),
            tools: mcp.tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          };
        } catch (error) {
          this.log('warn', `Failed to load photon: ${file}`, { error: getErrorMessage(error) });
          return null;
        }
      })
    );

    return photons.filter(p => p !== null);
  }

  /**
   * Generate playground HTML for interactive testing
   */
  private async getPlaygroundHTML(port: number): Promise<string> {
    const name = this.mcp?.name || 'photon-mcp';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} - Playground</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --card: #12121a;
      --border: #1e1e2e;
      --text: #e4e4e7;
      --muted: #71717a;
      --accent: #6366f1;
      --green: #22c55e;
      --orange: #f97316;
      --blue: #3b82f6;
      --purple: #a855f7;
      --cyan: #06b6d4;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .header {
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header h1::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--green);
    }
    .badge {
      background: var(--accent);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .container {
      display: grid;
      grid-template-columns: 320px 1fr;
      height: calc(100vh - 57px);
    }
    .status-panel {
      background: white;
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 15px 30px rgba(15, 23, 42, 0.08);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      font-weight: 600;
      background: #eef2ff;
      color: var(--accent);
    }
    .status-pill.success {
      background: #dcfce7;
      color: #16a34a;
    }
    .status-pill.error {
      background: #fee2e2;
      color: #ef4444;
    }
    .status-pill.warn {
      background: #fef3c7;
      color: #d97706;
    }
    .status-detail {
      margin-top: 12px;
      color: var(--muted);
      font-size: 14px;
    }
    .status-warnings {
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      background: #fff7ed;
      color: #b45309;
      font-size: 13px;
      display: none;
    }
    .status-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(4, minmax(80px, 1fr));
      gap: 12px;
    }
    .status-card {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: #f8fafc;
    }
    .status-card-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .status-card-value {
      font-size: 20px;
      font-weight: 600;
      color: var(--text);
    }
    .sidebar {
      background: var(--card);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
    }
    .sidebar h2 {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .tool-item {
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tool-item:hover, .tool-item.active {
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.1);
    }
    .tool-name {
      font-weight: 500;
      font-size: 14px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tool-name .ui-badge {
      background: rgba(34, 197, 94, 0.2);
      color: var(--green);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .tool-desc {
      font-size: 12px;
      color: var(--muted);
    }
    .main {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .toolbar {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .toolbar h3 {
      font-size: 16px;
      flex: 1;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover:not(:disabled) {
      background: #5558e3;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      background: var(--card);
    }
    .tab {
      padding: 12px 24px;
      font-size: 14px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      transition: all 0.2s;
    }
    .tab:hover {
      color: var(--text);
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .tab-content {
      flex: 1;
      overflow: hidden;
      display: none;
    }
    .tab-content.active {
      display: flex;
      flex-direction: column;
    }
    .panel {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    }
    .panel-header {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--muted);
    }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-note {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 12px;
      color: var(--muted);
    }
    .form-note strong {
      color: var(--accent);
    }
    #data-form-container {
      margin-bottom: 16px;
    }
    .json-output {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'SF Mono', Monaco, 'Fira Code', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-x: auto;
      line-height: 1.5;
    }
    .json-key { color: var(--cyan); }
    .json-string { color: var(--green); }
    .json-number { color: var(--orange); }
    .json-boolean { color: var(--purple); }
    .json-null { color: var(--muted); }
    .json-bracket { color: var(--text); }
    #ui-preview {
      min-height: 200px;
    }
    #ui-preview iframe {
      width: 100%;
      border: none;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--muted);
      text-align: center;
      padding: 40px;
    }
    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(10, 10, 15, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .loading {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .status-bar {
      padding: 8px 16px;
      background: var(--card);
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      display: inline-block;
    }
    .dot.success { background: var(--green); }
    .dot.error { background: #ef4444; }
    .dot.loading { background: var(--orange); animation: pulse 1s infinite; }
    .dot.warn { background: #d97706; animation: pulse 1s infinite; }
    .ui-overlay {
      position: absolute;
      inset: 0;
      background: rgba(8, 9, 15, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 30;
    }
    .ui-overlay.active {
      display: flex;
    }
    .overlay-card {
      background: rgba(18, 20, 30, 0.9);
      border: 1px solid rgba(99, 102, 241, 0.4);
      border-radius: 12px;
      padding: 24px 32px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(10, 10, 15, 0.5);
      max-width: 360px;
      width: 100%;
    }
    .overlay-spinner {
      width: 36px;
      height: 36px;
      border: 4px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      margin: 0 auto 16px;
      animation: spin 0.8s linear infinite;
    }
    .overlay-progress {
      display: none;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
    }
    .overlay-progress-bar {
      flex: 1;
      height: 8px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      overflow: hidden;
    }
    .overlay-progress-fill {
      height: 100%;
      width: 0;
      background: var(--accent);
      border-radius: inherit;
      transition: width 0.2s ease;
    }
    .overlay-progress-percent {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
      min-width: 36px;
      text-align: right;
    }
    .overlay-title {
      font-size: 16px;
      font-weight: 600;
      color: white;
      margin-bottom: 6px;
    }
    .overlay-text {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.75);
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${name}</h1>
    <span class="badge">Playground</span>
  </div>
  <div class="container">
    <div class="sidebar">
      <h2>Tools</h2>
      <div id="tools-list">Loading...</div>
    </div>
    <div class="main">
      <div class="status-panel">
        <div class="status-pill" id="status-pill">
          <span class="dot loading" id="status-pill-dot"></span>
          <span id="status-pill-text">Checking status…</span>
        </div>
        <div class="status-detail" id="status-detail">Initializing runtime…</div>
        <div class="status-warnings" id="status-warning"></div>
        <div class="status-grid">
          <div class="status-card">
            <div class="status-card-label">Methods</div>
            <div class="status-card-value" id="summary-tools">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Linked UI</div>
            <div class="status-card-value" id="summary-ui">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Prompts</div>
            <div class="status-card-value" id="summary-prompts">0</div>
          </div>
          <div class="status-card">
            <div class="status-card-label">Resources</div>
            <div class="status-card-value" id="summary-resources">0</div>
          </div>
        </div>
      </div>
      <div class="toolbar">
        <h3 id="selected-tool">Select a tool</h3>
        <button class="btn btn-primary" id="run-btn" disabled style="display: none;">Run</button>
      </div>
      <div class="tabs" id="tabs" style="display: none;">
        <div class="tab active" data-tab="ui">UI</div>
        <div class="tab" data-tab="data">Data</div>
      </div>
      <div class="tab-content active" id="tab-ui">
        <div class="panel">
          <div id="ui-form-container"></div>
          <div class="panel-header" id="ui-results-header" style="display: none;">Results</div>
          <div id="ui-preview">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <p>Select a tool and fill the form to see results</p>
            </div>
          </div>
        </div>
      </div>
      <div class="tab-content" id="tab-data">
        <div class="panel">
          <div class="panel-header">Raw JSON Data</div>
          <div class="json-output" id="output">// Run a tool to see raw JSON data</div>
        </div>
      </div>
      <div class="status-bar">
        <span class="dot" id="status-dot"></span>
        <span id="status-text">Ready</span>
      </div>
      <div class="ui-overlay" id="execution-overlay">
        <div class="overlay-card">
          <div class="overlay-spinner" id="overlay-spinner"></div>
          <div class="overlay-progress" id="overlay-progress">
            <div class="overlay-progress-bar">
              <div class="overlay-progress-fill" id="overlay-progress-fill"></div>
            </div>
            <div class="overlay-progress-percent" id="overlay-progress-percent">0%</div>
          </div>
          <div class="overlay-title" id="overlay-title">Preparing tool...</div>
          <div class="overlay-text" id="overlay-text">Please wait while the tool runs.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let photons = [];
    let tools = [];
    let selectedTool = null;
    let selectedPhoton = null;
    let lastResult = null;
    let currentProgressToken = null;
    let currentRequestId = null;

    const overlayElement = document.getElementById('execution-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayText = document.getElementById('overlay-text');
    const overlaySpinner = document.getElementById('overlay-spinner');
    const overlayProgress = document.getElementById('overlay-progress');
    const overlayProgressFill = document.getElementById('overlay-progress-fill');
    const overlayProgressPercent = document.getElementById('overlay-progress-percent');
    const statusElements = {
      pill: document.getElementById('status-pill'),
      pillDot: document.getElementById('status-pill-dot'),
      pillText: document.getElementById('status-pill-text'),
      detail: document.getElementById('status-detail'),
      warning: document.getElementById('status-warning'),
      summaryTools: document.getElementById('summary-tools'),
      summaryUI: document.getElementById('summary-ui'),
      summaryPrompts: document.getElementById('summary-prompts'),
      summaryResources: document.getElementById('summary-resources'),
    };
    let statusSource = null;

    function showOverlay(title, text, progress = null) {
      overlayElement.classList.add('active');
      overlayTitle.textContent = title || 'Working...';
      overlayText.textContent = text || '';
      updateOverlayProgress(progress);
    }

    function hideOverlay() {
      overlayElement.classList.remove('active');
      updateOverlayProgress(null);
    }

    function updateOverlayProgress(progress) {
      if (typeof progress === 'number' && !Number.isNaN(progress)) {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        overlaySpinner.style.display = 'none';
        overlayProgress.style.display = 'flex';
        overlayProgressFill.style.width = percent + '%';
        overlayProgressPercent.textContent = percent + '%';
      } else {
        overlaySpinner.style.display = 'block';
        overlayProgress.style.display = 'none';
        overlayProgressFill.style.width = '0%';
        overlayProgressPercent.textContent = '';
      }
    }

    async function loadTools() {
      const res = await fetch('/api/photons');
      const data = await res.json();
      photons = data.photons;
      // Flatten all tools from all photons
      tools = photons.flatMap(p => p.tools.map(t => ({
        ...t,
        photon: p.name,
        photonFile: p.file
      })));
      renderToolsList();
    }

    async function loadStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        renderStatus(data);
      } catch (error) {
        if (statusElements.pill) {
          statusElements.pill.className = 'status-pill warn';
          statusElements.pillDot.className = 'dot warn';
          statusElements.pillText.textContent = 'Status unavailable';
          statusElements.detail.textContent = 'Unable to connect to Photon runtime.';
        }
      }
    }

    function subscribeStatus() {
      if (statusSource) {
        statusSource.close();
      }
      const source = new EventSource('/api/status-stream');
      statusSource = source;
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          renderStatus(payload);
        } catch (error) {
          // ignore malformed payloads
        }
      };
      source.onerror = () => {
        source.close();
        setTimeout(subscribeStatus, 3000);
      };
    }

    function renderStatus(data) {
      if (!data || !statusElements.pill) return;
      const state = data.status || {};
      const type = state.type || 'info';
      statusElements.pill.className = 'status-pill ' + type;
      const dotClass = type === 'success' ? 'dot success' : type === 'error' ? 'dot error' : type === 'warn' ? 'dot warn' : 'dot loading';
      statusElements.pillDot.className = dotClass;
      statusElements.pillText.textContent = state.message || 'Ready';

      if (data.hotReloadDisabled) {
        statusElements.detail.textContent = 'Hot reload paused after repeated errors. Restart dev server after fixing issues.';
      } else if (data.devMode) {
        statusElements.detail.textContent = 'Dev mode with hot reload and live playground.';
      } else {
        statusElements.detail.textContent = 'Standard runtime mode.';
      }

      const warnings = data.warnings || [];
      if (warnings.length > 0) {
        statusElements.warning.style.display = 'block';
        statusElements.warning.innerHTML = warnings.map(w => '⚠️ ' + w).join('<br>');
      } else {
        statusElements.warning.style.display = 'none';
        statusElements.warning.innerHTML = '';
      }

      const summary = data.summary || {};
      statusElements.summaryTools.textContent = summary.toolCount ?? tools.length;
      statusElements.summaryUI.textContent = summary.uiAssets?.length ?? 0;
      statusElements.summaryPrompts.textContent = summary.promptCount ?? 0;
      statusElements.summaryResources.textContent = summary.resourceCount ?? 0;
    }

    function renderToolsList() {
      const container = document.getElementById('tools-list');
      if (photons.length === 0) {
        container.innerHTML = '<div style="color: var(--muted); padding: 12px; text-align: center;">No photons found</div>';
        return;
      }
      
      container.innerHTML = photons.map(photon => {
        const toolsHtml = photon.tools.map(t => \`
          <div class="tool-item" data-tool="\${t.name}" data-photon="\${photon.name}">
            <div class="tool-name">
              \${t.name}
              \${t.ui ? '<span class="ui-badge">UI</span>' : ''}
            </div>
            <div class="tool-desc">\${t.description || 'No description'}</div>
          </div>
        \`).join('');
        
        return \`
          <div class="photon-group">
            <div class="photon-header" data-photon="\${photon.name}">
              <span class="photon-toggle">▶</span>
              <span class="photon-name">\${photon.name}</span>
              <span class="photon-count">\${photon.tools.length}</span>
            </div>
            <div class="photon-tools collapsed">
              \${toolsHtml}
            </div>
          </div>
        \`;
      }).join('');

      // Add click handlers for photon headers
      container.querySelectorAll('.photon-header').forEach(el => {
        el.addEventListener('click', () => {
          const toolsDiv = el.nextElementSibling;
          const toggle = el.querySelector('.photon-toggle');
          toolsDiv.classList.toggle('collapsed');
          toggle.textContent = toolsDiv.classList.contains('collapsed') ? '▶' : '▼';
        });
      });
      
      // Add click handlers for tools
      container.querySelectorAll('.tool-item').forEach(el => {
        el.addEventListener('click', () => {
          selectedPhoton = el.dataset.photon;
          selectTool(el.dataset.tool);
        });
      });
      
      // Auto-expand first photon
      const firstToggle = container.querySelector('.photon-toggle');
      const firstTools = container.querySelector('.photon-tools');
      if (firstToggle && firstTools) {
        firstTools.classList.remove('collapsed');
        firstToggle.textContent = '▼';
      }
    }

    function setUIPreviewMessage(title, description) {
      document.getElementById('ui-preview').innerHTML = \`
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <p style="font-weight: 600; color: var(--text);">\${title}</p>
          \${description ? '<p style="margin-top: 6px; color: var(--muted); font-size: 13px;">' + description + '</p>' : ''}
        </div>
      \`;
    }

    function selectTool(name) {
      selectedTool = tools.find(t => t.name === name);
      document.querySelectorAll('.tool-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tool === name);
      });
      document.getElementById('selected-tool').textContent = name;

      // Show tabs
      document.getElementById('tabs').style.display = 'flex';

      // Clear previous forms/placeholders
      setUIPreviewMessage('Fill the form to see results', 'Enter parameters below and run the tool.');
      document.getElementById('ui-form-container').innerHTML = '';

      const hasUI = Boolean(selectedTool.ui);

      // Check if tool has required parameters
      const props = selectedTool.inputSchema?.properties || {};
      const required = selectedTool.inputSchema?.required || [];
      const hasRequiredParams = required.length > 0;

      // Always switch to UI tab and show form
      switchTab('ui');
      
      if (hasRequiredParams) {
        showParamsForm();
      } else {
        // Auto-run for tools with no params
        setUIPreviewMessage('Running tool...', 'Loading results...');
        runTool();
      }
    }

    function showParamsForm() {
      const props = selectedTool.inputSchema?.properties || {};
      const required = selectedTool.inputSchema?.required || [];

      const formHtml = \`
        <div class="form-note">
          <strong>Input Parameters</strong><br>
          Fill in the parameters below and click Run to execute the tool.
        </div>
        <div id="params-form">
          \${Object.entries(props).map(([name, schema]) => {
            const isRequired = required.includes(name);
            const desc = schema.description || '';
            if (schema.enum) {
              return \`
                <div class="form-group">
                  <label>\${name}\${isRequired ? ' *' : ''}</label>
                  <select name="\${name}">
                    <option value="">Select...</option>
                    \${schema.enum.map(v => \`<option value="\${v}">\${v}</option>\`).join('')}
                  </select>
                  \${desc ? \`<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">\${desc}</div>\` : ''}
                </div>
              \`;
            }
            const inputType = schema.type === 'number' ? 'number' : 'text';
            const isLongText = desc.length > 50 || name.toLowerCase().includes('content') || name.toLowerCase().includes('body');
            if (isLongText && schema.type === 'string') {
              return \`
                <div class="form-group">
                  <label>\${name}\${isRequired ? ' *' : ''}</label>
                  <textarea name="\${name}" placeholder="\${desc}"></textarea>
                </div>
              \`;
            }
            return \`
              <div class="form-group">
                <label>\${name}\${isRequired ? ' *' : ''}</label>
                <input type="\${inputType}" name="\${name}" placeholder="\${desc}" />
              </div>
            \`;
          }).join('')}
        </div>
        <button class="btn btn-primary" onclick="runTool()" style="margin-top: 16px;">Run Tool</button>
      \`;

      // Always render form in UI tab
      document.getElementById('ui-form-container').innerHTML = formHtml;
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabName));
    }

    function syntaxHighlight(json) {
      if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
      }
      return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
            match = match.slice(0, -1) + '</span><span class="json-bracket">:</span>';
            return '<span class="' + cls + '">' + match;
          } else {
            cls = 'json-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      });
    }

    function setStatus(status, text, progress = null) {
      const dot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const dotState = status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'warn' ? 'warn' : 'loading';
      dot.className = 'dot ' + dotState;
      statusText.textContent = text;
      
      // Remove existing progress bar if any
      const existingBar = document.getElementById('status-progress');
      if (existingBar) existingBar.remove();

      if (progress !== null) {
        const bar = document.createElement('div');
        bar.id = 'status-progress';
        bar.style.width = '100px';
        bar.style.height = '4px';
        bar.style.background = 'var(--border)';
        bar.style.borderRadius = '2px';
        bar.style.marginLeft = '12px';
        bar.style.overflow = 'hidden';
        
        const fill = document.createElement('div');
        fill.style.width = (progress * 100) + '%';
        fill.style.height = '100%';
        fill.style.background = 'var(--accent)';
        fill.style.transition = 'width 0.2s';
        
        bar.appendChild(fill);
        statusText.parentElement.appendChild(bar);
      }
    }

    async function runTool() {
      if (!selectedTool) return;

      const progressToken = 'progress_' + Date.now();
      const requestId = 'req_' + Date.now();
      currentProgressToken = progressToken;
      currentRequestId = requestId;

      setStatus('loading', 'Executing ' + selectedTool.name + '...');
      showOverlay('Executing ' + selectedTool.name, 'Starting tool...');

      const args = {};
      document.querySelectorAll('#params-form input, #params-form select, #params-form textarea').forEach(el => {
        if (el.value) {
          const schema = selectedTool.inputSchema?.properties?.[el.name];
          args[el.name] = schema?.type === 'number' ? Number(el.value) : el.value;
        }
      });

      // Clear output
      document.getElementById('output').textContent = '// Waiting for response...';

      try {
        const response = await fetch('/api/call-stream', {
          method: 'POST',
          body: JSON.stringify({ tool: selectedTool.name, args, progressToken, requestId }),
        });

        if (!response.ok || !response.body) {
          throw new Error('Unable to start tool execution');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const segments = buffer.split('\\n\\n');
          buffer = segments.pop() || '';
          
          for (const segment of segments) {
            const dataLine = segment.split('\\n').find(line => line.startsWith('data: '));
            if (!dataLine) continue;
            let payload;
            try {
              payload = JSON.parse(dataLine.slice(6));
            } catch (e) {
              this.logger.error('Invalid payload from server', { error: getErrorMessage(e) });
              continue;
            }
            if (handleServerMessage(payload)) {
              finished = true;
              break;
            }
          }
        }
      } catch (err) {
        document.getElementById('output').innerHTML = '<span style="color: #ef4444;">Error: ' + err.message + '</span>';
        switchTab('data');
        setStatus('error', 'Error: ' + err.message);
      }
    }

    function handleServerMessage(payload) {
      if (!payload) {
        return false;
      }

      if (payload.method === 'notifications/progress') {
        const params = payload.params || {};
        const total = typeof params.total === 'number' ? params.total : 100;
        const rawProgress = typeof params.progress === 'number' ? params.progress : 0;
        const ratio = total ? rawProgress / total : rawProgress;
        const normalized = Math.max(0, Math.min(ratio <= 1 ? ratio : ratio / 100, 1));
        const message = params.message || 'Processing...';
        setStatus('loading', message, normalized);
        showOverlay('Processing', message, normalized);
        return false;
      }

      if (payload.method === 'notifications/status') {
        const params = payload.params || {};
        const statusType = params.type || 'info';
        const message = params.message || 'Working...';
        const target = statusType === 'success' ? 'success' : statusType === 'error' ? 'error' : 'loading';
        setStatus(target, message);
        if (statusType === 'error') {
          showOverlay('Action needed', message);
        }
        return false;
      }

      if (payload.method === 'notifications/emit') {
        const event = payload.params?.event;
        if (event?.emit === 'status') {
          setStatus('loading', event.message || 'Working...');
        }
        return false;
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
        hideOverlay();
        if (payload.error) {
          document.getElementById('output').innerHTML = '<span style="color: #ef4444;">Error: ' + payload.getErrorMessage(error) + '</span>';
          switchTab('data');
          setStatus('error', 'Error: ' + payload.getErrorMessage(error));
        } else if (payload.result) {
          handleResult(payload.result);
        }
        return true;
      }

      return false;
    }

    async function handleResult(result) {
      lastResult = result.data;

      // Update data tab with syntax highlighting
      document.getElementById('output').innerHTML = syntaxHighlight(JSON.stringify(result.data, null, 2));

      // Clear form from UI tab
      document.getElementById('ui-form-container').innerHTML = '';
      document.getElementById('ui-results-header').style.display = 'block';

      // If tool has linked UI, render it in iframe
      if (selectedTool.ui) {
        const uiRes = await fetch('/api/ui/' + selectedTool.ui.id);
        let html = await uiRes.text();
        html = html.replace('window.__PHOTON_DATA__', JSON.stringify(result.data));
        const blob = new Blob([html], { type: 'text/html' });
        document.getElementById('ui-preview').innerHTML = \`<iframe src="\${URL.createObjectURL(blob)}" style="width: 100%; height: 600px; border: 1px solid var(--border); border-radius: 8px;"></iframe>\`;
      } else {
        // Auto-render data using Auto-UI components
        document.getElementById('ui-preview').innerHTML = renderAutoUI(result.data);
      }

      setStatus('success', 'Completed successfully');
    }

    function renderAutoUI(data) {
      // Auto-detect data structure and render appropriately
      if (Array.isArray(data)) {
        if (data.length === 0) {
          return '<div class="empty-state"><p>No results found</p></div>';
        }
        // Render as list of cards
        return \`<div style="display: flex; flex-direction: column; gap: 12px; padding: 16px;">\${data.map(item => renderCard(item)).join('')}</div>\`;
      } else if (typeof data === 'object' && data !== null) {
        // Single object - render as card
        return \`<div style="padding: 16px;">\${renderCard(data)}</div>\`;
      } else {
        // Primitive value
        return \`<div style="padding: 16px; color: var(--text);">\${String(data)}</div>\`;
      }
    }

    function renderCard(item) {
      if (typeof item !== 'object' || item === null) {
        return \`<div style="padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 8px;">\${String(item)}</div>\`;
      }
      
      const entries = Object.entries(item);
      const title = item.title || item.name || item.id || entries[0]?.[1] || 'Item';
      const description = item.description || item.snippet || item.summary || '';
      const url = item.url || item.link || item.href || '';
      
      return \`
        <div style="padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: 8px;">
          <div style="font-weight: 600; font-size: 15px; color: var(--text); margin-bottom: 6px;">\${escapeHtml(String(title))}</div>
          \${description ? \`<div style="color: var(--muted); font-size: 13px; margin-bottom: 8px;">\${escapeHtml(String(description))}</div>\` : ''}
          \${url ? \`<a href="\${escapeHtml(url)}" target="_blank" style="color: var(--accent); font-size: 12px; text-decoration: none;">View \u2192</a>\` : ''}
          \${!description && !url ? \`<div style="color: var(--muted); font-size: 12px; margin-top: 6px;">\${entries.slice(1).map(([k, v]) => \`<div><strong>\${k}:</strong> \${String(v)}</div>\`).join('')}</div>\` : ''}
        </div>
      \`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    loadTools();
    loadStatus();
    subscribeStatus();
  </script>
</body>
</html>`;
  }

  /**
   * Handle new SSE connection
   */
  private async handleSSEConnection(res: ServerResponse, messagesPath: string) {
    res.setHeader('Access-Control-Allow-Origin', '*');

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
          resources: { listChanged: true },
          experimental: {
            sampling: {}, // Support elicitation via MCP sampling protocol
          },
        },
      }
    );

    // Copy handlers to the session server
    this.setupSessionHandlers(sessionServer);

    // Create SSE transport
    const transport = new SSEServerTransport(messagesPath, res);
    const sessionId = transport.sessionId;

    // Store session
    this.sseSessions.set(sessionId, { server: sessionServer, transport });

    // Clean up on close
    transport.onclose = async () => {
      this.sseSessions.delete(sessionId);
      await sessionServer.close();
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
    res.setHeader('Access-Control-Allow-Origin', '*');
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
  private setupSessionHandlers(sessionServer: Server) {
    // Handle tools/list
    sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.mcp) return { tools: [] };
      return {
        tools: this.mcp.tools.map(tool => {
          const toolDef: any = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };

          // Add _meta with outputTemplate if tool has linked UI
          const linkedUI = this.mcp?.assets?.ui.find(u => u.linkedTool === tool.name);
          if (linkedUI) {
            toolDef._meta = {
              outputTemplate: `photon://${this.mcp!.name}/ui/${linkedUI.id}`,
            };
          }

          return toolDef;
        }),
      };
    });

    // Handle tools/call
    sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.mcp) throw new Error('MCP not loaded');
      const { name: toolName, arguments: args } = request.params;
      try {
        const result = await this.loader.executeTool(this.mcp, toolName, args || {});
        const tool = this.mcp.tools.find(t => t.name === toolName);
        const outputFormat = tool?.outputFormat;

        const isStateful = result && typeof result === 'object' && result._stateful === true;
        const actualResult = isStateful ? result.result : result;

        const content: any = {
          type: 'text',
          text: this.formatResult(actualResult),
        };

        if (outputFormat) {
          const { formatToMimeType } = await import('./cli-formatter.js');
          const mimeType = formatToMimeType(outputFormat);
          if (mimeType) {
            content.annotations = { mimeType };
          }
        }

        const response: any = { content: [content] };
        if (isStateful) {
          response._meta = { runId: result.runId, status: result.status };
        }
        return response;
      } catch (error) {
        return this.formatError(error, toolName, args);
      }
    });

    // Handle prompts/list
    sessionServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      if (!this.mcp) return { prompts: [] };
      return {
        prompts: this.mcp.templates.map(template => ({
          name: template.name,
          description: template.description,
          arguments: template.inputSchema?.properties
            ? Object.entries(template.inputSchema.properties).map(([name, schema]: [string, any]) => ({
                name,
                description: schema.description || '',
                required: template.inputSchema?.required?.includes(name) || false,
              }))
            : [],
        })),
      };
    });

    // Handle prompts/get
    sessionServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (!this.mcp) throw new Error('MCP not loaded');
      const { name: promptName, arguments: args } = request.params;
      try {
        const result = await this.loader.executeTool(this.mcp, promptName, args || {});
        return this.formatTemplateResult(result);
      } catch (error) {
        throw new Error(`Failed to get prompt: ${getErrorMessage(error)}`);
      }
    });

    // Handle resources/list
    sessionServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (!this.mcp) return { resources: [] };
      const resources: any[] = [];

      // Add static resources
      for (const static_ of this.mcp.statics) {
        if (!this.isUriTemplate(static_.uri)) {
          resources.push({
            uri: static_.uri,
            name: static_.name,
            description: static_.description,
            mimeType: static_.mimeType,
          });
        }
      }

      // Add asset resources
      if (this.mcp.assets) {
        for (const ui of this.mcp.assets.ui) {
          resources.push({
            uri: `photon://${this.mcp.name}/${ui.id}`,
            name: `ui:${ui.id}`,
            description: ui.linkedTool
              ? `UI template for ${ui.linkedTool} tool`
              : `UI template: ${ui.id}`,
            mimeType: ui.mimeType || 'text/html',
          });
        }
        for (const prompt of this.mcp.assets.prompts) {
          resources.push({
            uri: `photon://${this.mcp.name}/prompts/${prompt.id}`,
            name: `prompt:${prompt.id}`,
            description: prompt.description || `Prompt template: ${prompt.id}`,
            mimeType: 'text/markdown',
          });
        }
        for (const resource of this.mcp.assets.resources) {
          resources.push({
            uri: `photon://${this.mcp.name}/resources/${resource.id}`,
            name: `resource:${resource.id}`,
            description: `Static resource: ${resource.id}`,
            mimeType: resource.mimeType || 'application/json',
          });
        }
      }

      return { resources };
    });

    // Handle resources/templates/list
    sessionServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      if (!this.mcp) return { resourceTemplates: [] };
      return {
        resourceTemplates: this.mcp.statics
          .filter(static_ => this.isUriTemplate(static_.uri))
          .map(static_ => ({
            uriTemplate: static_.uri,
            name: static_.name,
            description: static_.description,
            mimeType: static_.mimeType,
          })),
      };
    });

    // Handle resources/read
    sessionServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (!this.mcp) throw new Error('MCP not loaded');
      const { uri } = request.params;

      // Check for asset URI
      const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/);
      if (assetMatch && this.mcp.assets) {
        return this.handleAssetRead(uri, assetMatch);
      }

      // Handle static resources
      return this.handleStaticRead(uri);
    });
  }

  /**
   * Handle asset read (for both stdio and SSE handlers)
   */
  private async handleAssetRead(uri: string, assetMatch: RegExpMatchArray) {
    const [, photonName, assetType, assetId] = assetMatch;

    let resolvedPath: string | undefined;
    let mimeType: string = 'text/plain';

    if (assetType === 'ui') {
      const ui = this.mcp!.assets!.ui.find(u => u.id === assetId);
      if (ui) {
        resolvedPath = ui.resolvedPath;
        mimeType = ui.mimeType || 'text/html';
      }
    } else if (assetType === 'prompts') {
      const prompt = this.mcp!.assets!.prompts.find(p => p.id === assetId);
      if (prompt) {
        resolvedPath = prompt.resolvedPath;
        mimeType = 'text/markdown';
      }
    } else if (assetType === 'resources') {
      const resource = this.mcp!.assets!.resources.find(r => r.id === assetId);
      if (resource) {
        resolvedPath = resource.resolvedPath;
        mimeType = resource.mimeType || 'application/octet-stream';
      }
    }

    if (resolvedPath) {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return {
        contents: [{ uri, mimeType, text: content }],
      };
    }

    throw new Error(`Asset not found: ${uri}`);
  }

  /**
   * Handle static resource read (for both stdio and SSE handlers)
   */
  private async handleStaticRead(uri: string) {
    const static_ = this.mcp!.statics.find(s => s.uri === uri || this.matchUriPattern(s.uri, uri));
    if (!static_) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const params = this.parseUriParams(static_.uri, uri);
    const result = await this.loader.executeTool(this.mcp!, static_.name, params);
    return this.formatStaticResult(result, static_.mimeType);
  }

  /**
   * Stop the server
   */
  async stop() {
    try {
      // Call lifecycle hook if present
      if (this.mcp?.instance?.onShutdown) {
        await this.mcp.instance.onShutdown();
      }

      // Disconnect MCP clients
      if (this.mcpClientFactory) {
        await this.mcpClientFactory.disconnect();
      }

      // Close SSE sessions
      for (const [sessionId, session] of this.sseSessions) {
        await session.server.close();
      }
      this.sseSessions.clear();

      for (const client of this.statusClients) {
        client.end();
      }
      this.statusClients.clear();

      // Close HTTP server if running
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
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
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          hasUI: Boolean(assets.ui?.some(ui => ui.linkedTool === tool.name)),
        })),
        uiAssets: (assets.ui || []).map(ui => ({ id: ui.id, linkedTool: ui.linkedTool })),
        promptCount: assets.prompts?.length || 0,
        resourceCount: assets.resources?.length || 0,
      },
    };
  }

  private handleStatusStream(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

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
    } catch {
      // ignore
    }

    for (const session of this.sseSessions.values()) {
      try {
        await session.server.notification(payload);
      } catch {
        // ignore session errors
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
      throw new HotReloadDisabledError('Hot reload temporarily disabled after repeated failures. Restart Photon or fix the errors to re-enable.');
    }

    try {
      this.log('info', 'Reloading Photon');

      // Store old instance in case we need to rollback
      const oldInstance = this.mcp;

      // Call shutdown hook on old instance (but keep it for rollback)
      if (oldInstance?.instance?.onShutdown) {
        try {
          await oldInstance.instance.onShutdown();
        } catch (shutdownError: any) {
          this.log('warn', 'Shutdown hook failed during reload', { error: shutdownError.message });
          // Continue with reload anyway
        }
      }

      // Reload the file
      const newMcp = await this.loader.reloadFile(this.options.filePath);

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
        throw new HotReloadDisabledError('Hot reload disabled after repeated failures. Restart Photon dev server once the errors are resolved.');
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
      this.log('warn', 'Failed to send list_changed notifications', { error: getErrorMessage(error) });
    }
  }
}
