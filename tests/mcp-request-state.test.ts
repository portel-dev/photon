import { strict as assert } from 'node:assert';
import {
  canonicalizeInputStateValue,
  hashInputStateValue,
  StatelessInputStateError,
  StatelessInputStateStore,
  type MCPInputRequest,
  type StatelessInputBinding,
} from '../dist/mcp/protocol/input-required.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function binding(overrides: Partial<StatelessInputBinding> = {}): StatelessInputBinding {
  return {
    protocolVersion: '2026-07-28',
    principal: 'principal-a',
    scope: 'scope-a',
    appSession: '',
    method: 'tools/call',
    target: 'fixture/ask#execute',
    argumentsHash: hashInputStateValue({ count: 1 }),
    ...overrides,
  };
}

const formRequest: MCPInputRequest = {
  method: 'elicitation/create',
  params: {
    mode: 'form',
    message: 'Name?',
    requestedSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
};

const samplingRequest: MCPInputRequest = {
  method: 'sampling/createMessage',
  params: {
    messages: [{ role: 'user', content: { type: 'text', text: 'Answer' } }],
    maxTokens: 20,
  },
};

console.log('MCP stateless request-state store:');

await test('canonical argument hashing ignores object insertion order', () => {
  assert.equal(
    canonicalizeInputStateValue({ z: 1, a: { y: true, x: [2, 3] } }),
    canonicalizeInputStateValue({ a: { x: [2, 3], y: true }, z: 1 })
  );
  assert.equal(hashInputStateValue({ b: 2, a: 1 }), hashInputStateValue({ a: 1, b: 2 }));
  assert.throws(() => canonicalizeInputStateValue({ bad: Number.NaN }), StatelessInputStateError);
  assert.throws(() => canonicalizeInputStateValue({ bad: undefined }), StatelessInputStateError);
});

await test('form input pauses and completes on a fresh-id retry', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 1, async (runtime) => {
    return runtime.request(formRequest, 'profile');
  });
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  assert.match(first.result.requestState!, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(first.result.inputRequests!), ['profile']);

  const completed = await store.resume<{ action: string; content: { name: string } }>({
    requestState: first.result.requestState!,
    binding: binding(),
    requestId: 2,
    inputResponses: {
      profile: { action: 'accept', content: { name: 'Ada' } },
    },
  });
  assert.equal(completed.kind, 'complete');
  if (completed.kind === 'complete') assert.equal(completed.value.content.name, 'Ada');
  assert.equal(store.size, 0);
});

await test('retry requires a new JSON-RPC id and preserves state after rejection', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 'same', (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  await assert.rejects(
    store.resume({
      requestState: first.result.requestState!,
      binding: binding(),
      requestId: 'same',
      inputResponses: { profile: { action: 'decline' } },
    }),
    (error: unknown) => error instanceof StatelessInputStateError && error.kind === 'replay'
  );
  const completed = await store.resume({
    requestState: first.result.requestState!,
    binding: binding(),
    requestId: 'fresh',
    inputResponses: { profile: { action: 'decline' } },
  });
  assert.equal(completed.kind, 'complete');
});

await test('caller, scope, tool, and argument binding mismatches are rejected', async () => {
  for (const changed of [
    { principal: 'principal-b' },
    { scope: 'scope-b' },
    { target: 'fixture/other#execute' },
    { argumentsHash: hashInputStateValue({ count: 2 }) },
  ]) {
    const store = new StatelessInputStateStore();
    const first = await store.begin(binding(), 1, (runtime) =>
      runtime.request(formRequest, 'profile')
    );
    assert.equal(first.kind, 'input-required');
    if (first.kind !== 'input-required') continue;
    await assert.rejects(
      store.resume({
        requestState: first.result.requestState!,
        binding: binding(changed),
        requestId: 2,
        inputResponses: { profile: { action: 'cancel' } },
      }),
      (error: unknown) => error instanceof StatelessInputStateError && error.kind === 'mismatch'
    );
    store.close();
  }
});

