/**
 * PhotonContext — Single source of truth for all path resolution.
 *
 * Replaces the scattered mix of DEFAULT_PHOTON_DIR, DEFAULT_WORKING_DIR,
 * process.env.PHOTON_DIR, and per-constructor baseDir parameters.
 *
 * Design:
 * - socketPath/pidFile/logFile ALWAYS resolve to ~/.photon/ (one global daemon)
 * - baseDir/stateDir/cacheDir/configFile respect PHOTON_DIR env var overrides
 * - Immutable after creation — no runtime mutations
 */

import * as path from 'path';
import * as os from 'os';

export interface PhotonContext {
  /** Base directory for photon files (~/.photon or PHOTON_DIR override) */
  readonly baseDir: string;
  /** State directory (baseDir/state) */
  readonly stateDir: string;
  /** Cache directory (baseDir/.cache) */
  readonly cacheDir: string;
  /** Config file path (baseDir/config.json) */
  readonly configFile: string;
  /** Daemon socket — ALWAYS ~/.photon/daemon.sock (global daemon) */
  readonly socketPath: string;
  /** Daemon PID file — ALWAYS ~/.photon/daemon.pid */
  readonly pidFile: string;
  /** Daemon log file — ALWAYS ~/.photon/daemon.log */
  readonly logFile: string;
}

/** Default photon directory: ~/.photon */
const HOME_PHOTON_DIR = path.join(os.homedir(), '.photon');

/**
 * Create an immutable PhotonContext.
 *
 * @param dirOverride - Explicit PHOTON_DIR env value or internal override (resolved to absolute)
 */
export function createPhotonContext(dirOverride?: string): PhotonContext {
  const baseDir = dirOverride ? path.resolve(dirOverride) : HOME_PHOTON_DIR;

  // Daemon infrastructure is always global — one daemon per system
  const socketPath =
    process.platform === 'win32'
      ? '\\\\.\\pipe\\photon-daemon'
      : path.join(HOME_PHOTON_DIR, 'daemon.sock');

  return Object.freeze({
    baseDir,
    stateDir: path.join(baseDir, 'state'),
    cacheDir: path.join(baseDir, '.cache'),
    configFile: path.join(baseDir, 'config.json'),
    socketPath,
    pidFile: path.join(HOME_PHOTON_DIR, 'daemon.pid'),
    logFile: path.join(HOME_PHOTON_DIR, 'daemon.log'),
  });
}

/**
 * Get the default PhotonContext.
 * Respects PHOTON_DIR env var; falls back to ~/.photon.
 *
 * Not cached — env var may change between calls (e.g. tests).
 */
export function getDefaultContext(): PhotonContext {
  return createPhotonContext(process.env.PHOTON_DIR);
}
