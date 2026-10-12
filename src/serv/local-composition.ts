import { randomUUID } from 'crypto';
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
import { LocalUserStore, LocalMembershipStore } from './local.js';

export interface LocalComposition {
  secrets: { jwt: string; encryption: string; state: string };
  sessions: MemorySessionStore;
  tenants: MemoryTenantStore;
  users: LocalUserStore;
  memberships: LocalMembershipStore;
  elicitations: MemoryElicitationStore;
  grants: MemoryGrantStore;
  vault: LocalTokenVault;
  jwt: JwtService;
  tenantResolver: TenantResolver;
  auth: AuthMiddleware;
  oauthProviders: OAuthProviderRegistry;
  oauthFlow: OAuthFlowHandler;
}

/**
 * Composition root for local SERV mode. LocalServ owns behavior and routing;
 * this factory owns concrete in-memory infrastructure assembly.
 */
export function createLocalComposition(baseUrl: string): LocalComposition {
  const secrets = {
    jwt: `local-jwt-${randomUUID()}`,
    encryption: `local-enc-${randomUUID()}`,
    state: `local-state-${randomUUID()}`,
  };
  const sessions = new MemorySessionStore();
  const tenants = new MemoryTenantStore();
  const users = new LocalUserStore();
  const memberships = new LocalMembershipStore();
  const elicitations = new MemoryElicitationStore();
  const grants = new MemoryGrantStore();
  const vault = new LocalTokenVault({ masterKey: secrets.encryption });
  const jwt = new JwtService({ secret: secrets.jwt, issuer: baseUrl });
  const tenantResolver = new TenantResolver({ baseDomain: 'localhost', store: tenants });
  const auth = new AuthMiddleware({
    jwtService: jwt,
    sessionStore: sessions,
    userStore: users,
    membershipStore: memberships,
    oauthResource: (tenant) => {
      const issuer = tenant.settings.customDomain
        ? `https://${tenant.settings.customDomain}`
        : `${baseUrl}/tenant/${tenant.slug}`;
      return {
        issuer,
        resource: `${issuer}/mcp`,
        resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
        requiredScopes: ['mcp:read'],
      };
    },
  });
  const oauthProviders = new OAuthProviderRegistry();
  const oauthFlow = new OAuthFlowHandler({
    baseUrl,
    stateSecret: secrets.state,
    providers: oauthProviders,
    elicitationStore: elicitations,
    grantStore: grants,
    tokenVault: vault,
  });
  return {
    secrets,
    sessions,
    tenants,
    users,
    memberships,
    elicitations,
    grants,
    vault,
    jwt,
    tenantResolver,
    auth,
    oauthProviders,
    oauthFlow,
  };
}
