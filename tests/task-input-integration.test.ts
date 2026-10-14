import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskRuntime } from '../src/tasks/runtime.js';
import { runTaskExecution } from '../src/tasks/executor.js';
import type { Task } from '../src/tasks/types.js';

const directory = mkdtempSync(join(tmpdir(), 'photon-task-input-'));
const tasks = new Map<string, Task>([
  [
    'task',
    {
      id: 'task',
      photon: 'demo',
      method: 'ask',
      state: 'working',
      ttl: 1000,
      pollInterval: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
]);
const runtime = new TaskRuntime({
  getTask: (id) => tasks.get(id) ?? null,
  updateTask: (id, updates) => {
    const task = tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    runtime.events.emit('stateChange', id, task.state, task);
    return task;
  },
});

try {
  const controller = new AbortController();
  runtime.registerController('task', controller);
  let answer = '';
  runTaskExecution(
    'task',
    async (inputProvider) => {
      answer = await inputProvider({ message: 'enter value' });
      return answer;
    },
    { signal: controller.signal, runtime }
  );

  for (let attempt = 0; attempt < 50 && tasks.get('task')?.state !== 'input_required'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(tasks.get('task')?.state, 'input_required');
  assert.equal(runtime.resolveTaskInput('task', 'accepted'), true);
  for (let attempt = 0; attempt < 50 && tasks.get('task')?.state !== 'completed'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(answer, 'accepted');
  assert.equal(tasks.get('task')?.state, 'completed');
  console.log('task input integration test passed');
} finally {
  runtime.close();
  rmSync(directory, { recursive: true, force: true });
}
