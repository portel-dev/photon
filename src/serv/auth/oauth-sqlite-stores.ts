/**
 * SQLite-backed implementations of `ElicitationStore` and `GrantStore`.
 *
 * These hold OAuth state that currently goes through `MemoryElicitationStore`
 * and `MemoryGrantStore` in `oauth.ts` — elicitation requests (short-lived,
 * waiting for a user to complete the upstream OAuth flow) and photon grants
 * (long-lived, encrypted refresh tokens for upstream APIs like Stripe/GitHub).
 *
 * Without persistent storage, every daemon restart forces users to re-auth
 * against every upstream provider because the grants live in memory only.
 * Moving grants to SQLite fixes that; elicitations benefit because pending
 * approvals survive a crash of the daemon during the redirect window.
 *
 * Runtime-agnostic via `src/shared/sqlite-runtime.ts`:
 * - Under Bun: uses built-in `bun:sqlite`
 * - Under Node: falls back to `better-sqlite3`
 */

import { randomBytes } from 'crypto';
import type { ElicitationRequest, PhotonGrant } from '../types/index.js';
import type { ElicitationStore, GrantStore } from './oauth.js';
import {
  openSqlite,
  type SqliteDatabase,
  type SqliteStatement,
} from '../../shared/sqlite-runtime.js';

// ============================================================================
// Schema + open
// ============================================================================

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS elicitations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      photon_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      required_scopes TEXT NOT NULL,
      status TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_verifier TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_elicitations_session ON elicitations(session_id);
    CREATE INDEX IF NOT EXISTS idx_elicitations_expires ON elicitations(expires_at);

    CREATE TABLE IF NOT EXISTS photon_grants (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      photon_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      scopes TEXT NOT NULL,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT,
      token_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (tenant_id, photon_id, provider, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_grants_user ON photon_grants(tenant_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_grants_expires ON photon_grants(token_expires_at);
  `);
}

export async function openOauthDatabase(path: string): Promise<SqliteDatabase> {
  return openSqlite(path, initSchema);
}

// ============================================================================
// SqliteElicitationStore
// ============================================================================

export class SqliteElicitationStore implements ElicitationStore {
  private insert: SqliteStatement;
  private select: SqliteStatement;
  private updateStmt: SqliteStatement;
  private remove: SqliteStatement;
  private sweepStmt: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.insert = db.prepare(`
      INSERT INTO elicitations
        (id, session_id, photon_id, provider, required_scopes, status,
         redirect_uri, code_verifier, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.select = db.prepare('SELECT * FROM elicitations WHERE id = ?');
    this.updateStmt = db.prepare(`
      UPDATE elicitations
      SET status = COALESCE(?, status),
          code_verifier = COALESCE(?, code_verifier),
          expires_at = COALESCE(?, expires_at)
      WHERE id = ?
    `);
    this.remove = db.prepare('DELETE FROM elicitations WHERE id = ?');
    this.sweepStmt = db.prepare('DELETE FROM elicitations WHERE expires_at < ?');
  }

  async create(data: Omit<ElicitationRequest, 'id' | 'createdAt'>): Promise<ElicitationRequest> {
    const request: ElicitationRequest = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: new Date(),
    };
    this.insert.run(
      request.id,
      request.sessionId,
      request.photonId,
      request.provider,
      JSON.stringify(request.requiredScopes),
      request.status,
      request.redirectUri,
      request.codeVerifier ?? null,
      request.createdAt.getTime(),
      request.expiresAt.getTime()
    );
    return request;
  }

  async get(id: string): Promise<ElicitationRequest | null> {
    const row = this.select.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const expiresAt = new Date(row.expires_at as number);
    if (expiresAt.getTime() < Date.now()) {
      this.remove.run(id);
      return null;
    }
    return rowToElicitation(row);
  }

  async update(id: string, data: Partial<ElicitationRequest>): Promise<void> {
    // Only status / codeVerifier / expiresAt are mutated in practice
    const expiresAt = data.expiresAt ? data.expiresAt.getTime() : null;
    this.updateStmt.run(data.status ?? null, data.codeVerifier ?? null, expiresAt, id);
  }

  async delete(id: string): Promise<void> {
    this.remove.run(id);
  }

  async cleanup(): Promise<number> {
    const result = this.sweepStmt.run(Date.now());
    return result.changes ?? 0;
  }
}

function rowToElicitation(row: Record<string, unknown>): ElicitationRequest {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    photonId: row.photon_id as string,
    provider: row.provider as string,
    requiredScopes: JSON.parse(row.required_scopes as string) as string[],
    status: row.status as ElicitationRequest['status'],
    redirectUri: row.redirect_uri as string,
    codeVerifier: (row.code_verifier as string | null) ?? undefined,
    createdAt: new Date(row.created_at as number),
    expiresAt: new Date(row.expires_at as number),
  };
}

