/**
 * PostgreSQL - Database operations for PostgreSQL
 *
 * Provides tools to query, insert, update, and manage PostgreSQL databases.
 * Supports parameterized queries, transactions, and schema introspection.
 *
 * Common use cases:
 * - Data analysis: "Query user statistics from the database"
 * - Data management: "Insert a new user record"
 * - Schema exploration: "List all tables in the database"
 *
 * Example: query({ sql: "SELECT * FROM users WHERE active = $1", params: [true] })
 *
 * Configuration:
 * - host: Database host (default: localhost)
 * - port: Database port (default: 5432)
 * - database: Database name (required)
 * - user: Database user (required)
 * - password: Database password (required)
 * - ssl: Enable SSL connection (default: false)
 *
 * Dependencies are auto-installed on first run.
 *
 * @dependencies pg@^8.11.0
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import pg from 'pg';
const { Pool } = pg;

export default class PostgreSQL {
  private pool?: pg.Pool;

  constructor(
    private database: string,
    private user: string,
    private password: string,
    private host: string = 'localhost',
    private port: number = 5432,
    private ssl: boolean = false
  ) {
    if (!database || !user || !password) {
      throw new Error('Database, user, and password are required');
    }
  }

  async onInitialize() {
    try {
      this.pool = new Pool({
        host: this.host,
        port: this.port,
        database: this.database,
        user: this.user,
        password: this.password,
        ssl: this.ssl ? { rejectUnauthorized: false } : false,
        max: 10, // Max pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      // Test connection
      const client = await this.pool.connect();
      client.release();

      console.error('[postgres] ✅ Database connected');
      console.error(`[postgres] Database: ${this.database}@${this.host}:${this.port}`);
    } catch (error: any) {
      console.error(`[postgres] ❌ Connection failed: ${error.message}`);
      throw error;
    }
  }

  async onShutdown() {
    if (this.pool) {
      await this.pool.end();
      console.error('[postgres] ✅ Database connection closed');
    }
  }

  /**
   * Execute a SQL query
   * @param sql SQL query to execute (supports $1, $2, etc. for parameters)
   * @param params Query parameters array (optional)
   */
  async query(params: { sql: string; params?: any[] }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const result = await this.pool.query(params.sql, params.params);

      return {
        success: true,
        rows: result.rows,
        rowCount: result.rowCount,
        fields: result.fields.map(f => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  /**
   * Execute multiple SQL statements in a transaction
   * @param statements Array of SQL statements with optional parameters
   */
  async transaction(params: { statements: Array<{ sql: string; params?: any[] }> }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const results = [];
      for (const stmt of params.statements) {
        const result = await client.query(stmt.sql, stmt.params);
        results.push({
          rowCount: result.rowCount,
          rows: result.rows,
        });
      }

      await client.query('COMMIT');

      return {
        success: true,
        results,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    } finally {
      client.release();
    }
  }

  /**
   * List all tables in the database
   * @param schema Schema name (default: public)
   */
  async listTables(params?: { schema?: string }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const schema = params?.schema || 'public';

      const result = await this.pool.query(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema]
      );

      return {
        success: true,
        count: result.rowCount,
        tables: result.rows.map(row => ({
          name: row.table_name,
          type: row.table_type,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get table schema information
   * @param table Table name
   * @param schema Schema name (default: public)
   */
  async describeTable(params: { table: string; schema?: string }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const schema = params.schema || 'public';

      const result = await this.pool.query(
        `SELECT
           column_name,
           data_type,
           character_maximum_length,
           is_nullable,
           column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, params.table]
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          error: `Table ${params.table} not found`,
        };
      }

      return {
        success: true,
        table: params.table,
        schema,
        columns: result.rows.map(row => ({
          name: row.column_name,
          type: row.data_type,
          maxLength: row.character_maximum_length,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all indexes on a table
   * @param table Table name
   * @param schema Schema name (default: public)
   */
  async listIndexes(params: { table: string; schema?: string }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const schema = params.schema || 'public';

      const result = await this.pool.query(
        `SELECT
           i.relname AS index_name,
           a.attname AS column_name,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary
         FROM pg_class t
         JOIN pg_index ix ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE t.relname = $1 AND n.nspname = $2
         ORDER BY i.relname, a.attnum`,
        [params.table, schema]
      );

      // Group by index name
      const indexMap = new Map();
      for (const row of result.rows) {
        if (!indexMap.has(row.index_name)) {
          indexMap.set(row.index_name, {
            name: row.index_name,
            columns: [],
            unique: row.is_unique,
            primary: row.is_primary,
          });
        }
        indexMap.get(row.index_name).columns.push(row.column_name);
      }

      return {
        success: true,
        count: indexMap.size,
        indexes: Array.from(indexMap.values()),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute a SQL INSERT statement
   * @param table Table name
   * @param data Object with column names as keys
   * @param returning Column names to return (optional)
   */
  async insert(params: { table: string; data: Record<string, any>; returning?: string[] }) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const columns = Object.keys(params.data);
      const values = Object.values(params.data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      const returning = params.returning
        ? `RETURNING ${params.returning.join(', ')}`
        : '';

      const sql = `INSERT INTO ${params.table} (${columns.join(', ')})
                   VALUES (${placeholders})
                   ${returning}`;

      const result = await this.pool.query(sql, values);

      return {
        success: true,
        rowCount: result.rowCount,
        rows: result.rows,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(params: {}) {
    if (!this.pool) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const sizeResult = await this.pool.query(
        `SELECT pg_size_pretty(pg_database_size($1)) as size`,
        [this.database]
      );

      const tableCountResult = await this.pool.query(
        `SELECT count(*) as count FROM information_schema.tables WHERE table_schema = 'public'`
      );

      const connectionResult = await this.pool.query(
        `SELECT count(*) as count FROM pg_stat_activity WHERE datname = $1`,
        [this.database]
      );

      return {
        success: true,
        stats: {
          database: this.database,
          size: sizeResult.rows[0].size,
          tableCount: parseInt(tableCountResult.rows[0].count),
          activeConnections: parseInt(connectionResult.rows[0].count),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
