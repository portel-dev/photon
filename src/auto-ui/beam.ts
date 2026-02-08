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
import { existsSync, lstatSync, realpathSync, watch, type FSWatcher } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { isPathWithin, isLocalRequest, setSecurityHeaders, readBody, SimpleRateLimiter } from '../shared/security.js';

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
// WebSocket removed - now using MCP Streamable HTTP (SSE) only
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
import { PhotonDocExtractor } from '../photon-doc-extractor.js';
import { TemplateManager } from '../template-manager.js';
import { subscribeChannel, pingDaemon } from '../daemon/client.js';
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
import { SDKMCPClientFactory, type MCPConfig } from '../mcp-client.js';
import { getBundledPhotonPath, BEAM_BUNDLED_PHOTONS } from '../shared-utils.js';
// SDK imports for direct resource access (transport wrapper doesn't expose these yet)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// BUNDLED_PHOTONS and getBundledPhotonPath are imported from shared-utils.js

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

// Config file path
const CONFIG_FILE = path.join(os.homedir(), '.photon', 'config.json');

// Unified config structure (MCPServerConfig imported from types.ts)
interface PhotonConfig {
  photons: Record<string, Record<string, string>>;
  mcpServers: Record<string, MCPServerConfig>;
}

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

/**
 * Convert a tool name to a display label
 */
