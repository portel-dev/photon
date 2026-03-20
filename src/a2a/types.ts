/**
 * A2A (Agent-to-Agent) Protocol Types
 *
 * Type definitions for the A2A Agent Card specification.
 * Agent Cards enable multi-agent discovery by describing
 * agent capabilities and skills.
 *
 * @see https://google.github.io/A2A
 */

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AgentCapability[];
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  provider?: {
    organization: string;
    url?: string;
  };
}

export interface AgentCapability {
  name: string;
  description: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
}
