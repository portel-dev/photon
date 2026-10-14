export interface SessionRegistryOptions<T> {
  isExpired(session: T, now: number): boolean;
  onExpired?(session: T): void;
  now?: () => number;
  intervalMs?: number;
}

/** Owns session storage and cleanup lifecycle for a transport composition root. */
export class SessionRegistry<T> {
  private readonly sessions = new Map<string, T>();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly intervalMs: number;

  constructor(private readonly options: SessionRegistryOptions<T>) {
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  }

  get(id: string): T | undefined {
    return this.sessions.get(id);
  }
  has(id: string): boolean {
    return this.sessions.has(id);
  }
  set(id: string, session: T): void {
    this.sessions.set(id, session);
  }
  delete(id: string): boolean {
    return this.sessions.delete(id);
  }
  values(): IterableIterator<T> {
    return this.sessions.values();
  }
  entries(): IterableIterator<[string, T]> {
    return this.sessions.entries();
  }
  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.sessions.entries();
  }
  clear(): void {
    this.sessions.clear();
  }
  get size(): number {
    return this.sessions.size;
  }

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.intervalMs);
    this.cleanupTimer.unref?.();
  }

  cleanup(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (!this.options.isExpired(session, now)) continue;
      this.sessions.delete(id);
      this.options.onExpired?.(session);
    }
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.sessions.clear();
  }
}
