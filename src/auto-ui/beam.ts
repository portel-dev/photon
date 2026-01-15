/**
 * Photon Beam - Interactive Control Panel
 *
 * A unified UI to interact with all your photons.
 * Uses WebSocket for real-time bidirectional communication.
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Writable } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { listPhotonMCPs, resolvePhotonPath, DEFAULT_PHOTON_DIR } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
import {
  SchemaExtractor,
  type PhotonYield,
  type OutputHandler,
  type InputProvider,
  type AskYield,
  type ConstructorParam,
  generateSmartRenderingJS,
  generateSmartRenderingCSS
} from '@portel/photon-core';

interface PhotonInfo {
  name: string;
  path: string;
  configured: true;
  methods: MethodInfo[];
}

interface UnconfiguredPhotonInfo {
  name: string;
  path: string;
  configured: false;
  requiredParams: ConfigParam[];
  errorMessage: string;
}

interface ConfigParam {
  name: string;
  envVar: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

type AnyPhotonInfo = PhotonInfo | UnconfiguredPhotonInfo;

interface MethodInfo {
  name: string;
  description: string;
  icon?: string;  // Icon from @icon tag
  params: any;
  returns: any;
  autorun?: boolean;  // Auto-execute when selected (for idempotent methods)
  outputFormat?: string;  // Format hint for rendering (mermaid, markdown, json, etc.)
  layoutHints?: Record<string, string>;  // Layout hints from @format list {@title name, @subtitle email}
  buttonLabel?: string;  // Custom button label from @returns {@label}
  linkedUi?: string;  // UI template ID if linked via @ui annotation
}

interface InvokeRequest {
  type: 'invoke';
  photon: string;
  method: string;
  args: Record<string, any>;
  invocationId?: string;  // For interactive UI invocations that need response routing
}

interface ConfigureRequest {
  type: 'configure';
  photon: string;
  config: Record<string, string>;
}

interface ElicitationResponse {
  type: 'elicitation_response';
  value: any;
}

interface ReloadRequest {
  type: 'reload';
  photon: string;
}

interface RemoveRequest {
  type: 'remove';
  photon: string;
}

interface OAuthCompleteMessage {
  type: 'oauth_complete';
  elicitationId: string;
  success: boolean;
}

type ClientMessage = InvokeRequest | ConfigureRequest | ElicitationResponse | ReloadRequest | RemoveRequest | OAuthCompleteMessage;

// Config file path
const CONFIG_FILE = path.join(os.homedir(), '.photon', 'config.json');

async function loadConfig(): Promise<Record<string, Record<string, string>>> {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config: Record<string, Record<string, string>>): Promise<void> {
  const dir = path.dirname(CONFIG_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function startBeam(workingDir: string, port: number): Promise<void> {
  // Initialize marketplace manager for photon discovery and installation
  const marketplace = new MarketplaceManager();
  await marketplace.initialize();
  // Auto-update stale caches in background
  marketplace.autoUpdateStaleCaches().catch(() => {});

  // Discover all photons
  const photonList = await listPhotonMCPs(workingDir);

  if (photonList.length === 0) {
    logger.info('No photons found - showing management UI');
  }

  // Load saved config and apply to env
  const savedConfig = await loadConfig();

  // Extract metadata for all photons
  const photons: AnyPhotonInfo[] = [];
  const photonMCPs = new Map<string, any>();  // Store full MCP objects

  // Use PhotonLoader with silent logger to suppress verbose errors during loading
  // Beam handles errors gracefully by showing config forms, so we don't need loader error logs
  const nullStream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const silentLogger = createLogger({ destination: nullStream });
  const loader = new PhotonLoader(false, silentLogger);

  for (const name of photonList) {
    const photonPath = await resolvePhotonPath(name, workingDir);
    if (!photonPath) continue;

    // Apply saved config to environment before loading
    if (savedConfig[name]) {
      for (const [key, value] of Object.entries(savedConfig[name])) {
        process.env[key] = value;
      }
    }

    // PRE-CHECK: Extract constructor params and check if required ones are configured
    const extractor = new SchemaExtractor();
    let constructorParams: ConfigParam[] = [];

    try {
      const source = await fs.readFile(photonPath, 'utf-8');
      const params = extractor.extractConstructorParams(source);

      constructorParams = params
        .filter(p => p.isPrimitive)
        .map(p => ({
          name: p.name,
          envVar: toEnvVarName(name, p.name),
          type: p.type,
          isOptional: p.isOptional,
          hasDefault: p.hasDefault,
          defaultValue: p.defaultValue
        }));
    } catch {
      // Can't extract params, try to load anyway
    }

    // Check if any required params are missing from environment
    const missingRequired = constructorParams.filter(p =>
      !p.isOptional && !p.hasDefault && !process.env[p.envVar]
    );

    // Check for placeholder defaults or localhost URLs (which need local services running)
    const isPlaceholderOrLocalDefault = (value: string): boolean => {
      // Common placeholder patterns
      if (value.includes('<') || value.includes('your-')) return true;
      // Localhost URLs that need local services
      if (value.includes('localhost') || value.includes('127.0.0.1')) return true;
      return false;
    };

    const hasPlaceholderDefaults = constructorParams.some(p =>
      p.hasDefault &&
      typeof p.defaultValue === 'string' &&
      isPlaceholderOrLocalDefault(p.defaultValue)
    );

    // If required params missing OR has placeholder/localhost defaults without env override, mark as unconfigured
    const needsConfig = missingRequired.length > 0 ||
      (hasPlaceholderDefaults && constructorParams.some(p =>
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
        errorMessage: missingRequired.length > 0
          ? `Missing required: ${missingRequired.map(p => p.name).join(', ')}`
          : 'Has placeholder values that need configuration'
      });

      continue;
    }

    // All params satisfied, try to load with timeout
    try {
      const loadPromise = loader.loadFile(photonPath);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Loading timeout (10s)')), 10000)
      );

      const mcp = await Promise.race([loadPromise, timeoutPromise]) as any;
      const instance = mcp.instance;

      if (!instance) {
        continue;
      }

      photonMCPs.set(name, mcp);

      // Extract schema for UI
      const schemas = await extractor.extractFromFile(photonPath);
      (mcp as any).schemas = schemas;  // Store schemas for result rendering

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
            linkedUi: linkedAsset?.id
          };
        });

      photons.push({
        name,
        path: photonPath,
        configured: true,
        methods
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
          errorMessage: errorMsg.slice(0, 200)
        });
      }
      // Skip photons without constructor params that fail to load
    }
  }

  // Count configured vs unconfigured
  const configuredCount = photons.filter(p => p.configured).length;
  const unconfiguredCount = photons.filter(p => !p.configured).length;

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateBeamHTML(photons, port));
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
          .filter(e => !e.name.startsWith('.') || e.name === '.photon')
          .map(e => ({
            name: e.name,
            path: path.join(resolved, e.name),
            isDirectory: e.isDirectory()
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        res.writeHead(200);
        res.end(JSON.stringify({
          path: resolved,
          parent: path.dirname(resolved),
          root: root ? path.resolve(root) : null,
          items
        }));
      } catch (error) {
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
        res.end(JSON.stringify({
          defaultWorkdir: workingDir
        }));
        return;
      }

      const photon = photons.find(p => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Photon not found' }));
        return;
      }

      // Known photons with workdir constraints
      // The filesystem photon defaults to ~/.photon
      let photonWorkdir: string | null = null;
      if (photonName === 'filesystem') {
        photonWorkdir = process.env.FILESYSTEM_WORKDIR || path.join(os.homedir(), '.photon');
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        name: photonName,
        workdir: photonWorkdir,
        defaultWorkdir: workingDir
      }));
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

      const photon = photons.find(p => p.name === photonName);
      if (!photon) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Photon not found' }));
        return;
      }

      // UI templates are in <photon-dir>/<photon-name>/ui/<id>.html
      const photonDir = path.dirname(photon.path);
      const uiPath = path.join(photonDir, photonName, 'ui', `${uiId}.html`);

      try {
        const uiContent = await fs.readFile(uiPath, 'utf-8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(uiContent);
      } catch (err) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `UI template not found: ${uiId}` }));
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
      } catch (err) {
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
          });
        }

        res.writeHead(200);
        res.end(JSON.stringify({ photons: photonList }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to list photons' }));
      }
      return;
    }

    // Marketplace API: Add/install a photon
    if (url.pathname === '/api/marketplace/add' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('data', chunk => { body += chunk; });
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
          res.end(JSON.stringify({
            success: true,
            name,
            path: targetPath,
            version: result.metadata?.version,
          }));

          // Broadcast to connected clients to reload photon list
          broadcast({ type: 'photon_added', name });
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to add photon' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  // Track connected clients for broadcasting
  const clients = new Set<WebSocket>();

  // Broadcast to all connected clients
  const broadcast = (message: object) => {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    // Send photon list on connection
    ws.send(JSON.stringify({
      type: 'photons',
      data: photons
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        if (message.type === 'invoke') {
          await handleInvoke(ws, message, photonMCPs, loader);
        } else if (message.type === 'configure') {
          await handleConfigure(ws, message, photons, photonMCPs, loader, savedConfig);
        } else if (message.type === 'elicitation_response') {
          // Store response for pending elicitation
          if ((ws as any).pendingElicitation) {
            (ws as any).pendingElicitation.resolve(message.value);
            (ws as any).pendingElicitation = null;
          }
        } else if (message.type === 'reload') {
          await handleReload(ws, message, photons, photonMCPs, loader, savedConfig);
        } else if (message.type === 'remove') {
          await handleRemove(ws, message, photons, photonMCPs, savedConfig);
        } else if (message.type === 'oauth_complete') {
          // OAuth flow completed - client will retry the tool call
          logger.info(`OAuth completed: ${message.elicitationId} (success: ${message.success})`);
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

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
      const photon = photons.find(p => p.name === folderName);
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
    pendingReloads.set(photonName, setTimeout(async () => {
      pendingReloads.delete(photonName);

      const photonIndex = photons.findIndex(p => p.name === photonName);
      const isNewPhoton = photonIndex === -1;
      const photonPath = isNewPhoton
        ? path.join(workingDir, `${photonName}.photon.ts`)
        : photons[photonIndex].path;

      logger.info(isNewPhoton
        ? `✨ New photon detected: ${photonName}`
        : `🔄 File change detected, reloading ${photonName}...`);

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
              defaultValue: p.defaultValue
            }));
        } catch {
          // Can't extract params, try to load anyway
        }

        // Check if any required params are missing
        const missingRequired = constructorParams.filter(p =>
          !p.isOptional && !p.hasDefault && !process.env[p.envVar]
        );

        if (missingRequired.length > 0 && constructorParams.length > 0) {
          // Add as unconfigured photon
          const unconfiguredPhoton: UnconfiguredPhotonInfo = {
            name: photonName,
            path: photonPath,
            configured: false,
            requiredParams: constructorParams,
            errorMessage: `Missing required: ${missingRequired.map(p => p.name).join(', ')}`
          };
          photons.push(unconfiguredPhoton);
          broadcast({ type: 'photons', data: photons });
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

        // Re-extract schema
        const extractor = new SchemaExtractor();
        const schemas = await extractor.extractFromFile(photonPath);
        (mcp as any).schemas = schemas;  // Store schemas for result rendering

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
              linkedUi: linkedAsset?.id
            };
          });

        const reloadedPhoton: PhotonInfo = {
          name: photonName,
          path: photonPath,
          configured: true,
          methods
        };

        if (isNewPhoton) {
          photons.push(reloadedPhoton);
          broadcast({ type: 'photons', data: photons });
          logger.info(`✅ ${photonName} added`);
        } else {
          photons[photonIndex] = reloadedPhoton;
          broadcast({ type: 'hot-reload', photon: reloadedPhoton });
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
                defaultValue: p.defaultValue
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
              errorMessage: errorMsg.slice(0, 200)
            };
            photons.push(unconfiguredPhoton);
            broadcast({ type: 'photons', data: photons });
            logger.info(`⚙️ ${photonName} added (needs configuration)`);
            return;
          }
        }

        logger.error(`Hot reload failed for ${photonName}: ${errorMsg}`);
        broadcast({
          type: 'hot-reload-error',
          photon: photonName,
          message: errorMsg.slice(0, 200)
        });
      }
    }, 100));
  };

  // Watch working directory recursively
  try {
    const watcher = watch(workingDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const fullPath = path.join(workingDir, filename);
      const photonName = getPhotonForPath(fullPath);
      if (photonName) {
        handleFileChange(photonName);
      }
    });
    watchers.push(watcher);
    logger.info(`👀 Watching for changes in ${workingDir}`);
  } catch (error) {
    logger.warn(`File watching not available: ${error}`);
  }

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    const status = unconfiguredCount > 0
      ? `${configuredCount} ready, ${unconfiguredCount} need setup`
      : `${configuredCount} photon${configuredCount !== 1 ? 's' : ''} ready`;
    console.log(`\n⚡ Photon Beam → ${url} (${status})\n`);
  });
}

async function handleInvoke(
  ws: WebSocket,
  request: InvokeRequest,
  photonMCPs: Map<string, any>,
  loader: PhotonLoader
): Promise<void> {
  const { photon, method, args, invocationId } = request;

  const mcp = photonMCPs.get(photon);
  if (!mcp || !mcp.instance) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Photon not found: ${photon}`
    }));
    return;
  }

  const instance = mcp.instance;
  if (typeof instance[method] !== 'function') {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Method not found: ${method}`
    }));
    return;
  }

  try {
    // Create output handler for streaming progress/status events
    const outputHandler: OutputHandler = (yieldValue: PhotonYield) => {
      ws.send(JSON.stringify({
        type: 'yield',
        data: yieldValue
      }));
    };

    // Create input provider for web-based elicitation (ask yields)
    const inputProvider: InputProvider = async (ask: AskYield): Promise<any> => {
      // Send elicitation request to web client
      ws.send(JSON.stringify({
        type: 'elicitation',
        data: ask
      }));

      // Wait for response from client
      return new Promise((resolve) => {
        (ws as any).pendingElicitation = { resolve };
      });
    };

    // Use loader.executeTool which properly sets up execution context for this.emit()
    // and handles PhotonMCP vs plain class methods
    const result = await loader.executeTool(mcp, method, args, { outputHandler, inputProvider });

    // Find the method's format settings from schema
    const schemas = mcp.schemas || [];
    const methodSchema = schemas.find((s: any) => s.name === method);

    ws.send(JSON.stringify({
      type: 'result',
      data: result,
      photon,
      method,
      outputFormat: methodSchema?.outputFormat,
      layoutHints: methodSchema?.layoutHints,
      invocationId  // Pass back for interactive UI routing
    }));
  } catch (error) {
    // Check if this is an OAuth elicitation error
    if (error instanceof Error && (
      error.name === 'OAuthElicitationRequired' ||
      (error as any).code === 'OAUTH_ELICITATION_REQUIRED'
    )) {
      const oauthError = error as any;
      ws.send(JSON.stringify({
        type: 'elicitation',
        data: {
          ask: 'oauth',
          provider: oauthError.provider || 'OAuth',
          scopes: oauthError.scopes || [],
          url: oauthError.elicitationUrl || oauthError.url,
          elicitationUrl: oauthError.elicitationUrl || oauthError.url,
          elicitationId: oauthError.elicitationId || oauthError.id,
          message: oauthError.message || 'Authorization required',
          // Include context for retry
          photon,
          method,
          params: args
        }
      }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
}

async function handleConfigure(
  ws: WebSocket,
  request: ConfigureRequest,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: Record<string, Record<string, string>>
): Promise<void> {
  const { photon: photonName, config } = request;

  // Find the unconfigured photon
  const photonIndex = photons.findIndex(p => p.name === photonName && !p.configured);
  if (photonIndex === -1) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Photon not found or already configured: ${photonName}`
    }));
    return;
  }

  const unconfiguredPhoton = photons[photonIndex] as UnconfiguredPhotonInfo;

  // Apply config to environment
  for (const [key, value] of Object.entries(config)) {
    process.env[key] = value;
  }

  // Save config to file
  savedConfig[photonName] = config;
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
    const schemas = await extractor.extractFromFile(unconfiguredPhoton.path);
    (mcp as any).schemas = schemas;  // Store schemas for result rendering

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => ({
        name: schema.name,
        description: schema.description || '',
        params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        autorun: schema.autorun || false,
        buttonLabel: schema.buttonLabel
      }));

    // Replace unconfigured photon with configured one
    const configuredPhoton: PhotonInfo = {
      name: photonName,
      path: unconfiguredPhoton.path,
      configured: true,
      methods
    };

    photons[photonIndex] = configuredPhoton;

    logger.info(`✅ ${photonName} configured successfully`);

    // Send updated photon info to client
    ws.send(JSON.stringify({
      type: 'configured',
      photon: configuredPhoton
    }));

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to configure ${photonName}: ${errorMsg}`);

    ws.send(JSON.stringify({
      type: 'error',
      message: `Configuration failed: ${errorMsg.slice(0, 200)}`
    }));
  }
}

async function handleReload(
  ws: WebSocket,
  request: ReloadRequest,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  loader: PhotonLoader,
  savedConfig: Record<string, Record<string, string>>
): Promise<void> {
  const { photon: photonName } = request;

  // Find the photon
  const photonIndex = photons.findIndex(p => p.name === photonName);
  if (photonIndex === -1) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Photon not found: ${photonName}`
    }));
    return;
  }

  const photon = photons[photonIndex];
  const photonPath = photon.path;

  // Get saved config for this photon
  const config = savedConfig[photonName] || {};

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
    const schemas = await extractor.extractFromFile(photonPath);
    (mcp as any).schemas = schemas;  // Store schemas for result rendering

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => ({
        name: schema.name,
        description: schema.description || '',
        params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        autorun: schema.autorun || false,
        buttonLabel: schema.buttonLabel
      }));

    // Update photon info
    const reloadedPhoton: PhotonInfo = {
      name: photonName,
      path: photonPath,
      configured: true,
      methods
    };

    photons[photonIndex] = reloadedPhoton;

    logger.info(`🔄 ${photonName} reloaded successfully`);

    ws.send(JSON.stringify({
      type: 'reloaded',
      photon: reloadedPhoton
    }));

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to reload ${photonName}: ${errorMsg}`);

    ws.send(JSON.stringify({
      type: 'error',
      message: `Reload failed: ${errorMsg.slice(0, 200)}`
    }));
  }
}

async function handleRemove(
  ws: WebSocket,
  request: RemoveRequest,
  photons: AnyPhotonInfo[],
  photonMCPs: Map<string, any>,
  savedConfig: Record<string, Record<string, string>>
): Promise<void> {
  const { photon: photonName } = request;

  // Find and remove the photon
  const photonIndex = photons.findIndex(p => p.name === photonName);
  if (photonIndex === -1) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Photon not found: ${photonName}`
    }));
    return;
  }

  // Remove from arrays/maps
  photons.splice(photonIndex, 1);
  photonMCPs.delete(photonName);

  // Remove from saved config
  delete savedConfig[photonName];
  await saveConfig(savedConfig);

  logger.info(`🗑️ ${photonName} removed`);

  ws.send(JSON.stringify({
    type: 'removed',
    photon: photonName,
    photons: photons
  }));
}

function generateBeamHTML(photons: AnyPhotonInfo[], port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#0f0f0f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Photon Beam</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      color-scheme: dark;
      --bg-primary: #0f0f0f;
      --bg-secondary: #161616;
      --bg-tertiary: #1c1c1c;
      --bg-elevated: #222222;
      --border-color: #2a2a2a;
      --border-light: #333;
      --text-primary: #f5f5f5;
      --text-secondary: #a0a0a0;
      --text-muted: #666;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --accent-light: #60a5fa;
      --success: #22c55e;
      --error: #ef4444;
      --warning: #f59e0b;
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
      --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
      --transition: 0.15s ease;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* JSON Syntax Highlighting */
    .json-key { color: #9cdcfe; }
    .json-string { color: #ce9178; }
    .json-number { color: #b5cea8; }
    .json-boolean { color: #569cd6; }
    .json-null { color: #808080; }

    .app {
      display: flex;
      height: 100%;
      position: relative;
    }

    /* Mobile menu button */
    .mobile-menu-btn {
      display: none;
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 1001;
      width: 44px;
      height: 44px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      cursor: pointer;
      align-items: center;
      justify-content: center;
      transition: var(--transition);
    }

    .mobile-menu-btn:hover {
      background: var(--bg-tertiary);
    }

    .mobile-menu-btn svg {
      width: 20px;
      height: 20px;
      stroke: var(--text-primary);
      stroke-width: 2;
    }

    /* Sidebar */
    .sidebar {
      width: 300px;
      min-width: 300px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      height: 100%;
      transition: transform 0.3s ease;
    }

    .sidebar-header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .logo h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .sidebar-header .subtitle {
      font-size: 13px;
      color: var(--text-muted);
    }

    .search-box {
      padding: 0 16px 16px;
    }

    .search-input {
      width: 100%;
      padding: 10px 14px;
      padding-left: 38px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: var(--transition);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: 12px center;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      background-color: var(--bg-elevated);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    .photon-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border-color);
    }

    .marketplace-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border: 1px dashed var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: var(--transition);
    }

    .marketplace-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
      border-color: var(--accent);
    }

    .marketplace-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
    }

    .marketplace-item:hover {
      border-color: var(--accent);
    }

    .marketplace-item-info {
      flex: 1;
    }

    .marketplace-item-name {
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }

    .marketplace-item-desc {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .marketplace-item-meta {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .marketplace-item-tags {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .marketplace-tag {
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border-radius: 12px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .marketplace-item-action {
      margin-left: 16px;
    }

    .btn-install {
      padding: 8px 16px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: var(--transition);
    }

    .btn-install:hover {
      opacity: 0.9;
    }

    .btn-install:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-install.installed {
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }

    .photon-item {
      margin-bottom: 4px;
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .photon-header {
      padding: 12px 16px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: transparent;
      border-radius: var(--radius-md);
      user-select: none;
      transition: var(--transition);
    }

    .photon-header:hover {
      background: var(--bg-tertiary);
    }

    .photon-header.expanded {
      background: var(--bg-tertiary);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    .photon-name {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .photon-name::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
    }

    .method-count {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--bg-elevated);
      padding: 3px 10px;
      border-radius: 20px;
      font-weight: 500;
    }

    .method-list {
      display: none;
      background: var(--bg-tertiary);
      border-radius: 0 0 var(--radius-md) var(--radius-md);
      padding: 4px 0;
    }

    .method-list.expanded {
      display: block;
    }

    .method-item {
      padding: 10px 16px 10px 36px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
      transition: var(--transition);
      border-radius: var(--radius-sm);
      margin: 2px 4px;
    }

    .method-item:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .method-item.selected {
      background: var(--accent);
      color: white;
    }

    .method-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .method-item.highlighted {
      background: var(--bg-elevated);
      color: var(--text-primary);
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    kbd {
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 2px 6px;
      font-family: inherit;
      font-size: 12px;
      color: var(--text-primary);
      box-shadow: 0 1px 0 var(--border-color);
    }

    /* Special sections (Favorites, Recent) */
    .special-section {
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      letter-spacing: 0.5px;
    }

    .section-header svg {
      opacity: 0.7;
    }

    .method-photon-prefix {
      color: var(--text-muted);
      font-size: 11px;
    }

    .favorite-btn {
      margin-left: auto;
      padding: 4px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      opacity: 0;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .method-item:hover .favorite-btn {
      opacity: 0.6;
    }

    .favorite-btn:hover {
      opacity: 1 !important;
      color: var(--warning);
    }

    .favorite-btn.favorited {
      opacity: 1;
      color: var(--warning);
    }

    .method-item.selected .favorite-btn {
      color: white;
      opacity: 0.7;
    }

    .method-item.selected .favorite-btn:hover,
    .method-item.selected .favorite-btn.favorited {
      opacity: 1;
    }

    /* Unconfigured photon styles */
    .photon-item.unconfigured .photon-name::before {
      background: var(--warning);
    }

    .photon-item.unconfigured .photon-header {
      opacity: 0.7;
    }

    .photon-item.unconfigured .photon-header:hover {
      opacity: 1;
    }

    .setup-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--warning);
      color: #000;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .photon-item.unconfigured .photon-header.selected {
      background: var(--bg-tertiary);
      opacity: 1;
    }

    /* Config view in main content */
    .config-header {
      position: relative;
    }

    .config-header .config-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .config-form-container {
      padding: 24px 32px;
      max-width: 600px;
    }

    .config-form-container .form-group {
      margin-bottom: 20px;
    }

    .config-form-container .form-group label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .config-form-container .form-group label .hint {
      display: block;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 400;
      margin-top: 4px;
    }

    .config-form-container input {
      width: 100%;
      padding: 12px 14px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 14px;
      font-family: 'JetBrains Mono', monospace;
      transition: var(--transition);
    }

    .config-form-container input:focus {
      outline: none;
      border-color: var(--warning);
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
    }

    .config-form-container input::placeholder {
      color: var(--text-muted);
    }

    .toggle-switch {
      display: inline-flex;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .toggle-btn {
      padding: 10px 20px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: var(--transition);
    }

    .toggle-btn:hover {
      color: var(--text-primary);
    }

    .toggle-btn.active {
      background: var(--primary);
      color: white;
    }

    .toggle-btn:first-child {
      border-right: 1px solid var(--border-color);
    }

    .btn-configure {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      background: var(--warning);
      color: #000;
      font-weight: 600;
      border-radius: var(--radius-md);
      cursor: pointer;
      border: none;
      font-size: 14px;
      transition: var(--transition);
    }

    .btn-configure:hover {
      background: #d97706;
      transform: translateY(-1px);
    }

    .btn-configure svg {
      stroke: currentColor;
    }

    /* Config JSON editor */
    .config-json-container {
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100%;
    }

    .config-json-container textarea {
      flex: 1;
      min-height: 300px;
      padding: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.6;
      resize: none;
      transition: var(--transition);
    }

    .config-json-container textarea:focus {
      outline: none;
      border-color: var(--warning);
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
    }

    .config-json-container .btn-configure {
      align-self: flex-start;
    }

    /* Main content */
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .method-header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .method-header h2 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 6px;
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: -0.5px;
    }

    .method-header p {
      color: var(--text-secondary);
      font-size: 14px;
    }

    .method-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .photon-settings {
      position: relative;
    }

    .settings-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-muted);
      cursor: pointer;
      transition: var(--transition);
    }

    .settings-btn:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-color: var(--text-muted);
    }

    .settings-menu {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 8px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      min-width: 180px;
      z-index: 100;
      overflow: hidden;
    }

    .settings-menu.visible {
      display: block;
    }

    .settings-menu button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 12px 16px;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 14px;
      cursor: pointer;
      transition: var(--transition);
      text-align: left;
    }

    .settings-menu button:hover {
      background: var(--bg-secondary);
    }

    .settings-menu button.danger {
      color: var(--error);
    }

    .settings-menu button.danger:hover {
      background: rgba(239, 68, 68, 0.1);
    }

    .settings-divider {
      height: 1px;
      background: var(--border-color);
      margin: 4px 0;
    }

    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
      padding: 0 32px;
    }

    .tab {
      padding: 14px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 500;
      transition: var(--transition);
      margin-bottom: -1px;
    }

    .tab:hover {
      color: var(--text-primary);
    }

    .tab.active {
      color: var(--accent-light);
      border-bottom-color: var(--accent);
    }

    .tab-content {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
    }

    .tab-panel {
      display: none;
      max-width: 700px;
    }

    .tab-panel.active {
      display: block;
    }

    /* Form styles */
    .form-group {
      margin-bottom: 24px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .form-group label .required {
      color: var(--error);
      margin-left: 4px;
    }

    .form-group label .hint {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 13px;
      display: block;
      margin-top: 2px;
    }

    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: var(--transition);
    }

    .form-group select {
      appearance: none;
      padding-right: 40px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      cursor: pointer;
    }

    .form-group input:focus,
    .form-group textarea:focus,
    .form-group select:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    /* Override browser autofill styling */
    .form-group input:-webkit-autofill,
    .form-group input:-webkit-autofill:hover,
    .form-group input:-webkit-autofill:focus {
      -webkit-text-fill-color: var(--text-primary);
      -webkit-box-shadow: 0 0 0 1000px var(--bg-secondary) inset;
      transition: background-color 5000s ease-in-out 0s;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 100px;
    }

    .form-group .json-input {
      min-height: 120px;
      white-space: pre;
    }

    .form-group .json-schema-preview {
      margin-bottom: 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }

    .form-group .json-schema-label {
      font-size: 11px;
      color: var(--text-muted);
      padding: 6px 10px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .form-group .json-schema-sample {
      margin: 0;
      padding: 10px;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-secondary);
      overflow-x: auto;
      white-space: pre;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      transition: var(--transition);
      box-shadow: var(--shadow-sm);
    }

    .btn:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn:disabled {
      background: var(--bg-elevated);
      color: var(--text-muted);
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .btn-success {
      background: var(--success);
    }

    .btn-success:hover {
      background: #16a34a;
    }

    .btn-danger {
      background: var(--error);
    }

    .btn-danger:hover {
      background: #dc2626;
    }

    /* Progress overlay */
    .progress-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    .progress-overlay.visible {
      display: flex;
    }

    .progress-card {
      background: var(--bg-elevated);
      padding: 32px 40px;
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      min-width: 320px;
      max-width: 90%;
      text-align: center;
    }

    .progress-spinner {
      width: 48px;
      height: 48px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-message {
      font-size: 15px;
      color: var(--text-primary);
      margin-bottom: 16px;
    }

    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), #8b5cf6);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .progress-percent {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
    }

    /* Toast notifications */
    #toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .toast {
      background: var(--bg-elevated);
      color: var(--text-primary);
      padding: 12px 20px;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      font-size: 14px;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
      border-left: 3px solid var(--accent);
    }

    .toast.visible {
      opacity: 1;
      transform: translateX(0);
    }

    .toast-success {
      border-left-color: #10b981;
    }

    .toast-error {
      border-left-color: #ef4444;
    }

    .toast-info {
      border-left-color: var(--accent);
    }

    .toast-warning {
      border-left-color: #f59e0b;
    }

    /* File browser */
    .path-input-wrapper {
      display: flex;
      gap: 8px;
    }

    .path-input-wrapper input {
      flex: 1;
    }

    .browse-btn {
      padding: 10px 16px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
    }

    .browse-btn:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .file-browser-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 150;
      justify-content: center;
      align-items: center;
    }

    .file-browser-overlay.visible {
      display: flex;
    }

    .file-browser {
      background: var(--bg-elevated);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }

    .file-browser-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .file-browser-header h3 {
      margin: 0;
      font-size: 16px;
      color: var(--text-primary);
    }

    .file-browser-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 20px;
    }

    .file-browser-path {
      padding: 12px 20px;
      background: var(--bg-tertiary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-browser-path button {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .file-browser-path button:hover {
      color: var(--text-primary);
    }

    .file-browser-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .file-browser-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      cursor: pointer;
      color: var(--text-primary);
    }

    .file-browser-item:hover {
      background: var(--bg-secondary);
    }

    .file-browser-item.selected {
      background: var(--accent);
      color: white;
    }

    .file-browser-item.directory {
      color: var(--accent);
    }

    .file-browser-item.directory.selected {
      color: white;
    }

    .file-browser-item .icon {
      width: 18px;
      text-align: center;
      opacity: 0.7;
    }

    .file-browser-item .name {
      flex: 1;
      font-size: 14px;
    }

    .file-browser-footer {
      padding: 12px 20px;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .file-browser-footer button {
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 13px;
      cursor: pointer;
    }

    .file-browser-footer .cancel-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .file-browser-footer .select-btn {
      background: var(--accent);
      border: none;
      color: white;
    }

    .file-browser-footer .select-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Activity Panel */
    .activity-panel {
      position: fixed;
      bottom: 0;
      right: 0;
      width: calc(100% - 280px);
      max-height: 300px;
      background: var(--bg-elevated);
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      z-index: 50;
      transform: translateY(calc(100% - 36px));
      transition: transform 0.2s ease;
    }

    .activity-panel.expanded {
      transform: translateY(0);
    }

    .activity-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
      user-select: none;
    }

    .activity-header:hover {
      background: var(--bg-secondary);
    }

    .activity-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .activity-badge {
      background: var(--accent);
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
    }

    .activity-toggle {
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    .activity-panel.expanded .activity-toggle {
      transform: rotate(180deg);
    }

    .activity-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }

    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 6px 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-time {
      color: var(--text-muted);
      flex-shrink: 0;
      font-size: 11px;
    }

    .activity-icon {
      flex-shrink: 0;
      width: 16px;
      text-align: center;
    }

    .activity-content {
      flex: 1;
      min-width: 0;
    }

    .activity-type {
      font-weight: 600;
      margin-right: 8px;
    }

    .activity-type.invoke { color: var(--accent); }
    .activity-type.result { color: #10b981; }
    .activity-type.error { color: #ef4444; }
    .activity-type.reload { color: #f59e0b; }
    .activity-type.config { color: #8b5cf6; }
    .activity-type.status { color: var(--text-secondary); }

    .activity-message {
      color: var(--text-secondary);
      word-break: break-word;
    }

    .activity-clear {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      padding: 4px 8px;
    }

    .activity-clear:hover {
      color: var(--text-secondary);
    }

    @media (max-width: 768px) {
      .activity-panel {
        width: 100%;
      }
    }

    /* Mermaid diagram */
    .mermaid-container {
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      padding: 20px;
      overflow: auto;
    }

    .mermaid-diagram {
      display: flex;
      justify-content: center;
      min-height: 200px;
    }

    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }

    .mermaid-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
    }

    .mermaid-actions button {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
    }

    .mermaid-actions button:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    /* Result container */
    .result-container {
      margin-top: 32px;
      display: none;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(100px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes slideOut {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(100px); }
    }

    .result-container.visible {
      display: block;
    }

    .result-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .result-filter-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .result-filter-wrapper svg {
      position: absolute;
      left: 8px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .result-filter-input {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 4px 8px 4px 28px;
      font-size: 12px;
      color: var(--text-primary);
      width: 120px;
      transition: all 0.15s ease;
    }

    .result-filter-input:focus {
      outline: none;
      border-color: var(--accent);
      width: 180px;
    }

    .result-filter-input::placeholder {
      color: var(--text-muted);
    }

    .result-filter-count {
      padding: 4px 12px;
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-top: none;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    }

    /* Highlight matches in result */
    .filter-highlight {
      background: rgba(var(--accent-rgb), 0.3);
      border-radius: 2px;
      padding: 0 2px;
    }

    .filter-hidden {
      display: none !important;
    }

    .result-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .result-expand-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: var(--transition);
    }

    .result-expand-btn:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .result-content {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 24px;
      font-size: 14px;
      line-height: 1.7;
    }

    .result-list {
      list-style: none;
    }

    .result-list li {
      padding: 16px;
      margin-bottom: 12px;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      border-left: 3px solid var(--accent);
    }

    .result-list li:last-child {
      margin-bottom: 0;
    }

    .kv-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }

    .kv-table tr {
      border-bottom: 1px solid var(--border-color);
    }

    .kv-table tr:last-child {
      border-bottom: none;
    }

    .kv-table td {
      padding: 10px 12px;
    }

    .kv-key {
      color: var(--text-secondary);
      font-weight: 500;
      width: 40%;
    }

    .kv-value {
      color: var(--text-primary);
    }

    .kv-value.value-true {
      color: var(--success);
    }

    .kv-value.value-false {
      color: var(--text-tertiary);
    }

    .kv-value.value-null {
      color: var(--text-tertiary);
      font-style: italic;
    }

    .kv-value.value-number {
      color: var(--accent-light);
    }

    .kv-value.value-object {
      font-size: 12px;
      color: var(--text-tertiary);
    }

    .grid-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }

    .grid-table th {
      text-align: left;
      padding: 10px 12px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      font-weight: 600;
      border-bottom: 2px solid var(--border-color);
    }

    .grid-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
    }

    .grid-table tr:last-child td {
      border-bottom: none;
    }

    .grid-table tr:hover td {
      background: var(--bg-tertiary);
    }

    .result-content a {
      color: var(--accent-light);
      text-decoration: none;
      font-weight: 500;
    }

    .result-content a:hover {
      text-decoration: underline;
    }

    .result-content h1, .result-content h2, .result-content h3 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
    }

    .result-content h1:first-child,
    .result-content h2:first-child,
    .result-content h3:first-child {
      margin-top: 0;
    }

    .result-content p {
      margin-bottom: 1em;
    }

    .result-content blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 16px;
      margin: 1em 0;
      color: var(--text-secondary);
    }

    .result-content code {
      background: var(--bg-tertiary);
      padding: 3px 8px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9em;
    }

    .result-content pre {
      background: var(--bg-tertiary);
      padding: 16px;
      border-radius: var(--radius-md);
      overflow-x: auto;
      margin: 1em 0;
    }

    .result-content pre code {
      background: none;
      padding: 0;
    }

    /* Front matter table */
    .front-matter {
      width: 100%;
      margin-bottom: 24px;
      border-collapse: collapse;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .front-matter tr {
      border-bottom: 1px solid var(--border-color);
    }

    .front-matter tr:last-child {
      border-bottom: none;
    }

    .front-matter td {
      padding: 12px 16px;
      vertical-align: top;
    }

    .front-matter .fm-key {
      color: var(--success);
      font-weight: 500;
      width: 140px;
      white-space: nowrap;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }

    .front-matter .fm-value {
      color: var(--text-primary);
    }

    /* Enhanced markdown: Multi-column layout */
    .md-columns {
      display: grid;
      gap: 24px;
      margin: 1.5em 0;
    }
    .md-columns-2 { grid-template-columns: repeat(2, 1fr); }
    .md-columns-3 { grid-template-columns: repeat(3, 1fr); }
    .md-columns-4 { grid-template-columns: repeat(4, 1fr); }
    .md-column {
      padding: 16px;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
    }
    @media (max-width: 768px) {
      .md-columns { grid-template-columns: 1fr !important; }
    }

    /* Enhanced markdown: Callout boxes */
    .md-callout {
      display: flex;
      gap: 12px;
      padding: 16px;
      margin: 1em 0;
      border-radius: var(--radius-md);
      border-left: 4px solid;
    }
    .md-callout-icon {
      font-size: 18px;
      flex-shrink: 0;
    }
    .md-callout-content {
      flex: 1;
    }
    .md-callout-note {
      background: rgba(59, 130, 246, 0.1);
      border-color: #3b82f6;
    }
    .md-callout-warning {
      background: rgba(245, 158, 11, 0.1);
      border-color: #f59e0b;
    }
    .md-callout-tip {
      background: rgba(16, 185, 129, 0.1);
      border-color: #10b981;
    }
    .md-callout-info {
      background: rgba(139, 92, 246, 0.1);
      border-color: #8b5cf6;
    }

    /* Enhanced markdown: Tables */
    .md-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 14px;
    }
    .md-table th, .md-table td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .md-table th {
      background: var(--bg-tertiary);
      font-weight: 600;
      color: var(--text-primary);
    }
    .md-table tr:hover td {
      background: var(--bg-secondary);
    }

    /* Enhanced markdown: Code blocks */
    .code-block {
      position: relative;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      padding: 16px;
      margin: 1em 0;
      overflow-x: auto;
    }
    .code-block::before {
      content: attr(data-lang);
      position: absolute;
      top: 8px;
      right: 12px;
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 500;
    }
    .code-block code {
      background: none;
      padding: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    /* Enhanced markdown: Mermaid diagrams */
    .mermaid-wrapper {
      position: relative;
      margin: 1em 0;
    }
    .mermaid-toolbar {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 10;
    }
    .mermaid-wrapper:hover .mermaid-toolbar {
      opacity: 1;
    }
    .mermaid-toolbar button {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: var(--transition);
    }
    .mermaid-toolbar button:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-color: var(--accent);
    }
    .mermaid-inline {
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      padding: 24px;
      overflow: hidden;
      text-align: center;
      cursor: grab;
    }
    .mermaid-inline.dragging {
      cursor: grabbing;
    }
    .mermaid-inline svg {
      max-width: 100%;
      height: auto;
      transition: transform 0.1s ease-out;
    }
    .mermaid-error {
      color: var(--error);
      text-align: left;
    }

    /* Result viewer modal */
    .result-viewer-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      z-index: 2000;
      overflow: auto;
    }
    .result-viewer-modal.visible {
      display: flex;
      flex-direction: column;
    }
    .result-viewer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      background: var(--bg-elevated);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .result-viewer-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .result-viewer-close {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 8px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition);
    }
    .result-viewer-close:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }
    .result-viewer-body {
      flex: 1;
      padding: 32px;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
    }
    .result-viewer-body .result-content {
      background: var(--bg-primary);
      max-width: none;
    }
    .result-viewer-body .mermaid-inline {
      padding: 48px;
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .result-viewer-body .mermaid-toolbar {
      opacity: 1;
    }

    /* Mermaid fullscreen mode */
    .mermaid-fullscreen {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--bg-primary);
      z-index: 3000;
      display: flex;
      flex-direction: column;
    }
    .mermaid-fullscreen-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }
    .mermaid-fullscreen-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .mermaid-fullscreen-controls button {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      transition: var(--transition);
    }
    .mermaid-fullscreen-controls button:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    .mermaid-fullscreen-zoom {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .mermaid-fullscreen-body {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      background: var(--bg-tertiary);
    }
    .mermaid-fullscreen-body.dragging {
      cursor: grabbing;
    }
    #mermaid-fs-content {
      transform-origin: center center;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 100%;
      min-height: 100%;
    }
    #mermaid-fs-content svg {
      max-width: none !important;
      max-height: none !important;
      width: auto !important;
      height: auto !important;
    }

    /* Enhanced markdown: Images */
    .md-image {
      max-width: 100%;
      height: auto;
      border-radius: var(--radius-md);
      margin: 1em 0;
      cursor: zoom-in;
      transition: transform 0.2s ease;
    }
    .md-image:hover {
      transform: scale(1.02);
    }

    /* Image fullscreen viewer (reuses mermaid-fullscreen styles) */
    #image-fullscreen-container:not(:empty) .mermaid-fullscreen {
      cursor: default;
    }
    #image-fullscreen-container .mermaid-fullscreen-body {
      cursor: grab;
    }
    #image-fullscreen-container .mermaid-fullscreen-body.dragging {
      cursor: grabbing;
    }
    #image-fullscreen-container img {
      max-width: none;
      max-height: none;
      transform-origin: center center;
    }

    /* Enhanced markdown: Blockquotes */
    .result-content blockquote {
      border-left: 4px solid var(--accent);
      padding-left: 16px;
      margin: 1em 0;
      color: var(--text-secondary);
      font-style: italic;
    }

    /* Enhanced markdown: Horizontal rules */
    .result-content hr {
      border: none;
      border-top: 1px solid var(--border-color);
      margin: 2em 0;
    }

    /* Enhanced markdown: Lists */
    .result-content ul, .result-content ol {
      margin: 1em 0;
      padding-left: 24px;
    }
    .result-content li {
      margin: 0.5em 0;
    }

    /* Enhanced markdown: Links */
    .result-content a {
      color: var(--accent);
      text-decoration: none;
    }
    .result-content a:hover {
      text-decoration: underline;
    }

    /* Elicitation modal */
    .elicitation-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .elicitation-modal.visible {
      display: flex;
    }

    .elicitation-content {
      background: var(--bg-elevated);
      padding: 32px;
      border-radius: var(--radius-lg);
      max-width: 480px;
      width: 90%;
      box-shadow: var(--shadow-lg);
    }

    .elicitation-content h3 {
      margin-bottom: 24px;
      font-size: 18px;
      font-weight: 600;
    }

    /* OAuth elicitation */
    .oauth-provider {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      margin-bottom: 16px;
    }

    .oauth-provider-icon {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      background: var(--bg-tertiary);
    }

    .oauth-provider-info {
      flex: 1;
    }

    .oauth-provider-name {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .oauth-scopes {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .oauth-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      margin-top: 16px;
      font-size: 13px;
    }

    .oauth-status.waiting {
      color: var(--warning);
    }

    .oauth-status.success {
      color: var(--success);
    }

    .oauth-status.error {
      color: var(--error);
    }

    .oauth-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      padding: 40px;
    }

    .empty-icon {
      width: 80px;
      height: 80px;
      background: var(--bg-tertiary);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
      font-size: 32px;
    }

    .empty-state h3 {
      font-size: 20px;
      margin-bottom: 8px;
      color: var(--text-primary);
    }

    .empty-state p {
      font-size: 14px;
      color: var(--text-muted);
      max-width: 300px;
    }

    /* Mobile styles */
    @media (max-width: 768px) {
      .mobile-menu-btn {
        display: flex;
      }

      .sidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 1000;
        transform: translateX(-100%);
        box-shadow: var(--shadow-lg);
      }

      .sidebar.open {
        transform: translateX(0);
      }

      .sidebar-overlay {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
      }

      .sidebar-overlay.visible {
        display: block;
      }

      .main-content {
        padding-top: 72px;
      }

      .method-header {
        padding: 20px;
      }

      .method-header h2 {
        font-size: 18px;
      }

      .tabs {
        padding: 0 20px;
      }

      .tab {
        padding: 12px 16px;
        font-size: 13px;
      }

      .tab-content {
        padding: 20px;
      }

      .progress-card {
        padding: 24px;
        min-width: auto;
        width: 90%;
      }

      .result-content {
        padding: 16px;
      }
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-light);
    }

    /* Smart Rendering Components */
    ${generateSmartRenderingCSS()}
  </style>
