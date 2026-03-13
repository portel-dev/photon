/**
 * Instance Store & Environment Store
 *
 * Manages:
 * - Instance naming → `photon use <photon> [name]` → ~/.photon/context/{photon}.json
 * - Environment vars → `photon set` → ~/.photon/env/{photon}.json
 * - Instance state paths → ~/.photon/state/{photon}/{instance}.json
 *
 * Instance naming is a runtime concept. Every @stateful photon automatically
 * supports named instances — the runtime manages them. Clients (CLI, Beam,
 * Claude Desktop) specify which instance to use via the _use MCP tool.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ConstructorParam } from '@portel/photon-core';
import { getDefaultContext } from './context.js';
import { isNodeError, getErrorMessage } from './shared/error-handler.js';

// ══════════════════════════════════════════════════════════════════════════════
// Instance Store — tracks current instance name per photon per client
// ══════════════════════════════════════════════════════════════════════════════

export class InstanceStore {
  private baseDir: string;

  constructor(baseDir: string = getDefaultContext().baseDir) {
    this.baseDir = baseDir;
  }

  private _path(photonName: string): string {
    return path.join(this.baseDir, 'context', `${photonName}.json`);
  }

  /**
   * Get current instance name for a photon. Returns "" for default.
   */
  getCurrentInstance(photonName: string): string {
    try {
      const data = JSON.parse(fs.readFileSync(this._path(photonName), 'utf-8'));
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
   */
  setCurrentInstance(photonName: string, instance: string): void {
    const filePath = this._path(photonName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ instance }, null, 2));
  }

  /**
   * List all instances by scanning the state directory.
   * Checks both legacy state dir and new namespace-based .state/ dirs.
   */
  listInstances(photonName: string, photonFilePath?: string): string[] {
    const instances = new Set<string>();

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

    // Namespace-aware state dir: <dir>/<photonName>/.state/
    if (photonFilePath) {
      const dir = path.dirname(photonFilePath);
      const baseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
      const nsStateDir = path.join(dir, baseName, '.state');
      try {
        for (const entry of fs.readdirSync(nsStateDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            // Each subdirectory is an instance
            instances.add(entry.name);
          }
        }
      } catch {
        // .state/ dir doesn't exist yet — normal
      }
    }

    return [...instances];
  }

  /**
   * List instances sorted by modification time (most recent first).
   * Also checks the legacy boards directory for photons like kanban.
   */
  listInstancesByMtime(photonName: string): {
    instances: string[];
    autoInstance: string;
    metadata: Record<string, { createdAt: string; modifiedAt: string }>;
  } {
    // Check content dirs first (actual data), then state dir (selection tracking).
    // The state dir is updated by _use (instance switching), so its mtime reflects
    // when an instance was last selected, not when content was last modified.
    const candidateDirs = [
      path.join(this.baseDir, photonName, 'boards'),
      path.join(this.baseDir, 'state', photonName),
    ];

    for (const dir of candidateDirs) {
      try {
        const files = fs.readdirSync(dir);
        const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('.archive.jsonl'));
        if (jsonFiles.length === 0) continue;
        const withStat = jsonFiles.map((f) => {
          const stat = fs.statSync(path.join(dir, f));
          return {
            name: f.replace('.json', ''),
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
   * Uses the controlling terminal (TTY) name — consistent across subshells,
   * pipes, and $() command substitutions within the same terminal window.
   * Falls back to PPID for non-TTY environments.
   */
  private static _getSessionKey(): string {
    try {
      const { execSync } = require('child_process');
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

  constructor(baseDir: string = getDefaultContext().baseDir) {
    this.baseDir = baseDir;
  }

  private _path(photonName: string): string {
    return path.join(this.baseDir, 'env', `${photonName}.json`);
  }

  read(photonName: string): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this._path(photonName), 'utf-8'));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) return {};
      console.warn(
        `[photon] Corrupt env file for ${photonName}, resetting: ${getErrorMessage(err)}`
      );
      return {};
    }
  }

  write(photonName: string, values: Record<string, string>): void {
    const filePath = this._path(photonName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = this.read(photonName);
    const merged = { ...existing, ...values };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
  }

  /**
   * Get the value of a specific env param.
   * Checks stored values first, then process.env with the given envVarName.
   */
  resolve(photonName: string, paramName: string, envVarName: string): string | undefined {
    const stored = this.read(photonName);
    if (stored[paramName] !== undefined) return stored[paramName];
    return process.env[envVarName];
  }

  /**
   * Get masked values for display (hide middle of strings).
   */
  getMasked(photonName: string): Record<string, string> {
    const values = this.read(photonName);
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
// Instance State Path
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get the state file path for a photon instance.
 *
 * When photonFilePath is provided (namespace-aware), resolves to:
 *   <dir>/<photonName>/.state/<instance>/state.json
 * Otherwise (legacy), resolves to:
 *   ~/.photon/state/{photon}/{instance}.json
 *
 * Falls back to legacy path if the new path doesn't exist yet but legacy does.
 */
export function getInstanceStatePath(
  photonName: string,
  instance: string,
  baseDir?: string,
  photonFilePath?: string
): string {
  const name = instance || 'default';

  if (photonFilePath) {
    // Namespace-aware path: <dir>/<photonName>/.state/<instance>/state.json
    const dir = path.dirname(photonFilePath);
    const photonBaseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
    const newPath = path.join(dir, photonBaseName, '.state', name, 'state.json');

    // Check if legacy path has existing data to migrate from
    const legacyDir = baseDir || getDefaultContext().baseDir;
    const legacyPath = path.join(legacyDir, 'state', photonName, `${name}.json`);
    if (!fs.existsSync(path.dirname(newPath)) && fs.existsSync(legacyPath)) {
      return legacyPath; // Use legacy path until migration
    }
    return newPath;
  }

  // Legacy path
  const dir = baseDir || getDefaultContext().baseDir;
  return path.join(dir, 'state', photonName, `${name}.json`);
}

/**
 * Get the event log path for a photon instance.
 *
 * When photonFilePath is provided (namespace-aware), resolves to:
 *   <dir>/<photonName>/.state/<instance>/state.log
 * Otherwise (legacy), resolves to:
 *   ~/.photon/state/{photon}/{instance}.log
 */
export function getInstanceLogPath(
  photonName: string,
  instance: string,
  baseDir?: string,
  photonFilePath?: string
): string {
  const name = instance || 'default';

  if (photonFilePath) {
    const dir = path.dirname(photonFilePath);
    const photonBaseName = path.basename(photonFilePath).replace(/\.photon\.(ts|js)$/, '');
    const newPath = path.join(dir, photonBaseName, '.state', name, 'state.log');
    const legacyDir = baseDir || getDefaultContext().baseDir;
    const legacyPath = path.join(legacyDir, 'state', photonName, `${name}.log`);
    if (!fs.existsSync(path.dirname(newPath)) && fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return newPath;
  }

  const dir = baseDir || getDefaultContext().baseDir;
  return path.join(dir, 'state', photonName, `${name}.log`);
}

export function getEnvParams(params: ConstructorParam[]): ConstructorParam[] {
  return params.filter((p) => p.isPrimitive && !p.hasDefault);
}
