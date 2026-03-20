/**
 * MCP Task Types
 *
 * Defines the shape of async tasks used for fire-and-forget operations.
 * Tasks persist to disk at ~/.photon/tasks/ as individual JSON files.
 */

export type TaskState = 'working' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  photon: string;
  method: string;
  params?: Record<string, unknown>;
  state: TaskState;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
