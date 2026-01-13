/**
 * Cloudflare D1 Database Client
 *
 * Provides typed access to D1 SQLite database
 */

// ============================================================================
// D1 Interface
// ============================================================================

/**
 * Cloudflare D1 Database interface
 * Compatible with @cloudflare/workers-types D1Database
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: {
    duration: number;
    changes: number;
    last_row_id: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

// ============================================================================
// Schema
// ============================================================================

export const SCHEMA = `
-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  plan TEXT NOT NULL DEFAULT 'free',
  encryption_key_id TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Users (global)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Memberships
CREATE TABLE IF NOT EXISTS memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- OAuth Grants
CREATE TABLE IF NOT EXISTS photon_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  photon_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  scopes TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, user_id, photon_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_grants_tenant ON photon_grants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_grants_lookup ON photon_grants(tenant_id, photon_id, provider);

-- Elicitation Requests (short-lived)
CREATE TABLE IF NOT EXISTS elicitation_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  photon_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  required_scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  redirect_uri TEXT NOT NULL,
  code_verifier TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elicitation_session ON elicitation_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_elicitation_expires ON elicitation_requests(expires_at);
`;

// ============================================================================
// D1 Client Wrapper
// ============================================================================

export class D1Client {
  constructor(private db: D1Database) {}

  /**
   * Initialize the database schema
   */
  async initialize(): Promise<void> {
    await this.db.exec(SCHEMA);
  }

  /**
   * Execute a query and return first result
   */
  async first<T>(query: string, ...params: unknown[]): Promise<T | null> {
    return this.db.prepare(query).bind(...params).first<T>();
  }

  /**
   * Execute a query and return all results
   */
  async all<T>(query: string, ...params: unknown[]): Promise<T[]> {
    const result = await this.db.prepare(query).bind(...params).all<T>();
    return result.results ?? [];
  }

  /**
   * Execute a query (INSERT, UPDATE, DELETE)
   */
  async run(query: string, ...params: unknown[]): Promise<{ changes: number; lastRowId: number }> {
    const result = await this.db.prepare(query).bind(...params).run();
    return {
      changes: result.meta?.changes ?? 0,
      lastRowId: result.meta?.last_row_id ?? 0,
    };
  }

  /**
   * Execute multiple queries in a batch
   */
  async batch(queries: Array<{ sql: string; params: unknown[] }>): Promise<void> {
    const statements = queries.map(q => this.db.prepare(q.sql).bind(...q.params));
    await this.db.batch(statements);
  }
}
