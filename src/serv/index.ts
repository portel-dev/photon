/**
 * SERV - Hosted Photon MCP Platform
 *
 * Multi-tenant MCP server hosting with OAuth 2.1 support
 */

// Types
export * from './types/index.js';

// Session Management
export {
  type SessionStore,
  type SessionConfig,
  MemorySessionStore,
  RedisSessionStore,
  createSessionStore,
} from './session/store.js';

// Cloudflare KV Session Store
export { KVSessionStore, type KVNamespace } from './session/kv-store.js';

// Cloudflare D1 Database
export { D1Client, SCHEMA as D1_SCHEMA, type D1Database } from './db/d1-client.js';
export {
  D1TenantStore,
  D1UserStore,
  D1MembershipStore,
  D1GrantStore,
  D1ElicitationStore,
} from './db/d1-stores.js';

// Local Development (zero dependencies)
export {
  LocalServ,
  LocalUserStore,
  LocalMembershipStore,
  createLocalServ,
  getTestToken,
  type LocalServConfig,
} from './local.js';

// JWT & Auth
export {
  JwtService,
  initJwtService,
  getJwtService,
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  encodeOAuthState,
  decodeOAuthState,
} from './auth/jwt.js';

// OAuth
export {
  OAuthProviderRegistry,
  OAuthFlowHandler,
  MemoryElicitationStore,
  MemoryGrantStore,
  type ElicitationStore,
  type GrantStore,
} from './auth/oauth.js';

// Token Vault
export {
  type TokenVault,
  LocalTokenVault,
  KmsTokenVault,
  createTokenVault,
  initTokenVault,
  getTokenVault,
} from './vault/token-vault.js';

// Middleware
export {
  TenantResolver,
  MemoryTenantStore,
  RequestContextBuilder,
  extractTenantSlug,
  buildTenantUrl,
  buildResourceUri,
  type TenantStore,
} from './middleware/tenant.js';

export {
  AuthMiddleware,
  hasPermission,
  parseMcpSessionId,
  generateClientFingerprint,
  type UserStore,
  type MembershipStore,
} from './middleware/auth.js';

// Well-Known Endpoints
export {
  generateProtectedResourceMetadata,
  generateAuthServerMetadata,
  handleProtectedResourceRequest,
  handleAuthServerRequest,
  generateWwwAuthenticate,
  fetchClientMetadata,
  resolveClientMetadata,
  CimdCache,
  type WellKnownConfig,
  type ClientMetadataDocument,
  type CimdError,
  type CimdResult,
  type CimdFetchOptions,
} from './auth/well-known.js';

// Authorization Server Endpoints (OAuth 2.1)
export {
  handleAuthorize,
  handleToken,
  handleRegister,
  handleConsent,
  handleRevoke,
  handleIntrospect,
  DEFAULT_ENDPOINT_CONFIG,
  type AuthRequest,
  type AuthResponse,
  type EndpointConfig,
  type EndpointDeps,
} from './auth/endpoints.js';

// SQLite-backed stores (requires optional better-sqlite3 on Node; uses
// bun:sqlite natively under Bun)
export {
  openAuthDatabase,
  SqliteAuthCodeStore,
  SqliteRefreshTokenStore,
  SqliteClientRegistry,
  SqliteConsentStore,
  SqlitePendingAuthorizationStore,
} from './auth/sqlite-stores.js';
export {
  openOauthDatabase,
  SqliteElicitationStore,
  SqliteGrantStore,
} from './auth/oauth-sqlite-stores.js';

// Authorization Server Stores
export {
  MemoryAuthCodeStore,
  MemoryRefreshTokenStore,
  MemoryClientRegistry,
  MemoryConsentStore,
  MemoryPendingAuthorizationStore,
  generateSecureToken,
  hashClientSecret,
  verifyClientSecret,
  normalizeScopes,
  type AuthCodeStore,
  type RefreshTokenStore,
  type ClientRegistry,
  type ConsentStore,
  type PendingAuthorizationStore,
  type PendingAuthorization,
} from './auth/auth-store.js';

// Runtime (OAuth-aware execution)
export {
  OAuthContext,
  OAuthElicitationRequired,
  createOAuthInputProvider,
  PhotonExecutor,
  isOAuthElicitationError,
  formatElicitationToolResponse,
  type OAuthAsk,
  type OAuthResponse,
  type OAuthContextConfig,
  type OAuthInputProvider,
  type ExecutorConfig,
  type ExecutionContext,
  type ExecutionResult,
} from './runtime/index.js';

// ============================================================================
// SERV Instance
// ============================================================================

