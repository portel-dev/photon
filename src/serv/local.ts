/**
 * SERV Local Development Mode
 *
 * Zero external dependencies - everything runs in-memory.
 * Perfect for local testing before deploying to Cloudflare.
 */

import { randomUUID } from 'crypto';
import type { Tenant, User, Membership, Session } from './types/index.js';
import { MemorySessionStore } from './session/store.js';
import { MemoryTenantStore } from './middleware/tenant.js';
import {
  MemoryElicitationStore,
  MemoryGrantStore,
  OAuthProviderRegistry,
  OAuthFlowHandler,
} from './auth/oauth.js';
import { LocalTokenVault } from './vault/token-vault.js';
import { JwtService } from './auth/jwt.js';
import { TenantResolver } from './middleware/tenant.js';
import { AuthMiddleware } from './middleware/auth.js';
import {
  handleProtectedResourceRequest,
  handleAuthServerRequest,
  generateWwwAuthenticate,
} from './auth/well-known.js';

// ============================================================================
// Local User Store (In-Memory)
// ============================================================================

export class LocalUserStore {
  private users: Map<string, User> = new Map();
  private emailIndex: Map<string, string> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = {
      id: randomUUID(),
      ...data,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    this.emailIndex.set(user.email.toLowerCase(), user.id);
    return user;
  }

  add(user: User): void {
    this.users.set(user.id, user);
    this.emailIndex.set(user.email.toLowerCase(), user.id);
  }
}

// ============================================================================
// Local Membership Store (In-Memory)
// ============================================================================

export class LocalMembershipStore {
  private memberships: Map<string, Membership> = new Map();

  private key(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  async find(tenantId: string, userId: string): Promise<Membership | null> {
    return this.memberships.get(this.key(tenantId, userId)) ?? null;
  }

  async findByUser(userId: string): Promise<Membership[]> {
    return Array.from(this.memberships.values()).filter((m) => m.userId === userId);
  }

  async create(data: Omit<Membership, 'joinedAt'>): Promise<Membership> {
    const membership: Membership = {
      ...data,
      joinedAt: new Date(),
    };
    this.memberships.set(this.key(data.tenantId, data.userId), membership);
    return membership;
  }

  add(membership: Membership): void {
    this.memberships.set(this.key(membership.tenantId, membership.userId), membership);
  }
}

// ============================================================================
// Local SERV Configuration
// ============================================================================

export interface LocalServConfig {
  /** Port to run on (default: 3000) */
  port?: number;
  /** Base URL for local development */
  baseUrl?: string;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// Local SERV Instance
// ============================================================================

export class LocalServ {
  readonly port: number;
  readonly baseUrl: string;
  readonly debug: boolean;

  // Stores
  readonly sessions: MemorySessionStore;
  readonly tenants: MemoryTenantStore;
  readonly users: LocalUserStore;
  readonly memberships: LocalMembershipStore;
  readonly elicitations: MemoryElicitationStore;
  readonly grants: MemoryGrantStore;
  readonly vault: LocalTokenVault;

  // Services
  readonly jwt: JwtService;
  readonly tenantResolver: TenantResolver;
  readonly auth: AuthMiddleware;
  readonly oauthProviders: OAuthProviderRegistry;
  readonly oauthFlow: OAuthFlowHandler;

  // Secrets (auto-generated for local dev)
  private readonly secrets: {
    jwt: string;
    encryption: string;
    state: string;
  };

