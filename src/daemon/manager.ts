/**
 * Daemon Manager
 *
 * Manages the single global Photon daemon lifecycle via a state machine.
 * The daemon handles all photons through channel-based isolation.
 *
 * Architecture:
 * - Single daemon process: ~/.photon/daemon.sock
 * - All photons communicate through the same daemon
 * - Channels provide isolation: {photonId}:{itemId}
 * - State machine guards all transitions (stopped → starting → running → stopping)
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { DaemonStatus } from './protocol.js';
import { DaemonStateMachine, type DaemonState } from './state-machine.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { getDefaultContext, type PhotonContext } from '../context.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DaemonManager — state-machine-guarded daemon lifecycle.
 *
 * All transitions (start, stop, restart) go through the FSM,
 * preventing illegal states like double-start or stop-while-starting.
 */
export class DaemonManager {
  private fsm = new DaemonStateMachine();
  private ctx: PhotonContext;
  private logger = createLogger({ component: 'daemon-manager', minimal: true });

  constructor(ctx?: PhotonContext) {
    this.ctx = ctx || getDefaultContext();

    // Sync FSM with actual process state on construction
    if (this.isPidAlive()) {
      // Process exists — assume running (start/ensure will verify socket)
      this.fsm.transition('starting');
      this.fsm.transition('running');
    }
  }

  /** Current FSM state. */
  get status(): DaemonState {
    return this.fsm.state;
  }

  /** Paths for external consumers. */
  get pidFile(): string {
    return this.ctx.pidFile;
  }
  get logFile(): string {
    return this.ctx.logFile;
  }
  get socketPath(): string {
    return this.ctx.socketPath;
  }

  /**
   * Idempotent ensure — start if needed, restart if binary is stale.
   * Concurrent callers join the in-flight operation instead of racing.
   */
  private _ensurePromise: Promise<void> | null = null;

  async ensure(quiet = true): Promise<void> {
    // Coalesce concurrent ensure() calls into a single operation
    if (this._ensurePromise) return this._ensurePromise;

    this._ensurePromise = this._ensureImpl(quiet).finally(() => {
      this._ensurePromise = null;
    });
    return this._ensurePromise;
  }

  private async _ensureImpl(quiet: boolean): Promise<void> {
    if (this.fsm.state === 'running') {
      if (!(await this.isSocketAlive())) {
        this.logger.warn('Daemon marked running but socket is unreachable, recovering stale state');
        this.cleanupStale();
        this.resyncFromDisk();
        await this.start(quiet);
        return;
      }
      if (this.isBinaryStale()) {
        this.logger.info('Daemon binary updated since last start, restarting...');
        await this.restart();
        return;
      }
      // Already running and not stale
      return;
    }

    if (this.fsm.state === 'stopped') {
      await this.start(quiet);
      return;
    }

    // starting/stopping — wait for it to settle, then check again
    // (This handles the edge case of external state changes)
  }

  /**
   * Start the daemon. No-op if already running.
   * Uses a filesystem lock to prevent cross-process races where multiple
   * processes (Beam, CLI, MCP) each decide the daemon is dead and all spawn one.
   */
  async start(quiet = false): Promise<void> {
    if (this.fsm.state === 'running') {
      if (await this.isSocketAlive()) {
        if (!quiet) this.logger.debug('Global daemon already running');
        return;
      }
      this.logger.warn('Daemon marked running but socket is unreachable, recovering stale state');
      this.cleanupStale();
      this.resyncFromDisk();
    }

    // If somehow stuck in starting/stopping, re-sync from disk
    if (this.fsm.state !== 'stopped') {
      this.resyncFromDisk();
    }

    if (!fs.existsSync(this.ctx.baseDir)) {
      fs.mkdirSync(this.ctx.baseDir, { recursive: true });
    }

    // Socket answers → daemon is alive and healthy
    if (await this.isSocketAlive()) {
      // Sync FSM to running
      if (this.fsm.state === 'stopped') {
        this.fsm.transition('starting');
        this.fsm.transition('running');
      }
      if (!quiet) this.logger.debug('Global daemon already running');
      return;
    }

    // Acquire cross-process lock before spawning.
    // This serializes startup so only one process spawns the daemon.
    const lockAcquired = await this.acquireStartupLock();
    if (!lockAcquired) {
      // Another process is starting the daemon — wait for it to become available
      await this.waitForDaemon(quiet);
      return;
    }

    try {
      // Re-check after acquiring lock — another process may have started it
      if (await this.isSocketAlive()) {
        if (this.fsm.state === 'stopped') {
          this.fsm.transition('starting');
          this.fsm.transition('running');
        }
        if (!quiet) this.logger.debug('Global daemon started by another process');
        return;
      }

      // Socket unresponsive → cleanup stale state
      this.cleanupStale();

      // Transition to starting
      if (this.fsm.state !== 'stopped') this.resyncFromDisk();
      this.fsm.transition('starting');

      try {
        await this.spawnDaemon(quiet);
        this.fsm.transition('running');
      } catch (error) {
        this.fsm.transition('stopped');
        throw error;
      }
    } finally {
      this.releaseStartupLock();
    }
  }

