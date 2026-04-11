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
import { readText, readJSON as readJSONFile, writeText } from '../shared/io.js';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  watch,
  type FSWatcher,
} from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import {
  setSecurityHeaders,
  SimpleRateLimiter,
  escapeHtml,
  getCorsOrigin,
} from '../shared/security.js';

/**
 * Check if shell integration has been installed (photon init cli).
 * Cached at module load since it won't change during a Beam session.
 */
const _shellIntegrationInstalled = (() => {
  const shell = process.env.SHELL || '';
  const rcFile = shell.includes('zsh')
    ? path.join(os.homedir(), '.zshrc')
    : path.join(os.homedir(), '.bashrc');
  try {
    return readFileSync(rcFile, 'utf-8').includes('# photon shell integration');
  } catch {
    return false;
  }
})();

/**
 * Generate a unique ID for a photon based on its path.
 * This ensures photons with the same name from different paths are distinguishable.
 * Returns first 12 chars of SHA-256 hash for brevity while maintaining uniqueness.
 */
function generatePhotonId(photonPath: string): string {
  return createHash('sha256').update(photonPath).digest('hex').slice(0, 12);
}

/**
 * MIME type map for icon images
 */
const ICON_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/**
 * Resolve raw icon image paths to MCP Icon[] format (data URIs)
 */
