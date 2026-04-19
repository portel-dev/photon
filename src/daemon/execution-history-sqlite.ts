/**
 * SQLite backend for execution history.
 *
 * Alternative to the per-photon JSONL layout in `execution-history.ts`.
 * Upgrades daemon audit queries (`photon ps history --method X --since 1h`)
 * from whole-file scans to indexed range queries.
 *
 * Runtime-agnostic loader: `bun:sqlite` under Bun, `better-sqlite3` under Node.
 * Falls back to JSONL if neither is available.
 *
 * Single shared database across all photons on this daemon, keyed on the
 * `photon` column. Indexes cover the query shapes used by the CLI and the
 * Beam daemon panel.
 */

import * as path from 'path';
import type { ExecutionEntry, ExecutionStatus, HistoryQuery } from './execution-history.js';
import { openSqlite, type SqliteDatabase, type SqliteStatement } from '../shared/sqlite-runtime.js';

function normalizeBase(workingDir?: string): string {
  return workingDir ? path.resolve(workingDir) : '-';
}

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_METHOD = 500;

/** Sentinel stored in `base` when the caller didn't supply workingDir. */
const LEGACY_BASE = '-';

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photon TEXT NOT NULL,
      base TEXT NOT NULL DEFAULT '${LEGACY_BASE}',
      ts INTEGER NOT NULL,
      job_id TEXT NOT NULL,
      method TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      output_preview TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_exec_photon_base_ts ON execution_history(photon, base, ts);
    CREATE INDEX IF NOT EXISTS idx_exec_photon_method_ts ON execution_history(photon, base, method, ts);
    CREATE INDEX IF NOT EXISTS idx_exec_ts ON execution_history(ts);
    CREATE INDEX IF NOT EXISTS idx_exec_status_ts ON execution_history(status, ts);
  `);

  // Backfill: older databases predating multi-base partitioning had no
  // `base` column. Add it if missing so upgrades don't throw.
  try {
    const cols = db.prepare('PRAGMA table_info(execution_history)').all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'base')) {
      db.exec(
        `ALTER TABLE execution_history ADD COLUMN base TEXT NOT NULL DEFAULT '${LEGACY_BASE}'`
      );
    }
  } catch {
    // Pragma failures are non-fatal; the CREATE above handled a fresh DB.
  }
}

export async function openExecutionHistoryDatabase(path: string): Promise<SqliteDatabase> {
  return openSqlite(path, initSchema);
}

export interface ExecutionHistoryBackend {
  record(photon: string, entry: ExecutionEntry, workingDir?: string): void;
  query(photon: string, q: HistoryQuery, workingDir?: string): ExecutionEntry[];
  sweep(opts?: { ttlMs?: number; maxPerMethod?: number; now?: number }): number;
  close(): void;
}

export class SqliteExecutionHistoryBackend implements ExecutionHistoryBackend {
  private insert: SqliteStatement;
  private deleteOlderThan: SqliteStatement;

  constructor(
    private db: SqliteDatabase,
    private opts: { ttlMs?: number; maxPerMethod?: number } = {}
  ) {
    this.insert = db.prepare(`
      INSERT INTO execution_history
        (photon, base, ts, job_id, method, duration_ms, status, error_message, output_preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.deleteOlderThan = db.prepare('DELETE FROM execution_history WHERE ts < ?');
  }

  record(photon: string, entry: ExecutionEntry, workingDir?: string): void {
    try {
      this.insert.run(
        photon,
        normalizeBase(workingDir),
        entry.ts,
        entry.jobId,
        entry.method,
        entry.durationMs,
        entry.status,
        entry.errorMessage ?? null,
        entry.outputPreview ?? null
      );
    } catch {
      // Audit writes never block callers
    }
  }

  query(photon: string, q: HistoryQuery = {}, workingDir?: string): ExecutionEntry[] {
    const clauses = ['photon = ?'];
    const params: (string | number)[] = [photon];
    // Scope by base when provided so `photon ps history --base A foo:bar`
    // doesn't leak runs from a same-named photon in base B.
    if (workingDir !== undefined) {
      clauses.push('base = ?');
      params.push(normalizeBase(workingDir));
    }
    if (q.method) {
      clauses.push('method = ?');
      params.push(q.method);
    }
    if (typeof q.sinceTs === 'number') {
      clauses.push('ts >= ?');
      params.push(q.sinceTs);
    }
    const limit = typeof q.limit === 'number' && q.limit > 0 ? q.limit : 1000;
    const sql = `SELECT * FROM execution_history WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  /**
   * Apply TTL + per-method cap across every photon.
   * Returns the number of rows deleted.
   */
  sweep(opts: { ttlMs?: number; maxPerMethod?: number; now?: number } = {}): number {
    const ttl = opts.ttlMs ?? this.opts.ttlMs ?? DEFAULT_TTL_MS;
    const maxPer = opts.maxPerMethod ?? this.opts.maxPerMethod ?? DEFAULT_MAX_PER_METHOD;
    const now = opts.now ?? Date.now();
    let removed = 0;
    try {
      const ttlRes = this.deleteOlderThan.run(now - ttl);
      removed += (ttlRes.changes as number) ?? 0;
      // Per-method cap: for each (photon, method), keep newest maxPer rows.
      // Window function support is standard in both bun:sqlite and better-sqlite3.
      const overflow = this.db.prepare(
        `DELETE FROM execution_history
         WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY photon, method ORDER BY ts DESC
             ) AS rn FROM execution_history
           ) WHERE rn > ?
         )`
      );
      const capRes = overflow.run(maxPer);
      removed += (capRes.changes as number) ?? 0;
    } catch {
      // Sweep failures are non-fatal
    }
    return removed;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}

function rowToEntry(row: Record<string, unknown>): ExecutionEntry {
  return {
    ts: row.ts as number,
    jobId: row.job_id as string,
    method: row.method as string,
    durationMs: row.duration_ms as number,
    status: row.status as ExecutionStatus,
    errorMessage: (row.error_message as string | null) ?? undefined,
    outputPreview: (row.output_preview as string | null) ?? undefined,
  };
}
