import { strict as assert } from 'node:assert';
import {
  MCP_PROTOCOL_VERSIONS,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  negotiateMCPProtocolVersion,
} from '../src/mcp/protocol/versions.js';

assert.equal(
  negotiateMCPProtocolVersion(MCP_PROTOCOL_VERSIONS.LEGACY_2025_03_26),
  MCP_PROTOCOL_VERSIONS.LEGACY_2025_03_26
);
assert.equal(
  negotiateMCPProtocolVersion(MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25),
  MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25
);
assert.equal(
  negotiateMCPProtocolVersion(MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28),
  MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28
);
assert.equal(negotiateMCPProtocolVersion(undefined), MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25);
assert.deepEqual([...SUPPORTED_MCP_PROTOCOL_VERSIONS], ['2025-03-26', '2025-11-25', '2026-07-28']);

console.log('MCP protocol version negotiation tests passed');
