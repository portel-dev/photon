/**
 * Regression test for Bug 5 in v1.27.0:
 *   `photon ps` listed the same job twice when a photon used both
 *   `@scheduled` and a legacy `enable_schedule` that called
 *   `this.schedule.create()` for the same method+cron.
 *
 * The two registrations land under different daemon keys:
 *
 *   - ScheduleProvider job key:  `<photon>:sched:<uuid>`
 *   - @scheduled declaration key: `<base>::<photon>:<method>`
 *
 * Before the fix, the `ps` handler computed each declaration's
 * `active` flag with `scheduledJobs.has(declaredKey(...))` — an
 * exact-key lookup that misses the equivalent ScheduleProvider
 * timer. The CLI then filtered with `!d.active` and the same job
 * appeared in BOTH the ACTIVE table (from the legacy timer) AND
 * the DECLARED-not-enrolled table (from the @scheduled tag).
 *
 * The fix matches `(photon, method, cron, base)` across all
 * scheduledJobs so the cosmetic duplicate collapses. The test
 * asserts the declaration is reported as `active: true` even
 * though the registry keys differ.
 *
 * Why daemon-level: the bug is in the daemon's `ps` response
 * shape, not in the CLI renderer. Catching it requires the live
 * RPC contract.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ChildProcess } from 'node:child_process';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-dedup-test-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const photonName = 'dedup-probe';
const photonFile = path.join(tmpDir, `${photonName}.photon.ts`);
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');
const SHARED_CRON = '0 7 * * *';

// Photon with `@scheduled` on tick + a no-op enable_schedule. The actual
// enrollment of the legacy timer is simulated by planting a
// ScheduleProvider file directly so the test stays deterministic.
const probeSource = `
export default class DedupProbe {
  /**
   * @scheduled ${SHARED_CRON}
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
  active: Array<{
    id: string;
    photon: string;
    method: string;
    cron: string;
    workingDir?: string;
  }>;
  declared: Array<{
    photon: string;
    method: string;
    cron: string;
    workingDir?: string;
    active: boolean;
  }>;
}

async function fetchPs(sock: string): Promise<PsSnapshot> {
  const res = (await sendRequest(sock, { type: 'ps' })) as { data: PsSnapshot };
  return res.data;
}

/**
 * Plant a ScheduleProvider JSON file with the same cron the @scheduled
 * tag declares. This is exactly the on-disk shape `this.schedule.create()`
 * writes, so loadAllPersistedSchedules registers a job under the legacy
 * `<photon>:sched:<uuid>` key during boot.
 */
function plantLegacyScheduleProviderFile(): string {
  const schedulesDir = path.join(tmpDir, '.data', photonName, 'schedules');
  fs.mkdirSync(schedulesDir, { recursive: true });
  const uuid = 'fixture-uuid-0000';
  const task = {
    id: uuid,
    name: 'tick',
    cron: SHARED_CRON,
    method: 'tick',
    params: {},
    fireOnce: false,
    maxExecutions: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    executionCount: 0,
    photonId: photonName,
  };
  fs.writeFileSync(path.join(schedulesDir, `${uuid}.json`), JSON.stringify(task, null, 2));
  return `${photonName}:sched:${uuid}`;
}

/**
 * Plant `.active-schedules.json` in the post-migration state with NO
 * active entries. This is the configuration that produces Bug 5:
 *
 *   - The legacy ScheduleProvider job stays registered (loaded from disk).
 *   - The @scheduled declaration is discovered but never enrolled, because
 *     `migratedFromAutoRegister: true` skips the boot auto-migration that
 *     would have added it to the active list.
 *
 * Reproduces the field state where a user enrolled the legacy enable_schedule
 * before the @scheduled tag was added to source. Without this file, boot
 * sync auto-enrolls the @scheduled and the on-line dedup at server.ts:2010
 * drops the ScheduleProvider sibling — masking the bug we're trying to test.
 */
function plantPostMigrationActiveSchedules(): void {
  const file = path.join(tmpDir, '.data', '.active-schedules.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        active: [],
        suppressed: [],
        migratedFromAutoRegister: true,
      },
      null,
      2
    )
  );
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

async function main(): Promise<void> {
  console.log('\nschedule declared-vs-active dedup regression (Bug 5):\n');

  fs.writeFileSync(photonFile, probeSource);
  const expectedLegacyId = plantLegacyScheduleProviderFile();
  plantPostMigrationActiveSchedules();

  let daemon: ChildProcess | null = null;
  try {
    ({ child: daemon } = startDaemon());
    await waitForSocket(socketPath);
    // Boot scan + proactive metadata discovery are async; give them time
    // to populate scheduledJobs and declaredSchedules.
    await wait(2_500);

    await test('legacy ScheduleProvider job and matching @scheduled declaration both load', async () => {
      const snap = await fetchPs(socketPath);
      const localActive = snap.active.filter(
        (a) =>
          (a.workingDir === tmpDir || path.resolve(a.workingDir ?? '') === tmpDir) &&
          a.photon === photonName &&
          a.method === 'tick'
      );
      assert.equal(
        localActive.length,
        1,
        `legacy ScheduleProvider must register exactly one active job, got ${localActive.length}`
      );
      assert.equal(
        localActive[0].id,
        expectedLegacyId,
        'active job id must match the planted ScheduleProvider key'
      );
      assert.equal(localActive[0].cron, SHARED_CRON);

      const localDeclared = snap.declared.filter(
        (d) =>
          (d.workingDir === tmpDir || path.resolve(d.workingDir ?? '') === tmpDir) &&
          d.photon === photonName &&
          d.method === 'tick'
      );
      assert.equal(
        localDeclared.length,
        1,
        `boot discovery must populate the @scheduled declaration, got ${localDeclared.length}`
      );
    });

    await test('declared.active is true when an equivalent ScheduleProvider job exists', async () => {
      const snap = await fetchPs(socketPath);
      const decl = snap.declared.find(
        (d) =>
          (d.workingDir === tmpDir || path.resolve(d.workingDir ?? '') === tmpDir) &&
          d.photon === photonName &&
          d.method === 'tick'
      );
      assert.ok(decl, '@scheduled declaration must be present in ps output');
      assert.equal(
        decl.active,
        true,
        `declared.active must collapse the cosmetic duplicate when (photon,method,cron,base) match an active job. got active=${decl.active}`
      );
    });

    await test('CLI dormant filter (!d.active) hides the duplicate from the DECLARED table', async () => {
      // Mirrors the filter src/cli/commands/ps.ts uses to render the
      // "DECLARED (not enrolled)" section. If the daemon-side dedup
      // regresses, this assertion fails the way the user originally
      // reported the bug.
      const snap = await fetchPs(socketPath);
      const dormant = snap.declared.filter((d) => !d.active);
      const matches = dormant.filter(
        (d) =>
          (d.workingDir === tmpDir || path.resolve(d.workingDir ?? '') === tmpDir) &&
          d.photon === photonName &&
          d.method === 'tick'
      );
      assert.equal(
        matches.length,
        0,
        `dormant filter must hide the duplicate. Found in DECLARED: ${JSON.stringify(matches)}`
      );
    });
  } finally {
    if (daemon) await stopDaemon(daemon);
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
