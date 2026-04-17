/**
 * MCP Task Store (spec v2025-11-25)
 *
 * File-based persistence at ~/.photon/tasks/.
 * Each task is a JSON file: {taskId}.json
 * EventEmitter for state change notifications.
 */

import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { readJSONSync, writeJSONSync } from '../shared/io.js';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { type Task, TERMINAL_STATES, DEFAULT_TTL, DEFAULT_POLL_INTERVAL } from './types.js';
import { getTasksDir, getLegacyTasksDir } from '@portel/photon-core';

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
  const newDir = getTasksDir();
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
  ttl?: number
): Task {
  ensureDir();
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    photon,
    method,
    params,
    state: 'working',
    statusMessage: 'The operation is now in progress.',
    ttl: ttl ?? DEFAULT_TTL,
    pollInterval: DEFAULT_POLL_INTERVAL,
    createdAt: now,
    updatedAt: now,
  };
  writeJSONSync(taskPath(task.id), task);
  taskEvents.emit('stateChange', task.id, task.state, task);
  return task;
}

export function getTask(id: string): Task | null {
  ensureDir();
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
    Pick<Task, 'state' | 'statusMessage' | 'progress' | 'result' | 'error' | 'input'>
  >
): Task | null {
  const task = getTask(id);
  if (!task) return null;

  const oldState = task.state;
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  writeJSONSync(taskPath(id), task);

  // Emit on any state transition
  if (updates.state && updates.state !== oldState) {
    taskEvents.emit('stateChange', id, task.state, task);
  }

  return task;
}

export function listTasks(photon?: string): Task[] {
  ensureDir();
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
 * Clean expired tasks — removes terminal tasks past their TTL
 * and also removes non-terminal tasks that have been alive longer than their TTL
 */
export function cleanExpiredTasks(): number {
  ensureDir();
  const files = readdirSync(resolveTasksDir()).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  let cleaned = 0;
  for (const file of files) {
    try {
      const task: Task = readJSONSync(join(resolveTasksDir(), file));
      const age = now - new Date(task.createdAt).getTime();
      const ttl = task.ttl || DEFAULT_TTL;

      if (age > ttl) {
        // Terminal tasks: always clean
        // Non-terminal tasks past TTL: force-cancel and clean
        if (TERMINAL_STATES.includes(task.state)) {
          unlinkSync(join(resolveTasksDir(), file));
          cleaned++;
        } else {
          // Force-cancel stale non-terminal tasks
          const controller = getController(task.id);
          if (controller) controller.abort();
          unregisterController(task.id);
          unlinkSync(join(resolveTasksDir(), file));
          cleaned++;
        }
      }
    } catch {
      // Skip corrupt files
    }
  }
  return cleaned;
}

/** Return the current tasks dir — resolves per call so tests can switch PHOTON_DIR. */
export function _getTasksDir(): string {
  return resolveTasksDir();
}

// Startup cleanup
try {
  const cleaned = cleanExpiredTasks();
  if (cleaned > 0) {
    console.error(`🗑️  Cleaned ${cleaned} expired task(s)`);
  }
} catch {
  // Best effort
}
