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

import { withTimeout } from '../async/index.js';
// WebSocket removed - now using MCP Streamable HTTP (SSE) only
import { listPhotonMCPs, resolvePhotonPath } from '../path-resolver.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
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
} from './types.js';
import { getBundledPhotonPath, BEAM_BUNDLED_PHOTONS } from '../shared-utils.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

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
import { SubscriptionManager } from './beam/subscription.js';
import { handleMarketplaceRoutes } from './beam/routes/api-marketplace.js';
import { handleBrowseRoutes } from './beam/routes/api-browse.js';
import { handleConfigRoutes } from './beam/routes/api-config.js';
import {
  loadExternalMCPs as loadExternalMCPsFromModule,
  reconnectExternalMCP as reconnectExternalMCPFromModule,
  generateExternalMCPId,
} from './beam/external-mcp.js';
import {
  configurePhotonViaMCP,
  reloadPhotonViaMCP,
  removePhotonViaMCP,
  updateMetadataViaMCP,
  generatePhotonHelpMarkdown,
} from './beam/photon-management.js';
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

// Module-level state for external MCPs (shared with transport handler)
const externalMCPs: ExternalMCPInfo[] = [];
const externalMCPClients = new Map<string, any>();
const externalMCPSDKClients = new Map<string, Client>();

// Delegate to extracted module
const prettifyToolName = prettifyToolNameFromModule;

// Delegates — external MCP management now in beam/external-mcp.ts
const externalMCPState = { externalMCPs, externalMCPClients, externalMCPSDKClients };
const loadExternalMCPs = (config: PhotonConfig) =>
  loadExternalMCPsFromModule(config, externalMCPState);
const reconnectExternalMCP = (name: string) =>
  reconnectExternalMCPFromModule(name, externalMCPState);

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

/**
 * Generate the service worker JS that validates the Beam backend
 * on PWA launch and shows a diagnostic page if something is wrong.
 */
