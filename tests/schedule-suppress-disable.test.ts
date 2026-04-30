/**
 * Regression test: disable_schedule must survive daemon restarts for @scheduled methods.
 *
 * Before this fix, `photon ps disable foo:bar` removed the active-schedules.json entry
 * and stopped the timer, but the next daemon restart re-registered the method via
 * @scheduled auto-registration — because `autoRegisterFromMetadata` only checked
 * the in-memory `scheduledJobs` map, never the suppression list on disk.
 *
 * The fix adds a `suppressed` array to `.active-schedules.json`. When `disable_schedule`
 * is called for a method that has a @scheduled declaration, the entry is added to
 * `suppressed`. On the next boot, `autoRegisterFromMetadata` reads this list and skips
 * any method marked suppressed.
 *
 * Re-enabling via `enable_schedule` removes the entry from `suppressed` so the method
 * auto-registers again on subsequent restarts.
 *
 * This test validates the behavior at the daemon level: it starts a fresh daemon,
 * verifies the @scheduled method IS auto-registered, then disables it (which writes
 * to suppressed), restarts the daemon, and confirms the method is NOT in the active
 * schedule list after restart.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-suppress-test-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const photonName = 'suppress-probe';
const photonFile = path.join(tmpDir, `${photonName}.photon.ts`);
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

// Simple photon with @scheduled annotation on the `tick` method.
// NOTE: @scheduled must be in the METHOD's JSDoc, not the class docblock.
const probeSource = `
export default class SuppressProbe {
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

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

async function waitForExit(child: ChildProcess, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(child.pid)) return;
    await wait(50);
  }
  throw new Error(`Daemon pid ${child.pid} did not exit in time`);
}

function startDaemon(): { child: ChildProcess; logs: string[] } {
  const logs: string[] = [];
  const child = spawn(process.execPath, [serverPath, socketPath], {
    cwd: tmpDir,
    env: { ...process.env, PHOTON_DIR: tmpDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  child.stderr?.on('data', (d) => logs.push(...d.toString().split('\n').filter(Boolean)));
  return { child, logs };
}

async function stopDaemon(child: ChildProcess): Promise<void> {
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  try {
    await waitForExit(child, 5_000);
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
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

async function fetchPs(sock: string): Promise<{
  active: Array<{ photon: string; method: string; workingDir?: string }>;
  suppressed?: Array<{ photon: string; method: string; workingDir: string }>;
}> {
  const res = (await sendRequest(sock, { type: 'ps' })) as {
    data: {
      active: Array<{ photon: string; method: string; workingDir?: string }>;
      suppressed?: Array<{ photon: string; method: string; workingDir: string }>;
    };
  };
  return res.data;
}

async function warmPhoton(sock: string): Promise<void> {
  // A `command` request triggers getOrCreateSessionManager → autoRegisterFromMetadata.
  // `list_tools` doesn't create a session manager and won't trigger auto-registration.
  await sendRequest(
    sock,
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
  // autoRegisterFromMetadata is called as void (fire-and-forget), give it time to complete.
  await wait(800);
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
  console.log('\nschedule suppress-disable regression:\n');

  fs.writeFileSync(photonFile, probeSource);
  fs.mkdirSync(path.join(tmpDir, '.marketplace'), { recursive: true });

  let daemon1: ChildProcess | null = null;
  let daemon2: ChildProcess | null = null;

  try {
    // ── Daemon 1: boot and verify @scheduled auto-registers ─────────────────
    await test('@scheduled method is discovered in declared schedules on first boot', async () => {
      ({ child: daemon1 } = startDaemon());
      await waitForSocket(socketPath);
      // Allow boot scan to complete before checking declared schedules.
      await wait(1_500);

      const snap = await fetchPs(socketPath);
      // The test daemon loads global bases too — filter to our tmpDir only.
      const localDeclared =
        (snap as any).declared?.filter((d: any) => d.workingDir === tmpDir) ?? [];
      const isDeclared = localDeclared.some(
        (d: any) => d.photon === photonName && d.method === 'tick'
      );
      assert.ok(
        isDeclared,
        `Expected tick to be in declared schedules for ${tmpDir}. localDeclared=${JSON.stringify(localDeclared)}`
      );
    });

    // ── disable_schedule writes suppressed entry ──────────────────────────────
    await test('disable_schedule adds suppressed entry to .active-schedules.json', async () => {
      const res = (await sendRequest(socketPath, {
        type: 'disable_schedule',
        photonName,
        method: 'tick',
      })) as { success?: boolean };
      assert.ok(res.success, `disable_schedule failed: ${JSON.stringify(res)}`);

      const schedFile = path.join(tmpDir, '.data', '.active-schedules.json');
      assert.ok(fs.existsSync(schedFile), '.active-schedules.json must exist after disable');
      const contents = JSON.parse(fs.readFileSync(schedFile, 'utf-8'));
      const suppressed: Array<{ photon: string; method: string }> = contents.suppressed ?? [];
      assert.ok(
        suppressed.some((s) => s.photon === photonName && s.method === 'tick'),
        `Expected tick in suppressed. suppressed=${JSON.stringify(suppressed)}`
      );
      const active: Array<{ photon: string; method: string }> = contents.active ?? [];
      assert.ok(
        !active.some((e) => e.photon === photonName && e.method === 'tick'),
        `Expected tick NOT in active after disable. active=${JSON.stringify(active)}`
      );
    });

    // ── Stop daemon 1 ────────────────────────────────────────────────────────
    await test('daemon 1 shuts down cleanly', async () => {
      if (daemon1) await stopDaemon(daemon1);
      // Remove socket so daemon 2 can bind a fresh one.
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* already gone */
      }
    });

    // ── Daemon 2: restart and confirm suppressed method is NOT auto-registered
    await test('@scheduled method is NOT auto-registered after restart when suppressed', async () => {
      ({ child: daemon2 } = startDaemon());
      await waitForSocket(socketPath);
      await warmPhoton(socketPath);

      const snap = await fetchPs(socketPath);
      const localActive = snap.active.filter((a) => a.workingDir === tmpDir);
      const isActive = localActive.some((a) => a.photon === photonName && a.method === 'tick');
      assert.ok(
        !isActive,
        `Expected tick NOT in active schedules for ${tmpDir} after restart. localActive=${JSON.stringify(localActive)}`
      );
      // Suppressed list should still be present.
      const isSuppressed = (snap.suppressed ?? []).some(
        (s) => s.photon === photonName && s.method === 'tick' && s.workingDir === tmpDir
      );
      assert.ok(isSuppressed, `Expected tick in suppressed list in ps snapshot`);
    });

    // ── enable_schedule clears suppression ───────────────────────────────────
    await test('enable_schedule removes suppressed entry', async () => {
      await sendRequest(socketPath, {
        type: 'enable_schedule',
        photonName,
        method: 'tick',
      });
      const schedFile = path.join(tmpDir, '.data', '.active-schedules.json');
      const contents = JSON.parse(fs.readFileSync(schedFile, 'utf-8'));
      const suppressed: Array<{ photon: string; method: string }> = contents.suppressed ?? [];
      assert.ok(
        !suppressed.some((s) => s.photon === photonName && s.method === 'tick'),
        `Expected tick NOT in suppressed after enable. suppressed=${JSON.stringify(suppressed)}`
      );
    });
  } finally {
    if (daemon1) await stopDaemon(daemon1);
    if (daemon2) await stopDaemon(daemon2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
