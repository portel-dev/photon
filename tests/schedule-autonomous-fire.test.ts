/**
 * End-to-end regression test for autonomous cron execution.
 *
 * This is the test the prior bug snuck past. The earlier round fixed
 * the boot-loader step (ScheduleProvider files got registered with
 * the cron engine) but left the fire handler gated on `job.photonPath`
 * being pre-populated. Result: registrations appeared at boot, the
 * cron timer fired, but every fire bailed with "photon not
 * initialized" and immediately rescheduled — infinite loop of
 * failed fires, zero actual executions. The earlier unit tests only
 * asserted that `register()` was called; they never checked that the
 * callback actually ran when the timer went off.
 *
 * This test closes that gap by exercising the full loop with a real
 * daemon subprocess:
 *
 *   1. Write a ScheduleProvider-format schedule file to disk —
 *      exactly what `this.schedule.create()` would write.
 *   2. Start the daemon fresh.
 *   3. Do NOT invoke the owning photon manually. (This is the
 *      critical gap the fix closes — the photon must fire on cron
 *      alone, without a human warming it first.)
 *   4. Wait up to ~75 seconds for the next minute boundary.
 *   5. Assert the photon method actually executed (it appends a line
 *      to a log file).
 *
 * If the fire-handler ever regresses back to requiring a warm photon,
 * the log file stays empty and this test times out.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-sched-e2e-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const photonName = 'autonomous-probe';
const photonFile = path.join(tmpDir, `${photonName}.photon.ts`);
const tickLog = path.join(tmpDir, 'tick.log');
const schedulesDir = path.join(tmpDir, '.data', photonName, 'schedules');
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

// The probe deliberately extends `Photon` so `this.schedule` is
// available — plain classes don't get `this.schedule` today, but this
// test is specifically about the cron-fire pipeline, not capability
// injection. `tick` writes to a file so the assertion is about
// observable behavior rather than internal state.
const probeSource = `
import { Photon } from '@portel/photon-core';
import * as fs from 'fs';

export default class AutonomousProbe extends Photon {
  async tick() {
    const line = new Date().toISOString() + '\\n';
    fs.appendFileSync(${JSON.stringify(tickLog)}, line);
    return line.trim();
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

async function waitForSocketReady(target: string, timeoutMs = 10_000): Promise<void> {
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

async function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
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

async function stopDaemon(child: ChildProcess | null): Promise<void> {
  if (!child) return;
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

/**
 * Write a ScheduleProvider-format task file exactly as
 * `this.schedule.create()` does in photon-core. This is the shape the
 * daemon boot loader must handle for autonomous execution to work.
 */
function writeProbeSchedule(cron: string): string {
  fs.mkdirSync(schedulesDir, { recursive: true });
  const id = randomUUID();
  const task = {
    id,
    name: 'tick-every-minute',
    cron,
    method: 'tick',
    params: {},
    fireOnce: false,
    maxExecutions: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    executionCount: 0,
    photonId: photonName,
  };
  fs.writeFileSync(path.join(schedulesDir, `${id}.json`), JSON.stringify(task, null, 2));
  return id;
}

/**
 * Poll the tick log until at least one execution landed. 75 s is the
 * worst-case for a `* * * * *` cron — if boot coincides with :00.1,
 * the next fire is ~60 s out plus a little overhead. If nothing lands
 * in that window the fire handler is broken and the test fails.
 */
async function waitForTick(timeoutMs = 75_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(tickLog)) {
      const content = fs.readFileSync(tickLog, 'utf-8').trim();
      if (content.length > 0) return content;
    }
    await wait(500);
  }
  throw new Error(
    `Scheduled tick never fired within ${timeoutMs}ms — the daemon loaded the ` +
      `schedule but the fire handler did not execute the method. This is the ` +
      `regression the fix closes: without lazy-load at fire time, every tick ` +
      `bails with "photon not initialized" and the log stays empty forever.`
  );
}

async function main(): Promise<void> {
  console.log('autonomous cron fire end-to-end test:');

  fs.writeFileSync(photonFile, probeSource);
  const taskId = writeProbeSchedule('* * * * *');

  let daemon: ChildProcess | null = null;
  try {
    // Boot a completely fresh daemon — this simulates the scenario
    // the user reported: daemon restarts and the photon has never
    // been invoked since. The cron engine should pick up the
    // schedule from disk and fire it without any warm-up touch.
    const run = startDaemon();
    daemon = run.child;
    await waitForSocketReady(socketPath);

    const tickContent = await waitForTick();
    const firstLine = tickContent.split('\n')[0];
    const parsed = Date.parse(firstLine);
    assert.ok(
      !Number.isNaN(parsed),
      `tick log must contain a parseable ISO timestamp, got: ${JSON.stringify(firstLine)}`
    );

    console.log(`  \u2713 cron fired autonomously — first tick at ${firstLine}`);

    // Sanity-check: the daemon should NOT have logged "Cannot run
    // job" for our probe. If that message shows up, the fire gate
    // reopened even though the log eventually caught a tick (maybe
    // from a later retry that happened to succeed).
    const badLines = run.logs.filter((l) => l.includes('Cannot run job') && l.includes(photonName));
    assert.equal(
      badLines.length,
      0,
      `daemon logged "Cannot run job" for ${photonName} — the warm-photon ` +
        `gate reopened. Matching log lines:\n${badLines.join('\n')}`
    );

    console.log(`  \u2713 daemon never logged "Cannot run job" for the probe`);

    // Verify the per-execution record also got written — the side
    // effect the user cares about ("executions.jsonl stays empty"
    // was the original symptom). Phantom registrations would have
    // produced rescheduled timer entries but no execution records;
    // a real fire produces both.
    const execLog = path.join(tmpDir, '.data', photonName, 'schedules', 'executions.jsonl');
    const haveExecRecord = fs.existsSync(execLog) && fs.readFileSync(execLog, 'utf-8').length > 0;
    assert.ok(
      haveExecRecord,
      `${execLog} must contain at least one execution record after a fire. ` +
        `An empty executions.jsonl paired with "tick.log has entries" would mean ` +
        `the method ran but the daemon lost its accounting — also a regression.`
    );
    console.log(`  \u2713 execution record landed in schedules/executions.jsonl`);

    void taskId; // silence unused
  } finally {
    await stopDaemon(daemon);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\nAutonomous cron fire test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
