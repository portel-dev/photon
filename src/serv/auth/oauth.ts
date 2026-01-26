/**
 * OAuth Flow Handler
 *
 * Handles OAuth 2.1 flows for:
 * 1. SERV as authorization server (client access to SERV)
 * 2. SERV as client (third-party OAuth for photon access)
 */

import { randomBytes, createHash } from 'crypto';
import type {
  OAuthProvider,
  OAuthToken,
  ElicitationRequest,
  PhotonGrant,
  Session,
  Tenant,
} from '../types/index.js';
import {
  encodeOAuthState,
  decodeOAuthState,
  generateCodeVerifier,
  generateCodeChallenge,
} from './jwt.js';
import type { TokenVault } from '../vault/token-vault.js';

// Timeout for OAuth token exchange requests
const OAUTH_TIMEOUT_MS = 30 * 1000;

// ============================================================================
// Provider Registry
// ============================================================================

export interface OAuthProviderConfig {
  id: string;
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
}

const BUILTIN_PROVIDERS: Record<string, Omit<OAuthProviderConfig, 'clientId' | 'clientSecret'>> = {
  google: {
    id: 'google',
    name: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    id: 'github',
    name: 'GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
  },
};

export class OAuthProviderRegistry {
  private providers: Map<string, OAuthProviderConfig> = new Map();

  /**
   * Register a provider with credentials
   */
  register(providerId: string, clientId: string, clientSecret: string): void {
    const builtin = BUILTIN_PROVIDERS[providerId];
    if (builtin) {
      this.providers.set(providerId, {
        ...builtin,
        clientId,
        clientSecret,
      });
    }
  }

  /**
   * Register a custom provider
   */
  registerCustom(config: OAuthProviderConfig): void {
    this.providers.set(config.id, config);
  }

  /**
   * Get a provider by ID
   */
  get(providerId: string): OAuthProviderConfig | null {
    return this.providers.get(providerId) ?? null;
  }

  /**
   * Check if a provider is registered
   */
  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}

// ============================================================================
// Elicitation Store Interface
// ============================================================================

export interface ElicitationStore {
  create(request: Omit<ElicitationRequest, 'id' | 'createdAt'>): Promise<ElicitationRequest>;
  get(id: string): Promise<ElicitationRequest | null>;
  update(id: string, data: Partial<ElicitationRequest>): Promise<void>;
  delete(id: string): Promise<void>;
  cleanup(): Promise<number>;
}

// ============================================================================
// In-Memory Elicitation Store
// ============================================================================

export class MemoryElicitationStore implements ElicitationStore {
  private requests: Map<string, ElicitationRequest> = new Map();

  async create(data: Omit<ElicitationRequest, 'id' | 'createdAt'>): Promise<ElicitationRequest> {
    const request: ElicitationRequest = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: new Date(),
    };
    this.requests.set(request.id, request);
    return request;
  }

  async get(id: string): Promise<ElicitationRequest | null> {
    const request = this.requests.get(id);
    if (!request) return null;
    if (request.expiresAt.getTime() < Date.now()) {
      this.requests.delete(id);
      return null;
    }
    return request;
  }

  async update(id: string, data: Partial<ElicitationRequest>): Promise<void> {
    const existing = this.requests.get(id);
    if (existing) {
      this.requests.set(id, { ...existing, ...data });
    }
  }

  async delete(id: string): Promise<void> {
    this.requests.delete(id);
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, request] of this.requests) {
      if (request.expiresAt.getTime() < now) {
        this.requests.delete(id);
        count++;
      }
    }
    return count;
  }
}

// ============================================================================
// Grant Store Interface
// ============================================================================

export interface GrantStore {
  find(
    tenantId: string,
    photonId: string,
    provider: string,
    userId?: string
  ): Promise<PhotonGrant | null>;
  create(grant: Omit<PhotonGrant, 'id' | 'createdAt' | 'updatedAt'>): Promise<PhotonGrant>;
  update(id: string, data: Partial<PhotonGrant>): Promise<void>;
  delete(id: string): Promise<void>;
  findByUser(tenantId: string, userId: string): Promise<PhotonGrant[]>;
}

