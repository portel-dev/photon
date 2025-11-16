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
import { SessionManager } from './session-manager.js';
import { DaemonRequest, DaemonResponse } from './protocol.js';

// Command line args: photonName photonPath socketPath
const photonName = process.argv[2];
const photonPath = process.argv[3];
const socketPath = process.argv[4];

if (!photonName || !photonPath || !socketPath) {
  console.error('[daemon-server] Missing required arguments');
  process.exit(1);
}

let sessionManager: SessionManager | null = null;
let idleTimeout = 600000; // 10 minutes default
let idleTimer: NodeJS.Timeout | null = null;

/**
 * Initialize session manager
 */
async function initializeSessionManager(): Promise<void> {
  try {
    console.error(`[daemon-server] Initializing session manager for: ${photonName}`);

    sessionManager = new SessionManager(photonPath, photonName, idleTimeout);

    console.error(`[daemon-server] Session manager initialized`);
    console.error(`[daemon-server] Session timeout: ${idleTimeout}ms`);

    // Start idle timer if timeout is set
    if (idleTimeout > 0) {
      startIdleTimer();
    }
  } catch (error: any) {
    console.error(`[daemon-server] Failed to initialize session manager: ${error.message}`);
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
      console.error(`[daemon-server] Idle timeout reached (${idleTime}ms). Shutting down.`);
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

      console.error(`[daemon-server] Executing: ${request.method} (session: ${session.id})`);

      // Execute method on session's photon instance using loader
      const result = await sessionManager.loader.executeTool(
        session.instance,
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

  // Destroy session manager
  if (sessionManager) {
    sessionManager.destroy();
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
})();
