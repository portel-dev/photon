/**
 * OAuth Runtime Context for SERV
 *
 * Provides OAuth token access within photon execution context.
 * Enables photons to request OAuth tokens via yield-based elicitation.
 */

import type { Session, PhotonGrant } from '../types/index.js';
import type { TokenVault } from '../vault/token-vault.js';
import type { OAuthFlowHandler } from '../auth/oauth.js';

// ============================================================================
// OAuth Ask Yield Type
// ============================================================================

/**
 * OAuth token request yield
 * When a photon needs an OAuth token, it yields this
 */
export interface OAuthAsk {
  ask: 'oauth';
  /** OAuth provider ID (e.g., 'google', 'github') */
  provider: string;
  /** Required OAuth scopes */
  scopes: string[];
  /** Human-readable message explaining why auth is needed */
  message?: string;
}

/**
 * OAuth ask response - either a token or an elicitation request
 */
export interface OAuthResponse {
  /** Whether the token is available */
  success: boolean;
  /** The access token (if available) */
  token?: string;
  /** Elicitation required - redirect user to this URL */
  elicitationUrl?: string;
  /** Elicitation ID for tracking */
  elicitationId?: string;
  /** Error message if something went wrong */
  error?: string;
}

// ============================================================================
// MCP Elicitation Error (per MCP spec)
// ============================================================================

/**
 * MCP Elicitation Error
 *
 * When a photon needs user authorization, this error is returned
 * following the MCP elicitation protocol.
 */
export class OAuthElicitationRequired extends Error {
  readonly code = 'OAUTH_ELICITATION_REQUIRED';
  readonly elicitationUrl: string;
  readonly elicitationId: string;
  readonly provider: string;
  readonly scopes: string[];

  constructor(options: {
    elicitationUrl: string;
    elicitationId: string;
    provider: string;
    scopes: string[];
    message?: string;
  }) {
    super(options.message || `OAuth authorization required for ${options.provider}`);
    this.name = 'OAuthElicitationRequired';
    this.elicitationUrl = options.elicitationUrl;
    this.elicitationId = options.elicitationId;
    this.provider = options.provider;
    this.scopes = options.scopes;
  }

  /**
   * Convert to MCP error response format
   */
  toMCPError(): {
    error: {
      code: string;
      message: string;
      data: {
        elicitation: {
          type: 'oauth';
          url: string;
          id: string;
          provider: string;
          scopes: string[];
        };
      };
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        data: {
          elicitation: {
            type: 'oauth',
            url: this.elicitationUrl,
            id: this.elicitationId,
            provider: this.provider,
            scopes: this.scopes,
          },
        },
      },
    };
  }
}

// ============================================================================
// OAuth Execution Context
// ============================================================================

export interface OAuthContextConfig {
  session: Session;
  photonId: string;
  tenantId: string;
  oauthFlow: OAuthFlowHandler;
  tokenVault: TokenVault;
}

/**
 * OAuth context for photon execution
 *
 * Provides a way for photons to request OAuth tokens during execution.
 * Integrates with SERV's OAuth flow handler to manage grants and elicitations.
 */
export class OAuthContext {
  private session: Session;
  private photonId: string;
  private tenantId: string;
  private oauthFlow: OAuthFlowHandler;
  private tokenVault: TokenVault;

  constructor(config: OAuthContextConfig) {
    this.session = config.session;
    this.photonId = config.photonId;
    this.tenantId = config.tenantId;
    this.oauthFlow = config.oauthFlow;
    this.tokenVault = config.tokenVault;
  }

  /**
   * Request an OAuth token
   *
   * @param provider - OAuth provider ID
   * @param scopes - Required scopes
   * @returns Token if available, or throws OAuthElicitationRequired
   */
  async requestToken(provider: string, scopes: string[]): Promise<string> {
    // Check for existing grant
    const grantCheck = await this.oauthFlow.checkGrant(
      this.tenantId,
      this.photonId,
      provider,
      scopes,
      this.session.userId
    );

    if (grantCheck.valid && grantCheck.token) {
      return grantCheck.token;
    }

    // Need to start elicitation
    const elicitation = await this.oauthFlow.startElicitation(
      this.session,
      this.photonId,
      provider,
      scopes
    );

    throw new OAuthElicitationRequired({
      elicitationUrl: elicitation.url,
      elicitationId: elicitation.elicitationId,
      provider,
      scopes,
    });
  }

  /**
   * Handle an OAuth ask yield
   *
   * @param ask - The OAuth ask yield from the photon
   * @returns OAuth response
   */
  async handleOAuthAsk(ask: OAuthAsk): Promise<OAuthResponse> {
    try {
      const token = await this.requestToken(ask.provider, ask.scopes);
      return { success: true, token };
    } catch (error) {
      if (error instanceof OAuthElicitationRequired) {
        return {
          success: false,
          elicitationUrl: error.elicitationUrl,
          elicitationId: error.elicitationId,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ============================================================================
// Input Provider with OAuth Support
// ============================================================================

export type OAuthInputProvider = (ask: OAuthAsk | Record<string, unknown>) => Promise<unknown>;

/**
 * Create an input provider that handles OAuth asks
 *
 * Wraps the standard input provider to add OAuth token handling.
 * When an 'oauth' ask is received, it checks for existing grants
 * or initiates an elicitation flow.
 */
export function createOAuthInputProvider(
  oauthContext: OAuthContext,
  fallbackProvider?: (ask: Record<string, unknown>) => Promise<unknown>
): OAuthInputProvider {
  return async (ask: OAuthAsk | Record<string, unknown>): Promise<unknown> => {
    // Handle OAuth asks
    if ('ask' in ask && ask.ask === 'oauth') {
      const oauthAsk = ask as OAuthAsk;
      const response = await oauthContext.handleOAuthAsk(oauthAsk);

      if (response.success && response.token) {
        return response.token;
      }

      // Elicitation required - throw error
      if (response.elicitationUrl && response.elicitationId) {
        throw new OAuthElicitationRequired({
          elicitationUrl: response.elicitationUrl,
          elicitationId: response.elicitationId,
          provider: oauthAsk.provider,
          scopes: oauthAsk.scopes,
          message: oauthAsk.message,
        });
      }

      throw new Error(response.error || 'OAuth token request failed');
    }

    // Delegate to fallback provider for other ask types
    if (fallbackProvider) {
      return fallbackProvider(ask as Record<string, unknown>);
    }

    throw new Error(`Unhandled ask type: ${(ask as { ask?: string }).ask}`);
  };
}
