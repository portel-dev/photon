# Securing MCP with JWT

Photon can protect deployed MCP tool calls with short-lived JWT access tokens.
This is the recommended V1 path when you want known agents to manage a photon
without sharing a long-lived bearer secret.

This guide covers the local-issuer flow:

- the deployer creates an ES256 signing key on their machine
- Photon deploys only public verification material with the Worker
- agents receive short-lived scoped JWTs
- `/mcp` verifies the token before user code runs
- method-level `@scope` can override the default per-tool scope

For user OAuth against third-party APIs, see [OAuth Authentication](AUTH.md).
For MCP client registration with a hosted Photon authorization server, see
[Registering an MCP Client with a Photon AS](mcp-client-registration.md).

## When to Use This

Use MCP JWT auth when:

- you deploy a single-tenant photon
- one or more trusted agents need to call MCP tools
- you want scoped, expiring credentials instead of one shared bearer string
- you are not yet running a hosted OAuth approval server

For multi-tenant approval flows, use the Photon authorization server design
instead of local issuer mode. Local issuer mode is deliberately small: it gives
one deployer a secure way to authorize their own agents.

## Quick Start

Create a keypair for the photon:

```bash
photon auth init appointments
```

Deploy the photon with JWT auth enabled:

```bash
photon host deploy cf appointments \
  --mcp-auth jwt \
  --mcp-audience https://appointments.example.com/mcp
```

Issue a short-lived token for an agent:

```bash
photon auth token appointments \
  --agent scheduler \
  --audience https://appointments.example.com/mcp \
  --scope bookings:write \
  --ttl 15m
```

Verify a token locally:

```bash
photon auth verify appointments "$TOKEN" \
  --audience https://appointments.example.com/mcp
```

The agent calls MCP with:

```http
Authorization: Bearer <jwt>
```

## Tool Scopes

Photon assigns every MCP tool a default scope when JWT auth is active:

- `@readOnly` methods require `<toolName>:read`
- all other methods require `<toolName>:write`

Use method-level `@scope` only when the default tool-name scope is not the
permission vocabulary you want to expose.

```typescript
export default class Appointments {
  /**
   * Book a paid consultation slot.
   * @scope bookings:write
   */
  async book({ slotId }: { slotId: string }) {
    return {
      booked: true,
      slotId,
      bookedBy: this.caller.id,
    };
  }

  /**
   * Read available consultation slots.
   * @scope bookings:read
   */
  async slots() {
    return [{ id: 'slot_1', startsAt: '2026-06-01T09:00:00Z' }];
  }
}
```

Scope rules:

- `@scope a b` requires both `a` and `b`
- repeated `@scope` tags are additive
- `@scope` is method-level only
- no `@scope` means Photon uses `<toolName>:read` or `<toolName>:write`
- `@internal` and `@audience user` are visibility hints, not authorization

## What Gets Stored Where

`photon auth init appointments` creates files under:

```text
~/.photon/auth/appointments/
  private.jwk
  public.jwk
  jwks.json
  issuer.json
```

`private.jwk` stays on the deployer's machine and is used only by
`photon auth token`. Do not commit or deploy it.

`jwks.json` contains public verification keys. When you deploy with
`--mcp-auth jwt`, Photon embeds this public verification material in the
generated Worker so the Worker can verify signatures.

## Audience Must Match

The deploy audience and token audience must be the same value:

```bash
photon host deploy cf appointments \
  --mcp-auth jwt \
  --mcp-audience https://appointments.example.com/mcp

photon auth token appointments \
  --agent scheduler \
  --audience https://appointments.example.com/mcp \
  --scope bookings:write
```

If the `aud` claim does not match, the Worker rejects the token.

## Runtime Behavior

For MCP methods that dispatch user code:

| Condition | Response |
|---|---|
| missing token | `401 Unauthorized` |
| invalid signature, issuer, audience, or expiry | `401 Unauthorized` |
| valid token missing a required scope | `403 Forbidden` |
| valid token with required scopes | tool executes |

Discovery methods such as `initialize`, `tools/list`, and `ping` remain
callable so clients can discover the server before they have a token.

Inside tool code, `this.caller` is populated from the JWT:

