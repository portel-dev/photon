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
import * as fs from 'fs';
import { PhotonLoader } from '../loader.js';
import { DaemonRequest, DaemonResponse } from './protocol.js';

// Command line args: photonName photonPath socketPath
const photonName = process.argv[2];
const photonPath = process.argv[3];
const socketPath = process.argv[4];

if (!photonName || !photonPath || !socketPath) {
  console.error('[daemon-server] Missing required arguments');
  process.exit(1);
}

let photonInstance: any = null;
let loader: PhotonLoader | null = null;
let lastActivity = Date.now();
let idleTimeout = -1; // Default: no timeout
let idleTimer: NodeJS.Timeout | null = null;

/**
 * Load the photon
 */
async function loadPhoton(): Promise<void> {
  try {
    console.error(`[daemon-server] Loading photon: ${photonName}`);

    loader = new PhotonLoader(false); // verbose = false
    photonInstance = await loader.loadFile(photonPath);

    // Extract idle timeout from photon metadata if available
    // For now, we'll use a default. This can be enhanced to read from JSDoc
    idleTimeout = 600000; // 10 minutes default

    console.error(`[daemon-server] Photon loaded successfully`);
    console.error(`[daemon-server] Idle timeout: ${idleTimeout === -1 ? 'disabled' : `${idleTimeout}ms`}`);

    // Start idle timer if timeout is set
    if (idleTimeout > 0) {
      startIdleTimer();
    }
  } catch (error: any) {
    console.error(`[daemon-server] Failed to load photon: ${error.message}`);
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
    const idleTime = Date.now() - lastActivity;
    console.error(`[daemon-server] Idle timeout reached (${idleTime}ms). Shutting down.`);
    shutdown();
  }, idleTimeout);
}

/**
 * Reset idle timer (called on each activity)
 */
function resetIdleTimer(): void {
  lastActivity = Date.now();
  startIdleTimer();
}

/**
 * Handle incoming command request
 */
async function handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
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

  if (request.type === 'command') {
    if (!request.method) {
      return {
        type: 'error',
        id: request.id,
        error: 'Method name required',
      };
    }

    try {
      console.error(`[daemon-server] Executing: ${request.method}`);

      const result = await loader!.executeTool(
        photonInstance,
        request.method,
        request.args || {}
      );

      return {
        type: 'result',
        id: request.id,
        success: true,
        data: result,
      };
    } catch (error: any) {
      console.error(`[daemon-server] Error executing ${request.method}: ${error.message}`);

      return {
        type: 'error',
        id: request.id,
        error: error.message,
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
    console.error('[daemon-server] Client connected');

    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString();

      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: DaemonRequest = JSON.parse(line);
          const response = await handleRequest(request);

          socket.write(JSON.stringify(response) + '\n');
        } catch (error: any) {
          console.error(`[daemon-server] Error processing request: ${error.message}`);
          socket.write(JSON.stringify({
            type: 'error',
            id: 'unknown',
            error: error.message,
          }) + '\n');
        }
      }
    });

    socket.on('end', () => {
      console.error('[daemon-server] Client disconnected');
    });

    socket.on('error', (error) => {
      console.error(`[daemon-server] Socket error: ${error.message}`);
    });
  });

  server.listen(socketPath, () => {
    console.error(`[daemon-server] Listening on ${socketPath}`);
    console.error(`[daemon-server] PID: ${process.pid}`);
  });

  server.on('error', (error: any) => {
    console.error(`[daemon-server] Server error: ${error.message}`);
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
  console.error('[daemon-server] Shutting down...');

  if (idleTimer) {
    clearTimeout(idleTimer);
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
  await loadPhoton();
  startServer();
})();
