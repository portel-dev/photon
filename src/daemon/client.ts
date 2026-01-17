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
import { getSocketPath } from './manager.js';
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
 * Send command to daemon and wait for response
 * Handles bidirectional prompts - if daemon requests input, uses readline
 */
export async function sendCommand(
  photonName: string,
  method: string,
  args: Record<string, any>
): Promise<any> {
  const socketPath = getSocketPath(photonName);
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
        sessionId: SESSION_ID,
        clientType: 'cli',
        method,
        args,
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
 * Subscribe to a channel on a daemon
 * Returns an unsubscribe function
 */
export async function subscribeChannel(
  photonName: string,
  channel: string,
  handler: (message: unknown) => void
): Promise<() => void> {
  const socketPath = getSocketPath(photonName);
  const subscribeId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let subscribed = false;
    let buffer = '';

    client.on('connect', () => {
      // Send subscribe request
      const request: DaemonRequest = {
        type: 'subscribe',
        id: subscribeId,
        channel,
        clientType: 'beam',
      };
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const response: DaemonResponse = JSON.parse(line);

          // Handle subscription confirmation
          if (response.id === subscribeId && response.type === 'result') {
            subscribed = true;
            // Return unsubscribe function
            resolve(() => {
              if (!client.destroyed) {
                const unsubRequest: DaemonRequest = {
                  type: 'unsubscribe',
                  id: `unsub_${Date.now()}`,
                  channel,
                };
                client.write(JSON.stringify(unsubRequest) + '\n');
                client.end();
              }
            });
          }

          // Handle channel messages
          if (response.type === 'channel_message' && response.channel === channel) {
            handler(response.message);
          }

          // Handle errors
          if (response.type === 'error' && response.id === subscribeId) {
            reject(new Error(response.error || 'Subscription failed'));
          }
        } catch (error) {
          // Ignore parse errors for partial messages
        }
      }
    });

    client.on('error', (error) => {
      if (!subscribed) {
        reject(new Error(`Connection error: ${getErrorMessage(error)}`));
      }
    });

    client.on('end', () => {
      if (!subscribed) {
        reject(new Error('Connection closed before subscription confirmed'));
      }
    });
  });
}

/**
 * Publish a message to a channel on a daemon
 */
export async function publishToChannel(
  photonName: string,
  channel: string,
  message: unknown
): Promise<void> {
  const socketPath = getSocketPath(photonName);
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
 * Ping daemon to check if it's responsive
 */
export async function pingDaemon(photonName: string): Promise<boolean> {
  const socketPath = getSocketPath(photonName);
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
