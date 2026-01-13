/**
 * SERV Core Types
 *
 * Type definitions for the hosted Photon MCP platform
 */

// ============================================================================
// Tenant Types
// ============================================================================

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  region: string;
  plan: 'free' | 'pro' | 'enterprise';
  encryptionKeyId: string;
  settings: TenantSettings;
  createdAt: Date;
}

export interface TenantSettings {
  allowAnonymousUsers: boolean;
  sponsoredPhotons: string[];
  customDomain?: string;
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
}

export interface Membership {
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'pending' | 'suspended';
  invitedBy?: string;
  joinedAt: Date;
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: string;
  tenantId: string;
  userId?: string;
  clientId: string;
  clientFingerprint?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

export interface SessionToken {
  // Standard JWT claims
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;

  // SERV claims
  tenant_id: string;
  tenant_slug: string;
  user_id?: string;
  role?: string;
  mcp_session_id: string;
}

export interface SessionCreateOptions {
  tenantId: string;
  userId?: string;
  clientId: string;
  clientFingerprint?: string;
  ttlSeconds?: number;
}

// ============================================================================
// OAuth Types
// ============================================================================

export interface OAuthProvider {
  id: string;
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
}

export interface PhotonGrant {
  id: string;
  tenantId: string;
  userId?: string;
  photonId: string;
  provider: string;
  scopes: string[];
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Elicitation Types
// ============================================================================

export interface ElicitationRequest {
  id: string;
  sessionId: string;
  photonId: string;
  provider: string;
  requiredScopes: string[];
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
  redirectUri: string;
  codeVerifier?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ElicitationError {
  code: number;
  message: string;
  data: {
    url: string;
    elicitationId: string;
    provider: string;
    scopes: string[];
  };
}

// JSONRPC error code for URL elicitation
export const URL_ELICITATION_ERROR_CODE = -32001;

// ============================================================================
// Protected Resource Metadata (RFC 9728)
// ============================================================================

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported?: string[];
  resource_signing_alg_values_supported?: string[];
  resource_documentation?: string;
}

// ============================================================================
// Authorization Server Metadata (RFC 8414)
// ============================================================================

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

// ============================================================================
// Request Context
// ============================================================================

export interface RequestContext {
  tenant: Tenant;
  session?: Session;
  user?: User;
  membership?: Membership;
}
