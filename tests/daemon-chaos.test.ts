/**
 * Daemon chaos suite
 *
 * Inflicts the failure modes the daemon has historically discovered one
 * production incident at a time (SIGKILL mid-life, vanished socket files,
 * stale pid files, spawn races, deleted spawn cwd) and asserts ONE
 * invariant for all of them: every recovery path converges to the same
 * state as a clean first boot —
 *
 *   - a subsequent command succeeds with the correct result
 *   - exactly one daemon process serves the HOME
 *   - the pid file matches the live daemon
 *
 * Each scenario runs a child process under an isolated HOME (its own
 * daemon, photon dir, and socket) so chaos never touches the developer's
 * real daemon. Template: daemon-subscribe-reconnect-leak.test.ts.
 */

import { strict as assert } from 'assert';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CHAOS_PHOTON = `
/** @version 1.0.0 */
export default class Chaos {
  /** Adds two numbers
   * @param a First
   * @param b Second
   */
  async add({ a, b }: { a: number; b: number }): Promise<number> {
    return a + b;
  }
}
`;

// @worker photons run in worker threads inside the daemon process — the
// path where a deleted daemon cwd historically broke respawns.
const WORKER_PHOTON = `
/**
 * @worker
 * @version 1.0.0
 */
export default class Chaosful {
  /** Returns a sentinel */
  async bump(): Promise<number> {
    return 42;
  }

  /** Kills this worker thread so the daemon must respawn it */
  async crash(): Promise<number> {
    setTimeout(() => process.exit(1), 50);
    return 1;
  }
}
`;

/**
 * Shared prelude for every child scenario script. Provides:
 *  call()        — sendCommand to the chaos photon (auto-starts daemon)
 *  daemonPid()   — pid from the pid file
 *  invariant(t)  — asserts the clean-boot convergence invariant
 */
const PRELUDE = `
import { sendCommand, pingDaemon } from '${ROOT}/dist/daemon/client.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const home = process.env.HOME;
const dataDir = path.join(home, '.photon', '.data');
const sockPath = path.join(dataDir, 'daemon.sock');
const pidPath = path.join(dataDir, 'daemon.pid');
const photonPath = path.join(home, 'chaos.photon.ts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call() {
  return sendCommand('chaos', 'add', { a: 2, b: 3 }, { photonPath, workingDir: home });
}

function daemonPid() {
  try { return Number(fs.readFileSync(pidPath, 'utf-8').trim()); } catch { return null; }
}

function daemonProcessCount() {
  try {
    const out = execSync('pgrep -f "daemon/server.js ' + sockPath + '"', { encoding: 'utf-8' });
    return out.trim().split('\\n').filter(Boolean).length;
  } catch { return 0; }
}

async function invariant(tag) {
  const result = await call();
  if (result !== 5) throw new Error(tag + ': command returned ' + JSON.stringify(result) + ', expected 5');
  const procs = daemonProcessCount();
  if (procs !== 1) throw new Error(tag + ': expected exactly 1 daemon process, found ' + procs);
  const pid = daemonPid();
  try { process.kill(pid, 0); } catch { throw new Error(tag + ': pid file (' + pid + ') does not match a live process'); }
  if (!(await pingDaemon('chaos'))) throw new Error(tag + ': daemon does not answer ping');
  console.error('[child] invariant holds: ' + tag);
}
`;

