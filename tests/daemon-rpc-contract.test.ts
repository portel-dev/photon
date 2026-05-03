/**
 * Daemon RPC contract: shape assertions for read endpoints.
 *
 * Why this file exists:
 *   The daemon exposes a wire protocol over a Unix socket (Windows: named
 *   pipe) that the CLI consumes positionally and by field name. When the
 *   daemon's response shape drifts — a field renamed, a key dropped, a
 *   nested array flattened — the CLI silently turns into an empty list
 *   or an error message. We've shipped two regressions like that
 *   recently: Bug 5 in v1.27.0 (`ps` returned a key the CLI's filter
 *   couldn't see) and the cf deploy 404 in v1.28.0 (different surface
 *   but same posture: no live contract test).
 *
 *   The companion file `tests/schedule-declared-active-dedup.test.ts`
 *   covers the BEHAVIOR contract for `ps` (Bug 5). This file covers the
 *   SHAPE contract for the read endpoints the CLI and Beam frontend
 *   depend on every render: `ping`, `status`, `ps`, `list_jobs`,
 *   `list_locks`, `query_lock`. If any field disappears or changes
 *   type, the CLI silently breaks; this test fails first.
 *
 *   These are read-only RPCs with no side effects, so we can run them
 *   against a freshly-spawned daemon with no fixtures. The point is the
 *   wire contract — not the data values.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ChildProcess } from 'node:child_process';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-rpc-contract-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(target: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      const connected = await new Promise<boolean>((resolve) => {
        const client = net.createConnection(target);
        client.on('connect', () => {
          client.destroy();
          resolve(true);
        });
        client.on('error', () => resolve(false));
      });
      if (connected) return;
    }
    await wait(50);
  }
  throw new Error('Timed out waiting for daemon socket');
}

function startDaemon(): { child: ChildProcess } {
  const isolatedRegistry = path.join(tmpDir, '.bases-test.json');
  const child = spawnDaemonPG([serverPath, socketPath], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PHOTON_DIR: tmpDir,
      PHOTON_BASES_REGISTRY: isolatedRegistry,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child };
}

interface RpcResponse {
  type: string;
  id: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

function sendRequest(
  sock: string,
  req: Record<string, unknown>,
  timeoutMs = 10_000
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buf = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`request timeout: ${JSON.stringify(req)}`));
    }, timeoutMs);
    client.on('connect', () =>
      client.write(JSON.stringify({ id: `contract-${Date.now()}`, ...req }) + '\n')
    );
    client.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        client.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as RpcResponse);
        } catch (err) {
          reject(err);
        }
      }
    });
    client.on('error', reject);
  });
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    if (err instanceof Error) {
      console.log(`    ${err.message}`);
    } else {
      console.log(`    ${String(err)}`);
    }
  }
}

/**
 * Assert that a value is a non-null plain object.
 */
function assertObject(val: unknown, label: string): asserts val is Record<string, unknown> {
  assert.ok(val && typeof val === 'object' && !Array.isArray(val), `${label} must be an object`);
}

/**
 * Assert that a field exists on a record and has the given primitive type.
 * Use this to pin down each field the CLI reads, so a rename or removal
 * fails the test before the CLI silently goes blank.
 */
function assertField(
  obj: Record<string, unknown>,
  key: string,
  type: 'string' | 'number' | 'boolean' | 'object' | 'array',
  label: string
): void {
  const val = obj[key];
  if (type === 'array') {
    assert.ok(Array.isArray(val), `${label}.${key} must be an array, got ${typeof val}`);
    return;
  }
  if (type === 'object') {
    assert.ok(
      val !== null && typeof val === 'object' && !Array.isArray(val),
      `${label}.${key} must be an object`
    );
    return;
  }
  assert.equal(
    typeof val,
    type,
    `${label}.${key} must be ${type}, got ${typeof val} (${JSON.stringify(val)})`
  );
}

