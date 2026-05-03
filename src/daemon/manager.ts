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
import { spawn, execFileSync } from 'child_process';
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
   * Approximate process start time in epoch ms via `ps -o etime=`.
   *
   * POSIX-only — Windows daemons skip this check (a separate task tracks
   * full Windows daemon recovery). Returns null if ps is unavailable, the
   * pid is dead, or the etime output is unparseable; callers should treat
   * null as "can't tell" rather than "matches".
   */
  private getProcessStartTimeMs(pid: number): number | null {
    if (process.platform === 'win32') return null;
    try {
      const out = execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], {
        encoding: 'utf-8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return null;
      // ps etime format: [[dd-]hh:]mm:ss
      const m = out.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
      if (!m) return null;
      const days = m[1] ? parseInt(m[1], 10) : 0;
      const hours = m[2] ? parseInt(m[2], 10) : 0;
      const mins = parseInt(m[3], 10);
      const secs = parseInt(m[4], 10);
      const elapsedSec = days * 86400 + hours * 3600 + mins * 60 + secs;
      return Date.now() - elapsedSec * 1000;
    } catch {
      return null;
    }
  }

  /**
   * Heuristic check: is `pid` actually our daemon, or did the kernel
   * recycle the slot to an unrelated process?
   *
   * Why this matters: getTrackedPids reads pid/owner files; if the daemon
   * died and the kernel reused its PID for an unrelated process, blindly
   * sending SIGTERM/SIGKILL would terminate that innocent process AND
   * cleanupStale would refuse to clean (because the "daemon" is "alive"),
   * leaving the operator wedged with a DaemonOrphanError they can't fix.
   *
   * We compare ps-reported process start time against the daemon owner
   * record's claimedAt timestamp. Daemons claim ownership within ~100ms
   * of spawning, so a 5s window covers normal jitter. A larger gap in
   * either direction strongly suggests the slot was recycled.
   *
   * Returns:
   *  - true:  evidence supports "this is our daemon"
   *  - false: clear evidence of PID reuse — caller should treat as dead
   *  - null:  can't determine (no owner record, ps failed, etc.) — caller
   *           should fall back to the conservative behavior (assume ours)
   *           rather than risk killing a stranger.
   */
  private isPidOurDaemon(pid: number): boolean | null {
    const owner = readOwnerRecord(this.ownerFile);
    if (!owner || owner.pid !== pid) {
      // Owner record points to a different PID — the pid file is the only
      // source for this number, which doesn't strongly tie it to us.
      // Conservative: return null and let the caller decide.
      return null;
    }
    const startMs = this.getProcessStartTimeMs(pid);
    if (startMs === null) return null; // ps unavailable / win32 / parse fail
    const driftMs = Math.abs(startMs - owner.claimedAt);
    return driftMs <= 5000;
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
   * confirmed dead (or the slot has been confirmed recycled), plus the
   * list of survivors that the caller should report in DaemonOrphanError.
   * Callers MUST NOT delete socket/pid/owner files unless `allDead` is
   * true — a surviving daemon keeps the socket bound, and unlinking it
   * from underneath leaves the "marked running but socket unreachable"
   * state we're trying to prevent.
   *
   * Filters out PIDs that ps says belong to a stranger (the kernel
   * recycled the slot) — sending signals to them would terminate
   * unrelated processes. Recycled PIDs are treated as "already dead"
   * for the purposes of cleanup and are NOT reported as survivors.
   */
  private terminateTrackedPidsSync(pids: number[]): { allDead: boolean; survivors: number[] } {
    if (pids.length === 0) return { allDead: true, survivors: [] };

    // Skip PIDs we can prove are not ours. isPidOurDaemon returning null
    // means "can't tell" — fall back to the conservative path (assume
    // ours, signal it) so we never silently leak a real daemon.
    const ourPids: number[] = [];
    const recycledPids: number[] = [];
    for (const pid of pids) {
      const verdict = this.isPidOurDaemon(pid);
      if (verdict === false) {
        recycledPids.push(pid);
      } else {
        ourPids.push(pid);
      }
    }
    if (recycledPids.length > 0) {
      this.logger.warn(
        'Detected PID reuse — tracked PID(s) belong to unrelated processes; ' +
          'treating slot as dead and skipping signal delivery.',
        { recycledPids }
      );
    }
    if (ourPids.length === 0) return { allDead: true, survivors: [] };

    for (const pid of ourPids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already dead or no permission — fine, the wait loop will confirm.
      }
    }
    if (this.waitForPidsDeadSync(ourPids, 3000)) {
      return { allDead: true, survivors: [] };
    }

    const stragglers = ourPids.filter((pid) => this.isPidStillAlive(pid));
    for (const pid of stragglers) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // EPERM (not ours) or ESRCH (just died) — no recourse either way.
      }
    }
    const allDead = this.waitForPidsDeadSync(ourPids, 1500);
    const survivors = allDead ? [] : ourPids.filter((pid) => this.isPidStillAlive(pid));
    return { allDead, survivors };
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
   * Returns true if the process recorded in the startup lock file is
   * still alive. Used by waitForDaemon to bail out early when the
   * lock-holding process has crashed mid-spawn.
   */
  private isLockHolderAlive(): boolean {
    try {
      const holderPid = parseInt(fs.readFileSync(this.lockFile, 'utf-8').trim(), 10);
      if (!Number.isFinite(holderPid) || holderPid <= 0) return false;
      return this.isPidStillAlive(holderPid);
    } catch {
      // Lock file gone — holder finished and released. Treat as "not alive"
      // so the caller re-attempts via start() (which will see the daemon
      // already up via the post-lock isSocketAlive recheck).
      return false;
    }
  }

  /**
   * Wait for another process to finish starting the daemon.
   *
   * Polls until the socket comes up OR the lock-holding process dies.
   *
   * IMPORTANT: maxWait must exceed spawnDaemon's own timeout (10 s).
   * If we time out faster than the lock holder can finish a healthy
   * spawn, we'll force-spawn a second daemon — both daemons race to
   * bind the socket, the loser is detected by the imposter scan and
   * killed. This is the root cause of the imposter-daemon entries
   * seen in the log around imposter PID detections.
   *
   * Also: do NOT force-unlink the lock file here. acquireStartupLock
   * already detects stale locks (holder PID dead) and cleans them up
   * atomically. Force-unlinking from a peer process opens a window
   * where two processes both think they hold the lock.
   */
  private async waitForDaemon(quiet: boolean): Promise<void> {
    const maxWait = 15_000;
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

      // If the lock holder died, don't keep waiting — return to start()
      // immediately so we can claim the lock ourselves.
      if (!this.isLockHolderAlive()) break;
    }

    if (!quiet)
      this.logger.warn(
        'Lock holder gave up or timed out before daemon became reachable; retrying start.'
      );
    // Recursive call — acquireStartupLock will handle stale-lock cleanup.
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
    // Windows named pipes have no filesystem entry, so existsSync would
    // always say "no" even when the pipe is reachable. Skip the FS gate
    // on win32 and rely on net.createConnection's own probe (the 'error'
    // event resolves false; the try/catch guards against sync throws).
    const isPipe = process.platform === 'win32' && this.ctx.socketPath.startsWith('\\\\.\\pipe\\');
    if (!isPipe && !fs.existsSync(this.ctx.socketPath)) return false;
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
    const { allDead, survivors } = this.terminateTrackedPidsSync(pids);
    if (!allDead) {
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
    const { allDead, survivors } = this.terminateTrackedPidsSync(pids);
    if (!allDead) {
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
