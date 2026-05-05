/**
 * Auth → instance binding registry (Track C).
 *
 * For multi-tenant `@stateful` photons: when a caller authenticates, the
 * loader looks up the photon's `@auth` scheme here to find which JWT/identity
 * claim should drive the per-user instance name. Photons get one isolated
 * `this.memory` namespace per claim value without their authors writing
 * per-call routing.
 *
 *   /‍** @auth cf-access *‍/  →  caller.claims.email   →  instance "alice@x.com"
 *   /‍** @auth oauth     *‍/  →  caller.claims.sub     →  instance "user_42"
 *
 * The registry is a pure module (no I/O, no state). The Cloudflare Worker
 * template runs the equivalent mapping at the outer Worker layer (per-DO
 * selection); see `extractInstance` in `templates/cloudflare/worker.ts.template`.
 *
 * Scope note: this fills `parameters._targetInstance` for downstream
 * consumers (the daemon at `daemon/server.ts:4408` and the streamable-HTTP
 * transport at `:1928-1933`). The standalone `photon mcp` server is
 * single-tenant by design — it loads one photon instance per process — so
 * the binding has no effect there. Multi-tenant deploys go through the
 * daemon or Cloudflare.
 */

/**
 * Default claim name for each well-known `@auth` scheme. Matches the
 * Cloudflare Worker template's `extractInstance` behavior so an auth-bound
 * photon picks the same instance name on the local daemon and on CF.
 */
const SCHEME_DEFAULT_CLAIM: Record<string, string> = {
  'cf-access': 'email',
  oauth: 'sub',
};

/**
 * Resolve the instance name a caller should be routed to, based on their
 * auth scheme + claims. Returns undefined when the scheme is unknown, the
 * required claim is missing, or claims is empty — the caller should leave
 * `_targetInstance` unset and fall back to the default singleton.
 *
 * @param scheme    Value from `@auth <scheme>` (e.g. `cf-access`, `oauth`)
 * @param claims    Authenticated caller's claim bag (from `caller.claims`)
 * @param override  Optional explicit claim name from `@auth <scheme> claim=<name>`
 *                  — wins over the scheme default. Lets a photon route by
 *                  org id, tenant slug, etc., without a new scheme entry.
 */
export function resolveInstanceFromClaims(
  scheme: string | undefined,
  claims: Record<string, unknown> | undefined,
  override?: string
): string | undefined {
  if (!claims || typeof claims !== 'object') return undefined;
  const claimName = override ?? (scheme ? SCHEME_DEFAULT_CLAIM[scheme] : undefined);
  if (!claimName) return undefined;
  const value = claims[claimName];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

/**
 * Parse the `claim=<name>` modifier from an `@auth` directive value.
 *
 *   `cf-access`             → { scheme: 'cf-access', claim: undefined }
 *   `cf-access claim=email` → { scheme: 'cf-access', claim: 'email' }
 *   `oauth claim=org_id`    → { scheme: 'oauth',     claim: 'org_id' }
 *
 * Loader callers pass the resulting `claim` field to
 * `resolveInstanceFromClaims` as the override.
 */
export function parseAuthDirective(value: string | undefined): {
  scheme: string | undefined;
  claim: string | undefined;
} {
  if (!value) return { scheme: undefined, claim: undefined };
  const parts = value.trim().split(/\s+/);
  const scheme = parts[0];
  let claim: string | undefined;
  for (const part of parts.slice(1)) {
    const m = part.match(/^claim=(.+)$/);
    if (m) {
      claim = m[1];
      break;
    }
  }
  return { scheme, claim };
}

/** Exposed for tests so the table stays in sync with the CF worker template. */
export function getSchemeDefaultClaim(scheme: string): string | undefined {
  return SCHEME_DEFAULT_CLAIM[scheme];
}
