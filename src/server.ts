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
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { PhotonLoader } from './loader.js';
import { PhotonMCPClassExtended } from '@portel/photon-core';
import { createStandaloneMCPClientFactory, StandaloneMCPClientFactory } from './mcp-client.js';
import { PHOTON_VERSION } from './version.js';
import { createLogger, Logger, LoggerOptions, LogLevel } from './shared/logger.js';
import { getErrorMessage } from './shared/error-handler.js';
import {
  validateOrThrow,
  assertString,
  notEmpty,
  inRange,
  oneOf,
  hasExtension,
} from './shared/validation.js';
import { generatePlaygroundHTML } from './auto-ui/playground-html.js';
import { subscribeChannel, pingDaemon, reloadDaemon } from './daemon/client.js';
import { isDaemonRunning, startDaemon } from './daemon/manager.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';

export class HotReloadDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotReloadDisabledError';
  }
}

export type TransportType = 'stdio' | 'sse';

/**
 * UI format types for client compatibility
 * - 'sep-1865': SEP-1865 standard (Anthropic + OpenAI unified format)
 * - 'photon': Legacy Photon format
 * - 'none': Text-only, no UI support
 */
export type UIFormat = 'sep-1865' | 'photon' | 'none';

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
  private lastReloadError?: {
    message: string;
    stack?: string;
    timestamp: number;
    attempts: number;
  };
  private statusClients: Set<ServerResponse> = new Set();
  private channelUnsubscribers: Array<() => void> = [];
  private daemonName: string | null = null;
  private currentStatus: {
    type: 'info' | 'success' | 'error' | 'warn';
    message: string;
    timestamp: number;
  } = {
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
      hasExtension('filePath', ['ts', 'js']),
    ]);

    if (options.transport) {
      validateOrThrow(options.transport, [oneOf<TransportType>('transport', ['stdio', 'sse'])]);
    }

    if (options.port !== undefined) {
      validateOrThrow(options.port, [inRange('port', 1, 65535)]);
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

    this.loader = new PhotonLoader(
      true,
      this.logger.child({ component: 'photon-loader', scope: 'loader' })
    );

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
          // Note: Server doesn't declare elicitation capability - that's a client capability
          // The server uses elicitInput() when the client has elicitation support
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
   * Detect UI format based on client capabilities
   *
   * SEP-1865 clients advertise ui capability in experimental or root capabilities.
   * Legacy Photon clients may not have explicit UI capability but support photon:// URIs.
   * Text-only clients have no UI support.
   *
   * @param server - Optional server instance (for SSE sessions), defaults to main server
   */
  private getUIFormat(server?: Server): UIFormat {
    const targetServer = server || this.server;
    const capabilities = targetServer.getClientCapabilities();

    if (!capabilities) {
      // Before initialization or no capabilities - assume legacy Photon
      return 'photon';
    }

    // Check for SEP-1865 UI capability
    // SEP-1865 clients advertise: { experimental: { ui: {} } } or { ui: {} }
    const experimental = capabilities.experimental as Record<string, unknown> | undefined;
    if (experimental?.ui || (capabilities as any).ui) {
      return 'sep-1865';
    }

    // Check client info for known SEP-1865 compatible clients
    const clientInfo = (targetServer as any)._clientVersion;
    if (clientInfo?.name) {
      const name = clientInfo.name.toLowerCase();
      // Known SEP-1865 compatible clients
      if (name.includes('claude') || name.includes('chatgpt') || name.includes('openai')) {
        return 'sep-1865';
      }
    }

    // Default to Photon format for backward compatibility
    return 'photon';
  }

  /**
   * Build UI resource URI based on detected format
   *
   * @param uiId - UI template identifier
   * @param server - Optional server instance (for SSE sessions)
   */
  private buildUIResourceUri(uiId: string, server?: Server): string {
    const format = this.getUIFormat(server);
    const photonName = this.mcp?.name || 'unknown';

    switch (format) {
      case 'sep-1865':
        return `ui://${photonName}/${uiId}`;
      case 'photon':
      default:
        return `photon://${photonName}/ui/${uiId}`;
    }
  }

  /**
   * Build tool metadata for UI based on detected format
   *
   * @param uiId - UI template identifier
   * @param server - Optional server instance (for SSE sessions)
   */
  private buildUIToolMeta(uiId: string, server?: Server): Record<string, unknown> {
    const format = this.getUIFormat(server);
    const uri = this.buildUIResourceUri(uiId, server);

    switch (format) {
      case 'sep-1865':
        return { 'ui/resourceUri': uri };
      case 'photon':
      default:
        return { outputTemplate: uri };
    }
  }

  /**
   * Get UI mimeType based on detected format
   *
   * @param server - Optional server instance (for SSE sessions)
   */
  private getUIMimeType(server?: Server): string {
    const format = this.getUIFormat(server);
    return format === 'sep-1865' ? 'text/html+mcp' : 'text/html';
  }

  /**
   * Check if client supports elicitation
   *
   * Elicitation is a client capability declared during initialization.
   * The server can use elicitInput() when the client supports it.
   */
  private clientSupportsElicitation(server?: Server): boolean {
    const targetServer = server || this.server;
    const capabilities = targetServer.getClientCapabilities();

    if (!capabilities) {
      return false;
    }

    // Check for elicitation capability (MCP 2025-06 spec)
    return !!(capabilities as any).elicitation;
  }

  /**
   * Create an MCP-aware input provider for generator ask yields
   *
   * Uses MCP elicitInput() when client supports elicitation,
   * otherwise falls back to readline prompts.
   */
  private createMCPInputProvider(server?: Server): (ask: any) => Promise<any> {
    const targetServer = server || this.server;
    const supportsElicitation = this.clientSupportsElicitation(server);

    return async (ask: any): Promise<any> => {
      // If client doesn't support elicitation, fall back to logging the ask
      // (MCP servers can't use readline - they communicate via protocol)
      if (!supportsElicitation) {
        this.log('warn', `Client doesn't support elicitation, ask will be skipped`, {
          ask: ask.ask,
          message: ask.message,
        });
        // Return default values for non-elicitation clients
        return this.getDefaultForAsk(ask);
      }

      try {
        // Build elicitation request based on ask type
        const elicitParams = this.buildElicitParams(ask);

        // Call server.elicitInput() to request user input from the client
        const result = await targetServer.elicitInput(elicitParams);

        if (result.action === 'accept' && result.content) {
          // Extract the value from the response content
          return this.extractElicitValue(ask, result.content);
        } else if (result.action === 'decline' || result.action === 'cancel') {
          this.log('info', `User ${result.action}ed elicitation`, { ask: ask.ask });
          return this.getDefaultForAsk(ask);
        }

        return this.getDefaultForAsk(ask);
      } catch (error) {
        this.log('error', `Elicitation failed`, { ask: ask.ask, error: getErrorMessage(error) });
        return this.getDefaultForAsk(ask);
      }
    };
  }

  /**
   * Build MCP elicit request params from a Photon ask yield
   */
  private buildElicitParams(ask: any): any {
    const baseMessage = ask.message || 'Please provide input';

    switch (ask.ask) {
      case 'text':
      case 'password':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                title: ask.label || 'Input',
                description: ask.hint || ask.message,
                default: ask.default,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      case 'confirm':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              confirmed: {
                type: 'boolean',
                title: 'Confirm',
                description: ask.message,
                default: ask.default ?? false,
              },
            },
            required: ['confirmed'],
          },
        };

      case 'number':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'number',
                title: ask.label || 'Number',
                description: ask.hint || ask.message,
                default: ask.default,
                minimum: ask.min,
                maximum: ask.max,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      case 'select':
        // For select, we use enum in the schema
        const options = (ask.options || []).map((o: any) => (typeof o === 'string' ? o : o.value));
        const labels = (ask.options || []).map((o: any) => (typeof o === 'string' ? o : o.label));
        return {
          mode: 'form',
          message: baseMessage + (ask.multi ? ' (select multiple)' : ''),
          requestedSchema: {
            type: 'object',
            properties: {
              selection: ask.multi
                ? {
                    type: 'array',
                    items: { type: 'string', enum: options },
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                  }
                : {
                    type: 'string',
                    enum: options,
                    title: ask.label || 'Selection',
                    description: `Options: ${labels.join(', ')}`,
                  },
            },
            required: ask.required !== false ? ['selection'] : [],
          },
        };

      case 'date':
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                format: 'date',
                title: ask.label || 'Date',
                description: ask.hint || ask.message,
                default: ask.default,
              },
            },
            required: ask.required !== false ? ['value'] : [],
          },
        };

      default:
        // Generic text input for unknown types
        return {
          mode: 'form',
          message: baseMessage,
          requestedSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                title: 'Input',
              },
            },
          },
        };
    }
  }

  /**
   * Extract value from elicitation response content
   */
  private extractElicitValue(ask: any, content: Record<string, any>): any {
    switch (ask.ask) {
      case 'confirm':
        return content.confirmed ?? false;
      case 'select':
        return content.selection;
      default:
        return content.value;
    }
  }

  /**
   * Get default value for an ask when elicitation is not available or declined
   */
  private getDefaultForAsk(ask: any): any {
    if ('default' in ask) {
      return ask.default;
    }

    switch (ask.ask) {
      case 'confirm':
        return false;
      case 'number':
        return 0;
      case 'select':
        return ask.multi ? [] : null;
      case 'date':
        return new Date().toISOString().split('T')[0];
      default:
        return '';
    }
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
        tools: this.mcp.tools.map((tool) => {
          const toolDef: any = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };

          // Add _meta with UI template reference (format depends on client capabilities)
          const linkedUI = this.mcp?.assets?.ui.find((u) => u.linkedTool === tool.name);
          if (linkedUI) {
            toolDef._meta = this.buildUIToolMeta(linkedUI.id);
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
        // Create MCP-aware input provider for elicitation support
        const inputProvider = this.createMCPInputProvider();

        const result = await this.loader.executeTool(this.mcp, toolName, args || {}, {
          inputProvider,
        });

        // Find the tool to get its outputFormat
        const tool = this.mcp.tools.find((t) => t.name === toolName);
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
            text:
              `\n\n---\n📋 **Workflow Run**: ${result.runId}\n` +
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
        prompts: this.mcp.templates.map((template) => ({
          name: template.name,
          description: template.description,
          arguments: Object.entries(template.inputSchema.properties || {}).map(
            ([name, schema]) => ({
              name,
              description:
                (typeof schema === 'object' && schema && 'description' in schema
                  ? (schema.description as string)
                  : '') || '',
              required: template.inputSchema.required?.includes(name) || false,
            })
          ),
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
      const template = this.mcp.templates.find((t) => t.name === promptName);
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
      const staticResources = this.mcp.statics.filter((s) => !this.isUriTemplate(s.uri));

      const resources = staticResources.map((static_) => ({
        uri: static_.uri,
        name: static_.name,
        description: static_.description,
        mimeType: static_.mimeType || 'text/plain',
      }));

      // Add assets from asset folder (UI, prompts, resources)
      if (this.mcp.assets) {
        const photonName = this.mcp.name;

        // Add UI assets (format depends on client capabilities)
        for (const ui of this.mcp.assets.ui) {
          // Use pre-generated URI from loader, or build one
          const uiUri = (ui as any).uri || this.buildUIResourceUri(ui.id);
          resources.push({
            uri: uiUri,
            name: `ui:${ui.id}`,
            description: ui.linkedTool
              ? `UI template for ${ui.linkedTool} tool`
              : `UI template: ${ui.id}`,
            mimeType: ui.mimeType || this.getUIMimeType(),
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
      const templateResources = this.mcp.statics.filter((s) => this.isUriTemplate(s.uri));

      return {
        resourceTemplates: templateResources.map((static_) => ({
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

      // Check for SEP-1865 ui:// URI format
      const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
      if (uiMatch && this.mcp.assets) {
        const [, _photonName, assetId] = uiMatch;
        return this.handleUIAssetRead(uri, assetId);
      }

      // Check for legacy photon:// asset URI format
      const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/);
      if (assetMatch && this.mcp.assets) {
        return this.handleAssetRead(uri, assetMatch);
      }

      // Handle static resources
      return this.handleStaticRead(uri);
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
      suggestion =
        'The tool implementation may have an issue. Check that all methods are properly defined.';
    } else if (errorMessage.includes('required') || errorMessage.includes('validation')) {
      errorType = 'validation_error';
      suggestion = 'Check the parameters provided match the tool schema requirements.';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      errorType = 'timeout_error';
      suggestion = 'The operation took too long. Try again or check external service availability.';
    } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('network')) {
      errorType = 'network_error';
      suggestion =
        'Cannot connect to external service. Check network connection and service availability.';
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

      // Check if photon is stateful (requires daemon)
      const extractor = new PhotonDocExtractor(this.options.filePath);
      const metadata = await extractor.extractFullMetadata();
      const isStateful = metadata.stateful;

      // Start daemon for stateful photons (enables cross-client communication)
      if (isStateful) {
        const photonName = metadata.name;
        this.daemonName = photonName; // Store for subscription
        this.log('info', `Stateful photon detected: ${photonName}`);

        if (!isDaemonRunning(photonName)) {
          this.log('info', `Starting daemon for ${photonName}...`);
          await startDaemon(photonName, this.options.filePath, true);

          // Wait for daemon to be ready
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (await pingDaemon(photonName)) {
              this.log('info', `Daemon ready for ${photonName}`);
              break;
            }
          }
        } else {
          this.log('info', `Daemon already running for ${photonName}`);
        }
      }

      // Load the Photon MCP file
      this.log('info', `Loading ${this.options.filePath}...`);
      this.mcp = await this.loader.loadFile(this.options.filePath);

      // Subscribe to daemon channels for cross-process notifications
      await this.subscribeToChannels();

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
   * Subscribe to daemon channels for cross-process notifications
   * This enables real-time updates when other processes (e.g., Beam UI, other MCP clients) modify data
   */
  private async subscribeToChannels() {
    // Only subscribe if we have a daemon running (stateful photon)
    if (!this.daemonName) return;

    try {
      // Subscribe to wildcard channel for all events from this photon
      // E.g., "kanban:*" receives "kanban:photon", "kanban:my-board", etc.
      const unsubscribe = await subscribeChannel(
        this.daemonName,
        `${this.daemonName}:*`,
        (message: unknown) => {
          this.handleChannelMessage(message);
        }
      );
      this.channelUnsubscribers.push(unsubscribe);
      this.log('info', `Subscribed to daemon channel: ${this.daemonName}:*`);
    } catch (error) {
      this.log('warn', `Failed to subscribe to daemon: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Handle incoming channel messages and forward as MCP notifications
   */
  private async handleChannelMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;

    const msg = message as Record<string, unknown>;

    // Format message for display
    const displayMessage = msg.event
      ? `[${msg.event}] ${JSON.stringify(msg.data || {})}`
      : JSON.stringify(msg);

    // Forward as MCP status notification to all connected clients
    const payload = {
      method: 'notifications/status',
      params: { type: 'info', message: displayMessage },
    };

    try {
      await this.server.notification(payload);
    } catch {
      // ignore - client may not support notifications
    }

    // Also send to SSE sessions
    for (const session of this.sseSessions.values()) {
      try {
        await session.server.notification(payload);
      } catch {
        // ignore session errors
      }
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
        res.end(
          JSON.stringify({
            name: this.mcp?.name || 'photon-mcp',
            transport: 'sse',
            endpoints,
            tools: this.mcp?.tools.length || 0,
            assets: this.mcp?.assets
              ? {
                  ui: this.mcp.assets.ui.length,
                  prompts: this.mcp.assets.prompts.length,
                  resources: this.mcp.assets.resources.length,
                }
              : null,
          })
        );
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
          const tools =
            this.mcp?.tools.map((tool) => {
              const linkedUI = this.mcp?.assets?.ui.find((u) => u.linkedTool === tool.name);
              return {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                ui: linkedUI
                  ? { id: linkedUI.id, uri: `photon://${this.mcp!.name}/ui/${linkedUI.id}` }
                  : null,
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
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { tool, args } = JSON.parse(body);
            const result = await this.loader.executeTool(this.mcp!, tool, args || {});
            const isStateful = result && typeof result === 'object' && result._stateful === true;
            res.writeHead(200);
            res.end(
              JSON.stringify({
                success: true,
                data: isStateful ? result.result : result,
              })
            );
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
        req.on('data', (chunk) => (body += chunk));
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
        const ui = this.mcp?.assets?.ui.find((u) => u.id === uiId);

        if (ui?.resolvedPath) {
          try {
            const content = await fs.readFile(ui.resolvedPath, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'text/html',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(content);
            return;
          } catch {
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
          const loader = new PhotonLoader(
            this.devMode,
            this.logger.child({ component: 'photon-loader', scope: 'discovery' })
          );
          const mcp = await loader.loadFile(file);
          return {
            name: mcp.name,
            description: mcp.description,
            file: file.replace(DEFAULT_PHOTON_DIR + '/', ''),
            tools: mcp.tools.map((tool) => ({
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

    return photons.filter((p) => p !== null);
  }

  /**
   * Generate playground HTML for interactive testing
   */
  private async getPlaygroundHTML(port: number): Promise<string> {
    const name = this.mcp?.name || 'photon-mcp';
    return generatePlaygroundHTML({ name, port });
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
        tools: this.mcp.tools.map((tool) => {
          const toolDef: any = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };

          // Add _meta with UI template reference (format depends on client capabilities)
          const linkedUI = this.mcp?.assets?.ui.find((u) => u.linkedTool === tool.name);
          if (linkedUI) {
            toolDef._meta = this.buildUIToolMeta(linkedUI.id, sessionServer);
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
        // Create MCP-aware input provider for elicitation support (use sessionServer for SSE)
        const inputProvider = this.createMCPInputProvider(sessionServer);

        const result = await this.loader.executeTool(this.mcp, toolName, args || {}, {
          inputProvider,
        });
        const tool = this.mcp.tools.find((t) => t.name === toolName);
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
        prompts: this.mcp.templates.map((template) => ({
          name: template.name,
          description: template.description,
          arguments: template.inputSchema?.properties
            ? Object.entries(template.inputSchema.properties).map(
                ([name, schema]: [string, any]) => ({
                  name,
                  description: schema.description || '',
                  required: template.inputSchema?.required?.includes(name) || false,
                })
              )
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

      // Add asset resources (UI format depends on client capabilities)
      if (this.mcp.assets) {
        for (const ui of this.mcp.assets.ui) {
          // Use pre-generated URI from loader, or build one
          const uiUri = (ui as any).uri || this.buildUIResourceUri(ui.id, sessionServer);
          resources.push({
            uri: uiUri,
            name: `ui:${ui.id}`,
            description: ui.linkedTool
              ? `UI template for ${ui.linkedTool} tool`
              : `UI template: ${ui.id}`,
            mimeType: ui.mimeType || this.getUIMimeType(sessionServer),
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
          .filter((static_) => this.isUriTemplate(static_.uri))
          .map((static_) => ({
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

      // Check for SEP-1865 ui:// URI format
      const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
      if (uiMatch && this.mcp.assets) {
        const [, _photonName, assetId] = uiMatch;
        return this.handleUIAssetRead(uri, assetId);
      }

      // Check for legacy photon:// asset URI format
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
  /**
   * Handle SEP-1865 ui:// resource read
   */
  private async handleUIAssetRead(uri: string, assetId: string) {
    const ui = this.mcp!.assets!.ui.find((u) => u.id === assetId);
    if (!ui || !ui.resolvedPath) {
      throw new Error(`UI asset not found: ${uri}`);
    }

    const content = await fs.readFile(ui.resolvedPath, 'utf-8');
    return {
      contents: [{ uri, mimeType: ui.mimeType || 'text/html+mcp', text: content }],
    };
  }

  /**
   * Handle legacy photon:// asset read
   */
  private async handleAssetRead(uri: string, assetMatch: RegExpMatchArray) {
    const [, _photonName, assetType, assetId] = assetMatch;

    let resolvedPath: string | undefined;
    let mimeType: string = 'text/plain';

    if (assetType === 'ui') {
      const ui = this.mcp!.assets!.ui.find((u) => u.id === assetId);
      if (ui) {
        resolvedPath = ui.resolvedPath;
        mimeType = ui.mimeType || 'text/html';
      }
    } else if (assetType === 'prompts') {
      const prompt = this.mcp!.assets!.prompts.find((p) => p.id === assetId);
      if (prompt) {
        resolvedPath = prompt.resolvedPath;
        mimeType = 'text/markdown';
      }
    } else if (assetType === 'resources') {
      const resource = this.mcp!.assets!.resources.find((r) => r.id === assetId);
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
    const static_ = this.mcp!.statics.find(
      (s) => s.uri === uri || this.matchUriPattern(s.uri, uri)
    );
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
      for (const [_sessionId, session] of this.sseSessions) {
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
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          hasUI: Boolean(assets.ui?.some((ui) => ui.linkedTool === tool.name)),
        })),
        uiAssets: (assets.ui || []).map((ui) => ({ id: ui.id, linkedTool: ui.linkedTool })),
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
      throw new HotReloadDisabledError(
        'Hot reload temporarily disabled after repeated failures. Restart Photon or fix the errors to re-enable.'
      );
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

      // If daemon is running for this photon, reload it too
      if (this.daemonName && isDaemonRunning(this.daemonName)) {
        try {
          const result = await reloadDaemon(this.daemonName, this.options.filePath);
          if (result.success) {
            this.log('info', 'Daemon reloaded', { sessionsUpdated: result.sessionsUpdated });
          } else {
            this.log('warn', 'Daemon reload failed', { error: result.error });
          }
        } catch (err) {
          this.log('warn', 'Daemon reload failed, may need manual restart', {
            error: getErrorMessage(err),
          });
        }
      }

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
        throw new HotReloadDisabledError(
          'Hot reload disabled after repeated failures. Restart Photon dev server once the errors are resolved.'
        );
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
      this.log('warn', 'Failed to send list_changed notifications', {
        error: getErrorMessage(error),
      });
    }
  }
}
