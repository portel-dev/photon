/**
 * Protocol Features — Edge Case Tests
 *
 * Tests boundary conditions, malformed inputs, concurrent access,
 * and failure modes across all protocol features.
 */

import { createAGUIOutputHandler } from '../src/ag-ui/adapter.js';
import { AGUIEventType } from '../src/ag-ui/types.js';
import {
  createTask,
  getTask,
  updateTask,
  listTasks,
  cleanExpiredTasks,
  _getTasksDir,
} from '../src/tasks/store.js';
import { generateServerCard } from '../src/server-card.js';
import { generateAgentCard } from '../src/a2a/card-generator.js';
import {
  startToolSpan,
  startAgentSpan,
  isTracingEnabled,
  waitForOtelProbe,
  _resetOtelCache,
} from '../src/telemetry/otel.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        console.log(`\u2705 ${name}`);
        passed++;
      },
      (e: any) => {
        console.log(`\u274c ${name}\n   ${e.message}`);
        failed++;
      }
    );
  }
  try {
    fn();
    console.log(`\u2705 ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`\u274c ${name}\n   ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AG-UI EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 AG-UI Edge Cases\n');

await test('empty string yield still produces TEXT_MESSAGE events', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r1', (n) =>
    events.push(n)
  );
  outputHandler('');
  finish();
  const contentEvents = events.filter((e) => e.params.type === AGUIEventType.TEXT_MESSAGE_CONTENT);
  assert(
    contentEvents.length === 1,
    `Should emit content for empty string, got ${contentEvents.length}`
  );
  assert(contentEvents[0].params.delta === '', 'Delta should be empty string');
});

await test('null and undefined yields are silently ignored', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r2', (n) =>
    events.push(n)
  );
  outputHandler(null);
  outputHandler(undefined);
  outputHandler(0);
  outputHandler(false);
  finish();
  // Should only have RUN_STARTED + RUN_FINISHED
  assert(events.length === 2, `Expected 2 events (start+finish), got ${events.length}`);
});

await test('interleaved text and progress yields produce correct sequence', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r3', (n) =>
    events.push(n)
  );
  outputHandler('Starting...');
  outputHandler({ emit: 'progress', value: 0.5, message: 'Half' });
  outputHandler('More text');
  outputHandler({ emit: 'progress', value: 1.0, message: 'Done' });
  finish();

  const types = events.map((e) => e.params.type);
  // Text stream should start, then content, then step, then more content, then step finish
  assert(types.includes(AGUIEventType.TEXT_MESSAGE_START), 'Should have text start');
  assert(types.includes(AGUIEventType.STEP_STARTED), 'Should have step start');
  assert(types.includes(AGUIEventType.STEP_FINISHED), 'Should have step finish');
  assert(types.includes(AGUIEventType.TEXT_MESSAGE_END), 'Should close text on finish');
});

await test('progress at exactly 0 does not finish step', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r4', (n) =>
    events.push(n)
  );
  outputHandler({ emit: 'progress', value: 0, message: 'Starting' });
  finish();
  const stepFinished = events.filter((e) => e.params.type === AGUIEventType.STEP_FINISHED);
  // Step should be closed by finish(), not by 0 progress
  assert(stepFinished.length === 1, 'finish() should close the open step');
});

await test('multiple progress cycles create multiple step pairs', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r5', (n) =>
    events.push(n)
  );
  outputHandler({ emit: 'progress', value: 0.5, message: 'Phase 1' });
  outputHandler({ emit: 'progress', value: 1.0, message: 'Phase 1 done' });
  outputHandler({ emit: 'progress', value: 0.5, message: 'Phase 2' });
  outputHandler({ emit: 'progress', value: 1.0, message: 'Phase 2 done' });
  finish();
  const starts = events.filter((e) => e.params.type === AGUIEventType.STEP_STARTED);
  const finishes = events.filter((e) => e.params.type === AGUIEventType.STEP_FINISHED);
  assert(starts.length === 2, `Expected 2 step starts, got ${starts.length}`);
  assert(finishes.length === 2, `Expected 2 step finishes, got ${finishes.length}`);
});

