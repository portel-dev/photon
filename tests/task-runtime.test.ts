import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskRuntime } from '../src/tasks/runtime.js';
import type { Task } from '../src/tasks/types.js';

function makeRuntime(
  directory: string,
  scheduler?: {
    handles: Set<object>;
    setInterval: (cb: () => void, ms: number) => object;
    clearInterval: (handle: object) => void;
  }
) {
  const tasks = new Map<string, Task>();
  let sequence = 0;
  const runtime = new TaskRuntime({
    getTask: (id) => tasks.get(id) ?? null,
    updateTask: (id, updates) => {
      const task = tasks.get(id);
      if (!task) return null;
      Object.assign(task, updates, { updatedAt: new Date().toISOString() });
      if (updates.state) runtime.events.emit('stateChange', id, task.state, task);
      return task;
    },
    scheduler,
  });
  tasks.set('task', {
    id: 'task',
    photon: 'demo',
    method: 'run',
    state: 'working',
    ttl: 1000,
    pollInterval: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { runtime, tasks, directory, next: () => `input_${++sequence}` };
}

const root = mkdtempSync(join(tmpdir(), 'photon-task-runtime-'));
const other = mkdtempSync(join(tmpdir(), 'photon-task-runtime-'));
const handles = new Set<object>();
const scheduler = {
  handles,
  setInterval: (_cb: () => void, _ms: number) => {
    const handle = {};
    handles.add(handle);
    return handle;
  },
  clearInterval: (handle: object) => {
    handles.delete(handle);
  },
};
const first = makeRuntime(root, scheduler);
const second = makeRuntime(other, scheduler);

try {
  const controller = new AbortController();
  first.runtime.registerController('task', controller);
  assert.equal(second.runtime.getController('task'), undefined);
  assert.equal(first.runtime.getController('task'), controller);

  first.runtime.startMaintenance();
  first.runtime.startMaintenance();
  assert.equal(handles.size, 1);

  const pending = first.runtime.requestLegacyInput(
    'task',
    { message: 'value' },
    new AbortController().signal
  );
  assert.equal(second.runtime.resolveTaskInput('task', 'wrong-runtime'), false);
  assert.equal(first.runtime.resolveTaskInput('task', 'accepted'), true);
  assert.equal(await pending, 'accepted');

  let events = 0;
  const listener = () => {
    events++;
  };
  first.runtime.events.on('stateChange', listener);
  second.runtime.events.emit('stateChange', 'task', 'completed', second.tasks.get('task'));
  assert.equal(events, 0);
  first.runtime.events.emit('stateChange', 'task', 'completed', first.tasks.get('task'));
  assert.equal(events, 1);

  const waiting = first.runtime.waitForTerminalOrInput('task');
  first.tasks.get('task')!.state = 'completed';
  first.runtime.events.emit('stateChange', 'task', 'completed', first.tasks.get('task'));
  assert.equal((await waiting).state, 'completed');

  first.runtime.close();
  assert.equal(controller.signal.aborted, true);
  assert.equal(handles.size, 0);
  assert.equal(first.runtime.events.listenerCount('stateChange'), 0);
} finally {
  second.runtime.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
}

console.log('task runtime tests passed');
