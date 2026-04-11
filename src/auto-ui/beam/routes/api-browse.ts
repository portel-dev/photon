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
 */

import * as fs from 'fs/promises';
import { lstatSync, realpathSync } from 'fs';
import * as path from 'path';
import { isPathWithin } from '../../../shared/security.js';
import { logger } from '../../../shared/logger.js';
import type { RouteHandler } from '../types.js';

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
    const photonBaseName = path.basename(resolvedPhotonPath, '.photon.ts');

    // Try to use resolved path from assets if available (respects JSDoc)
    const asset = (photon as any).assets?.ui?.find((u: any) => u.id === uiId);

    // Resolve UI template path. Prefer .photon.html (declarative mode) over .html.
    let uiPath: string;
    let isPhotonTemplate = false;

    let isPhotonMarkdown = false;

    // Verify resolvedPath actually exists before trusting it.
    // asset-discovery resolves @ui paths relative to the asset folder, but photon
    // authors sometimes write paths relative to the photon file directory, yielding
    // a doubled segment (e.g. chat/chat/ui/chat.html). Fall through to auto-discovery
    // when the pre-resolved path is missing.
    const resolvedPathValid = asset?.resolvedPath
      ? await fs
          .access(asset.resolvedPath)
          .then(() => true)
          .catch(() => false)
      : false;

    if (asset && asset.resolvedPath && resolvedPathValid) {
      uiPath = asset.resolvedPath;
      isPhotonTemplate = uiPath.endsWith('.photon.html') || uiPath.endsWith('.photon.tsx');
      isPhotonMarkdown = uiPath.endsWith('.photon.md');
      // If asset points to .html, check if a higher-priority sibling exists
      if (!isPhotonTemplate && !isPhotonMarkdown && uiPath.endsWith('.html')) {
        const siblings = [
          uiPath.replace(/\.html$/, '.photon.html'),
          uiPath.replace(/\.html$/, '.photon.tsx'),
          uiPath.replace(/\.html$/, '.photon.md'),
        ];
        for (const sibling of siblings) {
          try {
            await fs.access(sibling);
            uiPath = sibling;
            isPhotonTemplate = sibling.endsWith('.photon.html') || sibling.endsWith('.photon.tsx');
            isPhotonMarkdown = sibling.endsWith('.photon.md');
            break;
          } catch {
            // try next
          }
        }
      }
    } else {
      // Priority: .photon.html > .photon.tsx > .photon.md > .html > .tsx
      const uiBase = path.join(photonDir, photonBaseName, 'ui');
      const candidates = [
        { path: path.join(uiBase, `${uiId}.photon.html`), template: true, md: false },
        { path: path.join(uiBase, `${uiId}.photon.tsx`), template: true, md: false },
        { path: path.join(uiBase, `${uiId}.photon.md`), template: false, md: true },
        { path: path.join(uiBase, `${uiId}.html`), template: false, md: false },
        { path: path.join(uiBase, `${uiId}.tsx`), template: false, md: false },
      ];
      uiPath = candidates[candidates.length - 1].path; // default fallback
      for (const c of candidates) {
        try {
          await fs.access(c.path);
          uiPath = c.path;
          isPhotonTemplate = c.template;
          isPhotonMarkdown = c.md;
          break;
        } catch {
          // try next
        }
      }
    }

    try {
      let uiContent: string;
      if (uiPath.endsWith('.tsx')) {
        const { compileTsxCached } = await import('../../../tsx-compiler.js');
        uiContent = await compileTsxCached(uiPath);
      } else {
        uiContent = await fs.readFile(uiPath, 'utf-8');
      }
      res.setHeader('Content-Type', isPhotonMarkdown ? 'text/markdown' : 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (isPhotonTemplate || isPhotonMarkdown) {
        res.setHeader('X-Photon-Template', 'true');
      }
      if (isPhotonMarkdown) {
        res.setHeader('X-Photon-Markdown', 'true');
      }
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
  // NOTE: The manifest declares PNG icon URLs at /api/pwa/icon-png which are
  // intercepted by the service worker. The SW renders the SVG icon onto
  // OffscreenCanvas and returns a real PNG response, satisfying Chrome's
  // installability requirement for raster icons at 192x192 and 512x512.
  if (url.pathname === '/api/pwa/manifest.json') {
    const photonName = url.searchParams.get('photon');

    // Find the photon - use label for display name, fallback to name
    const photon = photonName ? state.photons.find((p) => p.name === photonName) : null;

    // Use label (from @label tag) for display name, fallback to capitalized name, or "Photon Beam"
    const rawName = photon?.name || photonName || '';
    const displayName =
      (photon as any)?.label ||
      (rawName
        ? rawName.charAt(0).toUpperCase() + rawName.slice(1).replace(/-/g, ' ')
        : 'Photon Beam');
    const description = (photon as any)?.description || `${displayName} - Photon App`;
    const startUrl = photonName ? `/app/${encodeURIComponent(photonName)}` : '/';
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
              src: `/api/pwa/icon-png?photon=${encodedIcon}&size=192`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `/api/pwa/icon-png?photon=${encodedIcon}&size=512`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
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
