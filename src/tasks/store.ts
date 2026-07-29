/**
 * MCP Task Store (spec v2025-11-25)
 *
 * File-based persistence at ~/.photon/tasks/.
 * Each task is a JSON file: {taskId}.json
 * EventEmitter for state change notifications.
 */

import { mkdirSync, readdirSync, unlinkSync, existsSync, renameSync, writeFileSync } from 'fs';
import { readJSONSync } from '../shared/io.js';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  type Task,
  type TaskAccessBinding,
  type TaskProtocol,
  TERMINAL_STATES,
  DEFAULT_TTL,
  DEFAULT_POLL_INTERVAL,
  MAX_TASK_TTL,
} from './types.js';
import type { TracePropagationContext } from '../telemetry/propagation.js';
import { validateTracePropagation } from '../telemetry/propagation.js';
import { getTasksDir, getLegacyTasksDir } from '@portel/photon-core';
import { getDefaultContext } from '../context.js';

/**
 * Resolve the tasks directory at call time rather than module import.
 *
 * A long-lived daemon serves multiple PHOTON_DIRs over its lifetime;
 * freezing the path at import meant every task landed under whichever
 * base imported first. Resolving per-call lets each task live under the
 * PHOTON_DIR active at the moment of creation. The legacy fallback is
 * only consulted if the new path does not yet exist, matching the
 * migration pattern used elsewhere.
 */
function resolveTasksDir(): string {
  const newDir = getTasksDir(getDefaultContext().baseDir);
  if (existsSync(newDir)) return newDir;
  const legacyDir = getLegacyTasksDir();
  if (existsSync(legacyDir)) return legacyDir;
  return newDir;
}

/** Ensure tasks directory exists (idempotent) */
function ensureDir(): void {
  mkdirSync(resolveTasksDir(), { recursive: true });
}

function taskPath(id: string): string {
  return join(resolveTasksDir(), `${id}.json`);
}

function writeTaskFile(task: Task): void {
  const destination = taskPath(task.id);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(task, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, destination);
}

/** Event emitter for task state changes */
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50); // Multiple SSE sessions may listen

/** Active task AbortControllers for cancellation */
const activeControllers = new Map<string, AbortController>();

export function registerController(taskId: string, controller: AbortController): void {
  activeControllers.set(taskId, controller);
}

export function unregisterController(taskId: string): void {
  activeControllers.delete(taskId);
}

export function getController(taskId: string): AbortController | undefined {
  return activeControllers.get(taskId);
}