// ============================================================================
// SqliteGrantStore
// ============================================================================

export class SqliteGrantStore implements GrantStore {
  private insert: SqliteStatement;
  private selectByKey: SqliteStatement;
  private selectByUser: SqliteStatement;
  private updateStmt: SqliteStatement;
  private remove: SqliteStatement;

  constructor(db: SqliteDatabase) {
    this.insert = db.prepare(`
      INSERT OR REPLACE INTO photon_grants
        (id, tenant_id, user_id, photon_id, provider, scopes,
         access_token_encrypted, refresh_token_encrypted, token_expires_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectByKey = db.prepare(`
      SELECT * FROM photon_grants
      WHERE tenant_id = ? AND photon_id = ? AND provider = ?
        AND (user_id = ? OR (user_id IS NULL AND ? IS NULL))
      LIMIT 1
    `);
    this.selectByUser = db.prepare(
      'SELECT * FROM photon_grants WHERE tenant_id = ? AND user_id = ?'
    );
    this.updateStmt = db.prepare(`
      UPDATE photon_grants
      SET access_token_encrypted = COALESCE(?, access_token_encrypted),
          refresh_token_encrypted = COALESCE(?, refresh_token_encrypted),
          scopes = COALESCE(?, scopes),
          token_expires_at = COALESCE(?, token_expires_at),
          updated_at = ?
      WHERE id = ?
    `);
    this.remove = db.prepare('DELETE FROM photon_grants WHERE id = ?');
  }

  async find(
    tenantId: string,
    photonId: string,
    provider: string,
    userId?: string
  ): Promise<PhotonGrant | null> {
    const row = this.selectByKey.get(
      tenantId,
      photonId,
      provider,
      userId ?? null,
      userId ?? null
    ) as Record<string, unknown> | undefined;
    return row ? rowToGrant(row) : null;
  }

  async create(data: Omit<PhotonGrant, 'id' | 'createdAt' | 'updatedAt'>): Promise<PhotonGrant> {
    const now = new Date();
    const grant: PhotonGrant = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: now,
      updatedAt: now,
    };
    this.insert.run(
      grant.id,
      grant.tenantId,
      grant.userId ?? null,
      grant.photonId,
      grant.provider,
      JSON.stringify(grant.scopes),
      grant.accessTokenEncrypted,
      grant.refreshTokenEncrypted ?? null,
      grant.tokenExpiresAt.getTime(),
      grant.createdAt.getTime(),
      grant.updatedAt.getTime()
    );
    return grant;
  }

  async update(id: string, data: Partial<PhotonGrant>): Promise<void> {
    const expiresAt = data.tokenExpiresAt ? data.tokenExpiresAt.getTime() : null;
    this.updateStmt.run(
      data.accessTokenEncrypted ?? null,
      data.refreshTokenEncrypted ?? null,
      data.scopes ? JSON.stringify(data.scopes) : null,
      expiresAt,
      Date.now(),
      id
    );
  }

  async delete(id: string): Promise<void> {
    this.remove.run(id);
  }

  async findByUser(tenantId: string, userId: string): Promise<PhotonGrant[]> {
    const rows = this.selectByUser.all(tenantId, userId) as Record<string, unknown>[];
    return rows.map((r) => rowToGrant(r));
  }
}

function rowToGrant(row: Record<string, unknown>): PhotonGrant {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: (row.user_id as string | null) ?? undefined,
    photonId: row.photon_id as string,
    provider: row.provider as string,
    scopes: JSON.parse(row.scopes as string) as string[],
    accessTokenEncrypted: row.access_token_encrypted as string,
    refreshTokenEncrypted: (row.refresh_token_encrypted as string | null) ?? undefined,
    tokenExpiresAt: new Date(row.token_expires_at as number),
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
  };
}
