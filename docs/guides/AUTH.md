# OAuth Authentication

Photon's OAuth system lets photons request third-party API tokens on behalf of users. It implements OAuth 2.1 with PKCE, HMAC-signed state, and per-tenant encrypted token storage.

## Table of Contents

1. [Quick Start](#quick-start)
2. [How It Works](#how-it-works)
3. [Built-in Providers](#built-in-providers)
4. [Yield Pattern](#yield-pattern) — How photons request OAuth tokens
5. [Token Refresh](#token-refresh) — Automatic and manual refresh
6. [Error Handling](#error-handling) — Catching and recovering from elicitation
7. [Testing OAuth Photons](#testing-oauth-photons) — Unit and integration testing
8. [Complete Example](#complete-example) — Full working photon with GitHub OAuth
9. [Token Vault](#token-vault) — Encryption and storage
10. [Security Model](#security-model) — PKCE, state signing, per-tenant encryption
11. [Well-Known Endpoints](#well-known-endpoints) — OAuth discovery

---

## Quick Start

Here's a minimal photon that authenticates with GitHub:

```typescript
import { Photon } from '@portel/photon-core';

export default class GitHubAPI extends Photon {
  /**
   * Get authenticated user's profile
   */
  async profile() {
    // Yield to request an OAuth token
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['read:user'],
      message: 'Reading your GitHub profile',
    };

    // Use the token to call GitHub API
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }
}
```

**What happens:**
1. When the photon yields `{ ask: 'oauth', ... }`, the runtime intercepts it
2. If the user already authorized the app for this scope, the token is returned immediately
3. If not, the user is redirected to GitHub's login, and the photon pauses
4. After authorization, the photon resumes and receives the token
5. The token is automatically stored in the encrypted vault for future use

---

## How It Works

OAuth flow in Photon follows these steps:

```
┌─────────────────┐
│   Photon        │
│  yield {oauth}  │────────────────┐
└─────────────────┘                │
                                   v
                          ┌────────────────┐
                          │ OAuthContext   │
                          │  checkGrant()  │─── Has valid token? ──→ Return token
                          └────────────────┘
                                   │
                                   └─── No valid token
                                   │
                                   v
                          ┌────────────────────┐
                          │ OAuthFlowHandler   │
                          │ startElicitation() │─── Generate URL
                          └────────────────────┘
                                   │
                                   v
                          ┌────────────────────┐
                          │ Throw              │
                          │ OAuthElicitation   │─── User redirected to provider
                          │ Required           │
                          └────────────────────┘
                                   │
                          [User logs in & authorizes]
                                   │
                                   v
                          ┌────────────────────┐
                          │ /auth/oauth/       │
                          │ callback (server)  │─── Exchange code for token
                          └────────────────────┘
                                   │
                                   v
                          ┌────────────────────────┐
                          │ Encrypt & store in     │
                          │ grant (token vault)    │
                          └────────────────────────┘
                                   │
                          [Photon retried]
                                   │
                                   v
                          ┌────────────────────┐
                          │ checkGrant() finds │
                          │ token → Return it  │
                          └────────────────────┘
```

**Step-by-step:**

1. **Photon yields** `{ ask: 'oauth', provider: 'github', scopes: ['repo'] }`
2. **OAuthContext checks** for an existing grant (cached token)
3. **If found & valid** → Return token immediately (instant, no user action)
4. **If not found** → OAuthFlowHandler generates an authorization URL with PKCE + HMAC state
5. **Throw OAuthElicitationRequired** with the URL, elicitation ID, and scopes
6. **MCP runtime** formats this as an elicitation response (the client UI shows a login button)
7. **User clicks** the link, authorizes at GitHub, gets redirected back
8. **Server's `/auth/oauth/callback`** receives the code, exchanges it for tokens using PKCE
9. **Tokens encrypted** in the vault using per-tenant AES-256
10. **Grant stored** (tenant + photon + provider + scopes + encrypted tokens)
11. **Photon retried** by the client (explicit or automatic)
12. **Second yield** → OAuthContext finds the grant, returns token immediately

---

## Built-in Providers

| Provider  | ID          | Default Scopes                              |
|-----------|-------------|---------------------------------------------|
| Google    | `google`    | `openid`, `email`, `profile`                |
| GitHub    | `github`    | `read:user`, `user:email`                   |
| Microsoft | `microsoft` | `openid`, `email`, `profile`, `User.Read`   |

Register providers with your client credentials:

```typescript
registry.register('google', process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
```

Custom providers can be registered with `registerCustom()`:

```typescript
registry.registerCustom({
  id: 'slack',
  name: 'Slack',
  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  scopes: ['channels:read'],
  clientId: '...',
  clientSecret: '...',
});
```

---

## Token Refresh

Tokens automatically refresh when they expire (with a 5-minute buffer). Here's how:

**Automatic refresh:**
```typescript
async getUser() {
  const token: string = yield {
    ask: 'oauth',
    provider: 'github',
    scopes: ['read:user'],
  };
  // If the cached token is expired but has a refresh token,
  // OAuthContext automatically refreshes it and returns the new token.
  // No code changes needed!
}
```

**How it works:**
1. `checkGrant()` checks if the stored token is expired
2. If expired but a refresh token exists → `refreshGrant()` exchanges the refresh token for a new one
3. New token is encrypted and stored
4. Old token & refresh token are updated in the vault
5. Photon receives the new token transparently

**If refresh fails:**
- The grant is marked invalid
- The next yield throws `OAuthElicitationRequired` again
- User must re-authorize

**Manual token refresh:**
If you need to force a refresh (e.g., to request new scopes), throw `OAuthElicitationRequired` to trigger re-authorization:

```typescript
async gitHubSearch(params: { query: string }) {
  try {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['repo'],
    };
    // ... use token ...
  } catch (error) {
    if (error instanceof OAuthElicitationRequired) {
      // Force re-authorization to request additional scopes
      const token: string = yield {
        ask: 'oauth',
        provider: 'github',
        scopes: ['repo', 'admin:org_hook'], // Added new scope
        message: 'This feature requires additional permissions',
      };
      // ... use token ...
    }
  }
}
```

---

## Error Handling

### Pattern: Yield-Based Elicitation

The OAuth system never throws synchronously. Instead, it uses yield-based control flow:

```typescript
async safeFetchRepos() {
  try {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['repo'],
    };
    return { repos: await this.fetchFromGitHub(token) };
  } catch (error) {
    // Only network errors reach here, not elicitation errors
    // (Elicitation errors are handled by the MCP runtime)
    if (error instanceof Error) {
      return { error: error.message };
    }
  }
}
```

### Pattern: Recovery After Elicitation

If you need to handle authorization differently based on the elicitation result:

```typescript
async getProfileWithFallback() {
  let token: string | undefined;

  try {
    token = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['read:user'],
      message: 'Reading your GitHub profile',
    };
  } catch (error) {
    if (error instanceof OAuthElicitationRequired) {
      // User denied authorization or closed the login page
      // You could provide a fallback:
      return {
        message: 'GitHub profile unavailable (authorization required)',
        link: error.elicitationUrl,
      };
    }
  }

  // token is now guaranteed to be a string
  const profile = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());

  return profile;
}
```

---

## Testing OAuth Photons

Use `MemoryElicitationStore` and `MemoryGrantStore` in tests to simulate OAuth flows without hitting real providers:

```typescript
import {
  OAuthFlowHandler,
  OAuthProviderRegistry,
  MemoryElicitationStore,
  MemoryGrantStore,
} from '@portel/photon-core';
import { LocalTokenVault } from '@portel/photon-core';

// Create test infrastructure
const registry = new OAuthProviderRegistry();
registry.register('github', 'test-client-id', 'test-client-secret');

const vault = new LocalTokenVault({ masterKey: 'test-key-32-chars-long-minimum' });
const elicitationStore = new MemoryElicitationStore();
const grantStore = new MemoryGrantStore();

const flow = new OAuthFlowHandler({
  baseUrl: 'http://localhost:3000',
  stateSecret: 'state-secret-key-32-chars-long!!',
  providers: registry,
  elicitationStore,
  grantStore,
  tokenVault: vault,
});

// Test 1: Elicitation is created for new auth
async function testNewAuth() {
  const { url, elicitationId } = await flow.startElicitation(
    { id: 'session-1', userId: 'user-1' },
    'my-photon',
    'github',
    ['repo']
  );

  console.assert(url.includes('github.com/login'), 'URL should point to GitHub');
  console.assert(elicitationId, 'Should have elicitation ID');
}

// Test 2: Grant is returned on second access
async function testGrantReuse() {
  // Simulate a successful grant by manually storing one
  const testToken = 'ghs_test_token_abc123';
  const encrypted = await vault.encrypt('tenant-1', testToken);

  const grant = await grantStore.create({
    tenantId: 'tenant-1',
    photonId: 'my-photon',
    provider: 'github',
    scopes: ['repo'],
    accessTokenEncrypted: encrypted,
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  });

  // Now checkGrant should return the token
  const check = await flow.checkGrant(
    'tenant-1',
    'my-photon',
    'github',
    ['repo']
  );

  console.assert(check.valid, 'Grant should be valid');
  console.assert(check.token === testToken, 'Token should match');
}

await testNewAuth();
await testGrantReuse();
```

---

## Complete Example

A fully working photon that integrates GitHub OAuth:

```typescript
import { Photon } from '@portel/photon-core';

export default class GitHub extends Photon {
  /**
   * Get your GitHub profile
   *
   * @returns User profile data
   */
  async profile() {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['read:user'],
      message: 'Reading your GitHub profile',
    };

    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }

  /**
   * List repositories for an organization
   *
   * @param org - Organization name
   * @returns Array of repository objects
   */
  async orgRepos(params: { org: string }) {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['read:org'],
      message: `Reading ${params.org} repositories`,
    };

    const res = await fetch(
      `https://api.github.com/orgs/${params.org}/repos?per_page=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message);
    }

    return res.json();
  }

  /**
   * Create a repository in an organization
   *
   * @param org - Organization name
   * @param name - Repository name
   * @returns Created repository object
   */
  async createRepo(params: { org: string; name: string }) {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['repo', 'write:org'],
      message: `Creating repository in ${params.org}`,
    };

    const res = await fetch(
      `https://api.github.com/orgs/${params.org}/repos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: params.name,
          private: false,
          description: 'Created via Photon',
        }),
      }
    );

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Failed to create repo');
    }

    return res.json();
  }
}
```

---

## Token Vault

Tokens are encrypted at rest using AES-256-GCM with per-tenant derived keys.

| Vault            | Use Case                      | Key Source                          |
|------------------|-------------------------------|-------------------------------------|
| `LocalTokenVault`| Dev / single-instance         | Master key → scrypt per tenant      |
| `KmsTokenVault`  | Production / multi-instance   | AWS KMS / GCP KMS envelope encrypt  |

```typescript
// Development
const vault = new LocalTokenVault({ masterKey: process.env.TOKEN_MASTER_KEY });

// Production
const vault = new KmsTokenVault({ kms: awsKmsClient, getKeyId: (tenantId) => `alias/${tenantId}` });
```

## Yield Pattern

Photons request OAuth tokens by yielding an ask:

```typescript
async fetchUserRepos(params: { org: string }) {
  // Yield to request a token
  const token: string = yield {
    ask: 'oauth',
    provider: 'github',
    scopes: ['repo', 'read:org'],
    message: 'Reading organization repositories',
  };

  // Use the token
  const res = await fetch(`https://api.github.com/orgs/${params.org}/repos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}
```

**Fields:**
- `ask: 'oauth'` — Required, tells the runtime this is an OAuth ask
- `provider` — OAuth provider ID (`'google'`, `'github'`, `'microsoft'`, or custom)
- `scopes` — Array of requested OAuth scopes (e.g., `['repo', 'read:org']` for GitHub)
- `message` — Optional human-readable explanation (shown in UI before authorization)

**Return value:** The access token as a string. If the user denies authorization, the error is caught as `OAuthElicitationRequired`.

### Handling Elicitation Errors

When a token isn't available, the yield throws `OAuthElicitationRequired`. The MCP runtime catches this and sends an elicitation response to the client:

```typescript
import { OAuthElicitationRequired } from '@portel/photon-core';

async fetchRepos(params: { org: string }) {
  try {
    const token: string = yield {
      ask: 'oauth',
      provider: 'github',
      scopes: ['repo'],
    };
    // ... use token ...
  } catch (error) {
    if (error instanceof OAuthElicitationRequired) {
      // This error is caught by the MCP runtime and formatted as an elicitation response.
      // The client shows a login button with the elicitation URL.
      // After user authorizes, the client retries this method automatically.
      throw error; // Re-throw to let MCP runtime handle it
    }
  }
}
```

In practice, you don't need to catch this error — the MCP runtime handles it automatically. The error includes:
- `elicitationUrl` — URL to send user for authorization
- `elicitationId` — Tracks this specific authorization request
- `provider` — The OAuth provider
- `scopes` — The requested scopes
- `toMCPError()` — Converts to MCP error format for protocol compliance

## Security Model

### PKCE (RFC 7636)

Every authorization request uses Proof Key for Code Exchange:

1. Generate a random `code_verifier` (32 bytes, base64url)
2. Derive `code_challenge` = HMAC-SHA256(verifier)
3. Send `code_challenge` with `code_challenge_method=S256` in the authorization request
4. Include `code_verifier` in the token exchange

This prevents authorization code interception attacks.

### HMAC State Signing

OAuth state parameters are signed with HMAC-SHA256:

1. Serialize state (sessionId, elicitationId, photonId, provider, nonce, timestamp)
2. Sign with `stateSecret`
3. Encode as `base64url(payload|signature)`
4. On callback, verify signature and check 5-minute max age

This prevents CSRF and state tampering.

### Per-Tenant Encryption

- `LocalTokenVault`: derives a unique AES-256 key per tenant using scrypt(masterKey, salt + tenantId)
- `KmsTokenVault`: uses envelope encryption with KMS-managed data keys, cached for 1 hour
- All tokens stored as `base64(iv + authTag + ciphertext)`

## Well-Known Endpoints

Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata).

### `GET /.well-known/oauth-protected-resource`

Returns the protected resource metadata for a tenant:

```json
{
  "resource": "https://serv.example.com/tenant/my-tenant/mcp",
  "authorization_servers": ["https://serv.example.com/tenant/my-tenant"],
  "bearer_methods_supported": ["header"]
}
```

### `GET /.well-known/oauth-authorization-server`

Returns the authorization server metadata:

```json
{
  "issuer": "https://serv.example.com/tenant/my-tenant",
  "authorization_endpoint": "https://serv.example.com/tenant/my-tenant/authorize",
  "token_endpoint": "https://serv.example.com/tenant/my-tenant/token",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"]
}
```

### WWW-Authenticate Header

On 401 responses, the server includes:

```
Bearer realm="my-tenant", resource_metadata="https://serv.example.com/.well-known/oauth-protected-resource"
```

With optional error details:

```
Bearer realm="my-tenant", resource_metadata="...", error="invalid_token", error_description="Token expired"
```
