/**
 * Streamable HTTP Transport for MCP
 *
 * Implements the MCP Streamable HTTP transport specification (2025-03-26).
 * This allows standard MCP clients (like Claude Desktop) to connect to Beam.
 *
 * Endpoint: /mcp
 * - POST: Client sends JSON-RPC requests, server responds with JSON or SSE
 * - GET: Opens SSE stream for server-initiated messages
 *
 * Configuration Schema (SEP-1596 inspired):
 * - Returns configurationSchema in initialize response
 * - Uses JSON Schema for rich UI generation (dropdowns, file pickers, etc.)
 * - beam/configure tool for submitting configuration
 * - beam/browse tool for server filesystem browsing
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import { randomUUID, timingSafeEqual, type JsonWebKey } from 'crypto';
import { readdir, stat, readFile, writeFile } from 'fs/promises';
import { readText } from '../shared/io.js';
import { join, dirname, extname, resolve, normalize } from 'path';
import { homedir } from 'os';
import { PHOTON_VERSION } from '../version.js';
import { formatToolError, sanitizePublicErrorMessage } from '../shared/error-handler.js';
import { SimpleRateLimiter, getCorsOrigin } from '../shared/security.js';

// Default rate limit: 600 requests/min per source IP. Beam app UI opens several
// MCP sessions and can legitimately burst while navigating between photons.
// Override via
// PHOTON_MCP_RATE_LIMIT (count) and PHOTON_MCP_RATE_WINDOW_MS (window).
const MCP_RATE_LIMIT = Math.max(1, parseInt(process.env.PHOTON_MCP_RATE_LIMIT || '600', 10) || 600);
const MCP_RATE_WINDOW_MS = Math.max(
  1_000,
  parseInt(process.env.PHOTON_MCP_RATE_WINDOW_MS || '60000', 10) || 60_000
);
const mcpRateLimiter = new SimpleRateLimiter(MCP_RATE_LIMIT, MCP_RATE_WINDOW_MS);
import { AGUIEventType } from '../ag-ui/types.js';
import { proxyExternalAgent, createAGUIOutputHandler } from '../ag-ui/adapter.js';
import type { RunAgentInput } from '../ag-ui/types.js';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  ConfigParam,
  MethodInfo,
  PhotonInfo,
  UnconfiguredPhotonInfo,
  AnyPhotonInfo,
  PhotonInstance,
  ExternalMCPInfo,
} from './types.js';
import { buildResponseUIMetadata, buildToolMCPMeta, buildToolMetadataExtensions } from './types.js';
import { generateServerCard } from '../server-card.js';
import { audit } from '../shared/audit.js';
import { writePhotonEditorDeclaration } from '../photon-editor-declarations.js';
import {
  isUriTemplate,
  matchUriTemplate,
  parseUriTemplateParams,
  SubscriptionRegistry,
  type ResourceUpdateSink,
} from '../resource-server.js';
import {
  createTask,
  getTask,
  updateTask,
  transitionTask,
  listTasks,
  registerController,
  unregisterController,
  getController,
  taskEvents,
} from '../tasks/store.js';
import {
  toWireFormat,
  toModernTaskWire,
  taskErrorMessage,
  relatedTaskMeta,
  TERMINAL_STATES,
  type Task,
  type TaskAccessBinding,
} from '../tasks/types.js';

function uiAssetPath(asset: { path?: string; resolvedPath?: string }): string {
  return asset.resolvedPath || asset.path || '';
}

function isTsxUiAsset(asset: { path?: string; resolvedPath?: string }): boolean {
  return uiAssetPath(asset).endsWith('.tsx');
}

function selectClientAppUi(photon: PhotonInfo | undefined): string | undefined {
  const uiAssets = photon?.assets?.ui || [];
  const linkedUi = photon?.appEntry?.linkedUi;
  if (linkedUi) {
    const linkedAsset = uiAssets.find((ui) => ui.id === linkedUi);
    // Only a known TSX asset owns the direct /web client-app route. A missing
    // asset may be a legacy HTML @ui, which needs the Photon bridge injected by
    // Beam's custom-ui renderer instead.
    if (linkedAsset && isTsxUiAsset(linkedAsset)) return linkedUi;
  }

  const namedApp = uiAssets.find((ui) => ui.id === 'app' && isTsxUiAsset(ui));
  if (namedApp) return namedApp.id;

  const tsxAssets = uiAssets.filter(isTsxUiAsset);
  if (tsxAssets.length === 1) return tsxAssets[0].id;

  return undefined;
}

function selectWebAppUrl(
  photon: PhotonInfo,
  photonClass: { _httpRoutes?: Array<{ method: string; path: string }> } | undefined
): string | undefined {
  const hasWebRoot = photonClass?._httpRoutes?.some(
    (route) => route.method === 'GET' && route.path === '/'
  );
  if (!hasWebRoot && !selectClientAppUi(photon)) return undefined;
  return `/web/${photon.name}/`;
}
import {
  runTaskExecution,
  requestTaskInput,
  resolveTaskInput,
  rejectTaskInput,
  submitTaskInputResponses,
  waitForTerminalOrInput,
} from '../tasks/executor.js';
import { generateAgentCard } from '../a2a/card-generator.js';
import { isPathInScope } from '../daemon/claims.js';
import {
  MCP_PROTOCOL_VERSIONS,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  isStatelessMCPProtocolVersion,
  isSupportedMCPProtocolVersion,
} from '../mcp/protocol/versions.js';
import { validateMCPRequestBatch } from '../mcp/protocol/request-validation.js';
import { JSON_RPC_ERROR_CODES, MCP_2026_ERROR_CODES } from '../mcp/protocol/errors.js';
import {
  MCP_TASKS_EXTENSION_ID,
  PHOTON_EXTENSION_ID,
  clientSupportsMCPApps,
  hasClientExtension,
  isPhotonPrivateMetadataKey,
} from '../mcp/protocol/extensions.js';
import {
  validateStructuredOutput,
  type FiniteJSONValue,
  type JSONSchemaValidationFailure,
} from '../mcp/protocol/json-schema.js';
import {
  buildMCPErrorReference,
  buildMCPToolError,
  PHOTON_TOOL_ERROR_CODES,
  PHOTON_TOOL_ERROR_META_KEY,
  type PhotonToolErrorContext,
  type PhotonToolErrorResult,
} from '../mcp/protocol/tool-errors.js';
import {
  canonicalizeMCPResponse,
  selectMCPWireAdapter,
  type MCPWireAdapter,
} from '../mcp/protocol/response-adapter.js';
import {
  DurableStatelessInputStateStore,
  hashInputStateValue,
  StatelessInputStateError,
  type MCPInputResponses,
  type StatelessInputBinding,
} from '../mcp/protocol/input-required.js';
import {
  parseMCPHeaderBindings,
  validateMCPParamHeaders,
} from '../mcp/protocol/routing-headers.js';
import { verifyPhotonAuthToken, type PhotonJwtVerifyReason } from '../auth/mcp-jwt.js';
import {
  validateTracePropagation,
  type TracePropagationContext,
  type TracePropagationValidation,
} from '../telemetry/propagation.js';
import { AppSessionHandleStore, type AppSessionBinding } from '../mcp/protocol/app-sessions.js';
import { IdempotencyStore, PHOTON_IDEMPOTENCY_META_KEY } from '../mcp/protocol/idempotency.js';

const MCP_LIST_PAGE_SIZE = 100;
const MAX_MCP_REQUEST_BODY_BYTES = 1_048_576;

class InvalidCursorError extends Error {
  constructor(cursor: unknown) {
    super(`Invalid pagination cursor: ${String(cursor)}`);
  }
}

function encodeListCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

function decodeListCursor(cursor: unknown): number {
  if (cursor == null || cursor === '') return 0;
  if (typeof cursor !== 'string') throw new InvalidCursorError(cursor);

  // Accept the old task-style numeric cursor shape defensively, but emit opaque
  // base64url cursors for all new paginated list results.
  if (/^\d+$/.test(cursor)) {
    const offset = Number(cursor);
    if (Number.isSafeInteger(offset)) return offset;
    throw new InvalidCursorError(cursor);
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      offset?: unknown;
    };
    // Unversioned {offset} cursors were emitted before WP3. Continue accepting
    // them alongside the new v1 shape, but reject unknown future versions.
    if (decoded.v !== undefined && decoded.v !== 1) {
      throw new Error('unsupported cursor version');
    }
    if (!Number.isSafeInteger(decoded.offset) || (decoded.offset as number) < 0) {
      throw new Error('cursor offset must be a non-negative integer');
    }
    return decoded.offset as number;
  } catch {
    throw new InvalidCursorError(cursor);
  }
}

function paginateMCPList<T>(
  items: T[],
  cursor: unknown,
  pageSize = MCP_LIST_PAGE_SIZE
): { items: T[]; nextCursor?: string } {
  const offset = decodeListCursor(cursor);
  if (offset > items.length) throw new InvalidCursorError(cursor);
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  return {
    items: page,
    ...(nextOffset < items.length ? { nextCursor: encodeListCursor(nextOffset) } : {}),
  };
}

function compareCanonicalIdentifier(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSortMCPList<T>(
  items: readonly T[],
  identifier: (item: T) => string,
  tieBreaker?: (item: T) => string
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const primary = compareCanonicalIdentifier(identifier(left.item), identifier(right.item));
      if (primary !== 0) return primary;
      if (tieBreaker) {
        const secondary = compareCanonicalIdentifier(tieBreaker(left.item), tieBreaker(right.item));
        if (secondary !== 0) return secondary;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function invalidCursorResponse(id: unknown, error: Error): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    ...(typeof id === 'string' || typeof id === 'number' ? { id } : {}),
    error: { code: -32602, message: error.message },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// JWT HELPERS
// ════════════════════════════════════════════════════════════════════════════════

export interface MCPBearerVerificationContext {
  resource: string;
  expectedIssuer?: string;
  requiredScopes: string[];
}

export type MCPBearerVerificationResult =
  | {
      ok: true;
      claims: Record<string, unknown> & {
        sub?: string;
        client_id?: string;
        scope?: string;
        name?: string;
        preferred_username?: string;
      };
    }
  | { ok: false; reason: PhotonJwtVerifyReason | 'configuration_error' };

function bearerToken(authHeader: string | string[] | undefined): string | null {
  if (Array.isArray(authHeader) || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer[ \t]+([^\s,]+)$/i);
  return match?.[1] ?? null;
}

function constantTimeTokenMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

let cachedMCPJwtProfile: { name: string; issuer: string; jwks: { keys: JsonWebKey[] } } | undefined;

async function configuredMCPJwtProfile(): Promise<{
  issuer: string;
  jwks: { keys: JsonWebKey[] };
} | null> {
  const profileName = process.env.PHOTON_MCP_JWT_PROFILE;
  if (profileName) {
    if (cachedMCPJwtProfile?.name === profileName) return cachedMCPJwtProfile;
    try {
      const { loadPhotonAuth } = await import('../cli/commands/auth.js');
      const loaded = await loadPhotonAuth(profileName);
      cachedMCPJwtProfile = {
        name: profileName,
        issuer: loaded.issuer.issuer,
        jwks: loaded.jwks,
      };
      return cachedMCPJwtProfile;
    } catch {
      return null;
    }
  }

  const issuer = process.env.PHOTON_MCP_JWT_ISSUER;
  if (!issuer || !process.env.PHOTON_MCP_JWT_JWKS) return null;
  try {
    const jwks = JSON.parse(process.env.PHOTON_MCP_JWT_JWKS) as { keys: JsonWebKey[] };
    return Array.isArray(jwks.keys) ? { issuer, jwks } : null;
  } catch {
    return null;
  }
}

async function verifyConfiguredMCPBearer(
  token: string,
  context: MCPBearerVerificationContext
): Promise<MCPBearerVerificationResult> {
  const authMode =
    process.env.PHOTON_MCP_AUTH_MODE || (process.env.PHOTON_MCP_BEARER ? 'bearer' : 'legacy');
  if (authMode === 'bearer') {
    const expected = process.env.PHOTON_MCP_BEARER;
    if (!expected || !constantTimeTokenMatch(token, expected)) {
      return { ok: false, reason: 'bad_signature' };
    }
    return {
      ok: true,
      claims: {
        sub: 'photon-static-bearer',
        client_id: 'photon-static-bearer',
        scope: context.requiredScopes.join(' '),
        aud: context.resource,
      },
    };
  }
  if (authMode !== 'jwt') return { ok: false, reason: 'configuration_error' };

  const profile = await configuredMCPJwtProfile();
  const audience = process.env.PHOTON_MCP_JWT_AUDIENCE;
  if (
    !profile ||
    !audience ||
    audience !== context.resource ||
    (context.expectedIssuer !== undefined && profile.issuer !== context.expectedIssuer)
  ) {
    return { ok: false, reason: 'configuration_error' };
  }
  const verified = verifyPhotonAuthToken(token, {
    issuer: profile.issuer,
    audience,
    jwks: profile.jwks,
    requiredScopes: context.requiredScopes,
  });
  return verified.ok
    ? { ok: true, claims: verified.claims }
    : { ok: false, reason: verified.reason };
}

function callerFromVerifiedClaims(claims: MCPBearerVerificationResult & { ok: true }): CallerInfo {
  const value = claims.claims;
  return {
    id:
      (typeof value.sub === 'string' && value.sub) ||
      (typeof value.client_id === 'string' && value.client_id) ||
      'verified-caller',
    name:
      (typeof value.name === 'string' && value.name) ||
      (typeof value.preferred_username === 'string' && value.preferred_username) ||
      undefined,
    anonymous: false,
    scope: typeof value.scope === 'string' ? value.scope : undefined,
    claims: value,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL TYPES (specific to this transport)
// ════════════════════════════════════════════════════════════════════════════════

interface MCPSession {
  id: string;
  initialized: boolean;
  createdAt: Date;
  lastActivity: Date;
  sseResponse?: ServerResponse; // For server-to-client notifications
  sseOpenedAt?: Date;
  remoteAddress?: string;
  userAgent?: string;
  isBeam?: boolean; // True if client is Beam UI
  clientInfo?: { name: string; version: string };
  clientCapabilities?: Record<string, unknown>;
  clientProfile?: ClientProfile;
  /** Principal bound to this legacy transport session after verified OAuth. */
  caller?: CallerInfo;
  /** Tracked instance name for daemon drift recovery */
  instanceName?: string;
  /**
   * If this session presented a valid `Mcp-Claim-Code` on initialize,
   * photons outside this directory are filtered out of tools/list. When
   * unset the session has unscoped (full) access — the default.
   * See src/daemon/claims.ts for the full claim-code story.
   */
  claimScopeDir?: string;
}

export type MCPProtocolMode = 'legacy-sessionful' | 'stateless';

export interface ClientProfile {
  protocolVersion: string;
  clientName?: string;
  clientVersion?: string;
  mode: MCPProtocolMode;
  capabilities: {
    tools: boolean;
    prompts: boolean;
    resources: boolean;
    sampling: boolean;
    mcpApps: boolean;
    photon: boolean;
    tasks: 'none' | 'legacy-core' | 'extension';
    cacheMetadata: boolean;
  };
  quirks: {
    unnamespacedToolNames: boolean;
    prefersOpenAIAppMetadata: boolean;
    requiresLegacyInitializeConfigSchema: boolean;
  };
}

export interface PhotonRequestContext {
  requestId?: string | number;
  protocolVersion: string;
  transport: 'streamable-http';
  client: ClientProfile;
  caller?: CallerInfo;
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
  legacyTransportSessionId?: string;
  appSessionId?: string;
  appSessionSource:
    | 'explicit-meta'
    | 'explicit-argument'
    | 'header'
    | 'issued'
    | 'legacy-mcp-session'
    | 'caller-default'
    | 'anonymous-default';
  scopeDir?: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  'x-photon-id'?: string;
  [key: string]: unknown; // Allow additional x-* properties
}

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

function isOpenAIAppSession(session: MCPSession): boolean {
  return !!session.clientProfile?.quirks.unnamespacedToolNames;
}

function namespacedToolName(serverName: string, methodName: string): string {
  return `${serverName}.${methodName}`;
}

