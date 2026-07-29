import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface AppSessionBinding {
  principal: string;
  scope: string;
}

interface AppSessionRecord {
  version: 1;
  handle: string;
  binding: AppSessionBinding;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export type AppSessionValidation =
  | { ok: true; record: Readonly<AppSessionRecord> }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'mismatch' | 'unavailable' };

export interface AppSessionHandleStoreOptions {
  directory: string;
  ttlMs?: number;
  maxEntries?: number;
  maxEntriesPerPrincipal?: number;
  now?: () => number;
  randomHandle?: () => string;
}

const HANDLE_RE = /^aps_[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export function hashAppSessionBinding(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

export class AppSessionHandleStore {
  private readonly directory: string;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntriesPerPrincipal: number;
  private readonly now: () => number;
  private readonly randomHandle: () => string;

  constructor(options: AppSessionHandleStoreOptions) {
    this.directory = options.directory;
    this.ttlMs = Math.max(60_000, options.ttlMs ?? DEFAULT_TTL_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? 1_024);
    this.maxEntriesPerPrincipal = Math.max(1, options.maxEntriesPerPrincipal ?? 16);
    this.now = options.now ?? Date.now;
    this.randomHandle =
      options.randomHandle ?? (() => `aps_${randomBytes(32).toString('base64url')}`);
    this.ensureDirectory();
  }

  issue(binding: AppSessionBinding): string {
    this.sweep();
    const records = this.listHandles().flatMap((handle) => {
      try {
        return [this.read(handle)];
      } catch {
        return [];
      }
    });
    if (records.length >= this.maxEntries) throw new Error('Application-session capacity reached');
    if (
      records.filter(
        (record) =>
          !record.revokedAt &&
          record.expiresAt > this.now() &&
          record.binding.principal === binding.principal
      ).length >= this.maxEntriesPerPrincipal
    ) {
      throw new Error('Application-session capacity reached for caller');
    }
    const handle = this.newHandle();
    const now = this.now();
    this.write({
      version: 1,
      handle,
      binding: { ...binding },
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });
    return handle;
  }

  validate(handle: string, binding: AppSessionBinding): AppSessionValidation {
    if (!HANDLE_RE.test(handle)) return { ok: false, reason: 'invalid' };
    let record: AppSessionRecord;
    try {
      record = this.read(handle);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: false, reason: 'invalid' };
    }
    if (record.revokedAt) return { ok: false, reason: 'revoked' };
    if (record.expiresAt <= this.now()) return { ok: false, reason: 'expired' };
    if (record.binding.principal !== binding.principal || record.binding.scope !== binding.scope) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true, record };
  }

  revoke(handle: string, binding: AppSessionBinding): boolean {
    const validation = this.validate(handle, binding);
    if (!validation.ok) return false;
    this.write({ ...validation.record, revokedAt: this.now() });
    return true;
  }

  sweep(): number {
    let removed = 0;
    for (const handle of this.listHandles()) {
      try {
        const record = this.read(handle);
        if (!record.revokedAt && record.expiresAt > this.now()) continue;
      } catch {
        // Corrupt records are invalid handles and safe to remove.
      }
      try {
        unlinkSync(this.path(handle));
        removed += 1;
      } catch {
        // A concurrent process already removed it.
      }
    }
    return removed;
  }

  private read(handle: string): AppSessionRecord {
    const parsed = JSON.parse(readFileSync(this.path(handle), 'utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as AppSessionRecord).version !== 1 ||
      (parsed as AppSessionRecord).handle !== handle ||
      !(parsed as AppSessionRecord).binding ||
      typeof (parsed as AppSessionRecord).binding.principal !== 'string' ||
      typeof (parsed as AppSessionRecord).binding.scope !== 'string' ||
      !Number.isFinite((parsed as AppSessionRecord).createdAt) ||
      !Number.isFinite((parsed as AppSessionRecord).expiresAt) ||
      ((parsed as AppSessionRecord).revokedAt !== undefined &&
        !Number.isFinite((parsed as AppSessionRecord).revokedAt))
    ) {
      throw new Error('Invalid application-session record');
    }
    return parsed as AppSessionRecord;
  }

  private write(record: AppSessionRecord): void {
    this.ensureDirectory();
    const destination = this.path(record.handle);
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, destination);
  }

  private newHandle(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const handle = this.randomHandle();
      if (HANDLE_RE.test(handle) && !existsSync(this.path(handle))) return handle;
    }
    throw new Error('Unable to allocate application-session handle');
  }

  private listHandles(): string[] {
    this.ensureDirectory();
    return readdirSync(this.directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .filter((handle) => HANDLE_RE.test(handle));
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private path(handle: string): string {
    return join(this.directory, `${handle}.json`);
  }
}
