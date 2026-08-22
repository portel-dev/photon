/**
 * Transport-neutral passwordless authentication primitives.
 *
 * Photon owns the challenge lifecycle. A Photon author owns delivery by
 * implementing `sendCode` (email, SMS, WhatsApp, or another channel).
 * The callback receives the code exactly once and must never be exposed as an
 * MCP tool or returned to the browser.
 */

export type AuthCodePurpose = 'sign-in' | 'passkey-enrollment' | 'account-recovery';

export interface AuthCodeDeliveryRequest {
  /** Opaque challenge identifier for delivery/audit correlation. */
  challengeId: string;
  /** User destination as supplied by the Photon login flow. */
  destination: string;
  /** One-time code. Delivery adapters must not log or persist it. */
  code: string;
  purpose: AuthCodePurpose;
  expiresAt: Date;
}

/** The familiar callback/adapter shape used by Photon login integrations. */
export interface AuthCodeDeliveryAdapter {
  sendCode(request: AuthCodeDeliveryRequest): Promise<void> | void;
}

export interface AuthChallenge {
  id: string;
  destination: string;
  purpose: AuthCodePurpose;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

export interface AuthChallengeStore {
  save(challenge: AuthChallenge): Promise<void>;
  find(id: string): Promise<AuthChallenge | null>;
  /** Atomically consume a valid challenge. */
  consume(id: string): Promise<AuthChallenge | null>;
  /** Increment attempts and return the updated challenge, if it exists. */
  incrementAttempts(id: string): Promise<AuthChallenge | null>;
  delete(id: string): Promise<boolean>;
  sweep(now?: Date): Promise<number>;
}

export type AuthCodeVerificationFailure =
  | 'not_found'
  | 'expired'
  | 'too_many_attempts'
  | 'invalid_code';

export type AuthCodeVerification =
  | { ok: true; challenge: AuthChallenge }
  | { ok: false; reason: AuthCodeVerificationFailure };

export interface AuthCodeServiceOptions {
  adapter: AuthCodeDeliveryAdapter;
  store?: AuthChallengeStore;
  /** Secret used as a server-side pepper when hashing short numeric codes. */
  secret: string;
  now?: () => Date;
  ttlSeconds?: number;
  maxAttempts?: number;
  codeLength?: number;
}

const DEFAULT_TTL_SECONDS = 10 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CODE_LENGTH = 6;

/**
 * Minimal in-memory store for local development and unit tests.
 * Production adapters should use the deployment's durable storage.
 */
export class MemoryAuthChallengeStore implements AuthChallengeStore {
  private readonly challenges = new Map<string, AuthChallenge>();

  async save(challenge: AuthChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async find(id: string): Promise<AuthChallenge | null> {
    return this.challenges.get(id) ?? null;
  }

  async consume(id: string): Promise<AuthChallenge | null> {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    this.challenges.delete(id);
    return challenge;
  }

  async incrementAttempts(id: string): Promise<AuthChallenge | null> {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    const updated = { ...challenge, attempts: challenge.attempts + 1 };
    this.challenges.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.challenges.delete(id);
  }

  async sweep(now: Date = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        this.challenges.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

/**
 * Generates and verifies one-time authentication codes without choosing a
 * delivery channel. This is deliberately independent of OAuth and WebAuthn:
 * a successful verification creates a bootstrap identity, after which the
 * caller may register a passkey or continue the OAuth flow.
 */
export class AuthCodeService {
  private readonly adapter: AuthCodeDeliveryAdapter;
  private readonly store: AuthChallengeStore;
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;
  private readonly codeLength: number;

  constructor(options: AuthCodeServiceOptions) {
    if (!options.secret || options.secret.length < 16) {
      throw new Error('AuthCodeService requires a secret of at least 16 characters.');
    }
    this.adapter = options.adapter;
    this.store = options.store ?? new MemoryAuthChallengeStore();
    this.secret = options.secret;
    this.now = options.now ?? (() => new Date());
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.codeLength = options.codeLength ?? DEFAULT_CODE_LENGTH;
    if (!Number.isInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error('AuthCodeService ttlSeconds must be a positive integer.');
    }
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('AuthCodeService maxAttempts must be a positive integer.');
    }
    if (!Number.isInteger(this.codeLength) || this.codeLength < 4 || this.codeLength > 9) {
      throw new Error('AuthCodeService codeLength must be an integer between 4 and 9.');
    }
  }

  async requestCode(input: {
    destination: string;
    purpose: AuthCodePurpose;
  }): Promise<{ challengeId: string; expiresAt: Date }> {
    const destination = input.destination.trim();
    if (!destination) throw new Error('Auth code destination is required.');

    const challengeId = randomToken(24);
    const code = generateNumericCode(this.codeLength);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlSeconds * 1000);
    const challenge: AuthChallenge = {
      id: challengeId,
      destination,
      purpose: input.purpose,
      codeHash: await hashCode(challengeId, code, this.secret),
      createdAt,
      expiresAt,
      attempts: 0,
      maxAttempts: this.maxAttempts,
    };

    await this.store.save(challenge);
    try {
      await this.adapter.sendCode({
        challengeId,
        destination,
        code,
        purpose: input.purpose,
        expiresAt,
      });
    } catch (error) {
      // A code that could not be delivered must not remain usable.
      await this.store.delete(challengeId);
      throw error;
    }

    return { challengeId, expiresAt };
  }

  async verifyCode(challengeId: string, code: string): Promise<AuthCodeVerification> {
    const challenge = await this.store.find(challengeId);
    if (!challenge) return { ok: false, reason: 'not_found' };
    if (challenge.expiresAt.getTime() <= this.now().getTime()) {
      await this.store.delete(challengeId);
      return { ok: false, reason: 'expired' };
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      await this.store.delete(challengeId);
      return { ok: false, reason: 'too_many_attempts' };
    }

    const updated = await this.store.incrementAttempts(challengeId);
    if (!updated || updated.attempts > updated.maxAttempts) {
      await this.store.delete(challengeId);
      return { ok: false, reason: 'too_many_attempts' };
    }

    const expected = await hashCode(challengeId, code.trim(), this.secret);
    if (!constantTimeEqual(expected, challenge.codeHash)) {
      if (updated.attempts >= updated.maxAttempts) await this.store.delete(challengeId);
      return { ok: false, reason: 'invalid_code' };
    }

    const consumed = await this.store.consume(challengeId);
    return consumed ? { ok: true, challenge: consumed } : { ok: false, reason: 'not_found' };
  }

  async sweep(now: Date = this.now()): Promise<number> {
    return this.store.sweep(now);
  }
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  getWebCrypto().getRandomValues(bytes);
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

function generateNumericCode(length: number): string {
  const range = 10 ** length;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buffer = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    getWebCrypto().getRandomValues(buffer);
    value = buffer[0];
  }
  return String(value % range).padStart(length, '0');
}

async function hashCode(challengeId: string, code: string, secret: string): Promise<string> {
  const input = new TextEncoder().encode(`${secret}:${challengeId}:${code}`);
  const digest = await getWebCrypto().subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getWebCrypto(): {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: {
    digest(algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>;
  };
} {
  const cryptoApi = (globalThis as { crypto?: unknown }).crypto;
  if (!cryptoApi || typeof cryptoApi !== 'object') {
    throw new Error('Web Crypto is required for Photon passwordless authentication.');
  }
  return cryptoApi as ReturnType<typeof getWebCrypto>;
}
