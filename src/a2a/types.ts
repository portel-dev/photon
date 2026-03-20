/**
 * A2A (Agent-to-Agent) Protocol Types — Phase 1: Agent Cards
 *
 * Based on Google's Agent-to-Agent protocol (AAIF/Linux Foundation).
 * JSON-RPC 2.0 over HTTPS with Agent Card discovery.
 *
 * @see https://google.github.io/A2A/
 */

/**
 * Agent Card — the primary discovery document for an A2A agent.
 * Served at `/.well-known/agent.json`.
 */
export interface AgentCard {
  /** Human-readable agent name */
  name: string;
  /** What this agent does */
  description: string;
  /** Base URL where this agent can be reached */
  url: string;
  /** Agent version */
  version: string;
  /** Protocol/transport capabilities */
  capabilities: AgentCapability[];
  /** Individual skills (mapped from photon methods) */
  skills: AgentSkill[];
  /** Accepted input MIME types */
  defaultInputModes: string[];
  /** Produced output MIME types */
  defaultOutputModes: string[];
  /** Organization info */
  provider?: { organization: string; url?: string };
}

/**
 * A high-level capability the agent supports.
 */
export interface AgentCapability {
  /** Capability identifier: "tool_execution", "stateful", "streaming", "ag-ui" */
  name: string;
  /** Human-readable description */
  description?: string;
}

/**
 * A single skill the agent can perform (maps to a photon method/tool).
 */
export interface AgentSkill {
  /** Unique skill ID — `photonName/methodName` */
  id: string;
  /** Human-readable display name */
  name: string;
  /** What this skill does */
  description: string;
  /** Categorization tags */
  tags?: string[];
  /** JSON Schema describing expected input */
  inputSchema?: Record<string, unknown>;
}
