/**
 * AG-UI Protocol Event Types
 *
 * Zero-dependency type definitions for the AG-UI protocol.
 * These are plain TypeScript interfaces representing JSON objects
 * that flow over MCP Streamable HTTP as notifications.
 *
 * @see https://docs.ag-ui.com/concepts/events
 */

// ════════════════════════════════════════════════════════════════════════════════
// EVENT TYPE ENUM
// ════════════════════════════════════════════════════════════════════════════════

export enum AGUIEventType {
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  STEP_STARTED = 'STEP_STARTED',
  STEP_FINISHED = 'STEP_FINISHED',
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',
  TOOL_CALL_RESULT = 'TOOL_CALL_RESULT',
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',
  CUSTOM = 'CUSTOM',
  RAW = 'RAW',
}

// ════════════════════════════════════════════════════════════════════════════════
// BASE EVENT
// ════════════════════════════════════════════════════════════════════════════════

export interface BaseEvent {
  type: AGUIEventType;
  timestamp?: number;
  rawEvent?: unknown;
}

// ════════════════════════════════════════════════════════════════════════════════
// RUN INPUT (what the client sends to start a run)
// ════════════════════════════════════════════════════════════════════════════════

export interface RunAgentInput {
  threadId: string;
  runId: string;
  state?: unknown;
  messages?: AGUIMessage[];
  tools?: AGUITool[];
  context?: Array<{ description: string; value: string }>;
  forwardedProps?: unknown;
}

export interface AGUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface AGUITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// ════════════════════════════════════════════════════════════════════════════════
// SPECIFIC EVENT INTERFACES
// ════════════════════════════════════════════════════════════════════════════════

export interface RunStartedEvent extends BaseEvent {
  type: AGUIEventType.RUN_STARTED;
  threadId: string;
  runId: string;
}

export interface RunFinishedEvent extends BaseEvent {
  type: AGUIEventType.RUN_FINISHED;
  threadId: string;
  runId: string;
}

export interface RunErrorEvent extends BaseEvent {
  type: AGUIEventType.RUN_ERROR;
  message: string;
  code?: string;
}

export interface StepStartedEvent extends BaseEvent {
  type: AGUIEventType.STEP_STARTED;
  stepName: string;
}

export interface StepFinishedEvent extends BaseEvent {
  type: AGUIEventType.STEP_FINISHED;
  stepName: string;
}

export interface TextMessageStartEvent extends BaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_START;
  messageId: string;
  role?: 'assistant';
}

export interface TextMessageContentEvent extends BaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string;
}

export interface TextMessageEndEvent extends BaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_END;
  messageId: string;
}

export interface ToolCallStartEvent extends BaseEvent {
  type: AGUIEventType.TOOL_CALL_START;
  toolCallId: string;
  toolCallName: string;
}

export interface ToolCallArgsEvent extends BaseEvent {
  type: AGUIEventType.TOOL_CALL_ARGS;
  toolCallId: string;
  delta: string;
}

export interface ToolCallEndEvent extends BaseEvent {
  type: AGUIEventType.TOOL_CALL_END;
  toolCallId: string;
}

export interface ToolCallResultEvent extends BaseEvent {
  type: AGUIEventType.TOOL_CALL_RESULT;
  toolCallId: string;
  result: string;
}

export interface StateSnapshotEvent extends BaseEvent {
  type: AGUIEventType.STATE_SNAPSHOT;
  snapshot: unknown;
}

export interface StateDeltaEvent extends BaseEvent {
  type: AGUIEventType.STATE_DELTA;
  delta: unknown[]; // JSON Patch (RFC 6902) operations
}

export interface MessagesSnapshotEvent extends BaseEvent {
  type: AGUIEventType.MESSAGES_SNAPSHOT;
  messages: AGUIMessage[];
}

export interface CustomEvent extends BaseEvent {
  type: AGUIEventType.CUSTOM;
  name: string;
  value: unknown;
}

export interface RawEvent extends BaseEvent {
  type: AGUIEventType.RAW;
  event: unknown;
}

// ════════════════════════════════════════════════════════════════════════════════
// UNION TYPE
// ════════════════════════════════════════════════════════════════════════════════

export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | CustomEvent
  | RawEvent;
