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
import { DaemonRequest, DaemonResponse, isValidDaemonRequest } from './protocol.js';
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
    });

    socket.on('error', (error) => {
      logger.warn('Socket error', { error: getErrorMessage(error) });
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
