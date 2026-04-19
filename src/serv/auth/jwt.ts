/**
 * JWT Token Utilities
 *
 * Handles JWT generation and validation for SERV sessions
 * Uses HMAC-SHA256 for simplicity; can be upgraded to RSA/EC for production
 */

import {
  createHash,
  createHmac,
  createSign,
  createVerify,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from 'crypto';
import type { Session, SessionToken, Tenant, User, Membership } from '../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

export interface JwtConfig {
  /**
   * Signing secret for HMAC algorithms (HS256/384/512). Min 32 bytes
   * recommended. Ignored when algorithm is an asymmetric variant.
   */
  secret: string;
  /** Token issuer (e.g., 'https://serv.example.com') */
  issuer: string;
  /** Default token expiry in seconds */
  expirySeconds: number;
  /**
   * Algorithm to use. Asymmetric variants require `privateKey` (PEM) for
   * signing and optionally `publicKey` (PEM) for verification. If the
   * public key is omitted it's derived from the private key.
   */
  algorithm: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'ES256';
  /** PEM-encoded private key. Required for RS256/ES256. */
  privateKey?: string;
  /** PEM-encoded public key; derived from privateKey if omitted. */
  publicKey?: string;
  /** Key identifier for `kid` header. Optional; useful during key rotation. */
  kid?: string;
}

const DEFAULT_CONFIG: Partial<JwtConfig> = {
  expirySeconds: 15 * 60, // 15 minutes
  algorithm: 'HS256',
};

function isAsymmetric(alg: JwtConfig['algorithm']): boolean {
  return alg === 'RS256' || alg === 'ES256';
}

// ============================================================================
// JWT Implementation
// ============================================================================

export class JwtService {
  private config: JwtConfig;
  private privateKey?: KeyObject;
  private publicKey?: KeyObject;

  constructor(config: Partial<JwtConfig> & { issuer: string; secret?: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config, secret: config.secret ?? '' } as JwtConfig;

    if (isAsymmetric(this.config.algorithm)) {
      if (!this.config.privateKey) {
        throw new Error(`JWT algorithm ${this.config.algorithm} requires a privateKey`);
      }
      this.privateKey = createPrivateKey(this.config.privateKey);
      this.publicKey = this.config.publicKey
        ? createPublicKey(this.config.publicKey)
        : createPublicKey(this.privateKey);
    } else if (this.config.secret.length < 32) {
      console.warn('JWT secret is less than 32 characters. Consider using a stronger secret.');
    }
  }

  /**
   * Export the public JWK for publication at `/.well-known/jwks.json`.
   * Only meaningful for asymmetric algorithms.
   */
  exportJwk(): Record<string, unknown> | null {
    if (!this.publicKey) return null;
    const jwk = this.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    jwk.alg = this.config.algorithm;
    jwk.use = 'sig';
    if (this.config.kid) jwk.kid = this.config.kid;
    return jwk;
  }

  /**
   * Generate an OAuth access token JWT for the token endpoint.
   *
   * This is a lower-level variant of `generateSessionToken` that accepts
   * the minimal fields needed for an OAuth 2.1 bearer token: `sub`, `scope`,
   * `client_id`, `tenant_id`, plus a TTL. No `Session` object required.
   */
  generateAccessToken(args: {
    sub: string;
    tenantId: string;
    scope: string;
    clientId: string;
    expiresInSeconds: number;
    now?: Date;
    /** Optional jti; random if omitted. */
    jti?: string;
  }): string {
    const nowSec = Math.floor((args.now?.getTime() ?? Date.now()) / 1000);
    const payload: Record<string, unknown> = {
      iss: this.config.issuer,
      sub: args.sub,
      aud: `${this.config.issuer}/mcp`,
      exp: nowSec + args.expiresInSeconds,
      iat: nowSec,
      jti: args.jti ?? randomBytes(16).toString('base64url'),
      tenant_id: args.tenantId,
      client_id: args.clientId,
      scope: args.scope,
    };
    return this.sign(payload);
  }

  /**
   * Sign a custom payload (used by RFC 8693 token exchange, where the
   * caller fully controls the claim set including `aud`, `act`, etc.).
   * Caller is responsible for including `iss`, `exp`, `iat`.
   */
  exchangeSign(payload: Record<string, unknown>): string {
    return this.sign(payload);
  }

  /**
   * Generate an OpenID Connect id_token per OIDC Core §3.1.3.7.
   *
   * Identity assertion about the end-user. Issued when `openid` scope is
   * granted at /token. Signed with the same key/algorithm as access tokens.
   * `azp` (authorized party) claim identifies the client that requested it.
   */
  generateIdToken(args: {
    sub: string;
    tenantId: string;
    clientId: string;
    expiresInSeconds: number;
    now?: Date;
    /** Optional extra claims (email, name, etc.) surfaced from the profile. */
    profile?: Record<string, unknown>;
    /** Optional nonce echoed from the authorize request. */
    nonce?: string;
  }): string {
    const nowSec = Math.floor((args.now?.getTime() ?? Date.now()) / 1000);
    const payload: Record<string, unknown> = {
      iss: this.config.issuer,
      sub: args.sub,
      aud: args.clientId, // RFC: id_token audience is the client, not the resource
      azp: args.clientId,
      exp: nowSec + args.expiresInSeconds,
      iat: nowSec,
      tenant_id: args.tenantId,
      ...(args.profile ?? {}),
    };
    if (args.nonce) payload.nonce = args.nonce;
    return this.sign(payload);
  }

  /**
   * Generate a session token
   */
  generateSessionToken(
    session: Session,
    tenant: Tenant,
    user?: User,
    membership?: Membership
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.floor(session.expiresAt.getTime() / 1000);

    const payload: Record<string, unknown> = {
      // Standard claims
      iss: this.config.issuer,
      sub: user?.id ?? `anonymous:${session.id}`,
      aud: this.buildAudience(tenant),
      exp,
      iat: now,
      jti: session.id,

      // SERV claims
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      user_id: user?.id,
      role: membership?.role,
      mcp_session_id: session.id,
    };

    return this.sign(payload);
  }

  /**
   * Verify and decode a token
   */
  verifySessionToken(token: string): SessionToken | null {
    try {
      const payload = this.verify(token);
      if (!payload) return null;

      // Validate required claims
      if (!payload.iss || !payload.sub || !payload.aud || !payload.exp || !payload.jti) {
        return null;
      }

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      const exp = payload.exp as number;
      if (exp < now) {
        return null;
      }

      // Check issuer
      if (payload.iss !== this.config.issuer) {
        return null;
      }

      return payload as unknown as SessionToken;
    } catch {
      return null; // invalid or expired token
    }
  }

  /**
   * Decode without verification (for debugging)
   */
  decode(token: string): SessionToken | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(base64UrlDecode(parts[1]));
      return payload as SessionToken;
    } catch {
      return null; // malformed token
    }
  }

  /**
   * Build audience URI for a tenant
   */
  private buildAudience(tenant: Tenant): string {
    if (tenant.settings.customDomain) {
      return `https://${tenant.settings.customDomain}/mcp`;
    }
    return `${this.config.issuer}/tenant/${tenant.slug}/mcp`;
  }

  /**
   * Sign a payload and return JWT
   */
  private sign(payload: Record<string, unknown>): string {
    const header: Record<string, unknown> = {
      alg: this.config.algorithm,
      typ: 'JWT',
    };
    if (this.config.kid) header.kid = this.config.kid;

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));

    const signatureInput = `${headerB64}.${payloadB64}`;
    const signature = this.createSignature(signatureInput);

    return `${signatureInput}.${signature}`;
  }

  /**
   * Verify a JWT and return payload
   */
  private verify(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signatureInput = `${headerB64}.${payloadB64}`;

    if (isAsymmetric(this.config.algorithm)) {
      if (!this.publicKey) return null;
      try {
        const verifier = createVerify(this.hashName());
        verifier.update(signatureInput);
        verifier.end();
        const raw = Buffer.from(signatureB64, 'base64url');
        // ES256/384/512 carry IEEE-P1363 r||s per RFC 7518 §3.4. Node's verifier
        // expects DER internally on some runtimes (Bun in particular), so we
        // convert P1363→DER before calling verify. `dsaEncoding: 'ieee-p1363'`
        // option is Node-only and errors on Bun.
        const signature = this.config.algorithm === 'ES256' ? p1363ToDer(raw) : raw;
        const ok = verifier.verify(this.publicKey, signature);
        if (!ok) return null;
      } catch {
        return null;
      }
    } else {
      const expectedSignature = this.createSignature(signatureInput);
      const signatureBuffer = Buffer.from(signatureB64, 'base64url');
      const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
      if (signatureBuffer.length !== expectedBuffer.length) return null;
      if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
    }

    try {
      return JSON.parse(base64UrlDecode(payloadB64));
    } catch {
      return null;
    }
  }

  /**
   * Create JWS signature. HMAC for symmetric algs, RSA-PSS / ECDSA for asymmetric.
   */
  private createSignature(input: string): string {
    if (isAsymmetric(this.config.algorithm)) {
      if (!this.privateKey) {
        throw new Error('asymmetric JWT signing requires privateKey');
      }
      const signer = createSign(this.hashName());
      signer.update(input);
      signer.end();
      // Node.js signs ECDSA with DER by default. RFC 7518 §3.4 requires
      // the IEEE-P1363 r||s concatenation for JWS, so we convert after
      // signing. The `dsaEncoding: 'ieee-p1363'` sign option would work
      // on Node but throws on Bun ("Length out of range"), so we do the
      // conversion manually for runtime-agnosticism.
      const der = signer.sign(this.privateKey);
      if (this.config.algorithm === 'ES256') {
        return derToP1363(der, 32).toString('base64url');
      }
      return der.toString('base64url');
    }
    const hmac = createHmac(this.hashName(), this.config.secret);
    hmac.update(input);
    return hmac.digest('base64url');
  }

  private hashName(): 'sha256' | 'sha384' | 'sha512' {
    switch (this.config.algorithm) {
      case 'HS384':
        return 'sha384';
      case 'HS512':
        return 'sha512';
      case 'HS256':
      case 'RS256':
      case 'ES256':
      default:
        return 'sha256';
    }
  }
}