// ============================================================================
// In-Memory Grant Store
// ============================================================================

export class MemoryGrantStore implements GrantStore {
  private grants: Map<string, PhotonGrant> = new Map();

  private key(tenantId: string, photonId: string, provider: string, userId?: string): string {
    return `${tenantId}:${photonId}:${provider}:${userId ?? 'anonymous'}`;
  }

  async find(
    tenantId: string,
    photonId: string,
    provider: string,
    userId?: string
  ): Promise<PhotonGrant | null> {
    const k = this.key(tenantId, photonId, provider, userId);
    return this.grants.get(k) ?? null;
  }

  async create(data: Omit<PhotonGrant, 'id' | 'createdAt' | 'updatedAt'>): Promise<PhotonGrant> {
    const now = new Date();
    const grant: PhotonGrant = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: now,
      updatedAt: now,
    };
    const k = this.key(grant.tenantId, grant.photonId, grant.provider, grant.userId);
    this.grants.set(k, grant);
    return grant;
  }

  async update(id: string, data: Partial<PhotonGrant>): Promise<void> {
    for (const [key, grant] of this.grants) {
      if (grant.id === id) {
        this.grants.set(key, { ...grant, ...data, updatedAt: new Date() });
        return;
      }
    }
  }

  async delete(id: string): Promise<void> {
    for (const [key, grant] of this.grants) {
      if (grant.id === id) {
        this.grants.delete(key);
        return;
      }
    }
  }

  async findByUser(tenantId: string, userId: string): Promise<PhotonGrant[]> {
    const grants: PhotonGrant[] = [];
    for (const grant of this.grants.values()) {
      if (grant.tenantId === tenantId && grant.userId === userId) {
        grants.push(grant);
      }
    }
    return grants;
  }
}

// ============================================================================
// OAuth Flow Handler
// ============================================================================

export interface OAuthFlowConfig {
  /** Base URL for callbacks (e.g., 'https://serv.example.com') */
  baseUrl: string;
  /** Secret for state encryption */
  stateSecret: string;
  /** Provider registry */
  providers: OAuthProviderRegistry;
  /** Elicitation store */
  elicitationStore: ElicitationStore;
  /** Grant store */
  grantStore: GrantStore;
  /** Token vault for encryption */
  tokenVault: TokenVault;
}

export class OAuthFlowHandler {
  private config: OAuthFlowConfig;

  constructor(config: OAuthFlowConfig) {
    this.config = config;
  }

