/**
 * MCP Tasks Types
 *
 * Task state machine for async long-running operations (MCP 2025-11-25 spec).
 * States: working → completed | failed | cancelled
 *         working → input_required → working (when resuming)
 */

export type TaskState = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  photon: string;
  method: string;
  params?: Record<string, unknown>;
  state: TaskState;
  progress?: { percent: number; message?: string };
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
