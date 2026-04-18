/**
 * SQLite-backed audit log.
 *
 * Alternative to the JSONL writer in `audit.ts` for deployments that want
 * queryable audit history. Supports indexed filters on `caller`, `photon`,
 * `timestamp` without scanning the file.
 *
 * Runtime-agnostic loader: uses `bun:sqlite` under Bun, `better-sqlite3`
 * under Node. Falls back to JSONL if neither is available.
 *
 * Row cap: deletes oldest rows when count exceeds `maxRows` (default 100k).
 * Cheaper than the JSONL rotate/delete dance and preserves query index
 * integrity automatically.
 */

import type { AuditEntry } from './audit.js';
import { openSqlite, type SqliteDatabase, type SqliteStatement } from './sqlite-runtime.js';

// ============================================================================
// Query interface
// ============================================================================

export interface AuditQuery {
  /** Only rows at or after this timestamp. */
  since?: Date;
  /** Only rows at or before this timestamp. */
  until?: Date;
  /** Filter by photon name. */
  photon?: string;
  /** Filter by authenticated caller (sub claim). */
  client?: string;
  /** Filter by event type. */
  event?: string;
  /** Max rows to return. Default 1000. */
  limit?: number;
  /** Sort direction on timestamp. Default descending (most recent first). */
  order?: 'asc' | 'desc';
}

// ============================================================================
// Schema + open
// ============================================================================

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      event TEXT NOT NULL,
      photon TEXT,
      method TEXT,
      instance TEXT,
      client TEXT,
      session_id TEXT,
      duration_ms INTEGER,
      error TEXT,
      extra TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
    CREATE INDEX IF NOT EXISTS idx_audit_photon_ts ON audit(photon, ts);
    CREATE INDEX IF NOT EXISTS idx_audit_client_ts ON audit(client, ts);
    CREATE INDEX IF NOT EXISTS idx_audit_event_ts ON audit(event, ts);
  `);
}

/**
 * Open a SQLite-backed audit store. Returns a backend with write/query/close.
 */
export async function openAuditDatabase(path: string): Promise<SqliteDatabase> {
  return openSqlite(path, initSchema);
}

// ============================================================================
// SQLite backend
// ============================================================================

export interface AuditBackend {
  write(entry: AuditEntry): void;
  query(q: AuditQuery): AuditEntry[];
  count(): number;
  close(): void;
}

export class SqliteAuditBackend implements AuditBackend {
  private insert: SqliteStatement;
  private countStmt: SqliteStatement;
  private trimStmt: SqliteStatement;
  private writes = 0;
  /** Known columns we store in dedicated fields; anything else goes into `extra`. */
  private static readonly WELL_KNOWN = new Set([
    'ts',
    'event',
    'photon',
    'method',
    'instance',
    'client',
    'sessionId',
    'durationMs',
    'error',
  ]);

  constructor(
    private db: SqliteDatabase,
    private maxRows = 100_000,
    /** Check row count every N writes to avoid COUNT(*) per insert. */
    private trimInterval = 500
  ) {
    this.insert = db.prepare(
      `INSERT INTO audit (ts, event, photon, method, instance, client, session_id, duration_ms, error, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS n FROM audit');
    this.trimStmt = db.prepare(
      'DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY ts ASC LIMIT ?)'
    );
  }

  write(entry: AuditEntry): void {
    try {
      const tsMs = typeof entry.ts === 'string' ? Date.parse(entry.ts) : Date.now();
      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(entry)) {
        if (!SqliteAuditBackend.WELL_KNOWN.has(key)) {
          extra[key] = (entry as Record<string, unknown>)[key];
        }
      }
      this.insert.run(
        tsMs,
        entry.event,
        entry.photon ?? null,
        entry.method ?? null,
        entry.instance ?? null,
        entry.client ?? null,
        entry.sessionId ?? null,
        entry.durationMs ?? null,
        entry.error ?? null,
        Object.keys(extra).length > 0 ? JSON.stringify(extra) : null
      );
      this.writes++;
      if (this.writes >= this.trimInterval) {
        this.writes = 0;
        this.trimIfNeeded();
      }
    } catch {
      // Never block execution for audit I/O
    }
  }

  query(q: AuditQuery = {}): AuditEntry[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (q.since) {
      clauses.push('ts >= ?');
      params.push(q.since.getTime());
    }
    if (q.until) {
      clauses.push('ts <= ?');
      params.push(q.until.getTime());
    }
    if (q.photon) {
      clauses.push('photon = ?');
      params.push(q.photon);
    }
    if (q.client) {
      clauses.push('client = ?');
      params.push(q.client);
    }
    if (q.event) {
      clauses.push('event = ?');
      params.push(q.event);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const limit = q.limit ?? 1000;
    const sql = `SELECT * FROM audit ${where} ORDER BY ts ${order} LIMIT ?`;
    params.push(limit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => rowToEntry(r));
  }

  count(): number {
    const row = this.countStmt.get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }

  private trimIfNeeded(): void {
    const current = this.count();
    if (current <= this.maxRows) return;
    const excess = current - this.maxRows;
    try {
      this.trimStmt.run(excess);
    } catch {
      // Silent — trim is best-effort
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(row: any): AuditEntry {
  const entry: AuditEntry = {
    ts: new Date(row.ts).toISOString(),
    event: row.event,
  };
  if (row.photon != null) entry.photon = row.photon;
  if (row.method != null) entry.method = row.method;
  if (row.instance != null) entry.instance = row.instance;
  if (row.client != null) entry.client = row.client;
  if (row.session_id != null) entry.sessionId = row.session_id;
  if (row.duration_ms != null) entry.durationMs = row.duration_ms;
  if (row.error != null) entry.error = row.error;
  if (row.extra) {
    try {
      const parsed = JSON.parse(row.extra) as Record<string, unknown>;
      for (const k of Object.keys(parsed)) {
        (entry as Record<string, unknown>)[k] = parsed[k];
      }
    } catch {
      // malformed extra; drop silently
    }
  }
  return entry;
}
