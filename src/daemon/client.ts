/**
 * Daemon Client
 *
 * CLI client for communicating with daemon servers
 * Sends commands via Unix socket / named pipe and receives results
 * Supports bidirectional prompts - daemon can request user input
 */

import * as fs from 'fs';
import * as net from 'net';
import * as crypto from 'crypto';
import * as readline from 'readline';
import { DaemonRequest, DaemonResponse } from './protocol.js';
import { getGlobalSocketPath, ensureDaemon } from './manager.js';
import { createLogger } from '../shared/logger.js';
import { getErrorMessage } from '../shared/error-handler.js';
import { ProgressRenderer } from '@portel/photon-core';

// Generate session ID for this process
// This ensures all commands from the same terminal session share the same photon instance
const SESSION_ID =
  process.env.PHOTON_SESSION_ID || `cli-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const logger = createLogger({ component: 'daemon-client', minimal: true });
const cliProgress = new ProgressRenderer();

/**
 * Render a generator emit yield in the CLI (mirrors loader's createOutputHandler)
 */
async function renderEmitInCLI(emit: any): Promise<void> {
  if (!emit || typeof emit !== 'object' || !emit.emit) return;

  switch (emit.emit) {
    case 'progress':
      cliProgress.render(emit.value, emit.message);
      if (emit.value >= 1) cliProgress.done();
      break;

    case 'status':
      if (cliProgress.active) {
        cliProgress.updateMessage(emit.message);
      } else {
        cliProgress.startSpinner(emit.message);
      }
      break;

    case 'log': {
      cliProgress.done();
      const icon = emit.level === 'error' ? '!' : emit.level === 'warn' ? '!' : 'i';
      console.error(`${icon} ${emit.message}`);
      break;
    }

    case 'toast':
      cliProgress.done();
      console.error(
        `${emit.type === 'error' ? '!' : emit.type === 'success' ? '+' : 'i'} ${emit.message}`
      );
      break;

    case 'qr': {
      cliProgress.done();
      if (emit.message) console.log(emit.message);
      if (emit.value) {
        try {
          const qrcode = await import('qrcode');
          const qrString = await (
            qrcode.toString as (
              text: string,
              opts: { type: string; small: boolean }
            ) => Promise<string>
          )(emit.value, { type: 'terminal', small: true });
          console.log('\n' + qrString);
        } catch {
          console.log(`\n[QR] ${emit.value}\n`);
        }
      }
      break;
    }

    case 'stream':
      cliProgress.done();
      if (typeof emit.data === 'string') {
        process.stdout.write(emit.data);
      } else {
        process.stdout.write(JSON.stringify(emit.data));
      }
      break;

    case 'thinking':
      if (emit.active) {
        cliProgress.render(0, 'Processing...');
      } else {
        cliProgress.done();
      }
      break;
  }
}

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
 * Error thrown when the daemon sends a shutdown signal during a request.
 * Callers can catch this to distinguish a graceful shutdown from a crash.
 */
export class DaemonShutdownError extends Error {
  constructor(reason?: string) {
    super(`Daemon is shutting down${reason ? `: ${reason}` : ''}`);
    this.name = 'DaemonShutdownError';
  }
}

/**
 * Check if an error indicates the daemon is unreachable (crashed or not started)
 */
function isDaemonConnectionError(error: unknown): boolean {
  if (error instanceof DaemonShutdownError) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('ENOENT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Connection error') ||
    msg.includes('Connection closed')
  );
}

/**
 * Check if an error is transient (worth retrying without daemon restart)
 */
function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Request timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') ||
    msg.includes('Daemon is shutting down')
  );
}

/** Methods that are safe to retry (read-only runtime tools) */
const RETRYABLE_METHODS = new Set(['_instances', '_use', '_settings', '_runs', '_run_info']);

/**
 * Send command to daemon with auto-restart on connection failure.
 * Retries on connection errors (restart daemon + retry) and on transient
 * errors for read-only methods (retry without restart).
 */
export async function sendCommand(
  photonName: string,
  method: string,
  args: Record<string, any>,
  options?: {
    maxRetries?: number;
    photonPath?: string;
    sessionId?: string;
    instanceName?: string;
    targetInstance?: string;
    workingDir?: string;
    clientType?: DaemonRequest['clientType'];
  }
): Promise<any> {
  const maxRetries = options?.maxRetries ?? 1;
  const isRetryable = RETRYABLE_METHODS.has(method);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendCommandDirect(
        photonName,
        method,
        args,
        options?.photonPath,
        options?.sessionId,
        options?.instanceName,
        options?.workingDir,
        options?.targetInstance,
        options?.clientType
      );
    } catch (error) {
      if (isDaemonConnectionError(error) && attempt < maxRetries) {
        logger.info(`Daemon unreachable (${photonName}/${method}), retrying...`);
        await ensureDaemon();
        continue;
      }
      // Retry transient errors for read-only methods only
      if (isTransientError(error) && isRetryable && attempt < maxRetries) {
        const delay = Math.min(500 * Math.pow(2, attempt), 2000);
        logger.info(`Transient error on ${method}, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Tell the daemon to reload a photon (re-compile and re-instantiate).
 * Called by Beam after hot-reload so the daemon's instance matches.
 */
