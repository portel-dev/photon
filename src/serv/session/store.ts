/**
 * Session Store Interface and Implementations
 *
 * Provides session management for SERV with support for
 * in-memory (development) and Redis (production) backends
 */

import { randomUUID } from 'crypto';
import type { Session, SessionCreateOptions } from '../types/index.js';

// ============================================================================
// Session Store Interface
// ============================================================================

export interface SessionStore {
  /**
   * Create a new session
   */
  create(options: SessionCreateOptions): Promise<Session>;

  /**
   * Get session by ID
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Get sessions by user ID within a tenant
   */
  getByUser(tenantId: string, userId: string): Promise<Session[]>;

  /**
   * Update last activity time (sliding expiration)
   */
  touch(sessionId: string): Promise<void>;

  /**
   * Invalidate a session
   */
  destroy(sessionId: string): Promise<void>;

  /**
   * Invalidate all sessions for a user in a tenant
   */
  destroyByUser(tenantId: string, userId: string): Promise<number>;

  /**
   * Clean up expired sessions
   */
  cleanup(): Promise<number>;

  /**
   * Close the store connection
   */
  close(): Promise<void>;
}

// ============================================================================
// Session Configuration
// ============================================================================

export interface SessionConfig {
  /** Default session TTL in seconds (default: 15 minutes) */
  defaultTtlSeconds: number;
  /** Maximum session TTL in seconds (default: 24 hours) */
  maxTtlSeconds: number;
  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: SessionConfig = {
  defaultTtlSeconds: 15 * 60,       // 15 minutes
  maxTtlSeconds: 24 * 60 * 60,      // 24 hours
  cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
};

// ============================================================================
// In-Memory Session Store (Development)
// ============================================================================

export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map(); // tenantId:userId -> sessionIds
  private cleanupTimer?: NodeJS.Timeout;
  private config: SessionConfig;

  constructor(config: Partial<SessionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
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

    this.sessions.set(session.id, session);

    // Track user sessions
    if (options.userId) {
      const key = `${options.tenantId}:${options.userId}`;
      if (!this.userSessions.has(key)) {
        this.userSessions.set(key, new Set());
      }
      this.userSessions.get(key)!.add(session.id);
    }

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check if expired
    if (session.expiresAt.getTime() < Date.now()) {
      await this.destroy(sessionId);
      return null;
    }

    return session;
  }

  async getByUser(tenantId: string, userId: string): Promise<Session[]> {
    const key = `${tenantId}:${userId}`;
    const sessionIds = this.userSessions.get(key);
    if (!sessionIds) return [];

    const sessions: Session[] = [];
    for (const id of sessionIds) {
      const session = await this.get(id);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = new Date();
    const ttl = this.config.defaultTtlSeconds;
    const maxExpiry = new Date(session.createdAt.getTime() + this.config.maxTtlSeconds * 1000);
    const newExpiry = new Date(Math.min(now.getTime() + ttl * 1000, maxExpiry.getTime()));

    session.lastActivityAt = now;
    session.expiresAt = newExpiry;
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.userId) {
      const key = `${session.tenantId}:${session.userId}`;
      this.userSessions.get(key)?.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }

  async destroyByUser(tenantId: string, userId: string): Promise<number> {
    const key = `${tenantId}:${userId}`;
    const sessionIds = this.userSessions.get(key);
    if (!sessionIds) return 0;

    const count = sessionIds.size;
    for (const id of sessionIds) {
      this.sessions.delete(id);
    }
    this.userSessions.delete(key);
    return count;
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (session.expiresAt.getTime() < now) {
        await this.destroy(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.sessions.clear();
    this.userSessions.clear();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(console.error);
    }, this.config.cleanupIntervalMs);
  }
}

// ============================================================================
// Redis Session Store (Production)
// ============================================================================

export interface RedisSessionStoreOptions {
  /** Redis client instance or connection URL */
  redis: RedisClient | string;
  /** Key prefix for session storage */
  keyPrefix?: string;
  /** Session configuration */
  config?: Partial<SessionConfig>;
}

// Minimal Redis client interface (compatible with ioredis and redis)
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  quit(): Promise<unknown>;
}

