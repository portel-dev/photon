import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  DurableStatelessInputStateStore,
  hashInputStateValue,
  type MCPInputRequest,
  type StatelessInputBinding,
} from '../dist/mcp/protocol/input-required.js';
import { AppSessionHandleStore, hashAppSessionBinding } from '../dist/mcp/protocol/app-sessions.js';
import { IdempotencyStore } from '../dist/mcp/protocol/idempotency.js';

const VERSION = '2026-07-28';
const PHOTON_EXTENSION = 'dev.portel.photon';
const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const root = mkdtempSync(join(tmpdir(), 'photon-stateless-resilience-'));
const children = new Set<ChildProcess>();
let passed = 0;
let failed = 0;

async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function binding(): StatelessInputBinding {
  return {
    protocolVersion: VERSION,
    principal: hashInputStateValue('caller'),
    scope: hashInputStateValue('scope'),
    appSession: '',
    method: 'tools/call',
    target: 'resilience.ask#execute',
    argumentsHash: hashInputStateValue({}),
  };
}

const form: MCPInputRequest = {
  method: 'elicitation/create',
  params: { mode: 'form', message: 'Name?' },
};

function token(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({
    sub: 'caller-a',
    iss: 'https://issuer.example',
    aud: 'photon',
    scope: 'tools',
  })}.signature`;
}

function meta(
  options: { appSession?: string; tasks?: boolean; idempotencyKey?: string } = {}
): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'resilience-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {
      extensions: {
        [PHOTON_EXTENSION]: {},
        ...(options.tasks ? { [TASKS_EXTENSION]: {} } : {}),
      },
    },
    ...(options.appSession ? { [`${PHOTON_EXTENSION}/appSessionId`]: options.appSession } : {}),
    ...(options.idempotencyKey
      ? { [`${PHOTON_EXTENSION}/idempotencyKey`]: options.idempotencyKey }
      : {}),
  };
}

function requestHeaders(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Mcp-Protocol-Version': VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    Authorization: `Bearer ${token()}`,
  };
}

function post(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          const data = String(response.headers['content-type']).includes('text/event-stream')
            ? raw
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data: '))
                .map((line) => JSON.parse(line.slice(6)))
                .at(-1)
            : raw
              ? JSON.parse(raw)
              : null;
          resolve({ status: response.statusCode ?? 0, body: data });
        });
      }
    );
    request.once('error', reject);
    request.end(payload);
  });
}

async function startInstance(id: string): Promise<{ child: ChildProcess; port: number }> {
  const cli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const fixture = join(process.cwd(), 'tests', 'fixtures', 'mcp-stateless-instance.ts');
  const child = spawn(process.execPath, [cli, fixture, root, id], {
    env: { ...process.env, PHOTON_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`instance ${id} timeout: ${stderr}`)),
      15_000
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`instance ${id} exited ${code}: ${stderr}`));
    });
    child.stdout!.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('{'));
      if (!line) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line).port);
    });
  });
  return { child, port };
}

async function stopInstance(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

console.log('MCP 2026 stateless deployment and resilience:');

await test('durable request state resumes through a fresh store instance', async () => {
  const directory = join(root, 'direct-state');
  const firstStore = new DurableStatelessInputStateStore({
    directory,
    namespace: 'tool',
  });
  const execute = async (runtime: any) => runtime.request(form, 'profile');
  const first = await firstStore.begin(binding(), 'first', execute);
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;

  const restartedStore = new DurableStatelessInputStateStore({
    directory,
    namespace: 'tool',
  });
  const completed = await restartedStore.resume(
    {
      requestState: first.result.requestState!,
      binding: binding(),
      requestId: 'second',
      inputResponses: {
        profile: { action: 'accept', content: { name: 'Ada' } },
      },
    },
    execute
  );
  assert.equal(completed.kind, 'complete');
  if (completed.kind === 'complete') {
    assert.deepEqual(completed.value, { action: 'accept', content: { name: 'Ada' } });
  }
});

await test('a heartbeat prevents long resumes from losing their cross-process lock', async () => {
  const directory = join(root, 'heartbeat');
  const options = {
    directory,
    namespace: 'tool',
    lockTimeoutMs: 100,
    staleLockMs: 100,
  };
  const firstStore = new DurableStatelessInputStateStore(options);
  const secondStore = new DurableStatelessInputStateStore(options);
  let executions = 0;
  const execute = async (runtime: any) => {
    const answer = await runtime.request(form, 'profile');
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return answer;
  };
  const first = await firstStore.begin(binding(), 'heartbeat-1', execute);
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  const requestState = first.result.requestState!;
  const resumed = firstStore.resume(
    {
      requestState,
      binding: binding(),
      requestId: 'heartbeat-2',
      inputResponses: { profile: { action: 'accept', content: { name: 'Ada' } } },
    },
    execute
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  await assert.rejects(
    secondStore.resume(
      {
        requestState,
        binding: binding(),
        requestId: 'heartbeat-3',
        inputResponses: { profile: { action: 'accept', content: { name: 'Grace' } } },
      },
      execute
    ),
    (error: any) => error?.kind === 'replay' || error?.kind === 'invalid'
  );
  assert.equal((await resumed).kind, 'complete');
  assert.equal(executions, 1);
});

await test('app-session handles are opaque, scoped, shared, expiring, and revocable', () => {
  let now = 1_000;
  const directory = join(root, 'app-sessions');
  const storeA = new AppSessionHandleStore({ directory, ttlMs: 60_000, now: () => now });
  const bindingA = {
    principal: hashAppSessionBinding('principal-a'),
    scope: hashAppSessionBinding('scope-a'),
  };
  const handle = storeA.issue(bindingA);
  assert.match(handle, /^aps_[A-Za-z0-9_-]{43}$/);
  const storeB = new AppSessionHandleStore({ directory, ttlMs: 60_000, now: () => now });
  assert.equal(storeB.validate(handle, bindingA).ok, true);
  assert.deepEqual(storeB.validate(handle, { ...bindingA, scope: 'other' }), {
    ok: false,
    reason: 'mismatch',
  });
  assert.equal(storeB.revoke(handle, bindingA), true);
  assert.deepEqual(storeA.validate(handle, bindingA), { ok: false, reason: 'revoked' });

  const expiring = storeA.issue(bindingA);
  now += 60_001;
  assert.deepEqual(storeB.validate(expiring, bindingA), { ok: false, reason: 'expired' });
});

await test('idempotency records replay safe results and reject unsafe duplicates', () => {
  const store = new IdempotencyStore({ directory: join(root, 'idempotency') });
  const requestBinding = {
    principal: 'principal',
    scope: 'scope',
    appSession: '',
    tool: 'resilience.echo',
    argumentsHash: hashInputStateValue({ value: 1 }),
  };
  const safe = store.claim('safe-key', requestBinding, true);
  assert.equal(safe.kind, 'claimed');
  if (safe.kind !== 'claimed') return;
  store.complete(safe.keyHash, { jsonrpc: '2.0', id: 1, result: { value: 1 } });
  assert.equal(store.claim('safe-key', requestBinding, true).kind, 'cached');

  const unsafe = store.claim('unsafe-key', requestBinding, false);
  assert.equal(unsafe.kind, 'claimed');
  if (unsafe.kind !== 'claimed') return;
  store.complete(unsafe.keyHash, { jsonrpc: '2.0', id: 2, result: { value: 2 } });
  const duplicate = store.claim('unsafe-key', requestBinding, false);
  assert.deepEqual(duplicate, { kind: 'duplicate', pending: false, idempotent: false });
});

await test('two processes survive instance loss across input, task, session, and retry flows', async () => {
  const a = await startInstance('instance-a');
  const b = await startInstance('instance-b');
  let c: Awaited<ReturnType<typeof startInstance>> | undefined;
  try {
    const discovery = await post(
      a.port,
      {
        jsonrpc: '2.0',
        id: 'discover',
        method: 'server/discover',
        params: { _meta: meta() },
      },
      requestHeaders('server/discover')
    );
    assert.equal(discovery.status, 200);
    const appSession = discovery.body.result._meta[`${PHOTON_EXTENSION}/appSessionId`];
    assert.match(appSession, /^aps_/);

    const first = await post(
      a.port,
      {
        jsonrpc: '2.0',
        id: 'ask-1',
        method: 'tools/call',
        params: {
          name: 'resilience.ask',
          arguments: {},
          _meta: meta({ appSession }),
        },
      },
      requestHeaders('tools/call', 'resilience.ask')
    );
    assert.equal(first.body.result.resultType, 'input_required');
    await stopInstance(a.child);

    const resumed = await post(
      b.port,
      {
        jsonrpc: '2.0',
        id: 'ask-2',
        method: 'tools/call',
        params: {
          name: 'resilience.ask',
          arguments: {},
          requestState: first.body.result.requestState,
          inputResponses: {
            profile: { action: 'accept', content: { value: 'Ada' } },
          },
          _meta: meta({ appSession }),
        },
      },
      requestHeaders('tools/call', 'resilience.ask')
    );
    assert.equal(resumed.status, 200);
    assert.ok(resumed.body.result?.structuredContent, JSON.stringify(resumed.body));
    assert.equal(
      resumed.body.result.structuredContent.completedBy,
      'instance-b',
      JSON.stringify(resumed.body)
    );

    const safe = await post(
      b.port,
      {
        jsonrpc: '2.0',
        id: 'safe-1',
        method: 'tools/call',
        params: {
          name: 'resilience.echo',
          arguments: { value: 7 },
          _meta: meta({ appSession, idempotencyKey: 'safe-cross-instance' }),
        },
      },
      requestHeaders('tools/call', 'resilience.echo')
    );
    assert.equal(safe.body.result.structuredContent.instanceId, 'instance-b');

    c = await startInstance('instance-c');
    const replay = await post(
      c.port,
      {
        jsonrpc: '2.0',
        id: 'safe-2',
        method: 'tools/call',
        params: {
          name: 'resilience.echo',
          arguments: { value: 7 },
          _meta: meta({ appSession, idempotencyKey: 'safe-cross-instance' }),
        },
      },
      requestHeaders('tools/call', 'resilience.echo')
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.result.structuredContent, safe.body.result.structuredContent);

    const unsafe = await post(
      b.port,
      {
        jsonrpc: '2.0',
        id: 'unsafe-1',
        method: 'tools/call',
        params: {
          name: 'resilience.mutate',
          arguments: {},
          _meta: meta({ appSession, idempotencyKey: 'unsafe-cross-instance' }),
        },
      },
      requestHeaders('tools/call', 'resilience.mutate')
    );
    assert.equal(unsafe.status, 200);
    const duplicateUnsafe = await post(
      c.port,
      {
        jsonrpc: '2.0',
        id: 'unsafe-2',
        method: 'tools/call',
        params: {
          name: 'resilience.mutate',
          arguments: {},
          _meta: meta({ appSession, idempotencyKey: 'unsafe-cross-instance' }),
        },
      },
      requestHeaders('tools/call', 'resilience.mutate')
    );
    assert.equal(duplicateUnsafe.status, 409);

    const taskCreated = await post(
      b.port,
      {
        jsonrpc: '2.0',
        id: 'task-create',
        method: 'tools/call',
        params: {
          name: 'resilience.background',
          arguments: {},
          _meta: meta({ appSession, tasks: true }),
        },
      },
      requestHeaders('tools/call', 'resilience.background')
    );
    assert.equal(taskCreated.body.result.resultType, 'task');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const taskRead = await post(
      c.port,
      {
        jsonrpc: '2.0',
        id: 'task-read',
        method: 'tasks/get',
        params: {
          taskId: taskCreated.body.result.taskId,
          _meta: meta({ appSession, tasks: true }),
        },
      },
      requestHeaders('tasks/get', taskCreated.body.result.taskId)
    );
    assert.equal(taskRead.status, 200);
    assert.equal(taskRead.body.result.status, 'completed');

    const revoked = await post(
      c.port,
      {
        jsonrpc: '2.0',
        id: 'revoke',
        method: `${PHOTON_EXTENSION}/app-sessions/revoke`,
        params: { handle: appSession, _meta: meta({ appSession }) },
      },
      requestHeaders(`${PHOTON_EXTENSION}/app-sessions/revoke`)
    );
    assert.equal(revoked.body.result.revoked, true);
    const stale = await post(
      b.port,
      {
        jsonrpc: '2.0',
        id: 'stale',
        method: 'tools/list',
        params: { _meta: meta({ appSession }) },
      },
      requestHeaders('tools/list')
    );
    assert.equal(stale.status, 400);
  } finally {
    await stopInstance(a.child);
    await stopInstance(b.child);
    if (c) await stopInstance(c.child);
  }
});

await test('storage corruption fails closed before replaying user code', async () => {
  const directory = join(root, 'storage-outage');
  const store = new DurableStatelessInputStateStore({ directory, namespace: 'tool' });
  let executions = 0;
  const execute = async (runtime: any) => {
    executions += 1;
    return runtime.request(form, 'profile');
  };
  const first = await store.begin(binding(), 'outage-1', execute);
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  const statePath = join(directory, 'tool', `${first.result.requestState}.json`);
  writeFileSync(statePath, '{broken', 'utf8');
  await assert.rejects(
    store.resume(
      {
        requestState: first.result.requestState!,
        binding: binding(),
        requestId: 'outage-2',
        inputResponses: { profile: { action: 'cancel' } },
      },
      execute
    )
  );
  assert.equal(executions, 1);
});

await test('partial durable-storage outages fail closed without looking like bad handles', async () => {
  const inputDirectory = join(root, 'unavailable-input');
  const inputStore = new DurableStatelessInputStateStore({
    directory: inputDirectory,
    namespace: 'tool',
  });
  const first = await inputStore.begin(binding(), 'unavailable-1', (runtime) =>
    runtime.request(form, 'profile')
  );
  assert.equal(first.kind, 'input-required');
  if (first.kind !== 'input-required') return;
  rmSync(join(inputDirectory, 'tool'), { recursive: true, force: true });
  writeFileSync(join(inputDirectory, 'tool'), 'storage offline', 'utf8');
  await assert.rejects(
    inputStore.resume(
      {
        requestState: first.result.requestState!,
        binding: binding(),
        requestId: 'unavailable-2',
        inputResponses: { profile: { action: 'cancel' } },
      },
      (runtime) => runtime.request(form, 'profile')
    ),
    (error: any) => error?.kind === 'unavailable'
  );

  const appDirectory = join(root, 'unavailable-app-sessions');
  const appStore = new AppSessionHandleStore({ directory: appDirectory });
  const appBinding = {
    principal: hashAppSessionBinding('availability-principal'),
    scope: hashAppSessionBinding('availability-scope'),
  };
  const handle = appStore.issue(appBinding);
  rmSync(appDirectory, { recursive: true, force: true });
  writeFileSync(appDirectory, 'storage offline', 'utf8');
  assert.deepEqual(appStore.validate(handle, appBinding), {
    ok: false,
    reason: 'unavailable',
  });

  const idempotencyDirectory = join(root, 'unavailable-idempotency');
  const idempotencyStore = new IdempotencyStore({ directory: idempotencyDirectory });
  rmSync(idempotencyDirectory, { recursive: true, force: true });
  writeFileSync(idempotencyDirectory, 'storage offline', 'utf8');
  assert.throws(
    () =>
      idempotencyStore.claim(
        'unavailable-key',
        {
          principal: 'principal',
          scope: 'scope',
          appSession: '',
          tool: 'resilience.echo',
          argumentsHash: hashInputStateValue({}),
        },
        true
      ),
    (error: any) => error?.code === 'EEXIST' || error?.code === 'ENOTDIR'
  );
});

for (const child of children) child.kill('SIGKILL');
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