function toolNameForSession(session: MCPSession, photonName: string, methodName: string): string {
  return isOpenAIAppSession(session) ? methodName : namespacedToolName(photonName, methodName);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requestMeta(request: JSONRPCRequest): Record<string, unknown> {
  const params = isRecord(request.params) ? request.params : undefined;
  const meta = params?._meta;
  return isRecord(meta) ? meta : {};
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function capabilitiesFrom(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requestParamRecord(request: JSONRPCRequest | undefined): Record<string, unknown> {
  return request && isRecord(request.params) ? request.params : {};
}

function resolveClientProfile(
  request: JSONRPCRequest | undefined,
  session: MCPSession,
  headers: IncomingHttpHeaders
): ClientProfile {
  const meta = request ? requestMeta(request) : {};
  const params = requestParamRecord(request);
  const paramClientInfo = capabilitiesFrom(params.clientInfo);
  const paramCapabilities = capabilitiesFrom(params.capabilities);
  const metaCapabilities = {
    ...capabilitiesFrom(meta.capabilities),
    ...capabilitiesFrom(meta['io.modelcontextprotocol/clientCapabilities']),
  };
  const sessionCapabilities = capabilitiesFrom(session.clientCapabilities);

  const headerProtocol = firstHeaderValue(headers['mcp-protocol-version']);
  const protocolVersion =
    stringFromRecord(meta, [
      'io.modelcontextprotocol/protocolVersion',
      'protocolVersion',
      'mcp/protocolVersion',
    ]) ||
    headerProtocol ||
    (typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined) ||
    session.clientProfile?.protocolVersion ||
    '2025-11-25';
  const isStateless = isStatelessMCPProtocolVersion(protocolVersion);
  const metaClient = isStateless
    ? capabilitiesFrom(meta['io.modelcontextprotocol/clientInfo'])
    : {
        ...capabilitiesFrom(meta.client),
        ...capabilitiesFrom(meta['io.modelcontextprotocol/clientInfo']),
      };

  const clientName =
    stringFromRecord(metaClient, ['name']) ||
    (!isStateless
      ? stringFromRecord(meta, ['clientName', 'mcp/clientName']) ||
        (typeof paramClientInfo.name === 'string' ? paramClientInfo.name : undefined) ||
        session.clientInfo?.name
      : undefined);
  const clientVersion =
    stringFromRecord(metaClient, ['version']) ||
    (!isStateless
      ? stringFromRecord(meta, ['clientVersion', 'mcp/clientVersion']) ||
        (typeof paramClientInfo.version === 'string' ? paramClientInfo.version : undefined) ||
        session.clientInfo?.version
      : undefined);
  const normalizedName = clientName?.toLowerCase();
  const mode: MCPProtocolMode = isStateless ? 'stateless' : 'legacy-sessionful';

  const mergedCapabilities = isStateless
    ? capabilitiesFrom(meta['io.modelcontextprotocol/clientCapabilities'])
    : {
        ...sessionCapabilities,
        ...paramCapabilities,
        ...metaCapabilities,
      };
  const experimental = capabilitiesFrom(mergedCapabilities.experimental);
  const extensions = isStateless
    ? capabilitiesFrom(mergedCapabilities.extensions)
    : {
        ...capabilitiesFrom(mergedCapabilities.extensions),
        ...capabilitiesFrom(meta.extensions),
      };

  const mcpApps =
    mode === 'stateless'
      ? clientSupportsMCPApps(mergedCapabilities)
      : !!extensions['mcp-apps'] ||
        !!extensions.apps ||
        !!experimental['mcp-apps'] ||
        !!experimental.apps ||
        normalizedName === 'chatgpt' ||
        !!normalizedName?.includes('openai') ||
        session.isBeam === true;
  const photon =
    mode === 'stateless' ? hasClientExtension(mergedCapabilities, PHOTON_EXTENSION_ID) : true;

  return {
    protocolVersion,
    clientName,
    clientVersion,
    mode,
    capabilities: {
      tools: mergedCapabilities.tools !== false,
      prompts: mergedCapabilities.prompts !== false,
      resources: mergedCapabilities.resources !== false,
      sampling: !!mergedCapabilities.sampling,
      mcpApps,
      photon,
      tasks:
        mode === 'stateless'
          ? Object.prototype.hasOwnProperty.call(extensions, 'io.modelcontextprotocol/tasks')
            ? 'extension'
            : 'none'
          : 'legacy-core',
      cacheMetadata: mode === 'stateless',
    },
    quirks: {
      unnamespacedToolNames:
        mode === 'legacy-sessionful' &&
        (normalizedName === 'chatgpt' || !!normalizedName?.includes('openai')),
      prefersOpenAIAppMetadata:
        mode === 'legacy-sessionful' &&
        (normalizedName === 'chatgpt' || !!normalizedName?.includes('openai')),
      requiresLegacyInitializeConfigSchema: mode === 'legacy-sessionful',
    },
  };
}

function resolvePhotonRequestContext(input: {
  request: JSONRPCRequest;
  session: MCPSession;
  headers: IncomingHttpHeaders;
  caller?: CallerInfo;
}): PhotonRequestContext {
  const { request, session, headers, caller } = input;
  const meta = requestMeta(request);
  const args =
    isRecord(request.params) && isRecord(request.params.arguments) ? request.params.arguments : {};
  const client = resolveClientProfile(request, session, headers);
  const explicitMetaSession =
    client.mode === 'stateless'
      ? client.capabilities.photon
        ? stringFromRecord(meta, [`${PHOTON_EXTENSION_ID}/appSessionId`])
        : undefined
      : stringFromRecord(meta, ['photon/appSessionId', 'appSessionId', 'photon/sessionId']);
  const explicitArgSession =
    client.mode === 'legacy-sessionful'
      ? stringFromRecord(args, ['appSessionId', 'photonSessionId'])
      : undefined;
  const headerSession =
    client.mode === 'legacy-sessionful'
      ? firstHeaderValue(headers['x-photon-app-session-id'])
      : undefined;
  const fallbackSessionId =
    client.mode === 'legacy-sessionful'
      ? session.id
      : caller && !caller.anonymous
        ? `caller:${caller.id}`
        : 'anonymous';
  const appSessionId =
    explicitMetaSession || explicitArgSession || headerSession || fallbackSessionId;
  const traceValidation = resolveRequestTracePropagation(request, headers);
  const traceContext = traceValidation.ok ? traceValidation.context : {};

  return {
    requestId: request.id,
    protocolVersion: client.protocolVersion,
    transport: 'streamable-http',
    client,
    caller,
    ...traceContext,
    legacyTransportSessionId: session.id,
    appSessionId,
    appSessionSource: explicitMetaSession
      ? 'explicit-meta'
      : explicitArgSession
        ? 'explicit-argument'
        : headerSession
          ? 'header'
          : client.mode === 'legacy-sessionful'
            ? 'legacy-mcp-session'
            : caller && !caller.anonymous
              ? 'caller-default'
              : 'anonymous-default',
    scopeDir: session.claimScopeDir,
  };
}

function resolveRequestTracePropagation(
  request: JSONRPCRequest,
  headers: IncomingHttpHeaders
): TracePropagationValidation {
  const meta = requestMeta(request);
  const input: TracePropagationContext = {};
  for (const field of ['traceparent', 'tracestate', 'baggage'] as const) {
    const hasMeta = Object.prototype.hasOwnProperty.call(meta, field);
    const metaValue = hasMeta ? meta[field] : undefined;
    const headerValue = headers[field];
    if (
      (hasMeta && typeof metaValue !== 'string') ||
      (headerValue !== undefined && typeof headerValue !== 'string')
    ) {
      return { ok: false, field, reason: `${field} must be a single string` };
    }
    if (
      typeof metaValue === 'string' &&
      typeof headerValue === 'string' &&
      metaValue !== headerValue
    ) {
      return { ok: false, field, reason: `${field} metadata and HTTP header disagree` };
    }
    const value =
      typeof metaValue === 'string'
        ? metaValue
        : typeof headerValue === 'string'
          ? headerValue
          : undefined;
    if (value !== undefined) input[field] = value;
  }
  return validateTracePropagation(input);
}

function buildStatelessInputBinding(
  context: HandlerContext,
  target: string,
  args: unknown,
  purpose: 'execute' | 'destructive' = 'execute',
  protocolMethod = 'tools/call'
): StatelessInputBinding {
  const caller = context.caller;
  const claims = caller?.claims;
  const principal = hashInputStateValue({
    id: caller?.id ?? 'anonymous',
    issuer: typeof claims?.iss === 'string' ? claims.iss : '',
    audience:
      typeof claims?.aud === 'string' ? claims.aud : Array.isArray(claims?.aud) ? claims.aud : [],
    clientId: typeof claims?.client_id === 'string' ? claims.client_id : '',
  });
  const scope = hashInputStateValue({
    oauthScope: caller?.scope ?? '',
    claimScopeDir: context.requestContext?.scopeDir ?? '',
  });
  const requestContext = context.requestContext;
  const appSession =
    requestContext &&
    (requestContext.appSessionSource === 'explicit-meta' ||
      requestContext.appSessionSource === 'explicit-argument' ||
      requestContext.appSessionSource === 'header' ||
      requestContext.appSessionSource === 'issued')
      ? hashInputStateValue(requestContext.appSessionId ?? '')
      : '';
  return {
    protocolVersion: requestContext?.protocolVersion ?? MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28,
    principal,
    scope,
    appSession,
    method: protocolMethod,
    target: `${target}#${purpose}`,
    argumentsHash: hashInputStateValue(args ?? {}),
  };
}

function buildCallerScopeBinding(
  caller: CallerInfo | undefined,
  requestContext: PhotonRequestContext | undefined
): AppSessionBinding {
  const claims = caller?.claims;
  return {
    principal: hashInputStateValue({
      id: caller?.id ?? 'anonymous',
      issuer: typeof claims?.iss === 'string' ? claims.iss : '',
      audience:
        typeof claims?.aud === 'string' ? claims.aud : Array.isArray(claims?.aud) ? claims.aud : [],
      clientId: typeof claims?.client_id === 'string' ? claims.client_id : '',
    }),
    scope: hashInputStateValue({
      oauthScope: caller?.scope ?? '',
      claimScopeDir: requestContext?.scopeDir ?? '',
    }),
  };
}

function buildTaskAccessBinding(context: HandlerContext): TaskAccessBinding {
  const binding = buildStatelessInputBinding(context, 'tasks', {}, 'execute');
  return {
    principal: binding.principal,
    scope: binding.scope,
    ...(binding.appSession ? { appSession: binding.appSession } : {}),
  };
}

function buildAppSessionBinding(context: HandlerContext): AppSessionBinding {
  return buildCallerScopeBinding(context.caller, context.requestContext);
}

function taskAccessMatches(task: Task, context: HandlerContext): boolean {
  if (task.protocol !== 'extension-2026' || !task.owner) return false;
  const owner = buildTaskAccessBinding(context);
  return (
    task.owner.principal === owner.principal &&
    task.owner.scope === owner.scope &&
    (task.owner.appSession ?? '') === (owner.appSession ?? '')
  );
}

export const __streamableHttpTransportInternals = {
  resolveClientProfile,
  resolvePhotonRequestContext,
  resolveRequestTracePropagation,
  cacheScopeForRequest,
  sanitizeStatelessSubscriptionFilters: (candidate: Record<string, unknown>) =>
    sanitizeStatelessSubscriptionFilters(candidate),
  statelessSubscriptionLimits: () => ({
    global: MAX_STATELESS_SUBSCRIPTIONS,
    perPrincipal: MAX_STATELESS_SUBSCRIPTIONS_PER_PRINCIPAL,
    resourceFilters: MAX_STATELESS_RESOURCE_FILTERS,
    resourceUriLength: MAX_STATELESS_RESOURCE_URI_LENGTH,
    queuedBytes: MAX_STATELESS_BLOCKED_BYTES,
    keepaliveMs: STATELESS_SUBSCRIPTION_KEEPALIVE_MS,
    backpressureTimeoutMs: STATELESS_SUBSCRIPTION_BACKPRESSURE_TIMEOUT_MS,
  }),
  activeStatelessSubscriptionCount: () => statelessSubscriptions.size,
};

function splitNamespacedToolName(name: string): { serverName: string; methodName: string } | null {
  const dotIndex = name.indexOf('.');
  if (dotIndex !== -1) {
    return {
      serverName: name.slice(0, dotIndex),
      methodName: name.slice(dotIndex + 1),
    };
  }

  const slashIndex = name.indexOf('/');
  if (slashIndex !== -1) {
    return {
      serverName: name.slice(0, slashIndex),
      methodName: name.slice(slashIndex + 1),
    };
  }

  return null;
}

function methodInfoForTool(
  name: string,
  photons: AnyPhotonInfo[],
  externalMCPs: ExternalMCPInfo[] | undefined
): MethodInfo | undefined {
  const split = splitNamespacedToolName(name);
  if (!split) return undefined;
  const photon = photons.find((candidate) => candidate.name === split.serverName);
  const native = photon?.configured
    ? photon.methods?.find((method) => method.name === split.methodName)
    : undefined;
  if (native) return native;
  return externalMCPs
    ?.find((candidate) => candidate.name === split.serverName)
    ?.methods?.find((method) => method.name === split.methodName);
}

function nativePhotonAndMethodForTool(
  name: string,
  photons: AnyPhotonInfo[]
): { photon: PhotonInfo; method: MethodInfo } | undefined {
  const split = splitNamespacedToolName(name);
  if (split) {
    const photon = photons.find(
      (candidate): candidate is PhotonInfo =>
        candidate.configured && candidate.name === split.serverName
    );
    const method = photon?.methods?.find((candidate) => candidate.name === split.methodName);
    return photon && method ? { photon, method } : undefined;
  }
  const matches = photons.flatMap((candidate) => {
    if (!candidate.configured) return [];
    const method = candidate.methods?.find((item) => item.name === name);
    return method ? [{ photon: candidate, method }] : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function oauthResourceForRequest(req: IncomingMessage, options: StreamableHTTPOptions): string {
  if (options.oauthResource) return options.oauthResource;
  if (process.env.PHOTON_MCP_JWT_AUDIENCE) return process.env.PHOTON_MCP_JWT_AUDIENCE;
  if (process.env.PHOTON_PUBLIC_URL) {
    return `${process.env.PHOTON_PUBLIC_URL.replace(/\/+$/, '')}/mcp`;
  }
  const port = req.socket.localPort ? `:${req.socket.localPort}` : '';
  return `http://127.0.0.1${port}/mcp`;
}

function oauthResourceMetadataForRequest(
  req: IncomingMessage,
  options: StreamableHTTPOptions,
  resource: string
): string {
  if (options.oauthResourceMetadataUrl) return options.oauthResourceMetadataUrl;
  if (process.env.PHOTON_MCP_RESOURCE_METADATA_URL) {
    return process.env.PHOTON_MCP_RESOURCE_METADATA_URL;
  }
  try {
    return new URL('/.well-known/oauth-protected-resource', resource).toString();
  } catch {
    const port = req.socket.localPort ? `:${req.socket.localPort}` : '';
    return `http://127.0.0.1${port}/.well-known/oauth-protected-resource`;
  }
}

function authorizationRequirements(
  requests: readonly JSONRPCRequest[],
  photons: AnyPhotonInfo[],
  externalMCPs: ExternalMCPInfo[] | undefined
): {
  protected: boolean;
  requiredScopes: string[];
  expectedIssuer?: string;
  requestId?: string | number;
  configurationError?: boolean;
} {
  const authMode =
    process.env.PHOTON_MCP_AUTH_MODE || (process.env.PHOTON_MCP_BEARER ? 'bearer' : 'legacy');
  const scopes = new Set<string>();
  const issuers = new Set<string>();
  let isProtected = false;
  let requestId: string | number | undefined;

  for (const request of requests) {
    if (
      request.method !== 'tools/call' ||
      !isRecord(request.params) ||
      typeof request.params.name !== 'string'
    ) {
      continue;
    }
    const target = nativePhotonAndMethodForTool(request.params.name, photons);
    const method = target?.method ?? methodInfoForTool(request.params.name, photons, externalMCPs);
    const auth = target?.photon.auth;
    const protectsTarget =
      authMode === 'jwt' ||
      authMode === 'bearer' ||
      (typeof auth === 'string' && auth !== '' && auth !== 'optional');
    if (!protectsTarget) continue;
    isProtected = true;
    if (
      requestId === undefined &&
      (typeof request.id === 'string' || typeof request.id === 'number')
    ) {
      requestId = request.id;
    }
    for (const scope of method?.scopes ?? []) {
      if (typeof scope === 'string' && scope.trim()) scopes.add(scope.trim());
    }
    if (auth && auth !== 'required' && auth !== 'optional') issuers.add(auth);
  }

  return {
    protected: isProtected,
    requiredScopes: [...scopes].sort(),
    ...(issuers.size === 1 ? { expectedIssuer: [...issuers][0] } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(issuers.size > 1 ? { configurationError: true } : {}),
  };
}

function legacyStreamAuthorizationRequirements(photons: AnyPhotonInfo[]): {
  protected: boolean;
  expectedIssuer?: string;
  configurationError?: boolean;
} {
  const authMode =
    process.env.PHOTON_MCP_AUTH_MODE || (process.env.PHOTON_MCP_BEARER ? 'bearer' : 'legacy');
  const issuers = new Set<string>();
  let isProtected = authMode === 'jwt' || authMode === 'bearer';
  for (const photon of photons) {
    if (!photon.configured || !photon.auth || photon.auth === 'optional') continue;
    isProtected = true;
    if (photon.auth !== 'required') issuers.add(photon.auth);
  }
  return {
    protected: isProtected,
    ...(issuers.size === 1 ? { expectedIssuer: [...issuers][0] } : {}),
    ...(issuers.size > 1 ? { configurationError: true } : {}),
  };
}

function sendMCPAuthorizationFailure(
  res: ServerResponse,
  input: {
    status: 401 | 403;
    id?: string | number;
    reason: string;
    resourceMetadataUrl: string;
    scopes: string[];
  }
): void {
  const parameters = [
    `resource_metadata="${input.resourceMetadataUrl.replace(/["\\]/g, '')}"`,
    ...(input.status === 403 ? ['error="insufficient_scope"'] : ['error="invalid_token"']),
    ...(input.scopes.length ? [`scope="${input.scopes.join(' ')}"`] : []),
  ];
  res.writeHead(input.status, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': `Bearer ${parameters.join(', ')}`,
  });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: input.id ?? null,
      error: {
        code: input.status === 403 ? -32003 : -32001,
        message: input.status === 403 ? 'Forbidden' : 'Unauthorized',
        data: { reason: input.reason },
      },
    })
  );
}

function duplicateRawMCPHeader(rawHeaders: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    if (
      name === 'mcp-method' ||
      name === 'mcp-name' ||
      name === 'mcp-protocol-version' ||
      name.startsWith('mcp-param-')
    ) {
      const count = (counts.get(name) ?? 0) + 1;
      if (count > 1) return rawHeaders[index];
      counts.set(name, count);
    }
  }
  return undefined;
}

function advertisedMCPParamHeaders(
  photons: AnyPhotonInfo[],
  externalMCPs: ExternalMCPInfo[] | undefined
): string[] {
  const names = new Map<string, string>();
  const methods = [
    ...photons.flatMap((photon) => (photon.configured ? (photon.methods ?? []) : [])),
    ...(externalMCPs ?? []).flatMap((mcp) => mcp.methods ?? []),
  ];
  for (const method of methods) {
    const parsed = parseMCPHeaderBindings(method.params);
    if (!parsed.ok) continue;
    for (const binding of parsed.bindings) {
      names.set(binding.headerName.toLowerCase(), binding.headerName);
    }
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

// ════════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

const sessions = new Map<string, MCPSession>();
const MAX_SSE_SESSIONS_PER_CLIENT = Math.max(
  4,
  Number.parseInt(process.env.PHOTON_MAX_SSE_SESSIONS_PER_CLIENT || '12', 10) || 12
);

// Pending elicitations - waiting for user input
interface PendingElicitation {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  sessionId: string;
  timer?: ReturnType<typeof setTimeout>;
  deferTimer?: ReturnType<typeof setTimeout>;
  approvalId?: string;
  photonName?: string;
  methodName?: string;
  message?: string;
}
const pendingElicitations = new Map<string, PendingElicitation>();
const statelessInputStores = new Map<
  string,
  {
    tool: DurableStatelessInputStateStore;
    destructive: DurableStatelessInputStateStore;
  }
>();
const appSessionStores = new Map<string, AppSessionHandleStore>();
const idempotencyStores = new Map<string, IdempotencyStore>();

function inputStoresFor(context: HandlerContext): {
  tool: DurableStatelessInputStateStore;
  destructive: DurableStatelessInputStateStore;
} {
  const baseDir = resolve(
    context.workingDir || process.env.PHOTON_DIR || join(homedir(), '.photon')
  );
  const existing = statelessInputStores.get(baseDir);
  if (existing) return existing;
  const directory = join(baseDir, '.data', 'mcp-request-state');
  const stores = {
    tool: new DurableStatelessInputStateStore({
      directory,
      namespace: 'tool',
    }),
    destructive: new DurableStatelessInputStateStore({
      directory,
      namespace: 'destructive',
      maxEntries: 64,
      maxEntriesPerPrincipal: 4,
    }),
  };
  statelessInputStores.set(baseDir, stores);
  return stores;
}

function appSessionStoreFor(context: HandlerContext): AppSessionHandleStore {
  const baseDir = resolve(
    context.workingDir || process.env.PHOTON_DIR || join(homedir(), '.photon')
  );
  const existing = appSessionStores.get(baseDir);
  if (existing) return existing;
  const store = new AppSessionHandleStore({
    directory: join(baseDir, '.data', 'mcp-app-sessions'),
  });
  appSessionStores.set(baseDir, store);
  return store;
}

function idempotencyStoreFor(context: HandlerContext): IdempotencyStore {
  const baseDir = resolve(
    context.workingDir || process.env.PHOTON_DIR || join(homedir(), '.photon')
  );
  const existing = idempotencyStores.get(baseDir);
  if (existing) return existing;
  const store = new IdempotencyStore({
    directory: join(baseDir, '.data', 'mcp-idempotency'),
  });
  idempotencyStores.set(baseDir, store);
  return store;
}

const SECRET_PREVIEW_KEY_RE =
  /pass(word)?|secret|token|api[-_]?key|credential|cookie|authorization|bearer|private[-_]?key/i;
const MAX_PREVIEW_DEPTH = 4;
const MAX_PREVIEW_ARRAY_ITEMS = 12;
const MAX_PREVIEW_OBJECT_KEYS = 40;
const MAX_PREVIEW_STRING_LENGTH = 500;

function buildSafeToolArgumentPreview(value: unknown, depth = 0): unknown {
  if (depth >= MAX_PREVIEW_DEPTH) return '[truncated: depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length <= MAX_PREVIEW_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_PREVIEW_STRING_LENGTH)}... [truncated ${value.length - MAX_PREVIEW_STRING_LENGTH} chars]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_PREVIEW_ARRAY_ITEMS)
      .map((item) => buildSafeToolArgumentPreview(item, depth + 1));
    if (value.length > MAX_PREVIEW_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_PREVIEW_ARRAY_ITEMS} items]`);
    }
    return items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries.slice(0, MAX_PREVIEW_OBJECT_KEYS)) {
      out[key] = SECRET_PREVIEW_KEY_RE.test(key)
        ? '[redacted]'
        : buildSafeToolArgumentPreview(child, depth + 1);
    }
    if (entries.length > MAX_PREVIEW_OBJECT_KEYS) {
      out.__truncated__ = `${entries.length - MAX_PREVIEW_OBJECT_KEYS} keys`;
    }
    return out;
  }
  return `[${typeof value}]`;
}

// Server→client JSON-RPC request tracking. When the daemon initiates
// a request against a connected Beam session (currently just
// `sampling/createMessage` — but extensible to any future
// server-initiated primitive), we generate an id, push the request
// onto that session's SSE stream, and park a resolver here. The
// browser's reply comes back as a regular POST whose body has
// `{ result | error, id }` and no method; the POST loop routes it
// to this map.
interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /** Keyed on session id so session teardown can fail in-flight requests. */
  sessionId: string;
  timer?: ReturnType<typeof setTimeout>;
}
const pendingServerRequests = new Map<string | number, PendingServerRequest>();
let nextServerRequestId = 1;

/**
 * Registry of `resources/subscribe` state for the streamable-HTTP transport.
 * Sinks are keyed by sessionId so per-session disconnect can purge in O(1).
 *
 * `attachLoaderForResourceUpdates(loader)` (exported) bridges photon-author
 * `this.notifyResourceUpdated(uri)` calls into `streamableSubscriptions.notify(uri)`
 * so subscribers get `notifications/resources/updated` over the SSE stream.
 */
const streamableSubscriptions = new SubscriptionRegistry();
const sessionSubscriptionSinks = new Map<string, ResourceUpdateSink>();

/**
 * MCP 2026 subscriptions are request-scoped POST/SSE streams, rather than the
 * transport-level GET/SSE connection used by 2025 clients. Keep their state
 * separate so a stateless request can never inherit a legacy session.
 */
interface StatelessSubscriptionFilters {
  toolsListChanged?: true;
  promptsListChanged?: true;
  resourcesListChanged?: true;
  resourceSubscriptions?: string[];
}

interface StatelessSubscription {
  id: string | number;
  filters: StatelessSubscriptionFilters;
  response: ServerResponse;
  principal: string;
  resourceSink?: ResourceUpdateSink;
  keepalive?: ReturnType<typeof setInterval>;
  backpressureTimer?: ReturnType<typeof setTimeout>;
  blocked: boolean;
  queuedPayloads: string[];
  queuedBytes: number;
}

const statelessSubscriptions = new Set<StatelessSubscription>();
const MAX_STATELESS_SUBSCRIPTIONS = Math.max(
  1,
  Number.parseInt(process.env.PHOTON_MCP_MAX_SUBSCRIPTIONS || '1024', 10) || 1_024
);
const MAX_STATELESS_SUBSCRIPTIONS_PER_PRINCIPAL = Math.max(
  1,
  Number.parseInt(process.env.PHOTON_MCP_MAX_SUBSCRIPTIONS_PER_PRINCIPAL || '16', 10) || 16
);
const MAX_STATELESS_RESOURCE_FILTERS = 64;
const MAX_STATELESS_RESOURCE_URI_LENGTH = 2_048;
const MAX_STATELESS_BLOCKED_BYTES = 256 * 1_024;
const STATELESS_SUBSCRIPTION_KEEPALIVE_MS = 15_000;
const STATELESS_SUBSCRIPTION_BACKPRESSURE_TIMEOUT_MS = 5_000;

function sanitizeStatelessSubscriptionFilters(
  candidate: Record<string, unknown>
): { ok: true; filters: StatelessSubscriptionFilters } | { ok: false; reason: string } {
  const filters: StatelessSubscriptionFilters = {};
  for (const key of ['toolsListChanged', 'promptsListChanged', 'resourcesListChanged'] as const) {
    if (candidate[key] === true) filters[key] = true;
  }
  if (Array.isArray(candidate.resourceSubscriptions)) {
    if (candidate.resourceSubscriptions.length > MAX_STATELESS_RESOURCE_FILTERS) {
      return {
        ok: false,
        reason: `resourceSubscriptions exceeds ${MAX_STATELESS_RESOURCE_FILTERS} entries`,
      };
    }
    if (
      candidate.resourceSubscriptions.some(
        (value) =>
          typeof value !== 'string' ||
          value.length === 0 ||
          value.length > MAX_STATELESS_RESOURCE_URI_LENGTH
      )
    ) {
      return { ok: false, reason: 'resourceSubscriptions contains an invalid URI filter' };
    }
    const uris = [...new Set(candidate.resourceSubscriptions as string[])];
    if (uris.length > 0) filters.resourceSubscriptions = uris;
  }
  if (Object.keys(filters).length === 0) {
    return { ok: false, reason: 'At least one supported notification filter is required' };
  }
  return { ok: true, filters };
}

function sendStatelessSubscriptionNotification(
  subscription: StatelessSubscription,
  method: string,
  params?: Record<string, unknown>
): void {
  if (subscription.response.writableEnded || subscription.response.destroyed) return;
  const wireAdapter = selectMCPWireAdapter(
    MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28,
    buildServerInfo()
  );
  const notification = wireAdapter.notification(method, {
    ...(params || {}),
    _meta: {
      ...(isRecord(params?._meta) ? params._meta : {}),
      'io.modelcontextprotocol/subscriptionId': subscription.id,
    },
  });
  const payload = `data: ${JSON.stringify(notification)}\n\n`;
  if (subscription.blocked) {
    subscription.queuedPayloads.push(payload);
    subscription.queuedBytes += Buffer.byteLength(payload);
    if (subscription.queuedBytes > MAX_STATELESS_BLOCKED_BYTES) {
      closeStatelessSubscription(subscription);
    }
    return;
  }
  try {
    if (!subscription.response.write(payload)) {
      markStatelessSubscriptionBlocked(subscription);
    }
  } catch {
    closeStatelessSubscription(subscription);
  }
}

function markStatelessSubscriptionBlocked(subscription: StatelessSubscription): void {
  if (subscription.blocked) return;
  subscription.blocked = true;
  subscription.response.once('drain', () => {
    if (!statelessSubscriptions.has(subscription)) return;
    subscription.blocked = false;
    if (subscription.backpressureTimer) clearTimeout(subscription.backpressureTimer);
    subscription.backpressureTimer = undefined;
    while (subscription.queuedPayloads.length > 0) {
      const payload = subscription.queuedPayloads.shift()!;
      subscription.queuedBytes -= Buffer.byteLength(payload);
      try {
        if (!subscription.response.write(payload)) {
          markStatelessSubscriptionBlocked(subscription);
          return;
        }
      } catch {
        closeStatelessSubscription(subscription);
        return;
      }
    }
    subscription.queuedBytes = 0;
  });
  subscription.backpressureTimer = setTimeout(() => {
    if (subscription.blocked) closeStatelessSubscription(subscription);
  }, STATELESS_SUBSCRIPTION_BACKPRESSURE_TIMEOUT_MS);
  subscription.backpressureTimer.unref?.();
}

function closeStatelessSubscription(subscription: StatelessSubscription, graceful = false): void {
  statelessSubscriptions.delete(subscription);
  if (subscription.keepalive) clearInterval(subscription.keepalive);
  if (subscription.backpressureTimer) clearTimeout(subscription.backpressureTimer);
  subscription.queuedPayloads.length = 0;
  subscription.queuedBytes = 0;
  if (subscription.resourceSink) streamableSubscriptions.disconnect(subscription.resourceSink);
  if (graceful && !subscription.response.writableEnded && !subscription.response.destroyed) {
    if (subscription.blocked) {
      subscription.response.destroy();
      return;
    }
    const wireAdapter = selectMCPWireAdapter(
      MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28,
      buildServerInfo()
    );
    const response = wireAdapter.response({
      kind: 'success',
      id: subscription.id,
      result: {
        kind: 'complete',
        value: {
          _meta: {
            'io.modelcontextprotocol/subscriptionId': subscription.id,
          },
        },
      },
    });
    subscription.response.end(`data: ${JSON.stringify(response)}\n\n`);
  }
}

function closeAllStatelessSubscriptions(): void {
  for (const subscription of [...statelessSubscriptions]) {
    closeStatelessSubscription(subscription, true);
  }
}

function broadcastToStatelessSubscriptions(method: string, params?: Record<string, unknown>): void {
  const filterByMethod: Record<string, keyof StatelessSubscriptionFilters> = {
    'notifications/tools/list_changed': 'toolsListChanged',
    'notifications/prompts/list_changed': 'promptsListChanged',
    'notifications/resources/list_changed': 'resourcesListChanged',
  };
  const filter = filterByMethod[method];
  for (const subscription of statelessSubscriptions) {
    const acceptsResourceUpdate =
      method === 'notifications/resources/updated' &&
      typeof params?.uri === 'string' &&
      subscription.filters.resourceSubscriptions?.includes(params.uri);
    if ((filter && subscription.filters[filter] === true) || acceptsResourceUpdate) {
      sendStatelessSubscriptionNotification(subscription, method, params);
    }
  }
}

function getOrCreateSessionSink(sessionId: string): ResourceUpdateSink {
  const existing = sessionSubscriptionSinks.get(sessionId);
  if (existing) return existing;
  const sink: ResourceUpdateSink = (uri: string) => {
    sendToSession(sessionId, 'notifications/resources/updated', { uri });
  };
  sessionSubscriptionSinks.set(sessionId, sink);
  return sink;
}

function disconnectSessionSubscriptions(sessionId: string): void {
  const sink = sessionSubscriptionSinks.get(sessionId);
  if (!sink) return;
  streamableSubscriptions.disconnect(sink);
  sessionSubscriptionSinks.delete(sessionId);
}

/**
 * Wire a PhotonLoader's `notifyResourceUpdated` channel into the streamable-HTTP
 * subscription registry. Call once at server start.
 */
export function attachLoaderForResourceUpdates(loader: {
  setResourceUpdateNotifier: (fn: (uri: string) => void | Promise<void>) => void;
}): void {
  loader.setResourceUpdateNotifier((uri: string) => streamableSubscriptions.notify(uri));
}

/**
 * Send a JSON-RPC request to a Beam session over its SSE stream and
 * await the reply. Backs photon-facing providers (sampling, future
 * roots/list) that route through the human at the browser.
 *
 * 30-min timeout accommodates the sampling-modal's serial queue:
 * a queued request can sit behind an open modal for the user's full
 * read+reply time, so 5 min would let entries expire off-screen.
 */
function requestSession(
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30 * 60_000
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const session = sessions.get(sessionId);
    if (!session || !session.sseResponse || session.sseResponse.writableEnded) {
      reject(
        new Error(
          `requestSession: session ${sessionId} has no live SSE stream — the ` +
            `browser must be connected for server→client requests to work.`
        )
      );
      return;
    }

    const id = `srv-${nextServerRequestId++}`;
    const timer = setTimeout(() => {
      pendingServerRequests.delete(id);
      reject(new Error(`requestSession: ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingServerRequests.set(id, { resolve, reject, sessionId, timer });

    const payload = `data: ${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n\n`;
    try {
      session.sseResponse.write(payload);
    } catch (err) {
      clearTimeout(timer);
      pendingServerRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function requestResponseStream(
  sessionId: string,
  stream: { send: (message: object) => void },
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30 * 60_000
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const id = `srv-${nextServerRequestId++}`;
    const timer = setTimeout(() => {
      pendingServerRequests.delete(id);
      reject(new Error(`requestResponseStream: ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingServerRequests.set(id, { resolve, reject, sessionId, timer });
    try {
      stream.send({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      clearTimeout(timer);
      pendingServerRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function sessionSupportsFormElicitation(session: MCPSession): boolean {
  const elicitation = session.clientCapabilities?.elicitation;
  if (!elicitation || typeof elicitation !== 'object' || Array.isArray(elicitation)) {
    return false;
  }
  return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}

function buildMcpElicitParamsFromAsk(ask: any): Record<string, unknown> {
  const message = ask.message || 'Please provide input';
  if (ask.mode === 'url' || ask.ask === 'url') {
    if (typeof ask.url !== 'string' || !ask.url.trim()) {
      throw new Error('URL elicitation requires a non-empty URL');
    }
    return { mode: 'url', message, url: ask.url };
  }
  if ((ask.mode === 'form' || ask.requestedSchema) && isRecord(ask.requestedSchema)) {
    return {
      mode: 'form',
      message,
      requestedSchema: ask.requestedSchema,
    };
  }
  switch (ask.ask) {
    case 'confirm':
      return {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirmed: {
              type: 'boolean',
              title: ask.label || 'Confirm',
              description: ask.hint || ask.message,
              default: ask.default ?? false,
            },
          },
          required: ['confirmed'],
        },
      };
    case 'number':
      return {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'number',
              title: ask.label || 'Number',
              description: ask.hint || ask.message,
              default: ask.default,
              minimum: ask.min,
              maximum: ask.max,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };
    case 'select': {
      const options = ask.options || [];
      const optionItems = options.map((option: any) =>
        typeof option === 'string'
          ? { const: option, title: option }
          : {
              const: option.value,
              title: option.label || String(option.value),
              ...(option.description ? { description: option.description } : {}),
            }
      );
      return {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            selection: ask.multi
              ? {
                  type: 'array',
                  title: ask.label || 'Selection',
                  description: ask.hint || ask.message,
                  items: { anyOf: optionItems },
                  default: ask.default,
                }
              : {
                  type: 'string',
                  title: ask.label || 'Selection',
                  description: ask.hint || ask.message,
                  anyOf: optionItems,
                  default: ask.default,
                },
          },
          required: ask.required !== false ? ['selection'] : [],
        },
      };
    }
    case 'date':
      return {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              format: 'date',
              title: ask.label || 'Date',
              description: ask.hint || ask.message,
              default: ask.default,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };
    case 'text':
    case 'password':
    default:
      return {
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              title: ask.label || 'Input',
              description: ask.hint || ask.message,
              default: ask.default,
            },
          },
          required: ask.required !== false ? ['value'] : [],
        },
      };
  }
}

function extractMcpElicitValue(ask: any, result: any): any {
  if (result?.action !== 'accept') {
    return ask.multi ? [] : ask.ask === 'confirm' ? false : null;
  }
  if (ask.mode === 'url' || ask.ask === 'url') return true;
  const content = result.content || {};
  if ((ask.mode === 'form' || ask.requestedSchema) && !ask.ask) return content;
  if (ask.ask === 'confirm') return content.confirmed ?? false;
  if (ask.ask === 'select') return content.selection;
  return content.value;
}

function finiteInputParams(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    throw new Error('MCP input request params must be finite JSON');
  }
}

/**
 * Build a sampling provider for a specific Beam session — the
 * person at the browser plays the role of the LLM. The provider
 * returns a `CreateMessageResult` shape with `model: 'human@beam'`
 * so the photon can tell (via the returned model field) that the
 * response came from a person rather than a real model.
 */
function makeHumanSamplingProvider(sessionId: string): (params: any) => Promise<any> {
  return async (params: any) => {
    const result = (await requestSession(sessionId, 'sampling/createMessage', params)) as {
      role?: string;
      content?: unknown;
      model?: string;
      stopReason?: string;
    };
    // Defensive normalisation: some clients return just a string;
    // wrap it in the canonical CreateMessageResult shape so photon-core
    // can index into content[0].text without extra checks.
    if (typeof result === 'string') {
      return {
        role: 'assistant',
        content: { type: 'text', text: result },
        model: 'human@beam',
        stopReason: 'endTurn',
      };
    }
    return {
      role: result?.role ?? 'assistant',
      content: result?.content ?? { type: 'text', text: '' },
      model: result?.model ?? 'human@beam',
      stopReason: result?.stopReason ?? 'endTurn',
    };
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PERSISTENT APPROVALS — durable HITL that survives navigation/restart
// ════════════════════════════════════════════════════════════════════════════════

interface PersistentApproval {
  id: string;
  runId?: string;
  photon: string;
  method: string;
  message: string;
  preview?: unknown;
  destructive?: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}

const APPROVALS_DIR = join(homedir(), '.photon', 'state');

// Simple async mutex for file operations
function createMutex() {
  let locked: Promise<void> = Promise.resolve();
  return {
    async acquire<T>(fn: () => Promise<T>): Promise<T> {
      let release: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = locked;
      locked = next;
      await prev;
      try {
        return await fn();
      } finally {
        release!();
      }
    },
  };
}

const approvalsMutex = createMutex();

function approvalsPath(photonName: string): string {
  return join(APPROVALS_DIR, photonName, 'approvals.json');
}

async function loadApprovals(photonName: string): Promise<PersistentApproval[]> {
  try {
    const data = await readFile(approvalsPath(photonName), 'utf-8');
    return JSON.parse(data) as PersistentApproval[];
  } catch {
    return [];
  }
}

async function saveApprovals(photonName: string, approvals: PersistentApproval[]): Promise<void> {
  const dir = dirname(approvalsPath(photonName));
  const { mkdirSync } = await import('fs');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* exists */
  }
  await writeFile(approvalsPath(photonName), JSON.stringify(approvals, null, 2));
}

async function addApproval(approval: PersistentApproval): Promise<void> {
  return approvalsMutex.acquire(async () => {
    const approvals = await loadApprovals(approval.photon);
    approvals.push(approval);
    await saveApprovals(approval.photon, approvals);
  });
}

async function resolveApproval(
  photonName: string,
  approvalId: string,
  status: 'approved' | 'rejected'
): Promise<PersistentApproval | undefined> {
  return approvalsMutex.acquire(async () => {
    const approvals = await loadApprovals(photonName);
    const idx = approvals.findIndex((a) => a.id === approvalId);
    if (idx === -1) return undefined;
    approvals[idx].status = status;
    await saveApprovals(photonName, approvals);
    return approvals[idx];
  });
}

async function getAllPendingApprovals(photonNames: string[]): Promise<PersistentApproval[]> {
  const all: PersistentApproval[] = [];
  const now = new Date().toISOString();
  for (const name of photonNames) {
    // Hold the mutex across read-mutate-save so concurrent addApproval /
    // resolveApproval can't lose updates while we expire stale entries.
    await approvalsMutex.acquire(async () => {
      const approvals = await loadApprovals(name);
      let mutated = false;
      for (const a of approvals) {
        if (a.status === 'pending') {
          if (a.expiresAt && a.expiresAt < now) {
            a.status = 'expired';
            mutated = true;
          } else {
            all.push(a);
          }
        }
      }
      if (mutated) {
        await saveApprovals(name, approvals);
      }
    });
  }
  return all;
}

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 5 * 60 * 1000; // default 5 min
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 5 * 60 * 1000;
  }
}

// ── Elicitation lifecycle helpers ──

/** Duration before an unanswered elicitation moves to pending approvals */
const ELICITATION_DEFER_MS = 30_000; // 30 seconds
/** Maximum time an elicitation stays alive in pending queue */
const ELICITATION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
/** Clean up all timers associated with a pending elicitation */
function cleanupElicitation(pending: PendingElicitation): void {
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.deferTimer) clearTimeout(pending.deferTimer);
}

/**
 * Set up two-phase timeout for an elicitation:
 * Phase 1 (30s): Modal shown to user. If no response, move to pending queue.
 * Phase 2 (30min): The approval remains pending until the user responds or it
 * expires. The SSE transport heartbeat keeps the connection alive; we do not
 * fabricate progress notifications while waiting because MCP progress tokens
 * must be supplied by the originating request and progress values must grow.
 */
function setupElicitationTimeout(
  elicitationId: string,
  pending: PendingElicitation,
  resolve: (value: { action: 'accept' | 'decline' | 'cancel'; content?: any }) => void
): void {
  const photon = pending.photonName || 'unknown';
  const method = pending.methodName || 'unknown';
  const message = pending.message || 'Approval required';

  // Phase 1: After 30s without response, defer to pending queue
  pending.deferTimer = setTimeout(() => {
    // Only defer if still pending (user may have responded)
    if (!pendingElicitations.has(elicitationId)) return;

    const approvalId = elicitationId; // reuse ID for linking
    pending.approvalId = approvalId;
    const expiresAt = new Date(Date.now() + ELICITATION_EXPIRY_MS).toISOString();

    // Write to persistent approval storage (fire-and-forget, non-blocking)
    void addApproval({
      id: approvalId,
      photon,
      method,
      message,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    // Tell Beam frontend to close modal and show badge
    broadcastToBeam('beam/elicitation-deferred', {
      elicitationId,
      approvalId,
      photon,
      method,
      message,
      expiresAt,
    });

    // Phase 2: Final expiry after 30 minutes
    pending.timer = setTimeout(() => {
      if (pendingElicitations.has(elicitationId)) {
        cleanupElicitation(pending);
        pendingElicitations.delete(elicitationId);
        // Mark approval as expired on disk
        void resolveApproval(photon, approvalId, 'rejected');
        // Notify frontend
        broadcastToBeam('beam/approval-resolved', {
          approvalId,
          photon,
          status: 'expired',
        });
        resolve({ action: 'cancel' });
      }
    }, ELICITATION_EXPIRY_MS);
  }, ELICITATION_DEFER_MS);
}

// Clean up old sessions periodically (30 min timeout)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

let sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;

function startSessionCleanup(): void {
  if (sessionCleanupInterval) return;
  sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
        sessions.delete(id);
        disconnectSessionSubscriptions(id);
      }
    }
  }, 60 * 1000);
  sessionCleanupInterval.unref();
}

export function stopSessionCleanup(): void {
  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    sessionCleanupInterval = null;
  }
  closeAllStatelessSubscriptions();
  for (const stores of statelessInputStores.values()) {
    stores.tool.close();
    stores.destructive.close();
  }
  statelessInputStores.clear();
  appSessionStores.clear();
  idempotencyStores.clear();
}

// Start cleanup on module load
startSessionCleanup();

function getOrCreateSession(sessionId?: string, persist = true): MCPSession {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = new Date();
    return session;
  }

  const newSession: MCPSession = {
    id: randomUUID(),
    initialized: false,
    createdAt: new Date(),
    lastActivity: new Date(),
  };
  if (persist) sessions.set(newSession.id, newSession);
  return newSession;
}

function closeSessionSSE(session: MCPSession, reason: string): void {
  const response = session.sseResponse;
  session.sseResponse = undefined;
  session.sseOpenedAt = undefined;
  if (!response) return;
  try {
    if (!response.writableEnded && !response.destroyed) {
      response.end();
    }
  } catch {
    try {
      response.destroy(new Error(reason));
    } catch {
      /* best-effort */
    }
  }
}

function enforceSSESessionBudget(session: MCPSession): void {
  const key = `${session.remoteAddress || 'unknown'}\n${session.userAgent || ''}`;
  const open = Array.from(sessions.values())
    .filter((candidate) => {
      if (!candidate.sseResponse || candidate.sseResponse.writableEnded) return false;
      const candidateKey = `${candidate.remoteAddress || 'unknown'}\n${candidate.userAgent || ''}`;
      return candidateKey === key;
    })
    .sort((a, b) => (a.sseOpenedAt?.getTime() || 0) - (b.sseOpenedAt?.getTime() || 0));

  const overflow = open.length - MAX_SSE_SESSIONS_PER_CLIENT;
  if (overflow <= 0) return;
  for (const stale of open.slice(0, overflow)) {
    closeSessionSSE(stale, 'sse-session-budget-exceeded');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION SCHEMA GENERATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Convert ConfigParam to JSON Schema property
 */
function configParamToJsonSchema(param: ConfigParam): Record<string, any> {
  const schema: Record<string, any> = {
    description: `Environment variable: ${param.envVar}`,
    'x-env-var': param.envVar,
  };

  // Map TypeScript types to JSON Schema types
  switch (param.type.toLowerCase()) {
    case 'number':
      schema.type = 'number';
      break;
    case 'boolean':
      schema.type = 'boolean';
      break;
    case 'string':
    default:
      schema.type = 'string';
      // Check for common sensitive parameter names - use OpenAPI standard
      if (/password|secret|token|key|credential/i.test(param.name)) {
        schema.format = 'password';
        schema.writeOnly = true;
      }
      // Check for path-like parameter names
      else if (/path|file|dir|directory|folder/i.test(param.name)) {
        schema.format = 'path';
      }
      break;
  }

  // Add default value if present
  if (param.hasDefault && param.defaultValue !== undefined) {
    schema.default = param.defaultValue;
  }

  return schema;
}

/**
 * Generate configurationSchema for all photons with constructor params
 * Uses JSON Schema format for rich UI generation
 * Includes both unconfigured and configured photons (for reconfiguration)
 */
function generateConfigurationSchema(photons: AnyPhotonInfo[]): Record<string, any> {
  const schema: Record<string, any> = {};

  for (const photon of photons) {
    const params = photon.requiredParams;
    const unconfigured = photon as UnconfiguredPhotonInfo;
    const isLoadError = !photon.configured && unconfigured.errorReason === 'load-error';

    // Skip configured photons with no constructor params unless they're a load-error
    if (photon.configured || (!isLoadError && (!params || params.length === 0))) continue;

    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of params ?? []) {
      properties[param.name] = configParamToJsonSchema(param);

      // Mark as required if not optional and no default
      if (!param.isOptional && !param.hasDefault) {
        required.push(param.name);
      }
    }

    schema[photon.name] = {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      'x-error-reason': unconfigured.errorReason,
      'x-error-message': unconfigured.errorMessage,
      'x-internal': photon.internal,
      'x-configured': photon.configured || undefined,
    };
  }

  return schema;
}

// ════════════════════════════════════════════════════════════════════════════════
// REQUEST HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

type RequestHandler = (
  request: JSONRPCRequest,
  session: MCPSession,
  context: HandlerContext
) => Promise<JSONRPCResponse>;

interface CallerInfo {
  id: string;
  name?: string;
  anonymous: boolean;
  scope?: string;
  claims?: Record<string, unknown>;
}

interface HandlerContext {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonInstance>;
  externalMCPs?: ExternalMCPInfo[];
  externalMCPClients?: Map<string, any>;
  externalMCPSDKClients?: Map<string, any>; // SDK clients with full CallToolResult support
  reconnectExternalMCP?: (name: string) => Promise<{ success: boolean; error?: string }>;
  loadUIAsset: (
    photonName: string,
    uiId: string
  ) => Promise<{
    content: string;
    isPhotonTemplate: boolean;
    compiled?: import('../tsx-compiler.js').CompiledTsx;
  } | null>;
  /** Working directory override (base dir for state/config/cache) */
  workingDir?: string;
  /** Standalone-server mode: expose the sole photon's tool and prompt names directly. */
  singleServerNames?: boolean;
  /** Authenticated caller from MCP OAuth (JWT) */
  caller?: CallerInfo;
  /** Normalized per-request identity/capability/app-session context. */
  requestContext?: PhotonRequestContext;
  /** Convenience alias for requestContext.client. */
  clientProfile?: ClientProfile;
  /** Revision-specific response and capability mapping selected at the boundary. */
  wireAdapter: MCPWireAdapter;
  configurePhoton?: (
    photonName: string,
    config: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  reloadPhoton?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  schedulePhotonReload?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  removePhoton?: (photonName: string) => Promise<{ success: boolean; error?: string }>;
  updateMetadata?: (
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  generatePhotonHelp?: (photonName: string) => Promise<string>;
  loader?: {
    executeTool: (mcp: any, toolName: string, args: any, options?: any) => Promise<any>;
    isToolAccessible?: (mcp: any, toolName: string, caller?: any, request?: unknown) => boolean;
    getCapabilityContracts?: (mcp: any) => Array<{ name: string; exposure: ReadonlySet<string> }>;
  };
  broadcast?: (message: object) => void;
  responseStream?: { send: (message: object) => void };
  signal?: AbortSignal;
  subscriptionManager?: {
    onClientViewingBoard: (
      sessionId: string,
      photon: string,
      board: string,
      lastTimestamp?: number
    ) => void;
    onClientDisconnect: (sessionId: string) => void;
  };
}

/**
 * Format a tool result for MCP content text.
 * Mirrors server.ts formatResult(): strings returned as-is, objects/arrays JSON-stringified,
 * other primitives converted via String().
 */
/**
 * Extract tool arguments from AG-UI messages.
 * Uses the last user message content, attempting JSON parse first.
 */
function extractArgsFromMessages(
  messages?: Array<{ role: string; content: string }>
): Record<string, unknown> | undefined {
  if (!messages || messages.length === 0) return undefined;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return undefined;
  try {
    const parsed = JSON.parse(lastUser.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — wrap as message arg
  }
  return { message: lastUser.content };
}

function formatResultText(result: any): string {
  if (result === undefined || result === null) return 'Done';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') return JSON.stringify(result, null, 2);
  return String(result);
}

function imageContentFromBinaryResult(
  result: unknown
): { type: 'image'; data: string; mimeType: string } | null {
  if (typeof result === 'string') {
    if (/^data:image\/[^;]+;base64,/i.test(result)) {
      const [, mimeType, data] = result.match(/^data:(image\/[^;]+);base64,(.*)$/is) || [];
      return mimeType && data ? { type: 'image', data, mimeType } : null;
    }
    if (result.trimStart().startsWith('{')) {
      try {
        return imageContentFromBinaryResult(JSON.parse(result));
      } catch {
        return null;
      }
    }
  }
  let bytes: Uint8Array | null = null;
  if (result instanceof Uint8Array) bytes = result;
  else if (result && typeof result === 'object') {
    const entries = Object.entries(result as Record<string, unknown>);
    if (
      entries.length > 2 &&
      entries.every(([key, value]) => /^\d+$/.test(key) && Number.isInteger(value))
    ) {
      const ordered = entries.sort(([a], [b]) => Number(a) - Number(b));
      bytes = Uint8Array.from(ordered.map(([, value]) => Number(value)));
    }
  }
  if (!bytes || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  return { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/bmp' };
}

/**
 * Build a text content block, optionally with MCP content annotations (audience, priority)
 */
function buildTextContent(
  text: string,
  methodInfo?: MethodInfo
): { type: 'text'; text: string; annotations?: Record<string, unknown> } {
  const block: { type: 'text'; text: string; annotations?: Record<string, unknown> } = {
    type: 'text',
    text,
  };
  if (methodInfo?.audience || methodInfo?.contentPriority !== undefined) {
    const annotations: Record<string, unknown> = {};
    if (methodInfo.audience) annotations.audience = methodInfo.audience;
    if (methodInfo.contentPriority !== undefined) annotations.priority = methodInfo.contentPriority;
    block.annotations = annotations;
  }
  return block;
}

function isAuthoredMCPContentBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string';
    case 'image':
      return (
        typeof value.data === 'string' &&
        typeof value.mimeType === 'string' &&
        value.mimeType.startsWith('image/')
      );
    case 'audio':
      return (
        typeof value.data === 'string' &&
        typeof value.mimeType === 'string' &&
        value.mimeType.startsWith('audio/')
      );
    case 'resource':
      return (
        isRecord(value.resource) &&
        typeof value.resource.uri === 'string' &&
        (typeof value.resource.text === 'string' || typeof value.resource.blob === 'string')
      );
    case 'resource_link':
      return typeof value.uri === 'string' && typeof value.name === 'string';
    default:
      return false;
  }
}

/**
 * Build a tool call result, optionally with structuredContent when outputSchema is declared
 */
function buildOutputSchemaToolError(
  failure: JSONSchemaValidationFailure,
  toolName = 'tool',
  requestContext?: PhotonRequestContext
): PhotonToolErrorResult {
  const issues = (failure.issues ?? []).map((issue) => ({
    instancePath: issue.instancePath,
    keyword: issue.keyword,
    message: sanitizePublicErrorMessage(issue.message),
  }));
  const detail =
    issues.length > 0
      ? `: ${issues
          .map(
            (issue) =>
              `${issue.instancePath || '/'} ${issue.message || `violates ${issue.keyword}`}`
          )
          .join('; ')
          .slice(0, 768)}`
      : '';
  const result = buildMCPToolError(toolName, failure.message, {
    requestId: requestContext?.requestId,
    traceparent: requestContext?.traceparent,
    code: PHOTON_TOOL_ERROR_CODES.OUTPUT_INVALID,
    category: 'tool_output',
    errorType: 'output_validation',
    retryable: false,
    publicMessage: `Tool output validation failed${detail}`,
    details: {
      validationKind: failure.kind,
      issueCount: issues.length,
    },
  });
  result._meta['photon/outputValidation'] = {
    kind: failure.kind,
    message: sanitizePublicErrorMessage(failure.message),
    ...(issues.length > 0 ? { issues } : {}),
  };
  return result;
}

function buildToolErrorResponse(
  request: JSONRPCRequest,
  context: HandlerContext,
  toolName: string,
  error: unknown,
  options: PhotonToolErrorContext = {}
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: buildMCPToolError(toolName, error, {
      requestId: context.requestContext?.requestId ?? request.id,
      traceparent: context.requestContext?.traceparent,
      ...options,
    }),
  };
}

/**
 * The 2026 tool specification classifies an unknown tool as a protocol-level
 * Invalid Params error. Photon keeps the historical 2025 Beam result shape so
 * older clients can continue presenting it as an actionable tool failure.
 */
function buildUnknownToolResponse(
  request: JSONRPCRequest,
  context: HandlerContext,
  name: string
): JSONRPCResponse {
  if (context.wireAdapter.era === 'modern-2026') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        message: `Unknown tool: ${sanitizePublicErrorMessage(name).slice(0, 256)}`,
      },
    };
  }
  return buildToolErrorResponse(request, context, name, `Invalid tool name: ${name}`, {
    code: PHOTON_TOOL_ERROR_CODES.INPUT_INVALID,
    category: 'tool_input',
    errorType: 'validation_error',
    retryable: false,
  });
}

function buildInvalidRequestStateResponse(
  request: JSONRPCRequest,
  error?: StatelessInputStateError
): JSONRPCResponse {
  if (error?.kind === 'unavailable') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: 'Request-state storage is unavailable',
        data: { retryable: true },
      },
    };
  }
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      message:
        error?.kind === 'capacity' || error?.kind === 'limit'
          ? 'Unable to continue the multi-round tool call'
          : 'Invalid or expired request state',
    },
  };
}

function normalizeToolCallErrorResponse(
  response: JSONRPCResponse,
  request: JSONRPCRequest,
  context: HandlerContext,
  toolName: string
): JSONRPCResponse {
  if (!isRecord(response.result) || response.result.isError !== true) return response;
  const existingMeta = isRecord(response.result._meta) ? response.result._meta : {};
  if (isRecord(existingMeta['io.portel.photon/error'])) return response;
  const firstContent = Array.isArray(response.result.content)
    ? response.result.content[0]
    : undefined;
  const message =
    isRecord(firstContent) && typeof firstContent.text === 'string'
      ? firstContent.text
      : 'Tool execution failed';
  const normalized = buildMCPToolError(toolName, message, {
    requestId: context.requestContext?.requestId ?? request.id,
    traceparent: context.requestContext?.traceparent,
  });
  return {
    ...response,
    result: {
      ...response.result,
      ...normalized,
      _meta: { ...existingMeta, ...normalized._meta },
    },
  };
}

async function buildToolResult(
  result: any,
  methodInfo: MethodInfo | undefined,
  wireAdapter: MCPWireAdapter,
  requestContext?: PhotonRequestContext
): Promise<{
  content: any[];
  isError: boolean;
  structuredContent?: FiniteJSONValue | PhotonToolErrorResult['structuredContent'];
  [key: string]: unknown;
}> {
  if (
    methodInfo?.outputSchema === undefined &&
    isRecord(result) &&
    result._mcpResult === true &&
    Array.isArray(result.content)
  ) {
    const contentValidation = await validateStructuredOutput(true, result.content);
    if (
      !contentValidation.ok ||
      result.content.length === 0 ||
      result.content.length > 128 ||
      !result.content.every(isAuthoredMCPContentBlock)
    ) {
      return buildOutputSchemaToolError(
        contentValidation.ok
          ? {
              ok: false,
              kind: 'invalid-output',
              message: 'Authored MCP content contains an invalid content block',
            }
          : contentValidation,
        methodInfo?.name,
        requestContext
      );
    }
    let structuredContent: FiniteJSONValue | undefined;
    if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) {
      const validation = await validateStructuredOutput(true, result.structuredContent);
      if (!validation.ok) {
        return buildOutputSchemaToolError(validation, methodInfo?.name, requestContext);
      }
      if (wireAdapter.includesStructuredContent(validation.value)) {
        structuredContent = validation.value;
      }
    }
    return {
      content: result.content,
      isError: result.isError === true,
      ...(structuredContent !== undefined || result.structuredContent === null
        ? { structuredContent }
        : {}),
      ...(isRecord(result._meta) ? { _meta: result._meta } : {}),
    };
  }

  let structuredValue: FiniteJSONValue | undefined;
  if (methodInfo?.outputSchema !== undefined) {
    const validation = await validateStructuredOutput(methodInfo.outputSchema, result);
    if (!validation.ok) {
      return buildOutputSchemaToolError(validation, methodInfo.name, requestContext);
    }
    structuredValue = validation.value;
  }

  // _meta format transformation: pre-formatted text bypasses normal formatting
  if (result && typeof result === 'object' && result._metaFormatted === true) {
    const content: any = { type: 'text', text: result.text };
    if (result.mimeType) {
      content.annotations = { mimeType: result.mimeType };
    }
    return { content: [content], isError: false };
  }

  const image = imageContentFromBinaryResult(result);
  if (image) {
    return {
      content: [image],
      isError: false,
      ...(methodInfo?.outputSchema !== undefined &&
      wireAdapter.includesStructuredContent(structuredValue)
        ? { structuredContent: structuredValue }
        : {}),
    };
  }
  if (
    methodInfo?.outputFormat === 'image' &&
    typeof result === 'string' &&
    result.length > 32 &&
    /^[A-Za-z0-9+/=\s]+$/.test(result)
  ) {
    const imageResult: {
      content: any[];
      isError: false;
      structuredContent?: FiniteJSONValue;
    } = {
      content: [
        {
          type: 'image',
          data: result.replace(/\s/g, ''),
          mimeType: methodInfo.mimeType || 'image/bmp',
        },
      ],
      isError: false,
    };
    if (
      methodInfo?.outputSchema !== undefined &&
      wireAdapter.includesStructuredContent(structuredValue)
    ) {
      imageResult.structuredContent = structuredValue;
    }
    return imageResult;
  }

  const text = formatResultText(methodInfo?.outputSchema !== undefined ? structuredValue : result);
  const toolResult: {
    content: any[];
    isError: false;
    structuredContent?: FiniteJSONValue;
    [key: string]: unknown;
  } = {
    content: [buildTextContent(text, methodInfo)],
    isError: false,
  };
  if (
    methodInfo?.outputSchema !== undefined &&
    wireAdapter.includesStructuredContent(structuredValue)
  ) {
    toolResult.structuredContent = structuredValue;
  }
  return toolResult;
}

function mergeToolResultMetadata(
  result: Record<string, unknown>,
  uiMetadata: Record<string, unknown>
): Record<string, unknown> {
  const resultMeta = isRecord(result._meta) ? result._meta : {};
  const uiMeta = isRecord(uiMetadata._meta) ? uiMetadata._meta : {};
  return {
    ...result,
    ...uiMetadata,
    ...(Object.keys(resultMeta).length > 0 || Object.keys(uiMeta).length > 0
      ? { _meta: { ...uiMeta, ...resultMeta } }
      : {}),
  };
}

function sanitizeModernMetadata(
  value: unknown,
  profile: ClientProfile
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized = { ...value };
  if (!profile.capabilities.mcpApps) {
    delete sanitized.ui;
    delete sanitized['ui/resourceUri'];
  }
  // OpenAI widget aliases are a 2025 host-compatibility profile, not MCP Apps.
  for (const key of Object.keys(sanitized)) {
    if (key.startsWith('openai/')) delete sanitized[key];
    if (!profile.capabilities.photon && isPhotonPrivateMetadataKey(key)) {
      delete sanitized[key];
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Last-mile extension firewall for the stateless wire. Producers may retain
 * rich Photon/legacy metadata internally, but a 2026 response is decorated
 * only with fields negotiated on this exact request.
 */
function sanitizeModernExtensionResponse(
  response: JSONRPCResponse,
  profile: ClientProfile
): JSONRPCResponse {
  if (profile.mode !== 'stateless') return response;
  const sanitized = { ...response };

  if (isRecord(sanitized.error) && isRecord(sanitized.error.data)) {
    const data = sanitizeModernMetadata(sanitized.error.data, profile);
    sanitized.error = {
      ...sanitized.error,
      ...(data ? { data } : {}),
    };
    if (!data) delete sanitized.error.data;
  }

  if (!isRecord(sanitized.result)) return sanitized;
  const result = { ...sanitized.result };
  const resultMeta = sanitizeModernMetadata(result._meta, profile);
  if (resultMeta) result._meta = resultMeta;
  else delete result._meta;

  const sanitizeItem = (item: unknown, stripVendorFields = false): unknown => {
    if (!isRecord(item)) return item;
    const copy = { ...item };
    const meta = sanitizeModernMetadata(copy._meta, profile);
    if (meta) copy._meta = meta;
    else delete copy._meta;
    if (stripVendorFields && !profile.capabilities.photon) {
      for (const key of Object.keys(copy)) {
        if (key.startsWith('x-')) delete copy[key];
      }
    }
    return copy;
  };

  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map((tool) => sanitizeItem(tool, true));
  }
  if (Array.isArray(result.contents)) {
    result.contents = result.contents.map((content) => sanitizeItem(content));
  }
  if (Array.isArray(result.content)) {
    result.content = result.content.map((content) => sanitizeItem(content));
  }
  if (!profile.capabilities.photon) {
    for (const key of Object.keys(result)) {
      if (key.startsWith('x-')) delete result[key];
    }
  }

  sanitized.result = result;
  return sanitized;
}

/**
 * Is the given task visible to this session under its claim scope?
 * Out-of-scope tasks AND tasks whose photon has been removed are
 * both hidden, so a stale task can't leak info to a scoped caller.
 */
function isTaskInScope(
  task: Task,
  scopeDir: string | undefined,
  photons: AnyPhotonInfo[]
): boolean {
  if (!scopeDir) return true;
  const info = photons.find((p) => p.name === task.photon);
  if (!info) return false;
  return isPathInScope(info.path, scopeDir);
}

const MCP_LIST_CACHE_TTL_MS = 30_000;
const LEGACY_ONLY_MCP_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'resources/subscribe',
  'resources/unsubscribe',
  'tasks/create',
  'tasks/list',
  'tasks/result',
]);

function buildServerInfo() {
  return {
    name: 'beam-mcp',
    version: PHOTON_VERSION,
  };
}

function buildServerCapabilities(wireAdapter: MCPWireAdapter): Record<string, unknown> {
  return wireAdapter.capabilities({
    photonVersion: PHOTON_VERSION,
    aguiEventTypes: Object.values(AGUIEventType),
  });
}

function buildConfigurationSchemaResult(photons: AnyPhotonInfo[]) {
  const configurationSchema = generateConfigurationSchema(photons);
  return Object.keys(configurationSchema).length > 0 ? configurationSchema : undefined;
}

function clientProfilePersonalizesResult(profile: ClientProfile | undefined): boolean {
  if (!profile) return false;
  return (
    profile.capabilities.mcpApps ||
    profile.capabilities.photon ||
    profile.quirks.unnamespacedToolNames ||
    profile.quirks.prefersOpenAIAppMetadata
  );
}

function buildClientProfileMetadata(
  requestContext: PhotonRequestContext,
  includeSelfReportedIdentity = true
) {
  if (!includeSelfReportedIdentity) {
    // Public cache entries must be byte-identical across clients. Keep only a
    // normalized, revision-derived diagnostic profile and exclude all
    // self-reported identity/capability values.
    return {
      protocolVersion: requestContext.client.protocolVersion,
      mode: requestContext.client.mode,
      capabilities: {
        tools: true,
        prompts: true,
        resources: true,
        sampling: false,
        mcpApps: false,
        photon: false,
        tasks: requestContext.client.mode === 'stateless' ? 'none' : 'legacy-core',
        cacheMetadata: requestContext.client.mode === 'stateless',
      },
      quirks: {
        unnamespacedToolNames: false,
        prefersOpenAIAppMetadata: false,
        requiresLegacyInitializeConfigSchema: requestContext.client.mode === 'legacy-sessionful',
      },
    };
  }
  return {
    protocolVersion: requestContext.client.protocolVersion,
    clientName: requestContext.client.clientName,
    clientVersion: requestContext.client.clientVersion,
    mode: requestContext.client.mode,
    capabilities: requestContext.client.capabilities,
    quirks: requestContext.client.quirks,
  };
}

function buildDiscoveryResult(ctx: HandlerContext, requestContext?: PhotonRequestContext) {
  const protocolVersion = requestContext?.protocolVersion ?? '2025-11-25';
  const personalized = clientProfilePersonalizesResult(requestContext?.client);
  const includePrivateRequestMetadata =
    ctx.wireAdapter.era === 'legacy-2025' || requestContext?.client.capabilities.photon === true;
  const appSessionMetaKey =
    ctx.wireAdapter.era === 'modern-2026'
      ? `${PHOTON_EXTENSION_ID}/appSessionId`
      : 'photon/appSessionId';
  const includeAppSession =
    ctx.wireAdapter.era === 'legacy-2025' ||
    requestContext?.appSessionSource === 'explicit-meta' ||
    requestContext?.appSessionSource === 'issued';
  const requestMetadata = {
    ...(includePrivateRequestMetadata && includeAppSession && requestContext?.appSessionId
      ? { [appSessionMetaKey]: requestContext.appSessionId }
      : {}),
    ...(includePrivateRequestMetadata && requestContext
      ? {
          'photon/clientProfile': buildClientProfileMetadata(
            requestContext,
            includePrivateRequestMetadata
          ),
        }
      : {}),
  };
  const visiblePhotons = requestContext?.scopeDir
    ? ctx.photons.filter((photon) => isPathInScope(photon.path, requestContext.scopeDir))
    : ctx.photons;

  return ctx.wireAdapter.discovery({
    protocolVersion,
    supportedVersions: SUPPORTED_MCP_PROTOCOL_VERSIONS,
    serverInfo: buildServerInfo(),
    capabilities: buildServerCapabilities(ctx.wireAdapter),
    configurationSchema: buildConfigurationSchemaResult(visiblePhotons),
    requestMetadata,
    ttlMs: MCP_LIST_CACHE_TTL_MS,
    cacheScope: cacheScopeForRequest(ctx, undefined, { personalized }),
    taskMode: requestContext?.client.capabilities.tasks,
    photonVersion: PHOTON_VERSION,
  });
}

function adaptResponseForProtocol(
  response: JSONRPCResponse,
  wireAdapter: MCPWireAdapter
): { response: JSONRPCResponse; httpStatus: number } {
  const canonicalResponse = canonicalizeMCPResponse(response);
  return {
    response: wireAdapter.response(canonicalResponse) as JSONRPCResponse,
    httpStatus: wireAdapter.httpStatus(canonicalResponse),
  };
}

function cacheScopeForRequest(
  ctx: HandlerContext,
  session?: MCPSession,
  options: { personalized?: boolean; forcePrivate?: boolean } = {}
): 'public' | 'private' {
  const requestContext = ctx.requestContext;
  if (options.forcePrivate || options.personalized) return 'private';
  if (clientProfilePersonalizesResult(requestContext?.client)) return 'private';
  if (requestContext?.scopeDir || session?.claimScopeDir) return 'private';
  if (ctx.caller && !ctx.caller.anonymous) return 'private';
  if (requestContext?.appSessionSource && requestContext.appSessionSource !== 'anonymous-default') {
    return 'private';
  }
  return 'public';
}

function withCacheMetadata<T extends Record<string, unknown>>(
  result: T,
  ctx: HandlerContext,
  options: {
    session?: MCPSession;
    ttlMs?: number;
    personalized?: boolean;
    forcePrivate?: boolean;
  } = {}
): T & {
  ttlMs: number;
  cacheScope: 'public' | 'private';
  _meta?: Record<string, unknown>;
} {
  const requestContext = ctx.requestContext;
  const existingMeta = isRecord(result._meta) ? result._meta : {};
  const cacheScope = cacheScopeForRequest(ctx, options.session, options);
  const includePrivateRequestMetadata =
    ctx.wireAdapter.era === 'legacy-2025' || requestContext?.client.capabilities.photon === true;
  const appSessionMetaKey =
    ctx.wireAdapter.era === 'modern-2026'
      ? `${PHOTON_EXTENSION_ID}/appSessionId`
      : 'photon/appSessionId';
  const includeAppSession =
    ctx.wireAdapter.era === 'legacy-2025' ||
    requestContext?.appSessionSource === 'explicit-meta' ||
    requestContext?.appSessionSource === 'issued';
  const meta =
    requestContext?.appSessionId || requestContext?.client
      ? {
          ...existingMeta,
          ...(includePrivateRequestMetadata && includeAppSession && requestContext?.appSessionId
            ? { [appSessionMetaKey]: requestContext.appSessionId }
            : {}),
          ...(includePrivateRequestMetadata && requestContext
            ? {
                'photon/clientProfile': buildClientProfileMetadata(
                  requestContext,
                  includePrivateRequestMetadata
                ),
              }
            : {}),
        }
      : existingMeta;

  return {
    ...result,
    ttlMs: options.ttlMs ?? MCP_LIST_CACHE_TTL_MS,
    cacheScope,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

function withModernCacheMetadata<T extends Record<string, unknown>>(
  result: T,
  ctx: HandlerContext,
  options: {
    session?: MCPSession;
    ttlMs?: number;
    personalized?: boolean;
    forcePrivate?: boolean;
  } = {}
): T | ReturnType<typeof withCacheMetadata<T>> {
  return ctx.wireAdapter.era === 'modern-2026' ? withCacheMetadata(result, ctx, options) : result;
}

const handlers: Record<string, RequestHandler> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────
  initialize: async (req, session, ctx) => {
    session.initialized = true;

    // Capture client info and detect Beam clients
    const clientInfo = req.params?.clientInfo as { name: string; version: string } | undefined;
    if (clientInfo) {
      session.clientInfo = clientInfo;
      session.isBeam = clientInfo.name === 'beam';
    }
    session.clientCapabilities =
      (req.params?.capabilities as Record<string, unknown> | undefined) || {};
    session.clientProfile = resolveClientProfile(req, session, {});

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: buildServerInfo(),
        capabilities: buildServerCapabilities(ctx.wireAdapter),
        // SEP-1596 inspired: configuration schema for unconfigured photons
        // Uses JSON Schema for rich UI generation
        configurationSchema: buildConfigurationSchemaResult(ctx.photons),
      },
    };
  },

  'server/discover': async (req, _session, ctx) => {
    if (
      ctx.wireAdapter.era === 'modern-2026' &&
      ctx.requestContext?.client.capabilities.photon === true &&
      (ctx.requestContext.appSessionSource === 'anonymous-default' ||
        ctx.requestContext.appSessionSource === 'caller-default')
    ) {
      ctx.requestContext.appSessionId = appSessionStoreFor(ctx).issue(buildAppSessionBinding(ctx));
      ctx.requestContext.appSessionSource = 'issued';
    }
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: buildDiscoveryResult(ctx, ctx.requestContext),
    };
  },

  [`${PHOTON_EXTENSION_ID}/app-sessions/revoke`]: async (req, _session, ctx) => {
    const handle =
      isRecord(req.params) && typeof req.params.handle === 'string'
        ? req.params.handle
        : ctx.requestContext?.appSessionId;
    if (
      ctx.wireAdapter.era !== 'modern-2026' ||
      ctx.requestContext?.client.capabilities.photon !== true ||
      typeof handle !== 'string' ||
      ctx.requestContext.appSessionSource !== 'explicit-meta'
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: 'A negotiated Photon application-session handle is required',
        },
      };
    }
    const revoked = appSessionStoreFor(ctx).revoke(handle, buildAppSessionBinding(ctx));
    return revoked
      ? {
          jsonrpc: '2.0',
          id: req.id,
          result: { revoked: true, handle },
        }
      : {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            message: 'Invalid or expired application-session handle',
          },
        };
  },

  'notifications/initialized': async (req, session) => {
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  'logging/setLevel': async (req) => ({
    jsonrpc: '2.0',
    id: req.id,
    result: {},
  }),

  'completion/complete': async (req, _session, ctx) => ({
    jsonrpc: '2.0',
    id: req.id,
    result: withModernCacheMetadata(
      {
        completion: {
          values: [],
          total: 0,
          hasMore: false,
        },
      },
      ctx,
      { ttlMs: 0, forcePrivate: true }
    ),
  }),

  // ─────────────────────────────────────────────────────────────────────────────
  // AG-UI Protocol
  // ─────────────────────────────────────────────────────────────────────────────

  'ag-ui/run': async (req, session, ctx) => {
    const params = req.params as {
      agentUrl?: string;
      photon?: string;
      method?: string;
      input: RunAgentInput;
    };

    if (!params?.input) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required field: input (RunAgentInput)' },
      } as JSONRPCResponse;
    }

    if (!ctx.broadcast) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32600, message: 'No SSE connection for AG-UI event streaming' },
      } as JSONRPCResponse;
    }

    const broadcast = ctx.broadcast;

    // ── Proxy mode: forward to external AG-UI agent ──
    if (params.agentUrl) {
      try {
        await proxyExternalAgent(params.agentUrl, params.input, broadcast);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({
          jsonrpc: '2.0',
          method: 'ag-ui/event',
          params: {
            type: AGUIEventType.RUN_ERROR,
            message: `Proxy error: ${message}`,
            timestamp: Date.now(),
          },
        });
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { success: true },
      };
    }

    // ── Local mode: execute photon method with AG-UI events ──
    if (!params.photon || !params.method) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32602,
          message: 'Either agentUrl (proxy) or photon+method (local) must be provided',
        },
      } as JSONRPCResponse;
    }

    const photonName = params.photon;
    const methodName = params.method;
    const runId = params.input.runId;

    // Find the photon MCP instance
    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp) {
      broadcast({
        jsonrpc: '2.0',
        method: 'ag-ui/event',
        params: {
          type: AGUIEventType.RUN_ERROR,
          message: `Photon not found: ${photonName}`,
          timestamp: Date.now(),
        },
      });
      return { jsonrpc: '2.0', id: req.id, result: { success: false } };
    }

    // Look up the method's declared @format so the adapter can emit A2UI
    // messages as CUSTOM events when format === 'a2ui'. ctx.photons is the
    // same registry used to resolve UI metadata elsewhere in this transport.
    const aguiPhotonInfo = ctx.photons?.find((p) => p.name === photonName);
    const aguiMethodInfo = aguiPhotonInfo?.configured
      ? aguiPhotonInfo.methods?.find((m) => m.name === methodName)
      : undefined;
    const agui = createAGUIOutputHandler(photonName, methodName, runId, broadcast, {
      outputFormat: aguiMethodInfo?.outputFormat,
    });

    try {
      // Build args from input messages (last user message content) or forwarded props
      const args =
        (params.input.forwardedProps as Record<string, unknown>) ||
        extractArgsFromMessages(params.input.messages) ||
        {};

      let result: any;
      if (ctx.loader) {
        result = await ctx.loader.executeTool(mcp, methodName, args, {
          outputHandler: agui.outputHandler,
          caller: ctx.caller,
          requestContext: ctx.requestContext,
          signal: ctx.signal,
        });
      } else {
        const method = mcp.instance[methodName];
        if (typeof method !== 'function') {
          agui.error(`Method not found: ${photonName}/${methodName}`);
          return { jsonrpc: '2.0', id: req.id, result: { success: false } };
        }
        result = await method.call(mcp.instance, args);
      }

      // Handle async generators
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const iterator = result[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) {
            agui.finish(value);
            break;
          }
          agui.outputHandler(value);
        }
      } else {
        agui.finish(result);
      }
    } catch (err) {
      const message = sanitizePublicErrorMessage(err);
      // Classify the error so AG-UI clients can auto-retry transient failures.
      const { errorType, retryable } = formatToolError(methodName, err);
      agui.error(message, { code: errorType, retryable });
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true } };
  },

  // Handle elicitation response from frontend
  'beam/elicitation-response': async (req, session) => {
    const params = req.params as
      | { elicitationId?: string; value?: any; cancelled?: boolean }
      | undefined;
    const elicitationId = params?.elicitationId;

    if (!elicitationId) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing elicitationId' },
      } as JSONRPCResponse;
    }

    const pending = pendingElicitations.get(elicitationId);
    if (!pending) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Unknown elicitationId' },
      } as JSONRPCResponse;
    }

    pendingElicitations.delete(elicitationId);
    cleanupElicitation(pending);

    // If this elicitation was deferred to approvals, resolve the approval on disk too
    if (pending.approvalId) {
      const status: 'approved' | 'rejected' = params?.cancelled ? 'rejected' : 'approved';
      await resolveApproval(pending.photonName || 'unknown', pending.approvalId, status);
      broadcastToBeam('beam/approval-resolved', {
        approvalId: pending.approvalId,
        photon: pending.photonName || 'unknown',
        status,
      });
    }

    if (params?.cancelled) {
      pending.reject(new Error('Elicitation cancelled by user'));
    } else {
      pending.resolve(params?.value);
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true } } as JSONRPCResponse;
  },

  // Handle persistent approval response from approvals panel
  'beam/approval-response': async (req, session, ctx) => {
    const params = req.params as
      | { approvalId?: string; photon?: string; approved?: boolean }
      | undefined;

    if (!params?.approvalId || !params?.photon) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing approvalId or photon' },
      } as JSONRPCResponse;
    }

    const status = params.approved ? 'approved' : 'rejected';
    const approval = await resolveApproval(params.photon, params.approvalId, status);

    if (!approval) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Approval not found or already resolved' },
      } as JSONRPCResponse;
    }

    // If the elicitation is still in-flight (user responded via panel before timeout),
    // resolve it through the normal elicitation path
    const pending = pendingElicitations.get(params.approvalId);
    if (pending) {
      pendingElicitations.delete(params.approvalId);
      cleanupElicitation(pending);
      if (params.approved) {
        pending.resolve(true);
      } else {
        pending.reject(new Error('Approval rejected by user'));
      }
    }

    // Broadcast approval state change for UI updates
    if (ctx.broadcast) {
      ctx.broadcast({
        jsonrpc: '2.0',
        method: 'beam/approval-resolved',
        params: { approvalId: params.approvalId, photon: params.photon, status },
      });
    }

    return { jsonrpc: '2.0', id: req.id, result: { success: true, status } } as JSONRPCResponse;
  },

  // List all pending approvals (for sidebar badge)
  'beam/approvals-list': async (req, session, ctx) => {
    const photonNames = ctx.photons.map((p: any) => p.name);
    const approvals = await getAllPendingApprovals(photonNames);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { approvals },
    } as JSONRPCResponse;
  },

  // Client notifies what resource they're viewing (for on-demand subscriptions)
  // photonId: hash of photon path (unique across servers)
  // itemId: whatever the photon uses to identify the item (e.g., board name)
  // lastTimestamp: optional - for delta sync of missed events on reconnect
  'beam/viewing': async (req, session, ctx) => {
    const params = req.params as
      | { photonId?: string; itemId?: string; lastTimestamp?: number }
      | undefined;
    const photonId = params?.photonId;
    const itemId = params?.itemId;
    const lastTimestamp = params?.lastTimestamp;
    if (photonId && itemId && ctx.subscriptionManager) {
      ctx.subscriptionManager.onClientViewingBoard(session.id, photonId, itemId, lastTimestamp);
    }
    // Notification - no response needed
    return { jsonrpc: '2.0' } as JSONRPCResponse;
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // A2A Agent Card (via MCP transport)
  // ─────────────────────────────────────────────────────────────────────────────
  'a2a/card': async (req, session, ctx) => {
    const configuredPhotons = ctx.photons
      .filter((p): p is PhotonInfo => p.configured)
      .filter((p) => !p.internal);
    const card = generateAgentCard(
      configuredPhotons.map((p) => ({
        name: p.name,
        description: p.description,
        stateful: p.stateful,
        icon: p.icon,
        methods: p.methods.map((m) => ({
          name: m.name,
          description: m.description,
          params: m.params,
        })),
      })),
      { version: PHOTON_VERSION }
    );
    return { jsonrpc: '2.0', id: req.id, result: card } as JSONRPCResponse;
  },

  ping: async (req) => {
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Server Card (discovery via MCP)
  // ─────────────────────────────────────────────────────────────────────────────
  'server/card': async (req, _session, ctx) => {
    const card = generateServerCard(ctx.photons);
    return { jsonrpc: '2.0', id: req.id, result: card };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Tools
  // ─────────────────────────────────────────────────────────────────────────────
  'tools/list': async (req, session, ctx) => {
    const tools: MCPTool[] = [];

    // Claim-code scoping: when the session presented a valid claim on
    // initialize, only photons whose source file lives under that
    // directory are visible. Unscoped sessions keep the prior behavior
    // (every configured photon is listed).
    const scopeDir = session.claimScopeDir;
    const visiblePhotons = scopeDir
      ? ctx.photons.filter((p) => isPathInScope(p.path, scopeDir))
      : ctx.photons;

    // Add configured photon methods as tools
    for (const photon of visiblePhotons) {
      if (!photon.configured || !photon.methods) continue;

      // Advertise web-app routing for either an explicit @get / route or a
      // TSX client app entry; both are served by /web/{photon}/.
      const photonClass = ctx.photonMCPs.get(photon.name) as
        | Parameters<typeof selectWebAppUrl>[1]
        | undefined;
      const webUrl = selectWebAppUrl(photon, photonClass);
      const capabilityContracts =
        photonClass && ctx.loader?.getCapabilityContracts
          ? ctx.loader.getCapabilityContracts(photonClass as any)
          : [];
      const contractByName = new Map(
        capabilityContracts.map((contract) => [contract.name, contract])
      );

      for (const method of photon.methods) {
        const contract = contractByName.get(method.name);
        // Beam is an MCP host, not an independent exposure surface.
        if (contract && !contract.exposure.has('mcp')) continue;
        const loadedPhoton = ctx.photonMCPs.get(photon.name);
        if (
          loadedPhoton &&
          ctx.loader?.isToolAccessible &&
          !ctx.loader.isToolAccessible(loadedPhoton as any, method.name, ctx.caller)
        ) {
          continue;
        }
        const uiResourceUri = method.linkedUi
          ? `ui://${photon.name}/${method.linkedUi}`
          : undefined;
        const meta = buildToolMCPMeta(method, {
          uiResourceUri,
          includeUi: ctx.requestContext?.client.capabilities.mcpApps === true,
          includePhoton:
            ctx.wireAdapter.era === 'legacy-2025' ||
            ctx.requestContext?.client.capabilities.photon === true,
          includeDeprecatedUiResourceKey:
            ctx.wireAdapter.era === 'modern-2026' &&
            ctx.requestContext?.client.capabilities.mcpApps === true,
        });
        tools.push({
          name: ctx.singleServerNames
            ? method.name
            : toolNameForSession(session, photon.name, method.name),
          description: method.description || `Execute ${method.name}`,
          inputSchema: method.params || { type: 'object', properties: {} },
          'x-photon-id': photon.id, // Unique ID (hash of path) for subscriptions
          'x-photon-path': photon.path, // File path for View Source
          // Editable when the photon file sits directly in the base dir (user-owned).
          // Marketplace-installed photons live in a subdirectory and are read-only.
          'x-photon-editable': photon.path
            ? dirname(photon.path) === (ctx.workingDir || '')
            : false,
          'x-photon-description': photon.description,
          'x-photon-icon': photon.icon,
          'x-photon-internal': photon.internal,
          'x-photon-stateful': photon.stateful || false,
          'x-photon-has-settings': photon.hasSettings || false,
          // Constructor params for the Beam Settings → Setup tab. Empty
          // array (or missing) means the photon takes no env-injected
          // setup. Server already masks secret-named values.
          'x-photon-required-params': photon.requiredParams || [],
          'x-photon-short-name': photon.shortName,
          'x-photon-namespace': photon.namespace,
          'x-photon-qualified-name': photon.qualifiedName,
          'x-photon-install-source': photon.installSource,
          'x-photon-prompt-count': photon.promptCount ?? 0,
          'x-photon-resource-count': photon.resourceCount ?? 0,
          ...(contract?.exposure ? { 'x-photon-surfaces': [...contract.exposure] } : {}),
          ...(webUrl ? { 'x-web-url': webUrl, 'x-web-description': photon.description } : {}),
          ...buildToolMetadataExtensions(method, {
            addOutputSchemaDialect: ctx.wireAdapter.era === 'modern-2026',
          }),
          ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
        });
      }
    }

    // Add runtime-injected instance tools for stateful photons
    for (const photon of visiblePhotons) {
      if (!photon.configured || !photon.stateful) continue;
      tools.push({
        name: namespacedToolName(photon.name, '_use'),
        description: `Switch to a named instance of ${photon.name}. Omit name to select interactively.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Instance name (empty for default). Omit to select interactively.',
            },
          },
        },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: namespacedToolName(photon.name, '_instances'),
        description: `List all available instances of ${photon.name}.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: namespacedToolName(photon.name, '_undo'),
        description: `Undo the last state mutation on ${photon.name}. Reverts the most recent change.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
      tools.push({
        name: namespacedToolName(photon.name, '_redo'),
        description: `Redo the last undone mutation on ${photon.name}. Re-applies a previously undone change.`,
        inputSchema: { type: 'object', properties: {} },
        'x-photon-id': photon.id,
        'x-photon-internal': true,
      });
    }

    // Add external MCP tools (from mcpServers in config.json)
    if (ctx.externalMCPs) {
      for (const mcp of ctx.externalMCPs) {
        if (!mcp.connected || !mcp.methods) continue;

        for (const method of mcp.methods) {
          const meta = buildToolMCPMeta(method, {
            uiResourceUri: method.linkedUi,
            includeUi: ctx.requestContext?.client.capabilities.mcpApps === true,
            includePhoton:
              ctx.wireAdapter.era === 'legacy-2025' ||
              ctx.requestContext?.client.capabilities.photon === true,
            includeDeprecatedUiResourceKey:
              ctx.wireAdapter.era === 'modern-2026' &&
              ctx.requestContext?.client.capabilities.mcpApps === true,
          });
          tools.push({
            name: namespacedToolName(mcp.name, method.name),
            description: method.description || `Execute ${method.name}`,
            inputSchema: method.params || { type: 'object', properties: {} },
            'x-external-mcp': true, // Marker for frontend to identify external MCPs
            'x-external-mcp-id': mcp.id,
            'x-photon-icon': mcp.icon || '🔌',
            'x-photon-description': mcp.description,
            'x-photon-prompt-count': mcp.promptCount ?? 0,
            'x-photon-resource-count': mcp.resourceCount ?? 0,
            'x-has-mcp-app': mcp.hasApp ?? false, // MCP Apps Extension detected
            'x-mcp-app-uri': mcp.appResourceUri, // MCP App resource URI (default/first)
            'x-mcp-app-uris': mcp.appResourceUris || [], // All MCP App resource URIs
            ...buildToolMetadataExtensions(method),
            ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
          });
        }
      }
    }

    // Add beam system tools (internal — hidden from sidebar)
    tools.push({
      name: 'beam/configure',
      'x-photon-internal': true,
      description:
        'Configure a photon with required parameters. Use initialize response configurationSchema to get required fields.',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to configure',
          },
          config: {
            type: 'object',
            description: 'Configuration values (key-value pairs matching the configurationSchema)',
            additionalProperties: true,
          },
        },
        required: ['photon', 'config'],
      },
    });

    tools.push({
      name: 'beam/browse',
      'x-photon-internal': true,
      description: 'Browse server filesystem for file/directory selection',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (defaults to home directory)',
          },
          filter: {
            type: 'string',
            description: 'File extension filter (e.g., ".pem,.crt" or "*.photon.ts")',
          },
        },
      },
    });

    tools.push({
      name: 'beam/reload',
      'x-photon-internal': true,
      description: 'Reload a photon to pick up file changes',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to reload',
          },
        },
        required: ['photon'],
      },
    });

    tools.push({
      name: 'beam/remove',
      'x-photon-internal': true,
      description: 'Remove a photon from the workspace (moves to trash)',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to remove',
          },
        },
        required: ['photon'],
      },
      annotations: { destructiveHint: true },
    });

    tools.push({
      name: 'beam/photon-help',
      'x-photon-internal': true,
      description: 'Get rich documentation for a photon',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon to get help for',
          },
        },
        required: ['photon'],
      },
    });

    tools.push({
      name: 'beam/update-metadata',
      'x-photon-internal': true,
      description: 'Update photon or method metadata (icon, description)',
      inputSchema: {
        type: 'object',
        properties: {
          photon: {
            type: 'string',
            description: 'Name of the photon',
          },
          method: {
            type: 'string',
            description: 'Name of the method (optional, for method metadata)',
          },
          metadata: {
            type: 'object',
            description: 'Metadata to update (icon, description)',
            properties: {
              icon: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        required: ['photon', 'metadata'],
      },
    });

    tools.push({
      name: 'beam/reconnect-mcp',
      'x-photon-internal': true,
      description: 'Reconnect a disconnected external MCP server',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the external MCP to reconnect',
          },
        },
        required: ['name'],
      },
    });

    tools.push({
      name: 'beam/studio-read',
      'x-photon-internal': true,
      description: 'Read a photon source file for editing in Studio',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to read',
          },
        },
        required: ['name'],
      },
    });

    tools.push({
      name: 'beam/studio-write',
      'x-photon-internal': true,
      description: 'Write photon source and trigger hot-reload',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to write',
          },
          source: {
            type: 'string',
            description: 'The new source code',
          },
        },
        required: ['name', 'source'],
      },
    });

    tools.push({
      name: 'beam/studio-project',
      'x-photon-internal': true,
      description: 'Resolve local support files for Studio TypeScript context',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon to resolve from',
          },
          source: {
            type: 'string',
            description: 'Current unsaved source code to resolve imports from',
          },
        },
        required: ['name', 'source'],
      },
    });

    tools.push({
      name: 'beam/studio-apply-files',
      'x-photon-internal': true,
      description: 'Apply coordinated Studio file updates across the photon project',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the photon being edited',
          },
          source: {
            type: 'string',
            description: 'Updated source for the photon file',
          },
          files: {
            type: 'array',
            description: 'Updated sources for the photon and related local support files',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                source: { type: 'string' },
              },
              required: ['path', 'source'],
            },
          },
        },
        required: ['name', 'source', 'files'],
      },
    });

    tools.push({
      name: 'beam/studio-parse',
      'x-photon-internal': true,
      description: 'Parse photon source and return extracted schema',
      inputSchema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Source code to parse',
          },
        },
        required: ['source'],
      },
    });

    // Filter out app-only tools for external (non-Beam) MCP clients
    const revisionValidTools =
      ctx.wireAdapter.era === 'modern-2026'
        ? tools.filter((tool) => parseMCPHeaderBindings(tool.inputSchema).ok)
        : tools;
    const visibleTools = session.isBeam
      ? revisionValidTools
      : revisionValidTools.filter((t) => {
          const vis = (
            t as Record<string, unknown> & { _meta?: { ui?: { visibility?: string[] } } }
          )._meta?.ui?.visibility;
          if (vis && Array.isArray(vis) && vis.includes('app') && !vis.includes('model')) {
            return false;
          }
          return true;
        });
    const sortedTools = stableSortMCPList(visibleTools, (tool) => tool.name);

    try {
      const page = paginateMCPList(
        sortedTools,
        (req.params as { cursor?: unknown } | undefined)?.cursor
      );
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withCacheMetadata(
          {
            tools: page.items,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          },
          ctx,
          {
            session,
            personalized:
              session.isBeam === true ||
              clientProfilePersonalizesResult(ctx.requestContext?.client),
          }
        ),
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) return invalidCursorResponse(req.id, error);
      throw error;
    }
  },

  'tools/call': async (req, session, ctx) => {
    if (
      !isRecord(req.params) ||
      typeof req.params.name !== 'string' ||
      !req.params.name.trim() ||
      (req.params.arguments !== undefined && !isRecord(req.params.arguments))
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: 'tools/call requires a non-empty name and object arguments',
        },
      };
    }
    const name = req.params.name;
    const args = req.params.arguments;
    const modernInputFlow = ctx.wireAdapter.era === 'modern-2026';
    const inputStateStores = modernInputFlow ? inputStoresFor(ctx) : undefined;
    const requestState =
      typeof req.params.requestState === 'string' ? req.params.requestState : undefined;
    const inputResponses = isRecord(req.params.inputResponses)
      ? (req.params.inputResponses as MCPInputResponses)
      : undefined;
    let requestStateConsumed = false;
    if (
      modernInputFlow &&
      ((req.params.requestState !== undefined && requestState === undefined) ||
        (req.params.inputResponses !== undefined && inputResponses === undefined) ||
        (inputResponses !== undefined && requestState === undefined))
    ) {
      return buildInvalidRequestStateResponse(req);
    }

    // MCP spec: if the caller supplied `_meta.progressToken`, every
    // notifications/progress we emit for this request MUST echo that
    // token so the client can correlate progress events with the
    // specific in-flight request. Falling back to a synthetic token
    // stranded progress notifications — clients filtered them out
    // because no listener was registered for the synthetic key.
    const clientProgressToken = (
      req.params as { _meta?: { progressToken?: string | number } } | undefined
    )?._meta?.progressToken;

    if (requestState && name.startsWith('beam/')) {
      return buildInvalidRequestStateResponse(req);
    }

    // Handle beam system tools
    if (name === 'beam/configure') {
      return normalizeToolCallErrorResponse(
        await handleBeamConfigure(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/browse') {
      return normalizeToolCallErrorResponse(
        await handleBeamBrowse(req, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/reload') {
      return normalizeToolCallErrorResponse(
        await handleBeamReload(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/remove') {
      return normalizeToolCallErrorResponse(
        await handleBeamRemove(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/update-metadata') {
      return normalizeToolCallErrorResponse(
        await handleBeamUpdateMetadata(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/reconnect-mcp') {
      return normalizeToolCallErrorResponse(
        await handleBeamReconnectMCP(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/photon-help') {
      return normalizeToolCallErrorResponse(
        await handleBeamPhotonHelp(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/studio-read') {
      return normalizeToolCallErrorResponse(
        await handleBeamStudioRead(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/studio-write') {
      return normalizeToolCallErrorResponse(
        await handleBeamStudioWrite(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/studio-project') {
      return normalizeToolCallErrorResponse(
        await handleBeamStudioProject(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/studio-apply-files') {
      return normalizeToolCallErrorResponse(
        await handleBeamStudioApplyFiles(req, ctx, args || {}),
        req,
        ctx,
        name
      );
    }

    if (name === 'beam/studio-parse') {
      return normalizeToolCallErrorResponse(
        await handleBeamStudioParse(req, args || {}),
        req,
        ctx,
        name
      );
    }

    // Parse tool name: server-name.method-name.
    // ChatGPT/OpenAI app sessions receive slashless names in tools/list because
    // their connector layer treats slash-qualified names as app resource paths.
    let serverName: string;
    let methodName: string;
    const namespacedName = splitNamespacedToolName(name);
    if (!namespacedName && (ctx.singleServerNames || isOpenAIAppSession(session))) {
      const matches = ctx.photons.filter(
        (photon) => photon.configured && photon.methods?.some((method) => method.name === name)
      );
      if (matches.length === 1) {
        const photon = matches[0];
        serverName = photon.name;
        methodName = name;
      } else {
        return buildUnknownToolResponse(req, ctx, name);
      }
    } else if (!namespacedName) {
      return buildUnknownToolResponse(req, ctx, name);
    } else {
      serverName = namespacedName.serverName;
      methodName = namespacedName.methodName;
    }

    // Per-photon auth check: if this photon requires auth but caller is anonymous, reject
    const targetPhoton = ctx.photons.find((p) => p.name === serverName);
    const targetMcp = ctx.photonMCPs.get(serverName);
    if (
      targetMcp &&
      ctx.loader?.isToolAccessible &&
      !ctx.loader.isToolAccessible(targetMcp as any, methodName, ctx.caller)
    ) {
      return buildToolErrorResponse(
        req,
        ctx,
        name,
        `Tool ${name} is not available for this caller.`,
        {
          code: PHOTON_TOOL_ERROR_CODES.ACCESS_DENIED,
          category: 'authorization',
          errorType: 'permission_error',
          retryable: false,
        }
      );
    }

    // Claim-code scope enforcement: filtering tools/list alone is not a
    // gate — a caller that knows a tool name (cached from before the
    // claim was scoped, or inferred) could still invoke it via
    // tools/call. Every call therefore re-checks scope against the
    // session's `claimScopeDir`. Unscoped sessions bypass this check.
    if (session.claimScopeDir) {
      if (!targetPhoton || !isPathInScope(targetPhoton.path, session.claimScopeDir)) {
        if (ctx.wireAdapter.era === 'modern-2026') {
          return buildUnknownToolResponse(req, ctx, name);
        }
        return buildToolErrorResponse(
          req,
          ctx,
          name,
          `Tool ${name} is not available in the current claim scope.`,
          {
            code: PHOTON_TOOL_ERROR_CODES.ACCESS_DENIED,
            category: 'authorization',
            errorType: 'permission_error',
            retryable: false,
          }
        );
      }
    }

    if (targetPhoton?.configured && targetPhoton.auth && targetPhoton.auth !== 'optional') {
      if (!ctx.caller || ctx.caller.anonymous) {
        return buildToolErrorResponse(
          req,
          ctx,
          name,
          `Authentication required for ${serverName}. Provide OAuth credentials.`,
          {
            code: PHOTON_TOOL_ERROR_CODES.AUTHENTICATION_REQUIRED,
            category: 'authorization',
            errorType: 'authentication_required',
            retryable: false,
          }
        );
      }
    }

    // Native photons take precedence over external MCP clients with the same name
    // Support both short names and namespace:name qualified names
    const isNativePhoton = ctx.photons.some((p) => p.name === serverName);
    const externalMCPInfo = ctx.externalMCPs?.find((mcp) => mcp.name === serverName);
    const externalMethodInfo = externalMCPInfo?.methods?.find(
      (method) => method.name === methodName
    );
    if (
      !isNativePhoton &&
      (ctx.externalMCPSDKClients?.has(serverName) || ctx.externalMCPClients?.has(serverName)) &&
      !externalMethodInfo
    ) {
      return buildUnknownToolResponse(req, ctx, name);
    }
    if (!isNativePhoton && requestState) {
      return buildInvalidRequestStateResponse(req);
    }

    // Check if this is an external MCP tool call (only when no native photon matches)
    // Prefer SDK client for full CallToolResult support (structuredContent)
    if (!isNativePhoton && ctx.externalMCPSDKClients?.has(serverName)) {
      const sdkClient = ctx.externalMCPSDKClients.get(serverName);
      try {
        // SDK client.callTool returns full CallToolResult with structuredContent
        const traceMeta = {
          ...(ctx.requestContext?.traceparent
            ? { traceparent: ctx.requestContext.traceparent }
            : {}),
          ...(ctx.requestContext?.tracestate ? { tracestate: ctx.requestContext.tracestate } : {}),
          ...(ctx.requestContext?.baggage ? { baggage: ctx.requestContext.baggage } : {}),
        };
        const result = await sdkClient.callTool({
          name: methodName,
          arguments: args || {},
          ...(Object.keys(traceMeta).length > 0 ? { _meta: traceMeta } : {}),
        });
        let structuredContent: FiniteJSONValue | undefined;
        if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) {
          const validation = await validateStructuredOutput(
            result.isError === true ? true : (externalMethodInfo?.outputSchema ?? true),
            result.structuredContent
          );
          if (!validation.ok) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: buildOutputSchemaToolError(validation, name, ctx.requestContext),
            };
          }
          if (ctx.wireAdapter.includesStructuredContent(validation.value)) {
            structuredContent = validation.value;
          }
        }

        const upstreamMeta = isRecord(result._meta) ? result._meta : {};
        const upstreamError =
          result.isError === true
            ? buildMCPToolError(name, 'External tool reported an execution error', {
                requestId: ctx.requestContext?.requestId ?? req.id,
                traceparent: ctx.requestContext?.traceparent,
                code: PHOTON_TOOL_ERROR_CODES.EXECUTION_FAILED,
                category: 'tool_execution',
                errorType: 'external_tool_error',
                retryable: false,
                publicMessage: 'External tool reported an execution error',
              })
            : undefined;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: result.content,
            ...(structuredContent !== undefined || result.structuredContent === null
              ? { structuredContent }
              : {}),
            isError: result.isError === true,
            ...(Object.keys(upstreamMeta).length > 0 || upstreamError
              ? { _meta: { ...upstreamMeta, ...(upstreamError?._meta ?? {}) } }
              : {}),
          },
        };
      } catch (error) {
        return buildToolErrorResponse(req, ctx, name, error, {
          code: PHOTON_TOOL_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          category: 'dependency',
          errorType: 'external_transport_error',
          retryable: true,
        });
      }
    }

    // Fallback to wrapper client (no structuredContent support)
    if (!isNativePhoton && ctx.externalMCPClients?.has(serverName)) {
      const client = ctx.externalMCPClients.get(serverName);
      try {
        const result = await client.call(methodName, args || {});

        if (isRecord(result) && Array.isArray(result.content)) {
          const upstreamMeta = isRecord(result._meta) ? result._meta : {};
          const isError = result.isError === true;
          const normalizedResult = { ...result };
          delete normalizedResult.structuredContent;
          if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) {
            const validation = await validateStructuredOutput(
              isError ? true : (externalMethodInfo?.outputSchema ?? true),
              result.structuredContent
            );
            if (!validation.ok) {
              return {
                jsonrpc: '2.0',
                id: req.id,
                result: buildOutputSchemaToolError(validation, name, ctx.requestContext),
              };
            }
            if (ctx.wireAdapter.includesStructuredContent(validation.value)) {
              normalizedResult.structuredContent = validation.value;
            }
          }
          const normalizedError = isError
            ? buildMCPToolError(name, 'External tool reported an execution error', {
                requestId: ctx.requestContext?.requestId ?? req.id,
                traceparent: ctx.requestContext?.traceparent,
                errorType: 'external_tool_error',
                retryable: false,
                publicMessage: 'External tool reported an execution error',
              })
            : undefined;
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              ...normalizedResult,
              isError,
              ...(Object.keys(upstreamMeta).length > 0 || normalizedError
                ? { _meta: { ...upstreamMeta, ...(normalizedError?._meta ?? {}) } }
                : {}),
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: formatResultText(result) }],
            isError: false,
          },
        };
      } catch (error) {
        return buildToolErrorResponse(req, ctx, name, error, {
          code: PHOTON_TOOL_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          category: 'dependency',
          errorType: 'external_transport_error',
          retryable: true,
        });
      }
    }

    // Handle as photon tool call
    const photonName = serverName;

    // Find photon info for UI metadata
    const photonInfo = ctx.photons.find((p) => p.name === photonName);
    const methodInfo = photonInfo?.configured
      ? photonInfo.methods?.find((m) => m.name === methodName)
      : undefined;

    if (ctx.wireAdapter.era === 'modern-2026' && methodInfo?.requiredClientCapabilities) {
      const capabilities = ctx.requestContext?.client.capabilities;
      const missing = methodInfo.requiredClientCapabilities.find((capability) => {
        if (capability === 'sampling') return capabilities?.sampling !== true;
        const declared = requestMeta(req)['io.modelcontextprotocol/clientCapabilities'];
        return !isRecord(declared) || !Object.prototype.hasOwnProperty.call(declared, capability);
      });
      if (missing) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32021,
            message: 'Missing required client capability',
            data: { requiredCapabilities: { [missing]: {} } },
          },
        };
      }
    }

    const uiMetadata = buildResponseUIMetadata(photonName, methodInfo, {
      includePhoton:
        ctx.wireAdapter.era === 'legacy-2025' ||
        ctx.requestContext?.client.capabilities.photon === true,
    });

    // Tool-argument schema mismatches are execution errors: the model can
    // correct its arguments and retry. A broken schema authored by the server
    // is instead an internal protocol failure.
    if (methodInfo?.params) {
      const canonicalArgs = { ...(args || {}) };
      delete canonicalArgs._meta;
      delete canonicalArgs._clientState;
      delete canonicalArgs._targetInstance;
      const inputValidation = await validateStructuredOutput(methodInfo.params, canonicalArgs);
      if (!inputValidation.ok) {
        if (inputValidation.kind === 'invalid-output' || inputValidation.kind === 'output-limit') {
          return buildToolErrorResponse(req, ctx, name, inputValidation.message, {
            code: PHOTON_TOOL_ERROR_CODES.INPUT_INVALID,
            category: 'tool_input',
            errorType: 'validation_error',
            retryable: false,
            publicMessage: 'Tool arguments do not match the declared input schema',
            details: {
              validationKind: inputValidation.kind,
              issueCount: inputValidation.issues?.length ?? 0,
            },
          });
        }
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
            message: 'Tool input schema validation failed internally',
          },
        };
      }
    }

    // Auto-confirm @destructive operations before execution (any transport path)
    if (methodInfo?.destructiveHint) {
      if (modernInputFlow) {
        if (req.id === undefined) return buildInvalidRequestStateResponse(req);
        const binding = buildStatelessInputBinding(ctx, name, args, 'destructive');
        const executeConfirmation = async (runtime: {
          request: (
            request: {
              method: 'elicitation/create';
              params?: Record<string, unknown>;
            },
            preferredKey?: string
          ) => Promise<unknown>;
        }) => {
          const result = await runtime.request(
            {
              method: 'elicitation/create',
              params: finiteInputParams(
                buildMcpElicitParamsFromAsk({
                  ask: 'confirm',
                  message: 'Confirm destructive tool call',
                  description:
                    methodInfo.description ||
                    `This will run ${photonName}.${methodName}, which is marked as destructive.`,
                  photonName,
                  methodName,
                  methodTitle: methodInfo.title || methodInfo.name,
                  risk: 'destructive',
                })
              ),
            },
            'confirm'
          );
          return (
            isRecord(result) &&
            result.action === 'accept' &&
            isRecord(result.content) &&
            result.content.confirmed === true
          );
        };
        try {
          if (
            requestState &&
            !inputStateStores!.destructive.owns(requestState) &&
            !inputStateStores!.tool.owns(requestState)
          ) {
            return buildInvalidRequestStateResponse(req);
          }
          if (!requestState || inputStateStores!.destructive.owns(requestState)) {
            const turn = requestState
              ? await inputStateStores!.destructive.resume<boolean>(
                  {
                    requestState,
                    binding,
                    requestId: req.id,
                    inputResponses: inputResponses ?? {},
                  },
                  executeConfirmation
                )
              : await inputStateStores!.destructive.begin(binding, req.id, executeConfirmation);
            if (turn.kind === 'input-required') {
              return { jsonrpc: '2.0', id: req.id, result: turn.result };
            }
            requestStateConsumed = requestState !== undefined;
            if (!turn.value) {
              return {
                jsonrpc: '2.0' as const,
                id: req.id,
                result: {
                  content: [{ type: 'text', text: `${methodName} cancelled` }],
                  isError: false,
                },
              };
            }
          }
        } catch (error) {
          if (error instanceof StatelessInputStateError) {
            return buildInvalidRequestStateResponse(req, error);
          }
          throw error;
        }
      } else {
        const elicitResult = await requestBeamElicitation(
          {
            ask: 'confirm',
            message: 'Confirm destructive tool call',
            description:
              methodInfo.description ||
              `This will run ${photonName}.${methodName}, which is marked as destructive.`,
            photonName,
            methodName,
            methodTitle: methodInfo.title || methodInfo.name,
            risk: 'destructive',
            _meta: {
              toolCall: {
                photon: photonName,
                method: methodName,
                argumentPreview: buildSafeToolArgumentPreview(args || {}),
              },
            },
          },
          { photonName: serverName, methodName }
        );
        if (elicitResult.action !== 'accept' || elicitResult.content === false) {
          return {
            jsonrpc: '2.0' as const,
            id: req.id,
            result: {
              content: [{ type: 'text', text: `${methodName} cancelled` }],
              isError: false,
            },
          };
        }
      }
    }

    // Stateful photons: route through daemon for shared instance across all clients
    if (photonInfo?.stateful && photonInfo.path) {
      if (modernInputFlow && requestState && !requestStateConsumed) {
        return buildInvalidRequestStateResponse(req);
      }
      try {
        const { sendCommand } = await import('../daemon/client.js');
        const { ensureDaemon } = await import('../daemon/manager.js');

        // Ensure daemon is running (idempotent — handles stale binary restart too)
        await ensureDaemon();

        // Each browser tab gets its own daemon session via the MCP session ID.
        // Instance state is tracked per-session on the daemon — no global persistence.
        const beamSessionId = `beam-${session.id}`;
        const sendOpts = {
          photonPath: photonInfo.path,
          sessionId: beamSessionId,
          instanceName: session.instanceName,
          workingDir: ctx.workingDir,
          clientType: 'beam' as const,
        };

        // Elicitation-based instance selection when _use called without name
        if (methodName === '_use' && (!args || !('name' in args))) {
          const instancesResult = (await sendCommand(photonName, '_instances', {}, sendOpts)) as {
            instances?: string[];
            current?: string;
          };
          const instances = instancesResult?.instances || ['default'];

          // Build select options for elicitation modal
          const selectOptions = instances.map((inst: string) => ({
            value: inst,
            label: inst === 'default' ? '(default)' : inst,
            selected: inst === (instancesResult?.current || 'default'),
          }));
          selectOptions.push({ value: '__create_new__', label: 'Create new...', selected: false });

          const elicitResult = await requestBeamElicitation(
            {
              ask: 'select',
              message: 'Select an instance',
              options: selectOptions,
            },
            { photonName: serverName, methodName }
          );

          if (elicitResult.action !== 'accept' || !elicitResult.content) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                content: [{ type: 'text', text: 'Cancelled' }],
                isError: false,
              },
            };
          }

          let selectedName = elicitResult.content as string;

          // Handle "Create new..." selection
          if (selectedName === '__create_new__') {
            const nameResult = await requestBeamElicitation(
              {
                ask: 'text',
                message: 'Enter a name for the new instance',
                placeholder: 'e.g. groceries, work, personal',
              },
              { photonName: serverName, methodName }
            );

            if (nameResult.action !== 'accept' || !nameResult.content) {
              return {
                jsonrpc: '2.0',
                id: req.id,
                result: {
                  content: [{ type: 'text', text: 'Cancelled' }],
                  isError: false,
                },
              };
            }
            selectedName = nameResult.content as string;
          }

          const useResult = await sendCommand(photonName, '_use', { name: selectedName }, sendOpts);
          session.instanceName = selectedName;
          // Notify UI to refresh after instance switch
          broadcastToBeam('state-changed', {
            photon: photonName,
            method: '_use',
            data: { instance: selectedName },
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: formatResultText(useResult) }],
              isError: false,
            },
          };
        }

        // For direct _use with name, also broadcast state-changed
        if (methodName === '_use') {
          const result = await sendCommand(
            photonName,
            methodName,
            (args || {}) as Record<string, any>,
            sendOpts
          );
          session.instanceName = typeof args?.name === 'string' ? args.name : '';
          broadcastToBeam('state-changed', {
            photon: photonName,
            method: '_use',
            data: { instance: args?.name || 'default' },
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [{ type: 'text', text: formatResultText(result) }],
              isError: false,
            },
          };
        }

        // Extract _targetInstance from args for instance-scoped execution
        const callArgs = { ...(args || {}) } as Record<string, any>;
        const targetInstance = callArgs._targetInstance as string | undefined;
        delete callArgs._targetInstance;

        const callOpts = targetInstance !== undefined ? { ...sendOpts, targetInstance } : sendOpts;

        const startTime = Date.now();
        const result = await sendCommand(photonName, methodName, callArgs, callOpts);
        const durationMs = Date.now() - startTime;

        broadcastNotification(
          'beam/log',
          {
            type: 'info',
            message: `${methodName} completed in ${durationMs}ms`,
            durationMs,
            photon: photonName,
            instance: session.instanceName || 'default',
            client: 'beam',
          },
          true
        );
        audit({
          ts: new Date().toISOString(),
          event: 'tool_call',
          photon: photonName,
          method: methodName,
          instance: session.instanceName || 'default',
          client: 'beam',
          sessionId: session.id,
          durationMs,
        });

        const builtResult = await buildToolResult(
          result,
          methodInfo,
          ctx.wireAdapter,
          ctx.requestContext
        );
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: mergeToolResultMetadata(builtResult, uiMetadata),
        };
      } catch (error) {
        const message = sanitizePublicErrorMessage(error);
        audit({
          ts: new Date().toISOString(),
          event: 'tool_error',
          photon: photonName,
          method: methodName,
          instance: session?.instanceName || 'default',
          client: 'beam',
          sessionId: session?.id,
          error: message,
        });
        return buildToolErrorResponse(req, ctx, name, error);
      }
    }

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp?.instance) {
      // Check if it's a disconnected external MCP
      const externalMCP = ctx.externalMCPs?.find((m) => m.name === photonName);
      if (externalMCP) {
        return buildToolErrorResponse(
          req,
          ctx,
          name,
          `External MCP "${photonName}" is not connected${
            externalMCP.errorMessage ? `: ${externalMCP.errorMessage}` : ''
          }`,
          {
            code: PHOTON_TOOL_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
            category: 'dependency',
            errorType: 'external_transport_error',
            retryable: true,
          }
        );
      }
      return buildUnknownToolResponse(req, ctx, name);
    }

    // Check instance first, then prototype, then static methods on class
    let method = mcp.instance[methodName];
    let isStatic = false;

    if (typeof method !== 'function') {
      method = Object.getPrototypeOf(mcp.instance)?.[methodName];
    }

    // Check for static method on class constructor
    if (typeof method !== 'function' && mcp.classConstructor) {
      method = mcp.classConstructor[methodName];
      isStatic = true;
    }

    if (typeof method !== 'function') {
      return buildUnknownToolResponse(req, ctx, name);
    }

    // 2025 task creation remains request-directed through params.task. The 2026
    // extension is server-directed: Photon materializes generator workflows
    // that can pause for input, but only for a client that declared the exact
    // extension on this request. A 2026 `task` parameter is an unknown field
    // and never opts the caller in.
    const legacyTaskRequest =
      !modernInputFlow && isRecord(req.params.task) ? req.params.task : undefined;
    const modernTasksNegotiated = ctx.requestContext?.client.capabilities.tasks === 'extension';
    if (modernInputFlow && methodInfo?.taskSupport === 'required' && !modernTasksNegotiated) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32021,
          message: 'Missing required client capability',
          data: {
            requiredCapabilities: {
              extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
            },
          },
        },
      };
    }
    const modernTask =
      modernInputFlow &&
      modernTasksNegotiated &&
      methodInfo?.taskAfterInput !== true &&
      (methodInfo?.hasGeneratorAsks === true ||
        methodInfo?.isAsync === true ||
        methodInfo?.taskSupport === 'required' ||
        method.constructor?.name === 'AsyncGeneratorFunction');
    if (legacyTaskRequest || modernTask) {
      if (modernInputFlow && requestState && !requestStateConsumed) {
        return buildInvalidRequestStateResponse(req);
      }
      const ttl =
        legacyTaskRequest && typeof legacyTaskRequest.ttl === 'number'
          ? legacyTaskRequest.ttl
          : undefined;
      const task = createTask(photonName, methodName, args, ttl, {
        protocol: modernTask ? 'extension-2026' : 'legacy-2025',
        ...(modernTask ? { owner: buildTaskAccessBinding(ctx) } : {}),
        traceContext: {
          traceparent: ctx.requestContext?.traceparent,
          tracestate: ctx.requestContext?.tracestate,
          baggage: ctx.requestContext?.baggage,
        },
      });
      const controller = new AbortController();
      registerController(task.id, controller);

      const executeFn = async (
        inputProvider: any,
        outputHandler: any,
        inputRequestProvider: any
      ) => {
        if (ctx.loader) {
          const samplingProvider = modernTask
            ? (params: Record<string, unknown>) =>
                requestTaskInput(
                  task.id,
                  {
                    method: 'sampling/createMessage',
                    params: finiteInputParams(params || {}),
                  },
                  controller.signal
                )
            : makeHumanSamplingProvider(session.id);
          return ctx.loader.executeTool(mcp, methodName, args || {}, {
            outputHandler,
            inputProvider,
            inputRequestProvider,
            samplingProvider,
            caller: ctx.caller,
            requestContext: ctx.requestContext,
            signal: controller.signal,
          });
        }
        // Fallback: direct method call
        const target = isStatic ? mcp.classConstructor : mcp.instance;
        return target[methodName](args || {});
      };

      // Broadcast progress/status from task execution
      const taskOutputHandler = (yieldValue: any) => {
        if (!ctx.broadcast) return;
        if (yieldValue?.emit === 'progress' || yieldValue?.emit === 'status') {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken: `task_${task.id}`,
              progress: yieldValue?.emit === 'progress' ? (yieldValue.value ?? 0) : 0,
              total: 100,
              message: yieldValue.message || '',
            },
          });
        }
      };

      runTaskExecution(task.id, executeFn, {
        signal: controller.signal,
        caller: ctx.caller,
        outputHandler: taskOutputHandler,
        ...(modernTask
          ? {
              inputMode: 'modern' as const,
              inputRequestBuilder: (ask: any) => ({
                method: 'elicitation/create',
                params: finiteInputParams(buildMcpElicitParamsFromAsk(ask)),
              }),
              extractInputResponse: extractMcpElicitValue,
              transformResult: async (result: unknown) =>
                mergeToolResultMetadata(
                  await buildToolResult(result, methodInfo, ctx.wireAdapter, ctx.requestContext),
                  uiMetadata
                ),
              protocolErrorFrom: (error: unknown) => {
                if (!isRecord(error)) return undefined;
                const protocolError = error.mcpProtocolError;
                if (
                  !isRecord(protocolError) ||
                  typeof protocolError.code !== 'number' ||
                  typeof protocolError.message !== 'string'
                ) {
                  return undefined;
                }
                return {
                  code: protocolError.code,
                  message: protocolError.message,
                  ...(isRecord(protocolError.data) ? { data: protocolError.data } : {}),
                };
              },
              transformErrorToResult: (error: unknown) => {
                const response = buildToolErrorResponse(req, ctx, name, error);
                return (
                  response.result ?? {
                    content: [{ type: 'text', text: 'Tool execution failed' }],
                    isError: true,
                  }
                );
              },
            }
          : {}),
      });

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: modernTask
          ? toModernTaskWire(task, { creation: true })
          : { task: toWireFormat(task) },
      };
    }

    try {
      // Create outputHandler to capture emits for real-time UI updates
      const outputHandler = (yieldValue: any) => {
        // Echo the caller's progressToken when supplied so the client
        // can route notifications back to the originating panel. Fall
        // back to the synthetic `progress_<photon>_<method>` only when
        // the caller didn't send one (e.g. server-initiated task
        // progress with no user request to correlate against).
        const progressToken = clientProgressToken ?? `progress_${photonName}_${methodName}`;
        const sendJsonRpcNotification = (message: JSONRPCRequest) => {
          ctx.broadcast?.(message);
          let sentOnLegacySession = false;
          if (ctx.wireAdapter.era === 'legacy-2025' && typeof message.method === 'string') {
            sentOnLegacySession = sendToSession(session.id, message.method, message.params);
          }
          if (!sentOnLegacySession) {
            ctx.responseStream?.send(message);
          }
        };

        // Forward progress events as MCP notifications
        if (yieldValue?.emit === 'progress') {
          const rawValue = typeof yieldValue.value === 'number' ? yieldValue.value : 0;
          const progress = rawValue <= 1 ? rawValue * 100 : rawValue;
          sendJsonRpcNotification({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress,
              total: 100,
              ...(typeof yieldValue.message === 'string' ? { message: yieldValue.message } : {}),
            },
          });
          return;
        }

        if (yieldValue?.emit === 'log') {
          const levels = [
            'debug',
            'info',
            'notice',
            'warning',
            'error',
            'critical',
            'alert',
            'emergency',
          ];
          const emittedLevel =
            typeof yieldValue.level === 'string' && levels.includes(yieldValue.level)
              ? yieldValue.level
              : 'info';
          const requestedLevel = requestMeta(req)['io.modelcontextprotocol/logLevel'];
          const logAuthorized =
            ctx.wireAdapter.era === 'legacy-2025' ||
            (typeof requestedLevel === 'string' &&
              levels.includes(requestedLevel) &&
              levels.indexOf(emittedLevel) >= levels.indexOf(requestedLevel));
          if (logAuthorized) {
            sendJsonRpcNotification({
              jsonrpc: '2.0',
              method: 'notifications/message',
              params: {
                level: emittedLevel,
                logger: yieldValue.logger || photonName,
                data: yieldValue.data ?? yieldValue.message ?? '',
              },
            });
            return;
          }
        }

        // Forward status events as MCP notifications
        if (yieldValue?.emit === 'status') {
          const payload = yieldValue.value ?? yieldValue.data;
          sendJsonRpcNotification({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: 0,
              total: 100,
              message: yieldValue.message || '',
              ...(payload !== undefined && { data: payload }),
            },
          });
          return;
        }

        // Forward toast events as beam notifications
        if (yieldValue?.emit === 'toast') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/toast',
            params: {
              message: yieldValue.message || '',
              type: yieldValue.type || 'info',
              duration: yieldValue.duration,
            },
          });
          return;
        }

        // Forward thinking events as beam notifications
        if (yieldValue?.emit === 'thinking') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/thinking',
            params: {
              active: yieldValue.active ?? true,
            },
          });
          return;
        }

        // Forward log events as beam notifications
        if (yieldValue?.emit === 'log') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/log',
            params: {
              message: yieldValue.message || '',
              level: yieldValue.level || 'info',
              data: yieldValue.data,
            },
          });
          return;
        }

        // Forward render events — intermediate formatted results
        if (yieldValue?.emit === 'render') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/render',
            params: {
              photon: photonName,
              method: methodName,
              format: yieldValue.format,
              value: yieldValue.value,
            },
          });
          return;
        }

        // Forward canvas:ui events — AI-generated UI layout with data-slot placeholders
        if (yieldValue?.emit === 'canvas:ui') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/canvas',
            params: {
              type: 'ui',
              photon: photonName,
              method: methodName,
              html: yieldValue.html || '',
            },
          });
          return;
        }

        // Forward canvas:data events — data targeting named slots
        if (yieldValue?.emit === 'canvas:data') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/canvas',
            params: {
              type: 'data',
              photon: photonName,
              method: methodName,
              slot: yieldValue.slot,
              data: yieldValue.data,
            },
          });
          return;
        }

        // Forward render:clear events — clear the render zone
        if (yieldValue?.emit === 'render:clear') {
          ctx.broadcast?.({
            jsonrpc: '2.0',
            method: 'beam/render',
            params: { photon: photonName, method: methodName, clear: true },
          });
          return;
        }

        // Forward channel events (task-moved, task-updated, etc.) with full delta
        // These contain specific event type + data for efficient UI updates
        if (yieldValue?.channel && yieldValue?.event && ctx.broadcast) {
          ctx.broadcast({
            type: 'channel-event',
            photon: photonName,
            channel: yieldValue.channel,
            event: yieldValue.event,
            data: yieldValue.data,
          });
        }
        // Note: board-update emits are intentionally not forwarded here
        // Channel events provide more specific info for real-time updates
      };

      // Create inputProvider to handle ask yields (elicitation)
      // Supports persistent: true for durable approvals that survive navigation/restart
      const legacyInputProvider = async (ask: any): Promise<any> => {
        if (!session.isBeam) {
          if (!sessionSupportsFormElicitation(session)) {
            throw new Error(
              `Tool ${photonName}/${methodName} requires MCP elicitation, but this client did not advertise the elicitation capability. ` +
                'Call it from an MCP client that supports elicitation/create, or use the Beam UI.'
            );
          }
          if ((!session.sseResponse || session.sseResponse.writableEnded) && !ctx.responseStream) {
            throw new Error(
              `Tool ${photonName}/${methodName} requires MCP elicitation, but this session has no live SSE stream for server-initiated requests.`
            );
          }
          const params = buildMcpElicitParamsFromAsk(ask);
          const result =
            session.sseResponse && !session.sseResponse.writableEnded
              ? await requestSession(session.id, 'elicitation/create', params, 300000)
              : await requestResponseStream(
                  session.id,
                  ctx.responseStream!,
                  'elicitation/create',
                  params,
                  300000
                );
          return extractMcpElicitValue(ask, result);
        }

        if (!ctx.broadcast) {
          throw new Error('No broadcast connection for Beam elicitation');
        }

        // Generate unique elicitation ID
        const elicitationId = randomUUID();
        const isPersistent = ask.persistent === true;

        // Determine timeout: persistent asks use 'expires' field, default 5 min
        const timeoutMs = isPersistent && ask.expires ? parseDurationToMs(ask.expires) : 300000;

        return new Promise((resolve, reject) => {
          // Store pending elicitation
          const pending: PendingElicitation = {
            resolve,
            reject,
            sessionId: session?.id || '',
          };
          pendingElicitations.set(elicitationId, pending);

          // For persistent asks, write to approvals.json for durability
          if (isPersistent) {
            const approval: PersistentApproval = {
              id: elicitationId,
              photon: photonName,
              method: methodName,
              message: ask.message || `Confirm ${methodName}?`,
              preview: ask.preview,
              destructive: ask.destructive,
              status: 'pending',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
            };
            // Write async — don't block the elicitation broadcast
            addApproval(approval).catch(() => {});
          }

          // Broadcast elicitation request to frontend
          ctx.broadcast!({
            jsonrpc: '2.0',
            method: 'beam/elicitation',
            params: {
              elicitationId,
              persistent: isPersistent || undefined,
              destructive: ask.destructive || undefined,
              ...ask,
            },
          });

          // Timeout — for persistent asks, mark as pending (not reject)
          pending.timer = setTimeout(
            () => {
              if (pendingElicitations.has(elicitationId)) {
                pendingElicitations.delete(elicitationId);
                if (isPersistent) {
                  // Don't reject — the approval stays in approvals.json for later
                  // Resolve with undefined to indicate "no immediate response"
                  // The caller should check for this and handle gracefully
                  reject(
                    new Error('Approval pending — user can respond later via approvals panel')
                  );
                } else {
                  reject(new Error('Elicitation timeout - no response received'));
                }
              }
            },
            isPersistent ? Math.min(timeoutMs, 60000) : 300000
          ); // Persistent: shorter in-flight timeout (1 min), actual expiry handled by approvals.json
        });
      };

      // Use loader.executeTool if available (sets up execution context for this.emit())
      // Fall back to direct method call for backward compatibility.
      //
      // Build a samplingProvider that forwards `sampling/createMessage`
      // to the Beam session driving this call. The browser's request
      // handler (src/auto-ui/frontend/components/sampling-modal.ts)
      // pops a modal, the human types a response, and that text flows
      // back as the photon's `this.sample()` return value. Declaring
      // `sampling: {}` on the client without this provider would let
      // the photon hang — the earlier codex P1 finding.
      let result: any;
      const startTime = Date.now();
      const executeWithProviders = async (
        inputProvider: (ask: any) => Promise<any>,
        samplingProvider: (params: any) => Promise<any>,
        rootsProvider: (params?: Record<string, unknown>) => Promise<any>,
        inputRequestProvider: (
          requests: Record<
            string,
            {
              method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
              params?: Record<string, unknown>;
            }
          >
        ) => Promise<Record<string, unknown>>,
        signal?: AbortSignal
      ) => {
        if (ctx.loader) {
          return ctx.loader.executeTool(mcp, methodName, args || {}, {
            outputHandler,
            inputProvider,
            samplingProvider,
            rootsProvider,
            inputRequestProvider,
            caller: ctx.caller,
            requestContext: ctx.requestContext,
            signal,
          });
        }
        // For static methods, don't bind to instance
        const directResult = isStatic
          ? await method(args || {})
          : await method.call(mcp.instance, args || {});
        if (!directResult || typeof directResult[Symbol.asyncIterator] !== 'function') {
          return directResult;
        }
        const chunks: any[] = [];
        const iterator = directResult[Symbol.asyncIterator]();
        let iteration = await iterator.next();
        while (!iteration.done) {
          const yielded = iteration.value;
          if (yielded?.ask) {
            const answer = await inputProvider(yielded);
            iteration = await iterator.next(answer);
            continue;
          } else if (yielded?.emit === 'result') {
            chunks.push(yielded.data);
          } else if (yielded?.emit) {
            outputHandler(yielded);
          } else {
            chunks.push(yielded);
          }
          iteration = await iterator.next();
        }
        return chunks.length > 0 ? (chunks.length === 1 ? chunks[0] : chunks) : iteration.value;
      };

      if (modernInputFlow) {
        if (req.id === undefined) return buildInvalidRequestStateResponse(req);
        const binding = buildStatelessInputBinding(ctx, name, args);
        const effectiveRequestState = requestStateConsumed ? undefined : requestState;
        const executeDurableInputFlow = async (runtime: {
          readonly signal: AbortSignal;
          request: (
            request: {
              method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
              params?: Record<string, unknown>;
            },
            preferredKey?: string
          ) => Promise<unknown>;
          requestMany: (
            requests: Record<
              string,
              {
                method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
                params?: Record<string, unknown>;
              }
            >
          ) => Promise<Record<string, unknown>>;
        }) => {
          const modernInputProvider = async (ask: any): Promise<any> => {
            const response = await runtime.request(
              {
                method: 'elicitation/create',
                params: finiteInputParams(buildMcpElicitParamsFromAsk(ask)),
              },
              typeof ask?.id === 'string' ? ask.id : undefined
            );
            return extractMcpElicitValue(ask, response);
          };
          const modernSamplingProvider = async (params: any): Promise<any> =>
            runtime.request({
              method: 'sampling/createMessage',
              params: finiteInputParams(params || {}),
            });
          const modernRootsProvider = async (params: Record<string, unknown> = {}): Promise<any> =>
            runtime.request({
              method: 'roots/list',
              params: finiteInputParams(params),
            });
          return executeWithProviders(
            modernInputProvider,
            modernSamplingProvider,
            modernRootsProvider,
            (requests) => runtime.requestMany(requests),
            runtime.signal
          );
        };
        try {
          const turn = effectiveRequestState
            ? await inputStateStores!.tool.resume<any>(
                {
                  requestState: effectiveRequestState,
                  binding,
                  requestId: req.id,
                  inputResponses: inputResponses ?? {},
                },
                executeDurableInputFlow
              )
            : await inputStateStores!.tool.begin(binding, req.id, executeDurableInputFlow);
          if (turn.kind === 'input-required') {
            return { jsonrpc: '2.0', id: req.id, result: turn.result };
          }
          result = turn.value;

          // SEP-2663 composes MRTR and Tasks as two distinct phases. Tools
          // marked taskAfterInput first complete the replay-safe stateless
          // input loop, then mint a task whose result retains the gathered
          // input. The CreateTaskResult deliberately carries no requestState.
          if (methodInfo?.taskAfterInput === true && modernTasksNegotiated) {
            const task = createTask(photonName, methodName, args, undefined, {
              protocol: 'extension-2026',
              owner: buildTaskAccessBinding(ctx),
              traceContext: {
                traceparent: ctx.requestContext?.traceparent,
                tracestate: ctx.requestContext?.tracestate,
                baggage: ctx.requestContext?.baggage,
              },
            });
            const controller = new AbortController();
            registerController(task.id, controller);
            runTaskExecution(task.id, async () => result, {
              signal: controller.signal,
              caller: ctx.caller,
              inputMode: 'modern',
              transformResult: async (taskResult: unknown) =>
                mergeToolResultMetadata(
                  await buildToolResult(
                    taskResult,
                    methodInfo,
                    ctx.wireAdapter,
                    ctx.requestContext
                  ),
                  uiMetadata
                ),
              transformErrorToResult: (error: unknown) => {
                const response = buildToolErrorResponse(req, ctx, name, error);
                return (
                  response.result ?? {
                    content: [{ type: 'text', text: 'Tool execution failed' }],
                    isError: true,
                  }
                );
              },
            });
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: toModernTaskWire(task, { creation: true }),
            };
          }
        } catch (error) {
          if (error instanceof StatelessInputStateError) {
            return buildInvalidRequestStateResponse(req, error);
          }
          throw error;
        }
      } else {
        result = await executeWithProviders(
          legacyInputProvider,
          session.sseResponse && !session.sseResponse.writableEnded
            ? makeHumanSamplingProvider(session.id)
            : (params) =>
                requestResponseStream(
                  session.id,
                  ctx.responseStream!,
                  'sampling/createMessage',
                  params
                ),
          async () => requestSession(session.id, 'roots/list', {}, 300000),
          async (requests) =>
            Object.fromEntries(
              await Promise.all(
                Object.entries(requests).map(async ([key, request]) => [
                  key,
                  await requestSession(session.id, request.method, request.params ?? {}, 300000),
                ])
              )
            ),
          ctx.signal
        );
      }

      // Handle async generators (when not using loader)
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        const chunks: any[] = [];
        let returnValue: any = undefined;

        // Manually iterate to capture both yielded values AND the return value
        // Note: for-await-of doesn't capture return values, only yielded values
        const iterator = result[Symbol.asyncIterator]();
        while (true) {
          const { value, done } = await iterator.next();
          if (done) {
            // Generator returned - capture the return value
            returnValue = value;
            break;
          }
          // Process yielded values
          if (value?.emit === 'result') {
            chunks.push(value.data);
          } else if (value?.emit === 'board-update' && ctx.broadcast) {
            // Forward board-update from generator
            ctx.broadcast({
              type: 'board-update',
              photon: photonName,
              board: value.board,
            });
          } else if (value?.emit) {
            outputHandler(value);
          } else {
            chunks.push(value);
          }
        }

        // Use return value if no chunks were yielded, otherwise use chunks
        const finalResult =
          chunks.length > 0 ? (chunks.length === 1 ? chunks[0] : chunks) : returnValue;
        const durationMs = Date.now() - startTime;
        broadcastNotification(
          'beam/log',
          {
            type: 'info',
            message: `${methodName} completed in ${durationMs}ms`,
            durationMs,
            photon: photonName,
            instance: session?.instanceName || 'default',
            client: session?.clientInfo?.name || 'beam',
          },
          true
        );
        audit({
          ts: new Date().toISOString(),
          event: 'tool_call',
          photon: photonName,
          method: methodName,
          instance: session?.instanceName || 'default',
          client: session?.clientInfo?.name || 'beam',
          sessionId: session?.id,
          durationMs,
        });

        const builtResult = await buildToolResult(
          finalResult,
          methodInfo,
          ctx.wireAdapter,
          ctx.requestContext
        );
        const genResponse = {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: mergeToolResultMetadata(builtResult, uiMetadata),
        };

        // Broadcast tool result as MCP Apps notification for linked-UI methods
        if (
          ctx.broadcast &&
          methodInfo?.linkedUi &&
          ctx.wireAdapter.era === 'legacy-2025' &&
          ctx.requestContext?.client.capabilities.mcpApps
        ) {
          ctx.broadcast({
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              toolName: `${photonName}/${methodName}`,
              result: genResponse.result,
              isError: builtResult.isError,
            },
          });
        }

        return genResponse;
      }

      const durationMs = Date.now() - startTime;
      broadcastNotification(
        'beam/log',
        {
          type: 'info',
          message: `${methodName} completed in ${durationMs}ms`,
          durationMs,
          photon: photonName,
          instance: session?.instanceName || 'default',
          client: session?.clientInfo?.name || 'beam',
        },
        true
      );
      audit({
        ts: new Date().toISOString(),
        event: 'tool_call',
        photon: photonName,
        method: methodName,
        instance: session?.instanceName || 'default',
        client: session?.clientInfo?.name || 'beam',
        sessionId: session?.id,
        durationMs,
      });

      // For void methods, provide a success acknowledgment so the UI shows feedback
      const builtResult = await buildToolResult(
        result,
        methodInfo,
        ctx.wireAdapter,
        ctx.requestContext
      );
      const toolResponse = {
        jsonrpc: '2.0' as const,
        id: req.id,
        result: mergeToolResultMetadata(builtResult, uiMetadata),
      };

      // Broadcast tool result as MCP Apps notification for linked-UI methods
      if (
        ctx.broadcast &&
        methodInfo?.linkedUi &&
        ctx.wireAdapter.era === 'legacy-2025' &&
        ctx.requestContext?.client.capabilities.mcpApps
      ) {
        ctx.broadcast({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            toolName: `${photonName}/${methodName}`,
            result: toolResponse.result,
            isError: builtResult.isError,
          },
        });
      }

      return normalizeToolCallErrorResponse(toolResponse, req, ctx, name);
    } catch (error) {
      const { errorType, retryable } = formatToolError(methodName, error);
      audit({
        ts: new Date().toISOString(),
        event: 'tool_error',
        photon: photonName,
        method: methodName,
        instance: session?.instanceName || 'default',
        client: session?.clientInfo?.name || 'beam',
        sessionId: session?.id,
        error: sanitizePublicErrorMessage(error),
        errorType,
        retryable,
      });
      return buildToolErrorResponse(req, ctx, name, error, {
        errorType,
        retryable,
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Resources
  //
  // Mirrors what STDIO surfaces via ResourceServer (src/resource-server.ts):
  // - ui://<photon>/<id>            UI Apps templates (assets.ui)
  // - approval://<photon>/<id>      pending approval requests
  // - photon://<photon>/prompts/<id>  class-level @prompt static-file
  // - photon://<photon>/resources/<id>  class-level @resource static-file
  // - <author-defined-uri>          method-level @resource / @Static
  //                                 (non-templated entries from mcp.statics)
  //
  // Templated method-level URIs (`person://{slug}`) belong on
  // resources/templates/list and resolve via resources/read.
  // ─────────────────────────────────────────────────────────────────────────────
  'resources/list': async (req, session, ctx) => {
    const resources: MCPResource[] = [];
    const scopeDir = ctx.requestContext?.scopeDir ?? session.claimScopeDir;
    const visiblePhotons = scopeDir
      ? ctx.photons.filter((photon) => isPathInScope(photon.path, scopeDir))
      : ctx.photons;

    for (const photon of visiblePhotons) {
      if (!photon.configured) continue;
      const mcp = ctx.photonMCPs.get(photon.name);

      if (photon.assets?.ui) {
        for (const uiAsset of photon.assets.ui) {
          const uri = uiAsset.uri || `ui://${photon.name}/${uiAsset.id}`;
          resources.push({
            uri,
            name: uiAsset.id,
            mimeType: uiAsset.mimeType || 'text/html;profile=mcp-app',
            description: uiAsset.linkedTool
              ? `UI template for ${photon.name}/${uiAsset.linkedTool}`
              : `UI template: ${uiAsset.id}`,
          });
        }
      }

      // Class-level @prompt <id> <path> static-file prompts
      if (mcp?.assets?.prompts) {
        for (const prompt of mcp.assets.prompts) {
          resources.push({
            uri: `photon://${photon.name}/prompts/${prompt.id}`,
            name: `prompt:${prompt.id}`,
            mimeType: 'text/markdown',
            description: `Prompt template: ${prompt.id}`,
          });
        }
      }

      // Class-level @resource <id> <path> static-file resources
      if (mcp?.assets?.resources) {
        for (const resource of mcp.assets.resources) {
          resources.push({
            uri: `photon://${photon.name}/resources/${resource.id}`,
            name: `resource:${resource.id}`,
            mimeType: resource.mimeType || 'application/octet-stream',
            description: `Static resource: ${resource.id}`,
          });
        }
      }

      // Method-level @resource / @Static — non-templated URIs only.
      if (mcp?.statics) {
        for (const stat of mcp.statics) {
          if (isUriTemplate(stat.uri)) continue;
          resources.push({
            uri: stat.uri,
            name: stat.name,
            mimeType: stat.mimeType || 'text/plain',
            description: stat.description || `Resource: ${stat.name}`,
          });
        }
      }
    }

    // Add pending approval resources (approval:// scheme)
    const photonNames = visiblePhotons.map((p: any) => p.name);
    const pendingApprovals = await getAllPendingApprovals(photonNames);
    for (const approval of pendingApprovals) {
      resources.push({
        uri: `approval://${approval.photon}/${approval.id}`,
        name: `Pending: ${approval.message}`,
        mimeType: 'application/json',
        description: `Approval request from ${approval.photon}.${approval.method}`,
      });
    }
    const sortedResources = stableSortMCPList(
      resources,
      (resource) => resource.uri,
      (resource) => resource.name
    );

    try {
      const page = paginateMCPList(
        sortedResources,
        (req.params as { cursor?: unknown } | undefined)?.cursor
      );
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withCacheMetadata(
          {
            resources: page.items,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          },
          ctx,
          {
            session,
            ttlMs: pendingApprovals.length > 0 ? 0 : MCP_LIST_CACHE_TTL_MS,
            forcePrivate: pendingApprovals.length > 0,
          }
        ),
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) return invalidCursorResponse(req.id, error);
      throw error;
    }
  },

  'resources/templates/list': async (req, session, ctx) => {
    const resourceTemplates: Array<{
      uriTemplate: string;
      name: string;
      mimeType?: string;
      description?: string;
    }> = [];
    const scopeDir = ctx.requestContext?.scopeDir ?? session.claimScopeDir;
    const visiblePhotons = scopeDir
      ? ctx.photons.filter((photon) => isPathInScope(photon.path, scopeDir))
      : ctx.photons;

    for (const photon of visiblePhotons) {
      if (!photon.configured) continue;
      const mcp = ctx.photonMCPs.get(photon.name);
      if (!mcp?.statics) continue;
      for (const stat of mcp.statics) {
        if (!isUriTemplate(stat.uri)) continue;
        resourceTemplates.push({
          uriTemplate: stat.uri,
          name: stat.name,
          mimeType: stat.mimeType || 'text/plain',
          description: stat.description || `Resource template: ${stat.name}`,
        });
      }
    }
    const sortedResourceTemplates = stableSortMCPList(
      resourceTemplates,
      (template) => template.uriTemplate,
      (template) => template.name
    );

    try {
      const page = paginateMCPList(
        sortedResourceTemplates,
        (req.params as { cursor?: unknown } | undefined)?.cursor
      );
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withCacheMetadata(
          {
            resourceTemplates: page.items,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          },
          ctx,
          { session }
        ),
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) return invalidCursorResponse(req.id, error);
      throw error;
    }
  },

  'resources/read': async (req, session, ctx) => {
    if (!isRecord(req.params) || typeof req.params.uri !== 'string' || !req.params.uri.trim()) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: 'resources/read requires `uri`',
        },
      };
    }
    const uri = req.params.uri;
    const safeUri = sanitizePublicErrorMessage(uri).slice(0, 512);
    const scopeDir = ctx.requestContext?.scopeDir ?? session.claimScopeDir;
    const photonIsVisible = (photonName: string): boolean => {
      if (!scopeDir) return true;
      const photon = ctx.photons.find((candidate) => candidate.name === photonName);
      return !!photon && isPathInScope(photon.path, scopeDir);
    };

    // approval://<photon>/<id>
    const approvalMatch = uri.match(/^approval:\/\/([^/]+)\/(.+)$/);
    if (approvalMatch) {
      const [, photonName, approvalId] = approvalMatch;
      if (!photonIsVisible(photonName)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Approval not found: ${safeUri}` },
        };
      }
      const approvals = await loadApprovals(photonName);
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Approval not found: ${safeUri}` },
        };
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withModernCacheMetadata(
          {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(approval, null, 2) },
            ],
          },
          ctx,
          { session, ttlMs: 0, forcePrivate: true }
        ),
      };
    }

    // ui://<photon>/<id>
    const uiMatch = uri.match(/^ui:\/\/([^/]+)\/(.+)$/);
    if (uiMatch) {
      const [, photonName, uiId] = uiMatch;
      if (!photonIsVisible(photonName)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Resource not found: ${safeUri}` },
        };
      }
      const result = await ctx.loadUIAsset(photonName, uiId);
      if (!result) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Resource not found: ${safeUri}` },
        };
      }
      const mimeType = result.isPhotonTemplate
        ? 'text/html;profile=mcp-app;photon-template=true'
        : 'text/html;profile=mcp-app';
      // An MCP-app webview renders this text with no HTTP origin, so the
      // compiled .tsx bundle must be inlined rather than referenced as a
      // hashed sibling (which only the HTTP serving paths can resolve).
      let text = result.content;
      if (result.compiled?.js) {
        const { inlineHtml } = await import('../tsx-compiler.js');
        text = inlineHtml(result.compiled.js);
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withModernCacheMetadata(
          {
            contents: [
              {
                uri,
                mimeType,
                text,
                ...(ctx.requestContext?.client.capabilities.mcpApps
                  ? { _meta: { ui: { prefersBorder: true } } }
                  : {}),
              },
            ],
          },
          ctx,
          { session }
        ),
      };
    }

    // photon://<photon>/(prompts|resources)/<id> — class-level static-file assets
    const assetMatch = uri.match(/^photon:\/\/([^/]+)\/(prompts|resources)\/(.+)$/);
    if (assetMatch) {
      const [, photonName, kind, assetId] = assetMatch;
      if (!photonIsVisible(photonName)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Asset not found: ${safeUri}` },
        };
      }
      const mcp = ctx.photonMCPs.get(photonName);
      if (!mcp?.assets) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Photon assets not found: ${safeUri}` },
        };
      }
      const list = kind === 'prompts' ? mcp.assets.prompts : mcp.assets.resources;
      const asset = list?.find((a: any) => a.id === assetId);
      const resolvedPath = asset?.resolvedPath;
      if (!resolvedPath) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Asset not found: ${safeUri}` },
        };
      }
      const text = await readText(resolvedPath);
      const mimeType =
        kind === 'prompts'
          ? 'text/markdown'
          : (asset as { mimeType?: string })?.mimeType || 'application/octet-stream';
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withModernCacheMetadata({ contents: [{ uri, mimeType, text }] }, ctx, { session }),
      };
    }

    // Method-level @resource / @Static — match against any photon's statics.
    // The URI may be exact or match a registered template; on match, dispatch
    // through the loader so middleware (auth, logging, audit) applies.
    for (const photon of ctx.photons) {
      if (!photonIsVisible(photon.name)) continue;
      const mcp = ctx.photonMCPs.get(photon.name);
      if (!mcp?.statics) continue;
      for (const stat of mcp.statics) {
        const matched = stat.uri === uri || matchUriTemplate(stat.uri, uri);
        if (!matched) continue;
        const params = isUriTemplate(stat.uri) ? parseUriTemplateParams(stat.uri, uri) : {};
        if (!ctx.loader) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32603,
              message: 'Loader not available for static resource resolution',
            },
          };
        }
        const result = await ctx.loader.executeTool(mcp, stat.name, params, {
          caller: ctx.caller,
          requestContext: ctx.requestContext,
        });
        const authoredBlob =
          isRecord(result) && typeof result.blob === 'string' ? result.blob : undefined;
        const text =
          authoredBlob === undefined
            ? typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2)
            : undefined;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: withModernCacheMetadata(
            {
              contents: [
                {
                  uri,
                  mimeType: stat.mimeType || 'text/plain',
                  ...(authoredBlob === undefined ? { text } : { blob: authoredBlob }),
                },
              ],
            },
            ctx,
            { session, ttlMs: 0, forcePrivate: true }
          ),
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32602, message: `Resource not found: ${safeUri}` },
    };
  },

  // resources/subscribe and resources/unsubscribe — exact-URI keyed.
  // The session's sink is keyed off session.id so disconnect logic in the
  // session-cleanup path can purge subscriptions in O(1).
  'resources/subscribe': async (req, session) => {
    if (!isRecord(req.params) || typeof req.params.uri !== 'string' || !req.params.uri.trim()) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'resources/subscribe requires `uri`' },
      };
    }
    const uri = req.params.uri;
    const sink = getOrCreateSessionSink(session.id);
    streamableSubscriptions.subscribe(sink, uri);
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  'resources/unsubscribe': async (req, session) => {
    if (!isRecord(req.params) || typeof req.params.uri !== 'string' || !req.params.uri.trim()) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'resources/unsubscribe requires `uri`' },
      };
    }
    const uri = req.params.uri;
    const sink = sessionSubscriptionSinks.get(session.id);
    if (sink) streamableSubscriptions.unsubscribe(sink, uri);
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  'prompts/list': async (req, session, ctx) => {
    const prompts: any[] = [];
    const scopeDir = ctx.requestContext?.scopeDir ?? session.claimScopeDir;
    const visiblePhotons = scopeDir
      ? ctx.photons.filter((photon) => isPathInScope(photon.path, scopeDir))
      : ctx.photons;
    for (const photon of visiblePhotons) {
      if (!photon.configured) continue;
      const mcp = ctx.photonMCPs.get(photon.name);
      if (!mcp?.templates) continue;
      for (const template of mcp.templates) {
        prompts.push({
          name: ctx.singleServerNames ? template.name : `${photon.name}/${template.name}`,
          description: template.description,
          arguments: Object.entries(template.inputSchema?.properties || {}).map(
            ([name, schema]) => ({
              name,
              description:
                (typeof schema === 'object' && schema && 'description' in schema
                  ? (schema as { description?: string }).description
                  : '') || '',
              required: template.inputSchema?.required?.includes(name) || false,
            })
          ),
        });
      }
    }
    const sortedPrompts = stableSortMCPList(prompts, (prompt) => prompt.name);
    try {
      const page = paginateMCPList(
        sortedPrompts,
        (req.params as { cursor?: unknown } | undefined)?.cursor
      );
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: withCacheMetadata(
          {
            prompts: page.items,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          },
          ctx,
          { session }
        ),
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) return invalidCursorResponse(req.id, error);
      throw error;
    }
  },

  'prompts/get': async (req, _session, ctx) => {
    if (
      !isRecord(req.params) ||
      typeof req.params.name !== 'string' ||
      !req.params.name.trim() ||
      (req.params.arguments !== undefined && !isRecord(req.params.arguments))
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          message: 'prompts/get requires a non-empty name and object arguments',
        },
      };
    }
    const name = req.params.name;
    const args = req.params.arguments || {};
    const requestState =
      typeof req.params.requestState === 'string' ? req.params.requestState : undefined;
    const inputResponses = isRecord(req.params.inputResponses)
      ? (req.params.inputResponses as MCPInputResponses)
      : undefined;
    const safeName = sanitizePublicErrorMessage(name).slice(0, 256);

    const slashIndex = name.indexOf('/');
    if (slashIndex === -1 && !ctx.singleServerNames) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Invalid prompt name: ${safeName}` },
      };
    }

    const photonName =
      slashIndex === -1
        ? (ctx.photons.find(
            (photon) =>
              photon.configured &&
              ctx.photonMCPs.get(photon.name)?.templates?.some((template) => template.name === name)
          )?.name ?? '')
        : name.slice(0, slashIndex);
    const promptName = slashIndex === -1 ? name : name.slice(slashIndex + 1);

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32602,
          message: `Photon not found: ${sanitizePublicErrorMessage(photonName).slice(0, 128)}`,
        },
      };
    }

    const template = mcp.templates?.find((t: any) => t.name === promptName);
    if (!template) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32602,
          message: `Prompt not found: ${sanitizePublicErrorMessage(promptName).slice(0, 128)}`,
        },
      };
    }

    try {
      let result: any;
      if (ctx.wireAdapter.era === 'modern-2026') {
        const binding = buildStatelessInputBinding(ctx, name, args, 'execute', 'prompts/get');
        const executePrompt = async (runtime: {
          request: (
            request: {
              method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
              params?: Record<string, unknown>;
            },
            preferredKey?: string
          ) => Promise<unknown>;
        }) =>
          ctx.loader!.executeTool(mcp, promptName, args, {
            inputProvider: (ask: any) =>
              runtime.request(
                {
                  method: 'elicitation/create',
                  params: finiteInputParams(buildMcpElicitParamsFromAsk(ask)),
                },
                typeof ask?.id === 'string' ? ask.id : undefined
              ),
            samplingProvider: (params: Record<string, unknown>) =>
              runtime.request({
                method: 'sampling/createMessage',
                params: finiteInputParams(params),
              }),
            rootsProvider: (params: Record<string, unknown> = {}) =>
              runtime.request({ method: 'roots/list', params: finiteInputParams(params) }),
            caller: ctx.caller,
            requestContext: ctx.requestContext,
          });
        const store = inputStoresFor(ctx).tool;
        const turn = requestState
          ? await store.resume(
              {
                requestState,
                binding,
                requestId: req.id!,
                inputResponses: inputResponses ?? {},
              },
              executePrompt
            )
          : await store.begin(binding, req.id!, executePrompt);
        if (turn.kind === 'input-required') {
          return { jsonrpc: '2.0', id: req.id, result: turn.result };
        }
        result = turn.value;
      } else {
        result = await ctx.loader!.executeTool(mcp, promptName, args);
      }
      // Format as prompt response
      if (result && typeof result === 'object' && 'messages' in result) {
        return { jsonrpc: '2.0', id: req.id, result: { messages: result.messages } };
      }
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          messages: [{ role: 'user', content: { type: 'text', text } }],
        },
      };
    } catch (error) {
      const reference = buildMCPErrorReference(req.id, ctx.requestContext?.traceparent);
      audit({
        ts: new Date().toISOString(),
        event: 'prompt_error',
        photon: photonName,
        method: promptName,
        error: sanitizePublicErrorMessage(error),
        ...reference,
      });
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          message: 'Prompt execution failed',
          data: {
            [PHOTON_TOOL_ERROR_META_KEY]: {
              code: 'PHOTON_PROMPT_EXECUTION_FAILED',
              ...reference,
            },
          },
        },
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MCP Tasks (2025-11-25 spec)
  // ─────────────────────────────────────────────────────────────────────────────

  'tasks/create': async (req, session, ctx) => {
    const {
      photon: photonName,
      method: methodName,
      params,
      ttl: requestedTtl,
    } = req.params as {
      photon: string;
      method: string;
      params?: Record<string, unknown>;
      ttl?: number;
    };

    if (!photonName || !methodName) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required params: photon, method' },
      };
    }

    // Claim-code scope enforcement on the async task API. tools/call
    // has the same gate at the sync path; without this, a scoped
    // client could bypass scope by starting work via tasks/create.
    if (session.claimScopeDir) {
      const targetInfo = ctx.photons.find((p) => p.name === photonName);
      if (!targetInfo || !isPathInScope(targetInfo.path, session.claimScopeDir)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: -32602,
            message:
              `Photon ${photonName} is not available in the current claim scope. ` +
              `The claim code presented on this session only grants access to photons ` +
              `under ${session.claimScopeDir}.`,
          },
        };
      }
    }

    const mcp = ctx.photonMCPs.get(photonName);
    if (!mcp?.instance) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Photon not found: ${photonName}` },
      };
    }

    const task = createTask(photonName, methodName, params, requestedTtl, {
      traceContext: {
        traceparent: ctx.requestContext?.traceparent,
        tracestate: ctx.requestContext?.tracestate,
        baggage: ctx.requestContext?.baggage,
      },
    });
    const controller = new AbortController();
    registerController(task.id, controller);

    const executeFn = async (inputProvider: any, outputHandler: any) => {
      if (ctx.loader) {
        return ctx.loader.executeTool(mcp, methodName, params || {}, {
          outputHandler,
          inputProvider,
          caller: ctx.caller,
          requestContext: ctx.requestContext,
        });
      }
      const method = mcp.instance?.[methodName];
      if (typeof method !== 'function') {
        throw new Error(`Method ${methodName} not found on ${photonName}`);
      }
      return method.call(mcp.instance, params || {});
    };

    runTaskExecution(task.id, executeFn, {
      signal: controller.signal,
      caller: ctx.caller,
    });

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { task: toWireFormat(task) },
    };
  },

  'tasks/get': async (req, session, ctx) => {
    const { taskId } = req.params as { taskId: string };
    if (!taskId) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required param: taskId' },
      };
    }
    const task = getTask(taskId);
    if (ctx.wireAdapter.era === 'modern-2026') {
      if (!task || !taskAccessMatches(task, ctx)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Task not found: ${taskId}` },
        };
      }
      return { jsonrpc: '2.0', id: req.id, result: toModernTaskWire(task) };
    }
    // Scope-gated: a scoped session sees "not found" whether the task
    // is truly absent or simply out of scope. Collapsing both cases
    // into the same response avoids leaking existence to callers
    // that shouldn't see this photon.
    if (
      !task ||
      task.protocol === 'extension-2026' ||
      !isTaskInScope(task, session.claimScopeDir, ctx.photons)
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${taskId}` },
      };
    }
    return { jsonrpc: '2.0', id: req.id, result: toWireFormat(task) };
  },

  'tasks/update': async (req, _session, ctx) => {
    if (ctx.wireAdapter.era !== 'modern-2026') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, message: 'Method not found' },
      };
    }
    const { taskId, inputResponses } = req.params as {
      taskId: string;
      inputResponses: Record<string, unknown>;
    };
    const task = getTask(taskId);
    if (!task || !taskAccessMatches(task, ctx)) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${taskId}` },
      };
    }
    // The draft requires unknown, duplicate, and already-satisfied keys to be
    // ignored. Only currently outstanding keys are consumed.
    submitTaskInputResponses(taskId, inputResponses);
    return { jsonrpc: '2.0', id: req.id, result: {} };
  },

  'tasks/list': async (req, session, ctx) => {
    const { cursor } = (req.params || {}) as { cursor?: string };
    let allTasks = listTasks().filter((task) => task.protocol !== 'extension-2026');
    // Filter scoped sessions before paginating so the cursor indexes
    // align with what the caller actually sees.
    if (session.claimScopeDir) {
      allTasks = allTasks.filter((t) => isTaskInScope(t, session.claimScopeDir, ctx.photons));
    }
    // Simple pagination: cursor is the offset index
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
    const pageSize = 50;
    const page = allTasks.slice(offset, offset + pageSize);
    const nextCursor = offset + pageSize < allTasks.length ? String(offset + pageSize) : undefined;

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: withCacheMetadata(
        {
          tasks: page.map(toWireFormat),
          ...(nextCursor && { nextCursor }),
        },
        ctx,
        { session, ttlMs: 0 }
      ),
    };
  },

  'tasks/cancel': async (req, session, ctx) => {
    const { taskId } = req.params as { taskId: string };
    if (!taskId) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required param: taskId' },
      };
    }
    const task = getTask(taskId);
    if (ctx.wireAdapter.era === 'modern-2026') {
      if (!task || !taskAccessMatches(task, ctx)) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Task not found: ${taskId}` },
        };
      }
      if (!TERMINAL_STATES.includes(task.state)) {
        getController(taskId)?.abort();
        rejectTaskInput(taskId, 'Task cancelled');
        transitionTask(taskId, ['working', 'input_required'], {
          state: 'cancelled',
          statusMessage: 'The task was cancelled by request.',
          input: undefined,
          inputRequests: undefined,
        });
        unregisterController(taskId);
      }
      // Cancellation is cooperative, eventually consistent, and idempotent.
      return { jsonrpc: '2.0', id: req.id, result: {} };
    }
    if (
      !task ||
      task.protocol === 'extension-2026' ||
      !isTaskInScope(task, session.claimScopeDir, ctx.photons)
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${taskId}` },
      };
    }
    if (TERMINAL_STATES.includes(task.state)) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Cannot cancel task in terminal state: ${task.state}` },
      };
    }

    const controller = getController(taskId);
    if (controller) controller.abort();

    const updated = updateTask(taskId, {
      state: 'cancelled',
      statusMessage: 'The task was cancelled by request.',
    });
    unregisterController(taskId);

    return { jsonrpc: '2.0', id: req.id, result: toWireFormat(updated!) };
  },

  'tasks/result': async (req, session, ctx) => {
    const { taskId } = req.params as { taskId: string };
    if (!taskId) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: 'Missing required param: taskId' },
      };
    }

    const task = getTask(taskId);
    if (
      !task ||
      task.protocol === 'extension-2026' ||
      !isTaskInScope(task, session.claimScopeDir, ctx.photons)
    ) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Task not found: ${taskId}` },
      };
    }

    // Helper to format terminal task result as CallToolResult
    const formatResult = (t: Task) => {
      if (t.state === 'failed') {
        return {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            content: [{ type: 'text', text: taskErrorMessage(t.error) }],
            isError: true,
            _meta: relatedTaskMeta(taskId),
          },
        };
      }
      if (t.state === 'cancelled') {
        return {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            content: [{ type: 'text', text: 'Task was cancelled.' }],
            isError: false,
            _meta: relatedTaskMeta(taskId),
          },
        };
      }
      // Completed — result is already a CallToolResult or raw value
      if (t.result && typeof t.result === 'object' && 'content' in t.result) {
        // Already CallToolResult format
        return {
          jsonrpc: '2.0' as const,
          id: req.id,
          result: {
            ...(t.result as Record<string, unknown>),
            _meta: relatedTaskMeta(taskId),
          },
        };
      }
      // Raw result — wrap in CallToolResult
      const text = typeof t.result === 'string' ? t.result : JSON.stringify(t.result ?? null);
      return {
        jsonrpc: '2.0' as const,
        id: req.id,
        result: {
          content: [{ type: 'text', text }],
          isError: false,
          _meta: relatedTaskMeta(taskId),
        },
      };
    };

    // Already terminal — return immediately
    if (TERMINAL_STATES.includes(task.state)) {
      return formatResult(task);
    }

    // If input_required right now, handle elicitation before waiting
    if (task.state === 'input_required' && task.input) {
      const elicitResult = await requestBeamElicitation(
        task.input as Parameters<typeof requestBeamElicitation>[0],
        { photonName: task.photon || 'task', methodName: task.method || taskId }
      );
      if (elicitResult.action === 'accept') {
        resolveTaskInput(taskId, elicitResult.content);
      } else {
        resolveTaskInput(taskId, null);
      }
    }

    // Block until terminal state, handling input_required along the way
    // Use a timeout based on TTL to avoid infinite blocking
    const timeoutMs = Math.min(task.ttl, 300000); // Max 5 min block per call
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      while (true) {
        const current = await waitForTerminalOrInput(taskId, abortController.signal);

        if (TERMINAL_STATES.includes(current.state)) {
          return formatResult(current);
        }

        if (current.state === 'input_required' && current.input) {
          // Send elicitation to the client
          const elicitResult = await requestBeamElicitation(
            current.input as Parameters<typeof requestBeamElicitation>[0],
            { photonName: task.photon || 'task', methodName: task.method || taskId }
          );
          if (elicitResult.action === 'accept') {
            resolveTaskInput(taskId, elicitResult.content);
          } else {
            resolveTaskInput(taskId, null);
          }
          // Continue loop — wait for next state change
        }
      }
    } catch {
      // Timeout or abort — return current state info
      const current = getTask(taskId);
      if (current && TERMINAL_STATES.includes(current.state)) {
        return formatResult(current);
      }
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            { type: 'text', text: `Task ${taskId} is still running. Poll tasks/get for status.` },
          ],
          isError: false,
          _meta: relatedTaskMeta(taskId),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// BEAM SYSTEM TOOLS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Handle beam/configure tool - configure a photon with provided values
 */
