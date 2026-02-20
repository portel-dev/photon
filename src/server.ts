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
import {
  PhotonClassExtended,
  ConstructorParam,
  getAuditTrail,
  generateExecutionId,
} from '@portel/photon-core';
import type { ExtractedSchema } from '@portel/photon-core';
import type { Marketplace, PhotonMetadata } from './marketplace-manager.js';
import { createSDKMCPClientFactory, type SDKMCPClientFactory } from '@portel/photon-core';
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
import { subscribeChannel, pingDaemon, publishToChannel } from './daemon/client.js';
import { isGlobalDaemonRunning, startGlobalDaemon } from './daemon/manager.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { isLocalRequest, readBody, setSecurityHeaders } from './shared/security.js';

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
export type UIFormat = 'sep-1865' | 'none';

export interface UnresolvedPhoton {
  name: string;
  workingDir: string;
  sources: Array<{ marketplace: Marketplace; metadata?: PhotonMetadata }>;
  recommendation?: string;
}

export interface PhotonServerOptions {
  filePath: string;
  devMode?: boolean;
  transport?: TransportType;
  port?: number;
  logOptions?: LoggerOptions;
  unresolvedPhoton?: UnresolvedPhoton;
}

// SSE session record for managing multiple clients
type SSESession = {
  server: Server;
  transport: SSEServerTransport;
};

/**
 * Context passed to shared handler methods to abstract STDIO vs SSE differences
 */
interface HandlerContext {
  server: Server;
  getInstanceName: () => string | undefined;
  setInstanceName: (name: string) => void;
  sessionId: string;
}

export class PhotonServer {
  private loader: PhotonLoader;
  private mcp: PhotonClassExtended | null = null;
  private server: Server;
  private options: PhotonServerOptions;
  private mcpClientFactory: SDKMCPClientFactory | null = null;
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
  /** Tracked instance name for daemon drift recovery (STDIO path) */
  private daemonInstanceName?: string;
  /** Tracked instance names per SSE session for daemon drift recovery */
  private sseInstanceNames = new Map<string, string>();
  /** Whether client capabilities have been logged (one-time on first tools/list) */
  private clientCapabilitiesLogged = false;
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
    // Validate options (filePath validation skipped for unresolved photons)
    if (!options.unresolvedPhoton) {
      assertString(options.filePath, 'filePath');
      validateOrThrow(options.filePath, [
        notEmpty('filePath'),
        hasExtension('filePath', ['ts', 'js']),
      ]);
    }

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
   * All clients use the MCP Apps standard (SEP-1865) ui:// format.
   * Text-only clients have no UI support.
   */
  private getUIFormat(): UIFormat {
    return 'sep-1865';
  }

  /**
   * Build UI resource URI based on detected format
   */
  private buildUIResourceUri(uiId: string): string {
    const photonName = this.mcp?.name || 'unknown';
    return `ui://${photonName}/${uiId}`;
  }

  /**
   * Build tool metadata for UI based on detected format
   */
  private buildUIToolMeta(uiId: string): Record<string, unknown> {
    const uri = this.buildUIResourceUri(uiId);
    return { ui: { resourceUri: uri } };
  }

  /**
   * Get UI mimeType based on detected format and client capabilities
   */
  private getUIMimeType(): string {
    return 'text/html;profile=mcp-app';
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
    return !!capabilities.elicitation;
  }

  // Known clients that support MCP Apps UI (fallback when capability isn't announced)
  private static readonly UI_CAPABLE_CLIENTS = new Set(['chatgpt', 'mcpjam', 'mcp-inspector']);

  /**
   * Check if client supports MCP Apps UI (structuredContent + _meta.ui)
   *
   * Detection order:
   * 1. capabilities.experimental["io.modelcontextprotocol/ui"] — official MCP Apps negotiation
   * 2. clientInfo.name — fallback for known UI-capable clients
   *
   * Basic/unknown clients get text-only responses (no structuredContent, no _meta.ui).
   */
  private clientSupportsUI(server?: Server): boolean {
    const targetServer = server || this.server;

    // 1. Check capabilities (official MCP Apps negotiation)
    const capabilities = targetServer.getClientCapabilities();
    if (capabilities?.experimental?.['io.modelcontextprotocol/ui']) {
      return true;
    }

    // 2. Check clientInfo.name (fallback for known UI-capable clients)
    const clientInfo = targetServer.getClientVersion();
    if (clientInfo?.name) {
      if (clientInfo.name === 'beam') return true;
      if (PhotonServer.UI_CAPABLE_CLIENTS.has(clientInfo.name)) return true;
    }

    return false;
  }

  /**
   * Log client identity and capabilities for debugging tier detection
   */
  private logClientCapabilities(server: Server): void {
    const clientInfo = server.getClientVersion();
    const capabilities = server.getClientCapabilities();
    const supportsUI = this.clientSupportsUI(server);
    const supportsElicitation = this.clientSupportsElicitation(server);

    this.log('debug', 'Client connected', {
      name: clientInfo?.name ?? 'unknown',
      version: clientInfo?.version ?? 'unknown',
      tier: supportsUI ? 'mcp-apps' : 'basic',
      supportsUI,
      supportsElicitation,
      capabilities: JSON.stringify(capabilities),
    });
  }

