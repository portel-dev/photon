/**
 * Dev CLI Command - Unified Hot-Reloading UI Dev Server
 *
 * Runs the backend Beam server and frontend framework (Vite/Angular)
 * dev server concurrently with auto-negotiated proxy configuration.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getDefaultContext, resolvePhotonFromAllSources } from '../../context.js';
import { getBundledPhotonPath, detectPM } from '../../shared-utils.js';
import { isGlobalDaemonReachable, ensureDaemon } from '../../daemon/manager.js';
import { exitWithError, getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { validateOrThrow, inRange, isPositive, isInteger } from '../../shared/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function isBeamRuntimeRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/openapi.json`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findAvailablePort(startPort: number, maxAttempts: number = 20): Promise<number> {
  validateOrThrow(startPort, [
    inRange('start port', 1, 65535),
    isInteger('start port'),
    isPositive('start port'),
  ]);

  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65535) {
      throw new Error(`Port ${port} exceeds maximum port number (65535)`);
    }
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found between ${startPort} and ${startPort + maxAttempts - 1}`
  );
}

async function resolvePhotonPathWithBundled(
  name: string,
  workingDir: string
): Promise<string | null> {
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) return bundledPath;
  return resolvePhotonFromAllSources(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .option('-p, --port <number>', 'Vite/UI Dev server port', '5173')
    .option('-b, --backend-port <number>', 'Beam backend port', '8888')
    .description(
      'Start hot-reloading frontend development server with automatic Photon daemon integration'
    )
    .action(async (name: string, options: any) => {
      try {
        const workingDir = getDefaultContext().baseDir;
        const filePath = await resolvePhotonPathWithBundled(name, workingDir);

        if (!filePath) {
          exitWithError(`Photon not found: ${name}`, {
            searchedIn: workingDir,
            suggestion: "Use 'photon info' to see available photons",
          });
        }

        // Verify ui/ directory exists
        const uiDir = path.join(workingDir, 'ui');
        if (!fs.existsSync(uiDir)) {
          exitWithError(`UI directory not found at ${uiDir}`, {
            suggestion: `Run 'photon new ${name} --react' or similar to scaffold a UI project first.`,
          });
        }

        // 1. Ensure Global Daemon is running
        const daemonReachable = await isGlobalDaemonReachable();
        if (!daemonReachable) {
          console.error('⚙️ Starting Photon background daemon...');
          await ensureDaemon(false);
        }

        // 2. Negotiate Ports
        const preferredBackendPort = parseInt(options.backendPort, 10);
        let backendPort = preferredBackendPort;
        let startLocalBackend = true;

        if (await isBeamRuntimeRunning(preferredBackendPort)) {
          console.error(
            `⚙️ Discovered active Beam runtime on port ${preferredBackendPort}. Reusing it.`
          );
          startLocalBackend = false;
        } else {
          backendPort = await findAvailablePort(preferredBackendPort);
          if (backendPort !== preferredBackendPort) {
            console.error(
              `⚠️  Backend port ${preferredBackendPort} is in use by another process, using ${backendPort} instead`
            );
          }
        }

        const preferredUiPort = parseInt(options.port, 10);
        const uiPort = await findAvailablePort(preferredUiPort);
        if (uiPort !== preferredUiPort) {
          console.error(`⚠️  UI dev port ${preferredUiPort} is in use, using ${uiPort} instead`);
        }

        // 3. Inject framework-specific proxy configuration
        const angularJsonPath = path.join(uiDir, 'angular.json');
        const isAngular = fs.existsSync(angularJsonPath);

        if (isAngular) {
          const proxyConfPath = path.join(uiDir, 'proxy.conf.json');
          const proxyConf = {
            '/api': { target: `http://127.0.0.1:${backendPort}`, secure: false },
            '/sessions': { target: `http://127.0.0.1:${backendPort}`, secure: false },
            '/settings': { target: `http://127.0.0.1:${backendPort}`, secure: false },
            '/pair': { target: `http://127.0.0.1:${backendPort}`, secure: false },
          };
          fs.writeFileSync(proxyConfPath, JSON.stringify(proxyConf, null, 2), 'utf-8');
          console.error(`⚙️ Injected Angular proxy configuration target -> port ${backendPort}`);
        }

        // 4. Start Beam Backend Server inline
        if (startLocalBackend) {
          console.error(`⚙️ Starting Beam backend on http://localhost:${backendPort}...`);
          const { startBeam } = await import('../../auto-ui/beam.js');
          await startBeam(workingDir, backendPort);
        }

        // 5. Spin up Framework Frontend Dev Server
        const pm = detectPM();
        const runCmd = pm === 'bun' ? 'bun' : 'npm';
        const runArgs =
          pm === 'bun'
            ? ['run', 'dev', '--', '--port', String(uiPort)]
            : ['run', 'dev', '--', '--port', String(uiPort)];

        console.error(`🚀 Starting UI frontend dev server via ${pm}...`);
        const childEnv = {
          ...process.env,
          VITE_DAEMON_PORT: String(backendPort),
        };

        const uiProcess = spawn(runCmd, runArgs, {
          cwd: uiDir,
          stdio: 'inherit',
          env: childEnv,
        });

        // 6. Handle graceful shutdowns
        let shuttingDown = false;
        const shutdown = async () => {
          if (shuttingDown) return;
          shuttingDown = true;
          console.error('\nShutting down dev orchestrator...');

          const forceExit = setTimeout(() => process.exit(0), 3000);
          forceExit.unref();

          try {
            uiProcess.kill('SIGINT');
            if (startLocalBackend) {
              const { stopBeam } = await import('../../auto-ui/beam.js');
              await stopBeam();
            }
          } catch {
            // ignore cleanup errors
          }
          process.exit(0);
        };

        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());

        // Wait a moment for frontend server to initialize, then launch browser
        await sleep(1500);
        const url = `http://localhost:${uiPort}`;
        console.error(`⚡ Dev Server ready at: ${url}`);

        const openCmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'cmd'
              : 'xdg-open';
        const openArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        spawn(openCmd, openArgs);

        // Keep process alive
        const keepAlive = setInterval(() => {}, 2147483647);
        process.once('exit', () => clearInterval(keepAlive));
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}