</head>
<body>
  <!-- Mobile menu button -->
  <button class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Toggle menu">
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 12h18M3 6h18M3 18h18" stroke-linecap="round"/>
    </svg>
  </button>

  <!-- Sidebar overlay for mobile -->
  <div class="sidebar-overlay" id="sidebar-overlay"></div>

  <div class="app">
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">⚡</div>
          <h1>Photon</h1>
        </div>
        <p class="subtitle" id="photon-count">Loading...</p>
      </div>
      <div class="search-box">
        <input type="text" class="search-input" id="search-input" placeholder="Search methods...">
      </div>
      <div class="photon-list" id="photon-list"></div>
      <div class="sidebar-footer">
        <button class="marketplace-btn" onclick="showMarketplace()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="16"></line>
            <line x1="8" y1="12" x2="16" y2="12"></line>
          </svg>
          Add Photons
        </button>
      </div>
    </div>

    <div class="main-content">
      <div id="empty-state" class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3 id="empty-state-title">Select a method to begin</h3>
        <p id="empty-state-subtitle">Choose a photon and method from the sidebar to get started</p>
        <button class="btn" id="empty-state-btn" style="display: none;" onclick="showMarketplace()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Browse Marketplace
        </button>
      </div>

      <!-- Marketplace View -->
      <div id="marketplace-view" style="display: none; flex-direction: column; height: 100%;">
        <div class="method-header">
          <div class="method-header-top">
            <h2>Photon Marketplace</h2>
            <button class="btn btn-secondary" onclick="hideMarketplace()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Close
            </button>
          </div>
          <p class="method-description">Search and install photons from the marketplace</p>
        </div>
        <div style="padding: 20px; flex: 1; overflow-y: auto;">
          <div class="search-box" style="margin-bottom: 20px;">
            <input type="text" class="search-input" id="marketplace-search" placeholder="Search photons..." oninput="searchMarketplace(event)">
          </div>
          <div id="marketplace-results"></div>
        </div>
      </div>

      <div id="method-view" style="display: none; flex-direction: column; height: 100%;">
        <div class="method-header">
          <div class="method-header-top">
            <h2 id="method-title"></h2>
            <div class="photon-settings">
              <button class="settings-btn" onclick="toggleSettingsMenu(event)" title="Photon settings">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
                </svg>
              </button>
              <div class="settings-menu" id="settings-menu">
                <button onclick="reconfigurePhoton()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                  Reconfigure
                </button>
                <button onclick="reloadPhoton()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path>
                  </svg>
                  Reload
                </button>
                <div class="settings-divider"></div>
                <button class="danger" onclick="removePhoton()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                  </svg>
                  Remove
                </button>
              </div>
            </div>
          </div>
          <p id="method-description"></p>
        </div>

        <div class="tabs">
          <div class="tab active" data-tab="ui">Execute</div>
          <div class="tab" data-tab="data">Data</div>
        </div>

        <div class="tab-content">
          <div class="tab-panel active" id="ui-panel">
            <form id="invoke-form"></form>
            <div class="result-container" id="result-container">
              <div class="result-header">
                <span>Result</span>
                <div class="result-actions">
                  <div class="result-filter-wrapper">
                    <input type="text" class="result-filter-input" id="result-filter" placeholder="Filter..." oninput="filterResults(event)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </div>
                  <button class="result-expand-btn" onclick="openResultViewer()" title="Open in full view">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <polyline points="9 21 3 21 3 15"></polyline>
                      <line x1="21" y1="3" x2="14" y2="10"></line>
                      <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                    Expand
                  </button>
                </div>
              </div>
              <div class="result-content" id="result-content"></div>
              <div class="result-filter-count" id="result-filter-count" style="display: none;"></div>
            </div>
          </div>

          <div class="tab-panel" id="data-panel">
            <pre style="background: var(--bg-secondary); padding: 20px; border-radius: var(--radius-md); overflow-x: auto;"><code id="data-content" style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--text-secondary);">No data yet</code></pre>
          </div>
        </div>
      </div>

      <!-- Config view for unconfigured photons -->
      <div id="config-view" style="display: none; flex-direction: column; height: 100%;">
        <div class="method-header config-header">
          <div class="config-icon">⚙️</div>
          <h2 id="config-title"></h2>
          <p id="config-description"></p>
        </div>

        <div class="tabs">
          <div class="tab active" data-config-tab="form">Form</div>
          <div class="tab" data-config-tab="json">JSON</div>
        </div>

        <div class="tab-content" style="flex: 1; overflow-y: auto;">
          <div class="tab-panel active" id="config-form-panel">
            <div class="config-form-container">
              <form id="config-form"></form>
            </div>
          </div>

          <div class="tab-panel" id="config-json-panel">
            <div class="config-json-container">
              <textarea id="config-json" spellcheck="false" placeholder="{}"></textarea>
              <button type="button" class="btn btn-configure" onclick="saveConfigJson()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
                  <polyline points="17,21 17,13 7,13 7,21"/>
                  <polyline points="7,3 7,8 15,8"/>
                </svg>
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Progress overlay -->
  <div class="progress-overlay" id="progress-overlay">
    <div class="progress-card">
      <div class="progress-spinner"></div>
      <div class="progress-message" id="progress-message">Processing...</div>
      <div class="progress-bar-container" id="progress-bar-container" style="display: none;">
        <div class="progress-bar-fill" id="progress-bar-fill" style="width: 0%"></div>
      </div>
      <div class="progress-percent" id="progress-percent" style="display: none;">0%</div>
    </div>
  </div>

  <!-- Elicitation modal -->
  <div class="elicitation-modal" id="elicitation-modal">
    <div class="elicitation-content">
      <h3 id="elicitation-title"></h3>
      <div id="elicitation-form"></div>
    </div>
  </div>

  <!-- File browser modal -->
  <div class="file-browser-overlay" id="file-browser-overlay">
    <div class="file-browser">
      <div class="file-browser-header">
        <h3>Select File</h3>
        <button class="file-browser-close" onclick="closeFileBrowser()">&times;</button>
      </div>
      <div class="file-browser-path">
        <button onclick="browseParent()">↑ Up</button>
        <span id="file-browser-current-path"></span>
      </div>
      <div class="file-browser-list" id="file-browser-list"></div>
      <div class="file-browser-footer">
        <button class="cancel-btn" onclick="closeFileBrowser()">Cancel</button>
        <button class="select-btn" id="file-browser-select" disabled onclick="selectFile()">Select</button>
      </div>
    </div>
  </div>

  <!-- Result viewer modal -->
  <div class="result-viewer-modal" id="result-viewer-modal">
    <div class="result-viewer-header">
      <div class="result-viewer-title">Result</div>
      <button class="result-viewer-close" onclick="closeResultViewer()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="result-viewer-body">
      <div class="result-content" id="result-viewer-content"></div>
    </div>
  </div>

  <!-- Mermaid fullscreen container (created dynamically) -->
  <div id="mermaid-fullscreen-container"></div>

  <!-- Image fullscreen container (created dynamically) -->
  <div id="image-fullscreen-container"></div>

  <!-- Activity Panel -->
  <div class="activity-panel" id="activity-panel">
    <div class="activity-header" onclick="toggleActivityPanel()">
      <div class="activity-title">
        <span>Activity</span>
        <span class="activity-badge" id="activity-count">0</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="activity-clear" onclick="clearActivity(event)">Clear</button>
        <span class="activity-toggle">▲</span>
      </div>
    </div>
    <div class="activity-list" id="activity-list"></div>
  </div>

  <script>
    // Smart Rendering System
    ${generateSmartRenderingJS()}

    let ws;
    let photons = [];
    let currentPhoton = null;
    let currentMethod = null;

    // Activity log
    let activityLog = [];
    const MAX_ACTIVITY_ITEMS = 100;

    function addActivity(type, message, details = {}) {
      const entry = {
        id: Date.now(),
        time: new Date(),
        type,
        message,
        ...details
      };
      activityLog.unshift(entry);
      if (activityLog.length > MAX_ACTIVITY_ITEMS) {
        activityLog.pop();
      }
      renderActivityList();
    }

    function renderActivityList() {
      const list = document.getElementById('activity-list');
      const count = document.getElementById('activity-count');
      count.textContent = activityLog.length;

      if (activityLog.length === 0) {
        list.innerHTML = '<div style="padding: 16px; color: var(--text-muted); text-align: center;">No activity yet</div>';
        return;
      }

      const icons = {
        invoke: '▶',
        result: '✓',
        error: '✗',
        reload: '↻',
        config: '⚙',
        status: '•',
        connect: '◉',
        'hot-reload': '⚡'
      };

      list.innerHTML = activityLog.map(entry => {
        const time = entry.time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const icon = icons[entry.type] || '•';
        return \`
          <div class="activity-item">
            <span class="activity-time">\${time}</span>
            <span class="activity-icon">\${icon}</span>
            <div class="activity-content">
              <span class="activity-type \${entry.type}">\${entry.type}</span>
              <span class="activity-message">\${entry.message}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    function toggleActivityPanel() {
      document.getElementById('activity-panel').classList.toggle('expanded');
    }

    function clearActivity(e) {
      e.stopPropagation();
      activityLog = [];
      renderActivityList();
    }

    // Hash-based routing
    function updateHash(photonName, methodName) {
      const hash = methodName ? \`#\${photonName}/\${methodName}\` : \`#\${photonName}\`;
      if (window.location.hash !== hash) {
        history.pushState(null, '', hash);
      }
    }

    function parseHash() {
      const hash = window.location.hash.slice(1); // Remove #
      if (!hash) return null;
      const parts = hash.split('/');
      return {
        photon: parts[0] || null,
        method: parts[1] || null
      };
    }

    function restoreFromHash() {
      const route = parseHash();
      if (!route || !route.photon) return;

      const photon = photons.find(p => p.name === route.photon);
      if (!photon) return;

      if (!photon.configured) {
        // Show configuration view for unconfigured photon
        selectUnconfiguredByName(route.photon);
        return;
      }

      // Expand the photon in sidebar
      const methodList = document.getElementById(\`methods-\${route.photon}\`);
      const header = document.querySelector(\`[data-photon="\${route.photon}"]\`);
      if (methodList) methodList.classList.add('expanded');
      if (header) header.classList.add('expanded');

      if (route.method) {
        const method = photon.methods?.find(m => m.name === route.method);
        if (method) {
          // Select the method
          selectMethodByName(route.photon, route.method);
        }
      }
    }

    function selectMethodByName(photonName, methodName) {
      currentPhoton = photons.find(p => p.name === photonName);
      if (!currentPhoton) return;
      currentMethod = currentPhoton.methods?.find(m => m.name === methodName);
      if (!currentMethod) return;

      // Update selection in sidebar
      document.querySelectorAll('.method-item').forEach(el => {
        el.classList.remove('selected');
      });
      const methodItem = document.querySelector(\`.method-item[onclick*="'\${methodName}'"]\`);
      if (methodItem) methodItem.classList.add('selected');

      // Show method view, hide others
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
      document.getElementById('method-view').style.display = 'flex';
      document.getElementById('method-title').textContent = \`\${photonName}.\${methodName}()\`;
      document.getElementById('method-description').textContent = currentMethod.description || 'No description available';

      renderForm();
      document.getElementById('result-container').classList.remove('visible');
    }

    function selectUnconfiguredByName(photonName) {
      currentPhoton = photons.find(p => p.name === photonName);
      if (!currentPhoton || currentPhoton.configured) return;
      currentMethod = null;

      // Update selection in sidebar
      document.querySelectorAll('.method-item, .photon-header').forEach(el => {
        el.classList.remove('selected');
      });
      const header = document.querySelector(\`[data-photon="\${photonName}"]\`);
      if (header) header.classList.add('selected');

      // Show config view in main area
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('method-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'flex';

      // Update config view content
      document.getElementById('config-title').textContent = photonName;
      document.getElementById('config-description').textContent = currentPhoton.errorMessage || 'Configure this photon to enable its features';

      renderConfigForm();
    }

    // Listen for browser back/forward
    window.addEventListener('popstate', () => {
      restoreFromHash();
    });

    // Mobile menu handling
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function toggleSidebar(open) {
      if (open === undefined) {
        open = !sidebar.classList.contains('open');
      }
      sidebar.classList.toggle('open', open);
      sidebarOverlay.classList.toggle('visible', open);
    }

    mobileMenuBtn.addEventListener('click', () => toggleSidebar());
    sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

    // Search functionality
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.photon-item').forEach(item => {
        const photonName = item.querySelector('.photon-name').textContent.toLowerCase();
        const methods = item.querySelectorAll('.method-item');
        let hasMatch = photonName.includes(query);

        methods.forEach(method => {
          const methodName = method.textContent.toLowerCase();
          const matches = methodName.includes(query);
          method.style.display = query && !matches && !hasMatch ? 'none' : '';
          if (matches) hasMatch = true;
        });

        item.style.display = hasMatch || !query ? '' : 'none';
        if (query && hasMatch) {
          item.querySelector('.method-list').classList.add('expanded');
          item.querySelector('.photon-header').classList.add('expanded');
        }
      });
    });

    // Initialize Mermaid with dark theme
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#6366f1',
        primaryTextColor: '#e5e7eb',
        primaryBorderColor: '#4f46e5',
        lineColor: '#6b7280',
        secondaryColor: '#1f2937',
        tertiaryColor: '#111827',
        background: '#0f0f0f',
        mainBkg: '#1c1c1c',
        nodeBorder: '#4b5563',
        clusterBkg: '#1f2937',
        clusterBorder: '#374151',
        titleColor: '#f3f4f6',
        edgeLabelBackground: '#1c1c1c'
      }
    });

    function connect() {
      ws = new WebSocket('ws://localhost:${port}');

      ws.onopen = () => {
        console.log('Connected to Beam');
        addActivity('connect', 'Connected to Beam server');
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
      };

      ws.onclose = () => {
        console.log('Disconnected, reconnecting...');
        setTimeout(connect, 1000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    }

    function handleMessage(message) {
      switch (message.type) {
        case 'photons':
          photons = message.data;
          renderPhotonList();
          // Restore navigation state from URL hash
          setTimeout(() => restoreFromHash(), 50);
          break;
        case 'yield':
          handleYield(message.data);
          break;
        case 'result':
          handleResult(message);
          break;
        case 'error':
          handleError(message.message);
          break;
        case 'elicitation':
          showElicitation(message.data);
          break;
        case 'configured':
          handleConfigured(message.photon);
          break;
        case 'reloaded':
          handleReloaded(message.photon);
          break;
        case 'removed':
          handleRemoved(message.photon, message.photons);
          break;
        case 'hot-reload':
          handleHotReload(message.photon);
          break;
        case 'hot-reload-error':
          showToast(\`Hot reload failed: \${message.photon}\`, 'error');
          break;
        case 'photon_added':
          // Reload the photon list when a new photon is added
          fetch('/api/photons')
            .then(res => res.json())
            .then(data => {
              photons = data;
              renderPhotonList();
              addActivity('install', \`\${message.name} installed from marketplace\`);
            });
          break;
      }
    }

    function handleHotReload(photon) {
      showToast(\`\${photon.name} updated\`, 'info');
      addActivity('hot-reload', \`\${photon.name} reloaded (file changed)\`);

      // Update photon in list
      const index = photons.findIndex(p => p.name === photon.name);
      if (index !== -1) {
        photons[index] = photon;
        renderPhotonList();

        // Re-select the current method if we're viewing this photon
        if (currentPhoton && currentPhoton.name === photon.name) {
          currentPhoton = photon;
          if (currentMethod) {
            const method = photon.methods.find(m => m.name === currentMethod.name);
            if (method) {
              currentMethod = method;
              renderMethodView();
            } else {
              // Method was removed, show first available
              if (photon.methods.length > 0) {
                currentMethod = photon.methods[0];
                renderMethodView();
              }
            }
          }
        }
      }
    }

    function handleReloaded(photon) {
      hideProgress();
      showToast(\`\${photon.name} reloaded\`, 'success');
      addActivity('reload', \`\${photon.name} manually reloaded\`);

      // Update photon in list
      const index = photons.findIndex(p => p.name === photon.name);
      if (index !== -1) {
        photons[index] = photon;
        renderPhotonList();

        // Re-select the current method if we're viewing this photon
        if (currentPhoton && currentPhoton.name === photon.name && currentMethod) {
          currentPhoton = photon;
          const method = photon.methods.find(m => m.name === currentMethod.name);
          if (method) {
            currentMethod = method;
            renderMethodView();
          }
        }
      }
    }

    function handleRemoved(photonName, updatedPhotons) {
      hideProgress();
      showToast(\`\${photonName} removed\`, 'success');

      photons = updatedPhotons;
      renderPhotonList();

      // If we were viewing this photon, clear the view
      if (currentPhoton && currentPhoton.name === photonName) {
        currentPhoton = null;
        currentMethod = null;
        document.getElementById('method-view').innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">⚡</div>
            <h2>Photon Beam</h2>
            <p>Select a method to begin</p>
          </div>
        \`;
        updateHash('', '');
      }
    }

    function handleConfigured(photon) {
      hideProgress();
      addActivity('config', \`\${photon.name} configured and enabled\`);

      // Update photon in list
      const index = photons.findIndex(p => p.name === photon.name);
      if (index !== -1) {
        photons[index] = photon;
        renderPhotonList();

        // Auto-expand the newly configured photon after render
        setTimeout(() => {
          const methodList = document.getElementById(\`methods-\${photon.name}\`);
          const header = document.querySelector(\`[data-photon="\${photon.name}"]\`);
          if (methodList) methodList.classList.add('expanded');
          if (header) header.classList.add('expanded');
        }, 50);
      }
    }

    // ========== History & Favorites ==========
    const STORAGE_KEY_FAVORITES = 'beam-favorites';
    const STORAGE_KEY_RECENT = 'beam-recent';
    const MAX_RECENT = 5;

    function getFavorites() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_FAVORITES) || '[]');
      } catch { return []; }
    }

    function setFavorites(favorites) {
      localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favorites));
    }

    function toggleFavorite(photonName, methodName, event) {
      event?.stopPropagation();
      const key = \`\${photonName}/\${methodName}\`;
      const favorites = getFavorites();
      const index = favorites.indexOf(key);
      if (index >= 0) {
        favorites.splice(index, 1);
      } else {
        favorites.push(key);
      }
      setFavorites(favorites);
      renderPhotonList();
    }

    function getRecent() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '[]');
      } catch { return []; }
    }

    function addToRecent(photonName, methodName) {
      const key = \`\${photonName}/\${methodName}\`;
      let recent = getRecent();
      // Remove if already exists
      recent = recent.filter(r => r !== key);
      // Add to front
      recent.unshift(key);
      // Keep only MAX_RECENT
      recent = recent.slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(recent));
    }

    function isFavorite(photonName, methodName) {
      return getFavorites().includes(\`\${photonName}/\${methodName}\`);
    }

    function getMethodByKey(key) {
      const [photonName, methodName] = key.split('/');
      const photon = photons.find(p => p.name === photonName && p.configured);
      const method = photon?.methods?.find(m => m.name === methodName);
      return method ? { photon, method, photonName, methodName } : null;
    }

    function renderMethodItem(photonName, method, showPhotonName = false) {
      const fav = isFavorite(photonName, method.name);
      const favClass = fav ? 'favorited' : '';
      const prefix = showPhotonName ? \`<span class="method-photon-prefix">\${photonName}.</span>\` : '';
      return \`
        <div class="method-item" onclick="selectMethod('\${photonName}', '\${method.name}', event)">
          \${method.icon ? \`<span class="method-icon">\${method.icon}</span>\` : ''}
          \${prefix}\${method.name}
          <button class="favorite-btn \${favClass}" onclick="toggleFavorite('\${photonName}', '\${method.name}', event)" title="\${fav ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="\${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
        </div>
      \`;
    }

    function renderPhotonList() {
      const list = document.getElementById('photon-list');
      const count = document.getElementById('photon-count');

      const configured = photons.filter(p => p.configured);
      const unconfigured = photons.filter(p => !p.configured);
      const totalMethods = configured.reduce((sum, p) => sum + (p.methods?.length || 0), 0);

      if (unconfigured.length > 0) {
        count.textContent = \`\${configured.length} ready · \${unconfigured.length} need setup\`;
      } else {
        count.textContent = \`\${photons.length} photon\${photons.length !== 1 ? 's' : ''} · \${totalMethods} methods\`;
      }

      let html = '';

      // Favorites section
      const favorites = getFavorites();
      const favoriteItems = favorites.map(getMethodByKey).filter(Boolean);
      if (favoriteItems.length > 0) {
        html += \`
          <div class="special-section">
            <div class="section-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              Favorites
            </div>
            <div class="method-list expanded">
              \${favoriteItems.map(item => renderMethodItem(item.photonName, item.method, true)).join('')}
            </div>
          </div>
        \`;
      }

      // Recent section
      const recent = getRecent();
      const recentItems = recent.map(getMethodByKey).filter(Boolean).filter(item =>
        !favorites.includes(\`\${item.photonName}/\${item.methodName}\`)
      ).slice(0, 3);
      if (recentItems.length > 0) {
        html += \`
          <div class="special-section">
            <div class="section-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              Recent
            </div>
            <div class="method-list expanded">
              \${recentItems.map(item => renderMethodItem(item.photonName, item.method, true)).join('')}
            </div>
          </div>
        \`;
      }

      // All photons
      html += photons.map(photon => {
        if (photon.configured) {
          return \`
            <div class="photon-item">
              <div class="photon-header" data-photon="\${photon.name}" onclick="togglePhoton('\${photon.name}')">
                <span class="photon-name">\${photon.name}</span>
                <span class="method-count">\${photon.methods.length}</span>
              </div>
              <div class="method-list" id="methods-\${photon.name}">
                \${photon.methods.map(method => renderMethodItem(photon.name, method, false)).join('')}
              </div>
            </div>
          \`;
        } else {
          return \`
            <div class="photon-item unconfigured">
              <div class="photon-header" data-photon="\${photon.name}" onclick="selectUnconfigured('\${photon.name}')" title="Click to configure">
                <span class="photon-name">\${photon.name}</span>
                <span class="setup-indicator" title="Needs setup">?</span>
              </div>
            </div>
          \`;
        }
      }).join('');

      list.innerHTML = html;

      // Show empty state with marketplace prompt if no photons
      if (photons.length === 0) {
        document.getElementById('empty-state-title').textContent = 'No photons installed';
        document.getElementById('empty-state-subtitle').textContent = 'Get started by adding photons from the marketplace';
        document.getElementById('empty-state-btn').style.display = 'inline-flex';
      } else {
        document.getElementById('empty-state-title').textContent = 'Select a method to begin';
        document.getElementById('empty-state-subtitle').textContent = 'Choose a photon and method from the sidebar to get started';
        document.getElementById('empty-state-btn').style.display = 'none';
      }
    }

    // ========== Marketplace Functions ==========
    let marketplacePhotons = [];
    let installedPhotonNames = new Set();

    function showMarketplace() {
      // Hide other views
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('method-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
      document.getElementById('marketplace-view').style.display = 'flex';

      // Update installed photons set
      installedPhotonNames = new Set(photons.map(p => p.name));

      // Focus search input
      document.getElementById('marketplace-search').focus();

      // Load marketplace if not loaded
      if (marketplacePhotons.length === 0) {
        loadMarketplace();
      } else {
        renderMarketplaceResults(marketplacePhotons);
      }
    }

    function hideMarketplace() {
      document.getElementById('marketplace-view').style.display = 'none';
      document.getElementById('empty-state').style.display = photons.length === 0 ? 'flex' : 'none';
      if (photons.length > 0 && !currentMethod) {
        document.getElementById('empty-state').style.display = 'flex';
      }
    }

    async function loadMarketplace() {
      const results = document.getElementById('marketplace-results');
      results.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Loading marketplace...</div>';

      try {
        const response = await fetch('/api/marketplace/list');
        const data = await response.json();
        marketplacePhotons = data.photons || [];
        renderMarketplaceResults(marketplacePhotons);
      } catch (err) {
        results.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--error);">Failed to load marketplace</div>';
      }
    }

    async function searchMarketplace(event) {
      const query = event.target.value.trim();

      if (query.length === 0) {
        renderMarketplaceResults(marketplacePhotons);
        return;
      }

      if (query.length < 2) return;

      // Debounce
      clearTimeout(window.marketplaceSearchTimeout);
      window.marketplaceSearchTimeout = setTimeout(async () => {
        try {
          const response = await fetch(\`/api/marketplace/search?q=\${encodeURIComponent(query)}\`);
          const data = await response.json();
          renderMarketplaceResults(data.photons || []);
        } catch (err) {
          // Fall back to local filter
          const filtered = marketplacePhotons.filter(p =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            (p.description || '').toLowerCase().includes(query.toLowerCase())
          );
          renderMarketplaceResults(filtered);
        }
      }, 300);
    }

    function renderMarketplaceResults(results) {
      const container = document.getElementById('marketplace-results');

      if (results.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No photons found</div>';
        return;
      }

      container.innerHTML = results.map(photon => {
        const isInstalled = installedPhotonNames.has(photon.name);
        const tags = (photon.tags || []).slice(0, 3).map(t => \`<span class="marketplace-tag">\${t}</span>\`).join('');

        return \`
          <div class="marketplace-item">
            <div class="marketplace-item-info">
              <div class="marketplace-item-name">\${photon.name}</div>
              <div class="marketplace-item-desc">\${photon.description || 'No description'}</div>
              <div class="marketplace-item-meta">
                \${photon.version ? \`<span>v\${photon.version}</span>\` : ''}
                \${photon.author ? \`<span>by \${photon.author}</span>\` : ''}
              </div>
              \${tags ? \`<div class="marketplace-item-tags" style="margin-top: 8px;">\${tags}</div>\` : ''}
            </div>
            <div class="marketplace-item-action">
              <button class="btn-install \${isInstalled ? 'installed' : ''}"
                      onclick="installPhoton('\${photon.name}')"
                      \${isInstalled ? 'disabled' : ''}>
                \${isInstalled ? 'Installed' : 'Install'}
              </button>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function installPhoton(name) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Installing...';

      try {
        const response = await fetch('/api/marketplace/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });

        const data = await response.json();

        if (data.success) {
          showToast(\`Installed \${name} successfully\`, 'success');
          btn.textContent = 'Installed';
          btn.classList.add('installed');
          installedPhotonNames.add(name);
          // The server will broadcast photon_added which triggers a reload
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (err) {
        showToast(\`Failed to install \${name}: \${err.message}\`, 'error');
        btn.disabled = false;
        btn.textContent = 'Install';
      }
    }

    function selectUnconfigured(photonName) {
      currentPhoton = photons.find(p => p.name === photonName);
      currentMethod = null;

      // Update URL hash
      updateHash(photonName, null);

      // Update selection in sidebar
      document.querySelectorAll('.method-item, .photon-header').forEach(el => {
        el.classList.remove('selected');
      });
      const header = document.querySelector(\`[data-photon="\${photonName}"]\`);
      if (header) header.classList.add('selected');

      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        toggleSidebar(false);
      }

      // Show config view in main area
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('method-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'flex';

      // Update config view content
      document.getElementById('config-title').textContent = photonName;
      document.getElementById('config-description').textContent = currentPhoton.errorMessage || 'Configure this photon to enable its features';

      // Render config form
      renderConfigForm();
    }

    function renderConfigForm() {
      const form = document.getElementById('config-form');
      const params = currentPhoton.requiredParams || [];

      let html = '';

      for (const param of params) {
        const isRequired = !param.isOptional && !param.hasDefault;
        const isSecret = param.name.toLowerCase().includes('password') ||
                        param.name.toLowerCase().includes('secret') ||
                        param.name.toLowerCase().includes('key') ||
                        param.name.toLowerCase().includes('token');
        const isBoolean = param.type === 'boolean';
        const isNumber = param.type === 'number';
        const defaultValue = param.hasDefault ? param.defaultValue : '';

        html += \`<div class="form-group">
            <label>
              \${param.name}\${isRequired ? ' <span class="required">*</span>' : ''}
              <span class="hint">\${param.envVar}</span>
            </label>\`;

        if (isBoolean) {
          // Toggle switch for booleans
          const isOn = defaultValue === true || defaultValue === 'true';
          html += \`
            <div class="toggle-switch">
              <button type="button" class="toggle-btn \${!isOn ? 'active' : ''}" data-value="false" onclick="setToggle(this, '\${param.envVar}', false)">Off</button>
              <button type="button" class="toggle-btn \${isOn ? 'active' : ''}" data-value="true" onclick="setToggle(this, '\${param.envVar}', true)">On</button>
              <input type="hidden" name="\${param.envVar}" value="\${isOn ? 'true' : 'false'}" />
            </div>\`;
        } else if (isNumber) {
          html += \`
            <input
              type="number"
              name="\${param.envVar}"
              value="\${defaultValue}"
              placeholder="Enter \${param.name}..."
              \${isRequired ? 'required' : ''}
            />\`;
        } else {
          html += \`
            <input
              type="\${isSecret ? 'password' : 'text'}"
              name="\${param.envVar}"
              value="\${defaultValue}"
              placeholder="Enter \${param.name}..."
              \${isRequired ? 'required' : ''}
            />\`;
        }

        html += \`</div>\`;
      }

      html += \`
        <button type="submit" class="btn btn-configure">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
          </svg>
          Configure & Enable
        </button>
      \`;

      form.innerHTML = html;
      form.onsubmit = handleConfigSubmit;
    }

    function setToggle(btn, name, value) {
      const container = btn.parentElement;
      container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      container.querySelector('input[type="hidden"]').value = value ? 'true' : 'false';
    }

    // Settings menu functions
    function toggleSettingsMenu(e) {
      e.stopPropagation();
      const menu = document.getElementById('settings-menu');
      menu.classList.toggle('visible');

      // Close menu when clicking outside
      const closeMenu = (event) => {
        if (!event.target.closest('.photon-settings')) {
          menu.classList.remove('visible');
          document.removeEventListener('click', closeMenu);
        }
      };

      if (menu.classList.contains('visible')) {
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      }
    }

    function reconfigurePhoton() {
      if (!currentPhoton) return;
      document.getElementById('settings-menu').classList.remove('visible');

      // Show config view with current photon
      document.getElementById('method-view').style.display = 'none';
      document.getElementById('config-view').style.display = 'flex';
      document.getElementById('config-title').textContent = currentPhoton.name;
      document.getElementById('config-description').textContent = 'Update configuration for this photon';

      renderConfigForm();
    }

    function reloadPhoton() {
      if (!currentPhoton) return;
      document.getElementById('settings-menu').classList.remove('visible');

      showProgress(\`Reloading \${currentPhoton.name}...\`);

      ws.send(JSON.stringify({
        type: 'reload',
        photon: currentPhoton.name
      }));
    }

    function removePhoton() {
      if (!currentPhoton) return;
      document.getElementById('settings-menu').classList.remove('visible');

      const photonName = currentPhoton.name;
      showConfirmDialog(\`Remove \${photonName} from this workspace?\`, () => {
        ws.send(JSON.stringify({
          type: 'remove',
          photon: photonName
        }));

        // Go back to empty state
        currentPhoton = null;
        currentMethod = null;
        document.getElementById('method-view').style.display = 'none';
        document.getElementById('empty-state').style.display = 'flex';
        history.pushState(null, '', window.location.pathname);
      });
    }

    function handleConfigSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const formData = new FormData(form);
      const config = {};

      for (const [key, value] of formData.entries()) {
        if (value) config[key] = value;
      }

      showProgress(\`Configuring \${currentPhoton.name}...\`);

      ws.send(JSON.stringify({
        type: 'configure',
        photon: currentPhoton.name,
        config
      }));
    }

    function updateConfigJson() {
      if (!currentPhoton) return;

      // Build config object from current form values
      const form = document.getElementById('config-form');
      const formData = new FormData(form);
      let config = {};

      for (const [key, value] of formData.entries()) {
        if (value) config[key] = value;
      }

      // If form is empty, show template with param names
      if (Object.keys(config).length === 0 && currentPhoton.requiredParams) {
        for (const param of currentPhoton.requiredParams) {
          config[param.envVar] = param.hasDefault ? String(param.defaultValue) : '';
        }
      }

      document.getElementById('config-json').value = JSON.stringify(config, null, 2);
    }

    function saveConfigJson() {
      if (!currentPhoton) return;

      try {
        const jsonText = document.getElementById('config-json').value;
        const config = JSON.parse(jsonText);

        showProgress(\`Configuring \${currentPhoton.name}...\`);

        ws.send(JSON.stringify({
          type: 'configure',
          photon: currentPhoton.name,
          config
        }));
      } catch (error) {
        showToast('Invalid JSON: ' + error.message, 'error');
      }
    }

    function togglePhoton(photonName) {
      const header = event.currentTarget;
      const methodList = document.getElementById(\`methods-\${photonName}\`);
      header.classList.toggle('expanded');
      methodList.classList.toggle('expanded');
    }

    function selectMethod(photonName, methodName, e) {
      currentPhoton = photons.find(p => p.name === photonName);
      currentMethod = currentPhoton.methods.find(m => m.name === methodName);

      // Track in recent history
      addToRecent(photonName, methodName);

      // Update URL hash
      updateHash(photonName, methodName);

      // Update selection
      document.querySelectorAll('.method-item').forEach(el => {
        el.classList.remove('selected');
      });
      e.target.classList.add('selected');

      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        toggleSidebar(false);
      }

      // Show method view, hide others
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('config-view').style.display = 'none';
      document.getElementById('method-view').style.display = 'flex';

      // Update header
      document.getElementById('method-title').textContent = \`\${photonName}.\${methodName}()\`;
      document.getElementById('method-description').textContent = currentMethod.description || 'No description available';

      // Render form
      renderForm();

      // Clear previous results
      document.getElementById('result-container').classList.remove('visible');
    }

    function renderForm() {
      const form = document.getElementById('invoke-form');
      const params = currentMethod.params;

      // Handle anyOf schemas (union types like { ip: string } | string)
      // Extract properties from the first object option in the union
      let properties = params.properties || {};
      let required = params.required || [];

      if (params.anyOf && Array.isArray(params.anyOf)) {
        const objectOption = params.anyOf.find(opt => opt.type === 'object' && opt.properties);
        if (objectOption) {
          properties = objectOption.properties || {};
          required = objectOption.required || [];
        }
      }

      let html = '';

      for (const [key, schema] of Object.entries(properties)) {
        // Skip hidden fields (for programmatic use only, not UI)
        if (schema.hidden === true) {
          continue;
        }

        // Fields with default values are not truly required
        const hasDefault = schema.default !== undefined;
        const isRequired = required.includes(key) && !hasDefault;
        const description = schema.description || '';

        // Clean description - remove default info since we show it in placeholder
        const cleanDesc = description.replace(/\\s*\\(default:.*?\\)/gi, '').trim();

        // Use custom label from {@label} or format the key name
        const fieldLabel = schema.title || formatLabel(key);

        // Use {@hint} for help text, fallback to clean description
        const hintText = schema.hint || cleanDesc;

        html += \`
          <div class="form-group">
            <label>
              \${fieldLabel}
              \${isRequired ? '<span class="required">*</span>' : ''}
              \${hintText ? \`<span class="hint">\${hintText}</span>\` : ''}
            </label>
            \${renderInput(key, schema, isRequired)}
          </div>
        \`;
      }

      // Check if method has no required fields (all have defaults or optional)
      const hasRequiredFields = Object.entries(properties).some(([key, schema]) => {
        const hasDefault = schema.default !== undefined;
        return required.includes(key) && !hasDefault;
      });

      // Check if method will auto-execute (no user input needed)
      const noParams = Object.keys(properties).length === 0;
      const willAutoExecute = noParams || (!hasRequiredFields && currentMethod.autorun) || (!hasRequiredFields && currentMethod.linkedUi);

      // Only show the Run button if user input is needed (not auto-executing)
      // Auto-executing methods can be re-run via the Reload option in settings menu
      if (!willAutoExecute) {
        // Use explicit buttonLabel from @returns {@label}, or format the method name
        const buttonLabel = currentMethod.buttonLabel || formatLabel(currentMethod.name);
        html += \`<button type="submit" class="btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span>\${buttonLabel}</span></button>\`;
      }

      form.innerHTML = html;
      form.onsubmit = handleSubmit;

      // Auto-execute if method has no required fields (no user input needed)
      if (willAutoExecute) {
        setTimeout(() => {
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }, 100);
      }
    }

    // Format camelCase/PascalCase to "Title Case With Spaces"
    // Examples: getUserName -> "Get User Name", apiKey -> "Api Key"
    function formatLabel(name) {
      if (!name) return '';
      // Insert space before each capital letter (for camelCase)
      let result = name.replace(/([a-z])([A-Z])/g, '$1 $2');
      // Insert space before numbers (use [0-9] instead of \\d to avoid escaping issues)
      result = result.replace(/([a-zA-Z])([0-9])/g, '$1 $2');
      // Capitalize first letter
      return result.charAt(0).toUpperCase() + result.slice(1);
    }

    // Generate sample value from JSON Schema (Swagger-style)
    function generateSchemaSample(schema) {
      if (!schema) return null;

      const type = schema.type;

      if (type === 'array') {
        const itemSample = generateSchemaSample(schema.items);
        return itemSample ? [itemSample] : [];
      }

      if (type === 'object') {
        const sample = {};
        const props = schema.properties || {};
        for (const [key, propSchema] of Object.entries(props)) {
          sample[key] = generateSchemaSample(propSchema);
        }
        return sample;
      }

      // Primitives - return type placeholder
      if (type === 'string') return 'string';
      if (type === 'number' || type === 'integer') return 0;
      if (type === 'boolean') return true;

      return null;
    }

    function renderInput(key, schema, isRequired) {
      const type = schema.type || 'string';
      const defaultValue = schema.default;
      const enumValues = schema.enum;

      // Complex types (array, object) - use JSON textarea with schema preview
      if (type === 'array' || type === 'object') {
        // Generate sample from schema (Swagger-style)
        const schemaSample = generateSchemaSample(schema);
        const example = schema.example || schemaSample;
        const defaultVal = defaultValue ? JSON.stringify(defaultValue, null, 2) : '';
        // Show formatted sample in a preview div
        const sampleJson = JSON.stringify(example, null, 2);
        return \`
          <div class="json-schema-preview">
            <div class="json-schema-label">Expected format:</div>
            <pre class="json-schema-sample">\${escapeHtml(sampleJson)}</pre>
          </div>
          <textarea
            name="\${key}"
            class="json-input"
            \${isRequired ? 'required' : ''}
            placeholder="Enter JSON here..."
            rows="6"
            style="font-family: 'JetBrains Mono', monospace; font-size: 12px;"
          >\${defaultVal}</textarea>
        \`;
      }

      // Check for anyOf with enum (mixed: enum values + free-form) - use autocomplete
      if (schema.anyOf) {
        const enumSchema = schema.anyOf.find(s => s.enum);
        const freeFormSchema = schema.anyOf.find(s => !s.enum && (s.type === 'string' || s.type === 'number'));

        if (enumSchema && freeFormSchema) {
          const suggestions = enumSchema.enum || [];
          const listId = \`list-\${key}\`;
          const defaultAttr = defaultValue ? \`value="\${defaultValue}"\` : '';
          return \`
            <input type="text" name="\${key}" list="\${listId}" \${defaultAttr} \${isRequired ? 'required' : ''} placeholder="Select or enter \${key}..." />
            <datalist id="\${listId}">
              \${suggestions.map(v => \`<option value="\${v}">\`).join('')}
            </datalist>
          \`;
        }
      }

      // Dropdown for enum/choice values
      if (enumValues) {
        return \`
          <select name="\${key}" \${isRequired ? 'required' : ''}>
            \${!isRequired && !defaultValue ? \`<option value="">Select \${key}...</option>\` : ''}
            \${enumValues.map(v => \`<option value="\${v}" \${v === defaultValue ? 'selected' : ''}>\${v}</option>\`).join('')}
          </select>
        \`;
      }

      // Boolean toggle switch
      if (type === 'boolean') {
        const boolDefault = defaultValue === true || defaultValue === 'true';
        return \`
          <label class="toggle-switch" onclick="toggleBoolean(this)" style="display: inline-flex; align-items: center; cursor: pointer; gap: 8px;">
            <input type="checkbox" name="\${key}" value="true" data-type="boolean" \${boolDefault ? 'checked' : ''} style="display: none;" />
            <span class="toggle-track" style="
              position: relative;
              width: 44px;
              height: 24px;
              background: \${boolDefault ? 'var(--accent, #3b82f6)' : 'var(--bg-tertiary, #374151)'};
              border-radius: 12px;
              transition: background 0.2s;
            ">
              <span class="toggle-thumb" style="
                position: absolute;
                top: 2px;
                left: 2px;
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                transition: transform 0.2s;
                transform: translateX(\${boolDefault ? '20px' : '0'});
              "></span>
            </span>
            <span class="toggle-label" style="color: var(--text-secondary); font-size: 13px;">\${boolDefault ? 'Yes' : 'No'}</span>
          </label>
        \`;
      }

      // Number with optional min/max constraints
      if (type === 'number' || type === 'integer') {
        const min = schema.minimum !== undefined ? \`min="\${schema.minimum}"\` : '';
        const max = schema.maximum !== undefined ? \`max="\${schema.maximum}"\` : '';
        const step = type === 'integer' ? 'step="1"' : '';
        const defaultAttr = defaultValue !== undefined ? \`value="\${defaultValue}"\` : '';
        return \`<input type="number" name="\${key}" \${min} \${max} \${step} \${defaultAttr} \${isRequired ? 'required' : ''} />\`;
      }

      // Field names that should use textarea
      const textareaFields = ['code', 'source', 'script', 'content', 'body', 'message', 'query', 'sql', 'html', 'css', 'json', 'yaml', 'xml', 'markdown', 'text', 'template', 'prompt'];
      const keyLower = key.toLowerCase();
      const isTextareaField = textareaFields.some(f => keyLower === f || keyLower.endsWith(f) || keyLower.startsWith(f));

      // Textarea for long text, explicit textarea format, or code-related field names
      if (type === 'string' && (schema.maxLength > 200 || schema.format === 'textarea' || schema.format === 'multiline' || schema.field === 'textarea' || isTextareaField)) {
        const maxLength = schema.maxLength ? \`maxlength="\${schema.maxLength}"\` : '';
        const rows = isTextareaField ? '8' : '4';
        // Use custom {@placeholder} or generate default
        const placeholder = schema.placeholder || (defaultValue ? \`Default: \${defaultValue}\` : \`Enter \${key}...\`);
        return \`<textarea name="\${key}" \${maxLength} \${isRequired ? 'required' : ''} placeholder="\${placeholder}" rows="\${rows}" style="font-family: 'JetBrains Mono', monospace;">\${defaultValue || ''}</textarea>\`;
      }

      // Build attributes for string input
      const attrs = [];
      if (schema.minLength) attrs.push(\`minlength="\${schema.minLength}"\`);
      if (schema.maxLength) attrs.push(\`maxlength="\${schema.maxLength}"\`);
      if (schema.pattern) attrs.push(\`pattern="\${schema.pattern}"\`);
      if (defaultValue) attrs.push(\`value="\${defaultValue}"\`);

      // Use custom {@placeholder} or generate default with hint
      const placeholder = schema.placeholder || (defaultValue && !attrs.some(a => a.startsWith('value='))
        ? \`Default: \${defaultValue}\`
        : \`Enter \${key}...\`);

      // Special input types based on format or field
      let inputType = 'text';
      const formatOrField = schema.field || schema.format;
      if (formatOrField === 'email') inputType = 'email';
      else if (formatOrField === 'uri' || formatOrField === 'url') inputType = 'url';
      else if (formatOrField === 'date') inputType = 'date';
      else if (formatOrField === 'date-time' || formatOrField === 'datetime') inputType = 'datetime-local';
      else if (formatOrField === 'time') inputType = 'time';
      else if (formatOrField === 'password') inputType = 'password';
      else if (formatOrField === 'number') inputType = 'number';
      else if (formatOrField === 'hidden') inputType = 'hidden';

      // Detect path/file fields - add file browser
      const pathFields = ['path', 'filepath', 'file', 'filename', 'dir', 'directory', 'folder'];
      const isPathField = pathFields.some(f => keyLower === f || keyLower.endsWith(f) || keyLower.endsWith('path') || keyLower.endsWith('file')) || formatOrField === 'path' || formatOrField === 'file';

      if (isPathField) {
        return \`
          <div class="path-input-wrapper">
            <input type="text" name="\${key}" \${attrs.join(' ')} \${isRequired ? 'required' : ''} placeholder="\${placeholder}" />
            <button type="button" class="browse-btn" onclick="openFileBrowser('\${key}')">Browse</button>
          </div>
        \`;
      }

      return \`<input type="\${inputType}" name="\${key}" \${attrs.join(' ')} \${isRequired ? 'required' : ''} placeholder="\${placeholder}" />\`;
    }

    // Toggle boolean switch handler
    function toggleBoolean(label) {
      const checkbox = label.querySelector('input[type="checkbox"]');
      const track = label.querySelector('.toggle-track');
      const thumb = label.querySelector('.toggle-thumb');
      const labelText = label.querySelector('.toggle-label');

      // Toggle the checkbox
      checkbox.checked = !checkbox.checked;

      // Update visual state
      thumb.style.transform = checkbox.checked ? 'translateX(20px)' : 'translateX(0)';
      track.style.background = checkbox.checked ? 'var(--accent, #3b82f6)' : 'var(--bg-tertiary, #374151)';
      labelText.textContent = checkbox.checked ? 'Yes' : 'No';
    }

    function handleSubmit(e) {
      e.preventDefault();

      const formData = new FormData(e.target);
      const args = {};

      // Handle unchecked checkboxes (they don't appear in FormData)
      const booleanInputs = e.target.querySelectorAll('input[data-type="boolean"]');
      booleanInputs.forEach(input => {
        if (!formData.has(input.name)) {
          args[input.name] = false;
        }
      });

      for (const [key, value] of formData.entries()) {
        // Check if this is a JSON input (array/object field)
        const inputElement = e.target.querySelector(\`[name="\${key}"]\`);
        const isJsonInput = inputElement && inputElement.classList.contains('json-input');

        if (isJsonInput && value.trim()) {
          try {
            args[key] = JSON.parse(value);
          } catch (err) {
            showToast(\`Invalid JSON for "\${key}": \${err.message}\`, 'error');
            return;
          }
        }
        // Parse booleans and numbers
        else if (value === 'true') args[key] = true;
        else if (value === 'false') args[key] = false;
        else if (!isNaN(value) && value !== '') args[key] = parseFloat(value);
        else args[key] = value;
      }

      // Show progress overlay
      showProgress('Processing...');
      document.getElementById('result-container').classList.remove('visible');

      // Log activity
      addActivity('invoke', \`\${currentPhoton.name}.\${currentMethod.name}()\`);

      // Send invoke request
      ws.send(JSON.stringify({
        type: 'invoke',
        photon: currentPhoton.name,
        method: currentMethod.name,
        args
      }));
    }

    // Track pending interactive invocations (from custom HTML UIs)
    const pendingInteractiveInvocations = new Map();
    let invocationCounter = 0;

    // Global function for custom HTML UIs to invoke methods
    // Returns a Promise that resolves with the result
    window.invokePhotonMethod = function(photon, method, args) {
      const invocationId = 'inv_' + (++invocationCounter) + '_' + Date.now();

      return new Promise((resolve, reject) => {
        pendingInteractiveInvocations.set(invocationId, { resolve, reject });

        ws.send(JSON.stringify({
          type: 'invoke',
          photon: photon,
          method: method,
          args: args || {},
          invocationId: invocationId  // Track this invocation
        }));
      });
    };

    function showProgress(message, progress) {
      const overlay = document.getElementById('progress-overlay');
      const msgEl = document.getElementById('progress-message');
      const barContainer = document.getElementById('progress-bar-container');
      const barFill = document.getElementById('progress-bar-fill');
      const percentEl = document.getElementById('progress-percent');

      overlay.classList.add('visible');
      msgEl.textContent = message || 'Processing...';

      if (progress !== undefined) {
        const percent = Math.round(progress * 100);
        barContainer.style.display = 'block';
        barFill.style.width = percent + '%';
        percentEl.style.display = 'block';
        percentEl.textContent = percent + '%';
      } else {
        barContainer.style.display = 'none';
        percentEl.style.display = 'none';
      }
    }

    function hideProgress() {
      document.getElementById('progress-overlay').classList.remove('visible');
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container') || createToastContainer();
      const toast = document.createElement('div');
      toast.className = \`toast toast-\${type}\`;
      toast.textContent = message;
      container.appendChild(toast);

      // Trigger animation
      requestAnimationFrame(() => toast.classList.add('visible'));

      // Auto-remove after 3s
      setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    function createToastContainer() {
      const container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
      return container;
    }

    // File browser state
    let fileBrowserCallback = null;
    let fileBrowserCurrentPath = '';
    let fileBrowserSelectedPath = null;
    let fileBrowserRoot = null;

    async function openFileBrowser(inputId) {
      fileBrowserCallback = inputId;
      fileBrowserSelectedPath = null;
      fileBrowserRoot = null;
      document.getElementById('file-browser-select').disabled = true;
      document.getElementById('file-browser-overlay').classList.add('visible');

      let startPath = '';

      try {
        // Build API URL - include photon name if available
        const apiUrl = currentPhoton
          ? \`/api/photon-workdir?name=\${encodeURIComponent(currentPhoton.name)}\`
          : '/api/photon-workdir';

        const res = await fetch(apiUrl);
        const data = await res.json();

        if (data.workdir) {
          // Photon has a specific workdir constraint
          fileBrowserRoot = data.workdir;
          startPath = data.workdir;
        } else if (data.defaultWorkdir) {
          // Use the global working directory as default start path
          startPath = data.defaultWorkdir;
        }
      } catch (e) {
        // Ignore - will use default (current directory)
      }

      browsePath(startPath);
    }

    function closeFileBrowser() {
      document.getElementById('file-browser-overlay').classList.remove('visible');
      fileBrowserCallback = null;
      fileBrowserSelectedPath = null;
      fileBrowserRoot = null;
    }

    async function browsePath(dirPath) {
      try {
        let url = '/api/browse';
        const params = new URLSearchParams();
        if (dirPath) params.set('path', dirPath);
        if (fileBrowserRoot) params.set('root', fileBrowserRoot);
        if (params.toString()) url += '?' + params.toString();

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
          showToast(data.error, 'error');
          return;
        }

        fileBrowserCurrentPath = data.path;
        document.getElementById('file-browser-current-path').textContent = data.path;

        const list = document.getElementById('file-browser-list');
        list.innerHTML = data.items.map(item => \`
          <div class="file-browser-item \${item.isDirectory ? 'directory' : ''}"
               onclick="handleBrowserItemClick('\${item.path.replace(/'/g, "\\\\'")}', \${item.isDirectory})"
               ondblclick="handleBrowserItemDblClick('\${item.path.replace(/'/g, "\\\\'")}', \${item.isDirectory})">
            <span class="icon">\${item.isDirectory ? '📁' : '📄'}</span>
            <span class="name">\${item.name}</span>
          </div>
        \`).join('');
      } catch (error) {
        showToast('Failed to browse directory', 'error');
      }
    }

    function browseParent() {
      const parent = fileBrowserCurrentPath.split('/').slice(0, -1).join('/') || '/';
      // Don't go above root
      if (fileBrowserRoot && !parent.startsWith(fileBrowserRoot)) {
        showToast('Cannot navigate above allowed directory', 'warning');
        return;
      }
      browsePath(parent);
    }

    function handleBrowserItemClick(itemPath, isDirectory) {
      // Remove previous selection
      document.querySelectorAll('.file-browser-item.selected').forEach(el => el.classList.remove('selected'));

      // Select this item
      const items = document.querySelectorAll('.file-browser-item');
      items.forEach(el => {
        if (el.textContent.includes(itemPath.split('/').pop())) {
          el.classList.add('selected');
        }
      });

      fileBrowserSelectedPath = itemPath;
      document.getElementById('file-browser-select').disabled = false;
    }

    function handleBrowserItemDblClick(itemPath, isDirectory) {
      if (isDirectory) {
        browsePath(itemPath);
      } else {
        fileBrowserSelectedPath = itemPath;
        selectFile();
      }
    }

    function selectFile() {
      if (!fileBrowserSelectedPath || !fileBrowserCallback) return;

      const input = document.querySelector(\`input[name="\${fileBrowserCallback}"]\`);
      if (input) {
        input.value = fileBrowserSelectedPath;
      }

      closeFileBrowser();
    }

    function handleYield(data) {
      if (data.emit === 'status') {
        showProgress(data.message);
      } else if (data.emit === 'progress') {
        showProgress(data.message || 'Processing...', data.value || 0);
      } else if (data.emit === 'toast') {
        // Toast notification
        const type = data.type || 'info'; // success, error, warning, info
        showToast(data.message, type);
      } else if (data.emit === 'log') {
        // Log message - show as toast
        const level = data.level || 'info';
        const type = level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info';
        showToast(data.message, type);
      } else if (data.emit === 'thinking') {
        // Thinking indicator
        if (data.active) {
          showProgress('Thinking...');
        } else {
          hideProgress();
        }
      } else if (data.emit === 'stream') {
        // Stream data - append to result
        const content = document.getElementById('result-content');
        if (content && typeof data.data === 'string') {
          content.innerHTML += data.data;
        }
      }
    }

    function handleResult(message) {
      // Extract data and format info from message
      // Message can include: data, photon, method, outputFormat, layoutHints, invocationId
      const data = message.data;
      const invokedMethod = message.method;
      const invokedPhoton = message.photon;
      const invocationId = message.invocationId;

      // Check if this is a response to an interactive UI invocation
      // If so, resolve the promise and DON'T update the main UI
      if (invocationId && pendingInteractiveInvocations.has(invocationId)) {
        const { resolve } = pendingInteractiveInvocations.get(invocationId);
        pendingInteractiveInvocations.delete(invocationId);
        addActivity('result', \`\${invokedPhoton}.\${invokedMethod}() completed (interactive)\`);
        resolve(data);  // Resolve the promise with the result data
        return;  // Don't update the main UI - the interactive UI handles it
      }

      hideProgress();
      resetFilter(); // Clear filter when new result arrives
      addActivity('result', \`\${invokedPhoton || currentPhoton?.name}.\${invokedMethod || currentMethod?.name}() completed\`);

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');

      // Use format info from message if available, otherwise fall back to currentMethod
      // This allows custom HTML UIs (invokePhotonMethod) to get correct rendering
      const format = message.outputFormat ?? currentMethod?.outputFormat;
      const layoutHints = message.layoutHints ?? currentMethod?.layoutHints;

      // Check for custom UI template (highest priority) - only if method matches currentMethod
      if (!invokedMethod || invokedMethod === currentMethod?.name) {
        if (currentMethod?.linkedUi && currentPhoton?.name) {
          renderCustomUI(content, data, currentPhoton.name, currentMethod.linkedUi);
          document.getElementById('data-content').innerHTML = syntaxHighlightJson(data);
          return;
        }
      }

      // Handle mermaid diagrams (special async rendering)
      if (format === 'mermaid' && typeof data === 'string') {
        renderMermaid(content, data);
        document.getElementById('data-content').innerHTML = syntaxHighlightJson(data);
        return;
      }

      // Check if object has a 'diagram' field with mermaid content
      if (data && data.diagram && typeof data.diagram === 'string') {
        renderMermaid(content, data.diagram);
        document.getElementById('data-content').innerHTML = syntaxHighlightJson(data);
        return;
      }

      // Handle HTML format - render in sandboxed iframe with MCP-style postMessage bridge
      if (format === 'html' && typeof data === 'string') {
        renderHtmlContent(content, data, invokedPhoton || currentPhoton?.name);
        document.getElementById('data-content').innerHTML = \`<pre style="margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">\${escapeHtml(data)}</pre>\`;
        return;
      }

      // Use Smart Rendering System
      let result = null;
      try {
        result = renderSmartResult(data, format, layoutHints);
      } catch (err) {
        console.error('Smart rendering error:', err);
      }
      if (result) {
        content.innerHTML = result;
      } else {
        // Fallback to JSON
        content.innerHTML = \`<pre style="margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">\${escapeHtml(JSON.stringify(data, null, 2))}</pre>\`;
      }

      // Update data tab
      document.getElementById('data-content').innerHTML = syntaxHighlightJson(data);
    }

    async function renderMermaid(container, diagram) {
      const id = 'mermaid-' + Date.now();
      container.innerHTML = \`
        <div class="mermaid-container">
          <div class="mermaid-diagram" id="\${id}"></div>
          <div class="mermaid-actions">
            <button onclick="copyMermaidSource()" title="Copy diagram source">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
              </svg>
              Copy Source
            </button>
            <button onclick="zoomMermaid()" title="View full screen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"></path>
              </svg>
              Full Screen
            </button>
          </div>
        </div>
      \`;

      // Store source for copy functionality
      window.currentMermaidSource = diagram;

      try {
        const { svg } = await mermaid.render(id + '-svg', diagram);
        document.getElementById(id).innerHTML = svg;
      } catch (error) {
        container.innerHTML = \`
          <div style="color: var(--error); padding: 16px;">
            <strong>Mermaid render error:</strong> \${error.message}
            <pre style="margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 8px; overflow-x: auto;">\${diagram}</pre>
          </div>
        \`;
      }
    }

    // Render HTML content in a sandboxed iframe with MCP-style postMessage bridge
    function renderHtmlContent(container, htmlContent, photonName) {
      // Bridge script injected into the iframe
      // Provides window.mcp.callTool() that uses postMessage to communicate with parent
      const bridgeScript = \`
<script>
(function() {
  // MCP-style bridge for iframe communication
  window.mcp = {
    // Call a tool on the photon
    // Returns a Promise that resolves with the result
    callTool: function(toolName, args) {
      return new Promise(function(resolve, reject) {
        var callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Listen for response
        function handleResponse(event) {
          if (event.data && event.data.type === 'mcp:tool_result' && event.data.callId === callId) {
            window.removeEventListener('message', handleResponse);
            if (event.data.error) {
              reject(new Error(event.data.error));
            } else {
              resolve(event.data.result);
            }
          }
        }
        window.addEventListener('message', handleResponse);

        // Send tool call request to parent
        window.parent.postMessage({
          type: 'mcp:tool_call',
          callId: callId,
          photon: '\${photonName || ''}',
          tool: toolName,
          arguments: args || {}
        }, '*');

        // Timeout after 30 seconds
        setTimeout(function() {
          window.removeEventListener('message', handleResponse);
          reject(new Error('Tool call timeout'));
        }, 30000);
      });
    }
  };

  // Backwards compatibility: also expose as invokePhotonMethod
  window.invokePhotonMethod = function(photon, method, args) {
    return window.mcp.callTool(method, args);
  };
})();
<\\/script>
\`;

      // Inject bridge script before closing </head> or at start of content
      let modifiedHtml = htmlContent;
      if (htmlContent.includes('</head>')) {
        modifiedHtml = htmlContent.replace('</head>', bridgeScript + '</head>');
      } else if (htmlContent.includes('<body')) {
        modifiedHtml = htmlContent.replace('<body', bridgeScript + '<body');
      } else {
        // No head or body tag - prepend the script
        modifiedHtml = bridgeScript + htmlContent;
      }

      // Create blob URL for iframe
      const blob = new Blob([modifiedHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);

      // Render iframe
      container.innerHTML = \`
        <iframe
          src="\${blobUrl}"
          class="html-content-iframe"
          style="width: 100%; min-height: 400px; border: none; border-radius: 8px; background: white;"
          sandbox="allow-scripts allow-same-origin allow-forms"
          onload="this.style.height = Math.max(400, this.contentWindow.document.body.scrollHeight + 20) + 'px'"
        ></iframe>
      \`;

      // Clean up blob URL after iframe loads
      const iframe = container.querySelector('iframe');
      if (iframe) {
        iframe.addEventListener('load', () => {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        });
      }
    }

    function copyMermaidSource() {
      if (window.currentMermaidSource) {
        navigator.clipboard.writeText(window.currentMermaidSource);
        showToast('Diagram source copied', 'success');
      }
    }

    function zoomMermaid() {
      if (!window.currentMermaidSource) return;

      // Use the dedicated fullscreen container with proper controls
      const container = document.getElementById('mermaid-fullscreen-container');
      container.innerHTML = \`
        <div class="mermaid-fullscreen">
          <div class="mermaid-fullscreen-header">
            <div class="mermaid-fullscreen-controls">
              <button onclick="mermaidFsZoom(-0.2)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom Out
              </button>
              <div class="mermaid-fullscreen-zoom">
                <span id="mermaid-fs-zoom-level">100%</span>
              </div>
              <button onclick="mermaidFsZoom(0.2)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom In
              </button>
              <button onclick="mermaidFsReset()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
                Reset
              </button>
            </div>
            <button onclick="closeMermaidFullscreen()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Close
            </button>
          </div>
          <div class="mermaid-fullscreen-body" id="mermaid-fs-body">
            <div id="mermaid-fs-content"></div>
          </div>
        </div>
      \`;

      // Store fullscreen state
      window.mermaidFsState = { scale: 1, translateX: 0, translateY: 0, diagram: window.currentMermaidSource };

      // Render diagram
      mermaid.render('mermaid-fs-svg', window.currentMermaidSource).then(({ svg }) => {
        document.getElementById('mermaid-fs-content').innerHTML = svg;
        setupMermaidFsDrag();
      }).catch(e => {
        document.getElementById('mermaid-fs-content').innerHTML = \`<pre class="mermaid-error">\${escapeHtml(window.currentMermaidSource)}</pre>\`;
      });

      document.body.style.overflow = 'hidden';
    }

    async function renderCustomUI(container, data, photonName, uiId) {
      try {
        // Fetch the UI template
        const response = await fetch(\`/api/ui?photon=\${encodeURIComponent(photonName)}&id=\${encodeURIComponent(uiId)}\`);
        if (!response.ok) {
          throw new Error(\`Failed to load UI template: \${response.statusText}\`);
        }
        const template = await response.text();

        // Inject the data into the template
        // The template expects window.__PHOTON_DATA__ to be set
        const dataScript = '<scr' + 'ipt>window.__PHOTON_DATA__ = ' + JSON.stringify(data) + ';<\/scr' + 'ipt>';
        const modifiedTemplate = template.replace('</head>', dataScript + '</head>');

        // Create a blob URL for the iframe
        const blob = new Blob([modifiedTemplate], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);

        // Render in an iframe
        container.innerHTML = \`
          <iframe
            src="\${blobUrl}"
            class="custom-ui-iframe"
            style="width: 100%; height: 400px; border: none; border-radius: 8px; background: white;"
            onload="this.style.height = Math.max(400, this.contentWindow.document.body.scrollHeight + 20) + 'px'"
          ></iframe>
        \`;

        // Clean up blob URL after iframe loads
        const iframe = container.querySelector('iframe');
        iframe.addEventListener('load', () => {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        });
      } catch (error) {
        console.error('Failed to render custom UI:', error);
        container.innerHTML = \`
          <div class="error-message">
            <p>Failed to load custom UI: \${error.message}</p>
            <pre>\${JSON.stringify(data, null, 2)}</pre>
          </div>
        \`;
      }
    }

    function renderResultItem(item) {
      if (typeof item === 'string') {
        return \`<li>\${renderMarkdown(item)}</li>\`;
      }
      return \`<li><pre>\${JSON.stringify(item, null, 2)}</pre></li>\`;
    }

    // Check if object is a simple flat key-value (all values are primitives)
    function isSimpleKeyValueObject(obj) {
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
      const keys = Object.keys(obj);
      if (keys.length === 0 || keys.length > 20) return false; // Too empty or too large
      return keys.every(key => {
        const val = obj[key];
        return val === null || ['string', 'number', 'boolean'].includes(typeof val);
      });
    }

    // Render flat key-value object as a clean table
    function renderKeyValueTable(obj) {
      const rows = Object.entries(obj).map(([key, value]) => {
        let displayValue = value;
        let valueClass = '';
        if (typeof value === 'boolean') {
          displayValue = value ? '✓ Yes' : '✗ No';
          valueClass = value ? 'value-true' : 'value-false';
        } else if (value === null || value === undefined) {
          displayValue = '—';
          valueClass = 'value-null';
        } else if (typeof value === 'number') {
          valueClass = 'value-number';
        } else if (typeof value === 'object') {
          displayValue = JSON.stringify(value);
          valueClass = 'value-object';
        }
        return \`<tr><td class="kv-key">\${key}</td><td class="kv-value \${valueClass}">\${displayValue}</td></tr>\`;
      }).join('');
      return \`<table class="kv-table"><tbody>\${rows}</tbody></table>\`;
    }

    // Render array of objects as a grid table with columns
    function renderGridTable(data) {
      if (!data || data.length === 0) return '<p>No data</p>';

      // Get all unique keys from all objects
      const keys = [...new Set(data.flatMap(obj => Object.keys(obj)))];

      // Build header row
      const headerCells = keys.map(key => \`<th>\${key}</th>\`).join('');

      // Build data rows
      const rows = data.map(obj => {
        const cells = keys.map(key => {
          let value = obj[key];
          let cellClass = '';

          if (value === null || value === undefined) {
            value = '—';
            cellClass = 'value-null';
          } else if (typeof value === 'boolean') {
            value = value ? '✓' : '✗';
            cellClass = value === '✓' ? 'value-true' : 'value-false';
          } else if (typeof value === 'number') {
            cellClass = 'value-number';
          } else if (typeof value === 'object') {
            value = JSON.stringify(value);
            cellClass = 'value-object';
          }

          return \`<td class="\${cellClass}">\${value}</td>\`;
        }).join('');
        return \`<tr>\${cells}</tr>\`;
      }).join('');

      return \`<table class="grid-table"><thead><tr>\${headerCells}</tr></thead><tbody>\${rows}</tbody></table>\`;
    }

    function renderMarkdown(text) {
      let html = text;
      const mermaidBlocks = [];
      const codeBlocks = [];

      // Parse YAML front matter (between --- delimiters)
      const frontMatterMatch = html.match(/^---\\n([\\s\\S]*?)\\n---\\n?/);
      let frontMatterHtml = '';
      if (frontMatterMatch) {
        html = html.slice(frontMatterMatch[0].length);
        const yaml = frontMatterMatch[1];
        const rows = yaml.split('\\n')
          .filter(line => line.includes(':'))
          .map(line => {
            const idx = line.indexOf(':');
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            return \`<tr><td class="fm-key">\${key}</td><td class="fm-value">\${value}</td></tr>\`;
          })
          .join('');
        if (rows) {
          frontMatterHtml = \`<table class="front-matter">\${rows}</table>\`;
        }
      }

      // Extract mermaid blocks first
      html = html.replace(/\\\`\\\`\\\`mermaid\\n([\\s\\S]*?)\\\`\\\`\\\`/g, (match, diagram) => {
        const id = 'mermaid-inline-' + mermaidBlocks.length;
        const diagramTrimmed = diagram.trim();
        mermaidBlocks.push({ id, diagram: diagramTrimmed });
        return \`<div class="mermaid-wrapper">
          <div class="mermaid-toolbar">
            <button onclick="mermaidZoom('\${id}', 0.2)" title="Zoom in">+</button>
            <button onclick="mermaidZoom('\${id}', -0.2)" title="Zoom out">−</button>
            <button onclick="mermaidReset('\${id}')" title="Reset">↺</button>
            <button onclick="mermaidFullscreen('\${id}')" title="Fullscreen">⛶</button>
          </div>
          <div class="mermaid-inline" id="\${id}" data-diagram="\${encodeURIComponent(diagramTrimmed)}"></div>
        </div>\`;
      });

      // Extract other code blocks
      html = html.replace(/\\\`\\\`\\\`(\\w*)\\n([\\s\\S]*?)\\\`\\\`\\\`/g, (match, lang, code) => {
        const id = 'code-block-' + codeBlocks.length;
        codeBlocks.push({ id, lang, code: code.trim() });
        return \`<pre class="code-block" data-lang="\${lang || 'text'}"><code id="\${id}">\${escapeHtml(code.trim())}</code></pre>\`;
      });

      // Multi-column layout (:::columns ... ::: ... :::end)
      html = html.replace(/:::columns\\n([\\s\\S]*?):::end/g, (match, content) => {
        const columns = content.split(/\\n:::\\n/).map(col => col.trim());
        return \`<div class="md-columns md-columns-\${columns.length}">\${columns.map(c => \`<div class="md-column">\${c}</div>\`).join('')}</div>\`;
      });

      // Callout boxes (:::note, :::warning, :::tip, :::info)
      html = html.replace(/:::(note|warning|tip|info)\\n([\\s\\S]*?):::/g, (match, type, content) => {
        const icons = { note: '📝', warning: '⚠️', tip: '💡', info: 'ℹ️' };
        return \`<div class="md-callout md-callout-\${type}"><span class="md-callout-icon">\${icons[type]}</span><div class="md-callout-content">\${content.trim()}</div></div>\`;
      });

      // Tables (| header | header |)
      html = html.replace(/(\\|.+\\|\\n)+/g, (match) => {
        const rows = match.trim().split('\\n');
        if (rows.length < 2) return match;

        const parseRow = (row) => row.split('|').filter(c => c.trim()).map(c => c.trim());
        const headers = parseRow(rows[0]);
        const isSeparator = (row) => /^[\\s|:-]+$/.test(row);

        let headerHtml = \`<thead><tr>\${headers.map(h => \`<th>\${h}</th>\`).join('')}</tr></thead>\`;
        let bodyRows = rows.slice(isSeparator(rows[1]) ? 2 : 1);
        let bodyHtml = \`<tbody>\${bodyRows.map(row => \`<tr>\${parseRow(row).map(c => \`<td>\${c}</td>\`).join('')}</tr>\`).join('')}</tbody>\`;

        return \`<table class="md-table">\${headerHtml}\${bodyHtml}</table>\`;
      });

      // Horizontal rule
      html = html.replace(/^---$/gm, '<hr>');
      html = html.replace(/^\\*\\*\\*$/gm, '<hr>');

      // Unordered lists
      html = html.replace(/^(\\s*)[-*] (.+)$/gm, '$1<li>$2</li>');
      html = html.replace(/(<li>.+<\\/li>\\n?)+/g, '<ul>$&</ul>');

      // Ordered lists
      html = html.replace(/^(\\s*)\\d+\\. (.+)$/gm, '$1<li>$2</li>');

      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

      // Images
      html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img src="$2" alt="$1" class="md-image">');

      // Bold
      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

      // Italic
      html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

      // Strikethrough
      html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

      // Headers
      html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // Blockquotes (> at start of line)
      html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // Line breaks (double space or explicit)
      html = html.replace(/  \\n/g, '<br>');
      html = html.replace(/\\n\\n/g, '</p><p>');
      html = html.replace(/\\n/g, ' ');

      // Wrap in paragraph
      html = \`<p>\${html}</p>\`;
      html = html.replace(/<p><\\/p>/g, '');
      html = html.replace(/<p>(<h[1-4]>)/g, '$1');
      html = html.replace(/(<\\/h[1-4]>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<ul>)/g, '$1');
      html = html.replace(/(<\\/ul>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<table)/g, '$1');
      html = html.replace(/(<\\/table>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<div)/g, '$1');
      html = html.replace(/(<\\/div>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<pre)/g, '$1');
      html = html.replace(/(<\\/pre>)<\\/p>/g, '$1');
      html = html.replace(/<p>(<hr>)/g, '$1');
      html = html.replace(/(<hr>)<\\/p>/g, '$1');

      // Render mermaid blocks after DOM update
      if (mermaidBlocks.length > 0) {
        setTimeout(() => {
          mermaidBlocks.forEach(async ({ id, diagram }) => {
            const el = document.getElementById(id);
            if (el) {
              try {
                const { svg } = await mermaid.render(id + '-svg', diagram);
                el.innerHTML = svg;
              } catch (e) {
                el.innerHTML = \`<pre class="mermaid-error">\${escapeHtml(diagram)}</pre>\`;
              }
            }
          });
        }, 0);
      }

      return frontMatterHtml + html;
    }

    // Result viewer modal
    let resultViewerContent = '';

    function openResultViewer() {
      const content = document.getElementById('result-content').innerHTML;
      const viewerContent = document.getElementById('result-viewer-content');
      viewerContent.innerHTML = content;
      document.getElementById('result-viewer-modal').classList.add('visible');
      document.body.style.overflow = 'hidden';

      // Re-render mermaid diagrams in the viewer
      viewerContent.querySelectorAll('.mermaid-inline').forEach(el => {
        const diagram = decodeURIComponent(el.dataset.diagram || '');
        if (diagram) {
          mermaid.render(el.id + '-viewer-svg', diagram).then(({ svg }) => {
            el.innerHTML = svg;
          }).catch(e => {
            el.innerHTML = \`<pre class="mermaid-error">\${escapeHtml(diagram)}</pre>\`;
          });
        }
      });
    }

    function closeResultViewer() {
      document.getElementById('result-viewer-modal').classList.remove('visible');
      document.body.style.overflow = '';
    }

    // Mermaid zoom state per diagram
    const mermaidState = {};

    function getMermaidState(id) {
      if (!mermaidState[id]) {
        mermaidState[id] = { scale: 1, translateX: 0, translateY: 0 };
      }
      return mermaidState[id];
    }

    function mermaidZoom(id, delta) {
      const state = getMermaidState(id);
      state.scale = Math.max(0.2, Math.min(5, state.scale + delta));
      applyMermaidTransform(id);
    }

    function mermaidReset(id) {
      mermaidState[id] = { scale: 1, translateX: 0, translateY: 0 };
      applyMermaidTransform(id);
    }

    function applyMermaidTransform(id) {
      const state = getMermaidState(id);
      const el = document.getElementById(id);
      if (el) {
        const svg = el.querySelector('svg');
        if (svg) {
          svg.style.transform = \`translate(\${state.translateX}px, \${state.translateY}px) scale(\${state.scale})\`;
          svg.style.transformOrigin = 'center center';
        }
      }
    }

    function mermaidFullscreen(id) {
      const el = document.getElementById(id);
      if (!el) return;

      const diagram = decodeURIComponent(el.dataset.diagram || '');
      if (!diagram) return;

      const container = document.getElementById('mermaid-fullscreen-container');
      container.innerHTML = \`
        <div class="mermaid-fullscreen">
          <div class="mermaid-fullscreen-header">
            <div class="mermaid-fullscreen-controls">
              <button onclick="mermaidFsZoom(-0.2)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom Out
              </button>
              <div class="mermaid-fullscreen-zoom">
                <span id="mermaid-fs-zoom-level">100%</span>
              </div>
              <button onclick="mermaidFsZoom(0.2)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom In
              </button>
              <button onclick="mermaidFsReset()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
                Reset
              </button>
            </div>
            <button onclick="closeMermaidFullscreen()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Close
            </button>
          </div>
          <div class="mermaid-fullscreen-body" id="mermaid-fs-body">
            <div id="mermaid-fs-content"></div>
          </div>
        </div>
      \`;

      // Store fullscreen state
      window.mermaidFsState = { scale: 1, translateX: 0, translateY: 0, diagram };

      // Render diagram
      mermaid.render('mermaid-fs-svg', diagram).then(({ svg }) => {
        document.getElementById('mermaid-fs-content').innerHTML = svg;
        setupMermaidFsDrag();
      }).catch(e => {
        document.getElementById('mermaid-fs-content').innerHTML = \`<pre class="mermaid-error">\${escapeHtml(diagram)}</pre>\`;
      });

      document.body.style.overflow = 'hidden';
    }

    function closeMermaidFullscreen() {
      document.getElementById('mermaid-fullscreen-container').innerHTML = '';
      document.body.style.overflow = '';
    }

    // Event delegation for mermaid fullscreen controls
    document.getElementById('mermaid-fullscreen-container').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const text = btn.textContent.trim();
      if (text.includes('Close')) {
        closeMermaidFullscreen();
      } else if (text.includes('Zoom Out')) {
        mermaidFsZoom(-0.2);
      } else if (text.includes('Zoom In')) {
        mermaidFsZoom(0.2);
      } else if (text.includes('Reset')) {
        mermaidFsReset();
      }
    });

    // Event delegation for mermaid inline toolbar (zoom, reset, fullscreen buttons)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.mermaid-toolbar button');
      if (!btn) return;

      const wrapper = btn.closest('.mermaid-wrapper');
      if (!wrapper) return;

      const mermaidEl = wrapper.querySelector('.mermaid-inline');
      if (!mermaidEl) return;

      const id = mermaidEl.id;
      const title = btn.getAttribute('title') || '';

      if (title === 'Zoom in') {
        mermaidZoom(id, 0.2);
      } else if (title === 'Zoom out') {
        mermaidZoom(id, -0.2);
      } else if (title === 'Reset') {
        mermaidReset(id);
      } else if (title === 'Fullscreen') {
        mermaidFullscreen(id);
      }
    });

    function mermaidFsZoom(delta) {
      const state = window.mermaidFsState;
      state.scale = Math.max(0.1, Math.min(10, state.scale + delta));
      applyMermaidFsTransform();
      document.getElementById('mermaid-fs-zoom-level').textContent = Math.round(state.scale * 100) + '%';
    }

    function mermaidFsReset() {
      window.mermaidFsState = { ...window.mermaidFsState, scale: 1, translateX: 0, translateY: 0 };
      applyMermaidFsTransform();
      document.getElementById('mermaid-fs-zoom-level').textContent = '100%';
    }

    function applyMermaidFsTransform() {
      const state = window.mermaidFsState;
      const content = document.getElementById('mermaid-fs-content');
      if (content) {
        // Apply translate first (screen space), then scale from center
        content.style.transform = \`translate(\${state.translateX}px, \${state.translateY}px) scale(\${state.scale})\`;
      }
    }

    function setupMermaidFsDrag() {
      const body = document.getElementById('mermaid-fs-body');
      if (!body) return;

      let isDragging = false;
      let startX, startY, startTranslateX, startTranslateY;

      body.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return; // Don't drag when clicking buttons
        isDragging = true;
        body.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        startTranslateX = window.mermaidFsState.translateX;
        startTranslateY = window.mermaidFsState.translateY;
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        // Direct pixel translation (not scaled) for intuitive dragging
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        window.mermaidFsState.translateX = startTranslateX + dx;
        window.mermaidFsState.translateY = startTranslateY + dy;
        applyMermaidFsTransform();
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          body.classList.remove('dragging');
        }
      });

      // Mouse wheel zoom
      body.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        mermaidFsZoom(delta);
      }, { passive: false });
    }

    // ========== Image Fullscreen Viewer ==========
    window.imageFsState = { scale: 1, translateX: 0, translateY: 0 };

    function openImageFullscreen(src, alt) {
      const container = document.getElementById('image-fullscreen-container');
      container.innerHTML = \`
        <div class="mermaid-fullscreen">
          <div class="mermaid-fullscreen-header">
            <div class="mermaid-fullscreen-controls">
              <button data-action="zoom-out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom Out
              </button>
              <div class="mermaid-fullscreen-zoom">
                <span id="image-fs-zoom-level">100%</span>
              </div>
              <button data-action="zoom-in">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Zoom In
              </button>
              <button data-action="reset">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
                Reset
              </button>
            </div>
            <button data-action="close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Close
            </button>
          </div>
          <div class="mermaid-fullscreen-body" id="image-fs-body">
            <img id="image-fs-content" src="\${src}" alt="\${alt || ''}" style="transform: scale(1)">
          </div>
        </div>
      \`;

      window.imageFsState = { scale: 1, translateX: 0, translateY: 0 };
      document.body.style.overflow = 'hidden';
      setupImageFsDrag();
    }

    function closeImageFullscreen() {
      document.getElementById('image-fullscreen-container').innerHTML = '';
      document.body.style.overflow = '';
    }

    function imageFsZoom(delta) {
      const state = window.imageFsState;
      state.scale = Math.max(0.1, Math.min(10, state.scale + delta));
      applyImageFsTransform();
      const zoomEl = document.getElementById('image-fs-zoom-level');
      if (zoomEl) zoomEl.textContent = Math.round(state.scale * 100) + '%';
    }

    function imageFsReset() {
      window.imageFsState = { scale: 1, translateX: 0, translateY: 0 };
      applyImageFsTransform();
      const zoomEl = document.getElementById('image-fs-zoom-level');
      if (zoomEl) zoomEl.textContent = '100%';
    }

    function applyImageFsTransform() {
      const state = window.imageFsState;
      const img = document.getElementById('image-fs-content');
      if (img) {
        img.style.transform = \`translate(\${state.translateX}px, \${state.translateY}px) scale(\${state.scale})\`;
      }
    }

    function setupImageFsDrag() {
      const body = document.getElementById('image-fs-body');
      if (!body) return;

      let isDragging = false;
      let startX, startY, startTranslateX, startTranslateY;

      body.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        body.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        startTranslateX = window.imageFsState.translateX;
        startTranslateY = window.imageFsState.translateY;
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        window.imageFsState.translateX = startTranslateX + dx;
        window.imageFsState.translateY = startTranslateY + dy;
        applyImageFsTransform();
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          body.classList.remove('dragging');
        }
      });

      body.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        imageFsZoom(delta);
      }, { passive: false });
    }

    // Event delegation for image fullscreen controls
    document.getElementById('image-fullscreen-container').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'close') {
        closeImageFullscreen();
      } else if (action === 'zoom-out') {
        imageFsZoom(-0.2);
      } else if (action === 'zoom-in') {
        imageFsZoom(0.2);
      } else if (action === 'reset') {
        imageFsReset();
      }
    });

    // Click on images to open fullscreen
    document.addEventListener('click', (e) => {
      const img = e.target.closest('.md-image');
      if (img) {
        openImageFullscreen(img.src, img.alt);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

      // Escape - close modals/search
      if (e.key === 'Escape') {
        if (document.getElementById('image-fullscreen-container').innerHTML) {
          closeImageFullscreen();
        } else if (document.getElementById('mermaid-fullscreen-container').innerHTML) {
          closeMermaidFullscreen();
        } else if (document.getElementById('result-viewer-modal').classList.contains('visible')) {
          closeResultViewer();
        } else if (document.getElementById('keyboard-help-modal')?.classList.contains('visible')) {
          document.getElementById('keyboard-help-modal').classList.remove('visible');
        } else if (isInput && target.id === 'search-input') {
          target.value = '';
          target.dispatchEvent(new Event('input'));
          target.blur();
        }
        return;
      }

      // Shortcuts that work even in inputs
      // Ctrl/Cmd+Enter - Submit form
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const form = document.getElementById('invoke-form');
        if (form) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
        return;
      }

      // Ctrl/Cmd+K or / - Focus search (unless in input)
      if (((e.ctrlKey || e.metaKey) && e.key === 'k') || (e.key === '/' && !isInput)) {
        e.preventDefault();
        document.getElementById('search-input').focus();
        return;
      }

      // Don't process other shortcuts when in input
      if (isInput) return;

      // ? - Show keyboard help
      if (e.key === '?' && !hasModifier) {
        e.preventDefault();
        toggleKeyboardHelp();
        return;
      }

      // Arrow keys - navigate methods
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        navigateMethods(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1);
        return;
      }

      // Enter - select highlighted method
      if (e.key === 'Enter') {
        const highlighted = document.querySelector('.method-item.highlighted');
        if (highlighted) {
          highlighted.click();
        }
        return;
      }

      // r - Reload/re-execute current method
      if (e.key === 'r' && !hasModifier && currentMethod) {
        e.preventDefault();
        const form = document.getElementById('invoke-form');
        if (form) {
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
        return;
      }
    });

    // Method navigation state
    let highlightedMethodIndex = -1;

    function navigateMethods(direction) {
      const methodItems = Array.from(document.querySelectorAll('.method-item:not([style*="display: none"])'));
      if (methodItems.length === 0) return;

      // Clear previous highlight
      document.querySelectorAll('.method-item.highlighted').forEach(el => el.classList.remove('highlighted'));

      // Calculate new index
      if (highlightedMethodIndex === -1) {
        // Start from current selection or first item
        const selected = document.querySelector('.method-item.selected');
        highlightedMethodIndex = selected ? methodItems.indexOf(selected) : -1;
      }

      highlightedMethodIndex += direction;

      // Wrap around
      if (highlightedMethodIndex >= methodItems.length) highlightedMethodIndex = 0;
      if (highlightedMethodIndex < 0) highlightedMethodIndex = methodItems.length - 1;

      // Highlight and scroll into view
      const item = methodItems[highlightedMethodIndex];
      if (item) {
        item.classList.add('highlighted');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    // ========== Output Filtering ==========
    let lastResultContent = '';

    function filterResults(event) {
      const query = event.target.value.toLowerCase().trim();
      const content = document.getElementById('result-content');
      const countEl = document.getElementById('result-filter-count');

      // Store original content on first filter
      if (!lastResultContent && content.innerHTML) {
        lastResultContent = content.innerHTML;
      }

      if (!query) {
        // Reset to original content
        if (lastResultContent) {
          content.innerHTML = lastResultContent;
        }
        countEl.style.display = 'none';
        return;
      }

      // Filter different types of content (including smart rendering components)
      const tables = content.querySelectorAll('table tbody tr');
      const listItems = content.querySelectorAll('ul li, ol li');
      const kvRows = content.querySelectorAll('.kv-table .kv-row');
      // Smart rendering elements
      const smartListItems = content.querySelectorAll('.list-item');
      const smartCardRows = content.querySelectorAll('.smart-card-row');
      const smartGridItems = content.querySelectorAll('.grid-item');
      const smartChips = content.querySelectorAll('.chip');

      let totalCount = 0;
      let matchCount = 0;

      // Helper to filter elements
      const filterElements = (elements) => {
        elements.forEach(el => {
          totalCount++;
          const text = el.textContent?.toLowerCase() || '';
          if (text.includes(query)) {
            el.classList.remove('filter-hidden');
            matchCount++;
          } else {
            el.classList.add('filter-hidden');
          }
        });
      };

      // Filter all element types
      filterElements(tables);
      filterElements(listItems);
      filterElements(kvRows);
      filterElements(smartListItems);
      filterElements(smartCardRows);
      filterElements(smartGridItems);
      filterElements(smartChips);

      // Show count if filtering is active
      if (totalCount > 0) {
        countEl.textContent = \`\${matchCount} of \${totalCount}\`;
        countEl.style.display = 'block';
      } else {
        // For plain text/JSON, just check if query is found
        const text = content.textContent?.toLowerCase() || '';
        if (text.includes(query)) {
          countEl.textContent = 'Match found';
          countEl.style.display = 'block';
        } else {
          countEl.textContent = 'No matches';
          countEl.style.display = 'block';
        }
      }
    }

    // Reset filter when result changes
    function resetFilter() {
      lastResultContent = '';
      const filterInput = document.getElementById('result-filter');
      if (filterInput) {
        filterInput.value = '';
      }
      const countEl = document.getElementById('result-filter-count');
      if (countEl) {
        countEl.style.display = 'none';
      }
    }

    function toggleKeyboardHelp() {
      let modal = document.getElementById('keyboard-help-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'keyboard-help-modal';
        modal.className = 'modal';
        modal.innerHTML = \`
          <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
              <h2>Keyboard Shortcuts</h2>
              <button class="close-btn" onclick="document.getElementById('keyboard-help-modal').classList.remove('visible')">&times;</button>
            </div>
            <div class="modal-body" style="padding: 16px;">
              <div style="display: grid; gap: 12px;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Search</span>
                  <span><kbd>/</kbd> or <kbd>⌘K</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Navigate methods</span>
                  <span><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Select method</span>
                  <span><kbd>Enter</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Submit form</span>
                  <span><kbd>⌘Enter</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Re-run method</span>
                  <span><kbd>r</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Close / Clear</span>
                  <span><kbd>Esc</kbd></span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--text-secondary);">Show shortcuts</span>
                  <span><kbd>?</kbd></span>
                </div>
              </div>
            </div>
          </div>
        \`;
        document.body.appendChild(modal);
      }
      modal.classList.toggle('visible');
    }

    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function syntaxHighlightJson(json) {
      if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
      }
      // Simple token-based highlighting
      var result = '';
      var i = 0;
      while (i < json.length) {
        var ch = json[i];

        // String (key or value)
        if (ch === '"') {
          var start = i;
          i++;
          while (i < json.length && (json[i] !== '"' || json[i-1] === String.fromCharCode(92))) i++;
          i++; // include closing quote
          var str = json.substring(start, i);
          // Check if it's a key (followed by :)
          var rest = json.substring(i).trimStart();
          if (rest[0] === ':') {
            result += '<span class="json-key">' + escapeHtml(str) + '</span>';
          } else {
            result += '<span class="json-string">' + escapeHtml(str) + '</span>';
          }
        }
        // Number
        else if (ch === '-' || (ch >= '0' && ch <= '9')) {
          var start = i;
          while (i < json.length && /[0-9.eE+-]/.test(json[i])) i++;
          result += '<span class="json-number">' + escapeHtml(json.substring(start, i)) + '</span>';
        }
        // true/false/null
        else if (json.substring(i, i+4) === 'true') {
          result += '<span class="json-boolean">true</span>';
          i += 4;
        }
        else if (json.substring(i, i+5) === 'false') {
          result += '<span class="json-boolean">false</span>';
          i += 5;
        }
        else if (json.substring(i, i+4) === 'null') {
          result += '<span class="json-null">null</span>';
          i += 4;
        }
        // Whitespace and punctuation
        else {
          result += escapeHtml(ch);
          i++;
        }
      }
      return result;
    }

    function handleError(message) {
      hideProgress();
      resetFilter(); // Clear filter on error
      addActivity('error', message);

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');
      content.innerHTML = \`
        <div style="color: var(--error); display: flex; align-items: flex-start; gap: 12px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <div>
            <strong style="display: block; margin-bottom: 4px;">Error</strong>
            <span style="color: var(--text-secondary);">\${message}</span>
          </div>
        </div>
      \`;
    }

    function showElicitation(data) {
      const modal = document.getElementById('elicitation-modal');
      const title = document.getElementById('elicitation-title');
      const form = document.getElementById('elicitation-form');

      title.textContent = data.message || 'Input Required';

      // Render elicitation form based on ask type
      let html = '';

      if (data.ask === 'text' || data.ask === 'password') {
        const inputType = data.ask === 'password' ? 'password' : 'text';
        html = \`
          <div class="form-group">
            <input type="\${inputType}" id="elicitation-input" placeholder="\${data.placeholder || ''}" value="\${data.default || ''}" />
          </div>
        \`;
      } else if (data.ask === 'select') {
        const opts = data.options || [];
        const isMulti = data.multi === true;
        const layout = data.layout || 'list';
        const columns = data.columns || 2;
        const filters = data.filters || [];
        const filterField = data.filterField || 'category';
        const searchable = data.searchable === true;
        const searchPlaceholder = data.searchPlaceholder || 'Search...';

        // Check if options have rich fields (image, price, etc.)
        const hasRichOptions = opts.some(opt =>
          typeof opt === 'object' && (opt.image || opt.price !== undefined)
        );

        // Check if any options are adjustable (have quantity controls)
        const hasAdjustable = opts.some(opt =>
          typeof opt === 'object' && opt.adjustable === true
        );

        if (hasRichOptions || isMulti) {
          // Render as rich card/list layout with checkboxes
          const gridStyle = layout === 'grid' || layout === 'cards'
            ? \`display: grid; grid-template-columns: repeat(\${columns}, 1fr); gap: 12px;\`
            : '';

          // Build filter buttons HTML
          let filtersHtml = '';
          if (filters.length > 0) {
            const filterBtns = filters.map((f, i) => \`
              <button type="button" class="filter-btn \${i === 0 ? 'active' : ''}" data-filter="\${f}" onclick="filterSelectOptions(this, '\${filterField}')"
                      style="padding: 6px 12px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 16px; background: \${i === 0 ? 'var(--accent, #3b82f6)' : 'var(--bg-secondary, #fff)'}; color: \${i === 0 ? 'white' : 'var(--text-primary, #1f2937)'}; cursor: pointer; font-size: 13px;">
                \${f}
              </button>
            \`).join('');
            filtersHtml = \`<div class="select-filters" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">\${filterBtns}</div>\`;
          }

          // Build search box HTML
          let searchHtml = '';
          if (searchable) {
            searchHtml = \`
              <div class="select-search" style="margin-bottom: 12px;">
                <input type="text" id="select-search-input" placeholder="\${searchPlaceholder}" oninput="searchSelectOptions(this.value)"
                       style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; font-size: 14px;" />
              </div>
            \`;
          }

          const optionsHtml = opts.map((opt, idx) => {
            const value = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? opt : opt.label;
            const desc = typeof opt === 'object' ? opt.description : '';
            const image = typeof opt === 'object' ? opt.image : '';
            const price = typeof opt === 'object' ? opt.price : undefined;
            const originalPrice = typeof opt === 'object' ? opt.originalPrice : undefined;
            const currency = typeof opt === 'object' ? (opt.currency || 'USD') : 'USD';
            const badge = typeof opt === 'object' ? opt.badge : '';
            const badgeType = typeof opt === 'object' ? (opt.badgeType || 'default') : 'default';
            const quantity = typeof opt === 'object' ? opt.quantity : undefined;
            const adjustable = typeof opt === 'object' ? opt.adjustable === true : false;
            const minQty = typeof opt === 'object' ? (opt.minQuantity ?? 1) : 1;
            const maxQty = typeof opt === 'object' ? (opt.maxQuantity ?? 99) : 99;
            const disabled = typeof opt === 'object' ? opt.disabled : false;
            const disabledReason = typeof opt === 'object' ? opt.disabledReason : '';
            const selected = typeof opt === 'object' ? opt.selected : false;
            const category = typeof opt === 'object' ? opt.category : '';
            const inputType = isMulti ? 'checkbox' : 'radio';

            // Get category as string for data attribute
            const categoryStr = Array.isArray(category) ? category.join(',') : (category || '');

            const badgeColors = {
              default: '#6b7280',
              success: '#22c55e',
              warning: '#f59e0b',
              error: '#ef4444',
              info: '#3b82f6'
            };

            const formatPrice = (p, curr) => {
              return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(p);
            };

            // Quantity controls HTML
            let qtyControlsHtml = '';
            if (adjustable && quantity !== undefined) {
              qtyControlsHtml = \`
                <div class="qty-controls" style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                  <button type="button" class="qty-btn" onclick="adjustQuantity('\${value}', -1, \${minQty}, \${maxQty}); event.stopPropagation();"
                          style="width: 28px; height: 28px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; background: var(--bg-secondary, #fff); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">−</button>
                  <span class="qty-value" data-value="\${value}" style="min-width: 24px; text-align: center; font-weight: 500;">\${quantity}</span>
                  <button type="button" class="qty-btn" onclick="adjustQuantity('\${value}', 1, \${minQty}, \${maxQty}); event.stopPropagation();"
                          style="width: 28px; height: 28px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; background: var(--bg-secondary, #fff); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">+</button>
                </div>
              \`;
            } else if (quantity !== undefined) {
              qtyControlsHtml = \`<span style="font-size: 12px; color: #6b7280;">×\${quantity}</span>\`;
            }

            return \`
              <label class="rich-option \${disabled ? 'disabled' : ''} \${layout === 'cards' ? 'card-layout' : ''}"
                     data-value="\${value}" data-label="\${label}" data-category="\${categoryStr}"
                     style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; cursor: \${disabled ? 'not-allowed' : 'pointer'}; background: \${disabled ? '#f3f4f6' : 'var(--bg-secondary, #fff)'}; opacity: \${disabled ? '0.6' : '1'};">
                <input type="\${inputType}" name="elicitation-select" value="\${value}"
                       \${selected ? 'checked' : ''} \${disabled ? 'disabled' : ''}
                       style="margin-top: 4px; width: 18px; height: 18px;" />
                \${image ? \`<img src="\${image}" alt="\${label}" style="width: 64px; height: 64px; object-fit: cover; border-radius: 6px; flex-shrink: 0;" />\` : ''}
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-weight: 500; color: var(--text-primary, #1f2937);">\${label}</span>
                    \${badge ? \`<span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: \${badgeColors[badgeType]}; color: white;">\${badge}</span>\` : ''}
                    \${!adjustable && quantity !== undefined ? \`<span style="font-size: 12px; color: #6b7280;">×\${quantity}</span>\` : ''}
                  </div>
                  \${desc ? \`<div style="font-size: 13px; color: #6b7280; margin-top: 2px;">\${desc}</div>\` : ''}
                  \${disabled && disabledReason ? \`<div style="font-size: 12px; color: #ef4444; margin-top: 2px;">\${disabledReason}</div>\` : ''}
                  \${price !== undefined ? \`
                    <div style="margin-top: 4px;">
                      <span style="font-weight: 600; color: var(--text-primary, #1f2937);">\${formatPrice(price, currency)}</span>
                      \${originalPrice !== undefined ? \`<span style="font-size: 13px; color: #9ca3af; text-decoration: line-through; margin-left: 6px;">\${formatPrice(originalPrice, currency)}</span>\` : ''}
                    </div>
                  \` : ''}
                  \${adjustable && quantity !== undefined ? qtyControlsHtml : ''}
                </div>
              </label>
            \`;
          }).join('');

          html = \`
            \${filtersHtml}
            \${searchHtml}
            <div class="form-group rich-select" id="rich-select-options" style="\${gridStyle}">
              \${optionsHtml}
            </div>
          \`;
        } else {
          // Simple dropdown for basic options
          const selectOptions = opts.map(opt => {
            const value = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? opt : opt.label;
            return \`<option value="\${value}">\${label}</option>\`;
          }).join('');
          html = \`
            <div class="form-group">
              <select id="elicitation-input">\${selectOptions}</select>
            </div>
          \`;
        }
      } else if (data.ask === 'confirm') {
        html = \`
          <div class="form-group" style="display: flex; gap: 10px;">
            <button class="btn" onclick="submitElicitationValue(true)" style="background: #4caf50;">Yes</button>
            <button class="btn" onclick="submitElicitationValue(false)" style="background: #f44336;">No</button>
          </div>
        \`;
        form.innerHTML = html;
        modal.classList.add('visible');
        return;
      } else if (data.ask === 'number') {
        html = \`
          <div class="form-group">
            <input type="number" id="elicitation-input"
              \${data.min !== undefined ? \`min="\${data.min}"\` : ''}
              \${data.max !== undefined ? \`max="\${data.max}"\` : ''}
              \${data.step !== undefined ? \`step="\${data.step}"\` : ''}
              value="\${data.default || ''}" />
          </div>
        \`;
      } else if (data.ask === 'oauth') {
        // OAuth authorization required
        const providerIcons = {
          google: '🔵',
          github: '⚫',
          microsoft: '🟦',
          slack: '💜',
          notion: '⬛',
          linear: '🟣',
          default: '🔐'
        };
        const icon = providerIcons[data.provider?.toLowerCase()] || providerIcons.default;
        const scopes = (data.scopes || []).join(', ') || 'basic access';

        html = \`
          <div class="oauth-provider">
            <div class="oauth-provider-icon">\${icon}</div>
            <div class="oauth-provider-info">
              <div class="oauth-provider-name">\${data.provider || 'OAuth Provider'}</div>
              <div class="oauth-scopes">Scopes: \${scopes}</div>
            </div>
          </div>
          <p style="color: var(--text-secondary); margin-bottom: 16px;">
            This tool requires authorization to access \${data.provider || 'an external service'}.
            Click the button below to authorize in a new window.
          </p>
          <div id="oauth-status" class="oauth-status waiting" style="display: none;">
            <div class="oauth-spinner"></div>
            <span>Waiting for authorization...</span>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 16px;">
            <button class="btn" onclick="startOAuthFlow('\${data.url || data.elicitationUrl || ''}', '\${data.elicitationId || ''}')" style="background: var(--accent);">
              Authorize \${data.provider || ''}
            </button>
            <button class="btn" onclick="cancelOAuth()" style="background: var(--bg-tertiary);">
              Cancel
            </button>
          </div>
        \`;
        form.innerHTML = html;
        modal.classList.add('visible');

        // Store pending OAuth data for retry
        window._pendingOAuth = {
          photon: data.photon,
          method: data.method,
          params: data.params,
          elicitationId: data.elicitationId
        };
        return;
      }

      html += \`<button class="btn" onclick="submitElicitation()">Submit</button>\`;

      form.innerHTML = html;
      modal.classList.add('visible');
    }

    // Helper: Show confirmation dialog using web UI (not native confirm())
    let _confirmCallback = null;
    function showConfirmDialog(message, onConfirm) {
      const modal = document.getElementById('elicitation-modal');
      const title = document.getElementById('elicitation-title');
      const form = document.getElementById('elicitation-form');

      title.textContent = message;
      _confirmCallback = onConfirm;

      form.innerHTML = \`
        <div class="form-group" style="display: flex; gap: 10px; justify-content: flex-end;">
          <button class="btn" onclick="handleConfirmDialog(false)" style="background: var(--bg-tertiary); color: var(--text-primary);">Cancel</button>
          <button class="btn" onclick="handleConfirmDialog(true)" style="background: var(--accent);">Confirm</button>
        </div>
      \`;
      modal.classList.add('visible');
    }

    function handleConfirmDialog(confirmed) {
      document.getElementById('elicitation-modal').classList.remove('visible');
      if (confirmed && _confirmCallback) {
        _confirmCallback();
      }
      _confirmCallback = null;
    }

    // Helper: Show toast notification instead of alert()
    function showToast(message, type = 'error') {
      const colors = {
        error: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
        info: '#3b82f6'
      };
      const toast = document.createElement('div');
      toast.className = 'toast-notification';
      toast.style.cssText = \`
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        background: \${colors[type] || colors.error};
        color: white;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10001;
        animation: slideIn 0.3s ease;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      \`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    function submitElicitationValue(value) {
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value
      }));
      document.getElementById('elicitation-modal').classList.remove('visible');
    }

    function submitElicitation() {
      let value;

      // Check for regular input first
      const input = document.getElementById('elicitation-input');
      if (input) {
        value = input.value;
      } else {
        // Check for rich select (radio/checkbox inputs)
        const checkboxes = document.querySelectorAll('input[name="elicitation-select"]:checked');
        if (checkboxes.length > 0) {
          const values = Array.from(checkboxes).map(cb => cb.value);
          // If single radio, return single value; if multi checkbox, return array
          const isMulti = document.querySelector('input[name="elicitation-select"][type="checkbox"]') !== null;
          value = isMulti ? values : values[0];
        }
      }

      // Include quantity adjustments if any were made
      const quantities = window._selectQuantities || {};
      const hasQuantities = Object.keys(quantities).length > 0;

      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value,
        ...(hasQuantities && { quantities })
      }));

      // Clear quantity tracking
      window._selectQuantities = {};

      document.getElementById('elicitation-modal').classList.remove('visible');
    }

    // Track quantity adjustments for rich select
    window._selectQuantities = {};

    function filterSelectOptions(btn, filterField) {
      // Update button styles
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.style.background = 'var(--bg-secondary, #fff)';
        b.style.color = 'var(--text-primary, #1f2937)';
        b.classList.remove('active');
      });
      btn.style.background = 'var(--accent, #3b82f6)';
      btn.style.color = 'white';
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      const options = document.querySelectorAll('.rich-option');

      options.forEach(opt => {
        const category = opt.dataset.category || '';
        const categories = category.split(',');

        // 'All' shows everything, otherwise check if category matches
        if (filter === 'All' || categories.some(c => c.toLowerCase().includes(filter.toLowerCase()))) {
          opt.style.display = '';
        } else {
          opt.style.display = 'none';
        }
      });
    }

    function searchSelectOptions(query) {
      const normalizedQuery = query.toLowerCase().trim();
      const options = document.querySelectorAll('.rich-option');

      options.forEach(opt => {
        const label = (opt.dataset.label || '').toLowerCase();
        const category = (opt.dataset.category || '').toLowerCase();

        if (!normalizedQuery || label.includes(normalizedQuery) || category.includes(normalizedQuery)) {
          opt.style.display = '';
        } else {
          opt.style.display = 'none';
        }
      });
    }

    function adjustQuantity(value, delta, minQty, maxQty) {
      const qtySpan = document.querySelector(\`.qty-value[data-value="\${value}"]\`);
      if (!qtySpan) return;

      let currentQty = parseInt(qtySpan.textContent, 10) || 1;
      let newQty = currentQty + delta;

      // Clamp to min/max
      newQty = Math.max(minQty, Math.min(maxQty, newQty));
      qtySpan.textContent = newQty;

      // Store in global tracking object
      window._selectQuantities[value] = newQty;

      // If quantity is 0 and minQty allows removal, uncheck the item
      if (newQty === 0) {
        const checkbox = document.querySelector(\`input[name="elicitation-select"][value="\${value}"]\`);
        if (checkbox) {
          checkbox.checked = false;
        }
      }
    }

    // OAuth flow handling
    let oauthPopup = null;
    let oauthCheckInterval = null;

    function startOAuthFlow(url, elicitationId) {
      if (!url) {
        showError('No authorization URL provided');
        return;
      }

      // Show waiting status
      const statusEl = document.getElementById('oauth-status');
      if (statusEl) {
        statusEl.style.display = 'flex';
        statusEl.className = 'oauth-status waiting';
        statusEl.innerHTML = '<div class="oauth-spinner"></div><span>Waiting for authorization...</span>';
      }

      // Open popup
      const width = 500;
      const height = 700;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;

      oauthPopup = window.open(
        url,
        'oauth_popup',
        \`width=\${width},height=\${height},left=\${left},top=\${top},toolbar=no,menubar=no\`
      );

      if (!oauthPopup) {
        showError('Popup was blocked. Please allow popups for this site.');
        return;
      }

      // Listen for OAuth callback message
      const messageHandler = (event) => {
        // Accept messages from OAuth callback
        if (event.data && event.data.type === 'oauth_callback') {
          window.removeEventListener('message', messageHandler);
          clearInterval(oauthCheckInterval);

          if (event.data.success) {
            handleOAuthSuccess(elicitationId);
          } else {
            handleOAuthError(event.data.error || 'Authorization failed');
          }
        }
      };
      window.addEventListener('message', messageHandler);

      // Also check if popup was closed manually
      oauthCheckInterval = setInterval(() => {
        if (oauthPopup && oauthPopup.closed) {
          clearInterval(oauthCheckInterval);
          window.removeEventListener('message', messageHandler);

          // Popup closed - assume success and retry (grant may have been created)
          handleOAuthSuccess(elicitationId);
        }
      }, 500);
    }

    function handleOAuthSuccess(elicitationId) {
      const statusEl = document.getElementById('oauth-status');
      if (statusEl) {
        statusEl.className = 'oauth-status success';
        statusEl.innerHTML = '✓ Authorization successful! Retrying...';
      }

      // Close modal and retry the tool call
      setTimeout(() => {
        document.getElementById('elicitation-modal').classList.remove('visible');

        // Notify server that OAuth is complete
        ws.send(JSON.stringify({
          type: 'oauth_complete',
          elicitationId: elicitationId,
          success: true
        }));

        // Retry the pending operation if we have it
        if (window._pendingOAuth) {
          const { photon, method, params } = window._pendingOAuth;
          if (photon && method) {
            // Re-invoke the tool
            ws.send(JSON.stringify({
              type: 'invoke',
              photon,
              method,
              params: params || {}
            }));
          }
          window._pendingOAuth = null;
        }
      }, 1000);
    }

    function handleOAuthError(error) {
      const statusEl = document.getElementById('oauth-status');
      if (statusEl) {
        statusEl.className = 'oauth-status error';
        statusEl.innerHTML = \`✗ \${error}\`;
      }
    }

    function cancelOAuth() {
      if (oauthPopup && !oauthPopup.closed) {
        oauthPopup.close();
      }
      if (oauthCheckInterval) {
        clearInterval(oauthCheckInterval);
      }

      document.getElementById('elicitation-modal').classList.remove('visible');
      window._pendingOAuth = null;

      // Notify server of cancellation
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value: null,
        cancelled: true
      }));
    }

    // Tab switching for method view
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        const tabsContainer = tab.parentElement;

        tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('#method-view .tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(\`\${tabName}-panel\`).classList.add('active');
      });
    });

    // Tab switching for config view
    document.querySelectorAll('.tab[data-config-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.configTab;
        const tabsContainer = tab.parentElement;

        tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('#config-view .tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(\`config-\${tabName}-panel\`).classList.add('active');

        // Populate JSON textarea when switching to JSON tab
        if (tabName === 'json' && currentPhoton) {
          updateConfigJson();
        }
      });
    });

    // Listen for MCP-style postMessage tool calls from iframes
    // This allows HTML UIs rendered in iframes to call photon methods
    window.addEventListener('message', function(event) {
      // Only handle mcp:tool_call messages
      if (!event.data || event.data.type !== 'mcp:tool_call') return;

      const { callId, photon, tool, arguments: args } = event.data;
      const targetPhoton = photon || currentPhoton?.name;

      if (!targetPhoton || !tool) {
        // Send error back to iframe
        event.source?.postMessage({
          type: 'mcp:tool_result',
          callId: callId,
          error: 'Missing photon or tool name'
        }, '*');
        return;
      }

      // Generate invocation ID for tracking
      const invocationId = 'iframe_' + callId;

      // Track this as an interactive invocation so result doesn't replace UI
      pendingInteractiveInvocations.set(invocationId, {
        resolve: function(result) {
          // Send result back to iframe
          event.source?.postMessage({
            type: 'mcp:tool_result',
            callId: callId,
            result: result
          }, '*');
        },
        reject: function(error) {
          event.source?.postMessage({
            type: 'mcp:tool_result',
            callId: callId,
            error: error.message || String(error)
          }, '*');
        }
      });

      // Send invoke request via WebSocket
      ws.send(JSON.stringify({
        type: 'invoke',
        photon: targetPhoton,
        method: tool,
        args: args || {},
        invocationId: invocationId
      }));
    });

    // Connect on load
    connect();
  </script>
</body>
</html>`;
}
