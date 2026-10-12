/**
 * TaskExecutor — extracted from PhotonServer
 *
 * Encapsulates all MCP Tasks protocol handling (spec v2025-11-25):
 * - Task creation from tool calls (task mode)
 * - GetTask, ListTasks, CancelTask, GetTaskPayload handlers
 * - Input resolution via elicitation
 *
 * Dependency direction: PhotonServer → TaskExecutor (never the reverse).
 */

import type { Server } from './mcp/sdk-v2-2026/server.js';
import {
  createTask,
  getTask,
  transitionTask,
  listTasks,
  registerController,
  getController,
  unregisterController,
} from './tasks/store.js';
import { toWireFormat, relatedTaskMeta, taskErrorMessage, TERMINAL_STATES } from './tasks/types.js';
import type { Task, TaskAccessBinding } from './tasks/types.js';
import { runTaskExecution, resolveTaskInput, waitForTerminalOrInput } from './tasks/executor.js';
import type { LogLevel } from './shared/logger.js';
import type {
  PhotonClassExtended,
  CallerInfo,
  InputProvider,
  OutputHandler,
  SamplingProvider,
} from '@portel/photon-core';
import type { PhotonExecutionRequestContext } from './telemetry/context.js';
import type { PhotonAppContext } from './app-context.js';
import type { ToolInvocationPort, ToolInvocationOptions } from './tool-invocation.js';
import { taskAccessMatches } from './tasks/access.js';

/** Narrow invocation port: callers must provide the real hydrated Photon target. */
export type ToolExecutor = ToolInvocationPort;

export interface TaskExecutionOptions {
  outputHandler?: OutputHandler;
  inputProvider?: InputProvider;
  samplingProvider?: SamplingProvider;
  caller?: CallerInfo;
  requestContext?: PhotonExecutionRequestContext;
  roots?: Array<{ uri: string; name?: string }>;
  appContext?: PhotonAppContext;
  traceId?: string;
  owner?: TaskAccessBinding;
}

/** Minimal interface for creating an input provider via MCP elicitation */
export interface InputProviderFactory {
  createMCPInputProvider(server?: Server): (ask: any) => Promise<any>;
}

/** Logger callback matching PhotonServer's log() signature */
export type TaskLog = (level: LogLevel, message: string, meta?: Record<string, any>) => void;

export class TaskExecutor {
  constructor(
    private log: TaskLog,
    private toolExecutor: ToolExecutor,
    private inputProviderFactory: InputProviderFactory
  ) {}

