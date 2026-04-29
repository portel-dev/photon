/**
 * Server-specific type helpers to replace `as any` casts in server.ts.
 *
 * These interfaces extend the published photon-core types with properties
 * that exist at runtime but are not part of the public API surface.
 */

import type { PhotonClassExtended } from '@portel/photon-core';

/**
 * Extended photon class with runtime-only metadata properties.
 * These are set by the loader but not declared on PhotonClassExtended.
 */
export interface PhotonClassWithMeta extends PhotonClassExtended {
  /** Photon icon emoji or name (from @icon class-level tag) */
  icon?: string;
  /** Whether the photon is stateful (from @stateful class-level tag) */
  stateful?: boolean;
  /** Convenience flag: true when settingsSchema.hasSettings is true */
  hasSettings?: boolean;
  /** Internal tool schema map used for diagnostics */
  _toolSchemas?: Record<string, unknown>;
  /** HTTP routes from @get/@post tags */
  _httpRoutes?: Array<{ method: string; path: string; handler: string }>;
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
  outputSchema?: Record<string, unknown>;
  icons?: Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }>;
  _meta?: Record<string, unknown>;
}

/**
 * MCP text content block with optional annotations.
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
  annotations?: Record<string, unknown>;
}

/**
 * MCP tool call response.
 */
export interface MCPToolResponse {
  content: MCPTextContent[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  /** Extension field for format-aware clients */
  'x-output-format'?: string;
  /** Allow additional MCP extension properties */
  [key: string]: unknown;
}
