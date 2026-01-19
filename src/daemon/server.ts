#!/usr/bin/env node

/**
 * Daemon Server
 *
 * Runs as a background process for stateful photons
 * - Loads and initializes the photon
 * - Listens on Unix socket / named pipe
 * - Handles command requests
 * - Manages idle timeout and shutdown
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

// Command line args: photonName photonPath socketPath
const photonName = process.argv[2];
const photonPath = process.argv[3];
const socketPath = process.argv[4];

const logger: Logger = createLogger({
  component: 'daemon-server',
  scope: photonName || 'unknown',
  minimal: true,
});

if (!photonName || !photonPath || !socketPath) {
  logger.error('Missing required arguments');
  process.exit(1);
}

let sessionManager: SessionManager | null = null;
let idleTimeout = 600000; // 10 minutes default
let idleTimer: NodeJS.Timeout | null = null;

// Track pending prompts waiting for user input
// Map: requestId -> { resolve, reject } for resolving prompt responses
const pendingPrompts = new Map<
  string,
  {
    resolve: (value: string | boolean | null) => void;
    reject: (error: Error) => void;
  }
>();

// Current socket for sending prompts (set per-request)
let currentSocket: net.Socket | null = null;
let currentRequestId: string | null = null;

// Channel subscriptions for pub/sub
// Map: channel name -> Set of subscribed sockets
const channelSubscriptions = new Map<string, Set<net.Socket>>();

// ════════════════════════════════════════════════════════════════════════════════
// DISTRIBUTED LOCKS
// ════════════════════════════════════════════════════════════════════════════════

// Active locks: lockName -> LockInfo
const activeLocks = new Map<string, LockInfo>();
const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds

/**
 * Try to acquire a lock
 */
function acquireLock(
  lockName: string,
  holder: string,
  timeout: number = DEFAULT_LOCK_TIMEOUT
): boolean {
  const now = Date.now();

  // Check if lock exists and is still valid
  const existing = activeLocks.get(lockName);
  if (existing && existing.expiresAt > now) {
    // Lock is held by someone else
    if (existing.holder !== holder) {
      return false;
    }
    // Same holder - extend the lock
    existing.expiresAt = now + timeout;
    return true;
  }

  // Lock is free or expired - acquire it
  activeLocks.set(lockName, {
    name: lockName,
    holder,
    acquiredAt: now,
    expiresAt: now + timeout,
  });

  logger.info('Lock acquired', { lockName, holder, timeout });
  return true;
}

/**
 * Release a lock
 */
function releaseLock(lockName: string, holder: string): boolean {
  const existing = activeLocks.get(lockName);
  if (!existing) {
    return true; // Lock doesn't exist, consider it released
  }

  if (existing.holder !== holder) {
    return false; // Can't release someone else's lock
  }

  activeLocks.delete(lockName);
  logger.info('Lock released', { lockName, holder });
  return true;
}

/**
 * Clean up expired locks periodically
 */
function cleanupExpiredLocks(): void {
  const now = Date.now();
  for (const [name, lock] of activeLocks.entries()) {
    if (lock.expiresAt <= now) {
      activeLocks.delete(name);
      logger.info('Lock expired', { lockName: name, holder: lock.holder });
    }
  }
}

// Run lock cleanup every 10 seconds
setInterval(cleanupExpiredLocks, 10000);

// ════════════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ════════════════════════════════════════════════════════════════════════════════

// Scheduled jobs: jobId -> ScheduledJob
const scheduledJobs = new Map<string, ScheduledJob>();
// Job timers: jobId -> NodeJS.Timeout
const jobTimers = new Map<string, NodeJS.Timeout>();

/**
 * Parse cron expression and get next run time
 * Supports: * (every), *\/n (every n), n (specific value)
 * Format: minute hour day month weekday
 */
