# Registering an MCP Client with a Photon AS

Photon's authorization server accepts MCP clients via two paths: Client ID Metadata Documents (CIMD, the preferred modern approach) and Dynamic Client Registration (DCR, RFC 7591, kept for back-compat). This guide shows which to use, when, and how.

## tl;dr: which path should I use?

| Scenario | Use | Why |
|---|---|---|
| You control a public HTTPS URL (claude.ai, cursor.com, a CDN) | **CIMD** | No registration state, policy lives on the AS, redirect URIs can't be sneaked in. |
| You're a desktop app with no stable public URL | **DCR** | CIMD requires a reachable HTTPS URL for the client_id; desktop apps rarely have one. |
| You're writing a server-to-server integration | **DCR** | Use `client_credentials` grant with a stored `client_secret`. |
| You're building an MCP client and want it to "just work" with unknown photon AS instances | **CIMD** | Widest compatibility, no per-server registration step. |

## Option A: CIMD (preferred)

### How it works

Your `client_id` is an HTTPS URL that you control. That URL returns a JSON metadata document describing your client. When the photon AS sees the URL, it fetches the document and uses it as the authoritative source of truth for your client's identity and redirect URIs.

No registration endpoint, no state on the AS, no shared secret between your client and every AS that talks to you.

### Step 1. Host a metadata document

Publish a JSON document at a stable HTTPS URL. Example: `https://claude.ai/.well-known/oauth-client`.

```json
{
  "client_id": "https://claude.ai/.well-known/oauth-client",
  "client_name": "Claude",
  "client_uri": "https://claude.ai",
  "logo_uri": "https://claude.ai/logo.png",
  "redirect_uris": [
    "https://claude.ai/mcp/callback",
    "com.anthropic.claude://oauth"
  ],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "mcp:read mcp:write",
  "contacts": ["security@claude.ai"],
  "tos_uri": "https://claude.ai/terms",
  "policy_uri": "https://claude.ai/privacy"
}
```

Required fields: `client_id` (must match the URL exactly) and `redirect_uris` (non-empty array). All others optional.

Set `Cache-Control: max-age=3600` (or whatever TTL you want, 1 hour recommended) and optionally an `ETag` so the AS can revalidate cheaply.

### Step 2. Start an authorization request

Use the metadata URL directly as `client_id`:

```
GET https://photon-host.example.com/tenant/test/authorize?
    client_id=https%3A%2F%2Fclaude.ai%2F.well-known%2Foauth-client&
    redirect_uri=https%3A%2F%2Fclaude.ai%2Fmcp%2Fcallback&
    response_type=code&
    scope=mcp%3Aread&
    state=<csrf-token>&
    code_challenge=<base64url(sha256(verifier))>&
    code_challenge_method=S256
```

The AS fetches your metadata document, verifies `client_id` matches and `redirect_uri` is in the allowed list, then proceeds as a normal authorization code flow.

### Step 3. Exchange the code for tokens

Identical to standard OAuth 2.1. The only difference: `client_id` stays the HTTPS URL throughout.

```
POST https://photon-host.example.com/tenant/test/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code>
&redirect_uri=https://claude.ai/mcp/callback
&code_verifier=<verifier>
&client_id=https://claude.ai/.well-known/oauth-client
```

### What about tenant-level trust?

Tenant admins can set `tenant.settings.allowedClientDomains` to restrict which CIMD hosts are accepted. Examples:

- `["claude.ai", "*.openai.com"]` : allow Claude at exactly `claude.ai`, allow anything on the `openai.com` domain.
- `[]` or undefined : allow any HTTPS host (default).

This is the primary defense against CIMD phishing: an attacker who can buy a similar-looking domain can publish a valid CIMD document, but it won't resolve unless the tenant admin has allowlisted that host.

## Option B: DCR (RFC 7591)

Use this when you don't have a stable public HTTPS URL.

### Register

```
POST https://photon-host.example.com/tenant/test/register
Content-Type: application/json

{
  "client_name": "My Desktop App",
  "redirect_uris": ["http://127.0.0.1:8787/cb"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "mcp:read"
}
```

The response gives you a `client_id` and (for confidential clients) a `client_secret`:

```json
{
  "client_id": "Xd7k...",
  "client_id_issued_at": 1744934400,
  "client_name": "My Desktop App",
  "redirect_uris": ["http://127.0.0.1:8787/cb"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "mcp:read"
}
```

Set `token_endpoint_auth_method: "none"` for public clients (desktop apps, SPAs, CLI tools). Omit it or set to `client_secret_basic` for confidential clients; you'll get a `client_secret` back, store it securely.

### Authorize + token exchange

Identical to CIMD except `client_id` is the opaque identifier the AS gave you.

### DCR is loud on purpose

Every `/register` call logs a structured warning so operators can see real CIMD adoption. This is intentional and harmless. If you have a public HTTPS URL, prefer CIMD: one fewer piece of shared state, one less thing to rotate if leaked, one less thing the operator has to trust.

## PKCE is mandatory

Both CIMD and DCR clients must use PKCE with `code_challenge_method=S256`. Plain method is rejected. Generate:

```js
const verifier = base64url(crypto.randomBytes(32));
const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
```

Send `challenge` on `/authorize`, send `verifier` on `/token`. The AS verifies `sha256(verifier) === challenge`.

## Consent

On first authorization for a given `(user, client_id, scope_set)`, the user sees an HTML consent screen listing your client name, optional logo, and requested scopes. If they approve, the AS remembers the decision for 30 days; subsequent authorizations for the same or narrower scope set skip the screen.

First-party clients (Photon CLI, Beam UI) are on an internal allowlist and skip consent unconditionally.

To force a fresh consent prompt, add `prompt=consent` to the authorize URL. To require silent auth (fail if consent isn't cached), add `prompt=none` per OIDC Core §3.1.2.4.

## Well-known discovery

Photon advertises AS capabilities at:

- `GET /tenant/<slug>/.well-known/oauth-authorization-server` : endpoints, supported grants, supported scopes. Includes `client_id_metadata_document_supported: true` as the CIMD signal.
- `GET /tenant/<slug>/.well-known/oauth-protected-resource` : RFC 9728 resource metadata for MCP callers.

MCP clients should fetch these at connection time and discover the `authorization_endpoint` / `token_endpoint` / `registration_endpoint` dynamically rather than hardcoding.

## Related

- `docs/internals/OAUTH-AUTHORIZATION-SERVER.md` : AS architecture and design decisions
- `docs/guides/AUTH.md` : photon author guide for `@auth required|optional|<issuer>`
- RFC 6749 (OAuth 2.0), RFC 7591 (DCR), RFC 7636 (PKCE), RFC 9700 (OAuth 2.0 Security BCP)
- MCP spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
