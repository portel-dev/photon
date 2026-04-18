/**
 * Authorization Server state stores.
 *
 * Holds the short-lived + persistent state the OAuth 2.1 authorization server
 * needs: authorization codes, refresh tokens, registered clients (DCR),
 * remembered user consents, and in-flight authorization requests that are
 * paused awaiting user consent.
 *
 * In-memory implementations are suitable for single-instance self-host.
 * For multi-instance deployments swap with a shared-store implementation
 * (Redis/D1) that implements the same interfaces.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import type {
  AuthorizationCode,
  RefreshToken,
  RegisteredClient,
  ConsentRecord,
} from '../types/index.js';

// ============================================================================
// Authorization Code Store
// ============================================================================

export interface AuthCodeStore {
  /** Store a freshly minted code; fails if code already exists. */
  save(code: AuthorizationCode): Promise<void>;
  /** Atomically consume a code (single-use per RFC 6749 §4.1.2). */
  consume(code: string): Promise<AuthorizationCode | null>;
  /** Remove expired entries. */
  sweep(now?: Date): Promise<number>;
}

export class MemoryAuthCodeStore implements AuthCodeStore {
  private codes = new Map<string, AuthorizationCode>();

  async save(code: AuthorizationCode): Promise<void> {
    if (this.codes.has(code.code)) {
      throw new Error('authorization code collision');
    }
    this.codes.set(code.code, code);
  }

  async consume(code: string): Promise<AuthorizationCode | null> {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code); // single-use: delete even if expired
    if (entry.expiresAt.getTime() < Date.now()) return null;
    return entry;
  }

  async sweep(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [k, v] of this.codes) {
      if (v.expiresAt.getTime() < now.getTime()) {
        this.codes.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.codes.size;
  }
}

// ============================================================================
// Refresh Token Store
// ============================================================================

export interface RefreshTokenStore {
  save(token: RefreshToken): Promise<void>;
  find(token: string): Promise<RefreshToken | null>;
  /** Atomic rotation: consume old, save new in one call. */
  rotate(oldToken: string, newToken: RefreshToken): Promise<RefreshToken | null>;
  revoke(token: string): Promise<boolean>;
  sweep(now?: Date): Promise<number>;
}

export class MemoryRefreshTokenStore implements RefreshTokenStore {
  private tokens = new Map<string, RefreshToken>();

  async save(token: RefreshToken): Promise<void> {
    this.tokens.set(token.token, token);
  }

  async find(token: string): Promise<RefreshToken | null> {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.expiresAt.getTime() < Date.now()) return null;
    return entry;
  }

  async rotate(oldToken: string, newToken: RefreshToken): Promise<RefreshToken | null> {
    const existing = this.tokens.get(oldToken);
    if (!existing) return null;
    if (existing.expiresAt.getTime() < Date.now()) {
      this.tokens.delete(oldToken);
      return null;
    }
    this.tokens.delete(oldToken);
    this.tokens.set(newToken.token, newToken);
    return newToken;
  }

  async revoke(token: string): Promise<boolean> {
    return this.tokens.delete(token);
  }

  async sweep(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [k, v] of this.tokens) {
      if (v.expiresAt.getTime() < now.getTime()) {
        this.tokens.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.tokens.size;
  }
}

// ============================================================================
// Client Registry (RFC 7591 DCR)
// ============================================================================

export interface ClientRegistry {
  save(client: RegisteredClient): Promise<void>;
  find(clientId: string): Promise<RegisteredClient | null>;
  /** Update lastUsedAt for TTL renewal. */
  touch(clientId: string, now?: Date): Promise<void>;
  delete(clientId: string): Promise<boolean>;
  /** Evict clients that haven't been touched in `maxIdleMs`. */
  sweep(maxIdleMs: number, now?: Date): Promise<number>;
}

export class MemoryClientRegistry implements ClientRegistry {
  private clients = new Map<string, RegisteredClient>();

  async save(client: RegisteredClient): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async find(clientId: string): Promise<RegisteredClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  async touch(clientId: string, now: Date = new Date()): Promise<void> {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastUsedAt = now;
  }

  async delete(clientId: string): Promise<boolean> {
    return this.clients.delete(clientId);
  }

