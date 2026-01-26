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
  };
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
 * Fetch and validate a Client ID Metadata Document
 */
export async function fetchClientMetadata(
  clientId: string
): Promise<ClientMetadataDocument | null> {
  // Client ID should be a URL for CIMD
  if (!clientId.startsWith('https://')) {
    return null;
  }

  try {
    const response = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const metadata = (await response.json()) as ClientMetadataDocument;

    // Validate required fields
    if (!metadata.client_id || metadata.client_id !== clientId) {
      return null;
    }

    if (!metadata.redirect_uris || metadata.redirect_uris.length === 0) {
      return null;
    }

    return metadata;
  } catch {
    return null;
  }
}

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
