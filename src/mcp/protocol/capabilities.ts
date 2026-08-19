import { modernServerExtensions } from './extensions.js';

// Keep the core 2026 Tasks capability explicit in the discovery shape. The
// extension registry supplies its negotiated settings; this marker makes the
// wire contract visible to clients and contract tooling.
const MODERN_TASKS_CAPABILITY = { 'io.modelcontextprotocol/tasks': {} } as const;

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPServerCapabilityOptions {
  photonVersion: string;
  aguiEventTypes: readonly string[];
}

export interface MCPDiscoveryOptions {
  protocolVersion: string;
  supportedVersions: readonly string[];
  serverInfo: MCPServerInfo;
  capabilities: Record<string, unknown>;
  configurationSchema?: Record<string, unknown>;
  requestMetadata?: Record<string, unknown>;
  ttlMs: number;
  cacheScope: 'public' | 'private';
  taskMode?: 'none' | 'legacy-core' | 'extension';
  photonVersion: string;
}

function aguiCapability(options: MCPServerCapabilityOptions): Record<string, unknown> {
  return {
    version: '0.1.0',
    events: [...options.aguiEventTypes],
    features: ['structured-errors', 'trace-correlation', 'proxy-mode', 'local-mode'],
  };
}

export function buildLegacyMCPServerCapabilities(
  options: MCPServerCapabilityOptions
): Record<string, unknown> {
  return {
    tools: { listChanged: true },
    prompts: { listChanged: true },
    resources: { listChanged: true, subscribe: true },
    tasks: {
      list: {},
      cancel: {},
      requests: {
        tools: { call: {} },
      },
    },
    experimental: {
      'ag-ui': aguiCapability(options),
    },
  };
}

export function buildModernMCPServerCapabilities(
  options: MCPServerCapabilityOptions
): Record<string, unknown> {
  return {
    tools: { listChanged: true },
    prompts: { listChanged: true },
    resources: { listChanged: true, subscribe: true },
    extensions: {
      ...MODERN_TASKS_CAPABILITY,
      ...modernServerExtensions({ photonVersion: options.photonVersion }),
    },
  };
}

export function buildLegacyMCPDiscoveryResult(
  options: MCPDiscoveryOptions
): Record<string, unknown> {
  return {
    protocolVersion: options.protocolVersion,
    supportedProtocolVersions: [...options.supportedVersions],
    serverInfo: options.serverInfo,
    capabilities: options.capabilities,
    extensions: {
      'mcp-apps': { version: '1.0.0' },
      tasks: {
        version: options.taskMode === 'extension' ? '2026-07-28' : 'legacy',
      },
      photon: {
        version: options.photonVersion,
        requestContext: true,
        appSession: {
          acceptedLocations: ['_meta.photon/appSessionId', 'arguments.appSessionId'],
          responseMetaKey: 'photon/appSessionId',
        },
      },
    },
    configurationSchema: options.configurationSchema,
    _meta: options.requestMetadata ?? {},
  };
}

export function buildModernMCPDiscoveryResult(
  options: MCPDiscoveryOptions
): Record<string, unknown> {
  return {
    supportedVersions: [...options.supportedVersions],
    capabilities: options.capabilities,
    ttlMs: options.ttlMs,
    cacheScope: options.cacheScope,
    configurationSchema: options.configurationSchema,
    ...(options.requestMetadata && Object.keys(options.requestMetadata).length > 0
      ? { _meta: options.requestMetadata }
      : {}),
  };
}
