import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Task, TaskInputRequest, TaskState } from './types.js';
import type { TaskClock, TaskRuntimePort, TaskScheduler } from './ports.js';

interface PendingTaskInput {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface TaskRuntimeOptions {
  getTask: (taskId: string) => Task | null;
  updateTask: (taskId: string, updates: Record<string, unknown>) => Task | null;
  cleanup?: () => void;
  recover?: () => number;
  createTask?: (...args: any[]) => Task;
  listTasks?: (photon?: string) => Task[];
  clock?: TaskClock;
  scheduler?: TaskScheduler;
}

const systemClock: TaskClock = { now: () => Date.now() };
const systemScheduler: TaskScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Owns in-memory task execution state and its maintenance lifecycle. */
export class TaskRuntime implements TaskRuntimePort {
  readonly events = new EventEmitter();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingInputs = new Map<string, Map<string, PendingTaskInput>>();
  private recoveryComplete = false;
  private readonly clock: TaskClock;
  private readonly scheduler: TaskScheduler;
  private readonly cleanup?: () => void;
  private maintenanceHandle: unknown;

  constructor(options: TaskRuntimeOptions) {
    this.getTaskRecord = options.getTask;
    this.updateTaskRecord = options.updateTask;
    this.createTaskRecord =
      options.createTask ??
      (() => {
        throw new Error('Task runtime creation is not configured');
      });
    this.listTaskRecords = options.listTasks ?? (() => []);
    this.cleanup = options.cleanup;
    this.optionsRecover = options.recover;
    this.clock = options.clock ?? systemClock;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.events.setMaxListeners(50);
  }

  private readonly listTaskRecords: (photon?: string) => Task[];
  private readonly getTaskRecord: TaskRuntimeOptions['getTask'];
  private readonly updateTaskRecord: TaskRuntimeOptions['updateTask'];
  private readonly createTaskRecord: NonNullable<TaskRuntimeOptions['createTask']>;

  withTaskContext<T>(fn: () => T): T {
    return fn();
  }

  createTask(
    photon: string,
    method: string,
    params?: Record<string, unknown>,
    ttl?: number,
    options?: {
      protocol?: Task['protocol'];
      owner?: Task['owner'];
      pollInterval?: number;
      traceContext?: import('../telemetry/propagation.js').TracePropagationContext;
    }
  ): Task {
    this.recoverInterruptedTasks();
    return this.createTaskRecord(photon, method, params, ttl, options);
  }

  listTasks(photon?: string): Task[] {
    this.recoverInterruptedTasks();
    const tasks = this.listTaskRecords(photon);
    return tasks;
  }

  getTask(taskId: string): Task | null {
    this.recoverInterruptedTasks();
    return this.getTaskRecord(taskId);
  }

  updateTask(taskId: string, updates: Record<string, unknown>): Task | null {
    return this.updateTaskRecord(taskId, updates);
  }

  transitionTask(
    taskId: string,
    from: readonly TaskState[],
    updates: Record<string, unknown>
  ): Task | null {
    const task = this.getTaskRecord(taskId);
    if (!task || !from.includes(task.state)) return task;
    return this.updateTaskRecord(taskId, updates);
  }

  registerController(taskId: string, controller: AbortController): void {
    this.controllers.set(taskId, controller);
  }

  unregisterController(taskId: string): void {
    this.controllers.delete(taskId);
  }

  getController(taskId: string): AbortController | undefined {
    return this.controllers.get(taskId);
  }

  resolveTaskInput(taskId: string, value: unknown): boolean {
    const requests = this.pendingInputs.get(taskId);
    if (!requests) return false;
    const entry = requests.entries().next().value;
    if (!entry) return false;
    requests.delete(entry[0]);
    if (requests.size === 0) this.pendingInputs.delete(taskId);
    this.updateTaskRecord(taskId, { state: 'working', input: undefined, inputRequests: undefined });
    entry[1].resolve(value);
    return true;
  }

  rejectTaskInput(taskId: string, reason: string): boolean {
    const requests = this.pendingInputs.get(taskId);
    if (!requests) return false;
    this.pendingInputs.delete(taskId);
    for (const entry of requests.values()) entry.reject(new Error(reason));
    return true;
  }

  hasPendingInput(taskId: string): boolean {
    return (this.pendingInputs.get(taskId)?.size ?? 0) > 0;
  }

