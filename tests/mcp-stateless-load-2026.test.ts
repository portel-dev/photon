import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const VERSION = '2026-07-28';
const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const root = mkdtempSync(join(tmpdir(), 'photon-stateless-load-'));

function meta(tasks = false): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'photon-load-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': tasks
      ? { extensions: { [TASKS_EXTENSION]: {} } }
      : {},
  };
}

function headers(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Mcp-Protocol-Version': VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
  };
}

function post(
  port: number,
  body: Record<string, unknown>,
  requestHeaders: Record<string, string>
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
          ...requestHeaders,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          const value = String(response.headers['content-type']).includes('text/event-stream')
            ? raw
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data: '))
                .map((line) => JSON.parse(line.slice(6)))
                .at(-1)
            : raw
              ? JSON.parse(raw)
              : null;
          resolve({ status: response.statusCode ?? 0, body: value });
        });
      }
    );
    request.once('error', reject);
    request.end(payload);
  });
}

function percentile(values: number[], quantile: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1)] ?? 0;
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const started = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - started };
}

async function startInstance(): Promise<{ child: ChildProcess; port: number }> {
  const cli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const fixture = join(process.cwd(), 'tests', 'fixtures', 'mcp-stateless-instance.ts');
  const child = spawn(process.execPath, [cli, fixture, root, 'load-instance'], {
    env: { ...process.env, PHOTON_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`load fixture startup timed out: ${stderr}`));
    }, 10_000);
    child.stderr!.on('data', (chunk) => (stderr += chunk));
    child.stdout!.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve({ child, port: JSON.parse(stdout.slice(0, newline)).port });
      } catch (error) {
        reject(error);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`load fixture exited (${code}): ${stderr}`));
    });
  });
}

async function stopInstance(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function openSubscription(
  port: number,
  id: string
): Promise<{
  waitFor: (method: string) => Promise<void>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: {
        _meta: meta(),
        notifications: { toolsListChanged: true },
      },
    };
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          ...headers('subscriptions/listen'),
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        assert.equal(response.statusCode, 200);
        let buffer = '';
        const observed = new Set<string>();
        const waiters = new Map<string, Array<() => void>>();
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffer += chunk;
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .find((line) => line.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (data) {
              const event = JSON.parse(data);
              if (typeof event.method === 'string') {
                observed.add(event.method);
                for (const waiter of waiters.get(event.method) ?? []) waiter();
                waiters.delete(event.method);
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        });
        resolve({
          waitFor: (method) =>
            observed.has(method)
              ? Promise.resolve()
              : new Promise<void>((resolveEvent, rejectEvent) => {
                  const timer = setTimeout(
                    () => rejectEvent(new Error(`timed out waiting for ${method}`)),
                    2_000
                  );
                  const waiter = () => {
                    clearTimeout(timer);
                    resolveEvent();
                  };
                  waiters.set(method, [...(waiters.get(method) ?? []), waiter]);
                }),
          close: () => {
            response.destroy();
            request.destroy();
          },
        });
      }
    );
    request.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    request.end(payload);
  });
}

async function toolCall(
  port: number,
  id: string,
  name: string,
  args: Record<string, unknown> = {},
  tasks = false
) {
  return post(
    port,
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: `resilience.${name}`, arguments: args, _meta: meta(tasks) },
    },
    headers('tools/call', `resilience.${name}`)
  );
}