async function handleBeamConfigure(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName, config } = args as { photon: string; config: Record<string, any> };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!config || typeof config !== 'object') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: config object is required' }],
        isError: true,
      },
    };
  }

  // Check if configurePhoton callback is available
  if (!ctx.configurePhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Configuration not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.configurePhoton(photonName, config);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully configured ${photonName}. Tools list will be updated.`,
            },
          ],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to configure ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error configuring ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/browse tool - browse server filesystem
 */
async function handleBeamBrowse(
  req: JSONRPCRequest,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { path: requestedPath, filter } = args as { path?: string; filter?: string };

  // Default to home directory
  let targetPath = requestedPath || homedir();

  // Handle relative navigation (.. for parent)
  if (targetPath.endsWith('/..') || targetPath === '..') {
    targetPath = dirname(targetPath.replace(/\/?\.\.$/, ''));
  }

  try {
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      targetPath = dirname(targetPath);
    }

    const entries = await readdir(targetPath, { withFileTypes: true });

    // Parse filter
    const filters = filter ? filter.split(',').map((f) => f.trim().toLowerCase()) : [];

    const items = entries
      .filter((entry) => {
        // Always show directories
        if (entry.isDirectory()) return true;

        // No filter = show all
        if (filters.length === 0) return true;

        const fileName = entry.name.toLowerCase();
        return filters.some((f) => {
          // Handle glob patterns like "*.photon.ts"
          if (f.startsWith('*.')) {
            const suffix = f.slice(1);
            return fileName.endsWith(suffix);
          }
          // Handle extension patterns like ".ts" or "ts"
          const ext = f.startsWith('.') ? f : `.${f}`;
          return fileName.endsWith(ext);
        });
      })
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        isDirectory: entry.isDirectory(),
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    // Calculate parent path
    const parent = dirname(targetPath);

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                path: targetPath,
                parent: parent !== targetPath ? parent : null,
                items,
              },
              null,
              2
            ),
          },
        ],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error browsing ${targetPath}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/reload tool - reload a photon
 */
async function handleBeamReload(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.reloadPhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Reload not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.reloadPhoton(photonName);

    if (result.success) {
      // Notify Beam clients about the reload
      broadcastToBeam('beam/hot-reload', { photon: result.photon });
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Successfully reloaded ${photonName}` }],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to reload ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error reloading ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/remove tool - remove a photon from the workspace
 */
