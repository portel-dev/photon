# Inbound OAuth for MCP Photons

Inbound OAuth authenticates an MCP client to a Photon so it can discover and
call tools on the caller's behalf. It is different from outbound provider
OAuth, where a Photon obtains a token to call another service.

## Declare inbound OAuth

Put the OAuth mode on the Photon class:

```ts
/**
 * @auth oauth optional
 */
export default class Consult {
  get role(): 'user' | 'customer' | 'host' {
    if (this.caller.anonymous) return 'user';
    return this.caller.role ?? 'customer';
  }
}
```

- `@auth oauth optional` permits anonymous requests for public tools. A
  supplied bearer token is still verified. Authenticated callers can receive a
  different catalog through property-based exposure.
- `@auth oauth required` requires a valid bearer token for every tool. An
  anonymous request receives an OAuth challenge.
- OAuth syntax is `@auth oauth <optional|required>`. The older forms,
  `@auth optional` and `@auth required`, are legacy authentication modes, not
  OAuth.

Photon performs OAuth discovery and bearer verification at the MCP endpoint.
Missing or invalid credentials are rejected; a valid token that lacks a
required scope is rejected separately.

## Anonymous, customer, and host access

Use three application roles:

| Caller                 | Typical capabilities                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| Anonymous (`user`)     | Find public availability and begin a booking.                              |
| Authenticated customer | Access that customer's bookings and permitted customer actions.            |
| Authenticated host     | Manage availability, appointments, promotions, and other owner operations. |

Authentication alone does not make a caller a host. The OAuth subject is mapped
to a role by the deployment, and the Photon exposes that role through
`this.caller`. Do not accept a role supplied in tool arguments. A provider may
name the non-host role `user`; normalize it to `customer` in the Photon getter
when the application needs to distinguish anonymous users from customers.

## Role-based tool exposure

`@class` conditions are method-level and are evaluated for both `tools/list`
and `tools/call`:

```ts
/**
 * Find public slots.
 * @class Consult {@role user}
 * @readOnly
 */
async listAvailableSlots() {}

/**
 * Read the caller's bookings.
 * @class Consult {@role customer}
 * @scope bookings:read
 */
async listMyBookings() {}

/**
 * Change host availability.
 * @class Consult {@role host}
 * @scope availability:write
 */
async updateAvailability() {}
```

The class name identifies the current Photon class or a policy class available
to the Photon. Each property comparison is exact string equality; there is no
inheritance or prefix matching. Multiple conditions are combined with AND:

```ts
/** @class Consult {@role host} {@plan pro} */
async premiumHostOperation() {}
```

Missing classes or properties, malformed conditions, undefined values, and
getter errors fail closed. Inaccessible tools are omitted from `tools/list`,
including linked MCP UI metadata, and the same condition is checked again at
`tools/call`. Catalog filtering is never the enforcement boundary.

## Scopes

`@scope` is an additional method-level authorization check:

```ts
/** @scope bookings:read bookings:write */
async changeBooking() {}
```

Space-separated scopes are required together; repeated tags are additive. If a
method has no explicit scope, Photon infers `<toolName>:read` for `@readOnly`
methods and `<toolName>:write` otherwise. Scopes come from the token's
space-delimited `scope` claim. A caller must satisfy both its `@class`
conditions and the method's scopes.

## Local development

Set a stable local public URL when testing OAuth:

```sh
export PHOTON_PUBLIC_URL=http://localhost:8787
```

The standalone runtime supports these identity settings:

| Variable                        | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `PHOTON_OAUTH_SINGLE_USER_ID`   | Local subject used for the single-user login flow.                                   |
| `PHOTON_OAUTH_SINGLE_USER_ROLE` | Role for that subject; defaults to `host`.                                           |
| `PHOTON_OAUTH_HOST_SUBJECTS`    | Comma-separated subject IDs treated as hosts. Other verified subjects are customers. |
| `PHOTON_OAUTH_SUBJECT_HEADER`   | Optional trusted reverse-proxy header from which to read the subject.                |
| `PHOTON_OAUTH_LOGIN_URL`        | External login URL; defaults to the runtime login route.                             |
| `PHOTON_OAUTH_KEY_ID`           | Optional signing-key identifier.                                                     |
| `PHOTON_OAUTH_JWT_SECRET`       | Optional local JWT secret.                                                           |

In development, Photon may generate ephemeral OAuth keys and secrets. For a
non-development runtime, configure all of these explicitly:

```text
PHOTON_OAUTH_PRIVATE_KEY_PEM
PHOTON_OAUTH_PUBLIC_KEY_PEM
PHOTON_OAUTH_ENCRYPTION_KEY
PHOTON_OAUTH_STATE_SECRET
```

Keep signing, encryption, and state secrets stable across restarts and deploys;
never use development-generated values in production.

## Cloudflare deployment

Deploy the MCP endpoint with OAuth enabled:

```sh
photon host deploy cf consult \
  --domain consult.example.com
```

The class-level `@auth oauth ...` tag enables OAuth automatically. Use
`--mcp-auth oauth` only when overriding a Photon that has no OAuth tag; that
explicit form defaults to required authentication.

The issuer must be a stable HTTPS URL. Set it explicitly with
`PHOTON_MCP_OAUTH_ISSUER`, or provide a canonical `--domain`, `--url`, or
`--route` from which Photon can derive it. Do not use an ephemeral URL that
changes between deployments; the issuer is part of token and metadata
validation.

Cloudflare OAuth state and the generated signing keypair are authoritative in
the host Durable Object's persistent storage. An optional
`PHOTON_MCP_OAUTH_KV_ID` binding is for integration, audit, replication, or
migration; it is not the authoritative OAuth state store. Configure the
generated login route with `PHOTON_MCP_OAUTH_LOGIN_URL` and
`PHOTON_MCP_OAUTH_LOGIN_SECRET`. Photon does not trust unsigned identity
headers; a login adapter must return the signed callback expected by the
generated authorization server.

If the installed CLI does not list `oauth` for `--mcp-auth`, update the CLI
before deploying; the guide does not change CLI compatibility.

## Inbound versus outbound provider OAuth

|                | Inbound OAuth                                         | Outbound provider OAuth                                               |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Direction      | MCP client authenticates to the Photon.               | Photon authenticates to Google, GitHub, or another provider.          |
| Purpose        | Select and authorize Photon tools for a caller.       | Let a Photon method call a third-party API for a user.                |
| Photon surface | `@auth oauth`, `this.caller`, `@class`, and `@scope`. | `yield { ask: 'oauth', provider, scopes }` and the provider registry. |
| Credentials    | Bearer token presented to the Photon's `/mcp`.        | Provider access/refresh tokens stored and used by the Photon runtime. |

These flows can be used together, but they have separate issuers, consent,
tokens, and security boundaries. See [AUTH.md](AUTH.md) for outbound provider
OAuth and [DOCBLOCK-TAGS.md](../reference/DOCBLOCK-TAGS.md) for the complete
Photon metadata reference.
