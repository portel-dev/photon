/**
 * Browse, UI, and PWA route handlers.
 *
 * Extracted from beam.ts — handles:
 *   /api/browse          – File browser API
 *   /api/local-file      – Serve local files (images in markdown, etc.)
 *   /api/photon-workdir  – Resolve photon working directory
 *   /api/ui              – Serve UI templates for custom UI rendering
 *   /api/mcp-app         – Serve MCP App HTML from external MCPs
 *   /api/template        – Serve @ui template files (class-level custom UI)
 *   /api/pwa/manifest.json – Auto-generated PWA manifest
 *   /api/pwa/icon         – PWA icon (file from assets, or auto-generated SVG from emoji)
 *   /api/pwa/app          – PWA app entry with bridge injection + client-side PNG generation
 */

import * as fs from 'fs/promises';
import { lstatSync, realpathSync } from 'fs';
import * as path from 'path';
import { isPathWithin } from '../../../shared/security.js';
import { logger } from '../../../shared/logger.js';
import type { PhotonInfo } from '../../types.js';
import type { BeamState, RouteHandler } from '../types.js';

export const handleBrowseRoutes: RouteHandler = async (req, res, url, state) => {
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
      root = state.workingDir;
    }

    const dirPath = url.searchParams.get('path') || root;

    try {
      const resolved = path.resolve(dirPath);

      // Security: always enforce path boundary using isPathWithin
      if (!isPathWithin(resolved, root)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Access denied: outside allowed directory' }));
        return true;
      }

      const stat = await fs.stat(resolved);

      if (!stat.isDirectory()) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Not a directory' }));
        return true;
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
    return true;
  }

  // Serve a local file (for relative image paths in markdown previews, etc.)
  if (url.pathname === '/api/local-file') {
    const filePath = url.searchParams.get('path');
    if (!filePath) {
      res.writeHead(400);
      res.end('Missing path parameter');
      return true;
    }

    const resolved = path.resolve(filePath);

    // Security: prevent path traversal — file must be within working directory
    if (!isPathWithin(resolved, state.workingDir)) {
      res.writeHead(403);
      res.end('Access denied: outside allowed directory');
      return true;
    }

    try {
      const fileStat = await fs.stat(resolved);
      if (!fileStat.isFile()) {
        res.writeHead(400);
        res.end('Not a file');
        return true;
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
    return true;
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
          defaultWorkdir: state.workingDir,
        })
      );
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
    if (!photon) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Photon not found' }));
      return true;
    }

    // For filesystem photon, use BEAM's working directory
    // This ensures the file browser shows the same files BEAM is managing
    let photonWorkdir: string | null = null;
    if (photonName === 'filesystem') {
      photonWorkdir = state.workingDir;
    }

    res.writeHead(200);
    res.end(
      JSON.stringify({
        name: photonName,
        workdir: photonWorkdir,
        defaultWorkdir: state.workingDir,
      })
    );
    return true;
  }

  // Serve UI templates for custom UI rendering
  if (url.pathname === '/api/ui') {
    const photonName = url.searchParams.get('photon');
    const uiId = url.searchParams.get('id');

    if (!photonName || !uiId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing photon or id parameter' }));
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
    if (!photon) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Photon not found' }));
      return true;
    }

    // UI templates are in <photon-dir>/<photon-name>/ui/<id>.html
    // For symlinked photons, resolve to the origin so assets are served
    // from the source repo (not the symlink location).
    const resolvedPhotonPath = lstatSync(photon.path).isSymbolicLink()
      ? realpathSync(photon.path)
      : photon.path;
    const photonDir = path.dirname(resolvedPhotonPath);

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
    return true;
  }

  // Serve MCP App HTML from external MCPs with MCP Apps Extension
  if (url.pathname === '/api/mcp-app') {
    const mcpName = url.searchParams.get('mcp');
    const resourceUri = url.searchParams.get('uri');

    if (!mcpName || !resourceUri) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing mcp or uri parameter' }));
      return true;
    }

    const sdkClient = state.externalMCPSDKClients.get(mcpName);
    if (!sdkClient) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `MCP not found or no SDK client: ${mcpName}` }));
      return true;
    }

    try {
      const resourceResult = await sdkClient.readResource({ uri: resourceUri });
      const content = resourceResult.contents?.[0];
      if (!content) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Resource not found: ${resourceUri}` }));
        return true;
      }

      // Content can have either text or blob
      const contentText = 'text' in content ? content.text : null;
      const contentBlob = 'blob' in content ? content.blob : null;

      if (!contentText && !contentBlob) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Resource has no content: ${resourceUri}` }));
        return true;
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
      logger.error(`Failed to read MCP App resource: ${String(error)}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: `Failed to read resource: ${String(error)}` }));
    }
    return true;
  }

  // Serve @ui template files (class-level custom UI)
  if (url.pathname === '/api/template') {
    const photonName = url.searchParams.get('photon');
    const templatePathParam = url.searchParams.get('path');

    if (!photonName) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing photon parameter' }));
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
    if (!photon || !photon.configured) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Photon not found or not configured' }));
      return true;
    }

    // Use provided path or photon's templatePath
    const templateFile = templatePathParam || photon.templatePath;
    if (!templateFile) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'No template path specified' }));
      return true;
    }

    // Resolve template path relative to photon's directory
    const photonDir = path.dirname(photon.path);

    // Security: reject absolute template paths — must be relative to photon dir
    if (path.isAbsolute(templateFile)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Absolute template paths are not allowed' }));
      return true;
    }

    const fullTemplatePath = path.join(photonDir, templateFile);

    // Security: validate resolved path is within photon directory
    if (!isPathWithin(fullTemplatePath, photonDir)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Template path traversal detected' }));
      return true;
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
    return true;
  }

  // PWA Manifest - Auto-generated for any photon
  // NOTE: The initial manifest contains only the SVG icon. The PWA host page
  // performs client-side canvas rendering to generate 192x192 and 512x512 PNG
  // icons, then replaces <link rel="manifest"> with a blob URL manifest that
  // includes the raster PNGs. This satisfies Chrome's installability criteria
  // without requiring any server-side image processing dependencies.
  if (url.pathname === '/api/pwa/manifest.json') {
    const photonName = url.searchParams.get('photon');

    // Without a photon param, return a generic Beam manifest (allows Chrome
    // to evaluate installability before a specific photon is selected)
    const displayName = photonName
      ? state.photons.find((p) => p.name === photonName)?.name || photonName
      : 'Photon Beam';
    const description = photonName
      ? (state.photons.find((p) => p.name === photonName) as any)?.description ||
        `${displayName} - Photon App`
      : 'Photon MCP Runtime';
    const startUrl = photonName ? `/${encodeURIComponent(photonName)}` : '/';
    const encodedIcon = photonName ? encodeURIComponent(photonName) : '';

    const manifest = {
      name: displayName,
      short_name: displayName,
      description,
      start_url: startUrl,
      display: 'standalone' as const,
      background_color: '#1a1a1a',
      theme_color: '#1a1a1a',
      orientation: 'any',
      icons: photonName
        ? [
            {
              src: `/api/pwa/icon?photon=${encodedIcon}`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ]
        : [
            {
              src:
                'data:image/svg+xml,' +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="102" fill="#1a1a1a"/><text x="256" y="340" text-anchor="middle" font-size="280" fill="white">⚡</text></svg>'
                ),
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
    return true;
  }

  // PWA Icon - Serves the photon icon from one of three sources:
  //   1. PNG/SVG file from the photon's asset folder (@icon my-icon.png)
  //   2. Auto-generated SVG from an emoji (@icon 📦, or default)
  if (url.pathname === '/api/pwa/icon') {
    const photonName = url.searchParams.get('photon');
    const photon = state.photons.find((p) => p.name === photonName);
    const iconValue = (photon as any)?.icon || '📦';

    // Check if icon is a file path (has a file extension)
    const isFilePath = /\.\w{2,4}$/.test(iconValue);

    if (isFilePath && photon?.path) {
      // Resolve icon file from photon's asset folder: {dir}/{photonName}/{iconValue}
      const photonDir = path.dirname(photon.path);
      const photonBasename = path.basename(photon.path, '.photon.ts');
      const iconPath = path.resolve(photonDir, photonBasename, iconValue);

      // Security: ensure the resolved path is within the photon directory
      if (!isPathWithin(iconPath, photonDir)) {
        res.writeHead(403);
        res.end('Icon path escapes photon directory');
        return true;
      }

      try {
        const iconBuffer = await fs.readFile(iconPath);
        const ext = path.extname(iconPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.writeHead(200);
        res.end(iconBuffer);
        return true;
      } catch {
        // File not found — fall through to emoji SVG generation
        logger.warn(`PWA icon file not found: ${iconPath}, falling back to emoji`);
      }
    }

    // Emoji-based SVG icon (default fallback)
    const emoji = isFilePath ? '📦' : iconValue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#1a1a1a"/>
  <text x="50" y="50" font-size="50" text-anchor="middle" dominant-baseline="central">${emoji}</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.writeHead(200);
    res.end(svg);
    return true;
  }

  // PWA App Entry - Serves the photon UI with PWA tags injected
  if (url.pathname === '/api/pwa/app') {
    const photonName = url.searchParams.get('photon');

    if (!photonName) {
      res.writeHead(400);
      res.end('Missing photon parameter');
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
    if (!photon) {
      res.writeHead(404);
      res.end(`Photon not found: ${photonName}`);
      return true;
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
  <link rel="apple-touch-icon" href="/api/pwa/icon?photon=${encodeURIComponent(photonName)}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { min-height: 100%; background: #1a1a1a; font-family: system-ui, sans-serif; color: #e5e5e5; }
    .app-container { display: flex; flex-direction: column; min-height: 100vh; }
    .app-frame { flex: 1; min-height: 80vh; }
    iframe { width: 100%; height: 100%; min-height: 80vh; border: none; }

    .status-page {
      display: none;
      height: 100vh;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #888;
      text-align: center;
      padding: 40px;
    }
    .status-page.show { display: flex; }
    .status-page h1 { font-size: 48px; margin-bottom: 20px; }
    .status-page h2 { font-size: 20px; color: #e5e5e5; margin-bottom: 12px; }
    .status-page p { font-size: 16px; margin-bottom: 20px; max-width: 480px; line-height: 1.6; }
    .status-page code {
      display: block;
      background: #2a2a2a;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      color: #4ade80;
      font-family: monospace;
      margin: 8px 0;
    }
    .status-page .retry {
      margin-top: 20px;
      padding: 10px 20px;
      background: #333;
      border: none;
      border-radius: 6px;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
    }
    .status-page .retry:hover { background: #444; }
    .status-page .auto-retry {
      font-size: 13px;
      color: #666;
      margin-top: 12px;
    }
    .status-page .conflict-detail {
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 16px 24px;
      margin: 16px 0;
      text-align: left;
      max-width: 480px;
    }
    .status-page .conflict-detail dt { color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 8px; }
    .status-page .conflict-detail dt:first-child { margin-top: 0; }
    .status-page .conflict-detail dd { color: #e5e5e5; font-size: 14px; margin: 2px 0 0 0; font-family: monospace; }

    #install-btn {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: #4ade80;
      color: #111;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      box-shadow: 0 4px 12px rgba(74, 222, 128, 0.3);
      z-index: 1000;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    #install-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(74, 222, 128, 0.4); }
    #install-btn svg { width: 16px; height: 16px; }

    #safari-install-hint {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      max-width: 320px;
      padding: 14px 18px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 10px;
      color: #e5e5e5;
      font-size: 13px;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 1000;
    }
    #safari-install-hint .hint-title {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 6px;
      color: #fff;
    }
    #safari-install-hint .hint-steps { color: #aaa; }
    #safari-install-hint .hint-steps strong { color: #e5e5e5; }
    #safari-install-hint .hint-dismiss {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 12px;
      background: #333;
      border: 1px solid #555;
      border-radius: 5px;
      color: #ccc;
      cursor: pointer;
      font-size: 12px;
    }
    #safari-install-hint .hint-dismiss:hover { background: #444; }
  </style>
</head>
<body>
  <!-- State: Service not available -->
  <div id="not-running" class="status-page">
    <h1>${emoji}</h1>
    <h2 id="nr-title">Service Unavailable</h2>
    <p id="nr-message"></p>
    <div id="nr-local" style="display:none">
      <p>If it doesn't start automatically, run:</p>
      <code>photon beam --port <span id="nr-port2"></span></code>
    </div>
    <div id="nr-remote" style="display:none">
      <div class="conflict-detail">
        <dl>
          <dt>Application</dt>
          <dd>${displayName}</dd>
          <dt>Expected service</dt>
          <dd id="nr-url"></dd>
        </dl>
      </div>
      <p>Please contact the application provider to ensure the service is running.</p>
    </div>
    <button class="retry" onclick="checkAndLoad()">Retry Now</button>
    <div class="auto-retry">Retrying automatically every 3 seconds...</div>
  </div>

  <!-- State: Port occupied by another service -->
  <div id="port-conflict" class="status-page">
    <h1>⚠️</h1>
    <h2>Port Conflict</h2>
    <p>Port <strong id="pc-port"></strong> is responding, but it is not running Photon Beam. ${displayName} cannot load.</p>
    <div class="conflict-detail">
      <dl>
        <dt>Expected</dt>
        <dd>Photon Beam</dd>
        <dt>Found</dt>
        <dd id="pc-found">Unknown service</dd>
        <dt>Port</dt>
        <dd id="pc-port2"></dd>
      </dl>
    </div>
    <div id="pc-local" style="display:none">
      <p>To free this port, stop the other service, then retry.</p>
      <code>lsof -ti:<span id="pc-port3"></span> | xargs kill</code>
    </div>
    <div id="pc-remote" style="display:none">
      <p>Another service is using this port. Please contact the application provider.</p>
    </div>
    <button class="retry" onclick="checkAndLoad()">Retry</button>
  </div>

  <div class="app-container" id="app-container" style="display:none">
    <iframe id="app"></iframe>
  </div>

  <button id="install-btn" aria-label="Install as App">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m17 11-5 5-5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
    Install App
  </button>

  <div id="safari-install-hint">
    <div class="hint-title">Install as App</div>
    <div class="hint-steps" id="safari-steps"></div>
    <span class="hint-dismiss" onclick="document.getElementById('safari-install-hint').style.display='none'">Got it</span>
  </div>

  <script>
    const iframe = document.getElementById('app');
    const appContainer = document.getElementById('app-container');
    const notRunning = document.getElementById('not-running');
    const portConflict = document.getElementById('port-conflict');
    const photonName = '${photonName}';
    const uiId = '${uiId}';
    const expectedPort = location.port || '4100';
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const serviceUrl = location.origin;
    let retryTimer = null;

    // Fill port numbers into status pages
    document.getElementById('nr-port2').textContent = expectedPort;
    document.getElementById('nr-url').textContent = serviceUrl;
    document.getElementById('pc-port').textContent = expectedPort;
    document.getElementById('pc-port2').textContent = expectedPort;
    document.getElementById('pc-port3').textContent = expectedPort;

    // Configure not-running page based on local vs remote
    if (isLocal) {
      document.getElementById('nr-title').textContent = 'Starting ${displayName}...';
      document.getElementById('nr-message').textContent = 'Waiting for Photon Beam to start on port ' + expectedPort + '.';
      document.getElementById('nr-local').style.display = 'block';
      document.getElementById('pc-local').style.display = 'block';
    } else {
      document.getElementById('nr-title').textContent = 'Service Unavailable';
      document.getElementById('nr-message').textContent = '${displayName} requires a backend service that is not currently reachable.';
      document.getElementById('nr-remote').style.display = 'block';
      document.getElementById('pc-remote').style.display = 'block';
    }

    function hideAllStates() {
      notRunning.classList.remove('show');
      portConflict.classList.remove('show');
      appContainer.style.display = 'none';
    }

    // Check /api/diagnostics to determine what's running on this port
    async function checkAndLoad() {
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      hideAllStates();

      try {
        const res = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error('bad status');
        const diag = await res.json();

        // Valid Beam response must have photonVersion
        if (diag && diag.photonVersion) {
          // This is a Photon Beam — load the app
          await loadApp();
          return;
        }

        // Got a response but not from Beam — port conflict
        showPortConflict(JSON.stringify(diag).slice(0, 120));
      } catch (e) {
        // Network error or timeout — nothing running on this port
        showNotRunning();
      }
    }

    function showNotRunning() {
      hideAllStates();
      notRunning.classList.add('show');
      retryTimer = setInterval(checkAndLoad, 3000);
    }

    function showPortConflict(detail) {
      hideAllStates();
      document.getElementById('pc-found').textContent = detail || 'Unknown service';
      portConflict.classList.add('show');
      // Don't auto-retry for conflicts — user must take action
    }

    // Load UI with platform bridge injected
    async function loadApp() {
      try {
        const [uiRes, bridgeRes] = await Promise.all([
          fetch('/api/ui?photon=' + encodeURIComponent(photonName) + '&id=' + encodeURIComponent(uiId)),
          fetch('/api/platform-bridge?photon=' + encodeURIComponent(photonName) + '&method=' + encodeURIComponent(uiId) + '&theme=dark')
        ]);

        if (!uiRes.ok) {
          showNotRunning();
          return;
        }

        let html = await uiRes.text();
        const bridge = bridgeRes.ok ? await bridgeRes.text() : '';
        html = html.replace('</head>', bridge + '</head>');

        const blob = new Blob([html], { type: 'text/html' });
        iframe.src = URL.createObjectURL(blob);
        hideAllStates();
        appContainer.style.display = 'flex';
        initBridge();
      } catch (e) {
        showNotRunning();
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

    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('[PWA] SW registered:', reg.scope))
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    }

    // --- Client-side PNG icon generation for PWA installability ---
    // Chrome requires raster PNG icons (192x192, 512x512) in the manifest.
    // We fetch the icon source (SVG or PNG from /api/pwa/icon), render it
    // onto a <canvas>, export as PNG data URIs, build a new manifest with
    // those PNGs, and replace the <link rel="manifest"> href with a blob URL.
    // This avoids needing any server-side image processing dependencies.
    async function generatePngManifest() {
      try {
        const iconUrl = '/api/pwa/icon?photon=' + encodeURIComponent(photonName);
        const iconRes = await fetch(iconUrl);
        if (!iconRes.ok) throw new Error('Icon fetch failed: ' + iconRes.status);

        const contentType = iconRes.headers.get('content-type') || '';
        const iconBlob = await iconRes.blob();
        const sizes = [192, 512];
        const pngDataUris = [];

        for (const size of sizes) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D context unavailable');

          // Fill dark background (matches theme)
          ctx.fillStyle = '#1a1a1a';
          ctx.beginPath();
          // Rounded rect for visual consistency
          const r = size * 0.2;
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

          if (contentType.includes('svg') || contentType.includes('xml')) {
            // SVG → draw via Image element with blob URL
            const svgBlobUrl = URL.createObjectURL(iconBlob);
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, size, size);
                URL.revokeObjectURL(svgBlobUrl);
                resolve(null);
              };
              img.onerror = () => {
                URL.revokeObjectURL(svgBlobUrl);
                reject(new Error('SVG image load failed'));
              };
              img.src = svgBlobUrl;
            });
          } else {
            // Raster image (PNG/JPEG/WebP) — draw directly
            const bitmapUrl = URL.createObjectURL(iconBlob);
            await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                // Center the image, maintaining aspect ratio
                const scale = Math.min(size / img.width, size / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                URL.revokeObjectURL(bitmapUrl);
                resolve(null);
              };
              img.onerror = () => {
                URL.revokeObjectURL(bitmapUrl);
                reject(new Error('Image load failed'));
              };
              img.src = bitmapUrl;
            });
          }

          pngDataUris.push(canvas.toDataURL('image/png'));
        }

        // Build manifest with raster PNG icons
        const manifest = {
          name: '${displayName}',
          short_name: '${displayName}',
          description: '${(photon as any)?.description?.replace(/'/g, "\\'") || displayName + ' - Photon App'}',
          start_url: '/' + encodeURIComponent(photonName),
          display: 'standalone',
          background_color: '#1a1a1a',
          theme_color: '#1a1a1a',
          orientation: 'any',
          icons: [
            { src: pngDataUris[0], sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: pngDataUris[1], sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/api/pwa/icon?photon=' + encodeURIComponent(photonName), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
          categories: ['developer', 'utilities'],
        };

        const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
        const manifestUrl = URL.createObjectURL(manifestBlob);

        // Replace the <link rel="manifest"> with the PNG-enhanced version
        const manifestLink = document.querySelector('link[rel="manifest"]');
        if (manifestLink) manifestLink.href = manifestUrl;

        // Also update apple-touch-icon with the 192px PNG
        const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
        if (appleIcon) appleIcon.href = pngDataUris[0];

        console.log('[PWA] PNG manifest generated — installability criteria met');
      } catch (err) {
        console.warn('[PWA] PNG manifest generation failed (install icon may not appear):', err);
        // Non-fatal — the SVG-only manifest is still linked as fallback
      }
    }

    // Generate PNG manifest immediately (before Chrome evaluates installability)
    generatePngManifest();

    // --- PWA Install Prompt ---
    let installPrompt = null;
    const installBtn = document.getElementById('install-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
      // Do NOT call e.preventDefault() — let Chrome show the address bar install icon.
      // We still capture the prompt for our custom install button.
      installPrompt = e;
      if (installBtn) installBtn.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      if (installBtn) installBtn.style.display = 'none';
      console.log('[PWA] App installed');
    });

    async function handleInstall() {
      if (!installPrompt) return;
      // Record config before prompting install
      try {
        await fetch('/api/pwa/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photon: photonName, port: expectedPort }),
        });
      } catch (e) {
        console.warn('[PWA] configure failed (non-fatal):', e);
      }
      const result = await installPrompt.prompt();
      console.log('[PWA] Install prompt result:', result?.outcome);
      installPrompt = null;
      if (installBtn) installBtn.style.display = 'none';
    }

    if (installBtn) installBtn.addEventListener('click', handleInstall);

    // Check if already installed (standalone mode) — hide install UI
    if (window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true) {
      if (installBtn) installBtn.style.display = 'none';
      const safariHint = document.getElementById('safari-install-hint');
      if (safariHint) safariHint.style.display = 'none';
    }

    // --- Safari / non-Chromium install guidance ---
    // Safari doesn't fire beforeinstallprompt, so we show manual instructions.
    // Detect: Safari on macOS → File > Add to Dock; Safari on iOS → Share > Add to Home Screen
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if ((isSafari || isIOS) && !isStandalone) {
      const safariHint = document.getElementById('safari-install-hint');
      const safariSteps = document.getElementById('safari-steps');
      if (safariHint && safariSteps) {
        if (isIOS) {
          safariSteps.innerHTML = 'Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.';
        } else {
          safariSteps.innerHTML = 'Use <strong>File &rarr; Add to Dock</strong> to install this app.';
        }
        // Show after a short delay so the app loads first
        setTimeout(() => { safariHint.style.display = 'block'; }, 2000);
      }
    }

    checkAndLoad();
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(pwaHost);
    return true;
  }

  // PWA Configure — Record the port + PHOTON_DIR for this PWA instance
  if (url.pathname === '/api/pwa/configure' && req.method === 'POST') {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => (data += chunk.toString()));
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      const { photon: photonName, port: requestedPort } = JSON.parse(body);
      const port = parseInt(requestedPort || process.env.BEAM_PORT || '4100', 10);

      // PHOTON_DIR is the env override or ~/.photon/ — this is what the launcher needs
      const os = await import('os');
      const pathMod = await import('path');
      const photonDir = process.env.PHOTON_DIR || pathMod.join(os.default.homedir(), '.photon');
      const pwaConfigPath = pathMod.join(photonDir, 'pwa.json');

      let pwaConfig: {
        instances: Array<{ port: number; photonDir: string; photon?: string; createdAt: string }>;
      } = { instances: [] };
      try {
        const existing = await fs.readFile(pwaConfigPath, 'utf-8');
        pwaConfig = JSON.parse(existing);
        if (!Array.isArray(pwaConfig.instances)) pwaConfig.instances = [];
      } catch {
        // File doesn't exist yet
      }

      // Deduplicate by port + photonDir
      const exists = pwaConfig.instances.some((i) => i.port === port && i.photonDir === photonDir);
      if (!exists) {
        pwaConfig.instances.push({
          port,
          photonDir,
          photon: photonName || undefined,
          createdAt: new Date().toISOString(),
        });
      }

      // Write the config
      await fs.mkdir(photonDir, { recursive: true });
      await fs.writeFile(pwaConfigPath, JSON.stringify(pwaConfig, null, 2));

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          success: true,
          port,
          photonDir,
          photon: photonName || null,
        })
      );
    } catch (error: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error?.message || 'Failed to configure PWA' }));
    }
    return true;
  }

  return false;
};
