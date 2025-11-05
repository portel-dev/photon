/**
 * SQLite Photon MCP - SQLite database operations
 *
 * Provides SQLite database utilities: query, execute, insert, update, delete, and schema operations.
 * Supports both in-memory and file-based databases.
 *
 * Example: query({ sql: "SELECT * FROM users WHERE id = ?", params: [1] })
 *
 * Dependencies are auto-installed on first run.
 *
 * @dependencies better-sqlite3@^11.0.0
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

export default class SQLite {
  private db: Database.Database | null = null;
  private dbPath: string = ':memory:';

  constructor(private path?: string) {
    if (path) {
      this.dbPath = path;
    }
  }

  async onInitialize() {
    // Auto-open database if path was provided in constructor
    if (this.dbPath !== ':memory:' || this.path) {
      this.db = new Database(this.dbPath, {
        readonly: false,
        fileMustExist: false,
      });
      console.error(`[sqlite] ✅ Database opened: ${this.dbPath}`);
    }
  }

  /**
   * Open a SQLite database
   * @param path Database file path (use ":memory:" for in-memory database)
   * @param readonly Open in readonly mode (default: false)
   */
  async open(params: { path: string; readonly?: boolean }) {
    try {
      if (this.db) {
        this.db.close();
      }

      this.dbPath = params.path;
      this.db = new Database(params.path, {
        readonly: params.readonly || false,
        fileMustExist: false,
      });

      return {
        success: true,
        message: `Database opened: ${params.path}`,
        isMemory: params.path === ':memory:',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a SELECT query
   * @param sql SQL query string
   * @param params Query parameters (for prepared statements)
   */
  async query(params: { sql: string; params?: any[] }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const stmt = this.db.prepare(params.sql);
      const rows = stmt.all(...(params.params || []));

      return {
        success: true,
        rows,
        count: rows.length,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a single SELECT query and return first row
   * @param sql SQL query string
   * @param params Query parameters (for prepared statements)
   */
  async queryOne(params: { sql: string; params?: any[] }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const stmt = this.db.prepare(params.sql);
      const row = stmt.get(...(params.params || []));

      return {
        success: true,
        row: row || null,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE statement
   * @param sql SQL statement string
   * @param params Statement parameters (for prepared statements)
   */
  async execute(params: { sql: string; params?: any[] }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const stmt = this.db.prepare(params.sql);
      const info = stmt.run(...(params.params || []));

      return {
        success: true,
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute multiple SQL statements in a transaction
   * @param statements Array of SQL statements with optional parameters
   */
  async transaction(params: { statements: Array<{ sql: string; params?: any[] }> }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const executeAll = this.db.transaction((statements: Array<{ sql: string; params?: any[] }>) => {
        const results = [];
        for (const stmt of statements) {
          const prepared = this.db!.prepare(stmt.sql);
          const info = prepared.run(...(stmt.params || []));
          results.push({
            changes: info.changes,
            lastInsertRowid: info.lastInsertRowid,
          });
        }
        return results;
      });

      const results = executeAll(params.statements);

      return {
        success: true,
        message: 'Transaction completed',
        results,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * List all tables in the database
   */
  async listTables(params: {}) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all();

      return {
        success: true,
        tables: tables.map((t: any) => t.name),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get schema information for a table
   * @param table Table name
   */
  async schema(params: { table: string }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    try {
      const columns = this.db.prepare(`PRAGMA table_info(${params.table})`).all();

      return {
        success: true,
        table: params.table,
        columns,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Close the database connection
   */
  async close(params: {}) {
    if (!this.db) {
      return { success: false, error: 'No database is open' };
    }

    try {
      this.db.close();
      this.db = null;

      return {
        success: true,
        message: 'Database closed',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a backup of the database
   * @param destination Path to backup file
   */
  async backup(params: { destination: string }) {
    if (!this.db) {
      return { success: false, error: 'No database open. Use open() first.' };
    }

    if (this.dbPath === ':memory:') {
      return { success: false, error: 'Cannot backup in-memory database' };
    }

    try {
      const backup = this.db.backup(params.destination);

      return new Promise((resolve) => {
        backup.step(-1);
        backup.close();
        resolve({
          success: true,
          message: `Database backed up to ${params.destination}`,
        });
      });
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async onShutdown() {
    if (this.db) {
      this.db.close();
      console.error('[sqlite] Database connection closed');
    }
  }
}