export async function reloadDaemonPhoton(
  photonName: string,
  photonPath: string,
  workingDir?: string
): Promise<void> {
  const socketPath = getGlobalSocketPath();
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    const requestId = `reload_${Date.now()}`;
    let buffer = '';

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Daemon reload timeout'));
    }, 15000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'reload',
        id: requestId,
        photonName,
        photonPath,
        workingDir,
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
          const response = JSON.parse(line);
          if (response.id === requestId) {
            clearTimeout(timeout);
            client.end();
            resolve();
          }
        } catch {
          // ignore parse errors
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
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
  instanceName?: string,
  workingDir?: string,
  targetInstance?: string,
  clientType?: DaemonRequest['clientType']
): Promise<any> {
  const socketPath = getGlobalSocketPath();
  const requestId = `req_${Date.now()}_${Math.random()}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    let buffer = '';
    let responseReceived = false;

    let currentTimeout = setTimeout(() => {
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
        clientType: clientType || 'cli',
        method,
        args,
        instanceName,
        targetInstance,
        workingDir,
      };

      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      void (async () => {
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
                clearTimeout(currentTimeout);

                // Get user input via readline
                const userInput = await promptUser(
                  response.prompt.message,
                  response.prompt.default
                );

                // Send prompt response back to daemon
                const promptResponse: DaemonRequest = {
                  type: 'prompt_response',
                  id: requestId,
                  promptValue: userInput,
                };

                client.write(JSON.stringify(promptResponse) + '\n');

                // Restart timeout for next response — store handle so it can be cleared
                currentTimeout = setTimeout(() => {
                  if (!responseReceived) {
                    client.destroy();
                    reject(new Error('Request timeout'));
                  }
                }, 120000);
              }
              // Handle generator emit yields (status, qr, toast, progress, etc.)
              else if (response.type === 'emit' && response.emitData) {
                // Reset timeout — emits mean the tool is actively running
                clearTimeout(currentTimeout);
                currentTimeout = setTimeout(() => {
                  if (!responseReceived) {
                    client.destroy();
                    reject(new Error('Request timeout'));
                  }
                }, 120000);
                void renderEmitInCLI(response.emitData);
              }
              // Handle final result
              else if (response.type === 'result') {
                responseReceived = true;
                clearTimeout(currentTimeout);
                cliProgress.done();
                client.destroy();
                resolve(response.data);
              }
              // Handle error
              else if (response.type === 'error') {
                responseReceived = true;
                clearTimeout(currentTimeout);
                cliProgress.done();
                client.destroy();
                reject(new Error(response.error || 'Unknown error'));
              }
            }

            // Handle shutdown signal (can arrive at any time, not tied to requestId)
            if (response.type === 'shutdown') {
              responseReceived = true;
              clearTimeout(currentTimeout);
              cliProgress.done();
              client.destroy();
              reject(new DaemonShutdownError(response.reason));
            }
          } catch (error) {
            logger.warn('Failed to parse daemon response', { error: getErrorMessage(error) });
          }
        }
      })();
    });

    client.on('error', (error) => {
      clearTimeout(currentTimeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });

    client.on('end', () => {
      clearTimeout(currentTimeout);
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
  options?: SubscribeOptions & { workingDir?: string }
): Promise<() => void> {
  let cancelled = false;
  let lastSeenEventId: string | undefined = options?.lastEventId;

  const connect = (): Promise<() => void> => {
    const socketPath = getGlobalSocketPath();
    const subscribeId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
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
          workingDir: options?.workingDir,
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

            // Handle shutdown signal — trigger immediate reconnect
            if (response.type === 'shutdown') {
              if (subscribed && options?.reconnect && !cancelled) {
                logger.debug(`Daemon shutting down, reconnecting ${channel}...`);
                client.destroy();
                scheduleReconnect();
              } else if (!subscribed) {
                reject(new DaemonShutdownError(response.reason));
              }
              return;
            }

            if (response.type === 'error' && response.id === subscribeId) {
              reject(new Error(response.error || 'Subscription failed'));
            }
          } catch (e) {
            // Lines are fully buffered (split on '\n'), so a parse error here
            // indicates actual protocol corruption — log it.
            logger.warn('Failed to parse daemon channel message', { error: getErrorMessage(e) });
          }
        }
      });

      client.on('error', (error) => {
        if (!subscribed) {
          if (options?.reconnect && !cancelled) {
            // Initial connection failed — retry (e.g. daemon not running yet)
            resolve(() => {
              cancelled = true;
            });
            scheduleReconnect();
          } else {
            reject(new Error(`Connection error: ${getErrorMessage(error)}`));
          }
        } else if (options?.reconnect && !cancelled) {
          scheduleReconnect();
        }
      });

      client.on('end', () => {
        if (!subscribed) {
          if (options?.reconnect && !cancelled) {
            resolve(() => {
              cancelled = true;
            });
            scheduleReconnect();
          } else {
            reject(new Error('Connection closed before subscription confirmed'));
          }
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
      logger.debug(`Subscription lost for ${channel}, reconnecting...`);
    } else {
      logger.debug(`Reconnecting ${channel} in ${delay}ms (attempt ${reconnectAttempts})`);
    }

    setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        try {
          // Try reconnecting to existing daemon first; only start if it's down
          await ensureDaemon();
          await connect();
          reconnectAttempts = 0;
          logger.debug(`Reconnected subscription for ${channel}`);
          options?.onReconnect?.();
        } catch (e) {
          logger.debug(`Reconnect attempt ${reconnectAttempts} failed for ${channel}`, {
            error: getErrorMessage(e),
          });
          if (!cancelled) scheduleReconnect();
        }
      })();
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
  message: unknown,
  workingDir?: string
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
        workingDir,
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
  timeout?: number,
  workingDir?: string
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
        workingDir,
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
export async function releaseLock(
  photonName: string,
  lockName: string,
  workingDir?: string
): Promise<boolean> {
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
        workingDir,
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
 * Assign a lock to a specific caller (identity-aware)
 * Unlike acquireLock which uses the session ID, this sets an explicit holder.
 */
export async function assignLock(
  photonName: string,
  lockName: string,
  holder: string,
  timeout?: number,
  workingDir?: string
): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `assignlock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const requestTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Assign lock request timeout'));
    }, 10000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'assign_lock',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        lockName,
        lockHolder: holder,
        lockTimeout: timeout,
        workingDir,
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
            reject(new Error(response.error || 'Assign lock failed'));
          }
        }
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
 * Transfer a lock from one holder to another
 */
