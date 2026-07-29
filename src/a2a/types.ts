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

/** A2A 1.0 message primitives used by the optional Photon adapter. */
export interface A2AMessage {
  messageId: string;
  role: 'user' | 'agent';
  parts: Array<{
    kind: 'text' | 'file' | 'data';
    text?: string;
    data?: unknown;
    mimeType?: string;
  }>;
  contextId?: string;
  taskId?: string;
}

export interface A2AInvocationContext {
  callerId?: string;
  contextId: string;
  taskId: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface A2AHandlerResult {
  status: 'completed' | 'input-required' | 'failed';
  message?: A2AMessage;
  artifacts?: Array<{ name?: string; parts: A2AMessage['parts'] }>;
}

export interface A2AEvent {
  type: 'status-update' | 'artifact-update' | 'message';
  taskId: string;
  status?: A2AHandlerResult['status'];
  message?: A2AMessage;
  artifact?: { name?: string; parts: A2AMessage['parts'] };
}

export type A2AHandler = (
  message: A2AMessage,
  context: A2AInvocationContext
) => A2AHandlerResult | Promise<A2AHandlerResult> | AsyncIterable<A2AEvent>;

export interface AgentCardV1 {
  name: string;
  description: string;
  url: string;
  version: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: 'JSONRPC' | 'HTTP+JSON';
    protocolVersion: '1.0';
  }>;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  securitySchemes?: Record<string, { type: 'http'; scheme: 'bearer'; bearerFormat?: string }>;
  security?: Array<Record<string, string[]>>;
}
