/**
 * MCP Server Card Generator
 *
 * Generates `.well-known/mcp-server` metadata documents from loaded photon info.
 * Server Cards enable discovery of MCP server capabilities without connecting.
 *
 * @see https://spec.modelcontextprotocol.io (Server Cards roadmap)
 */

import { PHOTON_VERSION } from './version.js';
import type { PhotonInfo, AnyPhotonInfo } from './auto-ui/types.js';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface ServerCard {
  name: string;
  description: string;
  version: string;
  protocol: string;
  transport: Array<{ type: string; url?: string }>;
  capabilities: string[];
  tools: Array<{ name: string; description: string }>;
  photons: Array<{
    name: string;
    description: string;
    methods: string[];
    stateful: boolean;
    icon?: string;
  }>;
  experimental?: Record<string, unknown>;
}

export interface ServerCardOptions {
  baseUrl?: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// GENERATOR
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate an MCP Server Card from loaded photon metadata.
 *
 * Produces a JSON-serializable document describing this server's capabilities,
 * transport endpoints, loaded photons, and available tools.
 */
export function generateServerCard(
  photons: AnyPhotonInfo[],
  options?: ServerCardOptions
): ServerCard {
  const configured = photons.filter((p): p is PhotonInfo => p.configured === true);

  // Build tool list from configured photons
  const tools: ServerCard['tools'] = [];
  for (const photon of configured) {
    if (!photon.methods) continue;
    for (const method of photon.methods) {
      tools.push({
        name: `${photon.name}/${method.name}`,
        description: method.description || `Execute ${method.name}`,
      });
    }
  }

  // Build photon summaries
  const photonSummaries: ServerCard['photons'] = configured.map((p) => ({
    name: p.name,
    description: p.description || '',
    methods: (p.methods || []).map((m) => m.name),
    stateful: p.stateful || false,
    ...(p.icon ? { icon: p.icon } : {}),
  }));

  // Determine capabilities
  const capabilities: string[] = ['tools'];
  const hasResources = configured.some((p) => (p.resourceCount ?? 0) > 0);
  const hasPrompts = configured.some((p) => (p.promptCount ?? 0) > 0);
  if (hasResources) capabilities.push('resources');
  if (hasPrompts) capabilities.push('prompts');

  // Build transport list
  const transport: ServerCard['transport'] = [{ type: 'streamable-http' }];
  if (options?.baseUrl) {
    transport[0].url = `${options.baseUrl}/mcp`;
  }

  return {
    name: 'photon-beam',
    description: 'Photon Beam MCP Server — interactive photon runtime',
    version: PHOTON_VERSION,
    protocol: 'mcp',
    transport,
    capabilities,
    tools,
    photons: photonSummaries,
    experimental: {
      'ag-ui': true,
      serverCards: '1.0',
    },
  };
}
