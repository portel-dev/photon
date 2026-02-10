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
import { isNodeError, getErrorMessage } from './shared/error-handler.js';

const PHOTON_DIR = path.join(os.homedir(), '.photon');

// ══════════════════════════════════════════════════════════════════════════════
// Instance Store — tracks current instance name per photon per client
// ══════════════════════════════════════════════════════════════════════════════

export class InstanceStore {
  private baseDir: string;

  constructor(baseDir: string = PHOTON_DIR) {
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
   */
  listInstances(photonName: string): string[] {
    const stateDir = path.join(this.baseDir, 'state', photonName);
    try {
      return fs
        .readdirSync(stateDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) return []; // No state dir yet — normal
      console.warn(`[photon] Cannot read instances for ${photonName}: ${getErrorMessage(err)}`);
      return [];
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI Session Store — per-terminal-session instance tracking
// Uses parent PID (shell PID) to scope to the current terminal session.
// Files live in /tmp so they're cleaned on reboot.
// ══════════════════════════════════════════════════════════════════════════════

export class CLISessionStore {
  private sessionDir: string;

  constructor() {
    const ppid = process.ppid;
    this.sessionDir = path.join(os.tmpdir(), 'photon-cli-sessions', String(ppid));
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

  constructor(baseDir: string = PHOTON_DIR) {
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
 * Path: ~/.photon/state/{photon}/{instance}.json
 * Default instance: ~/.photon/state/{photon}/default.json
 */
export function getInstanceStatePath(photonName: string, instance: string): string {
  const name = instance || 'default';
  return path.join(os.homedir(), '.photon', 'state', photonName, `${name}.json`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Param Classification
// ══════════════════════════════════════════════════════════════════════════════

export type InjectionType = 'env' | 'mcp' | 'photon' | 'state';

/**
 * Classify a constructor param into an injection type.
 *
 * 3 types (context type removed — instance naming is runtime, not code):
 * - env: primitive params → environment variables
 * - mcp: matches @mcp declaration
 * - photon: matches @photon declaration
 * - state: non-primitive with default on @stateful → persisted reactive state
 */
export function classifyParam(
  param: ConstructorParam,
  isStateful: boolean,
  mcpNames: Set<string>,
  photonNames: Set<string>
): InjectionType {
  if (mcpNames.has(param.name)) return 'mcp';
  if (photonNames.has(param.name)) return 'photon';
  if (!param.isPrimitive && param.hasDefault && isStateful) return 'state';
  return 'env'; // primitives (with or without default) are env
}

export function getEnvParams(params: ConstructorParam[]): ConstructorParam[] {
  return params.filter((p) => p.isPrimitive && !p.hasDefault);
}
