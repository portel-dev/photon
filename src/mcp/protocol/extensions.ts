/**
 * MCP extension negotiation registry.
 *
 * The 2026 protocol carries client extension settings on every request. Keep
 * identifiers, settings validation, server advertisement, and opt-in checks in
 * one place so transport code cannot accidentally revive legacy aliases.
 */

export const MCP_UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';
export const MCP_TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
export const PHOTON_EXTENSION_ID = 'dev.portel.photon';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** Human-readable lifecycle metadata for features retained only for compatibility. */
export const MCP_DEPRECATED_COMPATIBILITY_FEATURES = {
  roots: {
    status: 'deprecated',
    since: '2026-07-28',
    replacements: ['tool arguments', 'resource URIs', 'server configuration'],
  },
  sampling: {
    status: 'deprecated',
    since: '2026-07-28',
    replacements: ['direct model-provider APIs'],
  },
  logging: {
    status: 'deprecated',
    since: '2026-07-28',
    replacements: ['stderr for stdio diagnostics', 'OpenTelemetry for structured observability'],
  },
  removalGate: 'MCP feature lifecycle and a separate removal SEP',
} as const;

export interface MCPModernExtensionOptions {
  photonVersion: string;
}

export interface MCPClientExtensionValidation {
  ok: boolean;
  message?: string;
}

export interface MCPModernExtensionDefinition {
  id: string;
  implementationVersion: string;
  clientRequirement: string;
  advertisedSettings: (options: MCPModernExtensionOptions) => Record<string, unknown>;
  validateClientSettings: (settings: Record<string, unknown>) => MCPClientExtensionValidation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export const MCP_EXTENSION_REGISTRY: readonly MCPModernExtensionDefinition[] = [
  {
    id: MCP_UI_EXTENSION_ID,
    implementationVersion: '@modelcontextprotocol/ext-apps@1.7.5',
    clientRequirement: `mimeTypes includes ${MCP_APP_MIME_TYPE}`,
    advertisedSettings: () => ({ mimeTypes: [MCP_APP_MIME_TYPE] }),
    validateClientSettings: (settings) =>
      Array.isArray(settings.mimeTypes) &&
      settings.mimeTypes.every((value) => typeof value === 'string') &&
      settings.mimeTypes.includes(MCP_APP_MIME_TYPE)
        ? { ok: true }
        : {
            ok: false,
            message: `${MCP_UI_EXTENSION_ID} requires mimeTypes including ${MCP_APP_MIME_TYPE}`,
          },
  },
  {
    id: MCP_TASKS_EXTENSION_ID,
    implementationVersion: 'ext-tasks@2c1425d9a288b9b1f489430fe1e00bb392b47e48',
    clientRequirement: 'settings object on the current request',
    advertisedSettings: () => ({}),
    validateClientSettings: () => ({ ok: true }),
  },
  {
    id: PHOTON_EXTENSION_ID,
    implementationVersion: 'Photon runtime version',
    clientRequirement: 'settings object on the current request',
    advertisedSettings: (options) => ({
      version: options.photonVersion,
      requestContext: true,
      appSession: {
        issueOn: 'server/discover',
        metadataKey: `${PHOTON_EXTENSION_ID}/appSessionId`,
        revokeMethod: `${PHOTON_EXTENSION_ID}/app-sessions/revoke`,
        opaque: true,
        scoped: true,
      },
      idempotency: {
        metadataKey: `${PHOTON_EXTENSION_ID}/idempotencyKey`,
        idempotentTools: 'completed responses are replayed',
        nonIdempotentTools: 'duplicates are rejected',
      },
      compatibilityFeatures: MCP_DEPRECATED_COMPATIBILITY_FEATURES,
    }),
    validateClientSettings: () => ({ ok: true }),
  },
];

const EXTENSION_BY_ID = new Map(
  MCP_EXTENSION_REGISTRY.map((definition) => [definition.id, definition] as const)
);

export function modernServerExtensions(
  options: MCPModernExtensionOptions
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    MCP_EXTENSION_REGISTRY.map((definition) => [
      definition.id,
      definition.advertisedSettings(options),
    ])
  );
}

export function clientExtensionsFromCapabilities(capabilities: unknown): Record<string, unknown> {
  if (!isRecord(capabilities) || !isRecord(capabilities.extensions)) return {};
  return capabilities.extensions;
}

export function hasClientExtension(capabilities: unknown, id: string): boolean {
  const extensions = clientExtensionsFromCapabilities(capabilities);
  return hasOwn(extensions, id) && isRecord(extensions[id]);
}

export function clientSupportsMCPApps(capabilities: unknown): boolean {
  const extensions = clientExtensionsFromCapabilities(capabilities);
  const settings = extensions[MCP_UI_EXTENSION_ID];
  return (
    isRecord(settings) &&
    Array.isArray(settings.mimeTypes) &&
    settings.mimeTypes.includes(MCP_APP_MIME_TYPE)
  );
}

export function isPhotonPrivateMetadataKey(key: string): boolean {
  return (
    key.startsWith('photon/') ||
    key.startsWith('io.portel.photon/') ||
    key.startsWith(`${PHOTON_EXTENSION_ID}/`)
  );
}

/**
 * Validate only the extension map contract here. Global request-size/depth
 * bounds are enforced by request-validation before this function is called.
 * Unknown third-party identifiers remain forward compatible; unknown names in
 * namespaces reserved by MCP or Photon are rejected instead of silently
 * masquerading as supported standard features.
 */
export function validateModernClientExtensions(
  capabilities: Record<string, unknown>
): MCPClientExtensionValidation {
  if (capabilities.extensions === undefined) return { ok: true };
  if (!isRecord(capabilities.extensions)) {
    return { ok: false, message: 'MCP 2026 client capability extensions must be an object' };
  }

  for (const [id, settings] of Object.entries(capabilities.extensions)) {
    if (!isRecord(settings)) {
      return { ok: false, message: `MCP extension settings for ${id} must be an object` };
    }

    const definition = EXTENSION_BY_ID.get(id);
    if (
      !definition &&
      (id.startsWith('io.modelcontextprotocol/') || id.startsWith('dev.portel.photon'))
    ) {
      return { ok: false, message: `Unknown reserved MCP extension identifier: ${id}` };
    }

    if (definition) {
      const validation = definition.validateClientSettings(settings);
      if (!validation.ok) return validation;
    }
  }

  return { ok: true };
}
