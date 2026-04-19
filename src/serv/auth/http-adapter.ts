/**
 * HTTP adapter for the OAuth 2.1 authorization server.
 *
 * Bridges Node's IncomingMessage / ServerResponse to the pure-function
 * `AuthRequest` / `AuthResponse` shape that the endpoint handlers speak.
 * Same composition pattern as `handleStreamableHTTP` in
 * src/auto-ui/streamable-http-transport.ts: returns `true` when the
 * request was matched + handled, `false` so the host HTTP server can
 * fall through to other routes.
 *
 * Routes mounted:
 *   GET  /tenant/<slug>/.well-known/oauth-authorization-server
 *   GET  /tenant/<slug>/.well-known/oauth-protected-resource
 *   GET  /tenant/<slug>/authorize
 *   POST /tenant/<slug>/token
 *   POST /tenant/<slug>/register
 *   GET  /tenant/<slug>/consent
 *   POST /tenant/<slug>/consent
 *   POST /tenant/<slug>/revoke
 *   POST /tenant/<slug>/introspect
 *
 * `<slug>` is optional when `singleTenant` is configured — the same
 * routes are also accepted at the path root for self-host deployments.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import {
  handleAuthorize,
  handleConsent,
  handleToken,
  handleRegister,
  handleRevoke,
  handleIntrospect,
  type AuthRequest,
  type AuthResponse,
  type EndpointDeps,
} from './endpoints.js';
import {
  handleAuthServerRequest,
  handleProtectedResourceRequest,
  type WellKnownConfig,
} from './well-known.js';
import type { Serv } from '../index.js';
import type { Tenant } from '../types/index.js';

// ============================================================================
// Adapter options
// ============================================================================

export interface AuthServerHTTPOptions {
  /** The Serv instance that owns the AS state. */
  serv: Serv;
  /**
   * Resolve the tenant for a request. Typical implementations pull the
   * slug from the URL path (`/tenant/<slug>/...`), look it up in the
   * tenant store, and return the Tenant row (or null for 404).
   */
  resolveTenant: (req: IncomingMessage, slug: string | null) => Promise<Tenant | null>;
  /**
   * Resolve the caller identity from the request. Returns `undefined` for
   * unauthenticated requests — `/authorize` will then redirect to the
   * configured login URL with `return_to`. For the self-host
   * `PHOTON_SINGLE_USER=1` short-circuit, bake the tenant-owner id into
   * the return value so every request lands authenticated.
   */
  resolveUserId: (req: IncomingMessage, tenant: Tenant) => Promise<string | undefined>;
  /**
   * When set, also accept the AS endpoints at the root path (no
   * `/tenant/<slug>/` prefix). The `resolveTenant` callback will be
   * invoked with `slug = null` so the host can return the single tenant.
   */
  singleTenant?: boolean;
  /** Optional structured logger. Best-effort. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Public entrypoint
// ============================================================================

/**
 * Match + handle an AS HTTP request. Returns `false` when the request's
 * path doesn't belong to the AS so the host can fall through to other
 * mounts. Returns `true` for handled, rejected, or errored requests.
 */
