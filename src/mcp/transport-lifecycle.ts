export interface TransportLifecycleClock {
  now(): number;
}

export interface TransportLifecycleScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  unref?(handle: unknown): void;
}

export interface TransportLifecycleOptions<TSession extends { id: string; lastActivity: Date }> {
  idleTimeoutMs: number;
  cleanupIntervalMs: number;
  clock: TransportLifecycleClock;
  scheduler: TransportLifecycleScheduler;
  onExpired?: (session: TSession) => void;
  onClose?: (session: TSession) => void;
}

/**
 * Owns session storage and its maintenance timer for a transport instance.
 *
 * The lifecycle is deliberately driven by ports: importing this module cannot
 * create timers, and callers decide when the registry starts and closes.
 */
export class TransportLifecycle<TSession extends { id: string; lastActivity: Date }> {
  private readonly sessions = new Map<string, TSession>();
  private cleanupHandle: unknown;

  constructor(private readonly options: TransportLifecycleOptions<TSession>) {}

  start(): void {
    if (this.cleanupHandle !== undefined) return;
    this.cleanupHandle = this.options.scheduler.setInterval(
      () => this.pruneExpired(),
      this.options.cleanupIntervalMs
    );
    this.options.scheduler.unref?.(this.cleanupHandle);
  }

  close(): void {
    if (this.cleanupHandle !== undefined) {
      this.options.scheduler.clearInterval(this.cleanupHandle);
      this.cleanupHandle = undefined;
    }
    for (const session of this.sessions.values()) this.options.onClose?.(session);
    this.sessions.clear();
  }

  get(id: string): TSession | undefined {
    return this.sessions.get(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  set(id: string, session: TSession): void {
    this.sessions.set(id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  values(): IterableIterator<TSession> {
    return this.sessions.values();
  }

  entries(): IterableIterator<[string, TSession]> {
    return this.sessions.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, TSession]> {
    return this.sessions.entries();
  }

  get size(): number {
    return this.sessions.size;
  }

  pruneExpired(): number {
    const now = this.options.clock.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() <= this.options.idleTimeoutMs) continue;
      this.sessions.delete(id);
      removed++;
      this.options.onExpired?.(session);
    }
    return removed;
  }
}
