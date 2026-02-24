/**
 * Daemon Manager
 *
 * Manages the single global Photon daemon lifecycle.
 * The daemon handles all photons through channel-based isolation.
 *
 * Architecture:
 * - Single daemon process: ~/.photon/daemon.sock
 * - All photons communicate through the same daemon
 * - Channels provide isolation: {photonId}:{itemId}
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DaemonStatus } from './protocol.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { getDefaultContext, type PhotonContext } from '../context.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger({ component: 'daemon-manager', minimal: true });

// Daemon infrastructure always resolves from the default context (global daemon).
const _ctx = getDefaultContext();

// One global daemon per system — always at ~/.photon regardless of PHOTON_DIR.
// PHOTON_DIR affects which photon files are loaded, not where the daemon socket lives.
export const GLOBAL_PID_FILE = _ctx.pidFile;
export const GLOBAL_LOG_FILE = _ctx.logFile;

/**
 * Get global socket path. Always ~/.photon/daemon.sock — one daemon for all instances.
 */
export function getGlobalSocketPath(): string {
  return _ctx.socketPath;
}

/**
 * Test whether the daemon socket is actually accepting connections.
 * This is the definitive liveness check — a process can be alive but the
 * socket stale (e.g. daemon crashed mid-startup, socket file left behind).
 */
