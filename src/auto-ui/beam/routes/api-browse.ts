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
 *   /api/pwa/icon.svg    – Auto-generated SVG icon from photon emoji
 *   /api/pwa/app         – PWA app entry with bridge injection
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
      logger.error(`Failed to read MCP App resource: ${error}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: `Failed to read resource: ${error}` }));
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
    const templateFile = templatePathParam || (photon as PhotonInfo).templatePath;
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
  if (url.pathname === '/api/pwa/manifest.json') {
    const photonName = url.searchParams.get('photon');
    if (!photonName) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing photon parameter' }));
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
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
    return true;
  }

  // PWA Icon - Auto-generated SVG from photon emoji
  if (url.pathname === '/api/pwa/icon.svg') {
    const photonName = url.searchParams.get('photon');
    const photon = state.photons.find((p) => p.name === photonName);
    const emoji = (photon as any)?.icon || '📦';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#1a1a1a"/>
  <text x="50" y="50" font-size="50" text-anchor="middle" dominant-baseline="central">${emoji}</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
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
    return true;
  }

  return false;
};