export class RedisSessionStore implements SessionStore {
  private redis: RedisClient;
  private keyPrefix: string;
  private config: SessionConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: RedisSessionStoreOptions) {
    if (typeof options.redis === 'string') {
      throw new Error('Redis URL not supported yet - pass a Redis client instance');
    }
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'serv:session:';
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.startCleanup();
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

    await this.redis.set(
      this.sessionKey(session.id),
      JSON.stringify(session),
      { EX: ttl }
    );

    // Track user sessions
    if (options.userId) {
      const userKey = this.userSessionsKey(options.tenantId, options.userId);
      await this.redis.sadd(userKey, session.id);
      await this.redis.expire(userKey, this.config.maxTtlSeconds);
    }

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    const data = await this.redis.get(this.sessionKey(sessionId));
    if (!data) return null;

    const session = JSON.parse(data) as Session;
    session.createdAt = new Date(session.createdAt);
    session.expiresAt = new Date(session.expiresAt);
    session.lastActivityAt = new Date(session.lastActivityAt);

    // Check if expired (Redis TTL should handle this, but double-check)
    if (session.expiresAt.getTime() < Date.now()) {
      await this.destroy(sessionId);
      return null;
    }

    return session;
  }

  async getByUser(tenantId: string, userId: string): Promise<Session[]> {
    const userKey = this.userSessionsKey(tenantId, userId);
    const sessionIds = await this.redis.smembers(userKey);

    const sessions: Session[] = [];
    for (const id of sessionIds) {
      const session = await this.get(id);
      if (session) {
        sessions.push(session);
      } else {
        // Clean up stale reference
        await this.redis.srem(userKey, id);
      }
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

    await this.redis.set(
      this.sessionKey(sessionId),
      JSON.stringify(session),
      { EX: remainingTtl }
    );
  }

  async destroy(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (session?.userId) {
      const userKey = this.userSessionsKey(session.tenantId, session.userId);
      await this.redis.srem(userKey, sessionId);
    }
    await this.redis.del(this.sessionKey(sessionId));
  }

  async destroyByUser(tenantId: string, userId: string): Promise<number> {
    const userKey = this.userSessionsKey(tenantId, userId);
    const sessionIds = await this.redis.smembers(userKey);

    if (sessionIds.length === 0) return 0;

    const keys = sessionIds.map(id => this.sessionKey(id));
    await this.redis.del(keys);
    await this.redis.del(userKey);

    return sessionIds.length;
  }

  async cleanup(): Promise<number> {
    // Redis TTL handles cleanup automatically
    // This method exists for interface compatibility
    return 0;
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    await this.redis.quit();
  }

  private startCleanup(): void {
    // Redis handles TTL-based cleanup automatically
    // We just periodically clean up stale user session references
    this.cleanupTimer = setInterval(async () => {
      try {
        const userKeys = await this.redis.keys(`${this.keyPrefix}user:*`);
        for (const userKey of userKeys) {
          const sessionIds = await this.redis.smembers(userKey);
          for (const id of sessionIds) {
            const exists = await this.redis.get(this.sessionKey(id));
            if (!exists) {
              await this.redis.srem(userKey, id);
            }
          }
        }
      } catch (err) {
        console.error('Session cleanup error:', err);
      }
    }, this.config.cleanupIntervalMs);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export type SessionStoreType = 'memory' | 'redis' | 'kv';

export interface CreateSessionStoreOptions {
  type: SessionStoreType;
  redis?: RedisClient;
  kv?: unknown; // KVNamespace - imported dynamically
  config?: Partial<SessionConfig>;
}

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  switch (options.type) {
    case 'memory':
      return new MemorySessionStore(options.config);
    case 'redis':
      if (!options.redis) {
        throw new Error('Redis client required for redis session store');
      }
      return new RedisSessionStore({
        redis: options.redis,
        config: options.config,
      });
    case 'kv':
      // KV store is imported separately to avoid bundling Cloudflare types
      throw new Error('Use KVSessionStore directly from session/kv-store.ts');
    default:
      throw new Error(`Unknown session store type: ${options.type}`);
  }
}
