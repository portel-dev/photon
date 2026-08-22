/**
 * @portel/photon
 *
 * Build MCP servers and CLI tools from single .photon.ts files
 *
 * Re-exports @portel/photon-core for backward compatibility
 * and adds Photon-specific runtime functionality
 */

// Re-export everything from @portel/photon-core
export * from '@portel/photon-core';

// Export Photon-specific runtime components
export { PhotonLoader } from './loader.js';
export { PhotonServer } from './server.js';

// Transport-neutral passwordless authentication primitives. Delivery is a
// Photon-author callback; challenge generation, hashing, expiry, and replay
// protection remain in the Photon runtime.
export {
  AuthCodeService,
  MemoryAuthChallengeStore,
  type AuthCodeDeliveryAdapter,
  type AuthCodeDeliveryRequest,
  type AuthCodePurpose,
  type AuthChallenge,
  type AuthChallengeStore,
  type AuthCodeServiceOptions,
  type AuthCodeVerification,
  type AuthCodeVerificationFailure,
} from './auth/auth-delivery.js';
export { PhotonDocExtractor } from './photon-doc-extractor.js';
export {
  parseAccessMetadata,
  extractAccessMetadata,
  accessMetadataAllows,
} from './access-control.js';
export { EmbeddedRuntime } from './embedded-runtime.js';
export {
  LocalWebSocketPair,
  createWebSocketUpgradeResponse,
  installLocalWebSocketPair,
} from './shared/local-websocket-pair.js';
export type { LocalWebSocketEndpoint } from './shared/local-websocket-pair.js';
export {
  JSON_SCHEMA_2020_12_DIALECT,
  MCP_JSON_SCHEMA_LIMITS,
  isFiniteJSONValue,
  validateStructuredOutput,
  withJSONSchemaDialect,
} from './mcp/protocol/json-schema.js';
export type {
  FiniteJSONValue,
  JSONSchema202012,
  MCPJSONSchemaLimits,
  JSONSchemaValidationFailure,
  JSONSchemaValidationIssue,
  JSONSchemaValidationResult,
  JSONSchemaValidationSuccess,
} from './mcp/protocol/json-schema.js';
export {
  PHOTON_TOOL_ERROR_CODES,
  PHOTON_TOOL_ERROR_META_KEY,
  buildMCPErrorReference,
  buildMCPToolError,
} from './mcp/protocol/tool-errors.js';
export type {
  PhotonToolErrorCategory,
  PhotonToolErrorCode,
  PhotonToolErrorContext,
  PhotonToolErrorDescriptor,
  PhotonToolErrorResult,
  PhotonMCPErrorReference,
} from './mcp/protocol/tool-errors.js';
export type {
  MCPInputRequest,
  MCPInputRequestMethod,
  MCPInputRequests,
  MCPInputRequiredResult,
  MCPInputResponses,
} from './mcp/protocol/input-required.js';
export type {
  TaskState as MCPTaskStatus,
  TaskInputRequest as MCPTaskInputRequest,
  TaskProtocolError as MCPTaskProtocolError,
  ModernTaskWire as MCPTask,
  LegacyTaskWire as LegacyMCPTask,
} from './tasks/types.js';
export { AnthropicProvider, OpenAICompatibleProvider, generateText } from './model-providers.js';
export type {
  AnthropicProviderOptions,
  ModelCompletionRequest,
  ModelCompletionResult,
  ModelProvider,
  ModelProviderMessage,
  OpenAICompatibleProviderOptions,
} from './model-providers.js';
