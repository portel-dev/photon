/**
 * Instance Store & Environment Store
 *
 * Manages:
 * - Instance naming → .data/{ns}/{photon}/context.json
 * - Environment vars → .data/{ns}/{photon}/env.json
 * - Instance state paths → .data/{ns}/{photon}/state/{instance}/state.json
 *
 * Instance naming is a runtime concept. Every @stateful photon automatically
 * supports named instances — the runtime manages them. Clients (CLI, Beam,
 * Claude Desktop) specify which instance to use via the _use MCP tool.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { ConstructorParam } from '@portel/photon-core';
import {
  getPhotonContextPath,
  getPhotonEnvPath,
  getPhotonStatePath,
  getPhotonStateLogPath,
  getPhotonDataDir,
  getLegacyContextPath,
  getLegacyEnvPath,
  getLegacyStatePath,
  getLegacyStateLogPath,
  DEFAULT_PHOTON_DIR,
} from '@portel/photon-core';
import { isNodeError, getErrorMessage } from './shared/error-handler.js';

// ══════════════════════════════════════════════════════════════════════════════
// Instance Store — tracks current instance name per photon per client
// ══════════════════════════════════════════════════════════════════════════════

export class InstanceStore {
  private baseDir: string;

  constructor(_baseDir?: string) {
    // State ALWAYS lives under ~/.photon — canonical location regardless of
    // which process (CLI, Beam, Claude Desktop) or cwd launched the runtime.
    this.baseDir = DEFAULT_PHOTON_DIR;
  }

  private _path(photonName: string, namespace?: string): string {
    const ns = namespace || 'local';
    const newPath = getPhotonContextPath(ns, photonName, this.baseDir);
    if (!fs.existsSync(newPath)) {
      const legacyPath = getLegacyContextPath(photonName, this.baseDir);
      if (fs.existsSync(legacyPath)) return legacyPath;
    }
    return newPath;
  }

  /**
   * Get current instance name for a photon. Returns "" for default.
   */
  getCurrentInstance(photonName: string, namespace?: string): string {
    try {
      const data = JSON.parse(fs.readFileSync(this._path(photonName, namespace), 'utf-8'));
      return data.instance || '';
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) return ''; // No instance set — expected
      console.warn(
        `[photon] Corrupt instance file for ${photonName}, resetting: ${getErrorMessage(err)}`
      );
      return '';
    }
  }

  /**
   * Set current instance name for a photon. Pass "" for default.
   * Always writes to new .data/ path.
   */
  setCurrentInstance(photonName: string, instance: string, namespace?: string): void {
    const ns = namespace || 'local';
    const filePath = getPhotonContextPath(ns, photonName, this.baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ instance }, null, 2));
  }

  /**
   * List all instances by scanning state directories.
   * Checks .data/ path first, then legacy paths.
   */
  listInstances(photonName: string, photonFilePath?: string, namespace?: string): string[] {
    const instances = new Set<string>();
    const ns = namespace || 'local';

    // New .data/ state dir
    const dataStateDir = path.join(getPhotonDataDir(ns, photonName, this.baseDir), 'state');
    try {
      for (const entry of fs.readdirSync(dataStateDir, { withFileTypes: true })) {
        if (entry.isDirectory()) instances.add(entry.name);
      }
    } catch {
      // .data/ state dir doesn't exist yet
    }

    // Legacy state dir: ~/.photon/state/{photon}/
    const legacyStateDir = path.join(this.baseDir, 'state', photonName);
    try {
      for (const f of fs.readdirSync(legacyStateDir)) {
        if (f.endsWith('.json')) instances.add(f.replace('.json', ''));
      }
    } catch (err) {
      if (!isNodeError(err, 'ENOENT')) {
        console.warn(`[photon] Cannot read instances for ${photonName}: ${getErrorMessage(err)}`);
      }
    }

    // Old namespace-aware .state/ dir (pre-.data/ consolidation)
    if (photonFilePath) {
      const dir = path.dirname(photonFilePath);
      const baseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
      const nsStateDir = path.join(dir, baseName, '.state');
      try {
        for (const entry of fs.readdirSync(nsStateDir, { withFileTypes: true })) {
          if (entry.isDirectory()) instances.add(entry.name);
        }
      } catch {
        // .state/ dir doesn't exist
      }
    }

    return [...instances];
  }

  /**
   * List instances sorted by modification time (most recent first).
   */
  listInstancesByMtime(
    photonName: string,
    namespace?: string
  ): {
    instances: string[];
    autoInstance: string;
    metadata: Record<string, { createdAt: string; modifiedAt: string }>;
  } {
    const ns = namespace || 'local';

    // Check .data/ state dir first, then legacy dirs
    const candidateDirs = [
      path.join(getPhotonDataDir(ns, photonName, this.baseDir), 'state'),
      path.join(this.baseDir, photonName, 'boards'),
      path.join(this.baseDir, 'state', photonName),
    ];

    for (const dir of candidateDirs) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // New layout: directories containing state.json
        const dirEntries = entries.filter((e) => e.isDirectory());
        if (dirEntries.length > 0) {
          const withStat = dirEntries
            .filter((e) => fs.existsSync(path.join(dir, e.name, 'state.json')))
            .map((e) => {
              const stat = fs.statSync(path.join(dir, e.name, 'state.json'));
              return {
                name: e.name,
                mtime: stat.mtimeMs,
                createdAt: stat.birthtime.toISOString(),
                modifiedAt: stat.mtime.toISOString(),
              };
            });
          if (withStat.length > 0) {
            withStat.sort((a, b) => b.mtime - a.mtime);
            const instances = withStat.map((f) => f.name);
            const metadata: Record<string, { createdAt: string; modifiedAt: string }> = {};
            for (const entry of withStat) {
              metadata[entry.name] = { createdAt: entry.createdAt, modifiedAt: entry.modifiedAt };
            }
            return { instances, autoInstance: instances[0] || 'default', metadata };
          }
        }

        // Legacy layout: .json files
        const jsonFiles = entries.filter(
          (e) =>
            (e.isFile() || e.isSymbolicLink()) &&
            e.name.endsWith('.json') &&
            !e.name.endsWith('.archive.jsonl')
        );
        if (jsonFiles.length > 0) {
          const withStat = jsonFiles.map((f) => {
            const stat = fs.statSync(path.join(dir, f.name));
            return {
              name: f.name.replace('.json', ''),
              mtime: stat.mtimeMs,
              createdAt: stat.birthtime.toISOString(),
              modifiedAt: stat.mtime.toISOString(),
            };
          });
          withStat.sort((a, b) => b.mtime - a.mtime);
          const instances = withStat.map((f) => f.name);
          const metadata: Record<string, { createdAt: string; modifiedAt: string }> = {};
          for (const entry of withStat) {
            metadata[entry.name] = { createdAt: entry.createdAt, modifiedAt: entry.modifiedAt };
          }
          return { instances, autoInstance: instances[0] || 'default', metadata };
        }
      } catch {
        // Dir doesn't exist, try next
      }
    }
    return { instances: [], autoInstance: 'default', metadata: {} };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI Session Store — per-terminal-session instance tracking
