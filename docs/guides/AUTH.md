# OAuth Authentication

Photon's OAuth system lets photons request third-party API tokens on behalf of users. It implements OAuth 2.1 with PKCE, HMAC-signed state, and per-tenant encrypted token storage.

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

## Photon Author Usage

Within a photon, request an OAuth token using the runtime context:

```typescript
async fetchUserRepos(params: { org: string }) {
  const token = await this.requestToken('github', ['repo', 'read:org']);
  const res = await fetch(`https://api.github.com/orgs/${params.org}/repos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}
```

If no valid grant exists, `requestToken()` throws `OAuthElicitationRequired`. The MCP runtime catches this and returns an elicitation response to the client, which redirects the user to the provider's consent screen.

After the user authorizes, the callback handler exchanges the code for tokens, encrypts them in the vault, and stores the grant. The next call to `requestToken()` returns the token directly.

### OAuthElicitationRequired

```typescript
try {
  const token = await this.requestToken('google', ['email']);
} catch (err) {
  if (err instanceof OAuthElicitationRequired) {
    // err.elicitationUrl  — redirect user here
    // err.elicitationId   — track the elicitation
    // err.provider        — 'google'
    // err.scopes          — ['email']
    // err.toMCPError()    — structured MCP error response
  }
}
```

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