  constructor(config: LocalServConfig = {}) {
    this.port = config.port ?? 3000;
    this.baseUrl = config.baseUrl ?? `http://localhost:${this.port}`;
    this.debug = config.debug ?? false;

    // Generate random secrets for local dev
    this.secrets = {
      jwt: `local-jwt-${randomUUID()}`,
      encryption: `local-enc-${randomUUID()}`,
      state: `local-state-${randomUUID()}`,
    };

    // Initialize stores
    this.sessions = new MemorySessionStore();
    this.tenants = new MemoryTenantStore();
    this.users = new LocalUserStore();
    this.memberships = new LocalMembershipStore();
    this.elicitations = new MemoryElicitationStore();
    this.grants = new MemoryGrantStore();
    this.vault = new LocalTokenVault({ masterKey: this.secrets.encryption });

    // Initialize JWT service
    this.jwt = new JwtService({
      secret: this.secrets.jwt,
      issuer: this.baseUrl,
    });

    // Initialize tenant resolver
    this.tenantResolver = new TenantResolver({
      baseDomain: 'localhost',
      store: this.tenants,
    });

    // Initialize auth middleware
    this.auth = new AuthMiddleware({
      jwtService: this.jwt,
      sessionStore: this.sessions,
      userStore: this.users,
      membershipStore: this.memberships,
    });

    // Initialize OAuth
    this.oauthProviders = new OAuthProviderRegistry();
    this.oauthFlow = new OAuthFlowHandler({
      baseUrl: this.baseUrl,
      stateSecret: this.secrets.state,
      providers: this.oauthProviders,
      elicitationStore: this.elicitations,
      grantStore: this.grants,
      tokenVault: this.vault,
    });

    this.log('LocalServ initialized', { port: this.port, baseUrl: this.baseUrl });
  }

  // ===========================================================================
  // Setup Helpers
  // ===========================================================================

  /**
   * Create a tenant for local testing
   */
  createTenant(options: {
    name: string;
    slug: string;
    plan?: 'free' | 'pro' | 'enterprise';
  }): Tenant {
    const tenant: Tenant = {
      id: randomUUID(),
      name: options.name,
      slug: options.slug,
      region: 'local',
      plan: options.plan ?? 'free',
      encryptionKeyId: 'local-key',
      settings: {
        allowAnonymousUsers: true,
        sponsoredPhotons: [],
      },
      createdAt: new Date(),
    };
    this.tenants.add(tenant);
    this.log('Created tenant', { slug: tenant.slug, id: tenant.id });
    return tenant;
  }

  /**
   * Create a user for local testing
   */
  createUser(options: { email: string; verified?: boolean }): User {
    const user: User = {
      id: randomUUID(),
      email: options.email,
      emailVerified: options.verified ?? true,
      createdAt: new Date(),
    };
    this.users.add(user);
    this.log('Created user', { email: user.email, id: user.id });
    return user;
  }

  /**
   * Add a user to a tenant
   */
  addMembership(options: {
    tenant: Tenant;
    user: User;
    role?: 'owner' | 'admin' | 'member' | 'viewer';
  }): Membership {
    const membership: Membership = {
      tenantId: options.tenant.id,
      userId: options.user.id,
      role: options.role ?? 'member',
      status: 'active',
      joinedAt: new Date(),
    };
    this.memberships.add(membership);
    this.log('Added membership', {
      user: options.user.email,
      tenant: options.tenant.slug,
      role: membership.role,
    });
    return membership;
  }

