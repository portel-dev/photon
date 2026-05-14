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
  /**
   * Whether the param's name matches the secret-name regex
   * (apiKey, password, secret, token, bearer, ...). The Beam Setup
   * form relies on this to mask the input control and to keep
   * `currentValue` from carrying real credentials.
   */
  isSecret?: boolean;
  /**
   * Echo of the value currently in `process.env[envVar]` so the Setup
   * form can render "currently set to ..." for configured photons.
   * For secret fields this is `'***'` when set or `null` when missing,
   * never the actual value.
   */
  currentValue?: string | null;
  /**
   * Per-parameter JSDoc description, surfaced as field help under the
   * label in the Beam Setup form.
   */
  description?: string;
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

export const PHOTON_RENDER_META_KEY = 'photon/render';

export type PhotonRenderMode = 'auto' | 'custom';

export type PhotonIntentAction =
  | 'view'
  | 'list'
  | 'search'
  | 'create'
  | 'update'
  | 'delete'
  | 'configure'
  | 'navigate'
  | 'ask'
  | 'export'
  | 'monitor'
  | 'run';

export type PhotonIntentSource = 'methodName' | 'description' | 'annotations' | 'format' | 'schema';

export interface PhotonIntentMeta {
  /** Surface-neutral action Photon inferred from the method contract. */
  action: PhotonIntentAction;
  /** Domain noun the action operates on, derived from description or method name. */
  subject?: string;
  /** Confidence of the inferred action/subject pair, from 0.0 to 1.0. */
  confidence: number;
  /** Metadata sources that contributed to the inference. */
  sources: PhotonIntentSource[];
  /** MCP annotation-derived safety signals for client surfaces. */
  safety?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  };
  /** Input shape summary for surfaces that need forms, menus, or direct launch. */
  input?: {
    requiresInput: boolean;
    requiredFields?: string[];
    optionalFields?: string[];
  };
  /** Output shape summary for surface-specific renderers. */
  output?: {
    structured: boolean;
    format?: string;
    layout?: string;
  };
}

