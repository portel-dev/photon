/**
 * Server-specific type helpers to replace `as any` casts in server.ts.
 *
 * These interfaces extend the published photon-core types with properties
 * that exist at runtime but are not part of the public API surface.
 */

import type { PhotonClassExtended } from '@portel/photon-core';
import type { ServerCapabilities } from '../mcp/sdk-v1-2025/types.js';
import type { HttpRouteDef } from '../shared/http-route-extractor.js';
import type { ExposeDef } from '../shared/expose-route-extractor.js';
import type { FiniteJSONValue, JSONSchema202012 } from '../mcp/protocol/json-schema.js';
import type { PhotonAuthDirective } from '../auth/directive.js';

/**
 * ServerCapabilities plus Photon's web-app capability extension.
 * Advertised when a photon has a GET / route or a TSX client app; detected
 * on the client side by external-mcp.ts (detectWebCapability).
 */
export type ServerCapabilitiesWithWeb = ServerCapabilities & {
  web?: { url: string; description: string };
};

/**
 * Extended photon class with runtime-only metadata properties.
 * These are stamped by the loader on the result of loadFile / loadCompiled
 * but are not declared on PhotonClassExtended in photon-core.
 */
export interface PhotonClassWithMeta extends PhotonClassExtended {
  /** Photon icon emoji or name (from @icon class-level tag) */
  icon?: string;
  /** Whether the photon is stateful (from @stateful class-level tag) */
  stateful?: boolean;
  /** Convenience flag: true when settingsSchema.hasSettings is true */
  hasSettings?: boolean;
  /** Auth scheme directive from @auth class-level tag (e.g. "bearer:claim"). */
  auth?: string;
  /** Structured inbound MCP auth contract parsed from the class-level @auth tag. */
  authDirective?: PhotonAuthDirective;
  /** Internal tool schema map used for diagnostics */
  _toolSchemas?: Record<string, unknown>;
  /** HTTP routes from @get / @post method-level tags */
  _httpRoutes?: HttpRouteDef[];
  /** Auto-RPC exposes from @expose method-level tags */
  _exposes?: ExposeDef[];
  /** Properties marked for real-time frontend syncing via @sharedState JSDoc tags */
  sharedStates?: string[];
  /**
   * Cached extracted-tool schemas. Stamped by beam.ts during the load-and-mount
   * flow so subsequent result rendering can skip re-parsing the source. Shape
   * is whatever SchemaExtractor.extractAllFromSource returns for `tools`.
   */
  schemas?: unknown[];
  /** Access-policy classes exported by the Photon module. */
  _accessClasses?: Record<string, any>;
}

/**
 * MCP tool definition returned by handleListTools.
 * Matches the MCP protocol Tool shape.
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  outputSchema?: JSONSchema202012;
  icons?: Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }>;
  _meta?: Record<string, unknown>;
  /** Allow MCP extension properties such as x-output-format during migration. */
  [key: string]: unknown;
}

/**
 * MCP text content block with optional annotations.
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
  annotations?: Record<string, unknown>;
}

/** MCP media content block. The data field is base64 without the data: prefix. */
export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  annotations?: Record<string, unknown>;
}

/**
 * MCP tool call response.
 */
export interface MCPToolResponse {
  content: Array<MCPTextContent | MCPImageContent>;
  isError: boolean;
  structuredContent?: FiniteJSONValue;
  _meta?: Record<string, unknown>;
  /** Extension field for format-aware clients */
  'x-output-format'?: string;
  /** Allow additional MCP extension properties */
  [key: string]: unknown;
}
