/**
 * Photon MCP Server
 *
 * Wraps a .photon.ts file as an MCP server using @modelcontextprotocol/sdk
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PhotonLoader } from './loader.js';
import { PhotonMCPClassExtended, Template, Static, TemplateResponse, TemplateMessage } from './types.js';

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
}

export class PhotonServer {
  private loader: PhotonLoader;
  private mcp: PhotonMCPClassExtended | null = null;
  private server: Server;
  private options: PhotonServerOptions;

  constructor(options: PhotonServerOptions) {
    this.options = options;
    this.loader = new PhotonLoader();

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
        tools: this.mcp.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
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

        // Normalize result to MCP tool response format
        return {
          content: [
            {
              type: 'text',
              text: this.formatResult(result),
            },
          ],
        };
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

    // Handle resources/list
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (!this.mcp) {
        return { resources: [] };
      }

      return {
        resources: this.mcp.statics.map(static_ => ({
          uri: static_.uri,
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
      // Load the Photon MCP file
      console.error(`[Photon] Loading ${this.options.filePath}...`);
      this.mcp = await this.loader.loadFile(this.options.filePath);

      // Connect to stdio transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error(`[Photon] Server started: ${this.mcp.name}`);

      // In dev mode, we could set up file watching here
      if (this.options.devMode) {
        console.error('[Photon] Dev mode enabled - hot reload active');
      }
    } catch (error: any) {
      console.error(`[Photon] Failed to start server: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
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

      await this.server.close();
      console.error('[Photon] Server stopped');
    } catch (error: any) {
      console.error(`[Photon] Error stopping server: ${error.message}`);
    }
  }

  /**
   * Reload the MCP file (for dev mode hot reload)
   */
  async reload() {
    try {
      console.error('[Photon] Reloading...');

      // Call shutdown hook on old instance
      if (this.mcp?.instance?.onShutdown) {
        await this.mcp.instance.onShutdown();
      }

      // Reload the file
      this.mcp = await this.loader.reloadFile(this.options.filePath);

      // Send list_changed notifications to inform client of updates
      await this.notifyListsChanged();

      console.error('[Photon] Reload complete');
    } catch (error: any) {
      console.error(`[Photon] Reload failed: ${error.message}`);
      // Keep the old instance running
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

      console.error('[Photon] Sent list_changed notifications');
    } catch (error: any) {
      // Notification sending is best-effort - don't fail reload if it fails
      console.error(`[Photon] Warning: Failed to send list_changed notifications: ${error.message}`);
    }
  }
}
