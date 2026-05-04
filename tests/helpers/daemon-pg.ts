/**
 * Shared helpers for tests that spawn `dist/daemon/server.js` directly.
 *
 * Why this exists:
 * - Children spawned without `detached: true` survive parent death just as
 *   detached ones do — Node.js does NOT auto-reap on parent exit. The
 *   leak this guards against is a test parent crashing (Ctrl-C twice, IDE
 *   kill) before its `finally` runs the per-test cleanup. The OS keeps
 *   the orphan running, holding a socket and (often) burning a CPU.
 * - With `detached: true`, the child becomes its own process-group leader
 *   (PGID == PID). `process.kill(-pid, 'SIGTERM')` then signals the
 *   whole group — the daemon plus anything it spawned (workers, watchers,
 *   subprocess loaders).
 *
 * Tests that use `spawnDaemonPG` get two safety nets:
 *   1. Explicit per-test `stopDaemonPG` in the `finally` block.
 *   2. Module-level `process.on('exit'|'SIGINT'|'SIGTERM')` that
 *      best-effort kills every still-tracked child group.
 */

import { spawn, execSync, type ChildProcess, type SpawnOptions } from 'node:child_process';

const tracked = new Set<ChildProcess>();
let cleanupInstalled = false;

const REAPER_GRACE_MS = 500;

function pgIsAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Block the calling thread for ~ms milliseconds without using setTimeout.
 * Required from `process.on('exit')`, where the event loop is shut down and
 * timers don't fire. Uses `/bin/sleep` because Node's only synchronous-sleep
 * primitive is `Atomics.wait` on a SharedArrayBuffer, which has been gated
 * behind COOP/COEP isolation rules in some runtimes.
 */
function syncSleep(ms: number): void {
  try {
    execSync(`/bin/sleep ${(ms / 1000).toFixed(3)}`, { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
}

function installProcessCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  // Reaper escalates: SIGTERM the group, busy-wait up to REAPER_GRACE_MS,
  // then SIGKILL anything still alive. The wait is synchronous because
  // 'exit' handlers run after the event loop has drained — async timers
  // and Promise resolution will not fire here. SIGKILL on a parent
  // process is unhandleable; nothing this helper does covers that case.
  const reap = (): void => {
    const pgids: number[] = [];
    for (const child of tracked) {
      if (!child.pid) continue;
      try {
        process.kill(-child.pid, 'SIGTERM');
        pgids.push(child.pid);
      } catch {
        /* group already gone */
      }
    }
    if (pgids.length === 0) {
      tracked.clear();
      return;
    }
    const deadline = Date.now() + REAPER_GRACE_MS;
    while (Date.now() < deadline) {
      if (pgids.every((pgid) => !pgIsAlive(pgid))) break;
      syncSleep(50);
    }
    for (const pgid of pgids) {
      if (pgIsAlive(pgid)) {
        try {
          process.kill(-pgid, 'SIGKILL');
        } catch {
          /* race with natural exit */
        }
      }
    }
    tracked.clear();
  };
  process.on('exit', reap);
  process.on('SIGINT', () => {
    reap();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    reap();
    process.exit(143);
  });
}

export function spawnDaemonPG(args: string[], options: SpawnOptions): ChildProcess {
  installProcessCleanup();
  // Always pass PHOTON_DAEMON_WATCHDOG_PID so the daemon polls our PID and
  // exits on its own if this test process dies before reaching teardown.
  // Belt-and-braces with the process-group reaper above: the reaper kills
  // on graceful 'exit'/'SIGINT'/'SIGTERM', the watchdog kills on the
  // unhandleable cases (SIGKILL, OOM, IDE kill, machine sleep + lid).
  //
  // Order matters: if the caller explicitly set PHOTON_DAEMON_WATCHDOG_PID
  // in `options.env` (e.g. the watchdog regression test points it at a
  // sentinel sleep process), respect that. Default to our own pid only
  // when unset.
  const callerEnv = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = {
    PHOTON_DAEMON_WATCHDOG_PID: String(process.pid),
    ...callerEnv,
  };
  // Run the daemon under node, NOT process.execPath — when the test runner
  // is bun, process.execPath = bun, and src/daemon/server.ts:5004 switches
  // to fs.watchFile stat-polling at a 2s interval to dodge bun's fs.watch
  // bugs on macOS. That's a real production concern (kept on purpose) but
  // it makes file-edit-driven tests flaky because they wait <1s for the
  // first poll. Pinning to node here gives daemon-watcher.test.ts the
  // sub-millisecond latency the kernel watcher provides, while preserving
  // bun-mode behavior for anyone running the daemon directly under bun.
  const child = spawn('node', args, {
    ...options,
    env,
    detached: true,
  });
  tracked.add(child);
  child.once('exit', () => tracked.delete(child));
  return child;
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await wait(50);
  }
  return false;
}

/**
 * SIGTERM the daemon's whole process group. Falls back to per-pid kill if
 * the group signal is denied (EPERM on shared CI hosts) and finally to
 * SIGKILL if the daemon ignores TERM. Always removes the child from the
 * tracked set so the process-exit reaper doesn't double-fire.
 *
 * Logs (to stderr) when both group-kill and per-pid kill fail with
 * something other than ESRCH, so a leak path becomes visible in test
 * output instead of silently dropping the child from tracking.
 */
export async function stopDaemonPG(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  tracked.delete(child);
  if (!child.pid) return;
  const pid = child.pid;
  let signaled = false;
  try {
    process.kill(-pid, 'SIGTERM');
    signaled = true;
  } catch (groupErr: any) {
    if (groupErr?.code !== 'ESRCH') {
      try {
        child.kill('SIGTERM');
        signaled = true;
      } catch (perPidErr: any) {
        if (perPidErr?.code !== 'ESRCH') {
          console.error(
            `[daemon-pg] stopDaemonPG: both group and per-pid SIGTERM failed for pid ${pid}: ` +
              `group=${groupErr?.code ?? groupErr?.message}, perPid=${perPidErr?.code ?? perPidErr?.message}`
          );
        }
        return;
      }
    } else {
      // ESRCH on group => already gone, treat as success.
      return;
    }
  }
  if (!signaled) return;
  const exited = await waitForExit(pid, timeoutMs);
  if (!exited) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (groupErr: any) {
      if (groupErr?.code !== 'ESRCH') {
        try {
          child.kill('SIGKILL');
        } catch (perPidErr: any) {
          if (perPidErr?.code !== 'ESRCH') {
            console.error(
              `[daemon-pg] stopDaemonPG: SIGKILL escalation failed for pid ${pid}: ` +
                `group=${groupErr?.code ?? groupErr?.message}, perPid=${perPidErr?.code ?? perPidErr?.message}`
            );
          }
        }
      }
    }
  }
}