export interface PhotonRenderMeta {
  /** Renderer contract version for Photon clients. */
  version: 1;
  /** Whether the client should auto-render structured data or load a custom UI resource. */
  mode: PhotonRenderMode;
  /** Surface-neutral user intent inferred from method name, docs, schema, and MCP annotations. */
  intent?: PhotonIntentMeta;
  /** Auto UI renderer hint: table, list, chart:bar, dashboard, markdown, etc. */
  format?: string;
  /** Field mappings and layout hints such as title/subtitle/value fields. */
  layoutHints?: Record<string, string>;
  /** Optional command button label for the client shell. */
  buttonLabel?: string;
  /** Optional emoji/icon hint for the client shell. */
  icon?: string;
  /** Whether this tool should run when selected. */
  autorun?: boolean;
  /** True when this tool is a prompt/template-style MCP entry point. */
  isTemplate?: boolean;
  /** MCP Apps UI visibility for model/app callers. */
  visibility?: ('model' | 'app')[];
  /** MCP resource references needed by the renderer. */
  resources?: {
    /** Custom UI resource URI, usually ui://... */
    ui?: string;
  };
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
  /**
   * Frontend-only flag indicating an update is available from the photon's
   * marketplace install source. Set by the update-check flow in beam-app;
   * cleared on update or uninstall.
   */
  hasUpdate?: boolean;
  /** Frontend-only: the latest available version when hasUpdate is true. */
  updateVersion?: string;
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
  errorReason?: 'missing-config' | 'load-error' | 'missing-auth';
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
  /** True if this MCP has @get/@post web routes exposed at a stable URL */
  hasWebApp?: boolean;
  /** Base URL of the photon's web interface (from MCP capabilities.web) */
  webUrl?: string;
  /** Short description of the web interface */
  webDescription?: string;
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
  /** Prompt templates extracted from photon (method-level @prompt / @Template) */
  templates?: any[];
  /** Static resource resolvers extracted from photon (method-level @resource / @Static) */
  statics?: Array<{
    name: string;
    uri: string;
    description?: string;
    mimeType?: string;
    inputSchema?: Record<string, any>;
  }>;
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

export function buildPhotonRenderMeta(
  method: Partial<MethodInfo> | undefined,
  options: { uiResourceUri?: string } = {}
): PhotonRenderMeta | undefined {
  if (!method) return undefined;

  const render: PhotonRenderMeta = {
    version: 1,
    mode: options.uiResourceUri || method.linkedUi ? 'custom' : 'auto',
  };

  const intent = buildPhotonIntentMeta(method);
  if (intent) render.intent = intent;
  if (method.outputFormat) render.format = method.outputFormat;
  if (method.layoutHints) render.layoutHints = method.layoutHints;
  if (method.buttonLabel) render.buttonLabel = method.buttonLabel;
  if (method.icon) render.icon = method.icon;
  if (method.autorun) render.autorun = true;
  if (method.isTemplate) render.isTemplate = true;
  if (method.visibility) render.visibility = method.visibility;
  if (options.uiResourceUri) {
    render.resources = { ui: options.uiResourceUri };
  }

  const hasRenderableHints =
    render.mode === 'custom' ||
    !!render.intent ||
    !!render.format ||
    !!render.layoutHints ||
    !!render.buttonLabel ||
    !!render.icon ||
    !!render.autorun ||
    !!render.isTemplate ||
    !!render.visibility;

  return hasRenderableHints ? render : undefined;
}

const ACTION_PATTERNS: Array<{
  action: PhotonIntentAction;
  words: string[];
}> = [
  { action: 'delete', words: ['delete', 'remove', 'destroy', 'clear', 'reset', 'purge'] },
  { action: 'create', words: ['create', 'add', 'new', 'insert', 'register', 'import', 'upload'] },
  {
    action: 'update',
    words: ['update', 'edit', 'set', 'save', 'configure', 'rename', 'move', 'toggle', 'mark'],
  },
  { action: 'search', words: ['search', 'find', 'query', 'lookup', 'filter'] },
  { action: 'list', words: ['list', 'browse', 'index'] },
  { action: 'view', words: ['get', 'show', 'read', 'load', 'fetch', 'open', 'view'] },
  { action: 'navigate', words: ['go', 'navigate'] },
  { action: 'ask', words: ['ask', 'prompt', 'choose', 'select'] },
  { action: 'export', words: ['export', 'download'] },
  { action: 'monitor', words: ['watch', 'monitor', 'status', 'metrics', 'health'] },
  {
    action: 'run',
    words: [
      'run',
      'start',
      'stop',
      'restart',
      'execute',
      'generate',
      'build',
      'publish',
      'send',
      'sync',
    ],
  },
];

const VERB_PATTERN = ACTION_PATTERNS.flatMap((entry) => entry.words).join('|');

function buildPhotonIntentMeta(method: Partial<MethodInfo>): PhotonIntentMeta | undefined {
  const sources: PhotonIntentSource[] = [];
  const actionFromDescription = inferActionAndSubjectFromDescription(method.description);
  const actionFromName = inferActionAndSubjectFromName(method.name);
  const formatAction = inferActionFromFormat(method.outputFormat);

  const action =
    actionFromDescription?.action ??
    actionFromName?.action ??
    formatAction ??
    (method.destructiveHint ? 'delete' : undefined) ??
    'run';

  const subject = actionFromDescription?.subject ?? actionFromName?.subject;
  const input = summarizeInput(method.params);
  const output = summarizeOutput(method);
  const safety = summarizeSafety(method);

  if (actionFromDescription) sources.push('description');
  if (actionFromName) sources.push('methodName');
  if (
    method.readOnlyHint ||
    method.destructiveHint ||
    method.idempotentHint ||
    method.openWorldHint !== undefined
  ) {
    sources.push('annotations');
  }
  if (method.outputFormat) sources.push('format');
  if (input || output) sources.push('schema');

  const intent: PhotonIntentMeta = {
    action,
    ...(subject ? { subject } : {}),
    confidence: scoreIntentConfidence({
      hasDescriptionAction: !!actionFromDescription,
      hasNameAction: !!actionFromName,
      hasFormat: !!method.outputFormat,
      hasSchema: !!input || !!output,
    }),
    sources: [...new Set(sources)],
    ...(safety ? { safety } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
  };

  return intent;
}

function inferActionAndSubjectFromDescription(
  description: string | undefined
): { action: PhotonIntentAction; subject?: string } | undefined {
  if (!description) return undefined;
  const normalized = description.trim().toLowerCase();
  if (!normalized) return undefined;

  for (const entry of ACTION_PATTERNS) {
    for (const word of entry.words) {
      const match = normalized.match(new RegExp(`^${word}\\s+(.+)$`, 'i'));
      if (match) {
        return { action: entry.action, subject: cleanSubject(match[1]) };
      }
    }
  }

  return undefined;
}

function inferActionAndSubjectFromName(
  name: string | undefined
): { action: PhotonIntentAction; subject?: string } | undefined {
  if (!name) return undefined;
  const normalized = splitIdentifier(name).toLowerCase();
  if (!normalized) return undefined;

  for (const entry of ACTION_PATTERNS) {
    for (const word of entry.words) {
      const match = normalized.match(new RegExp(`^${word}(?:\\s+(.+))?$`, 'i'));
      if (match) {
        return { action: entry.action, subject: cleanSubject(match[1]) };
      }
    }
  }

  return undefined;
}

function inferActionFromFormat(format: string | undefined): PhotonIntentAction | undefined {
  if (!format) return undefined;
  if (
    format === 'dashboard' ||
    format.startsWith('chart:') ||
    format === 'metric' ||
    format === 'timeline'
  ) {
    return 'monitor';
  }
  if (format === 'table' || format === 'list' || format === 'checklist') return 'list';
  if (format === 'markdown' || format === 'article' || format === 'slides') return 'view';
  return undefined;
}

function summarizeInput(
  params: Record<string, unknown> | undefined
): PhotonIntentMeta['input'] | undefined {
  if (!params || params.type !== 'object') return undefined;
  const properties = isRecord(params.properties) ? params.properties : {};
  const requiredFields = Array.isArray(params.required)
    ? params.required.filter((field): field is string => typeof field === 'string')
    : [];
  const optionalFields = Object.keys(properties).filter((field) => !requiredFields.includes(field));

  return {
    requiresInput: requiredFields.length > 0,
    ...(requiredFields.length > 0 ? { requiredFields } : {}),
    ...(optionalFields.length > 0 ? { optionalFields } : {}),
  };
}

function summarizeOutput(method: Partial<MethodInfo>): PhotonIntentMeta['output'] | undefined {
  const returns = method.returns;
  const structured = !!(
    !!method.outputSchema ||
    (isRecord(returns) && (returns.type === 'object' || returns.type === 'array')) ||
    method.outputFormat === 'table' ||
    method.outputFormat === 'list' ||
    method.outputFormat?.startsWith('chart:') ||
    method.outputFormat === 'dashboard'
  );

  if (!structured && !method.outputFormat && !method.layoutHints) return undefined;

  return {
    structured,
    ...(method.outputFormat ? { format: method.outputFormat } : {}),
    ...(method.layoutHints?.container ? { layout: method.layoutHints.container } : {}),
  };
}

function summarizeSafety(method: Partial<MethodInfo>): PhotonIntentMeta['safety'] | undefined {
  const safety: PhotonIntentMeta['safety'] = {};
  if (method.readOnlyHint) safety.readOnly = true;
  if (method.destructiveHint) safety.destructive = true;
  if (method.idempotentHint) safety.idempotent = true;
  if (method.openWorldHint !== undefined) safety.openWorld = method.openWorldHint;
  return Object.keys(safety).length > 0 ? safety : undefined;
}

function scoreIntentConfidence(input: {
  hasDescriptionAction: boolean;
  hasNameAction: boolean;
  hasFormat: boolean;
  hasSchema: boolean;
}): number {
  let score = 0.45;
  if (input.hasDescriptionAction) score += 0.25;
  if (input.hasNameAction) score += 0.15;
  if (input.hasFormat) score += 0.1;
  if (input.hasSchema) score += 0.05;
  return Math.min(0.95, Number(score.toFixed(2)));
}

function splitIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSubject(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(new RegExp(`^(${VERB_PATTERN})\\s+`, 'i'), '')
    .replace(/[.;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildToolMCPMeta(
  method: MethodInfo,
  options: { uiResourceUri?: string; includeUi?: boolean } = {}
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const render = buildPhotonRenderMeta(method, { uiResourceUri: options.uiResourceUri });

  if (render) {
    meta[PHOTON_RENDER_META_KEY] = render;
  }

  if (options.includeUi !== false && (options.uiResourceUri || method.visibility)) {
    meta.ui = {
      ...(options.uiResourceUri ? { resourceUri: options.uiResourceUri } : {}),
      ...(method.visibility ? { visibility: method.visibility } : {}),
    };
  }

  return meta;
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

  const render = buildPhotonRenderMeta(method, {
    uiResourceUri: method.linkedUi ? `ui://${photonName}/${method.linkedUi}` : undefined,
  });
  if (render) {
    metadata._meta = {
      [PHOTON_RENDER_META_KEY]: render,
    };
  }

  return metadata;
}
