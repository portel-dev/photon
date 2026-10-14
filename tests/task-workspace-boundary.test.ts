import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PhotonLoader } from '../src/loader.js';
import { TaskExecutor } from '../src/task-executor.js';
import { getTaskRuntime } from '../src/tasks/store.js';
import type { PhotonClassExtended } from '@portel/photon-core';

const workspaceA = mkdtempSync(join(tmpdir(), 'photon-task-a-'));
const workspaceB = mkdtempSync(join(tmpdir(), 'photon-task-b-'));
const photon = { name: 'workspace-task', tools: [], instance: {} } as PhotonClassExtended;
const loader = new PhotonLoader(false, undefined, workspaceA);
process.env.PHOTON_DIR = workspaceA;
const runtimeA = getTaskRuntime();
const executor = new TaskExecutor(
  () => {},
  { execute: async () => ({ completed: true }) },
  { createMCPInputProvider: () => async () => 'unused' }
);

try {
  process.env.PHOTON_DIR = workspaceB;
  const response = executor.handleTaskModeCall(photon, 'run', {}, { ttl: 60_000 });
  const taskId = JSON.parse(response.content[0].text).task.taskId;
  for (let attempt = 0; attempt < 100; attempt++) {
    const runtimeB = getTaskRuntime();
    const task = runtimeB.getTask(taskId);
    if (task?.state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const completed = getTaskRuntime().getTask(taskId);
  assert.equal(completed?.state, 'completed');
  assert.equal(existsSync(join(workspaceB, '.data', 'tasks', `${taskId}.json`)), true);
  assert.equal(existsSync(join(workspaceA, '.data', 'tasks', `${taskId}.json`)), false);
  console.log('task workspace boundary tests passed');
} finally {
  runtimeA.close();
  rmSync(workspaceA, { recursive: true, force: true });
  rmSync(workspaceB, { recursive: true, force: true });
}