async function isSocketAlive(socketPath: string): Promise<boolean> {
  if (process.platform === 'win32' || !fs.existsSync(socketPath)) return false;
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 500);
    sock.on('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Kill any PID recorded in the PID file and remove stale state files.
 * Called when the socket is unresponsive to clean up zombie daemon processes.
 */
function cleanupStaleDaemon(): void {
  const socketPath = getGlobalSocketPath();
  if (fs.existsSync(GLOBAL_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(GLOBAL_PID_FILE, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process already dead — that's fine
      }
    } catch {
      // Can't read PID file
    }
    try {
      fs.unlinkSync(GLOBAL_PID_FILE);
    } catch {
      // Ignore cleanup errors
    }
  }
  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if global daemon is running (synchronous PID check).
 * Callers that need the definitive answer should use startGlobalDaemon() or
 * ensureDaemon() which do a socket responsiveness check.
 */
export function isGlobalDaemonRunning(): boolean {
  if (!fs.existsSync(GLOBAL_PID_FILE)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(GLOBAL_PID_FILE, 'utf-8').trim(), 10);
    // Check if process exists using kill signal 0 (doesn't actually kill)
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist or we don't have permission
    // Clean up stale PID file
    try {
      fs.unlinkSync(GLOBAL_PID_FILE);
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Get global daemon status
 */
export function getGlobalDaemonStatus(): DaemonStatus {
  if (!isGlobalDaemonRunning()) {
    return {
      running: false,
      photonName: 'global',
    };
  }

  const pid = parseInt(fs.readFileSync(GLOBAL_PID_FILE, 'utf-8').trim(), 10);

  return {
    running: true,
    pid,
    photonName: 'global',
  };
}

/**
 * Start the global Photon daemon if not already running.
 * Uses socket responsiveness as the definitive liveness check so that zombie
 * processes (alive but socket dead) are cleaned up rather than treated as "running".
 */
export async function startGlobalDaemon(quiet: boolean = false): Promise<void> {
  if (!fs.existsSync(_ctx.baseDir)) {
    fs.mkdirSync(_ctx.baseDir, { recursive: true });
  }

  const socketPath = getGlobalSocketPath();

  // Socket answers → daemon is alive and healthy, nothing to do
  if (await isSocketAlive(socketPath)) {
    if (!quiet) {
      logger.debug('Global daemon already running');
    }
    return;
  }

  // Socket unresponsive → kill any stale PID and remove leftover socket file
  cleanupStaleDaemon();

  // Spawn daemon process
  // When running via tsx from src/, __dirname points to src/daemon/ where server.js doesn't exist.
  // Fall back to the compiled dist/daemon/server.js in that case.
  const daemonScriptSrc = path.join(__dirname, 'server.js');
  const daemonScript = fs.existsSync(daemonScriptSrc)
    ? daemonScriptSrc
    : daemonScriptSrc.replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`);

  // Log daemon output to file for debugging
  const logStream = fs.openSync(GLOBAL_LOG_FILE, 'a');

  // Global daemon doesn't need photonName/photonPath arguments
  const child = spawn(process.execPath, [daemonScript, socketPath], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env: { ...process.env, PHOTON_DAEMON: 'true' },
  });

  // Detach the child process so it can continue running independently
  child.unref();

  // Write PID file
  fs.writeFileSync(GLOBAL_PID_FILE, child.pid!.toString());

  if (!quiet) {
    logger.info('Started global Photon daemon', { pid: child.pid });
  }

  // Wait for daemon to initialize and verify socket is ready
  const maxWait = 3000;
  const interval = 100;
  let waited = 0;
  while (waited < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    waited += interval;
    if (fs.existsSync(socketPath)) {
      return; // Socket is ready
    }
  }

  if (!quiet) {
    logger.warn('Daemon started but socket not ready within timeout');
  }
}

/**
 * Check if the daemon binary has been updated since the daemon started.
 * Uses the PID file mtime as a proxy for daemon start time —
 * if server.js is newer than the PID file, the binary was rebuilt/reinstalled.
 */
function isDaemonBinaryStale(): boolean {
  if (!fs.existsSync(GLOBAL_PID_FILE)) return false;

  const daemonScriptSrc = path.join(__dirname, 'server.js');
  const daemonScript = fs.existsSync(daemonScriptSrc)
    ? daemonScriptSrc
    : daemonScriptSrc.replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`);

  if (!fs.existsSync(daemonScript)) return false;

  try {
    const daemonStartedAt = fs.statSync(GLOBAL_PID_FILE).mtimeMs;
    const binaryBuiltAt = fs.statSync(daemonScript).mtimeMs;
    return binaryBuiltAt > daemonStartedAt;
  } catch {
    // PID file or daemon script missing — assume no update needed
    return false;
  }
}

/**
 * Ensure daemon is running, start if needed.
 * Auto-restarts if the daemon binary has been updated since the daemon started.
 */
export async function ensureDaemon(quiet: boolean = true): Promise<void> {
  if (isGlobalDaemonRunning() && isDaemonBinaryStale()) {
    if (!quiet) {
      logger.info('Daemon binary updated, restarting...');
    }
    await restartGlobalDaemon();
    return;
  }

  if (!isGlobalDaemonRunning()) {
    await startGlobalDaemon(quiet);
  }
}

/**
 * Stop the global daemon
 */
export function stopGlobalDaemon(): void {
  const socketPath = getGlobalSocketPath();

  if (!fs.existsSync(GLOBAL_PID_FILE)) {
    logger.warn('No global daemon running');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(GLOBAL_PID_FILE, 'utf-8').trim(), 10);

    // Send SIGTERM to gracefully shut down
    try {
      process.kill(pid, 'SIGTERM');
    } catch (killError: any) {
      // ESRCH = process already dead, not an error
      if (killError.code !== 'ESRCH') throw killError;
    }

    // Clean up PID file
    fs.unlinkSync(GLOBAL_PID_FILE);

    // Clean up socket file (Unix only)
    if (fs.existsSync(socketPath) && process.platform !== 'win32') {
      fs.unlinkSync(socketPath);
    }

    logger.debug('Stopped global daemon', { pid });
  } catch (error) {
    logger.debug('Error stopping global daemon', { error: getErrorMessage(error) });
  }
}

/**
 * Restart the global daemon (stop → clean socket → start)
 * Used by daemon client when connection fails and auto-restart is needed.
 */
export async function restartGlobalDaemon(): Promise<void> {
  stopGlobalDaemon();

  // Wait for graceful shutdown
  await new Promise((r) => setTimeout(r, 300));

  // Clean stale socket if still present
  const socketPath = getGlobalSocketPath();
  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore — startGlobalDaemon will also clean it
    }
  }

  await startGlobalDaemon(true);
}

/**
 * Stop all daemons (now just stops the single global daemon)
 */
export function stopAllDaemons(): void {
  stopGlobalDaemon();
}