import type { Tenant, Session, SessionCreateOptions } from './types/index.js';
import { MemorySessionStore, type SessionStore } from './session/store.js';
import { JwtService } from './auth/jwt.js';
import { LocalTokenVault, type TokenVault } from './vault/token-vault.js';
import { TenantResolver, MemoryTenantStore, type TenantStore } from './middleware/tenant.js';
import { AuthMiddleware, type UserStore, type MembershipStore } from './middleware/auth.js';
import {
  OAuthProviderRegistry,
  OAuthFlowHandler,
  MemoryElicitationStore,
  MemoryGrantStore,
} from './auth/oauth.js';
import { CimdCache, type WellKnownConfig } from './auth/well-known.js';
import {
  MemoryAuthCodeStore,
  MemoryRefreshTokenStore,
  MemoryClientRegistry,
  MemoryConsentStore,
  MemoryPendingAuthorizationStore,
  type AuthCodeStore,
  type RefreshTokenStore,
  type ClientRegistry,
  type ConsentStore,
  type PendingAuthorizationStore,
} from './auth/auth-store.js';
import {
  DEFAULT_ENDPOINT_CONFIG,
  type EndpointConfig,
  type EndpointDeps,
} from './auth/endpoints.js';
import { PhotonExecutor, type ExecutionContext } from './runtime/index.js';

export interface ServConfig {
  /** Base URL (e.g., 'https://serv.example.com') */
  baseUrl: string;
  /** Base domain for subdomain routing (e.g., 'serv.example.com') */
  baseDomain: string;
  /** JWT signing secret (min 32 chars) */
  jwtSecret: string;
  /** Token encryption master key (min 32 chars) */
  encryptionKey: string;
  /** OAuth state encryption secret */
  stateSecret: string;
  /** Session store (optional, defaults to memory) */
  sessionStore?: SessionStore;
  /** Tenant store (optional, defaults to memory) */
  tenantStore?: TenantStore;
  /** User store (optional) */
  userStore?: UserStore;
  /** Membership store (optional) */
  membershipStore?: MembershipStore;
  /** Token vault (optional, defaults to local) */
  tokenVault?: TokenVault;
  /** Authorization-server code store (optional, defaults to memory). */
  authCodeStore?: AuthCodeStore;
  /** Refresh-token store (optional, defaults to memory). */
  refreshTokenStore?: RefreshTokenStore;
  /** DCR client registry (optional, defaults to memory). */
  clientRegistry?: ClientRegistry;
  /** Remembered-consent store (optional, defaults to memory). */
  consentStore?: ConsentStore;
  /** Paused-authorization-request store (optional, defaults to memory). */
  pendingAuthStore?: PendingAuthorizationStore;
  /** Overrides for endpoint config (TTLs, first-party allowlist, etc.). */
  endpointConfig?: Partial<
    Omit<EndpointConfig, 'issuer' | 'authorizeUrl' | 'consentUrl' | 'loginUrl'>
  >;
}

export class Serv {
  readonly config: ServConfig;
  readonly sessionStore: SessionStore;
  readonly tenantStore: TenantStore;
  readonly tokenVault: TokenVault;
  readonly jwtService: JwtService;
  readonly tenantResolver: TenantResolver;
  readonly authMiddleware: AuthMiddleware;
  readonly oauthProviders: OAuthProviderRegistry;
  readonly oauthFlow: OAuthFlowHandler;
  readonly wellKnownConfig: WellKnownConfig;

  /** Authorization-server state (see /authorize, /token, /register). */
  readonly authCodeStore: AuthCodeStore;
  readonly refreshTokenStore: RefreshTokenStore;
  readonly clientRegistry: ClientRegistry;
  readonly consentStore: ConsentStore;
  readonly pendingAuthStore: PendingAuthorizationStore;
  readonly cimdCache: CimdCache;

  private elicitationStore = new MemoryElicitationStore();
  private grantStore = new MemoryGrantStore();

  constructor(config: ServConfig) {
    this.config = config;

    // Initialize stores
    this.sessionStore = config.sessionStore ?? new MemorySessionStore();
    this.tenantStore = config.tenantStore ?? new MemoryTenantStore();
    this.tokenVault =
      config.tokenVault ??
      new LocalTokenVault({
        masterKey: config.encryptionKey,
      });

    // Initialize JWT service
    this.jwtService = new JwtService({
      secret: config.jwtSecret,
      issuer: config.baseUrl,
    });

    // Initialize tenant resolver
    this.tenantResolver = new TenantResolver({
      baseDomain: config.baseDomain,
      store: this.tenantStore,
    });

    // Initialize auth middleware
    this.authMiddleware = new AuthMiddleware({
      jwtService: this.jwtService,
      sessionStore: this.sessionStore,
      userStore: config.userStore,
      membershipStore: config.membershipStore,
    });

    // Initialize OAuth
    this.oauthProviders = new OAuthProviderRegistry();
    this.oauthFlow = new OAuthFlowHandler({
      baseUrl: config.baseUrl,
      stateSecret: config.stateSecret,
      providers: this.oauthProviders,
      elicitationStore: this.elicitationStore,
      grantStore: this.grantStore,
      tokenVault: this.tokenVault,
    });

    // Well-known config
    this.wellKnownConfig = {
      baseUrl: config.baseUrl,
    };

    // Authorization-server stores (in-memory defaults; callers override for prod)
    this.authCodeStore = config.authCodeStore ?? new MemoryAuthCodeStore();
    this.refreshTokenStore = config.refreshTokenStore ?? new MemoryRefreshTokenStore();
    this.clientRegistry = config.clientRegistry ?? new MemoryClientRegistry();
    this.consentStore = config.consentStore ?? new MemoryConsentStore();
    this.pendingAuthStore = config.pendingAuthStore ?? new MemoryPendingAuthorizationStore();
    this.cimdCache = new CimdCache();
  }

