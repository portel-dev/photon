/**
 * Authentication Middleware
 *
 * Validates Bearer tokens and attaches session to request context
 */

import type {
  Session,
  SessionToken,
  User,
  Membership,
  RequestContext,
  Tenant,
} from '../types/index.js';
import type { SessionStore } from '../session/store.js';
import type { JwtService } from '../auth/jwt.js';

// ============================================================================
// User Store Interface
// ============================================================================

export interface UserStore {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export interface MembershipStore {
  find(tenantId: string, userId: string): Promise<Membership | null>;
}

// ============================================================================
// Auth Middleware Configuration
// ============================================================================

export interface AuthMiddlewareConfig {
  jwtService: JwtService;
  sessionStore: SessionStore;
  userStore?: UserStore;
  membershipStore?: MembershipStore;
  /** Whether to allow anonymous access (no token) */
  allowAnonymous?: boolean;
  /** Required role(s) for access */
  requiredRoles?: string[];
}

// ============================================================================
// Auth Result
// ============================================================================

export interface AuthResult {
  success: boolean;
  context?: RequestContext;
  error?: {
    code: number;
    message: string;
    wwwAuthenticate?: string;
  };
}

// ============================================================================
// Auth Middleware
// ============================================================================

export class AuthMiddleware {
  private config: AuthMiddlewareConfig;

  constructor(config: AuthMiddlewareConfig) {
    this.config = config;
  }

  /**
   * Authenticate a request
   */
  async authenticate(tenant: Tenant, authHeader?: string): Promise<AuthResult> {
    // Extract token from Authorization header
    const token = this.extractBearerToken(authHeader);

    // No token - check if anonymous is allowed
    if (!token) {
      if (this.config.allowAnonymous) {
        return {
          success: true,
          context: { tenant },
        };
      }

      return {
        success: false,
        error: {
          code: 401,
          message: 'Authorization required',
          wwwAuthenticate: this.buildWwwAuthenticate(tenant),
        },
      };
    }

    // Verify JWT
    const payload = this.config.jwtService.verifySessionToken(token);
    if (!payload) {
      return {
        success: false,
        error: {
          code: 401,
          message: 'Invalid or expired token',
          wwwAuthenticate: this.buildWwwAuthenticate(tenant, 'invalid_token'),
        },
      };
    }

    // Verify tenant matches
    if (payload.tenant_id !== tenant.id) {
      return {
        success: false,
        error: {
          code: 403,
          message: 'Token not valid for this tenant',
        },
      };
    }

    // Get session from store
    const session = await this.config.sessionStore.get(payload.mcp_session_id);
    if (!session) {
      return {
        success: false,
        error: {
          code: 401,
          message: 'Session expired or invalid',
          wwwAuthenticate: this.buildWwwAuthenticate(tenant, 'invalid_token'),
        },
      };
    }

    // Touch session for sliding expiration
    await this.config.sessionStore.touch(session.id);

    // Build context
    const context: RequestContext = {
      tenant,
      session,
    };

    // Load user if available
    if (payload.user_id && this.config.userStore) {
      const user = await this.config.userStore.findById(payload.user_id);
      if (user) {
        context.user = user;

        // Load membership
        if (this.config.membershipStore) {
          const membership = await this.config.membershipStore.find(tenant.id, user.id);
          if (membership) {
            context.membership = membership;
          }
        }
      }
    }

    // Check required roles
    if (this.config.requiredRoles && this.config.requiredRoles.length > 0) {
      if (!context.membership || !this.config.requiredRoles.includes(context.membership.role)) {
        return {
          success: false,
          error: {
            code: 403,
            message: 'Insufficient permissions',
          },
        };
      }
    }

    return {
      success: true,
      context,
    };
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractBearerToken(header?: string): string | null {
    if (!header) return null;

    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
  }

  /**
   * Build WWW-Authenticate header value
   */
  private buildWwwAuthenticate(tenant: Tenant, error?: string): string {
    const parts = [
      'Bearer',
      `realm="${tenant.slug}"`,
      'resource_metadata="/.well-known/oauth-protected-resource"',
    ];

    if (error) {
      parts.push(`error="${error}"`);
    }

    return parts.join(', ');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a role has required permission
 */
export function hasPermission(role: string, requiredRoles: string[]): boolean {
  // Role hierarchy: owner > admin > member > viewer
  const hierarchy: Record<string, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1,
  };

  const userLevel = hierarchy[role] ?? 0;
  const minRequired = Math.min(...requiredRoles.map((r) => hierarchy[r] ?? 999));

  return userLevel >= minRequired;
}

/**
 * Parse Mcp-Session-Id header
 */
export function parseMcpSessionId(header?: string): string | null {
  if (!header) return null;
  return header.trim() || null;
}

/**
 * Generate client fingerprint from request
 */
export function generateClientFingerprint(request: {
  headers?: Record<string, string>;
  ip?: string;
}): string {
  const parts = [
    request.headers?.['user-agent'] ?? '',
    request.headers?.['accept-language'] ?? '',
    request.ip ?? '',
  ];

  // Simple hash of concatenated parts
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return Math.abs(hash).toString(36);
}
