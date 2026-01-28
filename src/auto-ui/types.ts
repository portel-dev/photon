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
  /** Absolute path to .photon.ts file */
  path: string;
  /** Discriminator: always true for configured photons */
  configured: true;
  /** Available methods/tools */
  methods: MethodInfo[];
  /** Legacy @ui template path (deprecated, use assets.ui) */
  templatePath?: string;
  /** True if photon has main() with @ui - listed under Apps section */
  isApp?: boolean;
  /** The main() method that serves as app entry point */
  appEntry?: MethodInfo;
  /** Assets: UI templates, prompts, resources */
  assets?: PhotonAssets;
  /** User-editable description */
  description?: string;
  /** Emoji icon from @icon tag */
  icon?: string;
  /** True if marked with @internal (system photon, hidden from normal UI) */
  internal?: boolean;
}

/**
 * Photon that needs configuration before use
 */
export interface UnconfiguredPhotonInfo {
  /** Unique ID (hash of path) - stable across restarts, unique across servers */
  id: string;
  /** Photon name (derived from filename) */
  name: string;
  /** Absolute path to .photon.ts file */
  path: string;
  /** Discriminator: always false for unconfigured photons */
  configured: false;
  /** Constructor parameters that need values */
  requiredParams: ConfigParam[];
  /** Human-readable error message explaining what's missing */
  errorMessage: string;
}

/**
 * Union type for any photon state
 *
 * Use type guard to narrow: `if (photon.configured) { ... }`
 */
export type AnyPhotonInfo = PhotonInfo | UnconfiguredPhotonInfo;

// ════════════════════════════════════════════════════════════════════════════════
// MCP TYPES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Loaded photon MCP instance
 */
export interface PhotonMCPInstance {
  /** Instantiated photon class (any to allow method indexing) */
  instance: any;
  /** Class constructor for accessing static methods */
  classConstructor?: any;
  /** Extracted method schemas */
  schemas?: any[];
  /** Photon assets */
  assets?: PhotonAssets;
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
  | 'chart';

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
  if (method.linkedUi) {
    extensions['x-linked-ui'] = method.linkedUi;
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

  if (method.linkedUi) {
    metadata['x-ui-uri'] = `ui://${photonName}/${method.linkedUi}`;
  }
  if (method.outputFormat) {
    metadata['x-output-format'] = method.outputFormat;
  }
  if (method.layoutHints) {
    metadata['x-layout-hints'] = method.layoutHints;
  }

  return metadata;
}
