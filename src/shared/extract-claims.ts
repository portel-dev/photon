/**
 * Extract auth claims from incoming HTTP request headers.
 *
 * Used by the standalone HTTP server (Track C closure) to discover which
 * claim bag the per-claim instance pool should key on. Two sources are
 * recognized today, matching what `extractInstance` in the Cloudflare
 * Worker template recognizes — same headers, same precedence:
 *
 *   1. `Cf-Access-Authenticated-User-Email` — set by Cloudflare Access at
 *      the edge after JWT verification. Trusted (origin is behind CF).
 *   2. `Cf-Access-Jwt-Assertion` — the raw JWT. Decoded payload fields
 *      (email, sub, ...) are merged into the claim bag. The signature is
 *      NOT re-verified; CF already validated it before forwarding to the
 *      origin. If you run the standalone server outside Cloudflare and
 *      want a different trust boundary, add a verification step here.
 *
 * The standalone server is the only consumer right now. The MCP daemon
 * pulls claims from its CLI / streamable-HTTP authentication path; the
 * Cloudflare Worker template does its own header read. Keep the three
 * surfaces in sync when adding a new claim source.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { Buffer } from 'node:buffer';

/**
 * Read claims from CF Access headers. Returns undefined when no
 * recognized auth headers are present so the caller can fall back to the
 * default instance without a bound claim.
 *
 * The returned bag uses lowercased standard claim names (`email`, `sub`,
 * etc.) so `resolveInstanceFromClaims` finds them by their canonical key
 * regardless of the JWT's casing.
 */
export function extractClaimsFromHeaders(
  headers: IncomingHttpHeaders
): Record<string, unknown> | undefined {
  const claims: Record<string, unknown> = {};

  const cfEmail = headers['cf-access-authenticated-user-email'];
  if (typeof cfEmail === 'string' && cfEmail.length > 0) {
    claims.email = cfEmail;
  }

  const cfJwt = headers['cf-access-jwt-assertion'];
  if (typeof cfJwt === 'string' && cfJwt.includes('.')) {
    try {
      const part = cfJwt.split('.')[1];
      const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
      const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf-8'
      );
      const payload = JSON.parse(decoded) as Record<string, unknown>;
      // Don't overwrite a claim already set from a more specific header.
      for (const [k, v] of Object.entries(payload)) {
        if (!(k in claims)) claims[k] = v;
      }
    } catch {
      // Malformed JWT — silently ignore, the email header (if present)
      // already populated the bag. A misformed JWT shouldn't 500 the
      // request; the auth gate downstream decides what to do with no
      // claims.
    }
  }

  return Object.keys(claims).length > 0 ? claims : undefined;
}
