/**
 * MCP Task Executor (spec v2025-11-25)
 *
 * Runs tool execution in the background with support for input resumption.
 * Decoupled from transport — works with both Streamable HTTP and STDIO.
 */

import { randomBytes } from 'crypto';
import { getTask, updateTask, transitionTask, unregisterController, taskEvents } from './store.js';
import {
  TERMINAL_STATES,
  type Task,
  type TaskInputRequest,
  type TaskProtocolError,
  type TaskState,
} from './types.js';

type OutputHandler = (data: any) => void;
type InputProvider = (ask: any) => Promise<any>;
type InputRequestProvider = (
  requests: Record<string, TaskInputRequest>
) => Promise<Record<string, unknown>>;

interface ExecutionOptions {
  signal: AbortSignal;
  caller?: any;
  outputHandler?: OutputHandler;
  inputMode?: 'legacy' | 'modern';
  inputRequestBuilder?: (ask: any) => TaskInputRequest;
  extractInputResponse?: (ask: any, response: unknown) => unknown;
  transformResult?: (result: unknown) => unknown;
  transformErrorToResult?: (error: unknown) => unknown;
  protocolErrorFrom?: (error: unknown) => TaskProtocolError | undefined;
}

/**
 * Pending input resolvers — when a task enters input_required,
 * the generator blocks on a promise. resolveTaskInput() resolves it.
 */