function generateServiceWorker(workingDir: string): string {
  return `
// Photon Beam Service Worker
// Validates the backend is running and healthy before serving the app.
const CACHE_NAME = 'photon-pwa-v1';
const EXPECTED_WORKING_DIR = ${JSON.stringify(workingDir)};
const HEALTH_ENDPOINT = '/api/diagnostics';

// Cache the boot page on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.put('/_pwa_boot', new Response(BOOT_PAGE, {
      headers: { 'Content-Type': 'text/html' }
    }))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept navigation requests (page loads, not API/asset fetches)
  if (event.request.mode !== 'navigate') return;

  // Skip API routes and static assets — let them pass through
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname === '/beam.bundle.js') return;

  // All navigation requests go through health check
  event.respondWith(handlePWANavigation(event.request));
});

async function handlePWANavigation(request) {
  try {
    // Try to reach the backend
    const healthRes = await fetch(HEALTH_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    if (!healthRes.ok) throw new Error('Health check failed');

    const health = await healthRes.json();

    // Validate this is actually Beam serving the expected directory
    if (!health.photonVersion) {
      return serveBoot('wrong-service', JSON.stringify(health));
    }
    if (health.workingDir !== EXPECTED_WORKING_DIR) {
      return serveBoot('wrong-directory', JSON.stringify({
        expected: EXPECTED_WORKING_DIR,
        actual: health.workingDir
      }));
    }

    // Backend is healthy and correct — serve the real page
    return fetch(request);
  } catch (err) {
    // Backend is unreachable
    return serveBoot('not-running', err.message);
  }
}

async function serveBoot(reason, detail) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match('/_pwa_boot');
  if (cached) {
    const html = await cached.text();
    const injected = html
      .replace('__BOOT_REASON__', reason)
      .replace('__BOOT_DETAIL__', detail || '')
      .replace('__EXPECTED_DIR__', EXPECTED_WORKING_DIR);
    return new Response(injected, { headers: { 'Content-Type': 'text/html' } });
  }
  return new Response('Photon Beam is not available. Run: photon beam', {
    status: 503, headers: { 'Content-Type': 'text/plain' }
  });
}

const BOOT_PAGE = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photon Beam</title>
  <meta name="theme-color" content="#1a1a1a">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #1a1a1a; color: #e5e5e5; font-family: system-ui, -apple-system, sans-serif;
    }
    .container { text-align: center; padding: 40px; max-width: 500px; }
    .icon { font-size: 56px; margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #fff; }
    .message { font-size: 15px; line-height: 1.6; color: #999; margin-bottom: 28px; }
    .command {
      display: inline-block; background: #2a2a2a; border: 1px solid #333;
      padding: 10px 20px; border-radius: 8px; font-family: 'JetBrains Mono', monospace;
      font-size: 14px; color: #4ade80; margin-bottom: 20px; user-select: all;
    }
    .detail {
      font-size: 12px; color: #666; font-family: 'JetBrains Mono', monospace;
      background: #222; border-radius: 6px; padding: 10px; margin-bottom: 20px;
      word-break: break-all; display: none;
    }
    .detail.show { display: block; }
    .retry {
      padding: 10px 24px; background: #333; border: 1px solid #444; border-radius: 8px;
      color: #fff; cursor: pointer; font-size: 14px; transition: background 0.2s;
    }
    .retry:hover { background: #444; }
    .spinner {
      display: none; width: 20px; height: 20px; border: 2px solid #444;
      border-top-color: #4ade80; border-radius: 50%; animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    .spinner.show { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner" id="spinner"></div>
    <div id="content">
      <div class="icon" id="icon"></div>
      <h1 id="title"></h1>
      <p class="message" id="message"></p>
      <div class="detail" id="detail"></div>
      <code class="command" id="command" style="display:none"></code>
      <br><br>
      <button class="retry" onclick="checkAndRetry()">Retry</button>
    </div>
  </div>
  <script>
    const reason = '__BOOT_REASON__';
    const detail = '__BOOT_DETAIL__';
    const expectedDir = '__EXPECTED_DIR__';

    const states = {
      'not-running': {
        icon: '\\u26a1',
        title: 'Beam is not running',
        message: 'Start Photon Beam to use this app:',
        command: 'photon beam'
      },
      'wrong-service': {
        icon: '\\u26a0\\ufe0f',
        title: 'Port is in use by another service',
        message: 'Something else is running on this port. Stop the other service or reconfigure Beam:',
        command: 'photon beam --port <available-port>',
        showDetail: true
      },
      'wrong-directory': {
        icon: '\\ud83d\\udcc1',
        title: 'Beam is serving a different project',
        message: 'Beam is running but pointing to a different directory. Start it with the correct path:',
        command: 'photon beam ' + expectedDir,
        showDetail: true
      }
    };

    function render() {
      const s = states[reason] || states['not-running'];
      document.getElementById('icon').textContent = s.icon;
      document.getElementById('title').textContent = s.title;
      document.getElementById('message').textContent = s.message;
      const cmdEl = document.getElementById('command');
      cmdEl.textContent = s.command;
      cmdEl.style.display = 'inline-block';
      if (s.showDetail && detail) {
        const el = document.getElementById('detail');
        el.textContent = detail;
        el.classList.add('show');
      }
    }

    async function checkAndRetry() {
      document.getElementById('content').style.display = 'none';
      document.getElementById('spinner').classList.add('show');
      try {
        const res = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const h = await res.json();
          if (h.photonVersion && h.workingDir === expectedDir) {
            location.reload();
            return;
          }
        }
      } catch {}
      document.getElementById('spinner').classList.remove('show');
      document.getElementById('content').style.display = '';
      render();
    }

    render();
    // Auto-retry every 5 seconds
    setInterval(async () => {
      try {
        const res = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const h = await res.json();
          if (h.photonVersion && h.workingDir === expectedDir) location.reload();
        }
      } catch {}
    }, 5000);
  </script>
</body>
</html>\`;
`;
}

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
      mcp.schemas = schemas;

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

      // Add auto-generated settings tool if the photon has `protected settings`
      if (mcp.settingsSchema?.hasSettings) {
        const settingsTool = mcp.tools.find((t: any) => t.name === 'settings');
        if (settingsTool) {
          methods.push({
            name: 'settings',
            description: settingsTool.description || 'Board settings',
            params: settingsTool.inputSchema || { type: 'object', properties: {} },
            returns: { type: 'object' },
          });
        }
      }

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
          uiAsset.csp = cspData['__class__'];
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
        ...(mcp.settingsSchema?.hasSettings && { hasSettings: true }),
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
        errorMessage: errorMsg.slice(0, 2000),
      };
    }
  }

  // Photon loading is deferred until after server.listen() — see end of startBeam()

  // ══════════════════════════════════════════════════════════════════════════════
  // Subscription management (ref-counted channels + event buffer replay)
  const subMgr = new SubscriptionManager({ photons, workingDir });
  const subscriptionManager = {
    onClientViewingBoard: subMgr.onClientViewingBoard.bind(subMgr),
    onClientDisconnect: subMgr.onClientDisconnect.bind(subMgr),
  };
  const bufferEvent = subMgr.bufferEvent.bind(subMgr);

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
  const server = http.createServer((req, res) => {
    void (async () => {
      const reqStart = Date.now();
      // Security: set standard security headers on all responses
      setSecurityHeaders(res);
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      // Access logging for API and MCP routes (debug-level to avoid noise)
      res.on('finish', () => {
        if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') {
          const duration = Date.now() - reqStart;
          logger.debug(`${req.method} ${url.pathname} ${res.statusCode} ${duration}ms`);
        }
      });

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

      // ══════════════════════════════════════════════════════════════════════════
      // REST API routes (extracted modules)
      // ══════════════════════════════════════════════════════════════════════════
      if (url.pathname.startsWith('/api/')) {
        if (await handleMarketplaceRoutes(req, res, url, beamState)) return;
        if (await handleBrowseRoutes(req, res, url, beamState)) return;
        if (await handleConfigRoutes(req, res, url, beamState)) return;
      }

      // Service worker for PWA support
      if (url.pathname === '/sw.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-cache',
        });
        res.end(generateServiceWorker(beamState.workingDir));
        return;
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
    })();
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
  const symlinkWatchedDirs = new Set<string>(); // Track which source dirs already have watchers (prevents duplicates on re-setup)

  // Set up file watchers for a symlinked photon's real source directory and asset folder.
  // Called both at startup and after a previously-errored symlinked photon recovers.
  const setupSymlinkWatcher = (photonName: string, photonPath: string): void => {
    try {
      const stat = lstatSync(photonPath);
      if (!stat.isSymbolicLink()) return;

      const realPath = realpathSync(photonPath);
      const realDir = path.dirname(realPath);

      // Skip if we already have a watcher on this source directory for this photon
      const watchKey = `${photonName}:${realDir}`;
      if (symlinkWatchedDirs.has(watchKey)) return;

      const realFileName = path.basename(realPath);

      try {
        const srcDirWatcher = watch(realDir, (eventType, filename) => {
          if (filename === realFileName) {
            void handleFileChange(photonName);
          }
        });
        srcDirWatcher.on('error', () => {});
        watchers.push(srcDirWatcher);
        symlinkWatchedDirs.add(watchKey);
      } catch {
        // Source file watching not available
      }

      // Watch asset folder if it exists
      const assetFolder = path.join(realDir, photonName);
      if (existsSync(assetFolder)) {
        try {
          const assetWatcher = watch(assetFolder, { recursive: true }, (eventType, filename) => {
            if (filename) {
              if (
                filename.endsWith('.json') ||
                filename.startsWith('boards/') ||
                filename === 'data.json'
              ) {
                return;
              }
              logger.info(`📁 Asset change detected: ${photonName}/${filename}`);
              void handleFileChange(photonName);
            }
          });
          assetWatcher.on('error', (err) => {
            logger.warn(`Watcher error for ${photonName}/: ${err.message}`);
          });
          watchers.push(assetWatcher);
        } catch {
          // Asset watching not available
        }
      }

      logger.info(
        existsSync(assetFolder)
          ? `👀 Watching ${photonName}/ (symlinked → ${assetFolder})`
          : `👀 Watching ${photonName} (symlinked → ${realDir})`
      );
    } catch {
      // Symlink broken or unreadable — will retry on next successful reload
      logger.debug(`⏭️ Symlink watcher deferred for ${photonName}: target not resolvable`);
    }
  };

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
      setTimeout(() => {
        void (async () => {
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
            const previouslyConfigured = !isNewPhoton && photons[photonIndex]?.configured === true;

            // Handle file deletion - if file no longer exists and photon is in list, remove it
            if (!isNewPhoton && photonPath && !existsSync(photonPath)) {
              // For symlinks, `ln -sf` causes a transient gap between unlink and create.
              // Retry once after a short delay before treating it as a real deletion.
              let isTransientSymlinkReplacement = false;
              try {
                const stat = lstatSync(photonPath);
                if (stat.isSymbolicLink()) {
                  await new Promise((r) => setTimeout(r, 200));
                  if (existsSync(photonPath)) {
                    isTransientSymlinkReplacement = true;
                  }
                }
              } catch {
                // lstat failed — symlink inode itself is gone, proceed with removal
              }

              if (isTransientSymlinkReplacement) {
                logger.info(`🔗 Symlink replaced: ${photonName}, treating as change`);
                // Fall through to reload logic below
              } else {
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
            }

            // Ghost event: watcher fired for a new photon but the file doesn't exist.
            // This happens on macOS FSEvents spurious events or create-then-delete races.
            // Nothing to load — ignore silently.
            if (isNewPhoton && !existsSync(photonPath)) {
              logger.debug(`👻 Ghost event for ${photonName}: file not found, skipping`);
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
                    params: template.inputSchema || {
                      type: 'object',
                      properties: {},
                      required: [],
                    },
                    returns: { type: 'object' },
                    isTemplate: true,
                    outputFormat: 'markdown',
                  });
                }
              });

              // Add auto-generated settings tool if the photon has `protected settings`
              if (mcp.settingsSchema?.hasSettings) {
                const settingsTool = mcp.tools.find((t: any) => t.name === 'settings');
                if (settingsTool) {
                  methods.push({
                    name: 'settings',
                    description: settingsTool.description || 'Board settings',
                    params: settingsTool.inputSchema || { type: 'object', properties: {} },
                    returns: { type: 'object' },
                  });
                }
              }

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
                ...(mcp.settingsSchema?.hasSettings && { hasSettings: true }),
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

              // If this photon is symlinked and was previously errored (or new), set up
              // source-directory watchers that may have been skipped at startup.
              if (isNewPhoton || !previouslyConfigured) {
                setupSymlinkWatcher(photonName, reloadedPhoton.path);
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
              void handleFileChange(photonName);
            }
          }
        })();
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
        void handleFileChange(photonName);
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
    logger.warn(`File watching not available: ${String(error)}`);
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
            onReconnect: () => logger.debug(`📡 Reconnected ${channel} subscription`),
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
        // Delegate to reusable setupSymlinkWatcher (also called after error recovery)
        setupSymlinkWatcher(photon.name, photon.path);
      } else {
        // Non-symlinked photon (e.g. ~/.photon/boards.photon.ts) — watch both
        // the source file and its asset folder if they're outside the workingDir
        // (workingDir is already covered by the recursive watcher above)
        const photonDir = path.dirname(photon.path);
        if (!photonDir.startsWith(workingDir)) {
          try {
            const srcFileName = path.basename(photon.path);
            const srcDirWatcher = watch(photonDir, (eventType, filename) => {
              if (filename === srcFileName) {
                void handleFileChange(photon.name);
              }
            });
            srcDirWatcher.on('error', () => {});
            watchers.push(srcDirWatcher);

            const assetFolder = path.join(photonDir, photon.name);
            if (existsSync(assetFolder)) {
              const assetWatcher = watch(
                assetFolder,
                { recursive: true },
                (eventType, filename) => {
                  if (filename) {
                    if (
                      filename.endsWith('.json') ||
                      filename.startsWith('boards/') ||
                      filename === 'data.json'
                    ) {
                      return;
                    }
                    logger.info(`📁 Asset change detected: ${photon.name}/${filename}`);
                    void handleFileChange(photon.name);
                  }
                }
              );
              assetWatcher.on('error', () => {});
              watchers.push(assetWatcher);
            }
            logger.info(`👀 Watching ${photon.name} (${photonDir})`);
          } catch {
            logger.debug(`⏭️ Could not watch ${photon.name}: ${photon.path}`);
          }
        }
      }
    } catch (err) {
      logger.debug(
        `⏭️ Skipping ${photon.name}: ${err instanceof Error ? err.message : String(err)}`
      );
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
          void handleFileChange(photonName);
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
          void handleFileChange(photonName);
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
      configDebounce = setTimeout(() => {
        void (async () => {
          configDebounce = null;

          let newConfig: PhotonConfig;
          try {
            const data = await fs.readFile(configFile, 'utf-8');
            newConfig = migrateConfig(JSON.parse(data));
          } catch (err) {
            logger.warn(
              `⚠️ Failed to parse config.json: ${err instanceof Error ? err.message : String(err)}`
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
            `🔧 config.json changed — added: [${added.join(', ')}], removed: [${removed.join(', ')}], modified: [${modified.join(', ')}]`
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
        })();
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
    logger.warn(`Config watching not available: ${String(error)}`);
  }
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
