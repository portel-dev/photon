/**
 * AG-UI Protocol Adapter Tests
 *
 * Tests the AG-UI event types, output handler, proxy function,
 * and transport integration points.
 */

import { strict as assert } from 'assert';
import { AGUIEventType } from '../src/ag-ui/types.js';
import type {
  RunAgentInput,
  AGUIEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  StepStartedEvent,
  StepFinishedEvent,
  CustomEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  AGUIMessage,
  AGUITool,
} from '../src/ag-ui/types.js';
import { createAGUIOutputHandler, proxyExternalAgent } from '../src/ag-ui/adapter.js';

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
      console.log(`    ${err.message || err}`);
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Event Type Definitions
// ════════════════════════════════════════════════════════════════════════════════

async function testEventTypes(): Promise<void> {
  console.log('\n  Event Types');

  await test('AGUIEventType has all 17 event types', () => {
    const values = Object.values(AGUIEventType);
    assert.equal(values.length, 17);
  });

  await test('AGUIEventType values match string keys', () => {
    assert.equal(AGUIEventType.RUN_STARTED, 'RUN_STARTED');
    assert.equal(AGUIEventType.RUN_FINISHED, 'RUN_FINISHED');
    assert.equal(AGUIEventType.RUN_ERROR, 'RUN_ERROR');
    assert.equal(AGUIEventType.STEP_STARTED, 'STEP_STARTED');
    assert.equal(AGUIEventType.STEP_FINISHED, 'STEP_FINISHED');
    assert.equal(AGUIEventType.TEXT_MESSAGE_START, 'TEXT_MESSAGE_START');
    assert.equal(AGUIEventType.TEXT_MESSAGE_CONTENT, 'TEXT_MESSAGE_CONTENT');
    assert.equal(AGUIEventType.TEXT_MESSAGE_END, 'TEXT_MESSAGE_END');
    assert.equal(AGUIEventType.TOOL_CALL_START, 'TOOL_CALL_START');
    assert.equal(AGUIEventType.TOOL_CALL_ARGS, 'TOOL_CALL_ARGS');
    assert.equal(AGUIEventType.TOOL_CALL_END, 'TOOL_CALL_END');
    assert.equal(AGUIEventType.TOOL_CALL_RESULT, 'TOOL_CALL_RESULT');
    assert.equal(AGUIEventType.STATE_SNAPSHOT, 'STATE_SNAPSHOT');
    assert.equal(AGUIEventType.STATE_DELTA, 'STATE_DELTA');
    assert.equal(AGUIEventType.MESSAGES_SNAPSHOT, 'MESSAGES_SNAPSHOT');
    assert.equal(AGUIEventType.CUSTOM, 'CUSTOM');
    assert.equal(AGUIEventType.RAW, 'RAW');
  });

  await test('RunAgentInput interface shape is valid', () => {
    const input: RunAgentInput = {
      threadId: 'thread-1',
      runId: 'run-1',
      state: { count: 0 },
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
      context: [{ description: 'ctx', value: 'val' }],
      forwardedProps: { extra: true },
    };
    assert.equal(input.threadId, 'thread-1');
    assert.equal(input.runId, 'run-1');
    assert.equal(input.messages!.length, 1);
    assert.equal(input.tools!.length, 1);
  });

  await test('AGUIMessage supports all roles', () => {
    const roles: AGUIMessage['role'][] = ['user', 'assistant', 'system', 'developer', 'tool'];
    for (const role of roles) {
      const msg: AGUIMessage = { id: `m-${role}`, role, content: 'test' };
      assert.equal(msg.role, role);
    }
  });

  await test('AGUITool has required fields', () => {
    const tool: AGUITool = {
      name: 'test',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
    };
    assert.equal(tool.name, 'test');
    assert.ok(tool.parameters);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. createAGUIOutputHandler
// ════════════════════════════════════════════════════════════════════════════════

async function testOutputHandler(): Promise<void> {
  console.log('\n  Output Handler');

  await test('RUN_STARTED is emitted immediately on creation', () => {
    const events: any[] = [];
    createAGUIOutputHandler('todo', 'add', 'run-1', (n) => events.push(n));

    assert.equal(events.length, 1);
    assert.equal(events[0].method, 'ag-ui/event');
    assert.equal(events[0].params.type, AGUIEventType.RUN_STARTED);
    assert.equal(events[0].params.runId, 'run-1');
    assert.equal(events[0].params.threadId, 'todo/add');
  });

  await test('string chunks produce TEXT_MESSAGE_START then CONTENT events', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('chat', 'ask', 'r1', (n) => events.push(n));

    outputHandler('Hello');
    outputHandler(' world');

    // events: RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_CONTENT
    assert.equal(events.length, 4);
    assert.equal(events[1].params.type, AGUIEventType.TEXT_MESSAGE_START);
    assert.equal(events[1].params.role, 'assistant');
    assert.equal(events[2].params.type, AGUIEventType.TEXT_MESSAGE_CONTENT);
    assert.equal(events[2].params.delta, 'Hello');
    assert.equal(events[3].params.type, AGUIEventType.TEXT_MESSAGE_CONTENT);
    assert.equal(events[3].params.delta, ' world');
  });

  await test('finish() closes text stream and emits RUN_FINISHED', () => {
    const events: any[] = [];
    const { outputHandler, finish } = createAGUIOutputHandler('chat', 'ask', 'r1', (n) =>
      events.push(n)
    );

    outputHandler('Hi');
    finish();

    const types = events.map((e) => e.params.type);
    assert.ok(types.includes(AGUIEventType.TEXT_MESSAGE_END));
    assert.equal(types[types.length - 1], AGUIEventType.RUN_FINISHED);
  });

  await test('finish() with object result emits STATE_SNAPSHOT before RUN_FINISHED', () => {
    const events: any[] = [];
    const { finish } = createAGUIOutputHandler('todo', 'list', 'r1', (n) => events.push(n));

    finish({ items: ['buy milk'] });

    const types = events.map((e) => e.params.type);
    const snapshotIdx = types.indexOf(AGUIEventType.STATE_SNAPSHOT);
    const finishIdx = types.indexOf(AGUIEventType.RUN_FINISHED);
    assert.ok(snapshotIdx >= 0, 'STATE_SNAPSHOT should be emitted');
    assert.ok(snapshotIdx < finishIdx, 'STATE_SNAPSHOT before RUN_FINISHED');

    const snapshot = events[snapshotIdx].params as StateSnapshotEvent;
    assert.deepEqual(snapshot.snapshot, { items: ['buy milk'] });
  });

  await test('error() emits RUN_ERROR as last event', () => {
    const events: any[] = [];
    const { error } = createAGUIOutputHandler('todo', 'add', 'r1', (n) => events.push(n));

    error('Something broke');

    const last = events[events.length - 1];
    assert.equal(last.params.type, AGUIEventType.RUN_ERROR);
    assert.equal(last.params.message, 'Something broke');
  });

  await test('error() closes open text stream before RUN_ERROR', () => {
    const events: any[] = [];
    const { outputHandler, error } = createAGUIOutputHandler('chat', 'ask', 'r1', (n) =>
      events.push(n)
    );

    outputHandler('Partial response...');
    error('Connection lost');

    const types = events.map((e) => e.params.type);
    const endIdx = types.indexOf(AGUIEventType.TEXT_MESSAGE_END);
    const errorIdx = types.indexOf(AGUIEventType.RUN_ERROR);
    assert.ok(endIdx >= 0, 'TEXT_MESSAGE_END should be emitted');
    assert.ok(endIdx < errorIdx, 'TEXT_MESSAGE_END before RUN_ERROR');
  });

  await test('progress yields produce STEP_STARTED/STEP_FINISHED events', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('ml', 'train', 'r1', (n) => events.push(n));

    outputHandler({ emit: 'progress', value: 0.5, message: 'Training' });
    outputHandler({ emit: 'progress', value: 1.0, message: 'Training' });

    const types = events.map((e) => e.params.type);
    assert.ok(types.includes(AGUIEventType.STEP_STARTED));
    assert.ok(types.includes(AGUIEventType.STEP_FINISHED));
  });

  await test('channel events produce STATE_DELTA with JSON Patch operations', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('board', 'move', 'r1', (n) => events.push(n));

    outputHandler({ channel: 'tasks', event: 'task-moved', data: { id: '1', column: 'done' } });

    const deltas = events.filter((e) => e.params.type === AGUIEventType.STATE_DELTA);
    assert.equal(deltas.length, 1);
    const delta = deltas[0].params as StateDeltaEvent;
    assert.equal((delta.delta as any[])[0].op, 'replace');
    assert.equal((delta.delta as any[])[0].path, '/tasks/task-moved');
  });

  await test('render emit produces CUSTOM event', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('viz', 'chart', 'r1', (n) => events.push(n));

    outputHandler({ emit: 'render', format: 'html', value: '<div>Chart</div>' });

    const customs = events.filter((e) => e.params.type === AGUIEventType.CUSTOM);
    assert.equal(customs.length, 1);
    assert.equal(customs[0].params.name, 'render');
    assert.deepEqual(customs[0].params.value, { format: 'html', value: '<div>Chart</div>' });
  });

  await test('arbitrary emit produces CUSTOM event', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('game', 'play', 'r1', (n) => events.push(n));

    outputHandler({ emit: 'toast', message: 'Game over', type: 'info' });

    const customs = events.filter((e) => e.params.type === AGUIEventType.CUSTOM);
    assert.equal(customs.length, 1);
    assert.equal(customs[0].params.name, 'toast');
  });

  await test('null and primitive yields are ignored', () => {
    const events: any[] = [];
    const { outputHandler } = createAGUIOutputHandler('test', 'fn', 'r1', (n) => events.push(n));

    outputHandler(null);
    outputHandler(undefined);
    outputHandler(42);
    outputHandler(true);

    // Only RUN_STARTED should be in events (the initial one)
    assert.equal(events.length, 1);
    assert.equal(events[0].params.type, AGUIEventType.RUN_STARTED);
  });

  await test('all events have jsonrpc 2.0 wrapper with ag-ui/event method', () => {
    const events: any[] = [];
    const { outputHandler, finish } = createAGUIOutputHandler('t', 'm', 'r1', (n) =>
      events.push(n)
    );

    outputHandler('text');
    finish({ data: true });

    for (const event of events) {
      assert.equal(event.jsonrpc, '2.0');
      assert.equal(event.method, 'ag-ui/event');
      assert.ok(event.params.type, 'Event should have a type');
    }
  });

  await test('all events have timestamps', () => {
    const events: any[] = [];
    const { outputHandler, finish } = createAGUIOutputHandler('t', 'm', 'r1', (n) =>
      events.push(n)
    );

    outputHandler('chunk');
    finish();

    for (const event of events) {
      assert.ok(
        typeof event.params.timestamp === 'number',
        `Event ${event.params.type} should have numeric timestamp`
      );
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. proxyExternalAgent SSE parsing
// ════════════════════════════════════════════════════════════════════════════════

async function testProxy(): Promise<void> {
  console.log('\n  Proxy (SSE parsing)');

  // Mock fetch for testing
  const originalFetch = globalThis.fetch;

  await test('proxy parses SSE events and broadcasts as MCP notifications', async () => {
    const events: any[] = [];
    const sseBody = [
      `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' })}`,
      '',
      `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_START', messageId: 'm1' })}`,
      '',
      `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi' })}`,
      '',
      `data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' })}`,
      '',
    ].join('\n');

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
      }) as Response;

    const input: RunAgentInput = { threadId: 't1', runId: 'r1' };
    await proxyExternalAgent('http://example.com/agent', input, (n) => events.push(n));

    assert.equal(events.length, 4);
    assert.equal(events[0].params.type, 'RUN_STARTED');
    assert.equal(events[1].params.type, 'TEXT_MESSAGE_START');
    assert.equal(events[2].params.type, 'TEXT_MESSAGE_CONTENT');
    assert.equal(events[3].params.type, 'RUN_FINISHED');

    for (const event of events) {
      assert.equal(event.jsonrpc, '2.0');
      assert.equal(event.method, 'ag-ui/event');
    }
  });

  await test('proxy emits RUN_ERROR when stream ends without terminal event', async () => {
    const events: any[] = [];
    const sseBody = [
      `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' })}`,
      '',
      `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi' })}`,
      '',
      // No RUN_FINISHED or RUN_ERROR
    ].join('\n');

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
      }) as Response;

    await proxyExternalAgent('http://example.com/agent', { threadId: 't1', runId: 'r1' }, (n) =>
      events.push(n)
    );

    const last = events[events.length - 1];
    assert.equal(last.params.type, 'RUN_ERROR');
    assert.ok(last.params.message.includes('without RUN_FINISHED'));
  });

  await test('proxy handles HTTP error from external agent', async () => {
    const events: any[] = [];

    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        body: null,
      }) as unknown as Response;

    await proxyExternalAgent('http://down.example.com/agent', { threadId: 't', runId: 'r' }, (n) =>
      events.push(n)
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].params.type, 'RUN_ERROR');
    assert.ok(events[0].params.message.includes('503'));
  });

  await test('proxy handles empty body', async () => {
    const events: any[] = [];

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        body: null,
      }) as unknown as Response;

    await proxyExternalAgent('http://example.com/agent', { threadId: 't', runId: 'r' }, (n) =>
      events.push(n)
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].params.type, 'RUN_ERROR');
    assert.ok(events[0].params.message.includes('no response body'));
  });

  await test('proxy stops processing after RUN_FINISHED', async () => {
    const events: any[] = [];
    const sseBody = [
      `data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' })}`,
      '',
      `data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Extra' })}`,
      '',
    ].join('\n');

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
      }) as Response;

    await proxyExternalAgent('http://example.com/agent', { threadId: 't1', runId: 'r1' }, (n) =>
      events.push(n)
    );

    // Should only have RUN_FINISHED, the extra event after it should be ignored
    assert.equal(events.length, 1);
    assert.equal(events[0].params.type, 'RUN_FINISHED');
  });

  await test('proxy ignores SSE comments and empty data', async () => {
    const events: any[] = [];
    const sseBody = [
      ': this is a comment',
      '',
      `data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: 't', runId: 'r' })}`,
      '',
      '', // empty block
      '',
      `data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' })}`,
      '',
    ].join('\n');

    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
      }) as Response;

    await proxyExternalAgent('http://example.com/agent', { threadId: 't', runId: 'r' }, (n) =>
      events.push(n)
    );

    assert.equal(events.length, 2);
    assert.equal(events[0].params.type, 'RUN_STARTED');
    assert.equal(events[1].params.type, 'RUN_FINISHED');
  });

  // Restore original fetch
  globalThis.fetch = originalFetch;
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. Event Ordering Guarantees
// ════════════════════════════════════════════════════════════════════════════════

