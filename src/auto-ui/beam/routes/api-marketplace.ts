/**
 * Marketplace API route handlers for Beam.
 *
 * Extracted from beam.ts — handles all /api/marketplace/* endpoints.
 */

import { existsSync, lstatSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { readBody } from '../../../shared/security.js';
import type { RouteHandler } from '../types.js';

export const handleMarketplaceRoutes: RouteHandler = async (req, res, url, state) => {
  if (!url.pathname.startsWith('/api/marketplace')) return false;

  // Marketplace API: Search photons
  if (url.pathname === '/api/marketplace/search') {
    res.setHeader('Content-Type', 'application/json');
    const query = url.searchParams.get('q') || '';

    try {
      const results = await state.marketplace.search(query);
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
          icon: source.metadata?.icon,
          internal: source.metadata?.internal,
          installed: state.photonMCPs.has(name),
        });
      }

      res.writeHead(200);
      res.end(JSON.stringify({ photons: photonList }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Search failed' }));
    }
    return true;
  }

  // Marketplace API: List all available photons
  if (url.pathname === '/api/marketplace/list') {
    res.setHeader('Content-Type', 'application/json');

    try {
      // Auto-refresh caches older than 5 minutes so updates are detected without manual Sync
      await state.marketplace.autoUpdateStaleCaches(5 * 60 * 1000);

      const { readLocalMetadata } = await import('../../../marketplace-manager.js');
      const allPhotons = await state.marketplace.getAllPhotons();
      const localMetadata = await readLocalMetadata();
      const photonList: any[] = [];

      for (const [name, { metadata, marketplace: mp }] of allPhotons) {
        const installed = state.photonMCPs.has(name);
        let hasUpdate = false;
        let latestVersion = '';

        if (installed) {
          const installMeta = localMetadata.photons[`${name}.photon.ts`];
          if (installMeta && metadata.hash) {
            // Primary: hash comparison (catches code changes without version bump)
            hasUpdate = installMeta.originalHash !== metadata.hash;
          } else if (installMeta && metadata.version) {
            // Fallback: version comparison
            hasUpdate = installMeta.version !== metadata.version;
          }
          if (hasUpdate) {
            const installedVersion = installMeta?.version || '';
            const newVersion = metadata.version || '';
            const versionChanged = newVersion && newVersion !== installedVersion;
            if (versionChanged) {
              latestVersion = newVersion;
            } else if (metadata.hash) {
              // Hash-only drift: append short hash suffix (git-style) so the change is visible
              const rawHash = metadata.hash.replace(/^sha256:/, '').slice(0, 7);
              if (rawHash) {
                latestVersion = `${newVersion || installedVersion}+${rawHash}`;
              }
            }
          }
        }

        photonList.push({
          name,
          description: metadata.description || '',
          version: metadata.version || '',
          author: metadata.author || '',
          tags: metadata.tags || [],
          marketplace: mp.name,
          icon: metadata.icon,
          internal: metadata.internal,
          installed,
          hasUpdate,
          latestVersion,
        });
      }

      res.writeHead(200);
      res.end(JSON.stringify({ photons: photonList }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to list photons' }));
    }
    return true;
  }

  // Marketplace API: Add/install a photon
  if (url.pathname === '/api/marketplace/add' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        try {
          const { name } = JSON.parse(body);
          if (!name) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing photon name' }));
            return;
          }

          // Fetch the photon from marketplace
          const result = await state.marketplace.fetchMCP(name);
          if (!result) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: `Photon '${name}' not found in marketplace` }));
            return;
          }

          // Write file + save metadata + download assets (canonical install path)
          const { photonPath: targetPath, assetsInstalled } = await state.marketplace.installPhoton(
            result,
            name,
            state.workingDir
          );

          // Trigger immediate load so the photon appears in the sidebar right away
          // (don't wait for the file watcher which has debounce delay)
          void state.actions.handleFileChange(name);

          res.writeHead(200);
          res.end(
            JSON.stringify({
              success: true,
              name,
              path: targetPath,
              version: result.metadata?.version,
              assetsInstalled,
            })
          );
        } catch {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Failed to add photon' }));
        }
      })();
    });
    return true;
  }

  // Marketplace API: Remove/uninstall a photon
  if (url.pathname === '/api/marketplace/remove' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    const body = await readBody(req);
    try {
      const { name } = JSON.parse(body);
      if (!name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon name' }));
        return true;
      }

      const filePath = path.join(state.workingDir, `${name}.photon.ts`);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Photon '${name}' not found` }));
        return true;
      }

      // Move to trash instead of deleting — ~/.photon/.trash/
      const trashDir = path.join(state.workingDir, '.trash');
      await fs.mkdir(trashDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const trashName = `${name}.${timestamp}.photon.ts`;
      await fs.rename(filePath, path.join(trashDir, trashName));

      // Move UI assets directory to trash if it exists
      const assetsDir = path.join(state.workingDir, name);
      if (existsSync(assetsDir) && lstatSync(assetsDir).isDirectory()) {
        await fs.rename(assetsDir, path.join(trashDir, `${name}.${timestamp}`));
      }

      // Clear compiled cache
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
      for (const ext of ['.js', '.js.map']) {
        try {
          await fs.unlink(path.join(cacheDir, `${name}${ext}`));
        } catch {
          /* ignore */
        }
      }

      // Remove from loaded photons
      const idx = state.photons.findIndex((p) => p.name === name);
      if (idx !== -1) state.photons.splice(idx, 1);
      state.photonMCPs.delete(name);

      console.error(`🗑️  Moved ${name} to trash (${trashName})`);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, name, trashedAs: trashName }));

      state.actions.broadcastPhotonChange();
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to remove photon' }));
    }
    return true;
  }

  // Marketplace API: Fork a photon
  if (url.pathname === '/api/marketplace/fork' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    const body = await readBody(req);
    try {
      const { name, target } = JSON.parse(body);
      if (!name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon name' }));
        return true;
      }

      let forkOptions: { targetRepo?: string; createRepo?: string } | undefined;
      if (target && target !== 'local') {
        if (target.startsWith('create:')) {
          forkOptions = { createRepo: target.slice(7) };
        } else {
          forkOptions = { targetRepo: target };
        }
      }

      const result = await state.marketplace.forkPhoton(name, state.workingDir, forkOptions);

      if (result.success) {
        // Refresh photon list since metadata changed
        const idx = state.photons.findIndex((p) => p.name === name);
        if (idx !== -1) {
          const p = state.photons[idx] as any;
          p.installSource = undefined;
          p.hasUpdate = false;
        }
        state.actions.broadcastPhotonChange();
      }

      res.writeHead(result.success ? 200 : 400);
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Fork failed' }));
    }
    return true;
  }

  // Marketplace API: Contribute a photon back upstream
  if (url.pathname === '/api/marketplace/contribute' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    const body = await readBody(req);
    try {
      const { name, dryRun } = JSON.parse(body);
      if (!name) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon name' }));
        return true;
      }

      const result = await state.marketplace.contributePhoton(name, state.workingDir, {
        dryRun,
      });

      res.writeHead(result.success ? 200 : 400);
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Contribute failed' }));
    }
    return true;
  }

  // Marketplace API: Get fork targets
  if (url.pathname === '/api/marketplace/fork-targets') {
    res.setHeader('Content-Type', 'application/json');

    try {
      const targets = await state.marketplace.getForkTargets();
      res.writeHead(200);
      res.end(JSON.stringify({ targets }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to get fork targets' }));
    }
    return true;
  }

  // Marketplace API: Get all marketplace sources
  if (url.pathname === '/api/marketplace/sources') {
    res.setHeader('Content-Type', 'application/json');

    try {
      const sources = state.marketplace.getAll();
      const sourcesWithCounts = await Promise.all(
        sources.map(async (source) => {
          // Get photon count from cached manifest
          const manifest = await state.marketplace.getCachedManifest(source.name);
          return {
            name: source.name,
            repo: source.repo,
            source: source.source,
            sourceType: source.sourceType,
            enabled: source.enabled,
            builtIn: state.marketplace.isBuiltIn(source.source),
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
    return true;
  }

  // Marketplace API: Add a new marketplace source
  if (url.pathname === '/api/marketplace/sources/add' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        try {
          const { source } = JSON.parse(body);
          if (!source) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing source parameter' }));
            return;
          }

          const result = await state.marketplace.add(source);

          // Update cache for the new marketplace
          if (result.added) {
            await state.marketplace.updateMarketplaceCache(result.marketplace.name);
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
      })();
    });
    return true;
  }

  // Marketplace API: Remove a marketplace source
  if (url.pathname === '/api/marketplace/sources/remove' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        try {
          const { name } = JSON.parse(body);
          if (!name) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing name parameter' }));
            return;
          }

          const removed = await state.marketplace.remove(name);
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
      })();
    });
    return true;
  }

  // Marketplace API: Toggle marketplace enabled/disabled
  if (url.pathname === '/api/marketplace/sources/toggle' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        try {
          const { name, enabled } = JSON.parse(body);
          if (!name || typeof enabled !== 'boolean') {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing name or enabled parameter' }));
            return;
          }

          const success = await state.marketplace.setEnabled(name, enabled);
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
      })();
    });
    return true;
  }

  // Marketplace API: Refresh marketplace cache
  if (url.pathname === '/api/marketplace/refresh' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        try {
          const { name } = JSON.parse(body || '{}');

          if (name) {
            // Refresh specific marketplace
            const success = await state.marketplace.updateMarketplaceCache(name);
            res.writeHead(200);
            res.end(JSON.stringify({ success, updated: success ? [name] : [] }));
          } else {
            // Refresh all enabled marketplaces
            const results = await state.marketplace.updateAllCaches();
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
      })();
    });
    return true;
  }

  // Marketplace API: Check for available updates
  if (url.pathname === '/api/marketplace/updates') {
    res.setHeader('Content-Type', 'application/json');

    try {
      const { readLocalMetadata } = await import('../../../marketplace-manager.js');
      const localMetadata = await readLocalMetadata();
      const updates: Array<{
        name: string;
        fileName: string;
        currentVersion: string;
        latestVersion: string;
        marketplace: string;
      }> = [];

      // Check each installed photon for updates (hash-based primary, version fallback)
      for (const [fileName, installMeta] of Object.entries(localMetadata.photons)) {
        const photonName = fileName.replace(/\.photon\.ts$/, '');
        const latestInfo = await state.marketplace.getPhotonMetadata(photonName);

        if (latestInfo) {
          const hashChanged = latestInfo.metadata.hash
            ? installMeta.originalHash !== latestInfo.metadata.hash
            : false;
          const versionChanged = latestInfo.metadata.version !== installMeta.version;

          if (hashChanged || versionChanged) {
            let latestVersion = '';
            if (versionChanged) {
              latestVersion = latestInfo.metadata.version || '';
            } else if (latestInfo.metadata.hash) {
              // Hash-only drift: append short hash suffix (git-style) so the change is visible
              const rawHash = latestInfo.metadata.hash.replace(/^sha256:/, '').slice(0, 7);
              if (rawHash) {
                latestVersion = `${latestInfo.metadata.version || installMeta.version}+${rawHash}`;
              }
            }
            updates.push({
              name: photonName,
              fileName,
              currentVersion: installMeta.version,
              latestVersion,
              marketplace: latestInfo.marketplace.name,
            });
          }
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ updates }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to check for updates' }));
    }
    return true;
  }

  // No marketplace route matched
  return false;
};
