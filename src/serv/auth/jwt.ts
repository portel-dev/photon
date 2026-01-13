/**
 * JWT Token Utilities
 *
 * Handles JWT generation and validation for SERV sessions
 * Uses HMAC-SHA256 for simplicity; can be upgraded to RSA/EC for production
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Session, SessionToken, Tenant, User, Membership } from '../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

export interface JwtConfig {
  /** Secret key for signing tokens (min 32 bytes recommended) */
  secret: string;
  /** Token issuer (e.g., 'https://serv.example.com') */
  issuer: string;
  /** Default token expiry in seconds */
  expirySeconds: number;
  /** Algorithm to use */
  algorithm: 'HS256' | 'HS384' | 'HS512';
}

const DEFAULT_CONFIG: Partial<JwtConfig> = {
  expirySeconds: 15 * 60, // 15 minutes
  algorithm: 'HS256',
};

// ============================================================================
// JWT Implementation
// ============================================================================

export class JwtService {
  private config: JwtConfig;

  constructor(config: Partial<JwtConfig> & { secret: string; issuer: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as JwtConfig;

    if (this.config.secret.length < 32) {
      console.warn('JWT secret is less than 32 characters. Consider using a stronger secret.');
    }
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
      return null;
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
      return null;
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
    const header = {
      alg: this.config.algorithm,
      typ: 'JWT',
    };

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

    // Verify signature
    const signatureInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = this.createSignature(signatureInput);

    // Timing-safe comparison
    const signatureBuffer = Buffer.from(signatureB64, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    // Parse payload
    try {
      return JSON.parse(base64UrlDecode(payloadB64));
    } catch {
      return null;
    }
  }

  /**
   * Create HMAC signature
   */
  private createSignature(input: string): string {
    const algorithm = this.config.algorithm === 'HS256' ? 'sha256'
      : this.config.algorithm === 'HS384' ? 'sha384'
      : 'sha512';

    const hmac = createHmac(algorithm, this.config.secret);
    hmac.update(input);
    return hmac.digest('base64url');
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
 * Generate a code challenge from a verifier
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHmac('sha256', '').update(verifier).digest();
  return hash.toString('base64url');
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
    return null;
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
// Factory Function
// ============================================================================

let jwtServiceInstance: JwtService | null = null;

export function getJwtService(config?: Partial<JwtConfig> & { secret: string; issuer: string }): JwtService {
  if (!jwtServiceInstance) {
    if (!config) {
      throw new Error('JWT service not initialized. Call with config first.');
    }
    jwtServiceInstance = new JwtService(config);
  }
  return jwtServiceInstance;
}

export function initJwtService(config: Partial<JwtConfig> & { secret: string; issuer: string }): JwtService {
  jwtServiceInstance = new JwtService(config);
  return jwtServiceInstance;
}
