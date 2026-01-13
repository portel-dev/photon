/**
 * SERV Runtime Module
 *
 * Provides execution context for photons running in SERV.
 */

// OAuth Context
export {
  OAuthContext,
  OAuthElicitationRequired,
  createOAuthInputProvider,
  type OAuthAsk,
  type OAuthResponse,
  type OAuthContextConfig,
  type OAuthInputProvider,
} from './oauth-context.js';

// Executor
export {
  PhotonExecutor,
  isOAuthElicitationError,
  formatElicitationToolResponse,
  type ExecutorConfig,
  type ExecutionContext,
  type ExecutionResult,
} from './executor.js';