// ============================================================================
// PKCE Utilities
// ============================================================================

/**
 * Generate a code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate a code challenge from a verifier (RFC 7636 §4.2, S256 method)
 * code_challenge = BASE64URL-ENCODE(SHA256(code_verifier))
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Verify a code verifier against a challenge
 */
export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const expected = generateCodeChallenge(verifier);
  return expected === challenge;
}

// ============================================================================
// OAuth State Utilities
// ============================================================================

export interface OAuthState {
  sessionId: string;
  elicitationId: string;
  photonId: string;
  provider: string;
  nonce: string;
  timestamp: number;
}

/**
 * Encode OAuth state for authorization request
 */
export function encodeOAuthState(state: OAuthState, secret: string): string {
  const payload = JSON.stringify(state);
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const signature = hmac.digest('base64url');

  return base64UrlEncode(`${payload}|${signature}`);
}

/**
 * Decode and verify OAuth state
 */
export function decodeOAuthState(encoded: string, secret: string): OAuthState | null {
  try {
    const decoded = base64UrlDecode(encoded);
    const [payload, signature] = decoded.split('|');

    if (!payload || !signature) return null;

    // Verify signature
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('base64url');

    if (signature !== expectedSignature) return null;

    const state = JSON.parse(payload) as OAuthState;

    // Check timestamp (5 minute max age)
    if (Date.now() - state.timestamp > 5 * 60 * 1000) {
      return null;
    }

    return state;
  } catch {
    return null; // corrupt or missing state file
  }
}