function parseCron(cron: string): { isValid: boolean; nextRun: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { isValid: false, nextRun: 0 };
  }

  const [minute, hour, day, month, weekday] = parts;
  const now = new Date();

  // Simple implementation: find next matching time
  // For full cron support, use a library like 'cron-parser'
  const nextDate = new Date(now);
  nextDate.setSeconds(0);
  nextDate.setMilliseconds(0);

  // Handle simple cases
  if (minute === '*' && hour === '*') {
    // Every minute
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  } else if (minute.startsWith('*/')) {
    // Every N minutes
    const interval = parseInt(minute.slice(2));
    const currentMinute = nextDate.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
    nextDate.setMinutes(nextMinute);
  } else if (hour === '*') {
    // Specific minute, every hour
    const targetMinute = parseInt(minute);
    if (nextDate.getMinutes() >= targetMinute) {
      nextDate.setHours(nextDate.getHours() + 1);
    }
    nextDate.setMinutes(targetMinute);
  } else {
    // Specific minute and hour
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

/**
 * Schedule a job to run
 */
function scheduleJob(job: ScheduledJob): boolean {
  const { isValid, nextRun } = parseCron(job.cron);
  if (!isValid) {
    logger.error('Invalid cron expression', { jobId: job.id, cron: job.cron });
    return false;
  }

  job.nextRun = nextRun;
  scheduledJobs.set(job.id, job);

  // Clear existing timer if any
  const existingTimer = jobTimers.get(job.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule the job
  const delay = nextRun - Date.now();
  const timer = setTimeout(() => runJob(job.id), delay);
  jobTimers.set(job.id, timer);

  logger.info('Job scheduled', {
    jobId: job.id,
    method: job.method,
    nextRun: new Date(nextRun).toISOString(),
  });
  return true;
}

/**
 * Run a scheduled job
 */
async function runJob(jobId: string): Promise<void> {
  const job = scheduledJobs.get(jobId);
  if (!job || !sessionManager) return;

  logger.info('Running scheduled job', { jobId, method: job.method });

  try {
    // Get or create a session for scheduled jobs
    const session = await sessionManager.getOrCreateSession('scheduler', 'scheduler');

    // Execute the method
    await sessionManager.loader.executeTool(session.instance, job.method, job.args || {});

    // Update job stats
    job.lastRun = Date.now();
    job.runCount++;

    // Publish job completion to channel
    publishToChannel(`jobs:${photonName}`, {
      event: 'job-completed',
      jobId,
      method: job.method,
      runCount: job.runCount,
    });

    logger.info('Job completed', { jobId, method: job.method, runCount: job.runCount });
  } catch (error) {
    logger.error('Job failed', { jobId, method: job.method, error: getErrorMessage(error) });

    // Publish job failure to channel
    publishToChannel(`jobs:${photonName}`, {
      event: 'job-failed',
      jobId,
      method: job.method,
      error: getErrorMessage(error),
    });
  }

  // Reschedule for next run
  scheduleJob(job);
}

/**
 * Cancel a scheduled job
 */
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
const WEBHOOK_PORT = parseInt(process.env.PHOTON_WEBHOOK_PORT || '0'); // 0 = disabled by default

/**
 * Start webhook HTTP server
 */
function startWebhookServer(port: number): void {
  if (port <= 0) return;

  webhookServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse URL: /webhook/{method}
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts[0] !== 'webhook' || !pathParts[1]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /webhook/{method}' }));
      return;
    }

    const method = pathParts[1];

    // Verify webhook secret if configured
    const expectedSecret = process.env.PHOTON_WEBHOOK_SECRET;
    if (expectedSecret) {
      const providedSecret = req.headers['x-webhook-secret'];
      if (providedSecret !== expectedSecret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid webhook secret' }));
        return;
      }
    }

    // Parse request body
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

        // Add webhook metadata
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

      // Execute the photon method
      if (!sessionManager) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service not ready' }));
        return;
      }

      try {
        const session = await sessionManager.getOrCreateSession('webhook', 'webhook');
        const result = await sessionManager.loader.executeTool(session.instance, method, args);

        logger.info('Webhook executed', { method, source: req.headers['user-agent'] });

        // Publish webhook event to channel
        publishToChannel(`webhooks:${photonName}`, {
          event: 'webhook-received',
          method,
          timestamp: Date.now(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (error) {
        logger.error('Webhook execution failed', { method, error: getErrorMessage(error) });
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

/**
 * Clean up all subscriptions for a socket
 */
function cleanupSocketSubscriptions(socket: net.Socket): void {
  for (const [channel, subs] of channelSubscriptions.entries()) {
    subs.delete(socket);
    // Remove empty channels
    if (subs.size === 0) {
      channelSubscriptions.delete(channel);
    }
  }
}

/**
 * Publish a message to all subscribers of a channel
 * Supports wildcard subscriptions: "prefix:*" matches "prefix:anything"
 */
function publishToChannel(channel: string, message: unknown, excludeSocket?: net.Socket): void {
  const payload =
    JSON.stringify({
      type: 'channel_message',
      id: `ch_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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
          // Socket write failed, will be cleaned up on 'end' event
        }
      }
    }
  }

  // Send to wildcard subscribers (e.g., "kanban:*" matches "kanban:photon")
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
}

/**
 * Initialize session manager
 */
async function initializeSessionManager(): Promise<void> {
  try {
    logger.info(`Initializing session manager for ${photonName}`);

    sessionManager = new SessionManager(
      photonPath,
      photonName,
      idleTimeout,
      logger.child({ scope: 'session' })
    );

    logger.info('Session manager initialized');
    logger.info('Session timeout configured', { timeoutMs: idleTimeout });

    // Start idle timer if timeout is set
    if (idleTimeout > 0) {
      startIdleTimer();
    }
  } catch (error) {
    logger.error('Failed to initialize session manager', { error: getErrorMessage(error) });
    process.exit(1);
  }
}

/**
 * Start idle timer
 */
function startIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  if (idleTimeout <= 0) {
    return; // Idle timeout disabled
  }

  idleTimer = setTimeout(() => {
    if (!sessionManager) return;

    const lastActivity = sessionManager.getLastActivity();
    const idleTime = Date.now() - lastActivity;

    if (idleTime >= idleTimeout) {
      logger.warn('Idle timeout reached, shutting down', { idleTime });
      shutdown();
    } else {
      // Restart timer with remaining time
      startIdleTimer();
    }
  }, idleTimeout);
}

/**
 * Reset idle timer (called on each activity)
 */
function resetIdleTimer(): void {
  startIdleTimer();
}

/**
 * Create a prompt handler that sends prompts over the socket
 */
function createSocketPromptHandler(socket: net.Socket, requestId: string): PromptHandler {
  return async (message: string, defaultValue?: string): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      // Store the resolver for when we get the response
      pendingPrompts.set(requestId, {
        resolve: (value) => resolve(value as string | null),
        reject,
      });

      // Send prompt request to client
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

/**
 * Handle incoming command request
 */
async function handleRequest(
  request: DaemonRequest,
  socket: net.Socket
): Promise<DaemonResponse | null> {
  resetIdleTimer();

  if (request.type === 'ping') {
    return {
      type: 'pong',
      id: request.id,
    };
  }

  if (request.type === 'shutdown') {
    shutdown();
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { message: 'Shutting down' },
    };
  }

  // Handle prompt response from client
  if (request.type === 'prompt_response') {
    const pending = pendingPrompts.get(request.id);
    if (pending) {
      pendingPrompts.delete(request.id);
      pending.resolve(request.promptValue ?? null);
    }
    // Don't send a response back - the original command handler will respond
    return null;
  }

  // Handle channel subscribe
  if (request.type === 'subscribe') {
    const channel = request.channel!;
    let subs = channelSubscriptions.get(channel);
    if (!subs) {
      subs = new Set();
      channelSubscriptions.set(channel, subs);
    }
    subs.add(socket);
    logger.info('Client subscribed to channel', { channel, subscribers: subs.size });
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
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { unsubscribed: true, channel },
    };
  }

  // Handle channel publish
  if (request.type === 'publish') {
    const channel = request.channel!;
    const message = request.message;
    publishToChannel(channel, message, socket);
    logger.info('Published to channel', { channel });
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { published: true, channel },
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
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { locks },
    };
  }

  // Handle job scheduling
  if (request.type === 'schedule') {
    const job: ScheduledJob = {
      id: request.jobId!,
      method: request.method!,
      args: request.args,
      cron: request.cron!,
      runCount: 0,
      createdAt: Date.now(),
      createdBy: request.sessionId,
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

    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { unscheduled, jobId },
    };
  }

  // Handle list jobs
  if (request.type === 'list_jobs') {
    const jobs = Array.from(scheduledJobs.values());
    return {
      type: 'result',
      id: request.id,
      success: true,
      data: { jobs },
    };
  }

  if (request.type === 'command') {
    if (!request.method) {
      return {
        type: 'error',
        id: request.id,
        error: 'Method name required',
      };
    }

    if (!sessionManager) {
      return {
        type: 'error',
        id: request.id,
        error: 'Session manager not initialized',
      };
    }

    try {
      // Get or create session for this client
      const session = await sessionManager.getOrCreateSession(
        request.sessionId,
        request.clientType
      );

      logger.info('Executing request', { method: request.method, sessionId: session.id });

      // Set up socket-based prompt handler for this request
      setPromptHandler(createSocketPromptHandler(socket, request.id));

      // Execute method on session's photon instance using loader
      const result = await sessionManager.loader.executeTool(
        session.instance,
        request.method,
        request.args || {}
      );

      // Clear prompt handler after execution
      setPromptHandler(null);

      return {
        type: 'result',
        id: request.id,
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Error executing request', {
        method: request.method,
        error: getErrorMessage(error),
      });

      // Clear prompt handler on error
      setPromptHandler(null);

      return {
        type: 'error',
        id: request.id,
        error: getErrorMessage(error),
      };
    }
  }

  return {
    type: 'error',
    id: request.id,
    error: `Unknown request type: ${request.type}`,
  };
}

/**
 * Start IPC server
 */
function startServer(): void {
  const server = net.createServer((socket) => {
    logger.info('Client connected');

    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);

          // Validate request structure
          if (!isValidDaemonRequest(parsed)) {
            socket.write(
              JSON.stringify({
                type: 'error',
                id: 'unknown',
                error: 'Invalid request format',
              }) + '\n'
            );
            continue;
          }

          const request: DaemonRequest = parsed;
          const response = await handleRequest(request, socket);

          // Only send response if handler returned one (null for prompt_response)
          if (response !== null) {
            socket.write(JSON.stringify(response) + '\n');
          }
        } catch (error) {
          logger.error('Error processing request', { error: getErrorMessage(error) });
          socket.write(
            JSON.stringify({
              type: 'error',
              id: 'unknown',
              error: getErrorMessage(error),
            }) + '\n'
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
    logger.info('Listening for connections', { socketPath, pid: process.pid });
  });

  server.on('error', (error: any) => {
    logger.error('Server error', { error: getErrorMessage(error) });
    process.exit(1);
  });

  // Graceful shutdown handlers
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Shutdown daemon
 */
function shutdown(): void {
  logger.info('Shutting down daemon');

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  // Clear all job timers
  for (const timer of jobTimers.values()) {
    clearTimeout(timer);
  }
  jobTimers.clear();
  scheduledJobs.clear();

  // Clear locks
  activeLocks.clear();

  // Destroy session manager
  if (sessionManager) {
    sessionManager.destroy();
  }

  // Close webhook server
  if (webhookServer) {
    webhookServer.close();
  }

  // Clean up socket file (Unix only)
  if (fs.existsSync(socketPath) && process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  process.exit(0);
}

// Main execution
(async () => {
  await initializeSessionManager();
  startServer();
  startWebhookServer(WEBHOOK_PORT);
})();
