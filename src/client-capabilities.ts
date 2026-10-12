import type { Server } from './mcp/sdk-v2-2026/server.js';

const MCP_UI_CAPABILITY = 'io.modelcontextprotocol/ui';

export interface ClientCapabilityProfile {
  raw?: Record<string, any>;
  parsed?: Record<string, any>;
  clientName?: string;
  supportsBeamUI?: boolean;
  supportsOpenAIApp?: boolean;
}

export function isOpenAIClientName(name?: string): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return normalized === 'chatgpt' || normalized.includes('openai');
}

export function supportsUI(profile: ClientCapabilityProfile): boolean {
  if (profile.parsed?.experimental?.[MCP_UI_CAPABILITY]) return true;
  if (profile.raw?.extensions?.[MCP_UI_CAPABILITY]) return true;
  return Boolean(
    profile.supportsBeamUI || profile.supportsOpenAIApp || isOpenAIClientName(profile.clientName)
  );
}

export class ClientCapabilityRegistry {
  readonly raw = new WeakMap<Server, Record<string, any>>();

  setRaw(server: Server, capabilities: Record<string, any>): void {
    this.raw.set(server, capabilities);
  }

  getRaw(server: Server): Record<string, any> | undefined {
    return this.raw.get(server);
  }
}
