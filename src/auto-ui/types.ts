/**
 * Type definitions for Auto-UI system
 *
 * Centralized type definitions to ensure consistency across:
 * - beam.ts (main server)
 * - streamable-http-transport.ts (MCP Streamable HTTP transport)
 * - openapi-generator.ts
 *
 * Following DRY principle - single source of truth for interfaces.
 */

// Re-export PhotonAssets from photon-core
export type { PhotonAssets } from '@portel/photon-core';

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Constructor parameter that maps to an environment variable
 */
export interface ConfigParam {
  /** Parameter name from constructor */
  name: string;
  /** Environment variable name (e.g., PHOTON_NAME_PARAM_NAME) */
  envVar: string;
  /** TypeScript type (string, number, boolean) */
  type: string;
  /** Whether parameter has ? modifier */
  isOptional: boolean;
  /** Whether parameter has a default value */
  hasDefault: boolean;
  /** The default value if present */
  defaultValue?: unknown;
}

// ════════════════════════════════════════════════════════════════════════════════
// METHOD INFO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Method metadata extracted from photon class
 *
 * Contains both MCP tool schema and UI rendering hints.
 */
export interface MethodInfo {
  /** Method name */
  name: string;
  /** Description from JSDoc */
  description: string;
  /** Icon emoji from @icon tag */
  icon?: string;
  /** MCP standard icon images (data URIs with metadata) */
  icons?: Array<{ src: string; mimeType?: string; sizes?: string; theme?: string }>;
  /** JSON Schema for parameters */
  params: Record<string, unknown>;
  /** JSON Schema for return value */
  returns: Record<string, unknown>;
  /** Auto-execute when selected (@autorun tag) */
  autorun?: boolean;
  /** Output format hint (@format tag): table, list, json, markdown, mermaid, etc. */
  outputFormat?: string;
  /** Layout hints from @format tag: {@title field, @subtitle field} */
  layoutHints?: Record<string, string>;
  /** Custom button label from @returns {@label} */
  buttonLabel?: string;
  /** Linked UI template ID from @ui tag */
  linkedUi?: string;
  /** True if this is an MCP prompt template (@template tag) */
  isTemplate?: boolean;
  /** Tool visibility: 'model' (visible to LLM), 'app' (callable by UI only) */
  visibility?: ('model' | 'app')[];
  /** True if this is a static method (class-level, no instance needed) */
  isStatic?: boolean;
  /** Webhook endpoint path from @webhook tag */
  webhook?: string | boolean;
  /** Cron schedule expression from @scheduled/@cron tag */
  scheduled?: string;
  /** Distributed lock name from @locked tag */
  locked?: string | boolean;

  // ═══ MCP STANDARD ANNOTATIONS ═══

