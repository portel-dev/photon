/**
 * Regression test: a base with `<base>/.photon-no-host` marker file is
 * "host-disabled". The daemon must NOT auto-register `@scheduled` jobs,
 * load ScheduleProvider files, or activate the proactive-metadata watcher
 * for that base.
 *
 * Manual `photon run` (i.e. an explicit `command` request that names the
 * photon by path) still works — host mode only suppresses background
 * activation. This test focuses on the suppression behavior at boot:
 * plant a `@scheduled` photon AND a persisted ScheduleProvider file,
 * plant the marker, start the daemon, and confirm neither path activates.
 *
 * Without the marker, the same fixtures must produce both an active
 * @scheduled job (via autoRegisterFromMetadata) and a loaded persisted
 * schedule (via loadAllPersistedSchedules). That's the positive control.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ChildProcess } from 'node:child_process';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-host-mode-test-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const photonName = 'host-probe';
const photonFile = path.join(tmpDir, `${photonName}.photon.ts`);
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

const probeSource = `
export default class HostProbe {
  /**
   * @scheduled 0 * * * *
   */
  async tick(): Promise<{ ok: true }> {
    return { ok: true };
  }
}
`;

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

function startDaemon(): { child: ChildProcess; logs: string[] } {
  const logs: string[] = [];
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
  child.stdout?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  child.stderr?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  return { child, logs };
}

async function stopDaemon(child: ChildProcess): Promise<void> {
  await stopDaemonPG(child);
}

function sendRequest(
  sock: string,
  req: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buf = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('request timeout'));
    }, timeoutMs);
    client.on('connect', () => client.write(JSON.stringify({ id: 'test-1', ...req }) + '\n'));
    client.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        client.destroy();
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    });
    client.on('error', reject);
  });
}

interface PsSnapshot {
  active: Array<{ photon: string; method: string; workingDir?: string; jobId?: string }>;
  declared?: Array<{ photon: string; method: string; workingDir?: string }>;
}

async function fetchPs(sock: string): Promise<PsSnapshot> {
  const res = (await sendRequest(sock, { type: 'ps' })) as { data: PsSnapshot };
  return res.data;
}

function plantScheduleProviderFile(): void {
  // Persisted schedule file as written by `this.schedule.create()`.
  const schedulesDir = path.join(tmpDir, '.data', photonName, 'schedules');
  fs.mkdirSync(schedulesDir, { recursive: true });
  const id = `${photonName}:sched:host-probe-uuid`;
  const job = {
    id,
    method: 'tick',
    args: {},
    cron: '*/5 * * * *',
    runCount: 0,
    createdAt: Date.now(),
    createdBy: 'test-fixture',
    photonName,
    workingDir: tmpDir,
  };
  fs.writeFileSync(path.join(schedulesDir, `${id}.json`), JSON.stringify(job));
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err?.message || String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log('\nhost-mode regression:\n');

  fs.writeFileSync(photonFile, probeSource);
  plantScheduleProviderFile();

  let daemonNoMarker: ChildProcess | null = null;
  let daemonWithMarker: ChildProcess | null = null;

  try {
    // ── Positive control: WITHOUT the marker, the schedule activates ───────
    // Note: boot-time dedup drops the ScheduleProvider sibling whenever a
    // matching @scheduled annotation exists for the same method (kith-sync
    // duplicate fix). So the positive control only asserts the resulting
    // active job exists — not which path produced it. The negative control
    // below requires zero active jobs, which would catch either path
    // regressing into a host-disabled base.
    await test('without marker, schedule for tick activates at boot', async () => {
      ({ child: daemonNoMarker } = startDaemon());
      await waitForSocket(socketPath);
      // Allow boot scan to complete.
      await wait(2_000);

      // Trigger session creation so autoRegisterFromMetadata runs.
      await sendRequest(
        socketPath,
        {
          type: 'command',
          photonName,
          photonPath: photonFile,
          workingDir: tmpDir,
          method: 'tick',
          args: {},
          sessionId: 'test',
          source: 'test',
        },
        30_000
      );
      await wait(1_000);

      const snap = await fetchPs(socketPath);
      const localActive = snap.active.filter((a) => a.workingDir === tmpDir);
      const matches = localActive.filter((a) => a.photon === photonName && a.method === 'tick');
      assert.ok(
        matches.length >= 1,
        `Expected at least one active job for ${photonName}:tick without marker. localActive=${JSON.stringify(localActive)}`
      );
    });

    // Stop daemon, plant marker, restart.
    await test('daemon stops cleanly before remarking host-disabled', async () => {
      if (daemonNoMarker) await stopDaemon(daemonNoMarker);
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* ignored */
      }
    });

    // ── Plant marker ───────────────────────────────────────────────────────
    fs.writeFileSync(path.join(tmpDir, '.photon-no-host'), '');

    // ── Host-disabled run: NEITHER path activates ──────────────────────────
    await test('with marker, @scheduled is NOT auto-registered and provider files do NOT load', async () => {
      ({ child: daemonWithMarker } = startDaemon());
      await waitForSocket(socketPath);
      await wait(2_000);

      // Even after touching the photon via a `command` request, host mode
      // must short-circuit autoRegisterFromMetadata.
      await sendRequest(
        socketPath,
        {
          type: 'command',
          photonName,
          photonPath: photonFile,
          workingDir: tmpDir,
          method: 'tick',
          args: {},
          sessionId: 'test',
          source: 'test',
        },
        30_000
      );
      await wait(1_000);

      const snap = await fetchPs(socketPath);
      const localActive = snap.active.filter((a) => a.workingDir === tmpDir);
      const matches = localActive.filter((a) => a.photon === photonName && a.method === 'tick');
      assert.equal(
        matches.length,
        0,
        `Expected NO active jobs for ${photonName}:tick under host-disabled base. Found: ${JSON.stringify(matches)}`
      );
    });

    // ── Manual command still returns successfully ──────────────────────────
    await test('manual command still works under host-disabled base', async () => {
      const res = (await sendRequest(
        socketPath,
        {
          type: 'command',
          photonName,
          photonPath: photonFile,
          workingDir: tmpDir,
          method: 'tick',
          args: {},
          sessionId: 'test-2',
          source: 'test',
        },
        30_000
      )) as { success?: boolean; data?: { ok?: boolean }; error?: string };
      assert.ok(
        res.success,
        `manual command should succeed under host mode, got: ${JSON.stringify(res)}`
      );
    });
  } finally {
    if (daemonNoMarker) await stopDaemon(daemonNoMarker);
    if (daemonWithMarker) await stopDaemon(daemonWithMarker);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
