#!/usr/bin/env node

/**
 * Global Photon Daemon Server
 *
 * Single daemon process for all photons.
 * - Listens on global Unix socket / named pipe (~/.photon/daemon.sock)
 * - Handles requests for multiple photons via photonName field
 * - Lazy-initializes SessionManagers per photon on first request
 * - Provides pub/sub, locks, scheduled jobs, and webhooks
 */

import * as net from 'net';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { SessionManager } from './session-manager.js';
import {
  DaemonRequest,
  DaemonResponse,
  isValidDaemonRequest,
  type ScheduledJob,
  type LockInfo,
} from './protocol.js';
import {
  setPromptHandler,
  type PromptHandler,
  setBroker,
  touchBase,
  getPhotonSchedulesDir,
  getPhotonStateLogPath,
  listActiveBases,
  pruneBasesRegistry,
} from '@portel/photon-core';
import type {
  ChannelBroker,
  ChannelMessage,
  ChannelHandler,
  Subscription,
} from '@portel/photon-core';
import { getDefaultContext } from '../context.js';
import { createLogger, Logger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { timingSafeEqual, readBody, SimpleRateLimiter } from '../shared/security.js';
import { audit } from '../shared/audit.js';
import {
  recordExecution,
  previewResult,
  readExecutionHistory,
  sweepAllBases as sweepExecutionHistoryBases,
  type ExecutionStatus,
} from './execution-history.js';
import { WorkerManager } from './worker-manager.js';
import fastJsonPatch, { type Operation } from 'fast-json-patch';
import {
  getOwnerFilePath,
  isPidAlive,
  readOwnerRecord,
  removeOwnerRecord,
  waitForPidExit,
  writeOwnerRecord,
} from './ownership.js';
// eslint-disable-next-line @typescript-eslint/unbound-method
const jsonPatchCompare = fastJsonPatch.compare;

// Command line args: socketPath (global daemon only needs socket path)
const socketPath = process.argv[2];

const logger: Logger = createLogger({
  component: 'daemon-server',
  scope: 'global',
  minimal: true,
});

if (!socketPath) {
  logger.error('Missing required argument: socketPath');
  process.exit(1);
}

const pidFile = path.join(path.dirname(socketPath), 'daemon.pid');
const ownerFile = getOwnerFilePath(socketPath);
let daemonOwnershipConfirmed = false;

async function isSocketResponsive(target: string): Promise<boolean> {
  if (process.platform === 'win32' || !fs.existsSync(target)) return false;
  return new Promise((resolve) => {
    const client = net.createConnection(target);
    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 1000);
    client.on('connect', () => {
      clearTimeout(timer);
      client.destroy();
      resolve(true);
    });
    client.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// IN-PROCESS BROKER
// All photons run inside the daemon process, so pub/sub is just in-memory dispatch.
// This replaces the DaemonBroker (which connects via Unix socket to per-photon daemons
// that no longer exist in the global daemon model).
// ════════════════════════════════════════════════════════════════════════════════

class InProcessBroker implements ChannelBroker {
  readonly type = 'in-process';
  private handlers = new Map<string, Set<ChannelHandler>>();

  async publish(message: ChannelMessage): Promise<void> {
    const channel = message.channel;

    // Always forward to daemon socket subscribers (MCP servers, Beam SSE, etc.)
    // This ensures events emitted outside of tool execution context (e.g., from
    // polling loops, timers, event handlers) still reach cross-process subscribers.
    publishToChannel(channel, message);

    const handlers = this.handlers.get(channel);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        handler(message);
      } catch (err) {
        logger.warn('In-process broker handler error', {
          channel,
          error: getErrorMessage(err),
        });
      }
    }
  }

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    handlers.add(handler);

    logger.info('In-process subscription', { channel, subscribers: handlers.size });

    return {
      channel,
      active: true,
      unsubscribe: () => {
        handlers.delete(handler);
        if (handlers.size === 0) this.handlers.delete(channel);
      },
    };
  }

  isConnected(): boolean {
    return true;
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.handlers.clear();
  }
}

// Set the in-process broker so all photons use it for pub/sub
const inProcessBroker = new InProcessBroker();
setBroker(inProcessBroker);

// Worker manager for @worker-tagged photons (isolated in worker threads)
const workerManager = new WorkerManager(logger);

// Wire worker manager pub/sub bridge to main broker
workerManager.onPublish = (channel, message) => {
  void inProcessBroker.publish(message as any);
  // Also forward to other workers
  workerManager.dispatchToWorkers(channel, message);
};

// Track connected sockets for graceful shutdown broadcast
const connectedSockets = new Set<net.Socket>();
/** Reference to the daemon server for closing the listener during shutdown */
let daemonServer: net.Server | null = null;
/** Whether the daemon is shutting down (reject new commands) */
let isShuttingDown = false;

// ════════════════════════════════════════════════════════════════════════════════
// IN-FLIGHT EXECUTION TRACKING (for drain before hot-reload)
// ════════════════════════════════════════════════════════════════════════════════

interface ExecutionTracker {
  count: number;
  /** Resolve function for the drain promise (set when reload is waiting) */
  drainResolve?: () => void;
}

/** Tracks active executeTool calls per composite key */
const activeExecutions = new Map<string, ExecutionTracker>();

/** Per-key mutex to prevent concurrent reloads (format-on-save race) */
const reloadMutex = new Map<string, Promise<any>>();

function trackExecution(key: string): void {
  const tracker = activeExecutions.get(key);
  if (tracker) {
    tracker.count++;
  } else {
    activeExecutions.set(key, { count: 1 });
  }
}

function untrackExecution(key: string): void {
  const tracker = activeExecutions.get(key);
  if (!tracker) return;
  tracker.count--;
  if (tracker.count <= 0 && tracker.drainResolve) {
    tracker.drainResolve();
    tracker.drainResolve = undefined;
  }
  if (tracker.count <= 0) {
    activeExecutions.delete(key);
  }
}

// Map of compositeKey -> SessionManager (lazy initialized)
const sessionManagers = new Map<string, SessionManager>();
const photonPaths = new Map<string, string>(); // compositeKey -> photonPath
const workingDirs = new Map<string, string>(); // compositeKey -> workingDir
const fileWatchers = new Map<string, SafeWatcher>();
const watchDebounce = new Map<string, NodeJS.Timeout>();

// Source-stat gate (prototype — see docs/internals/STAT-GATE.md when landed):
// compositeKey → last observed stat of the photon's source file. Used by
// the stat-gate check right before dispatch to detect edits that the file
// watcher hasn't processed yet. Closes the race window where a request
// arrives between a file write and the watcher's debounce event.
interface PhotonSourceStat {
  mtimeMs: number;
  size: number;
  ino: number;
}
const photonSourceStats = new Map<string, PhotonSourceStat>();

/** Snapshot the stat fields we use as change signal. Null on ENOENT etc. */
function statOrNull(filePath: string): PhotonSourceStat | null {
  try {
    const s = fs.statSync(filePath);
    return { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
  } catch {
    return null;
  }
}

/** Record the current stat for a photon after a successful load or reload. */
function recordPhotonSourceStat(key: string, photonPath: string | undefined): void {
  if (!photonPath) return;
  const s = statOrNull(photonPath);
  if (s) photonSourceStats.set(key, s);
}

/**
 * Compare the current file stat against the last-recorded stat. If the
 * file has changed since the cached photon was loaded, trigger a
 * synchronous reload before returning. On any error (missing file,
 * reload failure), the call returns without throwing so dispatch can
 * surface a richer error downstream.
 */
async function statGate(
  key: string,
  photonName: string,
  photonPath: string | undefined,
  workingDir: string | undefined
): Promise<void> {
  if (!photonPath) return;
  const cached = photonSourceStats.get(key);
  if (!cached) {
    // No baseline yet — record what's there now and let this request run on
    // the current (just-loaded) instance.
    recordPhotonSourceStat(key, photonPath);
    return;
  }
  const current = statOrNull(photonPath);
  if (!current) return;
  if (
    current.mtimeMs === cached.mtimeMs &&
    current.size === cached.size &&
    current.ino === cached.ino
  ) {
    return;
  }
  logger.info('stat-gate: source changed since last load, syncing reload', {
    photon: photonName,
    path: photonPath,
    prevMtime: cached.mtimeMs,
    newMtime: current.mtimeMs,
  });
  try {
    const result = await reloadPhoton(photonName, photonPath, workingDir);
    if (result.success) {
      photonSourceStats.set(key, current);
    }
  } catch (err) {
    logger.warn('stat-gate: reload failed — continuing with stale instance', {
      photon: photonName,
      error: getErrorMessage(err),
    });
  }
}
// parentDir -> SafeWatcher: one watcher per unique parent directory
const parentDirWatchers = new Map<string, SafeWatcher>();
// workingDir -> inode: recorded at watch time for rename-vs-delete detection
const workingDirInodes = new Map<string, number>();
// workingDir -> SafeWatcher: watches {workingDir}/state/ for photon subdir deletions
const stateDirWatchers = new Map<string, SafeWatcher>();

/**
 * Create a composite key from photonName + workingDir for map lookups.
 * When workingDir is the default (~/.photon), returns just the photonName
 * for backwards compatibility.
 */
function compositeKey(photonName: string, workingDir?: string): string {
  if (!workingDir || workingDir === getDefaultContext().baseDir) return photonName;
  const dirHash = crypto.createHash('sha256').update(workingDir).digest('hex').slice(0, 8);
  return `${photonName}:${dirHash}`;
}

/**
 * Determine if a photon should run in a worker thread.
 *
 * Auto-detect: photons with both onShutdown + onInitialize lifecycle methods
 * manage their own resources (sockets, auth sessions) and benefit from isolation.
 *
 * Explicit: @worker forces worker mode, @noworker forces in-process mode.
 */
function shouldRunInWorker(photonPath: string): boolean {
  try {
    const source = fs.readFileSync(photonPath, 'utf-8');

    // Check class-level JSDoc for explicit tags
    const classDocMatch = source.match(/\/\*\*[\s\S]*?\*\/\s*(?:export\s+)?(?:default\s+)?class\s/);
    if (classDocMatch) {
      const docblock = classDocMatch[0];
      if (/@noworker\b/.test(docblock)) return false; // Explicit opt-out
      if (/@worker\b/.test(docblock)) return true; // Explicit opt-in
    }

    // Auto-detect: has both lifecycle hooks → likely manages runtime resources
    const hasOnShutdown = /\bonShutdown\s*\(/.test(source);
    const hasOnInitialize = /\bonInitialize\s*\(/.test(source);
    return hasOnShutdown && hasOnInitialize;
  } catch {
    return false;
  }
}

let idleTimeout = 0; // Daemon stays alive — it manages persistent stateful data
let idleTimer: NodeJS.Timeout | null = null;

// Track pending prompts waiting for user input
const pendingPrompts = new Map<
  string,
  {
    resolve: (value: string | boolean | null) => void;
    reject: (error: Error) => void;
  }
>();

// Channel subscriptions for pub/sub
const channelSubscriptions = new Map<string, Set<net.Socket>>();

// ════════════════════════════════════════════════════════════════════════════════
// EVENT BUFFER FOR REPLAY (Reliable Real-time Sync)
// ════════════════════════════════════════════════════════════════════════════════

interface BufferedEvent {
  /** Timestamp-based ID (Date.now()) — no sequential generation needed */
  id: number;
  channel: string;
  message: unknown;
  timestamp: number;
}

interface ChannelBuffer {
  events: BufferedEvent[];
}

/** Buffer retention window — events older than this are purged */
const EVENT_BUFFER_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const channelEventBuffers = new Map<string, ChannelBuffer>();

function bufferEvent(channel: string, message: unknown): number {
  let buffer = channelEventBuffers.get(channel);
  if (!buffer) {
    buffer = { events: [] };
    channelEventBuffers.set(channel, buffer);
  }

  const now = Date.now();
  const event: BufferedEvent = {
    id: now,
    channel,
    message,
    timestamp: now,
  };

  buffer.events.push(event);

  // Purge events older than retention window using findIndex + splice (O(1) amortized)
  // instead of repeated shift() which is O(n) per call
  const cutoff = now - EVENT_BUFFER_DURATION_MS;
  if (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff) {
    const firstValid = buffer.events.findIndex((e) => e.timestamp >= cutoff);
    if (firstValid === -1) {
      buffer.events.length = 0;
    } else if (firstValid > 0) {
      buffer.events.splice(0, firstValid);
    }
  }

  return now;
}

function getEventsSince(
  channel: string,
  lastTimestamp: number
): { events: BufferedEvent[]; refreshNeeded: boolean } {
  const buffer = channelEventBuffers.get(channel);

  if (!buffer || buffer.events.length === 0) {
    // If client has a lastEventId but buffer is empty (e.g. daemon restarted),
    // signal that a full refresh is needed — events were lost.
    return { events: [], refreshNeeded: lastTimestamp > 0 };
  }

  const oldestEvent = buffer.events[0];

  // Client's last timestamp is older than our oldest buffered event → stale, full sync needed
  if (lastTimestamp < oldestEvent.timestamp) {
    return { events: [], refreshNeeded: true };
  }

  // Delta sync: return events after the client's last timestamp
  const events = buffer.events.filter((e) => e.timestamp > lastTimestamp);
  return { events, refreshNeeded: false };
}

// ════════════════════════════════════════════════════════════════════════════════
// DISTRIBUTED LOCKS
// ════════════════════════════════════════════════════════════════════════════════

const activeLocks = new Map<string, LockInfo>();
const DEFAULT_LOCK_TIMEOUT = 30000;

function acquireLock(
  lockName: string,
  holder: string,
  timeout: number = DEFAULT_LOCK_TIMEOUT
): boolean {
  const now = Date.now();
  const existing = activeLocks.get(lockName);

  if (existing && existing.expiresAt > now) {
    if (existing.holder !== holder) {
      return false;
    }
    existing.expiresAt = now + timeout;
    return true;
  }

  activeLocks.set(lockName, {
    name: lockName,
    holder,
    acquiredAt: now,
    expiresAt: now + timeout,
  });

  logger.info('Lock acquired', { lockName, holder, timeout });
  return true;
}

function releaseLock(lockName: string, holder: string): boolean {
  const existing = activeLocks.get(lockName);
  if (!existing) return true;
  if (existing.holder !== holder) return false;

  activeLocks.delete(lockName);
  logger.info('Lock released', { lockName, holder });
  return true;
}

function cleanupExpiredLocks(): void {
  const now = Date.now();
  for (const [name, lock] of activeLocks.entries()) {
    if (lock.expiresAt <= now) {
      activeLocks.delete(name);
      logger.info('Lock expired', { lockName: name, holder: lock.holder });
    }
  }
}

/**
 * Periodic cleanup of in-memory maps that can grow unbounded.
 * Runs every 60s — lightweight scan, no I/O.
 */
function cleanupStaleMaps(): void {
  const now = Date.now();
  const cutoff = now - EVENT_BUFFER_DURATION_MS;

  // Remove channel buffers whose events are all expired (channel went quiet)
  for (const [channel, buffer] of channelEventBuffers.entries()) {
    if (buffer.events.length === 0 || buffer.events[buffer.events.length - 1].timestamp < cutoff) {
      channelEventBuffers.delete(channel);
    }
  }

  // Remove empty channel subscription sets and prune destroyed sockets
  for (const [channel, subs] of channelSubscriptions.entries()) {
    for (const socket of [...subs]) {
      if (socket.destroyed) subs.delete(socket);
    }
    if (subs.size === 0) channelSubscriptions.delete(channel);
  }

  // Prune socketPromptIds for destroyed sockets (safety net)
  for (const [socket, ids] of socketPromptIds.entries()) {
    if (socket.destroyed) {
      for (const id of ids) {
        const pending = pendingPrompts.get(id);
        if (pending) {
          pending.resolve(null);
          pendingPrompts.delete(id);
        }
      }
      socketPromptIds.delete(socket);
    }
  }
}

const lockCleanupInterval = setInterval(cleanupExpiredLocks, 10000);
const staleMapCleanupInterval = setInterval(cleanupStaleMaps, 60000);
lockCleanupInterval.unref();
staleMapCleanupInterval.unref();

// ════════════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ════════════════════════════════════════════════════════════════════════════════

const scheduledJobs = new Map<
  string,
  ScheduledJob & { photonName: string; workingDir?: string; photonPath?: string }
>();
const jobTimers = new Map<string, NodeJS.Timeout>();

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  // Comma-separated list
  if (field.includes(',')) {
    const values = new Set<number>();
    for (const part of field.split(',')) {
      const partValues = parseCronField(part, min, max);
      if (!partValues) return null;
      partValues.forEach((v) => values.add(v));
    }
    return Array.from(values).sort((a, b) => a - b);
  }
  // Step values: */n, start/n, start-end/n
  if (field.includes('/')) {
    const slashIdx = field.indexOf('/');
    const range = field.slice(0, slashIdx);
    const step = parseInt(field.slice(slashIdx + 1));
    if (isNaN(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (range !== '*') {
      if (range.includes('-')) {
        const [s, e] = range.split('-').map(Number);
        if (isNaN(s) || isNaN(e)) return null;
        start = s;
        end = e;
      } else {
        start = parseInt(range);
        if (isNaN(start)) return null;
      }
    }
    const values: number[] = [];
    for (let i = start; i <= end; i += step) values.push(i);
    return values;
  }
  // Range: n-m
  if (field.includes('-')) {
    const [s, e] = field.split('-').map(Number);
    if (isNaN(s) || isNaN(e) || s < min || e > max) return null;
    const values: number[] = [];
    for (let i = s; i <= e; i++) values.push(i);
    return values;
  }
  // Single value
  const value = parseInt(field);
  if (isNaN(value) || value < min || value > max) return null;
  return [value];
}

function parseCron(cron: string): { isValid: boolean; nextRun: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { isValid: false, nextRun: 0 };
  }

  const [minuteField, hourField, domField, monthField, dowField] = parts;

  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12); // cron months are 1-indexed
  const dows = parseCronField(dowField, 0, 7); // 0 and 7 both mean Sunday

  if (!minutes || !hours || !doms || !months || !dows) {
    return { isValid: false, nextRun: 0 };
  }

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(doms);
  const monthSet = new Set(months);
  // Normalize: 7 → 0 (both mean Sunday)
  const dowSet = new Set(dows.map((d) => (d === 7 ? 0 : d)));

  const domIsWild = domField === '*';
  const dowIsWild = dowField === '*';

  // Advance to next minute boundary from now
  const candidate = new Date();
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(candidate);
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate < limit) {
    // Check month (JS: 0-indexed, cron: 1-indexed)
    if (!monthSet.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(1);
      candidate.setHours(0);
      candidate.setMinutes(0);
      continue;
    }

    // Day check: if both dom and dow are non-wild, standard cron uses OR semantics
    let dayMatch: boolean;
    if (domIsWild && dowIsWild) {
      dayMatch = true;
    } else if (domIsWild) {
      dayMatch = dowSet.has(candidate.getDay());
    } else if (dowIsWild) {
      dayMatch = domSet.has(candidate.getDate());
    } else {
      dayMatch = domSet.has(candidate.getDate()) || dowSet.has(candidate.getDay());
    }

    if (!dayMatch) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0);
      candidate.setMinutes(0);
      continue;
    }

    // Check hour
    if (!hourSet.has(candidate.getHours())) {
      const nextHour = [...hourSet].find((h) => h > candidate.getHours());
      if (nextHour !== undefined) {
        candidate.setHours(nextHour);
        candidate.setMinutes(0);
      } else {
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(0);
        candidate.setMinutes(0);
      }
      continue;
    }

    // Check minute
    if (!minuteSet.has(candidate.getMinutes())) {
      const nextMinute = [...minuteSet].find((m) => m > candidate.getMinutes());
      if (nextMinute !== undefined) {
        candidate.setMinutes(nextMinute);
      } else {
        candidate.setHours(candidate.getHours() + 1);
        candidate.setMinutes(0);
      }
      continue;
    }

    return { isValid: true, nextRun: candidate.getTime() };
  }

  return { isValid: false, nextRun: 0 };
}

