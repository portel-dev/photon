/**
 * Execution history for scheduled jobs.
 *
 * Two backends, selected at runtime:
 * - JSONL (default): per-photon append-only log at
 *   `{PHOTON_DIR}/.data/{photon}/schedules/executions.jsonl`
 *   with size rotation (10MB → .1.jsonl … .3.jsonl) and boot-time TTL sweep.
 * - SQLite (opt-in via initExecutionHistorySqlite): single shared DB with
 *   indexed queries. Recommended when `photon ps history` is queried often
 *   or the daemon keeps many photons (linear full-file scans add up).
 *
 * Writes are best-effort: failures never propagate to callers of
 * recordExecution — an audit log that crashes scheduled jobs is worse than
 * a missing audit log.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { getPhotonSchedulesDir } from '@portel/photon-core';
import { getDefaultContext } from '../context.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import type { ExecutionHistoryBackend } from './execution-history-sqlite.js';

const logger = createLogger({ component: 'execution-history' });

/** Rotate current file when it grows past this size. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Number of rotated archives to keep (executions.1.jsonl … .N.jsonl). */
const MAX_ROTATED_FILES = 3;
/** Retention window for boot sweep. */
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Per-method cap applied by the boot sweep. */
const MAX_ENTRIES_PER_METHOD = 500;
/** Truncation cap for the serialized outputPreview field. */
const OUTPUT_PREVIEW_MAX = 500;

export type ExecutionStatus = 'success' | 'error' | 'timeout';

export interface ExecutionEntry {
  /** Unix epoch ms when the job completed (or failed). */
  ts: number;
  jobId: string;
  method: string;
  durationMs: number;
  status: ExecutionStatus;
  errorMessage?: string;
  /** Short JSON serialization of the return value (capped). */
  outputPreview?: string;
}

export interface HistoryQuery {
  method?: string;
  limit?: number;
  sinceTs?: number;
}

/** Absolute path to a photon's executions.jsonl under the Option B layout. */
export function executionsFile(photonName: string, workingDir?: string): string {
  const baseDir = workingDir || getDefaultContext().baseDir;
  return join(getPhotonSchedulesDir('', photonName, baseDir), 'executions.jsonl');
}

/**
 * Active SQLite backend. When set, recordExecution and readExecutionHistory
 * route through it; sweeps become no-ops since SQLite handles its own.
 */
let sqliteBackend: ExecutionHistoryBackend | null = null;

/**
 * Upgrade the execution-history writer to a SQLite backend. Call once at
 * daemon startup; safe to call more than once. The default path lives next
 * to the per-photon .data directories so existing deployments can keep
 * both representations alongside during migration.
 */
export async function initExecutionHistorySqlite(opts: {
  path: string;
  ttlMs?: number;
  maxPerMethod?: number;
}): Promise<void> {
  if (sqliteBackend) return;
  const { openExecutionHistoryDatabase, SqliteExecutionHistoryBackend } =
    await import('./execution-history-sqlite.js');
  mkdirSync(dirname(opts.path), { recursive: true });
  const db = await openExecutionHistoryDatabase(opts.path);
  sqliteBackend = new SqliteExecutionHistoryBackend(db, {
    ttlMs: opts.ttlMs,
    maxPerMethod: opts.maxPerMethod,
  });
}

/** Swap the SQLite backend for tests or custom providers. */
export function setExecutionHistoryBackend(backend: ExecutionHistoryBackend | null): void {
  sqliteBackend = backend;
}

/** Expose the active backend for sweep + query helpers. */
export function getExecutionHistoryBackend(): ExecutionHistoryBackend | null {
  return sqliteBackend;
}

/**
 * Append a single entry; rotate if the current file has crossed MAX_FILE_SIZE.
 * Never throws.
 */