  /**
   * Create an MCP-aware input provider for generator ask yields
   *
   * Uses MCP elicitInput() when client supports elicitation,
   * otherwise falls back to readline prompts.
   */
  private createMCPInputProvider(server?: Server): (ask: any) => Promise<any> {
    const targetServer = server || this.server;
    const capabilities = targetServer.getClientCapabilities();
    const supportsElicitation = this.clientSupportsElicitation(server);

    this.log('debug', 'Creating MCP input provider', {
      supportsElicitation,
      capabilities: JSON.stringify(capabilities),
    });

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

  // ─── Shared handler implementations ─────────────────────────────────
  // These methods contain the core logic shared between STDIO and SSE transports.
  // Both setupHandlers() and setupSessionHandlers() delegate to these.

  private handleListTools(ctx: HandlerContext): { tools: any[] } {
    if (!this.mcp) {
      return { tools: [] };
    }

    const tools = this.mcp.tools.map((tool) => {
      const toolDef: any = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };

      const linkedUI = this.mcp?.assets?.ui.find((u) => u.linkedTool === tool.name);
      if (linkedUI && this.clientSupportsUI(ctx.server)) {
        toolDef._meta = this.buildUIToolMeta(linkedUI.id);
      }

      return toolDef;
    });

    // Add runtime-injected instance tools for stateful photons
    if (this.daemonName) {
      tools.push({
        name: '_use',
        description: `Switch to a named instance. Pass empty name for default. Omit name to select interactively.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Instance name. Pass empty string "" for default. Omit entirely to select interactively.',
            },
          },
        },
      });
      tools.push({
        name: '_instances',
        description: `List all available instances.`,
        inputSchema: { type: 'object', properties: {} },
      });
    }

    return { tools };
  }

  private async handleCallTool(ctx: HandlerContext, request: any): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }

    const { name: toolName, arguments: args } = request.params;

    // Route _use and _instances through daemon for stateful photons
    if (this.daemonName && (toolName === '_use' || toolName === '_instances')) {
      const { sendCommand } = await import('./daemon/client.js');
      const sendOpts = {
        photonPath: this.options.filePath,
        sessionId: ctx.sessionId,
        instanceName: ctx.getInstanceName(),
      };

      // Elicitation-based instance selection when _use called without name
      if (
        toolName === '_use' &&
        (!args || !('name' in args)) &&
        this.clientSupportsElicitation(ctx.server)
      ) {
        const instancesResult = (await sendCommand(
          this.daemonName,
          '_instances',
          {},
          sendOpts
        )) as { instances?: string[]; current?: string };
        const instances = instancesResult?.instances || ['default'];

        const options: Array<{ const: string; title: string }> = instances.map((inst: string) => ({
          const: inst,
          title: inst === 'default' ? '(default)' : inst,
        }));
        options.push({ const: '__create_new__', title: 'Create new...' });

        const result = await ctx.server.elicitInput({
          message: 'Select an instance',
          requestedSchema: {
            type: 'object' as const,
            properties: {
              instance: {
                type: 'string',
                title: 'Instance',
                oneOf: options,
                default: instancesResult?.current || 'default',
              },
            },
            required: ['instance'],
          },
        });

        if (result.action !== 'accept' || !result.content) {
          return { content: [{ type: 'text', text: 'Cancelled' }] };
        }

        let selectedName = (result.content as Record<string, string>).instance;

        // Handle "Create new..." selection
        if (selectedName === '__create_new__') {
          const nameResult = await ctx.server.elicitInput({
            message: 'Enter a name for the new instance',
            requestedSchema: {
              type: 'object' as const,
              properties: {
                name: { type: 'string', title: 'Instance name' },
              },
              required: ['name'],
            },
          });

          if (nameResult.action !== 'accept' || !nameResult.content) {
            return { content: [{ type: 'text', text: 'Cancelled' }] };
          }
          selectedName = (nameResult.content as Record<string, string>).name;
        }

        const useResult = await sendCommand(
          this.daemonName,
          '_use',
          { name: selectedName },
          sendOpts
        );
        ctx.setInstanceName(selectedName);
        return {
          content: [{ type: 'text', text: JSON.stringify(useResult, null, 2) }],
        };
      }

      const result = await sendCommand(
        this.daemonName,
        toolName,
        (args || {}) as Record<string, any>,
        sendOpts
      );
      // Track instance name after successful _use
      if (toolName === '_use') {
        ctx.setInstanceName(String((args as Record<string, unknown> | undefined)?.name || ''));
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    // Create MCP-aware input provider for elicitation support
    const inputProvider = this.createMCPInputProvider(ctx.server);

    // Handler for channel events - forward to daemon for cross-process pub/sub
    const outputHandler = (emit: any) => {
      if (this.daemonName && emit?.channel) {
        publishToChannel(this.daemonName, emit.channel, emit).catch(() => {
          // Ignore publish errors - daemon may not be running
        });
      }
    };

    const tool = this.mcp.tools.find((t) => t.name === toolName);
    const outputFormat = tool?.outputFormat;

    const result = await this.loader.executeTool(this.mcp, toolName, args || {}, {
      inputProvider,
      outputHandler,
    });

    const isStateful = result && typeof result === 'object' && result._stateful === true;
    const actualResult = isStateful ? result.result : result;

    // Build content with optional mimeType annotation
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

    const response: any = { content: [content], isError: false };

    // Add x-output-format for format-aware clients
    if (outputFormat) {
      response['x-output-format'] = outputFormat;
    }

    // Add stateful workflow metadata (machine-readable _meta)
    if (isStateful && result.runId) {
      response._meta = { ...response._meta, runId: result.runId, status: result.status };
    }

    // Enrich response with structuredContent + _meta for tools with linked UIs
    const linkedUI = this.mcp?.assets?.ui.find((u) => u.linkedTool === toolName);
    if (linkedUI && this.clientSupportsUI(ctx.server)) {
      if (actualResult !== undefined && actualResult !== null) {
        response.structuredContent =
          typeof actualResult === 'string' ? { text: actualResult } : actualResult;
      }
      const uiMeta = this.buildUIToolMeta(linkedUI.id);
      response._meta = { ...response._meta, ...uiMeta };
    }

    return response;
  }

  private handleListPrompts(): { prompts: any[] } {
    if (!this.mcp) {
      return { prompts: [] };
    }

    return {
      prompts: this.mcp.templates.map((template) => ({
        name: template.name,
        description: template.description,
        arguments: Object.entries(template.inputSchema.properties || {}).map(([name, schema]) => ({
          name,
          description:
            (typeof schema === 'object' && schema && 'description' in schema
              ? (schema.description as string)
              : '') || '',
          required: template.inputSchema.required?.includes(name) || false,
        })),
      })),
    };
  }

  private async handleGetPrompt(request: any): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }

    const { name: promptName, arguments: args } = request.params;

    const template = this.mcp.templates.find((t) => t.name === promptName);
    if (!template) {
      throw new Error(`Prompt not found: ${promptName}`);
    }

    const result = await this.loader.executeTool(this.mcp, promptName, args || {});
    return this.formatTemplateResult(result);
  }

  private handleListResources(ctx: HandlerContext): { resources: any[] } {
    if (!this.mcp) {
      return { resources: [] };
    }

    const staticResources = this.mcp.statics.filter((s) => !this.isUriTemplate(s.uri));

    const resources = staticResources.map((static_) => ({
      uri: static_.uri,
      name: static_.name,
      description: static_.description,
      mimeType: static_.mimeType || 'text/plain',
    }));

    if (this.mcp.assets) {
      const photonName = this.mcp.name;

      for (const ui of this.mcp.assets.ui) {
        const uiUri = ui.uri || this.buildUIResourceUri(ui.id);
        resources.push({
          uri: uiUri,
          name: `ui:${ui.id}`,
          description: ui.linkedTool
            ? `UI template for ${ui.linkedTool} tool`
            : `UI template: ${ui.id}`,
          mimeType: ui.mimeType || this.getUIMimeType(),
        });
      }

      for (const prompt of this.mcp.assets.prompts) {
        resources.push({
          uri: `photon://${photonName}/prompts/${prompt.id}`,
          name: `prompt:${prompt.id}`,
          description: prompt.description || `Prompt template: ${prompt.id}`,
          mimeType: 'text/markdown',
        });
      }

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
  }

