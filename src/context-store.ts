/**
 * Context Store & Environment Store
 *
 * Manages two types of constructor parameter values:
 * - Context (primitive with default) → `photon use` → ~/.photon/context/{photon}.json
 * - Environment (primitive, no default) → `photon set` → ~/.photon/env/{photon}.json
 *
 * Also provides argument parsing and state partition path resolution.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ConstructorParam } from '@portel/photon-core';

const PHOTON_DIR = path.join(os.homedir(), '.photon');

// ══════════════════════════════════════════════════════════════════════════════
// Argument Parsing
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parse positional/named args for `photon use` or `photon set`.
 *
 * Algorithm:
 * 1. Read next arg
 * 2. Does it match a known param name AND has a following arg? → named pair
 * 3. Doesn't match? → positional value for the next unset param
 */
export function parseContextArgs(args: string[], params: ConstructorParam[]): Map<string, string> {
  const result = new Map<string, string>();
  const paramNames = new Set(params.map((p) => p.name));
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (paramNames.has(arg) && i + 1 < args.length) {
      // Named: arg is a param name, next arg is its value
      result.set(arg, args[i + 1]);
      i++; // skip value
    } else {
      // Positional: map to next unset param
      while (positionalIndex < params.length) {
        const param = params[positionalIndex];
        positionalIndex++;
        if (!result.has(param.name)) {
          result.set(param.name, arg);
          break;
        }
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// Context Store — for `photon use` (primitive params with defaults)
// ══════════════════════════════════════════════════════════════════════════════

export class ContextStore {
  private baseDir: string;

  constructor(baseDir: string = PHOTON_DIR) {
    this.baseDir = baseDir;
  }

  private _path(photonName: string): string {
    return path.join(this.baseDir, 'context', `${photonName}.json`);
  }

  read(photonName: string): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this._path(photonName), 'utf-8'));
    } catch {
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
   * Get the value of a specific context param, falling back to its default.
   */
  resolve(photonName: string, paramName: string, defaultValue?: string): string | undefined {
    const stored = this.read(photonName);
    return stored[paramName] ?? defaultValue;
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
    } catch {
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
// State Partition Path
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Determine the state directory path based on context values.
 * Non-default context values create a partitioned path: {photon}--{val1}--{val2}
 */
export function getStatePartitionPath(
  photonName: string,
  contextValues: Map<string, string>,
  contextParams: ConstructorParam[]
): string {
  const parts: string[] = [];
  for (const param of contextParams) {
    const value = contextValues.get(param.name) ?? param.defaultValue;
    if (value && value !== param.defaultValue) {
      parts.push(value);
    }
  }

  if (parts.length === 0) {
    return path.join(os.homedir(), '.photon', 'state', photonName);
  }
  return path.join(os.homedir(), '.photon', 'state', `${photonName}--${parts.join('--')}`);
}

/**
 * Get the state file path for a photon, considering context-based partitioning.
 */
export function getStatePath(
  photonName: string,
  contextStore?: ContextStore,
  contextParams?: ConstructorParam[]
): string {
  if (!contextStore || !contextParams || contextParams.length === 0) {
    // No context params → standard state path
    return path.join(os.homedir(), '.photon', 'state', `${photonName}.json`);
  }

  const stored = contextStore.read(photonName);
  const contextValues = new Map(Object.entries(stored));
  const partitionDir = getStatePartitionPath(photonName, contextValues, contextParams);

  return path.join(partitionDir, 'snapshot.json');
}

// ══════════════════════════════════════════════════════════════════════════════
// Param Classification
// ══════════════════════════════════════════════════════════════════════════════

export type InjectionType = 'env' | 'context' | 'mcp' | 'photon' | 'state';

/**
 * Classify a constructor param into an injection type.
 * This extends the photon-core classification to distinguish env vs context.
 */
export function classifyParam(
  param: ConstructorParam,
  isStateful: boolean,
  mcpNames: Set<string>,
  photonNames: Set<string>
): InjectionType {
  if (mcpNames.has(param.name)) return 'mcp';
  if (photonNames.has(param.name)) return 'photon';
  if (param.isPrimitive && !param.hasDefault) return 'env';
  if (param.isPrimitive && param.hasDefault) return 'context';
  if (!param.isPrimitive && param.hasDefault && isStateful) return 'state';
  return 'env'; // fallback
}

/**
 * Filter constructor params by injection type.
 */
export function getContextParams(params: ConstructorParam[]): ConstructorParam[] {
  return params.filter((p) => p.isPrimitive && p.hasDefault);
}

export function getEnvParams(params: ConstructorParam[]): ConstructorParam[] {
  return params.filter((p) => p.isPrimitive && !p.hasDefault);
}
