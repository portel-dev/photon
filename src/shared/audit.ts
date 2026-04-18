/**
 * Persistent Audit Log
 *
 * Two backends, selected at runtime:
 * - JSONL (default): append-only writer to ~/.photon/audit.jsonl,
 *   size-based rotation (5MB, 3 archives). Always available.
 * - SQLite (opt-in via initAuditSqlite): indexed, queryable. Preferred for
 *   daemons that need fast per-caller / per-photon audit queries.
 *
 * Silent failure — never blocks execution for audit I/O.
 */

import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { getAuditPath } from '@portel/photon-core';
import type { AuditBackend, AuditQuery } from './audit-sqlite.js';

const AUDIT_FILE = getAuditPath();
const AUDIT_DIR = dirname(AUDIT_FILE);

/** Rotate when file exceeds this size (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
/** Number of rotated archives to keep */
const MAX_ROTATED_FILES = 3;
/** Check file size every N writes to avoid stat() on every append */
const ROTATION_CHECK_INTERVAL = 100;

export interface AuditEntry {
  ts: string;
  event: string;
  photon?: string;
  method?: string;
  instance?: string;
  client?: string;
  sessionId?: string;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

let dirEnsured = false;
let writeCount = 0;
let rotating = false;

/** Active SQLite backend, or null if we're using JSONL. */
let sqliteBackend: AuditBackend | null = null;

/**
 * Upgrade the audit writer to a SQLite backend for indexed queries.
 * Callers (daemon startup, server bootstrap) invoke this once early.
 * Safe to call multiple times — subsequent calls are no-ops. If SQLite
 * isn't available (no `better-sqlite3` on Node, not running under Bun),
 * throws and the JSONL fallback remains active.
 */
export async function initAuditSqlite(path?: string): Promise<void> {
  if (sqliteBackend) return;
  const { openAuditDatabase, SqliteAuditBackend } = await import('./audit-sqlite.js');
  const dbPath = path ?? AUDIT_FILE.replace(/\.jsonl$/i, '.db');
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // non-fatal
  }
  const db = await openAuditDatabase(dbPath);
  sqliteBackend = new SqliteAuditBackend(db);
}

/**
 * Swap the SQLite backend for a pre-constructed one. For tests.
 */
export function setAuditBackend(backend: AuditBackend | null): void {
  sqliteBackend = backend;
}

/**
 * Query the audit log. Uses SQLite indexes when available, otherwise
 * streams the JSONL file and filters in memory.
 */
export async function queryAudit(q: AuditQuery = {}): Promise<AuditEntry[]> {
  if (sqliteBackend) return sqliteBackend.query(q);
  return queryJsonl(q);
}

async function queryJsonl(q: AuditQuery): Promise<AuditEntry[]> {
  const { readFile } = await import('fs/promises');
  const results: AuditEntry[] = [];
  try {
    const raw = await readFile(AUDIT_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // Newest first — iterate from the end so limit clamps cheaply
    const ordered = q.order === 'asc' ? lines : [...lines].reverse();
    const limit = q.limit ?? 1000;
    for (const line of ordered) {
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch {
        continue;
      }
      if (!matchesQuery(entry, q)) continue;
      results.push(entry);
      if (results.length >= limit) break;
    }
  } catch {
    // file missing or unreadable — empty result
  }
  return results;
}

function matchesQuery(entry: AuditEntry, q: AuditQuery): boolean {
  if (q.photon && entry.photon !== q.photon) return false;
  if (q.client && entry.client !== q.client) return false;
  if (q.event && entry.event !== q.event) return false;
  if (q.since && new Date(entry.ts).getTime() < q.since.getTime()) return false;
  if (q.until && new Date(entry.ts).getTime() > q.until.getTime()) return false;
  return true;
}

/**
 * Rotate audit log files: audit.jsonl → audit.1.jsonl → audit.2.jsonl → audit.3.jsonl
 * Oldest file beyond MAX_ROTATED_FILES is deleted.
 */
function rotateIfNeeded(): void {
  if (rotating) return;
  rotating = true;
  try {
    const stats = statSync(AUDIT_FILE);
    if (stats.size < MAX_FILE_SIZE) return;

    // Shift existing rotated files: .3 → delete, .2 → .3, .1 → .2
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const src = i === 1 ? AUDIT_FILE : join(AUDIT_DIR, `audit.${i - 1}.jsonl`);
      const dst = join(AUDIT_DIR, `audit.${i}.jsonl`);
      if (i === MAX_ROTATED_FILES && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    // AUDIT_FILE has been renamed to audit.1.jsonl — next append creates a fresh file
  } catch {
    // Silent failure — rotation is best-effort
  } finally {
    rotating = false;
  }
}

export function audit(entry: AuditEntry): void {
  // Prefer SQLite when initialized; fall through to JSONL on failure.
  if (sqliteBackend) {
    try {
      sqliteBackend.write(entry);
      return;
    } catch {
      // fall through to JSONL so the write isn't lost
    }
  }
  try {
    if (!dirEnsured) {
      mkdirSync(AUDIT_DIR, { recursive: true });
      dirEnsured = true;
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');

    writeCount++;
    if (writeCount >= ROTATION_CHECK_INTERVAL) {
      writeCount = 0;
      rotateIfNeeded();
    }
  } catch {
    // Never block execution for audit failures
  }
}

/** Force a rotation check (used by CLI clear/rotate commands) */
export function forceRotate(): boolean {
  try {
    if (!existsSync(AUDIT_FILE)) return false;
    // Shift existing rotated files
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const src = i === 1 ? AUDIT_FILE : join(AUDIT_DIR, `audit.${i - 1}.jsonl`);
      const dst = join(AUDIT_DIR, `audit.${i}.jsonl`);
      if (i === MAX_ROTATED_FILES && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const AUDIT_FILE_PATH = AUDIT_FILE;
export const AUDIT_DIR_PATH = AUDIT_DIR;
export { MAX_FILE_SIZE, MAX_ROTATED_FILES };
