# Photon browser sessions

Photons that declare:

```ts
/**
 * @auth email passkey optional
 */
export default class MyPhoton {
  /** @get /account */
  async account(request: Request) {
    const session = (this as any).webSession;
    if (!session) {
      return Response.redirect(new URL('/login?return_to=/account', request.url), 302);
    }
    return new Response(`Signed in as ${session.sub} (${session.role})`);
  }
}
```

automatically receive browser login routes in the generated Cloudflare Worker:

- `GET /login?return_to=/account` starts the existing email/passkey flow.
- `GET /logout?return_to=/` revokes the current browser session.
- `GET /account` (or any Photon-owned route) can read `this.webSession`.

The session is an opaque, `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only a
SHA-256 hash of the cookie is stored in the Photon Durable Object. Sessions
expire after 30 days and are deleted when they expire or when the user signs
out. The `sub` and `role` come from the same verified email/passkey identity
used by MCP OAuth, so the host mapping remains centralized in:

```text
PHOTON_MCP_OAUTH_HOST_SUBJECTS=owner@example.com
```

Use relative same-origin `return_to` paths only. Photon rejects external
redirects. For state-changing Photon HTTP routes, require the session and
validate the session's `csrfToken` against a request token before mutating
state. Signed booking links remain independent of the browser session and are
still the appropriate mechanism for a guest to manage one booking.

The runtime exposes the current HTTP `Request` as `this.request` while a
tagged HTTP route or `@expose` method is running. This is request-scoped and
safe for concurrent requests.
