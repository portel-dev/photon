/**
 * Daemon Client
 *
 * CLI client for communicating with daemon servers
 * Sends commands via Unix socket / named pipe and receives results
 * Supports bidirectional prompts - daemon can request user input
 */

import * as net from 'net';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { DaemonRequest, DaemonResponse } from './protocol.js';
import { getGlobalSocketPath, restartGlobalDaemon } from './manager.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';

// Generate session ID for this process
// This ensures all commands from the same terminal session share the same photon instance
const SESSION_ID =
  process.env.PHOTON_SESSION_ID || `cli-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const logger = createLogger({ component: 'daemon-client', minimal: true });

/**
 * Prompt user for input using readline
 */
async function promptUser(message: string, defaultValue?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `;

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer || defaultValue || null);
    });
  });
}

/**
 * Check if an error indicates the daemon is unreachable (crashed or not started)
 */
function isDaemonConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('ENOENT') || msg.includes('ECONNREFUSED') || msg.includes('Connection error');
}

/**
 * Send command to daemon with auto-restart on connection failure.
 * If the daemon is unreachable, restarts it and retries once.
 */
export async function sendCommand(
  photonName: string,
  method: string,
  args: Record<string, any>,
  options?: { maxRetries?: number; photonPath?: string; sessionId?: string; instanceName?: string }
): Promise<any> {
  const maxRetries = options?.maxRetries ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendCommandDirect(
        photonName,
        method,
        args,
        options?.photonPath,
        options?.sessionId,
        options?.instanceName
      );
    } catch (error) {
      if (isDaemonConnectionError(error) && attempt < maxRetries) {
        logger.info('Daemon unreachable, auto-restarting...');
        await restartGlobalDaemon();
        continue;
      }
      throw error;
    }
  }
}

/**
 * Send command directly to daemon (no retry logic)
 */
