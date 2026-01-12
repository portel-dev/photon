/**
 * Photon Beam - Interactive Control Panel
 *
 * A unified UI to interact with all your photons.
 * Uses WebSocket for real-time bidirectional communication.
 */

import * as http from 'http';
import * as fs from 'fs/promises';
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

type ClientMessage = InvokeRequest | ConfigureRequest | ElicitationResponse;

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
          returns: { type: 'object' }
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

    res.writeHead(404);
    res.end('Not Found');
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {

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
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      // Client disconnected
    });
  });

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
        returns: { type: 'object' }
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

    .photon-item.unconfigured .method-count.configure-badge {
      background: var(--warning);
      color: #000;
      font-weight: 600;
    }

    .photon-item.unconfigured .photon-header.selected {
      background: var(--bg-tertiary);
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
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 12px;
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
          <h2 id="method-title"></h2>
          <p id="method-description"></p>
        </div>

        <div class="tabs">
          <div class="tab active" data-tab="ui">Execute</div>
          <div class="tab" data-tab="data">Raw JSON</div>
        </div>

        <div class="tab-content">
          <div class="tab-panel active" id="ui-panel">
            <form id="invoke-form"></form>
            <div class="result-container" id="result-container">
              <div class="result-header">Result</div>
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

  <script>
    let ws;
    let photons = [];
    let currentPhoton = null;
    let currentMethod = null;

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

    function connect() {
      ws = new WebSocket('ws://localhost:${port}');

      ws.onopen = () => {
        console.log('Connected to Beam');
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
      }
    }

    function handleConfigured(photon) {
      hideProgress();

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
              <div class="photon-header" data-photon="\${photon.name}" onclick="selectUnconfigured('\${photon.name}')">
                <span class="photon-name">\${photon.name}</span>
                <span class="method-count configure-badge">Configure</span>
              </div>
            </div>
          \`;
        }
      }).join('');
    }

    function selectUnconfigured(photonName) {
      currentPhoton = photons.find(p => p.name === photonName);
      currentMethod = null;

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

        html += \`
          <div class="form-group">
            <label>
              \${param.name}\${isRequired ? ' <span class="required">*</span>' : ''}
              <span class="hint">\${param.envVar}</span>
            </label>
            <input
              type="\${isSecret ? 'password' : 'text'}"
              name="\${param.envVar}"
              placeholder="\${param.hasDefault ? \`Default: \${param.defaultValue}\` : \`Enter \${param.name}...\`}"
              \${isRequired ? 'required' : ''}
            />
          </div>
        \`;
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
        const isRequired = required.includes(key);
        const description = schema.description || '';

        html += \`
          <div class="form-group">
            <label>
              \${key}
              \${isRequired ? '<span class="required">*</span>' : ''}
              \${description ? \`<span class="hint">\${description}</span>\` : ''}
            </label>
            \${renderInput(key, schema, isRequired)}
          </div>
        \`;
      }

      html += \`<button type="submit" class="btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Run \${currentMethod.name}
      </button>\`;

      form.innerHTML = html;
      form.onsubmit = handleSubmit;
    }

    function renderInput(key, schema, isRequired) {
      const type = schema.type || 'string';
      const enumValues = schema.enum;

      if (enumValues) {
        return \`
          <select name="\${key}" \${isRequired ? 'required' : ''}>
            \${enumValues.map(v => \`<option value="\${v}">\${v}</option>\`).join('')}
          </select>
        \`;
      }

      if (type === 'boolean') {
        return \`
          <select name="\${key}">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        \`;
      }

      if (type === 'number' || type === 'integer') {
        return \`<input type="number" name="\${key}" \${isRequired ? 'required' : ''} />\`;
      }

      return \`<input type="text" name="\${key}" \${isRequired ? 'required' : ''} placeholder="Enter \${key}..." />\`;
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

    function handleYield(data) {
      if (data.emit === 'status') {
        showProgress(data.message);
      } else if (data.emit === 'progress') {
        showProgress(data.message || 'Processing...', data.value || 0);
      }
    }

    function handleResult(data) {
      hideProgress();

      const container = document.getElementById('result-container');
      const content = document.getElementById('result-content');

      container.classList.add('visible');

      if (Array.isArray(data)) {
        content.innerHTML = \`
          <ul class="result-list">
            \${data.map(item => renderResultItem(item)).join('')}
          </ul>
        \`;
      } else if (typeof data === 'string') {
        content.innerHTML = renderMarkdown(data);
      } else {
        content.innerHTML = \`<pre style="margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 13px;">\${JSON.stringify(data, null, 2)}</pre>\`;
      }

      // Update data tab
      document.getElementById('data-content').textContent = JSON.stringify(data, null, 2);
    }

    function renderResultItem(item) {
      if (typeof item === 'string') {
        return \`<li>\${renderMarkdown(item)}</li>\`;
      }
      return \`<li><pre>\${JSON.stringify(item, null, 2)}</pre></li>\`;
    }

    function renderMarkdown(text) {
      let html = text;

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

      // Links
      html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

      // Bold
      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

      // Italic
      html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

      // Headers
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // Blockquotes (> at start of line)
      html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

      // Code blocks
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

      // Line breaks within paragraphs
      html = html.replace(/\\n/g, '<br>');

      return frontMatterHtml + html;
    }

    function handleError(message) {
      hideProgress();

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
