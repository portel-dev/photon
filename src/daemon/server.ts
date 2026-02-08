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
import { SessionManager } from './session-manager.js';
import {
  DaemonRequest,
  DaemonResponse,
  isValidDaemonRequest,
  type ScheduledJob,
  type LockInfo,
} from './protocol.js';
import { setPromptHandler, type PromptHandler } from '@portel/photon-core';
import { createLogger, Logger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { timingSafeEqual, readBody, SimpleRateLimiter } from '../shared/security.js';

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

// Map of photonName -> SessionManager (lazy initialized)
const sessionManagers = new Map<string, SessionManager>();
const photonPaths = new Map<string, string>(); // photonName -> photonPath

let idleTimeout = 600000; // 10 minutes default
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
  id: number;
  channel: string;
  message: unknown;
  timestamp: number;
}

interface ChannelBuffer {
  events: BufferedEvent[];
  nextId: number;
}

const EVENT_BUFFER_SIZE = 30;
const channelEventBuffers = new Map<string, ChannelBuffer>();

function bufferEvent(channel: string, message: unknown): number {
  let buffer = channelEventBuffers.get(channel);
  if (!buffer) {
    buffer = { events: [], nextId: 1 };
    channelEventBuffers.set(channel, buffer);
  }

  const eventId = buffer.nextId++;
  const event: BufferedEvent = {
    id: eventId,
    channel,
    message,
    timestamp: Date.now(),
  };

  buffer.events.push(event);

  // Keep only last N events (circular buffer)
  if (buffer.events.length > EVENT_BUFFER_SIZE) {
    buffer.events.shift();
  }

  return eventId;
}

function getEventsSince(
  channel: string,
  lastEventId: number
): { events: BufferedEvent[]; refreshNeeded: boolean } {
  const buffer = channelEventBuffers.get(channel);

  if (!buffer || buffer.events.length === 0) {
    return { events: [], refreshNeeded: false };
  }

  const oldestEvent = buffer.events[0];

  // If lastEventId is older than our oldest buffered event, refresh needed
  if (lastEventId < oldestEvent.id) {
    return { events: [], refreshNeeded: true };
  }

  // Find events to replay
  const events = buffer.events.filter((e) => e.id > lastEventId);
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

setInterval(cleanupExpiredLocks, 10000);

// ════════════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ════════════════════════════════════════════════════════════════════════════════

const scheduledJobs = new Map<string, ScheduledJob & { photonName: string }>();
const jobTimers = new Map<string, NodeJS.Timeout>();

function parseCron(cron: string): { isValid: boolean; nextRun: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { isValid: false, nextRun: 0 };
  }

  const [minute, hour] = parts;
  const now = new Date();
  const nextDate = new Date(now);
  nextDate.setSeconds(0);
  nextDate.setMilliseconds(0);

  if (minute === '*' && hour === '*') {
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  } else if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2));
    const currentMinute = nextDate.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
    nextDate.setMinutes(nextMinute);
  } else if (hour === '*') {
    const targetMinute = parseInt(minute);
    if (nextDate.getMinutes() >= targetMinute) {
      nextDate.setHours(nextDate.getHours() + 1);
    }
    nextDate.setMinutes(targetMinute);
  } else {
    const targetMinute = parseInt(minute);
    const targetHour = parseInt(hour);
    nextDate.setMinutes(targetMinute);
    nextDate.setHours(targetHour);
    if (nextDate <= now) {
      nextDate.setDate(nextDate.getDate() + 1);
    }
  }

  return { isValid: true, nextRun: nextDate.getTime() };
}