interface PendingTaskInput {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

const pendingInputs = new Map<string, Map<string, PendingTaskInput>>();

/**
 * Resolve pending input for a task, resuming generator execution.
 * Returns true if there was pending input to resolve.
 */
export function resolveTaskInput(taskId: string, value: any): boolean {
  const requests = pendingInputs.get(taskId);
  const pending = requests?.values().next().value;
  if (!pending || !requests) return false;
  const key = requests.keys().next().value as string;
  requests.delete(key);
  if (requests.size === 0) pendingInputs.delete(taskId);
  updateTask(taskId, { state: 'working', input: undefined, inputRequests: undefined });
  pending.resolve(value);
  return true;
}

function rejectAllTaskInputs(taskId: string, reason: string): boolean {
  const requests = pendingInputs.get(taskId);
  if (!requests) return false;
  pendingInputs.delete(taskId);
  for (const pending of requests.values()) pending.reject(new Error(reason));
  return true;
}

/**
 * Reject pending input (e.g., on cancellation or timeout).
 */
export function rejectTaskInput(taskId: string, reason: string): boolean {
  return rejectAllTaskInputs(taskId, reason);
}

/**
 * Check if a task has pending input waiting.
 */
export function hasPendingInput(taskId: string): boolean {
  return (pendingInputs.get(taskId)?.size ?? 0) > 0;
}

function nextTaskInputKey(task: Task): string {
  const sequence = (task.inputRequestSequence ?? 0) + 1;
  return `input_${sequence}_${randomBytes(12).toString('base64url')}`;
}

/**
 * Persist a modern task input request before suspending execution. Keys are
 * unique for the lifetime of a task and responses are direct MCP result values.
 */
export function requestTaskInput(
  taskId: string,
  request: TaskInputRequest,
  signal?: AbortSignal
): Promise<unknown> {
  const task = awaitableTask(taskId);
  const key = nextTaskInputKey(task);
  const existing = task.inputRequests ?? {};
  const requests = pendingInputs.get(taskId) ?? new Map<string, PendingTaskInput>();
  pendingInputs.set(taskId, requests);

  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      requests.delete(key);
      if (requests.size === 0) pendingInputs.delete(taskId);
      cleanup();
      reject(new Error('Task cancelled'));
    };
    requests.set(key, {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
    updateTask(taskId, {
      state: 'input_required',
      statusMessage: 'Waiting for client input.',
      inputRequests: { ...existing, [key]: request },
      inputRequestSequence: (task.inputRequestSequence ?? 0) + 1,
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function awaitableTask(taskId: string): Task {
  const task = getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

export function submitTaskInputResponses(
  taskId: string,
  responses: Record<string, unknown>
): { accepted: number; outstanding: number } {
  const task = getTask(taskId);
  const outstanding = task?.inputRequests ?? {};
  const pending = pendingInputs.get(taskId);
  if (!task || !pending) return { accepted: 0, outstanding: Object.keys(outstanding).length };

  let accepted = 0;
  const remaining = { ...outstanding };
  const resolutions: Array<{ pending: PendingTaskInput; value: unknown }> = [];
  for (const [key, value] of Object.entries(responses)) {
    const resolver = pending.get(key);
    if (!resolver || !Object.prototype.hasOwnProperty.call(outstanding, key)) continue;
    pending.delete(key);
    delete remaining[key];
    accepted++;
    resolutions.push({ pending: resolver, value });
  }
  if (pending.size === 0) pendingInputs.delete(taskId);
  updateTask(taskId, {
    ...(Object.keys(remaining).length === 0
      ? { state: 'working' as const, statusMessage: 'Resuming execution...' }
      : {}),
    inputRequests: Object.keys(remaining).length > 0 ? remaining : undefined,
  });
  for (const resolution of resolutions) resolution.pending.resolve(resolution.value);
  return { accepted, outstanding: Object.keys(remaining).length };
}

/**
 * Wait for a task to reach a specific state (or any state change).
 * Resolves with the updated task when the condition is met.
 */
export function waitForStateChange(
  taskId: string,
  predicate?: (state: TaskState) => boolean,
  signal?: AbortSignal
): Promise<Task> {
  return new Promise((resolve, reject) => {
    // Check abort
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const handler = (changedId: string, newState: TaskState, task: Task) => {
      if (changedId !== taskId) return;
      if (!predicate || predicate(newState)) {
        cleanup();
        resolve(task);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Aborted'));
    };

    const cleanup = () => {
      taskEvents.removeListener('stateChange', handler);
      signal?.removeEventListener('abort', onAbort);
    };

    taskEvents.on('stateChange', handler);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Wait for a task to reach a terminal state or input_required.
 * Used by tasks/result handler.
 */
export function waitForTerminalOrInput(taskId: string, signal?: AbortSignal): Promise<Task> {
  return waitForStateChange(
    taskId,
    (state) => TERMINAL_STATES.includes(state) || state === 'input_required',
    signal
  );
}

/**
 * Run tool execution as a background task.
 *
 * Fire-and-forget — caller does not await this.
 * Updates task state in store as execution progresses.
 * Generator yields { ask } → task enters input_required, blocks until resolveTaskInput().
 */
export function runTaskExecution(
  taskId: string,
  executeFn: (
    inputProvider: InputProvider,
    outputHandler: OutputHandler,
    inputRequestProvider: InputRequestProvider
  ) => Promise<any>,
  options: ExecutionOptions
): void {
  const { signal, outputHandler: externalOutputHandler } = options;

  // inputProvider that blocks on pending input
  const inputProvider: InputProvider = async (ask: any) => {
    if (options.inputMode === 'modern') {
      if (!options.inputRequestBuilder) {
        throw new Error('Modern task input requires an input request builder');
      }
      const response = await requestTaskInput(taskId, options.inputRequestBuilder(ask), signal);
      return options.extractInputResponse ? options.extractInputResponse(ask, response) : response;
    }
    // Store the ask payload and transition to input_required
    updateTask(taskId, {
      state: 'input_required',
      statusMessage: ask.message || 'Waiting for user input.',
      input: ask,
    });

    // Block until resolveTaskInput() or rejectTaskInput() is called
    return new Promise<any>((resolve, reject) => {
      pendingInputs.set(taskId, new Map([['legacy', { resolve, reject }]]));

      // If already aborted, reject immediately
      if (signal.aborted) {
        pendingInputs.delete(taskId);
        reject(new Error('Task cancelled'));
        return;
      }

      // Listen for abort to clean up
      const onAbort = () => {
        if (pendingInputs.has(taskId)) {
          pendingInputs.delete(taskId);
          reject(new Error('Task cancelled'));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  // outputHandler that updates task progress
  const outputHandler: OutputHandler = (data: any) => {
    if (data?.emit === 'progress' && typeof data.value === 'number') {
      updateTask(taskId, {
        progress: { percent: data.value, message: data.message },
        statusMessage: data.message || undefined,
      });
    } else if (data?.emit === 'status') {
      updateTask(taskId, {
        statusMessage: data.message || 'Processing...',
      });
    }

    // Forward to external handler (e.g., SSE broadcast)
    externalOutputHandler?.(data);
  };

  // Run in background
  void (async () => {
    try {
      if (signal.aborted) {
        updateTask(taskId, { state: 'cancelled', statusMessage: 'Task was cancelled.' });
        return;
      }

      // When input is provided and task resumes, transition back to working
      const wrappedInputProvider: InputProvider = async (ask) => {
        const result = await inputProvider(ask);
        // Resume: transition back to working
        updateTask(taskId, {
          state: 'working',
          statusMessage: 'Resuming execution...',
          input: undefined,
        });
        return result;
      };

      const inputRequestProvider: InputRequestProvider = async (requests) => {
        if (options.inputMode !== 'modern') {
          throw new Error('Multiple task input requests require the modern tasks extension');
        }
        const entries = Object.entries(requests);
        const values = await Promise.all(
          entries.map(([, request]) => requestTaskInput(taskId, request, signal))
        );
        updateTask(taskId, {
          state: 'working',
          statusMessage: 'Resuming execution...',
          inputRequests: undefined,
        });
        return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
      };

      const rawResult = await executeFn(wrappedInputProvider, outputHandler, inputRequestProvider);
      const result = options.transformResult ? await options.transformResult(rawResult) : rawResult;

      if (!signal.aborted) {
        transitionTask(taskId, ['working'], {
          state: 'completed',
          statusMessage: 'Operation completed successfully.',
          result,
        });
      }
    } catch (err) {
      if (signal.aborted) {
        transitionTask(taskId, ['working', 'input_required'], {
          state: 'cancelled',
          statusMessage: 'Task was cancelled.',
          inputRequests: undefined,
        });
      } else {
        const protocolError = options.protocolErrorFrom?.(err);
        if (protocolError) {
          transitionTask(taskId, ['working', 'input_required'], {
            state: 'failed',
            statusMessage: protocolError.message,
            error: protocolError,
            inputRequests: undefined,
          });
        } else if (options.transformErrorToResult) {
          const result = await options.transformErrorToResult(err);
          transitionTask(taskId, ['working', 'input_required'], {
            state: 'completed',
            statusMessage: 'Operation completed with a tool error.',
            result,
            inputRequests: undefined,
          });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const error: string | TaskProtocolError =
            options.inputMode === 'modern' ? { code: -32603, message } : message;
          transitionTask(taskId, ['working', 'input_required'], {
            state: 'failed',
            statusMessage: message,
            error,
            inputRequests: undefined,
          });
        }
      }
    } finally {
      // Clean up any lingering pending input
      rejectAllTaskInputs(taskId, 'Task execution ended');
      unregisterController(taskId);
    }
  })();
}