async function handleBeamRemove(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.removePhoton) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Remove not supported in this context' }],
        isError: true,
      },
    };
  }

  // Require explicit confirmation before removing
  const elicitResult = await requestBeamElicitation(
    {
      ask: 'confirm',
      message: `Remove "${photonName}"? The photon and its assets will be moved to trash.`,
    },
    { photonName, methodName: 'remove' }
  );
  if (elicitResult.action !== 'accept' || elicitResult.content === false) {
    return {
      jsonrpc: '2.0' as const,
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Remove cancelled` }],
        isError: false,
      },
    };
  }

  try {
    const result = await ctx.removePhoton(photonName);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Successfully removed ${photonName}` }],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to remove ${photonName}: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error removing ${photonName}: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/update-metadata tool - update photon or method metadata
 */
async function handleBeamUpdateMetadata(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const {
    photon: photonName,
    method: methodName,
    metadata,
  } = args as {
    photon: string;
    method?: string;
    metadata: Record<string, any>;
  };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!metadata || typeof metadata !== 'object') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: metadata object is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.updateMetadata) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Update metadata not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.updateMetadata(photonName, methodName || null, metadata);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully updated metadata for ${methodName ? `${photonName}/${methodName}` : photonName}`,
            },
          ],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to update metadata: ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error updating metadata: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/photon-help tool - get rich documentation for a photon
 */
async function handleBeamPhotonHelp(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { photon: photonName } = args as { photon: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.generatePhotonHelp) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Help generation not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const markdown = await ctx.generatePhotonHelp(photonName);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: markdown }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error generating help: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/reconnect-mcp tool - reconnect a disconnected external MCP
 */
async function handleBeamReconnectMCP(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: mcpName } = args as { name: string };

  if (!mcpName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: MCP name is required' }],
        isError: true,
      },
    };
  }

  if (!ctx.reconnectExternalMCP) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: Reconnection not supported in this context' }],
        isError: true,
      },
    };
  }

  try {
    const result = await ctx.reconnectExternalMCP(mcpName);

    if (result.success) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Successfully reconnected to external MCP "${mcpName}". Tools list will be updated.`,
            },
          ],
          isError: false,
        },
      };
    } else {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Failed to reconnect to "${mcpName}": ${result.error}` }],
          isError: true,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error reconnecting to "${mcpName}": ${message}` }],
        isError: true,
      },
    };
  }
}

