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
import * as fs from 'fs';
import {
  getDataRoot,
  getCacheDir,
  getDaemonSocketPath,
  getDaemonPidPath,
  getDaemonLogPath,
  listPhotonFilesWithNamespace,
  resolvePhotonPath,
  type ListedPhoton,
} from '@portel/photon-core';
import { logger } from './shared/logger.js';

export interface PhotonContext {
  /** Base directory for photon files (~/.photon or PHOTON_DIR override) */
  readonly baseDir: string;
  /** Root of all runtime data — ALWAYS ~/.photon/.data (canonical, never cwd-relative) */
  readonly dataDir: string;
  /** Cache directory — ALWAYS ~/.photon/.data/.cache */
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
 * Check if a directory contains .photon.ts files (is a marketplace or photon workspace).
 */
function isPhotonDirectory(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some((e) => e.endsWith('.photon.ts'));
  } catch {
    return false;
  }
}

/**
 * Get the default PhotonContext.
 * Priority: cwd (if it contains .photon.ts files) > PHOTON_DIR env var > ~/.photon.
 *
 * Not cached — env var may change between calls (e.g. tests).
 */
export function getDefaultContext(): PhotonContext {
  const cwd = process.cwd();
  let baseDir: string;

  if (process.env.PHOTON_DIR) {
    // Explicit PHOTON_DIR always wins — once set, all downstream code respects it
    baseDir = path.resolve(process.env.PHOTON_DIR);
  } else if (isPhotonDirectory(cwd)) {
    // cwd is a marketplace or photon workspace — use it and set env for downstream
    baseDir = cwd;
    process.env.PHOTON_DIR = cwd;
  } else {
    baseDir = HOME_PHOTON_DIR;
  }

  // Data/cache/state ALWAYS live under ~/.photon — never cwd-relative.
  // This ensures the same photon always reads/writes the same state file
  // regardless of which process (CLI, Beam, Claude Desktop) launched it.
  return Object.freeze({
    baseDir,
    dataDir: getDataRoot(HOME_PHOTON_DIR),
    stateDir: path.join(HOME_PHOTON_DIR, 'state'), // legacy compat
    cacheDir: getCacheDir(HOME_PHOTON_DIR),
    configFile: path.join(baseDir, 'config.json'),
    socketPath: getDaemonSocketPath(),
    pidFile: getDaemonPidPath(),
    logFile: getDaemonLogPath(),
  });
}

/**
 * Get the local workspace directory if cwd or PHOTON_DIR points to a
 * photon/marketplace folder that isn't ~/.photon itself.
 *
 * Priority: PHOTON_DIR (explicit override) > cwd (implicit detection).
 * Returns null when no extra workspace applies.
 */
export function getLocalWorkspace(): string | null {
  const homeResolved = path.resolve(HOME_PHOTON_DIR);

  // PHOTON_DIR takes precedence — explicit override always wins
  if (process.env.PHOTON_DIR) {
    const envDir = path.resolve(process.env.PHOTON_DIR);
    if (envDir !== homeResolved && isPhotonDirectory(envDir)) return envDir;
  }

  // Fall back to cwd detection
  const cwd = process.cwd();
  if (path.resolve(cwd) !== homeResolved && isPhotonDirectory(cwd)) return cwd;

  return null;
}

/**
 * Discover photons from all sources, merged with correct priority:
 * 1. PHOTON_DIR / cwd marketplace — highest priority (same name wins)
 * 2. ~/.photon (global installed photons)
 *
 * This ensures that when you're in a marketplace folder (or PHOTON_DIR
 * is set), those photons overlay the global ones for development/testing.
 */
export async function discoverPhotons(): Promise<ListedPhoton[]> {
  const cleanupHandler = (name: string, symlinkPath: string) => {
    logger.info(`🧹 Removed stale symlink for "${name}" (target no longer exists): ${symlinkPath}`);
  };

  // Always start with global ~/.photon photons
  const globalPhotons = await listPhotonFilesWithNamespace(HOME_PHOTON_DIR, {
    onCleanup: cleanupHandler,
  });

  const localDir = getLocalWorkspace();
  if (!localDir) return globalPhotons;

  // Local/PHOTON_DIR photons take priority
  const localPhotons = await listPhotonFilesWithNamespace(localDir, { onCleanup: cleanupHandler });
  const localNames = new Set(localPhotons.map((p) => p.name));

  // Merge: local first, then global (skip global duplicates)
  return [...localPhotons, ...globalPhotons.filter((p) => !localNames.has(p.name))];
}

/**
 * Discover photons from baseDir only — no global merge.
 * Used by Beam to scope the sidebar to the current project.
 * Relies on PHOTON_DIR being set at the entry point.
 */
export async function discoverLocalPhotons(): Promise<ListedPhoton[]> {
  const cleanupHandler = (name: string, symlinkPath: string) => {
    logger.info(`🧹 Removed stale symlink for "${name}" (target no longer exists): ${symlinkPath}`);
  };

  return listPhotonFilesWithNamespace(getDefaultContext().baseDir, { onCleanup: cleanupHandler });
}

/**
 * Resolve a photon by name across all discovery sources.
 * Priority: PHOTON_DIR / local workspace > ~/.photon > null.
 */
export async function resolvePhotonFromAllSources(name: string): Promise<string | null> {
  const localDir = getLocalWorkspace();

  // Check local/PHOTON_DIR workspace first (higher priority)
  if (localDir) {
    const localPath = await resolvePhotonPath(name, localDir);
    if (localPath) return localPath;
  }

  // Fall back to global ~/.photon
  return resolvePhotonPath(name, HOME_PHOTON_DIR);
}
