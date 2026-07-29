import {
  MCP_APP_MIME_TYPE,
  MCP_TASKS_EXTENSION_ID,
  MCP_UI_EXTENSION_ID,
  PHOTON_EXTENSION_ID,
} from './extensions.js';
import { MCP_PROTOCOL_VERSIONS } from './versions.js';

/**
 * Release-facing MCP support manifest.
 *
 * Keep this declarative so the doctor command, documentation checks, and
 * release tests report the same compatibility promise.
 */
export const MCP_COMPLIANCE_MANIFEST = {
  protocols: [
    {
      version: MCP_PROTOCOL_VERSIONS.LEGACY_2025_03_26,
      adapter: 'sdk-v1-2025',
      transports: ['stdio', 'streamable-http'],
      lifecycle: 'sessionful',
      status: 'stable',
    },
    {
      version: MCP_PROTOCOL_VERSIONS.LEGACY_2025_11_25,
      adapter: 'sdk-v1-2025',
      transports: ['stdio', 'streamable-http'],
      lifecycle: 'sessionful',
      status: 'stable',
    },
    {
      version: MCP_PROTOCOL_VERSIONS.STATELESS_2026_07_28,
      adapter: 'native-2026',
      transports: ['streamable-http'],
      lifecycle: 'stateless',
      status: 'release-candidate',
    },
  ],
  extensions: [
    {
      id: MCP_UI_EXTENSION_ID,
      status: 'stable-contract',
      requirement: `mimeTypes includes ${MCP_APP_MIME_TYPE}`,
    },
    {
      id: MCP_TASKS_EXTENSION_ID,
      status: 'experimental-pinned-draft',
      requirement: 'per-request extension declaration',
    },
    {
      id: PHOTON_EXTENSION_ID,
      status: 'photon-specific',
      requirement: 'per-request extension declaration',
    },
  ],
  authorization: {
    http: ['public', 'static bearer compatibility', 'scoped JWT/OAuth resource authorization'],
    stdio: ['local process and environment boundary'],
  },
  conformance: {
    officialPackage: '@modelcontextprotocol/conformance@0.2.0-alpha.10',
    specificationCommit: '31eefec6',
    tasksCommit: '2c1425d9',
    checks: {
      legacy2025Http: 42,
      core2026Http: 23,
      draft2026Http: 80,
      tasks2026: 35,
    },
  },
} as const;

export type MCPComplianceManifest = typeof MCP_COMPLIANCE_MANIFEST;