  /** Human-readable display name from @title tag → annotations.title */
  title?: string;
  /** Tool has no side effects — safe for auto-approval → annotations.readOnlyHint */
  readOnlyHint?: boolean;
  /** Tool performs destructive operations → annotations.destructiveHint */
  destructiveHint?: boolean;
  /** Tool is safe to retry → annotations.idempotentHint */
  idempotentHint?: boolean;
  /** Tool interacts with external world → annotations.openWorldHint */
  openWorldHint?: boolean;
  /** Content audience control → content annotations.audience */
  audience?: ('user' | 'assistant')[];
  /** Content importance 0.0-1.0 → content annotations.priority */
  contentPriority?: number;
  /** JSON Schema for structured output → Tool.outputSchema */
  outputSchema?: { type: 'object'; properties: Record<string, any>; required?: string[] };
  /** True if method is a generator that yields { ask } — supports task execution */
  hasGeneratorAsks?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
// PHOTON INFO
// ════════════════════════════════════════════════════════════════════════════════

import type { PhotonAssets } from '@portel/photon-core';

/**
 * Fully configured photon ready for use
 */
export interface PhotonInfo {
  /** Unique ID (hash of path) - stable across restarts, unique across servers */
  id: string;
  /** Photon name (derived from filename) */
  name: string;
  /** Short photon name without duplicate disambiguation suffixes */
  shortName?: string;
  /** Namespace/owner when installed in a namespace directory */
  namespace?: string;
  /** Stable qualified identity (e.g. portel-dev:telegram) */
  qualifiedName?: string;
  /** Absolute path to .photon.ts file */
  path: string;
  /** Discriminator: always true for configured photons */
  configured: true;
  /** Available methods/tools */
  methods: MethodInfo[];
  /** Legacy @ui template path (deprecated, use assets.ui) */
  templatePath?: string;
  /** True if photon has main() - listed under Apps section */
  isApp?: boolean;
  /** The main() method that serves as app entry point */
  appEntry?: MethodInfo;
  /** Assets: UI templates, prompts, resources */
  assets?: PhotonAssets;
  /** User-editable description */
  description?: string;
  /** Display name from @label tag, or auto-prettified from name */
  label?: string;
  /** Emoji icon from @icon tag */
  icon?: string;
  /** True if marked with @internal (system photon, hidden from normal UI) */
  internal?: boolean;
  /** Version from @version tag or marketplace metadata */
  version?: string;
  /** Author from @author tag or marketplace metadata */
  author?: string;
  /** Number of MCP resources exposed */
  resourceCount?: number;
  /** Number of MCP prompt templates */
  promptCount?: number;
  /** Installation source info if installed from marketplace */
  installSource?: { marketplace: string; installedAt?: string };
  /** Constructor parameters (available for reconfiguration) */
  requiredParams?: ConfigParam[];
  /** Names of injected @photon dependencies (for client-side event routing) */
  injectedPhotons?: string[];
  /** True if marked with @stateful */
  stateful?: boolean;
  /** MCP OAuth auth requirement from @auth tag */
  auth?: string;
  /** True if photon has `protected settings = { ... }` */
  hasSettings?: boolean;
}

/**
 * Photon that needs configuration before use
 */
export interface UnconfiguredPhotonInfo {
  /** Unique ID (hash of path) - stable across restarts, unique across servers */
  id: string;
  /** Photon name (derived from filename) */
  name: string;
  /** Short photon name without duplicate disambiguation suffixes */
  shortName?: string;
  /** Namespace/owner when installed in a namespace directory */
  namespace?: string;
  /** Stable qualified identity (e.g. portel-dev:telegram) */
  qualifiedName?: string;
  /** Absolute path to .photon.ts file */
  path: string;
  /** Discriminator: always false for unconfigured photons */
  configured: false;
  /** Constructor parameters that need values */
  requiredParams: ConfigParam[];
  /** Human-readable error message explaining what's missing */
  errorMessage: string;
  /** Why this photon needs attention */
  errorReason?: 'missing-config' | 'load-error';
  /** Display name from @label tag, or auto-prettified from name */
  label?: string;
  /** True if marked with @internal (system photon, hidden from normal UI) */
  internal?: boolean;
  /** True if marked with @stateful */
  stateful?: boolean;
}

/**
 * Union type for any photon state
 *
 * Use type guard to narrow: `if (photon.configured) { ... }`
 */
export type AnyPhotonInfo = PhotonInfo | UnconfiguredPhotonInfo;

// ════════════════════════════════════════════════════════════════════════════════
// EXTERNAL MCP TYPES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * MCP server configuration from ~/.photon/config.json
 */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  transport?: 'stdio' | 'sse' | 'websocket';
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * External MCP server info (non-photon MCP from config)
 */
export interface ExternalMCPInfo {
  /** Discriminator: always 'external-mcp' for external MCPs */
  type: 'external-mcp';
  /** Unique ID (hash of name) */
  id: string;
  /** MCP name from config key */
  name: string;
  /** Connection status */
  connected: boolean;
  /** Error message if connection failed */
  errorMessage?: string;
  /** Fetched tools as methods */
  methods: MethodInfo[];
  /** Optional description */
  description?: string;
  /** Display label */
  label?: string;
  /** Icon emoji */
  icon?: string;
  /** Number of MCP resources */
  resourceCount?: number;
  /** Number of MCP prompts */
  promptCount?: number;
  /** Original config for reconnection */
  config: MCPServerConfig;
  /** MCP App resource URI (ui:// scheme) if the MCP has a custom UI - first/default UI */
  appResourceUri?: string;
  /** All MCP App resource URIs (ui:// scheme) if multiple UIs are available */
  appResourceUris?: string[];
  /** True if this MCP has an MCP App extension */
  hasApp?: boolean;
}

/**
 * Union type for any item in Beam sidebar
 */
export type AnyBeamItem = AnyPhotonInfo | ExternalMCPInfo;

/**
 * Type guard to check if an item is an external MCP
 */
export function isExternalMCP(item: AnyBeamItem): item is ExternalMCPInfo {
  return 'type' in item && item.type === 'external-mcp';
}

/**
 * Type guard to check if an item is a photon (configured or unconfigured)
 */
export function isPhoton(item: AnyBeamItem): item is AnyPhotonInfo {
  return !isExternalMCP(item);
}

// ════════════════════════════════════════════════════════════════════════════════
// MCP TYPES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Loaded photon instance
 */
export interface PhotonInstance {
  /** Instantiated photon class (any to allow method indexing) */
  instance: any;
  /** Class constructor for accessing static methods */
  classConstructor?: any;
  /** Extracted method schemas */
  schemas?: any[];
  /** Photon assets */
  assets?: PhotonAssets;
  /** Prompt templates extracted from photon */
  templates?: any[];
}

/**
 * UI Asset information for MCP Apps Extension (ui:// scheme)
 */
export interface UIAssetInfo {
  /** Asset identifier (e.g., 'main-ui', 'dashboard') */
  id: string;
  /** MCP resource URI (e.g., 'ui://photon-name/main-ui') */
  uri?: string;
  /** Relative path to HTML file */
  path: string;
  /** Resolved absolute path */
  resolvedPath?: string;
  /** MIME type (default: text/html) */
  mimeType?: string;
  /** Linked tool name if this UI is for a specific method */
  linkedTool?: string;
  /** Content Security Policy metadata from @csp JSDoc tag */
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// WEBSOCKET MESSAGE TYPES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Request to invoke a photon method
 */
export interface InvokeRequest {
  type: 'invoke';
  photon: string;
  method: string;
  args: Record<string, unknown>;
  /** For interactive UI invocations that need response routing */
  invocationId?: string;
}

/**
 * Request to configure an unconfigured photon
 */
export interface ConfigureRequest {
  type: 'configure';
  photon: string;
  config: Record<string, string>;
}

/**
 * Response to an elicitation (user input) request
 */
export interface ElicitationResponse {
  type: 'elicitation_response';
  value: unknown;
  cancelled?: boolean;
}

/**
 * Request to cancel current operation
 */
export interface CancelRequest {
  type: 'cancel';
}

/**
 * Request to reload a photon (hot reload)
 */
export interface ReloadRequest {
  type: 'reload';
  photon: string;
}

/**
 * Request to remove a photon
 */
export interface RemoveRequest {
  type: 'remove';
  photon: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// JSON-RPC TYPES (for MCP protocol)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 Notification (no id, no response expected)
 */
export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════════════════
// UI RENDERING TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type UIHint =
  | 'table'
  | 'tree'
  | 'list'
  | 'card'
  | 'form'
  | 'json'
  | 'text'
  | 'markdown'
  | 'code'
  | 'progress'
  | 'chart'
  | 'metric'
  | 'gauge'
  | 'timeline'
  | 'dashboard'
  | 'cart'
  | 'panels'
  | 'tabs'
  | 'accordion'
  | 'stack'
  | 'columns'
  | 'qr'
  | 'checklist'
  | 'article';

export type ProgressType = 'spinner' | 'percentage' | 'steps';

export interface UIMetadata {
  hint?: UIHint;
  title?: string;
  description?: string;
  columns?: string[];
  expandable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  paginated?: boolean;
  theme?: string;
  customCSS?: string;
}

export interface ProgressState {
  type: ProgressType;
  current?: number;
  total?: number;
  message?: string;
  step?: number;
  totalSteps?: number;
}

export interface RenderContext {
  format: 'cli' | 'mcp' | 'web';
  theme?: string;
  width?: number;
  height?: number;
  interactive?: boolean;
}

export interface ComponentProps {
  data: any;
  metadata: UIMetadata;
  context: RenderContext;
}

export interface UIComponent {
  render(props: ComponentProps): string | object;
  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean;
}

// ════════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Build MCP tool metadata extensions from MethodInfo
 *
 * Adds x-icon, x-autorun, x-output-format, x-layout-hints, x-button-label
 * to a tool object based on method configuration.
 *
 * @param method - MethodInfo to extract metadata from
 * @returns Object with x-* properties to spread into tool definition
 *
 * @example
 * ```typescript
 * const tool = {
 *   name: 'photon/method',
 *   description: method.description,
 *   inputSchema: method.params,
 *   ...buildToolMetadataExtensions(method)
 * };
 * ```
 */
export function buildToolMetadataExtensions(method: MethodInfo): Record<string, unknown> {
  const extensions: Record<string, unknown> = {};

  if (method.icon) {
    extensions['x-icon'] = method.icon;
  }
  if (method.autorun) {
    extensions['x-autorun'] = true;
  }
  if (method.outputFormat) {
    extensions['x-output-format'] = method.outputFormat;
  }
  if (method.layoutHints) {
    extensions['x-layout-hints'] = method.layoutHints;
  }
  if (method.buttonLabel) {
    extensions['x-button-label'] = method.buttonLabel;
  }
  if (method.webhook) {
    extensions['x-webhook'] = method.webhook;
  }
  if (method.scheduled) {
    extensions['x-scheduled'] = method.scheduled;
  }
  if (method.locked) {
    extensions['x-locked'] = method.locked;
  }
  if (method.isTemplate) {
    extensions['x-is-template'] = true;
  }

  // MCP standard annotations (not x-* extensions)
  const annotations: Record<string, unknown> = {};
  if (method.title) annotations.title = method.title;
  if (method.readOnlyHint) annotations.readOnlyHint = true;
  if (method.destructiveHint) annotations.destructiveHint = true;
  if (method.idempotentHint) annotations.idempotentHint = true;
  if (method.openWorldHint !== undefined) annotations.openWorldHint = method.openWorldHint;
  if (Object.keys(annotations).length > 0) {
    extensions.annotations = annotations;
  }

  // MCP structured output schema
  if (method.outputSchema) {
    extensions.outputSchema = method.outputSchema;
  }

  // MCP standard icons (image data URIs)
  if (method.icons && method.icons.length > 0) {
    extensions.icons = method.icons;
  }

  // MCP Tasks: execution.taskSupport (2025-11-25 spec)
  // @destructive methods and methods with generator asks support async task execution
  if (method.destructiveHint || method.hasGeneratorAsks) {
    extensions.execution = { taskSupport: 'optional' };
  }

  return extensions;
}

/**
 * Build UI metadata for tool response (MCP Apps Extension)
 *
 * @param photonName - Name of the photon
 * @param method - MethodInfo to extract metadata from
 * @returns Object with x-* properties for response metadata
 */
export function buildResponseUIMetadata(
  photonName: string,
  method: MethodInfo | undefined
): Record<string, unknown> {
  if (!method) return {};

  const metadata: Record<string, unknown> = {};

  if (method.outputFormat) {
    metadata['x-output-format'] = method.outputFormat;
  }
  if (method.layoutHints) {
    metadata['x-layout-hints'] = method.layoutHints;
  }

  return metadata;
}
