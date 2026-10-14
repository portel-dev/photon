import type { EventEmitter } from 'node:events';
import type { TracePropagationContext } from '../telemetry/propagation.js';
import type {
  Task,
  TaskAccessBinding,
  TaskInputRequest,
  TaskProtocol,
  TaskState,
} from './types.js';

export interface TaskClock {
  now(): number;
}

export interface TaskScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TaskRuntimePort {
  readonly events: EventEmitter;
  createTask(
    photon: string,
    method: string,
    params?: Record<string, unknown>,
    ttl?: number,
    options?: {
      protocol?: TaskProtocol;
      owner?: TaskAccessBinding;
      pollInterval?: number;
      traceContext?: TracePropagationContext;
    }
  ): Task;
  listTasks(photon?: string): Task[];
  getTask(taskId: string): Task | null;
  updateTask(taskId: string, updates: Record<string, unknown>): Task | null;
  transitionTask(
    taskId: string,
    from: readonly TaskState[],
    updates: Record<string, unknown>
  ): Task | null;
  recoverInterruptedTasks(): number;
  startMaintenance(intervalMs?: number): void;
  stopMaintenance(): void;
  withTaskContext<T>(fn: () => T): T;
  registerController(taskId: string, controller: AbortController): void;
  unregisterController(taskId: string): void;
  getController(taskId: string): AbortController | undefined;
  resolveTaskInput(taskId: string, value: unknown): boolean;
  rejectTaskInput(taskId: string, reason: string): boolean;
  hasPendingInput(taskId: string): boolean;
  requestTaskInput(
    taskId: string,
    request: TaskInputRequest,
    signal?: AbortSignal
  ): Promise<unknown>;
  requestLegacyInput(taskId: string, ask: unknown, signal: AbortSignal): Promise<unknown>;
  submitTaskInputResponses(
    taskId: string,
    responses: Record<string, unknown>
  ): { accepted: number; outstanding: number };
  waitForStateChange(
    taskId: string,
    predicate?: (state: TaskState) => boolean,
    signal?: AbortSignal
  ): Promise<Task>;
  waitForTerminalOrInput(taskId: string, signal?: AbortSignal): Promise<Task>;
  close(): void;
}
