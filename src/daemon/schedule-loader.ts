/**
 * Boot-time persisted-schedule loader.
 *
 * Extracted from server.ts so the logic can be imported by tests
 * without triggering the daemon's bootstrap IIFE. The loader handles
 * BOTH on-disk formats:
 *
 *   - IPC (`source: 'ipc'`): written by `photon ps enable` and similar
 *     CLI hooks. Carries `photonName`, `args`, and `workingDir` on the
 *     task itself. TTL-swept after 30 days of inactivity.
 *   - ScheduleProvider: written by `this.schedule.create()` at runtime
 *     from photon code. Carries `params` (mapped to args) and `status`.
 *     The photon name is inferred from the directory path and passed
 *     in as `photonNameHint`. NOT TTL-swept — lifecycle is owned by
 *     the photon that created it.
 *
 * Before this unification, the boot scanner only handled IPC and every
 * ScheduleProvider file was silently skipped (`source !== 'ipc'`). That
 * caused schedules to stay dormant across daemon restarts until the
 * owning photon happened to be invoked and triggered the lazy
 * `autoRegisterFromMetadata` path.
 */

import fs from 'fs';
import path from 'path';

export interface PersistedScheduleJob {
  id: string;
  method: string;
  args: Record<string, unknown>;
  cron: string;
  runCount: number;
  createdAt: number;
  createdBy: string;
  photonName: string;
  workingDir?: string;
  photonPath?: string;
  /**
   * Absolute path of the backing JSON file this job was loaded from.
   * The fire handler uses it to drop phantom registrations whose
   * backing file has been unlinked (e.g. via
   * `this.schedule.cancel()`) out from under the in-memory cron map.
   */
  sourceFile?: string;
}

export interface LoadScheduleCallbacks {
  /** Called for every valid job. Return `true` if the engine accepted it. */
  register: (job: PersistedScheduleJob) => boolean;
  /** True if the given job id is already known to the cron engine. */
  alreadyRegistered: (jobId: string) => boolean;
  /** Optional logger hooks — no-op by default. */
  warn?: (msg: string, ctx?: Record<string, unknown>) => void;
  info?: (msg: string, ctx?: Record<string, unknown>) => void;
}

/**
 * Scan one directory of schedule JSON files and hand every valid job
 * to `cb.register`. Returns counts of loaded + skipped for logging.
 *
 * @param schedulesPath Directory containing {taskId}.json files.
 * @param ttlMs Age in ms above which untouched IPC jobs are deleted.
 *              ScheduleProvider jobs ignore TTL (photon owns them).
 * @param photonNameHint Used when task doesn't carry its own
 *                       `photonName` (ScheduleProvider case — photon
 *                       name is the parent directory's basename).
 * @param workingDirHint Fallback working dir when task lacks one
 *                       (the base dir that owns this schedule tree).
 * @param cb Engine hooks.
 */
export function loadPersistedSchedulesFromDir(
  schedulesPath: string,
  ttlMs: number,
  photonNameHint: string | null,
  workingDirHint: string | undefined,
  cb: LoadScheduleCallbacks
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

      const isIpc = task.source === 'ipc';
      const photonName = task.photonName || photonNameHint;

      if (!task.id || !task.method || !task.cron || !photonName) {
        cb.warn?.('Skipping invalid persisted schedule', { file: filePath });
        skipped++;
        continue;
      }

      // Respect explicit pause/complete from ScheduleProvider tasks.
      if (!isIpc && task.status && task.status !== 'active') {
        skipped++;
        continue;
      }

      // TTL applies only to IPC jobs — ScheduleProvider files are owned
      // by the photon that created them and must persist until that
      // photon removes them.
      const lastExec = task.lastExecutionAt ? new Date(task.lastExecutionAt).getTime() : 0;
      const created = task.createdAt ? new Date(task.createdAt).getTime() : 0;
      const lastActivity = Math.max(lastExec, created);
      if (isIpc && lastActivity > 0 && Date.now() - lastActivity > ttlMs) {
        cb.info?.('Removing expired schedule (TTL)', {
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

      // ScheduleProvider ids are namespaced so they can't collide with
      // raw IPC ids, and they read `params` where IPC reads `args`.
      const jobId = isIpc ? task.id : `${photonName}:sched:${task.id}`;
      const jobArgs = isIpc ? task.args || {} : task.params || {};
      const jobWorkingDir = task.workingDir || workingDirHint;

      if (cb.alreadyRegistered(jobId)) continue;

      const job: PersistedScheduleJob = {
        id: jobId,
        method: task.method,
        args: jobArgs,
        cron: task.cron,
        runCount: task.executionCount || 0,
        createdAt: created || Date.now(),
        createdBy: task.createdBy || (isIpc ? 'ipc' : 'schedule-provider'),
        photonName,
        workingDir: jobWorkingDir,
        sourceFile: filePath,
      };

      if (cb.register(job)) {
        loaded++;
      } else {
        cb.warn?.('Failed to schedule persisted job (invalid cron?)', { jobId });
        skipped++;
      }
    } catch (err) {
      cb.warn?.('Failed to load persisted schedule file', {
        file: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  return { loaded, skipped };
}
