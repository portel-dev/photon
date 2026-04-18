# OAuth 2.1 Authorization Server

SERV ships a standards-compliant OAuth 2.1 authorization server so self-hosted photon deployments don't need an external identity provider. The AS accepts MCP clients via both Client ID Metadata Documents (CIMD, MCP 2025-11 spec) and Dynamic Client Registration (RFC 7591), with CIMD treated as the preferred path.

## What's implemented

- **Endpoints** (pure handlers in `src/serv/auth/endpoints.ts`, returning `{status, headers, body}`):
  - `GET /authorize` : RFC 6749 §4.1 authorization code grant, PKCE S256 mandatory
  - `POST /token` : `authorization_code`, `refresh_token`, `client_credentials`, and RFC 8693 `token-exchange` grants
  - `POST /register` : RFC 7591 DCR
  - `GET /consent`, `POST /consent` : HTML consent screen + decision handling
  - `POST /revoke` : RFC 7009 token revocation
  - `POST /introspect` : RFC 7662 token introspection
- **Well-known discovery** (`src/serv/auth/well-known.ts`):
  - `/.well-known/oauth-authorization-server` (RFC 8414) advertises `client_id_metadata_document_supported: true`
  - `/.well-known/oauth-protected-resource` (RFC 9728)
- **CIMD resolution** with per-tenant domain allowlist, in-memory LRU cache, ETag revalidation, structured error taxonomy
- **Stores** — two implementations of every interface:
  - In-memory defaults for single-instance self-host
  - SQLite-backed (`src/serv/auth/sqlite-stores.ts`) for persistence across restarts; requires `better-sqlite3` (optional peer)
- **JWT signing** — HS256/384/512 symmetric plus RS256 / ES256 asymmetric. `exportJwk()` publishes the public key for `/.well-known/jwks.json`.
- **OIDC id_token** emitted on `/token` when `openid` scope is granted. Claims: iss, sub, aud (client), azp, exp, iat, optional nonce. Per OIDC Core §3.1.3.7.
- **RFC 8693 token exchange** fixes MCP confused-deputy: MCP server exchanges the user's access token for a downstream-audience token with `act` claim identifying the server. Delegation chains preserved via nested `act`. Scope narrow-only.
- **Metrics** via `@opentelemetry/api` when installed: `mcp_auth.events`, `mcp_auth.cimd.fetches`

## Design decisions

These decisions followed from a focused research pass (RFC 9700, OIDC Core, Keycloak/Hydra/Auth0 precedent). Full rationale in `_photon/plans/mcp-security-study.md` §6.

### D1. Subject identity source

**Federation-only + `PHOTON_SINGLE_USER` bootstrap.** The `sub` claim comes from `User.id` provisioned on first federated login via upstream GitHub/Microsoft (wired in `src/serv/auth/oauth.ts`). We do not store passwords.

For self-host dev convenience, setting `PHOTON_SINGLE_USER=1` and providing `endpointConfig.singleUserId` skips the browser round-trip and assumes the tenant owner is the subject. PKCE is still required.

Why: OIDC Core §3.1.2.3 is silent on the user-auth method, so federation-only is compliant. Local password storage adds credential-reset flows and breach surface we don't want to own. Matches Hydra's integrator model and Prometheus/Caddy's "trust the network boundary in dev" ethos.

### D2. Consent UX

**First-party allowlist skip + remembered consent per `(user, client_id, scope_set)` for 30 days.** Every CIMD or DCR client gets a consent screen on first authorization for a given scope set. Re-prompted when scopes expand; honours `prompt=consent` and `prompt=none`.

Why: RFC 9700 §4.14 warns against auto-approval for dynamically-registered clients. "Trusted-domain implicit consent" (my initial instinct) turns anyone who compromises or buys a whitelisted domain into a silent-approval phishing vector. Consent records are keyed on `client_id` (the CIMD URL itself), not display name. Matches Google/GitHub/Auth0.

## Lifecycle of an authorize request

```
1. Client → GET /authorize?client_id=...&code_challenge=...&state=...
2. AS validates response_type=code + PKCE S256 + redirect_uri
3. AS resolves client:
   - HTTPS client_id → CIMD fetch (allowlist gated, cache with ETag)
   - plain client_id → DCR registry lookup
4. AS checks redirect_uri against client's allowed list (exact match)
5. AS checks user session (req.userId)
   - if none → 302 to loginUrl with ?return_to=...
   - if none + prompt=none → 302 to redirect_uri with error=login_required
6. AS checks consent
   - first-party client → skip
   - ConsentStore.covers(user, client, scopes) → skip
   - else → stash PendingAuthorization, 302 to /consent?req=...
7. /consent POST approve → save ConsentRecord, issue code, 302 to redirect_uri?code=...&state=...
```

## Lifecycle of a token exchange

