/**
 * Cloudflare KV Session Store
 *
 * Uses Cloudflare KV for fast, globally distributed session storage
 */

import { randomUUID } from 'crypto';
import type { Session, SessionCreateOptions } from '../types/index.js';
import type { SessionStore, SessionConfig } from './store.js';

// ============================================================================
// Cloudflare KV Interface
// ============================================================================

/**
 * Cloudflare KV Namespace interface
 * Compatible with @cloudflare/workers-types KVNamespace
 */
export interface KVNamespace {
  get(
    key: string,
    options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
  ): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<unknown | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: SessionConfig = {
  defaultTtlSeconds: 15 * 60, // 15 minutes
  maxTtlSeconds: 24 * 60 * 60, // 24 hours
  cleanupIntervalMs: 5 * 60 * 1000, // Not used - KV handles TTL
};

// ============================================================================
// KV Session Store
// ============================================================================

export class KVSessionStore implements SessionStore {
  private kv: KVNamespace;
  private config: SessionConfig;
  private keyPrefix: string;

  constructor(kv: KVNamespace, config?: Partial<SessionConfig>, keyPrefix = 'session:') {
    this.kv = kv;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.keyPrefix = keyPrefix;
  }

  private sessionKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  private userSessionsKey(tenantId: string, userId: string): string {
    return `${this.keyPrefix}user:${tenantId}:${userId}`;
  }

  async create(options: SessionCreateOptions): Promise<Session> {
    const now = new Date();
    const ttl = Math.min(
      options.ttlSeconds ?? this.config.defaultTtlSeconds,
      this.config.maxTtlSeconds
    );

    const session: Session = {
      id: randomUUID(),
      tenantId: options.tenantId,
      userId: options.userId,
      clientId: options.clientId,
      clientFingerprint: options.clientFingerprint,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1000),
      lastActivityAt: now,
    };

    // Store session with TTL
    await this.kv.put(this.sessionKey(session.id), JSON.stringify(session), { expirationTtl: ttl });

    // Track user sessions (if user is provided)
    if (options.userId) {
      const userKey = this.userSessionsKey(options.tenantId, options.userId);
      const existing = (await this.kv.get(userKey, { type: 'json' })) as string[] | null;
      const sessionIds = existing ?? [];
      sessionIds.push(session.id);
      await this.kv.put(userKey, JSON.stringify(sessionIds), {
        expirationTtl: this.config.maxTtlSeconds,
      });
    }

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const data = await this.kv.get(this.sessionKey(sessionId));
    if (!data) return null;

    const session = JSON.parse(data) as Session;
    session.createdAt = new Date(session.createdAt);
    session.expiresAt = new Date(session.expiresAt);
    session.lastActivityAt = new Date(session.lastActivityAt);

    // KV TTL should handle expiry, but double-check
    if (session.expiresAt.getTime() < Date.now()) {
      await this.destroy(sessionId);
      return null;
    }

    return session;
  }

  async getByUser(tenantId: string, userId: string): Promise<Session[]> {
    const userKey = this.userSessionsKey(tenantId, userId);
    const sessionIds = (await this.kv.get(userKey, { type: 'json' })) as string[] | null;
    if (!sessionIds) return [];

    const sessions: Session[] = [];
    const validIds: string[] = [];

    for (const id of sessionIds) {
      const session = await this.get(id);
      if (session) {
        sessions.push(session);
        validIds.push(id);
      }
    }

    // Clean up stale references if needed
    if (validIds.length !== sessionIds.length) {
      await this.kv.put(userKey, JSON.stringify(validIds), {
        expirationTtl: this.config.maxTtlSeconds,
      });
    }

    return sessions;
  }

  async touch(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;

    const now = new Date();
    const ttl = this.config.defaultTtlSeconds;
    const maxExpiry = new Date(session.createdAt.getTime() + this.config.maxTtlSeconds * 1000);
    const newExpiry = new Date(Math.min(now.getTime() + ttl * 1000, maxExpiry.getTime()));
    const remainingTtl = Math.floor((newExpiry.getTime() - now.getTime()) / 1000);

    session.lastActivityAt = now;
    session.expiresAt = newExpiry;

    await this.kv.put(this.sessionKey(sessionId), JSON.stringify(session), {
      expirationTtl: remainingTtl,
    });
  }

  async destroy(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (session?.userId) {
      const userKey = this.userSessionsKey(session.tenantId, session.userId);
      const sessionIds = (await this.kv.get(userKey, { type: 'json' })) as string[] | null;
      if (sessionIds) {
        const filtered = sessionIds.filter((id) => id !== sessionId);
        if (filtered.length > 0) {
          await this.kv.put(userKey, JSON.stringify(filtered), {
            expirationTtl: this.config.maxTtlSeconds,
          });
        } else {
          await this.kv.delete(userKey);
        }
      }
    }
    await this.kv.delete(this.sessionKey(sessionId));
  }

  async destroyByUser(tenantId: string, userId: string): Promise<number> {
    const userKey = this.userSessionsKey(tenantId, userId);
    const sessionIds = (await this.kv.get(userKey, { type: 'json' })) as string[] | null;
    if (!sessionIds) return 0;

    const count = sessionIds.length;
    await Promise.all(sessionIds.map((id) => this.kv.delete(this.sessionKey(id))));
    await this.kv.delete(userKey);

    return count;
  }

  async cleanup(): Promise<number> {
    // KV handles TTL-based cleanup automatically
    return 0;
  }

  async close(): Promise<void> {
    // No-op for KV
  }
}
