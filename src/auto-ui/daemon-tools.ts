/**
 * Daemon Tools for MCP
 *
 * Exposes Photon daemon features (pub/sub, locks, scheduled jobs) as MCP tools.
 * Beam acts as a bridge between MCP clients and the daemon IPC protocol.
 *
 * Architecture:
 *   MCP Client (Claude) ←→ Beam (MCP Server) ←→ Daemon (IPC)
 */

import {
  subscribeChannel,
  publishToChannel,
  acquireLock,
  releaseLock,
  listLocks,
  scheduleJob,
  unscheduleJob,
  listJobs,
  pingDaemon,
} from '../daemon/client.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger({ component: 'daemon-tools' });

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Tool definitions for MCP tools/list
 */
export interface DaemonToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Subscription tracking per MCP session
 */
interface SessionSubscriptions {
  patterns: string[];
  unsubscribeFns: Map<string, () => void>;
}

// ════════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════════

export const DAEMON_TOOLS: DaemonToolDefinition[] = [
  // Pub/Sub Tools
  {
    name: 'beam/daemon/subscribe',
    description:
      'Subscribe to daemon event channels. Receive notifications when messages are published to matching channels.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name to subscribe to',
        },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Channel patterns to subscribe to (e.g., "kanban:*", "jobs:completed")',
        },
      },
      required: ['photon', 'patterns'],
    },
  },
  {
    name: 'beam/daemon/unsubscribe',
    description: 'Unsubscribe from daemon event channels.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name to unsubscribe from',
        },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Channel patterns to unsubscribe from',
        },
      },
      required: ['photon', 'patterns'],
    },
  },
  {
    name: 'beam/daemon/publish',
    description: 'Publish a message to a daemon channel. All subscribers will receive the message.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
        channel: {
          type: 'string',
          description: 'Channel name to publish to',
        },
        message: {
          description: 'Message payload (any JSON-serializable value)',
        },
      },
      required: ['photon', 'channel', 'message'],
    },
  },

  // Lock Tools
  {
    name: 'beam/daemon/lock',
    description:
      'Acquire a distributed lock. Returns true if acquired, false if already held by another session.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
        name: {
          type: 'string',
          description: 'Lock name (e.g., "board:write")',
        },
        timeout: {
          type: 'number',
          description: 'Lock timeout in milliseconds (default: 30000)',
        },
      },
      required: ['photon', 'name'],
    },
  },
  {
    name: 'beam/daemon/unlock',
    description:
      'Release a distributed lock. Returns true if released, false if not held by this session.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
        name: {
          type: 'string',
          description: 'Lock name to release',
        },
      },
      required: ['photon', 'name'],
    },
  },
  {
    name: 'beam/daemon/locks',
    description: 'List all active locks for a photon.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
      },
      required: ['photon'],
    },
  },

  // Scheduled Job Tools
  {
    name: 'beam/daemon/schedule',
    description: 'Schedule a recurring job using cron syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
        jobId: {
          type: 'string',
          description: 'Unique job identifier',
        },
        method: {
          type: 'string',
          description: 'Method name to execute',
        },
        cron: {
          type: 'string',
          description: 'Cron expression (e.g., "0 0 * * *" for daily at midnight)',
        },
        args: {
          type: 'object',
          description: 'Arguments to pass to the method',
        },
      },
      required: ['photon', 'jobId', 'method', 'cron'],
    },
  },
  {
    name: 'beam/daemon/unschedule',
    description: 'Remove a scheduled job.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
        jobId: {
          type: 'string',
          description: 'Job ID to remove',
        },
      },
      required: ['photon', 'jobId'],
    },
  },
  {
    name: 'beam/daemon/jobs',
    description: 'List all scheduled jobs for a photon.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
      },
      required: ['photon'],
    },
  },

  // Status Tool
  {
    name: 'beam/daemon/status',
    description: 'Check daemon status and get summary of active subscriptions, locks, and jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        photon: {
          type: 'string',
          description: 'Photon name',
        },
      },
      required: ['photon'],
    },
  },
];