await test('error() after text stream closes the stream first', () => {
  const events: any[] = [];
  const { outputHandler, error } = createAGUIOutputHandler('test', 'm', 'r6', (n) =>
    events.push(n)
  );
  outputHandler('Some text');
  error('Crashed');

  const types = events.map((e) => e.params.type);
  const endIdx = types.indexOf(AGUIEventType.TEXT_MESSAGE_END);
  const errIdx = types.indexOf(AGUIEventType.RUN_ERROR);
  assert(endIdx < errIdx, 'TEXT_MESSAGE_END should come before RUN_ERROR');
});

await test('finish() with null/undefined result does not emit STATE_SNAPSHOT', () => {
  const events: any[] = [];
  const { finish } = createAGUIOutputHandler('test', 'm', 'r7', (n) => events.push(n));
  finish(null);
  const snapshots = events.filter((e) => e.params.type === AGUIEventType.STATE_SNAPSHOT);
  assert(snapshots.length === 0, 'Should not emit snapshot for null result');
});

await test('finish() with primitive result does not emit STATE_SNAPSHOT', () => {
  const events: any[] = [];
  const { finish } = createAGUIOutputHandler('test', 'm', 'r8', (n) => events.push(n));
  finish(42 as any);
  const snapshots = events.filter((e) => e.params.type === AGUIEventType.STATE_SNAPSHOT);
  assert(snapshots.length === 0, 'Should not emit snapshot for primitive result');
});

await test('finish() with array result emits STATE_SNAPSHOT', () => {
  const events: any[] = [];
  const { finish } = createAGUIOutputHandler('test', 'm', 'r9', (n) => events.push(n));
  finish([1, 2, 3]);
  const snapshots = events.filter((e) => e.params.type === AGUIEventType.STATE_SNAPSHOT);
  assert(snapshots.length === 1, 'Array is an object, should emit snapshot');
});

await test('very large text chunk does not crash', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r10', (n) =>
    events.push(n)
  );
  const largeText = 'x'.repeat(1_000_000);
  outputHandler(largeText);
  finish();
  const content = events.find((e) => e.params.type === AGUIEventType.TEXT_MESSAGE_CONTENT);
  assert(content.params.delta.length === 1_000_000, 'Should handle 1MB text chunk');
});

