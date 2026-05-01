/**
 * Daemon CLI Command Group
 *
 * Manage the Photon background daemon process (start, stop, restart, status).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';

const PHOTON_FILE_EXTS = ['.photon.ts', '.photon.tsx', '.photon.js'];

// Directories that never contain user-authored photons. Walking into them
// just wastes IO. Covers the JS/TS, Python, Rust, Java, Cocoa, and Ruby
// build/cache trees — codex consult P8 finding.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  'Pods',
  'DerivedData',
  '.git',
  '.next',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.data',
  '.gradle',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
]);

/**
 * Return true if `dir` (or any subdirectory) contains a `.photon.{ts,tsx,js}`
 * file. Bounded by `maxDepth` so a base pointing at `$HOME` does not walk
 * the entire tree.
 *
 * Dot-directories: codex consult P7 — the previous walker skipped every
 * dot-dir, which can hide a legitimate photon under `.examples/` or a
 * user-authored hidden folder. Now only skips entries explicitly listed
 * in SKIP_DIRS, so user-authored hidden dirs are visited.
 *
 * Symlinks: `Dirent.isDirectory()` is false for symlinked directories, so
 * the previous walker silently ignored them. We now check
 * `Dirent.isSymbolicLink()`, resolve via `fs.realpathSync.native`, and
 * traverse the target. A `visited` set keyed on real paths prevents loops
 * (a -> b -> a or self-symlinks).
 */
function hasPhotonFile(dir: string, maxDepth = 6): boolean {
  const visited = new Set<string>();
  let startReal: string;
  try {
    startReal = fs.realpathSync.native(dir);
  } catch {
    return false;
  }
  visited.add(startReal);
  const stack: Array<{ p: string; d: number }> = [{ p: startReal, d: 0 }];

  while (stack.length > 0) {
    const { p, d } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        if (PHOTON_FILE_EXTS.some((ext) => entry.name.endsWith(ext))) return true;
        continue;
      }
      if (d >= maxDepth) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const childPath = path.join(p, entry.name);
      if (entry.isDirectory()) {
        stack.push({ p: childPath, d: d + 1 });
      } else if (entry.isSymbolicLink()) {
        let real: string;
        try {
          real = fs.realpathSync.native(childPath);
        } catch {
          continue;
        }
        if (visited.has(real)) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(real);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        visited.add(real);
        stack.push({ p: real, d: d + 1 });
      }
    }
  }
  return false;
}

/**
 * Register daemon command group
 */
export function registerDaemonCommands(program: Command): void {
  const daemonCmd = program.command('daemon').description('Manage the Photon background daemon');

  daemonCmd
    .command('start')
    .description('Start the daemon (no-op if already running)')
    .action(async () => {
      try {
        const { printInfo, printSuccess } = await import('../../cli-formatter.js');
        const { ensureDaemon, isGlobalDaemonReachable } = await import('../../daemon/manager.js');
        const wasReachable = await isGlobalDaemonReachable();
        if (wasReachable) {
          printInfo('Daemon is already running.');
          return;
        }
        await ensureDaemon(false);
        printSuccess('Daemon started.');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`Failed to start daemon: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  daemonCmd
    .command('stop')
    .description('Stop the running daemon')
    .action(async () => {
      try {
        const { printInfo, printSuccess } = await import('../../cli-formatter.js');
        const { stopGlobalDaemon, isGlobalDaemonRunning, isGlobalDaemonReachable } =
          await import('../../daemon/manager.js');
        if (!isGlobalDaemonRunning() && !(await isGlobalDaemonReachable())) {
          printInfo('Daemon is not running.');
          return;
        }
        stopGlobalDaemon();
        printSuccess('Daemon stopped.');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`Failed to stop daemon: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  daemonCmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => {
      try {
        const { printSuccess } = await import('../../cli-formatter.js');
        const { restartGlobalDaemon } = await import('../../daemon/manager.js');
        await restartGlobalDaemon();
        printSuccess('Daemon restarted.');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`Failed to restart daemon: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  daemonCmd
    .command('prune-bases')
    .description(
      'Remove registered PHOTON_DIRs whose path is gone OR has no .photon.{ts,tsx,js} files'
    )
    .option('--dry-run', 'Print what would be pruned without modifying the registry')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const { printInfo, printSuccess } = await import('../../cli-formatter.js');
        const { readBasesRegistry, writeBasesRegistry } = await import('@portel/photon-core');

        const registry = readBasesRegistry();
        const removed: Array<{ path: string; reason: string }> = [];
        const kept: typeof registry.bases = [];

        for (const entry of registry.bases) {
          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(entry.path);
          } catch {
            removed.push({ path: entry.path, reason: 'path missing' });
            continue;
          }
          if (!stat.isDirectory()) {
            removed.push({ path: entry.path, reason: 'not a directory' });
            continue;
          }
          if (!hasPhotonFile(entry.path)) {
            removed.push({ path: entry.path, reason: 'no .photon files' });
            continue;
          }
          kept.push(entry);
        }

        if (removed.length === 0) {
          printSuccess(`Bases registry is clean (${kept.length} bases kept).`);
          return;
        }

        for (const r of removed) {
          console.log(`  ${opts.dryRun ? '[dry-run]' : 'remove'}: ${r.path}  (${r.reason})`);
        }

        if (opts.dryRun) {
          printInfo(`Would remove ${removed.length} of ${registry.bases.length} bases.`);
          return;
        }

        writeBasesRegistry({ bases: kept });
        printSuccess(`Pruned ${removed.length} of ${registry.bases.length} bases.`);
        printInfo('Restart the daemon for the change to take effect on running schedules.');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`Failed to prune bases: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  daemonCmd
    .command('status')
    .description('Show daemon status and health info')
    .action(async () => {
      try {
        const { printInfo, printSuccess } = await import('../../cli-formatter.js');
        const { isGlobalDaemonRunning, isGlobalDaemonReachable, GLOBAL_PID_FILE, GLOBAL_LOG_FILE } =
          await import('../../daemon/manager.js');
        const running = isGlobalDaemonRunning();
        const reachable = await isGlobalDaemonReachable();
        if (reachable) {
          const { readFileSync, existsSync } = await import('fs');
          const pid = existsSync(GLOBAL_PID_FILE)
            ? readFileSync(GLOBAL_PID_FILE, 'utf-8').trim()
            : 'unknown';
          printSuccess(`Daemon is running (PID ${pid})`);
          console.log(`  Log: ${GLOBAL_LOG_FILE}`);

          // Query daemon for health info
          const { queryDaemonStatus } = await import('../../daemon/client.js');
          const health = await queryDaemonStatus();
          if (health) {
            const uptimeSec = Math.round(health.uptime);
            const hours = Math.floor(uptimeSec / 3600);
            const mins = Math.floor((uptimeSec % 3600) / 60);
            const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            console.log(`  Uptime: ${uptimeStr}`);
            console.log(`  Memory: ${health.memoryMB} MB`);
            console.log(`  Sessions: ${health.sessions}`);
            console.log(`  Photons loaded: ${health.photonsLoaded}`);
          }
        } else if (running) {
          printInfo('Daemon has stale process state but is not responding.');
          console.log(`  Log: ${GLOBAL_LOG_FILE}`);
        } else {
          printInfo('Daemon is not running.');
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(`Failed to check daemon status: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}