  /**
   * Build per-tenant endpoint dependencies for the OAuth 2.1 authorization
   * server handlers. Callers pass the resulting `EndpointDeps` to
   * `handleAuthorize` / `handleToken` / `handleRegister` / `handleConsent`.
   *
   * URLs are derived from the tenant slug unless overridden; Serv owns the
   * stores and JWT service so multiple tenants share them without coupling
   * to any HTTP framework.
   */
  buildEndpointDeps(tenant: Tenant): EndpointDeps {
    const baseUri = `${this.config.baseUrl}/tenant/${tenant.slug}`;
    return {
      tenant,
      config: {
        ...DEFAULT_ENDPOINT_CONFIG,
        issuer: baseUri,
        authorizeUrl: `${baseUri}/authorize`,
        consentUrl: `${baseUri}/consent`,
        loginUrl: `${baseUri}/login`,
        ...this.config.endpointConfig,
      },
      codeStore: this.authCodeStore,
      refreshTokenStore: this.refreshTokenStore,
      clientRegistry: this.clientRegistry,
      consentStore: this.consentStore,
      pendingStore: this.pendingAuthStore,
      jwtService: this.jwtService,
      cimdCache: this.cimdCache,
    };
  }

  /**
   * Register an OAuth provider
   */
  registerOAuthProvider(providerId: string, clientId: string, clientSecret: string): void {
    this.oauthProviders.register(providerId, clientId, clientSecret);
  }

  /**
   * Add a tenant (for development/testing)
   */
  addTenant(tenant: Tenant): void {
    if (this.tenantStore instanceof MemoryTenantStore) {
      this.tenantStore.add(tenant);
    } else {
      throw new Error('Cannot add tenant to non-memory store');
    }
  }

  /**
   * Create a session for a tenant
   */
  async createSession(options: SessionCreateOptions): Promise<Session> {
    return this.sessionStore.create(options);
  }

  /**
   * Generate a session token
   */
  generateToken(session: Session, tenant: Tenant): string {
    return this.jwtService.generateSessionToken(session, tenant);
  }

  /**
   * Start an OAuth elicitation flow
   */
  async startElicitation(
    session: Session,
    photonId: string,
    provider: string,
    scopes: string[]
  ): Promise<{ url: string; elicitationId: string }> {
    return this.oauthFlow.startElicitation(session, photonId, provider, scopes);
  }

  /**
   * Check if a grant exists for a photon
   */
  async checkGrant(
    tenantId: string,
    photonId: string,
    provider: string,
    requiredScopes: string[],
    userId?: string
  ): Promise<{ valid: boolean; token?: string }> {
    return this.oauthFlow.checkGrant(tenantId, photonId, provider, requiredScopes, userId);
  }

  /**
   * Create a PhotonExecutor for running photons with OAuth support
   */
  createExecutor(): PhotonExecutor {
    return new PhotonExecutor({
      oauthFlow: this.oauthFlow,
      tokenVault: this.tokenVault,
    });
  }

  /**
   * Create an execution context for a photon
   */
  createExecutionContext(session: Session, tenant: Tenant, photonId: string): ExecutionContext {
    return { session, tenant, photonId };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.sessionStore.close();
  }
}

// ============================================================================
// Quick Start Helper
// ============================================================================

/**
 * Create a SERV instance for development
 */
export async function createDevServ(options?: {
  baseUrl?: string;
  baseDomain?: string;
}): Promise<Serv> {
  const baseUrl = options?.baseUrl ?? 'http://localhost:3000'; // dev-only default
  const baseDomain = options?.baseDomain ?? 'localhost';

  // Security: generate unique secrets per instance instead of hardcoded values
  const { randomBytes } = await import('crypto');
  return new Serv({
    baseUrl,
    baseDomain,
    jwtSecret: randomBytes(32).toString('hex'),
    encryptionKey: randomBytes(32).toString('hex'),
    stateSecret: randomBytes(32).toString('hex'),
  });
}
