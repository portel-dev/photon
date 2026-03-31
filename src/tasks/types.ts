/**
 * MCP Tasks Types (spec v2025-11-25)
 *
 * Task state machine for async long-running operations.
 * States: working → completed | failed | cancelled
 *         working → input_required → working (when resuming)
 */

export type TaskState = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export const TERMINAL_STATES: readonly TaskState[] = ['completed', 'failed', 'cancelled'];

export const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 1 week
export const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds

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
  error?: string;
  input?: unknown; // Ask payload when state === 'input_required'
  createdAt: string;
  updatedAt: string;
}

/** MCP wire format — field names match the spec exactly */
export interface TaskWire {
  taskId: string;
  status: TaskState;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval: number;
}

/** Convert internal Task to MCP wire format */
export function toWireFormat(task: Task): TaskWire {
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

/** The _meta field for task-related messages */
export function relatedTaskMeta(taskId: string): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/related-task': { taskId },
  };
}