  private handleListResourceTemplates(): { resourceTemplates: any[] } {
    if (!this.mcp) {
      return { resourceTemplates: [] };
    }

    const templateResources = this.mcp.statics.filter((s) => this.isUriTemplate(s.uri));

    return {
      resourceTemplates: templateResources.map((static_) => ({
        uriTemplate: static_.uri,
        name: static_.name,
        description: static_.description,
        mimeType: static_.mimeType || 'text/plain',
      })),
    };
  }

  private async handleReadResource(request: any): Promise<any> {
    if (!this.mcp) {
      throw new Error('MCP not loaded');
    }

    const { uri } = request.params;

    const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (uiMatch && this.mcp.assets) {
      const [, _photonName, assetId] = uiMatch;
      return this.handleUIAssetRead(uri, assetId);
    }

    const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(ui|prompts|resources)\/(.+)$/);
    if (assetMatch && this.mcp.assets) {
      return this.handleAssetRead(uri, assetMatch);
    }

    return this.handleStaticRead(uri);
  }

  // ─── Transport-specific setup ─────────────────────────────────────

  /**
   * Set up MCP protocol handlers (STDIO transport)
   */
  private setupHandlers() {
    const ctx: HandlerContext = {
      server: this.server,
      getInstanceName: () => this.daemonInstanceName,
      setInstanceName: (name) => {
        this.daemonInstanceName = name;
      },
      sessionId: `stdio-${this.daemonName}`,
    };

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.clientCapabilitiesLogged) {
        this.clientCapabilitiesLogged = true;
        this.logClientCapabilities(this.server);
      }

      // STDIO-only: deferred conflict resolution
      if (!this.mcp && this.options.unresolvedPhoton) {
        return { tools: this.buildPlaceholderTools() };
      }

      return this.handleListTools(ctx);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // STDIO-only: deferred conflict resolution
      if (!this.mcp && this.options.unresolvedPhoton) {
        await this.resolveUnresolvedPhoton();
      }

      // STDIO-only: @async fire-and-forget execution
      if (this.mcp) {
        const { name: toolName, arguments: args } = request.params;
        const tool = this.mcp.tools.find((t) => t.name === toolName);
        if ((tool as ExtractedSchema)?.isAsync) {
          const executionId = generateExecutionId();
          const inputProvider = this.createMCPInputProvider();
          const outputHandler = (emit: any) => {
            if (this.daemonName && emit?.channel) {
              publishToChannel(this.daemonName, emit.channel, emit).catch(() => {});
            }
          };

          this.loader
            .executeTool(this.mcp, toolName, args || {}, { inputProvider, outputHandler })
            .catch((error) => {
              this.log('error', `Async tool ${toolName} failed`, {
                executionId,
                error: getErrorMessage(error),
              });
            });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    executionId,
                    status: 'running',
                    photon: this.mcp.name,
                    method: toolName,
                    message: `Task started in background. Use execution ID to check status.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      try {
        return await this.handleCallTool(ctx, request);
      } catch (error) {
        // STDIO-only: config elicitation retry
        const { name: toolName, arguments: args } = request.params;
        if (this.mcp?.instance?._photonConfigError && this.clientSupportsElicitation()) {
          const retryResult = await this.attemptConfigElicitation(toolName, args || {});
          if (retryResult) return retryResult;
        }

        // STDIO-only: verbose error logging
        this.log('error', 'Tool execution failed', {
          tool: toolName,
          error: getErrorMessage(error),
          args: this.options.devMode ? args : undefined,
        });
        return this.formatError(error, toolName, args);
      }
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.handleListPrompts();
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        return await this.handleGetPrompt(request);
      } catch (error) {
        // STDIO-only: verbose error logging for prompts
        const { name: promptName } = request.params;
        this.log('error', 'Prompt execution failed', {
          prompt: promptName,
          error: getErrorMessage(error),
        });
        throw error;
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.handleListResources(ctx);
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.handleListResourceTemplates();
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.handleReadResource(request);
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
   * Build placeholder tools from unresolved photon manifest metadata
   */
  private buildPlaceholderTools(): any[] {
    const unresolved = this.options.unresolvedPhoton;
    if (!unresolved) return [];

    // Collect tool names from all source metadata
    const toolNames = new Set<string>();
    for (const source of unresolved.sources) {
      if (source.metadata?.tools) {
        for (const tool of source.metadata.tools) {
          toolNames.add(tool);
        }
      }
    }

    // If no tools in metadata, create a single setup tool
    if (toolNames.size === 0) {
      return [
        {
          name: 'setup',
          description: `Set up ${unresolved.name} — call this tool to begin.`,
          inputSchema: { type: 'object', properties: {} },
        },
      ];
    }

    return Array.from(toolNames).map((name) => ({
      name,
      description: `Requires setup — call to begin.`,
      inputSchema: { type: 'object', properties: {} },
    }));
  }

  /**
   * Resolve an unresolved photon (deferred conflict resolution)
   *
   * If the client supports elicitation, presents marketplace choices.
   * Otherwise, auto-picks the recommendation.
   */
  private async resolveUnresolvedPhoton(): Promise<void> {
    const unresolved = this.options.unresolvedPhoton;
    if (!unresolved) return;

    let selectedSource: { marketplace: Marketplace; metadata?: PhotonMetadata };

    if (unresolved.sources.length === 1) {
      selectedSource = unresolved.sources[0];
    } else if (this.clientSupportsElicitation()) {
      // Present choices via elicitation
      const sourceLabels: Array<{ const: string; title: string }> = [];
      for (const source of unresolved.sources) {
        const version = source.metadata?.version || 'unknown';
        const label = `${source.marketplace.name} (v${version})`;
        sourceLabels.push({ const: source.marketplace.name, title: label });
      }

      const result = await this.server.elicitInput({
        message: `Multiple sources found for "${unresolved.name}". Which marketplace should be used?`,
        requestedSchema: {
          type: 'object' as const,
          properties: {
            marketplace: {
              type: 'string',
              title: 'Marketplace',
              oneOf: sourceLabels,
              default: unresolved.recommendation || unresolved.sources[0].marketplace.name,
            },
          },
          required: ['marketplace'],
        },
      });

      const chosen =
        result.action === 'accept' && result.content
          ? (result.content as Record<string, string>).marketplace
          : unresolved.recommendation;

      selectedSource =
        unresolved.sources.find((s) => s.marketplace.name === chosen) || unresolved.sources[0];
    } else {
      // No elicitation — auto-pick recommendation
      const rec = unresolved.recommendation;
      selectedSource = rec
        ? unresolved.sources.find((s) => s.marketplace.name === rec) || unresolved.sources[0]
        : unresolved.sources[0];
      this.log('info', `Auto-selected marketplace: ${selectedSource.marketplace.name}`);
    }

    // Download and install photon
    await this.downloadAndLoadPhoton(unresolved.name, unresolved.workingDir, selectedSource);
  }

  /**
   * Download a photon from a marketplace source, save to workingDir, and load it
   */
  private async downloadAndLoadPhoton(
    photonName: string,
    workingDir: string,
    source: { marketplace: Marketplace; metadata?: PhotonMetadata }
  ): Promise<void> {
    const { MarketplaceManager } = await import('./marketplace-manager.js');
    const manager = new MarketplaceManager();
    await manager.initialize();

    const result = await manager.fetchMCP(photonName);
    if (!result) {
      throw new Error(`Failed to download photon: ${photonName}`);
    }

    const { photonPath: filePath } = await manager.installPhoton(result, photonName, workingDir);

    // Update options and load
    this.options.filePath = filePath;
    this.options.unresolvedPhoton = undefined;

    this.log('info', `Downloaded and loading ${photonName}...`);
    this.mcp = await this.loader.loadFile(filePath);

    // Notify clients that tools have changed
    await this.notifyListsChanged();
  }

  /**
   * Attempt config elicitation to resolve missing env vars, then retry tool call
   */
  private async attemptConfigElicitation(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any | null> {
    try {
      // Extract constructor params to build form
      const params = await this.loader.extractConstructorParams(this.options.filePath);
      if (params.length === 0) return null;

      const photonName = this.mcp?.name || 'photon';
      const { toEnvVarName } = await import('./shared/config-docs.js');

      // Build form properties from constructor params
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const param of params) {
        const envVarName = toEnvVarName(photonName, param.name);
        const existing = process.env[envVarName];

        // Skip params that already have values
        if (existing) continue;
        // Skip optional params with defaults
        if (param.hasDefault || param.isOptional) continue;

        properties[envVarName] = {
          type:
            param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string',
          title: param.name,
          description: `Environment variable: ${envVarName}`,
        };
        required.push(envVarName);
      }

      if (Object.keys(properties).length === 0) return null;

      const result = await this.server.elicitInput({
        message: `${photonName} requires configuration. Please provide the following:`,
        requestedSchema: {
          type: 'object' as const,
          properties,
          required,
        },
      });

      if (result.action !== 'accept' || !result.content) return null;

      // Set env vars from elicitation response
      const content = result.content as Record<string, string>;
      for (const [key, value] of Object.entries(content)) {
        if (value !== undefined && value !== '') {
          process.env[key] = String(value);
        }
      }

      // Reload photon with new env vars
      this.log('info', 'Reloading photon with elicited configuration...');
      this.mcp = await this.loader.loadFile(this.options.filePath);
      await this.notifyListsChanged();

      // Retry the original tool call
      const inputProvider = this.createMCPInputProvider();
      const outputHandler = (emit: any) => {
        if (this.daemonName && emit?.channel) {
          publishToChannel(this.daemonName, emit.channel, emit).catch((e) => {
            this.log('debug', 'Publish to channel failed', { error: getErrorMessage(e) });
          });
        }
      };

      const retryResult = await this.loader.executeTool(this.mcp!, toolName, args, {
        inputProvider,
        outputHandler,
      });

      const isStateful =
        retryResult && typeof retryResult === 'object' && retryResult._stateful === true;
      const actualResult = isStateful ? retryResult.result : retryResult;

      return {
        content: [{ type: 'text', text: this.formatResult(actualResult) }],
      };
    } catch (error) {
      this.log('warn', `Config elicitation failed: ${getErrorMessage(error)}`);
      return null; // elicitation unsupported by client
    }
  }

  /**
   * Initialize and start the server
   */
  async start() {
    try {
      // If unresolvedPhoton is set, skip loading — defer to first tool call
      if (this.options.unresolvedPhoton) {
        this.log(
          'info',
          `Deferred loading for ${this.options.unresolvedPhoton.name} (${this.options.unresolvedPhoton.sources.length} marketplace sources)`
        );
      } else {
        // Initialize MCP client factory for enabling this.mcp() in Photons
        // This allows Photons to call external MCPs via protocol
        try {
          this.mcpClientFactory = await createSDKMCPClientFactory(this.options.devMode);
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

          if (!isGlobalDaemonRunning()) {
            this.log('info', `Starting daemon for ${photonName}...`);
            await startGlobalDaemon(true);

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
      }

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
   * This enables cross-client real-time updates (e.g., Beam updates show in Claude Desktop)
   *
   * Uses standard MCP Apps notification with embedded _photon data:
   * - Claude Desktop forwards standard notifications (ui/notifications/host-context-changed)
   * - Photon bridge extracts _photon field and routes to event listeners
   * - This ensures cross-client sync works without requiring custom protocol support
   */
  private async handleChannelMessage(message: unknown) {
    if (!message || typeof message !== 'object') return;

    const msg = message as Record<string, unknown>;

    // Use STANDARD notification with embedded photon data
    // Claude Desktop will forward this (it's a standard notification)
    // Our bridge extracts _photon and routes to the appropriate event handler
    const payload = {
      method: 'ui/notifications/host-context-changed',
      params: {
        // _photon field carries our custom event data
        _photon: {
          photon: this.daemonName,
          channel: msg.channel,
          event: msg.event,
          data: msg.data,
        },
      },
    };

    try {
      await this.server.notification(payload);
    } catch (e) {
      this.log('debug', 'Notification send failed', { error: getErrorMessage(e) });
    }

    // Also send to SSE sessions
    for (const session of this.sseSessions.values()) {
      try {
        await session.server.notification(payload);
      } catch (e) {
        this.log('debug', 'Session notification failed', { error: getErrorMessage(e) });
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
      // Security: set standard security headers on all responses
      setSecurityHeaders(res);
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
                  ? { id: linkedUI.id, uri: `ui://${this.mcp!.name}/${linkedUI.id}` }
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
        // Security: restrict CORS to localhost and require local request
        res.setHeader(
          'Access-Control-Allow-Origin',
          `http://localhost:${this.options.port || 3000}`
        );
        res.setHeader('Content-Type', 'application/json');

        if (!isLocalRequest(req)) {
          res.writeHead(403);
          res.end(JSON.stringify({ success: false, error: 'Forbidden: non-local request' }));
          return;
        }

        if (!this.mcp) {
          res.writeHead(503);
          res.end(JSON.stringify({ success: false, error: 'Photon not loaded' }));
          return;
        }

        try {
          const body = await readBody(req);
          const { tool, args } = JSON.parse(body);
          const result = await this.loader.executeTool(this.mcp, tool, args || {});
          const isStateful = result && typeof result === 'object' && result._stateful === true;
          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              data: isStateful ? result.result : result,
            })
          );
        } catch (error: any) {
          const status = error.message?.includes('too large') ? 413 : 500;
          res.writeHead(status);
          res.end(JSON.stringify({ success: false, error: getErrorMessage(error) }));
        }
        return;
      }

      // API: Call tool with streaming progress (SSE)
      if (req.method === 'POST' && url.pathname === '/api/call-stream') {
        res.setHeader(
          'Access-Control-Allow-Origin',
          `http://localhost:${this.options.port || 3000}`
        );
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        if (!this.mcp) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Photon not loaded' }));
          return;
        }

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
              // Forward channel events to daemon for cross-process pub/sub
              if (this.daemonName && emit.channel) {
                publishToChannel(this.daemonName, emit.channel, emit).catch(() => {
                  // Ignore publish errors - daemon may not be running
                });
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
          return null; // skip unloadable photon
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

    // Clean up on close (guard against recursive close:
    // onclose → sessionServer.close() → transport.close() → onclose)
    let closing = false;
    transport.onclose = async () => {
      if (closing) return;
      closing = true;
      this.sseSessions.delete(sessionId);
      this.log('info', 'SSE client disconnected', { sessionId });
      try {
        await sessionServer.close();
      } catch {
        // Ignore errors during cleanup (transport already closed)
      }
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
    this.logClientCapabilities(sessionServer);

    const sseSessionKey = `sse-${this.daemonName}`;
    const ctx: HandlerContext = {
      server: sessionServer,
      getInstanceName: () => this.sseInstanceNames.get(sseSessionKey),
      setInstanceName: (name) => {
        this.sseInstanceNames.set(sseSessionKey, name);
      },
      sessionId: sseSessionKey,
    };

    sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return this.handleListTools(ctx);
    });

    sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        return await this.handleCallTool(ctx, request);
      } catch (error) {
        const { name: toolName, arguments: args } = request.params;
        return this.formatError(error, toolName, args);
      }
    });

    sessionServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      return this.handleListPrompts();
    });

    sessionServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return this.handleGetPrompt(request);
    });

    sessionServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      return this.handleListResources(ctx);
    });

    sessionServer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return this.handleListResourceTemplates();
    });

    sessionServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.handleReadResource(request);
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

    let content = await fs.readFile(ui.resolvedPath, 'utf-8');

    // Inject MCP Apps bridge script for Claude Desktop compatibility
    const bridgeScript = this.generateMcpAppsBridge();
    content = content.replace('<head>', `<head>\n${bridgeScript}`);

    return {
      contents: [{ uri, mimeType: ui.mimeType || 'text/html;profile=mcp-app', text: content }],
    };
  }

  /**
   * Generate minimal MCP Apps bridge script for Claude Desktop compatibility
   * This handles the ui/initialize handshake and tool result delivery
   */
  private generateMcpAppsBridge(): string {
    const photonName = this.mcp?.name || 'photon-app';
    const injectedPhotons = this.mcp?.injectedPhotons || [];
    return `<script>
(function() {
  'use strict';
  var pendingCalls = {};
  var callIdCounter = 0;
  var toolResult = null;
  var resultListeners = [];
  var emitListeners = [];
  var themeListeners = [];
  var eventListeners = {};  // For specific event subscriptions (e.g., 'taskMove')
  var photonEventListeners = {};  // Namespaced by photon name for injected photons
  var currentTheme = 'dark';
  var injectedPhotons = ${JSON.stringify(injectedPhotons)};

  function generateCallId() {
    return 'call_' + (++callIdCounter) + '_' + Math.random().toString(36).slice(2);
  }

  function postToHost(msg) {
    window.parent.postMessage(msg, '*');
  }

  // Listen for messages from host
  window.addEventListener('message', function(e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;

    // Handle JSON-RPC messages
    if (m.jsonrpc === '2.0') {
      // Response to our request (has id, no method)
      if (m.id && !m.method && pendingCalls[m.id]) {
        var pending = pendingCalls[m.id];
        delete pendingCalls[m.id];
        if (m.error) {
          pending.reject(new Error(m.error.message));
        } else {
          // Extract clean data from MCP result format
          var result = m.result;
          var cleanData = result;
          if (result && result.structuredContent) {
            cleanData = result.structuredContent;
          } else if (result && result.content && Array.isArray(result.content)) {
            var textItem = result.content.find(function(i) { return i.type === 'text'; });
            if (textItem && textItem.text) {
              try { cleanData = JSON.parse(textItem.text); } catch(e) { cleanData = textItem.text; }
            }
          }
          pending.resolve(cleanData);
        }
        return;
      }

      // Tool result notification
      if (m.method === 'ui/notifications/tool-result') {
        var result = m.params;
        // Extract data from MCP result format
        if (result.structuredContent) {
          toolResult = result.structuredContent;
        } else if (result.content && Array.isArray(result.content)) {
          var textItem = result.content.find(function(i) { return i.type === 'text'; });
          if (textItem && textItem.text) {
            try { toolResult = JSON.parse(textItem.text); } catch(e) { toolResult = textItem.text; }
          }
        } else {
          toolResult = result;
        }
        // Set __PHOTON_DATA__ for UIs that read it at init
        window.__PHOTON_DATA__ = toolResult;
        // Dispatch event for UIs to re-initialize with new data
        window.dispatchEvent(new CustomEvent('photon:data-ready', { detail: toolResult }));
        resultListeners.forEach(function(cb) { cb(toolResult); });
      }

      // Host context changed (theme + embedded photon events)
      if (m.method === 'ui/notifications/host-context-changed') {
        // Standard theme handling
        if (m.params && m.params.theme) {
          currentTheme = m.params.theme;
          document.documentElement.classList.remove('light', 'dark', 'light-theme');
          document.documentElement.classList.add(m.params.theme);
          document.documentElement.setAttribute('data-theme', m.params.theme);
          // Apply theme token CSS variables (matching platform-compat applyThemeTokens)
          if (m.params.styles && m.params.styles.variables) {
            var root = document.documentElement;
            var vars = m.params.styles.variables;
            for (var key in vars) { root.style.setProperty(key, vars[key]); }
          }
          // Apply background/text colors to match platform-compat bridge
          if (m.params.theme === 'light') {
            document.documentElement.classList.add('light-theme');
            document.documentElement.style.colorScheme = 'light';
            document.documentElement.style.backgroundColor = '#ffffff';
            if (document.body) { document.body.style.backgroundColor = '#ffffff'; document.body.style.color = '#1a1a1a'; }
          } else {
            document.documentElement.style.colorScheme = 'dark';
            document.documentElement.style.backgroundColor = '#0d0d0d';
            if (document.body) { document.body.style.backgroundColor = '#0d0d0d'; document.body.style.color = '#e6e6e6'; }
          }
          themeListeners.forEach(function(cb) { cb(currentTheme); });
        }

        // Extract embedded photon event data
        // This enables real-time sync via standard MCP protocol
        if (m.params && m.params._photon) {
          var photonData = m.params._photon;
          // Route to generic emit listeners
          emitListeners.forEach(function(cb) { cb(photonData); });

          var eventName = photonData.event;
          var sourcePhoton = photonData.data && photonData.data._source;

          // Route to photon-specific listeners if _source is specified (injected photon events)
          if (sourcePhoton && photonEventListeners[sourcePhoton] && photonEventListeners[sourcePhoton][eventName]) {
            photonEventListeners[sourcePhoton][eventName].forEach(function(cb) {
              cb(photonData.data);
            });
          }

          // Also route to global event listeners (main photon events, or fallback)
          if (eventName && eventListeners[eventName]) {
            eventListeners[eventName].forEach(function(cb) {
              cb(photonData.data);
            });
          }
        }
      }
    }
  });

  // Mark that we're in MCP Apps context (not Beam)
  window.__MCP_APPS_CONTEXT__ = true;

  // Expose photon bridge API
  window.photon = {
    get toolOutput() { return toolResult; },
    onResult: function(cb) {
      resultListeners.push(cb);
      if (toolResult) cb(toolResult);
      return function() {
        var i = resultListeners.indexOf(cb);
        if (i >= 0) resultListeners.splice(i, 1);
      };
    },
    callTool: function(name, args) {
      var callId = generateCallId();
      return new Promise(function(resolve, reject) {
        pendingCalls[callId] = { resolve: resolve, reject: reject };
        postToHost({
          jsonrpc: '2.0',
          id: callId,
          method: 'tools/call',
          params: { name: name, arguments: args || {} }
        });
        setTimeout(function() {
          if (pendingCalls[callId]) {
            delete pendingCalls[callId];
            reject(new Error('Tool call timeout'));
          }
        }, 30000);
      });
    },
    invoke: function(name, args) { return window.photon.callTool(name, args); },
    onEmit: function(cb) {
      emitListeners.push(cb);
      return function() {
        var i = emitListeners.indexOf(cb);
        if (i >= 0) emitListeners.splice(i, 1);
      };
    },
    onThemeChange: function(cb) {
      themeListeners.push(cb);
      // Call immediately with current theme
      cb(currentTheme);
      return function() {
        var i = themeListeners.indexOf(cb);
        if (i >= 0) themeListeners.splice(i, 1);
      };
    },
    get theme() { return currentTheme; },

    // Generic event subscription for real-time sync
    // Usage: photon.on('taskMove', function(data) { ... })
    on: function(eventName, cb) {
      if (!eventListeners[eventName]) eventListeners[eventName] = [];
      eventListeners[eventName].push(cb);
      return function() {
        var i = eventListeners[eventName].indexOf(cb);
        if (i >= 0) eventListeners[eventName].splice(i, 1);
      };
    },

    // Photon-specific event subscription (for injected photon events)
    // Usage: photon.onPhoton('notifications', 'alertCreated', function(data) { ... })
    onPhoton: function(photonName, eventName, cb) {
      if (!photonEventListeners[photonName]) photonEventListeners[photonName] = {};
      if (!photonEventListeners[photonName][eventName]) photonEventListeners[photonName][eventName] = [];
      photonEventListeners[photonName][eventName].push(cb);
      return function() {
        var i = photonEventListeners[photonName][eventName].indexOf(cb);
        if (i >= 0) photonEventListeners[photonName][eventName].splice(i, 1);
      };
    }
  };

  // Create direct window object: window.{photonName}
  // This provides a clean class-like API that mirrors server methods:
  //   Server: this.emit('taskMove', data)
  //   Client: kanban.onTaskMove(cb) - subscribe to events
  //   Client: kanban.taskMove(args) - call server method
  var photonName = '${photonName}';
  window[photonName] = new Proxy({}, {
    get: function(target, prop) {
      if (typeof prop !== 'string') return undefined;

      // onEventName -> subscribe to 'eventName' event
      // e.g., onTaskMove -> subscribe to 'taskMove'
      if (prop.startsWith('on') && prop.length > 2) {
        var eventName = prop.charAt(2).toLowerCase() + prop.slice(3);
        return function(cb) {
          return window.photon.on(eventName, cb);
        };
      }

      // methodName -> call server tool
      // e.g., taskMove(args) -> photon.callTool('taskMove', args)
      return function(args) {
        return window.photon.callTool(prop, args);
      };
    }
  });

  // Create proxies for injected photons (for event subscriptions)
  // e.g., notifications.onAlertCreated(cb) subscribes to 'alertCreated' from 'notifications' photon
  injectedPhotons.forEach(function(injectedName) {
    window[injectedName] = new Proxy({}, {
      get: function(target, prop) {
        if (typeof prop !== 'string') return undefined;

        // onEventName -> subscribe to photon-specific event
        if (prop.startsWith('on') && prop.length > 2) {
          var eventName = prop.charAt(2).toLowerCase() + prop.slice(3);
          return function(cb) {
            return window.photon.onPhoton(injectedName, eventName, cb);
          };
        }

        // Method calls on injected photons are not supported from client
        // (injected photon methods are only available server-side)
        return undefined;
      }
    });
  });

  // Size notification helper
  function sendSizeChanged() {
    var body = document.body;
    var root = document.documentElement;

    // Calculate actual content dimensions
    var width = Math.max(
      body.scrollWidth,
      body.offsetWidth,
      root.clientWidth,
      root.scrollWidth,
      root.offsetWidth
    );
    var height = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      root.clientHeight,
      root.scrollHeight,
      root.offsetHeight
    );

    // Check for scrollable containers with overflow:hidden that hide true content size
    var containers = document.querySelectorAll('.board, [style*="overflow"]');
    containers.forEach(function(el) {
      if (el.scrollWidth > width) width = el.scrollWidth;
      if (el.scrollHeight > height) height = el.scrollHeight;
    });

    // For kanban-style boards, calculate from column count
    var columns = document.querySelectorAll('.column');
    if (columns.length > 0) {
      var columnWidth = 220; // min-width + gap
      var boardPadding = 48;
      var neededWidth = (columns.length * columnWidth) + boardPadding;
      if (neededWidth > width) width = neededWidth;
    }

    // Reasonable minimums, maximums, and padding
    width = Math.max(width, 600) + 32;
    // Force minimum height for kanban-style boards
    // header(120) + column headers(50) + 3-4 cards(450) = 620
    if (columns.length > 0) {
      height = Math.max(height, 620);
    } else {
      height = Math.max(height, 400);
    }

    postToHost({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { width: width, height: height }
    });
  }

  // MCP Apps handshake: send ui/initialize and wait for response
  var initId = generateCallId();
  pendingCalls[initId] = {
    resolve: function(result) {
      // Apply theme from host context (matching platform-compat bridge)
      if (result.hostContext && result.hostContext.theme) {
        currentTheme = result.hostContext.theme;
        document.documentElement.classList.remove('light', 'dark', 'light-theme');
        document.documentElement.classList.add(result.hostContext.theme);
        document.documentElement.setAttribute('data-theme', result.hostContext.theme);
        // Apply theme token CSS variables from host context
        if (result.hostContext.styles && result.hostContext.styles.variables) {
          var root = document.documentElement;
          var vars = result.hostContext.styles.variables;
          for (var key in vars) { root.style.setProperty(key, vars[key]); }
        }
        if (result.hostContext.theme === 'light') {
          document.documentElement.classList.add('light-theme');
          document.documentElement.style.colorScheme = 'light';
        } else {
          document.documentElement.style.colorScheme = 'dark';
        }
      }
      // Complete handshake
      postToHost({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });

      // Set up size notifications after handshake
      setTimeout(sendSizeChanged, 100);
      var resizeObserver = new ResizeObserver(function() {
        sendSizeChanged();
      });
      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
    },
    reject: function(err) { console.error('MCP Apps init failed:', err); }
  };

  postToHost({
    jsonrpc: '2.0',
    id: initId,
    method: 'ui/initialize',
    params: {
      appInfo: { name: '${photonName}', version: '1.0.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }
  });
})();
</script>`;
  }

  /**
   * Handle photon:// asset read (Beam format)
   */
  private async handleAssetRead(uri: string, assetMatch: RegExpMatchArray) {
    const [, _photonName, assetType, assetId] = assetMatch;

    let resolvedPath: string | undefined;
    let mimeType: string = 'text/plain';

    if (assetType === 'ui') {
      const ui = this.mcp!.assets!.ui.find((u) => u.id === assetId);
      if (ui) {
        resolvedPath = ui.resolvedPath;
        mimeType = ui.mimeType || 'text/html;profile=mcp-app';
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
      let content = await fs.readFile(resolvedPath, 'utf-8');

      // Inject MCP Apps bridge for UI assets
      if (assetType === 'ui') {
        const bridgeScript = this.generateMcpAppsBridge();
        content = content.replace('<head>', `<head>\n${bridgeScript}`);
      }

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
    } catch (e) {
      this.log('debug', 'Notification send failed', { error: getErrorMessage(e) });
    }

    for (const session of this.sseSessions.values()) {
      try {
        await session.server.notification(payload);
      } catch (e) {
        this.log('debug', 'Session notification failed', { error: getErrorMessage(e) });
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