interface StudioSupportFile {
  path: string;
  source: string;
}

function extractRelativeImportSpecifiers(source: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]?.trim();
      if (specifier?.startsWith('.')) matches.add(specifier);
    }
  }

  return Array.from(matches);
}

function resolveImportCandidates(fromPath: string, specifier: string): string[] {
  const basePath = resolve(dirname(fromPath), specifier);
  const hasExtension = extname(basePath).length > 0;
  const candidates = hasExtension
    ? [basePath]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.mts`,
        `${basePath}.cts`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        `${basePath}.cjs`,
        `${basePath}.d.ts`,
        join(basePath, 'index.ts'),
        join(basePath, 'index.tsx'),
        join(basePath, 'index.mts'),
        join(basePath, 'index.cts'),
        join(basePath, 'index.js'),
        join(basePath, 'index.d.ts'),
      ];

  return candidates.map((candidate) => normalize(candidate));
}

async function collectStudioSupportFiles(
  entryPath: string,
  source: string,
  workingDir?: string
): Promise<StudioSupportFile[]> {
  const supportFiles: StudioSupportFile[] = [];
  const visited = new Set<string>([normalize(entryPath)]);
  const queue: Array<{ path: string; source: string }> = [{ path: entryPath, source }];
  const maxFiles = 24;

  while (queue.length > 0 && supportFiles.length < maxFiles) {
    const current = queue.shift()!;
    for (const specifier of extractRelativeImportSpecifiers(current.source)) {
      const candidates = resolveImportCandidates(current.path, specifier);
      let resolvedPath: string | null = null;
      let resolvedSource: string | null = null;

      for (const candidate of candidates) {
        if (visited.has(candidate)) continue;
        try {
          const fileSource = await readFile(candidate, 'utf-8');
          resolvedPath = candidate;
          resolvedSource = fileSource;
          break;
        } catch {
          // Try next candidate extension
        }
      }

      if (!resolvedPath || resolvedSource == null) continue;

      visited.add(resolvedPath);
      supportFiles.push({ path: resolvedPath, source: resolvedSource });
      queue.push({ path: resolvedPath, source: resolvedSource });

      if (resolvedPath.endsWith('.photon.ts') || resolvedPath.endsWith('.photon.tsx')) {
        const declarationPath = await writePhotonEditorDeclaration(
          resolvedPath,
          resolvedSource,
          workingDir
        ).catch(() => null);
        if (declarationPath) {
          try {
            const declarationSource = await readFile(declarationPath, 'utf-8');
            if (!visited.has(normalize(declarationPath))) {
              visited.add(normalize(declarationPath));
              supportFiles.push({ path: declarationPath, source: declarationSource });
            }
          } catch {
            // Ignore missing generated declaration reads.
          }
        }
      }

      if (supportFiles.length >= maxFiles) break;
    }
  }

  return supportFiles;
}

async function buildStudioProjectPayload(
  photonPath: string,
  source: string,
  workingDir?: string
): Promise<{ declarationPath: string | null; supportFiles: StudioSupportFile[] }> {
  const declarationPath = await writePhotonEditorDeclaration(photonPath, source, workingDir).catch(
    () => null
  );
  const supportFiles = await collectStudioSupportFiles(photonPath, source, workingDir).catch(
    () => []
  );
  return { declarationPath, supportFiles };
}

/**
 * Handle beam/studio-read — read a photon source file for editing
 */
async function handleBeamStudioRead(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName } = args as { name: string };

  if (!photonName) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name is required' }],
        isError: true,
      },
    };
  }

  // Find the photon by name to get its file path
  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const source = await readFile(photon.path, 'utf-8');
    const { declarationPath, supportFiles } = await buildStudioProjectPayload(
      photon.path,
      source,
      ctx.workingDir
    );
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ source, path: photon.path, declarationPath, supportFiles }),
          },
        ],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error reading source: ${message}` }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/studio-write — write photon source and trigger hot-reload
 */