await test('partial responses rotate state and expose only outstanding requests', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 1, (runtime) =>
    runtime.requestMany({ profile: formRequest, draft: samplingRequest })
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  const initialState = first.result.requestState!;

  const partial = await store.resume({
    requestState: initialState,
    binding: binding(),
    requestId: 2,
    inputResponses: { profile: { action: 'accept', content: { name: 'Ada' } } },
  });
  assert.equal(partial.kind, 'input-required');
  if (partial.kind !== 'input-required') return;
  assert.notEqual(partial.result.requestState, initialState);
  assert.deepEqual(Object.keys(partial.result.inputRequests!), ['draft']);
  await assert.rejects(
    store.resume({
      requestState: initialState,
      binding: binding(),
      requestId: 3,
      inputResponses: {
        draft: {
          role: 'assistant',
          content: { type: 'text', text: 'stale' },
        },
      },
    }),
    StatelessInputStateError
  );

  const completed = await store.resume<Record<string, unknown>>({
    requestState: partial.result.requestState!,
    binding: binding(),
    requestId: 3,
    inputResponses: {
      draft: {
        role: 'assistant',
        content: { type: 'text', text: 'done' },
        model: 'fixture',
      },
    },
  });
  assert.equal(completed.kind, 'complete');
  if (completed.kind === 'complete') {
    assert.deepEqual(Object.keys(completed.value).sort(), ['draft', 'profile']);
  }
});

await test('sequential input rounds each produce a new input_required turn', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 1, async (runtime) => {
    const profile = await runtime.request(formRequest, 'profile');
    const draft = await runtime.request(samplingRequest, 'draft');
    return { profile, draft };
  });
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  const second = await store.resume({
    requestState: first.result.requestState!,
    binding: binding(),
    requestId: 2,
    inputResponses: { profile: { action: 'accept', content: { name: 'Ada' } } },
  });
  assert.equal(second.kind, 'input-required');
  if (second.kind !== 'input-required') return;
  assert.deepEqual(Object.keys(second.result.inputRequests!), ['draft']);
  const final = await store.resume({
    requestState: second.result.requestState!,
    binding: binding(),
    requestId: 3,
    inputResponses: {
      draft: {
        role: 'assistant',
        content: { type: 'text', text: 'hello' },
      },
    },
  });
  assert.equal(final.kind, 'complete');
});

await test('unknown keys, duplicate answers, and malformed direct results are rejected', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 1, (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  for (const inputResponses of [
    { unknown: { action: 'accept', content: {} } },
    { profile: { action: 'maybe' } },
    { profile: 'not-a-result' },
  ]) {
    await assert.rejects(
      store.resume({
        requestState: first.result.requestState!,
        binding: binding(),
        requestId: Math.random(),
        inputResponses,
      }),
      StatelessInputStateError
    );
  }
  store.close();
});

await test('expiry rejects pending execution and removes its state', async () => {
  let now = 1_000;
  const store = new StatelessInputStateStore({ ttlMs: 10, now: () => now });
  const first = await store.begin(binding(), 1, (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  now += 11;
  assert.equal(store.sweep(), 1);
  assert.equal(store.size, 0);
  await assert.rejects(
    store.resume({
      requestState: first.result.requestState!,
      binding: binding(),
      requestId: 2,
      inputResponses: { profile: { action: 'cancel' } },
    }),
    StatelessInputStateError
  );
});

await test('cancellation and restart invalidate outstanding state', async () => {
  const store = new StatelessInputStateStore();
  const first = await store.begin(binding(), 1, (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  assert.equal(store.cancel(first.result.requestState!, binding()), true);
  assert.equal(store.size, 0);

  const restarted = new StatelessInputStateStore();
  await assert.rejects(
    restarted.resume({
      requestState: first.result.requestState!,
      binding: binding(),
      requestId: 2,
      inputResponses: { profile: { action: 'cancel' } },
    }),
    StatelessInputStateError
  );
});

await test('global and per-principal capacity limits fail closed', async () => {
  const store = new StatelessInputStateStore({
    maxEntries: 2,
    maxEntriesPerPrincipal: 1,
  });
  const first = await store.begin(binding(), 1, (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  await assert.rejects(
    store.begin(binding(), 2, (runtime) => runtime.request(formRequest, 'profile')),
    (error: unknown) => error instanceof StatelessInputStateError && error.kind === 'capacity'
  );
  const other = await store.begin(binding({ principal: 'principal-b' }), 3, (runtime) =>
    runtime.request(formRequest, 'profile')
  );
  assert.equal(other.kind, 'input-required');
  await assert.rejects(
    store.begin(binding({ principal: 'principal-c' }), 4, (runtime) =>
      runtime.request(formRequest, 'profile')
    ),
    (error: unknown) => error instanceof StatelessInputStateError && error.kind === 'capacity'
  );
  store.close();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
