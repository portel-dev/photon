import type { IncomingHttpHeaders } from 'http';
import {
  JSON_RPC_ERROR_CODES,
  getMCPProtocolErrorDefinition,
  type MCPProtocolErrorKind,
} from './errors.js';
import {
  MCP_PROTOCOL_VERSIONS,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  isStatelessMCPProtocolVersion,
  isSupportedMCPProtocolVersion,
} from './versions.js';
import {
  MCP_TASKS_EXTENSION_ID,
  MCP_UI_EXTENSION_ID,
  validateModernClientExtensions,
} from './extensions.js';
import { decodeMCPHeaderValue } from './routing-headers.js';

export interface MCPRequestLike {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface MCPValidationError {
  statusCode: 400 | 404;
  response: {
    jsonrpc: '2.0';
    id?: string | number;
    error: { code: number; message: string; data?: Record<string, unknown> };
  };
}

export { MCP_2026_ERROR_CODES } from './errors.js';
const MAX_META_DEPTH = 8;
const MAX_META_KEYS = 128;
const MAX_META_COLLECTION_ITEMS = 256;
const MAX_META_STRING_LENGTH = 4_096;
const NAMED_METHODS = new Set([
  'tools/call',
  'resources/read',
  'prompts/get',
  'tasks/get',
  'tasks/update',
  'tasks/cancel',
]);
const REMOVED_2026_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'resources/subscribe',
  'resources/unsubscribe',
  'ping',
  'logging/setLevel',
  'tasks/create',
  'tasks/list',
  'tasks/result',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function idFrom(request: MCPRequestLike): string | number | undefined {
  return typeof request.id === 'string' || typeof request.id === 'number' ? request.id : undefined;
}

function error(
  request: MCPRequestLike,
  code: number,
  message: string,
  data?: Record<string, unknown>,
  statusCode: MCPValidationError['statusCode'] = 400
): MCPValidationError {
  return {
    statusCode,
    response: {
      jsonrpc: '2.0',
      ...(idFrom(request) !== undefined ? { id: idFrom(request) } : {}),
      error: { code, message, ...(data ? { data } : {}) },
    },
  };
}

function definedError(
  request: MCPRequestLike,
  kind: MCPProtocolErrorKind,
  message: string,
  data?: Record<string, unknown>
): MCPValidationError {
  const definition = getMCPProtocolErrorDefinition(kind);
  if (definition.httpStatus === 500 || definition.httpStatus === 409) {
    throw new Error(`Validation cannot emit internal error: ${kind}`);
  }
  return error(request, definition.code, message, data, definition.httpStatus);
}

function bounded(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.length <= MAX_META_STRING_LENGTH;
  if (Array.isArray(value)) {
    return (
      depth < MAX_META_DEPTH &&
      value.length <= MAX_META_COLLECTION_ITEMS &&
      value.every((item) => bounded(item, depth + 1))
    );
  }
  if (!isRecord(value)) return value === null || typeof value !== 'object';
  if (depth >= MAX_META_DEPTH || Object.keys(value).length > MAX_META_KEYS) return false;
  return Object.values(value).every((item) => bounded(item, depth + 1));
}

function metaOf(request: MCPRequestLike): Record<string, unknown> | undefined {
  return isRecord(request.params) && isRecord(request.params._meta)
    ? request.params._meta
    : undefined;
}

function namedValue(request: MCPRequestLike): string | undefined {
  if (!isRecord(request.params)) return undefined;
  const value = request.params.name ?? request.params.uri ?? request.params.taskId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function invalidNamedMethodParams(request: MCPRequestLike): string | undefined {
  if (typeof request.method !== 'string' || !NAMED_METHODS.has(request.method)) return undefined;
  if (!isRecord(request.params)) return `${request.method} requires object params`;

  if (request.method === 'tools/call') {
    if (typeof request.params.name !== 'string' || !request.params.name.trim()) {
      return 'tools/call requires a non-empty tool name';
    }
    if (request.params.arguments !== undefined && !isRecord(request.params.arguments)) {
      return 'tools/call arguments must be an object';
    }
    return undefined;
  }

  if (request.method === 'resources/read') {
    return typeof request.params.uri === 'string' && request.params.uri.trim()
      ? undefined
      : 'resources/read requires a non-empty uri';
  }

  if (request.method === 'prompts/get') {
    if (typeof request.params.name !== 'string' || !request.params.name.trim()) {
      return 'prompts/get requires a non-empty prompt name';
    }
    if (request.params.arguments !== undefined && !isRecord(request.params.arguments)) {
      return 'prompts/get arguments must be an object';
    }
    return undefined;
  }

  if (typeof request.params.taskId !== 'string' || !request.params.taskId.trim()) {
    return `${request.method} requires a non-empty taskId`;
  }
  if (
    request.method === 'tasks/update' &&
    (!isRecord(request.params.inputResponses) || !bounded(request.params.inputResponses))
  ) {
    return 'tasks/update requires a bounded inputResponses object';
  }
  return undefined;
}

function unsupportedProtocolVersion(
  request: MCPRequestLike,
  requested: string
): MCPValidationError {
  return definedError(request, 'unsupported-protocol-version', 'Unsupported protocol version', {
    supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
    requested,
  });
}

function headerMismatch(request: MCPRequestLike, message: string): MCPValidationError {
  return definedError(request, 'header-mismatch', `Header mismatch: ${message}`);
}

function methodNotFound(request: MCPRequestLike): MCPValidationError {
  const definition = getMCPProtocolErrorDefinition('method-not-found');
  if (definition.httpStatus !== 404) {
    throw new Error('Method-not-found must map to HTTP 404');
  }
  return {
    statusCode: definition.httpStatus,
    response: {
      jsonrpc: '2.0',
      ...(idFrom(request) !== undefined ? { id: idFrom(request) } : {}),
      error: {
        code: definition.code,
        message: `Method is not available in MCP 2026: ${String(request.method)}`,
      },
    },
  };
}

function requiredCapabilitiesForRequest(
  request: MCPRequestLike
): Record<string, unknown> | undefined {
  // Extension requirements belong to named extension operations, rather than to
  // arbitrary metadata. Keep this table narrow so a client is never rejected for
  // declaring an optional extension it does not use on this request.
  if (typeof request.method === 'string' && request.method.startsWith('tasks/')) {
    return { extensions: { [MCP_TASKS_EXTENSION_ID]: {} } };
  }
  if (
    request.method === 'resources/read' &&
    isRecord(request.params) &&
    typeof request.params.uri === 'string' &&
    request.params.uri.startsWith('ui://')
  ) {
    return {
      extensions: {
        [MCP_UI_EXTENSION_ID]: {
          mimeTypes: ['text/html;profile=mcp-app'],
        },
      },
    };
  }
  return undefined;
}

/**
 * Validation is deliberately a pre-dispatch transport concern. It only treats a
 * request as 2026 when the canonical body field or an exact 2026 header says so;
 * old aliases must never upgrade a 2025 request.
 */
export function validateMCPRequestBatch(
  rawBody: unknown,
  headers: IncomingHttpHeaders
): MCPValidationError | null {
  const headerVersion = firstHeaderValue(headers['mcp-protocol-version']);
  const headerMethod = firstHeaderValue(headers['mcp-method']);

  const rawRequests = Array.isArray(rawBody) ? rawBody : [rawBody];
  for (const rawRequest of rawRequests) {
    const request = isRecord(rawRequest) ? rawRequest : {};
    if (headerVersion !== undefined && !isSupportedMCPProtocolVersion(headerVersion)) {
      return unsupportedProtocolVersion(request, headerVersion);
    }
    const meta = metaOf(request);
    const bodyVersion = meta?.['io.modelcontextprotocol/protocolVersion'];
    if (headerVersion && bodyVersion !== undefined && headerVersion !== bodyVersion) {
      return headerMismatch(request, 'MCP-Protocol-Version does not match request metadata');
    }
    if (bodyVersion !== undefined && typeof bodyVersion !== 'string') {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Protocol version metadata must be a string'
      );
    }
    if (typeof bodyVersion === 'string' && !isSupportedMCPProtocolVersion(bodyVersion)) {
      return unsupportedProtocolVersion(request, bodyVersion);
    }
    const is2026 =
      isStatelessMCPProtocolVersion(bodyVersion) ||
      headerVersion === MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28;
    if (!is2026) continue;

    if (Array.isArray(rawBody))
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        'JSON-RPC batches are not supported by MCP 2026'
      );
    if (
      !isRecord(rawRequest) ||
      rawRequest.jsonrpc !== '2.0' ||
      typeof rawRequest.method !== 'string'
    ) {
      return error(request, JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request');
    }
    if (request.id !== undefined && idFrom(request) === undefined) {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        'MCP 2026 request id must be a string or number'
      );
    }
    if (!meta || !bounded(meta))
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'MCP 2026 request metadata exceeds protocol limits'
      );
    if (bodyVersion !== MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28) {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'MCP 2026 requires _meta.io.modelcontextprotocol/protocolVersion'
      );
    }
    if (headerVersion === undefined) {
      return headerMismatch(request, 'MCP-Protocol-Version header is required for MCP 2026');
    }
    const clientInfo = meta['io.modelcontextprotocol/clientInfo'];
    if (
      clientInfo !== undefined &&
      (!isRecord(clientInfo) ||
        typeof clientInfo.name !== 'string' ||
        !clientInfo.name.trim() ||
        typeof clientInfo.version !== 'string' ||
        !clientInfo.version.trim())
    ) {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'MCP 2026 clientInfo, when present, must contain name and version'
      );
    }
    const capabilities = meta['io.modelcontextprotocol/clientCapabilities'];
    if (!isRecord(capabilities)) {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'MCP 2026 requires _meta.io.modelcontextprotocol/clientCapabilities'
      );
    }
    const extensionValidation = validateModernClientExtensions(capabilities);
    if (!extensionValidation.ok) {
      return error(
        request,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        extensionValidation.message || 'Invalid MCP 2026 extension settings'
      );
    }
    const invalidParamsMessage = invalidNamedMethodParams(request);
    if (invalidParamsMessage) {
      return error(request, JSON_RPC_ERROR_CODES.INVALID_PARAMS, invalidParamsMessage);
    }
    if (isRecord(request.params)) {
      const isTaskUpdate = request.method === 'tasks/update';
      const requestState = request.params.requestState;
      const inputResponses = request.params.inputResponses;
      if (
        requestState !== undefined &&
        (typeof requestState !== 'string' ||
          requestState.length === 0 ||
          requestState.length > 4_096)
      ) {
        return error(
          request,
          JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          'requestState must be a bounded non-empty string'
        );
      }
      if (inputResponses !== undefined && (!isRecord(inputResponses) || !bounded(inputResponses))) {
        return error(
          request,
          JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          'inputResponses must be a bounded response map'
        );
      }
      if (!isTaskUpdate && inputResponses !== undefined && requestState === undefined) {
        return error(
          request,
          JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          'inputResponses requires requestState'
        );
      }
      if (
        (requestState !== undefined || (!isTaskUpdate && inputResponses !== undefined)) &&
        request.id === undefined
      ) {
        return error(
          request,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          'A multi-round retry requires a JSON-RPC id'
        );
      }
    }
    if (!headerMethod) {
      return headerMismatch(request, 'Mcp-Method header is required for MCP 2026');
    }
    if (headerMethod !== request.method) {
      return headerMismatch(request, 'Mcp-Method header does not match request method');
    }
    const rawHeaderName = firstHeaderValue(headers['mcp-name']);
    const headerName =
      rawHeaderName === undefined ? undefined : decodeMCPHeaderValue(rawHeaderName);
    const declaredName = namedValue(request);
    if (rawHeaderName !== undefined && headerName === null) {
      return headerMismatch(request, 'Mcp-Name header is malformed');
    }
    if (NAMED_METHODS.has(request.method) && headerName === undefined) {
      return headerMismatch(request, `Mcp-Name header is required for ${request.method}`);
    }
    if (headerName !== undefined && headerName !== declaredName) {
      return headerMismatch(request, 'Mcp-Name header does not match request name');
    }
    if (REMOVED_2026_METHODS.has(request.method)) return methodNotFound(request);

    const declaredExtensions = isRecord(capabilities.extensions) ? capabilities.extensions : {};
    const requiredCapabilities = requiredCapabilitiesForRequest(request);
    const requiredExtensions = isRecord(requiredCapabilities?.extensions)
      ? requiredCapabilities.extensions
      : {};
    const missingExtension = Object.keys(requiredExtensions).some(
      (name) => !Object.prototype.hasOwnProperty.call(declaredExtensions, name)
    );
    if (missingExtension && requiredCapabilities) {
      return definedError(
        request,
        'missing-required-client-capability',
        'Missing required client capability',
        { requiredCapabilities }
      );
    }
  }
  return null;
}
