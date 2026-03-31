/**
 * MCP Task Executor (spec v2025-11-25)
 *
 * Runs tool execution in the background with support for input resumption.
 * Decoupled from transport — works with both Streamable HTTP and STDIO.
 */

import { updateTask, unregisterController, taskEvents } from './store.js';
import { TERMINAL_STATES, type Task, type TaskState } from './types.js';

type OutputHandler = (data: any) => void;
type InputProvider = (ask: any) => Promise<any>;

interface ExecutionOptions {
  signal: AbortSignal;
  caller?: any;
  outputHandler?: OutputHandler;
}

/**
 * Pending input resolvers — when a task enters input_required,
 * the generator blocks on a promise. resolveTaskInput() resolves it.
 */
const pendingInputs = new Map<
  string,
  { resolve: (value: any) => void; reject: (err: Error) => void }
>();

/**
 * Resolve pending input for a task, resuming generator execution.
 * Returns true if there was pending input to resolve.
 */
export function resolveTaskInput(taskId: string, value: any): boolean {
  const pending = pendingInputs.get(taskId);
  if (!pending) return false;
  pendingInputs.delete(taskId);
  pending.resolve(value);
  return true;
}

/**
 * Reject pending input (e.g., on cancellation or timeout).
 */
export function rejectTaskInput(taskId: string, reason: string): boolean {
  const pending = pendingInputs.get(taskId);
  if (!pending) return false;
  pendingInputs.delete(taskId);
  pending.reject(new Error(reason));
  return true;
}

/**
 * Check if a task has pending input waiting.
 */
export function hasPendingInput(taskId: string): boolean {
  return pendingInputs.has(taskId);
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
  executeFn: (inputProvider: InputProvider, outputHandler: OutputHandler) => Promise<any>,
  options: ExecutionOptions
): void {
  const { signal, outputHandler: externalOutputHandler } = options;

  // inputProvider that blocks on pending input
  const inputProvider: InputProvider = async (ask: any) => {
    // Store the ask payload and transition to input_required
    updateTask(taskId, {
      state: 'input_required',
      statusMessage: ask.message || 'Waiting for user input.',
      input: ask,
    });

    // Block until resolveTaskInput() or rejectTaskInput() is called
    return new Promise<any>((resolve, reject) => {
      pendingInputs.set(taskId, { resolve, reject });

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

      const result = await executeFn(wrappedInputProvider, outputHandler);

      if (!signal.aborted) {
        updateTask(taskId, {
          state: 'completed',
          statusMessage: 'Operation completed successfully.',
          result,
        });
      }
    } catch (err) {
      if (signal.aborted) {
        updateTask(taskId, { state: 'cancelled', statusMessage: 'Task was cancelled.' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        updateTask(taskId, {
          state: 'failed',
          statusMessage: message,
          error: message,
        });
      }
    } finally {
      // Clean up any lingering pending input
      pendingInputs.delete(taskId);
      unregisterController(taskId);
    }
  })();
}