// ════════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Manages subscriptions per MCP session
 * Maps sessionId → photon → subscriptions
 */
class SubscriptionManager {
  private sessions = new Map<string, Map<string, SessionSubscriptions>>();
  workingDir?: string;

  /**
   * Subscribe to channels for a session
   */
  async subscribe(
    sessionId: string,
    photonName: string,
    patterns: string[],
    onMessage: (channel: string, message: unknown) => void
  ): Promise<{ subscribed: string[]; errors: string[] }> {
    // Get or create session map
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }
    const sessionPhotons = this.sessions.get(sessionId)!;

    // Get or create photon subscriptions
    if (!sessionPhotons.has(photonName)) {
      sessionPhotons.set(photonName, { patterns: [], unsubscribeFns: new Map() });
    }
    const subs = sessionPhotons.get(photonName)!;

    const subscribed: string[] = [];
    const errors: string[] = [];

    for (const pattern of patterns) {
      // Skip if already subscribed
      if (subs.patterns.includes(pattern)) {
        subscribed.push(pattern);
        continue;
      }

      try {
        const unsubscribe = await subscribeChannel(
          photonName,
          pattern,
          (message) => {
            onMessage(pattern, message);
          },
          { workingDir: this.workingDir }
        );

        subs.patterns.push(pattern);
        subs.unsubscribeFns.set(pattern, unsubscribe);
        subscribed.push(pattern);
        logger.debug(`Subscribed to ${photonName}/${pattern} for session ${sessionId}`);
      } catch (error) {
        errors.push(`Failed to subscribe to ${pattern}: ${error}`);
        logger.warn(`Subscribe error for ${photonName}/${pattern}`, { error });
      }
    }