export async function handleAuthServerHTTP(
  req: IncomingMessage,
  res: ServerResponse,
  options: AuthServerHTTPOptions
): Promise<boolean> {
  const parsed = parsePathname(req, options.singleTenant);
  if (!parsed) return false;

  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  const tenant = await options.resolveTenant(req, parsed.slug);
  if (!tenant) {
    writeJson(res, 404, { error: 'tenant_not_found', error_description: 'Unknown tenant slug' });
    return true;
  }

  // Well-known metadata is tenant-scoped but doesn't need full endpoint deps.
  const wellKnownConfig: WellKnownConfig = options.serv.wellKnownConfig;
  if (parsed.endpoint === '.well-known/oauth-authorization-server' && req.method === 'GET') {
    const response = handleAuthServerRequest(wellKnownConfig, tenant);
    writeResponse(res, response);
    return true;
  }
  if (parsed.endpoint === '.well-known/oauth-protected-resource' && req.method === 'GET') {
    const response = handleProtectedResourceRequest(wellKnownConfig, tenant);
    writeResponse(res, response);
    return true;
  }

  const deps = options.serv.buildEndpointDeps(tenant);
  // Build the AuthRequest. /authorize uses query params only, so reading
  // the body would waste cycles; everything else expects form-urlencoded
  // or JSON. parseBody handles both with a size cap.
  const needsBody = req.method === 'POST';
  let body: string | undefined;
  if (needsBody) {
    try {
      body = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === 'body_too_large') {
        writeJson(res, 413, {
          error: 'invalid_request',
          error_description: 'request body exceeds the configured maximum',
        });
      } else {
        writeJson(res, 400, {
          error: 'invalid_request',
          error_description: 'could not read request body',
        });
      }
      return true;
    }
  }

  const userId = await options.resolveUserId(req, tenant);
  const authReq: AuthRequest = {
    method: req.method ?? 'GET',
    url: absoluteUrl(req),
    headers: normalizeHeaders(req.headers),
    body,
    userId,
  };

  const response = await dispatch(parsed.endpoint, authReq, deps);
  if (!response) {
    // Matched the /tenant/... prefix but not a known endpoint — fall
    // through so the host can surface its own 404 shape.
    return false;
  }

  options.log?.('info', 'as_http_request', {
    endpoint: parsed.endpoint,
    status: response.status,
    tenant: tenant.slug,
  });
  writeResponse(res, response);
  return true;
}

// ============================================================================
// Route dispatch
// ============================================================================

async function dispatch(
  endpoint: string,
  req: AuthRequest,
  deps: EndpointDeps
): Promise<AuthResponse | null> {
  switch (endpoint) {
    case 'authorize':
      return handleAuthorize(req, deps);
    case 'token':
      return handleToken(req, deps);
    case 'register':
      return handleRegister(req, deps);
    case 'consent':
      return handleConsent(req, deps);
    case 'revoke':
      return handleRevoke(req, deps);
    case 'introspect':
      return handleIntrospect(req, deps);
    default:
      return null;
  }
}

// ============================================================================
// Path parsing
// ============================================================================

interface ParsedPath {
  slug: string | null;
  endpoint: string;
}

/**
 * Recognize `/tenant/<slug>/<endpoint>` and, when singleTenant is set,
 * the bare `/endpoint` form. The endpoint bucket preserves the
 * `.well-known/...` sub-path when present.
 */
function parsePathname(req: IncomingMessage, singleTenant?: boolean): ParsedPath | null {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  if (parts[0] === 'tenant') {
    if (parts.length < 3) return null;
    const slug = parts[1];
    const endpoint = parts.slice(2).join('/');
    if (!KNOWN_ENDPOINTS.has(endpoint)) return null;
    return { slug, endpoint };
  }

  if (singleTenant) {
    const endpoint = parts.join('/');
    if (!KNOWN_ENDPOINTS.has(endpoint)) return null;
    return { slug: null, endpoint };
  }

  return null;
}

const KNOWN_ENDPOINTS = new Set([
  'authorize',
  'token',
  'register',
  'consent',
  'revoke',
  'introspect',
  '.well-known/oauth-authorization-server',
  '.well-known/oauth-protected-resource',
]);

// ============================================================================
// Request/response plumbing
// ============================================================================

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB — plenty for any AS request

function absoluteUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  // The `forwarded`/`x-forwarded-proto` headers win when present so
  // reverse-proxied deployments see the real external scheme.
  const proto = firstHeader(req.headers['x-forwarded-proto']) ?? 'http';
  return `${proto}://${host}${req.url ?? '/'}`;
}

function normalizeHeaders(
  raw: IncomingMessage['headers']
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}

function firstHeader(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (!tooLarge && size > maxBytes) {
        tooLarge = true;
      }
      if (!tooLarge) chunks.push(chunk);
      // Don't destroy the socket here — drain remaining chunks so the
      // caller can still write a proper 413 response. Destroying the
      // request mid-read leaves the client with ECONNRESET and no way
      // to distinguish "too large" from "server crashed."
    });
    req.on('end', () => {
      if (tooLarge) reject(new Error('body_too_large'));
      else resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

function writeResponse(res: ServerResponse, response: AuthResponse): void {
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined) res.setHeader(key, value);
  }
  res.writeHead(response.status);
  res.end(response.body);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
