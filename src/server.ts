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

export type TransportType = 'stdio' | 'sse';

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
  transport?: TransportType;
  port?: number;
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

  constructor(options: PhotonServerOptions) {
    this.options = options;
    this.loader = new PhotonLoader(true); // verbose=true for server mode

    // Create MCP server instance
    this.server = new Server(
      {
        name: 'photon-mcp',
        version: '1.0.0',
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
        },
      }
    );

    // Set up protocol handlers
    this.setupHandlers();
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
        const outputFormat = (tool as any)?.outputFormat;

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
      } catch (error: any) {
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
            description: (schema as any).description || '',
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
      } catch (error: any) {
        throw new Error(`Failed to get prompt: ${error.message}`);
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
          } catch (error: any) {
            throw new Error(`Failed to read asset: ${error.message}`);
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
      } catch (error: any) {
        throw new Error(`Failed to read resource: ${error.message}`);
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
    let errorMessage = error.message || String(error);
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
    console.error(`[Photon Error] ${toolName}: ${errorMessage}`);
    if (this.options.devMode && error.stack) {
      console.error(error.stack);
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
          console.error(`MCP access enabled: ${servers.join(', ')}`);
          this.loader.setMCPClientFactory(this.mcpClientFactory);
        }
      } catch (error: any) {
        console.error(`Warning: Failed to load MCP config: ${error.message}`);
      }

      // Load the Photon MCP file
      console.error(`Loading ${this.options.filePath}...`);
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
        console.error('Dev mode enabled - hot reload active');
      }
    } catch (error: any) {
      console.error(`Failed to start server: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
  }

  /**
   * Start server with stdio transport
   */
  private async startStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Server started: ${this.mcp!.name}`);
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
        res.end(JSON.stringify({
          name: this.mcp?.name || 'photon-mcp',
          transport: 'sse',
          endpoints: {
            sse: `http://localhost:${port}${ssePath}`,
            messages: `http://localhost:${port}${messagesPath}`,
            playground: `http://localhost:${port}/playground`,
          },
          tools: this.mcp?.tools.length || 0,
          assets: this.mcp?.assets ? {
            ui: this.mcp.assets.ui.length,
            prompts: this.mcp.assets.prompts.length,
            resources: this.mcp.assets.resources.length,
          } : null,
        }));
        return;
      }

      // Playground - interactive test UI
      if (req.method === 'GET' && url.pathname === '/playground') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getPlaygroundHTML(port));
        return;
      }

      // API: List tools
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
          } catch (error: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: error.message }));
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
      console.error('HTTP client error:', err.message);
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, () => {
        console.error(`\n🚀 ${this.mcp!.name} MCP server (SSE)`);
        console.error(`   http://localhost:${port}`);
        console.error(`\n   Endpoints:`);
        console.error(`   Playground:  http://localhost:${port}/playground`);
        console.error(`   SSE stream:  GET  http://localhost:${port}${ssePath}`);
        console.error(`   Messages:    POST http://localhost:${port}${messagesPath}?sessionId=...`);
        console.error('');
        resolve();
      });
    });
  }

  /**
   * Generate playground HTML for interactive testing
   */
  private getPlaygroundHTML(port: number): string {
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
    .btn-primary:hover {
      background: #5558e3;
    }
    .btn-secondary {
      background: var(--border);
      color: var(--text);
    }
    .content {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      background: var(--border);
    }
    .panel {
      background: var(--bg);
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
    .form-group input, .form-group select {
      width: 100%;
      padding: 10px 12px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none;
      border-color: var(--accent);
    }
    .json-output {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      white-space: pre-wrap;
      overflow-x: auto;
      max-height: 300px;
      overflow-y: auto;
    }
    .ui-frame {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      height: 100%;
    }
    .ui-frame iframe {
      width: 100%;
      height: 100%;
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
    .loading {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
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
      <div class="toolbar">
        <h3 id="selected-tool">Select a tool</h3>
        <button class="btn btn-primary" id="run-btn" disabled>Run</button>
      </div>
      <div class="content">
        <div class="panel">
          <div class="panel-header">Input / Output</div>
          <div id="params-form"></div>
          <div style="margin-top: 20px">
            <div class="panel-header">Response</div>
            <div class="json-output" id="output">// Response will appear here</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">UI Preview</div>
          <div class="ui-frame" id="ui-preview">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <p>Run a tool with linked UI to see preview</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let tools = [];
    let selectedTool = null;

    async function loadTools() {
      const res = await fetch('/api/tools');
      const data = await res.json();
      tools = data.tools;
      renderToolsList();
    }

    function renderToolsList() {
      const container = document.getElementById('tools-list');
      container.innerHTML = tools.map(t => \`
        <div class="tool-item" data-tool="\${t.name}">
          <div class="tool-name">
            \${t.name}
            \${t.ui ? '<span class="ui-badge">UI</span>' : ''}
          </div>
          <div class="tool-desc">\${t.description || 'No description'}</div>
        </div>
      \`).join('');

      container.querySelectorAll('.tool-item').forEach(el => {
        el.addEventListener('click', () => selectTool(el.dataset.tool));
      });
    }

    function selectTool(name) {
      selectedTool = tools.find(t => t.name === name);
      document.querySelectorAll('.tool-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tool === name);
      });
      document.getElementById('selected-tool').textContent = name;
      document.getElementById('run-btn').disabled = false;
      renderParamsForm();
    }

    function renderParamsForm() {
      const container = document.getElementById('params-form');
      const props = selectedTool.inputSchema?.properties || {};
      const required = selectedTool.inputSchema?.required || [];

      if (Object.keys(props).length === 0) {
        container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">No parameters required</p>';
        return;
      }

      container.innerHTML = Object.entries(props).map(([name, schema]) => {
        const isRequired = required.includes(name);
        if (schema.enum) {
          return \`
            <div class="form-group">
              <label>\${name}\${isRequired ? ' *' : ''}</label>
              <select name="\${name}">
                \${schema.enum.map(v => \`<option value="\${v}">\${v}</option>\`).join('')}
              </select>
            </div>
          \`;
        }
        return \`
          <div class="form-group">
            <label>\${name}\${isRequired ? ' *' : ''}</label>
            <input type="\${schema.type === 'number' ? 'number' : 'text'}" name="\${name}" placeholder="\${schema.description || ''}" />
          </div>
        \`;
      }).join('');
    }

    async function runTool() {
      if (!selectedTool) return;

      const btn = document.getElementById('run-btn');
      btn.innerHTML = '<span class="loading"></span>';
      btn.disabled = true;

      const args = {};
      document.querySelectorAll('#params-form input, #params-form select').forEach(el => {
        if (el.value) {
          const schema = selectedTool.inputSchema?.properties?.[el.name];
          args[el.name] = schema?.type === 'number' ? Number(el.value) : el.value;
        }
      });

      try {
        const res = await fetch('/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: selectedTool.name, args }),
        });
        const result = await res.json();

        document.getElementById('output').textContent = JSON.stringify(result.data, null, 2);

        // If tool has linked UI, render it
        if (selectedTool.ui) {
          const uiRes = await fetch('/api/ui/' + selectedTool.ui.id);
          let html = await uiRes.text();
          // Inject data into the HTML
          html = html.replace('window.__MCP_DATA__', JSON.stringify(result.data));
          const blob = new Blob([html], { type: 'text/html' });
          document.getElementById('ui-preview').innerHTML = \`<iframe src="\${URL.createObjectURL(blob)}"></iframe>\`;
        }
      } catch (err) {
        document.getElementById('output').textContent = 'Error: ' + err.message;
      }

      btn.innerHTML = 'Run';
      btn.disabled = false;
    }

    document.getElementById('run-btn').addEventListener('click', runTool);
    loadTools();
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
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
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
      console.error(`SSE transport error (${sessionId}):`, error);
    };

    try {
      await sessionServer.connect(transport);
      console.error(`SSE client connected: ${sessionId}`);
    } catch (error) {
      this.sseSessions.delete(sessionId);
      console.error('Failed to establish SSE connection:', error);
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
      console.error('Failed to process message:', error);
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
        const outputFormat = (tool as any)?.outputFormat;

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
      } catch (error: any) {
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
      } catch (error: any) {
        throw new Error(`Failed to get prompt: ${error.message}`);
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

      // Close HTTP server if running
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
        this.httpServer = null;
      }

      await this.server.close();
      console.error('Server stopped');
    } catch (error: any) {
      console.error(`Error stopping server: ${error.message}`);
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

    try {
      console.error('🔄 Reloading...');

      // Store old instance in case we need to rollback
      const oldInstance = this.mcp;

      // Call shutdown hook on old instance (but keep it for rollback)
      if (oldInstance?.instance?.onShutdown) {
        try {
          await oldInstance.instance.onShutdown();
        } catch (shutdownError: any) {
          console.error(`⚠️  Shutdown hook failed: ${shutdownError.message}`);
          // Continue with reload anyway
        }
      }

      // Reload the file
      const newMcp = await this.loader.reloadFile(this.options.filePath);

      // Success! Update instance and reset failure count
      this.mcp = newMcp;
      this.reloadFailureCount = 0;

      // Send list_changed notifications to inform client of updates
      await this.notifyListsChanged();

      console.error('✅ Reload complete');
    } catch (error: any) {
      this.reloadFailureCount++;

      console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.error(`❌ Reload failed (attempt ${this.reloadFailureCount}/${this.MAX_RELOAD_FAILURES})`);
      console.error(`Error: ${error.message}`);
      console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      if (error.name === 'PhotonInitializationError') {
        console.error(`\n💡 The onInitialize() lifecycle hook failed.`);
        console.error(`   Common causes:`);
        console.error(`   - Database connection failure`);
        console.error(`   - API authentication error`);
        console.error(`   - Missing environment variables`);
        console.error(`   - Invalid configuration`);
      }

      if (this.reloadFailureCount >= this.MAX_RELOAD_FAILURES) {
        console.error(`\n⚠️  Maximum reload failures reached (${this.MAX_RELOAD_FAILURES})`);
        console.error(`   Keeping previous working version active.`);
        console.error(`   Fix the errors and save the file again to retry.`);
        console.error(`\n   Or restart the server: photon mcp <name> --dev`);

        // Reset counter after cooling off
        this.reloadFailureCount = 0;
      } else {
        // Schedule automatic retry
        const retryDelay = Math.min(5000 * this.reloadFailureCount, 15000); // 5s, 10s, 15s max
        console.error(`\n🔄 Will retry reload in ${retryDelay / 1000}s if file changes again...`);
        console.error(`   Previous working version remains active.`);
      }

      // Keep the old instance running - it's still functional
      console.error(`\n✓ Server still running with previous version`);
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
      } as any);

      // Send prompts list changed notification
      await this.server.notification({
        method: 'notifications/prompts/list_changed',
      } as any);

      // Send resources list changed notification
      await this.server.notification({
        method: 'notifications/resources/list_changed',
      } as any);

      console.error('Sent list_changed notifications');
    } catch (error: any) {
      // Notification sending is best-effort - don't fail reload if it fails
      console.error(`Warning: Failed to send list_changed notifications: ${error.message}`);
    }
  }
}
