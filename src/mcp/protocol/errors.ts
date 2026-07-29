export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export const MCP_2026_ERROR_CODES = {
  HEADER_MISMATCH: -32020,
  MISSING_REQUIRED_CLIENT_CAPABILITY: -32021,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  DUPLICATE_REQUEST: -32023,
} as const;

export type MCPProtocolErrorKind =
  | 'parse-error'
  | 'invalid-request'
  | 'method-not-found'
  | 'invalid-params'
  | 'internal-error'
  | 'header-mismatch'
  | 'missing-required-client-capability'
  | 'unsupported-protocol-version'
  | 'duplicate-request';

export interface MCPProtocolErrorDefinition {
  code: number;
  httpStatus: 400 | 404 | 409 | 500;
}

const ERROR_DEFINITIONS: Record<MCPProtocolErrorKind, MCPProtocolErrorDefinition> = {
  'parse-error': { code: JSON_RPC_ERROR_CODES.PARSE_ERROR, httpStatus: 400 },
  'invalid-request': { code: JSON_RPC_ERROR_CODES.INVALID_REQUEST, httpStatus: 400 },
  'method-not-found': { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, httpStatus: 404 },
  'invalid-params': { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS, httpStatus: 400 },
  'internal-error': { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, httpStatus: 500 },
  'header-mismatch': { code: MCP_2026_ERROR_CODES.HEADER_MISMATCH, httpStatus: 400 },
  'missing-required-client-capability': {
    code: MCP_2026_ERROR_CODES.MISSING_REQUIRED_CLIENT_CAPABILITY,
    httpStatus: 400,
  },
  'unsupported-protocol-version': {
    code: MCP_2026_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
    httpStatus: 400,
  },
  'duplicate-request': {
    code: MCP_2026_ERROR_CODES.DUPLICATE_REQUEST,
    httpStatus: 409,
  },
};

export function getMCPProtocolErrorDefinition(
  kind: MCPProtocolErrorKind
): MCPProtocolErrorDefinition {
  return ERROR_DEFINITIONS[kind];
}
