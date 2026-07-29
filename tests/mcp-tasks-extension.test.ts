/**
 * io.modelcontextprotocol/tasks draft integration tests.
 *
 * Runs against built output because this is a wire-level compatibility gate.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const taskRoot = mkdtempSync(join(tmpdir(), 'photon-mcp-tasks-extension-'));
process.env.PHOTON_DIR = taskRoot;

const transport = await import('../dist/auto-ui/streamable-http-transport.js');
const store = await import('../dist/tasks/store.js');

const VERSION = '2026-07-28';
const TASK_EXTENSION = 'io.modelcontextprotocol/tasks';
const REAL_NODE =
  '/Users/arul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';

function meta(options: { tasks?: boolean; appSession?: string } = {}) {
  return {
    'io.modelcontextprotocol/protocolVersion': VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'tasks-extension-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': options.tasks
      ? { extensions: { [TASK_EXTENSION]: {} } }
      : {},
    ...(options.appSession ? { 'photon/appSessionId': options.appSession } : {}),
  };
}

function headers(method: string, name?: string, authorization?: string) {
  return {
    'Mcp-Protocol-Version': VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

function bearer(subject: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${encode({ alg: 'none' })}.${encode({
    sub: subject,
    iss: 'https://issuer.example',
    aud: 'photon',
    scope: 'tools',
  })}.signature`;
}

function postJSON(
  port: number,
  body: Record<string, unknown>,
  requestHeaders: Record<string, string> = {}
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
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...requestHeaders,
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          const contentType = String(response.headers['content-type'] ?? '');
          const body = contentType.includes('text/event-stream')
            ? raw
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data: '))
                .map((line) => JSON.parse(line.slice(6)))
                .at(-1)
            : raw
              ? JSON.parse(raw)
              : null;
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 2_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = await read();
  }
  assert(accept(value), 'condition was not reached before timeout');
  return value;
}

let passed = 0;
let failed = 0;
async function test(name: string, run: () => Promise<void> | void) {
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

const photon = {
  id: 'durable-id',
  name: 'durable',
  path: join(taskRoot, 'durable.photon.ts'),
  configured: true,
  methods: [
    {
      name: 'approval',
      description: 'Wait for approval',
      params: { type: 'object', properties: {} },
      returns: { type: 'object' },
      isAsync: true,
    },
  ],
};
const mcp = {
  instance: {
    approval: async () => ({ fallback: true }),
  },
};
const loader = {
  executeTool: async (
    _mcp: unknown,
    _method: string,
    args: Record<string, unknown>,
    options: {
      inputProvider: (ask: unknown) => Promise<unknown>;
      signal?: AbortSignal;
    }
  ) => {
    if (args.fail === true) throw new Error('legacy failure');
    const answer = await options.inputProvider({
      ask: 'text',
      message: args.message ?? 'Approval value',
    });
    return { answer };
  },
};
const context = {
  photons: [photon],
  photonMCPs: new Map([['durable', mcp]]),
  externalMCPs: [],
  externalMCPClients: new Map(),
  externalMCPSDKClients: new Map(),
  reconnectExternalMCP: async () => false,
  loadUIAsset: async () => null,
  configurePhoton: async () => ({ success: false }),
  reloadPhoton: async () => ({ success: false }),
  removePhoton: async () => ({ success: false }),
  updateMetadata: () => undefined,
  generatePhotonHelp: () => '',
  loader,
  broadcast: () => undefined,
  workingDir: taskRoot,
  // The suite exercises task ownership, not JWT cryptography. Supply the
  // transport's verifier seam so its synthetic tokens still represent two
  // authenticated principals after the runtime stopped accepting decoded-only
  // JWTs.
  verifyBearerToken: async (token: string) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return {
        ok: true,
        claims: {
          sub: payload.sub,
          iss: payload.iss,
          aud: payload.aud,
          scope: payload.scope,
        },
      };
    } catch {
      return { ok: false, reason: 'invalid test token' };
    }
  },
};

const server = http.createServer(async (request, response) => {
  if (!(await transport.handleStreamableHTTP(request, response, context as any))) {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const port = address.port;

const ownerA = bearer('caller-a');
const ownerB = bearer('caller-b');
const taskMeta = meta({ tasks: true, appSession: 'app-a' });

function extensionRequest(
  id: string,
  method: string,
  params: Record<string, unknown>,
  authorization = ownerA
) {
  return postJSON(
    port,
    { jsonrpc: '2.0', id, method, params: { ...params, _meta: taskMeta } },
    headers(method, String(params.name ?? params.taskId ?? ''), authorization)
  );
}

console.log('\nMCP Tasks extension:');

await test('advertises the pinned Tasks extension while keeping creation server-directed', async () => {
  const discovery = await postJSON(
    port,
    {
      jsonrpc: '2.0',
      id: 'discover',
      method: 'server/discover',
      params: { _meta: meta() },
    },
    headers('server/discover')
  );
  assert.equal(discovery.status, 200);
  assert.deepEqual(discovery.body.result.capabilities.extensions[TASK_EXTENSION], {});

  const withoutExtension = await postJSON(
    port,
    {
      jsonrpc: '2.0',
      id: 'without-extension',
      method: 'tools/call',
      params: {
        name: 'durable.approval',
        arguments: {},
        task: { ttl: 1 },
        _meta: meta(),
      },
    },
    headers('tools/call', 'durable.approval', ownerA)
  );
  assert.equal(withoutExtension.status, 200);
  assert.equal(withoutExtension.body.result.resultType, 'input_required');
  assert.equal(withoutExtension.body.result.taskId, undefined);
});

let completedTaskId = '';
let completedInputKey = '';

await test('persists a modern task before returning its flat task handle', async () => {
  const created = await extensionRequest('create-task', 'tools/call', {
    name: 'durable.approval',
    arguments: { message: 'Name the release' },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.resultType, 'task');
  assert.equal(created.body.result.status, 'working');
  assert.equal(typeof created.body.result.taskId, 'string');
  assert.equal(typeof created.body.result.ttlMs, 'number');
  assert.equal(typeof created.body.result.pollIntervalMs, 'number');
  assert.equal(created.body.result.task, undefined);
  completedTaskId = created.body.result.taskId;

  const persisted = store.getTask(completedTaskId);
  assert(persisted, 'task must be readable as soon as the handle is returned');
  assert.equal(persisted.protocol, 'extension-2026');
  assert(existsSync(join(store._getTasksDir(), `${completedTaskId}.json`)));
});

await test('surfaces input_required and ignores unknown or duplicate update keys', async () => {
  const waiting = await eventually(
    () => extensionRequest('get-input', 'tasks/get', { taskId: completedTaskId }),
    (response) => response.body?.result?.status === 'input_required'
  );
  assert.equal(waiting.body.result.resultType, 'complete');
  const entries = Object.entries(waiting.body.result.inputRequests);
  assert.equal(entries.length, 1);
  completedInputKey = entries[0][0];
  assert.deepEqual(entries[0][1], {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Name the release',
      requestedSchema: {
        type: 'object',
        properties: {
          value: {
            type: 'string',
            title: 'Input',
            description: 'Name the release',
          },
        },
        required: ['value'],
      },
    },
  });

  const unknown = await extensionRequest('unknown-input', 'tasks/update', {
    taskId: completedTaskId,
    inputResponses: { unknown: { action: 'accept', content: { value: 'wrong' } } },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.result.resultType, 'complete');
  const stillWaiting = await extensionRequest('still-waiting', 'tasks/get', {
    taskId: completedTaskId,
  });
  assert.equal(stillWaiting.body.result.status, 'input_required');

  const accepted = await extensionRequest('valid-input', 'tasks/update', {
    taskId: completedTaskId,
    inputResponses: {
      [completedInputKey]: { action: 'accept', content: { value: 'Photon 2026' } },
    },
  });
  assert.equal(accepted.status, 200);
  const duplicate = await extensionRequest('duplicate-input', 'tasks/update', {
    taskId: completedTaskId,
    inputResponses: {
      [completedInputKey]: { action: 'accept', content: { value: 'replay' } },
    },
  });
  assert.equal(duplicate.status, 200);
});

await test('returns completed result inline and binds task access to the caller', async () => {
  const denied = await extensionRequest(
    'other-caller',
    'tasks/get',
    { taskId: completedTaskId },
    ownerB
  );
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error.code, -32602);

  const completed = await eventually(
    () => extensionRequest('get-completed', 'tasks/get', { taskId: completedTaskId }),
    (response) => response.body?.result?.status === 'completed'
  );
  assert.equal(completed.body.result.resultType, 'complete');
  assert.equal(completed.body.result.result.isError, false);
  assert.match(completed.body.result.result.content[0].text, /Photon 2026/);
});

let cancelledTaskId = '';
await test('cancels cooperatively and acknowledges duplicate cancellation idempotently', async () => {
  const created = await extensionRequest('create-cancel', 'tools/call', {
    name: 'durable.approval',
    arguments: { message: 'This task will be cancelled' },
  });
  cancelledTaskId = created.body.result.taskId;
  await eventually(
    () => extensionRequest('wait-cancel', 'tasks/get', { taskId: cancelledTaskId }),
    (response) => response.body?.result?.status === 'input_required'
  );
  const first = await extensionRequest('cancel-1', 'tasks/cancel', {
    taskId: cancelledTaskId,
  });
  const second = await extensionRequest('cancel-2', 'tasks/cancel', {
    taskId: cancelledTaskId,
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.result.resultType, 'complete');
  const cancelled = await extensionRequest('get-cancelled', 'tasks/get', {
    taskId: cancelledTaskId,
  });
  assert.equal(cancelled.body.result.status, 'cancelled');
});

await test('renders structured failed state and expires modern records from creation TTL', async () => {
  const failed = store.createTask('durable', 'approval', {}, 60_000, {
    protocol: 'extension-2026',
    owner: store.getTask(completedTaskId)!.owner,
  });
  store.updateTask(failed.id, {
    state: 'failed',
    error: { code: -32603, message: 'Worker unavailable', data: { code: 'WORKER_LOST' } },
  });
  const failedResponse = await extensionRequest('get-failed', 'tasks/get', {
    taskId: failed.id,
  });
  assert.equal(failedResponse.body.result.status, 'failed');
  assert.deepEqual(failedResponse.body.result.error, {
    code: -32603,
    message: 'Worker unavailable',
    data: { code: 'WORKER_LOST' },
  });

  const expiring = store.createTask('durable', 'approval', {}, 1, {
    protocol: 'extension-2026',
    owner: store.getTask(completedTaskId)!.owner,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.cleanExpiredTasks(), 1);
  assert.equal(store.getTask(expiring.id), null);
});

await test('turns interrupted persisted continuations into an explicit restart failure', async () => {
  const interrupted = store.createTask('durable', 'approval', {}, 60_000, {
    protocol: 'extension-2026',
    owner: store.getTask(completedTaskId)!.owner,
  });
  const child = spawnSync(
    REAL_NODE,
    [
      '--input-type=module',
      '-e',
      `process.env.PHOTON_DIR=${JSON.stringify(taskRoot)}; const s=await import(${JSON.stringify(
        new URL('../dist/tasks/store.js', import.meta.url).href
      )}); s.recoverInterruptedTasks();`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  const recovered = store.getTask(interrupted.id);
  assert.equal(recovered?.state, 'failed');
  assert.equal(
    typeof recovered?.error === 'object' && recovered.error.data?.code,
    'PHOTON_TASK_INTERRUPTED_BY_RESTART'
  );
});

await test('retains the 2025 create/get/list wire vocabulary in parallel', async () => {
  const created = await postJSON(port, {
    jsonrpc: '2.0',
    id: 'legacy-create',
    method: 'tasks/create',
    params: { photon: 'durable', method: 'approval', params: {} },
  });
  assert.equal(created.status, 200);
  assert.equal(typeof created.body.result.task.ttl, 'number');
  assert.equal(typeof created.body.result.task.pollInterval, 'number');
  assert.equal(created.body.result.task.ttlMs, undefined);
  assert.equal(created.body.result.resultType, undefined);

  const legacyId = created.body.result.task.taskId;
  const fetched = await postJSON(port, {
    jsonrpc: '2.0',
    id: 'legacy-get',
    method: 'tasks/get',
    params: { taskId: legacyId },
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.result.taskId, legacyId);
  assert.equal(fetched.body.result.ttlMs, undefined);

  const failedCreate = await postJSON(port, {
    jsonrpc: '2.0',
    id: 'legacy-failed-create',
    method: 'tasks/create',
    params: { photon: 'durable', method: 'approval', params: { fail: true } },
  });
  const failedId = failedCreate.body.result.task.taskId;
  await eventually(
    () =>
      postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-failed-get',
        method: 'tasks/get',
        params: { taskId: failedId },
      }),
    (response) => response.body?.result?.status === 'failed'
  );
  const failedResult = await postJSON(port, {
    jsonrpc: '2.0',
    id: 'legacy-failed-result',
    method: 'tasks/result',
    params: { taskId: failedId },
  });
  assert.equal(failedResult.body.result.isError, true);
  assert.equal(failedResult.body.result.content[0].text, 'legacy failure');
});

await new Promise<void>((resolve) => server.close(() => resolve()));
rmSync(taskRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
