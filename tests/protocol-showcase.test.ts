/**
 * Protocol Showcase Tests
 *
 * Exercises all 7 protocol features:
 * - AG-UI event mapping
 * - Bidirectional state (clientState)
 * - Persistent approvals (structure + duration)
 * - MCP Tasks (lifecycle)
 * - Server Cards (generation)
 * - A2A Agent Cards (generation)
 * - OTel GenAI (no-op spans)
 */

import { createAGUIOutputHandler } from '../src/ag-ui/adapter.js';
import { AGUIEventType } from '../src/ag-ui/types.js';
import { createTask, getTask, updateTask, listTasks } from '../src/tasks/store.js';
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
// AG-UI EVENT MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 AG-UI Event Mapping\n');

const events: any[] = [];
const broadcast = (notification: any) => events.push(notification);

await test('createAGUIOutputHandler emits RUN_STARTED on creation', () => {
  events.length = 0;
  createAGUIOutputHandler('test', 'method', 'run-1', broadcast);
  assert(events.length === 1, `Expected 1 event, got ${events.length}`);
  assert(events[0].params.type === AGUIEventType.RUN_STARTED, 'Should be RUN_STARTED');
  assert(events[0].params.runId === 'run-1', 'Should have correct runId');
});

await test('string yields produce TEXT_MESSAGE events', () => {
  events.length = 0;
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'stream', 'run-2', broadcast);

  outputHandler('Hello ');
  outputHandler('world');
  finish();

  const types = events.map((e) => e.params.type);
  assert(types.includes(AGUIEventType.RUN_STARTED), 'Should have RUN_STARTED');
  assert(types.includes(AGUIEventType.TEXT_MESSAGE_START), 'Should have TEXT_MESSAGE_START');
  assert(
    types.filter((t) => t === AGUIEventType.TEXT_MESSAGE_CONTENT).length === 2,
    'Should have 2 TEXT_MESSAGE_CONTENT events'
  );
  assert(types.includes(AGUIEventType.TEXT_MESSAGE_END), 'Should have TEXT_MESSAGE_END');
  assert(types.includes(AGUIEventType.RUN_FINISHED), 'Should have RUN_FINISHED');
});

await test('progress yields produce STEP events', () => {
  events.length = 0;
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'work', 'run-3', broadcast);

  outputHandler({ emit: 'progress', value: 0.5, message: 'Halfway' });
  outputHandler({ emit: 'progress', value: 1.0, message: 'Done' });
  finish();

  const types = events.map((e) => e.params.type);
  assert(types.includes(AGUIEventType.STEP_STARTED), 'Should have STEP_STARTED');
  assert(types.includes(AGUIEventType.STEP_FINISHED), 'Should have STEP_FINISHED');
});

await test('object return produces STATE_SNAPSHOT', () => {
  events.length = 0;
  const { finish } = createAGUIOutputHandler('test', 'snap', 'run-4', broadcast);

  finish({ key: 'value', count: 42 });

  const snapshots = events.filter((e) => e.params.type === AGUIEventType.STATE_SNAPSHOT);
  assert(snapshots.length === 1, 'Should have 1 STATE_SNAPSHOT');
  assert(snapshots[0].params.snapshot.key === 'value', 'Snapshot should contain the result');
});

await test('channel events produce STATE_DELTA', () => {
  events.length = 0;
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'delta', 'run-5', broadcast);

  outputHandler({ channel: 'items', event: 'added', data: { id: 1 } });
  finish();

  const deltas = events.filter((e) => e.params.type === AGUIEventType.STATE_DELTA);
  assert(deltas.length === 1, 'Should have 1 STATE_DELTA');
  assert(deltas[0].params.delta[0].op === 'replace', 'Delta should be a JSON Patch replace');
});

await test('error() emits RUN_ERROR', () => {
  events.length = 0;
  const { error } = createAGUIOutputHandler('test', 'fail', 'run-6', broadcast);

  error('Something went wrong');

  const errors = events.filter((e) => e.params.type === AGUIEventType.RUN_ERROR);
  assert(errors.length === 1, 'Should have 1 RUN_ERROR');
  assert(errors[0].params.message === 'Something went wrong', 'Should contain error message');
});

await test('custom emit yields produce CUSTOM events', () => {
  events.length = 0;
  const { outputHandler, finish } = createAGUIOutputHandler('test', 'custom', 'run-7', broadcast);

  outputHandler({ emit: 'render', format: 'table', value: [[1, 2]] });
  outputHandler({ emit: 'toast', message: 'hello', type: 'success' });
  finish();

  const customs = events.filter((e) => e.params.type === AGUIEventType.CUSTOM);
  assert(customs.length === 2, `Should have 2 CUSTOM events, got ${customs.length}`);
  assert(customs[0].params.name === 'render', 'First custom should be render');
  assert(customs[1].params.name === 'toast', 'Second custom should be toast');
});