// Uses the controlling terminal (TTY) to scope to the current terminal window.
// Falls back to PPID for non-TTY environments (CI, cron, etc.).
// Files live in /tmp so they're cleaned on reboot.
// ══════════════════════════════════════════════════════════════════════════════

export class CLISessionStore {
  private sessionDir: string;

  constructor() {
    const sessionKey = CLISessionStore._getSessionKey();
    this.sessionDir = path.join(os.tmpdir(), 'photon-cli-sessions', sessionKey);
  }

  /**
   * Get a stable session key for the current terminal.
   */
  private static _getSessionKey(): string {
    try {
      const tty = execSync(`ps -o tty= -p ${process.pid}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (tty && tty !== '??' && tty !== '?') {
        return `tty-${tty.replace(/\//g, '-')}`;
      }
    } catch {
      // ps not available or failed
    }
    return String(process.ppid);
  }

  private _path(photonName: string): string {
    return path.join(this.sessionDir, `${photonName}.instance`);
  }

  getCurrentInstance(photonName: string): string {
    try {
      return fs.readFileSync(this._path(photonName), 'utf-8').trim();
    } catch {
      return ''; // No session instance set → default
    }
  }

  setCurrentInstance(photonName: string, instance: string): void {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    fs.writeFileSync(this._path(photonName), instance);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Environment Store — for `photon set` (primitive params without defaults)
// ══════════════════════════════════════════════════════════════════════════════

export class EnvStore {
  private baseDir: string;

  constructor(_baseDir?: string) {
    this.baseDir = DEFAULT_PHOTON_DIR;
  }

  private _path(photonName: string, namespace?: string): string {
    const ns = namespace || 'local';
    const newPath = getPhotonEnvPath(ns, photonName, this.baseDir);
    if (!fs.existsSync(newPath)) {
      const legacyPath = getLegacyEnvPath(photonName, this.baseDir);
      if (fs.existsSync(legacyPath)) return legacyPath;
    }
    return newPath;
  }

  read(photonName: string, namespace?: string): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this._path(photonName, namespace), 'utf-8'));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) return {};
      console.warn(
        `[photon] Corrupt env file for ${photonName}, resetting: ${getErrorMessage(err)}`
      );
      return {};
    }
  }

  /**
   * Write env vars. Always writes to new .data/ path.
   */
  write(photonName: string, values: Record<string, string>, namespace?: string): void {
    const ns = namespace || 'local';
    const filePath = getPhotonEnvPath(ns, photonName, this.baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = this.read(photonName, namespace);
    const merged = { ...existing, ...values };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
  }

  /**
   * Get the value of a specific env param.
   */
  resolve(
    photonName: string,
    paramName: string,
    envVarName: string,
    namespace?: string
  ): string | undefined {
    const stored = this.read(photonName, namespace);
    if (stored[paramName] !== undefined) return stored[paramName];
    return process.env[envVarName];
  }

  /**
   * Get masked values for display.
   */
  getMasked(photonName: string, namespace?: string): Record<string, string> {
    const values = this.read(photonName, namespace);
    const masked: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val.length > 6) {
        masked[key] = val.slice(0, 3) + '***' + val.slice(-3);
      } else {
        masked[key] = '***';
      }
    }
    return masked;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Instance State Path — resolves to .data/ with legacy fallback
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get the state file path for a photon instance.
 * New: .data/{ns}/{photon}/state/{instance}/state.json
 * Falls back to legacy paths if new path doesn't exist yet.
 */
