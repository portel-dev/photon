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
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DaemonStatus } from './protocol.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTON_DIR = path.join(os.homedir(), '.photon');
const logger = createLogger({ component: 'daemon-manager', minimal: true });

// Global daemon paths (single daemon for all photons)
const GLOBAL_PID_FILE = path.join(PHOTON_DIR, 'daemon.pid');
const GLOBAL_LOG_FILE = path.join(PHOTON_DIR, 'daemon.log');

/**
 * Get global socket path for the Photon daemon
 */
export function getGlobalSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\photon-daemon';
  }
  return path.join(PHOTON_DIR, 'daemon.sock');
}

/**
 * Get socket path - now returns global socket regardless of photonName
 * @deprecated Use getGlobalSocketPath() directly. photonName parameter is ignored.
 */
export function getSocketPath(_photonName?: string): string {
  return getGlobalSocketPath();
}

/**
 * Ensure photon directory exists
 */
function ensurePhotonDir(): void {
  if (!fs.existsSync(PHOTON_DIR)) {
    fs.mkdirSync(PHOTON_DIR, { recursive: true });
  }
}

/**
 * Check if global daemon is running
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
 * Check if daemon is running
 * @deprecated Use isGlobalDaemonRunning(). photonName parameter is ignored.
 */
export function isDaemonRunning(_photonName?: string): boolean {
  return isGlobalDaemonRunning();
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
 * Get daemon status
 * @deprecated Use getGlobalDaemonStatus(). photonName parameter is ignored.
 */
export function getDaemonStatus(_photonName?: string): DaemonStatus {
  return getGlobalDaemonStatus();
}

/**
 * Start the global Photon daemon if not already running
 */
export async function startGlobalDaemon(quiet: boolean = false): Promise<void> {
  ensurePhotonDir();

  if (isGlobalDaemonRunning()) {
    if (!quiet) {
      logger.debug('Global daemon already running');
    }
    return;
  }

  const socketPath = getGlobalSocketPath();

  // Clean up old socket file if it exists
  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    fs.unlinkSync(socketPath);
  }

  // Spawn daemon process
  const daemonScript = path.join(__dirname, 'server.js');

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

  // Wait a bit for daemon to initialize
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Start daemon - ensures global daemon is running
 * @deprecated Use startGlobalDaemon(). photonName/photonPath parameters are ignored.
 */
export async function startDaemon(
  _photonName?: string,
  _photonPath?: string,
  quiet: boolean = false
): Promise<void> {
  return startGlobalDaemon(quiet);
}

/**
 * Ensure daemon is running, start if needed
 */
export async function ensureDaemon(quiet: boolean = true): Promise<void> {
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
 * Stop daemon
 * @deprecated Use stopGlobalDaemon(). photonName parameter is ignored.
 */
export function stopDaemon(_photonName?: string): void {
  return stopGlobalDaemon();
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
