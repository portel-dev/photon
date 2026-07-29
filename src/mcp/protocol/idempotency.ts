import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const PHOTON_IDEMPOTENCY_META_KEY = 'dev.portel.photon/idempotencyKey';

export interface IdempotencyBinding {
  principal: string;
  scope: string;
  appSession: string;
  tool: string;
  argumentsHash: string;
}

interface IdempotencyRecord {
  version: 1;
  keyHash: string;
  keyFingerprint: string;
  binding: IdempotencyBinding;
  idempotent: boolean;
  status: 'pending' | 'completed';
  createdAt: number;
  updatedAt: number;
  response?: unknown;
}

export type IdempotencyClaim =
  | { kind: 'claimed'; keyHash: string }
  | { kind: 'cached'; response: unknown }
  | { kind: 'duplicate'; pending: boolean; idempotent: boolean }
  | { kind: 'mismatch' };

export interface IdempotencyStoreOptions {
  directory: string;
  ttlMs?: number;
  pendingRetryMs?: number;
  now?: () => number;
}

const KEY_RE = /^[\x21-\x7e]{1,128}$/;

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function sameBinding(left: IdempotencyBinding, right: IdempotencyBinding): boolean {
  return (
    left.principal === right.principal &&
    left.scope === right.scope &&
    left.appSession === right.appSession &&
    left.tool === right.tool &&
    left.argumentsHash === right.argumentsHash
  );
}

export class IdempotencyStore {
  private readonly directory: string;
  private readonly ttlMs: number;
  private readonly pendingRetryMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyStoreOptions) {
    this.directory = options.directory;
    this.ttlMs = Math.max(60_000, options.ttlMs ?? 24 * 60 * 60 * 1_000);
    this.pendingRetryMs = Math.max(1_000, options.pendingRetryMs ?? 5 * 60_000);
    this.now = options.now ?? Date.now;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  claim(key: string, binding: IdempotencyBinding, idempotent: boolean): IdempotencyClaim {
    if (!KEY_RE.test(key) || /[\r\n]/.test(key)) throw new TypeError('Invalid idempotency key');
    this.sweep();
    const keyHash = stableHash(key);
    const keyFingerprint = stableHash({ key });
    const destination = this.path(keyHash);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(destination, 'wx', 0o600);
      const now = this.now();
      const record: IdempotencyRecord = {
        version: 1,
        keyHash,
        keyFingerprint,
        binding: { ...binding },
        idempotent,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      writeFileSync(descriptor, JSON.stringify(record), 'utf8');
      return { kind: 'claimed', keyHash };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const record = this.read(keyHash);
      if (record.keyFingerprint !== keyFingerprint || !sameBinding(record.binding, binding)) {
        return { kind: 'mismatch' };
      }
      if (record.status === 'completed') {
        return idempotent && record.idempotent
          ? { kind: 'cached', response: record.response }
          : { kind: 'duplicate', pending: false, idempotent: record.idempotent };
      }
      if (idempotent && record.idempotent && this.now() - record.updatedAt > this.pendingRetryMs) {
        record.updatedAt = this.now();
        this.write(record);
        return { kind: 'claimed', keyHash };
      }
      return { kind: 'duplicate', pending: true, idempotent: record.idempotent };
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  complete(keyHash: string, response: unknown): void {
    const record = this.read(keyHash);
    record.status = 'completed';
    record.updatedAt = this.now();
    if (record.idempotent) record.response = response;
    this.write(record);
  }

  sweep(): number {
    let removed = 0;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.directory, name);
      try {
        if (this.now() - statSync(path).mtimeMs <= this.ttlMs) continue;
        unlinkSync(path);
        removed += 1;
      } catch {
        // Concurrent cleanup won the race.
      }
    }
    return removed;
  }

  private read(keyHash: string): IdempotencyRecord {
    const record = JSON.parse(readFileSync(this.path(keyHash), 'utf8')) as IdempotencyRecord;
    if (
      record.version !== 1 ||
      record.keyHash !== keyHash ||
      !record.binding ||
      (record.status !== 'pending' && record.status !== 'completed')
    ) {
      throw new Error('Invalid idempotency record');
    }
    return record;
  }

  private write(record: IdempotencyRecord): void {
    const destination = this.path(record.keyHash);
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, destination);
  }

  private path(keyHash: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(keyHash)) throw new TypeError('Invalid key hash');
    return join(this.directory, `${keyHash}.json`);
  }
}