async function handleBeamStudioWrite(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName, source } = args as { name: string; source: string };

  if (!photonName || typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name and source are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    // Write source to disk
    await writeFile(photon.path, source, 'utf-8');
    const { declarationPath, supportFiles } = await buildStudioProjectPayload(
      photon.path,
      source,
      ctx.workingDir
    );

    // Parse the new source for preview
    let parseResult = null;
    try {
      const { SchemaExtractor } = await import('@portel/photon-core');
      const extractor = new SchemaExtractor();
      const { tools: schemas } = extractor.extractAllFromSource(source);
      const classMatch = source.match(/export\s+default\s+class\s+(\w+)/);
      const descMatch = source.match(/\/\*\*\s*\n\s*\*\s*(.+)/);
      const versionMatch = source.match(/@version\s+(\S+)/);
      const runtimeMatch = source.match(/@runtime\s+(\S+)/);
      const iconMatch = source.match(/@icon\s+(\S+)/);
      const statefulMatch = source.match(/@stateful\b/);
      const depsMatch = source.match(/@dependencies\s+(.+)/);
      const tagsMatch = source.match(/@tags\s+(.+)/);

      parseResult = {
        className: classMatch?.[1] || 'Unknown',
        description: descMatch?.[1]?.replace(/\s*\*\/$/, '').trim(),
        icon: iconMatch?.[1],
        version: versionMatch?.[1],
        runtime: runtimeMatch?.[1],
        stateful: !!statefulMatch,
        dependencies: depsMatch?.[1]
          ?.split(',')
          .map((d: string) => d.trim())
          .filter(Boolean),
        tags: tagsMatch?.[1]
          ?.split(',')
          .map((t: string) => t.trim())
          .filter(Boolean),
        methods: schemas
          .filter((s: any) => !['onInitialize', 'onShutdown', 'constructor'].includes(s.name))
          .map((s: any) => ({
            name: s.name,
            description: s.description,
            icon: s.icon,
            params: s.inputSchema,
            autorun: s.autorun,
            outputFormat: s.outputFormat,
            buttonLabel: s.buttonLabel,
            webhook: s.webhook,
            scheduled: s.scheduled || s.cron,
            locked: s.locked,
          })),
      };
    } catch {
      // Parse is best-effort — don't fail the write
    }

    // Trigger hot-reload if available. Studio writes go through the debounced
    // reload path so streamed saves coalesce with file watcher events.
    const useScheduledReload = !!ctx.schedulePhotonReload;
    const reloadPhoton = ctx.schedulePhotonReload || ctx.reloadPhoton;
    if (reloadPhoton) {
      try {
        const reloadResult = await reloadPhoton(photonName);
        if (!useScheduledReload && reloadResult.success && reloadResult.photon) {
          broadcastToBeam('beam/hot-reload', { photon: reloadResult.photon });
        }
      } catch {
        // Reload failure doesn't fail the write
      }
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, parseResult, declarationPath, supportFiles }),
          },
        ],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      },
    };
  }
}