interface Scenario {
  name: string;
  body: string;
  /** Extra setup in the scenario HOME before the child starts. */
  setup?: (home: string) => void;
  /** Extra child env (values may reference paths under home). */
  env?: (home: string) => Record<string, string>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'SIGKILL mid-life: daemon murdered between requests',
    body: `
await invariant('baseline');
process.kill(daemonPid(), 'SIGKILL');
await sleep(300);
await invariant('after SIGKILL');
`,
  },
  {
    name: 'vanished socket: socket file deleted under a live daemon',
    body: `
await invariant('baseline');
fs.unlinkSync(sockPath);
await invariant('after socket unlink');
`,
  },
  {
    name: 'stale pid file: pid points at a dead process, socket is a stale file',
    body: `
await invariant('baseline');
const oldPid = daemonPid();
process.kill(oldPid, 'SIGKILL');
await sleep(300);
// Forge maximum staleness: pid file points at the dead pid, socket file
// still exists on disk but nothing listens.
fs.writeFileSync(pidPath, String(oldPid));
await invariant('after stale pid + dead socket');
`,
  },
  {
    name: 'spawn race: two clients start the daemon simultaneously',
    body: `
// No daemon yet — fire two concurrent commands that both try to spawn it.
const [r1, r2] = await Promise.all([call(), call()]);
if (r1 !== 5 || r2 !== 5) throw new Error('racing calls returned ' + r1 + ', ' + r2);
await invariant('after concurrent spawn race');
`,
  },
  {
    name: 'deleted spawn cwd: worker respawn survives daemon cwd deletion',
    // The daemon manager spawns the daemon with cwd = ctx.baseDir, which
    // follows PHOTON_DIR. Point it at a transient dir (via spawn env, the
    // env proxy makes runtime assignment a separate concern), let the
    // daemon boot there, then delete it. Worker (re)spawns happen inside
    // the daemon process — with a dead cwd they fail with uv_cwd ENOENT
    // and crashloop (the June 2026 incident) unless the daemon detaches
    // from its spawn cwd at boot.
    setup: (home) => fs.mkdirSync(path.join(home, 'transient-base'), { recursive: true }),
    env: (home) => ({ PHOTON_DIR: path.join(home, 'transient-base') }),
    body: `
const spawnDir = path.join(home, 'transient-base');
const workerPhoton = path.join(home, 'chaosful.photon.ts');
const callBump = () =>
  sendCommand('chaosful', 'bump', {}, { photonPath: workerPhoton, workingDir: home });

const r1 = await callBump();
if (r1 !== 42) throw new Error('baseline bump returned ' + JSON.stringify(r1));
console.error('[child] worker baseline ok');

// Pull the rug: the daemon's cwd no longer exists.
fs.rmSync(spawnDir, { recursive: true, force: true });

// Touch the source so the respawned worker must RECOMPILE — compilation
// spawns child processes that inherit the daemon's (now deleted) cwd,
// which is where uv_cwd ENOENT bit in the original incident. A cached
// compile would skip the cwd-sensitive path and prove nothing.
fs.appendFileSync(workerPhoton, '\\n// cache-bust\\n');

// Kill the worker thread from inside so the daemon must respawn it.
await Promise.race([
  sendCommand('chaosful', 'crash', {}, { photonPath: workerPhoton, workingDir: home }).catch(() => {}),
  sleep(10000),
]);
await sleep(3000); // respawn backoff

const r2 = await Promise.race([callBump(), sleep(30000).then(() => 'TIMEOUT')]);
if (r2 !== 42) throw new Error('post-respawn bump returned ' + JSON.stringify(r2) + ' — worker respawn failed with deleted daemon cwd');
console.error('[child] invariant holds: worker respawn after spawn-cwd deletion');
`,
  },
];

let passed = 0;
let failed = 0;

function runScenario(scenario: Scenario): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-chaos-'));
  fs.mkdirSync(path.join(home, '.photon', '.data'), { recursive: true });
  fs.writeFileSync(path.join(home, 'chaos.photon.ts'), CHAOS_PHOTON);
  fs.writeFileSync(path.join(home, 'chaosful.photon.ts'), WORKER_PHOTON);
  scenario.setup?.(home);
  const scriptPath = path.join(home, 'scenario.mjs');
  fs.writeFileSync(scriptPath, PRELUDE + scenario.body + '\nprocess.exit(0);\n');

  try {
    const proc = spawnSync('node', [scriptPath], {
      encoding: 'utf-8',
      timeout: 120000,
      env: { ...process.env, HOME: home, PHOTON_DIR: home, ...(scenario.env?.(home) ?? {}) },
    });

    if (proc.status === 0) {
      passed++;
      console.log(`  ✅ ${scenario.name}`);
    } else {
      failed++;
      console.error(`  ❌ ${scenario.name}`);
      console.error(
        `     ${(proc.stderr || proc.stdout || 'no output').trim().split('\n').slice(-30).join('\n     ')}`
      );
    }
  } finally {
    try {
      const pid = Number(
        fs.readFileSync(path.join(home, '.photon', '.data', 'daemon.pid'), 'utf-8').trim()
      );
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    try {
      execSync(`pkill -f "${home}"`, { stdio: 'ignore' });
    } catch {
      /* none left */
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

console.log('🌪  Daemon chaos suite\n');
for (const scenario of SCENARIOS) {
  runScenario(scenario);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
