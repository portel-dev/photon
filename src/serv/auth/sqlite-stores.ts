/**
 * SQLite-backed authorization-server stores.
 *
 * Implements the same five interfaces as `auth-store.ts` (AuthCodeStore,
 * RefreshTokenStore, ClientRegistry, ConsentStore, PendingAuthorizationStore)
 * with persistent storage across process restarts.
 *
 * Runtime-agnostic via `src/shared/sqlite-runtime.ts`:
 * - Under Bun: uses built-in `bun:sqlite` (zero install).
 * - Under Node: falls back to `better-sqlite3` (optional peer dep).
 *
 * All five stores share a single database handle. Schema is created on first
 * use. TTL enforcement happens at read time (stale rows are ignored and
 * sweep() deletes them).
 */

import type {
  AuthorizationCode,
  RefreshToken,
  RegisteredClient,
  ConsentRecord,
} from '../types/index.js';
import type {
  AuthCodeStore,
  RefreshTokenStore,
  ClientRegistry,
  ConsentStore,
  PendingAuthorizationStore,
  PendingAuthorization,
} from './auth-store.js';
import {
  openSqlite,
  type SqliteDatabase,
  type SqliteStatement,
} from '../../shared/sqlite-runtime.js';

/**
 * Open the AS SQLite database at `path` with all schema created.
 */
export async function openAuthDatabase(path: string): Promise<SqliteDatabase> {
  return openSqlite(path, initSchema);
}

// ============================================================================
// Schema
// ============================================================================

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      nonce TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      supersedes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(tenant_id, user_id);

    CREATE TABLE IF NOT EXISTS registered_clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT,
      client_name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      grant_types TEXT NOT NULL,
      response_types TEXT NOT NULL,
      scope TEXT NOT NULL,
      contacts TEXT,
      logo_uri TEXT,
      tos_uri TEXT,
      policy_uri TEXT,
      is_public INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clients_last_used ON registered_clients(last_used_at);

    CREATE TABLE IF NOT EXISTS consent_records (
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, user_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS idx_consent_expires ON consent_records(expires_at);

    CREATE TABLE IF NOT EXISTS pending_auth (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      nonce TEXT,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      response_type TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_auth(expires_at);
  `);

  // Backfill columns added after the original schema. CREATE TABLE IF NOT EXISTS
  // is a no-op against an existing table, so explicit ALTERs are required.
  // ALTER COLUMN ADD on SQLite is idempotent only via PRAGMA inspection — the
  // raw statement throws "duplicate column" on a re-run, which we swallow.
  addColumnIfMissing(db, 'auth_codes', 'nonce', 'TEXT');
  addColumnIfMissing(db, 'pending_auth', 'nonce', 'TEXT');
}

/** Idempotent ALTER TABLE ADD COLUMN. SQLite's table_info is the safest probe. */
function addColumnIfMissing(db: SqliteDatabase, table: string, column: string, type: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // Table missing or PRAGMA unavailable — initial CREATE above will have
    // produced the column; this is purely an upgrade-from-pre-nonce path.
  }
}

// ============================================================================
// Auth Code Store
// ============================================================================

export class SqliteAuthCodeStore implements AuthCodeStore {
  private insert: SqliteStatement;
  private select: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.insert = db.prepare(`
      INSERT INTO auth_codes (code, client_id, redirect_uri, scope, user_id, tenant_id,
        code_challenge, code_challenge_method, nonce, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare('SELECT * FROM auth_codes WHERE code = ?');
    this.remove = db.prepare('DELETE FROM auth_codes WHERE code = ?');
    this.sweepStmt = db.prepare('DELETE FROM auth_codes WHERE expires_at < ?');
  }

  async save(code: AuthorizationCode): Promise<void> {
    try {
      this.insert.run(
        code.code,
        code.clientId,
        code.redirectUri,
        code.scope,
        code.userId,
        code.tenantId,
        code.codeChallenge,
        code.codeChallengeMethod,
        code.nonce ?? null,
        code.expiresAt.getTime(),
        code.createdAt.getTime()
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        throw new Error('authorization code collision');
      }
      throw err;
    }
  }

  async consume(code: string): Promise<AuthorizationCode | null> {
    const tx = this.db.transaction((c: string) => {
      const row = this.select.get(c);
      if (!row) return null;
      this.remove.run(c);
      return row;
    });
    const row = tx(code);
    if (!row) return null;
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() < Date.now()) return null;
    return rowToAuthCode(row);
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const result = this.sweepStmt.run(now.getTime());
    return result.changes ?? 0;
  }
}