function scheduleJob(job: ScheduledJob & { photonName: string }): boolean {
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
  const timer = setTimeout(() => runJob(job.id), delay);
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

  const sessionManager = sessionManagers.get(job.photonName);
  if (!sessionManager) {
    logger.warn('Cannot run job - photon not initialized', { jobId, photon: job.photonName });
    scheduleJob(job); // Reschedule anyway
    return;
  }

  logger.info('Running scheduled job', { jobId, method: job.method, photon: job.photonName });

  try {
    const session = await sessionManager.getOrCreateSession('scheduler', 'scheduler');
    await sessionManager.loader.executeTool(session.instance, job.method, job.args || {});

    job.lastRun = Date.now();
    job.runCount++;

    publishToChannel(`jobs:${job.photonName}`, {
      event: 'job-completed',
      jobId,
      method: job.method,
      runCount: job.runCount,
    });

    logger.info('Job completed', { jobId, method: job.method, runCount: job.runCount });
  } catch (error) {
    logger.error('Job failed', { jobId, method: job.method, error: getErrorMessage(error) });

    publishToChannel(`jobs:${job.photonName}`, {
      event: 'job-failed',
      jobId,
      method: job.method,
      error: getErrorMessage(error),
    });
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

// ════════════════════════════════════════════════════════════════════════════════
// WEBHOOK HTTP SERVER
// ════════════════════════════════════════════════════════════════════════════════

let webhookServer: http.Server | null = null;
const WEBHOOK_PORT = parseInt(process.env.PHOTON_WEBHOOK_PORT || '0');

function startWebhookServer(port: number): void {
  if (port <= 0) return;

  webhookServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret, X-Photon-Name');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
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
      if (!providedSecret || typeof providedSecret !== 'string' || !timingSafeEqual(providedSecret, expectedSecret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid webhook secret' }));
        return;
      }
    } else if (!process.env.PHOTON_WEBHOOK_ALLOW_UNAUTHENTICATED) {
      // Security: require explicit opt-in for unauthenticated webhooks
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook secret not configured. Set PHOTON_WEBHOOK_SECRET or PHOTON_WEBHOOK_ALLOW_UNAUTHENTICATED=true' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      let args: Record<string, unknown> = {};

      try {
        if (body) {
          args = JSON.parse(body);
        }
        args._webhook = {
          method: req.method,
          headers: req.headers,
          query: Object.fromEntries(url.searchParams),
          timestamp: Date.now(),
        };
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const sessionManager = sessionManagers.get(photonName);
      if (!sessionManager) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Photon '${photonName}' not initialized` }));
        return;
      }

      try {
        const session = await sessionManager.getOrCreateSession('webhook', 'webhook');
        const result = await sessionManager.loader.executeTool(session.instance, method, args);

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
      }
    });
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

function cleanupSocketSubscriptions(socket: net.Socket): void {
  for (const [channel, subs] of channelSubscriptions.entries()) {
    subs.delete(socket);
    if (subs.size === 0) {
      channelSubscriptions.delete(channel);
    }
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
    for (const socket of exactSubscribers) {
      if (socket !== excludeSocket && !socket.destroyed && !sentSockets.has(socket)) {
        try {
          socket.write(payload);
          sentSockets.add(socket);
        } catch {
          // Socket write failed
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
      for (const socket of wildcardSubscribers) {
        if (socket !== excludeSocket && !socket.destroyed && !sentSockets.has(socket)) {
          try {
            socket.write(payload);
            sentSockets.add(socket);
          } catch {
            // Socket write failed
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
  photonPath?: string
): Promise<SessionManager | null> {
  let manager = sessionManagers.get(photonName);

  if (manager) {
    return manager;
  }

  // Need photonPath to initialize
  const storedPath = photonPaths.get(photonName);
  const pathToUse = photonPath || storedPath;

  if (!pathToUse) {
    logger.warn('Cannot initialize photon - no path provided', { photonName });
    return null;
  }

  try {
    logger.info('Initializing session manager', { photonName, photonPath: pathToUse });

    manager = new SessionManager(
      pathToUse,
      photonName,
      idleTimeout,
      logger.child({ scope: photonName })
    );

    sessionManagers.set(photonName, manager);
    photonPaths.set(photonName, pathToUse);

    logger.info('Session manager initialized', { photonName });
    return manager;
  } catch (error) {
    logger.error('Failed to initialize session manager', {
      photonName,
      error: getErrorMessage(error),
    });
    return null;
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

  if (request.type === 'shutdown') {
    shutdown();
    return { type: 'result', id: request.id, success: true, data: { message: 'Shutting down' } };
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

    const result = await reloadPhoton(photonName, photonPath);
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

    // Replay missed events if lastEventId provided
    if (lastEventId !== undefined) {
      const parsedLastEventId = parseInt(String(lastEventId), 10) || 0;
      const { events, refreshNeeded } = getEventsSince(channel, parsedLastEventId);
      if (refreshNeeded) {
        // Send refresh-needed signal
        socket.write(
          JSON.stringify({
            type: 'refresh_needed',
            id: request.id,
            channel,
          }) + '\n'
        );
        logger.info('Replay: refresh needed', { channel, lastEventId });
      } else if (events.length > 0) {
        // Replay events
        for (const event of events) {
          socket.write(
            JSON.stringify({
              type: 'channel_message',
              id: `replay_${event.id}`,
              eventId: event.id,
              channel: event.channel,
              message: event.message,
              replay: true,
            }) + '\n'
          );
        }
        logger.info('Replayed events', { channel, count: events.length });
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

  // Handle get_events_since (for event replay)
  if (request.type === 'get_events_since') {
    const channel = request.channel!;
    const parsedLastEventId = parseInt(String(request.lastEventId || '0'), 10) || 0;
    const { events, refreshNeeded } = getEventsSince(channel, parsedLastEventId);
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
    const holder = request.sessionId || request.id;
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

  // Handle list locks
  if (request.type === 'list_locks') {
    const locks = Array.from(activeLocks.values());
    return { type: 'result', id: request.id, success: true, data: { locks } };
  }

  // Handle job scheduling
  if (request.type === 'schedule') {
    const photonName = request.photonName;
    if (!photonName) {
      return { type: 'error', id: request.id, error: 'photonName required for scheduling' };
    }

    const job: ScheduledJob & { photonName: string } = {
      id: request.jobId!,
      method: request.method!,
      args: request.args,
      cron: request.cron!,
      runCount: 0,
      createdAt: Date.now(),
      createdBy: request.sessionId,
      photonName,
    };

    const scheduled = scheduleJob(job);
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
    const unscheduled = unscheduleJob(jobId);
    return { type: 'result', id: request.id, success: true, data: { unscheduled, jobId } };
  }

  // Handle list jobs
  if (request.type === 'list_jobs') {
    const jobs = Array.from(scheduledJobs.values());
    return { type: 'result', id: request.id, success: true, data: { jobs } };
  }

  // Handle command execution
  if (request.type === 'command') {
    if (!request.method) {
      return { type: 'error', id: request.id, error: 'Method name required' };
    }

    const photonName = request.photonName;
    if (!photonName) {
      return { type: 'error', id: request.id, error: 'photonName required for commands' };
    }

    const sessionManager = await getOrCreateSessionManager(photonName, request.photonPath);
    if (!sessionManager) {
      return {
        type: 'error',
        id: request.id,
        error: `Cannot initialize photon '${photonName}'. Provide photonPath in request.`,
      };
    }

    try {
      const session = await sessionManager.getOrCreateSession(
        request.sessionId,
        request.clientType
      );

      logger.info('Executing request', {
        method: request.method,
        photon: photonName,
        sessionId: session.id,
      });

      setPromptHandler(createSocketPromptHandler(socket, request.id));

      const outputHandler = (emit: any) => {
        if (emit && typeof emit === 'object' && emit.channel) {
          publishToChannel(emit.channel, emit, socket);
          logger.debug('Published to channel', { channel: emit.channel });
        }
      };

      const result = await sessionManager.loader.executeTool(
        session.instance,
        request.method,
        request.args || {},
        { outputHandler }
      );

      setPromptHandler(null);

      return { type: 'result', id: request.id, success: true, data: result };
    } catch (error) {
      logger.error('Error executing request', {
        method: request.method,
        error: getErrorMessage(error),
      });
      setPromptHandler(null);
      return { type: 'error', id: request.id, error: getErrorMessage(error) };
    }
  }

  return { type: 'error', id: request.id, error: `Unknown request type: ${request.type}` };
}

// ════════════════════════════════════════════════════════════════════════════════
// HOT RELOAD
// ════════════════════════════════════════════════════════════════════════════════

async function reloadPhoton(
  photonName: string,
  newPhotonPath: string
): Promise<{ success: boolean; error?: string; sessionsUpdated?: number }> {
  try {
    logger.info('Hot-reloading photon', { photonName, path: newPhotonPath });

    const sessionManager = sessionManagers.get(photonName);
    if (!sessionManager) {
      // First time - just register the path
      photonPaths.set(photonName, newPhotonPath);
      return { success: true, sessionsUpdated: 0 };
    }

    await sessionManager.loader.reloadFile(newPhotonPath);

    const sessions = sessionManager.getSessions();
    let updatedCount = 0;

    for (const session of sessions) {
      try {
        const newInstance = await sessionManager.loader.loadFile(newPhotonPath);
        const oldInstance = session.instance;

        if (oldInstance && typeof oldInstance === 'object') {
          for (const key of Object.keys(oldInstance)) {
            const value = (oldInstance as any)[key];
            if (typeof value !== 'function' && key !== 'constructor') {
              try {
                (newInstance as any)[key] = value;
              } catch {
                // Some properties may be read-only
              }
            }
          }
        }

        if (sessionManager.updateSessionInstance(session.id, newInstance)) {
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
// SERVER
// ════════════════════════════════════════════════════════════════════════════════

function startServer(): void {
  const server = net.createServer((socket) => {
    logger.info('Client connected');

    let buffer = '';

    socket.on('data', async (chunk) => {
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
    });

    socket.on('end', () => {
      logger.info('Client disconnected');
      cleanupSocketSubscriptions(socket);
    });

    socket.on('error', (error) => {
      logger.warn('Socket error', { error: getErrorMessage(error) });
      cleanupSocketSubscriptions(socket);
    });

    socket.on('close', () => {
      cleanupSocketSubscriptions(socket);
    });
  });

  server.listen(socketPath, () => {
    logger.info('Global Photon daemon listening', { socketPath, pid: process.pid });
  });

  server.on('error', (error: any) => {
    logger.error('Server error', { error: getErrorMessage(error) });
    process.exit(1);
  });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

function shutdown(): void {
  logger.info('Shutting down global daemon');

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  for (const timer of jobTimers.values()) {
    clearTimeout(timer);
  }
  jobTimers.clear();
  scheduledJobs.clear();
  activeLocks.clear();

  for (const manager of sessionManagers.values()) {
    manager.destroy();
  }
  sessionManagers.clear();

  if (webhookServer) {
    webhookServer.close();
  }

  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  process.exit(0);
}

// Main execution
(() => {
  startServer();
  startWebhookServer(WEBHOOK_PORT);
  startIdleTimer();
})();
