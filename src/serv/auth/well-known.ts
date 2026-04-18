/**
 * Well-Known Endpoints
 *
 * Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata)
 */

import type {
  ProtectedResourceMetadata,
  AuthorizationServerMetadata,
  Tenant,
} from '../types/index.js';

// Timeout for fetching client metadata
const FETCH_TIMEOUT_MS = 10 * 1000;

// ============================================================================
// Endpoint Configuration
// ============================================================================

export interface WellKnownConfig {
  /** Base URL for SERV (e.g., 'https://serv.example.com') */
  baseUrl: string;
  /** Scopes supported by SERV */
  scopesSupported?: string[];
  /** Documentation URL */
  documentationUrl?: string;
}

// ============================================================================
// Protected Resource Metadata (RFC 9728)
// ============================================================================

/**
 * Generate protected resource metadata for a tenant
 */
export function generateProtectedResourceMetadata(
  config: WellKnownConfig,
  tenant: Tenant
): ProtectedResourceMetadata {
  const resourceUri = buildResourceUri(config.baseUrl, tenant);
  const authServerUri = buildAuthServerUri(config.baseUrl, tenant);

  return {
    resource: resourceUri,
    authorization_servers: [authServerUri],
    bearer_methods_supported: ['header'],
    resource_documentation: config.documentationUrl,
  };
}

// ============================================================================
// Authorization Server Metadata (RFC 8414)
// ============================================================================

/**
 * Generate authorization server metadata for a tenant
 */
export function generateAuthServerMetadata(
  config: WellKnownConfig,
  tenant: Tenant
): AuthorizationServerMetadata {
  const baseUri = buildTenantUri(config.baseUrl, tenant);

  return {
    issuer: baseUri,
    authorization_endpoint: `${baseUri}/authorize`,
    token_endpoint: `${baseUri}/token`,
    registration_endpoint: `${baseUri}/register`,
    jwks_uri: `${config.baseUrl}/.well-known/jwks.json`,
    scopes_supported: config.scopesSupported ?? [
      'openid',
      'profile',
      'email',
      'mcp:read',
      'mcp:write',
      'mcp:admin',
    ],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none', // For public clients
    ],
    // Draft extension: signals this AS accepts CIMD-style HTTPS client_ids.
    // Not yet standardised in RFC 8414, but MCP-spec-aligned.
    client_id_metadata_document_supported: true,
  } as AuthorizationServerMetadata;
}

// ============================================================================
// Client ID Metadata Document (CIMD) - November 2025 Spec
// ============================================================================

export interface ClientMetadataDocument {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
}

/**
 * Error taxonomy for CIMD resolution failures. Maps to OAuth `invalid_client`
 * with distinct `error_description` so callers can diagnose misconfiguration.
 */
export type CimdError =
  | 'not_https'
  | 'fetch_failed'
  | 'http_error'
  | 'invalid_json'
  | 'client_id_mismatch'
  | 'missing_redirect_uris'
  | 'domain_not_allowed'
  | 'timeout';

export interface CimdResult {
  ok: boolean;
  metadata?: ClientMetadataDocument;
  error?: CimdError;
  errorDescription?: string;
  fromCache?: boolean;
}

export interface CimdFetchOptions {
  /** Allowlist of hostnames; supports exact match or leading wildcard (*.claude.ai). Empty = allow all. */
  allowedDomains?: string[];
  /** Cache to consult/update. If omitted, fetch is uncached. */
  cache?: CimdCache;
  /** Override fetch for testing. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1h fallback when no Cache-Control

/**
 * Resolve a CIMD client_id to its metadata document with full validation,
 * caching, and domain-allowlist enforcement.
 */
export async function resolveClientMetadata(
  clientId: string,
  opts: CimdFetchOptions = {}
): Promise<CimdResult> {
  if (!clientId.startsWith('https://')) {
    return {
      ok: false,
      error: 'not_https',
      errorDescription: 'client_id must be an HTTPS URL for CIMD resolution',
    };
  }

  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return {
      ok: false,
      error: 'not_https',
      errorDescription: 'client_id is not a valid URL',
    };
  }

  if (!isDomainAllowed(url.hostname, opts.allowedDomains)) {
    return {
      ok: false,
      error: 'domain_not_allowed',
      errorDescription: `client_id host '${url.hostname}' is not in tenant's allowed client domains`,
    };
  }

