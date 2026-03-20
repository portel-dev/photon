/**
 * A2A Agent Card Generator
 *
 * Generates an A2A Agent Card from loaded photon metadata.
 * Maps photon methods to A2A skills and detects capabilities
 * from photon tags (@stateful, streaming yields, etc.).
 */

import type { AgentCard, AgentCapability, AgentSkill } from './types.js';

/**
 * Minimal photon info needed to generate an Agent Card.
 * Compatible with both PhotonInfo and UnconfiguredPhotonInfo.
 */
export interface PhotonCardInput {
  name: string;
  description?: string;
  stateful?: boolean;
  icon?: string;
  methods?: Array<{
    name: string;
    description: string;
    params: Record<string, unknown>;
    tags?: string[];
  }>;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

export interface CardGeneratorOptions {
  baseUrl?: string;
  organization?: string;
  organizationUrl?: string;
  version?: string;
}

/**
 * Generate an A2A Agent Card from an array of photon metadata.
 *
 * Each photon method becomes an A2A Skill. Capabilities are inferred
 * from photon tags and features.
 */
export function generateAgentCard(
  photons: PhotonCardInput[],
  options?: CardGeneratorOptions
): AgentCard {
  const baseUrl = options?.baseUrl || 'http://localhost:3000';
  const capabilities = detectCapabilities(photons);
  const skills = buildSkills(photons);

  const card: AgentCard = {
    name: buildAgentName(photons),
    description: buildAgentDescription(photons),
    url: baseUrl,
    version: options?.version || '1.0.0',
    capabilities,
    skills,
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
  };

  if (options?.organization) {
    card.provider = {
      organization: options.organization,
      ...(options.organizationUrl ? { url: options.organizationUrl } : {}),
    };
  }

  return card;
}

// ════════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ════════════════════════════════════════════════════════════════════════════════

function buildAgentName(photons: PhotonCardInput[]): string {
  if (photons.length === 1) return photons[0].name;
  return 'photon-agent';
}

function buildAgentDescription(photons: PhotonCardInput[]): string {
  if (photons.length === 1 && photons[0].description) {
    return photons[0].description;
  }
  const names = photons.map((p) => p.name).join(', ');
  return `Photon agent with capabilities: ${names}`;
}

function detectCapabilities(photons: PhotonCardInput[]): AgentCapability[] {
  const caps: AgentCapability[] = [];

  // All photon agents support tool execution via MCP
  const hasTools = photons.some(
    (p) => (p.methods && p.methods.length > 0) || (p.tools && p.tools.length > 0)
  );
  if (hasTools) {
    caps.push({ name: 'tool_execution', description: 'Executes tools via MCP protocol' });
  }

  // @stateful photons maintain state across calls
  if (photons.some((p) => p.stateful)) {
    caps.push({ name: 'stateful', description: 'Maintains state across interactions' });
  }

  // Photon runtime always supports streaming via SSE
  caps.push({ name: 'streaming', description: 'Supports streaming responses via SSE' });

  // AG-UI protocol support (always available in Beam)
  caps.push({ name: 'ag-ui', description: 'Supports AG-UI protocol for agent-to-agent UI' });

  return caps;
}

function buildSkills(photons: PhotonCardInput[]): AgentSkill[] {
  const skills: AgentSkill[] = [];

  for (const photon of photons) {
    // Prefer methods (richer metadata) over raw tools
    if (photon.methods) {
      for (const method of photon.methods) {
        skills.push({
          id: `${photon.name}/${method.name}`,
          name: `${photon.name} ${method.name}`,
          description: method.description || `${method.name} on ${photon.name}`,
          tags: method.tags,
          inputSchema: Object.keys(method.params).length > 0 ? method.params : undefined,
        });
      }
    } else if (photon.tools) {
      for (const tool of photon.tools) {
        skills.push({
          id: `${photon.name}/${tool.name}`,
          name: `${photon.name} ${tool.name}`,
          description: tool.description || `${tool.name} on ${photon.name}`,
          inputSchema: tool.inputSchema,
        });
      }
    }
  }

  return skills;
}
