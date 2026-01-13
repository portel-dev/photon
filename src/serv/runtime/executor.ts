/**
 * SERV Photon Executor
 *
 * Executes photons with SERV context (session, OAuth, tenant isolation).
 * Wraps the PhotonLoader with SERV-specific input/output handling.
 */

import type { Session, Tenant } from '../types/index.js';
import type { OAuthFlowHandler } from '../auth/oauth.js';
import type { TokenVault } from '../vault/token-vault.js';
import {
  OAuthContext,
  OAuthElicitationRequired,
  createOAuthInputProvider,
  type OAuthAsk,
} from './oauth-context.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutorConfig {
  oauthFlow: OAuthFlowHandler;
  tokenVault: TokenVault;
}

export interface ExecutionContext {
  session: Session;
  tenant: Tenant;
  photonId: string;
}

export interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Photon Executor
// ============================================================================

/**
 * SERV Photon Executor
 *
 * Provides a SERV-aware execution environment for photons:
 * - OAuth token management via yields
 * - Session-scoped execution
 * - Tenant isolation
 */
export class PhotonExecutor {
  private config: ExecutorConfig;

  constructor(config: ExecutorConfig) {
    this.config = config;
  }

  /**
   * Create an OAuth context for a photon execution
   */
  createOAuthContext(context: ExecutionContext): OAuthContext {
    return new OAuthContext({
      session: context.session,
      photonId: context.photonId,
      tenantId: context.tenant.id,
      oauthFlow: this.config.oauthFlow,
      tokenVault: this.config.tokenVault,
    });
  }

  /**
   * Create an input provider with OAuth support
   *
   * @param context - Execution context
   * @param fallbackProvider - Provider for non-OAuth asks
   */
  createInputProvider(
    context: ExecutionContext,
    fallbackProvider?: (ask: Record<string, unknown>) => Promise<unknown>
  ): (ask: OAuthAsk | Record<string, unknown>) => Promise<unknown> {
    const oauthContext = this.createOAuthContext(context);
    return createOAuthInputProvider(oauthContext, fallbackProvider);
  }

  /**
   * Format an error for MCP response
   */
  formatError(error: unknown): ExecutionResult {
    if (error instanceof OAuthElicitationRequired) {
      return {
        success: false,
        error: error.toMCPError().error,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message,
      },
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error is an OAuth elicitation request
 */
export function isOAuthElicitationError(error: unknown): error is OAuthElicitationRequired {
  return error instanceof OAuthElicitationRequired;
}

/**
 * Format OAuth elicitation error for MCP tool response
 *
 * Returns a structured error that MCP clients can understand
 * and potentially auto-handle (e.g., opening auth URL in browser).
 */
export function formatElicitationToolResponse(error: OAuthElicitationRequired): {
  content: Array<{
    type: 'text';
    text: string;
    annotations?: { mimeType?: string };
  }>;
  isError: boolean;
} {
  const elicitationInfo = {
    type: 'oauth_elicitation',
    provider: error.provider,
    scopes: error.scopes,
    url: error.elicitationUrl,
    id: error.elicitationId,
    message: error.message,
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(elicitationInfo, null, 2),
        annotations: { mimeType: 'application/json' },
      },
      {
        type: 'text',
        text: `\n\n---\n🔐 **Authorization Required**\n\nThis tool needs access to ${error.provider}.\n\nPlease visit this URL to authorize:\n${error.elicitationUrl}\n\nAfter authorization, retry the tool request.`,
      },
    ],
    isError: true,
  };
}