async function sendCommandDirect(
  photonName: string,
  method: string,
  args: Record<string, any>,
  photonPath?: string,
  sessionId?: string,
  instanceName?: string
): Promise<any> {
  const socketPath = getGlobalSocketPath();
  const requestId = `req_${Date.now()}_${Math.random()}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    let buffer = '';
    let responseReceived = false;

    const timeout = setTimeout(() => {
      if (!responseReceived) {
        client.destroy();
        reject(new Error('Request timeout'));
      }
    }, 120000); // 2 minute timeout (longer for interactive prompts)

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'command',
        id: requestId,
        photonName,
        photonPath,
        sessionId: sessionId || SESSION_ID,
        clientType: 'cli',
        method,
        args,
        instanceName,
      };

      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', async (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response: DaemonResponse = JSON.parse(line);

          if (response.id === requestId) {
            // Handle prompt request from daemon
            if (response.type === 'prompt' && response.prompt) {
              // Reset timeout while waiting for user input
              clearTimeout(timeout);

              // Get user input via readline
              const userInput = await promptUser(response.prompt.message, response.prompt.default);

              // Send prompt response back to daemon
              const promptResponse: DaemonRequest = {
                type: 'prompt_response',
                id: requestId,
                promptValue: userInput,
              };

              client.write(JSON.stringify(promptResponse) + '\n');

              // Restart timeout for next response
              setTimeout(() => {
                if (!responseReceived) {
                  client.destroy();
                  reject(new Error('Request timeout'));
                }
              }, 120000);
            }
            // Handle final result
            else if (response.type === 'result') {
              responseReceived = true;
              clearTimeout(timeout);
              client.destroy();
              resolve(response.data);
            }
            // Handle error
            else if (response.type === 'error') {
              responseReceived = true;
              clearTimeout(timeout);
              client.destroy();
              reject(new Error(response.error || 'Unknown error'));
            }
          }
        } catch (error) {
          logger.warn('Failed to parse daemon response', { error: getErrorMessage(error) });
        }
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });

    client.on('end', () => {
      clearTimeout(timeout);
      client.destroy();
      if (!responseReceived) {
        reject(new Error('Connection closed before receiving response'));
      }
    });
  });
}

/**
 * Subscription options
 */
export interface SubscribeOptions {
  /** Last event timestamp for delta sync on reconnect */
  lastEventId?: string;
  /** Handler for full sync signal (when client is stale beyond buffer window) */
  onRefreshNeeded?: () => void;
  /** Auto-reconnect on connection drop (restarts daemon if needed) */
  reconnect?: boolean;
  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Called when reconnection succeeds */
  onReconnect?: () => void;
}

/**
 * Subscribe to a channel on a daemon
 * Returns an unsubscribe function
 */
export async function subscribeChannel(
  photonName: string,
  channel: string,
  handler: (message: unknown, eventId?: string) => void,
  options?: SubscribeOptions
): Promise<() => void> {
  let cancelled = false;
  let currentClient: net.Socket | null = null;
  let lastSeenEventId: string | undefined = options?.lastEventId;

  const connect = (): Promise<() => void> => {
    const socketPath = getGlobalSocketPath();
    const subscribeId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
      currentClient = client;
      let subscribed = false;
      let buffer = '';

      client.on('connect', () => {
        const request: DaemonRequest = {
          type: 'subscribe',
          id: subscribeId,
          photonName,
          channel,
          clientType: 'beam',
          lastEventId: lastSeenEventId,
        };
        client.write(JSON.stringify(request) + '\n');
      });

      client.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response: DaemonResponse = JSON.parse(line);

            if (response.id === subscribeId && response.type === 'result') {
              subscribed = true;
              resolve(() => {
                cancelled = true;
                if (!client.destroyed) {
                  const unsubRequest: DaemonRequest = {
                    type: 'unsubscribe',
                    id: `unsub_${Date.now()}`,
                    photonName,
                    channel,
                  };
                  client.write(JSON.stringify(unsubRequest) + '\n');
                  client.end();
                }
              });
            }

            if (response.type === 'refresh_needed') {
              if (options?.onRefreshNeeded) {
                options.onRefreshNeeded();
              }
            }

            if (response.type === 'channel_message' && response.channel) {
              const isMatch = channel.endsWith(':*')
                ? response.channel.startsWith(channel.slice(0, -1))
                : response.channel === channel;
              if (isMatch) {
                // Track last seen eventId for replay on reconnect
                if (response.eventId) {
                  lastSeenEventId = response.eventId;
                }
                handler(response.message, response.eventId);
              }
            }

            if (response.type === 'error' && response.id === subscribeId) {
              reject(new Error(response.error || 'Subscription failed'));
            }
          } catch {
            // Ignore parse errors for partial messages
          }
        }
      });

      client.on('error', (error) => {
        if (!subscribed) {
          reject(new Error(`Connection error: ${getErrorMessage(error)}`));
        } else if (options?.reconnect && !cancelled) {
          scheduleReconnect();
        }
      });

      client.on('end', () => {
        if (!subscribed) {
          reject(new Error('Connection closed before subscription confirmed'));
        } else if (options?.reconnect && !cancelled) {
          scheduleReconnect();
        }
      });
    });
  };

  let reconnectAttempts = 0;
  const maxAttempts = options?.maxReconnectAttempts ?? Infinity;

  const scheduleReconnect = () => {
    if (cancelled || reconnectAttempts >= maxAttempts) return;
    reconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
    if (reconnectAttempts === 1) {
      logger.info(`Subscription lost for ${channel}, reconnecting...`);
    } else {
      logger.debug(`Reconnecting ${channel} in ${delay}ms (attempt ${reconnectAttempts})`);
    }

    setTimeout(async () => {
      if (cancelled) return;
      try {
        // Restart daemon if needed
        await restartGlobalDaemon();
        await new Promise((r) => setTimeout(r, 500));
        await connect();
        reconnectAttempts = 0;
        logger.info(`Reconnected subscription for ${channel}`);
        options?.onReconnect?.();
      } catch {
        if (!cancelled) scheduleReconnect();
      }
    }, delay);
  };

  return connect();
}

/**
 * Publish a message to a channel on a daemon
 */
export async function publishToChannel(
  photonName: string,
  channel: string,
  message: unknown
): Promise<void> {
  const socketPath = getGlobalSocketPath();
  const requestId = `pub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Publish timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'publish',
        id: requestId,
        photonName,
        channel,
        message,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve();
          } else {
            reject(new Error(response.error || 'Publish failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Acquire a distributed lock
 * Returns true if lock acquired, false if already held
 */
export async function acquireLock(
  photonName: string,
  lockName: string,
  timeout?: number
): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `lock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const requestTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Lock request timeout'));
    }, 10000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'lock',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        lockName,
        lockTimeout: timeout,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(requestTimeout);
          client.destroy();
          if (response.type === 'result') {
            resolve((response.data as { acquired: boolean }).acquired);
          } else {
            reject(new Error(response.error || 'Lock failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(requestTimeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Release a distributed lock
 * Returns true if lock released, false if not held by this session
 */
export async function releaseLock(photonName: string, lockName: string): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `unlock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Unlock request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'unlock',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        lockName,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve((response.data as { released: boolean }).released);
          } else {
            reject(new Error(response.error || 'Unlock failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * List all active locks
 */
export async function listLocks(
  photonName: string
): Promise<Array<{ name: string; holder: string; acquiredAt: number; expiresAt: number }>> {
  const socketPath = getGlobalSocketPath();
  const requestId = `listlocks_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('List locks request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'list_locks',
        id: requestId,
        photonName,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve((response.data as { locks: any[] }).locks || []);
          } else {
            reject(new Error(response.error || 'List locks failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Schedule a recurring job
 */
export async function scheduleJob(
  photonName: string,
  jobId: string,
  method: string,
  cron: string,
  args?: Record<string, unknown>
): Promise<{ scheduled: boolean; nextRun?: number }> {
  const socketPath = getGlobalSocketPath();
  const requestId = `schedule_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Schedule request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'schedule',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        jobId,
        method,
        cron,
        args,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve(response.data as { scheduled: boolean; nextRun?: number });
          } else {
            reject(new Error(response.error || 'Schedule failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Unschedule a job
 */
export async function unscheduleJob(photonName: string, jobId: string): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `unschedule_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Unschedule request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'unschedule',
        id: requestId,
        photonName,
        jobId,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve((response.data as { unscheduled: boolean }).unscheduled);
          } else {
            reject(new Error(response.error || 'Unschedule failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * List all scheduled jobs
 */
export async function listJobs(photonName: string): Promise<
  Array<{
    id: string;
    method: string;
    cron: string;
    nextRun?: number;
    lastRun?: number;
    runCount: number;
  }>
> {
  const socketPath = getGlobalSocketPath();
  const requestId = `listjobs_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('List jobs request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'list_jobs',
        id: requestId,
        photonName,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            resolve((response.data as { jobs: any[] }).jobs || []);
          } else {
            reject(new Error(response.error || 'List jobs failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Reload the daemon's photon code without losing state
 * Called by dev server after hot-reload to sync daemon
 */
export async function reloadDaemon(
  photonName: string,
  photonPath: string
): Promise<{ success: boolean; error?: string; sessionsUpdated?: number }> {
  const socketPath = getGlobalSocketPath();
  const requestId = `reload_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Reload request timeout'));
    }, 30000); // 30 second timeout for reload

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'reload',
        id: requestId,
        photonName,
        photonPath,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            const data = response.data as {
              message?: string;
              error?: string;
              sessionsUpdated?: number;
            };
            resolve({
              success: response.success ?? true,
              error: data?.error,
              sessionsUpdated: data?.sessionsUpdated,
            });
          } else {
            resolve({ success: false, error: response.error || 'Reload failed' });
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

/**
 * Ping daemon to check if it's responsive
 */
export async function pingDaemon(photonName: string): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `ping_${Date.now()}`;

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'ping',
        id: requestId,
        photonName,
      };

      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId && response.type === 'pong') {
          clearTimeout(timeout);
          client.destroy();
          resolve(true);
        }
      } catch (error) {
        // Ignore parse errors
      }
    });

    client.on('error', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(false);
    });

    client.on('end', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(false);
    });
  });
}

/**
 * Get events since a specific timestamp for a channel
 * Used for explicit delta sync when client has missed events
 */
export async function getEventsSince(
  photonName: string,
  channel: string,
  lastEventId: string
): Promise<{ events: Array<{ eventId: string; message: unknown }>; refreshNeeded: boolean }> {
  const socketPath = getGlobalSocketPath();
  const requestId = `getevents_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Get events request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'get_events_since',
        id: requestId,
        photonName,
        channel,
        lastEventId,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());

        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          if (response.type === 'result') {
            const data = response.data as {
              events: Array<{ eventId: string; message: unknown }>;
              refreshNeeded?: boolean;
            };
            resolve({
              events: data.events || [],
              refreshNeeded: data.refreshNeeded || false,
            });
          } else {
            reject(new Error(response.error || 'Get events failed'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}