export async function transferLock(
  photonName: string,
  lockName: string,
  fromHolder: string,
  toHolder: string,
  timeout?: number,
  workingDir?: string
): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `transferlock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const requestTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Transfer lock request timeout'));
    }, 10000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'transfer_lock',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        lockName,
        lockHolder: fromHolder,
        lockTransferTo: toHolder,
        lockTimeout: timeout,
        workingDir,
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
            resolve((response.data as { transferred: boolean }).transferred);
          } else {
            reject(new Error(response.error || 'Transfer lock failed'));
          }
        }
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
 * Release a lock held by a specific caller (identity-aware)
 */
export async function releaseIdentityLock(
  photonName: string,
  lockName: string,
  holder: string,
  workingDir?: string
): Promise<boolean> {
  const socketPath = getGlobalSocketPath();
  const requestId = `releaselock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const requestTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Release lock request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'unlock',
        id: requestId,
        photonName,
        sessionId: SESSION_ID,
        lockName,
        lockHolder: holder,
        workingDir,
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
            resolve((response.data as { released: boolean }).released);
          } else {
            reject(new Error(response.error || 'Release lock failed'));
          }
        }
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
 * Query who holds a specific lock
 */
export async function queryLock(
  photonName: string,
  lockName: string
): Promise<{ holder: string | null; acquiredAt?: number; expiresAt?: number }> {
  const socketPath = getGlobalSocketPath();
  const requestId = `querylock_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);

    const requestTimeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Query lock request timeout'));
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'query_lock',
        id: requestId,
        photonName,
        lockName,
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
            resolve(
              response.data as { holder: string | null; acquiredAt?: number; expiresAt?: number }
            );
          } else {
            reject(new Error(response.error || 'Query lock failed'));
          }
        }
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Two-step scheduling RPCs (ps / enable / disable / pause / resume)
// ──────────────────────────────────────────────────────────────

/** Shape returned by the `ps` RPC — full observability snapshot. */
export interface PsSnapshot {
  active: Array<{
    id: string;
    photon: string;
    method: string;
    cron: string;
    nextRun: number | null;
    lastRun: number | null;
    runCount: number;
    photonPath?: string;
    workingDir?: string;
    createdBy?: string;
  }>;
  declared: Array<{
    key: string;
    photon: string;
    method: string;
    cron: string;
    photonPath: string;
    workingDir?: string;
    active: boolean;
  }>;
  webhooks: Array<{ photon: string; route: string; method: string; workingDir?: string }>;
  sessions: Array<{ photon: string; workingDir?: string; key: string; instanceCount: number }>;
}

/** Fire-and-forget helper for the new RPCs. Returns the parsed result.data. */
async function sendSimpleDaemonRequest<T = unknown>(
  req: Omit<DaemonRequest, 'id'> & { id?: string }
): Promise<T> {
  const socketPath = getGlobalSocketPath();
  const requestId = req.id || `${req.type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise<T>((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`${req.type} request timeout`));
    }, 5000);
    client.on('connect', () => {
      client.write(JSON.stringify({ ...req, id: requestId }) + '\n');
    });
    // Unix socket data may arrive in multiple chunks when the response is
    // large. Buffer until we see a newline, then parse each line
    // independently (daemon frames every response with a trailing '\n').
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (!line.trim()) continue;
        try {
          const response: DaemonResponse = JSON.parse(line);
          if (response.id !== requestId) continue;
          clearTimeout(timer);
          client.destroy();
          if (response.type === 'result') resolve(response.data as T);
          else reject(new Error(response.error || `${req.type} failed`));
          return;
        } catch (e) {
          logger.warn('Failed to parse daemon response', {
            error: getErrorMessage(e),
            line: line.slice(0, 200),
          });
        }
      }
    });
    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function fetchPsSnapshot(): Promise<PsSnapshot> {
  return sendSimpleDaemonRequest<PsSnapshot>({ type: 'ps' });
}
export async function enableSchedule(
  photonName: string,
  method: string,
  workingDir?: string
): Promise<unknown> {
  return sendSimpleDaemonRequest({ type: 'enable_schedule', photonName, method, workingDir });
}
export async function disableSchedule(
  photonName: string,
  method: string,
  workingDir?: string
): Promise<unknown> {
  return sendSimpleDaemonRequest({ type: 'disable_schedule', photonName, method, workingDir });
}
export async function pauseSchedule(
  photonName: string,
  method: string,
  workingDir?: string
): Promise<unknown> {
  return sendSimpleDaemonRequest({ type: 'pause_schedule', photonName, method, workingDir });
}
export async function resumeSchedule(
  photonName: string,
  method: string,
  workingDir?: string
): Promise<unknown> {
  return sendSimpleDaemonRequest({ type: 'resume_schedule', photonName, method, workingDir });
}

