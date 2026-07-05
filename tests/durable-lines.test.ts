/**
 * Durable line daemon regressions.
 *
 * These tests exercise the daemon socket protocol instead of private helpers so
 * CLI, Beam, and MCP-client preview behavior all stay pinned to the same
 * contract.
 */

import assert from 'node:assert/strict';
import { type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

interface RpcResponse {
  type: string;
  id: string;
  success?: boolean;
  data?: any;
  error?: string;
}

interface LineRow {
  photon: string;
  method: string;
  lineId: string;
  workingDir: string;
  declared: boolean;
  enrolled: boolean;
  state: string;
  sessionId: string;
  instanceName: string;
  restart: string;
  healthIntervalMs: number;
}

const root = process.cwd();
const serverPath = path.join(root, 'dist', 'daemon', 'server.js');

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
  throw new Error(`Timed out waiting for daemon socket ${target}`);
}

function sendRequest(
  sock: string,
  req: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buf = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`request timeout: ${JSON.stringify(req)}`));
    }, timeoutMs);
    client.on('connect', () =>
      client.write(JSON.stringify({ id: `line-${Date.now()}-${Math.random()}`, ...req }) + '\n')
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

function startDaemon(tmpDir: string, socketPath: string): ChildProcess {
  const child = spawnDaemonPG([serverPath, socketPath], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PHOTON_DIR: tmpDir,
      PHOTON_BASES_REGISTRY: path.join(tmpDir, '.bases-test.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function fetchLines(sock: string): Promise<LineRow[]> {
  const res = await sendRequest(sock, { type: 'ps' });
  assert.equal(res.type, 'result');
  assert.equal(res.success, true);
  assert.ok(Array.isArray(res.data?.lines), `ps lines missing: ${JSON.stringify(res)}`);
  return res.data.lines as LineRow[];
}

async function waitFor<T>(
  label: string,
  fn: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 8_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    await wait(100);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(lastValue)}`);
}

function lineSource(healthIntervalMs: number): string {
  return `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default class LineProbe {
  /**
   * @line probe:line
   * @restart always
   * @healthIntervalMs ${healthIntervalMs}
   */
  async *daemon() {
    const file = join(process.env.PHOTON_DIR!, 'line-count.txt');
    const count = existsSync(file) ? Number(readFileSync(file, 'utf-8') || '0') : 0;
    writeFileSync(file, String(count + 1));
    yield { emit: 'status', message: 'line tick' };
    return { ok: true };
  }
}
`;
}

function workerLineSource(): string {
  return `
/**
 * @worker
 */
export default class WorkerLineProbe {
  /**
   * @line worker:line
   */
  async *daemon() {
    yield { emit: 'status', message: 'worker line' };
  }
}
`;
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
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log('\ndurable lines daemon regressions:\n');

  await test('@restart always restarts clean generator completion and preserves healthIntervalMs 0', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-lines-restart-'));
    const socketPath = path.join(tmpDir, 'daemon.sock');
    const photonFile = path.join(tmpDir, 'line-probe.photon.ts');
    fs.writeFileSync(photonFile, lineSource(0));
    fs.mkdirSync(path.join(tmpDir, '.marketplace'), { recursive: true });

    const daemon = startDaemon(tmpDir, socketPath);
    try {
      await waitForSocket(socketPath);
      await sendRequest(socketPath, {
        type: 'reload',
        photonName: 'line-probe',
        photonPath: photonFile,
        workingDir: tmpDir,
      });

      const enable = await sendRequest(socketPath, {
        type: 'enable_line',
        photonName: 'line-probe',
        method: 'daemon',
        workingDir: tmpDir,
      });
      assert.equal(enable.type, 'result', enable.error);
      assert.equal(enable.success, true, enable.error);

      const countFile = path.join(tmpDir, 'line-count.txt');
      await waitFor(
        'clean-completion restart count',
        () => (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf-8') || '0') : 0),
        (count) => count >= 2
      );

      const lines = await fetchLines(socketPath);
      const row = lines.find((line) => line.photon === 'line-probe' && line.method === 'daemon');
      assert.ok(row, `missing line row: ${JSON.stringify(lines)}`);
      assert.equal(row.declared, true);
      assert.equal(row.enrolled, true);
      assert.equal(row.sessionId, 'line:probe:line');
      assert.equal(row.instanceName, 'line:probe:line');
      assert.equal(row.restart, 'always');
      assert.equal(row.healthIntervalMs, 0);

      await sendRequest(socketPath, {
        type: 'disable_line',
        photonName: 'line-probe',
        method: 'daemon',
        workingDir: tmpDir,
      });
    } finally {
      await stopDaemonPG(daemon);
    }
  });

  await test('manual reload refreshes declared line metadata without daemon restart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-lines-reload-'));
    const socketPath = path.join(tmpDir, 'daemon.sock');
    const photonFile = path.join(tmpDir, 'line-probe.photon.ts');
    fs.writeFileSync(photonFile, lineSource(0));
    fs.mkdirSync(path.join(tmpDir, '.marketplace'), { recursive: true });

    const daemon = startDaemon(tmpDir, socketPath);
    try {
      await waitForSocket(socketPath);
      const firstReload = await sendRequest(socketPath, {
        type: 'reload',
        photonName: 'line-probe',
        photonPath: photonFile,
        workingDir: tmpDir,
      });
      assert.equal(firstReload.success, true, firstReload.error);

      let lines = await fetchLines(socketPath);
      let row = lines.find((line) => line.photon === 'line-probe' && line.method === 'daemon');
      assert.equal(row?.healthIntervalMs, 0, `first row=${JSON.stringify(row)}`);

      fs.writeFileSync(photonFile, lineSource(1234));
      const secondReload = await sendRequest(socketPath, {
        type: 'reload',
        photonName: 'line-probe',
        photonPath: photonFile,
        workingDir: tmpDir,
      });
      assert.equal(secondReload.success, true, secondReload.error);

      lines = await waitFor(
        'line metadata reload',
        () => fetchLines(socketPath),
        (current) =>
          current.some(
            (line) =>
              line.photon === 'line-probe' &&
              line.method === 'daemon' &&
              line.healthIntervalMs === 1234
          )
      );
      row = lines.find((line) => line.photon === 'line-probe' && line.method === 'daemon');
      assert.equal(row?.restart, 'always');
      assert.equal(row?.healthIntervalMs, 1234);
    } finally {
      await stopDaemonPG(daemon);
    }
  });

  await test('@line on @worker photons is rejected before enrollment', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-lines-worker-'));
    const socketPath = path.join(tmpDir, 'daemon.sock');
    const photonFile = path.join(tmpDir, 'worker-line.photon.ts');
    fs.writeFileSync(photonFile, workerLineSource());
    fs.mkdirSync(path.join(tmpDir, '.marketplace'), { recursive: true });

    const daemon = startDaemon(tmpDir, socketPath);
    try {
      await waitForSocket(socketPath);
      const reload = await sendRequest(socketPath, {
        type: 'reload',
        photonName: 'worker-line',
        photonPath: photonFile,
        workingDir: tmpDir,
      });
      assert.equal(reload.success, true, reload.error);

      const enable = await sendRequest(socketPath, {
        type: 'enable_line',
        photonName: 'worker-line',
        method: 'daemon',
        workingDir: tmpDir,
      });
      assert.equal(enable.type, 'error');
      assert.match(enable.error || '', /@line is not supported on @worker photons/);

      const lines = await fetchLines(socketPath);
      const row = lines.find((line) => line.photon === 'worker-line' && line.method === 'daemon');
      assert.ok(row, `missing worker line declaration: ${JSON.stringify(lines)}`);
      assert.equal(row.declared, true);
      assert.equal(row.enrolled, false);
      assert.equal(row.state, 'declared');
    } finally {
      await stopDaemonPG(daemon);
    }
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
