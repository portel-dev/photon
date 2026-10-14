import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskRuntime } from '../src/tasks/runtime.js';
import type { Task } from '../src/tasks/types.js';

const root = mkdtempSync(join(tmpdir(), 'photon-task-recovery-'));
const active: Task = {
  id: 'task_restart',
  photon: 'demo',
  method: 'run',
  state: 'working',
  ttl: 1000,
  pollInterval: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const file = join(root, 'task_restart.json');
writeFileSync(file, JSON.stringify(active));
let current: Task | null = active;
const runtime = new TaskRuntime({
  getTask: () => current,
  updateTask: (_id, updates) => {
    current = { ...current!, ...updates } as Task;
    return current;
  },
  recover: () => {
    current = {
      ...current!,
      state: 'failed',
      statusMessage: 'Task execution was interrupted by a server restart.',
    };
    return 1;
  },
  listTasks: () => (current ? [current] : []),
});
try {
  assert.equal(runtime.getTask('task_restart')?.state, 'failed');
  assert.equal(runtime.listTasks()[0]?.state, 'failed');
  console.log('task runtime recovery tests passed');
} finally {
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