async function resolveIconImages(
  iconImages: Array<{ path: string; sizes?: string; theme?: string }> | undefined,
  photonPath: string
): Promise<Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }> | undefined> {
  if (!iconImages || iconImages.length === 0) return undefined;

  const photonDir = path.dirname(photonPath);
  const icons: Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }> = [];

  for (const entry of iconImages) {
    try {
      const resolvedPath = path.resolve(photonDir, entry.path);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeType = ICON_MIME_TYPES[ext];
      if (!mimeType) continue;

      const data = await fs.readFile(resolvedPath);
      const base64 = data.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64}`;

      const icon: { src: string; mimeType?: string; sizes?: string; theme?: string } = {
        src: dataUri,
        mimeType,
      };
      if (entry.sizes) icon.sizes = entry.sizes;
      if (entry.theme) icon.theme = entry.theme;
      icons.push(icon);
    } catch {
      // Skip unreadable icon files silently
    }
  }

  return icons.length > 0 ? icons : undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { withTimeout } from '../async/index.js';
// WebSocket removed - now using MCP Streamable HTTP (SSE) only
import { resolvePhotonPath, type ListedPhoton } from '../path-resolver.js';
import { discoverLocalPhotons } from '../context.js';
import { PhotonLoader } from '../loader.js';
import { logger, createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { toEnvVarName } from '../shared/config-docs.js';
import { MarketplaceManager } from '../marketplace-manager.js';
import { subscribeChannel, reloadDaemonPhoton } from '../daemon/client.js';
import {
  ensurePhotonEditorDeclaration,
  writePhotonEditorDeclaration,
} from '../photon-editor-declarations.js';
import { ensureDaemon } from '../daemon/manager.js';
import { SchemaExtractor, type ConstructorParam } from '@portel/photon-core';
import { generateServerCard } from '../server-card.js';
import {
  handleStreamableHTTP,
  broadcastNotification,
  broadcastToBeam,
  stopSessionCleanup,
} from './streamable-http-transport.js';
// MCPServer type removed - no longer needed for WebSocket transport
import type {
  PhotonInfo,
  UnconfiguredPhotonInfo,
  AnyPhotonInfo,
  ConfigParam,
  MethodInfo,
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
import { generateAgentCard } from '../a2a/card-generator.js';

// Delegate to extracted module
const getConfigFilePath = getConfigFilePathFromModule;

// PhotonConfig type imported from beam/types.ts
type PhotonConfig = import('./beam/types.js').PhotonConfig;

// ═══════════════════════════════════════════════════════════════════════════════
// BEAM CONTEXT — all module-level mutable state lives here
// ═══════════════════════════════════════════════════════════════════════════════

class BeamContext {
  /** External MCP server metadata */
  readonly externalMCPs: ExternalMCPInfo[] = [];
  /** Transport-level clients for external MCPs */
  readonly externalMCPClients = new Map<string, any>();
  /** SDK Client instances for tool calls with structuredContent */
  readonly externalMCPSDKClients = new Map<string, Client>();

  /**
   * Notification subscriptions per photon.
   * Key: photon name, Value: list of event types this photon cares about
   * Example: { "chat": ["mentions", "direct-messages"], "tasks": ["deadline", "assigned-to-me"] }
   */
  readonly photonNotificationSubscriptions = new Map<string, string[]>();

  /**
   * Track which state-changed channels we've already subscribed to,
   * so dynamically discovered photons can be subscribed without duplicates.
   */
  readonly subscribedStateChannels = new Set<string>();

  /** Convenience accessor matching the shape expected by external-mcp module */
  get externalMCPState() {
    return {
      externalMCPs: this.externalMCPs,
      externalMCPClients: this.externalMCPClients,
      externalMCPSDKClients: this.externalMCPSDKClients,
    };
  }
}

const ctx = new BeamContext();

// Delegates — external MCP management now in beam/external-mcp.ts
const loadExternalMCPs = (config: PhotonConfig) =>
  loadExternalMCPsFromModule(config, ctx.externalMCPState);
const reconnectExternalMCP = (name: string) =>
  reconnectExternalMCPFromModule(name, ctx.externalMCPState);

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

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION SUBSCRIPTIONS (state lives in ctx: BeamContext)
// ═══════════════════════════════════════════════════════════════════════════════

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
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // PWA icon PNG generation — intercept /api/pwa/icon-png requests and render
  // the SVG icon onto OffscreenCanvas, returning a real PNG response that
  // satisfies Chrome's installability requirement for raster icons.
  if (url.pathname === '/api/pwa/icon-png') {
    event.respondWith(handleIconPng(url));
    return;
  }

  // Only intercept navigation requests (page loads, not API/asset fetches)
  if (event.request.mode !== 'navigate') return;

  // Skip API routes and static assets — let them pass through
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/beam.bundle.js' ||
    url.pathname === '/beam-form.bundle.js' ||
    url.pathname === '/beam-ts-worker.js'
  ) return;

  // All navigation requests go through health check
  event.respondWith(handlePWANavigation(event.request));
});

async function handlePWANavigation(request) {
  try {
    // Try to reach the backend
    const healthRes = await fetch(HEALTH_ENDPOINT, { signal: AbortSignal.timeout(3000) });
    if (!healthRes.ok) throw new Error('Health check failed');

    const health = await healthRes.json();

    // Validate this is actually Beam (not some other service on this port)
    if (!health.photonVersion) {
      return serveBoot('wrong-service', JSON.stringify(health));
    }

    // Backend is healthy — serve the real page
    // (workingDir may differ from what was cached in the SW — that's fine,
    //  users can point Beam at any directory)
    return fetch(request);
  } catch (err) {
    // Backend is unreachable
    return serveBoot('not-running', err.message);
  }
}

async function handleIconPng(url) {
  const photon = url.searchParams.get('photon') || '';
  const size = parseInt(url.searchParams.get('size') || '192', 10);
  const cacheKey = '/_pwa_icon_' + photon + '_' + size;

  // Check cache first
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // Fetch the icon from the server (may be SVG, PNG, JPEG, etc.)
    const iconRes = await fetch('/api/pwa/icon?photon=' + encodeURIComponent(photon), { signal: AbortSignal.timeout(10000) });
    if (!iconRes.ok) throw new Error('Icon fetch failed: ' + iconRes.status);

    const contentType = (iconRes.headers.get('Content-Type') || '').toLowerCase();

    // For raster images (PNG, JPEG, WebP), resize via OffscreenCanvas if needed
    // For SVG or emoji-generated SVG, render to canvas at target size
    let bmp;
    if (contentType.includes('svg')) {
      // SVG (emoji-generated or file) — parse as text, create bitmap
      const svgText = await iconRes.text();
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      bmp = await createImageBitmap(svgBlob, { resizeWidth: size, resizeHeight: size });
    } else {
      // Raster image (PNG, JPEG, WebP) — decode directly
      const imgBlob = await iconRes.blob();
      bmp = await createImageBitmap(imgBlob, { resizeWidth: size, resizeHeight: size });
    }

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Dark rounded-rect background
    ctx.fillStyle = '#1a1a1a';
    const r = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Draw the icon
    ctx.drawImage(bmp, 0, 0, size, size);

    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const pngResponse = new Response(pngBlob, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      }
    });

    // Cache the generated PNG
    await cache.put(cacheKey, pngResponse.clone());
    return pngResponse;
  } catch (err) {
    // Fallback: generate a simple colored square with initial letter
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#4ade80';
    ctx.font = (size * 0.4) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(photon.charAt(0).toUpperCase() || 'P', size / 2, size / 2);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return new Response(pngBlob, {
      headers: { 'Content-Type': 'image/png' }
    });
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

  // Run startup migrations (fast no-op when already applied)
  try {
    const { runNamespaceMigration } = await import('../namespace-migration.js');
    await runNamespaceMigration();
    const { runDataMigration } = await import('../data-migration.js');
    await runDataMigration();
  } catch {
    // Non-critical
  }

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

  // Discover photons from baseDir only — beam scopes to the current project
  const scannedPhotonList = await discoverLocalPhotons();

  // Deduplicate aliases that resolve to the same underlying file (for example,
  // a marketplace photon and a local alias/symlink that both point at the same
  // source). Beam should not show both copies in the sidebar.
  const userPhotonListDetailed: ListedPhoton[] = [];
  const seenPhotonKeys = new Set<string>();
  for (const photon of scannedPhotonList) {
    let realPath = photon.filePath;
    try {
      realPath = realpathSync(photon.filePath);
    } catch {
      // Fall back to the discovered path if realpath resolution fails.
    }

    const dedupeKey = `${photon.name}::${realPath}`;
    if (seenPhotonKeys.has(dedupeKey)) continue;
    seenPhotonKeys.add(dedupeKey);
    userPhotonListDetailed.push(photon);
  }

  // Detect name collisions and generate friendly duplicate labels. We should
  // never leak namespace/owner names into the sidebar just because there are
  // multiple copies of a photon with the same short name.
  const nameOccurrences = new Map<string, number>();
  for (const p of userPhotonListDetailed) {
    nameOccurrences.set(p.name, (nameOccurrences.get(p.name) || 0) + 1);
  }

  // Build photon list with short names plus a numeric suffix for duplicates.
  // Also track resolved paths from namespace scan.
  const photonRouteMeta = new Map<
    string,
    { filePath: string; shortName: string; namespace?: string; qualifiedName?: string }
  >(); // displayName → route metadata
  const userPhotonList: string[] = [];
  const duplicateIndex = new Map<string, number>();
  for (const p of userPhotonListDetailed) {
    const duplicateCount = nameOccurrences.get(p.name) || 0;
    const nextIndex = (duplicateIndex.get(p.name) || 0) + 1;
    duplicateIndex.set(p.name, nextIndex);
    const displayName = duplicateCount > 1 ? `${p.name} (${nextIndex})` : p.name;
    userPhotonList.push(displayName);
    photonRouteMeta.set(displayName, {
      filePath: p.filePath,
      shortName: p.name,
      namespace: p.namespace || undefined,
      qualifiedName: p.qualifiedName || undefined,
    });
  }

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

  // Check for placeholder defaults or localhost URLs (which need local services running)
  const isPlaceholderOrLocalDefault = (value: string): boolean => {
    if (value.includes('<') || value.includes('your-')) return true;
    if (value.includes('localhost') || value.includes('127.0.0.1')) return true;
    return false;
  };

  // Helper: load a single photon, returning the info to push into photons[]
  async function loadSinglePhoton(name: string): Promise<AnyPhotonInfo | null> {
    const photonPath =
      bundledPhotonPaths.get(name) ||
      photonRouteMeta.get(name)?.filePath ||
      (await resolvePhotonPath(name, workingDir));
    if (!photonPath) return null;
    const routeMeta = photonRouteMeta.get(name);

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
      source = await readText(photonPath);
      await ensurePhotonEditorDeclaration(photonPath, source, workingDir).catch((e) => {
        logger.debug(`Failed to ensure editor declaration for ${photonPath}: ${e?.message || e}`);
      });
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
      const schemaSource = source || (await readText(photonPath));
      const metadata = extractor.extractAllFromSource(schemaSource);
      const schemas = metadata.tools;
      const templates = metadata.templates;
      mcp.schemas = schemas;

      // Store notification subscriptions per photon
      if (metadata.notificationSubscriptions?.watchFor) {
        ctx.photonNotificationSubscriptions.set(name, metadata.notificationSubscriptions.watchFor);
      } else {
        // Clear previous subscription if photon no longer has @notify-on
        ctx.photonNotificationSubscriptions.delete(name);
      }

      // Get UI assets for linking
      const uiAssets = mcp.assets?.ui || [];
      // If loader didn't resolve UI assets but source has @ui tags,
      // extract them from source to populate linkedUi for sidebar
      if (uiAssets.length === 0 && schemaSource) {
        const classUiMatch = schemaSource.match(/^\s*\*\s*@ui\s+(\S+)\s+(\.\/\S+)/m);
        if (classUiMatch) {
          // Class-level @ui tag with file path: @ui dashboard ./ui/dashboard.html
          const uiId = classUiMatch[1]; // e.g., "dashboard"
          // Add synthetic asset entry for all methods tagged with this @ui id
          schemas.forEach((schema: any) => {
            // Check if method has @ui tag matching this id
            const methodSource = schemaSource.match(
              new RegExp(
                `@ui\\s+${uiId}[\\s\\n]*\\*/[\\s\\n]*(?:async\\s+)?${schema.name}\\s*\\(`,
                'm'
              )
            );
            if (methodSource) {
              uiAssets.push({ id: uiId, linkedTool: schema.name });
            }
          });
        }
      }

      // Filter out lifecycle methods
      const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
      const methods: MethodInfo[] = schemas
        .filter((schema: any) => !lifecycleMethods.includes(schema.name))
        .map((schema: any) => {
          const linkedAsset = uiAssets.find(
            (ui: any) => ui.linkedTool === schema.name || ui.linkedTools?.includes(schema.name)
          );
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
            // MCP standard annotations
            ...(schema.title ? { title: schema.title } : {}),
            ...(schema.readOnlyHint ? { readOnlyHint: true } : {}),
            ...(schema.destructiveHint ? { destructiveHint: true } : {}),
            ...(schema.idempotentHint ? { idempotentHint: true } : {}),
            ...(schema.openWorldHint !== undefined ? { openWorldHint: schema.openWorldHint } : {}),
            ...(schema.audience ? { audience: schema.audience } : {}),
            ...(schema.contentPriority !== undefined
              ? { contentPriority: schema.contentPriority }
              : {}),
            ...(schema.outputSchema ? { outputSchema: schema.outputSchema } : {}),
          };
        });

      // Resolve icon images (file paths → data URIs) for methods that have them
      for (const schema of schemas as any[]) {
        if (!schema.iconImages) continue;
        const method = methods.find((m) => m.name === schema.name);
        if (!method) continue;
        const resolved = await resolveIconImages(schema.iconImages, photonPath);
        if (resolved) method.icons = resolved;
      }

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
      const mainMethod = methods.find((m) => m.name === 'main');

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

      // Extract class-level JSDoc block to avoid matching @tags inside template literals
      const classDocblock =
        schemaSource?.match(/\/\*\*[\s\S]*?\*\/\s*(?:export\s+)?(?:default\s+)?class\b/)?.[0] ?? '';
      const isStateful = classDocblock ? /@stateful\b/.test(classDocblock) : false;
      const authMatch = classDocblock?.match(/@auth\b(?:\s+(\S+))?/i);
      const authValue = authMatch ? authMatch[1]?.trim() || 'required' : undefined;

      return {
        id: generatePhotonId(photonPath),
        name,
        ...(routeMeta?.shortName ? { shortName: routeMeta.shortName } : {}),
        ...(routeMeta?.namespace ? { namespace: routeMeta.namespace } : {}),
        ...(routeMeta?.qualifiedName ? { qualifiedName: routeMeta.qualifiedName } : {}),
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
        ...(authValue && { auth: authValue }),
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
        ...(routeMeta?.shortName ? { shortName: routeMeta.shortName } : {}),
        ...(routeMeta?.namespace ? { namespace: routeMeta.namespace } : {}),
        ...(routeMeta?.qualifiedName ? { qualifiedName: routeMeta.qualifiedName } : {}),
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
  const loadUIAsset = async (
    photonName: string,
    uiId: string
  ): Promise<{ content: string; isPhotonTemplate: boolean } | null> => {
    const photon = photons.find((p) => p.name === photonName);
    if (!photon || !photon.configured) return null;

    const photonDir = path.dirname(photon.path);
    const photonBaseName = path.basename(photon.path, '.photon.ts');
    const asset = (photon as any).assets?.ui?.find((u: any) => u.id === uiId);

    let uiPath: string;
    if (asset?.resolvedPath) {
      uiPath = asset.resolvedPath;
    } else {
      // Prefer .photon.html, then .photon.md, fall back to .html
      const photonHtmlPath = path.join(photonDir, photonBaseName, 'ui', `${uiId}.photon.html`);
      const photonMdPath = path.join(photonDir, photonBaseName, 'ui', `${uiId}.photon.md`);
      try {
        await fs.access(photonHtmlPath);
        uiPath = photonHtmlPath;
      } catch {
        try {
          await fs.access(photonMdPath);
          uiPath = photonMdPath;
        } catch {
          uiPath = path.join(photonDir, photonBaseName, 'ui', `${uiId}.html`);
        }
      }
    }

    const isPhotonTemplate = uiPath.endsWith('.photon.html') || uiPath.endsWith('.photon.md');

    try {
      const content = await readText(uiPath);
      return { content, isPhotonTemplate };
    } catch {
      // Fall through to check custom format renderers
    }

    // Check for custom format renderer in assets/formats/
    // Convention: format-<name> maps to assets/formats/<name>.html
    if (uiId.startsWith('format-')) {
      const formatName = uiId.slice('format-'.length);
      const formatPath = path.join(
        photonDir,
        photonBaseName,
        'assets',
        'formats',
        `${formatName}.html`
      );
      try {
        const content = await readText(formatPath);
        return { content, isPhotonTemplate: false };
      } catch {
        // Not found
      }
    }

    return null;
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
    externalMCPs: ctx.externalMCPs,
    externalMCPClients: ctx.externalMCPClients,
    externalMCPSDKClients: ctx.externalMCPSDKClients,
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
      // A2A Agent Card Discovery (Google A2A Protocol)
      // Returns Agent Card describing this agent's capabilities and skills
      // ══════════════════════════════════════════════════════════════════════════
      if (url.pathname === '/.well-known/agent.json') {
        const configuredPhotons = photons
          .filter((p): p is PhotonInfo => p.configured)
          .filter((p) => !p.internal);
        const card = generateAgentCard(
          configuredPhotons.map((p) => ({
            name: p.name,
            description: p.description,
            stateful: p.stateful,
            icon: p.icon,
            methods: p.methods.map((m) => ({
              name: m.name,
              description: m.description,
              params: m.params,
            })),
          })),
          {
            baseUrl: `http://${req.headers.host}`,
            version: PHOTON_VERSION,
          }
        );
        const cardHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        const cardCorsOrigin = getCorsOrigin(req);
        if (cardCorsOrigin) cardHeaders['Access-Control-Allow-Origin'] = cardCorsOrigin;
        res.writeHead(200, cardHeaders);
        res.end(JSON.stringify(card));
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // MCP OAuth Protected Resource Metadata (RFC 9728)
      // Tells MCP clients where to authenticate when @auth is required
      // ══════════════════════════════════════════════════════════════════════════
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        // Find any photon with @auth — use its auth provider URL
        const authPhoton = photons.find(
          (p): p is PhotonInfo => p.configured && !!('auth' in p && p.auth)
        );
        const authValue = authPhoton?.auth;

        if (!authValue || authValue === 'optional') {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No auth-required photons loaded' }));
          return;
        }

        // If @auth is a URL, it's the OIDC provider; otherwise use a placeholder
        const authServer = authValue !== 'required' ? authValue : undefined;
        const serverUrl = `http://${req.headers.host}`;

        const prm: Record<string, unknown> = {
          resource: `${serverUrl}/mcp`,
          bearer_methods_supported: ['header'],
          scopes_supported: ['mcp:tools'],
        };
        if (authServer) {
          prm.authorization_servers = [authServer];
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prm));
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // MCP Server Card (discovery metadata)
      // Returns JSON describing this server's capabilities, tools, and photons
      // ══════════════════════════════════════════════════════════════════════════
      if (url.pathname === '/.well-known/mcp-server') {
        const baseUrl = `http://${req.headers.host}`;
        const card = generateServerCard(photons, { baseUrl });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(card));
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // MCP Streamable HTTP Transport (standard MCP clients like Claude Desktop)
      // Endpoint: /mcp (POST for requests, GET for SSE notifications)
      // ══════════════════════════════════════════════════════════════════════════
      if (url.pathname === '/mcp') {
        const handled = await handleStreamableHTTP(req, res, {
          photons, // Pass all photons including unconfigured for configurationSchema
          photonMCPs,
          externalMCPs: ctx.externalMCPs,
          externalMCPClients: ctx.externalMCPClients,
          externalMCPSDKClients: ctx.externalMCPSDKClients, // SDK clients for tool calls with structuredContent
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
              activeLoads,
              (name, path, isStateful) => {
                if (isStateful) {
                  subscribeStatefulPhoton(name).catch((e) => {
                    logger.debug(`Failed to subscribe stateful photon ${name}: ${e?.message || e}`);
                  });
                  reloadDaemonPhoton(name, path, workingDir).catch((e) => {
                    logger.debug(`Failed to reload daemon photon ${name}: ${e?.message || e}`);
                  });
                }
              }
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
      // Photon Asset Serving — /api/assets/:photon/*
      // Serves files from the photon's assets() directory (images, fonts, etc.)
      // ══════════════════════════════════════════════════════════════════════════
      const assetsMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/(.+)$/);
      if (assetsMatch) {
        const [, photonName, assetPath] = assetsMatch;
        const photon = photons.find((p) => p.name === photonName);
        if (!photon?.configured || !photon.path) {
          res.writeHead(404);
          res.end('Photon not found');
          return;
        }
        // Resolve asset path using the same convention as Photon.assets():
        // preferred {photonDir}/{photonBaseName}/{assetPath}, legacy fallback
        // {photonDir}/{photonBaseName}/assets/{assetPath}.
        const realPath = realpathSync(photon.path);
        const photonDir = path.dirname(realPath);
        const baseName = path.basename(realPath).replace(/\.photon\.(ts|js)$/, '');
        const assetsRoot = path.join(photonDir, baseName);
        const legacyAssetsRoot = path.join(assetsRoot, 'assets');
        const activeRoot = existsSync(assetsRoot) ? assetsRoot : legacyAssetsRoot;
        const fullPath = path.join(activeRoot, assetPath);

        // Security: ensure resolved path is within the assets directory
        if (!fullPath.startsWith(activeRoot)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        try {
          const data = await fs.readFile(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
            '.ico': 'image/x-icon',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.pdf': 'application/pdf',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.ttf': 'font/ttf',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.txt': 'text/plain',
          };
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Asset not found');
        }
        return;
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

      // OAuth callback handler — receives token from OAuth popup and passes to opener
      if (url.pathname === '/auth/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html><head><title>Auth Complete</title></head>
<body>
<script>
  // Extract token from URL hash (implicit flow) or exchange code
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const token = params.get('access_token') || params.get('token');
  const error = params.get('error');

  if (token && window.opener) {
    // Send token back to the Beam window that opened this popup
    window.opener.postMessage({ type: 'photon-auth-token', token }, window.location.origin);
    window.close();
  } else if (error) {
    document.body.textContent = 'Auth error: ' + error;
  } else {
    document.body.textContent = 'Waiting for auth...';
  }
</script>
</body></html>`);
        return;
      }

      // Serve static frontend bundle
      if (url.pathname === '/beam.bundle.js') {
        try {
          const bundlePath = path.join(__dirname, '../../dist/beam.bundle.js');
          const content = await readText(bundlePath);
          res.writeHead(200, {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'no-cache',
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Bundle not found. Run the beam build script first.');
        }
        return;
      }

      // Serve form components bundle (invoke-form + custom inputs for pure-view)
      if (url.pathname === '/beam-form.bundle.js') {
        try {
          const formBundlePath = path.join(__dirname, '../../dist/beam-form.bundle.js');
          const content = await readText(formBundlePath);
          res.writeHead(200, {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'no-cache',
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Form bundle not found. Run the beam build script first.');
        }
        return;
      }

      if (url.pathname === '/beam-ts-worker.js') {
        try {
          const workerPath = path.join(__dirname, '../../dist/beam-ts-worker.js');
          const content = await readText(workerPath);
          res.writeHead(200, {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'no-cache',
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('TS worker not found. Run the beam build script first.');
        }
        return;
      }

      // Standalone PWA app route: /app/{photonName}
      // Full-featured PWA host shell with diagnostics, postMessage bridge, service worker, and install prompt
      const appMatch = url.pathname.match(/^\/app\/([^/]+)$/);
      if (appMatch) {
        const photonName = appMatch[1];
        const photon = beamState.photons.find((p) => p.name === photonName);
        if (!photon) {
          res.writeHead(404);
          res.end(`Photon not found: ${photonName}`);
          return;
        }
        const label =
          (photon as any)?.label ||
          photonName.charAt(0).toUpperCase() + photonName.slice(1).replace(/-/g, ' ');
        const description = (photon as any)?.description || `${label} - Photon App`;
        const iconValue = (photon as any)?.icon || '📦';
        const encodedName = encodeURIComponent(photonName);

        // Sanitize strings for safe embedding in HTML
        const safeLabel = label.replace(
          /[&<>"']/g,
          (c: string) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
        );
        const safeDesc = description.replace(
          /[&<>"']/g,
          (c: string) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
        );

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${safeLabel}</title>
  <meta name="description" content="${safeDesc}">
  <meta name="theme-color" content="#1a1a1a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${safeLabel}">
  <link rel="manifest" href="/api/pwa/manifest.json?photon=${encodedName}">
  <link rel="apple-touch-icon" href="/api/pwa/icon?photon=${encodedName}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a1a; font-family: system-ui, -apple-system, sans-serif; color: #e5e5e5; }
    #app { width: 100%; height: 100vh; }
    iframe { width: 100%; height: 100vh; border: none; display: block; }

    .status-page {
      display: none; width: 100%; height: 100vh;
      flex-direction: column; align-items: center; justify-content: center;
      text-align: center; padding: 40px;
    }
    .status-page.show { display: flex; }
    .status-page .icon { font-size: 64px; margin-bottom: 24px; }
    .status-page h2 { font-size: 20px; font-weight: 600; margin-bottom: 12px; color: #e5e5e5; }
    .status-page p { font-size: 14px; color: #888; max-width: 400px; line-height: 1.6; margin-bottom: 8px; }
    .status-page code {
      display: inline-block; background: #2a2a2a; padding: 8px 16px; border-radius: 6px;
      font-size: 13px; color: #4ade80; font-family: 'SF Mono', Monaco, monospace; margin-top: 8px;
    }
    .status-page .spinner {
      width: 24px; height: 24px; border: 2px solid #333; border-top-color: #4ade80;
      border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-page .retry-btn {
      margin-top: 16px; padding: 8px 20px; background: #333; border: 1px solid #444;
      border-radius: 6px; color: #e5e5e5; cursor: pointer; font-size: 13px; font-family: inherit;
    }
    .status-page .retry-btn:hover { background: #444; }

  </style>
</head>
<body>
  <!-- Status: Starting (shown while waiting for Beam) -->
  <div id="status-starting" class="status-page">
    <div class="spinner"></div>
    <h2>Starting ${safeLabel}...</h2>
    <p>Waiting for Beam server</p>
  </div>

  <!-- Status: Not running (shown when Beam is down) -->
  <div id="status-offline" class="status-page">
    <div class="icon">${iconValue}</div>
    <h2>${safeLabel}</h2>
    <p>Server is not running. Start Photon to use this app:</p>
    <code>photon beam</code>
    <button class="retry-btn" onclick="checkAndLoad()">Retry</button>
  </div>

  <!-- Status: Port conflict -->
  <div id="status-conflict" class="status-page">
    <div class="icon">⚠️</div>
    <h2>Port Conflict</h2>
    <p id="conflict-msg">Another process is using the required port.</p>
    <code id="conflict-cmd"></code>
    <button class="retry-btn" onclick="checkAndLoad()">Retry</button>
  </div>

  <!-- App container with iframe -->
  <div id="app" style="display:none"></div>

  <script>
    const PHOTON = ${JSON.stringify(photonName)};
    const appEl = document.getElementById('app');
    const statusStarting = document.getElementById('status-starting');
    const statusOffline = document.getElementById('status-offline');
    const statusConflict = document.getElementById('status-conflict');
    let retryTimer = null;

    function hideAll() {
      statusStarting.classList.remove('show');
      statusOffline.classList.remove('show');
      statusConflict.classList.remove('show');
      appEl.style.display = 'none';
    }

    // Diagnostics-first loading: check server health before loading the app
    async function checkAndLoad() {
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      hideAll();
      statusStarting.classList.add('show');

      try {
        const res = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('Server error');
        const diag = await res.json();

        // Check for port conflicts
        if (diag.portConflict) {
          hideAll();
          statusConflict.classList.add('show');
          const conflictMsg = document.getElementById('conflict-msg');
          const conflictCmd = document.getElementById('conflict-cmd');
          if (diag.portConflict.port) {
            conflictMsg.textContent = 'Port ' + diag.portConflict.port + ' is in use by another process.';
          }
          if (diag.portConflict.pid) {
            conflictCmd.textContent = 'kill ' + diag.portConflict.pid;
          }
          return;
        }

        // Server is healthy — establish MCP session then load the app
        hideAll();
        appEl.style.display = 'block';
        await connectSSE();
        await loadApp();
      } catch (err) {
        // Server unreachable — show offline state with auto-retry
        hideAll();
        statusOffline.classList.add('show');
        retryTimer = setInterval(async () => {
          try {
            const res = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              clearInterval(retryTimer);
              retryTimer = null;
              checkAndLoad();
            }
          } catch { /* still offline */ }
        }, 3000);
      }
    }

    // Load the @ui template into a full-viewport iframe with platform bridge.
    // Discovers template URL client-side: tries class-level @ui first (/api/template),
    // then falls back to method-level @ui by querying diagnostics for the app entry's linkedUi.
    async function loadApp() {
      try {
        // Step 1: Discover the template URL
        let templateUrl = '/api/template?photon=' + encodeURIComponent(PHOTON);
        let bridgeMethod = 'main';

        // Try class-level @ui first
        let templateRes = await fetch(templateUrl, { signal: AbortSignal.timeout(10000) });
        if (!templateRes.ok) {
          // Fall back: query diagnostics for this photon's appEntry linkedUi
          const diagRes = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(10000) });
          if (diagRes.ok) {
            const diag = await diagRes.json();
            const photonInfo = (diag.photons || []).find(function(p) { return p.name === PHOTON; });
            if (photonInfo && photonInfo.appEntry && photonInfo.appEntry.linkedUi) {
              templateUrl = '/api/ui?photon=' + encodeURIComponent(PHOTON) + '&id=' + encodeURIComponent(photonInfo.appEntry.linkedUi);
              bridgeMethod = photonInfo.appEntry.name || 'main';
              templateRes = await fetch(templateUrl, { signal: AbortSignal.timeout(10000) });
            }
          }
          if (!templateRes.ok) throw new Error('Template not available');
        }

        // Step 2: Fetch platform bridge script
        const bridgeRes = await fetch('/api/platform-bridge?photon=' + encodeURIComponent(PHOTON) + '&method=' + encodeURIComponent(bridgeMethod) + '&theme=dark', { signal: AbortSignal.timeout(10000) });

        let templateHtml = await templateRes.text();
        const bridgeScript = bridgeRes.ok ? await bridgeRes.text() : '';

        // Inject platform bridge before </head>
        if (templateHtml.includes('</head>')) {
          templateHtml = templateHtml.replace('</head>', bridgeScript + '</head>');
        } else {
          templateHtml = '<html><head>' + bridgeScript + '</head><body>' + templateHtml + '</body></html>';
        }

        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-modals');

        const blob = new Blob([templateHtml], { type: 'text/html' });
        iframe.src = URL.createObjectURL(blob);

        appEl.innerHTML = '';
        appEl.appendChild(iframe);
        initBridge(iframe, bridgeMethod);
      } catch (err) {
        appEl.innerHTML = '';
        const statusDiv = document.createElement('div');
        statusDiv.className = 'status-page show';

        const icon = document.createElement('div');
        icon.className = 'icon';
        icon.textContent = '⚠️';

        const h2 = document.createElement('h2');
        h2.textContent = 'Failed to load';

        const p = document.createElement('p');
        p.textContent = err.message;

        const btn = document.createElement('button');
        btn.className = 'retry-btn';
        btn.textContent = 'Retry';
        btn.addEventListener('click', () => checkAndLoad());

        statusDiv.append(icon, h2, p, btn);
        appEl.appendChild(statusDiv);
      }
    }

    // postMessage bridge: relays JSON-RPC from iframe through MCP for full event pipeline
    var mcpSessionId = null;
    var mcpCallId = 100;

    function initBridge(iframe, bridgeMethod) {
      window.addEventListener('message', async (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;

        // Handle MCP Apps ui/initialize request — respond so bridge sends initialized
        if (msg.jsonrpc === '2.0' && msg.method === 'ui/initialize' && msg.id != null) {
          iframe.contentWindow.postMessage({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2026-01-26',
              hostInfo: { name: 'photon-pwa', version: '1.0.0' },
              hostCapabilities: {},
              hostContext: { theme: 'dark' },
            },
          }, '*');
          return;
        }

        // Handle JSON-RPC tools/call from iframe — route through MCP for event broadcasting
        if (msg.jsonrpc === '2.0' && msg.method === 'tools/call' && msg.id != null) {
          const { name: toolName, arguments: toolArgs } = msg.params || {};
          // Prefix with photon name if not already prefixed (bridge sends bare method names)
          var fullToolName = toolName.includes('/') ? toolName : PHOTON + '/' + toolName;
          try {
            var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
            var mcpRes = await fetch('/mcp', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({
                jsonrpc: '2.0', id: mcpCallId++,
                method: 'tools/call',
                params: { name: fullToolName, arguments: toolArgs || {} },
              }),
              signal: AbortSignal.timeout(60000),
            });
            var mcpData = await mcpRes.json();
            // Extract result from MCP response (content array → structured or text)
            var result = undefined;
            var error = undefined;
            if (mcpData.error) {
              error = { code: mcpData.error.code || -32000, message: mcpData.error.message || 'Unknown error' };
            } else if (mcpData.result) {
              var content = mcpData.result.content || [];
              var textParts = content.filter(function(c) { return c.type === 'text'; });
              if (textParts.length > 0) {
                try { result = JSON.parse(textParts[0].text); } catch(e) { result = textParts[0].text; }
              }
              if (mcpData.result.structuredContent) result = mcpData.result.structuredContent;
            }
            iframe.contentWindow.postMessage({
              jsonrpc: '2.0', id: msg.id, result: result, error: error,
            }, '*');
          } catch (err) {
            iframe.contentWindow.postMessage({
              jsonrpc: '2.0', id: msg.id,
              error: { code: -32000, message: err.message },
            }, '*');
          }
        }
      });

      // Send photon:init context to iframe once loaded
      iframe.onload = () => {
        iframe.contentWindow.postMessage({
          type: 'photon:init',
          context: { photon: PHOTON, theme: 'dark', displayMode: 'standalone' }
        }, '*');
      };

      // Wait for bridge ready signal, then auto-invoke main() and deliver result
      var bridgeReady = false;
      window.addEventListener('message', async function onReady(e) {
        if (bridgeReady) return;
        var msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        // Bridge sends both legacy photon:ready and MCP Apps ui/notifications/initialized
        var isReady = msg.type === 'photon:ready' ||
          (msg.jsonrpc === '2.0' && msg.method === 'ui/notifications/initialized');
        if (!isReady) return;
        bridgeReady = true;
        window.removeEventListener('message', onReady);

        try {
          var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
          if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
          var invokeRes = await fetch('/mcp', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              jsonrpc: '2.0', id: mcpCallId++,
              method: 'tools/call',
              params: { name: PHOTON + '/' + bridgeMethod, arguments: {} },
            }),
            signal: AbortSignal.timeout(30000),
          });
          var mcpData = await invokeRes.json();
          if (!mcpData.error && mcpData.result) {
            var content = mcpData.result.content || [];
            var textParts = content.filter(function(c) { return c.type === 'text'; });
            var result = undefined;
            if (textParts.length > 0) {
              try { result = JSON.parse(textParts[0].text); } catch(e) { result = textParts[0].text; }
            }
            if (mcpData.result.structuredContent) result = mcpData.result.structuredContent;
            if (result !== undefined) {
              iframe.contentWindow.postMessage({
                jsonrpc: '2.0',
                method: 'ui/notifications/tool-result',
                params: { result: result },
              }, '*');
            }
          }
        } catch (err) {
          console.warn('[PWA] Auto-invoke failed:', err.message);
        }
      });
    }

    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('[PWA] SW registered:', reg.scope))
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    }

    // --- Real-time SSE subscription for cross-client sync ---
    async function connectSSE() {
      try {
        // Step 1: Initialize MCP session as beam client to get session ID
        var initRes = await fetch('/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              clientInfo: { name: 'beam', version: '1.0.0' },
              capabilities: {}
            }
          })
        });
        var sessionId = initRes.headers.get('mcp-session-id');
        if (!sessionId) return;
        mcpSessionId = sessionId;

        // Step 2: Open SSE on the same session
        var sseUrl = '/mcp?sessionId=' + encodeURIComponent(sessionId);
        var es = new EventSource(sseUrl);
        es.onmessage = function(event) {
          try {
            var msg = JSON.parse(event.data);
            if (msg.type === 'keepalive') return;
            var iframe = document.querySelector('iframe');
            if (!iframe || !iframe.contentWindow) return;

            // Handle @stateful state-changed events — re-invoke main() to refresh UI
            if (msg.method === 'state-changed' && msg.params?.photon === PHOTON) {
              // Re-fetch data by calling main() and delivering result to iframe
              var refreshHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
              if (mcpSessionId) refreshHeaders['Mcp-Session-Id'] = mcpSessionId;
              fetch('/mcp', {
                method: 'POST',
                headers: refreshHeaders,
                body: JSON.stringify({
                  jsonrpc: '2.0', id: mcpCallId++,
                  method: 'tools/call',
                  params: { name: PHOTON + '/' + bridgeMethod, arguments: {} },
                }),
                signal: AbortSignal.timeout(15000),
              }).then(function(r) { return r.json(); }).then(function(mcpData) {
                if (!mcpData.error && mcpData.result) {
                  var content = mcpData.result.content || [];
                  var textParts = content.filter(function(c) { return c.type === 'text'; });
                  var result = undefined;
                  if (textParts.length > 0) {
                    try { result = JSON.parse(textParts[0].text); } catch(e) { result = textParts[0].text; }
                  }
                  if (mcpData.result.structuredContent) result = mcpData.result.structuredContent;
                  if (result !== undefined) {
                    iframe.contentWindow.postMessage({
                      jsonrpc: '2.0',
                      method: 'ui/notifications/tool-result',
                      params: { result: result },
                    }, '*');
                  }
                }
              }).catch(function() {});
              return;
            }

            // Forward other events to iframe
            if (msg.method === 'photon/board-update') {
              iframe.contentWindow.postMessage({
                jsonrpc: '2.0',
                method: 'photon/notifications/emit',
                params: { emit: 'board-update', ...msg.params },
              }, '*');
            } else if (msg.method === 'photon/channel-event') {
              iframe.contentWindow.postMessage({
                jsonrpc: '2.0',
                method: 'photon/notifications/emit',
                params: msg.params,
              }, '*');
            }
          } catch (e) {}
        };
        es.onerror = function() {
          es.close();
          setTimeout(connectSSE, 5000);
        };
      } catch (e) {
        setTimeout(connectSSE, 5000);
      }
    }

    // Start the diagnostics-first loading flow
    checkAndLoad();
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // Pure view mode — serve lightweight bridge-powered page (no beam-app shell).
      // All view modes (form, result, embed) use pure-view.html with the bridge.
      // Form views lazy-load the form-components bundle for custom inputs.
      const viewParam = url.searchParams.get('view');
      if (
        (viewParam === 'result' || viewParam === 'embed' || viewParam === 'form') &&
        url.pathname !== '/' &&
        !url.pathname.startsWith('/api')
      ) {
        try {
          const pathParts = url.pathname.split('/').filter(Boolean);
          const photonName = pathParts[0] || '';
          const methodName = pathParts[1] || '';
          const params: Record<string, string> = {};
          for (const [k, v] of url.searchParams) {
            if (k !== 'view') params[k] = v;
          }

          const pureViewPath = path.join(__dirname, 'frontend/pure-view.html');
          let html = await readText(pureViewPath);

          // Replace placeholders
          const argsJson = escapeHtml(JSON.stringify(params));
          html = html
            .replaceAll('__PHOTON__', encodeURIComponent(photonName))
            .replaceAll('__METHOD__', escapeHtml(methodName))
            .replaceAll('__ARGS__', argsJson);

          // Add data-view for form and result modes
          if (viewParam === 'form' || viewParam === 'result') {
            html = html.replace(
              'data-method=',
              `data-view="${escapeHtml(viewParam)}" data-method=`
            );
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } catch (err) {
          res.writeHead(500);
          res.end('Error serving pure view: ' + String(err));
        }
        return;
      }

      // Default route: Serve Lit App
      if (url.pathname === '/' || !url.pathname.startsWith('/api')) {
        try {
          const indexPath = path.join(__dirname, 'frontend/index.html');
          let content = await readText(indexPath);
          // Inject shell integration flag so frontend can strip CLI prefix
          if (_shellIntegrationInstalled) {
            content = content.replace(
              '</head>',
              '<script>window.__PHOTON_SHELL_INIT=true</script></head>'
            );
          }
          // Note: ?view=form and ?view=result are handled by pure-view.html above.
          // This default route only serves the full Beam app for the main UI.
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

    // React to .photon.ts file changes — both top-level and namespaced subdirectories.
    // Top-level: foo.photon.ts → "foo"
    // Namespaced: Arul-/git-box.photon.ts → "git-box" (short name only)
    if (relativePath.endsWith('.photon.ts')) {
      // For namespaced paths, look up by file path first to respect disambiguated
      // names like "chat (1)" / "chat (2)" assigned at startup
      let resolvedPath: string;
      try {
        resolvedPath = realpathSync(changedPath);
      } catch {
        resolvedPath = changedPath;
      }
      const byPath = photons.find((p) => {
        try {
          return realpathSync(p.path) === resolvedPath;
        } catch {
          return p.path === changedPath;
        }
      });
      if (byPath) return byPath.name;

      // New photon — derive short name from filename
      const withoutExt = relativePath.slice(0, -'.photon.ts'.length);
      const slashIndex = withoutExt.lastIndexOf(path.sep);
      return slashIndex >= 0 ? withoutExt.slice(slashIndex + 1) : withoutExt;
    }

    // Detect asset changes for local (non-symlinked) photons.
    // Runtime data now lives in .data/ (filtered above), so any remaining
    // file under {photonName}/ is a legitimate asset (ui/, etc.).
    for (const p of photons) {
      if (relativePath.startsWith(p.name + path.sep)) {
        return p.name;
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
            let photonPath: string;
            if (!isNewPhoton) {
              photonPath = photons[photonIndex].path;
            } else {
              // Try flat path first, then search namespace subdirectories
              const flatPath = path.join(workingDir, `${photonName}.photon.ts`);
              if (existsSync(flatPath)) {
                photonPath = flatPath;
              } else {
                // Search namespace dirs (one level deep) for the photon file
                let found: string | null = null;
                try {
                  const entries = await fs.readdir(workingDir, { withFileTypes: true });
                  for (const entry of entries) {
                    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
                    const candidate = path.join(workingDir, entry.name, `${photonName}.photon.ts`);
                    if (existsSync(candidate)) {
                      found = candidate;
                      break;
                    }
                  }
                } catch {
                  // readdir failed
                }
                photonPath = found || flatPath;
              }
            }
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
                const rawContent = await readText(photonPath);
                if (rawContent.trim().length === 0) {
                  const className = photonName
                    .split(/[-_]/)
                    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('');
                  const scaffold = `/**\n * ${className} Photon\n */\n\nexport default class ${className} {\n  /**\n   * Example tool\n   * @param message Message to echo\n   */\n  async echo(params: { message: string }) {\n    return \`Echo: \${params.message}\`;\n  }\n}\n`;
                  await writeText(photonPath, scaffold);
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
                const source = await readText(photonPath);
                await writePhotonEditorDeclaration(photonPath, source, workingDir).catch((e) => {
                  logger.debug(
                    `Failed to write editor declaration for ${photonPath}: ${e?.message || e}`
                  );
                });
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
              const reloadSource = await readText(photonPath);
              await writePhotonEditorDeclaration(photonPath, reloadSource, workingDir).catch(
                () => {}
              );
              const reloadMetadata = extractor.extractAllFromSource(reloadSource);
              const schemas = reloadMetadata.tools;
              const templates = reloadMetadata.templates;
              (mcp as any).schemas = schemas; // Store schemas for result rendering

              // Update notification subscriptions for reloaded photon
              if (reloadMetadata.notificationSubscriptions?.watchFor) {
                ctx.photonNotificationSubscriptions.set(
                  photonName,
                  reloadMetadata.notificationSubscriptions.watchFor
                );
              } else {
                ctx.photonNotificationSubscriptions.delete(photonName);
              }

              const lifecycleMethods = ['onInitialize', 'onShutdown', 'constructor'];
              const uiAssets = mcp.assets?.ui || [];
              const methods: MethodInfo[] = schemas
                .filter((schema: any) => !lifecycleMethods.includes(schema.name))
                .map((schema: any) => {
                  const linkedAsset = uiAssets.find(
                    (ui: any) =>
                      ui.linkedTool === schema.name || ui.linkedTools?.includes(schema.name)
                  );
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
                    // MCP standard annotations
                    ...(schema.title ? { title: schema.title } : {}),
                    ...(schema.readOnlyHint ? { readOnlyHint: true } : {}),
                    ...(schema.destructiveHint ? { destructiveHint: true } : {}),
                    ...(schema.idempotentHint ? { idempotentHint: true } : {}),
                    ...(schema.openWorldHint !== undefined
                      ? { openWorldHint: schema.openWorldHint }
                      : {}),
                    ...(schema.audience ? { audience: schema.audience } : {}),
                    ...(schema.contentPriority !== undefined
                      ? { contentPriority: schema.contentPriority }
                      : {}),
                    ...(schema.outputSchema ? { outputSchema: schema.outputSchema } : {}),
                  };
                });

              // Resolve icon images for hot-reloaded methods
              for (const schema of schemas as any[]) {
                if (!schema.iconImages) continue;
                const method = methods.find((m: MethodInfo) => m.name === schema.name);
                if (!method) continue;
                const resolved = await resolveIconImages(schema.iconImages, photonPath);
                if (resolved) method.icons = resolved;
              }

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
              const mainMethod = methods.find((m) => m.name === 'main');

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
              const reloadAuthMatch = reloadSource.match(/@auth\b(?:\s+(\S+))?/i);
              const reloadAuthValue = reloadAuthMatch
                ? reloadAuthMatch[1]?.trim() || 'required'
                : undefined;
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
                ...(reloadAuthValue && { auth: reloadAuthValue }),
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

              // Subscribe to state-changed events for newly discovered stateful photons
              if (isStateful) {
                subscribeStatefulPhoton(photonName).catch((err) => {
                  logger.warn(
                    `Failed to subscribe dynamically to ${photonName}: ${getErrorMessage(err)}`
                  );
                });
                // Tell daemon to reload so its instance has the new methods/code
                reloadDaemonPhoton(photonName, photonPath, workingDir).catch((err) => {
                  logger.debug(`Daemon reload for ${photonName}: ${getErrorMessage(err)}`);
                });
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
                  const source = await readText(photonPath);
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
      // Skip all runtime data — .data/ contains all photon data, never source code
      if (filename.startsWith('.data' + path.sep) || filename === '.data') return;
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

  // Load external MCPs from config
  const externalMCPList = await loadExternalMCPs(savedConfig);
  ctx.externalMCPs.push(...externalMCPList);

  // Mark startup complete — flushes queued output and restores console
  startup.ready();

  // Notify connected clients that photon list is now available
  broadcastPhotonChange();

  // Subscribe a single stateful photon to its state-changed daemon channel.
  // Extracted so it can be called both at startup and when new photons are discovered.
  async function subscribeStatefulPhoton(photonName: string): Promise<void> {
    const instanceNames = ['default'];
    for (const instanceName of instanceNames) {
      const channel = `${photonName}:${instanceName}:state-changed`;
      if (ctx.subscribedStateChannels.has(channel)) continue;
      ctx.subscribedStateChannels.add(channel);

      subscribeChannel(
        photonName,
        channel,
        (message: any) => {
          // Sync Beam's local instance from the daemon-persisted state file BEFORE
          // notifying the frontend. The daemon persists state to disk after mutations,
          // and Beam's local instance must match before _silentRefresh re-queries it.
          void (async () => {
            if (message?.patch?.length > 0) {
              const mcp = photonMCPs.get(photonName);
              if (mcp?.instance) {
                const instName = instanceName || 'default';
                const stateFile = path.join(workingDir, 'state', photonName, `${instName}.json`);
                try {
                  const state = await readJSONFile(stateFile);
                  for (const [key, value] of Object.entries(state)) {
                    const target = mcp.instance[key];
                    if (target && typeof target.splice === 'function' && Array.isArray(value)) {
                      target.splice(0, target.length, ...value);
                    } else {
                      mcp.instance[key] = value;
                    }
                  }
                } catch {
                  // State file not yet written — ignore
                  // State file not yet written — ignore
                }
              }
            }
            if (message?.instance === instanceName || !message?.instance) {
              broadcastNotification('state-changed', {
                photon: photonName,
                instance: instanceName,
                patches: message?.patches,
                method: message?.method,
                params: message?.params,
                data: message?.data,
                ...(message?.patch && { patch: message.patch }),
                ...(message?.inversePatch && { inversePatch: message.inversePatch }),
              });
            }
          })();
        },
        {
          reconnect: true,
          workingDir,
          onReconnect: () => logger.debug(`📡 Reconnected ${channel} subscription`),
          onRefreshNeeded: () => {
            logger.info(`📡 Refresh needed for ${channel} (events lost during daemon restart)`);
            broadcastNotification('state-changed', {
              photon: photonName,
              instance: instanceName,
              method: '_refresh',
              patches: undefined,
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
  }

  // Auto-start daemon and subscribe to state-changed events for stateful photons
  // Uses reconnect: true so subscriptions survive daemon restarts
  const statefulPhotons = photons.filter((p) => p.stateful && p.configured);
  if (statefulPhotons.length > 0) {
    try {
      await ensureDaemon();
      for (const photon of statefulPhotons) {
        await subscribeStatefulPhoton(photon.name);
      }
    } catch (err) {
      logger.warn(`Failed to start daemon for stateful photons: ${getErrorMessage(err)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NOTIFICATION SUBSCRIPTIONS - Subscribe to all photon notification channels
  // ═══════════════════════════════════════════════════════════════════════════════
  // Unlike state-changed (active photon only), notifications are always subscribed
  // but filtered server-side based on each photon's @notify-on declarations
  if (statefulPhotons.length > 0) {
    try {
      for (const photon of statefulPhotons) {
        const photonName = photon.name;
        const instanceName = 'default'; // TODO: support multi-instance notifications

        // Subscribe to notifications channel (always-on, not just active)
        const notificationChannel = `${photonName}:${instanceName}:notifications`;

        // Get this photon's notification subscriptions from @notify-on tags
        const watchFor = ctx.photonNotificationSubscriptions.get(photonName);

        subscribeChannel(
          photonName,
          notificationChannel,
          (message: any) => {
            // Check if this photon cares about this notification type
            if (!watchFor || !watchFor.includes(message?.type)) {
              logger.debug(
                `📡 Notification filtered: ${photonName} doesn't care about "${message?.type}"`
              );
              return; // Don't broadcast notifications this photon doesn't care about
            }

            // Only broadcast relevant notifications
            logger.debug(`📡 Broadcasting notification: ${photonName} [${message?.type}]`);
            broadcastNotification('photon/notification', {
              photon: photonName,
              type: message?.type,
              priority: message?.priority || 'info',
              message: message?.message,
              ...(message?.action && { action: message.action }),
              ...(message?.sound && { sound: message.sound }),
              ...(message?.data && { data: message.data }),
            });
          },
          {
            reconnect: true,
            workingDir,
            onReconnect: () => logger.debug(`📡 Reconnected ${notificationChannel} subscription`),
          }
        )
          .then(() => {
            logger.info(
              `📡 Subscribed to ${notificationChannel} for notifications${watchFor ? ` (watching: ${watchFor.join(', ')})` : ''}`
            );
          })
          .catch((err) => {
            logger.warn(`Failed to subscribe to ${notificationChannel}: ${getErrorMessage(err)}`);
          });
      }
    } catch (err) {
      logger.warn(`Failed to set up notification subscriptions: ${getErrorMessage(err)}`);
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
            const data = await readJSONFile(configFile);
            newConfig = migrateConfig(data);
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
            const idx = ctx.externalMCPs.findIndex((m) => m.name === name);
            if (idx !== -1) ctx.externalMCPs.splice(idx, 1);

            const sdkClient = ctx.externalMCPSDKClients.get(name);
            if (sdkClient) removedSdkClients.push({ name, client: sdkClient });
            ctx.externalMCPSDKClients.delete(name);
            ctx.externalMCPClients.delete(name);

            logger.info(`🔌 Removed external MCP: ${name}`);
          }
          // Close SDK clients after all Maps are consistent
          for (const { name: _name, client } of removedSdkClients) {
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
            ctx.externalMCPs.push(...newMCPs);
            for (const m of newMCPs) {
              logger.info(
                `🔌 Added external MCP: ${m.name} (${m.connected ? m.methods.length + ' tools' : 'failed'})`
              );
            }
          }

          // Reconnect modified MCPs — synchronous cleanup first, then async reconnect
          const modifiedSdkClients: Array<{ name: string; client: any }> = [];
          for (const name of modified) {
            const idx = ctx.externalMCPs.findIndex((m) => m.name === name);
            if (idx !== -1) ctx.externalMCPs.splice(idx, 1);

            const sdkClient = ctx.externalMCPSDKClients.get(name);
            if (sdkClient) modifiedSdkClients.push({ name, client: sdkClient });
            ctx.externalMCPSDKClients.delete(name);
            ctx.externalMCPClients.delete(name);
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
            ctx.externalMCPs.push(...reconnected);
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
  // Stop session cleanup timer
  stopSessionCleanup();

  // Close all SDK clients gracefully
  const closePromises: Promise<void>[] = [];

  for (const [, client] of ctx.externalMCPSDKClients) {
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

  ctx.externalMCPSDKClients.clear();
  ctx.externalMCPClients.clear();
}