function scheduleJob(
  job: ScheduledJob & { photonName: string; workingDir?: string; photonPath?: string }
): boolean {
  const { isValid, nextRun } = parseCron(job.cron);
  if (!isValid) {
    logger.error('Invalid cron expression', { jobId: job.id, cron: job.cron });
    return false;
  }

  job.nextRun = nextRun;
  scheduledJobs.set(job.id, job);

  const existingTimer = jobTimers.get(job.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const delay = nextRun - Date.now();
  const timer = setTimeout(() => {
    void runJob(job.id);
  }, delay);
  jobTimers.set(job.id, timer);

  logger.info('Job scheduled', {
    jobId: job.id,
    method: job.method,
    photon: job.photonName,
    nextRun: new Date(nextRun).toISOString(),
  });
  return true;
}

async function runJob(jobId: string): Promise<void> {
  const job = scheduledJobs.get(jobId);
  if (!job) return;

  const key = compositeKey(job.photonName, job.workingDir);
  let sessionManager = sessionManagers.get(key);

  // Lazy-load: schedules registered proactively at boot carry the photon's
  // source path on the job, so we can spin up the session when the timer
  // fires rather than require the photon to be invoked manually first.
  if (!sessionManager && job.photonPath) {
    try {
      sessionManager =
        (await getOrCreateSessionManager(job.photonName, job.photonPath, job.workingDir)) ??
        undefined;
    } catch (err) {
      logger.warn('Lazy-load for scheduled job failed', {
        jobId,
        photon: job.photonName,
        error: getErrorMessage(err),
      });
    }
  }

  if (!sessionManager) {
    logger.warn('Cannot run job - photon not initialized', { jobId, photon: job.photonName });
    scheduleJob(job); // Reschedule anyway
    return;
  }

  logger.info('Running scheduled job', { jobId, method: job.method, photon: job.photonName });

  trackExecution(key);
  const startTs = Date.now();
  let status: ExecutionStatus = 'success';
  let errorMessage: string | undefined;
  let result: unknown;
  try {
    const session = await sessionManager.getOrCreateSession('scheduler', 'scheduler');
    result = await sessionManager.loader.executeTool(session.instance, job.method, job.args || {});

    job.lastRun = Date.now();
    job.runCount++;

    // Update persisted schedule file if this came from ScheduleProvider
    updatePersistedSchedule(jobId, job.photonName, {
      executionCount: job.runCount,
      lastExecutionAt: new Date().toISOString(),
    });

    publishToChannel(`jobs:${job.photonName}`, {
      event: 'job-completed',
      jobId,
      method: job.method,
      runCount: job.runCount,
    });

    logger.info('Job completed', { jobId, method: job.method, runCount: job.runCount });
  } catch (error) {
    status = 'error';
    errorMessage = getErrorMessage(error);
    logger.error('Job failed', { jobId, method: job.method, error: errorMessage });

    publishToChannel(`jobs:${job.photonName}`, {
      event: 'job-failed',
      jobId,
      method: job.method,
      error: errorMessage,
    });
  } finally {
    untrackExecution(key);
    recordExecution(
      job.photonName,
      {
        ts: Date.now(),
        jobId,
        method: job.method,
        durationMs: Date.now() - startTs,
        status,
        errorMessage,
        outputPreview: status === 'success' ? previewResult(result) : undefined,
      },
      job.workingDir
    );
  }

  scheduleJob(job);
}

function unscheduleJob(jobId: string): boolean {
  const timer = jobTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    jobTimers.delete(jobId);
  }

  const existed = scheduledJobs.delete(jobId);
  if (existed) {
    logger.info('Job unscheduled', { jobId });
  }
  return existed;
}

/**
 * Resolve the canonical schedules dir for a photon under the Option B
 * contract: {workingDir || default baseDir}/.data/{photonName}/schedules/.
 * Subdirectory namespaces are not yet threaded through the scheduled job
 * record; the flat-root common case is served here.
 */
function resolveScheduleDir(photonName: string, workingDir?: string): string {
  return getPhotonSchedulesDir('', photonName, workingDir || getDefaultContext().baseDir);
}

/**
 * Root of the legacy schedules tree (pre-Option-B layout).
 * Honors `PHOTON_SCHEDULES_DIR` only for the one-release deprecation
 * window; production code should rely on the per-PHOTON_DIR layout.
 */
let _schedulesEnvWarned = false;
function resolveLegacySchedulesRoot(): string {
  const override = process.env.PHOTON_SCHEDULES_DIR;
  if (override) {
    if (!_schedulesEnvWarned) {
      _schedulesEnvWarned = true;
      logger.warn(
        'PHOTON_SCHEDULES_DIR is deprecated and will be removed in the next minor release. ' +
          'Schedules now live under {PHOTON_DIR}/.data/{photon}/schedules/ per Option B.',
        { path: override }
      );
    }
    return override;
  }
  return path.join(os.homedir(), '.photon', 'schedules');
}

/**
 * Legacy schedules dir (pre-Option-B), read-only compatibility path.
 * Kept for the one-release transition window so schedules created before
 * this change continue to be discoverable.
 */
function resolveLegacyScheduleDir(photonName: string): string {
  return path.join(resolveLegacySchedulesRoot(), photonName.replace(/[^a-zA-Z0-9_-]/g, '_'));
}

/** Locate a persisted schedule file, preferring the new location. */
function findPersistedScheduleFile(
  photonName: string,
  taskId: string,
  workingDir?: string
): string | null {
  const newPath = path.join(resolveScheduleDir(photonName, workingDir), `${taskId}.json`);
  if (fs.existsSync(newPath)) return newPath;
  const legacyPath = path.join(resolveLegacyScheduleDir(photonName), `${taskId}.json`);
  if (fs.existsSync(legacyPath)) return legacyPath;
  return null;
}

/** Update persisted schedule file after job execution */
function updatePersistedSchedule(
  jobId: string,
  photonName: string,
  updates: { executionCount?: number; lastExecutionAt?: string }
): void {
  // Handle both ScheduleProvider jobs (photonName:sched:uuid) and IPC jobs (photonName:*:ipc:uuid)
  const schedMatch = jobId.match(/^[^:]+:sched:(.+)$/);
  const ipcMatch = jobId.match(/^[^:]+(?::[^:]+)?:ipc:(.+)$/);
  if (!schedMatch && !ipcMatch) return;
  const taskId = schedMatch ? schedMatch[1] : ipcMatch![1];

  const workingDir = scheduledJobs.get(jobId)?.workingDir;
  const filePath = findPersistedScheduleFile(photonName, taskId, workingDir);
  if (!filePath) return;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const task = JSON.parse(content);
    if (updates.executionCount !== undefined) task.executionCount = updates.executionCount;
    if (updates.lastExecutionAt !== undefined) task.lastExecutionAt = updates.lastExecutionAt;
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2));
  } catch {
    // File may have been removed — ignore
  }
}

/** Persist an IPC-created schedule job to disk for daemon restart recovery */
function persistIpcSchedule(
  job: ScheduledJob & { photonName: string; workingDir?: string; photonPath?: string }
): void {
  const schedulesDir = resolveScheduleDir(job.photonName, job.workingDir);

  try {
    fs.mkdirSync(schedulesDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Extract taskId from job ID (format: photonName:dirHash:ipc:taskId or photonName:ipc:taskId)
  const match = job.id.match(/:ipc:(.+)$/);
  const taskId = match ? match[1] : job.id;
  const filePath = path.join(schedulesDir, `${taskId}.json`);

  const persisted = {
    id: job.id,
    method: job.method,
    args: job.args || {},
    cron: job.cron,
    photonName: job.photonName,
    workingDir: job.workingDir,
    source: 'ipc',
    status: 'active',
    createdAt: new Date(job.createdAt).toISOString(),
    createdBy: job.createdBy,
    executionCount: job.runCount,
    lastExecutionAt: job.lastRun ? new Date(job.lastRun).toISOString() : null,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2));
    logger.debug('Persisted IPC schedule', { jobId: job.id, path: filePath });
  } catch (err) {
    logger.warn('Failed to persist IPC schedule', {
      jobId: job.id,
      error: getErrorMessage(err),
    });
  }
}

/** Delete a persisted IPC schedule file */
function deletePersistedIpcSchedule(jobId: string, photonName: string): void {
  const match = jobId.match(/:ipc:(.+)$/);
  if (!match) return;
  const taskId = match[1];

  const workingDir = scheduledJobs.get(jobId)?.workingDir;
  const filePath = findPersistedScheduleFile(photonName, taskId, workingDir);
  if (!filePath) return;

  try {
    fs.unlinkSync(filePath);
    logger.debug('Deleted persisted IPC schedule', { jobId, path: filePath });
  } catch {
    // Ignore — file may already be gone
  }
}

/**
 * Process IPC schedule files from one photon's schedules directory.
 * Mutates loadedCount / skippedCount via the returned counters.
 */
function loadIpcSchedulesFromDir(
  schedulesPath: string,
  ttlMs: number
): { loaded: number; skipped: number } {
  let loaded = 0;
  let skipped = 0;
  let files: string[];
  try {
    files = fs.readdirSync(schedulesPath).filter((f) => f.endsWith('.json'));
  } catch {
    return { loaded, skipped };
  }

  for (const file of files) {
    const filePath = path.join(schedulesPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const task = JSON.parse(content);

      // Skip non-IPC jobs (ScheduleProvider handles its own)
      if (task.source !== 'ipc') continue;

      // Validate required fields
      if (!task.id || !task.method || !task.cron || !task.photonName) {
        logger.warn('Skipping invalid persisted schedule', { file: filePath });
        skipped++;
        continue;
      }

      // TTL check: skip jobs not executed in 30+ days
      const lastExec = task.lastExecutionAt ? new Date(task.lastExecutionAt).getTime() : 0;
      const created = task.createdAt ? new Date(task.createdAt).getTime() : 0;
      const lastActivity = Math.max(lastExec, created);
      if (lastActivity > 0 && Date.now() - lastActivity > ttlMs) {
        logger.info('Removing expired schedule (TTL)', {
          jobId: task.id,
          lastActivity: new Date(lastActivity).toISOString(),
        });
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
        skipped++;
        continue;
      }

      // Skip if already registered (another source may have loaded it)
      if (scheduledJobs.has(task.id)) continue;

      const job: ScheduledJob & { photonName: string; workingDir?: string; photonPath?: string } = {
        id: task.id,
        method: task.method,
        args: task.args || {},
        cron: task.cron,
        runCount: task.executionCount || 0,
        createdAt: created || Date.now(),
        createdBy: task.createdBy,
        photonName: task.photonName,
        workingDir: task.workingDir,
      };

      if (scheduleJob(job)) {
        loaded++;
      } else {
        logger.warn('Failed to schedule persisted job (invalid cron?)', { jobId: task.id });
        skipped++;
      }
    } catch (err) {
      logger.warn('Failed to load persisted schedule file', {
        file: filePath,
        error: getErrorMessage(err),
      });
      skipped++;
    }
  }

  return { loaded, skipped };
}

/**
 * One-time sweep of legacy IPC schedules from ~/.photon/schedules/ to the
 * new per-base location. Only moves files that carry a `workingDir` field
 * (IPC-originated schedules have this); ScheduleProvider-originated files
 * that lack `workingDir` are left in place and continue to be read via the
 * legacy fallback in autoRegisterFromMetadata until the photon that owns
 * them runs under the new layout and regenerates them.
 *
 * Idempotent: files already moved are no longer at the legacy path, so the
 * next startup is a no-op for them. Called before loadAllPersistedSchedules.
 */
