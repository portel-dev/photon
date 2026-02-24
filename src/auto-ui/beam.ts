/**
 * Photon Beam - Interactive Control Panel
 *
 * A unified UI to interact with all your photons.
 * Uses MCP Streamable HTTP (POST + SSE) for real-time communication.
 * Version: 2.0.0 (SSE Architecture)
 */

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs/promises';
import { existsSync, lstatSync, mkdirSync, realpathSync, watch, type FSWatcher } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { setSecurityHeaders, SimpleRateLimiter } from '../shared/security.js';

/**
 * Generate a unique ID for a photon based on its path.
 * This ensures photons with the same name from different paths are distinguishable.
 * Returns first 12 chars of SHA-256 hash for brevity while maintaining uniqueness.
 */
function generatePhotonId(photonPath: string): string {
  return createHash('sha256').update(photonPath).digest('hex').slice(0, 12);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Race a promise against a timeout. Clears the timer when the main promise settles. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
// WebSocket removed - now using MCP Streamable HTTP (SSE) only
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
import { PhotonDocExtractor } from '../photon-doc-extractor.js';
import { TemplateManager } from '../template-manager.js';
import { subscribeChannel, pingDaemon } from '../daemon/client.js';
import { ensureDaemon } from '../daemon/manager.js';
import {
  SchemaExtractor,
  type PhotonYield,
  type OutputHandler,
  type InputProvider,
  type AskYield,
  type ConstructorParam,
  generateSmartRenderingJS,
  generateSmartRenderingCSS,
} from '@portel/photon-core';
import {
  generateTemplateEngineJS,
  generateTemplateEngineCSS,
} from './rendering/template-engine.js';
import { generateOpenAPISpec } from './openapi-generator.js';
import {
  handleStreamableHTTP,
  broadcastNotification,
  broadcastToBeam,
  sendToSession,
  requestExternalElicitation,
} from './streamable-http-transport.js';
// MCPServer type removed - no longer needed for WebSocket transport
import type {
  PhotonInfo,
  UnconfiguredPhotonInfo,
  AnyPhotonInfo,
  ConfigParam,
  MethodInfo,
  InvokeRequest,
  ConfigureRequest,
  ElicitationResponse,
  CancelRequest,
  ReloadRequest,
  RemoveRequest,
  ExternalMCPInfo,
  MCPServerConfig,
} from './types.js';
import { SDKMCPClientFactory, type MCPConfig } from '@portel/photon-core';
import { getBundledPhotonPath, BEAM_BUNDLED_PHOTONS } from '../shared-utils.js';
// SDK imports for direct resource access (transport wrapper doesn't expose these yet)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// BUNDLED_PHOTONS and getBundledPhotonPath are imported from shared-utils.js

// Extracted modules (Phase 5)
import {
  loadConfig as loadConfigFromModule,
  saveConfig as saveConfigFromModule,
  migrateConfig as migrateConfigFromModule,
  getConfigFilePath as getConfigFilePathFromModule,
} from './beam/config.js';
import {
  extractClassMetadataFromSource as extractClassMetadataFromModule,
  applyMethodVisibility as applyMethodVisibilityFromModule,
  extractCspFromSource as extractCspFromModule,
  prettifyName as prettifyNameFromModule,
  prettifyToolName as prettifyToolNameFromModule,
  backfillEnvDefaults as backfillEnvDefaultsFromModule,
} from './beam/class-metadata.js';
import { StartupSequencer } from './beam/startup.js';
import { handleMarketplaceRoutes } from './beam/routes/api-marketplace.js';
import { handleBrowseRoutes } from './beam/routes/api-browse.js';
import { handleConfigRoutes } from './beam/routes/api-config.js';
export type { PhotonConfig } from './beam/types.js';
export type { BeamState } from './beam/types.js';

// Note: PhotonInfo, UnconfiguredPhotonInfo, AnyPhotonInfo, ConfigParam, MethodInfo,
// InvokeRequest, ConfigureRequest, ElicitationResponse, CancelRequest, ReloadRequest,
// RemoveRequest are imported from ./types.js

interface OAuthCompleteMessage {
  type: 'oauth_complete';
  elicitationId: string;
  success: boolean;
}

interface UpdateMetadataMessage {
  type: 'update-metadata';
  photon: string;
  metadata: { description?: string; icon?: string };
}

interface UpdateMethodMetadataMessage {
  type: 'update-method-metadata';
  photon: string;
  method: string;
  metadata: { description?: string | null; icon?: string | null };
}

interface GetPromptMessage {
  type: 'get-prompt';
  photon: string;
  promptId: string;
  arguments?: Record<string, string>;
}

interface ReadResourceMessage {
  type: 'read-resource';
  photon: string;
  resourceId: string;
  uri?: string;
}

type ClientMessage =
  | InvokeRequest
  | ConfigureRequest
  | ElicitationResponse
  | CancelRequest
  | ReloadRequest
  | RemoveRequest
  | OAuthCompleteMessage
  | UpdateMetadataMessage
  | UpdateMethodMetadataMessage
  | GetPromptMessage
  | ReadResourceMessage;

// Delegate to extracted module
const getConfigFilePath = getConfigFilePathFromModule;

// PhotonConfig type imported from beam/types.ts
type PhotonConfig = import('./beam/types.js').PhotonConfig;

// ════════════════════════════════════════════════════════════════════════════════
// EXTERNAL MCP STATE (module-level for MCP transport access)
// ════════════════════════════════════════════════════════════════════════════════

/** External MCP servers loaded from config */
const externalMCPs: ExternalMCPInfo[] = [];

/** Active MCP client instances for external MCPs */
const externalMCPClients = new Map<string, any>();

/** Direct SDK clients for resource access (listResources, readResource) */
const externalMCPSDKClients = new Map<string, Client>();

/**
 * Generate a unique ID for an external MCP based on its name
 */
function generateExternalMCPId(name: string): string {
  return createHash('sha256').update(`external:${name}`).digest('hex').slice(0, 12);
}

// Delegate to extracted module
const prettifyToolName = prettifyToolNameFromModule;

/**
 * Create an HTTP transport for a URL-based MCP.
 * Tries Streamable HTTP first; falls back to legacy SSE.
 */
async function connectHTTPClient(url: string, mcpName: string): Promise<Client> {
  const sdkClient = new Client(
    { name: 'beam-mcp-client', version: '1.0.0' },
    {
      capabilities: {
        elicitation: {}, // Declare elicitation support
        experimental: {
          ui: {}, // Request SEP-1865 format for MCP Apps
        },
      },
    }
  );

  // Set up elicitation handler
  sdkClient.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = request.params as any;
    const result = await requestExternalElicitation(mcpName, {
      mode: params.mode as 'form' | 'url',
      message: params.message,
      requestedSchema: params.requestedSchema,
      url: params.url,
    });
    return result;
  });

  try {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const connectPromise = sdkClient.connect(transport);
    await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');
    logger.debug(`Connected to ${url} via Streamable HTTP`);
    return sdkClient;
  } catch (streamableError) {
    logger.debug(`Streamable HTTP failed for ${url}, trying legacy SSE: ${streamableError}`);
  }

  // Fallback: legacy SSE transport
  const sseClient = new Client(
    { name: 'beam-mcp-client', version: '1.0.0' },
    {
      capabilities: {
        elicitation: {}, // Declare elicitation support
        experimental: {
          ui: {}, // Request SEP-1865 format for MCP Apps
        },
      },
    }
  );

  // Set up elicitation handler for SSE client too
  sseClient.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = request.params as any;
    const result = await requestExternalElicitation(mcpName, {
      mode: params.mode as 'form' | 'url',
      message: params.message,
      requestedSchema: params.requestedSchema,
      url: params.url,
    });
    return result;
  });

  const sseTransport = new SSEClientTransport(new URL(url));
  const connectPromise = sseClient.connect(sseTransport);
  await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');
  logger.debug(`Connected to ${url} via legacy SSE`);
  return sseClient;
}

/**
 * Load external MCPs from config.json mcpServers section
 *
 * @param config - The PhotonConfig with mcpServers section
 * @returns Array of ExternalMCPInfo objects (populated with connected status)
 */
