import type { LockInfo } from './protocol.js';

export interface LockService {
  acquire(name: string, holder: string, timeoutMs: number): boolean;
  release(name: string, holder: string): boolean;
  get(name: string): LockInfo | undefined;
  list(): LockInfo[];
  transfer(name: string, fromHolder: string, toHolder: string, timeoutMs: number): boolean;
  clear(): void;
  cleanupExpired(now?: number): void;
}

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

export class InMemoryLockService implements LockService {
  private locks = new Map<string, LockInfo>();

  acquire(name: string, holder: string, timeoutMs = DEFAULT_LOCK_TIMEOUT_MS): boolean {
    const now = Date.now();
    const existing = this.locks.get(name);
    if (existing && existing.expiresAt > now && existing.holder !== holder) return false;
    this.locks.set(name, { name, holder, acquiredAt: now, expiresAt: now + timeoutMs });
    return true;
  }

  release(name: string, holder: string): boolean {
    const existing = this.locks.get(name);
    if (!existing) return true;
    if (existing.holder !== holder) return false;
    this.locks.delete(name);
    return true;
  }

  get(name: string): LockInfo | undefined {
    return this.locks.get(name);
  }

  list(): LockInfo[] {
    return [...this.locks.values()];
  }

  transfer(
    name: string,
    fromHolder: string,
    toHolder: string,
    timeoutMs = DEFAULT_LOCK_TIMEOUT_MS
  ): boolean {
    const existing = this.locks.get(name);
    if (!existing || existing.holder !== fromHolder) return false;
    return this.acquire(name, toHolder, timeoutMs);
  }

  clear(): void {
    this.locks.clear();
  }

  cleanupExpired(now = Date.now()): void {
    for (const [name, lock] of this.locks) {
      if (lock.expiresAt <= now) this.locks.delete(name);
    }
  }
}
