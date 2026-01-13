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
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { toEnvVarName } from '../shared/config-docs.js';
import {
  SchemaExtractor,
  type PhotonYield,
  type OutputHandler,
  type ConstructorParam
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
  params: any;
  returns: any;
  autorun?: boolean;  // Auto-execute when selected (for idempotent methods)
  outputFormat?: string;  // Format hint for rendering (mermaid, markdown, json, etc.)
}

interface InvokeRequest {
  type: 'invoke';
  photon: string;
  method: string;
  args: Record<string, any>;
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

type ClientMessage = InvokeRequest | ConfigureRequest | ElicitationResponse | ReloadRequest | RemoveRequest;

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
  // Discover all photons
  const photonList = await listPhotonMCPs(workingDir);

  if (photonList.length === 0) {
    logger.warn('No photons found in ' + workingDir);
    console.log('\nCreate a photon with: photon maker new <name>');
    process.exit(1);
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

      // Filter out lifecycle methods
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => ({
          name: schema.name,
          description: schema.description || '',
          params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
          returns: { type: 'object' },
          autorun: schema.autorun || false,
          outputFormat: schema.outputFormat
        }));

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

      try {
        const resolved = path.resolve(dirPath);
        const stat = await fs.stat(resolved);

        if (!stat.isDirectory()) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Not a directory' }));
          return;
        }

        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const items = entries
          .filter(e => !e.name.startsWith('.'))
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
          items
        }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to read directory' }));
      }
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
      if (photonIndex === -1) return;

      const photon = photons[photonIndex];
      logger.info(`🔄 File change detected, reloading ${photonName}...`);

      try {
        // Reload the photon
        const mcp = await loader.reloadFile(photon.path);
        if (!mcp.instance) throw new Error('Failed to create instance');

        photonMCPs.set(photonName, mcp);

        // Re-extract schema
        const extractor = new SchemaExtractor();
        const schemas = await extractor.extractFromFile(photon.path);

        const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
        const methods: MethodInfo[] = schemas
          .filter((schema: any) => !lifecycleMethods.includes(schema.name))
          .map((schema: any) => ({
            name: schema.name,
            description: schema.description || '',
            params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
            returns: { type: 'object' },
            autorun: schema.autorun || false
          }));

        const reloadedPhoton: PhotonInfo = {
          name: photonName,
          path: photon.path,
          configured: true,
          methods
        };

        photons[photonIndex] = reloadedPhoton;

        // Broadcast to all clients
        broadcast({
          type: 'hot-reload',
          photon: reloadedPhoton
        });

        logger.info(`✅ ${photonName} hot reloaded`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
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
  const { photon, method, args } = request;

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

    // Use loader.executeTool which properly sets up execution context for this.emit()
    // and handles PhotonMCP vs plain class methods
    const result = await loader.executeTool(mcp, method, args, { outputHandler });

    ws.send(JSON.stringify({
      type: 'result',
      data: result
    }));
  } catch (error) {
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

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => ({
        name: schema.name,
        description: schema.description || '',
        params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        autorun: schema.autorun || false
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

    const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
    const methods: MethodInfo[] = schemas
      .filter((schema: any) => !lifecycleMethods.includes(schema.name))
      .map((schema: any) => ({
        name: schema.name,
        description: schema.description || '',
        params: schema.inputSchema || { type: 'object', properties: {}, required: [] },
        returns: { type: 'object' },
        autorun: schema.autorun || false
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

    .form-group textarea {
      resize: vertical;
      min-height: 100px;
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

    .mermaid-fullscreen {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mermaid-fullscreen-content {
      position: relative;
      max-width: 95vw;
      max-height: 95vh;
      overflow: auto;
      background: var(--bg-elevated);
      border-radius: var(--radius-lg);
      padding: 40px;
    }

    .mermaid-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      background: var(--bg-tertiary);
      border: none;
      border-radius: 50%;
      color: var(--text-secondary);
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mermaid-close:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }

    .mermaid-fullscreen-diagram {
      display: flex;
      justify-content: center;
    }

    .mermaid-fullscreen-diagram svg {
      max-width: 100%;
      height: auto;
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

    .result-container.visible {
      display: block;
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
    .mermaid-fullscreen-body svg {
      transition: transform 0.1s ease-out;
    }

    /* Enhanced markdown: Images */
    .md-image {
      max-width: 100%;
      height: auto;
      border-radius: var(--radius-md);
      margin: 1em 0;
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
    </div>

    <div class="main-content">
      <div id="empty-state" class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>Select a method to begin</h3>
        <p>Choose a photon and method from the sidebar to get started</p>
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
              <div class="result-content" id="result-content"></div>
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

      // Show method view
      document.getElementById('empty-state').style.display = 'none';
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
          handleResult(message.data);
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

      list.innerHTML = photons.map(photon => {
        if (photon.configured) {
          return \`
            <div class="photon-item">
              <div class="photon-header" data-photon="\${photon.name}" onclick="togglePhoton('\${photon.name}')">
                <span class="photon-name">\${photon.name}</span>
                <span class="method-count">\${photon.methods.length}</span>
              </div>
              <div class="method-list" id="methods-\${photon.name}">
                \${photon.methods.map(method => \`
                  <div class="method-item" onclick="selectMethod('\${photon.name}', '\${method.name}', event)">
                    \${method.name}
                  </div>
                \`).join('')}
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

      if (confirm(\`Remove \${currentPhoton.name} from this workspace?\`)) {
        ws.send(JSON.stringify({
          type: 'remove',
          photon: currentPhoton.name
        }));

        // Go back to empty state
        currentPhoton = null;
        currentMethod = null;
        document.getElementById('method-view').style.display = 'none';
        document.getElementById('empty-state').style.display = 'flex';
        history.pushState(null, '', window.location.pathname);
      }
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
        alert('Invalid JSON: ' + error.message);
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

      // Show method view
      document.getElementById('empty-state').style.display = 'none';
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
      const properties = params.properties || {};
      const required = params.required || [];

      let html = '';

      for (const [key, schema] of Object.entries(properties)) {
        // Fields with default values are not truly required
        const hasDefault = schema.default !== undefined;
        const isRequired = required.includes(key) && !hasDefault;
        const description = schema.description || '';

        // Clean description - remove default info since we show it in placeholder
        const cleanDesc = description.replace(/\\s*\\(default:.*?\\)/gi, '').trim();

        html += \`
          <div class="form-group">
            <label>
              \${key}
              \${isRequired ? '<span class="required">*</span>' : ''}
              \${cleanDesc ? \`<span class="hint">\${cleanDesc}</span>\` : ''}
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

      // Capitalize first letter of method name for button
      const buttonLabel = currentMethod.name.charAt(0).toUpperCase() + currentMethod.name.slice(1);
      html += \`<button type="submit" class="btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        \${buttonLabel}
      </button>\`;

      form.innerHTML = html;
      form.onsubmit = handleSubmit;

      // Auto-execute if method is marked as autorun and has no required fields
      if (currentMethod.autorun && !hasRequiredFields) {
        setTimeout(() => {
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }, 100);
      }
    }

    function renderInput(key, schema, isRequired) {
      const type = schema.type || 'string';
      const defaultValue = schema.default;
      const enumValues = schema.enum;

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

      // Boolean toggle
      if (type === 'boolean') {
        const boolDefault = defaultValue === true || defaultValue === 'true';
        return \`
          <select name="\${key}">
            <option value="true" \${boolDefault ? 'selected' : ''}>true</option>
            <option value="false" \${!boolDefault ? 'selected' : ''}>false</option>
          </select>
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
        const placeholder = defaultValue ? \`Default: \${defaultValue}\` : \`Enter \${key}...\`;
        return \`<textarea name="\${key}" \${maxLength} \${isRequired ? 'required' : ''} placeholder="\${placeholder}" rows="\${rows}" style="font-family: 'JetBrains Mono', monospace;">\${defaultValue || ''}</textarea>\`;
      }

      // Build attributes for string input
      const attrs = [];
      if (schema.minLength) attrs.push(\`minlength="\${schema.minLength}"\`);
      if (schema.maxLength) attrs.push(\`maxlength="\${schema.maxLength}"\`);
      if (schema.pattern) attrs.push(\`pattern="\${schema.pattern}"\`);
      if (defaultValue) attrs.push(\`value="\${defaultValue}"\`);

      // Placeholder with default hint
      const placeholder = defaultValue && !attrs.some(a => a.startsWith('value='))
        ? \`Default: \${defaultValue}\`
        : \`Enter \${key}...\`;

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

    function handleSubmit(e) {
      e.preventDefault();

      const formData = new FormData(e.target);
      const args = {};

      for (const [key, value] of formData.entries()) {
        // Parse booleans and numbers
        if (value === 'true') args[key] = true;
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

    function openFileBrowser(inputId) {
      fileBrowserCallback = inputId;
      fileBrowserSelectedPath = null;
      document.getElementById('file-browser-select').disabled = true;
      document.getElementById('file-browser-overlay').classList.add('visible');
      browsePath('');
    }

    function closeFileBrowser() {
      document.getElementById('file-browser-overlay').classList.remove('visible');
      fileBrowserCallback = null;
      fileBrowserSelectedPath = null;
    }

    async function browsePath(dirPath) {
      try {
        const url = dirPath ? \`/api/browse?path=\${encodeURIComponent(dirPath)}\` : '/api/browse';
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
      }
    }

    function handleResult(data) {
      hideProgress();
      addActivity('result', \`\${currentPhoton?.name}.\${currentMethod?.name}() completed\`);

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');

      const format = currentMethod?.outputFormat;

      // Handle mermaid diagrams
      if (format === 'mermaid' && typeof data === 'string') {
        renderMermaid(content, data);
      } else if (Array.isArray(data)) {
        content.innerHTML = \`
          <ul class="result-list">
            \${data.map(item => renderResultItem(item)).join('')}
          </ul>
        \`;
      } else if (typeof data === 'string') {
        content.innerHTML = renderMarkdown(data);
      } else {
        // Check if object has a 'diagram' field with mermaid content
        if (data && data.diagram && typeof data.diagram === 'string') {
          renderMermaid(content, data.diagram);
        } else {
          content.innerHTML = \`<pre style="margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">\${JSON.stringify(data, null, 2)}</pre>\`;
        }
      }

      // Update data tab
      document.getElementById('data-content').textContent = JSON.stringify(data, null, 2);
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

    function copyMermaidSource() {
      if (window.currentMermaidSource) {
        navigator.clipboard.writeText(window.currentMermaidSource);
        showToast('Diagram source copied', 'success');
      }
    }

    function zoomMermaid() {
      if (!window.currentMermaidSource) return;

      const overlay = document.createElement('div');
      overlay.className = 'mermaid-fullscreen';
      overlay.innerHTML = \`
        <div class="mermaid-fullscreen-content">
          <button class="mermaid-close" onclick="this.parentElement.parentElement.remove()">×</button>
          <div class="mermaid-fullscreen-diagram" id="mermaid-fullscreen-render"></div>
        </div>
      \`;
      document.body.appendChild(overlay);

      mermaid.render('mermaid-fs-svg', window.currentMermaidSource).then(({ svg }) => {
        document.getElementById('mermaid-fullscreen-render').innerHTML = svg;
      });
    }

    function renderResultItem(item) {
      if (typeof item === 'string') {
        return \`<li>\${renderMarkdown(item)}</li>\`;
      }
      return \`<li><pre>\${JSON.stringify(item, null, 2)}</pre></li>\`;
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
          svg.style.transform = \`scale(\${state.scale}) translate(\${state.translateX}px, \${state.translateY}px)\`;
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
        content.style.transform = \`scale(\${state.scale}) translate(\${state.translateX}px, \${state.translateY}px)\`;
      }
    }

    function setupMermaidFsDrag() {
      const body = document.getElementById('mermaid-fs-body');
      if (!body) return;

      let isDragging = false;
      let startX, startY, startTranslateX, startTranslateY;

      body.addEventListener('mousedown', (e) => {
        isDragging = true;
        body.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        startTranslateX = window.mermaidFsState.translateX;
        startTranslateY = window.mermaidFsState.translateY;
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / window.mermaidFsState.scale;
        const dy = (e.clientY - startY) / window.mermaidFsState.scale;
        window.mermaidFsState.translateX = startTranslateX + dx;
        window.mermaidFsState.translateY = startTranslateY + dy;
        applyMermaidFsTransform();
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
        body.classList.remove('dragging');
      });

      // Mouse wheel zoom
      body.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        mermaidFsZoom(delta);
      });
    }

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('mermaid-fullscreen-container').innerHTML) {
          closeMermaidFullscreen();
        } else if (document.getElementById('result-viewer-modal').classList.contains('visible')) {
          closeResultViewer();
        }
      }
    });

    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function handleError(message) {
      hideProgress();
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
        const options = (data.options || []).map(opt => {
          const value = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label;
          return \`<option value="\${value}">\${label}</option>\`;
        }).join('');
        html = \`
          <div class="form-group">
            <select id="elicitation-input">\${options}</select>
          </div>
        \`;
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
      }

      html += \`<button class="btn" onclick="submitElicitation()">Submit</button>\`;

      form.innerHTML = html;
      modal.classList.add('visible');
    }

    function submitElicitationValue(value) {
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value
      }));
      document.getElementById('elicitation-modal').classList.remove('visible');
    }

    function submitElicitation() {
      const input = document.getElementById('elicitation-input');
      const value = input.value;
      
      ws.send(JSON.stringify({
        type: 'elicitation_response',
        value
      }));
      
      document.getElementById('elicitation-modal').classList.remove('visible');
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

    // Connect on load
    connect();
  </script>
</body>
</html>`;
}