```
authorization_code:
1. Client → POST /token (code, code_verifier, redirect_uri, client_id)
2. AS consumes code (single-use, 60s TTL)
3. AS verifies code_verifier against stored code_challenge (S256)
4. AS re-checks redirect_uri + client_id match the code
5. AS requires Basic auth if client is confidential
6. AS issues access_token (JWT, 15min) + refresh_token (opaque, 30 days)

refresh_token:
1. Client → POST /token (refresh_token, client_id, scope?)
2. AS looks up existing token, rotates (new refresh token, old consumed)
3. AS verifies scope narrowing (no expansion)
4. AS issues new access + refresh tokens; old refresh → replay rejected

client_credentials:
1. Client authenticates via Basic or client_secret_post
2. AS issues access_token only (no refresh per RFC 6749 §4.4.3)
3. sub = `client:<client_id>`
```

## Wiring into an HTTP framework

The handlers are pure functions. `Serv.buildEndpointDeps(tenant)` returns everything you need:

```typescript
import { Serv, handleAuthorize, handleToken, handleRegister, handleConsent } from '@portel/photon/serv';

const serv = new Serv({ baseUrl, baseDomain, jwtSecret, encryptionKey, stateSecret });

// Your HTTP router (Express, Fetch, Cloudflare Worker, Bun.serve, whatever)
app.get('/tenant/:slug/authorize', async (req, res) => {
  const tenant = await resolveTenant(req.params.slug);
  const deps = serv.buildEndpointDeps(tenant);
  const result = await handleAuthorize(
    { method: 'GET', url: req.url, headers: req.headers, userId: req.session?.userId },
    deps
  );
  res.status(result.status).set(result.headers).send(result.body);
});
```

The caller is responsible for:
- Parsing form bodies (pass as raw string in `AuthRequest.body`)
- Populating `req.userId` from session middleware (cookie-based, beyond scope of the AS itself)
- Rate-limiting `/register` and `/token` per source IP (use `src/shared/security.ts:ipInAllowlist` + your own bucket)
- TLS termination

## Store implementations

All five stores (`AuthCodeStore`, `RefreshTokenStore`, `ClientRegistry`, `ConsentStore`, `PendingAuthorizationStore`) ship with in-memory implementations suitable for single-instance self-host. Multi-instance deployments must provide shared backends:

| Store | In-memory | Needed for multi-instance |
|---|---|---|
| AuthCodeStore | Yes | SQLite/Redis with 60s TTL |
| RefreshTokenStore | Yes | SQLite/Redis with 30-day TTL |
| ClientRegistry | Yes | SQLite/D1 (persistent) |
| ConsentStore | Yes | SQLite/D1 (persistent) |
| PendingAuthorizationStore | Yes | SQLite/Redis with 10-min TTL |

Persistent backends are not yet shipped; the interfaces are stable and implementing them is straightforward.

## Not yet implemented

- JWKS publication endpoint (`/.well-known/jwks.json`) — `JwtService.exportJwk()` returns the JWK, but an HTTP route needs to be mounted by the SERV host app.
- Upstream federation login UI — photon-side `/login` that consumes `return_to` and drives GitHub/Microsoft auth. Handlers + provider wiring exist (`src/serv/auth/oauth.ts`); the HTML + session-cookie glue is an integrator concern today.
- Subject token types beyond `access_token` in RFC 8693 exchange (SAML, external JWTs).

## Metrics

When `@opentelemetry/api` is installed, the AS emits:

- **`mcp_auth.events`** counter, attributes: `endpoint`, `status`, `grant_type?`, `client_type?`, `error_code?`. One increment per handler invocation.
- **`mcp_auth.cimd.fetches`** counter, attributes: `status`, `cached`, `mcp_auth.cimd_error?`. One increment per CIMD resolution attempt.

These let operators see CIMD vs DCR adoption, cache hit rate, and per-grant error rates without log sampling.

## Security invariants

- PKCE S256 is mandatory on every `/authorize` call. Plain method rejected.
- Authorization codes are single-use; the store deletes the code on `consume()` even if expired.
- Refresh tokens rotate on every use; the superseded token is removed atomically.
- `redirect_uri` matching is exact, not prefix. Trailing slashes matter.
- CIMD domain allowlist short-circuits before the network fetch — a malicious client can't trigger a DNS lookup to an internal IP.
- Consent records are keyed on `client_id` (the CIMD URL), not display name, to prevent spoofing.
- Client secrets are stored as SHA-256 hashes; presented secrets are compared with `timingSafeEqual`.

## Related documents

- `docs/guides/AUTH.md` : user-facing `@auth` guide for photon authors
- `docs/guides/mcp-client-registration.md` : how to register as a CIMD or DCR client
- `_photon/plans/mcp-security-study.md` : full threat model and phase roadmap
