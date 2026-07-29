import {
  buildLegacyMCPDiscoveryResult,
  buildLegacyMCPServerCapabilities,
  buildModernMCPDiscoveryResult,
  buildModernMCPServerCapabilities,
  type MCPDiscoveryOptions,
  type MCPServerCapabilityOptions,
  type MCPServerInfo,
} from './capabilities.js';
import { JSON_RPC_ERROR_CODES, MCP_2026_ERROR_CODES } from './errors.js';
import { isStatelessMCPProtocolVersion } from './versions.js';
import { isFiniteJSONValue } from './json-schema.js';
import type { MCPInputRequests } from './input-required.js';

export type MCPRequestId = string | number;

export interface MCPWireResponse {
  jsonrpc: '2.0';
  id?: MCPRequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPWireNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface CanonicalToolErrorPayload extends Record<string, unknown> {
  isError: true;
  content?: unknown[];
}

export interface CanonicalInputRequiredPayload extends Record<string, unknown> {
  resultType: 'input_required';
  inputRequests?: MCPInputRequests;
  requestState?: string;
}

export interface CanonicalTaskPayload extends Record<string, unknown> {
  resultType: 'task';
  taskId: string;
  status: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
}

export type CanonicalMCPResult =
  | { kind: 'complete'; value: unknown }
  | { kind: 'tool-error'; value: CanonicalToolErrorPayload }
  | { kind: 'input-required'; value: CanonicalInputRequiredPayload }
  | { kind: 'task'; value: CanonicalTaskPayload }
  | { kind: 'extension'; resultType: string; value: unknown };

export type CanonicalMCPResponse =
  | {
      kind: 'success';
      id?: MCPRequestId;
      result: CanonicalMCPResult;
    }
  | {
      kind: 'protocol-error';
      id?: MCPRequestId;
      error: NonNullable<MCPWireResponse['error']>;
    }
  | {
      kind: 'notification';
    };

export type MCPResponseContentType = 'application/json' | 'text/event-stream';

export interface MCPWireAdapter {
  readonly era: 'legacy-2025' | 'modern-2026';
  capabilities(options: MCPServerCapabilityOptions): Record<string, unknown>;
  discovery(options: MCPDiscoveryOptions): Record<string, unknown>;
  response(response: CanonicalMCPResponse): MCPWireResponse;
  httpStatus(response: CanonicalMCPResponse): number;
  notification(method: string, params?: Record<string, unknown>): MCPWireNotification;
  headers(base: Record<string, string>, legacySessionId?: string): Record<string, string>;
  includesStructuredContent(value: unknown): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled canonical MCP response: ${JSON.stringify(value)}`);
}

export function canonicalizeMCPResponse(response: MCPWireResponse): CanonicalMCPResponse {
  if (response.error) {
    return {
      kind: 'protocol-error',
      ...(response.id !== undefined ? { id: response.id } : {}),
      error: response.error,
    };
  }
  if (response.result === undefined) return { kind: 'notification' };

  const value = response.result;
  const resultType =
    isRecord(value) && typeof value.resultType === 'string' ? value.resultType : undefined;
  let result: CanonicalMCPResult;
  if (resultType === 'input_required') {
    result = {
      kind: 'input-required',
      value: value as CanonicalInputRequiredPayload,
    };
  } else if (resultType === 'task') {
    result = {
      kind: 'task',
      value: value as CanonicalTaskPayload,
    };
  } else if (resultType && resultType !== 'complete') {
    result = { kind: 'extension', resultType, value };
  } else if (isRecord(value) && value.isError === true) {
    result = { kind: 'tool-error', value: value as CanonicalToolErrorPayload };
  } else {
    result = { kind: 'complete', value };
  }

  return {
    kind: 'success',
    ...(response.id !== undefined ? { id: response.id } : {}),
    result,
  };
}

function resultTypeFor(result: CanonicalMCPResult): string {
  switch (result.kind) {
    case 'complete':
    case 'tool-error':
      return 'complete';
    case 'input-required':
      return 'input_required';
    case 'task':
      return 'task';
    case 'extension':
      return result.resultType;
    default:
      return assertNever(result);
  }
}

function renderLegacyResponse(response: CanonicalMCPResponse): MCPWireResponse {
  switch (response.kind) {
    case 'notification':
      return { jsonrpc: '2.0' };
    case 'protocol-error':
      return {
        jsonrpc: '2.0',
        ...(response.id !== undefined ? { id: response.id } : {}),
        error: response.error,
      };
    case 'success':
      return {
        jsonrpc: '2.0',
        ...(response.id !== undefined ? { id: response.id } : {}),
        result: response.result.value,
      };
    default:
      return assertNever(response);
  }
}

function renderModernResponse(
  response: CanonicalMCPResponse,
  serverInfo: MCPServerInfo
): MCPWireResponse {
  switch (response.kind) {
    case 'notification':
      return { jsonrpc: '2.0' };
    case 'protocol-error':
      return {
        jsonrpc: '2.0',
        ...(response.id !== undefined ? { id: response.id } : {}),
        error: response.error,
      };
    case 'success': {
      const value = isRecord(response.result.value)
        ? response.result.value
        : { value: response.result.value };
      const meta = isRecord(value._meta) ? value._meta : {};
      return {
        jsonrpc: '2.0',
        ...(response.id !== undefined ? { id: response.id } : {}),
        result: {
          ...value,
          resultType:
            typeof value.resultType === 'string'
              ? value.resultType
              : resultTypeFor(response.result),
          _meta: {
            ...meta,
            'io.modelcontextprotocol/serverInfo':
              meta['io.modelcontextprotocol/serverInfo'] ?? serverInfo,
          },
        },
      };
    }
    default:
      return assertNever(response);
  }
}

function legacyAdapter(_serverInfo: MCPServerInfo): MCPWireAdapter {
  return {
    era: 'legacy-2025',
    capabilities: buildLegacyMCPServerCapabilities,
    discovery: buildLegacyMCPDiscoveryResult,
    response: renderLegacyResponse,
    httpStatus: () => 200,
    notification: (method, params) => ({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    }),
    headers(base, legacySessionId) {
      return {
        ...base,
        ...(legacySessionId ? { 'Mcp-Session-Id': legacySessionId } : {}),
      };
    },
    includesStructuredContent: (value) => isRecord(value),
  };
}

function modernAdapter(serverInfo: MCPServerInfo): MCPWireAdapter {
  return {
    era: 'modern-2026',
    capabilities: buildModernMCPServerCapabilities,
    discovery: buildModernMCPDiscoveryResult,
    response: (response) => renderModernResponse(response, serverInfo),
    httpStatus(response) {
      if (response.kind !== 'protocol-error') return 200;
      if (response.error.code === JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND) return 404;
      if (response.error.code === MCP_2026_ERROR_CODES.DUPLICATE_REQUEST) return 409;
      if (response.error.code === JSON_RPC_ERROR_CODES.INTERNAL_ERROR) return 500;
      if (
        response.error.code === JSON_RPC_ERROR_CODES.PARSE_ERROR ||
        response.error.code === JSON_RPC_ERROR_CODES.INVALID_REQUEST ||
        response.error.code === JSON_RPC_ERROR_CODES.INVALID_PARAMS ||
        response.error.code === MCP_2026_ERROR_CODES.HEADER_MISMATCH ||
        response.error.code === MCP_2026_ERROR_CODES.MISSING_REQUIRED_CLIENT_CAPABILITY ||
        response.error.code === MCP_2026_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION
      ) {
        return 400;
      }
      return 200;
    },
    notification: (method, params) => ({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    }),
    headers: (base) => ({ ...base }),
    includesStructuredContent: isFiniteJSONValue,
  };
}

export function selectMCPWireAdapter(
  protocolVersion: unknown,
  serverInfo: MCPServerInfo
): MCPWireAdapter {
  return isStatelessMCPProtocolVersion(protocolVersion)
    ? modernAdapter(serverInfo)
    : legacyAdapter(serverInfo);
}
