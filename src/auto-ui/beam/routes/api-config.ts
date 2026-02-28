/**
 * API Config Routes — /api/invoke, /api/platform-bridge, /api/diagnostics,
 * /api/export/mcp-config, /api/openapi.json, /api/test/run
 *
 * Extracted from beam.ts to reduce file size.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { isLocalRequest, readBody } from '../../../shared/security.js';
import { generateOpenAPISpec } from '../../openapi-generator.js';
import type { PhotonInfo, UnconfiguredPhotonInfo } from '../../types.js';
import type { BeamState, RouteHandler } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const handleConfigRoutes: RouteHandler = async (req, res, url, state) => {
  // Invoke API: Direct HTTP endpoint for method invocation (used by PWA)
  if (url.pathname === '/api/invoke' && req.method === 'POST') {
    // Security: only allow local requests
    if (!isLocalRequest(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden: non-local request' }));
      return true;
    }

    // Security: rate limiting
    const clientKey = req.socket?.remoteAddress || 'unknown';
    if (!state.apiRateLimiter.isAllowed(clientKey)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return true;
    }

    try {
      const body = await readBody(req);
      const { photon: photonName, method, args } = JSON.parse(body);

      if (!photonName || !method) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing photon or method' }));
        return true;
      }

      const mcp = state.photonMCPs.get(photonName);
      if (!mcp || !mcp.instance) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Photon not found: ${photonName}` }));
        return true;
      }

      if (typeof mcp.instance[method] !== 'function') {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Method not found: ${method}` }));
        return true;
      }

      const result = await mcp.instance[method](args || {});
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ result }));
    } catch (err: any) {
      const status = err.message?.includes('too large') ? 413 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(status);
      res.end(JSON.stringify({ error: err.message || String(err) }));
    }
    return true;
  }

  // Platform Bridge API: Generate platform compatibility script
  // Uses the unified bridge architecture based on @modelcontextprotocol/ext-apps SDK
  if (url.pathname === '/api/platform-bridge') {
    const theme = (url.searchParams.get('theme') || 'dark') as 'light' | 'dark';
    const photonName = url.searchParams.get('photon') || '';
    const methodName = url.searchParams.get('method') || '';

    // Look up injected photons for this photon
    const photon = state.photons.find((p) => p.name === photonName);
    const injectedPhotonsList =
      photon && photon.configured && (photon as PhotonInfo).injectedPhotons;

    const { generateBridgeScript } = await import('../../bridge/index.js');
    const script = generateBridgeScript({
      theme,
      locale: 'en-US',
      photon: photonName,
      method: methodName,
      hostName: 'beam',
      hostVersion: '1.5.0',
      injectedPhotons: injectedPhotonsList || [],
    });

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(script);
    return true;
  }

  // Diagnostics endpoint: server health and photon status
  if (url.pathname === '/api/diagnostics') {
    res.setHeader('Content-Type', 'application/json');

    try {
      const { PHOTON_VERSION } = await import('../../../version.js');
      const sources = state.marketplace.getAll();

      const photonStatus = state.photons.map((p) => ({
        name: p.name,
        status: p.configured ? 'loaded' : 'unconfigured',
        methods: p.configured
          ? Math.max(0, (p as PhotonInfo).methods.length - ((p as PhotonInfo).promptCount || 0))
          : 0,
        error: !p.configured ? (p as UnconfiguredPhotonInfo).errorMessage : undefined,
        internal: (p as any).internal || undefined,
        path: p.path || undefined,
      }));

      // Query daemon health (non-blocking, returns null if daemon unavailable)
      let daemonHealth: any = null;
      try {
        const { queryDaemonStatus } = await import('../../../daemon/client.js');
        daemonHealth = await queryDaemonStatus();
      } catch {
        // Daemon not available — skip
      }

      res.writeHead(200);
      res.end(
        JSON.stringify({
          nodeVersion: process.version,
          photonVersion: PHOTON_VERSION,
          workingDir: state.workingDir,
          uptime: process.uptime(),
          photonCount: state.photons.length,
          configuredCount: state.photons.filter((p) => p.configured).length,
          unconfiguredCount: state.photons.filter((p) => !p.configured).length,
          marketplaceSources: sources.filter((s) => s.enabled).length,
          photons: photonStatus,
          daemon: daemonHealth,
        })
      );
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to generate diagnostics' }));
    }
    return true;
  }

  // MCP Config Export endpoint: generate Claude Desktop config snippet
  if (url.pathname === '/api/export/mcp-config') {
    res.setHeader('Content-Type', 'application/json');

    const photonName = url.searchParams.get('photon');
    if (!photonName) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing photon query parameter' }));
      return true;
    }

    const photon = state.photons.find((p) => p.name === photonName);
    if (!photon) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `Photon '${photonName}' not found` }));
      return true;
    }

    res.writeHead(200);
    res.end(
      JSON.stringify(
        {
          mcpServers: {
            [`photon-${photonName}`]: {
              command: 'npx',
              args: ['-y', '@portel/photon', 'mcp', photonName],
            },
          },
        },
        null,
        2
      )
    );
    return true;
  }

  // OpenAPI Specification endpoint
  // Serves auto-generated OpenAPI 3.1 spec from loaded photons
  if (url.pathname === '/api/openapi.json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      const serverUrl = `http://${req.headers.host || 'localhost'}`;
      const spec = generateOpenAPISpec(state.photons, serverUrl);
      res.writeHead(200);
      res.end(JSON.stringify(spec, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to generate OpenAPI spec' }));
    }
    return true;
  }

  // Test API: Run a single test
  // Supports modes: 'direct' (call instance method), 'mcp' (call via executeTool), 'cli' (spawn subprocess)
  if (url.pathname === '/api/test/run' && req.method === 'POST') {
    return new Promise<boolean>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        res.setHeader('Content-Type', 'application/json');

        try {
          const { photon: photonName, test: testName, mode = 'direct' } = JSON.parse(body);

          // Find the photon
          const photon = state.photons.find((p) => p.name === photonName);
          if (!photon) {
            res.writeHead(404);
            res.end(JSON.stringify({ passed: false, error: 'Photon not found', mode }));
            resolve(true);
            return;
          }

          // Get the MCP instance
          const mcp = state.photonMCPs.get(photonName);
          if (!mcp || !mcp.instance) {
            res.writeHead(404);
            res.end(JSON.stringify({ passed: false, error: 'Photon not loaded', mode }));
            resolve(true);
            return;
          }

          // Run the test method
          const start = Date.now();
          try {
            let result: any;

            if (mode === 'mcp') {
              // MCP mode: use executeTool to simulate MCP protocol
              // This tests the full tool execution path
              result = await state.loader.executeTool(mcp, testName, {}, {});
            } else if (mode === 'cli') {
              // CLI mode: spawn subprocess to test CLI interface
              const cliPath = path.resolve(__dirname, '..', '..', '..', 'cli.js');
              const args = ['cli', photonName, testName, '--json'];

              result = await new Promise((resolveProc) => {
                const proc = spawn('node', [cliPath, ...args], {
                  cwd: state.workingDir,
                  timeout: 30000,
                  env: { ...process.env, PHOTON_DIR: state.workingDir },
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
                proc.stderr.on('data', (data: Buffer) => (stderr += data.toString()));

                proc.on('close', (code: number | null) => {
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
                    resolveProc({ passed: true, message: 'CLI interface test passed' });
                  } else if (isInfraError) {
                    resolveProc({ passed: false, error: `CLI infrastructure error: ${output}` });
                  } else {
                    resolveProc({
                      passed: false,
                      error: `CLI test failed with code ${code}: no output`,
                    });
                  }
                });

                proc.on('error', (err: Error) => {
                  resolveProc({ passed: false, error: `CLI spawn error: ${err.message}` });
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
        resolve(true);
      });
    });
  }

  // Instances API: List named instances for a stateful photon
  if (url.pathname.startsWith('/api/instances/') && req.method === 'GET') {
    const photonName = url.pathname.slice('/api/instances/'.length);
    if (!photonName) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing photon name' }));
      return true;
    }
    try {
      const photonBase = state.workingDir;
      const { instances, autoInstance } = await listInstances(photonBase, photonName);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ instances, autoInstance }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  // Instance CRUD: DELETE /api/instances/:photon/:instance
  if (url.pathname.match(/^\/api\/instances\/[^/]+\/[^/]+$/) && req.method === 'DELETE') {
    if (!isLocalRequest(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return true;
    }
    const parts = url.pathname.slice('/api/instances/'.length).split('/');
    const [photonName, instanceName] = parts;
    if (instanceName === 'default') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Cannot delete default instance' }));
      return true;
    }
    try {
      const dirs = getInstanceDirs(state.workingDir, photonName);
      let deleted = false;
      for (const dir of dirs) {
        for (const suffix of ['.json', '-settings.json']) {
          try {
            await fs.unlink(path.join(dir, `${instanceName}${suffix}`));
            deleted = true;
          } catch {
            // File may not exist
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted, instance: instanceName }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  // Instance CRUD: POST /api/instances/:photon/:instance/rename
  if (url.pathname.match(/^\/api\/instances\/[^/]+\/[^/]+\/rename$/) && req.method === 'POST') {
    if (!isLocalRequest(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return true;
    }
    const parts = url.pathname.slice('/api/instances/'.length).split('/');
    const [photonName, instanceName] = parts;
    try {
      const body = await readBody(req);
      const { newName } = JSON.parse(body);
      if (!newName || typeof newName !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing newName' }));
        return true;
      }
      const dirs = getInstanceDirs(state.workingDir, photonName);
      let renamed = false;
      for (const dir of dirs) {
        for (const suffix of ['.json', '-settings.json']) {
          const oldPath = path.join(dir, `${instanceName}${suffix}`);
          const newPath = path.join(dir, `${newName}${suffix}`);
          try {
            await fs.access(oldPath);
            await fs.rename(oldPath, newPath);
            renamed = true;
          } catch {
            // File may not exist
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ renamed, from: instanceName, to: newName }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  // Instance CRUD: POST /api/instances/:photon/:instance/clone
  if (url.pathname.match(/^\/api\/instances\/[^/]+\/[^/]+\/clone$/) && req.method === 'POST') {
    if (!isLocalRequest(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return true;
    }
    const parts = url.pathname.slice('/api/instances/'.length).split('/');
    const [photonName, instanceName] = parts;
    try {
      const body = await readBody(req);
      const { newName } = JSON.parse(body);
      if (!newName || typeof newName !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing newName' }));
        return true;
      }
      const dirs = getInstanceDirs(state.workingDir, photonName);
      let cloned = false;
      for (const dir of dirs) {
        const srcPath = path.join(dir, `${instanceName}.json`);
        const destPath = path.join(dir, `${newName}.json`);
        try {
          await fs.access(srcPath);
          await fs.copyFile(srcPath, destPath);
          cloned = true;
        } catch {
          // Source may not exist in this dir
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cloned, from: instanceName, to: newName }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  return false;
};

/** Get candidate directories for instance state files */
function getInstanceDirs(workingDir: string, photonName: string): string[] {
  return [path.join(workingDir, 'state', photonName), path.join(workingDir, photonName, 'boards')];
}

/** List instances for a photon from state directories */
async function listInstances(
  workingDir: string,
  photonName: string
): Promise<{ instances: string[]; autoInstance: string }> {
  const candidateDirs = getInstanceDirs(workingDir, photonName);

  let instances: string[] = [];
  let autoInstance = '';

  for (const dir of candidateDirs) {
    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter(
        (f) => f.endsWith('.json') && !f.endsWith('-settings.json') && !f.endsWith('.archive.jsonl')
      );
      if (jsonFiles.length === 0) continue;
      const withMtime = await Promise.all(
        jsonFiles.map(async (f) => {
          const stat = await fs.stat(path.join(dir, f));
          return { name: f.replace('.json', ''), mtime: stat.mtimeMs };
        })
      );
      withMtime.sort((a, b) => b.mtime - a.mtime);
      instances = withMtime.map((f) => f.name);
      autoInstance = instances[0] || 'default';
      break;
    } catch {
      // Dir doesn't exist, try next
    }
  }

  if (!instances.includes('default')) {
    instances.push('default');
    instances.sort();
  }
  if (!autoInstance) autoInstance = 'default';

  return { instances, autoInstance };
}
