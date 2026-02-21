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
import * as crypto from 'crypto';
import { SessionManager } from './session-manager.js';
import {
  DaemonRequest,
  DaemonResponse,
  isValidDaemonRequest,
  type ScheduledJob,
  type LockInfo,
} from './protocol.js';
import { setPromptHandler, type PromptHandler, DEFAULT_PHOTON_DIR } from '@portel/photon-core';
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

// Map of compositeKey -> SessionManager (lazy initialized)
const sessionManagers = new Map<string, SessionManager>();
const photonPaths = new Map<string, string>(); // compositeKey -> photonPath
const workingDirs = new Map<string, string>(); // compositeKey -> workingDir
const fileWatchers = new Map<string, fs.FSWatcher>();
const watchDebounce = new Map<string, NodeJS.Timeout>();

/**
 * Create a composite key from photonName + workingDir for map lookups.
 * When workingDir is the default (~/.photon), returns just the photonName
 * for backwards compatibility.
 */
function compositeKey(photonName: string, workingDir?: string): string {
  if (!workingDir || workingDir === DEFAULT_PHOTON_DIR) return photonName;
  const dirHash = crypto.createHash('sha256').update(workingDir).digest('hex').slice(0, 8);
  return `${photonName}:${dirHash}`;
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

  // Purge events older than retention window
  const cutoff = now - EVENT_BUFFER_DURATION_MS;
  while (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff) {
    buffer.events.shift();
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

setInterval(cleanupExpiredLocks, 10000);

// ════════════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ════════════════════════════════════════════════════════════════════════════════

const scheduledJobs = new Map<string, ScheduledJob & { photonName: string; workingDir?: string }>();
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
  } else if (minute.startsWith('*/') || minute.startsWith('0/')) {
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

function scheduleJob(job: ScheduledJob & { photonName: string; workingDir?: string }): boolean {
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

  const key = compositeKey(job.photonName, job.workingDir);
  const sessionManager = sessionManagers.get(key);
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

// Security: rate limiter for webhook endpoint
const webhookRateLimiter = new SimpleRateLimiter(30, 60_000);

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

    // Security: rate limiting
    const clientKey = req.socket?.remoteAddress || 'unknown';
    if (!webhookRateLimiter.isAllowed(clientKey)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
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

    const sessionManager = sessionManagers.get(photonName);
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
    }
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
      for (const socket of wildcardSubscribers) {
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

  try {
    logger.info('Initializing session manager', {
      photonName,
      key,
      photonPath: pathToUse,
      workingDir,
    });

    manager = new SessionManager(
      pathToUse,
      photonName,
      idleTimeout,
      logger.child({ scope: photonName }),
      workingDir
    );

    sessionManagers.set(key, manager);
    photonPaths.set(key, pathToUse);
    if (workingDir) workingDirs.set(key, workingDir);
    watchPhotonFile(photonName, pathToUse);

    logger.info('Session manager initialized', { photonName, key });

    // Auto-register scheduled jobs and webhook routes from tool metadata
    // Do this lazily on first session creation
    autoRegisterFromMetadata(key, manager);

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
      return {
        type: 'error',
        id: request.id,
        error: 'photonName required for scheduling',
        suggestion: 'Include photonName in the request payload',
      };
    }

    const job: ScheduledJob & { photonName: string; workingDir?: string } = {
      id: request.jobId!,
      method: request.method!,
      args: request.args,
      cron: request.cron!,
      runCount: 0,
      createdAt: Date.now(),
      createdBy: request.sessionId,
      photonName,
      workingDir: request.workingDir,
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

    const sessionManager = await getOrCreateSessionManager(
      photonName,
      request.photonPath,
      request.workingDir
    );
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
      // ─────────────────────────────────────────────────────────────

      logger.info('Executing request', {
        method: request.method,
        photon: photonName,
        sessionId: session.id,
        instance: session.instanceName || 'default',
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

      // Persist reactive state after each tool call
      await persistInstanceState(
        session.instance,
        photonName,
        session.instanceName,
        request.workingDir
      );

      // Notify subscribers that state may have changed
      publishToChannel(
        `${photonName}:state-changed`,
        {
          event: 'state-changed',
          method: request.method,
          data: result,
        },
        socket
      );

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
// FILE WATCHING (Auto Hot-Reload)
// ════════════════════════════════════════════════════════════════════════════════

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
    const watcher = fs.watch(watchPath, (eventType) => {
      // Debounce: 100ms (same as Beam)
      const existing = watchDebounce.get(watchPath);
      if (existing) clearTimeout(existing);

      watchDebounce.set(
        watchPath,
        setTimeout(async () => {
          watchDebounce.delete(watchPath);

          // On macOS, editors like sed -i and some IDEs replace the file (new inode),
          // which kills the watcher. Re-watch via original path (symlink) so we
          // re-resolve to the new real path. Don't return — fall through to reload,
          // because the new watcher won't fire (file was already written before it was set up).
          if (eventType === 'rename') {
            unwatchPhotonFile(watchPath);
            if (fs.existsSync(photonPath)) {
              watchPhotonFile(photonName, photonPath);
            }
          }

          if (!fs.existsSync(photonPath)) return;

          logger.info('File changed, auto-reloading', { photonName, path: photonPath });

          // Invalidate cached state keys so they're re-extracted from fresh source
          stateKeysCache.delete(photonName);

          await reloadPhoton(photonName, photonPath);
        }, 100)
      );
    });

    watcher.on('error', (err) => {
      logger.warn('File watcher error', { photonName, error: getErrorMessage(err) });
      unwatchPhotonFile(watchPath);
    });

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

// ════════════════════════════════════════════════════════════════════════════════
// HOT RELOAD
// ════════════════════════════════════════════════════════════════════════════════

async function reloadPhoton(
  photonName: string,
  newPhotonPath: string,
  workingDir?: string
): Promise<{ success: boolean; error?: string; sessionsUpdated?: number }> {
  try {
    const key = compositeKey(photonName, workingDir);
    logger.info('Hot-reloading photon', { photonName, key, path: newPhotonPath });

    const sessionManager = sessionManagers.get(key);
    if (!sessionManager) {
      // First time - just register the path and start watching
      photonPaths.set(key, newPhotonPath);
      watchPhotonFile(photonName, newPhotonPath);
      return { success: true, sessionsUpdated: 0 };
    }

    await sessionManager.loader.reloadFile(newPhotonPath);

    const sessions = sessionManager.getSessions();
    let updatedCount = 0;

    for (const session of sessions) {
      try {
        const newMcp = await sessionManager.loader.loadFile(newPhotonPath);
        const oldMcp = session.instance;

        // Copy state from old CLASS INSTANCE to new CLASS INSTANCE.
        // session.instance is a PhotonClassExtended = { instance, name, schemas, ... }
        // We must copy state on the .instance (actual class obj), NOT the descriptor level —
        // otherwise we'd overwrite newMcp.instance with the old class, defeating the reload.
        if (oldMcp?.instance && newMcp?.instance && typeof oldMcp.instance === 'object') {
          for (const key of Object.keys(oldMcp.instance)) {
            const value = (oldMcp.instance as any)[key];
            if (typeof value !== 'function' && key !== 'constructor') {
              try {
                (newMcp.instance as any)[key] = value;
              } catch {
                // Some properties may be read-only
              }
            }
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

// ════════════════════════════════════════════════════════════════════════════════
// STARTUP WATCH (Proactive — all installed photons watched from daemon start)
// ════════════════════════════════════════════════════════════════════════════════

function startupWatchPhotons(): void {
  const photonDir = DEFAULT_PHOTON_DIR;
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
}

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

  // Close file watchers and debounce timers
  for (const photonPath of fileWatchers.keys()) {
    unwatchPhotonFile(photonPath);
  }

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
  startupWatchPhotons();
  startServer();
  startWebhookServer(WEBHOOK_PORT);
  startIdleTimer();
})();
