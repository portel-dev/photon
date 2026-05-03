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
import { getOwnerFilePath, isPidAlive as checkPidAlive, readOwnerRecord } from './ownership.js';
import { createLogger } from '../shared/logger.js';
import { getDefaultContext, type PhotonContext } from '../context.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Thrown when a daemon PID survives SIGTERM and SIGKILL. Callers should
 * NOT retry an `ensure`/`start` automatically — a surviving process keeps
 * the socket bound, so spawning a fresh daemon would race or EADDRINUSE.
 * Surface this to the user instead.
 */
export class DaemonOrphanError extends Error {
  readonly survivorPids: number[];
  constructor(message: string, survivorPids: number[]) {
    super(message);
    this.name = 'DaemonOrphanError';
    this.survivorPids = survivorPids;
  }
}

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

    // starting/stopping — wait for it to settle, then re-sync and retry
    await this.waitForDaemon(quiet);
    this.resyncFromDisk();
    if ((this.fsm.state as DaemonState) === 'stopped') {
      await this.start(quiet);
    }
  }

  /**
   * Start the daemon. No-op if already running.
   * Uses a filesystem lock to prevent cross-process races where multiple
   * processes (Beam, CLI, MCP) each decide the daemon is dead and all spawn one.
   */
  async start(quiet = false): Promise<void> {
    if (this.fsm.state === 'running') {
      if ((await this.isSocketAlive()) && this.hasExclusiveOwner()) {
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
    if ((await this.isSocketAlive()) && this.hasExclusiveOwner()) {
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
      if ((await this.isSocketAlive()) && this.hasExclusiveOwner()) {
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
      this.fsm.transition('stopped');
    } catch (error) {
      // killProcess threw because the daemon process won't die. Don't
      // transition to 'stopped' — the FSM should reflect reality (the
      // daemon is still running). Re-throw so the caller surfaces it.
      if (error instanceof DaemonOrphanError) throw error;
      // Unknown error — best to mark stopped to avoid wedging the FSM,
      // but propagate the error so the caller knows cleanup was partial.
      this.fsm.transition('stopped');
      throw error;
    }
  }

  /**
   * Restart the daemon (stop → start).
   */
  async restart(): Promise<void> {
    if (this.fsm.state !== 'stopped') {
      // If the running daemon refuses to die, killProcess throws
      // DaemonOrphanError; let it propagate. We must NOT delete the
      // socket of a still-running daemon and spawn a competitor.
      this.stop();
    }

    // killProcess already removed pid/owner/socket files when it succeeded.
    // No additional unlink needed here — and unlinking unconditionally is
    // exactly the bug that caused 814 "imposter daemon" restart cycles.
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

  private get ownerFile(): string {
    return getOwnerFilePath(this.ctx.socketPath);
  }

  /**
   * Acquire a cross-process startup lock using atomic O_EXCL file creation.
   * Returns true if lock acquired, false if another process holds it.
   * Handles stale locks (lock holder PID is dead).
   */
  /**
   * Returns true if the PID responds to signal 0 (i.e. the process exists
   * and we have permission to signal it). Robust to ESRCH and EPERM.
   */
  private isPidStillAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      // ESRCH = no such process; EPERM = process exists but not ours
      // For our purposes EPERM means "alive" — we can't kill it either.
      return err?.code === 'EPERM';
    }
  }

  /**
   * Synchronously poll until all pids are dead or the timeout expires.
   * Returns true iff every pid is confirmed dead before the deadline.
   */
  private waitForPidsDeadSync(pids: number[], timeoutMs: number): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pids.every((pid) => !this.isPidStillAlive(pid))) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    return pids.every((pid) => !this.isPidStillAlive(pid));
  }

  /**
   * SIGTERM → wait → SIGKILL → wait. Returns whether every tracked pid is
   * confirmed dead. Callers MUST NOT delete socket/pid/owner files unless
   * this returns true — a surviving process keeps the socket bound, and
   * unlinking it from underneath leaves the "marked running but socket
   * unreachable" state we're trying to prevent.
   */
  private terminateTrackedPidsSync(pids: number[]): boolean {
    if (pids.length === 0) return true;

    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already dead or no permission — fine, the wait loop will confirm.
      }
    }
    if (this.waitForPidsDeadSync(pids, 3000)) return true;

    const survivors = pids.filter((pid) => this.isPidStillAlive(pid));
    for (const pid of survivors) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // EPERM (not ours) or ESRCH (just died) — no recourse either way.
      }
    }
    return this.waitForPidsDeadSync(pids, 1500);
  }

  /**
   * Unlink pid file, owner file, and socket file. Caller is responsible for
   * confirming the daemon process is dead first; this helper does not check.
   */
  private removeStateFiles(): void {
    for (const file of [this.ctx.pidFile, this.ownerFile, this.ctx.socketPath]) {
      if (process.platform === 'win32' && file === this.ctx.socketPath) continue;
      if (!fs.existsSync(file)) continue;
      try {
        fs.unlinkSync(file);
      } catch {
        // Race with another cleanup — fine.
      }
    }
  }

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

      if ((await this.isSocketAlive()) && this.hasExclusiveOwner()) {
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
      if (!checkPidAlive(pid)) throw new Error('dead pid');
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
      let sock: net.Socket;
      try {
        // TOCTOU vs. existsSync above: file may vanish, and Bun can throw
        // synchronously on a missing unix socket before any 'error' listener
        // attaches. Catch and resolve(false) to keep this defensive helper
        // from crashing the process.
        sock = net.createConnection(this.ctx.socketPath);
      } catch {
        resolve(false);
        return;
      }
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
    const pids = this.getTrackedPids();
    const allDead = this.terminateTrackedPidsSync(pids);
    if (!allDead) {
      const survivors = pids.filter((pid) => this.isPidStillAlive(pid));
      this.logger.error(
        'Refusing to delete daemon state files: tracked PID(s) survived SIGTERM and SIGKILL. ' +
          'The socket may still be bound by the surviving process. ' +
          'Manual intervention required: identify and terminate the orphan, then retry.',
        { survivorPids: survivors, socketPath: this.ctx.socketPath }
      );
      throw new DaemonOrphanError(
        `Cannot recover daemon: PID ${survivors.join(', ')} survived SIGKILL. ` +
          `Run \`kill -9 ${survivors.join(' ')}\` and retry.`,
        survivors
      );
    }
    this.removeStateFiles();
  }

  private killProcess(): void {
    const pids = this.getTrackedPids();
    if (pids.length === 0) return;
    const allDead = this.terminateTrackedPidsSync(pids);
    if (!allDead) {
      const survivors = pids.filter((pid) => this.isPidStillAlive(pid));
      // Don't unlink files — surviving daemon still owns the socket.
      this.logger.error(
        'Daemon stop incomplete: tracked PID(s) survived SIGKILL. State files left intact ' +
          'so the running daemon stays reachable.',
        { survivorPids: survivors }
      );
      throw new DaemonOrphanError(
        `Daemon PID ${survivors.join(', ')} did not exit after SIGKILL.`,
        survivors
      );
    }
    this.removeStateFiles();
    this.logger.debug('Stopped global daemon', { pids });
  }

  /**
   * Rotate the daemon log on each spawn if it has grown past LOG_ROTATE_BYTES.
   *
   * Cheap, single-generation rotation: rename log to log.1 (overwriting any
   * previous .1). Done at spawn time rather than per-write so it adds zero
   * overhead to the hot path. With the connect/disconnect spam now demoted
   * to debug, the log should grow slowly enough that a 50 MB cap is plenty
   * of headroom; the cap exists as a backstop, not a primary defense.
   */
  private static readonly LOG_ROTATE_BYTES = 50 * 1024 * 1024;
  private rotateLogIfTooLarge(): void {
    try {
      if (!fs.existsSync(this.ctx.logFile)) return;
      const stat = fs.statSync(this.ctx.logFile);
      if (stat.size < DaemonManager.LOG_ROTATE_BYTES) return;
      const rotated = `${this.ctx.logFile}.1`;
      try {
        fs.unlinkSync(rotated);
      } catch {
        // No prior rotated log — fine.
      }
      fs.renameSync(this.ctx.logFile, rotated);
      this.logger.info('Rotated oversized daemon log', {
        previousBytes: stat.size,
        rotatedTo: rotated,
      });
    } catch {
      // Rotation is best-effort — never block daemon spawn on it.
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
    this.rotateLogIfTooLarge();
    const logStream = fs.openSync(this.ctx.logFile, 'a');

    const child = spawn(process.execPath, [daemonScript, this.ctx.socketPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      env: { ...process.env, PHOTON_DAEMON: 'true' },
    });
    const childPid = child.pid;
    if (childPid === undefined) {
      throw new Error('Daemon process started without a PID');
    }

    child.unref();
    fs.writeFileSync(this.ctx.pidFile, childPid.toString());

    if (!quiet) {
      this.logger.info('Started global Photon daemon', { pid: childPid });
    }

    // Wait for socket to actually accept connections (not just file existence)
    const maxWait = 10_000;
    const interval = 100;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      waited += interval;
      if ((await this.isSocketAlive()) && this.hasExclusiveOwner(childPid)) {
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

  private hasExclusiveOwner(expectedPid?: number): boolean {
    const owner = readOwnerRecord(this.ownerFile);
    if (!owner || owner.socketPath !== this.ctx.socketPath) return false;
    if (!checkPidAlive(owner.pid)) return false;
    if (expectedPid !== undefined && owner.pid !== expectedPid) return false;
    return true;
  }

  private getTrackedPids(): number[] {
    const pids = new Set<number>();

    try {
      const pid = parseInt(fs.readFileSync(this.ctx.pidFile, 'utf-8').trim(), 10);
      if (!isNaN(pid)) pids.add(pid);
    } catch {
      // Ignore missing pid file
    }

    const owner = readOwnerRecord(this.ownerFile);
    if (owner?.socketPath === this.ctx.socketPath) {
      pids.add(owner.pid);
    }

    return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
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
