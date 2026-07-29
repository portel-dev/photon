/**
 * Protocol-neutral durable task records.
 *
 * The 2025 experimental core vocabulary and the 2026 experimental Tasks
 * extension are deliberately rendered by separate adapters below.
 */
import type { TracePropagationContext } from '../telemetry/propagation.js';

export type TaskState = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
export type TaskProtocol = 'legacy-2025' | 'extension-2026';

export const TERMINAL_STATES: readonly TaskState[] = ['completed', 'failed', 'cancelled'];

export const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week
export const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds
export const MAX_TASK_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface TaskAccessBinding {
  /** SHA-256 binding of the authenticated principal (never the bearer token). */
  principal: string;
  /** SHA-256 binding of OAuth and Photon claim scope. */
  scope: string;
  /** Optional explicit Photon application-session binding. */
  appSession?: string;
}

export interface TaskInputRequest {
  method: string;
  params: Record<string, unknown>;
}

export interface TaskProtocolError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface Task {
  id: string;
  photon: string;
  method: string;
  params?: Record<string, unknown>;
  state: TaskState;
  statusMessage?: string;
  ttl: number;
  pollInterval: number;
  progress?: { percent: number; message?: string };
  result?: unknown;
  error?: string | TaskProtocolError;
  input?: unknown; // Ask payload when state === 'input_required'
  inputRequests?: Record<string, TaskInputRequest>;
  inputRequestSequence?: number;
  protocol?: TaskProtocol;
  owner?: TaskAccessBinding;
  /** Internal-only trace linkage for background/recovered execution; never rendered on MCP wire. */
  traceContext?: TracePropagationContext;
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

/** MCP 2025-11-25 experimental core wire format. */
export interface LegacyTaskWire {
  taskId: string;
  status: TaskState;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval: number;
}

/** Preserve the legacy field names byte-for-byte. */
export function toLegacyTaskWire(task: Task): LegacyTaskWire {
  return {
    taskId: task.id,
    status: task.state,
    ...(task.statusMessage && { statusMessage: task.statusMessage }),
    createdAt: task.createdAt,
    lastUpdatedAt: task.updatedAt,
    ttl: task.ttl,
    pollInterval: task.pollInterval,
  };
}

/** Backward-compatible name used by the 2025 adapters. */
export const toWireFormat = toLegacyTaskWire;

export interface ModernTaskWire {
  resultType?: 'task';
  taskId: string;
  status: TaskState;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
  inputRequests?: Record<string, TaskInputRequest>;
  result?: unknown;
  error?: TaskProtocolError;
}

export function taskErrorMessage(error: Task['error']): string {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && error.message) return error.message;
  return 'Task execution failed';
}

function modernTaskError(error: Task['error']): TaskProtocolError {
  if (error && typeof error === 'object' && typeof error.code === 'number') return error;
  return {
    code: -32603,
    message: taskErrorMessage(error),
  };
}

/**
 * Render the experimental io.modelcontextprotocol/tasks draft. Creation uses
 * resultType "task"; tasks/get is a normal result and receives "complete" from
 * the 2026 response adapter.
 */
export function toModernTaskWire(task: Task, options: { creation?: boolean } = {}): ModernTaskWire {
  const wire: ModernTaskWire = {
    ...(options.creation ? { resultType: 'task' as const } : {}),
    taskId: task.id,
    status: task.state,
    ...(task.statusMessage ? { statusMessage: task.statusMessage } : {}),
    createdAt: task.createdAt,
    lastUpdatedAt: task.updatedAt,
    ttlMs: task.ttl,
    ...(Number.isFinite(task.pollInterval) ? { pollIntervalMs: task.pollInterval } : {}),
  };
  if (task.state === 'input_required') wire.inputRequests = task.inputRequests ?? {};
  if (task.state === 'completed') wire.result = task.result;
  if (task.state === 'failed') wire.error = modernTaskError(task.error);
  return wire;
}

/** The _meta field for task-related messages */
export function relatedTaskMeta(taskId: string): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/related-task': { taskId },
  };
}
