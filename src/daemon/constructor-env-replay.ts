import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PHOTON_DIR, getDataRoot } from '@portel/photon-core';
import { resolvePhotonNamespace } from '../context-store.js';

const STORE_VERSION = 1;
const ALG = 'aes-256-gcm';

export interface ConstructorEnvReplayIdentity {
  baseDir: string;
  namespace: string;
  photonName: string;
  pathHash: string;
}

interface EncryptedValue {
  alg: typeof ALG;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface ReplayEnvelope {
  version: typeof STORE_VERSION;
  identity: ConstructorEnvReplayIdentity;
  values: Record<string, EncryptedValue>;
  updatedAt: string;
}

export function createConstructorEnvReplayIdentity(
  baseDir: string,
  photonName: string,
  photonPath: string
): ConstructorEnvReplayIdentity {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(photonPath);
  let realPath = resolvedPath;
  try {
    realPath = fs.realpathSync(resolvedPath);
  } catch {
    // The caller may be reporting a source path before it exists. Fall back
    // to the absolute path so identity construction remains deterministic.
  }

  return {
    baseDir: resolvedBase,
    namespace: resolvePhotonNamespace(resolvedBase, resolvedPath) || 'local',
    photonName,
    pathHash: crypto.createHash('sha256').update(realPath).digest('hex'),
  };
}

export class ConstructorEnvReplayStore {
  private readonly rootDir: string;
  private readonly secretPath: string;
  private secret?: Buffer;

  constructor(photonHome: string = DEFAULT_PHOTON_DIR) {
    const daemonDir = path.join(getDataRoot(photonHome), 'daemon');
    this.rootDir = path.join(daemonDir, 'constructor-env');
    this.secretPath = path.join(daemonDir, 'constructor-env.secret');
  }

  resolve(identity: ConstructorEnvReplayIdentity, envVarName: string): string | undefined {
    const values = this.readSafe(identity);
    return values?.[envVarName];
  }

  write(identity: ConstructorEnvReplayIdentity, values: Record<string, string>): void {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;

    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.rootDir, 0o700);

    const merged = { ...(this.readSafe(identity) ?? {}) };
    for (const [key, value] of entries) {
      merged[key] = value;
    }

    const encrypted: Record<string, EncryptedValue> = {};
    for (const [key, value] of Object.entries(merged)) {
      encrypted[key] = this.encrypt(value);
    }

    const envelope: ReplayEnvelope = {
      version: STORE_VERSION,
      identity,
      values: encrypted,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(this.pathFor(identity), JSON.stringify(envelope, null, 2), {
      mode: 0o600,
    });
  }

  getSnapshotPath(identity: ConstructorEnvReplayIdentity): string {
    return this.pathFor(identity);
  }

  private readSafe(identity: ConstructorEnvReplayIdentity): Record<string, string> | undefined {
    try {
      return this.read(identity);
    } catch {
      return undefined;
    }
  }

  private read(identity: ConstructorEnvReplayIdentity): Record<string, string> | undefined {
    const filePath = this.pathFor(identity);
    if (!fs.existsSync(filePath)) return undefined;

    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ReplayEnvelope;
    if (envelope.version !== STORE_VERSION) return undefined;
    if (!sameIdentity(envelope.identity, identity)) return undefined;

    const values: Record<string, string> = {};
    for (const [key, encrypted] of Object.entries(envelope.values ?? {})) {
      if (encrypted.alg !== ALG) return undefined;
      values[key] = this.decrypt(encrypted);
    }
    return values;
  }

  private pathFor(identity: ConstructorEnvReplayIdentity): string {
    const identityHash = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return path.join(this.rootDir, `${identityHash}.json`);
  }

  private getSecret(): Buffer {
    if (this.secret) return this.secret;

    fs.mkdirSync(path.dirname(this.secretPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(this.secretPath), 0o700);

    try {
      const raw = fs.readFileSync(this.secretPath, 'utf-8').trim();
      const secret = Buffer.from(raw, 'base64');
      if (secret.length === 32) {
        this.secret = secret;
        return secret;
      }
    } catch {
      // Missing or unreadable secret: generate below.
    }

    const secret = crypto.randomBytes(32);
    try {
      fs.writeFileSync(this.secretPath, secret.toString('base64'), {
        mode: 0o600,
        flag: 'wx',
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        const raw = fs.readFileSync(this.secretPath, 'utf-8').trim();
        const existing = Buffer.from(raw, 'base64');
        if (existing.length === 32) {
          this.secret = existing;
          return existing;
        }
      }
      throw err;
    }
    fs.chmodSync(this.secretPath, 0o600);
    this.secret = secret;
    return secret;
  }

  private encrypt(value: string): EncryptedValue {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, this.getSecret(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
    return {
      alg: ALG,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(value: EncryptedValue): string {
    const decipher = crypto.createDecipheriv(
      ALG,
      this.getSecret(),
      Buffer.from(value.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  }
}

function sameIdentity(a: ConstructorEnvReplayIdentity, b: ConstructorEnvReplayIdentity): boolean {
  return (
    a.baseDir === b.baseDir &&
    a.namespace === b.namespace &&
    a.photonName === b.photonName &&
    a.pathHash === b.pathHash
  );
}