async function loadExternalMCPs(config: PhotonConfig): Promise<ExternalMCPInfo[]> {
  const mcpServers = config.mcpServers || {};
  const results: ExternalMCPInfo[] = [];

  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const mcpId = generateExternalMCPId(name);

    // Create the MCP info with initial disconnected state
    const mcpInfo: ExternalMCPInfo = {
      type: 'external-mcp',
      id: mcpId,
      name,
      connected: false,
      methods: [],
      label: prettifyToolName(name),
      icon: '🔌',
      config: serverConfig,
    };

    try {
      let methods: MethodInfo[] = [];

      if (serverConfig.url) {
        // HTTP transport — SDK client only (no wrapper needed)
        // Tries Streamable HTTP first, falls back to legacy SSE
        const sdkClient = await connectHTTPClient(serverConfig.url, name);
        externalMCPSDKClients.set(name, sdkClient);

        // List tools with full metadata using SDK client
        const toolsResult = await sdkClient.listTools();
        const tools = toolsResult.tools || [];

        // Convert tools to MethodInfo[] with full _meta support
        methods = tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description || '',
          params: tool.inputSchema || { type: 'object', properties: {} },
          returns: { type: 'object' },
          icon: tool['x-icon'],
          linkedUi: tool._meta?.ui?.resourceUri,
          visibility: tool._meta?.ui?.visibility,
        }));

        // Fetch resources to detect MCP Apps
        try {
          const resourcesResult = await sdkClient.listResources();
          const resources = resourcesResult.resources || [];

          const allUiResources = resources.filter(
            (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
          );

          // Count only non-UI resources (UI resources are internal implementation detail)
          mcpInfo.resourceCount = resources.length - allUiResources.length;

          // Only standalone UI resources make this an "app" — resources linked to
          // specific tools are companion UIs (e.g. file-preview for read_file)
          const toolLinkedUris = new Set(methods.map((m: any) => m.linkedUi).filter(Boolean));
          const standaloneResources = allUiResources.filter((r: any) => !toolLinkedUris.has(r.uri));

          if (standaloneResources.length > 0) {
            mcpInfo.hasApp = true;
            mcpInfo.appResourceUri = standaloneResources[0].uri;
            mcpInfo.appResourceUris = standaloneResources.map((r: any) => r.uri);
            const uriList = mcpInfo.appResourceUris.join(', ');
            logger.info(`🎨 MCP App detected: ${name} (${uriList})`);
          }
        } catch (resourceError) {
          logger.debug(`Resources not supported by ${name}`);
        }

        mcpInfo.connected = true;
        mcpInfo.methods = methods;
      } else if (serverConfig.command) {
        // Stdio transport — create wrapper client as fallback, SDK client as primary
        const mcpConfig: MCPConfig = {
          mcpServers: {
            [name]: serverConfig,
          },
        };
        const factory = new SDKMCPClientFactory(mcpConfig, false);
        const client = factory.create(name);
        externalMCPClients.set(name, client);

        try {
          const sdkTransport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            cwd: serverConfig.cwd,
            env: serverConfig.env,
            stderr: 'ignore', // Suppress stderr to avoid ugly tracebacks on shutdown
          });
          const sdkClient = new Client(
            { name: 'beam-mcp-client', version: '1.0.0' },
            {
              capabilities: {
                elicitation: {}, // Declare elicitation support
                experimental: {
                  ui: {}, // Request SEP-1865 format for MCP Apps
                },
              },
            }
          );

          // Set up elicitation handler BEFORE connecting
          // This handles elicitation/create requests from the server
          sdkClient.setRequestHandler(ElicitRequestSchema, async (request) => {
            const params = request.params as any;
            const result = await requestExternalElicitation(name, {
              mode: params.mode as 'form' | 'url',
              message: params.message,
              requestedSchema: params.requestedSchema,
              url: params.url,
            });
            return result;
          });

          const connectPromise = sdkClient.connect(sdkTransport);
          await withTimeout(connectPromise, 10000, 'Connection timeout (10s)');

          externalMCPSDKClients.set(name, sdkClient);

          // List tools with full metadata using SDK client
          const toolsResult = await sdkClient.listTools();
          const tools = toolsResult.tools || [];

          // Convert tools to MethodInfo[] with full _meta support
          methods = tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description || '',
            params: tool.inputSchema || { type: 'object', properties: {} },
            returns: { type: 'object' },
            icon: tool['x-icon'],
            // Preserve MCP App linkage from tool metadata
            linkedUi: tool._meta?.ui?.resourceUri,
            visibility: tool._meta?.ui?.visibility,
          }));

          // Fetch resources to detect MCP Apps
          try {
            const resourcesResult = await sdkClient.listResources();
            const resources = resourcesResult.resources || [];

            const allUiResources = resources.filter(
              (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
            );

            // Count only non-UI resources (UI resources are internal implementation detail)
            mcpInfo.resourceCount = resources.length - allUiResources.length;

            // Only standalone UI resources make this an "app"
            const toolLinkedUris = new Set(methods.map((m: any) => m.linkedUi).filter(Boolean));
            const standaloneResources = allUiResources.filter(
              (r: any) => !toolLinkedUris.has(r.uri)
            );

            if (standaloneResources.length > 0) {
              mcpInfo.hasApp = true;
              mcpInfo.appResourceUri = standaloneResources[0].uri;
              mcpInfo.appResourceUris = standaloneResources.map((r: any) => r.uri);
              const uriList = mcpInfo.appResourceUris.join(', ');
              logger.info(`🎨 MCP App detected: ${name} (${uriList})`);
            }
          } catch (resourceError) {
            // Resources not supported - that's fine
            logger.debug(`Resources not supported by ${name}`);
          }

          // Set connected state after successful SDK client setup
          mcpInfo.connected = true;
          mcpInfo.methods = methods;
        } catch (sdkError) {
          // SDK client failed — don't fall back to wrapper for stdio MCPs
          // (same command would fail identically, and wrapper spawns a process
          // without stderr suppression, leaking raw Node.js stack traces)
          throw sdkError;
        }
      } else {
        // No command or URL — create wrapper client (legacy fallback)
        const mcpConfig: MCPConfig = {
          mcpServers: {
            [name]: serverConfig,
          },
        };
        const factory = new SDKMCPClientFactory(mcpConfig, false);
        const client = factory.create(name);
        externalMCPClients.set(name, client);

        const tools = await client.list();
        methods = (tools || []).map((tool: any) => ({
          name: tool.name,
          description: tool.description || '',
          params: tool.inputSchema || { type: 'object', properties: {} },
          returns: { type: 'object' },
          icon: tool['x-icon'],
        }));

        mcpInfo.connected = true;
        mcpInfo.methods = methods;
      }

      logger.info(`🔌 Connected to external MCP: ${name} (${methods.length} tools)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mcpInfo.errorMessage = errorMsg.slice(0, 200);

      // User-friendly error messages for common failures
      const shortMsg = errorMsg.includes('Cannot find module')
        ? `Module not found (run npm build in the MCP directory)`
        : errorMsg.includes('ENOENT')
          ? `Command not found: ${serverConfig.command}`
          : errorMsg.includes('Connection timeout')
            ? `Connection timed out (server may not be running)`
            : errorMsg.includes('Connection closed')
              ? `Server exited immediately (check configuration)`
              : errorMsg.slice(0, 120);

      logger.warn(`⚠️  External MCP "${name}" — ${shortMsg}`);
    }

    results.push(mcpInfo);
  }

  return results;
}

/**
 * Reconnect a failed external MCP
 *
 * @param name - The MCP name to reconnect
 * @returns Success status and error message if failed
 */
async function reconnectExternalMCP(name: string): Promise<{ success: boolean; error?: string }> {
  const mcpIndex = externalMCPs.findIndex((m) => m.name === name);
  if (mcpIndex === -1) {
    return { success: false, error: `External MCP not found: ${name}` };
  }

  const mcpConfig = externalMCPs[mcpIndex].config;

  try {
    let methods: MethodInfo[] = [];
    let resourceCount: number | undefined;
    let hasApp: boolean | undefined;
    let appResourceUri: string | undefined;
    let appResourceUris: string[] | undefined;

    if (mcpConfig.url) {
      // HTTP transport — tries Streamable HTTP, falls back to legacy SSE
      const sdkClient = await connectHTTPClient(mcpConfig.url, name);
      externalMCPSDKClients.set(name, sdkClient);

      const toolsResult = await sdkClient.listTools();
      const tools = toolsResult.tools || [];

      methods = tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        params: tool.inputSchema || { type: 'object', properties: {} },
        returns: { type: 'object' },
        icon: tool['x-icon'],
        linkedUi: tool._meta?.ui?.resourceUri,
        visibility: tool._meta?.ui?.visibility,
      }));

      // Fetch resources to detect MCP Apps
      try {
        const resourcesResult = await sdkClient.listResources();
        const resources = resourcesResult.resources || [];

        const allUiResources = resources.filter(
          (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
        );

        // Count only non-UI resources (UI resources are internal implementation detail)
        resourceCount = resources.length - allUiResources.length;

        // Only standalone UI resources make this an "app"
        const toolLinkedUris = new Set(methods.map((m: any) => m.linkedUi).filter(Boolean));
        const standaloneResources = allUiResources.filter((r: any) => !toolLinkedUris.has(r.uri));

        if (standaloneResources.length > 0) {
          hasApp = true;
          appResourceUri = standaloneResources[0].uri;
          appResourceUris = standaloneResources.map((r: any) => r.uri);
        }
      } catch {
        // Resources not supported
      }
    } else {
      // Stdio / wrapper transport
      const stdioConfig: MCPConfig = {
        mcpServers: {
          [name]: mcpConfig,
        },
      };
      const factory = new SDKMCPClientFactory(stdioConfig, false);
      const client = factory.create(name);

      const tools = (await withTimeout(client.list(), 10000, 'Connection timeout (10s)')) as any[];

      methods = (tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        params: tool.inputSchema || { type: 'object', properties: {} },
        returns: { type: 'object' },
        icon: tool['x-icon'],
      }));

      externalMCPClients.set(name, client);
    }

    // Re-find after awaits — externalMCPs may have been modified during connection
    const currentIndex = externalMCPs.findIndex((m) => m.name === name);
    if (currentIndex === -1) {
      return { success: false, error: `External MCP '${name}' was removed during reconnection` };
    }
    const mcp = externalMCPs[currentIndex];

    // Update MCP info
    mcp.connected = true;
    mcp.methods = methods;
    mcp.errorMessage = undefined;
    if (resourceCount !== undefined) mcp.resourceCount = resourceCount;
    if (hasApp !== undefined) {
      mcp.hasApp = hasApp;
      mcp.appResourceUri = appResourceUri;
      mcp.appResourceUris = appResourceUris;
    }

    logger.info(`🔌 Reconnected to external MCP: ${name} (${methods.length} tools)`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const failedMcp = externalMCPs.find((m) => m.name === name);
    if (failedMcp) failedMcp.errorMessage = errorMsg.slice(0, 200);
    logger.warn(`⚠️ Failed to reconnect to external MCP: ${name} - ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// Delegates to extracted config module
const migrateConfig = migrateConfigFromModule;
const loadConfig = loadConfigFromModule;
const saveConfig = saveConfigFromModule;

// Delegates to extracted class-metadata module
const prettifyName = prettifyNameFromModule;
const backfillEnvDefaults = backfillEnvDefaultsFromModule;

const extractClassMetadataFromSource = extractClassMetadataFromModule;

const applyMethodVisibility = applyMethodVisibilityFromModule;
const extractCspFromSource = extractCspFromModule;

export async function startBeam(rawWorkingDir: string, port: number): Promise<void> {
  const workingDir = path.resolve(rawWorkingDir);
  const { PHOTON_VERSION } = await import('../version.js');

  // StartupSequencer manages ordered output during startup
  const startup = new StartupSequencer(PHOTON_VERSION, workingDir);
  const isTTY = process.stderr.isTTY;

  // Initialize marketplace manager for photon discovery and installation
  const marketplace = new MarketplaceManager();
  await marketplace.initialize();
  // Auto-update stale caches (await to ensure first boot has data before UI opens)
  try {
    await marketplace.autoUpdateStaleCaches();
  } catch (error) {
    logger.warn(`Failed to update marketplace caches: ${getErrorMessage(error)}`);
  }

  // Repair missing assets from photons installed before the asset-download fix
  try {
    const repaired = await marketplace.repairMissingAssets(workingDir);
    if (repaired > 0) {
      logger.info(`Repaired assets for ${repaired} photon(s)`);
    }
  } catch (error) {
    logger.warn(`Asset repair check failed: ${getErrorMessage(error)}`);
  }

  // Discover all photons (user photons + bundled photons)
  const userPhotonList = await listPhotonMCPs(workingDir);

  // Add bundled photons with their paths
  const bundledPhotonPaths = new Map<string, string>();
  for (const name of BEAM_BUNDLED_PHOTONS) {
    const bundledPath = getBundledPhotonPath(name, __dirname, BEAM_BUNDLED_PHOTONS);
    if (bundledPath) {
      bundledPhotonPaths.set(name, bundledPath);
    }
  }

  // Combine: user photons first, then bundled photons (avoid duplicates)
  const photonList = [...userPhotonList];
  for (const name of BEAM_BUNDLED_PHOTONS) {
    if (!photonList.includes(name) && bundledPhotonPaths.has(name)) {
      photonList.push(name);
    }
  }

  if (photonList.length === 0) {
    logger.info('No photons found - showing management UI');
  }

  // Load saved config and apply to env
  const savedConfig = await loadConfig(workingDir);

  // Extract metadata for all photons
  const photons: AnyPhotonInfo[] = [];
  const photonMCPs = new Map<string, any>(); // Store full MCP objects

  // Use PhotonLoader with error-only logger to reduce verbosity
  // Beam handles config errors gracefully via UI forms, but we still want to see actual errors
  const errorOnlyLogger = createLogger({ level: 'error' });
  const loader = new PhotonLoader(false, errorOnlyLogger, workingDir);

  // Counts updated after photon loading
  let configuredCount = 0;
  let unconfiguredCount = 0;

  // Check for placeholder defaults or localhost URLs (which need local services running)
  const isPlaceholderOrLocalDefault = (value: string): boolean => {
    if (value.includes('<') || value.includes('your-')) return true;
    if (value.includes('localhost') || value.includes('127.0.0.1')) return true;
    return false;
  };

  // Helper: load a single photon, returning the info to push into photons[]
  async function loadSinglePhoton(name: string): Promise<AnyPhotonInfo | null> {
    const photonPath = bundledPhotonPaths.get(name) || (await resolvePhotonPath(name, workingDir));
    if (!photonPath) return null;

    // Apply saved config to environment before loading
    if (savedConfig.photons[name]) {
      for (const [key, value] of Object.entries(savedConfig.photons[name])) {
        process.env[key] = value;
      }
    }

    // Read source once — used for constructor params, schema extraction, and class metadata
    const extractor = new SchemaExtractor();
    let constructorParams: ConfigParam[] = [];
    let templatePath: string | undefined;
    let source: string | undefined;
    let isInternal: boolean | undefined;

    try {
      source = await fs.readFile(photonPath, 'utf-8');
    } catch {
      // Can't read source
    }

    // Extract @internal from class-level JSDoc only (not the entire source,
    // which would false-positive on method-level @internal tags)
    if (source) {
      const earlyMeta = extractClassMetadataFromSource(source);
      if (earlyMeta.internal) {
        isInternal = true;
      }
    }

    try {
      if (source) {
        const params = extractor.extractConstructorParams(source);

        constructorParams = params
          .filter((p) => p.isPrimitive)
          .map((p) => ({
            name: p.name,
            envVar: toEnvVarName(name, p.name),
            type: p.type,
            isOptional: p.isOptional,
            hasDefault: p.hasDefault,
            defaultValue: p.defaultValue,
          }));

        // Extract @ui template path from class-level JSDoc
        const classJsdocMatch =
          source.match(/\/\*\*[\s\S]*?\*\/\s*(?=export\s+default\s+class)/) ||
          source.match(/^\/\*\*([\s\S]*?)\*\//);
        if (classJsdocMatch) {
          const uiMatch = classJsdocMatch[0].match(/@ui\s+([^\s*]+)/);
          if (uiMatch) {
            templatePath = uiMatch[1];
          }
        }
      }
    } catch {
      // Can't extract params, try to load anyway
    }

    // Check if any required params are missing from environment
    const missingRequired = constructorParams.filter(
      (p) => !p.isOptional && !p.hasDefault && !process.env[p.envVar]
    );

    const hasPlaceholderDefaults = constructorParams.some(
      (p) =>
        p.hasDefault &&
        typeof p.defaultValue === 'string' &&
        isPlaceholderOrLocalDefault(p.defaultValue)
    );

    const needsConfig =
      missingRequired.length > 0 ||
      (hasPlaceholderDefaults &&
        constructorParams.some(
          (p) =>
            p.hasDefault &&
            typeof p.defaultValue === 'string' &&
            isPlaceholderOrLocalDefault(p.defaultValue) &&
            !process.env[p.envVar]
        ));

    if (needsConfig && constructorParams.length > 0) {
      return {
        id: generatePhotonId(photonPath),
        name,
        path: photonPath,
        configured: false,
        internal: isInternal,
        requiredParams: constructorParams,
        errorReason: 'missing-config' as const,
        errorMessage:
          missingRequired.length > 0
            ? `Missing required: ${missingRequired.map((p) => p.name).join(', ')}`
            : 'Has placeholder values that need configuration',
      };
    }

    // All params satisfied, try to load with timeout
    try {
      const mcp = (await withTimeout(
        loader.loadFile(photonPath),
        10000,
        'Loading timeout (10s)'
      )) as any;
      const instance = mcp.instance;

      if (!instance) {
        return null;
      }

      photonMCPs.set(name, mcp);
      backfillEnvDefaults(instance, constructorParams);

      // Extract schema for UI — reuse source read from above
      const schemaSource = source || (await fs.readFile(photonPath, 'utf-8'));
      const { tools: schemas, templates } = extractor.extractAllFromSource(schemaSource);
      (mcp as any).schemas = schemas;

      // Get UI assets for linking
      const uiAssets = mcp.assets?.ui || [];

      // Filter out lifecycle methods
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => {
          const linkedAsset = uiAssets.find((ui: any) => ui.linkedTool === schema.name);
          return {
            name: schema.name,
            description: schema.description || '',
            params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
            returns: { type: 'object' },
            autorun: schema.autorun || false,
            outputFormat: schema.outputFormat,
            layoutHints: schema.layoutHints,
            buttonLabel: schema.buttonLabel,
            icon: schema.icon,
            linkedUi: linkedAsset?.id,
            ...(schema.isStatic ? { isStatic: true } : {}),
            ...(schema.webhook ? { webhook: schema.webhook } : {}),
            ...(schema.scheduled || schema.cron
              ? { scheduled: schema.scheduled || schema.cron }
              : {}),
            ...(schema.locked ? { locked: schema.locked } : {}),
          };
        });

      // Add templates as methods with isTemplate flag and markdown output format
      templates.forEach((template: any) => {
        if (!lifecycleMethods.includes(template.name)) {
          methods.push({
            name: template.name,
            description: template.description || '',
            params: template.inputSchema || { type: 'object', properties: {}, required: [] },
            returns: { type: 'object' },
            isTemplate: true,
            outputFormat: 'markdown',
          });
        }
      });

      // Apply @visibility annotations from source to methods
      applyMethodVisibility(schemaSource, methods);

      // Check if this is an App (has main() method with @ui)
      const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

      // Extract class-level metadata — reuse source already read
      const classMetadata = extractClassMetadataFromSource(schemaSource);

      // Extract class-level @csp metadata and apply to all UI assets
      const cspData = extractCspFromSource(schemaSource);
      if (cspData['__class__'] && mcp.assets?.ui) {
        for (const uiAsset of mcp.assets.ui) {
          (uiAsset as any).csp = cspData['__class__'];
        }
      }

      // Count resources and prompts
      const resourceCount = mcp.assets?.resources?.length || 0;
      const promptCount = templates.length;

      // Read install metadata for marketplace-installed photons
      let installSource: { marketplace: string; installedAt?: string } | undefined;
      let metaVersion = classMetadata.version;
      let metaAuthor = classMetadata.author;
      try {
        const { readLocalMetadata } = await import('../marketplace-manager.js');
        const localMeta = await readLocalMetadata();
        const installMeta = localMeta.photons[`${name}.photon.ts`];
        if (installMeta) {
          installSource = {
            marketplace: installMeta.marketplace,
            installedAt: installMeta.installedAt,
          };
          if (!metaVersion && installMeta.version) {
            metaVersion = installMeta.version;
          }
        }
      } catch {
        // No install metadata - that's fine
      }

      const isStateful = schemaSource ? /@stateful\b/.test(schemaSource) : false;

      return {
        id: generatePhotonId(photonPath),
        name,
        path: photonPath,
        configured: true,
        methods,
        templatePath,
        isApp: !!mainMethod,
        appEntry: mainMethod,
        assets: mcp.assets,
        description: classMetadata.description || mcp.description || `${name} MCP`,
        label: classMetadata.label || prettifyName(name),
        icon: classMetadata.icon,
        internal: isInternal || classMetadata.internal,
        version: metaVersion,
        author: metaAuthor,
        resourceCount,
        promptCount,
        installSource,
        ...(isStateful && { stateful: true }),
        ...(constructorParams.length > 0 && { requiredParams: constructorParams }),
        ...(mcp.injectedPhotons &&
          mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Always surface errored photons in the sidebar instead of silently dropping them
      return {
        id: generatePhotonId(photonPath),
        name,
        path: photonPath,
        configured: false,
        label: prettifyName(name),
        internal: isInternal,
        requiredParams: constructorParams,
        errorReason:
          constructorParams.length > 0 ? ('missing-config' as const) : ('load-error' as const),
        errorMessage: errorMsg.slice(0, 200),
      };
    }
  }

  // Photon loading is deferred until after server.listen() — see end of startBeam()

  // ══════════════════════════════════════════════════════════════════════════════
  // DYNAMIC SUBSCRIPTION MANAGEMENT (Reference Counting)
  // Channels are subscribed only when clients are viewing them
  // ══════════════════════════════════════════════════════════════════════════════

  interface ChannelSubscription {
    refCount: number;
    unsubscribe: (() => void) | null;
  }

  const channelSubscriptions = new Map<string, ChannelSubscription>();

  // ══════════════════════════════════════════════════════════════════════════════
  // EVENT BUFFER FOR REPLAY (Reliable Real-time Sync)
  // Stores recent events per channel for replay on reconnect
  // ══════════════════════════════════════════════════════════════════════════════

  interface BufferedEvent {
    /** Timestamp-based ID (Date.now()) */
    id: number;
    method: string;
    params: Record<string, unknown>;
    timestamp: number;
  }

  interface ChannelBuffer {
    events: BufferedEvent[];
  }

  /** Buffer retention window — events older than this are purged */
  const EVENT_BUFFER_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  const channelEventBuffers = new Map<string, ChannelBuffer>();

  // Store an event in the channel buffer
  function bufferEvent(channel: string, method: string, params: Record<string, unknown>): number {
    let buffer = channelEventBuffers.get(channel);
    if (!buffer) {
      buffer = { events: [] };
      channelEventBuffers.set(channel, buffer);
    }

    const now = Date.now();
    const event: BufferedEvent = {
      id: now,
      method,
      params,
      timestamp: now,
    };

    buffer.events.push(event);

    // Purge events older than retention window
    const cutoff = now - EVENT_BUFFER_DURATION_MS;
    while (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff) {
      buffer.events.shift();
    }

    return now;
  }

  // Replay missed events to a specific session, or signal full sync needed
  function replayEventsToSession(
    sessionId: string,
    channel: string,
    lastTimestamp?: number
  ): { replayed: number; refreshNeeded: boolean } {
    const buffer = channelEventBuffers.get(channel);

    // No buffer = no events ever sent on this channel
    if (!buffer || buffer.events.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    // No lastTimestamp = client is fresh, no replay needed
    if (lastTimestamp === undefined) {
      return { replayed: 0, refreshNeeded: false };
    }

    const oldestEvent = buffer.events[0];

    // Stale: client's timestamp is older than buffer window → full sync needed
    if (lastTimestamp < oldestEvent.timestamp) {
      sendToSession(sessionId, 'photon/refresh-needed', { channel });
      logger.info(
        `📡 Stale client on ${channel} - last seen ${new Date(lastTimestamp).toISOString()}, oldest buffered ${new Date(oldestEvent.timestamp).toISOString()}, full sync needed`
      );
      return { replayed: 0, refreshNeeded: true };
    }

    // Delta sync: replay events after client's last timestamp
    const eventsToReplay = buffer.events.filter((e) => e.timestamp > lastTimestamp);

    if (eventsToReplay.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    for (const event of eventsToReplay) {
      sendToSession(sessionId, event.method, { ...event.params, _eventId: event.timestamp });
    }

    logger.info(`📡 Delta sync: ${channel} - replayed ${eventsToReplay.length} events`);
    return { replayed: eventsToReplay.length, refreshNeeded: false };
  }

  // ══════════════════════════════════════════════════════════════════════════════

  // Subscribe to a channel (increment ref count, actually subscribe if first)
  // Channel format: {photonId}:{itemId} (e.g., "a3f2b1c4d5e6:photon")
  async function subscribeToChannel(channel: string): Promise<void> {
    const existing = channelSubscriptions.get(channel);

    if (existing) {
      existing.refCount++;
      logger.debug(`Channel ${channel} ref count: ${existing.refCount}`);
      return;
    }

    // First subscriber - actually subscribe to daemon
    const subscription: ChannelSubscription = { refCount: 1, unsubscribe: null };
    channelSubscriptions.set(channel, subscription);

    try {
      // Extract photonId and itemId from channel (e.g., "a3f2b1:photon" -> photonId, itemId)
      const [photonId, itemId] = channel.split(':');

      // Look up photon name from ID
      const photon = photons.find((p) => p.id === photonId);
      if (!photon) {
        logger.warn(`Cannot subscribe to ${channel}: unknown photon ID ${photonId}`);
        return;
      }
      const photonName = photon.name;

      // Daemon uses photonName:itemId as channel (not photonId)
      const daemonChannel = `${photonName}:${itemId}`;
      const isRunning = await pingDaemon(photonName);

      if (isRunning) {
        const unsubscribe = await subscribeChannel(
          photonName,
          daemonChannel,
          (message: any) => {
            // Forward channel messages as events with delta
            // Include both photonId (for client) and photonName (for display)
            const params = {
              photonId,
              photon: photonName,
              channel: daemonChannel,
              event: message?.event,
              data: message?.data || message,
            };
            // Buffer event for replay on reconnect
            const eventId = bufferEvent(channel, 'photon/channel-event', params);
            broadcastToBeam('photon/channel-event', { ...params, _eventId: eventId });
          },
          { workingDir }
        );
        subscription.unsubscribe = unsubscribe;
        logger.info(`📡 Subscribed to ${daemonChannel} (id: ${photonId}, ref: 1)`);
      }
    } catch {
      // Daemon not running - that's fine, in-process events still work
    }
  }

  // Unsubscribe from a channel (decrement ref count, actually unsubscribe if last)
  function unsubscribeFromChannel(channel: string): void {
    const subscription = channelSubscriptions.get(channel);
    if (!subscription) return;

    subscription.refCount--;
    logger.debug(`Channel ${channel} ref count: ${subscription.refCount}`);

    if (subscription.refCount <= 0) {
      // Last subscriber - actually unsubscribe
      if (subscription.unsubscribe) {
        subscription.unsubscribe();
        logger.info(`📡 Unsubscribed from ${channel}`);
      }
      channelSubscriptions.delete(channel);
    }
  }

  // Track what each session is viewing for cleanup on disconnect
  // Uses photonId (hash) for unique identification across servers
  const sessionViewState = new Map<string, { photonId?: string; itemId?: string }>();

  // Called when a client starts viewing a board (from MCP notification)
  // photonId: hash of photon path (unique across servers)
  // itemId: whatever the photon uses to identify the item (e.g., board name)
  // lastTimestamp: optional - if provided, delta sync missed events or signal full sync needed
  function onClientViewingBoard(
    sessionId: string,
    photonId: string,
    itemId: string,
    lastTimestamp?: number
  ): void {
    const prevState = sessionViewState.get(sessionId);

    // Unsubscribe from previous item if different
    if (prevState?.itemId && (prevState.photonId !== photonId || prevState.itemId !== itemId)) {
      const prevChannel = `${prevState.photonId}:${prevState.itemId}`;
      unsubscribeFromChannel(prevChannel);
    }

    // Subscribe to new item
    const channel = `${photonId}:${itemId}`;
    sessionViewState.set(sessionId, { photonId, itemId });
    subscribeToChannel(channel);

    // Delta sync missed events if lastTimestamp is provided
    if (lastTimestamp !== undefined) {
      replayEventsToSession(sessionId, channel, lastTimestamp);
    }
  }

  // Called when a client disconnects
  function onClientDisconnect(sessionId: string): void {
    const state = sessionViewState.get(sessionId);
    if (state?.photonId && state?.itemId) {
      const channel = `${state.photonId}:${state.itemId}`;
      unsubscribeFromChannel(channel);
    }
    sessionViewState.delete(sessionId);
  }

  const subscriptionManager = {
    onClientViewingBoard,
    onClientDisconnect,
  };

  // UI asset loader for MCP resources/read
  const loadUIAsset = async (photonName: string, uiId: string): Promise<string | null> => {
    const photon = photons.find((p) => p.name === photonName);
    if (!photon || !photon.configured) return null;

    const photonDir = path.dirname(photon.path);
    const asset = (photon as any).assets?.ui?.find((u: any) => u.id === uiId);

    let uiPath: string;
    if (asset?.resolvedPath) {
      uiPath = asset.resolvedPath;
    } else {
      uiPath = path.join(photonDir, photonName, 'ui', `${uiId}.html`);
    }

    try {
      return await fs.readFile(uiPath, 'utf-8');
    } catch {
      return null; // UI asset not found
    }
  };

  // Security: rate limiter for API endpoints
  const apiRateLimiter = new SimpleRateLimiter(30, 60_000);

  // Shared state object for extracted route modules.
  // Actions are assigned later (after broadcastPhotonChange/handleFileChange are defined)
  // but before the server starts accepting connections — closures capture the reference.
  const beamActions: import('./beam/types.js').BeamActions = {
    broadcastPhotonChange: () => broadcastPhotonChange(),
    handleFileChange: (name: string) => handleFileChange(name),
    loadSinglePhoton: (name: string) => loadSinglePhoton(name),
    reconnectExternalMCP: (name: string) => reconnectExternalMCP(name),
    loadUIAsset: (photonName: string, uiId: string) => loadUIAsset(photonName, uiId),
    subscribeToChannel: async () => {},
    unsubscribeFromChannel: () => {},
    configurePhotonViaMCP: async () => {},
    reloadPhotonViaMCP: async () => {},
    removePhotonViaMCP: async () => {},
  };
  const beamState: import('./beam/types.js').BeamState = {
    actions: beamActions,
    workingDir,
    ctx: null as any, // Not yet used by route modules
    loader,
    marketplace,
    savedConfig,
    photons,
    photonMCPs,
    externalMCPs,
    externalMCPClients,
    externalMCPSDKClients,
    channelSubscriptions: new Map(),
    channelEventBuffers: new Map(),
    sessionViewState: new Map(),
    apiRateLimiter,
    server: null,
    watchers: [],
    pendingReloads: new Map(),
    activeLoads: new Set(),
    pendingAfterLoad: new Map(),
    beamDir: __dirname,
    configuredCount: 0,
    unconfiguredCount: 0,
  };

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    // Security: set standard security headers on all responses
    setSecurityHeaders(res);
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // ══════════════════════════════════════════════════════════════════════════
    // MCP Streamable HTTP Transport (standard MCP clients like Claude Desktop)
    // Endpoint: /mcp (POST for requests, GET for SSE notifications)
    // ══════════════════════════════════════════════════════════════════════════
    if (url.pathname === '/mcp') {
      const handled = await handleStreamableHTTP(req, res, {
        photons, // Pass all photons including unconfigured for configurationSchema
        photonMCPs,
        externalMCPs,
        externalMCPClients,
        externalMCPSDKClients, // SDK clients for tool calls with structuredContent
        reconnectExternalMCP,
        loadUIAsset,
        workingDir,
        configurePhoton: async (photonName: string, config: Record<string, any>) => {
          return configurePhotonViaMCP(
            photonName,
            config,
            photons,
            photonMCPs,
            loader,
            savedConfig,
            workingDir,
            activeLoads
          );
        },
        reloadPhoton: async (photonName: string) => {
          return reloadPhotonViaMCP(
            photonName,
            photons,
            photonMCPs,
            loader,
            savedConfig,
            broadcastPhotonChange,
            activeLoads
          );
        },
        removePhoton: async (photonName: string) => {
          return removePhotonViaMCP(
            photonName,
            photons,
            photonMCPs,
            savedConfig,
            broadcastPhotonChange,
            workingDir
          );
        },
        updateMetadata: async (
          photonName: string,
          methodName: string | null,
          metadata: Record<string, any>
        ) => {
          return updateMetadataViaMCP(photonName, methodName, metadata, photons);
        },
        generatePhotonHelp: async (photonName: string) => {
          return generatePhotonHelpMarkdown(photonName, photons);
        },
        loader, // Pass loader for proper execution context (this.emit() support)
        subscriptionManager, // For on-demand channel subscriptions
        broadcast: (message: object) => {
          const msg = message as {
            type?: string;
            photon?: string;
            board?: string;
            channel?: string;
            event?: string;
            data?: any;
            jsonrpc?: string;
            method?: string;
            params?: any;
          };

          // Forward JSON-RPC notifications (progress, status, etc.)
          if (msg.jsonrpc === '2.0' && msg.method) {
            broadcastNotification(msg.method, msg.params || {});
          }
          // Forward channel events (task-moved, task-updated, etc.) with delta
          else if (msg.type === 'channel-event') {
            const params = {
              photon: msg.photon,
              channel: msg.channel,
              event: msg.event,
              data: msg.data,
            };
            // Buffer event for replay - find photonId from name for consistent channel key
            const photon = photons.find((p) => p.name === msg.photon);
            if (photon && msg.channel) {
              const [, itemId] = msg.channel.split(':');
              const bufferChannel = `${photon.id}:${itemId}`;
              const eventId = bufferEvent(bufferChannel, 'photon/channel-event', {
                ...params,
                photonId: photon.id,
              });
              broadcastToBeam('photon/channel-event', {
                ...params,
                photonId: photon.id,
                _eventId: eventId,
              });
            } else {
              broadcastToBeam('photon/channel-event', params);
            }
          }
          // Forward board-update for backwards compatibility
          else if (msg.type === 'board-update') {
            broadcastToBeam('photon/board-update', {
              photon: msg.photon,
              board: msg.board,
            });
          }
        },
      });
      if (handled) return;
    }

    // Serve static frontend bundle
    if (url.pathname === '/beam.bundle.js') {
      try {
        const bundlePath = path.join(__dirname, '../../dist/beam.bundle.js');
        const content = await fs.readFile(bundlePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Bundle not found. Run npm run build:beam first.');
      }
      return;
    }

    // Default route: Serve Lit App
    if (url.pathname === '/' || !url.pathname.startsWith('/api')) {
      try {
        const indexPath = path.join(__dirname, 'frontend/index.html');
        const content = await fs.readFile(indexPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end('Error serving UI: ' + String(err));
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // Broadcast photon changes to all connected clients via MCP SSE
  const broadcastPhotonChange = () => {
    // MCP Streamable HTTP clients (SSE) get tools/list_changed notification
    broadcastNotification('notifications/tools/list_changed');
    // Beam SSE clients get full photons list
    broadcastToBeam('beam/photons', { photons });
  };

  // File watcher for hot reload
  const watchers: FSWatcher[] = [];
  const pendingReloads = new Map<string, NodeJS.Timeout>();
  const activeLoads = new Set<string>(); // Photons currently being loaded (prevents concurrent duplicate loads)
  const pendingAfterLoad = new Set<string>(); // File changes that arrived while a load was active; re-triggered after

  // Determine which photon a file change belongs to
  const getPhotonForPath = (changedPath: string): string | null => {
    const relativePath = path.relative(workingDir, changedPath);
    const parts = relativePath.split(path.sep);

    // Direct .photon.ts file change
    if (relativePath.endsWith('.photon.ts')) {
      return path.basename(relativePath, '.photon.ts');
    }

    // Asset folder change - first segment is the photon name
    if (parts.length > 1) {
      const folderName = parts[0];
      // Check if corresponding .photon.ts exists
      const photon = photons.find((p) => p.name === folderName);
      if (photon) {
        return folderName;
      }
    }

    return null;
  };

  // Handle file change with debounce
  const handleFileChange = async (photonName: string) => {
    // Clear any pending reload for this photon
    const pending = pendingReloads.get(photonName);
    if (pending) clearTimeout(pending);

    // Debounce - wait 100ms for batch saves
    pendingReloads.set(
      photonName,
      setTimeout(async () => {
        pendingReloads.delete(photonName);

        // Skip if already loading this photon — but mark it so we re-run after the active load
        // finishes. Without this, file changes that arrive mid-load are silently dropped.
        if (activeLoads.has(photonName)) {
          pendingAfterLoad.add(photonName);
          return;
        }
        activeLoads.add(photonName);

        try {
          const photonIndex = photons.findIndex((p) => p.name === photonName);
          const isNewPhoton = photonIndex === -1;
          const photonPath = isNewPhoton
            ? path.join(workingDir, `${photonName}.photon.ts`)
            : photons[photonIndex].path;

          // Handle file deletion - if file no longer exists and photon is in list, remove it
          if (!isNewPhoton && photonPath && !existsSync(photonPath)) {
            logger.info(`🗑️ Photon file deleted: ${photonName}`);
            photons.splice(photonIndex, 1);
            photonMCPs.delete(photonName);
            // Also remove from saved config
            if (savedConfig.photons[photonName]) {
              delete savedConfig.photons[photonName];
              await saveConfig(savedConfig, workingDir);
            }
            broadcastPhotonChange();
            broadcastToBeam('beam/photon-removed', { name: photonName });
            return;
          }

          logger.info(
            isNewPhoton
              ? `✨ New photon detected: ${photonName}`
              : `🔄 File change detected, reloading ${photonName}...`
          );

          // Auto-scaffold empty photon files with a starter template
          if (isNewPhoton) {
            try {
              const rawContent = await fs.readFile(photonPath, 'utf-8');
              if (rawContent.trim().length === 0) {
                const className = photonName
                  .split(/[-_]/)
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join('');
                const scaffold = `/**\n * ${className} Photon\n */\n\nexport default class ${className} {\n  /**\n   * Example tool\n   * @param message Message to echo\n   */\n  async echo(params: { message: string }) {\n    return \`Echo: \${params.message}\`;\n  }\n}\n`;
                await fs.writeFile(photonPath, scaffold, 'utf-8');
                logger.info(`📝 Scaffolded empty file: ${photonName}.photon.ts`);
                // The write triggers another watcher event which will load the scaffolded photon
                return;
              }
            } catch {
              // File read failed, continue with normal load attempt
            }
          }

          // For new photons, check if configuration is needed first
          if (isNewPhoton) {
            const extractor = new SchemaExtractor();
            let constructorParams: ConfigParam[] = [];

            try {
              const source = await fs.readFile(photonPath, 'utf-8');
              const params = extractor.extractConstructorParams(source);
              constructorParams = params
                .filter((p: ConstructorParam) => p.isPrimitive)
                .map((p: ConstructorParam) => ({
                  name: p.name,
                  envVar: toEnvVarName(photonName, p.name),
                  type: p.type,
                  isOptional: p.isOptional,
                  hasDefault: p.hasDefault,
                  defaultValue: p.defaultValue,
                }));
            } catch {
              // Can't extract params, try to load anyway
            }

            // Check if any required params are missing
            const missingRequired = constructorParams.filter(
              (p) => !p.isOptional && !p.hasDefault && !process.env[p.envVar]
            );

            if (missingRequired.length > 0 && constructorParams.length > 0) {
              // Add as unconfigured photon
              const targetPhoton: UnconfiguredPhotonInfo = {
                id: generatePhotonId(photonPath),
                name: photonName,
                path: photonPath,
                configured: false,
                requiredParams: constructorParams,
                errorReason: 'missing-config',
                errorMessage: `Missing required: ${missingRequired.map((p) => p.name).join(', ')}`,
              };
              if (!photons.find((p) => p.name === photonName)) {
                photons.push(targetPhoton);
                broadcastPhotonChange();
                logger.info(`⚙️ ${photonName} added (needs configuration)`);
              }
              return;
            }
          }

          try {
            // Load or reload the photon
            const mcp = isNewPhoton
              ? await loader.loadFile(photonPath)
              : await loader.reloadFile(photonPath);
            if (!mcp.instance) throw new Error('Failed to create instance');

            photonMCPs.set(photonName, mcp);

            // Re-extract schema - use extractAllFromSource to get both tools and templates
            const extractor = new SchemaExtractor();
            const reloadSource = await fs.readFile(photonPath, 'utf-8');
            const { tools: schemas, templates } = extractor.extractAllFromSource(reloadSource);
            (mcp as any).schemas = schemas; // Store schemas for result rendering

            const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
            const uiAssets = mcp.assets?.ui || [];
            const methods: MethodInfo[] = schemas
              .filter((schema: any) => !lifecycleMethods.includes(schema.name))
              .map((schema: any) => {
                const linkedAsset = uiAssets.find((ui: any) => ui.linkedTool === schema.name);
                return {
                  name: schema.name,
                  description: schema.description || '',
                  params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
                  returns: { type: 'object' },
                  autorun: schema.autorun || false,
                  outputFormat: schema.outputFormat,
                  layoutHints: schema.layoutHints,
                  buttonLabel: schema.buttonLabel,
                  icon: schema.icon,
                  linkedUi: linkedAsset?.id,
                };
              });

            // Add templates as methods
            templates.forEach((template: any) => {
              if (!lifecycleMethods.includes(template.name)) {
                methods.push({
                  name: template.name,
                  description: template.description || '',
                  params: template.inputSchema || { type: 'object', properties: {}, required: [] },
                  returns: { type: 'object' },
                  isTemplate: true,
                  outputFormat: 'markdown',
                });
              }
            });

            // Apply @visibility annotations
            applyMethodVisibility(reloadSource, methods);

            // Check if this is an App (has main() method with @ui)
            const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

            // Extract class metadata from source
            const reloadClassMeta = extractClassMetadataFromSource(reloadSource);

            // Extract constructor params for reconfiguration support
            let reloadConstructorParams: ConfigParam[] = [];
            try {
              const reloadParams = extractor.extractConstructorParams(reloadSource);
              reloadConstructorParams = reloadParams
                .filter((p: ConstructorParam) => p.isPrimitive)
                .map((p: ConstructorParam) => ({
                  name: p.name,
                  envVar: toEnvVarName(photonName, p.name),
                  type: p.type,
                  isOptional: p.isOptional,
                  hasDefault: p.hasDefault,
                  defaultValue: p.defaultValue,
                }));
            } catch {
              // Can't extract params
            }

            backfillEnvDefaults(mcp.instance, reloadConstructorParams);

            const isStateful = /@stateful\b/.test(reloadSource);
            const reloadedPhoton: PhotonInfo = {
              id: generatePhotonId(photonPath),
              name: photonName,
              path: photonPath,
              configured: true,
              methods,
              isApp: !!mainMethod,
              appEntry: mainMethod,
              description: reloadClassMeta.description,
              icon: reloadClassMeta.icon,
              internal: reloadClassMeta.internal,
              ...(isStateful && { stateful: true }),
              ...(reloadConstructorParams.length > 0 && {
                requiredParams: reloadConstructorParams,
              }),
              ...(mcp.injectedPhotons &&
                mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
            };

            // Re-find the index — it may have shifted during the async work above
            const currentIndex = photons.findIndex((p) => p.name === photonName);
            if (isNewPhoton) {
              if (currentIndex === -1) {
                photons.push(reloadedPhoton);
                broadcastPhotonChange();
                logger.info(`✅ ${photonName} added`);
              }
              // else: another async path already added it — skip duplicate push
            } else {
              if (currentIndex !== -1) {
                photons[currentIndex] = reloadedPhoton;
                logger.info(`📡 Broadcasting hot-reload for ${photonName}`);
                broadcastToBeam('beam/hot-reload', { photon: reloadedPhoton });
                broadcastPhotonChange();
                logger.info(`✅ ${photonName} hot reloaded`);
              }
              // else: photon was removed while we were reloading — discard result
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // For new photons that fail to load, add as unconfigured
            if (isNewPhoton) {
              const extractor = new SchemaExtractor();
              let constructorParams: ConfigParam[] = [];
              try {
                const source = await fs.readFile(photonPath, 'utf-8');
                const params = extractor.extractConstructorParams(source);
                constructorParams = params
                  .filter((p: ConstructorParam) => p.isPrimitive)
                  .map((p: ConstructorParam) => ({
                    name: p.name,
                    envVar: toEnvVarName(photonName, p.name),
                    type: p.type,
                    isOptional: p.isOptional,
                    hasDefault: p.hasDefault,
                    defaultValue: p.defaultValue,
                  }));
              } catch {
                // Ignore extraction errors
              }

              const targetPhoton: UnconfiguredPhotonInfo = {
                id: generatePhotonId(photonPath),
                name: photonName,
                path: photonPath,
                configured: false,
                requiredParams: constructorParams,
                errorReason: constructorParams.length > 0 ? 'missing-config' : 'load-error',
                errorMessage: errorMsg.slice(0, 200),
              };
              if (!photons.find((p) => p.name === photonName)) {
                photons.push(targetPhoton);
                broadcastPhotonChange();
                logger.info(
                  `⚙️ ${photonName} added (needs attention: ${targetPhoton.errorReason})`
                );
              }
              return;
            }

            logger.error(`Hot reload failed for ${photonName}: ${errorMsg}`);
            broadcastToBeam('beam/error', {
              type: 'hot-reload-error',
              photon: photonName,
              message: errorMsg.slice(0, 200),
            });
          }
        } finally {
          activeLoads.delete(photonName);
          // If another file change arrived while we were loading, process it now
          if (pendingAfterLoad.has(photonName)) {
            pendingAfterLoad.delete(photonName);
            handleFileChange(photonName);
          }
        }
      }, 100)
    );
  };

  // Watch working directory recursively
  try {
    const watcher = watch(workingDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(workingDir, filename);
      logger.debug(`📂 File event: ${eventType} ${filename}`);
      const photonName = getPhotonForPath(fullPath);
      if (photonName) {
        logger.info(`📁 Change detected: ${filename} → ${photonName}`);
        handleFileChange(photonName);
      }
    });
    // Handle watcher errors (e.g., EMFILE: too many open files)
    watcher.on('error', (err: Error) => {
      logger.warn(`File watcher error (continuing without hot-reload): ${err.message}`);
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    });
    watchers.push(watcher);
    logger.info(`👀 Watching for changes in ${workingDir}`);
  } catch (error) {
    logger.warn(`File watching not available: ${error}`);
  }

  // Symlinked and bundled photon watchers are set up after photon loading (see below)

  // Bind to 0.0.0.0 for tunnel access, with port fallback
  // Start server BEFORE loading photons so the UI is immediately reachable
  const maxPortAttempts = 10;
  let currentPort = port;

  // Check if a port is available by attempting to connect to it
  // This catches cases where another server binds to 127.0.0.1 but not 0.0.0.0
  const isPortAvailable = (p: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(false); // Port is in use
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(true); // Timeout = port likely free
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(true); // Connection refused = port is free
      });
      socket.connect(p, '127.0.0.1');
    });
  };

  // Find an available port (compact status line output)
  while (currentPort < port + maxPortAttempts) {
    const available = await isPortAvailable(currentPort);
    if (available) {
      // Clear the status line if we printed any
      if (currentPort > port && isTTY) {
        process.stderr.write('\r\x1b[K');
      }
      break;
    }
    if (isTTY) {
      process.stderr.write(`\r\x1b[K⚠️  Port ${currentPort} in use, trying ${currentPort + 1}...`);
    } else {
      console.error(`⚠️  Port ${currentPort} is in use, trying ${currentPort + 1}...`);
    }
    currentPort++;
  }

  if (currentPort >= port + maxPortAttempts) {
    if (isTTY) process.stderr.write('\n');
    console.error(`\n❌ No available port found (tried ${port}-${currentPort - 1}). Exiting.\n`);
    process.exit(1);
  }

  await new Promise<void>((resolve) => {
    const tryListen = (): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && currentPort < port + maxPortAttempts) {
          currentPort++;
          if (isTTY) {
            process.stderr.write(
              `\r\x1b[K⚠️  Port ${currentPort - 1} in use, trying ${currentPort}...`
            );
          } else {
            console.error(`⚠️  Port ${currentPort - 1} is in use, trying ${currentPort}...`);
          }
          tryListen();
        } else if (err.code === 'EADDRINUSE') {
          console.error(`\n❌ No available port found (tried ${port}-${currentPort}). Exiting.\n`);
          process.exit(1);
        } else {
          console.error(`\n❌ Server error: ${err.message}\n`);
          process.exit(1);
        }
      });

      // Security: bind to localhost by default, configurable via BEAM_BIND_ADDRESS
      const bindAddress = process.env.BEAM_BIND_ADDRESS || '127.0.0.1';
      server.listen(currentPort, bindAddress, () => {
        process.env.BEAM_PORT = String(currentPort);
        const url = `http://localhost:${currentPort}`;
        if (isTTY) process.stderr.write('\r\x1b[K'); // Clear any port status line
        startup.showUrl(url); // Show URL status line (not ready yet)
        resolve();
      });

      // Configure server and socket timeouts to prevent premature disconnections
      // Disable server timeout for long-lived SSE connections (0 = no timeout)
      server.setTimeout(0);

      // Enable TCP keepalive on all connections to prevent intermediary timeouts
      server.on('connection', (socket) => {
        socket.setKeepAlive(true, 60000); // Send keepalive probe every 60s
        socket.setTimeout(0); // Disable socket inactivity timeout
      });
    };

    tryListen();
  });

  // Load photons in parallel batches (server is already listening)
  const LOAD_CONCURRENCY = 4;
  for (let i = 0; i < photonList.length; i += LOAD_CONCURRENCY) {
    const batch = photonList.slice(i, i + LOAD_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((name) => loadSinglePhoton(name)));
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Dedup: file watcher may have already loaded this photon during startup
        if (!photons.find((p) => p.name === result.value!.name)) {
          photons.push(result.value);
        }
      }
    }
  }

  configuredCount = photons.filter((p) => p.configured).length;
  unconfiguredCount = photons.filter((p) => !p.configured).length;

  // Load external MCPs from config
  const externalMCPList = await loadExternalMCPs(savedConfig);
  externalMCPs.push(...externalMCPList);
  const connectedMCPs = externalMCPList.filter((m) => m.connected).length;
  const failedMCPs = externalMCPList.length - connectedMCPs;

  const photonStatus =
    unconfiguredCount > 0
      ? `${configuredCount} ready, ${unconfiguredCount} need setup`
      : `${configuredCount} photon${configuredCount !== 1 ? 's' : ''} ready`;
  const mcpStatus =
    externalMCPList.length > 0 ? `, ${connectedMCPs}/${externalMCPList.length} MCPs` : '';
  const url = `http://localhost:${process.env.BEAM_PORT || port}`;

  // Mark startup complete — flushes queued output and restores console
  startup.ready();

  // Notify connected clients that photon list is now available
  broadcastPhotonChange();

  // Auto-start daemon and subscribe to state-changed events for stateful photons
  // Uses reconnect: true so subscriptions survive daemon restarts
  const statefulPhotons = photons.filter((p) => p.stateful && p.configured);
  if (statefulPhotons.length > 0) {
    try {
      await ensureDaemon();

      for (const photon of statefulPhotons) {
        const photonName = photon.name;
        const channel = `${photonName}:state-changed`;
        subscribeChannel(
          photonName,
          channel,
          (message: any) => {
            broadcastToBeam('photon/state-changed', {
              photon: photonName,
              method: message?.method,
              data: message?.data,
            });
          },
          {
            reconnect: true,
            workingDir,
            onReconnect: () => logger.info(`📡 Reconnected ${channel} subscription`),
            onRefreshNeeded: () => {
              logger.info(`📡 Refresh needed for ${channel} (events lost during daemon restart)`);
              broadcastToBeam('photon/state-changed', {
                photon: photonName,
                method: '_refresh',
                data: {},
              });
            },
          }
        )
          .then(() => {
            logger.info(`📡 Subscribed to ${channel} for cross-client sync`);
          })
          .catch((err) => {
            logger.warn(`Failed to subscribe to ${channel}: ${getErrorMessage(err)}`);
          });
      }
    } catch (err) {
      logger.warn(`Failed to start daemon for stateful photons: ${getErrorMessage(err)}`);
    }
  }

  // Set up file watchers for symlinked and bundled photon assets (now that photons are loaded)
  for (const photon of photons) {
    if (!photon.path) {
      logger.debug(`⏭️ Skipping ${photon.name}: no path`);
      continue;
    }
    try {
      const stat = lstatSync(photon.path);
      if (stat.isSymbolicLink()) {
        const realPath = realpathSync(photon.path);
        const realDir = path.dirname(realPath);
        const assetFolder = path.join(realDir, photon.name);

        if (existsSync(assetFolder)) {
          const assetWatcher = watch(assetFolder, { recursive: true }, (eventType, filename) => {
            if (filename) {
              if (
                filename.endsWith('.json') ||
                filename.startsWith('boards/') ||
                filename === 'data.json'
              ) {
                logger.debug(`⏭️ Ignoring data file change: ${photon.name}/${filename}`);
                return;
              }
              logger.info(`📁 Asset change detected: ${photon.name}/${filename}`);
              handleFileChange(photon.name);
            }
          });
          assetWatcher.on('error', (err) => {
            logger.warn(`Watcher error for ${photon.name}/: ${err.message}`);
          });
          watchers.push(assetWatcher);
          logger.info(`👀 Watching ${photon.name}/ (symlinked → ${assetFolder})`);
        } else {
          logger.debug(`⏭️ Skipping ${photon.name}: asset folder not found at ${assetFolder}`);
        }
      } else {
        logger.debug(`⏭️ Skipping ${photon.name}: not a symlink`);
      }
    } catch (err) {
      logger.debug(`⏭️ Skipping ${photon.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Watch bundled photon asset folders
  for (const [photonName, photonPath] of bundledPhotonPaths) {
    const photonDir = path.dirname(photonPath);
    const isInWorkingDir = photonDir.startsWith(workingDir);

    if (isInWorkingDir) {
      const assetFolder = path.join(photonDir, photonName);
      if (existsSync(assetFolder)) {
        logger.info(`👀 Watching ${photonName}/ via main watcher`);
      }
      continue;
    }

    try {
      const photonWatcher = watch(photonPath, (eventType) => {
        if (eventType === 'change') {
          handleFileChange(photonName);
        }
      });
      photonWatcher.on('error', (e) => {
        logger.debug('File watcher error', { photon: photonName, error: getErrorMessage(e) });
      });
      watchers.push(photonWatcher);
    } catch (e) {
      // watch() throws if the path doesn't exist yet — photon may still be installing
      logger.debug('Could not watch photon file', {
        photon: photonName,
        error: getErrorMessage(e),
      });
    }

    const assetFolder = path.join(photonDir, photonName);
    try {
      const assetWatcher = watch(assetFolder, { recursive: true }, (eventType, filename) => {
        if (filename) {
          if (
            filename.endsWith('.json') ||
            filename.startsWith('boards/') ||
            filename === 'data.json'
          ) {
            logger.debug(`⏭️ Ignoring data file change: ${photonName}/${filename}`);
            return;
          }
          logger.info(`📁 Asset change detected: ${photonName}/${filename}`);
          handleFileChange(photonName);
        }
      });
      assetWatcher.on('error', () => {});
      watchers.push(assetWatcher);
      logger.info(`👀 Watching ${photonName}/ for asset changes`);
    } catch {
      // Asset folder doesn't exist or can't be watched - that's okay
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // CONFIG.JSON WATCHER — Detect external MCP changes without restart
  // Watch the parent directory (atomic writes via rename can miss single-file watches)
  // ══════════════════════════════════════════════════════════════════════════════
  try {
    const configFile = getConfigFilePath(workingDir);
    const configDir = path.dirname(configFile);
    // Ensure directory exists before watching (fresh install may not have config.json yet)
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    let configDebounce: NodeJS.Timeout | null = null;

    const configWatcher = watch(configDir, (eventType, filename) => {
      if (filename !== 'config.json') return;

      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(async () => {
        configDebounce = null;

        let newConfig: PhotonConfig;
        try {
          const data = await fs.readFile(configFile, 'utf-8');
          newConfig = migrateConfig(JSON.parse(data));
        } catch (err) {
          logger.warn(
            `⚠️ Failed to parse config.json: ${err instanceof Error ? err.message : err}`
          );
          return;
        }

        const oldServers = savedConfig.mcpServers || {};
        const newServers = newConfig.mcpServers || {};
        const oldKeys = new Set(Object.keys(oldServers));
        const newKeys = new Set(Object.keys(newServers));

        const added = [...newKeys].filter((k) => !oldKeys.has(k));
        const removed = [...oldKeys].filter((k) => !newKeys.has(k));
        const kept = [...newKeys].filter((k) => oldKeys.has(k));
        const modified = kept.filter(
          (k) => JSON.stringify(oldServers[k]) !== JSON.stringify(newServers[k])
        );

        if (added.length === 0 && removed.length === 0 && modified.length === 0) {
          // Also sync photon config changes (env vars etc.)
          savedConfig.photons = newConfig.photons || {};
          return;
        }

        logger.info(
          `🔧 config.json changed — added: [${added}], removed: [${removed}], modified: [${modified}]`
        );

        // Remove MCPs — do all synchronous Map mutations first, then close async
        const removedSdkClients: Array<{ name: string; client: any }> = [];
        for (const name of removed) {
          const idx = externalMCPs.findIndex((m) => m.name === name);
          if (idx !== -1) externalMCPs.splice(idx, 1);

          const sdkClient = externalMCPSDKClients.get(name);
          if (sdkClient) removedSdkClients.push({ name, client: sdkClient });
          externalMCPSDKClients.delete(name);
          externalMCPClients.delete(name);

          logger.info(`🔌 Removed external MCP: ${name}`);
        }
        // Close SDK clients after all Maps are consistent
        for (const { name, client } of removedSdkClients) {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        }

        // Add new MCPs
        if (added.length > 0) {
          const addConfig: PhotonConfig = {
            photons: {},
            mcpServers: Object.fromEntries(added.map((k) => [k, newServers[k]])),
          };
          const newMCPs = await loadExternalMCPs(addConfig);
          externalMCPs.push(...newMCPs);
          for (const m of newMCPs) {
            logger.info(
              `🔌 Added external MCP: ${m.name} (${m.connected ? m.methods.length + ' tools' : 'failed'})`
            );
          }
        }

        // Reconnect modified MCPs — synchronous cleanup first, then async reconnect
        const modifiedSdkClients: Array<{ name: string; client: any }> = [];
        for (const name of modified) {
          const idx = externalMCPs.findIndex((m) => m.name === name);
          if (idx !== -1) externalMCPs.splice(idx, 1);

          const sdkClient = externalMCPSDKClients.get(name);
          if (sdkClient) modifiedSdkClients.push({ name, client: sdkClient });
          externalMCPSDKClients.delete(name);
          externalMCPClients.delete(name);
        }
        // Close old SDK clients
        for (const { client } of modifiedSdkClients) {
          try {
            await client.close();
          } catch {
            /* ignore */
          }
        }
        // Reconnect all modified MCPs
        for (const name of modified) {
          const modConfig: PhotonConfig = {
            photons: {},
            mcpServers: { [name]: newServers[name] },
          };
          const reconnected = await loadExternalMCPs(modConfig);
          externalMCPs.push(...reconnected);
          logger.info(`🔌 Reconnected external MCP: ${name}`);
        }

        // Update savedConfig
        savedConfig.mcpServers = newConfig.mcpServers || {};
        savedConfig.photons = newConfig.photons || {};

        broadcastPhotonChange();
      }, 500);
    });

    configWatcher.on('error', (err: Error) => {
      logger.warn(`Config watcher error: ${err.message}`);
    });
    watchers.push(configWatcher);
    // Only log if config.json actually exists
    if (existsSync(configFile)) {
      logger.info(`👀 Watching config.json for external MCP changes`);
    }
  } catch (error) {
    logger.warn(`Config watching not available: ${error}`);
  }
}

/**
 * Configure a photon via MCP
 */
async function configurePhotonViaMCP(
  photonName: string,
  config: Record<string, any>,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: PhotonConfig,
  workingDir: string,
  activeLoads?: Set<string>
): Promise<{ success: boolean; error?: string }> {
  // Find the photon (configured or unconfigured)
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  // Serialize with file-watcher reloads to prevent concurrent mutation
  if (activeLoads?.has(photonName)) {
    return {
      success: false,
      error: `${photonName} is currently being reloaded — try again shortly`,
    };
  }
  activeLoads?.add(photonName);

  // Apply config to environment
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = String(value);
  }

  // Save config to file (merge with existing config for edit mode)
  savedConfig.photons[photonName] = { ...(savedConfig.photons[photonName] || {}), ...config };
  await saveConfig(savedConfig, workingDir);

  const targetPhoton = photons[photonIndex];
  const isReconfigure = targetPhoton.configured === true;

  // Try to reload the photon
  try {
    const mcp = isReconfigure
      ? await loader.reloadFile(targetPhoton.path)
      : await loader.loadFile(targetPhoton.path);
    const instance = mcp.instance;

    if (!instance) {
      throw new Error('Failed to create instance');
    }

    photonMCPs.set(photonName, mcp);
    backfillEnvDefaults(instance, targetPhoton.requiredParams || []);

    // Extract schema for UI
    const extractor = new SchemaExtractor();
    const configSource = await fs.readFile(targetPhoton.path, 'utf-8');
    const { tools: schemas, templates } = extractor.extractAllFromSource(configSource);
    (mcp as any).schemas = schemas;

    // Get UI assets for linking
    const uiAssets = mcp.assets?.ui || [];

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => {
        const linkedAsset = uiAssets.find((ui: any) => ui.linkedTool === schema.name);
        return {
          name: schema.name,
          description: schema.description || '',
          params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
          autorun: schema.autorun || false,
          outputFormat: schema.outputFormat,
          layoutHints: schema.layoutHints,
          buttonLabel: schema.buttonLabel,
          icon: schema.icon,
          linkedUi: linkedAsset?.id,
        };
      });

    // Add templates as methods
    templates.forEach((template: any) => {
      if (!lifecycleMethods.includes(template.name)) {
        methods.push({
          name: template.name,
          description: template.description || '',
          params: template.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
          isTemplate: true,
          outputFormat: 'markdown',
        });
      }
    });

    // Apply @visibility annotations
    applyMethodVisibility(configSource, methods);

    // Check if this is an App
    const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);
    const isApp = !!mainMethod;

    // Replace unconfigured photon with configured one
    const configuredPhoton: PhotonInfo = {
      id: generatePhotonId(targetPhoton.path),
      name: photonName,
      path: targetPhoton.path,
      configured: true,
      methods,
      isApp,
      appEntry: mainMethod,
      assets: mcp.assets,
      ...(mcp.injectedPhotons &&
        mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
    };

    // Re-find index — array may have shifted during the async work above
    const currentIndex = photons.findIndex((p) => p.name === photonName);
    if (currentIndex === -1) {
      activeLoads?.delete(photonName);
      return { success: false, error: `${photonName} was removed during configuration` };
    }
    photons[currentIndex] = configuredPhoton;
    activeLoads?.delete(photonName);

    logger.info(`✅ ${photonName} configured via MCP`);

    // Notify connected MCP clients about tools list change
    broadcastNotification('notifications/tools/list_changed', {});
    broadcastToBeam('beam/configured', { photon: configuredPhoton });

    return { success: true };
  } catch (error) {
    activeLoads?.delete(photonName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to configure ${photonName} via MCP: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Reload a photon via MCP
 */
async function reloadPhotonViaMCP(
  photonName: string,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: PhotonConfig,
  broadcastChange: () => void,
  activeLoads?: Set<string>
): Promise<{ success: boolean; photon?: PhotonInfo; error?: string }> {
  // Find the photon
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  // Serialize with file-watcher reloads
  if (activeLoads?.has(photonName)) {
    return {
      success: false,
      error: `${photonName} is currently being reloaded — try again shortly`,
    };
  }
  activeLoads?.add(photonName);

  const photon = photons[photonIndex];
  const photonPath = photon.path;

  // Get saved config for this photon
  const config = savedConfig.photons[photonName] || {};

  // Apply config to environment
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = value;
  }

  try {
    // Reload the photon (clears compiled cache for hot reload)
    const mcp = await loader.reloadFile(photonPath);
    const instance = mcp.instance;

    if (!instance) {
      throw new Error('Failed to create instance');
    }

    photonMCPs.set(photonName, mcp);
    backfillEnvDefaults(instance, photon.requiredParams || []);

    // Extract schema for UI
    const extractor = new SchemaExtractor();
    const reloadSrc = await fs.readFile(photonPath, 'utf-8');
    const { tools: schemas, templates } = extractor.extractAllFromSource(reloadSrc);
    (mcp as any).schemas = schemas;

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const uiAssets = mcp.assets?.ui || [];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => {
        const linkedAsset = uiAssets.find((ui: any) => ui.linkedTool === schema.name);
        return {
          name: schema.name,
          description: schema.description || '',
          params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
          autorun: schema.autorun || false,
          outputFormat: schema.outputFormat,
          layoutHints: schema.layoutHints,
          buttonLabel: schema.buttonLabel,
          icon: schema.icon,
          linkedUi: linkedAsset?.id,
        };
      });

    // Add templates as methods
    templates.forEach((template: any) => {
      if (!lifecycleMethods.includes(template.name)) {
        methods.push({
          name: template.name,
          description: template.description || '',
          params: template.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
          isTemplate: true,
          outputFormat: 'markdown',
        });
      }
    });

    // Apply @visibility annotations
    applyMethodVisibility(reloadSrc, methods);

    // Check if this is an App
    const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

    // Extract class metadata from source
    const reloadClassMeta = extractClassMetadataFromSource(reloadSrc);

    // Update photon info
    const reloadedPhoton: PhotonInfo = {
      id: generatePhotonId(photonPath),
      name: photonName,
      path: photonPath,
      configured: true,
      methods,
      isApp: !!mainMethod,
      appEntry: mainMethod,
      description: reloadClassMeta.description,
      icon: reloadClassMeta.icon,
      internal: reloadClassMeta.internal,
      ...(mcp.injectedPhotons &&
        mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
    };

    // Re-find index — array may have shifted during the async work above
    const currentIndex = photons.findIndex((p) => p.name === photonName);
    if (currentIndex === -1) {
      activeLoads?.delete(photonName);
      return { success: false, error: `${photonName} was removed during reload` };
    }
    photons[currentIndex] = reloadedPhoton;
    activeLoads?.delete(photonName);

    logger.info(`🔄 ${photonName} reloaded via MCP`);

    // Notify clients about the change
    broadcastChange();

    return { success: true, photon: reloadedPhoton };
  } catch (error) {
    activeLoads?.delete(photonName);
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to reload ${photonName} via MCP: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Remove a photon via MCP
 */
async function removePhotonViaMCP(
  photonName: string,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  savedConfig: PhotonConfig,
  broadcastChange: () => void,
  workingDir: string
): Promise<{ success: boolean; error?: string }> {
  // Find and remove the photon
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  // Remove from arrays and maps
  photons.splice(photonIndex, 1);
  photonMCPs.delete(photonName);

  // Remove saved config
  if (savedConfig.photons[photonName]) {
    delete savedConfig.photons[photonName];
    await saveConfig(savedConfig, workingDir);
  }

  logger.info(`🗑️ ${photonName} removed via MCP`);

  // Notify clients about the change
  broadcastChange();

  return { success: true };
}

/**
 * Update photon or method metadata via MCP
 */
async function updateMetadataViaMCP(
  photonName: string,
  methodName: string | null,
  metadata: Record<string, any>,
  photons: AnyPhotonInfo[]
): Promise<{ success: boolean; error?: string }> {
  // Find the photon
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  if (methodName) {
    // Update method metadata — read via index at point of use (not a cached ref)
    if (!photons[photonIndex].configured || !photons[photonIndex].methods) {
      return { success: false, error: 'Photon is not configured or has no methods' };
    }

    const method = photons[photonIndex].methods!.find((m: any) => m.name === methodName);
    if (!method) {
      return { success: false, error: `Method not found: ${methodName}` };
    }

    if (metadata.description !== undefined) {
      method.description = metadata.description;
    }
    if (metadata.icon !== undefined) {
      method.icon = metadata.icon;
    }

    logger.info(`📝 Updated metadata for ${photonName}/${methodName}`);
  } else {
    // Update photon metadata directly via index
    if (metadata.description !== undefined) {
      (photons[photonIndex] as any).description = metadata.description;
    }
    if (metadata.icon !== undefined) {
      (photons[photonIndex] as any).icon = metadata.icon;
    }

    logger.info(`📝 Updated metadata for ${photonName}`);
  }

  return { success: true };
}

/**
 * Generate rich help markdown for a photon using PhotonDocExtractor + TemplateManager.
 * Checks for an existing .md file first; generates and saves one if missing.
 */
async function generatePhotonHelpMarkdown(
  photonName: string,
  photons: AnyPhotonInfo[]
): Promise<string> {
  const photon = photons.find((p) => p.name === photonName);
  if (!photon) {
    throw new Error(`Photon not found: ${photonName}`);
  }

  if (!photon.path) {
    throw new Error(`Photon path not available: ${photonName}`);
  }

  const sourceDir = path.dirname(photon.path);
  const mdPath = path.join(sourceDir, `${photonName}.md`);

  // Check if .md file already exists and is newer than the photon source
  try {
    const [mdStat, srcStat] = await Promise.all([fs.stat(mdPath), fs.stat(photon.path)]);
    if (mdStat.mtimeMs >= srcStat.mtimeMs) {
      const existing = await fs.readFile(mdPath, 'utf-8');
      if (existing.trim()) {
        return existing;
      }
    }
  } catch {
    // .md doesn't exist or stat failed - regenerate
  }

  // Extract metadata and render template
  const extractor = new PhotonDocExtractor(photon.path);
  const metadata = await extractor.extractFullMetadata();

  // Use TemplateManager to render the photon.md template
  const templateMgr = new TemplateManager(sourceDir);
  await templateMgr.ensureTemplates();

  const markdown = await templateMgr.renderTemplate('photon.md', metadata);

  // Try to save the generated .md file for future use
  try {
    await fs.writeFile(mdPath, markdown, 'utf-8');
    logger.info(`📄 Generated help doc: ${mdPath}`);
  } catch {
    // Write may fail for bundled/read-only photons - that's fine
    logger.debug(`Could not save help doc to ${mdPath} (read-only?)`);
  }

  return markdown;
}

/**
 * Gracefully stop Beam server and clean up resources.
 * Closes all external MCP SDK clients to prevent ugly tracebacks on shutdown.
 */
export async function stopBeam(): Promise<void> {
  // Close all SDK clients gracefully
  const closePromises: Promise<void>[] = [];

  for (const [, client] of externalMCPSDKClients) {
    closePromises.push(
      client.close().catch(() => {
        // Ignore close errors - process is exiting anyway
      })
    );
  }

  // Wait for all clients to close (with timeout)
  if (closePromises.length > 0) {
    await withTimeout(Promise.all(closePromises), 1000, 'MCP client close timeout').catch(() => {}); // Timeout during shutdown is expected
  }

  externalMCPSDKClients.clear();
  externalMCPClients.clear();
}
