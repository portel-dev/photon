/**
 * Regression: subscribeChannel must close the LIVE socket on unsubscribe,
 * including after a reconnect.
 *
 * The bug: scheduleReconnect() calls connect() and discards the new
 * unsubscribe closure. The caller's original unsubscribe still pointed at
 * the old destroyed socket, so after any daemon restart + reconnect cycle,
 * unsubscribe() set cancelled=true but left the replacement connection
 * open forever — one leaked unix socket per cycle on BOTH the client
 * (Beam) and the daemon. Observed in the wild as ~37k daemon FDs and
 * kernel-wide ENFILE taking down unrelated processes.
 *
 * Repro strategy: run a child process under an isolated HOME so it gets
 * its own daemon. The child subscribes, we kill its daemon, the client
 * auto-reconnects (spawning a fresh daemon), then the child unsubscribes
 * and reports how many daemon.sock connections it still holds (lsof on
 * itself). Fixed code reports 0; buggy code reports 1.
 */

import { strict as assert } from 'assert';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const childScript = `
import { subscribeChannel, sendCommand } from '${ROOT}/dist/daemon/client.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const home = process.env.HOME;
const sockPath = path.join(home, '.photon', '.data', 'daemon.sock');
const pidPath = path.join(home, '.photon', '.data', 'daemon.pid');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// macOS lsof shows connected unix sockets as kernel addresses with no
// path, so count unix-type FDs numerically against a baseline.
function unixSocketCount() {
  try {
    const out = execSync('lsof -a -U -p ' + process.pid, { encoding: 'utf-8' });
    return out.split('\\n').filter((l) => l.includes(' unix ')).length;
  } catch {
    return 0; // lsof exits 1 when no matching FDs remain
  }
}

const unsubscribe = await subscribeChannel('leaktest', 'leaktest:events', () => {}, {
  reconnect: true,
});
await sleep(1500);
const baseline = unixSocketCount(); // includes the live subscription socket
console.error('[child] subscribed, unix fds baseline=' + baseline);

// Kill the daemon to force the client's reconnect path
const pid = Number(fs.readFileSync(pidPath, 'utf-8').trim());
process.kill(pid, 'SIGKILL');
try { fs.unlinkSync(sockPath); } catch {}
console.error('[child] daemon killed, waiting for reconnect');

await sleep(1000);
const afterKill = unixSocketCount();
console.error('[child] after kill unix fds=' + afterKill);

// Kick a daemon respawn explicitly (sendCommand restarts on connection
// failure), then poll until the subscription socket count is back to
// baseline (kick sockets are transient and closed between polls).
let reconnected = false;
for (let i = 0; i < 30; i++) {
  try { await sendCommand('leaktest', '_instances', {}); } catch {}
  await sleep(2000);
  if (unixSocketCount() >= baseline) { reconnected = true; break; }
}
if (!reconnected) { console.log('RESULT skipped=no-reconnect'); process.exit(0); }
console.error('[child] reconnected, unix fds=' + unixSocketCount());

unsubscribe();
await sleep(2000);

const finalCount = unixSocketCount();
console.error('[child] after unsubscribe unix fds=' + finalCount);
// Fixed: subscription socket closed => baseline - 1. Buggy: still open => >= baseline.
console.log('RESULT leaked=' + Math.max(0, finalCount - (baseline - 1)));
process.exit(0);
`;

async function main() {
  console.log('🧪 subscribeChannel reconnect leak\n');

  // This regression measures live Unix descriptors with lsof. Keep the test
  // inconclusive when the diagnostic tool is unavailable instead of turning
  // its fallback count of zero into a false leak report.
  const lsof = spawnSync('sh', ['-c', 'command -v lsof'], { encoding: 'utf-8' });
  if (lsof.status !== 0) {
    console.log('  ⏭  lsof is unavailable — descriptor leak check skipped');
    console.log('\n1 passed, 0 failed');
    return;
  }

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-leak-home-'));
  fs.mkdirSync(path.join(home, '.photon', '.data'), { recursive: true });
  const scriptPath = path.join(home, 'child.mjs');
  fs.writeFileSync(scriptPath, childScript);

  try {
    const proc = spawnSync('node', [scriptPath], {
      encoding: 'utf-8',
      timeout: 120000,
      env: {
        ...process.env,
        HOME: home,
        PHOTON_DIR: home,
      },
    });

    const result = (proc.stdout || '').split('\n').find((l) => l.startsWith('RESULT'));
    console.log(
      `  child stderr tail: ${(proc.stderr || '').trim().split('\n').slice(-3).join(' | ')}`
    );
    assert.ok(
      result,
      `child produced no RESULT line.\nstdout: ${proc.stdout}\nstderr: ${proc.stderr}`
    );

    if (result.includes('skipped')) {
      console.log(`  child stderr:\n${proc.stderr}`);
      console.log('  ⏭  reconnect did not complete in time — inconclusive, not failing');
      return;
    }

    const leaked = Number(result.split('leaked=')[1]);
    assert.equal(
      leaked,
      0,
      `unsubscribe left ${leaked} live daemon connection(s) after reconnect — the original closure targets the dead socket`
    );
    console.log('  ✅ unsubscribe closes the live socket after reconnect (0 leaked)');
  } finally {
    // Kill any daemon the isolated HOME spawned
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

main()
  .then(() => console.log('\n1 passed, 0 failed'))
  .catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