async function testEventOrdering(): Promise<void> {
  console.log('\n  Event Ordering');

  await test('RUN_STARTED is always first event', () => {
    const events: any[] = [];
    const { outputHandler, finish } = createAGUIOutputHandler('p', 'm', 'r1', (n) =>
      events.push(n)
    );
    outputHandler('text');
    outputHandler({ emit: 'progress', value: 0.5 });
    finish({ result: true });

    assert.equal(events[0].params.type, AGUIEventType.RUN_STARTED);
  });

  await test('RUN_FINISHED is always last event on success', () => {
    const events: any[] = [];
    const { outputHandler, finish } = createAGUIOutputHandler('p', 'm', 'r1', (n) =>
      events.push(n)
    );
    outputHandler('text');
    finish({ data: true });

    const last = events[events.length - 1];
    assert.equal(last.params.type, AGUIEventType.RUN_FINISHED);
  });

  await test('RUN_ERROR is always last event on failure', () => {
    const events: any[] = [];
    const { outputHandler, error } = createAGUIOutputHandler('p', 'm', 'r1', (n) => events.push(n));
    outputHandler('partial');
    outputHandler({ emit: 'progress', value: 0.3, message: 'step1' });
    error('Failed');

    const last = events[events.length - 1];
    assert.equal(last.params.type, AGUIEventType.RUN_ERROR);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. Standard MCP Clients Unaffected
// ════════════════════════════════════════════════════════════════════════════════

async function testMCPCompatibility(): Promise<void> {
  console.log('\n  MCP Compatibility');

  await test('ag-ui/event notifications use standard JSON-RPC 2.0 format', () => {
    const events: any[] = [];
    const { finish } = createAGUIOutputHandler('p', 'm', 'r1', (n) => events.push(n));
    finish();

    for (const event of events) {
      assert.equal(event.jsonrpc, '2.0');
      assert.ok(event.method, 'Should have method field');
      assert.ok(event.params, 'Should have params field');
      assert.equal(event.id, undefined, 'Notifications should not have id');
    }
  });

  await test('ag-ui/event method is namespaced to avoid MCP collisions', () => {
    const events: any[] = [];
    const { finish } = createAGUIOutputHandler('p', 'm', 'r1', (n) => events.push(n));
    finish();

    for (const event of events) {
      assert.equal(event.method, 'ag-ui/event');
      assert.ok(
        event.method.startsWith('ag-ui/'),
        'AG-UI notifications should be namespaced under ag-ui/'
      );
    }
  });

  await test('AGUIEventType enum is iterable for capability advertisement', () => {
    const allEvents = Object.values(AGUIEventType);
    assert.ok(allEvents.length > 0);
    assert.ok(allEvents.includes('RUN_STARTED'));
    assert.ok(allEvents.includes('RUN_FINISHED'));
    assert.ok(allEvents.includes('RUN_ERROR'));
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   AG-UI ADAPTER TESTS                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testEventTypes();
  await testOutputHandler();
  await testProxy();
  await testEventOrdering();
  await testMCPCompatibility();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All AG-UI adapter tests passed!\n');
})();