// ============================================================================
// Base64URL Utilities
// ============================================================================

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

// ============================================================================
// ECDSA signature encoding (DER ↔ IEEE-P1363)
// ============================================================================

/**
 * Convert a DER-encoded ECDSA signature (Node's default output from
 * `createSign().sign()`) into the IEEE-P1363 r||s encoding required by
 * RFC 7518 §3.4 for JWS ES256/ES384/ES512.
 *
 * DER layout: 0x30 [totalLen] 0x02 [rLen] [r...] 0x02 [sLen] [s...]
 * r and s are encoded as signed integers — DER prepends 0x00 if the high
 * bit of the first byte would otherwise make them negative. P1363 strips
 * that padding and left-zero-pads each component to `componentLen` bytes.
 */
function derToP1363(der: Buffer, componentLen: number): Buffer {
  if (der[0] !== 0x30) {
    throw new Error('invalid DER signature: missing SEQUENCE');
  }
  // Skip SEQUENCE header (1-byte length for signatures we produce).
  let offset = 2;
  if ((der[1] & 0x80) !== 0) {
    offset += der[1] & 0x7f;
  }
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) {
      throw new Error('invalid DER signature: expected INTEGER');
    }
    const len = der[offset + 1];
    const start = offset + 2;
    let value = der.subarray(start, start + len);
    offset = start + len;
    // Strip leading 0x00 padding that keeps DER integers positive.
    while (value.length > 1 && value[0] === 0x00) {
      value = value.subarray(1);
    }
    if (value.length > componentLen) {
      throw new Error(`ECDSA component overflow: ${value.length} > ${componentLen}`);
    }
    return value;
  };
  const r = readInt();
  const s = readInt();
  const out = Buffer.alloc(componentLen * 2);
  r.copy(out, componentLen - r.length);
  s.copy(out, componentLen * 2 - s.length);
  return out;
}