  /**
   * Handle task-mode tool call: when request params contain a `task` field,
   * run the tool asynchronously and return a task reference.
   *
   * Returns the MCP response if task mode applies, or null if it doesn't.
   */
  handleTaskModeCall(
    photon: PhotonClassExtended,
    toolName: string,
    args: Record<string, unknown>,
    taskField: { ttl?: number },
    options: TaskExecutionOptions = {}
  ): { content: Array<{ type: string; text: string }> } {
    const photonName = photon.name;
    const ttl = typeof taskField.ttl === 'number' ? taskField.ttl : undefined;
    this.log('info', 'Starting background task', { photon: photonName, tool: toolName });
    const task = createTask(photonName, toolName, args, ttl, {
      owner: options.owner,
      traceContext: options.requestContext
        ? {
            traceparent: options.requestContext.traceparent,
            tracestate: options.requestContext.tracestate,
            baggage: options.requestContext.baggage,
          }
        : undefined,
    });
    const controller = new AbortController();
    registerController(task.id, controller);

    const executeFn = async (taskInputProvider: InputProvider, outputHandler: OutputHandler) => {
      return this.toolExecutor.execute(photon, toolName, args, {
        ...options,
        outputHandler,
        inputProvider: taskInputProvider,
        signal: controller.signal,
      } as ToolInvocationOptions);
    };

    runTaskExecution(task.id, executeFn, {
      signal: controller.signal,
      caller: options.caller,
      ...(options.outputHandler
        ? { outputHandler: (data: any) => void options.outputHandler?.(data) }
        : {}),
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({ task: toWireFormat(task) }, null, 2) }],
    };
  }

  /**
   * Handle tasks/get — returns wire-format task status.
   */
  handleGetTask(taskId: string, owner?: TaskAccessBinding): any {
    const task = getTask(taskId);
    if (!task || !taskAccessMatches(task, owner)) throw new Error(`Task not found: ${taskId}`);
    return toWireFormat(task);
  }

  /**
   * Handle tasks/list — returns paginated task list.
   */
  handleListTasks(cursor?: string, owner?: TaskAccessBinding): any {
    const allTasks = listTasks().filter((task) => taskAccessMatches(task, owner));
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
    const pageSize = 50;
    const page = allTasks.slice(offset, offset + pageSize);
    const nextCursor = offset + pageSize < allTasks.length ? String(offset + pageSize) : undefined;
    return {
      tasks: page.map(toWireFormat),
      ...(nextCursor && { nextCursor }),
    };
  }

  /**
   * Handle tasks/cancel — aborts the task and returns updated status.
   */
  handleCancelTask(taskId: string, owner?: TaskAccessBinding): any {
    const task = getTask(taskId);
    if (!task || !taskAccessMatches(task, owner)) throw new Error(`Task not found: ${taskId}`);
    if (TERMINAL_STATES.includes(task.state)) {
      throw new Error(`Cannot cancel task in terminal state: ${task.state}`);
    }
    const controller = getController(taskId);
    if (controller) controller.abort();
    const updated = transitionTask(taskId, ['working', 'input_required'], {
      state: 'cancelled',
      statusMessage: 'The task was cancelled by request.',
      input: undefined,
      inputRequests: undefined,
    });
    unregisterController(taskId);
    if (!updated || updated.state !== 'cancelled') {
      throw new Error(`Cannot cancel task in terminal state: ${updated?.state ?? task.state}`);
    }
    return toWireFormat(updated);
  }

  /**
   * Handle tasks/get_result — blocks until task completes or times out.
   * Handles input_required states via elicitation.
   */
  async handleGetTaskPayload(
    taskId: string,
    server: Server,
    owner?: TaskAccessBinding
  ): Promise<any> {
    const task = getTask(taskId);
    if (!task || !taskAccessMatches(task, owner)) throw new Error(`Task not found: ${taskId}`);

    // Already terminal — return immediately
    if (TERMINAL_STATES.includes(task.state)) {
      return this.formatTaskResult(task, taskId);
    }

    // If input_required, try to get input via elicitation
    if (task.state === 'input_required' && task.input) {
      const inputProvider = this.inputProviderFactory.createMCPInputProvider(server);
      try {
        const value = await inputProvider(task.input);
        resolveTaskInput(taskId, value);
      } catch {
        resolveTaskInput(taskId, null);
      }
    }

    // Block until terminal (max 5 min per call)
    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 300000);
      try {
        while (true) {
          const current = await waitForTerminalOrInput(taskId, abortController.signal);
          if (TERMINAL_STATES.includes(current.state)) {
            return this.formatTaskResult(current, taskId);
          }
          if (current.state === 'input_required' && current.input) {
            const inputProvider = this.inputProviderFactory.createMCPInputProvider(server);
            try {
              const value = await inputProvider(current.input);
              resolveTaskInput(taskId, value);
            } catch {
              resolveTaskInput(taskId, null);
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      const current = getTask(taskId);
      if (current && TERMINAL_STATES.includes(current.state)) {
        return this.formatTaskResult(current, taskId);
      }
      return {
        content: [{ type: 'text' as const, text: `Task ${taskId} is still running.` }],
        isError: false,
        _meta: relatedTaskMeta(taskId),
      };
    }
  }

  /**
   * Format a terminal task result for MCP response.
   */
  private formatTaskResult(task: Task, taskId: string): any {
    if (task.state === 'failed') {
      return {
        content: [{ type: 'text' as const, text: taskErrorMessage(task.error) }],
        isError: true,
        _meta: relatedTaskMeta(taskId),
      };
    }
    if (task.state === 'cancelled') {
      return {
        content: [{ type: 'text' as const, text: 'Task was cancelled.' }],
        isError: false,
        _meta: relatedTaskMeta(taskId),
      };
    }
    // Completed
    if (task.result && typeof task.result === 'object' && 'content' in task.result) {
      return { ...(task.result as Record<string, unknown>), _meta: relatedTaskMeta(taskId) };
    }
    const text =
      typeof task.result === 'string' ? task.result : JSON.stringify(task.result ?? null);
    return {
      content: [{ type: 'text' as const, text }],
      isError: false,
      _meta: relatedTaskMeta(taskId),
    };
  }
}