function rowToAuthCode(row: any): AuthorizationCode {
  return {
    code: row.code,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    userId: row.user_id,
    tenantId: row.tenant_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    nonce: row.nonce ?? undefined,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Refresh Token Store
// ============================================================================

export class SqliteRefreshTokenStore implements RefreshTokenStore {
  private insert: SqliteStatement;
  private select: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.insert = db.prepare(`
      INSERT OR REPLACE INTO refresh_tokens
        (token, client_id, user_id, tenant_id, scope, expires_at, created_at, supersedes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?');
    this.remove = db.prepare('DELETE FROM refresh_tokens WHERE token = ?');
    this.sweepStmt = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?');
  }

  async save(token: RefreshToken): Promise<void> {
    this.insertRow(token);
  }

  private insertRow(token: RefreshToken): void {
    this.insert.run(
      token.token,
      token.clientId,
      token.userId,
      token.tenantId,
      token.scope,
      token.expiresAt.getTime(),
      token.createdAt.getTime(),
      token.supersedes ?? null
    );
  }

  async find(token: string): Promise<RefreshToken | null> {
    const row = this.select.get(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) return null;
    return rowToRefreshToken(row);
  }

  async rotate(oldToken: string, newToken: RefreshToken): Promise<RefreshToken | null> {
    const tx = this.db.transaction((o: string, n: RefreshToken) => {
      const existing = this.select.get(o);
      if (!existing) return null;
      if (existing.expires_at < Date.now()) {
        this.remove.run(o);
        return null;
      }
      this.remove.run(o);
      this.insertRow(n);
      return n;
    });
    return tx(oldToken, newToken);
  }

  async revoke(token: string): Promise<boolean> {
    const result = this.remove.run(token);
    return (result.changes ?? 0) > 0;
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const result = this.sweepStmt.run(now.getTime());
    return result.changes ?? 0;
  }
}

function rowToRefreshToken(row: any): RefreshToken {
  return {
    token: row.token,
    clientId: row.client_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    scope: row.scope,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
    supersedes: row.supersedes ?? undefined,
  };
}

// ============================================================================
// Client Registry
// ============================================================================

export class SqliteClientRegistry implements ClientRegistry {
  private upsert: SqliteStatement;
  private select: SqliteStatement;
  private touchStmt: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.upsert = db.prepare(`
      INSERT OR REPLACE INTO registered_clients
        (client_id, client_secret_hash, client_name, redirect_uris, grant_types,
         response_types, scope, contacts, logo_uri, tos_uri, policy_uri,
         is_public, created_at, last_used_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare('SELECT * FROM registered_clients WHERE client_id = ?');
    this.touchStmt = db.prepare(
      'UPDATE registered_clients SET last_used_at = ? WHERE client_id = ?'
    );
    this.remove = db.prepare('DELETE FROM registered_clients WHERE client_id = ?');
    this.sweepStmt = db.prepare('DELETE FROM registered_clients WHERE last_used_at < ?');
  }

  async save(client: RegisteredClient): Promise<void> {
    this.upsert.run(
      client.clientId,
      client.clientSecretHash ?? null,
      client.clientName,
      JSON.stringify(client.redirectUris),
      JSON.stringify(client.grantTypes),
      JSON.stringify(client.responseTypes),
      client.scope,
      client.contacts ? JSON.stringify(client.contacts) : null,
      client.logoUri ?? null,
      client.tosUri ?? null,
      client.policyUri ?? null,
      client.isPublic ? 1 : 0,
      client.createdAt.getTime(),
      client.lastUsedAt.getTime(),
      client.registrationContext?.userAgent ?? null,
      client.registrationContext?.ipAddress ?? null
    );
  }

  async find(clientId: string): Promise<RegisteredClient | null> {
    const row = this.select.get(clientId);
    if (!row) return null;
    return rowToRegisteredClient(row);
  }

  async touch(clientId: string, now: Date = new Date()): Promise<void> {
    this.touchStmt.run(now.getTime(), clientId);
  }

  async delete(clientId: string): Promise<boolean> {
    const result = this.remove.run(clientId);
    return (result.changes ?? 0) > 0;
  }

  async sweep(maxIdleMs: number, now: Date = new Date()): Promise<number> {
    const threshold = now.getTime() - maxIdleMs;
    const result = this.sweepStmt.run(threshold);
    return result.changes ?? 0;
  }
}

function rowToRegisteredClient(row: any): RegisteredClient {
  return {
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash ?? undefined,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    grantTypes: JSON.parse(row.grant_types) as string[],
    responseTypes: JSON.parse(row.response_types) as string[],
    scope: row.scope,
    contacts: row.contacts ? (JSON.parse(row.contacts) as string[]) : undefined,
    logoUri: row.logo_uri ?? undefined,
    tosUri: row.tos_uri ?? undefined,
    policyUri: row.policy_uri ?? undefined,
    isPublic: row.is_public === 1,
    createdAt: new Date(row.created_at),
    lastUsedAt: new Date(row.last_used_at),
    registrationContext:
      row.user_agent || row.ip_address
        ? { userAgent: row.user_agent ?? undefined, ipAddress: row.ip_address ?? undefined }
        : undefined,
  };
}

// ============================================================================
// Consent Store
// ============================================================================

export class SqliteConsentStore implements ConsentStore {
  private upsert: SqliteStatement;
  private select: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.upsert = db.prepare(`
      INSERT OR REPLACE INTO consent_records
        (user_id, tenant_id, client_id, scopes, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare(
      'SELECT * FROM consent_records WHERE tenant_id = ? AND user_id = ? AND client_id = ?'
    );
    this.remove = db.prepare(
      'DELETE FROM consent_records WHERE tenant_id = ? AND user_id = ? AND client_id = ?'
    );
    this.sweepStmt = db.prepare('DELETE FROM consent_records WHERE expires_at < ?');
  }

  async save(record: ConsentRecord): Promise<void> {
    this.upsert.run(
      record.userId,
      record.tenantId,
      record.clientId,
      record.scopes,
      record.expiresAt.getTime(),
      record.createdAt.getTime()
    );
  }

  async covers(
    userId: string,
    tenantId: string,
    clientId: string,
    scopes: string[]
  ): Promise<boolean> {
    const row = this.select.get(tenantId, userId, clientId);
    if (!row) return false;
    if (row.expires_at < Date.now()) {
      this.remove.run(tenantId, userId, clientId);
      return false;
    }
    const stored = new Set((row.scopes as string).split(' ').filter(Boolean));
    return scopes.every((s) => stored.has(s));
  }

  async revoke(userId: string, tenantId: string, clientId: string): Promise<boolean> {
    const result = this.remove.run(tenantId, userId, clientId);
    return (result.changes ?? 0) > 0;
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const result = this.sweepStmt.run(now.getTime());
    return result.changes ?? 0;
  }
}

// ============================================================================
// Pending Authorization Store
// ============================================================================

export class SqlitePendingAuthorizationStore implements PendingAuthorizationStore {
  private insert: SqliteStatement;
  private select: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(private db: SqliteDatabase) {
    this.insert = db.prepare(`
      INSERT INTO pending_auth
        (id, client_id, redirect_uri, scope, state, nonce, code_challenge,
         code_challenge_method, user_id, tenant_id, response_type,
         expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare('SELECT * FROM pending_auth WHERE id = ?');
    this.remove = db.prepare('DELETE FROM pending_auth WHERE id = ?');
    this.sweepStmt = db.prepare('DELETE FROM pending_auth WHERE expires_at < ?');
  }

  async save(req: PendingAuthorization): Promise<void> {
    this.insert.run(
      req.id,
      req.clientId,
      req.redirectUri,
      req.scope,
      req.state ?? null,
      req.nonce ?? null,
      req.codeChallenge,
      req.codeChallengeMethod,
      req.userId,
      req.tenantId,
      req.responseType,
      req.expiresAt.getTime(),
      req.createdAt.getTime()
    );
  }

  async consume(id: string): Promise<PendingAuthorization | null> {
    const tx = this.db.transaction((i: string) => {
      const row = this.select.get(i);
      if (!row) return null;
      this.remove.run(i);
      return row;
    });
    const row = tx(id);
    if (!row) return null;
    if (row.expires_at < Date.now()) return null;
    return rowToPending(row);
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const result = this.sweepStmt.run(now.getTime());
    return result.changes ?? 0;
  }
}

function rowToPending(row: any): PendingAuthorization {
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    state: row.state ?? undefined,
    nonce: row.nonce ?? undefined,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    userId: row.user_id,
    tenantId: row.tenant_id,
    responseType: row.response_type,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}