    return { subscribed, errors };
  }

  /**
   * Unsubscribe from channels for a session
   */
  unsubscribe(
    sessionId: string,
    photonName: string,
    patterns: string[]
  ): { unsubscribed: string[]; notFound: string[] } {
    const sessionPhotons = this.sessions.get(sessionId);
    if (!sessionPhotons) {
      return { unsubscribed: [], notFound: patterns };
    }

    const subs = sessionPhotons.get(photonName);
    if (!subs) {
      return { unsubscribed: [], notFound: patterns };
    }

    const unsubscribed: string[] = [];
    const notFound: string[] = [];

    for (const pattern of patterns) {
      const unsubFn = subs.unsubscribeFns.get(pattern);
      if (unsubFn) {
        try {
          unsubFn();
        } catch {
          // Ignore unsubscribe errors
        }
        subs.unsubscribeFns.delete(pattern);
        subs.patterns = subs.patterns.filter((p) => p !== pattern);
        unsubscribed.push(pattern);
        logger.debug(`Unsubscribed from ${photonName}/${pattern} for session ${sessionId}`);
      } else {
        notFound.push(pattern);
      }
    }

    return { unsubscribed, notFound };
  }

  /**
   * Clean up all subscriptions for a session
   */
  cleanupSession(sessionId: string): void {
    const sessionPhotons = this.sessions.get(sessionId);
    if (!sessionPhotons) return;

    for (const [photonName, subs] of sessionPhotons) {
      for (const [pattern, unsubFn] of subs.unsubscribeFns) {
        try {
          unsubFn();
          logger.debug(`Cleaned up subscription ${photonName}/${pattern} for session ${sessionId}`);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get subscription info for a session
   */
  getSessionSubscriptions(sessionId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const sessionPhotons = this.sessions.get(sessionId);
    if (!sessionPhotons) return result;

    for (const [photonName, subs] of sessionPhotons) {
      result.set(photonName, [...subs.patterns]);
    }
    return result;
  }
}

// Global subscription manager
const subscriptionManager = new SubscriptionManager();

// ════════════════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Handle daemon tool calls
 */
export async function handleDaemonTool(
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string,
  sendNotification: (method: string, params: unknown) => void,
  workingDir?: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      // ─────────────────────────────────────────────────────────────────────
      // Pub/Sub
      // ─────────────────────────────────────────────────────────────────────
      case 'beam/daemon/subscribe': {
        const photon = args.photon as string;
        const patterns = args.patterns as string[];

        const result = await subscriptionManager.subscribe(
          sessionId,
          photon,
          patterns,
          (channel, message) => {
            // Bridge daemon message to MCP notification
            sendNotification('notifications/daemon/channel', {
              photon,
              channel,
              message,
              timestamp: Date.now(),
            });
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  subscribed: result.subscribed,
                  errors: result.errors.length > 0 ? result.errors : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/unsubscribe': {
        const photon = args.photon as string;
        const patterns = args.patterns as string[];

        const result = subscriptionManager.unsubscribe(sessionId, photon, patterns);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  unsubscribed: result.unsubscribed,
                  notFound: result.notFound.length > 0 ? result.notFound : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/publish': {
        const photon = args.photon as string;
        const channel = args.channel as string;
        const message = args.message;

        await publishToChannel(photon, channel, message, workingDir);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  channel,
                  published: true,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Locks
      // ─────────────────────────────────────────────────────────────────────
      case 'beam/daemon/lock': {
        const photon = args.photon as string;
        const name = args.name as string;
        const timeout = args.timeout as number | undefined;

        const acquired = await acquireLock(photon, name, timeout);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  lock: name,
                  acquired,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/unlock': {
        const photon = args.photon as string;
        const name = args.name as string;

        const released = await releaseLock(photon, name);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  lock: name,
                  released,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/locks': {
        const photon = args.photon as string;

        const locks = await listLocks(photon);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  locks,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Scheduled Jobs
      // ─────────────────────────────────────────────────────────────────────
      case 'beam/daemon/schedule': {
        const photon = args.photon as string;
        const jobId = args.jobId as string;
        const method = args.method as string;
        const cron = args.cron as string;
        const jobArgs = args.args as Record<string, unknown> | undefined;

        const result = await scheduleJob(photon, jobId, method, cron, jobArgs);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  jobId,
                  scheduled: result.scheduled,
                  nextRun: result.nextRun ? new Date(result.nextRun).toISOString() : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/unschedule': {
        const photon = args.photon as string;
        const jobId = args.jobId as string;

        const unscheduled = await unscheduleJob(photon, jobId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  jobId,
                  unscheduled,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'beam/daemon/jobs': {
        const photon = args.photon as string;

        const jobs = await listJobs(photon);

        // Format jobs with human-readable dates
        const formattedJobs = jobs.map((job) => ({
          ...job,
          nextRun: job.nextRun ? new Date(job.nextRun).toISOString() : undefined,
          lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : undefined,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  jobs: formattedJobs,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ─────────────────────────────────────────────────────────────────────
      // Status
      // ─────────────────────────────────────────────────────────────────────
      case 'beam/daemon/status': {
        const photon = args.photon as string;

        const [isAlive, locks, jobs] = await Promise.all([
          pingDaemon(photon),
          listLocks(photon).catch(() => []),
          listJobs(photon).catch(() => []),
        ]);

        const subscriptions = subscriptionManager.getSessionSubscriptions(sessionId);
        const photonSubs = subscriptions.get(photon) || [];

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  photon,
                  daemon: {
                    alive: isAlive,
                  },
                  subscriptions: photonSubs,
                  locks: locks.length,
                  jobs: jobs.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown daemon tool: ${toolName}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Daemon tool error: ${toolName}`, { error: message });

    return {
      content: [{ type: 'text', text: `Daemon error: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Check if a tool name is a daemon tool
 */
export function isDaemonTool(toolName: string): boolean {
  return toolName.startsWith('beam/daemon/');
}

/**
 * Clean up subscriptions when MCP session ends
 */
export function cleanupDaemonSession(sessionId: string): void {
  subscriptionManager.cleanupSession(sessionId);
  logger.debug(`Cleaned up daemon session: ${sessionId}`);
}

/**
 * Get all daemon tool definitions
 */
export function getDaemonTools(): DaemonToolDefinition[] {
  return DAEMON_TOOLS;
}
