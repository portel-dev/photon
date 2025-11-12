/**
 * Daemon Manager
 *
 * Manages daemon lifecycle: start, stop, status, health checks
 * Handles PID files, socket files, and process spawning
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { DaemonStatus } from './protocol.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTON_DIR = path.join(os.homedir(), '.photon');
const DAEMON_DIR = path.join(PHOTON_DIR, 'daemons');

/**
 * Ensure daemon directories exist
 */
function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

/**
 * Get PID file path for a photon
 */
function getPidFile(photonName: string): string {
  return path.join(DAEMON_DIR, `${photonName}.pid`);
}

/**
 * Get socket file path for a photon
 */
export function getSocketPath(photonName: string): string {
  // Use different paths for Windows (named pipe) vs Unix (domain socket)
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\photon-${photonName}`;
  }
  return path.join(DAEMON_DIR, `${photonName}.sock`);
}

/**
 * Check if daemon is running for a photon
 */
export function isDaemonRunning(photonName: string): boolean {
  const pidFile = getPidFile(photonName);

  if (!fs.existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

    // Check if process exists using kill signal 0 (doesn't actually kill)
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Process doesn't exist or we don't have permission
    // Clean up stale PID file
    fs.unlinkSync(pidFile);
    return false;
  }
}

/**
 * Get daemon status
 */
export function getDaemonStatus(photonName: string): DaemonStatus {
  const pidFile = getPidFile(photonName);

  if (!isDaemonRunning(photonName)) {
    return {
      running: false,
      photonName,
    };
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

  return {
    running: true,
    pid,
    photonName,
  };
}

/**
 * Start daemon for a photon
 */
export async function startDaemon(photonName: string, photonPath: string): Promise<void> {
  ensureDaemonDir();

  if (isDaemonRunning(photonName)) {
    console.error(`[daemon] Daemon already running for ${photonName}`);
    return;
  }

  const pidFile = getPidFile(photonName);
  const socketPath = getSocketPath(photonName);

  // Clean up old socket file if it exists
  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    fs.unlinkSync(socketPath);
  }

  // Spawn daemon process
  // The daemon server will be a separate Node process running the photon
  const daemonScript = path.join(__dirname, 'server.js');

  const child = spawn(process.execPath, [daemonScript, photonName, photonPath, socketPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PHOTON_DAEMON: 'true' },
  });

  // Detach the child process so it can continue running independently
  child.unref();

  // Write PID file
  fs.writeFileSync(pidFile, child.pid!.toString());

  console.error(`[daemon] Started daemon for ${photonName} (PID: ${child.pid})`);

  // Wait a bit for daemon to initialize
  await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Stop daemon for a photon
 */
export function stopDaemon(photonName: string): void {
  const pidFile = getPidFile(photonName);
  const socketPath = getSocketPath(photonName);

  if (!fs.existsSync(pidFile)) {
    console.error(`[daemon] No daemon running for ${photonName}`);
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

    // Send SIGTERM to gracefully shut down
    process.kill(pid, 'SIGTERM');

    // Clean up PID file
    fs.unlinkSync(pidFile);

    // Clean up socket file (Unix only)
    if (fs.existsSync(socketPath) && process.platform !== 'win32') {
      fs.unlinkSync(socketPath);
    }

    console.error(`[daemon] Stopped daemon for ${photonName}`);
  } catch (error: any) {
    console.error(`[daemon] Error stopping daemon: ${error.message}`);
  }
}

/**
 * Stop all running daemons
 */
export function stopAllDaemons(): void {
  ensureDaemonDir();

  const pidFiles = fs.readdirSync(DAEMON_DIR).filter(f => f.endsWith('.pid'));

  for (const pidFile of pidFiles) {
    const photonName = pidFile.replace('.pid', '');
    stopDaemon(photonName);
  }
}
