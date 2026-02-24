/**
 * PhotonContext — Single source of truth for all path resolution.
 *
 * Replaces the scattered mix of DEFAULT_PHOTON_DIR, DEFAULT_WORKING_DIR,
 * process.env.PHOTON_DIR, and per-constructor baseDir parameters.
 *
 * Design:
 * - socketPath/pidFile/logFile ALWAYS resolve to ~/.photon/ (one global daemon)
 * - baseDir/stateDir/cacheDir/configFile respect --dir/PHOTON_DIR overrides
 * - Immutable after creation — no runtime mutations
 */

import * as path from 'path';
import * as os from 'os';

export interface PhotonContext {
  /** Base directory for photon files (~/.photon or --dir override) */
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
 * @param dirOverride - Explicit --dir flag or PHOTON_DIR env value (resolved to absolute)
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

/** Default context using ~/.photon */
let _defaultContext: PhotonContext | undefined;

/**
 * Get the default PhotonContext (lazy singleton).
 * Use createPhotonContext() when you have an explicit --dir override.
 */
export function getDefaultContext(): PhotonContext {
  if (!_defaultContext) {
    _defaultContext = createPhotonContext();
  }
  return _defaultContext;
}
