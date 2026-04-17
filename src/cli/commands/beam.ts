/**
 * Beam & SSE CLI Commands
 *
 * beam: Launch Photon Beam interactive control panel
 * sse:  Run Photon as HTTP server with SSE transport
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as net from 'net';
import {
  getErrorMessage,
  ExitCode,
  exitWithError,
  handleError,
} from '../../shared/error-handler.js';
import { LoggerOptions, normalizeLogLevel, logger } from '../../shared/logger.js';
import { validateOrThrow, inRange, isPositive, isInteger } from '../../shared/validation.js';
import { getDefaultContext, resolvePhotonFromAllSources } from '../../context.js';
import { getBundledPhotonPath } from '../../shared-utils.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    // Listen on all interfaces (same as http.createServer default)
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  // Validate port range
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

function getLogOptionsFromCommand(command: Command | null | undefined): LoggerOptions {
  const root = command?.parent?.opts?.() ?? {};
  try {
    const level = normalizeLogLevel(root.logLevel);
    return {
      level,
      json: Boolean(root.jsonLogs),
    };
  } catch (error) {
    handleError(error, { exitOnError: true });
    throw error; // TypeScript doesn't know handleError exits
  }
}

/**
 * Resolve photon path - checks bundled first, then all discovery sources
 * (local workspace > ~/.photon > null)
 */