  /**
   * Register an OAuth provider for testing
   */
  registerOAuthProvider(providerId: string, clientId: string, clientSecret: string): void {
    this.oauthProviders.register(providerId, clientId, clientSecret);
    this.log('Registered OAuth provider', { providerId });
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create a session for a user in a tenant
   */
  async createSession(
    tenant: Tenant,
    user?: User
  ): Promise<{
    session: Session;
    token: string;
  }> {
    const session = await this.sessions.create({
      tenantId: tenant.id,
      userId: user?.id,
      clientId: 'local-dev',
    });

    const token = this.jwt.generateSessionToken(
      session,
      tenant,
      user,
      user ? ((await this.memberships.find(tenant.id, user.id)) ?? undefined) : undefined
    );

    this.log('Created session', {
      sessionId: session.id,
      tenant: tenant.slug,
      user: user?.email ?? 'anonymous',
    });

    return { session, token };
  }

  // ===========================================================================
  // Request Handling
  // ===========================================================================

  /**
   * Handle an HTTP request (for use with Node.js http server)
   */
  async handleRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    const parsedUrl = new URL(url, this.baseUrl);
    const path = parsedUrl.pathname;

    this.log('Request', { method, path });

    try {
      // Well-known endpoints
      if (path === '/.well-known/oauth-protected-resource') {
        const tenant = await this.resolveTenant(headers);
        if (!tenant) return this.notFound('Tenant not found');
        return handleProtectedResourceRequest({ baseUrl: this.baseUrl }, tenant);
      }

      if (path === '/.well-known/oauth-authorization-server') {
        const tenant = await this.resolveTenant(headers);
        if (!tenant) return this.notFound('Tenant not found');
        return handleAuthServerRequest({ baseUrl: this.baseUrl }, tenant);
      }

      // OAuth callback
      if (path === '/auth/oauth/callback') {
        const code = parsedUrl.searchParams.get('code');
        const state = parsedUrl.searchParams.get('state');
        if (!code || !state) {
          return this.badRequest('Missing code or state');
        }

        const tenant = await this.resolveTenant(headers);
        if (!tenant) return this.notFound('Tenant not found');

        const result = await this.oauthFlow.handleCallback(code, state, tenant.id);
        if (!result.success) {
          return this.badRequest(result.error ?? 'OAuth callback failed');
        }

        return {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          body: `
            <!DOCTYPE html>
            <html>
            <head><title>Authorization Complete</title></head>
            <body>
              <h1>Authorization Successful</h1>
              <p>You can close this window and retry your request.</p>
              <script>window.close();</script>
            </body>
            </html>
          `,
        };
      }

      // MCP endpoint (placeholder)
      if (path.endsWith('/mcp')) {
        const tenant = await this.resolveTenant(headers);
        if (!tenant) return this.notFound('Tenant not found');

        const authResult = await this.auth.authenticate(tenant, headers['authorization']);

        if (!authResult.success) {
          return {
            status: authResult.error!.code,
            headers: {
              'Content-Type': 'application/json',
              ...(authResult.error!.wwwAuthenticate
                ? { 'WWW-Authenticate': authResult.error!.wwwAuthenticate }
                : {}),
            },
            body: JSON.stringify({ error: authResult.error!.message }),
          };
        }

        // TODO: Forward to photon runtime
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'MCP endpoint ready',
            tenant: tenant.slug,
            session: authResult.context?.session?.id,
          }),
        };
      }

      return this.notFound('Not found');
    } catch (err) {
      this.log('Error', { error: err instanceof Error ? err.message : String(err) });
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async resolveTenant(headers: Record<string, string>): Promise<Tenant | null> {
    // For local dev, try to find from path or default to first tenant
    const host = headers['host'] ?? 'localhost';

    // Try subdomain
    const tenant = await this.tenantResolver.resolve({ host, headers: { host } });
    if (tenant) return tenant;

    // For local dev, return first tenant if only one exists
    // (This is a convenience for testing)
    return null;
  }

  private notFound(message: string) {
    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }

  private badRequest(message: string) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[LocalServ] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  async shutdown(): Promise<void> {
    await this.sessions.close();
    this.log('Shutdown complete');
  }
}

// ============================================================================
// Quick Start
// ============================================================================

/**
 * Create a LocalServ instance with a default tenant and user
 */
export function createLocalServ(config?: LocalServConfig): {
  serv: LocalServ;
  tenant: Tenant;
  user: User;
  membership: Membership;
} {
  const serv = new LocalServ(config);

  // Create default tenant
  const tenant = serv.createTenant({
    name: 'Local Dev',
    slug: 'local',
  });

  // Create default user
  const user = serv.createUser({
    email: 'dev@localhost',
    verified: true,
  });

  // Add user to tenant
  const membership = serv.addMembership({
    tenant,
    user,
    role: 'owner',
  });

  return { serv, tenant, user, membership };
}

/**
 * Quick session token for testing
 */
export async function getTestToken(serv: LocalServ, tenant: Tenant, user?: User): Promise<string> {
  const { token } = await serv.createSession(tenant, user);
  return token;
}