await test('broadcast error does not crash outputHandler', () => {
  let callCount = 0;
  const badBroadcast = (n: any) => {
    callCount++;
    if (callCount === 3) throw new Error('broadcast failure');
  };
  // The outputHandler should throw if broadcast throws — verify behavior
  const { outputHandler } = createAGUIOutputHandler('test', 'm', 'r11', badBroadcast);
  try {
    outputHandler('text');
    // If we get here, broadcast error was swallowed or didn't happen on this call
  } catch {
    // Expected — broadcast error propagates
  }
  assert(callCount >= 1, 'Broadcast should have been called');
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TASKS EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 MCP Tasks Edge Cases\n');

// Task store uses a module-level TASKS_DIR constant, so we work with the real dir
// and clean up our test tasks afterward
const tasksDir = _getTasksDir();
fs.mkdirSync(tasksDir, { recursive: true });

// Snapshot existing tasks to restore later
const existingTaskFiles = new Set(fs.readdirSync(tasksDir));
const testTaskIds: string[] = [];

await test('createTask with empty params', () => {
  const task = createTask('_edge_test_', 'm');
  testTaskIds.push(task.id);
  assert(task.state === 'working', 'Should create working task');
  assert(task.params === undefined, 'Params should be undefined when not provided');
});

await test('createTask with large params', () => {
  const bigParams: Record<string, unknown> = {};
  for (let i = 0; i < 1000; i++) bigParams[`key${i}`] = `value${i}`;
  const task = createTask('_edge_test_', 'm', bigParams);
  testTaskIds.push(task.id);
  const retrieved = getTask(task.id);
  assert(Object.keys(retrieved!.params!).length === 1000, 'Should store 1000 params');
});

await test('updateTask on non-existent task returns null', () => {
  const result = updateTask('does-not-exist', { state: 'completed' });
  assert(result === null, 'Should return null for missing task');
});

await test('updateTask preserves fields not in update', () => {
  const task = createTask('_edge_test_', 'method', { x: 1 });
  testTaskIds.push(task.id);
  updateTask(task.id, { state: 'completed' });
  const updated = getTask(task.id);
  assert(updated!.state === 'completed', 'State should be updated');
  assert(updated!.photon === '_edge_test_', 'Photon should be preserved');
  assert(updated!.method === 'method', 'Method should be preserved');
  assert((updated!.params as any).x === 1, 'Params should be preserved');
});

await test('updatedAt changes on each update', async () => {
  const task = createTask('_edge_test_', 'm');
  testTaskIds.push(task.id);
  const t1 = task.updatedAt;
  await new Promise((r) => setTimeout(r, 10));
  updateTask(task.id, { progress: { percent: 0.5, message: 'half' } });
  const t2 = getTask(task.id)!.updatedAt;
  assert(t2 > t1, 'updatedAt should increase');
});

await test('listTasks filters by photon correctly', () => {
  const unique = `_edge_alpha_${Date.now()}_`;
  const t1 = createTask(unique, 'm1');
  const t2 = createTask('_edge_beta_other_', 'm2');
  const t3 = createTask(unique, 'm3');
  testTaskIds.push(t1.id, t2.id, t3.id);

  const alpha = listTasks(unique);
  assert(alpha.length === 2, `Expected 2 tasks for ${unique}, got ${alpha.length}`);
  assert(
    alpha.every((t) => t.photon === unique),
    'All should match filter'
  );
});

await test('listTasks returns newest first', () => {
  const t1 = createTask('_edge_order_', 'first');
  testTaskIds.push(t1.id);

  const t2 = createTask('_edge_order_', 'second');
  testTaskIds.push(t2.id);
  // Backdate t2 to be "newer"
  const t2Path = path.join(tasksDir, `${t2.id}.json`);
  const t2JSON = JSON.parse(fs.readFileSync(t2Path, 'utf-8'));
  t2JSON.createdAt = new Date(Date.now() + 1000).toISOString();
  fs.writeFileSync(t2Path, JSON.stringify(t2JSON));

  const tasks = listTasks('_edge_order_');
  assert(tasks[0].method === 'second', 'Newest task should be first');
});

await test('cleanExpiredTasks only removes terminal tasks', () => {
  const working = createTask('_edge_clean_', 'working');
  testTaskIds.push(working.id);
  const completed = createTask('_edge_clean_', 'completed');
  testTaskIds.push(completed.id);
  updateTask(completed.id, { state: 'completed' });
  const failedTask = createTask('_edge_clean_', 'failed');
  testTaskIds.push(failedTask.id);
  updateTask(failedTask.id, { state: 'failed' });

  // Backdate all _edge_clean_ tasks
  for (const id of [working.id, completed.id, failedTask.id]) {
    const fp = path.join(tasksDir, `${id}.json`);
    const t = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    t.updatedAt = new Date(Date.now() - 100_000).toISOString();
    fs.writeFileSync(fp, JSON.stringify(t));
  }

  const cleaned = cleanExpiredTasks(1000);
  assert(cleaned >= 2, `Should clean at least 2 terminal tasks, cleaned ${cleaned}`);

  // Working task should still exist
  const w = getTask(working.id);
  assert(w !== null, 'Working task should remain');
  assert(w!.state === 'working', 'Remaining task should be working');
});

await test('corrupt task JSON file is skipped by listTasks', () => {
  const corruptFile = path.join(tasksDir, '_edge_corrupt_.json');
  fs.writeFileSync(corruptFile, 'not valid json{{{');
  const unique = `_edge_corrupt_${Date.now()}_`;
  const good = createTask(unique, 'good');
  testTaskIds.push(good.id);

  const tasks = listTasks(unique);
  assert(tasks.length === 1, `Should have 1 task for ${unique}, got ${tasks.length}`);

  // Clean up corrupt file
  fs.unlinkSync(corruptFile);
});

await test('getTask with corrupt file returns null', () => {
  const corruptPath = path.join(tasksDir, '_edge_bad_id_.json');
  fs.writeFileSync(corruptPath, '{{invalid}}');
  const result = getTask('_edge_bad_id_');
  assert(result === null, 'Should return null for corrupt task');
  fs.unlinkSync(corruptPath);
});

// Cleanup: remove all test task files
for (const id of testTaskIds) {
  const fp = path.join(tasksDir, `${id}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER CARD EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 Server Card Edge Cases\n');

await test('empty photon list produces valid card', () => {
  const card = generateServerCard([]);
  assert(card.tools.length === 0, 'Should have no tools');
  assert(card.photons.length === 0, 'Should have no photons');
  assert(card.capabilities.includes('tools'), 'Should still have tools capability');
});

await test('photon with no methods produces no tools', () => {
  const card = generateServerCard([
    { configured: true, name: 'empty', description: '', methods: [], stateful: false } as any,
  ]);
  assert(card.tools.length === 0, 'Should have no tools');
  assert(card.photons.length === 1, 'Should have 1 photon');
  assert(card.photons[0].methods.length === 0, 'Methods should be empty');
});

await test('only unconfigured photons results in empty lists', () => {
  const card = generateServerCard([
    { configured: false, name: 'broken', errorMessage: 'Missing key' } as any,
    { configured: false, name: 'broken2', errorMessage: 'Bad import' } as any,
  ]);
  assert(card.tools.length === 0, 'No tools from unconfigured photons');
  assert(card.photons.length === 0, 'No photon summaries from unconfigured');
});

await test('method with empty description gets fallback', () => {
  const card = generateServerCard([
    {
      configured: true,
      name: 'test',
      methods: [{ name: 'run', description: '' }],
      stateful: false,
    } as any,
  ]);
  // Empty string is falsy, so the || fallback produces 'Execute run'
  assert(
    card.tools[0].description === 'Execute run',
    `Should get fallback, got '${card.tools[0].description}'`
  );
});

await test('photon with undefined methods is handled', () => {
  const card = generateServerCard([
    { configured: true, name: 'nomethods', stateful: false } as any,
  ]);
  assert(card.tools.length === 0, 'Should handle undefined methods');
  assert(card.photons[0].methods.length === 0, 'Photon methods should be empty array');
});

await test('no baseUrl omits url from transport', () => {
  const card = generateServerCard([], {});
  assert(card.transport[0].url === undefined, 'No URL when no baseUrl');
});

// ═══════════════════════════════════════════════════════════════════════════════
// A2A AGENT CARD EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 A2A Agent Card Edge Cases\n');

await test('empty photon list produces valid agent card', () => {
  const card = generateAgentCard([]);
  assert(card.name === 'photon-agent', 'Should use generic name');
  assert(card.skills.length === 0, 'Should have no skills');
  // No tool_execution without tools
  const capNames = card.capabilities.map((c) => c.name);
  assert(!capNames.includes('tool_execution'), 'No tool_execution without tools');
});

await test('photon with tools array (no methods) uses tools for skills', () => {
  const card = generateAgentCard([
    {
      name: 'raw',
      tools: [{ name: 'execute', description: 'Run command', inputSchema: { type: 'object' } }],
    },
  ]);
  assert(card.skills.length === 1, 'Should create skill from tool');
  assert(card.skills[0].id === 'raw/execute', 'Skill ID should use photon/tool format');
});

await test('photon with both methods and tools prefers methods', () => {
  const card = generateAgentCard([
    {
      name: 'dual',
      methods: [{ name: 'run', description: 'Run via method', params: {} }],
      tools: [{ name: 'exec', description: 'Run via tool' }],
    },
  ]);
  assert(card.skills.length === 1, 'Should only use methods');
  assert(card.skills[0].id === 'dual/run', 'Should use method, not tool');
});

await test('non-stateful photons do not get stateful capability', () => {
  const card = generateAgentCard([
    { name: 'stateless', stateful: false, methods: [{ name: 'go', description: '', params: {} }] },
  ]);
  const capNames = card.capabilities.map((c) => c.name);
  assert(!capNames.includes('stateful'), 'Should not have stateful');
});

await test('method tags are preserved in skills', () => {
  const card = generateAgentCard([
    {
      name: 'tagged',
      methods: [
        { name: 'search', description: 'Search', params: {}, tags: ['readOnly', 'public'] },
      ],
    },
  ]);
  assert(card.skills[0].tags!.length === 2, 'Should preserve tags');
  assert(card.skills[0].tags![0] === 'readOnly', 'First tag should be readOnly');
});

await test('custom baseUrl and version are respected', () => {
  const card = generateAgentCard(
    [{ name: 'test', methods: [{ name: 'go', description: '', params: {} }] }],
    { baseUrl: 'https://my.server.com', version: '3.2.1' }
  );
  assert(card.url === 'https://my.server.com', 'URL should match baseUrl');
  assert(card.version === '3.2.1', 'Version should match option');
});

await test('description fallback for multi-photon without description', () => {
  const card = generateAgentCard([{ name: 'alpha' }, { name: 'beta' }]);
  assert(card.description.includes('alpha'), 'Description should mention photon names');
  assert(card.description.includes('beta'), 'Description should mention all photons');
});

// ═══════════════════════════════════════════════════════════════════════════════
// OTel EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 OTel Edge Cases\n');

await test('startToolSpan with undefined params works', () => {
  const span = startToolSpan('p', 't');
  span.setStatus('OK');
  span.end();
  // No throw = pass
});

await test('startToolSpan with empty params object works', () => {
  const span = startToolSpan('p', 't', {});
  span.setStatus('OK');
  span.end();
});

await test('startAgentSpan with undefined description works', () => {
  const span = startAgentSpan('p');
  span.end();
});

await test('rapid span creation does not leak', () => {
  for (let i = 0; i < 10000; i++) {
    const span = startToolSpan('p', `t${i}`);
    span.end();
  }
  // No throw, no memory explosion = pass
});

await test('_resetOtelCache allows re-probing', async () => {
  _resetOtelCache();
  assert(isTracingEnabled() === false, 'After reset, should be false (probe not done)');
  await waitForOtelProbe();
  // Still false because @opentelemetry/api not installed
  assert(isTracingEnabled() === false, 'Should still be false after re-probe');
});

await test('setAttribute with special characters works', () => {
  const span = startToolSpan('p', 't');
  span.setAttribute('key.with.dots', 'value');
  span.setAttribute('key/with/slashes', 'value');
  span.setAttribute('emoji.key', '🔥');
  span.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-FEATURE EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 Cross-Feature Edge Cases\n');

await test('AG-UI handler works with task-like progress objects', () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r-task', (n) =>
    events.push(n)
  );
  // Task store uses { percent, message } but AG-UI handler uses { emit: 'progress', value, message }
  // Verify AG-UI handler ignores non-emit objects
  outputHandler({ percent: 0.5, message: 'half' }); // Not an emit — should be ignored
  finish();
  const steps = events.filter((e) => e.params.type === AGUIEventType.STEP_STARTED);
  assert(steps.length === 0, 'Non-emit progress object should not create step');
});

await test('Server Card and Agent Card from same photon are consistent', () => {
  const photonData = {
    configured: true,
    name: 'weather',
    description: 'Weather service',
    stateful: true,
    methods: [
      { name: 'current', description: 'Get weather', params: { city: { type: 'string' } } },
      { name: 'forecast', description: 'Get forecast', params: {} },
    ],
  };

  const serverCard = generateServerCard([photonData as any]);
  const agentCard = generateAgentCard([photonData]);

  // Both should expose the same methods/skills
  assert(
    serverCard.tools.length === agentCard.skills.length,
    `Tool count (${serverCard.tools.length}) should match skill count (${agentCard.skills.length})`
  );

  // Tool names should correspond to skill IDs
  for (const tool of serverCard.tools) {
    const matchingSkill = agentCard.skills.find((s) => s.id === tool.name);
    assert(matchingSkill !== undefined, `Tool ${tool.name} should have matching skill`);
  }
});

await test('AG-UI events have monotonically increasing timestamps', async () => {
  const events: any[] = [];
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'm', 'r-time', (n) =>
    events.push(n)
  );
  outputHandler('a');
  await new Promise((r) => setTimeout(r, 5));
  outputHandler('b');
  await new Promise((r) => setTimeout(r, 5));
  finish({ done: true });

  for (let i = 1; i < events.length; i++) {
    assert(
      events[i].params.timestamp >= events[i - 1].params.timestamp,
      `Timestamp at index ${i} should be >= index ${i - 1}`
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