  /**
   * Stop the daemon.
   */
  stop(): void {
    if (this.fsm.state === 'stopped') {
      this.logger.warn('No global daemon running');
      return;
    }

    // Allow stopping from running or stale states
    if (this.fsm.state === 'running') {
      this.fsm.transition('stopping');
    } else if (this.fsm.state === 'stale') {
      this.fsm.transition('stopping');
    } else {
      // starting or stopping — force resync
      this.resyncFromDisk();
      if ((this.fsm.state as DaemonState) === 'stopped') return;
      if (this.fsm.canTransition('stopping')) {
        this.fsm.transition('stopping');
      }
    }

    try {
      this.killProcess();
    } finally {
      this.fsm.transition('stopped');
    }
  }

  /**
   * Restart the daemon (stop → start).
   */
  async restart(): Promise<void> {
    if (this.fsm.state !== 'stopped') {
      this.stop();
    }

    // Wait for graceful shutdown
    await new Promise((r) => setTimeout(r, 300));

    // Clean stale socket if still present
    if (fs.existsSync(this.ctx.socketPath) && process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.ctx.socketPath);
      } catch {
        // Ignore — start will also clean it
      }
    }

    await this.start(true);
  }

  /**
   * Get daemon status info.
   */
  getStatus(): DaemonStatus {
    if (!this.isPidAlive()) {
      return { running: false, photonName: 'global' };
    }
    const pid = this.readPid();
    return { running: true, pid: pid ?? undefined, photonName: 'global' };
  }

  async isReachable(): Promise<boolean> {
    return this.isSocketAlive();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  private get lockFile(): string {
    return path.join(this.ctx.baseDir, 'daemon.lock');
  }

  /**
   * Acquire a cross-process startup lock using atomic O_EXCL file creation.
   * Returns true if lock acquired, false if another process holds it.
   * Handles stale locks (lock holder PID is dead).
   */
  private async acquireStartupLock(): Promise<boolean> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // O_CREAT | O_EXCL | O_WRONLY — atomic: fails if file already exists
        const fd = fs.openSync(
          this.lockFile,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        );
        // Write our PID so stale locks can be detected
        fs.writeSync(fd, process.pid.toString());
        fs.closeSync(fd);
        return true;
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;

        // Lock file exists — check if holder is still alive
        try {
          const holderPid = parseInt(fs.readFileSync(this.lockFile, 'utf-8').trim(), 10);
          if (holderPid && !isNaN(holderPid)) {
            try {
              process.kill(holderPid, 0); // signal 0 = test if alive
              // Holder is alive — lock is valid, we lost the race
              return false;
            } catch {
              // Holder is dead — stale lock, remove and retry
              this.logger.debug('Removing stale daemon startup lock', { stalePid: holderPid });
              try {
                fs.unlinkSync(this.lockFile);
              } catch {
                /* race with another cleanup */
              }
              continue;
            }
          }
        } catch {
          // Can't read lock file — remove and retry
          try {
            fs.unlinkSync(this.lockFile);
          } catch {
            /* ignore */
          }
          continue;
        }

        // If we get here, lock exists but we couldn't determine holder — back off
        return false;
      }
    }
    return false;
  }

  private releaseStartupLock(): void {
    try {
      // Only remove if we own it (our PID is in it)
      const content = fs.readFileSync(this.lockFile, 'utf-8').trim();
      if (content === process.pid.toString()) {
        fs.unlinkSync(this.lockFile);
      }
    } catch {
      // Lock file already removed or never created
    }
  }

  /**
   * Wait for another process to finish starting the daemon.
   * Polls socket availability with a timeout.
   */
  private async waitForDaemon(quiet: boolean): Promise<void> {
    const maxWait = 5000;
    const interval = 200;
    let waited = 0;

    while (waited < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      waited += interval;

      if (await this.isSocketAlive()) {
        if (this.fsm.state === 'stopped') {
          this.fsm.transition('starting');
          this.fsm.transition('running');
        }
        if (!quiet) this.logger.debug('Daemon started by another process');
        return;
      }
    }

    // Timeout — the other process may have failed. Try starting ourselves.
    if (!quiet)
      this.logger.warn('Timed out waiting for daemon from another process, attempting start');
    // Clean stale lock if holder died during startup
    try {
      fs.unlinkSync(this.lockFile);
    } catch {
      /* ignore */
    }
    // Recursive call — will re-attempt lock acquisition
    return this.start(quiet);
  }

  private isPidAlive(): boolean {
    if (!fs.existsSync(this.ctx.pidFile)) return false;
    try {
      const pid = parseInt(fs.readFileSync(this.ctx.pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0);
      return true;
    } catch {
      try {
        fs.unlinkSync(this.ctx.pidFile);
      } catch {
        // Ignore
      }
      return false;
    }
  }

  private readPid(): number | null {
    try {
      return parseInt(fs.readFileSync(this.ctx.pidFile, 'utf-8').trim(), 10);
    } catch {
      return null; // PID file missing or unreadable
    }
  }

  private async isSocketAlive(): Promise<boolean> {
    if (process.platform === 'win32' || !fs.existsSync(this.ctx.socketPath)) return false;
    return new Promise((resolve) => {
      const sock = net.createConnection(this.ctx.socketPath);
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, 2_000);
      sock.on('connect', () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  private cleanupStale(): void {
    if (fs.existsSync(this.ctx.pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(this.ctx.pidFile, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Process already dead
        }
      } catch {
        // Can't read PID file
      }
      try {
        fs.unlinkSync(this.ctx.pidFile);
      } catch {
        // Ignore
      }
    }
    if (fs.existsSync(this.ctx.socketPath) && process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.ctx.socketPath);
      } catch {
        // Ignore
      }
    }
  }

  private killProcess(): void {
    if (!fs.existsSync(this.ctx.pidFile)) return;
    try {
      const pid = parseInt(fs.readFileSync(this.ctx.pidFile, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
      } catch (killError: any) {
        if (killError.code !== 'ESRCH') throw killError;
      }
      fs.unlinkSync(this.ctx.pidFile);
      if (fs.existsSync(this.ctx.socketPath) && process.platform !== 'win32') {
        fs.unlinkSync(this.ctx.socketPath);
      }
      this.logger.debug('Stopped global daemon', { pid });
    } catch (error) {
      this.logger.debug('Error stopping global daemon', { error: getErrorMessage(error) });
    }
  }

  private resolveDaemonScript(): string {
    const daemonScriptSrc = path.join(__dirname, 'server.js');
    return fs.existsSync(daemonScriptSrc)
      ? daemonScriptSrc
      : daemonScriptSrc.replace(`${path.sep}src${path.sep}`, `${path.sep}dist${path.sep}`);
  }

  private isBinaryStale(): boolean {
    if (!fs.existsSync(this.ctx.pidFile)) return false;
    const daemonScript = this.resolveDaemonScript();
    if (!fs.existsSync(daemonScript)) return false;
    try {
      const daemonStartedAt = fs.statSync(this.ctx.pidFile).mtimeMs;
      const binaryBuiltAt = fs.statSync(daemonScript).mtimeMs;
      return binaryBuiltAt > daemonStartedAt;
    } catch {
      return false; // stat race condition — file removed between exists check and stat
    }
  }

  private async spawnDaemon(quiet: boolean): Promise<void> {
    const daemonScript = this.resolveDaemonScript();
    const logStream = fs.openSync(this.ctx.logFile, 'a');

    const child = spawn(process.execPath, [daemonScript, this.ctx.socketPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: { ...process.env, PHOTON_DAEMON: 'true' },
    });

    child.unref();
    fs.writeFileSync(this.ctx.pidFile, child.pid!.toString());

    if (!quiet) {
      this.logger.info('Started global Photon daemon', { pid: child.pid });
    }

    // Wait for socket to actually accept connections (not just file existence)
    const maxWait = 10_000;
    const interval = 100;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      waited += interval;
      if (await this.isSocketAlive()) {
        return;
      }
    }

    this.cleanupStale();
    throw new Error('Daemon started but socket was not ready within 10s');
  }

  /**
   * Re-sync FSM state from disk (PID file existence).
   * Used when FSM gets out of sync (e.g. daemon killed externally).
   */
  private resyncFromDisk(): void {
    // Reset FSM to match actual state
    const alive = this.isPidAlive();
    // Create a fresh FSM in the correct state
    const newFsm = new DaemonStateMachine();
    if (alive) {
      newFsm.transition('starting');
      newFsm.transition('running');
    }
    // Replace (can't directly set state, so we replace the instance)
    (this as any).fsm = newFsm;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY — thin wrappers around DaemonManager singleton
// These exports are used throughout the codebase and will be migrated
// incrementally to use DaemonManager directly.
// ═══════════════════════════════════════════════════════════════════════════════

let _manager: DaemonManager | undefined;

function getManager(): DaemonManager {
  if (!_manager) {
    _manager = new DaemonManager();
  }
  return _manager;
}

export const GLOBAL_PID_FILE = getDefaultContext().pidFile;
export const GLOBAL_LOG_FILE = getDefaultContext().logFile;

export function getGlobalSocketPath(): string {
  return getDefaultContext().socketPath;
}

export function isGlobalDaemonRunning(): boolean {
  return getManager().getStatus().running;
}

export async function isGlobalDaemonReachable(): Promise<boolean> {
  return getManager().isReachable();
}

export async function startGlobalDaemon(quiet = false): Promise<void> {
  return getManager().start(quiet);
}

export async function ensureDaemon(quiet = true): Promise<void> {
  return getManager().ensure(quiet);
}

export function stopGlobalDaemon(): void {
  return getManager().stop();
}

export async function restartGlobalDaemon(): Promise<void> {
  return getManager().restart();
}