function prettifyToolName(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)
    );
    await Promise.race([connectPromise, timeoutPromise]);
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
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)
  );
  await Promise.race([connectPromise, timeoutPromise]);
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

          const appResources = resources.filter(
            (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
          );

          // Count only non-UI resources (UI resources are internal implementation detail)
          mcpInfo.resourceCount = resources.length - appResources.length;

          if (appResources.length > 0) {
            mcpInfo.hasApp = true;
            mcpInfo.appResourceUri = appResources[0].uri;
            mcpInfo.appResourceUris = appResources.map((r: any) => r.uri);
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
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)
          );
          await Promise.race([connectPromise, timeoutPromise]);

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

            // Check for MCP App resources (ui:// scheme or application/vnd.mcp.ui+html mime)
            const appResources = resources.filter(
              (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
            );

            // Count only non-UI resources (UI resources are internal implementation detail)
            mcpInfo.resourceCount = resources.length - appResources.length;

            if (appResources.length > 0) {
              mcpInfo.hasApp = true;
              mcpInfo.appResourceUri = appResources[0].uri; // Default to first
              mcpInfo.appResourceUris = appResources.map((r: any) => r.uri);
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
          // SDK client failed - fall back to wrapper client
          logger.debug(`SDK client failed for ${name}, using wrapper: ${sdkError}`);

          // Try wrapper client as fallback
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
      logger.warn(`⚠️ Failed to connect to external MCP: ${name} - ${errorMsg}`);
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

  const mcp = externalMCPs[mcpIndex];

  try {
    let methods: MethodInfo[] = [];

    if (mcp.config.url) {
      // HTTP transport — tries Streamable HTTP, falls back to legacy SSE
      const sdkClient = await connectHTTPClient(mcp.config.url, name);
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

        const appResources = resources.filter(
          (r: any) => r.uri?.startsWith('ui://') || r.mimeType === 'application/vnd.mcp.ui+html'
        );

        // Count only non-UI resources (UI resources are internal implementation detail)
        mcp.resourceCount = resources.length - appResources.length;

        if (appResources.length > 0) {
          mcp.hasApp = true;
          mcp.appResourceUri = appResources[0].uri;
          mcp.appResourceUris = appResources.map((r: any) => r.uri);
        }
      } catch {
        // Resources not supported
      }
    } else {
      // Stdio / wrapper transport
      const mcpConfig: MCPConfig = {
        mcpServers: {
          [name]: mcp.config,
        },
      };
      const factory = new SDKMCPClientFactory(mcpConfig, false);
      const client = factory.create(name);

      const connectPromise = client.list();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout (10s)')), 10000)
      );

      const tools = (await Promise.race([connectPromise, timeoutPromise])) as any[];

      methods = (tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        params: tool.inputSchema || { type: 'object', properties: {} },
        returns: { type: 'object' },
        icon: tool['x-icon'],
      }));

      externalMCPClients.set(name, client);
    }

    // Update MCP info
    mcp.connected = true;
    mcp.methods = methods;
    mcp.errorMessage = undefined;

    logger.info(`🔌 Reconnected to external MCP: ${name} (${methods.length} tools)`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mcp.errorMessage = errorMsg.slice(0, 200);
    logger.warn(`⚠️ Failed to reconnect to external MCP: ${name} - ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Migrate old flat config to new nested structure
 */
function migrateConfig(config: any): PhotonConfig {
  // Already new format
  if (config.photons !== undefined || config.mcpServers !== undefined) {
    return {
      photons: config.photons || {},
      mcpServers: config.mcpServers || {},
    };
  }

  // Old flat format → migrate all keys under photons
  console.error('📦 Migrating config.json to new nested format...');
  return {
    photons: { ...config },
    mcpServers: {},
  };
}

async function loadConfig(): Promise<PhotonConfig> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    const raw = JSON.parse(data);
    const migrated = migrateConfig(raw);

    // Save back if migration occurred (structure changed)
    if (!raw.photons && Object.keys(raw).length > 0) {
      await saveConfig(migrated);
      console.error('✅ Config migrated successfully');
    }

    return migrated;
  } catch {
    return { photons: {}, mcpServers: {} };
  }
}

async function saveConfig(config: PhotonConfig): Promise<void> {
  const dir = path.dirname(CONFIG_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Extract class-level metadata (description, icon) from JSDoc comments
 */
/**
 * Convert a kebab-case name to a display label
 * e.g. "filesystem" → "Filesystem", "git-box" → "Git Box"
 */
function prettifyName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * After loading a photon, backfill env vars for constructor params that used
 * their TypeScript defaults (env var not set). This ensures the env var always
 * reflects the effective value so other consumers (e.g. /api/browse) can read it.
 */
function backfillEnvDefaults(instance: any, params: ConfigParam[]) {
  for (const param of params) {
    if (!process.env[param.envVar] && param.hasDefault) {
      const value = (instance as Record<string, unknown>)[param.name];
      if (value !== undefined && value !== null) {
        process.env[param.envVar] = String(value);
      }
    }
  }
}

function extractClassMetadataFromSource(content: string): {
  description?: string;
  icon?: string;
  internal?: boolean;
  version?: string;
  author?: string;
  label?: string;
} {
  try {
    // Find class-level JSDoc (immediately before class, or first JSDoc in file)
    const classDocRegex = /\/\*\*([\s\S]*?)\*\/\s*\n?(?:export\s+)?(?:default\s+)?class\s+\w+/;
    const match = content.match(classDocRegex) || content.match(/^\/\*\*([\s\S]*?)\*\//);

    if (!match) {
      return {};
    }

    const docContent = match[1];
    const metadata: {
      description?: string;
      icon?: string;
      internal?: boolean;
      version?: string;
      author?: string;
      label?: string;
    } = {};

    // Extract @icon
    const iconMatch = docContent.match(/@icon\s+(\S+)/);
    if (iconMatch) {
      metadata.icon = iconMatch[1];
    }

    // Extract @internal (presence indicates internal photon)
    if (/@internal\b/.test(docContent)) {
      metadata.internal = true;
    }

    // Extract @version
    const versionMatch = docContent.match(/@version\s+(\S+)/);
    if (versionMatch) {
      metadata.version = versionMatch[1];
    }

    // Extract @author
    const authorMatch = docContent.match(/@author\s+([^\n@]+)/);
    if (authorMatch) {
      metadata.author = authorMatch[1].trim();
    }

    // Extract @label (custom display name)
    const labelMatch = docContent.match(/@label\s+([^\n@]+)/);
    if (labelMatch) {
      metadata.label = labelMatch[1].trim();
    }

    // Extract @description or first line of doc (not starting with @)
    const descMatch = docContent.match(/@description\s+([^\n@]+)/);
    if (descMatch) {
      metadata.description = descMatch[1].trim();
    } else {
      // Get first non-empty line that's not a tag
      const lines = docContent
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter((l) => l && !l.startsWith('@'));
      if (lines.length > 0) {
        metadata.description = lines[0];
      }
    }

    return metadata;
  } catch {
    return {};
  }
}

/**
 * Extract @visibility annotations from method-level JSDoc and apply to methods
 * @visibility model,app → ['model', 'app']
 */
function applyMethodVisibility(source: string, methods: MethodInfo[]): void {
  const regex = /\/\*\*[\s\S]*?@visibility\s+([\w,\s]+)[\s\S]*?\*\/\s*(?:async\s+)?\*?\s*(\w+)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const [, visibilityStr, methodName] = match;
    const method = methods.find((m) => m.name === methodName);
    if (method) {
      method.visibility = visibilityStr
        .split(',')
        .map((v) => v.trim())
        .filter((v): v is 'model' | 'app' => v === 'model' || v === 'app');
    }
  }
}

/**
 * Extract @csp annotations from class-level JSDoc
 * @csp connect domain1,domain2
 * @csp resource cdn.example.com
 */
function extractCspFromSource(source: string): Record<
  string,
  {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  }
> {
  const result: Record<string, any> = {};

  // Match class-level JSDoc with @csp tags
  const classDocRegex = /\/\*\*([\s\S]*?)\*\/\s*\n?(?:export\s+)?(?:default\s+)?class\s+(\w+)/g;
  let classMatch;
  while ((classMatch = classDocRegex.exec(source)) !== null) {
    const docContent = classMatch[1];
    const csp: any = {};
    let hasCsp = false;

    const cspRegex = /@csp\s+(connect|resource|frame|base-uri)\s+([^\n@]+)/g;
    let cspMatch;
    while ((cspMatch = cspRegex.exec(docContent)) !== null) {
      hasCsp = true;
      const directive = cspMatch[1].trim();
      const domains = cspMatch[2]
        .trim()
        .split(/[,\s]+/)
        .filter(Boolean);
      const key = directive === 'base-uri' ? 'baseUriDomains' : `${directive}Domains`;
      csp[key] = (csp[key] || []).concat(domains);
    }

    if (hasCsp) {
      result['__class__'] = csp;
    }
  }

  return result;
}

export async function startBeam(rawWorkingDir: string, port: number): Promise<void> {
  const workingDir = path.resolve(rawWorkingDir);

  // Initialize marketplace manager for photon discovery and installation
  const marketplace = new MarketplaceManager();
  await marketplace.initialize();
  // Auto-update stale caches in background
  marketplace.autoUpdateStaleCaches().catch(() => {});

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
  const savedConfig = await loadConfig();

  // Extract metadata for all photons
  const photons: AnyPhotonInfo[] = [];
  const photonMCPs = new Map<string, any>(); // Store full MCP objects

  // Use PhotonLoader with error-only logger to reduce verbosity
  // Beam handles config errors gracefully via UI forms, but we still want to see actual errors
  const errorOnlyLogger = createLogger({ level: 'error' });
  const loader = new PhotonLoader(false, errorOnlyLogger);

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
      const loadPromise = loader.loadFile(photonPath);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Loading timeout (10s)')), 10000)
      );

      const mcp = (await Promise.race([loadPromise, timeoutPromise])) as any;
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
    id: number;
    method: string;
    params: Record<string, unknown>;
    timestamp: number;
  }

  interface ChannelBuffer {
    events: BufferedEvent[];
    nextId: number;
  }

  const EVENT_BUFFER_SIZE = 30; // Keep last 30 events per channel
  const channelEventBuffers = new Map<string, ChannelBuffer>();

  // Store an event in the channel buffer
  function bufferEvent(channel: string, method: string, params: Record<string, unknown>): number {
    let buffer = channelEventBuffers.get(channel);
    if (!buffer) {
      buffer = { events: [], nextId: 1 };
      channelEventBuffers.set(channel, buffer);
    }

    const eventId = buffer.nextId++;
    const event: BufferedEvent = {
      id: eventId,
      method,
      params,
      timestamp: Date.now(),
    };

    buffer.events.push(event);

    // Keep only last N events (circular buffer)
    if (buffer.events.length > EVENT_BUFFER_SIZE) {
      buffer.events.shift();
    }

    return eventId;
  }

  // Replay missed events to a specific session, or signal refresh needed
  function replayEventsToSession(
    sessionId: string,
    channel: string,
    lastEventId?: number
  ): { replayed: number; refreshNeeded: boolean } {
    const buffer = channelEventBuffers.get(channel);

    // No buffer = no events ever sent on this channel
    if (!buffer || buffer.events.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    // No lastEventId = client is fresh, no replay needed
    if (lastEventId === undefined) {
      return { replayed: 0, refreshNeeded: false };
    }

    const oldestEvent = buffer.events[0];

    // If lastEventId is older than our oldest buffered event, signal refresh needed
    if (lastEventId < oldestEvent.id) {
      sendToSession(sessionId, 'photon/refresh-needed', { channel });
      logger.info(
        `📡 Replay: ${channel} - lastEventId ${lastEventId} too old (oldest: ${oldestEvent.id}), refresh needed`
      );
      return { replayed: 0, refreshNeeded: true };
    }

    // Find events to replay (all events after lastEventId)
    const eventsToReplay = buffer.events.filter((e) => e.id > lastEventId);

    if (eventsToReplay.length === 0) {
      return { replayed: 0, refreshNeeded: false };
    }

    // Replay each missed event to this session
    for (const event of eventsToReplay) {
      sendToSession(sessionId, event.method, { ...event.params, _eventId: event.id });
    }

    logger.info(
      `📡 Replay: ${channel} - replayed ${eventsToReplay.length} events (${lastEventId + 1} to ${buffer.nextId - 1})`
    );
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
        const unsubscribe = await subscribeChannel(photonName, daemonChannel, (message: any) => {
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
        });
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
  // lastEventId: optional - if provided, replay missed events or signal refresh needed
  function onClientViewingBoard(
    sessionId: string,
    photonId: string,
    itemId: string,
    lastEventId?: number
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

    // Replay missed events if lastEventId is provided
    if (lastEventId !== undefined) {
      replayEventsToSession(sessionId, channel, lastEventId);
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
        configurePhoton: async (photonName: string, config: Record<string, any>) => {
          return configurePhotonViaMCP(
            photonName,
            config,
            photons,
            photonMCPs,
            loader,
            savedConfig
          );
        },
        reloadPhoton: async (photonName: string) => {
          return reloadPhotonViaMCP(
            photonName,
            photons,
            photonMCPs,
            loader,
            savedConfig,
            broadcastPhotonChange
          );
        },
        removePhoton: async (photonName: string) => {
          return removePhotonViaMCP(
            photonName,
            photons,
            photonMCPs,
            savedConfig,
            broadcastPhotonChange
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

    // File browser API
    if (url.pathname === '/api/browse') {
      res.setHeader('Content-Type', 'application/json');
      let root = url.searchParams.get('root');

      // Resolve photon's workdir as root constraint
      const photonParam = url.searchParams.get('photon');
      if (photonParam && !root) {
        const envPrefix = photonParam.toUpperCase().replace(/-/g, '_');
        const workdirEnv = process.env[`${envPrefix}_WORKDIR`];
        if (workdirEnv) {
          root = path.resolve(workdirEnv);
        }
      }

      // Security: default browse root to workingDir if not specified
      if (!root) {
        root = workingDir;
      }

      const dirPath = url.searchParams.get('path') || root;

      try {
        const resolved = path.resolve(dirPath);

        // Security: always enforce path boundary using isPathWithin
        if (!isPathWithin(resolved, root)) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Access denied: outside allowed directory' }));
          return;
        }

        const stat = await fs.stat(resolved);

        if (!stat.isDirectory()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Not a directory' }));
          return;
        }

        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const items = entries
          .filter((e) => !e.name.startsWith('.') || e.name === '.photon')
          .map((e) => ({
            name: e.name,
            path: path.join(resolved, e.name),
            isDirectory: e.isDirectory(),
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        res.writeHead(200);
        res.end(
          JSON.stringify({
            path: resolved,
            parent: path.dirname(resolved),
            root: root ? path.resolve(root) : null,
            items,
          })
        );
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to read directory' }));
      }
      return;
    }

    // Serve a local file (for relative image paths in markdown previews, etc.)
    if (url.pathname === '/api/local-file') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400);
        res.end('Missing path parameter');
        return;
      }

      const resolved = path.resolve(filePath);

      // Security: prevent path traversal — file must be within working directory
      if (!isPathWithin(resolved, workingDir)) {
        res.writeHead(403);
        res.end('Access denied: outside allowed directory');
        return;
      }

      try {
        const fileStat = await fs.stat(resolved);
        if (!fileStat.isFile()) {
          res.writeHead(400);
          res.end('Not a file');
          return;
        }

        // Determine MIME type from extension
        const ext = path.extname(resolved).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
          '.bmp': 'image/bmp',
          '.avif': 'image/avif',
          '.pdf': 'application/pdf',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        const data = await fs.readFile(resolved);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=300',
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('File not found');
      }
      return;
    }

    // Get photon's workdir (if applicable)
    if (url.pathname === '/api/photon-workdir') {
      res.setHeader('Content-Type', 'application/json');
      const photonName = url.searchParams.get('name');

      // If no photon name provided, just return the default working directory
      if (!photonName) {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            defaultWorkdir: workingDir,
          })
        );
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Photon not found' }));
        return;
      }

      // For filesystem photon, use BEAM's working directory
      // This ensures the file browser shows the same files BEAM is managing
      let photonWorkdir: string | null = null;
      if (photonName === 'filesystem') {
        photonWorkdir = workingDir;
      }

      res.writeHead(200);
      res.end(
        JSON.stringify({
          name: photonName,
          workdir: photonWorkdir,
          defaultWorkdir: workingDir,
        })
      );
      return;
    }

    // Serve UI templates for custom UI rendering
    if (url.pathname === '/api/ui') {
      const photonName = url.searchParams.get('photon');
      const uiId = url.searchParams.get('id');

      if (!photonName || !uiId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon or id parameter' }));
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Photon not found' }));
        return;
      }

      // UI templates are in <photon-dir>/<photon-name>/ui/<id>.html
      const photonDir = path.dirname(photon.path);

      // Try to use resolved path from assets if available (respects JSDoc)
      const asset = (photon as any).assets?.ui?.find((u: any) => u.id === uiId);

      let uiPath: string;
      if (asset && asset.resolvedPath) {
        uiPath = asset.resolvedPath;
      } else {
        uiPath = path.join(photonDir, photonName, 'ui', `${uiId}.html`);
      }

      try {
        const uiContent = await fs.readFile(uiPath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.writeHead(200);
        res.end(uiContent);
      } catch {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `UI template not found: ${uiId}` }));
      }
      return;
    }

    // Serve MCP App HTML from external MCPs with MCP Apps Extension
    if (url.pathname === '/api/mcp-app') {
      const mcpName = url.searchParams.get('mcp');
      const resourceUri = url.searchParams.get('uri');

      if (!mcpName || !resourceUri) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing mcp or uri parameter' }));
        return;
      }

      const sdkClient = externalMCPSDKClients.get(mcpName);
      if (!sdkClient) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `MCP not found or no SDK client: ${mcpName}` }));
        return;
      }

      try {
        const resourceResult = await sdkClient.readResource({ uri: resourceUri });
        const content = resourceResult.contents?.[0];
        if (!content) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: `Resource not found: ${resourceUri}` }));
          return;
        }

        // Content can have either text or blob
        const contentText = 'text' in content ? content.text : null;
        const contentBlob = 'blob' in content ? content.blob : null;

        if (!contentText && !contentBlob) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: `Resource has no content: ${resourceUri}` }));
          return;
        }

        res.setHeader('Content-Type', content.mimeType || 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.writeHead(200);
        if (contentText) {
          res.end(contentText);
        } else if (contentBlob) {
          // blob is base64 encoded
          res.end(Buffer.from(contentBlob, 'base64'));
        }
      } catch (error) {
        logger.error(`Failed to read MCP App resource: ${error}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: `Failed to read resource: ${error}` }));
      }
      return;
    }

    // Serve @ui template files (class-level custom UI)
    if (url.pathname === '/api/template') {
      const photonName = url.searchParams.get('photon');
      const templatePathParam = url.searchParams.get('path');

      if (!photonName) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon parameter' }));
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      if (!photon || !photon.configured) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Photon not found or not configured' }));
        return;
      }

      // Use provided path or photon's templatePath
      const templateFile = templatePathParam || (photon as PhotonInfo).templatePath;
      if (!templateFile) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'No template path specified' }));
        return;
      }

      // Resolve template path relative to photon's directory
      const photonDir = path.dirname(photon.path);

      // Security: reject absolute template paths — must be relative to photon dir
      if (path.isAbsolute(templateFile)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Absolute template paths are not allowed' }));
        return;
      }

      const fullTemplatePath = path.join(photonDir, templateFile);

      // Security: validate resolved path is within photon directory
      if (!isPathWithin(fullTemplatePath, photonDir)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Template path traversal detected' }));
        return;
      }

      try {
        const templateContent = await fs.readFile(fullTemplatePath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.writeHead(200);
        res.end(templateContent);
      } catch {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Template not found: ${templateFile}` }));
      }
      return;
    }

    // PWA Manifest - Auto-generated for any photon
    if (url.pathname === '/api/pwa/manifest.json') {
      const photonName = url.searchParams.get('photon');
      if (!photonName) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon parameter' }));
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      const displayName = photon?.name || photonName;
      const description = (photon as any)?.description || `${displayName} - Photon App`;

      const manifest = {
        name: displayName,
        short_name: displayName,
        description,
        start_url: `/api/pwa/app?photon=${encodeURIComponent(photonName)}`,
        display: 'standalone',
        background_color: '#1a1a1a',
        theme_color: '#1a1a1a',
        orientation: 'any',
        icons: [
          {
            src: `/api/pwa/icon.svg?photon=${encodeURIComponent(photonName)}`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        categories: ['developer', 'utilities'],
      };

      res.setHeader('Content-Type', 'application/manifest+json');
      res.writeHead(200);
      res.end(JSON.stringify(manifest, null, 2));
      return;
    }

    // PWA Icon - Auto-generated SVG from photon emoji
    if (url.pathname === '/api/pwa/icon.svg') {
      const photonName = url.searchParams.get('photon');
      const photon = photons.find((p) => p.name === photonName);
      const emoji = (photon as any)?.icon || '📦';

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#1a1a1a"/>
  <text x="50" y="50" font-size="50" text-anchor="middle" dominant-baseline="central">${emoji}</text>
</svg>`;

      res.setHeader('Content-Type', 'image/svg+xml');
      res.writeHead(200);
      res.end(svg);
      return;
    }

    // PWA App Entry - Serves the photon UI with PWA tags injected
    if (url.pathname === '/api/pwa/app') {
      const photonName = url.searchParams.get('photon');

      if (!photonName) {
        res.writeHead(400);
        res.end('Missing photon parameter');
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(`Photon not found: ${photonName}`);
        return;
      }

      const displayName = photon.name;
      const emoji = (photon as any)?.icon || '📦';
      const uiAssets = (photon as any).assets?.ui || [];
      const asset = uiAssets.find((u: any) => u.linkedTool === 'main') || uiAssets[0];
      const uiId = asset?.id || 'main';

      // PWA Host page - embeds photon UI in iframe, handles postMessage
      const pwaHost = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emoji} ${displayName}</title>
  <link rel="manifest" href="/api/pwa/manifest.json?photon=${encodeURIComponent(photonName)}">
  <meta name="theme-color" content="#1a1a1a">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${displayName}">
  <link rel="apple-touch-icon" href="/api/pwa/icon.svg?photon=${encodeURIComponent(photonName)}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { min-height: 100%; background: #1a1a1a; font-family: system-ui, sans-serif; color: #e5e5e5; }
    .app-container { display: flex; flex-direction: column; min-height: 100vh; }
    .app-frame { flex: 1; min-height: 80vh; }
    iframe { width: 100%; height: 100%; min-height: 80vh; border: none; }

    .offline {
      display: none;
      height: 100vh;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #888;
      text-align: center;
      padding: 40px;
    }
    .offline.show { display: flex; }
    .offline h1 { font-size: 48px; margin-bottom: 20px; }
    .offline p { font-size: 18px; margin-bottom: 30px; max-width: 400px; line-height: 1.6; }
    .offline code {
      background: #2a2a2a;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      color: #4ade80;
      font-family: monospace;
    }
    .offline .retry {
      margin-top: 20px;
      padding: 10px 20px;
      background: #333;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
    }
    .offline .retry:hover { background: #444; }
  </style>
</head>
<body>
  <div id="offline" class="offline">
    <h1>${emoji}</h1>
    <p>Server is not running. Start Photon to use ${displayName}:</p>
    <code>photon</code>
    <button class="retry" onclick="location.reload()">Retry</button>
  </div>

  <div class="app-container" id="app-container" style="display:none">
    <iframe id="app"></iframe>
  </div>

  <script>
    const iframe = document.getElementById('app');
    const offline = document.getElementById('offline');
    const appContainer = document.getElementById('app-container');
    const photonName = '${photonName}';
    const uiId = '${uiId}';

    // Load UI with platform bridge injected
    async function loadApp() {
      try {
        // Fetch UI template and platform bridge
        const [uiRes, bridgeRes] = await Promise.all([
          fetch('/api/ui?photon=' + encodeURIComponent(photonName) + '&id=' + encodeURIComponent(uiId)),
          fetch('/api/platform-bridge?photon=' + encodeURIComponent(photonName) + '&method=' + encodeURIComponent(uiId) + '&theme=dark')
        ]);

        if (!uiRes.ok) {
          offline.classList.add('show');
          return;
        }

        let html = await uiRes.text();
        const bridge = bridgeRes.ok ? await bridgeRes.text() : '';

        // Inject platform bridge before </head>
        html = html.replace('</head>', bridge + '</head>');

        // Create blob URL and load in iframe
        const blob = new Blob([html], { type: 'text/html' });
        iframe.src = URL.createObjectURL(blob);
        appContainer.style.display = 'flex';
        initBridge();
      } catch (e) {
        offline.classList.add('show');
      }
    }

    function initBridge() {
      // Listen for messages from iframe
      window.addEventListener('message', async (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;

        // Handle JSON-RPC tools/call from iframe
        if (msg.jsonrpc === '2.0' && msg.method === 'tools/call' && msg.id != null) {
          const { name: toolName, arguments: toolArgs } = msg.params || {};
          try {
            const res = await fetch('/api/invoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photon: photonName, method: toolName, args: toolArgs || {} }),
              signal: AbortSignal.timeout(60000), // 60s for method calls
            });
            const data = await res.json();
            iframe.contentWindow.postMessage({
              jsonrpc: '2.0',
              id: msg.id,
              result: data.error ? undefined : (data.result !== undefined ? data.result : data),
              error: data.error ? { code: -32000, message: data.error } : undefined,
            }, '*');
          } catch (err) {
            iframe.contentWindow.postMessage({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32000, message: err.message },
            }, '*');
          }
        }
      });

      // Send init message to iframe once loaded
      iframe.onload = () => {
        iframe.contentWindow.postMessage({
          type: 'photon:init',
          context: { photon: photonName, theme: 'dark', displayMode: 'fullscreen' }
        }, '*');
      };
    }

    loadApp();
  </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(pwaHost);
      return;
    }

    // Invoke API: Direct HTTP endpoint for method invocation (used by PWA)
    if (url.pathname === '/api/invoke' && req.method === 'POST') {
      // Security: only allow local requests
      if (!isLocalRequest(req)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Forbidden: non-local request' }));
        return;
      }

      // Security: rate limiting
      const clientKey = req.socket?.remoteAddress || 'unknown';
      if (!apiRateLimiter.isAllowed(clientKey)) {
        res.writeHead(429);
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return;
      }

      try {
        const body = await readBody(req);
        const { photon: photonName, method, args } = JSON.parse(body);

        if (!photonName || !method) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing photon or method' }));
          return;
        }

        const mcp = photonMCPs.get(photonName);
        if (!mcp || !mcp.instance) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: `Photon not found: ${photonName}` }));
          return;
        }

        if (typeof mcp.instance[method] !== 'function') {
          res.writeHead(404);
          res.end(JSON.stringify({ error: `Method not found: ${method}` }));
          return;
        }

        const result = await mcp.instance[method](args || {});
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ result }));
      } catch (err: any) {
        const status = err.message?.includes('too large') ? 413 : 500;
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(status);
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
      return;
    }

    // Platform Bridge API: Generate platform compatibility script
    // Uses the unified bridge architecture based on @modelcontextprotocol/ext-apps SDK
    if (url.pathname === '/api/platform-bridge') {
      const theme = (url.searchParams.get('theme') || 'dark') as 'light' | 'dark';
      const photonName = url.searchParams.get('photon') || '';
      const methodName = url.searchParams.get('method') || '';

      // Look up injected photons for this photon
      const photon = photons.find((p) => p.name === photonName);
      const injectedPhotonsList =
        photon && photon.configured && (photon as PhotonInfo).injectedPhotons;

      const { generateBridgeScript } = await import('./bridge/index.js');
      const script = generateBridgeScript({
        theme,
        locale: 'en-US',
        photon: photonName,
        method: methodName,
        hostName: 'beam',
        hostVersion: '1.5.0',
        injectedPhotons: injectedPhotonsList || [],
      });

      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(script);
      return;
    }

    // Diagnostics endpoint: server health and photon status
    if (url.pathname === '/api/diagnostics') {
      res.setHeader('Content-Type', 'application/json');

      try {
        const { PHOTON_VERSION } = await import('../version.js');
        const sources = marketplace.getAll();

        const photonStatus = photons.map((p) => ({
          name: p.name,
          status: p.configured ? 'loaded' : 'unconfigured',
          methods: p.configured ? (p as PhotonInfo).methods.length : 0,
          error: !p.configured ? (p as UnconfiguredPhotonInfo).errorMessage : undefined,
          internal: (p as any).internal || undefined,
          path: p.path || undefined,
        }));

        res.writeHead(200);
        res.end(
          JSON.stringify({
            nodeVersion: process.version,
            photonVersion: PHOTON_VERSION,
            workingDir,
            uptime: process.uptime(),
            photonCount: photons.length,
            configuredCount: photons.filter((p) => p.configured).length,
            unconfiguredCount: photons.filter((p) => !p.configured).length,
            marketplaceSources: sources.filter((s) => s.enabled).length,
            photons: photonStatus,
          })
        );
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to generate diagnostics' }));
      }
      return;
    }

    // MCP Config Export endpoint: generate Claude Desktop config snippet
    if (url.pathname === '/api/export/mcp-config') {
      res.setHeader('Content-Type', 'application/json');

      const photonName = url.searchParams.get('photon');
      if (!photonName) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon query parameter' }));
        return;
      }

      const photon = photons.find((p) => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Photon '${photonName}' not found` }));
        return;
      }

      res.writeHead(200);
      res.end(
        JSON.stringify(
          {
            mcpServers: {
              [`photon-${photonName}`]: {
                command: 'npx',
                args: ['-y', '@portel/photon', 'mcp', photonName],
              },
            },
          },
          null,
          2
        )
      );
      return;
    }

    // OpenAPI Specification endpoint
    // Serves auto-generated OpenAPI 3.1 spec from loaded photons
    if (url.pathname === '/api/openapi.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      try {
        const serverUrl = `http://${req.headers.host || 'localhost:' + port}`;
        const spec = generateOpenAPISpec(photons, serverUrl);
        res.writeHead(200);
        res.end(JSON.stringify(spec, null, 2));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to generate OpenAPI spec' }));
      }
      return;
    }

    // Marketplace API: Search photons
    if (url.pathname === '/api/marketplace/search') {
      res.setHeader('Content-Type', 'application/json');
      const query = url.searchParams.get('q') || '';

      try {
        const results = await marketplace.search(query);
        const photonList: any[] = [];

        for (const [name, sources] of results) {
          const source = sources[0]; // Use first source
          photonList.push({
            name,
            description: source.metadata?.description || '',
            version: source.metadata?.version || '',
            author: source.metadata?.author || '',
            tags: source.metadata?.tags || [],
            marketplace: source.marketplace.name,
            installed: photonMCPs.has(name),
          });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ photons: photonList }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Search failed' }));
      }
      return;
    }

    // Marketplace API: List all available photons
    if (url.pathname === '/api/marketplace/list') {
      res.setHeader('Content-Type', 'application/json');

      try {
        const allPhotons = await marketplace.getAllPhotons();
        const photonList: any[] = [];

        for (const [name, { metadata, marketplace: mp }] of allPhotons) {
          photonList.push({
            name,
            description: metadata.description || '',
            version: metadata.version || '',
            author: metadata.author || '',
            tags: metadata.tags || [],
            marketplace: mp.name,
            icon: metadata.icon,
            internal: metadata.internal,
            installed: photonMCPs.has(name),
          });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ photons: photonList }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to list photons' }));
      }
      return;
    }

    // Marketplace API: Add/install a photon
    if (url.pathname === '/api/marketplace/add' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { name } = JSON.parse(body);
          if (!name) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing photon name' }));
            return;
          }

          // Fetch the photon from marketplace
          const result = await marketplace.fetchMCP(name);
          if (!result) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: `Photon '${name}' not found in marketplace` }));
            return;
          }

          // Write to working directory
          const targetPath = path.join(workingDir, `${name}.photon.ts`);
          await fs.writeFile(targetPath, result.content, 'utf-8');

          // Save metadata if available
          if (result.metadata) {
            const hash = (await import('../marketplace-manager.js')).calculateHash(result.content);
            await marketplace.savePhotonMetadata(
              `${name}.photon.ts`,
              result.marketplace,
              result.metadata,
              hash
            );
          }

          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              name,
              path: targetPath,
              version: result.metadata?.version,
            })
          );

          // Broadcast to connected clients to reload photon list
          broadcastPhotonChange();
        } catch {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to add photon' }));
        }
      });
      return;
    }

    // Marketplace API: Get all marketplace sources
    if (url.pathname === '/api/marketplace/sources') {
      res.setHeader('Content-Type', 'application/json');

      try {
        const sources = marketplace.getAll();
        const sourcesWithCounts = await Promise.all(
          sources.map(async (source) => {
            // Get photon count from cached manifest
            const manifest = await marketplace.getCachedManifest(source.name);
            return {
              name: source.name,
              repo: source.repo,
              source: source.source,
              sourceType: source.sourceType,
              enabled: source.enabled,
              photonCount: manifest?.photons?.length || 0,
              lastUpdated: source.lastUpdated,
            };
          })
        );

        res.writeHead(200);
        res.end(JSON.stringify({ sources: sourcesWithCounts }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to get marketplace sources' }));
      }
      return;
    }

    // Marketplace API: Add a new marketplace source
    if (url.pathname === '/api/marketplace/sources/add' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { source } = JSON.parse(body);
          if (!source) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing source parameter' }));
            return;
          }

          const result = await marketplace.add(source);

          // Update cache for the new marketplace
          if (result.added) {
            await marketplace.updateMarketplaceCache(result.marketplace.name);
          }

          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              name: result.marketplace.name,
              added: result.added,
            })
          );
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    // Marketplace API: Remove a marketplace source
    if (url.pathname === '/api/marketplace/sources/remove' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { name } = JSON.parse(body);
          if (!name) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing name parameter' }));
            return;
          }

          const removed = await marketplace.remove(name);
          if (!removed) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: `Marketplace '${name}' not found` }));
            return;
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    // Marketplace API: Toggle marketplace enabled/disabled
    if (url.pathname === '/api/marketplace/sources/toggle' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { name, enabled } = JSON.parse(body);
          if (!name || typeof enabled !== 'boolean') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing name or enabled parameter' }));
            return;
          }

          const success = await marketplace.setEnabled(name, enabled);
          if (!success) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: `Marketplace '${name}' not found` }));
            return;
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    // Marketplace API: Refresh marketplace cache
    if (url.pathname === '/api/marketplace/refresh' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { name } = JSON.parse(body || '{}');

          if (name) {
            // Refresh specific marketplace
            const success = await marketplace.updateMarketplaceCache(name);
            res.writeHead(200);
            res.end(JSON.stringify({ success, updated: success ? [name] : [] }));
          } else {
            // Refresh all enabled marketplaces
            const results = await marketplace.updateAllCaches();
            const updated = Array.from(results.entries())
              .filter(([, success]) => success)
              .map(([name]) => name);

            res.writeHead(200);
            res.end(JSON.stringify({ success: true, updated }));
          }
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    // Marketplace API: Check for available updates
    if (url.pathname === '/api/marketplace/updates') {
      res.setHeader('Content-Type', 'application/json');

      try {
        const { readLocalMetadata } = await import('../marketplace-manager.js');
        const localMetadata = await readLocalMetadata();
        const updates: Array<{
          name: string;
          fileName: string;
          currentVersion: string;
          latestVersion: string;
          marketplace: string;
        }> = [];

        // Check each installed photon for updates
        for (const [fileName, installMeta] of Object.entries(localMetadata.photons)) {
          const photonName = fileName.replace(/\.photon\.ts$/, '');
          const latestInfo = await marketplace.getPhotonMetadata(photonName);

          if (latestInfo && latestInfo.metadata.version !== installMeta.version) {
            updates.push({
              name: photonName,
              fileName,
              currentVersion: installMeta.version,
              latestVersion: latestInfo.metadata.version,
              marketplace: latestInfo.marketplace.name,
            });
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ updates }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to check for updates' }));
      }
      return;
    }

    // Test API: Run a single test
    // Supports modes: 'direct' (call instance method), 'mcp' (call via executeTool), 'cli' (spawn subprocess)
    if (url.pathname === '/api/test/run' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');

        try {
          const { photon: photonName, test: testName, mode = 'direct' } = JSON.parse(body);

          // Find the photon
          const photon = photons.find((p) => p.name === photonName);
          if (!photon) {
            res.writeHead(404);
            res.end(JSON.stringify({ passed: false, error: 'Photon not found', mode }));
            return;
          }

          // Get the MCP instance
          const mcp = photonMCPs.get(photonName);
          if (!mcp || !mcp.instance) {
            res.writeHead(404);
            res.end(JSON.stringify({ passed: false, error: 'Photon not loaded', mode }));
            return;
          }

          // Run the test method
          const start = Date.now();
          try {
            let result: any;

            if (mode === 'mcp') {
              // MCP mode: use executeTool to simulate MCP protocol
              // This tests the full tool execution path
              result = await loader.executeTool(mcp, testName, {}, {});
            } else if (mode === 'cli') {
              // CLI mode: spawn subprocess to test CLI interface
              const cliPath = path.resolve(__dirname, '..', 'cli.js');
              const args = ['cli', photonName, testName, '--json', '--dir', workingDir];

              result = await new Promise((resolve) => {
                const proc = spawn('node', [cliPath, ...args], {
                  cwd: workingDir,
                  timeout: 30000,
                  env: { ...process.env },
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => (stdout += data.toString()));
                proc.stderr.on('data', (data) => (stderr += data.toString()));

                proc.on('close', (code) => {
                  const output = stdout.trim() || stderr.trim();
                  const hasOutput = output.length > 0;
                  const infraErrors = [
                    'Photon not found',
                    'command not found',
                    'Cannot find module',
                    'ENOENT',
                  ];
                  const isInfraError = infraErrors.some((e) => (stdout + stderr).includes(e));

                  if (hasOutput && !isInfraError) {
                    // CLI interface worked - transport successful
                    resolve({ passed: true, message: 'CLI interface test passed' });
                  } else if (isInfraError) {
                    resolve({ passed: false, error: `CLI infrastructure error: ${output}` });
                  } else {
                    resolve({
                      passed: false,
                      error: `CLI test failed with code ${code}: no output`,
                    });
                  }
                });

                proc.on('error', (err) => {
                  resolve({ passed: false, error: `CLI spawn error: ${err.message}` });
                });
              });
            } else {
              // Direct mode: call instance method directly
              result = await mcp.instance[testName]();
            }

            const duration = Date.now() - start;

            // Check result
            if (result && typeof result === 'object') {
              if (result.skipped === true) {
                res.writeHead(200);
                res.end(
                  JSON.stringify({
                    passed: true,
                    skipped: true,
                    message: result.reason || 'Skipped',
                    duration,
                    mode,
                  })
                );
              } else if (result.passed === false) {
                res.writeHead(200);
                res.end(
                  JSON.stringify({
                    passed: false,
                    error: result.error || result.message || 'Test failed',
                    duration,
                    mode,
                  })
                );
              } else {
                res.writeHead(200);
                res.end(
                  JSON.stringify({
                    passed: true,
                    message: result?.message,
                    duration,
                    mode,
                  })
                );
              }
            } else {
              res.writeHead(200);
              res.end(
                JSON.stringify({
                  passed: true,
                  duration,
                  mode,
                })
              );
            }
          } catch (testError: any) {
            const duration = Date.now() - start;
            res.writeHead(200);
            res.end(
              JSON.stringify({
                passed: false,
                error: testError.message || String(testError),
                duration,
                mode,
              })
            );
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ passed: false, error: 'Invalid request' }));
        }
      });
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
            await saveConfig(savedConfig);
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
            photons.push(targetPhoton);
            broadcastPhotonChange();
            logger.info(`⚙️ ${photonName} added (needs configuration)`);
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
            ...(reloadConstructorParams.length > 0 && { requiredParams: reloadConstructorParams }),
            ...(mcp.injectedPhotons &&
              mcp.injectedPhotons.length > 0 && { injectedPhotons: mcp.injectedPhotons }),
          };

          if (isNewPhoton) {
            photons.push(reloadedPhoton);
            broadcastPhotonChange();
            logger.info(`✅ ${photonName} added`);
          } else {
            photons[photonIndex] = reloadedPhoton;
            logger.info(`📡 Broadcasting hot-reload for ${photonName}`);
            broadcastToBeam('beam/hot-reload', { photon: reloadedPhoton });
            broadcastPhotonChange();
            logger.info(`✅ ${photonName} hot reloaded`);
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
            photons.push(targetPhoton);
            broadcastPhotonChange();
            logger.info(`⚙️ ${photonName} added (needs attention: ${targetPhoton.errorReason})`);
            return;
          }

          logger.error(`Hot reload failed for ${photonName}: ${errorMsg}`);
          broadcastToBeam('beam/error', {
            type: 'hot-reload-error',
            photon: photonName,
            message: errorMsg.slice(0, 200),
          });
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

  // Find an available port
  while (currentPort < port + maxPortAttempts) {
    const available = await isPortAvailable(currentPort);
    if (available) break;
    console.error(`⚠️  Port ${currentPort} is in use, trying ${currentPort + 1}...`);
    currentPort++;
  }

  if (currentPort >= port + maxPortAttempts) {
    console.error(`\n❌ No available port found (tried ${port}-${currentPort - 1}). Exiting.\n`);
    process.exit(1);
  }

  await new Promise<void>((resolve) => {
    const tryListen = (): void => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && currentPort < port + maxPortAttempts) {
          currentPort++;
          console.error(`⚠️  Port ${currentPort - 1} is in use, trying ${currentPort}...`);
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
        console.log(`\n⚡ Photon Beam → ${url} (loading photons...)\n`);
        resolve();
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
        photons.push(result.value);
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
  console.log(`⚡ Photon Beam ready (${photonStatus}${mcpStatus})`);

  // Notify connected clients that photon list is now available
  broadcastPhotonChange();

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
      photonWatcher.on('error', () => {});
      watchers.push(photonWatcher);
    } catch {
      // Ignore errors
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
    const configDir = path.dirname(CONFIG_FILE);
    let configDebounce: NodeJS.Timeout | null = null;

    const configWatcher = watch(configDir, (eventType, filename) => {
      if (filename !== 'config.json') return;

      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(async () => {
        configDebounce = null;

        let newConfig: PhotonConfig;
        try {
          const data = await fs.readFile(CONFIG_FILE, 'utf-8');
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

        // Remove MCPs
        for (const name of removed) {
          const idx = externalMCPs.findIndex((m) => m.name === name);
          if (idx !== -1) externalMCPs.splice(idx, 1);

          // Clean up clients
          try {
            const sdkClient = externalMCPSDKClients.get(name);
            if (sdkClient) {
              await sdkClient.close();
              externalMCPSDKClients.delete(name);
            }
          } catch {
            /* ignore */
          }
          externalMCPClients.delete(name);

          logger.info(`🔌 Removed external MCP: ${name}`);
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

        // Reconnect modified MCPs
        for (const name of modified) {
          const idx = externalMCPs.findIndex((m) => m.name === name);
          if (idx !== -1) {
            // Clean up old clients
            try {
              const sdkClient = externalMCPSDKClients.get(name);
              if (sdkClient) {
                await sdkClient.close();
                externalMCPSDKClients.delete(name);
              }
            } catch {
              /* ignore */
            }
            externalMCPClients.delete(name);
            externalMCPs.splice(idx, 1);
          }

          // Reconnect with new config
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
    logger.info(`👀 Watching config.json for external MCP changes`);
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
  savedConfig: PhotonConfig
): Promise<{ success: boolean; error?: string }> {
  // Find the photon (configured or unconfigured)
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

  // Apply config to environment
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = String(value);
  }

  // Save config to file (merge with existing config for edit mode)
  savedConfig.photons[photonName] = { ...(savedConfig.photons[photonName] || {}), ...config };
  await saveConfig(savedConfig);

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

    photons[photonIndex] = configuredPhoton;

    logger.info(`✅ ${photonName} configured via MCP`);

    // Notify connected MCP clients about tools list change
    broadcastNotification('notifications/tools/list_changed', {});
    broadcastToBeam('beam/configured', { photon: configuredPhoton });

    return { success: true };
  } catch (error) {
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
  broadcastChange: () => void
): Promise<{ success: boolean; photon?: PhotonInfo; error?: string }> {
  // Find the photon
  const photonIndex = photons.findIndex((p) => p.name === photonName);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found: ${photonName}` };
  }

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

    photons[photonIndex] = reloadedPhoton;

    logger.info(`🔄 ${photonName} reloaded via MCP`);

    // Notify clients about the change
    broadcastChange();

    return { success: true, photon: reloadedPhoton };
  } catch (error) {
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
  broadcastChange: () => void
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
    await saveConfig(savedConfig);
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

  const photon = photons[photonIndex];

  if (methodName) {
    // Update method metadata
    if (!photon.configured || !photon.methods) {
      return { success: false, error: 'Photon is not configured or has no methods' };
    }

    const method = photon.methods.find((m: any) => m.name === methodName);
    if (!method) {
      return { success: false, error: `Method not found: ${methodName}` };
    }

    // Update method metadata
    if (metadata.description !== undefined) {
      method.description = metadata.description;
    }
    if (metadata.icon !== undefined) {
      method.icon = metadata.icon;
    }

    logger.info(`📝 Updated metadata for ${photonName}/${methodName}`);
  } else {
    // Update photon metadata
    if (metadata.description !== undefined) {
      (photon as any).description = metadata.description;
    }
    if (metadata.icon !== undefined) {
      (photon as any).icon = metadata.icon;
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
    await Promise.race([
      Promise.all(closePromises),
      new Promise<void>((resolve) => setTimeout(resolve, 1000)), // 1 second timeout
    ]);
  }

  externalMCPSDKClients.clear();
  externalMCPClients.clear();
}