export interface ExecutionHistoryEntry {
  ts: number;
  jobId: string;
  method: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  errorMessage?: string;
  outputPreview?: string;
}

export interface ExecutionHistoryResponse {
  photon: string;
  method: string;
  entries: ExecutionHistoryEntry[];
}

export async function fetchExecutionHistory(
  photonName: string,
  method: string,
  opts: { limit?: number; sinceTs?: number; workingDir?: string } = {}
): Promise<ExecutionHistoryResponse> {
  return sendSimpleDaemonRequest<ExecutionHistoryResponse>({
    type: 'get_execution_history',
    photonName,
    method,
    limit: opts.limit,
    sinceTs: opts.sinceTs,
    workingDir: opts.workingDir,
  });
}

/**
 * Ping daemon to check if it's responsive
 */
export async function pingDaemon(photonName: string): Promise<boolean> {
  const socketPath = getGlobalSocketPath();

  if (!fs.existsSync(socketPath)) {
    return false;
  }

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
 * Query daemon health status (uptime, memory, sessions, etc.)
 */
export async function queryDaemonStatus(): Promise<{
  uptime: number;
  memoryMB: number;
  sessions: number;
  subscriptions: number;
  photonsLoaded: number;
} | null> {
  const socketPath = getGlobalSocketPath();

  // Bail early if socket doesn't exist — avoids Bun crashing on ENOENT
  // before the 'error' event listener can be attached
  if (!fs.existsSync(socketPath)) {
    return null;
  }

  const requestId = `status_${Date.now()}`;

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      resolve(null);
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'status',
        id: requestId,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());
        if (response.id === requestId && response.type === 'result' && response.data) {
          clearTimeout(timeout);
          client.destroy();
          resolve(response.data as any);
        }
      } catch {
        // Ignore parse errors
      }
    });

    client.on('error', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(null);
    });

    client.on('end', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(null);
    });
  });
}

/**
 * Get events since a specific timestamp for a channel
 * Used for explicit delta sync when client has missed events
 */
/**
 * Clear cached instances for a photon in a given workingDir.
 * Called by Beam when starting with a fresh workingDir to avoid stale in-memory state.
 */
export async function clearInstances(photonName: string, workingDir?: string): Promise<boolean> {
  const socketPath = getGlobalSocketPath();

  if (!fs.existsSync(socketPath)) {
    return false;
  }

  const requestId = `clearinst_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);

    const timeout = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 5000);

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'clear_instances',
        id: requestId,
        photonName,
        workingDir,
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      try {
        const response: DaemonResponse = JSON.parse(chunk.toString().trim());
        if (response.id === requestId) {
          clearTimeout(timeout);
          client.destroy();
          resolve(response.success ?? true);
        }
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
      }
    });

    client.on('error', () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(false); // Daemon not running — nothing to clear
    });
  });
}

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
      } catch (e) {
        logger.warn('Failed to parse daemon response', { error: getErrorMessage(e) });
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${getErrorMessage(error)}`));
    });
  });
}