console.log('\nMCP 2026 stateless load gates:');
const instance = await startInstance();
const streams: Awaited<ReturnType<typeof openSubscription>>[] = [];
try {
  const before = await toolCall(instance.port, 'memory-before', 'metrics');
  const beforeRss = before.body.result.structuredContent.rss as number;

  const discoveryAndListLatencies: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const method = index % 2 === 0 ? 'server/discover' : 'tools/list';
    const result = await timed(() =>
      post(
        instance.port,
        {
          jsonrpc: '2.0',
          id: `cache-${index}`,
          method,
          params: { _meta: meta() },
        },
        headers(method)
      )
    );
    assert.equal(result.value.status, 200);
    assert.equal(result.value.body.result.cacheScope, 'public');
    assert.equal(result.value.body.result.ttlMs, 30_000);
    discoveryAndListLatencies.push(result.elapsedMs);
  }

  const concurrentCalls = await Promise.all(
    Array.from({ length: 64 }, (_, index) =>
      timed(() => toolCall(instance.port, `echo-${index}`, 'echo', { value: index }))
    )
  );
  for (const result of concurrentCalls) assert.equal(result.value.status, 200);

  for (let index = 0; index < 12; index += 1) {
    streams.push(await openSubscription(instance.port, `fanout-${index}`));
  }
  await Promise.all(
    streams.map((stream) => stream.waitFor('notifications/subscriptions/acknowledged'))
  );
  const fanoutStarted = performance.now();
  const fanoutWaiters = streams.map((stream) => stream.waitFor('notifications/tools/list_changed'));
  const notified = await toolCall(instance.port, 'notify-fanout', 'notify');
  assert.equal(notified.status, 200);
  await Promise.all(fanoutWaiters);
  const fanoutMs = performance.now() - fanoutStarted;
  for (const stream of streams.splice(0)) stream.close();

  const taskStarted = performance.now();
  const taskCreates = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      toolCall(instance.port, `task-create-${index}`, 'background', {}, true)
    )
  );
  const taskIds = taskCreates.map((created) => {
    assert.equal(created.body.result.resultType, 'task');
    return created.body.result.taskId as string;
  });
  const pending = new Set(taskIds);
  while (pending.size > 0 && performance.now() - taskStarted < 3_000) {
    await Promise.all(
      [...pending].map(async (taskId, index) => {
        const read = await post(
          instance.port,
          {
            jsonrpc: '2.0',
            id: `task-read-${index}-${performance.now()}`,
            method: 'tasks/get',
            params: { taskId, _meta: meta(true) },
          },
          headers('tasks/get', taskId)
        );
        if (read.body.result?.status === 'completed') pending.delete(taskId);
      })
    );
    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(pending.size, 0);
  const taskPollingMs = performance.now() - taskStarted;

  const multiRoundStarted = performance.now();
  const firstTurns = await Promise.all(
    Array.from({ length: 8 }, (_, index) => toolCall(instance.port, `ask-first-${index}`, 'ask'))
  );
  const resumedTurns = await Promise.all(
    firstTurns.map((first, index) => {
      assert.equal(first.body.result.resultType, 'input_required');
      return post(
        instance.port,
        {
          jsonrpc: '2.0',
          id: `ask-resume-${index}`,
          method: 'tools/call',
          params: {
            name: 'resilience.ask',
            arguments: {},
            requestState: first.body.result.requestState,
            inputResponses: {
              profile: { action: 'accept', content: { value: `coder-${index}` } },
            },
            _meta: meta(),
          },
        },
        headers('tools/call', 'resilience.ask')
      );
    })
  );
  for (const resumed of resumedTurns) {
    assert.equal(resumed.body.result.structuredContent.completedBy, 'load-instance');
  }
  const multiRoundMs = performance.now() - multiRoundStarted;

  const after = await toolCall(instance.port, 'memory-after', 'metrics');
  const afterRss = after.body.result.structuredContent.rss as number;
  const report = {
    samples: {
      discoveryAndList: discoveryAndListLatencies.length,
      concurrentToolCalls: concurrentCalls.length,
      subscriptionFanout: 12,
      taskPolling: taskIds.length,
      multiRoundRetries: resumedTurns.length,
    },
    observed: {
      discoveryAndListP95Ms: Number(percentile(discoveryAndListLatencies, 0.95).toFixed(2)),
      concurrentToolCallP95Ms: Number(
        percentile(
          concurrentCalls.map((result) => result.elapsedMs),
          0.95
        ).toFixed(2)
      ),
      subscriptionFanoutMs: Number(fanoutMs.toFixed(2)),
      taskPollingMs: Number(taskPollingMs.toFixed(2)),
      multiRoundMs: Number(multiRoundMs.toFixed(2)),
      rssGrowthBytes: Math.max(0, afterRss - beforeRss),
    },
    limits: {
      discoveryAndListP95Ms: 500,
      concurrentToolCallP95Ms: 1_000,
      subscriptionFanoutMs: 2_000,
      taskPollingMs: 3_000,
      multiRoundMs: 3_000,
      rssGrowthBytes: 64 * 1024 * 1024,
      subscriptionsPerPrincipal: 16,
      subscriptionQueueBytes: 256 * 1024,
    },
  };

  assert(report.observed.discoveryAndListP95Ms <= report.limits.discoveryAndListP95Ms);
  assert(report.observed.concurrentToolCallP95Ms <= report.limits.concurrentToolCallP95Ms);
  assert(report.observed.subscriptionFanoutMs <= report.limits.subscriptionFanoutMs);
  assert(report.observed.taskPollingMs <= report.limits.taskPollingMs);
  assert(report.observed.multiRoundMs <= report.limits.multiRoundMs);
  assert(report.observed.rssGrowthBytes <= report.limits.rssGrowthBytes);
  console.log(JSON.stringify(report, null, 2));
  console.log('  ✓ latency, memory, fan-out, task, and retry limits passed');
} finally {
  for (const stream of streams) stream.close();
  await stopInstance(instance.child);
  rmSync(root, { recursive: true, force: true });
}
