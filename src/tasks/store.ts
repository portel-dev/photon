/**
 * MCP Task Store
 *
 * File-based persistence at ~/.photon/tasks/.
 * Each task is a JSON file: {taskId}.json
 * Consistent with existing photon file-based patterns (audit, runs, state).
 */

import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { readJSONSync, writeJSONSync } from '../shared/io.js';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Task } from './types.js';

const TASKS_DIR = join(homedir(), '.photon', 'tasks');

/** Ensure tasks directory exists (idempotent) */
function ensureDir(): void {
  mkdirSync(TASKS_DIR, { recursive: true });
}

function taskPath(id: string): string {
  return join(TASKS_DIR, `${id}.json`);
}

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

export function createTask(photon: string, method: string, params?: Record<string, unknown>): Task {
  ensureDir();
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    photon,
    method,
    params,
    state: 'working',
    createdAt: now,
    updatedAt: now,
  };
  writeJSONSync(taskPath(task.id), task);
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
  updates: Partial<Pick<Task, 'state' | 'progress' | 'result' | 'error'>>
): Task | null {
  const task = getTask(id);
  if (!task) return null;
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  writeJSONSync(taskPath(id), task);
  return task;
}

export function listTasks(photon?: string): Task[] {
  ensureDir();
  const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith('.json'));
  const tasks: Task[] = [];
  for (const file of files) {
    try {
      const task: Task = readJSONSync(join(TASKS_DIR, file));
      if (!photon || task.photon === photon) {
        tasks.push(task);
      }
    } catch {
      // Skip corrupt files
    }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function cleanExpiredTasks(maxAgeMs: number): number {
  ensureDir();
  const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  let cleaned = 0;
  for (const file of files) {
    try {
      const task: Task = readJSONSync(join(TASKS_DIR, file));
      const age = now - new Date(task.updatedAt).getTime();
      if (
        age > maxAgeMs &&
        (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled')
      ) {
        unlinkSync(join(TASKS_DIR, file));
        cleaned++;
      }
    } catch {
      // Skip corrupt files
    }
  }
  return cleaned;
}

/** Override tasks dir for testing */
export function _getTasksDir(): string {
  return TASKS_DIR;
}