  async sweep(maxIdleMs: number, now: Date = new Date()): Promise<number> {
    let removed = 0;
    const threshold = now.getTime() - maxIdleMs;
    for (const [k, v] of this.clients) {
      if (v.lastUsedAt.getTime() < threshold) {
        this.clients.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.clients.size;
  }
}

// ============================================================================
// Consent Store (remembered user consents)
// ============================================================================

export interface ConsentStore {
  /** Save or overwrite consent for (user, client, scope_set). */
  save(record: ConsentRecord): Promise<void>;
  /**
   * Check if a consent record exists that covers the requested scopes.
   * Returns true if stored scopes are a superset of requested scopes.
   */
  covers(userId: string, tenantId: string, clientId: string, scopes: string[]): Promise<boolean>;
  /** Remove a specific consent record. */
  revoke(userId: string, tenantId: string, clientId: string): Promise<boolean>;
  sweep(now?: Date): Promise<number>;
}

export class MemoryConsentStore implements ConsentStore {
  private records = new Map<string, ConsentRecord>();

  private key(userId: string, tenantId: string, clientId: string): string {
    return `${tenantId}::${userId}::${clientId}`;
  }

  async save(record: ConsentRecord): Promise<void> {
    const k = this.key(record.userId, record.tenantId, record.clientId);
    this.records.set(k, record);
  }

  async covers(
    userId: string,
    tenantId: string,
    clientId: string,
    scopes: string[]
  ): Promise<boolean> {
    const k = this.key(userId, tenantId, clientId);
    const entry = this.records.get(k);
    if (!entry) return false;
    if (entry.expiresAt.getTime() < Date.now()) {
      this.records.delete(k);
      return false;
    }
    const stored = new Set(entry.scopes.split(' ').filter(Boolean));
    return scopes.every((s) => stored.has(s));
  }

  async revoke(userId: string, tenantId: string, clientId: string): Promise<boolean> {
    return this.records.delete(this.key(userId, tenantId, clientId));
  }

  async sweep(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [k, v] of this.records) {
      if (v.expiresAt.getTime() < now.getTime()) {
        this.records.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.records.size;
  }
}

// ============================================================================
// Pending Authorization Request (paused awaiting consent)
// ============================================================================

/**
 * An authorization request that passed validation at `/authorize` but is
 * paused because the user hasn't consented to these scopes yet. Resumed
 * when the user approves at `/consent`.
 *
 * Short TTL (10 min) — if the user walks away from the consent screen, the
 * request expires and they restart.
 */
export interface PendingAuthorization {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  userId: string;
  tenantId: string;
  responseType: 'code';
  expiresAt: Date;
  createdAt: Date;
}

export interface PendingAuthorizationStore {
  save(req: PendingAuthorization): Promise<void>;
  consume(id: string): Promise<PendingAuthorization | null>;
  sweep(now?: Date): Promise<number>;
}

export class MemoryPendingAuthorizationStore implements PendingAuthorizationStore {
  private pending = new Map<string, PendingAuthorization>();

  async save(req: PendingAuthorization): Promise<void> {
    this.pending.set(req.id, req);
  }

  async consume(id: string): Promise<PendingAuthorization | null> {
    const entry = this.pending.get(id);
    if (!entry) return null;
    this.pending.delete(id);
    if (entry.expiresAt.getTime() < Date.now()) return null;
    return entry;
  }

  async sweep(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [k, v] of this.pending) {
      if (v.expiresAt.getTime() < now.getTime()) {
        this.pending.delete(k);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    return this.pending.size;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a URL-safe random string of the given byte-length.
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash a secret with SHA-256 for storage. Not a password; client_secret
 * is high-entropy and rotated, so sha256 is acceptable and avoids bcrypt's
 * 72-byte limit and pbkdf2's latency on every token request.
 */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

/**
 * Timing-safe comparison of a presented secret against a stored hash.
 */
export function verifyClientSecret(presented: string, storedHash: string): boolean {
  const presentedHash = hashClientSecret(presented);
  const a = Buffer.from(presentedHash);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Normalise a scope string into a sorted, deduped, space-joined key. Used
 * for consent-record keys so `"read write"` and `"write read"` match.
 */
export function normalizeScopes(scope: string | undefined | null): string {
  if (!scope) return '';
  const parts = scope.split(/\s+/).filter(Boolean);
  const unique = Array.from(new Set(parts));
  unique.sort();
  return unique.join(' ');
}