async function main(): Promise<void> {
  console.log('\ndaemon RPC contract:\n');

  let daemon: ChildProcess | null = null;
  try {
    ({ child: daemon } = startDaemon());
    await waitForSocket(socketPath);
    // Boot scan + metadata discovery are async; brief settle to ensure
    // status/list_jobs reflect the steady-state shape.
    await wait(1_500);

    await test('ping returns { type: "pong" }', async () => {
      // ping is the daemon's liveness probe — its response shape is
      // intentionally different from every other RPC (no `success`,
      // no nested `data`). Health checks rely on `type === "pong"`.
      const res = await sendRequest(socketPath, { type: 'ping' });
      assert.equal(res.type, 'pong', 'ping must respond with type=pong');
    });

    await test('status returns documented health snapshot', async () => {
      const res = await sendRequest(socketPath, { type: 'status' });
      assert.equal(res.type, 'result');
      assert.equal(res.success, true);
      assertObject(res.data, 'status data');
      // Each field is consumed by `photon serve --status` or Beam's daemon
      // health card. Renaming any of these silently breaks the rendering.
      assertField(res.data, 'uptime', 'number', 'status');
      assertField(res.data, 'memoryMB', 'number', 'status');
      assertField(res.data, 'sessions', 'number', 'status');
      assertField(res.data, 'subscriptions', 'number', 'status');
      assertField(res.data, 'photonsLoaded', 'number', 'status');
    });

    await test('ps response carries the documented top-level arrays', async () => {
      const res = await sendRequest(socketPath, { type: 'ps' });
      assert.equal(res.type, 'result');
      assert.equal(res.success, true);
      assertObject(res.data, 'ps data');
      // CLI src/cli/commands/ps.ts iterates each of these by name. If any
      // is missing or renamed, the CLI shows an empty section without an
      // error. Bug 5 in v1.27.0 happened in `declared` specifically.
      assertField(res.data, 'active', 'array', 'ps');
      assertField(res.data, 'declared', 'array', 'ps');
      assertField(res.data, 'webhooks', 'array', 'ps');
      assertField(res.data, 'sessions', 'array', 'ps');
      assertField(res.data, 'suppressed', 'array', 'ps');
    });

    await test('list_jobs returns { jobs: [] } even when empty', async () => {
      const res = await sendRequest(socketPath, { type: 'list_jobs' });
      assert.equal(res.type, 'result');
      assert.equal(res.success, true);
      assertObject(res.data, 'list_jobs data');
      assertField(res.data, 'jobs', 'array', 'list_jobs');
    });

    await test('list_locks returns { locks: [] } even when empty', async () => {
      const res = await sendRequest(socketPath, { type: 'list_locks' });
      assert.equal(res.type, 'result');
      assert.equal(res.success, true);
      assertObject(res.data, 'list_locks data');
      assertField(res.data, 'locks', 'array', 'list_locks');
    });

    await test('query_lock returns { lockName, holder: null } for unknown lock', async () => {
      const res = await sendRequest(socketPath, {
        type: 'query_lock',
        lockName: 'rpc-contract-probe',
      });
      assert.equal(res.type, 'result');
      assert.equal(res.success, true);
      assertObject(res.data, 'query_lock data');
      assertField(res.data, 'lockName', 'string', 'query_lock');
      // holder must be `null` (not undefined) when no lock is held — the
      // CLI uses a strict null check to distinguish "free" from "missing".
      assert.equal(res.data.holder, null, 'query_lock.holder must be null for an unheld lock');
    });

    await test('lock + query_lock returns full holder snapshot', async () => {
      const lockName = 'rpc-contract-held';
      const acquired = (await sendRequest(socketPath, {
        type: 'lock',
        lockName,
        holder: 'contract-test',
        ttlMs: 10_000,
      })) as RpcResponse & { data?: { acquired?: boolean } };
      assert.equal(acquired.success, true, 'lock must acquire when free');
      assertObject(acquired.data, 'lock data');
      assert.equal(acquired.data.acquired, true);

      const queried = await sendRequest(socketPath, { type: 'query_lock', lockName });
      assertObject(queried.data, 'query_lock held data');
      // Each of these is consumed by the CLI's lock-status renderer.
      assertField(queried.data, 'lockName', 'string', 'query_lock(held)');
      assertField(queried.data, 'holder', 'string', 'query_lock(held)');
      assertField(queried.data, 'acquiredAt', 'number', 'query_lock(held)');
      assertField(queried.data, 'expiresAt', 'number', 'query_lock(held)');

      // Cleanup so list_locks empties out for any later test.
      await sendRequest(socketPath, { type: 'unlock', lockName, holder: 'contract-test' });
    });

    await test('unknown request type returns a structured error, not a hang', async () => {
      const res = await sendRequest(socketPath, { type: 'this-rpc-does-not-exist' });
      // We don't pin the exact wording — only that it's an error response
      // and not a successful no-op. A silent success would mean the daemon
      // accepted a request it doesn't actually handle.
      assert.notEqual(res.success, true, 'unknown request must not silently succeed');
    });
  } finally {
    if (daemon) await stopDaemonPG(daemon);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignored */
    }
  }

  console.log(`\n  passed: ${passed}, failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
