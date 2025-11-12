/**
 * Daemon Client
 *
 * CLI client for communicating with daemon servers
 * Sends commands via Unix socket / named pipe and receives results
 */

import * as net from 'net';
import { DaemonRequest, DaemonResponse } from './protocol.js';
import { getSocketPath } from './manager.js';

/**
 * Send command to daemon and wait for response
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
    }, 30000); // 30 second timeout

    client.on('connect', () => {
      const request: DaemonRequest = {
        type: 'command',
        id: requestId,
        method,
        args,
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

          if (response.id === requestId) {
            responseReceived = true;
            clearTimeout(timeout);

            if (response.type === 'error') {
              client.destroy();
              reject(new Error(response.error || 'Unknown error'));
            } else {
              client.destroy();
              resolve(response.data);
            }
          }
        } catch (error: any) {
          console.error(`[daemon-client] Error parsing response: ${error.message}`);
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
