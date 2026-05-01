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

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const tracked = new Set<ChildProcess>();
let cleanupInstalled = false;

function installProcessCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const reap = (): void => {
    for (const child of tracked) {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* group already gone */
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
  const child = spawn(process.execPath, args, {
    ...options,
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
 */
export async function stopDaemonPG(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  tracked.delete(child);
  if (!child.pid) return;
  const pid = child.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }
  const exited = await waitForExit(pid, timeoutMs);
  if (!exited) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}
