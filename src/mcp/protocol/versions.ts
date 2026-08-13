/** Exact MCP revision handling. Protocol dates are identifiers, not semver. */
export const MCP_PROTOCOL_VERSIONS = {
  LEGACY_2025_03_26: '2025-03-26',
  LEGACY_2025_11_25: '2025-11-25',
  STATELESS_2026_07_28: '2026-07-28',
} as const;

export type MCPProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[keyof typeof MCP_PROTOCOL_VERSIONS];

const SUPPORTED = new Set<string>(Object.values(MCP_PROTOCOL_VERSIONS));

export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly MCPProtocolVersion[] =
  Object.values(MCP_PROTOCOL_VERSIONS);

/**
 * Select the version for a legacy initialize exchange.
 *
 * Photon authors never choose an MCP revision. The client declares the
 * revision it speaks and the runtime echoes that exact supported revision.
 * The 2025-11-25 revision remains the default for clients which omit the
 * field; 2026 clients negotiate through stateless discovery metadata instead
 * of initialize (where initialize is not part of that protocol).
 */
export function negotiateMCPProtocolVersion(requested: unknown): MCPProtocolVersion {
  if (isSupportedMCPProtocolVersion(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25;
}

export function isSupportedMCPProtocolVersion(value: unknown): value is MCPProtocolVersion {
  return typeof value === 'string' && SUPPORTED.has(value);
}

export function isStatelessMCPProtocolVersion(
  value: unknown
): value is typeof MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28 {
  return value === MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28;
}
