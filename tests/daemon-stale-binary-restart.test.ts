import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'dist', 'cli.js');
const daemonScript = path.join(repoRoot, 'dist', 'daemon', 'server.js');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-stale-daemon-home-'));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-stale-daemon-src-'));
const photonPath = path.join(tmpDir, 'counter.photon.ts');
const originalStat = fs.statSync(daemonScript);

fs.writeFileSync(
  photonPath,
  `/**
 * Counter
 * @stateful
 */
export default class Counter {
  private count = 0;
  async inc() {
    this.count += 1;
    return { count: this.count };
  }
}
`
);

function runPhoton(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, 'cli', photonPath, 'inc'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PHOTON_HOME: tmpHome,
        PHOTON_DAEMON_READY_TIMEOUT_MS: '15000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  try {
    const first = await runPhoton();
    assert.equal(first.code, 0, `initial daemon command failed:\n${first.stderr}`);

    // Force DaemonManager.isBinaryStale() to restart the daemon on the next
    // command, then issue several commands concurrently. This covers the
    // restart window where one caller removes the old socket while peers are
    // still attempting to connect.
    const touched = new Date();
    fs.utimesSync(daemonScript, touched, touched);

    const results = await Promise.all([runPhoton(), runPhoton(), runPhoton()]);
    for (const result of results) {
      assert.equal(
        result.code,
        0,
        `command during stale-binary restart failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
      assert.doesNotMatch(result.stderr, /connect ENOENT|daemon\.sock/i);
      assert.match(result.stdout, /Count/i);
    }

    console.log('✅ stale daemon binary restart absorbs concurrent ENOENT windows');
  } finally {
    fs.utimesSync(daemonScript, originalStat.atime, originalStat.mtime);
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [cliPath, 'daemon', 'stop'], {
        cwd: repoRoot,
        env: { ...process.env, PHOTON_HOME: tmpHome },
        stdio: 'ignore',
      });
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000).unref();
    });
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
