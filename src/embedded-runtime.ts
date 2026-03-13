/**
 * Embedded Runtime
 *
 * Lightweight in-process runtime for compiled photon binaries.
 * Provides the subset of daemon functionality needed to run standalone:
 * - In-process pub/sub broker (replaces daemon Unix socket broker)
 * - In-process cron scheduler (replaces daemon job scheduler)
 *
 * This module is bundled into the binary by Bun, so the binary
 * is fully self-contained — no external daemon needed.
 */

import { setBroker } from '@portel/photon-core';
import type {
  ChannelBroker,
  ChannelMessage,
  ChannelHandler,
  Subscription,
} from '@portel/photon-core';
import type { PhotonClassExtended } from '@portel/photon-core';
import { createLogger } from './shared/logger.js';
import { getErrorMessage } from './shared/error-handler.js';

const logger = createLogger({ component: 'embedded-runtime', minimal: true });

// ════════════════════════════════════════════════════════════════════════════════
// IN-PROCESS BROKER
// ════════════════════════════════════════════════════════════════════════════════

class EmbeddedBroker implements ChannelBroker {
  readonly type = 'embedded';
  private handlers = new Map<string, Set<ChannelHandler>>();

  async publish(message: ChannelMessage): Promise<void> {
    const channel = message.channel;

    // Deliver to exact channel subscribers
    const handlers = this.handlers.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch (err) {
          logger.warn('Broker handler error', { channel, error: getErrorMessage(err) });
        }
      }
    }

    // Deliver to wildcard subscribers (e.g. "task:*" matches "task:completed")
    for (const [pattern, patternHandlers] of this.handlers) {
      if (pattern.endsWith(':*') && channel.startsWith(pattern.slice(0, -1))) {
        for (const handler of patternHandlers) {
          try {
            handler(message);
          } catch (err) {
            logger.warn('Broker wildcard handler error', {
              pattern,
              channel,
              error: getErrorMessage(err),
            });
          }
        }
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

// ════════════════════════════════════════════════════════════════════════════════
// IN-PROCESS SCHEDULER
// ════════════════════════════════════════════════════════════════════════════════

interface ScheduledJob {
  id: string;
  method: string;
  args?: Record<string, unknown>;
  cron: string;
  nextRun?: number;
  runCount: number;
}

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  if (field.includes(',')) {
    const values = new Set<number>();
    for (const part of field.split(',')) {
      const partValues = parseCronField(part, min, max);
      if (!partValues) return null;
      partValues.forEach((v) => values.add(v));
    }
    return Array.from(values).sort((a, b) => a - b);
  }
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
  if (field.includes('-')) {
    const [s, e] = field.split('-').map(Number);
    if (isNaN(s) || isNaN(e) || s < min || e > max) return null;
    const values: number[] = [];
    for (let i = s; i <= e; i++) values.push(i);
    return values;
  }
  const value = parseInt(field);
  if (isNaN(value) || value < min || value > max) return null;
  return [value];
}

function getNextCronRun(cron: string): { isValid: boolean; nextRun: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { isValid: false, nextRun: 0 };

  const [minuteField, hourField, domField, monthField, dowField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 7);

  if (!minutes || !hours || !doms || !months || !dows) {
    return { isValid: false, nextRun: 0 };
  }

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(doms);
  const monthSet = new Set(months);
  const dowSet = new Set(dows.map((d) => (d === 7 ? 0 : d)));

  const domIsWild = domField === '*';
  const dowIsWild = dowField === '*';

  const candidate = new Date();
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(candidate);
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate < limit) {
    if (!monthSet.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(1);
      candidate.setHours(0);
      candidate.setMinutes(0);
      continue;
    }

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

class EmbeddedScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private timers = new Map<string, NodeJS.Timeout>();
  private mcp: PhotonClassExtended | null = null;
  private loader: {
    executeTool: (mcp: any, method: string, args: Record<string, unknown>) => Promise<any>;
  } | null = null;

  setExecutionTarget(
    mcp: PhotonClassExtended,
    loader: {
      executeTool: (mcp: any, method: string, args: Record<string, unknown>) => Promise<any>;
    }
  ) {
    this.mcp = mcp;
    this.loader = loader;
  }

  schedule(job: ScheduledJob): boolean {
    const { isValid, nextRun } = getNextCronRun(job.cron);
    if (!isValid) {
      logger.error('Invalid cron expression', { jobId: job.id, cron: job.cron });
      return false;
    }

    job.nextRun = nextRun;
    this.jobs.set(job.id, job);

    const existing = this.timers.get(job.id);
    if (existing) clearTimeout(existing);

    const delay = nextRun - Date.now();
    const timer = setTimeout(() => void this.runJob(job.id), delay);
    this.timers.set(job.id, timer);

    logger.info('Job scheduled', {
      jobId: job.id,
      method: job.method,
      nextRun: new Date(nextRun).toISOString(),
    });
    return true;
  }

  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (!this.mcp || !this.loader) {
      logger.warn('Cannot run job — photon not initialized', { jobId });
      this.schedule(job); // Reschedule
      return;
    }

    logger.info('Running scheduled job', { jobId, method: job.method });

    try {
      await this.loader.executeTool(this.mcp, job.method, job.args || {});
      job.runCount++;
      logger.info('Job completed', { jobId, method: job.method, runCount: job.runCount });
    } catch (error) {
      logger.error('Job failed', { jobId, method: job.method, error: getErrorMessage(error) });
    }

    // Reschedule for next occurrence
    this.schedule(job);
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.jobs.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Embedded runtime for compiled photon binaries.
 * Call `start()` before `PhotonServer.start()` to wire up the in-process broker and scheduler.
 */
export class EmbeddedRuntime {
  private broker: EmbeddedBroker;
  private scheduler: EmbeddedScheduler;

  constructor() {
    this.broker = new EmbeddedBroker();
    this.scheduler = new EmbeddedScheduler();
  }

  /**
   * Start the embedded runtime.
   * Sets the global broker so all photon pub/sub works in-process.
   */
  start() {
    setBroker(this.broker);
    logger.info('Embedded runtime started (in-process broker + scheduler)');
  }

  /**
   * Register scheduled jobs from a loaded photon's tool metadata.
   * Call after PhotonServer.start() once the photon is loaded.
   */
  registerScheduledJobs(
    mcp: PhotonClassExtended,
    loader: {
      executeTool: (mcp: any, method: string, args: Record<string, unknown>) => Promise<any>;
    }
  ) {
    this.scheduler.setExecutionTarget(mcp, loader);

    for (const tool of mcp.tools) {
      // The schema extractor adds `scheduled` to tool objects (not in PhotonTool type)
      const cronExpr = (tool as any).scheduled as string | undefined;
      if (cronExpr) {
        this.scheduler.schedule({
          id: `auto-${tool.name}`,
          method: tool.name,
          cron: cronExpr,
          runCount: 0,
        });
      }
    }
  }

  /**
   * Stop the runtime and clean up timers.
   */
  stop() {
    this.scheduler.stop();
    void this.broker.disconnect();
  }
}
