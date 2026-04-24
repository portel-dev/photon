/**
 * SQLite-backed implementation of the photon-core `MemoryBackend` interface.
 *
 * Each resolved namespace (typically a per-photon memory directory) gets its
 * own SQLite database at `{namespace}/.kv.sqlite` with a single `kv(key, value)`
 * table. Within a namespace, reads use a single SELECT and writes use
 * INSERT...ON CONFLICT UPDATE; range scans (`list(prefix)`) use a B-tree index
 * scan instead of a full directory walk.
 *
 * Opt-in: not installed by default. Consumers swap it in via
 * `setDefaultMemoryBackend(new SqliteMemoryBackend())` from `@portel/photon-core`.
 * Under Bun the backend uses `bun:sqlite` (zero install); under Node it falls
 * back to `better-sqlite3` via `./sqlite-runtime.ts`.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import type { MemoryBackend } from '@portel/photon-core';
import { openSqlite, type SqliteDatabase } from './sqlite-runtime.js';

const DB_FILENAME = '.kv.sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

export class SqliteMemoryBackend implements MemoryBackend {
  private dbs = new Map<string, Promise<SqliteDatabase>>();
  private updateLocks = new Map<string, Promise<void>>();

  private openDb(namespace: string): Promise<SqliteDatabase> {
    const existing = this.dbs.get(namespace);
    if (existing) return existing;
    const pending = (async () => {
      await fs.mkdir(namespace, { recursive: true });
      const dbPath = path.join(namespace, DB_FILENAME);
      return openSqlite(dbPath, (db) => {
        db.exec(SCHEMA);
      });
    })();
    this.dbs.set(namespace, pending);
    pending.catch(() => {
      this.dbs.delete(namespace);
    });
    return pending;
  }

  private async withUpdateLock<T>(
    namespace: string,
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${namespace}:${key}`;
    const prev = this.updateLocks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    this.updateLocks.set(lockKey, next);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this.updateLocks.get(lockKey) === next) {
        this.updateLocks.delete(lockKey);
      }
    }
  }

  async get(namespace: string, key: string): Promise<unknown> {
    const db = await this.openDb(namespace);
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.value);
  }

  async set(namespace: string, key: string, value: any): Promise<void> {
    const db = await this.openDb(namespace);
    db.prepare(
      `INSERT INTO kv(key, value, updated_at) VALUES(?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
    ).run(key, JSON.stringify(value));
  }

  async delete(namespace: string, key: string): Promise<boolean> {
    const db = await this.openDb(namespace);
    const result = db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    return (result.changes ?? 0) > 0;
  }

  async has(namespace: string, key: string): Promise<boolean> {
    const db = await this.openDb(namespace);
    const row = db.prepare('SELECT 1 FROM kv WHERE key = ? LIMIT 1').get(key);
    return Boolean(row);
  }

  async keys(namespace: string): Promise<string[]> {
    const db = await this.openDb(namespace);
    const rows = db.prepare('SELECT key FROM kv ORDER BY key').all() as Array<{
      key: string;
    }>;
    return rows.map((r) => r.key);
  }

  async clear(namespace: string): Promise<void> {
    const db = await this.openDb(namespace);
    db.prepare('DELETE FROM kv').run();
  }

  async update(
    namespace: string,
    key: string,
    updater: (current: unknown) => unknown
  ): Promise<unknown> {
    return this.withUpdateLock(namespace, key, async () => {
      const db = await this.openDb(namespace);
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      const current = row ? JSON.parse(row.value) : null;
      const updated = updater(current);
      db.prepare(
        `INSERT INTO kv(key, value, updated_at) VALUES(?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
      ).run(key, JSON.stringify(updated));
      return updated;
    });
  }

  async list(namespace: string, prefix?: string): Promise<Array<{ key: string; value: any }>> {
    const db = await this.openDb(namespace);
    const rows =
      prefix !== undefined
        ? (db
            .prepare(`SELECT key, value FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key`)
            .all(escapeLikePrefix(prefix) + '%') as Array<{ key: string; value: string }>)
        : (db.prepare('SELECT key, value FROM kv ORDER BY key').all() as Array<{
            key: string;
            value: string;
          }>);
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  /**
   * Close all open database handles. Call during shutdown or between tests.
   */
  async close(): Promise<void> {
    const pendings = Array.from(this.dbs.values());
    this.dbs.clear();
    for (const pending of pendings) {
      try {
        const db = await pending;
        db.close();
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Escape SQLite LIKE special characters in the prefix so literal `%` and `_`
 * match themselves. The escape character is `\` and callers pair this with
 * the default LIKE behavior (no ESCAPE clause needed for `\` in LIKE if we
 * don't use `\` to escape; but we include the pattern so prefix "a_b" matches
 * only "a_b*" rather than "a<anything>b*").
 */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[%_\\]/g, (ch) => '\\' + ch);
}
