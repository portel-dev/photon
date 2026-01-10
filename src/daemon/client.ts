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

// Generate session ID for this process
// This ensures all commands from the same terminal session share the same photon instance
const SESSION_ID = process.env.PHOTON_SESSION_ID || `cli-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
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

    const prompt = defaultValue
      ? `${message} [${defaultValue}]: `
      : `${message}: `;

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
        } catch (error: any) {
          logger.warn('Failed to parse daemon response', { error: error.message });
        }
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      reject(new Error(`Connection error: ${error.message}`));
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