/**
 * Convert a P1363 r||s signature into DER for Node's `verifier.verify()`.
 * Inverse of `derToP1363`. Used on the verify path so signatures received
 * in spec-compliant JWS form can still be handed to Node's DER-only API.
 */
function p1363ToDer(p1363: Buffer): Buffer {
  if (p1363.length % 2 !== 0) {
    throw new Error('invalid P1363 signature: odd length');
  }
  const half = p1363.length / 2;
  const encodeInt = (value: Buffer): Buffer => {
    // Strip leading zeros (but leave at least one byte).
    let v = value;
    while (v.length > 1 && v[0] === 0x00) {
      v = v.subarray(1);
    }
    // If high bit is set, prepend 0x00 so DER reads it as positive.
    if ((v[0] & 0x80) !== 0) {
      v = Buffer.concat([Buffer.from([0x00]), v]);
    }
    return Buffer.concat([Buffer.from([0x02, v.length]), v]);
  };
  const r = encodeInt(p1363.subarray(0, half));
  const s = encodeInt(p1363.subarray(half));
  const body = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/** Internal exports for tests only. */
export const __test_ecdsa__ = { derToP1363, p1363ToDer };

// ============================================================================
// Factory Function
// ============================================================================

let jwtServiceInstance: JwtService | null = null;

export function getJwtService(
  config?: Partial<JwtConfig> & { secret: string; issuer: string }
): JwtService {
  if (jwtServiceInstance) return jwtServiceInstance;
  if (!config) {
    throw new Error('JWT service not initialized. Call with config first.');
  }
  jwtServiceInstance = new JwtService(config);
  return jwtServiceInstance;
}

export function initJwtService(
  config: Partial<JwtConfig> & { secret: string; issuer: string }
): JwtService {
  if (jwtServiceInstance) return jwtServiceInstance;
  jwtServiceInstance = new JwtService(config);
  return jwtServiceInstance;
}

/** Reset the singleton — for testing only. */
export function resetJwtService(): void {
  jwtServiceInstance = null;
}
