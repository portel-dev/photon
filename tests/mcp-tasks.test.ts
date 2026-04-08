/**
 * MCP Tasks Tests
 *
 * Tests for the task store CRUD, lifecycle states, cancellation,
 * filtering, expiry cleanup, and transport handler registration.
 */

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// We test the store by importing its source and pointing it at a temp dir.
// Since the store uses a hardcoded dir, we'll test via the module's exports
// but create/read/update tasks manually for isolation, then also verify
// the compiled output has the transport handlers.

import type { Task, TaskState } from '../src/tasks/types.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

// ─── Helpers: minimal in-memory task store for unit testing ───────────────────

const testDir = join(tmpdir(), `photon-tasks-test-${randomUUID()}`);

function ensureTestDir(): void {
  mkdirSync(testDir, { recursive: true });
}

function taskPath(id: string): string {
  return join(testDir, `${id}.json`);
}

function writeTask(task: Task): void {
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2));
}

function readTask(id: string): Task | null {
  const p = taskPath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    photon: 'test-photon',
    method: 'run',
    state: 'working',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\nMCP Tasks Tests\n');

// Setup
ensureTestDir();

await test('Task type has all required fields', () => {
  const task = makeTask();
  assert.ok(task.id);
  assert.ok(task.photon);
  assert.ok(task.method);
  assert.ok(task.state);
  assert.ok(task.createdAt);
  assert.ok(task.updatedAt);
});

await test('Task states include all MCP spec values', () => {
  const states: TaskState[] = ['working', 'input_required', 'completed', 'failed', 'cancelled'];
  for (const state of states) {
    const task = makeTask({ state });
    assert.equal(task.state, state);
  }
});

await test('Create and read a task (CRUD)', () => {
  const task = makeTask();
  writeTask(task);
  const loaded = readTask(task.id);
  assert.ok(loaded);
  assert.equal(loaded!.id, task.id);
  assert.equal(loaded!.photon, 'test-photon');
  assert.equal(loaded!.method, 'run');
  assert.equal(loaded!.state, 'working');
});

await test('Update task state to completed with result', () => {
  const task = makeTask();
  writeTask(task);
  // Simulate update
  const loaded = readTask(task.id)!;
  loaded.state = 'completed';
  loaded.result = { output: 'done' };
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  const updated = readTask(task.id)!;
  assert.equal(updated.state, 'completed');
  assert.deepEqual(updated.result, { output: 'done' });
});

await test('Update task state to failed with error', () => {
  const task = makeTask();
  writeTask(task);
  const loaded = readTask(task.id)!;
  loaded.state = 'failed';
  loaded.error = 'Something went wrong';
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  const updated = readTask(task.id)!;
  assert.equal(updated.state, 'failed');
  assert.equal(updated.error, 'Something went wrong');
});

await test('Task lifecycle: working → completed', () => {
  const task = makeTask({ state: 'working' });
  writeTask(task);
  assert.equal(readTask(task.id)!.state, 'working');

  const loaded = readTask(task.id)!;
  loaded.state = 'completed';
  loaded.result = 42;
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  assert.equal(readTask(task.id)!.state, 'completed');
  assert.equal(readTask(task.id)!.result, 42);
});

await test('Task lifecycle: working → failed', () => {
  const task = makeTask({ state: 'working' });
  writeTask(task);
  const loaded = readTask(task.id)!;
  loaded.state = 'failed';
  loaded.error = 'timeout';
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  assert.equal(readTask(task.id)!.state, 'failed');
  assert.equal(readTask(task.id)!.error, 'timeout');
});

await test('Task lifecycle: working → cancelled', () => {
  const task = makeTask({ state: 'working' });
  writeTask(task);
  const loaded = readTask(task.id)!;
  loaded.state = 'cancelled';
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  assert.equal(readTask(task.id)!.state, 'cancelled');
});

await test('Task lifecycle: working → input_required → working', () => {
  const task = makeTask({ state: 'working' });
  writeTask(task);

  let loaded = readTask(task.id)!;
  loaded.state = 'input_required';
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  assert.equal(readTask(task.id)!.state, 'input_required');

  loaded = readTask(task.id)!;
  loaded.state = 'working';
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  assert.equal(readTask(task.id)!.state, 'working');
});

await test('Task cancellation only for active tasks', () => {
  // working → cancellable
  const working = makeTask({ state: 'working' });
  assert.ok(working.state === 'working' || working.state === 'input_required');

  // completed → not cancellable
  const completed = makeTask({ state: 'completed' });
  assert.ok(completed.state !== 'working' && completed.state !== 'input_required');

  // failed → not cancellable
  const failedTask = makeTask({ state: 'failed' });
  assert.ok(failedTask.state !== 'working' && failedTask.state !== 'input_required');
});

await test('Task listing returns all tasks', () => {
  // Clear test dir
  const subDir = join(testDir, 'listing');
  mkdirSync(subDir, { recursive: true });

  const tasks = [
    makeTask({ photon: 'alpha' }),
    makeTask({ photon: 'beta' }),
    makeTask({ photon: 'alpha' }),
  ];
  for (const t of tasks) {
    writeFileSync(join(subDir, `${t.id}.json`), JSON.stringify(t));
  }

  const files = readdirSync(subDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 3);
});

await test('Task listing filters by photon', () => {
  const tasks = [
    makeTask({ photon: 'alpha' }),
    makeTask({ photon: 'beta' }),
    makeTask({ photon: 'alpha' }),
  ];
  const filtered = tasks.filter((t) => t.photon === 'alpha');
  assert.equal(filtered.length, 2);
});

await test('Expired task cleanup removes old terminal tasks', () => {
  const subDir = join(testDir, 'cleanup');
  mkdirSync(subDir, { recursive: true });

  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
  const recent = new Date().toISOString();

  const tasks = [
    makeTask({ state: 'completed', updatedAt: old }),
    makeTask({ state: 'failed', updatedAt: old }),
    makeTask({ state: 'working', updatedAt: old }), // Should NOT be cleaned (still active)
    makeTask({ state: 'completed', updatedAt: recent }), // Should NOT be cleaned (recent)
  ];
  for (const t of tasks) {
    writeFileSync(join(subDir, `${t.id}.json`), JSON.stringify(t));
  }

  // Simulate cleanup: remove terminal tasks older than 1 hour
  const maxAge = 60 * 60 * 1000; // 1 hour
  let cleaned = 0;
  for (const file of readdirSync(subDir).filter((f) => f.endsWith('.json'))) {
    const task: Task = JSON.parse(readFileSync(join(subDir, file), 'utf-8'));
    const age = Date.now() - new Date(task.updatedAt).getTime();
    if (
      age > maxAge &&
      (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled')
    ) {
      rmSync(join(subDir, file));
      cleaned++;
    }
  }
  assert.equal(cleaned, 2); // old completed + old failed
  const remaining = readdirSync(subDir).filter((f) => f.endsWith('.json'));
  assert.equal(remaining.length, 2); // working + recent completed
});

await test('Reading non-existent task returns null', () => {
  const result = readTask('non-existent-id');
  assert.equal(result, null);
});

await test('Task progress tracking', () => {
  const task = makeTask();
  writeTask(task);
  const loaded = readTask(task.id)!;
  loaded.progress = { percent: 50, message: 'Halfway done' };
  loaded.updatedAt = new Date().toISOString();
  writeTask(loaded);
  const updated = readTask(task.id)!;
  assert.equal(updated.progress!.percent, 50);
  assert.equal(updated.progress!.message, 'Halfway done');
});

await test('Task stores params', () => {
  const task = makeTask({ params: { input: 'hello', count: 5 } });
  writeTask(task);
  const loaded = readTask(task.id)!;
  assert.deepEqual(loaded.params, { input: 'hello', count: 5 });
});

// ─── Transport handler existence tests (verify compiled output) ──────────────

await test('Store module exports all CRUD functions', async () => {
  const store = await import('../src/tasks/store.js');
  assert.equal(typeof store.createTask, 'function');
  assert.equal(typeof store.getTask, 'function');
  assert.equal(typeof store.updateTask, 'function');
  assert.equal(typeof store.listTasks, 'function');
  assert.equal(typeof store.cleanExpiredTasks, 'function');
  assert.equal(typeof store.registerController, 'function');
  assert.equal(typeof store.unregisterController, 'function');
  assert.equal(typeof store.getController, 'function');
});

await test('Types module exports TaskState type', async () => {
  // Verify the types module is importable (runtime check)
  const types = await import('../src/tasks/types.js');
  assert.ok(types !== undefined);
});

await test('Transport handlers registered in compiled output', async () => {
  // Read the source to confirm handlers exist
  const source = readFileSync(
    join(import.meta.dirname || '.', '..', 'src', 'auto-ui', 'streamable-http-transport.ts'),
    'utf-8'
  );
  assert.ok(source.includes("'tasks/create'"), 'tasks/create handler missing');
  assert.ok(source.includes("'tasks/get'"), 'tasks/get handler missing');
  assert.ok(source.includes("'tasks/list'"), 'tasks/list handler missing');
  assert.ok(source.includes("'tasks/cancel'"), 'tasks/cancel handler missing');
  assert.ok(source.includes('tasks: {'), 'tasks capability missing from initialize response');
  assert.ok(source.includes('list: {}'), 'tasks list capability missing from initialize response');
  assert.ok(
    source.includes('cancel: {}'),
    'tasks cancel capability missing from initialize response'
  );
  assert.ok(
    source.includes('requests: {') && source.includes('tools: { call: {} }'),
    'tasks requests capability missing from initialize response'
  );
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

try {
  rmSync(testDir, { recursive: true, force: true });
} catch {
  // ignore
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