  /**
   * Start an OAuth elicitation flow
   */
  async startElicitation(
    session: Session,
    photonId: string,
    provider: string,
    scopes: string[]
  ): Promise<{ url: string; elicitationId: string }> {
    const providerConfig = this.config.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    // Generate PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Create elicitation request
    const elicitation = await this.config.elicitationStore.create({
      sessionId: session.id,
      photonId,
      provider,
      requiredScopes: scopes,
      status: 'pending',
      redirectUri: `${this.config.baseUrl}/auth/oauth/callback`,
      codeVerifier,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    // Build OAuth state
    const state = encodeOAuthState(
      {
        sessionId: session.id,
        elicitationId: elicitation.id,
        photonId,
        provider,
        nonce: randomBytes(16).toString('hex'),
        timestamp: Date.now(),
      },
      this.config.stateSecret
    );

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: elicitation.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${providerConfig.authorizationUrl}?${params.toString()}`;

    return { url, elicitationId: elicitation.id };
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(
    code: string,
    state: string,
    tenantId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Decode and verify state
    const stateData = decodeOAuthState(state, this.config.stateSecret);
    if (!stateData) {
      return { success: false, error: 'Invalid or expired state' };
    }

    // Get elicitation request
    const elicitation = await this.config.elicitationStore.get(stateData.elicitationId);
    if (!elicitation) {
      return { success: false, error: 'Elicitation request not found or expired' };
    }

    if (elicitation.status !== 'pending') {
      return { success: false, error: 'Elicitation already processed' };
    }

    // Get provider
    const providerConfig = this.config.providers.get(elicitation.provider);
    if (!providerConfig) {
      return { success: false, error: 'Provider not configured' };
    }

    // Exchange code for tokens
    try {
      const tokens = await this.exchangeCode(
        providerConfig,
        code,
        elicitation.redirectUri,
        elicitation.codeVerifier!
      );

      // Encrypt and store tokens
      const accessTokenEncrypted = await this.config.tokenVault.encrypt(
        tenantId,
        tokens.accessToken
      );
      const refreshTokenEncrypted = tokens.refreshToken
        ? await this.config.tokenVault.encrypt(tenantId, tokens.refreshToken)
        : undefined;

      // Check for existing grant
      const existingGrant = await this.config.grantStore.find(
        tenantId,
        elicitation.photonId,
        elicitation.provider,
        undefined // TODO: Get userId from session
      );

      if (existingGrant) {
        await this.config.grantStore.update(existingGrant.id, {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          scopes: elicitation.requiredScopes,
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        });
      } else {
        await this.config.grantStore.create({
          tenantId,
          photonId: elicitation.photonId,
          provider: elicitation.provider,
          scopes: elicitation.requiredScopes,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        });
      }

      // Mark elicitation as completed
      await this.config.elicitationStore.update(elicitation.id, {
        status: 'completed',
      });

      return { success: true };
    } catch (err) {
      await this.config.elicitationStore.update(elicitation.id, {
        status: 'cancelled',
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Token exchange failed',
      };
    }
  }

  /**
   * Check if a grant exists and is valid
   */
  async checkGrant(
    tenantId: string,
    photonId: string,
    provider: string,
    requiredScopes: string[],
    userId?: string
  ): Promise<{ valid: boolean; token?: string }> {
    const grant = await this.config.grantStore.find(tenantId, photonId, provider, userId);

    if (!grant) {
      return { valid: false };
    }

    // Check scopes
    const hasAllScopes = requiredScopes.every((s) => grant.scopes.includes(s));
    if (!hasAllScopes) {
      return { valid: false };
    }

    // Check expiry (with 5 minute buffer)
    if (grant.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
      // Try to refresh
      if (grant.refreshTokenEncrypted) {
        const refreshed = await this.refreshGrant(grant);
        if (refreshed) {
          const token = await this.config.tokenVault.decrypt(
            tenantId,
            refreshed.accessTokenEncrypted
          );
          return { valid: true, token };
        }
      }
      return { valid: false };
    }

    const token = await this.config.tokenVault.decrypt(tenantId, grant.accessTokenEncrypted);
    return { valid: true, token };
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCode(
    provider: OAuthProviderConfig,
    code: string,
    redirectUri: string,
    codeVerifier: string
  ): Promise<OAuthToken> {
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type ?? 'Bearer',
      expiresIn: data.expires_in ?? 3600,
      scope: data.scope,
    };
  }

  /**
   * Refresh an expired grant
   */
  private async refreshGrant(grant: PhotonGrant): Promise<PhotonGrant | null> {
    if (!grant.refreshTokenEncrypted) return null;

    const provider = this.config.providers.get(grant.provider);
    if (!provider) return null;

    try {
      const refreshToken = await this.config.tokenVault.decrypt(
        grant.tenantId,
        grant.refreshTokenEncrypted
      );

      const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const accessTokenEncrypted = await this.config.tokenVault.encrypt(
        grant.tenantId,
        data.access_token
      );
      const refreshTokenEncrypted = data.refresh_token
        ? await this.config.tokenVault.encrypt(grant.tenantId, data.refresh_token)
        : grant.refreshTokenEncrypted;

      await this.config.grantStore.update(grant.id, {
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      });

      return {
        ...grant,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      };
    } catch {
      return null;
    }
  }
}
