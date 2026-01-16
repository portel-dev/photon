/**
 * Tenant Resolution Middleware
 *
 * Resolves tenant from request (subdomain, path, or custom domain)
 * and attaches to request context
 */

import type { Tenant, RequestContext } from '../types/index.js';

// ============================================================================
// Tenant Store Interface
// ============================================================================

export interface TenantStore {
  /**
   * Find tenant by slug
   */
  findBySlug(slug: string): Promise<Tenant | null>;

  /**
   * Find tenant by custom domain
   */
  findByCustomDomain(domain: string): Promise<Tenant | null>;

  /**
   * Find tenant by ID
   */
  findById(id: string): Promise<Tenant | null>;
}

// ============================================================================
// In-Memory Tenant Store (Development)
// ============================================================================

export class MemoryTenantStore implements TenantStore {
  private tenants: Map<string, Tenant> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private domainIndex: Map<string, string> = new Map();

  /**
   * Add a tenant to the store
   */
  add(tenant: Tenant): void {
    this.tenants.set(tenant.id, tenant);
    this.slugIndex.set(tenant.slug, tenant.id);
    if (tenant.settings.customDomain) {
      this.domainIndex.set(tenant.settings.customDomain, tenant.id);
    }
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const id = this.slugIndex.get(slug);
    if (!id) return null;
    return this.tenants.get(id) ?? null;
  }

  async findByCustomDomain(domain: string): Promise<Tenant | null> {
    const id = this.domainIndex.get(domain);
    if (!id) return null;
    return this.tenants.get(id) ?? null;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null;
  }
}

// ============================================================================
// Tenant Resolution
// ============================================================================

export interface TenantResolverConfig {
  /** Base domain for subdomain resolution (e.g., 'serv.example.com') */
  baseDomain: string;
  /** Tenant store implementation */
  store: TenantStore;
  /** Path prefix for path-based tenant resolution */
  pathPrefix?: string;
}

export class TenantResolver {
  private config: TenantResolverConfig;

  constructor(config: TenantResolverConfig) {
    this.config = {
      pathPrefix: '/tenant/',
      ...config,
    };
  }

  /**
   * Resolve tenant from HTTP request
   */
  async resolve(request: {
    host?: string;
    url?: string;
    headers?: { host?: string };
  }): Promise<Tenant | null> {
    const host = request.host ?? request.headers?.host ?? '';
    const url = request.url ?? '';

    // 1. Try subdomain resolution (acme.serv.example.com)
    const subdomain = this.extractSubdomain(host);
    if (subdomain) {
      const tenant = await this.config.store.findBySlug(subdomain);
      if (tenant) return tenant;
    }

    // 2. Try path-based resolution (/tenant/acme/...)
    const pathSlug = this.extractPathSlug(url);
    if (pathSlug) {
      const tenant = await this.config.store.findBySlug(pathSlug);
      if (tenant) return tenant;
    }

    // 3. Try custom domain resolution
    const tenant = await this.config.store.findByCustomDomain(host);
    if (tenant) return tenant;

    return null;
  }

  /**
   * Extract subdomain from host
   */
  private extractSubdomain(host: string): string | null {
    // Remove port if present
    const hostWithoutPort = host.split(':')[0];

    // Check if it's a subdomain of our base domain
    if (!hostWithoutPort.endsWith(`.${this.config.baseDomain}`)) {
      return null;
    }

    // Extract subdomain
    const subdomain = hostWithoutPort.slice(
      0,
      hostWithoutPort.length - this.config.baseDomain.length - 1
    );

    // Validate: must be single-level and not empty
    if (!subdomain || subdomain.includes('.')) {
      return null;
    }

    return subdomain;
  }

  /**
   * Extract tenant slug from URL path
   */
  private extractPathSlug(url: string): string | null {
    const prefix = this.config.pathPrefix!;
    const pathStart = url.indexOf(prefix);
    if (pathStart === -1) return null;

    const afterPrefix = url.slice(pathStart + prefix.length);
    const slug = afterPrefix.split('/')[0];

    return slug || null;
  }
}

// ============================================================================
// Request Context Builder
// ============================================================================

export interface ContextBuilderConfig {
  tenantResolver: TenantResolver;
}

export class RequestContextBuilder {
  private tenantResolver: TenantResolver;

  constructor(config: ContextBuilderConfig) {
    this.tenantResolver = config.tenantResolver;
  }

  /**
   * Build request context from HTTP request
   */
  async build(request: {
    host?: string;
    url?: string;
    headers?: { host?: string; authorization?: string };
  }): Promise<RequestContext | null> {
    const tenant = await this.tenantResolver.resolve(request);
    if (!tenant) return null;

    return {
      tenant,
      // Session and user are added by auth middleware
    };
  }
}

// ============================================================================
// HTTP Middleware Helpers
// ============================================================================

/**
 * Extract tenant slug from URL for routing
 */
export function extractTenantSlug(url: string, pathPrefix = '/tenant/'): string | null {
  const pathStart = url.indexOf(pathPrefix);
  if (pathStart === -1) return null;

  const afterPrefix = url.slice(pathStart + pathPrefix.length);
  const slug = afterPrefix.split('/')[0];

  return slug || null;
}

/**
 * Build tenant-specific URL
 */
export function buildTenantUrl(baseUrl: string, tenant: Tenant, path: string): string {
  if (tenant.settings.customDomain) {
    return `https://${tenant.settings.customDomain}${path}`;
  }
  return `${baseUrl}/tenant/${tenant.slug}${path}`;
}

/**
 * Build resource URI for OAuth audience
 */
export function buildResourceUri(baseUrl: string, tenant: Tenant): string {
  return buildTenantUrl(baseUrl, tenant, '/mcp');
}