  requestTaskInput(
    taskId: string,
    request: TaskInputRequest,
    signal?: AbortSignal
  ): Promise<unknown> {
    const task = this.requireTask(taskId);
    const key = `input_${(task.inputRequestSequence ?? 0) + 1}_${randomBytes(12).toString('base64url')}`;
    const existing = task.inputRequests ?? {};
    const requests = this.pendingInputs.get(taskId) ?? new Map<string, PendingTaskInput>();
    this.pendingInputs.set(taskId, requests);

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        requests.delete(key);
        if (requests.size === 0) this.pendingInputs.delete(taskId);
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Task cancelled'));
      };
      requests.set(key, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      this.updateTaskRecord(taskId, {
        state: 'input_required',
        statusMessage: 'Waiting for client input.',
        inputRequests: { ...existing, [key]: request },
        inputRequestSequence: (task.inputRequestSequence ?? 0) + 1,
      });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  requestLegacyInput(taskId: string, ask: unknown, signal: AbortSignal): Promise<unknown> {
    this.updateTaskRecord(taskId, {
      state: 'input_required',
      statusMessage:
        ask && typeof ask === 'object' && 'message' in ask && typeof ask.message === 'string'
          ? ask.message
          : 'Waiting for user input.',
      input: ask,
    });
    const requests = this.pendingInputs.get(taskId) ?? new Map<string, PendingTaskInput>();
    this.pendingInputs.set(taskId, requests);
    const key = `legacy_${randomBytes(8).toString('base64url')}`;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        requests.delete(key);
        if (requests.size === 0) this.pendingInputs.delete(taskId);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Task cancelled'));
      };
      requests.set(key, {
        resolve: (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  submitTaskInputResponses(
    taskId: string,
    responses: Record<string, unknown>
  ): { accepted: number; outstanding: number } {
    const task = this.getTaskRecord(taskId);
    const outstanding = task?.inputRequests ?? {};
    const pending = this.pendingInputs.get(taskId);
    if (!task || !pending) return { accepted: 0, outstanding: Object.keys(outstanding).length };

    let accepted = 0;
    const remaining = { ...outstanding };
    const resolutions: Array<{ entry: PendingTaskInput; value: unknown }> = [];
    for (const [key, value] of Object.entries(responses)) {
      const entry = pending.get(key);
      if (!entry || !Object.prototype.hasOwnProperty.call(outstanding, key)) continue;
      pending.delete(key);
      delete remaining[key];
      accepted++;
      resolutions.push({ entry, value });
    }
    if (pending.size === 0) this.pendingInputs.delete(taskId);
    this.updateTaskRecord(taskId, {
      ...(Object.keys(remaining).length === 0
        ? { state: 'working', statusMessage: 'Resuming execution...' }
        : {}),
      inputRequests: Object.keys(remaining).length > 0 ? remaining : undefined,
    });
    for (const resolution of resolutions) resolution.entry.resolve(resolution.value);
    return { accepted, outstanding: Object.keys(remaining).length };
  }

  waitForStateChange(
    taskId: string,
    predicate?: (state: TaskState) => boolean,
    signal?: AbortSignal
  ): Promise<Task> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const handler = (changedId: string, state: TaskState, task: Task) => {
        if (changedId !== taskId || (predicate && !predicate(state))) return;
        cleanup();
        resolve(task);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('Aborted'));
      };
      const cleanup = () => {
        this.events.removeListener('stateChange', handler);
        signal?.removeEventListener('abort', onAbort);
      };
      this.events.on('stateChange', handler);
      signal?.addEventListener('abort', onAbort, { once: true });
      const current = this.getTaskRecord(taskId);
      if (current && (!predicate || predicate(current.state))) {
        cleanup();
        resolve(current);
      }
    });
  }

  waitForTerminalOrInput(taskId: string, signal?: AbortSignal): Promise<Task> {
    return this.waitForStateChange(
      taskId,
      (state) =>
        state === 'input_required' ||
        state === 'completed' ||
        state === 'failed' ||
        state === 'cancelled',
      signal
    );
  }

  hasRecovered(_directory: string): boolean {
    return this.recoveryComplete;
  }

  markRecovered(_directory: string): void {
    this.recoveryComplete = true;
  }

  recoverInterruptedTasks(): number {
    if (this.recoveryComplete) return 0;
    this.recoveryComplete = true;
    return this.optionsRecover?.() ?? 0;
  }

  private readonly optionsRecover?: () => number;

  startMaintenance(intervalMs = 60_000): void {
    if (this.maintenanceHandle !== undefined) return;
    this.clock.now();
    this.cleanup?.();
    this.maintenanceHandle = this.scheduler.setInterval(() => this.cleanup?.(), intervalMs);
    (this.maintenanceHandle as { unref?: () => void } | undefined)?.unref?.();
  }

  stopMaintenance(): void {
    if (this.maintenanceHandle === undefined) return;
    this.scheduler.clearInterval(this.maintenanceHandle);
    this.maintenanceHandle = undefined;
  }

  close(): void {
    this.stopMaintenance();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    for (const requests of this.pendingInputs.values()) {
      for (const entry of requests.values()) entry.reject(new Error('Task runtime closed'));
    }
    this.pendingInputs.clear();
    this.events.removeAllListeners();
  }

  private requireTask(taskId: string): Task {
    const task = this.getTaskRecord(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}