```typescript
{
  id: 'agent:scheduler',
  name: undefined,
  anonymous: false,
  scope: 'bookings:write',
  claims: { ... }
}
```

## Local Beam and SSE Testing

The same JWT mode can be tested locally. The easiest path points the local
server at an existing auth profile on disk:

```bash
export PHOTON_MCP_AUTH_MODE=jwt
export PHOTON_MCP_JWT_PROFILE=appointments
export PHOTON_MCP_JWT_AUDIENCE=http://127.0.0.1:3000/mcp

photon mcp appointments --transport sse --port 3000
```

`PHOTON_MCP_JWT_PROFILE` reads `~/.photon/auth/<name>/issuer.json` and
`jwks.json` directly, so the issuer string and JWKS are picked up from disk.
The profile is cached per process, so the keys are read once at startup.

Inline JWKS still works for ephemeral test setups:

```bash
export PHOTON_MCP_AUTH_MODE=jwt
export PHOTON_MCP_JWT_ISSUER=photon-local:appointments
export PHOTON_MCP_JWT_AUDIENCE=http://127.0.0.1:3000/mcp
export PHOTON_MCP_JWT_JWKS='{"keys":[...]}'
```

Then call `http://127.0.0.1:3000/mcp` with `Authorization: Bearer <jwt>`.

## Audience Claim

`claims.aud` is matched against the configured audience. Both forms of the
`aud` claim defined in RFC 7519 are accepted: a single string, or an array of
strings (the configured audience must appear in the array). Photon's own
issuer always emits a single-string `aud`, so this matters only when verifying
tokens minted by other issuers.

## Trying Tools from the Bundled Playground

The deploy-time playground at `/` POSTs `tools/call` to `/mcp`. When JWT (or
bearer) auth is active, the playground includes an `Authorization: Bearer
<token>` header on each call. Use the **Set token** link above the tool form
to paste a JWT issued by `photon auth token` (the token is kept in this
browser's `localStorage` only, key `photon_mcp_token`). **Clear token** wipes
it. A `401` or `403` response shows a hint to set or refresh the token.

## Key rotation

The Worker does not fetch JWKS at runtime. Photon bakes the contents of
`~/.photon/auth/<name>/jwks.json` into the generated Worker bundle at deploy
time by substituting `__MCP_JWT_JWKS__` in the Worker template. There is no
remote JWKS endpoint and no in-Worker key fetch, so any key change only takes
effect after a fresh `photon host deploy cf`.

`jwks.json` is a JWKS array, and every token carries a `kid` in its JWT header
that the Worker matches against the entries in that array. Multi-key JWKS is
therefore safe: tokens signed by the old key keep verifying as long as the old
public key is still in the array.

To rotate without breaking in-flight tokens:

1. Run `photon auth init <name> --rotate` to generate a new keypair.
2. Edit `~/.photon/auth/<name>/jwks.json` so it lists BOTH the old and the new
   public keys.
3. Redeploy with `--mcp-auth jwt`. The Worker now accepts tokens signed by
   either key, matched by `kid`.
4. Wait until every outstanding token has expired (default TTL is 15 minutes;
   wait at least one full TTL window).
5. Trim `jwks.json` back to just the new public key and redeploy again. The
   old key is now fully retired.

Skip steps 2 to 4 only if you are willing to invalidate every live token at
the moment of redeploy.

## Compatibility with Bearer Auth

`PHOTON_MCP_BEARER` still works for existing deployments when JWT mode is not
enabled. Once you deploy with `--mcp-auth jwt`, MCP tool calls must use JWTs;
the deploy command warns about this so existing bearer clients can migrate.

## Security Notes

- Keep `private.jwk` local and out of source control.
- Use short TTLs for agent tokens.
- Grant only the scopes each agent needs.
- Treat the audience as part of the resource identity; do not reuse tokens
  across different deployments.
- Public web routes declared with `@get`, `@post`, or `@expose public` are not
  protected by MCP JWT auth. Route-level HTTP auth remains the photon's
  responsibility.

## Related References

- [Supported Docblock Tags](../reference/DOCBLOCK-TAGS.md)
- [Deployment](DEPLOYMENT.md)
- [OAuth Authentication](AUTH.md)
- [MCP Client Registration](mcp-client-registration.md)