export function recordExecution(
  photonName: string,
  entry: ExecutionEntry,
  workingDir?: string
): void {
  if (sqliteBackend) {
    try {
      sqliteBackend.record(photonName, entry, workingDir);
      return;
    } catch (err) {
      logger.debug('SQLite execution record failed, falling back to JSONL', {
        photon: photonName,
        error: getErrorMessage(err),
      });
    }
  }
  const file = executionsFile(photonName, workingDir);
  try {
    mkdirSync(dirname(file), { recursive: true });
    rotateIfNeeded(file);
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.debug('Failed to record execution', {
      photon: photonName,
      error: getErrorMessage(err),
    });
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return;
    const stats = statSync(file);
    if (stats.size < MAX_FILE_SIZE) return;
    const dir = dirname(file);
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const src = i === 1 ? file : join(dir, `executions.${i - 1}.jsonl`);
      const dst = join(dir, `executions.${i}.jsonl`);
      if (i === MAX_ROTATED_FILES && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
  } catch {
    // Rotation is best-effort.
  }
}

/** Parse every line of the active file. Tolerates malformed lines. */
function readEntries(file: string): ExecutionEntry[] {
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, 'utf-8');
    const out: ExecutionEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as ExecutionEntry;
        if (e && typeof e.ts === 'number' && typeof e.method === 'string') {
          out.push(e);
        }
      } catch {
        // Skip malformed lines rather than poison the whole read.
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Return entries matching the query, newest first. */
export function readExecutionHistory(
  photonName: string,
  query: HistoryQuery = {},
  workingDir?: string
): ExecutionEntry[] {
  if (sqliteBackend) {
    return sqliteBackend.query(photonName, query, workingDir);
  }
  const entries = readEntries(executionsFile(photonName, workingDir));
  let filtered = entries;
  if (query.method) filtered = filtered.filter((e) => e.method === query.method);
  if (typeof query.sinceTs === 'number') {
    const since = query.sinceTs;
    filtered = filtered.filter((e) => e.ts >= since);
  }
  filtered = filtered.slice().sort((a, b) => b.ts - a.ts);
  if (typeof query.limit === 'number' && query.limit > 0) {
    filtered = filtered.slice(0, query.limit);
  }
  return filtered;
}

/**
 * Apply TTL + per-method cap to one file. Writes only if anything was
 * dropped. Safe to call at boot per base.
 */
export function sweepExecutions(file: string, now: number = Date.now()): void {
  if (!existsSync(file)) return;
  try {
    const entries = readEntries(file);
    if (entries.length === 0) return;

    const cutoff = now - TTL_MS;
    const aged = entries.filter((e) => e.ts >= cutoff);

    const byMethod = new Map<string, ExecutionEntry[]>();
    for (const e of aged) {
      const arr = byMethod.get(e.method) || [];
      arr.push(e);
      byMethod.set(e.method, arr);
    }

    const kept: ExecutionEntry[] = [];
    for (const arr of byMethod.values()) {
      arr.sort((a, b) => a.ts - b.ts);
      const trimmed =
        arr.length > MAX_ENTRIES_PER_METHOD ? arr.slice(arr.length - MAX_ENTRIES_PER_METHOD) : arr;
      kept.push(...trimmed);
    }

    if (kept.length === entries.length) return;
    kept.sort((a, b) => a.ts - b.ts);
    const body = kept.length === 0 ? '' : kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(file, body);
  } catch (err) {
    logger.debug('Failed to sweep executions', { file, error: getErrorMessage(err) });
  }
}

/**
 * Sweep every photon's executions.jsonl under each listed base. Intended to
 * run once at daemon startup, after the bases registry is loaded.
 */
export function sweepAllBases(bases: string[], now: number = Date.now()): void {
  for (const base of bases) {
    const dataDir = join(base, '.data');
    if (!existsSync(dataDir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dataDir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = join(dataDir, name, 'schedules', 'executions.jsonl');
      if (existsSync(file)) sweepExecutions(file, now);
    }
  }
}

/** Compact serialization of a tool return value, capped at OUTPUT_PREVIEW_MAX. */
export function previewResult(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (!s) return undefined;
    return s.length > OUTPUT_PREVIEW_MAX ? s.slice(0, OUTPUT_PREVIEW_MAX) + '…' : s;
  } catch {
    return undefined;
  }
}

/** Internal constants exported for tests. */
export const __test__ = {
  MAX_FILE_SIZE,
  MAX_ROTATED_FILES,
  TTL_MS,
  MAX_ENTRIES_PER_METHOD,
  OUTPUT_PREVIEW_MAX,
};