async function handleBeamStudioProject(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { name: photonName, source } = args as { name: string; source: string };

  if (!photonName || typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name and source are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const payload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error resolving project context: ${message}` }],
        isError: true,
      },
    };
  }
}

async function handleBeamStudioApplyFiles(
  req: JSONRPCRequest,
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const {
    name: photonName,
    source,
    files,
  } = args as {
    name: string;
    source: string;
    files: Array<{ path: string; source: string }>;
  };

  if (!photonName || typeof source !== 'string' || !Array.isArray(files)) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: photon name, source, and files are required' }],
        isError: true,
      },
    };
  }

  const photon = ctx.photons.find((p) => p.name === photonName);
  if (!photon || !photon.path) {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: `Error: photon "${photonName}" not found or has no path` }],
        isError: true,
      },
    };
  }

  try {
    const payload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    const allowedPaths = new Set<string>([
      normalize(photon.path),
      ...payload.supportFiles.map((file) => normalize(file.path)),
    ]);

    for (const file of files) {
      if (!file || typeof file.path !== 'string' || typeof file.source !== 'string') {
        throw new Error('Each file update must include path and source');
      }
      const normalizedPath = normalize(file.path);
      if (!allowedPaths.has(normalizedPath)) {
        throw new Error(`Refusing to write unexpected file: ${file.path}`);
      }
    }

    for (const file of files) {
      await writeFile(file.path, file.source, 'utf-8');
      if (file.path.endsWith('.photon.ts') || file.path.endsWith('.photon.tsx')) {
        await writePhotonEditorDeclaration(file.path, file.source, ctx.workingDir).catch(
          () => null
        );
      }
    }

    const useScheduledReload = !!ctx.schedulePhotonReload;
    const reloadPhoton = ctx.schedulePhotonReload || ctx.reloadPhoton;
    if (reloadPhoton) {
      try {
        const reloadResult = await reloadPhoton(photonName);
        if (!useScheduledReload && reloadResult.success && reloadResult.photon) {
          broadcastToBeam('beam/hot-reload', { photon: reloadResult.photon });
        }
      } catch {
        // Best effort: don't fail the apply if hot-reload misses.
      }
    }

    const refreshedPayload = await buildStudioProjectPayload(photon.path, source, ctx.workingDir);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              declarationPath: refreshedPayload.declarationPath,
              supportFiles: refreshedPayload.supportFiles,
            }),
          },
        ],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }],
        isError: true,
      },
    };
  }
}

/**
 * Handle beam/studio-parse — parse photon source and return schema
 */
async function handleBeamStudioParse(
  req: JSONRPCRequest,
  args: Record<string, unknown>
): Promise<JSONRPCResponse> {
  const { source } = args as { source: string };

  if (typeof source !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: 'Error: source is required' }],
        isError: true,
      },
    };
  }

  try {
    const { SchemaExtractor } = await import('@portel/photon-core');
    const extractor = new SchemaExtractor();
    const { tools: schemas } = extractor.extractAllFromSource(source);

    const classMatch = source.match(/export\s+default\s+class\s+(\w+)/);
    const descMatch = source.match(/\/\*\*\s*\n\s*\*\s*(.+)/);
    const versionMatch = source.match(/@version\s+(\S+)/);
    const runtimeMatch = source.match(/@runtime\s+(\S+)/);
    const iconMatch = source.match(/@icon\s+(\S+)/);
    const statefulMatch = source.match(/@stateful\b/);
    const depsMatch = source.match(/@dependencies\s+(.+)/);
    const tagsMatch = source.match(/@tags\s+(.+)/);

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!classMatch) errors.push('No default export class found');
    if (!descMatch) warnings.push('Missing class description (first line in JSDoc)');

    const result = {
      className: classMatch?.[1] || 'Unknown',
      description: descMatch?.[1]?.replace(/\s*\*\/$/, '').trim(),
      icon: iconMatch?.[1],
      version: versionMatch?.[1],
      runtime: runtimeMatch?.[1],
      stateful: !!statefulMatch,
      dependencies: depsMatch?.[1]
        ?.split(',')
        .map((d: string) => d.trim())
        .filter(Boolean),
      tags: tagsMatch?.[1]
        ?.split(',')
        .map((t: string) => t.trim())
        .filter(Boolean),
      methods: schemas
        .filter((s: any) => !['onInitialize', 'onShutdown', 'constructor'].includes(s.name))
        .map((s: any) => ({
          name: s.name,
          description: s.description,
          icon: s.icon,
          params: s.inputSchema,
          autorun: s.autorun,
          outputFormat: s.outputFormat,
          buttonLabel: s.buttonLabel,
          webhook: s.webhook,
          scheduled: s.scheduled || s.cron,
          locked: s.locked,
        })),
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              className: 'Unknown',
              methods: [],
              errors: [`Parse error: ${message}`],
            }),
          },
        ],
        isError: false,
      },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ════════════════════════════════════════════════════════════════════════════════

export interface StreamableHTTPOptions {
  photons: AnyPhotonInfo[];
  photonMCPs: Map<string, PhotonInstance>;
  externalMCPs?: ExternalMCPInfo[];
  externalMCPClients?: Map<string, any>;
  externalMCPSDKClients?: Map<string, any>; // SDK clients for full CallToolResult support
  reconnectExternalMCP?: (name: string) => Promise<{ success: boolean; error?: string }>;
  loadUIAsset: (
    photonName: string,
    uiId: string
  ) => Promise<{
    content: string;
    isPhotonTemplate: boolean;
    compiled?: import('../tsx-compiler.js').CompiledTsx;
  } | null>;
  /** Working directory override (base dir for state/config/cache) */
  workingDir?: string;
  /** Expose unqualified names when this endpoint serves exactly one Photon. */
  singleServerNames?: boolean;
  /** Canonical externally visible MCP resource URI. */
  oauthResource?: string;
  /** Absolute RFC 9728 metadata URL used in Bearer challenges. */
  oauthResourceMetadataUrl?: string;
  /** Trusted verifier supplied by an embedding resource server. */
  verifyBearerToken?: (
    token: string,
    context: MCPBearerVerificationContext
  ) => Promise<MCPBearerVerificationResult>;
  configurePhoton?: (
    photonName: string,
    config: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  reloadPhoton?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  schedulePhotonReload?: (
    photonName: string
  ) => Promise<{ success: boolean; photon?: any; error?: string }>;
  removePhoton?: (photonName: string) => Promise<{ success: boolean; error?: string }>;
  updateMetadata?: (
    photonName: string,
    methodName: string | null,
    metadata: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>;
  generatePhotonHelp?: (photonName: string) => Promise<string>;
  loader?: {
    executeTool: (mcp: any, toolName: string, args: any, options?: any) => Promise<any>;
    getCapabilityContracts?: (mcp: any) => Array<{ name: string; exposure: ReadonlySet<string> }>;
  };
  broadcast?: (message: object) => void;
  subscriptionManager?: {
    onClientViewingBoard: (
      sessionId: string,
      photon: string,
      board: string,
      lastTimestamp?: number
    ) => void;
    onClientDisconnect: (sessionId: string) => void;
  };
}

/**
 * Handle MCP Streamable HTTP requests
 */
export async function handleStreamableHTTP(
  req: IncomingMessage,
  res: ServerResponse,
  options: StreamableHTTPOptions
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Only handle /mcp endpoint
  if (url.pathname !== '/mcp') {
    return false;
  }

  // CORS headers
  const corsOrigin = getCorsOrigin(req);
  if (req.headers.origin && !corsOrigin) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, message: 'Forbidden Origin header' },
      })
    );
    return true;
  }
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Content-Type',
      'Accept',
      'Mcp-Session-Id',
      'Mcp-Claim-Code',
      'Authorization',
      'Mcp-Protocol-Version',
      'Mcp-Method',
      'Mcp-Name',
      'Traceparent',
      'X-Photon-App-Session-Id',
      ...advertisedMCPParamHeaders(options.photons, options.externalMCPs),
    ].join(', ')
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Mcp-Session-Id, Mcp-Protocol-Version, X-Photon-App-Session-Id'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Default rate limit: per source IP, before any session or auth work.
  const clientKey = req.socket?.remoteAddress || 'unknown';
  if (!mcpRateLimiter.isAllowed(clientKey)) {
    const retryAfter = Math.ceil(MCP_RATE_WINDOW_MS / 1000);
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Too many requests',
          data: { limit: MCP_RATE_LIMIT, windowMs: MCP_RATE_WINDOW_MS },
        },
      })
    );
    return true;
  }

  // Get or create session
  // Check header first, then query parameter (for SSE which can't set headers)
  let sessionId = firstHeaderValue(req.headers['mcp-session-id']);
  if (!sessionId) {
    sessionId = url.searchParams.get('sessionId') || undefined;
  }
  const requestHeaderVersion = firstHeaderValue(req.headers['mcp-protocol-version']);
  const isStatelessRequest =
    req.method === 'POST' && requestHeaderVersion === MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28;
  // URL credentials are a legacy EventSource compatibility exception only.
  // They are never accepted for POST or MCP 2026 requests and never override
  // an Authorization header.
  const queryToken = url.searchParams.get('token');
  const hasAuthorizationHeader = req.headers.authorization !== undefined;
  const legacyEventSourceQueryToken =
    req.method === 'GET' &&
    requestHeaderVersion !== MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28 &&
    queryToken &&
    !hasAuthorizationHeader
      ? queryToken
      : null;
  if (req.method === 'GET' && queryToken && hasAuthorizationHeader) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ambiguous bearer credentials' }));
    return true;
  }
  if (requestHeaderVersion === MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28 && queryToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bearer tokens are not accepted in query parameters' }));
    return true;
  }
  const authHeader = legacyEventSourceQueryToken
    ? `Bearer ${legacyEventSourceQueryToken}`
    : req.headers.authorization;
  const hasUnsupportedProtocolHeader =
    req.method === 'POST' &&
    requestHeaderVersion !== undefined &&
    !isSupportedMCPProtocolVersion(requestHeaderVersion);
  const useEphemeralSession = isStatelessRequest || hasUnsupportedProtocolHeader;
  // Valid 2026 requests are deliberately backed by an ephemeral context, not
  // an entry in the legacy MCP session map. A stray Mcp-Session-Id is ignored
  // for this revision, as required by the backward-compatibility rules.
  const session = getOrCreateSession(
    useEphemeralSession ? undefined : sessionId,
    !useEphemeralSession
  );
  session.remoteAddress = req.socket?.remoteAddress || 'unknown';
  session.userAgent = req.headers['user-agent'] || '';

  // Claim-code scoping: if the client presents `Mcp-Claim-Code` (header
  // or query param for SSE), validate it on EVERY request and stamp
  // the allowed scopeDir onto the session. Re-validating per request
  // (rather than once at session init) means revoke + TTL expiry take
  // effect immediately on the next call — otherwise a scoped session
  // keeps its access after `photon claim revoke` or TTL, which would
  // defeat the point of short-lived codes.
  //
  // Absent or invalid codes leave the session unscoped (full access) —
  // claims are strictly additive, never a gate on unclaimed sessions.
  // See `src/daemon/claims.ts` for the store and the scoping contract.
  {
    const rawCode =
      (req.headers['mcp-claim-code'] as string | undefined) ||
      url.searchParams.get('claim') ||
      undefined;
    if (rawCode) {
      try {
        const { validateClaimSync } = await import('../daemon/claims.js');
        const result = validateClaimSync(rawCode);
        session.claimScopeDir = result.ok ? result.claim.scopeDir : undefined;
      } catch {
        // Claim store unreadable — fall through to unscoped access so
        // we don't hard-break when `.data/claims.json` is missing.
        session.claimScopeDir = undefined;
      }
    } else if (session.claimScopeDir) {
      // Session was previously scoped but the client stopped sending
      // the code. Treat the missing header as revocation.
      session.claimScopeDir = undefined;
    }
  }

  // GET - Open SSE stream for server notifications
  if (req.method === 'GET') {
    const requestProtocolVersion = firstHeaderValue(req.headers['mcp-protocol-version']);
    if (isStatelessMCPProtocolVersion(requestProtocolVersion)) {
      res.writeHead(405, { Allow: 'POST' });
      res.end('MCP 2026 uses POST subscriptions instead of a transport-level GET stream');
      return true;
    }

    const accept = req.headers.accept || '';
    if (!accept.includes('text/event-stream')) {
      res.writeHead(406);
      res.end('Accept header must include text/event-stream');
      return true;
    }

    const streamAuth = legacyStreamAuthorizationRequirements(options.photons);
    if (streamAuth.protected || authHeader !== undefined) {
      const resource = oauthResourceForRequest(req, options);
      const resourceMetadataUrl = oauthResourceMetadataForRequest(req, options, resource);
      const suppliedToken = bearerToken(authHeader);
      if (!suppliedToken || streamAuth.configurationError) {
        sendMCPAuthorizationFailure(res, {
          status: 401,
          reason: streamAuth.configurationError ? 'authorization_server_mismatch' : 'missing_token',
          resourceMetadataUrl,
          scopes: [],
        });
        return true;
      }
      const verify = options.verifyBearerToken ?? verifyConfiguredMCPBearer;
      const verification = await verify(suppliedToken, {
        resource,
        expectedIssuer: streamAuth.expectedIssuer,
        requiredScopes: [],
      });
      if (!verification.ok) {
        sendMCPAuthorizationFailure(res, {
          status: verification.reason === 'insufficient_scope' ? 403 : 401,
          reason: verification.reason,
          resourceMetadataUrl,
          scopes: [],
        });
        return true;
      }
      const verifiedCaller = callerFromVerifiedClaims(verification);
      if (session.caller && session.caller.id !== verifiedCaller.id) {
        sendMCPAuthorizationFailure(res, {
          status: 403,
          reason: 'session_principal_mismatch',
          resourceMetadataUrl,
          scopes: [],
        });
        return true;
      }
      session.caller = verifiedCaller;
    }

    const getWireAdapter = selectMCPWireAdapter(
      requestProtocolVersion ?? MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25,
      buildServerInfo()
    );
    res.writeHead(
      200,
      getWireAdapter.headers(
        {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no', // Disable nginx buffering
          ...(legacyEventSourceQueryToken
            ? {
                Warning:
                  '299 Photon "Bearer query tokens are deprecated; use a header-capable client"',
              }
            : {}),
        },
        session.id
      )
    );
    res.flushHeaders();

    // Disable Nagle's algorithm for immediate writes
    res.socket?.setNoDelay(true);

    // Enable TCP keepalive to prevent connection drops from intermediaries
    res.socket?.setKeepAlive(true, 60000);

    // Store SSE response for server-initiated messages
    closeSessionSSE(session, 'sse-replaced');
    session.sseResponse = res;
    session.sseOpenedAt = new Date();
    enforceSSESessionBudget(session);

    // Keep connection alive with SSE comments (every 15s). Comments are
    // silently dropped by all spec-compliant parsers including the MCP
    // SDK's EventSourceParserStream, so they don't clutter JSON-RPC
    // message routing. Prevents intermediary proxies (nginx) from closing
    // idle connections.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(': keepalive\n\n');
        } catch (err) {
          // If write fails, connection is dead - clean up
          clearInterval(keepAlive);
          closeSessionSSE(session, 'sse-keepalive-failed');
        }
      } else {
        clearInterval(keepAlive);
      }
    }, 15000); // Reduced from 30s to 15s for better responsiveness

    // Handle client disconnect
    const cleanup = () => {
      clearInterval(keepAlive);
      if (session.sseResponse === res) {
        session.sseResponse = undefined;
        session.sseOpenedAt = undefined;
      }
      // Reject any server→client requests still waiting on this
      // session. Without this, a disconnect during `sampling/createMessage`
      // leaves the pending entry alive until the 5-minute timeout,
      // and because Beam's sampling-modal serializes via a single
      // inFlight promise, the queue wedges for every later request
      // in that tab. Each pending entry carries the originating
      // sessionId so we can target precisely this session's work.
      for (const [id, pending] of pendingServerRequests) {
        if (pending.sessionId !== session.id) continue;
        if (pending.timer) clearTimeout(pending.timer);
        pendingServerRequests.delete(id);
        pending.reject(
          new Error(`requestSession: session ${session.id} disconnected before response`)
        );
      }
      // Clean up subscriptions when client disconnects
      if (options.subscriptionManager) {
        options.subscriptionManager.onClientDisconnect(session.id);
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);

    return true;
  }

  // POST - Handle JSON-RPC requests
  if (req.method === 'POST') {
    const accept = req.headers.accept || '';
    if (
      isStatelessRequest &&
      (!accept.includes('application/json') || !accept.includes('text/event-stream'))
    ) {
      res.writeHead(406);
      res.end('Accept header must include application/json and text/event-stream');
      return true;
    }
    if (
      isStatelessRequest &&
      !firstHeaderValue(req.headers['content-type'])?.toLowerCase().startsWith('application/json')
    ) {
      res.writeHead(415);
      res.end('Content-Type must be application/json');
      return true;
    }
    const wantsSSE = accept.includes('text/event-stream');
    const requestAbort = new AbortController();
    const abortRequest = () => requestAbort.abort();
    req.on('aborted', abortRequest);
    res.on('close', abortRequest);
    res.on('error', abortRequest);
    const sockets = new Set<NonNullable<typeof req.socket>>();
    if (req.socket) sockets.add(req.socket);
    if (res.socket) sockets.add(res.socket);
    for (const socket of sockets) {
      socket.on('close', abortRequest);
    }

    try {
      let responseStreamStarted = false;
      let responseWireAdapter = selectMCPWireAdapter(
        MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25,
        buildServerInfo()
      );

      const ensureResponseStream = () => {
        if (responseStreamStarted) return;
        const responseHeaders = responseWireAdapter.headers(
          {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
          session.id
        );
        res.writeHead(200, responseHeaders);
        res.socket?.setNoDelay(true);
        responseStreamStarted = true;
      };

      const sendResponseStreamMessage = (message: object) => {
        if (!wantsSSE || res.writableEnded || res.destroyed) return;
        ensureResponseStream();
        res.write(`data: ${JSON.stringify(message)}\n\n`);
      };

      // Bound the request before parsing or performing expensive validation.
      const declaredBodyLength = Number(req.headers['content-length']);
      if (Number.isFinite(declaredBodyLength) && declaredBodyLength > MAX_MCP_REQUEST_BODY_BYTES) {
        // Drain without buffering before ending the response. Ending while the
        // peer is still writing can make Node reset the socket before the
        // client receives the 413, which turns a deterministic protocol error
        // into an intermittent ECONNRESET.
        await new Promise<void>((resolveDrain) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolveDrain();
          };
          req.once('end', settle);
          req.once('aborted', settle);
          req.once('error', settle);
          req.resume();
        });
        if (req.aborted || res.destroyed) return true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
              message: 'MCP request body exceeds the size limit',
            },
          })
        );
        return true;
      }

      const bodyChunks: Buffer[] = [];
      let bodyBytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyBytes += buffer.length;
        if (bodyBytes > MAX_MCP_REQUEST_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
                message: 'MCP request body exceeds the size limit',
              },
            })
          );
          return true;
        }
        bodyChunks.push(buffer);
      }
      const body = Buffer.concat(bodyChunks, bodyBytes).toString('utf8');

      let parsedBody: unknown;
      let requests: JSONRPCRequest[];
      try {
        parsedBody = JSON.parse(body);
        requests = (Array.isArray(parsedBody) ? parsedBody : [parsedBody]) as JSONRPCRequest[];
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: JSON_RPC_ERROR_CODES.PARSE_ERROR, message: 'Parse error' },
          })
        );
        return true;
      }

      // Validate the complete wire request before selecting a client profile or
      // touching protocol session state. This makes a 2026 request entirely
      // self-describing and prevents legacy aliases from upgrading it.
      const requestValidationError = validateMCPRequestBatch(parsedBody, req.headers);
      if (requestValidationError) {
        res.writeHead(requestValidationError.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(requestValidationError.response));
        return true;
      }

      for (const request of requests) {
        const traceValidation = resolveRequestTracePropagation(request, req.headers);
        if (!traceValidation.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id:
                typeof request.id === 'string' || typeof request.id === 'number'
                  ? request.id
                  : null,
              error: {
                code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
                message: `Invalid ${traceValidation.field}`,
                data: {
                  field: traceValidation.field,
                  reason: traceValidation.reason,
                },
              },
            })
          );
          return true;
        }
      }

      const authRequirements = authorizationRequirements(
        requests,
        options.photons,
        options.externalMCPs
      );
      const suppliedToken = bearerToken(authHeader);
      let caller: CallerInfo | undefined;
      if (authRequirements.protected || authHeader !== undefined) {
        const resource = oauthResourceForRequest(req, options);
        const resourceMetadataUrl = oauthResourceMetadataForRequest(req, options, resource);
        if (!suppliedToken || authRequirements.configurationError) {
          sendMCPAuthorizationFailure(res, {
            status: 401,
            id: authRequirements.requestId,
            reason: authRequirements.configurationError
              ? 'authorization_server_mismatch'
              : 'missing_token',
            resourceMetadataUrl,
            scopes: authRequirements.requiredScopes,
          });
          return true;
        }
        const verify = options.verifyBearerToken ?? verifyConfiguredMCPBearer;
        const verification = await verify(suppliedToken, {
          resource,
          expectedIssuer: authRequirements.expectedIssuer,
          requiredScopes: authRequirements.requiredScopes,
        });
        if (!verification.ok) {
          const insufficientScope = verification.reason === 'insufficient_scope';
          sendMCPAuthorizationFailure(res, {
            status: insufficientScope ? 403 : 401,
            id: authRequirements.requestId,
            reason: verification.reason,
            resourceMetadataUrl,
            scopes: authRequirements.requiredScopes,
          });
          return true;
        }
        caller = callerFromVerifiedClaims(verification);
        if (!useEphemeralSession) {
          if (session.caller && session.caller.id !== caller.id) {
            sendMCPAuthorizationFailure(res, {
              status: 403,
              id: authRequirements.requestId,
              reason: 'session_principal_mismatch',
              resourceMetadataUrl,
              scopes: authRequirements.requiredScopes,
            });
            return true;
          }
          session.caller = caller;
        }
      }

      // MCP 2026 replaces the legacy transport-level GET/SSE channel with a
      // long-lived POST request. It must be a single request because the
      // request id is the subscription id and acknowledgement is the first
      // event on that stream.
      if (requests.length === 1 && requests[0]?.method === 'subscriptions/listen') {
        const subscriptionRequest = requests[0];
        const requestContext = resolvePhotonRequestContext({
          request: subscriptionRequest,
          session,
          headers: req.headers,
          caller,
        });
        if (!isStatelessMCPProtocolVersion(requestContext.protocolVersion)) {
          res.writeHead(405, { Allow: 'POST' });
          res.end('subscriptions/listen requires MCP 2026-07-28');
          return true;
        }
        if (subscriptionRequest.id === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32600, message: 'subscriptions/listen requires a request id' },
            })
          );
          return true;
        }
        if (!wantsSSE) {
          res.writeHead(406);
          res.end('Accept header must include text/event-stream for subscriptions/listen');
          return true;
        }

        const subscriptionParams = requestParamRecord(subscriptionRequest);
        if (!isRecord(subscriptionParams.notifications)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: subscriptionRequest.id,
              error: {
                code: -32602,
                message: 'subscriptions/listen requires a `notifications` filter object',
              },
            })
          );
          return true;
        }
        if (statelessSubscriptions.size >= MAX_STATELESS_SUBSCRIPTIONS) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: subscriptionRequest.id,
              error: {
                code: -32603,
                message: 'Maximum active MCP subscription streams reached',
              },
            })
          );
          return true;
        }

        const subscriptionWireAdapter = selectMCPWireAdapter(
          requestContext.protocolVersion,
          buildServerInfo()
        );
        const filterValidation = sanitizeStatelessSubscriptionFilters(
          subscriptionParams.notifications
        );
        if (!filterValidation.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: subscriptionRequest.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
                message: filterValidation.reason,
              },
            })
          );
          return true;
        }
        const filters = filterValidation.filters;
        const subscriptionPrincipal = buildCallerScopeBinding(caller, requestContext).principal;
        const principalSubscriptions = [...statelessSubscriptions].filter(
          (subscription) => subscription.principal === subscriptionPrincipal
        ).length;
        if (principalSubscriptions >= MAX_STATELESS_SUBSCRIPTIONS_PER_PRINCIPAL) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: subscriptionRequest.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                message: 'Maximum MCP subscription streams reached for caller',
              },
            })
          );
          return true;
        }
        const subscription: StatelessSubscription = {
          id: subscriptionRequest.id,
          filters,
          response: res,
          principal: subscriptionPrincipal,
          blocked: false,
          queuedPayloads: [],
          queuedBytes: 0,
        };
        if (filters.resourceSubscriptions?.length) {
          subscription.resourceSink = (uri: string) => {
            sendStatelessSubscriptionNotification(subscription, 'notifications/resources/updated', {
              uri,
            });
          };
          for (const uri of filters.resourceSubscriptions) {
            streamableSubscriptions.subscribe(subscription.resourceSink, uri);
          }
        }

        res.writeHead(
          200,
          subscriptionWireAdapter.headers(
            {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
            session.id
          )
        );
        res.socket?.setNoDelay(true);
        res.socket?.setKeepAlive(true, 60_000);
        statelessSubscriptions.add(subscription);
        // The acknowledgement must be the first SSE event.
        sendStatelessSubscriptionNotification(
          subscription,
          'notifications/subscriptions/acknowledged',
          {
            notifications: filters,
          }
        );
        subscription.keepalive = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            closeStatelessSubscription(subscription);
            return;
          }
          if (subscription.blocked) return;
          try {
            if (!res.write(': keepalive\n\n')) {
              markStatelessSubscriptionBlocked(subscription);
            }
          } catch {
            closeStatelessSubscription(subscription);
          }
        }, STATELESS_SUBSCRIPTION_KEEPALIVE_MS);
        subscription.keepalive.unref();
        const cleanup = () => {
          closeStatelessSubscription(subscription);
        };
        req.once('error', cleanup);
        req.once('aborted', cleanup);
        res.once('close', cleanup);
        res.once('error', cleanup);
        return true;
      }

      if (requests.some((request) => request.method === 'subscriptions/listen')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'subscriptions/listen must be sent as a single request',
            },
          })
        );
        return true;
      }

      const baseContext: HandlerContext = {
        photons: options.photons,
        photonMCPs: options.photonMCPs,
        externalMCPs: options.externalMCPs,
        externalMCPClients: options.externalMCPClients,
        externalMCPSDKClients: options.externalMCPSDKClients,
        reconnectExternalMCP: options.reconnectExternalMCP,
        loadUIAsset: options.loadUIAsset,
        configurePhoton: options.configurePhoton,
        reloadPhoton: options.reloadPhoton,
        schedulePhotonReload: options.schedulePhotonReload,
        removePhoton: options.removePhoton,
        updateMetadata: options.updateMetadata,
        generatePhotonHelp: options.generatePhotonHelp,
        loader: options.loader,
        broadcast: options.broadcast,
        responseStream: wantsSSE ? { send: sendResponseStreamMessage } : undefined,
        signal: requestAbort.signal,
        subscriptionManager: options.subscriptionManager,
        workingDir: options.workingDir,
        singleServerNames: options.singleServerNames,
        caller,
        wireAdapter: responseWireAdapter,
      };

      // Process requests
      const responses: JSONRPCResponse[] = [];
      let responseHTTPStatus = 200;
      const appendResponse = (response: JSONRPCResponse, wireAdapter: MCPWireAdapter) => {
        const adapted = adaptResponseForProtocol(response, wireAdapter);
        responseHTTPStatus = Math.max(responseHTTPStatus, adapted.httpStatus);
        responses.push(adapted.response);
      };

      for (const request of requests) {
        // Response to a server→client request: no method, has id, has
        // either result or error. Route to the pending-request map so
        // the samplingProvider / future server-initiated primitives see
        // the browser's reply. These never produce an outgoing response.
        //
        // SECURITY: the reply's session MUST match the session that
        // originated the server→client request. Ids are globally
        // monotonic (`srv-1`, `srv-2`, ...), so without a session cross
        // check, session A could POST a reply carrying session B's id
        // and inject a fabricated sampling result into B's photon.
        // Drop mismatched replies silently — the original timeout on
        // the pending entry stays the only way to fail legitimately.
        if (!request.method && request.id !== undefined) {
          const msg = request as unknown as {
            id: string | number;
            result?: unknown;
            error?: { message?: string; code?: number };
          };
          const pending = pendingServerRequests.get(msg.id);
          if (pending && pending.sessionId === session.id) {
            if (pending.timer) clearTimeout(pending.timer);
            pendingServerRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message || 'server→client request failed'));
            } else {
              pending.resolve(msg.result);
            }
          }
          continue;
        }

        const requestContext = resolvePhotonRequestContext({
          request,
          session,
          headers: req.headers,
          caller,
        });
        session.clientProfile = requestContext.client;
        const wireAdapter = selectMCPWireAdapter(requestContext.protocolVersion, buildServerInfo());
        responseWireAdapter = wireAdapter;

        if (wireAdapter.era === 'modern-2026') {
          const duplicateHeader = duplicateRawMCPHeader(req.rawHeaders);
          if (duplicateHeader) {
            appendResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code: MCP_2026_ERROR_CODES.HEADER_MISMATCH,
                  message: `Header mismatch: duplicate ${duplicateHeader}`,
                },
              },
              wireAdapter
            );
            continue;
          }

          if (
            request.method === 'tools/call' &&
            isRecord(request.params) &&
            typeof request.params.name === 'string'
          ) {
            const method =
              nativePhotonAndMethodForTool(request.params.name, options.photons)?.method ??
              methodInfoForTool(request.params.name, options.photons, options.externalMCPs);
            if (method) {
              const parsedBindings = parseMCPHeaderBindings(method.params);
              if (!parsedBindings.ok) {
                appendResponse(
                  {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
                      message: 'Tool routing header schema is invalid',
                    },
                  },
                  wireAdapter
                );
                continue;
              }
              const validation = validateMCPParamHeaders({
                bindings: parsedBindings.bindings,
                argumentsValue: request.params.arguments,
                rawHeaders: req.rawHeaders,
              });
              if (!validation.ok) {
                appendResponse(
                  {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                      code: MCP_2026_ERROR_CODES.HEADER_MISMATCH,
                      message: `Header mismatch: ${validation.issue}`,
                    },
                  },
                  wireAdapter
                );
                continue;
              }
            }
          }
        }

        if (
          isStatelessMCPProtocolVersion(requestContext.protocolVersion) &&
          LEGACY_ONLY_MCP_METHODS.has(request.method)
        ) {
          if (request.id !== undefined) {
            appendResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
                  message: `Method is not available in MCP ${requestContext.protocolVersion}: ${request.method}`,
                },
              },
              wireAdapter
            );
          }
          continue;
        }

        const handler = handlers[request.method];

        if (!handler) {
          if (request.id !== undefined) {
            appendResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
                  message: `Method not found: ${request.method}`,
                },
              },
              wireAdapter
            );
          }
          continue;
        }

        const handlerContext: HandlerContext = {
          ...baseContext,
          requestContext,
          clientProfile: requestContext.client,
          wireAdapter,
        };
        if (
          wireAdapter.era === 'modern-2026' &&
          requestContext.appSessionSource === 'explicit-meta' &&
          typeof requestContext.appSessionId === 'string'
        ) {
          const validation = appSessionStoreFor(handlerContext).validate(
            requestContext.appSessionId,
            buildAppSessionBinding(handlerContext)
          );
          if (!validation.ok) {
            appendResponse(
              {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code:
                    validation.reason === 'unavailable'
                      ? JSON_RPC_ERROR_CODES.INTERNAL_ERROR
                      : JSON_RPC_ERROR_CODES.INVALID_PARAMS,
                  message:
                    validation.reason === 'unavailable'
                      ? 'Application-session storage is unavailable'
                      : 'Invalid or expired Photon application-session handle',
                  ...(validation.reason === 'unavailable' ? { data: { retryable: true } } : {}),
                },
              },
              wireAdapter
            );
            continue;
          }
        }
        let rawResponse: JSONRPCResponse | undefined;
        let idempotencyClaimHash: string | undefined;
        if (
          wireAdapter.era === 'modern-2026' &&
          request.method === 'tools/call' &&
          isRecord(request.params)
        ) {
          const rawIdempotencyKey = requestMeta(request)[PHOTON_IDEMPOTENCY_META_KEY];
          if (rawIdempotencyKey !== undefined) {
            const toolName = request.params.name;
            const method =
              typeof toolName === 'string'
                ? methodInfoForTool(toolName, options.photons, options.externalMCPs)
                : undefined;
            if (
              requestContext.client.capabilities.photon !== true ||
              typeof rawIdempotencyKey !== 'string' ||
              !method ||
              method.hasGeneratorAsks === true ||
              method.destructiveHint === true
            ) {
              rawResponse = {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
                  message:
                    'Photon idempotency keys require the Photon extension and a non-interactive tool',
                },
              };
            } else {
              const normalizedToolName = toolName as string;
              const access = buildCallerScopeBinding(handlerContext.caller, requestContext);
              try {
                const claim = idempotencyStoreFor(handlerContext).claim(
                  rawIdempotencyKey,
                  {
                    ...access,
                    appSession:
                      requestContext.appSessionSource === 'explicit-meta'
                        ? hashInputStateValue(requestContext.appSessionId ?? '')
                        : '',
                    tool: normalizedToolName,
                    argumentsHash: hashInputStateValue(request.params.arguments ?? {}),
                  },
                  method.idempotentHint === true || method.readOnlyHint === true
                );
                if (claim.kind === 'cached') {
                  rawResponse =
                    isRecord(claim.response) && claim.response.jsonrpc === '2.0'
                      ? {
                          ...(claim.response as unknown as JSONRPCResponse),
                          id: request.id,
                        }
                      : {
                          jsonrpc: '2.0',
                          id: request.id,
                          error: {
                            code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                            message: 'Stored idempotent response is invalid',
                          },
                        };
                } else if (claim.kind === 'claimed') {
                  idempotencyClaimHash = claim.keyHash;
                } else {
                  rawResponse = {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                      code: MCP_2026_ERROR_CODES.DUPLICATE_REQUEST,
                      message:
                        claim.kind === 'mismatch'
                          ? 'Idempotency key is already bound to another request'
                          : claim.pending
                            ? 'An equivalent request is already in progress'
                            : 'Duplicate non-idempotent tool request rejected',
                      data: {
                        retryable:
                          claim.kind === 'duplicate' && claim.pending && claim.idempotent === true,
                      },
                    },
                  };
                }
              } catch (error) {
                rawResponse = {
                  jsonrpc: '2.0',
                  id: request.id,
                  error: {
                    code:
                      error instanceof TypeError
                        ? JSON_RPC_ERROR_CODES.INVALID_PARAMS
                        : JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                    message:
                      error instanceof TypeError
                        ? 'Invalid Photon idempotency key'
                        : 'Idempotency storage is unavailable',
                    ...(error instanceof TypeError ? {} : { data: { retryable: true } }),
                  },
                };
              }
            }
          }
        }
        if (!rawResponse) {
          try {
            rawResponse = await handler(request, session, handlerContext);
          } catch (error) {
            const reference = buildMCPErrorReference(request.id, requestContext.traceparent);
            audit({
              ts: new Date().toISOString(),
              event: 'mcp_internal_error',
              method: request.method,
              client: requestContext.client.clientName || 'unknown',
              error: sanitizePublicErrorMessage(error),
              ...reference,
            });
            rawResponse = {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                message: 'Internal Photon failure',
                data: {
                  [PHOTON_TOOL_ERROR_META_KEY]: {
                    code: 'PHOTON_INTERNAL_FAILURE',
                    ...reference,
                  },
                },
              },
            };
          }
        }
        if (idempotencyClaimHash) {
          try {
            idempotencyStoreFor(handlerContext).complete(idempotencyClaimHash, rawResponse);
          } catch {
            rawResponse = {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
                message: 'Tool outcome could not be committed to idempotency storage',
                data: { retryable: false, outcome: 'unknown' },
              },
            };
          }
        }
        const extensionSafeResponse = sanitizeModernExtensionResponse(
          rawResponse,
          requestContext.client
        );
        const adapted = adaptResponseForProtocol(extensionSafeResponse, wireAdapter);
        responseHTTPStatus = Math.max(responseHTTPStatus, adapted.httpStatus);
        const response = adapted.response;

        // Only include responses for requests (not notifications)
        if (request.id !== undefined && response.id !== undefined) {
          responses.push(response);
        }
      }

      // Send response
      if (responses.length === 0) {
        // All were notifications
        if (responseStreamStarted) {
          res.end();
        } else {
          res.writeHead(202);
          res.end();
        }
      } else if (wantsSSE && responseHTTPStatus === 200) {
        // SSE response
        ensureResponseStream();

        for (const response of responses) {
          sendResponseStreamMessage(response);
        }
        res.end();
      } else {
        // JSON response
        const responseHeaders = responseWireAdapter.headers(
          { 'Content-Type': 'application/json' },
          session.id
        );
        res.writeHead(responseHTTPStatus, responseHeaders);

        const result = responses.length === 1 ? responses[0] : responses;
        res.end(JSON.stringify(result));
      }

      return true;
    } finally {
      res.off('close', abortRequest);
      res.off('error', abortRequest);
      req.off('aborted', abortRequest);
      for (const socket of sockets) {
        socket.off('close', abortRequest);
      }
    }
  }

  // Method not allowed
  res.writeHead(405);
  res.end('Method not allowed');
  return true;
}

/**
 * Send a notification to all connected SSE clients
 * @param method - The notification method name
 * @param params - Optional parameters for the notification
 * @param beamOnly - If true, only send to Beam clients (clientInfo.name === "beam")
 */
export function broadcastNotification(
  method: string,
  params?: Record<string, unknown>,
  beamOnly = false
): void {
  // MCP 2026 deliveries are limited to the explicitly opted-in filter set.
  // The 2025 session stream below intentionally remains unchanged.
  broadcastToStatelessSubscriptions(method, params);

  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };

  const data = `data: ${JSON.stringify(notification)}\n\n`;
  const deadSessions: string[] = [];

  for (const [sessionId, session] of sessions) {
    if (
      session.sseResponse &&
      !session.sseResponse.writableEnded &&
      !session.sseResponse.destroyed
    ) {
      // Skip non-Beam clients if beamOnly is true
      if (beamOnly && !session.isBeam) continue;
      try {
        session.sseResponse.write(data);
      } catch (err) {
        // Mark session for cleanup if write fails
        deadSessions.push(sessionId);
      }
    } else if (session.sseResponse) {
      // Response is ended/destroyed - mark for cleanup
      deadSessions.push(sessionId);
    }
  }

  // Clean up dead sessions
  for (const sessionId of deadSessions) {
    const session = sessions.get(sessionId);
    if (session) {
      closeSessionSSE(session, 'sse-dead-session');
    }
  }
}

/**
 * Invalidate every cacheable registry projection after a Photon registry
 * mutation. A single Photon change can affect its tools, prompts, resources,
 * and resource templates, so all advertised listChanged capabilities must
 * have an active producer.
 */
export function broadcastMCPListChanges(): void {
  broadcastNotification('notifications/tools/list_changed');
  broadcastNotification('notifications/prompts/list_changed');
  broadcastNotification('notifications/resources/list_changed');
}

/**
 * Send a notification to Beam clients only
 */
export function broadcastToBeam(method: string, params?: Record<string, unknown>): void {
  broadcastNotification(method, params, true);
}

// ── Task status change notifications (MCP 2025-11-25) ──
taskEvents.on('stateChange', (_taskId: string, _newState: string, task: any) => {
  // The legacy transport-level broadcast has no per-principal authorization
  // channel. Never leak modern extension tasks through it; WP9 owns the
  // request-scoped, task-id-filtered subscriptions/listen producer.
  if (task?.protocol === 'extension-2026') return;
  broadcastNotification(
    'notifications/tasks/status',
    toWireFormat(task) as unknown as Record<string, unknown>
  );
});

/**
 * Get count of active sessions (for debugging)
 */
export function getActiveSessionCount(): { total: number; beam: number } {
  let total = 0;
  let beam = 0;
  for (const session of sessions.values()) {
    if (session.sseResponse && !session.sseResponse.writableEnded) {
      total++;
      if (session.isBeam) beam++;
    }
  }
  return { total, beam };
}

/**
 * Send a notification to a specific session by ID
 * Used for replaying missed events on reconnect
 */
export function sendToSession(
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): boolean {
  const session = sessions.get(sessionId);
  if (!session?.sseResponse || session.sseResponse.writableEnded || session.sseResponse.destroyed) {
    return false;
  }
  const notification: JSONRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };
  try {
    session.sseResponse.write(`data: ${JSON.stringify(notification)}\n\n`);
    return true;
  } catch (err) {
    // Write failed - connection is dead
    closeSessionSSE(session, 'sse-notification-failed');
    return false;
  }
}

/**
 * Request elicitation from the frontend for an external MCP.
 * This is used when external MCP servers send elicitation/create requests.
 *
 * @param mcpName - Name of the external MCP requesting elicitation
 * @param request - The elicitation request params from the MCP server
 * @returns Promise resolving to the user's response
 */
export function requestExternalElicitation(
  mcpName: string,
  request: {
    mode: 'form' | 'url';
    message: string;
    requestedSchema?: any;
    url?: string;
  }
): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: any }> {
  const elicitationId = randomUUID();

  return new Promise((resolve) => {
    const pending: PendingElicitation = {
      resolve: (value: any) => {
        resolve({ action: 'accept', content: value });
      },
      reject: (error: Error) => {
        if (error.message.includes('cancelled')) {
          resolve({ action: 'cancel' });
        } else {
          resolve({ action: 'decline' });
        }
      },
      sessionId: '',
      photonName: mcpName,
      methodName: 'elicitation',
      message: request.message,
    };
    pendingElicitations.set(elicitationId, pending);

    // Broadcast elicitation request to all Beam clients
    broadcastToBeam('beam/elicitation', {
      elicitationId,
      mcpName,
      message: request.message,
      mode: request.mode,
      schema: request.requestedSchema,
      url: request.url,
    });

    // Two-phase timeout: 30s modal → pending queue → 30min expiry. The SSE
    // heartbeat keeps the connection alive while the user is deciding.
    setupElicitationTimeout(elicitationId, pending, resolve);
  });
}

/**
 * Request elicitation from Beam using Photon-native ask types (select, text, etc.)
 * Unlike requestExternalElicitation which uses MCP form/url mode, this sends
 * the ask type directly so the elicitation modal renders the appropriate UI.
 */
function requestBeamElicitation(
  data: {
    ask: 'select' | 'text' | 'confirm' | 'number';
    message: string;
    description?: string;
    photonName?: string;
    methodName?: string;
    methodTitle?: string;
    risk?: 'destructive' | 'default';
    _meta?: Record<string, unknown>;
    options?: Array<{ value: string; label: string; selected?: boolean; description?: string }>;
    placeholder?: string;
    default?: any;
  },
  context?: { photonName?: string; methodName?: string }
): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: any }> {
  const elicitationId = randomUUID();

  return new Promise((resolve) => {
    const pending: PendingElicitation = {
      resolve: (value: any) => {
        resolve({ action: 'accept', content: value });
      },
      reject: (error: Error) => {
        if (error.message.includes('cancelled')) {
          resolve({ action: 'cancel' });
        } else {
          resolve({ action: 'decline' });
        }
      },
      sessionId: '',
      photonName: context?.photonName,
      methodName: context?.methodName,
      message: data.message,
    };
    pendingElicitations.set(elicitationId, pending);

    // Broadcast with Photon-native ask format (not MCP form mode)
    broadcastToBeam('beam/elicitation', {
      elicitationId,
      photonName: context?.photonName,
      methodName: context?.methodName,
      ...data,
    });

    // Two-phase timeout: 30s modal → pending queue → 30min expiry. The SSE
    // heartbeat keeps the connection alive while the user is deciding.
    setupElicitationTimeout(elicitationId, pending, resolve);
  });
}