  // Cache lookup (with ETag revalidation deferred to refresh path)
  const cached = opts.cache?.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, metadata: cached.metadata, fromCache: true };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    response = await fetchImpl(clientId, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      error: isTimeout ? 'timeout' : 'fetch_failed',
      errorDescription: `CIMD fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 304: cache is still valid, extend expiry
  if (response.status === 304 && cached) {
    cached.expiresAt = Date.now() + resolveTtlMs(response);
    return { ok: true, metadata: cached.metadata, fromCache: true };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: 'http_error',
      errorDescription: `CIMD fetch returned HTTP ${response.status}`,
    };
  }

  let metadata: ClientMetadataDocument;
  try {
    metadata = (await response.json()) as ClientMetadataDocument;
  } catch {
    return {
      ok: false,
      error: 'invalid_json',
      errorDescription: 'CIMD response was not valid JSON',
    };
  }

  if (!metadata.client_id || metadata.client_id !== clientId) {
    return {
      ok: false,
      error: 'client_id_mismatch',
      errorDescription: 'client_id in metadata document does not match requested URL',
    };
  }

  if (!metadata.redirect_uris || metadata.redirect_uris.length === 0) {
    return {
      ok: false,
      error: 'missing_redirect_uris',
      errorDescription: 'CIMD metadata document must include at least one redirect_uri',
    };
  }

  opts.cache?.set(clientId, {
    metadata,
    etag: response.headers.get('etag') ?? undefined,
    expiresAt: Date.now() + resolveTtlMs(response),
  });

  return { ok: true, metadata };
}

/**
 * @deprecated Use resolveClientMetadata for structured errors + caching.
 * Retained for callers that only need the happy-path document.
 */
export async function fetchClientMetadata(
  clientId: string
): Promise<ClientMetadataDocument | null> {
  const result = await resolveClientMetadata(clientId);
  return result.ok ? (result.metadata ?? null) : null;
}

// ============================================================================
// CIMD Cache
// ============================================================================

interface CimdCacheEntry {
  metadata: ClientMetadataDocument;
  etag?: string;
  expiresAt: number;
}

/**
 * LRU cache for CIMD metadata. Eviction on insert past capacity.
 */
export class CimdCache {
  private entries = new Map<string, CimdCacheEntry>();
  constructor(private capacity = 500) {}

  get(clientId: string): CimdCacheEntry | undefined {
    const entry = this.entries.get(clientId);
    if (!entry) return undefined;
    // Re-insert to mark as most-recently-used
    this.entries.delete(clientId);
    this.entries.set(clientId, entry);
    return entry;
  }

  set(clientId: string, entry: CimdCacheEntry): void {
    if (this.entries.has(clientId)) {
      this.entries.delete(clientId);
    } else if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    this.entries.set(clientId, entry);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isDomainAllowed(hostname: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const host = hostname.toLowerCase();
  return allowlist.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) {
      const suffix = p.slice(1); // ".claude.ai"
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === p;
  });
}

function resolveTtlMs(response: Response): number {
  const cacheControl = response.headers.get('cache-control');
  if (!cacheControl) return DEFAULT_CACHE_TTL_MS;
  const match = /max-age=(\d+)/.exec(cacheControl);
  if (!match) return DEFAULT_CACHE_TTL_MS;
  const seconds = parseInt(match[1], 10);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_CACHE_TTL_MS;
  return seconds * 1000;
}

/**
 * Internal exports for tests only.
 */
export const __test__ = { isDomainAllowed, resolveTtlMs };

// ============================================================================
// URI Builders
// ============================================================================

function buildResourceUri(baseUrl: string, tenant: Tenant): string {
  if (tenant.settings.customDomain) {
    return `https://${tenant.settings.customDomain}/mcp`;
  }
  return `${baseUrl}/tenant/${tenant.slug}/mcp`;
}

function buildAuthServerUri(baseUrl: string, tenant: Tenant): string {
  if (tenant.settings.customDomain) {
    return `https://${tenant.settings.customDomain}`;
  }
  return `${baseUrl}/tenant/${tenant.slug}`;
}

function buildTenantUri(baseUrl: string, tenant: Tenant): string {
  if (tenant.settings.customDomain) {
    return `https://${tenant.settings.customDomain}`;
  }
  return `${baseUrl}/tenant/${tenant.slug}`;
}

// ============================================================================
// HTTP Handler Helpers
// ============================================================================

/**
 * Handle /.well-known/oauth-protected-resource request
 */
export function handleProtectedResourceRequest(
  config: WellKnownConfig,
  tenant: Tenant
): { status: number; headers: Record<string, string>; body: string } {
  const metadata = generateProtectedResourceMetadata(config, tenant);

  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify(metadata, null, 2),
  };
}

/**
 * Handle /.well-known/oauth-authorization-server request
 */
export function handleAuthServerRequest(
  config: WellKnownConfig,
  tenant: Tenant
): { status: number; headers: Record<string, string>; body: string } {
  const metadata = generateAuthServerMetadata(config, tenant);

  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify(metadata, null, 2),
  };
}

/**
 * Generate WWW-Authenticate header for 401 responses
 */
export function generateWwwAuthenticate(
  baseUrl: string,
  tenant: Tenant,
  error?: string,
  errorDescription?: string
): string {
  const parts = [
    'Bearer',
    `realm="${tenant.slug}"`,
    `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  ];

  if (error) {
    parts.push(`error="${error}"`);
    if (errorDescription) {
      parts.push(`error_description="${errorDescription}"`);
    }
  }

  return parts.join(', ');
}
