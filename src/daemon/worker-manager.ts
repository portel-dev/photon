/**
 * Worker Manager — supervises per-photon worker threads
 *
 * Manages the lifecycle of isolated worker threads for photons tagged with @worker.
 * Provides the same interface as in-process execution so the daemon's request
 * handler doesn't need to know whether a photon is in-process or in a worker.
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import type { MainToWorkerMessage, WorkerToMainMessage, WorkerInit } from './worker-protocol.js';

export interface WorkerInfo {
  worker: Worker;
  photonName: string;
  photonPath: string;
  workingDir?: string;
  tools: Array<{ name: string; description?: string }>;
  ready: boolean;
  crashCount: number;
  lastCrash?: number;
  /** Sliding window of crash timestamps (last 5 minutes) for backoff decisions */
  crashTimestamps: number[];
  /** If set, the worker is in backoff and should not be respawned until this time */
  backoffUntil?: number;
  /** Guard against double-counting crash from error + exit events in the same cycle */
  crashHandled: boolean;
  /** Channels this worker is subscribed to */
  subscribedChannels: Set<string>;
}

interface PendingCall {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

export class WorkerManager {
  private workers = new Map<string, WorkerInfo>();
  private pendingCalls = new Map<string, PendingCall>();
  private logger: Logger;
  /** Callback to resolve @photon deps through the main thread */
  public depResolver?: (
    depName: string,
    depPath: string,
    workerPhoton: string
  ) => Promise<{ toolNames: string[] } | null>;
  /** Callback to execute a dep method through the main thread */
  public depCaller?: (
    depName: string,
    method: string,
    args: Record<string, unknown>
  ) => Promise<any>;
  /** Callback to forward worker pub/sub to main broker */
  public onPublish?: (channel: string, message: unknown) => void;
  /** Callback when worker subscribes to a channel */
  public onSubscribe?: (workerKey: string, channel: string) => void;
  /** Callback when worker unsubscribes from a channel */
  public onUnsubscribe?: (workerKey: string, channel: string) => void;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'worker-manager' });
  }

  /** Check if a photon is running in a worker */
  has(key: string): boolean {
    return this.workers.has(key);
  }

  /** Get info for a worker-hosted photon */
  get(key: string): WorkerInfo | undefined {
    return this.workers.get(key);
  }

  /** Get all worker keys */
  keys(): IterableIterator<string> {
    return this.workers.keys();
  }

  /** Spawn a worker thread for a photon */
  async spawn(
    key: string,
    photonName: string,
    photonPath: string,
    workingDir?: string
  ): Promise<WorkerInfo> {
    // Kill existing worker if any
    if (this.workers.has(key)) {
      await this.terminate(key, 'respawn');
    }

    const workerInit: WorkerInit = { photonName, photonPath, workingDir };

    // Resolve the worker-host entry point relative to this file
    const hostPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'worker-host.js');

    // Verify the file exists (it should after build)
    if (!fs.existsSync(hostPath)) {
      throw new Error(`Worker host not found at ${hostPath}. Run the build step first.`);
    }

    const worker = new Worker(hostPath, {
      workerData: workerInit,
      // Share the parent's env so photons can read PHOTON_DIR, etc.
      env: { ...process.env },
    });

    const info: WorkerInfo = {
      worker,
      photonName,
      photonPath,
      workingDir,
      tools: [],
      ready: false,
      crashCount: 0,
      crashTimestamps: [],
      crashHandled: false,
      subscribedChannels: new Set(),
    };

    this.workers.set(key, info);

    // Wait for ready or crash. The per-phase timeout resets on each progress message
    // so slow-but-active initialization (npm install, onInitialize) won't fail.
    // The absolute ceiling prevents indefinite waits from cascading dep resolution.
    const SPAWN_TIMEOUT_MS = 60_000;
    const ABSOLUTE_CEILING_MS = 120_000;
    return new Promise<WorkerInfo>((resolve, reject) => {
      let timeout = setTimeout(() => {
        void failSpawn(
          new Error(`Worker for ${photonName} did not become ready within 60s`),
          'timeout'
        );
      }, SPAWN_TIMEOUT_MS);

      // Absolute ceiling: no matter how many progress resets, fail after this
      const ceilingTimeout = setTimeout(() => {
        void failSpawn(
          new Error(
            `Worker for ${photonName} exceeded absolute timeout of ${ABSOLUTE_CEILING_MS / 1000}s`
          ),
          'ceiling-timeout'
        );
      }, ABSOLUTE_CEILING_MS);

      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          void failSpawn(
            new Error(`Worker for ${photonName} did not become ready within 60s (stalled)`),
            'timeout'
          );
        }, SPAWN_TIMEOUT_MS);
      };

      let settled = false;
      const failSpawn = async (error: Error, reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(ceilingTimeout);
        try {
          await this.terminate(key, reason);
        } catch {
          // Best effort cleanup before surfacing the spawn failure.
        }
        reject(error);
      };

      const onMessage = (msg: WorkerToMainMessage) => {
        if (msg.type === 'ready') {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearTimeout(ceilingTimeout);
          info.tools = msg.tools;
          info.ready = true;
          this.logger.info('Worker ready', { photonName, tools: msg.tools.length });
          // Switch to permanent message handler
          worker.off('message', onMessage);
          worker.on('message', (m: WorkerToMainMessage) => this.handleWorkerMessage(key, m));
          resolve(info);
        } else if (msg.type === 'progress') {
          this.logger.info('Worker init progress', { photonName, phase: msg.phase });
          resetTimeout();
        } else if (msg.type === 'crashed') {
          this.logger.error('Worker crashed during init', { photonName, error: msg.error });
          void failSpawn(new Error(msg.error), 'crash');
        } else if (
          msg.type === 'resolve_dep' ||
          msg.type === 'dep_call' ||
          msg.type === 'publish' ||
          msg.type === 'subscribe' ||
          msg.type === 'unsubscribe' ||
          msg.type === 'log'
        ) {
          // Workers send these during initialization (before 'ready'), e.g. when
          // resolving @photon deps. Route them through the permanent handler so
          // dep resolution doesn't silently stall waiting for a response.
          this.handleWorkerMessage(key, msg);
          resetTimeout(); // Active init work — reset the stall timer
        }
      };

      worker.on('message', onMessage);

      worker.on('error', (err) => {
        if (settled) return;
        this.logger.error('Worker thread error', { photonName, error: getErrorMessage(err) });
        // Record crash once (exit event may also fire for same failure)
        if (!info.crashHandled) {
          info.crashHandled = true;
          this.recordCrash(info);
        }
        void failSpawn(err, 'error');
      });

      worker.on('exit', (code) => {
        clearTimeout(timeout);
        clearTimeout(ceilingTimeout);
        if (code !== 0) {
          this.logger.warn('Worker exited unexpectedly', { photonName, code });
          // Only count if error handler didn't already handle this cycle
          if (!info.crashHandled) {
            this.recordCrash(info);
          }
          info.ready = false;
          // Schedule auto-respawn if not in backoff
          this.scheduleRespawn(key, info);
        }
        // Reset crash guard for next lifecycle
        info.crashHandled = false;
        // Clean up pending calls for this worker
        for (const [id, pending] of this.pendingCalls) {
          if (pending.resolved) continue;
          pending.resolved = true;
          clearTimeout(pending.timer);
          pending.reject(new Error(`Worker ${photonName} exited (code ${code})`));
          this.pendingCalls.delete(id);
        }
      });
    });
  }

  /** Send a tool call to a worker and return the result */
  async call(
    key: string,
    method: string,
    args: Record<string, unknown>,
    sessionId: string,
    instanceName: string = '',
    timeoutMs: number = 300_000
  ): Promise<{ success: boolean; data?: unknown; error?: string; durationMs?: number }> {
    const info = this.workers.get(key);
    if (!info?.ready) {
      // Check if in backoff cooldown
      if (info?.backoffUntil && Date.now() < info.backoffUntil) {
        const waitSec = Math.ceil((info.backoffUntil - Date.now()) / 1000);
        return {
          success: false,
          error: `Worker ${key} crashed repeatedly, in cooldown for ${waitSec}s`,
        };
      }
      return { success: false, error: `Worker ${key} not ready` };
    }

    const id = `wc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const pending: PendingCall = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (pending.resolved) return;
          pending.resolved = true;
          this.pendingCalls.delete(id);
          resolve({
            success: false,
            error: `Worker call ${method} timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs),
        resolved: false,
      };

      this.pendingCalls.set(id, pending);

      const msg: MainToWorkerMessage = { type: 'call', id, method, args, sessionId, instanceName };
      info.worker.postMessage(msg);
    });
  }

  /** Trigger hot-reload in a worker */
  async reload(key: string, photonPath: string): Promise<{ success: boolean; error?: string }> {
    const info = this.workers.get(key);
    if (!info) {
      return { success: false, error: `No worker for ${key}` };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Worker reload timed out after 30s' });
      }, 30_000);

      const onReloadResult = (msg: WorkerToMainMessage) => {
        if (msg.type === 'reload_result') {
          clearTimeout(timeout);
          info.worker.off('message', onReloadResult);
          if (msg.success && msg.tools) {
            info.tools = msg.tools;
            info.photonPath = photonPath;
          }
          resolve({ success: msg.success, error: msg.error });
        }
      };

      // Temporarily listen for reload result
      info.worker.on('message', onReloadResult);

      const msg: MainToWorkerMessage = { type: 'reload', photonPath };
      info.worker.postMessage(msg);
    });
  }

  /** Forward a channel message to workers subscribed to that channel */
  dispatchToWorkers(channel: string, message: unknown): void {
    for (const info of this.workers.values()) {
      if (info.subscribedChannels.has(channel) && info.ready) {
        const msg: MainToWorkerMessage = { type: 'channel_message', channel, message };
        info.worker.postMessage(msg);
      }
    }
  }

  /** Gracefully terminate a worker */
  async terminate(key: string, reason: string = 'shutdown'): Promise<void> {
    const info = this.workers.get(key);
    if (!info) return;

    this.logger.info('Terminating worker', { photonName: info.photonName, reason });

    try {
      const msg: MainToWorkerMessage = { type: 'shutdown', reason };
      info.worker.postMessage(msg);
      // Give it 5s to shut down gracefully
      await Promise.race([
        new Promise<void>((resolve) => info.worker.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Force terminate
      await info.worker.terminate();
    }

    this.workers.delete(key);
  }

  /** Terminate all workers */
  async terminateAll(): Promise<void> {
    const keys = Array.from(this.workers.keys());
    await Promise.all(keys.map((k) => this.terminate(k, 'daemon-shutdown')));
  }

  /** Handle messages from a worker */
  private handleWorkerMessage(key: string, msg: WorkerToMainMessage): void {
    const info = this.workers.get(key);

    switch (msg.type) {
      case 'result': {
        const pending = this.pendingCalls.get(msg.id);
        if (pending && !pending.resolved) {
          pending.resolved = true;
          clearTimeout(pending.timer);
          this.pendingCalls.delete(msg.id);
          pending.resolve({
            success: msg.success,
            data: msg.data,
            error: msg.error,
            durationMs: msg.durationMs,
          });
        }
        break;
      }

      case 'emit': {
        const pending = this.pendingCalls.get(msg.id);
        if (pending) {
          // Generator yields — for now, we accumulate and resolve at the end
          // TODO: Support streaming yields back to the client
        }
        break;
      }

      case 'crashed': {
        this.logger.error('Worker reported crash', { key, error: msg.error });
        if (info) {
          if (!info.crashHandled) {
            info.crashHandled = true;
            this.recordCrash(info);
          }
          info.ready = false;
        }
        break;
      }

      case 'resolve_dep': {
        void this.handleDepResolve(key, msg.id, msg.depName, msg.depPath);
        break;
      }

      case 'dep_call': {
        void this.handleDepCall(key, msg.id, msg.depName, msg.method, msg.args);
        break;
      }

      case 'publish': {
        this.onPublish?.(msg.channel, msg.message);
        break;
      }

      case 'subscribe': {
        if (info) info.subscribedChannels.add(msg.channel);
        this.onSubscribe?.(key, msg.channel);
        break;
      }

      case 'unsubscribe': {
        if (info) info.subscribedChannels.delete(msg.channel);
        this.onUnsubscribe?.(key, msg.channel);
        break;
      }

      case 'log': {
        this.logger[msg.level](`[worker:${info?.photonName}] ${msg.message}`, msg.meta || {});
        break;
      }
    }
  }

  /** Handle @photon dependency resolution from a worker */
  private async handleDepResolve(
    workerKey: string,
    requestId: string,
    depName: string,
    depPath: string
  ): Promise<void> {
    const info = this.workers.get(workerKey);
    if (!info) return;

    try {
      const result = this.depResolver
        ? await this.depResolver(depName, depPath, info.photonName)
        : null;

      if (result) {
        const msg: MainToWorkerMessage = {
          type: 'dep_resolved',
          id: requestId,
          depName,
          toolNames: result.toolNames,
        };
        info.worker.postMessage(msg);
      } else {
        // Resolve with empty tools — worker will get a no-op proxy
        const msg: MainToWorkerMessage = {
          type: 'dep_resolved',
          id: requestId,
          depName,
          toolNames: [],
        };
        info.worker.postMessage(msg);
      }
    } catch (err) {
      this.logger.warn('Dep resolution failed', { depName, error: getErrorMessage(err) });
      const msg: MainToWorkerMessage = {
        type: 'dep_resolved',
        id: requestId,
        depName,
        toolNames: [],
      };
      info.worker.postMessage(msg);
    }
  }

  /** Handle @photon dependency method call from a worker */
  private async handleDepCall(
    workerKey: string,
    requestId: string,
    depName: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const info = this.workers.get(workerKey);
    if (!info) return;

    try {
      const result = this.depCaller ? await this.depCaller(depName, method, args) : undefined;

      const msg: MainToWorkerMessage = {
        type: 'dep_call_result',
        id: requestId,
        success: true,
        data: result,
      };
      info.worker.postMessage(msg);
    } catch (err) {
      const msg: MainToWorkerMessage = {
        type: 'dep_call_result',
        id: requestId,
        success: false,
        error: getErrorMessage(err),
      };
      info.worker.postMessage(msg);
    }
  }

  /** Record a crash event in the sliding window */
  private recordCrash(info: WorkerInfo): void {
    const now = Date.now();
    info.crashCount++;
    info.lastCrash = now;
    info.crashTimestamps.push(now);
    // Keep only crashes from the last 5 minutes
    const WINDOW_MS = 5 * 60 * 1000;
    info.crashTimestamps = info.crashTimestamps.filter((t) => now - t < WINDOW_MS);
  }

  /** Schedule auto-respawn with exponential backoff, or enter cooldown if too many crashes */
  private scheduleRespawn(key: string, info: WorkerInfo): void {
    const MAX_CRASHES_IN_WINDOW = 3;
    const COOLDOWN_MS = 60_000;

    const recentCrashes = info.crashTimestamps.length;

    if (recentCrashes >= MAX_CRASHES_IN_WINDOW) {
      info.backoffUntil = Date.now() + COOLDOWN_MS;
      this.logger.warn('Worker crash limit reached, entering cooldown', {
        photonName: info.photonName,
        recentCrashes,
        cooldownMs: COOLDOWN_MS,
      });
      // After cooldown, clear backoff so next call can attempt spawn
      setTimeout(() => {
        if (info.backoffUntil && Date.now() >= info.backoffUntil) {
          info.backoffUntil = undefined;
          this.logger.info('Worker cooldown expired, ready for respawn', {
            photonName: info.photonName,
          });
        }
      }, COOLDOWN_MS);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s... up to 30s
    const delay = Math.min(1000 * Math.pow(2, recentCrashes - 1), 30_000);
    this.logger.info('Scheduling worker respawn', {
      photonName: info.photonName,
      delayMs: delay,
      attempt: recentCrashes,
    });

    setTimeout(() => {
      if (info.ready || info.backoffUntil) return; // Already recovered or in cooldown
      this.logger.info('Auto-respawning worker', { photonName: info.photonName });
      void this.spawn(key, info.photonName, info.photonPath, info.workingDir).catch((err) => {
        this.logger.warn('Worker respawn failed', {
          photonName: info.photonName,
          error: getErrorMessage(err),
        });
      });
    }, delay);
  }

  /** Reset crash history for a worker (e.g. after hot-reload with new code) */
  resetCrashHistory(key: string): void {
    const info = this.workers.get(key);
    if (info) {
      info.crashCount = 0;
      info.crashTimestamps = [];
      info.backoffUntil = undefined;
      info.crashHandled = false;
    }
  }
}
