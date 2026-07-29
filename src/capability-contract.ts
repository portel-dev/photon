import type { ExtractedSchema } from '@portel/photon-core';

/** Public execution targets. Beam is intentionally absent: it is an MCP host. */
export type CapabilitySurface = 'mcp' | 'cli' | 'a2a' | 'runtime';

export interface CapabilityContractV1 {
  version: 1;
  name: string;
  description: string;
  inputSchema: ExtractedSchema['inputSchema'];
  outputSchema?: ExtractedSchema['outputSchema'];
  outputFormat?: ExtractedSchema['outputFormat'];
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execution: {
    generator?: boolean;
    stateful?: boolean;
    async?: boolean;
    timeoutMs?: number;
    retryable?: ExtractedSchema['retryable'];
    scheduled?: string;
    webhook?: boolean | string;
  };
  exposure: ReadonlySet<CapabilitySurface>;
  metadata: ExtractedSchema;
}

const DEFAULT_SURFACES: ReadonlySet<CapabilitySurface> = new Set(['mcp', 'cli']);

/** Build the single canonical representation consumed by all Photon surfaces. */
export function toCapabilityContract(
  schema: ExtractedSchema & {
    internal?: boolean;
    surfaces?: CapabilitySurface[];
  }
): CapabilityContractV1 {
  const exposure = schema.internal
    ? new Set<CapabilitySurface>(['runtime'])
    : new Set<CapabilitySurface>(schema.surfaces?.length ? schema.surfaces : DEFAULT_SURFACES);
  return {
    version: 1,
    name: schema.name,
    description: schema.description || '',
    inputSchema: schema.inputSchema,
    outputSchema: schema.outputSchema,
    outputFormat: schema.outputFormat,
    annotations: {
      readOnlyHint: schema.readOnlyHint,
      destructiveHint: schema.destructiveHint,
      idempotentHint: schema.idempotentHint,
      openWorldHint: schema.openWorldHint,
    },
    execution: {
      generator: schema.isGenerator,
      stateful: schema.isStateful,
      async: schema.isAsync,
      timeoutMs: schema.timeout?.ms,
      retryable: schema.retryable,
      scheduled: schema.scheduled,
      webhook: schema.webhook,
    },
    exposure,
    metadata: schema,
  };
}

export function contractsForTools(
  tools: Array<ExtractedSchema & { internal?: boolean; surfaces?: CapabilitySurface[] }>
): CapabilityContractV1[] {
  return tools.map(toCapabilityContract);
}