function migrateLegacyIpcSchedules(): void {
  const legacyRoot = resolveLegacySchedulesRoot();
  if (!fs.existsSync(legacyRoot)) return;

  let moved = 0;
  let kept = 0;
  let photonDirs: fs.Dirent[];
  try {
    photonDirs = fs.readdirSync(legacyRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dir of photonDirs) {
    if (!dir.isDirectory()) continue;
    const photonLegacyDir = path.join(legacyRoot, dir.name);
    let files: string[];
    try {
      files = fs.readdirSync(photonLegacyDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      const legacyPath = path.join(photonLegacyDir, file);
      try {
        const content = fs.readFileSync(legacyPath, 'utf-8');
        const task = JSON.parse(content);
        // Only migrate IPC-sourced files with a known working dir.
        if (task.source !== 'ipc' || !task.workingDir || typeof task.workingDir !== 'string') {
          kept++;
          continue;
        }
        const destDir = resolveScheduleDir(task.photonName || dir.name, task.workingDir);
        const destPath = path.join(destDir, file);
        // Skip if the destination already has content (e.g. a previous partial
        // migration succeeded); don't overwrite.
        if (fs.existsSync(destPath)) {
          kept++;
          continue;
        }
        fs.mkdirSync(destDir, { recursive: true });
        fs.renameSync(legacyPath, destPath);
        moved++;
      } catch {
        kept++;
      }
    }

    // If the legacy photon dir is now empty, remove it to keep the tree tidy.
    try {
      if (fs.readdirSync(photonLegacyDir).length === 0) {
        fs.rmdirSync(photonLegacyDir);
      }
    } catch {
      // Non-fatal
    }
  }

  if (moved > 0) {
    logger.info('Migrated legacy IPC schedules to per-base location', { moved, kept });
  }
}

/**
 * Load all persisted IPC schedules from disk on daemon startup.
 *
 * Iterates every PHOTON_DIR recorded in the bases registry (`listActiveBases`)
 * and scans each base's `{base}/.data/<photon>/schedules/` for IPC schedule
 * records. Also scans the legacy flat dir (`~/.photon/schedules/` or
 * `PHOTON_SCHEDULES_DIR`) for backwards compatibility with schedules that
 * haven't yet been migrated.
 */
function loadAllPersistedSchedules(): void {
  const TTL_DAYS = 30;
  const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;
  let loadedCount = 0;
  let skippedCount = 0;

  const scannedDirs = new Set<string>();
  const scanFlatRoot = (root: string) => {
    if (!fs.existsSync(root)) return;
    let photonDirs: fs.Dirent[];
    try {
      photonDirs = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      logger.warn('Failed to scan schedules directory', {
        dir: root,
        error: getErrorMessage(err),
      });
      return;
    }
    for (const dir of photonDirs) {
      if (!dir.isDirectory()) continue;
      const schedulesPath = path.join(root, dir.name);
      if (scannedDirs.has(schedulesPath)) continue;
      scannedDirs.add(schedulesPath);
      const result = loadIpcSchedulesFromDir(schedulesPath, ttlMs);
      loadedCount += result.loaded;
      skippedCount += result.skipped;
    }
  };

  const scanBaseDataRoot = (baseDir: string) => {
    const dataRoot = path.join(baseDir, '.data');
    if (!fs.existsSync(dataRoot)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dataRoot, { withFileTypes: true });
    } catch (err) {
      logger.warn('Failed to scan base schedules', {
        base: baseDir,
        error: getErrorMessage(err),
      });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip reserved buckets (_global, _sessions, .cache, tasks, .migrated, etc.)
      if (entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === 'tasks') {
        continue;
      }
      const schedulesPath = path.join(dataRoot, entry.name, 'schedules');
      if (!fs.existsSync(schedulesPath)) continue;
      if (scannedDirs.has(schedulesPath)) continue;
      scannedDirs.add(schedulesPath);
      const result = loadIpcSchedulesFromDir(schedulesPath, ttlMs);
      loadedCount += result.loaded;
      skippedCount += result.skipped;
    }
  };

  // Scan every PHOTON_DIR we've ever served. Prune dead entries first so a
  // deleted project folder doesn't emit warnings each startup.
  const pruned = pruneBasesRegistry();
  if (pruned.length > 0) {
    logger.info('Pruned bases that no longer exist', {
      removed: pruned.map((b) => b.path),
    });
  }
  const bases = listActiveBases();
  // Always include the default base even if the registry hasn't recorded it yet.
  const defaultBase = getDefaultContext().baseDir;
  if (!bases.some((b) => b.path === path.resolve(defaultBase))) {
    scanBaseDataRoot(defaultBase);
  }
  for (const base of bases) {
    scanBaseDataRoot(base.path);
  }

  // Legacy location for schedules that predate the per-base layout.
  scanFlatRoot(resolveLegacySchedulesRoot());

  if (loadedCount > 0 || skippedCount > 0) {
    logger.info('Loaded persisted schedules', { loaded: loadedCount, skipped: skippedCount });
  }
}

/**
 * Boot-time discovery of `@scheduled` and `@webhook` tags across every
 * known PHOTON_DIR. Before this ran, scheduled methods on a photon that
 * had never been invoked would silently not fire, and webhook routes
 * were only registered on first invocation. Now both work from the
 * moment a photon file exists under a registered base.
 *
 * We never INSTANTIATE the photon here — only parse its source with
 * the schema extractor to read tag metadata. When the schedule's cron
 * fires (or a webhook request arrives), the daemon lazy-loads the
 * photon via the normal session-manager path.
 */
async function discoverProactiveMetadataAtBoot(): Promise<void> {
  const baseCandidates = new Set<string>();
  const defaultBase = path.resolve(getDefaultContext().baseDir);
  baseCandidates.add(defaultBase);
  for (const base of listActiveBases()) baseCandidates.add(base.path);

  let schedulesRegistered = 0;
  let webhooksRegistered = 0;
  let photonsScanned = 0;

  // Lazy import to keep daemon startup cheap for users with no bases.
  const core = await import('@portel/photon-core');
  const SchemaExtractor = (core as any).SchemaExtractor as new () => {
    extractAllFromSource(source: string): { tools: Array<Record<string, unknown>> };
  };

  for (const basePath of baseCandidates) {
    let photons: Awaited<ReturnType<typeof core.listPhotonFilesWithNamespace>>;
    try {
      photons = await core.listPhotonFilesWithNamespace(basePath);
    } catch (err) {
      logger.warn('Boot discovery: could not list photons in base', {
        base: basePath,
        error: getErrorMessage(err),
      });
      continue;
    }

    for (const p of photons) {
      photonsScanned++;
      try {
        const fsp = await import('fs/promises');
        const source = await fsp.readFile(p.filePath, 'utf-8');

        // Fast filter — only parse photons that actually declare a
        // proactive trigger. Keeps the boot cost close to one readFile
        // per photon for dirs full of regular photons.
        if (!/@(scheduled|cron|webhook)\b/.test(source) && !/\basync\s+handle[A-Z]/.test(source)) {
          continue;
        }

        const extractor = new SchemaExtractor();
        const meta = extractor.extractAllFromSource(source);

        const workingDir = basePath === defaultBase ? undefined : basePath;

        for (const rawTool of meta.tools) {
          const tool = rawTool as {
            name: string;
            scheduled?: string;
            webhook?: string | boolean;
          };

          // @scheduled: record the declaration. Timer registration is
          // gated on the per-base active-schedules file (two-step model).
          // syncActiveSchedulesAtBoot() does the actual scheduleJob().
          if (tool.scheduled) {
            declaredSchedules.set(declaredKey(p.name, tool.name), {
              photon: p.name,
              method: tool.name,
              cron: tool.scheduled,
              photonPath: p.filePath,
              workingDir,
            });
            schedulesRegistered++; // counts declarations, not active timers
          }

          // @webhook: register the route now; photon lazy-loads on request.
          // (Webhooks are passive until an external caller hits them, so
          // auto-register is safe. `photon ps disable` can drop a route.)
          if (tool.webhook !== undefined) {
            let routes = webhookRoutes.get(p.name);
            if (!routes) {
              routes = new Map();
              webhookRoutes.set(p.name, routes);
            }
            const routePath = typeof tool.webhook === 'string' ? tool.webhook : tool.name;
            routes.set(routePath, tool.name);
            webhooksRegistered++;
          }
        }

        // Record the source location under the photon name if any proactive
        // metadata was found, so runJob / the webhook handler can lazy-load.
        proactivePhotonLocations.set(p.name, {
          photonPath: p.filePath,
          workingDir,
        });
      } catch (err) {
        logger.warn('Boot discovery: failed to extract metadata', {
          photon: p.name,
          path: p.filePath,
          error: getErrorMessage(err),
        });
      }
    }
  }

  if (schedulesRegistered > 0 || webhooksRegistered > 0) {
    logger.info('Boot discovery complete', {
      photonsScanned,
      schedulesDeclared: schedulesRegistered,
      webhooksRegistered,
      bases: baseCandidates.size,
    });
  }
}

/**
 * Sync declared schedules against each base's active-schedules file.
 *
 * Two-step scheduling: declaring `@scheduled` doesn't activate. The user
 * must explicitly enroll a declaration via `photon ps enable`, which
 * writes to `{PHOTON_DIR}/.data/.active-schedules.json`. On boot we read
 * each base's active list and register cron timers only for those
 * entries.
 *
 * First-boot migration: for bases that have never gone through this
 * sync, every currently-declared `@scheduled` gets auto-enrolled so
 * existing behavior is preserved across the upgrade. The active file
 * records `migratedFromAutoRegister: true` so the auto-enroll is a
 * one-time event — subsequent boots respect user-chosen enrollment.
 */
function syncActiveSchedulesAtBoot(): void {
  const defaultBase = path.resolve(getDefaultContext().baseDir);
  const bases = new Set<string>([defaultBase]);
  for (const b of listActiveBases()) bases.add(b.path);

  let registered = 0;
  let missingRefs = 0;

  for (const basePath of bases) {
    const file = readActiveSchedulesFile(basePath);
    let dirty = false;

    // One-time migration: seed the active list from the current
    // declarations for this base so upgrade doesn't silently disable
    // previously-auto-registered schedules.
    if (!file.migratedFromAutoRegister) {
      const now = new Date().toISOString();
      for (const decl of declaredSchedules.values()) {
        const declBase = decl.workingDir ? path.resolve(decl.workingDir) : defaultBase;
        if (declBase !== basePath) continue;
        const alreadyActive = file.active.some(
          (e) => e.photon === decl.photon && e.method === decl.method
        );
        if (!alreadyActive) {
          file.active.push({
            photon: decl.photon,
            method: decl.method,
            enabledAt: now,
            enabledBy: 'auto-migrate',
          });
          dirty = true;
        }
      }
      file.migratedFromAutoRegister = true;
      dirty = true;
    }

    if (dirty) {
      try {
        writeActiveSchedulesFile(basePath, file);
      } catch (err) {
        logger.warn('Could not write active-schedules file', {
          base: basePath,
          error: getErrorMessage(err),
        });
      }
    }

    // Register timers for active (non-paused) entries.
    for (const entry of file.active) {
      if (entry.paused) continue;
      const key = declaredKey(entry.photon, entry.method);
      const decl = declaredSchedules.get(key);
      if (!decl) {
        missingRefs++;
        logger.warn('Active schedule references a declaration that no longer exists', {
          base: basePath,
          photon: entry.photon,
          method: entry.method,
          hint: '`photon ps disable` to remove or add the @scheduled tag back',
        });
        continue;
      }
      if (scheduledJobs.has(key)) continue;
      const ok = scheduleJob({
        id: key,
        method: decl.method,
        args: {},
        cron: decl.cron,
        runCount: 0,
        createdAt: Date.now(),
        createdBy: 'active-list',
        photonName: decl.photon,
        workingDir: decl.workingDir,
        photonPath: decl.photonPath,
      });
      if (ok) registered++;
    }
  }

  if (registered > 0 || missingRefs > 0) {
    logger.info('Active schedules synced', {
      registered,
      declared: declaredSchedules.size,
      missingRefs,
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// WEBHOOK HTTP SERVER
// ════════════════════════════════════════════════════════════════════════════════

let webhookServer: http.Server | null = null;
const WEBHOOK_PORT = parseInt(process.env.PHOTON_WEBHOOK_PORT || '0');

// Security: rate limiter for webhook endpoint. Default 60/min per source IP;
// override via PHOTON_WEBHOOK_RATE_LIMIT / PHOTON_WEBHOOK_RATE_WINDOW_MS.
const WEBHOOK_RATE_LIMIT = Math.max(
  1,
  parseInt(process.env.PHOTON_WEBHOOK_RATE_LIMIT || '60', 10) || 60
);
const WEBHOOK_RATE_WINDOW_MS = Math.max(
  1_000,
  parseInt(process.env.PHOTON_WEBHOOK_RATE_WINDOW_MS || '60000', 10) || 60_000
);
const webhookRateLimiter = new SimpleRateLimiter(WEBHOOK_RATE_LIMIT, WEBHOOK_RATE_WINDOW_MS);

function startWebhookServer(port: number): void {
  if (port <= 0) return;

  webhookServer = http.createServer((req, res) => {
    void (async () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Webhook-Secret, X-Photon-Name'
      );

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Security: rate limiting
      const clientKey = req.socket?.remoteAddress || 'unknown';
      if (!webhookRateLimiter.isAllowed(clientKey)) {
        const retryAfter = Math.ceil(WEBHOOK_RATE_WINDOW_MS / 1000);
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        });
        res.end(
          JSON.stringify({
            error: 'Too many requests',
            limit: WEBHOOK_RATE_LIMIT,
            windowMs: WEBHOOK_RATE_WINDOW_MS,
          })
        );
        return;
      }

      // Parse URL: /webhook/{photonName}/{method}
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (pathParts[0] !== 'webhook' || !pathParts[1] || !pathParts[2]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /webhook/{photonName}/{method}' }));
        return;
      }

      const photonName = pathParts[1];
      const method = pathParts[2];

      const expectedSecret = process.env.PHOTON_WEBHOOK_SECRET;
      if (expectedSecret) {
        const providedSecret = req.headers['x-webhook-secret'];
        if (
          !providedSecret ||
          typeof providedSecret !== 'string' ||
          !timingSafeEqual(providedSecret, expectedSecret)
        ) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid webhook secret' }));
          return;
        }
      } else if (!process.env.PHOTON_WEBHOOK_ALLOW_UNAUTHENTICATED) {
        // Security: require explicit opt-in for unauthenticated webhooks
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'Webhook secret not configured. Set PHOTON_WEBHOOK_SECRET or PHOTON_WEBHOOK_ALLOW_UNAUTHENTICATED=true',
          })
        );
        return;
      }

      let args: Record<string, unknown> = {};

      try {
        const body = await readBody(req);
        if (body) {
          args = JSON.parse(body);
        }
        args._webhook = {
          method: req.method,
          headers: req.headers,
          query: Object.fromEntries(url.searchParams),
          timestamp: Date.now(),
        };
      } catch (err: any) {
        const status = err.message?.includes('too large') ? 413 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: status === 413 ? 'Request body too large' : 'Invalid JSON body' })
        );
        return;
      }

      let sessionManager = sessionManagers.get(photonName);
      // Lazy-load: if a @webhook route was registered proactively at boot
      // (photon discovered in a known base but never invoked), spin up
      // the session now rather than return 503 to the caller.
      if (!sessionManager) {
        const loc = proactivePhotonLocations.get(photonName);
        if (loc) {
          try {
            sessionManager =
              (await getOrCreateSessionManager(photonName, loc.photonPath, loc.workingDir)) ??
              undefined;
          } catch (err) {
            logger.warn('Lazy-load for webhook request failed', {
              photon: photonName,
              error: getErrorMessage(err),
            });
          }
        }
      }
      if (!sessionManager) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Photon '${photonName}' not initialized` }));
        return;
      }

      // Resolve method from webhook route map (if routes are registered)
      let resolvedMethod = method;
      const routes = webhookRoutes.get(photonName);
      if (routes && routes.size > 0) {
        // Only allow methods that have @webhook tag
        const mapped = routes.get(method);
        if (!mapped) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `No webhook route '${method}' on photon '${photonName}'`,
              availableRoutes: [...routes.keys()],
            })
          );
          return;
        }
        resolvedMethod = mapped;
      }

      const webhookKey = compositeKey(photonName);
      trackExecution(webhookKey);
      try {
        const session = await sessionManager.getOrCreateSession('webhook', 'webhook');
        const result = await sessionManager.loader.executeTool(
          session.instance,
          resolvedMethod,
          args
        );

        logger.info('Webhook executed', { photon: photonName, method });

        publishToChannel(`webhooks:${photonName}`, {
          event: 'webhook-received',
          method,
          timestamp: Date.now(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (error) {
        logger.error('Webhook execution failed', {
          photon: photonName,
          method,
          error: getErrorMessage(error),
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: getErrorMessage(error) }));
      } finally {
        untrackExecution(webhookKey);
      }
    })();
  });

  webhookServer.listen(port, () => {
    logger.info('Webhook server started', { port });
  });

  webhookServer.on('error', (error: any) => {
    logger.error('Webhook server error', { error: getErrorMessage(error) });
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// PUB/SUB
// ════════════════════════════════════════════════════════════════════════════════

/** Track which socket owns which pending prompts, for cleanup on disconnect */
const socketPromptIds = new Map<net.Socket, Set<string>>();

function cleanupSocketSubscriptions(socket: net.Socket): void {
  for (const [channel, subs] of channelSubscriptions.entries()) {
    subs.delete(socket);
    if (subs.size === 0) {
      channelSubscriptions.delete(channel);
    }
  }

  // Reject and clean up any pending prompts owned by this socket
  const promptIds = socketPromptIds.get(socket);
  if (promptIds) {
    for (const id of promptIds) {
      const pending = pendingPrompts.get(id);
      if (pending) {
        pending.resolve(null); // Resolve with null (cancel) rather than reject
        pendingPrompts.delete(id);
      }
    }
    socketPromptIds.delete(socket);
  }
}

function publishToChannel(channel: string, message: unknown, excludeSocket?: net.Socket): number {
  // Buffer the event for replay
  const eventId = bufferEvent(channel, message);

  const payload =
    JSON.stringify({
      type: 'channel_message',
      id: `ch_${eventId}`,
      eventId,
      channel,
      message,
    }) + '\n';

  const sentSockets = new Set<net.Socket>();

  // Send to exact channel subscribers
  const exactSubscribers = channelSubscriptions.get(channel);
  if (exactSubscribers) {
    for (const socket of [...exactSubscribers]) {
      if (socket !== excludeSocket && !socket.destroyed && !sentSockets.has(socket)) {
        try {
          socket.write(payload);
          sentSockets.add(socket);
        } catch {
          // Dead socket — remove from subscribers
          exactSubscribers.delete(socket);
        }
      }
    }
  }

  // Send to wildcard subscribers
  const channelPrefix = channel.split(':')[0];
  if (channelPrefix) {
    const wildcardChannel = `${channelPrefix}:*`;
    const wildcardSubscribers = channelSubscriptions.get(wildcardChannel);
    if (wildcardSubscribers) {
      for (const socket of [...wildcardSubscribers]) {
        if (socket !== excludeSocket && !socket.destroyed && !sentSockets.has(socket)) {
          try {
            socket.write(payload);
            sentSockets.add(socket);
          } catch {
            // Dead socket — remove from subscribers
            wildcardSubscribers.delete(socket);
          }
        }
      }
    }
  }

  logger.debug('Published to channel', {
    channel,
    eventId,
    exactSubs: exactSubscribers?.size || 0,
    wildcardSubs: channelSubscriptions.get(`${channelPrefix}:*`)?.size || 0,
  });

  return eventId;
}

// ════════════════════════════════════════════════════════════════════════════════
// SESSION MANAGER (Lazy Initialization)
// ════════════════════════════════════════════════════════════════════════════════

async function getOrCreateSessionManager(
  photonName: string,
  photonPath?: string,
  workingDir?: string
): Promise<SessionManager | null> {
  const key = compositeKey(photonName, workingDir);
  let manager = sessionManagers.get(key);

  if (manager) {
    return manager;
  }

  // Need photonPath to initialize
  const storedPath = photonPaths.get(key);
  const pathToUse = photonPath || storedPath;

  if (!pathToUse) {
    logger.warn('Cannot initialize photon - no path provided', { photonName, key });
    return null;
  }

  // Deduplicate: if another session manager already exists for the same resolved file path,
  // reuse it. This handles the case where the same photon is accessed by bare name (via @photon
  // dependency) and by full path (via CLI) — they should share one instance.
  try {
    const resolvedPath = fs.realpathSync(pathToUse);
    for (const [existingKey, existingManager] of sessionManagers) {
      if (existingKey === key) continue;
      const existingPath = photonPaths.get(existingKey);
      if (existingPath) {
        try {
          if (fs.realpathSync(existingPath) === resolvedPath) {
            logger.info('Deduplicating session manager — same photon file', {
              photonName,
              key,
              existingKey,
              resolvedPath,
            });
            sessionManagers.set(key, existingManager);
            photonPaths.set(key, pathToUse);
            return existingManager;
          }
        } catch {
          /* existingPath may not exist */
        }
      }
    }
  } catch {
    /* pathToUse may not exist yet */
  }

  // If @worker tagged, spawn in a worker thread instead of in-process
  if (shouldRunInWorker(pathToUse) && !workerManager.has(key)) {
    try {
      // Wire dep resolver BEFORE spawn so the worker can resolve @photon deps
      // during initialization (loadFile triggers dep resolution before 'ready').
      if (!workerManager.depResolver) {
        workerManager.depResolver = async (depName, depPath, _consumerPhoton) => {
          const depManager = await getOrCreateSessionManager(depName, depPath, workingDir);
          if (!depManager) return null;
          const loaded = await depManager.getOrLoadInstance('');
          const toolNames = (loaded?.tools || []).map((t: any) => t.name as string);
          return { toolNames };
        };
        workerManager.depCaller = async (depName, method, args) => {
          const depKey = compositeKey(depName, workingDir);
          const depManager = sessionManagers.get(depKey);
          if (!depManager) throw new Error(`Dependency ${depName} not loaded`);
          trackExecution(depKey);
          try {
            const loaded = await depManager.getOrLoadInstance('');
            return await depManager.loader.executeTool(loaded, method, args);
          } finally {
            untrackExecution(depKey);
          }
        };
      }

      logger.info('Spawning worker thread for @worker photon', { photonName, key });
      const info = await workerManager.spawn(key, photonName, pathToUse, workingDir);
      photonPaths.set(key, pathToUse);
      if (!photonPaths.has(photonName)) photonPaths.set(photonName, pathToUse);
      if (workingDir) workingDirs.set(key, workingDir);
      watchPhotonFile(photonName, pathToUse);

      // Return null — caller should check workerManager.has(key) for routing
      // We store a marker so callers know this is a worker photon
      logger.info('Worker photon ready', { photonName, tools: info.tools.length });
      return null;
    } catch (err) {
      logger.warn('Failed to spawn worker, falling back to in-process', {
        photonName,
        error: getErrorMessage(err),
      });
      // Fall through to in-process loading
    }
  }

  try {
    logger.info('Initializing session manager', {
      photonName,
      key,
      photonPath: pathToUse,
      workingDir,
      ownerPid: daemonOwnershipConfirmed ? process.pid : null,
    });

    manager = new SessionManager(
      pathToUse,
      photonName,
      idleTimeout,
      logger.child({ scope: photonName }),
      workingDir
    );

    // Wire @photon dependency resolver: when this photon's loader encounters
    // `@photon whatsapp ./whatsapp.photon.ts`, it asks the daemon for the shared
    // instance instead of creating a duplicate (avoids double WhatsApp sockets, etc.)
    manager.loader.photonInstanceResolver = async (
      depName: string,
      depPath: string,
      callerInstanceName?: string
    ) => {
      try {
        // Get or create the dependency's session manager (lazy initialization)
        const depManager = await getOrCreateSessionManager(depName, depPath, workingDir);
        if (!depManager) return null;

        // Load the instance — inherit caller's instance name for multi-tenancy
        // e.g. claw[arul] → whatsapp[arul], telegram[arul], courier[arul]
        const loaded = await depManager.getOrLoadInstance(callerInstanceName || '');
        if (loaded?.instance) {
          logger.info('Resolved @photon dep from shared daemon instance', {
            dep: depName,
            consumer: photonName,
            instance: callerInstanceName || 'default',
          });

          // Return a Proxy that lazily resolves the current instance on every access.
          // This survives hot-reload: when the daemon replaces the instance in the
          // session manager's map, the proxy automatically sees the new one.
          // Tool methods route through executeTool for the middleware pipeline.
          // Event methods (.on, .off) and other non-tool methods pass through directly.
          const toolNames = new Set((loaded.tools || []).map((t: any) => t.name));

          const depInstanceKey = callerInstanceName || undefined;
          return new Proxy({} as any, {
            get(_target: any, prop: string | symbol) {
              // Resolve the current instance from the session manager (survives hot-reload)
              const current = depManager.getCurrentInstance(depInstanceKey) ?? loaded;
              const instance = current.instance ?? loaded.instance;
              const value = Reflect.get(instance, prop);

              // Route tool methods through executeTool for middleware pipeline,
              // but always pass through event subscription methods — they take
              // positional args (event, handler, filter) which the single-params
              // wrapper would mangle.
              if (
                typeof prop === 'string' &&
                typeof value === 'function' &&
                toolNames.has(prop) &&
                prop !== 'on' &&
                prop !== 'off'
              ) {
                return async (params: any) => {
                  const depExecKey = compositeKey(depName, workingDir);
                  trackExecution(depExecKey);
                  try {
                    const latest = depManager.getCurrentInstance(depInstanceKey) ?? loaded;
                    return await depManager.loader.executeTool(latest, prop, params || {});
                  } finally {
                    untrackExecution(depExecKey);
                  }
                };
              }

              // Bind methods to current instance so `this` resolves correctly
              if (typeof value === 'function') {
                return value.bind(instance);
              }
              return value;
            },
          });
        }
      } catch (err) {
        logger.warn('Failed to resolve shared @photon instance, falling back to isolated load', {
          dep: depName,
          consumer: photonName,
          error: getErrorMessage(err),
        });
      }
      return null; // fall through to loader's own loading
    };

    // Wire this.instance(name) — same-photon cross-instance access.
    // Allows a photon to get another instance of itself in-process,
    // e.g. chat photon routing per-group instances.
    const mgr = manager;
    mgr.loader.instanceResolver = async (instanceName: string) => {
      const loaded = await mgr.getOrLoadInstance(instanceName);
      return loaded?.instance ?? null;
    };

    sessionManagers.set(key, manager);
    photonPaths.set(key, pathToUse);
    // Also store under bare photonName so snapshotState/persistInstanceState can find it
    if (!photonPaths.has(photonName)) {
      photonPaths.set(photonName, pathToUse);
    }
    // Baseline the stat-gate for this session so subsequent dispatches can
    // detect source edits the file watcher hasn't processed yet.
    recordPhotonSourceStat(key, pathToUse);

    // Record this PHOTON_DIR in the bases registry so future daemon startups
    // can scan it for schedules and other per-base data. See
    // docs/internals/PHOTON-DIR-AND-NAMESPACE.md §8.
    try {
      touchBase(workingDir || getDefaultContext().baseDir);
    } catch (err) {
      logger.warn('Failed to update bases registry', { error: getErrorMessage(err) });
    }
    if (workingDir) {
      workingDirs.set(key, workingDir);
      watchWorkingDir(workingDir);
      watchStateDir(workingDir);
    }
    watchPhotonFile(photonName, pathToUse);

    logger.info('Session manager initialized', { photonName, key });

    // Auto-register scheduled jobs and webhook routes from tool metadata
    // Do this lazily on first session creation
    void autoRegisterFromMetadata(key, manager);

    return manager;
  } catch (error) {
    logger.error('Failed to initialize session manager', {
      photonName,
      error: getErrorMessage(error),
    });
    return null;
  }
}

// Track which photons have had their metadata auto-registered
const autoRegistered = new Set<string>();
// Webhook route map: photonName → Set<allowed method names>
const webhookRoutes = new Map<string, Map<string, string>>();

/**
 * Photon source locations known to the daemon from boot-time discovery.
 * Populated by discoverProactiveMetadataAtBoot() so `runJob` and the
 * webhook handler can lazy-load a photon whose @scheduled or @webhook
 * tag was registered before the photon was ever invoked.
 *
 * Keyed by photon name (matching webhookRoutes' key). Value holds the
 * absolute source path and the PHOTON_DIR the photon was discovered in.
 */
interface ProactiveLocation {
  photonPath: string;
  workingDir?: string;
}
const proactivePhotonLocations = new Map<string, ProactiveLocation>();

/**
 * Declared-schedule registry (two-step scheduling).
 *
 * Boot discovery fills this with every `@scheduled` tag it finds in any
 * registered PHOTON_DIR. Presence here means "this method declares a
 * schedule"; it does NOT mean the cron timer is running. Activation is
 * gated by the per-base active-schedules file — see syncActiveSchedulesAtBoot().
 *
 * Keyed by `${photonName}:${methodName}` for O(1) lookup from both the
 * active-list sync and the `photon ps enable/disable` CLI.
 */
interface DeclaredSchedule {
  photon: string;
  method: string;
  cron: string;
  photonPath: string;
  workingDir?: string;
}
const declaredSchedules = new Map<string, DeclaredSchedule>();

function declaredKey(photon: string, method: string): string {
  return `${photon}:${method}`;
}

/** Entry shape in {PHOTON_DIR}/.data/.active-schedules.json */
interface ActiveScheduleEntry {
  photon: string;
  method: string;
  enabledAt: string;
  enabledBy: string;
  paused?: boolean;
}
interface ActiveSchedulesFile {
  version: 1;
  active: ActiveScheduleEntry[];
  /** One-time marker so the auto-migrate step only runs once per base. */
  migratedFromAutoRegister?: boolean;
}

function activeSchedulesPath(baseDir: string): string {
  return path.join(baseDir, '.data', '.active-schedules.json');
}

function readActiveSchedulesFile(baseDir: string): ActiveSchedulesFile {
  const file = activeSchedulesPath(baseDir);
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.active)) {
      return {
        version: 1,
        active: parsed.active.filter(
          (e: any) =>
            e &&
            typeof e.photon === 'string' &&
            typeof e.method === 'string' &&
            typeof e.enabledAt === 'string'
        ),
        migratedFromAutoRegister: !!parsed.migratedFromAutoRegister,
      };
    }
  } catch {
    // Missing or malformed — treated as empty.
  }
  return { version: 1, active: [] };
}

function writeActiveSchedulesFile(baseDir: string, data: ActiveSchedulesFile): void {
  const file = activeSchedulesPath(baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, version: 1 }, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Auto-register scheduled jobs and webhook routes from tool metadata.
 * Called once per photon on first session manager creation.
 */
async function autoRegisterFromMetadata(
  photonName: string,
  manager: SessionManager
): Promise<void> {
  if (autoRegistered.has(photonName)) return;
  autoRegistered.add(photonName);

  try {
    // Get a session to access the loaded photon's tools
    const session = await manager.getOrCreateSession('__autoregister', 'system');
    const tools: any[] = session.instance?.tools || [];

    // Auto-register @scheduled jobs
    for (const tool of tools) {
      if (tool.scheduled) {
        const jobId = `${photonName}:${tool.name}`;
        if (!scheduledJobs.has(jobId)) {
          const job = {
            id: jobId,
            method: tool.name,
            args: {},
            cron: tool.scheduled,
            runCount: 0,
            createdAt: Date.now(),
            createdBy: 'auto',
            photonName,
          };
          const ok = scheduleJob(job);
          if (ok) {
            logger.info('Auto-registered scheduled job from @scheduled tag', {
              jobId,
              method: tool.name,
              cron: tool.scheduled,
              photon: photonName,
            });
          }
        }
      }

      // Build webhook route map
      if (tool.webhook !== undefined) {
        let routes = webhookRoutes.get(photonName);
        if (!routes) {
          routes = new Map();
          webhookRoutes.set(photonName, routes);
        }
        // Custom path from @webhook <path>, or method name
        const routePath = typeof tool.webhook === 'string' ? tool.webhook : tool.name;
        routes.set(routePath, tool.name);
      }
    }

    if (webhookRoutes.has(photonName)) {
      const routes = webhookRoutes.get(photonName)!;
      logger.info('Auto-registered webhook routes from @webhook tags', {
        photon: photonName,
        routes: [...routes.keys()],
      });
    }

    // Load persisted schedule files created by this.schedule.create() at
    // runtime. Scan the new per-base location first, then the legacy
    // ~/.photon/schedules/ location for backwards compatibility.
    const workingDir = manager.loader?.baseDir;
    const schedulesDirs = [
      resolveScheduleDir(photonName, workingDir),
      resolveLegacyScheduleDir(photonName),
    ];
    for (const schedulesDir of schedulesDirs) {
      let scheduleFiles: string[];
      try {
        scheduleFiles = fs.readdirSync(schedulesDir).filter((f) => f.endsWith('.json'));
      } catch (err: any) {
        // ENOENT is fine — no schedules dir means no persisted schedules here
        if (err.code !== 'ENOENT') {
          logger.warn('Failed to load persisted schedules', {
            photon: photonName,
            dir: schedulesDir,
            error: getErrorMessage(err),
          });
        }
        continue;
      }
      for (const file of scheduleFiles) {
        try {
          const content = fs.readFileSync(path.join(schedulesDir, file), 'utf-8');
          const task = JSON.parse(content);
          if (task.status !== 'active') continue;
          const jobId = `${photonName}:sched:${task.id}`;
          if (scheduledJobs.has(jobId)) continue;

          const job = {
            id: jobId,
            method: task.method,
            args: task.params || {},
            cron: task.cron,
            runCount: task.executionCount || 0,
            createdAt: new Date(task.createdAt).getTime(),
            createdBy: 'schedule-provider',
            photonName,
          };
          const ok = scheduleJob(job);
          if (ok) {
            logger.info('Loaded persisted schedule', {
              jobId,
              name: task.name,
              method: task.method,
              cron: task.cron,
              photon: photonName,
            });
          }
        } catch {
          // Skip corrupt schedule files
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to auto-register metadata', {
      photon: photonName,
      error: getErrorMessage(error),
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PROMPT HANDLER
// ════════════════════════════════════════════════════════════════════════════════

function createSocketPromptHandler(socket: net.Socket, requestId: string): PromptHandler {
  return async (message: string, defaultValue?: string): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      pendingPrompts.set(requestId, {
        resolve: (value) => resolve(value as string | null),
        reject,
      });

      // Track this prompt against the socket for cleanup on disconnect
      let ids = socketPromptIds.get(socket);
      if (!ids) {
        ids = new Set();
        socketPromptIds.set(socket, ids);
      }
      ids.add(requestId);

      const promptResponse: DaemonResponse = {
        type: 'prompt',
        id: requestId,
        prompt: {
          type: 'text',
          message,
          default: defaultValue,
        },
      };

      socket.write(JSON.stringify(promptResponse) + '\n');
    });
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ════════════════════════════════════════════════════════════════════════════════

async function handleRequest(
  request: DaemonRequest,
  socket: net.Socket
): Promise<DaemonResponse | null> {
  resetIdleTimer();

  if (request.type === 'ping') {
    return { type: 'pong', id: request.id };
  }

  // Reject new commands during shutdown (allow ping for health checks)
  if (isShuttingDown && request.type !== 'shutdown') {
    return {
      type: 'error',
      id: request.id,
      error: 'Daemon is shutting down',
      suggestion: 'Retry after the daemon restarts',
    };
  }

  if (request.type === 'status') {
    let totalSessions = 0;
    for (const sm of sessionManagers.values()) {
      totalSessions += sm.getSessions().length;
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: {
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        sessions: totalSessions,
        subscriptions: channelSubscriptions.size,
        photonsLoaded: sessionManagers.size,
      },
    };
  }

  if (request.type === 'shutdown') {
    shutdown();
    return { type: 'result', id: request.id, success: true, data: { message: 'Shutting down' } };
  }

  // Handle clear_instances request (called by Beam on fresh workingDir startup)
  if (request.type === 'clear_instances') {
    const photonName = request.photonName;
    if (!photonName) {
      return { type: 'error', id: request.id, error: 'photonName required for clear_instances' };
    }
    const key = compositeKey(photonName, request.workingDir);
    const sessionManager = sessionManagers.get(key);
    if (sessionManager) {
      await sessionManager.clearInstances();
    }
    return { type: 'result', id: request.id, success: true, data: { cleared: !!sessionManager } };
  }

  // Handle hot-reload request
  if (request.type === 'reload') {
    const photonName = request.photonName;
    const photonPath = request.photonPath;

    if (!photonName || !photonPath) {
      return {
        type: 'error',
        id: request.id,
        error: 'photonName and photonPath required for reload',
      };
    }

    const result = await reloadPhoton(photonName, photonPath, request.workingDir);
    return {
      type: 'result',
      id: request.id,
      success: result.success,
      data: result.success
        ? { message: 'Reload complete', sessionsUpdated: result.sessionsUpdated }
        : { error: result.error },
    };
  }

  // Handle prompt response
  if (request.type === 'prompt_response') {
    const pending = pendingPrompts.get(request.id);
    if (pending) {
      pendingPrompts.delete(request.id);
      // Clean up socket prompt tracking
      if (socket) {
        const ids = socketPromptIds.get(socket);
        if (ids) {
          ids.delete(request.id);
          if (ids.size === 0) socketPromptIds.delete(socket);
        }
      }
      pending.resolve(request.promptValue ?? null);
    }
    return null;
  }

  // Handle channel subscribe
  if (request.type === 'subscribe') {
    const channel = request.channel!;
    const lastEventId = request.lastEventId;

    let subs = channelSubscriptions.get(channel);
    if (!subs) {
      subs = new Set();
      channelSubscriptions.set(channel, subs);
    }
    subs.add(socket);
    logger.info('Client subscribed to channel', { channel, subscribers: subs.size });

    // Replay missed events if lastEventId (timestamp) provided
    if (lastEventId !== undefined) {
      const lastTimestamp = parseInt(String(lastEventId), 10) || 0;
      const { events, refreshNeeded } = getEventsSince(channel, lastTimestamp);
      if (refreshNeeded) {
        // Stale: client's timestamp is older than buffer window → full sync needed
        socket.write(
          JSON.stringify({
            type: 'refresh_needed',
            id: request.id,
            channel,
          }) + '\n'
        );
        logger.info('Stale client, full sync needed', { channel, lastTimestamp });
      } else if (events.length > 0) {
        // Delta sync: replay missed events
        for (const event of events) {
          socket.write(
            JSON.stringify({
              type: 'channel_message',
              id: `replay_${event.timestamp}`,
              eventId: event.timestamp,
              channel: event.channel,
              message: event.message,
              replay: true,
            }) + '\n'
          );
        }
        logger.info('Delta sync: replayed events', { channel, count: events.length });
      }
    }

    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { subscribed: true, channel },
    };
  }

  // Handle channel unsubscribe
  if (request.type === 'unsubscribe') {
    const channel = request.channel!;
    const subs = channelSubscriptions.get(channel);
    if (subs) {
      subs.delete(socket);
      if (subs.size === 0) {
        channelSubscriptions.delete(channel);
      }
    }
    logger.info('Client unsubscribed from channel', { channel });
    return { type: 'result', id: request.id, success: true, data: { unsubscribed: true, channel } };
  }

  // Handle channel publish
  if (request.type === 'publish') {
    const channel = request.channel!;
    const message = request.message;
    const eventId = publishToChannel(channel, message, socket);
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { published: true, channel, eventId },
    };
  }

  // Handle get_events_since (for delta sync / full sync detection)
  if (request.type === 'get_events_since') {
    const channel = request.channel!;
    const lastTimestamp = parseInt(String(request.lastEventId || '0'), 10) || 0;
    const { events, refreshNeeded } = getEventsSince(channel, lastTimestamp);
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { events, refreshNeeded },
    };
  }

  // Handle lock acquisition
  if (request.type === 'lock') {
    const lockName = request.lockName!;
    const holder = request.sessionId || request.id;
    const timeout = request.lockTimeout || DEFAULT_LOCK_TIMEOUT;
    const acquired = acquireLock(lockName, holder, timeout);
    return {
      type: 'result',
      id: request.id,
      success: acquired,
      data: {
        acquired,
        lockName,
        holder,
        ...(acquired ? {} : { reason: 'Lock held by another client' }),
      },
    };
  }

  // Handle lock release
  if (request.type === 'unlock') {
    const lockName = request.lockName!;
    const holder = request.lockHolder || request.sessionId || request.id;
    const released = releaseLock(lockName, holder);
    return {
      type: 'result',
      id: request.id,
      success: released,
      data: {
        released,
        lockName,
        ...(released ? {} : { reason: 'Cannot release lock held by another client' }),
      },
    };
  }

  // Handle identity-aware lock assignment (photon code assigns to a specific caller)
  if (request.type === 'assign_lock') {
    const lockName = request.lockName!;
    const holder = request.lockHolder || request.sessionId || request.id;
    const timeout = request.lockTimeout || DEFAULT_LOCK_TIMEOUT;
    const acquired = acquireLock(lockName, holder, timeout);
    return {
      type: 'result',
      id: request.id,
      success: acquired,
      data: {
        acquired,
        lockName,
        holder,
        ...(acquired
          ? {}
          : {
              reason: 'Lock held by another caller',
              currentHolder: activeLocks.get(lockName)?.holder,
            }),
      },
    };
  }

  // Handle lock transfer (move lock from current holder to new holder)
  if (request.type === 'transfer_lock') {
    const lockName = request.lockName!;
    const currentHolder = request.lockHolder || request.sessionId || request.id;
    const newHolder = request.lockTransferTo!;
    const timeout = request.lockTimeout || DEFAULT_LOCK_TIMEOUT;
    const existing = activeLocks.get(lockName);

    if (!existing || existing.expiresAt <= Date.now()) {
      // No lock to transfer — just assign to new holder
      const acquired = acquireLock(lockName, newHolder, timeout);
      return {
        type: 'result',
        id: request.id,
        success: acquired,
        data: { transferred: acquired, lockName, from: currentHolder, to: newHolder },
      };
    }

    if (existing.holder !== currentHolder) {
      return {
        type: 'result',
        id: request.id,
        success: false,
        data: {
          transferred: false,
          lockName,
          reason: 'Not the current holder',
          currentHolder: existing.holder,
        },
      };
    }

    // Release and re-acquire for new holder
    activeLocks.delete(lockName);
    acquireLock(lockName, newHolder, timeout);
    logger.info('Lock transferred', { lockName, from: currentHolder, to: newHolder });
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { transferred: true, lockName, from: currentHolder, to: newHolder },
    };
  }

  // Handle lock query (who holds this lock?)
  if (request.type === 'query_lock') {
    const lockName = request.lockName!;
    const existing = activeLocks.get(lockName);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
      return {
        type: 'result',
        id: request.id,
        success: true,
        data: {
          lockName,
          holder: existing.holder,
          acquiredAt: existing.acquiredAt,
          expiresAt: existing.expiresAt,
        },
      };
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { lockName, holder: null },
    };
  }

  // Handle list locks
  if (request.type === 'list_locks') {
    const locks = Array.from(activeLocks.values());
    return { type: 'result', id: request.id, success: true, data: { locks } };
  }

  // Handle job scheduling
  if (request.type === 'schedule') {
    const photonName = request.photonName;
    if (!photonName) {
      return {
        type: 'error',
        id: request.id,
        error: 'photonName required for scheduling',
        suggestion: 'Include photonName in the request payload',
      };
    }

    // Generate IPC job ID with workingDir hash to prevent cross-project collisions
    const dirHash = request.workingDir
      ? crypto.createHash('sha256').update(request.workingDir).digest('hex').slice(0, 8)
      : '';
    const ipcJobId = dirHash
      ? `${photonName}:${dirHash}:ipc:${request.jobId!}`
      : `${photonName}:ipc:${request.jobId!}`;

    const existing = scheduledJobs.get(ipcJobId);
    const job: ScheduledJob & { photonName: string; workingDir?: string; photonPath?: string } = {
      id: ipcJobId,
      method: request.method!,
      args: request.args,
      cron: request.cron!,
      runCount: existing?.runCount ?? 0,
      createdAt: existing?.createdAt ?? Date.now(),
      createdBy: request.sessionId,
      photonName,
      workingDir: request.workingDir,
    };

    const scheduled = scheduleJob(job);
    if (scheduled) {
      persistIpcSchedule(job);
    }
    return {
      type: 'result',
      id: request.id,
      success: scheduled,
      data: scheduled
        ? { scheduled: true, jobId: job.id, nextRun: job.nextRun }
        : { scheduled: false, reason: 'Invalid cron expression' },
    };
  }

  // Handle job unscheduling
  if (request.type === 'unschedule') {
    const jobId = request.jobId!;
    // Try exact match first, then look for IPC-prefixed version
    let actualJobId = jobId;
    if (!scheduledJobs.has(jobId)) {
      // Search for IPC-prefixed job
      for (const key of scheduledJobs.keys()) {
        if (key.endsWith(`:ipc:${jobId}`)) {
          actualJobId = key;
          break;
        }
      }
    }
    const job = scheduledJobs.get(actualJobId);
    const unscheduled = unscheduleJob(actualJobId);
    if (unscheduled && job) {
      deletePersistedIpcSchedule(actualJobId, job.photonName);
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { unscheduled, jobId: actualJobId },
    };
  }

  // Handle list jobs (legacy shape — just the active cron jobs)
  if (request.type === 'list_jobs') {
    const jobs = Array.from(scheduledJobs.values());
    return { type: 'result', id: request.id, success: true, data: { jobs } };
  }

  // `photon ps` full snapshot: active timers, declared-but-dormant schedules,
  // webhook routes, loaded sessions. Agent-friendly (structured) and compact.
  if (request.type === 'ps') {
    const defaultBase = path.resolve(getDefaultContext().baseDir);
    const active = Array.from(scheduledJobs.values()).map((j) => ({
      id: j.id,
      photon: j.photonName,
      method: j.method,
      cron: j.cron,
      nextRun: j.nextRun ?? null,
      lastRun: j.lastRun ?? null,
      runCount: j.runCount,
      photonPath: j.photonPath,
      workingDir: j.workingDir ?? defaultBase,
      createdBy: j.createdBy,
    }));
    const declared = Array.from(declaredSchedules.values()).map((d) => ({
      key: declaredKey(d.photon, d.method),
      photon: d.photon,
      method: d.method,
      cron: d.cron,
      photonPath: d.photonPath,
      workingDir: d.workingDir ?? defaultBase,
      active: scheduledJobs.has(declaredKey(d.photon, d.method)),
    }));
    const webhooks: Array<{ photon: string; route: string; method: string; workingDir?: string }> =
      [];
    for (const [photon, routes] of webhookRoutes.entries()) {
      for (const [route, methodName] of routes.entries()) {
        const loc = proactivePhotonLocations.get(photon);
        webhooks.push({
          photon,
          route,
          method: methodName,
          workingDir: loc?.workingDir ?? defaultBase,
        });
      }
    }
    const sessions: Array<{
      photon: string;
      workingDir?: string;
      key: string;
      instanceCount: number;
    }> = [];
    for (const [key, mgr] of sessionManagers.entries()) {
      const stored = workingDirs.get(key);
      const photonFromKey = key.includes(':') ? key.split(':')[0] : key;
      sessions.push({
        photon: photonFromKey,
        workingDir: stored ?? defaultBase,
        key,
        instanceCount: mgr.getSessions().length,
      });
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { active, declared, webhooks, sessions },
    };
  }

  // Enroll a declared @scheduled method into the active list.
  if (request.type === 'enable_schedule') {
    const photon = request.photonName;
    const method = (request as { method?: string }).method;
    if (!photon || !method) {
      return {
        type: 'error',
        id: request.id,
        error: '`enable_schedule` requires photonName and method',
      };
    }
    const key = declaredKey(photon, method);
    const decl = declaredSchedules.get(key);
    if (!decl) {
      return {
        type: 'error',
        id: request.id,
        error:
          `No @scheduled declaration found for ${key}. ` +
          `Did the source file get renamed or deleted?`,
      };
    }
    const base = path.resolve(decl.workingDir || getDefaultContext().baseDir);
    const file = readActiveSchedulesFile(base);
    const existing = file.active.find((e) => e.photon === photon && e.method === method);
    if (existing) {
      if (existing.paused) existing.paused = false;
    } else {
      file.active.push({
        photon,
        method,
        enabledAt: new Date().toISOString(),
        enabledBy: (request as { source?: string }).source || 'rpc',
      });
    }
    writeActiveSchedulesFile(base, file);
    // Also record this base so daemon restarts find it.
    try {
      touchBase(base);
    } catch {
      /* non-fatal */
    }
    if (!scheduledJobs.has(key)) {
      scheduleJob({
        id: key,
        method: decl.method,
        args: {},
        cron: decl.cron,
        runCount: 0,
        createdAt: Date.now(),
        createdBy: 'ps-enable',
        photonName: decl.photon,
        workingDir: decl.workingDir,
        photonPath: decl.photonPath,
      });
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { photon, method, base, cron: decl.cron, status: 'active' },
    };
  }

  // Remove a schedule from the active list (drops the timer and the file entry).
  if (request.type === 'disable_schedule') {
    const photon = request.photonName;
    const method = (request as { method?: string }).method;
    if (!photon || !method) {
      return {
        type: 'error',
        id: request.id,
        error: '`disable_schedule` requires photonName and method',
      };
    }
    const key = declaredKey(photon, method);
    const decl = declaredSchedules.get(key);
    const base = path.resolve(
      decl?.workingDir ||
        (request as { workingDir?: string }).workingDir ||
        getDefaultContext().baseDir
    );
    const file = readActiveSchedulesFile(base);
    const before = file.active.length;
    file.active = file.active.filter((e) => !(e.photon === photon && e.method === method));
    const removed = before - file.active.length;
    writeActiveSchedulesFile(base, file);
    // Clear the timer if one is running.
    const existingTimer = jobTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      jobTimers.delete(key);
    }
    scheduledJobs.delete(key);
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { photon, method, base, removed: removed > 0, status: 'disabled' },
    };
  }

  // Pause: keep the enrollment record but cancel the timer.
  if (request.type === 'pause_schedule' || request.type === 'resume_schedule') {
    const photon = request.photonName;
    const method = (request as { method?: string }).method;
    const pause = request.type === 'pause_schedule';
    if (!photon || !method) {
      return {
        type: 'error',
        id: request.id,
        error: `\`${pause ? 'pause_schedule' : 'resume_schedule'}\` requires photonName and method`,
      };
    }
    const key = declaredKey(photon, method);
    const decl = declaredSchedules.get(key);
    const base = path.resolve(
      decl?.workingDir ||
        (request as { workingDir?: string }).workingDir ||
        getDefaultContext().baseDir
    );
    const file = readActiveSchedulesFile(base);
    const entry = file.active.find((e) => e.photon === photon && e.method === method);
    if (!entry) {
      return {
        type: 'error',
        id: request.id,
        error: `No active enrollment for ${key} under ${base}. Enable it first.`,
      };
    }
    entry.paused = pause;
    writeActiveSchedulesFile(base, file);
    if (pause) {
      const existingTimer = jobTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        jobTimers.delete(key);
      }
      scheduledJobs.delete(key);
    } else if (decl) {
      scheduleJob({
        id: key,
        method: decl.method,
        args: {},
        cron: decl.cron,
        runCount: 0,
        createdAt: Date.now(),
        createdBy: 'ps-resume',
        photonName: decl.photon,
        workingDir: decl.workingDir,
        photonPath: decl.photonPath,
      });
    }
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { photon, method, base, status: pause ? 'paused' : 'active' },
    };
  }

  // Return recent firings recorded by recordExecution() — scoped to one
  // photon:method, newest first, filterable by time window.
  if (request.type === 'get_execution_history') {
    const photon = request.photonName;
    const method = (request as { method?: string }).method;
    if (!photon || !method) {
      return {
        type: 'error',
        id: request.id,
        error: '`get_execution_history` requires photonName and method',
      };
    }
    // Prefer the caller-supplied workingDir; fall back to the declaration's
    // base; finally to the default base.
    const decl = declaredSchedules.get(declaredKey(photon, method));
    const workingDir =
      (request as { workingDir?: string }).workingDir ||
      decl?.workingDir ||
      getDefaultContext().baseDir;
    const entries = readExecutionHistory(
      photon,
      { method, limit: request.limit, sinceTs: request.sinceTs },
      workingDir
    );
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { photon, method, entries },
    };
  }

  if (request.type === 'get_circuit_health') {
    // Aggregate circuit breaker states from all loaded photon loaders
    const circuits: Record<string, { state: string; failures: number; openedAt: number }> = {};
    for (const manager of sessionManagers.values()) {
      Object.assign(circuits, manager.loader.getCircuitHealth());
    }
    return { type: 'result', id: request.id, success: true, data: { circuits } };
  }

  // Handle command execution
  if (request.type === 'command') {
    if (!request.method) {
      return {
        type: 'error',
        id: request.id,
        error: 'Method name required',
        suggestion: 'Specify the method to call: { method: "methodName" }',
      };
    }

    const photonName = request.photonName;
    if (!photonName) {
      return {
        type: 'error',
        id: request.id,
        error: 'photonName required for commands',
        suggestion: 'Include photonName in the request payload',
      };
    }

    // Runtime-injected instance tools must be handled by the daemon,
    // not forwarded to worker threads (workers don't know about _use etc.)
    const runtimeTools = ['_use', '_instances', '_undo', '_redo'];
    const cmdKey = compositeKey(photonName, request.workingDir);
    const readyWorker = workerManager.get(cmdKey);
    if (readyWorker?.ready && !runtimeTools.includes(request.method)) {
      const startMs = Date.now();
      const result = await workerManager.call(
        cmdKey,
        request.method,
        request.args || {},
        request.sessionId || 'default',
        request.instanceName || ''
      );
      return {
        type: result.success ? 'result' : 'error',
        id: request.id,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: result.durationMs ?? Date.now() - startMs,
      };
    }

    // Trigger worker spawn if needed (getOrCreateSessionManager returns null for workers).
    // Bound the wait so a slow worker spawn (cascading deps) doesn't block the CLI indefinitely.
    let sessionManager: Awaited<ReturnType<typeof getOrCreateSessionManager>> = null;
    try {
      const initPromise = getOrCreateSessionManager(
        photonName,
        request.photonPath,
        request.workingDir
      );
      const INIT_TIMEOUT_MS = 60_000;
      sessionManager = await Promise.race([
        initPromise,
        new Promise<null>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Photon ${photonName} initialization timed out (${INIT_TIMEOUT_MS / 1000}s)`
                )
              ),
            INIT_TIMEOUT_MS
          )
        ),
      ]);
    } catch (initErr) {
      return {
        type: 'error',
        id: request.id,
        error: getErrorMessage(initErr),
        suggestion: `The photon may still be loading. Try again shortly, or check: cat ${getDefaultContext().logFile}`,
      };
    }

    // Re-check: might have spawned a worker
    const readyWorkerAfterInit = workerManager.get(cmdKey);
    if (readyWorkerAfterInit?.ready && !runtimeTools.includes(request.method)) {
      const startMs = Date.now();
      const result = await workerManager.call(
        cmdKey,
        request.method,
        request.args || {},
        request.sessionId || 'default',
        request.instanceName || ''
      );
      return {
        type: result.success ? 'result' : 'error',
        id: request.id,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: result.durationMs ?? Date.now() - startMs,
      };
    }

    if (!sessionManager) {
      // Worker photons don't have a session manager — handle runtime tools directly
      if (workerManager.has(cmdKey) && runtimeTools.includes(request.method)) {
        if (request.method === '_use') {
          const instanceName = String((request.args as any)?.name ?? '');
          const label = instanceName || 'default';
          return {
            type: 'result',
            id: request.id,
            success: true,
            data: { instance: label, message: `Switched to instance: ${label}` },
          };
        }
        if (request.method === '_instances') {
          const { InstanceStore } = await import('../context-store.js');
          const store = new InstanceStore(request.workingDir);
          const { instances, autoInstance, metadata } = store.listInstancesByMtime(photonName);
          if (!instances.includes('default')) instances.push('default');
          instances.sort();
          return {
            type: 'result',
            id: request.id,
            success: true,
            data: { instances, current: 'default', autoInstance, metadata },
          };
        }
        // _undo/_redo not supported for worker photons
        return {
          type: 'error',
          id: request.id,
          error: `${request.method} is not supported for worker-thread photons`,
        };
      }

      return {
        type: 'error',
        id: request.id,
        error: `Cannot initialize photon '${photonName}'. Provide photonPath in request.`,
      };
    }

    // Stat-gate: if the source file has changed since we last loaded it,
    // synchronously reload before dispatching. Closes the race window where
    // a request arrives between a file write and the watcher's debounce.
    const dispatchPhotonPath = request.photonPath || photonPaths.get(cmdKey);
    await statGate(cmdKey, photonName, dispatchPhotonPath, request.workingDir);

    try {
      const session = await sessionManager.getOrCreateSession(
        request.sessionId,
        request.clientType
      );

      // ── Auto-recover from instance drift ─────────────────────────
      // If the client tells us which instance it expects but the daemon
      // session has drifted (e.g. session expired and was recreated as
      // "default"), silently switch back to the correct instance.
      if (request.instanceName && request.instanceName !== session.instanceName) {
        logger.info('Instance drift detected, auto-switching', {
          from: session.instanceName || 'default',
          to: request.instanceName,
          sessionId: session.id,
        });
        await sessionManager.switchInstance(session.id, request.instanceName);
      }

      // ── Runtime-injected instance tools ──────────────────────────
      if (request.method === '_use') {
        const instanceName = String((request.args as any)?.name ?? '');
        await sessionManager.switchInstance(session.id, instanceName);
        const label = instanceName || 'default';

        // Ensure a state file exists so _instances can discover this instance
        try {
          const { getInstanceStatePath } = await import('../context-store.js');
          const fsPromises = await import('fs/promises');
          const pathMod = await import('path');
          const statePath = getInstanceStatePath(photonName, label, request.workingDir);
          await fsPromises.mkdir(pathMod.dirname(statePath), { recursive: true });
          try {
            await fsPromises.access(statePath);
          } catch {
            // File doesn't exist — create empty state marker
            await fsPromises.writeFile(statePath, '{}');
          }
        } catch (e) {
          logger.debug('Could not ensure instance state file', { error: getErrorMessage(e) });
        }

        return {
          type: 'result',
          id: request.id,
          success: true,
          data: { instance: label, message: `Switched to instance: ${label}` },
        };
      }

      if (request.method === '_instances') {
        const { InstanceStore } = await import('../context-store.js');
        const store = new InstanceStore(request.workingDir);
        const { instances, autoInstance, metadata } = store.listInstancesByMtime(photonName);
        const current = session.instanceName || 'default';
        // Ensure "default" and current instance are always in the list
        // (they may not have state files yet)
        if (!instances.includes('default')) {
          instances.push('default');
        }
        if (!instances.includes(current)) {
          instances.push(current);
        }
        instances.sort();
        return {
          type: 'result',
          id: request.id,
          success: true,
          data: { instances, current, autoInstance, metadata },
        };
      }

      // ── Undo / Redo ──────────────────────────────────────────────
      if (request.method === '_undo' || request.method === '_redo') {
        const isUndo = request.method === '_undo';
        const instanceLabel = session.instanceName || 'default';
        const key = undoKey(photonName, instanceLabel);
        const source = isUndo ? undoPast.get(key) : undoFuture.get(key);
        const dest = isUndo ? undoFuture : undoPast;

        if (!source || source.length === 0) {
          return {
            type: 'result',
            id: request.id,
            success: true,
            data: { error: `Nothing to ${isUndo ? 'undo' : 'redo'}` },
          };
        }

        const entry = source.pop()!;
        const opsToApply = isUndo ? entry.inversePatch : entry.patch;

        // Apply patch to live instance
        await applyPatchToInstance(session.instance, photonName, opsToApply);

        // Persist the new state
        await persistInstanceState(
          session.instance,
          photonName,
          session.instanceName,
          request.workingDir
        );

        // Push to opposite stack
        let destStack = dest.get(key);
        if (!destStack) {
          destStack = [];
          dest.set(key, destStack);
        }
        destStack.push(entry);

        // Generate the resulting patch for this undo/redo action
        const actionPatch = isUndo ? entry.inversePatch : entry.patch;
        const actionInverse = isUndo ? entry.patch : entry.inversePatch;

        const stateChangedPayload = {
          event: 'state-changed',
          method: request.method,
          params: { undoneMethod: entry.method },
          instance: instanceLabel,
          data: { method: entry.method, action: isUndo ? 'undo' : 'redo' },
          ...(actionPatch.length > 0 && { patch: actionPatch }),
          ...(actionInverse.length > 0 && { inversePatch: actionInverse }),
          uri: `photon://${photonName}/${instanceLabel}`,
        };

        // Publish to instance-specific channel for multi-instance isolation
        publishToChannel(
          `${photonName}:${instanceLabel}:state-changed`,
          stateChangedPayload,
          socket
        );

        // Log undo/redo to event log
        await appendEventLog(
          photonName,
          instanceLabel,
          {
            method: request.method,
            params: { undoneMethod: entry.method },
            instance: instanceLabel,
            patch: actionPatch,
            inversePatch: actionInverse,
          },
          request.workingDir
        );

        return {
          type: 'result',
          id: request.id,
          success: true,
          data: {
            action: isUndo ? 'undo' : 'redo',
            method: entry.method,
            message: `${isUndo ? 'Undid' : 'Redid'} "${entry.method}"`,
          },
        };
      }
      // ─────────────────────────────────────────────────────────────

      // ── Instance-scoped execution (one-shot, no session mutation) ──
      // If targetInstance is set, load that instance, execute on it,
      // persist its state, and return — without changing the session.
      if (request.targetInstance !== undefined) {
        const targetName = request.targetInstance;
        logger.info('Instance-scoped execution', {
          method: request.method,
          photon: photonName,
          targetInstance: targetName || 'default',
          sessionId: session.id,
        });

        const targetInst = await sessionManager.getOrLoadInstance(targetName);

        setPromptHandler(createSocketPromptHandler(socket, request.id));

        const outputHandler = (emit: any) => {
          if (emit && typeof emit === 'object') {
            if (emit.channel) {
              publishToChannel(emit.channel, emit, socket);
            }
            // Forward generator emit yields to CLI client
            if (emit.emit) {
              const emitResponse: DaemonResponse = {
                type: 'emit',
                id: request.id,
                emitData: emit,
              };
              socket.write(JSON.stringify(emitResponse) + '\n');
            }
          }
        };

        // Snapshot state before execution for JSON Patch diffing
        const preSnapshot = await snapshotState(targetInst, photonName);

        const startTime = Date.now();
        trackExecution(cmdKey);
        let result: any;
        try {
          result = await sessionManager.loader.executeTool(
            targetInst,
            request.method,
            request.args || {},
            { outputHandler }
          );
        } finally {
          untrackExecution(cmdKey);
        }
        const durationMs = Date.now() - startTime;

        setPromptHandler(null);

        logger.info('Request completed', {
          method: request.method,
          photon: photonName,
          instance: targetName,
          clientType: request.clientType || 'unknown',
          sessionId: session.id,
          durationMs,
        });
        audit({
          ts: new Date().toISOString(),
          event: 'tool_call',
          photon: photonName,
          method: request.method,
          instance: targetName || 'default',
          client: request.clientType || 'unknown',
          sessionId: session.id,
          durationMs,
        });

        await persistInstanceState(targetInst, photonName, targetName, request.workingDir);

        // Generate JSON Patch (RFC 6902) forward + inverse ops
        const postSnapshot = preSnapshot ? await snapshotState(targetInst, photonName) : null;
        const patch: Operation[] =
          preSnapshot && postSnapshot ? jsonPatchCompare(preSnapshot, postSnapshot) : [];
        const inversePatch: Operation[] =
          preSnapshot && postSnapshot ? jsonPatchCompare(postSnapshot, preSnapshot) : [];

        const instanceLabel = targetName || 'default';
        const stateChangedPayload = {
          event: 'state-changed',
          method: request.method,
          params: request.args || {},
          instance: instanceLabel,
          data: result,
          ...(patch.length > 0 && { patch }),
          ...(inversePatch.length > 0 && { inversePatch }),
          uri: `photon://${photonName}/${instanceLabel}`,
        };

        // Publish to instance-specific channel for multi-instance isolation
        publishToChannel(
          `${photonName}:${instanceLabel}:state-changed`,
          stateChangedPayload,
          socket
        );

        // Append to event log
        if (patch.length > 0) {
          await appendEventLog(
            photonName,
            instanceLabel,
            {
              method: request.method,
              params: request.args || {},
              instance: instanceLabel,
              patch,
              inversePatch,
            },
            request.workingDir
          );
        }

        // Track for undo/redo
        if (patch.length > 0) {
          pushUndoEntry(photonName, instanceLabel, {
            method: request.method,
            patch,
            inversePatch,
          });
        }

        return { type: 'result', id: request.id, success: true, data: result, durationMs };
      }

      logger.info('Executing request', {
        method: request.method,
        photon: photonName,
        sessionId: session.id,
        instance: session.instanceName || 'default',
      });

      setPromptHandler(createSocketPromptHandler(socket, request.id));

      const outputHandler = (emit: any) => {
        if (emit && typeof emit === 'object') {
          if (emit.channel) {
            publishToChannel(emit.channel, emit, socket);
            logger.debug('Published to channel', { channel: emit.channel });
          }
          // Forward generator emit yields to CLI client
          if (emit.emit) {
            const emitResponse: DaemonResponse = {
              type: 'emit',
              id: request.id,
              emitData: emit,
            };
            socket.write(JSON.stringify(emitResponse) + '\n');
          }
        }
      };

      // Snapshot state before execution for JSON Patch diffing
      const preSnapshot = await snapshotState(session.instance, photonName);

      const startTime = Date.now();
      trackExecution(cmdKey);
      let result: any;
      try {
        result = await sessionManager.loader.executeTool(
          session.instance,
          request.method,
          request.args || {},
          { outputHandler }
        );
      } finally {
        untrackExecution(cmdKey);
      }
      const durationMs = Date.now() - startTime;

      setPromptHandler(null);

      logger.info('Request completed', {
        method: request.method,
        photon: photonName,
        instance: session.instanceName || 'default',
        clientType: request.clientType || 'unknown',
        sessionId: session.id,
        durationMs,
      });
      audit({
        ts: new Date().toISOString(),
        event: 'tool_call',
        photon: photonName,
        method: request.method,
        instance: session.instanceName || 'default',
        client: request.clientType || 'unknown',
        sessionId: session.id,
        durationMs,
      });

      // Persist reactive state after each tool call
      await persistInstanceState(
        session.instance,
        photonName,
        session.instanceName,
        request.workingDir
      );

      // Generate JSON Patch (RFC 6902) forward + inverse ops
      const postSnapshot = preSnapshot ? await snapshotState(session.instance, photonName) : null;
      const patch: Operation[] =
        preSnapshot && postSnapshot ? jsonPatchCompare(preSnapshot, postSnapshot) : [];
      const inversePatch: Operation[] =
        preSnapshot && postSnapshot ? jsonPatchCompare(postSnapshot, preSnapshot) : [];

      const instanceLabel = session.instanceName || 'default';
      const stateChangedPayload = {
        event: 'state-changed',
        method: request.method,
        params: request.args || {},
        instance: instanceLabel,
        data: result,
        ...(patch.length > 0 && { patch }),
        ...(inversePatch.length > 0 && { inversePatch }),
        uri: `photon://${photonName}/${instanceLabel}`,
      };

      // Notify subscribers that state may have changed (instance-specific channel)
      const targetLabel = session.instanceName || 'default';
      publishToChannel(`${photonName}:${targetLabel}:state-changed`, stateChangedPayload, socket);

      // Append to event log
      if (patch.length > 0) {
        await appendEventLog(
          photonName,
          instanceLabel,
          {
            method: request.method,
            params: request.args || {},
            instance: instanceLabel,
            patch,
            inversePatch,
          },
          request.workingDir
        );
      }

      // Track for undo/redo
      if (patch.length > 0) {
        pushUndoEntry(photonName, instanceLabel, {
          method: request.method,
          patch,
          inversePatch,
        });
      }

      return { type: 'result', id: request.id, success: true, data: result, durationMs };
    } catch (error) {
      logger.error('Error executing request', {
        method: request.method,
        error: getErrorMessage(error),
      });
      audit({
        ts: new Date().toISOString(),
        event: 'tool_error',
        photon: photonName,
        method: request.method,
        instance: request.instanceName || 'default',
        client: request.clientType || 'unknown',
        sessionId: request.sessionId,
        error: getErrorMessage(error),
      });
      setPromptHandler(null);
      return { type: 'error', id: request.id, error: getErrorMessage(error) };
    }
  }

  return {
    type: 'error',
    id: request.id,
    error: `Unknown request type: ${String((request as { type: string }).type)}`,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Persist reactive collection state to disk after each tool call.
 * Scans the instance for properties with _propertyName (ReactiveArray/Map/Set markers)
 * and serializes them to the instance-specific state file.
 */
/** Cache of state keys per photon (extracted once from source) */
const stateKeysCache = new Map<string, string[]>();

/**
 * Get the state property keys for a photon by extracting constructor params.
 * State params: non-primitive with default on @stateful photon.
 */
async function getStateKeys(photonName: string, photonPath: string): Promise<string[]> {
  if (stateKeysCache.has(photonName)) {
    return stateKeysCache.get(photonName)!;
  }

  try {
    const { SchemaExtractor } = await import('@portel/photon-core');
    const fsPromises = await import('fs/promises');
    const source = await fsPromises.readFile(photonPath, 'utf-8');
    const extractor = new SchemaExtractor();
    const injections = extractor.resolveInjections(source, photonName);
    const keys = injections
      .filter((inj) => inj.injectionType === 'state')
      .map((inj) => inj.stateKey!);
    stateKeysCache.set(photonName, keys);
    logger.debug('State keys extracted', { photon: photonName, keys });
    return keys;
  } catch (error) {
    logger.error('Failed to extract state keys', {
      photon: photonName,
      error: getErrorMessage(error),
    });
    return [];
  }
}

/**
 * Capture a JSON-serializable snapshot of a photon instance's state.
 * Returns null for non-stateful photons (no state keys).
 * Used for JSON Patch diffing (pre/post execution).
 */
async function snapshotState(
  instance: any,
  photonName: string
): Promise<Record<string, any> | null> {
  const photonPath = photonPaths.get(photonName);
  if (!photonPath) return null;

  const keys = await getStateKeys(photonName, photonPath);
  if (keys.length === 0) return null;

  const target = instance?.instance ?? instance;
  const snapshot: Record<string, any> = {};
  for (const key of keys) {
    const value = target[key];
    if (value === undefined) continue;
    if (value && typeof value === 'object' && value._propertyName) {
      snapshot[key] = value.toJSON ? value.toJSON() : globalThis.Array.from(value);
    } else {
      snapshot[key] = value;
    }
  }
  // Deep-clone to freeze the snapshot (avoid reference sharing with live state)
  return JSON.parse(JSON.stringify(snapshot));
}

/**
 * Persist reactive collection state to disk after each tool call.
 * Only persists properties identified as 'state' injection type
 * (non-primitive constructor params with defaults on @stateful photons).
 */
async function persistInstanceState(
  instance: any,
  photonName: string,
  instanceName: string,
  workingDir?: string
): Promise<void> {
  try {
    const photonPath = photonPaths.get(photonName);
    if (!photonPath) return;

    const keys = await getStateKeys(photonName, photonPath);
    if (keys.length === 0) return;

    // instance is PhotonClass wrapper — actual user class is instance.instance
    const target = instance?.instance ?? instance;
    const snapshot: Record<string, any> = {};
    for (const key of keys) {
      const value = target[key];
      if (value === undefined) continue;

      if (value && typeof value === 'object' && value._propertyName) {
        // ReactiveArray/Map/Set — serialize underlying data
        snapshot[key] = value.toJSON ? value.toJSON() : globalThis.Array.from(value);
      } else {
        // Plain value (array, object, etc.)
        snapshot[key] = value;
      }
    }

    if (Object.keys(snapshot).length > 0) {
      const { getInstanceStatePath } = await import('../context-store.js');
      const statePath = getInstanceStatePath(photonName, instanceName, workingDir);
      const fsPromises = await import('fs/promises');
      const path = await import('path');
      await fsPromises.mkdir(path.dirname(statePath), { recursive: true });
      await fsPromises.writeFile(statePath, JSON.stringify(snapshot, null, 2));
      logger.debug('Persisted state', { photon: photonName, instance: instanceName || 'default' });
    }
  } catch (error) {
    logger.error('Failed to persist state', {
      photon: photonName,
      error: getErrorMessage(error),
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// EVENT LOG (JSONL append-only per instance)
// ════════════════════════════════════════════════════════════════════════════════

/** Monotonically increasing sequence number per photon:instance */
const eventLogSeq = new Map<string, number>();

const EVENT_LOG_MAX_SIZE =
  parseInt(process.env.PHOTON_EVENT_LOG_MAX_SIZE || '', 10) || 10 * 1024 * 1024; // 10MB default

/**
 * Get the event log path for a photon instance under the Option B layout:
 * `{PHOTON_DIR}/.data/{photon}/state/{instance}/state.log`. Delegates to
 * the canonical photon-core helper so all callers land on the same path.
 * Namespace is threaded through as empty (flat root) — sub-namespace log
 * routing lands as part of the later namespace-aware instance work.
 */
function getInstanceLogPath(photonName: string, instanceName: string, baseDir?: string): string {
  return getPhotonStateLogPath(
    '',
    photonName,
    instanceName || 'default',
    baseDir || getDefaultContext().baseDir
  );
}

/**
 * Append an event entry to the JSONL event log.
 * Handles log rotation when file exceeds EVENT_LOG_MAX_SIZE.
 */
async function appendEventLog(
  photonName: string,
  instanceName: string,
  entry: {
    method: string;
    params: Record<string, any>;
    instance: string;
    patch: Operation[];
    inversePatch: Operation[];
  },
  workingDir?: string
): Promise<void> {
  try {
    const logPath = getInstanceLogPath(photonName, instanceName, workingDir);
    const fsPromises = await import('fs/promises');
    await fsPromises.mkdir(path.dirname(logPath), { recursive: true });

    // Get next sequence number
    const seqKey = `${photonName}:${instanceName}`;
    const seq = (eventLogSeq.get(seqKey) || 0) + 1;
    eventLogSeq.set(seqKey, seq);

    const logEntry = {
      seq,
      timestamp: new Date().toISOString(),
      method: entry.method,
      params: entry.params,
      instance: entry.instance,
      patch: entry.patch,
      inversePatch: entry.inversePatch,
    };

    const line = JSON.stringify(logEntry) + '\n';

    // Check rotation before appending
    try {
      const stat = await fsPromises.stat(logPath);
      if (stat.size >= EVENT_LOG_MAX_SIZE) {
        const rotatedPath = logPath + '.1';
        await fsPromises.rename(logPath, rotatedPath).catch(() => {});
        logger.debug('Rotated event log', { photon: photonName, instance: instanceName });
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    await fsPromises.appendFile(logPath, line);
    logger.debug('Appended event log', { photon: photonName, instance: instanceName, seq });
  } catch (error) {
    logger.error('Failed to append event log', {
      photon: photonName,
      error: getErrorMessage(error),
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// UNDO / REDO STACKS
// ════════════════════════════════════════════════════════════════════════════════

interface UndoEntry {
  method: string;
  patch: Operation[];
  inversePatch: Operation[];
}

/** past stack per photon:instance */
const undoPast = new Map<string, UndoEntry[]>();
/** future stack per photon:instance */
const undoFuture = new Map<string, UndoEntry[]>();
const UNDO_STACK_LIMIT = 100;

function undoKey(photonName: string, instance: string): string {
  return `${photonName}:${instance || 'default'}`;
}

function pushUndoEntry(photonName: string, instance: string, entry: UndoEntry): void {
  const key = undoKey(photonName, instance);
  let past = undoPast.get(key);
  if (!past) {
    past = [];
    undoPast.set(key, past);
  }
  past.push(entry);
  if (past.length > UNDO_STACK_LIMIT) past.shift();
  // New mutation clears the redo future
  undoFuture.set(key, []);
}

/**
 * Apply a JSON Patch to a live photon instance's state.
 * Snapshots state as plain JSON, applies patch, then rehydrates instance properties.
 */
async function applyPatchToInstance(
  instance: any,
  photonName: string,
  ops: Operation[]
): Promise<void> {
  // Use the already-imported fastJsonPatch module
  const applyPatch = fastJsonPatch.applyPatch.bind(fastJsonPatch);
  const photonPath = photonPaths.get(photonName);
  if (!photonPath) return;

  const keys = await getStateKeys(photonName, photonPath);
  if (keys.length === 0) return;

  // Get current state as plain JSON
  const snapshot = await snapshotState(instance, photonName);
  if (!snapshot) return;

  // Apply patch operations
  applyPatch(snapshot, ops, true, true);

  // Rehydrate instance properties from patched snapshot
  const target = instance?.instance ?? instance;
  for (const key of keys) {
    if (!(key in snapshot)) continue;
    const current = target[key];
    const patched = snapshot[key];

    if (current && typeof current === 'object' && current._propertyName) {
      // ReactiveArray — clear and replace contents
      if (typeof current.splice === 'function') {
        current.splice(0, current.length, ...patched);
      } else if (current instanceof Map || (current.clear && current.set)) {
        current.clear();
        for (const [k, v] of Object.entries(patched)) current.set(k, v);
      } else if (current instanceof Set || (current.clear && current.add)) {
        current.clear();
        for (const v of patched) current.add(v);
      }
    } else if (globalThis.Array.isArray(current)) {
      current.splice(0, current.length, ...patched);
    } else if (typeof current === 'object' && current !== null) {
      // Plain object — replace properties
      for (const k of Object.keys(current)) delete current[k];
      Object.assign(current, patched);
    } else {
      target[key] = patched;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// FILE WATCHING (Auto Hot-Reload)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Runtime-safe file/directory watcher.
 *
 * Bun's fs.watch has critical bugs on macOS (infinite loop with large files,
 * deadlocks, use-after-free in PathWatcherManager). The daemon is a long-lived
 * process with many watchers — these bugs cause 100% CPU and fan spin.
 *
 * Strategy:
 *   - Node.js: use fs.watch (kernel-level, zero CPU when idle)
 *   - Bun:     use fs.watchFile (stat polling, ~0.01% CPU per file at 2s interval)
 *
 * For DIRECTORY watches under Bun, we poll with readdirSync snapshots since
 * fs.watchFile only works on files.
 */
const IS_BUN = !!process.versions.bun;
const POLL_INTERVAL_MS = 2000; // 2s — good balance between latency and CPU

interface SafeWatcher {
  close(): void;
}

/** Track active poll timers so they can be cleaned up on shutdown */
const pollTimers = new Set<NodeJS.Timeout>();

function safeWatchFile(
  filePath: string,
  callback: (eventType: 'change' | 'rename') => void
): SafeWatcher {
  if (!IS_BUN) {
    const w = fs.watch(filePath, (eventType) => callback(eventType as 'change' | 'rename'));
    return w;
  }

  // Bun fallback: stat polling
  let prevMtime = 0;
  let prevIno = 0;
  try {
    const stat = fs.statSync(filePath);
    prevMtime = stat.mtimeMs;
    prevIno = stat.ino;
  } catch {
    // File doesn't exist yet
  }

  const timer = setInterval(() => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.ino !== prevIno) {
        prevIno = stat.ino;
        prevMtime = stat.mtimeMs;
        callback('rename'); // Different inode = file was replaced
      } else if (stat.mtimeMs !== prevMtime) {
        prevMtime = stat.mtimeMs;
        callback('change');
      }
    } catch {
      if (prevIno !== 0) {
        prevIno = 0;
        prevMtime = 0;
        callback('rename'); // File gone
      }
    }
  }, POLL_INTERVAL_MS);
  timer.unref();
  pollTimers.add(timer);

  return {
    close() {
      clearInterval(timer);
      pollTimers.delete(timer);
    },
  };
}

function safeWatchDir(
  dirPath: string,
  callback: (eventType: 'change' | 'rename', filename: string | null) => void
): SafeWatcher {
  if (!IS_BUN) {
    const w = fs.watch(dirPath, (eventType, filename) =>
      callback(eventType as 'change' | 'rename', filename)
    );
    return w;
  }

  // Bun fallback: readdir snapshot diffing
  let prevEntries = new Map<string, number>(); // name -> mtimeMs
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      try {
        const stat = fs.statSync(path.join(dirPath, entry));
        prevEntries.set(entry, stat.mtimeMs);
      } catch {
        prevEntries.set(entry, 0);
      }
    }
  } catch {
    // Dir may not exist yet
  }

  const timer = setInterval(() => {
    try {
      const currEntries = new Map<string, number>();
      for (const entry of fs.readdirSync(dirPath)) {
        try {
          const stat = fs.statSync(path.join(dirPath, entry));
          currEntries.set(entry, stat.mtimeMs);
        } catch {
          currEntries.set(entry, 0);
        }
      }

      // Detect additions and modifications
      for (const [name, mtime] of currEntries) {
        const prev = prevEntries.get(name);
        if (prev === undefined) {
          callback('rename', name); // New entry
        } else if (prev !== mtime) {
          callback('change', name);
        }
      }

      // Detect deletions
      for (const name of prevEntries.keys()) {
        if (!currEntries.has(name)) {
          callback('rename', name); // Removed entry
        }
      }

      prevEntries = currEntries;
    } catch {
      // Dir deleted or unreadable — treat as rename
      if (prevEntries.size > 0) {
        for (const name of prevEntries.keys()) {
          callback('rename', name);
        }
        prevEntries = new Map();
      }
    }
  }, POLL_INTERVAL_MS);
  timer.unref();
  pollTimers.add(timer);

  return {
    close() {
      clearInterval(timer);
      pollTimers.delete(timer);
    },
  };
}

function watchPhotonFile(photonName: string, photonPath: string): void {
  // Resolve symlink so fs.watch() fires when the real file changes.
  // On macOS, fs.watch on a symlink only detects changes to the symlink inode itself —
  // NOT to the symlink's target. Resolving to the real path fixes hot-reload for
  // developer workflows where ~/.photon/*.photon.ts are symlinks to project directories.
  let watchPath = photonPath;
  try {
    watchPath = fs.realpathSync(photonPath);
  } catch {
    // Symlink target doesn't exist yet or resolution failed — fall back to original path
  }

  if (fileWatchers.has(watchPath)) return;

  try {
    const watcher = safeWatchFile(watchPath, (eventType) => {
      // Debounce: 100ms (same as Beam)
      const existing = watchDebounce.get(watchPath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        void (async () => {
          const currentTimer = watchDebounce.get(watchPath);
          if (currentTimer === timer) watchDebounce.delete(watchPath);

          // On macOS, editors like sed -i and some IDEs replace the file (new inode),
          // which kills the watcher. Re-watch via original path (symlink) so we
          // re-resolve to the new real path. Don't return — fall through to reload,
          // because the new watcher won't fire (file was already written before it was set up).
          if (eventType === 'rename') {
            unwatchPhotonFile(watchPath);
            if (fs.existsSync(photonPath)) {
              watchPhotonFile(photonName, photonPath);
            } else {
              // Photon file deleted (uninstalled) — unload all session managers for it
              logger.info('Photon file deleted — unloading', { photonName, path: photonPath });
              // Collect keys first — mutating Maps during a live async iterator is unsafe
              const keysToDelete = Array.from(photonPaths.entries())
                .filter(([, storedPath]) => storedPath === photonPath)
                .map(([key]) => key);
              for (const key of keysToDelete) {
                const manager = sessionManagers.get(key);
                if (manager) await manager.clearInstances();
                sessionManagers.delete(key);
                photonPaths.delete(key);
                workingDirs.delete(key);
              }
              stateKeysCache.delete(photonName);
              return;
            }
          }

          if (!fs.existsSync(photonPath)) return;

          logger.info('File changed, auto-reloading', { photonName, path: photonPath });

          // Invalidate cached state keys so they're re-extracted from fresh source
          stateKeysCache.delete(photonName);

          try {
            await reloadPhoton(photonName, photonPath);
          } catch (err) {
            logger.error('Hot-reload crashed — old instance preserved', {
              photonName,
              error: getErrorMessage(err),
            });
            publishToChannel(`system:${photonName}`, {
              event: 'photon-reload-failed',
              timestamp: Date.now(),
              error: getErrorMessage(err),
            });
          }
        })();
      }, 100);
      watchDebounce.set(watchPath, timer);
    });

    if ('on' in watcher && typeof (watcher as any).on === 'function') {
      (watcher as any).on('error', (err: Error) => {
        logger.warn('File watcher error', { photonName, error: getErrorMessage(err) });
        unwatchPhotonFile(watchPath);
      });
    }

    fileWatchers.set(watchPath, watcher);
    logger.info('Watching photon file', { photonName, path: watchPath });
  } catch (err) {
    logger.warn('Failed to watch photon file', { photonName, error: getErrorMessage(err) });
  }
}

function unwatchPhotonFile(watchPath: string): void {
  // watchPath must be the real path (key stored in fileWatchers)
  const watcher = fileWatchers.get(watchPath);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(watchPath);
  }
  const timer = watchDebounce.get(watchPath);
  if (timer) {
    clearTimeout(timer);
    watchDebounce.delete(watchPath);
  }
}

/**
 * Detect whether a missing workingDir was renamed (moved) or deleted.
 *
 * Strategy: scan sibling entries in the parent directory for one with the same
 * inode as the original workingDir. Inodes survive renames within the same
 * filesystem. If found → renamed. If not → deleted (or moved cross-filesystem).
 *
 * Returns the new path if renamed, null if deleted.
 */
function detectRenameOrDelete(workingDir: string): string | null {
  const originalInode = workingDirInodes.get(workingDir);
  if (originalInode === undefined) return null;

  const parentDir = path.dirname(workingDir);
  const dirName = path.basename(workingDir);

  try {
    const siblings = fs.readdirSync(parentDir);
    for (const sibling of siblings) {
      if (sibling === dirName) continue; // Original name — skip
      try {
        const sibPath = path.join(parentDir, sibling);
        const sibStat = fs.statSync(sibPath);
        if (sibStat.isDirectory() && sibStat.ino === originalInode) {
          return sibPath; // Same inode → this is the renamed directory
        }
      } catch {
        // Entry vanished between readdir and stat — skip
      }
    }
  } catch {
    // Parent dir unreadable
  }

  return null; // Not found in parent → deleted or moved cross-filesystem
}

/**
 * Watch the parent directory of a workingDir.
 *
 * Distinguishes between rename and delete using inode comparison:
 * - Rename (mv .photon .photon.bak): data preserved at new path.
 *   Update tracking maps to the new path; in-memory state stays alive.
 *   Note: photon modules cache STATE_DIR at import time, so a full daemon
 *   restart is still needed for writes to go to the new path.
 * - Delete (rm -rf, trash): data gone. Clear all in-memory instances so
 *   stale state isn't replayed into a freshly-created directory.
 *
 * We watch the PARENT because fs.watch on the workingDir itself dies when deleted.
 * One watcher is shared per unique parent directory.
 */
function watchWorkingDir(workingDir: string): void {
  const parentDir = path.dirname(workingDir);
  const dirName = path.basename(workingDir);

  // Default workingDir (~/.photon) is always present — no need to watch
  if (workingDir === getDefaultContext().baseDir) return;

  // Record inode now for rename detection later
  try {
    workingDirInodes.set(workingDir, fs.statSync(workingDir).ino);
  } catch {
    // Dir may not exist yet (will be created on first photon run)
  }

  // Already watching this parent
  if (parentDirWatchers.has(parentDir)) return;

  try {
    const watcher = safeWatchDir(parentDir, (eventType, filename) => {
      if (filename !== dirName) return;
      if (eventType !== 'rename') return;

      // Debounce: deletions/renames fire multiple events
      const debounceKey = `workingdir:${workingDir}`;
      const existing = watchDebounce.get(debounceKey);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        void (async () => {
          const currentTimer = watchDebounce.get(debounceKey);
          if (currentTimer === timer) watchDebounce.delete(debounceKey);

          if (fs.existsSync(workingDir)) {
            // Still exists — record updated inode in case it was recreated
            try {
              workingDirInodes.set(workingDir, fs.statSync(workingDir).ino);
            } catch {
              /* stat may fail if dir was just recreated */
            }
            return;
          }

          const renamedTo = detectRenameOrDelete(workingDir);

          if (renamedTo) {
            // RENAME: data is intact at the new path.
            // Migrate each session manager's loader baseDir to the new path so
            // subsequent loadFile calls set PHOTON_DIR correctly — photon
            // module-level constants (STATE_DIR, etc.) pick up the new location
            // on the next fresh import (loader uses ?t=Date.now() cache busting).
            logger.info('workingDir renamed — migrating sessions', {
              from: workingDir,
              to: renamedTo,
            });
            for (const [key, dir] of workingDirs.entries()) {
              if (dir !== workingDir) continue;
              workingDirs.set(key, renamedTo);
              const manager = sessionManagers.get(key);
              if (manager) {
                await manager.migrateBaseDir(renamedTo);
              }
            }
            workingDirInodes.delete(workingDir);
            workingDirInodes.set(renamedTo, fs.statSync(renamedTo).ino);
          } else {
            // DELETE: data is gone — clear all in-memory instances so stale
            // state isn't replayed into a fresh directory.
            logger.info('workingDir deleted — clearing all instances', { workingDir });
            // Collect keys first to avoid async mutation of live iterators
            const deletedDirKeys = Array.from(workingDirs.entries())
              .filter(([, dir]) => dir === workingDir)
              .map(([key]) => key);
            for (const key of deletedDirKeys) {
              const manager = sessionManagers.get(key);
              if (manager) await manager.clearInstances();
              sessionManagers.delete(key);
              photonPaths.delete(key);
              workingDirs.delete(key);
            }
            workingDirInodes.delete(workingDir);
          }
        })();
      }, 150);
      watchDebounce.set(debounceKey, timer);
    });

    if ('on' in watcher && typeof (watcher as any).on === 'function') {
      (watcher as any).on('error', (err: Error) => {
        logger.warn('workingDir parent watcher error', { parentDir, error: getErrorMessage(err) });
        parentDirWatchers.delete(parentDir);
      });
    }

    parentDirWatchers.set(parentDir, watcher);
    logger.info('Watching workingDir parent for changes', { workingDir, parentDir });
  } catch (err) {
    logger.warn('Failed to watch workingDir parent', { parentDir, error: getErrorMessage(err) });
  }
}

/**
 * Watch {workingDir}/state/ for photon-specific subdirectory deletions.
 * When state/{photon}/ is deleted, clear instances for that photon so
 * stale in-memory data isn't persisted back to the freshly-emptied location.
 *
 * Called when a session manager is first created (by which point the state
 * dir will exist or be created soon). Safe to call multiple times — skips
 * if already watching this workingDir's state dir.
 */
function watchStateDir(workingDir: string): void {
  if (stateDirWatchers.has(workingDir)) return;

  const stateDir = path.join(workingDir, 'state');

  // If state dir doesn't exist yet, watch the workingDir for its creation
  if (!fs.existsSync(stateDir)) {
    // Re-attempt after a short delay — state dir is created on first tool call
    setTimeout(() => watchStateDir(workingDir), 2000);
    return;
  }

  try {
    const watcher = safeWatchDir(stateDir, (eventType, filename) => {
      if (!filename || eventType !== 'rename') return;

      const debounceKey = `statedir:${workingDir}:${filename}`;
      const existing = watchDebounce.get(debounceKey);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        void (async () => {
          const currentTimer = watchDebounce.get(debounceKey);
          if (currentTimer === timer) watchDebounce.delete(debounceKey);

          const photonStateDir = path.join(stateDir, filename);
          if (fs.existsSync(photonStateDir)) return; // Still there — not a deletion

          // A photon's state subdir was deleted — clear its instances
          logger.info('Photon state dir deleted — clearing instances', {
            photon: filename,
            workingDir,
          });
          const key = compositeKey(filename, workingDir);
          const manager = sessionManagers.get(key);
          if (manager) {
            await manager.clearInstances();
          }
        })();
      }, 150);
      watchDebounce.set(debounceKey, timer);
    });

    if ('on' in watcher && typeof (watcher as any).on === 'function') {
      (watcher as any).on('error', (err: Error) => {
        logger.warn('State dir watcher error', { stateDir, error: getErrorMessage(err) });
        stateDirWatchers.delete(workingDir);
      });
    }

    stateDirWatchers.set(workingDir, watcher);
    logger.info('Watching state dir for photon subdir changes', { stateDir });
  } catch (err) {
    logger.warn('Failed to watch state dir', { stateDir, error: getErrorMessage(err) });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HOT RELOAD
// ════════════════════════════════════════════════════════════════════════════════

async function reloadPhoton(
  photonName: string,
  newPhotonPath: string,
  workingDir?: string
): Promise<{ success: boolean; error?: string; sessionsUpdated?: number }> {
  const key = compositeKey(photonName, workingDir);

  // Reload mutex: prevent concurrent reloads for the same photon
  // (format-on-save can trigger two rapid file change events)
  const existing = reloadMutex.get(key);
  if (existing) {
    logger.debug('Reload already in progress, waiting...', { photonName, key });
    await existing;
  }

  let mutexResolve: () => void;
  const mutexPromise = new Promise<void>((resolve) => {
    mutexResolve = resolve;
  });
  reloadMutex.set(key, mutexPromise);

  try {
    return await doReloadPhoton(photonName, newPhotonPath, workingDir, key);
  } finally {
    reloadMutex.delete(key);
    mutexResolve!();
  }
}

async function doReloadPhoton(
  photonName: string,
  newPhotonPath: string,
  workingDir: string | undefined,
  key: string
): Promise<{ success: boolean; error?: string; sessionsUpdated?: number }> {
  try {
    logger.info('Hot-reloading photon', { photonName, key, path: newPhotonPath });

    // If running in a worker, delegate reload to the worker
    if (workerManager.has(key)) {
      const result = await workerManager.reload(key, newPhotonPath);
      if (result.success) {
        publishToChannel(`system:${photonName}`, {
          event: 'photon-reloaded',
          timestamp: Date.now(),
          worker: true,
        });
        logger.info('Worker photon reloaded', { photonName });
        workerManager.resetCrashHistory(key);
      } else {
        publishToChannel(`system:${photonName}`, {
          event: 'photon-reload-failed',
          timestamp: Date.now(),
          error: result.error,
          worker: true,
        });
        logger.error('Worker photon reload failed — old instance preserved', {
          photonName,
          error: result.error,
        });
      }
      return {
        success: result.success,
        error: result.error,
        sessionsUpdated: result.success ? 1 : 0,
      };
    }

    const sessionManager = sessionManagers.get(key);
    if (!sessionManager) {
      // First time - just register the path and start watching
      photonPaths.set(key, newPhotonPath);
      watchPhotonFile(photonName, newPhotonPath);
      return { success: true, sessionsUpdated: 0 };
    }

    try {
      await sessionManager.loader.reloadFile(newPhotonPath);
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      logger.error('Failed to reload photon file — keeping old instances', {
        photonName,
        error: errorMessage,
      });
      publishToChannel(`system:${photonName}`, {
        event: 'photon-reload-failed',
        timestamp: Date.now(),
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }

    // Drain: wait for in-flight executions to complete before swapping instances
    const DRAIN_TIMEOUT_MS = 2000;
    const tracker = activeExecutions.get(key);
    if (tracker && tracker.count > 0) {
      logger.info('Draining in-flight executions before reload', {
        photonName,
        activeCount: tracker.count,
      });
      await Promise.race([
        new Promise<void>((resolve) => {
          tracker.drainResolve = resolve;
        }),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            logger.warn('Drain timeout, proceeding with reload', {
              photonName,
              activeCount: tracker.count,
              timeoutMs: DRAIN_TIMEOUT_MS,
            });
            resolve();
          }, DRAIN_TIMEOUT_MS)
        ),
      ]);
      // Clean up drain resolve if it was set but not called
      tracker.drainResolve = undefined;
    }

    const sessions = sessionManager.getSessions();
    let updatedCount = 0;

    for (const session of sessions) {
      try {
        // Skip onInitialize during load — we'll call it after state transfer
        const newMcp = await sessionManager.loader.loadFile(newPhotonPath, {
          skipInitialize: true,
        });
        const oldMcp = session.instance;

        // Call onShutdown on the old instance with hot-reload context.
        // The context lets the photon decide what to clean up — e.g. a WhatsApp photon
        // can skip closing its socket during hot-reload so the new instance can reuse it.
        if (oldMcp?.instance && typeof oldMcp.instance.onShutdown === 'function') {
          try {
            await oldMcp.instance.onShutdown({ reason: 'hot-reload' });
          } catch (err) {
            logger.warn('onShutdown failed during hot-reload', {
              photonName,
              error: getErrorMessage(err),
            });
          }
        }

        // Auto-transfer all non-function own properties from old to new instance.
        // This covers in-memory state (maps, arrays, flags, caches) without requiring
        // every photon to manually copy fields in onInitialize. Photons only need
        // onInitialize for non-copyable resources (sockets, timers, DB connections).
        if (oldMcp?.instance && newMcp?.instance && typeof oldMcp.instance === 'object') {
          for (const key of Object.keys(oldMcp.instance)) {
            const value = oldMcp.instance[key];
            if (typeof value !== 'function' && key !== 'constructor') {
              try {
                newMcp.instance[key] = value;
              } catch {
                // Some properties may be read-only (e.g. settings proxy)
              }
            }
          }
        }

        // Call onInitialize on the new instance with hot-reload context.
        // Always passes oldInstance so lifecycle photons can transfer non-copyable
        // resources (sockets, timers, polling loops) that auto-copy can't handle.
        if (newMcp?.instance && typeof newMcp.instance.onInitialize === 'function') {
          try {
            await newMcp.instance.onInitialize({
              reason: 'hot-reload',
              oldInstance: oldMcp?.instance,
            });
          } catch (err) {
            logger.warn('onInitialize failed during hot-reload', {
              photonName,
              error: getErrorMessage(err),
            });
          }
        }

        if (sessionManager.updateSessionInstance(session.id, newMcp)) {
          updatedCount++;
        }
      } catch (err) {
        logger.error('Failed to update session instance', {
          sessionId: session.id,
          error: getErrorMessage(err),
        });
      }
    }

    publishToChannel(`system:${photonName}`, {
      event: 'photon-reloaded',
      timestamp: Date.now(),
      sessionsUpdated: updatedCount,
    });

    // Refresh the stat-gate baseline so the next dispatch's stat check
    // sees the file it just loaded (not the stat from before this reload).
    recordPhotonSourceStat(key, newPhotonPath);

    logger.info('Photon reloaded successfully', { photonName, sessionsUpdated: updatedCount });
    return { success: true, sessionsUpdated: updatedCount };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Photon reload failed', { photonName, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// IDLE TIMER
// ════════════════════════════════════════════════════════════════════════════════

function startIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  if (idleTimeout <= 0) return;

  idleTimer = setTimeout(() => {
    let activeSubscribers = 0;
    for (const subs of channelSubscriptions.values()) {
      activeSubscribers += subs.size;
    }

    if (activeSubscribers > 0) {
      logger.debug('Active channel subscribers, staying alive', { activeSubscribers });
      startIdleTimer();
      return;
    }

    // Check if any session manager has recent activity
    let lastActivity = 0;
    for (const manager of sessionManagers.values()) {
      const activity = manager.getLastActivity();
      if (activity > lastActivity) {
        lastActivity = activity;
      }
    }

    const idleTime = Date.now() - lastActivity;
    if (idleTime >= idleTimeout && sessionManagers.size > 0) {
      logger.warn('Idle timeout reached, shutting down', { idleTime });
      shutdown();
    } else {
      startIdleTimer();
    }
  }, idleTimeout);
}

function resetIdleTimer(): void {
  startIdleTimer();
}

// ════════════════════════════════════════════════════════════════════════════════
// SELF-MONITORING (Health vitals every 15 minutes)
// ════════════════════════════════════════════════════════════════════════════════

const HEALTH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let prevCpuUsage: NodeJS.CpuUsage | null = null;
let prevCpuTime = 0;

interface HealthSnapshot {
  uptime: number;
  heapMB: number;
  rssMB: number;
  externalMB: number;
  cpuPercent: number;
  photonsLoaded: number;
  sessions: number;
  fileWatchers: number;
  channelSubs: number;
  eventBuffers: number;
  pendingPrompts: number;
  pollTimers: number;
  runtime: string;
}

function collectHealthSnapshot(): HealthSnapshot {
  const mem = process.memoryUsage();
  const now = Date.now();

  // Calculate CPU% since last check
  const cpuUsage = process.cpuUsage(prevCpuUsage ?? undefined);
  const elapsedMs = prevCpuTime > 0 ? now - prevCpuTime : HEALTH_INTERVAL_MS;
  const cpuTotalUs = cpuUsage.user + cpuUsage.system;
  const cpuPercent = elapsedMs > 0 ? (cpuTotalUs / 1000 / elapsedMs) * 100 : 0;

  prevCpuUsage = process.cpuUsage();
  prevCpuTime = now;

  let totalSessions = 0;
  for (const sm of sessionManagers.values()) {
    totalSessions += sm.getSessions().length;
  }

  return {
    uptime: Math.round(process.uptime()),
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    externalMB: Math.round((mem.external || 0) / 1024 / 1024),
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    photonsLoaded: sessionManagers.size,
    sessions: totalSessions,
    fileWatchers: fileWatchers.size,
    channelSubs: channelSubscriptions.size,
    eventBuffers: channelEventBuffers.size,
    pendingPrompts: pendingPrompts.size,
    pollTimers: pollTimers.size,
    runtime: process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`,
  };
}

function startHealthMonitor(): void {
  // Log initial state at startup
  const initial = collectHealthSnapshot();
  logger.info('Daemon health monitor started', { ...initial });

  const timer = setInterval(() => {
    const snap = collectHealthSnapshot();

    // Always log vitals
    logger.info('Health check', { ...snap });

    // Flag anomalies
    if (snap.cpuPercent > 50) {
      logger.warn('HIGH CPU detected', {
        cpuPercent: snap.cpuPercent,
        hint: 'Possible fs.watch loop or runaway handler',
      });
    }
    if (snap.heapMB > 512) {
      logger.warn('HIGH MEMORY detected', {
        heapMB: snap.heapMB,
        rssMB: snap.rssMB,
        eventBuffers: snap.eventBuffers,
        pendingPrompts: snap.pendingPrompts,
        hint: 'Check event buffers and pending prompts for leaks',
      });
    }
    if (snap.pendingPrompts > 10) {
      logger.warn('Pending prompts accumulating — possible socket leak', {
        count: snap.pendingPrompts,
      });
    }
  }, HEALTH_INTERVAL_MS);
  timer.unref();
}

// ════════════════════════════════════════════════════════════════════════════════
// SERVER
// ════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════════
// STARTUP WATCH (Proactive — all installed photons watched from daemon start)
// ════════════════════════════════════════════════════════════════════════════════

function startupWatchPhotons(): void {
  const photonDir = getDefaultContext().baseDir;
  if (!fs.existsSync(photonDir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(photonDir, { withFileTypes: true });
  } catch (err) {
    logger.warn('Failed to scan photon directory at startup', { error: getErrorMessage(err) });
    return;
  }

  const extensions = ['.photon.ts', '.photon.js'];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const ext = extensions.find((e) => entry.name.endsWith(e));
    if (!ext) continue;

    const photonName = entry.name.slice(0, -ext.length);
    const photonPath = path.join(photonDir, entry.name);
    photonPaths.set(photonName, photonPath);
    watchPhotonFile(photonName, photonPath);
  }

  logger.info('Startup watch registered', { count: fileWatchers.size, dir: photonDir });

  // Eagerly load photons with onInitialize — they may need to auto-resume
  const toEagerLoad: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const ext = extensions.find((e) => entry.name.endsWith(e));
    if (!ext) continue;

    const pName = entry.name.slice(0, -ext.length);
    const pPath = path.join(photonDir, entry.name);
    try {
      const source = fs.readFileSync(pPath, 'utf-8');
      if (/\bonInitialize\s*\(/.test(source)) {
        toEagerLoad.push({ name: pName, path: pPath });
      }
    } catch {
      /* skip unreadable files */
    }
  }

  if (toEagerLoad.length > 0) {
    logger.info('Eager-loading lifecycle photons', {
      count: toEagerLoad.length,
      names: toEagerLoad.map((p) => p.name),
    });
    // Defer to after server starts listening (so deps can be resolved)
    const eagerLoad = async (): Promise<void> => {
      for (const p of toEagerLoad) {
        try {
          const manager = await getOrCreateSessionManager(p.name, p.path);
          if (manager) {
            await manager.getOrLoadInstance('');
            logger.info('Eager-loaded lifecycle photon', {
              name: p.name,
              photonPath: p.path,
              ownerPid: process.pid,
            });
          }
        } catch (err) {
          logger.warn('Failed to eager-load lifecycle photon', {
            name: p.name,
            error: getErrorMessage(err),
          });
        }
      }
    };
    setTimeout(() => {
      if (!daemonOwnershipConfirmed) {
        logger.warn('Skipping eager lifecycle load before exclusive ownership confirmation', {
          socketPath,
          currentPid: process.pid,
        });
        return;
      }
      eagerLoad().catch(() => {});
    }, 1000);
  }

  // Watch the directory itself for new photon files added after startup
  try {
    const dirWatcher = safeWatchDir(photonDir, (eventType, filename) => {
      if (!filename) return;
      const ext = extensions.find((e) => filename.endsWith(e));
      if (!ext) return;

      const photonName = filename.slice(0, -ext.length);
      const filePath = path.join(photonDir, filename);

      // New file added — register and watch it
      if (!photonPaths.has(photonName) && fs.existsSync(filePath)) {
        photonPaths.set(photonName, filePath);
        watchPhotonFile(photonName, filePath);
        logger.info('Auto-discovered new photon', { photonName, path: filePath });
      }

      // File removed — clean up
      if (photonPaths.has(photonName) && !fs.existsSync(filePath)) {
        photonPaths.delete(photonName);
        const watcher = fileWatchers.get(photonName);
        if (watcher) {
          watcher.close();
          fileWatchers.delete(photonName);
        }
        logger.info('Photon file removed', { photonName, path: filePath });
      }
    });
    if ('on' in dirWatcher && typeof (dirWatcher as any).on === 'function') {
      (dirWatcher as any).on('error', () => {}); // Non-fatal
    }
  } catch {
    logger.warn('Failed to watch photon directory for new files', { dir: photonDir });
  }
}

function startServer(): void {
  const server = net.createServer((socket) => {
    logger.info('Client connected');
    connectedSockets.add(socket);

    let buffer = '';

    socket.on('data', (chunk) => {
      void (async () => {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            if (!isValidDaemonRequest(parsed)) {
              socket.write(
                JSON.stringify({ type: 'error', id: 'unknown', error: 'Invalid request format' }) +
                  '\n'
              );
              continue;
            }

            const request: DaemonRequest = parsed;
            const response = await handleRequest(request, socket);

            if (response !== null) {
              socket.write(JSON.stringify(response) + '\n');
            }
          } catch (error) {
            logger.error('Error processing request', { error: getErrorMessage(error) });
            socket.write(
              JSON.stringify({ type: 'error', id: 'unknown', error: getErrorMessage(error) }) + '\n'
            );
          }
        }
      })();
    });

    socket.on('end', () => {
      logger.info('Client disconnected');
      connectedSockets.delete(socket);
      cleanupSocketSubscriptions(socket);
    });

    socket.on('error', (error) => {
      logger.warn('Socket error', { error: getErrorMessage(error) });
      connectedSockets.delete(socket);
      cleanupSocketSubscriptions(socket);
    });

    socket.on('close', () => {
      connectedSockets.delete(socket);
      cleanupSocketSubscriptions(socket);
    });
  });

  daemonServer = server;

  server.listen(socketPath, () => {
    logger.info('Global Photon daemon listening', {
      socketPath,
      pid: process.pid,
      ownerPid: process.pid,
    });
  });

  server.on('error', (error: any) => {
    logger.error('Server error', { error: getErrorMessage(error) });
    process.exit(1);
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Safety net: catch unhandled errors so a bad photon can't crash the daemon
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception (daemon staying alive)', {
      error: getErrorMessage(err),
      stack: err?.stack,
    });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection (daemon staying alive)', {
      error: reason instanceof Error ? getErrorMessage(reason) : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

async function claimExclusiveOwnership(): Promise<void> {
  const owner = readOwnerRecord(ownerFile);
  if (owner && owner.socketPath === socketPath && owner.pid !== process.pid) {
    if (isPidAlive(owner.pid)) {
      logger.warn('Sibling daemon detected for socket', {
        socketPath,
        currentPid: process.pid,
        ownerPid: owner.pid,
        action: 'terminate-stale-owner',
      });
      try {
        process.kill(owner.pid, 'SIGTERM');
      } catch {
        // Ignore races with process exit
      }

      const exited = await waitForPidExit(owner.pid, 5000);
      if (!exited) {
        logger.error('Failed to gain exclusive daemon ownership', {
          socketPath,
          currentPid: process.pid,
          ownerPid: owner.pid,
          action: 'startup-rejected',
        });
        throw new Error(`Could not terminate sibling daemon ${owner.pid}`);
      }
    } else {
      logger.warn('Removing stale daemon owner record', {
        socketPath,
        currentPid: process.pid,
        ownerPid: owner.pid,
      });
    }

    removeOwnerRecord(ownerFile);
  }

  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    const responsive = await isSocketResponsive(socketPath);
    if (!responsive) {
      logger.warn('Removing stale daemon socket before listen', {
        socketPath,
        currentPid: process.pid,
      });
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Ignore races with other cleanup
      }
    }
  }

  writeOwnerRecord(ownerFile, {
    pid: process.pid,
    socketPath,
    claimedAt: Date.now(),
  });
  fs.writeFileSync(pidFile, process.pid.toString());
  daemonOwnershipConfirmed = true;

  logger.info('Daemon ownership claimed', {
    socketPath,
    currentPid: process.pid,
    ownerPid: process.pid,
    pidFile,
    ownerFile,
  });
}

function shutdown(): void {
  // Guard against multiple shutdown calls (e.g. SIGTERM + SIGINT in quick succession)
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Shutting down global daemon');

  // Step 1: Close the listener — stop accepting new connections
  if (daemonServer) {
    daemonServer.close();
  }

  // Step 2: Broadcast shutdown signal to all connected sockets
  const shutdownMessage =
    JSON.stringify({
      type: 'shutdown',
      id: 'daemon-shutdown',
      reason: 'daemon-shutting-down',
    }) + '\n';

  for (const socket of connectedSockets) {
    try {
      socket.write(shutdownMessage);
    } catch {
      // Socket may already be closed
    }
  }

  // Step 3: Async cleanup with grace period for shutdown message flush
  void (async () => {
    // Give sockets 500ms to receive the shutdown message
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    clearInterval(lockCleanupInterval);
    clearInterval(staleMapCleanupInterval);

    for (const timer of jobTimers.values()) {
      clearTimeout(timer);
    }
    jobTimers.clear();
    scheduledJobs.clear();
    activeLocks.clear();
    channelEventBuffers.clear();
    eventLogSeq.clear();
    stateKeysCache.clear();

    // Resolve any pending prompts so promises don't hang
    for (const [_id, pending] of pendingPrompts.entries()) {
      pending.resolve(null);
    }
    pendingPrompts.clear();
    socketPromptIds.clear();

    // Close file watchers and debounce timers
    for (const photonPath of fileWatchers.keys()) {
      unwatchPhotonFile(photonPath);
    }

    // Clean up poll-based watchers (bun fallback)
    for (const timer of pollTimers) {
      clearInterval(timer);
    }
    pollTimers.clear();

    // Terminate all worker threads FIRST (before session destroy,
    // so @photon deps in workers still respond during onShutdown)
    try {
      await workerManager.terminateAll();
    } catch (err) {
      logger.warn('Error terminating workers during shutdown', { error: getErrorMessage(err) });
    }

    // Gracefully destroy all session managers (calls onShutdown on instances)
    await Promise.allSettled(Array.from(sessionManagers.values()).map((m) => m.destroyGraceful()));
    sessionManagers.clear();

    if (webhookServer) {
      webhookServer.close();
    }

    if (daemonOwnershipConfirmed) {
      const owner = readOwnerRecord(ownerFile);
      if (owner?.pid === process.pid && owner.socketPath === socketPath) {
        removeOwnerRecord(ownerFile, process.pid);
      }

      try {
        const pidContent = fs.readFileSync(pidFile, 'utf-8').trim();
        if (parseInt(pidContent, 10) === process.pid) {
          fs.unlinkSync(pidFile);
        }
      } catch {
        // Ignore missing pid file
      }
    }

    // Only delete the socket if we still own it.
    // After `daemon stop` + `daemon start`, a new daemon may have already created
    // a new socket at this path. Deleting it would orphan the new daemon's listener.
    if (fs.existsSync(socketPath) && process.platform !== 'win32') {
      let weOwnSocket = true;
      try {
        const pidContent = fs.readFileSync(pidFile, 'utf-8').trim();
        const filePid = parseInt(pidContent, 10);
        if (!isNaN(filePid) && filePid !== process.pid) {
          // PID file points to a different process — new daemon already started
          weOwnSocket = false;
          logger.info('Socket belongs to new daemon, skipping cleanup', {
            ourPid: process.pid,
            newPid: filePid,
          });
        }
      } catch {
        // PID file missing (deleted by stop) — another process may own the socket now.
        // If the socket still exists, it likely belongs to a new daemon. Don't delete.
        weOwnSocket = false;
      }

      if (weOwnSocket) {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    process.exit(0);
  })();
}

// Main execution
void (async () => {
  await claimExclusiveOwnership();
  startupWatchPhotons();
  startServer();
  migrateLegacyIpcSchedules();
  loadAllPersistedSchedules();
  void (async () => {
    await discoverProactiveMetadataAtBoot();
    syncActiveSchedulesAtBoot();
    try {
      sweepExecutionHistoryBases(listActiveBases().map((b) => b.path));
    } catch (err) {
      logger.debug('Execution-history sweep skipped', { error: getErrorMessage(err) });
    }
  })();
  startWebhookServer(WEBHOOK_PORT);
  startIdleTimer();
  startHealthMonitor();

  // Notify photons that any locks from a prior daemon session are gone
  publishToChannel('system:*', {
    event: 'locks-reset',
    reason: 'daemon-startup',
    timestamp: Date.now(),
  });
})().catch((err) => {
  logger.error('Daemon startup failed', { error: getErrorMessage(err) });
  process.exit(1);
});
