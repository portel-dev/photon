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
} from '@modelcontextprotocol/sdk/types.js';
import { PhotonLoader } from './loader.js';
import { PhotonMCPClass } from './types.js';

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
}

export class PhotonServer {
  private loader: PhotonLoader;
  private mcp: PhotonMCPClass | null = null;
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
          tools: {},
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

      console.error('[Photon] Reload complete');
    } catch (error: any) {
      console.error(`[Photon] Reload failed: ${error.message}`);
      // Keep the old instance running
    }
  }
}
