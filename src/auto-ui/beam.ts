/**
 * Photon Beam - Interactive Control Panel
 *
 * A unified UI to interact with all your photons.
 * Uses MCP Streamable HTTP (POST + SSE) for real-time communication.
 * Version: 2.0.0 (SSE Architecture)
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import { existsSync, lstatSync, realpathSync, watch, type FSWatcher } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { Writable } from 'stream';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// WebSocket removed - now using MCP Streamable HTTP (SSE) only
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
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
// MCP WebSocket handler removed - now using Streamable HTTP only
import { generateMCPClientJS } from './mcp-client.js';
import { handleStreamableHTTP, broadcastNotification, broadcastToBeam } from './streamable-http-transport.js';
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
} from './types.js';
import { getBundledPhotonPath, BEAM_BUNDLED_PHOTONS } from '../shared-utils.js';

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

// Unified config structure
interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  transport?: 'stdio' | 'sse' | 'websocket';
  env?: Record<string, string>;
}

interface PhotonConfig {
  photons: Record<string, Record<string, string>>;
  mcpServers: Record<string, MCPServerConfig>;
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
async function extractClassMetadata(photonPath: string): Promise<{ description?: string; icon?: string; internal?: boolean }> {
  try {
    const content = await fs.readFile(photonPath, 'utf-8');

    // Find class-level JSDoc (the JSDoc immediately before class declaration)
    const classDocRegex = /\/\*\*([\s\S]*?)\*\/\s*\n?(?:export\s+)?(?:default\s+)?class\s+\w+/;
    const match = content.match(classDocRegex);

    if (!match) {
      return {};
    }

    const docContent = match[1];
    const metadata: { description?: string; icon?: string; internal?: boolean } = {};

    // Extract @icon
    const iconMatch = docContent.match(/@icon\s+(\S+)/);
    if (iconMatch) {
      metadata.icon = iconMatch[1];
    }

    // Extract @internal (presence indicates internal photon)
    if (/@internal\b/.test(docContent)) {
      metadata.internal = true;
    }

    // Extract @description or first line of doc (not starting with @)
    const descMatch = docContent.match(/@description\s+([^\n@]+)/);
    if (descMatch) {
      metadata.description = descMatch[1].trim();
    } else {
      // Get first non-empty line that's not a tag
      const lines = docContent.split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'));
      if (lines.length > 0) {
        metadata.description = lines[0];
      }
    }

    return metadata;
  } catch {
    return {};
  }
}

export async function startBeam(workingDir: string, port: number): Promise<void> {
  // Initialize marketplace manager for photon discovery and installation
  const marketplace = new MarketplaceManager();
  await marketplace.initialize();
  // Auto-update stale caches in background
  marketplace.autoUpdateStaleCaches().catch(() => { });

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

  // Use PhotonLoader with silent logger to suppress verbose errors during loading
  // Beam handles errors gracefully by showing config forms, so we don't need loader error logs
  const nullStream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const silentLogger = createLogger({ destination: nullStream });
  const loader = new PhotonLoader(false, silentLogger);

  for (const name of photonList) {
    // Check bundled photons first, then user photons
    const photonPath = bundledPhotonPaths.get(name) || await resolvePhotonPath(name, workingDir);
    if (!photonPath) continue;

    // Apply saved config to environment before loading
    if (savedConfig.photons[name]) {
      for (const [key, value] of Object.entries(savedConfig.photons[name])) {
        process.env[key] = value;
      }
    }

    // PRE-CHECK: Extract constructor params and check if required ones are configured
    const extractor = new SchemaExtractor();
    let constructorParams: ConfigParam[] = [];
    let templatePath: string | undefined;

    try {
      const source = await fs.readFile(photonPath, 'utf-8');
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
      const classJsdocMatch = source.match(/\/\*\*[\s\S]*?\*\/\s*(?=export\s+default\s+class)/);
      if (classJsdocMatch) {
        const uiMatch = classJsdocMatch[0].match(/@ui\s+([^\s*]+)/);
        if (uiMatch) {
          templatePath = uiMatch[1];
        }
      }
    } catch {
      // Can't extract params, try to load anyway
    }

    // Check if any required params are missing from environment
    const missingRequired = constructorParams.filter(
      (p) => !p.isOptional && !p.hasDefault && !process.env[p.envVar]
    );

    // Check for placeholder defaults or localhost URLs (which need local services running)
    const isPlaceholderOrLocalDefault = (value: string): boolean => {
      // Common placeholder patterns
      if (value.includes('<') || value.includes('your-')) return true;
      // Localhost URLs that need local services
      if (value.includes('localhost') || value.includes('127.0.0.1')) return true;
      return false;
    };

    const hasPlaceholderDefaults = constructorParams.some(
      (p) =>
        p.hasDefault &&
        typeof p.defaultValue === 'string' &&
        isPlaceholderOrLocalDefault(p.defaultValue)
    );

    // If required params missing OR has placeholder/localhost defaults without env override, mark as unconfigured
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
      photons.push({
        name,
        path: photonPath,
        configured: false,
        requiredParams: constructorParams,
        errorMessage:
          missingRequired.length > 0
            ? `Missing required: ${missingRequired.map((p) => p.name).join(', ')}`
            : 'Has placeholder values that need configuration',
      });

      continue;
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
        continue;
      }

      photonMCPs.set(name, mcp);

      // Extract schema for UI - use extractAllFromSource to get both tools and templates
      const source = await fs.readFile(photonPath, 'utf-8');
      const { tools: schemas, templates } = extractor.extractAllFromSource(source);
      (mcp as any).schemas = schemas; // Store schemas for result rendering

      // Get UI assets for linking
      const uiAssets = mcp.assets?.ui || [];

      // Filter out lifecycle methods
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => {
          // Find linked UI for this method
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

      // Add templates as methods with isTemplate flag and markdown output format
      templates.forEach((template: any) => {
        if (!lifecycleMethods.includes(template.name)) {
          methods.push({
            name: template.name,
            description: template.description || '',
            params: template.inputSchema || { type: 'object', properties: {}, required: [] },
            returns: { type: 'object' },
            isTemplate: true,
            outputFormat: 'markdown', // Templates return markdown by default
          });
        }
      });

      // Check if this is an App (has main() method with @ui)
      const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

      // Extract class-level metadata (description, icon) from JSDoc
      const classMetadata = await extractClassMetadata(photonPath);

      photons.push({
        name,
        path: photonPath,
        configured: true,
        methods,
        templatePath,
        isApp: !!mainMethod,
        appEntry: mainMethod,
        assets: mcp.assets,
        description: classMetadata.description || mcp.description || `${name} MCP`,
        icon: classMetadata.icon,
        internal: classMetadata.internal,
      });
    } catch (error) {
      // Loading failed - show as unconfigured if we have params, otherwise skip silently
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (constructorParams.length > 0) {
        photons.push({
          name,
          path: photonPath,
          configured: false,
          requiredParams: constructorParams,
          errorMessage: errorMsg.slice(0, 200),
        });
      }
      // Skip photons without constructor params that fail to load
    }
  }

  // Count configured vs unconfigured
  const configuredCount = photons.filter((p) => p.configured).length;
  const unconfiguredCount = photons.filter((p) => !p.configured).length;

  // ══════════════════════════════════════════════════════════════════════════════
  // DYNAMIC SUBSCRIPTION MANAGEMENT (Reference Counting)
  // Channels are subscribed only when clients are viewing them
  // ══════════════════════════════════════════════════════════════════════════════

  interface ChannelSubscription {
    refCount: number;
    unsubscribe: (() => void) | null;
  }

  const channelSubscriptions = new Map<string, ChannelSubscription>();

  // Subscribe to a channel (increment ref count, actually subscribe if first)
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
      // Extract photon name from channel (e.g., "kanban:photon" -> "kanban")
      const photonName = channel.split(':')[0];
      const isRunning = await pingDaemon(photonName);

      if (isRunning) {
        const unsubscribe = await subscribeChannel(photonName, channel, (message: any) => {
          // Forward channel messages as events with delta
          broadcastToBeam('photon/channel-event', {
            photon: photonName,
            channel,
            event: message?.event,
            data: message?.data || message,
          });
        });
        subscription.unsubscribe = unsubscribe;
        logger.info(`📡 Subscribed to ${channel} (ref: 1)`);
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
  const sessionViewState = new Map<string, { photon?: string; board?: string }>();

  // Called when a client starts viewing a board (from MCP notification)
  function onClientViewingBoard(sessionId: string, photon: string, board: string): void {
    const prevState = sessionViewState.get(sessionId);

    // Unsubscribe from previous board if different
    if (prevState?.board && (prevState.photon !== photon || prevState.board !== board)) {
      const prevChannel = `${prevState.photon}:${prevState.board}`;
      unsubscribeFromChannel(prevChannel);
    }

    // Subscribe to new board
    const channel = `${photon}:${board}`;
    sessionViewState.set(sessionId, { photon, board });
    subscribeToChannel(channel);
  }

  // Called when a client disconnects
  function onClientDisconnect(sessionId: string): void {
    const state = sessionViewState.get(sessionId);
    if (state?.photon && state?.board) {
      const channel = `${state.photon}:${state.board}`;
      unsubscribeFromChannel(channel);
    }
    sessionViewState.delete(sessionId);
  }

  const subscriptionManager = {
    onClientViewingBoard,
    onClientDisconnect,
  };

  // UI asset loader for MCP resources/read (shared between WebSocket and HTTP transports)
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
      return null;
    }
  };

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // ══════════════════════════════════════════════════════════════════════════
    // MCP Streamable HTTP Transport (standard MCP clients like Claude Desktop)
    // Endpoint: /mcp (POST for requests, GET for SSE notifications)
    // ══════════════════════════════════════════════════════════════════════════
    if (url.pathname === '/mcp') {
      const handled = await handleStreamableHTTP(req, res, {
        photons, // Pass all photons including unconfigured for configurationSchema
        photonMCPs,
        loadUIAsset,
        configurePhoton: async (photonName: string, config: Record<string, any>) => {
          return configurePhotonViaMCP(photonName, config, photons, photonMCPs, loader, savedConfig);
        },
        reloadPhoton: async (photonName: string) => {
          return reloadPhotonViaMCP(photonName, photons, photonMCPs, loader, savedConfig, broadcastPhotonChange);
        },
        removePhoton: async (photonName: string) => {
          return removePhotonViaMCP(photonName, photons, photonMCPs, savedConfig, broadcastPhotonChange);
        },
        updateMetadata: async (photonName: string, methodName: string | null, metadata: Record<string, any>) => {
          return updateMetadataViaMCP(photonName, methodName, metadata, photons);
        },
        loader, // Pass loader for proper execution context (this.emit() support)
        subscriptionManager, // For on-demand channel subscriptions
        broadcast: (message: object) => {
          const msg = message as { type?: string; photon?: string; board?: string; channel?: string; event?: string; data?: any };

          // Forward channel events (task-moved, task-updated, etc.) with delta
          if (msg.type === 'channel-event') {
            broadcastToBeam('photon/channel-event', {
              photon: msg.photon,
              channel: msg.channel,
              event: msg.event,
              data: msg.data,
            });
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
      const dirPath = url.searchParams.get('path') || workingDir;
      const root = url.searchParams.get('root');

      try {
        const resolved = path.resolve(dirPath);

        // Validate path is within root (if specified)
        if (root) {
          const resolvedRoot = path.resolve(root);
          if (!resolved.startsWith(resolvedRoot)) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Access denied: outside allowed directory' }));
            return;
          }
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
        res.writeHead(200);
        res.end(uiContent);
      } catch {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `UI template not found: ${uiId}` }));
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
      const fullTemplatePath = path.isAbsolute(templateFile)
        ? templateFile
        : path.join(photonDir, templateFile);

      try {
        const templateContent = await fs.readFile(fullTemplatePath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
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

        // Handle photon:call-tool from iframe
        if (msg.type === 'photon:call-tool') {
          const { callId, toolName, args } = msg;
          try {
            const res = await fetch('/api/invoke', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photon: photonName, method: toolName, args: args || {} })
            });
            const data = await res.json();
            iframe.contentWindow.postMessage({
              type: 'photon:call-tool-response',
              callId: callId,
              result: data.error ? undefined : (data.result !== undefined ? data.result : data),
              error: data.error
            }, '*');
          } catch (err) {
            iframe.contentWindow.postMessage({
              type: 'photon:call-tool-response',
              callId: callId,
              error: err.message
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
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
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
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || String(err) }));
        }
      });
      return;
    }

    // Platform Bridge API: Generate platform compatibility script
    if (url.pathname === '/api/platform-bridge') {
      const theme = (url.searchParams.get('theme') || 'dark') as 'light' | 'dark';
      const photonName = url.searchParams.get('photon') || '';
      const methodName = url.searchParams.get('method') || '';

      const { generatePlatformBridgeScript } = await import('./platform-compat.js');
      const script = generatePlatformBridgeScript({
        theme,
        locale: 'en-US',
        displayMode: 'inline',
        photon: photonName,
        method: methodName,
        hostName: 'beam',
        hostVersion: '1.5.0',
      });

      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(script);
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
            const unconfiguredPhoton: UnconfiguredPhotonInfo = {
              name: photonName,
              path: photonPath,
              configured: false,
              requiredParams: constructorParams,
              errorMessage: `Missing required: ${missingRequired.map((p) => p.name).join(', ')}`,
            };
            photons.push(unconfiguredPhoton);
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

          // Check if this is an App (has main() method with @ui)
          const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

          const reloadedPhoton: PhotonInfo = {
            name: photonName,
            path: photonPath,
            configured: true,
            methods,
            isApp: !!mainMethod,
            appEntry: mainMethod,
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

            if (constructorParams.length > 0) {
              const unconfiguredPhoton: UnconfiguredPhotonInfo = {
                name: photonName,
                path: photonPath,
                configured: false,
                requiredParams: constructorParams,
                errorMessage: errorMsg.slice(0, 200),
              };
              photons.push(unconfiguredPhoton);
              broadcastPhotonChange();
              logger.info(`⚙️ ${photonName} added (needs configuration)`);
              return;
            }
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

  // Watch symlinked photon asset folders (symlinks aren't followed by fs.watch)
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
              // Ignore data files - only hot reload for UI assets (html, css, js, etc.)
              // Data files like boards/*.json, data.json should not trigger reload
              if (filename.endsWith('.json') || filename.startsWith('boards/') || filename === 'data.json') {
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

    // Log if bundled photon is in working directory (covered by main watcher)
    if (isInWorkingDir) {
      const assetFolder = path.join(photonDir, photonName);
      if (existsSync(assetFolder)) {
        logger.info(`👀 Watching ${photonName}/ via main watcher`);
      }
      continue;
    }

    // Watch the photon file itself
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

    // Watch the asset folder if it exists
    const assetFolder = path.join(photonDir, photonName);
    try {
      const assetWatcher = watch(assetFolder, { recursive: true }, (eventType, filename) => {
        if (filename) {
          // Ignore data files - only hot reload for UI assets (html, css, js, etc.)
          if (filename.endsWith('.json') || filename.startsWith('boards/') || filename === 'data.json') {
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

  // Bind to 0.0.0.0 for tunnel access
  server.listen(port, '0.0.0.0', () => {
    // Set port for bundled photons (e.g., tunnel) to discover
    process.env.BEAM_PORT = String(port);

    const url = `http://localhost:${port}`;
    const status =
      unconfiguredCount > 0
        ? `${configuredCount} ready, ${unconfiguredCount} need setup`
        : `${configuredCount} photon${configuredCount !== 1 ? 's' : ''} ready`;
    console.log(`\n⚡ Photon Beam → ${url} (${status})\n`);
  });
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
  // Find the unconfigured photon
  const photonIndex = photons.findIndex((p) => p.name === photonName && !p.configured);
  if (photonIndex === -1) {
    return { success: false, error: `Photon not found or already configured: ${photonName}` };
  }

  const unconfiguredPhoton = photons[photonIndex] as UnconfiguredPhotonInfo;

  // Apply config to environment
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = String(value);
  }

  // Save config to file
  savedConfig.photons[photonName] = config;
  await saveConfig(savedConfig);

  // Try to reload the photon
  try {
    const mcp = await loader.loadFile(unconfiguredPhoton.path);
    const instance = mcp.instance;

    if (!instance) {
      throw new Error('Failed to create instance');
    }

    photonMCPs.set(photonName, mcp);

    // Extract schema for UI
    const extractor = new SchemaExtractor();
    const configSource = await fs.readFile(unconfiguredPhoton.path, 'utf-8');
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

    // Check if this is an App
    const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);
    const isApp = !!mainMethod;

    // Replace unconfigured photon with configured one
    const configuredPhoton: PhotonInfo = {
      name: photonName,
      path: unconfiguredPhoton.path,
      configured: true,
      methods,
      isApp,
      appEntry: mainMethod,
      assets: mcp.assets,
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

    // Check if this is an App
    const mainMethod = methods.find((m) => m.name === 'main' && m.linkedUi);

    // Update photon info
    const reloadedPhoton: PhotonInfo = {
      name: photonName,
      path: photonPath,
      configured: true,
      methods,
      isApp: !!mainMethod,
      appEntry: mainMethod,
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