export function getInstanceStatePath(
  photonName: string,
  instance: string,
  _baseDir?: string,
  photonFilePath?: string,
  namespace?: string
): string {
  const name = instance || 'default';
  const ns = namespace || 'local';
  // State ALWAYS lives under ~/.photon — canonical location regardless of
  // which process (CLI, Beam, Claude Desktop) or cwd launched the runtime.
  const canonicalBase = DEFAULT_PHOTON_DIR;

  const newPath = getPhotonStatePath(ns, photonName, name, canonicalBase);

  // Check legacy paths in order of preference
  if (!fs.existsSync(path.dirname(newPath))) {
    // Old namespace-aware: <dir>/<photonName>/.state/<instance>/state.json
    if (photonFilePath) {
      const dir = path.dirname(photonFilePath);
      const photonBaseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
      const oldNsPath = path.join(dir, photonBaseName, '.state', name, 'state.json');
      if (fs.existsSync(oldNsPath)) return oldNsPath;
    }

    // Legacy flat: ~/.photon/state/{photon}/{instance}.json
    const legacyPath = getLegacyStatePath(photonName, name, canonicalBase);
    if (fs.existsSync(legacyPath)) return legacyPath;
  }

  return newPath;
}

/**
 * Get the event log path for a photon instance.
 * New: .data/{ns}/{photon}/state/{instance}/state.log
 */
export function getInstanceLogPath(
  photonName: string,
  instance: string,
  _baseDir?: string,
  photonFilePath?: string,
  namespace?: string
): string {
  const name = instance || 'default';
  const ns = namespace || 'local';
  const canonicalBase = DEFAULT_PHOTON_DIR;

  const newPath = getPhotonStateLogPath(ns, photonName, name, canonicalBase);

  if (!fs.existsSync(path.dirname(newPath))) {
    if (photonFilePath) {
      const dir = path.dirname(photonFilePath);
      const photonBaseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
      const oldNsPath = path.join(dir, photonBaseName, '.state', name, 'state.log');
      if (fs.existsSync(oldNsPath)) return oldNsPath;
    }

    const legacyPath = getLegacyStateLogPath(photonName, name, canonicalBase);
    if (fs.existsSync(legacyPath)) return legacyPath;
  }

  return newPath;
}

export function getEnvParams(params: ConstructorParam[]): ConstructorParam[] {
  return params.filter((p) => p.isPrimitive && !p.hasDefault);
}