async function resolvePhotonPathWithBundled(
  name: string,
  _workingDir: string
): Promise<string | null> {
  // Check bundled photons first
  const bundledPath = getBundledPhotonPath(name, __dirname);
  if (bundledPath) {
    return bundledPath;
  }

  // Fall back to merged discovery (local workspace > global)
  return resolvePhotonFromAllSources(name);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the sse command
 *
 * Run Photon as HTTP server with SSE transport (auto port detection)
 */
export function registerSSECommand(program: Command): void {
  program
    .command('sse', { hidden: true })
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .option('-p, --port <number>', 'Port to start from (auto-finds available)', '3000')
    .option('--dev', 'Enable development mode with hot reload')
    .description('Run Photon as HTTP server with SSE transport (auto port detection)')
    .action(async (name: string, options: any, command: Command) => {
      try {
        // Get working directory from global options
        const workingDir = getDefaultContext().baseDir;
        const logOptions = getLogOptionsFromCommand(command);

        // Resolve file path from name
        const filePath = await resolvePhotonPathWithBundled(name, workingDir);

        if (!filePath) {
          exitWithError(`Photon not found: ${name}`, {
            exitCode: ExitCode.NOT_FOUND,
            searchedIn: workingDir,
            suggestion: "Use 'photon info' to see available photons",
          });
        }

        // Find available port
        const startPort = parseInt(options.port, 10);
        const port = await findAvailablePort(startPort);

        if (port !== startPort) {
          console.error(`⚠️  Port ${startPort} is in use, using ${port} instead`);
        }

        const { PhotonServer } = await import('../../server.js');
        const { FileWatcher } = await import('../../watcher.js');

        // Start SSE server
        const server = new PhotonServer({
          filePath: filePath,
          devMode: options.dev,
          transport: 'sse',
          port,
          logOptions: {
            ...logOptions,
            level:
              command.parent?.getOptionValueSource?.('logLevel') === 'cli'
                ? logOptions.level
                : 'warn',
            scope: 'sse',
          },
          workingDir,
        });

        // Handle shutdown signals
        let shuttingDown = false;
        const shutdown = async () => {
          if (shuttingDown) return;
          shuttingDown = true;
          console.error('\nShutting down...');
          // Hard exit if graceful shutdown takes too long
          const forceExit = setTimeout(() => process.exit(0), 3000);
          forceExit.unref();
          try {
            await server.stop();
          } catch {
            // Ignore cleanup errors
          }
          process.exit(0);
        };

        process.on('SIGINT', () => {
          void shutdown();
        });
        process.on('SIGTERM', () => {
          void shutdown();
        });

        // Start the server
        await server.start();

        // Start file watcher in dev mode
        if (options.dev) {
          const watcher = new FileWatcher(server, filePath, server.createScopedLogger('watcher'));
          watcher.start();

          process.on('SIGINT', () => {
            void watcher.stop();
          });
          process.on('SIGTERM', () => {
            void watcher.stop();
          });
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}

/**
 * Register the beam command
 *
 * Launch Photon Beam - interactive control panel for all your photons
 */
export function registerBeamCommand(program: Command): void {
  program
    .command('beam', { hidden: true })
    .argument('[photon]', 'Photon to open in full-width focus view')
    .option('-p, --port <number>', 'Port to start from (auto-finds available)', '3000')
    .option('-o, --open', 'Auto-open browser after starting')
    .option('--no-open', 'Do not auto-open browser')
    .description('Launch Photon Beam - interactive control panel for all your photons')
    .action(async (photon: string | undefined, options: any, command: Command) => {
      try {
        const workingDir = getDefaultContext().baseDir;
        const { announceContext } = await import('../../shared/announce-context.js');
        announceContext({ action: 'Starting Beam', photon, target: workingDir });

        const { existsSync } = await import('fs');

        // If a photon name is given but not installed, try marketplace auto-install
        if (photon) {
          const { MarketplaceManager } = await import('../../marketplace-manager.js');
          const manager = new MarketplaceManager(undefined, workingDir);
          await manager.initialize();

          // Qualified ref (owner/repo or owner/repo/name) — use fetchAndInstallFromRef
          const isQualifiedRef = photon.includes('/');
          if (isQualifiedRef) {
            const { photonName } = await manager.fetchAndInstallFromRef(photon, workingDir);
            photon = photonName; // replace with resolved short name for URL hash
          } else {
            const photonFile = path.join(workingDir, `${photon}.photon.ts`);
            if (!existsSync(photonFile)) {
              const conflict = await manager.checkConflict(photon);
              if (conflict.sources.length === 0) {
                const { printError } = await import('../../cli-formatter.js');
                printError(`Photon '${photon}' not found locally or in marketplace.`);
                console.error(`  Search for it with: photon search ${photon}`);
                process.exit(1);
              }
              console.error(`📦 Installing ${photon}...`);
              const result = await manager.fetchMCP(photon);
              if (result) {
                await manager.installPhoton(result, photon, workingDir);
                console.error(`✅ Installed ${photon}`);
              }
            }
          }
        }

        // Handle shutdown signals BEFORE startBeam — startBeam continues loading
        // photons after the HTTP server is listening, so SIGINT can arrive before
        // startBeam returns. Register handlers early to catch signals during load.
        let shuttingDown = false;
        const shutdown = async () => {
          if (shuttingDown) return;
          shuttingDown = true;

          console.error('\nShutting down Photon Beam...');

          // Hard exit if graceful shutdown takes too long
          const forceExit = setTimeout(() => process.exit(0), 3000);
          forceExit.unref();

          // Gracefully close external MCP clients to prevent ugly tracebacks
          try {
            const { stopBeam } = await import('../../auto-ui/beam.js');
            await stopBeam();
          } catch {
            // Ignore cleanup errors
          }

          process.exit(0);
        };

        process.on('SIGINT', () => {
          void shutdown();
        });
        process.on('SIGTERM', () => {
          void shutdown();
        });

        // startBeam handles port finding internally (with retry and status output)
        const startPort = parseInt(options.port, 10);

        const { startBeam } = await import('../../auto-ui/beam.js');
        await startBeam(workingDir, startPort);

        // Auto-open browser — always when a photon is specified (focus mode), or when --open flag is set
        if (photon || options.open) {
          const actualPort = process.env.BEAM_PORT || startPort;
          // Focus mode: hash routes to the photon, ?focus=1 hides sidebar for full-width view
          const url = photon
            ? `http://localhost:${actualPort}/#${photon}?focus=1`
            : `http://localhost:${actualPort}`;
          const { exec } = await import('child_process');
          const openCmd =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open';
          exec(`${openCmd} "${url}"`, (err) => {
            if (err) logger.debug(`Could not auto-open browser: ${err.message}`);
          });
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}