export function createTask(
  photon: string,
  method: string,
  params?: Record<string, unknown>,
  ttl?: number,
  options: {
    protocol?: TaskProtocol;
    owner?: TaskAccessBinding;
    pollInterval?: number;
    traceContext?: TracePropagationContext;
  } = {}
): Task {
  ensureDir();
  recoverInterruptedTasks();
  const now = new Date().toISOString();
  const normalizedTtl =
    typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0
      ? Math.min(Math.floor(ttl), MAX_TASK_TTL)
      : DEFAULT_TTL;
  const normalizedPollInterval =
    typeof options.pollInterval === 'number' &&
    Number.isFinite(options.pollInterval) &&
    options.pollInterval > 0
      ? Math.min(Math.floor(options.pollInterval), 60_000)
      : DEFAULT_POLL_INTERVAL;
  const propagation = validateTracePropagation(options.traceContext ?? {});
  const task: Task = {
    id: `task_${randomBytes(32).toString('base64url')}`,
    photon,
    method,
    params,
    state: 'working',
    statusMessage: 'The operation is now in progress.',
    ttl: normalizedTtl,
    pollInterval: normalizedPollInterval,
    protocol: options.protocol ?? 'legacy-2025',
    ...(options.owner ? { owner: options.owner } : {}),
    ...(propagation.ok && Object.keys(propagation.context).length > 0
      ? { traceContext: propagation.context }
      : {}),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  writeTaskFile(task);
  taskEvents.emit('stateChange', task.id, task.state, task);
  return task;
}

export function getTask(id: string): Task | null {
  ensureDir();
  recoverInterruptedTasks();
  const p = taskPath(id);
  if (!existsSync(p)) return null;
  try {
    return readJSONSync(p);
  } catch {
    return null;
  }
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      Task,
      | 'state'
      | 'statusMessage'
      | 'progress'
      | 'result'
      | 'error'
      | 'input'
      | 'inputRequests'
      | 'inputRequestSequence'
    >
  >
): Task | null {
  const task = getTask(id);
  if (!task) return null;

  const oldState = task.state;
  Object.assign(task, updates, {
    revision: (task.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  });
  writeTaskFile(task);

  if (updates.state && updates.state !== oldState) {
    taskEvents.emit('stateChange', id, task.state, task);
  }

  return task;
}

/**
 * Compare-and-transition helper. JavaScript execution is single-threaded
 * between this synchronous read and atomic rename, preventing completion and
 * cancellation from overwriting one another inside a Photon process.
 */
export function transitionTask(
  id: string,
  from: readonly Task['state'][],
  updates: Parameters<typeof updateTask>[1]
): Task | null {
  const task = getTask(id);
  if (!task || !from.includes(task.state)) return task;
  return updateTask(id, updates);
}

export function listTasks(photon?: string): Task[] {
  ensureDir();
  recoverInterruptedTasks();
  const files = readdirSync(resolveTasksDir()).filter((f) => f.endsWith('.json'));
  const tasks: Task[] = [];
  for (const file of files) {
    try {
      const task: Task = readJSONSync(join(resolveTasksDir(), file));
      if (!photon || task.photon === photon) {
        tasks.push(task);
      }
    } catch {
      // Skip corrupt files
    }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Clean expired task records.
 *
 * Legacy retention starts at the last terminal update and never deletes active
 * tasks. The modern draft defines TTL from creation, so modern records are
 * eligible regardless of state; an active controller is aborted before removal.
 */
export function cleanExpiredTasks(ttlOverride?: number): number {
  ensureDir();
  const files = readdirSync(resolveTasksDir()).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  let cleaned = 0;
  for (const file of files) {
    try {
      const task: Task = readJSONSync(join(resolveTasksDir(), file));
      const isModern = task.protocol === 'extension-2026';
      if (!isModern && !TERMINAL_STATES.includes(task.state)) continue;

      const age = now - new Date(isModern ? task.createdAt : task.updatedAt).getTime();
      const ttl = ttlOverride ?? task.ttl ?? DEFAULT_TTL;

      if (age > ttl) {
        getController(task.id)?.abort();
        unregisterController(task.id);
        unlinkSync(join(resolveTasksDir(), file));
        cleaned++;
      }
    } catch {
      // Skip corrupt files
    }
  }
  return cleaned;
}

const recoveredDirectories = new Set<string>();

/**
 * JavaScript continuations cannot be serialized safely. On the first access to
 * a task directory in a process, persisted non-terminal records from a prior
 * process become an explicit failed state instead of remaining stuck forever.
 */
export function recoverInterruptedTasks(): number {
  ensureDir();
  const directory = resolveTasksDir();
  if (recoveredDirectories.has(directory)) return 0;
  recoveredDirectories.add(directory);
  let recovered = 0;
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    try {
      const task: Task = readJSONSync(join(directory, file));
      if (TERMINAL_STATES.includes(task.state)) continue;
      task.state = 'failed';
      task.statusMessage = 'Task execution was interrupted by a server restart.';
      task.error = {
        code: -32603,
        message: 'Task execution was interrupted by a server restart',
        data: { code: 'PHOTON_TASK_INTERRUPTED_BY_RESTART' },
      };
      task.input = undefined;
      task.inputRequests = undefined;
      task.revision = (task.revision ?? 0) + 1;
      task.updatedAt = new Date().toISOString();
      writeTaskFile(task);
      recovered++;
    } catch {
      // Corrupt records remain isolated and unreadable.
    }
  }
  return recovered;
}

/** Return the current tasks dir — resolves per call so tests can switch PHOTON_DIR. */
export function _getTasksDir(): string {
  return resolveTasksDir();
}

// Startup cleanup and periodic retention enforcement.
try {
  const cleaned = cleanExpiredTasks();
  if (cleaned > 0) {
    console.error(`🗑️  Cleaned ${cleaned} expired task(s)`);
  }
} catch {
  // Best effort
}

const taskMaintenanceTimer = setInterval(() => {
  try {
    cleanExpiredTasks();
  } catch {
    // Best effort
  }
}, 60_000);
taskMaintenanceTimer.unref();
