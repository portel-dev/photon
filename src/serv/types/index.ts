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
  /**
   * Hostnames this tenant accepts CIMD client_ids from. Supports exact match
   * (`claude.ai`) or leading wildcard (`*.claude.ai`). Empty / undefined = allow all.
   * Tightening this is the primary defense against CIMD phishing.
   */
  allowedClientDomains?: string[];
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
  /** Draft extension: this AS resolves client_ids that are HTTPS URLs (CIMD). */
  client_id_metadata_document_supported?: boolean;
}

// ============================================================================
// Authorization Server State (code/refresh token/client registry/consent)
// ============================================================================

/**
 * A single-use authorization code issued by `/authorize`, exchanged at `/token`.
 * TTL is short (60s per RFC 6749 §4.1.2); codes are deleted on consumption.
 */
export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  userId: string;
  tenantId: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  /** OIDC nonce from the authorize request; echoed into id_token at /token. */
  nonce?: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Long-lived refresh token. Rotated on every use per OAuth 2.1.
 */
export interface RefreshToken {
  token: string;
  clientId: string;
  userId: string;
  tenantId: string;
  scope: string;
  expiresAt: Date;
  createdAt: Date;
  /** Previous refresh token hash, for replay detection on rotation. */
  supersedes?: string;
}

/**
 * A client registered via RFC 7591 Dynamic Client Registration.
 * CIMD clients are NOT stored here, their metadata lives on the client's
 * own HTTPS URL and is fetched/cached per request.
 */
export interface RegisteredClient {
  clientId: string;
  clientSecretHash?: string; // bcrypt/argon2 hash; absent for public clients
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  contacts?: string[];
  logoUri?: string;
  tosUri?: string;
  policyUri?: string;
  isPublic: boolean; // no client_secret issued
  createdAt: Date;
  /** TTL eviction: unused registrations drop after 30 days. Touched on use. */
  lastUsedAt: Date;
  /** User-Agent + IP at registration, for audit/deprecation-tracking. */
  registrationContext?: {
    userAgent?: string;
    ipAddress?: string;
  };
}

/**
 * A remembered user consent for (client_id, scope_set). Skip consent screen
 * on subsequent requests unless scopes expand beyond remembered set.
 */
export interface ConsentRecord {
  userId: string;
  tenantId: string;
  clientId: string;
  /** Sorted, space-joined scope list for stable key comparison. */
  scopes: string;
  expiresAt: Date;
  createdAt: Date;
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