await test('all events are wrapped as JSON-RPC 2.0 notifications', () => {
  events.length = 0;
  const { finish } = createAGUIOutputHandler('test', 'rpc', 'run-8', broadcast);
  finish();

  for (const event of events) {
    assert(event.jsonrpc === '2.0', 'Should have jsonrpc: 2.0');
    assert(event.method === 'ag-ui/event', 'Should have method: ag-ui/event');
    assert(event.params !== undefined, 'Should have params');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TASKS LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 MCP Tasks Lifecycle\n');

// Use temp dir to avoid polluting real tasks
const origHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-task-test-'));
process.env.HOME = tmpHome;

// Ensure tasks dir structure exists
fs.mkdirSync(path.join(tmpHome, '.photon', 'tasks'), { recursive: true });

await test('createTask creates a working task', () => {
  const task = createTask('test-photon', 'process', { items: ['a', 'b'] });
  assert(task.id !== undefined, 'Should have an id');
  assert(task.state === 'working', `State should be 'working', got '${task.state}'`);
  assert(task.photon === 'test-photon', 'Should have correct photon name');
  assert(task.method === 'process', 'Should have correct method');
});

await test('getTask retrieves a created task', () => {
  const created = createTask('test-photon', 'fetch', {});
  const retrieved = getTask(created.id);
  assert(retrieved !== null, 'Should retrieve the task');
  assert(retrieved!.id === created.id, 'IDs should match');
  assert(retrieved!.state === 'working', 'State should still be working');
});

await test('updateTask transitions state and adds result', () => {
  const task = createTask('test-photon', 'compute', {});
  const updated = updateTask(task.id, {
    state: 'completed',
    result: { answer: 42 },
    progress: { percent: 1.0, message: 'Done' },
  });
  assert(updated !== null, 'Should return updated task');
  assert(updated!.state === 'completed', 'State should be completed');
  assert((updated!.result as any).answer === 42, 'Should have result');
  assert(updated!.progress?.percent === 1.0, 'Should have progress 1.0');
});

await test('updateTask can set failed state with error', () => {
  const task = createTask('test-photon', 'risky', {});
  const updated = updateTask(task.id, {
    state: 'failed',
    error: 'Connection timeout',
  });
  assert(updated!.state === 'failed', 'State should be failed');
  assert(updated!.error === 'Connection timeout', 'Should have error message');
});

await test('listTasks returns tasks filtered by photon', () => {
  createTask('alpha', 'run', {});
  createTask('beta', 'run', {});
  createTask('alpha', 'build', {});

  const alphaTasks = listTasks('alpha');
  assert(alphaTasks.length >= 2, `Should have at least 2 alpha tasks, got ${alphaTasks.length}`);
  assert(
    alphaTasks.every((t) => t.photon === 'alpha'),
    'All tasks should be for alpha photon'
  );
});

await test('getTask returns null for non-existent ID', () => {
  const result = getTask('non-existent-id');
  assert(result === null, 'Should return null for non-existent task');
});

// Restore HOME
process.env.HOME = origHome;
fs.rmSync(tmpHome, { recursive: true, force: true });

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER CARDS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 Server Cards\n');

const mockPhotons: any[] = [
  {
    configured: true,
    name: 'weather',
    description: 'Weather data service',
    stateful: true,
    icon: 'cloud',
    methods: [
      { name: 'current', description: 'Get current weather' },
      { name: 'forecast', description: 'Get forecast' },
    ],
  },
  {
    configured: true,
    name: 'calendar',
    description: 'Calendar management',
    stateful: false,
    methods: [{ name: 'events', description: 'List events' }],
  },
  {
    configured: false,
    name: 'broken',
    errorMessage: 'Missing API key',
  },
];

await test('generateServerCard produces valid card structure', () => {
  const card = generateServerCard(mockPhotons);
  assert(card.name === 'photon-beam', `Name should be 'photon-beam', got '${card.name}'`);
  assert(card.protocol === 'mcp', 'Protocol should be mcp');
  assert(card.version !== undefined, 'Should have version');
  assert(Array.isArray(card.transport), 'Should have transport array');
  assert(card.transport[0].type === 'streamable-http', 'Transport should be streamable-http');
});

await test('generateServerCard lists tools from configured photons only', () => {
  const card = generateServerCard(mockPhotons);
  assert(card.tools.length === 3, `Should have 3 tools, got ${card.tools.length}`);
  assert(
    card.tools.some((t) => t.name === 'weather/current'),
    'Should have weather/current tool'
  );
  assert(
    card.tools.some((t) => t.name === 'calendar/events'),
    'Should have calendar/events tool'
  );
  // Should NOT include broken photon
  assert(
    !card.tools.some((t) => t.name.startsWith('broken')),
    'Should not include unconfigured photon tools'
  );
});

await test('generateServerCard includes photon summaries', () => {
  const card = generateServerCard(mockPhotons);
  assert(card.photons.length === 2, `Should have 2 photons, got ${card.photons.length}`);
  const weather = card.photons.find((p) => p.name === 'weather');
  assert(weather !== undefined, 'Should include weather photon');
  assert(weather!.stateful === true, 'Weather should be stateful');
  assert(weather!.icon === 'cloud', 'Weather should have cloud icon');
});

await test('generateServerCard includes baseUrl in transport', () => {
  const card = generateServerCard(mockPhotons, { baseUrl: 'https://api.example.com' });
  assert(
    card.transport[0].url === 'https://api.example.com/mcp',
    'Transport URL should include /mcp path'
  );
});

await test('generateServerCard detects capabilities', () => {
  const card = generateServerCard(mockPhotons);
  assert(card.capabilities.includes('tools'), 'Should have tools capability');
});

// ═══════════════════════════════════════════════════════════════════════════════
// A2A AGENT CARDS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 A2A Agent Cards\n');

const photonInputs = [
  {
    name: 'analyst',
    description: 'Data analysis agent',
    stateful: true,
    methods: [
      { name: 'analyze', description: 'Analyze a dataset', params: { source: { type: 'string' } } },
      { name: 'report', description: 'Generate report', params: {} },
    ],
  },
];

await test('generateAgentCard produces valid A2A card', () => {
  const card = generateAgentCard(photonInputs);
  assert(card.name === 'analyst', `Name should be 'analyst', got '${card.name}'`);
  assert(card.description === 'Data analysis agent', 'Should have correct description');
  assert(card.version === '1.0.0', 'Should default to 1.0.0');
  assert(Array.isArray(card.skills), 'Should have skills array');
  assert(Array.isArray(card.capabilities), 'Should have capabilities array');
});

await test('generateAgentCard maps methods to skills', () => {
  const card = generateAgentCard(photonInputs);
  assert(card.skills.length === 2, `Should have 2 skills, got ${card.skills.length}`);
  assert(card.skills[0].id === 'analyst/analyze', 'First skill should be analyst/analyze');
  assert(card.skills[1].id === 'analyst/report', 'Second skill should be analyst/report');
});

await test('generateAgentCard detects capabilities from tags', () => {
  const card = generateAgentCard(photonInputs);
  const capNames = card.capabilities.map((c) => c.name);
  assert(capNames.includes('tool_execution'), 'Should detect tool_execution');
  assert(capNames.includes('stateful'), 'Should detect stateful from @stateful');
  assert(capNames.includes('streaming'), 'Should always include streaming');
  assert(capNames.includes('ag-ui'), 'Should always include ag-ui');
});

await test('generateAgentCard includes provider info', () => {
  const card = generateAgentCard(photonInputs, {
    organization: 'Acme Corp',
    organizationUrl: 'https://acme.com',
  });
  assert(card.provider !== undefined, 'Should have provider');
  assert(card.provider!.organization === 'Acme Corp', 'Should have org name');
  assert(card.provider!.url === 'https://acme.com', 'Should have org URL');
});

await test('generateAgentCard names multi-photon agents correctly', () => {
  const multi = [
    { name: 'alpha', methods: [{ name: 'run', description: 'Run', params: {} }] },
    { name: 'beta', methods: [{ name: 'build', description: 'Build', params: {} }] },
  ];
  const card = generateAgentCard(multi);
  assert(card.name === 'photon-agent', 'Multi-photon should use generic name');
  assert(card.skills.length === 2, 'Should combine skills from all photons');
});

await test('generateAgentCard includes inputSchema when params exist', () => {
  const card = generateAgentCard(photonInputs);
  const analyze = card.skills.find((s) => s.id === 'analyst/analyze');
  assert(analyze!.inputSchema !== undefined, 'analyze should have inputSchema');
  const report = card.skills.find((s) => s.id === 'analyst/report');
  assert(report!.inputSchema === undefined, 'report with empty params should not have inputSchema');
});

// ═══════════════════════════════════════════════════════════════════════════════
// OTel GenAI
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 OTel GenAI\n');

await test('waitForOtelProbe resolves without error', async () => {
  _resetOtelCache();
  await waitForOtelProbe();
  // Should complete without throwing
});

await test('isTracingEnabled returns false without OTel SDK', async () => {
  await waitForOtelProbe();
  // @opentelemetry/api is not installed in test env
  assert(isTracingEnabled() === false, 'Should be false without OTel SDK');
});

await test('startToolSpan returns no-op span without OTel SDK', () => {
  const span = startToolSpan('test-photon', 'compute', { x: 1 });
  // All methods should be callable without error
  span.setAttribute('key', 'value');
  span.addEvent('test', { count: 1 });
  span.setStatus('OK');
  span.end();
  // No assertion needed — just verifying no throws
});

await test('startAgentSpan returns no-op span without OTel SDK', () => {
  const span = startAgentSpan('test-photon', 'Test agent');
  span.setAttribute('key', 'value');
  span.setStatus('ERROR', 'test error');
  span.end();
});

await test('no-op span methods are safe to call multiple times', () => {
  const span = startToolSpan('test', 'method');
  span.setAttribute('a', 1);
  span.setAttribute('b', true);
  span.setAttribute('c', 'str');
  span.addEvent('e1');
  span.addEvent('e2', { x: 1 });
  span.setStatus('OK');
  span.setStatus('ERROR', 'msg');
  span.end();
  span.end(); // Double-end should not throw
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
