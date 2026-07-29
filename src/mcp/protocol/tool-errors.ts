import { createHash } from 'node:crypto';
import { formatToolError, sanitizePublicErrorMessage } from '../../shared/error-handler.js';

export const PHOTON_TOOL_ERROR_META_KEY = 'io.portel.photon/error' as const;

export const PHOTON_TOOL_ERROR_CODES = {
  INPUT_INVALID: 'PHOTON_TOOL_INPUT_INVALID',
  EXECUTION_FAILED: 'PHOTON_TOOL_EXECUTION_FAILED',
  OUTPUT_INVALID: 'PHOTON_TOOL_OUTPUT_INVALID',
  AUTHENTICATION_REQUIRED: 'PHOTON_AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'PHOTON_ACCESS_DENIED',
  DEPENDENCY_UNAVAILABLE: 'PHOTON_DEPENDENCY_UNAVAILABLE',
  RATE_LIMITED: 'PHOTON_TOOL_RATE_LIMITED',
  TIMED_OUT: 'PHOTON_TOOL_TIMED_OUT',
  CANCELLED: 'PHOTON_TOOL_CANCELLED',
} as const;

export type PhotonToolErrorCode =
  (typeof PHOTON_TOOL_ERROR_CODES)[keyof typeof PHOTON_TOOL_ERROR_CODES];

export type PhotonToolErrorCategory =
  | 'tool_input'
  | 'tool_execution'
  | 'tool_output'
  | 'authorization'
  | 'dependency';

export interface PhotonToolErrorContext {
  requestId?: string | number;
  traceparent?: string;
  code?: PhotonToolErrorCode;
  category?: PhotonToolErrorCategory;
  errorType?: string;
  retryable?: boolean;
  publicMessage?: string;
  /** Safe, bounded metadata only. Never pass tool arguments or credentials. */
  details?: Record<string, string | number | boolean | null>;
}

export interface PhotonToolErrorDescriptor {
  code: PhotonToolErrorCode;
  category: PhotonToolErrorCategory;
  type: string;
  retryable: boolean;
  message: string;
  correlationId?: string;
  traceparent?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface PhotonMCPErrorReference {
  correlationId?: string;
  traceparent?: string;
}

export interface PhotonToolErrorResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  structuredContent: {
    error: PhotonToolErrorDescriptor;
  };
  _meta: Record<string, unknown> & {
    [PHOTON_TOOL_ERROR_META_KEY]: PhotonToolErrorDescriptor;
    /** 2025 Beam compatibility alias. */
    photon: {
      type: string;
      retryable: boolean;
      message: string;
      code: PhotonToolErrorCode;
      correlationId?: string;
    };
  };
}

function safeCorrelationId(requestId: string | number | undefined): string | undefined {
  if (requestId === undefined) return undefined;
  const value = String(requestId);
  if (/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) return value;
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function safeTraceparent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u.exec(normalized);
  if (!match || /^0+$/u.test(match[1]) || /^0+$/u.test(match[2])) return undefined;
  return normalized;
}

export function buildMCPErrorReference(
  requestId?: string | number,
  traceparent?: string
): PhotonMCPErrorReference {
  const correlationId = safeCorrelationId(requestId);
  const safeTrace = safeTraceparent(traceparent);
  return {
    ...(correlationId ? { correlationId } : {}),
    ...(safeTrace ? { traceparent: safeTrace } : {}),
  };
}

function defaultsFor(errorType: string): {
  code: PhotonToolErrorCode;
  category: PhotonToolErrorCategory;
} {
  switch (errorType) {
    case 'validation_error':
      return {
        code: PHOTON_TOOL_ERROR_CODES.INPUT_INVALID,
        category: 'tool_input',
      };
    case 'rate_limited':
      return {
        code: PHOTON_TOOL_ERROR_CODES.RATE_LIMITED,
        category: 'dependency',
      };
    case 'timeout_error':
    case 'circuit_open':
    case 'bulkhead_full':
      return {
        code: PHOTON_TOOL_ERROR_CODES.TIMED_OUT,
        category: 'dependency',
      };
    case 'network_error':
      return {
        code: PHOTON_TOOL_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        category: 'dependency',
      };
    case 'permission_error':
      return {
        code: PHOTON_TOOL_ERROR_CODES.ACCESS_DENIED,
        category: 'authorization',
      };
    case 'cancelled':
      return {
        code: PHOTON_TOOL_ERROR_CODES.CANCELLED,
        category: 'tool_execution',
      };
    default:
      return {
        code: PHOTON_TOOL_ERROR_CODES.EXECUTION_FAILED,
        category: 'tool_execution',
      };
  }
}

function safeDetails(
  details: PhotonToolErrorContext['details']
): PhotonToolErrorContext['details'] {
  if (!details) return undefined;
  const entries = Object.entries(details).slice(0, 16);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.replace(/[^A-Za-z0-9._-]/gu, '').slice(0, 64);
    if (!key || /authorization|password|secret|token|cookie|api.?key/iu.test(key)) continue;
    result[key] =
      typeof rawValue === 'string'
        ? sanitizePublicErrorMessage(rawValue).slice(0, 256)
        : typeof rawValue === 'number' && !Number.isFinite(rawValue)
          ? null
          : rawValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function buildMCPToolError(
  toolName: string,
  error: unknown,
  context: PhotonToolErrorContext = {}
): PhotonToolErrorResult {
  const safeToolName = sanitizePublicErrorMessage(toolName).slice(0, 128);
  const formatted = formatToolError(safeToolName, error);
  const type = context.errorType ?? formatted.errorType;
  const defaults = defaultsFor(type);
  const message = sanitizePublicErrorMessage(
    context.publicMessage ?? (error instanceof Error ? error.message : error)
  );
  const code = context.code ?? defaults.code;
  const retryable = context.retryable ?? formatted.retryable;
  const { correlationId, traceparent } = buildMCPErrorReference(
    context.requestId,
    context.traceparent
  );
  const details = safeDetails(context.details);
  const descriptor: PhotonToolErrorDescriptor = {
    code,
    category: context.category ?? defaults.category,
    type,
    retryable,
    message,
    ...(correlationId ? { correlationId } : {}),
    ...(traceparent ? { traceparent } : {}),
    ...(details ? { details } : {}),
  };

  const text =
    context.publicMessage === undefined
      ? formatted.text
      : `Tool Error: ${safeToolName}\n\nError Type: ${type}\nMessage: ${message}\nRetryable: ${retryable}\n`;

  return {
    content: [{ type: 'text', text }],
    isError: true,
    structuredContent: { error: descriptor },
    _meta: {
      [PHOTON_TOOL_ERROR_META_KEY]: descriptor,
      photon: {
        type,
        retryable,
        message,
        code,
        ...(correlationId ? { correlationId } : {}),
      },
    },
  };
}
