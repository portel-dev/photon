/**
 * Daemon CLI Command Group
 *
 * Manage the Photon background daemon process (start, stop, restart, status).
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';

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
