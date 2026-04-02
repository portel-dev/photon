/**
 * PhotonContext — Single source of truth for all path resolution.
 *
 * Replaces the scattered mix of DEFAULT_PHOTON_DIR, DEFAULT_WORKING_DIR,
 * process.env.PHOTON_DIR, and per-constructor baseDir parameters.
 *
 * Design:
 * - All runtime data lives under {baseDir}/.data/
 * - Daemon socket/pid/log ALWAYS resolve to ~/.photon/.data/ (one global daemon)
 * - baseDir/dataDir/cacheDir/configFile respect PHOTON_DIR env var overrides
 * - Immutable after creation — no runtime mutations
 */

import * as path from 'path';
import * as os from 'os';
import {
  getDataRoot,
  getCacheDir,
  getDaemonSocketPath,
  getDaemonPidPath,
  getDaemonLogPath,
} from '@portel/photon-core';

export interface PhotonContext {
  /** Base directory for photon files (~/.photon or PHOTON_DIR override) */
  readonly baseDir: string;
  /** Root of all runtime data (baseDir/.data) */
  readonly dataDir: string;
  /** Cache directory (baseDir/.data/.cache) */
  readonly cacheDir: string;
  /** Config file path (baseDir/config.json) — committable, not inside .data */
  readonly configFile: string;
  /** Daemon socket — ALWAYS ~/.photon/.data/daemon.sock (global daemon) */
  readonly socketPath: string;
  /** Daemon PID file — ALWAYS ~/.photon/.data/daemon.pid */
  readonly pidFile: string;
  /** Daemon log file — ALWAYS ~/.photon/.data/daemon.log */
  readonly logFile: string;

  /**
   * @deprecated Use dataDir instead. State is now per-photon inside .data/
   */
  readonly stateDir: string;
}

/** Default photon directory: ~/.photon */
const HOME_PHOTON_DIR = path.join(os.homedir(), '.photon');

/**
 * Get the default PhotonContext.
 * Respects PHOTON_DIR env var; falls back to ~/.photon.
 *
 * Not cached — env var may change between calls (e.g. tests).
 */
export function getDefaultContext(): PhotonContext {
  const dirOverride = process.env.PHOTON_DIR;
  const baseDir = dirOverride ? path.resolve(dirOverride) : HOME_PHOTON_DIR;

  return Object.freeze({
    baseDir,
    dataDir: getDataRoot(baseDir),
    stateDir: path.join(baseDir, 'state'), // legacy compat
    cacheDir: getCacheDir(baseDir),
    configFile: path.join(baseDir, 'config.json'),
    socketPath: getDaemonSocketPath(),
    pidFile: getDaemonPidPath(),
    logFile: getDaemonLogPath(),
  });
}
